import { compileCssWidget, CssCompileError, encodeWidgetBundle, MATRIX_DEVICE_PROFILE,
  buildGlyphAtlas, rasterizeGlyphAtlasWithMagick, WIDGET_SCENE_RPC_LIMITS } from "../../src/render/index.mjs";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export const INPUT_LAB_LIMITS = Object.freeze({ htmlBytes: 48 * 1024, cssBytes: 32 * 1024 });
export const INPUT_LAB_SEMANTIC_UNSUPPORTED = "INPUT_LAB_SEMANTIC_UNSUPPORTED";
export const HOSTED_GLYPH_CACHE_SHA256 = "2cd872bdd4f036034d46f711b422f469af8df547e4c7d7de4b2ecb3771d7aa73";
const ALLOWED_CSS_PROPERTIES = new Set(["animation", "background-color", "color", "text-shadow"]);
const FALLBACK_DIAGNOSTIC_CODES = new Set(["CSS_PROPERTY_UNSUPPORTED", "CSS_SELECTOR_UNSUPPORTED",
  "GLYPH_ATLAS_UNSUPPORTED"]);

function invariant(value, message) {
  if (!value) throw new Error(message);
}

function boundedSource(value, label, maximum) {
  invariant(typeof value === "string", `${label} must be text.`);
  invariant(value.trim().length > 0, `${label} cannot be empty.`);
  invariant(Buffer.byteLength(value, "utf8") <= maximum, `${label} exceeds ${maximum} UTF-8 bytes.`);
  return value;
}

function validateCssStructure(source) {
  let depth = 0;
  let quote = null;
  let comment = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (comment) {
      if (character === "*" && next === "/") { comment = false; index += 1; }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "/" && next === "*") { comment = true; index += 1; continue; }
    if (character === '"' || character === "'") { quote = character; continue; }
    if (character === "{") depth += 1;
    if (character === "}") {
      invariant(depth > 0, "CSS has an unmatched closing brace.");
      depth -= 1;
    }
  }
  invariant(!comment, "CSS has an unterminated comment.");
  invariant(quote === null, "CSS has an unterminated string.");
  invariant(depth === 0, "CSS has an unmatched opening brace.");
}

function semanticUnsupported(message, diagnostics, cause = null) {
  return Object.assign(new Error(message), {
    code: INPUT_LAB_SEMANTIC_UNSUPPORTED,
    diagnostics: Object.freeze(diagnostics.map((diagnostic) => Object.freeze({ ...diagnostic }))),
    ...(cause ? { cause } : {}),
  });
}

function isSemanticUnsupported(error) {
  if (error?.code !== INPUT_LAB_SEMANTIC_UNSUPPORTED || !Array.isArray(error.diagnostics)) return false;
  const unsupported = error.diagnostics.filter(({ severity }) => severity === "error");
  return unsupported.length > 0 && unsupported.every(({ code }) => FALLBACK_DIAGNOSTIC_CODES.has(code));
}

function bundleOversize(message) {
  return Object.assign(new Error(message), { code: "SCENE_BUNDLE_OVERSIZE" });
}

export function validateInputLabSource({ html, css }) {
  boundedSource(html, "HTML", INPUT_LAB_LIMITS.htmlBytes);
  boundedSource(css, "CSS", INPUT_LAB_LIMITS.cssBytes);
  validateCssStructure(css);
  invariant(!/<(?:script|style|iframe|object|embed|img|link)\b/iu.test(html),
    "Input Lab HTML supports only the scene div and text spans.");
  invariant(!/\son[a-z]+\s*=/iu.test(html), "Event-handler attributes are not supported.");
  invariant(!/@(?:import|supports|media|layer|font-face)\b|url\s*\(|expression\s*\(/iu.test(css),
    "External resources and browser-only CSS rules are not supported.");
  for (const block of css.matchAll(/\{([^{}]*)\}/gu)) {
    for (const match of block[1].matchAll(/([a-z-]+)\s*:/giu)) {
      const property = match[1].toLowerCase();
      if (!ALLOWED_CSS_PROPERTIES.has(property)) {
        const message = `CSS property ${match[1]} is outside the Input Lab renderer profile.`;
        throw semanticUnsupported(message, [{ severity: "error", code: "CSS_PROPERTY_UNSUPPORTED",
          property, message }]);
      }
    }
  }
  return Object.freeze({ html, css });
}

const productionAtlasCache = new Map();
let hostedGlyphCachePromise;

export function decodeHostedGlyphCache(bytes, { expectedSha256 = HOSTED_GLYPH_CACHE_SHA256 } = {}) {
  invariant(bytes instanceof Uint8Array, "Hosted glyph cache must be bytes.");
  invariant(/^[0-9a-f]{64}$/u.test(expectedSha256), "Hosted glyph cache expected SHA-256 is invalid.");
  const raw = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const actualSha256 = createHash("sha256").update(raw).digest("hex");
  invariant(actualSha256 === expectedSha256,
    `Hosted glyph cache SHA-256 mismatch: expected ${expectedSha256}, received ${actualSha256}.`);
  let cache;
  try { cache = JSON.parse(raw.toString("utf8")); }
  catch (error) { throw new Error("Hosted glyph cache is not valid JSON.", { cause: error }); }
  invariant(cache && typeof cache === "object" && !Array.isArray(cache) &&
    Object.keys(cache).sort().join(",") === "format,glyphs,height,rowStride,source,width",
  "Hosted glyph cache schema is invalid.");
  invariant(cache.format === "framer-hosted-glyph-cache-v1" && cache.width === 14 && cache.height === 14 &&
    cache.rowStride === 2 && cache.source === "pinned-hiragino-magick-cache-v1" &&
    Array.isArray(cache.glyphs) && cache.glyphs.length > 0 && cache.glyphs.length <= 255,
  "Hosted glyph cache metadata is invalid.");
  const seen = new Set();
  const glyphs = cache.glyphs.map((entry, index) => {
    invariant(Array.isArray(entry) && entry.length === 2 && typeof entry[0] === "string" &&
      typeof entry[1] === "string", `Hosted glyph cache entry ${index} is invalid.`);
    const [glyph, encoded] = entry;
    const codePoint = glyph.codePointAt(0);
    invariant(Array.from(glyph).length === 1 && !(codePoint >= 0xd800 && codePoint <= 0xdfff),
      `Hosted glyph cache entry ${index} is not one Unicode scalar.`);
    invariant(!seen.has(glyph), `Hosted glyph cache repeats glyph ${JSON.stringify(glyph)}.`);
    seen.add(glyph);
    const mask = Buffer.from(encoded, "base64");
    invariant(mask.length === cache.rowStride * cache.height && mask.toString("base64") === encoded,
      `Hosted glyph cache mask ${index} is not canonical 14x14 base64.`);
    for (let row = 0; row < cache.height; row += 1) {
      invariant((mask[row * cache.rowStride + cache.rowStride - 1] & 0x03) === 0,
        `Hosted glyph cache mask ${index} sets width padding bits.`);
    }
    return Object.freeze([glyph, encoded]);
  });
  return Object.freeze({ ...cache, glyphs: Object.freeze(glyphs), sha256: actualSha256 });
}

async function hostedGlyphAtlas(glyphs) {
  hostedGlyphCachePromise ??= readFile(new URL("../assets/hosted-glyph-cache.json", import.meta.url))
    .then((bytes) => decodeHostedGlyphCache(bytes));
  const cache = await hostedGlyphCachePromise;
  const masks = new Map(cache.glyphs);
  const missing = glyphs.filter((glyph) => !masks.has(glyph));
  if (missing.length) return null;
  return buildGlyphAtlas({ glyphs, width: cache.width, height: cache.height, source: cache.source,
    rasterizeGlyph(glyph) { return Buffer.from(masks.get(glyph), "base64"); } });
}

function compileSceneSource(source) {
  try {
    const { html, css } = validateInputLabSource(source);
    const result = compileCssWidget({ html, css, rootClass: "input-scene", profile: MATRIX_DEVICE_PROFILE });
    invariant(result.scene.viewport.width === 100 && result.scene.viewport.height === 310,
      "Input Lab scenes must compile to the exact 100x310 logical canvas.");
    return result;
  } catch (error) {
    if (isSemanticUnsupported(error)) throw error;
    const diagnostics = error instanceof CssCompileError ? error.diagnostics ?? [] : [];
    const unsupported = diagnostics.filter(({ severity }) => severity === "error");
    if (unsupported.length > 0 && unsupported.every(({ code }) => FALLBACK_DIAGNOSTIC_CODES.has(code))) {
      throw semanticUnsupported(error.message, diagnostics, error);
    }
    throw error;
  }
}

async function cachedProductionAtlas(glyphs) {
  const key = glyphs.join("");
  if (!productionAtlasCache.has(key)) {
    productionAtlasCache.set(key, (async () => {
      const cached = await hostedGlyphAtlas(glyphs);
      if (cached) return cached;
      if (process.env.INPUT_LAB_HOSTED_CACHE_ONLY === "1") {
        const message = "Text contains glyphs outside the hosted semantic cache; use Auto or Raster mode.";
        throw semanticUnsupported(message, [{ severity: "error", code: "GLYPH_ATLAS_UNSUPPORTED", message }]);
      }
      return rasterizeGlyphAtlasWithMagick(glyphs);
    })().catch((error) => {
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
  atlasFactory, allowTestAtlas = false, onProgress = null } = {}) {
  if (!Array.isArray(slots) || slots.length !== 3) throw new Error("Input Lab push requires exactly three previews.");
  if (onProgress !== null && typeof onProgress !== "function") throw new Error("Input Lab progress must be a function.");
  const modes = slots.map((slot) => slot.mode ?? "auto");
  for (let index = 0; index < modes.length; index += 1) {
    if (!["auto", "semantic", "raster"].includes(modes[index])) {
      throw new Error(`Unsupported Input Lab mode: ${slots[index].mode}`);
    }
  }
  if (modes.filter((mode) => mode === "raster").length > 1) {
    throw bundleOversize(`Input Lab live F1WB permits at most one raster slot within ${
      WIDGET_SCENE_RPC_LIMITS.maxBundleBytes} bytes.`);
  }
  const compiledSlots = [];
  const widgetSlots = [];
  let rasterSlots = 0;
  onProgress?.(Object.freeze({ stage: "compiling-slots", current: 0, total: slots.length }));
  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index];
    const mode = modes[index];
    let compiled = null;
    if (mode !== "raster") {
      try {
        compiled = await compileInputLabScene(slot, { atlasFactory, allowTestAtlas });
      } catch (error) {
        if (mode !== "auto" || !isSemanticUnsupported(error)) throw error;
      }
    }
    if (mode === "raster" || compiled === null) {
      if (rasterSlots >= 1) {
        throw bundleOversize(`Input Lab live F1WB permits at most one raster slot within ${
          WIDGET_SCENE_RPC_LIMITS.maxBundleBytes} bytes.`);
      }
      if (!captureProvider || typeof captureProvider.capture !== "function") {
        throw new Error("Raster preview requires an explicitly configured Chromium capture provider.");
      }
      rasterSlots += 1;
      const captured = await captureProvider.capture(slot);
      compiledSlots.push(Object.freeze({ mode: "raster", requestedMode: mode,
        autoFallback: mode === "auto", ...captured }));
      widgetSlots.push({ kind: "raster", name: fitSlotName(slot.name, index),
        animationBinary: captured.animation.binary });
    } else {
      compiledSlots.push(Object.freeze({ mode: "semantic", requestedMode: mode,
        autoFallback: false, ...compiled }));
      widgetSlots.push({ kind: "semantic", name: fitSlotName(slot.name, index), sceneBinary: compiled.binary,
        atlas: compiled.atlas, ...(allowTestAtlas ? { allowTestAtlas: true } : {}) });
    }
    onProgress?.(Object.freeze({ stage: "compiling-slots", current: index + 1, total: slots.length }));
  }
  onProgress?.(Object.freeze({ stage: "encoding-bundle" }));
  const bundle = encodeWidgetBundle({ slots: widgetSlots, activeSlot, generation });
  if (bundle.binary.length > WIDGET_SCENE_RPC_LIMITS.maxBundleBytes) {
    throw bundleOversize(`F1WB bundle is ${bundle.binary.length} bytes; Input Lab live cap is ${
      WIDGET_SCENE_RPC_LIMITS.maxBundleBytes}.`);
  }
  return Object.freeze({ compiledSlots, bundle });
}
