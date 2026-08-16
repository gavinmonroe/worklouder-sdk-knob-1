#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { APP_FLASH_OFFSET, OFFICIAL_MERGED_SHA256 } from "./build-stage1.mjs";
import {
  EXPECTED_CANARY_APP_SHA256,
  IROM_SEGMENT_INDEX,
  applyStage3aCanary,
} from "./build-stage3a.mjs";
import {
  extendEsp32AppSegment,
  inspectEsp32AppImage,
  repairEsp32AppIntegrity,
} from "./lib/esp-app-image.mjs";

export const STAGE3B_CODE = Buffer.from("3641002ca21df000", "hex");
export const STAGE3B_CODE_VIRTUAL_ADDRESS = 0x42116d24;
export const STAGE3B_CODE_APP_OFFSET = 0x1c6d24;
export const REMAINING_GETTER_LITERAL_VIRTUAL_ADDRESS = 0x42001f18;
export const REMAINING_GETTER_LITERAL_APP_OFFSET = 0xb1f18;
export const STOCK_REMAINING_GETTER = 0x421084f4;
export const VISIBLE_CANARY_SECONDS = 42;
export const REMAINING_GETTER_CONSUMERS = Object.freeze([
  Object.freeze({ virtualAddress: 0x42026699, expectedHex: "811f6ee00800", purpose: "progress ring" }),
  Object.freeze({ virtualAddress: 0x420266da, expectedHex: "810f6ee00800", purpose: "time formatter" }),
  Object.freeze({ virtualAddress: 0x420268a5, expectedHex: "819c6de00800", purpose: "screen-construction cache" }),
  Object.freeze({ virtualAddress: 0x42029f63, expectedHex: "81ed5fe00800", purpose: "runtime refresh" }),
]);

export const EXPECTED_STAGE3B_CHECKSUM = 0xb8;
export const EXPECTED_STAGE3B_DIGEST = "5355b69b8744ad9be2046e4ca2e50d2e34add3c998d1ba766058e2ce2e9cac59";
export const EXPECTED_STAGE3B_APP_SHA256 = "fe800d21d2527c36bea181e10e381982f9024ed50c3ce09e104b3ef299ead289";
export const EXPECTED_STAGE3B_MERGED_SHA256 = "ed172e48561a4cc2e65c889a10f3b5c65efd5d867cd8badf5e5c5d4689836c3d";

const sha256 = (data) => createHash("sha256").update(data).digest("hex");

function assertStage3bLayout(stage3a, stage3b) {
  if (stage3a.segmentCount !== 6 || stage3b.segmentCount !== 6) {
    throw new Error("Stage-3B must retain the reviewed six-segment layout.");
  }

  for (let index = 0; index < stage3a.segmentCount; index += 1) {
    const before = stage3a.segments[index];
    const after = stage3b.segments[index];
    if (before.loadAddress !== after.loadAddress) throw new Error(`Segment ${index} load address changed.`);
    if (index < IROM_SEGMENT_INDEX) {
      if (before.headerOffset !== after.headerOffset || before.dataOffset !== after.dataOffset ||
          before.length !== after.length || !before.data.equals(after.data)) {
        throw new Error(`Pre-IROM segment ${index} changed.`);
      }
    } else if (index === IROM_SEGMENT_INDEX) {
      const hookOffset = REMAINING_GETTER_LITERAL_APP_OFFSET - before.dataOffset;
      if (before.headerOffset !== after.headerOffset || before.dataOffset !== after.dataOffset ||
          after.length !== before.length + STAGE3B_CODE.length ||
          !after.data.subarray(0, hookOffset).equals(before.data.subarray(0, hookOffset)) ||
          !after.data.subarray(hookOffset + 4, before.length).equals(before.data.subarray(hookOffset + 4)) ||
          !after.data.subarray(before.length).equals(STAGE3B_CODE)) {
        throw new Error("Stage-3B code was not appended to the existing IROM segment.");
      }
    } else if (after.headerOffset !== before.headerOffset + STAGE3B_CODE.length ||
               after.dataOffset !== before.dataOffset + STAGE3B_CODE.length ||
               after.length !== before.length || !after.data.equals(before.data)) {
      throw new Error(`Post-IROM segment ${index} was not shifted intact.`);
    }
  }

  const irom = stage3b.segments[IROM_SEGMENT_INDEX];
  const codeOffset = irom.dataOffset + irom.length - STAGE3B_CODE.length;
  const codeAddress = irom.loadAddress + irom.length - STAGE3B_CODE.length;
  if (codeOffset !== STAGE3B_CODE_APP_OFFSET || codeAddress !== STAGE3B_CODE_VIRTUAL_ADDRESS) {
    throw new Error("Stage-3B code address differs from the independently reviewed target.");
  }
  if ((irom.dataOffset & 0xffff) !== (irom.loadAddress & 0xffff)) {
    throw new Error("Stage-3B IROM file/load offsets are not 64 KiB congruent.");
  }

  for (const consumer of REMAINING_GETTER_CONSUMERS) {
    const offset = consumer.virtualAddress - irom.loadAddress;
    if (offset < 0 || offset + 6 > irom.length ||
        irom.data.subarray(offset, offset + 6).toString("hex") !== consumer.expectedHex) {
      throw new Error(`Remaining-time ${consumer.purpose} consumer changed at 0x${consumer.virtualAddress.toString(16)}.`);
    }
  }
}

export function applyStage3bVisibleCanary(officialMerged) {
  if (sha256(officialMerged) !== OFFICIAL_MERGED_SHA256) {
    throw new Error("Official Framer 0.4.1 merged-image hash mismatch.");
  }

  const stage3aOutput = applyStage3aCanary(officialMerged);
  if (sha256(stage3aOutput.app) !== EXPECTED_CANARY_APP_SHA256) {
    throw new Error("Stage-3A base hash mismatch.");
  }
  const stage3a = stage3aOutput.after;
  let app = extendEsp32AppSegment(stage3aOutput.app, {
    segmentIndex: IROM_SEGMENT_INDEX,
    data: STAGE3B_CODE,
  });
  const oldGetter = app.readUInt32LE(REMAINING_GETTER_LITERAL_APP_OFFSET);
  if (oldGetter !== STOCK_REMAINING_GETTER) {
    throw new Error(`Remaining-time getter literal changed: 0x${oldGetter.toString(16)}.`);
  }
  app.writeUInt32LE(STAGE3B_CODE_VIRTUAL_ADDRESS, REMAINING_GETTER_LITERAL_APP_OFFSET);
  app = repairEsp32AppIntegrity(app);

  const stage3b = inspectEsp32AppImage(app);
  assertStage3bLayout(stage3a, stage3b);
  if (app.readUInt32LE(REMAINING_GETTER_LITERAL_APP_OFFSET) !== STAGE3B_CODE_VIRTUAL_ADDRESS) {
    throw new Error("Stage-3B remaining-time getter was not redirected.");
  }

  const merged = Buffer.concat([officialMerged.subarray(0, APP_FLASH_OFFSET), app]);
  if (stage3b.storedChecksum !== EXPECTED_STAGE3B_CHECKSUM ||
      stage3b.storedDigest?.toString("hex") !== EXPECTED_STAGE3B_DIGEST ||
      sha256(app) !== EXPECTED_STAGE3B_APP_SHA256 ||
      sha256(merged) !== EXPECTED_STAGE3B_MERGED_SHA256) {
    throw new Error("Stage-3B integrity values differ from the independently reviewed image.");
  }

  return { app, merged, stage3a, stage3b };
}

export async function buildStage3b({ root } = {}) {
  const projectRoot = root ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const sourcePath = path.join(projectRoot, "artifacts/firmware/firmware_0.4.1_merged.bin");
  const outputDirectory = path.join(projectRoot, "custom-firmware/build");
  const output = applyStage3bVisibleCanary(await readFile(sourcePath));
  const appName = "framer-0.4.1-stage3b-visible-canary-app.bin";
  const mergedName = "framer-0.4.1-stage3b-visible-canary-merged.bin";
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(path.join(outputDirectory, appName), output.app);
  await writeFile(path.join(outputDirectory, mergedName), output.merged);

  const irom = output.stage3b.segments[IROM_SEGMENT_INDEX];
  const manifest = {
    format: "framer-f1-stage3b-visible-executable-canary-v1",
    purpose: "Prove execution from the live-validated extended IROM by showing 00:42 on the stock Pomo/Timer screen.",
    target: "Framer F1 / knob_f1",
    baseFirmware: "0.4.1 Stage-3A (live write/read-back/boot verified)",
    behavior: {
      screen: "Pomo (stock Timer screen with the Stage-1 heading)",
      expectedDisplay: "00:42",
      instruction: "Open the screen but do not start the Timer during this proof.",
      controllerStateMutation: false,
      stockViewCache: "The existing screen-construction path caches the returned 42 at Timer view +40, exactly as it caches the stock getter result.",
    },
    hook: {
      literalVirtualAddress: `0x${REMAINING_GETTER_LITERAL_VIRTUAL_ADDRESS.toString(16)}`,
      literalAppOffset: REMAINING_GETTER_LITERAL_APP_OFFSET,
      originalGetter: `0x${STOCK_REMAINING_GETTER.toString(16)}`,
      replacementGetter: `0x${STAGE3B_CODE_VIRTUAL_ADDRESS.toString(16)}`,
      consumers: REMAINING_GETTER_CONSUMERS.map(({ virtualAddress, ...consumer }) => ({
        virtualAddress: `0x${virtualAddress.toString(16)}`,
        ...consumer,
      })),
    },
    code: {
      source: "custom-firmware/asm/stage3b-visible-canary.S",
      appOffset: STAGE3B_CODE_APP_OFFSET,
      virtualAddress: `0x${STAGE3B_CODE_VIRTUAL_ADDRESS.toString(16)}`,
      bytes: STAGE3B_CODE.length,
      hex: STAGE3B_CODE.toString("hex"),
      disassembly: ["entry a1, 32", "movi.n a2, 42", "retw.n", "one alignment byte"],
    },
    layout: {
      segments: output.stage3b.segmentCount,
      iromHeaderAppOffset: irom.headerOffset,
      iromDataAppOffset: irom.dataOffset,
      iromBytes: irom.length,
      checksumAppOffset: output.stage3b.checksumOffset,
      digestAppOffset: output.stage3b.digestOffset,
    },
    outputs: {
      app: { file: appName, bytes: output.app.length, sha256: sha256(output.app) },
      merged: { file: mergedName, bytes: output.merged.length, sha256: sha256(output.merged) },
    },
    rollback: {
      image: "framer-0.4.1-stage3a-segment-canary-app.bin",
      flashOffset: "0x10000",
      sha256: EXPECTED_CANARY_APP_SHA256,
    },
    safety: [
      "The image retains exactly one DROM and one IROM mapping.",
      "The appended function is assembled with Espressif's ESP-IDF 5.3.2 ESP32-S3 little-endian Xtensa toolchain and has no .text relocations.",
      "Only the read-only remaining-seconds getter pointer changes; timer state and LVGL objects are not mutated.",
      "The initial-duration and status getters remain stock.",
      "Only the factory app partition may be written; bootloader, NVS, and LittleFS remain untouched.",
    ],
  };
  await writeFile(path.join(outputDirectory, "stage3b-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  buildStage3b()
    .then((manifest) => console.log(JSON.stringify(manifest, null, 2)))
    .catch((error) => {
      console.error(`Error: ${error.message}`);
      process.exitCode = 1;
    });
}
