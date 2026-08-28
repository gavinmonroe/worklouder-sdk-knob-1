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
  "tick.1ms": 7,
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
//       tick.100ms=1, tick.1s=2, input.fn-bottom-knob=3, host.rpc=4, key=5,
//       chord=6, tick.1ms=7
//   * RENDER_V2_MQUICKJS_PROFILE.events (mquickjs.mjs)
//       tick.1ms, tick.100ms, tick.1s, input.fn-bottom-knob, host.rpc:<1..65535>,
//       input.key.down, input.key.up, input.key.hold,
//       input.chord.down, input.chord.up
//
// The compiler additionally accepts the "user shorthand":
//       fn-bottom-knob          (=== "input.fn-bottom-knob")
// Anything else is a compile error.

export const ALL_EVENT_KINDS = [
  {
    canonical: "tick.1ms",
    insertText: '"tick.1ms"',
    detail: "Best-effort millisecond timer while the widget is on screen.",
    doc:
      "Provides a 1 ms logical timebase. Busy intervals are coalesced, and\n" +
      "event.value reports the elapsed milliseconds since the prior delivery.",
  },
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
    canonical: "feed.my-data",
    insertText: '"feed.my-data"',
    detail: "Your own data, sent from your computer. Rename it to anything.",
    doc:
      "Name a feed whatever you like — feed.room-temp, feed.build-status — and\n" +
      "it appears in the Source tab's Host data section, where you label its\n" +
      "two numbers and get a ready-made script to send them.\n" +
      "event.value / event.auxiliary hold the two numbers you send.",
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
    name: "keys",
    signature: 'widget.keys("space", "a", "any"): void',
    detail: "Choose which keys this widget listens to. Optional.",
    doc:
      'Names, not codes: space, enter, esc, tab, backspace, shift, ctrl, alt,\n' +
      'gui, up/down/left/right, a-z, 0-9 — and "any" for every other key.\n' +
      "Skip it and your widget hears the whole keyboard already.\n" +
      "Write it once at the top of your script, outside any handler.",
  },
  {
    name: "animate",
    signature: 'widget.animate("#id", frames: number): void',
    detail: "Play a CSS animation on the keyboard by sampling it into frames.",
    doc:
      "Samples the element's CSS animation into 2..16 still frames the device\n" +
      "flips through. Write it at the top of your script, outside any handler.",
  },
  {
    name: "isHeld",
    signature: "widget.isHeld(keyIndex: number): boolean",
    detail: "Returns true iff a declared key is currently held.",
    doc:
      "True while that key is still down — useful for 'is shift held?' checks.\n" +
      "The number is the key's position in your widget.keys(...) list.",
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
