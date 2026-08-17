import { encodeRasterAnimation } from "../../src/render/raster-animation.mjs";
import { encodeWidgetBundle } from "../../src/render/widget-bundle.mjs";
import { WEATHER_WIDGET_CONDITIONS } from "../../src/render-v2/weather.mjs";

import {
  unpackTemperatureAscii,
  WEATHER_MQUICKJS_FRESHNESS,
  WEATHER_MQUICKJS_SLOTS,
} from "./protocol.mjs";

const WEEKDAYS = Object.freeze(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);

function rgb565(red, green, blue) {
  return ((red & 0xf8) << 8) | ((green & 0xfc) << 3) | (blue >>> 3);
}

function fillRect(frame, x, y, width, height, color) {
  for (let row = Math.max(0, y); row < Math.min(310, y + height); row++) {
    const at = row * 100;
    for (let column = Math.max(0, x); column < Math.min(100, x + width); column++) {
      frame[at + column] = color;
    }
  }
}

/** Static dark-sky scaffold. Dynamic text still requires the separately versioned target facade. */
export function createWeatherCanaryRasterBase({ generation }) {
  const frame = new Uint16Array(100 * 310);
  for (let y = 0; y < 310; y++) {
    const ratio = y / 309;
    const red = Math.round(5 + ratio * 3);
    const green = Math.round(18 + ratio * 19);
    const blue = Math.round(32 + ratio * 33);
    fillRect(frame, 0, y, 100, 1, rgb565(red, green, blue));
  }
  fillRect(frame, 7, 62, 86, 80, rgb565(11, 47, 83));
  fillRect(frame, 7, 62, 3, 80, rgb565(42, 132, 218));
  for (const y of [158, 199, 240]) {
    fillRect(frame, 7, y, 86, 35, rgb565(7, 27, 47));
    fillRect(frame, 7, y, 2, 35, rgb565(26, 77, 119));
  }
  fillRect(frame, 7, 292, 86, 1, rgb565(48, 103, 148));
  const animation = encodeRasterAnimation({ frames: [frame], width: 100, height: 310,
    fps: 1, loopDurationMs: 1_000, maxBytes: 128 * 1024 });
  return encodeWidgetBundle({ generation, activeSlot: 0,
    slots: [{ name: "mqjs-weather", kind: "raster", animationBinary: animation.binary }] }).binary;
}

function dayView(slots, metaSlot, lowSlot, highSlot, hasGood, unit) {
  if (!hasGood) return Object.freeze({ weekday: "---", condition: "Waiting", low: "--", high: "--" });
  const meta = slots[metaSlot] >>> 0;
  const weekday = WEEKDAYS[meta & 7] ?? "---";
  const condition = WEATHER_WIDGET_CONDITIONS[(meta >>> 3) & 15]?.dayLabel ?? "Unknown";
  return Object.freeze({ weekday, condition,
    low: `${unpackTemperatureAscii(slots[lowSlot])}°${unit}`,
    high: `${unpackTemperatureAscii(slots[highSlot])}°${unit}` });
}

function ageText(seconds) {
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3_600)}h ago`;
}

export function weatherCanaryViewModel(slotsValue, { location = "Chicago", units = "fahrenheit" } = {}) {
  if (!Array.isArray(slotsValue) || slotsValue.length !== 16 ||
      !slotsValue.every(Number.isInteger)) throw new TypeError("Weather UI requires exactly 16 integer slots.");
  const slots = [...slotsValue];
  const flags = slots[WEATHER_MQUICKJS_SLOTS.flags] >>> 0;
  const hasGood = Boolean(flags & 1);
  const hidden = Boolean(flags & 2);
  const providerError = Boolean(flags & 4);
  const freshness = slots[WEATHER_MQUICKJS_SLOTS.freshness];
  const unit = units === "celsius" ? "C" : "F";
  const currentMeta = slots[WEATHER_MQUICKJS_SLOTS.currentMeta] >>> 0;
  const condition = hasGood ? WEATHER_WIDGET_CONDITIONS[currentMeta & 15] : null;
  const status = freshness === WEATHER_MQUICKJS_FRESHNESS.fresh ? "LIVE"
    : freshness === WEATHER_MQUICKJS_FRESHNESS.stale ? "STALE"
      : freshness === WEATHER_MQUICKJS_FRESHNESS.errorWithLastGood ? "LAST GOOD"
        : freshness === WEATHER_MQUICKJS_FRESHNESS.errorWithoutSnapshot ? "OFFLINE" : "WAITING";
  return Object.freeze({
    appliedRevision: slots[WEATHER_MQUICKJS_SLOTS.appliedRevision],
    location, unit, hidden, hasGood, providerError, status,
    statusColor: freshness === WEATHER_MQUICKJS_FRESHNESS.fresh ? "#55c2ff"
      : providerError ? "#ff9b71" : "#92a9bc",
    current: Object.freeze({
      temperature: hasGood ? `${unpackTemperatureAscii(
        slots[WEATHER_MQUICKJS_SLOTS.currentTemperatureAscii])}°${unit}` : "--",
      condition: condition ? ((currentMeta & 16) ? condition.dayLabel : condition.nightLabel) : "Waiting",
    }),
    age: hasGood ? ageText(slots[WEATHER_MQUICKJS_SLOTS.ageSeconds]) : "No snapshot",
    retry: slots[WEATHER_MQUICKJS_SLOTS.retrySeconds] > 0
      ? `Retry ${slots[WEATHER_MQUICKJS_SLOTS.retrySeconds]}s` : "",
    days: Object.freeze([
      dayView(slots, 3, 4, 5, hasGood, unit),
      dayView(slots, 6, 7, 8, hasGood, unit),
      dayView(slots, 9, 10, 11, hasGood, unit),
    ]),
  });
}

function escapeXml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

/** Host-side golden only; this is not evidence that the physical target facade exists. */
export function renderWeatherCanaryGoldenSvg(view) {
  const dayRows = view.days.map((day, index) => {
    const y = 178 + index * 41;
    return `<text id="d${index + 1}Name" x="12" y="${y}" class="day">${escapeXml(day.weekday)}</text>
  <text id="d${index + 1}Cond" x="12" y="${y + 12}" class="cond">${escapeXml(day.condition)}</text>
  <text id="d${index + 1}Temps" x="88" y="${y + 5}" class="temps">${escapeXml(`${day.low}  ${day.high}`)}</text>`;
  }).join("\n  ");
  const retryHidden = view.retry ? "" : " visibility=\"hidden\"";
  return `<svg id="weatherScreen" xmlns="http://www.w3.org/2000/svg" width="100" height="310" viewBox="0 0 100 310">
  <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#051220"/><stop offset="1" stop-color="#0a2948"/></linearGradient></defs>
  <style>.sans{font-family:Arial,sans-serif}.day{font:700 9px Arial;fill:#eef7ff}.cond{font:7px Arial;fill:#83a5bf}.temps{font:700 8px Arial;fill:#eef7ff;text-anchor:end}</style>
  <rect width="100" height="310" rx="6" fill="url(#sky)"/>
  <text id="place" x="8" y="22" class="sans" font-size="8" font-weight="700" fill="#eef7ff">${escapeXml(view.location.toUpperCase())}</text>
  <text id="status" x="92" y="22" class="sans" font-size="6" text-anchor="end" fill="${view.statusColor}">${escapeXml(view.status)}</text>
  <rect x="7" y="62" width="86" height="80" rx="8" fill="#0b2f53"/><rect x="7" y="62" width="3" height="80" rx="1" fill="#2a84da"/>
  <text id="currentTemp" x="14" y="105" class="sans" font-size="30" font-weight="400" fill="#f5fbff">${escapeXml(view.current.temperature)}</text>
  <text id="currentCond" x="14" y="126" class="sans" font-size="10" fill="#67b9ff">${escapeXml(view.current.condition)}</text>
  <text id="age" x="88" y="137" class="sans" font-size="6" text-anchor="end" fill="#8ca7bc">${escapeXml(view.age)}</text>
  ${dayRows}
  <text id="retry" x="50" y="301" class="sans" font-size="6" text-anchor="middle" fill="#ff9b71"${retryHidden}>${escapeXml(view.retry)}</text>
</svg>
`;
}
