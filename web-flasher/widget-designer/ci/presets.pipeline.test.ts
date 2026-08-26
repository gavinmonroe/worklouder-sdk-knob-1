// CI gate: every bundled example must honor its advertised pipeline reach.
// Run via `npm run check:presets` (or as part of `npm test`).
//
// The pipeline has two independent gates, and this file pins each preset's
// standing on both — the exact checks the Export tab's buttons run:
//
//   * STRICT_SIM_READY — the strict F2JS simulator parses the script once
//     the shell applies the canonical `"use strict"` header on load. This
//     gates Build F2JS (the store's compileF2JS needs a live simulator).
//   * DEVICE_DSL_READY — the mquickjs device-DSL transpile passes, which
//     gates Assemble F2UP (the assembler transpiles before it captures).
//
// Presets outside a set intentionally use preview-only JavaScript for that
// gate (widget.snapshot / widget.animate / free-form handler bodies);
// src/presets/widgets.ts is a protected surface, so they cannot be rewritten
// here, and the shell presents them as informational notices, never errors.
// Membership assertions run in BOTH directions, so a regression fails
// outright and a fixed example forces its own promotion.

import { describe, expect, it } from "vitest";
import { PRESETS, PRESET_ORDER } from "../src/presets/widgets";
import { RENDER_V2_MQUICKJS_SOURCE_PREFIX } from "../src/compiler/constants";
import { createMquickjsSimulator } from "../src/compiler/mquickjsSimulator";
import { transpileWidgetScript } from "../src/compiler/mquickjsTranspiler";
import { buildF2JSPackage } from "../src/compiler/f2jsPackage";

const STRICT_SIM_READY = new Set(["events", "focusDial", "weatherDevice", "pomodoro"]);
const DEVICE_DSL_READY = new Set(["focusDial", "weatherDevice", "pulse", "pomodoro"]);

const withHeader = (script: string) =>
  script.startsWith(RENDER_V2_MQUICKJS_SOURCE_PREFIX)
    ? script
    : RENDER_V2_MQUICKJS_SOURCE_PREFIX + script;

const dslErrors = (script: string) =>
  transpileWidgetScript(script).diagnostics.filter((d) => d.severity === "error");

it("the default boot example passes every gate", () => {
  // App boots into weatherDevice: it must stay fully pipeline-green so the
  // first thing a new user sees is a working Build AND Assemble path.
  expect(STRICT_SIM_READY.has("weatherDevice")).toBe(true);
  expect(DEVICE_DSL_READY.has("weatherDevice")).toBe(true);
});

for (const p of PRESET_ORDER) {
  const id = String(p.id);
  const widget = PRESETS[p.id];

  describe(`preset "${p.label}" (${id})`, () => {
    it("builds an F2JS package", async () => {
      const pkg = await buildF2JSPackage({
        source: widget.script,
        generation: 1,
        events: {},
        targets: [],
        rasterBase: null,
      });
      expect(pkg.bytes).toBeGreaterThan(0);
      expect(pkg.sha256).toMatch(/^[0-9a-f]{64}$/);
    });

    it(
      STRICT_SIM_READY.has(id)
        ? "parses in the strict simulator with the canonical header"
        : "is preview-only for the strict simulator (canary: promote when it parses)",
      () => {
        const parse = () => createMquickjsSimulator(withHeader(widget.script));
        if (STRICT_SIM_READY.has(id)) expect(parse).not.toThrow();
        else expect(parse, `${id} now parses — move it into STRICT_SIM_READY`).toThrow();
      },
    );

    it(
      DEVICE_DSL_READY.has(id)
        ? "passes the device DSL gate (Assemble F2UP transpile)"
        : "is preview-only for the device DSL (canary: promote when it transpiles)",
      () => {
        const errors = dslErrors(widget.script).map((d) => d.message);
        if (DEVICE_DSL_READY.has(id)) {
          expect(errors, `${id} must transpile cleanly for the F2UP path`).toEqual([]);
        } else {
          expect(errors.length, `${id} now transpiles — move it into DEVICE_DSL_READY`).toBeGreaterThan(0);
        }
      },
    );
  });
}
