import { writeFile } from "node:fs/promises";

import { rasterizeGlyphAtlasWithMagick } from "../../src/render/index.mjs";

const ascii = [..."0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"];
const hiragana = Array.from({ length: 0x56 }, (_, index) => String.fromCodePoint(0x3041 + index));
const katakana = [...Array.from({ length: 0x5a }, (_, index) => String.fromCodePoint(0x30a1 + index)), "ー"];
// The compiler caps the hosted cache at 255 glyph ids (one byte). 239 alphanumerics+kana
// leave room for 16 extras: the punctuation/symbols the shipped widgets use most. Without
// ":" (HH:MM:SS) hosted cache-only compiles fell back to Chromium raster. Space, "%", "@" and
// "\\" are excluded (empty label / ImageMagick label escapes) and keep the raster fallback.
const punctuation = [...":.,-+/!?()'#=&"];
const symbols = [..."°→"];
const glyphs = [...new Set([...ascii, ...punctuation, ...symbols, ...hiragana, ...katakana])];
const entries = [];

for (let offset = 0; offset < glyphs.length; offset += 240) {
  const batch = glyphs.slice(offset, offset + 240);
  const atlas = await rasterizeGlyphAtlasWithMagick(batch);
  batch.forEach((glyph, index) => entries.push([glyph, atlas.masks[index].toString("base64")]));
}

const cache = {
  format: "framer-hosted-glyph-cache-v1",
  width: 14,
  height: 14,
  rowStride: 2,
  source: "pinned-hiragino-magick-cache-v1",
  glyphs: entries,
};
const target = new URL("../assets/hosted-glyph-cache.json", import.meta.url);
await writeFile(target, `${JSON.stringify(cache)}\n`);
process.stdout.write(`Wrote ${entries.length} hosted glyph masks to ${target.pathname}\n`);
