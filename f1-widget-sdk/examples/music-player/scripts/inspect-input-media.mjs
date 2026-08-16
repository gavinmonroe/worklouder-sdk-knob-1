#!/usr/bin/env node

import { extractMainAlbumColor, normalizeMediaSnapshot } from "../src/media-contract.mjs";
import { InputLocalhostMediaAdapter } from "../src/input-localhost-adapter.mjs";

async function main() {
  const adapter = new InputLocalhostMediaAdapter();
  const raw = await adapter.getCurrentMedia();
  if (!raw) {
    console.log(JSON.stringify({ status: "no-active-media", hardwareAccess: false }, null, 2));
    return;
  }
  const snapshot = normalizeMediaSnapshot(raw);
  const color = extractMainAlbumColor(snapshot.albumArt);
  console.log(JSON.stringify({
    status: "host-media-ready-runtime-adapter-blocked",
    title: snapshot.title,
    artist: snapshot.artist,
    durationMs: snapshot.durationMs,
    positionMs: snapshot.positionMs,
    progressPermille: snapshot.progressPermille,
    albumArt: {
      format: snapshot.albumArt.format,
      width: snapshot.albumArt.width,
      height: snapshot.albumArt.height,
      mainColor: color.hex,
    },
    provenance: raw.provenance,
    hardwareAccess: false,
  }, null, 2));
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
