import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildInputWlrpcSceneExpression, InputWlrpcSceneTransport } from
  "../input-lab/lib/input-wlrpc-scene-transport.mjs";
import { FailClosedLiveSceneTransport, FRAMER_SCENE_HANDLER_CANDIDATES,
  LIVE_PROVEN_FRAMER_SCENE_HANDLERS } from "../input-lab/lib/scene-transport.mjs";
import { widgetSceneSha256 } from "../src/render/scene-rpc.mjs";

test("B9 receipt remains candidate base evidence and cannot authorize ID26 I/O", async () => {
  const candidate = FRAMER_SCENE_HANDLER_CANDIDATES[0];
  assert.equal(candidate.baseApp.sha256,
    "b9b8eec6250392f593ae664fa8b8cba64bf861f5ef49a427c65be79e6f355817");
  assert.equal(candidate.liveValidation.rpcAcceptancePending, true);
  assert.equal(candidate.liveValidation.heapTelemetryAccepted, false);
  const receipt = await readFile(new URL("../build/device-receipts/device-1786895154649-fast-smoke.json",
    import.meta.url));
  assert.equal(widgetSceneSha256(receipt), candidate.baseReceipt.sha256);
  assert.equal(JSON.parse(receipt).app.sha256, candidate.baseApp.sha256);
  assert.equal(LIVE_PROVEN_FRAMER_SCENE_HANDLERS.length, 0);
  const calls = [];
  const live = new FailClosedLiveSceneTransport({ proofId: candidate.id, confirmLiveRpc: true,
    transport: { rpc: async (...args) => { calls.push(args); return {}; } } });
  await assert.rejects(() => live.applySceneBundle({}),
    (error) => error.code === "NO_LIVE_INPUT_LAB_SCENE_TRANSPORT");
  assert.deepEqual(calls, []);
});

test("Input scene WLRPC adapter allowlists methods, base64-embeds params, and verifies target", async () => {
  const calls = [];
  const transport = new InputWlrpcSceneTransport({ evaluate: async (expression, options) => {
    calls.push({ expression, options });
    return { target: { deviceFamily: "knob_f1", firmware: "0.4.1", usb: true },
      response: { result: { status: "ok", accepted: true } } };
  } });
  const params = { protocol: "framer-widget-scene-rpc-v1", marker: "never-inline-this-marker" };
  assert.deepEqual(await transport.rpc("widget.scene.status", params), { status: "ok", accepted: true });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].options, { port: 9230, timeoutMs: 30_000 });
  assert.match(calls[0].expression, /Expected exactly one USB Framer F1/u);
  assert.doesNotMatch(calls[0].expression, /never-inline-this-marker/u);
  assert.throws(() => buildInputWlrpcSceneExpression("widget.scene.erase", {}), /Unsupported/u);
  await assert.rejects(transport.rpc("widget.scene.erase", {}), /Unsupported/u);
  assert.equal(calls.length, 1);
});

