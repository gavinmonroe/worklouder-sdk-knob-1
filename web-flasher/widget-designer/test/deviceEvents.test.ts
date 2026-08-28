// Every event kind the keyboard delivers, with the exact per-kind field shape
// from build_event_object (framer_mquickjs_canary.c:660). The simulator must
// hand widgets the same objects the VM does — a field the device omits must be
// absent here too, or widgets grow preview-only dependencies that silently
// break on hardware.

import { describe, expect, it } from "vitest";

import { buildDeviceEvent, deviceEventKey, DEVICE_EVENT_NAMES } from "../src/compiler/deviceEvent";
import { createMquickjsSimulator } from "../src/compiler/mquickjsSimulator";

/** A widget that records what each handler actually receives. */
const RECORDER_SOURCE = `"use strict";
var log = [];
function record(event) {
  log.push(event);
  widget.setInt(0, log.length);
  widget.commit();
}
widget.on("tick.100ms", record);
widget.on("tick.1s", record);
widget.on("tick.1ms", record);
widget.on("input.fn-bottom-knob", record);
widget.on("host.rpc:0xB201", record);
widget.on("input.key.down", record);
widget.on("input.key.up", record);
widget.on("input.key.hold", record);
widget.on("input.chord.down", record);
widget.on("input.chord.up", record);
`;

function makeRecorder() {
  const received: any[] = [];
  const sim = createMquickjsSimulator(RECORDER_SOURCE, {
    onLog: () => {},
  } as any);
  // The recorder widget pushes into its own `log`; reach it via a probe event
  // instead: dispatch, then read back what the handler saw via a spy handler.
  return { sim, received };
}

describe("device event contract", () => {
  it("covers all ten kinds the firmware delivers", () => {
    expect(DEVICE_EVENT_NAMES).toHaveLength(10);
  });

  it("preserves coalesced elapsed time on the millisecond tick", () => {
    expect(buildDeviceEvent({ kind: "tick.1ms", value: 4 })).toMatchObject({
      type: "tick.1ms",
      value: 4,
      auxiliary: 0,
    });
  });

  it("builds the knob event with delta and fn, never value", () => {
    const event = buildDeviceEvent({ kind: "input.fn-bottom-knob", delta: -2 })!;
    expect(event).toMatchObject({ type: "input.fn-bottom-knob", delta: -2, fn: true });
    expect("value" in event).toBe(false);
    expect("key" in event).toBe(false);
  });

  it("maps a store-style knob event carrying value onto delta", () => {
    const event = buildDeviceEvent({ kind: "input.fn-bottom-knob", value: 3 })!;
    expect(event.delta).toBe(3);
  });

  it("builds key events with key/repeat/holdCount/reason, never id", () => {
    const down = buildDeviceEvent({ kind: "input.key.down", key: 1 })!;
    expect(down).toMatchObject({ type: "input.key.down", key: 1, repeat: false, holdCount: 0, reason: 0 });
    expect("id" in down).toBe(false);
    const hold = buildDeviceEvent({ kind: "input.key.hold", key: 0, holdCount: 4 })!;
    expect(hold).toMatchObject({ repeat: true, holdCount: 4 });
    // Legacy sample shape: id used to carry the key index.
    expect(buildDeviceEvent({ kind: "input.key.up", id: 2 })!.key).toBe(2);
  });

  it("builds chord events with chord and reason", () => {
    const event = buildDeviceEvent({ kind: "input.chord.down", mask: 0b0011, heldMask: 0b0011 })!;
    expect(event).toMatchObject({ type: "input.chord.down", chord: 0b0011, heldMask: 0b0011, reason: 0 });
    expect("mask" in event).toBe(false);
  });

  it("builds host.rpc with id/value/auxiliary and keys by id", () => {
    const event = buildDeviceEvent({ kind: "host.rpc", id: 0xb201, value: 7 })!;
    expect(event).toMatchObject({ id: 0xb201, value: 7, auxiliary: 0 });
    expect(deviceEventKey({ kind: "host.rpc", id: 0xb201 })).toBe("host.rpc:45569");
  });

  it("refuses names the device never delivers", () => {
    expect(buildDeviceEvent({ kind: "input.key.press" })).toBeNull();
    expect(buildDeviceEvent({ kind: "made.up" })).toBeNull();
  });

  it("dispatches every kind through the simulator and each handler fires", () => {
    const sim = createMquickjsSimulator(RECORDER_SOURCE);
    const inputs = [
      { kind: "tick.1ms", value: 1 },
      { kind: "tick.100ms" },
      { kind: "tick.1s" },
      { kind: "input.fn-bottom-knob", delta: 1 },
      { kind: "host.rpc", id: 0xb201, value: 42 },
      { kind: "input.key.down", key: 0 },
      { kind: "input.key.up", key: 0 },
      { kind: "input.key.hold", key: 0, holdCount: 2 },
      { kind: "input.chord.down", chord: 3, heldMask: 3 },
      { kind: "input.chord.up", chord: 3 },
    ];
    let handled = 0;
    for (const input of inputs) {
      const result = sim.dispatch(input as any);
      if (result.handled) handled += 1;
      expect(result.handled, `${input.kind} must reach its handler`).toBe(true);
    }
    expect(handled).toBe(10);
    // The recorder commits slot 0 = number of events seen.
    expect(sim.dispatch({ kind: "tick.1s" } as any).slots[0]).toBe(11);
  });

  it("delivers device-shaped objects through the simulator (spot checks)", () => {
    const sim = createMquickjsSimulator(`"use strict";
var sawDelta = -1;
var sawFn = -1;
var sawKey = -1;
var sawChord = -1;
widget.on("input.fn-bottom-knob", function (event) {
  sawDelta = event.delta;
  sawFn = event.fn === true ? 1 : 0;
  sawKey = typeof event.value === "undefined" ? 1 : 0;
  widget.setInt(1, sawDelta); widget.setInt(2, sawFn); widget.setInt(3, sawKey);
  widget.commit();
});
widget.on("input.chord.down", function (event) {
  sawChord = event.chord;
  widget.setInt(4, sawChord);
  widget.commit();
});
`);
    const knob = sim.dispatch({ kind: "input.fn-bottom-knob", delta: -3 } as any);
    expect(knob.slots[1]).toBe(-3);      // delta arrived
    expect(knob.slots[2]).toBe(1);       // fn === true
    expect(knob.slots[3]).toBe(1);       // value is UNDEFINED, like the device
    const chord = sim.dispatch({ kind: "input.chord.down", chord: 3 } as any);
    expect(chord.slots[4]).toBe(3);
  });
});
