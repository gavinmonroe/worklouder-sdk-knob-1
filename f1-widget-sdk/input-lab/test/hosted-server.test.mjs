import assert from "node:assert/strict";
import test from "node:test";

import { createInputLabServer, parseInputLabServerArgs } from "../server.mjs";
import { DEFAULT_INPUT_LAB_CSS, DEFAULT_INPUT_LAB_HTML } from "../lib/scene-template.mjs";

const ORIGIN = "https://htmlcss-to-framerf1-widget.g-m.dev";
const proxyHeaders = Object.freeze({ origin: ORIGIN,
  "x-forwarded-host": "htmlcss-to-framerf1-widget.g-m.dev" });

async function startHostedServer(context, options = {}) {
  const server = createInputLabServer({ hostedOrigin: ORIGIN,
    captureProvider: { capture: async () => { throw new Error("capture not used"); } }, ...options });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

test("hosted API is same-origin, compiler-only, and never performs device RPC", async (context) => {
  const base = await startHostedServer(context);
  const handshakeResponse = await fetch(`${base}/api/bridge`, { headers: proxyHeaders });
  assert.equal(handshakeResponse.status, 200);
  const handshake = await handshakeResponse.json();
  assert.deepEqual({ hosted: handshake.hosted, localOnly: handshake.localOnly, devicePush: handshake.devicePush,
    deviceTransport: handshake.deviceTransport },
  { hosted: true, localOnly: false, devicePush: false, deviceTransport: "browser-webhid" });
  const headers = { ...proxyHeaders, "content-type": "application/json",
    "x-input-lab-session": handshake.sessionToken };
  const compiled = await fetch(`${base}/api/compile`, { method: "POST", headers,
    body: JSON.stringify({ html: DEFAULT_INPUT_LAB_HTML, css: DEFAULT_INPUT_LAB_CSS }) });
  assert.equal(compiled.status, 200);
  assert.deepEqual((await compiled.json()).scene.viewport, { width: 100, height: 310 });
  const apply = await fetch(`${base}/api/apply`, { method: "POST", headers, body: "{}" });
  assert.equal(apply.status, 405);
  assert.equal((await apply.json()).error, "INPUT_LAB_BROWSER_DEVICE_REQUIRED");
  const noSession = await fetch(`${base}/api/compile`, { method: "POST",
    headers: { ...proxyHeaders, "content-type": "application/json" }, body: "{}" });
  assert.equal(noSession.status, 403);
  const attacker = await fetch(`${base}/api/bridge`, { headers: { origin: "https://attacker.example",
    "x-forwarded-host": "htmlcss-to-framerf1-widget.g-m.dev" } });
  assert.equal(attacker.status, 403);
});

test("hosted API allows only one expensive capture job at a time", async (context) => {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  let started;
  const didStart = new Promise((resolve) => { started = resolve; });
  const base = await startHostedServer(context, { captureProvider: { capture: async () => {
    started();
    await held;
    return { animation: { binary: Buffer.from("F1RA"), sha256: "a".repeat(64), stats: {},
      selectedFrameIndices: [], requestedFrameCount: 0, reduced: false }, pngFrames: [], settings: {} };
  } } });
  const handshake = await fetch(`${base}/api/bridge`, { headers: proxyHeaders }).then((response) => response.json());
  const headers = { ...proxyHeaders, "content-type": "application/json",
    "x-input-lab-session": handshake.sessionToken };
  const first = fetch(`${base}/api/capture`, { method: "POST", headers, body: "{}" });
  await didStart;
  const second = await fetch(`${base}/api/capture`, { method: "POST", headers, body: "{}" });
  assert.equal(second.status, 429);
  assert.equal((await second.json()).error, "INPUT_LAB_BUSY");
  release();
  assert.equal((await first).status, 200);
});

test("aaPanel hosted CLI arguments remain loopback-bound and exact-origin", () => {
  assert.deepEqual(parseInputLabServerArgs(["--hosted-origin", ORIGIN, "--host", "127.0.0.1",
    "--port", "9231", "--max-concurrent-jobs", "1"]), {
    confirmLiveRpc: false, hostedOrigin: ORIGIN, host: "127.0.0.1", port: 9231, maxConcurrentJobs: 1,
  });
  assert.throws(() => parseInputLabServerArgs(["--host", "0.0.0.0"]), /loopback/u);
  assert.throws(() => parseInputLabServerArgs(["--hosted-origin", "http://example.test"]), /HTTPS/u);
});
