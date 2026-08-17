import { createHash } from "node:crypto";

import { buildGlyphAtlas } from "../../src/render/index.mjs";
import { buildRenderV2Package, linkRenderV2Raster, parseRenderV2Script, prepareRenderV2,
  RENDER_V2_ABI_LIMITS } from "../../src/render-v2/index.mjs";
import { RENDER_V2_CHROMIUM_CAPTURE_LIMITS, sanitizeRasterDocument } from
  "./chromium-raster-capture.mjs";

export const INPUT_LAB_RENDER_V2_RASTER_LIMITS = Object.freeze({
  maxBindings: 8,
  maxVariants: 64,
  maxCases: RENDER_V2_CHROMIUM_CAPTURE_LIMITS.maxCases,
  maxTargetScalars: 16,
});

function fail(code, message, diagnostics = []) {
  throw Object.assign(new Error(message), { code,
    diagnostics: Object.freeze(diagnostics.map((diagnostic) => Object.freeze({ ...diagnostic }))) });
}

function invariant(value, message, code = "RENDER_V2_RASTER_UNSUPPORTED") {
  if (!value) fail(code, message);
}

function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function positiveModulo(value, modulus) { return ((value % modulus) + modulus) % modulus; }
function scalars(value) { return Array.from(value); }
function escapedExpression(value) { return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"); }

function sourceDigest({ html, css, script, rootClass }) {
  const digest = createHash("sha256");
  [["html", html], ["css", css], ["script", script], ["rootClass", rootClass],
    ["renderSource", "chromium-rgb565"]].forEach(([name, value]) =>
    digest.update(name).update("\0").update(value).update("\0"));
  return digest.digest("hex");
}

function extractLiteralTarget(html, id) {
  const escaped = escapedExpression(id);
  const idOccurrences = [...html.matchAll(new RegExp(`\\bid\\s*=\\s*["']${escaped}["']`, "giu"))];
  invariant(idOccurrences.length === 1, `Dynamic target #${id} must occur exactly once in HTML.`,
    "RENDER_V2_RASTER_TARGET_INVALID");
  const expression = new RegExp(`<([a-z][\\w:-]*)\\b(?=[^>]*\\bid\\s*=\\s*["']${escaped}["'])[^>]*>` +
    `([^<]*)<\\/\\1\\s*>`, "giu");
  const matches = [...html.matchAll(expression)];
  invariant(matches.length === 1,
    `Dynamic target #${id} must contain literal text only; nested markup would be destroyed by textContent.`,
    "RENDER_V2_RASTER_TARGET_INVALID");
  const text = matches[0][2];
  invariant(text.trim() === text && !/[&<>\u0000-\u001f\u007f]/u.test(text),
    `Dynamic target #${id} must use bounded literal text without entities or control characters.`,
    "RENDER_V2_RASTER_TARGET_INVALID");
  invariant(scalars(text).length >= 1 && scalars(text).length <= INPUT_LAB_RENDER_V2_RASTER_LIMITS.maxTargetScalars,
    `Dynamic target #${id} must contain 1..${INPUT_LAB_RENDER_V2_RASTER_LIMITS.maxTargetScalars} scalars.`,
    "RENDER_V2_RASTER_TARGET_INVALID");
  return Object.freeze({ id, text });
}

function actionGroups(scriptModel) {
  const groups = new Map();
  for (const handler of scriptModel.handlers) for (const action of handler.actions) {
    const key = `${action.targetId}\0${action.stateName}`;
    const group = groups.get(key) ?? { targetId: action.targetId, stateName: action.stateName,
      stateIndex: action.stateIndex };
    const previous = group[action.kind];
    const current = action.kind === "format-time" ? true : [...action.variants];
    invariant(previous === undefined || JSON.stringify(previous) === JSON.stringify(current),
      `Dynamic target #${action.targetId} repeats ${action.kind} with different variants.`);
    group[action.kind] = current;
    groups.set(key, group);
  }
  return groups;
}

function targetModels(html, scriptModel) {
  const ids = [];
  for (const handler of scriptModel.handlers) for (const action of handler.actions) {
    if (!ids.includes(action.targetId)) ids.push(action.targetId);
  }
  const models = ids.map((id) => {
    const target = extractLiteralTarget(html, id);
    const actions = scriptModel.handlers.flatMap(({ actions: entries }) => entries)
      .filter(({ targetId }) => targetId === id);
    const universe = new Set(scalars(target.text));
    for (const action of actions) {
      if (action.kind === "format-time") [..."0123456789:"].forEach((glyph) => universe.add(glyph));
      if (action.kind === "pick-text") action.variants.flatMap(scalars).forEach((glyph) => universe.add(glyph));
    }
    invariant([...universe].every((glyph) => !/["&<>]/u.test(glyph)),
      `Dynamic target #${id} uses a glyph that cannot be represented by the bounded raster scaffold.`,
      "RENDER_V2_RASTER_TARGET_INVALID");
    const colorAction = actions.find(({ kind }) => kind === "pick-color");
    let initialColor = "#fff";
    if (colorAction) {
      const initial = scriptModel.states[colorAction.stateIndex].initial;
      initialColor = colorAction.variants[positiveModulo(initial, colorAction.variants.length)];
    }
    return Object.freeze({ ...target, universe: Object.freeze([...universe]), initialColor });
  });
  return Object.freeze(models);
}

function scaffoldFor(targets, rootClass) {
  let cell = 0;
  const nthRules = [];
  const spans = targets.map((target) => {
    for (let index = 0; index < scalars(target.text).length; index += 1) {
      nthRules.push(`.${rootClass} > span:nth-child(${cell + index + 1}){color:${target.initialColor}}`);
    }
    cell += scalars(target.text).length;
    return `<span id="${target.id}" data-glyphs="${target.universe.join("")}">${target.text}</span>`;
  });
  const css = `.${rootClass}{width:100%;height:100%;overflow:hidden;display:grid;` +
    `grid-template-columns:repeat(5,20px);grid-auto-rows:20px;min-width:100px;min-height:310px;` +
    `background-color:#000;color:#fff;font-size:12px;font-family:monospace;justify-content:center;align-content:center}` +
    `.${rootClass} > span{color:#fff;text-align:center;line-height:1}${nthRules.join("")}`;
  return Object.freeze({ html: `<div class="${rootClass}">${spans.join("")}</div>`, css });
}

function trimUnreachableRasterVariants(prepared) {
  const logicalBindings = prepared.logicalBindings.map((binding) => Object.freeze({ ...binding,
    variants: Object.freeze(binding.variants.slice(0, binding.modulo).map((variant) => Object.freeze({ ...variant,
      glyphs: Object.freeze([...variant.glyphs]) }))) }));
  return Object.freeze({ ...prepared, logicalBindings: Object.freeze(logicalBindings) });
}

function prepareRasterSource({ html, css, script, rootClass }) {
  sanitizeRasterDocument({ html, css, interaction: "none" });
  invariant(typeof rootClass === "string" && /^[a-z_][\w-]*$/iu.test(rootClass),
    "Render v2 raster rootClass must be one CSS class identifier.");
  const root = new RegExp(`class\\s*=\\s*["'][^"']*\\b${escapedExpression(rootClass)}\\b[^"']*["']`, "iu");
  invariant(root.test(html), `Raster HTML must contain a .${rootClass} root element.`,
    "RENDER_V2_RASTER_TARGET_INVALID");
  const scriptModel = parseRenderV2Script(script);
  const targets = targetModels(html, scriptModel);
  const scaffold = scaffoldFor(targets, rootClass);
  const prepared = trimUnreachableRasterVariants(prepareRenderV2({ html: scaffold.html,
    css: scaffold.css, script, rootClass }));
  invariant(prepared.logicalBindings.length <= INPUT_LAB_RENDER_V2_RASTER_LIMITS.maxBindings,
    `Chromium Render v2 supports at most ${INPUT_LAB_RENDER_V2_RASTER_LIMITS.maxBindings} composable bindings.`,
    "RENDER_V2_RASTER_BUDGET_EXCEEDED");
  const variants = prepared.logicalBindings.reduce((sum, binding) => sum + binding.variants.length, 0);
  invariant(variants <= INPUT_LAB_RENDER_V2_RASTER_LIMITS.maxVariants,
    `Chromium Render v2 declares ${variants} variants; maximum is ${INPUT_LAB_RENDER_V2_RASTER_LIMITS.maxVariants}.`,
    "RENDER_V2_RASTER_BUDGET_EXCEEDED");
  return Object.freeze({ prepared, targets, groups: actionGroups(scriptModel) });
}

function descriptorForBinding(binding, groups) {
  const group = groups.get(`${binding.targetId}\0${binding.stateName}`);
  invariant(group, `Raster binding ${binding.name} has no parsed DOM action.`);
  if (group["format-time"]) {
    const suffix = binding.name.slice(`${binding.targetId}_`.length);
    const position = Number(suffix);
    invariant(Number.isInteger(position) && position >= 0 && position < 8,
      `Raster formatTime binding ${binding.name} has no character position.`);
    return { name: binding.name, targetId: binding.targetId, position,
      variants: binding.variants.map(({ glyphs }) => ({ glyph: glyphs[0] })) };
  }
  return { name: binding.name, targetId: binding.targetId, initial,
    variants: binding.variants.map((_variant, index) => ({
      ...(group["pick-text"] ? { textContent: group["pick-text"][index] } : {}),
      ...(group["pick-color"] ? { color: group["pick-color"][index] } : {}),
    })) };
}

function descriptorsFor(prepared, groups, targets) {
  const stateInitial = new Map(prepared.script.states.map(({ name, initial }) => [name, initial]));
  return Object.freeze(prepared.logicalBindings.map((binding) => {
    const descriptor = descriptorForBinding(binding, groups);
    const initial = positiveModulo(Math.trunc(stateInitial.get(binding.stateName) / binding.divisor), binding.modulo);
    return Object.freeze({ ...descriptor, initial,
      variants: Object.freeze(descriptor.variants.map((variant) => Object.freeze(variant))),
      baseText: targets.find(({ id }) => id === binding.targetId).text });
  }));
}

function mutationsForSelections(descriptors, selections) {
  const byTarget = new Map();
  for (const [bindingIndex, variantIndex] of selections) {
    const descriptor = descriptors[bindingIndex];
    const variant = descriptor.variants[variantIndex];
    invariant(variant, `Raster case selects missing ${descriptor.name} variant ${variantIndex}.`);
    const change = byTarget.get(descriptor.targetId) ?? { targetId: descriptor.targetId,
      baseText: descriptor.baseText, characters: null };
    if (descriptor.position !== undefined) {
      invariant(!Object.hasOwn(change, "textContent"),
        `Raster target #${descriptor.targetId} mixes whole-text and character bindings.`);
      change.characters ??= scalars(change.baseText);
      change.characters[descriptor.position] = variant.glyph;
    }
    if (Object.hasOwn(variant, "textContent")) {
      invariant(change.characters === null,
        `Raster target #${descriptor.targetId} mixes whole-text and character bindings.`);
      change.textContent = variant.textContent;
    }
    if (Object.hasOwn(variant, "color")) change.color = variant.color;
    byTarget.set(descriptor.targetId, change);
  }
  return Object.freeze([...byTarget.values()].map((change) => Object.freeze({ targetId: change.targetId,
    ...(change.characters ? { textContent: change.characters.join("") } :
      Object.hasOwn(change, "textContent") ? { textContent: change.textContent } : {}),
    ...(Object.hasOwn(change, "color") ? { color: change.color } : {}),
  })));
}

function capturePlan(descriptors) {
  const cases = [{ name: "base", mutations: [] }, { name: "base-repeat", mutations: [] }];
  descriptors.forEach((descriptor, bindingIndex) => descriptor.variants.forEach((_variant, variantIndex) => {
    cases.push({ name: `variant:${bindingIndex}:${variantIndex}`,
      mutations: mutationsForSelections(descriptors, [[bindingIndex, variantIndex]]) });
  }));
  const alternate = descriptors.map(({ initial, variants }) => (initial + 1) % variants.length);
  for (let left = 0; left < descriptors.length; left += 1) for (let right = left + 1;
    right < descriptors.length; right += 1) {
    cases.push({ name: `pair:${left}:${right}`, mutations: mutationsForSelections(descriptors,
      [[left, alternate[left]], [right, alternate[right]]]) });
  }
  if (descriptors.length > 1) cases.push({ name: "combined",
    mutations: mutationsForSelections(descriptors, alternate.map((variant, binding) => [binding, variant])) });
  invariant(cases.length <= INPUT_LAB_RENDER_V2_RASTER_LIMITS.maxCases,
    `Chromium Render v2 parity plan needs ${cases.length} cases; maximum is ${INPUT_LAB_RENDER_V2_RASTER_LIMITS.maxCases}.`,
    "RENDER_V2_RASTER_BUDGET_EXCEEDED");
  return Object.freeze({ cases: Object.freeze(cases.map((entry) => Object.freeze(entry))), alternate });
}

function framesEqual(left, right) { return Buffer.from(left).equals(Buffer.from(right)); }

function changedPixels(base, value) {
  const indices = [];
  for (let pixel = 0; pixel < 31_000; pixel += 1) {
    if (base.readUInt16LE(pixel * 2) !== value.readUInt16LE(pixel * 2)) indices.push(pixel);
  }
  return indices;
}

function contiguousSpans(indices) {
  const rows = new Map();
  for (const pixel of indices) {
    const row = Math.floor(pixel / 100);
    const x = pixel % 100;
    const bounds = rows.get(row) ?? { minimum: x, maximum: x };
    bounds.minimum = Math.min(bounds.minimum, x);
    bounds.maximum = Math.max(bounds.maximum, x);
    rows.set(row, bounds);
  }
  return [...rows].sort(([left], [right]) => left - right).map(([row, { minimum, maximum }]) =>
    ({ start: row * 100 + minimum, count: maximum - minimum + 1 }));
}

function derivePatches(prepared, captures) {
  const base = captures.get("base").frame;
  const bindingPatches = Object.create(null);
  const dirty = [];
  prepared.logicalBindings.forEach((binding, bindingIndex) => {
    const frames = binding.variants.map((_variant, variantIndex) => captures.get(`variant:${bindingIndex}:${variantIndex}`).frame);
    const union = new Set(frames.flatMap((frame) => changedPixels(base, frame)));
    invariant(union.size > 0, `Raster binding ${binding.name} has no visible RGB565 effect.`,
      "RENDER_V2_RASTER_NO_VISIBLE_EFFECT");
    const indices = [...union].sort((left, right) => left - right);
    const spans = contiguousSpans(indices);
    const coveredPixels = new Set(spans.flatMap(({ start, count }) =>
      Array.from({ length: count }, (_, offset) => start + offset)));
    const originPixel = spans[0].start;
    bindingPatches[binding.name] = Object.freeze({ originPixel,
      variants: Object.freeze(frames.map((frame) => Object.freeze(spans.map(({ start, count }) => Object.freeze({
        pixelOffset: start - originPixel,
        colors: Object.freeze(Array.from({ length: count }, (_, offset) => frame.readUInt16LE((start + offset) * 2))),
      }))))), divisor: binding.divisor, modulo: binding.modulo });
    dirty.push({ name: binding.name, pixels: coveredPixels });
  });
  for (let left = 0; left < dirty.length; left += 1) for (let right = left + 1; right < dirty.length; right += 1) {
    const overlap = [...dirty[left].pixels].find((pixel) => dirty[right].pixels.has(pixel));
    invariant(overlap === undefined,
      `Raster bindings ${dirty[left].name} and ${dirty[right].name} overlap at pixel ${overlap}; absolute patches are not composable.`,
      "RENDER_V2_RASTER_BINDING_OVERLAP");
  }
  // F2EP interns byte-identical patch sets at link time (for example, equal-width clock digits
  // over an x-invariant background). Enforce the ABI budget against that canonical payload,
  // not against duplicate authoring bindings that do not consume additional program records.
  const uniquePatchSets = new Map();
  for (const patch of Object.values(bindingPatches)) {
    const key = sha256(JSON.stringify(patch.variants));
    if (!uniquePatchSets.has(key)) uniquePatchSets.set(key, patch.variants);
  }
  const variants = [...uniquePatchSets.values()].flat();
  const spans = variants.flat();
  const pixelBytes = spans.reduce((sum, span) => sum + span.colors.length * 2, 0);
  invariant(spans.length <= RENDER_V2_ABI_LIMITS.maxPatchSpans,
    `Raster patch plan needs ${spans.length} spans; ABI maximum is ${RENDER_V2_ABI_LIMITS.maxPatchSpans}.`,
    "RENDER_V2_RASTER_BUDGET_EXCEEDED");
  invariant(pixelBytes <= RENDER_V2_ABI_LIMITS.maxPatchBytes,
    `Raster patch plan needs ${pixelBytes} pixel bytes; ABI maximum is ${RENDER_V2_ABI_LIMITS.maxPatchBytes}.`,
    "RENDER_V2_RASTER_BUDGET_EXCEEDED");
  return Object.freeze({ baseFrame: Buffer.from(base), bindingPatches: Object.freeze(bindingPatches),
    dirty: Object.freeze(dirty.map(({ name, pixels }) => Object.freeze({ name, pixels: Object.freeze([...pixels]) }))) });
}

function patchedFrame(base, prepared, bindingPatches, selections) {
  const frame = Buffer.from(base);
  for (const [bindingIndex, variantIndex] of selections) {
    const binding = prepared.logicalBindings[bindingIndex];
    const patch = bindingPatches[binding.name];
    for (const span of patch.variants[variantIndex]) span.colors.forEach((color, index) =>
      frame.writeUInt16LE(color, (patch.originPixel + span.pixelOffset + index) * 2));
  }
  return frame;
}

function parityError(label, predicted, captured) {
  for (let pixel = 0; pixel < 31_000; pixel += 1) if (
    predicted.readUInt16LE(pixel * 2) !== captured.readUInt16LE(pixel * 2)) {
    fail("RENDER_V2_RASTER_PARITY_FAILED",
      `Raster ${label} fresh-render parity failed at pixel ${pixel}.`);
  }
}

function verifyParity(prepared, descriptors, plan, captureResult, patches) {
  const captures = new Map(captureResult.cases.map((entry) => [entry.name, entry]));
  const base = captures.get("base");
  invariant(base && captures.get("base-repeat"), "Chromium Render v2 capture omitted its base controls.");
  invariant(JSON.stringify(base.layout) === JSON.stringify(captures.get("base-repeat").layout) &&
    framesEqual(base.frame, captures.get("base-repeat").frame),
  "Chromium Render v2 base is nondeterministic across fresh renders.", "RENDER_V2_RASTER_NONDETERMINISTIC");
  for (const captured of captureResult.cases) invariant(JSON.stringify(captured.layout) === JSON.stringify(base.layout),
    `Raster case ${captured.name} changes DOM geometry or scroll layout; reflow is unsupported.`,
    "RENDER_V2_RASTER_REFLOW");
  descriptors.forEach((descriptor, bindingIndex) => {
    const selected = captures.get(`variant:${bindingIndex}:${descriptor.initial}`);
    invariant(framesEqual(base.frame, selected.frame),
      `Raster binding ${descriptor.name} selected initial variant does not equal the unmodified base.`,
      "RENDER_V2_RASTER_INITIAL_MISMATCH");
    descriptor.variants.forEach((_variant, variantIndex) => parityError(
      `${descriptor.name}/${variantIndex}`,
      patchedFrame(base.frame, prepared, patches.bindingPatches, [[bindingIndex, variantIndex]]),
      captures.get(`variant:${bindingIndex}:${variantIndex}`).frame));
  });
  for (let left = 0; left < descriptors.length; left += 1) for (let right = left + 1;
    right < descriptors.length; right += 1) {
    const selections = [[left, plan.alternate[left]], [right, plan.alternate[right]]];
    parityError(`pair ${descriptors[left].name}+${descriptors[right].name}`,
      patchedFrame(base.frame, prepared, patches.bindingPatches, selections),
      captures.get(`pair:${left}:${right}`).frame);
  }
  if (descriptors.length > 1) {
    const selections = plan.alternate.map((variant, binding) => [binding, variant]);
    parityError("combined-state", patchedFrame(base.frame, prepared, patches.bindingPatches, selections),
      captures.get("combined").frame);
  }
  return Object.freeze({ format: "framer-render-v2-raster-proof-v1", chromeProduct: captureResult.browser.product,
    freshRenders: captureResult.cases.length, initialVariants: descriptors.length,
    individualVariants: descriptors.reduce((sum, descriptor) => sum + descriptor.variants.length, 0),
    pairwiseStates: descriptors.length * (descriptors.length - 1) / 2,
    combinedStates: descriptors.length > 1 ? 1 : 0,
    baseFrameSha256: sha256(base.frame), layoutSha256: sha256(JSON.stringify(base.layout)) });
}

function placeholderAtlas(glyphs) {
  return buildGlyphAtlas({ glyphs, width: 1, height: 1,
    source: Object.freeze({ kind: "chromium-raster-link-placeholder-v1", renderedOnDevice: false }),
    rasterizeGlyph() { return Buffer.alloc(1); } });
}

/** Compile rich, sanitized browser HTML/CSS into an exact base plus bounded absolute F2EP patches. */
export async function compileInputLabRenderV2Raster({ html, css, script, rootClass = "render-v2",
  name = "render-v2", generation = 1 } = {}, { captureProvider } = {}) {
  invariant(captureProvider && typeof captureProvider.captureRenderV2Variants === "function",
    "Chromium Render v2 requires a capture provider with captureRenderV2Variants().",
    "RENDER_V2_RASTER_CAPTURE_UNAVAILABLE");
  const { prepared, targets, groups } = prepareRasterSource({ html, css, script, rootClass });
  const descriptors = descriptorsFor(prepared, groups, targets);
  const plan = capturePlan(descriptors);
  const captureResult = await captureProvider.captureRenderV2Variants({ html, css,
    targets: targets.map(({ id }) => id), cases: plan.cases });
  invariant(captureResult?.format === "framer-render-v2-chromium-captures-v1" &&
    Array.isArray(captureResult.cases), "Chromium Render v2 capture result is invalid.",
  "RENDER_V2_RASTER_CAPTURE_INVALID");
  const captures = new Map(captureResult.cases.map((entry) => [entry.name, entry]));
  invariant(plan.cases.every(({ name: caseName }) => captures.has(caseName)) &&
    captures.size === plan.cases.length, "Chromium Render v2 capture cases are incomplete.",
  "RENDER_V2_RASTER_CAPTURE_INVALID");
  const patches = derivePatches(prepared, captures);
  const proof = verifyParity(prepared, descriptors, plan, captureResult, patches);
  const atlas = placeholderAtlas(prepared.scene.glyphs);
  const linked = linkRenderV2Raster(prepared, { atlas, baseFrame: patches.baseFrame,
    bindingPatches: patches.bindingPatches });
  const packageValue = buildRenderV2Package(linked, { name, generation });
  const digest = sourceDigest({ html, css, script, rootClass });
  const manifest = Object.freeze({ format: "framer-render-v2-compilation-v1", sha256: digest,
    source: Object.freeze({ sha256: digest, htmlBytes: Buffer.byteLength(html), cssBytes: Buffer.byteLength(css),
      scriptBytes: Buffer.byteLength(script), rootClass, renderMode: "raster" }),
    execution: packageValue.execution,
    scene: Object.freeze({ sha256: proof.baseFrameSha256, bytes: patches.baseFrame.length,
      glyphs: 0, atlasSha256: null, atlasBytes: 0, renderSource: "pinned-chromium-rgb565",
      browserProduct: proof.chromeProduct, proof }),
    program: packageValue.program,
    package: Object.freeze({ format: packageValue.format, bytes: packageValue.binary.length,
      sha256: packageValue.sha256 }), budget: packageValue.budget, compatibility: packageValue.compatibility });
  return Object.freeze({ format: manifest.format, sha256: digest, prepared, linked,
    package: packageValue, manifest, rasterProof: proof });
}
