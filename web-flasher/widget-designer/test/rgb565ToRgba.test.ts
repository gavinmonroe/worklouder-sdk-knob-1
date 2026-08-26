import { describe, expect, it } from "vitest";

import { rgb565FrameToRgba } from "../src/compiler/rgb565ToRgba";
import { rgbTo565 } from "../src/compiler/renderV2Package";

describe("rgb565FrameToRgba", () => {
  it("returns 4 bytes per pixel with opaque alpha", () => {
    const rgba = rgb565FrameToRgba(new Uint16Array(3));
    expect(rgba).toHaveLength(12);
    expect(rgba[3]).toBe(255);
    expect(rgba[7]).toBe(255);
    expect(rgba[11]).toBe(255);
  });

  it("maps pure black and pure white to their 8-bit extremes", () => {
    const black = rgbTo565(0, 0, 0); // 0x0000
    const white = rgbTo565(255, 255, 255); // 0xffff
    const rgba = rgb565FrameToRgba(Uint16Array.of(black, white));
    expect([rgba[0], rgba[1], rgba[2]]).toEqual([0, 0, 0]);
    expect([rgba[4], rgba[5], rgba[6]]).toEqual([255, 255, 255]);
  });

  it("recovers the 8-bit channels a 565 round-trip preserves (bit replication)", () => {
    // Values chosen so the 565 quantization is lossless: r/b multiples that
    // survive >>3<<3|>>2, g a multiple that survives >>2<<2|>>4.
    const r = 0x08 | (0x08 >> 2); // r5=1 -> (1<<3)|(1>>2)=8
    const px = rgbTo565(8, 4, 8);
    const rgba = rgb565FrameToRgba(Uint16Array.of(px));
    // r5 = 8>>3 = 1 -> 8 ; g6 = 4>>2 = 1 -> (1<<2)|(1>>4) = 4 ; b5 = 8>>3 = 1 -> 8
    expect(rgba[0]).toBe(8);
    expect(rgba[1]).toBe(4);
    expect(rgba[2]).toBe(8);
    void r;
  });

  it("keeps pixels independent and in row-major order", () => {
    const a = rgbTo565(255, 0, 0);
    const b = rgbTo565(0, 255, 0);
    const c = rgbTo565(0, 0, 255);
    const rgba = rgb565FrameToRgba(Uint16Array.of(a, b, c));
    expect([rgba[0], rgba[1], rgba[2]]).toEqual([255, 0, 0]);
    expect([rgba[4], rgba[5], rgba[6]]).toEqual([0, 255, 0]);
    expect([rgba[8], rgba[9], rgba[10]]).toEqual([0, 0, 255]);
  });
});
