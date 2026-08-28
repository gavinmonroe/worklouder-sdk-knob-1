import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { extendEsp32AppSegment, inspectEsp32AppImage, repairEsp32AppIntegrity } from
  "../../custom-firmware/lib/esp-app-image.mjs";
import { auditFramerScreenRegistry } from "../../custom-firmware/lib/framer-registry-audit.mjs";
import { auditRendererV1Abi, RENDERER_V1_SCREEN_ID } from
  "../../custom-firmware/experimental/renderer-v1-abi-contract.mjs";
import { PINNED, SDK_ROOT, WORKSPACE_ROOT } from "./constants.mjs";
import { inspectImage } from "./firmware.mjs";
import { STAGE3E3_PATHS } from "./stage3e3.mjs";
import { assert, resolveRecordedPath, sha256, stableJson } from "./util.mjs";

const run = promisify(execFile);
const LIVE_DIRECTORY = path.join(SDK_ROOT, "build/combined-music-fast-gradient");
const LIVE_APP = path.join(LIVE_DIRECTORY, "framer-0.4.1-combined-music-id1-wpm-id7-app.bin");
const LIVE_CODE = path.join(LIVE_DIRECTORY, "combined-music-id1-wpm-id7-irom.bin");
const LIVE_RECEIPT = path.join(SDK_ROOT, "build/device-receipts/device-1786895154649-fast-smoke.json");
const STOCK_APP = path.join(WORKSPACE_ROOT, "artifacts/firmware/framer_app_0.4.1.bin");
const MODULE_SOURCE = path.join(WORKSPACE_ROOT, "custom-firmware/experimental/renderer-v1-id26.c");
const RPC_SOURCE = path.join(SDK_ROOT,
  "examples/renderer-id26/on-device/renderer-v1-scene-rpc.S");
const RPC_CORE_SOURCE = path.join(SDK_ROOT,
  "examples/renderer-id26/on-device/renderer-v1-scene-rpc-core.c");
const EMBEDDED_BUNDLE = path.join(SDK_ROOT,
  "examples/jp-matrix/build/jp-matrix-three-slots.f1wb");
const APP_NAME = "framer-0.4.1-combined-music-id1-wpm-id7-renderer-id26-app.bin";
const MERGED_NAME = "framer-0.4.1-combined-music-id1-wpm-id7-renderer-id26-merged.bin";
const CODE_NAME = "combined-music-id1-wpm-id7-renderer-id26-irom.bin";
const MODULE_NAME = "renderer-v1-id26-registration-only.bin";
const MANIFEST_NAME = "combined-renderer-id26-manifest.json";
const APPROVAL_NAME = "combined-renderer-id26-device-approval.smoke.json";

export const LIVE_RENDERER_BASE = Object.freeze({
  proofId: "framer-f1-0.4.1-music-id1-b9b8eec6",
  appBytes: 2_032_368,
  appSha256: "b9b8eec6250392f593ae664fa8b8cba64bf861f5ef49a427c65be79e6f355817",
  codeBytes: 6_332,
  codeSha256: "0f979d32f1a9b1203287cb71518b66367c66a1fa9e51a2c5f06be71bd15a804b",
  receiptSha256: "95fbafe93ef45785e02e157f9047d9077bfee7030b4cb346ffa13da88a9550bf",
  wrapperAddress: 0x42117094,
  wrapperWpmCallAddress: 0x421170c5,
  wpmRegisterAddress: 0x421170cc,
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

function tool(name) {
  return path.join(PINNED.toolchainDirectory, `xtensa-esp32s3-elf-${name}`);
}

function parseSymbols(text) {
  const output = new Map();
  for (const line of text.split("\n")) {
    const match = /^([0-9a-f]+)\s+([0-9a-f]+)\s+[A-Za-z]\s+(\S+)$/u.exec(line.trim());
    if (match) output.set(match[3], { address: Number.parseInt(match[1], 16), size: Number.parseInt(match[2], 16) });
  }
  return output;
}

function body(disassembly, name) {
  const start = disassembly.indexOf(`<${name}>:`);
  assert(start >= 0, `Renderer module symbol ${name} is missing.`);
  const end = disassembly.indexOf("\n\n", start);
  return disassembly.slice(start, end < 0 ? undefined : end);
}

function auditRpcSource(source) {
  assert(!/\.(?:asciz|string)\b/u.test(source),
    "Renderer RPC contains an ordinary IROM string instead of a RAM-built string.");
  for (const method of ["capabilities", "begin", "write", "commit", "abort", "status"]) {
    assert(source.includes(`renderer_scene_rpc_handle_${method}`) &&
      source.includes(`renderer_scene_rpc_${method}_callback`),
    `Renderer RPC lost its ${method} handler/callback.`);
  }
  for (const bridge of ["renderer_scene_rpc_core_begin_args", "renderer_scene_rpc_core_write_base64_args",
    "renderer_scene_rpc_core_commit_args", "renderer_scene_rpc_core_abort"]) {
    assert(source.includes(`call8   ${bridge}`), `Renderer RPC handler no longer calls ${bridge}.`);
  }
  assert((source.match(/call8\s+renderer_scene_rpc_reply_status/gu)?.length ?? 0) === 5,
    "Renderer RPC must use the proven status-only reply for two simple plus four transaction handlers.");
  assert((source.match(/l32r\s+a8,\.Lscene_json_root_dtor/gu)?.length ?? 0) === 6,
    "Renderer RPC must destroy one response root plus one request root per simple/transaction handler body.");
  for (const root of ["begin", "write", "commit"]) {
    const handler = source.slice(source.indexOf(`renderer_scene_rpc_handle_${root}:`),
      source.indexOf(`.size renderer_scene_rpc_handle_${root}`));
    assert(handler.includes("entry   a1,384") && handler.includes("addi    a4,a1,288") &&
      !/SCENE_PARSE_(?:INT|STRING) a10,/u.test(handler),
    `Renderer RPC ${root} handler lost its live-proven frame/root layout.`);
  }
  const abort = source.slice(source.indexOf("renderer_scene_rpc_handle_abort:"),
    source.indexOf(".size renderer_scene_rpc_handle_abort"));
  assert(abort.includes("addi    a4,a1,288") && !/SCENE_PARSE_(?:INT|STRING) a10,/u.test(abort),
    "Renderer RPC abort handler does not retain one stable request-root address.");
  return true;
}

function linker(baseAddress) {
  return `ENTRY(renderer_id26_registration_chain)
SECTIONS {
  . = 0x${baseAddress.toString(16)};
  .renderer_id26 : ALIGN(4) {
    KEEP(*(.literal.renderer_chain))
    *(.literal)
    *(.literal.*)
    KEEP(*(.text.renderer_chain))
    KEEP(*(.text.renderer_v1))
    *(.text)
    *(.text.*)
    . = ALIGN(4);
  }
  .renderer_rodata : ALIGN(4) { *(.rodata) *(.rodata.*) }
  /DISCARD/ : { *(.comment) *(.xtensa.info) *(.xt.lit) *(.xt.prop) *(.eh_frame) *(.eh_frame.*) }
}
ASSERT(SIZEOF(.renderer_rodata) == 0, "renderer-v1 must not dereference IROM rodata")
`;
}

function embeddedBundleChain(bundle) {
  assert(bundle.length === 9_488 && bundle.length % 4 === 0 &&
    sha256(bundle) === "fbfeefff128bc80c44663515830d3300083c84d18335f837f8949027051b2274",
  "Embedded JP Matrix three-slot F1WB changed.");
  const words = Array.from({ length: bundle.length / 4 }, (_, index) =>
    `.Lrenderer_bundle_${index}: .long 0x${bundle.readUInt32LE(index * 4).toString(16).padStart(8, "0")}`);
  const stores = [];
  for (let index = 0; index < words.length; index += 1) {
    const inBlock = index % 256;
    stores.push(` l32r a8,.Lrenderer_bundle_${index}\n s32i a8,a7,${inBlock * 4}`);
    if (inBlock === 255 && index + 1 < words.length) stores.push(" movi a8,1024\n add a7,a7,a8");
  }
  return `.section .literal.renderer_chain,"a",@progbits
.balign 4
.Lwpm_register: .long 0x${LIVE_RENDERER_BASE.wpmRegisterAddress.toString(16)}
.Lrenderer_operator_new: .long 0x420e7c04
.Lembedded_bundle_bytes: .long ${bundle.length}
${words.join("\n")}
.section .text.renderer_chain,"ax",@progbits
.balign 4
.global renderer_id26_stage_embedded_bundle
.type renderer_id26_stage_embedded_bundle,@function
renderer_id26_stage_embedded_bundle:
 entry a1,32
 beqz a2,.Lembedded_stage_fail
 mov a6,a2
 l32r a10,.Lembedded_bundle_bytes
 l32r a8,.Lrenderer_operator_new
 callx8 a8
 mov a5,a10
 beqz a5,.Lembedded_stage_fail
 mov a7,a5
${stores.join("\n")}
 memw
 mov a10,a6
 mov a11,a5
 l32r a12,.Lembedded_bundle_bytes
 call8 renderer_v1_stage_bundle
 beqz a10,.Lembedded_stage_fail
 mov a2,a5
 retw.n
.Lembedded_stage_fail:
 movi.n a2,0
 retw.n
.size renderer_id26_stage_embedded_bundle,.-renderer_id26_stage_embedded_bundle
.balign 4
.global renderer_id26_registration_chain
.type renderer_id26_registration_chain,@function
renderer_id26_registration_chain:
 entry a1,48
 mov a4,a2
 mov a5,a3
 mov a10,a4
 mov a11,a5
 l32r a8,.Lwpm_register
 callx8 a8
 mov a10,a4
 mov a11,a5
 call8 renderer_v1_register_id26
 beqz a10,.Lrenderer_chain_done
 mov a6,a10
 call8 renderer_id26_stage_embedded_bundle
 beqz a10,.Lrenderer_skip_startup_tick
 mov a10,a6
 call8 renderer_v1_tick
.Lrenderer_skip_startup_tick:
 mov a10,a6
 call8 renderer_scene_rpc_register
 beqz a10,.Lrenderer_chain_done
 movi.n a8,1
 s32i.n a8,a10,8
 memw
.Lrenderer_chain_done:
 retw.n
.size renderer_id26_registration_chain,.-renderer_id26_registration_chain
`;
}

async function compileModule(directory, source, rpcSource, rpcCoreSource, bundle, baseAddress) {
  const sourcePath = path.join(directory, "renderer-v1-id26.c");
  const chainPath = path.join(directory, "renderer-chain.S");
  const rpcPath = path.join(directory, "renderer-scene-rpc.S");
  const rpcCorePath = path.join(directory, "renderer-scene-rpc-core.c");
  const linkerPath = path.join(directory, "renderer-id26.ld");
  const objectPath = path.join(directory, "renderer-v1-id26.o");
  const chainObjectPath = path.join(directory, "renderer-chain.o");
  const rpcObjectPath = path.join(directory, "renderer-scene-rpc.o");
  const rpcCoreObjectPath = path.join(directory, "renderer-scene-rpc-core.o");
  const elfPath = path.join(directory, "renderer-id26.elf");
  const binaryPath = path.join(directory, "renderer-id26.bin");
  const chain = embeddedBundleChain(bundle);
  await Promise.all([writeFile(sourcePath, source), writeFile(chainPath, chain),
    writeFile(rpcPath, rpcSource), writeFile(rpcCorePath, rpcCoreSource),
    writeFile(linkerPath, linker(baseAddress))]);
  await Promise.all([
    run(tool("gcc"), ["-Os", "-std=c11", "-ffreestanding", "-fno-builtin", "-fno-jump-tables",
      "-fno-tree-switch-conversion", "-fdata-sections", "-ffunction-sections", "-mlongcalls",
      "-c", "-o", objectPath, sourcePath]),
    run(tool("gcc"), ["-Os", "-std=c11", "-ffreestanding", "-fno-builtin", "-fno-jump-tables",
      "-fno-tree-switch-conversion", "-fdata-sections", "-ffunction-sections", "-mlongcalls",
      "-DRENDERER_SCENE_RPC_NO_V2=1",
      "-c", "-o", rpcCoreObjectPath, rpcCorePath]),
    run(tool("as"), ["--longcalls", "-o", chainObjectPath, chainPath]),
    run(tool("as"), ["--longcalls", "-o", rpcObjectPath, rpcPath]),
  ]);
  await run(tool("gcc"), ["-nostdlib", `-Wl,-T,${linkerPath}`, "-o", elfPath,
    chainObjectPath, objectPath, rpcCoreObjectPath, rpcObjectPath, "-lgcc"]);
  const [header, relocations, symbolsText, disassembly] = await Promise.all([
    run(tool("objdump"), ["-f", "-h", elfPath]), run(tool("readelf"), ["-r", elfPath]),
    run(tool("nm"), ["-S", elfPath]), run(tool("objdump"), ["-d", elfPath]),
  ]);
  assert(/elf32-xtensa-le/u.test(header.stdout) && /There are no relocations/u.test(relocations.stdout),
    "Renderer ID26 module must be ESP32-S3 little-endian and relocation-free.");
  await run(tool("objcopy"), ["-O", "binary", elfPath, binaryPath]);
  return { bytes: await readFile(binaryPath), symbols: parseSymbols(symbolsText.stdout),
    disassembly: disassembly.stdout, linker: linker(baseAddress), chain, rpcSource, rpcCoreSource };
}

async function compileCallPatch(directory, callAddress, targetAddress) {
  const sourcePath = path.join(directory, "call-patch.S");
  const linkerPath = path.join(directory, "call-patch.ld");
  const objectPath = path.join(directory, "call-patch.o");
  const elfPath = path.join(directory, "call-patch.elf");
  const binaryPath = path.join(directory, "call-patch.bin");
  await Promise.all([
    writeFile(sourcePath, `.section .text.renderer_patch,"ax",@progbits\n.global renderer_patch_call\nrenderer_patch_call:\n call8 renderer_id26_registration_chain\n`),
    writeFile(linkerPath, `renderer_id26_registration_chain = 0x${targetAddress.toString(16)};\nSECTIONS { . = 0x${callAddress.toString(16)}; .patch : { *(.text.renderer_patch) } /DISCARD/ : { *(.xtensa.info) *(.comment) } }\n`),
  ]);
  await run(tool("as"), ["-o", objectPath, sourcePath]);
  await run(tool("ld"), ["-T", linkerPath, "-o", elfPath, objectPath]);
  const relocation = await run(tool("readelf"), ["-r", elfPath]);
  assert(/There are no relocations/u.test(relocation.stdout), "Renderer setup-chain call patch has relocations.");
  await run(tool("objcopy"), ["-O", "binary", elfPath, binaryPath]);
  const bytes = await readFile(binaryPath);
  assert(bytes.length === 3, `Renderer setup-chain call patch is ${bytes.length} bytes instead of 3.`);
  return bytes;
}

function assertSlice(code, slice, label) {
  assert(slice.offset + slice.bytes <= code.length &&
    sha256(code.subarray(slice.offset, slice.offset + slice.bytes)) === slice.sha256,
  `${label} changed from the physically accepted live base.`);
}

function auditModule(module) {
  for (const name of ["renderer_id26_registration_chain", "renderer_v1_register_id26",
    "renderer_id26_stage_embedded_bundle", "renderer_v1_prepare_store", "renderer_v1_stage_bundle", "renderer_v1_build",
    "renderer_v1_cleanup", "renderer_v1_tick",
    "renderer_v1_id", "renderer_v1_encoder", "renderer_scene_rpc_register",
    "renderer_scene_rpc_capabilities_callback", "renderer_scene_rpc_begin_callback",
    "renderer_scene_rpc_write_callback", "renderer_scene_rpc_commit_callback",
    "renderer_scene_rpc_abort_callback", "renderer_scene_rpc_status_callback",
    "renderer_scene_rpc_handle_capabilities", "renderer_scene_rpc_handle_begin",
    "renderer_scene_rpc_handle_write", "renderer_scene_rpc_handle_commit",
    "renderer_scene_rpc_handle_abort", "renderer_scene_rpc_handle_status",
    "renderer_scene_rpc_core_begin", "renderer_scene_rpc_core_begin_args",
    "renderer_scene_rpc_core_write", "renderer_scene_rpc_core_write_base64_args",
    "renderer_scene_rpc_core_commit", "renderer_scene_rpc_core_commit_args",
    "renderer_scene_rpc_core_abort", "renderer_scene_rpc_core_flags"]) {
    assert(module.symbols.has(name), `Renderer module lost ${name}.`);
  }
  const register = body(module.disassembly, "renderer_v1_register_id26");
  const chain = body(module.disassembly, "renderer_id26_registration_chain");
  assert(/l32i(?:\.n)?\s+a8, a2, 20[\s\S]*beq\s+a8, a7/u.test(register) &&
    /movi(?:\.n)?\s+a11, 26\b/u.test(register),
  "Renderer ID26 navigation lacks controller+20 registry association gate.");
  assert(chain.includes("callx8") && /call8\s+[^\n]*<renderer_v1_register_id26>/u.test(chain) &&
    /beqz(?:\.n)?\s+a10,[^\n]*[\s\S]*call8\s+[^\n]*<renderer_scene_rpc_register>/u.test(chain),
  "Renderer registration chain is not frozen WPM then renderer then null-gated RPC.");
  assert(/call8\s+[^\n]*<renderer_id26_stage_embedded_bundle>[\s\S]*beqz(?:\.n)?\s+a10,[^\n]*[\s\S]*call8\s+[^\n]*<renderer_v1_tick>[\s\S]*call8\s+[^\n]*<renderer_scene_rpc_register>[\s\S]*s32i(?:\.n)?\s+a8, a10, 8/u
    .test(chain) &&
    /call8\s+[^\n]*<renderer_v1_stage_bundle>[\s\S]*beqz(?:\.n)?\s+a10,/u.test(
      body(module.disassembly, "renderer_id26_stage_embedded_bundle")),
  "Renderer registration does not stage and setup-tick the separate embedded F1WB before exposing RPC upload.");
  for (const [handler, bridge] of [["begin", "renderer_scene_rpc_core_begin_args"],
    ["write", "renderer_scene_rpc_core_write_base64_args"],
    ["commit", "renderer_scene_rpc_core_commit_args"],
    ["abort", "renderer_scene_rpc_core_abort"]]) {
    assert(new RegExp(`call8\\s+[^\\n]*<${bridge}>`, "u")
      .test(body(module.disassembly, `renderer_scene_rpc_handle_${handler}`)),
    `Linked renderer RPC ${handler} handler lost ${bridge}.`);
  }
  return { address: module.symbols.get("renderer_id26_registration_chain").address,
    bytes: module.bytes.length, sha256: sha256(module.bytes), relocations: 0 };
}

function compose({ liveApp, liveCode, module, callPatch }) {
  const before = inspectEsp32AppImage(liveApp);
  const beforeIrom = before.segments[PINNED.iromSegmentIndex];
  assert(beforeIrom.data.subarray(beforeIrom.length - liveCode.length).equals(liveCode),
    "Accepted live app does not end its IROM segment with the pinned live code.");
  let app = extendEsp32AppSegment(liveApp, { segmentIndex: PINNED.iromSegmentIndex, data: module });
  let info = inspectEsp32AppImage(app);
  const candidateIrom = info.segments[PINNED.iromSegmentIndex];
  const codeFileOffset = candidateIrom.dataOffset + beforeIrom.length - liveCode.length;
  const patchOffset = LIVE_RENDERER_BASE.wrapperWpmCallAddress - PINNED.codeBaseAddress;
  callPatch.copy(app, codeFileOffset + patchOffset);
  app = repairEsp32AppIntegrity(app);
  info = inspectEsp32AppImage(app);
  const afterIrom = info.segments[PINNED.iromSegmentIndex];
  const candidateCode = Buffer.from(afterIrom.data.subarray(beforeIrom.length - liveCode.length));
  assert(candidateCode.length === liveCode.length + module.length,
    "Candidate IROM suffix length does not equal live code plus renderer module.");
  const expectedLive = Buffer.from(liveCode);
  callPatch.copy(expectedLive, patchOffset);
  assert(candidateCode.subarray(0, liveCode.length).equals(expectedLive) &&
    candidateCode.subarray(liveCode.length).equals(module),
  "Candidate code mutation escaped the one setup-chain call plus append-only renderer module.");
  for (let index = 0; index < before.segmentCount; index += 1) {
    assert(before.segments[index].loadAddress === info.segments[index].loadAddress,
      `Renderer candidate segment ${index} VA changed.`);
    if (index !== PINNED.iromSegmentIndex) {
      assert(before.segments[index].data.equals(info.segments[index].data),
        `Renderer candidate changed non-IROM segment ${index}.`);
    }
  }
  assert(info.segments[PINNED.dromSegmentIndex].data.equals(before.segments[PINNED.dromSegmentIndex].data),
    "Renderer candidate changed a live Music/WPM DROM asset byte.");
  return { app, info, candidateCode, patchOffset };
}

export async function buildCombinedRendererFirmware({
  outputDirectory = path.join(SDK_ROOT, "build/combined-renderer-id26"),
} = {}) {
  const started = Date.now();
  const outputRoot = path.resolve(outputDirectory);
  await mkdir(outputRoot, { recursive: true });
  await Promise.all(["renderer-id26-registration-only.bin", "renderer-id26-registration.S"]
    .map((name) => rm(path.join(outputRoot, name), { force: true })));
  const [liveApp, liveCode, receiptBytes, stockApp, officialMerged, source, rpcSource,
    rpcCoreSource, embeddedBundle] = await Promise.all([
    readFile(LIVE_APP), readFile(LIVE_CODE), readFile(LIVE_RECEIPT), readFile(STOCK_APP),
    readFile(PINNED.officialMerged.path), readFile(MODULE_SOURCE, "utf8"), readFile(RPC_SOURCE, "utf8"),
    readFile(RPC_CORE_SOURCE, "utf8"), readFile(EMBEDDED_BUNDLE),
  ]);
  const receipt = JSON.parse(receiptBytes);
  auditRpcSource(rpcSource);
  for (const signature of ["magic(p, 'F', '1', 'W', 'B')", "magic(scene, 'F', '1', 'S', 'C')",
    "magic(atlas, 'F', '1', 'G', 'A')", "magic(p, 'F', '1', 'R', 'A')"]) {
    assert(source.includes(signature), `Native renderer source lost canonical ${signature.slice(-12)} admission.`);
  }
  assert(liveApp.length === LIVE_RENDERER_BASE.appBytes && sha256(liveApp) === LIVE_RENDERER_BASE.appSha256 &&
    liveCode.length === LIVE_RENDERER_BASE.codeBytes && sha256(liveCode) === LIVE_RENDERER_BASE.codeSha256 &&
    sha256(receiptBytes) === LIVE_RENDERER_BASE.receiptSha256,
  "Renderer combined build is not based on the exact physically accepted B9 app/code/receipt.");
  assert(receipt.mode === "fast-smoke" && receipt.app.sha256 === LIVE_RENDERER_BASE.appSha256 &&
    receipt.write?.appOnly === true && receipt.write?.hashVerifiedByEsptool === true &&
    receipt.postBoot?.device?.deviceType === "knob_f1" && receipt.postBoot?.version === "0.4.1",
  "Renderer live-base receipt is not a healthy app-only Framer F1 proof.");
  const rollback = await readFile(resolveRecordedPath(receipt.rollback.file));
  const recovery = await readFile(resolveRecordedPath(receipt.recovery.fullFlash));
  assert(sha256(rollback) === receipt.rollback.sha256 && recovery.length === receipt.recovery.bytes &&
    sha256(recovery) === receipt.recovery.sha256,
  "Renderer live-base rollback/recovery bytes changed.");
  for (const [name, slice] of Object.entries(LIVE_RENDERER_BASE.slices)) assertSlice(liveCode, slice, name);
  const registry = auditFramerScreenRegistry(stockApp);
  assert(!registry.controllerIds.includes(RENDERER_V1_SCREEN_ID), "Stock registry already occupies renderer screen ID26.");
  const abi = auditRendererV1Abi(stockApp);
  assert(abi.screenId === 26, "Renderer ABI audit changed its screen ID.");

  const moduleBase = PINNED.codeBaseAddress + liveCode.length;
  const temporary = await mkdtemp(path.join(os.tmpdir(), "f1-combined-renderer-id26-"));
  try {
    const firstDirectory = path.join(temporary, "first");
    const secondDirectory = path.join(temporary, "second");
    await Promise.all([mkdir(firstDirectory), mkdir(secondDirectory)]);
    const [first, second] = await Promise.all([
      compileModule(firstDirectory, source, rpcSource, rpcCoreSource, embeddedBundle, moduleBase),
      compileModule(secondDirectory, source, rpcSource, rpcCoreSource, embeddedBundle, moduleBase),
    ]);
    assert(first.bytes.equals(second.bytes), "Two renderer registration-only builds differ.");
    const moduleAudit = auditModule(first);
    const patch = await compileCallPatch(firstDirectory, LIVE_RENDERER_BASE.wrapperWpmCallAddress,
      moduleAudit.address);
    const firstImage = compose({ liveApp, liveCode, module: first.bytes, callPatch: patch });
    const secondImage = compose({ liveApp, liveCode, module: second.bytes, callPatch: patch });
    assert(firstImage.app.equals(secondImage.app), "Two combined renderer app compositions differ.");
    for (const [name, slice] of Object.entries(LIVE_RENDERER_BASE.slices)) {
      assertSlice(firstImage.candidateCode, slice, `${name} candidate`);
    }
    assert(firstImage.info.segments.filter(({ loadAddress }) => loadAddress === PINNED.dromLoadAddress).length === 1 &&
      firstImage.info.segments.filter(({ loadAddress }) => loadAddress === PINNED.iromLoadAddress).length === 1 &&
      firstImage.app.length <= PINNED.factoryPartitionBytes,
    "Renderer candidate segment count or factory partition bound failed.");
    const merged = Buffer.concat([officialMerged.subarray(0, PINNED.appFlashOffset), firstImage.app]);
    const appPath = path.join(outputRoot, APP_NAME);
    const mergedPath = path.join(outputRoot, MERGED_NAME);
    const codePath = path.join(outputRoot, CODE_NAME);
    const modulePath = path.join(outputRoot, MODULE_NAME);
    const manifestPath = path.join(outputRoot, MANIFEST_NAME);
    const approvalPath = path.join(outputRoot, APPROVAL_NAME);
    await Promise.all([writeFile(appPath, firstImage.app), writeFile(mergedPath, merged),
      writeFile(codePath, firstImage.candidateCode), writeFile(modulePath, first.bytes),
      writeFile(path.join(outputRoot, "renderer-v1-id26.c"), source),
      writeFile(path.join(outputRoot, "renderer-v1-scene-rpc.S"), rpcSource),
      writeFile(path.join(outputRoot, "renderer-v1-scene-rpc-core.c"), rpcCoreSource),
      writeFile(path.join(outputRoot, "renderer-id26-registration-chain.S"), first.chain),
      writeFile(path.join(outputRoot, "renderer-id26.ld"), first.linker),
      writeFile(path.join(outputRoot, "renderer-id26-disassembly.txt"), first.disassembly)]);
    const [inspection, imageInfo] = await Promise.all([
      inspectImage(appPath), run(STAGE3E3_PATHS.esptool, ["image-info", appPath],
        { cwd: WORKSPACE_ROOT, maxBuffer: 4 * 1024 * 1024 }),
    ]);
    assert(/ESP32-S3/iu.test(imageInfo.stdout) && /Validation hash:/iu.test(imageInfo.stdout),
      "Renderer candidate failed esptool image-info.");
    const manifest = {
      format: "framer-f1-combined-music-id1-wpm-id7-renderer-id26-candidate-v1",
      status: "DEVICE_SMOKE_CANDIDATE",
      deployable: true,
      target: { device: "knob_f1", firmware: "0.4.1", screenIds: { music: 1, wpm: 7, renderer: 26 } },
      liveBase: { proofId: LIVE_RENDERER_BASE.proofId, app: { file: LIVE_APP, bytes: liveApp.length,
        sha256: sha256(liveApp) }, code: { file: LIVE_CODE, bytes: liveCode.length, sha256: sha256(liveCode) },
        receipt: { file: LIVE_RECEIPT, sha256: sha256(receiptBytes), deviceHealthy: true,
          appOnly: true, esptoolWriteHashVerified: true } },
      setup: { soleWrapper: "f1_combined_setup_wrapper", stockSetupCalls: 1,
        order: ["stock", "music_id1_register", "stage3e34_register_wpm", "renderer_id26_register"],
        mutation: { address: `0x${LIVE_RENDERER_BASE.wrapperWpmCallAddress.toString(16)}`,
          bytes: patch.length, purpose: "redirect frozen WPM call through append-only WPM-then-renderer chain" } },
      preservation: { musicLiteral: { ...LIVE_RENDERER_BASE.slices.musicLiteral, preservedByteForByte: true },
        musicText: { ...LIVE_RENDERER_BASE.slices.musicText, preservedByteForByte: true },
        wpmLiteral: { ...LIVE_RENDERER_BASE.slices.wpmLiteral, preservedByteForByte: true },
        wpmText: { ...LIVE_RENDERER_BASE.slices.wpmText, preservedByteForByte: true },
        allLiveDromAssets: { bytes: inspectEsp32AppImage(liveApp).segments[0].length,
          sha256: sha256(inspectEsp32AppImage(liveApp).segments[0].data), preservedByteForByte: true } },
      renderer: { source: MODULE_SOURCE, screenId: 26, registrationOnly: true, ownsStockSetup: false,
        navigationGate: "controller+20 == registry", controllerBytes: 62164,
        persistentRam: { controllerAndFramebufferBytes: 62164, framebufferBytes: 62000,
          descriptorIdentities: 2, embeddedDefaultBytes: 9488, rpcStateAndStoreBytes: 98624,
          successfulRegistrationBytes: 170276, failSoftRendererOnlyBytes: 62164 },
        plannedSingleStoreUploadRam: { sceneStoreBytes: 98304, rpcMetadataAndHeaderBytes: 320,
          embeddedDefaultBytes: 9488, framebufferBytes: 62000, controllerOverheadBytes: 164,
          peakBytes: 170276,
          semantics: "embedded default stays separate; RPC store supports freeze/detach/repeated replacement" },
        formats: { bundle: "F1WB v1", semantic: ["F1SC v1", "F1GA v1"], raster: "F1RA v1",
          structuralAdmissionSymbol: "renderer_v1_stage_bundle",
          nativeRenderers: ["renderer_v1_tick", "renderer_v1_encoder"],
          transactionShaPrerequisite: true },
        startupScene: { file: EMBEDDED_BUNDLE, bytes: embeddedBundle.length,
          sha256: sha256(embeddedBundle), slots: 3, generation: 1,
          activation: "setup-time renderer_v1_tick before RPC registration",
          storage: "IROM word literals copied once into a dedicated retained 9488-byte RAM allocation",
          uploadLatch: "unused; RPC store is seeded to active generation 1 and remains writable" },
        module: { file: modulePath, baseAddress: `0x${moduleBase.toString(16)}`,
          entryAddress: `0x${moduleAudit.address.toString(16)}`, bytes: moduleAudit.bytes,
          sha256: moduleAudit.sha256, relocations: moduleAudit.relocations,
          deterministicRebuilds: 2 },
        rpc: { protocol: "framer-widget-scene-rpc-v1", acceptancePending: true,
          liveProofId: null, handlersImplemented: true, singleSceneStoreAccepted: false,
          heapTelemetryAccepted: false,
          responseEnvelope: "proven RAM-backed {status:ok|error} canary",
          hostCapabilitySource: "local proof registry until physical ID26 acceptance",
          firstSuccessfulUploadPerBoot: false, repeatedPush: true,
          generationSeed: 1, activeStoreOverwriteHandshake: "timer-tick detach for every active-store overwrite",
          requiredCapabilityContract: { atomicF1wb: true, uiThreadApply: true, ramOnly: true,
            persistence: false, singleSceneStore: true, freezeOnUpload: true,
            headerLastCommit: true, rollbackMode: "freeze-last-frame",
            maxBundleBytes: 98304, sceneStoreBytes: 98304, framebufferBytes: 62000,
            minimumRendererBytes: 160304, chunkRawBytes: 3072, maxChunks: 32 },
          methodsReserved: ["widget.scene.capabilities", "widget.scene.begin", "widget.scene.write",
            "widget.scene.commit", "widget.scene.abort", "widget.scene.status"] } },
      outputs: { app: { file: appPath, bytes: firstImage.app.length, sha256: sha256(firstImage.app) },
        merged: { file: mergedPath, bytes: merged.length, sha256: sha256(merged) },
        code: { file: codePath, bytes: firstImage.candidateCode.length, sha256: sha256(firstImage.candidateCode) },
        inspection },
      safety: { hardwareAccess: false, rendererLiveProof: false, approvalRequired: false,
        newDromAssets: false, acceptedDromPreserved: true, factoryAppOnlyOffset: "0x10000",
        recovery: { file: receipt.recovery.fullFlash, sha256: sha256(recovery) },
        rollback: { file: receipt.rollback.file, sha256: sha256(rollback) } },
      verification: { exactLiveBase: "PASS", musicWpmBytePreservation: "PASS", rendererAbi: "PASS",
        deterministicBuild: "PASS", checksumDigest: "PASS", esptoolImageInfo: "PASS",
        screenId26UnoccupiedInStock: "PASS", rendererRpcStaticImplementation: "PASS",
        rendererRpcAcceptance: "PENDING",
        heapTelemetry: "PENDING" },
      elapsedMs: Date.now() - started,
    };
    const approval = { format: "framer-f1-device-candidate-v1", status: "DEVICE_SMOKE_CANDIDATE",
      deployable: true, target: { device: "knob_f1", firmware: "0.4.1", chip: "ESP32-S3",
        mac: receipt.target.mac }, write: { offset: "0x10000", scope: "factory-app-only",
        hardwareWriteApproved: true }, app: manifest.outputs.app,
      rollback: manifest.safety.rollback, runtime: { newDromAssets: false,
        allAssetBytesBelow: "0x3c1d0000", headroomBytes: 3220,
        persistentRamBytes: 170276, plannedPeakWithSceneStoreBytes: 170276,
        rendererRpcAcceptancePending: true, heapTelemetryAccepted: false,
        singleSceneStoreAccepted: false, screen26VisualAcceptancePending: true } };
    await Promise.all([writeFile(manifestPath, stableJson(manifest)), writeFile(approvalPath, stableJson(approval))]);
    return Object.freeze({ manifest, manifestPath, approvalPath, appPath, mergedPath, codePath, modulePath });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const result = await buildCombinedRendererFirmware();
  process.stdout.write(stableJson({ status: result.manifest.status, app: result.manifest.outputs.app,
    manifest: result.manifestPath, approval: result.approvalPath }));
}
