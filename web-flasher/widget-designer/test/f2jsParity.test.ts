// Phase 0 ground truth: the Designer's F2JS encoder must be byte-identical to
// the package that ACTUALLY RAN on the keyboard.
//
// weather-id28-gen19.f2js is the exact widget flashed in the id28 canary
// (live-tested; its sha is pinned in experiments/mquickjs-weather2-facade).
// This test rebuilds it from the same source and declarations using the
// Designer's browser encoder. Anything but byte equality means the Designer
// would produce packages the device might reject — or worse, mis-run.

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { buildF2JSPackage } from "../src/compiler/f2jsPackage";

const ROOT = new URL("../../../", import.meta.url).pathname;
const ASSETS = `${ROOT}experiments/mquickjs-esp32s3-physical-canary/build-diag-module-weather2/assets/`;

/** The exact flashed pin from experiments/mquickjs-weather2-facade/build.mjs. */
const FLASHED_F2JS_SHA256 = "7aeeecde59bd686b3455feadc74b4b7705ca0c8ea933f9b0669cb8dc656c284e";

/** Mirrors WEATHER_MQUICKJS_TARGETS in the weather-canary protocol. */
const WEATHER_TARGETS = [
  { id: "weatherScreen", writes: ["hidden"] },
  { id: "place", writes: ["textContent"] },
  { id: "status", writes: ["textContent", "color"] },
  { id: "currentTemp", writes: ["textContent"] },
  { id: "currentCond", writes: ["textContent", "color"] },
  { id: "age", writes: ["textContent"] },
  { id: "d1Name", writes: ["textContent"] },
  { id: "d1Cond", writes: ["textContent", "color"] },
  { id: "d1Temps", writes: ["textContent"] },
  { id: "d2Name", writes: ["textContent"] },
  { id: "d2Cond", writes: ["textContent", "color"] },
  { id: "d2Temps", writes: ["textContent"] },
  { id: "d3Name", writes: ["textContent"] },
  { id: "d3Cond", writes: ["textContent", "color"] },
  { id: "d3Temps", writes: ["textContent"] },
  // The flashed btp1 package carries one more target than the checked-in
  // 15-target protocol list: the ZIP-settings retry row (textContent+hidden).
  { id: "retry", writes: ["textContent", "hidden"] },
] as const;

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

describe("Designer F2JS encoder vs the flashed weather package", () => {
  const goldenBytes = new Uint8Array(readFileSync(`${ASSETS}weather-id28-gen19.f2js`));
  const source = readFileSync(`${ASSETS}weather-id28-gen19.js`, "utf8");

  it("the checked-in golden bytes still match the flashed pin", () => {
    expect(sha256(goldenBytes)).toBe(FLASHED_F2JS_SHA256);
  });

  it("rebuilds the flashed package byte-for-byte", async () => {
    // requiredWeatherCanaryHostRpcIds(): 0xB240..0xB244, 0xB24D..0xB24F,
    // and the settings ids — read them from the protocol module instead of
    // hardcoding, so a protocol change fails loudly here.
    const { requiredWeatherCanaryHostRpcIds } = await import(
      `${ROOT}f1-widget-sdk/examples/render-v2-mquickjs-weather-canary/protocol.mjs`
    );
    const built = await buildF2JSPackage({
      source,
      generation: 19,
      events: {
        "tick.1s": true,
        "tick.100ms": true,
        "input.fn-bottom-knob": true,
        hostRpcIds: requiredWeatherCanaryHostRpcIds(),
        keys: [
          { id: 0, nativeToken: 0x2c },
          { id: 1, nativeToken: 0xe1 },
        ],
        chords: [{ id: 0, heldMask: 3 }],
      },
      input: { debounceMs: 10, holdDelayMs: 500, holdCadenceMs: 100 },
      targets: WEATHER_TARGETS as any,
    });

    expect(built.bytes).toBe(goldenBytes.length);
    expect(sha256(built.binary)).toBe(FLASHED_F2JS_SHA256);
    // Belt and braces: whole-buffer equality, so a hash collision can never
    // mask a mismatch and a failure prints the first differing offset.
    const firstDiff = built.binary.findIndex((b, i) => b !== goldenBytes[i]);
    expect(firstDiff).toBe(-1);
  });
});
