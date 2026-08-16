#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { APP_FLASH_OFFSET } from "./build-stage1.mjs";
import { REMAINING_GETTER_LITERAL_APP_OFFSET, STOCK_REMAINING_GETTER } from "./build-stage3b.mjs";
import {
  STAGE3C1_KEY_CALLBACK_APP_OFFSET,
  STAGE3C1_SETUP_POINTER_APP_OFFSET,
  STAGE3C1_WPM_TICK_APP_OFFSET,
} from "./build-stage3c1.mjs";
import {
  EXPECTED_STAGE3E3A_APP_SHA256,
  STAGE3E3A_ABI_BYTES,
  STAGE3E3A_DROM_GROWTH_BYTES,
} from "./build-stage3e3a.mjs";
import { extendEsp32AppSegment, inspectEsp32AppImage, repairEsp32AppIntegrity } from "./lib/esp-app-image.mjs";
import {
  FRAMER_RUNTIME_ASSET_BOUNDARY,
  auditRuntimeAssetBoundary,
  buildNativeLvglIndexedBank,
  parseSerializedLvglIndexed,
} from "./lib/framer-lvgl-indexed.mjs";
import { FRAMER_SCREEN_AUDIT } from "./lib/framer-registry-audit.mjs";

export const STAGE3E34_SCREEN_ID = 7;
export const STAGE3E34_ABI_APP_OFFSET = 0x1d6f10;
export const STAGE3E34_ABI_VIRTUAL_ADDRESS = 0x42116f10;
export const STAGE3E34_ABI_BYTES = 0x7c8;
export const STAGE3E34_ABI_SHA256 = "c0d7293146f1a6e5b7869895dfaa278c952485a8400a2b54244b82a9058bc846";
export const STAGE3E34_SETUP_WRAPPER_VIRTUAL_ADDRESS = 0x42116ffc;
export const STAGE3E34_REGISTER_WPM_VIRTUAL_ADDRESS = 0x4211702c;
export const STAGE3E34_ASSET_BANK_APP_OFFSET = 0x0a1190;
export const STAGE3E34_ASSET_BANK_VIRTUAL_ADDRESS = 0x3c1c1190;
export const STAGE3E34_FULL_TABLE_VIRTUAL_ADDRESS = 0x3c1c162c;
export const STAGE3E34_ASSET_MANIFEST_SHA256 = "6efbc3683ea7e8bcf10f27d9c30367531bcb4d418717849609fce27bf1ae46f3";
export const STAGE3E34_CANARY_SERIALIZED_SHA256 = "0ad586b3a5002fee3cb16498045ead72cae8c8e7befc18133d750f815034fc03";
export const STAGE3E34_CANARY_BANK_BYTES = 1180;
export const STAGE3E34_CANARY_BANK_SHA256 = "f651cf38ee0dc567b2240d61b263ecd4e525f68b34549780a897b370c111aff1";
export const STAGE3E34_FULL_BANK_BYTES = 56_640;
export const STAGE3E34_FULL_BANK_SOURCE_SHA256 = "b9f38b8d3fd14cd8477230651e871a3c37fe558abaa3720436d2a4e80a06e6ad";
export const STAGE3E34_ASSET_BANK_BYTES = 57_820;
export const STAGE3E34_ASSET_BANK_SHA256 = "1a9c47f4fb8907cc69ed6adee012902d2d0e155d00c806a9539ee184bc1e1693";
export const STAGE3E34_DROM_GROWTH_BYTES = 0x10000;
export const STAGE3E34_PADDED_BANK_SHA256 = "c49880fdc1fa2f8d34fa08d989c09d8e23b9546243b0db32bb8f1bca8741fee5";
export const STAGE3E34_FACTORY_PARTITION_BYTES = 0x800000;

export const EXPECTED_STAGE3E34_APP_BYTES = 2_028_032;
export const EXPECTED_STAGE3E34_MERGED_BYTES = 2_093_568;
export const EXPECTED_STAGE3E34_APP_SHA256 = "0e20b00b046f34750e19141ea5b9cede2debc0e04f59038432b508eb4a8df5a6";
export const EXPECTED_STAGE3E34_MERGED_SHA256 = "92da34ad71f16d71fb9a15e72a3fb89820f92e3448f1e9767642a4b0a5de427e";
export const EXPECTED_STAGE3E34_CHECKSUM = 0x70;
export const EXPECTED_STAGE3E34_DIGEST = "d21d92cd1e63f3ebc7d80ac4d5fbffdddcf45eba16966bc9581413eef4f377c6";

const DROM = 0;
const IROM = 3;
const E3A_STOCK_PREFIX_BYTES = 0xa1170;
const FINAL_IROM_BYTES = 0x1176b8;
const FINAL_IROM_END = 0x421176d8;
const sha256 = (data) => createHash("sha256").update(data).digest("hex");

export function decodeStage3e3AbiHex(text) {
  if (typeof text !== "string" || !/^[0-9a-fA-F\s]+$/u.test(text)) throw new Error("Stage-3E.3.4 ABI hex is invalid.");
  const abi = Buffer.from(text.replace(/\s+/gu, ""), "hex");
  if (abi.length !== STAGE3E34_ABI_BYTES || sha256(abi) !== STAGE3E34_ABI_SHA256) {
    throw new Error("Stage-3E.3.4 ABI differs from the S3-LE relocation-free pinned artifact.");
  }
  return abi;
}

export function parseStage3e3AssetManifest(bytes) {
  if (!Buffer.isBuffer(bytes) || sha256(bytes) !== STAGE3E34_ASSET_MANIFEST_SHA256) {
    throw new Error("Stage-3E.3.4 converted-asset manifest changed.");
  }
  const manifest = JSON.parse(bytes.toString("utf8"));
  if (manifest.format !== "framer-f1-wpm-pet-lvgl-assets-v5-i4-six-species" ||
      !Array.isArray(manifest.frames) || manifest.frames.length !== 48 ||
      manifest.nativeBank?.sha256 !== STAGE3E34_FULL_BANK_SOURCE_SHA256 ||
      manifest.nativeBank?.bytes !== STAGE3E34_FULL_BANK_BYTES) {
    throw new Error("Stage-3E.3.4 asset manifest contract changed.");
  }
  for (let index = 0; index < manifest.frames.length; index++) {
    const frame = manifest.frames[index];
    const species = Math.floor(index / 8);
    const state = index % 8;
    if (frame.name !== `pet-${species}-${state}` || frame.speciesId !== species || frame.stateId !== state ||
        frame.width !== 52 || frame.height !== 42 || frame.stride !== 26 || frame.bytes !== 1168 ||
        !/^[0-9a-f]{64}$/u.test(frame.lvglSha256)) {
      throw new Error(`Stage-3E.3.4 asset frame ${index} order/shape changed.`);
    }
  }
  return manifest;
}

export function buildStage3e3AssetBank(manifest, frames, canary) {
  if (!manifest || !Array.isArray(frames) || frames.length !== 48 || !Buffer.isBuffer(canary) ||
      sha256(canary) !== STAGE3E34_CANARY_SERIALIZED_SHA256) {
    throw new Error("Stage-3E.3.4 requires exactly six species times eight I4 frames.");
  }
  for (let index = 0; index < frames.length; index++) {
    const frame = frames[index];
    const spec = manifest.frames[index];
    if (!Buffer.isBuffer(frame) || sha256(frame) !== spec.lvglSha256) {
      throw new Error(`Stage-3E.3.4 asset ${spec.name} differs from its pinned converter output.`);
    }
    const parsed = parseSerializedLvglIndexed(frame);
    if (parsed.colorFormat !== 0x09 || parsed.width !== 52 || parsed.height !== 42 || parsed.stride !== 26) {
      throw new Error(`Stage-3E.3.4 asset ${spec.name} is not exact 52x42 LVGL I4.`);
    }
    const alphas = Array.from({ length: 16 }, (_, paletteIndex) => frame[12 + paletteIndex * 4 + 3]);
    if (alphas.some((alpha) => alpha !== 0 && alpha !== 255) || !alphas.includes(0) || !alphas.includes(255)) {
      throw new Error(`Stage-3E.3.4 asset ${spec.name} is not binary-alpha I4.`);
    }
  }
  if (!frames[32].equals(canary)) throw new Error("Stage-3E.3.4 default Cat is not exact live E3A art.");
  const canaryBuilt = buildNativeLvglIndexedBank([canary], { baseAddress: STAGE3E34_ASSET_BANK_VIRTUAL_ADDRESS });
  if (canaryBuilt.bank.length !== STAGE3E34_CANARY_BANK_BYTES ||
      sha256(canaryBuilt.bank) !== STAGE3E34_CANARY_BANK_SHA256 ||
      canaryBuilt.descriptors[0].dataAddress !== 0x3c1c11a8) {
    throw new Error("Stage-3E.3.4 live E3A canary descriptor/payload changed.");
  }
  const built = buildNativeLvglIndexedBank(frames, { baseAddress: STAGE3E34_FULL_TABLE_VIRTUAL_ADDRESS });
  if (built.bank.length !== STAGE3E34_FULL_BANK_BYTES || built.descriptorTableBytes !== 48 * 24) {
    throw new Error("Stage-3E.3.4 native descriptor/data bank changed.");
  }
  for (let index = 0; index < 48; index++) {
    const descriptor = built.descriptors[index];
    if (descriptor.descriptorAddress !== STAGE3E34_FULL_TABLE_VIRTUAL_ADDRESS + index * 24 ||
        descriptor.colorFormat !== 0x09 || descriptor.width !== 52 || descriptor.height !== 42 ||
        descriptor.dataAddress + descriptor.dataBytes > FRAMER_RUNTIME_ASSET_BOUNDARY.originalMappedPageEnd) {
      throw new Error(`Stage-3E.3.4 descriptor ${index} address/format/boundary changed.`);
    }
  }
  const bank = Buffer.concat([canaryBuilt.bank, built.bank]);
  if (bank.length !== STAGE3E34_ASSET_BANK_BYTES || sha256(bank) !== STAGE3E34_ASSET_BANK_SHA256) {
    throw new Error("Stage-3E.3.4 combined fail-visible asset bank changed.");
  }
  const boundary = auditRuntimeAssetBoundary(bank);
  if (boundary.endAddress !== 0x3c1cf36c || boundary.headroom !== 3220) {
    throw new Error("Stage-3E.3.4 runtime asset boundary changed.");
  }
  const padded = Buffer.alloc(STAGE3E34_DROM_GROWTH_BYTES);
  bank.copy(padded);
  if (sha256(padded) !== STAGE3E34_PADDED_BANK_SHA256) {
    throw new Error("Stage-3E.3.4 one-page padding changed.");
  }
  return Object.freeze({ bank, descriptors: built.descriptors, canaryDescriptor: canaryBuilt.descriptors[0],
    descriptorTableBytes: built.descriptorTableBytes, boundary, padded });
}

function assertFinalLayout(base, final, app, abi, assets) {
  if (base.segmentCount !== 6 || final.segmentCount !== 6) throw new Error("Stage-3E.3.4 must retain six segments.");
  const abiGrowth = abi.length - STAGE3E3A_ABI_BYTES;
  for (let index = 0; index < 6; index++) {
    const before = base.segments[index];
    const after = final.segments[index];
    if (before.loadAddress !== after.loadAddress) throw new Error(`Stage-3E.3.4 segment ${index} VA changed.`);
    if (index === DROM) {
      const setup = STAGE3C1_SETUP_POINTER_APP_OFFSET - before.dataOffset;
      if (after.length !== before.length ||
          !after.data.subarray(0, setup).equals(before.data.subarray(0, setup)) ||
          !after.data.subarray(setup + 4, E3A_STOCK_PREFIX_BYTES).equals(before.data.subarray(setup + 4, E3A_STOCK_PREFIX_BYTES)) ||
          !after.data.subarray(E3A_STOCK_PREFIX_BYTES).equals(assets.padded)) {
        throw new Error("Stage-3E.3.4 DROM is not exact E3A with one setup word and its asset page replaced.");
      }
    } else if (index === IROM) {
      const stockBytes = before.length - STAGE3E3A_ABI_BYTES;
      if (after.length !== before.length + abiGrowth ||
          !after.data.subarray(0, stockBytes).equals(before.data.subarray(0, stockBytes)) ||
          !after.data.subarray(stockBytes).equals(abi)) {
        throw new Error("Stage-3E.3.4 IROM is not the exact E3A stock prefix plus its replacement ABI.");
      }
    } else if (!after.data.equals(before.data)) {
      throw new Error(`Stage-3E.3.4 segment ${index} data changed.`);
    }
  }
  const drom = final.segments[DROM];
  const irom = final.segments[IROM];
  if (drom.length !== base.segments[DROM].length || irom.length !== FINAL_IROM_BYTES ||
      irom.loadAddress + irom.length !== FINAL_IROM_END ||
      (drom.dataOffset & 0xffff) !== (drom.loadAddress & 0xffff) ||
      (irom.dataOffset & 0xffff) !== (irom.loadAddress & 0xffff) ||
      final.segments.filter((s) => s.loadAddress >= 0x3c000000 && s.loadAddress < 0x3e000000).length !== 1 ||
      final.segments.filter((s) => s.loadAddress >= 0x42000000 && s.loadAddress < 0x44000000).length !== 1 ||
      final.segments[4].headerOffset !== 0x1d76d8 || final.segments[4].dataOffset !== 0x1d76e0 ||
      final.segments[5].headerOffset !== 0x1ef0c4 || final.segments[5].dataOffset !== 0x1ef0cc ||
      final.checksumOffset !== 0x1ef1df || final.digestOffset !== 0x1ef1e0 ||
      app.length !== EXPECTED_STAGE3E34_APP_BYTES ||
      app.length > STAGE3E34_FACTORY_PARTITION_BYTES) {
    throw new Error("Stage-3E.3.4 mapping, IROM end, or factory boundary changed.");
  }
}

export function applyStage3e3Full(officialMerged, liveE3aApp, abi, manifest, frames, canary) {
  if (!Buffer.isBuffer(officialMerged) || !Buffer.isBuffer(liveE3aApp) ||
      sha256(liveE3aApp) !== EXPECTED_STAGE3E3A_APP_SHA256) {
    throw new Error("Stage-3E.3.4 rollback base is not exact live/readback-verified Stage-3E.3A.");
  }
  if (!Buffer.isBuffer(abi) || abi.length !== STAGE3E34_ABI_BYTES || sha256(abi) !== STAGE3E34_ABI_SHA256) {
    throw new Error("Stage-3E.3.4 ABI changed.");
  }
  const assets = buildStage3e3AssetBank(manifest, frames, canary);
  const base = inspectEsp32AppImage(liveE3aApp);
  if (base.segments[DROM].dataOffset + E3A_STOCK_PREFIX_BYTES !== STAGE3E34_ASSET_BANK_APP_OFFSET ||
      base.segments[IROM].dataOffset + base.segments[IROM].length - STAGE3E3A_ABI_BYTES !== STAGE3E34_ABI_APP_OFFSET ||
      base.segments[IROM].loadAddress + base.segments[IROM].length - STAGE3E3A_ABI_BYTES !== STAGE3E34_ABI_VIRTUAL_ADDRESS ||
      STAGE3E3A_DROM_GROWTH_BYTES !== STAGE3E34_DROM_GROWTH_BYTES) {
    throw new Error("Stage-3E.3.4 E3A replacement boundaries changed.");
  }
  let app = Buffer.from(liveE3aApp);
  assets.padded.copy(app, STAGE3E34_ASSET_BANK_APP_OFFSET);
  app = repairEsp32AppIntegrity(app);
  app = extendEsp32AppSegment(app, { segmentIndex: IROM, data: abi.subarray(STAGE3E3A_ABI_BYTES) });
  abi.copy(app, STAGE3E34_ABI_APP_OFFSET);
  app.writeUInt32LE(STAGE3E34_SETUP_WRAPPER_VIRTUAL_ADDRESS, STAGE3C1_SETUP_POINTER_APP_OFFSET);
  app = repairEsp32AppIntegrity(app);
  const final = inspectEsp32AppImage(app);
  assertFinalLayout(base, final, app, abi, assets);

  const finalGetterOffset = REMAINING_GETTER_LITERAL_APP_OFFSET + STAGE3E34_DROM_GROWTH_BYTES;
  const finalKeyOffset = STAGE3C1_KEY_CALLBACK_APP_OFFSET + STAGE3E34_DROM_GROWTH_BYTES;
  if (app.readUInt32LE(STAGE3C1_SETUP_POINTER_APP_OFFSET) !== STAGE3E34_SETUP_WRAPPER_VIRTUAL_ADDRESS ||
      app.readUInt32LE(finalGetterOffset) !== STOCK_REMAINING_GETTER ||
      app.readUInt32LE(finalKeyOffset) !== FRAMER_SCREEN_AUDIT.wpmKeyCallbackLiteral.expectedValue ||
      app.readUInt32LE(STAGE3C1_WPM_TICK_APP_OFFSET) !== FRAMER_SCREEN_AUDIT.wpmTickVtablePointer.expectedValue ||
      !app.subarray(STAGE3E34_ASSET_BANK_APP_OFFSET, STAGE3E34_ASSET_BANK_APP_OFFSET + assets.bank.length).equals(assets.bank) ||
      !app.subarray(STAGE3E34_ABI_APP_OFFSET, STAGE3E34_ABI_APP_OFFSET + abi.length).equals(abi)) {
    throw new Error("Stage-3E.3.4 setup/stock hooks/payload identity changed.");
  }
  const merged = Buffer.concat([officialMerged.subarray(0, APP_FLASH_OFFSET), app]);
  return Object.freeze({ app, merged, stage3e34: final, assets, finalGetterOffset, finalKeyOffset });
}

export async function buildStage3e3({ root } = {}) {
  const projectRoot = root ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const assetDirectory = path.join(projectRoot, "framer-widgets/assets/device-lvgl-v5-i4-species");
  const [official, liveE3aApp, abiHex, manifestBytes, canary] = await Promise.all([
    readFile(path.join(projectRoot, "artifacts/firmware/firmware_0.4.1_merged.bin")),
    readFile(path.join(projectRoot, "custom-firmware/build/framer-0.4.1-stage3e3a-i4-canary-app.bin")),
    readFile(path.join(projectRoot, "custom-firmware/experimental/stage3e34-wpm-pet.hex"), "utf8"),
    readFile(path.join(assetDirectory, "manifest.json")),
    readFile(path.join(projectRoot, "framer-widgets/assets/device-lvgl-v4-i4-canary/cat-ready-52x42.lvgl.bin")),
  ]);
  const manifest = parseStage3e3AssetManifest(manifestBytes);
  const frames = await Promise.all(manifest.frames.map((frame) => readFile(path.join(projectRoot, frame.output))));
  const output = applyStage3e3Full(official, liveE3aApp, decodeStage3e3AbiHex(abiHex), manifest, frames, canary);
  const appHash = sha256(output.app);
  const mergedHash = sha256(output.merged);
  if (output.app.length !== EXPECTED_STAGE3E34_APP_BYTES || output.merged.length !== EXPECTED_STAGE3E34_MERGED_BYTES ||
       appHash !== EXPECTED_STAGE3E34_APP_SHA256 || mergedHash !== EXPECTED_STAGE3E34_MERGED_SHA256 ||
       output.stage3e34.storedChecksum !== EXPECTED_STAGE3E34_CHECKSUM ||
       output.stage3e34.storedDigest.toString("hex") !== EXPECTED_STAGE3E34_DIGEST) {
    throw new Error("Stage-3E.3.4 deterministic output/integrity changed.");
  }
  const outputDirectory = path.join(projectRoot, "custom-firmware/build");
  const appName = "framer-0.4.1-stage3e34-wpm-pet-full-app.bin";
  const mergedName = "framer-0.4.1-stage3e34-wpm-pet-full-merged.bin";
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(path.join(outputDirectory, appName), output.app),
    writeFile(path.join(outputDirectory, mergedName), output.merged),
  ]);
  const result = {
    format: "framer-f1-stage3e34-native-wpm-pet-full-v1",
    status: "OFFLINE STATIC CANDIDATE; no hardware access; independent audit required before flash",
    target: "Framer F1 / knob_f1",
    baseFirmware: { stage: "live/readback-verified Stage-3E.3A", appSha256: EXPECTED_STAGE3E3A_APP_SHA256 },
    behavior: {
      screenId: 7,
      drawOrder: ["opaque #06152B root", "exact E3A unscaled fallback", "96x78 RAM-expanded pet", "numeric TOP_MID WPM", "BOTTOM_MID Avg/Top", "three stars"],
      roster: manifest.rosterOrder,
      states: manifest.stateOrder,
      pet: "One fail-visible image object starts on exact E3A 52x42 art, then switches to a controller-owned double-buffered 96x78 nearest-neighbor I4 frame",
      selection: "Fn + bottom encoder; positive next, negative previous, wrap 0..5; default Cat; RAM-persistent across view entries",
      timing: { uiMs: 100, sampleMs: 500, twinkleMs: 1000, waitingMs: 5000, sleepingMs: 30000 },
      labels: "Numeric WPM only at top with cached color bands; exact two-line Avg/Top at bottom; Low stays internal",
    },
    patches: {
      setupPointer: { appOffset: STAGE3C1_SETUP_POINTER_APP_OFFSET, to: "0x42116ffc" },
      stockKeyCallback: { appOffset: output.finalKeyOffset, value: "0x4206eae0", unchanged: true },
      stockTimerGetter: { appOffset: output.finalGetterOffset, value: `0x${STOCK_REMAINING_GETTER.toString(16)}`, unchanged: true },
      nativeWpmTick: { appOffset: STAGE3C1_WPM_TICK_APP_OFFSET, unchanged: true },
      globalBubble: "not referenced",
    },
    assets: {
      manifest: "framer-widgets/assets/device-lvgl-v5-i4-species/manifest.json",
      manifestSha256: STAGE3E34_ASSET_MANIFEST_SHA256,
      descriptorOrder: "species*8+state",
      virtualAddress: "0x3c1c1190",
      fullTableVirtualAddress: "0x3c1c162c",
      bankBytes: output.assets.bank.length,
      bankSha256: sha256(output.assets.bank),
      runtimeEndVirtualAddress: `0x${output.assets.boundary.endAddress.toString(16)}`,
      liveProvenBoundary: "0x3c1d0000",
      boundaryHeadroom: output.assets.boundary.headroom,
      paddedDromBytes: output.assets.padded.length,
      paddedDromSha256: sha256(output.assets.padded),
    },
    code: {
      source: "custom-firmware/experimental/stage3e34-wpm-pet.S",
      linker: "custom-firmware/experimental/stage3e34-wpm-pet.ld",
      pinnedHex: "custom-firmware/experimental/stage3e34-wpm-pet.hex",
      virtualAddress: "0x42116f10", bytes: STAGE3E34_ABI_BYTES, sha256: STAGE3E34_ABI_SHA256,
      executableFormat: "elf32-xtensa-le", finalLinkRelocations: 0,
      combinedRegistrationOnly: {
        linker: "custom-firmware/experimental/stage3e34-register-only.ld",
        pinnedHex: "custom-firmware/experimental/stage3e34-register-only.hex",
        entry: "stage3e34_register_wpm", entryAddress: "0x42116fec",
        callAbi: "a2=screenRegistry, a3=navigationManager; returns controller or null",
        bytes: 1928,
        sha256: "6862764da34424285799e5c91796cd6080fca1adc1374f60f5b171b8d34c6c12",
        stockSetupCalls: 0,
      },
    },
    layout: {
      segments: output.stage3e34.segmentCount,
      dromBytes: output.stage3e34.segments[DROM].length,
      dromEndVirtualAddress: `0x${(output.stage3e34.segments[DROM].loadAddress + output.stage3e34.segments[DROM].length).toString(16)}`,
      iromBytes: output.stage3e34.segments[IROM].length,
      iromEndVirtualAddress: `0x${(output.stage3e34.segments[IROM].loadAddress + output.stage3e34.segments[IROM].length).toString(16)}`,
      checksumAppOffset: output.stage3e34.checksumOffset,
      digestAppOffset: output.stage3e34.digestOffset,
      factoryPartitionHeadroom: STAGE3E34_FACTORY_PARTITION_BYTES - output.app.length,
    },
    outputs: {
      app: { file: appName, bytes: output.app.length, sha256: appHash },
      merged: { file: mergedName, bytes: output.merged.length, sha256: mergedHash },
      checksum: output.stage3e34.storedChecksum,
      digest: output.stage3e34.storedDigest.toString("hex"),
    },
    rollback: {
      image: "framer-0.4.1-stage3e3a-i4-canary-app.bin", flashOffset: "0x10000",
      sha256: EXPECTED_STAGE3E3A_APP_SHA256,
      status: "primary live/readback-verified rollback",
      priorVisualFallback: { stage: "Stage-3E", sha256: "546ece0044e4a69ae8db9d9a781edc776f3d1d20d82105afd9ee6de47ff01aba" },
    },
    safety: [
      "Only E3A's existing one-page DROM tail and appended IROM ABI are replaced; segment count remains six.",
      "All 48 immutable descriptor/data sources end below 0x3C1D0000; no runtime asset reads rely on the grown page.",
      "No full-canvas bitmap, explicit image-cache drop, global key hook, or bubble path is referenced.",
      "Source/text/color writes are cached; stars are created once and twinkle by color only.",
      "One exact unscaled E3A image is the null-safe fallback; successful expansion switches that same object to a double-buffered RAM-native I4 source, avoiding ghost layers and the unsupported scale API.",
      "No hardware was accessed.",
    ],
  };
  await writeFile(path.join(outputDirectory, "stage3e34-manifest.json"), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  buildStage3e3().then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => {
    console.error(`Error: ${error.message}`); process.exitCode = 1;
  });
}
