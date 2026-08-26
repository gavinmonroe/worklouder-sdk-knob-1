// Golden round-trip: the browser port must reproduce, byte for byte, the F1RA
// and F1WB binaries inside a package the generic firmware has already accepted
// (f1-widget-sdk/build/combined-renderer-v2-generic-input-lab/
//  generic-generation-1.package.bin — F1WB[0..62404] || F2EP[62404..]).
//
// If this passes, the encoder emits exactly what the device's basic_f1wb gate
// and renderer_v2_native_prepare already admit.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  buildRenderV2RasterPackage,
  encodeRasterAnimation,
  encodeWidgetBundle,
  rgbaToRgb565,
  sha256Hex,
  DEVICE_PIXELS,
  MAX_BUNDLE_BYTES,
} from "../src/compiler/renderV2Package";

const here = path.dirname(fileURLToPath(import.meta.url));
const REFERENCE = path.resolve(
  here,
  "../../../f1-widget-sdk/build/combined-renderer-v2-generic-input-lab/generic-generation-1.package.bin",
);

const F1WB_BYTES = 62_404;
const F1RA_OFFSET = 332;
const F1RA_BYTES = 62_072;
const F1RA_HEADER = 64;
const F1RA_RECORD = 8;

function reference(): Uint8Array {
  return new Uint8Array(readFileSync(REFERENCE));
}

/** Pull the single full RGB565 frame out of the reference F1RA payload. */
function referenceFrame(f1ra: Uint8Array): Uint16Array {
  const view = new DataView(f1ra.buffer, f1ra.byteOffset, f1ra.byteLength);
  expect(f1ra[F1RA_HEADER]).toBe(0); // FRAME_FULL
  const payloadLength = view.getUint32(F1RA_HEADER + 4, true);
  expect(payloadLength).toBe(DEVICE_PIXELS * 2);
  const frame = new Uint16Array(DEVICE_PIXELS);
  for (let i = 0; i < DEVICE_PIXELS; i += 1) {
    frame[i] = view.getUint16(F1RA_HEADER + F1RA_RECORD + i * 2, true);
  }
  return frame;
}

describe("render-v2 raster package (browser port)", () => {
  const pkg = reference();
  const goldenF1wb = pkg.subarray(0, F1WB_BYTES);
  const goldenF1ra = pkg.subarray(F1RA_OFFSET, F1RA_OFFSET + F1RA_BYTES);
  const frame = referenceFrame(goldenF1ra);

  it("re-encodes the reference F1RA byte-for-byte", async () => {
    // The reference is 1 frame at a 1000ms cadence → 1 fps.
    const encoded = await encodeRasterAnimation({ frames: [frame], fps: 1 });
    expect(encoded.length).toBe(F1RA_BYTES);
    expect(Buffer.from(encoded).equals(Buffer.from(goldenF1ra))).toBe(true);
  });

  it("re-encodes the reference F1WB byte-for-byte", async () => {
    const animation = await encodeRasterAnimation({ frames: [frame], fps: 1 });
    const bundle = await encodeWidgetBundle({
      slots: [{ name: "focus-dial", animationBinary: animation }],
      activeSlot: 0,
      generation: 1,
    });
    expect(bundle.length).toBe(F1WB_BYTES);
    expect(Buffer.from(bundle).equals(Buffer.from(goldenF1wb))).toBe(true);
  });

  it("produces a standalone package the device gate accepts", async () => {
    const built = await buildRenderV2RasterPackage({
      frames: [frame],
      name: "focus-dial",
      generation: 1,
      fps: 1,
    });
    // basic_f1wb: u32@12 == bundle_bytes == total_bytes when standalone.
    const view = new DataView(built.binary.buffer);
    expect(view.getUint32(12, true)).toBe(built.binary.length);
    expect(view.getUint32(8, true)).toBe(1); // generation
    expect(view.getUint16(16, true)).toBe(104); // descriptor bytes
    expect(view.getUint16(18, true)).toBe(332); // payload offset
    expect(built.binary[5]).toBe(3); // capacity
    expect(built.binary[6]).toBe(1); // slot count
    expect(built.binary[7]).toBe(0); // activeSlot < count
    expect(built.bytes).toBeLessThanOrEqual(MAX_BUNDLE_BYTES);
    expect(built.sha256).toBe(await sha256Hex(goldenF1wb));
  });

  it("delta-encodes a second frame instead of storing it whole", async () => {
    const second = Uint16Array.from(frame);
    // Perturb one 10x10 tile so only a small delta is needed.
    for (let y = 0; y < 10; y += 1) {
      for (let x = 0; x < 10; x += 1) second[y * 100 + x] ^= 0x1f;
    }
    const encoded = await encodeRasterAnimation({ frames: [frame, second], fps: 1 });
    // A full second frame would add 62,008 bytes; a delta must be far smaller.
    expect(encoded.length).toBeLessThan(F1RA_BYTES + 5_000);
    expect(encoded[F1RA_HEADER]).toBe(0); // first frame stays full
  });

  it("rejects a package past the device bundle ceiling", async () => {
    // 60 uncorrelated frames cannot fit in 98,304 bytes.
    const frames = Array.from({ length: 60 }, (_, index) => {
      const noisy = new Uint16Array(DEVICE_PIXELS);
      for (let i = 0; i < DEVICE_PIXELS; i += 1) noisy[i] = (i * 2654435761 + index * 40503) & 0xffff;
      return noisy;
    });
    await expect(
      buildRenderV2RasterPackage({ frames, name: "noise", generation: 1, fps: 10 }),
    ).rejects.toThrow(/bundle ceiling|chunk cap/);
  });

  it("converts RGBA to RGB565 over a black backdrop", () => {
    const rgba = new Uint8ClampedArray(DEVICE_PIXELS * 4);
    rgba[0] = 255; rgba[1] = 255; rgba[2] = 255; rgba[3] = 255; // opaque white
    rgba[4] = 255; rgba[5] = 0; rgba[6] = 0; rgba[7] = 0;       // transparent red
    const frame = rgbaToRgb565(rgba);
    expect(frame[0]).toBe(0xffff);
    expect(frame[1]).toBe(0x0000);
  });
});
