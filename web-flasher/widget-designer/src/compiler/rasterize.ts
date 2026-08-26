// ─────────────────────────────────────────────────────────────────────────────
// Paint a compiled ViewportFrame onto the F1's 100x310 canvas and read it back
// as RGB565 pixels for an F1RA raster slot.
//
// This uses the deterministic `boxes` model from cssScene.compileWidget rather
// than rasterizing the preview iframe. Reading pixels out of the iframe would
// mean serializing its DOM through an <svg><foreignObject> round-trip, which
// silently drops anything the serializer cannot resolve and taints the canvas
// on any external font. The box model is what the F1SC subset actually
// describes, so painting it here is both reproducible and honest about what
// the device can show.
// ─────────────────────────────────────────────────────────────────────────────

import type { BoxNode, ViewportFrame } from "./cssScene";
import { DEVICE_HEIGHT, DEVICE_WIDTH, rgbaToRgb565 } from "./renderV2Package";

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** A 100x310 2D context, preferring OffscreenCanvas when the browser has it. */
function createDeviceContext(): { ctx: Ctx2D; read: () => ImageData } {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(DEVICE_WIDTH, DEVICE_HEIGHT);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Could not acquire a 2D context for rasterization.");
    return { ctx, read: () => ctx.getImageData(0, 0, DEVICE_WIDTH, DEVICE_HEIGHT) };
  }
  if (typeof document === "undefined") {
    throw new Error("Rasterization needs a browser canvas; none is available in this environment.");
  }
  const canvas = document.createElement("canvas");
  canvas.width = DEVICE_WIDTH;
  canvas.height = DEVICE_HEIGHT;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Could not acquire a 2D context for rasterization.");
  return { ctx, read: () => ctx.getImageData(0, 0, DEVICE_WIDTH, DEVICE_HEIGHT) };
}

function roundedRectPath(ctx: Ctx2D, x: number, y: number, w: number, h: number, radius: number): void {
  const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2));
  ctx.beginPath();
  if (r === 0) {
    ctx.rect(x, y, w, h);
  } else {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}

function paintBox(ctx: Ctx2D, box: BoxNode): void {
  if (!box.visible) return;

  if (box.bg) {
    ctx.fillStyle = box.bg;
    roundedRectPath(ctx, box.x, box.y, box.w, box.h, box.borderRadius);
    ctx.fill();
  }

  if (box.borderColor && box.borderWidth > 0) {
    ctx.strokeStyle = box.borderColor;
    ctx.lineWidth = box.borderWidth;
    // Inset by half the stroke so the border stays inside the box bounds.
    const inset = box.borderWidth / 2;
    roundedRectPath(
      ctx,
      box.x + inset,
      box.y + inset,
      Math.max(0, box.w - box.borderWidth),
      Math.max(0, box.h - box.borderWidth),
      Math.max(0, box.borderRadius - inset),
    );
    ctx.stroke();
  }

  if (!box.text) return;

  ctx.save();
  // Clip to the box so overflowing text cannot bleed across the panel.
  roundedRectPath(ctx, box.x, box.y, box.w, box.h, box.borderRadius);
  ctx.clip();
  ctx.fillStyle = box.fg;
  ctx.font = `${box.weight} ${box.fontSize}px ${box.fontFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (box.shadow) {
    ctx.shadowColor = box.shadow;
    ctx.shadowBlur = 4;
  }
  ctx.fillText(box.text, box.x + box.w / 2, box.y + box.h / 2);
  ctx.restore();
}

/**
 * Paint one compiled frame and return its RGB565 pixels.
 *
 * Boxes are painted in `frame.boxes` order, which cssScene emits as a flat
 * DOM tree — so later siblings land on top, matching the preview.
 */
export function rasterizeFrame(frame: ViewportFrame): Uint16Array {
  const { ctx, read } = createDeviceContext();

  ctx.fillStyle = frame.backgroundCss || "#000000";
  ctx.fillRect(0, 0, DEVICE_WIDTH, DEVICE_HEIGHT);
  for (const box of frame.boxes) paintBox(ctx, box);

  return rgbaToRgb565(read().data);
}

/** Rasterize a sequence of frames for an animated raster slot. */
export function rasterizeFrames(frames: ViewportFrame[]): Uint16Array[] {
  return frames.map((frame) => rasterizeFrame(frame));
}
