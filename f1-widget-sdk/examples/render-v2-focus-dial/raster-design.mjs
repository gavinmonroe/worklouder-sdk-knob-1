import { rgb565FrameToLeBuffer, VIEWPORT } from "./program.mjs";

const FONT_3X5 = Object.freeze({
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
  C: ["111", "100", "100", "100", "111"],
  F: ["111", "100", "110", "100", "100"],
  N: ["101", "111", "111", "111", "101"],
  O: ["111", "101", "101", "101", "111"],
  S: ["111", "100", "111", "001", "111"],
  U: ["101", "101", "101", "101", "111"],
  Y: ["101", "101", "010", "010", "010"],
});

const SEGMENTS = Object.freeze({
  "0": "ab cdef".replace(" ", ""),
  "1": "bc",
  "2": "abdeg",
  "3": "abcdg",
  "4": "bcfg",
  "5": "acdfg",
  "6": "acdefg",
  "7": "abc",
  "8": "abcdefg",
  "9": "abcdfg",
});

export const DIAL_STEPS = 5;
export const STATUS_Y = 20;
export const PALETTE = Object.freeze({
  black: "#000000",
  faceLine: "#1d1916",
  clock: "#ede9df",
  muted: "#817970",
  quiet: "#554c45",
  orange: "#f05a18",
  orangeEdge: "#ff7130",
  dialCore: "#100402",
  tick: "#2b0b03",
  activeTick: "#ffd2b5",
  focus: "#b8aaa0",
});

function channels(hex) {
  return [Number.parseInt(hex.slice(1, 3), 16), Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16)];
}

export function color565(hex) {
  const [r, g, b] = channels(hex);
  return ((r >>> 3) << 11) | ((g >>> 2) << 5) | (b >>> 3);
}

function mix565(left, right, amount) {
  const a = channels(left); const b = channels(right);
  const mixed = a.map((value, index) => Math.round(value + (b[index] - value) * amount));
  return ((mixed[0] >>> 3) << 11) | ((mixed[1] >>> 2) << 5) | (mixed[2] >>> 3);
}

function positiveModulo(value, modulus) { return ((value % modulus) + modulus) % modulus; }

export function clockText(secondsOfDay) {
  const seconds = positiveModulo(secondsOfDay, 86400);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map((part) => String(part).padStart(2, "0")).join(":");
}

function setPixel(frame, x, y, color) {
  if (x >= 0 && x < VIEWPORT.width && y >= 0 && y < VIEWPORT.height) frame[y * VIEWPORT.width + x] = color;
}

function fillRect(frame, x, y, width, height, color) {
  for (let py = y; py < y + height; py += 1) for (let px = x; px < x + width; px += 1) {
    setPixel(frame, px, py, color);
  }
}

function fillCircle(frame, cx, cy, radius, color) {
  for (let y = cy - radius; y <= cy + radius; y += 1) for (let x = cx - radius; x <= cx + radius; x += 1) {
    if ((x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2) setPixel(frame, x, y, color);
  }
}

function line(frame, x0, y0, x1, y1, color, width = 1) {
  let x = Math.round(x0); let y = Math.round(y0); const endX = Math.round(x1); const endY = Math.round(y1);
  const dx = Math.abs(endX - x); const sx = x < endX ? 1 : -1;
  const dy = -Math.abs(endY - y); const sy = y < endY ? 1 : -1; let error = dx + dy;
  while (true) {
    fillCircle(frame, x, y, Math.floor(width / 2), color);
    if (x === endX && y === endY) break;
    const doubled = error * 2;
    if (doubled >= dy) { error += dy; x += sx; }
    if (doubled <= dx) { error += dx; y += sy; }
  }
}

function drawText(frame, text, x, y, color, scale = 1) {
  let cursor = x;
  for (const glyph of text) {
    const pattern = FONT_3X5[glyph];
    if (!pattern) throw new Error(`Focus dial font has no ${glyph}.`);
    pattern.forEach((row, rowIndex) => [...row].forEach((pixel, columnIndex) => {
      if (pixel === "1") fillRect(frame, cursor + columnIndex * scale, y + rowIndex * scale, scale, scale, color);
    }));
    cursor += 4 * scale;
  }
}

function horizontalSegment(frame, x, y, width, thickness, color) {
  for (let row = 0; row < thickness; row += 1) {
    const inset = row === 0 || row === thickness - 1 ? 1 : 0;
    fillRect(frame, x + inset, y + row, width - inset * 2, 1, color);
  }
}

function verticalSegment(frame, x, y, height, thickness, color) {
  for (let column = 0; column < thickness; column += 1) {
    const inset = column === 0 || column === thickness - 1 ? 1 : 0;
    fillRect(frame, x + column, y + inset, 1, height - inset * 2, color);
  }
}

function drawLargeDigit(frame, glyph, x, y, color) {
  const active = SEGMENTS[glyph];
  if (!active) throw new Error(`Focus dial seven-segment face has no ${glyph}.`);
  const width = 16; const height = 32; const thickness = 3; const half = 14;
  if (active.includes("a")) horizontalSegment(frame, x + 2, y, width - 4, thickness, color);
  if (active.includes("g")) horizontalSegment(frame, x + 2, y + 15, width - 4, thickness, color);
  if (active.includes("d")) horizontalSegment(frame, x + 2, y + height - thickness, width - 4, thickness, color);
  if (active.includes("f")) verticalSegment(frame, x, y + 2, half, thickness, color);
  if (active.includes("b")) verticalSegment(frame, x + width - thickness, y + 2, half, thickness, color);
  if (active.includes("e")) verticalSegment(frame, x, y + 16, half, thickness, color);
  if (active.includes("c")) verticalSegment(frame, x + width - thickness, y + 16, half, thickness, color);
}

function drawDial(frame, knobVariant, drawActiveDetent) {
  const cx = 50; const cy = 259; const radius = 136;
  const inner = 39;
  for (let y = Math.max(0, cy - radius); y < VIEWPORT.height; y += 1) for (let x = 0; x < VIEWPORT.width; x += 1) {
    const distance = Math.hypot(x - cx, y - cy);
    if (distance > radius) continue;
    const raw = Math.max(0, Math.min(1, (distance - inner) / (radius - inner)));
    const eased = raw * raw * (3 - 2 * raw);
    frame[y * VIEWPORT.width + x] = mix565(PALETTE.dialCore, PALETTE.orange, eased);
  }
  const angles = [-114, -102, -90, -78, -66];
  angles.forEach((degrees, index) => {
    const radians = degrees * Math.PI / 180;
    const selected = drawActiveDetent && index === positiveModulo(knobVariant, DIAL_STEPS);
    const innerRadius = selected ? 105 : 109; const outerRadius = selected ? 124 : 121;
    line(frame, cx + Math.cos(radians) * innerRadius, cy + Math.sin(radians) * innerRadius,
      cx + Math.cos(radians) * outerRadius, cy + Math.sin(radians) * outerRadius,
      color565(selected ? PALETTE.activeTick : PALETTE.tick), selected ? 2 : 1);
  });
  drawText(frame, "FOCUS", 40, 270, color565(PALETTE.focus));
}

export function renderFocusDialFrame({ secondsOfDay, dialPhase, knobVariant }) {
  const phase = dialPhase ?? knobVariant ?? 0;
  return renderFocusDialTextFrame({ text: clockText(secondsOfDay), knobVariant: phase, drawKnob: true });
}

function renderFocusDialTextFrame({ text, knobVariant, drawKnob }) {
  if (!/^\d\d:\d\d:\d\d$/u.test(text)) throw new Error("Focus dial clock text must be HH:MM:SS.");
  const frame = new Uint16Array(VIEWPORT.width * VIEWPORT.height);
  frame.fill(color565(PALETTE.black));
  fillCircle(frame, 8, STATUS_Y + 2, 3, color565(PALETTE.orangeEdge));
  drawText(frame, "SYNC", 14, STATUS_Y, color565(PALETTE.muted));
  drawText(frame, text.slice(6), 49, STATUS_Y, color565(PALETTE.quiet));
  drawText(frame, "FN", 80, STATUS_Y, color565(PALETTE.muted));
  if (drawKnob) drawText(frame, String(positiveModulo(knobVariant, DIAL_STEPS) + 1),
    91, STATUS_Y, color565(PALETTE.clock));
  fillRect(frame, 5, 33, 90, 1, color565(PALETTE.faceLine));
  const clockColor = color565(PALETTE.clock);
  drawLargeDigit(frame, text[0], 5, 52, clockColor);
  drawLargeDigit(frame, text[1], 24, 52, clockColor);
  fillRect(frame, 48, 63, 3, 3, clockColor);
  fillRect(frame, 48, 74, 3, 3, clockColor);
  drawLargeDigit(frame, text[3], 57, 52, clockColor);
  drawLargeDigit(frame, text[4], 76, 52, clockColor);
  line(frame, 46, 105, 50, 109, color565(PALETTE.quiet));
  line(frame, 50, 109, 54, 105, color565(PALETTE.quiet));
  drawDial(frame, knobVariant, drawKnob);
  return frame;
}

function geometryForChanged(changed, coalesceRows) {
  const geometry = [];
  if (coalesceRows) {
    const rows = new Map();
    for (const pixel of changed) {
      const y = Math.floor(pixel / VIEWPORT.width); const x = pixel % VIEWPORT.width;
      const row = rows.get(y) ?? { minimum: x, maximum: x };
      row.minimum = Math.min(row.minimum, x); row.maximum = Math.max(row.maximum, x); rows.set(y, row);
    }
    for (const [y, { minimum, maximum }] of rows) geometry.push({
      absolute: y * VIEWPORT.width + minimum, count: maximum - minimum + 1,
    });
  } else {
    let start = changed[0]; let previous = start;
    for (const pixel of changed.slice(1)) {
      if (pixel === previous + 1) { previous = pixel; continue; }
      geometry.push({ absolute: start, count: previous - start + 1 }); start = pixel; previous = pixel;
    }
    geometry.push({ absolute: start, count: previous - start + 1 });
  }
  return geometry;
}

function patchGeometry(base, variants, { coalesceRows = false, variantSpecific = false } = {}) {
  const changedByVariant = variants.map((variant) => {
    const changed = [];
    for (let pixel = 0; pixel < base.length; pixel += 1) if (variant[pixel] !== base[pixel]) changed.push(pixel);
    if (variantSpecific && changed.length === 0) throw new Error("Focus dial binding produced no raster change.");
    return changed;
  });
  const allChanged = [...new Set(changedByVariant.flat())].sort((left, right) => left - right);
  if (allChanged.length === 0) throw new Error("Focus dial binding produced no raster variants.");
  const originPixel = allChanged[0];
  const sharedGeometry = variantSpecific ? null : geometryForChanged(allChanged, coalesceRows);
  return { originPixel, variants: variants.map((frame, index) => {
    const geometry = sharedGeometry ?? geometryForChanged(changedByVariant[index], coalesceRows);
    return geometry.map(({ absolute, count }) => ({ pixelOffset: absolute - originPixel,
      colors: Array.from(frame.subarray(absolute, absolute + count)) }));
  }) };
}

export function createFocusDialRaster(prepared) {
  if (prepared?.format !== "framer-render-v2-prepared-v1") throw new Error("Focus dial raster requires prepared Render v2 source.");
  const state = Object.fromEntries(prepared.script.states.map(({ name, initial }) => [name, initial]));
  const initialText = clockText(state.secondsOfDay); const initialKnob = state.dialPhase;
  const base = renderFocusDialTextFrame({ text: initialText, knobVariant: initialKnob, drawKnob: false });
  const bindingPatches = Object.fromEntries(prepared.logicalBindings.map((binding) => {
    let variants;
    if (binding.targetId === "clock") {
      const position = binding.cellIndices[0];
      variants = binding.variants.map(({ glyphs }) => {
        const glyphsForClock = [...initialText]; glyphsForClock[position] = glyphs[0];
        return renderFocusDialTextFrame({ text: glyphsForClock.join(""), knobVariant: initialKnob, drawKnob: false });
      });
    } else if (binding.targetId === "knob") {
      variants = binding.variants.map(({ glyphs }) => renderFocusDialTextFrame({
        text: initialText, knobVariant: Number(glyphs[0]) - 1, drawKnob: true,
      }));
    } else throw new Error(`Focus dial has no raster binding for #${binding.targetId}.`);
    const isLargeClockDigit = binding.targetId === "clock" && binding.cellIndices[0] < 6;
    return [binding.name, patchGeometry(base, variants, { coalesceRows: isLargeClockDigit,
      variantSpecific: binding.targetId === "knob" })];
  }));
  return Object.freeze({ baseFrame: rgb565FrameToLeBuffer(base), bindingPatches });
}
