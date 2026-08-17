import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { encodeRasterAnimation } from "../src/render/raster-animation.mjs";
import {
  createWidgetSceneUpload,
  publishWidgetSceneBundle,
  publishWidgetSceneBundleSmoke,
  WIDGET_SCENE_RPC_LIMITS,
  WIDGET_SCENE_RPC_METHODS,
  WIDGET_SCENE_RPC_PROTOCOL,
} from "../src/render/scene-rpc.mjs";
import { decodeWidgetBundle, encodeWidgetBundle } from "../src/render/widget-bundle.mjs";

const matrixBundle = async () => decodeWidgetBundle(await readFile(new URL(
  "../examples/jp-matrix/build/jp-matrix-three-slots.f1wb", import.meta.url)));

function capabilities(overrides = {}) {
  return { status: "ok", accepted: true, protocol: WIDGET_SCENE_RPC_PROTOCOL,
    proofId: "renderer-id26-test-proof", deviceFamily: "knob_f1", firmware: "0.4.1", screenId: 26,
    atomicF1wb: true, uiThreadApply: true, ramOnly: true, persistence: false,
    singleSceneStore: true, freezeOnUpload: true, headerLastCommit: true,
    rollbackMode: "freeze-last-frame", maxBundleBytes: 96 * 1024, sceneStoreBytes: 96 * 1024,
    framebufferBytes: 62_000, minimumRendererBytes: 96 * 1024 + 62_000,
    heapTelemetryAccepted: true, chunkRawBytes: 3072, maxChunks: 32,
    committedGeneration: 4, committedSha256: "none", ...overrides };
}

test("scene upload rewrites generation and emits deterministic bounded sequential chunks", async () => {
  const bundle = await matrixBundle();
  const first = createWidgetSceneUpload(bundle, { expectedGeneration: 4, generation: 5 });
  const second = createWidgetSceneUpload(bundle, { expectedGeneration: 4, generation: 5 });
  assert.deepEqual(first.manifest, second.manifest);
  assert.deepEqual(first.chunks, second.chunks);
  assert.equal(first.bundle.decoded.generation, 5);
  assert.ok(first.bundle.binary.length <= WIDGET_SCENE_RPC_LIMITS.maxBundleBytes);
  assert.equal(first.chunks.length, Math.ceil(first.bundle.binary.length / 3072));
  assert.deepEqual(first.chunks.map(({ index, offset }) => [index, offset]),
    first.chunks.map((_, index) => [index, index * 3072]));
});

test("scene publisher negotiates exact single-store memory proof and commits in order", async () => {
  const bundle = await matrixBundle();
  const methods = [];
  const rpc = async (method, params) => {
    methods.push(method);
    if (method === WIDGET_SCENE_RPC_METHODS.capabilities) return capabilities();
    if (method === WIDGET_SCENE_RPC_METHODS.commit) return { status: "ok", accepted: true, commitStatus: "committed" };
    return { status: "ok", accepted: true, index: params.index };
  };
  const result = await publishWidgetSceneBundle({ bundle, rpc, expectedProofId: "renderer-id26-test-proof" });
  assert.equal(result.generation, 5);
  assert.deepEqual(methods, [WIDGET_SCENE_RPC_METHODS.capabilities, WIDGET_SCENE_RPC_METHODS.begin,
    ...Array(result.chunks).fill(WIDGET_SCENE_RPC_METHODS.write), WIDGET_SCENE_RPC_METHODS.commit]);
});

test("scene publisher rejects missing heap/single-store proof before begin and aborts pre-commit failures", async () => {
  const bundle = await matrixBundle();
  const weakCalls = [];
  await assert.rejects(() => publishWidgetSceneBundle({ bundle, expectedProofId: "renderer-id26-test-proof",
    rpc: async (method) => { weakCalls.push(method); return capabilities({ heapTelemetryAccepted: false }); } }), /heap telemetry/u);
  assert.deepEqual(weakCalls, [WIDGET_SCENE_RPC_METHODS.capabilities]);

  const calls = [];
  await assert.rejects(() => publishWidgetSceneBundle({ bundle, expectedProofId: "renderer-id26-test-proof",
    rpc: async (method, params) => {
      calls.push(method);
      if (method === WIDGET_SCENE_RPC_METHODS.capabilities) return capabilities();
      if (method === WIDGET_SCENE_RPC_METHODS.write && params.index === 1) {
        return { status: "error", accepted: false, reason: "test rejection" };
      }
      return { status: "ok", accepted: true };
    } }), /test rejection/u);
  assert.equal(calls.at(-1), WIDGET_SCENE_RPC_METHODS.abort);
  assert.ok(!calls.includes(WIDGET_SCENE_RPC_METHODS.commit));
});

test("status-only canary advances an explicit session generation and retries only an explicit busy begin", async () => {
  const bundle = await matrixBundle();
  const calls = [];
  const waits = [];
  const progress = [];
  let begins = 0;
  const result = await publishWidgetSceneBundleSmoke({ bundle, confirmed: true,
    expectedGeneration: 1, retryBeginOnce: true, beginRetryMs: 150,
    wait: async (milliseconds) => { waits.push(milliseconds); },
    onProgress: (event) => progress.push(event),
    rpc: async (method, params) => {
      calls.push({ method, params });
      if (method === WIDGET_SCENE_RPC_METHODS.begin && begins++ === 0) return { status: "error" };
      return { status: "ok" };
    } });
  const beginCalls = calls.filter(({ method }) => method === WIDGET_SCENE_RPC_METHODS.begin);
  assert.equal(beginCalls.length, 2);
  assert.deepEqual(beginCalls[0].params, beginCalls[1].params, "retry must preserve transaction and generation");
  assert.deepEqual(waits, [150]);
  assert.equal(result.expectedGeneration, 1);
  assert.equal(result.generation, 2);
  assert.deepEqual({ status: result.status, proofBacked: result.proofBacked,
    uiHandoffVerified: result.uiHandoffVerified }, {
    status: "live-canary-commit-acknowledged", proofBacked: false, uiHandoffVerified: false });
  assert.equal(calls.at(-1).method, WIDGET_SCENE_RPC_METHODS.commit);
  assert.ok(!calls.some(({ method }) => method === WIDGET_SCENE_RPC_METHODS.capabilities ||
    method === WIDGET_SCENE_RPC_METHODS.status));
  assert.deepEqual(progress, [
    { stage: "uploading-chunks", current: 0, total: result.chunks },
    ...Array.from({ length: result.chunks }, (_, index) =>
      ({ stage: "uploading-chunks", current: index + 1, total: result.chunks })),
    { stage: "applying-on-keyboard" },
  ]);
});

test("status-only canary rejects rich replies and poisons an indeterminate commit without aborting", async () => {
  const bundle = await matrixBundle();
  const richCalls = [];
  await assert.rejects(() => publishWidgetSceneBundleSmoke({ bundle, confirmed: true,
    expectedGeneration: 1, retryBeginOnce: true, wait: async () => {},
    rpc: async (method) => { richCalls.push(method); return { status: "ok", accepted: true }; } }),
  (error) => error.code === "SCENE_RPC_REJECTED");
  assert.deepEqual(richCalls, [WIDGET_SCENE_RPC_METHODS.begin],
    "an accepted-looking non-status-only begin must not be replayed");

  const commitCalls = [];
  await assert.rejects(() => publishWidgetSceneBundleSmoke({ bundle, confirmed: true,
    expectedGeneration: 1, rpc: async (method) => {
      commitCalls.push(method);
      if (method === WIDGET_SCENE_RPC_METHODS.commit) throw new Error("timeout");
      return { status: "ok" };
    } }), (error) => error.code === "SCENE_COMMIT_INDETERMINATE");
  assert.equal(commitCalls.at(-1), WIDGET_SCENE_RPC_METHODS.commit,
    "an indeterminate commit must never race an abort");
});

test("whole F1WB live cap rejects a valid dense raster before any RPC", () => {
  const first = new Uint16Array(100 * 310).fill(0x1111);
  const second = new Uint16Array(100 * 310).fill(0xeeee);
  const raster = encodeRasterAnimation({ frames: [first, second], fps: 10,
    loopDurationMs: 200, maxBytes: 128 * 1024 });
  const bundle = encodeWidgetBundle({ slots: [{ name: "dense", kind: "raster", animationBinary: raster.binary }],
    generation: 1 });
  assert.ok(bundle.binary.length > WIDGET_SCENE_RPC_LIMITS.maxBundleBytes);
  assert.throws(() => createWidgetSceneUpload(bundle, { expectedGeneration: 0, generation: 1 }),
    (error) => error.code === "SCENE_BUNDLE_OVERSIZE");
});
