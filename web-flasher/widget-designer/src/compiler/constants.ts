// Mirror of constants from f1-widget-sdk/src/render-v2/*
// Kept browser-side so we don't have to bundle node:crypto/buffer.

// This object MUST stay literal-typed so plain JSX can import and use its keys
// without TS2778 instantiation errors. Do not add `as const` here.
export const RENDER_V2_MQUICKJS_SOURCE_PREFIX = '"use strict";\n';

// Authoritative event-kind IDs (mirrors RENDER_V2_MQUICKJS_EVENT_KINDS in
// f1-widget-sdk/src/render-v2/abi.mjs).
export const RENDER_V2_MQUICKJS_EVENT_KINDS = {
  "tick.100ms": 1,
  "tick.1s": 2,
  "input.fn-bottom-knob": 3,
  "host.rpc": 4,
  key: 5,
  chord: 6,
};

// Authoritative target-write flags (mirrors RENDER_V2_MQUICKJS_TARGET_WRITES).
export const RENDER_V2_MQUICKJS_TARGET_WRITES = {
  textContent: 1,
  color: 2,
  hidden: 4,
};

export const RENDER_V2_MQUICKJS_LIMITS = {
  headerBytes: 128,
  packageBytes: 98_304,
  sourceBytes: 8_192,
  heapBytes: 65_536,
  callbackDeadlineUs: 2_000,
  handlers: 16,
  targets: 16,
  keys: 16,
  chords: 8,
  chordKeys: 4,
  eventRecords: 32,
  eventRecordBytes: 16,
  targetRecordBytes: 32,
  rasterBaseBytes: 62_404,
};

export const MQUICKJS_LIMITS = RENDER_V2_MQUICKJS_LIMITS;

// Two facts pulled DIRECTLY from the SDK (so the IntelliSense matches runtime behaviour):
//   * RENDER_V2_MQUICKJS_EVENT_KINDS (abi.mjs)
//       tick.100ms=1, tick.1s=2, input.fn-bottom-knob=3, host.rpc=4, key=5, chord=6
//   * RENDER_V2_MQUICKJS_PROFILE.events (mquickjs.mjs)
//       tick.100ms, tick.1s, input.fn-bottom-knob, host.rpc:<1..65535>,
//       input.key.down, input.key.up, input.key.hold,
//       input.chord.down, input.chord.up
//
// The compiler additionally accepts the "user shorthand":
//       fn-bottom-knob          (=== "input.fn-bottom-knob")
// Anything else is a compile error.

export const ALL_EVENT_KINDS = [
  {
    canonical: "tick.100ms",
    insertText: '"tick.100ms"',
    detail: "Fires 10x per second while the widget is on screen.",
    doc: "Provides coarse-grained per-frame updates (10 Hz).",
  },
  {
    canonical: "tick.1s",
    insertText: '"tick.1s"',
    detail: "Fires once per second while the widget is on screen.",
    doc: "Provides 1 Hz background updates.",
  },
  {
    canonical: "input.fn-bottom-knob",
    insertText: '"input.fn-bottom-knob"',
    detail: "Hardware rotary knob. event.delta is signed and non-zero.",
    doc:
      "Long-form event kind for the bottom Fn knob.\n" +
      "Author shorthand: 'fn-bottom-knob' (also accepted).\n" +
      "Inside the handler: event.delta (signed int).",
  },
  {
    canonical: "fn-bottom-knob",
    insertText: '"fn-bottom-knob"',
    detail: "Shorthand for input.fn-bottom-knob.",
    doc: "alias of input.fn-bottom-knob",
  },
  {
    canonical: "device.typing-speed",
    insertText: '"device.typing-speed"',
    detail: "How fast you are typing. Published by the keyboard once a second.",
    doc:
      "A built-in device feed - the keyboard measures this itself, so nothing\n" +
      "needs to run on your computer.\n" +
      "event.value     -> words per minute\n" +
      "event.auxiliary -> keys pressed in the last 60 seconds",
  },
  {
    canonical: "host.rpc",
    insertText: '"host.rpc"',
    detail: "Data sent from your computer, on a channel you name in Host data.",
    doc:
      "For your own data: define a feed in the Source tab's Host data section,\n" +
      "then subscribe to it here.\n" +
      "event.value / event.auxiliary hold the two numbers your feed sends.",
  },
  {
    canonical: "input.key.down",
    insertText: '"input.key.down"',
    detail: "A key was pressed. Every key on the keyboard reaches your widget.",
    doc:
      "Fires when a key goes down.\n" +
      "event.key    -> which key slot fired (name yours with widget.keys).\n" +
      "event.repeat -> false on the first down edge, true on auto-repeats.",
  },
  {
    canonical: "input.key.up",
    insertText: '"input.key.up"',
    detail: "Physical key release. event.key is the key index.",
    doc: "Fires when a declared key is released. event.key -> key index.",
  },
  {
    canonical: "input.key.hold",
    insertText: '"input.key.hold"',
    detail: "Tick-style event while a declared key is held.",
    doc:
      "Fires on the standard tick cadence while at least one key is held.\n" +
      "event.key -> key index; event.holdCount -> hold cadences so far.",
  },
  {
    canonical: "input.chord.down",
    insertText: '"input.chord.down"',
    detail: "Multi-key combo depressed. event.chord is the chord's key mask.",
    doc:
      "Fires when a declared chord is depressed.\n" +
      "event.chord -> the chord's exact key mask (declared in package chords[]).",
  },
  {
    canonical: "input.chord.up",
    insertText: '"input.chord.up"',
    detail: "Multi-key combo released. event.chord is the chord's key mask.",
    doc: "Fires when a declared chord is fully released. event.chord -> key mask.",
  },
];

// Shape of the `widget` object exposed inside the user script.
export const WIDGET_API = [
  {
    name: "on",
    signature: "widget.on(eventKind: string, handler: (event) => void): void",
    detail: "Subscribe a handler.",
    doc:
      "Register a handler for an event kind declared in the package metadata.\n" +
      "Returns nothing. Up to 16 handlers per widget.",
  },
  {
    name: "getInt",
    signature: "widget.getInt(slot: number): number",
    detail: "Read a state slot.",
    doc:
      "slot: integer in [0..N) where N is the number of `var name = N;` declarations at the top of the source.\n" +
      "Returns the current int32 value of the slot (default 0).",
  },
  {
    name: "setInt",
    signature: "widget.setInt(slot: number, value: number): void",
    detail: "Write a state slot. Writes are not visible until widget.commit().",
    doc:
      "Stages a write to the named state slot. The write is published only when widget.commit() runs,\n" +
      "typically at the end of the handler.",
  },
  {
    name: "commit",
    signature: "widget.commit(): void",
    detail: "Publish the pending state diff to the host.",
    doc:
      "Sends all staged writes since the last commit as a single batch.\n" +
      "Most handlers call this at the end.",
  },
  {
    name: "isHeld",
    signature: "widget.isHeld(keyIndex: number): boolean",
    detail: "Returns true iff a declared key is currently held.",
    doc:
      "Reads the authoritative 16-bit held bitmap for declared keys.\n" +
      "Argument is the key index (declared in package keys[]).",
  },
];

// Shape of the `event` object handed to handler callbacks.
export const EVENT_API = [
  { name: "value", detail: "int32 - payload (used by host.rpc handlers)" },
  { name: "id", detail: "uint16 - key index, chord index, or host RPC id" },
  { name: "delta", detail: "signed int - only set on input.fn-bottom-knob" },
  { name: "flags", detail: "uint16 - see RENDER_V2_EVENT_FLAGS (FN, ...)" },
  { name: "sequence", detail: "uint32 - monotonic per-handler invocation counter" },
];
