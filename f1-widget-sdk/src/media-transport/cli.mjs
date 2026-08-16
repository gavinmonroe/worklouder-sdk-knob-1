import {
  InputLocalhostMediaSource,
  MEDIA_CHUNK_RAW_BYTES,
  MEDIA_TRANSPORT_PROTOCOL,
  mediaSha256,
  normalizeTransportSnapshot,
} from "./index.mjs";
import { FRAMER_MEDIA_PUBLISHING_BLOCKER, LIVE_PROVEN_FRAMER_MEDIA_HANDLERS,
  MockMediaRuntimeSink } from "./sinks.mjs";
import { MediaTransportSession } from "./session.mjs";

function parsePort(args) {
  if (args.length === 0) return 9230;
  if (args.length !== 2 || args[0] !== "--port") throw new Error("media inspect accepts only --port <number>.");
  const port = Number(args[1]);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error("--port must be 1..65535.");
  return port;
}

function mockMedia() {
  const width = 80;
  const height = 80;
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      pixels[offset] = 24 + Math.floor(x * 100 / width);
      pixels[offset + 1] = 44 + Math.floor(y * 90 / height);
      pixels[offset + 2] = 180;
      pixels[offset + 3] = 255;
    }
  }
  return {
    title: "Midnight Circuit",
    artist: "Static Bloom",
    durationMs: 240_000,
    positionMs: 102_000,
    isPlaying: true,
    albumArt: { format: "rgba8", width, height, pixels },
  };
}

export async function runMediaCli(args, io = console, { sourceFactory } = {}) {
  const [command = "status", ...rest] = args;
  if (command === "status") {
    if (rest.length) throw new Error("media status accepts no arguments.");
    io.log(JSON.stringify({
      protocol: MEDIA_TRANSPORT_PROTOCOL,
      hostSource: "READY_INPUT_LOCALHOST_MEDIA_PROVIDER",
      devicePublishing: {
        status: "available-with-explicit-live-proof",
        proofIds: LIVE_PROVEN_FRAMER_MEDIA_HANDLERS.map(({ id }) => id),
        defaultWithoutProof: FRAMER_MEDIA_PUBLISHING_BLOCKER,
        command: "npm run media:live -- --confirm-live-rpc",
      },
      chunkRawBytes: MEDIA_CHUNK_RAW_BYTES,
      hardwareAccess: false,
    }, null, 2));
    return 0;
  }
  if (command === "inspect") {
    const port = parsePort(rest);
    const source = sourceFactory ? sourceFactory({ port }) : new InputLocalhostMediaSource({ port });
    const raw = await source.getCurrentMedia();
    if (!raw) {
      io.log(JSON.stringify({
        status: "no-active-media",
        reason: source.lastProbeStatus?.reason ?? "provider-inactive",
        providerTimeoutMs: source.lastProbeStatus?.timeoutMs ?? null,
        hardwareAccess: false,
      }, null, 2));
      return 0;
    }
    const snapshot = normalizeTransportSnapshot(raw);
    io.log(JSON.stringify({
      status: "host-media-ready-device-publishing-explicit-opt-in",
      title: snapshot.title,
      artist: snapshot.artist,
      durationMs: snapshot.durationMs,
      positionMs: snapshot.positionMs,
      isPlaying: snapshot.isPlaying,
      albumArt: {
        format: snapshot.albumArt.format,
        width: snapshot.albumArt.width,
        height: snapshot.albumArt.height,
        sha256: mediaSha256(snapshot.albumArt.pixels),
      },
      provenance: raw.provenance ?? null,
      hardwareAccess: false,
    }, null, 2));
    return 0;
  }
  if (command === "mock") {
    if (rest.length) throw new Error("media mock accepts no arguments.");
    const sink = new MockMediaRuntimeSink();
    const session = new MediaTransportSession({
      source: { getCurrentMedia: async () => mockMedia() },
      sink,
      allowMockRuntime: true,
    });
    const result = await session.pollOnce();
    io.log(JSON.stringify({
      status: result.status,
      generation: result.generation,
      metadataMessages: sink.metadata.length,
      artworkTransactions: sink.committedArtwork.length,
      artworkChunks: sink.committedArtwork[0]?.manifest.totalChunks ?? 0,
      artworkBytes: sink.committedArtwork[0]?.pixels.length ?? 0,
      chunkRawBytes: MEDIA_CHUNK_RAW_BYTES,
      runtimeProof: "mock",
      hardwareAccess: false,
    }, null, 2));
    return 0;
  }
  throw new Error("media command must be status, inspect, or mock.");
}
