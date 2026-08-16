import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeRasterAnimation,
  decodeWidgetBundle,
  encodeRasterAnimation,
  encodeWidgetBundle,
  fitRasterAnimation,
  rgba8888ToRgb565Frame,
  compileCssWidget,
  createDeterministicTestGlyphAtlas,
} from "../src/render/index.mjs";

const PIXELS = 100 * 310;

function frame(color = 0) {
  const output = new Uint16Array(PIXELS);
  output.fill(color);
  return output;
}

test("F1RA full frame and unchanged deltas round-trip exactly", () => {
  const first = frame(0x0020);
  const encoded = encodeRasterAnimation({ frames: [first, new Uint16Array(first), new Uint16Array(first)],
    fps: 10, loopDurationMs: 300, maxBytes: 64 * 1024 });
  assert.deepEqual(encoded.stats.modes, ["full", "pixels", "pixels"]);
  assert.deepEqual(encoded.stats.changedPixels, [PIXELS, 0, 0]);
  const decoded = decodeRasterAnimation(encoded.binary);
  assert.deepEqual(decoded.frames, [first, first, first]);
  assert.equal(decoded.fps, 10);
  assert.equal(decoded.loopDurationMs, 300);
});

test("F1RA selects pixel, span, tile, and full records by encoded size", () => {
  const base = frame();
  const sparse = frame(); sparse[5] = 0xffff; sparse[30000] = 0x1234;
  const run = new Uint16Array(sparse); for (let x = 100; x < 130; x += 1) run[x] = 0xabcd;
  const tile = new Uint16Array(run);
  for (let y = 0; y < 10; y += 1) for (let x = 0; x < 10; x += 1) tile[1000 + y * 100 + x] = 0xf800;
  const dense = frame(0x07e0);
  const encoded = encodeRasterAnimation({ frames: [base, sparse, run, tile, dense], fps: 5, loopDurationMs: 1000 });
  assert.deepEqual(encoded.stats.modes, ["full", "pixels", "spans", "tiles", "full"]);
  assert.deepEqual(decodeRasterAnimation(encoded.binary).frames, [base, sparse, run, tile, dense]);
});

test("F1RA frame fitter chooses the largest evenly distributed set within maxBytes", () => {
  const frames = Array.from({ length: 10 }, () => frame(0x39e7));
  const fitted = fitRasterAnimation({ frames, maxBytes: 62104, fps: 10, loopDurationMs: 1000 });
  assert.equal(fitted.stats.frameCount, 5);
  assert.deepEqual(fitted.selectedFrameIndices, [0, 2, 5, 7, 9]);
  assert.equal(fitted.stats.encodedBytes, 62104);
  assert.equal(fitted.stats.headroomBytes, 0);
  assert.equal(fitted.reduced, true);
});

test("F1RA decoder fails closed on payload mutation, truncation, and excess budget", () => {
  const encoded = encodeRasterAnimation({ frames: [frame()], fps: 1, loopDurationMs: 1000 });
  const corrupt = Buffer.from(encoded.binary); corrupt[100] ^= 1;
  assert.throws(() => decodeRasterAnimation(corrupt), /SHA-256 failed/u);
  assert.throws(() => decodeRasterAnimation(encoded.binary.subarray(0, -1)), /header is invalid|SHA-256/u);
  assert.throws(() => encodeRasterAnimation({ frames: [frame()], fps: 1, loopDurationMs: 1000,
    maxBytes: encoded.binary.length - 1 }), /exceeding/u);
});

test("RGBA browser capture conversion composites alpha and quantizes RGB565 deterministically", () => {
  const rgba = new Uint8Array(100 * 310 * 4);
  rgba.set([255, 0, 0, 255, 0, 255, 0, 128, 255, 255, 255, 0]);
  const converted = rgba8888ToRgb565Frame(rgba, { background: { r: 0, g: 0, b: 255 } });
  assert.equal(converted[0], 0xf800);
  assert.equal(converted[1], 0x040f);
  assert.equal(converted[2], 0x001f);
});

test("F1WB saves three mixed semantic/raster slots with an active knob index", () => {
  const semantic = compileCssWidget({ html: '<div class="x"><span>A</span></div>',
    css: `.x { background-color:#000; color:#fff } .x > span { color:#fff }`, rootClass: "x" });
  const atlas = createDeterministicTestGlyphAtlas(semantic.scene.glyphs);
  const raster = encodeRasterAnimation({ frames: [frame(0x001f)], fps: 10, loopDurationMs: 100 });
  const encoded = encodeWidgetBundle({ activeSlot: 2, generation: 7, slots: [
    { name: "matrix", kind: "semantic", sceneBinary: semantic.binary, atlas, allowTestAtlas: true },
    { name: "browser-one", kind: "raster", animationBinary: raster.binary },
    { name: "browser-two", kind: "raster", animationBinary: raster.binary },
  ] });
  const decoded = decodeWidgetBundle(encoded.binary);
  assert.equal(decoded.activeSlot, 2);
  assert.equal(decoded.generation, 7);
  assert.deepEqual(decoded.slots.map(({ name, kind }) => ({ name, kind })), [
    { name: "matrix", kind: "semantic" },
    { name: "browser-one", kind: "raster" },
    { name: "browser-two", kind: "raster" },
  ]);
  assert.deepEqual(decodeRasterAnimation(decoded.slots[1].animationBinary).frames[0], frame(0x001f));
  const corrupt = Buffer.from(encoded.binary); corrupt[corrupt.length - 1] ^= 1;
  assert.throws(() => decodeWidgetBundle(corrupt), /primary SHA failed/u);
});
