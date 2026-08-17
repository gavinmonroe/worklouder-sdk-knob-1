import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { createInputLabServer } from "../server.mjs";
import { bridgeAllowsPush, defaultInputLabBridgeUrl, InputLabBridgeClient, INPUT_LAB_BRIDGE_PROTOCOL,
  normalizeInputLabBridgeUrl } from "../lib/bridge-client.mjs";
import { createInputLabProject, createOfflinePreviewDocument, INPUT_LAB_PROJECT_FORMAT,
  serializeInputLabProject } from "../lib/browser-project.mjs";
import { BrowserFramerSceneClient } from "../lib/browser-scene-hid.mjs";
import { approveInputLabFlashIdentity,
  createInputLabFlashWorkflow } from "../lib/browser-flash-workflow.mjs";
import { MockSceneTransport } from "../lib/scene-transport.mjs";

const execFileAsync = promisify(execFile);
const sdkRoot = path.resolve(import.meta.dirname, "../..");

test("Vite emits one relative static Input Lab app with offline editing/export and no native device code", async (context) => {
  const output = await mkdtemp(path.join(os.tmpdir(), "input-lab-vite-"));
  context.after(() => rm(output, { recursive: true, force: true }));
  await execFileAsync(path.join(sdkRoot, "node_modules/.bin/vite"), ["build", "--config",
    path.join(sdkRoot, "input-lab/vite.config.mjs"), "--outDir", output], { cwd: sdkRoot });
  const html = await readFile(path.join(output, "index.html"), "utf8");
  assert.match(html, /\.\/assets\/index-[^"']+\.js/u);
  assert.match(html, /id="browser-preview"[^>]*sandbox/u);
  assert.match(html, /id="apply"[^>]*disabled/u);
  const assets = await readdir(path.join(output, "assets"));
  const mainAsset = html.match(/\.\/assets\/([^"']+\.js)/u)?.[1];
  assert.ok(mainAsset);
  const javascript = await readFile(path.join(output, "assets", mainAsset), "utf8");
  assert.match(javascript, /input-lab-project\.json/u);
  assert.match(javascript, /Compiler: unavailable/u);
  assert.match(javascript, /127\.0\.0\.1:9231/u);
  assert.match(javascript, /\/api\/bundle/u);
  assert.doesNotMatch(javascript, /\/api\/apply/u);
  assert.doesNotMatch(javascript, /node:|InputWlrpcSceneTransport|connectToDevice|node-hid/u);
  const publicJavascript = (await Promise.all(assets.filter((name) => name.endsWith(".js"))
    .map((name) => readFile(path.join(output, "assets", name), "utf8")))).join("\n");
  assert.doesNotMatch(publicJavascript, /\/Users\/gavin|device-1786895154649|combined-renderer-id26-manifest/u,
    "public Input Lab assets must not embed internal manifests, receipts, or workstation paths");
  assert.equal(assets.filter((name) => name.endsWith(".bin")).length, 1,
    "Input Lab packages only its exact renderer app, not the full flasher catalog");
});

test("device preview keeps a native 100x310 viewport and scales one shared stage inside its frame", async () => {
  const [html, css, app] = await Promise.all([
    readFile(path.join(sdkRoot, "input-lab/index.html"), "utf8"),
    readFile(path.join(sdkRoot, "input-lab/styles.css"), "utf8"),
    readFile(path.join(sdkRoot, "input-lab/app.mjs"), "utf8"),
  ]);
  assert.match(html, /class="preview-stage"[\s\S]*canvas id="preview" width="100" height="310"[\s\S]*iframe id="browser-preview"/u);
  assert.match(css, /\.device-frame\s*\{[^}]*width:\s*100%[^}]*max-width:\s*230px[^}]*overflow:\s*hidden/u);
  assert.match(css, /#preview,\s*#browser-preview\s*\{[^}]*width:\s*100px[^}]*height:\s*310px[^}]*transform:\s*scale/u);
  assert.doesNotMatch(css, /width:\s*200px|height:\s*620px/u);
  assert.match(app, /Math\.min\(2,\s*availableWidth\s*\/\s*100,\s*availableHeight\s*\/\s*310\)/u);
  assert.match(app, /new ResizeObserver\(fitPreviewStage\)/u);
});

test("hosted Apply requires both the compiler and WebHID and has no bridge override or server-side Push", async () => {
  const [html, app] = await Promise.all([
    readFile(path.join(sdkRoot, "input-lab/index.html"), "utf8"),
    readFile(path.join(sdkRoot, "input-lab/app.mjs"), "utf8"),
  ]);
  assert.match(html, /Compiler: checking/u);
  assert.match(app, /elements\.apply\.disabled =[\s\S]{0,200}!bridge \|\| !browserDevice/u);
  assert.match(app, /renderV2Busy \|\| keyPressed/u,
    "serialized V2 work and a held browser key must also keep Apply disabled");
  assert.doesNotMatch(app, /bridgeAllowsPush|URLSearchParams|\/api\/apply/u);
  const compileBundle = app.indexOf('request("/api/bundle"');
  const browserPush = app.indexOf("browserDevice.pushBundle", compileBundle);
  assert.ok(compileBundle > 0 && browserPush > compileBundle,
    "Apply must compile the bundle through the API before its browser WebHID Push");
});

test("static project export preserves exactly three editable previews and sandbox preview blocks active content", () => {
  const slots = Array.from({ length: 3 }, (_, index) => ({ name: `Preview ${index + 1}`, mode: "auto",
    html: `<div class="scene">${index}</div>`, css: `.scene{color:#eee}`, settings: { fps: 5 } }));
  const project = createInputLabProject({ slots, activeSlot: 2, exportedAt: "2026-08-16T00:00:00.000Z" });
  assert.equal(project.format, INPUT_LAB_PROJECT_FORMAT);
  assert.deepEqual(project.viewport, { width: 100, height: 310 });
  assert.equal(JSON.parse(serializeInputLabProject(project)).slots.length, 3);
  const preview = createOfflinePreviewDocument({ html: '<svg><filter id="noise"></filter></svg><div class="orb"></div>',
    css: '.orb{filter:url("#noise")}', interaction: "hover" });
  assert.match(preview, /script-src 'none'/u);
  assert.match(preview, /class="input-lab-hover"/u);
  assert.throws(() => createOfflinePreviewDocument({ html: "<script>bad()</script>", css: "" }), /blocks/u);
  assert.throws(() => createOfflinePreviewDocument({ html: "<div></div>",
    css: ".x{background:url(https://example.test/x)}" }), /local SVG/u);
});

test("editor autosaves source, settings, and slot names before navigation or shutdown", async () => {
  const app = await readFile(path.join(sdkRoot, "input-lab/app.mjs"), "utf8");
  assert.match(app, /function scheduleAutosave\(\)[\s\S]*persistCurrentSlot/u);
  assert.match(app, /load\.addEventListener\("click", async \(\) => \{\s*flushAutosave\(\)/u);
  assert.match(app, /elements\.apply\.addEventListener\("click", async \(\) => \{[\s\S]*flushAutosave\(\)/u);
  assert.match(app, /window\.addEventListener\("pagehide", flushAutosave\)/u);
  assert.match(app, /store\.renameSlot\(index, name\.value\)/u);
});

test("localhost bridge exposes a CORS-bound capability handshake and keeps Push gated for mock mode", async (context) => {
  const origin = "https://lab.example";
  const server = createInputLabServer({ transport: new MockSceneTransport(), allowedOrigins: [origin],
    captureProvider: { capture: async () => { throw new Error("not used"); } } });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${baseUrl}/api/bridge`, { headers: { origin } });
  assert.equal(response.headers.get("access-control-allow-origin"), origin);
  const capabilities = await response.json();
  assert.equal(capabilities.protocol, INPUT_LAB_BRIDGE_PROTOCOL);
  assert.equal(capabilities.localOnly, true);
  assert.equal(capabilities.devicePush, false);
  assert.equal(bridgeAllowsPush(capabilities), false);
  const preflight = await fetch(`${baseUrl}/api/bundle`, { method: "OPTIONS", headers: { origin,
    "access-control-request-method": "POST", "access-control-request-private-network": "true" } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-private-network"), "true");
  const unauthenticatedCompile = await fetch(`${baseUrl}/api/compile`, { method: "POST", headers: { origin,
    "content-type": "application/json" }, body: "{}" });
  assert.equal(unauthenticatedCompile.status, 403, "remote compile/capture must require the bridge session");
  const unauthenticatedBundle = await fetch(`${baseUrl}/api/bundle`, { method: "POST", headers: { origin,
    "content-type": "application/json" }, body: "{}" });
  assert.equal(unauthenticatedBundle.status, 403, "bundle compilation must remain session-authenticated");
  const denied = await fetch(`${baseUrl}/api/bridge`, { headers: { origin: "https://attacker.example" } });
  assert.equal(denied.status, 403);
  const client = new InputLabBridgeClient({ baseUrl, fetchImpl: (url, options) =>
    fetch(url, { ...options, headers: { ...options.headers, origin } }) });
  assert.deepEqual(await client.connect(), capabilities);
});

test("compiler API URL and Push proof stay fail-closed", () => {
  assert.equal(defaultInputLabBridgeUrl("https://htmlcss-to-framerf1-widget.g-m.dev/editor"),
    "https://htmlcss-to-framerf1-widget.g-m.dev");
  assert.equal(defaultInputLabBridgeUrl("http://localhost:5174/"), "http://127.0.0.1:9231");
  assert.equal(normalizeInputLabBridgeUrl("http://localhost:9231/"), "http://localhost:9231");
  assert.equal(normalizeInputLabBridgeUrl("https://lab.example/", { pageUrl: "https://lab.example/editor" }),
    "https://lab.example");
  for (const value of ["https://127.0.0.1:9231", "http://example.com:9231", "file:///tmp/bridge"])
    assert.throws(() => normalizeInputLabBridgeUrl(value), /loopback/u);
  assert.throws(() => normalizeInputLabBridgeUrl("https://api.example", { pageUrl: "https://lab.example" }),
    /hosted page's HTTPS origin/u);
  assert.throws(() => normalizeInputLabBridgeUrl("http://127.0.0.1:9231", { pageUrl: "https://lab.example" }),
    /hosted page's HTTPS origin/u);
  assert.equal(bridgeAllowsPush({ protocol: INPUT_LAB_BRIDGE_PROTOCOL, devicePush: true,
    sessionToken: "x".repeat(43) }), true);
  assert.equal(bridgeAllowsPush({ protocol: INPUT_LAB_BRIDGE_PROTOCOL, devicePush: false,
    sessionToken: "x".repeat(43) }), false);
});

test("hosted compiler client uses same-origin APIs and credentials while localhost dev keeps port 9231", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => ({ protocol: INPUT_LAB_BRIDGE_PROTOCOL,
      sessionToken: "x".repeat(43), devicePush: false }) };
  };
  const pageUrl = "https://htmlcss-to-framerf1-widget.g-m.dev/input-lab";
  const client = new InputLabBridgeClient({ pageUrl, fetchImpl });
  assert.equal(client.baseUrl, "https://htmlcss-to-framerf1-widget.g-m.dev");
  assert.equal(client.credentials, "same-origin");
  await client.connect();
  await client.request("/api/bundle", { slots: [] });
  assert.deepEqual(calls.map(({ url }) => url), [
    "https://htmlcss-to-framerf1-widget.g-m.dev/api/bridge",
    "https://htmlcss-to-framerf1-widget.g-m.dev/api/bundle",
  ]);
  assert.deepEqual(calls.map(({ options }) => options.credentials), ["same-origin", "same-origin"]);
  await assert.rejects(client.request("/api/apply", {}), /Unsupported Input Lab bridge endpoint/u);

  const local = new InputLabBridgeClient({ pageUrl: "http://localhost:5174/", fetchImpl });
  assert.equal(local.baseUrl, "http://127.0.0.1:9231");
  assert.equal(local.credentials, "omit");
});

test("bridge client preserves browser fetch invocation semantics", async () => {
  let receiver = "not-called";
  function browserLikeFetch() {
    receiver = this;
    return Promise.resolve({ ok: true, status: 200, json: async () => ({
      protocol: INPUT_LAB_BRIDGE_PROTOCOL, sessionToken: "x".repeat(43), devicePush: false,
    }) });
  }
  const client = new InputLabBridgeClient({ fetchImpl: browserLikeFetch });
  await client.connect();
  assert.equal(receiver, undefined);
});

test("browser WebHID scene publisher uses canonical status-only chunks without Node polyfills", async () => {
  const calls = [];
  const hidClient = { call: async (method, params) => { calls.push({ method, params }); return { status: "ok" }; },
    close: async () => {} };
  const client = new BrowserFramerSceneClient({ hidClient, device: { serialNumber: "A4CB8FAF3210" } });
  const bundle = new Uint8Array(400);
  bundle.set(new TextEncoder().encode("F1WB"));
  bundle[4] = 1;
  bundle[5] = 3;
  bundle[6] = 3;
  bundle[7] = 0;
  new DataView(bundle.buffer).setUint32(12, bundle.length, true);
  const progress = [];
  const result = await client.pushBundle(bundle, { onProgress: (event) => progress.push(event) });
  assert.equal(result.generation, 2);
  assert.deepEqual(calls.map(({ method }) => method), ["widget.scene.begin", "widget.scene.write", "widget.scene.commit"]);
  assert.equal(calls[0].params.expectedGeneration, 1);
  assert.equal(calls[0].params.generation, 2);
  assert.equal(calls[1].params.offset, 0);
  assert.equal(calls[1].params.bytes, bundle.length);
  assert.match(calls[1].params.chunkSha256, /^[0-9a-f]{64}$/u);
  assert.deepEqual(progress.map(({ stage }) => stage), ["uploading-chunks", "uploading-chunks", "applying-on-keyboard"]);
});

test("Input Lab inherits the shared sequential bootloader inspection lock fix", async () => {
  const source = await readFile(path.resolve(sdkRoot, "../web-flasher/src/lib/flasher.js"), "utf8");
  const readMac = source.indexOf("await loader.chip.readMac(loader)");
  const flashSize = source.indexOf("await loader.detectFlashSize()", readMac);
  const security = source.indexOf("await readSecurityState(loader)", flashSize);
  assert.ok(readMac > 0 && flashSize > readMac && security > flashSize,
    "identity commands must remain explicitly awaited in serial order");
  const body = source.slice(source.indexOf("export async function readBootloaderState"),
    source.indexOf("export async function exitBootloaderWithoutWrite"));
  assert.doesNotMatch(body, /Promise\.all|\.map\s*\(\s*async/u);
});

test("Input Lab delegates one complete serial transaction to the shared app-only flasher", async () => {
  const calls = [];
  const port = Object.freeze({ id: "approved-port" });
  const device = Object.freeze({ productId: 0x8396 });
  class FakeHidClient {
    constructor(value) { assert.equal(value, device); }
    async open() { calls.push("hid-open"); return this; }
    async verifyVersion() { calls.push("hid-version"); }
    async enterBootloader() { calls.push("hid-bootloader"); }
    async close() { calls.push("hid-close"); }
  }
  let serialTransactions = 0;
  const workflow = createInputLabFlashWorkflow({
    loadFirmware: async () => ({ bytes: new Uint8Array([1, 2, 3]), validation: { digest: "a".repeat(64) } }),
    FramerHidClient: FakeHidClient,
    resolveFramerIdentity: async () => ({ mode: "hid-serial", serialNumber: "A4CB8FAF3210" }),
    requestBootloaderPort: async () => { calls.push("serial-port"); return port; },
    flashAppOnly: async (options) => { serialTransactions += 1; calls.push("shared-flash");
      assert.equal(options.port, port); assert.equal(options.normalIdentity.serialNumber, "A4CB8FAF3210");
      return { macAddress: "a4:cb:8f:af:32:10" }; },
    waitForHealthyFramer: async (identity, options) => { calls.push("hid-health");
      assert.equal(identity.serialNumber, "A4CB8FAF3210");
      assert.equal(options.expectedMacAddress, "a4:cb:8f:af:32:10");
      return { version: "0.4.1" }; },
  });
  const identity = await workflow.resolveIdentity(device);
  const result = await workflow.flash({ device, normalIdentity: identity,
    firmware: { flashable: true } });
  assert.equal(result.health.version, "0.4.1");
  assert.equal(serialTransactions, 1);
  assert.deepEqual(calls, ["hid-open", "hid-version", "hid-bootloader", "hid-close",
    "serial-port", "shared-flash", "hid-health"]);
  const source = await readFile(path.join(sdkRoot, "input-lab/lib/browser-flash.mjs"), "utf8");
  assert.doesNotMatch(source, /\bTransport\b|\bESPLoader\b|getWriter\s*\(/u);
});

test("Input Lab requires explicit confirmation when Chrome omits Framer serial identity", () => {
  const identity = Object.freeze({ mode: "single-device", productId: 0x8396 });
  assert.throws(() => approveInputLabFlashIdentity(identity), /exactly one Framer/u);
  assert.deepEqual(approveInputLabFlashIdentity(identity, true),
    { mode: "single-device", productId: 0x8396, singleDeviceConfirmed: true });
});

test("Input Lab single-flight guard rejects overlapping serial flash attempts and releases afterward", async () => {
  let releaseFirmware;
  let loads = 0;
  const firmwareReady = new Promise((resolve) => { releaseFirmware = resolve; });
  class FakeHidClient {
    async open() { return this; }
    async verifyVersion() {}
    async enterBootloader() {}
    async close() {}
  }
  const workflow = createInputLabFlashWorkflow({
    loadFirmware: async () => { loads += 1; if (loads === 1) await firmwareReady;
      return { bytes: new Uint8Array([1]), validation: { digest: "b".repeat(64) } }; },
    FramerHidClient: FakeHidClient,
    resolveFramerIdentity: async () => ({ mode: "hid-serial", serialNumber: "A4CB8FAF3210" }),
    requestBootloaderPort: async () => ({}),
    flashAppOnly: async () => ({ macAddress: "a4:cb:8f:af:32:10" }),
    waitForHealthyFramer: async () => ({ version: "0.4.1" }),
  });
  const options = { device: {}, firmware: { flashable: true },
    normalIdentity: { mode: "hid-serial", serialNumber: "A4CB8FAF3210" } };
  const first = workflow.flash(options);
  await assert.rejects(workflow.flash(options), /already in progress/u);
  releaseFirmware();
  await first;
  await assert.doesNotReject(workflow.flash(options));
  assert.equal(loads, 2, "the rejected overlap must not start firmware loading or serial work");
});
