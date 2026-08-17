import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assessInputLabMQuickJsKeyCapability,
  BrowserMQuickJsKeyBridge,
  createInputLabMQuickJsPackageInput,
  INPUT_LAB_MQUICKJS_INPUT_LIMITS,
  INPUT_LAB_MQUICKJS_INPUT_REASONS,
  INPUT_LAB_MQUICKJS_KEY_CAPABILITIES,
  InputLabMQuickJsKeySimulator,
  InputLabMQuickJsNativeKeyRecorder,
  mquickJsEventIsHeld,
  normalizeInputLabMQuickJsKeyConfig,
} from "../lib/mquickjs-key-events.mjs";

function config(overrides = {}) {
  return {
    keys: [
      { id: 0, browserCode: "KeyA", nativeToken: 0, label: "A" },
      { id: 1, browserCode: "KeyB", nativeToken: 0x11223344, label: "B" },
      { id: 2, browserCode: "KeyC", nativeToken: 0x55667788, label: "C" },
      { id: 3, browserCode: "KeyD", nativeToken: 0xdeadbeef, label: "D" },
    ],
    chords: [{ id: 0, heldMask: 0b0011 }],
    debounceMs: 5,
    holdDelayMs: 100,
    holdCadenceMs: 50,
    ...overrides,
  };
}

function keyboardEvent(type, code, overrides = {}) {
  const event = new Event(type);
  Object.defineProperties(event, {
    code: { value: code },
    repeat: { value: overrides.repeat ?? false },
    isComposing: { value: overrides.isComposing ?? false },
  });
  return event;
}

test("Input Lab normalizes the exact bounded F2JS key/chord package contract", () => {
  const normalized = normalizeInputLabMQuickJsKeyConfig(config());
  assert.equal(INPUT_LAB_MQUICKJS_INPUT_LIMITS.keys, 16);
  assert.equal(INPUT_LAB_MQUICKJS_INPUT_LIMITS.chords, 8);
  assert.equal(INPUT_LAB_MQUICKJS_INPUT_LIMITS.queueRecords, 32);
  assert.equal(INPUT_LAB_MQUICKJS_INPUT_LIMITS.maxEventsPerDrain, 3);
  assert.equal(INPUT_LAB_MQUICKJS_INPUT_LIMITS.maxLogicalEventsPerBatch, 62);
  assert.equal(normalized.keys[0].nativeToken, 0, "opaque token zero is valid");
  assert.equal(normalized.deviceDeployable, true);
  assert.deepEqual(createInputLabMQuickJsPackageInput(normalized), {
    events: {
      keys: [
        { id: 0, nativeToken: 0 },
        { id: 1, nativeToken: 0x11223344 },
        { id: 2, nativeToken: 0x55667788 },
        { id: 3, nativeToken: 0xdeadbeef },
      ],
      chords: [{ id: 0, heldMask: 3 }],
    },
    input: { debounceMs: 5, holdDelayMs: 100, holdCadenceMs: 50 },
  });
  assert.throws(() => normalizeInputLabMQuickJsKeyConfig(config({ keys: [
    { browserCode: "KeyA", nativeToken: 1 }, { browserCode: "KeyB", nativeToken: 1 },
  ] })), /tokens must be unique/u);
  assert.throws(() => normalizeInputLabMQuickJsKeyConfig(config({
    chords: [{ heldMask: 1 }],
  })), /two to four/u);
  assert.throws(() => normalizeInputLabMQuickJsKeyConfig(config({ debounceMs: 0 })),
    /1\.\.50/u);
  const browserOnly = normalizeInputLabMQuickJsKeyConfig({ keys: [{ code: "Space" }],
    chords: [] });
  assert.equal(browserOnly.deviceDeployable, false);
  assert.throws(() => createInputLabMQuickJsPackageInput(browserOnly), /exact learned/u);
});

test("simulator emits exact down/up once and order-independent exact chord edges", () => {
  const simulator = new InputLabMQuickJsKeySimulator(config());
  assert.equal(simulator.enqueueByCode("KeyB", true, 10).status, "queued");
  assert.equal(simulator.enqueueByCode("KeyA", true, 10).status, "queued");
  assert.deepEqual(simulator.drain(14).events, []);
  const chord = simulator.drain(15).events;
  assert.deepEqual(chord.map(({ type, key, chord: chordId }) => [type, key, chordId]), [
    ["input.key.down", 0, undefined],
    ["input.key.down", 1, undefined],
    ["input.chord.down", undefined, 0],
  ]);
  assert.ok(chord.every(({ heldMask }) => heldMask === 3));
  assert.equal(mquickJsEventIsHeld(chord[0], 1), true);
  assert.equal(simulator.enqueueByCode("KeyA", true, 16).status, "duplicate");
  assert.deepEqual(simulator.drain(20).events, []);

  simulator.enqueueByCode("KeyC", true, 21);
  const breakExact = simulator.drain(26).events;
  assert.deepEqual(breakExact.map(({ type }) => type),
    ["input.key.down", "input.chord.up"]);
  assert.equal(breakExact[0].heldMask, 7);
  simulator.enqueueByCode("KeyC", false, 30);
  assert.deepEqual(simulator.drain(35).events.map(({ type }) => type),
    ["input.key.up", "input.chord.down"]);

  simulator.enqueueByCode("KeyB", false, 40);
  simulator.enqueueByCode("KeyA", false, 40);
  const released = simulator.drain(45).events;
  assert.deepEqual(released.map(({ type, key }) => [type, key]), [
    ["input.key.up", 0], ["input.key.up", 1], ["input.chord.up", undefined],
  ]);
  assert.ok(released.every(({ heldMask }) => heldMask === 0));
  assert.deepEqual(released.map(({ sequence }) => sequence), [8, 9, 10]);
});

test("simulator mirrors backlog debounce, uint32 wrap, and fair coalesced holds", () => {
  const simulator = new InputLabMQuickJsKeySimulator(config());
  for (let index = 0; index < 5; index += 1) {
    simulator.enqueueByCode("KeyC", index % 2 === 0, 10 + index);
  }
  assert.equal(simulator.drain(19).morePending, true);
  assert.deepEqual(simulator.drain(19).events.map(({ type, key }) => [type, key]),
    [["input.key.down", 2]]);
  simulator.enqueueByCode("KeyC", false, 20);
  simulator.drain(25);

  const wrap = new InputLabMQuickJsKeySimulator(config({ chords: [] }));
  wrap.enqueueByCode("KeyA", true, 0xffffffff - 4);
  assert.deepEqual(wrap.drain(0).events.map(({ type, timestampMs }) => [type, timestampMs]),
    [["input.key.down", 0]]);
  wrap.enqueueByCode("KeyA", false, 2);
  assert.deepEqual(wrap.drain(7).events.map(({ type, timestampMs }) => [type, timestampMs]),
    [["input.key.up", 7]]);

  const holds = new InputLabMQuickJsKeySimulator(config({ chords: [] }));
  for (const code of ["KeyA", "KeyB", "KeyC", "KeyD"]) holds.enqueueByCode(code, true, 100);
  assert.deepEqual(holds.drain(105).events.map(({ key }) => key), [0, 1, 2]);
  assert.deepEqual(holds.drain(105).events.map(({ key }) => key), [3]);
  assert.deepEqual(holds.drain(205).events.map(({ type, key, holdCount }) =>
    [type, key, holdCount]), [
    ["input.key.hold", 0, 1], ["input.key.hold", 1, 1],
  ]);
  assert.deepEqual(holds.drain(205).events.map(({ key }) => key), [2, 3]);
  assert.equal(holds.nextDueIn(205), 50);
});

test("queue overflow resyncs to the authoritative bitmap so a lost release cannot stick", () => {
  const simulator = new InputLabMQuickJsKeySimulator(config());
  simulator.enqueueByCode("KeyA", true, 0);
  simulator.drain(5);
  for (let index = 0; index < 33; index += 1) {
    simulator.enqueueByCode("KeyA", index % 2 !== 0, 10 + index);
  }
  const result = simulator.drain(100);
  assert.deepEqual(result.events.map(({ type, key, synthetic, reason }) =>
    [type, key, synthetic, reason]), [["input.key.up", 0, true,
    INPUT_LAB_MQUICKJS_INPUT_REASONS.queueResync]]);
  assert.equal(result.heldMask, 0);
  assert.equal(simulator.snapshot().queueOverflows, 1);
  assert.equal(simulator.snapshot().authoritativeHeldMask, 0);
});

test("simulator retains sixteen FIFO edges across three-attempt owner iterations", () => {
  const keys = Array.from({ length: 16 }, (_, id) => ({ id,
    browserCode: `Key${id}`, nativeToken: id }));
  const simulator = new InputLabMQuickJsKeySimulator({ keys, chords: [],
    debounceMs: 5, holdDelayMs: 100, holdCadenceMs: 50 });
  for (let id = 0; id < 16; id += 1) simulator.enqueueKey(id, true, 100);
  const batches = [];
  for (let index = 0; index < 4; index += 1) {
    const result = simulator.drain(105);
    assert.equal(result.morePending, true);
    batches.push(result.events);
  }
  while (simulator.snapshot().pendingEvents > 0) batches.push(simulator.drain(105).events);
  assert.ok(batches.every((events) => events.length <= 3));
  assert.deepEqual(batches.flat().map(({ key }) => key),
    Array.from({ length: 16 }, (_, id) => id));
  assert.deepEqual(batches.flat().map(({ sequence }) => sequence),
    Array.from({ length: 16 }, (_, index) => index + 1));
});

test("browser bridge synthesizes one release set on focus loss and disconnect", () => {
  const eventTarget = new EventTarget();
  const documentTarget = new EventTarget();
  documentTarget.hidden = false;
  let now = 0;
  let timer = null;
  const batches = [];
  const bridge = new BrowserMQuickJsKeyBridge({ config: config(), eventTarget, documentTarget,
    nowMs: () => now, onEvents: (events) => batches.push(...events),
    setTimer: (callback, delay) => { timer = { callback, delay }; return timer; },
    clearTimer: (value) => { if (timer === value) timer = null; } }).start();

  eventTarget.dispatchEvent(keyboardEvent("keydown", "KeyA"));
  assert.equal(timer.delay, 5);
  now = 5;
  timer.callback();
  eventTarget.dispatchEvent(keyboardEvent("keydown", "KeyA", { repeat: true }));
  assert.deepEqual(batches.map(({ type }) => type), ["input.key.down"]);

  now = 10;
  eventTarget.dispatchEvent(keyboardEvent("keydown", "KeyB"));
  now = 15;
  timer.callback();
  assert.deepEqual(batches.slice(1).map(({ type }) => type),
    ["input.key.down", "input.chord.down"]);

  now = 20;
  eventTarget.dispatchEvent(new Event("blur"));
  const synthetic = batches.filter(({ synthetic }) => synthetic);
  assert.deepEqual(synthetic.map(({ type, key }) => [type, key]), [
    ["input.key.up", 0], ["input.key.up", 1], ["input.chord.up", undefined],
  ]);
  documentTarget.hidden = true;
  documentTarget.dispatchEvent(new Event("visibilitychange"));
  assert.equal(batches.filter(({ synthetic }) => synthetic).length, 3,
    "repeat focus-loss signals must not duplicate release edges");

  now = 30;
  eventTarget.dispatchEvent(keyboardEvent("keydown", "KeyA"));
  now = 35;
  timer.callback();
  now = 40;
  const disconnected = bridge.disconnect();
  assert.deepEqual(disconnected.events.map(({ type, synthetic, reason }) =>
    [type, synthetic, reason]), [["input.key.up", true,
    INPUT_LAB_MQUICKJS_INPUT_REASONS.disconnect]]);
  assert.equal(bridge.simulator.snapshot().ingressEnabled, false);
});

test("native-token recording is capability-gated and never invents a physical key map", () => {
  assert.equal(INPUT_LAB_MQUICKJS_KEY_CAPABILITIES.physicalKeyHookProven, false);
  assert.throws(() => new InputLabMQuickJsNativeKeyRecorder(), /exact proven/u);
  const exactCapability = {
    renderV2Profile: "framer-f1-render-v2-mquickjs-v1",
    nativeKeyEvents: "opaque-u32-level-sequence-v1",
    nativeKeyObservation: "last-u32-level-sequence-v1",
    stockFirstKeyHookProven: true,
    vmOwnerInputQueue: "fixed-spsc-authoritative-bitmap-v1",
  };
  assert.deepEqual(assessInputLabMQuickJsKeyCapability(exactCapability), {
    compatible: true, recordingCompatible: true, errors: [],
  });
  const recorder = new InputLabMQuickJsNativeKeyRecorder({ hostCanary: true });
  assert.throws(() => recorder.poll({ nativeToken: 0, pressed: false,
    timestampMs: 0, observationSequence: 0 }), /1\.\.4294967295/u);
  const observed = recorder.poll({ nativeToken: 0, pressed: true,
    timestampMs: 100, observationSequence: 1 });
  assert.equal(observed.nativeToken, 0);
  assert.equal(recorder.poll({ ...observed }), null, "polling one sequence twice is idempotent");
  assert.deepEqual(recorder.bind({ id: 0, label: "My top-left key", browserCode: "KeyQ" }), {
    id: 0,
    nativeToken: 0,
    label: "My top-left key",
    browserCode: "KeyQ",
    learnedFromObservationSequence: 1,
  });
  assert.equal(Object.hasOwn(observed, "physicalName"), false);
});
