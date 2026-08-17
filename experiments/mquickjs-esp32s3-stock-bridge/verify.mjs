#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { inspectEsp32AppImage } from "../../custom-firmware/lib/esp-app-image.mjs";

const execute = promisify(execFile);
const directory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(directory, "../..");
const outputDirectory = path.join(directory, "build");
const toolchain = process.env.FRAMER_XTENSA_BIN ?? path.join(repository,
  ".toolchains/xtensa-esp-elf-13.2.0_20240530/bin");
const xtensa = (name) => path.join(toolchain, `xtensa-esp32s3-elf-${name}`);
const run = async (command, args, options = {}) => execute(command, args, {
  maxBuffer: 64 * 1024 * 1024, ...options,
});
const invariant = (condition, message) => { if (!condition) throw new Error(message); };
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hex = (value) => `0x${value.toString(16)}`;

const healthyAppPath = path.join(repository,
  "f1-widget-sdk/build/combined-renderer-v2-clock-blue-timer/" +
  "framer-0.4.1-music-id1-wpm-id7-renderer-id26-clock-id27-blue-timer-app.bin");
const healthyAppSha256 =
  "363170139a06f306be1e894b6f203a9bf03bf4d70d21194aaccdd1c42f760c32";
const healthyReceiptPath = path.join(repository,
  "f1-widget-sdk/build/device-receipts/device-1786939039376-fast-smoke.json");
const healthyReceiptSha256 =
  "1363d31eabba2b61e068d760d966ab25f8b17d1c635a4c91ba7ecd2a0de238e9";

/* Hashes include every byte from the function entry through the byte before
 * the next proven function entry.  A prefix is used only where the claim is a
 * field-access/call-convention seam rather than a callable stock function. */
const spans = Object.freeze([
  { name: "setup_registration_chain", start: 0x42118c68, end: 0x42118ce0,
    sha256: "62bfdea18af749b67242eb1be51da762200f4cee270e97813d29e77ca10ba643",
    proof: "entry; successful controller retained in a6; exact retw.n+pad tail" },
  { name: "setup_three_byte_tail", start: 0x42118cdd, end: 0x42118ce0,
    sha256: "c0c1754d826e9af9771d981f3f524a1de1fbc76f24fefeeb689abb7cf7b356f9",
    proof: "exact bytes 1d f0 00 replaced only by a three-byte J" },
  { name: "stock_key_callback", start: 0x4206eae0, end: 0x4206eb48,
    sha256: "96316a9091816bf7290c75ebe6be76e4ed184ee13fdef6c50b77e791b5ecfa2b",
    proof: "a3 points to opaque u32 token; a4 points to u8 level; return preserved" },
  { name: "stock_key_callback_literal", start: 0x42041568, end: 0x4204156c,
    sha256: "3d5174006fa28e9caeef531cbcdec7bd1d552b0ab7ad1d4f4a8d30c44c0e1dda",
    proof: "little-endian word 0x4206eae0 at raw app offset 0x101568" },
  { name: "heap_caps_free", start: 0x4037e250, end: 0x4037e2a0,
    sha256: "c830d66ccc4cd8d93e006c0ad0623cc880ecb9a96fa21e7e0e5b1583f49bee61",
    proof: "void heap_caps_free(void *); null accepted" },
  { name: "heap_caps_malloc", start: 0x4037e55c, end: 0x4037e588,
    sha256: "c7ed18e365bd48ebbc416104c4a3cdca5408b938a2ea181657c5bc7bc9405a19",
    proof: "void *heap_caps_malloc(size_t,uint32_t)" },
  { name: "heap_caps_get_free_size", start: 0x420c8200, end: 0x420c822c,
    sha256: "82ec92f10a1d4332fd9a64effc86e97612d429b057db9e6bc32d0de9eee3c972",
    proof: "size_t heap_caps_get_free_size(uint32_t)" },
  { name: "heap_caps_get_largest_free_block", start: 0x420c82c4, end: 0x420c82d8,
    sha256: "bac5ed463bc051c397be0412653efa3d42050a6b499c1f7a77bae8ec367709ea",
    proof: "size_t heap_caps_get_largest_free_block(uint32_t)" },
  { name: "xTaskCreatePinnedToCore", start: 0x4038e8b8, end: 0x4038e950,
    sha256: "8b1c9ef18f2fcc1415bf83686467c5069d144fffb89e305f53ef5876d0638630",
    proof: "dynamic form located but deliberately unused by bridge" },
  { name: "xTaskCreateStaticPinnedToCore", start: 0x4038e950, end: 0x4038ea40,
    sha256: "2db652699cc573d2efce67c8f311670395fb82660e45b289a050e164809f1ed1",
    proof: "8-argument windowed ABI; stack depth is bytes; StaticTask_t is 0x160" },
  { name: "vTaskDelete", start: 0x4038db48, end: 0x4038dc3c,
    sha256: "37fe89be6786c94a174bb1a154699126037743ed57faa7e23bb6d918966e64ec",
    proof: "void vTaskDelete(TaskHandle_t); owner exits with NULL" },
  { name: "xTaskGetCurrentTaskHandleForCore", start: 0x4038eb7c, end: 0x4038eba8,
    sha256: "5e770160138c6036ad010a0caf05503623a529b571f4081568054138039ee4eb",
    proof: "TaskHandle_t xTaskGetCurrentTaskHandleForCore(BaseType_t)" },
  { name: "renderer_v1_tick", start: 0x4211960c, end: 0x42119e34,
    sha256: "1a8ab157e36f64cb3b09be5b4ee43172bf86bcdb6486a2139fa8a59ff4c74b2a",
    proof: "saved delegate wrapped by sidecar+4 hook" },
  { name: "renderer_v2_live_tick_prefix", start: 0x4211dc40, end: 0x4211dc80,
    sha256: "2e02b8a56c1554450697c02598eb34ae4ad1b3dca7157470be65cdfcad8b166a",
    proof: "vtable[11] sidecar, magic check, load old_tick at sidecar+4, callx8" },
  { name: "renderer_v2_attach", start: 0x4211da68, end: 0x4211dbe8,
    sha256: "20989516af42b29903ecd1db7a82f85bdd3e1e09985ad3195ba40bec2729dd0e",
    proof: "slot6 remains 0x4211dc40; sidecar placed in slot11" },
  { name: "stock_rpc_registry_getter", start: 0x42004afc, end: 0x42004b28,
    sha256: "5f5af85220d6da8255e7f679343e6866b991a6baa521c20e2df97dd9355085db",
    proof: "boot-lifetime RPC registry singleton getter" },
  { name: "renderer_scene_rpc_register_one", start: 0x4211b7c8, end: 0x4211b7f4,
    sha256: "ad44433930c1e66f7b42e74acdc08f15b5465bec8e7a61d05cf71c4fca344c4a",
    proof: "copies context/closure, registers persistent method, destroys temporary callback" },
  { name: "renderer_scene_rpc_reply_status", start: 0x4211ba58, end: 0x4211bac8,
    sha256: "b32c2c68bfdac4bf3dc7e6e192b2276b2271655daf477eeb24a2f084762a14fc",
    proof: "owned state+313 key and state+192/+200 status strings" },
]);

const sourcePins = Object.freeze([
  { file: "f1-widget-sdk/build/combined-renderer-v2-clock-blue-timer/renderer-v2-chain.S",
    sha256: "49fed894cf09bbe215dee5e74ccc64262ef0480b8e938940162ce7ce2a18f717" },
  { file: "f1-widget-sdk/build/combined-renderer-v2-clock-blue-timer/renderer-v2-native-source.c",
    sha256: "7183c79aabdb2c60a2992608a2ac187a721a2ec2e587123ff64b498be8cceafe" },
  { file: "f1-widget-sdk/examples/renderer-id26/on-device/renderer-v1-scene-rpc.S",
    sha256: "9267dfe3819574bfcd407db851d9810739af8f7868bde68bbf037f1bcc91f728" },
  { file: "custom-firmware/experimental/stage3d-wpm-pet.S",
    sha256: "c6cce0980db2c77ba420d19b0c3e63409ce601a60a983876d3f71c01ac71b895" },
]);

function readVirtual(image, start, end) {
  const segment = image.segments.find((candidate) => start >= candidate.loadAddress &&
    end <= candidate.loadAddress + candidate.length);
  invariant(segment != null, `No image segment contains ${hex(start)}..${hex(end)}.`);
  return segment.data.subarray(start - segment.loadAddress, end - segment.loadAddress);
}

async function verifyHealthyImage() {
  const [app, receiptBytes] = await Promise.all([
    readFile(healthyAppPath), readFile(healthyReceiptPath),
  ]);
  invariant(app.length === 2_062_912 && sha256(app) === healthyAppSha256,
    "Accepted healthy application pin changed.");
  invariant(sha256(receiptBytes) === healthyReceiptSha256,
    "Accepted physical smoke receipt pin changed.");
  const receipt = JSON.parse(receiptBytes);
  invariant(receipt.app?.sha256 === healthyAppSha256 &&
    receipt.app?.flashOffset === "0x10000" &&
    receipt.write?.hashVerifiedByEsptool === true &&
    receipt.postBoot?.version === "0.4.1",
  "Physical receipt no longer proves the healthy app/write/boot tuple.");
  const image = inspectEsp32AppImage(app);
  invariant(image.segmentCount === 6 &&
    image.segments[2].loadAddress === 0x40374000 &&
    image.segments[3].loadAddress === 0x42000020 &&
    image.segments[4].loadAddress === 0x4037d418,
  "Executable segment layout changed.");
  const verified = spans.map((span) => {
    const bytes = readVirtual(image, span.start, span.end);
    invariant(bytes.length === span.end - span.start && sha256(bytes) === span.sha256,
      `Stock ABI span changed: ${span.name}.`);
    return { ...span, start: hex(span.start), end: hex(span.end), bytes: bytes.length };
  });
  invariant(readVirtual(image, 0x42118cdd, 0x42118ce0).toString("hex") === "1df000",
    "Setup tail is no longer retw.n plus one padding byte.");
  invariant(readVirtual(image, 0x42041568, 0x4204156c).readUInt32LE(0) === 0x4206eae0,
    "Key literal no longer points to the stock-first target.");
  invariant(readVirtual(image, 0x4038e950, 0x4038e953).toString("hex") === "368100",
    "Static task entry instruction changed.");
  invariant(readVirtual(image, 0x4038e9bc, 0x4038e9bf).toString("hex") === "82a160",
    "StaticTask_t 0x160 runtime guard changed.");
  return { app, image, receipt, verified };
}

async function verifySourcePins() {
  for (const pin of sourcePins) {
    const bytes = await readFile(path.join(repository, pin.file));
    invariant(sha256(bytes) === pin.sha256, `Evidence source changed: ${pin.file}.`);
  }
  const nativeSource = await readFile(path.join(repository,
    sourcePins[1].file), "utf8");
  invariant(nativeSource.includes("RendererV2OldTick old_tick;") &&
    nativeSource.includes("sidecar->old_tick(controller);") &&
    nativeSource.includes("vtable[6] != (void *)renderer_v2_live_tick") &&
    nativeSource.includes("sidecar->vtable[11] = sidecar"),
  "Renderer-v2 sidecar UI-hook evidence changed.");
  const rpcSource = await readFile(path.join(repository, sourcePins[2].file), "utf8");
  invariant(rpcSource.includes("addi    a4,a5,313") &&
    rpcSource.includes("addi    a5,a5,192") &&
    rpcSource.includes(".Lscene_callback_destroy") &&
    rpcSource.includes("renderer_scene_rpc_register_one"),
  "RPC owned-string/callback-lifetime evidence changed.");
}

const crossFlags = ["-std=c11", "-Os", "-Wall", "-Wextra", "-Werror", "-Wpedantic",
  "-ffreestanding", "-fno-builtin", "-fno-stack-protector", "-fno-unwind-tables",
  "-fno-asynchronous-unwind-tables", "-ffunction-sections", "-fdata-sections",
  "-mlongcalls", "-mtext-section-literals", `-I${directory}`];

async function verifyFailClosed(buildDirectory) {
  try {
    await run(xtensa("gcc"), [...crossFlags, "-c", path.join(directory, "stock_bridge.c"),
      "-o", path.join(buildDirectory, "must-not-exist.o")]);
  } catch (error) {
    const output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    invariant(output.includes("STOCK_BRIDGE_FAIL_CLOSED"),
      "Ungated compile failed for an unexpected reason.");
    return "PASS_FAIL_CLOSED";
  }
  throw new Error("Stock bridge compiled without exact healthy-image acknowledgement.");
}

async function buildStaticBridge(buildDirectory) {
  const object = path.join(buildDirectory, "stock_bridge.o");
  const trampoline = path.join(buildDirectory, "startup_trampoline.o");
  const core = path.join(buildDirectory, "stock-bridge-core.o");
  await Promise.all([
    run(xtensa("gcc"), [...crossFlags,
      "-DFRAMER_STOCK_BRIDGE_EXACT_ABI_ACK=0x36317013u", "-c",
      path.join(directory, "stock_bridge.c"), "-o", object]),
    run(xtensa("gcc"), ["-c", path.join(directory, "startup_trampoline.S"),
      "-o", trampoline]),
  ]);
  await run(xtensa("ld"), ["-r", "-T", path.join(directory, "stock_bridge.ld"),
    object, trampoline, "-o", core]);
  const [coreBytes, undefineds, symbols, sections, disassembly, size] = await Promise.all([
    readFile(core), run(xtensa("nm"), ["-u", core]), run(xtensa("nm"), ["-n", core]),
    run(xtensa("objdump"), ["-h", core]), run(xtensa("objdump"), ["-dr", core]),
    run(xtensa("size"), [core]),
  ]);
  const unresolved = undefineds.stdout.trim().split(/\r?\n/u).filter(Boolean)
    .map((line) => line.trim().replace(/^U\s+/u, "")).sort();
  invariant(JSON.stringify(unresolved) === JSON.stringify([
    "framer_stock_bridge_resident_abort", "framer_stock_bridge_resident_boot",
    "framer_stock_bridge_resident_state",
  ]), `Production bridge fail-closed imports changed: ${JSON.stringify(unresolved)}.`);
  const absolute = Object.fromEntries([...symbols.stdout.matchAll(
    /^([0-9a-f]+)\s+A\s+(framer_stock_(?:heap|key|rpc|task)[^\s]+)$/gmu,
  )].map((match) => [match[2], Number.parseInt(match[1], 16)]));
  const expected = {
    framer_stock_heap_caps_free: 0x4037e250,
    framer_stock_heap_caps_malloc: 0x4037e55c,
    framer_stock_task_delete: 0x4038db48,
    framer_stock_task_create_static_pinned: 0x4038e950,
    framer_stock_task_current_for_core: 0x4038eb7c,
    framer_stock_rpc_registry: 0x42004afc,
    framer_stock_key_callback_original: 0x4206eae0,
    framer_stock_heap_caps_get_free_size: 0x420c8200,
    framer_stock_heap_caps_get_largest_free_block: 0x420c82c4,
    framer_stock_rpc_register_one: 0x4211b7c8,
    framer_stock_rpc_reply_status: 0x4211ba58,
  };
  invariant(JSON.stringify(absolute) === JSON.stringify(expected),
    `Absolute stock call table changed: ${JSON.stringify(absolute)}.`);
  invariant(/\.text\.stock_bridge\.tail\s+00000007/u.test(sections.stdout),
    "Entry-less startup trampoline is not exactly seven bytes.");
  invariant(disassembly.stdout.includes("framer_stock_bridge_key_callback") &&
    disassembly.stdout.includes("framer_stock_key_callback_original") &&
    disassembly.stdout.includes("framer_stock_bridge_tail_trampoline") &&
    disassembly.stdout.includes("framer_stock_bridge_startup"),
  "Static bridge lost a required stock-first/trampoline call edge.");
  const sizeMatch = size.stdout.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+/mu);
  invariant(sizeMatch != null && Number.parseInt(sizeMatch[2], 10) === 0 &&
    Number.parseInt(sizeMatch[3], 10) === 0, "Bridge core gained writable globals.");
  return { core, bytes: coreBytes.length, sha256: sha256(coreBytes), unresolved,
    textBytes: Number.parseInt(sizeMatch[1], 10),
    absolute: Object.fromEntries(Object.entries(absolute)
      .map(([name, value]) => [name, hex(value)])) };
}

async function verifyTailPatch(buildDirectory) {
  const patchObject = path.join(buildDirectory, "tail_patch_probe.o");
  const trampolineObject = path.join(buildDirectory, "tail_probe_trampoline.o");
  const startupSource = path.join(buildDirectory, "tail_probe_startup.S");
  const startupObject = path.join(buildDirectory, "tail_probe_startup.o");
  const linkerScript = path.join(buildDirectory, "tail_probe.ld");
  const elf = path.join(buildDirectory, "tail-probe.elf");
  const patchBinary = path.join(buildDirectory, "setup-tail-jump.bin");
  await Promise.all([
    writeFile(startupSource, `    .section .text.stock_bridge.startup,"ax",@progbits\n` +
      `    .global framer_stock_bridge_startup\n` +
      `framer_stock_bridge_startup:\n    entry a1,32\n    retw.n\n`),
    writeFile(linkerScript, `SECTIONS {\n` +
      `  .text.stock_bridge.patch 0x42118cdd : { *(.text.stock_bridge.patch) }\n` +
      `  .text.stock_bridge.tail 0x4211e460 : { *(.text.stock_bridge.tail) }\n` +
      `  .text.stock_bridge.startup 0x4211e480 : { *(.text.stock_bridge.startup) }\n` +
      `}\n`),
  ]);
  await Promise.all([
    run(xtensa("gcc"), ["-c", path.join(directory, "tail_patch_probe.S"),
      "-o", patchObject]),
    run(xtensa("gcc"), ["-c", path.join(directory, "startup_trampoline.S"),
      "-o", trampolineObject]),
    run(xtensa("gcc"), ["-c", startupSource, "-o", startupObject]),
  ]);
  await run(xtensa("ld"), ["-T", linkerScript, patchObject, trampolineObject,
    startupObject, "-o", elf]);
  await run(xtensa("objcopy"), ["-O", "binary", "-j", ".text.stock_bridge.patch",
    elf, patchBinary]);
  const [patch, disassembly, relocations] = await Promise.all([
    readFile(patchBinary), run(xtensa("objdump"), ["-d", elf]),
    run(xtensa("readelf"), ["-r", elf]),
  ]);
  invariant(patch.length === 3 && patch.toString("hex") !== "1df000",
    "Setup-tail probe did not produce one three-byte jump.");
  invariant(/42118cdd[^\n]*:\s+[0-9a-f]+\s+j\s+4211e460/u.test(disassembly.stdout),
    "Three-byte setup tail does not jump to the entry-less trampoline.");
  invariant(disassembly.stdout.includes("4211e460 <framer_stock_bridge_tail_trampoline>") &&
    /mov\.n\s+a10, a6/u.test(disassembly.stdout) &&
    /call8\s+4211e480/u.test(disassembly.stdout) &&
    /There are no relocations in this file\./u.test(relocations.stdout),
  "Linked tail trampoline call/return proof changed.");
  return { patchAddress: "0x42118cdd", patchBytes: patch.toString("hex"),
    trampolineProbeAddress: "0x4211e460", startupProbeAddress: "0x4211e480",
    semantics: "J -> entryless mov a10,a6; call8 startup; retw.n" };
}

async function main() {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "framer-stock-bridge-"));
  try {
    const [{ verified, receipt }, failClosed, staticBridge, tailPatch] = await Promise.all([
      verifyHealthyImage(), verifyFailClosed(temporary),
      buildStaticBridge(temporary), verifyTailPatch(temporary), verifySourcePins(),
    ]);
    const matrix = [
      { seam: "setup tail/startup return", status: "PROVEN_STATIC",
        detail: "3-byte J reaches entry-less trampoline; call8 startup returns through original retw window; controller valid only on successful chain path and is runtime-validated" },
      { seam: "heap allocation/free/preflight", status: "PROVEN_STATIC",
        detail: "exact full spans; PSRAM allocation is range-checked; internal/PSRAM free+largest are sampled" },
      { seam: "static pinned task/create/delete/current token", status: "PROVEN_STATIC",
        detail: "exact full spans; 0x160 TCB; caller-owned internal stack; owner acknowledges then vTaskDelete(NULL)" },
      { seam: "task stack high-water", status: "UNPROVEN_NO_GO",
        detail: "uxTaskGetStackHighWaterMark symbols were linker-GC'd; no address is invented" },
      { seam: "task WDT lifecycle", status: "UNPROVEN_NO_GO",
        detail: "complete add/reset/delete tuple and recovery behavior are not pinned; bridge deliberately does not register" },
      { seam: "UI-thread mailbox callback", status: "PROVEN_STATIC",
        detail: "wrap sidecar old_tick at +4, call renderer-v1 first, then bounded sink; slot6 remains 0x4211dc40 so ID26/27 and native APIs retain identity" },
      { seam: "general mailbox-to-DOM rendering", status: "UNPROVEN_NO_GO",
        detail: "bridge exposes the UI sink but does not implement arbitrary 16-slot renderer semantics" },
      { seam: "stock-first key ingress", status: "PROVEN_STATIC",
        detail: "image-time literal patch target; original callback runs first; opaque u32+u8 copied only into a nonblocking sink" },
      { seam: "key hook removal", status: "CONDITIONAL_NO_GO",
        detail: "immutable IROM literal cannot be restored at runtime; logical detach/quiesce preserves stock fallback but requires input delivery paused before cache-off flash work" },
      { seam: "owned capability/status RPC", status: "PROVEN_STATIC_NO_RECEIPT",
        detail: "boot-lifetime RAM method/key/value/context; exact existing register/reply helpers; registration API has no applied receipt" },
      { seam: "automatic cache/flash-operation interception", status: "UNPROVEN_NO_GO",
        detail: "no exact notification seam recovered; all module writes must be routed through explicit stop/destroy/unmap quiescence" },
      { seam: "resident integration", status: "FAIL_CLOSED_NO_GO",
        detail: `production object intentionally retains only ${staticBridge.unresolved.join(", ")}` },
    ];
    const staticBridgeManifest = { ...staticBridge,
      core: "build/stock-bridge-core.o" };
    const manifest = {
      format: "framer-mquickjs-stock-bridge-static-v1",
      physicalCandidate: "NO_GO",
      reason: "Exact static seams exist, but resident binding, general visual application, WDT lifecycle, key-source pause, cache/flash interception, physical receipt, and soak proof remain open.",
      healthyBase: { app: path.relative(repository, healthyAppPath),
        bytes: 2_062_912, sha256: healthyAppSha256,
        receipt: path.relative(repository, healthyReceiptPath),
        receiptSha256: healthyReceiptSha256,
        receiptVersion: receipt.postBoot?.version },
      failClosed, compiler: (await run(xtensa("gcc"), ["--version"])).stdout.split(/\r?\n/u)[0],
      spans: verified, sourcePins, staticBridge: staticBridgeManifest, tailPatch, matrix,
      explicitNonClaims: [
        "No firmware image was produced or patched.",
        "No keyboard was connected, flashed, or exercised.",
        "The illustrative trampoline addresses prove instruction feasibility, not final resident placement.",
        "The status RPC registration attempt is not an applied-revision or delivery receipt.",
        "Logical key detach does not intercept or serialize arbitrary stock flash operations.",
      ],
    };
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(path.join(outputDirectory, "stock-bridge-manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(path.join(outputDirectory, "stock-bridge-core.o"),
      await readFile(staticBridge.core));
    process.stdout.write(`stock_bridge=PASS_STATIC physical=${manifest.physicalCandidate} ` +
      `spans=${verified.length} core_bytes=${staticBridge.bytes} ` +
      `tail_jump=${tailPatch.patchBytes} unresolved=${staticBridge.unresolved.length}\n`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

await main();
