// ─────────────────────────────────────────────────────────────────────────────
// Browser port of the render-v2 *generic* package builder.
//
// Mirrors, byte for byte:
//   f1-widget-sdk/src/render/raster-animation.mjs   (F1RA)
//   f1-widget-sdk/src/render/widget-bundle.mjs      (F1WB)
//
// The generic input-lab firmware admits a STANDALONE F1WB (no F2EP tail).
// See f1-widget-sdk/examples/renderer-id26/on-device/
//   renderer-v2-generic-scene-rpc-core.c:175  →  `if (program_bytes != 0u)`
// so a package whose total_bytes == bundle_bytes skips the F2EP branch
// entirely. Its `basic_f1wb` gate (renderer-v1-scene-rpc-core.c:368) requires:
//
//   magic F1WB · version 1 · capacity 3 · 1..3 slots · activeSlot < count
//   u32@8  == generation          (must be committedGeneration + 1)
//   u32@12 == bundle_bytes        (== total_bytes when standalone)
//   u16@16 == 104 (descriptor)    u16@18 == 332 (payload offset)
//   bundle_bytes <= 98304         (GENERIC_MAX_F1WB_BYTES)
//
// All multi-byte writes are little-endian. Node's Buffer/createHash are
// replaced with Uint8Array/DataView and Web Crypto.
// ─────────────────────────────────────────────────────────────────────────────

/** The F1's logical canvas. F1RA v1 accepts nothing else. */
export const DEVICE_WIDTH = 100;
export const DEVICE_HEIGHT = 310;
export const DEVICE_PIXELS = DEVICE_WIDTH * DEVICE_HEIGHT;

const F1RA_HEADER_BYTES = 64;
const F1RA_RECORD_BYTES = 8;
const F1RA_PIXEL_FORMAT_RGB565_LE = 1;
const F1WB_HEADER_BYTES = 20;
const F1WB_DESCRIPTOR_BYTES = 104;
const F1WB_CAPACITY = 3;
const F1WB_PAYLOAD_OFFSET = F1WB_HEADER_BYTES + F1WB_CAPACITY * F1WB_DESCRIPTOR_BYTES; // 332

/** Device-advertised ceiling: capabilities.maxBundleBytes on the generic build. */
export const MAX_BUNDLE_BYTES = 98_304;
/** capabilities.chunkRawBytes / maxChunks. */
export const CHUNK_RAW_BYTES = 3_072;
export const MAX_CHUNKS = 32;

export const SCENE_RPC_PROTOCOL = "framer-widget-scene-rpc-v1";
export const GENERIC_PROFILE_ID = "framer-f1-render-v2-structural-v1";
export const GENERIC_PACKAGE_FORMAT = "framer-render-v2-package-v1";

const FRAME_FULL = 0;
const FRAME_PIXELS = 1;
const FRAME_SPANS = 2;
const FRAME_TILES = 3;

function invariant(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function align4(value: number): number {
  return (value + 3) & ~3;
}

async function sha256Bytes(value: Uint8Array): Promise<Uint8Array> {
  // Copy into a standalone buffer: subarray views would hash the whole parent.
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", copy));
}

export function toHex(value: Uint8Array): string {
  let out = "";
  for (const byte of value) out += byte.toString(16).padStart(2, "0");
  return out;
}

export async function sha256Hex(value: Uint8Array): Promise<string> {
  return toHex(await sha256Bytes(value));
}

function ascii(target: Uint8Array, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) target[offset + i] = text.charCodeAt(i);
}

// ─── Pixels ──────────────────────────────────────────────────────────────────

/** Pack 8-bit RGB into RGB565, matching cssScene.rgbTo565. */
export function rgbTo565(r: number, g: number, b: number): number {
  return ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3);
}

/**
 * Convert canvas RGBA bytes (4 per pixel) to an RGB565 frame. Alpha is
 * composited over black, which is what the device's opaque framebuffer shows.
 */
export function rgbaToRgb565(rgba: Uint8ClampedArray | Uint8Array): Uint16Array {
  invariant(
    rgba.length === DEVICE_PIXELS * 4,
    `Frame must be ${DEVICE_PIXELS * 4} RGBA bytes (${DEVICE_WIDTH}x${DEVICE_HEIGHT}), got ${rgba.length}.`,
  );
  const frame = new Uint16Array(DEVICE_PIXELS);
  for (let i = 0; i < DEVICE_PIXELS; i += 1) {
    const alpha = rgba[i * 4 + 3] / 255;
    frame[i] = rgbTo565(
      Math.round(rgba[i * 4] * alpha),
      Math.round(rgba[i * 4 + 1] * alpha),
      Math.round(rgba[i * 4 + 2] * alpha),
    );
  }
  return frame;
}

// ─── F1RA frame payload encoders ─────────────────────────────────────────────
//
// Ported verbatim from raster-animation.mjs. The encoder picks whichever of
// the four representations is smallest for each frame, which is what makes
// multi-frame animation fit the 98,304-byte bundle ceiling (a single full
// frame is already 62,000 bytes of pixels).

interface EncodedFrame {
  type: number;
  itemCount: number;
  payload: Uint8Array;
}

function fullPayload(frame: Uint16Array): EncodedFrame {
  const payload = new Uint8Array(frame.length * 2);
  const view = new DataView(payload.buffer);
  for (let i = 0; i < frame.length; i += 1) view.setUint16(i * 2, frame[i], true);
  return { type: FRAME_FULL, itemCount: 0, payload };
}

function pixelPayload(previous: Uint16Array, frame: Uint16Array): EncodedFrame {
  const changed: number[] = [];
  for (let i = 0; i < frame.length; i += 1) if (frame[i] !== previous[i]) changed.push(i);
  const payload = new Uint8Array(changed.length * 4);
  const view = new DataView(payload.buffer);
  changed.forEach((index, item) => {
    view.setUint16(item * 4, index, true);
    view.setUint16(item * 4 + 2, frame[index], true);
  });
  return { type: FRAME_PIXELS, itemCount: changed.length, payload };
}

function spanPayload(previous: Uint16Array, frame: Uint16Array): EncodedFrame {
  const spans: { start: number; length: number }[] = [];
  let i = 0;
  while (i < frame.length) {
    if (frame[i] === previous[i]) { i += 1; continue; }
    const start = i;
    while (i < frame.length && frame[i] !== previous[i] && i - start < 65535) i += 1;
    spans.push({ start, length: i - start });
  }
  const payload = new Uint8Array(spans.reduce((size, span) => size + 4 + span.length * 2, 0));
  const view = new DataView(payload.buffer);
  let cursor = 0;
  for (const span of spans) {
    view.setUint16(cursor, span.start, true);
    view.setUint16(cursor + 2, span.length, true);
    cursor += 4;
    for (let offset = 0; offset < span.length; offset += 1) {
      view.setUint16(cursor, frame[span.start + offset], true);
      cursor += 2;
    }
  }
  return { type: FRAME_SPANS, itemCount: spans.length, payload };
}

function tilePayload(
  previous: Uint16Array,
  frame: Uint16Array,
  tileWidth: number,
  tileHeight: number,
): EncodedFrame {
  const tileColumns = Math.ceil(DEVICE_WIDTH / tileWidth);
  const tileRows = Math.ceil(DEVICE_HEIGHT / tileHeight);
  const tiles: { tileIndex: number; x0: number; y0: number; w: number; h: number }[] = [];
  for (let tileY = 0; tileY < tileRows; tileY += 1) {
    for (let tileX = 0; tileX < tileColumns; tileX += 1) {
      const x0 = tileX * tileWidth;
      const y0 = tileY * tileHeight;
      const w = Math.min(tileWidth, DEVICE_WIDTH - x0);
      const h = Math.min(tileHeight, DEVICE_HEIGHT - y0);
      let changed = false;
      for (let y = 0; y < h && !changed; y += 1) {
        for (let x = 0; x < w; x += 1) {
          const pixel = (y0 + y) * DEVICE_WIDTH + x0 + x;
          if (frame[pixel] !== previous[pixel]) { changed = true; break; }
        }
      }
      if (changed) tiles.push({ tileIndex: tileY * tileColumns + tileX, x0, y0, w, h });
    }
  }
  const payload = new Uint8Array(tiles.reduce((sum, tile) => sum + 2 + tile.w * tile.h * 2, 0));
  const view = new DataView(payload.buffer);
  let cursor = 0;
  for (const tile of tiles) {
    view.setUint16(cursor, tile.tileIndex, true);
    cursor += 2;
    for (let y = 0; y < tile.h; y += 1) {
      for (let x = 0; x < tile.w; x += 1) {
        view.setUint16(cursor, frame[(tile.y0 + y) * DEVICE_WIDTH + tile.x0 + x], true);
        cursor += 2;
      }
    }
  }
  return { type: FRAME_TILES, itemCount: tiles.length, payload };
}

function chooseDelta(previous: Uint16Array, frame: Uint16Array, tileWidth: number, tileHeight: number): EncodedFrame {
  const candidates = [
    pixelPayload(previous, frame),
    spanPayload(previous, frame),
    tilePayload(previous, frame, tileWidth, tileHeight),
    fullPayload(frame),
  ];
  candidates.sort((a, b) => a.payload.length - b.payload.length || a.type - b.type);
  return candidates[0];
}

export interface RasterAnimationOptions {
  frames: Uint16Array[];
  /** Whole frames per second, (0, 10]. The device cadence is a 100ms multiple. */
  fps?: number;
  keyframeInterval?: number;
  tileWidth?: number;
  tileHeight?: number;
}

/** Encode 1..60 RGB565 frames into an F1RA v1 binary. */
export async function encodeRasterAnimation({
  frames,
  fps = 10,
  keyframeInterval = 0,
  tileWidth = 10,
  tileHeight = 10,
}: RasterAnimationOptions): Promise<Uint8Array> {
  invariant(Array.isArray(frames) && frames.length >= 1 && frames.length <= 60, "F1RA requires 1..60 frames.");
  invariant(Number.isFinite(fps) && fps > 0 && fps <= 10, "F1RA device fps must be in (0, 10].");
  frames.forEach((frame, index) =>
    invariant(
      frame instanceof Uint16Array && frame.length === DEVICE_PIXELS,
      `Raster frame ${index} must be a ${DEVICE_PIXELS}-pixel Uint16Array.`,
    ));

  const cadenceMs = Math.round(1000 / fps / 100) * 100;
  invariant(
    cadenceMs >= 100 && cadenceMs <= 65535,
    `F1RA cadence ${cadenceMs}ms (from ${fps} fps) must quantize into 100..65535ms.`,
  );
  const loopDurationMs = cadenceMs * frames.length;

  const encoded = frames.map((frame, index) =>
    index === 0 || (keyframeInterval > 0 && index % keyframeInterval === 0)
      ? fullPayload(frame)
      : chooseDelta(frames[index - 1], frame, tileWidth, tileHeight));

  const payloadBytes = encoded.reduce((sum, e) => sum + F1RA_RECORD_BYTES + e.payload.length, 0);
  const binary = new Uint8Array(F1RA_HEADER_BYTES + payloadBytes);
  const view = new DataView(binary.buffer);
  ascii(binary, 0, "F1RA");
  binary[4] = 1;
  binary[5] = F1RA_PIXEL_FORMAT_RGB565_LE;
  view.setUint16(6, DEVICE_WIDTH, true);
  view.setUint16(8, DEVICE_HEIGHT, true);
  view.setUint16(10, frames.length, true);
  view.setUint16(12, cadenceMs, true);
  view.setUint16(14, 0, true);
  view.setUint32(16, loopDurationMs, true);
  view.setUint16(20, keyframeInterval, true);
  binary[22] = tileWidth;
  binary[23] = tileHeight;
  view.setUint32(24, binary.length, true);
  view.setUint32(28, DEVICE_PIXELS * 2, true);

  let cursor = F1RA_HEADER_BYTES;
  for (const frame of encoded) {
    binary[cursor] = frame.type;
    binary[cursor + 1] = 0;
    view.setUint16(cursor + 2, frame.itemCount, true);
    view.setUint32(cursor + 4, frame.payload.length, true);
    binary.set(frame.payload, cursor + F1RA_RECORD_BYTES);
    cursor += F1RA_RECORD_BYTES + frame.payload.length;
  }
  // Digest covers the payload only; it lands at header offset 32.
  binary.set(await sha256Bytes(binary.subarray(F1RA_HEADER_BYTES)), 32);
  return binary;
}

// ─── F1WB widget bundle ──────────────────────────────────────────────────────

export interface RasterSlot {
  /** 1..16 UTF-8 bytes. */
  name: string;
  animationBinary: Uint8Array;
}

/**
 * Encode 1..3 raster slots into an F1WB v1 bundle. Semantic (F1SC+F1GA) slots
 * are not emitted here — the designer's WYSIWYG path is raster.
 */
export async function encodeWidgetBundle({
  slots,
  activeSlot = 0,
  generation = 1,
}: {
  slots: RasterSlot[];
  activeSlot?: number;
  generation?: number;
}): Promise<Uint8Array> {
  invariant(slots.length >= 1 && slots.length <= F1WB_CAPACITY, "Widget bundle requires 1..3 slots.");
  invariant(
    Number.isInteger(activeSlot) && activeSlot >= 0 && activeSlot < slots.length,
    "Widget bundle activeSlot is not populated.",
  );
  invariant(
    Number.isInteger(generation) && generation >= 0 && generation <= 0xffffffff,
    "Widget bundle generation must be a uint32.",
  );

  const encoder = new TextEncoder();
  const normalized = slots.map((slot, index) => {
    const name = encoder.encode(slot.name);
    invariant(name.length >= 1 && name.length <= 16, `Widget slot ${index} name must be 1..16 UTF-8 bytes.`);
    const primary = slot.animationBinary;
    invariant(
      String.fromCharCode(...primary.subarray(0, 4)) === "F1RA",
      `Widget slot ${index} primary magic is not F1RA.`,
    );
    return { name, primary };
  });

  let cursor = F1WB_PAYLOAD_OFFSET;
  const placed = normalized.map((slot) => {
    const primaryOffset = cursor;
    cursor = align4(cursor + slot.primary.length);
    return { ...slot, primaryOffset };
  });

  const binary = new Uint8Array(cursor);
  const view = new DataView(binary.buffer);
  ascii(binary, 0, "F1WB");
  binary[4] = 1;
  binary[5] = F1WB_CAPACITY;
  binary[6] = slots.length;
  binary[7] = activeSlot;
  view.setUint32(8, generation, true);
  view.setUint32(12, binary.length, true);
  view.setUint16(16, F1WB_DESCRIPTOR_BYTES, true);
  view.setUint16(18, F1WB_PAYLOAD_OFFSET, true);

  // A raster slot has no auxiliary payload, but the descriptor still carries
  // sha256 of the empty string — the decoder digests a zero-length buffer.
  const emptyDigest = await sha256Bytes(new Uint8Array(0));

  for (let index = 0; index < placed.length; index += 1) {
    const slot = placed[index];
    const base = F1WB_HEADER_BYTES + index * F1WB_DESCRIPTOR_BYTES;
    binary[base] = 1;
    binary[base + 1] = 2; // KINDS.raster
    binary[base + 2] = slot.name.length;
    binary[base + 3] = 0;
    view.setUint32(base + 4, slot.primaryOffset, true);
    view.setUint32(base + 8, slot.primary.length, true);
    view.setUint32(base + 12, 0, true); // auxiliaryOffset
    view.setUint32(base + 16, 0, true); // auxiliaryLength
    binary.set(await sha256Bytes(slot.primary), base + 20);
    binary.set(emptyDigest, base + 52);
    binary.set(slot.name, base + 84);
    binary.set(slot.primary, slot.primaryOffset);
  }
  return binary;
}

// ─── Package + upload plan ───────────────────────────────────────────────────

export interface RenderV2Package {
  binary: Uint8Array;
  sha256: string;
  generation: number;
  bytes: number;
  frameCount: number;
}

/**
 * Restamp the F1WB generation word (u32@8) and re-hash.
 *
 * Safe to do after the fact: the slot descriptors digest their payloads only,
 * never the bundle header, so no inner digest depends on this field. The
 * device compares u32@8 against `generation` in basic_f1wb, and requires
 * generation == committedGeneration + 1 — which is only knowable once we've
 * talked to the keyboard, hence a post-build restamp rather than a rebuild.
 */
export async function rewriteGeneration(pkg: RenderV2Package, generation: number): Promise<RenderV2Package> {
  invariant(
    Number.isInteger(generation) && generation >= 0 && generation <= 0xffffffff,
    "Generation must be a uint32.",
  );
  if (pkg.generation === generation) return pkg;
  const binary = new Uint8Array(pkg.binary);
  new DataView(binary.buffer).setUint32(8, generation, true);
  return { ...pkg, binary, generation, sha256: await sha256Hex(binary) };
}

/**
 * Build a standalone-F1WB render-v2 package from RGB565 frames.
 *
 * `generation` must be the device's committedGeneration + 1; the device
 * rejects anything else (basic_f1wb compares u32@8 against it).
 */
export async function buildRenderV2RasterPackage({
  frames,
  name = "designer",
  generation,
  fps = 10,
}: {
  frames: Uint16Array[];
  name?: string;
  generation: number;
  fps?: number;
}): Promise<RenderV2Package> {
  const animation = await encodeRasterAnimation({ frames, fps });
  const binary = await encodeWidgetBundle({
    slots: [{ name: name.slice(0, 16) || "designer", animationBinary: animation }],
    activeSlot: 0,
    generation,
  });
  invariant(
    binary.length <= MAX_BUNDLE_BYTES,
    `Package is ${binary.length} bytes, over the device's ${MAX_BUNDLE_BYTES}-byte bundle ceiling. ` +
      "Reduce the frame count or simplify the widget.",
  );
  const totalChunks = Math.ceil(binary.length / CHUNK_RAW_BYTES);
  invariant(
    totalChunks >= 1 && totalChunks <= MAX_CHUNKS,
    `Package needs ${totalChunks} chunks, over the device's ${MAX_CHUNKS}-chunk cap.`,
  );
  return {
    binary,
    sha256: await sha256Hex(binary),
    generation,
    bytes: binary.length,
    frameCount: frames.length,
  };
}
