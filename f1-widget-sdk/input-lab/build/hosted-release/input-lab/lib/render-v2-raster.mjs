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

export const INPUT_LAB_RENDER_V2_RASTER_MUTATION_ISOLATION = Object.freeze({
  format: "framer-render-v2-raster-mutation-isolation-v1",
  authoredMutations: Object.freeze(["textContent", "style.color"]),
  verificationModels: Object.freeze([
    "exhaustive-cartesian-fresh-render",
    "structural-isolation-plus-fresh-render-samples",
  ]),
  rejectedCssFeatures: Object.freeze([
    "attribute-selectors",
    ":has()",
    ":empty",
    ":blank",
    ":dir()",
    "attr()",
    "container-queries",
    "style-queries",
    "cross-element-value-functions",
    "mix-blend-mode",
    "backdrop-filter",
    "escaped-css-identifiers",
  ]),
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
    ["renderSource", "chromium-rgb565"],
    ["mutationIsolation", INPUT_LAB_RENDER_V2_RASTER_MUTATION_ISOLATION.format]].forEach(([name, value]) =>
    digest.update(name).update("\0").update(value).update("\0"));
  return digest.digest("hex");
}

function mutationDependencyError(feature) {
  fail("RENDER_V2_RASTER_MUTATION_DEPENDENCY",
    `Chromium Render v2 cannot prove absolute patch composability with ${feature}. ` +
    "Dynamic targets may change only isolated textContent or color paint.");
}

/*
 * Return only CSS control tokens: comments and quoted strings are replaced by
 * spaces so inert text cannot resemble a selector. Escapes outside strings are
 * rejected instead of decoded; otherwise a forbidden selector/function could
 * be hidden behind CSS identifier escapes.
 */
function mutationControlCss(css) {
  let output = "";
  for (let index = 0; index < css.length;) {
    if (css[index] === "/" && css[index + 1] === "*") {
      const end = css.indexOf("*/", index + 2);
      invariant(end >= 0, "Raster CSS contains an unterminated comment.",
        "RENDER_V2_RASTER_MUTATION_DEPENDENCY");
      output += " ".repeat(end + 2 - index);
      index = end + 2;
      continue;
    }
    if (css[index] === "\"" || css[index] === "'") {
      const quote = css[index];
      output += " ";
      index += 1;
      let closed = false;
      while (index < css.length) {
        if (css[index] === "\\") {
          output += " ";
          index += 1;
          if (index < css.length) { output += " "; index += 1; }
          continue;
        }
        output += " ";
        if (css[index] === quote) { index += 1; closed = true; break; }
        index += 1;
      }
      invariant(closed, "Raster CSS contains an unterminated string.",
        "RENDER_V2_RASTER_MUTATION_DEPENDENCY");
      continue;
    }
    if (css[index] === "\\") mutationDependencyError("escaped CSS identifiers");
    output += css[index];
    index += 1;
  }
  return output.toLowerCase();
}

function assertMutationIsolatedCss(css) {
  const control = mutationControlCss(css);
  // style.color changes the serialized style attribute. Attribute selectors,
  // attr(), and relational selectors can therefore make a second target react
  // only to an unsampled state combination.
  if (/[\[\]]/u.test(control)) mutationDependencyError("CSS attribute selectors");
  if (/:has\s*\(/u.test(control)) mutationDependencyError(":has()");
  if (/:(?:empty|blank)(?![-\w])/u.test(control)) mutationDependencyError(":empty/:blank");
  if (/:dir\s*\(/u.test(control)) mutationDependencyError(":dir()");
  if (/(?:^|[^-\w])attr\s*\(/u.test(control)) mutationDependencyError("attr()");
  // Container/style queries can make multiple otherwise stable text changes
  // cross a layout or paint threshold only in combination.
  if (/@container(?![-\w])/u.test(control)) mutationDependencyError("container queries");
  if (/(?:^|[^-\w])style\s*\(/u.test(control)) mutationDependencyError("style queries");
  if (/(?:^|[^-\w])(?:target-text|target-counter|target-counters|element)\s*\(/u.test(control)) {
    mutationDependencyError("cross-element CSS value functions");
  }
  // These compositing modes explicitly make one target's output depend on
  // pixels painted by another target, defeating disjoint individual dirties.
  if (/(?:^|[;{])\s*mix-blend-mode\s*:/u.test(control)) mutationDependencyError("mix-blend-mode");
  if (/(?:^|[;{])\s*(?:-webkit-)?backdrop-filter\s*:/u.test(control)) {
    mutationDependencyError("backdrop-filter");
  }
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
  assertMutationIsolatedCss(css);
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
  return { name: binding.name, targetId: binding.targetId,
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
  const initial = descriptors.map(({ initial: value }) => value);
  const product = descriptors.reduce((value, descriptor) => value * descriptor.variants.length, 1);
  const exhaustiveCartesian = product + 2 <= INPUT_LAB_RENDER_V2_RASTER_LIMITS.maxCases;
  const cases = [{ name: "base", mutations: [] }, { name: "base-repeat", mutations: [] }];
  const stateName = (selection) => `state:${selection.join(":")}`;
  const selectionsFor = (selection) => selection.map((variant, binding) => [binding, variant]);
  let cartesianSelections = [];
  const visit = (binding, selection) => {
    if (binding === descriptors.length) {
      const frozen = Object.freeze([...selection]);
      cartesianSelections.push(frozen);
      cases.push({ name: stateName(frozen), mutations: mutationsForSelections(descriptors, selectionsFor(frozen)) });
      return;
    }
    for (let variant = 0; variant < descriptors[binding].variants.length; variant += 1) {
      selection.push(variant); visit(binding + 1, selection); selection.pop();
    }
  };
  if (exhaustiveCartesian) visit(0, []);
  else descriptors.forEach((descriptor, bindingIndex) => descriptor.variants.forEach((_variant, variantIndex) => {
    cases.push({ name: `variant:${bindingIndex}:${variantIndex}`,
      mutations: mutationsForSelections(descriptors, [[bindingIndex, variantIndex]]) });
  }));
  cartesianSelections = Object.freeze(cartesianSelections);
  const variantCases = Object.freeze(descriptors.map((descriptor, bindingIndex) =>
    Object.freeze(descriptor.variants.map((_variant, variantIndex) => exhaustiveCartesian
      ? stateName(initial.map((value, index) => index === bindingIndex ? variantIndex : value))
      : `variant:${bindingIndex}:${variantIndex}`))));
  const alternate = descriptors.map(({ initial, variants }) => (initial + 1) % variants.length);
  const pairCases = new Map();
  for (let left = 0; left < descriptors.length; left += 1) for (let right = left + 1;
    right < descriptors.length; right += 1) {
    const name = exhaustiveCartesian
      ? stateName(initial.map((value, index) => index === left || index === right ? alternate[index] : value))
      : `pair:${left}:${right}`;
    pairCases.set(`${left}:${right}`, name);
    if (!exhaustiveCartesian) cases.push({ name, mutations: mutationsForSelections(descriptors,
      [[left, alternate[left]], [right, alternate[right]]]) });
  }
  const combinedCase = descriptors.length > 1
    ? exhaustiveCartesian ? stateName(alternate) : "combined"
    : null;
  if (descriptors.length > 1 && !exhaustiveCartesian) cases.push({ name: combinedCase,
    mutations: mutationsForSelections(descriptors, alternate.map((variant, binding) => [binding, variant])) });
  invariant(cases.length <= INPUT_LAB_RENDER_V2_RASTER_LIMITS.maxCases,
    `Chromium Render v2 parity plan needs ${cases.length} cases; maximum is ${INPUT_LAB_RENDER_V2_RASTER_LIMITS.maxCases}.`,
    "RENDER_V2_RASTER_BUDGET_EXCEEDED");
  return Object.freeze({ cases: Object.freeze(cases.map((entry) => Object.freeze(entry))),
    alternate: Object.freeze(alternate), initial: Object.freeze(initial), variantCases,
    pairCases, combinedCase, exhaustiveCartesian, cartesianStates: product, cartesianSelections });
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

function derivePatches(prepared, captures, plan) {
  const base = captures.get("base").frame;
  const bindingPatches = Object.create(null);
  const dirty = [];
  prepared.logicalBindings.forEach((binding, bindingIndex) => {
    const frames = binding.variants.map((_variant, variantIndex) =>
      captures.get(plan.variantCases[bindingIndex][variantIndex]).frame);
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

function containmentIncludes(value, keyword) {
  const text = String(value ?? "").trim().toLowerCase();
  return text === "strict" || text.split(/\s+/u).includes(keyword);
}

function structuralIsolationProof(descriptors, base, patches, captures) {
  invariant(base.targetStyles && typeof base.targetStyles === "object" && !Array.isArray(base.targetStyles),
    "Large Render v2 state spaces require computed target isolation evidence from Chromium.",
    "RENDER_V2_RASTER_ISOLATION_REQUIRED");
  for (const capture of captures) invariant(
    JSON.stringify(capture.targetStyles) === JSON.stringify(base.targetStyles),
    `Raster case ${capture.name} changes a dynamic target's structural computed style.`,
    "RENDER_V2_RASTER_ISOLATION_REQUIRED");
  const targetIds = [...new Set(descriptors.map(({ targetId }) => targetId))];
  invariant(Object.keys(base.targetStyles).sort().join("\0") === [...targetIds].sort().join("\0"),
    "Chromium target-isolation evidence does not match the dynamic target set.",
    "RENDER_V2_RASTER_ISOLATION_REQUIRED");
  const allowedDisplays = new Set(["block", "inline-block", "flow-root", "flex", "inline-flex", "grid", "inline-grid"]);
  const bounds = new Map();
  for (const targetId of targetIds) {
    const style = base.targetStyles[targetId];
    invariant(style && typeof style === "object" && Array.isArray(style.rect) && style.rect.length === 4,
      `Dynamic target #${targetId} lacks computed isolation evidence.`,
      "RENDER_V2_RASTER_ISOLATION_REQUIRED");
    invariant(style.namespaceURI === "http://www.w3.org/1999/xhtml",
      `Dynamic target #${targetId} must be an HTML element for structural isolation.`,
      "RENDER_V2_RASTER_ISOLATION_REQUIRED");
    const [x, y, width, height] = style.rect.map(Number);
    invariant([x, y, width, height].every(Number.isFinite) && width > 0 && height > 0 &&
      x >= 0 && y >= 0 && x + width <= 100 && y + height <= 310,
    `Dynamic target #${targetId} must have one positive fixed box fully inside 100x310.`,
    "RENDER_V2_RASTER_ISOLATION_REQUIRED");
    invariant(containmentIncludes(style.contain, "size") && containmentIncludes(style.contain, "layout") &&
      containmentIncludes(style.contain, "paint"),
    `Dynamic target #${targetId} must declare contain:size layout paint (or contain:strict) for a non-exhaustive state space.`,
    "RENDER_V2_RASTER_ISOLATION_REQUIRED");
    invariant(allowedDisplays.has(style.display),
      `Dynamic target #${targetId} display ${style.display} cannot provide size/layout/paint isolation.`,
      "RENDER_V2_RASTER_ISOLATION_REQUIRED");
    invariant(style.overflowClipMargin === "0px",
      `Dynamic target #${targetId} must keep the paint-containment clip at its fixed box.`,
      "RENDER_V2_RASTER_ISOLATION_REQUIRED");
    invariant(Array.isArray(style.ancestorEffects) && style.ancestorEffects.every((effect) =>
      effect && effect.filter === "none" && effect.backdropFilter === "none" &&
      effect.mixBlendMode === "normal"),
    `Dynamic target #${targetId} cannot use a filtered or blended ancestor in the structural-isolation model.`,
    "RENDER_V2_RASTER_ISOLATION_REQUIRED");
    bounds.set(targetId, Object.freeze({ x, y, width, height }));
  }
  for (let left = 0; left < targetIds.length; left += 1) for (let right = left + 1;
    right < targetIds.length; right += 1) {
    const a = bounds.get(targetIds[left]); const b = bounds.get(targetIds[right]);
    const overlap = a.x < b.x + b.width && b.x < a.x + a.width &&
      a.y < b.y + b.height && b.y < a.y + a.height;
    invariant(!overlap,
      `Isolated dynamic target boxes #${targetIds[left]} and #${targetIds[right]} overlap.`,
      "RENDER_V2_RASTER_ISOLATION_REQUIRED");
  }
  for (const descriptor of descriptors) {
    const bound = bounds.get(descriptor.targetId);
    const dirty = patches.dirty.find(({ name }) => name === descriptor.name);
    invariant(dirty, `Raster binding ${descriptor.name} has no dirty-region proof.`,
      "RENDER_V2_RASTER_ISOLATION_REQUIRED");
    const minimumX = Math.floor(bound.x); const maximumX = Math.ceil(bound.x + bound.width);
    const minimumY = Math.floor(bound.y); const maximumY = Math.ceil(bound.y + bound.height);
    invariant(dirty.pixels.every((pixel) => {
      const x = pixel % 100; const y = Math.floor(pixel / 100);
      return x >= minimumX && x < maximumX && y >= minimumY && y < maximumY;
    }), `Raster binding ${descriptor.name} paints outside isolated target #${descriptor.targetId}.`,
    "RENDER_V2_RASTER_ISOLATION_REQUIRED");
  }
  for (const targetId of targetIds) {
    const targetBindings = descriptors.filter((descriptor) => descriptor.targetId === targetId);
    if (targetBindings.length <= 1) continue;
    const style = base.targetStyles[targetId];
    invariant(targetBindings.every(({ position }) => Number.isInteger(position)) &&
      style.fontKerning === "none" && style.fontVariantLigatures === "none" &&
      String(style.fontVariantNumeric).split(/\s+/u).includes("tabular-nums") &&
      style.direction === "ltr" && style.unicodeBidi === "normal" && style.writingMode === "horizontal-tb" &&
      style.filter === "none" && style.textShadow === "none",
    `Multi-binding text target #${targetId} must use unfiltered formatTime cells with tabular numbers, ` +
      "no kerning/ligatures/text shadow, and normal horizontal LTR text.",
    "RENDER_V2_RASTER_ISOLATION_REQUIRED");
  }
  return Object.freeze({ format: "framer-render-v2-raster-structural-isolation-v1",
    targetBoxes: targetIds.length, fixedTargetBoxes: true, htmlTargets: true,
    sizeContainment: true, layoutContainment: true, paintContainment: true,
    zeroOverflowClipMargin: true, safeAncestorEffects: true, disjointTargetBoxes: true,
    disjointBindingPatches: true, patchPixelsInsideTargetBoxes: true });
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
    const selected = captures.get(plan.variantCases[bindingIndex][descriptor.initial]);
    invariant(framesEqual(base.frame, selected.frame),
      `Raster binding ${descriptor.name} selected initial variant does not equal the unmodified base.`,
      "RENDER_V2_RASTER_INITIAL_MISMATCH");
    descriptor.variants.forEach((_variant, variantIndex) => parityError(
      `${descriptor.name}/${variantIndex}`,
      patchedFrame(base.frame, prepared, patches.bindingPatches, [[bindingIndex, variantIndex]]),
      captures.get(plan.variantCases[bindingIndex][variantIndex]).frame));
  });
  for (let left = 0; left < descriptors.length; left += 1) for (let right = left + 1;
    right < descriptors.length; right += 1) {
    const selections = [[left, plan.alternate[left]], [right, plan.alternate[right]]];
    parityError(`pair ${descriptors[left].name}+${descriptors[right].name}`,
      patchedFrame(base.frame, prepared, patches.bindingPatches, selections),
      captures.get(plan.pairCases.get(`${left}:${right}`)).frame);
  }
  if (descriptors.length > 1) {
    const selections = plan.alternate.map((variant, binding) => [binding, variant]);
    parityError("combined-state", patchedFrame(base.frame, prepared, patches.bindingPatches, selections),
      captures.get(plan.combinedCase).frame);
  }
  if (plan.exhaustiveCartesian) {
    for (const selection of plan.cartesianSelections) parityError(`Cartesian state ${selection.join(",")}`,
      patchedFrame(base.frame, prepared, patches.bindingPatches,
        selection.map((variant, binding) => [binding, variant])),
      captures.get(`state:${selection.join(":")}`).frame);
  }
  const structuralIsolation = plan.exhaustiveCartesian ? null :
    structuralIsolationProof(descriptors, base, patches, captureResult.cases);
  return Object.freeze({ format: "framer-render-v2-raster-proof-v1", chromeProduct: captureResult.browser.product,
    verificationModel: plan.exhaustiveCartesian ? "exhaustive-cartesian-fresh-render" :
      "structural-isolation-plus-fresh-render-samples",
    mutationIsolation: INPUT_LAB_RENDER_V2_RASTER_MUTATION_ISOLATION,
    sampleCoverage: Object.freeze({ individualVariants: "all",
      pairwiseStates: "one deterministic alternate per binding pair",
      combinedStates: "one deterministic all-bindings alternate",
      exhaustiveCartesian: plan.exhaustiveCartesian, cartesianStates: plan.cartesianStates }),
    structuralIsolation,
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
  const patches = derivePatches(prepared, captures, plan);
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
