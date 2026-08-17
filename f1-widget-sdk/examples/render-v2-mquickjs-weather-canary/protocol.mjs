import {
  packWeatherCurrent,
  packWeatherDay,
} from "../../src/render-v2/weather.mjs";

export const WEATHER_MQUICKJS_CANARY_FORMAT = "framer-render-v2-mquickjs-weather-canary-v1";

export const WEATHER_MQUICKJS_RPC = Object.freeze({
  begin: 0xb240,
  current: 0xb241,
  days: Object.freeze([0xb242, 0xb243, 0xb244]),
  providerStatus: 0xb24d,
  visibility: 0xb24e,
  commit: 0xb24f,
});

export const WEATHER_MQUICKJS_FRESHNESS = Object.freeze({
  empty: 0,
  fresh: 1,
  stale: 2,
  errorWithLastGood: 3,
  errorWithoutSnapshot: 4,
  staleAfterSeconds: 1_800,
});

export const WEATHER_MQUICKJS_SLOTS = Object.freeze({
  appliedRevision: 0,
  currentTemperatureAscii: 1,
  currentMeta: 2,
  day1Meta: 3,
  day1LowAscii: 4,
  day1HighAscii: 5,
  day2Meta: 6,
  day2LowAscii: 7,
  day2HighAscii: 8,
  day3Meta: 9,
  day3LowAscii: 10,
  day3HighAscii: 11,
  ageSeconds: 12,
  freshness: 13,
  retrySeconds: 14,
  flags: 15,
});

export const WEATHER_MQUICKJS_TARGETS = Object.freeze([
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
]);

function integer(value, minimum, maximum, label) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} must be an integer in ${minimum}..${maximum}.`);
  }
  return value;
}

function normalizedSnapshot(value) {
  if (!value || value.format !== "framer-render-v2-weather-snapshot-v1" ||
      !value.current || !Array.isArray(value.days) || value.days.length !== 3) {
    throw new TypeError("Weather canary requires one normalized current + three-day snapshot.");
  }
  return value;
}

function rpc(id, value, auxiliary = 0) {
  return Object.freeze({ name: `host.rpc:0x${id.toString(16).toUpperCase()}`,
    type: "host.rpc", id, value: value | 0, auxiliary: auxiliary | 0 });
}

export function encodeWeatherCanaryRevision(snapshotValue, { revision } = {}) {
  const snapshot = normalizedSnapshot(snapshotValue);
  integer(revision, 1, 0x7fffffff, "Weather revision");
  return Object.freeze([
    rpc(WEATHER_MQUICKJS_RPC.begin, revision, 0),
    rpc(WEATHER_MQUICKJS_RPC.current, packWeatherCurrent(snapshot.current), revision),
    ...snapshot.days.map((day, index) =>
      rpc(WEATHER_MQUICKJS_RPC.days[index], packWeatherDay(day), revision)),
    rpc(WEATHER_MQUICKJS_RPC.commit, revision, 0b1111),
  ]);
}

export function encodeWeatherProviderStatus({ error = false, retrySeconds = 0 } = {}) {
  integer(retrySeconds, 0, 86_400, "Weather retrySeconds");
  return rpc(WEATHER_MQUICKJS_RPC.providerStatus, error ? 1 : 0, retrySeconds);
}

export function encodeWeatherVisibility({ visible, elapsedSeconds = 0 } = {}) {
  if (typeof visible !== "boolean") throw new TypeError("Weather visibility requires a boolean visible value.");
  integer(elapsedSeconds, 0, 604_800, "Weather hidden elapsedSeconds");
  return rpc(WEATHER_MQUICKJS_RPC.visibility, visible ? 1 : 0, elapsedSeconds);
}

export function unpackTemperatureAscii(value) {
  const bytes = value >>> 0;
  let text = "";
  for (let shift = 0; shift < 32; shift += 8) {
    const byte = (bytes >>> shift) & 0xff;
    if (byte === 0) break;
    if ((byte < 48 || byte > 57) && !(shift === 0 && byte === 45)) {
      throw new TypeError("Temperature glyph word contains non-decimal ASCII.");
    }
    text += String.fromCharCode(byte);
  }
  if (!/^-?\d{1,3}$/u.test(text)) throw new TypeError("Temperature glyph word is invalid.");
  return text;
}

export function requiredWeatherCanaryHostRpcIds() {
  return Object.freeze([
    WEATHER_MQUICKJS_RPC.begin,
    WEATHER_MQUICKJS_RPC.current,
    ...WEATHER_MQUICKJS_RPC.days,
    WEATHER_MQUICKJS_RPC.providerStatus,
    WEATHER_MQUICKJS_RPC.visibility,
    WEATHER_MQUICKJS_RPC.commit,
  ]);
}
