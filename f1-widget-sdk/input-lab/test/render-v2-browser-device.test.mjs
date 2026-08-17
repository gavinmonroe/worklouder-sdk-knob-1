import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createDeterministicTestGlyphAtlas } from "../../src/render/index.mjs";
import { compileRenderV2Widget } from "../../src/render-v2/index.mjs";
import { BROWSER_RENDER_V2_PROFILE, BrowserFramerSceneClient,
  createBrowserRenderV2Upload } from "../lib/browser-scene-hid.mjs";

const example = new URL("../../examples/render-v2-events/", import.meta.url);

async function packageBytes() {
  const [html, css, script] = await Promise.all(["widget.html", "widget.css", "widget.js"]
    .map((name) => readFile(new URL(name, example), "utf8")));
  return (await compileRenderV2Widget({ html, css, script,
    atlasFactory: (glyphs) => createDeterministicTestGlyphAtlas(glyphs) })).package.binary;
}

function capabilities(generation = 1) {
  return { status: "ok", protocol: BROWSER_RENDER_V2_PROFILE.protocol,
    renderV2Profile: BROWSER_RENDER_V2_PROFILE.renderV2Profile,
    packageFormat: BROWSER_RENDER_V2_PROFILE.packageFormat,
    maxBundleBytes: BROWSER_RENDER_V2_PROFILE.maxBundleBytes,
    chunkRawBytes: BROWSER_RENDER_V2_PROFILE.chunkRawBytes,
    maxChunks: BROWSER_RENDER_V2_PROFILE.maxChunks, committedGeneration: generation };
}

test("browser generic upload rewrites only prefix generation and hashes the complete F1WB||F2EP", async () => {
  const original = await packageBytes();
  const upload = await createBrowserRenderV2Upload(original, 9);
  assert.equal(new DataView(upload.bytes.buffer).getUint32(8, true), 10);
  assert.deepEqual(Buffer.from(upload.bytes.slice(0, 8)), Buffer.from(original.slice(0, 8)));
  assert.deepEqual(Buffer.from(upload.bytes.slice(12)), Buffer.from(original.slice(12)));
  assert.equal(upload.manifest.sha256, createHash("sha256").update(upload.bytes).digest("hex"));
  assert.deepEqual(Buffer.concat(upload.chunks.map(({ data }) => Buffer.from(data, "base64"))),
    Buffer.from(upload.bytes));
});

test("browser client capability-gates v2, serializes RPC operations, and sends host events", async () => {
  const binary = await packageBytes(); const calls = []; let active = 0; let maximum = 0;
  const hidClient = { async call(method, params) {
    active += 1; maximum = Math.max(maximum, active); await new Promise((resolve) => setImmediate(resolve));
    calls.push({ method, params }); active -= 1;
    return method === "widget.scene.capabilities" ? capabilities(1) : { status: "ok" };
  }, async close() {} };
  const client = new BrowserFramerSceneClient({ hidClient, device: {} });
  const [published, host] = await Promise.all([
    client.pushRenderV2Package(binary), client.sendRenderV2HostEvent(0xb201, 7),
  ]);
  assert.equal(maximum, 1, "all browser HID calls must use one serialized operation queue");
  assert.equal(published.profile, BROWSER_RENDER_V2_PROFILE.renderV2Profile);
  assert.deepEqual(host, { status: "render-v2-host-event-acknowledged", id: 0xb201, value: 7 });
  assert.ok(calls.some(({ method }) => method === "widget.scene.begin"));
  assert.ok(calls.some(({ method, params }) => method === "widget.v2.event" && params.id === 0xb201));

  const blockedCalls = [];
  const blocked = new BrowserFramerSceneClient({ hidClient: { async call(method) {
    blockedCalls.push(method); return { status: "ok" };
  }, async close() {} }, device: {} });
  await assert.rejects(blocked.pushRenderV2Package(binary), { code: "RENDER_V2_DEVICE_ADMISSION_UNAVAILABLE" });
  assert.deepEqual(blockedCalls, ["widget.scene.capabilities"]);
});

test("browser v2 Push retries a busy begin with the exact same manifest and generation", async () => {
  const binary = await packageBytes(); const begins = []; let firstBegin = true;
  const hidClient = { async call(method, params) {
    if (method === "widget.scene.capabilities") return capabilities(41);
    if (method === "widget.scene.begin") {
      begins.push(structuredClone(params));
      if (firstBegin) { firstBegin = false; return { status: "error" }; }
    }
    return { status: "ok" };
  }, async close() {} };
  const client = new BrowserFramerSceneClient({ hidClient, device: {} });
  const published = await client.pushRenderV2Package(binary);
  assert.equal(published.generation, 42);
  assert.equal(begins.length, 2);
  assert.deepEqual(begins[1], begins[0]);
  assert.equal(begins[0].expectedGeneration, 41);
  assert.equal(begins[0].generation, 42);
});
