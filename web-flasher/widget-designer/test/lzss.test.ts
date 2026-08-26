// The LZSS port must be bit-compatible with the canary toolchain in BOTH
// directions: decode what the keyboard pipeline built, and rebuild it
// byte-for-byte. The flashed weather base frame is the ground truth — the
// canary encoder is deterministic greedy, so re-encoding its own decode must
// reproduce the golden bytes exactly. Anything else means the Designer would
// compress differently than every pinned asset.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { decodeLzss, encodeLzss } from "../src/compiler/lzss";

const ROOT = new URL("../../../", import.meta.url).pathname;
const GOLDEN_PATH = `${ROOT}experiments/mquickjs-esp32s3-physical-canary/` +
  "build-diag-module-weather2/assets/weather-id28-base.lzss";
const FRAME_BYTES = 62_000;

/** Deterministic PRNG so a failing buffer is reproducible from the seed. */
function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("LZSS vs the flashed golden asset", () => {
  const golden = new Uint8Array(readFileSync(GOLDEN_PATH));

  it("decodes the flashed base frame to exactly 62000 bytes", () => {
    const frame = decodeLzss(golden, FRAME_BYTES);
    expect(frame.length).toBe(FRAME_BYTES);
    // The weather base is a real rendered frame, not a degenerate fill.
    expect(new Set(frame).size).toBeGreaterThan(1);
  });

  it("re-encodes the decoded frame byte-for-byte", () => {
    const reencoded = encodeLzss(decodeLzss(golden, FRAME_BYTES));
    expect(reencoded.length).toBe(golden.length);
    // Whole-buffer equality; a failure prints the first differing offset.
    const firstDiff = reencoded.findIndex((byte, index) => byte !== golden[index]);
    expect(firstDiff).toBe(-1);
  });
});

describe("LZSS round-trips", () => {
  const roundTrip = (bytes: Uint8Array) => {
    const decoded = decodeLzss(encodeLzss(bytes), bytes.length);
    const firstDiff = decoded.findIndex((byte, index) => byte !== bytes[index]);
    expect(firstDiff).toBe(-1);
    expect(decoded.length).toBe(bytes.length);
  };

  it("handles the empty buffer", () => {
    expect(encodeLzss(new Uint8Array(0)).length).toBe(0);
    expect(decodeLzss(new Uint8Array(0), 0).length).toBe(0);
  });

  it("round-trips incompressible random buffers", () => {
    const random = mulberry32(0xf2f2);
    // Lengths off the 8-case boundary exercise the final partial flag group.
    for (const length of [1, 2, 7, 8, 9, 255, 1023, 1024, 1025, 4093]) {
      const bytes = new Uint8Array(length);
      for (let index = 0; index < length; index += 1) bytes[index] = Math.floor(random() * 256);
      roundTrip(bytes);
    }
  });

  it("round-trips runs, including overlapped and max-length matches", () => {
    // A pure run forces distance-1 overlapping copies chunked at max match 66.
    roundTrip(new Uint8Array(500).fill(0xaa));
    // Runs longer than the 1024-byte window still match within it.
    roundTrip(new Uint8Array(3000).fill(0x55));
    // Period-3 pattern: matches with distance shorter than their length.
    const periodic = new Uint8Array(700);
    for (let index = 0; index < periodic.length; index += 1) periodic[index] = index % 3;
    roundTrip(periodic);
  });

  it("round-trips mixed compressible and incompressible regions", () => {
    const random = mulberry32(0x1d28);
    const bytes = new Uint8Array(6000);
    for (let index = 0; index < bytes.length; index += 1) {
      const block = Math.floor(index / 500);
      bytes[index] = block % 2 === 0 ? Math.floor(random() * 256) : (block * 17) & 0xff;
    }
    roundTrip(bytes);
  });
});

describe("LZSS decode rejects malformed streams", () => {
  const stream = encodeLzss(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]));

  it("throws when the stream ends before the expected length", () => {
    expect(() => decodeLzss(stream, 100)).toThrow(/LZSS/);
    expect(() => decodeLzss(stream.subarray(0, stream.length - 1), 9)).toThrow(/LZSS/);
    expect(() => decodeLzss(new Uint8Array(0), 1)).toThrow("LZSS flags overrun.");
  });

  it("throws on trailing bytes past the expected length", () => {
    const padded = new Uint8Array(stream.length + 1);
    padded.set(stream);
    expect(() => decodeLzss(padded, 9)).toThrow("LZSS trailing bytes.");
    expect(() => decodeLzss(stream, 8)).toThrow("LZSS trailing bytes.");
  });

  it("throws when a match reaches before the output start", () => {
    // flags=0x01 then code 0x0000: distance 1, length 3 — at destination 0.
    expect(() => decodeLzss(Uint8Array.from([0x01, 0x00, 0x00]), 3))
      .toThrow("LZSS match escaped output.");
  });

  it("throws when a match runs past the expected length", () => {
    // One literal, then distance 1 length 3 into a 2-byte output.
    expect(() => decodeLzss(Uint8Array.from([0x02, 0x41, 0x00, 0x00]), 2))
      .toThrow(/LZSS/);
  });
});
