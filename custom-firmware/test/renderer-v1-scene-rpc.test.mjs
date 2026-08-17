import assert from "node:assert/strict";
import test from "node:test";

import { encodeRasterAnimation } from "../../f1-widget-sdk/src/render/raster-animation.mjs";
import {
  createWidgetSceneUpload,
  WIDGET_SCENE_RPC_METHODS,
  WIDGET_SCENE_RPC_PROTOCOL,
  widgetSceneSha256,
} from "../../f1-widget-sdk/src/render/scene-rpc.mjs";
import { decodeWidgetBundle, encodeWidgetBundle } from "../../f1-widget-sdk/src/render/widget-bundle.mjs";
import { RendererV1Runtime, admitRendererV1DecodedWidgetBundle } from "../lib/renderer-v1-runtime.mjs";
import { RendererV1SceneRpcStaging, RENDERER_V1_SCENE_STORE } from "../lib/renderer-v1-scene-rpc.mjs";

function rasterBundle(color, generation = 0) {
  const frame = new Uint16Array(100 * 310).fill(color);
  const animation = encodeRasterAnimation({ frames: [frame], fps: 10, loopDurationMs: 100,
    maxBytes: 128 * 1024 });
  return encodeWidgetBundle({ slots: [{ name: "raster", kind: "raster", animationBinary: animation.binary }],
    generation });
}

function fixture(options = {}) {
  const initial = rasterBundle(0x1111, 0);
  const runtime = new RendererV1Runtime(admitRendererV1DecodedWidgetBundle(decodeWidgetBundle(initial.binary)));
  runtime.attach({ owner: "root", image: "image", uiThread: "ui" });
  runtime.tick100ms({ uiThread: "ui" });
  const staging = new RendererV1SceneRpcStaging({ runtime, proofId: "renderer-id26-test-proof",
    heapTelemetryAccepted: true, ...options });
  return { initial, runtime, staging };
}

function invoke(staging, method, params) { return staging.handleRpc(method, params); }

function rawUpload(binary, expectedGeneration, generation) {
  const chunkRawBytes = 3072;
  const sha256 = widgetSceneSha256(binary);
  const transactionId = `manual-${generation.toString(16).padStart(8, "0")}-${sha256.slice(0, 12)}`;
  const totalChunks = Math.ceil(binary.length / chunkRawBytes);
  const manifest = { protocol: WIDGET_SCENE_RPC_PROTOCOL, transactionId, expectedGeneration, generation,
    totalBytes: binary.length, totalChunks, chunkRawBytes, sha256 };
  const chunks = Array.from({ length: totalChunks }, (_, index) => {
    const offset = index * chunkRawBytes;
    const bytes = binary.subarray(offset, Math.min(binary.length, offset + chunkRawBytes));
    return { protocol: WIDGET_SCENE_RPC_PROTOCOL, transactionId, generation, index, offset, bytes: bytes.length,
      chunkSha256: widgetSceneSha256(bytes), data: bytes.toString("base64") };
  });
  return { manifest, chunks, commit: { protocol: WIDGET_SCENE_RPC_PROTOCOL, transactionId,
    expectedGeneration, generation, totalBytes: binary.length, totalChunks, sha256 } };
}

function send(staging, upload) {
  const begin = invoke(staging, WIDGET_SCENE_RPC_METHODS.begin, upload.manifest);
  assert.equal(begin.accepted, true);
  for (const chunk of upload.chunks) assert.equal(
    invoke(staging, WIDGET_SCENE_RPC_METHODS.write, chunk).accepted, true);
  return invoke(staging, WIDGET_SCENE_RPC_METHODS.commit, upload.commit);
}

test("single-store upload freezes the old frame, publishes header last, and commits on UI tick", () => {
  const { runtime, staging } = fixture();
  assert.deepEqual(RENDERER_V1_SCENE_STORE, { maxBundleBytes: 98_304, framebufferBytes: 62_000,
    commitHeaderBytes: 20, minimumRendererBytes: 160_304,
    model: "single-store-freeze-header-last", rollbackMode: "freeze-last-frame" });
  const upload = createWidgetSceneUpload(rasterBundle(0x2468), { expectedGeneration: 0, generation: 1 });
  assert.equal(invoke(staging, WIDGET_SCENE_RPC_METHODS.begin, upload.manifest).accepted, true);
  assert.equal(staging.sceneStore.subarray(0, 4).every((byte) => byte === 0), true);
  assert.equal(staging.tick100ms({ uiThread: "ui" }).reason, "scene-upload-frozen");
  for (const chunk of upload.chunks) assert.equal(invoke(staging, WIDGET_SCENE_RPC_METHODS.write, chunk).accepted, true);
  assert.equal(staging.sceneStore.subarray(0, 4).every((byte) => byte === 0), true,
    "F1WB publication marker stays absent while bytes stream in place");
  const queued = invoke(staging, WIDGET_SCENE_RPC_METHODS.commit, upload.commit);
  assert.equal(queued.commitStatus, "queued");
  assert.equal(staging.sceneStore.subarray(0, 4).toString("ascii"), "F1WB");
  assert.equal(staging.committedGeneration, 0);
  assert.equal(staging.tick100ms({ uiThread: "ui" }).rendered, true);
  assert.equal(staging.committedGeneration, 1);
  assert.equal(runtime.framebuffer.readUInt16LE(0), 0x2468);
  assert.equal(staging.status({ protocol: WIDGET_SCENE_RPC_PROTOCOL }).displayState, "running");
});

test("reordered and torn chunks fail closed without advancing generation", () => {
  for (const mode of ["reordered", "torn"]) {
    const { staging } = fixture();
    const upload = createWidgetSceneUpload(rasterBundle(0x2222), { expectedGeneration: 0, generation: 1 });
    assert.equal(invoke(staging, WIDGET_SCENE_RPC_METHODS.begin, upload.manifest).accepted, true);
    const result = mode === "reordered"
      ? invoke(staging, WIDGET_SCENE_RPC_METHODS.write, upload.chunks[1])
      : invoke(staging, WIDGET_SCENE_RPC_METHODS.commit, upload.commit);
    assert.equal(result.accepted, false);
    assert.match(result.code, mode === "reordered" ? /REORDERED/u : /TORN/u);
    const status = staging.status({ protocol: WIDGET_SCENE_RPC_PROTOCOL });
    assert.equal(status.committedGeneration, 0);
    assert.equal(status.sceneStoreValid, false);
    assert.equal(status.displayState, "frozen-last-frame");
  }
});

test("oversize begin is rejected before freezing or touching the one scene store", () => {
  const { staging } = fixture();
  const upload = createWidgetSceneUpload(rasterBundle(0x3333), { expectedGeneration: 0, generation: 1 });
  const result = invoke(staging, WIDGET_SCENE_RPC_METHODS.begin,
    { ...upload.manifest, totalBytes: 98_305, totalChunks: 33 });
  assert.equal(result.accepted, false);
  assert.equal(result.code, "SCENE_BUNDLE_OVERSIZE");
  assert.equal(staging.status({ protocol: WIDGET_SCENE_RPC_PROTOCOL }).displayState, "running");
  assert.equal(invoke(staging, WIDGET_SCENE_RPC_METHODS.commit, upload.commit).accepted, false);
  assert.equal(staging.status({ protocol: WIDGET_SCENE_RPC_PROTOCOL }).displayState, "running",
    "an unsolicited commit cannot freeze a healthy renderer");
});

test("valid transaction hash cannot hide malformed F1WB and retry uses the same next generation", () => {
  const { runtime, staging } = fixture();
  const first = createWidgetSceneUpload(rasterBundle(0x4444), { expectedGeneration: 0, generation: 1 });
  assert.equal(send(staging, first).commitStatus, "queued");
  staging.tick100ms({ uiThread: "ui" });
  assert.equal(staging.committedGeneration, 1);

  const validSecond = createWidgetSceneUpload(rasterBundle(0x5555), { expectedGeneration: 1, generation: 2 });
  const malformed = Buffer.from(validSecond.bundle.binary);
  malformed[20 + 100] = 1; // descriptor reserved byte; all envelope hashes below are recomputed.
  const rejected = send(staging, rawUpload(malformed, 1, 2));
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.code, "SCENE_F1WB_DESCRIPTOR");
  assert.equal(staging.committedGeneration, 1);
  assert.equal(staging.status({ protocol: WIDGET_SCENE_RPC_PROTOCOL }).recoveryRequired, true);

  assert.equal(send(staging, validSecond).commitStatus, "queued");
  staging.tick100ms({ uiThread: "ui" });
  assert.equal(staging.committedGeneration, 2);
  assert.equal(runtime.framebuffer.readUInt16LE(0), 0x5555);
});

test("abort and timeout discard the publication header and retain the last frame", () => {
  let now = 1000;
  const { staging } = fixture({ now: () => now, transactionTimeoutMs: 1000 });
  const upload = createWidgetSceneUpload(rasterBundle(0x6666), { expectedGeneration: 0, generation: 1 });
  invoke(staging, WIDGET_SCENE_RPC_METHODS.begin, upload.manifest);
  const aborted = invoke(staging, WIDGET_SCENE_RPC_METHODS.abort,
    { protocol: WIDGET_SCENE_RPC_PROTOCOL, transactionId: upload.manifest.transactionId, generation: 1 });
  assert.equal(aborted.aborted, true);
  assert.equal(staging.sceneStore.subarray(0, 4).every((byte) => byte === 0), true);

  invoke(staging, WIDGET_SCENE_RPC_METHODS.begin, upload.manifest);
  now += 1001;
  const status = staging.status({ protocol: WIDGET_SCENE_RPC_PROTOCOL });
  assert.equal(status.uploadActive, false);
  assert.equal(status.recoveryRequired, true);
  assert.equal(status.committedGeneration, 0);
});
