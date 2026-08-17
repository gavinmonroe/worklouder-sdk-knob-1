import { renderCssSceneRgb565 } from "../../src/render/index.mjs";

import { HOST_COLOR_HEX } from "./visual.mjs";

function positiveModulo(value, modulus) { return ((value % modulus) + modulus) % modulus; }

function color565(hex) {
  const digits = hex.slice(1);
  const r = Number.parseInt(digits.slice(0, 2), 16);
  const g = Number.parseInt(digits.slice(2, 4), 16);
  const b = Number.parseInt(digits.slice(4, 6), 16);
  return ((r >>> 3) << 11) | ((g >>> 2) << 5) | (b >>> 3);
}

function clockText(secondsOfDay) {
  const seconds = positiveModulo(secondsOfDay, 86400);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map((part) => String(part).padStart(2, "0")).join(":");
}

/** A fresh full semantic render, independent from the linked dirty-patch application path. */
export function renderFreshSemanticState(prepared, atlas, state) {
  const targets = new Map(prepared.runs.filter(({ id }) => id).map((run) => [run.id, run]));
  const updates = [
    { target: targets.get("clock"), glyphs: Array.from(clockText(state.secondsOfDay)) },
    { target: targets.get("knob"), glyphs: [String(positiveModulo(state.knobVariant, 3) + 1)] },
    { target: targets.get("host"), glyphs: [String(positiveModulo(state.hostValue, 10))],
      color565: color565(HOST_COLOR_HEX[positiveModulo(state.hostValue, 10)]) },
  ];
  const cells = prepared.scene.cells.map((cell) => ({ ...cell }));
  const glyphIds = new Map(prepared.scene.glyphs.map((glyph, index) => [glyph, index]));
  for (const update of updates) update.target.cellIndices.forEach((cellIndex, position) => {
    const glyph = update.glyphs[position];
    cells[cellIndex].glyph = glyph;
    cells[cellIndex].glyphId = glyphIds.get(glyph);
    if (update.color565 !== undefined) cells[cellIndex].color565 = update.color565;
  });
  return renderCssSceneRgb565({ ...prepared.scene, cells }, atlas, 0);
}

export function semanticStateLabel(state) {
  return Object.freeze({ clock: clockText(state.secondsOfDay),
    knob: String(positiveModulo(state.knobVariant, 3) + 1),
    host: String(positiveModulo(state.hostValue, 10)),
    hostColor: HOST_COLOR_HEX[positiveModulo(state.hostValue, 10)] });
}
