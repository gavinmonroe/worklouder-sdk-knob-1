#!/usr/bin/env node

import {
  FramerMediaRuntimeSink,
  InputLocalhostMediaSource,
  InputWlrpcMediaTransport,
  MediaTransportSession,
} from "../../../src/media-transport/index.mjs";

export const LIVE_MEDIA_PROOF_ID = "framer-f1-0.4.1-music-id1-b9b8eec6";

export function parseLiveMediaArguments(args) {
  const options = { once: false, confirmed: false, port: 9230 };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--once") options.once = true;
    else if (argument === "--confirm-live-rpc") options.confirmed = true;
    else if (argument === "--port") {
      const port = Number(args[++index]);
      if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
        throw new Error("--port must be 1..65535");
      }
      options.port = port;
    } else throw new Error(`Unknown live-media argument ${argument}.`);
  }
  if (!options.confirmed) {
    throw new Error("Live media requires --confirm-live-rpc; this opens the proven USB Framer RPC transport.");
  }
  return Object.freeze(options);
}

export function createLiveMediaSession({ port = 9230, evaluate, source, transport } = {}) {
  const mediaSource = source ?? new InputLocalhostMediaSource({ port, ...(evaluate ? { evaluate } : {}) });
  const rpcTransport = transport ?? new InputWlrpcMediaTransport({ port, ...(evaluate ? { evaluate } : {}) });
  const sink = new FramerMediaRuntimeSink({ transport: rpcTransport, proofId: LIVE_MEDIA_PROOF_ID });
  return new MediaTransportSession({ source: mediaSource, sink, pollIntervalMs: 1000 });
}

export async function runLiveMedia(args, io = console, dependencies = {}) {
  const options = parseLiveMediaArguments(args);
  const session = dependencies.session ?? createLiveMediaSession({ port: options.port, ...dependencies });
  if (options.once) {
    const result = await session.pollOnce();
    io.log(JSON.stringify({ ...result, proofId: LIVE_MEDIA_PROOF_ID, hardwareAccess: true }, null, 2));
    return Object.freeze({ session, result, stop: () => session.stop() });
  }

  const stop = session.start({
    onResult: (result) => io.log(JSON.stringify({ ...result, proofId: LIVE_MEDIA_PROOF_ID,
      hardwareAccess: true })),
    onError: (error) => io.error?.(`media-live: ${error.message}`),
  });
  io.log(JSON.stringify({ status: "running", pollIntervalMs: 1000, proofId: LIVE_MEDIA_PROOF_ID,
    hardwareAccess: true }));
  return Object.freeze({ session, result: null, stop });
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  try {
    const live = await runLiveMedia(process.argv.slice(2));
    if (!process.argv.includes("--once")) {
      await new Promise((resolve) => {
        const finish = () => { live.stop(); resolve(); };
        process.once("SIGINT", finish);
        process.once("SIGTERM", finish);
      });
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}
