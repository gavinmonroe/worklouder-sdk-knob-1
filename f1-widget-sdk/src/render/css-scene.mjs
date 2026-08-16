import { createHash } from "node:crypto";

const MAGIC = Buffer.from("F1SC", "ascii");
const VERSION = 1;

function invariant(value, message) {
  if (!value) throw new Error(message);
}

export class CssCompileError extends Error {
  constructor(message, diagnostics = []) {
    super(message);
    this.name = "CssCompileError";
    this.diagnostics = diagnostics;
  }
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//gu, "");
}

function findClosingBrace(source, opening) {
  let depth = 0;
  for (let index = opening; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}" && --depth === 0) return index;
  }
  throw new Error("CSS block has an unmatched opening brace.");
}

function parseDeclarations(body) {
  const declarations = {};
  for (const part of body.split(";")) {
    const colon = part.indexOf(":");
    if (colon < 0) continue;
    const name = part.slice(0, colon).trim().toLowerCase();
    const value = part.slice(colon + 1).trim().replace(/\s+/gu, " ");
    invariant(!/!important\b/iu.test(value), `CSS !important is unsupported on ${name}.`);
    if (name && value) declarations[name] = value;
  }
  return declarations;
}

function parseFlatRules(source) {
  const rules = [];
  const expression = /([^{}]+)\{([^{}]*)\}/gu;
  let match;
  while ((match = expression.exec(source))) {
    for (const selector of match[1].split(",")) {
      rules.push({ selector: selector.trim(), declarations: parseDeclarations(match[2]) });
    }
  }
  return rules;
}

function parseKeyframes(css) {
  const keyframes = new Map();
  let remainder = css;
  const expression = /@keyframes\s+([a-z_][\w-]*)\s*\{/giu;
  let match;
  while ((match = expression.exec(remainder))) {
    const opening = match.index + match[0].lastIndexOf("{");
    const closing = findClosingBrace(remainder, opening);
    const body = remainder.slice(opening + 1, closing);
    const stops = [];
    for (const rule of parseFlatRules(body)) {
      for (const position of rule.selector.split(",")) {
        const token = position.trim().toLowerCase();
        const percent = token === "from" ? 0 : token === "to" ? 100 :
          /^\d+(?:\.\d+)?%$/u.test(token) ? Number.parseFloat(token) : Number.NaN;
        invariant(Number.isFinite(percent) && percent >= 0 && percent <= 100,
          `Unsupported keyframe position ${position}.`);
        stops.push({ percent, declarations: rule.declarations });
      }
    }
    const merged = new Map();
    for (const stop of stops) merged.set(stop.percent, { percent: stop.percent,
      declarations: { ...(merged.get(stop.percent)?.declarations ?? {}), ...stop.declarations } });
    keyframes.set(match[1], [...merged.values()].sort((left, right) => left.percent - right.percent));
    remainder = `${remainder.slice(0, match.index)}${" ".repeat(closing + 1 - match.index)}${remainder.slice(closing + 1)}`;
    expression.lastIndex = match.index;
  }
  return { keyframes, rules: parseFlatRules(remainder) };
}

function parseColor(value) {
  const token = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/u.exec(token);
  if (hex) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((digit) => digit.repeat(2)).join("") : hex[1];
    return { r: Number.parseInt(digits.slice(0, 2), 16), g: Number.parseInt(digits.slice(2, 4), 16),
      b: Number.parseInt(digits.slice(4, 6), 16), a: 255 };
  }
  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/u.exec(token);
  invariant(rgba, `Unsupported color ${value}.`);
  const [r, g, b] = rgba.slice(1, 4).map(Number);
  const alpha = rgba[4] === undefined ? 1 : Number(rgba[4]);
  invariant([r, g, b].every((channel) => channel >= 0 && channel <= 255) && alpha >= 0 && alpha <= 1,
    `Color ${value} is outside RGBA bounds.`);
  return { r, g, b, a: Math.round(alpha * 255) };
}

function rgb565({ r, g, b }) {
  return ((r >>> 3) << 11) | ((g >>> 2) << 5) | (b >>> 3);
}

function expand565(value) {
  const r5 = (value >>> 11) & 0x1f;
  const g6 = (value >>> 5) & 0x3f;
  const b5 = value & 0x1f;
  return { r: (r5 << 3) | (r5 >>> 2), g: (g6 << 2) | (g6 >>> 4),
    b: (b5 << 3) | (b5 >>> 2), a: 255 };
}

function composite(color, background) {
  const alpha = color.a / 255;
  return {
    r: Math.round(color.r * alpha + background.r * (1 - alpha)),
    g: Math.round(color.g * alpha + background.g * (1 - alpha)),
    b: Math.round(color.b * alpha + background.b * (1 - alpha)),
    a: 255,
  };
}

function parseGlow(value, maxRadius) {
  if (!value || value === "none") return { radius: 0 };
  const radii = [...value.matchAll(/0\s+0\s+(\d+(?:\.\d+)?)px/gu)].map((match) => Number(match[1]));
  if (radii.length === 0) return { radius: 0 };
  return { radius: Math.min(maxRadius, Math.max(1, Math.round(Math.max(...radii) / 5))) };
}

function parseAnimation(value, tickMs) {
  const seconds = [...value.matchAll(/(-?[\d.]+)s\b/gu)].map((match) => Number(match[1]));
  const name = /^([a-z_][\w-]*)\b/iu.exec(value)?.[1];
  invariant(name && seconds.length >= 1, `Unsupported animation shorthand ${value}.`);
  invariant(/\binfinite\b/u.test(value), "The renderer-v1 prototype supports infinite animations only.");
  const durationTicks = Math.round(seconds[0] * 1000 / tickMs);
  const delayTicks = Math.round((seconds[1] ?? 0) * 1000 / tickMs);
  invariant(durationTicks > 0 && durationTicks <= 65535 && delayTicks >= 0 && delayTicks <= 65535,
    "Animation duration or delay exceeds renderer-v1 limits.");
  return { name, durationTicks, delayTicks, easing: /\bease-in-out\b/u.test(value) ? "ease-in-out" : "linear" };
}

function parseNth(expression) {
  const token = expression.replace(/\s+/gu, "").toLowerCase();
  if (token === "odd") return { a: 2, b: 1 };
  if (token === "even") return { a: 2, b: 0 };
  if (/^[+-]?\d+$/u.test(token)) return { a: 0, b: Number(token) };
  const match = /^([+-]?\d*)n([+-]\d+)?$/u.exec(token);
  invariant(match, `Unsupported nth-child expression ${expression}.`);
  const a = match[1] === "" || match[1] === "+" ? 1 : match[1] === "-" ? -1 : Number(match[1]);
  return { a, b: Number(match[2] ?? 0) };
}

function matchesNth(oneBasedIndex, { a, b }) {
  if (a === 0) return oneBasedIndex === b;
  const quotient = (oneBasedIndex - b) / a;
  return Number.isInteger(quotient) && quotient >= 0;
}

function extractGlyphs(html, rootClass) {
  const root = new RegExp(`<div[^>]+class=["'][^"']*\\b${rootClass}\\b[^"']*["'][^>]*>([\\s\\S]*)<\\/div>`, "iu").exec(html);
  invariant(root, `HTML does not contain .${rootClass}.`);
  return [...root[1].matchAll(/<span(?:\s[^>]*)?>([\s\S]*?)<\/span>/giu)]
    .map((match) => match[1].replace(/<[^>]+>/gu, "").trim()).filter(Boolean);
}

const PROPERTY_POLICIES = Object.freeze({
  root: Object.freeze({
    "background-color": "compiled", color: "compiled", width: "lowered", height: "lowered", overflow: "lowered",
    display: "lowered", "grid-template-columns": "lowered", "grid-auto-rows": "lowered", "min-width": "lowered",
    "min-height": "lowered", "font-size": "lowered", "font-family": "lowered", "justify-content": "lowered",
    "align-content": "lowered",
  }),
  span: Object.freeze({ color: "compiled", "text-shadow": "lowered", animation: "compiled", "text-align": "lowered",
    "user-select": "ignored", transition: "ignored", "line-height": "lowered" }),
  nth: Object.freeze({ color: "compiled", "text-shadow": "lowered", animation: "compiled" }),
  keyframe: Object.freeze({ color: "compiled", "text-shadow": "lowered" }),
});

function normalizeSelector(selector) {
  return selector.trim().replace(/\s*>\s*/gu, " > ").replace(/\s+/gu, " ");
}

function auditDeclarations(declarations, context, selector, diagnostics) {
  const policy = PROPERTY_POLICIES[context];
  for (const property of Object.keys(declarations)) {
    const treatment = policy[property];
    if (!treatment) {
      diagnostics.push({ severity: "error", code: "CSS_PROPERTY_UNSUPPORTED", selector, property,
        message: `${property} is not supported in ${context} rules.` });
    } else if (treatment !== "compiled") {
      diagnostics.push({ severity: "warning", code: `CSS_PROPERTY_${treatment.toUpperCase()}`, selector, property,
        message: `${property} is ${treatment} by the 100x310 device profile.` });
    }
  }
}

function lowerKeyframes(name, rawStops, { background, baseColor, maxGlowRadius }) {
  invariant(rawStops?.length >= 2, `Animation ${name} needs at least two keyframe stops.`);
  const stops = rawStops.map(({ percent, declarations }) => {
    const color = declarations.color ? parseColor(declarations.color) : baseColor;
    const visible = composite(color, background);
    const glow = parseGlow(declarations["text-shadow"], maxGlowRadius);
    return { percent, rgba: color, color565: rgb565(visible), glowRadius: glow.radius };
  });
  if (stops[0].percent !== 0) stops.unshift({ ...stops[0], percent: 0 });
  if (stops.at(-1).percent !== 100) stops.push({ ...stops[0], percent: 100 });
  return { name, stops };
}

export const MATRIX_DEVICE_PROFILE = Object.freeze({
  width: 100,
  height: 310,
  columns: 5,
  rows: 15,
  cellWidth: 20,
  cellHeight: 20,
  top: 5,
  fontPixelSize: 14,
  glyphMaskBitsPerPixel: 1,
  tickMs: 100,
  maxCells: 75,
  maxAnimationConfigs: 16,
  maxKeyframeStops: 8,
  maxGlowRadius: 3,
  maxSceneBytes: 2048,
  maxPersistentBytes: 70 * 1024,
  maxDirtyPixelsPerTick: 31000,
});

export function compileCssWidget({ html, css, rootClass = "jp-matrix", profile = MATRIX_DEVICE_PROFILE }) {
  invariant(/^[a-z_][\w-]*$/iu.test(rootClass), "rootClass must be one CSS class identifier.");
  const cleanCss = stripComments(css);
  const { keyframes, rules } = parseKeyframes(cleanCss);
  const diagnostics = [];
  const glyphSource = extractGlyphs(html, rootClass);
  invariant(glyphSource.length > 0, "The widget has no span glyphs.");
  let rootDeclarations = null;
  let spanDeclarations = null;
  const nthRules = [];
  rules.forEach((rule, order) => {
    const selector = normalizeSelector(rule.selector);
    if (selector === `.${rootClass}`) {
      auditDeclarations(rule.declarations, "root", selector, diagnostics);
      rootDeclarations = { ...(rootDeclarations ?? {}), ...rule.declarations };
      return;
    }
    if (selector === `.${rootClass} > span`) {
      auditDeclarations(rule.declarations, "span", selector, diagnostics);
      spanDeclarations = { ...(spanDeclarations ?? {}), ...rule.declarations };
      return;
    }
    const match = new RegExp(`^\\.${rootClass} > span:nth-child\\(([^)]+)\\)$`, "u").exec(selector);
    if (match) {
      auditDeclarations(rule.declarations, "nth", selector, diagnostics);
      nthRules.push({ order, nth: parseNth(match[1]), declarations: rule.declarations });
      return;
    }
    diagnostics.push({ severity: "error", code: "CSS_SELECTOR_UNSUPPORTED", selector,
      message: `Selector ${selector} is outside the semantic renderer subset.` });
  });
  for (const [name, stops] of keyframes) for (const stop of stops) {
    auditDeclarations(stop.declarations, "keyframe", `@keyframes ${name} ${stop.percent}%`, diagnostics);
  }
  const errors = diagnostics.filter(({ severity }) => severity === "error");
  if (errors.length) throw new CssCompileError(`CSS compilation failed with ${errors.length} unsupported construct(s).`, diagnostics);
  invariant(rootDeclarations && spanDeclarations, "The prototype requires root and direct-span rules.");
  const background = parseColor(rootDeclarations["background-color"] ?? "#000000");
  const baseColor = parseColor(spanDeclarations.color ?? rootDeclarations.color ?? "#ffffff");

  const glyphs = [...new Set(glyphSource.slice(0, profile.maxCells))];
  const glyphIds = new Map(glyphs.map((glyph, index) => [glyph, index]));
  const animations = [];
  const animationIds = new Map();
  const usedTracks = new Set();
  const cells = glyphSource.slice(0, profile.maxCells).map((glyph, index) => {
    let declarations = { ...spanDeclarations };
    for (const rule of nthRules) {
      if (matchesNth(index + 1, rule.nth)) declarations = { ...declarations, ...rule.declarations };
    }
    let animationId = 255;
    if (declarations.animation) {
      const animation = parseAnimation(declarations.animation, profile.tickMs);
      invariant(keyframes.has(animation.name), `Animation ${animation.name} has no @keyframes block.`);
      const key = JSON.stringify(animation);
      if (!animationIds.has(key)) {
        invariant(animations.length < profile.maxAnimationConfigs, "Animation configuration budget exceeded.");
        animationIds.set(key, animations.length);
        animations.push(animation);
      }
      animationId = animationIds.get(key);
      usedTracks.add(animation.name);
    }
    const color = declarations.color ? parseColor(declarations.color) : baseColor;
    const glowRadius = parseGlow(declarations["text-shadow"], profile.maxGlowRadius).radius;
    return {
      index,
      glyph,
      glyphId: glyphIds.get(glyph),
      x: (index % profile.columns) * profile.cellWidth,
      y: profile.top + Math.floor(index / profile.columns) * profile.cellHeight,
      color565: rgb565(composite(color, background)),
      glowRadius,
      animationId,
    };
  });
  const tracks = [...usedTracks].map((name) => lowerKeyframes(name, keyframes.get(name), {
    background, baseColor, maxGlowRadius: profile.maxGlowRadius,
  }));
  invariant(tracks.every((track) => track.stops.length <= profile.maxKeyframeStops),
    "Keyframe stop budget exceeded.");
  animations.forEach((animation) => { animation.trackId = tracks.findIndex(({ name }) => name === animation.name); });

  const scene = {
    format: "framer-css-scene-v1",
    viewport: { width: profile.width, height: profile.height },
    tickMs: profile.tickMs,
    layout: { columns: profile.columns, rows: profile.rows, cellWidth: profile.cellWidth,
      cellHeight: profile.cellHeight, top: profile.top },
    background: { rgba: background, color565: rgb565(background), deviceRgba: expand565(rgb565(background)) },
    baseColor,
    glyphs,
    cells,
    animations,
    tracks,
    diagnostics,
    lowerings: [
      "The 1920x1080 minimum and 40px browser grid are replaced by a 5x15 device grid on 100x310.",
      "Courier New/fallback glyphs become a pinned 1-bit bitmap atlas; stock Katakana font coverage is not assumed.",
      "Multiple Gaussian text shadows become a bounded 0..3px software halo.",
      "CSS cubic ease-in-out becomes deterministic smoothstep interpolation at 100ms ticks.",
      "Only the first 75 overflow-hidden cells are materialized; the remaining HTML is virtualized away.",
      "Transitions, selection, browser reflow, and the CSS cascade outside the supported selectors are host-only.",
    ],
  };
  const binary = encodeCssScene(scene);
  const animatedCells = cells.filter(({ animationId }) => animationId !== 255).length;
  const atlasRowBytes = Math.ceil(profile.fontPixelSize / 8);
  const glyphAtlasBytes = glyphs.length * atlasRowBytes * profile.fontPixelSize;
  scene.budget = {
    sceneBytes: binary.length,
    frameBufferBytes: profile.width * profile.height * 2,
    descriptorBytes: 48,
    glyphAtlasBytes,
    cellScratchBytes: profile.cellWidth * profile.cellHeight * 2,
    totalPersistentEstimate: profile.width * profile.height * 2 + 48 + glyphAtlasBytes + binary.length,
    animatedCells,
    maxDirtyPixelsPerTick: animatedCells * profile.cellWidth * profile.cellHeight,
  };
  invariant(scene.budget.sceneBytes <= (profile.maxSceneBytes ?? Number.MAX_SAFE_INTEGER),
    `Scene byte budget exceeded: ${scene.budget.sceneBytes}.`);
  invariant(scene.budget.totalPersistentEstimate <= (profile.maxPersistentBytes ?? Number.MAX_SAFE_INTEGER),
    `Scene persistent-memory budget exceeded: ${scene.budget.totalPersistentEstimate}.`);
  invariant(scene.budget.maxDirtyPixelsPerTick <= (profile.maxDirtyPixelsPerTick ?? Number.MAX_SAFE_INTEGER),
    `Scene dirty-pixel budget exceeded: ${scene.budget.maxDirtyPixelsPerTick}.`);
  scene.sha256 = createHash("sha256").update(binary).digest("hex");
  return { scene, binary };
}

export function encodeCssScene(scene) {
  validateCssScene(scene);
  const trackBytes = scene.tracks.reduce((sum, track) => sum + 4 + track.stops.length * 8, 0);
  const output = Buffer.alloc(24 + scene.glyphs.length * 4 + scene.cells.length * 8 +
    scene.animations.length * 8 + trackBytes);
  MAGIC.copy(output, 0);
  output[4] = VERSION;
  output[5] = scene.viewport.width;
  output.writeUInt16LE(scene.viewport.height, 6);
  output.writeUInt16LE(scene.tickMs, 8);
  output[10] = scene.layout.columns;
  output[11] = scene.layout.rows;
  output.writeUInt16LE(scene.cells.length, 12);
  output.writeUInt16LE(scene.glyphs.length, 14);
  output.writeUInt16LE(scene.animations.length, 16);
  output.writeUInt16LE(scene.tracks.length, 18);
  output.writeUInt16LE(scene.background.color565, 20);
  output.writeUInt16LE(rgb565(composite(scene.baseColor, scene.background.rgba)), 22);
  let cursor = 24;
  for (const glyph of scene.glyphs) {
    output.writeUInt32LE(glyph.codePointAt(0), cursor);
    cursor += 4;
  }
  for (const cell of scene.cells) {
    output[cursor] = cell.x;
    output.writeUInt16LE(cell.y, cursor + 1);
    output[cursor + 3] = cell.glyphId;
    output[cursor + 4] = cell.animationId;
    output.writeUInt16LE(cell.color565, cursor + 5);
    output[cursor + 7] = cell.glowRadius ?? 0;
    cursor += 8;
  }
  for (const animation of scene.animations) {
    output.writeUInt16LE(animation.durationTicks, cursor);
    output.writeUInt16LE(animation.delayTicks, cursor + 2);
    output[cursor + 4] = animation.trackId;
    output[cursor + 5] = animation.easing === "ease-in-out" ? 1 : 0;
    output.writeUInt16LE(0, cursor + 6);
    cursor += 8;
  }
  for (const track of scene.tracks) {
    output[cursor] = track.stops.length;
    output.fill(0, cursor + 1, cursor + 4);
    cursor += 4;
    for (const stop of track.stops) {
      output[cursor] = stop.percent;
      output[cursor + 1] = stop.rgba.r;
      output[cursor + 2] = stop.rgba.g;
      output[cursor + 3] = stop.rgba.b;
      output[cursor + 4] = stop.rgba.a;
      output[cursor + 5] = stop.glowRadius;
      output.writeUInt16LE(stop.color565, cursor + 6);
      cursor += 8;
    }
  }
  invariant(cursor === output.length, "Scene encoder length accounting drifted.");
  return output;
}

export function validateCssScene(scene, { profile = MATRIX_DEVICE_PROFILE } = {}) {
  invariant(scene && scene.format === "framer-css-scene-v1", "Scene format must be framer-css-scene-v1.");
  invariant(Number.isInteger(scene.viewport?.width) && scene.viewport.width > 0 && scene.viewport.width <= 255 &&
    Number.isInteger(scene.viewport?.height) && scene.viewport.height > 0 && scene.viewport.height <= 65535,
  "Scene viewport is invalid.");
  invariant(Number.isInteger(scene.tickMs) && scene.tickMs > 0 && scene.tickMs <= 65535, "Scene tick is invalid.");
  invariant(Array.isArray(scene.glyphs) && scene.glyphs.length > 0 && scene.glyphs.length <= 255,
    "Scene glyph count is invalid.");
  scene.glyphs.forEach((glyph, index) => invariant(typeof glyph === "string" && Array.from(glyph).length === 1,
    `Scene glyph ${index} must be one Unicode scalar.`));
  invariant(Array.isArray(scene.cells) && scene.cells.length > 0 && scene.cells.length <= profile.maxCells,
    "Scene cell budget exceeded.");
  invariant(Array.isArray(scene.animations) && scene.animations.length <= profile.maxAnimationConfigs,
    "Scene animation budget exceeded.");
  invariant(Array.isArray(scene.tracks) && scene.tracks.length <= profile.maxAnimationConfigs,
    "Scene track budget exceeded.");
  scene.cells.forEach((cell, index) => {
    invariant(Number.isInteger(cell.x) && cell.x >= 0 && cell.x < scene.viewport.width &&
      Number.isInteger(cell.y) && cell.y >= 0 && cell.y < scene.viewport.height,
    `Cell ${index} coordinate is outside the viewport.`);
    invariant(Number.isInteger(cell.glyphId) && cell.glyphId >= 0 && cell.glyphId < scene.glyphs.length,
      `Cell ${index} glyph reference is invalid.`);
    invariant(cell.animationId === 255 || Number.isInteger(cell.animationId) && cell.animationId >= 0 &&
      cell.animationId < scene.animations.length, `Cell ${index} animation reference is invalid.`);
    invariant(Number.isInteger(cell.color565) && cell.color565 >= 0 && cell.color565 <= 0xffff,
      `Cell ${index} color is invalid.`);
    invariant(Number.isInteger(cell.glowRadius ?? 0) && (cell.glowRadius ?? 0) >= 0 &&
      (cell.glowRadius ?? 0) <= profile.maxGlowRadius, `Cell ${index} glow is invalid.`);
  });
  scene.animations.forEach((animation, index) => {
    invariant(Number.isInteger(animation.durationTicks) && animation.durationTicks > 0 && animation.durationTicks <= 65535 &&
      Number.isInteger(animation.delayTicks) && animation.delayTicks >= 0 && animation.delayTicks <= 65535,
    `Animation ${index} timing is invalid.`);
    invariant(Number.isInteger(animation.trackId) && animation.trackId >= 0 && animation.trackId < scene.tracks.length,
      `Animation ${index} track reference is invalid.`);
    invariant(animation.easing === "linear" || animation.easing === "ease-in-out",
      `Animation ${index} easing is invalid.`);
  });
  scene.tracks.forEach((track, trackIndex) => {
    invariant(Array.isArray(track.stops) && track.stops.length >= 2 && track.stops.length <= profile.maxKeyframeStops,
      `Track ${trackIndex} stop budget is invalid.`);
    let previous = -1;
    track.stops.forEach((stop, stopIndex) => {
      invariant(Number.isInteger(stop.percent) && stop.percent >= 0 && stop.percent <= 100 && stop.percent > previous,
        `Track ${trackIndex} stop ${stopIndex} is not strictly ordered.`);
      invariant(Number.isInteger(stop.glowRadius) && stop.glowRadius >= 0 && stop.glowRadius <= profile.maxGlowRadius,
        `Track ${trackIndex} stop ${stopIndex} glow is invalid.`);
      previous = stop.percent;
    });
    invariant(track.stops[0].percent === 0 && track.stops.at(-1).percent === 100,
      `Track ${trackIndex} must cover 0% through 100%.`);
  });
  return true;
}

export function decodeCssScene(value, { profile = MATRIX_DEVICE_PROFILE } = {}) {
  invariant(value instanceof Uint8Array, "Scene binary must be a Uint8Array.");
  const binary = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  invariant(binary.length >= 24 && binary.subarray(0, 4).equals(MAGIC), "Scene is truncated or has invalid F1SC magic.");
  invariant(binary.length <= (profile.maxSceneBytes ?? Number.MAX_SAFE_INTEGER), "Scene binary byte budget exceeded.");
  invariant(binary[4] === VERSION, `Unsupported F1SC version ${binary[4]}.`);
  const cellCount = binary.readUInt16LE(12);
  const glyphCount = binary.readUInt16LE(14);
  const animationCount = binary.readUInt16LE(16);
  const trackCount = binary.readUInt16LE(18);
  invariant(cellCount > 0 && cellCount <= profile.maxCells && glyphCount > 0 && glyphCount <= 255 &&
    animationCount <= profile.maxAnimationConfigs && trackCount <= profile.maxAnimationConfigs,
  "Scene header count exceeds renderer limits.");
  let cursor = 24;
  invariant(cursor + glyphCount * 4 + cellCount * 8 + animationCount * 8 <= binary.length,
    "Scene fixed records are truncated.");
  const glyphs = Array.from({ length: glyphCount }, () => {
    const codePoint = binary.readUInt32LE(cursor); cursor += 4;
    invariant(codePoint <= 0x10ffff && !(codePoint >= 0xd800 && codePoint <= 0xdfff), "Scene contains an invalid code point.");
    return String.fromCodePoint(codePoint);
  });
  const cells = Array.from({ length: cellCount }, (_, index) => {
    const cell = { index, x: binary[cursor], y: binary.readUInt16LE(cursor + 1), glyphId: binary[cursor + 3],
      animationId: binary[cursor + 4], color565: binary.readUInt16LE(cursor + 5), glowRadius: binary[cursor + 7] };
    cell.glyph = glyphs[cell.glyphId]; cursor += 8; return cell;
  });
  const animations = Array.from({ length: animationCount }, () => {
    invariant(binary[cursor + 5] <= 1 && binary.readUInt16LE(cursor + 6) === 0,
      "Scene animation contains invalid easing or reserved bytes.");
    const animation = { durationTicks: binary.readUInt16LE(cursor), delayTicks: binary.readUInt16LE(cursor + 2),
      trackId: binary[cursor + 4], easing: binary[cursor + 5] === 1 ? "ease-in-out" : "linear" };
    cursor += 8; return animation;
  });
  const tracks = Array.from({ length: trackCount }, (_, trackId) => {
    invariant(cursor + 4 <= binary.length, `Track ${trackId} header is truncated.`);
    const stopCount = binary[cursor]; cursor += 4;
    invariant(binary[cursor - 3] === 0 && binary[cursor - 2] === 0 && binary[cursor - 1] === 0,
      `Track ${trackId} reserved bytes are nonzero.`);
    invariant(stopCount >= 2 && stopCount <= profile.maxKeyframeStops && cursor + stopCount * 8 <= binary.length,
      `Track ${trackId} is truncated or over budget.`);
    const stops = Array.from({ length: stopCount }, () => {
      const stop = { percent: binary[cursor], rgba: { r: binary[cursor + 1], g: binary[cursor + 2],
        b: binary[cursor + 3], a: binary[cursor + 4] }, glowRadius: binary[cursor + 5],
      color565: binary.readUInt16LE(cursor + 6) };
      cursor += 8; return stop;
    });
    return { name: `track-${trackId}`, stops };
  });
  invariant(cursor === binary.length, "Scene has trailing or unaccounted bytes.");
  const background565 = binary.readUInt16LE(20);
  const base565 = binary.readUInt16LE(22);
  const scene = { format: "framer-css-scene-v1", viewport: { width: binary[5], height: binary.readUInt16LE(6) },
    tickMs: binary.readUInt16LE(8), layout: { columns: binary[10], rows: binary[11],
      cellWidth: profile.cellWidth, cellHeight: profile.cellHeight, top: profile.top },
    background: { color565: background565, rgba: expand565(background565), deviceRgba: expand565(background565) },
    baseColor: expand565(base565), glyphs, cells, animations, tracks,
    sha256: createHash("sha256").update(binary).digest("hex") };
  validateCssScene(scene, { profile });
  return scene;
}

const SAMPLE_Q = 65535;

function divideRound(numerator, denominator) {
  return Math.floor((numerator + Math.floor(denominator / 2)) / denominator);
}

function smoothstepQ(value) {
  const squared = divideRound(value * value, SAMPLE_Q);
  const cubed = divideRound(squared * value, SAMPLE_Q);
  return Math.max(0, Math.min(SAMPLE_Q, 3 * squared - 2 * cubed));
}

function mixQ(left, right, amount) {
  return left + divideRound((right - left) * amount, SAMPLE_Q);
}

export function sampleCssCell(scene, cellIndex, elapsedMs) {
  invariant(Number.isFinite(elapsedMs) && elapsedMs >= 0, "Elapsed time must be a non-negative number.");
  return sampleCssCellAtTick(scene, cellIndex, Math.floor(elapsedMs / scene.tickMs));
}

export function sampleCssCellAtTick(scene, cellIndex, elapsedTick) {
  const cell = scene.cells[cellIndex];
  invariant(cell, `Cell ${cellIndex} is outside the scene.`);
  invariant(Number.isInteger(elapsedTick) && elapsedTick >= 0, "Elapsed tick must be a non-negative integer.");
  if (cell.animationId === 255) return { color565: cell.color565, glowRadius: cell.glowRadius ?? 0, progress: null };
  const animation = scene.animations[cell.animationId];
  if (elapsedTick < animation.delayTicks) return { color565: cell.color565, glowRadius: cell.glowRadius ?? 0, progress: 0 };
  const phaseTick = (elapsedTick - animation.delayTicks) % animation.durationTicks;
  const progress = phaseTick / animation.durationTicks;
  const track = scene.tracks[animation.trackId];
  let rightIndex = track.stops.findIndex((stop) => stop.percent * animation.durationTicks >= phaseTick * 100);
  if (rightIndex <= 0) rightIndex = 1;
  const left = track.stops[rightIndex - 1];
  const right = track.stops[rightIndex] ?? track.stops.at(-1);
  const denominator = Math.max(1, (right.percent - left.percent) * animation.durationTicks);
  const numerator = Math.max(0, phaseTick * 100 - left.percent * animation.durationTicks);
  let amount = Math.min(SAMPLE_Q, divideRound(numerator * SAMPLE_Q, denominator));
  if (animation.easing === "ease-in-out") amount = smoothstepQ(amount);
  const rgba = {
    r: mixQ(left.rgba.r, right.rgba.r, amount),
    g: mixQ(left.rgba.g, right.rgba.g, amount),
    b: mixQ(left.rgba.b, right.rgba.b, amount),
    a: mixQ(left.rgba.a, right.rgba.a, amount),
  };
  return {
    rgba,
    color565: rgb565(composite(rgba, scene.background.deviceRgba ?? expand565(scene.background.color565))),
    glowRadius: mixQ(left.glowRadius, right.glowRadius, amount),
    progress,
    interpolationQ16: amount,
  };
}
