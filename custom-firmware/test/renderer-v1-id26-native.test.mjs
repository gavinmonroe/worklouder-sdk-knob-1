import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { compileCssWidget } from "../../f1-widget-sdk/src/render/css-scene.mjs";
import { buildGlyphAtlas } from "../../f1-widget-sdk/src/render/glyph-atlas.mjs";
import { encodeRasterAnimation } from "../../f1-widget-sdk/src/render/raster-animation.mjs";
import { renderCssSceneRgb565 } from "../../f1-widget-sdk/src/render/semantic-raster.mjs";
import { encodeWidgetBundle } from "../../f1-widget-sdk/src/render/widget-bundle.mjs";

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let directory;
let host;
let repeatHost;

function frameBytes(frame) {
  const output = Buffer.alloc(frame.length * 2);
  frame.forEach((pixel, index) => output.writeUInt16LE(pixel, index * 2));
  return output;
}

function productionShapeAtlas(glyphs) {
  return buildGlyphAtlas({
    glyphs, width: 14, height: 14, source: "native-renderer-golden-production-shape",
    rasterizeGlyph(glyph, { width, height, rowStride }) {
      const output = Buffer.alloc(rowStride * height);
      const seed = glyph.codePointAt(0);
      for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
        if (x === y || x + y === width - 1 || ((seed + x * 3 + y * 5) % 17) === 0)
          output[y * rowStride + (x >>> 3)] |= 0x80 >>> (x & 7);
      }
      return output;
    },
  });
}

function semanticFixture(color) {
  const compiled = compileCssWidget({
    rootClass: "x",
    html: '<div class="x"><span>A</span><span>B</span><span>C</span><span>D</span></div>',
    css: `.x { background-color:#021321; color:${color} }
      .x > span { color:${color}; animation:pulse 1.2s ease-in-out 0.2s infinite; text-shadow:0 0 10px ${color} }
      @keyframes pulse { 0% { color:${color}; text-shadow:none }
        50% { color:#ff4080; text-shadow:0 0 15px #ff4080 }
        100% { color:${color}; text-shadow:none } }`,
  });
  return { ...compiled, atlas: productionShapeAtlas(compiled.scene.glyphs) };
}

function rasterFixture() {
  const frames = [new Uint16Array(31_000).fill(0x1111)];
  const pixel = new Uint16Array(frames.at(-1)); pixel[102] = 0x1234; frames.push(pixel);
  const spans = new Uint16Array(frames.at(-1)); spans.fill(0x5678, 300, 320); frames.push(spans);
  const tiles = new Uint16Array(frames.at(-1));
  for (let y = 0; y < 10; y++) tiles.fill(0x9abc, y * 100, y * 100 + 10);
  frames.push(tiles);
  const encoded = encodeRasterAnimation({ frames, width: 100, height: 310, fps: 10,
    loopDurationMs: frames.length * 100, maxBytes: 128 * 1024, tileWidth: 10, tileHeight: 10 });
  assert.deepEqual(encoded.stats.modes, ["full", "pixels", "spans", "tiles"]);
  return { frames, encoded };
}

before(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "renderer-v1-native-"));
  host = path.join(directory, "renderer-v1-id26-host");
  repeatHost = path.join(directory, "renderer-v1-repeat-host");
  await Promise.all([
    run("cc", ["-O2", "-std=c11", "-Wall", "-Wextra", "-Werror", "-o", host,
      path.join(root, "custom-firmware/experimental/renderer-v1-id26-host.c")]),
    run("cc", ["-O2", "-std=c11", "-Wall", "-Wextra", "-Werror", "-o", repeatHost,
      path.join(root, "custom-firmware/experimental/renderer-v1-repeat-host.c")]),
  ]);
});
after(async () => { await rm(directory, { recursive: true, force: true }); });

async function nativeRender(bundle, slot, tick) {
  const input = path.join(directory, `bundle-${slot}-${tick}.bin`);
  const output = path.join(directory, `frame-${slot}-${tick}.bin`);
  await writeFile(input, bundle);
  await run(host, [input, String(slot), String(tick), output]);
  return readFile(output);
}

test("native ID26 renderer matches canonical semantic and all F1RA record modes", async () => {
  const left = semanticFixture("#40c0ff"), right = semanticFixture("#f0d020");
  const raster = rasterFixture();
  const bundle = encodeWidgetBundle({ generation: 9, activeSlot: 1, slots: [
    { name: "grid-blue", kind: "semantic", sceneBinary: left.binary, atlasBinary: left.atlas.binary },
    { name: "browser", kind: "raster", animationBinary: raster.encoded.binary },
    { name: "grid-gold", kind: "semantic", sceneBinary: right.binary, atlasBinary: right.atlas.binary },
  ] }).binary;
  assert.ok(bundle.length <= 98_304, `fixture exceeds live one-store cap: ${bundle.length}`);

  for (const tick of [0, 2, 5, 11, 17]) {
    assert.deepEqual(await nativeRender(bundle, 0, tick),
      frameBytes(renderCssSceneRgb565(left.scene, left.atlas, tick)), `semantic slot0 tick${tick}`);
    assert.deepEqual(await nativeRender(bundle, 2, tick),
      frameBytes(renderCssSceneRgb565(right.scene, right.atlas, tick)), `semantic slot2 tick${tick}`);
  }
  for (let tick = 0; tick < raster.frames.length; tick++)
    assert.deepEqual(await nativeRender(bundle, 1, tick), frameBytes(raster.frames[tick]), `raster frame${tick}`);
  assert.deepEqual(await nativeRender(bundle, 1, 4), frameBytes(raster.frames[0]), "raster loop wraps");
});

test("native admission fails closed on hash corruption and synthetic F1GA", async () => {
  const semantic = semanticFixture("#ffffff"), raster = rasterFixture();
  const encoded = encodeWidgetBundle({ generation: 1, slots: [
    { name: "semantic", kind: "semantic", sceneBinary: semantic.binary, atlasBinary: semantic.atlas.binary },
    { name: "raster", kind: "raster", animationBinary: raster.encoded.binary },
  ] }).binary;
  const corrupt = Buffer.from(encoded);
  corrupt[corrupt.readUInt32LE(20 + 4) + 20] ^= 1;
  await assert.rejects(nativeRender(corrupt, 0, 0));

  const synthetic = Buffer.from(encoded);
  const descriptor = 20; const auxiliaryOffset = synthetic.readUInt32LE(descriptor + 12);
  const auxiliaryLength = synthetic.readUInt32LE(descriptor + 16);
  synthetic[auxiliaryOffset + 5] |= 0x80;
  createHash("sha256").update(synthetic.subarray(auxiliaryOffset, auxiliaryOffset + auxiliaryLength)).digest()
    .copy(synthetic, descriptor + 52);
  await assert.rejects(nativeRender(synthetic, 0, 0));
});

test("single staging store freezes safely and supports active/off-screen repeated replacement", async () => {
  const paths = [];
  for (let generation = 1; generation <= 3; generation += 1) {
    const frame = new Uint16Array(31_000).fill(0x1000 + generation);
    const animation = encodeRasterAnimation({ frames: [frame], width: 100, height: 310,
      fps: 10, loopDurationMs: 100, maxBytes: 128 * 1024 });
    const bundle = encodeWidgetBundle({ generation, slots: [
      { name: `repeat-${generation}`, kind: "raster", animationBinary: animation.binary },
    ] }).binary;
    const file = path.join(directory, `repeat-${generation}.f1wb`);
    await writeFile(file, bundle); paths.push(file);
  }
  const result = await run(repeatHost, paths);
  assert.match(result.stdout,
    /distinct=1 active_busy=0 active_ready=1 inactive_busy=0 inactive_ready=1 frozen=1/u);
});

test("S3 registration-only artifact is deterministic little-endian and relocation-free", async () => {
  const result = await run(process.execPath,
    [path.join(root, "custom-firmware/tools/verify-renderer-v1-id26-abi.mjs")]);
  const report = JSON.parse(result.stdout);
  assert.deepEqual({ status: report.status, format: report.format, relocations: report.relocations,
    ordinaryIromDataBytes: report.ordinaryIromDataBytes, screenId: report.screenId,
    allocationBytes: report.allocationBytes, f1wbCapBytes: report.f1wbCapBytes,
    binaryBytes: report.binaryBytes, sha256: report.sha256 }, {
    status: "PASS_STATIC_ONLY", format: "elf32-xtensa-le", relocations: 0,
    ordinaryIromDataBytes: 0, screenId: 26, allocationBytes: 62_164,
    f1wbCapBytes: 98_304, binaryBytes: 8_140,
    sha256: "942fe3aeb723c24a9d66b2d8b0dfe6fffa04c6ff13c75777daf226456dbbe806",
  });
});
