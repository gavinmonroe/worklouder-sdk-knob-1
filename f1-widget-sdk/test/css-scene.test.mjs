import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { missingPinnedFont } from "../test-support/pinned-inputs.mjs";

import {
  compileCssWidget,
  createDeterministicTestGlyphAtlas,
  decodeCssScene,
  decodeGlyphAtlas,
  decodeSceneBundle,
  encodeSceneBundle,
  rasterizeGlyphAtlasWithMagick,
  renderCssSceneRgb565,
  sampleCssCell,
  sampleCssCellAtTick,
} from "../src/render/index.mjs";

const example = new URL("../examples/jp-matrix/", import.meta.url);

async function compileExample() {
  const [html, css] = await Promise.all([
    readFile(new URL("widget.html", example), "utf8"),
    readFile(new URL("matrix.css", example), "utf8"),
  ]);
  return compileCssWidget({ html, css });
}

test("matrix CSS lowers to a bounded deterministic 100x310 scene", async () => {
  const first = await compileExample();
  const second = await compileExample();
  assert.deepEqual(second.binary, first.binary);
  assert.deepEqual(first.scene.viewport, { width: 100, height: 310 });
  assert.deepEqual(first.scene.layout, {
    columns: 5, rows: 15, cellWidth: 20, cellHeight: 20, top: 5,
  });
  assert.equal(first.scene.cells.length, 75);
  assert.equal(first.scene.glyphs.length, 71);
  assert.equal(first.scene.animations.length, 12);
  assert.deepEqual(first.scene.tracks[0].stops.map(({ percent }) => percent), [0, 30, 50, 70, 100]);
  assert.equal(first.binary.length, 1048);
  assert.equal(first.scene.sha256, "97b0e81d6554ba8725bba8418219af0d2a5182bdbff3f9ab34752af0bb59baad");
});

test("nth-child cascade is resolved on the host instead of on the firmware", async () => {
  const { scene } = await compileExample();
  const first = scene.animations[scene.cells[0].animationId];
  assert.deepEqual(first, {
    name: "smooth-pulse", durationTicks: 39, delayTicks: 4, easing: "ease-in-out", trackId: 0,
  }, "41n+1 occurs after 29n+1 and wins for child 1");
  assert.equal(scene.cells[2].animationId, 255);
  const eleventh = scene.animations[scene.cells[10].animationId];
  assert.equal(eleventh.durationTicks, 29);
  assert.equal(eleventh.delayTicks, 11);
  assert.equal(scene.cells[10].color565, 19574, "11n static color is lowered before animation starts");
});

test("keyframe timing, delay, color, and glow are sampled deterministically", async () => {
  const { scene } = await compileExample();
  const cell = 1;
  assert.equal(sampleCssCell(scene, cell, 100).progress, 0, "positive delay retains underlying style");
  assert.deepEqual(sampleCssCellAtTick(scene, 3, 29).rgba, { r: 255, g: 105, b: 180, a: 255 },
    "a keyframe that falls on a device tick is exact");
  assert.deepEqual(sampleCssCell(scene, cell, 1250), sampleCssCell(scene, cell, 1200),
    "preview time is quantized to the same 100ms tick as firmware");
  assert.equal(sampleCssCellAtTick(scene, cell, 27).glowRadius, 3);
});

test("encoded scenes validate, decode, and sample exactly like the compiler scene", async () => {
  const { scene, binary } = await compileExample();
  const decoded = decodeCssScene(binary);
  assert.equal(decoded.sha256, scene.sha256);
  for (let tick = 0; tick < 100; tick += 1) {
    for (let cell = 0; cell < scene.cells.length; cell += 1) {
      assert.deepEqual(sampleCssCellAtTick(decoded, cell, tick), sampleCssCellAtTick(scene, cell, tick),
        `cell ${cell}, tick ${tick}`);
    }
  }
  assert.throws(() => decodeCssScene(Buffer.concat([binary, Buffer.of(0)])), /trailing/u);
});

test("three named scene slots round-trip with independent SHA-256 validation", async () => {
  const compiled = await compileExample();
  const atlas = createDeterministicTestGlyphAtlas(compiled.scene.glyphs);
  assert.equal(decodeGlyphAtlas(atlas.binary).testOnly, true);
  assert.throws(() => encodeSceneBundle({ slots: [{ name: "unsafe", sceneBinary: compiled.binary,
    atlasBinary: atlas.binary }] }), /synthetic test atlas/u);
  const encoded = encodeSceneBundle({ activeSlot: 1, generation: 42,
    slots: ["matrix-blue", "matrix-pink", "matrix-white"].map((name) => ({
      name, sceneBinary: compiled.binary, atlas, allowTestAtlas: true,
    })) });
  const bundle = decodeSceneBundle(encoded.binary);
  assert.equal(bundle.slots.length, 3);
  assert.equal(bundle.activeSlot, 1);
  assert.equal(bundle.generation, 42);
  assert.deepEqual(bundle.slots.map(({ name }) => name), ["matrix-blue", "matrix-pink", "matrix-white"]);
  for (const slot of bundle.slots) {
    assert.equal(decodeCssScene(slot.sceneBinary).sha256, compiled.scene.sha256);
    assert.equal(decodeGlyphAtlas(slot.atlasBinary).glyphCount, compiled.scene.glyphs.length);
  }
  const corrupt = Buffer.from(encoded.binary);
  corrupt[corrupt.length - 1] ^= 1;
  assert.throws(() => decodeSceneBundle(corrupt), /atlas SHA-256 failed/u);
});

test("pinned Hiragino atlas and software preview produce a pixel-exact golden frame", { skip: missingPinnedFont() }, async () => {
  const { scene } = await compileExample();
  const atlas = await rasterizeGlyphAtlasWithMagick(scene.glyphs);
  assert.equal(atlas.testOnly, false);
  assert.equal(atlas.binary.length, 2004);
  assert.equal(atlas.sha256, "f71a9cc7105843a7b1d40b0dfce97965b0fd81260c6fe788683c07ad6733ac70");
  const frame = renderCssSceneRgb565(scene, atlas, 0);
  const bytes = Buffer.alloc(frame.length * 2);
  frame.forEach((color, index) => bytes.writeUInt16LE(color, index * 2));
  assert.equal(createHash("sha256").update(bytes).digest("hex"),
    "7bd048404ff49df66f38c5d9445548b1a41fe50ada6bcbfa511b1711733ce451");
  assert.equal([...frame].filter((color) => color !== scene.background.color565).length, 8446);
});

test("scene and runtime memory stay within the renderer-v1 prototype budget", async () => {
  const { scene } = await compileExample();
  assert.deepEqual(scene.budget, {
    sceneBytes: 1048,
    frameBufferBytes: 62000,
    descriptorBytes: 48,
    glyphAtlasBytes: 1988,
    cellScratchBytes: 800,
    totalPersistentEstimate: 65084,
    animatedCells: 35,
    maxDirtyPixelsPerTick: 14000,
  });
  assert.ok(scene.budget.sceneBytes < 2048);
  assert.ok(scene.budget.totalPersistentEstimate < 70 * 1024);
});

test("unsupported or unsafe CSS fails closed", () => {
  const html = '<div class="jp-matrix"><span>ア</span></div>';
  const css = `.jp-matrix { background-color:#000; color:#fff }\n` +
    `.jp-matrix > span { animation: pulse 2s ease-in-out 0s }\n` +
    `@keyframes pulse { 0% { color:#fff } 100% { color:#000 } }`;
  assert.throws(() => compileCssWidget({ html, css }), /infinite animations only/u);
});

test("semantic CSS reports lowerings, applies source-order cascade, and rejects silent features", () => {
  const html = '<div class="jp-matrix"><span>ア</span></div>';
  const css = `.jp-matrix { background-color:#000; color:#fff; display:grid; width:100% }
    .jp-matrix > span { color:#f00; transition:color .5s }
    .jp-matrix > span { color:#00f }`;
  const { scene } = compileCssWidget({ html, css });
  assert.equal(scene.cells[0].color565, 0x001f, "later equal-specificity rule wins");
  assert.ok(scene.diagnostics.some(({ code, property }) => code === "CSS_PROPERTY_LOWERED" && property === "display"));
  assert.ok(scene.diagnostics.some(({ code, property }) => code === "CSS_PROPERTY_IGNORED" && property === "transition"));
  assert.throws(() => compileCssWidget({ html,
    css: `.jp-matrix { background-color:#000 } .jp-matrix > span { color:#fff; filter:blur(2px) }` }),
  (error) => error.name === "CssCompileError" && error.diagnostics[0].property === "filter");
  assert.throws(() => compileCssWidget({ html,
    css: `.jp-matrix { background-color:#000 } .jp-matrix span { color:#fff }` }), /unsupported construct/u);
});
