// captureBaseFrame must produce the EXACT device byte layout: 100×310 RGB565,
// row-major with width-100 rows, 2 bytes per pixel little-endian, converted
// with the same rounding the F2EP capture path uses (rgbaToRgb565). These
// tests paint known solid-colour rects into a synthetic ImageData and assert
// the exact bytes at computed row-major indices.

import { describe, expect, it } from "vitest";

import { BASE_FRAME_BYTES, captureBaseFrame, rgb565FrameToBytes } from "../src/compiler/frameCapture";
import { DEVICE_HEIGHT, DEVICE_PIXELS, DEVICE_WIDTH, rgbTo565 } from "../src/compiler/renderV2Package";

/** Node has no ImageData constructor; a plain {width,height,data} is the shape. */
function makeImage(): { image: ImageData; set: (x: number, y: number, rgba: number[]) => void } {
  const data = new Uint8ClampedArray(DEVICE_PIXELS * 4);
  const set = (x: number, y: number, rgba: number[]) => {
    const at = (y * DEVICE_WIDTH + x) * 4;
    data.set(rgba, at);
  };
  return { image: { width: DEVICE_WIDTH, height: DEVICE_HEIGHT, data } as unknown as ImageData, set };
}

const fillRect = (
  set: (x: number, y: number, rgba: number[]) => void,
  x0: number, y0: number, w: number, h: number, rgba: number[],
) => {
  for (let y = y0; y < y0 + h; y += 1) for (let x = x0; x < x0 + w; x += 1) set(x, y, rgba);
};

/** The two little-endian bytes of one pixel in the captured frame. */
const pixelBytes = (bytes: Uint8Array, x: number, y: number): [number, number] => {
  const at = (y * DEVICE_WIDTH + x) * 2;
  return [bytes[at], bytes[at + 1]];
};

const le = (rgb565: number): [number, number] => [rgb565 & 0xff, rgb565 >>> 8];

describe("captureBaseFrame", () => {
  it("packs known solid rects at exact row-major little-endian offsets", () => {
    const { image, set } = makeImage();
    const RED = [255, 0, 0, 255];       // 0xf800
    const GREEN = [0, 255, 0, 255];     // 0x07e0
    const BLUE = [0, 0, 255, 255];      // 0x001f
    const WHITE = [255, 255, 255, 255]; // 0xffff
    const TEAL = [0, 132, 132, 255];    // exercises all three channels

    // Quadrants pin row-major/width-100 indexing: a column-major or wrong-width
    // layout would land at least one corner in the wrong quadrant.
    fillRect(set, 0, 0, 50, 155, RED);
    fillRect(set, 50, 0, 50, 155, GREEN);
    fillRect(set, 0, 155, 50, 155, BLUE);
    fillRect(set, 50, 155, 50, 155, WHITE);
    fillRect(set, 40, 150, 20, 10, TEAL); // centre patch

    const bytes = captureBaseFrame(image);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(BASE_FRAME_BYTES);
    expect(bytes.length).toBe(62_000);

    // All four corners + centre, byte-exact.
    expect(pixelBytes(bytes, 0, 0)).toEqual(le(0xf800));
    expect(pixelBytes(bytes, 99, 0)).toEqual(le(0x07e0));
    expect(pixelBytes(bytes, 0, 309)).toEqual(le(0x001f));
    expect(pixelBytes(bytes, 99, 309)).toEqual(le(0xffff));
    expect(pixelBytes(bytes, 50, 155)).toEqual(le(rgbTo565(0, 132, 132)));

    // The very last pixel ends the buffer (offset 61,998..61,999).
    expect(bytes[61_998]).toBe(0xff);
    expect(bytes[61_999]).toBe(0xff);

    // Little-endian means the low byte comes FIRST: for pure red 0xf800 the
    // first byte of the pixel is 0x00 and the second 0xf8.
    expect(bytes[0]).toBe(0x00);
    expect(bytes[1]).toBe(0xf8);

    // Quadrant seams prove width-100 rows: (49,0) red, (50,0) green;
    // (0,154) red, (0,155) blue.
    expect(pixelBytes(bytes, 49, 0)).toEqual(le(0xf800));
    expect(pixelBytes(bytes, 50, 0)).toEqual(le(0x07e0));
    expect(pixelBytes(bytes, 0, 154)).toEqual(le(0xf800));
    expect(pixelBytes(bytes, 0, 155)).toEqual(le(0x001f));
  });

  it("composites alpha over black with the F2EP capture's rounding", () => {
    const { image, set } = makeImage();
    // rgbaToRgb565: channel * (alpha/255), Math.round, then 565-truncate.
    // 255 * 128/255 = 128 → round 128 → red 0x80 → (0x80 & 0xf8) << 8 = 0x8000.
    set(3, 7, [255, 0, 0, 128]);
    const bytes = captureBaseFrame(image);
    expect(pixelBytes(bytes, 3, 7)).toEqual(le(0x8000));
    // Untouched pixels are transparent black → 0x0000.
    expect(pixelBytes(bytes, 4, 7)).toEqual(le(0x0000));
  });

  it("reads a canvas-like context through getImageData", () => {
    const { image, set } = makeImage();
    set(0, 0, [255, 255, 255, 255]);
    const calls: number[][] = [];
    const ctx = {
      getImageData: (x: number, y: number, w: number, h: number) => {
        calls.push([x, y, w, h]);
        return image;
      },
    } as unknown as CanvasRenderingContext2D;
    const bytes = captureBaseFrame(ctx);
    expect(calls).toEqual([[0, 0, DEVICE_WIDTH, DEVICE_HEIGHT]]);
    expect(pixelBytes(bytes, 0, 0)).toEqual(le(0xffff));
  });

  it("rejects wrong-sized images", () => {
    const bad = {
      width: 100, height: 100, data: new Uint8ClampedArray(100 * 100 * 4),
    } as unknown as ImageData;
    expect(() => captureBaseFrame(bad)).toThrow(/100x310/);
  });

  it("rejects wrong-sized RGB565 frames", () => {
    expect(() => rgb565FrameToBytes(new Uint16Array(100))).toThrow(/31000/);
  });

  it("serializes an RGB565 frame little-endian", () => {
    const frame = new Uint16Array(DEVICE_PIXELS);
    frame[0] = 0x1234;
    frame[DEVICE_PIXELS - 1] = 0xabcd;
    const bytes = rgb565FrameToBytes(frame);
    expect([bytes[0], bytes[1]]).toEqual([0x34, 0x12]);
    expect([bytes[61_998], bytes[61_999]]).toEqual([0xcd, 0xab]);
  });
});
