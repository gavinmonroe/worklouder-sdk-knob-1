import { createHash } from "node:crypto";

import { compileCssWidget, encodeCssScene } from "../render/css-scene.mjs";
import { renderCssSceneRgb565 } from "../render/semantic-raster.mjs";
import { RENDER_V2_ABI_LIMITS, RENDER_V2_EVENT_KINDS, RENDER_V2_OPCODES,
  decodeRenderV2Event, encodeRenderV2Event, executeRenderV2Instructions } from "./abi.mjs";
import { parseRenderV2Script, RenderV2CompileError } from "./script.mjs";
import { compileRenderV2Program } from "./program.mjs";

function invariant(value, message) { if (!value) throw new RenderV2CompileError(message); }
function scalars(value) { return Array.from(value); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function deepFreeze(value) {
  if (!value || typeof value !== "object" || ArrayBuffer.isView(value) || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function parseAttributes(source) {
  const attributes = Object.create(null);
  let consumed = ""; let match;
  const expression = /([a-z][\w-]*)\s*=\s*"([^"]*)"/giu;
  while ((match = expression.exec(source))) {
    consumed += source.slice(consumed.length, match.index).replace(/\s+/gu, "");
    invariant(consumed === "", "Render v2 span contains malformed or unsupported attributes.");
    invariant(!Object.hasOwn(attributes, match[1]), `Duplicate HTML attribute ${match[1]}.`);
    attributes[match[1]] = match[2];
    source = source.slice(match.index + match[0].length);
    expression.lastIndex = 0; consumed = "";
  }
  invariant(!source.trim(), "Render v2 span contains malformed or unsupported attributes.");
  return attributes;
}

function parseHtmlRuns(html, rootClass) {
  invariant(typeof html === "string" && Buffer.byteLength(html) <= 16 * 1024,
    "Render v2 HTML exceeds 16 KiB.");
  invariant(!/<(?:script|iframe|object|embed|link|base)\b|\son[a-z]+\s*=|javascript:|https?:\/\//iu.test(html),
    "Render v2 HTML contains executable or external content.");
  invariant(/^[a-z_][\w-]*$/iu.test(rootClass), "rootClass must be one CSS class identifier.");
  const escaped = rootClass.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const root = new RegExp(`<div\\b([^>]*)class="[^"]*\\b${escaped}\\b[^"]*"([^>]*)>([\\s\\S]*?)<\\/div>`, "iu").exec(html);
  invariant(root, `HTML must contain one double-quoted .${rootClass} root div.`);
  const body = root[3];
  const runs = []; const ids = new Set(); let cursor = 0; let match;
  const spans = /<span\b([^>]*)>([^<]*)<\/span>/giu;
  while ((match = spans.exec(body))) {
    invariant(!body.slice(cursor, match.index).trim(), "Render v2 root permits direct text-only span children.");
    const attributes = parseAttributes(match[1]);
    for (const name of Object.keys(attributes)) invariant(name === "id" || name === "data-glyphs",
      `Unsupported Render v2 span attribute ${name}.`);
    invariant(!/[&<>]/u.test(match[2]), "Render v2 span text must use literal Unicode scalars without markup/entities.");
    const initial = scalars(match[2]);
    invariant(initial.length >= 1 && initial.length <= 16, "Each Render v2 text run must contain 1..16 scalars.");
    const id = attributes.id ?? null;
    if (id) {
      invariant(/^[a-z][\w-]{0,31}$/iu.test(id) && !ids.has(id), `Render v2 target id ${id} is invalid or duplicated.`);
      ids.add(id);
    }
    const universe = scalars(attributes["data-glyphs"] ?? match[2]);
    invariant(universe.length >= 1 && universe.length <= 64, `Render v2 target ${id ?? runs.length} glyph universe is invalid.`);
    initial.forEach((glyph) => invariant(universe.includes(glyph), `Initial glyph ${glyph} is absent from data-glyphs.`));
    const startCell = runs.reduce((sum, run) => sum + run.initial.length, 0);
    runs.push({ id, initial, universe: [...new Set(universe)], startCell,
      cellIndices: initial.map((_, index) => startCell + index) });
    cursor = spans.lastIndex;
  }
  invariant(runs.length > 0 && !body.slice(cursor).trim(), "Render v2 root must contain only direct span children.");
  invariant(runs.reduce((sum, run) => sum + run.initial.length, 0) <= 75, "Render v2 HTML exceeds 75 cells.");
  return runs;
}

function expandedHtml(runs, rootClass) {
  const cells = runs.flatMap((run) => run.initial).map((glyph) => `<span>${glyph}</span>`).join("");
  return `<div class="${rootClass}">${cells}</div>`;
}

function rgb565(value) {
  const short = /^#([0-9a-f]{3})$/iu.exec(value);
  const full = /^#([0-9a-f]{6})$/iu.exec(value);
  invariant(short || full, `Dynamic color ${value} must be #RGB or #RRGGBB.`);
  const digits = short ? [...short[1]].map((digit) => digit.repeat(2)).join("") : full[1];
  const r = Number.parseInt(digits.slice(0, 2), 16); const g = Number.parseInt(digits.slice(2, 4), 16);
  const b = Number.parseInt(digits.slice(4, 6), 16);
  return ((r >>> 3) << 11) | ((g >>> 2) << 5) | (b >>> 3);
}

function buildLogicalBindings(scriptModel, targets, scene) {
  const assignments = new Map(); const bindings = []; const formatBindings = new Set(); let activeSlot = null;
  for (const handler of scriptModel.handlers) {
    if (handler.activeSlot) {
      invariant(!activeSlot || activeSlot.stateIndex === handler.activeSlot.stateIndex,
        "widget.activeSlot may bind to only one state.");
      activeSlot = handler.activeSlot;
    }
    for (const action of handler.actions) {
      const target = targets.get(action.targetId);
      invariant(target, `Render script target #${action.targetId} does not exist.`);
      invariant(target.cellIndices.every((index) => index < 75), `Render target #${action.targetId} exceeds the cell budget.`);
      if (action.kind === "format-time") {
        invariant(target.initial.length === 8 && target.initial[2] === ":" && target.initial[5] === ":",
          `formatTime() target #${action.targetId} must be exactly HH:MM:SS.`);
        "0123456789".split("").forEach((glyph) => invariant(target.universe.includes(glyph),
          `formatTime() target #${action.targetId} data-glyphs must include 0..9.`));
        const initialSeconds = ((scriptModel.states[action.stateIndex].initial % 86400) + 86400) % 86400;
        const expected = [Math.floor(initialSeconds / 3600), Math.floor(initialSeconds / 60) % 60,
          initialSeconds % 60].map((value) => String(value).padStart(2, "0")).join(":");
        invariant(target.initial.join("") === expected,
          `formatTime() target #${target.id} initial text must equal ${expected} for its initial state.`);
        const positions = [0, 1, 3, 4, 6, 7]; const divisors = [36000, 3600, 600, 60, 10, 1];
        const moduli = [3, 10, 6, 10, 6, 10];
        positions.forEach((position, index) => {
          const name = `${target.id}_${position}`; const key = `${name}\0${action.stateName}`;
          if (formatBindings.has(key)) return;
          formatBindings.add(key);
          bindings.push({ name, targetId: target.id,
            stateName: action.stateName, stateIndex: action.stateIndex, divisor: divisors[index], modulo: moduli[index],
            cellIndices: [target.cellIndices[position]], variants: [..."0123456789"].map((glyph) => ({ glyphs: [glyph] })) });
        });
        continue;
      }
      const key = `${target.id}\0${action.stateName}`;
      invariant(![...assignments.keys()].some((other) => other.startsWith(`${target.id}\0`) && other !== key),
        `Render target #${target.id} cannot bind to multiple state slots.`);
      const group = assignments.get(key) ?? { target, stateName: action.stateName, stateIndex: action.stateIndex };
      if (group[action.kind]) invariant(JSON.stringify(group[action.kind]) === JSON.stringify(action.variants),
        `Render target #${target.id} repeats ${action.kind} with different variants.`);
      else group[action.kind] = action.variants;
      assignments.set(key, group);
    }
  }
  for (const group of assignments.values()) {
    const text = group["pick-text"]; const colors = group["pick-color"];
    const count = text?.length ?? colors?.length;
    invariant(count && (!text || !colors || text.length === colors.length),
      `Text/color pick counts differ for #${group.target.id}.`);
    const variants = Array.from({ length: count }, (_, index) => {
      const glyphs = text ? scalars(text[index]) : [...group.target.initial];
      invariant(glyphs.length === group.target.initial.length,
        `Every pick() text for #${group.target.id} must contain exactly ${group.target.initial.length} scalars.`);
      glyphs.forEach((glyph) => invariant(group.target.universe.includes(glyph),
        `pick() glyph ${glyph} is absent from #${group.target.id} data-glyphs.`));
      return { glyphs, color565: colors ? rgb565(colors[index]) : null };
    });
    const selected = ((scriptModel.states[group.stateIndex].initial % count) + count) % count;
    if (text) invariant(variants[selected].glyphs.join("") === group.target.initial.join(""),
      `pick() target #${group.target.id} initial text does not match initial state variant ${selected}.`);
    if (colors) group.target.cellIndices.forEach((cellIndex) => invariant(
      scene.cells[cellIndex].color565 === variants[selected].color565,
      `pick() target #${group.target.id} initial CSS color does not match initial state variant ${selected}.`));
    bindings.push({ name: group.target.id, targetId: group.target.id,
      stateName: group.stateName, stateIndex: group.stateIndex,
      divisor: 1, modulo: count, cellIndices: group.target.cellIndices, variants });
  }
  invariant(bindings.length >= 1 && bindings.length <= RENDER_V2_ABI_LIMITS.maxBindings,
    `Render v2 requires 1..${RENDER_V2_ABI_LIMITS.maxBindings} bindings.`);
  for (const binding of bindings) for (const handler of scriptModel.handlers) {
    const mutates = handler.instructions.some(({ opcode, dstState }) => opcode !== RENDER_V2_OPCODES.HALT &&
      dstState === binding.stateIndex);
    if (mutates) {
      const requiredKinds = new Set(scriptModel.handlers.flatMap(({ actions }) => actions)
        .filter((action) => action.targetId === binding.targetId && action.stateIndex === binding.stateIndex)
        .map(({ kind }) => kind));
      const presentKinds = new Set(handler.actions.filter((action) => action.targetId === binding.targetId &&
        action.stateIndex === binding.stateIndex).map(({ kind }) => kind));
      invariant([...requiredKinds].every((kind) => presentKinds.has(kind)),
        `State ${binding.stateName} mutates without every ${[...requiredKinds].join("+")} action for #${binding.targetId}.`);
    }
  }
  return { bindings, activeSlot };
}

function firmwareInstructions(handler, states) {
  const stateName = (index) => states[index]?.name;
  const names = { [RENDER_V2_OPCODES.SET]: "set", [RENDER_V2_OPCODES.ADD_IMM]: "add",
    [RENDER_V2_OPCODES.LOAD_EVENT]: "loadEvent", [RENDER_V2_OPCODES.ADD_EVENT]: "addEvent",
    [RENDER_V2_OPCODES.MOD_POSITIVE]: "modPositive", [RENDER_V2_OPCODES.CLAMP_MIN]: "clampMin",
    [RENDER_V2_OPCODES.CLAMP_MAX]: "clampMax", [RENDER_V2_OPCODES.ADD_EVENT_SCALED]: "addEventScaled" };
  return handler.instructions.filter(({ opcode }) => opcode !== RENDER_V2_OPCODES.HALT).map((instruction) => {
    const output = { op: names[instruction.opcode], state: stateName(instruction.dstState) };
    if (instruction.opcode === RENDER_V2_OPCODES.LOAD_EVENT ||
        instruction.opcode === RENDER_V2_OPCODES.ADD_EVENT ||
        instruction.opcode === RENDER_V2_OPCODES.ADD_EVENT_SCALED) {
      output.field = instruction.eventField === 1 ? "value" : instruction.eventField === 2 ? "id" :
        instruction.eventField === 3 ? "sequence" : "flags";
      if (instruction.opcode === RENDER_V2_OPCODES.ADD_EVENT_SCALED) output.imm = instruction.imm;
    } else output.imm = instruction.imm;
    return output;
  });
}

export function prepareRenderV2({ html, css, script, rootClass = "render-v2" }) {
  invariant(typeof css === "string" && Buffer.byteLength(css) <= 16 * 1024, "Render v2 CSS exceeds 16 KiB.");
  const runs = parseHtmlRuns(html, rootClass);
  const scriptModel = parseRenderV2Script(script);
  const compiled = compileCssWidget({ html: expandedHtml(runs, rootClass), css, rootClass });
  const glyphs = [...compiled.scene.glyphs];
  for (const run of runs) for (const glyph of run.universe) if (!glyphs.includes(glyph)) glyphs.push(glyph);
  invariant(glyphs.length <= 255, "Render v2 glyph universe exceeds 255 scalars.");
  const scene = { ...compiled.scene, glyphs, cells: compiled.scene.cells.map((cell) => ({ ...cell,
    glyphId: glyphs.indexOf(cell.glyph) })) };
  const sceneBinary = encodeCssScene(scene); scene.sha256 = sha256(sceneBinary);
  const targets = new Map(runs.filter(({ id }) => id).map((run) => [run.id, run]));
  const logical = buildLogicalBindings(scriptModel, targets, scene);
  invariant(!logical.activeSlot,
    "widget.activeSlot is reserved but is not implemented by the F2EP v1 firmware ABI; keep slot selection in integer state.");
  for (const binding of logical.bindings) for (const index of binding.cellIndices) invariant(scene.cells[index].animationId === 255,
    `Dynamic cell ${index} cannot also use a renderer-v1 CSS animation.`);
  const handlerSpec = scriptModel.handlers.map((handler) => ({
    event: handler.selector.kind === 1 ? "tick100ms" : handler.selector.kind === 2 ? "tick1s" :
      handler.selector.kind === 3 ? "fnBottomKnob" : "hostRpc",
    ...(handler.selector.kind === 4 ? { rpcEventId: handler.selector.id } : {}),
    instructions: firmwareInstructions(handler, scriptModel.states),
  }));
  invariant(handlerSpec.every(({ instructions }) => instructions.length > 0),
    "Every Render v2 handler must mutate state before its DOM binding.");
  return Object.freeze({ format: "framer-render-v2-prepared-v1", scene, sceneBinary, script: scriptModel,
    runs, logicalBindings: logical.bindings, activeSlot: logical.activeSlot,
    programBase: { state: Object.fromEntries(scriptModel.states.map(({ name, initial }) => [name, initial])),
      handlers: handlerSpec } });
}

function frameBytes(frame) {
  const output = Buffer.alloc(frame.length * 2);
  frame.forEach((value, index) => output.writeUInt16LE(value, index * 2));
  return output;
}

function cloneSceneWithVariant(scene, binding, variant) {
  const glyphIds = new Map(scene.glyphs.map((glyph, index) => [glyph, index]));
  const affected = new Map(binding.cellIndices.map((cell, index) => [cell, index]));
  return { ...scene, cells: scene.cells.map((cell, index) => {
    const position = affected.get(index); if (position === undefined) return cell;
    return { ...cell, glyphId: glyphIds.get(variant.glyphs[position]), glyph: variant.glyphs[position],
      color565: variant.color565 ?? cell.color565 };
  }) };
}

function patchForBinding(prepared, atlas, binding) {
  const { scene } = prepared; const width = scene.viewport.width;
  const rows = [];
  for (const index of binding.cellIndices) {
    const cell = scene.cells[index]; const radius = cell.glowRadius ?? 0;
    // The semantic compositor cannot touch pixels outside the centered atlas mask plus its bounded halo.
    // Capturing this complete dirty bound clears every old glyph/halo pixel without paying for a full cell.
    const maskX = cell.x + Math.floor((scene.layout.cellWidth - atlas.width) / 2);
    const maskY = cell.y + Math.floor((scene.layout.cellHeight - atlas.height) / 2);
    const x = Math.max(cell.x, maskX - radius); const y = Math.max(cell.y, maskY - radius);
    const right = Math.min(cell.x + scene.layout.cellWidth, maskX + atlas.width + radius);
    const bottom = Math.min(cell.y + scene.layout.cellHeight, maskY + atlas.height + radius);
    for (let row = y; row < bottom; row += 1) {
      rows.push({ absolute: row * width + x, count: right - x });
    }
  }
  rows.sort((left, right) => left.absolute - right.absolute);
  const originPixel = rows[0].absolute;
  const variants = binding.variants.map((variant) => {
    const frame = renderCssSceneRgb565(cloneSceneWithVariant(scene, binding, variant), atlas, 0);
    return rows.map(({ absolute, count }) => ({ pixelOffset: absolute - originPixel,
      colors: Array.from(frame.subarray(absolute, absolute + count)) }));
  });
  return { originPixel, variants };
}

function normalizeRasterPatch(binding, source) {
  invariant(source && typeof source === "object" && !Array.isArray(source),
    `Raster patch ${binding.name} must be an object.`);
  const originPixel = source.originPixel;
  invariant(Number.isInteger(originPixel) && originPixel >= 0 && originPixel < 31_000,
    `Raster patch ${binding.name} origin must be inside the framebuffer.`);
  const divisor = source.divisor ?? binding.divisor;
  const modulo = source.modulo ?? binding.modulo;
  invariant(Number.isInteger(divisor) && divisor >= 1 && divisor <= 0xffffffff,
    `Raster patch ${binding.name} divisor override must be a positive uint32.`);
  invariant(Number.isInteger(modulo) && modulo >= 1 && modulo <= binding.variants.length,
    `Raster patch ${binding.name} modulo override exceeds its variant count.`);
  invariant(Array.isArray(source.variants) && source.variants.length === binding.variants.length,
    `Raster patch ${binding.name} must provide exactly ${binding.variants.length} variants.`);
  const variants = source.variants.map((variant, variantIndex) => {
    invariant(Array.isArray(variant) && variant.length > 0,
      `Raster patch ${binding.name}/${variantIndex} must contain at least one span.`);
    let previousEnd = 0;
    return variant.map((span, spanIndex) => {
      invariant(span && typeof span === "object" && !Array.isArray(span),
        `Raster patch ${binding.name}/${variantIndex}/${spanIndex} must be an object.`);
      const pixelOffset = span.pixelOffset;
      invariant(Number.isInteger(pixelOffset) && pixelOffset >= previousEnd && pixelOffset <= 0xffff,
        `Raster patch ${binding.name}/${variantIndex} spans must be ordered and non-overlapping.`);
      invariant(span.colors instanceof Uint16Array || Array.isArray(span.colors),
        `Raster patch ${binding.name}/${variantIndex}/${spanIndex} colors must be RGB565 values.`);
      const colors = Array.from(span.colors);
      invariant(colors.length > 0 && colors.every((color) => Number.isInteger(color) && color >= 0 && color <= 0xffff),
        `Raster patch ${binding.name}/${variantIndex}/${spanIndex} contains invalid RGB565 values.`);
      previousEnd = pixelOffset + colors.length;
      invariant(originPixel + previousEnd <= 31_000,
        `Raster patch ${binding.name}/${variantIndex}/${spanIndex} exceeds the framebuffer.`);
      return { pixelOffset, colors };
    });
  });
  return { originPixel, variants, divisor, modulo };
}

function linkPreparedPatches(prepared, { atlas, programEncoder, baseFrame, patchFor, renderSource }) {
  invariant(prepared?.format === "framer-render-v2-prepared-v1", "linkRenderV2 requires prepareRenderV2 output.");
  invariant(atlas?.format === "framer-glyph-atlas-v1" && atlas.masks?.length === prepared.scene.glyphs.length,
    "Render v2 atlas must match the prepared F1SC glyph universe.");
  invariant(baseFrame instanceof Uint8Array && baseFrame.byteLength === 62_000,
    "Render v2 raster base must be the exact 62,000-byte RGB565-LE framebuffer.");
  const patchSets = Object.create(null); const patchNames = new Map(); const bindings = [];
  for (const binding of prepared.logicalBindings) {
    const patch = patchFor(binding);
    const key = sha256(JSON.stringify(patch.variants));
    let patchSet = patchNames.get(key);
    if (!patchSet) { patchSet = `patch${patchNames.size}`; patchNames.set(key, patchSet); patchSets[patchSet] = patch.variants; }
    bindings.push({ state: binding.stateName, divisor: patch.divisor ?? binding.divisor,
      modulo: patch.modulo ?? binding.modulo,
      patchSet, originPixel: patch.originPixel });
  }
  const spec = deepFreeze({ state: { ...prepared.programBase.state },
    handlers: structuredClone(prepared.programBase.handlers), patchSets, bindings });
  const variants = Object.values(patchSets).flat(); const spans = variants.flat();
  const pixelBytes = spans.reduce((sum, span) => sum + span.colors.length * 2, 0);
  invariant(Object.keys(patchSets).length <= 8, "Render v2 patch-set budget exceeds 8.");
  invariant(variants.length <= 64, "Render v2 patch-variant budget exceeds 64.");
  invariant(spans.length <= RENDER_V2_ABI_LIMITS.maxPatchSpans,
    `Render v2 patch-span budget exceeds ${RENDER_V2_ABI_LIMITS.maxPatchSpans}.`);
  invariant(pixelBytes <= RENDER_V2_ABI_LIMITS.maxPatchBytes,
    `Render v2 patch pixels exceed ${RENDER_V2_ABI_LIMITS.maxPatchBytes} bytes.`);
  invariant(typeof programEncoder === "function", "Render v2 programEncoder must be a function.");
  const program = programEncoder(spec);
  const ownedBaseFrame = Buffer.from(baseFrame);
  return Object.freeze({ ...prepared, format: "framer-render-v2-linked-v1", atlas, spec, program,
    renderSource,
    get baseFrame() { return Buffer.from(ownedBaseFrame); },
    budget: Object.freeze({ states: prepared.script.states.length, handlers: prepared.script.handlers.length,
      bindings: bindings.length, patchSets: Object.keys(patchSets).length, variants: variants.length,
      spans: spans.length, pixelBytes, baseFrameBytes: ownedBaseFrame.length, programBytes: program.binary.length }),
    sha256: program.sha256 });
}

/** Link logical DOM mutations to exact RGB565 row spans. Pass programEncoder for a concrete firmware binary. */
export function linkRenderV2(prepared, { atlas, programEncoder = compileRenderV2Program } = {}) {
  const baseFrame = frameBytes(renderCssSceneRgb565(prepared.scene, atlas, 0));
  return linkPreparedPatches(prepared, { atlas, programEncoder, baseFrame,
    patchFor: (binding) => patchForBinding(prepared, atlas, binding), renderSource: "semantic-f1sc" });
}

/**
 * Link a deterministic host-rasterized RGB565 base and explicit per-binding patch variants.
 * The emitted program uses the same bounded F2EP ABI as the semantic linker; no rasterizer runs on device.
 */
export function linkRenderV2Raster(prepared, { atlas, baseFrame, bindingPatches,
  programEncoder = compileRenderV2Program } = {}) {
  invariant(bindingPatches && typeof bindingPatches === "object" && !Array.isArray(bindingPatches),
    "linkRenderV2Raster requires bindingPatches keyed by logical binding name.");
  const expected = new Set(prepared?.logicalBindings?.map(({ name }) => name) ?? []);
  for (const name of Object.keys(bindingPatches)) invariant(expected.has(name),
    `Raster patch ${name} does not match a logical binding.`);
  for (const name of expected) invariant(Object.hasOwn(bindingPatches, name),
    `Raster patch ${name} is missing.`);
  return linkPreparedPatches(prepared, { atlas, programEncoder, baseFrame,
    patchFor: (binding) => normalizeRasterPatch(binding, bindingPatches[binding.name]),
    renderSource: "pre-rendered-rgb565" });
}

function positiveModulo(value, modulus) { return ((value % modulus) + modulus) % modulus; }

export function createRenderV2Runtime(linked) {
  invariant(linked?.format === "framer-render-v2-linked-v1", "Runtime requires linked Render v2 output.");
  const names = Object.keys(linked.spec.state); const state = new Int32Array(RENDER_V2_ABI_LIMITS.maxStateSlots);
  names.forEach((name, index) => { state[index] = linked.spec.state[name]; });
  const slots = Object.fromEntries(names.map((name, index) => [name, index]));
  const baseFrame = Buffer.from(linked.baseFrame); let frame = Buffer.from(baseFrame); let generation = 0;
  const dispatch = (input) => {
    const event = input instanceof Uint8Array ? decodeRenderV2Event(input) :
      decodeRenderV2Event(encodeRenderV2Event(input));
    const kind = event.kind;
    const before = Buffer.from(frame); frame = Buffer.from(baseFrame);
    for (const handler of linked.script.handlers) {
      if (handler.selector.kind !== kind || handler.selector.kind === 4 && handler.selector.id !== (event.id ?? 0) ||
        handler.selector.kind === 3 && (((event.flags ?? 0) & 1) === 0 || (event.id ?? 0) !== 1)) continue;
      const decoded = { ...event, kind };
      executeRenderV2Instructions({ instructions: handler.instructions, state, event: decoded });
    }
    for (const binding of linked.spec.bindings) {
      const selected = positiveModulo(Math.trunc(state[slots[binding.state]] / binding.divisor), binding.modulo);
      for (const span of linked.spec.patchSets[binding.patchSet][selected]) {
        span.colors.forEach((color, index) => frame.writeUInt16LE(color, (binding.originPixel + span.pixelOffset + index) * 2));
      }
    }
    let changedPixels = 0;
    for (let offset = 0; offset < frame.length; offset += 2) if (frame.readUInt16LE(offset) !== before.readUInt16LE(offset)) changedPixels += 1;
    generation += 1;
    return Object.freeze({ frame: Buffer.from(frame), state: Object.freeze(Object.fromEntries(names.map((name, index) => [name, state[index]]))),
      activeSlot: linked.activeSlot ? positiveModulo(state[linked.activeSlot.stateIndex], linked.activeSlot.modulo) : null,
      changedPixels, generation });
  };
  return Object.freeze({ dispatch, get frame() { return Buffer.from(frame); } });
}
