// ─────────────────────────────────────────────────────────────────────────────
// The device's event-object contract, verbatim.
//
// framer_mquickjs_canary.c builds the JS event object the VM hands to handlers
// (build_event_object, framer_mquickjs_canary.c:660). Field presence differs BY
// KIND — the knob event carries `delta` and `fn` but no `value`; key events
// carry `key`/`repeat`/`holdCount`/`reason`, never `id`; chords carry `chord`.
//
// The Designer's preview and simulator MUST build the same objects, or a widget
// behaves differently in preview than on the keyboard — the exact class of bug
// this project keeps paying for. This module is the single place that shape is
// defined; the simulator and the preview bridge both consume it.
// ─────────────────────────────────────────────────────────────────────────────

export const DEVICE_EVENT_NAMES = Object.freeze([
  "tick.1ms",
  "tick.100ms",
  "tick.1s",
  "input.fn-bottom-knob",
  "host.rpc",
  "input.key.down",
  "input.key.up",
  "input.key.hold",
  "input.chord.down",
  "input.chord.up",
] as const);

export type DeviceEventName = (typeof DEVICE_EVENT_NAMES)[number];

/** Loose designer-side input: `kind` (store/samples) or `name`/`type`. */
export interface DesignerEventInput {
  kind?: string;
  name?: string;
  type?: string;
  id?: number;
  value?: number;
  delta?: number;
  auxiliary?: number;
  key?: number;
  chord?: number;
  mask?: number;
  heldMask?: number;
  repeat?: boolean;
  holdCount?: number;
  reason?: number;
  sequence?: number;
  timestampMs?: number;
  synthetic?: boolean;
}

const int32 = (value: unknown): number =>
  typeof value === "number" && Number.isInteger(value) ? value | 0 : 0;

/**
 * Build the exact object a handler receives on the device.
 *
 * Returns null for names the device never delivers, so callers refuse them
 * instead of inventing an event kind the keyboard does not have.
 */
export function buildDeviceEvent(input: DesignerEventInput): Record<string, unknown> | null {
  const name = input.name ?? input.kind ?? input.type ?? "";
  if (!(DEVICE_EVENT_NAMES as readonly string[]).includes(name)) return null;

  const common = {
    type: name,
    sequence: int32(input.sequence ?? 1),
    timestampMs: int32(input.timestampMs),
    heldMask: int32(input.heldMask ?? input.mask),
    synthetic: Boolean(input.synthetic),
  };

  switch (name) {
    case "tick.1ms":
    case "tick.100ms":
    case "tick.1s":
      return { ...common, value: int32(input.value), auxiliary: int32(input.auxiliary) };
    case "input.fn-bottom-knob":
      // The device maps the record's value onto `delta` and always sets fn.
      return { ...common, delta: int32(input.delta ?? input.value), fn: true, auxiliary: int32(input.auxiliary) };
    case "host.rpc":
      return { ...common, id: int32(input.id), value: int32(input.value), auxiliary: int32(input.auxiliary) };
    case "input.key.down":
    case "input.key.up":
    case "input.key.hold":
      return {
        ...common,
        key: int32(input.key ?? input.id),
        repeat: Boolean(input.repeat ?? name === "input.key.hold"),
        holdCount: int32(input.holdCount),
        reason: int32(input.reason),
      };
    case "input.chord.down":
    case "input.chord.up":
      return { ...common, chord: int32(input.chord ?? input.mask ?? input.id), reason: int32(input.reason) };
    default:
      return null;
  }
}

/** Handler lookup key: host.rpc dispatches by id, everything else by name. */
export function deviceEventKey(input: DesignerEventInput): string | null {
  const name = input.name ?? input.kind ?? input.type ?? "";
  if (!(DEVICE_EVENT_NAMES as readonly string[]).includes(name)) return null;
  if (name === "host.rpc") return `host.rpc:${int32(input.id)}`;
  return name;
}
