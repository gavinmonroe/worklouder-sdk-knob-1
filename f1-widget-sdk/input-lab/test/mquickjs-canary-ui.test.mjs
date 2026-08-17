import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { decodeRenderV2MQuickJsPackage, RENDER_V2_MQUICKJS_PROFILE } from
  "../../src/render-v2/mquickjs.mjs";
import { SavedPreviewStore } from "../lib/saved-previews.mjs";
import { createInputLabProject } from "../lib/browser-project.mjs";
import { assessInputLabMQuickJsPushGate, buildInputLabMQuickJsPackage,
  createInputLabDeterministicWeatherSnapshot, extractInputLabMQuickJsRasterBase,
  INPUT_LAB_MQUICKJS_PACKAGE_FORMAT, InputLabMQuickJsCanarySession } from
  "../lib/mquickjs-canary.mjs";

const timerSourceUrl = new URL("../../examples/render-v2-mquickjs-canary/canary-widget.js", import.meta.url);
const weatherSourceUrl = new URL("../../examples/render-v2-mquickjs-weather-canary/weather-widget.js", import.meta.url);
const weatherPackageUrl = new URL("../../examples/render-v2-mquickjs-weather-canary/build/weather-60601.f2js", import.meta.url);

function memoryStorage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test("browser canary packer emits strict packages accepted by the exact frozen SDK", async () => {
  const timer = await buildInputLabMQuickJsPackage({ source: await readFile(timerSourceUrl, "utf8") });
  const decodedTimer = decodeRenderV2MQuickJsPackage(timer.binary);
  assert.equal(decodedTimer.sha256, timer.sha256);
  assert.match(decodedTimer.source, /^"use strict";\n/u);
  assert.deepEqual(timer.budget, { packageBytes: timer.bytes, packageHeadroomBytes: 98_304 - timer.bytes,
    sourceBytes: decodedTimer.budget.sourceBytes, sourceHeadroomBytes: 8_192 - decodedTimer.budget.sourceBytes,
    heapBytes: 65_536, handlers: 7, handlerHeadroom: 9, targets: 0, targetHeadroom: 16,
    keys: 2, keyHeadroom: 14, chords: 1, chordHeadroom: 7, rasterBaseBytes: 0 });

  const raster = extractInputLabMQuickJsRasterBase(await readFile(weatherPackageUrl));
  const weather = await buildInputLabMQuickJsPackage({ source: await readFile(weatherSourceUrl, "utf8"),
    example: "weather", rasterBase: raster });
  const decodedWeather = decodeRenderV2MQuickJsPackage(weather.binary);
  assert.equal(decodedWeather.budget.events, 9);
  assert.equal(decodedWeather.budget.targets, 16);
  assert.equal(decodedWeather.budget.rasterBaseBytes, 62_404);
});

test("physical-but-unproven canary is display-compatible while Package Push stays blocked", () => {
  const exact = { renderV2Profile: RENDER_V2_MQUICKJS_PROFILE.id,
    packageFormat: RENDER_V2_MQUICKJS_PROFILE.packageFormat,
    packageAbiSha256: RENDER_V2_MQUICKJS_PROFILE.packageAbiSha256,
    engine: RENDER_V2_MQUICKJS_PROFILE.engine, engineCommit: RENDER_V2_MQUICKJS_PROFILE.engineCommit,
    javascriptProfile: RENDER_V2_MQUICKJS_PROFILE.javascriptProfile,
    deviceEvaluatesJavaScript: true, deviceRunsJsdom: false,
    maxPackageBytes: String(RENDER_V2_MQUICKJS_PROFILE.maxPackageBytes),
    maxSourceBytes: String(RENDER_V2_MQUICKJS_PROFILE.maxSourceBytes),
    heapBytes: String(RENDER_V2_MQUICKJS_PROFILE.heapBytes),
    callbackDeadlineUs: String(RENDER_V2_MQUICKJS_PROFILE.callbackDeadlineUs),
    maxHandlers: String(RENDER_V2_MQUICKJS_PROFILE.maxHandlers),
    maxTargets: String(RENDER_V2_MQUICKJS_PROFILE.maxTargets),
    maxKeys: String(RENDER_V2_MQUICKJS_PROFILE.maxKeys),
    maxChords: String(RENDER_V2_MQUICKJS_PROFILE.maxChords), screenId: 28,
    physicalCanary: true, hardwareRuntimeProven: false, runtimeUploader: false };
  assert.equal(assessInputLabMQuickJsPushGate({ capability: {
    renderV2Profile: "framer-f1-render-v2-structural-v1",
    packageFormat: "framer-render-v2-package-v1" } }).allowed, false);
  assert.equal(assessInputLabMQuickJsPushGate({ capability: exact }).allowed, false);
  const gated = assessInputLabMQuickJsPushGate({ capability: exact, uploader: {
    kind: "browser-mquickjs-f2js-v1", packageFormat: INPUT_LAB_MQUICKJS_PACKAGE_FORMAT,
    provenSafe: true } });
  assert.equal(gated.capabilityCompatible, true);
  assert.equal(gated.allowed, false);
  assert.match(gated.reason, /runtimeUploader=false/iu);
});

test("offline weather RPC revision and timer events update deterministic fixture state", () => {
  assert.deepEqual(createInputLabDeterministicWeatherSnapshot({ postalCode: "60601" }),
    createInputLabDeterministicWeatherSnapshot({ postalCode: "60601" }));
  const weather = new InputLabMQuickJsCanarySession({ example: "weather", postalCode: "60601" });
  assert.equal(weather.refreshWeather().revision, 1);
  assert.equal(weather.dispatch({ type: "tick.1s" }).ageSeconds, 1);
  const timer = new InputLabMQuickJsCanarySession({ example: "timer" });
  assert.equal(timer.dispatch({ type: "host.rpc", id: 0x7001, value: 65, auxiliary: 1 }).seconds, 65);
  assert.equal(timer.dispatch({ type: "tick.1s" }).seconds, 64);
  assert.equal(timer.dispatch({ type: "input.fn-bottom-knob", delta: 1, heldMask: 1 }).seconds, 124);
});

test("saved slots and project export retain MicroQuickJS backend, source, and settings", () => {
  const store = new SavedPreviewStore({ storage: memoryStorage() });
  const state = store.saveSlot(0, { name: "Canary", renderer: "v2", backend: "mquickjs",
    html: "<div></div>", css: "div{}", script: `"use strict";\nwidget.commit();`,
    mquickjs: { example: "weather", postalCode: "10001", countryCode: "US", units: "celsius" } });
  assert.equal(state.slots[0].backend, "mquickjs");
  assert.equal(state.slots[0].mquickjs.postalCode, "10001");
  const project = createInputLabProject({ slots: state.slots, activeSlot: 0 });
  assert.equal(project.slots[0].backend, "mquickjs");
  assert.equal(project.slots[0].mquickjs.units, "celsius");
});

test("Input Lab visibly probes the physical ID28 canary, forwards host events, and never enables Push", async () => {
  const source = await readFile(new URL("../app.mjs", import.meta.url), "utf8");
  assert.match(source, /probeMQuickJsCapabilities/u);
  assert.match(source, /Physical canary ID28/u);
  assert.match(source, /proven=false · uploader=false/u);
  assert.match(source, /sendMQuickJsHostEvent/u);
  assert.match(source, /createInputLabDeterministicWeatherSnapshot/u);
  assert.match(source, /createInputLabWeatherRpcBatch/u);
  assert.match(source, /probeMQuickJsTelemetry/u);
  assert.match(source, /deliverInputLabMQuickJsWeatherBatch/u);
  assert.match(source, /confirmInputLabMQuickJsWeatherRender/u);
  assert.match(source, /runMQuickJsTransaction/u);
  assert.match(source, /restricted to US ZIP 60601/u);
  assert.match(source, /renders on the next ID28 entry/u);
  assert.match(source, /committed and rendered on physical ID28/u);
  assert.match(source, /runtimeUploader=false/u);
  assert.match(source, /will not replace the MicroQuickJS canary with the unrelated catalog renderer/u);
  assert.match(source, /elements\.flashRenderer\.disabled = !\("serial" in navigator\) \|\| Boolean\(mquickJsDeviceCapability\)/u);
  assert.match(source, /const activeMquickJs =/u);
  assert.match(source, /elements\.apply\.disabled = activeMquickJs \|\|/u);
});
