// ─────────────────────────────────────────────────────────────────────────────
// Browser-friendly port of the MicroQuickJS widget engine.
//
// Same semantics as f1-widget-sdk's `simulator.mjs`:
//   - handlers map selector → user callback registered during loading
//   - dispatch() materialises a pending slots[] snapshot, runs the callback
//     inside an active frame (in which widget.getInt/setInt are valid), and
//     commits the snapshot iff widget.commit() was called.
//   - use new Function() with a contextualised `widget` so the user source
//     sees the loading shim during registration and the active shim during
//     dispatch.
// ─────────────────────────────────────────────────────────────────────────────


import { buildDeviceEvent, deviceEventKey } from "./deviceEvent";
import {
  parseWidgetScript,
  ParsedScript,
} from "./scriptParser";

import {
  RENDER_V2_MQUICKJS_SOURCE_PREFIX,
} from "./constants";

export interface DispatchResult {
  handled: boolean;
  committed: boolean;
  publicationRevision: number;
  slots: number[];
  error?: string;
}

const SOURCE_PREFIX = RENDER_V2_MQUICKJS_SOURCE_PREFIX;

const int32 = (v: unknown): number => {
  // Narrow before comparing: `unknown` cannot be ordered or bit-shifted, and
  // Number.isInteger alone does not tell the compiler that.
  if (typeof v !== "number" || !Number.isInteger(v) || v < -0x80000000 || v > 0x7fffffff) {
    throw new TypeError(`expected signed int32, got ${v}`);
  }
  return v | 0;
};

const keyFor = (name: string): string => {
  const text = String(name);
  if (!text.startsWith("host.rpc:")) return text;
  const id = Number(text.slice("host.rpc:".length));
  if (!Number.isInteger(id) || id < 1 || id > 0xffff) throw new TypeError("Bad host.rpc selector.");
  return `host.rpc:${id}`;
};

type UserHandler = (event: any) => void;

export interface SimulatorOptions {
  initialSlots?: number[];
  onError?: (message: string) => void;
  /** When true, evaluate the source with new Function() in strict mode. */
  strict?: boolean;
}

export function createMquickjsSimulator(source: string, opts: SimulatorOptions = {}) {
  if (typeof source !== "string" || !source.startsWith(SOURCE_PREFIX)) {
    throw new TypeError("Simulator requires exact strict F2JS source.");
  }
  if (opts.initialSlots && (!Array.isArray(opts.initialSlots) || opts.initialSlots.length !== 16)) {
    throw new TypeError("initialSlots must contain exactly 16 int32 values.");
  }

  // The metadata parser understands the small authoring DSL, but the device VM
  // is real ES5 — the live weather widget uses arrays and function declarations
  // the DSL parser rejects. Parsing is therefore best-effort inspector fodder,
  // never an execution gate: what decides whether a script runs is the same
  // thing that decides on the keyboard, evaluating it.
  let parsed: ParsedScript;
  try {
    parsed = parseWidgetScript(source);
  } catch {
    const handlerNames = [...source.matchAll(/widget\.on\(\s*"([^"]+)"/gu)].map((m) => m[1]);
    const states = [...source.matchAll(/^var\s+([A-Za-z_$][\w$]*)\s*=\s*(-?\d+)\s*;/gmu)]
      .slice(0, 16)
      .map(([, name, initial]) => ({ name, initial: Number(initial) }));
    parsed = {
      states,
      handlers: handlerNames.map((selector) => ({ selector, body: "", byteLength: 0 })),
    } as ParsedScript;
  }

  const handlers = new Map<string, UserHandler>();
  let loading = true;
  let active = false;
  let pending: number[] | null = null;
  let commitRequested = false;
  let publicationRevision = 0;
  let committed: number[] = opts.initialSlots
    ? opts.initialSlots.map((v) => int32(v))
    : Array(16).fill(0);

  const widgetLoad = {
    on(name: string, callback: (event: any) => void) {
      if (!loading || typeof callback !== "function") throw new TypeError("widget.on is load-only.");
      const key = keyFor(name);
      if (handlers.has(key)) throw new TypeError(`Duplicate handler for ${key}.`);
      if (handlers.size >= 16) throw new TypeError("Handler budget exceeded.");
      handlers.set(key, callback);
    },
    keys(...names: string[]) {
      // Load-time declaration of the admitted key set (any-key input). The
      // simulator validates the shape; token resolution and the 16-key cap
      // are the transpiler's job, and key events here are injected samples.
      if (!loading) throw new TypeError("widget.keys is load-only.");
      if (names.length === 0 || names.some((n) => typeof n !== "string")) {
        throw new TypeError("widget.keys takes 1..16 string key names.");
      }
    },
    isHeld(event: any, keyId: number) {
      if (!active) throw new TypeError("widget.isHeld requires active callback.");
      if (!Number.isInteger(keyId) || keyId < 0 || keyId > 15) throw new TypeError("keyId must be 0..15.");
      return Boolean(((event?.heldMask ?? 0) >>> keyId) & 1);
    },
  };

  // Load the user source. They capture `widget` as a free variable. A DSL
  // script may also reference `document`; on the device there is no DOM, so the
  // stub accepts writes and drops them — the transpiler maps them onto mailbox
  // slots before anything reaches hardware.
  const documentStub = {
    querySelector: () => ({ textContent: "", style: { color: "" }, hidden: false }),
    getElementById: () => ({ textContent: "", style: { color: "" }, hidden: false }),
  };
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const fn = new Function("widget", "document", source);
    fn(widgetLoad, documentStub);
  } catch (err) {
    throw new Error("Widget script failed to compile: " + (err as Error).message);
  }
  loading = false;

  /**
   * Because the user callback is a closure created during loading, it
   * captured the load-time `widget` object. To make getInt/setInt/commit
   * behave per-dispatch, we wrap the *handler invocation* inside a fresh
   * Function that binds `widget` to an active shim, then re-enters the
   * same body. This requires the handler body to be serializable
   * textually — which it isn't if it referenced outer closure variables.
   *
   * The SDK's weather canary only refers to module-level `var`s, so the
   * test pages would work this way. For the designer we keep handlers as
   * closures and re-route getInt/setInt/commit through the active snapshot
   * via a small interceptor:
   *   - The user callback's body runs unchanged.
   *   - We make `widget.getInt` / `setInt` / `commit` resolve at call time
   *     by patching the widgetLoad object's getter functions. Because JS
   *     doesn't allow swapping object bindings mid-call, we instead run the
   *     handler body inside a `Function('widget','event', '...rest of body')`
   *     wrapper using parsed parsed handler bodies.
   *
   * But because the SDK's parser is structural and exposes exactly what we
   * need, we re-evaluate the **source** during dispatch with a new `widget`
   * binding that toggles between load-time and active behaviour. The user
   * callback closures however still point to widgetLoad; we patch the
   * load-time widget so that, during a dispatch frame, widgetLoad.* forwards
   * through the active shim. That's the trick used in node vm - here we
   * just mutate the load-time widget's methods at dispatch start.
   */
  const widgetDispatch = {
    on: widgetLoad.on, // never called here but typed-complete
    keys: widgetLoad.keys,
    getInt(slot: number) {
      if (!active) throw new TypeError("widget.getInt requires active callback.");
      if (!Number.isInteger(slot) || slot < 0 || slot > 15) throw new TypeError("slot must be 0..15.");
      return pending![slot];
    },
    setInt(slot: number, value: number) {
      if (!active) throw new TypeError("widget.setInt requires active callback.");
      if (!Number.isInteger(slot) || slot < 0 || slot > 15) throw new TypeError("slot must be 0..15.");
      pending![slot] = int32(value);
    },
    commit() {
      if (!active) throw new TypeError("widget.commit requires active callback.");
      commitRequested = true;
    },
    isHeld: widgetLoad.isHeld,
  };

  // Patch the load-time widget so any closure that captured it sees the
  // active methods during dispatch.
  (widgetLoad as any).getInt = (slot: number) => widgetDispatch.getInt(slot);
  (widgetLoad as any).setInt = (slot: number, value: number) => widgetDispatch.setInt(slot, value);
  (widgetLoad as any).commit = () => widgetDispatch.commit();

  function dispatch(eventValue: any): DispatchResult {
    if (!eventValue || typeof eventValue !== "object") {
      throw new TypeError("Dispatch requires an event object.");
    }
    // The store and samples carry `kind`; older callers carried `name`/`type`.
    // The device contract also shapes fields per kind (knob gets `delta`, keys
    // get `key`, chords get `chord`) — buildDeviceEvent is the single source of
    // that shape, so preview and device cannot diverge.
    const key = deviceEventKey(eventValue);
    const deviceEvent = key === null ? null : buildDeviceEvent(eventValue);
    const callback = key === null ? undefined : handlers.get(key);
    if (!callback || !deviceEvent) {
      return {
        handled: false,
        committed: false,
        publicationRevision,
        slots: committed.slice(),
      };
    }

    const event = Object.freeze(deviceEvent);

    pending = committed.slice();
    commitRequested = false;
    active = true;
    let error: string | undefined;
    try {
      try {
        callback(event);
      } catch (err) {
        error = (err as Error).message;
        opts.onError?.(error);
      }
    } finally {
      active = false;
    }

    if (commitRequested) {
      committed = pending!;
      publicationRevision++;
    }
    pending = null;
    return {
      handled: true,
      committed: commitRequested,
      publicationRevision,
      slots: committed.slice(),
      error,
    };
  }

  return {
    dispatch,
    dispatchAll(events: any[]) { return events.map(dispatch); },
    get handlerCount() { return handlers.size; },
    get declaredKeyCount() {
      return [...handlers.keys()].filter((k) => k.startsWith("input.key.") || k === "key").length;
    },
    get declaredChordCount() {
      return [...handlers.keys()].filter((k) => k.startsWith("input.chord.") || k === "chord").length;
    },
    get slots() { return committed.slice(); },
    get publicationRevision() { return publicationRevision; },
    get states() { return parsed.states.slice(); },
    get handlers() { return parsed.handlers.slice(); },
    get parsed() { return parsed; },
    reset(initialSlots?: number[]) {
      committed = initialSlots
        ? initialSlots.map((v) => int32(v))
        : Array(16).fill(0);
      publicationRevision = 0;
      pending = null;
      commitRequested = false;
      active = false;
    },
  };
}
