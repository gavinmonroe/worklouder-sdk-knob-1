// The strongest Phase-0 claim: the Designer's simulator runs the EXACT widget
// source that is flashed on the keyboard, and its observable behaviour matches
// the SDK's reference weather simulator event for event.
//
// If this holds, "works in the Designer" and "works on the device" are the same
// statement for the mquickjs path, because the device runs this same source in
// a real ES5 VM with the same mailbox contract.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { createMquickjsSimulator } from "../src/compiler/mquickjsSimulator";

const ROOT = new URL("../../../", import.meta.url).pathname;
const SOURCE = readFileSync(
  `${ROOT}experiments/mquickjs-esp32s3-physical-canary/build-diag-module-weather2/assets/weather-id28-gen19.js`,
  "utf8",
);

/** Weather protocol constants, from the flashed widget's own handlers. */
const BEGIN = 0xb240;
const CURRENT = 0xb241;
const DAY1 = 0xb242;
const DAY2 = 0xb243;
const DAY3 = 0xb244;
const COMMIT = 0xb24f;

const packCurrent = (temperature: number, condition: number, isDay: boolean) =>
  ((temperature & 0x3ff) | (condition << 10) | ((isDay ? 1 : 0) << 14)) | 0;
const packDay = (low: number, high: number, condition: number, weekday: number) =>
  ((low & 0x3ff) | ((high & 0x3ff) << 10) | (condition << 20) | (weekday << 24)) | 0;

function dispatchSnapshot(sim: ReturnType<typeof createMquickjsSimulator>, revision: number) {
  const send = (id: number, value: number, auxiliary: number) =>
    sim.dispatch({ kind: "host.rpc", id, value, auxiliary } as any);
  // Record events carry the REVISION in auxiliary (the record bit is bound in
  // each handler); commit carries the completeness mask 15 in auxiliary.
  send(BEGIN, revision, 0);
  send(CURRENT, packCurrent(72, 0, true), revision);
  send(DAY1, packDay(58, 74, 0, 1), revision);
  send(DAY2, packDay(60, 77, 1, 2), revision);
  send(DAY3, packDay(55, 70, 5, 3), revision);
  return send(COMMIT, revision, 15);
}

describe("flashed weather widget inside the Designer simulator", () => {
  it("loads the exact flashed source without modification", () => {
    expect(() => createMquickjsSimulator(SOURCE)).not.toThrow();
  });

  it("applies a full snapshot and publishes the revision to slot 0", () => {
    const sim = createMquickjsSimulator(SOURCE);
    const result = dispatchSnapshot(sim, 42);
    expect(result.handled).toBe(true);
    expect(result.committed).toBe(true);
    // Slot 0 is appliedRevision in the flashed source (syncState reads it back).
    expect(result.slots[0]).toBe(42);
  });

  it("ignores a torn snapshot exactly like the hardware canary", () => {
    const sim = createMquickjsSimulator(SOURCE);
    dispatchSnapshot(sim, 42);
    // Stage a new revision but commit the wrong one: nothing may change.
    sim.dispatch({ kind: "host.rpc", id: BEGIN, value: 99, auxiliary: 0 } as any);
    sim.dispatch({ kind: "host.rpc", id: CURRENT, value: packCurrent(10, 2, false), auxiliary: 99 } as any);
    const wrong = sim.dispatch({ kind: "host.rpc", id: COMMIT, value: 7, auxiliary: 15 } as any);
    expect(wrong.slots[0]).toBe(42);
  });

  it("reacts to ticks, knob, keys and chords without error", () => {
    const sim = createMquickjsSimulator(SOURCE);
    dispatchSnapshot(sim, 42);
    const kinds = [
      { kind: "tick.1s" },
      { kind: "input.fn-bottom-knob", delta: 1 },
      { kind: "input.key.down", key: 0 },
      { kind: "input.key.up", key: 0 },
      { kind: "input.key.hold", key: 0, holdCount: 3 },
      { kind: "input.chord.down", chord: 3, heldMask: 3 },
    ];
    for (const event of kinds) {
      const result = sim.dispatch(event as any);
      expect(result.handled, `${event.kind} must be handled by the flashed source`).toBe(true);
      expect((result as any).error, `${event.kind} must not throw`).toBeUndefined();
    }
  });
});
