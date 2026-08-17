import { createHash } from "node:crypto";

import { encodeRenderV2Instruction, RENDER_V2_ABI_LIMITS, RENDER_V2_EVENT_FIELDS,
  RENDER_V2_OPCODES } from "./abi.mjs";

export const RENDER_V2_PROGRAM_LIMITS = Object.freeze({
  format: "framer-renderer-v2-event-program-v1", magic: "F2EP", version: 1,
  headerBytes: 64, handlerBytes: 12, patchSetBytes: 8, variantBytes: 8, spanBytes: 8, bindingBytes: 16,
  patchSets: 8, patchVariants: 64, ...RENDER_V2_ABI_LIMITS,
});

const EVENT_KIND = Object.freeze({ tick100ms: 1, tick1s: 2, fnBottomKnob: 3, hostRpc: 4 });
const FIELD = Object.freeze({ none: 0, value: 1, id: 2, sequence: 3, flags: 4 });
const OPCODE = Object.freeze({ halt: 0, set: 1, add: 2, loadEvent: 3, addEvent: 4,
  modPositive: 5, clampMin: 6, clampMax: 7, addEventScaled: 8 });
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/u;

function invariant(value, message) { if (!value) throw new Error(message); }
function record(value, label) { invariant(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object.`); return value; }
function int32(value, label) { invariant(Number.isInteger(value) && value >= -0x80000000 && value <= 0x7fffffff,
  `${label} must be an int32.`); return value | 0; }
function uint16(value, label) { invariant(Number.isInteger(value) && value >= 0 && value <= 0xffff,
  `${label} must be a uint16.`); return value; }
function uint32(value, label) { invariant(Number.isInteger(value) && value >= 0 && value <= 0xffffffff,
  `${label} must be a uint32.`); return value; }
function align4(value) { return (value + 3) & ~3; }

function normalizeState(source) {
  record(source, "Render v2 state"); const names = Object.keys(source);
  invariant(names.length >= 1 && names.length <= RENDER_V2_ABI_LIMITS.maxStateSlots,
    "Render v2 state must define 1..16 slots.");
  const slots = Object.create(null); const initial = new Int32Array(names.length);
  names.forEach((name, index) => {
    invariant(IDENTIFIER.test(name), `Render v2 state name ${name} is invalid.`);
    slots[name] = index; initial[index] = int32(source[name], `Initial state ${name}`);
  });
  return { names, slots, initial };
}

function normalizeHandlers(source, slots) {
  invariant(Array.isArray(source) && source.length >= 1 && source.length <= RENDER_V2_ABI_LIMITS.maxHandlers,
    "Render v2 requires 1..16 handlers.");
  const keys = new Set();
  return source.map((handler, index) => {
    record(handler, `Render v2 handler ${index}`); const kind = EVENT_KIND[handler.event];
    invariant(kind, `Unsupported Render v2 event ${handler.event}.`);
    const matchId = kind === EVENT_KIND.hostRpc ? uint16(handler.rpcEventId, "Host RPC id") :
      kind === EVENT_KIND.fnBottomKnob ? 1 : 0;
    invariant(kind !== EVENT_KIND.hostRpc || matchId >= 1, "Host RPC id must be in 1..65535.");
    invariant(kind === EVENT_KIND.hostRpc || handler.rpcEventId === undefined,
      "Only hostRpc handlers may declare rpcEventId.");
    const key = `${kind}:${matchId}`; invariant(!keys.has(key), `Duplicate Render v2 handler ${key}.`); keys.add(key);
    invariant(Array.isArray(handler.instructions) && handler.instructions.length >= 1 &&
      handler.instructions.length < RENDER_V2_ABI_LIMITS.maxInstructionsPerHandler,
    "Render v2 handler must have 1..63 source instructions.");
    const instructions = handler.instructions.map((instruction) => {
      record(instruction, "Render v2 instruction"); const opcode = OPCODE[instruction.op];
      invariant(opcode !== undefined && opcode !== 0, `Unsupported source opcode ${instruction.op}.`);
      invariant(Object.hasOwn(slots, instruction.state), `Undeclared instruction state ${instruction.state}.`);
      const readsEvent = opcode === OPCODE.loadEvent || opcode === OPCODE.addEvent ||
        opcode === OPCODE.addEventScaled;
      const eventField = readsEvent ? FIELD[instruction.field] : RENDER_V2_EVENT_FIELDS.none;
      const scaled = opcode === OPCODE.addEventScaled;
      invariant(readsEvent ? eventField && (scaled ? instruction.imm !== undefined : instruction.imm === undefined) :
        instruction.field === undefined,
        `${instruction.op} has an invalid field/immediate shape.`);
      return encodeRenderV2Instruction({ opcode, dstState: slots[instruction.state], eventField,
        imm: readsEvent && !scaled ? 0 : int32(instruction.imm, `${instruction.op} immediate`) });
    });
    instructions.push(Buffer.alloc(RENDER_V2_ABI_LIMITS.instructionBytes));
    return { kind, matchId, bytecode: Buffer.concat(instructions), instructionCount: instructions.length };
  });
}

function colors(value, label) {
  if (value instanceof Uint8Array) {
    invariant(value.byteLength >= 2 && value.byteLength % 2 === 0, `${label} bytes are invalid.`);
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  invariant(value instanceof Uint16Array || Array.isArray(value), `${label} must contain RGB565 pixels.`);
  invariant(value.length >= 1 && value.length <= 0xffff, `${label} length is invalid.`);
  const output = Buffer.alloc(value.length * 2);
  for (let index = 0; index < value.length; index += 1) output.writeUInt16LE(uint16(value[index], `${label} color`), index * 2);
  return output;
}

function normalizePatchSets(source) {
  record(source, "Render v2 patchSets"); const names = Object.keys(source);
  invariant(names.length >= 1 && names.length <= RENDER_V2_PROGRAM_LIMITS.patchSets,
    "Render v2 requires 1..8 patch sets.");
  const patchSets = []; const variants = []; const spans = []; const blob = []; let blobBytes = 0;
  for (const name of names) {
    invariant(IDENTIFIER.test(name), `Render v2 patch set name ${name} is invalid.`);
    const sourceVariants = source[name]; invariant(Array.isArray(sourceVariants) && sourceVariants.length,
      `Render v2 patch set ${name} has no variants.`);
    const variantStart = variants.length;
    for (let variantIndex = 0; variantIndex < sourceVariants.length; variantIndex += 1) {
      const sourceSpans = sourceVariants[variantIndex]; invariant(Array.isArray(sourceSpans) && sourceSpans.length,
        `Render v2 patch ${name}/${variantIndex} has no spans.`);
      const spanStart = spans.length; let previousEnd = 0;
      for (const span of sourceSpans) {
        record(span, `Render v2 patch ${name}/${variantIndex}`);
        const pixelOffset = uint16(span.pixelOffset, "Render v2 patch pixel offset");
        const bytes = colors(span.colors, `Render v2 patch ${name}/${variantIndex}`); const pixelCount = bytes.length / 2;
        invariant(pixelOffset >= previousEnd && pixelOffset + pixelCount <= 31_000,
          "Render v2 patch spans overlap, are unordered, or exceed the framebuffer.");
        invariant(blobBytes + bytes.length <= RENDER_V2_ABI_LIMITS.maxPatchBytes,
          "Render v2 patch pixel budget exceeds 16 KiB.");
        spans.push({ pixelOffset, pixelCount, blobOffset: blobBytes }); blob.push(bytes); blobBytes += bytes.length;
        previousEnd = pixelOffset + pixelCount;
      }
      invariant(spans.length <= RENDER_V2_ABI_LIMITS.maxPatchSpans, "Render v2 patch span budget exceeds 512.");
      variants.push({ spanStart, spanCount: spans.length - spanStart });
      invariant(variants.length <= RENDER_V2_PROGRAM_LIMITS.patchVariants, "Render v2 patch variant budget exceeds 64.");
    }
    patchSets.push({ name, variantStart, variantCount: variants.length - variantStart });
  }
  return { patchSets, variants, spans, patchBlob: Buffer.concat(blob) };
}

function normalizeBindings(source, slots, patchData) {
  invariant(Array.isArray(source) && source.length >= 1 && source.length <= RENDER_V2_ABI_LIMITS.maxBindings,
    "Render v2 requires 1..16 bindings.");
  const patchSlots = Object.fromEntries(patchData.patchSets.map(({ name }, index) => [name, index]));
  return source.map((binding, index) => {
    record(binding, `Render v2 binding ${index}`);
    invariant(Object.hasOwn(slots, binding.state), `Render v2 binding ${index} state is undeclared.`);
    invariant(Object.hasOwn(patchSlots, binding.patchSet), `Render v2 binding ${index} patch set is undeclared.`);
    const patchSetSlot = patchSlots[binding.patchSet]; const patchSet = patchData.patchSets[patchSetSlot];
    const divisor = uint32(binding.divisor ?? 1, "Render v2 binding divisor");
    const modulo = uint16(binding.modulo ?? patchSet.variantCount, "Render v2 binding modulo");
    const originPixel = uint32(binding.originPixel ?? 0, "Render v2 binding origin");
    invariant(divisor > 0 && modulo > 0 && modulo <= patchSet.variantCount,
      `Render v2 binding ${index} selector is invalid.`);
    invariant(originPixel < 31_000, `Render v2 binding ${index} origin is outside the framebuffer.`);
    for (let variantIndex = patchSet.variantStart; variantIndex < patchSet.variantStart + patchSet.variantCount; variantIndex += 1) {
      const variant = patchData.variants[variantIndex];
      for (let spanIndex = variant.spanStart; spanIndex < variant.spanStart + variant.spanCount; spanIndex += 1) {
        const span = patchData.spans[spanIndex];
        invariant(originPixel + span.pixelOffset + span.pixelCount <= 31_000,
          `Render v2 binding ${index} patch exceeds the framebuffer.`);
      }
    }
    return { stateSlot: slots[binding.state], patchSetSlot, divisor, modulo, originPixel };
  });
}

function table(records, bytes, writer) {
  const output = Buffer.alloc(records.length * bytes); records.forEach((record, index) => writer(output, index * bytes, record));
  return output;
}

function encodeProgram(state, handlers, patchData, bindings) {
  const stateBytes = Buffer.alloc(state.initial.length * 4);
  state.initial.forEach((value, index) => stateBytes.writeInt32LE(value, index * 4));
  let byteOffset = 0; handlers.forEach((handler) => { handler.byteOffset = byteOffset; byteOffset += handler.bytecode.length; });
  const bytecode = Buffer.concat(handlers.map(({ bytecode: value }) => value));
  const handlerTable = table(handlers, 12, (output, offset, handler) => {
    output[offset] = handler.kind; output.writeUInt16LE(handler.matchId, offset + 2);
    output.writeUInt32LE(handler.byteOffset, offset + 4); output.writeUInt16LE(handler.instructionCount, offset + 8);
  });
  const patchSetTable = table(patchData.patchSets, 8, (output, offset, patchSet) => {
    output.writeUInt16LE(patchSet.variantStart, offset); output.writeUInt16LE(patchSet.variantCount, offset + 2);
  });
  const variantTable = table(patchData.variants, 8, (output, offset, variant) => {
    output.writeUInt16LE(variant.spanStart, offset); output.writeUInt16LE(variant.spanCount, offset + 2);
  });
  const spanTable = table(patchData.spans, 8, (output, offset, span) => {
    output.writeUInt16LE(span.pixelOffset, offset); output.writeUInt16LE(span.pixelCount, offset + 2);
    output.writeUInt32LE(span.blobOffset, offset + 4);
  });
  const bindingTable = table(bindings, 16, (output, offset, binding) => {
    output[offset] = binding.stateSlot; output[offset + 1] = binding.patchSetSlot;
    output.writeUInt32LE(binding.divisor, offset + 4); output.writeUInt16LE(binding.modulo, offset + 8);
    output.writeUInt32LE(binding.originPixel, offset + 12);
  });
  const sections = [stateBytes, handlerTable, bytecode, patchSetTable, variantTable, spanTable, bindingTable,
    patchData.patchBlob];
  const offsets = []; let cursor = 64;
  for (const section of sections) { cursor = align4(cursor); offsets.push(cursor); cursor += section.length; }
  const binary = Buffer.alloc(cursor); binary.write("F2EP", 0, "ascii"); binary[4] = 1;
  binary[5] = state.initial.length; binary[6] = handlers.length; binary[7] = patchData.patchSets.length;
  binary.writeUInt16LE(bindings.length, 8); binary.writeUInt16LE(patchData.variants.length, 10);
  binary.writeUInt32LE(binary.length, 12); offsets.forEach((offset, index) => binary.writeUInt32LE(offset, 16 + index * 4));
  binary.writeUInt32LE(bytecode.length, 48); binary.writeUInt32LE(patchData.spans.length, 52);
  binary.writeUInt32LE(patchData.patchBlob.length, 56); sections.forEach((section, index) => section.copy(binary, offsets[index]));
  return { binary, bytecode, spanTable };
}

/** Self-contained canonical F2EP encoder. */
export function compileRenderV2Program(spec) {
  const state = normalizeState(spec?.state); const handlers = normalizeHandlers(spec?.handlers, state.slots);
  const patchData = normalizePatchSets(spec?.patchSets); const bindings = normalizeBindings(spec?.bindings, state.slots, patchData);
  const encoded = encodeProgram(state, handlers, patchData, bindings); const sha256 = createHash("sha256").update(encoded.binary).digest("hex");
  const manifest = Object.freeze({ format: RENDER_V2_PROGRAM_LIMITS.format, sha256, bytes: encoded.binary.length,
    framebuffer: Object.freeze({ width: 100, height: 310, strideBytes: 200, bytes: 62_000,
      source: "borrowed-renderer-v1", extraFramebufferBytes: 0 }),
    state: Object.freeze({ slots: state.initial.length, bytes: state.initial.byteLength, names: Object.freeze(state.names) }),
    events: Object.freeze({ recordBytes: 16, queueRecords: 8, queueBytes: 128 }),
    vm: Object.freeze({ handlers: handlers.length, instructions: encoded.bytecode.length / 8,
      bytecodeBytes: encoded.bytecode.length }),
    patches: Object.freeze({ patchSets: patchData.patchSets.length, variants: patchData.variants.length,
      spans: patchData.spans.length, spanTableBytes: encoded.spanTable.length, pixelBytes: patchData.patchBlob.length }),
    bindings: bindings.length });
  return Object.freeze({ format: RENDER_V2_PROGRAM_LIMITS.format, sha256, manifest,
    stateSlots: Object.freeze({ ...state.slots }), get binary() { return Buffer.from(encoded.binary); },
    get bytecode() { return Buffer.from(encoded.bytecode); } });
}

const EVENT_KIND_NAMES = Object.freeze([null, "tick.100ms", "tick.1s", "input.fn-bottom-knob", "host.rpc"]);

function programBytes(value) {
  invariant(value instanceof Uint8Array, "Render v2 program must be bytes.");
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

function zeroRange(binary, from, to, label) {
  invariant(from <= to && binary.subarray(from, to).every((byte) => byte === 0), `${label} must be zero.`);
}

/**
 * Validate an untrusted F2EP using the complete canonical v1 structure and
 * resource rules. This is the host mirror of device admission; a digest proves
 * transport integrity, while these checks are the execution safety boundary.
 */
export function inspectRenderV2Program(value) {
  const binary = programBytes(value);
  invariant(binary.length >= RENDER_V2_PROGRAM_LIMITS.headerBytes &&
    binary.subarray(0, 4).toString("ascii") === "F2EP", "Render v2 program has invalid F2EP magic.");
  invariant(binary[4] === 1, "Render v2 program version is unsupported.");
  const stateCount = binary[5]; const handlerCount = binary[6]; const patchSetCount = binary[7];
  const bindingCount = binary.readUInt16LE(8); const variantCount = binary.readUInt16LE(10);
  const declaredBytes = binary.readUInt32LE(12); const bytecodeBytes = binary.readUInt32LE(48);
  const spanCount = binary.readUInt32LE(52); const patchBytes = binary.readUInt32LE(56);
  invariant(stateCount >= 1 && stateCount <= RENDER_V2_ABI_LIMITS.maxStateSlots,
    "Render v2 program state count is outside 1..16.");
  invariant(handlerCount >= 1 && handlerCount <= RENDER_V2_ABI_LIMITS.maxHandlers,
    "Render v2 program handler count is outside 1..16.");
  invariant(patchSetCount >= 1 && patchSetCount <= RENDER_V2_PROGRAM_LIMITS.patchSets,
    "Render v2 program patch-set count is outside 1..8.");
  invariant(bindingCount >= 1 && bindingCount <= RENDER_V2_ABI_LIMITS.maxBindings,
    "Render v2 program binding count is outside 1..16.");
  invariant(variantCount >= 1 && variantCount <= RENDER_V2_PROGRAM_LIMITS.patchVariants,
    "Render v2 program variant count is outside 1..64.");
  invariant(spanCount >= 1 && spanCount <= RENDER_V2_ABI_LIMITS.maxPatchSpans,
    "Render v2 program span count is outside 1..512.");
  invariant(patchBytes >= 2 && patchBytes <= RENDER_V2_ABI_LIMITS.maxPatchBytes && patchBytes % 2 === 0,
    "Render v2 program patch payload is invalid.");
  invariant(bytecodeBytes >= RENDER_V2_ABI_LIMITS.instructionBytes &&
    bytecodeBytes % RENDER_V2_ABI_LIMITS.instructionBytes === 0,
  "Render v2 bytecode length is invalid.");
  invariant(declaredBytes === binary.length && binary.readUInt32LE(60) === 0,
    "Render v2 program length or reserved header word is invalid.");

  const offsets = Array.from({ length: 8 }, (_, index) => binary.readUInt32LE(16 + index * 4));
  const lengths = [stateCount * 4, handlerCount * RENDER_V2_PROGRAM_LIMITS.handlerBytes, bytecodeBytes,
    patchSetCount * RENDER_V2_PROGRAM_LIMITS.patchSetBytes,
    variantCount * RENDER_V2_PROGRAM_LIMITS.variantBytes,
    spanCount * RENDER_V2_PROGRAM_LIMITS.spanBytes,
    bindingCount * RENDER_V2_PROGRAM_LIMITS.bindingBytes, patchBytes];
  let cursor = RENDER_V2_PROGRAM_LIMITS.headerBytes;
  offsets.forEach((offset, index) => {
    const aligned = align4(cursor);
    zeroRange(binary, cursor, aligned, `Render v2 section ${index} alignment padding`);
    invariant(offset === aligned && offset + lengths[index] <= binary.length,
      `Render v2 section ${index} is not canonical or is out of range.`);
    cursor = offset + lengths[index];
  });
  invariant(cursor === binary.length, "Render v2 program has trailing or unclaimed bytes.");

  const handlerKeys = new Set(); const handlers = []; let bytecodeCursor = 0;
  for (let index = 0; index < handlerCount; index += 1) {
    const offset = offsets[1] + index * RENDER_V2_PROGRAM_LIMITS.handlerBytes;
    const kind = binary[offset]; const matchId = binary.readUInt16LE(offset + 2);
    const start = binary.readUInt32LE(offset + 4); const instructionCount = binary.readUInt16LE(offset + 8);
    invariant(kind >= 1 && kind <= 4 && binary[offset + 1] === 0 && binary.readUInt16LE(offset + 10) === 0,
      `Render v2 handler ${index} record is invalid.`);
    invariant(start === bytecodeCursor && instructionCount >= 1 &&
      instructionCount <= RENDER_V2_ABI_LIMITS.maxInstructionsPerHandler &&
      start + instructionCount * RENDER_V2_ABI_LIMITS.instructionBytes <= bytecodeBytes,
    `Render v2 handler ${index} bytecode range is invalid.`);
    invariant((kind !== 1 && kind !== 2 || matchId === 0) && (kind !== 3 || matchId === 1) &&
      (kind !== 4 || matchId >= 1),
      `Render v2 handler ${index} event match is invalid.`);
    const key = `${kind}:${matchId}`;
    invariant(!handlerKeys.has(key), `Render v2 handler ${key} is duplicated.`); handlerKeys.add(key);
    for (let instructionIndex = 0; instructionIndex < instructionCount; instructionIndex += 1) {
      const instructionOffset = offsets[2] + start + instructionIndex * RENDER_V2_ABI_LIMITS.instructionBytes;
      const opcode = binary[instructionOffset]; const destination = binary[instructionOffset + 1];
      const field = binary[instructionOffset + 2]; const immediate = binary.readInt32LE(instructionOffset + 4);
      invariant(opcode <= RENDER_V2_OPCODES.ADD_EVENT_SCALED && destination < stateCount &&
        binary[instructionOffset + 3] === 0, `Render v2 handler ${index} instruction ${instructionIndex} is invalid.`);
      if (opcode === RENDER_V2_OPCODES.HALT) invariant(instructionIndex + 1 === instructionCount &&
        destination === 0 && field === 0 && immediate === 0,
      `Render v2 handler ${index} HALT is not canonical.`);
      else {
        invariant(instructionIndex + 1 < instructionCount,
          `Render v2 handler ${index} does not end in HALT.`);
        const readsEvent = opcode === RENDER_V2_OPCODES.LOAD_EVENT || opcode === RENDER_V2_OPCODES.ADD_EVENT ||
          opcode === RENDER_V2_OPCODES.ADD_EVENT_SCALED;
        invariant(readsEvent ? field >= 1 && field <= 4 &&
          (opcode === RENDER_V2_OPCODES.ADD_EVENT_SCALED ? immediate !== 0 : immediate === 0) : field === 0,
        `Render v2 handler ${index} instruction ${instructionIndex} has an invalid field/immediate.`);
        invariant(opcode !== RENDER_V2_OPCODES.MOD_POSITIVE || immediate > 0,
          `Render v2 handler ${index} modulo is not positive.`);
      }
    }
    bytecodeCursor += instructionCount * RENDER_V2_ABI_LIMITS.instructionBytes;
    handlers.push(Object.freeze({ kind: EVENT_KIND_NAMES[kind], kindId: kind, matchId, instructions: instructionCount }));
  }
  invariant(bytecodeCursor === bytecodeBytes, "Render v2 handlers do not cover bytecode exactly.");

  let variantCursor = 0;
  const patchSets = [];
  for (let index = 0; index < patchSetCount; index += 1) {
    const offset = offsets[3] + index * RENDER_V2_PROGRAM_LIMITS.patchSetBytes;
    const start = binary.readUInt16LE(offset); const count = binary.readUInt16LE(offset + 2);
    invariant(start === variantCursor && count >= 1 && start + count <= variantCount &&
      binary.readUInt32LE(offset + 4) === 0, `Render v2 patch set ${index} is invalid.`);
    patchSets.push({ start, count }); variantCursor += count;
  }
  invariant(variantCursor === variantCount, "Render v2 patch sets do not cover variants exactly.");

  let spanCursor = 0; let blobCursor = 0;
  const variants = [];
  for (let index = 0; index < variantCount; index += 1) {
    const offset = offsets[4] + index * RENDER_V2_PROGRAM_LIMITS.variantBytes;
    const start = binary.readUInt16LE(offset); const count = binary.readUInt16LE(offset + 2);
    invariant(start === spanCursor && count >= 1 && start + count <= spanCount &&
      binary.readUInt32LE(offset + 4) === 0, `Render v2 variant ${index} is invalid.`);
    let priorEnd = 0;
    for (let spanIndex = start; spanIndex < start + count; spanIndex += 1) {
      const spanOffset = offsets[5] + spanIndex * RENDER_V2_PROGRAM_LIMITS.spanBytes;
      const pixel = binary.readUInt16LE(spanOffset); const pixels = binary.readUInt16LE(spanOffset + 2);
      const blob = binary.readUInt32LE(spanOffset + 4);
      invariant(pixels >= 1 && pixel >= priorEnd && pixel + pixels <= 31_000 && blob === blobCursor &&
        blob + pixels * 2 <= patchBytes, `Render v2 span ${spanIndex} is invalid.`);
      priorEnd = pixel + pixels; blobCursor += pixels * 2;
    }
    variants.push({ start, count }); spanCursor += count;
  }
  invariant(spanCursor === spanCount && blobCursor === patchBytes,
    "Render v2 variants do not cover spans/pixels exactly.");

  for (let index = 0; index < bindingCount; index += 1) {
    const offset = offsets[6] + index * RENDER_V2_PROGRAM_LIMITS.bindingBytes;
    const state = binary[offset]; const patchSet = binary[offset + 1]; const divisor = binary.readUInt32LE(offset + 4);
    const modulo = binary.readUInt16LE(offset + 8); const origin = binary.readUInt32LE(offset + 12);
    invariant(state < stateCount && patchSet < patchSetCount && binary.readUInt16LE(offset + 2) === 0 &&
      divisor >= 1 && modulo >= 1 && modulo <= patchSets[patchSet].count &&
      binary.readUInt16LE(offset + 10) === 0 && origin < 31_000,
    `Render v2 binding ${index} is invalid.`);
    const selectedSet = patchSets[patchSet];
    for (let variantIndex = selectedSet.start; variantIndex < selectedSet.start + selectedSet.count; variantIndex += 1) {
      const variant = variants[variantIndex];
      for (let spanIndex = variant.start; spanIndex < variant.start + variant.count; spanIndex += 1) {
        const spanOffset = offsets[5] + spanIndex * RENDER_V2_PROGRAM_LIMITS.spanBytes;
        const pixel = binary.readUInt16LE(spanOffset); const pixels = binary.readUInt16LE(spanOffset + 2);
        invariant(origin + pixel + pixels <= 31_000, `Render v2 binding ${index} exceeds the framebuffer.`);
      }
    }
  }

  const sha256 = createHash("sha256").update(binary).digest("hex");
  return Object.freeze({ format: RENDER_V2_PROGRAM_LIMITS.format, version: 1, sha256, bytes: binary.length,
    structurallyAdmitted: true, stateSlots: stateCount, handlers: Object.freeze(handlers),
    resources: Object.freeze({ handlers: handlerCount, instructions: bytecodeBytes / 8, bytecodeBytes,
      patchSets: patchSetCount, variants: variantCount, spans: spanCount, pixelBytes: patchBytes,
      bindings: bindingCount }), get binary() { return Buffer.from(binary); } });
}
