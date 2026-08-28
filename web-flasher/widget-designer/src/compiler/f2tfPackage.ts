// ─────────────────────────────────────────────────────────────────────────────
// F2TF encoder: the target-facade asset that renders a widget's DYNAMIC pixels
// on the device.
//
// The mquickjs pipeline splits a widget in two. The base frame is the full
// HTML/CSS look, captured WYSIWYG from the browser. Everything that CHANGES is
// a target: a rect the native facade repaints from mailbox slots using this
// asset's palette, 5x7 glyph font (x1..x3 scale), and literal tables.
//
// Wire format mirrored from experiments/mquickjs-weather2-facade/design.mjs
// (buildWeather2FacadeAsset) and validated in tests with the SDK's own strict
// decoder (decodeTargetFacadeAsset) — the same validator the device build uses.
//
// The Designer emits only the CONTRACT-GENERIC formatters:
//   rootVisibility (1)  hidden driven by a slot
//   variantText   (11)  text = table[clamp(slots[0])], colour = palette0 or,
//                       when slots[1] is bound, palette[clamp(slots[1])]
//   variantRaster (12)  blit(table[clamp(slots[0])]): pre-rendered RGB565
//                       pixels, one raster per variant, each exactly the
//                       record's rect — CSS-true rendering by construction
// variantText is the v2 contract extension added for exactly this purpose;
// variantRaster is v3's. The weather-specific formatters (2..10) stay reserved
// for the flashed weather widget. Contract v1's and v2's shas are frozen.
//
// variantRaster wire form (v3; per contract.mjs's CONTRACT_V3_EXTENSION —
// section layout and header stay EXACTLY the frozen v2 shape):
//   * A raster table rides the LITERAL section as raw bytes. The record's
//     table range fields are reused: u16@36 = byte offset inside the literal
//     section, and the byte length WIDENS to the u16 at offsets 38..39 (byte
//     39 is zero for every other format, whose lengths are u8).
//   * The blob is 1..16 contiguous variants, each exactly
//     rect.width*rect.height*2 bytes of RGB565, row-major, little-endian, no
//     stride padding. The variant count is the exact quotient of the byte
//     length by rect.w*rect.h*2 — admission rejects any remainder.
//   * A formatter-12 record binds ONE value slot (properties is exactly text;
//     no colour slot — pixels carry colour) and marks every text-metadata
//     field inert the way rootVisibility does: palette0/palette1/font = 0xff,
//     align/maxChars/scale = 0.
//   * FRAMER_TF_MAX_ASSET_BYTES rises to 65,536 in v3 so the tables fit.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Facade contract v2 sha256. Source of truth:
 * experiments/mquickjs-target-facade/contract.mjs (TARGET_FACADE_CONTRACT_V2_SHA256),
 * which derives it from the canonical contract JSON. Duplicated as a literal
 * because the Designer cannot import from experiments/ (different build root);
 * test/widgetAssembler.test.ts re-reads contract.mjs and fails on drift.
 */
export const TARGET_FACADE_CONTRACT_V2_SHA256 =
  "0176edae816d6d58541cc1c04150391cf76779851a117f79f3387f527bc53ed7";

/**
 * Facade contract v3 sha256: the v2 canonical JSON with version 3,
 * `variantRaster: 12` in the formatters map, and the v3 extension fields
 * (the rasterTable encoding record and maxAssetBytes 65536). Source of truth:
 * experiments/mquickjs-target-facade/contract.mjs
 * (TARGET_FACADE_CONTRACT_V3_SHA256). Mirrored as a literal for the same
 * build-root reason as the v2 constant above; test/f2tfRaster.test.ts
 * compares this against contract.mjs's export and fails on drift.
 */
export const TARGET_FACADE_CONTRACT_V3_SHA256 =
  "455e02819595f810909a11afdcda7eb5aa0b4d6e792b154d29711ebea906631b";
/** Additive v4 contract: formatter 14 stores one alpha-aware sprite plus up
 * to 32 signed canvas positions instead of duplicating a full raster for
 * every translated state. */
export const TARGET_FACADE_CONTRACT_V4_SHA256 =
  "f72d90e8009f5d29deca6af51ec05c98c405f65f9ba88cd8794c14208b1858c9";
/** Additive v5 contract: formatter 15 interpolates compact sprite positions
 * at display cadence using the authored linear CSS transition duration. */
export const TARGET_FACADE_CONTRACT_V5_SHA256 =
  "8793b80a3c83afc8f5f28a82e01748943fa5d29670cb98a92ed52212864913ec";

export const F2TF_HEADER_BYTES = 192;
export const F2TF_TARGET_BYTES = 40;
export const F2TF_GLYPH_BYTES = 8;
export const F2TF_MAX_TARGETS = 16;
export const F2TF_MAX_GLYPHS = 64;
export const F2TF_MAX_PALETTE = 16;
export const F2TF_MAX_TEXT_BYTES = 23;
export const F2TF_MAX_OVERLAY_WRITES = 4096;
/* v3 ceiling: one full frame. The header's declared budget must cover the
 * EXACT per-render writes of every variantRaster target (rect.w*rect.h each,
 * enforced at admission in both engines) plus the glyph-era allowance for
 * text targets. */
export const F2TF_MAX_OVERLAY_WRITES_V3 = 31000;
export const F2TF_CANVAS = Object.freeze({ width: 100, height: 310 });
/** FRAMER_TF_MAX_ASSET_BYTES: 4096 through v2; v3 raises it for raster tables. */
export const F2TF_MAX_ASSET_BYTES = 65_536;
/** variantRaster tables carry 1..16 pre-rendered variants. */
export const F2TF_MAX_RASTER_VARIANTS = 16;

export const F2TF_FORMATTER = Object.freeze({
  rootVisibility: 1,
  variantText: 11,
  variantRaster: 12,
  /* Digit composition (v3): same raster-table encoding as variantRaster with
   * the count fixed at exactly 10 ("0".."9") and a power-of-ten divisor
   * (u32le at record bytes 30..33, 1|10|100|1000) extracting one decimal
   * digit from the bound slot: variant = (max(slot,0)/divisor) % 10. A
   * multi-digit number therefore costs ONE slot across its per-digit
   * subtargets. */
  digitRaster: 13,
  spriteMotion: 14,
  spriteTween: 15,
});
export const F2TF_PROPERTY = Object.freeze({ text: 1, color: 2, hidden: 4 });
/** digitRaster tables hold exactly the ten digits. */
export const F2TF_DIGIT_RASTER_VARIANTS = 10;
/** digitRaster divisors the contract admits (so ≤4 cells share one slot). */
export const F2TF_DIGIT_DIVISORS = Object.freeze([1, 10, 100, 1000]);
/** spriteMotion position tables carry 1..32 states. */
export const F2TF_MAX_SPRITE_POSITIONS = 32;

const UNUSED = 0xff;

export interface F2tfTarget {
  /** 1..15 chars, [a-z][A-Za-z0-9-]*. */
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  format: number;
  /** Property mask; must match the formatter's contract. */
  properties: number;
  /** Mailbox slots this target reads, in formatter order. */
  slots: number[];
  palette0?: number;
  palette1?: number;
  align?: 0 | 1 | 2;
  maxChars?: number;
  scale?: 1 | 2 | 3;
  /** Literal table: glyph strings selected by slot value (tableLiteral). */
  table?: string[];
  /**
   * variantRaster (12) and digitRaster (13): one pre-rendered RGB565 raster
   * per variant, each exactly width*height pixels, row-major. variantRaster
   * blits rasters[clamp(slots[0], 0, count-1)]; digitRaster holds exactly 10
   * rasters and blits rasters[(max(slots[0],0)/divisor) % 10].
   */
  rasters?: Uint16Array[];
  /** digitRaster (13) only: power-of-ten digit extractor, 1|10|100|1000. */
  divisor?: number;
  /** spriteMotion (14) / spriteTween (15): one source sprite and signed canvas
   * positions. RGB565 and alpha are parallel row-major planes. tweenMs selects
   * formatter 15's native linear interpolation and is absent for formatter 14. */
  sprite?: {
    colors: Uint16Array;
    alpha: Uint8Array;
    positions: { x: number; y: number }[];
    tweenMs?: number;
  };
}

export interface F2tfBuildOptions {
  generation: number;
  /** RGB565 base frame, exactly 31,000 pixels. */
  baseFrame: Uint16Array;
  /** The F2JS package this facade is cross-pinned to. */
  f2jsBinary: Uint8Array;
  targets: F2tfTarget[];
  /** RGB565 palette, <= 16 entries; index 0 conventionally background. */
  palette: number[];
  /** 5-column x 7-row bitmaps keyed by character. */
  glyphs: Record<string, number[]>;
  contractSha256: string;
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/* CRC32 (IEEE), matching the facade contract's implementation. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let k = 0; k < 8; k += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[n] = value >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array, zeroFrom = -1, zeroBytes = 0): number {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = zeroFrom >= 0 && index >= zeroFrom && index < zeroFrom + zeroBytes ? 0 : bytes[index];
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function sha256Bytes(bytes: Uint8Array): Promise<Uint8Array> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", copy));
}

const hex = (bytes: Uint8Array) =>
  [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

function frameToLe(frame: Uint16Array): Uint8Array {
  const bytes = new Uint8Array(frame.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < frame.length; index += 1) view.setUint16(index * 2, frame[index], true);
  return bytes;
}

const ID_PATTERN = /^[a-z][A-Za-z0-9-]{0,14}$/u;

export interface F2tfPackage {
  binary: Uint8Array;
  sha256: string;
  baseSha256: string;
  f2jsSha256: string;
  glyphCount: number;
  paletteCount: number;
  bytes: number;
  /** Total bytes of the rasters section (0 when no variantRaster targets). */
  rasterBytes: number;
  /** Per-target raster table costs, in target order (variantRaster only). */
  rasterCosts: {
    id: string; variants: number; width: number; height: number; bytes: number;
    encoding?: "sprite-motion" | "sprite-tween";
  }[];
}

/** One line per raster target, for over-budget diagnostics. */
export function describeRasterCosts(
  costs: F2tfPackage["rasterCosts"],
): string {
  return costs
    .map((cost) =>
      cost.encoding === "sprite-motion" || cost.encoding === "sprite-tween"
        ? `"#${cost.id}" one ${cost.width}×${cost.height}px RGB565+alpha sprite + ` +
          `${cost.variants} positions${cost.encoding === "sprite-tween" ? " with native tweening" : ""} = ${cost.bytes} bytes`
        : `"#${cost.id}" ${cost.variants} variant${cost.variants === 1 ? "" : "s"} × ` +
          `${cost.width}×${cost.height}px × 2 B = ${cost.bytes} bytes`)
    .join("; ");
}

export async function buildF2tfPackage(options: F2tfBuildOptions): Promise<F2tfPackage> {
  const { generation, baseFrame, f2jsBinary, targets, palette, glyphs, contractSha256 } = options;
  invariant(baseFrame instanceof Uint16Array && baseFrame.length === 31_000,
    "F2TF requires the exact 100x310 RGB565 base frame.");
  invariant(targets.length >= 1 && targets.length <= F2TF_MAX_TARGETS,
    `F2TF supports 1..${F2TF_MAX_TARGETS} targets; got ${targets.length}.`);
  invariant(palette.length >= 1 && palette.length <= F2TF_MAX_PALETTE,
    `F2TF palette must be 1..${F2TF_MAX_PALETTE} colours.`);
  invariant(/^[0-9a-f]{64}$/u.test(contractSha256), "F2TF needs the facade contract sha256.");

  // Glyph table: sorted unique byte codes, 5 columns, 7 rows in bits 0..6.
  const glyphEntries = Object.entries(glyphs)
    .map(([character, columns]) => {
      invariant(character.length === 1, `Glyph key ${JSON.stringify(character)} must be one character.`);
      invariant(Array.isArray(columns) && columns.length === 5 &&
        columns.every((column) => Number.isInteger(column) && column >= 0 && column <= 0x7f),
      `Glyph ${character} must be five 7-bit columns.`);
      return { code: character.charCodeAt(0) & 0xff, columns };
    })
    .sort((left, right) => left.code - right.code);
  invariant(glyphEntries.length >= 1 && glyphEntries.length <= F2TF_MAX_GLYPHS,
    `F2TF supports 1..${F2TF_MAX_GLYPHS} glyphs; got ${glyphEntries.length}.`);
  invariant(new Set(glyphEntries.map((entry) => entry.code)).size === glyphEntries.length,
    "F2TF glyph codes must be unique.");
  const glyphCodes = new Set(glyphEntries.map((entry) => entry.code));

  const glyphSection = new Uint8Array(glyphEntries.length * F2TF_GLYPH_BYTES);
  glyphEntries.forEach((entry, index) => {
    const at = index * F2TF_GLYPH_BYTES;
    glyphSection[at] = entry.code;
    glyphSection[at + 1] = 5;
    entry.columns.forEach((column, columnIndex) => { glyphSection[at + 2 + columnIndex] = column; });
    glyphSection[at + 7] = 6;
  });

  const paletteSection = new Uint8Array(palette.length * 2);
  {
    const view = new DataView(paletteSection.buffer);
    palette.forEach((color, index) => {
      invariant(Number.isInteger(color) && color >= 0 && color <= 0xffff,
        `Palette entry ${index} must be RGB565.`);
      view.setUint16(index * 2, color, true);
    });
  }

  // Literal tables, deduplicated by content: identical variant lists share
  // storage, which is what keeps sixteen digit targets cheap.
  const literalChunks: Uint8Array[] = [];
  const literalRanges = new Map<string, { offset: number; bytes: number }>();
  let literalCursor = 0;
  const encoder = new TextEncoder();
  const tableRange = (table: string[]): { offset: number; bytes: number } => {
    // Table wire form: [count][len0]bytes0[len1]bytes1...
    const parts: number[] = [table.length];
    for (const text of table) {
      const bytes = encoder.encode(text);
      invariant(bytes.length >= 1 && bytes.length <= F2TF_MAX_TEXT_BYTES,
        `Table literal ${JSON.stringify(text)} must be 1..${F2TF_MAX_TEXT_BYTES} bytes.`);
      for (const byte of bytes) invariant(glyphCodes.has(byte),
        `Literal ${JSON.stringify(text)} uses a glyph that is not in the font.`);
      parts.push(bytes.length, ...bytes);
    }
    const encoded = Uint8Array.from(parts);
    const key = hexOf(encoded);
    const existing = literalRanges.get(key);
    if (existing) return existing;
    const range = { offset: literalCursor, bytes: encoded.length };
    literalRanges.set(key, range);
    literalChunks.push(encoded);
    literalCursor += encoded.length;
    return range;
  };
  const hexOf = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

  invariant(targets[0].format === F2TF_FORMATTER.rootVisibility,
    "F2TF target 0 must be the root visibility target — the facade reads its hidden bit.");
  // The decoder validates all sixteen records, so unused entries are padded
  // with inert visibility spares (no text, no colour, nothing painted).
  const padded: F2tfTarget[] = [...targets];
  const spareNames = "abcdefghijklmnop";
  while (padded.length < F2TF_MAX_TARGETS) {
    padded.push({
      id: `spare-${spareNames[padded.length]}`,
      x: 0, y: 0, width: 1, height: 1,
      format: F2TF_FORMATTER.rootVisibility,
      properties: F2TF_PROPERTY.hidden,
      slots: [15],
    });
  }

  // Raster table accounting for budget diagnostics; the bytes themselves ride
  // the literal section (contract v3), appended in target order.
  const rasterCosts: F2tfPackage["rasterCosts"] = [];
  let rasterBytesTotal = 0;

  const targetSection = new Uint8Array(F2TF_MAX_TARGETS * F2TF_TARGET_BYTES);
  targetSection.fill(0);
  const seenIds = new Set<string>();
  padded.forEach((target, index) => {
    const at = index * F2TF_TARGET_BYTES;
    invariant(ID_PATTERN.test(target.id) && !seenIds.has(target.id),
      `Target id ${JSON.stringify(target.id)} is invalid or duplicated.`);
    seenIds.add(target.id);
    encoder.encodeInto(target.id, targetSection.subarray(at, at + 15));
    const view = new DataView(targetSection.buffer);
    invariant(target.width > 0 && target.height > 0 &&
      target.x + target.width <= F2TF_CANVAS.width && target.y + target.height <= F2TF_CANVAS.height,
    `Target ${target.id} geometry escapes the canvas.`);
    view.setUint16(at + 16, target.x, true);
    view.setUint16(at + 18, target.y, true);
    view.setUint16(at + 20, target.width, true);
    view.setUint16(at + 22, target.height, true);
    targetSection[at + 24] = target.properties;
    targetSection[at + 25] = target.format;
    const slots = [...target.slots, UNUSED, UNUSED, UNUSED, UNUSED].slice(0, 4);
    slots.forEach((slot, slotIndex) => {
      invariant(slot === UNUSED || (Number.isInteger(slot) && slot >= 0 && slot <= 15),
        `Target ${target.id} slot ${slotIndex} is invalid.`);
      targetSection[at + 26 + slotIndex] = slot;
    });
    if (target.format === F2TF_FORMATTER.rootVisibility) {
      invariant(target.properties === F2TF_PROPERTY.hidden,
        `rootVisibility target ${target.id} must declare exactly the hidden property.`);
      targetSection[at + 30] = UNUSED;
      targetSection[at + 31] = UNUSED;
      targetSection[at + 32] = UNUSED;
      targetSection[at + 34] = 0;
      targetSection[at + 35] = 0;
      // No table for visibility.
      view.setUint16(at + 36, 0, true);
      targetSection[at + 38] = 0;
    } else if (target.format === F2TF_FORMATTER.variantRaster ||
        target.format === F2TF_FORMATTER.digitRaster) {
      // The record binds the value slot only; pixels carry colour, so the
      // text-metadata fields are inert the same way rootVisibility's are —
      // except digitRaster, whose bytes 30..33 carry the digit divisor.
      invariant(target.properties === F2TF_PROPERTY.text,
        `variantRaster target ${target.id} must declare exactly the text property (1).`);
      invariant(target.slots.length === 1,
        `variantRaster target ${target.id} binds exactly one value slot; got ${target.slots.length}.`);
      if (target.format === F2TF_FORMATTER.digitRaster) {
        // digitRaster metadata: bytes 30..33 hold the u32 power-of-ten
        // divisor extracting one decimal digit from the bound slot; the rest
        // of the text metadata stays inert.
        const divisor = target.divisor;
        invariant(typeof divisor === "number" && (F2TF_DIGIT_DIVISORS as readonly number[]).includes(divisor),
          `digitRaster target ${target.id} needs a power-of-ten divisor ` +
            `(${F2TF_DIGIT_DIVISORS.join("|")}); got ${divisor}.`);
        view.setUint32(at + 30, divisor, true);
      } else {
        targetSection[at + 30] = UNUSED;
        targetSection[at + 31] = UNUSED;
        targetSection[at + 32] = UNUSED;
        targetSection[at + 33] = 0;
      }
      targetSection[at + 34] = 0;
      targetSection[at + 35] = 0;
      const rasters = target.rasters;
      invariant(Array.isArray(rasters) && rasters.length >= 1 &&
        rasters.length <= F2TF_MAX_RASTER_VARIANTS,
        `variantRaster target ${target.id} needs 1..${F2TF_MAX_RASTER_VARIANTS} rasters; ` +
          `got ${Array.isArray(rasters) ? rasters.length : typeof rasters}.`);
      invariant(target.format !== F2TF_FORMATTER.digitRaster ||
        rasters.length === F2TF_DIGIT_RASTER_VARIANTS,
        `digitRaster target ${target.id} holds exactly the ten digit rasters; got ${rasters.length}.`);
      const pixels = target.width * target.height;
      rasters.forEach((raster, variant) => {
        invariant(raster instanceof Uint16Array && raster.length === pixels,
          `variantRaster target ${target.id} variant ${variant} must be exactly ` +
            `${target.width}×${target.height} = ${pixels} RGB565 pixels; got ` +
            `${raster instanceof Uint16Array ? raster.length : typeof raster}.`);
      });
      // Table bytes are exact by construction: count * w * h * 2, contiguous.
      const tableBytes = new Uint8Array(rasters.length * pixels * 2);
      const tableView = new DataView(tableBytes.buffer);
      rasters.forEach((raster, variant) => {
        const variantAt = variant * pixels * 2;
        for (let pixel = 0; pixel < pixels; pixel += 1) {
          tableView.setUint16(variantAt + pixel * 2, raster[pixel], true);
        }
      });
      // The blob rides the literal section; offset u16@36, byte length
      // u16@38..39 (the count is the exact quotient by w*h*2). No dedupe: a
      // shared blob would make per-target budget costs lie. Values that would
      // overflow the u16 fields imply an asset beyond the 65,536-byte cap,
      // which the cap check below rejects with the itemized costs.
      view.setUint16(at + 36, literalCursor & 0xffff, true);
      view.setUint16(at + 38, tableBytes.length & 0xffff, true);
      literalChunks.push(tableBytes);
      literalCursor += tableBytes.length;
      rasterCosts.push({
        id: target.id, variants: rasters.length,
        width: target.width, height: target.height, bytes: tableBytes.length,
      });
      rasterBytesTotal += tableBytes.length;
    } else if (target.format === F2TF_FORMATTER.spriteMotion ||
               target.format === F2TF_FORMATTER.spriteTween) {
      const tweened = target.format === F2TF_FORMATTER.spriteTween;
      invariant(target.properties === F2TF_PROPERTY.text,
        `compact sprite target ${target.id} must declare exactly the text property (1).`);
      invariant(target.slots.length === 1,
        `compact sprite target ${target.id} binds exactly one value slot; got ${target.slots.length}.`);
      targetSection[at + 30] = UNUSED;
      targetSection[at + 31] = UNUSED;
      targetSection[at + 32] = UNUSED;
      targetSection[at + 33] = 0;
      targetSection[at + 34] = 0;
      targetSection[at + 35] = 0;
      const sprite = target.sprite;
      const pixels = target.width * target.height;
      invariant(sprite && sprite.colors instanceof Uint16Array && sprite.colors.length === pixels &&
        sprite.alpha instanceof Uint8Array && sprite.alpha.length === pixels,
      `compact sprite target ${target.id} needs exact ${target.width}×${target.height} RGB565 and alpha planes.`);
      invariant(Array.isArray(sprite.positions) && sprite.positions.length >= 1 &&
        sprite.positions.length <= F2TF_MAX_SPRITE_POSITIONS,
      `compact sprite target ${target.id} needs 1..${F2TF_MAX_SPRITE_POSITIONS} positions; ` +
        `got ${Array.isArray(sprite.positions) ? sprite.positions.length : typeof sprite.positions}.`);
      invariant(!tweened || Number.isInteger(sprite.tweenMs) && sprite.tweenMs! >= 1 && sprite.tweenMs! <= 0xffff,
        `spriteTween target ${target.id} needs an integer 1..65535 ms transition duration.`);
      const tableBytes = new Uint8Array(8 + sprite.positions.length * 4 + pixels * 3);
      const tableView = new DataView(tableBytes.buffer);
      tableBytes[0] = 1; // table version
      tableBytes[1] = tweened ? 1 : 0;
      tableBytes[2] = sprite.positions.length;
      tableBytes[3] = 1; // RGB565 + alpha8 planes
      if (tweened) {
        tableView.setUint16(4, sprite.tweenMs!, true);
        tableBytes[6] = 0; // linear easing
        tableBytes[7] = 0;
      } else {
        tableView.setInt16(4, 0, true);
        tableView.setInt16(6, 0, true);
      }
      sprite.positions.forEach((position, positionIndex) => {
        invariant(Number.isInteger(position.x) && position.x >= -target.width && position.x <= F2TF_CANVAS.width &&
          Number.isInteger(position.y) && position.y >= -target.height && position.y <= F2TF_CANVAS.height,
        `compact sprite target ${target.id} position ${positionIndex} escapes the bounded canvas range.`);
        tableView.setInt16(8 + positionIndex * 4, position.x, true);
        tableView.setInt16(10 + positionIndex * 4, position.y, true);
      });
      const colorsAt = 8 + sprite.positions.length * 4;
      for (let pixel = 0; pixel < pixels; pixel += 1) {
        tableView.setUint16(colorsAt + pixel * 2, sprite.colors[pixel], true);
      }
      tableBytes.set(sprite.alpha, colorsAt + pixels * 2);
      invariant(tableBytes.length <= 0xffff,
        `compact sprite target ${target.id} table exceeds its u16 byte range.`);
      view.setUint16(at + 36, literalCursor, true);
      view.setUint16(at + 38, tableBytes.length, true);
      literalChunks.push(tableBytes);
      literalCursor += tableBytes.length;
      rasterCosts.push({
        id: target.id, variants: sprite.positions.length,
        width: target.width, height: target.height, bytes: tableBytes.length,
        encoding: tweened ? "sprite-tween" : "sprite-motion",
      });
      rasterBytesTotal += tableBytes.length;
    } else {
      invariant(target.format === F2TF_FORMATTER.variantText,
        `Target ${target.id}: the Designer emits only generic formatters (1, 11, 12, 13, 14, 15); got ${target.format}.`);
      invariant(target.properties === F2TF_PROPERTY.text ||
        target.properties === (F2TF_PROPERTY.text | F2TF_PROPERTY.color),
        `variantText target ${target.id} must declare text, optionally with color.`);
      const palette0 = target.palette0 ?? 1;
      const palette1 = target.palette1 ?? palette0;
      invariant(palette0 < palette.length && palette1 < palette.length,
        `Target ${target.id} palette indices escape the palette.`);
      targetSection[at + 30] = palette0;
      targetSection[at + 31] = palette1;
      targetSection[at + 32] = 0;
      targetSection[at + 33] = target.align ?? 0;
      const maxChars = target.maxChars ?? Math.max(...(target.table ?? [""]).map((t) => t.length), 1);
      invariant(maxChars >= 1 && maxChars <= F2TF_MAX_TEXT_BYTES,
        `Target ${target.id} maxChars must be 1..${F2TF_MAX_TEXT_BYTES}.`);
      targetSection[at + 34] = maxChars;
      targetSection[at + 35] = target.scale ?? 1;
      invariant(Array.isArray(target.table) && target.table.length >= 1,
        `tableLiteral target ${target.id} needs at least one literal.`);
      const range = tableRange(target.table);
      invariant(range.bytes <= 0xff, `Target ${target.id} literal table exceeds 255 bytes.`);
      view.setUint16(at + 36, range.offset, true);
      targetSection[at + 38] = range.bytes;
    }
  });

  const literalSection = new Uint8Array(literalCursor);
  {
    let cursor = 0;
    for (const chunk of literalChunks) {
      literalSection.set(chunk, cursor);
      cursor += chunk.length;
    }
  }

  const targetsAt = F2TF_HEADER_BYTES;
  const paletteAt = targetsAt + targetSection.length;
  const glyphsAt = paletteAt + paletteSection.length;
  const literalsAt = glyphsAt + glyphSection.length;
  const totalBytes = literalsAt + literalSection.length;
  invariant(totalBytes <= F2TF_MAX_ASSET_BYTES,
    `F2TF asset is ${totalBytes} bytes; the v3/v4/v5 cap is ${F2TF_MAX_ASSET_BYTES}. ` +
      `Raster tables cost ${rasterBytesTotal} bytes: ${describeRasterCosts(rasterCosts)}. ` +
      `Shrink target rects or variant counts.`);
  const binary = new Uint8Array(totalBytes);
  const view = new DataView(binary.buffer);

  binary.set([0x46, 0x32, 0x54, 0x46], 0); // "F2TF"
  view.setUint16(4, 1, true);
  view.setUint16(6, F2TF_HEADER_BYTES, true);
  view.setUint32(8, binary.length, true);
  view.setUint32(12, generation >>> 0, true);
  view.setUint16(16, F2TF_CANVAS.width, true);
  view.setUint16(18, F2TF_CANVAS.height, true);
  binary[20] = 1;
  binary[21] = F2TF_MAX_TARGETS;
  binary[22] = F2TF_TARGET_BYTES;
  binary[23] = palette.length;
  view.setUint16(24, glyphEntries.length, true);
  binary[26] = F2TF_GLYPH_BYTES;
  binary[27] = 5;
  binary[28] = 7;
  binary[29] = 6;
  binary[30] = F2TF_MAX_TEXT_BYTES;
  {
    // Declared per-render budget: exact raster requirement + the historical
    // glyph allowance. Admission (JS and C) refuses any asset whose raster
    // targets cannot fit this, so compute it honestly here and fail loudly
    // when the design simply cannot render within the frame ceiling.
    const rasterWrites = targets.reduce((sum, target) =>
      target.format === 12 || target.format === 13 || target.format === 14 || target.format === 15
        ? sum + target.width * target.height : sum, 0);
    const overlayBudget = Math.min(F2TF_MAX_OVERLAY_WRITES_V3,
      F2TF_MAX_OVERLAY_WRITES + rasterWrites);
    invariant(rasterWrites <= overlayBudget,
      `Raster targets need ${rasterWrites} overlay writes/render, over the ${F2TF_MAX_OVERLAY_WRITES_V3} frame ceiling.`);
    view.setUint32(32, overlayBudget, true);
  }
  view.setUint32(36, targetsAt, true);
  view.setUint32(40, targetSection.length, true);
  view.setUint32(44, paletteAt, true);
  view.setUint32(48, paletteSection.length, true);
  view.setUint32(52, glyphsAt, true);
  view.setUint32(56, glyphSection.length, true);
  view.setUint32(60, literalsAt, true);
  view.setUint32(64, literalSection.length, true);
  // Bytes 80..96 stay reserved-zero in v3 exactly as in v2: raster tables
  // ride the literal section, so no new header fields exist.

  const baseBytes = frameToLe(baseFrame);
  view.setUint32(68, crc32(baseBytes), true);
  binary.set(await sha256Bytes(baseBytes), 96);
  const f2jsSha = await sha256Bytes(f2jsBinary);
  binary.set(f2jsSha, 128);
  binary.set(Uint8Array.from(contractSha256.match(/../gu)!.map((pair) => parseInt(pair, 16))), 160);

  binary.set(targetSection, targetsAt);
  binary.set(paletteSection, paletteAt);
  binary.set(glyphSection, glyphsAt);
  binary.set(literalSection, literalsAt);

  view.setUint32(72, crc32(binary.subarray(F2TF_HEADER_BYTES)), true);
  view.setUint32(76, crc32(binary.subarray(0, F2TF_HEADER_BYTES), 76, 4), true);

  return {
    binary,
    sha256: hex(await sha256Bytes(binary)),
    baseSha256: hex(await sha256Bytes(baseBytes)),
    f2jsSha256: hex(f2jsSha),
    glyphCount: glyphEntries.length,
    paletteCount: palette.length,
    bytes: binary.length,
    rasterBytes: rasterBytesTotal,
    rasterCosts,
  };
}
