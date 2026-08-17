import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildWeatherCanaryExample,
  WEATHER_CANARY_GENERATION,
} from "../examples/render-v2-mquickjs-weather-canary/build.mjs";
import {
  assessWeatherCanaryCapability,
  createDeterministicWeatherProvider,
  createWeatherCanaryHost,
  createWeatherCanarySimulationTransport,
  requiredWeatherCanaryCapability,
} from "../examples/render-v2-mquickjs-weather-canary/host-adapter.mjs";
import {
  encodeWeatherCanaryRevision,
  encodeWeatherProviderStatus,
  encodeWeatherVisibility,
  requiredWeatherCanaryHostRpcIds,
  unpackTemperatureAscii,
  WEATHER_MQUICKJS_FRESHNESS,
  WEATHER_MQUICKJS_SLOTS,
  WEATHER_MQUICKJS_TARGETS,
} from "../examples/render-v2-mquickjs-weather-canary/protocol.mjs";
import {
  renderWeatherCanaryGoldenSvg,
  weatherCanaryViewModel,
} from "../examples/render-v2-mquickjs-weather-canary/screen.mjs";
import { createWeatherCanarySimulator } from
  "../examples/render-v2-mquickjs-weather-canary/simulator.mjs";
import {
  decodeRenderV2MQuickJsPackage,
  RENDER_V2_MQUICKJS_PACKAGE_ABI_SHA256,
  RENDER_V2_MQUICKJS_SOURCE_PREFIX,
} from "../src/render-v2/mquickjs.mjs";

const sourceUrl = new URL("../examples/render-v2-mquickjs-weather-canary/weather-widget.js", import.meta.url);
const config = Object.freeze({ postalCode: "60601", countryCode: "US", units: "fahrenheit",
  refreshMinutes: 30 });

async function source() { return readFile(sourceUrl, "utf8"); }

async function snapshot(overrides = {}) {
  const value = await createDeterministicWeatherProvider().lookup(config);
  return { ...value, ...overrides };
}

test("weather canary builds one deterministic strict F2JS screen inside every package budget", async () => {
  const first = await buildWeatherCanaryExample();
  const second = await buildWeatherCanaryExample();
  assert.deepEqual(first.value.binary, second.value.binary);
  assert.equal(first.value.sha256, second.value.sha256);
  assert.equal(first.value.generation, WEATHER_CANARY_GENERATION);
  assert.equal(first.value.budget.sourceBytes, 5_667);
  assert.equal(first.value.budget.events, 9);
  assert.equal(first.value.budget.targets, 16);
  assert.equal(first.value.budget.rasterBaseBytes, 62_404);
  assert.ok(first.value.budget.packageHeadroomBytes > 29_000);
  assert.deepEqual(first.value.events.filter(({ kind }) => kind === 4).map(({ id }) => id),
    requiredWeatherCanaryHostRpcIds());
  assert.deepEqual(first.value.targets.map(({ id }) => id), WEATHER_MQUICKJS_TARGETS.map(({ id }) => id));
  assert.equal(first.manifest.status, "STATIC_OFFLINE_NOT_FLASHABLE");
  assert.equal(first.manifest.screen.pushAllowed, false);
  assert.equal(first.manifest.screen.capabilityGate.dispatchReceipt, "exact-event-applied-v1");
  assert.equal(first.manifest.hardwareRuntimeProven, false);
  assert.equal(first.manifest.package.packageAbiSha256, RENDER_V2_MQUICKJS_PACKAGE_ABI_SHA256);
  const decoded = decodeRenderV2MQuickJsPackage(first.value.binary);
  assert.equal(decoded.source, await source());
  assert.equal(decoded.source.indexOf(RENDER_V2_MQUICKJS_SOURCE_PREFIX), 0);
  assert.equal(decoded.source.indexOf(RENDER_V2_MQUICKJS_SOURCE_PREFIX,
    RENDER_V2_MQUICKJS_SOURCE_PREFIX.length), -1);
  assert.deepEqual(first.manifest.protocol.flowControl.outcomes,
    ["busy", "rejected", "queued", "applied"]);
  assert.equal(first.manifest.protocol.flowControl.scalarDispatchReceipt, "exact-event-applied-v1");
  assert.equal(first.manifest.protocol.flowControl.revisionReceipt, "appliedRevision");
});

test("revision staging tolerates field reorder but never publishes partial, stale, or conflicting duplicate data", async () => {
  const simulator = createWeatherCanarySimulator(await source());
  const first = encodeWeatherCanaryRevision(await snapshot(), { revision: 1 });
  simulator.dispatchAll(first);
  assert.equal(simulator.slots[WEATHER_MQUICKJS_SLOTS.appliedRevision], 1);
  const lastGood = simulator.slots;

  const partial = encodeWeatherCanaryRevision(await snapshot(), { revision: 2 });
  simulator.dispatchAll([partial[0], partial[1], partial[2], partial[5]]);
  assert.deepEqual(simulator.slots, lastGood, "a matching commit with missing records must expose nothing");

  const reordered = encodeWeatherCanaryRevision(await snapshot(), { revision: 3 });
  simulator.dispatchAll([reordered[0], reordered[4], reordered[2], reordered[1], reordered[3], reordered[5]]);
  assert.equal(simulator.slots[WEATHER_MQUICKJS_SLOTS.appliedRevision], 3);
  const revision3 = simulator.slots;

  simulator.dispatchAll(encodeWeatherCanaryRevision(await snapshot(), { revision: 2 }));
  assert.deepEqual(simulator.slots, revision3, "an older complete revision must be ignored");

  const conflicting = encodeWeatherCanaryRevision(await snapshot(), { revision: 4 });
  simulator.dispatch(conflicting[0]);
  simulator.dispatch(conflicting[1]);
  simulator.dispatch({ ...conflicting[1], value: conflicting[1].value ^ 1 });
  simulator.dispatchAll(conflicting.slice(2));
  assert.deepEqual(simulator.slots, revision3, "a conflicting duplicate invalidates its staging revision");

  const duplicateCommit = encodeWeatherCanaryRevision(await snapshot(), { revision: 5 });
  simulator.dispatchAll(duplicateCommit);
  const publicationRevision = simulator.publicationRevision;
  simulator.dispatch(duplicateCommit.at(-1));
  assert.equal(simulator.publicationRevision, publicationRevision);
  assert.equal(simulator.slots[0], 5);
});

test("signed temperatures are formatted by device-side JS into bounded ASCII glyph words", async () => {
  const base = await snapshot();
  const negative = { ...base,
    current: { ...base.current, temperature: -12 },
    days: [
      { ...base.days[0], low: -18, high: 7 },
      { ...base.days[1], low: -3, high: 0 },
      { ...base.days[2], low: 100, high: 111 },
    ] };
  const simulator = createWeatherCanarySimulator(await source());
  simulator.dispatchAll(encodeWeatherCanaryRevision(negative, { revision: 7 }));
  assert.equal(unpackTemperatureAscii(simulator.slots[1]), "-12");
  assert.deepEqual([4, 5, 7, 8, 10, 11].map((slot) => unpackTemperatureAscii(simulator.slots[slot])),
    ["-18", "7", "-3", "0", "100", "111"]);
  const view = weatherCanaryViewModel(simulator.slots, { location: "Test", units: "celsius" });
  assert.equal(view.current.temperature, "-12°C");
  assert.deepEqual(view.days.map(({ low, high }) => [low, high]),
    [["-18°C", "7°C"], ["-3°C", "0°C"], ["100°C", "111°C"]]);
});

test("tick.1s advances age/freshness while hidden policy suppresses ticks and resumes with elapsed time", async () => {
  const simulator = createWeatherCanarySimulator(await source());
  simulator.dispatchAll(encodeWeatherCanaryRevision(await snapshot(), { revision: 1 }));
  simulator.dispatch({ name: "tick.1s", type: "tick.1s" });
  assert.equal(simulator.slots[WEATHER_MQUICKJS_SLOTS.ageSeconds], 1);
  assert.equal(simulator.slots[WEATHER_MQUICKJS_SLOTS.freshness], WEATHER_MQUICKJS_FRESHNESS.fresh);

  simulator.dispatch(encodeWeatherVisibility({ visible: false }));
  const hiddenSlots = simulator.slots;
  const hiddenPublication = simulator.publicationRevision;
  simulator.dispatch({ name: "tick.1s", type: "tick.1s" });
  assert.deepEqual(simulator.slots, hiddenSlots);
  assert.equal(simulator.publicationRevision, hiddenPublication);

  simulator.dispatch(encodeWeatherVisibility({ visible: true, elapsedSeconds: 1_801 }));
  assert.equal(simulator.slots[WEATHER_MQUICKJS_SLOTS.ageSeconds], 1_802);
  assert.equal(simulator.slots[WEATHER_MQUICKJS_SLOTS.freshness], WEATHER_MQUICKJS_FRESHNESS.stale);
  assert.equal(simulator.slots[WEATHER_MQUICKJS_SLOTS.flags] & 2, 0);
});

test("host model exposes busy, queued, rejected, and exact appliedRevision semantics", async () => {
  const fixture = await snapshot();
  let releaseLookup;
  const deferredProvider = { lookup: () => new Promise((resolve) => { releaseLookup = resolve; }) };
  const simulator = createWeatherCanarySimulator(await source());
  const host = createWeatherCanaryHost({ provider: deferredProvider,
    transport: createWeatherCanarySimulationTransport(simulator),
    capability: requiredWeatherCanaryCapability() });
  const first = host.refresh(config);
  await Promise.resolve();
  assert.deepEqual(await host.refresh(config), { status: "busy", appliedRevision: 0 });
  releaseLookup(fixture);
  assert.deepEqual(await first, { status: "applied", appliedRevision: 1 });

  await host.setVisible(false);
  assert.deepEqual(await host.submit(fixture), { status: "queued", appliedRevision: 1, queuedRevision: 2 });
  assert.equal(simulator.slots[0], 1);
  const resumed = await host.setVisible(true, { elapsedSeconds: 90 });
  assert.deepEqual(resumed, { status: "applied", appliedRevision: 2 });
  assert.equal(simulator.slots[0], 2);

  const badCapabilityProvider = createDeterministicWeatherProvider();
  const gated = createWeatherCanaryHost({ provider: badCapabilityProvider,
    transport: createWeatherCanarySimulationTransport(createWeatherCanarySimulator(await source())),
    capability: { ...requiredWeatherCanaryCapability(), targetFacade: "missing" } });
  const rejected = await gated.refresh(config);
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.reason, "capability-mismatch");
  assert.equal(badCapabilityProvider.calls, 0, "capability rejection happens before provider/network work");
});

test("host serializes an in-flight revision before hide, then replays only the latest hidden revision", async () => {
  const fixture = await snapshot();
  const simulator = createWeatherCanarySimulator(await source());
  const base = createWeatherCanarySimulationTransport(simulator);
  let releaseBegin;
  let markBeginStarted;
  const beginStarted = new Promise((resolve) => { markBeginStarted = resolve; });
  const beginGate = new Promise((resolve) => { releaseBegin = resolve; });
  let delayBegin = true;
  const order = [];
  const transport = {
    async dispatch(event) {
      order.push({ phase: "start", id: event.id, value: event.value });
      if (delayBegin && event.id === 0xb240) {
        delayBegin = false;
        markBeginStarted();
        await beginGate;
      }
      const result = await base.dispatch(event);
      order.push({ phase: "finish", id: event.id, value: event.value });
      return result;
    },
    receipt: base.receipt,
  };
  const host = createWeatherCanaryHost({ provider: createDeterministicWeatherProvider(), transport,
    capability: requiredWeatherCanaryCapability() });

  const first = host.submit(fixture);
  await beginStarted;
  const hide = host.setVisible(false);
  await Promise.resolve();
  assert.equal(order.some(({ id }) => id === 0xb24e), false,
    "hide must not interleave with a partially delivered revision");
  releaseBegin();
  assert.deepEqual(await first, { status: "applied", appliedRevision: 1 });
  assert.deepEqual(await hide, { status: "applied", appliedRevision: 1 });
  assert.equal(host.state.visible, false);
  assert.equal(order.findIndex(({ phase, id }) => phase === "finish" && id === 0xb24f) <
    order.findIndex(({ phase, id, value }) => phase === "start" && id === 0xb24e && value === 0), true);

  assert.deepEqual(await host.submit(fixture),
    { status: "queued", appliedRevision: 1, queuedRevision: 2 });
  assert.deepEqual(await host.submit(fixture),
    { status: "queued", appliedRevision: 1, queuedRevision: 3 });
  assert.deepEqual(await host.setVisible(true, { elapsedSeconds: 30 }),
    { status: "applied", appliedRevision: 3 });
  assert.equal(simulator.slots[0], 3);
  assert.equal(host.state.queuedRevision, null);
});

test("dispatch busy preserves one latest revision and every scalar requires an exact event receipt", async () => {
  const fixture = await snapshot();
  const simulator = createWeatherCanarySimulator(await source());
  let firstBegin = true;
  const transport = createWeatherCanarySimulationTransport(simulator, { intercept(event) {
    if (firstBegin && event.id === 0xb240) {
      firstBegin = false;
      return { status: "busy" };
    }
    return null;
  } });
  const host = createWeatherCanaryHost({ provider: createDeterministicWeatherProvider(), transport,
    capability: requiredWeatherCanaryCapability() });
  assert.deepEqual(await host.submit(fixture),
    { status: "queued", appliedRevision: 0, queuedRevision: 1 });
  assert.deepEqual(await host.submit(fixture),
    { status: "queued", appliedRevision: 0, queuedRevision: 2 });
  assert.deepEqual(await host.flush(), { status: "applied", appliedRevision: 2 });

  const missingReceiptHost = createWeatherCanaryHost({ provider: createDeterministicWeatherProvider(),
    transport: { async dispatch() { return { status: "accepted" }; },
      async receipt() { return { status: "rejected", appliedRevision: 0 }; } },
    capability: requiredWeatherCanaryCapability() });
  assert.deepEqual(await missingReceiptHost.submit(fixture), { status: "rejected", appliedRevision: 0,
    reason: "missing-exact-dispatch-receipt" });
});

test("visibility and provider-status controls fail closed without exact applied receipts", async () => {
  const fixture = await snapshot();
  const visibilitySimulator = createWeatherCanarySimulator(await source());
  const visibilityTransport = createWeatherCanarySimulationTransport(visibilitySimulator,
    { intercept(event) { return event.id === 0xb24e ? { status: "rejected", reason: "control-down" } : null; } });
  const visibilityHost = createWeatherCanaryHost({ provider: createDeterministicWeatherProvider(),
    transport: visibilityTransport, capability: requiredWeatherCanaryCapability() });
  assert.equal((await visibilityHost.submit(fixture)).status, "applied");
  assert.deepEqual(await visibilityHost.setVisible(false), { status: "rejected", appliedRevision: 1,
    reason: "visibility-not-applied", transportReason: "control-down", transportStatus: "rejected",
    requestedVisible: false });
  assert.equal(visibilityHost.state.visible, true);
  assert.equal(visibilityHost.state.requestedVisible, true);

  const providerSimulator = createWeatherCanarySimulator(await source());
  const providerTransport = createWeatherCanarySimulationTransport(providerSimulator,
    { intercept(event) { return event.id === 0xb24d ? { status: "rejected", reason: "control-down" } : null; } });
  const providerHost = createWeatherCanaryHost({
    provider: createDeterministicWeatherProvider({ failures: 1 }), transport: providerTransport,
    capability: requiredWeatherCanaryCapability(), retryAfterSeconds: 12 });
  assert.deepEqual(await providerHost.refresh(config), { status: "rejected", appliedRevision: 0,
    reason: "provider-status-not-applied", transportReason: "control-down",
    transportStatus: "rejected", retrySeconds: 12, errorCode: "FAKE_PROVIDER_UNAVAILABLE" });
  assert.equal(providerSimulator.publicationRevision, 0);
});

test("provider error/retry retains last-good snapshot and clears only after a complete replacement", async () => {
  const simulator = createWeatherCanarySimulator(await source());
  const retryHost = createWeatherCanaryHost({
    provider: createDeterministicWeatherProvider({ failureCalls: [2] }),
    transport: createWeatherCanarySimulationTransport(simulator),
    capability: requiredWeatherCanaryCapability(), retryAfterSeconds: 12 });
  assert.equal((await retryHost.refresh(config)).status, "applied");
  const lastGoodTemperature = simulator.slots[1];

  const failed = await retryHost.refresh(config);
  assert.equal(failed.status, "rejected");
  assert.equal(failed.reason, "provider-error");
  assert.equal(failed.retrySeconds, 12);
  assert.equal(simulator.slots[1], lastGoodTemperature);
  assert.equal(simulator.slots[13], WEATHER_MQUICKJS_FRESHNESS.errorWithLastGood);
  assert.equal(simulator.slots[14], 12);
  simulator.dispatch({ name: "tick.1s", type: "tick.1s" });
  assert.equal(simulator.slots[14], 11);
  const recovered = await retryHost.refresh(config);
  assert.equal(recovered.status, "applied");
  assert.equal(simulator.slots[13], WEATHER_MQUICKJS_FRESHNESS.fresh);
  assert.equal(simulator.slots[14], 0);
});

test("VM re-evaluation hydrates last-good weather and a benign event cannot zero the forecast", async () => {
  const original = createWeatherCanarySimulator(await source());
  original.dispatchAll(encodeWeatherCanaryRevision(await snapshot(), { revision: 7 }));
  original.dispatch(encodeWeatherProviderStatus({ error: true, retrySeconds: 19 }));
  const beforeFault = original.slots;

  /* A native timeout/OOM recovery recreates the JS context while retaining
   * these exact last-good slots. Model that boundary directly, then dispatch
   * the same benign provider-status event used by the physical recovery gate. */
  const recovered = createWeatherCanarySimulator(await source(), { initialSlots: [...beforeFault] });
  recovered.dispatch(encodeWeatherProviderStatus({ error: false, retrySeconds: 0 }));
  assert.deepEqual(recovered.slots.slice(0, 12), beforeFault.slice(0, 12));
  assert.equal(recovered.slots[0], 7);
  assert.equal(recovered.slots[15] & 1, 1, "last-good availability survives JS re-evaluation");

  recovered.dispatch({ name: "tick.1s", type: "tick.1s" });
  assert.deepEqual(recovered.slots.slice(1, 12), beforeFault.slice(1, 12));
  assert.equal(recovered.slots[12], beforeFault[12] + 1);

  const replacementBase = await snapshot();
  const replacement = { ...replacementBase,
    current: { ...replacementBase.current, temperature: -7 } };
  recovered.dispatchAll(encodeWeatherCanaryRevision(replacement, { revision: 8 }));
  assert.equal(recovered.slots[0], 8);
  assert.equal(unpackTemperatureAscii(recovered.slots[1]), "-7");
});

test("a host receipt must report the exact applied revision; accepted scalar writes are not enough", async () => {
  const simulator = createWeatherCanarySimulator(await source());
  const baseTransport = createWeatherCanarySimulationTransport(simulator);
  const transport = { dispatch: baseTransport.dispatch,
    async receipt(revision) { return { status: "applied", appliedRevision: revision - 1 }; } };
  const host = createWeatherCanaryHost({ provider: createDeterministicWeatherProvider(), transport,
    capability: requiredWeatherCanaryCapability() });
  const result = await host.refresh(config);
  assert.deepEqual(result, { status: "rejected", appliedRevision: 0,
    reason: "missing-exact-applied-revision" });
});

test("golden UI maps all 16 declared target IDs while remaining explicitly host-only", async () => {
  const simulator = createWeatherCanarySimulator(await source());
  simulator.dispatch(encodeWeatherProviderStatus({ error: true, retrySeconds: 30 }));
  const offline = weatherCanaryViewModel(simulator.slots, { location: "Chicago" });
  assert.equal(offline.status, "OFFLINE");
  assert.equal(offline.current.temperature, "--");
  const svg = renderWeatherCanaryGoldenSvg(offline);
  for (const { id } of WEATHER_MQUICKJS_TARGETS) assert.match(svg, new RegExp(`id="${id}"`, "u"));
  assert.equal(new Set(WEATHER_MQUICKJS_TARGETS.map(({ id }) => id)).size, 16);
  assert.equal(assessWeatherCanaryCapability(requiredWeatherCanaryCapability()).compatible, true);
  assert.equal(assessWeatherCanaryCapability({}).compatible, false);
});
