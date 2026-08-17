const WEATHER_CONFIG_FORMAT = "framer-render-v2-weather-config-v1";
const WEATHER_SNAPSHOT_FORMAT = "framer-render-v2-weather-snapshot-v1";

export const WEATHER_WIDGET_UNITS = Object.freeze(["fahrenheit", "celsius"]);

export const WEATHER_WIDGET_CONDITIONS = Object.freeze([
  Object.freeze({ id: 0, key: "clear", dayLabel: "Sunny", nightLabel: "Clear" }),
  Object.freeze({ id: 1, key: "partly-cloudy", dayLabel: "Partly", nightLabel: "Partly" }),
  Object.freeze({ id: 2, key: "cloudy", dayLabel: "Cloudy", nightLabel: "Cloudy" }),
  Object.freeze({ id: 3, key: "fog", dayLabel: "Fog", nightLabel: "Fog" }),
  Object.freeze({ id: 4, key: "drizzle", dayLabel: "Drizzle", nightLabel: "Drizzle" }),
  Object.freeze({ id: 5, key: "rain", dayLabel: "Rain", nightLabel: "Rain" }),
  Object.freeze({ id: 6, key: "snow", dayLabel: "Snow", nightLabel: "Snow" }),
  Object.freeze({ id: 7, key: "storm", dayLabel: "Storm", nightLabel: "Storm" }),
]);

export const WEATHER_WIDGET_HOST_EVENTS = Object.freeze({
  begin: 0xb240,
  current: 0xb241,
  days: Object.freeze([0xb242, 0xb243, 0xb244]),
  commit: 0xb24f,
});

export const WEATHER_WIDGET_EDGE_REQUIREMENTS = Object.freeze({
  profile: "framer-render-v2-weather-snapshot-v1",
  currentF2epV1Compatible: false,
  recordsPerSnapshot: 6,
  fitsCurrentQueueWhenEmpty: true,
  observedPresentInGenericFirmware: Object.freeze(["arbitrary-advertised-host-rpc-ids"]),
  required: Object.freeze([
    "arbitrary-advertised-host-rpc-ids",
    "staged-host-snapshot-with-revision-commit",
    "int32-bitfield-decode",
    "acknowledged-queue-backpressure-or-applied-generation",
    "general-signed-temperature-glyph-formatting",
  ]),
  currentFallback: "host-fetch-then-recompile-and-push-one-render-v2-package",
});

const WEEKDAYS = Object.freeze(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);

function fail(code, message, cause) {
  throw Object.assign(new Error(message, cause ? { cause } : undefined), { code });
}

function invariant(value, code, message) {
  if (!value) fail(code, message);
}

function record(value, label) {
  invariant(value && typeof value === "object" && !Array.isArray(value),
    "WEATHER_RESPONSE_INVALID", `${label} must be an object.`);
  return value;
}

function integer(value, minimum, maximum, label) {
  invariant(Number.isInteger(value) && value >= minimum && value <= maximum,
    "WEATHER_VALUE_INVALID", `${label} must be an integer in ${minimum}..${maximum}.`);
  return value;
}

function finite(value, minimum, maximum, label) {
  invariant(Number.isFinite(value) && value >= minimum && value <= maximum,
    "WEATHER_RESPONSE_INVALID", `${label} is outside ${minimum}..${maximum}.`);
  return value;
}

function boundedText(value, maximum, label) {
  const text = String(value ?? "").trim().replace(/\s+/gu, " ");
  invariant(text.length > 0 && Array.from(text).length <= maximum && !/[<>\u0000-\u001f\u007f]/u.test(text),
    "WEATHER_VALUE_INVALID", `${label} must contain 1..${maximum} safe characters.`);
  return text;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function roundedTemperature(value, label) {
  return Math.round(finite(value, -200, 200, label));
}

function dateParts(value, label) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(String(value ?? ""));
  invariant(match, "WEATHER_RESPONSE_INVALID", `${label} must be YYYY-MM-DD.`);
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  invariant(date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 &&
    date.getUTCDate() === Number(match[3]), "WEATHER_RESPONSE_INVALID", `${label} is not a calendar date.`);
  return Object.freeze({ date: match[0], weekdayId: date.getUTCDay(), weekday: WEEKDAYS[date.getUTCDay()] });
}

function array(value, minimum, label) {
  invariant(Array.isArray(value) && value.length >= minimum,
    "WEATHER_RESPONSE_INVALID", `${label} must contain at least ${minimum} entries.`);
  return value;
}

function normalizedPostalCode(value, countryCode) {
  const text = String(value ?? "").trim().toUpperCase().replace(/\s+/gu, " ");
  const valid = countryCode === "US" ? /^\d{5}(?:-\d{4})?$/u.test(text)
    : /^[A-Z0-9][A-Z0-9 -]{1,10}[A-Z0-9]$/u.test(text);
  invariant(valid, "WEATHER_POSTAL_CODE_INVALID",
    countryCode === "US" ? "US ZIP code must be 5 digits or ZIP+4." : "Postal code is invalid.");
  return text;
}

export function normalizeWeatherWidgetConfig(value = {}) {
  invariant(value && typeof value === "object" && !Array.isArray(value),
    "WEATHER_CONFIG_INVALID", "Weather widget config must be an object.");
  const countryCode = String(value.countryCode ?? "US").trim().toUpperCase();
  invariant(/^[A-Z]{2}$/u.test(countryCode), "WEATHER_COUNTRY_INVALID",
    "Weather countryCode must be an ISO alpha-2 code.");
  const units = String(value.units ?? "fahrenheit").trim().toLowerCase();
  invariant(WEATHER_WIDGET_UNITS.includes(units), "WEATHER_UNITS_INVALID",
    "Weather units must be fahrenheit or celsius.");
  const refreshMinutes = value.refreshMinutes ?? 30;
  integer(refreshMinutes, 15, 180, "Weather refreshMinutes");
  invariant(refreshMinutes % 5 === 0, "WEATHER_REFRESH_INVALID",
    "Weather refreshMinutes must be a five-minute increment.");
  return Object.freeze({ format: WEATHER_CONFIG_FORMAT,
    postalCode: normalizedPostalCode(value.postalCode, countryCode), countryCode,
    units, refreshMinutes, forecastDays: 3 });
}

export function weatherConditionFromWmo(value, { isDay = true } = {}) {
  const code = integer(Number(value), 0, 99, "WMO weather code");
  let id;
  if (code === 0) id = 0;
  else if (code >= 1 && code <= 2) id = 1;
  else if (code === 3) id = 2;
  else if (code === 45 || code === 48) id = 3;
  else if (code >= 51 && code <= 57) id = 4;
  else if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) id = 5;
  else if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) id = 6;
  else if (code >= 95 && code <= 99) id = 7;
  else id = 2;
  const condition = WEATHER_WIDGET_CONDITIONS[id];
  return Object.freeze({ ...condition, label: isDay ? condition.dayLabel : condition.nightLabel,
    wmoCode: code, isDay: Boolean(isDay) });
}

export function createOpenMeteoGeocodingUrl(configValue) {
  const config = normalizeWeatherWidgetConfig(configValue);
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", config.postalCode);
  url.searchParams.set("count", "10");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");
  url.searchParams.set("countryCode", config.countryCode);
  return url.href;
}

export function createOpenMeteoForecastUrl(locationValue, configValue) {
  const config = normalizeWeatherWidgetConfig(configValue);
  const location = record(locationValue, "Weather location");
  const latitude = finite(Number(location.latitude), -90, 90, "Weather latitude");
  const longitude = finite(Number(location.longitude), -180, 180, "Weather longitude");
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("current", "temperature_2m,weather_code,is_day");
  url.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min");
  url.searchParams.set("temperature_unit", config.units);
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", "4");
  return url.href;
}

function selectLocation(geocoding, config) {
  const results = array(record(geocoding, "Open-Meteo geocoding response").results, 1,
    "Open-Meteo geocoding results").filter((entry) => entry?.country_code === config.countryCode);
  invariant(results.length > 0, "WEATHER_LOCATION_NOT_FOUND",
    `No ${config.countryCode} location matched ${config.postalCode}.`);
  const compact = config.postalCode.replace(/[- ]/gu, "");
  const exact = results.find(({ postcodes = [] }) => Array.isArray(postcodes) &&
    postcodes.some((postcode) => String(postcode).replace(/[- ]/gu, "").toUpperCase() === compact));
  const selected = record(exact ?? results[0], "Open-Meteo location");
  return Object.freeze({ name: boundedText(selected.name, 32, "Weather location name"),
    region: selected.admin1 ? boundedText(selected.admin1, 32, "Weather region") : "",
    countryCode: config.countryCode,
    latitude: finite(Number(selected.latitude), -90, 90, "Weather latitude"),
    longitude: finite(Number(selected.longitude), -180, 180, "Weather longitude"),
    timezone: selected.timezone ? boundedText(selected.timezone, 64, "Weather timezone") : null });
}

export function weatherSnapshotFromOpenMeteo({ geocoding, forecast } = {}, configValue) {
  const config = normalizeWeatherWidgetConfig(configValue);
  const location = selectLocation(geocoding, config);
  const response = record(forecast, "Open-Meteo forecast response");
  const current = record(response.current, "Open-Meteo current weather");
  const daily = record(response.daily, "Open-Meteo daily weather");
  const dates = array(daily.time, 4, "Open-Meteo daily dates");
  const codes = array(daily.weather_code, 4, "Open-Meteo daily weather codes");
  const lows = array(daily.temperature_2m_min, 4, "Open-Meteo daily lows");
  const highs = array(daily.temperature_2m_max, 4, "Open-Meteo daily highs");
  const days = [1, 2, 3].map((index) => {
    const date = dateParts(dates[index], `Forecast day ${index} date`);
    const low = roundedTemperature(Number(lows[index]), `Forecast day ${index} low`);
    const high = roundedTemperature(Number(highs[index]), `Forecast day ${index} high`);
    invariant(low <= high, "WEATHER_RESPONSE_INVALID", `Forecast day ${index} low exceeds its high.`);
    return Object.freeze({ ...date, low, high,
      condition: weatherConditionFromWmo(Number(codes[index]), { isDay: true }) });
  });
  const isDay = Number(current.is_day ?? 1) === 1;
  return deepFreeze({ format: WEATHER_SNAPSHOT_FORMAT, config, location,
    updatedAt: boundedText(current.time ?? dates[0], 32, "Weather update time"),
    current: Object.freeze({ temperature: roundedTemperature(Number(current.temperature_2m),
      "Current temperature"), condition: weatherConditionFromWmo(Number(current.weather_code), { isDay }) }),
    days });
}

async function responseJson(response, label) {
  invariant(response && typeof response.json === "function", "WEATHER_FETCH_INVALID",
    `${label} returned an invalid response.`);
  if (!response.ok) fail("WEATHER_FETCH_FAILED", `${label} returned HTTP ${response.status}.`);
  let value;
  try { value = await response.json(); }
  catch (cause) { fail("WEATHER_FETCH_INVALID", `${label} did not return JSON.`, cause); }
  if (value?.error) fail("WEATHER_FETCH_FAILED", `${label}: ${String(value.reason ?? "provider error")}`);
  return value;
}

export async function fetchOpenMeteoWeather(configValue, { fetchImpl = globalThis.fetch, signal } = {}) {
  const config = normalizeWeatherWidgetConfig(configValue);
  invariant(typeof fetchImpl === "function", "WEATHER_FETCH_UNAVAILABLE", "Weather lookup requires fetch().");
  const geocoding = await responseJson(await fetchImpl(createOpenMeteoGeocodingUrl(config), {
    method: "GET", headers: { accept: "application/json" }, signal,
  }), "Open-Meteo geocoding");
  const location = selectLocation(geocoding, config);
  const forecast = await responseJson(await fetchImpl(createOpenMeteoForecastUrl(location, config), {
    method: "GET", headers: { accept: "application/json" }, signal,
  }), "Open-Meteo forecast");
  return weatherSnapshotFromOpenMeteo({ geocoding, forecast }, config);
}

function signedBits(value, bits, label) {
  const minimum = -(2 ** (bits - 1));
  const maximum = 2 ** (bits - 1) - 1;
  integer(value, minimum, maximum, label);
  return value < 0 ? value + 2 ** bits : value;
}

function decodedSigned(value, bits) {
  const sign = 2 ** (bits - 1);
  return value >= sign ? value - 2 ** bits : value;
}

export function packWeatherCurrent(value) {
  const current = record(value, "Weather current payload");
  const condition = integer(Number(current.condition?.id ?? current.condition), 0, 15, "Weather condition id");
  return (signedBits(current.temperature, 10, "Current temperature") |
    condition << 10 | (current.condition?.isDay === false || current.isDay === false ? 0 : 1) << 14) | 0;
}

export function unpackWeatherCurrent(value) {
  const packed = integer(value, -0x80000000, 0x7fffffff, "Packed current weather") >>> 0;
  const condition = WEATHER_WIDGET_CONDITIONS[(packed >>> 10) & 0xf];
  invariant(condition, "WEATHER_PAYLOAD_INVALID", "Packed current weather has an unknown condition.");
  return Object.freeze({ temperature: decodedSigned(packed & 0x3ff, 10),
    conditionId: condition.id, conditionKey: condition.key, isDay: Boolean((packed >>> 14) & 1) });
}

export function packWeatherDay(value) {
  const day = record(value, "Weather day payload");
  const condition = integer(Number(day.condition?.id ?? day.condition), 0, 15, "Weather condition id");
  const weekdayId = integer(day.weekdayId, 0, 6, "Weather weekday id");
  return (signedBits(day.low, 10, "Weather low") | signedBits(day.high, 10, "Weather high") << 10 |
    condition << 20 | weekdayId << 24) | 0;
}

export function unpackWeatherDay(value) {
  const packed = integer(value, -0x80000000, 0x7fffffff, "Packed forecast day") >>> 0;
  const condition = WEATHER_WIDGET_CONDITIONS[(packed >>> 20) & 0xf];
  const weekdayId = (packed >>> 24) & 0x7;
  invariant(condition && weekdayId <= 6, "WEATHER_PAYLOAD_INVALID", "Packed forecast day is invalid.");
  return Object.freeze({ low: decodedSigned(packed & 0x3ff, 10),
    high: decodedSigned((packed >>> 10) & 0x3ff, 10), conditionId: condition.id,
    conditionKey: condition.key, weekdayId, weekday: WEEKDAYS[weekdayId] });
}

export function encodeWeatherSnapshotEvents(snapshotValue, { revision, sequenceStart = 1 } = {}) {
  const snapshot = record(snapshotValue, "Weather snapshot");
  invariant(snapshot.format === WEATHER_SNAPSHOT_FORMAT && Array.isArray(snapshot.days) && snapshot.days.length === 3,
    "WEATHER_SNAPSHOT_INVALID", "Weather snapshot must be a normalized three-day snapshot.");
  integer(revision, 1, 0x7fffffff, "Weather revision");
  integer(sequenceStart, 0, 0xffffffff - 5, "Weather event sequenceStart");
  const values = [revision, packWeatherCurrent(snapshot.current),
    ...snapshot.days.map(packWeatherDay), revision];
  const ids = [WEATHER_WIDGET_HOST_EVENTS.begin, WEATHER_WIDGET_HOST_EVENTS.current,
    ...WEATHER_WIDGET_HOST_EVENTS.days, WEATHER_WIDGET_HOST_EVENTS.commit];
  return Object.freeze(ids.map((id, index) => Object.freeze({ kind: "host.rpc", flags: 0,
    id, value: values[index], sequence: sequenceStart + index })));
}

function escapeHtml(value) {
  return String(value).replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

/**
 * Current deployable fallback: weather values are literals in a package snapshot.
 * Fn + bottom knob remains an F2EP event and moves the three-row highlight.
 */
export function createWeatherWidgetSource(snapshotValue) {
  const snapshot = record(snapshotValue, "Weather snapshot");
  invariant(snapshot.format === WEATHER_SNAPSHOT_FORMAT && snapshot.days?.length === 3,
    "WEATHER_SNAPSHOT_INVALID", "Weather source requires a normalized three-day snapshot.");
  const location = boundedText(snapshot.location.name, 18, "Weather widget location");
  const dayRow = (day, index) => `<div class="weather-day"><span>${day.weekday}</span><b>${day.low}</b>` +
    `<i id="forecast-${index + 1}">→</i><b>${day.high}</b></div>`;
  const html = `<div class="weather-v2" aria-label="Weather for ${escapeHtml(location)}">
  <div class="weather-mark" aria-hidden="true"><i></i><b></b></div>
  <span class="weather-location">${escapeHtml(location)}</span>
  <span class="weather-title">Today</span>
  <div class="weather-current"><strong>${snapshot.current.temperature}°</strong><span>${escapeHtml(snapshot.current.condition.label)}</span></div>
  <div class="weather-forecast">
    ${snapshot.days.map(dayRow).join("\n    ")}
  </div>
</div>`;
  const css = `.weather-v2{position:relative;width:100px;height:310px;overflow:hidden;background:#000;color:#f5f5f4;font-family:"HKNova",ui-sans-serif,system-ui,sans-serif;font-variant-numeric:tabular-nums}
.weather-mark{position:absolute;left:41px;top:17px;width:24px;height:17px}
.weather-mark i,.weather-mark b{position:absolute;display:block;background:#f5f5f4}
.weather-mark i{left:0;bottom:0;width:24px;height:11px;border-radius:6px}
.weather-mark b{right:3px;top:0;width:11px;height:11px;border-radius:50%}
.weather-location{position:absolute;left:8px;right:8px;top:39px;height:12px;color:#8c8782;text-align:center;font:600 7px/12px "HKNova",ui-sans-serif,system-ui,sans-serif;white-space:nowrap;overflow:hidden}
.weather-title{position:absolute;left:8px;right:8px;top:57px;height:30px;text-align:center;font:500 22px/30px "HKNova",ui-sans-serif,system-ui,sans-serif}
.weather-current{position:absolute;box-sizing:border-box;left:8px;top:99px;width:84px;height:74px;border-radius:10px;background:#ff8a00;color:#090909;text-align:center;padding-top:9px}
.weather-current strong{display:block;font:500 31px/34px "HKNova",ui-sans-serif,system-ui,sans-serif;letter-spacing:-1px}
.weather-current span{display:block;font:600 13px/19px "HKNova",ui-sans-serif,system-ui,sans-serif}
.weather-forecast{position:absolute;left:8px;top:190px;width:84px;height:102px;display:grid;grid-template-rows:repeat(3,34px)}
.weather-day{display:grid;grid-template-columns:31px 18px 13px 18px;align-items:center;width:84px;height:34px;color:#f5f5f4;font:600 11px/34px ui-monospace,SFMono-Regular,Menlo,monospace}
.weather-day span{text-align:left}.weather-day b{font:inherit;text-align:right}.weather-day i{font:600 15px/34px ui-monospace,SFMono-Regular,Menlo,monospace;text-align:center;font-style:normal}
#forecast-1{color:#ff8a00}#forecast-2,#forecast-3{color:#77736f}`;
  const script = `var selectedDay = 0;

widget.on("input.fn-bottom-knob", function (event) {
  selectedDay += event.delta;
  selectedDay = mod(selectedDay, 3);
  document.querySelector("#forecast-1").style.color = pick(selectedDay, "#FF8A00", "#77736F", "#77736F");
  document.querySelector("#forecast-2").style.color = pick(selectedDay, "#77736F", "#FF8A00", "#77736F");
  document.querySelector("#forecast-3").style.color = pick(selectedDay, "#77736F", "#77736F", "#FF8A00");
});`;
  return Object.freeze({ html, css, script, rootClass: "weather-v2", renderMode: "raster",
    name: `weather-${snapshot.config.postalCode}`.slice(0, 16),
    delivery: Object.freeze({ mode: "snapshot-package-recompile", incrementalHostEvents: false,
      reason: WEATHER_WIDGET_EDGE_REQUIREMENTS.currentFallback }) });
}
