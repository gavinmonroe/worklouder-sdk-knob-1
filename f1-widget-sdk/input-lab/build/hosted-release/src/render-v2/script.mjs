import {
  encodeRenderV2InstructionStream,
  RENDER_V2_ABI_LIMITS,
  RENDER_V2_EVENT_FIELDS,
  RENDER_V2_EVENT_FLAGS,
  RENDER_V2_EVENT_KINDS,
  RENDER_V2_OPCODES,
} from "./abi.mjs";

function invariant(value, message) {
  if (!value) throw new RenderV2CompileError(message);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || ArrayBuffer.isView(value) || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

export class RenderV2CompileError extends Error {
  constructor(message, diagnostics = []) {
    super(message);
    this.name = "RenderV2CompileError";
    this.diagnostics = diagnostics;
  }
}

function decodeString(token, label) {
  invariant(/^"(?:[^"\\]|\\["\\nrt])*"$/u.test(token), `${label} must be a double-quoted string.`);
  try { return JSON.parse(token); } catch { throw new RenderV2CompileError(`${label} contains an invalid escape.`); }
}

function splitArguments(source) {
  const parts = [];
  let start = 0; let quote = false; let escaped = false; let depth = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quote = false;
    } else if (character === '"') quote = true;
    else if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    else if (character === "," && depth === 0) { parts.push(source.slice(start, index).trim()); start = index + 1; }
  }
  invariant(!quote && depth === 0, "Render script expression is unbalanced.");
  parts.push(source.slice(start).trim());
  return parts;
}

function splitStatements(source) {
  const parts = [];
  let start = 0; let quote = false; let escaped = false; let depth = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quote = false;
    } else if (character === '"') quote = true;
    else if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    else if (character === ";" && depth === 0) { if (source.slice(start, index).trim()) parts.push(source.slice(start, index).trim()); start = index + 1; }
  }
  invariant(!quote && depth === 0, "Render script handler is unbalanced.");
  invariant(!source.slice(start).trim(), "Every render script statement must end with a semicolon.");
  return parts;
}

function findClosingBrace(source, opening) {
  let depth = 0; let quote = false; let escaped = false;
  for (let index = opening; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quote = false;
      continue;
    }
    if (character === '"') { quote = true; continue; }
    if (character === "{") depth += 1;
    if (character === "}" && --depth === 0) return index;
  }
  throw new RenderV2CompileError("Render script handler has an unmatched brace.");
}

function parseEventSelector(name) {
  if (name === "tick.100ms") return { kind: RENDER_V2_EVENT_KINDS["tick.100ms"], flagsMask: 0, flagsValue: 0, id: 0 };
  if (name === "tick.1s") return { kind: RENDER_V2_EVENT_KINDS["tick.1s"], flagsMask: 0, flagsValue: 0, id: 0 };
  if (name === "input.fn-bottom-knob") return { kind: RENDER_V2_EVENT_KINDS["input.fn-bottom-knob"],
    flagsMask: RENDER_V2_EVENT_FLAGS.FN, flagsValue: RENDER_V2_EVENT_FLAGS.FN, id: 0 };
  const rpc = /^host\.rpc:(0x[0-9a-f]{1,4}|\d{1,5})$/iu.exec(name);
  if (rpc) {
    const id = Number(rpc[1]);
    invariant(id >= 1 && id <= 0xffff, "Host RPC event id must be in 1..65535.");
    return { kind: RENDER_V2_EVENT_KINDS["host.rpc"], flagsMask: 0, flagsValue: 0, id };
  }
  throw new RenderV2CompileError(`Unsupported render event ${name}.`);
}

function parsePick(expression, stateByName) {
  const match = /^pick\(([\s\S]*)\)$/u.exec(expression);
  if (!match) return null;
  const [stateName, ...tokens] = splitArguments(match[1]);
  invariant(stateByName.has(stateName), `pick() references undeclared state ${stateName}.`);
  invariant(tokens.length >= 2 && tokens.length <= 16, "pick() requires 2..16 variants.");
  const variants = tokens.map((token) => decodeString(token, "pick() variant"));
  return { kind: "pick", stateName, variants };
}

function compileHandlerBody(body, stateByName, selector) {
  const instructions = [];
  const actions = [];
  let activeSlot = null;
  let actionSeen = false;
  const mutate = (...records) => {
    invariant(!actionSeen, "State mutation after a DOM assignment is unsupported; place DOM assignments last.");
    instructions.push(...records);
  };
  const stateSlot = (name) => {
    invariant(stateByName.has(name), `Render script references undeclared state ${name}.`);
    return stateByName.get(name).index;
  };
  const eventField = (name) => {
    invariant(name === "value" || name === "delta", `Unsupported event field event.${name}.`);
    invariant(name !== "delta" || selector.kind === RENDER_V2_EVENT_KINDS["input.fn-bottom-knob"],
      "event.delta is only valid for the Fn+bottom-knob event.");
    return RENDER_V2_EVENT_FIELDS.value;
  };
  for (const statement of splitStatements(body)) {
    let match = /^([A-Za-z_$][\w$]*)\s*\+=\s*event\.([A-Za-z_$][\w$]*)\s*\*\s*(-?\d+)$/u.exec(statement);
    if (match) {
      invariant(Number(match[3]) !== 0, "Scaled event multiplication requires a nonzero int32 factor.");
      mutate({ opcode: RENDER_V2_OPCODES.ADD_EVENT_SCALED, dstState: stateSlot(match[1]),
        eventField: eventField(match[2]), imm: Number(match[3]) });
      continue;
    }
    match = /^([A-Za-z_$][\w$]*)\s*(\+=|=)\s*event\.([A-Za-z_$][\w$]*)$/u.exec(statement);
    if (match) {
      mutate({ opcode: match[2] === "+=" ? RENDER_V2_OPCODES.ADD_EVENT : RENDER_V2_OPCODES.LOAD_EVENT,
        dstState: stateSlot(match[1]), eventField: eventField(match[3]), imm: 0 });
      continue;
    }
    match = /^([A-Za-z_$][\w$]*)\s*\+=\s*(-?\d+)$/u.exec(statement);
    if (match) {
      mutate({ opcode: RENDER_V2_OPCODES.ADD_IMM, dstState: stateSlot(match[1]), eventField: 0,
        imm: Number(match[2]) });
      continue;
    }
    match = /^([A-Za-z_$][\w$]*)\s*=\s*(-?\d+)$/u.exec(statement);
    if (match) {
      mutate({ opcode: RENDER_V2_OPCODES.SET, dstState: stateSlot(match[1]), eventField: 0,
        imm: Number(match[2]) });
      continue;
    }
    match = /^([A-Za-z_$][\w$]*)\s*=\s*\1\s*\+\s*(-?\d+)$/u.exec(statement);
    if (match) {
      mutate({ opcode: RENDER_V2_OPCODES.ADD_IMM, dstState: stateSlot(match[1]), eventField: 0,
        imm: Number(match[2]) });
      continue;
    }
    match = /^([A-Za-z_$][\w$]*)\s*=\s*mod\(\s*\1\s*,\s*(\d+)\s*\)$/u.exec(statement);
    if (match) {
      invariant(Number(match[2]) > 0, "mod() divisor must be positive.");
      mutate({ opcode: RENDER_V2_OPCODES.MOD_POSITIVE, dstState: stateSlot(match[1]), eventField: 0,
        imm: Number(match[2]) });
      continue;
    }
    match = /^([A-Za-z_$][\w$]*)\s*=\s*clamp\(\s*\1\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*\)$/u.exec(statement);
    if (match) {
      invariant(Number(match[2]) <= Number(match[3]), "clamp() minimum exceeds its maximum.");
      const dstState = stateSlot(match[1]);
      mutate({ opcode: RENDER_V2_OPCODES.CLAMP_MIN, dstState, eventField: 0, imm: Number(match[2]) },
        { opcode: RENDER_V2_OPCODES.CLAMP_MAX, dstState, eventField: 0, imm: Number(match[3]) });
      continue;
    }
    match = /^widget\.activeSlot\s*=\s*([A-Za-z_$][\w$]*)$/u.exec(statement);
    if (match) { actionSeen = true; activeSlot = { stateName: match[1], stateIndex: stateSlot(match[1]), modulo: 3 }; continue; }
    match = /^document\.querySelector\(\s*("(?:[^"\\]|\\["\\nrt])*")\s*\)\.(textContent|style\.color)\s*=\s*([\s\S]+)$/u.exec(statement);
    if (match) {
      actionSeen = true;
      const selectorText = decodeString(match[1], "querySelector() argument");
      const target = /^#([a-z][\w-]{0,31})$/iu.exec(selectorText);
      invariant(target, "querySelector() supports one #id selector only.");
      const clock = /^formatTime\(\s*([A-Za-z_$][\w$]*)\s*\)$/u.exec(match[3]);
      if (clock) {
        invariant(match[2] === "textContent", "formatTime() can only assign textContent.");
        actions.push({ kind: "format-time", targetId: target[1], stateName: clock[1],
          stateIndex: stateSlot(clock[1]) });
        continue;
      }
      const pick = parsePick(match[3], stateByName);
      invariant(pick, "DOM assignments support pick(state, ...) or formatTime(state) only.");
      actions.push({ kind: match[2] === "textContent" ? "pick-text" : "pick-color", targetId: target[1],
        stateName: pick.stateName, stateIndex: stateSlot(pick.stateName), variants: pick.variants });
      continue;
    }
    throw new RenderV2CompileError(`Unsupported render script statement: ${statement}`);
  }
  instructions.push({ opcode: RENDER_V2_OPCODES.HALT, dstState: 0, eventField: 0, imm: 0 });
  invariant(instructions.length <= RENDER_V2_ABI_LIMITS.maxInstructionsPerHandler,
    "Render v2 handler exceeds 64 instructions.");
  const encoded = encodeRenderV2InstructionStream(instructions);
  return { instructions, instructionBinary: encoded.binary, instructionSha256: encoded.sha256, actions, activeSlot };
}

/** Parse, but never execute, the documented Render v2 JavaScript/DOM-shaped subset. */
export function parseRenderV2Script(input) {
  invariant(typeof input === "string" && Buffer.byteLength(input) <= 8192,
    "Render script must be a UTF-8 string no larger than 8192 bytes.");
  invariant(!/[`']|\/\*|\*\/|\/\//u.test(input),
    "Render script forbids comments, template strings, and single-quoted strings.");
  const source = input;
  const states = [];
  const stateByName = new Map();
  const handlers = [];
  let cursor = 0; let handlersStarted = false;
  const whitespace = () => { while (/\s/u.test(source[cursor] ?? "")) cursor += 1; };
  while (cursor < source.length) {
    whitespace();
    if (cursor >= source.length) break;
    const remainder = source.slice(cursor);
    const declaration = /^(?:let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(-?\d+)\s*;/u.exec(remainder);
    if (declaration) {
      invariant(!handlersStarted, "State declarations must precede event handlers.");
      invariant(!stateByName.has(declaration[1]), `Duplicate state ${declaration[1]}.`);
      invariant(states.length < RENDER_V2_ABI_LIMITS.maxStateSlots, "Render v2 state budget exceeds 16 slots.");
      const value = Number(declaration[2]);
      invariant(value >= -0x80000000 && value <= 0x7fffffff, `Initial state ${declaration[1]} is outside int32.`);
      const state = { name: declaration[1], index: states.length, initial: value | 0 };
      states.push(state); stateByName.set(state.name, state); cursor += declaration[0].length; continue;
    }
    const header = /^widget\.on\(\s*("(?:[^"\\]|\\["\\nrt])*")\s*,\s*(?:(?:\(\s*)?event(?:\s*\))?\s*=>|function\s*\(\s*event\s*\))\s*\{/u.exec(remainder);
    invariant(header, `Unsupported render script syntax near byte ${cursor}.`);
    handlersStarted = true;
    const name = decodeString(header[1], "widget.on() event");
    const selector = parseEventSelector(name);
    const opening = cursor + header[0].length - 1;
    const closing = findClosingBrace(source, opening);
    const tail = /^\s*\)\s*;/u.exec(source.slice(closing + 1));
    invariant(tail, "widget.on() handler must end with `);`.");
    const body = compileHandlerBody(source.slice(opening + 1, closing), stateByName, selector);
    invariant(handlers.length < RENDER_V2_ABI_LIMITS.maxHandlers, "Render v2 handler budget exceeds 16.");
    invariant(!handlers.some((handler) => handler.selector.kind === selector.kind &&
      handler.selector.id === selector.id && handler.selector.flagsValue === selector.flagsValue),
    `Duplicate render event handler ${name}.`);
    handlers.push({ name, selector, ...body });
    cursor = closing + 1 + tail[0].length;
  }
  invariant(states.length > 0, "Render script must declare at least one integer state.");
  invariant(handlers.length > 0, "Render script must declare at least one event handler.");
  return deepFreeze({ format: "framer-render-script-v2", states, handlers });
}
