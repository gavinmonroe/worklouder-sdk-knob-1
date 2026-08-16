import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { SDK_ROOT } from "./constants.mjs";
import { stableJson } from "./util.mjs";

function projectName(projectRoot) {
  let name = path.basename(projectRoot).toLowerCase().replace(/[^a-z0-9-]/gu, "-").replace(/^-+/u, "");
  if (!/^[a-z]/u.test(name)) name = `media-${name}`;
  if (name.length < 2) name = "media-widget";
  return name.slice(0, 48).replace(/-+$/u, "");
}

export async function initMediaProject(destination) {
  const projectRoot = path.resolve(destination);
  try {
    await access(projectRoot);
    throw new Error(`Refusing to overwrite existing path ${projectRoot}.`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await Promise.all([
    mkdir(path.join(projectRoot, "src"), { recursive: true }),
    mkdir(path.join(projectRoot, "docs"), { recursive: true }),
    mkdir(path.join(projectRoot, "test"), { recursive: true }),
  ]);

  const name = projectName(projectRoot);
  const publicApi = pathToFileURL(path.join(SDK_ROOT, "src/media-transport/index.mjs")).href;
  const packageJson = {
    name,
    version: "0.1.0",
    private: true,
    type: "module",
    scripts: { demo: "node src/demo.mjs", test: "node --test" },
  };
  const spec = {
    format: "framer-f1-media-project-v1",
    name,
    target: { device: "knob_f1", firmware: "0.4.1", screenId: 1 },
    source: { kind: "input-localhost", pollIntervalMs: 1000 },
    artwork: { hostFormat: "rgba8", wireFormat: "rgb565-le", width: 80, height: 80,
      chunkRawBytes: 3072 },
    runtime: { sink: "blocked-until-live-proof", requiredProof: "framer-media-handler-live-proof-v1" },
  };
  const source = `export class ProjectMockMediaSource {
  constructor() { this.positionMs = 0; }

  async getCurrentMedia() {
    const width = 80;
    const height = 80;
    const pixels = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        pixels[offset] = 20 + Math.floor(x * 120 / width);
        pixels[offset + 1] = 45 + Math.floor(y * 90 / height);
        pixels[offset + 2] = 170;
        pixels[offset + 3] = 255;
      }
    }
    const snapshot = { title: "SDK Night Drive", artist: "Mock Provider", durationMs: 180000,
      positionMs: this.positionMs, isPlaying: true,
      albumArt: { format: "rgba8", width, height, pixels } };
    this.positionMs += 1000;
    return snapshot;
  }
}
`;
  const session = `import {
  BlockedMediaRuntimeSink,
  InputLocalhostMediaSource,
  MediaTransportSession,
  MockMediaRuntimeSink,
} from ${JSON.stringify(publicApi)};
import { ProjectMockMediaSource } from "./source.mjs";

export function createMockSession() {
  const sink = new MockMediaRuntimeSink();
  const session = new MediaTransportSession({ source: new ProjectMockMediaSource(), sink,
    pollIntervalMs: 1000, allowMockRuntime: true });
  return { session, sink };
}

export function createInputSession({ sink = new BlockedMediaRuntimeSink(), sourceOptions = {} } = {}) {
  return new MediaTransportSession({ source: new InputLocalhostMediaSource(sourceOptions), sink,
    pollIntervalMs: 1000 });
}
`;
  const demo = `import { createMockSession } from "./session.mjs";

const { session, sink } = createMockSession();
const results = [await session.pollOnce(), await session.pollOnce(), await session.pollOnce()];
console.log(JSON.stringify({ results, metadataMessages: sink.metadata.length,
  artworkTransactions: sink.committedArtwork.length,
  chunkBytes: sink.committedArtwork[0]?.manifest.chunkRawBytes ?? null,
  hardwareAccess: sink.capabilities.hardwareAccess }, null, 2));
`;
  const test = `import assert from "node:assert/strict";
import test from "node:test";
import { createInputSession, createMockSession } from "../src/session.mjs";

test("mock media session sends artwork once and 1Hz metadata diffs", async () => {
  const { session, sink } = createMockSession();
  const first = await session.pollOnce();
  const second = await session.pollOnce();
  assert.equal(first.artwork, true);
  assert.equal(second.artwork, false);
  assert.deepEqual(Object.keys(sink.metadata[1].payload), ["elapsed"]);
  assert.equal(sink.committedArtwork[0].manifest.chunkRawBytes, 3072);
});

test("Input session is blocked before probing Input or device I/O", async () => {
  const result = await createInputSession().pollOnce();
  assert.equal(result.status, "blocked");
  assert.equal(result.hardwareAccess, false);
});
`;
  const readme = `# ${name}

Generated media-communication project for the unofficial Framer F1 research SDK.

Run:

    npm test
    npm run demo

createMockSession() is a complete deterministic transport exercise. createInputSession()
subscribes to Input's hash-pinned macOS media source, but its default Framer sink blocks before
source polling or device I/O. It becomes publishable only after the SDK pins live proof for both
mp.write_info and mp.write_artwork handlers. Do not bypass that gate.
`;
  const docs = `# Media pipeline contract

- Input source poll cadence: 1000 ms.
- Host artwork: bounded RGBA8; wire artwork: RGB565 little-endian.
- Raw artwork chunk: exactly 3072 bytes maximum / 4096 base64 characters.
- Metadata sends only fields changed since the last accepted generation.
- Artwork sends only when the encoded artwork hash changes.
- Runtime handshake requires atomic artwork commit, UI-thread application, and live proof.
- Mock proof is accepted only when allowMockRuntime is true.
- The generated session remains blocked by default. The SDK has one exact live proof, but only the
  separate explicit media:live -- --confirm-live-rpc runner may select it.
`;
  const testing = `# Test record

- [ ] npm test passes.
- [ ] First mock poll sends metadata plus a complete verified artwork transaction.
- [ ] Second 1Hz poll sends only the elapsed metadata field.
- [ ] Every raw chunk is at most 3072 bytes and every base64 chunk at most 4096 characters.
- [ ] Default Input/Framer session returns blocked before polling or device I/O.
- [ ] No runtime proof is added without exact handler hashes, live receipt, and rollback evidence.
`;

  await Promise.all([
    writeFile(path.join(projectRoot, "package.json"), stableJson(packageJson), { flag: "wx" }),
    writeFile(path.join(projectRoot, "media-project.json"), stableJson(spec), { flag: "wx" }),
    writeFile(path.join(projectRoot, "src/source.mjs"), source, { flag: "wx" }),
    writeFile(path.join(projectRoot, "src/session.mjs"), session, { flag: "wx" }),
    writeFile(path.join(projectRoot, "src/demo.mjs"), demo, { flag: "wx" }),
    writeFile(path.join(projectRoot, "test/media.test.mjs"), test, { flag: "wx" }),
    writeFile(path.join(projectRoot, "README.md"), readme, { flag: "wx" }),
    writeFile(path.join(projectRoot, "docs/CONTRACT.md"), docs, { flag: "wx" }),
    writeFile(path.join(projectRoot, "docs/TESTING.md"), testing, { flag: "wx" }),
  ]);
  return projectRoot;
}
