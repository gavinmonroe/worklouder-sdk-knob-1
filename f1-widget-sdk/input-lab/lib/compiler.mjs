import { compileCssWidget, encodeWidgetBundle, MATRIX_DEVICE_PROFILE,
  rasterizeGlyphAtlasWithMagick } from "../../src/render/index.mjs";

export const INPUT_LAB_LIMITS = Object.freeze({ htmlBytes: 48 * 1024, cssBytes: 32 * 1024 });
const ALLOWED_CSS_PROPERTIES = new Set(["animation", "background-color", "color", "text-shadow"]);

function invariant(value, message) {
  if (!value) throw new Error(message);
}

function boundedSource(value, label, maximum) {
  invariant(typeof value === "string", `${label} must be text.`);
  invariant(value.trim().length > 0, `${label} cannot be empty.`);
  invariant(Buffer.byteLength(value, "utf8") <= maximum, `${label} exceeds ${maximum} UTF-8 bytes.`);
  return value;
}

export function validateInputLabSource({ html, css }) {
  boundedSource(html, "HTML", INPUT_LAB_LIMITS.htmlBytes);
  boundedSource(css, "CSS", INPUT_LAB_LIMITS.cssBytes);
  invariant(!/<(?:script|style|iframe|object|embed|img|link)\b/iu.test(html),
    "Input Lab HTML supports only the scene div and text spans.");
  invariant(!/\son[a-z]+\s*=/iu.test(html), "Event-handler attributes are not supported.");
  invariant(!/@(?:import|supports|media|layer|font-face)\b|url\s*\(|expression\s*\(/iu.test(css),
    "External resources and browser-only CSS rules are not supported.");
  for (const block of css.matchAll(/\{([^{}]*)\}/gu)) {
    for (const match of block[1].matchAll(/([a-z-]+)\s*:/giu)) {
      invariant(ALLOWED_CSS_PROPERTIES.has(match[1].toLowerCase()),
        `CSS property ${match[1]} is outside the Input Lab renderer profile.`);
    }
  }
  return Object.freeze({ html, css });
}

const productionAtlasCache = new Map();

function compileSceneSource(source) {
  const { html, css } = validateInputLabSource(source);
  const result = compileCssWidget({ html, css, rootClass: "input-scene", profile: MATRIX_DEVICE_PROFILE });
  invariant(result.scene.viewport.width === 100 && result.scene.viewport.height === 310,
    "Input Lab scenes must compile to the exact 100x310 logical canvas.");
  return result;
}

async function cachedProductionAtlas(glyphs) {
  const key = glyphs.join("");
  if (!productionAtlasCache.has(key)) {
    productionAtlasCache.set(key, rasterizeGlyphAtlasWithMagick(glyphs).catch((error) => {
      productionAtlasCache.delete(key);
      throw error;
    }));
  }
  return productionAtlasCache.get(key);
}

export async function compileInputLabScene(source, { atlasFactory = cachedProductionAtlas, allowTestAtlas = false } = {}) {
  const result = compileSceneSource(source);
  const atlas = await atlasFactory(result.scene.glyphs);
  invariant(allowTestAtlas || atlas?.testOnly !== true, "Input Lab runtime previews cannot use a synthetic glyph atlas.");
  return Object.freeze({ ...result, atlas });
}

export function serializeInputLabCompilation({ scene, binary, atlas }) {
  return Object.freeze({ scene, binaryBase64: binary.toString("base64"), binaryBytes: binary.length,
    sha256: scene.sha256, atlas: Object.freeze({ width: atlas.width, height: atlas.height,
      rowStride: atlas.rowStride, masksBase64: atlas.masks.map((mask) => mask.toString("base64")),
      sha256: atlas.sha256, testOnly: atlas.testOnly }) });
}

function fitSlotName(value, index) {
  let output = "";
  for (const character of String(value ?? `Preview ${index + 1}`).trim()) {
    if (Buffer.byteLength(output + character, "utf8") > 16) break;
    output += character;
  }
  return output || `Preview ${index + 1}`;
}

export async function compileInputLabBundle({ slots, activeSlot, generation = 1, atlasFactory,
  allowTestAtlas = false } = {}) {
  if (!Array.isArray(slots) || slots.length !== 3) throw new Error("Input Lab push requires exactly three previews.");
  const compiledSlots = await Promise.all(slots.map((slot) => compileInputLabScene(slot,
    { atlasFactory, allowTestAtlas })));
  const bundle = encodeWidgetBundle({ activeSlot, generation, slots: compiledSlots.map((compiled, index) => ({
    kind: "semantic", name: fitSlotName(slots[index].name, index), sceneBinary: compiled.binary, atlas: compiled.atlas,
    ...(allowTestAtlas ? { allowTestAtlas: true } : {}),
  })) });
  return Object.freeze({ compiledSlots, bundle });
}

export async function compileInputLabWidgetBundle({ slots, activeSlot, generation = 1, captureProvider,
  atlasFactory, allowTestAtlas = false } = {}) {
  if (!Array.isArray(slots) || slots.length !== 3) throw new Error("Input Lab push requires exactly three previews.");
  const compiledSlots = [];
  const widgetSlots = [];
  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index];
    if (slot.mode === "raster") {
      if (!captureProvider || typeof captureProvider.capture !== "function") {
        throw new Error("Raster preview requires an explicitly configured Chromium capture provider.");
      }
      const captured = await captureProvider.capture(slot);
      compiledSlots.push(Object.freeze({ mode: "raster", ...captured }));
      widgetSlots.push({ kind: "raster", name: fitSlotName(slot.name, index),
        animationBinary: captured.animation.binary });
    } else {
      const compiled = await compileInputLabScene(slot, { atlasFactory, allowTestAtlas });
      compiledSlots.push(Object.freeze({ mode: "semantic", ...compiled }));
      widgetSlots.push({ kind: "semantic", name: fitSlotName(slot.name, index), sceneBinary: compiled.binary,
        atlas: compiled.atlas, ...(allowTestAtlas ? { allowTestAtlas: true } : {}) });
    }
  }
  const bundle = encodeWidgetBundle({ slots: widgetSlots, activeSlot, generation });
  return Object.freeze({ compiledSlots, bundle });
}
