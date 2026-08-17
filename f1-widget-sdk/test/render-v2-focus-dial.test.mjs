import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  compileRendererV2Program,
  RENDERER_V2_LIMITS,
  RendererV2EventRuntime,
} from "../../custom-firmware/lib/renderer-v2-event-vm.mjs";
import {
  createRenderV2Runtime,
  encodeRenderV2Event,
  linkRenderV2Raster,
  prepareRenderV2,
} from "../src/render-v2/index.mjs";
import { createReadableDemoGlyphAtlas } from "../examples/render-v2-events/readable-atlas.mjs";
import {
  createFocusDialRaster,
  DIAL_STEPS,
  renderFocusDialFrame,
} from "../examples/render-v2-focus-dial/raster-design.mjs";
import {
  HOST_RPC_EVENT_ID,
  HOST_SYNC_SECONDS,
  leBufferToRgb565Frame,
  VIEWPORT,
} from "../examples/render-v2-focus-dial/program.mjs";
import { diffPixelCount } from "../examples/render-v2-focus-dial/visual.mjs";

const example = new URL("../examples/render-v2-focus-dial/", import.meta.url);

async function compileExample() {
  const sourceNames = ["widget.html", "widget.css", "widget.js", "raster-design.mjs"];
  const sourceEntries = await Promise.all(sourceNames.map(async (name) => [name,
    await readFile(new URL(name, example), "utf8")]));
  const source = Object.fromEntries(sourceEntries);
  const prepared = prepareRenderV2({ html: source["widget.html"], css: source["widget.css"],
    script: source["widget.js"], rootClass: "render-v2" });
  const atlas = createReadableDemoGlyphAtlas(prepared.scene.glyphs);
  const raster = createFocusDialRaster(prepared);
  const linked = linkRenderV2Raster(prepared, { atlas, ...raster });
  const firmwareProgram = compileRendererV2Program(linked.spec);
  return { sourceEntries, prepared, atlas, raster, linked, firmwareProgram };
}

function compareFrame(runtime, framebuffer, result) {
  const firmwareFrame = leBufferToRgb565Frame(framebuffer);
  assert.deepEqual(result.state, runtime.state);
  assert.equal(diffPixelCount(firmwareFrame, leBufferToRgb565Frame(result.frame)), 0);
  assert.equal(diffPixelCount(firmwareFrame, renderFocusDialFrame(runtime.state)), 0);
}

test("focus dial compiles its offline RGB565 base and patches into the unchanged bounded F2EP ABI", async () => {
  const { prepared, linked, firmwareProgram } = await compileExample();
  const authoredBytecode = Buffer.concat(prepared.script.handlers.map(({ instructionBinary }) => instructionBinary));
  assert.deepEqual(prepared.script.states.map(({ name, initial }) => [name, initial]),
    [["secondsOfDay", 45296], ["dialPhase", 0]]);
  assert.deepEqual(prepared.script.handlers.map(({ name }) => name),
    ["tick.1s", "input.fn-bottom-knob", "host.rpc:0xB201"]);
  assert.deepEqual(prepared.logicalBindings.map(({ name }) => name),
    ["clock_0", "clock_1", "clock_3", "clock_4", "clock_6", "clock_7", "knob"]);
  assert.equal(linked.renderSource, "pre-rendered-rgb565");
  assert.deepEqual(linked.budget, { states: 2, handlers: 3, bindings: 7, patchSets: 3,
    variants: 25, spans: 500, pixelBytes: 10646, baseFrameBytes: 62000, programBytes: 15178 });
  assert.equal(DIAL_STEPS, 5);
  assert.ok(linked.budget.spans <= RENDERER_V2_LIMITS.patchSpans);
  assert.ok(linked.budget.pixelBytes <= RENDERER_V2_LIMITS.patchBytes);
  assert.deepEqual(linked.program.bytecode, authoredBytecode);
  assert.deepEqual(linked.program.binary, firmwareProgram.binary);
  assert.deepEqual(linked.program.manifest, firmwareProgram.manifest);
  assert.equal(linked.program.sha256, firmwareProgram.sha256);
});

test("clock tick, three dial clicks, and host seconds sync are pixel-exact across both runtimes", async () => {
  const { linked, firmwareProgram } = await compileExample();
  const base = Buffer.from(linked.baseFrame); const framebuffer = Buffer.from(base);
  const firmware = new RendererV2EventRuntime(firmwareProgram, { framebuffer,
    renderV1Frame(output) { base.copy(output); } });
  const sdk = createRenderV2Runtime(linked);

  firmware.tick100ms();
  compareFrame(firmware, framebuffer, sdk.dispatch(encodeRenderV2Event({
    kind: "tick.100ms", value: 1, sequence: 1,
  })));
  for (let index = 0; index < 9; index += 1) firmware.tick100ms();
  compareFrame(firmware, framebuffer, sdk.dispatch(encodeRenderV2Event({
    kind: "tick.1s", value: 1, sequence: 2,
  })));
  for (let detent = 1; detent <= 3; detent += 1) {
    assert.equal(firmware.enqueueFnBottomKnob({ encoderId: 1, delta: 1, fnPressed: true }), true);
    firmware.tick100ms();
    compareFrame(firmware, framebuffer, sdk.dispatch(encodeRenderV2Event({
      kind: "input.fn-bottom-knob", flags: 1, id: 1, value: 1, sequence: 2 + detent,
    })));
  }
  assert.equal(firmware.enqueueHostRpc({ rpcEventId: HOST_RPC_EVENT_ID, value: HOST_SYNC_SECONDS }), true);
  firmware.tick100ms();
  compareFrame(firmware, framebuffer, sdk.dispatch(encodeRenderV2Event({
    kind: "host.rpc", id: HOST_RPC_EVENT_ID, value: HOST_SYNC_SECONDS, sequence: 6,
  })));
  assert.deepEqual(firmware.state, { secondsOfDay: HOST_SYNC_SECONDS, dialPhase: 4 });
});

test("raster linker rejects malformed external frames and owns admitted bytes", async () => {
  const { prepared, atlas, raster, linked } = await compileExample();
  assert.throws(() => linkRenderV2Raster(prepared, { atlas, baseFrame: Buffer.alloc(61_998),
    bindingPatches: raster.bindingPatches }), /exact 62,000-byte/u);
  const missing = { ...raster.bindingPatches }; delete missing.knob;
  assert.throws(() => linkRenderV2Raster(prepared, { atlas, baseFrame: raster.baseFrame,
    bindingPatches: missing }), /Raster patch knob is missing/u);
  assert.throws(() => linkRenderV2Raster(prepared, { atlas, baseFrame: raster.baseFrame,
    bindingPatches: { ...raster.bindingPatches, surprise: raster.bindingPatches.knob } }),
  /does not match a logical binding/u);

  const before = Buffer.from(linked.baseFrame); raster.baseFrame.fill(0);
  assert.deepEqual(linked.baseFrame, before, "linked raster base must not alias caller-owned bytes");
  const leaked = linked.baseFrame; leaked.fill(0);
  assert.deepEqual(linked.baseFrame, before, "linked raster base getter must return an owned copy");
});

test("generated focus-dial manifest and six event frames are locked to exact source and RGB565 bytes", async () => {
  const { sourceEntries, linked } = await compileExample();
  const [manifestSource, programBinary, contactSheet] = await Promise.all([
    readFile(new URL("build/manifest.json", example)),
    readFile(new URL("build/render-v2-focus-dial.f2ep", example)),
    readFile(new URL("build/contact-sheet.png", example)),
  ]);
  const manifest = JSON.parse(manifestSource);
  const sourceHash = createHash("sha256");
  sourceEntries.forEach(([name, source]) => sourceHash.update(name).update("\0").update(source).update("\0"));
  assert.equal(manifest.format, "framer-renderer-v2-focus-dial-demo-v1");
  assert.equal(manifest.execution.renderSource, "pre-rendered-rgb565");
  assert.equal(manifest.execution.deviceRasterizesDial, false);
  assert.equal(manifest.source.sha256, sourceHash.digest("hex"));
  assert.equal(createHash("sha256").update(programBinary).digest("hex"), linked.program.sha256);
  assert.equal(manifest.program.sha256, linked.program.sha256);
  assert.equal(manifest.compiler.sdkFirmwareBinaryExact, true);
  assert.equal(manifest.compiler.sdkFirmwareManifestExact, true);
  assert.ok(manifest.frames.every(({ hostDiffPixels, fullRasterRenderDiffPixels }) =>
    hostDiffPixels === 0 && fullRasterRenderDiffPixels === 0));
  assert.deepEqual(manifest.frames.map(({ semantic }) => semantic), [
    { clock: "12:34:56", dialDetent: 1 },
    { clock: "12:34:57", dialDetent: 2 },
    { clock: "12:34:57", dialDetent: 3 },
    { clock: "12:34:57", dialDetent: 4 },
    { clock: "12:34:57", dialDetent: 5 },
    { clock: "02:12:00", dialDetent: 5 },
  ]);
  assert.equal(manifest.design.safeArea.topStatusY, 20);
  assert.equal(manifest.animation.frames.length, 5);
  assert.equal(contactSheet.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  for (const record of manifest.frames) {
    const raw = await readFile(new URL(`build/${record.raw}`, example));
    assert.equal(raw.length, VIEWPORT.width * VIEWPORT.height * 2);
    assert.equal(createHash("sha256").update(raw).digest("hex"), record.rgb565Sha256);
  }
});
