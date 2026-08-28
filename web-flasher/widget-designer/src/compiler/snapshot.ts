// ─────────────────────────────────────────────────────────────────────────────
// Snapshot the live preview iframe to device pixels.
//
// Why this exists: cssScene.compileWidget() is called with the static source
// only — it never sees the simulator's slots or the DOM mutations the widget
// script makes. So `lastFrame` is frozen at the widget's initial state, and
// when the iframe runtime is driving (the normal case) it is never rebuilt at
// all. Rasterizing it would ship something the user never saw.
//
// The iframe, by contrast, IS the render: buildWidgetSrcdoc emits a
// self-contained 100x310 document with a black backdrop, the author's CSS, and
// the author's HTML mutated live by the script. Serializing that through an
// <svg><foreignObject> and drawing it to a canvas gives WYSIWYG pixels.
//
// Self-contained is what makes this safe: the srcdoc references no external
// stylesheet, font, or image, so the SVG data: URL cannot taint the canvas and
// getImageData() stays readable. Anything that would taint (an author pasting
// a remote <img>) fails the draw, and the caller falls back to the box model.
// ─────────────────────────────────────────────────────────────────────────────

import { DEVICE_HEIGHT, DEVICE_WIDTH, rgbaToRgb565 } from "./renderV2Package";
import { resolveWidgetAssetReferences, type WidgetAssetMap } from "./widgetAssets";
import type { PreviewMotionProbe } from "./spriteMotion";

/** The backdrop buildWidgetSrcdoc paints before any author CSS. */
const BASE_CSS = `html,body{margin:0;padding:0;width:${DEVICE_WIDTH}px;height:${DEVICE_HEIGHT}px;overflow:hidden;background:#000;}`;

function escapeCssForXml(css: string): string {
  // A <style> inside foreignObject is parsed as XML, so a stray "]]>" or a raw
  // "&"/"<" would break the document. CDATA plus a split guard keeps author CSS
  // verbatim without needing to understand it.
  return css.replace(/]]>/g, "]]]]><![CDATA[>");
}

/**
 * Build the SVG document that wraps one serialized widget body.
 *
 * `bodyXhtml` must already be XML-well-formed (XMLSerializer output). Kept pure
 * and separate from the canvas work so it can be tested without a browser.
 */
export function buildSnapshotSvg(bodyXhtml: string, css: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${DEVICE_WIDTH}" height="${DEVICE_HEIGHT}" ` +
    `viewBox="0 0 ${DEVICE_WIDTH} ${DEVICE_HEIGHT}">` +
    `<foreignObject x="0" y="0" width="${DEVICE_WIDTH}" height="${DEVICE_HEIGHT}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${DEVICE_WIDTH}px;height:${DEVICE_HEIGHT}px;overflow:hidden;">` +
    `<style><![CDATA[${escapeCssForXml(BASE_CSS + css)}]]></style>` +
    bodyXhtml +
    `</div></foreignObject></svg>`
  );
}

// ── Bridge to the sandboxed preview ──────────────────────────────────────────
//
// The iframe runs with allow-scripts but not allow-same-origin, so it is an
// opaque origin: contentDocument is null and contentWindow.__widgetRuntime is
// unreachable. postMessage is the only channel that crosses it. The matching
// listener lives in widgetRuntime.ts's WIDGET_SHIM.

let nextMessageId = 1;

function ask<T extends { type: string }>(
  iframe: HTMLIFrameElement,
  message: Record<string, unknown>,
  expect: string,
  timeoutMs = 4_000,
): Promise<T> {
  const target = iframe.contentWindow;
  if (!target) return Promise.reject(new Error("The preview iframe has no window."));
  const id = nextMessageId++;

  return new Promise<T>((resolve, reject) => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== "object" || data.id !== id) return;
      // Only trust replies from the frame we addressed.
      if (event.source !== target) return;
      cleanup();
      if (data.type === expect) resolve(data as T);
      else reject(new Error(data.error ? String(data.error) : `Preview replied ${data.type}.`));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("The preview did not respond; it may still be loading."));
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
    }
    window.addEventListener("message", onMessage);
    target.postMessage({ ...message, id }, "*");
  });
}

/**
 * Wait until the preview is showing the CURRENT widget.
 *
 * "Does the bridge answer" is not a readiness test: switching presets replaces
 * the iframe's srcdoc, and until the new document loads it is the OLD one that
 * replies — instantly, with stale markup. Capturing then yields the previous
 * widget, or a blank frame when the two disagree about which CSS applies.
 *
 * So readiness is defined by revision identity: buildWidgetSrcdoc stamps the
 * applied srcdoc and the frame's bridge reply with the same source-derived
 * token. An old document can still answer, but it cannot claim the new token.
 */
export async function waitForPreview(
  iframe: HTMLIFrameElement,
  timeoutMs = 5_000,
): Promise<void> {
  const tokenMatch = (iframe.srcdoc ?? "").match(
    /<meta name="widget-preview-token" content="([^"]+)" \/>/u,
  );
  const expectedToken = tokenMatch?.[1];
  if (!expectedToken) {
    throw new Error("The preview source has no revision token; wait for it to recompile and try again.");
  }

  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const reply = await ask<PreviewSnapshotReply>(
        iframe, { type: "widget:snapshot" }, "widget:snapshot:result", 500,
      );
      if ((reply.brokenImages?.length ?? 0) > 0) {
        throw new Error(`The preview could not decode image ${reply.brokenImages![0]}.`);
      }
      if (previewSnapshotMatches(reply, expectedToken) && reply.imagesReady !== false) return;
    } catch (cause) {
      lastError = cause;
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("The preview did not finish loading the current widget source.");
}

export interface PreviewSnapshotReply {
  type: string;
  body: string;
  previewToken?: string;
  imagesReady?: boolean;
  brokenImages?: string[];
}

/** Pure revision check kept separate so stale-frame admission is regression-testable. */
export function previewSnapshotMatches(
  reply: Pick<PreviewSnapshotReply, "previewToken">,
  expectedToken: string,
): boolean {
  return reply.previewToken === expectedToken;
}

/** Ask the preview for its live body markup, already serialized as XHTML. */
export async function requestWidgetBody(iframe: HTMLIFrameElement): Promise<string> {
  const reply = await ask<{ type: string; body: string }>(iframe, { type: "widget:snapshot" }, "widget:snapshot:result");
  return reply.body;
}

/**
 * Drive one event into the preview and wait for the widget to handle it.
 *
 * The shim selects a handler by `event.name`, while the designer's own events
 * carry `kind`. Normalising here means no caller has to remember the
 * difference — getting it wrong silently matches no handler at all.
 */
export async function dispatchToPreview(
  iframe: HTMLIFrameElement,
  event: Record<string, unknown>,
): Promise<void> {
  const name = (event.name as string) ?? (event.kind as string);
  await ask(iframe, { type: "widget:dispatch", event: { ...event, name } }, "widget:dispatch:result");
}

/**
 * Reset the widget by re-running its script.
 *
 * The shim's widget:reset only zeroes the mailbox slots, but widgets keep their
 * state in plain `var`s (the clock's secondsOfDay, for example), so slot-zeroing
 * left them running exactly where they were — Reset appeared to do nothing.
 * Re-assigning srcdoc reloads the document, which re-runs the script from its
 * initial values. That is the only true reset available from outside an opaque
 * origin.
 */
export async function resetPreview(iframe: HTMLIFrameElement): Promise<void> {
  const srcdoc = iframe.srcdoc;
  if (!srcdoc) throw new Error("The preview has no document to reload.");
  iframe.srcdoc = srcdoc;          // reassignment forces a reload
  await waitForPreview(iframe);
}

/**
 * Set one element's text in the preview, for variant capture.
 *
 * Throws when the element is not found. The shim answers {applied:false} in that
 * case, and ignoring it made every variant capture identical pixels — which on
 * device looks exactly like a widget that never updates.
 */
export async function setPreviewText(iframe: HTMLIFrameElement, id: string, text: string): Promise<void> {
  // NOT `id`: ask() stamps its own numeric correlation id onto every message,
  // which silently overwrote the element id and made this a no-op.
  const reply = await ask<{ type: string; applied: boolean }>(
    iframe, { type: "widget:setText", elementId: id, text }, "widget:setText:result",
  );
  if (!reply.applied) throw new Error(`The preview has no element #${id} to set.`);
}

/**
 * Set one element's inline style.color in the preview, for colour-variant
 * raster capture. Same contract and failure mode as setPreviewText; an empty
 * string clears the inline colour back to the stylesheet's.
 */
export async function setPreviewColor(iframe: HTMLIFrameElement, id: string, cssColor: string): Promise<void> {
  const reply = await ask<{ type: string; applied: boolean }>(
    iframe, { type: "widget:setColor", elementId: id, color: cssColor }, "widget:setColor:result",
  );
  if (!reply.applied) throw new Error(`The preview has no element #${id} to colour.`);
}

/**
 * Apply one class-swap variant for capture: the preview appends the variant
 * class to the element's AUTHORED className (remembered in the iframe on first
 * touch); an empty string restores the authored value verbatim. Same contract
 * and failure mode as setPreviewText.
 */
export interface PreviewTransitionProbe {
  property: string;
  durationMs: number;
  delayMs: number;
  timing: string;
}

export async function setPreviewClass(
  iframe: HTMLIFrameElement,
  id: string,
  variantClass: string,
): Promise<PreviewTransitionProbe | null> {
  const reply = await ask<{ type: string; applied: boolean; transition: PreviewTransitionProbe | null }>(
    iframe, { type: "widget:setClass", elementId: id, className: variantClass }, "widget:setClass:result",
  );
  if (!reply.applied) throw new Error(`The preview has no element #${id} to class.`);
  return reply.transition ?? null;
}

/**
 * Blank (or restore) one element's pixels via inline `visibility`, for the
 * hidden-variant base capture: visibility removes the element's painting
 * without reflowing siblings, so every other measured rect stays valid.
 */
export async function setPreviewHidden(iframe: HTMLIFrameElement, id: string, hidden: boolean): Promise<void> {
  const reply = await ask<{ type: string; applied: boolean }>(
    iframe, { type: "widget:setHidden", elementId: id, hidden }, "widget:setHidden:result",
  );
  if (!reply.applied) throw new Error(`The preview has no element #${id} to hide.`);
}

/**
 * The element's computed CSS animation-name ("none" when it has no animation),
 * the widget.animate() capture precondition.
 */
export async function probePreviewAnimation(iframe: HTMLIFrameElement, id: string): Promise<string> {
  const reply = await ask<{ type: string; applied: boolean; animationName: string }>(
    iframe, { type: "widget:probeAnimation", elementId: id }, "widget:probeAnimation:result",
  );
  if (!reply.applied) throw new Error(`The preview has no element #${id} to probe for an animation.`);
  return reply.animationName;
}

/**
 * Freeze the element's CSS animation at a sample time via inline
 * `animation-delay: <delay>; animation-play-state: paused`; `null` removes
 * both overrides, resuming the authored animation.
 */
export async function freezePreviewAnimation(
  iframe: HTMLIFrameElement,
  id: string,
  delay: string | null,
): Promise<void> {
  const reply = await ask<{ type: string; applied: boolean }>(
    iframe, { type: "widget:freezeAnimation", elementId: id, delay }, "widget:freezeAnimation:result",
  );
  if (!reply.applied) throw new Error(`The preview has no element #${id} to freeze.`);
}

export interface GlyphBox { x: number; y: number; width: number; height: number }

/**
 * The element's own border box in device pixels (transforms included), for
 * targets whose pixels are not a text run — class-styled boxes and animated
 * elements — where glyph boxes would miss backgrounds, borders and transforms.
 */
export async function measurePreviewRect(iframe: HTMLIFrameElement, id: string): Promise<GlyphBox> {
  const reply = await ask<{ type: string; applied: boolean; box: GlyphBox | null }>(
    iframe, { type: "widget:measureRect", elementId: id }, "widget:measureRect:result",
  );
  if (!reply.applied || !reply.box) throw new Error(`The preview has no element #${id} to measure.`);
  return reply.box;
}

/** Ask the sandboxed preview whether an attached <img> is visually reducible
 * to one resized sprite plus translation coordinates. */
export async function probePreviewMotionImage(
  iframe: HTMLIFrameElement,
  id: string,
): Promise<PreviewMotionProbe> {
  const reply = await ask<{ type: string; applied: boolean; probe: PreviewMotionProbe | null }>(
    iframe, { type: "widget:probeMotionImage", elementId: id }, "widget:probeMotionImage:result",
  );
  if (!reply.applied || !reply.probe) throw new Error(`The preview has no element #${id} to probe for image motion.`);
  return reply.probe;
}

/** Per-character boxes for a run, in device pixels. */
export async function measurePreviewGlyphs(iframe: HTMLIFrameElement, id: string): Promise<GlyphBox[]> {
  const reply = await ask<{ type: string; boxes: GlyphBox[] }>(
    iframe, { type: "widget:measure", elementId: id }, "widget:measure:result",
  );
  return reply.boxes;
}

function createContext(): { ctx: CanvasRenderingContext2D; canvas: HTMLCanvasElement } {
  const canvas = document.createElement("canvas");
  canvas.width = DEVICE_WIDTH;
  canvas.height = DEVICE_HEIGHT;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Could not acquire a 2D context for snapshotting.");
  return { ctx, canvas };
}

function loadSvgImage(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The widget markup could not be rasterized as SVG."));
    // A data: URL keeps the canvas clean; a blob: URL would too, but data:
    // avoids the revoke bookkeeping for something this small.
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

/**
 * Rasterize the current state of the preview iframe to RGB565 device pixels.
 *
 * Throws if the iframe is cross-origin, not yet loaded, or the markup cannot be
 * rasterized. Callers should fall back to the box-model rasterizer.
 */
export async function snapshotIframe(
  iframe: HTMLIFrameElement,
  css: string,
  assets: WidgetAssetMap = {},
): Promise<Uint16Array> {
  const svg = buildSnapshotSvg(
    await requestWidgetBody(iframe),
    resolveWidgetAssetReferences(css, assets),
  );
  const image = await loadSvgImage(svg);
  const { ctx } = createContext();
  // Paint the backdrop first: foreignObject content may be transparent where
  // the author did not set a background, and the device framebuffer is opaque.
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, DEVICE_WIDTH, DEVICE_HEIGHT);
  ctx.drawImage(image, 0, 0, DEVICE_WIDTH, DEVICE_HEIGHT);
  return rgbaToRgb565(ctx.getImageData(0, 0, DEVICE_WIDTH, DEVICE_HEIGHT).data);
}

export interface CaptureOptions {
  iframe: HTMLIFrameElement;
  css: string;
  assets?: WidgetAssetMap;
  /** How many frames to capture. 1 produces a still. */
  frameCount: number;
  /** Advance the widget one step between snapshots. */
  advance?: () => Promise<void> | void;
}

/**
 * Capture `frameCount` frames, advancing the widget between each.
 *
 * The first frame is captured before any advance, so a 1-frame capture is
 * exactly "what is on screen right now".
 *
 * No paint wait is needed between advance and snapshot: the shim runs the
 * widget's handler synchronously and only then posts its reply, so every DOM
 * write has landed by the time `advance` resolves — and the snapshot reads
 * serialized DOM rather than painted pixels. Waiting on requestAnimationFrame
 * here would stall the whole capture in a backgrounded tab for no benefit.
 */
export async function captureFrames({
  iframe,
  css,
  assets = {},
  frameCount,
  advance,
}: CaptureOptions): Promise<Uint16Array[]> {
  const frames: Uint16Array[] = [];
  for (let index = 0; index < frameCount; index += 1) {
    if (index > 0 && advance) await advance();
    frames.push(await snapshotIframe(iframe, css, assets));
  }
  return frames;
}
