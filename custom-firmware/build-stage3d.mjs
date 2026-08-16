#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { APP_FLASH_OFFSET } from "./build-stage1.mjs";
import { REMAINING_GETTER_LITERAL_APP_OFFSET, STOCK_REMAINING_GETTER } from "./build-stage3b.mjs";
import {
  EXPECTED_STAGE3C1_APP_SHA256,
  EXPECTED_STAGE3C1_MERGED_SHA256,
  STAGE3C1_KEY_CALLBACK_APP_OFFSET,
  STAGE3C1_SETUP_POINTER_APP_OFFSET,
  STAGE3C1_SETUP_WRAPPER_VIRTUAL_ADDRESS,
  STAGE3C1_WPM_TICK_APP_OFFSET,
  applyStage3c1OwnedLabels,
  decodeStage3c1AbiHex,
} from "./build-stage3c1.mjs";
import {
  extendEsp32AppSegment,
  inspectEsp32AppImage,
  repairEsp32AppIntegrity,
} from "./lib/esp-app-image.mjs";
import { FRAMER_SCREEN_AUDIT } from "./lib/framer-registry-audit.mjs";

export const STAGE3D_SCREEN_ID = 7;
export const STAGE3D_ABI_APP_OFFSET = 0x1c6f10;
export const STAGE3D_ABI_VIRTUAL_ADDRESS = 0x42116f10;
export const STAGE3D_ABI_BYTES = 0x518;
export const STAGE3D_ABI_SHA256 = "e7788b20cd4d8733f67c96f16e7a4dfc71834f2e8a425279bf562e4fa34d6a17";
export const STAGE3D_SETUP_WRAPPER_VIRTUAL_ADDRESS = 0x42116fec;
export const STAGE3D_KEY_WRAPPER_VIRTUAL_ADDRESS = 0x421173ec;
export const STAGE3D_FACTORY_PARTITION_BYTES = 0x800000;

export const EXPECTED_STAGE3D_CHECKSUM = 0x8f;
export const EXPECTED_STAGE3D_DIGEST = "1f54861028022199ca9202154abdc40e0f93bc7ee42223fe280a2d4206ce6d27";
export const EXPECTED_STAGE3D_APP_SHA256 = "dd80791208577a1667ccd17956798d379d6e9a34f943188ac4334d045801c491";
export const EXPECTED_STAGE3D_MERGED_SHA256 = "8ffb540587b65e7e3cab72c6b19e8d47091e60df65741d6b7583bde18d5f7856";
export const EXPECTED_STAGE3D_APP_BYTES = 1_961_808;
export const EXPECTED_STAGE3D_MERGED_BYTES = 2_027_344;

const IROM_SEGMENT_INDEX = 3;
const EXPECTED_STAGE3D_IROM_LENGTH = 0x117408;
const EXPECTED_STAGE3D_SEGMENT_OFFSETS = Object.freeze({
  segment4Header: 0x1c7428,
  segment4Data: 0x1c7430,
  segment5Header: 0x1dee14,
  segment5Data: 0x1dee1c,
  checksum: 0x1def2f,
  digest: 0x1def30,
});
const FORBIDDEN_GLOBAL_BUBBLE_LITERALS = Object.freeze([
  0x42003dc8,
  0x3fca4f00,
  0x42004f10,
  0x4201a930,
]);

const sha256 = (data) => createHash("sha256").update(data).digest("hex");

export function decodeStage3dAbiHex(text) {
  if (typeof text !== "string" || !/^[0-9a-fA-F\s]+$/u.test(text)) {
    throw new Error("Stage-3D ABI hex contains non-hexadecimal data.");
  }
  const compact = text.replace(/\s+/gu, "");
  if (compact.length % 2 !== 0) throw new Error("Stage-3D ABI hex has an odd nibble count.");
  const abi = Buffer.from(compact, "hex");
  if (abi.length !== STAGE3D_ABI_BYTES || sha256(abi) !== STAGE3D_ABI_SHA256) {
    throw new Error("Stage-3D ABI byte count or hash differs from the independently audited artifact.");
  }
  return abi;
}

function countU32Occurrences(data, value) {
  const needle = Buffer.alloc(4);
  needle.writeUInt32LE(value >>> 0);
  let count = 0;
  for (let offset = 0; offset <= data.length - 4; offset += 1) {
    if (data.subarray(offset, offset + 4).equals(needle)) count += 1;
  }
  return count;
}

function assertOnlyWordChanged(before, after, offset, description) {
  if (!before.data.subarray(0, offset).equals(after.data.subarray(0, offset)) ||
      !before.data.subarray(offset + 4).equals(after.data.subarray(offset + 4))) {
    throw new Error(`${description} changed bytes outside its reviewed word.`);
  }
}

function assertStage3dLayout(stage3c1, stage3d, app, abi) {
  if (stage3c1.segmentCount !== 6 || stage3d.segmentCount !== 6) {
    throw new Error("Stage-3D must retain the reviewed six-segment layout.");
  }

  const setupRelativeOffset = STAGE3C1_SETUP_POINTER_APP_OFFSET - stage3c1.segments[0].dataOffset;
  const keyRelativeOffset = STAGE3C1_KEY_CALLBACK_APP_OFFSET -
    stage3c1.segments[IROM_SEGMENT_INDEX].dataOffset;

  for (let index = 0; index < stage3c1.segmentCount; index += 1) {
    const before = stage3c1.segments[index];
    const after = stage3d.segments[index];
    if (before.loadAddress !== after.loadAddress) throw new Error(`Segment ${index} load address changed.`);

    if (index === 0) {
      if (before.headerOffset !== after.headerOffset || before.dataOffset !== after.dataOffset ||
          before.length !== after.length) throw new Error("Stage-3D changed the DROM structure.");
      assertOnlyWordChanged(before, after, setupRelativeOffset, "Stage-3D setup pointer");
    } else if (index < IROM_SEGMENT_INDEX) {
      if (before.headerOffset !== after.headerOffset || before.dataOffset !== after.dataOffset ||
          before.length !== after.length || !before.data.equals(after.data)) {
        throw new Error(`Pre-IROM segment ${index} changed.`);
      }
    } else if (index === IROM_SEGMENT_INDEX) {
      if (before.headerOffset !== after.headerOffset || before.dataOffset !== after.dataOffset ||
          after.length !== before.length + abi.length ||
          !before.data.subarray(0, keyRelativeOffset).equals(after.data.subarray(0, keyRelativeOffset)) ||
          !before.data.subarray(keyRelativeOffset + 4).equals(
            after.data.subarray(keyRelativeOffset + 4, before.length),
          ) || !after.data.subarray(before.length).equals(abi)) {
        throw new Error("Stage-3D did not patch only the key hook and append only the audited ABI blob.");
      }
    } else if (after.headerOffset !== before.headerOffset + abi.length ||
               after.dataOffset !== before.dataOffset + abi.length ||
               after.length !== before.length || !after.data.equals(before.data)) {
      throw new Error(`Post-IROM segment ${index} was not shifted intact.`);
    }
  }

  const irom = stage3d.segments[IROM_SEGMENT_INDEX];
  if (irom.length !== EXPECTED_STAGE3D_IROM_LENGTH ||
      irom.dataOffset + irom.length - abi.length !== STAGE3D_ABI_APP_OFFSET ||
      irom.loadAddress + irom.length - abi.length !== STAGE3D_ABI_VIRTUAL_ADDRESS ||
      irom.loadAddress + irom.length !== 0x42117428 ||
      (irom.dataOffset & 0xffff) !== (irom.loadAddress & 0xffff)) {
    throw new Error("Stage-3D IROM growth or MMU congruence differs from the audited layout.");
  }
  if (stage3d.segments[4].headerOffset !== EXPECTED_STAGE3D_SEGMENT_OFFSETS.segment4Header ||
      stage3d.segments[4].dataOffset !== EXPECTED_STAGE3D_SEGMENT_OFFSETS.segment4Data ||
      stage3d.segments[5].headerOffset !== EXPECTED_STAGE3D_SEGMENT_OFFSETS.segment5Header ||
      stage3d.segments[5].dataOffset !== EXPECTED_STAGE3D_SEGMENT_OFFSETS.segment5Data ||
      stage3d.checksumOffset !== EXPECTED_STAGE3D_SEGMENT_OFFSETS.checksum ||
      stage3d.digestOffset !== EXPECTED_STAGE3D_SEGMENT_OFFSETS.digest) {
    throw new Error("Stage-3D shifted-segment or footer offsets differ from the audited derivation.");
  }
  if (app.length > STAGE3D_FACTORY_PARTITION_BYTES) {
    throw new Error("Stage-3D app exceeds the factory partition.");
  }
}

export function applyStage3dPet(officialMerged, stage3c1Abi, stage3dAbi) {
  if (!Buffer.isBuffer(stage3dAbi) || stage3dAbi.length !== STAGE3D_ABI_BYTES ||
      sha256(stage3dAbi) !== STAGE3D_ABI_SHA256) {
    throw new Error("Stage-3D ABI blob differs from the independently audited artifact.");
  }
  for (const value of FORBIDDEN_GLOBAL_BUBBLE_LITERALS) {
    if (countU32Occurrences(stage3dAbi, value) !== 0) {
      throw new Error(`Stage-3D ABI references forbidden global bubble value 0x${value.toString(16)}.`);
    }
  }

  const stage3c1Output = applyStage3c1OwnedLabels(officialMerged, stage3c1Abi);
  if (sha256(stage3c1Output.app) !== EXPECTED_STAGE3C1_APP_SHA256 ||
      sha256(stage3c1Output.merged) !== EXPECTED_STAGE3C1_MERGED_SHA256) {
    throw new Error("Stage-3D base is not the exact live-tested Stage-3C.1 image.");
  }
  const base = stage3c1Output.stage3c1;
  if (stage3c1Output.app.readUInt32LE(REMAINING_GETTER_LITERAL_APP_OFFSET) !== STOCK_REMAINING_GETTER ||
      stage3c1Output.app.readUInt32LE(STAGE3C1_SETUP_POINTER_APP_OFFSET) !==
        STAGE3C1_SETUP_WRAPPER_VIRTUAL_ADDRESS ||
      stage3c1Output.app.readUInt32LE(STAGE3C1_KEY_CALLBACK_APP_OFFSET) !==
        FRAMER_SCREEN_AUDIT.wpmKeyCallbackLiteral.expectedValue ||
      stage3c1Output.app.readUInt32LE(STAGE3C1_WPM_TICK_APP_OFFSET) !==
        FRAMER_SCREEN_AUDIT.wpmTickVtablePointer.expectedValue ||
      base.segments[IROM_SEGMENT_INDEX].dataOffset + base.segments[IROM_SEGMENT_INDEX].length !==
        STAGE3D_ABI_APP_OFFSET ||
      base.segments[IROM_SEGMENT_INDEX].loadAddress + base.segments[IROM_SEGMENT_INDEX].length !==
        STAGE3D_ABI_VIRTUAL_ADDRESS) {
    throw new Error("Stage-3D reviewed base pointers or append boundary changed before mutation.");
  }

  let app = extendEsp32AppSegment(stage3c1Output.app, {
    segmentIndex: IROM_SEGMENT_INDEX,
    data: stage3dAbi,
  });
  app.writeUInt32LE(STAGE3D_SETUP_WRAPPER_VIRTUAL_ADDRESS, STAGE3C1_SETUP_POINTER_APP_OFFSET);
  app.writeUInt32LE(STAGE3D_KEY_WRAPPER_VIRTUAL_ADDRESS, STAGE3C1_KEY_CALLBACK_APP_OFFSET);
  app = repairEsp32AppIntegrity(app);
  const stage3d = inspectEsp32AppImage(app);
  assertStage3dLayout(stage3c1Output.stage3c1, stage3d, app, stage3dAbi);

  if (app.readUInt32LE(REMAINING_GETTER_LITERAL_APP_OFFSET) !== STOCK_REMAINING_GETTER ||
      app.readUInt32LE(STAGE3C1_SETUP_POINTER_APP_OFFSET) !== STAGE3D_SETUP_WRAPPER_VIRTUAL_ADDRESS ||
      app.readUInt32LE(STAGE3C1_KEY_CALLBACK_APP_OFFSET) !== STAGE3D_KEY_WRAPPER_VIRTUAL_ADDRESS ||
      app.readUInt32LE(STAGE3C1_WPM_TICK_APP_OFFSET) !==
        FRAMER_SCREEN_AUDIT.wpmTickVtablePointer.expectedValue ||
      countU32Occurrences(app, STAGE3D_SETUP_WRAPPER_VIRTUAL_ADDRESS) !== 1 ||
      countU32Occurrences(app, STAGE3D_KEY_WRAPPER_VIRTUAL_ADDRESS) !== 1) {
    throw new Error("Stage-3D final hooks or untouched native pointers are incorrect.");
  }

  const merged = Buffer.concat([officialMerged.subarray(0, APP_FLASH_OFFSET), app]);
  if (stage3d.storedChecksum !== EXPECTED_STAGE3D_CHECKSUM ||
      stage3d.storedDigest?.toString("hex") !== EXPECTED_STAGE3D_DIGEST ||
      app.length !== EXPECTED_STAGE3D_APP_BYTES || merged.length !== EXPECTED_STAGE3D_MERGED_BYTES ||
      sha256(app) !== EXPECTED_STAGE3D_APP_SHA256 || sha256(merged) !== EXPECTED_STAGE3D_MERGED_SHA256) {
    throw new Error("Stage-3D integrity values differ from the independently derived image.");
  }

  return { app, merged, stage3c1: stage3c1Output.stage3c1, stage3d };
}

export async function buildStage3d({ root } = {}) {
  const projectRoot = root ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const sourcePath = path.join(projectRoot, "artifacts/firmware/firmware_0.4.1_merged.bin");
  const stage3c1Path = path.join(projectRoot, "custom-firmware/experimental/stage3c1-wpm-labels.hex");
  const stage3dPath = path.join(projectRoot, "custom-firmware/experimental/stage3d-wpm-pet.hex");
  const outputDirectory = path.join(projectRoot, "custom-firmware/build");
  const [official, stage3c1Hex, stage3dHex] = await Promise.all([
    readFile(sourcePath),
    readFile(stage3c1Path, "utf8"),
    readFile(stage3dPath, "utf8"),
  ]);
  const stage3c1Abi = decodeStage3c1AbiHex(stage3c1Hex);
  const stage3dAbi = decodeStage3dAbiHex(stage3dHex);
  const output = applyStage3dPet(official, stage3c1Abi, stage3dAbi);
  const appName = "framer-0.4.1-stage3d-wpm-pet-app.bin";
  const mergedName = "framer-0.4.1-stage3d-wpm-pet-merged.bin";
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(path.join(outputDirectory, appName), output.app);
  await writeFile(path.join(outputDirectory, mergedName), output.merged);

  const irom = output.stage3d.segments[IROM_SEGMENT_INDEX];
  const manifest = {
    format: "framer-f1-stage3d-native-wpm-pet-v1",
    purpose: "Add a selectable, screen-owned WPM cat with current, average, high, low, idle, and mood states.",
    target: "Framer F1 / knob_f1",
    baseFirmware: "Exact live-tested Stage-3C.1 app, reconstructed from official Framer 0.4.1.",
    behavior: {
      screenId: STAGE3D_SCREEN_ID,
      layout: ["ASCII cat ears", "stateful cat face", "current WPM", "A/H/L session statistics"],
      petStates: ["ready", "hatching", "sleeping", "waiting", "fire", "zooming", "happy", "tired", "steady"],
      timing: {
        nativeWpmAndPaintMs: 500,
        warmupActiveSamples: 20,
        waitingAfterMs: 5000,
        sleepingAfterMs: 30000,
        resetOnNextKeyAfterMs: 300000,
        newHighCelebrationMs: 1500,
      },
      statistics: "Current, average, high, and low are clamped to 0..999; zero/idle samples are excluded.",
      activity: "The stock key callback runs first; pressed keys on active ID 7 increment a memory-barrier-protected epoch.",
      lifecycle: "Four labels belong to the screen root and are recursively deleted by the stock unload path.",
    },
    patches: {
      screenSetupPointer: {
        appOffset: STAGE3C1_SETUP_POINTER_APP_OFFSET,
        from: `0x${STAGE3C1_SETUP_WRAPPER_VIRTUAL_ADDRESS.toString(16)}`,
        to: `0x${STAGE3D_SETUP_WRAPPER_VIRTUAL_ADDRESS.toString(16)}`,
      },
      nativeKeyCallback: {
        appOffset: STAGE3C1_KEY_CALLBACK_APP_OFFSET,
        from: `0x${FRAMER_SCREEN_AUDIT.wpmKeyCallbackLiteral.expectedValue.toString(16)}`,
        to: `0x${STAGE3D_KEY_WRAPPER_VIRTUAL_ADDRESS.toString(16)}`,
        stockFirst: true,
      },
      timerGetter: "unchanged stock getter",
      nativeWpmTick: "unchanged",
      globalBubbleModel: "unreferenced by Stage-3D appended code",
    },
    code: {
      source: "custom-firmware/experimental/stage3d-wpm-pet.S",
      linker: "custom-firmware/experimental/stage3d-wpm-pet.ld",
      pinnedHex: "custom-firmware/experimental/stage3d-wpm-pet.hex",
      appOffset: STAGE3D_ABI_APP_OFFSET,
      virtualAddress: `0x${STAGE3D_ABI_VIRTUAL_ADDRESS.toString(16)}`,
      bytes: stage3dAbi.length,
      sha256: sha256(stage3dAbi),
      executableFormat: "elf32-xtensa-le",
      finalLinkRelocations: 0,
    },
    layout: {
      segments: output.stage3d.segmentCount,
      iromHeaderAppOffset: irom.headerOffset,
      iromDataAppOffset: irom.dataOffset,
      iromBytes: irom.length,
      iromEndVirtualAddress: `0x${(irom.loadAddress + irom.length).toString(16)}`,
      checksumAppOffset: output.stage3d.checksumOffset,
      digestAppOffset: output.stage3d.digestOffset,
      factoryPartitionHeadroom: STAGE3D_FACTORY_PARTITION_BYTES - output.app.length,
    },
    outputs: {
      app: { file: appName, bytes: output.app.length, sha256: sha256(output.app) },
      merged: { file: mergedName, bytes: output.merged.length, sha256: sha256(output.merged) },
    },
    rollback: {
      image: "framer-0.4.1-stage3c1-wpm-owned-labels-app.bin",
      flashOffset: "0x10000",
      sha256: EXPECTED_STAGE3C1_APP_SHA256,
      behavior: "Live-proven white WPM title/value widget.",
    },
    safety: [
      "The app retains six segments, one DROM, and one existing IROM mapping.",
      "The exact S3 little-endian ABI bytes, symbols, zero-relocation state, and output hashes are pinned.",
      "Relative to live Stage-3C.1, only the setup word and stock key-callback literal change before the exact IROM append.",
      "The Timer getter and native 500-ms WPM tick remain stock.",
      "The appended code does not reference the process-global Framer bubble model.",
      "Only the factory app partition may be written; bootloader, NVS, and LittleFS remain untouched.",
    ],
    status: "Built for offline verification; live flashing requires independent generated-image audit and preflight.",
  };
  await writeFile(path.join(outputDirectory, "stage3d-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  buildStage3d()
    .then((manifest) => console.log(JSON.stringify(manifest, null, 2)))
    .catch((error) => {
      console.error(`Error: ${error.message}`);
      process.exitCode = 1;
    });
}
