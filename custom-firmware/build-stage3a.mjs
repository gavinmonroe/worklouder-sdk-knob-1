#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { APP_FLASH_OFFSET, OFFICIAL_MERGED_SHA256, patchTimerLabel } from "./build-stage1.mjs";
import { extendEsp32AppSegment, inspectEsp32AppImage } from "./lib/esp-app-image.mjs";

export const FACTORY_PARTITION_BYTES = 0x800000;
export const IROM_SEGMENT_INDEX = 3;
export const CANARY_VIRTUAL_ADDRESS = 0x42116d14;
export const CANARY_DATA = Buffer.from("F1SEGMENTCANARY\0", "ascii");
export const EXPECTED_IROM_HEADER_OFFSET = 0xb0018;
export const EXPECTED_CANARY_DATA_OFFSET = 0x1c6d14;
export const EXPECTED_CANARY_CHECKSUM = 0x94;
export const EXPECTED_CANARY_DIGEST = "2b2be4605c5e7a4b21bd70d70983fbf7bbd4267bee313da4778d4a0c8b1b13fa";
export const EXPECTED_CANARY_APP_SHA256 = "088628179c760b919623288c6655449ee48734bc1a7bcadb885bd4a8d47dc24f";
export const EXPECTED_CANARY_MERGED_SHA256 = "74bb0bb5d7a3f0a7421198942bbadd88f53062bed7b96d0931ac9a438769b415";

const sha256 = (data) => createHash("sha256").update(data).digest("hex");

function assertCanaryLayout(before, after, app) {
  if (after.segmentCount !== before.segmentCount || after.segmentCount !== 6) {
    throw new Error("Stage-3A must retain the six-segment layout.");
  }
  for (let index = 0; index < before.segmentCount; index += 1) {
    const left = before.segments[index];
    const right = after.segments[index];
    if (right.loadAddress !== left.loadAddress) throw new Error(`Segment ${index} load address changed.`);
    if (index < IROM_SEGMENT_INDEX) {
      if (right.headerOffset !== left.headerOffset || right.dataOffset !== left.dataOffset ||
          right.length !== left.length || !right.data.equals(left.data)) {
        throw new Error(`Pre-IROM segment ${index} changed while extending IROM.`);
      }
    } else if (index === IROM_SEGMENT_INDEX) {
      if (right.headerOffset !== EXPECTED_IROM_HEADER_OFFSET ||
          right.headerOffset !== left.headerOffset || right.dataOffset !== left.dataOffset ||
          right.length !== left.length + CANARY_DATA.length ||
          !right.data.subarray(0, left.length).equals(left.data) ||
          !right.data.subarray(left.length).equals(CANARY_DATA)) {
        throw new Error("Existing IROM segment was not extended at its original end.");
      }
    } else if (right.headerOffset !== left.headerOffset + CANARY_DATA.length ||
               right.dataOffset !== left.dataOffset + CANARY_DATA.length ||
               right.length !== left.length || !right.data.equals(left.data)) {
      throw new Error(`Post-IROM segment ${index} was not shifted intact.`);
    }
  }

  const oldIrom = before.segments[IROM_SEGMENT_INDEX];
  const grownIrom = after.segments[IROM_SEGMENT_INDEX];
  const canaryDataOffset = grownIrom.dataOffset + oldIrom.length;
  const canaryVirtualAddress = grownIrom.loadAddress + oldIrom.length;
  if (canaryDataOffset !== EXPECTED_CANARY_DATA_OFFSET ||
      canaryVirtualAddress !== CANARY_VIRTUAL_ADDRESS) {
    throw new Error("Stage-3A canary layout differs from the reviewed offsets.");
  }
  if ((grownIrom.dataOffset & 0xffff) !== (grownIrom.loadAddress & 0xffff)) {
    throw new Error("Stage-3A IROM file/load offsets are not 64 KiB congruent.");
  }
  if (app.length > FACTORY_PARTITION_BYTES) throw new Error("Stage-3A exceeds the 8 MiB factory partition.");
}

export function applyStage3aCanary(officialMerged) {
  if (sha256(officialMerged) !== OFFICIAL_MERGED_SHA256) {
    throw new Error("Official Framer 0.4.1 merged-image hash mismatch.");
  }
  // Grow the exact Stage-1 Pomo image that was written, read back, and booted
  // on the live F1. This keeps the executable baseline constant across the
  // canary experiment; only the existing IROM segment gains unreachable bytes.
  const stage1App = patchTimerLabel(officialMerged.subarray(APP_FLASH_OFFSET), "Pomo");
  const before = inspectEsp32AppImage(stage1App);
  const app = extendEsp32AppSegment(stage1App, {
    segmentIndex: IROM_SEGMENT_INDEX,
    data: CANARY_DATA,
  });
  const after = inspectEsp32AppImage(app);
  assertCanaryLayout(before, after, app);
  const merged = Buffer.concat([officialMerged.subarray(0, APP_FLASH_OFFSET), app]);
  if (after.storedChecksum !== EXPECTED_CANARY_CHECKSUM ||
      after.storedDigest?.toString("hex") !== EXPECTED_CANARY_DIGEST ||
      sha256(app) !== EXPECTED_CANARY_APP_SHA256 ||
      sha256(merged) !== EXPECTED_CANARY_MERGED_SHA256) {
    throw new Error("Stage-3A integrity values differ from the independently reviewed image.");
  }

  return {
    app,
    merged,
    before,
    after,
  };
}

export async function buildStage3a({ root } = {}) {
  const projectRoot = root ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const sourcePath = path.join(projectRoot, "artifacts/firmware/firmware_0.4.1_merged.bin");
  const outputDirectory = path.join(projectRoot, "custom-firmware/build");
  const output = applyStage3aCanary(await readFile(sourcePath));
  const appName = "framer-0.4.1-stage3a-segment-canary-app.bin";
  const mergedName = "framer-0.4.1-stage3a-segment-canary-merged.bin";
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(path.join(outputDirectory, appName), output.app);
  await writeFile(path.join(outputDirectory, mergedName), output.merged);

  const oldIrom = output.before.segments[IROM_SEGMENT_INDEX];
  const grownIrom = output.after.segments[IROM_SEGMENT_INDEX];
  const manifest = {
    format: "framer-f1-stage3a-extended-irom-canary-v2",
    purpose: "Prove controlled ESP app-image growth before any custom code is referenced.",
    target: "Framer F1 / knob_f1",
    baseFirmware: "0.4.1 Stage-1 Pomo (live write/read-back/boot verified)",
    execution: "The existing single IROM segment is extended with bytes that deliberately have no code or data references.",
    layout: {
      factoryPartitionBytes: FACTORY_PARTITION_BYTES,
      originalSegments: output.before.segmentCount,
      grownSegments: output.after.segmentCount,
      iromHeaderAppOffset: grownIrom.headerOffset,
      iromDataAppOffset: grownIrom.dataOffset,
      originalIromBytes: oldIrom.length,
      grownIromBytes: grownIrom.length,
      canaryDataAppOffset: grownIrom.dataOffset + oldIrom.length,
      canaryVirtualAddress: `0x${(grownIrom.loadAddress + oldIrom.length).toString(16)}`,
      canaryBytes: CANARY_DATA.length,
      canaryHex: CANARY_DATA.toString("hex"),
      checksumAppOffset: output.after.checksumOffset,
      digestAppOffset: output.after.digestOffset,
      unusedFactoryBytes: FACTORY_PARTITION_BYTES - output.app.length,
    },
    outputs: {
      app: { file: appName, bytes: output.app.length, sha256: sha256(output.app) },
      merged: { file: mergedName, bytes: output.merged.length, sha256: sha256(output.merged) },
    },
    safety: [
      "The image retains exactly one DROM and one IROM mapping; no second cache-mapped segment is added.",
      "All original IROM bytes remain identical and the canary begins at the old IROM end.",
      "Later RAM/RTC segment data and load addresses remain identical while their file offsets shift by 16 bytes.",
      "No branch, literal, registry entry, or event handler references the canary.",
      "Only the factory app partition may be written; bootloader, NVS, and LittleFS remain untouched.",
    ],
  };
  await writeFile(path.join(outputDirectory, "stage3a-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  buildStage3a()
    .then((manifest) => console.log(JSON.stringify(manifest, null, 2)))
    .catch((error) => {
      console.error(`Error: ${error.message}`);
      process.exitCode = 1;
    });
}
