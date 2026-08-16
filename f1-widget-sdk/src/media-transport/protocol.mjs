import { createHash } from "node:crypto";

export const MEDIA_TRANSPORT_PROTOCOL = "framer-host-media-v1";
export const MEDIA_TRANSPORT_SCREEN_ID = 1;
export const MEDIA_CHUNK_RAW_BYTES = 3072;
export const MEDIA_CHUNK_BASE64_CHARS = 4096;
export const MEDIA_DEFAULT_TEXT_BYTES = 256;
export const MEDIA_MAX_ARTWORK_BYTES = 512 * 512 * 2;

/** @typedef {{format:"rgba8",width:number,height:number,pixels:Uint8Array}} RgbaArtwork */
/** @typedef {{title:string,artist:string,durationMs:number,positionMs:number,isPlaying?:boolean,albumArt:RgbaArtwork}} HostMediaSnapshot */

function invariant(value, message) {
  if (!value) throw new Error(message);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object" || Buffer.isBuffer(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

export function stableMediaJson(value) {
  return JSON.stringify(stable(value));
}

export function mediaSha256(value) {
  const bytes = Buffer.isBuffer(value) || value instanceof Uint8Array
    ? Buffer.from(value)
    : Buffer.from(stableMediaJson(value));
  return createHash("sha256").update(bytes).digest("hex");
}

function positiveInteger(value, field, maximum = Number.MAX_SAFE_INTEGER) {
  invariant(Number.isSafeInteger(value) && value > 0 && value <= maximum,
    `${field} must be a positive integer no greater than ${maximum}.`);
  return value;
}

function nonNegativeInteger(value, field) {
  invariant(Number.isSafeInteger(value) && value >= 0, `${field} must be a non-negative safe integer.`);
  return value;
}

function deepAccentHex({ r, g, b }) {
  const channels = [r, g, b].map((value) => value / 255);
  const maximum = Math.max(...channels);
  const minimum = Math.min(...channels);
  const delta = maximum - minimum;
  const sourceLightness = (maximum + minimum) / 2;
  let hue = 0;
  if (delta > 0) {
    if (maximum === channels[0]) hue = ((channels[1] - channels[2]) / delta) % 6;
    else if (maximum === channels[1]) hue = (channels[2] - channels[0]) / delta + 2;
    else hue = (channels[0] - channels[1]) / delta + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  const sourceSaturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * sourceLightness - 1));
  const saturation = Math.max(0.68, sourceSaturation);
  const lightness = Math.max(0.24, Math.min(0.38, sourceLightness * 0.55));
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const section = hue / 60;
  const intermediate = chroma * (1 - Math.abs((section % 2) - 1));
  let colored = [0, 0, 0];
  if (section < 1) colored = [chroma, intermediate, 0];
  else if (section < 2) colored = [intermediate, chroma, 0];
  else if (section < 3) colored = [0, chroma, intermediate];
  else if (section < 4) colored = [0, intermediate, chroma];
  else if (section < 5) colored = [intermediate, 0, chroma];
  else colored = [chroma, 0, intermediate];
  const match = lightness - chroma / 2;
  const output = colored.map((value) => Math.round((value + match) * 255));
  return `#${output.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

export function fitUtf8Text(value, maxBytes = MEDIA_DEFAULT_TEXT_BYTES, fallback = "") {
  positiveInteger(maxBytes, "maxBytes", 4096);
  invariant(typeof value === "string", "Media text must be a string.");
  const source = value.trim() || fallback;
  const encoder = new TextEncoder();
  let output = "";
  let bytes = 0;
  for (const character of source) {
    const size = encoder.encode(character).length;
    if (bytes + size > maxBytes) break;
    output += character;
    bytes += size;
  }
  return output;
}

export function normalizeTransportSnapshot(raw, { maxTextBytes = MEDIA_DEFAULT_TEXT_BYTES } = {}) {
  invariant(raw && typeof raw === "object", "Host media source must return an object.");
  const title = fitUtf8Text(raw.title, maxTextBytes, "Untitled");
  const artist = fitUtf8Text(raw.artist, maxTextBytes, "Unknown Artist");
  const durationMs = nonNegativeInteger(raw.durationMs, "durationMs");
  const positionMs = Math.min(nonNegativeInteger(raw.positionMs, "positionMs"), durationMs);
  invariant(raw.albumArt?.format === "rgba8", "albumArt.format must be rgba8.");
  const width = positiveInteger(raw.albumArt.width, "albumArt.width", 512);
  const height = positiveInteger(raw.albumArt.height, "albumArt.height", 512);
  const pixels = Buffer.isBuffer(raw.albumArt.pixels)
    ? Buffer.from(raw.albumArt.pixels)
    : raw.albumArt.pixels instanceof Uint8Array
      ? Buffer.from(raw.albumArt.pixels.buffer, raw.albumArt.pixels.byteOffset, raw.albumArt.pixels.byteLength)
      : null;
  invariant(pixels?.length === width * height * 4,
    `albumArt.pixels must contain exactly ${width * height * 4} RGBA8 bytes.`);
  return Object.freeze({
    title,
    artist,
    durationMs,
    positionMs,
    isPlaying: raw.isPlaying === undefined ? true : raw.isPlaying === true,
    albumArt: Object.freeze({ format: "rgba8", width, height, pixels: Buffer.from(pixels) }),
  });
}

export function createMediaHostHello() {
  return Object.freeze({
    protocol: MEDIA_TRANSPORT_PROTOCOL,
    type: "host-hello",
    hostRole: "media-source",
    screenId: MEDIA_TRANSPORT_SCREEN_ID,
    chunkRawBytes: MEDIA_CHUNK_RAW_BYTES,
    artworkFormats: Object.freeze(["rgb565-le"]),
    publishingPolicy: "require-live-proven-framer-handler",
  });
}

export function validateMediaHostHello(raw) {
  invariant(raw && typeof raw === "object", "Media host returned no hello object.");
  invariant(raw.protocol === MEDIA_TRANSPORT_PROTOCOL && raw.type === "host-hello",
    "Media host hello protocol/type mismatch.");
  invariant(raw.hostRole === "media-source" && raw.screenId === MEDIA_TRANSPORT_SCREEN_ID,
    "Media host hello role/screen mismatch.");
  invariant(raw.chunkRawBytes === MEDIA_CHUNK_RAW_BYTES,
    `Media host chunk size must be ${MEDIA_CHUNK_RAW_BYTES} raw bytes.`);
  invariant(Array.isArray(raw.artworkFormats) && raw.artworkFormats.includes("rgb565-le"),
    "Media host must offer rgb565-le artwork.");
  invariant(raw.publishingPolicy === "require-live-proven-framer-handler",
    "Media host publishing policy must require live-proven Framer handlers.");
  return Object.freeze({ ...raw, artworkFormats: Object.freeze([...raw.artworkFormats]) });
}

export function normalizeMediaCapabilities(raw) {
  invariant(raw && typeof raw === "object", "Media sink returned no capability object.");
  invariant(raw.protocol === MEDIA_TRANSPORT_PROTOCOL, "Media sink protocol mismatch.");
  invariant(raw.type === "device-capabilities", "Media sink returned the wrong capability message type.");
  invariant(raw.deviceFamily === "knob_f1", "Media sink is not a Framer F1 runtime.");
  if (raw.status === "blocked") {
    return Object.freeze({
      protocol: raw.protocol,
      type: raw.type,
      deviceFamily: raw.deviceFamily,
      status: "blocked",
      runtimeProof: raw.runtimeProof ?? "unproven",
      reason: String(raw.reason || "runtime unavailable"),
      hardwareAccess: raw.hardwareAccess === true,
    });
  }
  invariant(raw.status === "ready", "Media sink capability status must be ready or blocked.");
  invariant(raw.runtimeProof === "live-proven" || raw.runtimeProof === "mock",
    "Ready media runtime must declare live-proven or mock proof.");
  invariant(raw.metadata === true && raw.artwork === true, "Media runtime must support metadata and artwork.");
  invariant(raw.atomicArtworkCommit === true && raw.uiThreadApply === true,
    "Media runtime must promise atomic artwork commit and UI-thread apply.");
  invariant(raw.chunkRawBytes === MEDIA_CHUNK_RAW_BYTES,
    `Media runtime chunk size must be ${MEDIA_CHUNK_RAW_BYTES} raw bytes.`);
  invariant(Array.isArray(raw.artworkFormats) && raw.artworkFormats.includes("rgb565-le"),
    "Media runtime must accept rgb565-le artwork.");
  return Object.freeze({
    protocol: raw.protocol,
    type: raw.type,
    deviceFamily: raw.deviceFamily,
    status: "ready",
    runtimeProof: raw.runtimeProof,
    metadata: true,
    artwork: true,
    atomicArtworkCommit: true,
    uiThreadApply: true,
    maxTextBytes: positiveInteger(raw.maxTextBytes, "maxTextBytes", 4096),
    maxArtworkWidth: positiveInteger(raw.maxArtworkWidth, "maxArtworkWidth", 512),
    maxArtworkHeight: positiveInteger(raw.maxArtworkHeight, "maxArtworkHeight", 512),
    maxArtworkBytes: positiveInteger(raw.maxArtworkBytes, "maxArtworkBytes", MEDIA_MAX_ARTWORK_BYTES),
    chunkRawBytes: raw.chunkRawBytes,
    artworkFormats: Object.freeze(["rgb565-le"]),
    hardwareAccess: raw.hardwareAccess === true,
  });
}

export function negotiateMediaCapabilities(hello, rawCapabilities) {
  validateMediaHostHello(hello);
  const capabilities = normalizeMediaCapabilities(rawCapabilities);
  if (capabilities.status === "blocked") return capabilities;
  invariant(capabilities.chunkRawBytes === hello.chunkRawBytes,
    "Media host/runtime chunk sizes did not negotiate exactly.");
  invariant(hello.artworkFormats.some((format) => capabilities.artworkFormats.includes(format)),
    "Media host/runtime have no common artwork format.");
  return capabilities;
}

export function createMediaMetadataPayload(snapshot, capabilities) {
  const normalized = normalizeTransportSnapshot(snapshot, { maxTextBytes: capabilities.maxTextBytes });
  const buckets = new Map();
  for (let offset = 0; offset < normalized.albumArt.pixels.length; offset += 4) {
    const r = normalized.albumArt.pixels[offset];
    const g = normalized.albumArt.pixels[offset + 1];
    const b = normalized.albumArt.pixels[offset + 2];
    const alpha = normalized.albumArt.pixels[offset + 3];
    if (alpha < 128) continue;
    const key = `${r >> 4}:${g >> 4}:${b >> 4}`;
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    bucket.count += 1;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    buckets.set(key, bucket);
  }
  const colors = [...buckets.values()].map((bucket) => ({
    count: bucket.count,
    r: Math.round(bucket.r / bucket.count),
    g: Math.round(bucket.g / bucket.count),
    b: Math.round(bucket.b / bucket.count),
  }));
  const chromatic = colors.filter(({ r, g, b }) => Math.max(r, g, b) - Math.min(r, g, b) >= 24);
  const candidates = chromatic.length > 0 ? chromatic : colors;
  candidates.sort((left, right) => right.count - left.count ||
    (Math.max(right.r, right.g, right.b) - Math.min(right.r, right.g, right.b)) -
      (Math.max(left.r, left.g, left.b) - Math.min(left.r, left.g, left.b)));
  const accent = candidates[0] ?? { r: 24, g: 48, b: 72 };
  const accentColor = deepAccentHex(accent);
  return Object.freeze({
    song_title: normalized.title,
    artist: normalized.artist,
    elapsed: Math.floor(normalized.positionMs / 1000),
    total_duration: Math.ceil(normalized.durationMs / 1000),
    is_playing: normalized.isPlaying,
    accent_color: accentColor,
  });
}

function metadataPatch(previousPayload, currentPayload) {
  if (!previousPayload) return currentPayload;
  return Object.freeze(Object.fromEntries(Object.entries(currentPayload).filter(
    ([key, value]) => previousPayload[key] !== value,
  )));
}

export function createMetadataMessage(snapshot, capabilities, generation, previousSnapshot = null) {
  positiveInteger(generation, "generation");
  const currentPayload = createMediaMetadataPayload(snapshot, capabilities);
  const previousPayload = previousSnapshot
    ? createMediaMetadataPayload(previousSnapshot, capabilities)
    : null;
  const payload = metadataPatch(previousPayload, currentPayload);
  const body = {
    protocol: MEDIA_TRANSPORT_PROTOCOL,
    type: "media-metadata",
    generation,
    screenId: MEDIA_TRANSPORT_SCREEN_ID,
    payload,
  };
  return Object.freeze({ ...body, fullPayloadSha256: mediaSha256(currentPayload), sha256: mediaSha256(body) });
}

export function createStoppedMetadataMessage(capabilities, generation) {
  positiveInteger(generation, "generation");
  const payload = Object.freeze({
    song_title: "",
    artist: "",
    elapsed: 0,
    total_duration: 0,
    is_playing: false,
  });
  const body = {
    protocol: MEDIA_TRANSPORT_PROTOCOL,
    type: "media-metadata",
    generation,
    screenId: MEDIA_TRANSPORT_SCREEN_ID,
    payload,
  };
  invariant(capabilities.maxTextBytes > 0, "Capabilities do not allow metadata text.");
  return Object.freeze({ ...body, sha256: mediaSha256(body) });
}

export function resizeRgbaNearest(albumArt, targetWidth, targetHeight) {
  const normalized = normalizeTransportSnapshot({
    title: "art",
    artist: "art",
    durationMs: 0,
    positionMs: 0,
    albumArt,
  }).albumArt;
  positiveInteger(targetWidth, "targetWidth", 512);
  positiveInteger(targetHeight, "targetHeight", 512);
  if (normalized.width === targetWidth && normalized.height === targetHeight) return normalized;
  const pixels = Buffer.alloc(targetWidth * targetHeight * 4);
  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = Math.min(normalized.height - 1, Math.floor(y * normalized.height / targetHeight));
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = Math.min(normalized.width - 1, Math.floor(x * normalized.width / targetWidth));
      const sourceOffset = (sourceY * normalized.width + sourceX) * 4;
      const targetOffset = (y * targetWidth + x) * 4;
      normalized.pixels.copy(pixels, targetOffset, sourceOffset, sourceOffset + 4);
    }
  }
  return Object.freeze({ format: "rgba8", width: targetWidth, height: targetHeight, pixels });
}

export function encodeRgb565Le(albumArt) {
  invariant(albumArt?.format === "rgba8", "Artwork encoder requires rgba8 input.");
  const expected = albumArt.width * albumArt.height * 4;
  invariant(albumArt.pixels?.length === expected, `Artwork encoder requires exactly ${expected} RGBA bytes.`);
  const output = Buffer.alloc(albumArt.width * albumArt.height * 2);
  for (let pixel = 0; pixel < albumArt.width * albumArt.height; pixel += 1) {
    const source = pixel * 4;
    const alpha = albumArt.pixels[source + 3];
    const r = Math.round(albumArt.pixels[source] * alpha / 255);
    const g = Math.round(albumArt.pixels[source + 1] * alpha / 255);
    const b = Math.round(albumArt.pixels[source + 2] * alpha / 255);
    const rgb565 = ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
    output.writeUInt16LE(rgb565, pixel * 2);
  }
  return output;
}

export function createArtworkTransaction(snapshot, capabilities, generation) {
  positiveInteger(generation, "generation");
  const normalized = normalizeTransportSnapshot(snapshot, { maxTextBytes: capabilities.maxTextBytes });
  const width = Math.min(normalized.albumArt.width, capabilities.maxArtworkWidth);
  const height = Math.min(normalized.albumArt.height, capabilities.maxArtworkHeight);
  const resized = resizeRgbaNearest(normalized.albumArt, width, height);
  const pixels = encodeRgb565Le(resized);
  invariant(pixels.length <= capabilities.maxArtworkBytes,
    `RGB565 artwork exceeds runtime budget ${capabilities.maxArtworkBytes}.`);
  const artworkSha256 = mediaSha256(pixels);
  const transactionBody = {
    protocol: MEDIA_TRANSPORT_PROTOCOL,
    generation,
    screenId: MEDIA_TRANSPORT_SCREEN_ID,
    format: "rgb565-le",
    width,
    height,
    totalBytes: pixels.length,
    sha256: artworkSha256,
    chunkRawBytes: MEDIA_CHUNK_RAW_BYTES,
  };
  const transactionId = mediaSha256(transactionBody);
  const totalChunks = Math.ceil(pixels.length / MEDIA_CHUNK_RAW_BYTES);
  const manifest = Object.freeze({
    ...transactionBody,
    type: "artwork-begin",
    transactionId,
    totalChunks,
  });
  const chunks = Object.freeze(Array.from({ length: totalChunks }, (_, index) => {
    const offset = index * MEDIA_CHUNK_RAW_BYTES;
    const bytes = pixels.subarray(offset, Math.min(pixels.length, offset + MEDIA_CHUNK_RAW_BYTES));
    const data = bytes.toString("base64");
    invariant(data.length <= MEDIA_CHUNK_BASE64_CHARS,
      `Artwork chunk ${index} exceeds ${MEDIA_CHUNK_BASE64_CHARS} base64 characters.`);
    return Object.freeze({
      protocol: MEDIA_TRANSPORT_PROTOCOL,
      type: "artwork-chunk",
      generation,
      transactionId,
      index,
      offset,
      size: pixels.length,
      bytes: bytes.length,
      data,
      sha256: mediaSha256(bytes),
    });
  }));
  const commit = Object.freeze({
    protocol: MEDIA_TRANSPORT_PROTOCOL,
    type: "artwork-commit",
    generation,
    transactionId,
    totalBytes: pixels.length,
    totalChunks,
    sha256: artworkSha256,
  });
  return Object.freeze({ manifest, chunks, commit, pixels });
}
