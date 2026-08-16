import assert from "node:assert/strict";
import test from "node:test";

import { createDeterministicTestGlyphAtlas, decodeRasterAnimation, encodeRasterAnimation,
  rgb565FrameToRgba8888, sampleCssCellAtTick } from "../../src/render/index.mjs";
import { sampleBrowserCellAtTick } from "../lib/browser-sampler.mjs";
import { compileInputLabBundle, compileInputLabScene, compileInputLabWidgetBundle } from "../lib/compiler.mjs";
import { ChromiumRasterCaptureProvider, sanitizeRasterDocument } from "../lib/chromium-raster-capture.mjs";
import { FailClosedLiveSceneTransport, MockSceneTransport } from "../lib/scene-transport.mjs";
import { SavedPreviewStore } from "../lib/saved-previews.mjs";
import { DEFAULT_INPUT_LAB_CSS, DEFAULT_INPUT_LAB_HTML, DEFAULT_INPUT_LAB_SLOTS,
  RADIAL_NOISE_CSS, RADIAL_NOISE_HTML } from "../lib/scene-template.mjs";
import { createInputLabServer } from "../server.mjs";
import { buildLabEditorApp, LAB_EDITOR_MAIN_SOURCE } from "../tools/build-lab-app.mjs";
import { patchLabMainSource } from "../tools/prepare-lab-app.mjs";

function memoryStorage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

function sessionTokenFromHtml(html) {
  const token = html.match(/name="input-lab-session-token" content="([A-Za-z0-9_-]{43})"/u)?.[1];
  assert.ok(token, "served editor must contain one 256-bit base64url session token");
  return token;
}

const testAtlas = async (glyphs) => createDeterministicTestGlyphAtlas(glyphs);
const testAtlasOptions = Object.freeze({ atlasFactory: testAtlas, allowTestAtlas: true });

test("Input Lab compiler reuses the exact deterministic 100x310 scene compiler", async () => {
  const first = await compileInputLabScene({ html: DEFAULT_INPUT_LAB_HTML, css: DEFAULT_INPUT_LAB_CSS }, testAtlasOptions);
  const second = await compileInputLabScene({ html: DEFAULT_INPUT_LAB_HTML, css: DEFAULT_INPUT_LAB_CSS }, testAtlasOptions);
  assert.deepEqual(first.binary, second.binary);
  assert.deepEqual(first.scene.viewport, { width: 100, height: 310 });
  assert.equal(first.scene.cells.length, 75);
  assert.match(first.scene.sha256, /^[0-9a-f]{64}$/u);
  await assert.rejects(() => compileInputLabScene({ html: DEFAULT_INPUT_LAB_HTML,
    css: `${DEFAULT_INPUT_LAB_CSS}\n.input-scene{background-image:url(https://x)}` }, testAtlasOptions), /not supported/u);
  assert.equal(first.atlas.testOnly, true, "synthetic atlas must remain explicitly test-only");
});

test("browser preview animation samples the exact device tick colors and glow", async () => {
  const { scene } = await compileInputLabScene({ html: DEFAULT_INPUT_LAB_HTML, css: DEFAULT_INPUT_LAB_CSS }, testAtlasOptions);
  for (let tick = 0; tick < 80; tick += 1) for (let cell = 0; cell < scene.cells.length; cell += 1) {
    const browser = sampleBrowserCellAtTick(scene, cell, tick);
    const shared = sampleCssCellAtTick(scene, cell, tick);
    assert.deepEqual(browser, { color565: shared.color565, glowRadius: shared.glowRadius });
  }
});

test("saved preview store always exposes three named slots and an active slot", () => {
  const store = new SavedPreviewStore({ storage: memoryStorage() });
  assert.deepEqual(store.load().slots.map(({ name }) => name), ["Working", "Less better", "Electric"]);
  assert.equal(store.load().slots[1].mode, "raster");
  let state = store.saveSlot(1, { name: "Night type", html: DEFAULT_INPUT_LAB_HTML, css: DEFAULT_INPUT_LAB_CSS });
  assert.equal(state.activeSlot, 1);
  assert.equal(state.slots[1].name, "Night type");
  state = store.setActive(2);
  assert.equal(state.activeSlot, 2);
  assert.equal(state.slots.length, 3);
});

test("raster sanitizer permits inline SVG fragments and blocks executable or external document inputs", () => {
  const document = sanitizeRasterDocument({ html: RADIAL_NOISE_HTML,
    css: `${RADIAL_NOISE_CSS}\n.grain{filter:url("#noise")}`, interaction: "hover" });
  assert.match(document, /feTurbulence/u);
  assert.match(document, /input-lab-hover/u);
  assert.throws(() => sanitizeRasterDocument({ html: "<script>alert(1)</script>", css: "" }), /Scripts/u);
  assert.throws(() => sanitizeRasterDocument({ html: "<div onclick=alert(1)>x</div>", css: "" }), /event handlers/u);
  for (const tag of ["iframe", "object", "embed", "base", "meta", "form", "video", "audio", "source", "track"]) {
    assert.throws(() => sanitizeRasterDocument({ html: `<${tag} href="#x"></${tag}>`, css: "" }), /embedded documents/u);
  }
  for (const html of [
    '<meta http-equiv="refresh" content="0;url=https://example.com">',
    '<video poster="https://example.com/frame.png"><source src="https://example.com/a.mp4"></video>',
    '<svg><image href="https://example.com/x.png"/><use xlink:href="https://example.com/x.svg#id"/></svg>',
    '<form action="https://example.com"><button formaction="https://example.com">go</button></form>',
    '<img srcset="https://example.com/a.png 1x">',
  ]) assert.throws(() => sanitizeRasterDocument({ html, css: "" }), /navigation|Navigable/u);
  assert.throws(() => sanitizeRasterDocument({ html: '<img src="file:///tmp/x.png">', css: "" }), /resource-loading/u);
  assert.throws(() => sanitizeRasterDocument({ html: '<div style="background:url(file:///tmp/x.png)"></div>', css: "" }),
    /Raster HTML URLs/u);
  assert.throws(() => sanitizeRasterDocument({ html: "<div></div>", css: ".x{background:url(https://x)}" }),
    /data: resources or local SVG/u);
  assert.match(document, /base-uri 'none'; connect-src 'none'; form-action 'none'; frame-src 'none'/u);
  assert.match(document, /object-src 'none'; media-src 'none'; worker-src 'none'/u);
});

test("mixed semantic and captured raster slots encode one deterministic F1WB bundle", async () => {
  const frame = new Uint16Array(100 * 310).fill(0x39e7);
  const animation = encodeRasterAnimation({ frames: [frame], fps: 1, loopDurationMs: 1000, maxBytes: 131072 });
  const captureProvider = { capture: async () => ({ animation: { ...animation, selectedFrameIndices: [0],
    requestedFrameCount: 1, reduced: false }, pngFrames: ["png"], settings: {}, capturedFrameCount: 1 }) };
  const semantic = { name: "Working", mode: "semantic", html: DEFAULT_INPUT_LAB_HTML, css: DEFAULT_INPUT_LAB_CSS };
  const raster = { name: "Less better", mode: "raster", html: RADIAL_NOISE_HTML, css: RADIAL_NOISE_CSS };
  const result = await compileInputLabWidgetBundle({ slots: [semantic, raster, { ...semantic, name: "Reference" }],
    activeSlot: 1, captureProvider, ...testAtlasOptions });
  assert.equal(result.bundle.binary.subarray(0, 4).toString("ascii"), "F1WB");
  assert.deepEqual(result.bundle.slots.map(({ kind }) => kind), ["semantic", "raster", "semantic"]);
});

test("installed headless Chromium paints a real exact 100x310 radial frame", async () => {
  const result = await new ChromiumRasterCaptureProvider().capture({ html: RADIAL_NOISE_HTML, css: RADIAL_NOISE_CSS,
    settings: { fps: 1, loopDurationMs: 1000, maxFrames: 1, maxBytes: 131072, interaction: "none" } });
  assert.equal(result.animation.width, 100);
  assert.equal(result.animation.height, 310);
  assert.equal(result.animation.stats.frameCount, 1);
  assert.equal(result.pngFrames.length, 1);
  const decoded = decodeRasterAnimation(result.animation.binary);
  const { createRequire } = await import("node:module");
  const requireFromInput = createRequire(new URL("../../../extracted/input-app/package.json", import.meta.url));
  const { Jimp } = requireFromInput("jimp");
  const image = await Jimp.read(Buffer.from(result.pngFrames[0], "base64"));
  assert.deepEqual(Buffer.from(image.bitmap.data), Buffer.from(rgb565FrameToRgba8888(decoded.frames[0])),
    "preview PNG must be the decoded RGB565 compiler output");
});

test("Chromium keyframe seeking produces identical F1RA output across captures", async () => {
  const provider = new ChromiumRasterCaptureProvider();
  const input = { html: RADIAL_NOISE_HTML, css: RADIAL_NOISE_CSS,
    settings: { fps: 5, loopDurationMs: 2000, maxFrames: 10, maxBytes: 131072, interaction: "none" } };
  const started = performance.now();
  const first = await provider.capture(input);
  const second = await provider.capture(input);
  assert.equal(first.capturedFrameCount, 10);
  assert.ok(performance.now() - started < 10_000, "two default 10-source-frame captures must complete under 10 seconds");
  assert.equal(first.animation.sha256, second.animation.sha256);
  assert.deepEqual(first.pngFrames, second.pngFrames);
  assert.equal(first.browser.product, "Chrome/151.0.7922.138");
});

test("all three seeded previews are named and compile to distinct source identities", () => {
  assert.equal(DEFAULT_INPUT_LAB_SLOTS.length, 3);
  assert.equal(new Set(DEFAULT_INPUT_LAB_SLOTS.map(({ name }) => name)).size, 3);
  assert.equal(new Set(DEFAULT_INPUT_LAB_SLOTS.map(({ mode, html, css }) => `${mode}\0${html}\0${css}`)).size, 3);
});

test("scene transport is mock by default and live mode fails closed", async () => {
  const compiled = await compileInputLabScene({ html: DEFAULT_INPUT_LAB_HTML, css: DEFAULT_INPUT_LAB_CSS }, testAtlasOptions);
  const mock = new MockSceneTransport();
  const result = await mock.applyScene({ ...compiled, slot: 2 });
  assert.deepEqual({ status: result.status, activeSlot: result.activeSlot, hardwareAccess: result.hardwareAccess },
    { status: "mock-applied", activeSlot: 2, hardwareAccess: false });
  const input = { name: "Working", html: DEFAULT_INPUT_LAB_HTML, css: DEFAULT_INPUT_LAB_CSS };
  const { bundle } = await compileInputLabBundle({ slots: [input, { ...input, name: "Variant B" },
    { ...input, name: "Reference" }], activeSlot: 1, ...testAtlasOptions });
  const bundled = await mock.applySceneBundle({ bundle });
  assert.equal(bundle.binary.subarray(0, 4).toString("ascii"), "F1WB");
  assert.deepEqual({ status: bundled.status, slots: bundled.slots, activeSlot: bundled.activeSlot },
    { status: "mock-bundle-applied", slots: 3, activeSlot: 1 });
  await assert.rejects(() => new FailClosedLiveSceneTransport().applyScene({ ...compiled, slot: 0 }),
    (error) => error.code === "NO_LIVE_INPUT_LAB_SCENE_TRANSPORT");
});

test("standalone Input Lab serves editor, compiles, and applies through injected transport", async (context) => {
  const mock = new MockSceneTransport();
  const server = createInputLabServer({ transport: mock });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const editorResponse = await fetch(base);
  assert.equal(editorResponse.headers.get("x-frame-options"), "DENY");
  assert.match(editorResponse.headers.get("content-security-policy"), /frame-ancestors 'none'/u);
  const html = await editorResponse.text();
  assert.match(html, /id="preview" width="100" height="310"/u);
  assert.match(html, /Apply \/ Push/u);
  const sessionToken = sessionTokenFromHtml(html);
  assert.ok(!html.includes("__INPUT_LAB_SESSION_TOKEN__"));
  const compiled = await fetch(`${base}/api/compile`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ html: DEFAULT_INPUT_LAB_HTML, css: DEFAULT_INPUT_LAB_CSS }) }).then((response) => response.json());
  assert.deepEqual(compiled.scene.viewport, { width: 100, height: 310 });
  assert.equal(compiled.atlas.testOnly, false, "runtime endpoint must return the pinned production glyph atlas");
  const slot = { name: "Working", html: DEFAULT_INPUT_LAB_HTML, css: DEFAULT_INPUT_LAB_CSS };
  const rejected = await fetch(`${base}/api/apply`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ slots: [slot, slot, slot], activeSlot: 0 }) });
  assert.equal(rejected.status, 403);
  assert.equal((await rejected.json()).error, "INPUT_LAB_SESSION_DENIED");
  assert.equal(mock.calls.length, 0);
  const crossOrigin = await fetch(`${base}/api/apply`, { method: "POST", headers: { "content-type": "application/json",
    "x-input-lab-session": sessionToken, origin: "https://attacker.example" },
    body: JSON.stringify({ slots: [slot, slot, slot], activeSlot: 0 }) });
  assert.equal(crossOrigin.status, 403);
  assert.equal((await crossOrigin.json()).error, "INPUT_LAB_ORIGIN_DENIED");
  const applied = await fetch(`${base}/api/apply`, { method: "POST",
    headers: { "content-type": "application/json", "x-input-lab-session": sessionToken },
    body: JSON.stringify({ slots: [slot, { ...slot, name: "Variant B" }, { ...slot, name: "Reference" }],
      activeSlot: 1 }) }).then((response) => response.json());
  assert.equal(applied.status, "mock-bundle-applied");
  assert.equal(applied.slots, 3);
  assert.equal(mock.calls.length, 1);
});

test("three-slot apply accepts a body larger than the old 96KiB cap", async (context) => {
  const server = createInputLabServer({ transport: new MockSceneTransport(),
    captureProvider: { capture: async () => { throw new Error("not used"); } } });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const sessionToken = sessionTokenFromHtml(await fetch(base).then((response) => response.text()));
  const paddedHtml = `${DEFAULT_INPUT_LAB_HTML}<!--${"x".repeat(40_000)}-->`;
  const slot = { name: "Working", mode: "semantic", html: paddedHtml, css: DEFAULT_INPUT_LAB_CSS };
  const response = await fetch(`${base}/api/apply`, { method: "POST", headers: { "content-type": "application/json",
    "x-input-lab-session": sessionToken },
    body: JSON.stringify({ slots: [slot, { ...slot, name: "Second" }, { ...slot, name: "Third" }], activeSlot: 0 }) });
  assert.equal(response.status, 200);
  assert.ok(Number(response.headers.get("content-length")) < 64 * 1024, "apply response must not echo captured source/frames");
});

test("separate Input Lab.app route selects the working localhost editor only with explicit flag", () => {
  const original = 'before,this.loadWindow(this.mainWin, "index.html"),after';
  const patched = patchLabMainSource(original);
  assert.match(patched, /process\.argv\.includes\("--input-lab"\)/u);
  assert.match(patched, /loadURL\("http:\/\/127\.0\.0\.1:9231"\)/u);
  assert.match(patched, /this\.loadWindow\(this\.mainWin, "index\.html"\)/u);
  assert.throws(() => patchLabMainSource(patched), /refusing to patch/u);
});

test("Lab app builder fails closed outside its dedicated build root", async () => {
  await assert.rejects(() => buildLabEditorApp({ out: "/tmp/Input Lab Editor.app" }), /must be an .app under/u);
});

test("copied Lab app uses a minimal URL-only shell with no Input device runtime", () => {
  assert.match(LAB_EDITOR_MAIN_SOURCE, /loadURL\(LAB_URL\)/u);
  assert.match(LAB_EDITOR_MAIN_SOURCE, /sandbox: true/u);
  assert.match(LAB_EDITOR_MAIN_SOURCE, /setPermissionRequestHandler/u);
  assert.doesNotMatch(LAB_EDITOR_MAIN_SOURCE, /node-hid|wl-device|device manager|connectToDevice/iu);
});
