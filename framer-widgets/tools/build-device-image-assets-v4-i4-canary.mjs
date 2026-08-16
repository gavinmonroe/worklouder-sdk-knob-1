#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  FRAMER_RUNTIME_ASSET_BOUNDARY,
  auditRuntimeAssetBoundary,
  buildNativeLvglIndexedBank,
  parseSerializedLvglIndexed,
  serializeLvglIndexed,
} from "../../custom-firmware/lib/framer-lvgl-indexed.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(here, "../..");
const require = createRequire(import.meta.url);
const { PNG } = require(path.join(workspace, "extracted/input-app/node_modules/pngjs"));
const { convertLvglToImage } = require(
  path.join(workspace, "extracted/input-app/node_modules/@worklouder/wl-device-kit"),
);

const source = path.join(
  workspace,
  "framer-widgets/assets/wpm-pet-species-frames-v1/cat/frame-00.png",
);
const outputDirectory = path.join(workspace, "framer-widgets/assets/device-lvgl-v4-i4-canary");
const preview = path.join(outputDirectory, "cat-ready-52x42.png");
const serializedPath = path.join(outputDirectory, "cat-ready-52x42.lvgl.bin");
const bankPath = path.join(outputDirectory, "cat-ready-52x42.native-bank.bin");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

await mkdir(outputDirectory, { recursive: true });
execFileSync("magick", [
  source,
  "-filter", "Lanczos",
  "-resize", "52x42",
  "-background", "none",
  "-gravity", "center",
  "-extent", "52x42",
  "-alpha", "on",
  "-channel", "A",
  "-threshold", "50%",
  "+channel",
  "-channel", "RGBA",
  "-colors", "16",
  "+channel",
  "-strip",
  `PNG32:${preview}`,
]);

const pngBytes = await readFile(preview);
const png = PNG.sync.read(pngBytes);
if (png.width !== 52 || png.height !== 42) throw new Error("I4 canary dimensions changed.");

const normalizedRgba = Buffer.from(png.data);
const keys = [];
const counts = new Map();
for (let offset = 0; offset < normalizedRgba.length; offset += 4) {
  // ImageMagick's 16-color RGBA quantizer can round fully transparent source
  // pixels to alpha=1. Normalize that invisible fringe back to transparent.
  if (normalizedRgba[offset + 3] <= 8) normalizedRgba.fill(0, offset, offset + 4);
  const key = normalizedRgba.subarray(offset, offset + 4).toString("hex");
  if (!counts.has(key)) keys.push(key);
  counts.set(key, (counts.get(key) ?? 0) + 1);
}
if (keys.length > 16) throw new Error(`ImageMagick emitted ${keys.length} RGBA colors; I4 allows 16.`);
const transparent = keys.filter((key) => key.endsWith("00"));
if (transparent.length !== 1) throw new Error(`Expected one normalized transparent color; found ${transparent.length}.`);
const opaque = keys.filter((key) => !key.endsWith("00"))
  .sort((left, right) => (counts.get(right) - counts.get(left)) || left.localeCompare(right));
const paletteKeys = [transparent[0], ...opaque];
const paletteIndex = new Map(paletteKeys.map((key, index) => [key, index]));
const paletteBgra = Buffer.alloc(64);
for (let index = 0; index < paletteKeys.length; index += 1) {
  const rgba = Buffer.from(paletteKeys[index], "hex");
  paletteBgra[index * 4] = rgba[2];
  paletteBgra[index * 4 + 1] = rgba[1];
  paletteBgra[index * 4 + 2] = rgba[0];
  paletteBgra[index * 4 + 3] = rgba[3];
}
const indices = new Uint8Array(png.width * png.height);
for (let pixel = 0; pixel < indices.length; pixel += 1) {
  const offset = pixel * 4;
  const key = normalizedRgba.subarray(offset, offset + 4).toString("hex");
  indices[pixel] = paletteIndex.get(key);
}

const serialized = serializeLvglIndexed({
  width: png.width,
  height: png.height,
  formatName: "I4",
  paletteBgra,
  indices,
});
const info = parseSerializedLvglIndexed(serialized);
const decodedPngBytes = Buffer.from(convertLvglToImage(serialized));
const decoded = PNG.sync.read(decodedPngBytes);
if (decoded.width !== png.width || decoded.height !== png.height ||
    !Buffer.from(decoded.data).equals(normalizedRgba)) {
  throw new Error("Input's official LVGL decoder did not round-trip the I4 pixels exactly.");
}

const native = buildNativeLvglIndexedBank([serialized], {
  baseAddress: FRAMER_RUNTIME_ASSET_BOUNDARY.stockDromEnd,
});
const boundary = auditRuntimeAssetBoundary(native.bank);
await Promise.all([
  writeFile(preview, decodedPngBytes),
  writeFile(serializedPath, serialized),
  writeFile(bankPath, native.bank),
]);

const manifest = {
  format: "framer-f1-wpm-pet-lvgl-assets-v4-i4-canary",
  status: "offline-only; not embedded in or flashed as firmware",
  purpose: "Minimal one-source I4 decoder canary with a painted LVGL background and no frame switching.",
  source: path.relative(workspace, source),
  sourceSha256: sha256(await readFile(source)),
  preview: path.relative(workspace, preview),
  previewSha256: sha256(decodedPngBytes),
  output: path.relative(workspace, serializedPath),
  lvglSha256: sha256(serialized),
  nativeBank: path.relative(workspace, bankPath),
  nativeBankSha256: sha256(native.bank),
  width: info.width,
  height: info.height,
  stride: info.stride,
  colorFormat: "LV_COLOR_FORMAT_I4 (0x09)",
  paletteColorsUsed: paletteKeys.length,
  serializedBytes: serialized.length,
  nativeBankBytes: native.bank.length,
  boundary,
  officialInputDecoderRoundTrip: true,
};
await writeFile(
  path.join(outputDirectory, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(JSON.stringify(manifest, null, 2));
