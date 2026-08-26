// Crop geometry + RGB565 packing for variantRaster capture, in the style of
// test/frameCapture.test.ts: paint known solid rects into a synthetic frame,
// crop, and assert exact pixels at computed row-major indices — a wrong-width
// stride, a transposed axis, or an off-by-one crop bound lands at least one
// probe on the wrong colour.

import { describe, expect, it } from "vitest";

import {
  alignRectToDevicePixels,
  cropRgb565Frame,
  rgb565FrameToBytes,
} from "../src/compiler/frameCapture";
import { DEVICE_HEIGHT, DEVICE_PIXELS, DEVICE_WIDTH } from "../src/compiler/renderV2Package";

const RED = 0xf800;
const GREEN = 0x07e0;
const BLUE = 0x001f;
const WHITE = 0xffff;

/** Quadrant frame: (x<50,y<155)=RED, (x>=50,y<155)=GREEN, then BLUE/WHITE. */
function quadrantFrame(): Uint16Array {
  const frame = new Uint16Array(DEVICE_PIXELS);
  for (let y = 0; y < DEVICE_HEIGHT; y += 1) {
    for (let x = 0; x < DEVICE_WIDTH; x += 1) {
      frame[y * DEVICE_WIDTH + x] =
        y < 155 ? (x < 50 ? RED : GREEN) : x < 50 ? BLUE : WHITE;
    }
  }
  return frame;
}

describe("cropRgb565Frame", () => {
  it("crops a rect across the quadrant seams pixel-exactly", () => {
    const frame = quadrantFrame();
    // 4x4 rect centred on the (50,155) seam crossing: every quadrant appears.
    const crop = cropRgb565Frame(frame, { x: 48, y: 153, width: 4, height: 4 });
    expect(crop.length).toBe(16);
    // Row-major: rows 0..1 are y=153..154 (RED RED GREEN GREEN), rows 2..3
    // are y=155..156 (BLUE BLUE WHITE WHITE).
    expect([...crop]).toEqual([
      RED, RED, GREEN, GREEN,
      RED, RED, GREEN, GREEN,
      BLUE, BLUE, WHITE, WHITE,
      BLUE, BLUE, WHITE, WHITE,
    ]);
  });

  it("preserves row-major order for a single-row and single-column crop", () => {
    const frame = quadrantFrame();
    frame[10 * DEVICE_WIDTH + 3] = 0x1234; // one marked pixel at (3,10)
    const row = cropRgb565Frame(frame, { x: 2, y: 10, width: 3, height: 1 });
    expect([...row]).toEqual([RED, 0x1234, RED]);
    const column = cropRgb565Frame(frame, { x: 3, y: 9, width: 1, height: 3 });
    expect([...column]).toEqual([RED, 0x1234, RED]);
  });

  it("crops the full canvas to an identical frame", () => {
    const frame = quadrantFrame();
    const crop = cropRgb565Frame(frame, { x: 0, y: 0, width: DEVICE_WIDTH, height: DEVICE_HEIGHT });
    expect(crop.length).toBe(DEVICE_PIXELS);
    expect(Buffer.from(crop.buffer).equals(Buffer.from(frame.buffer))).toBe(true);
  });

  it("packs crops little-endian through the shared serializer", () => {
    // The raster tables ship crop pixels via the same LE convention as the
    // base frame; prove the two agree on byte order for an asymmetric value.
    const frame = quadrantFrame();
    frame[0] = 0xabcd;
    const crop = cropRgb565Frame(frame, { x: 0, y: 0, width: 2, height: 1 });
    expect([...crop]).toEqual([0xabcd, RED]);
    const bytes = rgb565FrameToBytes(frame);
    expect([bytes[0], bytes[1]]).toEqual([0xcd, 0xab]);
  });

  it("rejects rects that escape the canvas instead of clamping silently", () => {
    const frame = quadrantFrame();
    expect(() => cropRgb565Frame(frame, { x: 99, y: 0, width: 2, height: 1 })).toThrow(/inside 100x310/);
    expect(() => cropRgb565Frame(frame, { x: 0, y: 309, width: 1, height: 2 })).toThrow(/inside 100x310/);
    expect(() => cropRgb565Frame(frame, { x: -1, y: 0, width: 2, height: 1 })).toThrow(/inside 100x310/);
    expect(() => cropRgb565Frame(frame, { x: 0.5, y: 0, width: 2, height: 1 })).toThrow(/integer rect/);
    expect(() => cropRgb565Frame(frame, { x: 0, y: 0, width: 0, height: 1 })).toThrow(/inside 100x310/);
  });

  it("rejects a wrong-sized source frame", () => {
    expect(() => cropRgb565Frame(new Uint16Array(100), { x: 0, y: 0, width: 1, height: 1 }))
      .toThrow(/31000 RGB565 pixels/);
  });
});

describe("alignRectToDevicePixels", () => {
  it("expands fractional CSS boxes outward to integer pixel bounds", () => {
    // floor the origin, ceil the far edge — 10.4..14.6 must become 10..15.
    expect(alignRectToDevicePixels({ x: 10.4, y: 20.7, width: 4.2, height: 3.1 }))
      .toEqual({ x: 10, y: 20, width: 5, height: 4 });
    // Already-integer rects pass through untouched.
    expect(alignRectToDevicePixels({ x: 8, y: 13, width: 84, height: 10 }))
      .toEqual({ x: 8, y: 13, width: 84, height: 10 });
  });

  it("clamps to the canvas without collapsing", () => {
    expect(alignRectToDevicePixels({ x: -3.2, y: -1, width: 5, height: 4 }))
      .toEqual({ x: 0, y: 0, width: 2, height: 3 });
    expect(alignRectToDevicePixels({ x: 98.5, y: 308.5, width: 9, height: 9 }))
      .toEqual({ x: 98, y: 308, width: 2, height: 2 });
    // Degenerate boxes still produce a 1-pixel rect the crop can take.
    expect(alignRectToDevicePixels({ x: 50, y: 60, width: 0, height: 0 }))
      .toEqual({ x: 50, y: 60, width: 1, height: 1 });
  });

  it("always yields a rect cropRgb565Frame accepts", () => {
    const frame = quadrantFrame();
    for (const rect of [
      { x: -10, y: -10, width: 3, height: 3 },
      { x: 99.9, y: 309.9, width: 50, height: 50 },
      { x: 42.2, y: 130.8, width: 45.5, height: 8.9 },
    ]) {
      const aligned = alignRectToDevicePixels(rect);
      expect(() => cropRgb565Frame(frame, aligned)).not.toThrow();
    }
  });
});
