import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  inspectEsp32AppImage,
  repairEsp32AppIntegrity,
} from "../../custom-firmware/lib/esp-app-image.mjs";
import { validateDeviceApproval } from "./device-workflow.mjs";
import { inspectImage } from "./firmware.mjs";
import {
  genericEventRpcAssembly,
  genericIntegrationChain,
  genericLinker,
  genericSceneRpcAssembly,
} from "./generic-render-v2-sources.mjs";
import { encodeWidgetBundle } from "./render/index.mjs";
import { PINNED, SDK_ROOT, WORKSPACE_ROOT } from "./constants.mjs";
import { STAGE3E3_PATHS } from "./stage3e3.mjs";
import { assert, resolveRecordedPath, sha256, stableJson } from "./util.mjs";

const run = promisify(execFile);

const ACCEPTED_DIRECTORY = path.join(SDK_ROOT,
  "build/combined-renderer-v2-clock-blue-timer");
const ACCEPTED_APP = path.join(ACCEPTED_DIRECTORY,
  "framer-0.4.1-music-id1-wpm-id7-renderer-id26-clock-id27-blue-timer-app.bin");
const ACCEPTED_CODE = path.join(ACCEPTED_DIRECTORY,
  "music-id1-wpm-id7-renderer-id26-clock-id27-blue-timer-irom.bin");
const ACCEPTED_RECEIPT = path.join(SDK_ROOT,
  "build/device-receipts/device-1786939039376-fast-smoke.json");
const RENDERER_V1_SOURCE = path.join(WORKSPACE_ROOT,
  "custom-firmware/experimental/renderer-v1-id26.c");
const RENDERER_V1_GENERIC_TAIL = path.join(WORKSPACE_ROOT,
  "custom-firmware/experimental/renderer-v1-id26-generic-tail.inc");
const GENERIC_NATIVE_SOURCE = path.join(WORKSPACE_ROOT,
  "custom-firmware/experimental/renderer-v2-f2ep-generic.c");
const GENERIC_NATIVE_HEADER = path.join(WORKSPACE_ROOT,
  "custom-firmware/experimental/renderer-v2-f2ep-generic.h");
const GENERIC_NATIVE_HARNESS = path.join(WORKSPACE_ROOT,
  "custom-firmware/test/renderer-v2-generic-native-harness.c");
const SCENE_RPC_ASSEMBLY = path.join(SDK_ROOT,
  "examples/renderer-id26/on-device/renderer-v1-scene-rpc.S");
const SCENE_RPC_CORE = path.join(SDK_ROOT,
  "examples/renderer-id26/on-device/renderer-v1-scene-rpc-core.c");
const GENERIC_SCENE_RPC_CORE = path.join(SDK_ROOT,
  "examples/renderer-id26/on-device/renderer-v2-generic-scene-rpc-core.c");
const GENERIC_SCENE_HARNESS = path.join(SDK_ROOT,
  "test/renderer-v2-generic-scene-core-harness.c");
const EVENT_RPC_ASSEMBLY = path.join(SDK_ROOT,
  "examples/render-v2-events/on-device/renderer-v2-event-rpc.S");
const FOCUS_F1WB = path.join(SDK_ROOT,
  "examples/render-v2-focus-dial/build/render-v2-focus-dial.base.f1wb");
const FOCUS_F2EP = path.join(SDK_ROOT,
  "examples/render-v2-focus-dial/build/render-v2-focus-dial.f2ep");
const V1_SCENE = path.join(SDK_ROOT,
  "examples/render-v2-events/build/render-v2-events.scene.bin");
const V1_ATLAS = path.join(SDK_ROOT,
  "examples/render-v2-events/build/render-v2-events.atlas.bin");

const OUTPUT_DIRECTORY = path.join(SDK_ROOT,
  "build/combined-renderer-v2-generic-input-lab");
const APP_NAME = "framer-0.4.1-input-lab-renderer-v2-generic-id26-app.bin";
const MERGED_NAME = "framer-0.4.1-input-lab-renderer-v2-generic-id26-merged.bin";
const CODE_NAME = "input-lab-renderer-v2-generic-irom.bin";
const MODULE_NAME = "renderer-v2-generic-id26.bin";
const MANIFEST_NAME = "combined-renderer-v2-generic-input-lab-manifest.json";
const APPROVAL_NAME = "combined-renderer-v2-generic-input-lab-device-approval.json";
const CATALOG_NAME = "renderer-v2-generic-flash-catalog.json";

const PROFILE = "framer-f1-render-v2-structural-v1";
const PACKAGE_FORMAT = "framer-render-v2-package-v1";
const PROTOCOL = "framer-widget-scene-rpc-v1";
const MODULE_OFFSET = 6_332;
const MODULE_CAPACITY = 30_540;
const MODULE_ADDRESS = PINNED.codeBaseAddress + MODULE_OFFSET;
const CODE_BYTES = 36_872;
const WRAPPER_CALL_ADDRESS = 0x421170c5;
const ACCEPTED_WRAPPER_BYTES = "25ba01";
const IROM_DROM_ALIAS_BOUNDARY = 0x42120000;

const FROZEN = Object.freeze({
  app: Object.freeze({ bytes: 2_062_912,
    sha256: "363170139a06f306be1e894b6f203a9bf03bf4d70d21194aaccdd1c42f760c32" }),
  receipt: Object.freeze({ bytes: 2_414,
    sha256: "1363d31eabba2b61e068d760d966ab25f8b17d1c635a4c91ba7ecd2a0de238e9" }),
  code: Object.freeze({ bytes: CODE_BYTES,
    sha256: "e30b9714d23a636358850369e6bc06838863e5f6a9f193aa13edab920cb98bd7" }),
  recovery: Object.freeze({ bytes: 16_777_216,
    sha256: "aa6042310d075c9cbd3b992044511c064bb4b84713d0740a3adafcbdb3028fdd" }),
  sources: Object.freeze({
    rendererV1: "88e781f71d1b6ad428aaade7b3f83bcf4fd08cbc8a95a0076b90a24aed692dc1",
    rendererV1Tail: "37a6b5d3751de5f3945ca2a8b5528d786a0a7dbffc442d113544877e8b11f048",
    native: "c41a54324d9a0d0841b784f4bc659b9a0b923781aa705c10a0d8cee0e1d36c9f",
    nativeHeader: "26d0b8c3804e57b5fb7f9888193117d977efea55e7303cc31a1181e07d3939d1",
    nativeHarness: "415a5796934d9e707bf0ee4c13c2440c97b9dea167038c6f3ad83812f80c0029",
    sceneAssembly: "9267dfe3819574bfcd407db851d9810739af8f7868bde68bbf037f1bcc91f728",
    sceneCore: "f4d613a40e5096675344218ae4a1d484dede61c7b0dfadecb2fc82793b56ff22",
    genericSceneCore: "c6c84ad5d9b7c35d28420984342e0c0b7f62a9b58a84c8b7711bab677941f68b",
    sceneHarness: "70998ebb12e977234049552e813640baf64ed517fb3033f370b99a290a10f6a4",
    eventAssembly: "bd7797bdfcb7bdbbe5b5aeef16c6d801f1682fa9163bf95bb10a2134692bb60b",
  }),
  focusF1wb: Object.freeze({ bytes: 62_404,
    sha256: "fa5580257a2432301acfe87434f277493e3d1a8fd8470d793b8bd9ce66850b18" }),
  focusF2ep: Object.freeze({ bytes: 15_178,
    sha256: "b2eadd5884c6ee3b1546ac50c3c077d16eb384adbf1a82631551e69f93705aed" }),
  v1Scene: "6270f93c2b7ead55cf28df3d1e829d2a5e1793596e6ce04a1f8c0b8269e89065",
  v1Atlas: "a995dd91936e5c6f73078e48ea62280ee3086067316805cf6280b52d16e4317a",
});

const CAPABILITIES = Object.freeze({
  status: "ok",
  protocol: PROTOCOL,
  renderV2Profile: PROFILE,
  packageFormat: PACKAGE_FORMAT,
  maxBundleBytes: "98304",
  chunkRawBytes: "3072",
  maxChunks: "32",
  committedGeneration: "<canonical-u32-decimal>",
  v1Packages: "true",
});

function tool(name) {
  return path.join(PINNED.toolchainDirectory, `xtensa-esp32s3-elf-${name}`);
}

function parseSymbols(text) {
  const symbols = new Map();
  for (const line of text.split("\n")) {
    const match = /^([0-9a-f]+)\s+([0-9a-f]+)\s+[A-Za-z]\s+(\S+)$/u.exec(line.trim());
    if (match) symbols.set(match[3], Object.freeze({
      address: Number.parseInt(match[1], 16),
      size: Number.parseInt(match[2], 16),
    }));
  }
  return symbols;
}

function retagF1wb(input, generation) {
  const output = Buffer.from(input);
  assert(output.subarray(0, 4).toString("ascii") === "F1WB" &&
    output.readUInt32LE(12) === output.length,
  "Generic test fixture is not one exact F1WB envelope.");
  output.writeUInt32LE(generation, 8);
  return output;
}

async function buildFixtures(directory, focusF1wb, focusF2ep, scene, atlas) {
  const packages = new Map();
  for (const generation of [1, 2, 4]) {
    const raster = retagF1wb(focusF1wb, generation);
    packages.set(generation, Buffer.concat([raster, focusF2ep]));
  }
  const v1 = encodeWidgetBundle({ generation: 3, activeSlot: 1,
    slots: Array.from({ length: 3 }, (_, index) => ({
      name: `generic-v1-${index + 1}`, kind: "semantic",
      sceneBinary: scene, atlasBinary: atlas,
    })) }).binary;
  assert(packages.get(1).length === 77_582 && v1.length === 1_580 &&
    v1.subarray(0, 4).toString("ascii") === "F1WB" && v1[6] === 3 &&
    v1.readUInt32LE(8) === 3 && v1.readUInt32LE(12) === v1.length,
  "Generic host fixtures lost their V2/V1 envelope shapes.");
  const paths = Object.freeze({
    p1: path.join(directory, "generic-generation-1.package.bin"),
    p2: path.join(directory, "generic-generation-2.package.bin"),
    p4: path.join(directory, "generic-generation-4.package.bin"),
    v1: path.join(directory, "generic-v1-generation-3.f1wb"),
  });
  await Promise.all([
    writeFile(paths.p1, packages.get(1)), writeFile(paths.p2, packages.get(2)),
    writeFile(paths.p4, packages.get(4)), writeFile(paths.v1, v1),
  ]);
  return Object.freeze({ packages, v1, paths });
}

async function compileModule(directory, sources) {
  const generated = Object.freeze({
    chain: genericIntegrationChain(0x421170cc),
    rendererV1: `${sources.rendererV1}\n${sources.rendererV1Tail}\n`,
    native: sources.native,
    nativeHeader: sources.nativeHeader,
    eventRpc: genericEventRpcAssembly(sources.eventAssembly),
    sceneRpc: genericSceneRpcAssembly(sources.sceneAssembly),
    sceneSharedCore: sources.sceneCore,
    sceneCore: sources.genericSceneCore,
    linker: genericLinker(MODULE_ADDRESS),
  });
  assert(!/(?:0x)?42068f04|(?:0x)?4037e028/iu.test(generated.native) &&
    !/renderer_v2_timer|timerScreen|screen.?27/iu.test(generated.native),
  "Generic native source unexpectedly hardwires RTC/timer/ID27 policy.");
  const files = Object.freeze({
    chain: path.join(directory, "renderer-v2-generic-chain.S"),
    rendererV1: path.join(directory, "renderer-v1-id26-generic.c"),
    native: path.join(directory, "renderer-v2-f2ep-generic.c"),
    nativeHeader: path.join(directory, "renderer-v2-f2ep-generic.h"),
    eventRpc: path.join(directory, "renderer-v2-generic-event-rpc.S"),
    sceneRpc: path.join(directory, "renderer-v2-generic-scene-rpc.S"),
    sceneSharedCore: path.join(directory, "renderer-v1-scene-rpc-core.c"),
    sceneCore: path.join(directory, "renderer-v2-generic-scene-rpc-core.c"),
    linker: path.join(directory, "renderer-v2-generic.ld"),
  });
  await Promise.all(Object.entries(files).map(([key, file]) =>
    writeFile(file, generated[key])));
  const objects = Object.freeze({
    chain: path.join(directory, "chain.o"), rendererV1: path.join(directory, "renderer-v1.o"),
    native: path.join(directory, "native.o"), eventRpc: path.join(directory, "event-rpc.o"),
    sceneRpc: path.join(directory, "scene-rpc.o"), sceneCore: path.join(directory, "scene-core.o"),
  });
  const cFlags = ["-Os", "-std=c11", "-Wall", "-Wextra", "-Werror",
    "-ffreestanding", "-fno-builtin", "-fno-jump-tables",
    "-fno-tree-switch-conversion", "-fdata-sections", "-ffunction-sections", "-mlongcalls"];
  await Promise.all([
    run(tool("as"), ["--longcalls", "-o", objects.chain, files.chain]),
    run(tool("as"), ["--longcalls", "-o", objects.eventRpc, files.eventRpc]),
    run(tool("as"), ["--longcalls", "-o", objects.sceneRpc, files.sceneRpc]),
    run(tool("gcc"), [...cFlags, "-c", "-o", objects.rendererV1, files.rendererV1]),
    run(tool("gcc"), [...cFlags, "-c", "-o", objects.native, files.native]),
    run(tool("gcc"), [...cFlags, "-c", "-o", objects.sceneCore, files.sceneCore]),
  ]);
  const elf = path.join(directory, "renderer-v2-generic.elf");
  const binary = path.join(directory, "renderer-v2-generic.bin");
  await run(tool("gcc"), ["-nostdlib", `-Wl,-T,${files.linker}`, "-o", elf,
    objects.chain, objects.rendererV1, objects.sceneCore, objects.sceneRpc,
    objects.eventRpc, objects.native, "-lgcc"]);
  const [header, relocations, undefinedSymbols, symbols, disassembly] = await Promise.all([
    run(tool("objdump"), ["-f", "-h", elf]),
    run(tool("readelf"), ["-r", elf]),
    run(tool("nm"), ["-u", elf]),
    run(tool("nm"), ["-S", elf]),
    run(tool("objdump"), ["-d", elf]),
  ]);
  assert(/elf32-xtensa-le/u.test(header.stdout) &&
    /There are no relocations/u.test(relocations.stdout) &&
    undefinedSymbols.stdout.trim() === "",
  "Generic module must be ESP32-S3 LE, fully linked, and relocation-free.");
  await run(tool("objcopy"), ["-O", "binary", elf, binary]);
  const bytes = await readFile(binary);
  return Object.freeze({ bytes, generated, symbols: parseSymbols(symbols.stdout),
    disassembly: disassembly.stdout, sectionAudit: header.stdout,
    relocationAudit: relocations.stdout, undefinedAudit: undefinedSymbols.stdout });
}

async function compileCallPatch(directory, targetAddress) {
  const source = path.join(directory, "call-patch.S");
  const linker = path.join(directory, "call-patch.ld");
  const object = path.join(directory, "call-patch.o");
  const elf = path.join(directory, "call-patch.elf");
  const binary = path.join(directory, "call-patch.bin");
  await Promise.all([
    writeFile(source, ".section .text.generic_patch,\"ax\",@progbits\n" +
      ".global generic_patch_call\ngeneric_patch_call:\n" +
      " call8 renderer_v2_combined_registration_chain\n"),
    writeFile(linker,
      `renderer_v2_combined_registration_chain = 0x${targetAddress.toString(16)};\n` +
      `SECTIONS { . = 0x${WRAPPER_CALL_ADDRESS.toString(16)}; ` +
      ".patch : { *(.text.generic_patch) } /DISCARD/ : { *(.xtensa.info) *(.comment) } }\n"),
  ]);
  await run(tool("as"), ["-o", object, source]);
  await run(tool("ld"), ["-T", linker, "-o", elf, object]);
  const relocations = await run(tool("readelf"), ["-r", elf]);
  assert(/There are no relocations/u.test(relocations.stdout),
    "Generic wrapper call patch retained a relocation.");
  await run(tool("objcopy"), ["-O", "binary", elf, binary]);
  const bytes = await readFile(binary);
  assert(bytes.length === 3, `Generic wrapper call is ${bytes.length} bytes, expected 3.`);
  return bytes;
}

function auditModule(module) {
  const required = [
    "renderer_v2_combined_registration_chain", "renderer_v1_register_id26",
    "renderer_v1_validate_generic_base", "renderer_v1_validate_generic_bundle",
    "renderer_v1_prepare_store", "renderer_v1_stage_bundle", "renderer_v1_tick",
    "renderer_v2_native_attach", "renderer_v2_native_begin_upload",
    "renderer_v2_native_prepare", "renderer_v2_native_stage",
    "renderer_v2_native_commit", "renderer_v2_native_cancel",
    "renderer_v2_native_abort_upload", "renderer_v2_native_host_event",
    "renderer_scene_rpc_register", "renderer_scene_rpc_handle_capabilities",
    "renderer_scene_rpc_core_begin", "renderer_scene_rpc_core_write",
    "renderer_scene_rpc_core_write_base64_args", "renderer_scene_rpc_core_commit",
    "renderer_scene_rpc_core_abort", "renderer_scene_rpc_u32_decimal",
    "renderer_v2_rpc_register", "renderer_v2_rpc_handle",
  ];
  for (const symbol of required)
    assert(module.symbols.has(symbol), `Generic module lost ${symbol}.`);
  const entry = module.symbols.get("renderer_v2_combined_registration_chain").address;
  assert(entry >= MODULE_ADDRESS && entry < MODULE_ADDRESS + module.bytes.length &&
    module.bytes.length <= MODULE_CAPACITY,
  `Generic module (${module.bytes.length}) escaped its ${MODULE_CAPACITY}-byte cavity.`);
  const sectionBytes = (name) => {
    const match = new RegExp(`\\.${name}\\s+([0-9a-fA-F]+)`, "u")
      .exec(module.sectionAudit);
    return match === null ? 0 : Number.parseInt(match[1], 16);
  };
  /* GNU ld omits an empty output section from objdump -h.  The linker script
   * also has hard ASSERTs for both sections, so absent and explicit zero are
   * the only accepted outcomes here. */
  assert(sectionBytes("renderer_v2_rodata") === 0 &&
    sectionBytes("renderer_v2_data") === 0,
  "Generic linked image retained rodata or static data/BSS.");
  assert(/<renderer_v2_native_begin_upload>:/u.test(module.disassembly) &&
    /<renderer_v2_native_abort_upload>:/u.test(module.disassembly) &&
    /<renderer_scene_rpc_handle_capabilities>:/u.test(module.disassembly),
  "Generic disassembly lost repeat-push or capability handlers.");
  return Object.freeze({ entryAddress: entry, bytes: module.bytes.length,
    sha256: sha256(module.bytes), capacityBytes: MODULE_CAPACITY,
    headroomBytes: MODULE_CAPACITY - module.bytes.length, relocations: 0,
    undefinedSymbols: 0, staticDataBytes: 0, rodataBytes: 0 });
}

function compose(acceptedApp, acceptedCode, module, callPatch) {
  const before = inspectEsp32AppImage(acceptedApp);
  const irom = before.segments[PINNED.iromSegmentIndex];
  const drom = before.segments[PINNED.dromSegmentIndex];
  assert(irom.data.subarray(irom.length - acceptedCode.length).equals(acceptedCode),
    "Accepted blue clock/timer app lost its pinned IROM suffix.");
  const patchOffset = WRAPPER_CALL_ADDRESS - PINNED.codeBaseAddress;
  assert(acceptedCode.subarray(patchOffset, patchOffset + 3).toString("hex") ===
    ACCEPTED_WRAPPER_BYTES, "Accepted generic wrapper call site changed.");
  const candidateCode = Buffer.from(acceptedCode);
  callPatch.copy(candidateCode, patchOffset);
  candidateCode.fill(0, MODULE_OFFSET, MODULE_OFFSET + MODULE_CAPACITY);
  module.copy(candidateCode, MODULE_OFFSET);
  let app = Buffer.from(acceptedApp);
  const codeFileOffset = irom.dataOffset + irom.length - acceptedCode.length;
  candidateCode.copy(app, codeFileOffset);
  app = repairEsp32AppIntegrity(app);
  const after = inspectEsp32AppImage(app);
  assert(app.length === acceptedApp.length && after.segmentCount === before.segmentCount,
    "Generic candidate changed accepted app length/segment count.");
  for (let index = 0; index < before.segmentCount; index += 1) {
    const left = before.segments[index], right = after.segments[index];
    assert(left.loadAddress === right.loadAddress && left.length === right.length &&
      left.dataOffset === right.dataOffset,
    `Generic candidate changed segment ${index} layout.`);
    if (index !== PINNED.iromSegmentIndex)
      assert(left.data.equals(right.data), `Generic candidate changed segment ${index}.`);
  }
  const written = after.segments[PINNED.iromSegmentIndex].data
    .subarray(irom.length - acceptedCode.length);
  assert(written.equals(candidateCode) &&
    candidateCode.subarray(0, patchOffset).equals(acceptedCode.subarray(0, patchOffset)) &&
    candidateCode.subarray(patchOffset + 3, MODULE_OFFSET)
      .equals(acceptedCode.subarray(patchOffset + 3, MODULE_OFFSET)) &&
    candidateCode.subarray(MODULE_OFFSET, MODULE_OFFSET + module.length).equals(module) &&
    candidateCode.subarray(MODULE_OFFSET + module.length, MODULE_OFFSET + MODULE_CAPACITY)
      .every((value) => value === 0),
  "Generic candidate escaped the exact call plus zero-tailed module cavity.");
  assert(after.segments[PINNED.dromSegmentIndex].data.equals(drom.data) &&
    after.segments[PINNED.iromSegmentIndex].loadAddress +
      after.segments[PINNED.iromSegmentIndex].length <= IROM_DROM_ALIAS_BOUNDARY,
  "Generic candidate changed accepted DROM or crossed the MMU alias boundary.");
  return Object.freeze({ app, code: candidateCode, patchOffset });
}

async function runHostGates(directory, fixtures) {
  const rendererObject = path.join(directory, "renderer-v1-host.o");
  const nativeHarness = path.join(directory, "renderer-v2-generic-native-host");
  const sceneHarness = path.join(directory, "renderer-v2-generic-scene-host");
  const hostFlags = ["-std=c11", "-O2", "-Wall", "-Wextra", "-Werror"];
  await run("cc", [...hostFlags, "-DRENDERER_V1_HOST_TEST",
    "-Drenderer_v1_prepare_store=renderer_v1_host_actual_prepare_store",
    "-Drenderer_v1_stage_bundle=renderer_v1_host_actual_stage_bundle", "-c",
    RENDERER_V1_SOURCE, "-o", rendererObject]);
  await Promise.all([
    run("cc", [...hostFlags, GENERIC_NATIVE_HARNESS, rendererObject,
      "-o", nativeHarness]),
    run("cc", [...hostFlags, GENERIC_SCENE_HARNESS, "-o", sceneHarness]),
  ]);
  const [lifecycle, tamper, fuzz, recovery] = await Promise.all([
    run(nativeHarness, ["lifecycle", fixtures.paths.p1, fixtures.paths.p2,
      fixtures.paths.p4, fixtures.paths.v1]),
    run(nativeHarness, ["tamper", fixtures.paths.p1]),
    run(nativeHarness, ["fuzz", fixtures.paths.p1]),
    run(sceneHarness, [fixtures.paths.p1, fixtures.paths.p2, fixtures.paths.v1]),
  ]);
  assert(/commit_window=busy[\s\S]*hidden=busy[\s\S]*abort_before_copy=resume[\s\S]*abort_after_copy=fail_closed[\s\S]*v1_v2=pass/u
      .test(lifecycle.stdout) &&
    /f1wb_tamper=reject host_id_zero=reject/u.test(tamper.stdout) &&
    /mutations=4096[\s\S]*no_crash=1/u.test(fuzz.stdout) &&
    /recovery=malformed,order,sha,base64[\s\S]*next_begin=pass[\s\S]*prior_generation=resume/u
      .test(recovery.stdout),
  "Generic host lifecycle/fuzz/recovery gates failed.");
  return Object.freeze({ lifecycle: lifecycle.stdout.trim(), tamper: tamper.stdout.trim(),
    fuzz: fuzz.stdout.trim(), recovery: recovery.stdout.trim() });
}

export async function buildGenericRenderV2Firmware({
  outputDirectory = OUTPUT_DIRECTORY,
} = {}) {
  const started = Date.now();
  const outputRoot = path.resolve(outputDirectory);
  await mkdir(outputRoot, { recursive: true });
  const sourceFiles = Object.freeze({
    rendererV1: RENDERER_V1_SOURCE, rendererV1Tail: RENDERER_V1_GENERIC_TAIL,
    native: GENERIC_NATIVE_SOURCE, nativeHeader: GENERIC_NATIVE_HEADER,
    nativeHarness: GENERIC_NATIVE_HARNESS, sceneAssembly: SCENE_RPC_ASSEMBLY,
    sceneCore: SCENE_RPC_CORE, genericSceneCore: GENERIC_SCENE_RPC_CORE,
    sceneHarness: GENERIC_SCENE_HARNESS, eventAssembly: EVENT_RPC_ASSEMBLY,
  });
  const [acceptedApp, acceptedCode, receiptBytes, officialMerged, focusF1wb,
    focusF2ep, scene, atlas, ...sourceValues] = await Promise.all([
    readFile(ACCEPTED_APP), readFile(ACCEPTED_CODE), readFile(ACCEPTED_RECEIPT),
    readFile(PINNED.officialMerged.path), readFile(FOCUS_F1WB), readFile(FOCUS_F2EP),
    readFile(V1_SCENE), readFile(V1_ATLAS),
    ...Object.values(sourceFiles).map((file) => readFile(file, "utf8")),
  ]);
  const sources = Object.freeze(Object.fromEntries(
    Object.keys(sourceFiles).map((key, index) => [key, sourceValues[index]])));
  assert(acceptedApp.length === FROZEN.app.bytes && sha256(acceptedApp) === FROZEN.app.sha256 &&
    acceptedCode.length === FROZEN.code.bytes && sha256(acceptedCode) === FROZEN.code.sha256 &&
    receiptBytes.length === FROZEN.receipt.bytes && sha256(receiptBytes) === FROZEN.receipt.sha256,
  "Generic build is not based on the exact healthy blue clock/timer app and receipt.");
  for (const [key, expected] of Object.entries(FROZEN.sources))
    assert(sha256(Buffer.from(sources[key])) === expected,
      `Generic audited source ${key} changed (${sha256(Buffer.from(sources[key]))}).`);
  assert(focusF1wb.length === FROZEN.focusF1wb.bytes &&
    sha256(focusF1wb) === FROZEN.focusF1wb.sha256 &&
    focusF2ep.length === FROZEN.focusF2ep.bytes &&
    sha256(focusF2ep) === FROZEN.focusF2ep.sha256 &&
    sha256(scene) === FROZEN.v1Scene && sha256(atlas) === FROZEN.v1Atlas,
  "Generic deterministic V1/V2 host fixtures changed.");
  const receipt = JSON.parse(receiptBytes);
  const recovery = await readFile(resolveRecordedPath(receipt.recovery.fullFlash));
  assert(receipt.app?.sha256 === FROZEN.app.sha256 && receipt.write?.appOnly === true &&
    receipt.write?.hashVerifiedByEsptool === true &&
    receipt.postBoot?.device?.deviceType === "knob_f1" &&
    receipt.postBoot?.version === "0.4.1" && recovery.length === FROZEN.recovery.bytes &&
    sha256(recovery) === FROZEN.recovery.sha256,
  "Generic rollback receipt/recovery is not the frozen healthy device proof.");

  const temporary = await mkdtemp(path.join(os.tmpdir(), "f1-render-v2-generic-"));
  try {
    const firstDirectory = path.join(temporary, "first");
    const secondDirectory = path.join(temporary, "second");
    const fixtureDirectory = path.join(temporary, "fixtures");
    const hostDirectory = path.join(temporary, "host");
    await Promise.all([mkdir(firstDirectory), mkdir(secondDirectory),
      mkdir(fixtureDirectory), mkdir(hostDirectory)]);
    const fixtures = await buildFixtures(fixtureDirectory, focusF1wb, focusF2ep, scene, atlas);
    const [first, second, hostGates] = await Promise.all([
      compileModule(firstDirectory, sources), compileModule(secondDirectory, sources),
      runHostGates(hostDirectory, fixtures),
    ]);
    assert(first.bytes.equals(second.bytes), "Two generic firmware module builds differ.");
    const moduleAudit = auditModule(first);
    const secondAudit = auditModule(second);
    assert(JSON.stringify(moduleAudit) === JSON.stringify(secondAudit),
      "Two generic module audits differ.");
    const callPatch = await compileCallPatch(firstDirectory, moduleAudit.entryAddress);
    const firstImage = compose(acceptedApp, acceptedCode, first.bytes, callPatch);
    const secondImage = compose(acceptedApp, acceptedCode, second.bytes, callPatch);
    assert(firstImage.app.equals(secondImage.app),
      "Two generic full app builds differ.");
    const merged = Buffer.concat([
      officialMerged.subarray(0, PINNED.appFlashOffset), firstImage.app,
    ]);
    const appPath = path.join(outputRoot, APP_NAME);
    const mergedPath = path.join(outputRoot, MERGED_NAME);
    const codePath = path.join(outputRoot, CODE_NAME);
    const modulePath = path.join(outputRoot, MODULE_NAME);
    const manifestPath = path.join(outputRoot, MANIFEST_NAME);
    const approvalPath = path.join(outputRoot, APPROVAL_NAME);
    const catalogPath = path.join(outputRoot, CATALOG_NAME);
    await Promise.all([
      writeFile(appPath, firstImage.app), writeFile(mergedPath, merged),
      writeFile(codePath, firstImage.code), writeFile(modulePath, first.bytes),
      writeFile(path.join(outputRoot, "renderer-v2-generic-chain.S"), first.generated.chain),
      writeFile(path.join(outputRoot, "renderer-v1-id26-generic.c"), first.generated.rendererV1),
      writeFile(path.join(outputRoot, "renderer-v2-f2ep-generic.c"), first.generated.native),
      writeFile(path.join(outputRoot, "renderer-v2-f2ep-generic.h"), first.generated.nativeHeader),
      writeFile(path.join(outputRoot, "renderer-v2-generic-event-rpc.S"), first.generated.eventRpc),
      writeFile(path.join(outputRoot, "renderer-v2-generic-scene-rpc.S"), first.generated.sceneRpc),
      writeFile(path.join(outputRoot, "renderer-v2-generic-scene-rpc-core.c"), first.generated.sceneCore),
      writeFile(path.join(outputRoot, "renderer-v2-generic.ld"), first.generated.linker),
      writeFile(path.join(outputRoot, "renderer-v2-generic-disassembly.txt"), first.disassembly),
      writeFile(path.join(outputRoot, "renderer-v2-generic-section-audit.txt"), first.sectionAudit),
      writeFile(path.join(outputRoot, "generic-generation-1.package.bin"), fixtures.packages.get(1)),
      writeFile(path.join(outputRoot, "generic-v1-generation-3.f1wb"), fixtures.v1),
    ]);
    const [inspection, imageInfo] = await Promise.all([
      inspectImage(appPath),
      run(STAGE3E3_PATHS.esptool, ["image-info", appPath],
        { cwd: WORKSPACE_ROOT, maxBuffer: 4 * 1024 * 1024 }),
    ]);
    assert(/ESP32-S3/iu.test(imageInfo.stdout) && /Validation hash:/iu.test(imageInfo.stdout) &&
      firstImage.app.length <= PINNED.factoryPartitionBytes,
    "Generic app failed ESP32-S3 image-info/partition gates.");
    const appOutput = Object.freeze({ file: appPath, bytes: firstImage.app.length,
      sha256: sha256(firstImage.app) });
    const rollback = Object.freeze({ mode: "accepted-live-receipt-v1", file: ACCEPTED_APP,
      bytes: acceptedApp.length, sha256: sha256(acceptedApp),
      receipt: Object.freeze({ file: ACCEPTED_RECEIPT, bytes: receiptBytes.length,
        sha256: sha256(receiptBytes) }) });
    const runtime = Object.freeze({
      allAssetBytesBelow: "0x3c1d0000", headroomBytes: 17,
      dromMappingProfile: "generic-render-v2-structural-v1",
      newDromAssets: false, dromMutationBytes: 0, dromExtensionBytes: 0,
      acceptedDromPrefixBytes: inspectEsp32AppImage(acceptedApp).segments[0].length,
      acceptedIromBytes: inspectEsp32AppImage(acceptedApp).segments[3].length,
      iromEndExclusive: "0x42120000", runtimeMapPatch: null,
      screenIds: Object.freeze({ music: 1, wpm: 7, inputLab: 26 }),
      borrowedFramebufferBytes: 62_000, extraFramebufferBytes: 0,
      rendererControllerAllocationBytes: 62_164,
      sidecarAllocationBytes: 692, ownedBundleAllocationBytes: 98_304,
      ownedProgramAllocationBytes: 29_824, sceneRpcAllocationBytes: 99_136,
      eventRpcAllocationBytes: 40,
      integratedIromModuleBytes: moduleAudit.bytes,
      integratedIromModuleSha256: moduleAudit.sha256,
      integratedIromModuleAddress: `0x${MODULE_ADDRESS.toString(16)}`,
      integratedIromCavityBytes: MODULE_CAPACITY,
      integratedIromEntryAddress: `0x${moduleAudit.entryAddress.toString(16)}`,
      wrapperCall: Object.freeze({ address: `0x${WRAPPER_CALL_ADDRESS.toString(16)}`,
        acceptedBytes: ACCEPTED_WRAPPER_BYTES, candidateBytes: callPatch.toString("hex") }),
      renderV2Profile: PROFILE, packageFormat: PACKAGE_FORMAT,
      v1Packages: true, maxTransportBytes: 98_304, maxF2epBytes: 29_824,
      repeatPush: "ui-detach-copy-swap-owned-buffers-v1",
      hostRpcIds: Object.freeze([1, 65_535]), keyboardKeyEvents: false,
      nativeEvents: Object.freeze({ tick100: true, tick1: true,
        fnBottomKnob: true, hostRpc: true }),
      nativeRtc: false, bootProgram: false, additionalScreenIds: [],
      manualScreenAcceptancePending: [26],
    });
    const approval = {
      format: "framer-f1-device-candidate-v1", status: "DEVICE_SMOKE_CANDIDATE",
      deployable: true,
      target: { device: "knob_f1", firmware: "0.4.1", chip: "ESP32-S3",
        mac: "a4:cb:8f:af:32:10" },
      write: { offset: "0x10000", scope: "factory-app-only", hardwareWriteApproved: true },
      app: appOutput, rollback,
      recovery: { file: receipt.recovery.fullFlash, bytes: recovery.length,
        sha256: sha256(recovery) },
      runtime,
    };
    validateDeviceApproval(approval, { appBytes: firstImage.app,
      rollbackBytes: acceptedApp, rollbackReceiptBytes: receiptBytes });
    const manifest = {
      format: "framer-f1-input-lab-render-v2-generic-firmware-v1",
      status: "DEVICE_SMOKE_CANDIDATE", deployable: true,
      target: { device: "knob_f1", firmware: "0.4.1", screenId: 26 },
      profile: { id: PROFILE, packageFormat: PACKAGE_FORMAT,
        protocol: PROTOCOL, capabilities: CAPABILITIES,
        envelope: "standalone canonical F1WB-v1 (1..3 slots) OR contiguous F1WB||F2EP",
        sceneMethods: ["widget.scene.capabilities", "widget.scene.begin",
          "widget.scene.write", "widget.scene.commit", "widget.scene.abort"],
        eventMethod: "widget.v2.event", eventKinds: { tick100: 1, tick1: 2,
          fnBottomKnob: 3, hostRpc: 4 }, hostRpcIds: [1, 65_535],
        keyboardKeyEvents: false, noRtcHardwire: true, noBootProgram: true },
      ownership: { rendererV1AndProgramDetachSameUiTick: true,
        producerOverwriteOnlyAfterReady: true, eventGateEpochBeforeDetach: true,
        abortBeforeCopyResumesPrior: true, abortAfterCopyFailsClosed: true,
        commitAckWindowReturnsBusy: true, hiddenScreenWaitsForUiTick: true },
      acceptedBase: { app: { file: ACCEPTED_APP, bytes: acceptedApp.length,
        sha256: sha256(acceptedApp) }, receipt: rollback.receipt,
        preservedAcceptedBlueClockTimerArtifacts: true },
      module: { file: modulePath, baseAddress: `0x${MODULE_ADDRESS.toString(16)}`,
        ...moduleAudit, deterministicRebuilds: 2, fixedCavityReplacement: true },
      memory: runtime,
      hostGates,
      verification: { deterministicModule: "PASS", deterministicApp: "PASS",
        zeroRelocations: "PASS", zeroUndefinedSymbols: "PASS",
        zeroStaticData: "PASS", zeroRodata: "PASS", structuralF1wbF1ra: "PASS",
        structuralF2ep: "PASS", hostIdZeroReject: "PASS", directPackageTamper: "PASS",
        nativeFuzz4096: "PASS", repeatPush: "PASS", commitAckRace: "PASS",
        hiddenScreenLifecycle: "PASS", v1V2Switching: "PASS",
        malformedChunkRecovery: "PASS", outOfOrderRecovery: "PASS",
        badShaRecovery: "PASS", malformedBase64Recovery: "PASS",
        nextBeginAfterTransportFailure: "PASS", esp32s3ImageInfo: "PASS",
        acceptedDromPreservedByteForByte: "PASS", allOtherSegmentsPreserved: "PASS",
        liveHardware: "NOT_RUN" },
      outputs: { app: appOutput,
        merged: { file: mergedPath, bytes: merged.length, sha256: sha256(merged) },
        code: { file: codePath, bytes: firstImage.code.length, sha256: sha256(firstImage.code) },
        module: { file: modulePath, bytes: first.bytes.length, sha256: sha256(first.bytes) },
        inspection },
      rollback: { ...rollback, recovery: approval.recovery },
      flash: { hardwareAccessDuringBuild: false, scope: "factory-app-only",
        offset: "0x10000", approval: approvalPath },
      elapsedMs: Date.now() - started,
    };
    const catalog = {
      format: "framer-input-lab-public-flash-catalog-v1",
      status: "DEVICE_SMOKE_CANDIDATE", deployable: true,
      id: "input-lab-render-v2-generic", name: "Input Lab Render-v2 (Structural)",
      rendererProfile: PROFILE, packageFormat: PACKAGE_FORMAT, screenId: 26,
      capabilities: { maxBundleBytes: "98304", chunkRawBytes: "3072",
        maxChunks: "32", v1Packages: "true", keyboardKeyEvents: false },
      app: { file: APP_NAME, bytes: firstImage.app.length, sha256: sha256(firstImage.app) },
      approval: { file: APPROVAL_NAME, sha256: sha256(Buffer.from(stableJson(approval))) },
      rollback: { bytes: acceptedApp.length, sha256: sha256(acceptedApp),
        receiptSha256: sha256(receiptBytes) },
    };
    await Promise.all([
      writeFile(manifestPath, stableJson(manifest)),
      writeFile(approvalPath, stableJson(approval)),
      writeFile(catalogPath, stableJson(catalog)),
    ]);
    return Object.freeze({ manifest, approval, catalog, appPath, mergedPath,
      codePath, modulePath, manifestPath, approvalPath, catalogPath });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await buildGenericRenderV2Firmware();
  process.stdout.write(`${stableJson({ status: result.manifest.status,
    app: result.manifest.outputs.app, module: result.manifest.module,
    manifest: result.manifestPath, approval: result.approvalPath,
    catalog: result.catalogPath })}`);
}
