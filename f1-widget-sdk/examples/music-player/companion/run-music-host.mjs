#!/usr/bin/env node

import { evaluateInInput } from "../../../../framer-widgets/lib/input-inspector.mjs";
import { InputLocalhostMediaSource } from "../../../src/media-transport/index.mjs";
import { runLiveMedia } from "../tools/run-live-media.mjs";

const MAX_COMPRESSED_ARTWORK_BYTES = 6 * 1024 * 1024;

function invariant(value, message) {
  if (!value) throw new Error(message);
}

export function buildInputArtworkDecodeExpression(value, { side = 80 } = {}) {
  invariant(Buffer.isBuffer(value) || value instanceof Uint8Array,
    "Compressed artwork must be a Buffer or Uint8Array.");
  const bytes = Buffer.from(value);
  invariant(bytes.length > 0 && bytes.length <= MAX_COMPRESSED_ARTWORK_BYTES,
    `Compressed artwork must contain 1..${MAX_COMPRESSED_ARTWORK_BYTES} bytes.`);
  invariant(Number.isSafeInteger(side) && side >= 1 && side <= 512, "Artwork side must be 1..512.");
  const encoded = bytes.toString("base64");
  return `(async () => {
    const { createRequire } = process.getBuiltinModule("node:module");
    const requireFromInput = createRequire(
      "/Applications/input.app/Contents/Resources/app.asar/dist-electron/main/index.js"
    );
    const { Jimp } = requireFromInput("jimp");
    const image = await Jimp.read(Buffer.from(${JSON.stringify(encoded)}, "base64"));
    image.cover({ w: ${side}, h: ${side} });
    const pixels = Buffer.from(image.bitmap.data);
    if (image.bitmap.width !== ${side} || image.bitmap.height !== ${side} ||
        pixels.length !== ${side * side * 4}) throw new Error("Input artwork decode size mismatch");
    return { format: "rgba8", width: image.bitmap.width, height: image.bitmap.height,
      pixelsBase64: pixels.toString("base64") };
  })()`;
}

export async function decodeArtworkInInput(value, { side = 80, evaluate = evaluateInInput } = {}) {
  invariant(typeof evaluate === "function", "Artwork decode requires an Input evaluator.");
  const decoded = await evaluate(buildInputArtworkDecodeExpression(value, { side }), { timeoutMs: 20_000 });
  invariant(decoded?.format === "rgba8" && decoded.width === side && decoded.height === side &&
    typeof decoded.pixelsBase64 === "string" && /^[A-Za-z0-9+/]*={0,2}$/u.test(decoded.pixelsBase64),
  "Input returned an invalid artwork decode.");
  const pixels = Buffer.from(decoded.pixelsBase64, "base64");
  invariant(pixels.length === side * side * 4, "Input returned an invalid artwork pixel count.");
  return Object.freeze({ format: "rgba8", width: side, height: side, pixels });
}

export async function runMusicHost(io = console) {
  const source = new InputLocalhostMediaSource({
    decodeArtwork: (bytes, options) => decodeArtworkInInput(bytes, options),
  });
  const live = await runLiveMedia(["--confirm-live-rpc"], io, { source });
  await new Promise((resolve) => {
    const finish = () => { live.stop(); resolve(); };
    process.once("SIGINT", finish);
    process.once("SIGTERM", finish);
  });
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  try { await runMusicHost(); }
  catch (error) {
    console.error(`Music host stopped: ${error.message}`);
    process.exitCode = 1;
  }
}
