import assert from "node:assert/strict";
import test from "node:test";

import { createDeterministicTestGlyphAtlas, decodeRasterAnimation, encodeRasterAnimation,
  rgb565FrameToRgba8888, sampleCssCellAtTick, WIDGET_SCENE_RPC_LIMITS } from "../../src/render/index.mjs";
import { sampleBrowserCellAtTick } from "../lib/browser-sampler.mjs";
import { compileInputLabBundle, compileInputLabScene, compileInputLabWidgetBundle,
  INPUT_LAB_SEMANTIC_UNSUPPORTED } from "../lib/compiler.mjs";
import { ChromiumRasterCaptureProvider, sanitizeRasterDocument } from "../lib/chromium-raster-capture.mjs";
import { buildInputWlrpcSceneExpression, InputWlrpcSceneTransport } from "../lib/input-wlrpc-scene-transport.mjs";
import { FailClosedLiveSceneTransport, FRAMER_SCENE_HANDLER_CANDIDATES,
  LIVE_PROVEN_FRAMER_SCENE_HANDLERS, MockSceneTransport,
  StatusOnlyCanarySceneTransport } from "../lib/scene-transport.mjs";
import { SavedPreviewStore } from "../lib/saved-previews.mjs";
import { DEFAULT_INPUT_LAB_CSS, DEFAULT_INPUT_LAB_HTML, DEFAULT_INPUT_LAB_SLOTS,
  GENERATING_PERIMETER_CSS, GENERATING_PERIMETER_HTML, GENERATING_PERIMETER_SETTINGS,
  LEGACY_LESS_BETTER_CSS, LEGACY_LESS_BETTER_HTML } from "../lib/scene-template.mjs";
import { createInputLabCliTransport, createInputLabServer, parseInputLabServerArgs } from "../server.mjs";
import { buildLabEditorApp, createLabEditorLauncher } from "../tools/build-lab-app.mjs";
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
const LOADER_HTML = '<div class="loader"></div>';
const LOADER_CSS = `.loader {
  position: relative;
  width: 2.5em;
  height: 2.5em;
  transform: rotate(165deg);
}
.loader::before, .loader::after {
  content: "";
  position: absolute;
  top: 50%;
  left: 50%;
  display: block;
  width: 0.5em;
  height: 0.5em;
  border-radius: 0.25em;
  transform: translate(-50%, -50%);
}
.loader::before { animation: before8 2s infinite; }
.loader::after { animation: after6 2s infinite; }
@keyframes before8 {
  0% { width: 0.5em; box-shadow: 1em -0.5em rgba(225,20,98,.75), -1em .5em rgba(111,202,220,.75); }
  35% { width: 2.5em; box-shadow: 0 -.5em rgba(225,20,98,.75), 0 .5em rgba(111,202,220,.75); }
  70% { width: .5em; box-shadow: -1em -.5em rgba(225,20,98,.75), 1em .5em rgba(111,202,220,.75); }
  100% { box-shadow: 1em -.5em rgba(225,20,98,.75), -1em .5em rgba(111,202,220,.75); }
}
@keyframes after6 {
  0% { height: .5em; box-shadow: .5em 1em rgba(61,184,143,.75), -.5em -1em rgba(233,169,32,.75); }
  35% { height: 2.5em; box-shadow: .5em 0 rgba(61,184,143,.75), -.5em 0 rgba(233,169,32,.75); }
  70% { height: .5em; box-shadow: .5em -1em rgba(61,184,143,.75), -.5em 1em rgba(233,169,32,.75); }
  100% { box-shadow: .5em 1em rgba(61,184,143,.75), -.5em -1em rgba(233,169,32,.75); }
}
.loader { position: absolute; top: calc(50% - 1.25em); left: calc(50% - 1.25em); }`;

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
  assert.deepEqual(store.load().slots.map(({ name }) => name), ["Working", "Generating", "Electric"]);
  assert.equal(store.load().version, 4);
  assert.equal(store.load().slots[1].mode, "auto");
  assert.deepEqual(store.load().slots[1].settings, GENERATING_PERIMETER_SETTINGS);
  let state = store.saveSlot(1, { name: "Night type", html: DEFAULT_INPUT_LAB_HTML, css: DEFAULT_INPUT_LAB_CSS });
  assert.equal(state.activeSlot, 1);
  assert.equal(state.slots[1].name, "Night type");
  state = store.setActive(2);
  assert.equal(state.activeSlot, 2);
  assert.equal(state.slots.length, 3);
});

test("saved preview edits and names survive a fresh store instance", () => {
  const storage = memoryStorage();
  let store = new SavedPreviewStore({ storage });
  for (let index = 0; index < 3; index += 1) {
    store.saveSlot(index, { name: `Custom ${index + 1}`, mode: index === 1 ? "raster" : "auto",
      html: `<div>custom-${index}</div>`, css: `.custom-${index}{color:#fff}`,
      settings: { fps: index + 1, loopDurationMs: 3000, maxFrames: 9, maxBytes: 100000,
        interaction: "none" } });
  }
  store.renameSlot(0, "Renamed first");

  store = new SavedPreviewStore({ storage });
  const restored = store.load();
  assert.equal(restored.activeSlot, 2);
  assert.deepEqual(restored.slots.map(({ name }) => name), ["Renamed first", "Custom 2", "Custom 3"]);
  assert.deepEqual(restored.slots.map(({ html }) => html),
    ["<div>custom-0</div>", "<div>custom-1</div>", "<div>custom-2</div>"]);
  assert.deepEqual(restored.slots.map(({ css }) => css),
    [".custom-0{color:#fff}", ".custom-1{color:#fff}", ".custom-2{color:#fff}"]);
});

test("saved preview v1 semantic slots migrate to automatic compiler selection", () => {
  const storage = memoryStorage();
  storage.setItem("framer-f1-input-lab-v1", JSON.stringify({ version: 1, activeSlot: 0,
    slots: Array.from({ length: 3 }, (_, id) => ({ id, name: `Old ${id}`, mode: "semantic",
      html: DEFAULT_INPUT_LAB_HTML, css: DEFAULT_INPUT_LAB_CSS })) }));
  const state = new SavedPreviewStore({ storage }).load();
  assert.equal(state.version, 4);
  assert.deepEqual(state.slots.map(({ mode }) => mode), ["auto", "auto", "auto"]);
});

test("saved preview migration replaces only the exact old second seed with Generating", () => {
  const legacySlot = { id: 1, name: "Less better", mode: "raster", html: LEGACY_LESS_BETTER_HTML,
    css: LEGACY_LESS_BETTER_CSS, settings: { fps: 5, loopDurationMs: 2000, maxFrames: 10,
      maxBytes: 131072, interaction: "none" }, compiled: null };
  const storage = memoryStorage();
  storage.setItem("framer-f1-input-lab-v1", JSON.stringify({ version: 2, activeSlot: 1,
    slots: [DEFAULT_INPUT_LAB_SLOTS[0], legacySlot, DEFAULT_INPUT_LAB_SLOTS[2]] }));
  const migrated = new SavedPreviewStore({ storage }).load();
  assert.equal(migrated.version, 4);
  assert.equal(migrated.activeSlot, 1);
  assert.deepEqual(migrated.slots[1], DEFAULT_INPUT_LAB_SLOTS[1]);

  storage.setItem("framer-f1-input-lab-v1", JSON.stringify({ version: 2, activeSlot: 1,
    slots: [DEFAULT_INPUT_LAB_SLOTS[0], { ...legacySlot, settings: { ...legacySlot.settings, fps: 6 } },
      DEFAULT_INPUT_LAB_SLOTS[2]] }));
  const customized = new SavedPreviewStore({ storage }).load();
  assert.equal(customized.slots[1].name, "Less better");
  assert.equal(customized.slots[1].settings.fps, 6);
});

test("Auto mode falls back to raster for positioned pseudo-element keyframes while strict semantic stays strict", async () => {
  await assert.rejects(() => compileInputLabScene({ html: LOADER_HTML, css: LOADER_CSS }, testAtlasOptions),
    (error) => error.code === INPUT_LAB_SEMANTIC_UNSUPPORTED && /position/u.test(error.message));
  const frame = new Uint16Array(100 * 310).fill(0x0000);
  const animation = encodeRasterAnimation({ frames: [frame], fps: 1, loopDurationMs: 1000, maxBytes: 131072 });
  const calls = [];
  const captureProvider = { capture: async (source) => {
    calls.push(source);
    return { animation: { ...animation, selectedFrameIndices: [0], requestedFrameCount: 1, reduced: false },
      pngFrames: ["png"], settings: source.settings, capturedFrameCount: 1 };
  } };
  const semantic = { name: "Working", mode: "semantic", html: DEFAULT_INPUT_LAB_HTML, css: DEFAULT_INPUT_LAB_CSS };
  const loader = { name: "Loader", mode: "auto", html: LOADER_HTML, css: LOADER_CSS,
    settings: { fps: 5, loopDurationMs: 2000, maxFrames: 10, maxBytes: 131072, interaction: "none" } };
  const result = await compileInputLabWidgetBundle({ slots: [loader, semantic, semantic], activeSlot: 0,
    captureProvider, ...testAtlasOptions });
  assert.equal(calls.length, 1);
  assert.deepEqual({ mode: result.compiledSlots[0].mode, requestedMode: result.compiledSlots[0].requestedMode,
    autoFallback: result.compiledSlots[0].autoFallback },
  { mode: "raster", requestedMode: "auto", autoFallback: true });
  assert.deepEqual(result.bundle.slots.map(({ kind }) => kind), ["raster", "semantic", "semantic"]);
  await assert.rejects(() => compileInputLabWidgetBundle({ slots: [{ ...loader, mode: "semantic" }, semantic, semantic],
    activeSlot: 0, captureProvider, ...testAtlasOptions }),
  (error) => error.code === INPUT_LAB_SEMANTIC_UNSUPPORTED);
  assert.equal(calls.length, 1, "strict semantic must not silently invoke Chromium");
});

test("Auto mode keeps compatible sources semantic and falls back only for typed profile diagnostics", async () => {
  const frame = new Uint16Array(100 * 310);
  const animation = encodeRasterAnimation({ frames: [frame], fps: 1, loopDurationMs: 1000, maxBytes: 131072 });
  const calls = [];
  const captureProvider = { capture: async (source) => {
    calls.push(source);
    return { animation: { ...animation, selectedFrameIndices: [0], requestedFrameCount: 1, reduced: false },
      pngFrames: [], settings: source.settings ?? {}, capturedFrameCount: 1 };
  } };
  const compatible = { name: "Working", mode: "auto", html: DEFAULT_INPUT_LAB_HTML, css: DEFAULT_INPUT_LAB_CSS };
  const semanticResult = await compileInputLabWidgetBundle({ slots: [compatible, compatible, compatible], activeSlot: 0,
    captureProvider, ...testAtlasOptions });
  assert.deepEqual(semanticResult.compiledSlots.map(({ mode, requestedMode, autoFallback }) =>
    ({ mode, requestedMode, autoFallback })), Array.from({ length: 3 }, () =>
    ({ mode: "semantic", requestedMode: "auto", autoFallback: false })));
  assert.equal(calls.length, 0, "compatible Auto sources must never start raster capture");

  const safeSemantic = { ...compatible, mode: "semantic" };
  const invalidCases = [
    { label: "source bound", source: { ...compatible, css: `${DEFAULT_INPUT_LAB_CSS}\n/*${"x".repeat(33_000)}*/` },
      pattern: /exceeds 32768/u },
    { label: "unsafe URL", source: { ...compatible,
      css: `${DEFAULT_INPUT_LAB_CSS}\n.input-scene{background-image:url(https://example.test/x)}` }, pattern: /not supported/u },
    { label: "unsafe HTML", source: { ...compatible, html: `${DEFAULT_INPUT_LAB_HTML}<script>bad()</script>` },
      pattern: /supports only/u },
    { label: "malformed CSS", source: { ...compatible, css: `${LOADER_CSS}}` }, pattern: /unmatched closing/u },
    { label: "missing keyframes", source: { ...compatible,
      css: `.input-scene{background-color:#000;color:#fff}.input-scene > span{color:#fff;animation:missing 1s infinite}` },
      pattern: /has no @keyframes/u },
  ];
  for (const { label, source, pattern } of invalidCases) {
    await assert.rejects(() => compileInputLabWidgetBundle({ slots: [source, safeSemantic, safeSemantic], activeSlot: 0,
      captureProvider, ...testAtlasOptions }), (error) => {
      assert.notEqual(error.code, INPUT_LAB_SEMANTIC_UNSUPPORTED, `${label} must not be typed as profile fallback`);
      assert.match(error.message, pattern);
      return true;
    });
  }
  await assert.rejects(() => compileInputLabWidgetBundle({ slots: [compatible, safeSemantic, safeSemantic], activeSlot: 0,
    captureProvider, atlasFactory: async () => { throw Object.assign(new Error("atlas unavailable"),
      { code: INPUT_LAB_SEMANTIC_UNSUPPORTED }); }, allowTestAtlas: true }),
  /atlas unavailable/u);
  assert.equal(calls.length, 0, "bounds, unsafe input, malformed input, and atlas failures must not invoke capture");
});

test("Input Lab enforces the whole live F1WB cap and never starts a second raster capture", async () => {
  const frame = new Uint16Array(100 * 310);
  const oneFrame = encodeRasterAnimation({ frames: [frame], fps: 1, loopDurationMs: 1000, maxBytes: 131072 });
  let captures = 0;
  const captureProvider = { capture: async (source) => {
    captures += 1;
    return { animation: { ...oneFrame, selectedFrameIndices: [0], requestedFrameCount: 1, reduced: false },
      pngFrames: [], settings: source.settings ?? {}, capturedFrameCount: 1 };
  } };
  const semantic = { name: "Working", mode: "semantic", html: DEFAULT_INPUT_LAB_HTML, css: DEFAULT_INPUT_LAB_CSS };
  const raster = { name: "Raster", mode: "raster", html: LOADER_HTML, css: LOADER_CSS };
  await assert.rejects(() => compileInputLabWidgetBundle({ slots: [raster, raster, semantic], activeSlot: 0,
    captureProvider, ...testAtlasOptions }), (error) => error.code === "SCENE_BUNDLE_OVERSIZE");
  assert.equal(captures, 0, "two explicit raster slots are knowable before capture");

  const loader = { ...raster, mode: "auto" };
  await assert.rejects(() => compileInputLabWidgetBundle({ slots: [loader, loader, semantic], activeSlot: 0,
    captureProvider, ...testAtlasOptions }), (error) => error.code === "SCENE_BUNDLE_OVERSIZE");
  assert.equal(captures, 1, "the second Auto fallback must be rejected before a second capture");

  const denseA = new Uint16Array(100 * 310).fill(0x1111);
  const denseB = new Uint16Array(100 * 310).fill(0xeeee);
  const dense = encodeRasterAnimation({ frames: [denseA, denseB], fps: 10,
    loopDurationMs: 200, maxBytes: 128 * 1024 });
  const denseProvider = { capture: async () => ({ animation: { ...dense, selectedFrameIndices: [0, 1],
    requestedFrameCount: 2, reduced: false }, pngFrames: [], settings: {}, capturedFrameCount: 2 }) };
  await assert.rejects(() => compileInputLabWidgetBundle({ slots: [raster, semantic, semantic], activeSlot: 0,
    captureProvider: denseProvider, ...testAtlasOptions }), (error) =>
    error.code === "SCENE_BUNDLE_OVERSIZE" && error.message.includes(String(WIDGET_SCENE_RPC_LIMITS.maxBundleBytes)));
});

test("raster sanitizer permits inline SVG fragments and blocks executable or external document inputs", () => {
  const document = sanitizeRasterDocument({ html: LEGACY_LESS_BETTER_HTML,
    css: `${LEGACY_LESS_BETTER_CSS}\n.grain{filter:url("#noise")}`, interaction: "hover" });
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
  const raster = { name: "Generating", mode: "auto", html: GENERATING_PERIMETER_HTML,
    css: GENERATING_PERIMETER_CSS, settings: GENERATING_PERIMETER_SETTINGS };
  const progress = [];
  const result = await compileInputLabWidgetBundle({ slots: [semantic, raster, { ...semantic, name: "Reference" }],
    activeSlot: 1, captureProvider, onProgress: (event) => progress.push(event), ...testAtlasOptions });
  assert.equal(result.bundle.binary.subarray(0, 4).toString("ascii"), "F1WB");
  assert.deepEqual(result.bundle.slots.map(({ kind }) => kind), ["semantic", "raster", "semantic"]);
  assert.deepEqual({ requestedMode: result.compiledSlots[1].requestedMode,
    autoFallback: result.compiledSlots[1].autoFallback }, { requestedMode: "auto", autoFallback: true });
  assert.deepEqual(progress, [
    { stage: "compiling-slots", current: 0, total: 3 },
    { stage: "compiling-slots", current: 1, total: 3 },
    { stage: "compiling-slots", current: 2, total: 3 },
    { stage: "compiling-slots", current: 3, total: 3 },
    { stage: "encoding-bundle" },
  ]);
});

test("Generating uses a deterministic maximum-cadence screen-perimeter animation within the live bundle cap", async () => {
  const provider = new ChromiumRasterCaptureProvider();
  const input = { html: GENERATING_PERIMETER_HTML, css: GENERATING_PERIMETER_CSS,
    settings: GENERATING_PERIMETER_SETTINGS };
  const started = performance.now();
  const first = await provider.capture(input);
  const second = await provider.capture(input);
  assert.ok(performance.now() - started < 15_000, "two 20-source-frame perimeter captures must complete under 15 seconds");
  assert.deepEqual({ width: first.animation.width, height: first.animation.height }, { width: 100, height: 310 });
  assert.deepEqual({ fps: first.settings.fps, cadenceMs: first.settings.cadenceMs,
    loopDurationMs: first.settings.loopDurationMs }, { fps: 10, cadenceMs: 100, loopDurationMs: 2000 });
  assert.equal(first.capturedFrameCount, 20);
  assert.equal(first.animation.stats.frameCount, 20);
  assert.equal(first.animation.reduced, false);
  assert.deepEqual(first.animation.selectedFrameIndices, Array.from({ length: 20 }, (_, index) => index));
  assert.equal(first.animation.binary.length, 74_208);
  assert.equal(first.animation.sha256, "367eff1d8c7680595337e2be6081312f9288561ff03584f45a38773fb6886b9e");
  assert.equal(first.animation.sha256, second.animation.sha256);
  assert.deepEqual(first.pngFrames, second.pngFrames);
  assert.equal(first.browser.product, "Chrome/151.0.7922.138");

  const decoded = decodeRasterAnimation(first.animation.binary);
  for (let frameIndex = 1; frameIndex < decoded.frames.length; frameIndex += 1) {
    const before = decoded.frames[frameIndex - 1];
    const after = decoded.frames[frameIndex];
    for (let pixel = 0; pixel < after.length; pixel += 1) if (after[pixel] !== before[pixel]) {
      const x = pixel % 100;
      const y = Math.floor(pixel / 100);
      assert.ok(Math.min(x, 99 - x, y, 309 - y) <= 2, "animated pixels must stay on the screen perimeter");
    }
  }
  const { createRequire } = await import("node:module");
  const requireFromInput = createRequire(new URL("../../../extracted/input-app/package.json", import.meta.url));
  const { Jimp } = requireFromInput("jimp");
  const image = await Jimp.read(Buffer.from(first.pngFrames[0], "base64"));
  assert.deepEqual(Buffer.from(image.bitmap.data), Buffer.from(rgb565FrameToRgba8888(decoded.frames[0])),
    "preview PNG must be the decoded RGB565 compiler output");

  const compiled = await compileInputLabWidgetBundle({ slots: DEFAULT_INPUT_LAB_SLOTS, activeSlot: 1,
    captureProvider: { capture: async () => first }, ...testAtlasOptions });
  assert.deepEqual(compiled.bundle.slots.map(({ kind }) => kind), ["semantic", "raster", "semantic"]);
  assert.deepEqual({ requestedMode: compiled.compiledSlots[1].requestedMode,
    autoFallback: compiled.compiledSlots[1].autoFallback }, { requestedMode: "auto", autoFallback: true });
  assert.equal(compiled.bundle.binary.length, 80_452);
  assert.equal(Math.ceil(compiled.bundle.binary.length / 3072), 27);
  assert.ok(compiled.bundle.binary.length <= WIDGET_SCENE_RPC_LIMITS.maxBundleBytes);
});

test("pasted loader captures ten deterministic frames and fits the live three-slot bundle", async () => {
  const provider = new ChromiumRasterCaptureProvider();
  const settings = { fps: 5, loopDurationMs: 2000, maxFrames: 10, maxBytes: 131072, interaction: "none" };
  const captured = await provider.capture({ html: LOADER_HTML, css: LOADER_CSS, settings });
  assert.equal(captured.capturedFrameCount, 10);
  assert.deepEqual(captured.animation.selectedFrameIndices, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(captured.animation.stats.frameCount, 10);
  assert.equal(captured.animation.binary.length, 73_480);
  assert.equal(captured.animation.sha256, "661e3040bb5822daae6f18fbc5845b3f12c6aba54bb482f7bed861300d6b40ca");
  const loader = { name: "Loader", mode: "auto", html: LOADER_HTML, css: LOADER_CSS, settings };
  const semantic = { name: "Working", mode: "semantic", html: DEFAULT_INPUT_LAB_HTML, css: DEFAULT_INPUT_LAB_CSS };
  const compiled = await compileInputLabWidgetBundle({ slots: [loader, semantic, { ...semantic, name: "Reference" }],
    activeSlot: 0, captureProvider: { capture: async () => captured }, ...testAtlasOptions });
  assert.equal(compiled.bundle.binary.length, 79_724);
  assert.equal(Math.ceil(compiled.bundle.binary.length / 3072), 26);
  assert.ok(compiled.bundle.binary.length <= WIDGET_SCENE_RPC_LIMITS.maxBundleBytes);
});

test("all three seeded previews are named and compile to distinct source identities", () => {
  assert.equal(DEFAULT_INPUT_LAB_SLOTS.length, 3);
  assert.equal(new Set(DEFAULT_INPUT_LAB_SLOTS.map(({ name }) => name)).size, 3);
  assert.equal(new Set(DEFAULT_INPUT_LAB_SLOTS.map(({ mode, html, css }) => `${mode}\0${html}\0${css}`)).size, 3);
  assert.deepEqual({ id: DEFAULT_INPUT_LAB_SLOTS[1].id, name: DEFAULT_INPUT_LAB_SLOTS[1].name,
    mode: DEFAULT_INPUT_LAB_SLOTS[1].mode }, { id: 1, name: "Generating", mode: "auto" });
  assert.doesNotMatch(DEFAULT_INPUT_LAB_SLOTS[1].html, /orb/iu);
  assert.doesNotMatch(DEFAULT_INPUT_LAB_SLOTS[1].css, /radial-gradient|\.orb\b/iu);
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
  const calls = [];
  const candidate = FRAMER_SCENE_HANDLER_CANDIDATES[0];
  assert.equal(candidate.baseApp.sha256,
    "b9b8eec6250392f593ae664fa8b8cba64bf861f5ef49a427c65be79e6f355817");
  assert.equal(candidate.baseReceipt.sha256,
    "95fbafe93ef45785e02e157f9047d9077bfee7030b4cb346ffa13da88a9550bf");
  assert.equal(candidate.liveValidation.rpcAcceptancePending, true);
  assert.equal(LIVE_PROVEN_FRAMER_SCENE_HANDLERS.length, 0);
  await assert.rejects(() => new FailClosedLiveSceneTransport({ proofId: candidate.id, confirmLiveRpc: true,
    transport: { rpc: async (...args) => { calls.push(args); return {}; } } }).applySceneBundle({ bundle }),
  (error) => error.code === "NO_LIVE_INPUT_LAB_SCENE_TRANSPORT");
  assert.deepEqual(calls, [], "candidate/base receipts must block before any Input or device I/O");
});

test("Input WLRPC scene adapter allowlists six methods and embeds params as inert base64", async () => {
  const calls = [];
  const transport = new InputWlrpcSceneTransport({ evaluate: async (expression, options) => {
    calls.push({ expression, options });
    return { target: { deviceFamily: "knob_f1", firmware: "0.4.1", usb: true },
      response: { result: { status: "ok", accepted: true } } };
  } });
  const params = { protocol: "framer-widget-scene-rpc-v1", marker: "quote: dangerous-source-marker" };
  assert.deepEqual(await transport.rpc("widget.scene.status", params), { status: "ok", accepted: true });
  assert.equal(calls.length, 1);
  assert.doesNotMatch(calls[0].expression, /dangerous-source-marker/u);
  assert.match(calls[0].expression, /Expected exactly one USB Framer F1/u);
  assert.deepEqual(calls[0].options, { port: 9230, timeoutMs: 30_000 });
  assert.throws(() => buildInputWlrpcSceneExpression("widget.scene.erase", {}), /Unsupported/u);
  await assert.rejects(transport.rpc("widget.scene.erase", {}), /Unsupported/u);
  assert.equal(calls.length, 1);
});

test("explicit status-only canary maintains localhost-session generations without claiming proof", async () => {
  const input = { name: "Working", html: DEFAULT_INPUT_LAB_HTML, css: DEFAULT_INPUT_LAB_CSS };
  const { bundle } = await compileInputLabBundle({ slots: [input, { ...input, name: "Variant B" },
    { ...input, name: "Reference" }], activeSlot: 1 });
  const calls = [];
  const waits = [];
  let rejectedGeneration = null;
  const transport = new StatusOnlyCanarySceneTransport({ confirmLiveRpc: true, initialGeneration: 1,
    handoffWaitMs: 150, wait: async (milliseconds) => { waits.push(milliseconds); },
    transport: { rpc: async (method, params) => {
      calls.push({ method, params });
      if (method === "widget.scene.begin" && params.generation === 3 && rejectedGeneration !== 3) {
        rejectedGeneration = 3;
        return { status: "error" };
      }
      return { status: "ok" };
    } } });
  const first = await transport.applySceneBundle({ bundle });
  const second = await transport.applySceneBundle({ bundle });
  assert.deepEqual([first.generation, second.generation, transport.committedGeneration], [2, 3, 3]);
  assert.deepEqual({ status: second.status, hardwareAccess: second.hardwareAccess,
    proofBacked: second.proofBacked, uiHandoffVerified: second.uiHandoffVerified,
    slots: second.slots, activeSlot: second.activeSlot }, {
    status: "live-canary-commit-acknowledged", hardwareAccess: true,
    proofBacked: false, uiHandoffVerified: false, slots: 3, activeSlot: 1 });
  assert.deepEqual(waits, [150, 150], "second push waits for handoff, then retries one explicit busy begin");
  const generationThreeBegins = calls.filter(({ method, params }) =>
    method === "widget.scene.begin" && params.generation === 3);
  assert.equal(generationThreeBegins.length, 2);
  assert.deepEqual(generationThreeBegins[0].params, generationThreeBegins[1].params);
  assert.ok(!calls.some(({ method }) => method === "widget.scene.capabilities" || method === "widget.scene.status"));
});

test("status-only canary safely recovers the device generation after the Lab server restarts", async () => {
  const input = { name: "Working", html: DEFAULT_INPUT_LAB_HTML, css: DEFAULT_INPUT_LAB_CSS };
  const { bundle } = await compileInputLabBundle({ slots: [input, { ...input, name: "Variant B" },
    { ...input, name: "Reference" }], activeSlot: 0 });
  const begins = [];
  const deviceGeneration = 4;
  const transport = new StatusOnlyCanarySceneTransport({ confirmLiveRpc: true, initialGeneration: 1,
    handoffWaitMs: 0, wait: async () => {}, generationRecoveryWindow: 8,
    transport: { rpc: async (method, params) => {
      if (method === "widget.scene.begin") {
        begins.push(params.expectedGeneration);
        return { status: params.expectedGeneration === deviceGeneration ? "ok" : "error" };
      }
      return { status: "ok" };
    } } });
  const result = await transport.applySceneBundle({ bundle });
  assert.equal(result.expectedGeneration, deviceGeneration);
  assert.equal(result.generation, deviceGeneration + 1);
  assert.equal(transport.committedGeneration, deviceGeneration + 1);
  assert.deepEqual(begins, [1, 1, 2, 2, 3, 3, 4],
    "each stale generation gets one busy/handoff retry before advancing");
});

test("Input Lab CLI remains mock by default and requires the exact live RPC confirmation flag", () => {
  assert.deepEqual(parseInputLabServerArgs([]), { confirmLiveRpc: false });
  assert.deepEqual(parseInputLabServerArgs(["--confirm-live-rpc"]), { confirmLiveRpc: true });
  assert.throws(() => parseInputLabServerArgs(["--live"]), /Unknown Input Lab option/u);
  assert.equal(createInputLabCliTransport({ confirmLiveRpc: false }), null);
  const rpcTransport = { rpc: async () => ({ status: "ok" }) };
  const live = createInputLabCliTransport({ confirmLiveRpc: true }, { rpcTransport });
  assert.ok(live instanceof StatusOnlyCanarySceneTransport);
  assert.equal(live.transport, rpcTransport);
  assert.equal(live.committedGeneration, 1);
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
  assert.match(html, /id="apply-progress"[^>]*role="status"[^>]*aria-live="polite"/u);
  const appSource = await fetch(`${base}/app.mjs`).then((response) => response.text());
  assert.match(appSource, /UNPROVEN hardware canary · commit acknowledged; UI handoff unverified/u);
  assert.match(appSource, /setApplyBusy\(true\)/u);
  assert.ok(appSource.includes("Uploading chunks ${event.current}/${event.total}"));
  assert.ok(!appSource.includes("result.bytes} bytes · no hardware I/O"));
  const styles = await fetch(`${base}/styles.css`).then((response) => response.text());
  assert.match(styles, /button:disabled/u);
  assert.match(styles, /@keyframes apply-spin/u);
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

  const streamedResponse = await fetch(`${base}/api/apply`, { method: "POST",
    headers: { "content-type": "application/json", accept: "application/x-ndjson",
      "x-input-lab-session": sessionToken },
    body: JSON.stringify({ slots: [slot, { ...slot, name: "Variant B" }, { ...slot, name: "Reference" }],
      activeSlot: 1 }) });
  assert.match(streamedResponse.headers.get("content-type"), /^application\/x-ndjson/u);
  const events = (await streamedResponse.text()).trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(events.filter(({ type }) => type === "progress").map(({ stage, current, total }) =>
    [stage, current ?? null, total ?? null]), [
    ["compiling-slots", 0, 3], ["compiling-slots", 1, 3], ["compiling-slots", 2, 3],
    ["compiling-slots", 3, 3], ["encoding-bundle", null, null], ["applying-local", null, null],
    ["done", null, null],
  ]);
  assert.equal(events.at(-1).type, "result");
  assert.equal(events.at(-1).value.status, "mock-bundle-applied");
  assert.equal(mock.calls.length, 2);
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

test("standalone Lab app uses a minimal URL-only Chrome shell with mock transport by default", () => {
  const launcher = createLabEditorLauncher();
  assert.match(launcher, /LAB_URL='http:\/\/127\.0\.0\.1:9231'/u);
  assert.match(launcher, /--app="\$LAB_URL"/u);
  assert.match(launcher, /"\$NODE_BIN" "\$LAB_SERVER"/u);
  assert.doesNotMatch(launcher, /--confirm-live-rpc|node-hid|wl-device|device manager|connectToDevice/iu);
});
