import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { initMediaProject } from "../src/media-scaffold.mjs";
import { runMediaCli } from "../src/media-transport/cli.mjs";
import { runCli } from "../src/cli.mjs";
import {
  BlockedMediaRuntimeSink,
  createArtworkTransaction,
  createMediaHostHello,
  FramerMediaRuntimeSink,
  InputLocalhostMediaSource,
  InputWlrpcMediaTransport,
  LIVE_PROVEN_FRAMER_MEDIA_HANDLERS,
  MEDIA_CHUNK_BASE64_CHARS,
  MEDIA_CHUNK_RAW_BYTES,
  mediaSha256,
  MediaTransportSession,
  MockMediaRuntimeSink,
  negotiateMediaCapabilities,
  isAcceptedFramerMediaResponse,
} from "../src/media-transport/index.mjs";
import { LIVE_MEDIA_PROOF_ID, parseLiveMediaArguments, runLiveMedia } from
  "../examples/music-player/tools/run-live-media.mjs";

function artwork(seed = 1) {
  const width = 80;
  const height = 80;
  const pixels = Buffer.alloc(width * height * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels[offset] = (offset + seed) & 0xff;
    pixels[offset + 1] = (offset / 2 + seed * 3) & 0xff;
    pixels[offset + 2] = 170;
    pixels[offset + 3] = 255;
  }
  return { format: "rgba8", width, height, pixels };
}

function snapshot({ positionMs = 0, title = "Night Drive", seed = 1 } = {}) {
  return { title, artist: "SDK Band", durationMs: 180_000, positionMs, isPlaying: true,
    albumArt: artwork(seed) };
}

test("capability handshake negotiates exact protocol and rejects drift", async () => {
  const hello = createMediaHostHello();
  const sink = new MockMediaRuntimeSink();
  const ready = negotiateMediaCapabilities(hello, await sink.handshake(hello));
  assert.equal(ready.status, "ready");
  assert.equal(ready.runtimeProof, "mock");
  assert.equal(ready.chunkRawBytes, 3072);
  assert.throws(() => negotiateMediaCapabilities({ ...hello, chunkRawBytes: 2048 }, ready), /3072/u);
  assert.throws(() => negotiateMediaCapabilities(hello, { ...ready, protocol: "unknown" }), /protocol/u);
});

test("artwork uses Input-compatible 3072-byte chunks and verifies complete hash", async () => {
  const sink = new MockMediaRuntimeSink();
  const capabilities = await sink.handshake(createMediaHostHello());
  const transaction = createArtworkTransaction(snapshot(), capabilities, 1);
  assert.equal(transaction.pixels.length, 80 * 80 * 2);
  assert.equal(transaction.manifest.chunkRawBytes, MEDIA_CHUNK_RAW_BYTES);
  assert.deepEqual(transaction.chunks.map(({ bytes }) => bytes), [3072, 3072, 3072, 3072, 512]);
  assert.ok(transaction.chunks.every(({ data }) => data.length <= MEDIA_CHUNK_BASE64_CHARS));
  const reconstructed = Buffer.concat(transaction.chunks.map(({ data }) => Buffer.from(data, "base64")));
  assert.deepEqual(reconstructed, transaction.pixels);
  assert.equal(mediaSha256(reconstructed), transaction.commit.sha256);
});

test("1Hz session diffs metadata fields and sends artwork only when its hash changes", async () => {
  let current = snapshot();
  const sink = new MockMediaRuntimeSink();
  const session = new MediaTransportSession({ source: { getCurrentMedia: async () => current }, sink,
    allowMockRuntime: true });
  assert.equal(session.pollIntervalMs, 1000);
  const first = await session.pollOnce();
  assert.deepEqual(Object.keys(sink.metadata[0].payload),
    ["song_title", "artist", "elapsed", "total_duration", "is_playing", "accent_color"]);
  current = snapshot({ positionMs: 1000 });
  const second = await session.pollOnce();
  assert.equal(second.artwork, false);
  assert.deepEqual(sink.metadata[1].payload, { elapsed: 1 });
  const unchanged = await session.pollOnce();
  assert.equal(unchanged.status, "unchanged");
  current = snapshot({ positionMs: 1000, title: "Next Track", seed: 2 });
  const nextTrack = await session.pollOnce();
  assert.equal(nextTrack.artwork, true);
  assert.equal(sink.metadata[2].payload.song_title, "Next Track");
  assert.match(sink.metadata[2].payload.accent_color, /^#[0-9a-f]{6}$/u);
  assert.equal(sink.committedArtwork.length, 2);
  assert.throws(() => new MediaTransportSession({ source: { getCurrentMedia: async () => current }, sink,
    pollIntervalMs: 999 }), /1000\.\.60000/u);
});

test("media inspect reports a bounded provider timeout as inactive but preserves transport errors", async () => {
  const timedOutSource = new InputLocalhostMediaSource({
    evaluate: async () => ({
      stdout: "",
      stderr: "",
      status: "no-active-media",
      reason: "provider-timeout",
      timeoutMs: 8000,
    }),
  });
  assert.equal(await timedOutSource.getCurrentMedia(), null);
  assert.deepEqual(timedOutSource.lastProbeStatus, {
    status: "no-active-media",
    reason: "provider-timeout",
    timeoutMs: 8000,
  });

  const lines = [];
  const io = { log: (line) => lines.push(JSON.parse(line)) };
  await runMediaCli(["inspect", "--port", "9230"], io, { sourceFactory: () => ({
    lastProbeStatus: { reason: "provider-timeout", timeoutMs: 8000 },
    getCurrentMedia: async () => null,
  }) });
  assert.deepEqual(lines[0], {
    status: "no-active-media",
    reason: "provider-timeout",
    providerTimeoutMs: 8000,
    hardwareAccess: false,
  });
  await assert.rejects(runMediaCli(["inspect"], io, { sourceFactory: () => ({
    getCurrentMedia: async () => { throw new Error("Input debugger socket failed"); },
  }) }), /debugger socket failed/u);
});

test("top-level CLI imports and dispatches hardware-free media status and mock commands", async () => {
  const output = [];
  const io = { log: (line) => output.push(JSON.parse(line)) };
  assert.equal(await runCli(["media", "status"], io), 0);
  assert.equal(await runCli(["media", "mock"], io), 0);
  assert.equal(output[0].hostSource, "READY_INPUT_LOCALHOST_MEDIA_PROVIDER");
  assert.equal(output[0].devicePublishing.status, "available-with-explicit-live-proof");
  assert.deepEqual(output[0].devicePublishing.proofIds, [LIVE_MEDIA_PROOF_ID]);
  assert.equal(output[1].status, "published");
  assert.equal(output[1].artworkChunks, 5);
  assert.ok(output.every(({ hardwareAccess }) => hardwareAccess === false));
});

test("session publishes stopped state once and requires explicit mock opt-in", async () => {
  let current = snapshot();
  const sink = new MockMediaRuntimeSink();
  const refused = new MediaTransportSession({ source: { getCurrentMedia: async () => current }, sink });
  await assert.rejects(refused.pollOnce(), /Refusing mock/u);
  const session = new MediaTransportSession({ source: { getCurrentMedia: async () => current },
    sink: new MockMediaRuntimeSink(), allowMockRuntime: true, inactiveGraceMs: 0 });
  await session.pollOnce();
  current = null;
  assert.equal((await session.pollOnce()).status, "published-stopped");
  assert.equal((await session.pollOnce()).status, "no-active-media");
});

test("transient provider inactivity retains the last track and freezes it paused for eight seconds", async () => {
  let now = 10_000;
  let current = snapshot({ title: "Keep Me", isPlaying: true });
  const sink = new MockMediaRuntimeSink();
  const session = new MediaTransportSession({ source: { getCurrentMedia: async () => current }, sink,
    allowMockRuntime: true, inactiveGraceMs: 8000, clock: () => now });
  await session.pollOnce();
  current = null;
  assert.deepEqual(await session.pollOnce(), {
    status: "retained-transient-inactive", generation: 2, inactiveForMs: 0, graceMs: 8000,
    metadata: true, artwork: false,
  });
  assert.deepEqual(sink.metadata[1].payload, { is_playing: false });
  now += 7999;
  assert.equal((await session.pollOnce()).status, "retained-transient-inactive");
  assert.equal(sink.metadata.length, 2, "a YouTube track gap must not clear title/artist");
  now += 1;
  assert.equal((await session.pollOnce()).status, "published-stopped");
  assert.equal(sink.metadata.length, 3);
});

test("rejected metadata does not advance generation or accepted snapshot", async () => {
  const sink = new MockMediaRuntimeSink({ reject: "metadata" });
  const session = new MediaTransportSession({ source: { getCurrentMedia: async () => snapshot() }, sink,
    allowMockRuntime: true });
  await assert.rejects(session.pollOnce(), /metadata rejected/u);
  assert.equal(session.nextGeneration, 1);
  assert.equal(session.previousSnapshot, null);
  sink.reject = null;
  assert.equal((await session.pollOnce()).generation, 1);
});

test("unknown Framer proof IDs remain blocked before any transport I/O", async () => {
  assert.equal(LIVE_PROVEN_FRAMER_MEDIA_HANDLERS.length, 1);
  assert.equal(LIVE_PROVEN_FRAMER_MEDIA_HANDLERS[0].id, LIVE_MEDIA_PROOF_ID);
  assert.equal(LIVE_PROVEN_FRAMER_MEDIA_HANDLERS[0].app.sha256,
    "b9b8eec6250392f593ae664fa8b8cba64bf861f5ef49a427c65be79e6f355817");
  assert.equal(LIVE_PROVEN_FRAMER_MEDIA_HANDLERS[0].receipt.id, "device-1786895154649");
  const receiptBytes = await readFile(new URL(
    "../build/device-receipts/device-1786895154649-fast-smoke.json", import.meta.url));
  assert.equal(mediaSha256(receiptBytes), LIVE_PROVEN_FRAMER_MEDIA_HANDLERS[0].receipt.sha256);
  assert.equal(JSON.parse(receiptBytes).app.sha256, LIVE_PROVEN_FRAMER_MEDIA_HANDLERS[0].app.sha256);
  const blocked = new MediaTransportSession({ source: { getCurrentMedia: async () => {
    throw new Error("source must not be polled");
  } }, sink: new BlockedMediaRuntimeSink() });
  assert.equal((await blocked.pollOnce()).status, "blocked");

  const calls = [];
  const sink = new FramerMediaRuntimeSink({ proofId: "user-asserted-is-not-proof", transport: {
    negotiate: async (...args) => { calls.push(["negotiate", ...args]); return {}; },
    rpc: async (...args) => { calls.push(["rpc", ...args]); return { accepted: true }; },
  } });
  const session = new MediaTransportSession({ source: { getCurrentMedia: async () => snapshot() }, sink });
  const result = await session.pollOnce();
  assert.equal(result.status, "blocked");
  assert.deepEqual(calls, []);
  await assert.rejects(sink.publishMetadata({}), /NO_LIVE_PROVEN/u);
});

test("Input WLRPC transport performs one bounded evaluateInInput call per RPC and unwraps stock response", async () => {
  const calls = [];
  const transport = new InputWlrpcMediaTransport({ port: 9230, evaluate: async (expression, options) => {
    calls.push({ expression, options });
    return { target: { deviceFamily: "knob_f1", firmware: "0.4.1", usb: true },
      response: { result: { status: "ok" } } };
  } });
  assert.deepEqual(await transport.rpc("mp.write_info", { song_title: "quote: \"safe\"" }), { status: "ok" });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].options, { port: 9230, timeoutMs: 30_000 });
  assert.match(calls[0].expression, /Expected exactly one USB Framer F1/u);
  assert.doesNotMatch(calls[0].expression, /quote:/u,
    "RPC params must be embedded as base64, never executable source text");
  await assert.rejects(transport.rpc("mp.erase", {}), /Unsupported/u);
  assert.equal(calls.length, 1);
});

test("pinned live proof enables exact Framer methods while runner remains explicit opt-in", async () => {
  const calls = [];
  const transport = {
    negotiate: async () => ({ protocol: "framer-host-media-v1", type: "device-capabilities",
      deviceFamily: "knob_f1", status: "ready", runtimeProof: "live-proven", metadata: true,
      artwork: true, atomicArtworkCommit: true, uiThreadApply: true, maxTextBytes: 63,
      maxArtworkWidth: 80, maxArtworkHeight: 80, maxArtworkBytes: 12800,
      chunkRawBytes: 3072, artworkFormats: ["rgb565-le"], hardwareAccess: true }),
    rpc: async (method, params) => { calls.push({ method, params }); return { status: "ok" }; },
  };
  const session = new MediaTransportSession({ source: { getCurrentMedia: async () => snapshot() },
    sink: new FramerMediaRuntimeSink({ transport, proofId: LIVE_MEDIA_PROOF_ID }) });
  assert.equal((await session.pollOnce()).status, "published");
  assert.deepEqual(calls.map(({ method }) => method),
    ["mp.write_artwork", "mp.write_artwork", "mp.write_artwork", "mp.write_artwork",
      "mp.write_artwork", "mp.write_info"]);
  assert.throws(() => parseLiveMediaArguments([]), /--confirm-live-rpc/u);
  const output = [];
  const fakeSession = { pollOnce: async () => ({ status: "unchanged", generation: 1 }), stop() {} };
  await runLiveMedia(["--confirm-live-rpc", "--once"], { log: (line) => output.push(JSON.parse(line)) },
    { session: fakeSession });
  assert.equal(output[0].proofId, LIVE_MEDIA_PROOF_ID);
  assert.equal(output[0].hardwareAccess, true);
});

test("Framer sink expands metadata diffs to full snapshots and commits cache only after acceptance", async () => {
  const writes = [];
  let reject = false;
  const transport = {
    negotiate: async () => ({ protocol: "framer-host-media-v1", type: "device-capabilities",
      deviceFamily: "knob_f1", status: "ready", runtimeProof: "live-proven", metadata: true,
      artwork: true, atomicArtworkCommit: true, uiThreadApply: true, maxTextBytes: 63,
      maxArtworkWidth: 80, maxArtworkHeight: 80, maxArtworkBytes: 12800,
      chunkRawBytes: 3072, artworkFormats: ["rgb565-le"], hardwareAccess: true }),
    rpc: async (method, params) => { writes.push({ method, params }); return { status: reject ? "error" : "ok" }; },
  };
  const sink = new FramerMediaRuntimeSink({ transport, proofId: LIVE_MEDIA_PROOF_ID });
  await sink.handshake(createMediaHostHello());
  const full = { song_title: "Track", artist: "Artist", elapsed: 0, total_duration: 200,
    is_playing: true, accent_color: "#123456" };
  assert.equal((await sink.publishMetadata({ payload: full, sha256: "one" })).accepted, true);
  assert.equal((await sink.publishMetadata({ payload: { elapsed: 1 }, sha256: "two" })).accepted, true);
  assert.deepEqual(writes[1].params, { ...full, elapsed: 1 });

  reject = true;
  assert.equal((await sink.publishMetadata({ payload: { artist: "Rejected" }, sha256: "three" })).accepted, false);
  reject = false;
  assert.equal((await sink.publishMetadata({ payload: { is_playing: false }, sha256: "four" })).accepted, true);
  assert.deepEqual(writes[3].params, { ...full, elapsed: 1, is_playing: false },
    "a rejected field must not advance the accepted full-snapshot cache");

  await sink.publishMetadata({ payload: { song_title: "", artist: "", elapsed: 0,
    total_duration: 0, is_playing: false }, sha256: "stopped" });
  assert.deepEqual(writes[4].params, { song_title: "", artist: "", elapsed: 0,
    total_duration: 0, is_playing: false, accent_color: "#000000" });
  assert.equal(sink.metadataState, null);
});

test("Framer artwork rejection or RPC failure clears host inflight state for retry", async () => {
  let behavior = "reject";
  const transport = {
    negotiate: async () => ({ protocol: "framer-host-media-v1", type: "device-capabilities",
      deviceFamily: "knob_f1", status: "ready", runtimeProof: "live-proven", metadata: true,
      artwork: true, atomicArtworkCommit: true, uiThreadApply: true, maxTextBytes: 63,
      maxArtworkWidth: 80, maxArtworkHeight: 80, maxArtworkBytes: 12800,
      chunkRawBytes: 3072, artworkFormats: ["rgb565-le"], hardwareAccess: true }),
    rpc: async () => {
      if (behavior === "throw") throw new Error("temporary device busy");
      return { status: behavior === "reject" ? "error" : "ok" };
    },
  };
  const sink = new FramerMediaRuntimeSink({ transport, proofId: LIVE_MEDIA_PROOF_ID });
  const capabilities = await sink.handshake(createMediaHostHello());
  const transaction = createArtworkTransaction(snapshot(), capabilities, 1);

  await sink.beginArtwork(transaction.manifest);
  assert.equal((await sink.writeArtworkChunk(transaction.chunks[0])).accepted, false);
  assert.equal(sink.inflight, null, "a rejected device chunk must not poison the next host transaction");

  behavior = "throw";
  await sink.beginArtwork(transaction.manifest);
  await assert.rejects(sink.writeArtworkChunk(transaction.chunks[0]), /temporary device busy/u);
  assert.equal(sink.inflight, null, "an RPC exception must not poison the next host transaction");

  behavior = "ok";
  await sink.beginArtwork(transaction.manifest);
  assert.equal((await sink.writeArtworkChunk(transaction.chunks[0])).accepted, true);
  await sink.abortArtwork(transaction.manifest);
  assert.equal(sink.inflight, null);
});

test("session aborts sink artwork state after any rejected publish stage", async () => {
  let aborted = 0;
  const base = new MockMediaRuntimeSink({ reject: "chunk:0" });
  const sink = {
    handshake: (...args) => base.handshake(...args),
    beginArtwork: (...args) => base.beginArtwork(...args),
    writeArtworkChunk: (...args) => base.writeArtworkChunk(...args),
    commitArtwork: (...args) => base.commitArtwork(...args),
    publishMetadata: (...args) => base.publishMetadata(...args),
    abortArtwork: async (manifest) => { aborted += 1; await base.abortArtwork(manifest); },
  };
  const session = new MediaTransportSession({ source: { getCurrentMedia: async () => snapshot() },
    sink, allowMockRuntime: true });
  await assert.rejects(session.pollOnce(), /artwork chunk 0 rejected/u);
  assert.equal(aborted, 1);
  assert.equal(base.inflight.size, 0);
});

test("Framer response adapter accepts the stock status-ok ABI and legacy mock acknowledgments", () => {
  assert.equal(isAcceptedFramerMediaResponse({ status: "ok" }), true);
  assert.equal(isAcceptedFramerMediaResponse({ accepted: true }), true);
  assert.equal(isAcceptedFramerMediaResponse({ status: "error" }), false);
  assert.equal(isAcceptedFramerMediaResponse({}), false);
});

test("init-media scaffolds a runnable project with safe default Input sink", async (context) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "f1-media-scaffold-test-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const project = path.join(temporary, "album-widget");
  await initMediaProject(project);
  const module = await import(`${pathToFileURL(path.join(project, "src/session.mjs")).href}?test=1`);
  const { session, sink } = module.createMockSession();
  assert.equal((await session.pollOnce()).artwork, true);
  assert.equal((await session.pollOnce()).artwork, false);
  assert.equal(sink.committedArtwork[0].manifest.chunkRawBytes, 3072);
  assert.equal((await module.createInputSession().pollOnce()).status, "blocked");
  const spec = JSON.parse(await readFile(path.join(project, "media-project.json"), "utf8"));
  assert.equal(spec.source.pollIntervalMs, 1000);
  assert.equal(spec.runtime.sink, "blocked-until-live-proof");
  await assert.rejects(initMediaProject(project), /Refusing to overwrite/u);
});
