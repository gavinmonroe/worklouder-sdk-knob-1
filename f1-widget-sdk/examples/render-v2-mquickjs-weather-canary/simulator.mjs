import vm from "node:vm";

import { RENDER_V2_MQUICKJS_SOURCE_PREFIX } from "../../src/render-v2/mquickjs.mjs";

function int32(value, label) {
  if (!Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff) {
    throw new TypeError(`${label} must be a signed int32.`);
  }
  return value | 0;
}

function selectorKey(value) {
  const text = String(value);
  if (!text.startsWith("host.rpc:")) return text;
  const id = Number(text.slice("host.rpc:".length));
  if (!Number.isInteger(id) || id < 1 || id > 0xffff) throw new TypeError("Invalid host RPC selector.");
  return `host.rpc:${id}`;
}

/**
 * Logic/golden simulator only. It models callback transactionality but is not a
 * substitute for the pinned MicroQuickJS native harness or physical firmware.
 */
export function createWeatherCanarySimulator(source, { initialSlots } = {}) {
  if (typeof source !== "string" || !source.startsWith(RENDER_V2_MQUICKJS_SOURCE_PREFIX)) {
    throw new TypeError("Weather simulator requires exact strict F2JS source.");
  }
  const handlers = new Map();
  let loading = true;
  let active = false;
  if (initialSlots !== undefined &&
      (!Array.isArray(initialSlots) || initialSlots.length !== 16)) {
    throw new TypeError("Weather simulator initialSlots must contain exactly 16 int32 values.");
  }
  let committed = initialSlots === undefined ? Array(16).fill(0) :
    initialSlots.map((value) => int32(value, "initialSlots value"));
  let pending = null;
  let commitRequested = false;
  let publicationRevision = 0;

  const widget = Object.freeze({
    on(name, callback) {
      if (!loading || typeof callback !== "function") throw new TypeError("widget.on is load-only.");
      const key = selectorKey(name);
      if (handlers.has(key) || handlers.size >= 16) throw new TypeError("Duplicate or excessive handler.");
      handlers.set(key, callback);
    },
    getInt(slot) {
      if (!active || !Number.isInteger(slot) || slot < 0 || slot > 15) {
        throw new TypeError("widget.getInt requires an active callback and slot 0..15.");
      }
      return pending[slot];
    },
    setInt(slot, value) {
      if (!active || !Number.isInteger(slot) || slot < 0 || slot > 15) {
        throw new TypeError("widget.setInt requires an active callback and slot 0..15.");
      }
      pending[slot] = int32(value, "widget.setInt value");
    },
    commit() {
      if (!active) throw new TypeError("widget.commit requires an active callback.");
      commitRequested = true;
    },
    isHeld(event, keyId) {
      if (!active || !Number.isInteger(keyId) || keyId < 0 || keyId > 15) {
        throw new TypeError("widget.isHeld requires an active callback and key 0..15.");
      }
      return Boolean((event.heldMask >>> keyId) & 1);
    },
  });
  const context = vm.createContext(Object.freeze({ widget }), {
    name: "weather-mquickjs-logic-golden",
    codeGeneration: { strings: false, wasm: false },
  });
  new vm.Script(source, { filename: "weather-widget.js" }).runInContext(context, { timeout: 100 });
  loading = false;

  function dispatch(eventValue) {
    if (!eventValue || typeof eventValue !== "object") throw new TypeError("Dispatch requires an event.");
    const event = Object.freeze({ type: eventValue.type ?? eventValue.name,
      id: eventValue.id ?? 0, value: int32(eventValue.value ?? 0, "event.value"),
      auxiliary: int32(eventValue.auxiliary ?? 0, "event.auxiliary"),
      sequence: eventValue.sequence ?? 1, timestampMs: eventValue.timestampMs ?? 0,
      heldMask: eventValue.heldMask ?? 0, synthetic: Boolean(eventValue.synthetic) });
    const key = event.type === "host.rpc" ? `host.rpc:${event.id}` : selectorKey(eventValue.name ?? event.type);
    const callback = handlers.get(key);
    if (!callback) return Object.freeze({ handled: false, committed: false,
      publicationRevision, slots: Object.freeze([...committed]) });
    pending = [...committed];
    commitRequested = false;
    active = true;
    try { callback(event); } finally { active = false; }
    if (commitRequested) {
      committed = pending;
      publicationRevision++;
    }
    pending = null;
    return Object.freeze({ handled: true, committed: commitRequested,
      publicationRevision, slots: Object.freeze([...committed]) });
  }

  return Object.freeze({
    dispatch,
    dispatchAll(events) { return events.map(dispatch); },
    get handlerCount() { return handlers.size; },
    get publicationRevision() { return publicationRevision; },
    get slots() { return Object.freeze([...committed]); },
  });
}
