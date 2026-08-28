#!/usr/bin/env node
// Builds the DIAGNOSTIC resident loader (loader_entry_diag.c) against the frozen
// ABI-v3 release module pages and composes an app-only image from the released
// candidate app. Slot-A pages on flash are unchanged; only the loader cavity,
// key literal, and image footer differ from 674054a6. Never touches hardware.

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { inspectEsp32AppImage, repairEsp32AppIntegrity } from
  "../../custom-firmware/lib/esp-app-image.mjs";

const execute = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(here, "../..");
const release = path.join(here, "releases/2026-08-17-id28-abi3-674054a6");
const moduleLoader = path.join(repository, "experiments/mquickjs-esp32s3-module-loader");
const canaryHeader = path.join(repository, "experiments/mquickjs-esp32s3-canary/framer_mquickjs_canary.h");
const healthyApp = path.join(repository,
  "f1-widget-sdk/build/combined-renderer-v2-clock-blue-timer/" +
  "framer-0.4.1-music-id1-wpm-id7-renderer-id26-clock-id27-blue-timer-app.bin");
const output = process.env.FRAMER_DIAG_LOADER_OUTPUT ?? path.join(here, "build-diag");
const toolchain = process.env.FRAMER_XTENSA_BIN ?? path.join(repository,
  ".toolchains/xtensa-esp-elf-13.2.0_20240530/bin");
const xtensa = (name) => path.join(toolchain, `xtensa-esp32s3-elf-${name}`);

const layout = Object.freeze({
  loaderVaddr: 0x4211e460, loaderEnd: 0x4211ff18,
  setupTail: 0x42118cdd, keyLiteral: 0x42041568,
});
const expected = Object.freeze({
  candidateAppSha256: "674054a6e9d6536ad2414096cd89c1025e78904dff6b4a1aee0ef8cab434e808",
  healthyAppSha256: "363170139a06f306be1e894b6f203a9bf03bf4d70d21194aaccdd1c42f760c32",
  textSha256: "bd46e3473b8493291aadebcf1d093e812a0788866e787663920637a3d76c8c43",
  rodataSha256: "72a2a26cb9cb0c0c52ab0ee897ad5d59b0a3c9765d3f495bfe96565b305a8c43",
  slotSha256: "b1104134b37c9b6726e96f852b28e1eb971ba3aa4870d44543cfd1c5e8c6a6c1",
  loaderSha256: "cd0e352b46d23193d07c696355442ee2a68311c44ad3a901692627560fbde97c",
  moduleAbi: "6e3bfee6c3a167f2e06f7f1c7b063e7c2b31977430d6b9303cfbf31a4c51338d",
  startupVaddr: 0x423e3510, id28IdentityVaddr: 0x423e5d8c, keySinkVaddr: 0x423e3390,
  textUsedBytes: 91856, blockBytes: 95568,
});
/* physical_block offsets for the FROZEN release module, re-derived with the
 * xtensa offsetof probe in build-diag-module.mjs (probe_block.c) and identical
 * to the values this script previously hard-coded inside loader_entry_diag.c.
 * The release engine has no last_error buffer, so BLK_LAST_ERROR points at the
 * unused tail of the 4096-byte framer_mqjs_runtime storage (sizeof of the
 * release runtime_state is 3240): in range, always zero, so diag4 answers
 * "v4;empty" instead of faulting. */
const blockOffsets = Object.freeze({
  BLK_MAGIC: 0, BLK_SOURCES_ENABLED: 12, BLK_BOOT_STATE: 48, BLK_RPC_READY: 56,
  BLK_BOOT_STARTED_MS: 112, BLK_BOOT_FINISHED_MS: 116, BLK_TASK_HANDLE: 148,
  BLK_OWNER_ADM_GENERATION: 7152, BLK_OWNER_ADM_COUNTS: 7176,
  BLK_OWNER_ADM_EVENT0: 7244, BLK_OWNER_CAP_READY_MASK: 16352,
  BLK_OWNER_CAP_STATE: 16356, BLK_OWNER_HEAP: 29880,
  BLK_OWNER_SOURCE_QUIESCE: 29936, BLK_OWNER_TEL_LAST_RESULT: 30024,
  BLK_OWNER_TEL_BOOTED: 30028,
  BLK_LAST_ERROR: 3056 + 3240, BLK_LAST_ERROR_BYTES: 108,
});
const offsetDefines = Object.entries(blockOffsets)
  .map(([name, value]) => `-D${name}=${value}u`);

const invariant = (ok, message) => { if (!ok) throw new Error(message); };
const hex = (value) => `0x${value.toString(16)}`;
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const words = (digest, endian) => Array.from({ length: 8 }, (_, i) =>
  digest[endian === "le" ? "readUInt32LE" : "readUInt32BE"](i * 4));
const wordDefines = (prefix, values) => values.map((v, i) => `-D${prefix}_W${i}=${hex(v)}u`);
async function run(file, args) {
  return execute(file, args, { cwd: repository, maxBuffer: 64 * 1024 * 1024 });
}
const crossFlags = ["-std=c11", "-Os", "-DNDEBUG", "-fno-builtin",
  "-fno-stack-protector", "-fno-unwind-tables", "-fno-asynchronous-unwind-tables",
  "-ffunction-sections", "-fdata-sections", "-mlongcalls", "-mtext-section-literals",
  "-fno-jump-tables", "-fno-tree-loop-distribute-patterns"];
async function compile(source, destination, includes, extra) {
  await run(xtensa("gcc"), [...crossFlags, ...extra, ...includes.map((i) => `-I${i}`),
    "-c", source, "-o", destination]);
}
function sectionTable(text) {
  const table = {};
  for (const m of text.matchAll(/^\s*\d+\s+(\S+)\s+([0-9a-f]{8})\s+([0-9a-f]{8})/gmu))
    table[m[1]] = { bytes: parseInt(m[2], 16), vaddr: parseInt(m[3], 16) };
  return table;
}
function symbolAddress(text, name) {
  const m = new RegExp(`^([0-9a-f]{8}) [Tt] ${name}$`, "mu").exec(text);
  invariant(m, `Missing symbol ${name}`);
  return parseInt(m[1], 16);
}
function readVirtual(image, start, end) {
  const irom = image.segments[3];
  return irom.data.subarray(start - irom.loadAddress, end - irom.loadAddress);
}
function diffRanges(a, b) {
  const runs = []; let i = 0;
  while (i < a.length) {
    while (i < a.length && a[i] === b[i]) i++;
    if (i === a.length) break;
    const start = i; while (i < a.length && a[i] !== b[i]) i++;
    runs.push({ start, end: i });
  }
  return runs;
}

await rm(output, { recursive: true, force: true });
await mkdir(output);

// --- inputs -----------------------------------------------------------------
const [candidate, healthy, textPage, rodataPage, oldLoader, header] = await Promise.all([
  readFile(path.join(release, "framer-0.4.1-mqjs-id28-canary-NO-GO-app.bin")),
  readFile(healthyApp),
  readFile(path.join(release, "mqjs-id28-text-page.bin")),
  readFile(path.join(release, "mqjs-id28-rodata-page.bin")),
  readFile(path.join(release, "mqjs-id28-resident-loader.bin")),
  readFile(canaryHeader, "utf8"),
]);
invariant(sha(candidate) === expected.candidateAppSha256, "Released candidate app changed.");
invariant(sha(healthy) === expected.healthyAppSha256, "Healthy app changed.");
invariant(sha(textPage) === expected.textSha256 && sha(rodataPage) === expected.rodataSha256,
  "Release module pages changed.");
const slotDigest = createHash("sha256").update(Buffer.concat([textPage, rodataPage])).digest();
invariant(slotDigest.toString("hex") === expected.slotSha256, "Slot digest mismatch.");
invariant(sha(oldLoader) === expected.loaderSha256, "Release loader changed.");
const runtimeBytes = Number(/FRAMER_MQJS_RUNTIME_STORAGE_BYTES\s+(\d+)u/u.exec(header)[1]);
const heapBytes = Number(/FRAMER_MQJS_MIN_HEAP_BYTES\s+(\d+)u/u.exec(header)[1]);
const textDigest = createHash("sha256").update(textPage).digest();
const rodataDigest = createHash("sha256").update(rodataPage).digest();

// --- compile + link ---------------------------------------------------------
const objects = {
  tail: path.join(output, "tail.o"), entry: path.join(output, "loader-entry-diag.o"),
  key: path.join(output, "key-wrapper.o"), loader: path.join(output, "resident-loader.o"),
};
await Promise.all([
  compile(path.join(moduleLoader, "resident_loader_canary.c"), objects.loader, [moduleLoader], [
    `-DFRAMER_MODULE_RUNTIME_STORAGE_BYTES=${runtimeBytes}u`,
    `-DFRAMER_MODULE_MIN_HEAP_BYTES=${heapBytes}u`,
    `-DFRAMER_MODULE_TEXT_USED_BYTES=${expected.textUsedBytes}u`,
    ...wordDefines("FRAMER_MODULE_TEXT_SHA256", words(textDigest, "be")),
    ...wordDefines("FRAMER_MODULE_RODATA_SHA256", words(rodataDigest, "be")),
    ...wordDefines("FRAMER_MQJS_ABI_SHA256", words(Buffer.from(expected.moduleAbi, "hex"), "le")),
  ]),
  compile(path.join(here, "loader_entry_diag.c"), objects.entry, [moduleLoader], [
    `-DFRAMER_PHYSICAL_STARTUP_VADDR=${hex(expected.startupVaddr)}u`,
    `-DFRAMER_PHYSICAL_BLOCK_BYTES=${expected.blockBytes}u`,
    ...offsetDefines,
    ...wordDefines("FRAMER_PHYSICAL_MODULE_SHA256", words(slotDigest, "le")),
  ]),
  compile(path.join(here, "key_wrapper.c"), objects.key, [], [
    `-DFRAMER_PHYSICAL_ID_VADDR=${hex(expected.id28IdentityVaddr)}u`,
    `-DFRAMER_PHYSICAL_KEY_SINK_VADDR=${hex(expected.keySinkVaddr)}u`,
  ]),
  run(xtensa("gcc"), ["-c", path.join(here, "tail_trampoline.S"), "-o", objects.tail]),
]);
// No object may carry writable/rodata payload: loader.ld would silently discard it.
for (const [name, object] of Object.entries(objects)) {
  const table = sectionTable((await run(xtensa("objdump"), ["-h", object])).stdout);
  for (const [section, info] of Object.entries(table)) {
    if (/^\.(rodata|data|bss|sdata|sbss)/u.test(section) && info.bytes > 0)
      throw new Error(`${name} object carries ${section} (${info.bytes} B); loader must be text-only.`);
  }
}
const elf = path.join(output, "resident-loader-diag.elf");
await run(xtensa("gcc"), ["-nostdlib", "-Wl,--gc-sections", `-Wl,-T,${path.join(here, "loader.ld")}`,
  "-o", elf, objects.tail, objects.entry, objects.key, objects.loader, "-lgcc"]);
const [headers, relocations, undefineds, symbols, disassembly] = await Promise.all([
  run(xtensa("objdump"), ["-h", elf]), run(xtensa("readelf"), ["-r", elf]),
  run(xtensa("nm"), ["-u", elf]), run(xtensa("nm"), ["-n", elf]), run(xtensa("objdump"), ["-d", elf]),
]);
invariant(/There are no relocations/u.test(relocations.stdout) && !undefineds.stdout.trim(),
  `Loader retained relocations/undefined symbols: ${undefineds.stdout}`);
const sections = sectionTable(headers.stdout);
invariant(sections[".text"]?.vaddr === layout.loaderVaddr &&
  sections[".text"].bytes <= layout.loaderEnd - layout.loaderVaddr,
  `Loader escaped cavity: ${JSON.stringify(sections[".text"])}`);
const rawFile = path.join(output, "mqjs-id28-resident-loader-diag.bin");
await run(xtensa("objcopy"), ["-O", "binary", "-j", ".text", elf, rawFile]);
const raw = await readFile(rawFile);
await writeFile(path.join(output, "resident-loader-diag.dis.txt"), disassembly.stdout);
const tailAddress = symbolAddress(symbols.stdout, "framer_physical_tail_trampoline");
const keyWrapper = symbolAddress(symbols.stdout, "framer_physical_key_wrapper");
invariant(tailAddress === layout.loaderVaddr, "Tail trampoline must sit at the cavity start.");
// The diagnostic must call the same stock helpers in the same admission order,
// plus esp_timer_get_time / uxTaskGetStackHighWaterMark for the live renderers.
for (const helper of ["0x42004afc", "0x4211b7c8", "0x4211ba58", "0x4038dc3c", "0x420c8200",
  "0x420c82c4", "0x4037e55c", "0x4037e250", "0x4037e028", "0x4038daf4"]) {
  invariant(disassembly.stdout.includes(helper.slice(2)), `Loader disassembly lacks helper ${helper}.`);
}
// Text-only means no compiler-emitted block helpers may have crept in.
for (const forbidden of ["<memcpy>", "<memset>", "<memmove>", "<bzero>"]) {
  invariant(!disassembly.stdout.includes(forbidden),
    `Loader disassembly calls ${forbidden}; loader must stay builtin-free.`);
}

// --- compose app from released candidate ------------------------------------
const before = inspectEsp32AppImage(candidate);
const irom = before.segments[3];
const cavityBytes = layout.loaderEnd - layout.loaderVaddr;
const cavity = readVirtual(before, layout.loaderVaddr, layout.loaderEnd);
invariant(cavity.subarray(0, oldLoader.length).equals(oldLoader) &&
  cavity.subarray(oldLoader.length).every((b) => b === 0),
  "Candidate cavity does not hold the released loader + zeros.");
invariant(readVirtual(before, layout.setupTail, layout.setupTail + 3).toString("hex") !== "1df000",
  "Candidate setup tail is not patched.");
const app = Buffer.from(candidate);
const cavityOffset = irom.dataOffset + layout.loaderVaddr - irom.loadAddress;
app.fill(0, cavityOffset, cavityOffset + cavityBytes);
raw.copy(app, cavityOffset);
app.writeUInt32LE(keyWrapper, irom.dataOffset + layout.keyLiteral - irom.loadAddress);
const repaired = repairEsp32AppIntegrity(app);
const after = inspectEsp32AppImage(repaired);
invariant(after.segmentCount === before.segmentCount && repaired.length === candidate.length,
  "Diag app layout/length changed.");
for (let i = 0; i < before.segmentCount; i++) {
  invariant(before.segments[i].loadAddress === after.segments[i].loadAddress &&
    before.segments[i].length === after.segments[i].length, `Segment ${i} layout changed.`);
  if (i !== 3) invariant(before.segments[i].data.equals(after.segments[i].data),
    `Non-IROM segment ${i} changed.`);
}
// Diff vs healthy must be exactly: setup tail (3), key literal (4), cavity, footer.
const allowed = [
  [irom.dataOffset + layout.setupTail - irom.loadAddress, 3],
  [irom.dataOffset + layout.keyLiteral - irom.loadAddress, 4],
  [cavityOffset, cavityBytes],
  [candidate.length - 33, 33],
];
for (const range of diffRanges(healthy, repaired)) {
  invariant(allowed.some(([s, n]) => range.start >= s && range.end <= s + n),
    `Unexpected diff vs healthy app at ${range.start}..${range.end}`);
}
const appFile = path.join(output, "framer-0.4.1-mqjs-id28-DIAG-loader-app.bin");
await writeFile(appFile, repaired);
const manifest = {
  format: "framer-f1-mquickjs-diag-loader-build-v1",
  purpose: "Report which loader admission gate stops the mqjs canary on the physical F1",
  baseCandidateAppSha256: expected.candidateAppSha256,
  healthyAppSha256: expected.healthyAppSha256,
  slotAUnchanged: { textSha256: expected.textSha256, rodataSha256: expected.rodataSha256,
    slotSha256: expected.slotSha256, note: "pages already on flash at 0x210000/0x230000; app-only write suffices" },
  loader: { file: rawFile, bytes: raw.length, sha256: sha(raw), cavityBytes,
    tailAddress: hex(tailAddress), keyWrapper: hex(keyWrapper) },
  app: { file: appFile, bytes: repaired.length, sha256: sha(repaired), offset: "0x10000" },
  rpc: {
    responseKey: "status",
    reader: "experiments/mquickjs-esp32s3-physical-canary/diag-read.mjs",
    note: "every value is re-rendered from live memory inside the RPC callback",
    methods: {
      "widget.mquickjs.diag": {
        format: "v1;g=<gate>;f0=<free>;l0=<largest>;b=<block>;f1=<free>;l1=<largest>;m=<maprc>;s=<startup>;r=<regticks> (hex)",
        gates: { 0: "entered", 1: "backend identity reject", 2: "pre-alloc admission reject",
          3: "alloc null/misaligned/out-of-range", 4: "post-alloc reserve reject",
          5: "map failed (m)", 6: "startup returned 0", 7: "startup returned 1" },
      },
      "widget.mquickjs.diag2": {
        format: "v2;b=<boot_state>;y=<rpc_ready>;s=<sources_enabled>;t=<boot_started_ms>;f=<boot_finished_ms>;k=<task_handle>;w=<stack_high_water>;u=<startup_us>;h=<free_internal>;g=<largest_internal> (hex)",
        bootStates: { 1: "owner task started", 2: "owner admitted (VM+assets ok)",
          3: "f2js/owner boot admit failed", 4: "publish_proxy returned null",
          5: "LZSS base decode failed", 6: "F2TF preflight failed",
          7: "published ok (rpc_ready)", 8: "register_rpc failed",
          9: "startup timed out waiting for owner", 10: "registry registration mismatch" },
      },
      "widget.mquickjs.diag3": {
        format: "v3;m=<block magic>;c=<owner.capability.state>;r=<capability.ready_mask>;a=<admission.generation>;n=<key_count|chord_count<<8|source_bytes<<16>;e=<admission.events[0].kind|id<<16>;p=<owner.heap>;l=<owner.telemetry.last_result>;d=<telemetry.booted|permanently_disabled<<8>;v=<owner.source_quiesce_state> (hex)",
      },
      "widget.mquickjs.diag4": {
        format: "v4;<runtime_state::last_error as printable ASCII>",
        note: "always v4;empty against this FROZEN release module, which has no last_error buffer; build-diag-module/ carries the instrumented module that fills it",
      },
    },
    unknownField: "ffffffff means the resident block pointer is unknown/out of range",
  },
  blockOffsets: { ...blockOffsets, sizeofBlock: expected.blockBytes },
  rollback: { app: healthyApp, sha256: expected.healthyAppSha256, offset: "0x10000" },
};
await writeFile(path.join(output, "diag-build-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({ status: "PASS_DIAG_LOADER_BUILT_NO_HARDWARE",
  loaderBytes: raw.length, loaderSha256: manifest.loader.sha256, keyWrapper: hex(keyWrapper),
  appSha256: manifest.app.sha256, appBytes: repaired.length, out: output }, null, 2));
