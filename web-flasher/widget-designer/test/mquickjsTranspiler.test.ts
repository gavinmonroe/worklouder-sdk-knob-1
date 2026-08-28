// The DSL → MicroQuickJS transpiler must produce source that behaves on the
// simulator exactly as the mailbox contract demands: DOM writes become slot
// writes against literal tables, slot 0 strictly increases per committed
// publish, and the derived events metadata matches what the handlers need.

import { describe, expect, it } from "vitest";

import { buildF2JSPackage } from "../src/compiler/f2jsPackage";
import { createMquickjsSimulator } from "../src/compiler/mquickjsSimulator";
import { transpileWidgetScript } from "../src/compiler/mquickjsTranspiler";
import { LEGACY_PRESETS } from "./fixtures/legacyPresets";

// Representative fixture: two text targets with pick (#status reused across
// three handlers, #gear across two), one color target (#gear), both ticks,
// knob, one host.rpc, a key handler, and a chord handler.
const FIXTURE = `var counter = 0;
var knobPos = 0;
var hostVal = 0;
var pulse = 0;

widget.on("tick.1s", function (event) {
  counter = counter + 1;
  counter = mod(counter, 4);
  document.querySelector("#status").textContent = pick(counter, "IDLE", "WARM", "RUN", "COOL");
});

widget.on("tick.100ms", function (event) {
  pulse = (pulse + 1) | 0;
});

widget.on("input.fn-bottom-knob", function (event) {
  knobPos += event.delta;
  knobPos = mod(knobPos, 3);
  document.querySelector("#gear").textContent = pick(knobPos, "LO", "MID", "HI");
});

widget.on("host.rpc:0xB201", function (event) {
  hostVal = event.value;
  hostVal = mod(hostVal, 3);
  document.querySelector("#gear").textContent = pick(hostVal, "LO", "MID", "HI");
  document.querySelector("#gear").style.color = pick(hostVal,
    "#59E2FF", "#FFB74D", "#FF5F97");
});

widget.on("input.key.down", function (event) {
  counter = clamp(counter + 1, 0, 3);
  document.querySelector("#status").textContent = pick(counter, "IDLE", "WARM", "RUN", "COOL");
});

widget.on("input.chord.down", function (event) {
  document.querySelector("#status").textContent = pick(0, "IDLE", "WARM", "RUN", "COOL");
});
`;

describe("mquickjs transpiler", () => {
  it("transpiles the additive millisecond tick and preserves elapsed time", () => {
    const out = transpileWidgetScript(`var elapsed = 0;
widget.on("tick.1ms", function (event) {
  elapsed = mod(elapsed + event.value, 4);
  document.querySelector("#phase").textContent = pick(elapsed, "0", "1", "2", "3");
});
`);
    expect(out.diagnostics).toEqual([]);
    expect(out.events).toEqual({ "tick.1ms": true });
    expect(out.deviceSource).toContain('widget.on("tick.1ms", function (event) {');
    const sim = createMquickjsSimulator(out.deviceSource);
    const tick = sim.dispatch({ kind: "tick.1ms", value: 3 } as any);
    expect(tick.handled).toBe(true);
    expect(tick.slots[out.slotMap.phase.textSlot!]).toBe(3);
  });

  it("accepts a zero-argument handler when the event is unused", () => {
    const out = transpileWidgetScript(`var a = 0;
var b = 0;
var c = 0;
widget.on("tick.1s", function () {
  a = mod(a + 1, 5);
  b = mod(b + 1, 6);
  c = mod(c + 1, 7);
});
`);
    expect(out.diagnostics).toEqual([]);
    expect(out.events["tick.1s"]).toBe(true);
    expect(out.deviceSource).toContain('widget.on("tick.1s", function (event) {');
  });

  it("transpiles the fixture with clean diagnostics, slots, tables, and events", () => {
    const out = transpileWidgetScript(FIXTURE);
    expect(out.diagnostics).toEqual([]);
    expect(out.slotMap).toEqual({
      status: { textSlot: 1 },
      gear: { textSlot: 2, colorSlot: 3 },
    });
    expect(out.tables).toEqual({
      status: ["IDLE", "WARM", "RUN", "COOL"],
      gear: ["LO", "MID", "HI"],
    });
    expect(out.colorTables).toEqual({
      gear: ["#59E2FF", "#FFB74D", "#FF5F97"],
    });
    expect(out.events).toEqual({
      "tick.100ms": true,
      "tick.1s": true,
      "input.fn-bottom-knob": true,
      hostRpcIds: [0xb201],
      keys: [
        { id: 0, nativeToken: 0x2c },
        { id: 1, nativeToken: 0xe1 },
        { id: 2, nativeToken: 0x01 },
      ],
      chords: [{ id: 0, heldMask: 3 }],
    });
  });

  it("emits document-free strict source that parses and carries the prelude", () => {
    const out = transpileWidgetScript(FIXTURE);
    expect(out.deviceSource.startsWith('"use strict";\n')).toBe(true);
    expect(/document/.test(out.deviceSource)).toBe(false);
    expect(out.deviceSource).toMatch(/function mod\(/);
    expect(out.deviceSource).toMatch(/function clamp\(/);
    expect(out.deviceSource).toMatch(/function pick\(/);
    expect(() => new Function("widget", out.deviceSource)).not.toThrow();
  });

  it("runs on the simulator with device semantics and strictly increasing slot 0", () => {
    const out = transpileWidgetScript(FIXTURE);
    const sim = createMquickjsSimulator(out.deviceSource);
    const revisions: number[] = [];

    // knob +1 → knobPos 1 → #gear text slot holds variant index 1 ("MID")
    const knob = sim.dispatch({ kind: "input.fn-bottom-knob", delta: 1 } as any);
    expect(knob.handled).toBe(true);
    expect(knob.committed).toBe(true);
    expect(knob.error).toBeUndefined();
    expect(knob.slots[out.slotMap.gear.textSlot!]).toBe(1);
    revisions.push(knob.slots[0]);

    // host.rpc value 5 → mod 3 → 2 → gear text 2 ("HI") and color 2 ("#FF5F97")
    const host = sim.dispatch({ kind: "host.rpc", id: 0xb201, value: 5 } as any);
    expect(host.committed).toBe(true);
    expect(host.slots[out.slotMap.gear.textSlot!]).toBe(2);
    expect(host.slots[out.slotMap.gear.colorSlot!]).toBe(2);
    revisions.push(host.slots[0]);

    // tick.100ms only touches JS state — no slot writes, so no commit and
    // slot 0 must not move.
    const tick = sim.dispatch({ kind: "tick.100ms" } as any);
    expect(tick.handled).toBe(true);
    expect(tick.committed).toBe(false);
    expect(tick.slots[0]).toBe(revisions[revisions.length - 1]);

    // key.down → counter clamp(0+1) = 1 → #status variant 1 ("WARM")
    const key = sim.dispatch({ kind: "input.key.down", key: 0 } as any);
    expect(key.committed).toBe(true);
    expect(key.slots[out.slotMap.status.textSlot!]).toBe(1);
    revisions.push(key.slots[0]);

    // chord.down pins #status to variant 0 ("IDLE")
    const chord = sim.dispatch({ kind: "input.chord.down", chord: 3, heldMask: 3 } as any);
    expect(chord.committed).toBe(true);
    expect(chord.slots[out.slotMap.status.textSlot!]).toBe(0);
    revisions.push(chord.slots[0]);

    // tick.1s → counter 1+1 = 2 → #status variant 2 ("RUN")
    const second = sim.dispatch({ kind: "tick.1s" } as any);
    expect(second.committed).toBe(true);
    expect(second.slots[out.slotMap.status.textSlot!]).toBe(2);
    revisions.push(second.slots[0]);

    // Each committed publish wrote a strictly greater revision to slot 0.
    for (let i = 1; i < revisions.length; i++) {
      expect(revisions[i]).toBeGreaterThan(revisions[i - 1]);
    }
  });

  it("reuses one slot for identical repeated writes to the same target", () => {
    const out = transpileWidgetScript(FIXTURE);
    const statusSlot = out.slotMap.status.textSlot!;
    const gearSlot = out.slotMap.gear.textSlot!;
    // #status is written by three handlers, #gear text by two — one slot each.
    expect((out.deviceSource.match(new RegExp(`__set\\(${statusSlot}, `, "g")) ?? []).length).toBe(3);
    expect((out.deviceSource.match(new RegExp(`__set\\(${gearSlot}, `, "g")) ?? []).length).toBe(2);
    // Only three slots were allocated in total (status text, gear text, gear color).
    const allocated = Object.values(out.slotMap).flatMap((entry) =>
      [entry.textSlot, entry.colorSlot].filter((slot) => slot !== undefined),
    );
    expect(allocated.sort()).toEqual([1, 2, 3]);
  });

  it("errors when the same target lists different variants", () => {
    const out = transpileWidgetScript(`var a = 0;
widget.on("tick.1s", function (event) {
  a = mod(a + 1, 2);
  document.querySelector("#x").textContent = pick(a, "A", "B");
});
widget.on("input.fn-bottom-knob", function (event) {
  a = mod(a + event.delta, 2);
  document.querySelector("#x").textContent = pick(a, "A", "C");
});
`);
    const mismatch = out.diagnostics.find(
      (d) => d.severity === "error" && d.message.includes('"#x"'),
    );
    expect(mismatch).toBeDefined();
    expect(mismatch!.message).toContain("variants differ");
    // Still returns: the caller shows errors, the first-seen table stands.
    expect(out.tables.x).toEqual(["A", "B"]);
    expect(typeof out.deviceSource).toBe("string");
  });

  it("rejects other document access with the exact offending line", () => {
    const out = transpileWidgetScript(`var a = 0;
widget.on("tick.1s", function (event) {
  document.querySelector("#x").innerHTML = "hi";
  document.querySelector("#x").hidden = 1;
});
`);
    const errors = out.diagnostics.filter((d) => d.severity === "error");
    expect(errors.some((d) => d.message.includes('innerHTML = "hi"'))).toBe(true);
    expect(errors.some((d) => d.message.includes("hidden = 1"))).toBe(true);
    // The offending statements are dropped, never forwarded to the device.
    expect(/innerHTML|hidden/.test(out.deviceSource)).toBe(false);
  });

  it("turns constant textContent into a single-entry table", () => {
    const out = transpileWidgetScript(`var a = 0;
widget.on("tick.1s", function (event) {
  document.querySelector("#y").textContent = "OK";
});
`);
    expect(out.diagnostics).toEqual([]);
    expect(out.tables.y).toEqual(["OK"]);
    expect(out.deviceSource).toContain("__set(1, 0);");
    const sim = createMquickjsSimulator(out.deviceSource);
    const result = sim.dispatch({ kind: "tick.1s" } as any);
    expect(result.committed).toBe(true);
    expect(result.slots[1]).toBe(0);
  });

  it("errors on slot exhaustion past 14 distinct needs", () => {
    const writes = Array.from(
      { length: 15 },
      (_, i) => `  document.querySelector("#t${i}").textContent = pick(a, "A", "B");`,
    ).join("\n");
    const out = transpileWidgetScript(`var a = 0;\nwidget.on("tick.1s", function (event) {\n${writes}\n});\n`);
    const exhausted = out.diagnostics.find(
      (d) => d.severity === "error" && /live values the keyboard can hold/.test(d.message),
    );
    expect(exhausted).toBeDefined();
    expect(exhausted!.message).toContain("#t14");
    expect(Object.keys(out.slotMap)).toHaveLength(14);
  });

  it("errors when the source exceeds 8192 bytes, reporting the actual size", () => {
    const filler = Array.from({ length: 900 }, () => "  a = a + 1;").join("\n");
    const out = transpileWidgetScript(`var a = 0;\nwidget.on("tick.1s", function (event) {\n${filler}\n});\n`);
    const actual = new TextEncoder().encode(out.deviceSource).length;
    expect(actual).toBeGreaterThan(8192);
    const oversize = out.diagnostics.find(
      (d) => d.severity === "error" && d.message.includes("8192"),
    );
    expect(oversize).toBeDefined();
    expect(oversize!.message).toContain(String(actual));
  });

  it("transpiles the events preset with exactly the formatTime error", () => {
    const out = transpileWidgetScript(LEGACY_PRESETS.events.script);
    const errors = out.diagnostics.filter((d) => d.severity === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("formatTime(secondsOfDay)");
    expect(out.events).toEqual({
      "tick.1s": true,
      "input.fn-bottom-knob": true,
      hostRpcIds: [0xb201],
    });
    expect(out.slotMap).toEqual({
      knob: { textSlot: 1 },
      host: { textSlot: 2, colorSlot: 3 },
    });
    expect(out.tables.host).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
    expect(out.colorTables.host).toHaveLength(10);

    // The salvageable handlers still run: knob moves #knob, host paints #host.
    const sim = createMquickjsSimulator(out.deviceSource);
    const knob = sim.dispatch({ kind: "input.fn-bottom-knob", delta: 1 } as any);
    expect(knob.committed).toBe(true);
    expect(knob.slots[1]).toBe(1);
    const host = sim.dispatch({ kind: "host.rpc", id: 0xb201, value: 7 } as any);
    expect(host.committed).toBe(true);
    expect(host.slots[2]).toBe(7);
    expect(host.slots[3]).toBe(7);
    // The clock line was dropped, so tick.1s only updates JS state.
    expect(sim.dispatch({ kind: "tick.1s" } as any).committed).toBe(false);
  });

  it("produces an events object buildF2JSPackage accepts", async () => {
    const out = transpileWidgetScript(FIXTURE);
    const targets = Object.entries(out.slotMap).map(([id, alloc]) => {
      const writes: ("textContent" | "color" | "hidden")[] = [];
      if (alloc.textSlot !== undefined) writes.push("textContent");
      if (alloc.colorSlot !== undefined) writes.push("color");
      return { id, writes };
    });
    const built = await buildF2JSPackage({
      source: out.deviceSource,
      events: out.events,
      targets,
    });
    // 3 singleton kinds + 1 host id + 2 keys + 1 chord.
    expect(built.events.records).toHaveLength(8);
    expect(built.events.keyCount).toBe(3);
    expect(built.events.chordCount).toBe(1);
    expect(built.budget.sourceBytes).toBe(new TextEncoder().encode(out.deviceSource).length);
  });
});
