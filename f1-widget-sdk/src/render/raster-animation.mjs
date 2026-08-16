import { createHash } from "node:crypto";

const MAGIC = Buffer.from("F1RA", "ascii");
const VERSION = 1;
const HEADER_BYTES = 64;
const RECORD_BYTES = 8;
const PIXEL_FORMAT_RGB565_LE = 1;
const FRAME_FULL = 0;
const FRAME_PIXELS = 1;
const FRAME_SPANS = 2;
const FRAME_TILES = 3;
const MAX_ENCODED_BYTES = 128 * 1024;

function invariant(value, message) {
  if (!value) throw new Error(message);
}

function digest(value) {
  return createHash("sha256").update(value).digest();
}

function normalizeFrame(frame, pixels, index) {
  invariant(frame instanceof Uint16Array && frame.length === pixels,
    `Raster frame ${index} must be a ${pixels}-pixel Uint16Array.`);
  return frame;
}

function fullPayload(frame, previous = null) {
  const output = Buffer.alloc(frame.length * 2);
  frame.forEach((color, index) => output.writeUInt16LE(color, index * 2));
  let changedPixels = frame.length;
  if (previous) {
    changedPixels = 0;
    for (let index = 0; index < frame.length; index += 1) if (frame[index] !== previous[index]) changedPixels += 1;
  }
  return { type: FRAME_FULL, itemCount: 0, payload: output, changedPixels };
}

function pixelPayload(previous, frame) {
  const changed = [];
  for (let index = 0; index < frame.length; index += 1) if (frame[index] !== previous[index]) changed.push(index);
  const output = Buffer.alloc(changed.length * 4);
  changed.forEach((index, item) => {
    output.writeUInt16LE(index, item * 4);
    output.writeUInt16LE(frame[index], item * 4 + 2);
  });
  return { type: FRAME_PIXELS, itemCount: changed.length, payload: output, changedPixels: changed.length };
}

function spanPayload(previous, frame) {
  const spans = [];
  let index = 0;
  let changedPixels = 0;
  while (index < frame.length) {
    if (frame[index] === previous[index]) { index += 1; continue; }
    const start = index;
    while (index < frame.length && frame[index] !== previous[index] && index - start < 65535) index += 1;
    spans.push({ start, length: index - start });
    changedPixels += index - start;
  }
  const output = Buffer.alloc(spans.reduce((size, span) => size + 4 + span.length * 2, 0));
  let cursor = 0;
  for (const span of spans) {
    output.writeUInt16LE(span.start, cursor);
    output.writeUInt16LE(span.length, cursor + 2);
    cursor += 4;
    for (let offset = 0; offset < span.length; offset += 1) {
      output.writeUInt16LE(frame[span.start + offset], cursor);
      cursor += 2;
    }
  }
  return { type: FRAME_SPANS, itemCount: spans.length, payload: output, changedPixels };
}

function tilePayload(previous, frame, width, height, tileWidth, tileHeight) {
  const tileColumns = Math.ceil(width / tileWidth);
  const tileRows = Math.ceil(height / tileHeight);
  const changedTiles = [];
  let changedPixels = 0;
  for (let tileY = 0; tileY < tileRows; tileY += 1) {
    for (let tileX = 0; tileX < tileColumns; tileX += 1) {
      const x0 = tileX * tileWidth;
      const y0 = tileY * tileHeight;
      const actualWidth = Math.min(tileWidth, width - x0);
      const actualHeight = Math.min(tileHeight, height - y0);
      let changed = false;
      for (let y = 0; y < actualHeight && !changed; y += 1) {
        for (let x = 0; x < actualWidth; x += 1) {
          const pixel = (y0 + y) * width + x0 + x;
          if (frame[pixel] !== previous[pixel]) { changed = true; break; }
        }
      }
      if (changed) {
        changedTiles.push({ tileIndex: tileY * tileColumns + tileX, x0, y0, actualWidth, actualHeight });
        for (let y = 0; y < actualHeight; y += 1) for (let x = 0; x < actualWidth; x += 1) {
          const pixel = (y0 + y) * width + x0 + x;
          if (frame[pixel] !== previous[pixel]) changedPixels += 1;
        }
      }
    }
  }
  const size = changedTiles.reduce((sum, tile) => sum + 2 + tile.actualWidth * tile.actualHeight * 2, 0);
  const output = Buffer.alloc(size);
  let cursor = 0;
  for (const tile of changedTiles) {
    output.writeUInt16LE(tile.tileIndex, cursor); cursor += 2;
    for (let y = 0; y < tile.actualHeight; y += 1) for (let x = 0; x < tile.actualWidth; x += 1) {
      output.writeUInt16LE(frame[(tile.y0 + y) * width + tile.x0 + x], cursor); cursor += 2;
    }
  }
  return { type: FRAME_TILES, itemCount: changedTiles.length, payload: output, changedPixels };
}

function chooseDelta(previous, frame, options) {
  const candidates = [pixelPayload(previous, frame), spanPayload(previous, frame),
    tilePayload(previous, frame, options.width, options.height, options.tileWidth, options.tileHeight),
    fullPayload(frame, previous)];
  candidates.sort((left, right) => left.payload.length - right.payload.length || left.type - right.type);
  return candidates[0];
}

export function encodeRasterAnimation({ frames, width = 100, height = 310, fps = 10,
  loopDurationMs = Math.round(frames?.length * 1000 / fps), maxBytes = MAX_ENCODED_BYTES,
  keyframeInterval = 0, tileWidth = 10, tileHeight = 10 }) {
  invariant(width === 100 && height === 310, "F1RA v1 requires the exact 100x310 logical canvas.");
  invariant(Array.isArray(frames) && frames.length >= 1 && frames.length <= 60, "F1RA requires 1..60 frames.");
  invariant(Number.isFinite(fps) && fps > 0 && fps <= 10, "F1RA device fps must be in (0, 10].");
  invariant(Number.isInteger(loopDurationMs) && loopDurationMs > 0 && loopDurationMs <= 0xffffffff,
    "F1RA loop duration must be a positive uint32 millisecond value.");
  const cadenceMs = loopDurationMs / frames.length;
  invariant(Number.isInteger(cadenceMs) && cadenceMs >= 100 && cadenceMs <= 65535 && cadenceMs % 100 === 0,
    "F1RA frame cadence must be an exact 100ms multiple derived from loopDurationMs/frameCount.");
  invariant(Math.abs(fps - 1000 / cadenceMs) < 0.0005,
    `F1RA fps ${fps} does not match the quantized ${cadenceMs}ms cadence.`);
  invariant(Number.isInteger(maxBytes) && maxBytes >= HEADER_BYTES + RECORD_BYTES && maxBytes <= MAX_ENCODED_BYTES,
    `F1RA maxBytes must be within ${HEADER_BYTES + RECORD_BYTES}..${MAX_ENCODED_BYTES}.`);
  invariant(Number.isInteger(keyframeInterval) && keyframeInterval >= 0 && keyframeInterval <= 60,
    "F1RA keyframe interval must be 0..60.");
  invariant(Number.isInteger(tileWidth) && tileWidth >= 1 && tileWidth <= 32 &&
    Number.isInteger(tileHeight) && tileHeight >= 1 && tileHeight <= 32, "F1RA tile dimensions must be 1..32.");
  const pixels = width * height;
  frames.forEach((frame, index) => normalizeFrame(frame, pixels, index));
  const encodedFrames = frames.map((frame, index) => index === 0 || keyframeInterval > 0 && index % keyframeInterval === 0
    ? fullPayload(frame, index === 0 ? null : frames[index - 1])
    : chooseDelta(frames[index - 1], frame, { width, height, tileWidth, tileHeight }));
  const payloadBytes = encodedFrames.reduce((sum, encoded) => sum + RECORD_BYTES + encoded.payload.length, 0);
  const binary = Buffer.alloc(HEADER_BYTES + payloadBytes);
  MAGIC.copy(binary, 0);
  binary[4] = VERSION;
  binary[5] = PIXEL_FORMAT_RGB565_LE;
  binary.writeUInt16LE(width, 6);
  binary.writeUInt16LE(height, 8);
  binary.writeUInt16LE(frames.length, 10);
  binary.writeUInt16LE(cadenceMs, 12);
  binary.writeUInt16LE(0, 14);
  binary.writeUInt32LE(loopDurationMs, 16);
  binary.writeUInt16LE(keyframeInterval, 20);
  binary[22] = tileWidth;
  binary[23] = tileHeight;
  binary.writeUInt32LE(binary.length, 24);
  binary.writeUInt32LE(pixels * 2, 28);
  let cursor = HEADER_BYTES;
  for (const frame of encodedFrames) {
    binary[cursor] = frame.type;
    binary[cursor + 1] = 0;
    binary.writeUInt16LE(frame.itemCount, cursor + 2);
    binary.writeUInt32LE(frame.payload.length, cursor + 4);
    frame.payload.copy(binary, cursor + RECORD_BYTES);
    cursor += RECORD_BYTES + frame.payload.length;
  }
  digest(binary.subarray(HEADER_BYTES)).copy(binary, 32);
  invariant(binary.length <= maxBytes,
    `F1RA is ${binary.length} bytes, exceeding the ${maxBytes}-byte animation budget.`);
  return { format: "framer-raster-animation-v1", binary,
    sha256: digest(binary).toString("hex"), width, height, fps, cadenceMs, loopDurationMs, keyframeInterval, tileWidth, tileHeight,
    stats: { frameCount: frames.length, encodedBytes: binary.length, rawBytes: frames.length * pixels * 2,
      savedBytes: frames.length * pixels * 2 - binary.length,
      modes: encodedFrames.map(({ type }) => ["full", "pixels", "spans", "tiles"][type]),
      changedPixels: encodedFrames.map(({ changedPixels }) => changedPixels),
      maxBytes, headroomBytes: Number.isFinite(maxBytes) ? maxBytes - binary.length : null } };
}

function evenlySpaced(frames, count) {
  if (count === frames.length) return { frames, indices: frames.map((_, index) => index) };
  if (count === 1) return { frames: [frames[0]], indices: [0] };
  const indices = Array.from({ length: count }, (_, index) => Math.round(index * (frames.length - 1) / (count - 1)));
  return { frames: indices.map((index) => frames[index]), indices };
}

/** Pick the largest evenly distributed frame set that actually fits after delta encoding. */
export function fitRasterAnimation({ frames, maxBytes, maxFrames = 60, minFrames = 1, ...options }) {
  invariant(Number.isInteger(maxBytes) && maxBytes >= HEADER_BYTES + RECORD_BYTES,
    "Raster fitting requires a finite positive maxBytes budget.");
  const requestedCount = Math.min(maxFrames, frames.length);
  for (let count = requestedCount; count >= minFrames; count -= 1) {
    const loopDurationMs = options.loopDurationMs ?? Math.round(requestedCount * 1000 / (options.fps ?? 10));
    const cadenceMs = loopDurationMs / count;
    if (!Number.isInteger(cadenceMs) || cadenceMs < 100 || cadenceMs > 65535 || cadenceMs % 100 !== 0) continue;
    const selected = evenlySpaced(frames, count);
    try {
      const encoded = encodeRasterAnimation({ ...options, fps: 1000 / cadenceMs, loopDurationMs,
        frames: selected.frames, maxBytes });
      return { ...encoded, selectedFrameIndices: selected.indices, requestedFrameCount: requestedCount,
        reduced: count !== requestedCount };
    } catch (error) {
      if (!/exceeding the .*animation budget/u.test(error.message)) throw error;
    }
  }
  throw new Error(`No raster animation with ${minFrames} or more frames fits ${maxBytes} bytes.`);
}

function decodeFrameRecord(binary, cursor, state) {
  invariant(cursor + RECORD_BYTES <= binary.length, "F1RA frame record is truncated.");
  const type = binary[cursor];
  const itemCount = binary.readUInt16LE(cursor + 2);
  const length = binary.readUInt32LE(cursor + 4);
  invariant(binary[cursor + 1] === 0 && cursor + RECORD_BYTES + length <= binary.length,
    "F1RA frame record header is invalid.");
  let position = cursor + RECORD_BYTES;
  const end = position + length;
  const frame = type === FRAME_FULL ? new Uint16Array(state.pixels) : new Uint16Array(state.previous);
  if (type === FRAME_FULL) {
    invariant(itemCount === 0 && length === state.pixels * 2, "F1RA full frame length is invalid.");
    for (let index = 0; index < state.pixels; index += 1) frame[index] = binary.readUInt16LE(position + index * 2);
    position = end;
  } else if (type === FRAME_PIXELS) {
    invariant(length === itemCount * 4, "F1RA pixel delta length is invalid.");
    let previousOffset = -1;
    for (let item = 0; item < itemCount; item += 1) {
      const offset = binary.readUInt16LE(position);
      invariant(offset > previousOffset && offset < state.pixels, "F1RA pixel offsets are invalid or unordered.");
      frame[offset] = binary.readUInt16LE(position + 2); previousOffset = offset; position += 4;
    }
  } else if (type === FRAME_SPANS) {
    let previousEnd = 0;
    for (let item = 0; item < itemCount; item += 1) {
      invariant(position + 4 <= end, "F1RA span header is truncated.");
      const offset = binary.readUInt16LE(position);
      const spanLength = binary.readUInt16LE(position + 2); position += 4;
      invariant(spanLength > 0 && offset >= previousEnd && offset + spanLength <= state.pixels &&
        position + spanLength * 2 <= end, "F1RA span range is invalid or unordered.");
      for (let pixel = 0; pixel < spanLength; pixel += 1) frame[offset + pixel] = binary.readUInt16LE(position + pixel * 2);
      position += spanLength * 2; previousEnd = offset + spanLength;
    }
  } else if (type === FRAME_TILES) {
    const columns = Math.ceil(state.width / state.tileWidth);
    const rows = Math.ceil(state.height / state.tileHeight);
    let previousTile = -1;
    for (let item = 0; item < itemCount; item += 1) {
      invariant(position + 2 <= end, "F1RA tile header is truncated.");
      const tile = binary.readUInt16LE(position); position += 2;
      invariant(tile > previousTile && tile < columns * rows, "F1RA tile indices are invalid or unordered.");
      const x0 = tile % columns * state.tileWidth;
      const y0 = Math.floor(tile / columns) * state.tileHeight;
      const actualWidth = Math.min(state.tileWidth, state.width - x0);
      const actualHeight = Math.min(state.tileHeight, state.height - y0);
      invariant(position + actualWidth * actualHeight * 2 <= end, "F1RA tile pixels are truncated.");
      for (let y = 0; y < actualHeight; y += 1) for (let x = 0; x < actualWidth; x += 1) {
        frame[(y0 + y) * state.width + x0 + x] = binary.readUInt16LE(position); position += 2;
      }
      previousTile = tile;
    }
  } else {
    throw new Error(`Unsupported F1RA frame mode ${type}.`);
  }
  invariant(position === end, "F1RA frame payload has trailing bytes.");
  return { frame, next: end, mode: ["full", "pixels", "spans", "tiles"][type] };
}

export function decodeRasterAnimation(value) {
  invariant(value instanceof Uint8Array, "F1RA binary must be a Uint8Array.");
  const binary = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  invariant(binary.length >= HEADER_BYTES && binary.subarray(0, 4).equals(MAGIC),
    "F1RA is truncated or has invalid magic.");
  invariant(binary[4] === VERSION && binary[5] === PIXEL_FORMAT_RGB565_LE, "Unsupported F1RA version/pixel format.");
  const width = binary.readUInt16LE(6);
  const height = binary.readUInt16LE(8);
  const frameCount = binary.readUInt16LE(10);
  const cadenceMs = binary.readUInt16LE(12);
  const fps = 1000 / cadenceMs;
  const loopDurationMs = binary.readUInt32LE(16);
  const keyframeInterval = binary.readUInt16LE(20);
  const tileWidth = binary[22];
  const tileHeight = binary[23];
  invariant(binary.length <= MAX_ENCODED_BYTES && width === 100 && height === 310 && frameCount >= 1 && frameCount <= 60 &&
    cadenceMs >= 100 && cadenceMs % 100 === 0 && binary.readUInt16LE(14) === 0 && fps > 0 && fps <= 10 &&
    loopDurationMs === frameCount * cadenceMs && keyframeInterval <= 60 && tileWidth >= 1 && tileWidth <= 32 && tileHeight >= 1 && tileHeight <= 32 &&
    binary.readUInt32LE(24) === binary.length && binary.readUInt32LE(28) === width * height * 2,
  "F1RA header is invalid.");
  invariant(digest(binary.subarray(HEADER_BYTES)).equals(binary.subarray(32, 64)), "F1RA payload SHA-256 failed.");
  const frames = [];
  const modes = [];
  let cursor = HEADER_BYTES;
  let previous = null;
  for (let index = 0; index < frameCount; index += 1) {
    const type = binary[cursor];
    invariant(index !== 0 || type === FRAME_FULL, "F1RA frame zero must be a full keyframe.");
    invariant(!(keyframeInterval > 0 && index % keyframeInterval === 0) || type === FRAME_FULL,
      `F1RA frame ${index} must be a scheduled keyframe.`);
    invariant(previous || type === FRAME_FULL, `F1RA frame ${index} has no delta base.`);
    const decoded = decodeFrameRecord(binary, cursor,
      { previous, pixels: width * height, width, height, tileWidth, tileHeight });
    frames.push(decoded.frame); modes.push(decoded.mode); previous = decoded.frame; cursor = decoded.next;
  }
  invariant(cursor === binary.length, "F1RA has trailing bytes after its declared frames.");
  return { format: "framer-raster-animation-v1", binary: Buffer.from(binary),
    sha256: digest(binary).toString("hex"), width, height, fps, cadenceMs, loopDurationMs, keyframeInterval, tileWidth, tileHeight,
    frames, modes };
}

export function rgba8888ToRgb565Frame(rgba, { width = 100, height = 310, background = { r: 0, g: 0, b: 0 } } = {}) {
  invariant(rgba instanceof Uint8Array && rgba.length === width * height * 4, "RGBA capture has the wrong byte length.");
  const frame = new Uint16Array(width * height);
  for (let index = 0; index < frame.length; index += 1) {
    const alpha = rgba[index * 4 + 3];
    const inverse = 255 - alpha;
    const r = Math.floor((rgba[index * 4] * alpha + background.r * inverse + 127) / 255);
    const g = Math.floor((rgba[index * 4 + 1] * alpha + background.g * inverse + 127) / 255);
    const b = Math.floor((rgba[index * 4 + 2] * alpha + background.b * inverse + 127) / 255);
    frame[index] = ((r >>> 3) << 11) | ((g >>> 2) << 5) | (b >>> 3);
  }
  return frame;
}

export const RASTER_ANIMATION_LIMITS = Object.freeze({ width: 100, height: 310, maxFrames: 60,
  maxFps: 10, tickMs: 100, maxEncodedBytes: MAX_ENCODED_BYTES,
  headerBytes: HEADER_BYTES, recordBytes: RECORD_BYTES });
