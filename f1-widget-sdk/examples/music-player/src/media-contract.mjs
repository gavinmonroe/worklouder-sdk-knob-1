import { createHash } from "node:crypto";

export const LOGICAL_CANVAS = Object.freeze({ width: 100, height: 310 });
export const MEDIA_SNAPSHOT_CONTRACT = "host-media-snapshot-v1";

function invariant(value, message) {
  if (!value) throw new Error(message);
}

function boundedText(value, field) {
  invariant(typeof value === "string", `${field} must be a string.`);
  const result = value.trim();
  invariant(result.length > 0 && result.length <= 256, `${field} must contain 1..256 characters.`);
  return result;
}

function integer(value, field) {
  invariant(Number.isSafeInteger(value), `${field} must be a safe integer.`);
  return value;
}

function bytePixels(value, expectedBytes) {
  const pixels = Buffer.isBuffer(value) ? Buffer.from(value) :
    value instanceof Uint8Array ? Buffer.from(value.buffer, value.byteOffset, value.byteLength) : null;
  invariant(pixels && pixels.length === expectedBytes,
    `albumArt.pixels must be exactly ${expectedBytes} RGBA8 bytes.`);
  return Buffer.from(pixels);
}

export function normalizeMediaSnapshot(raw) {
  invariant(raw && typeof raw === "object", "Media adapter must return an object.");
  const title = boundedText(raw.title, "title");
  const artist = boundedText(raw.artist, "artist");
  const durationMs = integer(raw.durationMs, "durationMs");
  const rawPositionMs = integer(raw.positionMs, "positionMs");
  invariant(durationMs >= 0, "durationMs cannot be negative.");
  const positionMs = Math.max(0, Math.min(rawPositionMs, durationMs));
  const progress = durationMs === 0 ? 0 : positionMs / durationMs;
  const width = integer(raw.albumArt?.width, "albumArt.width");
  const height = integer(raw.albumArt?.height, "albumArt.height");
  invariant(raw.albumArt?.format === "rgba8", "albumArt.format must be rgba8.");
  invariant(width > 0 && width <= 4096 && height > 0 && height <= 4096,
    "albumArt dimensions must be 1..4096 pixels.");
  const pixels = bytePixels(raw.albumArt.pixels, width * height * 4);
  return Object.freeze({
    contract: MEDIA_SNAPSHOT_CONTRACT,
    title,
    artist,
    durationMs,
    positionMs,
    progress,
    progressPermille: Math.round(progress * 1000),
    albumArt: Object.freeze({ format: "rgba8", width, height, pixels }),
  });
}

function chroma({ r, g, b }) {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

function colorHex({ r, g, b }) {
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

export function extractMainAlbumColor(albumArt) {
  invariant(albumArt?.format === "rgba8", "Album art must be normalized RGBA8.");
  const buckets = new Map();
  let acceptedPixels = 0;
  for (let offset = 0; offset < albumArt.pixels.length; offset += 4) {
    const [r, g, b, alpha] = albumArt.pixels.subarray(offset, offset + 4);
    if (alpha < 128) continue;
    acceptedPixels += 1;
    const key = `${r >> 4}:${g >> 4}:${b >> 4}`;
    const bucket = buckets.get(key) ?? { key, count: 0, r: 0, g: 0, b: 0 };
    bucket.count += 1;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    buckets.set(key, bucket);
  }
  invariant(acceptedPixels > 0, "Album art has no sufficiently opaque pixels.");
  const colors = [...buckets.values()].map((bucket) => ({
    ...bucket,
    r: Math.round(bucket.r / bucket.count),
    g: Math.round(bucket.g / bucket.count),
    b: Math.round(bucket.b / bucket.count),
  }));
  const chromatic = colors.filter((color) => chroma(color) >= 24);
  const chromaticPopulation = chromatic.reduce((sum, color) => sum + color.count, 0);
  const candidates = chromaticPopulation >= Math.max(1, Math.ceil(acceptedPixels * 0.05)) ? chromatic : colors;
  candidates.sort((left, right) => right.count - left.count || chroma(right) - chroma(left) ||
    left.key.localeCompare(right.key));
  const winner = candidates[0];
  return Object.freeze({ r: winner.r, g: winner.g, b: winner.b, hex: colorHex(winner),
    population: winner.count, opaquePixels: acceptedPixels,
    algorithm: "quantized-chromatic-dominant-v1" });
}

export function mediaUpdateKey(snapshot, { progressBucketMs = 1000 } = {}) {
  invariant(Number.isSafeInteger(progressBucketMs) && progressBucketMs > 0,
    "progressBucketMs must be a positive integer.");
  const artHash = createHash("sha256").update(snapshot.albumArt.pixels).digest("hex");
  const progressBucket = Math.floor(snapshot.positionMs / progressBucketMs);
  return createHash("sha256").update(JSON.stringify({
    title: snapshot.title,
    artist: snapshot.artist,
    durationMs: snapshot.durationMs,
    artHash,
    progressBucket,
  })).digest("hex");
}

export function planHostUpdate(previousKey, snapshot, options) {
  const updateKey = mediaUpdateKey(snapshot, options);
  return Object.freeze({
    changed: previousKey !== updateKey,
    previousKey: previousKey ?? null,
    updateKey,
    reason: previousKey === updateKey ? "same-track-and-progress-bucket" : "media-frame-changed",
  });
}
