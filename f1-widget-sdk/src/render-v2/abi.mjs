import { createHash } from "node:crypto";

export const RENDER_V2_EVENT_KINDS = Object.freeze({
  "tick.100ms": 1,
  "tick.1s": 2,
  "input.fn-bottom-knob": 3,
  "host.rpc": 4,
});

export const RENDER_V2_EVENT_FLAGS = Object.freeze({ FN: 1 });

export const RENDER_V2_EVENT_FIELDS = Object.freeze({
  none: 0,
  value: 1,
  id: 2,
  sequence: 3,
  flags: 4,
});

export const RENDER_V2_OPCODES = Object.freeze({
  HALT: 0,
  SET: 1,
  ADD_IMM: 2,
  LOAD_EVENT: 3,
  ADD_EVENT: 4,
  MOD_POSITIVE: 5,
  CLAMP_MIN: 6,
  CLAMP_MAX: 7,
  ADD_EVENT_SCALED: 8,
});

export const RENDER_V2_ABI_LIMITS = Object.freeze({
  eventBytes: 16,
  instructionBytes: 8,
  maxStateSlots: 16,
  maxHandlers: 16,
  maxInstructionsPerHandler: 64,
  maxBindings: 16,
  maxPatchSpans: 512,
  maxPatchBytes: 16 * 1024,
});

function invariant(value, message) {
  if (!value) throw new Error(message);
}

function int32(value, label) {
  invariant(Number.isInteger(value) && value >= -0x80000000 && value <= 0x7fffffff,
    `${label} must be an int32.`);
  return value | 0;
}

function uint32(value, label) {
  invariant(Number.isInteger(value) && value >= 0 && value <= 0xffffffff,
    `${label} must be a uint32.`);
  return value >>> 0;
}

export function encodeRenderV2Event({ kind, flags = 0, id = 0, value = 0, sequence = 0 }) {
  const kindId = typeof kind === "string" ? RENDER_V2_EVENT_KINDS[kind] : kind;
  invariant(Number.isInteger(kindId) && kindId >= 1 && kindId <= 4, "Render v2 event kind is invalid.");
  invariant(Number.isInteger(flags) && flags >= 0 && flags <= 1,
    "Render v2 event flags reserve every bit except Fn bit zero.");
  invariant(Number.isInteger(id) && id >= 0 && id <= 0xffff, "Render v2 event id must be a uint16.");
  const binary = Buffer.alloc(RENDER_V2_ABI_LIMITS.eventBytes);
  binary[0] = kindId;
  binary[1] = flags;
  binary.writeUInt16LE(id, 2);
  binary.writeInt32LE(int32(value, "Render v2 event value"), 4);
  binary.writeUInt32LE(uint32(sequence, "Render v2 event sequence"), 8);
  return binary;
}

export function decodeRenderV2Event(value) {
  invariant(value instanceof Uint8Array && value.byteLength === RENDER_V2_ABI_LIMITS.eventBytes,
    "Render v2 event must be exactly 16 bytes.");
  const binary = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  invariant(binary[0] >= 1 && binary[0] <= 4, "Render v2 event kind is invalid.");
  invariant(binary[1] <= 1, "Render v2 event flags reserve every bit except Fn bit zero.");
  invariant(binary.readUInt32LE(12) === 0, "Render v2 event reserved word must be zero.");
  return Object.freeze({
    kind: binary[0],
    flags: binary[1],
    id: binary.readUInt16LE(2),
    value: binary.readInt32LE(4),
    sequence: binary.readUInt32LE(8),
  });
}

export function encodeRenderV2Instruction({ opcode, dstState = 0, eventField = 0, imm = 0 }) {
  const opcodeId = typeof opcode === "string" ? RENDER_V2_OPCODES[opcode] : opcode;
  const fieldId = typeof eventField === "string" ? RENDER_V2_EVENT_FIELDS[eventField] : eventField;
  invariant(Number.isInteger(opcodeId) && opcodeId >= 0 && opcodeId <= 8,
    "Render v2 instruction opcode is invalid.");
  invariant(Number.isInteger(dstState) && dstState >= 0 && dstState < RENDER_V2_ABI_LIMITS.maxStateSlots,
    "Render v2 instruction state slot is invalid.");
  invariant(Number.isInteger(fieldId) && fieldId >= 0 && fieldId <= 4,
    "Render v2 instruction event field is invalid.");
  const readsEvent = opcodeId === RENDER_V2_OPCODES.LOAD_EVENT ||
    opcodeId === RENDER_V2_OPCODES.ADD_EVENT || opcodeId === RENDER_V2_OPCODES.ADD_EVENT_SCALED;
  invariant(readsEvent ===
    (fieldId !== RENDER_V2_EVENT_FIELDS.none),
  "Only event instructions may declare a nonzero event field, and they must declare one.");
  invariant(opcodeId !== RENDER_V2_OPCODES.ADD_EVENT_SCALED || imm !== 0,
    "ADD_EVENT_SCALED requires a nonzero scale immediate.");
  invariant(opcodeId !== RENDER_V2_OPCODES.HALT || dstState === 0 && fieldId === 0 && imm === 0,
    "HALT must be the canonical all-zero instruction.");
  invariant(opcodeId !== RENDER_V2_OPCODES.MOD_POSITIVE || imm > 0,
    "MOD_POSITIVE requires a positive immediate.");
  const binary = Buffer.alloc(RENDER_V2_ABI_LIMITS.instructionBytes);
  binary[0] = opcodeId;
  binary[1] = dstState;
  binary[2] = fieldId;
  binary.writeInt32LE(int32(imm, "Render v2 instruction immediate"), 4);
  return binary;
}

export function decodeRenderV2Instruction(value) {
  invariant(value instanceof Uint8Array && value.byteLength === RENDER_V2_ABI_LIMITS.instructionBytes,
    "Render v2 instruction must be exactly 8 bytes.");
  const binary = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  invariant(binary[3] === 0, "Render v2 instruction reserved byte must be zero.");
  const instruction = { opcode: binary[0], dstState: binary[1], eventField: binary[2],
    imm: binary.readInt32LE(4) };
  encodeRenderV2Instruction(instruction);
  return Object.freeze(instruction);
}

function eventFieldValue(event, field) {
  if (field === RENDER_V2_EVENT_FIELDS.value) return event.value | 0;
  if (field === RENDER_V2_EVENT_FIELDS.id) return event.id | 0;
  if (field === RENDER_V2_EVENT_FIELDS.sequence) return event.sequence | 0;
  if (field === RENDER_V2_EVENT_FIELDS.flags) return event.flags | 0;
  throw new Error(`Unsupported Render v2 event field ${field}.`);
}

function addInt32(left, right) {
  return (left + right) | 0;
}

/** Reference VM used for compiler/firmware parity tests. Mutates only the supplied 16-slot state array. */
export function executeRenderV2Instructions({ instructions, state, event }) {
  invariant(Array.isArray(instructions) && instructions.length > 0 &&
    instructions.length <= RENDER_V2_ABI_LIMITS.maxInstructionsPerHandler,
  "Render v2 handler instruction budget is invalid.");
  invariant(state instanceof Int32Array && state.length === RENDER_V2_ABI_LIMITS.maxStateSlots,
    "Render v2 VM state must be a 16-slot Int32Array.");
  const decodedEvent = event instanceof Uint8Array ? decodeRenderV2Event(event) : event;
  let halted = false;
  for (let pc = 0; pc < instructions.length; pc += 1) {
    const instruction = instructions[pc] instanceof Uint8Array ?
      decodeRenderV2Instruction(instructions[pc]) : instructions[pc];
    const { opcode, dstState, eventField, imm } = instruction;
    invariant(dstState >= 0 && dstState < state.length, `Instruction ${pc} state slot is invalid.`);
    if (opcode === RENDER_V2_OPCODES.HALT) { halted = true; break; }
    if (opcode === RENDER_V2_OPCODES.SET) state[dstState] = imm;
    else if (opcode === RENDER_V2_OPCODES.ADD_IMM) state[dstState] = addInt32(state[dstState], imm);
    else if (opcode === RENDER_V2_OPCODES.LOAD_EVENT) state[dstState] = eventFieldValue(decodedEvent, eventField);
    else if (opcode === RENDER_V2_OPCODES.ADD_EVENT) state[dstState] =
      addInt32(state[dstState], eventFieldValue(decodedEvent, eventField));
    else if (opcode === RENDER_V2_OPCODES.ADD_EVENT_SCALED) state[dstState] =
      addInt32(state[dstState], Math.imul(eventFieldValue(decodedEvent, eventField), imm));
    else if (opcode === RENDER_V2_OPCODES.MOD_POSITIVE) {
      invariant(imm > 0, `Instruction ${pc} modulo must be positive.`);
      state[dstState] = ((state[dstState] % imm) + imm) % imm;
    } else if (opcode === RENDER_V2_OPCODES.CLAMP_MIN) state[dstState] = Math.max(state[dstState], imm);
    else if (opcode === RENDER_V2_OPCODES.CLAMP_MAX) state[dstState] = Math.min(state[dstState], imm);
    else throw new Error(`Instruction ${pc} opcode ${opcode} is unsupported.`);
  }
  invariant(halted, "Render v2 handler did not halt within its instruction budget.");
  return state;
}

export function encodeRenderV2InstructionStream(instructions) {
  invariant(Array.isArray(instructions) && instructions.length > 0 &&
    instructions.length <= RENDER_V2_ABI_LIMITS.maxInstructionsPerHandler,
  "Render v2 handler instruction budget is invalid.");
  const binary = Buffer.concat(instructions.map(encodeRenderV2Instruction));
  return Object.freeze({ binary, sha256: createHash("sha256").update(binary).digest("hex") });
}
