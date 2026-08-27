// ─────────────────────────────────────────────────────────────────────────────
// The in-editor event reference: all nine device event kinds, the exact fields
// each event object carries, and an insertable idiomatic handler for each.
//
// FIELDS ARE DERIVED, NEVER HAND-LISTED. buildDeviceEvent (compiler/
// deviceEvent.ts, read-only) is the verbatim device contract — it builds the
// exact object a handler receives on the keyboard. This module calls it once
// per kind with a representative input and Object.keys()-es the result, so the
// documented field inventory can never drift from the device. Only the
// one-line EXPLANATIONS are hand-written, keyed by field name; a field the
// contract grows later renders bare rather than invented.
//
// (The EVENT_API list in the frozen compiler/constants.ts is stale on key
// events — it names `id`/`flags` where the device delivers `key`/`repeat`/
// `holdCount`/`reason` — which is exactly why nothing here reads it.)
// ─────────────────────────────────────────────────────────────────────────────

import {
  buildDeviceEvent,
  DEVICE_EVENT_NAMES,
  type DesignerEventInput,
  type DeviceEventName,
} from "../compiler/deviceEvent";
import type { SimulatedEvent } from "../types";

export type EventFamily = "tick" | "input" | "host";

export interface EventFieldDoc {
  name: string;
  /** One-line plain-language explanation; null when the contract carries a
   *  field this module has no words for (render bare, never invent). */
  doc: string | null;
}

export interface EventReferenceEntry {
  kind: DeviceEventName;
  /** What the author writes inside widget.on — host.rpc parameterizes. */
  selector: string;
  family: EventFamily;
  /** When it fires, in one or two sentences. */
  blurb: string;
  /** Kind-specific payload fields (COMMON_EVENT_FIELDS excluded). */
  fields: EventFieldDoc[];
  /** Insertable, transpilable device-DSL handler. */
  snippet: string;
  /** Top-of-script declaration the snippet leans on (inserted only when the
   *  buffer does not already declare that state var). */
  prelude?: string;
  /** Sample event for the one-click "Fire sample" action. */
  sample: SimulatedEvent;
  sampleLabel: string;
}

// ── Representative inputs (one per kind, payload fields populated) ──────────

const REPRESENTATIVE: Record<DeviceEventName, DesignerEventInput> = {
  "tick.100ms": { kind: "tick.100ms" },
  "tick.1s": { kind: "tick.1s" },
  "input.fn-bottom-knob": { kind: "input.fn-bottom-knob", delta: 1 },
  "host.rpc": { kind: "host.rpc", id: 0xb241, value: 72, auxiliary: 1 },
  "input.key.down": { kind: "input.key.down", key: 0 },
  "input.key.up": { kind: "input.key.up", key: 0 },
  "input.key.hold": { kind: "input.key.hold", key: 0, holdCount: 1 },
  "input.chord.down": { kind: "input.chord.down", chord: 0b0011 },
  "input.chord.up": { kind: "input.chord.up", chord: 0b0011 },
};

// ── Hand-written one-liners, keyed by field name ────────────────────────────
// Kind-specific overrides first (`kind.field`), then the generic meaning.

const FIELD_DOCS: Record<string, string> = {
  type: "The event's kind string — the same selector you passed to widget.on.",
  sequence: "Monotonic counter — increments once per delivered event.",
  timestampMs: "Device uptime in milliseconds when the event fired.",
  heldMask: "Which keys are being held right now, packed into one number. You never have to unpack it: widget.isHeld(0) asks about the first key you named, widget.isHeld(1) the second.",
  synthetic: "True when tooling injected the event; false for real hardware input.",
  value: "First 32-bit integer payload.",
  auxiliary: "Second 32-bit integer payload.",
  delta: "Signed detent count — positive per clockwise click, negative counter-clockwise, never 0.",
  fn: "Always true — this event only fires while Fn is held.",
  id: "The host RPC id the packet was addressed to — matches your host.rpc:<id> selector.",
  key: "Which key fired, as a position in the list you passed to widget.keys(…): 0 is the first key you named, 1 the second. (No widget.keys line? The list is space, shift, then every other key.) It is a number, not a letter — turn it into words with pick(event.key, …).",
  repeat: "False on a first down edge; true for auto-repeats (always true on hold).",
  holdCount: "How many hold cadences this key has been down — climbs while held.",
  reason: "Firmware reason code for the edge (0 = normal input).",
  chord: "Which chord fired. The keyboard wires exactly one — the first two keys you named, held together in any order — so this is always the same value.",
};

const KIND_FIELD_DOCS: Record<string, Record<string, string>> = {
  "tick.100ms": {
    value: "Reserved — always 0 on ticks.",
    auxiliary: "Reserved — always 0 on ticks.",
  },
  "tick.1s": {
    value: "Reserved — always 0 on ticks.",
    auxiliary: "Reserved — always 0 on ticks.",
  },
  "input.fn-bottom-knob": {
    auxiliary: "Reserved — 0 on knob events.",
  },
  "host.rpc": {
    value: "The packet's main number — whatever your feeder sent as “value”.",
    auxiliary: "The packet's second number — 0 when the sender set none.",
  },
};

function docFor(kind: DeviceEventName, field: string): string | null {
  return KIND_FIELD_DOCS[kind]?.[field] ?? FIELD_DOCS[field] ?? null;
}

// ── Derived field inventory ─────────────────────────────────────────────────

const FIELDS_BY_KIND: Record<DeviceEventName, string[]> = (() => {
  const out = {} as Record<DeviceEventName, string[]>;
  for (const kind of DEVICE_EVENT_NAMES) {
    const built = buildDeviceEvent(REPRESENTATIVE[kind]);
    out[kind] = built ? Object.keys(built) : [];
  }
  return out;
})();

/** Fields EVERY kind carries (the intersection across the contract). */
export const COMMON_EVENT_FIELDS: EventFieldDoc[] = (() => {
  const lists = Object.values(FIELDS_BY_KIND);
  const common = lists[0]?.filter((f) => lists.every((l) => l.includes(f))) ?? [];
  return common.map((name) => ({ name, doc: FIELD_DOCS[name] ?? null }));
})();

const COMMON_NAMES = new Set(COMMON_EVENT_FIELDS.map((f) => f.name));

function specificFields(kind: DeviceEventName): EventFieldDoc[] {
  return FIELDS_BY_KIND[kind]
    .filter((name) => !COMMON_NAMES.has(name))
    .map((name) => ({ name, doc: docFor(kind, name) }));
}

// ── Blurbs + snippets (idiomatic, transpilable DSL, mirroring the presets) ──
// Every snippet ends by writing a DOM target; the ones that keep state name
// the top-of-script `var` they lean on in `prelude`, inserted only when the
// buffer does not already declare it.

const ENTRY_META: Record<
  DeviceEventName,
  { blurb: string; snippet: string; prelude?: string; sampleLabel: string; sample: SimulatedEvent }
> = {
  "tick.100ms": {
    blurb: "Fires 10× per second while the widget is on screen — the high-cadence timer for animation and fast counters.",
    prelude: "var spin = 0;",
    snippet: `widget.on("tick.100ms", function (event) {
  // 10 Hz timer. mod() keeps the counter cycling in range.
  spin = mod(spin + 1, 4);
  document.querySelector("#value").textContent = pick(spin, "N", "E", "S", "W");
});`,
    sampleLabel: "tick.100ms",
    sample: { kind: "tick.100ms", displayName: "tick.100ms" },
  },
  "tick.1s": {
    blurb: "Fires once per second. Every widget wants this heartbeat: republishing your targets each second keeps the device painting from the first second after boot.",
    prelude: "var value = 0;",
    snippet: `widget.on("tick.1s", function (event) {
  // 1 Hz heartbeat — republish your targets every second so the
  // device paints from boot (the facade only draws after a publish).
  document.querySelector("#value").textContent = digits(value, 3);
});`,
    sampleLabel: "tick.1s",
    sample: { kind: "tick.1s", displayName: "tick.1s" },
  },
  "input.fn-bottom-knob": {
    blurb: "The bottom rotary knob, turned while Fn is held. Each detent delivers one event carrying the signed step.",
    prelude: "var value = 0;",
    snippet: `widget.on("input.fn-bottom-knob", function (event) {
  // event.delta is signed: +1 per clockwise detent, -1 the other way.
  value = clamp(value + event.delta, 0, 999);
  document.querySelector("#value").textContent = digits(value, 3);
});`,
    sampleLabel: "knob +1",
    sample: { kind: "input.fn-bottom-knob", delta: 1, displayName: "fn+knob △1" },
  },
  "host.rpc": {
    blurb: "Data arriving from outside the widget, as two numbers: event.value and event.auxiliary. Two sources: feeds YOU define in the Source tab's Host data section (sent from your computer), and feeds the KEYBOARD publishes by itself — subscribe to \"device.typing-speed\" and your live words-per-minute arrives every second with nothing running on your computer.",
    prelude: "var value = 0;",
    snippet: `widget.on("device.typing-speed", function (event) {
  // Straight from the keyboard: words per minute, once a second.
  value = clamp(event.value, 0, 999);
  document.querySelector("#value").textContent = digits(value, 3);
});`,
    sampleLabel: "host.rpc 0xB201 ← 7",
    sample: { kind: "host.rpc", id: 0xb201, value: 7, displayName: "0xB201 ← 7" },
  },
  "input.key.down": {
    blurb: "A key was pressed — the down edge, once per press. Every key on the keyboard reaches your widget by default, and event.key says which one: it counts down the list you write in widget.keys(\"space\", \"a\", \"any\"), so \"space\" there is 0 and \"a\" is 1. Name up to 16 keys — space, enter, esc, tab, backspace, shift, ctrl, alt, gui, arrows, a-z, 0-9 — and \"any\" catches every key you did not name. Skip the widget.keys line entirely and the list is space, shift, any.",
    prelude: "var value = 0;",
    snippet: `widget.keys("space", "a", "any");
widget.on("input.key.down", function (event) {
  // event.key is a number, not a letter: 0 is "space", 1 is "a", 2 is "any".
  value = clamp(value + 1, 0, 999);
  document.querySelector("#value").textContent = digits(value, 3);
});`,
    sampleLabel: "key ↓ (first key)",
    sample: { kind: "input.key.down", id: 0, displayName: "key ↓ first key" },
  },
  "input.key.up": {
    blurb: "A declared physical key was released — the up edge that pairs with key.down.",
    prelude: "var value = 0;",
    snippet: `widget.on("input.key.up", function (event) {
  // Fires on release; widget.isHeld(0) still says whether the first key is down.
  document.querySelector("#value").textContent = digits(value, 3);
});`,
    sampleLabel: "key ↑ (first key)",
    sample: { kind: "input.key.up", id: 0, displayName: "key ↑ first key" },
  },
  "input.key.hold": {
    blurb: "Auto-repeat while a key stays held — fires on the hold cadence, not on the down edge. event.holdCount climbs each repeat.",
    prelude: "var value = 0;",
    snippet: `widget.on("input.key.hold", function (event) {
  // Repeats while held — event.holdCount climbs each cadence.
  value = clamp(value + 1, 0, 999);
  document.querySelector("#value").textContent = digits(value, 3);
});`,
    sampleLabel: "key ⇩ hold (first key)",
    sample: { kind: "input.key.hold", id: 0, displayName: "key ⇩ hold first key" },
  },
  "input.chord.down": {
    blurb: "The first two keys you named were pressed together — space and shift when you have not written a widget.keys line. Order doesn't matter, and the match is exact, so holding both never also counts as pressing either one on its own. This is the only chord the keyboard wires today.",
    prelude: "var value = 0;",
    snippet: `widget.on("input.chord.down", function (event) {
  // Your first two keys, held together — a natural "reset" gesture.
  value = 0;
  document.querySelector("#value").textContent = digits(value, 3);
});`,
    sampleLabel: "chord ↓ (first two keys)",
    sample: { kind: "input.chord.down", mask: 0b0011, displayName: "chord ↓ first two keys" },
  },
  "input.chord.up": {
    blurb: "A chord was released. Widgets usually act on chord.down OR chord.up, not both.",
    prelude: "var value = 0;",
    snippet: `widget.on("input.chord.up", function (event) {
  // The chord released — republish so the screen reflects the reset.
  document.querySelector("#value").textContent = digits(value, 3);
});`,
    sampleLabel: "chord ↑ (first two keys)",
    sample: { kind: "input.chord.up", mask: 0b0011, displayName: "chord ↑ first two keys" },
  },
};

function familyOf(kind: string): EventFamily {
  if (kind.startsWith("tick.")) return "tick";
  if (kind.startsWith("host.")) return "host";
  return "input";
}

/** The nine reference rows, in the device contract's own order. */
export const EVENT_REFERENCE: EventReferenceEntry[] = DEVICE_EVENT_NAMES.map((kind) => ({
  kind,
  selector: kind === "host.rpc" ? "host.rpc:<id>" : kind,
  family: familyOf(kind),
  blurb: ENTRY_META[kind].blurb,
  fields: specificFields(kind),
  snippet: ENTRY_META[kind].snippet,
  prelude: ENTRY_META[kind].prelude,
  sample: ENTRY_META[kind].sample,
  sampleLabel: ENTRY_META[kind].sampleLabel,
}));

// ── IntelliSense payloads (CodeMirror completions + hover share these) ──────

/** field → one-liner, for `event.<field>` hover. Kind-agnostic: the generic
 *  meaning wins; hover shows it even without knowing the enclosing handler. */
export const EVENT_FIELD_HOVER_DOCS: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const kind of DEVICE_EVENT_NAMES) {
    for (const name of FIELDS_BY_KIND[kind]) {
      if (!(name in out)) {
        const doc = FIELD_DOCS[name] ?? docFor(kind, name);
        if (doc) out[name] = doc;
      }
    }
  }
  return out;
})();

/** Completion options for `event.` — the field union with per-field detail
 *  plus the kinds that deliver it. */
export const EVENT_FIELD_COMPLETIONS: { label: string; detail: string; kinds: string[] }[] = (() => {
  const kindsByField = new Map<string, string[]>();
  for (const kind of DEVICE_EVENT_NAMES) {
    for (const name of FIELDS_BY_KIND[kind]) {
      const list = kindsByField.get(name) ?? [];
      list.push(kind);
      kindsByField.set(name, list);
    }
  }
  return [...kindsByField.entries()].map(([label, kinds]) => ({
    label,
    detail: EVENT_FIELD_HOVER_DOCS[label] ?? "",
    kinds,
  }));
})();

/** kind → blurb, for hovering event-kind string literals in the editor.
 *  Includes the compiler's fn-bottom-knob shorthand. */
export const EVENT_KIND_HOVER_DOCS: Record<string, { blurb: string; fields: string[] }> = (() => {
  const out: Record<string, { blurb: string; fields: string[] }> = {};
  for (const entry of EVENT_REFERENCE) {
    out[entry.kind] = {
      blurb: entry.blurb,
      fields: [...entry.fields.map((f) => f.name), ...COMMON_EVENT_FIELDS.map((f) => f.name)],
    };
  }
  out["fn-bottom-knob"] = out["input.fn-bottom-knob"];
  return out;
})();

/** `host.rpc:0xB241` → the host.rpc entry; everything else exact-matches. */
export function lookupKindDoc(kind: string): { blurb: string; fields: string[] } | null {
  const canonical = kind.startsWith("host.rpc:") ? "host.rpc" : kind;
  return EVENT_KIND_HOVER_DOCS[canonical] ?? null;
}
