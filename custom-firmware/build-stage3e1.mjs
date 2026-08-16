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

export const STAGE3E1_SCREEN_ID = 7;
export const STAGE3E1_ABI_APP_OFFSET = 0x1e6f10;
export const STAGE3E1_ABI_VIRTUAL_ADDRESS = 0x42116f10;
export const STAGE3E1_ABI_BYTES = 0x500;
export const STAGE3E1_ABI_SHA256 = "6842f6246ed40c0e5ddbcdc105b64e74126e7b86735c312d8c6c487b6418b05e";
export const STAGE3E1_SETUP_WRAPPER_VIRTUAL_ADDRESS = 0x42116fcc;
export const STAGE3E1_ASSET_BANK_APP_OFFSET = 0x0a1190;
export const STAGE3E1_ASSET_BANK_VIRTUAL_ADDRESS = 0x3c1c1190;
export const STAGE3E1_ASSET_BANK_BYTES = 102_944;
export const STAGE3E1_DROM_GROWTH_BYTES = 0x20000;
export const STAGE3E1_FACTORY_PARTITION_BYTES = 0x800000;

export const STAGE3E1_ASSET_SPECS = Object.freeze([
  ["sky-0", "54b814b12a0d79f803daff3a860ae15d614e05668b9d9d1fa48f2b8828297e8a", 100, 310, 32036],
  ["sky-1", "88fc66779070eef0bac40c92eb39c01adf6ae1a38330183ff42f040938a8bf93", 100, 310, 32036],
  ["cat-0", "fd16f2f1b7466a51c047ae7258795677ad7713f5104c6e5d15be21bb3261b397", 68, 56, 4844],
  ["cat-1", "3951cf38a34057dd2493100f07b0b1af3381f931d3fb4406b69b7d61f4d4ea7c", 68, 56, 4844],
  ["cat-2", "fb49fb4599491f58ae428dc7de6155625180d30694773cfac9ec417f3c922867", 68, 56, 4844],
  ["cat-3", "f8926e00eb8697cbd8bbfb6857e6d92ebe2cb7ebdad9e1dc739145e3371e6e78", 68, 56, 4844],
  ["cat-4", "4d1a35dc108e76fcf1c1a3169f0304606c9c1039db71c995ed3ce38909aea095", 68, 56, 4844],
  ["cat-5", "aca858fc895d3a66a4e9d3711db3f9d7a008804f40dae83cd1dca9e6748ca78c", 68, 56, 4844],
  ["cat-6", "fc83555569a67b8c827fb0baf6948553e4d1023d061e13c2fe4e42539c023aba", 68, 56, 4844],
  ["cat-7", "5b24676867cac7a8e8ea18c7b01f69e171321f2f54f89bb7d9e851cdb5a61dab", 68, 56, 4844],
].map(([name, sha256, width, height, bytes]) => Object.freeze({ name, sha256, width, height, bytes })));

export const STAGE3E1_ASSET_BANK_SHA256 = "e627332b347aebb736d6605aa5c7a176077ad5016b615cf148608d62cebba890";
export const STAGE3E1_PADDED_BANK_SHA256 = "e8b37c53dfeb68ca9e2035c391fb2909791970dcbab9eec67eb0b00941da4efe";

export const EXPECTED_STAGE3E1_CHECKSUM = 0x66;
export const EXPECTED_STAGE3E1_DIGEST = "98af4d78e8f77cd6508b6dd87c6238d45cdfe15445f7a67e81eb4b001d0e7995";
export const EXPECTED_STAGE3E1_APP_SHA256 = "cf645558f576df17e66db14ec8636a507004f1679515dc935965cf2d55ca9b04";
export const EXPECTED_STAGE3E1_MERGED_SHA256 = "787fdf452cb5b782fac13f198a820ac6aa021d82a4b61cb8e34c8bdd3dbea7b7";
export const EXPECTED_STAGE3E1_APP_BYTES = 2_092_848;
export const EXPECTED_STAGE3E1_MERGED_BYTES = 2_158_384;

const DROM_SEGMENT_INDEX = 0;
const IROM_SEGMENT_INDEX = 3;
const EXPECTED_IROM_LENGTH = 0x1173f0;
const EXPECTED_OFFSETS = Object.freeze({
  segment4Header: 0x1e7410,
  segment4Data: 0x1e7418,
  segment5Header: 0x1fedfc,
  segment5Data: 0x1fee04,
  checksum: 0x1fef0f,
  digest: 0x1fef10,
});

const sha256 = (data) => createHash("sha256").update(data).digest("hex");

export function decodeStage3e1AbiHex(text) {
  if (typeof text !== "string" || !/^[0-9a-fA-F\s]+$/u.test(text)) {
    throw new Error("Stage-3E.1 ABI hex contains non-hexadecimal data.");
  }
  const compact = text.replace(/\s+/gu, "");
  if (compact.length % 2 !== 0) throw new Error("Stage-3E.1 ABI hex has an odd nibble count.");
  const abi = Buffer.from(compact, "hex");
  if (abi.length !== STAGE3E1_ABI_BYTES || sha256(abi) !== STAGE3E1_ABI_SHA256) {
    throw new Error("Stage-3E.1 ABI differs from the machine-verified pinned artifact.");
  }
  return abi;
}

export function buildStage3e1AssetBank(frames) {
  if (!Array.isArray(frames) || frames.length !== STAGE3E1_ASSET_SPECS.length) {
    throw new Error("Stage-3E.1 requires exactly two sky and eight cat frames.");
  }
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    const spec = STAGE3E1_ASSET_SPECS[index];
    if (!Buffer.isBuffer(frame) || frame.length !== spec.bytes || sha256(frame) !== spec.sha256) {
      throw new Error(`Stage-3E.1 asset ${spec.name} differs from its pinned converter output.`);
    }
  }

  const built = buildNativeLvglI8SpriteBank(frames, {
    baseAddress: STAGE3E1_ASSET_BANK_VIRTUAL_ADDRESS,
  });
  if (built.bank.length !== STAGE3E1_ASSET_BANK_BYTES ||
      sha256(built.bank) !== STAGE3E1_ASSET_BANK_SHA256) {
    throw new Error("Stage-3E.1 native descriptor/data bank changed.");
  }
  for (let index = 0; index < built.descriptors.length; index += 1) {
    const descriptor = built.descriptors[index];
    const spec = STAGE3E1_ASSET_SPECS[index];
    if (descriptor.descriptorAddress !== STAGE3E1_ASSET_BANK_VIRTUAL_ADDRESS + index * 24 ||
        descriptor.width !== spec.width || descriptor.height !== spec.height) {
      throw new Error(`Stage-3E.1 descriptor ${spec.name} changed address or dimensions.`);
    }
  }
  const padded = padSpriteBankForMappedDrom(built.bank);
  if (padded.length !== STAGE3E1_DROM_GROWTH_BYTES || sha256(padded) !== STAGE3E1_PADDED_BANK_SHA256) {
    throw new Error("Stage-3E.1 DROM bank padding changed.");
  }
  return Object.freeze({ ...built, padded });
}

function assertStage3e1Layout(base, final, app, abi, assets) {
  if (base.segmentCount !== 6 || final.segmentCount !== 6) {
    throw new Error("Stage-3E.1 must retain the six-segment image layout.");
  }
  for (let index = 0; index < base.segmentCount; index += 1) {
    const before = base.segments[index];
    const after = final.segments[index];
    if (before.loadAddress !== after.loadAddress) throw new Error(`Segment ${index} load address changed.`);
    const headerShift = index === 0 ? 0 : STAGE3E1_DROM_GROWTH_BYTES;
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
        throw new Error("Stage-3E.1 DROM is not the one-word-patched C1 prefix plus two asset pages.");
      }
    } else if (index === IROM_SEGMENT_INDEX) {
      if (after.headerOffset !== before.headerOffset + headerShift ||
          after.dataOffset !== before.dataOffset + headerShift ||
          after.length !== before.length + abi.length ||
          !after.data.subarray(0, before.length).equals(before.data) ||
          !after.data.subarray(before.length).equals(abi)) {
        throw new Error("Stage-3E.1 IROM is not the exact C1 prefix plus the pinned ABI.");
      }
    } else if (after.headerOffset !== before.headerOffset + headerShift + codeShift ||
               after.dataOffset !== before.dataOffset + headerShift + codeShift ||
               after.length !== before.length || !after.data.equals(before.data)) {
      throw new Error(`Stage-3E.1 segment ${index} did not shift intact.`);
    }
  }

  const drom = final.segments[DROM_SEGMENT_INDEX];
  const irom = final.segments[IROM_SEGMENT_INDEX];
  if (drom.dataOffset + drom.length - assets.padded.length !== STAGE3E1_ASSET_BANK_APP_OFFSET ||
      drom.loadAddress + drom.length - assets.padded.length !== STAGE3E1_ASSET_BANK_VIRTUAL_ADDRESS ||
      irom.dataOffset + irom.length - abi.length !== STAGE3E1_ABI_APP_OFFSET ||
      irom.loadAddress + irom.length - abi.length !== STAGE3E1_ABI_VIRTUAL_ADDRESS ||
      irom.length !== EXPECTED_IROM_LENGTH || irom.loadAddress + irom.length !== 0x42117410 ||
      (drom.dataOffset & 0xffff) !== (drom.loadAddress & 0xffff) ||
      (irom.dataOffset & 0xffff) !== (irom.loadAddress & 0xffff)) {
    throw new Error("Stage-3E.1 DROM/IROM append boundaries or MMU congruence changed.");
  }
  const dromSegments = final.segments.filter((segment) =>
    segment.loadAddress >= 0x3c000000 && segment.loadAddress < 0x3e000000);
  const iromSegments = final.segments.filter((segment) =>
    segment.loadAddress >= 0x42000000 && segment.loadAddress < 0x44000000);
  if (dromSegments.length !== 1 || iromSegments.length !== 1) {
    throw new Error("Stage-3E.1 must keep exactly one DROM and one IROM mapping.");
  }
  if (final.segments[4].headerOffset !== EXPECTED_OFFSETS.segment4Header ||
      final.segments[4].dataOffset !== EXPECTED_OFFSETS.segment4Data ||
      final.segments[5].headerOffset !== EXPECTED_OFFSETS.segment5Header ||
      final.segments[5].dataOffset !== EXPECTED_OFFSETS.segment5Data ||
      final.checksumOffset !== EXPECTED_OFFSETS.checksum ||
      final.digestOffset !== EXPECTED_OFFSETS.digest ||
      app.length !== EXPECTED_STAGE3E1_APP_BYTES || app.length > STAGE3E1_FACTORY_PARTITION_BYTES) {
    throw new Error("Stage-3E.1 shifted segment/footer layout changed.");
  }
}

export function applyStage3e1FullCanvas(officialMerged, stage3c1Abi, stage3eAbi, frames) {
  if (!Buffer.isBuffer(stage3eAbi) || stage3eAbi.length !== STAGE3E1_ABI_BYTES ||
      sha256(stage3eAbi) !== STAGE3E1_ABI_SHA256) {
    throw new Error("Stage-3E.1 ABI differs from the machine-verified artifact.");
  }
  for (const forbidden of [0x4206eae0, 0x3fcab378, 0x42003dc8, 0x3fca4f00, 0x42004f10, 0x4201a930]) {
    const needle = Buffer.alloc(4);
    needle.writeUInt32LE(forbidden);
    if (stage3eAbi.includes(needle)) {
      throw new Error(`Stage-3E.1 ABI references forbidden global value 0x${forbidden.toString(16)}.`);
    }
  }

  const stage3c1Output = applyStage3c1OwnedLabels(officialMerged, stage3c1Abi);
  if (sha256(stage3c1Output.app) !== EXPECTED_STAGE3C1_APP_SHA256 ||
      sha256(stage3c1Output.merged) !== EXPECTED_STAGE3C1_MERGED_SHA256) {
    throw new Error("Stage-3E.1 base is not exact live-tested Stage-3C.1.");
  }
  auditFramerImagePipeline(stage3c1Output.app);
  const assets = buildStage3e1AssetBank(frames);
  const base = stage3c1Output.stage3c1;
  const baseIrom = base.segments[IROM_SEGMENT_INDEX];
  const getterRelative = REMAINING_GETTER_LITERAL_APP_OFFSET - baseIrom.dataOffset;
  const keyRelative = STAGE3C1_KEY_CALLBACK_APP_OFFSET - baseIrom.dataOffset;
  if (base.segments[DROM_SEGMENT_INDEX].dataOffset + base.segments[DROM_SEGMENT_INDEX].length !==
        STAGE3E1_ASSET_BANK_APP_OFFSET ||
      baseIrom.dataOffset + baseIrom.length + STAGE3E1_DROM_GROWTH_BYTES !==
        STAGE3E1_ABI_APP_OFFSET ||
      baseIrom.loadAddress + baseIrom.length !== STAGE3E1_ABI_VIRTUAL_ADDRESS ||
      stage3c1Output.app.readUInt32LE(REMAINING_GETTER_LITERAL_APP_OFFSET) !== STOCK_REMAINING_GETTER ||
      stage3c1Output.app.readUInt32LE(STAGE3C1_KEY_CALLBACK_APP_OFFSET) !==
        FRAMER_SCREEN_AUDIT.wpmKeyCallbackLiteral.expectedValue ||
      stage3c1Output.app.readUInt32LE(STAGE3C1_WPM_TICK_APP_OFFSET) !==
        FRAMER_SCREEN_AUDIT.wpmTickVtablePointer.expectedValue) {
    throw new Error("Stage-3E.1 C1 append boundaries or stock hooks changed.");
  }

  let app = extendEsp32AppSegment(stage3c1Output.app, {
    segmentIndex: DROM_SEGMENT_INDEX,
    data: assets.padded,
  });
  app = extendEsp32AppSegment(app, { segmentIndex: IROM_SEGMENT_INDEX, data: stage3eAbi });
  app.writeUInt32LE(STAGE3E1_SETUP_WRAPPER_VIRTUAL_ADDRESS, STAGE3C1_SETUP_POINTER_APP_OFFSET);
  app = repairEsp32AppIntegrity(app);
  const stage3e1 = inspectEsp32AppImage(app);
  assertStage3e1Layout(base, stage3e1, app, stage3eAbi, assets);

  const finalIrom = stage3e1.segments[IROM_SEGMENT_INDEX];
  const finalGetterOffset = finalIrom.dataOffset + getterRelative;
  const finalKeyOffset = finalIrom.dataOffset + keyRelative;
  if (app.readUInt32LE(STAGE3C1_SETUP_POINTER_APP_OFFSET) !== STAGE3E1_SETUP_WRAPPER_VIRTUAL_ADDRESS ||
      app.readUInt32LE(finalGetterOffset) !== STOCK_REMAINING_GETTER ||
      app.readUInt32LE(finalKeyOffset) !== FRAMER_SCREEN_AUDIT.wpmKeyCallbackLiteral.expectedValue ||
      app.readUInt32LE(STAGE3C1_WPM_TICK_APP_OFFSET) !==
        FRAMER_SCREEN_AUDIT.wpmTickVtablePointer.expectedValue ||
      !app.subarray(STAGE3E1_ASSET_BANK_APP_OFFSET,
        STAGE3E1_ASSET_BANK_APP_OFFSET + assets.bank.length).equals(assets.bank) ||
      !app.subarray(STAGE3E1_ABI_APP_OFFSET,
        STAGE3E1_ABI_APP_OFFSET + stage3eAbi.length).equals(stage3eAbi)) {
    throw new Error("Stage-3E.1 final hook, stock callback, or append payload changed.");
  }

  const merged = Buffer.concat([officialMerged.subarray(0, APP_FLASH_OFFSET), app]);
  if (merged.length !== EXPECTED_STAGE3E1_MERGED_BYTES) {
    throw new Error("Stage-3E.1 merged byte count changed.");
  }
  if (stage3e1.storedChecksum !== EXPECTED_STAGE3E1_CHECKSUM ||
      stage3e1.storedDigest?.toString("hex") !== EXPECTED_STAGE3E1_DIGEST ||
      sha256(app) !== EXPECTED_STAGE3E1_APP_SHA256 || sha256(merged) !== EXPECTED_STAGE3E1_MERGED_SHA256) {
    throw new Error("Stage-3E.1 deterministic output integrity changed.");
  }
  return { app, merged, stage3c1: base, stage3e1, assets, finalGetterOffset, finalKeyOffset };
}

export async function buildStage3e1({ root } = {}) {
  const projectRoot = root ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const assetDirectory = path.join(projectRoot, "framer-widgets/assets/device-lvgl-v2-full");
  const [official, stage3c1Hex, stage3eHex, ...frames] = await Promise.all([
    readFile(path.join(projectRoot, "artifacts/firmware/firmware_0.4.1_merged.bin")),
    readFile(path.join(projectRoot, "custom-firmware/experimental/stage3c1-wpm-labels.hex"), "utf8"),
    readFile(path.join(projectRoot, "custom-firmware/experimental/stage3e1-wpm-full-canvas.hex"), "utf8"),
    ...STAGE3E1_ASSET_SPECS.map((spec) => readFile(path.join(assetDirectory, `${spec.name}.lvgl.bin`))),
  ]);
  const stage3c1Abi = decodeStage3c1AbiHex(stage3c1Hex);
  const stage3eAbi = decodeStage3e1AbiHex(stage3eHex);
  const output = applyStage3e1FullCanvas(official, stage3c1Abi, stage3eAbi, frames);
  const outputDirectory = path.join(projectRoot, "custom-firmware/build");
  const appName = "framer-0.4.1-stage3e1-wpm-full-canvas-app.bin";
  const mergedName = "framer-0.4.1-stage3e1-wpm-full-canvas-merged.bin";
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(path.join(outputDirectory, appName), output.app);
  await writeFile(path.join(outputDirectory, mergedName), output.merged);

  const manifest = {
    format: "framer-f1-stage3e1-native-wpm-sprite-v1",
    purpose: "Fill the F1 logical 100x310 canvas with a twinkling sky while retaining the centered WPM pet.",
    target: "Framer F1 / knob_f1",
    baseFirmware: "Exact live-tested Stage-3C.1 reconstructed from official Framer 0.4.1.",
    behavior: {
      screenId: STAGE3E1_SCREEN_ID,
      drawOrder: ["100x310 sky", "68x56 centered blue cat", "TOP_MID WPM", "BOTTOM_MID Avg/Top"],
      catFrames: ["ready", "curious", "happy", "zooming", "fire", "tired", "waiting", "sleeping"],
      activity: "No global key hook. A rising stock WPM float resets the UI-owned idle counter.",
      timing: { sampleMs: 500, skyTwinkleMs: 1000, waitingMs: 5000, sleepingMs: 30000 },
      analytics: "Zoom means mature current WPM is at least 90% of session high; fire celebrates a mature new high for three samples.",
      labels: "Changed text is re-aligned; bottom label is exactly two lines: Avg and Top. Low remains internal only.",
    },
    patches: {
      setupPointer: { appOffset: STAGE3C1_SETUP_POINTER_APP_OFFSET, to: "0x42116fcc" },
      stockKeyCallback: { appOffset: output.finalKeyOffset, value: "0x4206eae0", unchanged: true },
      stockTimerGetter: { appOffset: output.finalGetterOffset, value: `0x${STOCK_REMAINING_GETTER.toString(16)}`, unchanged: true },
      nativeWpmTick: "unchanged",
      globalBubble: "not referenced",
    },
    assets: {
      sourceManifest: "framer-widgets/assets/device-lvgl-v2-full/manifest.json",
      descriptorOrder: STAGE3E1_ASSET_SPECS.map((spec) => spec.name),
      dromAppOffset: STAGE3E1_ASSET_BANK_APP_OFFSET,
      dromVirtualAddress: "0x3c1c1190",
      bankBytes: output.assets.bank.length,
      bankSha256: sha256(output.assets.bank),
      paddedBytes: output.assets.padded.length,
      paddedSha256: sha256(output.assets.padded),
    },
    code: {
      source: "custom-firmware/experimental/stage3e1-wpm-full-canvas.S",
      linker: "custom-firmware/experimental/stage3e1-wpm-full-canvas.ld",
      pinnedHex: "custom-firmware/experimental/stage3e1-wpm-full-canvas.hex",
      appOffset: STAGE3E1_ABI_APP_OFFSET,
      virtualAddress: "0x42116f10",
      bytes: stage3eAbi.length,
      sha256: sha256(stage3eAbi),
      executableFormat: "elf32-xtensa-le",
      finalLinkRelocations: 0,
    },
    layout: {
      segments: output.stage3e1.segmentCount,
      dromBytes: output.stage3e1.segments[DROM_SEGMENT_INDEX].length,
      dromEndVirtualAddress: `0x${(output.stage3e1.segments[0].loadAddress + output.stage3e1.segments[0].length).toString(16)}`,
      iromBytes: output.stage3e1.segments[IROM_SEGMENT_INDEX].length,
      iromEndVirtualAddress: `0x${(output.stage3e1.segments[3].loadAddress + output.stage3e1.segments[3].length).toString(16)}`,
      checksumAppOffset: output.stage3e1.checksumOffset,
      digestAppOffset: output.stage3e1.digestOffset,
      factoryPartitionHeadroom: STAGE3E1_FACTORY_PARTITION_BYTES - output.app.length,
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
      "Two 64-KiB DROM pages are appended; the existing IROM is extended in place; segment count stays six.",
      "DROM and IROM physical offsets remain congruent with their virtual addresses modulo 64 KiB.",
      "The Stage-3D wrong manager/key hook is absent; the stock key callback remains untouched.",
      "All image children and labels belong to the screen root and use the stock unload lifecycle.",
      "Only the factory app partition may be written; bootloader, NVS, and LittleFS remain untouched.",
    ],
    status: "Offline deterministic build; no hardware was accessed by this builder.",
  };
  await writeFile(path.join(outputDirectory, "stage3e1-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  buildStage3e1()
    .then((manifest) => console.log(JSON.stringify(manifest, null, 2)))
    .catch((error) => {
      console.error(`Error: ${error.message}`);
      process.exitCode = 1;
    });
}
