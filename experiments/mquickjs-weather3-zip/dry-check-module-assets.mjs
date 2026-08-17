#!/usr/bin/env node
/* Dry run of every check build-diag-module.mjs / build-psram-module.mjs applies
 * to a FRAMER_DIAG_ASSETS_DIR asset set, using the same modules and the same
 * expectations, without building or flashing anything.
 *
 * Source of truth:
 * experiments/mquickjs-esp32s3-physical-canary/build-diag-module.mjs lines
 * ~239..311 (asset load, LZSS inflate, F2TF admit, custom-package admission
 * metadata) and the five files it embeds verbatim.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { decodeRenderV2MQuickJsPackage } from
  "../../f1-widget-sdk/src/render-v2/mquickjs.mjs";
import { decodeTargetFacadeAsset, TARGET_FACADE_CONTRACT_SHA256 } from
  "../mquickjs-target-facade/contract.mjs";
import { decodeLzss } from "./lzss.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.resolve(process.argv[2] ?? path.join(here, "build"));
const expected = Object.freeze({ generation: 19, baseFrameBytes: 62_000,
  maxFacadeAssetBytes: 4096, packageEvents: 14, packageKeys: 2, packageChords: 1,
  targetContractSha256: "8220152a09348da34cdd70dd7d370197f2f3fc46a9f45e50d7fb7015bdb8579a" });

const invariant = (ok, message) => { if (!ok) throw new Error(message); };
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const file = (name) => readFile(path.join(assets, name));

const [f2js, f2tf, lzss, weatherSource, rawBase, f2jsShaFile, contractShaFile] =
  await Promise.all([
    file("weather-id28-gen19.f2js"), file("weather-id28-gen19.f2tf"),
    file("weather-id28-base.lzss"), file("weather-id28-gen19.js"),
    file("weather-id28-base.rgb565le"), file("weather-id28-f2js.sha256.bin"),
    file("target-contract.sha256.bin"),
  ]);

invariant(TARGET_FACADE_CONTRACT_SHA256 === expected.targetContractSha256,
  "F2TF contract identity changed.");
const assetSha = { f2js: sha(f2js), f2tf: sha(f2tf), lzss: sha(lzss), source: sha(weatherSource) };
const baseFrameBytes = decodeLzss(lzss, expected.baseFrameBytes);
invariant(baseFrameBytes.length === expected.baseFrameBytes,
  `Base LZSS inflated to ${baseFrameBytes.length} B.`);
invariant(rawBase.equals(baseFrameBytes),
  "weather-id28-base.lzss does not decode to weather-id28-base.rgb565le.");
invariant(f2tf.length <= expected.maxFacadeAssetBytes,
  `F2TF is ${f2tf.length} B; FRAMER_TF_MAX_ASSET_BYTES is ${expected.maxFacadeAssetBytes}.`);
const facadeBaseFrame = new Uint16Array(baseFrameBytes.buffer.slice(
  baseFrameBytes.byteOffset, baseFrameBytes.byteOffset + baseFrameBytes.length));
const decodedFacade = decodeTargetFacadeAsset(f2tf, {
  expectedGeneration: expected.generation, expectedF2jsSha256: assetSha.f2js,
  expectedContractSha256: TARGET_FACADE_CONTRACT_SHA256, baseFrame: facadeBaseFrame });
invariant(decodedFacade.targets.length === 16, "F2TF must declare exactly 16 targets.");
const decodedPackage = decodeRenderV2MQuickJsPackage(f2js);
invariant(decodedPackage.generation === expected.generation &&
  (decodedPackage.rasterBase?.length ?? 0) === 0 &&
  decodedPackage.events.length === expected.packageEvents &&
  decodedPackage.input.keyCount === expected.packageKeys &&
  decodedPackage.input.chordCount === expected.packageChords &&
  decodedPackage.targets.length === 16,
`Custom F2JS admission metadata drifted: generation=${decodedPackage.generation} ` +
  `events=${decodedPackage.events.length} keys=${decodedPackage.input.keyCount} ` +
  `chords=${decodedPackage.input.chordCount}.`);
invariant(decodedPackage.targets.map(({ id }) => id).join("\0") ===
  decodedFacade.targets.map(({ id }) => id).join("\0"),
"Custom F2JS target IDs differ from the F2TF target IDs.");
invariant(decodedPackage.sha256 === assetSha.f2js, "Custom F2JS did not round-trip.");
invariant(decodedPackage.source === weatherSource.toString("utf8"),
  "weather-id28-gen19.js is not the source inside weather-id28-gen19.f2js.");
/* The two digest files the module link embeds next to the payloads. */
invariant(f2jsShaFile.toString("hex") === assetSha.f2js,
  "weather-id28-f2js.sha256.bin does not match the package.");
invariant(contractShaFile.toString("hex") === TARGET_FACADE_CONTRACT_SHA256,
  "target-contract.sha256.bin does not match the facade contract.");

process.stdout.write(`${JSON.stringify({
  status: "PASS_DIAG_ASSETS_DIR_WOULD_BE_ACCEPTED_NO_BUILD",
  assets, generation: expected.generation,
  files: ["weather-id28-gen19.js", "weather-id28-gen19.f2js", "weather-id28-gen19.f2tf",
    "weather-id28-base.lzss", "weather-id28-base.rgb565le",
    "weather-id28-f2js.sha256.bin", "target-contract.sha256.bin"],
  sha256: assetSha,
  facade: { bytes: f2tf.length, sha256: sha(f2tf), targets: decodedFacade.targets.length },
  package: { bytes: f2js.length, events: decodedPackage.events.length,
    keys: decodedPackage.input.keyCount, chords: decodedPackage.input.chordCount,
    targets: decodedPackage.targets.map(({ id }) => id) },
  base: { bytes: baseFrameBytes.length, sha256: sha(baseFrameBytes), lzssBytes: lzss.length },
}, null, 2)}\n`);
