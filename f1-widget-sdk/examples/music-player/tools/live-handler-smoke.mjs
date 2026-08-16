#!/usr/bin/env node

import { evaluateInInput } from "../../../../framer-widgets/lib/input-inspector.mjs";

const metadataOnly = process.argv.includes("--metadata-only");
const tinyArtwork = process.argv.includes("--tiny-art");
const offsetArgument = process.argv.find((argument) => argument.startsWith("--art-offset="));
const singleArtworkOffset = offsetArgument === undefined
  ? null
  : Number(offsetArgument.slice("--art-offset=".length));
if (singleArtworkOffset !== null && ![0, 3072, 6144, 9216, 12288].includes(singleArtworkOffset)) {
  throw new Error("--art-offset must be one of 0,3072,6144,9216,12288");
}
const expression = String.raw`
(async () => {
  const { createRequire } = process.getBuiltinModule("node:module");
  const requireFromInput = createRequire(
    "/Applications/input.app/Contents/Resources/app.asar/dist-electron/main/index.js"
  );
  const sdk = requireFromInput("@worklouder/wl-device-kit");
  const devices = new sdk.WLDeviceDiscovery().findWLDevices([sdk.DeviceType.KnobF1]);
  if (devices.length !== 1 || !devices[0].isUsbConnection) {
    throw new Error("Expected exactly one USB Framer F1");
  }

  const comm = new sdk.WLDeviceCommImpl();
  await comm.connect(devices[0]);
  try {
    const api = new sdk.WLRPCApi(comm);
    const version = await api.getFirmwareVersion();
    if (version !== "0.4.1" && version?.version !== "0.4.1") {
      throw new Error("Framer firmware is not 0.4.1");
    }

    const rpc = new sdk.WLRPCClient(comm);
    const metadata = await rpc.sendRpcCall({
      method: "mp.write_info",
      params: {
        song_title: "FRAMER LIVE MEDIA",
        artist: "SDK TRANSPORT TEST",
        elapsed: 42,
        total_duration: 240,
        is_playing: true,
      },
    });
    if ((metadata?.result?.status ?? metadata?.status) !== "ok") {
      throw new Error("Metadata handler rejected the smoke payload");
    }

    if (${metadataOnly}) return { device: devices[0], version, metadata, artwork: null };

    if (${tinyArtwork}) {
      const artwork = await rpc.sendRpcCall({
        method: "mp.write_artwork",
        params: { data: "AAAA", offset: 0, size: 12800 },
      });
      return { device: devices[0], version, metadata, artwork };
    }

    const width = 80;
    const height = 80;
    const artwork = Buffer.alloc(width * height * 2);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const r = Math.floor(31 * x / (width - 1));
        const g = Math.floor(63 * y / (height - 1));
        const b = ((x >> 3) ^ (y >> 3)) & 1 ? 31 : 9;
        artwork.writeUInt16LE((r << 11) | (g << 5) | b, (y * width + x) * 2);
      }
    }

    if (${singleArtworkOffset === null ? "false" : "true"}) {
      const offset = ${singleArtworkOffset ?? 0};
      const bytes = artwork.subarray(offset, Math.min(artwork.length, offset + 3072));
      const response = await rpc.sendRpcCall({
        method: "mp.write_artwork",
        params: { data: bytes.toString("base64"), offset, size: artwork.length },
      });
      return { device: devices[0], version, metadata, artwork: {
        offset, bytes: bytes.length, response,
      } };
    }

    const chunks = [];
    for (let offset = 0; offset < artwork.length; offset += 3072) {
      const bytes = artwork.subarray(offset, Math.min(artwork.length, offset + 3072));
      const response = await rpc.sendRpcCall({
        method: "mp.write_artwork",
        params: { data: bytes.toString("base64"), offset, size: artwork.length },
      });
      if ((response?.result?.status ?? response?.status) !== "ok") {
        throw new Error("Artwork handler rejected offset " + offset + ": " + JSON.stringify(response));
      }
      chunks.push(bytes.length);
    }

    return { device: devices[0], version, metadata, artwork: {
      width, height, bytes: artwork.length, chunks,
    } };
  } finally {
    try { await comm.disconnect(); } catch {}
  }
})()
`;

try {
  const result = await evaluateInInput(expression, { timeoutMs: 30_000 });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
}
