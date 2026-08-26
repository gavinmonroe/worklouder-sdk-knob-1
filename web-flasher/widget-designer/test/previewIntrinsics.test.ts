// The preview iframe's script intrinsics (widgetRuntime.ts INTRINSICS) must
// implement exactly what the device ABI implements, or a widget behaves
// differently in the Designer than on the keyboard. clamp() is the intrinsic
// that historically was MISSING here (widgets using it compiled to valid
// device programs and then threw ReferenceError in the preview), so it gets
// both a direct semantic test and a behavioral cross-check against the
// transpiler's device prelude running in the mquickjs simulator.

import { describe, expect, it } from "vitest";

import { INTRINSICS } from "../src/compiler/widgetRuntime";
import { transpileWidgetScript } from "../src/compiler/mquickjsTranspiler";
import { createMquickjsSimulator } from "../src/compiler/mquickjsSimulator";

type Intrinsics = {
  mod: (value: number, modulus: number) => number;
  pick: (index: number, ...variants: unknown[]) => unknown;
  clamp: (value: unknown, minimum: number, maximum: number) => number;
};

function loadIntrinsics(): Intrinsics {
  // Evaluate the same source text the preview iframe receives.
  const factory = new Function(`${INTRINSICS}\nreturn { mod: mod, pick: pick, clamp: clamp };`);
  return factory() as Intrinsics;
}

describe("preview intrinsics", () => {
  it("clamp matches the device clampMin/clampMax semantics", () => {
    const { clamp } = loadIntrinsics();
    // Plain bounding.
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(42, 0, 10)).toBe(10);
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
    // Device ordering: clampMin runs BEFORE clampMax, so inverted bounds
    // resolve to the maximum for every input.
    expect(clamp(1, 5, 2)).toBe(2);
    expect(clamp(10, 5, 2)).toBe(2);
    expect(clamp(3, 5, 2)).toBe(2);
    // Integer coercion with | 0, exactly as the VM's int32 arithmetic.
    expect(clamp(3.9, 0, 10)).toBe(3);
    expect(clamp(-1.9, -10, 10)).toBe(-1);
    expect(clamp("7", 0, 10)).toBe(7);
    expect(clamp(undefined, 3, 10)).toBe(3);
  });

  it("mod and pick keep their non-negative wrap semantics", () => {
    const { mod, pick } = loadIntrinsics();
    expect(mod(-1, 4)).toBe(3);
    expect(mod(9, 4)).toBe(1);
    expect(pick(-1, "a", "b", "c")).toBe("c");
    expect(pick(4, "a", "b", "c")).toBe("b");
  });

  it("preview clamp agrees with the transpiled device prelude, end to end", () => {
    const { clamp } = loadIntrinsics();
    // A widget that clamps knob-accumulated state into a five-variant pick.
    const dsl = [
      "var v = 0;",
      'widget.on("input.fn-bottom-knob", function (event) {',
      "  v = clamp(v + event.delta, 0, 4);",
      '  document.querySelector("#out").textContent = pick(v, "v0", "v1", "v2", "v3", "v4");',
      "});",
    ].join("\n");
    const transpiled = transpileWidgetScript(dsl);
    expect(transpiled.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const simulator = createMquickjsSimulator(transpiled.deviceSource);
    const slot = transpiled.slotMap.out.textSlot!;

    // Saturating knob accumulator: every step clamps state through the DEVICE
    // prelude's clamp, and the model below clamps through the PREVIEW's — the
    // published slot must match at every step or the two have diverged.
    const deltas = [-2, 1, -4, 3, 2, 5, -1, 90, -200, 7];
    let running = 0;
    for (const delta of deltas) {
      running = clamp(running + delta, 0, 4);
      const frame = simulator.dispatch({ kind: "input.fn-bottom-knob", delta } as any);
      expect(frame.handled).toBe(true);
      expect(frame.slots[slot]).toBe(running);
    }
  });
});
