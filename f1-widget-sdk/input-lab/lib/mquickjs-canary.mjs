import {
  normalizeWeatherWidgetConfig,
  packWeatherCurrent,
  packWeatherDay,
  unpackWeatherCurrent,
  unpackWeatherDay,
  WEATHER_WIDGET_CONDITIONS,
} from "../../src/render-v2/weather.mjs";

export const INPUT_LAB_RENDER_V2_BACKENDS = Object.freeze({
  f2ep: "f2ep",
  mquickjs: "mquickjs",
});

export const INPUT_LAB_MQUICKJS_STATUS = "STATIC_OFFLINE_NOT_FLASHABLE";
export const INPUT_LAB_MQUICKJS_PROFILE_ID = "framer-f1-render-v2-mquickjs-v1";
export const INPUT_LAB_MQUICKJS_PACKAGE_FORMAT = "framer-render-v2-mquickjs-package-v1";
export const INPUT_LAB_MQUICKJS_PACKAGE_ABI_SHA256 =
  "5091736403d809078cbbf12a1b593fbabaff53474a0935a7e00ce81dc8bd67f8";
export const INPUT_LAB_MQUICKJS_ENGINE_COMMIT =
  "203d5bb79789bc47b74855d9207415dab71661a0";
export const INPUT_LAB_MQUICKJS_SOURCE_PREFIX = `"use strict";\n`;

export const INPUT_LAB_MQUICKJS_LIMITS = Object.freeze({
  packageBytes: 98_304,
  sourceBytes: 8_192,
  heapBytes: 65_536,
  callbackDeadlineUs: 2_000,
  handlers: 16,
  targets: 16,
  keys: 16,
  chords: 8,
  eventRecords: 32,
});

export const INPUT_LAB_MQUICKJS_DEFAULTS = Object.freeze({
  example: "timer",
  postalCode: "60601",
  countryCode: "US",
  units: "fahrenheit",
});

export const INPUT_LAB_MQUICKJS_EXAMPLE_CONFIG = Object.freeze({
  timer: Object.freeze({
    generation: 1,
    events: Object.freeze({
      tick100: true,
      tick1: true,
      knob: true,
      hostRpcIds: Object.freeze([0x7001]),
      keys: Object.freeze([
        Object.freeze({ id: 0, nativeToken: 0x10203040 }),
        Object.freeze({ id: 1, nativeToken: 0x50607080 }),
      ]),
      chords: Object.freeze([Object.freeze({ id: 0, heldMask: 0b11 })]),
    }),
    targets: Object.freeze([]),
    input: Object.freeze({ debounceMs: 10, holdDelayMs: 500, holdCadenceMs: 100 }),
  }),
  weather: Object.freeze({
    generation: 18,
    events: Object.freeze({
      tick100: false,
      tick1: true,
      knob: false,
      hostRpcIds: Object.freeze([0xb240, 0xb241, 0xb242, 0xb243, 0xb244, 0xb24d, 0xb24e, 0xb24f]),
      keys: Object.freeze([]),
      chords: Object.freeze([]),
    }),
    targets: Object.freeze([
      Object.freeze({ id: "weatherScreen", writes: Object.freeze(["hidden"]) }),
      Object.freeze({ id: "place", writes: Object.freeze(["textContent"]) }),
      Object.freeze({ id: "status", writes: Object.freeze(["textContent", "color"]) }),
      Object.freeze({ id: "currentTemp", writes: Object.freeze(["textContent"]) }),
      Object.freeze({ id: "currentCond", writes: Object.freeze(["textContent", "color"]) }),
      Object.freeze({ id: "age", writes: Object.freeze(["textContent"]) }),
      Object.freeze({ id: "d1Name", writes: Object.freeze(["textContent"]) }),
      Object.freeze({ id: "d1Cond", writes: Object.freeze(["textContent", "color"]) }),
      Object.freeze({ id: "d1Temps", writes: Object.freeze(["textContent"]) }),
      Object.freeze({ id: "d2Name", writes: Object.freeze(["textContent"]) }),
      Object.freeze({ id: "d2Cond", writes: Object.freeze(["textContent", "color"]) }),
      Object.freeze({ id: "d2Temps", writes: Object.freeze(["textContent"]) }),
      Object.freeze({ id: "d3Name", writes: Object.freeze(["textContent"]) }),
      Object.freeze({ id: "d3Cond", writes: Object.freeze(["textContent", "color"]) }),
      Object.freeze({ id: "d3Temps", writes: Object.freeze(["textContent"]) }),
      Object.freeze({ id: "retry", writes: Object.freeze(["textContent", "hidden"]) }),
    ]),
    input: Object.freeze({ debounceMs: 0, holdDelayMs: 0, holdCadenceMs: 0 }),
  }),
});

const EVENT_KIND = Object.freeze({ tick100: 1, tick1: 2, knob: 3, host: 4, key: 5, chord: 6 });
const TARGET_WRITE = Object.freeze({ textContent: 1, color: 2, hidden: 4 });
const HEADER_BYTES = 128;
const EVENT_BYTES = 16;
const TARGET_BYTES = 32;

function invariant(value, message) {
  if (!value) throw new Error(message);
}

function uint(value, maximum, label) {
  invariant(Number.isInteger(value) && value >= 0 && value <= maximum,
    `${label} must be an integer in 0..${maximum}.`);
  return value;
}

function int32(value, label) {
  invariant(Number.isInteger(value) && value >= -0x80000000 && value <= 0x7fffffff,
    `${label} must be a signed int32.`);
  return value | 0;
}

function writeU24(view, offset, value) {
  view.setUint8(offset, value & 0xff);
  view.setUint8(offset + 1, (value >>> 8) & 0xff);
  view.setUint8(offset + 2, (value >>> 16) & 0xff);
}

function readU24(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function ascii(bytes, offset, value) {
  bytes.set(new TextEncoder().encode(value), offset);
}

function strictSource(value) {
  invariant(typeof value === "string" && !value.includes("\0"),
    "MicroQuickJS source must be a NUL-free JavaScript string.");
  const source = value.startsWith(INPUT_LAB_MQUICKJS_SOURCE_PREFIX) ? value :
    `${INPUT_LAB_MQUICKJS_SOURCE_PREFIX}${value}`;
  const bytes = new TextEncoder().encode(source);
  invariant(bytes.length >= INPUT_LAB_MQUICKJS_SOURCE_PREFIX.length &&
    bytes.length <= INPUT_LAB_MQUICKJS_LIMITS.sourceBytes,
  `MicroQuickJS source must fit ${INPUT_LAB_MQUICKJS_LIMITS.sourceBytes} UTF-8 bytes.`);
  return Object.freeze({ source, bytes });
}

async function sha256(bytes) {
  invariant(globalThis.crypto?.subtle, "F2JS compilation requires Web Crypto SHA-256.");
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
  return Object.freeze({ bytes: digest,
    hex: [...digest].map((value) => value.toString(16).padStart(2, "0")).join("") });
}

function encodeEvents(config) {
  const records = [];
  if (config.events.tick100) records.push({ kind: EVENT_KIND.tick100, id: 0, token: 0, mask: 0 });
  if (config.events.tick1) records.push({ kind: EVENT_KIND.tick1, id: 0, token: 0, mask: 0 });
  if (config.events.knob) records.push({ kind: EVENT_KIND.knob, id: 0, token: 0, mask: 0 });
  for (const id of [...config.events.hostRpcIds].sort((a, b) => a - b)) {
    records.push({ kind: EVENT_KIND.host, id: uint(id, 0xffff, "F2JS host RPC ID"), token: 0, mask: 0 });
  }
  config.events.keys.forEach(({ id, nativeToken }, index) => {
    invariant(id === index, "F2JS key IDs must be contiguous.");
    records.push({ kind: EVENT_KIND.key, id, token: uint(nativeToken, 0xffffffff,
      "F2JS native key token"), mask: 0 });
  });
  config.events.chords.forEach(({ id, heldMask }, index) => {
    invariant(id === index, "F2JS chord IDs must be contiguous.");
    records.push({ kind: EVENT_KIND.chord, id, token: 0,
      mask: uint(heldMask, 0xffff, "F2JS chord mask") });
  });
  invariant(records.length <= INPUT_LAB_MQUICKJS_LIMITS.eventRecords,
    "F2JS event record budget exceeded.");
  const bytes = new Uint8Array(records.length * EVENT_BYTES);
  const view = new DataView(bytes.buffer);
  records.forEach((record, index) => {
    const at = index * EVENT_BYTES;
    view.setUint8(at, record.kind);
    view.setUint16(at + 2, record.id, true);
    view.setUint32(at + 4, record.token, true);
    view.setUint16(at + 8, record.mask, true);
  });
  return Object.freeze({ bytes, records: Object.freeze(records) });
}

function encodeTargets(config) {
  invariant(config.targets.length <= INPUT_LAB_MQUICKJS_LIMITS.targets,
    "F2JS target budget exceeded.");
  const bytes = new Uint8Array(config.targets.length * TARGET_BYTES);
  const view = new DataView(bytes.buffer);
  config.targets.forEach((target, index) => {
    invariant(/^[A-Za-z][A-Za-z0-9_-]{0,15}$/u.test(target.id),
      "F2JS target IDs must be 1..16 byte ASCII identifiers.");
    const id = new TextEncoder().encode(target.id);
    let flags = 0;
    for (const write of target.writes) {
      invariant(TARGET_WRITE[write], `Unsupported F2JS target write ${write}.`);
      flags |= TARGET_WRITE[write];
    }
    const at = index * TARGET_BYTES;
    view.setUint16(at, index, true);
    view.setUint16(at + 2, flags, true);
    view.setUint8(at + 4, id.length);
    bytes.set(id, at + 8);
  });
  return bytes;
}

export function normalizeInputLabMQuickJsSettings(value = {}) {
  const example = value.example === "weather" ? "weather" : "timer";
  const countryCode = String(value.countryCode ?? INPUT_LAB_MQUICKJS_DEFAULTS.countryCode)
    .trim().toUpperCase();
  const units = value.units === "celsius" ? "celsius" : "fahrenheit";
  const postalCode = String(value.postalCode ?? INPUT_LAB_MQUICKJS_DEFAULTS.postalCode).trim();
  return Object.freeze({ example, postalCode, countryCode, units });
}

/** Browser-safe F2JS packer. Its output is byte-compared with the frozen SDK packer in tests. */
export async function buildInputLabMQuickJsPackage({ source, example = "timer", rasterBase = null } = {}) {
  invariant(Object.hasOwn(INPUT_LAB_MQUICKJS_EXAMPLE_CONFIG, example),
    "MicroQuickJS example must be timer or weather.");
  const config = INPUT_LAB_MQUICKJS_EXAMPLE_CONFIG[example];
  const canonical = strictSource(source);
  const events = encodeEvents(config);
  const targets = encodeTargets(config);
  const raster = rasterBase == null ? new Uint8Array() : new Uint8Array(rasterBase);
  if (raster.length) {
    invariant(raster.length === 62_404 && new TextDecoder().decode(raster.subarray(0, 4)) === "F1WB",
      "F2JS raster base must be the canonical 62,404-byte F1WB fixture.");
    invariant(new DataView(raster.buffer, raster.byteOffset, raster.byteLength).getUint32(8, true) === config.generation,
      "F2JS raster base generation must match the package generation.");
  }
  const sourceSectionBytes = canonical.bytes.length + 1;
  const eventsAt = HEADER_BYTES;
  const targetsAt = eventsAt + events.bytes.length;
  const sourceAt = targetsAt + targets.length;
  const assetAt = (sourceAt + sourceSectionBytes + 3) & ~3;
  const totalBytes = assetAt + raster.length;
  invariant(totalBytes <= INPUT_LAB_MQUICKJS_LIMITS.packageBytes,
    `F2JS package is ${totalBytes} bytes; cap is ${INPUT_LAB_MQUICKJS_LIMITS.packageBytes}.`);
  const binary = new Uint8Array(totalBytes);
  const view = new DataView(binary.buffer);
  ascii(binary, 0, "F2JS");
  view.setUint16(4, 1, true);
  view.setUint16(6, HEADER_BYTES, true);
  view.setUint32(8, totalBytes, true);
  view.setUint32(12, config.generation, true);
  view.setUint32(16, raster.length ? 1 : 0, true);
  view.setUint32(20, INPUT_LAB_MQUICKJS_LIMITS.heapBytes, true);
  view.setUint32(24, INPUT_LAB_MQUICKJS_LIMITS.callbackDeadlineUs, true);
  view.setUint8(28, events.records.length);
  view.setUint8(29, config.targets.length);
  view.setUint8(30, config.events.keys.length);
  view.setUint8(31, config.events.chords.length);
  view.setUint16(32, config.input.debounceMs, true);
  view.setUint16(34, config.input.holdDelayMs, true);
  view.setUint16(36, config.input.holdCadenceMs, true);
  view.setUint16(38, 4, true);
  for (const [offset, start, length] of [
    [40, eventsAt, events.bytes.length],
    [46, targetsAt, targets.length],
    [52, sourceAt, sourceSectionBytes],
    [58, assetAt, raster.length],
  ]) {
    writeU24(view, offset, start);
    writeU24(view, offset + 3, length);
  }
  binary.set(events.bytes, eventsAt);
  binary.set(targets, targetsAt);
  binary.set(canonical.bytes, sourceAt);
  binary.set(raster, assetAt);
  const sourceDigest = await sha256(canonical.bytes);
  binary.set(sourceDigest.bytes, 64);
  const bodyDigest = await sha256(binary.subarray(HEADER_BYTES));
  binary.set(bodyDigest.bytes, 96);
  const packageDigest = await sha256(binary);
  return Object.freeze({
    format: INPUT_LAB_MQUICKJS_PACKAGE_FORMAT,
    profileId: INPUT_LAB_MQUICKJS_PROFILE_ID,
    generation: config.generation,
    source: canonical.source,
    sourceSha256: sourceDigest.hex,
    bodySha256: bodyDigest.hex,
    sha256: packageDigest.hex,
    bytes: binary.length,
    binary,
    budget: Object.freeze({
      packageBytes: binary.length,
      packageHeadroomBytes: INPUT_LAB_MQUICKJS_LIMITS.packageBytes - binary.length,
      sourceBytes: canonical.bytes.length,
      sourceHeadroomBytes: INPUT_LAB_MQUICKJS_LIMITS.sourceBytes - canonical.bytes.length,
      heapBytes: INPUT_LAB_MQUICKJS_LIMITS.heapBytes,
      handlers: events.records.length,
      handlerHeadroom: INPUT_LAB_MQUICKJS_LIMITS.handlers - events.records.length,
      targets: config.targets.length,
      targetHeadroom: INPUT_LAB_MQUICKJS_LIMITS.targets - config.targets.length,
      keys: config.events.keys.length,
      keyHeadroom: INPUT_LAB_MQUICKJS_LIMITS.keys - config.events.keys.length,
      chords: config.events.chords.length,
      chordHeadroom: INPUT_LAB_MQUICKJS_LIMITS.chords - config.events.chords.length,
      rasterBaseBytes: raster.length,
    }),
  });
}

export function extractInputLabMQuickJsRasterBase(value) {
  const binary = new Uint8Array(value);
  invariant(binary.length >= HEADER_BYTES && new TextDecoder().decode(binary.subarray(0, 4)) === "F2JS",
    "Expected an F2JS package fixture.");
  const offset = readU24(binary, 58);
  const length = readU24(binary, 61);
  invariant(length === 62_404 && offset + length === binary.length,
    "F2JS fixture does not contain one canonical raster base.");
  return binary.slice(offset, offset + length);
}

const REQUIRED_CAPABILITY = Object.freeze({
  renderV2Profile: INPUT_LAB_MQUICKJS_PROFILE_ID,
  packageFormat: INPUT_LAB_MQUICKJS_PACKAGE_FORMAT,
  packageAbiSha256: INPUT_LAB_MQUICKJS_PACKAGE_ABI_SHA256,
  engine: "MicroQuickJS",
  engineCommit: INPUT_LAB_MQUICKJS_ENGINE_COMMIT,
  javascriptProfile: "mquickjs-es5-strict-v1",
  deviceEvaluatesJavaScript: true,
  deviceRunsJsdom: false,
  maxPackageBytes: String(INPUT_LAB_MQUICKJS_LIMITS.packageBytes),
  maxSourceBytes: String(INPUT_LAB_MQUICKJS_LIMITS.sourceBytes),
  heapBytes: String(INPUT_LAB_MQUICKJS_LIMITS.heapBytes),
  callbackDeadlineUs: String(INPUT_LAB_MQUICKJS_LIMITS.callbackDeadlineUs),
  maxHandlers: String(INPUT_LAB_MQUICKJS_LIMITS.handlers),
  maxTargets: String(INPUT_LAB_MQUICKJS_LIMITS.targets),
  maxKeys: String(INPUT_LAB_MQUICKJS_LIMITS.keys),
  maxChords: String(INPUT_LAB_MQUICKJS_LIMITS.chords),
});

export function assessInputLabMQuickJsCapability(value) {
  const errors = [];
  for (const [field, expected] of Object.entries(REQUIRED_CAPABILITY)) {
    if (value?.[field] !== expected) errors.push(`${field} must equal ${JSON.stringify(expected)}.`);
  }
  if (value?.screenId !== 28) errors.push("screenId must equal 28.");
  if (value?.physicalCanary !== true) errors.push("physicalCanary must equal true.");
  if (value?.hardwareRuntimeProven !== false) {
    errors.push("Initial canary hardwareRuntimeProven must equal false; the external soak receipt promotes proof.");
  }
  if (value?.runtimeUploader !== false) errors.push("Initial canary runtimeUploader must equal false.");
  return Object.freeze({ compatible: errors.length === 0,
    profileId: INPUT_LAB_MQUICKJS_PROFILE_ID, errors: Object.freeze(errors) });
}

export function assessInputLabMQuickJsPushGate({ capability = null, uploader = null } = {}) {
  const assessment = assessInputLabMQuickJsCapability(capability);
  const uploaderDescriptorValid = uploader?.kind === "browser-mquickjs-f2js-v1" &&
    uploader?.packageFormat === INPUT_LAB_MQUICKJS_PACKAGE_FORMAT && uploader?.provenSafe === true;
  const safeUploader = uploaderDescriptorValid && capability?.runtimeUploader === true;
  const errors = [...assessment.errors];
  errors.push("Package Push is blocked: the boot-lifetime physical canary advertises runtimeUploader=false.");
  return Object.freeze({ allowed: false,
    capabilityCompatible: assessment.compatible, safeUploader,
    errors: Object.freeze(errors),
    reason: errors[0] });
}

const WEATHER_RPC = Object.freeze({ begin: 0xb240, current: 0xb241,
  days: Object.freeze([0xb242, 0xb243, 0xb244]), providerStatus: 0xb24d,
  visibility: 0xb24e, commit: 0xb24f });
const WEEKDAYS = Object.freeze(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);

export function createInputLabDeterministicWeatherSnapshot(value = {}) {
  const config = normalizeWeatherWidgetConfig({ postalCode: value.postalCode ?? "60601",
    countryCode: value.countryCode ?? "US", units: value.units ?? "fahrenheit",
    refreshMinutes: 30 });
  const digits = [...config.postalCode].filter((character) => /\d/u.test(character)).map(Number);
  const seed = digits.reduce((sum, digit) => sum + digit, 0);
  const current = 32 + seed;
  const places = Object.freeze({ "60601": "Chicago", "00501": "Holtsville", "10001": "New York" });
  const condition = (id) => Object.freeze({ ...WEATHER_WIDGET_CONDITIONS[id], isDay: true,
    label: WEATHER_WIDGET_CONDITIONS[id].dayLabel });
  return Object.freeze({
    format: "framer-render-v2-weather-snapshot-v1",
    config,
    location: Object.freeze({ name: places[config.postalCode] ?? `ZIP ${config.postalCode}` }),
    current: Object.freeze({ temperature: current, condition: condition(seed % 8) }),
    days: Object.freeze([0, 1, 2].map((index) => Object.freeze({
      weekdayId: (2 + index) % 7,
      weekday: WEEKDAYS[(2 + index) % 7],
      low: current - 11 + index * 2,
      high: current - 2 + index * 3,
      condition: condition((seed + index + 1) % 8),
    }))),
  });
}

export function createInputLabWeatherRpcBatch(snapshot, revision) {
  uint(revision, 0x7fffffff, "Weather revision");
  invariant(revision > 0, "Weather revision zero is reserved.");
  return Object.freeze([
    Object.freeze({ type: "host.rpc", id: WEATHER_RPC.begin, value: revision, auxiliary: 0 }),
    Object.freeze({ type: "host.rpc", id: WEATHER_RPC.current,
      value: packWeatherCurrent(snapshot.current), auxiliary: revision }),
    ...snapshot.days.map((day, index) => Object.freeze({ type: "host.rpc", id: WEATHER_RPC.days[index],
      value: packWeatherDay(day), auxiliary: revision })),
    Object.freeze({ type: "host.rpc", id: WEATHER_RPC.commit, value: revision, auxiliary: 15 }),
  ]);
}

export class InputLabMQuickJsCanarySession {
  constructor(settings = {}) {
    this.settings = normalizeInputLabMQuickJsSettings(settings);
    this.eventCount = 0;
    this.lastEvent = "ready";
    this.timer = { seconds: 300, running: 0, dialTurns: 0, reason: 0, subticks: 0 };
    this.weather = { revision: 0, snapshot: null, ageSeconds: 0, hidden: false,
      providerError: false, retrySeconds: 0, stage: null };
  }

  dispatch(value = {}) {
    const event = Object.freeze({ type: String(value.type ?? value.kind ?? ""),
      id: value.id == null ? 0 : uint(value.id, 0xffff, "Event ID"),
      value: value.value == null ? 0 : int32(value.value, "Event value"),
      auxiliary: value.auxiliary == null ? 0 : int32(value.auxiliary, "Event auxiliary"),
      delta: value.delta == null ? (value.value ?? 0) : int32(value.delta, "Knob delta"),
      key: value.key == null ? -1 : uint(value.key, 15, "Key ID"),
      chord: value.chord == null ? -1 : uint(value.chord, 7, "Chord ID"),
      heldMask: value.heldMask == null ? 0 : uint(value.heldMask, 0xffff, "Held mask"),
      holdCount: value.holdCount == null ? 0 : uint(value.holdCount, 0xffff, "Hold count"),
    });
    this.eventCount++;
    this.lastEvent = event.type === "host.rpc" ? `host.rpc:0x${event.id.toString(16).toUpperCase()}` : event.type;
    if (this.settings.example === "weather") this.#weather(event);
    else this.#timer(event);
    return this.snapshot();
  }

  refreshWeather() {
    invariant(this.settings.example === "weather", "Weather refresh requires the weather example.");
    const snapshot = createInputLabDeterministicWeatherSnapshot(this.settings);
    const revision = this.weather.revision + 1;
    for (const event of createInputLabWeatherRpcBatch(snapshot, revision)) this.dispatch(event);
    return this.snapshot();
  }

  #timer(event) {
    const state = this.timer;
    if (event.type === "tick.100ms") state.subticks = (state.subticks + 1) % 10;
    else if (event.type === "tick.1s" && state.running && state.seconds > 0) {
      state.seconds--;
      if (state.seconds === 0) state.running = 0;
      state.reason = 1;
    } else if (event.type === "input.fn-bottom-knob") {
      const step = event.heldMask & 1 ? 60 : 5;
      state.seconds = Math.max(0, Math.min(359_999, state.seconds + event.delta * step));
      state.dialTurns += event.delta;
      state.reason = 2;
    } else if (event.type === "input.key.down" && event.key === 1) {
      state.running = state.running ? 0 : 1;
      state.reason = 3;
    } else if (event.type === "input.key.hold" && event.key === 1 && event.holdCount === 1) {
      state.seconds = 300;
      state.running = 0;
      state.reason = 4;
    } else if (event.type === "input.chord.down" && event.chord === 0) {
      state.seconds = 0;
      state.running = 0;
      state.reason = 5;
    } else if (event.type === "host.rpc" && event.id === 0x7001) {
      state.seconds = Math.max(0, Math.min(359_999, event.value));
      state.running = event.auxiliary ? 1 : 0;
      state.reason = 6;
    }
  }

  #weather(event) {
    const state = this.weather;
    if (event.type === "tick.1s" && !state.hidden) {
      if (state.snapshot && state.ageSeconds < 604_800) state.ageSeconds++;
      if (state.retrySeconds > 0) state.retrySeconds--;
      return;
    }
    if (event.type !== "host.rpc") return;
    if (event.id === WEATHER_RPC.begin) {
      if (event.value > state.revision) state.stage = { revision: event.value, current: null,
        days: [null, null, null], mask: 0, invalid: false };
      return;
    }
    if (event.id === WEATHER_RPC.providerStatus) {
      state.providerError = Boolean(event.value);
      state.retrySeconds = Math.max(0, event.auxiliary);
      return;
    }
    if (event.id === WEATHER_RPC.visibility) {
      state.hidden = !event.value;
      if (!state.hidden) state.ageSeconds = Math.min(604_800,
        state.ageSeconds + Math.max(0, event.auxiliary));
      return;
    }
    const stage = state.stage;
    if (!stage) return;
    const index = WEATHER_RPC.days.indexOf(event.id);
    if (event.id === WEATHER_RPC.current || index >= 0) {
      if (event.auxiliary !== stage.revision) return;
      const bit = event.id === WEATHER_RPC.current ? 1 : 2 << index;
      const previous = event.id === WEATHER_RPC.current ? stage.current : stage.days[index];
      if (stage.mask & bit) stage.invalid ||= previous !== event.value;
      else {
        if (event.id === WEATHER_RPC.current) stage.current = event.value;
        else stage.days[index] = event.value;
        stage.mask |= bit;
      }
      return;
    }
    if (event.id === WEATHER_RPC.commit && event.value === stage.revision && event.auxiliary === 15) {
      if (!stage.invalid && stage.mask === 15) {
        state.snapshot = Object.freeze({ current: unpackWeatherCurrent(stage.current),
          days: Object.freeze(stage.days.map(unpackWeatherDay)) });
        state.revision = stage.revision;
        state.ageSeconds = 0;
        state.providerError = false;
        state.retrySeconds = 0;
      }
      state.stage = null;
    }
  }

  snapshot() {
    if (this.settings.example === "timer") return Object.freeze({ example: "timer",
      eventCount: this.eventCount, lastEvent: this.lastEvent, ...this.timer });
    const value = this.weather;
    const unit = this.settings.units === "celsius" ? "C" : "F";
    const currentCondition = value.snapshot ? WEATHER_WIDGET_CONDITIONS[value.snapshot.current.conditionId] : null;
    return Object.freeze({ example: "weather", eventCount: this.eventCount, lastEvent: this.lastEvent,
      revision: value.revision, location: createInputLabDeterministicWeatherSnapshot(this.settings).location.name,
      unit, temperature: value.snapshot ? `${value.snapshot.current.temperature}\u00b0${unit}` : "--",
      condition: currentCondition?.dayLabel ?? "Waiting", ageSeconds: value.ageSeconds,
      hidden: value.hidden, providerError: value.providerError, retrySeconds: value.retrySeconds,
      days: Object.freeze((value.snapshot?.days ?? []).map((day) => Object.freeze({
        weekday: day.weekday, condition: WEATHER_WIDGET_CONDITIONS[day.conditionId].dayLabel,
        low: day.low, high: day.high,
      }))),
    });
  }
}

export function drawInputLabMQuickJsPreview(canvas, snapshot) {
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, 100, 310);
  context.textBaseline = "alphabetic";
  if (snapshot.example === "weather") {
    const sky = context.createLinearGradient(0, 0, 0, 310);
    sky.addColorStop(0, "#051220");
    sky.addColorStop(1, "#0a2948");
    context.fillStyle = sky;
    context.fillRect(0, 0, 100, 310);
    context.fillStyle = "#eef7ff";
    context.font = "bold 8px sans-serif";
    context.fillText(snapshot.location.toUpperCase().slice(0, 15), 8, 22);
    context.fillStyle = snapshot.providerError ? "#ff9b71" : "#55c2ff";
    context.font = "6px sans-serif";
    context.textAlign = "right";
    context.fillText(snapshot.providerError ? "LAST GOOD" : snapshot.revision ? "OFFLINE FIXTURE" : "WAITING", 92, 22);
    context.textAlign = "left";
    context.fillStyle = "#0b2f53";
    context.fillRect(7, 62, 86, 80);
    context.fillStyle = "#2a84da";
    context.fillRect(7, 62, 3, 80);
    context.fillStyle = "#f5fbff";
    context.font = "30px sans-serif";
    context.fillText(snapshot.temperature, 14, 106);
    context.fillStyle = "#67b9ff";
    context.font = "10px sans-serif";
    context.fillText(snapshot.condition, 14, 127);
    context.fillStyle = "#8ca7bc";
    context.font = "6px sans-serif";
    context.textAlign = "right";
    context.fillText(snapshot.revision ? `${snapshot.ageSeconds}s ago` : "No snapshot", 88, 137);
    snapshot.days.forEach((day, index) => {
      const y = 158 + index * 41;
      context.fillStyle = "#071b2f";
      context.fillRect(7, y, 86, 35);
      context.fillStyle = "#eef7ff";
      context.textAlign = "left";
      context.font = "bold 9px sans-serif";
      context.fillText(day.weekday, 12, y + 17);
      context.fillStyle = "#83a5bf";
      context.font = "7px sans-serif";
      context.fillText(day.condition, 12, y + 29);
      context.fillStyle = "#eef7ff";
      context.textAlign = "right";
      context.font = "bold 8px sans-serif";
      context.fillText(`${day.low}\u00b0  ${day.high}\u00b0`, 88, y + 21);
    });
    context.textAlign = "left";
    return;
  }

  context.fillStyle = "#030303";
  context.fillRect(0, 0, 100, 310);
  const dial = context.createRadialGradient(50, 244, 12, 50, 244, 88);
  dial.addColorStop(0, "#35140a");
  dial.addColorStop(0.55, "#a73913");
  dial.addColorStop(1, "#ef5216");
  context.fillStyle = dial;
  context.beginPath();
  context.arc(50, 258, 78, Math.PI, 0);
  context.fill();
  const minutes = Math.floor(snapshot.seconds / 60);
  const seconds = snapshot.seconds % 60;
  context.fillStyle = "#f5f5f4";
  context.textAlign = "center";
  context.font = "30px monospace";
  context.fillText(`${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`, 50, 91);
  context.fillStyle = "#a8a29e";
  context.font = "8px sans-serif";
  context.fillText(snapshot.running ? "running" : "timer", 50, 122);
  const angle = -0.75 + (snapshot.dialTurns % 20) / 20 * 1.5;
  context.save();
  context.translate(50, 225);
  context.rotate(angle);
  context.fillStyle = "#171717";
  context.fillRect(-1, -40, 2, 17);
  context.restore();
  context.fillStyle = "#f5f5f4";
  context.font = "8px sans-serif";
  context.fillText(snapshot.lastEvent, 50, 286);
  context.textAlign = "left";
}
