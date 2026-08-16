#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { APP_FLASH_OFFSET } from "./build-stage1.mjs";
import {
  EXPECTED_STAGE3B_APP_SHA256,
  EXPECTED_STAGE3B_MERGED_SHA256,
  REMAINING_GETTER_LITERAL_APP_OFFSET,
  STAGE3B_CODE_VIRTUAL_ADDRESS,
  STOCK_REMAINING_GETTER,
  applyStage3bVisibleCanary,
} from "./build-stage3b.mjs";
import {
  extendEsp32AppSegment,
  inspectEsp32AppImage,
  repairEsp32AppIntegrity,
} from "./lib/esp-app-image.mjs";
import { auditFramerScreenRegistry, FRAMER_SCREEN_AUDIT } from "./lib/framer-registry-audit.mjs";

export const STAGE3C1_SCREEN_ID = 7;
export const STAGE3C1_ABI_APP_OFFSET = 0x1c6d2c;
export const STAGE3C1_ABI_VIRTUAL_ADDRESS = 0x42116d2c;
export const STAGE3C1_ABI_BYTES = 0x1e4;
export const STAGE3C1_ABI_SHA256 = "f28b7b48ff43283824fcc3d440d7f591437bd1dc7b4880a7b88695a7df632712";
export const STAGE3C1_SETUP_POINTER_APP_OFFSET = 0x8c194;
export const STAGE3C1_SETUP_WRAPPER_VIRTUAL_ADDRESS = 0x42116da4;
export const STAGE3C1_KEY_CALLBACK_APP_OFFSET = 0xf1568;
export const STAGE3C1_WPM_TICK_APP_OFFSET = 0x90634;
export const STAGE3C1_FACTORY_PARTITION_BYTES = 0x800000;

export const EXPECTED_STAGE3C1_CHECKSUM = 0xb5;
export const EXPECTED_STAGE3C1_DIGEST = "19ea7be90597720134b1bb2cf86144a6e17dc6b68b0cbf20320055139250a1c7";
export const EXPECTED_STAGE3C1_APP_SHA256 = "e2e7ba4ab4b9c247af8c0bdc3d7896ac52967bb7f90fb19beae73c0ae4a2b8fd";
export const EXPECTED_STAGE3C1_MERGED_SHA256 = "461b25b181c504bf07314e2ef7786f68a24d7c202528643d66da35e5cc22ed3c";
export const EXPECTED_STAGE3C1_APP_BYTES = 1_960_496;
export const EXPECTED_STAGE3C1_MERGED_BYTES = 2_026_032;

const IROM_SEGMENT_INDEX = 3;
const EXPECTED_STAGE3C1_IROM_LENGTH = 0x116ef0;
const EXPECTED_STAGE3C1_SEGMENT_OFFSETS = Object.freeze({
  segment4Header: 0x1c6f10,
  segment4Data: 0x1c6f18,
  segment5Header: 0x1de8fc,
  segment5Data: 0x1de904,
  checksum: 0x1dea0f,
  digest: 0x1dea10,
});
const FORBIDDEN_GLOBAL_BUBBLE_LITERALS = Object.freeze([
  0x42003dc8,
  0x3fca4f00,
  0x42004f10,
  0x4201a930,
]);

const sha256 = (data) => createHash("sha256").update(data).digest("hex");

export function decodeStage3c1AbiHex(text) {
  if (typeof text !== "string" || !/^[0-9a-fA-F\s]+$/u.test(text)) {
    throw new Error("Stage-3C.1 ABI hex contains non-hexadecimal data.");
  }
  const compact = text.replace(/\s+/gu, "");
  if (compact.length % 2 !== 0) throw new Error("Stage-3C.1 ABI hex has an odd nibble count.");
  const abi = Buffer.from(compact, "hex");
  if (abi.length !== STAGE3C1_ABI_BYTES || sha256(abi) !== STAGE3C1_ABI_SHA256) {
    throw new Error("Stage-3C.1 ABI byte count or hash differs from the reviewed artifact.");
  }
  return abi;
}

function countU32Occurrences(data, value) {
  const needle = Buffer.alloc(4);
  needle.writeUInt32LE(value);
  let count = 0;
  for (let offset = 0; offset <= data.length - needle.length; offset += 1) {
    if (data.subarray(offset, offset + needle.length).equals(needle)) count += 1;
  }
  return count;
}

function assertOnlyWordChanged(before, after, offset, description) {
  if (!before.data.subarray(0, offset).equals(after.data.subarray(0, offset)) ||
      !before.data.subarray(offset + 4).equals(after.data.subarray(offset + 4))) {
    throw new Error(`${description} changed bytes outside its reviewed word.`);
  }
}

function assertStage3c1Layout(stage3b, stage3c1, app, abi) {
  if (stage3b.segmentCount !== 6 || stage3c1.segmentCount !== 6) {
    throw new Error("Stage-3C.1 must retain the reviewed six-segment layout.");
  }

  const setupRelativeOffset = STAGE3C1_SETUP_POINTER_APP_OFFSET - stage3b.segments[0].dataOffset;
  const getterRelativeOffset = REMAINING_GETTER_LITERAL_APP_OFFSET -
    stage3b.segments[IROM_SEGMENT_INDEX].dataOffset;
  for (let index = 0; index < stage3b.segmentCount; index += 1) {
    const before = stage3b.segments[index];
    const after = stage3c1.segments[index];
    if (before.loadAddress !== after.loadAddress) throw new Error(`Segment ${index} load address changed.`);

    if (index === 0) {
      if (before.headerOffset !== after.headerOffset || before.dataOffset !== after.dataOffset ||
          before.length !== after.length) throw new Error("Stage-3C.1 changed the DROM structure.");
      assertOnlyWordChanged(before, after, setupRelativeOffset, "Stage-3C.1 setup pointer");
    } else if (index < IROM_SEGMENT_INDEX) {
      if (before.headerOffset !== after.headerOffset || before.dataOffset !== after.dataOffset ||
          before.length !== after.length || !before.data.equals(after.data)) {
        throw new Error(`Pre-IROM segment ${index} changed.`);
      }
    } else if (index === IROM_SEGMENT_INDEX) {
      if (before.headerOffset !== after.headerOffset || before.dataOffset !== after.dataOffset ||
          after.length !== before.length + abi.length ||
          !before.data.subarray(0, getterRelativeOffset).equals(after.data.subarray(0, getterRelativeOffset)) ||
          !before.data.subarray(getterRelativeOffset + 4).equals(
            after.data.subarray(getterRelativeOffset + 4, before.length),
          ) || !after.data.subarray(before.length).equals(abi)) {
        throw new Error("Stage-3C.1 did not restore only the getter and append only the reviewed ABI blob.");
      }
    } else if (after.headerOffset !== before.headerOffset + abi.length ||
               after.dataOffset !== before.dataOffset + abi.length ||
               after.length !== before.length || !after.data.equals(before.data)) {
      throw new Error(`Post-IROM segment ${index} was not shifted intact.`);
    }
  }

  const irom = stage3c1.segments[IROM_SEGMENT_INDEX];
  if (irom.length !== EXPECTED_STAGE3C1_IROM_LENGTH ||
      irom.dataOffset + irom.length - abi.length !== STAGE3C1_ABI_APP_OFFSET ||
      irom.loadAddress + irom.length - abi.length !== STAGE3C1_ABI_VIRTUAL_ADDRESS ||
      (irom.dataOffset & 0xffff) !== (irom.loadAddress & 0xffff)) {
    throw new Error("Stage-3C.1 IROM growth or MMU congruence differs from the reviewed layout.");
  }
  if (stage3c1.segments[4].headerOffset !== EXPECTED_STAGE3C1_SEGMENT_OFFSETS.segment4Header ||
      stage3c1.segments[4].dataOffset !== EXPECTED_STAGE3C1_SEGMENT_OFFSETS.segment4Data ||
      stage3c1.segments[5].headerOffset !== EXPECTED_STAGE3C1_SEGMENT_OFFSETS.segment5Header ||
      stage3c1.segments[5].dataOffset !== EXPECTED_STAGE3C1_SEGMENT_OFFSETS.segment5Data ||
      stage3c1.checksumOffset !== EXPECTED_STAGE3C1_SEGMENT_OFFSETS.checksum ||
      stage3c1.digestOffset !== EXPECTED_STAGE3C1_SEGMENT_OFFSETS.digest) {
    throw new Error("Stage-3C.1 shifted-segment or footer offsets differ from the reviewed derivation.");
  }
  if (app.length > STAGE3C1_FACTORY_PARTITION_BYTES) {
    throw new Error("Stage-3C.1 app exceeds the factory partition.");
  }
}

export function applyStage3c1OwnedLabels(officialMerged, abi) {
  if (!Buffer.isBuffer(abi) || abi.length !== STAGE3C1_ABI_BYTES || sha256(abi) !== STAGE3C1_ABI_SHA256) {
    throw new Error("Stage-3C.1 ABI blob differs from the reviewed artifact.");
  }
  for (const value of FORBIDDEN_GLOBAL_BUBBLE_LITERALS) {
    if (countU32Occurrences(abi, value) !== 0) {
      throw new Error(`Stage-3C.1 ABI references forbidden global bubble value 0x${value.toString(16)}.`);
    }
  }

  const stage3bOutput = applyStage3bVisibleCanary(officialMerged);
  if (sha256(stage3bOutput.app) !== EXPECTED_STAGE3B_APP_SHA256 ||
      sha256(stage3bOutput.merged) !== EXPECTED_STAGE3B_MERGED_SHA256) {
    throw new Error("Stage-3C.1 base is not the exact live-tested Stage-3B image.");
  }
  const registry = auditFramerScreenRegistry(stage3bOutput.app);
  if (registry.recommendedWpmScreenId !== STAGE3C1_SCREEN_ID ||
      !registry.unusedIds.includes(STAGE3C1_SCREEN_ID) || registry.navigationIds.includes(STAGE3C1_SCREEN_ID)) {
    throw new Error("Screen ID 7 is no longer an unused, non-navigable slot.");
  }

  if (stage3bOutput.app.readUInt32LE(REMAINING_GETTER_LITERAL_APP_OFFSET) !== STAGE3B_CODE_VIRTUAL_ADDRESS ||
      stage3bOutput.app.readUInt32LE(STAGE3C1_SETUP_POINTER_APP_OFFSET) !==
        FRAMER_SCREEN_AUDIT.screenSetupVtablePointer.expectedValue ||
      stage3bOutput.app.readUInt32LE(STAGE3C1_KEY_CALLBACK_APP_OFFSET) !==
        FRAMER_SCREEN_AUDIT.wpmKeyCallbackLiteral.expectedValue ||
      stage3bOutput.app.readUInt32LE(STAGE3C1_WPM_TICK_APP_OFFSET) !==
        FRAMER_SCREEN_AUDIT.wpmTickVtablePointer.expectedValue) {
    throw new Error("Stage-3C.1 reviewed hook or native WPM pointers changed before mutation.");
  }

  let app = extendEsp32AppSegment(stage3bOutput.app, { segmentIndex: IROM_SEGMENT_INDEX, data: abi });
  app.writeUInt32LE(STOCK_REMAINING_GETTER, REMAINING_GETTER_LITERAL_APP_OFFSET);
  app.writeUInt32LE(STAGE3C1_SETUP_WRAPPER_VIRTUAL_ADDRESS, STAGE3C1_SETUP_POINTER_APP_OFFSET);
  app = repairEsp32AppIntegrity(app);
  const stage3c1 = inspectEsp32AppImage(app);
  assertStage3c1Layout(stage3bOutput.stage3b, stage3c1, app, abi);

  if (app.readUInt32LE(REMAINING_GETTER_LITERAL_APP_OFFSET) !== STOCK_REMAINING_GETTER ||
      app.readUInt32LE(STAGE3C1_SETUP_POINTER_APP_OFFSET) !== STAGE3C1_SETUP_WRAPPER_VIRTUAL_ADDRESS ||
      app.readUInt32LE(STAGE3C1_KEY_CALLBACK_APP_OFFSET) !==
        FRAMER_SCREEN_AUDIT.wpmKeyCallbackLiteral.expectedValue ||
      app.readUInt32LE(STAGE3C1_WPM_TICK_APP_OFFSET) !==
        FRAMER_SCREEN_AUDIT.wpmTickVtablePointer.expectedValue) {
    throw new Error("Stage-3C.1 final hook or untouched native WPM pointers are incorrect.");
  }

  const merged = Buffer.concat([officialMerged.subarray(0, APP_FLASH_OFFSET), app]);
  if (stage3c1.storedChecksum !== EXPECTED_STAGE3C1_CHECKSUM ||
      stage3c1.storedDigest?.toString("hex") !== EXPECTED_STAGE3C1_DIGEST ||
      app.length !== EXPECTED_STAGE3C1_APP_BYTES || merged.length !== EXPECTED_STAGE3C1_MERGED_BYTES ||
      sha256(app) !== EXPECTED_STAGE3C1_APP_SHA256 || sha256(merged) !== EXPECTED_STAGE3C1_MERGED_SHA256) {
    throw new Error("Stage-3C.1 integrity values differ from the independently derived image.");
  }

  return { app, merged, stage3b: stage3bOutput.stage3b, stage3c1, registry };
}

export async function buildStage3c1({ root } = {}) {
  const projectRoot = root ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const sourcePath = path.join(projectRoot, "artifacts/firmware/firmware_0.4.1_merged.bin");
  const abiPath = path.join(projectRoot, "custom-firmware/experimental/stage3c1-wpm-labels.hex");
  const outputDirectory = path.join(projectRoot, "custom-firmware/build");
  const [official, abiHex] = await Promise.all([readFile(sourcePath), readFile(abiPath, "utf8")]);
  const abi = decodeStage3c1AbiHex(abiHex);
  const output = applyStage3c1OwnedLabels(official, abi);
  const appName = "framer-0.4.1-stage3c1-wpm-owned-labels-app.bin";
  const mergedName = "framer-0.4.1-stage3c1-wpm-owned-labels-merged.bin";
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(path.join(outputDirectory, appName), output.app);
  await writeFile(path.join(outputDirectory, mergedName), output.merged);

  const irom = output.stage3c1.segments[IROM_SEGMENT_INDEX];
  const manifest = {
    format: "framer-f1-stage3c1-owned-wpm-labels-v1",
    purpose: "Correct Stage-3C's black WPM screen by rendering two labels owned by screen ID 7.",
    target: "Framer F1 / knob_f1",
    baseFirmware: "Rebuilt from exact Stage-3B; replaces the live but visually defective Stage-3C image.",
    behavior: {
      screenId: STAGE3C1_SCREEN_ID,
      expectedDisplay: "A persistent lowercase 'wpm' title and native current-WPM number on the ID 7 page.",
      refresh: "The stock kb_stats float is read on the LVGL thread and painted every 500 ms.",
      lifecycle: "Labels are built in stock slot 1, owned by the screen root, and recursively deleted on unload.",
      test: "Open the last dial screen; confirm title/value remain, type space-delimited words, leave/re-enter twice, and verify no popup leaks to the first screen.",
      scope: "Visible WPM-number correction only; average/high/low/idle and pet moods remain later work.",
    },
    patches: {
      restoredTimerGetter: {
        appOffset: REMAINING_GETTER_LITERAL_APP_OFFSET,
        from: `0x${STAGE3B_CODE_VIRTUAL_ADDRESS.toString(16)}`,
        to: `0x${STOCK_REMAINING_GETTER.toString(16)}`,
      },
      screenSetupPointer: {
        appOffset: STAGE3C1_SETUP_POINTER_APP_OFFSET,
        from: `0x${FRAMER_SCREEN_AUDIT.screenSetupVtablePointer.expectedValue.toString(16)}`,
        to: `0x${STAGE3C1_SETUP_WRAPPER_VIRTUAL_ADDRESS.toString(16)}`,
      },
      nativeKeyCallback: "unchanged",
      nativeWpmTick: "unchanged",
      globalBubbleModel: "unreferenced by appended code",
    },
    code: {
      source: "custom-firmware/experimental/stage3c1-wpm-labels.S",
      pinnedHex: "custom-firmware/experimental/stage3c1-wpm-labels.hex",
      appOffset: STAGE3C1_ABI_APP_OFFSET,
      virtualAddress: `0x${STAGE3C1_ABI_VIRTUAL_ADDRESS.toString(16)}`,
      bytes: abi.length,
      sha256: sha256(abi),
      executableFormat: "elf32-xtensa-le",
      finalLinkRelocations: 0,
      canonicalAssemblerMode: "ESP32-S3 default transformations; complete output bytes are pinned",
    },
    layout: {
      segments: output.stage3c1.segmentCount,
      iromHeaderAppOffset: irom.headerOffset,
      iromDataAppOffset: irom.dataOffset,
      iromBytes: irom.length,
      checksumAppOffset: output.stage3c1.checksumOffset,
      digestAppOffset: output.stage3c1.digestOffset,
      factoryPartitionHeadroom: STAGE3C1_FACTORY_PARTITION_BYTES - output.app.length,
    },
    outputs: {
      app: { file: appName, bytes: output.app.length, sha256: sha256(output.app) },
      merged: { file: mergedName, bytes: output.merged.length, sha256: sha256(output.merged) },
    },
    rollback: {
      image: "framer-0.4.1-stage3b-visible-canary-app.bin",
      flashOffset: "0x10000",
      sha256: EXPECTED_STAGE3B_APP_SHA256,
    },
    safety: [
      "The image retains six segments and exactly one existing IROM mapping; code is appended to that IROM.",
      "The exact ABI bytes, symbols, S3 little-endian format, relocation state, and complete output hashes are pinned.",
      "Only the Stage-3B Timer getter and central setup pointer words change; native key and WPM tick hooks remain stock.",
      "The appended code contains no process-global Framer bubble model, getter, updater, or string-assignment pointers.",
      "A null value-label pointer is fail-soft guarded before every periodic paint.",
      "Only the factory app partition may be written; bootloader, NVS, and LittleFS remain untouched.",
    ],
    status: "Built for offline verification; live flashing requires independent generated-image audit and preflight.",
  };
  await writeFile(path.join(outputDirectory, "stage3c1-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  buildStage3c1()
    .then((manifest) => console.log(JSON.stringify(manifest, null, 2)))
    .catch((error) => {
      console.error(`Error: ${error.message}`);
      process.exitCode = 1;
    });
}
