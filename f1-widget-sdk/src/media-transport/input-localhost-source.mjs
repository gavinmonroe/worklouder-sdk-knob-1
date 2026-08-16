import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { readdir } from "node:fs/promises";
import { promisify } from "node:util";

import { evaluateInInput } from "../../../framer-widgets/lib/input-inspector.mjs";

export const DEFAULT_INPUT_DEBUG_PORT = 9230;
export const DEFAULT_INPUT_MEDIA_SCRIPT =
  "/Applications/input.app/Contents/Resources/scripts/media-info-retriever.scpt";
export const INPUT_MEDIA_SCRIPT_SHA256 =
  "1d3262dff8bdf70b1b3140ab7ac556f622783d21d1c05ba0bb4ec6302f555090";
export const INPUT_MEDIA_PROBE_STATUS = Object.freeze({
  active: "active-media",
  inactive: "no-active-media",
});

const MEDIA_KEYS = Object.freeze([
  "app_name",
  "song_name",
  "song_artist",
  "total_duration",
  "elapsed",
  "artwork_url",
  "artwork_data",
  "playback_status",
  "error_code",
]);
const MEDIA_KEY_SET = new Set(MEDIA_KEYS);
const DEFAULT_ARTWORK_SIDE = 80;
const DEFAULT_MAX_APPLESCRIPT_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_ARTWORK_BYTES = 6 * 1024 * 1024;
const DEFAULT_MAX_APPLE_CATALOG_BYTES = 512 * 1024;
const DEFAULT_MAX_YOUTUBE_OEMBED_BYTES = 256 * 1024;
const DEFAULT_MAX_YOUTUBE_WATCH_BYTES = 2 * 1024 * 1024;
const DEFAULT_YOUTUBE_HISTORY_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const execFileAsync = promisify(execFile);

function invariant(value, message) {
  if (!value) throw new Error(message);
}

function boundedInteger(value, field, minimum, maximum) {
  invariant(Number.isSafeInteger(value) && value >= minimum && value <= maximum,
    `${field} must be an integer in ${minimum}..${maximum}.`);
  return value;
}

function boundedString(value, field, maximum = 4096) {
  invariant(typeof value === "string", `${field} must be a string.`);
  invariant(Buffer.byteLength(value, "utf8") <= maximum, `${field} exceeds ${maximum} UTF-8 bytes.`);
  return value;
}

function normalizedText(value, fallback) {
  const text = typeof value === "string" ? value.trim() : "";
  return (text || fallback).slice(0, 256);
}

function secondsToMilliseconds(value, field, { unknownAsZero = false } = {}) {
  const seconds = Number(value);
  if (unknownAsZero && (!Number.isFinite(seconds) || seconds < 0)) return 0;
  invariant(Number.isFinite(seconds) && seconds >= 0, `${field} must be a non-negative number of seconds.`);
  const milliseconds = Math.round(seconds * 1000);
  invariant(Number.isSafeInteger(milliseconds), `${field} is outside the safe millisecond range.`);
  return milliseconds;
}

/**
 * Builds one constant, hardware-free CDP evaluation. It only launches Input's
 * packaged media AppleScript and returns its stdout; it never loads the device
 * SDK, performs discovery, or opens HID/serial.
 */
export function buildInputMediaProbeExpression({
  scriptPath = DEFAULT_INPUT_MEDIA_SCRIPT,
  expectedScriptSha256 = INPUT_MEDIA_SCRIPT_SHA256,
  timeoutMs = 8_000,
  maxOutputBytes = DEFAULT_MAX_APPLESCRIPT_BYTES,
} = {}) {
  boundedString(scriptPath, "scriptPath", 1024);
  invariant(scriptPath.startsWith("/") && scriptPath.endsWith("/media-info-retriever.scpt"),
    "scriptPath must be an absolute media-info-retriever.scpt path.");
  invariant(typeof expectedScriptSha256 === "string" && /^[0-9a-f]{64}$/u.test(expectedScriptSha256),
    "expectedScriptSha256 must be a lowercase SHA-256 digest.");
  boundedInteger(timeoutMs, "timeoutMs", 250, 30_000);
  boundedInteger(maxOutputBytes, "maxOutputBytes", 1024, 16 * 1024 * 1024);

  return `(async () => {
    const { execFile } = process.getBuiltinModule("node:child_process");
    const { createHash } = process.getBuiltinModule("node:crypto");
    const { readFile } = process.getBuiltinModule("node:fs/promises");
    const scriptPath = ${JSON.stringify(scriptPath)};
    const scriptHash = createHash("sha256").update(await readFile(scriptPath)).digest("hex");
    if (scriptHash !== ${JSON.stringify(expectedScriptSha256)}) {
      throw new Error("Input media provider hash mismatch: " + scriptHash);
    }
    const result = await new Promise((resolve, reject) => {
      execFile("/usr/bin/osascript", [scriptPath], {
        encoding: "utf8",
        timeout: ${timeoutMs},
        maxBuffer: ${maxOutputBytes}
      }, (error, stdout, stderr) => {
        if (error) {
          const timedOut = error.killed === true || error.signal === "SIGTERM" || error.code === "ETIMEDOUT";
          if (timedOut && !(stdout || "").trim()) {
            resolve({
              stdout: "",
              stderr: stderr || "",
              status: "no-active-media",
              reason: "provider-timeout",
              timeoutMs: ${timeoutMs}
            });
            return;
          }
          reject(new Error("Input media provider failed: " + (stderr || error.message)));
          return;
        }
        resolve({ stdout, stderr, status: "ok" });
      });
    });
    return result;
  })()`;
}

/**
 * Parses AppleScript's record text while allowing commas and colons in titles.
 * A new field begins only at one of Input's known record keys.
 */
export function parseInputMediaRecord(output) {
  boundedString(output, "Input media output", DEFAULT_MAX_APPLESCRIPT_BYTES);
  const fields = new Map();
  const marker = /(?:^|,\s*)([a-z_]+):/g;
  const matches = [...output.trim().matchAll(marker)].filter((match) => MEDIA_KEY_SET.has(match[1]));
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const start = match.index + match[0].length;
    const end = matches[index + 1]?.index ?? output.trim().length;
    fields.set(match[1], output.trim().slice(start, end).trim());
  }
  return fields;
}

function decodeBase64Artwork(value, maxArtworkBytes) {
  invariant(typeof value === "string" && value.length > 0, "artwork_data must be non-empty base64.");
  invariant(value.length <= Math.ceil(maxArtworkBytes / 3) * 4 + 4,
    `artwork_data exceeds the ${maxArtworkBytes}-byte compressed limit.`);
  invariant(/^[A-Za-z0-9+/]*={0,2}$/u.test(value), "artwork_data is not canonical base64 text.");
  const bytes = Buffer.from(value, "base64");
  invariant(bytes.length > 0 && bytes.length <= maxArtworkBytes,
    `Decoded artwork must contain 1..${maxArtworkBytes} bytes.`);
  return bytes;
}

async function readBoundedResponse(response, maxArtworkBytes) {
  invariant(response?.ok === true, `Artwork download returned HTTP ${response?.status ?? "unknown"}.`);
  if (response.url) invariant(new URL(response.url).protocol === "https:", "Artwork redirect must remain HTTPS.");
  const declaredLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > 0) {
    invariant(declaredLength <= maxArtworkBytes,
      `Artwork Content-Length exceeds the ${maxArtworkBytes}-byte limit.`);
  }

  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.length;
      if (total > maxArtworkBytes) {
        await reader.cancel?.();
        throw new Error(`Artwork response exceeds the ${maxArtworkBytes}-byte limit.`);
      }
      chunks.push(chunk);
    }
    invariant(total > 0, "Artwork response is empty.");
    return Buffer.concat(chunks, total);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  invariant(bytes.length > 0 && bytes.length <= maxArtworkBytes,
    `Artwork response must contain 1..${maxArtworkBytes} bytes.`);
  return bytes;
}

async function downloadArtwork(url, { fetchImpl, maxArtworkBytes, timeoutMs }) {
  invariant(typeof fetchImpl === "function", "An HTTPS fetch implementation is required for artwork URLs.");
  const parsed = new URL(url);
  invariant(parsed.protocol === "https:", "Input artwork_url must use HTTPS.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("Artwork download timed out.")), timeoutMs);
  try {
    const response = await fetchImpl(parsed, { signal: controller.signal, redirect: "follow" });
    return await readBoundedResponse(response, maxArtworkBytes);
  } finally {
    clearTimeout(timeout);
  }
}

const ACTIVE_CHROME_TABS_JXA = String.raw`const chrome = Application("/Applications/Google Chrome.app");
JSON.stringify(chrome.running() ? chrome.windows().flatMap((window, windowIndex) =>
  window.tabs().map((tab, tabIndex) => ({
    windowIndex, tabIndex, url: String(tab.url()), title: String(tab.title())
  }))) : []);`;

const ACTIVE_APPLE_MUSIC_JXA = String.raw`const music = Application("/System/Applications/Music.app");
if (!music.running() || String(music.playerState()) !== "playing") JSON.stringify(null);
else {
  const track = music.currentTrack();
  JSON.stringify({
    state: "playing",
    title: String(track.name()),
    artist: String(track.artist()),
    duration: Number(track.duration()),
    position: Number(music.playerPosition())
  });
}`;

export async function findActiveAppleMusicTrack({ exec = execFileAsync } = {}) {
  try {
    const { stdout } = await exec("/usr/bin/osascript", ["-l", "JavaScript", "-e", ACTIVE_APPLE_MUSIC_JXA], {
      encoding: "utf8", timeout: 1500, maxBuffer: 64 * 1024,
    });
    boundedString(stdout, "Apple Music probe output", 64 * 1024);
    const record = JSON.parse(stdout || "null");
    if (record?.state !== "playing") return null;
    const title = normalizedText(record.title, "");
    const artist = normalizedText(record.artist, "");
    const durationMs = secondsToMilliseconds(record.duration, "Apple Music duration");
    const positionMs = Math.min(secondsToMilliseconds(record.position, "Apple Music position"), durationMs);
    if (!title || !artist || durationMs <= 0) return null;
    return Object.freeze({ title, artist, durationMs, positionMs, isPlaying: true });
  } catch {
    return null;
  }
}

export async function findActiveYouTubeMusicTab({ exec = execFileAsync } = {}) {
  try {
    const { stdout } = await exec("/usr/bin/osascript", ["-l", "JavaScript", "-e", ACTIVE_CHROME_TABS_JXA], {
      encoding: "utf8", timeout: 1500, maxBuffer: 64 * 1024,
    });
    boundedString(stdout, "Chrome active-tab output", 64 * 1024);
    const tabs = JSON.parse(stdout || "[]");
    if (!Array.isArray(tabs)) return null;
    const candidates = [];
    for (const tab of tabs) {
      try {
        const url = new URL(tab?.url);
        if (url.protocol !== "https:" || url.hostname !== "music.youtube.com" || url.pathname !== "/watch") continue;
        const videoId = url.searchParams.get("v");
        if (typeof videoId !== "string" || !/^[A-Za-z0-9_-]{11}$/u.test(videoId)) continue;
        candidates.push(Object.freeze({
          url: url.href,
          title: normalizedText(tab?.title, "YouTube Music"),
          windowIndex: Number.isSafeInteger(tab?.windowIndex) ? tab.windowIndex : null,
          tabIndex: Number.isSafeInteger(tab?.tabIndex) ? tab.tabIndex : null,
          videoId,
        }));
      } catch {
        // Ignore malformed tab records and continue to another Chrome window.
      }
    }
    return candidates.length === 1 ? candidates[0] : null;
  } catch {
    // Chrome absent, automation denied, or a timeout means no override.
  }
  return null;
}

export async function findLatestYouTubeMusicVideo({
  title,
  chromeRoot = join(homedir(), "Library/Application Support/Google/Chrome"),
  exec = execFileAsync,
  readDirectory = readdir,
  nowMs = Date.now(),
  maxAgeMs = null,
} = {}) {
  const requestedTitle = String(title || "").trim();
  const expectedTitle = requestedTitle ? `${requestedTitle} | YouTube Music` : null;
  let entries;
  try {
    entries = await readDirectory(chromeRoot, { withFileTypes: true });
  } catch {
    return null;
  }
  const profiles = entries.filter((entry) => entry.isDirectory() &&
    (entry.name === "Default" || /^Profile \d+$/u.test(entry.name)));
  const rows = [];
  for (const profile of profiles) {
    const history = join(chromeRoot, profile.name, "History");
    try {
      const { stdout } = await exec("/usr/bin/sqlite3", [
        "-json",
        `file:${history}?immutable=1`,
        "select url,title,last_visit_time from urls where url like 'https://music.youtube.com/watch%' " +
          "order by last_visit_time desc limit 24;",
      ], { encoding: "utf8", timeout: 1500, maxBuffer: 256 * 1024 });
      const parsed = JSON.parse(stdout || "[]");
      if (Array.isArray(parsed)) rows.push(...parsed);
    } catch {
      // A locked, missing, or non-Chrome profile is not fatal to MediaRemote.
    }
  }
  rows.sort((left, right) => Number(right.last_visit_time || 0) - Number(left.last_visit_time || 0));
  const row = expectedTitle
    ? rows.find((candidate) => candidate.title === expectedTitle) ??
      rows.find((candidate) => String(candidate.title || "").startsWith(requestedTitle))
    : rows[0];
  if (!row?.url) return null;
  try {
    const videoId = new URL(row.url).searchParams.get("v");
    if (!videoId || !/^[A-Za-z0-9_-]{11}$/u.test(videoId)) return null;
    const chromeTime = Number(row.last_visit_time);
    const visitedAtMs = Number.isFinite(chromeTime) && chromeTime > 0
      ? Math.round(chromeTime / 1000 - 11_644_473_600_000)
      : null;
    if (maxAgeMs !== null) {
      boundedInteger(maxAgeMs, "maxAgeMs", 1000, 24 * 60 * 60 * 1000);
      if (!Number.isFinite(visitedAtMs) || !Number.isFinite(nowMs) ||
          nowMs - visitedAtMs < -5 * 60 * 1000 || nowMs - visitedAtMs > maxAgeMs) return null;
    }
    return Object.freeze({ videoId, url: row.url, profileTitle: row.title, visitedAtMs });
  } catch {
    return null;
  }
}

export async function findYouTubeMusicOEmbed({
  videoId,
  fetchImpl = globalThis.fetch,
  maxResponseBytes = DEFAULT_MAX_YOUTUBE_OEMBED_BYTES,
  maxWatchPageBytes = DEFAULT_MAX_YOUTUBE_WATCH_BYTES,
  timeoutMs = 8_000,
} = {}) {
  if (typeof videoId !== "string" || !/^[A-Za-z0-9_-]{11}$/u.test(videoId)) return null;
  try {
    invariant(typeof fetchImpl === "function", "YouTube oEmbed lookup requires HTTPS fetch.");
    boundedInteger(maxResponseBytes, "maxResponseBytes", 1024, 2 * 1024 * 1024);
    boundedInteger(maxWatchPageBytes, "maxWatchPageBytes", 64 * 1024, 4 * 1024 * 1024);
    boundedInteger(timeoutMs, "timeoutMs", 250, 30_000);
    const url = new URL("https://www.youtube.com/oembed");
    url.searchParams.set("url", `https://www.youtube.com/watch?v=${videoId}`);
    url.searchParams.set("format", "json");
    const watchUrl = new URL(`https://www.youtube.com/watch?v=${videoId}`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("YouTube oEmbed lookup timed out.")), timeoutMs);
    let bytes;
    let watchBytes;
    try {
      [bytes, watchBytes] = await Promise.all([
        fetchImpl(url, { signal: controller.signal, redirect: "follow" })
          .then((response) => readBoundedResponse(response, maxResponseBytes)),
        fetchImpl(watchUrl, { signal: controller.signal, redirect: "follow" })
          .then((response) => readBoundedResponse(response, maxWatchPageBytes)).catch(() => null),
      ]);
    } finally {
      clearTimeout(timeout);
    }
    const record = JSON.parse(bytes.toString("utf8"));
    const title = normalizedText(record?.title, "");
    const artist = normalizedText(record?.author_name, "");
    const thumbnailUrl = new URL(record?.thumbnail_url);
    if (!title || !artist || thumbnailUrl.protocol !== "https:") return null;
    const lengthMatch = watchBytes?.toString("utf8").match(/"lengthSeconds":"(\d{1,9})"/u);
    const lengthSeconds = lengthMatch ? Number(lengthMatch[1]) : null;
    const durationMs = Number.isSafeInteger(lengthSeconds) && lengthSeconds > 0 && lengthSeconds <= 24 * 60 * 60
      ? lengthSeconds * 1000
      : null;
    return Object.freeze({ title, artist, thumbnailUrl: thumbnailUrl.href, videoId, durationMs });
  } catch {
    return null;
  }
}

function normalizeCatalogText(value) {
  return String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/gu, " ").trim().replace(/\s+/gu, " ");
}

function upgradedAppleArtworkUrl(value) {
  const url = new URL(value);
  invariant(url.protocol === "https:", "Apple catalog artwork must use HTTPS.");
  url.pathname = url.pathname.replace(/\/\d+x\d+bb(?=\.[A-Za-z0-9]+$)/u, "/600x600bb");
  return url;
}

export async function findAppleCatalogArtwork({
  title,
  artist,
  fetchImpl = globalThis.fetch,
  decodeArtwork = decodeArtworkRgba,
  side = DEFAULT_ARTWORK_SIDE,
  maxArtworkBytes = DEFAULT_MAX_ARTWORK_BYTES,
  maxCatalogBytes = DEFAULT_MAX_APPLE_CATALOG_BYTES,
  timeoutMs = 8_000,
} = {}) {
  const normalizedTitle = normalizeCatalogText(title);
  const normalizedArtist = normalizeCatalogText(artist);
  if (!normalizedTitle || !normalizedArtist) return null;
  try {
    invariant(typeof fetchImpl === "function", "Apple catalog lookup requires HTTPS fetch.");
    invariant(typeof decodeArtwork === "function", "Apple catalog lookup requires an artwork decoder.");
    boundedInteger(side, "artwork side", 1, 512);
    boundedInteger(maxArtworkBytes, "maxArtworkBytes", 1024, 16 * 1024 * 1024);
    boundedInteger(maxCatalogBytes, "maxCatalogBytes", 1024, 2 * 1024 * 1024);
    boundedInteger(timeoutMs, "timeoutMs", 250, 30_000);

    const searchUrl = new URL("https://itunes.apple.com/search");
    searchUrl.searchParams.set("term", `${String(title).trim()} ${String(artist).trim()}`);
    searchUrl.searchParams.set("entity", "song");
    searchUrl.searchParams.set("limit", "8");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("Apple catalog lookup timed out.")), timeoutMs);
    let response;
    try {
      response = await fetchImpl(searchUrl, { signal: controller.signal, redirect: "follow" });
      response = await readBoundedResponse(response, maxCatalogBytes);
    } finally {
      clearTimeout(timeout);
    }
    const catalog = JSON.parse(response.toString("utf8"));
    const results = Array.isArray(catalog?.results) ? catalog.results.slice(0, 8) : [];
    const ranked = results.map((entry, index) => {
      const titleExact = normalizeCatalogText(entry?.trackName) === normalizedTitle;
      const artistExact = normalizeCatalogText(entry?.artistName) === normalizedArtist;
      return { entry, index, titleExact, artistExact, score: (titleExact ? 2 : 0) + (artistExact ? 1 : 0) };
    }).filter(({ titleExact, artistExact, entry }) => titleExact && artistExact &&
      typeof entry?.artworkUrl100 === "string").sort((left, right) => right.score - left.score || left.index - right.index);
    const match = ranked[0]?.entry;
    if (!match) return null;

    const artworkUrl = upgradedAppleArtworkUrl(match.artworkUrl100);
    const compressed = await downloadArtwork(artworkUrl, { fetchImpl, maxArtworkBytes, timeoutMs });
    const albumArt = await decodeArtwork(compressed, { side });
    return Object.freeze({
      albumArt,
      artworkUrl: artworkUrl.href,
      trackName: match.trackName,
      artistName: match.artistName,
      collectionName: typeof match.collectionName === "string" ? match.collectionName : null,
    });
  } catch {
    return null;
  }
}

const requireFromExtractedInput = createRequire(
  new URL("../../../extracted/input-app/package.json", import.meta.url),
);

export async function decodeArtworkRgba(bytes, { side = DEFAULT_ARTWORK_SIDE } = {}) {
  boundedInteger(side, "artwork side", 1, 512);
  invariant(Buffer.isBuffer(bytes) || bytes instanceof Uint8Array,
    "Compressed artwork must be a Buffer or Uint8Array.");
  const { Jimp } = requireFromExtractedInput("jimp");
  const image = await Jimp.read(Buffer.from(bytes));
  // Preserve the cover's aspect ratio and crop its center instead of stretching
  // 16:9 YouTube thumbnails into a visibly distorted square.
  image.cover({ w: side, h: side });
  const pixels = Buffer.from(image.bitmap.data);
  invariant(image.bitmap.width === side && image.bitmap.height === side && pixels.length === side * side * 4,
    "Jimp did not produce the requested bounded RGBA8 artwork.");
  return Object.freeze({ format: "rgba8", width: side, height: side, pixels });
}

export function makeFallbackAlbumArt(title, artist, { side = DEFAULT_ARTWORK_SIDE } = {}) {
  boundedInteger(side, "artwork side", 1, 512);
  const digest = createHash("sha256").update(`${title}\n${artist}`).digest();
  const pixels = Buffer.alloc(side * side * 4);
  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      const offset = (y * side + x) * 4;
      const glow = Math.max(0, 1 - Math.hypot(x - side / 2, y - side / 2) / (side * 0.72));
      pixels[offset] = Math.round(8 + digest[0] * glow);
      pixels[offset + 1] = Math.round(12 + digest[1] * glow);
      pixels[offset + 2] = Math.round(24 + digest[2] * glow);
      pixels[offset + 3] = 255;
    }
  }
  return Object.freeze({ format: "rgba8", width: side, height: side, pixels });
}

export class InputLocalhostMediaSource {
  constructor({
    evaluate = evaluateInInput,
    port = DEFAULT_INPUT_DEBUG_PORT,
    scriptPath = DEFAULT_INPUT_MEDIA_SCRIPT,
    expectedScriptSha256 = INPUT_MEDIA_SCRIPT_SHA256,
    providerTimeoutMs = 8_000,
    debuggerTimeoutMs = 12_000,
    maxOutputBytes = DEFAULT_MAX_APPLESCRIPT_BYTES,
    maxArtworkBytes = DEFAULT_MAX_ARTWORK_BYTES,
    artworkTimeoutMs = 8_000,
    artworkSide = DEFAULT_ARTWORK_SIDE,
    clock = Date.now,
    fetchImpl = globalThis.fetch,
    decodeArtwork = decodeArtworkRgba,
    findActiveAppleTrack = findActiveAppleMusicTrack,
    findActiveYouTubeTab = findActiveYouTubeMusicTab,
    findYouTubeVideo = findLatestYouTubeMusicVideo,
    findYouTubeMetadata = findYouTubeMusicOEmbed,
    youtubeHistoryMaxAgeMs = DEFAULT_YOUTUBE_HISTORY_MAX_AGE_MS,
    findAppleArtwork = findAppleCatalogArtwork,
  } = {}) {
    invariant(typeof evaluate === "function", "evaluate must be a function.");
    boundedInteger(port, "port", 1, 65_535);
    boundedInteger(debuggerTimeoutMs, "debuggerTimeoutMs", 250, 30_000);
    boundedInteger(maxArtworkBytes, "maxArtworkBytes", 1024, 16 * 1024 * 1024);
    boundedInteger(artworkTimeoutMs, "artworkTimeoutMs", 250, 30_000);
    boundedInteger(artworkSide, "artworkSide", 1, 512);
    invariant(typeof decodeArtwork === "function", "decodeArtwork must be a function.");
    invariant(typeof findActiveAppleTrack === "function", "findActiveAppleTrack must be a function.");
    invariant(typeof findActiveYouTubeTab === "function", "findActiveYouTubeTab must be a function.");
    invariant(typeof findYouTubeVideo === "function", "findYouTubeVideo must be a function.");
    invariant(typeof findYouTubeMetadata === "function", "findYouTubeMetadata must be a function.");
    boundedInteger(youtubeHistoryMaxAgeMs, "youtubeHistoryMaxAgeMs", 1000, 24 * 60 * 60 * 1000);
    invariant(typeof findAppleArtwork === "function", "findAppleArtwork must be a function.");
    invariant(typeof clock === "function", "clock must be a function.");
    this.evaluate = evaluate;
    this.port = port;
    this.debuggerTimeoutMs = debuggerTimeoutMs;
    this.maxOutputBytes = maxOutputBytes;
    this.maxArtworkBytes = maxArtworkBytes;
    this.artworkTimeoutMs = artworkTimeoutMs;
    this.artworkSide = artworkSide;
    this.fetchImpl = fetchImpl;
    this.decodeArtwork = decodeArtwork;
    this.findActiveAppleTrack = findActiveAppleTrack;
    this.findActiveYouTubeTab = findActiveYouTubeTab;
    this.findYouTubeVideo = findYouTubeVideo;
    this.findYouTubeMetadata = findYouTubeMetadata;
    this.youtubeHistoryMaxAgeMs = youtubeHistoryMaxAgeMs;
    this.findAppleArtwork = findAppleArtwork;
    this.clock = clock;
    this.timeline = null;
    this.youtubeMetadataCache = null;
    this.youtubeTransition = null;
    this.artworkCache = null;
    this.lastProbeStatus = null;
    this.expression = buildInputMediaProbeExpression({
      scriptPath,
      expectedScriptSha256,
      timeoutMs: providerTimeoutMs,
      maxOutputBytes,
    });
  }

  async getCurrentMedia() {
    const result = await this.evaluate(this.expression, {
      port: this.port,
      timeoutMs: this.debuggerTimeoutMs,
    });
    invariant(result && typeof result === "object", "Input media probe returned no result object.");
    if (result.status === INPUT_MEDIA_PROBE_STATUS.inactive) {
      this.lastProbeStatus = Object.freeze({
        status: INPUT_MEDIA_PROBE_STATUS.inactive,
        reason: result.reason === "provider-timeout" ? "provider-timeout" : "provider-inactive",
        timeoutMs: Number.isSafeInteger(result.timeoutMs) ? result.timeoutMs : null,
      });
      return null;
    }
    const stdout = boundedString(result.stdout, "Input media stdout", this.maxOutputBytes);
    const fields = parseInputMediaRecord(stdout);
    if (fields.has("error_code")) throw new Error(`Input media provider error ${fields.get("error_code")}.`);
    const appName = fields.get("app_name");
    if (!appName || appName === "unknown") {
      this.lastProbeStatus = Object.freeze({
        status: INPUT_MEDIA_PROBE_STATUS.inactive,
        reason: appName === "unknown" ? "provider-inactive" : "empty-provider-output",
        timeoutMs: null,
      });
      return null;
    }
    invariant(fields.has("song_name") && fields.has("song_artist") && fields.has("total_duration"),
      "Input media provider omitted required metadata.");

    let title = normalizedText(fields.get("song_name"), "Untitled");
    let artist = normalizedText(fields.get("song_artist"), "Unknown Artist");
    let durationMs = secondsToMilliseconds(fields.get("total_duration"), "total_duration");
    let positionMs = secondsToMilliseconds(fields.get("elapsed"), "elapsed", { unknownAsZero: true });
    const playbackRate = Number(fields.get("playback_status"));
    let isPlaying = Number.isFinite(playbackRate) && playbackRate > 0;
    const now = this.clock();
    let providerName = appName;
    const activeApple = appName === "media_remote" ? await this.findActiveAppleTrack() : null;
    if (activeApple) {
      title = activeApple.title;
      artist = activeApple.artist;
      durationMs = activeApple.durationMs;
      positionMs = activeApple.positionMs;
      isPlaying = activeApple.isPlaying;
      providerName = "apple_music_jxa";
    }
    let youtubeOverride = null;
    if (appName === "media_remote" && !activeApple) {
      const activeTab = await this.findActiveYouTubeTab();
      const latest = activeTab?.videoId ? activeTab : null;
      if (latest?.videoId) {
        let metadata = this.youtubeMetadataCache?.videoId === latest.videoId
          ? this.youtubeMetadataCache.metadata
          : null;
        if (!metadata) {
          metadata = await this.findYouTubeMetadata({
            videoId: latest.videoId,
            fetchImpl: this.fetchImpl,
            timeoutMs: this.artworkTimeoutMs,
          });
          if (metadata) this.youtubeMetadataCache = Object.freeze({ videoId: latest.videoId, metadata });
        }
        if (metadata) {
          if (durationMs > 0 && metadata.durationMs > 0 && Math.abs(durationMs - metadata.durationMs) > 5_000) {
            const key = `${latest.videoId}:${metadata.durationMs}`;
            const samples = this.youtubeTransition?.key === key ? this.youtubeTransition.samples + 1 : 1;
            this.youtubeTransition = Object.freeze({ key, samples });
            if (samples < 2) {
              this.lastProbeStatus = Object.freeze({
                status: INPUT_MEDIA_PROBE_STATUS.inactive,
                reason: "youtube-transition-duration-mismatch",
                timeoutMs: null,
              });
              return null;
            }
            /* Two consecutive observations of the same live tab are stronger
             * evidence than stale MediaRemote duration. Publish the new track
             * from zero while the generic provider catches up. */
            durationMs = metadata.durationMs;
            positionMs = 0;
          } else {
            this.youtubeTransition = null;
          }
          youtubeOverride = Object.freeze({ ...latest, ...metadata });
          title = metadata.title;
          artist = metadata.artist;
        }
      } else this.youtubeTransition = null;
    } else {
      this.youtubeTransition = null;
    }
    const observedPositionMs = positionMs;
    const timelineKey = `${title}\n${artist}\n${durationMs}`;
    if (this.timeline?.key === timelineKey) {
      const elapsedWallMs = Math.max(0, now - this.timeline.at);
      const predictedMs = this.timeline.positionMs + (this.timeline.playing ? elapsedWallMs : 0);
      const providerMoved = Math.abs(positionMs - this.timeline.observedMs) >= 1500;
      positionMs = providerMoved ? positionMs : Math.max(positionMs, predictedMs);
    }
    positionMs = Math.min(positionMs, durationMs);
    this.timeline = Object.freeze({ key: timelineKey, at: now, observedMs: observedPositionMs,
    positionMs, playing: isPlaying });

    const artworkCacheKey = `${providerName}\n${title}\n${artist}\n${youtubeOverride?.thumbnailUrl ?? ""}`;
    let albumArt = this.artworkCache?.key === artworkCacheKey ? this.artworkCache.albumArt : null;
    let artworkSource = this.artworkCache?.key === artworkCacheKey
      ? this.artworkCache.artworkSource
      : "generated-fallback";
    try {
      let compressed;
      if (albumArt) {
        /* Immutable per-track artwork is reused across one-second timeline
         * polls; only a track identity change performs network/decode work. */
      } else if (fields.has("artwork_data")) {
        compressed = decodeBase64Artwork(fields.get("artwork_data"), this.maxArtworkBytes);
        artworkSource = "input-artwork-data";
      } else if (fields.has("artwork_url")) {
        compressed = await downloadArtwork(fields.get("artwork_url"), {
          fetchImpl: this.fetchImpl,
          maxArtworkBytes: this.maxArtworkBytes,
          timeoutMs: this.artworkTimeoutMs,
        });
        artworkSource = "input-artwork-url";
      } else if (appName === "media_remote") {
        if (youtubeOverride) {
          compressed = await downloadArtwork(youtubeOverride.thumbnailUrl, {
            fetchImpl: this.fetchImpl,
            maxArtworkBytes: this.maxArtworkBytes,
            timeoutMs: this.artworkTimeoutMs,
          });
          artworkSource = "youtube-music-oembed-thumbnail";
        } else {
          const apple = await this.findAppleArtwork({
            title,
            artist,
            fetchImpl: this.fetchImpl,
            decodeArtwork: this.decodeArtwork,
            side: this.artworkSide,
            maxArtworkBytes: this.maxArtworkBytes,
            timeoutMs: this.artworkTimeoutMs,
          });
          if (apple?.albumArt) {
            albumArt = apple.albumArt;
            artworkSource = "apple-catalog-artwork";
          }
        }
      }
      albumArt ??= compressed
        ? await this.decodeArtwork(compressed, { side: this.artworkSide })
        : makeFallbackAlbumArt(title, artist, { side: this.artworkSide });
    } catch {
      albumArt = makeFallbackAlbumArt(title, artist, { side: this.artworkSide });
      artworkSource = "generated-fallback-after-artwork-error";
    }
    if (!artworkSource.startsWith("generated-fallback")) {
      this.artworkCache = Object.freeze({ key: artworkCacheKey, albumArt, artworkSource });
    }

    this.lastProbeStatus = Object.freeze({
      status: INPUT_MEDIA_PROBE_STATUS.active,
      reason: "provider-returned-media",
      timeoutMs: null,
    });
    return {
      title,
      artist,
      durationMs,
      positionMs,
      isPlaying,
      albumArt,
      provenance: Object.freeze({
        transport: "input-localhost-cdp",
        provider: providerName,
        artworkSource,
        metadataSource: activeApple ? "apple-music-jxa" :
          youtubeOverride ? "youtube-music-live-tab-oembed" : "input-media-provider",
        hardwareAccess: false,
      }),
    };
  }
}

/* Compatibility alias retained for the original music-player example. */
export const InputLocalhostMediaAdapter = InputLocalhostMediaSource;
