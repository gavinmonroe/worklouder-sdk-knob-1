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
  STAGE3C1_WPM_TICK_APP_OFFSET,
  applyStage3c1OwnedLabels,
  decodeStage3c1AbiHex,
} from "./build-stage3c1.mjs";
import {
  extendEsp32AppSegment,
  inspectEsp32AppImage,
  repairEsp32AppIntegrity,
} from "./lib/esp-app-image.mjs";
import {
  FRAMER_SPRITE_LAYOUT,
  auditFramerImagePipeline,
  buildNativeLvglI8SpriteBank,
  padSpriteBankForMappedDrom,
} from "./lib/framer-lvgl-sprite.mjs";
import { FRAMER_SCREEN_AUDIT } from "./lib/framer-registry-audit.mjs";

export const STAGE3E_SCREEN_ID = 7;
export const STAGE3E_ABI_APP_OFFSET = 0x1d6f10;
export const STAGE3E_ABI_VIRTUAL_ADDRESS = 0x42116f10;
export const STAGE3E_ABI_BYTES = 0x4f8;
export const STAGE3E_ABI_SHA256 = "e96498a5a7dde80dff9bd043554463a5b48b28ebc5d87091bc625afb52f405f3";
export const STAGE3E_SETUP_WRAPPER_VIRTUAL_ADDRESS = 0x42116fcc;
export const STAGE3E_ASSET_BANK_APP_OFFSET = 0x0a1190;
export const STAGE3E_ASSET_BANK_VIRTUAL_ADDRESS = 0x3c1c1190;
export const STAGE3E_ASSET_BANK_BYTES = 60_944;
export const STAGE3E_DROM_GROWTH_BYTES = 0x10000;
export const STAGE3E_FACTORY_PARTITION_BYTES = 0x800000;

export const STAGE3E_ASSET_SPECS = Object.freeze([
  ["sky-0", "d0d322a6d53e26af6b0789831c532dd8d2d439754ea5243dedc6d0b7a87f2e80", 100, 100, 11036],
  ["sky-1", "0faeaec41f1bd9b45b86df5976cb122c1521a6f6c8a7c48d9510964e03249322", 100, 100, 11036],
  ["cat-0", "fd16f2f1b7466a51c047ae7258795677ad7713f5104c6e5d15be21bb3261b397", 68, 56, 4844],
  ["cat-1", "3951cf38a34057dd2493100f07b0b1af3381f931d3fb4406b69b7d61f4d4ea7c", 68, 56, 4844],
  ["cat-2", "fb49fb4599491f58ae428dc7de6155625180d30694773cfac9ec417f3c922867", 68, 56, 4844],
  ["cat-3", "f8926e00eb8697cbd8bbfb6857e6d92ebe2cb7ebdad9e1dc739145e3371e6e78", 68, 56, 4844],
  ["cat-4", "4d1a35dc108e76fcf1c1a3169f0304606c9c1039db71c995ed3ce38909aea095", 68, 56, 4844],
  ["cat-5", "aca858fc895d3a66a4e9d3711db3f9d7a008804f40dae83cd1dca9e6748ca78c", 68, 56, 4844],
  ["cat-6", "fc83555569a67b8c827fb0baf6948553e4d1023d061e13c2fe4e42539c023aba", 68, 56, 4844],
  ["cat-7", "5b24676867cac7a8e8ea18c7b01f69e171321f2f54f89bb7d9e851cdb5a61dab", 68, 56, 4844],
].map(([name, sha256, width, height, bytes]) => Object.freeze({ name, sha256, width, height, bytes })));

export const STAGE3E_ASSET_BANK_SHA256 = "db51e51c3aff251f0536eadd3522c467e11ae5714f92ce361ac901a3b3f5fab4";
export const STAGE3E_PADDED_BANK_SHA256 = "e805083c99aaa0fbd05648b75fc56f29c39fa0c7aa27971572f72ae24f64582f";

export const EXPECTED_STAGE3E_CHECKSUM = 0x51;
export const EXPECTED_STAGE3E_DIGEST = "dee6f1b159886c1a878debd247c21907c2dd4499573a16f8aa4f9ce72e8a79f7";
export const EXPECTED_STAGE3E_APP_SHA256 = "546ece0044e4a69ae8db9d9a781edc776f3d1d20d82105afd9ee6de47ff01aba";
export const EXPECTED_STAGE3E_MERGED_SHA256 = "aed65c609fa5317921b0c06c081876ef504788aa3868d43f6e5c8781301b6f1d";
export const EXPECTED_STAGE3E_APP_BYTES = 2_027_312;
export const EXPECTED_STAGE3E_MERGED_BYTES = 2_092_848;

const DROM_SEGMENT_INDEX = 0;
const IROM_SEGMENT_INDEX = 3;
const EXPECTED_IROM_LENGTH = 0x1173e8;
const EXPECTED_OFFSETS = Object.freeze({
  segment4Header: 0x1d7408,
  segment4Data: 0x1d7410,
  segment5Header: 0x1eedf4,
  segment5Data: 0x1eedfc,
  checksum: 0x1eef0f,
  digest: 0x1eef10,
});

const sha256 = (data) => createHash("sha256").update(data).digest("hex");

export function decodeStage3eAbiHex(text) {
  if (typeof text !== "string" || !/^[0-9a-fA-F\s]+$/u.test(text)) {
    throw new Error("Stage-3E ABI hex contains non-hexadecimal data.");
  }
  const compact = text.replace(/\s+/gu, "");
  if (compact.length % 2 !== 0) throw new Error("Stage-3E ABI hex has an odd nibble count.");
  const abi = Buffer.from(compact, "hex");
  if (abi.length !== STAGE3E_ABI_BYTES || sha256(abi) !== STAGE3E_ABI_SHA256) {
    throw new Error("Stage-3E ABI differs from the machine-verified pinned artifact.");
  }
  return abi;
}

export function buildStage3eAssetBank(frames) {
  if (!Array.isArray(frames) || frames.length !== STAGE3E_ASSET_SPECS.length) {
    throw new Error("Stage-3E requires exactly two sky and eight cat frames.");
  }
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    const spec = STAGE3E_ASSET_SPECS[index];
    if (!Buffer.isBuffer(frame) || frame.length !== spec.bytes || sha256(frame) !== spec.sha256) {
      throw new Error(`Stage-3E asset ${spec.name} differs from its pinned converter output.`);
    }
  }

  const built = buildNativeLvglI8SpriteBank(frames, {
    baseAddress: STAGE3E_ASSET_BANK_VIRTUAL_ADDRESS,
  });
  if (built.bank.length !== STAGE3E_ASSET_BANK_BYTES ||
      sha256(built.bank) !== STAGE3E_ASSET_BANK_SHA256) {
    throw new Error("Stage-3E native descriptor/data bank changed.");
  }
  for (let index = 0; index < built.descriptors.length; index += 1) {
    const descriptor = built.descriptors[index];
    const spec = STAGE3E_ASSET_SPECS[index];
    if (descriptor.descriptorAddress !== STAGE3E_ASSET_BANK_VIRTUAL_ADDRESS + index * 24 ||
        descriptor.width !== spec.width || descriptor.height !== spec.height) {
      throw new Error(`Stage-3E descriptor ${spec.name} changed address or dimensions.`);
    }
  }
  const padded = padSpriteBankForMappedDrom(built.bank);
  if (padded.length !== STAGE3E_DROM_GROWTH_BYTES || sha256(padded) !== STAGE3E_PADDED_BANK_SHA256) {
    throw new Error("Stage-3E DROM bank padding changed.");
  }
  return Object.freeze({ ...built, padded });
}

function assertStage3eLayout(base, final, app, abi, assets) {
  if (base.segmentCount !== 6 || final.segmentCount !== 6) {
    throw new Error("Stage-3E must retain the six-segment image layout.");
  }
  for (let index = 0; index < base.segmentCount; index += 1) {
    const before = base.segments[index];
    const after = final.segments[index];
    if (before.loadAddress !== after.loadAddress) throw new Error(`Segment ${index} load address changed.`);
    const headerShift = index === 0 ? 0 : STAGE3E_DROM_GROWTH_BYTES;
    const codeShift = index > IROM_SEGMENT_INDEX ? abi.length : 0;

    if (index === DROM_SEGMENT_INDEX) {
      const setupRelative = STAGE3C1_SETUP_POINTER_APP_OFFSET - before.dataOffset;
      if (after.headerOffset !== before.headerOffset || after.dataOffset !== before.dataOffset ||
          after.length !== before.length + assets.padded.length ||
          !after.data.subarray(0, setupRelative).equals(before.data.subarray(0, setupRelative)) ||
          !after.data.subarray(setupRelative + 4, before.length).equals(
            before.data.subarray(setupRelative + 4),
          ) ||
          !after.data.subarray(before.length).equals(assets.padded)) {
        throw new Error("Stage-3E DROM is not the one-word-patched C1 prefix plus one asset page.");
      }
    } else if (index === IROM_SEGMENT_INDEX) {
      if (after.headerOffset !== before.headerOffset + headerShift ||
          after.dataOffset !== before.dataOffset + headerShift ||
          after.length !== before.length + abi.length ||
          !after.data.subarray(0, before.length).equals(before.data) ||
          !after.data.subarray(before.length).equals(abi)) {
        throw new Error("Stage-3E IROM is not the exact C1 prefix plus the pinned ABI.");
      }
    } else if (after.headerOffset !== before.headerOffset + headerShift + codeShift ||
               after.dataOffset !== before.dataOffset + headerShift + codeShift ||
               after.length !== before.length || !after.data.equals(before.data)) {
      throw new Error(`Stage-3E segment ${index} did not shift intact.`);
    }
  }

  const drom = final.segments[DROM_SEGMENT_INDEX];
  const irom = final.segments[IROM_SEGMENT_INDEX];
  if (drom.dataOffset + drom.length - assets.padded.length !== STAGE3E_ASSET_BANK_APP_OFFSET ||
      drom.loadAddress + drom.length - assets.padded.length !== STAGE3E_ASSET_BANK_VIRTUAL_ADDRESS ||
      irom.dataOffset + irom.length - abi.length !== STAGE3E_ABI_APP_OFFSET ||
      irom.loadAddress + irom.length - abi.length !== STAGE3E_ABI_VIRTUAL_ADDRESS ||
      irom.length !== EXPECTED_IROM_LENGTH || irom.loadAddress + irom.length !== 0x42117408 ||
      (drom.dataOffset & 0xffff) !== (drom.loadAddress & 0xffff) ||
      (irom.dataOffset & 0xffff) !== (irom.loadAddress & 0xffff)) {
    throw new Error("Stage-3E DROM/IROM append boundaries or MMU congruence changed.");
  }
  const dromSegments = final.segments.filter((segment) =>
    segment.loadAddress >= 0x3c000000 && segment.loadAddress < 0x3e000000);
  const iromSegments = final.segments.filter((segment) =>
    segment.loadAddress >= 0x42000000 && segment.loadAddress < 0x44000000);
  if (dromSegments.length !== 1 || iromSegments.length !== 1) {
    throw new Error("Stage-3E must keep exactly one DROM and one IROM mapping.");
  }
  if (final.segments[4].headerOffset !== EXPECTED_OFFSETS.segment4Header ||
      final.segments[4].dataOffset !== EXPECTED_OFFSETS.segment4Data ||
      final.segments[5].headerOffset !== EXPECTED_OFFSETS.segment5Header ||
      final.segments[5].dataOffset !== EXPECTED_OFFSETS.segment5Data ||
      final.checksumOffset !== EXPECTED_OFFSETS.checksum ||
      final.digestOffset !== EXPECTED_OFFSETS.digest ||
      app.length !== EXPECTED_STAGE3E_APP_BYTES || app.length > STAGE3E_FACTORY_PARTITION_BYTES) {
    throw new Error("Stage-3E shifted segment/footer layout changed.");
  }
}

export function applyStage3eSprite(officialMerged, stage3c1Abi, stage3eAbi, frames) {
  if (!Buffer.isBuffer(stage3eAbi) || stage3eAbi.length !== STAGE3E_ABI_BYTES ||
      sha256(stage3eAbi) !== STAGE3E_ABI_SHA256) {
    throw new Error("Stage-3E ABI differs from the machine-verified artifact.");
  }
  for (const forbidden of [0x4206eae0, 0x3fcab378, 0x42003dc8, 0x3fca4f00, 0x42004f10, 0x4201a930]) {
    const needle = Buffer.alloc(4);
    needle.writeUInt32LE(forbidden);
    if (stage3eAbi.includes(needle)) {
      throw new Error(`Stage-3E ABI references forbidden global value 0x${forbidden.toString(16)}.`);
    }
  }

  const stage3c1Output = applyStage3c1OwnedLabels(officialMerged, stage3c1Abi);
  if (sha256(stage3c1Output.app) !== EXPECTED_STAGE3C1_APP_SHA256 ||
      sha256(stage3c1Output.merged) !== EXPECTED_STAGE3C1_MERGED_SHA256) {
    throw new Error("Stage-3E base is not exact live-tested Stage-3C.1.");
  }
  auditFramerImagePipeline(stage3c1Output.app);
  const assets = buildStage3eAssetBank(frames);
  const base = stage3c1Output.stage3c1;
  const baseIrom = base.segments[IROM_SEGMENT_INDEX];
  const getterRelative = REMAINING_GETTER_LITERAL_APP_OFFSET - baseIrom.dataOffset;
  const keyRelative = STAGE3C1_KEY_CALLBACK_APP_OFFSET - baseIrom.dataOffset;
  if (base.segments[DROM_SEGMENT_INDEX].dataOffset + base.segments[DROM_SEGMENT_INDEX].length !==
        STAGE3E_ASSET_BANK_APP_OFFSET ||
      baseIrom.dataOffset + baseIrom.length + STAGE3E_DROM_GROWTH_BYTES !==
        STAGE3E_ABI_APP_OFFSET ||
      baseIrom.loadAddress + baseIrom.length !== STAGE3E_ABI_VIRTUAL_ADDRESS ||
      stage3c1Output.app.readUInt32LE(REMAINING_GETTER_LITERAL_APP_OFFSET) !== STOCK_REMAINING_GETTER ||
      stage3c1Output.app.readUInt32LE(STAGE3C1_KEY_CALLBACK_APP_OFFSET) !==
        FRAMER_SCREEN_AUDIT.wpmKeyCallbackLiteral.expectedValue ||
      stage3c1Output.app.readUInt32LE(STAGE3C1_WPM_TICK_APP_OFFSET) !==
        FRAMER_SCREEN_AUDIT.wpmTickVtablePointer.expectedValue) {
    throw new Error("Stage-3E C1 append boundaries or stock hooks changed.");
  }

  let app = extendEsp32AppSegment(stage3c1Output.app, {
    segmentIndex: DROM_SEGMENT_INDEX,
    data: assets.padded,
  });
  app = extendEsp32AppSegment(app, { segmentIndex: IROM_SEGMENT_INDEX, data: stage3eAbi });
  app.writeUInt32LE(STAGE3E_SETUP_WRAPPER_VIRTUAL_ADDRESS, STAGE3C1_SETUP_POINTER_APP_OFFSET);
  app = repairEsp32AppIntegrity(app);
  const stage3e = inspectEsp32AppImage(app);
  assertStage3eLayout(base, stage3e, app, stage3eAbi, assets);

  const finalIrom = stage3e.segments[IROM_SEGMENT_INDEX];
  const finalGetterOffset = finalIrom.dataOffset + getterRelative;
  const finalKeyOffset = finalIrom.dataOffset + keyRelative;
  if (app.readUInt32LE(STAGE3C1_SETUP_POINTER_APP_OFFSET) !== STAGE3E_SETUP_WRAPPER_VIRTUAL_ADDRESS ||
      app.readUInt32LE(finalGetterOffset) !== STOCK_REMAINING_GETTER ||
      app.readUInt32LE(finalKeyOffset) !== FRAMER_SCREEN_AUDIT.wpmKeyCallbackLiteral.expectedValue ||
      app.readUInt32LE(STAGE3C1_WPM_TICK_APP_OFFSET) !==
        FRAMER_SCREEN_AUDIT.wpmTickVtablePointer.expectedValue ||
      !app.subarray(STAGE3E_ASSET_BANK_APP_OFFSET,
        STAGE3E_ASSET_BANK_APP_OFFSET + assets.bank.length).equals(assets.bank) ||
      !app.subarray(STAGE3E_ABI_APP_OFFSET,
        STAGE3E_ABI_APP_OFFSET + stage3eAbi.length).equals(stage3eAbi)) {
    throw new Error("Stage-3E final hook, stock callback, or append payload changed.");
  }

  const merged = Buffer.concat([officialMerged.subarray(0, APP_FLASH_OFFSET), app]);
  if (merged.length !== EXPECTED_STAGE3E_MERGED_BYTES) {
    throw new Error("Stage-3E merged byte count changed.");
  }
  if (stage3e.storedChecksum !== EXPECTED_STAGE3E_CHECKSUM ||
      stage3e.storedDigest?.toString("hex") !== EXPECTED_STAGE3E_DIGEST ||
      sha256(app) !== EXPECTED_STAGE3E_APP_SHA256 || sha256(merged) !== EXPECTED_STAGE3E_MERGED_SHA256) {
    throw new Error("Stage-3E deterministic output integrity changed.");
  }
  return { app, merged, stage3c1: base, stage3e, assets, finalGetterOffset, finalKeyOffset };
}

export async function buildStage3e({ root } = {}) {
  const projectRoot = root ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const assetDirectory = path.join(projectRoot, "framer-widgets/assets/device-lvgl-v1");
  const [official, stage3c1Hex, stage3eHex, ...frames] = await Promise.all([
    readFile(path.join(projectRoot, "artifacts/firmware/firmware_0.4.1_merged.bin")),
    readFile(path.join(projectRoot, "custom-firmware/experimental/stage3c1-wpm-labels.hex"), "utf8"),
    readFile(path.join(projectRoot, "custom-firmware/experimental/stage3e-wpm-sprite.hex"), "utf8"),
    ...STAGE3E_ASSET_SPECS.map((spec) => readFile(path.join(assetDirectory, `${spec.name}.lvgl.bin`))),
  ]);
  const stage3c1Abi = decodeStage3c1AbiHex(stage3c1Hex);
  const stage3eAbi = decodeStage3eAbiHex(stage3eHex);
  const output = applyStage3eSprite(official, stage3c1Abi, stage3eAbi, frames);
  const outputDirectory = path.join(projectRoot, "custom-firmware/build");
  const appName = "framer-0.4.1-stage3e-wpm-sprite-app.bin";
  const mergedName = "framer-0.4.1-stage3e-wpm-sprite-merged.bin";
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(path.join(outputDirectory, appName), output.app);
  await writeFile(path.join(outputDirectory, mergedName), output.merged);

  const manifest = {
    format: "framer-f1-stage3e-native-wpm-sprite-v1",
    purpose: "Add a selectable screen-owned blue WPM cat over a twinkling 100x100 night sky.",
    target: "Framer F1 / knob_f1",
    baseFirmware: "Exact live-tested Stage-3C.1 reconstructed from official Framer 0.4.1.",
    behavior: {
      screenId: STAGE3E_SCREEN_ID,
      drawOrder: ["100x100 sky", "68x56 centered blue cat", "top WPM", "bottom A/H/L"],
      catFrames: ["ready", "curious", "happy", "zooming", "fire", "tired", "waiting", "sleeping"],
      activity: "No global key hook. A rising stock WPM float resets the UI-owned idle counter.",
      timing: { sampleMs: 500, skyTwinkleMs: 1000, waitingMs: 5000, sleepingMs: 30000 },
      analytics: "Zoom means mature current WPM is at least 90% of session high; fire celebrates a mature new high for three samples.",
      labels: "Changed text is re-centered; unchanged WPM, A/H/L, and color-band calls are cached.",
    },
    patches: {
      setupPointer: { appOffset: STAGE3C1_SETUP_POINTER_APP_OFFSET, to: "0x42116fcc" },
      stockKeyCallback: { appOffset: output.finalKeyOffset, value: "0x4206eae0", unchanged: true },
      stockTimerGetter: { appOffset: output.finalGetterOffset, value: `0x${STOCK_REMAINING_GETTER.toString(16)}`, unchanged: true },
      nativeWpmTick: "unchanged",
      globalBubble: "not referenced",
    },
    assets: {
      sourceManifest: "framer-widgets/assets/device-lvgl-v1/manifest.json",
      descriptorOrder: STAGE3E_ASSET_SPECS.map((spec) => spec.name),
      dromAppOffset: STAGE3E_ASSET_BANK_APP_OFFSET,
      dromVirtualAddress: "0x3c1c1190",
      bankBytes: output.assets.bank.length,
      bankSha256: sha256(output.assets.bank),
      paddedBytes: output.assets.padded.length,
      paddedSha256: sha256(output.assets.padded),
    },
    code: {
      source: "custom-firmware/experimental/stage3e-wpm-sprite.S",
      linker: "custom-firmware/experimental/stage3e-wpm-sprite.ld",
      pinnedHex: "custom-firmware/experimental/stage3e-wpm-sprite.hex",
      appOffset: STAGE3E_ABI_APP_OFFSET,
      virtualAddress: "0x42116f10",
      bytes: stage3eAbi.length,
      sha256: sha256(stage3eAbi),
      executableFormat: "elf32-xtensa-le",
      finalLinkRelocations: 0,
    },
    layout: {
      segments: output.stage3e.segmentCount,
      dromBytes: output.stage3e.segments[DROM_SEGMENT_INDEX].length,
      dromEndVirtualAddress: `0x${(output.stage3e.segments[0].loadAddress + output.stage3e.segments[0].length).toString(16)}`,
      iromBytes: output.stage3e.segments[IROM_SEGMENT_INDEX].length,
      iromEndVirtualAddress: `0x${(output.stage3e.segments[3].loadAddress + output.stage3e.segments[3].length).toString(16)}`,
      checksumAppOffset: output.stage3e.checksumOffset,
      digestAppOffset: output.stage3e.digestOffset,
      factoryPartitionHeadroom: STAGE3E_FACTORY_PARTITION_BYTES - output.app.length,
    },
    outputs: {
      app: { file: appName, bytes: output.app.length, sha256: sha256(output.app) },
      merged: { file: mergedName, bytes: output.merged.length, sha256: sha256(output.merged) },
    },
    rollback: {
      image: "framer-0.4.1-stage3c1-wpm-owned-labels-app.bin",
      flashOffset: "0x10000",
      sha256: EXPECTED_STAGE3C1_APP_SHA256,
      behavior: "Live-proven native WPM title/value screen with stock key callback.",
    },
    safety: [
      "The exact live Stage-3C.1 image is rebuilt and hash-checked before mutation.",
      "One 64-KiB DROM page is appended; the existing IROM is extended in place; segment count stays six.",
      "DROM and IROM physical offsets remain congruent with their virtual addresses modulo 64 KiB.",
      "The Stage-3D wrong manager/key hook is absent; the stock key callback remains untouched.",
      "All image children and labels belong to the screen root and use the stock unload lifecycle.",
      "Only the factory app partition may be written; bootloader, NVS, and LittleFS remain untouched.",
    ],
    status: "Offline deterministic build; no hardware was accessed by this builder.",
  };
  await writeFile(path.join(outputDirectory, "stage3e-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  buildStage3e()
    .then((manifest) => console.log(JSON.stringify(manifest, null, 2)))
    .catch((error) => {
      console.error(`Error: ${error.message}`);
      process.exitCode = 1;
    });
}
