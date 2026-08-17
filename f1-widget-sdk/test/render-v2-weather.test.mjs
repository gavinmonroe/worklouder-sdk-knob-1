import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { ChromiumRasterCaptureProvider } from "../input-lab/lib/chromium-raster-capture.mjs";
import { compileInputLabRenderV2 } from "../input-lab/lib/render-v2.mjs";
import {
  createOpenMeteoForecastUrl,
  createOpenMeteoGeocodingUrl,
  createRenderV2Runtime,
  createWeatherWidgetSource,
  encodeWeatherSnapshotEvents,
  fetchOpenMeteoWeather,
  normalizeWeatherWidgetConfig,
  packWeatherCurrent,
  packWeatherDay,
  unpackWeatherCurrent,
  unpackWeatherDay,
  WEATHER_WIDGET_EDGE_REQUIREMENTS,
  WEATHER_WIDGET_HOST_EVENTS,
  weatherConditionFromWmo,
  weatherSnapshotFromOpenMeteo,
} from "../src/render-v2/index.mjs";

const fixtureUrl = new URL("../examples/render-v2-weather/fixtures/open-meteo-60601.json", import.meta.url);
const config = Object.freeze({ postalCode: "60601", countryCode: "US", units: "fahrenheit",
  refreshMinutes: 30 });

async function fixture() { return JSON.parse(await readFile(fixtureUrl, "utf8")); }

test("weather config and Open-Meteo URLs are bounded to the selected postal code and units", () => {
  assert.deepEqual(normalizeWeatherWidgetConfig(config), { format: "framer-render-v2-weather-config-v1",
    postalCode: "60601", countryCode: "US", units: "fahrenheit", refreshMinutes: 30, forecastDays: 3 });
  const geocoding = new URL(createOpenMeteoGeocodingUrl(config));
  assert.equal(geocoding.origin, "https://geocoding-api.open-meteo.com");
  assert.equal(geocoding.searchParams.get("name"), "60601");
  assert.equal(geocoding.searchParams.get("countryCode"), "US");
  const forecast = new URL(createOpenMeteoForecastUrl({ latitude: 41.8864, longitude: -87.6186 }, config));
  assert.equal(forecast.origin, "https://api.open-meteo.com");
  assert.equal(forecast.searchParams.get("temperature_unit"), "fahrenheit");
  assert.equal(forecast.searchParams.get("forecast_days"), "4");
  assert.throws(() => normalizeWeatherWidgetConfig({ ...config, postalCode: "abc" }),
    { code: "WEATHER_POSTAL_CODE_INVALID" });
  assert.throws(() => normalizeWeatherWidgetConfig({ ...config, refreshMinutes: 7 }),
    { code: "WEATHER_VALUE_INVALID" });
});

test("Open-Meteo fixture normalizes current conditions and the next three weekdays", async () => {
  const value = weatherSnapshotFromOpenMeteo(await fixture(), config);
  assert.equal(value.location.name, "Chicago");
  assert.deepEqual({ temperature: value.current.temperature, condition: value.current.condition.key },
    { temperature: 45, condition: "clear" });
  assert.deepEqual(value.days.map(({ weekday, low, high, condition }) =>
    ({ weekday, low, high, condition: condition.key })), [
    { weekday: "Wed", low: 34, high: 42, condition: "partly-cloudy" },
    { weekday: "Thu", low: 38, high: 46, condition: "cloudy" },
    { weekday: "Fri", low: 44, high: 52, condition: "rain" },
  ]);
  assert.equal(weatherConditionFromWmo(95).key, "storm");
  assert.equal(weatherConditionFromWmo(75).key, "snow");
});

test("weather provider fetch is injectable and requests geocoding before forecast", async () => {
  const data = await fixture();
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(new URL(url));
    const body = urls.length === 1 ? data.geocoding : data.forecast;
    return { ok: true, status: 200, async json() { return structuredClone(body); } };
  };
  const snapshot = await fetchOpenMeteoWeather(config, { fetchImpl });
  assert.equal(snapshot.current.temperature, 45);
  assert.deepEqual(urls.map(({ hostname }) => hostname),
    ["geocoding-api.open-meteo.com", "api.open-meteo.com"]);
  assert.equal(urls[1].searchParams.get("latitude"), "41.8864");
});

test("packed weather records preserve signed temperatures, conditions, and weekdays", () => {
  const current = { temperature: -12, condition: { id: 6, isDay: false } };
  assert.deepEqual(unpackWeatherCurrent(packWeatherCurrent(current)),
    { temperature: -12, conditionId: 6, conditionKey: "snow", isDay: false });
  const day = { low: -18, high: 7, condition: { id: 7 }, weekdayId: 4 };
  assert.deepEqual(unpackWeatherDay(packWeatherDay(day)),
    { low: -18, high: 7, conditionId: 7, conditionKey: "storm", weekdayId: 4, weekday: "Thu" });
});

test("incremental weather contract is one revisioned six-record batch that fits an empty queue", async () => {
  const snapshot = weatherSnapshotFromOpenMeteo(await fixture(), config);
  const events = encodeWeatherSnapshotEvents(snapshot, { revision: 19, sequenceStart: 40 });
  assert.equal(events.length, 6);
  assert.deepEqual(events.map(({ id }) => id), [WEATHER_WIDGET_HOST_EVENTS.begin,
    WEATHER_WIDGET_HOST_EVENTS.current, ...WEATHER_WIDGET_HOST_EVENTS.days, WEATHER_WIDGET_HOST_EVENTS.commit]);
  assert.deepEqual(events.map(({ sequence }) => sequence), [40, 41, 42, 43, 44, 45]);
  assert.equal(events[0].value, 19);
  assert.equal(events.at(-1).value, 19);
  assert.equal(WEATHER_WIDGET_EDGE_REQUIREMENTS.currentF2epV1Compatible, false);
  assert.equal(WEATHER_WIDGET_EDGE_REQUIREMENTS.recordsPerSnapshot, 6);
});

test("weather snapshot fallback compiles as a rich RGB565 package and knob selection stays event-driven", async () => {
  const snapshot = weatherSnapshotFromOpenMeteo(await fixture(), config);
  const source = createWeatherWidgetSource(snapshot);
  assert.equal(source.delivery.mode, "snapshot-package-recompile");
  assert.equal(source.delivery.incrementalHostEvents, false);
  const provider = new ChromiumRasterCaptureProvider();
  const compiled = await compileInputLabRenderV2(source, { captureProvider: provider });
  assert.equal(compiled.renderMode, "raster");
  assert.equal(compiled.compilation.linked.renderSource, "pre-rendered-rgb565");
  assert.equal(compiled.compilation.package.compatibility.structuralV1.deviceDeployable, true);
  assert.equal(compiled.compilation.package.compatibility.currentDevice.deviceDeployable, false);
  assert.ok(compiled.compilation.package.binary.length <= 98_304);
  const runtime = createRenderV2Runtime(compiled.compilation.linked);
  const first = runtime.frame;
  const second = runtime.dispatch({ kind: "input.fn-bottom-knob", flags: 1, id: 1, value: 1 });
  const third = runtime.dispatch({ kind: "input.fn-bottom-knob", flags: 1, id: 1, value: 1 });
  assert.equal(second.state.selectedDay, 1);
  assert.equal(third.state.selectedDay, 2);
  assert.notDeepEqual(second.frame, first);
  assert.notDeepEqual(third.frame, second.frame);
});
