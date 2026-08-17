import {
  assessRenderV2MQuickJsCapability,
  RENDER_V2_MQUICKJS_PROFILE,
} from "../../src/render-v2/mquickjs.mjs";
import {
  normalizeWeatherWidgetConfig,
  WEATHER_WIDGET_CONDITIONS,
} from "../../src/render-v2/weather.mjs";

import {
  encodeWeatherCanaryRevision,
  encodeWeatherProviderStatus,
  encodeWeatherVisibility,
} from "./protocol.mjs";

export const WEATHER_CANARY_DELIVERY_STATUS = Object.freeze({
  busy: "busy",
  rejected: "rejected",
  queued: "queued",
  applied: "applied",
});

export const WEATHER_CANARY_CAPABILITY_EXTENSIONS = Object.freeze({
  weatherSnapshotProtocol: "revision-stage-commit-v1",
  targetFacade: "weather-int16-targets-v1",
  deliveryReceipt: "applied-revision-v1",
  dispatchReceipt: "exact-event-applied-v1",
  hiddenScreenPolicy: "suspend-and-replay-latest-v1",
});

export function requiredWeatherCanaryCapability() {
  return Object.freeze({
    renderV2Profile: RENDER_V2_MQUICKJS_PROFILE.id,
    packageFormat: RENDER_V2_MQUICKJS_PROFILE.packageFormat,
    packageAbiSha256: RENDER_V2_MQUICKJS_PROFILE.packageAbiSha256,
    engineCommit: RENDER_V2_MQUICKJS_PROFILE.engineCommit,
    javascriptProfile: RENDER_V2_MQUICKJS_PROFILE.javascriptProfile,
    deviceEvaluatesJavaScript: true,
    deviceRunsJsdom: false,
    maxPackageBytes: String(RENDER_V2_MQUICKJS_PROFILE.maxPackageBytes),
    maxSourceBytes: String(RENDER_V2_MQUICKJS_PROFILE.maxSourceBytes),
    heapBytes: String(RENDER_V2_MQUICKJS_PROFILE.heapBytes),
    callbackDeadlineUs: String(RENDER_V2_MQUICKJS_PROFILE.callbackDeadlineUs),
    maxHandlers: String(RENDER_V2_MQUICKJS_PROFILE.maxHandlers),
    maxTargets: String(RENDER_V2_MQUICKJS_PROFILE.maxTargets),
    maxKeys: String(RENDER_V2_MQUICKJS_PROFILE.maxKeys),
    maxChords: String(RENDER_V2_MQUICKJS_PROFILE.maxChords),
    ...WEATHER_CANARY_CAPABILITY_EXTENSIONS,
  });
}

export function assessWeatherCanaryCapability(value) {
  const base = assessRenderV2MQuickJsCapability(value);
  const errors = [...base.errors];
  for (const [key, expected] of Object.entries(WEATHER_CANARY_CAPABILITY_EXTENSIONS)) {
    if (value?.[key] !== expected) errors.push(`${key} must equal ${JSON.stringify(expected)}.`);
  }
  return Object.freeze({ compatible: errors.length === 0, profileId: base.profileId,
    errors: Object.freeze(errors) });
}

function condition(id, isDay = true) {
  const value = WEATHER_WIDGET_CONDITIONS[id];
  return Object.freeze({ ...value, label: isDay ? value.dayLabel : value.nightLabel, isDay });
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

/** Deterministic provider for tests/demos. It performs no DNS, fetch, or other network I/O. */
export function createDeterministicWeatherProvider({ failures = 0, failureCalls = [] } = {}) {
  if (!Number.isInteger(failures) || failures < 0) throw new TypeError("failures must be a nonnegative integer.");
  if (!Array.isArray(failureCalls) || failureCalls.some((value) => !Number.isInteger(value) || value < 1)) {
    throw new TypeError("failureCalls must contain positive call numbers.");
  }
  const failAt = new Set(failureCalls);
  let remainingFailures = failures;
  let calls = 0;
  return Object.freeze({
    async lookup(configValue) {
      calls++;
      if (remainingFailures > 0 || failAt.has(calls)) {
        remainingFailures--;
        if (remainingFailures < 0) remainingFailures = 0;
        throw Object.assign(new Error("Deterministic provider outage."), { code: "FAKE_PROVIDER_UNAVAILABLE" });
      }
      const config = normalizeWeatherWidgetConfig(configValue);
      const digits = [...config.postalCode].filter((value) => /\d/u.test(value)).map(Number);
      const seed = digits.reduce((sum, value) => sum + value, 0);
      const current = 32 + seed;
      const places = Object.freeze({ "60601": "Chicago", "00501": "Holtsville", "10001": "New York" });
      return deepFreeze({
        format: "framer-render-v2-weather-snapshot-v1",
        config,
        location: { name: places[config.postalCode] ?? `ZIP ${config.postalCode}`,
          region: "Deterministic", countryCode: config.countryCode, latitude: 0, longitude: 0,
          timezone: "Etc/UTC" },
        updatedAt: "2026-08-17T12:00",
        current: { temperature: current, condition: condition(seed % 8, true) },
        days: [0, 1, 2].map((index) => ({ date: `2026-08-${18 + index}`,
          weekdayId: (2 + index) % 7, weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][(2 + index) % 7],
          low: current - 11 + index * 2, high: current - 2 + index * 3,
          condition: condition((seed + index + 1) % 8, true) })),
      });
    },
    get calls() { return calls; },
  });
}

function deliveryResult(status, appliedRevision, extra = {}) {
  return Object.freeze({ status, appliedRevision, ...extra });
}

/** Wraps the logic simulator in the receipt boundary real firmware must implement. */
export function createWeatherCanarySimulationTransport(simulator, { intercept = null } = {}) {
  if (!simulator || typeof simulator.dispatch !== "function") throw new TypeError("Simulator transport requires dispatch().");
  return Object.freeze({
    async dispatch(event) {
      const override = intercept ? await intercept(event) : null;
      if (override) return override;
      const result = simulator.dispatch(event);
      return Object.freeze({ status: result.committed ? "applied" : "accepted",
        eventName: event.name, eventId: event.id ?? 0, value: event.value ?? 0,
        auxiliary: event.auxiliary ?? 0, handled: result.handled,
        committed: result.committed, publicationRevision: result.publicationRevision,
        appliedRevision: simulator.slots[0] });
    },
    async receipt(revision) {
      const appliedRevision = simulator.slots[0];
      return Object.freeze({ status: appliedRevision === revision ? "applied" : "rejected",
        appliedRevision });
    },
  });
}

function assessDispatchReceipt(response, event, { requireApplied = false,
  expectedAppliedRevision = null } = {}) {
  if (response?.status === "busy" || response?.status === "queued") {
    return Object.freeze({ ok: false, status: response.status, reason: `transport-${response.status}` });
  }
  if (response?.status === "rejected") {
    return Object.freeze({ ok: false, status: "rejected",
      reason: response.reason ?? "transport-rejected" });
  }
  const exactEvent = (response?.status === "accepted" || response?.status === "applied") &&
    response.eventName === event.name && response.eventId === (event.id ?? 0) &&
    response.value === (event.value ?? 0) && response.auxiliary === (event.auxiliary ?? 0) &&
    response.handled === true;
  if (!exactEvent) return Object.freeze({ ok: false, status: "rejected",
    reason: "missing-exact-dispatch-receipt" });
  if (requireApplied && (response.status !== "applied" || response.committed !== true ||
      response.appliedRevision !== expectedAppliedRevision)) {
    return Object.freeze({ ok: false, status: "rejected",
      reason: "missing-exact-control-application" });
  }
  return Object.freeze({ ok: true, status: response.status });
}

/**
 * ZIP/provider + delivery state machine. The host owns network policy; the
 * keyboard sees only bounded scalar RPC records. One latest snapshot is queued.
 */
export function createWeatherCanaryHost({ provider, transport, capability,
  retryAfterSeconds = 30, initialAppliedRevision = 0 } = {}) {
  if (!provider || typeof provider.lookup !== "function") throw new TypeError("Weather host requires provider.lookup().");
  if (!transport || typeof transport.dispatch !== "function" || typeof transport.receipt !== "function") {
    throw new TypeError("Weather host requires transport dispatch() and receipt().");
  }
  if (!Number.isInteger(retryAfterSeconds) || retryAfterSeconds < 1 || retryAfterSeconds > 86_400) {
    throw new TypeError("retryAfterSeconds must be in 1..86400.");
  }
  if (!Number.isInteger(initialAppliedRevision) || initialAppliedRevision < 0 ||
      initialAppliedRevision >= 0x7fffffff) {
    throw new TypeError("initialAppliedRevision must be in 0..2147483646.");
  }
  const capabilityAssessment = assessWeatherCanaryCapability(capability);
  let nextRevision = initialAppliedRevision + 1;
  let appliedRevision = initialAppliedRevision;
  let fetching = false;
  let delivering = false;
  let visible = true;
  let requestedVisible = true;
  let queued = null;
  let pendingProviderStatus = null;
  let lastStatus = "idle";
  let operationTail = Promise.resolve();
  let pendingOperations = 0;
  let deliveryReserved = false;
  let visibilityPending = null;

  function serialize(operation) {
    pendingOperations++;
    const result = operationTail.then(operation, operation);
    operationTail = result.then(() => undefined, () => undefined);
    return result.finally(() => { pendingOperations--; });
  }

  function queue(item) {
    if (!queued || item.revision > queued.revision) queued = item;
    lastStatus = WEATHER_CANARY_DELIVERY_STATUS.queued;
    return deliveryResult(lastStatus, appliedRevision, { queuedRevision: queued.revision });
  }

  async function deliver(item) {
    if (!visible) return queue(item);
    delivering = true;
    try {
      for (const event of encodeWeatherCanaryRevision(item.snapshot, { revision: item.revision })) {
        const response = await transport.dispatch(event);
        const dispatch = assessDispatchReceipt(response, event);
        if (dispatch.status === "busy" || dispatch.status === "queued") return queue(item);
        if (!dispatch.ok) {
          lastStatus = WEATHER_CANARY_DELIVERY_STATUS.rejected;
          return deliveryResult(lastStatus, appliedRevision, { reason: dispatch.reason });
        }
      }
      const receipt = await transport.receipt(item.revision);
      if (receipt?.status === "applied" && receipt.appliedRevision === item.revision) {
        appliedRevision = item.revision;
        if (queued?.revision === item.revision) queued = null;
        lastStatus = WEATHER_CANARY_DELIVERY_STATUS.applied;
        return deliveryResult(lastStatus, appliedRevision);
      }
      if (receipt?.status === "busy" || receipt?.status === "queued") return queue(item);
      lastStatus = WEATHER_CANARY_DELIVERY_STATUS.rejected;
      return deliveryResult(lastStatus, appliedRevision, { reason: "missing-exact-applied-revision" });
    } finally {
      delivering = false;
    }
  }

  function runDelivery(item) {
    deliveryReserved = true;
    return serialize(async () => {
      try { return await deliver(item); }
      finally { deliveryReserved = false; }
    });
  }

  async function submit(snapshot) {
    if (nextRevision > 0x7fffffff) {
      lastStatus = WEATHER_CANARY_DELIVERY_STATUS.rejected;
      return deliveryResult(lastStatus, appliedRevision, { reason: "revision-exhausted" });
    }
    const item = Object.freeze({ revision: nextRevision++, snapshot });
    return requestedVisible && visible && !deliveryReserved && !queued ? runDelivery(item) : queue(item);
  }

  async function applyControl(event, label) {
    const response = await transport.dispatch(event);
    const dispatch = assessDispatchReceipt(response, event,
      { requireApplied: true, expectedAppliedRevision: appliedRevision });
    if (dispatch.ok) return Object.freeze({ ok: true });
    return Object.freeze({ ok: false, reason: `${label}-not-applied`,
      transportReason: dispatch.reason, transportStatus: dispatch.status });
  }

  async function reportProviderError(error) {
    const event = encodeWeatherProviderStatus({ error: true, retrySeconds: retryAfterSeconds });
    if (requestedVisible && visible) {
      const control = await serialize(() => applyControl(event, "provider-status"));
      if (!control.ok) {
        lastStatus = WEATHER_CANARY_DELIVERY_STATUS.rejected;
        return deliveryResult(lastStatus, appliedRevision, { reason: control.reason,
          transportReason: control.transportReason, transportStatus: control.transportStatus,
          retrySeconds: retryAfterSeconds, errorCode: error?.code ?? "WEATHER_PROVIDER_FAILED" });
      }
    } else {
      pendingProviderStatus = event;
    }
    lastStatus = WEATHER_CANARY_DELIVERY_STATUS.rejected;
    return deliveryResult(lastStatus, appliedRevision, { reason: "provider-error",
      retrySeconds: retryAfterSeconds, errorCode: error?.code ?? "WEATHER_PROVIDER_FAILED",
      providerStatusQueued: Boolean(pendingProviderStatus) });
  }

  async function flushQueued() {
    if (!requestedVisible || !visible || deliveryReserved || !queued) return deliveryResult(
      queued ? WEATHER_CANARY_DELIVERY_STATUS.queued : lastStatus, appliedRevision,
      queued ? { queuedRevision: queued.revision } : {});
    const item = queued;
    queued = null;
    return runDelivery(item);
  }

  return Object.freeze({
    async refresh(configValue) {
      if (!capabilityAssessment.compatible) {
        lastStatus = WEATHER_CANARY_DELIVERY_STATUS.rejected;
        return deliveryResult(lastStatus, appliedRevision, { reason: "capability-mismatch",
          errors: capabilityAssessment.errors });
      }
      if (fetching) return deliveryResult(WEATHER_CANARY_DELIVERY_STATUS.busy, appliedRevision);
      let config;
      try { config = normalizeWeatherWidgetConfig(configValue); }
      catch (error) {
        lastStatus = WEATHER_CANARY_DELIVERY_STATUS.rejected;
        return deliveryResult(lastStatus, appliedRevision, { reason: "invalid-config", errorCode: error.code });
      }
      fetching = true;
      try { return await submit(await provider.lookup(config)); }
      catch (error) { return reportProviderError(error); }
      finally { fetching = false; }
    },
    async submit(snapshot) {
      if (!capabilityAssessment.compatible) return deliveryResult(
        WEATHER_CANARY_DELIVERY_STATUS.rejected, appliedRevision, { reason: "capability-mismatch" });
      return submit(snapshot);
    },
    flush: flushQueued,
    async setVisible(nextVisible, { elapsedSeconds = 0 } = {}) {
      if (typeof nextVisible !== "boolean") throw new TypeError("visible must be boolean.");
      if (nextVisible === requestedVisible) {
        return visibilityPending ?? deliveryResult(lastStatus, appliedRevision);
      }
      requestedVisible = nextVisible;
      const transition = serialize(async () => {
        const control = await applyControl(encodeWeatherVisibility(
          { visible: nextVisible, elapsedSeconds }), "visibility");
        if (!control.ok) {
          if (requestedVisible === nextVisible) requestedVisible = visible;
          lastStatus = WEATHER_CANARY_DELIVERY_STATUS.rejected;
          return deliveryResult(lastStatus, appliedRevision, { reason: control.reason,
            transportReason: control.transportReason, transportStatus: control.transportStatus,
            requestedVisible: nextVisible });
        }
        visible = nextVisible;
        if (!nextVisible) return deliveryResult(lastStatus, appliedRevision);
        if (pendingProviderStatus) {
          const providerControl = await applyControl(pendingProviderStatus, "provider-status");
          if (!providerControl.ok) {
            lastStatus = WEATHER_CANARY_DELIVERY_STATUS.rejected;
            return deliveryResult(lastStatus, appliedRevision, { reason: providerControl.reason,
              transportReason: providerControl.transportReason,
              transportStatus: providerControl.transportStatus });
          }
          pendingProviderStatus = null;
        }
        if (!queued || deliveryReserved) return deliveryResult(lastStatus, appliedRevision,
          queued ? { queuedRevision: queued.revision } : {});
        const item = queued;
        queued = null;
        deliveryReserved = true;
        try { return await deliver(item); }
        finally { deliveryReserved = false; }
      });
      visibilityPending = transition;
      try { return await transition; }
      finally { if (visibilityPending === transition) visibilityPending = null; }
    },
    get state() {
      return Object.freeze({ status: lastStatus,
        busy: fetching || delivering || pendingOperations > 0, visible, requestedVisible,
        queuedRevision: queued?.revision ?? null, appliedRevision,
        capabilityCompatible: capabilityAssessment.compatible });
    },
  });
}
