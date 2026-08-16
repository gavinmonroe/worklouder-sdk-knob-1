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

export const STAGE3C_SCREEN_ID = 7;
export const STAGE3C_ABI_APP_OFFSET = 0x1c6d2c;
export const STAGE3C_ABI_VIRTUAL_ADDRESS = 0x42116d2c;
export const STAGE3C_ABI_BYTES = 0x234;
export const STAGE3C_ABI_SHA256 = "c661adce78963c562625ece9f647033b864c4e91816d00223c3c6b8800936003";
export const STAGE3C_SETUP_POINTER_APP_OFFSET = 0x8c194;
export const STAGE3C_SETUP_WRAPPER_VIRTUAL_ADDRESS = 0x42116da8;
export const STAGE3C_UNREFERENCED_KEY_WRAPPER_VIRTUAL_ADDRESS = 0x42116f1c;
export const STAGE3C_KEY_CALLBACK_APP_OFFSET = 0xf1568;
export const STAGE3C_WPM_TICK_APP_OFFSET = 0x90634;
export const STAGE3C_FACTORY_PARTITION_BYTES = 0x800000;

export const EXPECTED_STAGE3C_CHECKSUM = 0x8e;
export const EXPECTED_STAGE3C_DIGEST = "290406408428c37fdf02e7e8fac61dc10f2d6ead192840f3447853e4cc1c305b";
export const EXPECTED_STAGE3C_APP_SHA256 = "4179b868b5a888f155fa93457c6ce9c8e57965ed5c756230dbb076fe27e910e6";
export const EXPECTED_STAGE3C_MERGED_SHA256 = "e48aac41de808daa27addf7fd541f83bf8dc21fa6620378471dc09eb481104da";
export const EXPECTED_STAGE3C_APP_BYTES = 1_960_576;
export const EXPECTED_STAGE3C_MERGED_BYTES = 2_026_112;

const IROM_SEGMENT_INDEX = 3;
const EXPECTED_STAGE3C_IROM_LENGTH = 0x116f40;
const EXPECTED_STAGE3C_SEGMENT_OFFSETS = Object.freeze({
  segment4Header: 0x1c6f60,
  segment4Data: 0x1c6f68,
  segment5Header: 0x1de94c,
  segment5Data: 0x1de954,
  checksum: 0x1dea5f,
  digest: 0x1dea60,
});

const sha256 = (data) => createHash("sha256").update(data).digest("hex");

export function decodeStage3cAbiHex(text) {
  if (typeof text !== "string" || !/^[0-9a-fA-F\s]+$/u.test(text)) {
    throw new Error("Stage-3C ABI hex contains non-hexadecimal data.");
  }
  const compact = text.replace(/\s+/gu, "");
  if (compact.length % 2 !== 0) throw new Error("Stage-3C ABI hex has an odd nibble count.");
  const abi = Buffer.from(compact, "hex");
  if (abi.length !== STAGE3C_ABI_BYTES || sha256(abi) !== STAGE3C_ABI_SHA256) {
    throw new Error("Stage-3C ABI byte count or hash differs from the independently audited artifact.");
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

function assertStage3cLayout(stage3b, stage3c, app, abi) {
  if (stage3b.segmentCount !== 6 || stage3c.segmentCount !== 6) {
    throw new Error("Stage-3C must retain the reviewed six-segment layout.");
  }

  const setupRelativeOffset = STAGE3C_SETUP_POINTER_APP_OFFSET - stage3b.segments[0].dataOffset;
  const getterRelativeOffset = REMAINING_GETTER_LITERAL_APP_OFFSET - stage3b.segments[IROM_SEGMENT_INDEX].dataOffset;
  for (let index = 0; index < stage3b.segmentCount; index += 1) {
    const before = stage3b.segments[index];
    const after = stage3c.segments[index];
    if (before.loadAddress !== after.loadAddress) throw new Error(`Segment ${index} load address changed.`);

    if (index === 0) {
      if (before.headerOffset !== after.headerOffset || before.dataOffset !== after.dataOffset ||
          before.length !== after.length) throw new Error("Stage-3C changed the DROM structure.");
      assertOnlyWordChanged(before, after, setupRelativeOffset, "Stage-3C setup pointer");
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
        throw new Error("Stage-3C did not restore only the getter and append only the audited ABI blob.");
      }
    } else if (after.headerOffset !== before.headerOffset + abi.length ||
               after.dataOffset !== before.dataOffset + abi.length ||
               after.length !== before.length || !after.data.equals(before.data)) {
      throw new Error(`Post-IROM segment ${index} was not shifted intact.`);
    }
  }

  const irom = stage3c.segments[IROM_SEGMENT_INDEX];
  if (irom.length !== EXPECTED_STAGE3C_IROM_LENGTH ||
      irom.dataOffset + irom.length - abi.length !== STAGE3C_ABI_APP_OFFSET ||
      irom.loadAddress + irom.length - abi.length !== STAGE3C_ABI_VIRTUAL_ADDRESS ||
      (irom.dataOffset & 0xffff) !== (irom.loadAddress & 0xffff)) {
    throw new Error("Stage-3C IROM growth or MMU congruence differs from the reviewed layout.");
  }
  if (stage3c.segments[4].headerOffset !== EXPECTED_STAGE3C_SEGMENT_OFFSETS.segment4Header ||
      stage3c.segments[4].dataOffset !== EXPECTED_STAGE3C_SEGMENT_OFFSETS.segment4Data ||
      stage3c.segments[5].headerOffset !== EXPECTED_STAGE3C_SEGMENT_OFFSETS.segment5Header ||
      stage3c.segments[5].dataOffset !== EXPECTED_STAGE3C_SEGMENT_OFFSETS.segment5Data ||
      stage3c.checksumOffset !== EXPECTED_STAGE3C_SEGMENT_OFFSETS.checksum ||
      stage3c.digestOffset !== EXPECTED_STAGE3C_SEGMENT_OFFSETS.digest) {
    throw new Error("Stage-3C shifted-segment or footer offsets differ from the independent derivation.");
  }
  if (app.length > STAGE3C_FACTORY_PARTITION_BYTES) {
    throw new Error("Stage-3C app exceeds the factory partition.");
  }
}

export function applyStage3cSelectableWpm(officialMerged, abi) {
  if (!Buffer.isBuffer(abi) || abi.length !== STAGE3C_ABI_BYTES || sha256(abi) !== STAGE3C_ABI_SHA256) {
    throw new Error("Stage-3C ABI blob differs from the independently audited artifact.");
  }

  const stage3bOutput = applyStage3bVisibleCanary(officialMerged);
  if (sha256(stage3bOutput.app) !== EXPECTED_STAGE3B_APP_SHA256 ||
      sha256(stage3bOutput.merged) !== EXPECTED_STAGE3B_MERGED_SHA256) {
    throw new Error("Stage-3C base is not the exact live-tested Stage-3B image.");
  }
  const registry = auditFramerScreenRegistry(stage3bOutput.app);
  if (registry.recommendedWpmScreenId !== STAGE3C_SCREEN_ID ||
      !registry.unusedIds.includes(STAGE3C_SCREEN_ID) || registry.navigationIds.includes(STAGE3C_SCREEN_ID)) {
    throw new Error("Screen ID 7 is no longer an unused, non-navigable slot.");
  }

  if (stage3bOutput.app.readUInt32LE(REMAINING_GETTER_LITERAL_APP_OFFSET) !== STAGE3B_CODE_VIRTUAL_ADDRESS ||
      stage3bOutput.app.readUInt32LE(STAGE3C_SETUP_POINTER_APP_OFFSET) !==
        FRAMER_SCREEN_AUDIT.screenSetupVtablePointer.expectedValue ||
      stage3bOutput.app.readUInt32LE(STAGE3C_KEY_CALLBACK_APP_OFFSET) !==
        FRAMER_SCREEN_AUDIT.wpmKeyCallbackLiteral.expectedValue ||
      stage3bOutput.app.readUInt32LE(STAGE3C_WPM_TICK_APP_OFFSET) !==
        FRAMER_SCREEN_AUDIT.wpmTickVtablePointer.expectedValue) {
    throw new Error("Stage-3C reviewed hook or native WPM pointers changed before mutation.");
  }

  let app = extendEsp32AppSegment(stage3bOutput.app, { segmentIndex: IROM_SEGMENT_INDEX, data: abi });
  app.writeUInt32LE(STOCK_REMAINING_GETTER, REMAINING_GETTER_LITERAL_APP_OFFSET);
  app.writeUInt32LE(STAGE3C_SETUP_WRAPPER_VIRTUAL_ADDRESS, STAGE3C_SETUP_POINTER_APP_OFFSET);
  app = repairEsp32AppIntegrity(app);
  const stage3c = inspectEsp32AppImage(app);
  assertStage3cLayout(stage3bOutput.stage3b, stage3c, app, abi);

  if (app.readUInt32LE(REMAINING_GETTER_LITERAL_APP_OFFSET) !== STOCK_REMAINING_GETTER ||
      app.readUInt32LE(STAGE3C_SETUP_POINTER_APP_OFFSET) !== STAGE3C_SETUP_WRAPPER_VIRTUAL_ADDRESS ||
      app.readUInt32LE(STAGE3C_KEY_CALLBACK_APP_OFFSET) !== FRAMER_SCREEN_AUDIT.wpmKeyCallbackLiteral.expectedValue ||
      app.readUInt32LE(STAGE3C_WPM_TICK_APP_OFFSET) !== FRAMER_SCREEN_AUDIT.wpmTickVtablePointer.expectedValue) {
    throw new Error("Stage-3C final hook or untouched native WPM pointers are incorrect.");
  }
  if (countU32Occurrences(app, STAGE3C_UNREFERENCED_KEY_WRAPPER_VIRTUAL_ADDRESS) !== 0) {
    throw new Error("Stage-3C future key wrapper unexpectedly became referenced.");
  }

  const merged = Buffer.concat([officialMerged.subarray(0, APP_FLASH_OFFSET), app]);
  if (stage3c.storedChecksum !== EXPECTED_STAGE3C_CHECKSUM ||
      stage3c.storedDigest?.toString("hex") !== EXPECTED_STAGE3C_DIGEST ||
      app.length !== EXPECTED_STAGE3C_APP_BYTES || merged.length !== EXPECTED_STAGE3C_MERGED_BYTES ||
      sha256(app) !== EXPECTED_STAGE3C_APP_SHA256 || sha256(merged) !== EXPECTED_STAGE3C_MERGED_SHA256) {
    throw new Error("Stage-3C integrity values differ from the independently constructed image.");
  }

  return { app, merged, stage3b: stage3bOutput.stage3b, stage3c, registry };
}

export async function buildStage3c({ root } = {}) {
  const projectRoot = root ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const sourcePath = path.join(projectRoot, "artifacts/firmware/firmware_0.4.1_merged.bin");
  const abiPath = path.join(projectRoot, "custom-firmware/experimental/stage3c-wpm-abi.hex");
  const outputDirectory = path.join(projectRoot, "custom-firmware/build");
  const [official, abiHex] = await Promise.all([readFile(sourcePath), readFile(abiPath, "utf8")]);
  const abi = decodeStage3cAbiHex(abiHex);
  const output = applyStage3cSelectableWpm(official, abi);
  const appName = "framer-0.4.1-stage3c-selectable-wpm-app.bin";
  const mergedName = "framer-0.4.1-stage3c-selectable-wpm-merged.bin";
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(path.join(outputDirectory, appName), output.app);
  await writeFile(path.join(outputDirectory, mergedName), output.merged);

  const irom = output.stage3c.segments[IROM_SEGMENT_INDEX];
  const manifest = {
    format: "framer-f1-stage3c-selectable-native-wpm-v1",
    purpose: "Register a host-free, dial-selectable WPM-number proof that reads the stock native kb_stats value.",
    target: "Framer F1 / knob_f1",
    baseFirmware: "0.4.1 Stage-3B (live write/read-back/boot and 00:42 visual proof verified)",
    behavior: {
      screenId: STAGE3C_SCREEN_ID,
      navigation: "Appended last to the existing live-length top-dial navigation vector; boot default is unchanged.",
      expectedDisplay: "A bubble labeled 'wpm' with the native current WPM number, refreshed every 500 ms.",
      test: "Open the new last dial screen, type words separated by spaces, observe WPM change, then leave and confirm the bubble hides.",
      scope: "WPM-number proof only; average/high/low/idle and pet moods remain Stage-3D work.",
    },
    patches: {
      restoredTimerGetter: {
        appOffset: REMAINING_GETTER_LITERAL_APP_OFFSET,
        from: `0x${STAGE3B_CODE_VIRTUAL_ADDRESS.toString(16)}`,
        to: `0x${STOCK_REMAINING_GETTER.toString(16)}`,
      },
      screenSetupPointer: {
        appOffset: STAGE3C_SETUP_POINTER_APP_OFFSET,
        from: `0x${FRAMER_SCREEN_AUDIT.screenSetupVtablePointer.expectedValue.toString(16)}`,
        to: `0x${STAGE3C_SETUP_WRAPPER_VIRTUAL_ADDRESS.toString(16)}`,
      },
      nativeKeyCallback: "unchanged",
      nativeWpmTick: "unchanged",
    },
    code: {
      source: "custom-firmware/experimental/stage3c-wpm-abi.S",
      pinnedHex: "custom-firmware/experimental/stage3c-wpm-abi.hex",
      appOffset: STAGE3C_ABI_APP_OFFSET,
      virtualAddress: `0x${STAGE3C_ABI_VIRTUAL_ADDRESS.toString(16)}`,
      bytes: abi.length,
      sha256: sha256(abi),
      executableFormat: "elf32-xtensa-le",
      finalLinkRelocations: 0,
    },
    layout: {
      segments: output.stage3c.segmentCount,
      iromHeaderAppOffset: irom.headerOffset,
      iromDataAppOffset: irom.dataOffset,
      iromBytes: irom.length,
      checksumAppOffset: output.stage3c.checksumOffset,
      digestAppOffset: output.stage3c.digestOffset,
      factoryPartitionHeadroom: STAGE3C_FACTORY_PARTITION_BYTES - output.app.length,
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
      "The exact ABI bytes, symbols, little-endian format, relocation state, and complete output hashes are pinned.",
      "Only the Stage-3B Timer getter and central setup pointer words change; the native key callback and WPM tick remain stock.",
      "The future any-key wrapper exists in the blob but is deliberately unreferenced in Stage-3C.",
      "The global bubble must not be driven by the Input host RPC during this proof.",
      "Only the factory app partition may be written; bootloader, NVS, and LittleFS remain untouched.",
    ],
    status: "Built for offline verification; live flashing requires a separate post-build audit and preflight.",
  };
  await writeFile(path.join(outputDirectory, "stage3c-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  buildStage3c()
    .then((manifest) => console.log(JSON.stringify(manifest, null, 2)))
    .catch((error) => {
      console.error(`Error: ${error.message}`);
      process.exitCode = 1;
    });
}
