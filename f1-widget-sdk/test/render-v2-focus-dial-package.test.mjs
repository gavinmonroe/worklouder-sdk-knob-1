import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { encodeRasterAnimation } from "../src/render/raster-animation.mjs";
import { decodeWidgetBundle, encodeWidgetBundle } from "../src/render/widget-bundle.mjs";
import { WIDGET_SCENE_RPC_METHODS } from "../src/render/scene-rpc.mjs";
import {
  buildFocusDialPackage,
  createFocusDialPackageUpload,
  FOCUS_DIAL_PACKAGE,
  focusDialPackageAtGeneration,
  publishFocusDialPackageSmoke,
} from "../examples/render-v2-focus-dial/focus-package.mjs";
import {
  parseFocusPublisherArguments,
  runFocusDialPublisher,
} from "../examples/render-v2-focus-dial/tools/push-focus-package.mjs";

const example = new URL("../examples/render-v2-focus-dial/build/", import.meta.url);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function frozenPackage() {
  const [baseFrame, f2ep] = await Promise.all([
    readFile(new URL("render-v2-focus-dial.base.rgb565", example)),
    readFile(new URL("render-v2-focus-dial.f2ep", example)),
  ]);
  return buildFocusDialPackage({ baseFrame, f2ep, generation: 1 });
}

test("focus package independently reproduces the frozen one-frame F1WB and contiguous F2EP layout", async () => {
  const value = await frozenPackage();
  assert.deepEqual({ bytes: value.binary.length, sha256: value.sha256 }, {
    bytes: FOCUS_DIAL_PACKAGE.packageBytes,
    sha256: FOCUS_DIAL_PACKAGE.generationOnePackageSha256,
  });
  assert.equal(value.bundle.binary.length, FOCUS_DIAL_PACKAGE.f1wbBytes);
  assert.equal(value.bundle.sha256, FOCUS_DIAL_PACKAGE.generationOneF1wbSha256);
  assert.equal(value.f2ep.length, FOCUS_DIAL_PACKAGE.f2epBytes);
  assert.equal(sha256(value.f2ep), FOCUS_DIAL_PACKAGE.f2epSha256);
  assert.deepEqual(value.binary.subarray(0, FOCUS_DIAL_PACKAGE.f1wbBytes), value.bundle.binary);
  assert.deepEqual(value.binary.subarray(FOCUS_DIAL_PACKAGE.f1wbBytes), value.f2ep);

  const decoded = decodeWidgetBundle(value.bundle.binary);
  assert.equal(decoded.generation, 1);
  assert.equal(decoded.activeSlot, 0);
  assert.deepEqual(decoded.slots.map(({ name, kind }) => ({ name, kind })),
    [{ name: "focus-dial", kind: "raster" }]);
  assert.equal(decoded.slots[0].animationBinary.length, FOCUS_DIAL_PACKAGE.f1raBytes);
  assert.equal(sha256(decoded.slots[0].animationBinary), FOCUS_DIAL_PACKAGE.f1raSha256);
});

test("generation rewrite changes only the F1WB generation envelope and preserves raster plus F2EP bytes", async () => {
  const value = await frozenPackage();
  const second = focusDialPackageAtGeneration(value, 2);
  assert.equal(second.generation, 2);
  assert.equal(second.binary.length, FOCUS_DIAL_PACKAGE.packageBytes);
  assert.equal(second.sha256, "1803ddc003da1b28ced812f3e30f20aff9a7bd07c5cdb5189821bf190b944802");
  assert.equal(decodeWidgetBundle(second.bundle.binary).generation, 2);
  assert.deepEqual(second.bundle.binary.subarray(332), value.bundle.binary.subarray(332));
  assert.deepEqual(second.f2ep, value.f2ep);
  assert.deepEqual(second.binary.subarray(FOCUS_DIAL_PACKAGE.f1wbBytes), value.f2ep);

  const driftRaster = encodeRasterAnimation({ frames: [new Uint16Array(31_000)], width: 100,
    height: 310, fps: 1, loopDurationMs: 1_000, maxBytes: 128 * 1_024 });
  const driftBundle = encodeWidgetBundle({ generation: 1, activeSlot: 0,
    slots: [{ name: "focus-dial", kind: "raster", animationBinary: driftRaster.binary }] });
  assert.throws(() => focusDialPackageAtGeneration({ format: FOCUS_DIAL_PACKAGE.format,
    bundle: driftBundle, f2ep: value.f2ep }, 2), /exact raster slot/u);
});

test("focus upload is one bounded 26-chunk status-only scene transaction", async () => {
  const value = await frozenPackage();
  const upload = createFocusDialPackageUpload(value, { expectedGeneration: 1 });
  assert.deepEqual({ generation: upload.commit.generation, totalBytes: upload.commit.totalBytes,
    totalChunks: upload.commit.totalChunks, sha256: upload.commit.sha256 }, {
    generation: 2, totalBytes: 77_582, totalChunks: 26,
    sha256: "1803ddc003da1b28ced812f3e30f20aff9a7bd07c5cdb5189821bf190b944802",
  });
  assert.deepEqual(upload.chunks.map(({ index, offset, bytes }) => ({ index, offset, bytes })),
    Array.from({ length: 26 }, (_, index) => ({ index, offset: index * 3_072,
      bytes: index === 25 ? 782 : 3_072 })));
  assert.deepEqual(Buffer.concat(upload.chunks.map(({ data }) => Buffer.from(data, "base64"))),
    upload.package.binary);

  const calls = [];
  const progress = [];
  const result = await publishFocusDialPackageSmoke({ package: value, expectedGeneration: 1,
    rpc: async (method, params) => { calls.push({ method, params }); return { status: "ok" }; },
    onProgress(record) { progress.push(record); } });
  assert.deepEqual(result, { status: "FOCUS_DIAL_PACKAGE_COMMIT_ACKNOWLEDGED",
    generation: 2, bytes: 77_582, chunks: 26, sha256: upload.commit.sha256 });
  assert.deepEqual(calls.map(({ method }) => method), [WIDGET_SCENE_RPC_METHODS.begin,
    ...Array(26).fill(WIDGET_SCENE_RPC_METHODS.write), WIDGET_SCENE_RPC_METHODS.commit]);
  assert.deepEqual(progress.at(-1), { stage: "applying-on-keyboard" });
});

test("publisher aborts a rejected transaction and never treats an expanded response as acknowledged", async () => {
  const value = await frozenPackage();
  const calls = [];
  await assert.rejects(() => publishFocusDialPackageSmoke({ package: value, expectedGeneration: 1,
    rpc: async (method) => {
      calls.push(method);
      if (method === WIDGET_SCENE_RPC_METHODS.write) return { status: "error" };
      return { status: "ok" };
    } }), { code: "FOCUS_PACKAGE_RPC_REJECTED" });
  assert.deepEqual(calls, [WIDGET_SCENE_RPC_METHODS.begin, WIDGET_SCENE_RPC_METHODS.write,
    WIDGET_SCENE_RPC_METHODS.abort]);

  const indeterminate = [];
  await assert.rejects(() => publishFocusDialPackageSmoke({ package: value, expectedGeneration: 1,
    rpc: async (method) => { indeterminate.push(method); return { status: "ok", extra: true }; } }),
  { code: "FOCUS_PACKAGE_RPC_INDETERMINATE" });
  assert.deepEqual(indeterminate, [WIDGET_SCENE_RPC_METHODS.begin]);
});

test("live CLI requires explicit authority and routes every chunk through the pinned Input RPC transport", async () => {
  assert.throws(() => parseFocusPublisherArguments([]), /--confirm-live-rpc/u);
  assert.deepEqual(parseFocusPublisherArguments(["--confirm-live-rpc", "--expected-generation", "7",
    "--input-port", "9230"]), { confirmed: true, expectedGeneration: 7, port: 9230,
    syncLocalTime: false, hostSeconds: null });
  const calls = []; const lines = [];
  assert.equal(parseFocusPublisherArguments(["--confirm-live-rpc"]).expectedGeneration, 1);
  const result = await runFocusDialPublisher(["--confirm-live-rpc"], {
    log: (line) => lines.push(JSON.parse(line)),
    transportFactory: ({ port, timeoutMs }) => ({
      async rpc(method, params) { calls.push({ port, timeoutMs, method, params }); return { status: "ok" }; },
    }),
  });
  assert.equal(result.status, "FOCUS_DIAL_PACKAGE_COMMIT_ACKNOWLEDGED");
  assert.equal(result.generation, 2);
  assert.equal(calls.length, 28);
  assert.ok(calls.every(({ port, timeoutMs }) => port === 9230 && timeoutMs === 30_000));
  assert.deepEqual(calls.map(({ method }) => method), [WIDGET_SCENE_RPC_METHODS.begin,
    ...Array(26).fill(WIDGET_SCENE_RPC_METHODS.write), WIDGET_SCENE_RPC_METHODS.commit]);
  assert.equal(lines[0].status, "FOCUS_DIAL_PACKAGE_READY");
  assert.equal(lines.at(-1).status, "FOCUS_DIAL_PACKAGE_COMMIT_ACKNOWLEDGED");

  let waited = 0; let synced = null;
  const withSync = await runFocusDialPublisher(["--confirm-live-rpc", "--sync-local-time"], {
    log() {}, wait: async (milliseconds) => { waited = milliseconds; },
    now: () => new Date(2026, 7, 16, 20, 14, 34),
    sendHostEvent: async (value, options) => {
      synced = { value, options };
      return { value, target: { deviceFamily: "knob_f1", firmware: "0.4.1", usb: true } };
    },
    transportFactory: () => ({ async rpc() { return { status: "ok" }; } }),
  });
  assert.equal(waited, 250);
  assert.deepEqual(synced, { value: 72_874, options: { port: 9230 } });
  assert.equal(withSync.hostSync.value, 72_874);
});
