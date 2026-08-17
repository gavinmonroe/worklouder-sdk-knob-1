import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { encodeRasterAnimation } from "../../f1-widget-sdk/src/render/raster-animation.mjs";
import { buildGlyphAtlas } from "../../f1-widget-sdk/src/render/glyph-atlas.mjs";
import { decodeWidgetBundle, encodeWidgetBundle } from "../../f1-widget-sdk/src/render/widget-bundle.mjs";

import { auditRendererV1Abi, RENDERER_V1_SCREEN_ID } from "../experimental/renderer-v1-abi-contract.mjs";
import {
  RENDERER_V1,
  RENDERER_V1_RASTER,
  RendererV1Runtime,
  admitRendererV1Bundle,
  admitRendererV1DecodedWidgetBundle,
  admitRendererV1Raster,
  admitRendererV1Scene,
} from "../lib/renderer-v1-runtime.mjs";

const solidFrame = (color) => new Uint16Array(100 * 310).fill(color);
const encodeGoldenRaster = (frames, options = {}) => encodeRasterAnimation({
  frames, fps: options.fps ?? 10, loopDurationMs: options.loopDurationMs ?? frames.length * 100,
  tileWidth: options.tileWidth ?? 10, tileHeight: options.tileHeight ?? 10,
  keyframeInterval: options.keyframeInterval ?? 0, maxBytes: RENDERER_V1_RASTER.maxSceneBytes,
}).binary;
const repinPayloadSha = (binary) => {
  createHash("sha256").update(binary.subarray(64)).digest().copy(binary, 32);
  return binary;
};

const record = (seed, tickCount = 3) => admitRendererV1Scene({
  sceneBinary: Buffer.concat([Buffer.from("F1SC"), Buffer.from([1, 0, 0, seed])]),
  tickCount,
  renderInto(buffer, { tick }) { buffer.fill((seed + tick) & 0xff); },
});
const bundle = (seeds = [0x10, 0x20, 0x30]) => admitRendererV1Bundle({
  bundleBinary: Buffer.from("F1SB\x01\x00\x00\x00", "binary"),
  scenes: seeds.map((seed) => seed === null ? null : record(seed)),
  activeSlot: seeds.findIndex((seed) => seed !== null),
});

test("renderer-v1 pins one 100x310 RGB565 buffer and a 100-ms clock", () => {
  assert.equal(RENDERER_V1.framebufferBytes, 100 * 310 * 2);
  assert.deepEqual(RENDERER_V1.descriptor,
    { word0: 0x1219, word1: 0x01360064, word2: 200, dataBytes: 62_000 });
  const runtime = new RendererV1Runtime(bundle());
  runtime.attach({ owner: "root-a", image: "image-a", uiThread: "wl_lvgl" });
  assert.deepEqual(runtime.tick100ms({ uiThread: "wl_lvgl" }),
    { rendered: true, slot: 0, tick: 0, frameGeneration: 1, descriptorIdentity: 1 });
  assert.equal(runtime.framebuffer.length, 62_000);
  assert.ok(runtime.framebuffer.every((byte) => byte === 0x10));
  assert.equal(runtime.tick100ms({ uiThread: "wl_lvgl" }).tick, 1);
  assert.equal(runtime.tick100ms({ uiThread: "wl_lvgl" }).tick, 2);
  assert.equal(runtime.tick100ms({ uiThread: "wl_lvgl" }).tick, 0);
});

test("Fn plus bottom knob cycles three RAM slots with wrap and no immediate render", () => {
  const runtime = new RendererV1Runtime(bundle(), { currentSlot: 2 });
  runtime.attach({ owner: {}, image: {}, uiThread: "ui" });
  assert.equal(runtime.handleEncoder({ encoderId: 1, delta: 1, fnPressed: true }), true);
  assert.equal(runtime.currentSlot, 0);
  assert.equal(runtime.frameGeneration, 0);
  assert.equal(runtime.handleEncoder({ encoderId: 1, delta: 0xff, fnPressed: true }), true);
  assert.equal(runtime.currentSlot, 2);
  assert.equal(runtime.handleEncoder({ encoderId: 0, delta: 1, fnPressed: true }), false);
  assert.equal(runtime.handleEncoder({ encoderId: 1, delta: 1, fnPressed: false }), false);
});

test("scene updates validate as a batch and commit only on the UI tick", () => {
  const runtime = new RendererV1Runtime(bundle());
  runtime.attach({ owner: "root", image: "image", uiThread: "ui" });
  const replacement = record(0x70, 2);
  runtime.queueAtomicSceneApply([{ slot: 0, scene: replacement, expectedRevision: 0 }]);
  assert.equal(runtime.bundleGeneration, 0);
  assert.deepEqual(runtime.slotRevisions, [0, 0, 0]);
  const applied = runtime.tick100ms({ uiThread: "ui" });
  assert.equal(applied.tick, 0);
  assert.equal(runtime.bundleGeneration, 1);
  assert.deepEqual(runtime.slotRevisions, [1, 0, 0]);
  assert.ok(runtime.framebuffer.every((byte) => byte === 0x70));
  assert.throws(() => runtime.queueAtomicSceneApply([
    { slot: 0, scene: replacement, expectedRevision: 1 },
    { slot: 0, scene: replacement, expectedRevision: 1 },
  ]), /unique/u);
  assert.deepEqual(runtime.slotRevisions, [1, 0, 0]);
  assert.throws(() => runtime.queueAtomicSceneApply([
    { slot: 1, scene: replacement, expectedRevision: 4 },
  ]), /Stale revision/u);
});

test("an F1SB replacement is atomic and preserves local selection modulo populated slots", () => {
  const runtime = new RendererV1Runtime(bundle(), { currentSlot: 2 });
  runtime.attach({ owner: "root", image: "image", uiThread: "ui" });
  const replacement = admitRendererV1Bundle({
    bundleBinary: Buffer.from("F1SB\x01\x01\x00\x00", "binary"),
    scenes: [record(0x41), record(0x42), null],
    activeSlot: 1,
  });
  runtime.queueAtomicBundleApply(replacement);
  assert.equal(runtime.currentSlot, 2, "producer never changes local selection before the UI commit");
  const frame = runtime.tick100ms({ uiThread: "ui" });
  assert.equal(runtime.currentSlot, 0, "old slot 2 maps through 2 % 2 to populated slot 0");
  assert.equal(frame.slot, 0);
  assert.ok(runtime.framebuffer.every((byte) => byte === 0x41));
  assert.equal(runtime.bundleGeneration, 1);
  assert.equal(runtime.handleEncoder({ encoderId: 1, delta: 0xff, fnPressed: true }), true);
  assert.equal(runtime.currentSlot, 1, "cycling skips empty slot 2 and wraps");
});

test("a canonical F1WB dispatches mixed F1SC+F1GA and F1RA slots by declared kind", () => {
  const atlas = buildGlyphAtlas({
    glyphs: ["A"],
    rasterizeGlyph(_glyph, { rowStride, height }) { return Buffer.alloc(rowStride * height); },
    source: "renderer-v1-production-shape-fixture",
  });
  const semantic = (seed) => ({
    sceneBinary: Buffer.concat([Buffer.from("F1SC"), Buffer.from([1, 0, 0, seed])]),
    atlasBinary: atlas.binary,
  });
  const rasterBinary = encodeGoldenRaster([solidFrame(0x2468)]);
  const encoded = encodeWidgetBundle({
    slots: [
      { name: "semantic-a", kind: "semantic", ...semantic(0x51) },
      { name: "browser", kind: "raster", animationBinary: rasterBinary },
      { name: "semantic-b", kind: "semantic", ...semantic(0x53) },
    ],
    activeSlot: 1,
    generation: 19,
  });
  const admitted = admitRendererV1DecodedWidgetBundle(decodeWidgetBundle(encoded.binary), {
    semanticRenderers: {
      0: { tickCount: 1, renderInto(buffer) { buffer.fill(0x51); } },
      2: { tickCount: 1, renderInto(buffer) { buffer.fill(0x53); } },
    },
  });
  const runtime = new RendererV1Runtime(admitted);
  runtime.attach({ owner: 1, image: 2, uiThread: 3 });
  assert.equal(runtime.currentSlot, 1);
  runtime.tick100ms({ uiThread: 3 });
  assert.equal(runtime.framebuffer.readUInt16LE(0), 0x2468);
  runtime.handleEncoder({ encoderId: 1, delta: 1, fnPressed: true });
  runtime.tick100ms({ uiThread: 3 });
  assert.ok(runtime.framebuffer.every((byte) => byte === 0x53));
  runtime.handleEncoder({ encoderId: 1, delta: 1, fnPressed: true });
  runtime.tick100ms({ uiThread: 3 });
  assert.ok(runtime.framebuffer.every((byte) => byte === 0x51));
});

test("lifecycle ownership and UI-thread guards fail closed", () => {
  const runtime = new RendererV1Runtime(bundle());
  const root = {};
  runtime.attach({ owner: root, image: {}, uiThread: "ui" });
  assert.deepEqual(runtime.tick100ms({ uiThread: "rpc" }), { rendered: false, reason: "lifecycle" });
  assert.equal(runtime.detach({ owner: {} }), false);
  assert.equal(runtime.active, true);
  assert.equal(runtime.detach({ owner: root }), true);
  assert.equal(runtime.active, false);
  assert.equal(runtime.handleEncoder({ encoderId: 1, delta: 1, fnPressed: true }), false);
  assert.deepEqual(runtime.tick100ms({ uiThread: "ui" }), { rendered: false, reason: "lifecycle" });
});

test("runtime rejects raw/unbounded records and blacks the frame on adapter failure", () => {
  assert.throws(() => admitRendererV1Scene({ sceneBinary: Buffer.from("<style>"), tickCount: 1,
    renderInto() {} }), /F1SC/u);
  assert.throws(() => admitRendererV1Scene({
    sceneBinary: Buffer.concat([Buffer.from("F1SC"), Buffer.alloc(4093)]), tickCount: 1, renderInto() {},
  }), /exceeds/u);
  const bad = admitRendererV1Scene({
    sceneBinary: Buffer.from("F1SC\x01\x00\x00\x00", "binary"), tickCount: 1,
    renderInto(buffer) { buffer.fill(0xff); throw new Error("bad atlas"); },
  });
  const runtime = new RendererV1Runtime(admitRendererV1Bundle({
    bundleBinary: Buffer.from("F1SB\x01\x00\x00\x00", "binary"), scenes: [bad, record(2), record(3)],
  }));
  runtime.attach({ owner: 1, image: 2, uiThread: 3 });
  assert.equal(runtime.tick100ms({ uiThread: 3 }).reason, "scene");
  assert.ok(runtime.framebuffer.every((byte) => byte === 0));
});

test("canonical SDK F1RA full/pixel/span/tile records render through one shared buffer", () => {
  const frames = [solidFrame(0x1111)];
  const pixel = new Uint16Array(frames.at(-1)); pixel[102] = 0x1234; frames.push(pixel);
  const span = new Uint16Array(frames.at(-1)); span.fill(0x5678, 300, 320); frames.push(span);
  const tile = new Uint16Array(frames.at(-1));
  for (let y = 0; y < 10; y += 1) tile.fill(0x9abc, y * 100, y * 100 + 10);
  frames.push(tile);
  frames.push(solidFrame(0xbeef));
  const encoded = encodeRasterAnimation({ frames, width: 100, height: 310, fps: 10,
    loopDurationMs: 500, maxBytes: RENDERER_V1_RASTER.maxSceneBytes, tileWidth: 10, tileHeight: 10 });
  assert.deepEqual(encoded.stats.modes, ["full", "pixels", "spans", "tiles", "full"]);
  const scene = admitRendererV1Raster(encoded.binary);
  const runtime = new RendererV1Runtime(admitRendererV1Bundle({
    bundleBinary: Buffer.from("F1SB\x01\x00\x00\x00", "binary"), scenes: [scene, record(2), record(3)],
  }));
  runtime.attach({ owner: 1, image: 2, uiThread: 3 });
  for (const expected of frames) {
    runtime.tick100ms({ uiThread: 3 });
    assert.deepEqual(new Uint16Array(runtime.framebuffer.buffer, runtime.framebuffer.byteOffset, expected.length), expected);
  }
  runtime.tick100ms({ uiThread: 3 });
  assert.deepEqual(new Uint16Array(runtime.framebuffer.buffer, runtime.framebuffer.byteOffset, frames[0].length), frames[0]);
});

test("F1RA honors declared 100-ms cadence and fails closed on malformed payloads", () => {
  const first = solidFrame(0x1111);
  const second = new Uint16Array(first); second[0] = 0xbeef;
  const scene = admitRendererV1Raster(encodeGoldenRaster([first, second], { fps: 5, loopDurationMs: 400 }));
  const runtime = new RendererV1Runtime(admitRendererV1Bundle({
    bundleBinary: Buffer.from("F1SB\x01\x00\x00\x00", "binary"), scenes: [scene, record(2), record(3)],
  }));
  runtime.attach({ owner: 1, image: 2, uiThread: 3 });
  runtime.tick100ms({ uiThread: 3 });
  runtime.tick100ms({ uiThread: 3 });
  assert.equal(runtime.framebuffer.readUInt16LE(0), 0x1111);
  runtime.tick100ms({ uiThread: 3 });
  assert.equal(runtime.framebuffer.readUInt16LE(0), 0xbeef);

  const wrongCadence = Buffer.from(encodeGoldenRaster([first, second]));
  wrongCadence.writeUInt32LE(300, 16);
  assert.throws(() => admitRendererV1Raster(wrongCadence), /header violates/u);
  const tooFast = Buffer.from(encodeGoldenRaster([first, second]));
  tooFast.writeUInt16LE(50, 12);
  assert.throws(() => admitRendererV1Raster(tooFast), /header violates/u);

  const twoSpans = new Uint16Array(first);
  twoSpans.fill(0x2222, 10, 30); twoSpans.fill(0x3333, 100, 130);
  const overlap = Buffer.from(encodeGoldenRaster([first, twoSpans]));
  const secondRecord = 64 + 8 + RENDERER_V1.framebufferBytes;
  assert.equal(overlap[secondRecord], 2, "golden fixture must select span mode");
  const payload = secondRecord + 8;
  const firstLength = overlap.readUInt16LE(payload + 2);
  const secondSpan = payload + 4 + firstLength * 2;
  overlap.writeUInt16LE(20, secondSpan); // overlaps first span [10,30).
  repinPayloadSha(overlap);
  assert.throws(() => admitRendererV1Raster(overlap), /span range is invalid/u);
});

test("official 0.4.1 pins dynamic ID26 registry/navigation evidence and honest live gates", async () => {
  const app = await readFile(new URL("../../artifacts/firmware/framer_app_0.4.1.bin", import.meta.url));
  const audit = auditRendererV1Abi(app);
  assert.equal(RENDERER_V1_SCREEN_ID, 26);
  assert.equal(audit.screenId, 26);
  assert.match(audit.id26Evidence, /grows its pointer vector/u);
  assert.match(audit.id26Evidence, /untruncated u32/u);
  assert.equal(audit.staticReady, true);
  assert.equal(audit.liveReady, false);
  assert.equal(audit.blockers.length, 4);
  assert.deepEqual(audit.memoryBudget, {
    framebufferRam: 62_000, descriptorRam: 48, decoderScratchRam: 0,
    nativeControllerAllocation: 62_164, admittedBundleBytes: 98_304, maximumThreeSlotFlash: 393_216,
  });
});
