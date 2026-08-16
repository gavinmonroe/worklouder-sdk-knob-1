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
import { extendEsp32AppSegment, inspectEsp32AppImage, repairEsp32AppIntegrity } from "./lib/esp-app-image.mjs";
import {
  FRAMER_RUNTIME_ASSET_BOUNDARY,
  auditRuntimeAssetBoundary,
  buildNativeLvglIndexedBank,
  parseSerializedLvglIndexed,
} from "./lib/framer-lvgl-indexed.mjs";
import { FRAMER_SCREEN_AUDIT } from "./lib/framer-registry-audit.mjs";

export const STAGE3E3A_SCREEN_ID = 7;
export const STAGE3E3A_ABI_APP_OFFSET = 0x1d6f10;
export const STAGE3E3A_ABI_VIRTUAL_ADDRESS = 0x42116f10;
export const STAGE3E3A_ABI_BYTES = 0x244;
export const STAGE3E3A_ABI_SHA256 = "13cc66c1d97616af9c3efa535133fb3b40e1a509eabe6bb5b62342c6f19f3f6d";
export const STAGE3E3A_SETUP_WRAPPER_VIRTUAL_ADDRESS = 0x42116fa0;
export const STAGE3E3A_ASSET_BANK_APP_OFFSET = 0x0a1190;
export const STAGE3E3A_ASSET_BANK_VIRTUAL_ADDRESS = 0x3c1c1190;
export const STAGE3E3A_SERIALIZED_ASSET_BYTES = 1168;
export const STAGE3E3A_SERIALIZED_ASSET_SHA256 = "0ad586b3a5002fee3cb16498045ead72cae8c8e7befc18133d750f815034fc03";
export const STAGE3E3A_ASSET_BANK_BYTES = 1180;
export const STAGE3E3A_ASSET_BANK_SHA256 = "f651cf38ee0dc567b2240d61b263ecd4e525f68b34549780a897b370c111aff1";
export const STAGE3E3A_DROM_GROWTH_BYTES = 0x10000;
export const STAGE3E3A_PADDED_BANK_SHA256 = "2997d462ddc6c1d006932c84d09d215de681af6d86d52391c1fa3262534c2d9f";
export const STAGE3E3A_ASSET_MANIFEST_SHA256 = "2f2a2f13de81dd79ae8b5825c1abee3c94401fdda5ab271faa5e1643441c6855";
export const EXPECTED_STAGE3E3A_APP_BYTES = 2_026_624;
export const EXPECTED_STAGE3E3A_MERGED_BYTES = 2_092_160;
export const EXPECTED_STAGE3E3A_APP_SHA256 = "dd8edaaa2c3aa98a1cbdbda319255cc7d1a0e02d0069f543dd574ef040db4b83";
export const EXPECTED_STAGE3E3A_MERGED_SHA256 = "2349e1317320e8d2e7d4a6291fb2211d62af1f78fb03c3bf7369f05d4d659797";
export const EXPECTED_STAGE3E3A_CHECKSUM = 0x40;
export const EXPECTED_STAGE3E3A_DIGEST = "1f940f7663310bfae78174ab276a54b74c10617ddb68675acdad908772f1f62d";

const DROM = 0;
const IROM = 3;
const sha256 = (data) => createHash("sha256").update(data).digest("hex");

export function decodeStage3e3aAbiHex(text) {
  if (typeof text !== "string" || !/^[0-9a-fA-F\s]+$/u.test(text)) throw new Error("Stage-3E.3A ABI hex is invalid.");
  const abi = Buffer.from(text.replace(/\s+/gu, ""), "hex");
  if (abi.length !== STAGE3E3A_ABI_BYTES || sha256(abi) !== STAGE3E3A_ABI_SHA256) {
    throw new Error("Stage-3E.3A ABI differs from the machine-verified artifact.");
  }
  return abi;
}

export function buildStage3e3aAssetBank(serialized) {
  if (!Buffer.isBuffer(serialized) || serialized.length !== STAGE3E3A_SERIALIZED_ASSET_BYTES ||
      sha256(serialized) !== STAGE3E3A_SERIALIZED_ASSET_SHA256) {
    throw new Error("Stage-3E.3A I4 canary differs from the pinned converter output.");
  }
  const info = parseSerializedLvglIndexed(serialized);
  if (info.colorFormat !== 0x09 || info.width !== 52 || info.height !== 42 || info.stride !== 26) {
    throw new Error("Stage-3E.3A asset is not exact 52x42 LVGL I4.");
  }
  const alphas = new Set(Array.from({ length: 16 }, (_, index) => serialized[12 + index * 4 + 3]));
  if ([...alphas].some((alpha) => alpha !== 0 && alpha !== 255)) {
    throw new Error("Stage-3E.3A I4 palette must use binary alpha only.");
  }
  const built = buildNativeLvglIndexedBank([serialized], { baseAddress: STAGE3E3A_ASSET_BANK_VIRTUAL_ADDRESS });
  if (built.bank.length !== STAGE3E3A_ASSET_BANK_BYTES || sha256(built.bank) !== STAGE3E3A_ASSET_BANK_SHA256) {
    throw new Error("Stage-3E.3A native I4 bank changed.");
  }
  const boundary = auditRuntimeAssetBoundary(built.bank);
  const padded = Buffer.alloc(STAGE3E3A_DROM_GROWTH_BYTES);
  built.bank.copy(padded);
  if (sha256(padded) !== STAGE3E3A_PADDED_BANK_SHA256) throw new Error("Stage-3E.3A DROM padding changed.");
  return Object.freeze({ ...built, padded, boundary });
}

function assertFinalLayout(base, final, app, abi, assets) {
  if (base.segmentCount !== 6 || final.segmentCount !== 6) throw new Error("Stage-3E.3A must retain six segments.");
  for (let index = 0; index < 6; index += 1) {
    const before = base.segments[index];
    const after = final.segments[index];
    if (before.loadAddress !== after.loadAddress) throw new Error(`Stage-3E.3A segment ${index} VA changed.`);
    if (index === DROM) {
      const setup = STAGE3C1_SETUP_POINTER_APP_OFFSET - before.dataOffset;
      if (after.length !== before.length + assets.padded.length ||
          !after.data.subarray(0, setup).equals(before.data.subarray(0, setup)) ||
          !after.data.subarray(setup + 4, before.length).equals(before.data.subarray(setup + 4)) ||
          !after.data.subarray(before.length).equals(assets.padded)) {
        throw new Error("Stage-3E.3A DROM is not C1 plus one setup word and the pinned safe page.");
      }
    } else if (index === IROM) {
      if (after.dataOffset !== before.dataOffset + STAGE3E3A_DROM_GROWTH_BYTES ||
          after.length !== before.length + abi.length ||
          !after.data.subarray(0, before.length).equals(before.data) ||
          !after.data.subarray(before.length).equals(abi)) {
        throw new Error("Stage-3E.3A IROM is not exact C1 plus the pinned canary ABI.");
      }
    } else if (!after.data.equals(before.data)) {
      throw new Error(`Stage-3E.3A segment ${index} data changed.`);
    }
  }
  const drom = final.segments[DROM];
  const irom = final.segments[IROM];
  if (drom.length !== 0xb1170 || drom.loadAddress + drom.length !== 0x3c1d1190 ||
      irom.length !== 0x117134 || irom.loadAddress + irom.length !== 0x42117154 ||
      (drom.dataOffset & 0xffff) !== (drom.loadAddress & 0xffff) ||
      (irom.dataOffset & 0xffff) !== (irom.loadAddress & 0xffff) ||
      final.segments[4].headerOffset !== 0x1d7154 || final.segments[5].headerOffset !== 0x1eeb40 ||
      final.checksumOffset !== 0x1eec5f || final.digestOffset !== 0x1eec60 ||
      app.length !== EXPECTED_STAGE3E3A_APP_BYTES) {
    throw new Error("Stage-3E.3A final segment/footer layout changed.");
  }
}

export function applyStage3e3aCanary(officialMerged, stage3c1Abi, stage3e3aAbi, serializedAsset) {
  if (!Buffer.isBuffer(stage3e3aAbi) || stage3e3aAbi.length !== STAGE3E3A_ABI_BYTES ||
      sha256(stage3e3aAbi) !== STAGE3E3A_ABI_SHA256) throw new Error("Stage-3E.3A ABI changed.");
  const baseOutput = applyStage3c1OwnedLabels(officialMerged, stage3c1Abi);
  if (sha256(baseOutput.app) !== EXPECTED_STAGE3C1_APP_SHA256 ||
      sha256(baseOutput.merged) !== EXPECTED_STAGE3C1_MERGED_SHA256) {
    throw new Error("Stage-3E.3A base is not exact live-tested Stage-3C.1.");
  }
  const assets = buildStage3e3aAssetBank(serializedAsset);
  const base = baseOutput.stage3c1;
  const baseIrom = base.segments[IROM];
  const getterRelative = REMAINING_GETTER_LITERAL_APP_OFFSET - baseIrom.dataOffset;
  const keyRelative = STAGE3C1_KEY_CALLBACK_APP_OFFSET - baseIrom.dataOffset;
  let app = extendEsp32AppSegment(baseOutput.app, { segmentIndex: DROM, data: assets.padded });
  app = extendEsp32AppSegment(app, { segmentIndex: IROM, data: stage3e3aAbi });
  app.writeUInt32LE(STAGE3E3A_SETUP_WRAPPER_VIRTUAL_ADDRESS, STAGE3C1_SETUP_POINTER_APP_OFFSET);
  app = repairEsp32AppIntegrity(app);
  const final = inspectEsp32AppImage(app);
  assertFinalLayout(base, final, app, stage3e3aAbi, assets);
  const finalIrom = final.segments[IROM];
  const finalGetterOffset = finalIrom.dataOffset + getterRelative;
  const finalKeyOffset = finalIrom.dataOffset + keyRelative;
  if (app.readUInt32LE(STAGE3C1_SETUP_POINTER_APP_OFFSET) !== STAGE3E3A_SETUP_WRAPPER_VIRTUAL_ADDRESS ||
      app.readUInt32LE(finalGetterOffset) !== STOCK_REMAINING_GETTER ||
      app.readUInt32LE(finalKeyOffset) !== FRAMER_SCREEN_AUDIT.wpmKeyCallbackLiteral.expectedValue ||
      app.readUInt32LE(STAGE3C1_WPM_TICK_APP_OFFSET) !== FRAMER_SCREEN_AUDIT.wpmTickVtablePointer.expectedValue ||
      !app.subarray(STAGE3E3A_ASSET_BANK_APP_OFFSET,
        STAGE3E3A_ASSET_BANK_APP_OFFSET + assets.bank.length).equals(assets.bank) ||
      !app.subarray(STAGE3E3A_ABI_APP_OFFSET, STAGE3E3A_ABI_APP_OFFSET + stage3e3aAbi.length).equals(stage3e3aAbi)) {
    throw new Error("Stage-3E.3A final hook/stock literals/payload changed.");
  }
  const merged = Buffer.concat([officialMerged.subarray(0, APP_FLASH_OFFSET), app]);
  if (sha256(app) !== EXPECTED_STAGE3E3A_APP_SHA256 || sha256(merged) !== EXPECTED_STAGE3E3A_MERGED_SHA256 ||
      merged.length !== EXPECTED_STAGE3E3A_MERGED_BYTES || final.storedChecksum !== EXPECTED_STAGE3E3A_CHECKSUM ||
      final.storedDigest.toString("hex") !== EXPECTED_STAGE3E3A_DIGEST) {
    throw new Error("Stage-3E.3A deterministic output/integrity changed.");
  }
  return Object.freeze({ app, merged, stage3e3a: final, assets, finalGetterOffset, finalKeyOffset });
}

async function main() {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const [official, c1Hex, abiHex, asset, assetManifestBytes] = await Promise.all([
    readFile(path.join(root, "../artifacts/firmware/firmware_0.4.1_merged.bin")),
    readFile(path.join(root, "experimental/stage3c1-wpm-labels.hex"), "utf8"),
    readFile(path.join(root, "experimental/stage3e3a-i4-canary.hex"), "utf8"),
    readFile(path.join(root, "../framer-widgets/assets/device-lvgl-v4-i4-canary/cat-ready-52x42.lvgl.bin")),
    readFile(path.join(root, "../framer-widgets/assets/device-lvgl-v4-i4-canary/manifest.json")),
  ]);
  if (sha256(assetManifestBytes) !== STAGE3E3A_ASSET_MANIFEST_SHA256) throw new Error("Stage-3E.3A asset manifest changed.");
  const output = applyStage3e3aCanary(official, decodeStage3c1AbiHex(c1Hex), decodeStage3e3aAbiHex(abiHex), asset);
  const build = path.join(root, "build");
  await mkdir(build, { recursive: true });
  const appPath = path.join(build, "framer-0.4.1-stage3e3a-i4-canary-app.bin");
  const mergedPath = path.join(build, "framer-0.4.1-stage3e3a-i4-canary-merged.bin");
  await Promise.all([writeFile(appPath, output.app), writeFile(mergedPath, output.merged)]);
  await writeFile(path.join(build, "framer-0.4.1-stage3e3a-i4-canary-manifest.json"), `${JSON.stringify({
    stage: "3E.3A",
    status: "OFFLINE STATIC CANDIDATE; no hardware access; independent audit required before live canary",
    base: "exact live Stage-3C.1",
    screenId: 7,
    app: { file: path.relative(root, appPath), bytes: output.app.length, sha256: sha256(output.app) },
    merged: { file: path.relative(root, mergedPath), bytes: output.merged.length, sha256: sha256(output.merged) },
    abi: { address: `0x${STAGE3E3A_ABI_VIRTUAL_ADDRESS.toString(16)}`, bytes: STAGE3E3A_ABI_BYTES, sha256: STAGE3E3A_ABI_SHA256 },
    asset: { address: `0x${STAGE3E3A_ASSET_BANK_VIRTUAL_ADDRESS.toString(16)}`, ...output.assets.boundary,
      format: "52x42 I4 binary alpha; one static source", sha256: STAGE3E3A_ASSET_BANK_SHA256 },
    safety: ["Stock setup called once", "stock key/getter/tick unchanged", "no sky/source switch/species input/global hook",
      "every runtime-read asset byte is below 0x3C1D0000"],
  }, null, 2)}\n`);
  console.log(`Stage-3E.3A app ${output.app.length} ${sha256(output.app)}`);
  console.log(`Stage-3E.3A merged ${output.merged.length} ${sha256(output.merged)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
