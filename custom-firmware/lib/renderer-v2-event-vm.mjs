import { createHash } from "node:crypto";

import { RENDERER_V1 } from "./renderer-v1-runtime.mjs";

const PROGRAMS = new WeakMap();

export const RENDERER_V2_EVENT_KIND = Object.freeze({
  tick100ms: 1,
  tick1s: 2,
  fnBottomKnob: 3,
  hostRpc: 4,
});

export const RENDERER_V2_EVENT_FIELD = Object.freeze({
  none: 0,
  value: 1,
  id: 2,
  sequence: 3,
  flags: 4,
});

export const RENDERER_V2_OPCODE = Object.freeze({
  halt: 0,
  set: 1,
  add: 2,
  loadEvent: 3,
  addEvent: 4,
  modPositive: 5,
  clampMin: 6,
  clampMax: 7,
  addEventScaled: 8,
});

export const RENDERER_V2_LIMITS = Object.freeze({
  format: "framer-renderer-v2-event-program-v1",
  magic: "F2EP",
  version: 1,
  headerBytes: 64,
  eventBytes: 16,
  instructionBytes: 8,
  handlerBytes: 12,
  patchSetBytes: 8,
  variantBytes: 8,
  spanBytes: 8,
  bindingBytes: 16,
  stateSlots: 16,
  handlers: 16,
  instructionsPerHandler: 64,
  patchSets: 8,
  patchVariants: 64,
  // 512 row spans cover ten shared 9x18 clock glyphs plus small event patches;
  // the table is still a fixed 4096 bytes and pixel payload remains capped.
  patchSpans: 512,
  patchBytes: 16 * 1024,
  bindings: 16,
  eventQueueRecords: 8,
  framebufferBytes: RENDERER_V1.framebufferBytes,
  extraFramebufferBytes: 0,
  bottomEncoderId: RENDERER_V1.bottomEncoderId,
});

const EVENT_NAMES = new Map(Object.entries(RENDERER_V2_EVENT_KIND).map(([name, value]) => [value, name]));
const FIELD_NAMES = new Map(Object.entries(RENDERER_V2_EVENT_FIELD).map(([name, value]) => [value, name]));
const OPCODE_NAMES = new Map(Object.entries(RENDERER_V2_OPCODE).map(([name, value]) => [value, name]));
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/u;

function invariant(value, message) {
  if (!value) throw new Error(message);
}

function plainRecord(value, label) {
  invariant(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object.`);
  return value;
}

function int32(value, label) {
  invariant(Number.isInteger(value) && value >= -0x80000000 && value <= 0x7fffffff,
    `${label} must be an int32.`);
  return value | 0;
}

function uint16(value, label) {
  invariant(Number.isInteger(value) && value >= 0 && value <= 0xffff, `${label} must be a uint16.`);
  return value;
}

function uint32(value, label) {
  invariant(Number.isInteger(value) && value >= 0 && value <= 0xffffffff, `${label} must be a uint32.`);
  return value;
}

function align4(value) { return (value + 3) & ~3; }

function euclideanModulo(value, modulus) {
  const remainder = value % modulus;
  return remainder < 0 ? remainder + modulus : remainder;
}

function eventKind(value) {
  const kind = typeof value === "string" ? RENDERER_V2_EVENT_KIND[value] : value;
  invariant(EVENT_NAMES.has(kind), `Unsupported renderer-v2 event kind ${value}.`);
  return kind;
}

function eventField(value) {
  const field = typeof value === "string" ? RENDERER_V2_EVENT_FIELD[value] : value;
  invariant(FIELD_NAMES.has(field), `Unsupported renderer-v2 event field ${value}.`);
  return field;
}

function opcode(value) {
  const code = typeof value === "string" ? RENDERER_V2_OPCODE[value] : value;
  invariant(OPCODE_NAMES.has(code), `Unsupported renderer-v2 opcode ${value}.`);
  return code;
}

function writeEvent(target, offset, { kind, flags = 0, id = 0, value = 0, sequence = 0 }) {
  const normalizedKind = eventKind(kind);
  invariant(Number.isInteger(flags) && flags >= 0 && flags <= 1,
    "Renderer-v2 event flags reserve every bit except Fn bit zero.");
  target[offset] = normalizedKind;
  target[offset + 1] = flags;
  target.writeUInt16LE(uint16(id, "Renderer-v2 event ID"), offset + 2);
  target.writeInt32LE(int32(value, "Renderer-v2 event value"), offset + 4);
  target.writeUInt32LE(uint32(sequence, "Renderer-v2 event sequence"), offset + 8);
  target.writeUInt32LE(0, offset + 12);
}

export function encodeRendererV2Event(event) {
  const output = Buffer.alloc(RENDERER_V2_LIMITS.eventBytes);
  writeEvent(output, 0, event);
  return output;
}

export function decodeRendererV2Event(value) {
  const input = Buffer.from(value?.buffer ?? value, value?.byteOffset ?? 0, value?.byteLength ?? value?.length);
  invariant(input.length === RENDERER_V2_LIMITS.eventBytes, "Renderer-v2 event record must be exactly 16 bytes.");
  const kind = input[0];
  invariant(EVENT_NAMES.has(kind) && input[1] <= 1 && input.readUInt32LE(12) === 0,
    "Renderer-v2 event record has unsupported or nonzero reserved fields.");
  return Object.freeze({
    kind,
    event: EVENT_NAMES.get(kind),
    flags: input[1],
    id: input.readUInt16LE(2),
    value: input.readInt32LE(4),
    sequence: input.readUInt32LE(8),
  });
}

function normalizeState(spec) {
  const source = plainRecord(spec, "Renderer-v2 state");
  const names = Object.keys(source);
  invariant(names.length >= 1 && names.length <= RENDERER_V2_LIMITS.stateSlots,
    `Renderer-v2 state must define 1..${RENDERER_V2_LIMITS.stateSlots} slots.`);
  const seen = new Set();
  const initial = new Int32Array(names.length);
  const slots = Object.create(null);
  names.forEach((name, index) => {
    invariant(IDENTIFIER.test(name) && !seen.has(name), `Renderer-v2 state name ${name} is invalid or duplicated.`);
    seen.add(name);
    slots[name] = index;
    initial[index] = int32(source[name], `Initial state ${name}`);
  });
  return { names: Object.freeze(names), slots: Object.freeze(slots), initial };
}

function encodeInstruction(instruction, stateSlots) {
  const input = plainRecord(instruction, "Renderer-v2 instruction");
  const code = opcode(input.op);
  invariant(code !== RENDERER_V2_OPCODE.halt, "HALT is appended by the compiler and cannot appear in source instructions.");
  invariant(typeof input.state === "string" && Object.hasOwn(stateSlots, input.state),
    `Renderer-v2 instruction state ${input.state} is not declared.`);
  const destination = stateSlots[input.state];
  let field = RENDERER_V2_EVENT_FIELD.none;
  let immediate = 0;
  if (code === RENDERER_V2_OPCODE.loadEvent || code === RENDERER_V2_OPCODE.addEvent ||
      code === RENDERER_V2_OPCODE.addEventScaled) {
    field = eventField(input.field);
    const scaled = code === RENDERER_V2_OPCODE.addEventScaled;
    invariant(field !== RENDERER_V2_EVENT_FIELD.none && (scaled ? input.imm !== undefined : input.imm === undefined),
      `${input.op} has an invalid event-field/immediate shape.`);
    immediate = scaled ? int32(input.imm, `${input.op} immediate`) : 0;
    invariant(!scaled || immediate !== 0, "addEventScaled requires a nonzero scale immediate.");
  } else {
    invariant(input.field === undefined, `${input.op} cannot read an event field.`);
    immediate = int32(input.imm, `${input.op} immediate`);
    if (code === RENDERER_V2_OPCODE.modPositive) {
      invariant(immediate > 0, "modPositive requires a positive modulus.");
    }
  }
  const output = Buffer.alloc(RENDERER_V2_LIMITS.instructionBytes);
  output[0] = code;
  output[1] = destination;
  output[2] = field;
  output[3] = 0;
  output.writeInt32LE(immediate, 4);
  return output;
}

function normalizeHandlers(source, stateSlots) {
  invariant(Array.isArray(source) && source.length >= 1 && source.length <= RENDERER_V2_LIMITS.handlers,
    `Renderer-v2 must define 1..${RENDERER_V2_LIMITS.handlers} handlers.`);
  const keys = new Set();
  return source.map((handler, index) => {
    plainRecord(handler, `Renderer-v2 handler ${index}`);
    const kind = eventKind(handler.event);
    let matchId = 0;
    if (kind === RENDERER_V2_EVENT_KIND.hostRpc) {
      matchId = uint16(handler.rpcEventId, `Renderer-v2 handler ${index} rpcEventId`);
    } else {
      invariant(handler.rpcEventId === undefined, "Only hostRpc handlers may declare rpcEventId.");
      matchId = kind === RENDERER_V2_EVENT_KIND.fnBottomKnob ? RENDERER_V2_LIMITS.bottomEncoderId : 0;
    }
    const key = `${kind}:${matchId}`;
    invariant(!keys.has(key), `Renderer-v2 handler ${key} is duplicated.`);
    keys.add(key);
    invariant(Array.isArray(handler.instructions) && handler.instructions.length >= 1 &&
      handler.instructions.length < RENDERER_V2_LIMITS.instructionsPerHandler,
    `Renderer-v2 handler ${key} must have 1..${RENDERER_V2_LIMITS.instructionsPerHandler - 1} source instructions.`);
    const instructions = handler.instructions.map((instruction) => encodeInstruction(instruction, stateSlots));
    instructions.push(Buffer.alloc(RENDERER_V2_LIMITS.instructionBytes));
    return { kind, matchId, bytecode: Buffer.concat(instructions), instructionCount: instructions.length };
  });
}

function colorsToBytes(value, label) {
  if (value instanceof Uint16Array || Array.isArray(value)) {
    invariant(value.length >= 1 && value.length <= 0xffff, `${label} must contain 1..65535 RGB565 pixels.`);
    const output = Buffer.alloc(value.length * 2);
    for (let index = 0; index < value.length; index += 1) {
      invariant(Number.isInteger(value[index]) && value[index] >= 0 && value[index] <= 0xffff,
        `${label} color ${index} is not uint16 RGB565.`);
      output.writeUInt16LE(value[index], index * 2);
    }
    return output;
  }
  invariant(value instanceof Uint8Array && value.byteLength >= 2 && value.byteLength % 2 === 0,
    `${label} must be RGB565 colors or an even nonempty byte array.`);
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

function normalizePatchSets(source) {
  const record = plainRecord(source, "Renderer-v2 patchSets");
  const names = Object.keys(record);
  invariant(names.length >= 1 && names.length <= RENDERER_V2_LIMITS.patchSets,
    `Renderer-v2 must define 1..${RENDERER_V2_LIMITS.patchSets} patch sets.`);
  const patchSets = [];
  const variants = [];
  const spans = [];
  const blobParts = [];
  let blobBytes = 0;
  for (const name of names) {
    invariant(IDENTIFIER.test(name), `Renderer-v2 patch set name ${name} is invalid.`);
    const sourceVariants = record[name];
    invariant(Array.isArray(sourceVariants) && sourceVariants.length >= 1,
      `Renderer-v2 patch set ${name} must contain variants.`);
    const variantStart = variants.length;
    for (let variantIndex = 0; variantIndex < sourceVariants.length; variantIndex += 1) {
      const sourceSpans = sourceVariants[variantIndex];
      invariant(Array.isArray(sourceSpans) && sourceSpans.length >= 1,
        `Renderer-v2 patch set ${name} variant ${variantIndex} must contain spans.`);
      const spanStart = spans.length;
      let previousEnd = 0;
      sourceSpans.forEach((span, spanIndex) => {
        plainRecord(span, `Renderer-v2 ${name}/${variantIndex} span ${spanIndex}`);
        const pixelOffset = uint16(span.pixelOffset, "Renderer-v2 relative pixel offset");
        const bytes = colorsToBytes(span.colors, `Renderer-v2 ${name}/${variantIndex} span ${spanIndex}`);
        const pixelCount = bytes.length / 2;
        invariant(pixelOffset >= previousEnd && pixelOffset + pixelCount <= RENDERER_V1.width * RENDERER_V1.height,
          `Renderer-v2 ${name}/${variantIndex} spans overlap, are unordered, or exceed the framebuffer.`);
        invariant(blobBytes + bytes.length <= RENDERER_V2_LIMITS.patchBytes,
          `Renderer-v2 patch bytes exceed ${RENDERER_V2_LIMITS.patchBytes}.`);
        spans.push({ pixelOffset, pixelCount, blobOffset: blobBytes });
        blobParts.push(bytes);
        blobBytes += bytes.length;
        previousEnd = pixelOffset + pixelCount;
      });
      invariant(spans.length <= RENDERER_V2_LIMITS.patchSpans,
        `Renderer-v2 patch spans exceed ${RENDERER_V2_LIMITS.patchSpans}.`);
      variants.push({ spanStart, spanCount: spans.length - spanStart });
      invariant(variants.length <= RENDERER_V2_LIMITS.patchVariants,
        `Renderer-v2 patch variants exceed ${RENDERER_V2_LIMITS.patchVariants}.`);
    }
    patchSets.push({ name, variantStart, variantCount: variants.length - variantStart });
  }
  return { names: Object.freeze(names), patchSets, variants, spans, patchBlob: Buffer.concat(blobParts) };
}

function normalizeBindings(source, stateSlots, patchData) {
  invariant(Array.isArray(source) && source.length >= 1 && source.length <= RENDERER_V2_LIMITS.bindings,
    `Renderer-v2 must define 1..${RENDERER_V2_LIMITS.bindings} bindings.`);
  const patchSetSlots = Object.fromEntries(patchData.patchSets.map(({ name }, index) => [name, index]));
  return source.map((binding, index) => {
    plainRecord(binding, `Renderer-v2 binding ${index}`);
    invariant(typeof binding.state === "string" && Object.hasOwn(stateSlots, binding.state),
      `Renderer-v2 binding ${index} state is not declared.`);
    invariant(typeof binding.patchSet === "string" && Object.hasOwn(patchSetSlots, binding.patchSet),
      `Renderer-v2 binding ${index} patchSet is not declared.`);
    const patchSetSlot = patchSetSlots[binding.patchSet];
    const patchSet = patchData.patchSets[patchSetSlot];
    const divisor = uint32(binding.divisor ?? 1, `Renderer-v2 binding ${index} divisor`);
    const modulo = uint16(binding.modulo ?? patchSet.variantCount, `Renderer-v2 binding ${index} modulo`);
    const originPixel = uint32(binding.originPixel ?? 0, `Renderer-v2 binding ${index} originPixel`);
    invariant(divisor > 0 && modulo > 0 && modulo <= patchSet.variantCount,
      `Renderer-v2 binding ${index} divisor/modulo exceeds its patch set.`);
    invariant(originPixel < RENDERER_V1.width * RENDERER_V1.height,
      `Renderer-v2 binding ${index} origin is outside the framebuffer.`);
    for (let variant = patchSet.variantStart; variant < patchSet.variantStart + patchSet.variantCount; variant += 1) {
      const descriptor = patchData.variants[variant];
      for (let span = descriptor.spanStart; span < descriptor.spanStart + descriptor.spanCount; span += 1) {
        const patch = patchData.spans[span];
        invariant(originPixel + patch.pixelOffset + patch.pixelCount <= RENDERER_V1.width * RENDERER_V1.height,
          `Renderer-v2 binding ${index} patch exceeds the framebuffer.`);
      }
    }
    return { stateSlot: stateSlots[binding.state], patchSetSlot, divisor, modulo, originPixel };
  });
}

function tableBuffer(records, bytes, writer) {
  const output = Buffer.alloc(records.length * bytes);
  records.forEach((record, index) => writer(output, index * bytes, record));
  return output;
}

function buildProgramBinary(state, handlers, patchData, bindings) {
  const stateBytes = Buffer.alloc(state.initial.length * 4);
  state.initial.forEach((value, index) => stateBytes.writeInt32LE(value, index * 4));
  let bytecodeBytes = 0;
  handlers.forEach((handler) => { handler.byteOffset = bytecodeBytes; bytecodeBytes += handler.bytecode.length; });
  const bytecode = Buffer.concat(handlers.map(({ bytecode: bytes }) => bytes));
  const handlerTable = tableBuffer(handlers, RENDERER_V2_LIMITS.handlerBytes, (output, offset, handler) => {
    output[offset] = handler.kind;
    output[offset + 1] = 0;
    output.writeUInt16LE(handler.matchId, offset + 2);
    output.writeUInt32LE(handler.byteOffset, offset + 4);
    output.writeUInt16LE(handler.instructionCount, offset + 8);
    output.writeUInt16LE(0, offset + 10);
  });
  const patchSetTable = tableBuffer(patchData.patchSets, RENDERER_V2_LIMITS.patchSetBytes,
    (output, offset, patchSet) => {
      output.writeUInt16LE(patchSet.variantStart, offset);
      output.writeUInt16LE(patchSet.variantCount, offset + 2);
      output.writeUInt32LE(0, offset + 4);
    });
  const variantTable = tableBuffer(patchData.variants, RENDERER_V2_LIMITS.variantBytes,
    (output, offset, variant) => {
      output.writeUInt16LE(variant.spanStart, offset);
      output.writeUInt16LE(variant.spanCount, offset + 2);
      output.writeUInt32LE(0, offset + 4);
    });
  const spanTable = tableBuffer(patchData.spans, RENDERER_V2_LIMITS.spanBytes, (output, offset, span) => {
    output.writeUInt16LE(span.pixelOffset, offset);
    output.writeUInt16LE(span.pixelCount, offset + 2);
    output.writeUInt32LE(span.blobOffset, offset + 4);
  });
  const bindingTable = tableBuffer(bindings, RENDERER_V2_LIMITS.bindingBytes, (output, offset, binding) => {
    output[offset] = binding.stateSlot;
    output[offset + 1] = binding.patchSetSlot;
    output.writeUInt16LE(0, offset + 2);
    output.writeUInt32LE(binding.divisor, offset + 4);
    output.writeUInt16LE(binding.modulo, offset + 8);
    output.writeUInt16LE(0, offset + 10);
    output.writeUInt32LE(binding.originPixel, offset + 12);
  });
  const sections = [stateBytes, handlerTable, bytecode, patchSetTable, variantTable, spanTable, bindingTable,
    patchData.patchBlob];
  const offsets = [];
  let cursor = RENDERER_V2_LIMITS.headerBytes;
  for (const section of sections) { cursor = align4(cursor); offsets.push(cursor); cursor += section.length; }
  const output = Buffer.alloc(cursor);
  output.write(RENDERER_V2_LIMITS.magic, 0, "ascii");
  output[4] = RENDERER_V2_LIMITS.version;
  output[5] = state.initial.length;
  output[6] = handlers.length;
  output[7] = patchData.patchSets.length;
  output.writeUInt16LE(bindings.length, 8);
  output.writeUInt16LE(patchData.variants.length, 10);
  output.writeUInt32LE(output.length, 12);
  offsets.forEach((offset, index) => output.writeUInt32LE(offset, 16 + index * 4));
  output.writeUInt32LE(bytecode.length, 48);
  output.writeUInt32LE(patchData.spans.length, 52);
  output.writeUInt32LE(patchData.patchBlob.length, 56);
  output.writeUInt32LE(0, 60);
  sections.forEach((section, index) => section.copy(output, offsets[index]));
  return { binary: output, bytecode, handlerTable, patchSetTable, variantTable, spanTable, bindingTable };
}

/**
 * Compile a bounded DOM-mutation trace into the exact event VM consumed by the
 * firmware model. jsdom belongs on the host/compiler side; this program is the
 * deterministic state transition and RGB565 patch result that goes on-device.
 */
export function compileRendererV2Program({ state: stateSpec, handlers: handlerSpec,
  patchSets: patchSetSpec, bindings: bindingSpec } = {}) {
  const state = normalizeState(stateSpec);
  const handlers = normalizeHandlers(handlerSpec, state.slots);
  const patchData = normalizePatchSets(patchSetSpec);
  const bindings = normalizeBindings(bindingSpec, state.slots, patchData);
  const encoded = buildProgramBinary(state, handlers, patchData, bindings);
  const sha256 = createHash("sha256").update(encoded.binary).digest("hex");
  const manifest = Object.freeze({
    format: RENDERER_V2_LIMITS.format,
    sha256,
    bytes: encoded.binary.length,
    framebuffer: Object.freeze({ width: RENDERER_V1.width, height: RENDERER_V1.height,
      strideBytes: RENDERER_V1.strideBytes, bytes: RENDERER_V1.framebufferBytes,
      source: "borrowed-renderer-v1", extraFramebufferBytes: 0 }),
    state: Object.freeze({ slots: state.initial.length, bytes: state.initial.byteLength,
      names: state.names }),
    events: Object.freeze({ recordBytes: RENDERER_V2_LIMITS.eventBytes,
      queueRecords: RENDERER_V2_LIMITS.eventQueueRecords,
      queueBytes: RENDERER_V2_LIMITS.eventBytes * RENDERER_V2_LIMITS.eventQueueRecords }),
    vm: Object.freeze({ handlers: handlers.length, instructions: encoded.bytecode.length /
      RENDERER_V2_LIMITS.instructionBytes, bytecodeBytes: encoded.bytecode.length }),
    patches: Object.freeze({ patchSets: patchData.patchSets.length, variants: patchData.variants.length,
      spans: patchData.spans.length, spanTableBytes: encoded.spanTable.length,
      pixelBytes: patchData.patchBlob.length }),
    bindings: bindings.length,
  });
  const program = Object.freeze({
    format: RENDERER_V2_LIMITS.format,
    sha256,
    manifest,
    stateSlots: state.slots,
    get binary() { return Buffer.from(encoded.binary); },
    get bytecode() { return Buffer.from(encoded.bytecode); },
  });
  PROGRAMS.set(program, { state, handlers, patchData, bindings, encoded });
  return program;
}

export const encodeRendererV2Program = compileRendererV2Program;

function eventFieldValue(field, event) {
  if (field === RENDERER_V2_EVENT_FIELD.value) return event.value;
  if (field === RENDERER_V2_EVENT_FIELD.id) return event.id;
  if (field === RENDERER_V2_EVENT_FIELD.sequence) return event.sequence | 0;
  if (field === RENDERER_V2_EVENT_FIELD.flags) return event.flags;
  return 0;
}

function execute(bytecode, state, event) {
  let changed = false;
  for (let offset = 0; offset < bytecode.length; offset += RENDERER_V2_LIMITS.instructionBytes) {
    const code = bytecode[offset];
    if (code === RENDERER_V2_OPCODE.halt) return changed;
    const destination = bytecode[offset + 1];
    const field = bytecode[offset + 2];
    const immediate = bytecode.readInt32LE(offset + 4);
    const previous = state[destination];
    let next = previous;
    if (code === RENDERER_V2_OPCODE.set) next = immediate;
    else if (code === RENDERER_V2_OPCODE.add) next = (previous + immediate) | 0;
    else if (code === RENDERER_V2_OPCODE.loadEvent) next = eventFieldValue(field, event) | 0;
    else if (code === RENDERER_V2_OPCODE.addEvent) next = (previous + eventFieldValue(field, event)) | 0;
    else if (code === RENDERER_V2_OPCODE.addEventScaled)
      next = (previous + Math.imul(eventFieldValue(field, event), immediate)) | 0;
    else if (code === RENDERER_V2_OPCODE.modPositive) next = euclideanModulo(previous, immediate) | 0;
    else if (code === RENDERER_V2_OPCODE.clampMin) next = Math.max(previous, immediate) | 0;
    else if (code === RENDERER_V2_OPCODE.clampMax) next = Math.min(previous, immediate) | 0;
    else throw new Error(`Renderer-v2 encountered opcode ${code} after admission.`);
    state[destination] = next;
    changed ||= next !== previous;
  }
  throw new Error("Renderer-v2 handler exhausted its bytecode without HALT.");
}

export class RendererV2EventRuntime {
  #program;
  #framebuffer;
  #renderV1Frame;
  #state;
  #queue = Buffer.alloc(RENDERER_V2_LIMITS.eventQueueRecords * RENDERER_V2_LIMITS.eventBytes);
  #queueHead = 0;
  #queueTail = 0;
  #queueCount = 0;
  #sequence = 0;
  #subsecond = 0;
  #tickCount = 0;
  #frameGeneration = 0;
  #descriptorIdentity = 0;

  constructor(program, { framebuffer, renderV1Frame } = {}) {
    const internal = PROGRAMS.get(program);
    invariant(internal, "Renderer-v2 runtime requires a program returned by compileRendererV2Program.");
    invariant(Buffer.isBuffer(framebuffer) && framebuffer.length === RENDERER_V1.framebufferBytes,
      `Renderer-v2 must borrow the exact ${RENDERER_V1.framebufferBytes}-byte v1 framebuffer.`);
    invariant(typeof renderV1Frame === "function", "Renderer-v2 requires renderV1Frame(framebuffer, context).");
    this.#program = internal;
    this.#framebuffer = framebuffer;
    this.#renderV1Frame = renderV1Frame;
    this.#state = new Int32Array(internal.state.initial);
  }

  get framebuffer() { return this.#framebuffer; }
  get frameGeneration() { return this.#frameGeneration; }
  get descriptorIdentity() { return this.#descriptorIdentity; }
  get queuedEvents() { return this.#queueCount; }
  get state() {
    return Object.freeze(Object.fromEntries(this.#program.state.names.map((name, index) => [name, this.#state[index]])));
  }

  #nextSequence() {
    this.#sequence = (this.#sequence + 1) >>> 0;
    return this.#sequence;
  }

  #enqueue(event) {
    if (this.#queueCount === RENDERER_V2_LIMITS.eventQueueRecords) return false;
    // Sequence numbers belong only to admitted records. This matches the
    // native queue lock: a busy/full producer does not create a hole in the
    // observable event stream.
    writeEvent(this.#queue, this.#queueTail * RENDERER_V2_LIMITS.eventBytes,
      { ...event, sequence: this.#nextSequence() });
    this.#queueTail = (this.#queueTail + 1) % RENDERER_V2_LIMITS.eventQueueRecords;
    this.#queueCount += 1;
    return true;
  }

  enqueueFnBottomKnob({ encoderId, delta, fnPressed = false, inputAvailable = true } = {}) {
    const raw = Number(delta) & 0xff;
    const signed = raw >= 0x80 ? raw - 0x100 : raw;
    if (encoderId !== RENDERER_V2_LIMITS.bottomEncoderId || signed === 0 || !fnPressed || !inputAvailable) return false;
    return this.#enqueue({ kind: RENDERER_V2_EVENT_KIND.fnBottomKnob, flags: 1,
      id: encoderId, value: signed });
  }

  enqueueHostRpc({ rpcEventId, value } = {}) {
    const id = uint16(rpcEventId, "Renderer-v2 host RPC event ID");
    int32(value, "Renderer-v2 host RPC scalar");
    if (!this.#program.handlers.some((handler) => handler.kind === RENDERER_V2_EVENT_KIND.hostRpc &&
      handler.matchId === id)) return false;
    return this.#enqueue({ kind: RENDERER_V2_EVENT_KIND.hostRpc, id, value });
  }

  #dispatch(event) {
    let changed = false;
    for (const handler of this.#program.handlers) {
      if (handler.kind !== event.kind) continue;
      if ((event.kind === RENDERER_V2_EVENT_KIND.hostRpc || event.kind === RENDERER_V2_EVENT_KIND.fnBottomKnob) &&
          handler.matchId !== event.id) continue;
      changed = execute(handler.bytecode, this.#state, event) || changed;
    }
    return changed;
  }

  #drainQueue() {
    let drained = 0;
    let changed = false;
    while (this.#queueCount > 0) {
      const offset = this.#queueHead * RENDERER_V2_LIMITS.eventBytes;
      const event = {
        kind: this.#queue[offset], flags: this.#queue[offset + 1],
        id: this.#queue.readUInt16LE(offset + 2), value: this.#queue.readInt32LE(offset + 4),
        sequence: this.#queue.readUInt32LE(offset + 8),
      };
      changed = this.#dispatch(event) || changed;
      this.#queue.fill(0, offset, offset + RENDERER_V2_LIMITS.eventBytes);
      this.#queueHead = (this.#queueHead + 1) % RENDERER_V2_LIMITS.eventQueueRecords;
      this.#queueCount -= 1;
      drained += 1;
    }
    return { drained, changed };
  }

  #applyBindings() {
    const { patchData, bindings } = this.#program;
    for (const binding of bindings) {
      const quotient = Math.trunc(this.#state[binding.stateSlot] / binding.divisor);
      const selected = euclideanModulo(quotient, binding.modulo);
      const patchSet = patchData.patchSets[binding.patchSetSlot];
      const variant = patchData.variants[patchSet.variantStart + selected];
      for (let index = variant.spanStart; index < variant.spanStart + variant.spanCount; index += 1) {
        const span = patchData.spans[index];
        const destination = (binding.originPixel + span.pixelOffset) * 2;
        const sourceEnd = span.blobOffset + span.pixelCount * 2;
        patchData.patchBlob.copy(this.#framebuffer, destination, span.blobOffset, sourceEnd);
      }
    }
  }

  tick100ms() {
    let baseResult;
    try {
      baseResult = this.#renderV1Frame(this.#framebuffer, Object.freeze({ tick: this.#tickCount,
        tickMs: RENDERER_V1.tickMs, width: RENDERER_V1.width, height: RENDERER_V1.height,
        strideBytes: RENDERER_V1.strideBytes }));
      if (baseResult === false) throw new Error("v1 base renderer rejected the frame.");
    } catch (error) {
      this.#framebuffer.fill(0);
      return Object.freeze({ rendered: false, reason: "v1-base", error });
    }
    const queued = this.#drainQueue();
    const tick100 = { kind: RENDERER_V2_EVENT_KIND.tick100ms, flags: 0, id: 0,
      value: 1, sequence: this.#nextSequence() };
    let changed = this.#dispatch(tick100) || queued.changed;
    this.#subsecond += 1;
    let secondTick = false;
    if (this.#subsecond === 10) {
      this.#subsecond = 0;
      secondTick = true;
      changed = this.#dispatch({ kind: RENDERER_V2_EVENT_KIND.tick1s, flags: 0, id: 0,
        value: 1, sequence: this.#nextSequence() }) || changed;
    }
    this.#applyBindings();
    this.#tickCount += 1;
    this.#frameGeneration += 1;
    this.#descriptorIdentity ^= 1;
    return Object.freeze({ rendered: true, tick: this.#tickCount - 1, secondTick,
      drainedEvents: queued.drained, stateChanged: changed,
      frameGeneration: this.#frameGeneration, descriptorIdentity: this.#descriptorIdentity });
  }
}
