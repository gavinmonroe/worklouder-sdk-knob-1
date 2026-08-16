import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const MAGIC = Buffer.from("F1GA", "ascii");
const VERSION = 1;
const HEADER_BYTES = 16;
const execFileAsync = promisify(execFile);

export const PINNED_HIRAGINO_ATLAS_SOURCE = Object.freeze({
  magickPath: "/opt/homebrew/bin/magick",
  magickVersionPrefix: "Version: ImageMagick 7.1.2-21 ",
  fontPath: "/System/Library/Fonts/Hiragino Sans GB.ttc",
  fontSha256: "97e5861e11656538bed9397730d7f46e2f1b0f07692f18e87c079f7ce9ff6bdc",
  pointSize: 14,
  threshold: 64,
});

function invariant(value, message) {
  if (!value) throw new Error(message);
}

function bytes(value, label) {
  invariant(value instanceof Uint8Array, `${label} must be a Uint8Array.`);
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

/**
 * Build the device's row-aligned, one-bit glyph atlas. The rasterizer is the
 * only font-specific piece: it receives one Unicode scalar and must return
 * exactly rowStride * height bytes, MSB-first within each byte.
 */
export function buildGlyphAtlas({ glyphs, width = 14, height = 14, rasterizeGlyph,
  source = null, testOnly = false }) {
  invariant(Array.isArray(glyphs) && glyphs.length > 0 && glyphs.length <= 255,
    "Glyph atlas requires 1..255 glyphs.");
  invariant(Number.isInteger(width) && width > 0 && width <= 32 &&
    Number.isInteger(height) && height > 0 && height <= 32,
  "Glyph atlas dimensions must be integers in 1..32.");
  invariant(typeof rasterizeGlyph === "function", "Glyph atlas requires a rasterizeGlyph function.");
  const rowStride = Math.ceil(width / 8);
  const maskBytes = rowStride * height;
  const masks = glyphs.map((glyph, glyphId) => {
    invariant(Array.from(glyph).length === 1, `Glyph ${glyphId} must contain exactly one Unicode scalar.`);
    const mask = bytes(rasterizeGlyph(glyph, { glyphId, width, height, rowStride }), `Glyph ${glyphId} mask`);
    invariant(mask.length === maskBytes,
      `Glyph ${glyphId} mask is ${mask.length} bytes; expected ${maskBytes}.`);
    if (width % 8 !== 0) {
      const unusedMask = (1 << (8 - (width % 8))) - 1;
      for (let row = 0; row < height; row += 1) {
        invariant((mask[row * rowStride + rowStride - 1] & unusedMask) === 0,
          `Glyph ${glyphId} sets padding bits outside its width.`);
      }
    }
    return Buffer.from(mask);
  });
  const payloadBytes = masks.length * maskBytes;
  const binary = Buffer.alloc(HEADER_BYTES + payloadBytes);
  MAGIC.copy(binary, 0);
  binary[4] = VERSION;
  binary[5] = 1 | (testOnly ? 0x80 : 0);
  binary[6] = width;
  binary[7] = height;
  binary.writeUInt16LE(glyphs.length, 8);
  binary.writeUInt16LE(rowStride, 10);
  binary.writeUInt32LE(payloadBytes, 12);
  masks.forEach((mask, index) => mask.copy(binary, HEADER_BYTES + index * maskBytes));
  return Object.freeze({
    format: "framer-glyph-atlas-v1",
    glyphs: Object.freeze([...glyphs]), width, height, rowStride, bitsPerPixel: 1,
    masks: Object.freeze(masks), source, testOnly, binary,
    sha256: createHash("sha256").update(binary).digest("hex"),
  });
}

/** A deterministic plumbing fixture. Never use this synthetic pattern in a release preview. */
export function createDeterministicTestGlyphAtlas(glyphs, options = {}) {
  return buildGlyphAtlas({ ...options, glyphs, testOnly: true, source: "synthetic-codepoint-signature-v1",
    rasterizeGlyph(glyph, { width, height, rowStride }) {
      const output = Buffer.alloc(rowStride * height);
      let state = glyph.codePointAt(0) ^ 0x9e3779b9;
      for (let y = 1; y < height - 1; y += 1) {
        for (let x = 1; x < width - 1; x += 1) {
          state = Math.imul(state ^ (state >>> 16), 0x45d9f3b) >>> 0;
          if (((state >>> ((x + y) & 15)) & 3) === 0) output[y * rowStride + (x >>> 3)] |= 0x80 >>> (x & 7);
        }
      }
      return output;
    },
  });
}

/**
 * Host-only production atlas builder used by the exact preview. It fails closed
 * if either the font bytes or ImageMagick version differs from the pinned input.
 */
export async function rasterizeGlyphAtlasWithMagick(glyphs, options = {}) {
  const source = { ...PINNED_HIRAGINO_ATLAS_SOURCE, ...options };
  const width = options.width ?? 14;
  const height = options.height ?? 14;
  const fontBytes = await readFile(source.fontPath);
  const fontSha256 = createHash("sha256").update(fontBytes).digest("hex");
  invariant(fontSha256 === source.fontSha256,
    `Pinned atlas font SHA-256 mismatch: received ${fontSha256}.`);
  const { stdout: version } = await execFileAsync(source.magickPath, ["-version"], { encoding: "utf8" });
  invariant(version.startsWith(source.magickVersionPrefix),
    `Pinned ImageMagick version mismatch: expected ${source.magickVersionPrefix.trim()}.`);
  const directory = await mkdtemp(path.join(tmpdir(), "f1-glyph-atlas-"));
  const rawPath = path.join(directory, "glyphs.gray");
  try {
    const args = ["-background", "black", "-fill", "white", "-font", source.fontPath,
      "-pointsize", String(source.pointSize), "-gravity", "center", "-size", `${width}x${height}`];
    for (const glyph of glyphs) {
      invariant(Array.from(glyph).length === 1, "Every atlas glyph must contain one Unicode scalar.");
      args.push(`label:${glyph}`);
    }
    args.push("-colorspace", "Gray", "-depth", "8", `gray:${rawPath}`);
    await execFileAsync(source.magickPath, args, { maxBuffer: 1024 * 1024 });
    const gray = await readFile(rawPath);
    invariant(gray.length === glyphs.length * width * height,
      `ImageMagick returned ${gray.length} grayscale bytes; expected ${glyphs.length * width * height}.`);
    const atlas = buildGlyphAtlas({ glyphs, width, height,
      source: Object.freeze({ kind: "pinned-magick-font-v1", fontPath: source.fontPath, fontSha256,
        magickVersion: version.split("\n", 1)[0], pointSize: source.pointSize, threshold: source.threshold }),
      rasterizeGlyph(_glyph, { glyphId, rowStride }) {
        const mask = Buffer.alloc(rowStride * height);
        const inputOffset = glyphId * width * height;
        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            if (gray[inputOffset + y * width + x] >= source.threshold) {
              mask[y * rowStride + (x >>> 3)] |= 0x80 >>> (x & 7);
            }
          }
        }
        return mask;
      } });
    return atlas;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export function decodeGlyphAtlas(value) {
  const binary = bytes(value, "Glyph atlas");
  invariant(binary.length >= HEADER_BYTES, "Glyph atlas is truncated.");
  invariant(binary.subarray(0, 4).equals(MAGIC), "Glyph atlas magic is not F1GA.");
  invariant(binary[4] === VERSION && (binary[5] & 0x7f) === 1, "Unsupported glyph atlas version or bit depth.");
  const testOnly = (binary[5] & 0x80) !== 0;
  const width = binary[6];
  const height = binary[7];
  const glyphCount = binary.readUInt16LE(8);
  const rowStride = binary.readUInt16LE(10);
  const payloadBytes = binary.readUInt32LE(12);
  invariant(width > 0 && height > 0 && glyphCount > 0 && rowStride === Math.ceil(width / 8),
    "Glyph atlas header is invalid.");
  invariant(payloadBytes === glyphCount * rowStride * height && binary.length === HEADER_BYTES + payloadBytes,
    "Glyph atlas length does not match its header.");
  const maskBytes = rowStride * height;
  const masks = Array.from({ length: glyphCount }, (_, index) =>
    Buffer.from(binary.subarray(HEADER_BYTES + index * maskBytes, HEADER_BYTES + (index + 1) * maskBytes)));
  return { format: "framer-glyph-atlas-v1", width, height, rowStride, bitsPerPixel: 1, testOnly,
    glyphCount, masks, binary: Buffer.from(binary),
    sha256: createHash("sha256").update(binary).digest("hex") };
}

export function glyphMaskPixel(atlas, glyphId, x, y) {
  invariant(Number.isInteger(glyphId) && glyphId >= 0 && glyphId < atlas.masks.length,
    `Glyph ID ${glyphId} is outside the atlas.`);
  if (x < 0 || y < 0 || x >= atlas.width || y >= atlas.height) return 0;
  return (atlas.masks[glyphId][y * atlas.rowStride + (x >>> 3)] >>> (7 - (x & 7))) & 1;
}
