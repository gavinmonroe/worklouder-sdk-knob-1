import { createHash } from "node:crypto";

export const TARGET_FACADE_FORMAT = "framer-mquickjs-target-facade-v1";
export const TARGET_FACADE_PROFILE = "weather-slot-target-facade-v1";
export const TARGET_FACADE_HEADER_BYTES = 192;
export const TARGET_FACADE_TARGET_BYTES = 40;
export const TARGET_FACADE_GLYPH_BYTES = 8;
export const TARGET_FACADE_CANVAS = Object.freeze({ width: 100, height: 310,
  pixels: 31_000, pixelFormat: "rgb565-le" });
export const TARGET_FACADE_MAX_OVERLAY_WRITES = 4_096;
export const TARGET_FACADE_MAX_TEXT_BYTES = 23;

export const TARGET_FACADE_RESULT = Object.freeze({
  ok: 0, hidden: 1, argument: 2, wrongThread: 3, malformed: 4, crc: 5,
  base: 6, torn: 7, generation: 8, revision: 9, format: 10, overflow: 11,
});

export const TARGET_FACADE_PROPERTY = Object.freeze({ text: 1, color: 2, hidden: 4 });
export const TARGET_FACADE_FORMATTER = Object.freeze({
  rootVisibility: 1,
  tableLiteral: 2,
  status: 3,
  packedTemperature: 4,
  currentCondition: 5,
  age: 6,
  weekday: 7,
  dayCondition: 8,
  temperaturePair: 9,
  retry: 10,
  /* Generic variant text: literal = table[clamp(slots[0])], colour = palette0
   * or, when slots[1] is bound, palette[clamp(slots[1])]. Unlike 2..10 it is
   * independent of the weather flags word, has a variable literal count, and
   * exists so ANY widget's pick()-style text can render without borrowing
   * weather semantics. */
  variantText: 11,
  /* Design-true raster variants: the record binds ONE value slot (properties
   * is exactly `text`; slots 1..3 stay UNUSED) and its table is 1..16
   * pre-rendered RGB565 rasters, each exactly rect.w*rect.h*2 bytes
   * (little-endian per pixel, row-major, no stride padding, contiguous in
   * variant order). Render blits table[clamp(slots[value], 0, count-1)] over
   * the whole rect — the pixels carry colour, so no palette or glyph state is
   * consulted and no base pixel survives inside the rect. Flag-word
   * independent like variantText. */
  variantRaster: 12, digitRaster: 13,
});

/* The v1 canonical is FROZEN: its sha is embedded in the flashed weather asset
 * and pinned across the canary release evidence. variantText lives only in the
 * v2 canonical below, so every existing verifier keeps passing byte-for-byte. */
const CONTRACT_FORMATTERS_V1 = Object.freeze({
  rootVisibility: 1, tableLiteral: 2, status: 3, packedTemperature: 4,
  currentCondition: 5, age: 6, weekday: 7, dayCondition: 8,
  temperaturePair: 9, retry: 10,
});
/* The v2 canonical is FROZEN in turn: its sha is pinned by the hardware-proven
 * widget-upload evidence. variantRaster lives only in the v3 canonical, which
 * additionally carries the raster table encoding and the raised asset cap. */
const CONTRACT_FORMATTERS_V2 = Object.freeze({
  rootVisibility: 1, tableLiteral: 2, status: 3, packedTemperature: 4,
  currentCondition: 5, age: 6, weekday: 7, dayCondition: 8,
  temperaturePair: 9, retry: 10, variantText: 11,
});
export const TARGET_FACADE_MAX_ASSET_BYTES = 65_536;
/* v3 raises the per-render overlay budget to one full frame: variantRaster
 * blits write exactly rect.w*rect.h pixels, so realistic widgets (the weather
 * example needs ~5,400) blew the glyph-era 4,096 while the admission happily
 * passed them - an admit-pass/render-fail split that reached hardware as a
 * black screen.  31,000 is the physical ceiling (the base decode already
 * rewrites every framebuffer pixel each tick), and admission now proves
 * formatter-12 targets fit the declared budget, so admit-pass implies
 * render-cannot-overflow. */
export const TARGET_FACADE_MAX_OVERLAY_WRITES_V3 = 31_000;
/* Parallel table KIND for formatter 12: the record's table range fields are
 * reused, but the byte length widens to the u16 at offsets 38..39 (byte 39 is
 * zero for every other format) and the blob is raw pixels — the variant count
 * is the exact quotient of the byte length by rect.w*rect.h*2. */
const CONTRACT_V3_EXTENSION = Object.freeze({
  rasterTable: Object.freeze({ pixelFormat: "rgb565-le", order: "row-major",
    stridePadding: 0, variants: Object.freeze({ min: 1, max: 16 }),
    record: Object.freeze({ offset: "u16le@36", bytes: "u16le@38" }),
    bytesRule: "count*rect.width*rect.height*2" }),
  maxAssetBytes: TARGET_FACADE_MAX_ASSET_BYTES,
  limits: Object.freeze({ overlayPixelWrites: TARGET_FACADE_MAX_OVERLAY_WRITES_V3,
    textBytes: TARGET_FACADE_MAX_TEXT_BYTES,
    admitRule: "sum(formatter-12/13 rect areas) <= header.maxOverlayWrites" }),
  digitRaster: Object.freeze({ format: 13, divisor: "u32le@30 power-of-ten 1..1000",
    table: "exactly 10 raster variants", pick: "(max(slot,0)/divisor) % 10" }),
});
const contractCanonical = (version, formatters, extension = {}) => JSON.stringify({
  format: TARGET_FACADE_FORMAT,
  profile: TARGET_FACADE_PROFILE,
  version,
  canvas: TARGET_FACADE_CANVAS,
  headerBytes: TARGET_FACADE_HEADER_BYTES,
  targetBytes: TARGET_FACADE_TARGET_BYTES,
  targetCount: 16,
  glyph: { recordBytes: TARGET_FACADE_GLYPH_BYTES, width: 5, height: 7, advance: 6 },
  limits: { overlayPixelWrites: TARGET_FACADE_MAX_OVERLAY_WRITES,
    textBytes: TARGET_FACADE_MAX_TEXT_BYTES },
  mailbox: { bytes: 72, sequence: "u32-seqlock", slots: "16xi32", generation: "u32" },
  properties: TARGET_FACADE_PROPERTY,
  formatters,
  ...extension,
});
const CONTRACT_CANONICAL = contractCanonical(1, CONTRACT_FORMATTERS_V1);

export const TARGET_FACADE_CONTRACT_V3_SHA256 = createHash("sha256")
  .update(contractCanonical(3, TARGET_FACADE_FORMATTER, CONTRACT_V3_EXTENSION)).digest("hex");
export const TARGET_FACADE_CONTRACT_V2_SHA256 = createHash("sha256")
  .update(contractCanonical(2, CONTRACT_FORMATTERS_V2)).digest("hex");
export const TARGET_FACADE_CONTRACT_SHA256 = createHash("sha256")
  .update(CONTRACT_CANONICAL).digest("hex");

const PALETTE = Object.freeze([
  0xefdf, // ice white
  0x8d57, // muted slate
  0x561f, // live sky
  0x6cf3, // stale blue-gray
  0xf4cd, // error coral
  0x3b0e, // dim blue
  0x0000, // black
  0xfd20, // amber
]);

/* Conventional 5x7 column masks. Every dynamic dictionary byte is admitted
 * only when a matching record is present in this companion asset. */
const COLUMNS = Object.freeze({
  " ": [0x00, 0x00, 0x00, 0x00, 0x00],
  "-": [0x08, 0x08, 0x08, 0x08, 0x08],
  "0": [0x3e, 0x51, 0x49, 0x45, 0x3e], "1": [0x00, 0x42, 0x7f, 0x40, 0x00],
  "2": [0x42, 0x61, 0x51, 0x49, 0x46], "3": [0x21, 0x41, 0x45, 0x4b, 0x31],
  "4": [0x18, 0x14, 0x12, 0x7f, 0x10], "5": [0x27, 0x45, 0x45, 0x45, 0x39],
  "6": [0x3c, 0x4a, 0x49, 0x49, 0x30], "7": [0x01, 0x71, 0x09, 0x05, 0x03],
  "8": [0x36, 0x49, 0x49, 0x49, 0x36], "9": [0x06, 0x49, 0x49, 0x29, 0x1e],
  A: [0x7e, 0x11, 0x11, 0x11, 0x7e], B: [0x7f, 0x49, 0x49, 0x49, 0x36],
  C: [0x3e, 0x41, 0x41, 0x41, 0x22], D: [0x7f, 0x41, 0x41, 0x22, 0x1c],
  E: [0x7f, 0x49, 0x49, 0x49, 0x41], F: [0x7f, 0x09, 0x09, 0x09, 0x01],
  G: [0x3e, 0x41, 0x49, 0x49, 0x7a], H: [0x7f, 0x08, 0x08, 0x08, 0x7f],
  I: [0x00, 0x41, 0x7f, 0x41, 0x00], J: [0x20, 0x40, 0x41, 0x3f, 0x01],
  K: [0x7f, 0x08, 0x14, 0x22, 0x41], L: [0x7f, 0x40, 0x40, 0x40, 0x40],
  M: [0x7f, 0x02, 0x0c, 0x02, 0x7f], N: [0x7f, 0x04, 0x08, 0x10, 0x7f],
  O: [0x3e, 0x41, 0x41, 0x41, 0x3e], P: [0x7f, 0x09, 0x09, 0x09, 0x06],
  Q: [0x3e, 0x41, 0x51, 0x21, 0x5e], R: [0x7f, 0x09, 0x19, 0x29, 0x46],
  S: [0x46, 0x49, 0x49, 0x49, 0x31], T: [0x01, 0x01, 0x7f, 0x01, 0x01],
  U: [0x3f, 0x40, 0x40, 0x40, 0x3f], V: [0x1f, 0x20, 0x40, 0x20, 0x1f],
  W: [0x7f, 0x20, 0x18, 0x20, 0x7f], X: [0x63, 0x14, 0x08, 0x14, 0x63],
  Y: [0x03, 0x04, 0x78, 0x04, 0x03], Z: [0x61, 0x51, 0x49, 0x45, 0x43],
  "°": [0x06, 0x09, 0x09, 0x06, 0x00],
});

const ALIGN = Object.freeze({ left: 0, center: 1, right: 2 });
const UNUSED = 0xff;
const bytes = (text) => Buffer.from([...String(text)].map((character) =>
  character === "°" ? 0xb0 : character.charCodeAt(0)));

function table(strings) {
  const values = strings.map(bytes);
  if (values.length > 255 || values.some((value) => value.length > TARGET_FACADE_MAX_TEXT_BYTES)) {
    throw new Error("Target facade literal table exceeds its bounded representation.");
  }
  return Buffer.concat([Buffer.from([values.length]), ...values.map((value) =>
    Buffer.concat([Buffer.from([value.length]), value]))]);
}

const TABLES = Object.freeze({
  none: Buffer.alloc(0), place: table(["CHICAGO"]),
  status: table(["WAITING", "LIVE", "STALE", "LAST GOOD", "OFFLINE"]),
  unit: table(["F"]),
  conditions: table(["SUNNY", "PARTLY", "CLOUDY", "FOG", "DRIZZLE", "RAIN", "SNOW", "STORM",
    "CLEAR", "PARTLY", "CLOUDY", "FOG", "DRIZZLE", "RAIN", "SNOW", "STORM", "WAITING"]),
  age: table(["S AGO", "M AGO", "H AGO"]),
  weekdays: table(["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT", "---"]),
  retry: table(["RETRY "]),
});

const target = (id, x, y, width, height, properties, format, slots, palette0, palette1,
  align, maxChars, scale, tableName = "none") => Object.freeze({ id, x, y, width, height,
  properties, format, slots: Object.freeze([...slots, UNUSED, UNUSED, UNUSED, UNUSED].slice(0, 4)),
  palette0, palette1, font: format === TARGET_FACADE_FORMATTER.rootVisibility ? UNUSED : 0,
  align: ALIGN[align], maxChars, scale, tableName });

export const WEATHER_TARGET_FACADE_TARGETS = Object.freeze([
  target("weatherScreen", 0, 0, 100, 310, 4, 1, [15], UNUSED, UNUSED, "left", 0, 0),
  target("place", 8, 13, 84, 10, 1, 2, [], 0, 0, "left", 12, 1, "place"),
  target("status", 54, 13, 38, 10, 3, 3, [13, 15], 2, 3, "right", 10, 1, "status"),
  target("currentTemp", 14, 75, 72, 32, 1, 4, [1, 15], 0, 0, "left", 7, 2, "unit"),
  target("currentCond", 14, 112, 72, 12, 3, 5, [2, 15], 2, 1, "left", 10, 1, "conditions"),
  target("age", 42, 130, 46, 9, 1, 6, [12, 15], 1, 1, "right", 10, 1, "age"),
  target("d1Name", 12, 166, 22, 9, 1, 7, [3, 15], 0, 0, "left", 3, 1, "weekdays"),
  target("d1Cond", 12, 178, 42, 9, 3, 8, [3, 15], 1, 2, "left", 8, 1, "conditions"),
  target("d1Temps", 43, 170, 45, 10, 1, 9, [4, 5, 15], 0, 0, "right", 11, 1, "unit"),
  target("d2Name", 12, 207, 22, 9, 1, 7, [6, 15], 0, 0, "left", 3, 1, "weekdays"),
  target("d2Cond", 12, 219, 42, 9, 3, 8, [6, 15], 1, 2, "left", 8, 1, "conditions"),
  target("d2Temps", 43, 211, 45, 10, 1, 9, [7, 8, 15], 0, 0, "right", 11, 1, "unit"),
  target("d3Name", 12, 248, 22, 9, 1, 7, [9, 15], 0, 0, "left", 3, 1, "weekdays"),
  target("d3Cond", 12, 260, 42, 9, 3, 8, [9, 15], 1, 2, "left", 8, 1, "conditions"),
  target("d3Temps", 43, 252, 45, 10, 1, 9, [10, 11, 15], 0, 0, "right", 11, 1, "unit"),
  target("retry", 8, 296, 84, 9, 7, 10, [14, 15], 4, 4, "center", 12, 1, "retry"),
]);

export function crc32(value, { zeroFrom = -1, zeroBytes = 0 } = {}) {
  const binary = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  let crc = 0xffffffff;
  for (let index = 0; index < binary.length; index++) {
    let byte = index >= zeroFrom && index < zeroFrom + zeroBytes ? 0 : binary[index];
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function sha256(value) { return createHash("sha256").update(value).digest(); }

function encodeGlyphs() {
  return Buffer.concat(Object.entries(COLUMNS).map(([character, columns]) => {
    const record = Buffer.alloc(TARGET_FACADE_GLYPH_BYTES);
    record[0] = character === "°" ? 0xb0 : character.charCodeAt(0);
    record[1] = 5;
    columns.forEach((column, index) => { record[2 + index] = column; });
    record[7] = 6;
    return record;
  }).sort((left, right) => left[0] - right[0]));
}

export function buildWeatherTargetFacadeAsset({ generation = 18, baseFrame, f2jsBinary } = {}) {
  if (!(baseFrame instanceof Uint16Array) || baseFrame.length !== TARGET_FACADE_CANVAS.pixels) {
    throw new TypeError("Target facade requires one exact 100x310 RGB565 base frame.");
  }
  if (!(f2jsBinary instanceof Uint8Array)) throw new TypeError("Target facade requires its exact F2JS package.");
  const glyphs = encodeGlyphs();
  const palette = Buffer.alloc(PALETTE.length * 2);
  PALETTE.forEach((color, index) => palette.writeUInt16LE(color, index * 2));
  const literalParts = [];
  const literalRanges = new Map();
  let literalCursor = 0;
  for (const [name, value] of Object.entries(TABLES)) {
    literalRanges.set(name, { offset: literalCursor, bytes: value.length });
    literalParts.push(value); literalCursor += value.length;
  }
  const literals = Buffer.concat(literalParts);
  const targetBytes = Buffer.alloc(WEATHER_TARGET_FACADE_TARGETS.length * TARGET_FACADE_TARGET_BYTES);
  WEATHER_TARGET_FACADE_TARGETS.forEach((entry, index) => {
    const at = index * TARGET_FACADE_TARGET_BYTES;
    const id = Buffer.from(entry.id, "ascii");
    if (id.length < 1 || id.length > 15) throw new Error(`Invalid target ID ${entry.id}.`);
    id.copy(targetBytes, at);
    targetBytes.writeUInt16LE(entry.x, at + 16); targetBytes.writeUInt16LE(entry.y, at + 18);
    targetBytes.writeUInt16LE(entry.width, at + 20); targetBytes.writeUInt16LE(entry.height, at + 22);
    targetBytes[at + 24] = entry.properties; targetBytes[at + 25] = entry.format;
    entry.slots.forEach((slot, slotIndex) => { targetBytes[at + 26 + slotIndex] = slot; });
    targetBytes[at + 30] = entry.palette0; targetBytes[at + 31] = entry.palette1;
    targetBytes[at + 32] = entry.font; targetBytes[at + 33] = entry.align;
    targetBytes[at + 34] = entry.maxChars; targetBytes[at + 35] = entry.scale;
    const range = literalRanges.get(entry.tableName);
    targetBytes.writeUInt16LE(range.offset, at + 36); targetBytes[at + 38] = range.bytes;
  });
  const targetsAt = TARGET_FACADE_HEADER_BYTES;
  const paletteAt = targetsAt + targetBytes.length;
  const glyphsAt = paletteAt + palette.length;
  const literalsAt = glyphsAt + glyphs.length;
  const binary = Buffer.alloc(literalsAt + literals.length);
  binary.write("F2TF", 0, "ascii"); binary.writeUInt16LE(1, 4);
  binary.writeUInt16LE(TARGET_FACADE_HEADER_BYTES, 6); binary.writeUInt32LE(binary.length, 8);
  binary.writeUInt32LE(generation, 12); binary.writeUInt16LE(100, 16); binary.writeUInt16LE(310, 18);
  binary[20] = 1; binary[21] = 16; binary[22] = TARGET_FACADE_TARGET_BYTES;
  binary[23] = PALETTE.length; binary.writeUInt16LE(glyphs.length / TARGET_FACADE_GLYPH_BYTES, 24);
  binary[26] = TARGET_FACADE_GLYPH_BYTES; binary[27] = 5; binary[28] = 7; binary[29] = 6;
  binary[30] = TARGET_FACADE_MAX_TEXT_BYTES;
  binary.writeUInt32LE(TARGET_FACADE_MAX_OVERLAY_WRITES, 32);
  [[36, targetsAt], [40, targetBytes.length], [44, paletteAt], [48, palette.length],
    [52, glyphsAt], [56, glyphs.length], [60, literalsAt], [64, literals.length]]
    .forEach(([offset, value]) => binary.writeUInt32LE(value, offset));
  const baseBytes = Buffer.alloc(baseFrame.length * 2);
  baseFrame.forEach((color, index) => baseBytes.writeUInt16LE(color, index * 2));
  binary.writeUInt32LE(crc32(baseBytes), 68);
  sha256(baseBytes).copy(binary, 96); sha256(f2jsBinary).copy(binary, 128);
  Buffer.from(TARGET_FACADE_CONTRACT_SHA256, "hex").copy(binary, 160);
  targetBytes.copy(binary, targetsAt); palette.copy(binary, paletteAt);
  glyphs.copy(binary, glyphsAt); literals.copy(binary, literalsAt);
  binary.writeUInt32LE(crc32(binary.subarray(TARGET_FACADE_HEADER_BYTES)), 72);
  binary.writeUInt32LE(crc32(binary.subarray(0, TARGET_FACADE_HEADER_BYTES),
    { zeroFrom: 76, zeroBytes: 4 }), 76);
  return Object.freeze({ binary, sha256: sha256(binary).toString("hex"), baseBytes,
    baseSha256: sha256(baseBytes).toString("hex"), f2jsSha256: sha256(f2jsBinary).toString("hex"),
    contractSha256: TARGET_FACADE_CONTRACT_SHA256, generation });
}

function invariant(value, message) { if (!value) throw new Error(message); }
const u16 = (binary, at) => binary.readUInt16LE(at);
const u32 = (binary, at) => binary.readUInt32LE(at);

function decodeTable(asset, header, targetRecord) {
  const offset = u16(targetRecord, 36); const length = targetRecord[38];
  invariant(targetRecord[39] === 0 && offset + length <= header.literalBytes, "Target literal range is invalid.");
  if (length === 0) return [];
  const tableBytes = asset.subarray(header.literalsAt + offset, header.literalsAt + offset + length);
  const count = tableBytes[0]; let cursor = 1; const values = [];
  for (let index = 0; index < count; index++) {
    invariant(cursor < tableBytes.length, "Target literal table is truncated.");
    const bytesCount = tableBytes[cursor++];
    invariant(bytesCount <= TARGET_FACADE_MAX_TEXT_BYTES && cursor + bytesCount <= tableBytes.length,
      "Target literal entry is invalid.");
    values.push(Buffer.from(tableBytes.subarray(cursor, cursor + bytesCount))); cursor += bytesCount;
  }
  invariant(cursor === tableBytes.length, "Target literal table is noncanonical.");
  return values;
}

const EXPECTED_PROPERTIES = Object.freeze([0, 4, 1, 3, 1, 3, 1, 1, 3, 1, 7, -1, 1, 1]);
const EXPECTED_TABLE_COUNTS = Object.freeze([0, 0, 1, 5, 1, 17, 3, 8, 17, 1, 1, -1, -2, -3]);
const USED_SLOTS = Object.freeze([0, 1, 0, 2, 2, 2, 2, 2, 2, 3, 2, 2, 1, 1]);
/* -1 marks per-format validation handled inline (variantText: properties may be
 * text or text|color; literal count is 1..16; the colour slot may be UNUSED).
 * -2 marks the raster table KIND (variantRaster): the range is raw pixels with
 * a u16 byte length, decoded by decodeRasterTable instead of decodeTable.
 * -3 marks the DIGIT raster KIND (digitRaster): same pixel encoding with the
 * count fixed at exactly 10 ("0".."9"); the record's divisor (u32le@30, a
 * power of ten 1..1000) selects the digit: variant = (slot/divisor) % 10. */

function decodeRasterTable(asset, header, targetRecord, width, height, id) {
  const offset = u16(targetRecord, 36); const length = u16(targetRecord, 38);
  const variantBytes = width * height * 2;
  invariant(offset + length <= header.literalBytes, `Raster table range is invalid for ${id}.`);
  invariant(length >= variantBytes && length % variantBytes === 0 &&
    length <= variantBytes * 16,
  `Raster table byte length is not exactly count*rect.w*rect.h*2 for ${id}.`);
  return Object.freeze(Array.from({ length: length / variantBytes }, (_, index) =>
    Buffer.from(asset.subarray(header.literalsAt + offset + index * variantBytes,
      header.literalsAt + offset + (index + 1) * variantBytes))));
}

export function decodeTargetFacadeAsset(value, { expectedGeneration, expectedF2jsSha256,
  expectedContractSha256 = TARGET_FACADE_CONTRACT_SHA256, baseFrame } = {}) {
  const binary = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  invariant(binary.length >= TARGET_FACADE_HEADER_BYTES && binary.subarray(0, 4).toString("ascii") === "F2TF",
    "Target facade magic or length is invalid.");
  invariant(u16(binary, 4) === 1 && u16(binary, 6) === TARGET_FACADE_HEADER_BYTES && u32(binary, 8) === binary.length,
    "Target facade header is invalid.");
  invariant(binary.subarray(80, 96).every((byte) => byte === 0), "Target facade reserved header bytes are nonzero.");
  invariant(crc32(binary.subarray(TARGET_FACADE_HEADER_BYTES)) === u32(binary, 72) &&
    crc32(binary.subarray(0, TARGET_FACADE_HEADER_BYTES), { zeroFrom: 76, zeroBytes: 4 }) === u32(binary, 76),
  "Target facade CRC is invalid.");
  const generation = u32(binary, 12);
  invariant(expectedGeneration === undefined || generation === expectedGeneration, "Target facade generation mismatch.");
  invariant(u16(binary, 16) === 100 && u16(binary, 18) === 310 && binary[20] === 1 &&
    binary[21] === 16 && binary[22] === TARGET_FACADE_TARGET_BYTES && binary[23] >= 1 &&
    binary[23] <= 16 && u16(binary, 24) >= 1 && u16(binary, 24) <= 64 &&
    binary[26] === 8 && binary[27] === 5 && binary[28] === 7 && binary[29] === 6 &&
    binary[30] === TARGET_FACADE_MAX_TEXT_BYTES && binary[31] === 0 &&
    u32(binary, 32) >= 1 && u32(binary, 32) <= TARGET_FACADE_MAX_OVERLAY_WRITES_V3,
  "Target facade profile fields are invalid.");
  const header = { generation, targetsAt: u32(binary, 36), targetsBytes: u32(binary, 40),
    paletteAt: u32(binary, 44), paletteBytes: u32(binary, 48), glyphsAt: u32(binary, 52),
    glyphBytes: u32(binary, 56), literalsAt: u32(binary, 60), literalBytes: u32(binary, 64),
    maxOverlayWrites: u32(binary, 32), baseCrc32: u32(binary, 68) };
  const expectedOffsets = [TARGET_FACADE_HEADER_BYTES,
    TARGET_FACADE_HEADER_BYTES + 16 * TARGET_FACADE_TARGET_BYTES,
    TARGET_FACADE_HEADER_BYTES + 16 * TARGET_FACADE_TARGET_BYTES + header.paletteBytes,
    TARGET_FACADE_HEADER_BYTES + 16 * TARGET_FACADE_TARGET_BYTES + header.paletteBytes + header.glyphBytes];
  invariant(header.targetsAt === expectedOffsets[0] && header.targetsBytes === 16 * TARGET_FACADE_TARGET_BYTES &&
    header.paletteAt === expectedOffsets[1] && header.paletteBytes === binary[23] * 2 &&
    header.glyphsAt === expectedOffsets[2] && header.glyphBytes === u16(binary, 24) * 8 &&
    header.literalsAt === expectedOffsets[3] && header.literalsAt + header.literalBytes === binary.length,
  "Target facade sections are noncanonical.");
  invariant(binary.subarray(128, 160).toString("hex") === expectedF2jsSha256,
    "Target facade F2JS identity mismatch.");
  invariant(binary.subarray(160, 192).toString("hex") === expectedContractSha256,
    "Target facade contract identity mismatch.");
  if (baseFrame) {
    const base = Buffer.alloc(baseFrame.length * 2);
    baseFrame.forEach((color, index) => base.writeUInt16LE(color, index * 2));
    invariant(baseFrame.length === 31_000 && crc32(base) === header.baseCrc32 &&
      sha256(base).equals(binary.subarray(96, 128)), "Target facade raster base identity mismatch.");
  }
  const palette = Array.from({ length: binary[23] }, (_, index) => u16(binary, header.paletteAt + index * 2));
  const glyphs = new Map();
  for (let index = 0; index < u16(binary, 24); index++) {
    const at = header.glyphsAt + index * 8; const code = binary[at];
    invariant(!glyphs.has(code) && (index === 0 || code > binary[at - 8]) && binary[at + 1] === 5 &&
      binary[at + 7] === 6 && binary.subarray(at + 2, at + 7).every((column) => (column & 0x80) === 0),
    "Target facade glyph table is invalid.");
    glyphs.set(code, Object.freeze({ columns: Object.freeze([...binary.subarray(at + 2, at + 7)]), advance: 6 }));
  }
  const ids = new Set();
  const targets = Array.from({ length: 16 }, (_, index) => {
    const record = binary.subarray(header.targetsAt + index * 40, header.targetsAt + (index + 1) * 40);
    const nul = record.subarray(0, 16).indexOf(0); const idLength = nul < 0 ? 16 : nul;
    const id = record.subarray(0, idLength).toString("ascii");
    invariant(idLength >= 1 && idLength <= 15 && /^[a-z][A-Za-z0-9-]*$/u.test(id) && !ids.has(id) &&
      record.subarray(idLength, 16).every((byte) => byte === 0), "Target facade ID is invalid.");
    ids.add(id);
    const format = record[25]; const x = u16(record, 16); const y = u16(record, 18);
    const width = u16(record, 20); const height = u16(record, 22);
    invariant(format >= 1 && format <= 13 &&
      (EXPECTED_PROPERTIES[format] === -1
        ? record[24] === 1 || record[24] === 3
        : record[24] === EXPECTED_PROPERTIES[format]) &&
      width > 0 && height > 0 && x + width <= 100 && y + height <= 310,
    `Target facade geometry/properties are invalid for ${id}.`);
    const usedSlots = USED_SLOTS[format]; const slots = [...record.subarray(26, 30)];
    invariant((format === TARGET_FACADE_FORMATTER.variantText
      ? slots[0] < 16 && (slots[1] < 16 || slots[1] === UNUSED)
      : slots.slice(0, usedSlots).every((slot) => slot < 16)) &&
      slots.slice(usedSlots).every((slot) => slot === UNUSED), `Target facade slots are invalid for ${id}.`);
    if (format === 1) invariant(record[30] === UNUSED && record[31] === UNUSED && record[32] === UNUSED &&
      record[34] === 0 && record[35] === 0, "Root visibility metadata is invalid.");
    else if (format === TARGET_FACADE_FORMATTER.variantRaster)
      invariant(record[30] === UNUSED && record[31] === UNUSED && record[32] === UNUSED &&
        record[33] === 0 && record[34] === 0 && record[35] === 0,
      `Raster target text metadata must stay unused for ${id}.`);
    else if (format === TARGET_FACADE_FORMATTER.digitRaster)
      invariant([1, 10, 100, 1000].includes(record.readUInt32LE(30)) &&
        record[34] === 0 && record[35] === 0,
      `Digit raster divisor must be a power of ten 1..1000 for ${id}.`);
    else invariant(record[30] < palette.length && record[31] < palette.length && record[32] === 0 &&
      record[33] <= 2 && record[34] >= 1 && record[34] <= TARGET_FACADE_MAX_TEXT_BYTES &&
      record[35] >= 1 && record[35] <= 3, `Target text metadata is invalid for ${id}.`);
    let tables = Object.freeze([]); let rasters = null;
    if (EXPECTED_TABLE_COUNTS[format] === -2 || EXPECTED_TABLE_COUNTS[format] === -3) {
      rasters = decodeRasterTable(binary, header, record, width, height, id);
      if (EXPECTED_TABLE_COUNTS[format] === -3)
        invariant(rasters.length === 10,
          `Digit raster table must hold exactly 10 variants for ${id}.`);
    } else {
      tables = Object.freeze(decodeTable(binary, header, record));
      invariant(EXPECTED_TABLE_COUNTS[format] === -1
        ? tables.length >= 1 && tables.length <= 16
        : tables.length === EXPECTED_TABLE_COUNTS[format],
      `Target literal table count is invalid for ${id}.`);
      for (const item of tables) for (const code of item) invariant(glyphs.has(code), `Target ${id} uses an absent glyph.`);
    }
    return Object.freeze({ id, x, y, width, height, properties: record[24], format, slots,
      palette0: record[30], palette1: record[31], font: record[32], align: record[33],
      maxChars: record[34], scale: record[35], tables, rasters,
      divisor: record.readUInt32LE(30), paletteCount: binary[23] });
  });
  // Renderability at admit: a variantRaster blit writes exactly rect.w*rect.h
  // pixels, so the sum over formatter-12 targets must fit the declared budget
  // or the asset would admit and then fail every render (the black-screen
  // class).  Admit-pass now implies raster-render-cannot-overflow.
  const rasterWrites = targets.reduce((sum, target) =>
    target.format === 12 || target.format === 13
      ? sum + target.width * target.height : sum, 0);
  invariant(rasterWrites <= header.maxOverlayWrites,
    `Raster targets need ${rasterWrites} overlay writes per render; the asset declares ${header.maxOverlayWrites}.`);
  return Object.freeze({ binary, header: Object.freeze(header), palette: Object.freeze(palette), glyphs,
    targets: Object.freeze(targets), sha256: sha256(binary).toString("hex") });
}

function pushBytes(output, value) { for (const byte of value) output.push(byte); }
function appendAscii(output, text) { for (const character of text) output.push(character.charCodeAt(0)); }
function tableValue(target, index) {
  const value = target.tables[index]; if (!value) throw new Error("target-table-index"); return value;
}
function uintText(value) { return Buffer.from(String(value >>> 0), "ascii"); }
function signedText(value) { return Buffer.from(String(value | 0), "ascii"); }

function packedAscii(word) {
  const output = []; let ended = false;
  for (let shift = 0; shift < 32; shift += 8) {
    const byte = (word >>> shift) & 0xff;
    if (byte === 0) { ended = true; continue; }
    if (ended || (byte < 48 || byte > 57) && !(output.length === 0 && byte === 45)) throw new Error("packed-ascii");
    output.push(byte);
  }
  const text = Buffer.from(output).toString("ascii");
  if (!/^-?\d{1,3}$/u.test(text)) throw new Error("packed-ascii");
  const numeric = Number(text); if (numeric < -999 || numeric > 999) throw new Error("packed-ascii");
  return { bytes: Buffer.from(output), numeric };
}

function prepare(target, slots) {
  const output = []; const flags = slots[15] >>> 0;
  if ((flags & ~7) !== 0) throw new Error("flags");
  const hasGood = Boolean(flags & 1); let hidden = false; let palette = target.palette0;
  let raster = null;
  if (target.format === 1) hidden = Boolean(slots[target.slots[0]] & 2);
  else if (target.format === 12) {
    /* variantRaster only clamps its value slot here; the blit happens in
     * countOrDraw. Reads slots[15] solely through the global check above. */
    const pick = Math.min(Math.max(slots[target.slots[0]] | 0, 0), target.rasters.length - 1);
    raster = target.rasters[pick];
  } else if (target.format === 13) {
    /* digitRaster: negative values floor at zero; the divisor extracts one
     * decimal digit, so a multi-digit number costs one slot across its
     * per-digit subtargets. */
    const value = slots[target.slots[0]] | 0;
    const unsignedValue = value < 0 ? 0 : value;
    raster = target.rasters[Math.floor(unsignedValue / target.divisor) % 10];
  } else if (target.format === 11) {
    /* Weather-flag independent by design: a generic widget has no `hasGood`. */
    const count = target.tables.length;
    const index = Math.min(Math.max(slots[target.slots[0]] | 0, 0), count - 1);
    pushBytes(output, tableValue(target, index));
    if (target.slots[1] !== UNUSED) {
      const paletteCount = target.paletteCount ?? 16;
      palette = Math.min(Math.max(slots[target.slots[1]] | 0, 0), paletteCount - 1);
    }
  } else if (target.format === 2) pushBytes(output, tableValue(target, 0));
  else if (target.format === 3) {
    const freshness = slots[target.slots[0]];
    if (freshness < 0 || freshness > 4) throw new Error("freshness");
    pushBytes(output, tableValue(target, freshness));
    if (freshness !== 1) palette = target.palette1;
  } else if (target.format === 4) {
    if (!hasGood) appendAscii(output, "--");
    else pushBytes(output, packedAscii(slots[target.slots[0]] >>> 0).bytes);
    output.push(0xb0); pushBytes(output, tableValue(target, 0));
  } else if (target.format === 5 || target.format === 8) {
    if (!hasGood) pushBytes(output, tableValue(target, 16));
    else {
      const meta = slots[target.slots[0]] >>> 0;
      if (target.format === 5) {
        if ((meta & ~31) !== 0 || (meta & 15) > 7) throw new Error("current-meta");
        pushBytes(output, tableValue(target, (meta & 15) + ((meta & 16) ? 0 : 8)));
        if (!(meta & 16)) palette = target.palette1;
      } else {
        if ((meta & ~0x3f) !== 0 || (meta & 7) > 6 || ((meta >>> 3) & 15) > 7) throw new Error("day-meta");
        const condition = (meta >>> 3) & 15; pushBytes(output, tableValue(target, condition));
        if (condition >= 5) palette = target.palette1;
      }
    }
  } else if (target.format === 6) {
    if (!hasGood) appendAscii(output, "NO DATA");
    else {
      const age = slots[target.slots[0]];
      if (age < 0 || age > 604_800) throw new Error("age");
      const unit = age < 60 ? 0 : age < 3_600 ? 1 : 2;
      pushBytes(output, uintText(unit === 0 ? age : unit === 1 ? Math.floor(age / 60) : Math.floor(age / 3_600)));
      pushBytes(output, tableValue(target, unit));
    }
  } else if (target.format === 7) {
    if (!hasGood) pushBytes(output, tableValue(target, 7));
    else {
      const meta = slots[target.slots[0]] >>> 0;
      if ((meta & ~0x3f) !== 0 || (meta & 7) > 6 || ((meta >>> 3) & 15) > 7) throw new Error("day-meta");
      pushBytes(output, tableValue(target, meta & 7));
    }
  } else if (target.format === 9) {
    if (!hasGood) appendAscii(output, "--");
    else {
      const low = packedAscii(slots[target.slots[0]] >>> 0);
      const high = packedAscii(slots[target.slots[1]] >>> 0);
      if (low.numeric > high.numeric) throw new Error("temperature-order");
      pushBytes(output, low.bytes); output.push(0xb0); appendAscii(output, " ");
      pushBytes(output, high.bytes); output.push(0xb0);
    }
  } else if (target.format === 10) {
    const retry = slots[target.slots[0]];
    if (retry < 0 || retry > 86_400) throw new Error("retry");
    hidden = retry === 0;
    if (!hidden) { pushBytes(output, tableValue(target, 0)); pushBytes(output, uintText(retry)); appendAscii(output, "S"); }
  }
  if (output.length > target.maxChars) throw new Error("text-overflow");
  return Object.freeze({ bytes: Buffer.from(output), hidden, palette, raster });
}

function countOrDraw(frame, decoded, target, prepared, draw) {
  if (prepared.hidden || target.format === 1) return 0;
  if (target.format === 12 || target.format === 13) {
    /* Full-rect blit: admission proved the rect sits inside the canvas and the
     * variant is exactly rect.w*rect.h RGB565LE pixels, so every rect pixel is
     * overwritten unconditionally — no clipping, no base ghosting. */
    if (draw) {
      for (let row = 0; row < target.height; row++) for (let column = 0; column < target.width; column++) {
        frame[(target.y + row) * 100 + target.x + column] =
          prepared.raster.readUInt16LE((row * target.width + column) * 2);
      }
    }
    return target.width * target.height;
  }
  const scale = target.scale; const fontWidth = 5 * scale; const fontHeight = 7 * scale;
  const textWidth = prepared.bytes.length ? prepared.bytes.length * 6 * scale - scale : 0;
  let x = target.x;
  if (target.align === 1) x += Math.floor((target.width - textWidth) / 2);
  else if (target.align === 2) x += target.width - textWidth;
  const y = target.y + Math.floor((target.height - fontHeight) / 2);
  let writes = 0;
  for (const code of prepared.bytes) {
    const glyph = decoded.glyphs.get(code); if (!glyph) throw new Error("missing-glyph");
    for (let column = 0; column < 5; column++) for (let row = 0; row < 7; row++) {
      if (((glyph.columns[column] >>> row) & 1) === 0) continue;
      for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
        const px = x + column * scale + sx; const py = y + row * scale + sy;
        if (px < target.x || px >= target.x + target.width || py < target.y || py >= target.y + target.height ||
            px < 0 || px >= 100 || py < 0 || py >= 310) continue;
        writes++;
        if (draw) frame[py * 100 + px] = decoded.palette[prepared.palette];
      }
    }
    x += glyph.advance * scale;
  }
  return writes;
}

/** Pixel-exact host oracle for the freestanding consumer. */
export function renderTargetFacadeHost({ decoded, baseFrame, mailbox, state, expectedGeneration = 18,
  ownerThreadToken = 0x12345678, currentThreadToken = ownerThreadToken } = {}) {
  const frame = new Uint16Array(baseFrame);
  const metrics = { baseWrites: 0, overlayWrites: 0, formattedTargets: 0, sequenceAttempts: 0,
    appliedGeneration: 0, appliedRevision: state.lastAppliedRevision >>> 0 };
  if (currentThreadToken !== ownerThreadToken) return { result: TARGET_FACADE_RESULT.wrongThread,
    frame: new Uint16Array(31_000), metrics };
  metrics.baseWrites = 31_000;
  metrics.sequenceAttempts = 1;
  if (!mailbox || (mailbox.sequence & 1) || (mailbox.sequenceAfter ?? mailbox.sequence) !== mailbox.sequence) {
    return { result: TARGET_FACADE_RESULT.torn, frame, metrics };
  }
  const slots = mailbox.slots;
  if (!Array.isArray(slots) || slots.length !== 16 || !slots.every(Number.isInteger)) {
    return { result: TARGET_FACADE_RESULT.argument, frame, metrics };
  }
  if (decoded.header.generation !== expectedGeneration || mailbox.admittedGeneration !== expectedGeneration) {
    return { result: TARGET_FACADE_RESULT.generation, frame, metrics };
  }
  const revision = slots[0] >>> 0;
  if (slots[0] < 0 || revision < (state.lastAppliedRevision >>> 0)) {
    return { result: TARGET_FACADE_RESULT.revision, frame, metrics };
  }
  let prepared;
  try { prepared = decoded.targets.map((target) => prepare(target, slots)); }
  catch { return { result: TARGET_FACADE_RESULT.format, frame, metrics }; }
  const rootHidden = prepared[0].hidden;
  if (rootHidden) {
    state.lastAppliedRevision = revision; metrics.appliedGeneration = expectedGeneration;
    metrics.appliedRevision = revision;
    return { result: TARGET_FACADE_RESULT.hidden, frame, metrics };
  }
  let overlayWrites = 0;
  try {
    for (let index = 1; index < decoded.targets.length; index++) {
      overlayWrites += countOrDraw(frame, decoded, decoded.targets[index], prepared[index], false);
      metrics.formattedTargets++;
    }
  } catch { return { result: TARGET_FACADE_RESULT.format, frame, metrics }; }
  if (overlayWrites > decoded.header.maxOverlayWrites) {
    metrics.formattedTargets = 0; return { result: TARGET_FACADE_RESULT.overflow, frame, metrics };
  }
  for (let index = 1; index < decoded.targets.length; index++) {
    countOrDraw(frame, decoded, decoded.targets[index], prepared[index], true);
  }
  state.lastAppliedRevision = revision; metrics.overlayWrites = overlayWrites;
  metrics.appliedGeneration = expectedGeneration; metrics.appliedRevision = revision;
  return { result: TARGET_FACADE_RESULT.ok, frame, metrics };
}

export function packTemperatureAscii(value) {
  if (!Number.isInteger(value) || value < -999 || value > 999) throw new RangeError("Temperature must be -999..999.");
  const text = Buffer.from(String(value), "ascii"); let word = 0;
  text.forEach((byte, index) => { word |= byte << (index * 8); }); return word | 0;
}
