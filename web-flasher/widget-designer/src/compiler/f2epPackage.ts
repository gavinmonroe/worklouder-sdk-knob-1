// ─────────────────────────────────────────────────────────────────────────────
// Event-driven packages: F1WB (pixels) + F2EP (event program).
//
// The raster path ships captured FRAMES, so the device replays a loop and
// nothing responds to input. This path ships a PROGRAM: the F2EP interpreter
// computes state from real device events, and each logical binding selects one
// of its pre-rendered pixel variants. Turning the knob changes pixels
// immediately, with no frame loop and no rasterizer on the device.
//
// The Designer does NOT reimplement any of that. It imports the SDK's own
// compiler (`f1-widget-sdk/src/render-v2/compiler.mjs`) — the same code that
// produces packages the firmware has already accepted — and supplies the one
// thing only a browser can: real rendered pixels for every variant.
//
// Two small shims make those Node-targeted modules load in a browser:
// `compat/node-crypto.ts` (synchronous SHA-256) and `compat/buffer.ts`.
// ─────────────────────────────────────────────────────────────────────────────

// MUST precede the SDK imports: those modules touch Buffer at their own top
// level, and ES imports evaluate in source order.
import "../compat/install";

import { prepareRenderV2, linkRenderV2Raster } from "@sdk/render-v2/compiler.mjs";
import { createReadableDemoGlyphAtlas } from "@sdk-examples/render-v2-events/readable-atlas.mjs";

import {
  buildRenderV2RasterPackage,
  sha256Hex,
  DEVICE_HEIGHT,
  DEVICE_WIDTH,
  type RenderV2Package,
} from "./renderV2Package";
import { setPreviewText, snapshotIframe, waitForPreview } from "./snapshot";
import type { WidgetAssetMap } from "./widgetAssets";

export interface Span {
  pixelOffset: number;
  colors: Uint16Array;
}

export interface BindingPatch {
  originPixel: number;
  variants: Span[][];
}

export interface F2epBuildResult {
  /** F2EP program bytes, appended after the F1WB bundle. */
  program: Uint8Array;
  /** The RGB565-LE base framebuffer the program patches. */
  baseFrame: Uint16Array;
  bindings: { name: string; targetId: string; variants: number }[];
  programBytes: number;
}

interface Rect { x: number; y: number; width: number; height: number }

/**
 * Where a binding actually paints, measured from rendered pixels.
 *
 * NOT from the prepared scene's cell grid. That grid is the F1SC model's own
 * layout (cell 0 at y=5, 20px cells); the browser places the same content
 * wherever the author's CSS puts it — for the events preset, ~130px lower. Using
 * scene coordinates captured pure background, so every variant of every binding
 * was byte-identical and the device rendered a frozen widget while faithfully
 * running the program.
 *
 * Diffing each variant against the base needs no geometry model at all, so the
 * two layouts can never drift apart again.
 */
function unionChangedRect(base: Uint16Array, frames: Uint16Array[]): Rect | null {
  let minX = DEVICE_WIDTH, minY = DEVICE_HEIGHT, maxX = -1, maxY = -1;
  for (const frame of frames) {
    for (let y = 0; y < DEVICE_HEIGHT; y += 1) {
      const row = y * DEVICE_WIDTH;
      for (let x = 0; x < DEVICE_WIDTH; x += 1) {
        if (frame[row + x] !== base[row + x]) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * Rows, and the column range within them, that ANY variant changes.
 *
 * A glyph occupies only part of its rect, so most rows never change and need no
 * patch at all. The range must be the union across every variant, not per
 * variant: the device paints one variant over another, not over the base, so a
 * row some other variant lit has to be repainted even when this variant leaves
 * it blank — otherwise the previous glyph ghosts through.
 */
function changedRowRanges(
  base: Uint16Array,
  frames: Uint16Array[],
  rect: Rect,
): { row: number; start: number; length: number }[] {
  const ranges: { row: number; start: number; length: number }[] = [];
  for (let row = 0; row < rect.height; row += 1) {
    const y = rect.y + row;
    let first = -1;
    let last = -1;
    for (let col = 0; col < rect.width; col += 1) {
      const index = y * DEVICE_WIDTH + rect.x + col;
      let changed = false;
      for (const frame of frames) {
        if (frame[index] !== base[index]) { changed = true; break; }
      }
      if (changed) {
        if (first < 0) first = col;
        last = col;
      }
    }
    if (first >= 0) ranges.push({ row, start: first, length: last - first + 1 });
  }
  return ranges;
}

/** Spans for one variant, covering only the rows/columns that ever change. */
function spansForRanges(
  frame: Uint16Array,
  rect: Rect,
  ranges: { row: number; start: number; length: number }[],
): Span[] {
  return ranges.map(({ row, start, length }) => {
    const from = (rect.y + row) * DEVICE_WIDTH + rect.x + start;
    return {
      pixelOffset: row * DEVICE_WIDTH + start,
      colors: frame.slice(from, from + length),
    };
  });
}

/**
 * `clock_3` means glyph position 3 of the run on element `#clock`; a binding
 * with no suffix covers the whole (single-glyph) run.
 */
function glyphPosition(bindingName: string, targetId: string): number {
  if (bindingName === targetId) return 0;
  const suffix = bindingName.slice(targetId.length + 1);
  const index = Number.parseInt(suffix, 10);
  return Number.isInteger(index) ? index : 0;
}

/**
 * Capture every variant of every binding by rendering it in the live preview.
 *
 * This is what makes the result WYSIWYG: the pixels are the browser's own
 * rendering of the author's CSS, not a reconstruction.
 */
export async function captureBindingPatches(
  iframe: HTMLIFrameElement,
  css: string,
  prepared: any,
  assets: WidgetAssetMap = {},
): Promise<{ patches: Record<string, BindingPatch>; baseFrame: Uint16Array; empty: string[] }> {
  const runs: { id: string | null; initial: string[] }[] = prepared.runs ?? [];
  const runFor = (targetId: string) => runs.find((run) => run.id === targetId);

  for (const run of runs) {
    if (typeof run.id === "string" && run.id) await setPreviewText(iframe, run.id, run.initial.join(""));
  }
  const baseFrame = await snapshotIframe(iframe, css, assets);

  // Pass 1: render every variant and find where each binding actually changes.
  const measured: { name: string; rect: Rect; frames: Uint16Array[] }[] = [];
  const empty: string[] = [];

  for (const binding of prepared.logicalBindings ?? []) {
    const run = runFor(binding.targetId);
    if (!run) throw new Error(`Binding ${binding.name} has no text run for #${binding.targetId}.`);
    const position = glyphPosition(binding.name, binding.targetId);

    const frames: Uint16Array[] = [];
    for (const variant of binding.variants) {
      const glyphs = run.initial.slice();
      glyphs[position] = variant.glyphs.join("");
      await setPreviewText(iframe, binding.targetId, glyphs.join(""));
      frames.push(await snapshotIframe(iframe, css, assets));
    }
    await setPreviewText(iframe, binding.targetId, run.initial.join(""));

    const rect = unionChangedRect(baseFrame, frames);
    if (!rect) { empty.push(binding.name); continue; }
    measured.push({ name: binding.name, rect, frames });
  }

  // Keep each binding's rect as tight as its own change region.
  //
  // Padding them all to a common size was tried, to make identical glyphs dedupe
  // into one patch set. It does not work here and makes things worse: the clock
  // digits sit ~6-7px apart while a padded rect is ~10px wide, so rects overlap
  // and each capture swallows part of its neighbours. That both defeats the
  // dedupe and risks digits overwriting each other on device.
  const patches: Record<string, BindingPatch> = {};
  for (const { name, rect, frames } of measured) {
    const ranges = changedRowRanges(baseFrame, frames, rect);
    patches[name] = {
      originPixel: rect.y * DEVICE_WIDTH + rect.x,
      variants: frames.map((frame) => spansForRanges(frame, rect, ranges)),
    };
  }

  return { patches, baseFrame, empty };
}

function frameToBuffer(frame: Uint16Array): Uint8Array {
  const bytes = new Uint8Array(frame.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < frame.length; i += 1) view.setUint16(i * 2, frame[i], true);
  return bytes;
}

/**
 * Compile a widget to an event-driven program plus its pixel variants.
 *
 * Throws with the SDK's own message when the widget is outside the F1SC subset
 * the program model requires — the caller surfaces that rather than silently
 * falling back to frames, because the two behave very differently on device.
 */
export async function buildEventProgram({
  iframe, html, css, script, rootClass, assets = {},
}: {
  iframe: HTMLIFrameElement;
  html: string;
  css: string;
  script: string;
  rootClass: string;
  assets?: WidgetAssetMap;
}): Promise<F2epBuildResult> {
  await waitForPreview(iframe, rootClass);

  const prepared = prepareRenderV2({ html, css, script, rootClass });
  const bindings = prepared.logicalBindings ?? [];
  if (bindings.length === 0) {
    throw new Error(
      "This widget declares no event-driven bindings: nothing in its script writes a " +
        "glyph target, so there is no state for the device to react to.",
    );
  }

  const { patches, baseFrame, empty } = await captureBindingPatches(iframe, css, prepared, assets);
  if (empty.length > 0) {
    throw new Error(
      `No rendered pixels change for ${empty.join(", ")}. The device would run the ` +
        "program and show a frozen widget, so this is refused rather than pushed.",
    );
  }
  const atlas = createReadableDemoGlyphAtlas(prepared.scene.glyphs);
  // The SDK's index.d.ts omits `atlas` from this options type, but the
  // implementation requires it — linking without one fails at runtime with
  // "atlas must match the prepared F1SC glyph universe". Cast rather than drop
  // the argument.
  const linked = (linkRenderV2Raster as any)(prepared, {
    atlas,
    baseFrame: frameToBuffer(baseFrame),
    bindingPatches: patches,
  });

  const program: Uint8Array = linked.program?.binary ?? linked.program;
  if (!(program instanceof Uint8Array)) {
    throw new Error("The SDK linker returned no F2EP program binary.");
  }

  return {
    program,
    baseFrame,
    programBytes: program.length,
    bindings: bindings.map((b: any) => ({
      name: b.name, targetId: b.targetId, variants: b.variants.length,
    })),
  };
}

export const DEVICE_PIXEL_COUNT = DEVICE_WIDTH * DEVICE_HEIGHT;

/**
 * Package an event program for the device: F1WB bundle followed contiguously by
 * the F2EP program.
 *
 * The generic firmware distinguishes the two envelopes by size alone — it takes
 * the standalone path when `total_bytes === bundle_bytes`, and reads an F2EP
 * tail otherwise. So the F1WB header keeps declaring its own bundle length
 * (u32@12) while `begin` declares the combined length, which is what
 * createSceneUpload sends.
 */
export async function buildEventDrivenPackage({
  iframe, html, css, script, rootClass, name, generation = 1, assets = {},
}: {
  iframe: HTMLIFrameElement;
  html: string;
  css: string;
  script: string;
  rootClass: string;
  name: string;
  generation?: number;
  assets?: WidgetAssetMap;
}): Promise<RenderV2Package & { programBytes: number; bindings: F2epBuildResult["bindings"] }> {
  const built = await buildEventProgram({ iframe, html, css, script, rootClass, assets });

  // One frame: the program patches this base rather than replaying frames.
  const bundle = await buildRenderV2RasterPackage({
    frames: [built.baseFrame], name, generation, fps: 1,
  });

  const binary = new Uint8Array(bundle.binary.length + built.program.length);
  binary.set(bundle.binary, 0);
  binary.set(built.program, bundle.binary.length);

  return {
    binary,
    sha256: await sha256Hex(binary),
    generation,
    bytes: binary.length,
    frameCount: 1,
    programBytes: built.programBytes,
    bindings: built.bindings,
  };
}
