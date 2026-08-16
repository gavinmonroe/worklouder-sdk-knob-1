import { createHash } from "node:crypto";

import { encodeRgbaPng } from "./png.mjs";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function stableJson(value) {
  return `${JSON.stringify(stable(value), null, 2)}\n`;
}

export function buildOfflineMediaBundle(snapshot, mainColor, rendered, { generation = 1 } = {}) {
  if (!Number.isSafeInteger(generation) || generation < 1) throw new Error("generation must be a positive integer.");
  const files = new Map([
    ["album-art.rgba8", Buffer.from(snapshot.albumArt.pixels)],
    ["background-100x310.rgba8", Buffer.from(rendered.background)],
    ["frame-100x310.rgba8", Buffer.from(rendered.pixels)],
    ["preview-100x310.png", encodeRgbaPng(rendered.width, rendered.height, rendered.pixels)],
  ]);
  const assets = Object.fromEntries([...files].map(([name, bytes]) => [name, {
    bytes: bytes.length,
    sha256: sha256(bytes),
  }]));
  const transaction = {
    contract: "host-fed-asset-transaction-v1",
    generation,
    media: {
      title: snapshot.title,
      artist: snapshot.artist,
      durationMs: snapshot.durationMs,
      positionMs: snapshot.positionMs,
      progressPermille: snapshot.progressPermille,
      mainColor: mainColor.hex,
    },
    logicalCanvas: { width: rendered.width, height: rendered.height },
    assets,
  };
  const transactionId = sha256(Buffer.from(stableJson(transaction)));
  const manifest = {
    ...transaction,
    transactionId,
    status: "OFFLINE_MEDIA_BUNDLE_NOT_DEVICE_INSTALLABLE",
    safety: {
      hardwareAccess: false,
      nativeMediaControllerProven: false,
      transportImplemented: false,
      flashCommandProvided: false,
    },
    futureCommitProtocol: [
      "stage complete assets under a transaction-specific temporary namespace",
      "verify every asset size and sha256",
      "publish generation manifest atomically",
      "swap LVGL descriptors on the device UI thread",
      "retain previous generation until the next frame renders successfully"
    ],
  };
  files.set("manifest.json", Buffer.from(stableJson(manifest)));
  return Object.freeze({ manifest: Object.freeze(manifest), files });
}
