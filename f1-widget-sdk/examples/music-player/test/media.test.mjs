import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  extractMainAlbumColor,
  LOGICAL_CANVAS,
  mediaUpdateKey,
  normalizeMediaSnapshot,
  planHostUpdate,
} from "../src/media-contract.mjs";
import { JsonFixtureMediaAdapter } from "../src/mock-adapter.mjs";
import { buildOfflineMediaBundle } from "../src/package-media.mjs";
import { renderEdgeNormalizedRadial, renderMusicFrame } from "../src/render.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function fixtureSnapshot() {
  const adapter = new JsonFixtureMediaAdapter(path.join(root, "fixtures/current-track.json"));
  return normalizeMediaSnapshot(await adapter.getCurrentMedia());
}

test("host adapter snapshot normalizes bounded progress and decoded RGBA art", async () => {
  const snapshot = await fixtureSnapshot();
  assert.equal(snapshot.title, "Midnight Circuit");
  assert.equal(snapshot.artist, "Static Bloom");
  assert.equal(snapshot.durationMs, 240000);
  assert.equal(snapshot.positionMs, 102000);
  assert.equal(snapshot.progress, 0.425);
  assert.equal(snapshot.progressPermille, 425);
  assert.equal(snapshot.albumArt.pixels.length, 8 * 8 * 4);

  const clamped = normalizeMediaSnapshot({
    ...snapshot,
    positionMs: 999999,
    albumArt: { ...snapshot.albumArt },
  });
  assert.equal(clamped.positionMs, clamped.durationMs);
  assert.equal(clamped.progress, 1);
  assert.equal(clamped.progressPermille, 1000);
});

test("main album color is deterministic and chooses the fixture's dominant blue", async () => {
  const snapshot = await fixtureSnapshot();
  const first = extractMainAlbumColor(snapshot.albumArt);
  const second = extractMainAlbumColor(snapshot.albumArt);
  assert.deepEqual(first, second);
  assert.equal(first.hex, "#2e86de");
  assert.equal(first.algorithm, "quantized-chromatic-dominant-v1");
});

test("radial background reaches one dark edge color on every logical 100x310 edge", () => {
  const mainColor = { r: 46, g: 134, b: 222 };
  const background = renderEdgeNormalizedRadial(mainColor);
  assert.equal(background.length, LOGICAL_CANVAS.width * LOGICAL_CANVAS.height * 4);
  const at = (x, y) => [...background.subarray((y * LOGICAL_CANVAS.width + x) * 4,
    (y * LOGICAL_CANVAS.width + x) * 4 + 4)];
  assert.deepEqual(at(50, 155), [46, 134, 222, 255]);
  for (let x = 0; x < LOGICAL_CANVAS.width; x += 1) {
    assert.deepEqual(at(x, 0), [0, 0, 0, 255]);
    assert.deepEqual(at(x, LOGICAL_CANVAS.height - 1), [0, 0, 0, 255]);
  }
  for (let y = 0; y < LOGICAL_CANVAS.height; y += 1) {
    assert.deepEqual(at(0, y), [0, 0, 0, 255]);
    assert.deepEqual(at(LOGICAL_CANVAS.width - 1, y), [0, 0, 0, 255]);
  }
});

test("renderer centers 84x84 art and draws a bounded progress bar", async () => {
  const snapshot = await fixtureSnapshot();
  const mainColor = extractMainAlbumColor(snapshot.albumArt);
  const frame = renderMusicFrame(snapshot, mainColor);
  assert.deepEqual({ width: frame.width, height: frame.height }, LOGICAL_CANVAS);
  assert.equal(frame.layout.albumArt.x + frame.layout.albumArt.width / 2, LOGICAL_CANVAS.width / 2);
  assert.equal(frame.layout.albumArt.y + frame.layout.albumArt.height / 2, 155);
  assert.ok(frame.layout.titleY < frame.layout.albumArt.y);
  assert.ok(frame.layout.artistY > frame.layout.albumArt.y + frame.layout.albumArt.height);
  assert.equal(frame.progressPixels, 34);
  assert.equal(frame.pixels.length, 100 * 310 * 4);
});

test("host update plan changes only when track data or progress bucket changes", async () => {
  const snapshot = await fixtureSnapshot();
  const key = mediaUpdateKey(snapshot);
  assert.equal(planHostUpdate(key, snapshot).changed, false);
  const sameBucket = normalizeMediaSnapshot({ ...snapshot, positionMs: 102999,
    albumArt: { ...snapshot.albumArt } });
  assert.equal(planHostUpdate(key, sameBucket).changed, false);
  const nextBucket = normalizeMediaSnapshot({ ...snapshot, positionMs: 103000,
    albumArt: { ...snapshot.albumArt } });
  assert.equal(planHostUpdate(key, nextBucket).changed, true);
});

test("offline bundle is byte-deterministic and cannot be mistaken for a device installer", async () => {
  const snapshot = await fixtureSnapshot();
  const mainColor = extractMainAlbumColor(snapshot.albumArt);
  const rendered = renderMusicFrame(snapshot, mainColor);
  const first = buildOfflineMediaBundle(snapshot, mainColor, rendered);
  const second = buildOfflineMediaBundle(snapshot, mainColor, rendered);
  assert.equal(first.manifest.transactionId, second.manifest.transactionId);
  assert.deepEqual([...first.files.keys()], [...second.files.keys()]);
  for (const name of first.files.keys()) assert.deepEqual(first.files.get(name), second.files.get(name));
  assert.equal(first.manifest.status, "OFFLINE_MEDIA_BUNDLE_NOT_DEVICE_INSTALLABLE");
  assert.equal(first.manifest.safety.hardwareAccess, false);
  assert.equal(first.manifest.safety.transportImplemented, false);
  assert.equal(first.manifest.safety.nativeMediaControllerProven, false);
  assert.equal(first.manifest.logicalCanvas.width, 100);
  assert.equal(first.manifest.logicalCanvas.height, 310);
  assert.equal(first.files.get("background-100x310.rgba8").length, 100 * 310 * 4);
  assert.equal(first.files.get("frame-100x310.rgba8").length, 100 * 310 * 4);
});

test("proposed project records the current SDK incompatibility instead of bypassing guards", async () => {
  const proposed = JSON.parse(await readFile(path.join(root, "widget.proposed.json"), "utf8"));
  assert.equal(proposed.profile, "host-fed-media-v1-proposed");
  assert.deepEqual(proposed.target.logicalCanvas, LOGICAL_CANVAS);
  assert.equal(proposed.safety.hardwareAccess, false);
  assert.equal(proposed.safety.nativeMediaControllerProven, false);
  assert.equal(proposed.safety.status, "CONTRACT_AND_PREVIEW_ONLY_NOT_FIRMWARE_BUILDABLE");
});
