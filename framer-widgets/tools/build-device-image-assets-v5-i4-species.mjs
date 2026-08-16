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
const sourceRoot = path.join(workspace, "framer-widgets/assets/wpm-pet-species-frames-v1");
const sourceManifest = JSON.parse(await readFile(path.join(sourceRoot, "manifest.json"), "utf8"));
if (sourceManifest.format !== "framer-f1-wpm-pet-species-frames-v1" ||
    sourceManifest.species.length !== 6 || sourceManifest.stateOrder.length !== 8) {
  throw new Error("Normalized six-species source manifest changed.");
}
const outputRoot = path.join(workspace, "framer-widgets/assets/device-lvgl-v5-i4-species");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function rgbaToI4(pngBytes) {
  const png = PNG.sync.read(pngBytes);
  if (png.width !== 52 || png.height !== 42) throw new Error("I4 frame dimensions changed.");
  const rgba = Buffer.from(png.data);
  const keys = [];
  const counts = new Map();
  for (let offset = 0; offset < rgba.length; offset += 4) {
    if (rgba[offset + 3] <= 8) rgba.fill(0, offset, offset + 4);
    const key = rgba.subarray(offset, offset + 4).toString("hex");
    if (!counts.has(key)) keys.push(key);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (keys.length > 16) throw new Error(`Quantizer emitted ${keys.length} colors; I4 allows 16.`);
  const transparent = keys.filter((key) => key.endsWith("00"));
  if (transparent.length !== 1) throw new Error("I4 frame must have exactly one transparent RGBA color.");
  const opaque = keys.filter((key) => !key.endsWith("00"))
    .sort((left, right) => (counts.get(right) - counts.get(left)) || left.localeCompare(right));
  const paletteKeys = [transparent[0], ...opaque];
  const paletteIndex = new Map(paletteKeys.map((key, index) => [key, index]));
  const paletteBgra = Buffer.alloc(64);
  for (let index = 0; index < paletteKeys.length; index += 1) {
    const color = Buffer.from(paletteKeys[index], "hex");
    paletteBgra[index * 4] = color[2];
    paletteBgra[index * 4 + 1] = color[1];
    paletteBgra[index * 4 + 2] = color[0];
    paletteBgra[index * 4 + 3] = color[3];
  }
  const indices = new Uint8Array(png.width * png.height);
  for (let pixel = 0; pixel < indices.length; pixel += 1) {
    const offset = pixel * 4;
    indices[pixel] = paletteIndex.get(rgba.subarray(offset, offset + 4).toString("hex"));
  }
  const serialized = serializeLvglIndexed({
    width: png.width, height: png.height, formatName: "I4", paletteBgra, indices,
  });
  const decodedPng = Buffer.from(convertLvglToImage(serialized));
  const decoded = PNG.sync.read(decodedPng);
  if (!Buffer.from(decoded.data).equals(rgba)) throw new Error("Official Input decoder did not round-trip I4 exactly.");
  return Object.freeze({ serialized, decodedPng, colors: paletteKeys.length });
}

await mkdir(outputRoot, { recursive: true });
const frames = [];
const serializedFrames = [];
for (const species of sourceManifest.species) {
  for (const frame of species.frames) {
    const source = path.join(workspace, frame.file);
    const sourceBytes = await readFile(source);
    if (sha256(sourceBytes) !== frame.pngSha256) throw new Error(`${species.label}/${frame.state} source changed.`);
    const basename = `pet-${species.id}-${frame.stateId}`;
    const quantizedPath = path.join(outputRoot, `${basename}.quantized.png`);
    execFileSync("magick", [
      source,
      "-filter", "Lanczos", "-resize", "52x42",
      "-background", "none", "-gravity", "center", "-extent", "52x42",
      "-alpha", "on", "-channel", "A", "-threshold", "50%", "+channel",
      "-channel", "RGBA", "-colors", "16", "+channel", "-strip",
      `PNG32:${quantizedPath}`,
    ]);
    const converted = rgbaToI4(await readFile(quantizedPath));
    const pngPath = path.join(outputRoot, `${basename}.png`);
    const lvglPath = path.join(outputRoot, `${basename}.lvgl.bin`);
    await Promise.all([writeFile(pngPath, converted.decodedPng), writeFile(lvglPath, converted.serialized)]);
    serializedFrames.push(converted.serialized);
    frames.push(Object.freeze({
      name: basename,
      speciesId: species.id,
      species: species.label,
      stateId: frame.stateId,
      state: frame.state,
      source: frame.file,
      sourceSha256: frame.pngSha256,
      png: path.relative(workspace, pngPath),
      pngSha256: sha256(converted.decodedPng),
      output: path.relative(workspace, lvglPath),
      lvglSha256: sha256(converted.serialized),
      width: 52,
      height: 42,
      stride: 26,
      bytes: converted.serialized.length,
      paletteColorsUsed: converted.colors,
      colorFormat: "LV_COLOR_FORMAT_I4 (0x09), binary alpha",
    }));
  }
}

const native = buildNativeLvglIndexedBank(serializedFrames, {
  baseAddress: FRAMER_RUNTIME_ASSET_BOUNDARY.stockDromEnd,
});
const boundary = auditRuntimeAssetBoundary(native.bank);
const bankPath = path.join(outputRoot, "pet-48.native-bank.bin");
await writeFile(bankPath, native.bank);

const rowPaths = [];
for (const species of sourceManifest.species) {
  const row = path.join(outputRoot, `.preview-${species.slug}.png`);
  execFileSync("magick", [
    ...species.frames.map((frame) => path.join(outputRoot, `pet-${species.id}-${frame.stateId}.png`)),
    "+append", row,
  ]);
  rowPaths.push(row);
}
const previewPath = path.join(outputRoot, "preview-6-species-x-8-states-i4.png");
execFileSync("magick", [
  ...rowPaths, "-append", "-background", "#06152b", "-alpha", "remove", "-alpha", "off", previewPath,
]);
const previewBytes = await readFile(previewPath);
const manifest = {
  format: "framer-f1-wpm-pet-lvgl-assets-v5-i4-six-species",
  status: "offline converted assets; every runtime byte constrained below 0x3C1D0000",
  converter: "ImageMagick binary-alpha 16-color quantization + pinned LVGL I4 serializer + official Input decoder round-trip",
  normalizedSourceManifest: "framer-widgets/assets/wpm-pet-species-frames-v1/manifest.json",
  rosterOrder: sourceManifest.rosterOrder,
  stateOrder: sourceManifest.stateOrder,
  descriptorOrder: "species*8+state; no background bitmap descriptors",
  layout: {
    logicalCanvas: { width: 100, height: 310 },
    pet: { width: 52, height: 42, align: "center", x: 0, y: 0 },
    background: "opaque programmatic root #06152B",
  },
  frames,
  nativeBank: {
    file: path.relative(workspace, bankPath),
    sha256: sha256(native.bank),
    bytes: native.bank.length,
    descriptorBytes: native.descriptorTableBytes,
    boundary,
  },
  preview: { file: path.relative(workspace, previewPath), sha256: sha256(previewBytes) },
};
await writeFile(path.join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({
  format: manifest.format,
  frames: frames.length,
  bank: manifest.nativeBank,
  preview: manifest.preview,
}, null, 2));
