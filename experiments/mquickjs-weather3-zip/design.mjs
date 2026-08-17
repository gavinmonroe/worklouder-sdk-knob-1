/* Weather ID28 "gen19-weather3-zip": the weather2 restyle plus a knob-driven ZIP
 * settings mode.
 *
 * Nothing here changes the F2TF *contract* (format/profile/version/canvas/
 * headerBytes/targetBytes/targetCount/glyph metrics/limits/mailbox/properties/
 * formatters), so TARGET_FACADE_CONTRACT_SHA256 is untouched and the on-device
 * `framer_tf_admit` contract pin still matches.  Only the per-asset palette,
 * glyph table, literal tables and the 16 target records change.
 *
 * The formatter set is closed, so the settings view is expressed entirely with
 * the existing formatters:
 *   - format 5 (currentCondition) is a 16-way slot-selected string table whose
 *     entries may be empty; that is the ZIP digit cell, the caret row, the card
 *     eraser and the mode label.
 *   - format 4 (packedTemperature) stays the big temperature; it can never
 *     render nothing, so in settings mode it renders its own "--" placeholder
 *     and an eraser target repaints the card colour over exactly those cells.
 *   - format 9 (temperaturePair) renders one forecast row's low/high in a single
 *     target, which is what frees the three targets the ZIP cells need.  Its
 *     hardcoded 0x20 separator is drawn with an arrow glyph, so the row reads
 *     "60°->75°" without the raster arrow weather2 used.
 */

import { createHash } from "node:crypto";

import { crc32, TARGET_FACADE_CONTRACT_SHA256, TARGET_FACADE_GLYPH_BYTES,
  TARGET_FACADE_HEADER_BYTES, TARGET_FACADE_MAX_OVERLAY_WRITES,
  TARGET_FACADE_MAX_TEXT_BYTES, TARGET_FACADE_TARGET_BYTES } from
  "../mquickjs-target-facade/contract.mjs";

export const WIDTH = 100;
export const HEIGHT = 310;
export const PIXELS = WIDTH * HEIGHT;
export const FRAME_BYTES = PIXELS * 2;

/* ------------------------------------------------------------------ colors */

export const INK = Object.freeze({
  black: "#000000",
  white: "#ffffff",
  orange: "#ff8a00",
  grey: "#8b8b8b",
});

export function color565(hex) {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return ((r >>> 3) << 11) | ((g >>> 2) << 5) | (b >>> 3);
}

/* -------------------------------------------------------------- primitives */

const inside = (x, y) => x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT;

function markRect(mask, x, y, width, height) {
  for (let py = y; py < y + height; py++) for (let px = x; px < x + width; px++) {
    if (inside(px, py)) mask[py * WIDTH + px] = 1;
  }
}

function markDisc(mask, cx, cy, radius) {
  for (let y = cy - radius; y <= cy + radius; y++) for (let x = cx - radius; x <= cx + radius; x++) {
    const dx = x - cx; const dy = y - cy;
    if (dx * dx + dy * dy <= radius * radius + radius && inside(x, y)) mask[y * WIDTH + x] = 1;
  }
}

function markRoundRect(mask, x, y, width, height, radius) {
  for (let py = y; py < y + height; py++) for (let px = x; px < x + width; px++) {
    const nx = px < x + radius ? x + radius : px > x + width - 1 - radius ? x + width - 1 - radius : px;
    const ny = py < y + radius ? y + radius : py > y + height - 1 - radius ? y + height - 1 - radius : py;
    const dx = px - nx; const dy = py - ny;
    if (dx * dx + dy * dy <= radius * radius + radius && inside(px, py)) mask[py * WIDTH + px] = 1;
  }
}

function markRing(mask, cx, cy, outer, inner) {
  for (let y = cy - outer; y <= cy + outer; y++) for (let x = cx - outer; x <= cx + outer; x++) {
    const d = (x - cx) ** 2 + (y - cy) ** 2;
    if (d <= outer * outer + outer && d > inner * inner + inner && inside(x, y)) mask[y * WIDTH + x] = 1;
  }
}

/** Thick line with square-ish caps; used for the icon rays and the "y" strokes. */
function markLine(mask, x0, y0, x1, y1, thickness) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 4 + 1;
  const half = (thickness - 1) / 2;
  for (let step = 0; step <= steps; step++) {
    const t = step / steps;
    const cx = Math.round(x0 + (x1 - x0) * t);
    const cy = Math.round(y0 + (y1 - y0) * t);
    markRect(mask, cx - Math.floor(half), cy - Math.floor(half), thickness, thickness);
  }
}

function dilate(mask, radius) {
  const output = new Uint8Array(mask.length);
  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
    if (!mask[y * WIDTH + x]) continue;
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius + radius) continue;
      if (inside(x + dx, y + dy)) output[(y + dy) * WIDTH + x + dx] = 1;
    }
  }
  return output;
}

function paintMask(frame, mask, color) {
  for (let index = 0; index < mask.length; index++) if (mask[index]) frame[index] = color;
}

/* ---------------------------------------------------------------- geometry */

/* The ZIP cells share the card temperature row: five 5x7 glyph cells at scale 3
 * (15 px wide, 18 px pitch) = 87 px, centred in the 90 px card. */
export const LAYOUT = Object.freeze({
  icon: Object.freeze({ sunX: 67, sunY: 29, sunRadius: 7, sunRayOuter: 13 }),
  today: Object.freeze({ top: 70, capHeight: 19, xHeight: 15, stroke: 3, gap: 3 }),
  card: Object.freeze({ x: 5, y: 104, width: 90, height: 76, radius: 14 }),
  temp: Object.freeze({ x: 5, y: 117, width: 90, height: 27, scale: 3 }),
  cond: Object.freeze({ x: 5, y: 147, width: 90, height: 20, scale: 2 }),
  zip: Object.freeze({ x: 6, pitch: 18, cell: 15, scale: 3 }),
  caret: Object.freeze({ y: 125, height: 21 }),
  /* "--" + degree at scale 3, centre aligned in the card: three 15 px cells. */
  erase: Object.freeze({ x: 24, width: 51 }),
  rows: Object.freeze([194, 234, 274]),
  rowHeight: 20,
  nameBox: Object.freeze({ x: 6, width: 22 }),
  pairBox: Object.freeze({ x: 28, width: 67 }),
});

/* ------------------------------------------------------------- "Today" art */

function markToday(mask) {
  const { top, capHeight, xHeight, stroke, gap } = LAYOUT.today;
  const ringOuter = (xHeight - 1) / 2;                 /* 7 */
  const ringInner = ringOuter - stroke;                /* 4 */
  const bowlWidth = xHeight;                           /* 15 */
  const capTop = top;
  const xTop = top + capHeight - xHeight;              /* 74 */
  const cy = xTop + ringOuter;                         /* 81 */
  const widths = { T: 13, o: bowlWidth, d: bowlWidth, a: bowlWidth, y: 13 };
  const word = "Today";
  const total = [...word].reduce((sum, ch) => sum + widths[ch], 0) + gap * (word.length - 1);
  let x = Math.round((WIDTH - total) / 2);
  for (const character of word) {
    if (character === "T") {
      markRect(mask, x, capTop, widths.T, stroke);
      markRect(mask, x + (widths.T - stroke) / 2, capTop, stroke, capHeight);
    } else if (character === "o") {
      markRing(mask, x + ringOuter, cy, ringOuter, ringInner);
    } else if (character === "d" || character === "a") {
      markRing(mask, x + ringOuter, cy, ringOuter, ringInner);
      const stemTop = character === "d" ? capTop : xTop;
      markRect(mask, x + bowlWidth - stroke, stemTop, stroke, capTop + capHeight - stemTop);
    } else if (character === "y") {
      markLine(mask, x + 1, xTop, x + 6, xTop + xHeight - 2, stroke);
      markLine(mask, x + widths.y - 2, xTop, x + 2, xTop + xHeight + 6, stroke);
    }
    x += widths[character] + gap;
  }
}

/* ------------------------------------------------------- cloud + sun icon */

function cloudMask() {
  const mask = new Uint8Array(PIXELS);
  markDisc(mask, 45, 46, 14);
  markDisc(mask, 30, 52, 10);
  markDisc(mask, 58, 51, 11);
  markRect(mask, 30, 52, 29, 11);
  return mask;
}

function sunMask() {
  const { sunX, sunY, sunRadius, sunRayOuter } = LAYOUT.icon;
  const mask = new Uint8Array(PIXELS);
  markDisc(mask, sunX, sunY, sunRadius);
  for (let index = 0; index < 8; index++) {
    const angle = (index * Math.PI) / 4;
    markLine(mask, sunX + Math.cos(angle) * (sunRadius + 3),
      sunY + Math.sin(angle) * (sunRadius + 3),
      sunX + Math.cos(angle) * sunRayOuter,
      sunY + Math.sin(angle) * sunRayOuter, 2);
  }
  return mask;
}

/* ---------------------------------------------------------- the base frame */

/* Identical to the weather2 base except the three raster row arrows are gone:
 * the format-9 pair target now draws its own separator glyph between the low
 * and the high, so a fixed raster arrow would no longer line up. */
export function renderWeather3Base() {
  const frame = new Uint16Array(PIXELS);
  const black = color565(INK.black);
  const white = color565(INK.white);
  const orange = color565(INK.orange);
  frame.fill(black);

  paintMask(frame, sunMask(), white);
  const cloud = cloudMask();
  paintMask(frame, dilate(cloud, 3), black);
  paintMask(frame, cloud, white);

  const word = new Uint8Array(PIXELS);
  markToday(word);
  paintMask(frame, word, white);

  const card = new Uint8Array(PIXELS);
  markRoundRect(card, LAYOUT.card.x, LAYOUT.card.y, LAYOUT.card.width,
    LAYOUT.card.height, LAYOUT.card.radius);
  paintMask(frame, card, orange);

  return frame;
}

export function frameToLe(frame) {
  const bytes = Buffer.alloc(frame.length * 2);
  frame.forEach((color, index) => bytes.writeUInt16LE(color, index * 2));
  return bytes;
}

/* ================================================================= facade */

export const PALETTE3 = Object.freeze([
  color565(INK.white),  /* 0 */
  color565(INK.black),  /* 1 */
  color565(INK.orange), /* 2 */
  color565(INK.grey),   /* 3 */
]);

export const PALETTE_INDEX = Object.freeze({ white: 0, black: 1, orange: 2, grey: 3 });

/* Byte codes with a non-obvious meaning in this asset:
 *   0x20  the format-9 separator, drawn as a right arrow (no literal uses a
 *         space, so the space glyph is free to carry it)
 *   0x5f  the ZIP caret bar
 *   0x7e  a blank advance used to position the caret bar
 *   0x7f  a solid 5x7 block used by the card eraser
 *   0xb0  the degree sign appended by formatters 4 and 9
 */
export const CODE = Object.freeze({ arrow: 0x20, caret: 0x5f, pad: 0x7e, block: 0x7f,
  degree: 0xb0 });

const COLUMNS3 = Object.freeze({
  " ": [0x08, 0x08, 0x2a, 0x1c, 0x08],   /* right arrow, see CODE.arrow */
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
  "_": [0x40, 0x40, 0x40, 0x40, 0x40],   /* caret bar */
  a: [0x20, 0x54, 0x54, 0x54, 0x78], d: [0x38, 0x44, 0x44, 0x48, 0x7f],
  e: [0x38, 0x54, 0x54, 0x54, 0x18], g: [0x0c, 0x52, 0x52, 0x52, 0x3e],
  h: [0x7f, 0x08, 0x04, 0x04, 0x78], i: [0x00, 0x44, 0x7d, 0x40, 0x00],
  l: [0x00, 0x41, 0x7f, 0x40, 0x00], m: [0x7c, 0x04, 0x18, 0x04, 0x78],
  n: [0x7c, 0x08, 0x04, 0x04, 0x78], o: [0x38, 0x44, 0x44, 0x44, 0x38],
  r: [0x7c, 0x08, 0x04, 0x04, 0x08], t: [0x04, 0x3f, 0x44, 0x40, 0x20],
  u: [0x3c, 0x40, 0x40, 0x20, 0x7c], v: [0x1c, 0x20, 0x40, 0x20, 0x1c],
  w: [0x3c, 0x40, 0x30, 0x40, 0x3c], y: [0x0c, 0x50, 0x50, 0x50, 0x3c],
  z: [0x44, 0x64, 0x54, 0x4c, 0x44],
  "~": [0x00, 0x00, 0x00, 0x00, 0x00],   /* blank advance */
  "\u007f": [0x7f, 0x7f, 0x7f, 0x7f, 0x7f],   /* solid block */
  "°": [0x06, 0x09, 0x09, 0x06, 0x00],
});

const UNUSED = 0xff;
const ALIGN = Object.freeze({ left: 0, center: 1, right: 2 });

const literalBytes = (text) => Buffer.from([...String(text)].map((character) =>
  character.charCodeAt(0)));

function table(strings) {
  const values = strings.map(literalBytes);
  if (values.length > 255 || values.some((value) => value.length > TARGET_FACADE_MAX_TEXT_BYTES)) {
    throw new Error("Weather3 literal table exceeds its bounded representation.");
  }
  const blob = Buffer.concat([Buffer.from([values.length]),
    ...values.map((value) => Buffer.concat([Buffer.from([value.length]), value]))]);
  if (blob.length > 255) throw new Error("Weather3 literal table blob exceeds one byte of length.");
  return blob;
}

const pad = "~";
const block = "\u007f";
const blanks = (count) => Array.from({ length: count }, () => "");

/* Formatter 5 selects `table[(meta & 15) + (meta & 16 ? 0 : 8)]`, or table[16]
 * when the flag slot's bit 0 is clear.  Every format-5 target below therefore
 * declares 17 entries whose unused indices are empty strings, which is how a
 * target renders nothing at all. */
export const TABLES3 = Object.freeze({
  none: Buffer.alloc(0),
  /* format 4 unit suffix: the degree sign is already unconditional */
  bare: table([""]),
  /* format 5, card label: 0..7 day conditions, 8 night-clear, 9..11 settings
   * phases, 16 the no-snapshot placeholder */
  cardLabel: table(["Sunny", "Partly", "Cloudy", "Fog", "Drizzle", "Rain", "Snow", "Storm",
    "Clear", "ZIP", "Saving", "Saved", "", "", "", "", "Waiting"]),
  /* format 5, one ZIP digit cell */
  digits: table(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
    ...blanks(6), ""]),
  /* format 5, caret bar under the active cell */
  caret: table(["_", `${pad}_`, `${pad}${pad}_`, `${pad}${pad}${pad}_`,
    `${pad}${pad}${pad}${pad}_`, ...blanks(11), ""]),
  /* format 5, card eraser: three solid cells over the format-4 "--" placeholder.
   * Index 5 is the "settings up, no caret" state (Saving/Saved), so the eraser
   * must still paint there even though the caret does not. */
  erase: table([...Array.from({ length: 8 }, () => block.repeat(3)), ...blanks(8), ""]),
  /* format 7, weekday: index 7 is the no-snapshot entry and must be empty so a
   * settings frame carries no forecast text */
  weekdays: table(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", ""]),
});

const target = (id, x, y, width, height, properties, format, slots, palette0, palette1,
  align, maxChars, scale, tableName) => Object.freeze({ id, x, y, width, height, properties,
  format, slots: Object.freeze([...slots, UNUSED, UNUSED, UNUSED, UNUSED].slice(0, 4)),
  palette0, palette1, font: format === 1 ? UNUSED : 0, align: ALIGN[align],
  maxChars, scale, tableName });

const zipCell = (id, index, slot) => target(id, LAYOUT.zip.x + index * LAYOUT.zip.pitch,
  LAYOUT.temp.y, LAYOUT.zip.cell, LAYOUT.temp.height, 3, 5, [slot, 13],
  PALETTE_INDEX.black, PALETTE_INDEX.black, "left", 1, LAYOUT.zip.scale, "digits");

function rowTargets(index, nameId, pairId) {
  const top = LAYOUT.rows[index];
  const metaSlot = 3 + index * 3;
  return [
    target(nameId, LAYOUT.nameBox.x, top, LAYOUT.nameBox.width, LAYOUT.rowHeight,
      1, 7, [metaSlot, 15], PALETTE_INDEX.white, PALETTE_INDEX.white, "left", 3, 1, "weekdays"),
    target(pairId, LAYOUT.pairBox.x, top, LAYOUT.pairBox.width, LAYOUT.rowHeight,
      1, 9, [metaSlot + 1, metaSlot + 2, 15], PALETTE_INDEX.white, PALETTE_INDEX.white,
      "center", 11, 1, "bare"),
  ];
}

/* Draw order is record order, and it matters: `bigTemp` paints the format-4
 * placeholder, `cardErase` repaints the card colour over exactly those three
 * cells in settings mode, and the ZIP cells then draw into the cleared row. */
export const WEATHER3_TARGETS = Object.freeze([
  target("weatherScreen", 0, 0, 100, 310, 4, 1, [15], UNUSED, UNUSED, "left", 0, 0, "none"),
  target("bigTemp", LAYOUT.temp.x, LAYOUT.temp.y, LAYOUT.temp.width, LAYOUT.temp.height,
    1, 4, [1, 15], PALETTE_INDEX.black, PALETTE_INDEX.black, "center", 5, LAYOUT.temp.scale,
    "bare"),
  target("cardErase", LAYOUT.erase.x, LAYOUT.temp.y, LAYOUT.erase.width, LAYOUT.temp.height,
    3, 5, [8, 13], PALETTE_INDEX.orange, PALETTE_INDEX.orange, "left", 3, LAYOUT.temp.scale,
    "erase"),
  zipCell("zip1", 0, 3),
  zipCell("zip2", 1, 4),
  zipCell("zip3", 2, 5),
  zipCell("zip4", 3, 6),
  zipCell("zip5", 4, 7),
  target("zipCaret", LAYOUT.zip.x, LAYOUT.caret.y,
    LAYOUT.zip.pitch * 4 + LAYOUT.zip.cell, LAYOUT.caret.height, 3, 5, [8, 13],
    PALETTE_INDEX.black, PALETTE_INDEX.black, "left", 5, LAYOUT.zip.scale, "caret"),
  target("cardLabel", LAYOUT.cond.x, LAYOUT.cond.y, LAYOUT.cond.width, LAYOUT.cond.height,
    3, 5, [2, 12], PALETTE_INDEX.black, PALETTE_INDEX.black, "center", 7, LAYOUT.cond.scale,
    "cardLabel"),
  ...rowTargets(0, "d1Name", "d1Temps"),
  ...rowTargets(1, "d2Name", "d2Temps"),
  ...rowTargets(2, "d3Name", "d3Temps"),
]);

/* The F2JS package declares the same 16 IDs in the same order; the module build
 * cross-checks the two lists byte for byte. */
export const WEATHER3_PACKAGE_TARGETS = Object.freeze(WEATHER3_TARGETS.map(({ id, properties }) =>
  Object.freeze({ id, writes: Object.freeze([
    ...(properties & 1 ? ["textContent"] : []),
    ...(properties & 2 ? ["color"] : []),
    ...(properties & 4 ? ["hidden"] : []),
  ]) })));

function sha256(value) { return createHash("sha256").update(value).digest(); }

function encodeGlyphs() {
  return Buffer.concat(Object.entries(COLUMNS3).map(([character, columns]) => {
    const record = Buffer.alloc(TARGET_FACADE_GLYPH_BYTES);
    record[0] = character.charCodeAt(0);
    record[1] = 5;
    columns.forEach((column, index) => { record[2 + index] = column; });
    record[7] = 6;
    return record;
  }).sort((left, right) => left[0] - right[0]));
}

/** Same wire format as buildWeather2FacadeAsset, different payload. */
export function buildWeather3FacadeAsset({ generation = 19, baseFrame, f2jsBinary } = {}) {
  if (!(baseFrame instanceof Uint16Array) || baseFrame.length !== PIXELS) {
    throw new TypeError("Weather3 facade requires one exact 100x310 RGB565 base frame.");
  }
  if (!(f2jsBinary instanceof Uint8Array)) {
    throw new TypeError("Weather3 facade requires its exact F2JS package.");
  }
  const glyphs = encodeGlyphs();
  const palette = Buffer.alloc(PALETTE3.length * 2);
  PALETTE3.forEach((color, index) => palette.writeUInt16LE(color, index * 2));
  const literalParts = []; const literalRanges = new Map(); let cursor = 0;
  for (const [name, value] of Object.entries(TABLES3)) {
    literalRanges.set(name, { offset: cursor, bytes: value.length });
    literalParts.push(value); cursor += value.length;
  }
  const literals = Buffer.concat(literalParts);
  if (WEATHER3_TARGETS.length !== 16) throw new Error("Weather3 facade needs exactly 16 targets.");
  const targetBytes = Buffer.alloc(16 * TARGET_FACADE_TARGET_BYTES);
  WEATHER3_TARGETS.forEach((entry, index) => {
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
    if (!range) throw new Error(`Unknown literal table ${entry.tableName}.`);
    targetBytes.writeUInt16LE(range.offset, at + 36); targetBytes[at + 38] = range.bytes;
  });
  const targetsAt = TARGET_FACADE_HEADER_BYTES;
  const paletteAt = targetsAt + targetBytes.length;
  const glyphsAt = paletteAt + palette.length;
  const literalsAt = glyphsAt + glyphs.length;
  const binary = Buffer.alloc(literalsAt + literals.length);
  binary.write("F2TF", 0, "ascii"); binary.writeUInt16LE(1, 4);
  binary.writeUInt16LE(TARGET_FACADE_HEADER_BYTES, 6); binary.writeUInt32LE(binary.length, 8);
  binary.writeUInt32LE(generation, 12);
  binary.writeUInt16LE(WIDTH, 16); binary.writeUInt16LE(HEIGHT, 18);
  binary[20] = 1; binary[21] = 16; binary[22] = TARGET_FACADE_TARGET_BYTES;
  binary[23] = PALETTE3.length;
  binary.writeUInt16LE(glyphs.length / TARGET_FACADE_GLYPH_BYTES, 24);
  binary[26] = TARGET_FACADE_GLYPH_BYTES; binary[27] = 5; binary[28] = 7; binary[29] = 6;
  binary[30] = TARGET_FACADE_MAX_TEXT_BYTES;
  binary.writeUInt32LE(TARGET_FACADE_MAX_OVERLAY_WRITES, 32);
  [[36, targetsAt], [40, targetBytes.length], [44, paletteAt], [48, palette.length],
    [52, glyphsAt], [56, glyphs.length], [60, literalsAt], [64, literals.length]]
    .forEach(([offset, value]) => binary.writeUInt32LE(value, offset));
  const baseBytes = frameToLe(baseFrame);
  binary.writeUInt32LE(crc32(baseBytes), 68);
  sha256(baseBytes).copy(binary, 96); sha256(f2jsBinary).copy(binary, 128);
  Buffer.from(TARGET_FACADE_CONTRACT_SHA256, "hex").copy(binary, 160);
  targetBytes.copy(binary, targetsAt); palette.copy(binary, paletteAt);
  glyphs.copy(binary, glyphsAt); literals.copy(binary, literalsAt);
  binary.writeUInt32LE(crc32(binary.subarray(TARGET_FACADE_HEADER_BYTES)), 72);
  binary.writeUInt32LE(crc32(binary.subarray(0, TARGET_FACADE_HEADER_BYTES),
    { zeroFrom: 76, zeroBytes: 4 }), 76);
  return Object.freeze({ binary, sha256: sha256(binary).toString("hex"), baseBytes,
    baseSha256: sha256(baseBytes).toString("hex"),
    f2jsSha256: sha256(f2jsBinary).toString("hex"),
    contractSha256: TARGET_FACADE_CONTRACT_SHA256, generation,
    glyphCount: glyphs.length / TARGET_FACADE_GLYPH_BYTES, paletteCount: PALETTE3.length });
}
