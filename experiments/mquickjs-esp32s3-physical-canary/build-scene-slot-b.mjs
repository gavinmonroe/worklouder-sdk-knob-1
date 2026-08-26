#!/usr/bin/env node
/* Build the flash slot-B default-scene record consumed by
 * boot_adopt_default_scene() in psram-module-src/physical_integration.c.
 *
 * Layout written to build-diag-module-psram/scene-slot-b.bin, flashed at
 * paddr 0x240000 (slot B, [0x240000,0x270000), unused by every other
 * workstream).  The file is NOT padded to the 192 KiB slot: erased flash after
 * the record is exactly what the device expects to find.
 *
 *   +0   magic                "F1SCENE1"   8 bytes, ASCII, no NUL
 *   +8   version              u32 = 1
 *   +12  package_bytes        u32 = 95535
 *   +16  generation           u32 = 2      must equal the F1WB word at +8
 *   +20  expected_generation  u32 = 1      the chain's committed_generation seed
 *   +24  payload_sha256       32 bytes, big-endian digest bytes
 *   +56  reserved             u32 = 0
 *   +60  header_crc32         u32, CRC-32/ISO-HDLC over header bytes [0,60)
 *   +64  payload              95,535 bytes, focus-clock-timer generation-2
 *
 * The payload is produced by the SAME builder the live host push uses
 * (f1-widget-sdk/examples/render-v2-focus-timer/focus-timer-package.mjs), from
 * the same four sub-blobs, and its digest is asserted against the frozen
 * generation-two package SHA-256 before anything is written.
 *
 * No hardware, serial, or flashing is performed.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildFocusTimerPackage, FOCUS_TIMER_PACKAGE }
  from "../../f1-widget-sdk/examples/render-v2-focus-timer/focus-timer-package.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(here, "../..");
const focusBuild = path.join(repository,
  "f1-widget-sdk/examples/render-v2-focus-dial/build");
const timerBuild = path.join(repository,
  "f1-widget-sdk/examples/render-v2-focus-timer/build");
const combined = path.join(repository,
  "f1-widget-sdk/build/combined-renderer-v2-clock-blue-timer");
const output = path.join(here, "build-diag-module-psram");
const outputFile = path.join(output, "scene-slot-b.bin");

const invariant = (ok, message) => { if (!ok) throw new Error(message); };
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

export const SCENE_SLOT_B = Object.freeze({
  magic: "F1SCENE1",
  version: 1,
  headerBytes: 64,
  paddr: 0x240000,
  slotBytes: 0x30000,
  packageBytes: FOCUS_TIMER_PACKAGE.packageBytes,
  generation: FOCUS_TIMER_PACKAGE.generation,
  expectedGeneration: FOCUS_TIMER_PACKAGE.expectedGeneration,
  packageSha256: FOCUS_TIMER_PACKAGE.generationTwoPackageSha256,
});

/* CRC-32/ISO-HDLC (reflected poly 0xedb88320, init/xorout 0xffffffff).  The
 * device recomputes this with a bitwise loop, so no table is shared. */
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function buildSceneSlotBRecord(packageBinary) {
  invariant(packageBinary.length === SCENE_SLOT_B.packageBytes,
    `Package is ${packageBinary.length} B, not ${SCENE_SLOT_B.packageBytes} B.`);
  const digest = createHash("sha256").update(packageBinary).digest();
  const header = Buffer.alloc(SCENE_SLOT_B.headerBytes, 0);
  header.write(SCENE_SLOT_B.magic, 0, 8, "ascii");
  header.writeUInt32LE(SCENE_SLOT_B.version, 8);
  header.writeUInt32LE(SCENE_SLOT_B.packageBytes, 12);
  header.writeUInt32LE(SCENE_SLOT_B.generation, 16);
  header.writeUInt32LE(SCENE_SLOT_B.expectedGeneration, 20);
  digest.copy(header, 24);
  header.writeUInt32LE(0, 56);
  header.writeUInt32LE(crc32(header.subarray(0, 60)), 60);
  /* The F1WB generation word the renderer pairs by value must agree with the
   * header the device trusts, or the adopt would fail only inside the frozen
   * envelope gate on the keyboard. */
  invariant(packageBinary.readUInt32LE(8) === SCENE_SLOT_B.generation,
    "Package F1WB generation word does not match the record generation.");
  invariant(packageBinary.readUInt32LE(12) === FOCUS_TIMER_PACKAGE.f1wbBytes,
    "Package F1WB length word is not the frozen 62,404 B focus bundle.");
  return Buffer.concat([header, packageBinary]);
}

export async function buildSceneSlotB({ read = readFile } = {}) {
  const [focusF1wb, focusF2ep, timerF2ep, timerBaseLzss] = await Promise.all([
    read(path.join(focusBuild, "render-v2-focus-dial.base.f1wb")),
    read(path.join(focusBuild, "render-v2-focus-dial.f2ep")),
    read(path.join(timerBuild, "render-v2-focus-timer.f2ep")),
    read(path.join(timerBuild, "render-v2-focus-timer.base.lzss")),
  ]);
  const packageValue = buildFocusTimerPackage({ focusF1wb, focusF2ep, timerF2ep,
    timerBaseLzss, generation: SCENE_SLOT_B.generation });
  invariant(packageValue.sha256 === SCENE_SLOT_B.packageSha256,
    `Rebuilt package SHA-256 ${packageValue.sha256} is not the frozen ` +
    `generation-two ${SCENE_SLOT_B.packageSha256}.`);
  /* Independent cross-check against the artifact the accepted renderer build
   * shipped, so a builder regression cannot silently redefine "frozen". */
  const shipped = await read(path.join(combined,
    "focus-clock-timer.generation-2.package.bin"));
  invariant(Buffer.from(shipped).equals(packageValue.binary),
    "Rebuilt package differs from focus-clock-timer.generation-2.package.bin.");
  const record = buildSceneSlotBRecord(packageValue.binary);
  invariant(record.length ===
    SCENE_SLOT_B.headerBytes + SCENE_SLOT_B.packageBytes,
  `Record is ${record.length} B, not ${SCENE_SLOT_B.headerBytes +
    SCENE_SLOT_B.packageBytes} B.`);
  invariant(record.length <= SCENE_SLOT_B.slotBytes,
    "Record does not fit slot B.");
  return { record, packageValue };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { record, packageValue } = await buildSceneSlotB();
  await mkdir(output, { recursive: true });
  await writeFile(outputFile, record);
  process.stdout.write(`${JSON.stringify({
    status: "PASS_SCENE_SLOT_B_BUILT_NO_HARDWARE",
    hardwareTouched: false,
    file: path.relative(repository, outputFile),
    bytes: record.length,
    sha256: sha(record),
    headerBytes: SCENE_SLOT_B.headerBytes,
    headerCrc32: `0x${record.readUInt32LE(60).toString(16).padStart(8, "0")}`,
    payload: {
      bytes: packageValue.binary.length,
      sha256: packageValue.sha256,
      generation: packageValue.generation,
      expectedGeneration: SCENE_SLOT_B.expectedGeneration,
    },
    flash: {
      paddr: "0x240000",
      slot: "[0x240000,0x270000)",
      padded: false,
      note: "write the record only; the rest of slot B stays erased (0xff)",
    },
  }, null, 2)}\n`);
}
