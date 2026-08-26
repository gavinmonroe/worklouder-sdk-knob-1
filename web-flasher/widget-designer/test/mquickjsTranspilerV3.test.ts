// v3 authoring expansion (docs/16 "v3 authoring expansion: class variants,
// animations, hidden, digits"): the four new DSL forms must lower onto mailbox
// slots with device semantics PROVEN through the simulator — className in
// lockstep with the other properties, animation slots advancing and wrapping
// on tick.100ms, __hide selecting the reserved variant and restoring the
// staged content, digit slots decomposing values — and the metadata contract
// (classTables / animations / hiddenVariant / digitTargets) must be exactly
// what the capture/assembler side builds against.

import { describe, expect, it } from "vitest";

import { buildF2JSPackage } from "../src/compiler/f2jsPackage";
import { createMquickjsSimulator } from "../src/compiler/mquickjsSimulator";
import { transpileWidgetScript } from "../src/compiler/mquickjsTranspiler";
import { buildWidgetSrcdoc, INTRINSICS } from "../src/compiler/widgetRuntime";
import { LEGACY_PRESETS } from "./fixtures/legacyPresets";

const errorsOf = (out: ReturnType<typeof transpileWidgetScript>) =>
  out.diagnostics.filter((d) => d.severity === "error");

describe("v3 transpiler: pulse preset contract", () => {
  const out = transpileWidgetScript(LEGACY_PRESETS.pulse.script);

  it("transpiles the v3 showcase preset with clean diagnostics", () => {
    expect(out.diagnostics).toEqual([]);
  });

  it("produces the v3 metadata contract: slots, tables, animations, hidden, digits", () => {
    // First-encounter DOM slots (class before text in the knob handler), then
    // digits consume three consecutive slots, then the toast, then animation
    // slots strictly AFTER every DOM-write slot in declaration order.
    expect(out.slotMap).toEqual({
      badge: { classSlot: 1, textSlot: 2 },
      toast: { textSlot: 4 },
    });
    expect(out.tables).toEqual({
      badge: ["READY", "BUSY", "ALERT"],
      toast: ["SYNCED"],
    });
    expect(out.classTables).toEqual({
      badge: ["pulse-badge state-ok", "pulse-badge state-warn", "pulse-badge state-err"],
    });
    expect(out.colorTables).toEqual({});
    expect(out.digitTargets).toEqual({ count: { count: 3, slot: 3 } });
    expect(out.hiddenVariant).toEqual({ toast: 1 });
    expect(out.animations).toEqual({
      spinner: { frames: 6, slot: 5 },
      beat: { frames: 8, slot: 6 },
    });
    // className + textContent proven lockstep on the badge.
    expect(out.sharedPickIndex).toEqual({ badge: true });
  });

  it("declares the auto-generated tick.100ms in events", () => {
    expect(out.events).toEqual({
      "tick.100ms": true,
      "input.fn-bottom-knob": true,
      hostRpcIds: [0xb201],
      keys: [
        { id: 0, nativeToken: 0x2c },
        { id: 1, nativeToken: 0xe1 },
      ],
      chords: [{ id: 0, heldMask: 3 }],
    });
  });

  it("emits document-free strict source that compiles, with the v3 helpers", () => {
    expect(out.deviceSource.startsWith('"use strict";\n')).toBe(true);
    expect(/document/.test(out.deviceSource)).toBe(false);
    expect(out.deviceSource).toMatch(/function __hide\(/);
    expect(out.deviceSource).toMatch(/__set\(3, /);
    expect(out.deviceSource).toMatch(/var __anim0_spinner = 0;/);
    expect(out.deviceSource).toMatch(/var __anim1_beat = 0;/);
    expect(() => new Function("widget", out.deviceSource)).not.toThrow();
  });

  it("runs on the simulator: className lockstep, digits, hide/restore, frames", () => {
    const sim = createMquickjsSimulator(out.deviceSource);
    const revisions: number[] = [];

    // Knob +1 → state 1: class and text slots move in lockstep to variant 1.
    const knob = sim.dispatch({ kind: "input.fn-bottom-knob", delta: 1 } as any);
    expect(knob.committed).toBe(true);
    expect(knob.slots[1]).toBe(1);
    expect(knob.slots[2]).toBe(1);
    revisions.push(knob.slots[0]);

    // Knob -2 → state mod(1-2, 3) = 2: still lockstep.
    const back = sim.dispatch({ kind: "input.fn-bottom-knob", delta: -2 } as any);
    expect(back.slots[1]).toBe(2);
    expect(back.slots[2]).toBe(2);
    revisions.push(back.slots[0]);

    // key.down → count 1 → digit slots (display order) 0,0,1.
    const key = sim.dispatch({ kind: "input.key.down", key: 0 } as any);
    expect(key.committed).toBe(true);
    expect(key.slots[3]).toBe(1);
    revisions.push(key.slots[0]);

    // key.hold → count 11 → 0,1,1.
    const hold = sim.dispatch({ kind: "input.key.hold", key: 0 } as any);
    expect(hold.slots[3]).toBe(11);
    revisions.push(hold.slots[0]);

    // host.rpc value 0 → toastOn 0 → hidden: the toast slot carries the
    // reserved variant index 1, one past its single content variant.
    const hide = sim.dispatch({ kind: "host.rpc", id: 0xb201, value: 0 } as any);
    expect(hide.committed).toBe(true);
    expect(hide.slots[4]).toBe(1);
    revisions.push(hide.slots[0]);

    // host.rpc value 1 → toastOn 1 → visible again: __hide restores the
    // staged content variant 0.
    const show = sim.dispatch({ kind: "host.rpc", id: 0xb201, value: 1 } as any);
    expect(show.slots[4]).toBe(0);
    revisions.push(show.slots[0]);

    // chord.down resets the counter → digits 0,0,0.
    const chord = sim.dispatch({ kind: "input.chord.down", chord: 3, heldMask: 3 } as any);
    expect(chord.slots[3]).toBe(0);
    revisions.push(chord.slots[0]);

    // 20 ticks: the spinner slot walks mod(k, 8) — wrapping at 8 — and the
    // beat slot mod(k, 16); every tick commits (frame publish).
    for (let k = 1; k <= 20; k += 1) {
      const tick = sim.dispatch({ kind: "tick.100ms" } as any);
      expect(tick.handled).toBe(true);
      expect(tick.committed).toBe(true);
      expect(tick.slots[5]).toBe(k % 6);
      expect(tick.slots[6]).toBe(k % 8);
      revisions.push(tick.slots[0]);
    }

    for (let i = 1; i < revisions.length; i += 1) {
      expect(revisions[i]).toBeGreaterThan(revisions[i - 1]);
    }
  });

  it("produces events and targets buildF2JSPackage accepts", async () => {
    // The F2JS write-flag vocabulary is the SDK's frozen {textContent, color,
    // hidden} (docs/16: v3 is designer-side, "no firmware or contract
    // change"), so v3 targets declare within it: class/digit/animation targets
    // are slot-driven variant targets like any text target, and animated ids
    // need no F2JS DOM-target record at all.
    const targets: { id: string; writes: ("textContent" | "color" | "hidden")[] }[] = [
      { id: "badge", writes: ["textContent"] },
      { id: "count", writes: ["textContent"] },
      { id: "toast", writes: ["textContent", "hidden"] },
    ];
    const built = await buildF2JSPackage({
      source: out.deviceSource,
      events: out.events,
      targets,
    });
    // tick.100ms + knob + 1 host id + 2 keys + 1 chord.
    expect(built.events.records).toHaveLength(6);
    expect(built.events.keyCount).toBe(2);
    expect(built.events.chordCount).toBe(1);
  });
});

describe("v3 transpiler: animations", () => {
  it("appends animation steps AFTER the author's own tick.100ms statements", () => {
    const out = transpileWidgetScript(`var i = 0;
widget.animate("#dot", 4);
widget.on("tick.100ms", function (event) {
  i = mod(i + 1, 3);
  document.querySelector("#led").textContent = pick(i, "A", "B", "C");
  document.querySelector("#led").className = pick(i, "a", "b", "c");
});
`);
    expect(out.diagnostics).toEqual([]);
    expect(out.slotMap).toEqual({ led: { textSlot: 1, classSlot: 2 } });
    expect(out.animations).toEqual({ dot: { frames: 4, slot: 3 } });
    expect(out.sharedPickIndex).toEqual({ led: true });
    // No second tick handler was synthesized.
    expect(out.deviceSource.match(/widget\.on\("tick\.100ms"/g)).toHaveLength(1);
    // Textual order inside the handler: author writes, THEN the animation step.
    const authorAt = out.deviceSource.indexOf("__set(1, mod(i, 3));");
    const stepAt = out.deviceSource.indexOf("__anim0_dot = mod(__anim0_dot + 1, 4);");
    expect(authorAt).toBeGreaterThan(-1);
    expect(stepAt).toBeGreaterThan(authorAt);

    const sim = createMquickjsSimulator(out.deviceSource);
    for (let k = 1; k <= 9; k += 1) {
      const tick = sim.dispatch({ kind: "tick.100ms" } as any);
      expect(tick.committed).toBe(true);
      expect(tick.slots[1]).toBe(k % 3); // author's led text
      expect(tick.slots[2]).toBe(k % 3); // lockstep class
      expect(tick.slots[3]).toBe(k % 4); // animation frame, wraps at 4
    }
  });

  it("synthesizes tick.100ms for an animate-only script", () => {
    const out = transpileWidgetScript(`widget.animate("#spin", 2);\n`);
    expect(out.diagnostics).toEqual([]);
    expect(out.animations).toEqual({ spin: { frames: 2, slot: 1 } });
    expect(out.events).toEqual({ "tick.100ms": true });
    const sim = createMquickjsSimulator(out.deviceSource);
    expect(sim.dispatch({ kind: "tick.100ms" } as any).slots[1]).toBe(1);
    expect(sim.dispatch({ kind: "tick.100ms" } as any).slots[1]).toBe(0);
  });

  it("rejects duplicate animate, out-of-range frames, and non-literal frames", () => {
    const dup = transpileWidgetScript(`widget.animate("#a", 4);\nwidget.animate("#a", 4);\n`);
    expect(errorsOf(dup).some((d) => d.message.includes('Duplicate widget.animate("#a")'))).toBe(true);
    expect(dup.animations).toEqual({ a: { frames: 4, slot: 1 } });

    for (const frames of [1, 17, 0]) {
      const out = transpileWidgetScript(`widget.animate("#a", ${frames});\n`);
      expect(errorsOf(out).some((d) => d.message.includes("frames must be an integer 2..16"))).toBe(true);
      expect(out.animations).toEqual({});
    }

    const dynamic = transpileWidgetScript(`var n = 4;\nwidget.animate("#a", n);\n`);
    expect(errorsOf(dynamic).some((d) => d.message.includes("literal integer frame count"))).toBe(true);
    expect(dynamic.animations).toEqual({});
  });

  it("refuses an animated target that is also driven by writes", () => {
    const out = transpileWidgetScript(`var i = 0;
widget.animate("#a", 4);
widget.on("tick.1s", function (event) {
  i = mod(i + 1, 2);
  document.querySelector("#a").textContent = pick(i, "X", "Y");
});
`);
    const mixed = errorsOf(out).find((d) => d.message.includes("frame-driven only"));
    expect(mixed).toBeDefined();
    expect(mixed!.message).toContain('"#a"');
    // The refused write was dropped, never lowered onto a slot.
    expect(out.slotMap.a).toBeUndefined();
  });

  it("errors when no slot is left for an animation", () => {
    const writes = Array.from(
      { length: 14 },
      (_, i) => `  document.querySelector("#t${i}").textContent = pick(a, "A", "B");`,
    ).join("\n");
    const out = transpileWidgetScript(
      `var a = 0;\nwidget.animate("#late", 4);\nwidget.on("tick.1s", function (event) {\n${writes}\n});\n`,
    );
    const exhausted = errorsOf(out).find((d) => /exhausted/i.test(d.message) && d.message.includes("#late"));
    expect(exhausted).toBeDefined();
    expect(exhausted!.message).toContain("animation");
    expect(out.animations).toEqual({});
  });
});

describe("v3 transpiler: hidden", () => {
  it("hides via the reserved index and restores the staged content variant", () => {
    const out = transpileWidgetScript(`var m = 0;
widget.on("input.fn-bottom-knob", function (event) {
  m = m + event.delta;
  document.querySelector("#x").textContent = pick(m, "A", "B");
  document.querySelector("#x").hidden = event.delta < 0;
});
`);
    expect(out.diagnostics).toEqual([]);
    expect(out.hiddenVariant).toEqual({ x: 2 });
    expect(out.deviceSource).toContain("__hide(1, event.delta < 0, 2);");

    const sim = createMquickjsSimulator(out.deviceSource);
    // +1 → m=1, visible → content variant 1.
    expect(sim.dispatch({ kind: "input.fn-bottom-knob", delta: 1 } as any).slots[1]).toBe(1);
    // -1 → m=0, hidden → the reserved index 2 (== content variant count).
    expect(sim.dispatch({ kind: "input.fn-bottom-knob", delta: -1 } as any).slots[1]).toBe(2);
    // +1 → m=1, visible again → content restored to 1, not stuck at 2.
    expect(sim.dispatch({ kind: "input.fn-bottom-knob", delta: 1 } as any).slots[1]).toBe(1);
  });

  it("requires the content write in the same handler, before the hidden write", () => {
    // No content write at all (also covers content living in another handler).
    const orphan = transpileWidgetScript(`var a = 0;
widget.on("tick.1s", function (event) {
  a = mod(a + 1, 2);
  document.querySelector("#x").textContent = pick(a, "A", "B");
});
widget.on("input.fn-bottom-knob", function (event) {
  document.querySelector("#x").hidden = event.delta;
});
`);
    const needsContent = errorsOf(orphan).find((d) => d.message.includes("hidden write needs"));
    expect(needsContent).toBeDefined();
    expect(needsContent!.message).toContain("hidden = event.delta");

    // Content write after the hidden write would silently unhide.
    const after = transpileWidgetScript(`var a = 0;
widget.on("tick.1s", function (event) {
  a = mod(a + 1, 2);
  document.querySelector("#x").textContent = pick(a, "A", "B");
  document.querySelector("#x").hidden = a;
  document.querySelector("#x").textContent = pick(a, "A", "B");
});
`);
    expect(errorsOf(after).some((d) => d.message.includes("must come before"))).toBe(true);

    // Two hidden writes in one handler would wrap the hidden index itself.
    const twice = transpileWidgetScript(`var a = 0;
widget.on("tick.1s", function (event) {
  a = mod(a + 1, 2);
  document.querySelector("#x").textContent = pick(a, "A", "B");
  document.querySelector("#x").hidden = a;
  document.querySelector("#x").hidden = a;
});
`);
    expect(errorsOf(twice).some((d) => d.message.includes("more than one hidden write"))).toBe(true);
  });
});

describe("v3 transpiler: digits", () => {
  it("decomposes values onto consecutive display-order slots, 0 through max", () => {
    const out = transpileWidgetScript(`var v = 0;
widget.on("host.rpc:0xB201", function (event) {
  v = event.value;
  document.querySelector("#n").textContent = digits(v, 4);
});
`);
    expect(out.diagnostics).toEqual([]);
    expect(out.digitTargets).toEqual({ n: { count: 4, slot: 1 } });
    expect(out.slotMap).toEqual({});
    expect(out.deviceSource).toContain("__set(1, (v) | 0);");

    const sim = createMquickjsSimulator(out.deviceSource);
    const digitsOf = (value: number) => {
      const frame = sim.dispatch({ kind: "host.rpc", id: 0xb201, value } as any);
      expect(frame.committed).toBe(true);
      return [frame.slots[1]];
    };
    // Shared-slot mode: the RAW value publishes to one slot; the facade's
    // digitRaster divisors (formatter 13) extract display digits on-device.
    expect(digitsOf(0)).toEqual([0]);
    expect(digitsOf(7)).toEqual([7]);
    expect(digitsOf(123)).toEqual([123]);
    expect(digitsOf(9999)).toEqual([9999]);
    expect(digitsOf(90210)).toEqual([90210]);
  });

  it("matches the preview digits() intrinsic digit for digit", () => {
    const factory = new Function(`${INTRINSICS}\nreturn digits;`);
    const previewDigits = factory() as (value: number, count: number) => string;
    expect(previewDigits(0, 3)).toBe("000");
    expect(previewDigits(7, 3)).toBe("007");
    expect(previewDigits(999, 3)).toBe("999");
    expect(previewDigits(1234, 3)).toBe("234");

    const out = transpileWidgetScript(`var v = 0;
widget.on("host.rpc:0xB201", function (event) {
  v = event.value;
  document.querySelector("#n").textContent = digits(v, 3);
});
`);
    const sim = createMquickjsSimulator(out.deviceSource);
    for (const value of [0, 5, 42, 305, 999, 1234]) {
      const frame = sim.dispatch({ kind: "host.rpc", id: 0xb201, value } as any);
      // One raw-value slot; the device-side divisor rule renders the digits.
      const raw = Math.max(frame.slots[1], 0);
      const fromSlots = [100, 10, 1]
        .map((divisor) => Math.floor(raw / divisor) % 10).join("");
      expect(fromSlots).toBe(previewDigits(value, 3));
    }
  });

  it("rejects bad counts, mixing, and mismatched counts", () => {
    for (const count of ["0", "5"]) {
      const out = transpileWidgetScript(`var v = 0;
widget.on("tick.1s", function (event) {
  document.querySelector("#n").textContent = digits(v, ${count});
});
`);
      expect(errorsOf(out).some((d) => d.message.includes("count must be 1..4"))).toBe(true);
      expect(out.digitTargets).toEqual({});
    }

    const dynamic = transpileWidgetScript(`var v = 0;
var n = 2;
widget.on("tick.1s", function (event) {
  document.querySelector("#n").textContent = digits(v, n);
});
`);
    expect(errorsOf(dynamic).some((d) => d.message.includes("literal integer count"))).toBe(true);

    // digits first, pick later.
    const forward = transpileWidgetScript(`var v = 0;
widget.on("tick.1s", function (event) {
  document.querySelector("#n").textContent = digits(v, 2);
});
widget.on("input.fn-bottom-knob", function (event) {
  document.querySelector("#n").textContent = pick(v, "A", "B");
});
`);
    expect(errorsOf(forward).some((d) => d.message.includes("mixes digits()"))).toBe(true);

    // pick first, digits later.
    const reverse = transpileWidgetScript(`var v = 0;
widget.on("tick.1s", function (event) {
  document.querySelector("#n").textContent = pick(v, "A", "B");
});
widget.on("input.fn-bottom-knob", function (event) {
  document.querySelector("#n").textContent = digits(v, 2);
});
`);
    expect(errorsOf(reverse).some((d) => d.message.includes("mixes digits()"))).toBe(true);

    const differ = transpileWidgetScript(`var v = 0;
widget.on("tick.1s", function (event) {
  document.querySelector("#n").textContent = digits(v, 2);
});
widget.on("input.fn-bottom-knob", function (event) {
  document.querySelector("#n").textContent = digits(v, 3);
});
`);
    const mismatch = errorsOf(differ).find((d) => d.message.includes("digit count differs"));
    expect(mismatch).toBeDefined();
    expect(mismatch!.message).toContain("2 vs 3");
    // The canonical first-seen allocation stands.
    expect(differ.digitTargets).toEqual({ n: { count: 2, slot: 1 } });
  });

  it("errors when the pool cannot fit another digit slot", () => {
    // Shared-slot mode: each digits() target costs ONE slot regardless of its
    // count, so exhaustion needs all fourteen value slots consumed first.
    const ids = "abcdefghijklmn".split("");
    const writes = ids.map((id) =>
      `  document.querySelector("#${id}").textContent = digits(v, 4);`).join("\n");
    const out = transpileWidgetScript(`var v = 0;
widget.on("tick.1s", function (event) {
${writes}
  document.querySelector("#z").textContent = digits(v, 3);
});
`);
    const exhausted = errorsOf(out).find((d) => /exhausted/i.test(d.message));
    expect(exhausted).toBeDefined();
    expect(exhausted!.message).toContain("#z");
    expect(Object.keys(out.digitTargets).sort()).toEqual(ids.sort());
  });
});

describe("v3 transpiler: className", () => {
  it("allows a class-only target and keeps the class table", () => {
    const out = transpileWidgetScript(`var i = 0;
widget.on("input.fn-bottom-knob", function (event) {
  i = mod(i + event.delta, 2);
  document.querySelector("#led").className = pick(i, "on", "off");
});
`);
    expect(out.diagnostics).toEqual([]);
    expect(out.slotMap).toEqual({ led: { classSlot: 1 } });
    expect(out.classTables).toEqual({ led: ["on", "off"] });
    // Single-property targets get no lockstep verdict.
    expect(out.sharedPickIndex).toEqual({});

    const sim = createMquickjsSimulator(out.deviceSource);
    expect(sim.dispatch({ kind: "input.fn-bottom-knob", delta: 1 } as any).slots[1]).toBe(1);
  });

  it("proves three-property lockstep and reports the verdict", () => {
    const out = transpileWidgetScript(`var i = 0;
widget.on("tick.1s", function (event) {
  i = mod(i + 1, 2);
  document.querySelector("#z").textContent = pick(i, "1", "2");
  document.querySelector("#z").style.color = pick(i, "#111", "#222");
  document.querySelector("#z").className = pick(i, "ca", "cb");
});
`);
    expect(out.diagnostics).toEqual([]);
    expect(out.sharedPickIndex).toEqual({ z: true });
    const sim = createMquickjsSimulator(out.deviceSource);
    const frame = sim.dispatch({ kind: "tick.1s" } as any);
    expect(frame.slots.slice(1, 4)).toEqual([1, 1, 1]);
  });

  it("accepts identical index expressions over different table lengths (constant-label pattern)", () => {
    // Table LENGTHS are the assembler's decision tree; the transpiler proves
    // index-expression identity only, so a constant label class-swapped by the
    // same index stays legal.
    const out = transpileWidgetScript(`var i = 0;
widget.on("tick.1s", function (event) {
  i = mod(i + 1, 3);
  document.querySelector("#led").textContent = pick(i, "OK");
  document.querySelector("#led").className = pick(i, "a", "b", "c");
});
`);
    expect(out.diagnostics).toEqual([]);
    expect(out.sharedPickIndex).toEqual({ led: true });
    expect(out.tables.led).toEqual(["OK"]);
    expect(out.classTables.led).toEqual(["a", "b", "c"]);
  });

  it("errors when className is not provably lockstep with the target's other writes", () => {
    // Different index expressions.
    const independent = transpileWidgetScript(`var i = 0;
var j = 0;
widget.on("tick.1s", function (event) {
  i = mod(i + 1, 2);
  j = mod(j + 1, 2);
  document.querySelector("#z").textContent = pick(i, "1", "2");
  document.querySelector("#z").className = pick(j, "a", "b");
});
`);
    expect(errorsOf(independent).some((d) => d.message.includes("same pick index"))).toBe(true);
    expect(independent.sharedPickIndex).toEqual({ z: false });

    // A state mutation between the writes voids the textual proof.
    const interposed = transpileWidgetScript(`var i = 0;
widget.on("tick.1s", function (event) {
  i = mod(i + 1, 2);
  document.querySelector("#z").textContent = pick(i, "1", "2");
  i = mod(i + 1, 2);
  document.querySelector("#z").className = pick(i, "a", "b");
});
`);
    expect(errorsOf(interposed).some((d) => d.message.includes("same pick index"))).toBe(true);

    // A handler that writes only ONE of the properties leaves them free-running.
    const partial = transpileWidgetScript(`var i = 0;
widget.on("tick.1s", function (event) {
  i = mod(i + 1, 2);
  document.querySelector("#z").textContent = pick(i, "1", "2");
  document.querySelector("#z").className = pick(i, "a", "b");
});
widget.on("input.fn-bottom-knob", function (event) {
  i = mod(i + event.delta, 2);
  document.querySelector("#z").className = pick(i, "a", "b");
});
`);
    expect(errorsOf(partial).some((d) => d.message.includes("same pick index"))).toBe(true);
  });

  it("keeps the legacy text+color behaviour: unprovable pairs report false without erroring", () => {
    const out = transpileWidgetScript(`var i = 0;
var j = 0;
widget.on("tick.1s", function (event) {
  i = mod(i + 1, 2);
  j = mod(j + 1, 2);
  document.querySelector("#z").textContent = pick(i, "1", "2");
  document.querySelector("#z").style.color = pick(j, "#111", "#222");
});
`);
    expect(out.diagnostics).toEqual([]);
    expect(out.sharedPickIndex).toEqual({ z: false });
  });

  it("caps className variants at 16 and refuses constant className strings", () => {
    const variants = Array.from({ length: 17 }, (_, i) => `"c${i}"`).join(", ");
    const over = transpileWidgetScript(`var i = 0;
widget.on("tick.1s", function (event) {
  document.querySelector("#z").className = pick(i, ${variants});
});
`);
    expect(errorsOf(over).some((d) => d.message.includes("at most 16"))).toBe(true);
    expect(over.classTables).toEqual({});

    const constant = transpileWidgetScript(`var i = 0;
widget.on("tick.1s", function (event) {
  document.querySelector("#z").className = "solo";
});
`);
    expect(errorsOf(constant).some((d) => d.message.includes("Unsupported document write"))).toBe(true);
  });
});

describe("v3 preview runtime", () => {
  // The preview iframe executes the ORIGINAL DSL, so the srcdoc's script must
  // load a v3 widget without throwing and drive the real DOM sensibly:
  // className/hidden natively, digits() as zero-padded text, widget.animate as
  // a validated declaration (the native CSS animation plays live). This
  // evaluates the exact <script> text buildWidgetSrcdoc ships, against stubs.
  function loadPreview(script: string) {
    const srcdoc = buildWidgetSrcdoc({
      html: LEGACY_PRESETS.pulse.html,
      css: LEGACY_PRESETS.pulse.css,
      script,
      rootClass: LEGACY_PRESETS.pulse.rootClass,
    });
    const scriptText = /<script>([\s\S]*)<\/script>/.exec(srcdoc)![1];
    const elements = new Map<string, { textContent: string; className: string; hidden: unknown; style: Record<string, string> }>();
    const documentStub = {
      querySelector(selector: string) {
        const id = String(selector).replace(/^#/, "");
        let element = elements.get(id);
        if (!element) {
          element = { textContent: "", className: "", hidden: false, style: {} };
          elements.set(id, element);
        }
        return element;
      },
    };
    const windowStub: Record<string, unknown> = { addEventListener() {} };
    const factory = new Function(
      "window",
      "document",
      `${scriptText}\nreturn { runtime: window.__widgetRuntime, error: window.__widgetError };`,
    );
    const { runtime, error } = factory(windowStub, documentStub) as {
      runtime: { dispatch: (event: object) => { handled: boolean; error?: string } ; handlerCount: () => number };
      error: string | undefined;
    };
    return { runtime, loadError: error, elements };
  }

  it("loads and drives the pulse DSL: animate accepted, class/digits/hidden applied", () => {
    const { runtime, loadError, elements } = loadPreview(LEGACY_PRESETS.pulse.script);
    expect(loadError).toBeUndefined();
    expect(runtime.handlerCount()).toBe(5);

    const knob = runtime.dispatch({ kind: "input.fn-bottom-knob", delta: 1 });
    expect(knob.handled).toBe(true);
    expect(knob.error).toBeUndefined();
    expect(elements.get("badge")!.className).toBe("pulse-badge state-warn");
    expect(elements.get("badge")!.textContent).toBe("BUSY");

    const key = runtime.dispatch({ kind: "input.key.down", key: 0 });
    expect(key.error).toBeUndefined();
    expect(elements.get("count")!.textContent).toBe("001");

    const hide = runtime.dispatch({ kind: "host.rpc", id: 0xb201, value: 0 });
    expect(hide.error).toBeUndefined();
    expect(elements.get("toast")!.textContent).toBe("SYNCED");
    expect(Boolean(elements.get("toast")!.hidden)).toBe(true);

    const show = runtime.dispatch({ kind: "host.rpc", id: 0xb201, value: 1 });
    expect(show.error).toBeUndefined();
    expect(Boolean(elements.get("toast")!.hidden)).toBe(false);
  });

  it("surfaces widget.animate misuse as a load error, mirroring the transpiler", () => {
    const { loadError: badFrames } = loadPreview('widget.animate("#spinner", 99);');
    expect(badFrames).toContain("2..16");
    const { loadError: badSelector } = loadPreview('widget.animate("spinner", 8);');
    expect(badSelector).toContain('"#id" selector');
  });
});

describe("v3 transpiler: guardrails", () => {
  it("keeps v2-only scripts free of every v3 helper (byte-stable output)", () => {
    const out = transpileWidgetScript(`var a = 0;
widget.on("tick.1s", function (event) {
  a = mod(a + 1, 2);
  document.querySelector("#x").textContent = pick(a, "A", "B");
  document.querySelector("#x").style.color = pick(a, "#111", "#222");
});
`);
    expect(out.diagnostics).toEqual([]);
    expect(out.deviceSource).not.toMatch(/__hide|__digits|__anim/);
    expect(out.classTables).toEqual({});
    expect(out.animations).toEqual({});
    expect(out.hiddenVariant).toEqual({});
    expect(out.digitTargets).toEqual({});
  });

  it("refuses widget.animate inside a handler body", () => {
    const out = transpileWidgetScript(`var a = 0;
widget.on("tick.1s", function (event) {
  widget.animate("#x", 4);
  a = a + 1;
});
`);
    const misplaced = errorsOf(out).find((d) => d.message.includes("top-level (load-time) declaration"));
    expect(misplaced).toBeDefined();
    // The statement was dropped: the device source must not carry a call the
    // device VM has no method for.
    expect(out.deviceSource).not.toContain("widget.animate");
    expect(out.animations).toEqual({});
  });

  it("reserves digits and the __anim state namespace", () => {
    const out = transpileWidgetScript(`var digits = 0;
var __anim0_x = 1;
widget.on("tick.1s", function (event) {
  digits = digits + 1;
});
`);
    const reserved = errorsOf(out).filter((d) => d.message.includes("reserved by the transpiler"));
    expect(reserved.some((d) => d.message.includes('"digits"'))).toBe(true);
    expect(reserved.some((d) => d.message.includes('"__anim0_x"'))).toBe(true);
  });
});
