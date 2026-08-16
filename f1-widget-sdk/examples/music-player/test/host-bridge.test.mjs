import assert from "node:assert/strict";
import test from "node:test";

import { encodeRgbaPng } from "../src/png.mjs";
import { BlockedFramerRuntimeSink, FRAMER_MEDIA_RUNTIME_BLOCKER } from "../src/framer-runtime-sink.mjs";
import { HostMediaBridge } from "../src/host-bridge.mjs";
import {
  buildInputMediaProbeExpression,
  decodeArtworkRgba,
  findActiveAppleMusicTrack,
  findActiveYouTubeMusicTab,
  findAppleCatalogArtwork,
  findLatestYouTubeMusicVideo,
  findYouTubeMusicOEmbed,
  InputLocalhostMediaAdapter,
  makeFallbackAlbumArt,
  parseInputMediaRecord,
} from "../src/input-localhost-adapter.mjs";

function media({ positionMs = 1000 } = {}) {
  return {
    title: "Track, Part: Two",
    artist: "Artist, Guest",
    durationMs: 60_000,
    positionMs,
    albumArt: makeFallbackAlbumArt("Track, Part: Two", "Artist, Guest", { side: 8 }),
  };
}

test("Input record parser preserves commas and colons inside known field values", () => {
  const fields = parseInputMediaRecord(
    "app_name:spotify, song_name:Track, Part: Two, song_artist:Artist, Guest, " +
    "total_duration:60, elapsed:12.5, artwork_url:https://example.test/art.png, playback_status:1\n",
  );
  assert.equal(fields.get("app_name"), "spotify");
  assert.equal(fields.get("song_name"), "Track, Part: Two");
  assert.equal(fields.get("song_artist"), "Artist, Guest");
  assert.equal(fields.get("artwork_url"), "https://example.test/art.png");
});

test("localhost probe is bounded and contains no device discovery or RPC", () => {
  const expression = buildInputMediaProbeExpression({ timeoutMs: 1200, maxOutputBytes: 4096 });
  assert.match(expression, /\/usr\/bin\/osascript/u);
  assert.match(expression, /maxBuffer: 4096/u);
  assert.match(expression, /Input media provider hash mismatch/u);
  assert.match(expression, /1d3262dff8bdf70b1b3140ab7ac556f622783d21d1c05ba0bb4ec6302f555090/u);
  assert.doesNotMatch(expression, /WLDevice|HID|serial|sendRpcCall|mp\.write|fs\.write/u);
});

test("Input localhost adapter returns real contract shape through an injected CDP evaluator", async () => {
  let observedExpression;
  const adapter = new InputLocalhostMediaAdapter({
    evaluate: async (expression, options) => {
      observedExpression = { expression, options };
      return {
        stdout: "app_name:apple_music, song_name:Blue Hour, song_artist:Night Drive, " +
          "total_duration:240, elapsed:102.25, artwork_data:AQID, playback_status:1\n",
        stderr: "",
      };
    },
    decodeArtwork: async (bytes, { side }) => {
      assert.deepEqual(bytes, Buffer.from([1, 2, 3]));
      return { format: "rgba8", width: side, height: side, pixels: Buffer.alloc(side * side * 4, 255) };
    },
    artworkSide: 4,
  });
  const result = await adapter.getCurrentMedia();
  assert.equal(observedExpression.options.port, 9230);
  assert.match(observedExpression.expression, /media-info-retriever\.scpt/u);
  assert.equal(result.title, "Blue Hour");
  assert.equal(result.artist, "Night Drive");
  assert.equal(result.durationMs, 240_000);
  assert.equal(result.positionMs, 102_250);
  assert.equal(result.isPlaying, true);
  assert.equal(result.albumArt.pixels.length, 4 * 4 * 4);
  assert.equal(result.provenance.transport, "input-localhost-cdp");
  assert.equal(result.provenance.hardwareAccess, false);
});

test("adapter returns null for Input's unknown provider and deterministic fallback without art", async () => {
  const unknown = new InputLocalhostMediaAdapter({
    evaluate: async () => ({ stdout: "app_name:unknown\n", stderr: "" }),
  });
  assert.equal(await unknown.getCurrentMedia(), null);

  const noArt = new InputLocalhostMediaAdapter({
    evaluate: async () => ({
      stdout: "app_name:media_remote, song_name:Broadcast, song_artist:Station, " +
        "total_duration:0, elapsed:-1, playback_status:1\n",
      stderr: "",
    }),
    findActiveAppleTrack: async () => null,
    findActiveYouTubeTab: async () => null,
    findYouTubeVideo: async () => null,
    findAppleArtwork: async () => null,
    artworkSide: 8,
  });
  const first = await noArt.getCurrentMedia();
  const second = await noArt.getCurrentMedia();
  assert.equal(first.positionMs, 0);
  assert.equal(first.albumArt.pixels.length, 8 * 8 * 4);
  assert.deepEqual(first.albumArt.pixels, second.albumArt.pixels);
  assert.equal(first.provenance.artworkSource, "generated-fallback");
});

test("Apple Music probe reads exact playing metadata through the absolute system app", async () => {
  const calls = [];
  const track = await findActiveAppleMusicTrack({ exec: async (command, args, options) => {
    calls.push({ command, args, options });
    return { stdout: JSON.stringify({ state: "playing", title: "The Heart of Life",
      artist: "John Mayer", duration: 199.07899475097656, position: 43.763999938964844 }) };
  } });
  assert.equal(calls[0].command, "/usr/bin/osascript");
  assert.match(calls[0].args.at(-1), /\/System\/Applications\/Music\.app/u);
  assert.deepEqual(track, { title: "The Heart of Life", artist: "John Mayer",
    durationMs: 199_079, positionMs: 43_764, isPlaying: true });
});

test("Chrome probe selects exactly one real-app YouTube Music watch tab without page JavaScript", async () => {
  const calls = [];
  const tab = await findActiveYouTubeMusicTab({ exec: async (command, args, options) => {
    calls.push({ command, args, options });
    return { stdout: JSON.stringify([
      { windowIndex: 0, url: "https://example.test/", title: "Other" },
      { windowIndex: 1, tabIndex: 4, url: "https://music.youtube.com/watch?v=fF2O7S-drfA",
        title: "Current mix" },
    ]) };
  } });
  assert.equal(calls[0].command, "/usr/bin/osascript");
  assert.deepEqual(calls[0].args.slice(0, 2), ["-l", "JavaScript"]);
  assert.match(calls[0].args.at(-1), /\/Applications\/Google Chrome\.app/u);
  assert.match(calls[0].args.at(-1), /window\.tabs\(\)/u);
  assert.doesNotMatch(calls[0].args.at(-1), /execute\s*\(/u);
  assert.equal(tab.url, "https://music.youtube.com/watch?v=fF2O7S-drfA");
  assert.equal(tab.videoId, "fF2O7S-drfA");
  assert.equal(tab.windowIndex, 1);
  assert.equal(tab.tabIndex, 4);

  const ambiguous = await findActiveYouTubeMusicTab({ exec: async () => ({ stdout: JSON.stringify([
    { url: "https://music.youtube.com/watch?v=fF2O7S-drfA" },
    { url: "https://music.youtube.com/watch?v=Zndgoac6R3o" },
  ]) }) });
  assert.equal(ambiguous, null);
});

test("Chrome History fallback resolves the current YouTube Music video without opening the browser database", async () => {
  const calls = [];
  const video = await findLatestYouTubeMusicVideo({
    title: "Spring (It's a Big World Outside)",
    chromeRoot: "/mock/chrome",
    readDirectory: async () => [{ name: "Profile 1", isDirectory: () => true }],
    exec: async (command, args) => {
      calls.push({ command, args });
      return { stdout: JSON.stringify([{ last_visit_time: 42,
        title: "Spring (It's a Big World Outside) | YouTube Music",
        url: "https://music.youtube.com/watch?v=FO9WXi9gxQg&list=PLtest" }]) };
    },
  });
  assert.equal(video.videoId, "FO9WXi9gxQg");
  assert.equal(calls[0].command, "/usr/bin/sqlite3");
  assert.match(calls[0].args[1], /immutable=1/u);
});

test("MediaRemote fallback fetches YouTube art and locally advances a stale provider timeline", async () => {
  let now = 10_000;
  const decoded = { format: "rgba8", width: 4, height: 4, pixels: Buffer.alloc(64, 255) };
  const source = new InputLocalhostMediaAdapter({
    clock: () => now,
    evaluate: async () => ({ stdout: "app_name:media_remote, song_name:Cloud Country, " +
      "song_artist:Lewie G, total_duration:93, elapsed:12, playback_status:1\n", stderr: "" }),
    findActiveAppleTrack: async () => null,
    findActiveYouTubeTab: async () => ({ videoId: "PqknQK7-jHU" }),
    findYouTubeVideo: async () => ({ videoId: "PqknQK7-jHU" }),
    findYouTubeMetadata: async () => ({ title: "Cloud Country", artist: "Lewie G",
      videoId: "PqknQK7-jHU", thumbnailUrl: "https://i.ytimg.com/vi/PqknQK7-jHU/hqdefault.jpg" }),
    fetchImpl: async (url) => ({ ok: true, url: String(url), headers: { get: () => "3" },
      arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer }),
    decodeArtwork: async (bytes) => {
      assert.deepEqual(Buffer.from(bytes), Buffer.from([1, 2, 3]));
      return decoded;
    },
    artworkSide: 4,
  });
  const first = await source.getCurrentMedia();
  now += 2_000;
  const second = await source.getCurrentMedia();
  assert.equal(first.positionMs, 12_000);
  assert.equal(second.positionMs, 14_000);
  assert.equal(second.provenance.artworkSource, "youtube-music-oembed-thumbnail");
  assert.equal(second.provenance.metadataSource, "youtube-music-live-tab-oembed");
});

test("active Chrome YouTube Music overrides queued MediaRemote text while preserving live time", async () => {
  const decoded = { format: "rgba8", width: 8, height: 8, pixels: Buffer.alloc(8 * 8 * 4, 31) };
  const source = new InputLocalhostMediaAdapter({
    clock: () => 2_000_000_000_000,
    evaluate: async () => ({ stdout: "app_name:media_remote, " +
      "song_name:128 - Dark Wasteland - (Pokémon Mystery Dungeon - Explorers of Sky), " +
      "song_artist:Shinx, total_duration:228, elapsed:21, playback_status:1\n", stderr: "" }),
    findActiveAppleTrack: async () => null,
    findActiveYouTubeTab: async () => ({
      url: "https://music.youtube.com/watch?v=fF2O7S-drfA", title: "Stardew Valley OST",
      windowIndex: 0, tabIndex: 2, videoId: "fF2O7S-drfA",
    }),
    findYouTubeVideo: async () => { throw new Error("History is not an activity signal."); },
    findYouTubeMetadata: async ({ videoId }) => {
      assert.equal(videoId, "fF2O7S-drfA");
      return { videoId, title: "Stardew Valley OST - A Dark Corner Of The Past", artist: "Lewie G",
        thumbnailUrl: "https://i.ytimg.com/vi/fF2O7S-drfA/hqdefault.jpg", durationMs: 228_000 };
    },
    fetchImpl: async (url) => ({ ok: true, url: String(url), headers: { get: () => "3" },
      arrayBuffer: async () => Uint8Array.from([4, 5, 6]).buffer }),
    decodeArtwork: async () => decoded,
    findAppleArtwork: async () => { throw new Error("Apple fallback must not run for verified YouTube."); },
    artworkSide: 8,
  });
  const current = await source.getCurrentMedia();
  assert.equal(current.title, "Stardew Valley OST - A Dark Corner Of The Past");
  assert.equal(current.artist, "Lewie G");
  assert.equal(current.durationMs, 228_000);
  assert.equal(current.positionMs, 21_000);
  assert.equal(current.albumArt, decoded);
  assert.equal(current.provenance.metadataSource, "youtube-music-live-tab-oembed");
  assert.equal(current.provenance.artworkSource, "youtube-music-oembed-thumbnail");
});

test("playing Apple Music takes precedence over a stale Chrome tab during an app switch", async () => {
  const youtubeArt = { format: "rgba8", width: 8, height: 8, pixels: Buffer.alloc(256, 12) };
  const appleArt = { format: "rgba8", width: 8, height: 8, pixels: Buffer.alloc(256, 91) };
  let poll = 0;
  let chromeCalls = 0;
  const source = new InputLocalhostMediaAdapter({
    evaluate: async () => ({ stdout: "app_name:media_remote, song_name:Queued item, " +
      "song_artist:Queued artist, total_duration:65, elapsed:8, playback_status:1\n", stderr: "" }),
    findActiveAppleTrack: async () => poll++ === 0 ? null : ({ title: "The Heart of Life",
      artist: "John Mayer", durationMs: 199_079, positionMs: 43_764, isPlaying: true }),
    findActiveYouTubeTab: async () => {
      chromeCalls += 1;
      return { videoId: "Zndgoac6R3o" };
    },
    findYouTubeMetadata: async () => ({ videoId: "Zndgoac6R3o",
      title: "Stardew Valley OST - Grandpa's Theme", artist: "Lewie G",
      thumbnailUrl: "https://i.ytimg.com/vi/Zndgoac6R3o/hqdefault.jpg", durationMs: 65_000 }),
    fetchImpl: async (url) => ({ ok: true, url: String(url), headers: { get: () => "3" },
      arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer }),
    decodeArtwork: async () => youtubeArt,
    findAppleArtwork: async ({ title, artist }) => {
      assert.deepEqual({ title, artist }, { title: "The Heart of Life", artist: "John Mayer" });
      return { albumArt: appleArt };
    },
    artworkSide: 8,
  });
  const chrome = await source.getCurrentMedia();
  const apple = await source.getCurrentMedia();
  assert.equal(chrome.title, "Stardew Valley OST - Grandpa's Theme");
  assert.equal(apple.title, "The Heart of Life");
  assert.equal(apple.artist, "John Mayer");
  assert.equal(apple.durationMs, 199_079);
  assert.equal(apple.positionMs, 43_764);
  assert.equal(apple.provenance.provider, "apple_music_jxa");
  assert.equal(apple.provenance.metadataSource, "apple-music-jxa");
  assert.equal(apple.provenance.artworkSource, "apple-catalog-artwork");
  assert.equal(apple.albumArt, appleArt);
  assert.equal(chromeCalls, 1, "stale Chrome must not be consulted after Music.app reports playing");
});

test("YouTube transition duration mismatch yields transient inactivity instead of queued metadata", async () => {
  const decoded = { format: "rgba8", width: 8, height: 8, pixels: Buffer.alloc(256, 44) };
  let metadataCalls = 0;
  let artworkFetches = 0;
  const source = new InputLocalhostMediaAdapter({
    evaluate: async () => ({ stdout: "app_name:media_remote, song_name:Queued Pokémon, " +
      "song_artist:Shinx, total_duration:227.5, elapsed:21, playback_status:1\n", stderr: "" }),
    findActiveAppleTrack: async () => null,
    findActiveYouTubeTab: async () => ({ videoId: "fF2O7S-drfA" }),
    findYouTubeMetadata: async () => {
      metadataCalls += 1;
      return { videoId: "fF2O7S-drfA", title: "A Dark Corner Of The Past",
        artist: "Lewie G", thumbnailUrl: "https://i.ytimg.com/vi/fF2O7S-drfA/hqdefault.jpg",
        durationMs: 59_000 };
    },
    fetchImpl: async (url) => {
      artworkFetches += 1;
      return { ok: true, url: String(url), headers: { get: () => "3" },
        arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer };
    },
    decodeArtwork: async () => decoded,
    artworkSide: 8,
  });
  assert.equal(await source.getCurrentMedia(), null);
  assert.equal(source.lastProbeStatus.reason, "youtube-transition-duration-mismatch");
  const accepted = await source.getCurrentMedia();
  assert.equal(accepted.title, "A Dark Corner Of The Past");
  assert.equal(accepted.durationMs, 59_000);
  assert.equal(accepted.positionMs, 0);
  assert.equal(accepted.albumArt, decoded);
  const cached = await source.getCurrentMedia();
  assert.equal(cached.albumArt, decoded);
  assert.equal(metadataCalls, 1, "immutable oEmbed metadata should be cached by video ID");
  assert.equal(artworkFetches, 1, "immutable decoded artwork should be cached by track identity");
});

test("bounded YouTube oEmbed returns exact title, author, and HTTPS thumbnail", async () => {
  const result = await findYouTubeMusicOEmbed({
    videoId: "fF2O7S-drfA",
    fetchImpl: async (url) => {
      const parsed = new URL(url);
      const isOEmbed = parsed.pathname === "/oembed";
      if (isOEmbed) assert.equal(parsed.searchParams.get("url"),
        "https://www.youtube.com/watch?v=fF2O7S-drfA");
      const bytes = isOEmbed ? Buffer.from(JSON.stringify({
        title: "Stardew Valley OST - A Dark Corner Of The Past", author_name: "Lewie G",
        thumbnail_url: "https://i.ytimg.com/vi/fF2O7S-drfA/hqdefault.jpg",
      })) : Buffer.from('{"videoDetails":{"lengthSeconds":"228"}}');
      return { ok: true, url: String(url), headers: { get: () => String(bytes.length) },
        arrayBuffer: async () => bytes };
    },
  });
  assert.equal(result.title, "Stardew Valley OST - A Dark Corner Of The Past");
  assert.equal(result.artist, "Lewie G");
  assert.equal(result.durationMs, 228_000);
  assert.match(result.thumbnailUrl, /fF2O7S-drfA/u);
});

test("Apple catalog artwork selects exact normalized title and artist then upgrades the cover URL", async () => {
  const calls = [];
  const decoded = { format: "rgba8", width: 80, height: 80, pixels: Buffer.alloc(80 * 80 * 4, 77) };
  const catalog = { resultCount: 3, results: [
    { trackName: "From the Dining Table", artistName: "Wrong Artist",
      artworkUrl100: "https://is1-ssl.mzstatic.com/image/thumb/wrong/100x100bb.jpg" },
    { trackName: "From the Dining Table", artistName: "Harry Styles", collectionName: "Harry Styles",
      artworkUrl100: "https://is1-ssl.mzstatic.com/image/thumb/right/100x100bb.jpg" },
    { trackName: "Other", artistName: "Harry Styles",
      artworkUrl100: "https://is1-ssl.mzstatic.com/image/thumb/other/100x100bb.jpg" },
  ] };
  const result = await findAppleCatalogArtwork({
    title: "From the Dining Table",
    artist: "HARRY STYLES",
    fetchImpl: async (url) => {
      calls.push(String(url));
      const bytes = calls.length === 1 ? Buffer.from(JSON.stringify(catalog)) : Buffer.from([9, 8, 7]);
      return { ok: true, url: String(url), headers: { get: () => String(bytes.length) },
        arrayBuffer: async () => bytes };
    },
    decodeArtwork: async (bytes, { side }) => {
      assert.deepEqual(Buffer.from(bytes), Buffer.from([9, 8, 7]));
      assert.equal(side, 80);
      return decoded;
    },
  });
  const search = new URL(calls[0]);
  assert.equal(search.origin + search.pathname, "https://itunes.apple.com/search");
  assert.equal(search.searchParams.get("term"), "From the Dining Table HARRY STYLES");
  assert.equal(search.searchParams.get("entity"), "song");
  assert.equal(search.searchParams.get("limit"), "8");
  assert.match(calls[1], /\/right\/600x600bb\.jpg$/u);
  assert.equal(result.albumArt, decoded);
  assert.equal(result.trackName, "From the Dining Table");
  assert.equal(result.artistName, "Harry Styles");
});

test("Apple catalog artwork returns null for mismatches, network failures, and oversized responses", async () => {
  let calls = 0;
  const mismatch = await findAppleCatalogArtwork({
    title: "Wanted",
    artist: "Exact Artist",
    fetchImpl: async (url) => {
      calls += 1;
      const bytes = Buffer.from(JSON.stringify({ results: [{ trackName: "Different",
        artistName: "Exact Artist", artworkUrl100: "https://example.test/100x100bb.jpg" }] }));
      return { ok: true, url: String(url), headers: { get: () => String(bytes.length) },
        arrayBuffer: async () => bytes };
    },
  });
  assert.equal(mismatch, null);
  assert.equal(calls, 1, "a mismatched catalog result must never trigger an artwork download");
  assert.equal(await findAppleCatalogArtwork({ title: "Wanted", artist: "Exact Artist",
    fetchImpl: async () => { throw new Error("offline"); } }), null);
  assert.equal(await findAppleCatalogArtwork({ title: "Wanted", artist: "Exact Artist",
    maxCatalogBytes: 1024, fetchImpl: async (url) => ({ ok: true, url: String(url),
      headers: { get: () => "2048" }, arrayBuffer: async () => new ArrayBuffer(0) }) }), null);
});

test("MediaRemote uses Apple catalog art after YouTube recovery misses", async () => {
  const decoded = { format: "rgba8", width: 8, height: 8, pixels: Buffer.alloc(8 * 8 * 4, 99) };
  const source = new InputLocalhostMediaAdapter({
    evaluate: async () => ({ stdout: "app_name:media_remote, song_name:From the Dining Table, " +
      "song_artist:Harry Styles, total_duration:211, elapsed:4, playback_status:1\n", stderr: "" }),
    findActiveAppleTrack: async () => null,
    findActiveYouTubeTab: async () => null,
    findYouTubeVideo: async () => null,
    findAppleArtwork: async ({ title, artist, side }) => {
      assert.deepEqual({ title, artist, side },
        { title: "From the Dining Table", artist: "Harry Styles", side: 8 });
      return { albumArt: decoded };
    },
    artworkSide: 8,
  });
  const current = await source.getCurrentMedia();
  assert.equal(current.albumArt, decoded);
  assert.equal(current.provenance.artworkSource, "apple-catalog-artwork");
});

test("repo-pinned Jimp decodes compressed art to exact bounded RGBA8", async () => {
  const png = encodeRgbaPng(2, 1, Buffer.from([
    255, 0, 0, 255,
    0, 0, 255, 255,
  ]));
  const decoded = await decodeArtworkRgba(png, { side: 4 });
  assert.deepEqual({ format: decoded.format, width: decoded.width, height: decoded.height },
    { format: "rgba8", width: 4, height: 4 });
  assert.equal(decoded.pixels.length, 4 * 4 * 4);
});

test("bridge publishes once per update bucket and advances only after sink acceptance", async () => {
  let current = media({ positionMs: 1000 });
  const published = [];
  const bridge = new HostMediaBridge({
    source: { getCurrentMedia: async () => current },
    sink: { publish: async (transaction) => {
      published.push(transaction);
      return { accepted: true };
    } },
  });
  const first = await bridge.poll();
  assert.equal(first.status, "published");
  assert.equal(first.generation, 1);
  const unchanged = await bridge.poll();
  assert.equal(unchanged.status, "unchanged");
  current = media({ positionMs: 2000 });
  const second = await bridge.poll();
  assert.equal(second.generation, 2);
  assert.equal(published.length, 2);
  assert.equal(published[0].bundle.manifest.logicalCanvas.width, 100);
  assert.equal(published[0].bundle.manifest.logicalCanvas.height, 310);
});

test("current Framer sink blocks before I/O and rejected delivery does not advance generation", async () => {
  const bridge = new HostMediaBridge({
    source: { getCurrentMedia: async () => media() },
    sink: new BlockedFramerRuntimeSink(),
  });
  const first = await bridge.poll();
  const second = await bridge.poll();
  assert.equal(first.accepted, false);
  assert.equal(first.status, "BLOCKED_BEFORE_DEVICE_IO");
  assert.equal(first.generation, 1);
  assert.equal(second.generation, 1);
  assert.equal(first.blocker.code, "NO_PROVEN_FRAMER_MEDIA_RUNTIME_ADAPTER");
  assert.equal(FRAMER_MEDIA_RUNTIME_BLOCKER.hardwareAccess, false);
  assert.deepEqual(FRAMER_MEDIA_RUNTIME_BLOCKER.inputNomadMethods,
    ["mp.write_info", "mp.write_artwork", "mp.fetch_data"]);
});
