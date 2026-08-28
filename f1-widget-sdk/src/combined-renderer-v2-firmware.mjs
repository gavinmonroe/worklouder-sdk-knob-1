import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  inspectEsp32AppImage,
  repairEsp32AppIntegrity,
} from "../../custom-firmware/lib/esp-app-image.mjs";
import { decodeWidgetBundle, encodeWidgetBundle } from "./render/index.mjs";
import { PINNED, SDK_ROOT, WORKSPACE_ROOT } from "./constants.mjs";
import { inspectImage } from "./firmware.mjs";
import { STAGE3E3_PATHS } from "./stage3e3.mjs";
import { assert, resolveRecordedPath, sha256, stableJson } from "./util.mjs";

const run = promisify(execFile);

const LIVE_APP = path.join(SDK_ROOT,
  "build/rollbacks/framer-0.4.1-live-7838eea0-clock-timer-app.bin");
const LIVE_RECEIPT = path.join(SDK_ROOT,
  "build/device-receipts/device-1786936722535-fast-smoke.json");
const SECONDARY_49CB_APP = path.join(SDK_ROOT,
  "build/rollbacks/framer-0.4.1-live-49cbf880-renderer-id26-app.bin");
const SCENE = path.join(SDK_ROOT,
  "examples/render-v2-events/build/render-v2-events.scene.bin");
const ATLAS = path.join(SDK_ROOT,
  "examples/render-v2-events/build/render-v2-events.atlas.bin");
const F2EP = path.join(SDK_ROOT,
  "examples/render-v2-events/build/render-v2-events.f2ep");
const DEMO_MANIFEST = path.join(SDK_ROOT,
  "examples/render-v2-events/build/manifest.json");
const STUB_SOURCE = path.join(SDK_ROOT,
  "examples/render-v2-events/on-device/renderer-v2-native-contract-stub.c");
const RPC_SOURCE = path.join(SDK_ROOT,
  "examples/render-v2-events/on-device/renderer-v2-event-rpc.S");
const RENDERER_V1_SOURCE = path.join(WORKSPACE_ROOT,
  "custom-firmware/experimental/renderer-v1-id26.c");
const SCENE_RPC_SOURCE = path.join(SDK_ROOT,
  "examples/renderer-id26/on-device/renderer-v1-scene-rpc.S");
const SCENE_RPC_CORE_SOURCE = path.join(SDK_ROOT,
  "examples/renderer-id26/on-device/renderer-v1-scene-rpc-core.c");
const NATIVE_HEADER = path.join(WORKSPACE_ROOT,
  "custom-firmware/experimental/renderer-v2-f2ep-native.h");
const NATIVE_SOURCE = path.join(WORKSPACE_ROOT,
  "custom-firmware/experimental/renderer-v2-f2ep-native.c");
const NATIVE_HOST = path.join(WORKSPACE_ROOT,
  "custom-firmware/experimental/renderer-v2-f2ep-native-host.c");
const BASE_FRAME = path.join(SDK_ROOT,
  "examples/render-v2-events/build/frame-00-boot.rgb565");
const FOCUS_BASE_FRAME = path.join(SDK_ROOT,
  "examples/render-v2-focus-dial/build/render-v2-focus-dial.base.rgb565");
const FOCUS_F1WB = path.join(SDK_ROOT,
  "examples/render-v2-focus-dial/build/render-v2-focus-dial.base.f1wb");
const FOCUS_F2EP = path.join(SDK_ROOT,
  "examples/render-v2-focus-dial/build/render-v2-focus-dial.f2ep");
const FOCUS_PACKAGE = path.join(SDK_ROOT,
  "examples/render-v2-focus-dial/build/render-v2-focus-dial.package.bin");
const TIMER_F2EP = path.join(SDK_ROOT,
  "examples/render-v2-focus-timer/build/render-v2-focus-timer.f2ep");
const TIMER_BASE_FRAME = path.join(SDK_ROOT,
  "examples/render-v2-focus-timer/build/render-v2-focus-timer.base.rgb565");
const TIMER_BASE_LZSS = path.join(SDK_ROOT,
  "examples/render-v2-focus-timer/build/render-v2-focus-timer.base.lzss");
const FOCUS_TIMER_PACKAGE = path.join(SDK_ROOT,
  "examples/render-v2-focus-timer/build/render-v2-focus-plus-timer.store-fit.bin");
const TIMER_MANIFEST = path.join(SDK_ROOT,
  "examples/render-v2-focus-timer/build/manifest.json");
const FOCUS_MANIFEST = path.join(SDK_ROOT,
  "examples/render-v2-focus-dial/build/manifest.json");
const FOCUS_PUBLISHER = path.join(SDK_ROOT,
  "examples/render-v2-focus-timer/tools/push-focus-timer-package.mjs");
const PINNED_NATIVE = Object.freeze({
  sourceSha256: "7183c79aabdb2c60a2992608a2ac187a721a2ec2e587123ff64b498be8cceafe",
  headerSha256: "be472d9986532f2c0e6aa4ff89510f99b21aa989a7bb66297e0cfdeceda1e630",
  hostSha256: "4b67f36e768efee86ea36db42a777f29e1f820acaed5439f0a00ff583152ceb6",
});

const APP_NAME = "framer-0.4.1-music-id1-wpm-id7-renderer-id26-clock-id27-blue-timer-app.bin";
const MERGED_NAME = "framer-0.4.1-music-id1-wpm-id7-renderer-id26-clock-id27-blue-timer-merged.bin";
const CODE_NAME = "music-id1-wpm-id7-renderer-id26-clock-id27-blue-timer-irom.bin";
const MODULE_NAME = "renderer-v2-clock-blue-timer.bin";
const MANIFEST_NAME = "combined-renderer-v2-clock-blue-timer-manifest.json";
const APPROVAL_NAME = "combined-renderer-v2-clock-blue-timer-device-approval.draft.json";
const FLASH_COMMAND_NAME = "fast-smoke-command.txt";
const PROVISION_COMMAND_NAME = "focus-timer-provision-command.txt";
const COMPRESSED_ASSETS_NAME = "renderer-v2-lzss-assets.bin";
// 0x3c1cf36c is the exclusive end of the accepted WPM payload.  Keep a
// 0x94-byte guard and use only the exact all-zero remainder of mapped page 1C.
const COMPRESSED_ASSET_ADDRESS = 0x3c1cf400;
const COMPRESSED_ASSET_CAPACITY = 0x3c1d0000 - COMPRESSED_ASSET_ADDRESS;
const LZSS_DISTANCE_BITS = 10;
const LZSS_DISTANCE_MAX = 1 << LZSS_DISTANCE_BITS;
const LZSS_LENGTH_MAX = (1 << (16 - LZSS_DISTANCE_BITS)) + 2;
// ESP32-S3 IROM and DROM share an MMU page index.  The live DROM begins on
// page 0x12, so allowing IROM to enter 0x4212xxxx aliases two different flash
// pages and makes cpu_start reject the otherwise structurally-valid image.
const IROM_DROM_ALIAS_BOUNDARY = 0x42120000;
const RTC_ABI = Object.freeze({
  decode: Object.freeze({ address: 0x42068f04, segmentIndex: 3, offset: 0x68ee4,
    bytes: 499, sha256: "68b2d186e4ae76f0a074a87988acfb643fe461047ba0c610bbe572a7b546c2aa" }),
  monotonic: Object.freeze({ address: 0x4037e028, segmentIndex: 4, offset: 0x0c10,
    bytes: 24, sha256: "75e03adc4a2e9d122f0accb175d4eabbabacf8b20982c9afda3f55f865b3a587" }),
});

export const LIVE_RENDER_V2_BASE = Object.freeze({
  proofId: "framer-f1-0.4.1-music-wpm-renderer-v2-clock-timer-7838eea0",
  appBytes: 2_062_912,
  appSha256: "7838eea09b7e712a76cbdb5786efa3752079a852aa0bcad49d4cd8c596b070e5",
  receiptSha256: "792f03f487d062d25d340b52b16b7e820592bb6b1c2f66f2824a83056bd0e5e0",
  codeBytes: 36_872,
  codeSha256: "8ae3c5f306e27df7be2d255bc8d33e5275010e279d17b1e796506b32e2d45df7",
  wrapperAddress: 0x42117094,
  wrapperChainCallAddress: 0x421170c5,
  wrapperChainCallBytes: "a5b701",
  rendererModuleOffset: 6_332,
  rendererModuleBytes: 30_540,
  rendererModuleSha256: "285126c7c2ec4f9036c9db97c5bfc863b1012d6c7eb6eb4592bfe645bfe4c56f",
  acceptedFunctions: Object.freeze({
    wpmRegister: 0x421170cc,
    rendererRegister: 0x4211a3c4,
    rendererStageBundle: 0x42119dbc,
    rendererTick: 0x4211950c,
    rendererSceneRpcRegister: 0x4211b6a8,
    operatorNew: 0x420e7c04,
  }),
  slices: Object.freeze({
    wpmLiteral: Object.freeze({ offset: 16, bytes: 220,
      sha256: "c447cf2300462ad218ab7d687595a5f178c06f0ca9ee5b4adadd2c3d65d24646" }),
    wpmText: Object.freeze({ offset: 444, bytes: 1708,
      sha256: "4934ea5a2ec030cb689953d813d0995854d911546b4d4ebd122014bf4b49ec0c" }),
    musicLiteral: Object.freeze({ offset: 236, bytes: 148,
      sha256: "54158beff47a8dc6feee68df2656cd405849711d1adb59ad137471c76856d145" }),
    musicText: Object.freeze({ offset: 2152, bytes: 4180,
      sha256: "e72917f53aeb3963a9adc7cb1a45aef083d762ed49019a4d6e3ba220f7e92c4e" }),
  }),
});

export const RENDER_V2_NATIVE_ABI = Object.freeze({
  attach: Object.freeze({
    symbol: "renderer_v2_native_attach",
    signature: "void *(void *setup_arg0, void *setup_arg1, void *renderer_v1_controller, const uint8_t *persistent_f2ep_data, uint32_t f2ep_bytes)",
    setupArguments: "accepted chain supplies registry then navigation; adapter uses them to register controller/nav ID27",
    ownership: "borrows persistent immutable byte-addressable DROM-or-RAM; runtime never writes or frees it; null must leave renderer-v1 usable",
  }),
  rpcRegister: Object.freeze({
    symbol: "renderer_v2_rpc_register",
    signature: "void *(void *renderer_v1_controller, void *accepted_scene_rpc_state)",
    method: "widget.v2.event",
    behavior: "register one bounded callback; callback validates fixed id 0xB201 and enqueues only",
  }),
  hostEvent: Object.freeze({
    symbol: "renderer_v2_native_host_event",
    signature: "uint32_t(void *renderer_v1_controller, uint16_t id, int32_t value)",
    eventId: 0xb201,
    behavior: "nonblocking fixed-capacity enqueue; no LVGL or framebuffer access outside the UI callback",
  }),
  sceneHandoff: Object.freeze({
    prepare: "uint32_t renderer_v2_native_prepare(void *controller, const uint8_t *package, uint32_t package_bytes, uint32_t generation)",
    commit: "uint32_t renderer_v2_native_commit(void *controller)",
    cancel: "uint32_t renderer_v2_native_cancel(void *controller)",
    ordering: "hash exact 95,535-byte F1WB+focus-F2EP+timer-F2EP+blue-base-LZSS package -> prepare all four -> renderer-v1 stage 62,404-byte F1WB prefix -> commit; cancel if stage fails",
    lifetime: "scene store becomes immutable and BUSY for the rest of this controlled-smoke boot",
    activation: "UI tick switches only when renderer-v1 active bundle pointer and generation match the committed pair",
  }),
  ui: Object.freeze({
    tick: "attach replaces renderer controller vtable slot 6 and delegates to accepted renderer_v1_tick before F2EP patches",
    encoder: "attach replaces vtable slot 9; consume Fn+encoder ID1 only when the F2EP handler matches, else delegate",
    framebuffer: "borrow renderer-v1 controller framebuffer at byte offset 160; allocate no second framebuffer",
    timerProxy: "bounded ID27 proxy calls the saved renderer-v1 tick on ID26, decodes the exact blue base, then applies timer patches before publishing the opposite descriptor; owns only a 136-byte controller and shares the exact framebuffer",
    hiddenTimerPolicy: "pause while ID27 is hidden; resume from the unchanged remainingSeconds on re-entry",
  }),
  rtc: Object.freeze({ decodeAddress: "0x42068f04", monotonicAddress: "0x4037e028",
    cadence: "once per visible ID26 second plus first tick/re-entry",
    freshnessUs: 20_000,
    ordering: "queued B201 and synthetic tick first; valid coherent RTC snapshot overwrites secondsOfDay before publication; invalid/slow retains last-good" }),
});

const RENDER_V2_ASSET = Object.freeze({
  f2epBytes: 9_536,
  f2epSha256: "af34f7f98587d31929799e3218beb47582a0ec796085f4d36859d37a60469b08",
  sceneBytes: 220,
  sceneSha256: "6270f93c2b7ead55cf28df3d1e829d2a5e1793596e6ce04a1f8c0b8269e89065",
  atlasBytes: 196,
  atlasSha256: "a995dd91936e5c6f73078e48ea62280ee3086067316805cf6280b52d16e4317a",
  baseBundleBytes: 748,
  baseBundleSha256: "5f1edc6879adcec0d25d5e6c999bfc80e19089aa05a72fbd14f3f5acd8899f2e",
  frameSha256: Object.freeze([
    "db3d0ccb4a5776a6362a9c428684a382ba7830eb58f354f49085514cc926bb81",
    "8ad76bfea892d20a12323a36a75987922f9725356e9ee54ea55c382468fee5f7",
    "781fc654e1525d6b5313bb19cbb6eae16ad39313887c2a8ebe728aba9a9a49e8",
    "2767418e35b7d87ef84996952959f926e15541024200e2ac6a0cd9640c4827af",
  ]),
});

const FOCUS_DIAL_ASSET = Object.freeze({
  baseFrameBytes: 62_000,
  baseFrameSha256: "5d154baeb898d090d2b0382cd5209078f5a2b5d047127dbb9a22d109083cbac6",
  f1raBytes: 62_072,
  f1raSha256: "4de389c225407bc3d616b0f86cfbe2cb645bda0cb989c5785addff67d72028c7",
  f1wbBytes: 62_404,
  f1wbSha256: "fa5580257a2432301acfe87434f277493e3d1a8fd8470d793b8bd9ce66850b18",
  f2epBytes: 15_178,
  f2epSha256: "b2eadd5884c6ee3b1546ac50c3c077d16eb384adbf1a82631551e69f93705aed",
  packageBytes: 77_582,
  packageSha256: "06751e0349538d4fc3ded27361f1b90260910513987e4f8f986f9e4e3915cf65",
  expectedGeneration: 1,
  generation: 2,
  chunks: 26,
  sceneStoreBytes: 98_304,
  frameSha256: Object.freeze([
    "6571fc6cfb349275cd7eff9f613a761879ee2e97231c5998a65fa86fce0bb27d",
    "9f1c6bd9e5036f4ae99b6b1b01673da5f8602a1e95e82a2fd182e4fe30e30c81",
    "47416873a4fb528c7a9ea9803e9deb61f7fc51bbf9de920839e05ded17682ea0",
    "853808133392497d78ec8fdab221312c57a7d41bc284a370a263915dab52b7e1",
    "a606bc0102aaa48a675a026891b9c840e214ab1fb1cae367cddb3be7c93c6c7b",
    "31b4504634f2598d1c3f38faaff4e7227505b596fe8f8235d9ac0fdfc29db159",
    "31b4504634f2598d1c3f38faaff4e7227505b596fe8f8235d9ac0fdfc29db159",
  ]),
});

const TIMER_ASSET = Object.freeze({
  f2epBytes: 14_618,
  f2epSha256: "80e7ca2e30a56ca12c29320256884c69cdaef7fea27a6468a0cb54122cad8979",
  timerBaseBytes: 62_000,
  timerBaseSha256: "13daabad2f5c578a5ebfed2fceef9dde60ae7f38c8ab51404b34133ef1b4e3e8",
  timerBaseLzssBytes: 3_335,
  timerBaseLzssSha256: "cae1a0903e8b9ec09880dee05652a354b420cd5966d10b28c0382e40c0427307",
  packageBytes: 95_535,
  generationOnePackageSha256: "c7a49c9f7a4f709692299cff9239b9f5e0d9cc0c946efc948d3c54b54b1f5102",
  generationTwoPackageSha256: "5b1b9a068e33b8b09f0596b49df0b7f79e22f05ee1f21ce7939b6c6965753ac7",
  generationTwoF1wbSha256: "e518d8c0a528f37961a88fcc2664e6abd90fce5a0f33138c75a2256a58683254",
  expectedGeneration: 1,
  generation: 2,
  chunks: 32,
  lastChunkBytes: 303,
  storeHeadroomBytes: 2_769,
  sceneStoreBytes: 98_304,
  frameSha256: Object.freeze([
    "d8308c853da7da6745f8fdc6b40b1189bcc379800650671e568d32d65333b165",
    "c5d8e92863e9fd34789429f18f57eaede72419943fe26694b19adc16ecc3df93",
    "d8308c853da7da6745f8fdc6b40b1189bcc379800650671e568d32d65333b165",
    "dbe4e53243da971cf3664ae173ad95a0e9eeb9b827826cf621d426962709638a",
    "59c476eec3aa106ac69410d206cad7eb45855a3077b92d3304450d87e7140981",
    "140f718768620b513ebe28534e7595d5463f6349769423ea09341253ebdcf80f",
    "140f718768620b513ebe28534e7595d5463f6349769423ea09341253ebdcf80f",
  ]),
});

function tool(name) {
  return path.join(PINNED.toolchainDirectory, `xtensa-esp32s3-elf-${name}`);
}

function parseSymbols(text) {
  const symbols = new Map();
  for (const line of text.split("\n")) {
    const match = /^([0-9a-f]+)\s+([0-9a-f]+)\s+[A-Za-z]\s+(\S+)$/u.exec(line.trim());
    if (match) symbols.set(match[3], {
      address: Number.parseInt(match[1], 16), size: Number.parseInt(match[2], 16),
    });
  }
  return symbols;
}

function assertSlice(code, slice, label) {
  assert(slice.offset + slice.bytes <= code.length &&
    sha256(code.subarray(slice.offset, slice.offset + slice.bytes)) === slice.sha256,
  `${label} changed from the accepted 7838 live base.`);
}

function assertRuntimeMapSite(segments, site, label) {
  const data = segments[site.segmentIndex]?.data;
  assert(data && site.offset >= 32 && site.offset + 36 <= data.length &&
    data.readUInt32LE(site.offset) === site.oldValue &&
    sha256(data.subarray(site.offset - 32, site.offset + 36)) === site.contextSha256,
  `Accepted runtime-map ${label} literal/xref context changed.`);
}

function linker(baseAddress) {
  return `ENTRY(renderer_v2_combined_registration_chain)
SECTIONS {
  . = 0x${baseAddress.toString(16)};
  .renderer_v2 : ALIGN(4) {
    KEEP(*(.literal.renderer_v2_chain))
    *(.literal)
    *(.literal.*)
    KEEP(*(.text.renderer_v2_chain))
    KEEP(*(.text.renderer_v2_native))
    *(.text)
    *(.text.*)
    . = ALIGN(4);
  }
  .renderer_v2_rodata : ALIGN(4) { *(.rodata) *(.rodata.*) }
  /DISCARD/ : { *(.comment) *(.xtensa.info) *(.xt.lit) *(.xt.prop) *(.eh_frame) *(.eh_frame.*) }
}
ASSERT(SIZEOF(.renderer_v2_rodata) == 0, "render-v2 native module must not dereference IROM rodata")
`;
}

function blobLiterals(prefix, bytes) {
  assert(bytes.length > 0 && bytes.length % 4 === 0,
    `${prefix} must be nonempty and four-byte aligned.`);
  return Array.from({ length: bytes.length / 4 }, (_, index) =>
    `.L${prefix}_${index}: .long 0x${bytes.readUInt32LE(index * 4).toString(16).padStart(8, "0")}`).join("\n");
}

function blobStores(prefix, bytes) {
  const stores = [];
  for (let index = 0; index < bytes.length / 4; index += 1) {
    stores.push(` l32r a8,.L${prefix}_${index}\n s32i a8,a7,${(index % 256) * 4}`);
    if (index % 256 === 255 && index + 1 < bytes.length / 4) {
      stores.push(" movi a8,1024\n add a7,a7,a8");
    }
  }
  return stores.join("\n");
}

function copyFunction(name, prefix, bytes) {
  return `.balign 4
.global ${name}
.type ${name},@function
${name}:
 entry a1,32
 l32r a10,.L${prefix}_bytes
 l32r a8,.Loperator_new
 callx8 a8
 mov a5,a10
 beqz a5,.L${prefix}_copy_fail
 mov a7,a5
${blobStores(prefix, bytes)}
 memw
 mov a2,a5
 retw.n
.L${prefix}_copy_fail:
 movi.n a2,0
 retw.n
.size ${name},.-${name}
`;
}

function encodeLzss(bytes) {
  const output = [];
  let cursor = 0;
  while (cursor < bytes.length) {
    const flagsIndex = output.length;
    output.push(0);
    let flags = 0;
    for (let bit = 0; bit < 8 && cursor < bytes.length; bit += 1) {
      let bestLength = 0;
      let bestDistance = 0;
      const first = Math.max(0, cursor - LZSS_DISTANCE_MAX);
      for (let candidate = cursor - 1; candidate >= first; candidate -= 1) {
        if (bytes[candidate] !== bytes[cursor]) continue;
        let length = 1;
        while (length < LZSS_LENGTH_MAX && cursor + length < bytes.length &&
          bytes[candidate + length] === bytes[cursor + length]) length += 1;
        if (length >= 3 && length > bestLength) {
          bestLength = length;
          bestDistance = cursor - candidate;
          if (length === LZSS_LENGTH_MAX) break;
        }
      }
      if (bestLength >= 3) {
        flags |= 1 << bit;
        const code = ((bestLength - 3) << LZSS_DISTANCE_BITS) | (bestDistance - 1);
        output.push(code & 0xff, code >>> 8);
        cursor += bestLength;
      } else output.push(bytes[cursor++]);
    }
    output[flagsIndex] = flags;
  }
  return Buffer.from(output);
}

function decodeLzss(bytes, outputBytes) {
  const output = Buffer.alloc(outputBytes);
  let source = 0;
  let target = 0;
  while (target < output.length) {
    assert(source < bytes.length, "Render-v2 LZSS flags overran the compressed source.");
    const flags = bytes[source++];
    for (let bit = 1; bit <= 0x80 && target < output.length; bit <<= 1) {
      if ((flags & bit) === 0) {
        assert(source < bytes.length, "Render-v2 LZSS literal overran the compressed source.");
        output[target++] = bytes[source++];
        continue;
      }
      assert(source + 2 <= bytes.length, "Render-v2 LZSS match overran the compressed source.");
      const code = bytes.readUInt16LE(source); source += 2;
      const distance = (code & (LZSS_DISTANCE_MAX - 1)) + 1;
      const length = (code >>> LZSS_DISTANCE_BITS) + 3;
      assert(distance <= target && length <= output.length - target,
        "Render-v2 LZSS match escaped the decoded output bounds.");
      for (let index = 0; index < length; index += 1) {
        output[target] = output[target - distance]; target += 1;
      }
    }
  }
  assert(source === bytes.length, "Render-v2 LZSS stream has trailing compressed bytes.");
  return output;
}

const ASSET_DECODER_SOURCE = `
typedef unsigned char rv2_asset_u8;
typedef unsigned int rv2_asset_u32;
__attribute__((used,visibility("default"),section(".text.renderer_v2_assets")))
rv2_asset_u32 renderer_v2_decode_assets(rv2_asset_u8 *dst, rv2_asset_u32 dst_bytes,
    const rv2_asset_u8 *src, rv2_asset_u32 src_bytes) {
  rv2_asset_u32 in = 0u, out = 0u;
  while (out < dst_bytes) {
    rv2_asset_u32 flags, bit;
    if (in >= src_bytes) return 0u;
    flags = src[in++];
    for (bit = 1u; bit <= 0x80u && out < dst_bytes; bit <<= 1u) {
      if ((flags & bit) == 0u) {
        if (in >= src_bytes) return 0u;
        dst[out++] = src[in++];
      } else {
        rv2_asset_u32 code, distance, length, index;
        if (src_bytes - in < 2u) return 0u;
        code = (rv2_asset_u32)src[in] | ((rv2_asset_u32)src[in + 1u] << 8u); in += 2u;
        distance = (code & 1023u) + 1u; length = (code >> 10u) + 3u;
        if (distance > out || length > dst_bytes - out) return 0u;
        for (index = 0u; index < length; index++) { dst[out] = dst[out - distance]; out++; }
      }
    }
  }
  return in == src_bytes;
}
`;

function integrationChain({ compressedAssetAddress, compressedAssetBytes,
  baseBundleBytes, f2epBytes }) {
  const fn = LIVE_RENDER_V2_BASE.acceptedFunctions;
  const assetRamBytes = baseBundleBytes + f2epBytes;
  return `.section .literal.renderer_v2_chain,"a",@progbits
.balign 4
.Lwpm_register: .long 0x${fn.wpmRegister.toString(16)}
.Loperator_new: .long 0x${fn.operatorNew.toString(16)}
.Lcompressed_assets: .long 0x${compressedAssetAddress.toString(16)}
.Lcompressed_asset_bytes: .long ${compressedAssetBytes}
.Lbase_bundle_bytes: .long ${baseBundleBytes}
.Lf2ep_bytes: .long ${f2epBytes}
.Lasset_ram_bytes: .long ${assetRamBytes}
.section .text.renderer_v2_chain,"ax",@progbits
.balign 4
.global renderer_v2_combined_registration_chain
.type renderer_v2_combined_registration_chain,@function
renderer_v2_combined_registration_chain:
 entry a1,64
 mov a4,a2
 mov a5,a3
 mov a10,a4
 mov a11,a5
 l32r a8,.Lwpm_register
 callx8 a8
 mov a10,a4
 mov a11,a5
 call8 renderer_v1_register_id26
 beqz a10,.Lrender_v2_chain_done
 mov a6,a10
 l32r a10,.Lasset_ram_bytes
 l32r a8,.Loperator_new
 callx8 a8
 beqz a10,.Lrender_v2_register_scene_rpc
 mov a7,a10
 mov a10,a7
 l32r a11,.Lasset_ram_bytes
 l32r a12,.Lcompressed_assets
 l32r a13,.Lcompressed_asset_bytes
 call8 renderer_v2_decode_assets
 beqz a10,.Lrender_v2_register_scene_rpc
 mov a10,a6
 mov a11,a7
 l32r a12,.Lbase_bundle_bytes
 call8 renderer_v1_stage_bundle
 beqz a10,.Lrender_v2_register_scene_rpc
 mov a10,a6
 call8 renderer_v1_tick
 mov a10,a4
 mov a11,a5
 mov a12,a6
 movi a13,${baseBundleBytes}
 add a13,a7,a13
 l32r a14,.Lf2ep_bytes
 call8 renderer_v2_native_attach
.Lrender_v2_register_scene_rpc:
 mov a10,a6
 call8 renderer_scene_rpc_register
 beqz a10,.Lrender_v2_chain_done
 movi.n a8,1
 s32i.n a8,a10,8
 memw
 mov a11,a10
 mov a10,a6
 call8 renderer_v2_rpc_register
.Lrender_v2_chain_done:
 retw.n
.size renderer_v2_combined_registration_chain,.-renderer_v2_combined_registration_chain
`;
}

async function compileModule(directory, { nativeSource, baseAddress, compressedAssetAddress,
  compressedAssetBytes, baseBundleBytes, f2epBytes }) {
  const chainSource = integrationChain({ compressedAssetAddress, compressedAssetBytes,
    baseBundleBytes, f2epBytes });
  const chainPath = path.join(directory, "renderer-v2-chain.S");
  const assetDecoderPath = path.join(directory, "renderer-v2-assets.c");
  const rendererV1Path = path.join(directory, "renderer-v1-id26.c");
  const nativePath = path.join(directory, "renderer-v2-native.c");
  const nativeHeaderPath = path.join(directory, "renderer-v2-f2ep-native.h");
  const rpcPath = path.join(directory, "renderer-v2-event-rpc.S");
  const sceneRpcPath = path.join(directory, "renderer-v1-scene-rpc.S");
  const sceneRpcCorePath = path.join(directory, "renderer-v1-scene-rpc-core.c");
  const linkerPath = path.join(directory, "renderer-v2.ld");
  const chainObject = path.join(directory, "renderer-v2-chain.o");
  const assetDecoderObject = path.join(directory, "renderer-v2-assets.o");
  const rendererV1Object = path.join(directory, "renderer-v1-id26.o");
  const nativeObject = path.join(directory, "renderer-v2-native.o");
  const rpcObject = path.join(directory, "renderer-v2-event-rpc.o");
  const sceneRpcObject = path.join(directory, "renderer-v1-scene-rpc.o");
  const sceneRpcCoreObject = path.join(directory, "renderer-v1-scene-rpc-core.o");
  const elfPath = path.join(directory, "renderer-v2.elf");
  const binaryPath = path.join(directory, "renderer-v2.bin");
  const [nativeHeader, rendererV1Source, rawRpcSource, rawSceneRpcSource, sceneRpcCoreSource] =
    await Promise.all([
      readFile(NATIVE_HEADER, "utf8"), readFile(RENDERER_V1_SOURCE, "utf8"),
      readFile(RPC_SOURCE, "utf8"), readFile(SCENE_RPC_SOURCE, "utf8"),
      readFile(SCENE_RPC_CORE_SOURCE, "utf8"),
  ]);
  let sceneRpcSource = rawSceneRpcSource;
  for (const symbol of ["renderer_scene_rpc_register_one", "renderer_scene_rpc_read_integer",
    "renderer_scene_rpc_reply_status", "renderer_scene_rpc_make_root"]) {
    sceneRpcSource = sceneRpcSource.replace(`    .type ${symbol},@function`,
      `    .global ${symbol}\n    .type ${symbol},@function`);
  }
  const rpcSource = rawRpcSource
    .replace(".Lrv2_scene_register_one:        .long 0x4211f660",
      ".Lrv2_scene_register_one:        .long renderer_scene_rpc_register_one")
    .replace(".Lrv2_scene_make_root:           .long 0x4211f960",
      ".Lrv2_scene_make_root:           .long renderer_scene_rpc_make_root")
    .replace(".Lrv2_scene_read_integer:        .long 0x4211f8c4",
      ".Lrv2_scene_read_integer:        .long renderer_scene_rpc_read_integer")
    .replace(".Lrv2_scene_reply_status:        .long 0x4211f8f0",
      ".Lrv2_scene_reply_status:        .long renderer_scene_rpc_reply_status");
  assert(!/\.Lrv2_scene_(?:register_one|make_root|read_integer|reply_status):\s+\.long 0x4211/iu
    .test(rpcSource), "Integrated Render-v2 RPC retained a stale renderer-v1 helper address.");
  await Promise.all([
    writeFile(chainPath, chainSource),
    writeFile(assetDecoderPath, ASSET_DECODER_SOURCE),
    writeFile(rendererV1Path, rendererV1Source),
    writeFile(nativePath, nativeSource),
    writeFile(nativeHeaderPath, nativeHeader),
    writeFile(rpcPath, rpcSource),
    writeFile(sceneRpcPath, sceneRpcSource),
    writeFile(sceneRpcCorePath, sceneRpcCoreSource),
    writeFile(linkerPath, linker(baseAddress)),
  ]);
  await Promise.all([
    run(tool("as"), ["--longcalls", "-o", chainObject, chainPath]),
    run(tool("gcc"), ["-Os", "-std=c11", "-ffreestanding", "-fno-builtin",
      "-fdata-sections", "-ffunction-sections", "-mlongcalls",
      "-c", "-o", assetDecoderObject, assetDecoderPath]),
    run(tool("as"), ["--longcalls", "-o", rpcObject, rpcPath]),
    run(tool("as"), ["--longcalls", "-o", sceneRpcObject, sceneRpcPath]),
    run(tool("gcc"), ["-Os", "-std=c11", "-ffreestanding", "-fno-builtin", "-fno-jump-tables",
      "-fno-tree-switch-conversion", "-fdata-sections", "-ffunction-sections", "-mlongcalls",
      "-c", "-o", rendererV1Object, rendererV1Path]),
    run(tool("gcc"), ["-Os", "-std=c11", "-ffreestanding", "-fno-builtin", "-fno-jump-tables",
      "-fno-tree-switch-conversion", "-fdata-sections", "-ffunction-sections", "-mlongcalls",
      "-c", "-o", sceneRpcCoreObject, sceneRpcCorePath]),
    run(tool("gcc"), ["-Os", "-std=c11", "-ffreestanding", "-fno-builtin", "-fno-jump-tables",
      "-fno-tree-switch-conversion", "-fdata-sections", "-ffunction-sections", "-mlongcalls",
      "-c", "-o", nativeObject, nativePath]),
  ]);
  await run(tool("gcc"), ["-nostdlib", `-Wl,-T,${linkerPath}`, "-o", elfPath,
    chainObject, assetDecoderObject, rendererV1Object, sceneRpcCoreObject, sceneRpcObject,
    rpcObject, nativeObject, "-lgcc"]);
  const [header, relocations, symbolsText, disassembly] = await Promise.all([
    run(tool("objdump"), ["-f", "-h", elfPath]),
    run(tool("readelf"), ["-r", elfPath]),
    run(tool("nm"), ["-S", elfPath]),
    run(tool("objdump"), ["-d", elfPath]),
  ]);
  assert(/elf32-xtensa-le/u.test(header.stdout) && /There are no relocations/u.test(relocations.stdout),
    "Render-v2 append-only module must be ESP32-S3 little-endian and relocation-free.");
  await run(tool("objcopy"), ["-O", "binary", elfPath, binaryPath]);
  return Object.freeze({ bytes: await readFile(binaryPath), symbols: parseSymbols(symbolsText.stdout),
    disassembly: disassembly.stdout, chainSource, assetDecoderSource: ASSET_DECODER_SOURCE,
    rpcSource, nativeHeader, nativeSource,
    linkerSource: linker(baseAddress) });
}

async function compileCallPatch(directory, callAddress, targetAddress) {
  const sourcePath = path.join(directory, "call-patch.S");
  const linkerPath = path.join(directory, "call-patch.ld");
  const objectPath = path.join(directory, "call-patch.o");
  const elfPath = path.join(directory, "call-patch.elf");
  const binaryPath = path.join(directory, "call-patch.bin");
  await Promise.all([
    writeFile(sourcePath, `.section .text.render_v2_patch,"ax",@progbits\n.global render_v2_patch_call\nrender_v2_patch_call:\n call8 renderer_v2_combined_registration_chain\n`),
    writeFile(linkerPath, `renderer_v2_combined_registration_chain = 0x${targetAddress.toString(16)};\nSECTIONS { . = 0x${callAddress.toString(16)}; .patch : { *(.text.render_v2_patch) } /DISCARD/ : { *(.xtensa.info) *(.comment) } }\n`),
  ]);
  await run(tool("as"), ["-o", objectPath, sourcePath]);
  await run(tool("ld"), ["-T", linkerPath, "-o", elfPath, objectPath]);
  const relocations = await run(tool("readelf"), ["-r", elfPath]);
  assert(/There are no relocations/u.test(relocations.stdout), "Render-v2 setup-chain patch has relocations.");
  await run(tool("objcopy"), ["-O", "binary", elfPath, binaryPath]);
  const bytes = await readFile(binaryPath);
  assert(bytes.length === 3, `Render-v2 setup-chain patch is ${bytes.length} bytes instead of 3.`);
  return bytes;
}

function auditModule(module, { nativeIsStub }) {
  for (const name of ["renderer_v2_combined_registration_chain", "renderer_v1_register_id26",
    "renderer_v2_decode_assets",
    "renderer_v1_stage_bundle", "renderer_v1_tick", "renderer_scene_rpc_register",
    "renderer_scene_rpc_register_one", "renderer_scene_rpc_read_integer",
    "renderer_scene_rpc_reply_status", "renderer_scene_rpc_make_root",
    "renderer_v2_rpc_callback", "renderer_v2_rpc_handle",
    RENDER_V2_NATIVE_ABI.attach.symbol, RENDER_V2_NATIVE_ABI.rpcRegister.symbol,
    RENDER_V2_NATIVE_ABI.hostEvent.symbol, "renderer_v2_native_prepare",
    "renderer_v2_native_commit", "renderer_v2_native_cancel",
    "renderer_v2_timer_build", "renderer_v2_timer_cleanup", "renderer_v2_timer_id",
    "renderer_v2_timer_tick", "renderer_v2_timer_encoder"]) {
    assert(module.symbols.has(name), `Render-v2 combined module lost required symbol ${name}.`);
  }
  const chainStart = module.disassembly.indexOf("<renderer_v2_combined_registration_chain>:");
  const chainEnd = module.disassembly.indexOf("\n\n", chainStart);
  const chain = module.disassembly.slice(chainStart, chainEnd < 0 ? undefined : chainEnd);
  assert(chainStart >= 0 && /<renderer_v1_register_id26>/u.test(chain) &&
    /<renderer_v2_decode_assets>/u.test(chain) &&
    /<renderer_v1_stage_bundle>/u.test(chain) && /<renderer_v2_native_attach>/u.test(chain) &&
    /<renderer_scene_rpc_register>/u.test(chain) && /<renderer_v2_rpc_register>/u.test(chain),
  "Integrated Render-v2 chain lost renderer-v1, native attach, scene RPC, or event RPC.");
  assert(/call8 renderer_v2_native_attach\n\.Lrender_v2_register_scene_rpc:\n/du
    .test(module.chainSource) &&
    /call8 renderer_scene_rpc_register[\s\S]*call8 renderer_v2_rpc_register/du
      .test(module.chainSource) &&
    !/call8 renderer_v2_native_attach\n\s+beqz/du.test(module.chainSource),
  "Render-v2 event RPC must register even when native attach reports a failure.");
  assert(/l32r a10,\.Lasset_ram_bytes[\s\S]*callx8 a8[\s\S]*call8 renderer_v2_decode_assets/du
    .test(module.chainSource) &&
    /mov a11,a7\n\s+l32r a12,\.Lbase_bundle_bytes\n\s+call8 renderer_v1_stage_bundle/du
      .test(module.chainSource) &&
    /movi a13,748\n\s+add a13,a7,a13[\s\S]*call8 renderer_v2_native_attach/du
      .test(module.chainSource),
  "Render-v2 base scene and F2EP are not both sourced from the retained RAM copy.");
  for (const symbol of ["renderer_v2_native_prepare", "renderer_v2_native_commit",
    "renderer_v2_native_cancel"]) {
    assert(new RegExp(`<${symbol}>`, "u").test(module.disassembly),
      `Render-v2 scene core lost the ${symbol} handoff.`);
  }
  const timerTickSource = module.nativeSource.slice(
    module.nativeSource.indexOf("static void renderer_v2_timer_tick"),
    module.nativeSource.indexOf("static void renderer_v2_timer_encoder"));
  const oldTick = timerTickSource.indexOf("sidecar->old_tick(proxy->backend)");
  const baseRefresh = timerTickSource.indexOf("rv2_timer_base_refresh(sidecar, backend)");
  const baseDecode = timerTickSource.indexOf("rv2_decode_lzss(");
  const timerApply = timerTickSource.indexOf("renderer_v2_ui_tick(&sidecar->timer_runtime");
  const publish = timerTickSource.indexOf("RV2_FN_IMAGE_SET_SRC");
  assert(oldTick >= 0 && baseRefresh > oldTick && baseDecode > baseRefresh &&
    timerApply > baseDecode && publish > timerApply &&
    /rv2_register_timer_proxy\(sidecar, setup_owner, registry, controller\)/u
      .test(module.nativeSource),
  "ID27 proxy lost registration or its exact old-tick -> blue-decode -> timer-patch -> publish ordering.");
  return Object.freeze({
    baseAddress: module.symbols.get("renderer_v2_combined_registration_chain").address,
    entryAddress: module.symbols.get("renderer_v2_combined_registration_chain").address,
    bytes: module.bytes.length,
    sha256: sha256(module.bytes),
    relocations: 0,
    implementation: nativeIsStub ? "link-contract-stub" : "bounded-native",
  });
}

async function verifyNativeGolden(directory, { bootF2ep, bootBundle, focusF2ep, timerF2ep,
  focusBaseFrame, timerBaseFrame, timerBaseLzss, focusF1wb, focusPackageGenerationTwo }) {
  const executable = path.join(directory, "renderer-v2-native-host");
  const prefix = path.join(directory, "golden");
  const timerPrefix = path.join(directory, "timer-golden");
  const bootProgramPath = path.join(directory, "boot.f2ep");
  const bootBundlePath = path.join(directory, "boot.f1wb");
  const focusProgramPath = path.join(directory, "focus.f2ep");
  const timerProgramPath = path.join(directory, "timer.f2ep");
  const focusBasePath = path.join(directory, "focus.rgb565");
  const timerBasePath = path.join(directory, "timer.rgb565");
  const timerBaseLzssPath = path.join(directory, "timer-base.lzss");
  const focusBundlePath = path.join(directory, "focus.f1wb");
  const focusPackagePath = path.join(directory, "focus-generation-2.package");
  assert(bootF2ep.length === RENDER_V2_ASSET.f2epBytes &&
    sha256(bootF2ep) === RENDER_V2_ASSET.f2epSha256 &&
    bootBundle.length === RENDER_V2_ASSET.baseBundleBytes &&
    sha256(bootBundle) === RENDER_V2_ASSET.baseBundleSha256,
  "Render-v2 canonical bootstrap pair changed.");
  assert(focusF2ep.length === FOCUS_DIAL_ASSET.f2epBytes &&
    sha256(focusF2ep) === FOCUS_DIAL_ASSET.f2epSha256 &&
    focusBaseFrame.length === FOCUS_DIAL_ASSET.baseFrameBytes &&
    sha256(focusBaseFrame) === FOCUS_DIAL_ASSET.baseFrameSha256 &&
    focusF1wb.length === FOCUS_DIAL_ASSET.f1wbBytes &&
    sha256(focusF1wb) === FOCUS_DIAL_ASSET.f1wbSha256 &&
    timerF2ep.length === TIMER_ASSET.f2epBytes && sha256(timerF2ep) === TIMER_ASSET.f2epSha256 &&
    timerBaseFrame.length === TIMER_ASSET.timerBaseBytes &&
    sha256(timerBaseFrame) === TIMER_ASSET.timerBaseSha256 &&
    timerBaseLzss.length === TIMER_ASSET.timerBaseLzssBytes &&
    sha256(timerBaseLzss) === TIMER_ASSET.timerBaseLzssSha256 &&
    sha256(focusPackageGenerationTwo) === TIMER_ASSET.generationTwoPackageSha256,
  "Render-v2 canonical focus pair changed.");
  await Promise.all([writeFile(bootProgramPath, bootF2ep), writeFile(bootBundlePath, bootBundle),
    writeFile(focusProgramPath, focusF2ep), writeFile(timerProgramPath, timerF2ep),
    writeFile(focusBasePath, focusBaseFrame), writeFile(timerBasePath, timerBaseFrame),
    writeFile(timerBaseLzssPath, timerBaseLzss),
    writeFile(focusBundlePath, focusF1wb), writeFile(focusPackagePath, focusPackageGenerationTwo)]);
  await run("cc", ["-std=c11", "-O2", "-Wall", "-Wextra", "-I",
    path.dirname(NATIVE_SOURCE), "-o", executable, NATIVE_HOST]);
  await run(executable, ["admit", focusProgramPath]);
  await run(executable, ["admit-timer", timerProgramPath]);
  const timerBaseGate = await run(executable, ["timer-base", timerBaseLzssPath, timerBasePath]);
  await run(executable, ["admit-boot", bootProgramPath]);
  const fuzz = await run(executable, ["fuzz", focusProgramPath]);
  assert(/mutations=2048 structural_bounds=6 frozen_digest=pass/u.test(fuzz.stdout),
    "Native F2EP structural/digest fuzz gate did not pass.");
  const [scenario, timerScenario, wallRuntime, focusGate, bootGate, transition, contracts] = await Promise.all([
    run(executable, ["scenario", focusProgramPath, focusBasePath, prefix]),
    run(executable, ["timer-scenario", timerProgramPath, timerBasePath, timerPrefix]),
    run(executable, ["wall-runtime", focusProgramPath, focusBasePath]),
    run(executable, ["focus-base", focusBundlePath]),
    run(executable, ["boot-base", bootBundlePath]),
    run(executable, ["transition", bootProgramPath, focusPackagePath]),
    run(executable, ["contracts", focusProgramPath, focusBasePath]),
  ]);
  assert(/fail_last_good=1/u.test(scenario.stdout) &&
    /focus_f1wb_bytes=62404 frozen_digest=pass mutation=reject/u.test(focusGate.stdout) &&
    /boot_f1wb_bytes=748 frozen_digest=pass mutation=reject/u.test(bootGate.stdout) &&
    /EMPTY-PREPARED-CANCEL-EMPTY-PREPARED-COMMITTED-ACTIVE/u.test(transition.stdout) &&
    /error_gate=closed/u.test(transition.stdout) && /null_prepare=reject/u.test(transition.stdout) &&
    /rpc_b201=pass/u.test(contracts.stdout) && /first_timer_detent=preserved/u.test(transition.stdout) &&
    /same_tick=pass/u.test(timerScenario.stdout) && /hidden=pause/u.test(timerScenario.stdout) &&
    /rollover=0/u.test(wallRuntime.stdout) && /malformed_bcd_last_good=1/u.test(wallRuntime.stdout) &&
    /latency_reject=pass/u.test(wallRuntime.stdout) &&
    /reentry=7384/u.test(wallRuntime.stdout),
  "Native focus scenario, exact base gates, or paired transition contract failed.");
  assert(/timer_base_raw=62000 compressed=3335 exact_consumption=pass exact_sha=pass mutation=reject/u
    .test(timerBaseGate.stdout), "Native blue timer-base decode/admission gate failed.");
  const frames = await Promise.all(Array.from({ length: 7 }, (_, index) =>
    readFile(`${prefix}-${index}.rgb565`)));
  const hashes = frames.map(sha256);
  const timerFrames = await Promise.all(Array.from({ length: 7 }, (_, index) =>
    readFile(`${timerPrefix}-${index}.rgb565`)));
  const timerHashes = timerFrames.map(sha256);
  assert(JSON.stringify(hashes) === JSON.stringify(FOCUS_DIAL_ASSET.frameSha256) &&
    JSON.stringify(timerHashes) === JSON.stringify(TIMER_ASSET.frameSha256),
  "Native F2EP clock/Fn/RPC/last-good frames differ from compiler goldens.");
  return Object.freeze({ admit: "PASS", bootstrapAdmission: "PASS", focusBaseGate: "PASS",
    bootstrapBaseGate: "PASS", transition: "PASS", fuzz: "PASS", scenario: "PASS",
    frameSha256: hashes, timerFrameSha256: timerHashes,
    scenarioOutput: scenario.stdout.trim(), timerScenarioOutput: timerScenario.stdout.trim(),
    wallRuntimeOutput: wallRuntime.stdout.trim(), fuzzOutput: fuzz.stdout.trim(),
    transitionOutput: transition.stdout.trim(), contractsOutput: contracts.stdout.trim(),
    timerBaseOutput: timerBaseGate.stdout.trim() });
}

function compose({ liveApp, liveCode, module, compressedAssets, callPatch }) {
  const before = inspectEsp32AppImage(liveApp);
  const beforeIrom = before.segments[PINNED.iromSegmentIndex];
  const beforeDrom = before.segments[PINNED.dromSegmentIndex];
  assert(beforeIrom.data.subarray(beforeIrom.length - liveCode.length).equals(liveCode),
    "Accepted 7838 app does not end its IROM segment with the pinned combined code.");
  assert(module.length <= LIVE_RENDER_V2_BASE.rendererModuleBytes,
    `Integrated Render-v2 module is ${module.length} bytes; fixed cavity is ${LIVE_RENDER_V2_BASE.rendererModuleBytes}.`);
  const compressedOffset = COMPRESSED_ASSET_ADDRESS - beforeDrom.loadAddress;
  assert(compressedOffset >= 0 && compressedAssets.length <= COMPRESSED_ASSET_CAPACITY &&
    compressedOffset + COMPRESSED_ASSET_CAPACITY <= beforeDrom.length &&
    beforeDrom.data.subarray(compressedOffset,
      compressedOffset + compressedAssets.length).equals(compressedAssets) &&
    beforeDrom.data.subarray(compressedOffset + compressedAssets.length,
      compressedOffset + COMPRESSED_ASSET_CAPACITY).every((value) => value === 0),
  "Accepted 7838 mapped-page1C bootstrap blob or remaining guard bytes changed.");
  let app = Buffer.from(liveApp);
  const codeFileOffset = beforeIrom.dataOffset +
    beforeIrom.length - liveCode.length;
  const patchOffset = LIVE_RENDER_V2_BASE.wrapperChainCallAddress - PINNED.codeBaseAddress;
  assert(liveCode.subarray(patchOffset, patchOffset + 3).toString("hex") ===
    LIVE_RENDER_V2_BASE.wrapperChainCallBytes, "Accepted setup-chain call bytes changed.");
  const candidateCode = Buffer.from(liveCode);
  callPatch.copy(candidateCode, patchOffset);
  candidateCode.fill(0, LIVE_RENDER_V2_BASE.rendererModuleOffset,
    LIVE_RENDER_V2_BASE.rendererModuleOffset + LIVE_RENDER_V2_BASE.rendererModuleBytes);
  module.copy(candidateCode, LIVE_RENDER_V2_BASE.rendererModuleOffset);
  candidateCode.copy(app, codeFileOffset);
  app = repairEsp32AppIntegrity(app);
  const after = inspectEsp32AppImage(app);
  const writtenCode = after.segments[PINNED.iromSegmentIndex].data
    .subarray(beforeIrom.length - liveCode.length);
  assert(writtenCode.equals(candidateCode), "Integrated Render-v2 cavity write changed after repair.");
  assert(candidateCode.subarray(0, patchOffset).equals(liveCode.subarray(0, patchOffset)) &&
    candidateCode.subarray(patchOffset + 3, LIVE_RENDER_V2_BASE.rendererModuleOffset)
      .equals(liveCode.subarray(patchOffset + 3, LIVE_RENDER_V2_BASE.rendererModuleOffset)) &&
    candidateCode.subarray(LIVE_RENDER_V2_BASE.rendererModuleOffset,
      LIVE_RENDER_V2_BASE.rendererModuleOffset + module.length).equals(module),
  "Render-v2 candidate escaped the wrapper-call plus fixed renderer cavity replacement.");
  assert(after.segments[PINNED.iromSegmentIndex].loadAddress +
    after.segments[PINNED.iromSegmentIndex].length <= IROM_DROM_ALIAS_BOUNDARY,
  "Render-v2 candidate crosses the ESP32-S3 IROM/DROM MMU alias boundary.");
  assert(after.segments[PINNED.iromSegmentIndex].length === beforeIrom.length,
    "Render-v2 candidate changed the accepted IROM segment length.");
  assert(after.segments[PINNED.dromSegmentIndex].data.equals(beforeDrom.data),
    "Clock+timer candidate changed the accepted 7838 DROM segment.");
  assert(app.length === liveApp.length && after.segmentCount === before.segmentCount,
    "Clock+timer candidate changed accepted app bytes or segment count.");
  for (let index = 0; index < before.segmentCount; index += 1) {
    assert(before.segments[index].loadAddress === after.segments[index].loadAddress &&
      before.segments[index].length === after.segments[index].length &&
      before.segments[index].dataOffset === after.segments[index].dataOffset,
    `Render-v2 candidate segment ${index} layout changed.`);
    if (index !== PINNED.iromSegmentIndex && index !== PINNED.dromSegmentIndex) {
      assert(before.segments[index].data.equals(after.segments[index].data),
        `Render-v2 candidate changed preserved segment ${index}.`);
    }
  }
  return Object.freeze({ app, info: after, candidateCode, patchOffset, compressedOffset });
}

function flashCommand({ appPath, approvalPath }) {
  return `node ${path.join(SDK_ROOT, "bin/f1-widget.mjs")} deploy --app ${appPath} --approval ${approvalPath} --rollback ${LIVE_APP} --confirm-app-only`;
}

/**
 * Build only; this function never discovers, opens, resets, or writes hardware.
 * A stub build freezes the integration ABI but emits a deliberately blocked
 * approval. Pass a reviewed native C source to make the native lane auditable.
 */
export async function buildCombinedRendererV2Firmware({
  outputDirectory = path.join(SDK_ROOT, "build/combined-renderer-v2-clock-blue-timer"),
  nativeSourcePath = STUB_SOURCE,
  nativeContractAccepted = false,
} = {}) {
  const started = Date.now();
  const outputRoot = path.resolve(outputDirectory);
  const nativePath = path.resolve(nativeSourcePath);
  const nativeIsStub = nativePath === path.resolve(STUB_SOURCE);
  assert(nativeContractAccepted === false || !nativeIsStub,
    "The Render-v2 link-contract stub can never be accepted as native firmware.");
  assert(nativeContractAccepted === false || nativePath === path.resolve(NATIVE_SOURCE),
    "Only the hash-pinned canonical native F2EP source can receive a device approval.");
  await mkdir(outputRoot, { recursive: true });
  // An earlier rejected experiment placed the module in IRAM via these files.
  // Remove them on every build so no operator can mistake stale unsafe bytes
  // for part of the fixed-cavity/DROM-page candidate.
  await Promise.all(["renderer-v2-irom-trampoline.bin", "renderer-v2-irom-trampoline.S",
    "renderer-v2-irom-trampoline.ld", "renderer-v2-irom-trampoline-disassembly.txt",
    "renderer-v2-drom-page.bin", "focus-dial.generation-2.package.bin"]
    .map((name) => rm(path.join(outputRoot, name), { force: true })));
  const [liveApp, receiptBytes, scene, atlas, f2ep, demoManifest, nativeSource,
    nativeHeader, nativeHost, officialMerged, focusBaseFrame, focusF1wb,
    focusF2ep, focusPackage, focusManifest, focusPublisher, timerF2ep,
    timerBaseFrame, timerBaseLzss, focusTimerPackage, timerManifest, secondary49cb] = await Promise.all([
    readFile(LIVE_APP), readFile(LIVE_RECEIPT), readFile(SCENE), readFile(ATLAS), readFile(F2EP),
    readFile(DEMO_MANIFEST, "utf8").then(JSON.parse), readFile(nativePath, "utf8"),
    readFile(NATIVE_HEADER, "utf8"), readFile(NATIVE_HOST, "utf8"),
    readFile(PINNED.officialMerged.path), readFile(FOCUS_BASE_FRAME), readFile(FOCUS_F1WB),
    readFile(FOCUS_F2EP), readFile(FOCUS_PACKAGE),
    readFile(FOCUS_MANIFEST, "utf8").then(JSON.parse), readFile(FOCUS_PUBLISHER, "utf8"),
    readFile(TIMER_F2EP), readFile(TIMER_BASE_FRAME), readFile(TIMER_BASE_LZSS),
    readFile(FOCUS_TIMER_PACKAGE),
    readFile(TIMER_MANIFEST, "utf8").then(JSON.parse),
    readFile(SECONDARY_49CB_APP),
  ]);
  if (!nativeIsStub) {
    assert(sha256(Buffer.from(nativeSource)) === PINNED_NATIVE.sourceSha256 &&
      sha256(Buffer.from(nativeHeader)) === PINNED_NATIVE.headerSha256 &&
      sha256(Buffer.from(nativeHost)) === PINNED_NATIVE.hostSha256,
    "Canonical native F2EP source/header/host harness changed after audit freeze.");
  }
  assert(liveApp.length === LIVE_RENDER_V2_BASE.appBytes &&
    sha256(liveApp) === LIVE_RENDER_V2_BASE.appSha256 &&
    sha256(receiptBytes) === LIVE_RENDER_V2_BASE.receiptSha256,
  "Render-v2 build is not based on the exact accepted 7838 app and receipt.");
  const receipt = JSON.parse(receiptBytes);
  assert(receipt.format === "framer-f1-device-deployment-receipt-v1" && receipt.mode === "fast-smoke" &&
    receipt.app?.bytes === liveApp.length && receipt.app?.sha256 === sha256(liveApp) &&
    receipt.write?.appOnly === true && receipt.write?.hashVerifiedByEsptool === true &&
    receipt.target?.mac === "a4:cb:8f:af:32:10" &&
    receipt.postBoot?.device?.deviceType === "knob_f1" && receipt.postBoot?.version === "0.4.1",
  "Render-v2 rollback receipt is not the accepted healthy 7838 app-only proof.");
  const recovery = await readFile(resolveRecordedPath(receipt.recovery.fullFlash));
  assert(recovery.length === receipt.recovery.bytes && sha256(recovery) === receipt.recovery.sha256,
    "Render-v2 secondary full-flash recovery changed.");
  assert(secondary49cb.length === 2_062_912 &&
    sha256(secondary49cb) === "49cbf8801e3d86b20e0df21f41a2410b3e4d8547f8f64021ca6ed4bd85168840",
  "Render-v2 secondary 49cb app recovery changed.");
  assert(scene.length === RENDER_V2_ASSET.sceneBytes && sha256(scene) === RENDER_V2_ASSET.sceneSha256 &&
    atlas.length === RENDER_V2_ASSET.atlasBytes && sha256(atlas) === RENDER_V2_ASSET.atlasSha256 &&
    f2ep.length === RENDER_V2_ASSET.f2epBytes && sha256(f2ep) === RENDER_V2_ASSET.f2epSha256 &&
    demoManifest.program?.sha256 === RENDER_V2_ASSET.f2epSha256,
  "Render-v2 scene, atlas, F2EP, or compiler manifest changed.");
  const baseBundle = encodeWidgetBundle({ generation: 1, activeSlot: 0,
    slots: [{ name: "render-v2", kind: "semantic", sceneBinary: scene, atlasBinary: atlas }] }).binary;
  assert(baseBundle.length === RENDER_V2_ASSET.baseBundleBytes &&
    sha256(baseBundle) === RENDER_V2_ASSET.baseBundleSha256,
  "Render-v2 one-slot base F1WB changed.");
  assert(focusBaseFrame.length === FOCUS_DIAL_ASSET.baseFrameBytes &&
    sha256(focusBaseFrame) === FOCUS_DIAL_ASSET.baseFrameSha256 &&
    focusF1wb.length === FOCUS_DIAL_ASSET.f1wbBytes &&
    sha256(focusF1wb) === FOCUS_DIAL_ASSET.f1wbSha256 &&
    focusF2ep.length === FOCUS_DIAL_ASSET.f2epBytes &&
    sha256(focusF2ep) === FOCUS_DIAL_ASSET.f2epSha256 &&
    focusPackage.length === FOCUS_DIAL_ASSET.packageBytes &&
    sha256(focusPackage) === FOCUS_DIAL_ASSET.packageSha256 &&
    focusPackage.subarray(0, focusF1wb.length).equals(focusF1wb) &&
    focusPackage.subarray(focusF1wb.length).equals(focusF2ep),
  "Focus-dial F1WB/F2EP composite differs from its frozen contiguous layout.");
  assert(timerF2ep.length === TIMER_ASSET.f2epBytes &&
    sha256(timerF2ep) === TIMER_ASSET.f2epSha256 &&
    timerBaseFrame.length === TIMER_ASSET.timerBaseBytes &&
    sha256(timerBaseFrame) === TIMER_ASSET.timerBaseSha256 &&
    timerBaseLzss.length === TIMER_ASSET.timerBaseLzssBytes &&
    sha256(timerBaseLzss) === TIMER_ASSET.timerBaseLzssSha256 &&
    decodeLzss(timerBaseLzss, timerBaseFrame.length).equals(timerBaseFrame) &&
    focusTimerPackage.length === TIMER_ASSET.packageBytes &&
    sha256(focusTimerPackage) === TIMER_ASSET.generationOnePackageSha256 &&
    focusTimerPackage.subarray(0, focusF1wb.length).equals(focusF1wb) &&
    focusTimerPackage.subarray(focusF1wb.length,
      focusF1wb.length + focusF2ep.length).equals(focusF2ep) &&
    focusTimerPackage.subarray(focusF1wb.length + focusF2ep.length,
      focusF1wb.length + focusF2ep.length + timerF2ep.length).equals(timerF2ep) &&
    focusTimerPackage.subarray(focusF1wb.length + focusF2ep.length + timerF2ep.length)
      .equals(timerBaseLzss) &&
    timerManifest.sharedStore?.capacityBytes === TIMER_ASSET.sceneStoreBytes &&
    timerManifest.sharedStore?.bytes === TIMER_ASSET.packageBytes &&
    timerManifest.sharedStore?.remainingBytes === TIMER_ASSET.storeHeadroomBytes,
  "Focus-clock + timer atomic scene-store layout changed.");
  assert(focusF1wb.subarray(0, 4).toString("ascii") === "F1WB" &&
    focusF1wb.readUInt32LE(8) === 1 && focusF1wb.readUInt32LE(12) === focusF1wb.length &&
    focusManifest.livePackage?.bundleSha256 === FOCUS_DIAL_ASSET.f1wbSha256 &&
    focusManifest.livePackage?.programSha256 === FOCUS_DIAL_ASSET.f2epSha256 &&
    focusManifest.livePackage?.sha256 === FOCUS_DIAL_ASSET.packageSha256 &&
    /--confirm-live-rpc/u.test(focusPublisher) && !/sync-local-time/u.test(focusPublisher),
  "Focus-dial package recipe, generation-one seed, or explicit publisher gate changed.");
  const decodedFocus = decodeWidgetBundle(focusF1wb);
  assert(decodedFocus.generation === 1 && decodedFocus.activeSlot === 0 &&
    decodedFocus.slots.length === 1 && decodedFocus.slots[0].name === "focus-dial" &&
    decodedFocus.slots[0].kind === "raster" &&
    decodedFocus.slots[0].animationBinary.length === FOCUS_DIAL_ASSET.f1raBytes &&
    sha256(decodedFocus.slots[0].animationBinary) === FOCUS_DIAL_ASSET.f1raSha256,
  "Focus-dial F1WB lost its exact one-frame raster payload.");
  const focusF1wbGenerationTwo = encodeWidgetBundle({ generation: 2, activeSlot: 0,
    slots: [{ name: "focus-dial", kind: "raster",
      animationBinary: decodedFocus.slots[0].animationBinary }] }).binary;
  const focusPackageGenerationTwo = Buffer.concat([
    focusF1wbGenerationTwo, focusF2ep, timerF2ep, timerBaseLzss,
  ]);
  assert(focusF1wbGenerationTwo.length === FOCUS_DIAL_ASSET.f1wbBytes &&
    sha256(focusF1wbGenerationTwo) === TIMER_ASSET.generationTwoF1wbSha256 &&
    focusPackageGenerationTwo.length === TIMER_ASSET.packageBytes &&
    sha256(focusPackageGenerationTwo) === TIMER_ASSET.generationTwoPackageSha256,
  "Focus-clock + timer generation-two live package changed.");

  const liveInfo = inspectEsp32AppImage(liveApp);
  for (const [label, pin] of Object.entries(RTC_ABI)) {
    const segment = liveInfo.segments[pin.segmentIndex];
    assert(segment && segment.loadAddress + pin.offset === pin.address &&
      sha256(segment.data.subarray(pin.offset, pin.offset + pin.bytes)) === pin.sha256,
    `Accepted 7838 ${label} RTC ABI window changed.`);
  }
  const irom = liveInfo.segments[PINNED.iromSegmentIndex].data;
  const liveCode = Buffer.from(irom.subarray(irom.length - LIVE_RENDER_V2_BASE.codeBytes));
  assert(liveCode.length === LIVE_RENDER_V2_BASE.codeBytes &&
    sha256(liveCode) === LIVE_RENDER_V2_BASE.codeSha256,
  "Accepted 7838 combined IROM suffix changed.");
  for (const [name, slice] of Object.entries(LIVE_RENDER_V2_BASE.slices)) assertSlice(liveCode, slice, name);
  assert(sha256(liveCode.subarray(LIVE_RENDER_V2_BASE.rendererModuleOffset,
    LIVE_RENDER_V2_BASE.rendererModuleOffset + LIVE_RENDER_V2_BASE.rendererModuleBytes)) ===
    LIVE_RENDER_V2_BASE.rendererModuleSha256, "Accepted renderer-v1 ID26 module changed.");

  const moduleBase = PINNED.codeBaseAddress + LIVE_RENDER_V2_BASE.rendererModuleOffset;
  const rawAssets = Buffer.concat([baseBundle, f2ep]);
  const compressedAssets = encodeLzss(rawAssets);
  assert(compressedAssets.length <= COMPRESSED_ASSET_CAPACITY &&
    decodeLzss(compressedAssets, rawAssets.length).equals(rawAssets),
  "Render-v2 deterministic LZSS assets do not fit or round-trip exactly.");
  const temporary = await mkdtemp(path.join(os.tmpdir(), "f1-combined-render-v2-"));
  try {
    const firstDirectory = path.join(temporary, "first");
    const secondDirectory = path.join(temporary, "second");
    await Promise.all([mkdir(firstDirectory), mkdir(secondDirectory)]);
    const [first, second] = await Promise.all([
      compileModule(firstDirectory, { nativeSource, baseAddress: moduleBase,
        compressedAssetAddress: COMPRESSED_ASSET_ADDRESS,
        compressedAssetBytes: compressedAssets.length,
        baseBundleBytes: baseBundle.length, f2epBytes: f2ep.length }),
      compileModule(secondDirectory, { nativeSource, baseAddress: moduleBase,
        compressedAssetAddress: COMPRESSED_ASSET_ADDRESS,
        compressedAssetBytes: compressedAssets.length,
        baseBundleBytes: baseBundle.length, f2epBytes: f2ep.length }),
    ]);
    assert(first.bytes.equals(second.bytes), "Two Render-v2 append-only module builds differ.");
    const moduleAudit = auditModule(first, { nativeIsStub });
    const nativeGolden = nativeIsStub ? null : await verifyNativeGolden(firstDirectory, {
      bootF2ep: f2ep, bootBundle: baseBundle, focusF2ep, focusBaseFrame, focusF1wb,
      timerF2ep, timerBaseFrame, timerBaseLzss, focusPackageGenerationTwo,
    });
    const callPatch = await compileCallPatch(firstDirectory,
      LIVE_RENDER_V2_BASE.wrapperChainCallAddress, moduleAudit.entryAddress);
    const firstImage = compose({ liveApp, liveCode, module: first.bytes, compressedAssets, callPatch });
    const secondImage = compose({ liveApp, liveCode, module: second.bytes, compressedAssets, callPatch });
    assert(firstImage.app.equals(secondImage.app), "Two Render-v2 combined app builds differ.");
    for (const [name, slice] of Object.entries(LIVE_RENDER_V2_BASE.slices)) {
      assertSlice(firstImage.candidateCode, slice, `${name} candidate`);
    }
    assert(firstImage.app.length <= PINNED.factoryPartitionBytes,
      "Render-v2 app exceeds the factory partition.");

    const merged = Buffer.concat([officialMerged.subarray(0, PINNED.appFlashOffset), firstImage.app]);
    const appPath = path.join(outputRoot, APP_NAME);
    const mergedPath = path.join(outputRoot, MERGED_NAME);
    const codePath = path.join(outputRoot, CODE_NAME);
    const modulePath = path.join(outputRoot, MODULE_NAME);
    const manifestPath = path.join(outputRoot, MANIFEST_NAME);
    const approvalPath = path.join(outputRoot, APPROVAL_NAME);
    const commandPath = path.join(outputRoot, FLASH_COMMAND_NAME);
    const provisionCommandPath = path.join(outputRoot, PROVISION_COMMAND_NAME);
    const compressedAssetsPath = path.join(outputRoot, COMPRESSED_ASSETS_NAME);
    const focusBaseFramePath = path.join(outputRoot, "focus-dial.base.rgb565");
    const focusF1wbPath = path.join(outputRoot, "focus-dial.generation-1.f1wb");
    const focusF2epPath = path.join(outputRoot, "focus-dial.f2ep");
    const timerF2epPath = path.join(outputRoot, "focus-timer.f2ep");
    const timerBaseFramePath = path.join(outputRoot, "focus-timer.base.rgb565");
    const timerBaseLzssPath = path.join(outputRoot, "focus-timer.base.lzss");
    const focusPackagePath = path.join(outputRoot, "focus-dial.generation-1.package.bin");
    const focusTimerPackagePath = path.join(outputRoot,
      "focus-clock-timer.generation-1.package.bin");
    const focusPackageGenerationTwoPath = path.join(outputRoot,
      "focus-clock-timer.generation-2.package.bin");
    await Promise.all([
      writeFile(appPath, firstImage.app), writeFile(mergedPath, merged),
      writeFile(codePath, firstImage.candidateCode), writeFile(modulePath, first.bytes),
      writeFile(compressedAssetsPath, compressedAssets),
      writeFile(path.join(outputRoot, "renderer-v2-chain.S"), first.chainSource),
      writeFile(path.join(outputRoot, "renderer-v2-assets.c"), first.assetDecoderSource),
      writeFile(path.join(outputRoot, "renderer-v2.ld"), first.linkerSource),
      writeFile(path.join(outputRoot, "renderer-v2-disassembly.txt"), first.disassembly),
      writeFile(path.join(outputRoot, "render-v2-base.f1wb"), baseBundle),
      writeFile(path.join(outputRoot, "render-v2-events.f2ep"), f2ep),
      writeFile(path.join(outputRoot, "renderer-v2-native-source.c"), nativeSource),
      writeFile(focusBaseFramePath, focusBaseFrame), writeFile(focusF1wbPath, focusF1wb),
      writeFile(focusF2epPath, focusF2ep), writeFile(focusPackagePath, focusPackage),
      writeFile(timerF2epPath, timerF2ep),
      writeFile(timerBaseFramePath, timerBaseFrame), writeFile(timerBaseLzssPath, timerBaseLzss),
      writeFile(focusTimerPackagePath, focusTimerPackage),
      writeFile(focusPackageGenerationTwoPath, focusPackageGenerationTwo),
    ]);
    const [inspection, imageInfo] = await Promise.all([
      inspectImage(appPath),
      run(STAGE3E3_PATHS.esptool, ["image-info", appPath],
        { cwd: WORKSPACE_ROOT, maxBuffer: 4 * 1024 * 1024 }),
    ]);
    assert(/ESP32-S3/iu.test(imageInfo.stdout) && /Validation hash:/iu.test(imageInfo.stdout),
      "Render-v2 candidate failed esptool image-info.");

    const nativeAccepted = !nativeIsStub && nativeContractAccepted === true;
    const command = flashCommand({ appPath, approvalPath });
    const provisionCommand = `node ${FOCUS_PUBLISHER} --confirm-live-rpc`;
    const manifest = {
      format: "framer-f1-combined-renderer-v2-clock-blue-timer-candidate-v1",
      status: nativeAccepted ? "DEVICE_SMOKE_CANDIDATE" : "NATIVE_CONTRACT_STUB",
      deployable: nativeAccepted,
      target: { device: "knob_f1", firmware: "0.4.1",
        screenIds: { music: 1, wpm: 7, focusClock: 26, focusTimer: 27 } },
      liveBase: { proofId: LIVE_RENDER_V2_BASE.proofId,
        app: { file: LIVE_APP, bytes: liveApp.length, sha256: sha256(liveApp) },
        receipt: { file: LIVE_RECEIPT, bytes: receiptBytes.length, sha256: sha256(receiptBytes),
          appOnly: true, postBootHealthy: true, esptoolWriteHashVerified: true } },
      setup: { soleWrapper: "f1_combined_setup_wrapper", stockSetupCalls: 1,
        order: ["stock", "music_id1_register", "stage3e34_register_wpm", "renderer_id26_register",
          "renderer_v2_decode_assets", "renderer_v2_native_attach", "renderer_scene_rpc_register",
          "renderer_v2_rpc_register"],
        additiveController: { id: 27, registeredBy: "renderer_v2_native_attach",
          controllerBytes: 136, addController: "0x4204da84", addNavigation: "0x420293a8" },
        mutation: { address: `0x${LIVE_RENDER_V2_BASE.wrapperChainCallAddress.toString(16)}`,
          bytes: callPatch.length, acceptedBytes: LIVE_RENDER_V2_BASE.wrapperChainCallBytes,
          candidateBytes: callPatch.toString("hex"), preservedByteForByte: callPatch.toString("hex") ===
            LIVE_RENDER_V2_BASE.wrapperChainCallBytes,
          purpose: "redirect accepted WPM+renderer chain call to the fused renderer-v1+v2 IROM cavity entry" },
        runtimeMapMutations: [],
      },
      preservation: {
        musicLiteral: { ...LIVE_RENDER_V2_BASE.slices.musicLiteral, preservedByteForByte: true },
        musicText: { ...LIVE_RENDER_V2_BASE.slices.musicText, preservedByteForByte: true },
        wpmLiteral: { ...LIVE_RENDER_V2_BASE.slices.wpmLiteral, preservedByteForByte: true },
        wpmText: { ...LIVE_RENDER_V2_BASE.slices.wpmText, preservedByteForByte: true },
        rendererV1Behavior: { source: RENDERER_V1_SOURCE, screenId: 26,
          sceneRpcSource: SCENE_RPC_SOURCE, retainedInIntegratedRebuild: true },
        allLiveDromAssets: { bytes: liveInfo.segments[PINNED.dromSegmentIndex].length,
          sha256: sha256(liveInfo.segments[PINNED.dromSegmentIndex].data),
          preservedByteForByte: true, appendedBytes: 0, mutationBytes: 0,
          reusedExistingBootstrapBlob: { address: `0x${COMPRESSED_ASSET_ADDRESS.toString(16)}`,
            bytes: compressedAssets.length, sha256: sha256(compressedAssets),
            capacity: COMPRESSED_ASSET_CAPACITY } },
      },
      rendererV2: {
        screenId: 26, timerScreenId: 27, nativeAbi: RENDER_V2_NATIVE_ABI,
        baseScene: { file: path.join(outputRoot, "render-v2-base.f1wb"), bytes: baseBundle.length,
          sha256: sha256(baseBundle), storage: "boot-lifetime decoded RAM", ramOffset: 0 },
        program: { file: path.join(outputRoot, "render-v2-events.f2ep"), bytes: f2ep.length,
          sha256: sha256(f2ep), storage: "boot-lifetime decoded RAM",
          ramOffset: baseBundle.length },
        module: { file: modulePath, baseAddress: `0x${moduleBase.toString(16)}`,
          entryAddress: `0x${moduleAudit.entryAddress.toString(16)}`, bytes: moduleAudit.bytes,
          sha256: moduleAudit.sha256, relocations: 0, deterministicRebuilds: 2,
          implementation: moduleAudit.implementation, source: nativePath,
          placement: { segmentIndex: PINNED.iromSegmentIndex, kind: "fixed-cavity-replacement",
            range: [`0x${moduleBase.toString(16)}`,
              `0x${(moduleBase + moduleAudit.bytes).toString(16)}`],
            cavityBytes: LIVE_RENDER_V2_BASE.rendererModuleBytes,
            chipBoundExclusive: `0x${IROM_DROM_ALIAS_BOUNDARY.toString(16)}` } },
        compressedAssets: { file: compressedAssetsPath,
          address: `0x${COMPRESSED_ASSET_ADDRESS.toString(16)}`,
          bytes: compressedAssets.length, sha256: sha256(compressedAssets),
          decodedBytes: rawAssets.length, decodedSha256: sha256(rawAssets),
          codec: "lzss-1k-len3-66-v1", capacity: COMPRESSED_ASSET_CAPACITY,
          mappingRule: "already-mapped DROM page 1C; no segment growth or cpu_start patch" },
        nativeSources: { c: { file: nativePath, bytes: Buffer.byteLength(nativeSource),
          sha256: sha256(Buffer.from(nativeSource)) },
          header: { file: NATIVE_HEADER, bytes: Buffer.byteLength(first.nativeHeader),
            sha256: sha256(Buffer.from(first.nativeHeader)) } },
        golden: nativeGolden,
        focusDial: {
          activation: "one exact generation-paired scene-store commit per boot",
          expectedGeneration: FOCUS_DIAL_ASSET.expectedGeneration,
          generation: FOCUS_DIAL_ASSET.generation,
          sceneStore: { bytes: TIMER_ASSET.sceneStoreBytes,
            packageBytes: focusPackageGenerationTwo.length, chunks: TIMER_ASSET.chunks,
            finalChunkBytes: TIMER_ASSET.lastChunkBytes,
            headroomBytes: TIMER_ASSET.storeHeadroomBytes,
            immutableAfterCommit: true },
          baseFrame: { file: focusBaseFramePath, bytes: focusBaseFrame.length,
            sha256: sha256(focusBaseFrame), pixelFormat: "RGB565-LE", viewport: "100x310" },
          rasterBundleTemplate: { file: focusF1wbPath, generation: 1, bytes: focusF1wb.length,
            sha256: sha256(focusF1wb), f1raBytes: FOCUS_DIAL_ASSET.f1raBytes,
            f1raSha256: FOCUS_DIAL_ASSET.f1raSha256, fps: 1, cadenceMs: 1_000,
            slotName: "focus-dial" },
          program: { file: focusF2epPath, bytes: focusF2ep.length,
            sha256: sha256(focusF2ep) },
          generationOnePackage: { file: focusTimerPackagePath, bytes: focusTimerPackage.length,
            sha256: sha256(focusTimerPackage) },
          generationTwoPackage: { file: focusPackageGenerationTwoPath,
            bytes: focusPackageGenerationTwo.length, sha256: sha256(focusPackageGenerationTwo) },
          publisher: { file: FOCUS_PUBLISHER, command: provisionCommand,
            explicitLiveAuthority: "--confirm-live-rpc", uiActivationWaitMs: 250,
            postCommitHostClockSync: null },
        },
        focusTimer: {
          screenId: 27,
          program: { file: timerF2epPath, bytes: timerF2ep.length,
            sha256: sha256(timerF2ep) },
          blueBase: { raw: { file: timerBaseFramePath, bytes: timerBaseFrame.length,
            sha256: sha256(timerBaseFrame) },
          lzss: { file: timerBaseLzssPath, bytes: timerBaseLzss.length,
            sha256: sha256(timerBaseLzss), codec: "lzss-1k-len3-66-v1",
            exactSourceConsumption: true }, palette: "dark-sky-blue",
          ordering: "renderer-v1 old_tick -> exact blue-base decode -> timer patches -> opposite descriptor" },
          input: { modifier: "Fn", encoderId: 1, stepSeconds: 300,
            consumeOnlyModifiedBottomEncoder: true, unmodifiedFallsThroughToNavigation: true },
          countdown: { initialSeconds: 1500, clampSeconds: [300, 5700],
            tickSeconds: 1, editVisibleSameUiTick: true, autoRunsAfterEdit: true },
          lifecycle: { hiddenPolicy: "pause", sharedFramebufferWithScreenId: 26,
            fullBaseRepaintBeforeEveryPatch: true, proxyControllerBytes: 136 },
          dialAnimation: { cadenceMs: 1_000, positions: 5, clock: true, timer: true,
            fnImmediate: true, sameSecondFnAndTickCompose: true },
          headerTopPaddingPx: 4,
        },
        rtc: {
          source: "stock-wl-rtc-synchronous-snapshot",
          decode: { address: `0x${RTC_ABI.decode.address.toString(16)}`,
            bytes: RTC_ABI.decode.bytes, sha256: RTC_ABI.decode.sha256 },
          monotonic: { address: `0x${RTC_ABI.monotonic.address.toString(16)}`,
            bytes: RTC_ABI.monotonic.bytes, sha256: RTC_ABI.monotonic.sha256 },
          freshnessUs: 20_000, hostClockSyncRequired: false,
          malformedBcdPolicy: "0xff sentinels plus valid/range gate retain last-good",
          activation: "poll first ID26 tick/re-entry and once per visible second",
        },
        rpc: { method: "widget.v2.event", fixedEventId: 0xb201,
          fixedEventIdHex: "0xB201", params: { id: "uint16 fixed 0xB201", value: "int32" },
          response: "exact RAM-backed status-only acknowledgment", uiThreadRule: "enqueue only in RPC callback" },
      },
      outputs: { app: { file: appPath, bytes: firstImage.app.length, sha256: sha256(firstImage.app) },
        merged: { file: mergedPath, bytes: merged.length, sha256: sha256(merged) },
        code: { file: codePath, bytes: firstImage.candidateCode.length,
          sha256: sha256(firstImage.candidateCode) }, inspection },
      rollback: { immediate: { file: LIVE_APP, bytes: liveApp.length, sha256: sha256(liveApp),
        receipt: { file: LIVE_RECEIPT, sha256: sha256(receiptBytes) } },
        secondaryApp: { file: SECONDARY_49CB_APP, bytes: secondary49cb.length,
          sha256: sha256(secondary49cb) },
        secondaryFullFlashRecovery: { file: receipt.recovery.fullFlash,
          bytes: recovery.length, sha256: sha256(recovery) } },
      verification: { deterministicBuild: "PASS", esp32s3ImageInfo: "PASS",
        acceptedBaseReceipt: "PASS", boundedWrapperCallMutation: "PASS",
        fixedIromLength: "PASS", rendererCavityBound: "PASS", fixedDromLength: "PASS",
        iromDromMmuAliasAvoided: "PASS", runtimeMapMutations: 0,
        mappedPage1cAssetBound: "PASS", lzssRoundTrip: "PASS", cpuStartDromPages: 11,
        psramBoundaryUnchanged: "PASS", musicWpmPreservation: "PASS",
        rendererV1Rebuilt: "PASS", acceptedDromPreservedByteForByte: "PASS",
        focusCompositeLayout: "PASS", focusTimerTripleAdmission: nativeGolden ? "PASS" : "STUB_BLOCKED",
        timerProxyId27: nativeGolden ? "PASS" : "STUB_BLOCKED",
        timerHiddenPolicy: "PAUSE_TESTED", rtcInitialBoundaryFailureReentry: nativeGolden ? "PASS" : "STUB_BLOCKED",
        rtcDecode499BytePin: "PASS", monotonic24BytePin: "PASS",
        nativeGolden: nativeGolden ? "PASS" : "STUB_BLOCKED",
        nativeContract: nativeAccepted ? "PASS" : nativeIsStub ? "STUB_BLOCKED" : "PENDING_ACCEPTANCE",
        liveHardware: "NOT_RUN" },
      flash: { hardwareAccessDuringBuild: false, scope: "factory-app-only", offset: "0x10000",
        command: nativeAccepted ? command : null, blockedCommandTemplate: command,
        blockedReason: nativeAccepted ? null : "Native F2EP VM/RPC contract has not been accepted.",
        postFlashProvisionCommand: nativeAccepted ? provisionCommand : null },
      elapsedMs: Date.now() - started,
    };
    const approval = {
      format: "framer-f1-device-candidate-v1",
      status: nativeAccepted ? "DEVICE_SMOKE_CANDIDATE" : "NATIVE_CONTRACT_STUB",
      deployable: nativeAccepted,
      target: { device: "knob_f1", firmware: "0.4.1", chip: "ESP32-S3", mac: "a4:cb:8f:af:32:10" },
      write: { offset: "0x10000", scope: "factory-app-only", hardwareWriteApproved: nativeAccepted },
      app: manifest.outputs.app,
      rollback: { mode: "accepted-live-receipt-v1", file: LIVE_APP,
        bytes: liveApp.length, sha256: sha256(liveApp),
        receipt: { file: LIVE_RECEIPT, bytes: receiptBytes.length, sha256: sha256(receiptBytes) } },
      recovery: manifest.rollback.secondaryFullFlashRecovery,
      runtime: { allAssetBytesBelow: "0x3c1d0000",
        headroomBytes: COMPRESSED_ASSET_CAPACITY - compressedAssets.length,
        dromMappingProfile: "accepted-7838-blue-timer-animation-reuse-v1",
        newDromAssets: false, dromMutationBytes: 0,
        borrowedFramebufferBytes: 62000, extraFramebufferBytes: 0,
        screenIds: { music: 1, wpm: 7, focusClock: 26, focusTimer: 27 },
        sidecarAllocationBytes: 1300, timerProxyAllocationBytes: 136,
        baseBundleBytes: baseBundle.length, f2epBytes: f2ep.length,
        decodedAssetRamBytes: rawAssets.length, dromExtensionBytes: 0,
        integratedIromModuleBytes: moduleAudit.bytes,
        integratedIromModuleSha256: moduleAudit.sha256,
        integratedIromModuleAddress: `0x${moduleBase.toString(16)}`,
        integratedIromCavityBytes: LIVE_RENDER_V2_BASE.rendererModuleBytes,
        integratedIromEntryAddress: `0x${moduleAudit.entryAddress.toString(16)}`,
        wrapperCall: { address: `0x${LIVE_RENDER_V2_BASE.wrapperChainCallAddress.toString(16)}`,
          acceptedBytes: LIVE_RENDER_V2_BASE.wrapperChainCallBytes,
          candidateBytes: callPatch.toString("hex") },
        compressedAssets: { address: `0x${COMPRESSED_ASSET_ADDRESS.toString(16)}`,
          bytes: compressedAssets.length, sha256: sha256(compressedAssets),
          capacity: COMPRESSED_ASSET_CAPACITY, decodedBytes: rawAssets.length,
          decodedSha256: sha256(rawAssets) },
        acceptedDromPrefixBytes: liveInfo.segments[PINNED.dromSegmentIndex].length,
        acceptedIromBytes: liveInfo.segments[PINNED.iromSegmentIndex].length,
        iromEndExclusive: `0x${IROM_DROM_ALIAS_BOUNDARY.toString(16)}`,
        runtimeMapPatch: null,
        focusSceneStoreBytes: TIMER_ASSET.sceneStoreBytes,
        focusTimerPackageBytes: focusPackageGenerationTwo.length,
        focusTimerPackageSha256: sha256(focusPackageGenerationTwo),
        focusTimerPackageChunks: TIMER_ASSET.chunks,
        focusTimerPackageLastChunkBytes: TIMER_ASSET.lastChunkBytes,
        storeHeadroomBytes: TIMER_ASSET.storeHeadroomBytes,
        generationOneAccountingPackageSha256: sha256(focusTimerPackage),
        focusF1wbBytes: focusF1wb.length, focusF1wbSha256: sha256(focusF1wb),
        focusF1wbGenerationTwoSha256: sha256(focusF1wbGenerationTwo),
        focusF2epBytes: focusF2ep.length, focusF2epSha256: sha256(focusF2ep),
        timerF2epBytes: timerF2ep.length, timerF2epSha256: sha256(timerF2ep),
        timerBaseLzssBytes: timerBaseLzss.length,
        timerBaseLzssSha256: sha256(timerBaseLzss),
        timerBaseDecodedBytes: timerBaseFrame.length,
        timerBaseDecodedSha256: sha256(timerBaseFrame),
        timerPalette: "dark-sky-blue", headerTopPaddingPx: 4,
        dialAnimation: { cadenceMs: 1_000, positions: 5,
          clock: true, timer: true, fnImmediate: true },
        rtc: { decode: { address: "0x42068f04", bytes: 499,
          sha256: "68b2d186e4ae76f0a074a87988acfb643fe461047ba0c610bbe572a7b546c2aa" },
          monotonic: { address: "0x4037e028", bytes: 24,
            sha256: "75e03adc4a2e9d122f0accb175d4eabbabacf8b20982c9afda3f55f865b3a587" },
          freshnessUs: 20000 },
        timerHiddenPolicy: "pause-while-id27-hidden",
        focusUploadOncePerBoot: true,
        nativeContractAccepted: nativeAccepted,
        manualScreenAcceptancePending: [26, 27] },
    };
    await Promise.all([
      writeFile(manifestPath, stableJson(manifest)),
      writeFile(approvalPath, stableJson(approval)),
      writeFile(commandPath, `${nativeAccepted ? command : `BLOCKED: ${manifest.flash.blockedReason}\n${command}`}\n`),
      writeFile(provisionCommandPath,
        `${nativeAccepted ? provisionCommand : `BLOCKED: ${manifest.flash.blockedReason}\n${provisionCommand}`}\n`),
    ]);
    return Object.freeze({ manifest, approval, appPath, mergedPath, codePath, modulePath,
      compressedAssetsPath, manifestPath, approvalPath, commandPath, provisionCommandPath,
      focusBaseFramePath, focusF1wbPath, focusF2epPath, timerF2epPath, focusPackagePath,
      focusTimerPackagePath,
      focusPackageGenerationTwoPath });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
