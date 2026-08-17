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
    maxBundleBytes: String(BROWSER_RENDER_V2_PROFILE.maxBundleBytes),
    chunkRawBytes: String(BROWSER_RENDER_V2_PROFILE.chunkRawBytes),
    maxChunks: String(BROWSER_RENDER_V2_PROFILE.maxChunks), committedGeneration: String(generation),
    v1Packages: "true" };
}

function minimalV1Bundle() {
  const binary = Buffer.alloc(332);
  binary.write("F1WB", 0, "ascii"); binary[4] = 1; binary[5] = 3; binary[6] = 3;
  binary.writeUInt32LE(binary.length, 12); binary.writeUInt16LE(104, 16); binary.writeUInt16LE(332, 18);
  return binary;
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

test("capability numbers and V1 support use one exact string-only contract", async () => {
  const malformed = [
    { maxBundleBytes: BROWSER_RENDER_V2_PROFILE.maxBundleBytes },
    { chunkRawBytes: "+3072" },
    { maxChunks: " 32" },
    { committedGeneration: "01" },
    { committedGeneration: "-1" },
    { v1Packages: true },
  ];
  for (const override of malformed) {
    const response = { ...capabilities(1), ...override };
    const client = new BrowserFramerSceneClient({ hidClient: { async call() { return response; }, async close() {} } });
    await assert.rejects(client.probeRenderV2Capabilities(),
      { code: "RENDER_V2_DEVICE_ADMISSION_UNAVAILABLE" });
    assert.equal(client.renderV2CapabilityStatus, "generic-incompatible");
    await assert.rejects(client.pushBundle(minimalV1Bundle()),
      { code: "RENDER_V1_DEVICE_ADMISSION_UNAVAILABLE" });
  }
  const accepted = new BrowserFramerSceneClient({ hidClient: { async call(method) {
    return method === "widget.scene.capabilities" ? capabilities(7) : { status: "ok" };
  }, async close() {} } });
  const advertised = await accepted.probeRenderV2Capabilities();
  assert.equal(advertised.committedGeneration, 7);
  assert.equal(advertised.v1Packages, true);
  assert.equal((await accepted.pushBundle(minimalV1Bundle())).generation, 8);
});

test("browser v2 upload rejects noncanonical one-frame base fields before transport", async () => {
  const original = await packageBytes();
  for (const mutate of [
    (value) => { value[120] = 1; },
    (value) => { new DataView(value.buffer, value.byteOffset).setUint32(12, 62_400, true); },
    (value) => { new DataView(value.buffer, value.byteOffset).setUint32(332 + 64 + 4, 61_998, true); },
  ]) {
    const hostile = new Uint8Array(original); mutate(hostile);
    await assert.rejects(createBrowserRenderV2Upload(hostile, 1), /canonical|one full|F1WB/u);
  }
});

test("rich or malformed commit replies make V1 and V2 sessions indeterminate without abort", async () => {
  const v2Binary = await packageBytes();
  for (const { binary, v2 } of [{ binary: minimalV1Bundle(), v2: false }, { binary: v2Binary, v2: true }]) {
    const calls = [];
    const client = new BrowserFramerSceneClient({ hidClient: { async call(method) {
      calls.push(method);
      if (method === "widget.scene.capabilities") return capabilities(1);
      if (method === "widget.scene.commit") return { status: "ok", generation: 2 };
      return { status: "ok" };
    }, async close() {} } });
    const operation = v2 ? client.pushRenderV2Package(binary) : client.pushBundle(binary);
    await assert.rejects(operation, { code: "SCENE_COMMIT_INDETERMINATE" });
    assert.equal(client.indeterminate, true);
    assert.equal(calls.includes("widget.scene.abort"), false,
      "an ambiguous commit must never be followed by a rollback-looking abort");
    const before = calls.length;
    await assert.rejects(client.sendRenderV2HostEvent(1, 0), /indeterminate/u);
    assert.equal(calls.length, before, "indeterminate sessions must not issue later RPCs");
  }
});
