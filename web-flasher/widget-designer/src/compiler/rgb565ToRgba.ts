// ─────────────────────────────────────────────────────────────────────────────
// Unpack an RGB565 device frame into 8-bit RGBA bytes for a <canvas> ImageData.
//
// The device framebuffer stores each pixel as little-endian RGB565 packed
// `(r & 0xf8) << 8 | (g & 0xfc) << 3 | (b >> 3)` — the exact layout
// renderV2Package.rgbTo565 produces and the target-facade oracle renders into.
// Unpacking replicates the high bits into the low bits (r8 = r5<<3 | r5>>2, …)
// so a fully-on channel maps to 255, matching the panel's own 565→888 fill.
//
// Kept pure (returns bytes, never touches ImageData/document) so it runs and is
// unit-tested in the node test environment; the DeviceFrameView wraps the result
// in an ImageData at paint time.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert an RGB565 frame (one u16 per pixel, row-major) to RGBA8888 bytes
 * (4 per pixel, alpha 255). `pixels` must equal `frame.length`; the returned
 * array is `pixels * 4` bytes, ready for `new ImageData(bytes, width, height)`.
 */
export function rgb565FrameToRgba(frame: Uint16Array): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(frame.length * 4);
  for (let i = 0; i < frame.length; i += 1) {
    const px = frame[i];
    const r5 = (px >> 11) & 0x1f;
    const g6 = (px >> 5) & 0x3f;
    const b5 = px & 0x1f;
    const o = i * 4;
    rgba[o] = (r5 << 3) | (r5 >> 2);
    rgba[o + 1] = (g6 << 2) | (g6 >> 4);
    rgba[o + 2] = (b5 << 3) | (b5 >> 2);
    rgba[o + 3] = 255;
  }
  return rgba;
}
