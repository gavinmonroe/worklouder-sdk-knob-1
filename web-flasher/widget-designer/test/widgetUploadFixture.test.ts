// Emits the ASSEMBLED-widget fixture the firmware's f2up verifier cross-checks:
// a complete DSL → F2UP container built by the real assembler (not synthetic
// section bytes like f2upFixtures.test.ts writes). The sha pin below freezes
// the whole Designer pipeline — transpiler, F2JS/F2TF encoders, LZSS, container
// framing; any byte drift anywhere fails here first, BEFORE the C side sees a
// changed fixture. This test writes only assembled-widget.f2up; manifest.json
// belongs to f2upFixtures.test.ts and the verifier.
//
// CONTRACT V3: the fixture now carries the assembler's DEFAULT output —
// variantRaster (formatter 12) tables captured through a deterministic
// synthetic bridge, under the v3 contract sha. The C-side cross-check
// (experiments/mquickjs-widget-upload/verify.mjs) must admit v3 assets to
// accept it; until the firmware admission pins v3 the cross-check is PENDING.
// The DSL differs from the pre-v3 fixture in exactly one way: the knob
// handler drives #gear's colour alongside its text, because a raster table
// binds ONE value slot and the old independent text/colour picks are refused
// by design under the raster default.

import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { assembleWidgetUpload, type VariantCaptureBridge } from "../src/compiler/widgetAssembler";
import { decodeUploadContainer } from "../src/compiler/uploadContainer";
import { DEVICE_PIXELS, DEVICE_WIDTH } from "../src/compiler/renderV2Package";

const ROOT = new URL("../../../", import.meta.url).pathname;
const FIXTURES = `${ROOT}experiments/mquickjs-widget-upload/fixtures`;

// The flashed weather canary runs generation 19, so the first real upload is
// generation 20 — the fixture carries exactly what that push would.
const GENERATION = 20;

/** Pin for the assembled container. Recompute deliberately, never casually:
 *  a change means the Designer now produces different device bytes.
 *  2026-08-25: repinned for the v3 contract identity gaining digitRaster
 *  (formatter 13) — the F2TF header's embedded contract sha (offset 160)
 *  changed, and with it the header CRC and section shas; every other byte of
 *  the container is unchanged. */
// Repinned 2026-08-27: any-key input. The default key set is space, shift and
// "any" (HID 0x01) — the firmware re-delivers every UNDECLARED key under that
// catch-all token, so a widget hears the whole keyboard while space/shift keep
// ids 0/1 for the chord. Changing the event table changes this pin.
const ASSEMBLED_SHA256 = "f29d06b0e4a8c64382839246413e2b8c66b872d8321d809ac9fd2529cfa0a82d";

const DSL = `var counter = 0;
var knobPos = 0;
var hostVal = 0;

widget.on("tick.1s", function (event) {
  counter = mod(counter + 1, 4);
  document.querySelector("#status").textContent = pick(counter, "IDLE", "WARM", "RUN", "COOL");
});

widget.on("input.fn-bottom-knob", function (event) {
  knobPos = mod(knobPos + event.delta, 3);
  document.querySelector("#gear").textContent = pick(knobPos, "LO", "MID", "HI");
  document.querySelector("#gear").style.color = pick(knobPos, "#59E2FF", "#FFB74D", "#FF5F97");
});

widget.on("host.rpc:0xB201", function (event) {
  hostVal = mod(event.value, 3);
  document.querySelector("#gear").textContent = pick(hostVal, "LO", "MID", "HI");
  document.querySelector("#gear").style.color = pick(hostVal, "#59E2FF", "#FFB74D", "#FF5F97");
});

widget.on("input.key.down", function (event) {
  counter = clamp(counter + 1, 0, 3);
  document.querySelector("#status").textContent = pick(counter, "IDLE", "WARM", "RUN", "COOL");
});

widget.on("input.chord.down", function (event) {
  document.querySelector("#status").textContent = pick(0, "IDLE", "WARM", "RUN", "COOL");
});
`;

const LAYOUTS = {
  status: { x: 10, y: 20, width: 72, height: 12 },
  gear: { x: 10, y: 40, width: 60, height: 12 },
};

/**
 * Deterministic synthetic preview, so the fixture bytes are a pure function
 * of the DSL: the banded background the pre-v3 fixture used (with its
 * distinctive corner pixel), and each non-blank target rendered as a solid
 * rect whose colour is an FNV-1a hash of (text, inline colour).
 */
function colourFor(text: string, color: string): number {
  let hash = 2166136261 >>> 0;
  for (const character of `${text}|${color}`) {
    hash = (hash ^ character.codePointAt(0)!) >>> 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return 0x8000 | (hash & 0x7fff);
}

function fixtureBridge(): VariantCaptureBridge {
  const texts: Record<string, string> = {};
  const colors: Record<string, string> = {};
  return {
    setText: (id, text) => { texts[id] = text; },
    setColor: (id, cssColor) => { colors[id] = cssColor; },
    captureFrame: () => {
      const frame = new Uint16Array(DEVICE_PIXELS);
      for (let y = 0; y < 310; y += 1) {
        const colour = y < 100 ? 0x0861 : y < 200 ? 0x18e3 : 0x2965;
        for (let x = 0; x < DEVICE_WIDTH; x += 1) frame[y * DEVICE_WIDTH + x] = colour;
      }
      frame[0] = 0xf800; // the pre-v3 fixture's distinctive corner pixel
      for (const [id, rect] of Object.entries(LAYOUTS)) {
        const text = texts[id] ?? "";
        if (text.length === 0) continue;
        const colour = colourFor(text, colors[id] ?? "");
        for (let row = 0; row < rect.height; row += 1) {
          for (let column = 0; column < rect.width; column += 1) {
            frame[(rect.y + row) * DEVICE_WIDTH + rect.x + column] = colour;
          }
        }
      }
      return frame;
    },
  };
}

describe("assembled-widget fixture for the firmware cross-check", () => {
  it("writes assembled-widget.f2up and pins its sha256", async () => {
    const assembled = await assembleWidgetUpload({
      dsl: DSL,
      generation: GENERATION,
      layouts: LAYOUTS,
      capture: fixtureBridge(),
    });
    expect(assembled.renderModes).toEqual({ status: "raster", gear: "raster" });
    expect(assembled.rasterCosts.map((cost) => cost.bytes)).toEqual([
      4 * 72 * 12 * 2,
      3 * 60 * 12 * 2,
    ]);

    // Assembly must be deterministic, or the pin (and the C cross-check)
    // would be meaningless.
    const sha = createHash("sha256").update(assembled.binary).digest("hex");
    expect(sha).toBe(assembled.sha256);
    expect(sha).toBe(ASSEMBLED_SHA256);

    // Belt and braces before it becomes another verifier's input.
    const decoded = await decodeUploadContainer(assembled.binary);
    expect(decoded.generation).toBe(GENERATION);

    mkdirSync(FIXTURES, { recursive: true });
    writeFileSync(`${FIXTURES}/assembled-widget.f2up`, assembled.binary);
  });
});
