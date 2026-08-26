// ─────────────────────────────────────────────────────────────────────────────
// Base-frame capture for the mquickjs widget pipeline.
//
// The F2UP container ships the widget's WYSIWYG base as raw device pixels:
// exactly 62,000 bytes of RGB565 — width 100, height 310, row-major, 2 bytes
// per pixel little-endian — which the device stores LZSS-compressed and
// repaints under the target facade.
//
// This module does NOT own a second RGB conversion. The RGB888→RGB565 rounding
// is `rgbaToRgb565` from renderV2Package.ts — the exact converter the existing
// F2EP capture path uses (snapshot.ts:snapshotIframe feeds it the preview's
// getImageData), so a base frame captured here is pixel-identical to what the
// F2EP path would have shipped for the same canvas.
// ─────────────────────────────────────────────────────────────────────────────

import { DEVICE_HEIGHT, DEVICE_PIXELS, DEVICE_WIDTH, rgbaToRgb565 } from "./renderV2Package";

/** 100 × 310 pixels × 2 bytes: the exact size the device admits. */
export const BASE_FRAME_BYTES = DEVICE_PIXELS * 2;

/**
 * Serialize an RGB565 frame (as the capture/snapshot helpers produce) into the
 * device byte layout: row-major, 2 bytes per pixel little-endian.
 */
export function rgb565FrameToBytes(frame: Uint16Array): Uint8Array {
  if (!(frame instanceof Uint16Array) || frame.length !== DEVICE_PIXELS) {
    throw new Error(
      `Base frame must be ${DEVICE_PIXELS} RGB565 pixels (${DEVICE_WIDTH}x${DEVICE_HEIGHT}); ` +
        `got ${frame instanceof Uint16Array ? frame.length : typeof frame}.`,
    );
  }
  const bytes = new Uint8Array(BASE_FRAME_BYTES);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < frame.length; index += 1) {
    view.setUint16(index * 2, frame[index], true);
  }
  return bytes;
}

export interface DeviceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Crop one target rect out of a full 100×310 RGB565 frame, row-major — the
 * variantRaster capture's cut. The rect must already be integer-aligned and
 * inside the canvas (alignRectToDevicePixels produces exactly that); a rect
 * that escapes is a caller bug and throws rather than silently clamping into
 * a raster whose geometry no longer matches its record.
 */
export function cropRgb565Frame(frame: Uint16Array, rect: DeviceRect): Uint16Array {
  if (!(frame instanceof Uint16Array) || frame.length !== DEVICE_PIXELS) {
    throw new Error(
      `Crop source must be ${DEVICE_PIXELS} RGB565 pixels (${DEVICE_WIDTH}x${DEVICE_HEIGHT}); ` +
        `got ${frame instanceof Uint16Array ? frame.length : typeof frame}.`,
    );
  }
  const { x, y, width, height } = rect;
  if (![x, y, width, height].every(Number.isInteger) || width < 1 || height < 1 ||
      x < 0 || y < 0 || x + width > DEVICE_WIDTH || y + height > DEVICE_HEIGHT) {
    throw new Error(
      `Crop rect must be an integer rect inside ${DEVICE_WIDTH}x${DEVICE_HEIGHT}; ` +
        `got x=${x} y=${y} width=${width} height=${height}.`,
    );
  }
  const cropped = new Uint16Array(width * height);
  for (let row = 0; row < height; row += 1) {
    const from = (y + row) * DEVICE_WIDTH + x;
    cropped.set(frame.subarray(from, from + width), row * width);
  }
  return cropped;
}

/**
 * Expand a measured CSS rect to integer pixel bounds (floor the origin, ceil
 * the far edge) and clamp it to the device canvas. Fractional CSS boxes must
 * grow, never shrink: a truncated rect would clip antialiased edge pixels out
 * of every raster variant.
 */
export function alignRectToDevicePixels(rect: {
  x: number; y: number; width: number; height: number;
}): DeviceRect {
  const left = Math.max(0, Math.min(Math.floor(rect.x), DEVICE_WIDTH - 1));
  const top = Math.max(0, Math.min(Math.floor(rect.y), DEVICE_HEIGHT - 1));
  const right = Math.min(DEVICE_WIDTH, Math.max(Math.ceil(rect.x + rect.width), left + 1));
  const bottom = Math.min(DEVICE_HEIGHT, Math.max(Math.ceil(rect.y + rect.height), top + 1));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export type BaseFrameSource =
  | CanvasRenderingContext2D
  | OffscreenCanvasRenderingContext2D
  | ImageData;

/**
 * Capture a 62,000-byte RGB565 base frame from a 100×310 canvas context or an
 * already-read ImageData, in exactly the device layout described above.
 *
 * Alpha is composited over black with the same rounding the F2EP capture uses
 * (rgbaToRgb565), because the device framebuffer is opaque.
 */
export function captureBaseFrame(source: BaseFrameSource): Uint8Array {
  const image: ImageData =
    typeof (source as CanvasRenderingContext2D).getImageData === "function"
      ? (source as CanvasRenderingContext2D).getImageData(0, 0, DEVICE_WIDTH, DEVICE_HEIGHT)
      : (source as ImageData);
  if (image.width !== DEVICE_WIDTH || image.height !== DEVICE_HEIGHT) {
    throw new Error(
      `Base frame capture needs a ${DEVICE_WIDTH}x${DEVICE_HEIGHT} image; ` +
        `got ${image.width}x${image.height}.`,
    );
  }
  return rgb565FrameToBytes(rgbaToRgb565(image.data));
}
