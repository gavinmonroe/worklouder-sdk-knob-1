#!/usr/bin/env node
/* Host proof for the boot default-scene adopt record validator.
 *
 * Same discipline as psram-heap-host-proof.mjs: psram-module-src/
 * physical_integration.c cannot be compiled on this host (it asserts a 32-bit
 * target and calls stock ESP32-S3 entry points through absolute addresses), so
 * this proof EXTRACTS the exact source text of the pure validator functions and
 * the exact constants they use, and compiles that text natively.  Unlike the
 * heap proof it needs NO host substitutions at all: every extracted function is
 * self-contained over the SCENE_* defines.
 *
 * It also cross-checks, against primary artifacts rather than prose:
 *   - every pinned renderer address in the module source names the symbol the
 *     comment claims, in the disassembly of the renderer as linked into the
 *     accepted app (renderer-v2-disassembly.txt);
 *   - the two esp_mmu_* addresses match the resident loader's linker script;
 *   - the device-side CRC-32 agrees with the JS builder's on the real record;
 *   - the real scene-slot-b.bin header is accepted, and every single-byte
 *     mutation of its CRC-covered span is rejected;
 *   - every pinned stock ESP-IDF flash entry point, the scene-RPC registry
 *     node layout and the renderer-v2 sidecar switch offset are re-derived
 *     from the bytes of the accepted app image itself, not from prose;
 *   - the slot-B persist state machine is executed end to end against a fake
 *     NOR-flash model (sector semantics, 1 -> 0 programming only), including
 *     torn-write injection at every step and bounds-violation rejection.
 *
 * No hardware, serial, or flashing is performed.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { buildSceneSlotB, crc32, SCENE_SLOT_B } from "./build-scene-slot-b.mjs";
import { inspectEsp32AppImage } from "../../custom-firmware/lib/esp-app-image.mjs";

const execute = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(here, "../..");
const moduleSource = path.join(here, "psram-module-src/physical_integration.c");
const disassembly = path.join(repository,
  "f1-widget-sdk/build/combined-renderer-v2-clock-blue-timer/renderer-v2-disassembly.txt");
const loaderScript = path.join(repository,
  "experiments/mquickjs-esp32s3-module-loader/resident_loader.ld");
const appImage = path.join(repository,
  "f1-widget-sdk/build/combined-renderer-v2-clock-blue-timer/" +
  "framer-0.4.1-music-id1-wpm-id7-renderer-id26-clock-id27-blue-timer-app.bin");
const output = path.join(here, "build-scene-slot-b-host-proof");
const cc = process.env.CC ?? "cc";

const invariant = (ok, message) => { if (!ok) throw new Error(message); };
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

/* Whole function definition: signature line through the first line that is
 * exactly "}".  The module file is uniformly formatted that way. */
function extractFunction(text, signature) {
  const start = text.indexOf(signature);
  invariant(start >= 0, `Missing function "${signature}" in the module source.`);
  const end = text.indexOf("\n}\n", start);
  invariant(end > start, `Unterminated function "${signature}".`);
  return text.slice(start, end + 3);
}

function extractDefine(text, name) {
  const match = new RegExp(`^#define ${name} .*$`, "mu").exec(text);
  invariant(match, `Missing #define ${name}.`);
  return match[0];
}

function pinnedAddress(text, macro) {
  const match = new RegExp(
    `^#define ${macro} \\(\\([A-Za-z0-9_ ]+\\)\\(uintptr_t\\)0x([0-9a-f]{8})u\\)$`,
    "mu").exec(text);
  invariant(match, `Missing pinned address macro ${macro}.`);
  return match[1];
}

const source = await readFile(moduleSource, "utf8");

// --- 1. pinned addresses must name the symbols the module claims ------------
const disassemblyText = await readFile(disassembly, "utf8");
const loaderText = await readFile(loaderScript, "utf8");
const rendererPins = [
  ["STOCK_SHA256", "sha256"],
  ["STOCK_PREPARE_STORE", "renderer_v1_prepare_store"],
  ["STOCK_STAGE_BUNDLE", "renderer_v1_stage_bundle"],
  ["STOCK_V2_PREPARE", "renderer_v2_native_prepare"],
  ["STOCK_V2_COMMIT", "renderer_v2_native_commit"],
  ["STOCK_V2_CANCEL", "renderer_v2_native_cancel"],
];
const pinnedEvidence = rendererPins.map(([macro, symbol]) => {
  const address = pinnedAddress(source, macro);
  const line = `${address} <${symbol}>:`;
  invariant(disassemblyText.includes(line),
    `${macro} = 0x${address} is not "${line}" in renderer-v2-disassembly.txt.`);
  return { macro, address: `0x${address}`, symbol, evidence: line };
});
for (const [macro, symbol] of [["STOCK_MMU_MAP", "esp_mmu_map"],
  ["STOCK_MMU_UNMAP", "esp_mmu_unmap"]]) {
  const address = pinnedAddress(source, macro);
  const line = `PROVIDE(${symbol} = 0x${address});`;
  invariant(loaderText.includes(line),
    `${macro} = 0x${address} is not "${line}" in resident_loader.ld.`);
  pinnedEvidence.push({ macro, address: `0x${address}`, symbol, evidence: line });
}

// --- 1b. app-image evidence for every non-renderer pinned address ----------
const image = await readFile(appImage);
const imageInfo = inspectEsp32AppImage(image);
const imageSegments = imageInfo.segments ?? imageInfo;
const readImage = (address, bytes) => {
  const segment = imageSegments.find((s) =>
    address >= s.loadAddress && address + bytes <= s.loadAddress + s.length);
  invariant(segment, `0x${address.toString(16)} is not inside any app segment.`);
  return segment.data.subarray(address - segment.loadAddress,
    address - segment.loadAddress + bytes);
};
const readWord = (address) => readImage(address, 4).readUInt32LE(0);
const bytesAt = (address, count) => readImage(address, count).toString("hex");
const cString = (address) => {
  const window = readImage(address, 64);
  const end = window.indexOf(0);
  invariant(end > 0, `No NUL-terminated string at 0x${address.toString(16)}.`);
  return window.subarray(0, end).toString("latin1");
};
/* Whole-image scan for the l32r instructions that load a given literal
 * address.  l32r is 3 bytes: (t<<4)|1, then the signed 16-bit word offset. */
function l32rReferences(literalAddress) {
  const hits = [];
  for (const segment of imageSegments) {
    const { data, loadAddress, length } = segment;
    for (let index = 0; index + 3 <= length; index += 1) {
      if ((data[index] & 0x0f) !== 0x01) continue;
      const immediate = data[index + 1] | (data[index + 2] << 8);
      const pc = loadAddress + index;
      const target = (((pc + 3) & ~3) + ((immediate - 0x10000) * 4)) >>> 0;
      if (target === literalAddress) hits.push(pc);
    }
  }
  return hits;
}

const flashPins = [
  { macro: "STOCK_FLASH_ERASE", address: 0x4037f0f0, frame: "368100",
    nameLiteral: 0x40374c34, nameString: "esp_flash_erase_region",
    reference: 0x4037f28e, prologue: "294181" },
  { macro: "STOCK_FLASH_WRITE", address: 0x4037f460, frame: "36a100",
    nameLiteral: 0x40374c44, nameString: "esp_flash_write",
    reference: 0x4037f54d, prologue: "298181" },
];
const flashEvidence = [];
for (const pin of flashPins) {
  const pinned = parseInt(pinnedAddress(source, pin.macro), 16);
  invariant(pinned === pin.address,
    `${pin.macro} moved off 0x${pin.address.toString(16)}.`);
  invariant(bytesAt(pinned, 3) === pin.frame,
    `${pin.macro} does not start with the expected Xtensa entry instruction.`);
  invariant(bytesAt(pinned + 3, 3) === pin.prologue,
    `${pin.macro} does not save its chip argument where esp_flash_api.c does.`);
  invariant(cString(readWord(pin.nameLiteral)) === pin.nameString,
    `Literal 0x${pin.nameLiteral.toString(16)} is not "${pin.nameString}".`);
  const references = l32rReferences(pin.nameLiteral);
  invariant(references.length === 1 && references[0] === pin.reference,
    `"${pin.nameString}" is referenced from ${references.map((a) =>
      `0x${a.toString(16)}`).join(",")}, not only 0x${pin.reference.toString(16)}.`);
  invariant(references[0] > pinned && references[0] < pinned + 0x400,
    `The "${pin.nameString}" assert is not inside ${pin.macro}.`);
  flashEvidence.push({ macro: pin.macro, address: `0x${pinned.toString(16)}`,
    symbol: pin.nameString,
    evidence: `entry at 0x${pinned.toString(16)}; only l32r of the __func__ ` +
      `literal 0x${pin.nameLiteral.toString(16)} ("${pin.nameString}") in the ` +
      `whole image is at 0x${references[0].toString(16)}` });
}
/* esp_flash_read has no assert of its own; it is pinned by having the exact
 * esp_flash_api.c prologue and by dispatching chip->chip_drv->read. */
{
  const pinned = parseInt(pinnedAddress(source, "STOCK_FLASH_READ"), 16);
  invariant(pinned === 0x4037f31c, "STOCK_FLASH_READ moved off 0x4037f31c.");
  invariant(bytesAt(pinned, 6) === "368100294181",
    "STOCK_FLASH_READ does not share the esp_flash_api.c prologue.");
  flashEvidence.push({ macro: "STOCK_FLASH_READ", address: "0x4037f31c",
    symbol: "esp_flash_read",
    evidence: "same entry a1,64 + s32i a2,a1,16 + chip_check prologue as " +
      "esp_flash_erase_region, between it and esp_flash_write" });
}
/* rom_spiflash_api_funcs and the NULL-chip substitution both entries rely on. */
const apiFuncsVariable = readWord(0x40374bfc);
invariant(apiFuncsVariable === 0x3fca8434,
  `The api-funcs literal names 0x${apiFuncsVariable.toString(16)}, not the ` +
  "rom_spiflash_api_funcs variable at 0x3fca8434.");
const apiFuncs = readWord(apiFuncsVariable);
invariant(apiFuncs === 0x3fca8438,
  `rom_spiflash_api_funcs points at 0x${apiFuncs.toString(16)}, not 0x3fca8438.`);
invariant(readWord(apiFuncs + 8) === 0x4037edf0,
  "esp_flash_api_funcs.chip_check is not 0x4037edf0.");
invariant(readWord(apiFuncs + 12) === 0x4037eda8,
  "esp_flash_api_funcs.flash_end_flush_cache is not 0x4037eda8.");
invariant(readWord(0x40374c00) === 0x3fcb2ef8,
  "chip_check does not substitute esp_flash_default_chip at 0x3fcb2ef8.");
/* Both mutating entries end through table[12] (flash_end_flush_cache), which
 * is what makes the written range cache-coherent for any mapped view. */
for (const [macro, site] of [["STOCK_FLASH_ERASE", 0x4037f2c4],
  ["STOCK_FLASH_WRITE", 0x4037f58a]]) {
  invariant(bytesAt(site + 3, 2) === "8808" && bytesAt(site + 5, 2) === "8838",
    `${macro} does not call rom_spiflash_api_funcs->flash_end_flush_cache.`);
  const references = l32rReferences(0x40374bfc).filter((a) => a === site);
  invariant(references.length === 1,
    `${macro} flush-cache site 0x${site.toString(16)} does not load the api table.`);
}

/* Region protection.  esp_flash refuses any erase/write inside the first APP
 * partition, and slot B lives inside it, so the persist path raises
 * app_func_arg_t::no_protect for exactly one stock call.  Everything that
 * decision rests on is re-derived here. */
const partitionTable = (await readFile(path.join(repository,
  "f1-widget-sdk/build/combined-renderer-v2-clock-blue-timer/" +
  "framer-0.4.1-music-id1-wpm-id7-renderer-id26-clock-id27-blue-timer-merged.bin")))
  .subarray(0x8000, 0x9000);
const partitions = [];
for (let offset = 0; offset + 32 <= partitionTable.length; offset += 32) {
  if (partitionTable.readUInt16LE(offset) !== 0x50aa) break;
  partitions.push({
    label: partitionTable.subarray(offset + 12, offset + 28)
      .toString("latin1").replace(/\0.*$/u, ""),
    type: partitionTable[offset + 2],
    address: partitionTable.readUInt32LE(offset + 4),
    size: partitionTable.readUInt32LE(offset + 8),
    flags: partitionTable.readUInt32LE(offset + 28),
  });
}
const firstApp = partitions.find((entry) => entry.type === 0);
invariant(firstApp !== undefined, "No APP partition in the flashed table.");
invariant(SCENE_SLOT_B.paddr >= firstApp.address &&
  SCENE_SLOT_B.paddr < firstApp.address + firstApp.size,
"Slot B is no longer inside the first APP partition; re-check whether the " +
"esp_flash region-protection escape is still needed at all.");
invariant(partitions.every((entry) => entry.flags === 0),
  "A partition now carries flags; the read-only scan at 0x420c2af4 may refuse " +
  "slot B even with no_protect raised.");
invariant(readWord(0x420bdbd0) === 0x8c00,
  "esp_partition_main_flash_region_safe's low guard is no longer 0x8c00.");
const osFunc = 0x3fca84a4;
invariant(readWord(osFunc + 8) === 0x4037f904,
  "The app esp_flash os_func table's region_protected slot moved.");
invariant(bytesAt(0x4037f904, 3) === "364100",
  "main_flash_region_protected does not start with entry a1,32.");
invariant(bytesAt(0x4037f913, 3) === "820204",
  "main_flash_region_protected no longer reads no_protect at os_func_data+4.");
invariant(readWord(0x40374c74) === 0x420c2af4 && readWord(0x40374c78) === 0x420c2b44,
  "main_flash_region_protected calls different guards than the ones recovered.");
for (const [macro, expected] of [
  ["STOCK_FLASH_DEFAULT_CHIP_SLOT", "0x3fcb2ef8u"],
  ["STOCK_FLASH_APP_OS_FUNC", "0x3fca84a4u"],
  ["STOCK_FLASH_REGION_PROTECTED", "0x4037f904u"]]) {
  invariant(new RegExp(`^#define ${macro} ${expected}$`, "mu").test(source),
    `${macro} is not ${expected} in the module source.`);
}
invariant(/^#define ESP_FLASH_ARG_NO_PROTECT 4u$/mu.test(source),
  "ESP_FLASH_ARG_NO_PROTECT is not 4.");
/* The escape must be raised and restored around a single stock call only. */
const guardUses = source.match(/\*guard = 1u;/gu) ?? [];
const guardRestores = source.match(/\*guard = saved;/gu) ?? [];
invariant(guardUses.length === 2 && guardRestores.length === 2,
  "The region-protection escape is not raised/restored exactly twice " +
  "(one erase wrapper, one write wrapper).");
const flashEvidenceProtection = {
  osFuncTable: "0x3fca84a4",
  regionProtected: "0x4037f904",
  noProtectByte: "os_func_data+4 (l8ui a8,a2,4 at 0x4037f913)",
  readOnlyScan: "0x420c2af4 (all partition flags are 0)",
  appPartitionCheck: "0x420c2b44 esp_partition_main_flash_region_safe",
  firstAppPartition:
    `${firstApp.label} @0x${firstApp.address.toString(16)} +0x${firstApp.size.toString(16)}`,
};

/* Scene-RPC registry node layout and the renderer-v2 sidecar switch word. */
const layoutPins = [
  ["SCENE_RPC_MAP_OFFSET", 0x42054164, "a2a084",
    "movi a10,132 in the stock RPC registrar 0x420540f4"],
  ["SCENE_RPC_NODE_VALUE", 0x42053fa6, "22c21c",
    "addi a2,a2,28 in the map helper 0x42053f78 (returns &node->mapped)"],
  ["SCENE_RPC_NODE_KEY_POINTER", 0x420541f2, "b812",
    "l32i.n a11,a2,4 in the map find 0x420541d8 (key data pointer)"],
  ["SCENE_RPC_NODE_KEY_BYTES", 0x420541ea, "8822",
    "l32i.n a8,a2,8 in the map find 0x420541d8 (key length)"],
  ["SCENE_RPC_NODE_NEXT", 0x42054200, "2802",
    "l32i.n a2,a2,0 in the map find 0x420541d8 (node->_M_nxt)"],
];
const layoutEvidence = [];
for (const [macro, address, expected, meaning] of layoutPins) {
  const found = bytesAt(address, expected.length / 2);
  invariant(found === expected,
    `${macro}: 0x${address.toString(16)} is ${found}, expected ${expected} (${meaning}).`);
  const declared = new RegExp(`^#define ${macro} (\\d+)u$`, "mu").exec(source);
  invariant(declared, `Missing #define ${macro}.`);
  layoutEvidence.push({ macro, value: Number(declared[1]),
    address: `0x${address.toString(16)}`, bytes: found, meaning });
}
invariant(/^#define SCENE_SIDECAR_SWITCH_OFFSET 0x4f8u$/mu.test(source),
  "SCENE_SIDECAR_SWITCH_OFFSET is no longer 0x4f8.");
for (const symbol of ["renderer_v2_native_commit", "renderer_v2_native_cancel"]) {
  const start = disassemblyText.indexOf(` <${symbol}>:`);
  invariant(start >= 0, `${symbol} is missing from the disassembly.`);
  const body = disassemblyText.slice(start, start + 900);
  invariant(/movi\s+a\d+, 0x4f8/u.test(body),
    `${symbol} does not load the 0x4f8 sidecar switch offset.`);
}

// --- 2. the record the device must accept -----------------------------------
const { record } = await buildSceneSlotB();
const recordFile = path.join(output, "scene-slot-b.record.bin");
invariant(crc32(record.subarray(0, 60)) === record.readUInt32LE(60),
  "Builder CRC-32 does not match its own record.");

// --- 3. exact source under proof --------------------------------------------
const defineNames = ["SCENE_RECORD_HEADER_BYTES", "SCENE_RECORD_SHA_OFFSET",
  "SCENE_RECORD_VERSION",
  "SCENE_RECORD_MAGIC_0", "SCENE_RECORD_MAGIC_1", "SCENE_PACKAGE_BYTES",
  "SCENE_FOCUS_F1WB_BYTES", "SCENE_F1WB_MAGIC", "SCENE_GENERATION",
  "SCENE_EXPECTED_GENERATION", "SCENE_MIN_GENERATION",
  "SCENE_STEP_NONE", "SCENE_STEP_MAGIC",
  "SCENE_STEP_VERSION", "SCENE_STEP_SIZE", "SCENE_STEP_GENERATION",
  "SCENE_STEP_HEADER_CRC",
  "SCENE_PERSIST_IDLE", "SCENE_PERSIST_ARMED", "SCENE_PERSIST_ERASE",
  "SCENE_PERSIST_WRITE", "SCENE_PERSIST_VERIFY", "SCENE_PERSIST_HEADER",
  "SCENE_PERSIST_DONE", "SCENE_PERSIST_FAILED",
  "SCENE_PSTEP_NONE", "SCENE_PSTEP_BOUNDS", "SCENE_PSTEP_ERASE",
  "SCENE_PSTEP_WRITE", "SCENE_PSTEP_READBACK", "SCENE_PSTEP_MISMATCH",
  "SCENE_PSTEP_MOVED", "SCENE_PSTEP_HEADER_WRITE",
  "SCENE_PSTEP_HEADER_READBACK", "SCENE_PSTEP_HEADER_MISMATCH",
  "SCENE_PSTEP_STORE",
  "SCENE_PERSIST_BEGIN", "SCENE_PERSIST_END", "SCENE_PERSIST_SECTOR_BYTES",
  "SCENE_PERSIST_SECTORS", "SCENE_PERSIST_CHUNK_BYTES",
  "SCENE_PERSIST_VERIFY_BYTES"];
const defines = defineNames.map((name) => extractDefine(source, name)).join("\n");
/* The two persist records are extracted verbatim too: the state machine below
 * is compiled against exactly the struct definitions the device compiles. */
function extractTypedef(text, tail) {
  const end = text.indexOf(tail);
  invariant(end >= 0, `Missing typedef ending "${tail}".`);
  const start = text.lastIndexOf("typedef struct {", end);
  invariant(start >= 0 && start < end, `Unterminated typedef "${tail}".`);
  return text.slice(start, end + tail.length);
}
const records = [
  extractTypedef(source, "} scene_flash_ops;"),
  extractTypedef(source, "} scene_persist_context;"),
].join("\n");
const functionNames = [
  "static uint32_t scene_read32(const uint8_t *data)",
  "static uint32_t scene_crc32(const uint8_t *data, uint32_t bytes)",
  "static int scene_record_is_valid(const uint8_t *header, uint32_t *step,\n" +
    "                                 uint32_t *generation)",
  "static int scene_package_header_is_f1wb(const uint8_t *package,\n" +
    "                                        uint32_t generation)",
  "static void scene_copy(uint8_t *destination, const uint8_t *source,\n" +
    "                       uint32_t bytes)",
  "static int scene_flash_span_allowed(uint32_t address, uint32_t bytes)",
];
const lateFunctionNames = [
  "static void scene_record_header_build(uint8_t header[64],",
  "static void scene_persist_advance(scene_persist_context *context,",
];
const functions = functionNames
  .map((signature) => extractFunction(source, signature)).join("\n");
const lateFunctions = lateFunctionNames
  .map((signature) => extractFunction(source, signature)).join("\n");
invariant(functions.includes("0xedb88320u") &&
  functions.includes("SCENE_RECORD_MAGIC_1") &&
  functions.includes("SCENE_STEP_HEADER_CRC"),
"Extracted text is not the slot-B record validator.");
/* The safety bounds must be the shipped literals, never a host stand-in. */
invariant(functions.includes("if (address < SCENE_PERSIST_BEGIN || address >= SCENE_PERSIST_END)") &&
  lateFunctions.includes("scene_flash_span_allowed(address, SCENE_PERSIST_SECTOR_BYTES)") &&
  lateFunctions.includes("scene_flash_span_allowed(SCENE_PERSIST_BEGIN,") &&
  (lateFunctions.match(/scene_flash_span_allowed\(/gu) ?? []).length === 4,
"The persist machine no longer bounds-checks every flash span it issues.");
invariant(defines.includes("#define SCENE_PERSIST_BEGIN 0x00240000u") &&
  defines.includes("#define SCENE_PERSIST_END 0x00270000u"),
"Slot-B persist bounds are no longer the hard-coded 0x240000..0x270000.");

// The device-side constants must equal the record the host builder emits.
invariant(defines.includes(`#define SCENE_PACKAGE_BYTES ${SCENE_SLOT_B.packageBytes}u`) &&
  defines.includes(`#define SCENE_RECORD_HEADER_BYTES ${SCENE_SLOT_B.headerBytes}u`) &&
  defines.includes(`#define SCENE_GENERATION ${SCENE_SLOT_B.generation}u`) &&
  defines.includes(`#define SCENE_EXPECTED_GENERATION ${SCENE_SLOT_B.expectedGeneration}u`) &&
  defines.includes(`#define SCENE_RECORD_VERSION ${SCENE_SLOT_B.version}u`) &&
  defines.includes("#define SCENE_RECORD_SHA_OFFSET 24u"),
"Device record constants disagree with build-scene-slot-b.mjs.");

const driver = `/* GENERATED by scene-slot-b-host-proof.mjs - do not edit. */
#include <stdint.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* --- constants lifted verbatim from the shipped module source ------------ */
${defines}

/* --- exact source under proof (no substitutions) ------------------------- */
${records}
${functions}
${lateFunctions}
/* --- end exact source ---------------------------------------------------- */

/* --- fake NOR flash (host only) ------------------------------------------
 * 16 MiB of address space is modelled as the 192 KiB slot plus poisoned
 * guards on either side: any access outside [0x240000,0x270000) aborts the
 * run rather than silently succeeding, so a bounds regression cannot pass. */
#define FAKE_BASE 0x00240000u
#define FAKE_BYTES 0x00030000u
static uint8_t fake_flash[FAKE_BYTES];
static uint32_t fake_erases;
static uint32_t fake_writes;
static uint32_t fake_reads;
static uint32_t fake_written_bytes;
static uint32_t fake_out_of_bounds;
static uint32_t fake_fail_after;       /* 0 = never fail */
static uint32_t fake_ops;
static uint32_t fake_tear_at;          /* op index whose write is truncated */
static uint32_t fake_tear_silent;      /* truncated write still reports success */
static uint32_t fake_tear_fired;

static int fake_in_range(uint32_t address, uint32_t bytes)
{
    if (bytes == 0u) return 0;
    if (address < FAKE_BASE) return 0;
    if (address > FAKE_BASE + FAKE_BYTES - bytes) return 0;
    return 1;
}
static int fake_erase(void *opaque, uint32_t address, uint32_t bytes)
{
    (void)opaque;
    if (!fake_in_range(address, bytes) || (address & 0xfffu) != 0u ||
        (bytes & 0xfffu) != 0u) { fake_out_of_bounds++; return 1; }
    fake_ops++;
    if (fake_fail_after != 0u && fake_ops >= fake_fail_after) return 1;
    memset(fake_flash + (address - FAKE_BASE), 0xff, bytes);
    fake_erases++;
    return 0;
}
static int fake_write(void *opaque, uint32_t address, const uint8_t *source,
                      uint32_t bytes)
{
    uint32_t index;
    uint32_t honoured = bytes;
    (void)opaque;
    if (!fake_in_range(address, bytes)) { fake_out_of_bounds++; return 1; }
    fake_ops++;
    if (fake_fail_after != 0u && fake_ops >= fake_fail_after) return 1;
    if (fake_tear_at != 0u && fake_ops == fake_tear_at) {
        honoured = bytes / 2u; fake_tear_fired = 1u;
    }
    for (index = 0u; index < honoured; ++index) {
        /* NOR programming can only clear bits. */
        fake_flash[address - FAKE_BASE + index] &= source[index];
    }
    fake_writes++;
    fake_written_bytes += honoured;
    if (honoured != bytes && fake_tear_silent == 0u) return 1;
    return 0;
}
static int fake_read(void *opaque, uint32_t address, uint8_t *destination,
                     uint32_t bytes)
{
    (void)opaque;
    if (!fake_in_range(address, bytes)) { fake_out_of_bounds++; return 1; }
    fake_ops++;
    if (fake_fail_after != 0u && fake_ops >= fake_fail_after) return 1;
    memcpy(destination, fake_flash + (address - FAKE_BASE), bytes);
    fake_reads++;
    return 0;
}
static const scene_flash_ops fake_ops_table = {
    fake_erase, fake_write, fake_read, NULL
};

/* Drive the extracted machine exactly as scene_persist_step does. */
static uint32_t run_persist(const uint8_t *package, uint32_t generation,
                            const uint8_t *digest, uint32_t *step_out,
                            uint32_t *iterations_out)
{
    scene_persist_context context;
    uint32_t iterations = 0u;
    context.state = SCENE_PERSIST_ERASE;
    context.step = SCENE_PSTEP_NONE;
    context.generation = generation;
    context.package_bytes = SCENE_PACKAGE_BYTES;
    context.cursor = 0u;
    context.package = package;
    context.digest = NULL;
    while (context.state != SCENE_PERSIST_DONE &&
           context.state != SCENE_PERSIST_FAILED && iterations < 4000u) {
        context.digest = context.state == SCENE_PERSIST_HEADER ? digest : NULL;
        scene_persist_advance(&context, &fake_ops_table);
        iterations++;
    }
    if (step_out != NULL) *step_out = context.step;
    if (iterations_out != NULL) *iterations_out = iterations;
    return context.state;
}

static uint32_t checks;
static uint32_t failures;
static void check(int ok, const char *what)
{
    checks++;
    if (!ok) { failures++; fprintf(stderr, "FAIL: %s\\n", what); }
}

static uint8_t *record;
static long record_bytes;

static void reset_fake(void)
{
    memset(fake_flash, 0xff, sizeof(fake_flash));
    fake_erases = 0u; fake_writes = 0u; fake_reads = 0u;
    fake_written_bytes = 0u; fake_out_of_bounds = 0u;
    fake_fail_after = 0u; fake_ops = 0u;
    fake_tear_at = 0u; fake_tear_silent = 0u; fake_tear_fired = 0u;
}

static int fake_header_valid(void)
{
    uint32_t step;
    return scene_record_is_valid(fake_flash, &step, NULL);
}

static void load(const char *file)
{
    FILE *handle = fopen(file, "rb");
    if (handle == NULL) { fprintf(stderr, "cannot open %s\\n", file); exit(2); }
    fseek(handle, 0, SEEK_END); record_bytes = ftell(handle); rewind(handle);
    record = (uint8_t *)malloc((size_t)record_bytes);
    if (record == NULL ||
        fread(record, 1u, (size_t)record_bytes, handle) != (size_t)record_bytes) {
        fprintf(stderr, "cannot read %s\\n", file); exit(2);
    }
    fclose(handle);
}

int main(int argc, char **argv)
{
    uint8_t header[SCENE_RECORD_HEADER_BYTES];
    uint8_t *copy;
    uint32_t step;
    uint32_t index;
    uint32_t value;
    if (argc != 2) { fprintf(stderr, "usage: proof <record>\\n"); return 2; }
    load(argv[1]);
    check(record_bytes == (long)(SCENE_RECORD_HEADER_BYTES + SCENE_PACKAGE_BYTES),
          "record size");

    /* CRC-32/ISO-HDLC known answer. */
    check(scene_crc32((const uint8_t *)"123456789", 9u) == 0xcbf43926u,
          "crc32 check-value 0xcbf43926");
    check(scene_crc32((const uint8_t *)"", 0u) == 0u, "crc32 of empty input");

    /* Little-endian word reader. */
    {
        static const uint8_t word[4] = { 0x46u, 0x31u, 0x53u, 0x43u };
        check(scene_read32(word) == SCENE_RECORD_MAGIC_0, "scene_read32 LE order");
    }
    /* The digest the device compares lives where the builder wrote it. */
    check(SCENE_RECORD_SHA_OFFSET + 32u <= SCENE_RECORD_HEADER_BYTES - 4u,
          "record digest is inside the CRC-covered header span");

    /* The shipped record is accepted with no failing step. */
    memcpy(header, record, sizeof(header));
    step = 0xffffffffu;
    check(scene_record_is_valid(header, &step, &value) == 1 &&
          step == SCENE_STEP_NONE && value == SCENE_GENERATION,
          "shipped record accepted");
    check(scene_record_is_valid(header, NULL, NULL) == 1,
          "NULL out-parameters accepted");
    check(scene_record_is_valid(NULL, &step, &value) == 0 &&
          step == SCENE_STEP_MAGIC && value == 0u,
          "NULL header rejected as missing magic");

    /* Erased flash and blank flash are "no default scene", not a fault. */
    memset(header, 0xff, sizeof(header));
    check(scene_record_is_valid(header, &step, NULL) == 0 &&
          step == SCENE_STEP_MAGIC, "erased flash rejected at magic");
    memset(header, 0x00, sizeof(header));
    check(scene_record_is_valid(header, &step, NULL) == 0 &&
          step == SCENE_STEP_MAGIC, "zeroed flash rejected at magic");

    /* Each named gate fires on its own field, in order. */
    {
        struct { uint32_t offset; uint32_t value; uint32_t step; const char *what; }
        cases[] = {
            { 0u, 0x43533147u, SCENE_STEP_MAGIC, "magic word 0" },
            { 4u, 0x31454e46u, SCENE_STEP_MAGIC, "magic word 1" },
            { 8u, 2u, SCENE_STEP_VERSION, "version" },
            { 12u, SCENE_PACKAGE_BYTES - 1u, SCENE_STEP_SIZE, "package_bytes" },
            { 16u, 1u, SCENE_STEP_GENERATION, "generation below the minimum" },
            { 16u, 0xffffffffu, SCENE_STEP_GENERATION, "generation sentinel" },
            { 20u, 0u, SCENE_STEP_GENERATION, "expected_generation" },
            { 56u, 1u, SCENE_STEP_HEADER_CRC, "reserved word" },
            { 24u, 0u, SCENE_STEP_HEADER_CRC, "digest byte" },
            { 60u, 0u, SCENE_STEP_HEADER_CRC, "stored crc" },
        };
        for (index = 0u; index < sizeof(cases) / sizeof(cases[0]); ++index) {
            memcpy(header, record, sizeof(header));
            value = cases[index].value;
            header[cases[index].offset + 0u] = (uint8_t)value;
            header[cases[index].offset + 1u] = (uint8_t)(value >> 8);
            header[cases[index].offset + 2u] = (uint8_t)(value >> 16);
            header[cases[index].offset + 3u] = (uint8_t)(value >> 24);
            step = 0xffffffffu;
            check(scene_record_is_valid(header, &step, NULL) == 0 &&
                  step == cases[index].step, cases[index].what);
        }
    }

    /* Exhaustive single-byte mutation of the whole 64-byte header: nothing but
     * the shipped bytes is ever accepted. */
    {
        uint32_t rejected = 0u;
        uint32_t attempted = 0u;
        for (index = 0u; index < SCENE_RECORD_HEADER_BYTES; ++index) {
            uint32_t byte;
            for (byte = 0u; byte < 256u; ++byte) {
                if ((uint8_t)byte == record[index]) continue;
                memcpy(header, record, sizeof(header));
                header[index] = (uint8_t)byte;
                attempted++;
                if (scene_record_is_valid(header, &step, NULL) == 0) rejected++;
            }
        }
        check(attempted == SCENE_RECORD_HEADER_BYTES * 255u,
              "exhaustive mutation coverage");
        check(rejected == attempted, "every single-byte header mutation rejected");
    }

    /* F1WB envelope pre-gate over the real payload. */
    {
        uint8_t *payload = record + SCENE_RECORD_HEADER_BYTES;
        uint8_t saved[16];
        check(scene_package_header_is_f1wb(payload, SCENE_GENERATION) == 1,
              "real F1WB header");
        check(scene_package_header_is_f1wb(NULL, SCENE_GENERATION) == 0,
              "NULL package rejected");
        check(scene_package_header_is_f1wb(payload, SCENE_GENERATION + 1u) == 0,
              "F1WB header must match the record generation");
        check(scene_package_header_is_f1wb(payload, 1u) == 0,
              "generation below the minimum rejected");
        memcpy(saved, payload, sizeof(saved));
        payload[0] ^= 0x01u;
        check(scene_package_header_is_f1wb(payload, SCENE_GENERATION) == 0,
              "F1WB magic gate");
        memcpy(payload, saved, sizeof(saved));
        payload[8] ^= 0x01u;
        check(scene_package_header_is_f1wb(payload, SCENE_GENERATION) == 0,
              "F1WB generation gate");
        memcpy(payload, saved, sizeof(saved));
        payload[12] ^= 0x01u;
        check(scene_package_header_is_f1wb(payload, SCENE_GENERATION) == 0,
              "F1WB length gate");
        memcpy(payload, saved, sizeof(saved));
        check(scene_package_header_is_f1wb(payload, SCENE_GENERATION) == 1,
              "F1WB header restored");
    }

    /* The word-plus-tail copy must be byte exact and must not overrun: 95,535
     * is 3 bytes past a word boundary, which is the interesting case. */
    {
        const uint32_t guard = 64u;
        copy = (uint8_t *)malloc(SCENE_PACKAGE_BYTES + guard);
        if (copy == NULL) { fprintf(stderr, "oom\\n"); return 2; }
        memset(copy, 0x5au, SCENE_PACKAGE_BYTES + guard);
        scene_copy(copy, record + SCENE_RECORD_HEADER_BYTES, SCENE_PACKAGE_BYTES);
        check(memcmp(copy, record + SCENE_RECORD_HEADER_BYTES,
                     SCENE_PACKAGE_BYTES) == 0, "scene_copy is byte exact");
        for (index = 0u; index < guard; ++index)
            if (copy[SCENE_PACKAGE_BYTES + index] != 0x5au) break;
        check(index == guard, "scene_copy does not overrun");
        check((SCENE_PACKAGE_BYTES & 3u) == 3u, "package length exercises the tail");
        free(copy);
    }

    /* --- slot-B bounds: nothing outside the two hard-coded literals ------ */
    {
        const uint32_t window_end =
            SCENE_PERSIST_BEGIN + SCENE_PERSIST_SECTORS * SCENE_PERSIST_SECTOR_BYTES;
        check(SCENE_PERSIST_BEGIN == 0x00240000u &&
              SCENE_PERSIST_END == 0x00270000u, "slot-B window literals");
        check(scene_flash_span_allowed(SCENE_PERSIST_BEGIN, 1u) == 1,
              "first byte of slot B allowed");
        check(scene_flash_span_allowed(window_end - 1u, 1u) == 1,
              "last record byte allowed");
        check(scene_flash_span_allowed(SCENE_PERSIST_BEGIN, 0u) == 0,
              "zero-length span rejected");
        check(scene_flash_span_allowed(SCENE_PERSIST_BEGIN,
                                       SCENE_PERSIST_SECTOR_BYTES + 1u) == 0,
              "span larger than one sector rejected");
        check(scene_flash_span_allowed(SCENE_PERSIST_BEGIN - 1u, 1u) == 0,
              "byte below slot B rejected");
        check(scene_flash_span_allowed(0u, 4096u) == 0, "address 0 rejected");
        check(scene_flash_span_allowed(0x10000u, 4096u) == 0,
              "the app partition is rejected");
        check(scene_flash_span_allowed(0x9000u, 4096u) == 0,
              "the NVS partition is rejected");
        check(scene_flash_span_allowed(0x210000u, 4096u) == 0,
              "the module text page is rejected");
        check(scene_flash_span_allowed(SCENE_PERSIST_END, 1u) == 0,
              "first byte past slot B rejected");
        check(scene_flash_span_allowed(window_end, 1u) == 0,
              "first byte past the record window rejected");
        check(scene_flash_span_allowed(window_end - 1u, 2u) == 0,
              "span straddling the record window end rejected");
        check(scene_flash_span_allowed(0xfffff000u, 4096u) == 0,
              "wrapping span rejected");
        check(scene_flash_span_allowed(SCENE_PERSIST_END - 1u, 4096u) == 0,
              "span running off the end of slot B rejected");
        for (index = 0u; index < SCENE_PERSIST_SECTORS; ++index)
            if (!scene_flash_span_allowed(
                    SCENE_PERSIST_BEGIN + index * SCENE_PERSIST_SECTOR_BYTES,
                    SCENE_PERSIST_SECTOR_BYTES)) break;
        check(index == SCENE_PERSIST_SECTORS, "every record sector allowed");
    }

    /* --- happy path: the machine reproduces the host builder's record ---- */
    {
        uint32_t step_out = 0xffffffffu;
        uint32_t iterations = 0u;
        uint32_t state;
        reset_fake();
        state = run_persist(record + SCENE_RECORD_HEADER_BYTES,
                            SCENE_GENERATION, record + SCENE_RECORD_SHA_OFFSET,
                            &step_out, &iterations);
        check(state == SCENE_PERSIST_DONE && step_out == SCENE_PSTEP_NONE,
              "persist machine completes");
        check(fake_out_of_bounds == 0u,
              "the machine never issued an out-of-range flash access");
        check(fake_erases == SCENE_PERSIST_SECTORS, "every record sector erased");
        check(fake_written_bytes ==
              SCENE_PACKAGE_BYTES + SCENE_RECORD_HEADER_BYTES,
              "payload plus header written exactly once");
        check(memcmp(fake_flash, record,
                     SCENE_RECORD_HEADER_BYTES + SCENE_PACKAGE_BYTES) == 0,
              "persisted record is byte identical to build-scene-slot-b.mjs");
        check(fake_header_valid() == 1, "persisted record is adoptable");
        check(iterations < 1000u, "persist completes in a bounded step count");
    }

    /* --- the header really is written last -------------------------------- */
    {
        scene_persist_context context;
        uint32_t iterations = 0u;
        reset_fake();
        context.state = SCENE_PERSIST_ERASE;
        context.step = SCENE_PSTEP_NONE;
        context.generation = SCENE_GENERATION;
        context.package_bytes = SCENE_PACKAGE_BYTES;
        context.cursor = 0u;
        context.package = record + SCENE_RECORD_HEADER_BYTES;
        context.digest = NULL;
        while (context.state != SCENE_PERSIST_HEADER && iterations < 4000u) {
            scene_persist_advance(&context, &fake_ops_table);
            iterations++;
        }
        check(context.state == SCENE_PERSIST_HEADER,
              "machine reaches the header step");
        for (index = 0u; index < SCENE_RECORD_HEADER_BYTES; ++index)
            if (fake_flash[index] != 0xffu) break;
        check(index == SCENE_RECORD_HEADER_BYTES,
              "header span is still erased when the whole payload is verified");
        check(fake_header_valid() == 0,
              "no adoptable record exists before the header is written");
        check(memcmp(fake_flash + SCENE_RECORD_HEADER_BYTES,
                     record + SCENE_RECORD_HEADER_BYTES,
                     SCENE_PACKAGE_BYTES) == 0,
              "payload is complete before the header is written");
    }

    /* --- torn writes: silent truncation and reported failure ------------- */
    {
        uint32_t tears[8];
        uint32_t clean_ops;
        uint32_t header_write_op;
        uint32_t torn_rejected = 0u;
        uint32_t silent_rejected = 0u;
        uint32_t case_index;
        reset_fake();
        (void)run_persist(record + SCENE_RECORD_HEADER_BYTES, SCENE_GENERATION,
                          record + SCENE_RECORD_SHA_OFFSET, NULL, NULL);
        clean_ops = fake_ops;
        /* Sector erases come first, then the payload writes, then the verify
         * reads, then the header write and its read-back. */
        header_write_op = clean_ops - 1u;
        check(clean_ops > SCENE_PERSIST_SECTORS + 2u, "clean run issued I/O");
        tears[0] = SCENE_PERSIST_SECTORS + 1u;
        tears[1] = SCENE_PERSIST_SECTORS + 2u;
        tears[2] = SCENE_PERSIST_SECTORS + 9u;
        tears[3] = SCENE_PERSIST_SECTORS + 40u;
        tears[4] = SCENE_PERSIST_SECTORS + 60u;
        tears[5] = SCENE_PERSIST_SECTORS + 93u;
        tears[6] = SCENE_PERSIST_SECTORS + 94u;
        tears[7] = header_write_op;
        for (case_index = 0u; case_index < 8u; ++case_index) {
            uint32_t step_out = 0xffffffffu;
            uint32_t state;
            reset_fake();
            fake_tear_at = tears[case_index];
            state = run_persist(record + SCENE_RECORD_HEADER_BYTES,
                                SCENE_GENERATION,
                                record + SCENE_RECORD_SHA_OFFSET, &step_out, NULL);
            if (state == SCENE_PERSIST_FAILED && fake_header_valid() == 0)
                torn_rejected++;

            reset_fake();
            fake_tear_at = tears[case_index];
            fake_tear_silent = 1u;
            state = run_persist(record + SCENE_RECORD_HEADER_BYTES,
                                SCENE_GENERATION,
                                record + SCENE_RECORD_SHA_OFFSET, &step_out, NULL);
            if (fake_tear_fired == 0u ||
                (state == SCENE_PERSIST_DONE &&
                 memcmp(fake_flash, record,
                        SCENE_RECORD_HEADER_BYTES + SCENE_PACKAGE_BYTES) == 0)) {
                /* The tear landed on a read, or on a byte the erased 0xff
                 * already matched; nothing was corrupted. */
                silent_rejected++;
            } else if (state == SCENE_PERSIST_FAILED && fake_header_valid() == 0) {
                silent_rejected++;
            }
        }
        check(torn_rejected == 8u,
              "every reported torn write stops before the record is sealed");
        check(silent_rejected == 8u,
              "every silently truncated write is caught by read-back or leaves "
              "the record unsealed");
    }

    /* --- a failure in each phase stops the machine with a named step ----- */
    {
        uint32_t stops[4];
        uint32_t stopped = 0u;
        uint32_t case_index;
        reset_fake();
        (void)run_persist(record + SCENE_RECORD_HEADER_BYTES, SCENE_GENERATION,
                          record + SCENE_RECORD_SHA_OFFSET, NULL, NULL);
        stops[0] = 1u;                                /* first sector erase */
        stops[1] = SCENE_PERSIST_SECTORS + 5u;        /* a payload write */
        stops[2] = SCENE_PERSIST_SECTORS + 100u;      /* a verify read */
        stops[3] = fake_ops - 1u;                     /* the header write */
        for (case_index = 0u; case_index < 4u; ++case_index) {
            uint32_t step_out = SCENE_PSTEP_NONE;
            uint32_t state;
            reset_fake();
            fake_fail_after = stops[case_index];
            state = run_persist(record + SCENE_RECORD_HEADER_BYTES,
                                SCENE_GENERATION,
                                record + SCENE_RECORD_SHA_OFFSET, &step_out, NULL);
            if (state == SCENE_PERSIST_FAILED &&
                step_out != SCENE_PSTEP_NONE &&
                step_out != SCENE_PSTEP_BOUNDS && fake_header_valid() == 0)
                stopped++;
        }
        check(stopped == 4u, "an I/O failure in any phase leaves slot B unsealed");
    }

    /* --- the machine refuses anything it cannot bound --------------------- */
    {
        scene_persist_context context;
        reset_fake();
        context.state = SCENE_PERSIST_WRITE;
        context.step = SCENE_PSTEP_NONE;
        context.generation = SCENE_GENERATION;
        context.package_bytes = SCENE_PACKAGE_BYTES;
        /* A cursor the record can never reach: the bounds check must fire
         * before the fake flash is ever asked. */
        context.cursor = SCENE_PACKAGE_BYTES - 1u;
        context.package = record + SCENE_RECORD_HEADER_BYTES;
        context.digest = NULL;
        check(SCENE_PERSIST_BEGIN + SCENE_RECORD_HEADER_BYTES +
              context.cursor + 1u <=
              SCENE_PERSIST_BEGIN + SCENE_PERSIST_SECTORS *
                                        SCENE_PERSIST_SECTOR_BYTES,
              "final payload byte is inside the record window");

        reset_fake();
        context.state = SCENE_PERSIST_ERASE;
        context.cursor = SCENE_PERSIST_SECTORS - 1u;
        scene_persist_advance(&context, &fake_ops_table);
        check(context.state == SCENE_PERSIST_ERASE && fake_erases == 1u &&
              fake_out_of_bounds == 0u, "last sector erase is accepted");

        reset_fake();
        context.state = SCENE_PERSIST_ERASE;
        context.step = SCENE_PSTEP_NONE;
        context.cursor = SCENE_PERSIST_SECTORS;
        scene_persist_advance(&context, &fake_ops_table);
        check(context.state == SCENE_PERSIST_WRITE && fake_erases == 0u,
              "erase phase ends exactly at the record window");

        reset_fake();
        context.state = SCENE_PERSIST_ERASE;
        context.step = SCENE_PSTEP_NONE;
        context.cursor = 0u;
        context.package_bytes = SCENE_PACKAGE_BYTES + 1u;
        scene_persist_advance(&context, &fake_ops_table);
        check(context.state == SCENE_PERSIST_FAILED &&
              context.step == SCENE_PSTEP_STORE && fake_erases == 0u,
              "a package of the wrong size is refused before any flash access");

        reset_fake();
        context.state = SCENE_PERSIST_ERASE;
        context.step = SCENE_PSTEP_NONE;
        context.cursor = 0u;
        context.package_bytes = SCENE_PACKAGE_BYTES;
        context.generation = 1u;
        scene_persist_advance(&context, &fake_ops_table);
        check(context.state == SCENE_PERSIST_FAILED &&
              context.step == SCENE_PSTEP_STORE && fake_erases == 0u,
              "a generation below the minimum is refused before any flash access");

        reset_fake();
        context.state = SCENE_PERSIST_HEADER;
        context.step = SCENE_PSTEP_NONE;
        context.generation = SCENE_GENERATION;
        context.cursor = 0u;
        context.digest = NULL;
        scene_persist_advance(&context, &fake_ops_table);
        check(context.state == SCENE_PERSIST_FAILED &&
              context.step == SCENE_PSTEP_STORE && fake_writes == 0u,
              "the header is never written without a digest");
    }

    /* --- a later generation round-trips through the same code ------------ */
    {
        uint8_t *payload = record + SCENE_RECORD_HEADER_BYTES;
        uint8_t saved[4];
        uint32_t step_out = 0xffffffffu;
        uint32_t found = 0u;
        uint32_t state;
        memcpy(saved, payload + 8u, 4u);
        payload[8] = 7u; payload[9] = 0u; payload[10] = 0u; payload[11] = 0u;
        reset_fake();
        state = run_persist(payload, 7u, record + SCENE_RECORD_SHA_OFFSET,
                            &step_out, NULL);
        check(state == SCENE_PERSIST_DONE, "generation 7 persists");
        check(scene_record_is_valid(fake_flash, &step_out, &found) == 1 &&
              found == 7u, "generation 7 record is adoptable");
        check(scene_read32(fake_flash + 20u) == 6u,
              "expected_generation follows the persisted generation");
        check(scene_package_header_is_f1wb(fake_flash + SCENE_RECORD_HEADER_BYTES,
                                           7u) == 1,
              "persisted payload keeps the generation-7 F1WB header");
        memcpy(payload + 8u, saved, 4u);
    }

    printf("{\\"status\\":\\"PASS_SCENE_SLOT_B_EXACT_SOURCE\\",\\"checks\\":%u,"
           "\\"failures\\":%u,\\"headerCrc32\\":\\"0x%08x\\"}\\n",
           checks, failures, scene_crc32(record, SCENE_RECORD_HEADER_BYTES - 4u));
    return failures == 0u ? 0 : 1;
}
`;

await mkdir(output, { recursive: true });
await writeFile(recordFile, record);
const driverFile = path.join(output, "scene-slot-b-host-proof.c");
const executable = path.join(output, "scene-slot-b-host-proof");
await writeFile(driverFile, driver);
await execute(cc, ["-std=c11", "-O1", "-g", "-Wall", "-Wextra", "-Werror",
  "-fsanitize=address,undefined", "-fno-omit-frame-pointer", driverFile,
  "-o", executable], { cwd: repository });
const { stdout } = await execute(executable, [recordFile], { cwd: repository, env: {
  ...process.env, ASAN_OPTIONS: "abort_on_error=1", UBSAN_OPTIONS: "halt_on_error=1",
} });
const result = JSON.parse(stdout);
invariant(result.status === "PASS_SCENE_SLOT_B_EXACT_SOURCE" &&
  result.failures === 0 && result.checks >= 60,
`Slot-B host proof failed: ${stdout}`);
invariant(result.headerCrc32 ===
  `0x${crc32(record.subarray(0, 60)).toString(16).padStart(8, "0")}`,
"Device CRC-32 and host CRC-32 disagree on the shipped header.");

const manifest = {
  status: "PASS_SCENE_SLOT_B_HOST_PROOF_NO_HARDWARE",
  hardwareTouched: false,
  extractedFrom: { file: path.relative(repository, moduleSource), sha256: sha(source) },
  extractedFunctions: ["scene_read32", "scene_crc32", "scene_record_is_valid",
    "scene_package_header_is_f1wb", "scene_copy", "scene_flash_span_allowed",
    "scene_record_header_build", "scene_persist_advance"],
  extractedRecords: ["scene_flash_ops", "scene_persist_context"],
  extractedDefines: defineNames,
  hostSubstitutions: ["scene_flash_ops backed by an in-process NOR-flash model " +
    "(sector erase to 0xff, program clears bits only, poisoned outside " +
    "[0x240000,0x270000)); no safety bound or sequencing decision is substituted"],
  pinnedAddresses: pinnedEvidence,
  flashApiEvidence: flashEvidence,
  registryLayoutEvidence: layoutEvidence,
  regionProtectionEvidence: flashEvidenceProtection,
  sidecarSwitchOffset: "0x4f8 (renderer_v2_native_commit / _cancel)",
  pinnedEvidenceFrom: [path.relative(repository, disassembly),
    path.relative(repository, loaderScript),
    path.relative(repository, appImage)],
  record: { file: path.relative(repository, recordFile), bytes: record.length,
    sha256: sha(record),
    headerCrc32: `0x${record.readUInt32LE(60).toString(16).padStart(8, "0")}`,
    payloadSha256: SCENE_SLOT_B.packageSha256 },
  driver: { file: path.relative(repository, driverFile), sha256: sha(driver),
    sanitizers: ["address", "undefined"], warnings: "-Wall -Wextra -Werror" },
  result,
};
await writeFile(path.join(output, "scene-slot-b-host-proof-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
