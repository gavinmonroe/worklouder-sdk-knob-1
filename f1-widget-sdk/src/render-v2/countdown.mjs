const WIDTH = 100;
const HEIGHT = 310;
const PIXELS = WIDTH * HEIGHT;
const STATE_FORMAT = "framer-render-v2-countdown-state-v1";

export const COUNTDOWN_HOST_EVENTS = Object.freeze({
  chordLevel: 0xb210,
  configure: 0xb211,
});

export const COUNTDOWN_INPUT_CAPABILITIES = Object.freeze({
  accepted: Object.freeze({
    bottomEncoder: Object.freeze({ id: 1, controllerVtableSlot: 9,
      delta: "signed low int8", scope: "active screen" }),
    fnLevel: Object.freeze({ inputGetter: "0x4200c4c0", fnPressedGetter: "0x4210bfac",
      provenContext: "bottom-encoder callback" }),
  }),
  staticGolden: Object.freeze({
    tick1s: "Render-v2 synthesizes one tick after ten 100-ms UI ticks.",
    hostRpc: Object.freeze({ method: "widget.v2.event", acceptedEventId: 0xb201,
      shape: Object.freeze({ id: "uint16", value: "int32" }) }),
  }),
  notYetProven: Object.freeze({
    arbitraryKeyIdentity: "The experimental stock-first key hook proved only an any-key pressed bit.",
    arbitraryKeyRelease: "No accepted callback-field ABI currently identifies release for a configured key.",
    fnReleasePolling: "Calling the accepted Fn getter from the 100-ms UI tick needs a physical canary.",
    countdownRpc: "IDs 0xB210/0xB211 require an exact RPC allowlist/native extension.",
  }),
});

function invariant(value, message) {
  if (!value) throw new Error(message);
}

function integer(value, minimum, maximum, label) {
  invariant(Number.isInteger(value) && value >= minimum && value <= maximum,
    `${label} must be an integer in ${minimum}..${maximum}.`);
  return value;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function canonicalChord(value) {
  const tokens = Array.isArray(value) ? value : String(value ?? "fn").split("+");
  const normalized = [...new Set(tokens.map((token) => String(token).trim().toLowerCase()).filter(Boolean))].sort();
  invariant(normalized.length >= 1 && normalized.length <= 4 &&
    normalized.every((token) => /^[a-z0-9_-]{1,24}$/u.test(token)),
  "Countdown chord must contain one to four simple key names.");
  return normalized.join("+");
}

export function normalizeCountdownConfig(value = {}) {
  invariant(value && typeof value === "object" && !Array.isArray(value),
    "Countdown config must be an object.");
  const maxSeconds = integer(value.maxSeconds ?? 99 * 60 + 59, 1, 99 * 60 + 59,
    "Countdown maxSeconds");
  const stepSeconds = integer(value.stepSeconds ?? 60, 1, maxSeconds, "Countdown stepSeconds");
  const presetSeconds = integer(value.presetSeconds ?? 0, 0, maxSeconds, "Countdown presetSeconds");
  return Object.freeze({ format: "framer-render-v2-countdown-config-v1",
    chord: canonicalChord(value.chord), encoderId: integer(value.encoderId ?? 1, 0, 0xffff,
      "Countdown encoderId"), stepSeconds, maxSeconds, presetSeconds });
}

function freezeState(value) {
  return Object.freeze({ format: STATE_FORMAT, phase: value.phase,
    chordHeld: value.chordHeld === true, draftSeconds: value.draftSeconds,
    remainingSeconds: value.remainingSeconds, initialSeconds: value.initialSeconds,
    revision: value.revision, elapsedTicks: value.elapsedTicks });
}

export function createCountdownState(configValue = {}) {
  const config = normalizeCountdownConfig(configValue);
  return freezeState({ phase: "idle", chordHeld: false, draftSeconds: config.presetSeconds,
    remainingSeconds: config.presetSeconds, initialSeconds: config.presetSeconds,
    revision: 0, elapsedTicks: 0 });
}

function validateState(state, config) {
  invariant(state?.format === STATE_FORMAT &&
    ["idle", "editing", "running", "finished"].includes(state.phase) &&
    typeof state.chordHeld === "boolean", "Countdown state is invalid.");
  for (const name of ["draftSeconds", "remainingSeconds", "initialSeconds"]) {
    integer(state[name], 0, config.maxSeconds, `Countdown state ${name}`);
  }
  integer(state.revision, 0, 0xffffffff, "Countdown state revision");
  integer(state.elapsedTicks, 0, 0xffffffff, "Countdown state elapsedTicks");
  invariant((state.phase === "editing") === state.chordHeld,
    "Countdown editing and chord-held state diverged.");
}

export function signedCountdownEncoderDelta(value) {
  integer(value, -128, 255, "Countdown encoder delta");
  const byte = value & 0xff;
  return byte >= 0x80 ? byte - 0x100 : byte;
}

function outcome(state, consumed, reason) {
  return Object.freeze({ state, consumed, reason });
}

/** Pure state reducer shared by the host preview and a future bounded native implementation. */
export function reduceCountdown(state, event, configValue = {}) {
  const config = normalizeCountdownConfig(configValue);
  validateState(state, config);
  invariant(event && typeof event === "object" && !Array.isArray(event),
    "Countdown event must be an object.");
  if (event.kind === "chord") {
    if (canonicalChord(event.chord) !== config.chord) return outcome(state, false, "other-chord");
    invariant(typeof event.pressed === "boolean", "Countdown chord pressed must be boolean.");
    if (event.pressed) {
      if (state.chordHeld) return outcome(state, true, "duplicate-down");
      const draft = state.phase === "running" ? state.remainingSeconds : state.draftSeconds;
      return outcome(freezeState({ ...state, phase: "editing", chordHeld: true,
        draftSeconds: draft, revision: state.revision + 1 }), true, "editing");
    }
    if (!state.chordHeld) return outcome(state, false, "release-without-hold");
    const seconds = state.draftSeconds;
    return outcome(freezeState({ ...state, phase: seconds === 0 ? "idle" : "running",
      chordHeld: false, remainingSeconds: seconds, initialSeconds: seconds,
      revision: state.revision + 1 }), true, seconds === 0 ? "cleared" : "started");
  }
  if (event.kind === "encoder") {
    integer(event.encoderId, 0, 0xffff, "Countdown encoder ID");
    const delta = signedCountdownEncoderDelta(event.delta);
    if (event.encoderId !== config.encoderId || delta === 0) return outcome(state, false, "other-encoder");
    if (!state.chordHeld || state.phase !== "editing") return outcome(state, false, "chord-not-held");
    const draftSeconds = clamp(state.draftSeconds + delta * config.stepSeconds, 0, config.maxSeconds);
    if (draftSeconds === state.draftSeconds) return outcome(state, true, "limit");
    return outcome(freezeState({ ...state, draftSeconds, revision: state.revision + 1 }),
      true, "adjusted");
  }
  if (event.kind === "tick.1s") {
    if (state.phase !== "running") return outcome(state, false,
      state.phase === "editing" ? "paused-for-edit" : "not-running");
    const remainingSeconds = Math.max(0, state.remainingSeconds - 1);
    return outcome(freezeState({ ...state, remainingSeconds,
      phase: remainingSeconds === 0 ? "finished" : "running",
      revision: state.revision + 1, elapsedTicks: state.elapsedTicks + 1 }), true,
    remainingSeconds === 0 ? "finished" : "ticked");
  }
  return outcome(state, false, "unsupported-event");
}

export function formatCountdown(seconds) {
  integer(seconds, 0, 99 * 60 + 59, "Countdown display seconds");
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function countdownViewModel(state, configValue = {}) {
  const config = normalizeCountdownConfig(configValue);
  validateState(state, config);
  const seconds = state.phase === "editing" ? state.draftSeconds : state.remainingSeconds;
  const denominator = state.phase === "editing" || state.phase === "idle" ? config.maxSeconds :
    Math.max(1, state.initialSeconds);
  const progress = clamp(seconds / denominator, 0, 1);
  const status = Object.freeze({ idle: "HOLD CHORD + TURN", editing: "RELEASE TO START",
    running: "RUNNING", finished: "DONE" })[state.phase];
  return Object.freeze({ display: formatCountdown(seconds), seconds, phase: state.phase, status,
    progress, needleDegrees: -72 + progress * 144, chord: config.chord,
    chordHeld: state.chordHeld });
}

function rgb565(red, green, blue) {
  return ((clamp(Math.round(red), 0, 255) >>> 3) << 11) |
    ((clamp(Math.round(green), 0, 255) >>> 2) << 5) |
    (clamp(Math.round(blue), 0, 255) >>> 3);
}

function put(frame, x, y, color) {
  if (x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT) frame[y * WIDTH + x] = color;
}

function rectangle(frame, x, y, width, height, color) {
  for (let row = 0; row < height; row += 1) for (let column = 0; column < width; column += 1) {
    put(frame, x + column, y + row, color);
  }
}

function line(frame, x0, y0, x1, y1, color, thickness = 1) {
  const dx = Math.abs(x1 - x0); const sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0); const sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  for (;;) {
    const radius = Math.floor(thickness / 2);
    for (let y = -radius; y <= radius; y += 1) for (let x = -radius; x <= radius; x += 1) {
      put(frame, x0 + x, y0 + y, color);
    }
    if (x0 === x1 && y0 === y1) break;
    const twice = 2 * error;
    if (twice >= dy) { error += dy; x0 += sx; }
    if (twice <= dx) { error += dx; y0 += sy; }
  }
}

const DIGIT_SEGMENTS = Object.freeze([
  [0, 1, 2, 4, 5, 6], [2, 5], [0, 2, 3, 4, 6], [0, 2, 3, 5, 6],
  [1, 2, 3, 5], [0, 1, 3, 5, 6], [0, 1, 3, 4, 5, 6], [0, 2, 5],
  [0, 1, 2, 3, 4, 5, 6], [0, 1, 2, 3, 5, 6],
]);

const LABEL_GLYPHS = Object.freeze({
  " ": [0, 0, 0, 0, 0], "+": [0, 2, 7, 2, 0],
  A: [2, 5, 7, 5, 5], C: [3, 4, 4, 4, 3], D: [6, 5, 5, 5, 6],
  E: [7, 4, 6, 4, 7], G: [3, 4, 5, 5, 3], H: [5, 5, 7, 5, 5],
  I: [7, 2, 2, 2, 7], L: [4, 4, 4, 4, 7], N: [5, 7, 7, 7, 5],
  O: [2, 5, 5, 5, 2], R: [6, 5, 6, 5, 5], S: [3, 4, 2, 1, 6],
  T: [7, 2, 2, 2, 2], U: [5, 5, 5, 5, 7], V: [5, 5, 5, 5, 2],
});

function label(frame, text, y, color) {
  const normalized = text.toUpperCase();
  invariant([...normalized].every((character) => LABEL_GLYPHS[character]),
    "Countdown status contains an unsupported label glyph.");
  const width = normalized.length * 4 - 1;
  const startX = Math.floor((WIDTH - width) / 2);
  for (const [characterIndex, character] of [...normalized].entries()) {
    const rows = LABEL_GLYPHS[character];
    for (let row = 0; row < rows.length; row += 1) for (let column = 0; column < 3; column += 1) {
      if ((rows[row] & (1 << (2 - column))) !== 0) put(frame, startX + characterIndex * 4 + column,
        y + row, color);
    }
  }
}

function digit(frame, character, x, y, color) {
  const segments = DIGIT_SEGMENTS[Number(character)];
  invariant(segments, "Countdown renderer received a non-digit.");
  const horizontal = (top) => rectangle(frame, x + 3, y + top, 12, 3, color);
  const vertical = (left, top) => rectangle(frame, x + left, y + top, 3, 13, color);
  for (const segment of segments) {
    if (segment === 0) horizontal(0);
    else if (segment === 1) vertical(0, 2);
    else if (segment === 2) vertical(15, 2);
    else if (segment === 3) horizontal(15);
    else if (segment === 4) vertical(0, 17);
    else if (segment === 5) vertical(15, 17);
    else horizontal(30);
  }
}

/** Deterministic 100x310 RGB565 preview for the blue/black countdown dial. */
export function renderCountdownRgb565(state, configValue = {}) {
  const view = countdownViewModel(state, configValue);
  const frame = new Uint16Array(PIXELS);
  const white = rgb565(242, 246, 255);
  const dim = rgb565(45, 55, 78);
  const blue = rgb565(32, 102, 255);
  rectangle(frame, 0, 0, WIDTH, HEIGHT, rgb565(2, 4, 10));
  rectangle(frame, 7, 22, view.phase === "running" ? 28 : 18, 2,
    view.phase === "finished" ? white : blue);
  const display = view.display;
  digit(frame, display[0], 2, 62, white); digit(frame, display[1], 23, 62, white);
  rectangle(frame, 46, 72, 3, 3, white); rectangle(frame, 46, 84, 3, 3, white);
  digit(frame, display[3], 53, 62, white); digit(frame, display[4], 74, 62, white);
  label(frame, view.status, 124, view.phase === "editing" || view.phase === "finished" ? white : blue);

  const centerX = 50; const centerY = 270; const radius = 94;
  for (let y = 150; y < HEIGHT; y += 1) for (let x = 0; x < WIDTH; x += 1) {
    const dx = x - centerX; const dy = y - centerY; const distance = Math.hypot(dx, dy);
    if (distance >= radius) continue;
    const radial = 1 - distance / radius;
    const upper = clamp((centerY - y + 25) / 110, 0, 1);
    const glow = Math.pow(radial, 0.62) * (0.25 + upper * 0.95);
    frame[y * WIDTH + x] = rgb565(5 + 18 * glow, 15 + 78 * glow, 35 + 220 * glow);
  }
  for (let index = 0; index < 11; index += 1) {
    const angle = (-72 + index * 14.4) * Math.PI / 180;
    const outer = 79; const inner = index % 5 === 0 ? 70 : 73;
    line(frame, Math.round(centerX + Math.sin(angle) * inner),
      Math.round(centerY - Math.cos(angle) * inner),
      Math.round(centerX + Math.sin(angle) * outer),
      Math.round(centerY - Math.cos(angle) * outer), dim, 1);
  }
  const angle = view.needleDegrees * Math.PI / 180;
  line(frame, Math.round(centerX + Math.sin(angle) * 34),
    Math.round(centerY - Math.cos(angle) * 34),
    Math.round(centerX + Math.sin(angle) * 73),
    Math.round(centerY - Math.cos(angle) * 73), white, 3);
  return frame;
}

export function countdownFrameBytes(frame) {
  invariant(frame instanceof Uint16Array && frame.length === PIXELS,
    "Countdown frame must be an exact 100x310 Uint16Array.");
  const output = Buffer.alloc(PIXELS * 2);
  frame.forEach((color, index) => output.writeUInt16LE(color, index * 2));
  return output;
}

/** Future host bridge envelope; the current accepted RPC intentionally rejects 0xB210. */
export function encodeCountdownHostChord(pressed) {
  invariant(typeof pressed === "boolean", "Countdown host chord level must be boolean.");
  return Object.freeze({ method: "widget.v2.event",
    params: Object.freeze({ id: COUNTDOWN_HOST_EVENTS.chordLevel, value: pressed ? 1 : 0 }) });
}
