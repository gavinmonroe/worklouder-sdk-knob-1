/* Logic/golden simulator for the weather3 widget source.
 *
 * Same transactional model as
 * f1-widget-sdk/examples/render-v2-mquickjs-weather-canary/simulator.mjs (which
 * is a tracked release source and is not edited here), plus the event
 * properties the pinned engine actually attaches and the settings state machine
 * reads: `delta`/`fn` for the knob, `key`/`repeat`/`holdCount`/`reason` for key
 * events and `chord`/`reason` for chord events.  See
 * experiments/mquickjs-esp32s3-canary/framer_mquickjs_canary.c
 * `create_event_object`.
 *
 * It is not a substitute for the pinned MicroQuickJS native harness.
 */

import vm from "node:vm";

const PREFIX = `"use strict";\n`;

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

export function createWeather3Simulator(source, { initialSlots } = {}) {
  if (typeof source !== "string" || !source.startsWith(PREFIX)) {
    throw new TypeError("Weather3 simulator requires exact strict F2JS source.");
  }
  const handlers = new Map();
  let loading = true;
  let active = false;
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
    name: "weather3-mquickjs-logic-golden",
    codeGeneration: { strings: false, wasm: false },
  });
  new vm.Script(source, { filename: "weather3-widget.js" }).runInContext(context, { timeout: 200 });
  loading = false;

  /** Mirrors create_event_object(): only the properties the engine attaches for
   * that event kind exist on the object the callback receives. */
  function eventObject(value) {
    const type = value.type ?? value.name;
    const common = { type, sequence: value.sequence ?? 1, timestampMs: value.timestampMs ?? 0,
      heldMask: value.heldMask ?? 0, synthetic: Boolean(value.synthetic) };
    if (type === "tick.100ms" || type === "tick.1s") {
      return Object.freeze({ ...common, value: int32(value.value ?? 0, "event.value"),
        auxiliary: int32(value.auxiliary ?? 0, "event.auxiliary") });
    }
    if (type === "input.fn-bottom-knob") {
      return Object.freeze({ ...common, delta: int32(value.delta ?? 0, "event.delta"), fn: true,
        auxiliary: int32(value.auxiliary ?? 1, "event.auxiliary") });
    }
    if (type === "host.rpc") {
      return Object.freeze({ ...common, id: value.id ?? 0,
        value: int32(value.value ?? 0, "event.value"),
        auxiliary: int32(value.auxiliary ?? 0, "event.auxiliary") });
    }
    if (type === "input.key.down" || type === "input.key.up" || type === "input.key.hold") {
      return Object.freeze({ ...common, key: value.key ?? 0, repeat: Boolean(value.repeat),
        holdCount: value.holdCount ?? 0, reason: value.reason ?? 0 });
    }
    return Object.freeze({ ...common, chord: value.chord ?? 0, reason: value.reason ?? 0 });
  }

  function dispatch(value) {
    if (!value || typeof value !== "object") throw new TypeError("Dispatch requires an event.");
    const event = eventObject(value);
    const key = event.type === "host.rpc" ? `host.rpc:${event.id}` :
      selectorKey(value.name ?? event.type);
    const callback = handlers.get(key);
    if (!callback) {
      return Object.freeze({ handled: false, committed: false, publicationRevision,
        slots: Object.freeze([...committed]) });
    }
    pending = [...committed];
    commitRequested = false;
    active = true;
    try { callback(event); } finally { active = false; }
    if (commitRequested) {
      committed = pending;
      publicationRevision++;
    }
    pending = null;
    return Object.freeze({ handled: true, committed: commitRequested, publicationRevision,
      slots: Object.freeze([...committed]) });
  }

  return Object.freeze({
    dispatch,
    dispatchAll(events) { return events.map(dispatch); },
    get handlerCount() { return handlers.size; },
    get publicationRevision() { return publicationRevision; },
    get slots() { return Object.freeze([...committed]); },
  });
}

/* ------------------------------------------------------------- event sugar */

export const rpc = (id, value, auxiliary = 0) =>
  ({ name: `host.rpc:0x${id.toString(16).toUpperCase()}`, type: "host.rpc", id, value, auxiliary });
export const tick = () => ({ name: "tick.1s", type: "tick.1s", value: 0, auxiliary: 0 });
export const knob = (delta) =>
  ({ name: "input.fn-bottom-knob", type: "input.fn-bottom-knob", delta, auxiliary: 1 });
export const keyDown = (key, heldMask) =>
  ({ name: "input.key.down", type: "input.key.down", key, heldMask });
export const keyUp = (key, heldMask, extra = {}) =>
  ({ name: "input.key.up", type: "input.key.up", key, heldMask, ...extra });
export const keyHold = (key, heldMask, holdCount) =>
  ({ name: "input.key.hold", type: "input.key.hold", key, heldMask, holdCount });
export const chordDown = () =>
  ({ name: "input.chord.down", type: "input.chord.down", chord: 0, heldMask: 3 });
export const chordUp = (extra = {}) =>
  ({ name: "input.chord.up", type: "input.chord.up", chord: 0, heldMask: 0, ...extra });

/** The exact edge sequence advance_input_to()/reconcile_chord() emit for a
 * press of both admitted keys, an optional hold, and the release. */
export function chordGesture({ holdCounts = [] } = {}) {
  const events = [keyDown(0, 1), keyDown(1, 3), chordDown()];
  for (const holdCount of holdCounts) {
    events.push(keyHold(0, 3, holdCount), keyHold(1, 3, holdCount));
  }
  events.push(keyUp(1, 1), chordUp(), keyUp(0, 0));
  return events;
}

/* Slot decoding helpers shared by the tests and the build. */
export const decodeSettings = (slots) => Object.freeze({
  zip: slots[14] & 0x1ffff,
  settingsActive: Boolean((slots[14] >>> 17) & 1),
  pendingSave: Boolean((slots[14] >>> 18) & 1),
  timer: (slots[14] >>> 19) & 31,
  saveSeq: (slots[14] >>> 24) & 0xff,
  labelIndex: (slots[2] & 15) + ((slots[2] & 16) ? 0 : 8),
  caret: slots[8] & 7,
  digits: [3, 4, 5, 6, 7].map((slot) => (slots[slot] & 15) + ((slots[slot] & 16) ? 0 : 8)),
  weatherGood: Boolean(slots[15] & 1),
  labelGood: Boolean(slots[12] & 1),
  settingsGood: Boolean(slots[13] & 1),
});
