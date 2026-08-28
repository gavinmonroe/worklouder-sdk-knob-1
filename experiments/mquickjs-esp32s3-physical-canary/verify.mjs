#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { inspectEsp32AppImage, repairEsp32AppIntegrity } from
  "../../custom-firmware/lib/esp-app-image.mjs";
import {
  buildRenderV2MQuickJsPackage,
  decodeRenderV2MQuickJsPackage,
  RENDER_V2_MQUICKJS_PACKAGE_ABI_SHA256,
} from "../../f1-widget-sdk/src/render-v2/mquickjs.mjs";
import { buildWeatherTargetFacadeAsset, decodeTargetFacadeAsset,
  TARGET_FACADE_CONTRACT_SHA256, WEATHER_TARGET_FACADE_TARGETS } from
  "../mquickjs-target-facade/contract.mjs";
import { WEATHER_MQUICKJS_TARGETS, requiredWeatherCanaryHostRpcIds } from
  "../../f1-widget-sdk/examples/render-v2-mquickjs-weather-canary/protocol.mjs";

const execute = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(here, "../..");
const output = path.resolve(process.env.FRAMER_PHYSICAL_OUTPUT ?? path.join(here, "build"));
const canary = path.join(repository, "experiments/mquickjs-esp32s3-canary");
const vendor = path.join(canary, "vendor/mquickjs");
const resident = path.join(repository, "experiments/mquickjs-esp32s3-resident-integration");
const loader = path.join(repository, "experiments/mquickjs-esp32s3-module-loader");
const target = path.join(repository, "experiments/mquickjs-target-facade");
const runtimeProof = path.join(repository, "experiments/mquickjs-esp32s3-runtime-proof");
const weather = path.join(repository,
  "f1-widget-sdk/examples/render-v2-mquickjs-weather-canary");
const sourceClosurePaths = Object.freeze([
  "custom-firmware/lib/esp-app-image.mjs",
  "experiments/mquickjs-esp32s3-canary/framer_mquickjs_canary.c",
  "experiments/mquickjs-esp32s3-canary/framer_mquickjs_canary.h",
  "experiments/mquickjs-esp32s3-canary/framer_stdlib_gen.c",
  "experiments/mquickjs-esp32s3-canary/host_harness.c",
  "experiments/mquickjs-esp32s3-canary/vendor/mquickjs/cutils.c",
  "experiments/mquickjs-esp32s3-canary/vendor/mquickjs/cutils.h",
  "experiments/mquickjs-esp32s3-canary/vendor/mquickjs/dtoa.c",
  "experiments/mquickjs-esp32s3-canary/vendor/mquickjs/dtoa.h",
  "experiments/mquickjs-esp32s3-canary/vendor/mquickjs/libm.c",
  "experiments/mquickjs-esp32s3-canary/vendor/mquickjs/libm.h",
  "experiments/mquickjs-esp32s3-canary/vendor/mquickjs/list.h",
  "experiments/mquickjs-esp32s3-canary/vendor/mquickjs/mquickjs.c",
  "experiments/mquickjs-esp32s3-canary/vendor/mquickjs/mquickjs.h",
  "experiments/mquickjs-esp32s3-canary/vendor/mquickjs/mquickjs_build.c",
  "experiments/mquickjs-esp32s3-canary/vendor/mquickjs/mquickjs_build.h",
  "experiments/mquickjs-esp32s3-canary/vendor/mquickjs/mquickjs_opcode.h",
  "experiments/mquickjs-esp32s3-canary/vendor/mquickjs/mquickjs_priv.h",
  "experiments/mquickjs-esp32s3-canary/vendor/mquickjs/softfp_template.h",
  "experiments/mquickjs-esp32s3-module-loader/module_adapter.c",
  "experiments/mquickjs-esp32s3-module-loader/resident_loader_canary.c",
  "experiments/mquickjs-esp32s3-module-loader/resident_loader_canary.h",
  "experiments/mquickjs-esp32s3-physical-canary/backend_contract.h",
  "experiments/mquickjs-esp32s3-physical-canary/completion_contract.h",
  "experiments/mquickjs-esp32s3-physical-canary/fatal_retirement.h",
  "experiments/mquickjs-esp32s3-physical-canary/focus_contract.h",
  "experiments/mquickjs-esp32s3-physical-canary/key_gate.h",
  "experiments/mquickjs-esp32s3-physical-canary/key_token.h",
  "experiments/mquickjs-esp32s3-physical-canary/key_wrapper.c",
  "experiments/mquickjs-esp32s3-physical-canary/loader.ld",
  "experiments/mquickjs-esp32s3-physical-canary/loader_entry.c",
  "experiments/mquickjs-esp32s3-physical-canary/module.ld",
  "experiments/mquickjs-esp32s3-physical-canary/physical_host_harness.c",
  "experiments/mquickjs-esp32s3-physical-canary/physical_integration.c",
  "experiments/mquickjs-esp32s3-physical-canary/publication_contract.h",
  "experiments/mquickjs-esp32s3-physical-canary/rpc_shims.S",
  "experiments/mquickjs-esp32s3-physical-canary/tail_trampoline.S",
  "experiments/mquickjs-esp32s3-physical-canary/telemetry_session.h",
  "experiments/mquickjs-esp32s3-resident-integration/f2js_admission.c",
  "experiments/mquickjs-esp32s3-resident-integration/f2js_admission.h",
  "experiments/mquickjs-esp32s3-resident-integration/resident_integration.c",
  "experiments/mquickjs-esp32s3-resident-integration/resident_integration.h",
  "experiments/mquickjs-esp32s3-runtime-proof/runtime_proof.c",
  "experiments/mquickjs-esp32s3-runtime-proof/runtime_proof.h",
  "experiments/mquickjs-target-facade/contract.mjs",
  "experiments/mquickjs-target-facade/target_facade.c",
  "experiments/mquickjs-target-facade/target_facade.h",
  "f1-widget-sdk/examples/render-v2-mquickjs-weather-canary/protocol.mjs",
  "f1-widget-sdk/examples/render-v2-mquickjs-weather-canary/weather-widget.js",
  "f1-widget-sdk/src/render-v2/mquickjs.mjs",
]);
const healthyAppPath = path.join(repository,
  "f1-widget-sdk/build/combined-renderer-v2-clock-blue-timer/" +
  "framer-0.4.1-music-id1-wpm-id7-renderer-id26-clock-id27-blue-timer-app.bin");
const healthyReceiptPath = path.join(repository,
  "f1-widget-sdk/build/device-receipts/device-1786939039376-fast-smoke.json");
const basePath = path.join(target, "build/weather-gen18-base.rgb565le");
const toolchain = process.env.FRAMER_XTENSA_BIN ?? path.join(repository,
  ".toolchains/xtensa-esp-elf-13.2.0_20240530/bin");
const xtensa = (name) => path.join(toolchain, `xtensa-esp32s3-elf-${name}`);
const cc = process.env.CC ?? "cc";
const run = (command, args, options = {}) => execute(command, args,
  { maxBuffer: 64 * 1024 * 1024, ...options });
const invariant = (value, message) => { if (!value) throw new Error(message); };
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const shaBytes = (value) => createHash("sha256").update(value).digest();
const sha256Files = async (files) => {
  const digest = createHash("sha256");
  for (const file of files) digest.update(await readFile(file));
  return digest.digest("hex");
};
async function sourceClosureSnapshot() {
  const digest = createHash("sha256");
  const files = [];
  for (const relativePath of sourceClosurePaths) {
    const bytes = await readFile(path.join(repository, relativePath));
    digest.update(relativePath, "utf8");
    digest.update("\0", "utf8");
    digest.update(String(bytes.length), "utf8");
    digest.update("\0", "utf8");
    digest.update(bytes);
    files.push({ file: relativePath, bytes: bytes.length, sha256: sha256(bytes) });
  }
  return Object.freeze({
    format: "framer-mquickjs-physical-source-closure-v1",
    sha256: digest.digest("hex"),
    files: Object.freeze(files),
  });
}
const hex = (value) => `0x${value.toString(16)}`;
const words = (digest, endian) => Array.from({ length: 8 }, (_, index) =>
  digest[endian === "le" ? "readUInt32LE" : "readUInt32BE"](index * 4));
const wordDefines = (prefix, values) => values.map((value, index) =>
  `-D${prefix}_W${index}=${hex(value)}u`);

const expected = Object.freeze({
  appSha256: "363170139a06f306be1e894b6f203a9bf03bf4d70d21194aaccdd1c42f760c32",
  receiptSha256: "1363d31eabba2b61e068d760d966ab25f8b17d1c635a4c91ba7ecd2a0de238e9",
  packageAbi: "d536c61f83bfb862601af4ea659e32dcc0014ae98e6715b62ff32aae777d6940",
  moduleAbi: "6e3bfee6c3a167f2e06f7f1c7b063e7c2b31977430d6b9303cfbf31a4c51338d",
  moduleAdapterSourceSha256: "f1df175e69d41d1678e386e077011995df29e6f58e1d88235a5f0ac6d2cb89fc",
  // Re-recorded: this is the module-loader's own freshly rebuilt manifest
  // digest, which shifted because the -m32 atom/library word-size fix
  // changed the module-loader build's generated atom header content.
  moduleLoaderManifestSha256: "d78f6763787d07223b811d6cf5071b2f047b866fe8c37819c2f7974b4d93f027",
  // Re-recorded for additive target-facade v5 spriteTween support; the closure
  // includes contract.mjs and the freestanding target_facade.c/h renderer.
  sourceClosureSha256: "6bd160cf9086cfe347b68304769562d33d85edae7d50701f802f2857c98a020c",
  baseSha256: "2f8263490c50631c3cdb7f992efde976ac794d8a3e599cc785a1e81bfa0e5c68",
  canonicalWeatherSourceSha256:
    "68db9d61fa38b0a396e46e88076d75d262a486f2ec4b41b4d398454d7d713e9b",
  canonicalWeatherF2jsSha256:
    "88537026c8b217b763c393b82d8787ca08256681265976f7bcff6077b2282d20",
  // Re-recorded: this is the concatenated-source digest of the canary files
  // this change intentionally edits (see sourceClosureSha256 above); same
  // fix, same new value as module-loader/verify.mjs's expectedCoreCanarySourceSha256.
  engineSourceSha256: "82157e156ba45f0b101d899b18ac77b09fe58e9eeb820dc4cc488e8e57a10406",
  runtimeManifestSha256: "972856d62a7bfda5a1e7fb39f6cab4bcf450c00c34761947651951b43393d305",
  runtimeObjectSha256: "66e336daa9c872f5fa4c396877bdc005e2a316d4194be344fa05cd020b6b37d2",
  residentManifestSha256: "33dc9e0516b288f0c79b25edc8156e946c14942a41428fa503cb503714a552c7",
  residentObjectSha256: "ad5dc93b85ecacbfd0fbc52a18648b44a4ab7ca583971b33bfd1666e46e1055c",
  stockBridgeManifestSha256: "0afdc47b8009010fb59ad1308353945a15fa7f9d4e8812354701bea747b64e28",
  stockBridgeObjectSha256: "0406f9e8341f79d5f6cc602460c1bf405508c5aff4a4be5fa97244beacc4c676",
  acceptedRpcSourceSha256: "9267dfe3819574bfcd407db851d9810739af8f7868bde68bbf037f1bcc91f728",
  setupRegistration: { start: 0x42118c68, end: 0x42118ce0,
    sha256: "62bfdea18af749b67242eb1be51da762200f4cee270e97813d29e77ca10ba643" },
  setupFailureCarrier: { start: 0x42118c7d, end: 0x42118c85,
    sha256: "6b0b76b68b49b5b946db569fc4696b2302228f376bb6ae5f01349d80c925e083" },
  setupTail: { start: 0x42118cdd, end: 0x42118ce0,
    sha256: "c0c1754d826e9af9771d981f3f524a1de1fbc76f24fefeeb689abb7cf7b356f9" },
  keyCallbackLiteral: { start: 0x42041568, end: 0x4204156c,
    sha256: "3d5174006fa28e9caeef531cbcdec7bd1d552b0ab7ad1d4f4a8d30c44c0e1dda" },
  rootGetter: { start: 0x42004e1c, end: 0x42004e48,
    sha256: "8b72f275038854a0dc2888d7d21dc7e145d4e2b7a43610efc678dbc6d145ab16" },
  registryGetter: { start: 0x4210ad9c, end: 0x4210ada3,
    sha256: "5c2697ef878eef8bf9c46c0cde1f3a28a22ff0973a8298a12b8d13c0a86d9076" },
  currentController: { start: 0x4210af48, end: 0x4210af4f,
    sha256: "74a87e9ff6090b9e05988cca6fc9b5185de9ffb44f28712060257e2dea542b16" },
  keyCallback: { start: 0x4206eae0, end: 0x4206eb48,
    sha256: "96316a9091816bf7290c75ebe6be76e4ed184ee13fdef6c50b77e791b5ecfa2b" },
  keyShiftMask: { start: 0x42041550, end: 0x42041554,
    sha256: "6633cfb1c776a95202ce8dd8b6860a41b35686e615252e728f381fe985bd88a9" },
  heapFree: { start: 0x4037e250, end: 0x4037e2a0,
    sha256: "c830d66ccc4cd8d93e006c0ad0623cc880ecb9a96fa21e7e0e5b1583f49bee61" },
  heapMalloc: { start: 0x4037e55c, end: 0x4037e588,
    sha256: "c7ed18e365bd48ebbc416104c4a3cdca5408b938a2ea181657c5bc7bc9405a19" },
  heapFreeSize: { start: 0x420c8200, end: 0x420c822c,
    sha256: "82ec92f10a1d4332fd9a64effc86e97612d429b057db9e6bc32d0de9eee3c972" },
  heapLargest: { start: 0x420c82c4, end: 0x420c82d8,
    sha256: "bac5ed463bc051c397be0412653efa3d42050a6b499c1f7a77bae8ec367709ea" },
  taskCreateStatic: { start: 0x4038e950, end: 0x4038ea40,
    sha256: "2db652699cc573d2efce67c8f311670395fb82660e45b289a050e164809f1ed1" },
  currentTaskForCore: { start: 0x4038eb7c, end: 0x4038eba8,
    sha256: "5e770160138c6036ad010a0caf05503623a529b571f4081568054138039ee4eb" },
  delay: { start: 0x4038dc3c, end: 0x4038dc78,
    sha256: "57bffb5c39a067f9b3ef6ea0a780361636229b18ed9a54982faefe2bf0a59ee7" },
  stackWater: { start: 0x4038daf4, end: 0x4038db10,
    sha256: "0ee8bfcb09f7ccfed3dc70fdcd3c266b54e7f548d910a036fbaeab9097466fe0" },
  time: { start: 0x4037e028, end: 0x4037e040,
    sha256: "75e03adc4a2e9d122f0accb175d4eabbabacf8b20982c9afda3f55f865b3a587" },
  stackScanner: { start: 0x4038ec1c, end: 0x4038ec38,
    sha256: "271d1ad4ca3f3ea4caed6c7aada5d27641d9730e97188e4e68025575a47bc049" },
  navigationGetter: { start: 0x42006888, end: 0x42006898,
    sha256: "2adfd5326addf3fef493d6ab35d1d479836913a1b915e9a4171efe89867acbb5" },
  addController: { start: 0x4204da84, end: 0x4204dae6,
    sha256: "d5867459d9f2b555f4ff4ea92652ff4aea3b6bde69aabbf225b4c9cbb576ac53" },
  baseSlot0LifecycleRoot: { start: 0x4204d611, end: 0x4204d61a,
    sha256: "24fba192588513e1d25b9ee1cd3ba538565d127ae91846d444fcbac24d5e06ca" },
  lvObjectCreate: { start: 0x4209baa8, end: 0x4209babc,
    sha256: "e5691014196987d5e799e6abb9be19387cc1f7490764d22265a88a292de2743f" },
  lvObjectCreateCore: { start: 0x4209c0ec, end: 0x4209c1ac,
    sha256: "d793a5876c5eff13099b8f5b5edd8400b32eb797d75399a18ef7c7c7c1c1785c" },
  lvMallocZero: { start: 0x420ab86c, end: 0x420ab894,
    sha256: "f611775136f65d8ebf6e135013e805917efd17c2924fe2d2bc8e1fa3283703ab" },
  lvMallocPort: { start: 0x420ab768, end: 0x420ab778,
    sha256: "cf0b2dc23d6eced7d67165cc07756c0960678be1c35e8a41aff12bc6b87cf62c" },
  stdlibMallocWrapper: { start: 0x4039266c, end: 0x40392678,
    sha256: "ba2a66805c0d4b182a4735c36399e594b2c2d2ef8ec25bc40d3785a857d4a389" },
  mallocDefault: { start: 0x4037e588, end: 0x4037e5f8,
    sha256: "22b478b01a1397d5ab689ef3afbaf55cb30dafeab97e51f23677293a9e5adc46" },
  mallocDefaultCapsLiteral: { start: 0x40374624, end: 0x40374628,
    sha256: "7655dbd34cf6da46e8b1e7fe8b1647def1bfbfe74dfc7df4956dc20f9d4ebd79" },
  lvClassSizeHelper: { start: 0x4210d880, end: 0x4210d8a0,
    sha256: "a534e09c2e2c60af62e91ab61aa808a9e36a2692e5f7d1c5e054ff74ff981612" },
  lvClassSizeDescriptor: { start: 0x3c1b1e9c, end: 0x3c1b1ea0,
    sha256: "22204591225fcdaaedb9eaf575ccae1142f704b229b723d1359905389a3b8569" },
  psramInternalThresholdInit: { start: 0x420c3964, end: 0x420c39a2,
    sha256: "34f593398f1bd0d9b61fa0930c4313e15dd343fad6d6b370c7a434200250e35b" },
  psramInternalThresholdSetter: { start: 0x420c81c8, end: 0x420c81d2,
    sha256: "e9a060a8814ea4269231dfcbf8a46ea108e776d74f3159da8fc024ee94c62a00" },
  rendererV1Id26: { start: 0x4211956c, end: 0x42119574,
    sha256: "977290e05288793228ad1447885306f8b732edb15acf8a1ee6d671003f899f04" },
  rendererV1Encoder: { start: 0x42119574, end: 0x421195bc,
    sha256: "63aa867737586dd2147d9b51afdb4f847358614fe37bbb201647f877db778f1e" },
  rendererV1Tick: { start: 0x4211960c, end: 0x42119e34,
    sha256: "1a8ab157e36f64cb3b09be5b4ee43172bf86bcdb6486a2139fa8a59ff4c74b2a" },
  rendererV2EncoderPrefix: { start: 0x4211c79c, end: 0x4211c7dc,
    sha256: "a425d3578faca4f1d41eed2d9fc5c1f4511f74aebb8b81017756ec8a0d46be34" },
  rendererV2TickPrefix: { start: 0x4211dc40, end: 0x4211dc80,
    sha256: "2e02b8a56c1554450697c02598eb34ae4ad1b3dca7157470be65cdfcad8b166a" },
  addNavigation: { start: 0x420293a8, end: 0x420293b8,
    sha256: "129929f12eb7726028927fdac27d624df1c0e558873fde489dc49f7d08b47c8c" },
  imageCreate: { start: 0x420ae8a0, end: 0x420ae8b0,
    sha256: "257132ed2e582d49cb814b0e709239b5968badb8a3143a08e5ab324830f260f8" },
  imageSetSource: { start: 0x420aeef0, end: 0x420aef00,
    sha256: "a8fa32979cc2e8239796b00154f07376910b6815f175613d9743cd78d3008d7f" },
  objectAlign: { start: 0x4204f0d0, end: 0x4204f0e0,
    sha256: "77671ad32016ce758110635db0efc813ce0f8fd36b1bc26c052a50918ebc9dac" },
  inputGetter: { start: 0x4200c4c0, end: 0x4200c4d0,
    sha256: "adb65486e8ab001eb981bb5688f0708b7cebb9704e67ad92b2db32ab2f00e0ef" },
  fnPressed: { start: 0x4210bfac, end: 0x4210bfbc,
    sha256: "49e1afb80a907d6d2d8f5be592b842c068d324195e96f50e83ae72d9c2277c29" },
  rpcRegistry: { start: 0x42004afc, end: 0x42004b28,
    sha256: "5f5af85220d6da8255e7f679343e6866b991a6baa521c20e2df97dd9355085db" },
  rpcRegister: { start: 0x4211b7c8, end: 0x4211b7f4,
    sha256: "ad44433930c1e66f7b42e74acdc08f15b5465bec8e7a61d05cf71c4fca344c4a" },
  rpcReadInteger: { start: 0x4211ba2c, end: 0x4211ba58,
    sha256: "e2d725c23ddb82ed50e81e9cf5c2cae8ab65abd0886f37642a46f741a291a2dd" },
  rpcReplyStatus: { start: 0x4211ba58, end: 0x4211bac8,
    sha256: "b32c2c68bfdac4bf3dc7e6e192b2276b2271655daf477eeb24a2f084762a14fc" },
  rpcMakeRoot: { start: 0x4211bac8, end: 0x4211bae4,
    sha256: "24f9f56110864f03db34bbaafc7711adfc6529194cd021198f5d6143f294be04" },
  rpcDestroyRoot: { start: 0x42004f80, end: 0x42004f90,
    sha256: "a1d36c472aedcb81ce712e72b68990e849083140d8a20158c1262a3f4e54b2bb" },
  acceptedRpcCapHandler: { start: 0x4211bae4, end: 0x4211bb20,
    sha256: "eaec889034abd2e9b0d16a7db9caa59a2b99679acc811086ec50a734ab597998" },
  acceptedRpcStatusHandler: { start: 0x4211bb20, end: 0x4211bb5c,
    sha256: "113e0ecfd1514b18435335d3590f4834c0edc36ccaf2952a0418890585ed6286" },
  mmuMap: { start: 0x420f539c, end: 0x420f5772,
    sha256: "cbd61aaf9138bb59e94d50780ee4b5a53ec315cd347eee341e7f1514b07aeab5" },
  mmuUnmap: { start: 0x420f5774, end: 0x420f58a2,
    sha256: "a397751ec73aacb36858a2ab98f72503d57e4d9fbb7ca03d7968e54e6ac62163" },
  baseVtable: { start: 0x3c1acc34, end: 0x3c1acc44,
    sha256: "c9128709a6bfab7a00768221964b9af618a643239186be59a3a805431cff239e" },
  baseSlot0: { start: 0x4204d5dc, end: 0x4204d66a,
    sha256: "311d09653ead24d5347ac8cdb61ac3f0aaf73aac2ba35f97a1e87c57fa42e376" },
  baseSlot2: { start: 0x4204d694, end: 0x4204d6a4,
    sha256: "fdc14bd0007f364b98558243b25de974cbe49f423a5d9a39ecc15ea1523e0311" },
  baseSlot3: { start: 0x4210882c, end: 0x42108833,
    sha256: "1d55eacbff229f5f1ecc43d1a709e81f6b2b774b0b99497bccd2ae87f2311cfb" },
  baseSlot5: { start: 0x4204d6d0, end: 0x4204d6e0,
    sha256: "a76ceef5110151dd806c8494d461f74a8199318fd9a78905127fd737a4379e34" },
  baseSlot7: { start: 0x42108834, end: 0x4210883b,
    sha256: "1d55eacbff229f5f1ecc43d1a709e81f6b2b774b0b99497bccd2ae87f2311cfb" },
  baseSlot10: { start: 0x42108844, end: 0x4210884b,
    sha256: "1d55eacbff229f5f1ecc43d1a709e81f6b2b774b0b99497bccd2ae87f2311cfb" },
  acceptedId27SourceSha256:
    "7183c79aabdb2c60a2992608a2ac187a721a2ec2e587123ff64b498be8cceafe",
});

const layout = Object.freeze({
  textPaddr: 0x210000, textVaddr: 0x423d0000, textBytes: 0x20000,
  rodataPaddr: 0x230000, rodataVaddr: 0x3c3f0000, rodataBytes: 0x10000,
  slotEnd: 0x240000, factoryEnd: 0x810000,
  loaderVaddr: 0x4211e460, loaderEnd: 0x4211ff18,
  setupTail: 0x42118cdd, keyLiteral: 0x42041568,
});

const requiredAcceptedAddresses = Object.freeze([
  0x40374624, 0x4037e028, 0x4037e250, 0x4037e55c, 0x4037e588,
  0x4038daf4, 0x4038dc3c, 0x4039266c,
  0x4038e950, 0x4038eb7c, 0x42004afc, 0x42004e1c, 0x42004f80,
  0x42006888, 0x4200c4c0, 0x420293a8, 0x4204d5dc, 0x4204d694,
  0x4204d611, 0x4204d6d0, 0x4204da84, 0x4204f0d0, 0x4206eae0,
  0x4209baa8, 0x4209c0ec, 0x420ab768, 0x420ab86c, 0x420ae8a0,
  0x420aeef0, 0x420c3964, 0x420c81c8, 0x420c8200, 0x420c82c4,
  0x420f539c, 0x420f5774,
  0x4210882c, 0x42108834, 0x42108844, 0x4210ad9c, 0x4210af48,
  0x4210bfac, 0x42118c7d, 0x4211956c, 0x42119574, 0x4211960c,
  0x4211b7c8, 0x4211ba2c, 0x4211ba58, 0x4211bac8, 0x4211c79c,
  0x4210d880, 0x4211dc40,
  0x3c1acc34, 0x3c1b1e9c,
]);

function readVirtual(image, start, end) {
  const segment = image.segments.find((item) => start >= item.loadAddress &&
    end <= item.loadAddress + item.length);
  invariant(segment, `No segment contains ${hex(start)}..${hex(end)}.`);
  return segment.data.subarray(start - segment.loadAddress, end - segment.loadAddress);
}

async function proveAcceptedPublicationSemantics(image, directory) {
  async function disassemble(name, pin) {
    const file = path.join(directory, `${name}.bin`);
    await writeFile(file, readVirtual(image, pin.start, pin.end));
    return (await run(xtensa("objdump"), ["-D", "-b", "binary", "-m", "xtensa",
      `--adjust-vma=${hex(pin.start)}`, file])).stdout;
  }
  const [addController, baseSlot0, setupCarrier] = await Promise.all([
    disassemble("accepted-add-controller", expected.addController),
    disassemble("accepted-base-slot0", expected.baseSlot0),
    disassemble("accepted-setup-carrier", expected.setupFailureCarrier),
  ]);
  invariant(/4204dae2:\s+2953\s+s32i\.n\s+a2,\s*a3,\s*20\b/u.test(addController) &&
    !/s32i(?:\.n)?\s+[^,]+,\s*a3,\s*12\b/u.test(addController),
  "addController no longer owns only registry+20.");
  invariant(/4204d618:\s+a932\s+s32i\.n\s+a10,\s*a2,\s*12\b/u.test(baseSlot0),
    "Common base slot0 no longer owns lifecycle root+12.");
  invariant(/42118c80:.*beqz\s+a10,\s*0x42118cdd\b/u.test(setupCarrier) &&
    /42118c83:.*mov\.n\s+a6,\s*a10\b/u.test(setupCarrier),
  "Setup failure can no longer reach the patched tail before a6 assignment.");
  return {
    registrationOwnership: "addController-only-store-registry-plus20-no-root-plus12",
    lifecycleOwnership: "base-slot0-store-produced-root-plus12-before-build",
    setupCarrierHazard: "failure-branch-reaches-tail-before-a6-assignment",
  };
}

function encodeLzss(bytes) {
  const outputBytes = [];
  let cursor = 0;
  while (cursor < bytes.length) {
    const flagsAt = outputBytes.length;
    outputBytes.push(0);
    let flags = 0;
    for (let bit = 0; bit < 8 && cursor < bytes.length; bit++) {
      let bestLength = 0;
      let bestDistance = 0;
      const first = Math.max(0, cursor - 1024);
      for (let candidate = cursor - 1; candidate >= first; candidate--) {
        if (bytes[candidate] !== bytes[cursor]) continue;
        let length = 1;
        while (length < 66 && cursor + length < bytes.length &&
          bytes[candidate + length] === bytes[cursor + length]) length++;
        if (length >= 3 && length > bestLength) {
          bestLength = length; bestDistance = cursor - candidate;
          if (length === 66) break;
        }
      }
      if (bestLength >= 3) {
        flags |= 1 << bit;
        const code = ((bestLength - 3) << 10) | (bestDistance - 1);
        outputBytes.push(code & 0xff, code >>> 8); cursor += bestLength;
      } else outputBytes.push(bytes[cursor++]);
    }
    outputBytes[flagsAt] = flags;
  }
  return Buffer.from(outputBytes);
}

function decodeLzss(bytes, outputBytes) {
  const decoded = Buffer.alloc(outputBytes);
  let source = 0; let destination = 0;
  while (destination < decoded.length) {
    invariant(source < bytes.length, "LZSS flags overrun.");
    const flags = bytes[source++];
    for (let bit = 1; bit <= 0x80 && destination < decoded.length; bit <<= 1) {
      if ((flags & bit) === 0) decoded[destination++] = bytes[source++];
      else {
        const code = bytes.readUInt16LE(source); source += 2;
        const distance = (code & 1023) + 1; const length = (code >>> 10) + 3;
        invariant(distance <= destination && length <= decoded.length - destination,
          "LZSS match escaped output.");
        for (let index = 0; index < length; index++) {
          decoded[destination] = decoded[destination - distance]; destination++;
        }
      }
    }
  }
  invariant(source === bytes.length, "LZSS trailing bytes.");
  return decoded;
}

const INTERACTION_SOURCE = `

var canaryTick100 = 0;

function canaryInteraction(event) {
  syncState();
  stateFlags = stateFlags | 4;
  retrySeconds = 20;
  publish(0);
}

function canaryRelease(event) {
  if (event.synthetic && event.reason !== 1) throw 1;
  canaryInteraction(event);
}

widget.on("input.fn-bottom-knob", canaryInteraction);
widget.on("input.key.down", canaryInteraction);
widget.on("input.key.up", canaryRelease);
widget.on("input.key.hold", canaryInteraction);
widget.on("input.chord.down", canaryInteraction);
widget.on("input.chord.up", canaryRelease);
widget.on("tick.100ms", function (event) {
  canaryTick100 = (canaryTick100 + 1) | 0;
});
`;

async function buildAssets(directory) {
  const [weatherSource, base] = await Promise.all([
    readFile(path.join(weather, "weather-widget.js"), "utf8"), readFile(basePath),
  ]);
  invariant(base.length === 62000 && sha256(base) === expected.baseSha256,
    "Weather base identity changed.");
  invariant(sha256(Buffer.from(weatherSource)) ===
      expected.canonicalWeatherSourceSha256 &&
    sha256(await readFile(path.join(weather, "build/weather-60601.f2js"))) ===
      expected.canonicalWeatherF2jsSha256,
  "Canonical recovery-aware weather source/package identity changed.");
  const faultNeedle = 'widget.on("host.rpc:0xB24D", function (event) {\n';
  const faultBody = `${faultNeedle}` +
    `  if (event.value === -2147483648 && event.auxiliary === 1414090053) {\n` +
    `    while (1) {}\n` +
    `  }\n` +
    `  if (event.value === -2147483647 && event.auxiliary === 1330597153) {\n` +
    `    var canaryOom = "OOM!";\n` +
    `    while (1) canaryOom = canaryOom + canaryOom;\n` +
    `  }\n`;
  const weatherWithFaultCanary = weatherSource.replace(faultNeedle, faultBody);
  invariant(weatherWithFaultCanary !== weatherSource,
    "Weather provider-status handler fault seam changed.");
  const source = `${weatherWithFaultCanary.trimEnd()}${INTERACTION_SOURCE}`;
  const handlerCount = source.match(/\bwidget\.on\s*\(/gu)?.length ?? 0;
  invariant(handlerCount === 16, `Physical source must register exactly 16 handlers, got ${handlerCount}.`);
  const packageValue = buildRenderV2MQuickJsPackage({
    source, generation: 19,
    events: { "tick.1s": true, "tick.100ms": true,
      "input.fn-bottom-knob": true,
      hostRpcIds: requiredWeatherCanaryHostRpcIds(),
      keys: [{ id: 0, nativeToken: 0x2c }, { id: 1, nativeToken: 0xe1 }],
      chords: [{ id: 0, heldMask: 3 }] },
    input: { debounceMs: 10, holdDelayMs: 500, holdCadenceMs: 100 },
    targets: WEATHER_MQUICKJS_TARGETS,
  });
  const decodedPackage = decodeRenderV2MQuickJsPackage(packageValue.binary);
  invariant(decodedPackage.generation === 19 &&
    (decodedPackage.rasterBase?.length ?? 0) === 0 &&
    decodedPackage.events.length === 14 && decodedPackage.input.keyCount === 2 &&
    decodedPackage.input.chordCount === 1,
  `Physical weather package declarations changed: events=${decodedPackage.events.length} ` +
    `keys=${decodedPackage.input.keyCount} chords=${decodedPackage.input.chordCount}.`);
  invariant(decodedPackage.targets.map(({ id }) => id).join("\0") ===
    WEATHER_TARGET_FACADE_TARGETS.map(({ id }) => id).join("\0"),
  "Physical target IDs differ from F2TF.");
  const frame = new Uint16Array(base.buffer, base.byteOffset, base.length / 2);
  const facade = buildWeatherTargetFacadeAsset({ generation: 19,
    baseFrame: frame, f2jsBinary: packageValue.binary });
  decodeTargetFacadeAsset(facade.binary, { expectedGeneration: 19,
    expectedF2jsSha256: facade.f2jsSha256, baseFrame: frame });
  const compressed = encodeLzss(base);
  invariant(decodeLzss(compressed, base.length).equals(base),
    "Physical weather base LZSS did not round-trip.");
  const paths = {
    f2js: path.join(directory, "weather-id28-gen19.f2js"),
    f2tf: path.join(directory, "weather-id28-gen19.f2tf"),
    base: path.join(directory, "weather-id28-base.rgb565le"),
    compressed: path.join(directory, "weather-id28-base.lzss"),
    f2jsSha: path.join(directory, "weather-id28-f2js.sha256.bin"),
    contractSha: path.join(directory, "target-contract.sha256.bin"),
    source: path.join(directory, "weather-id28-gen19.js"),
  };
  await Promise.all([
    writeFile(paths.f2js, packageValue.binary), writeFile(paths.f2tf, facade.binary),
    writeFile(paths.base, base), writeFile(paths.compressed, compressed),
    writeFile(paths.f2jsSha, Buffer.from(packageValue.sha256, "hex")),
    writeFile(paths.contractSha, Buffer.from(TARGET_FACADE_CONTRACT_SHA256, "hex")),
    writeFile(paths.source, source),
  ]);
  return { packageValue, decodedPackage, facade, compressed, base, paths,
    sourceSha256: sha256(Buffer.from(source)), handlerCount };
}

async function exactSourceHostProof(directory, assets) {
  const build = path.join(directory, "exact-source-host");
  await mkdir(build);
  await generator(build, false);
  const common = ["-std=c11", "-w",
    "-DFRAMER_RUNTIME_PROOF_EXACT_ABI_ACK=0x36317013u",
    `-I${build}`, `-I${canary}`, `-I${vendor}`,
    path.join(canary, "framer_mquickjs_canary.c"), path.join(vendor, "dtoa.c"),
    path.join(vendor, "libm.c"), path.join(vendor, "cutils.c"),
    path.join(runtimeProof, "runtime_proof.c"),
    path.join(here, "physical_host_harness.c"), "-lm"];
  const normal = path.join(build, "physical-host");
  await run(cc, ["-O2", ...common, "-o", normal]);
  const normalResult = JSON.parse((await run(normal, [assets.paths.source])).stdout);
  invariant(normalResult.status === "PASS_EXACT_PHYSICAL_SOURCE" &&
    normalResult.timeouts === 1 && normalResult.oom === 1 &&
    normalResult.keyDown >= 2 && normalResult.keyUp >= 2 &&
    normalResult.keyHold >= 1 && normalResult.chordDown >= 1 &&
    normalResult.chordUp >= 1, "Exact final source host proof changed.");
  const moving = path.join(build, "physical-host-moving-asan");
  await run(cc, ["-O1", "-g", "-DDEBUG_GC", "-fsanitize=address",
    "-fno-omit-frame-pointer", ...common, "-o", moving]);
  const movingResult = JSON.parse((await run(moving, [assets.paths.source], {
    env: { ...process.env, ASAN_OPTIONS: "halt_on_error=1" },
  })).stdout);
  invariant(movingResult.status === "PASS_EXACT_PHYSICAL_SOURCE" &&
    movingResult.timeouts === 1 && movingResult.oom === 1,
  "Exact final source moving-GC/ASan proof changed.");
  return { normal: normalResult, movingGcAsan: movingResult };
}

const crossFlags = ["-std=c11", "-Os", "-DNDEBUG", "-fno-builtin",
  "-fno-stack-protector", "-fno-unwind-tables", "-fno-asynchronous-unwind-tables",
  "-ffunction-sections", "-fdata-sections", "-mlongcalls", "-mtext-section-literals",
  "-fstack-usage"];

async function compile(source, destination, includes = [], extra = []) {
  await run(xtensa("gcc"), [...crossFlags, ...extra,
    ...includes.map((item) => `-I${item}`), "-c", source, "-o", destination]);
}

async function readStackUsage(directory) {
  const records = [];
  for (const name of (await readdir(directory)).filter((value) => value.endsWith(".su")).sort()) {
    const text = await readFile(path.join(directory, name), "utf8");
    for (const line of text.trim().split(/\n/u)) {
      const match = /:([A-Za-z0-9_.$]+)\t([0-9]+)\t([^\t]+)$/u.exec(line);
      if (!match) continue;
      records.push({ object: name.replace(/\.su$/u, ".o"), function: match[1],
        bytes: Number.parseInt(match[2], 10), kind: match[3] });
    }
  }
  return records;
}

function stackFrame(records, object, functionName) {
  const record = records.find((item) => item.object === object &&
    item.function === functionName);
  invariant(record, `Missing stack-usage record ${object}:${functionName}.`);
  return record.bytes;
}

function proveStackUsage(records) {
  const frame = (object, functionName) => stackFrame(records, object, functionName);
  const callback = frame("physical.o", "rpc_callback_common");
  const shim = 32;
  const chains = {
    cap: frame("physical.o", "rpc_cap_callback") + callback +
      frame("physical.o", "rpc_cap_handler") +
      frame("physical.o", "rpc_read_page") + shim,
    telemetry: frame("physical.o", "rpc_telemetry_callback") + callback +
      frame("physical.o", "rpc_telemetry_handler") +
      frame("physical.o", "rpc_read_page") + shim,
    event: frame("physical.o", "rpc_event_callback") + callback +
      frame("physical.o", "rpc_event_handler") +
      frame("resident.o", "framer_resident_owner_enqueue_host_rpc_tagged") +
      frame("resident.o", "owner_enqueue_admitted") +
      frame("resident.o", "zero_bytes"),
    receipt: frame("physical.o", "rpc_receipt_callback") + callback +
      frame("physical.o", "rpc_receipt_handler") +
      frame("runtime-proof.o", "framer_runtime_receipt_format"),
  };
  const maximum = Math.max(...Object.values(chains));
  invariant(shim === 32 && chains.cap === 240 && chains.telemetry === 256 &&
    chains.event === 336 && chains.receipt === 192 && maximum <= 384,
  `RPC callback stack non-regression changed: ${JSON.stringify(chains)}.`);
  const uiModuleChainBytes = frame("physical.o", "proxy_tick") +
    frame("target.o", "framer_tf_render_at") +
    frame("target.o", "render_internal") +
    frame("target.o", "target_pixels") + frame("target.o", "glyph_index");
  // V5 interpolation adds 80 static bytes to render_internal. The physical
  // integration calls render_at directly; do not count the compatibility
  // wrapper that is not on this callback path.
  invariant(uiModuleChainBytes === 928,
    `UI module callback chain changed: ${uiModuleChainBytes}.`);
  return { compilerFlag: "-fstack-usage", allFramesStatic: true,
    rpc: { chains, maximumModuleOwnedChainBytes: maximum,
      acceptedSceneHandlerModuleFrameCeilingBytes: 384,
      comparator: "relative accepted-app non-regression; not absolute task headroom",
      asmReadIntegerFrameBytes: shim },
    ui: { moduleOwnedRenderChainBytes: uiModuleChainBytes,
      physicalHeadroomClaimed: false } };
}

async function generator(directory, targetWordSize = true) {
  const executable = path.join(directory, "framer-stdlib-gen");
  await run(cc, ["-std=c11", "-O2", `-I${vendor}`, path.join(canary, "framer_stdlib_gen.c"),
    path.join(vendor, "mquickjs_build.c"), "-o", executable]);
  // mquickjs_atom.h word offsets must be generated at the same word size as
  // the library it is paired with (host with host, -m32/target with -m32),
  // or JS_ATOM_* offsets no longer match the ROM table layout.
  const [atoms, library] = await Promise.all([
    run(executable, targetWordSize ? ["-m32", "-a"] : ["-a"]),
    run(executable, targetWordSize ? ["-m32"] : []),
  ]);
  await Promise.all([
    writeFile(path.join(directory, "mquickjs_atom.h"), atoms.stdout),
    writeFile(path.join(directory, "framer_stdlib.h"), library.stdout),
  ]);
}

function sectionTable(text) {
  return Object.fromEntries([...text.matchAll(
    /^\s*\d+\s+(\.[^\s]+)\s+([0-9a-f]+)\s+([0-9a-f]+)/gmu,
  )].map((match) => [match[1], { bytes: Number.parseInt(match[2], 16),
    vaddr: Number.parseInt(match[3], 16) }]));
}

function symbolAddress(text, name) {
  const match = new RegExp(`^([0-9a-f]+)\\s+[A-Za-z]\\s+${name}$`, "mu").exec(text);
  invariant(match, `Missing symbol ${name}.`);
  return Number.parseInt(match[1], 16);
}

function disassembledFunction(text, name) {
  const start = text.indexOf(`<${name}>:`);
  invariant(start >= 0, `Missing disassembly for ${name}.`);
  const tail = text.slice(start);
  const next = /\n[0-9a-f]+\s+<[^>]+>:/u.exec(tail.slice(1));
  return next ? tail.slice(0, next.index + 1) : tail;
}

function proveLoaderAdmissionOrdering(loaderBuild) {
  const body = disassembledFunction(loaderBuild.disassembly,
    "framer_physical_loader_start");
  const backend = body.indexOf("<framer_physical_backend_validate>");
  const rejectBranch = body.indexOf("beqz", backend);
  const freeQuery = body.indexOf("420c8200", rejectBranch);
  const mallocCall = body.indexOf("4037e55c", freeQuery);
  const firstMap = body.indexOf("<framer_mqjs_map_canary>", mallocCall);
  invariant(backend >= 0 && rejectBranch > backend && freeQuery > rejectBranch &&
    mallocCall > freeQuery && firstMap > mallocCall,
  "Backend carrier validation no longer dominates heap query/allocation/first MMU map.");
  return {
    validator: "framer_physical_backend_validate",
    invalidCarrierEffect: "return-before-heap-query-allocation-or-map",
    order: ["backendValidate", "rejectBranch", "heapFreeQuery", "mallocExactBlock",
      "firstMmuMap"],
  };
}

function provePhysicalSourceOrdering(source) {
  const between = (start, end) => {
    const first = source.indexOf(start);
    const last = source.indexOf(end, first + start.length);
    invariant(first >= 0 && last > first, `Missing physical source seam ${start}.`);
    return source.slice(first, last);
  };
  const startup = between("int framer_physical_module_startup(", "\n}");
  const registration = startup.indexOf("framer_physical_registration_matches(");
  const addNavigation = startup.indexOf("STOCK_ADD_NAVIGATION", registration);
  const navigationPublished = startup.indexOf("&block->navigation_published",
    addNavigation);
  const bootReady = startup.indexOf("&block->boot_state, 7u", navigationPublished);
  const rpcReady = startup.indexOf("&block->rpc_ready, 1u", bootReady);
  invariant(registration >= 0 && addNavigation > registration &&
    navigationPublished > addNavigation && bootReady > navigationPublished &&
    rpcReady > bootReady,
  "Registry postcondition -> navigation -> publication -> boot7 -> RPC-ready order changed.");
  const cleanup = between("static void proxy_cleanup(",
    "__attribute__((used, visibility(\"default\")))\nuint32_t framer_physical_weather_id");
  invariant(cleanup.indexOf("&proxy->block->visible, 0u") >= 0 &&
    cleanup.indexOf("&proxy->block->input_enabled, 0u") >= 0 &&
    cleanup.indexOf("&proxy->block->focus_release_requested") >= 0 &&
    !cleanup.includes("framer_resident_owner_release_all") &&
    !cleanup.includes("framer_mqjs_input_request_release_all"),
  "Screen cleanup regressed to a terminal or ungated input release.");
  const finish = between("static void owner_finish_focus_release(",
    "static void owner_task(");
  invariant(finish.includes("&block->owner.input_pending") &&
    finish.includes("telemetry.pending_input_events") &&
    finish.includes("telemetry.held_key_mask") &&
    finish.includes("&block->owner.input_poll_scheduled"),
  "Focus ACK no longer gates resident+engine drain and stale poll retirement.");
  invariant(source.includes(
      "__atomic_load_n(&block->task_handle, __ATOMIC_ACQUIRE)") &&
    source.includes(
      "__atomic_store_n(&block->task_handle, created_task, __ATOMIC_RELEASE)"),
  "Owner task-handle publication is no longer acquire/release synchronized.");
  return {
    publicationOrder: "registry-postcondition-addNavigation-navPublished-boot7-rpcReady",
    focusCleanup: "nonterminal-seq-cst-gate-epoch-owner-drain",
    focusAck: "resident-inputPending-zero-engine-pending-zero-held-zero-poll-cleared",
    taskHandlePublication: "setup-release-store-owner-acquire-load-null-safe",
  };
}

async function buildModule(directory, assets, label) {
  const build = path.join(directory, label); await mkdir(build);
  await generator(build);
  const includes = [build, canary, vendor, resident, target, runtimeProof, here];
  const abiWords = words(Buffer.from(expected.moduleAbi, "hex"), "le");
  const sources = [
    [path.join(canary, "framer_mquickjs_canary.c"), "runtime.o", []],
    [path.join(loader, "module_adapter.c"), "adapter.o",
      wordDefines("FRAMER_MQJS_ABI_SHA256", abiWords)],
    [path.join(vendor, "dtoa.c"), "dtoa.o", []],
    [path.join(vendor, "libm.c"), "libm.o", ["-UNDEBUG"]],
    [path.join(vendor, "cutils.c"), "cutils.o", []],
    [path.join(resident, "f2js_admission.c"), "f2js.o", []],
    [path.join(resident, "resident_integration.c"), "resident.o", []],
    [path.join(target, "target_facade.c"), "target.o", []],
    [path.join(runtimeProof, "runtime_proof.c"), "runtime-proof.o",
      ["-DFRAMER_RUNTIME_PROOF_EXACT_ABI_ACK=0x36317013u"]],
    [path.join(here, "physical_integration.c"), "physical.o",
      ["-DFRAMER_RUNTIME_PROOF_EXACT_ABI_ACK=0x36317013u"]],
  ];
  const objects = [];
  for (const [source, name, extra] of sources) {
    const object = path.join(build, name); await compile(source, object, includes, extra);
    objects.push(object);
  }
  const rpcShim = path.join(build, "rpc-shims.o");
  await run(xtensa("gcc"), ["-c", path.join(here, "rpc_shims.S"), "-o", rpcShim]);
  objects.push(rpcShim);
  const assetAssembly = path.join(build, "assets.S");
  const assetObject = path.join(build, "assets.o");
  const entry = (symbol, file) => `.global ${symbol}_start\n${symbol}_start:\n` +
    `.incbin ${JSON.stringify(file)}\n.global ${symbol}_end\n${symbol}_end:\n`;
  await writeFile(assetAssembly,
    `.section .rodata.physical_assets,"a",@progbits\n.balign 16\n` +
    entry("framer_physical_weather_f2js", assets.paths.f2js) + `.balign 16\n` +
    entry("framer_physical_weather_f2tf", assets.paths.f2tf) + `.balign 16\n` +
    entry("framer_physical_weather_base_lzss", assets.paths.compressed) + `.balign 16\n` +
    `.global framer_physical_weather_f2js_sha256\nframer_physical_weather_f2js_sha256:\n` +
    `.incbin ${JSON.stringify(assets.paths.f2jsSha)}\n.balign 16\n` +
    `.global framer_physical_target_contract_sha256\nframer_physical_target_contract_sha256:\n` +
    `.incbin ${JSON.stringify(assets.paths.contractSha)}\n`);
  await run(xtensa("gcc"), ["-c", assetAssembly, "-o", assetObject]); objects.push(assetObject);
  const elf = path.join(build, "module.elf"); const map = path.join(build, "module.map");
  await run(xtensa("gcc"), ["-nostartfiles", "-specs=nosys.specs", "-Wl,--gc-sections",
    `-Wl,-T,${path.join(here, "module.ld")}`, `-Wl,-Map,${map}`, "-o", elf,
    ...objects, "-lm"]);
  const [headers, relocations, undefineds, symbols, disassembly] = await Promise.all([
    run(xtensa("objdump"), ["-h", elf]), run(xtensa("readelf"), ["-r", elf]),
    run(xtensa("nm"), ["-u", elf]), run(xtensa("nm"), ["-n", elf]),
    run(xtensa("objdump"), ["-d", elf]),
  ]);
  invariant(/There are no relocations/u.test(relocations.stdout) && !undefineds.stdout.trim(),
    "Physical module retained relocation/undefined state.");
  const sections = sectionTable(headers.stdout);
  invariant(sections[".text"]?.vaddr === layout.textVaddr &&
    sections[".text"].bytes <= layout.textBytes &&
    sections[".rodata"]?.vaddr === layout.rodataVaddr &&
    sections[".rodata"].bytes <= layout.rodataBytes &&
    (sections[".data"]?.bytes ?? 0) === 0 && (sections[".bss"]?.bytes ?? 0) === 0,
  "Physical module section placement changed.");
  const text = path.join(build, "text-page.bin");
  const rodata = path.join(build, "rodata-page.bin");
  await Promise.all([
    run(xtensa("objcopy"), ["-O", "binary", "-j", ".text", "--gap-fill=0x00",
      `--pad-to=${hex(layout.textVaddr + layout.textBytes)}`, elf, text]),
    run(xtensa("objcopy"), ["-O", "binary", "-j", ".rodata", "--gap-fill=0x00",
      `--pad-to=${hex(layout.rodataVaddr + layout.rodataBytes)}`, elf, rodata]),
  ]);
  const [textBytes, rodataBytes] = await Promise.all([readFile(text), readFile(rodata)]);
  invariant(textBytes.length === layout.textBytes && rodataBytes.length === layout.rodataBytes,
    "Physical module padded page length changed.");
  const stackUsage = await readStackUsage(build);
  invariant(stackUsage.length > 0 && stackUsage.every((item) => item.kind === "static"),
    "Physical module stack usage is missing or dynamic.");
  const descriptor = symbolAddress(symbols.stdout, "framer_mqjs_module") -
    layout.rodataVaddr;
  invariant(descriptor >= 0 && descriptor + 68 <= rodataBytes.length &&
    rodataBytes.readUInt16LE(descriptor + 4) === 3 &&
    rodataBytes.readUInt16LE(descriptor + 6) === 116 &&
    rodataBytes.subarray(descriptor + 36, descriptor + 68).toString("hex") ===
      expected.moduleAbi &&
    rodataBytes.subarray(descriptor + 36, descriptor + 68).toString("hex") !==
      expected.packageAbi,
  "Physical descriptor does not carry the distinct ABI3 module identity.");
  return { elf, map, text, rodata, textBytes, rodataBytes, sections,
    symbols: symbols.stdout, disassembly: disassembly.stdout, stackUsage,
    startup: symbolAddress(symbols.stdout, "framer_physical_module_startup"),
    id: symbolAddress(symbols.stdout, "framer_physical_weather_id"),
    keySink: symbolAddress(symbols.stdout, "framer_physical_key_after_stock"),
    blockBytes: rodataBytes.readUInt32LE(
      symbolAddress(symbols.stdout, "framer_physical_block_allocation_bytes") -
      layout.rodataVaddr) };
}

async function buildLoader(directory, module, label) {
  const build = path.join(directory, label); await mkdir(build);
  const textDigest = shaBytes(module.textBytes); const rodataDigest = shaBytes(module.rodataBytes);
  const slotDigest = shaBytes(Buffer.concat([module.textBytes, module.rodataBytes]));
  const header = await readFile(path.join(canary, "framer_mquickjs_canary.h"), "utf8");
  const runtimeBytes = Number(/FRAMER_MQJS_RUNTIME_STORAGE_BYTES\s+(\d+)u/u.exec(header)[1]);
  const heapBytes = Number(/FRAMER_MQJS_MIN_HEAP_BYTES\s+(\d+)u/u.exec(header)[1]);
  const abiWords = words(Buffer.from(expected.moduleAbi, "hex"), "le");
  const common = ["-fno-jump-tables", "-fno-builtin", "-fno-tree-loop-distribute-patterns"];
  const loaderObject = path.join(build, "resident-loader.o");
  await compile(path.join(loader, "resident_loader_canary.c"), loaderObject, [loader], [
    ...common, `-DFRAMER_MODULE_RUNTIME_STORAGE_BYTES=${runtimeBytes}u`,
    `-DFRAMER_MODULE_MIN_HEAP_BYTES=${heapBytes}u`,
    `-DFRAMER_MODULE_TEXT_USED_BYTES=${module.sections[".text"].bytes}u`,
    ...wordDefines("FRAMER_MODULE_TEXT_SHA256", words(textDigest, "be")),
    ...wordDefines("FRAMER_MODULE_RODATA_SHA256", words(rodataDigest, "be")),
    ...wordDefines("FRAMER_MQJS_ABI_SHA256", abiWords),
  ]);
  const entryObject = path.join(build, "loader-entry.o");
  const keyObject = path.join(build, "key-wrapper.o");
  const tailObject = path.join(build, "tail.o");
  await Promise.all([
    compile(path.join(here, "loader_entry.c"), entryObject, [loader],
      [...common, `-DFRAMER_PHYSICAL_STARTUP_VADDR=${hex(module.startup)}u`,
        `-DFRAMER_PHYSICAL_BLOCK_BYTES=${module.blockBytes}u`,
        ...wordDefines("FRAMER_PHYSICAL_MODULE_SHA256", words(slotDigest, "le"))]),
    compile(path.join(here, "key_wrapper.c"), keyObject, [], [...common,
      `-DFRAMER_PHYSICAL_ID_VADDR=${hex(module.id)}u`,
      `-DFRAMER_PHYSICAL_KEY_SINK_VADDR=${hex(module.keySink)}u`]),
    run(xtensa("gcc"), ["-c", path.join(here, "tail_trampoline.S"), "-o", tailObject]),
  ]);
  const elf = path.join(build, "resident-loader.elf");
  await run(xtensa("gcc"), ["-nostdlib", "-Wl,--gc-sections",
    `-Wl,-T,${path.join(here, "loader.ld")}`, "-o", elf,
    tailObject, entryObject, keyObject, loaderObject, "-lgcc"]);
  const [headers, relocations, undefineds, symbols, disassembly] = await Promise.all([
    run(xtensa("objdump"), ["-h", elf]), run(xtensa("readelf"), ["-r", elf]),
    run(xtensa("nm"), ["-u", elf]), run(xtensa("nm"), ["-n", elf]),
    run(xtensa("objdump"), ["-d", elf]),
  ]);
  invariant(/There are no relocations/u.test(relocations.stdout) && !undefineds.stdout.trim(),
    "Resident loader retained relocation/undefined state.");
  const sections = sectionTable(headers.stdout);
  invariant(sections[".text"]?.vaddr === layout.loaderVaddr &&
    sections[".text"].bytes <= layout.loaderEnd - layout.loaderVaddr,
  "Resident loader escaped accepted zero tail.");
  const raw = path.join(build, "resident-loader.bin");
  await run(xtensa("objcopy"), ["-O", "binary", "-j", ".text", elf, raw]);
  const rawBytes = await readFile(raw);
  return { elf, raw, rawBytes, sections, symbols: symbols.stdout,
    disassembly: disassembly.stdout,
    tail: symbolAddress(symbols.stdout, "framer_physical_tail_trampoline"),
    keyWrapper: symbolAddress(symbols.stdout, "framer_physical_key_wrapper") };
}

async function jumpPatch(directory, tailAddress) {
  const source = path.join(directory, "jump.S"); const object = path.join(directory, "jump.o");
  const linker = path.join(directory, "jump.ld"); const elf = path.join(directory, "jump.elf");
  const raw = path.join(directory, "jump.bin");
  await Promise.all([
    writeFile(source, `.section .text.patch,"ax",@progbits\n.global patch\npatch:\n` +
      `j ${hex(tailAddress)}\n`),
    writeFile(linker, `SECTIONS { .text.patch ${hex(layout.setupTail)} : { *(.text.patch) } }\n`),
  ]);
  await run(xtensa("gcc"), ["-c", source, "-o", object]);
  await run(xtensa("ld"), ["-T", linker, object, "-o", elf]);
  await run(xtensa("objcopy"), ["-O", "binary", "-j", ".text.patch", elf, raw]);
  const bytes = await readFile(raw); invariant(bytes.length === 3, "Setup jump is not three bytes.");
  return bytes;
}

async function composeApp(baseBytes, moduleLoader, jump) {
  const before = inspectEsp32AppImage(baseBytes); const irom = before.segments[3];
  invariant(readVirtual(before, layout.setupTail, layout.setupTail + 3).toString("hex") === "1df000",
    "Accepted setup tail changed.");
  invariant(readVirtual(before, layout.keyLiteral, layout.keyLiteral + 4).readUInt32LE(0) === 0x4206eae0,
    "Accepted key callback literal changed.");
  const tailOffset = layout.loaderVaddr - irom.loadAddress;
  invariant(irom.data.subarray(tailOffset, tailOffset + (layout.loaderEnd - layout.loaderVaddr))
    .every((value) => value === 0), "Accepted loader cavity is not all zero.");
  let app = Buffer.from(baseBytes);
  jump.copy(app, irom.dataOffset + layout.setupTail - irom.loadAddress);
  moduleLoader.rawBytes.copy(app, irom.dataOffset + tailOffset);
  app.writeUInt32LE(moduleLoader.keyWrapper,
    irom.dataOffset + layout.keyLiteral - irom.loadAddress);
  app = repairEsp32AppIntegrity(app);
  const after = inspectEsp32AppImage(app);
  invariant(after.segmentCount === before.segmentCount && app.length === baseBytes.length,
    "Physical app layout/length changed.");
  for (let index = 0; index < before.segmentCount; index++) {
    invariant(before.segments[index].loadAddress === after.segments[index].loadAddress &&
      before.segments[index].length === after.segments[index].length,
    `Physical app segment ${index} layout changed.`);
    if (index !== 3) invariant(before.segments[index].data.equals(after.segments[index].data),
      `Physical app changed non-IROM segment ${index}.`);
  }
  return { app, before, after };
}

async function verifyPinnedBase() {
  invariant(RENDER_V2_MQUICKJS_PACKAGE_ABI_SHA256 === expected.packageAbi,
    "SDK package ABI changed.");
  invariant(expected.packageAbi !== expected.moduleAbi,
    "Package ABI and module ABI identities must remain distinct.");
  const runtimeHeader = await readFile(path.join(runtimeProof, "runtime_proof.h"), "utf8");
  invariant(runtimeHeader.includes(`"${expected.packageAbi}"`) &&
    runtimeHeader.includes(`"${expected.moduleAbi}"`),
  "Capability pages no longer pin distinct package and module ABI identities.");
  const [app, receipt] = await Promise.all([readFile(healthyAppPath), readFile(healthyReceiptPath)]);
  invariant(app.length === 2062912 && sha256(app) === expected.appSha256 &&
    sha256(receipt) === expected.receiptSha256, "Healthy app/receipt pin changed.");
  const image = inspectEsp32AppImage(app);
  const spans = Object.entries(expected).filter(([, value]) => value?.start);
  const starts = new Set(spans.map(([, pin]) => pin.start));
  for (const address of requiredAcceptedAddresses)
    invariant(starts.has(address), `Direct accepted-image address lacks a pin: ${hex(address)}.`);
  for (const [name, pin] of spans) {
    const bytes = readVirtual(image, pin.start, pin.end);
    invariant(sha256(bytes) === pin.sha256, `Accepted ABI span changed: ${name}.`);
  }
  invariant(sha256(await readFile(path.join(repository,
    "f1-widget-sdk/examples/renderer-id26/on-device/renderer-v1-scene-rpc.S"))) ===
    expected.acceptedRpcSourceSha256, "Accepted RPC stack-comparator source changed.");
  invariant(await sha256Files(["framer_stdlib_gen.c", "framer_mquickjs_canary.h",
    "framer_mquickjs_canary.c", "host_harness.c", "xtensa_link_canary.c"].map(
    (name) => path.join(canary, name))) === expected.engineSourceSha256,
  "MicroQuickJS canary source set changed without a physical re-pin.");
  invariant(sha256(await readFile(path.join(repository,
    "f1-widget-sdk/build/combined-renderer-v2-clock-blue-timer/" +
    "renderer-v2-native-source.c"))) === expected.acceptedId27SourceSha256,
  "Accepted ID27 addController/registry/navigation analogue changed.");
  invariant(layout.slotEnd <= layout.factoryEnd && 0x10000 + app.length === 0x207a40,
    "Factory flash headroom changed.");
  return { app, receipt: JSON.parse(receipt), image };
}

const temporary = await mkdtemp(path.join(os.tmpdir(), "framer-mqjs-physical-"));
try {
  const sourceClosure = await sourceClosureSnapshot();
  invariant(sourceClosure.sha256 === expected.sourceClosureSha256,
    "Physical source/dependency closure changed before the build.");
  const moduleAdapterEvidence = sourceClosure.files.find((item) =>
    item.file === "experiments/mquickjs-esp32s3-module-loader/module_adapter.c");
  invariant(moduleAdapterEvidence?.sha256 === expected.moduleAdapterSourceSha256,
    "ABI3 module adapter source identity changed.");
  const moduleLoaderManifestPath = path.join(loader, "build/module-loader-manifest.json");
  invariant(sha256(await readFile(moduleLoaderManifestPath)) ===
    expected.moduleLoaderManifestSha256,
  "ABI3 standalone module-loader proof manifest changed.");
  const base = await verifyPinnedBase();
  const acceptedPublicationProof = await proveAcceptedPublicationSemantics(
    base.image, temporary);
  const physicalSourceOrdering = provePhysicalSourceOrdering(
    await readFile(path.join(here, "physical_integration.c"), "utf8"));
  const assets = await buildAssets(temporary);
  const hostProof = await exactSourceHostProof(temporary, assets);
  const firstModule = await buildModule(temporary, assets, "module-a");
  const secondModule = await buildModule(temporary, assets, "module-b");
  invariant(firstModule.textBytes.equals(secondModule.textBytes) &&
    firstModule.rodataBytes.equals(secondModule.rodataBytes) &&
    JSON.stringify(firstModule.stackUsage) === JSON.stringify(secondModule.stackUsage),
  "Physical module rebuild is nondeterministic.");
  invariant((await readFile(path.join(here, "rpc_shims.S"), "utf8"))
    .includes("entry   a1,32"), "RPC integer shim stack frame changed.");
  const stackProof = proveStackUsage(firstModule.stackUsage);
  const firstLoader = await buildLoader(temporary, firstModule, "loader-a");
  const secondLoader = await buildLoader(temporary, secondModule, "loader-b");
  invariant(firstLoader.rawBytes.equals(secondLoader.rawBytes),
    "Resident loader rebuild is nondeterministic.");
  const loaderAdmissionProof = proveLoaderAdmissionOrdering(firstLoader);
  const jump = await jumpPatch(temporary, firstLoader.tail);
  const candidate = await composeApp(base.app, firstLoader, jump);
  const appName = "framer-0.4.1-mqjs-id28-canary-NO-GO-app.bin";
  await mkdir(output, { recursive: true });
  const paths = {
    app: path.join(output, appName), text: path.join(output, "mqjs-id28-text-page.bin"),
    rodata: path.join(output, "mqjs-id28-rodata-page.bin"),
    slot: path.join(output, "mqjs-id28-slot-a.bin"),
    loader: path.join(output, "mqjs-id28-resident-loader.bin"),
    f2js: path.join(output, "weather-id28-gen19.f2js"),
    f2tf: path.join(output, "weather-id28-gen19.f2tf"),
    base: path.join(output, "weather-id28-base.rgb565le"),
    lzss: path.join(output, "weather-id28-base.lzss"),
    source: path.join(output, "weather-id28-gen19.js"),
    stackUsage: path.join(output, "module-stack-usage.json"),
  };
  await Promise.all([
    writeFile(paths.app, candidate.app), writeFile(paths.text, firstModule.textBytes),
    writeFile(paths.rodata, firstModule.rodataBytes),
    writeFile(paths.slot, Buffer.concat([firstModule.textBytes, firstModule.rodataBytes])),
    writeFile(paths.loader, firstLoader.rawBytes), copyFile(assets.paths.f2js, paths.f2js),
    copyFile(assets.paths.f2tf, paths.f2tf), copyFile(assets.paths.base, paths.base),
    copyFile(assets.paths.compressed, paths.lzss),
    copyFile(assets.paths.source, paths.source),
    writeFile(paths.stackUsage, `${JSON.stringify({ proof: stackProof,
      records: firstModule.stackUsage }, null, 2)}\n`),
  ]);
  const slot = await readFile(paths.slot);
  const proofPins = {
    runtime: path.join(runtimeProof, "build/runtime-proof-manifest.json"),
    runtimeObject: path.join(runtimeProof, "build/runtime-proof-core.o"),
    resident: path.join(resident, "build/resident-integration-manifest.json"),
    residentObject: path.join(resident, "build/resident-integration-core.o"),
    stockBridge: path.join(repository,
      "experiments/mquickjs-esp32s3-stock-bridge/build/stock-bridge-manifest.json"),
    stockBridgeObject: path.join(repository,
      "experiments/mquickjs-esp32s3-stock-bridge/build/stock-bridge-core.o"),
  };
  const proofDigests = Object.fromEntries(await Promise.all(
    Object.entries(proofPins).map(async ([name, file]) => [name, sha256(await readFile(file))])));
  invariant(proofDigests.runtime === expected.runtimeManifestSha256 &&
    proofDigests.runtimeObject === expected.runtimeObjectSha256 &&
    proofDigests.resident === expected.residentManifestSha256 &&
    proofDigests.residentObject === expected.residentObjectSha256 &&
    proofDigests.stockBridge === expected.stockBridgeManifestSha256 &&
    proofDigests.stockBridgeObject === expected.stockBridgeObjectSha256,
  "A frozen runtime/resident/stock proof identity changed.");
  const finalSourceClosure = await sourceClosureSnapshot();
  invariant(JSON.stringify(finalSourceClosure) === JSON.stringify(sourceClosure),
    "Physical source/dependency closure changed during the build.");
  const manifest = {
    format: "framer-mquickjs-esp32s3-physical-link-candidate-v1",
    status: "PASS_DETERMINISTIC_LINK_PENDING_INDEPENDENT_AUDIT_NO_GO_PHYSICAL",
    allocationMapOrdering: "internal-block-before-first-mmu-map-adopt-or-rollback-v1",
    telemetrySnapshotProtocol: "p0-locks-snapshot-ordered-p1-p5-expiry-clear-v1",
    uiLatencyMetric: "id28-full-proxy-tick-oldtick-base-lzss-f2tf-publish-us-v1",
    keyTokenNormalization: "raw-low24-after-stock-first-v1",
    mappings: [{ logical: 0, nativeToken: 44 }, { logical: 1, nativeToken: 225 }],
    chordHeldMask: 3,
    rejectedLow24Tokens: [229],
    keyNegativeHarness: "low24-e5-observed-never-mapped-pass-v1",
    flashable: false, hardwareTouched: false, flashCommandGenerated: false,
    reason: "Exact link, RPC, package execution, and layout proofs pass; independent audit and guarded physical RAM/RPC/key/soak receipts remain mandatory.",
    healthyBase: { file: path.relative(repository, healthyAppPath), bytes: base.app.length,
      sha256: expected.appSha256, receipt: path.relative(repository, healthyReceiptPath),
      receiptSha256: expected.receiptSha256, screenIdsPreserved: [1, 7, 26, 27] },
    candidateApp: { file: path.relative(repository, paths.app), bytes: candidate.app.length,
      sha256: sha256(candidate.app), addedScreenId: 28, deterministicRebuilds: 2,
      segmentCount: candidate.after.segmentCount, nonIromSegmentsByteIdentical: true,
      mutations: [
        { address: hex(layout.setupTail), bytes: jump.length, before: "1df000", after: jump.toString("hex") },
        { address: hex(layout.keyLiteral), bytes: 4, beforePointer: "0x4206eae0",
          afterPointer: hex(firstLoader.keyWrapper) },
        { range: [hex(layout.loaderVaddr), hex(layout.loaderVaddr + firstLoader.rawBytes.length)],
          bytes: firstLoader.rawBytes.length, beforeAllZero: true, sha256: sha256(firstLoader.rawBytes) },
      ] },
    module: { abiVersion: 3, moduleAbiSha256: expected.moduleAbi,
      packageAbiSha256: expected.packageAbi,
      identitySeparation: "descriptor/loader use module ABI3; F2JS package uses package ABI1",
      slotA: { range: [hex(layout.textPaddr), hex(layout.slotEnd)], bytes: slot.length,
        sha256: sha256(slot), identitySemantics:
          "SHA-256 of padded text[0x20000] concatenated with padded rodata[0x10000]; binary digest is embedded only in resident loader and passed to startup" },
      text: { paddr: hex(layout.textPaddr), vaddr: hex(layout.textVaddr),
        usedBytes: firstModule.sections[".text"].bytes, capacityBytes: layout.textBytes,
        sha256: sha256(firstModule.textBytes) },
      rodata: { paddr: hex(layout.rodataPaddr), vaddr: hex(layout.rodataVaddr),
        usedBytes: firstModule.sections[".rodata"].bytes, capacityBytes: layout.rodataBytes,
        sha256: sha256(firstModule.rodataBytes) },
      relocations: 0, undefinedSymbols: 0, writableStaticBytes: 0,
      residentBlockBytes: firstModule.blockBytes,
      startupVaddr: hex(firstModule.startup), id28IdentityVaddr: hex(firstModule.id),
      keySinkVaddr: hex(firstModule.keySink), deterministicRebuilds: 2,
      stackUsage: { file: path.relative(repository, paths.stackUsage),
        sha256: sha256(await readFile(paths.stackUsage)), ...stackProof },
      loader: { file: path.relative(repository, paths.loader), bytes: firstLoader.rawBytes.length,
        sha256: sha256(firstLoader.rawBytes), preMapAdmissionBytes:
          firstModule.blockBytes + 32768 + 4096,
        allocationBeforeFirstMap: true, startupAdoptsExactBlock: true,
        rollbackBeforeOwnerTask: "map failure frees the owned block but a failed internal cleanup may retain a mapping handle until reset; successful-map/startup-failure attempts unmap then frees exactly once; any unmap failure is a reset/rollback hardware gate",
        postAllocationMapAdmission: { freeMinimumBytes: 32768 + 4096,
          largestMinimumBytes: 4096 } } },
    assets: { generation: 19, weatherCanaryPostalCode: "60601",
      canonicalWeather: { sourceSha256: expected.canonicalWeatherSourceSha256,
        packageSha256: expected.canonicalWeatherF2jsSha256,
        recoveryContract: "hydrate slots0/12/14/15 on callback; status-only publish inherits slots1..11; coherent packed commit alone replaces forecast" },
      f2js: { file: path.relative(repository, paths.f2js), bytes: assets.packageValue.bytes,
        sha256: assets.packageValue.sha256, sourceSha256: assets.packageValue.sourceSha256,
        sourceFile: path.relative(repository, paths.source), handlers: assets.handlerCount,
        handlerLimit: 16, hostileSeventeenthHandler: "REJECTED_EXCEPTION_RECOVERED",
        declaredEventRecords: assets.decodedPackage.events.length,
        declaredHandlers: ["host.rpc:B240", "host.rpc:B241", "host.rpc:B242",
          "host.rpc:B243", "host.rpc:B244", "host.rpc:B24F", "host.rpc:B24D",
          "host.rpc:B24E", "tick.1s", "tick.100ms", "input.fn-bottom-knob",
          "input.key.down", "input.key.up", "input.key.hold",
          "input.chord.down", "input.chord.up"],
        keyTokens: [{ logical: 0, nativeToken: "0x2c", evidence: "static-candidate-space" },
          { logical: 1, nativeToken: "0xe1", evidence: "static-candidate-left-shift" }],
        chordMask: 3, rasterBaseBytes: 0 },
      f2tf: { file: path.relative(repository, paths.f2tf), bytes: assets.facade.binary.length,
        sha256: assets.facade.sha256, f2jsSha256: assets.facade.f2jsSha256,
        baseSha256: assets.facade.baseSha256,
        contractSha256: TARGET_FACADE_CONTRACT_SHA256 },
      base: { rawBytes: assets.base.length, rawSha256: sha256(assets.base),
        lzssBytes: assets.compressed.length, lzssSha256: sha256(assets.compressed),
        codec: "lzss-1k-len3-66-v1", exactRoundTrip: true } },
    runtime: { allocation: { placement: "INTERNAL|8BIT only", bytes: firstModule.blockBytes,
        count: 1, embeddedProxyBytes: 144, psramFallback: false,
        startupPreflight: { freeMinimumBytes: firstModule.blockBytes + 32768,
          largestMinimumBytes: firstModule.blockBytes },
        loaderPreMapPreflight: { freeMinimumBytes: firstModule.blockBytes + 32768 + 4096,
          largestMinimumBytes: firstModule.blockBytes },
        ordering: "loader allocates and validates exact block before first map; module adopts only at owner-task commit; map/startup failures free the block once, but any failed MMU cleanup is fail-closed and requires reset/rollback rather than an unconditional cleanup claim" },
      owner: { stackBytes: 12288, engineRuntimeBytes: 4096, engineHeapBytes: 65536,
        priority: 1, core: 1, scheduling: "one bounded owner_step then vTaskDelay(1)",
        stackHighWaterUnits: "bytes directly from 0x4038daf4; no x4",
        telemetryCadenceMs: 100, fullIterationTiming: true },
      uiOrder: ["renderer-v1 old_tick(base restore)", "bounded exact LZSS weather base",
        "72-byte mailbox snapshot + F2TF overlay", "publish opposite descriptor"],
      uiLatency: { telemetrySuffix: ";U=<uiMax8>", unit: "microseconds",
        scope: "boot-lifetime atomic maximum for every valid ID28 proxy tick from immediately before old_tick through measured exit, including final publish when reached",
        failureAccounting: "LZSS/F2TF admit/render failures increment telemetry publish_failed; hidden target is timed but not counted as failure",
        sessionCapturedAtPage0: true, physicalAcceptance: { greaterThan: 0,
          maximumUs: 100000 }, uiAppliedRevisionSource: "last successful F2TF target_metrics.applied_revision" },
      framebuffer: "ID26 +160 borrowed; no second framebuffer/store",
      hiddenPolicy: "ID28 cleanup seq-cst closes key/knob/tick/poll gates, waits the combined wrapper barrier, then owner-drains a nonterminal FOCUS_LOSS resync; re-entry remains closed until resident+engine input is empty and held/chord mask is zero; host weather stays receipt-controlled",
      fatalPolicy: "owner atomically retires event/input/poll producers exactly once when permanently_disabled becomes true; telemetry/receipt remain readable; capability blocks",
      publication: "owner admits VM/assets and ACKs; original setup task registers RPC, addController, validates registration-owned registry+20, then addNavigation last; common base slot0 later creates lifecycle-owned root+12 and proxy_build requires its proven INTERNAL range before imageCreate; post-task failures keep mapping inert" },
    stockAbi: { carrier: "0x42004e1c root -> 0x4210ad9c registry -> 0x4210af48 current controller",
      setupCarrierAdmission: loaderAdmissionProof,
      publicationDisassembly: acceptedPublicationProof,
      backendIdentity: "accepted ID26 controller/framebuffer extent + registry + exact slots6/8/9 + v2 sidecar slot11/magic/delegates; validation precedes allocator query and first map",
      proxyOwnership: { registryOffset20: "addController-owned immediate postcondition",
        rootOffset12: "base-slot0 lifecycle-owned; build-time aligned INTERNAL-only admission" },
      rootAllocation: { classBytes: 52, alwaysInternalThresholdBytes: 256,
        capsLiteral: "0x1800 INTERNAL|DEFAULT", acceptedRange: "0x3fc80000..0x3fd00000",
        proof: "full base slot0 -> lv_obj_create/core -> class size -> LVGL zero allocator/port -> stdlib wrapper -> malloc_default plus threshold setter spans pinned" },
      acceptedId27AnalogueSourceSha256: expected.acceptedId27SourceSha256,
      keyOrdering: "resident wrapper calls exact stock 0x4206eae0 first and preserves its return",
      keyActivation: "stock-first; only foreground vtable[8] ID28; observe exact 0x2c/0xe1 down+up without dispatch, then commit gate for subsequent edges",
      pinnedSpans: Object.fromEntries(Object.entries(expected).filter(([, value]) => value?.start)
        .map(([name, value]) => [name, { address: hex(value.start), end: hex(value.end),
          bytes: value.end - value.start, sha256: value.sha256 }])) },
    rpc: { capabilityMethod: "widget.mquickjs.cap", telemetryMethod: "widget.mquickjs.telemetry",
      eventMethod: "widget.mquickjs.event", receiptMethod: "widget.mquickjs.receipt",
      status: "LINKED_STATIC_BLOCKED_UNTIL_BOOT_READY", contexts: 4,
      capabilityPages: 13, telemetryPages: 6,
      telemetrySession: { timeoutMs: 2000,
        protocol: "p0-locks-snapshot-ordered-p1-p5-expiry-clear-v1",
        behavior: "p0 captures coherent telemetry+uiMax; exact ordered p1..p5 use only cache; p5 clears; duplicate/out-of-order/expired rejects and clears; expired p0 restarts" },
      identity: { baseAppSha256: expected.appSha256,
        baseAppMeaning: "accepted healthy ancestry, not final candidate app SHA",
        moduleSlotSha256: sha256(slot), packageSha256: assets.packageValue.sha256 },
      eventFields: ["id", "value", "auxiliary", "generation", "revision"],
      receiptStates: ["Q", "A", "R", "B", "H", "F"],
      correlation: "one outstanding event; nonzero tag travels in exact resident queue record; only its consumed completion publishes A/F",
      timeoutFault: { id: "0xB24D", value: -2147483648, auxiliary: "0x54494D45", result: -6, state: "F" },
      oomFault: { id: "0xB24D", value: -2147483647, auxiliary: "0x4F4F4D21", result: -7, state: "F" } },
    verification: { exactSourceHost: hostProof.normal,
      exactSourceMovingGcAsan: hostProof.movingGcAsan,
      engineSourceSha256: expected.engineSourceSha256,
      physicalSourceOrdering,
      runtimeProofManifest: { file: path.relative(repository, proofPins.runtime),
        sha256: proofDigests.runtime, objectSha256: proofDigests.runtimeObject },
      moduleLoaderProofManifest: { file: path.relative(repository, moduleLoaderManifestPath),
        sha256: expected.moduleLoaderManifestSha256,
        moduleAdapterSourceSha256: expected.moduleAdapterSourceSha256,
        publicAbiVersion: 3, publicAbiSha256: expected.moduleAbi },
      residentProofManifest: { file: path.relative(repository, proofPins.resident),
        sha256: proofDigests.resident, objectSha256: proofDigests.residentObject },
      stockBridgeProofManifest: { file: path.relative(repository, proofPins.stockBridge),
        sha256: proofDigests.stockBridge, objectSha256: proofDigests.stockBridgeObject },
      sourceClosure,
      capabilityIdentitySeparation:
        "PASS_PACKAGE_509_MODULE_AD484_DISTINCT_DESCRIPTOR_LOADER_CAP_P11_NO_SWAP",
      telemetryHostileRefreshInterleave: "PASS_SHARED_HELPER_EXACT_ORDER_EXPIRY_BOUNDARY",
      taggedCompletionTelemetry: "PASS_COMPLETION_FIELDS_THEN_COHERENT_P2_REFRESH_THEN_TERMINAL_RECEIPT_RELEASE_LAST_WHILE_ADMISSION_CLOSED",
      keyDiscoveryFallthrough: "PASS_FOUR_EDGES_ZERO_MAP_FIFTH_EDGE_FIRST_MAP",
      focusReleaseReentry: "PASS_LATE_KEY_AND_FN_WRAPPER_BARRIER_HOST_INTERLEAVE_NONTERMINAL_RELEASE_HIDDEN_NO_HOLD_REENTRY_DOWN_HOLD_UP_CHORD",
      weatherFaultRecovery: "PASS_REV7_TIMEOUT_BENIGN_AND_OOM_BENIGN_SLOTS0_11_UNCHANGED_THEN_MONOTONIC_REV8_NORMAL_AND_MOVING_GC_ASAN",
      fatalSourceRetirement: "PASS_SHARED_HELPER_ONE_SHOT_PRODUCER_RETIREMENT",
      protocolHarnessSources: {
        hostHarnessSha256: sha256(await readFile(path.join(here, "physical_host_harness.c"))),
        backendContractSha256: sha256(await readFile(path.join(here, "backend_contract.h"))),
        publicationContractSha256: sha256(await readFile(path.join(here, "publication_contract.h"))),
        focusContractSha256: sha256(await readFile(path.join(here, "focus_contract.h"))),
        completionContractSha256: sha256(await readFile(path.join(here, "completion_contract.h"))),
        telemetrySessionSha256: sha256(await readFile(path.join(here, "telemetry_session.h"))),
        keyGateSha256: sha256(await readFile(path.join(here, "key_gate.h"))),
        keyTokenSha256: sha256(await readFile(path.join(here, "key_token.h"))),
        fatalRetirementSha256: sha256(await readFile(path.join(here, "fatal_retirement.h"))),
      },
      callbackStack: stackProof,
      lzssRoundTrip: "EXACT", deterministicModuleAndLoaderRebuilds: 2 },
    physicalGates: [
      "independent audit of final app/module/loader hashes and all call spans",
      "live pre-map and post-allocation internal free/largest receipt on the target keyboard",
      "live four-method RPC page/queue/applied/fault receipt exercise with UI-jank timing",
      "observe exact 0x2c and 0xe1 down+up edges while ID28 is foreground before keyEvents becomes true",
      "measure task stack high-water, callback deadline, OOM/timeout recovery, cache/WDT and UI timing",
      "guarded boot, rollback, then bounded soak with physical SHA/receipt",
    ],
  };
  const verifierOutput = { status: manifest.status, candidateApp: manifest.candidateApp,
    module: manifest.module, assets: manifest.assets, rpc: manifest.rpc,
    physicalGates: manifest.physicalGates };
  await Promise.all([
    writeFile(path.join(output, "physical-link-manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`),
    writeFile(path.join(output, "verify-output.json"),
      `${JSON.stringify(verifierOutput, null, 2)}\n`),
  ]);
  process.stdout.write(`${JSON.stringify(verifierOutput, null, 2)}\n`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
