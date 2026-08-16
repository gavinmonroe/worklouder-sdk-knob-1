import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeMediaSnapshot, extractMainAlbumColor } from "../src/media-contract.mjs";
import { JsonFixtureMediaAdapter } from "../src/mock-adapter.mjs";
import { buildOfflineMediaBundle } from "../src/package-media.mjs";
import { renderMusicFrame } from "../src/render.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = path.join(root, "fixtures/current-track.json");
const output = path.join(root, "generated/mock-transaction-0001");
const adapter = new JsonFixtureMediaAdapter(fixture);
const snapshot = normalizeMediaSnapshot(await adapter.getCurrentMedia());
const mainColor = extractMainAlbumColor(snapshot.albumArt);
const rendered = renderMusicFrame(snapshot, mainColor);
const bundle = buildOfflineMediaBundle(snapshot, mainColor, rendered);
await mkdir(output, { recursive: true });
for (const [name, bytes] of bundle.files) await writeFile(path.join(output, name), bytes);
console.log(JSON.stringify({
  status: bundle.manifest.status,
  output,
  transactionId: bundle.manifest.transactionId,
  mainColor: mainColor.hex,
  progressPermille: snapshot.progressPermille,
  hardwareAccess: false,
}, null, 2));
