import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { compileRendererV2Program, RENDERER_V2_LIMITS,
  RendererV2EventRuntime } from "../../custom-firmware/lib/renderer-v2-event-vm.mjs";
import { createRenderV2Runtime, encodeRenderV2Event, linkRenderV2Raster,
  prepareRenderV2, RENDER_V2_OPCODES } from "../src/render-v2/index.mjs";
import { createReadableDemoGlyphAtlas } from "../examples/render-v2-events/readable-atlas.mjs";
import { createTimerRaster, DIAL_STEPS, formatTimer,
  renderTimerFrame } from "../examples/render-v2-focus-timer/timer-design.mjs";
import { HOST_RPC_EVENT_ID, HOST_SYNC_SECONDS, leBufferToRgb565Frame,
  VIEWPORT } from "../examples/render-v2-focus-timer/program.mjs";
import { diffPixelCount } from "../examples/render-v2-focus-timer/visual.mjs";

const example = new URL("../examples/render-v2-focus-timer/", import.meta.url);
const focusBuild = new URL("../examples/render-v2-focus-dial/build/", import.meta.url);
async function compileExample() {
  const sourceNames = ["widget.html", "widget.css", "widget.js", "timer-design.mjs"];
  const [sourceEntries, sharedBaseFrame] = await Promise.all([
    Promise.all(sourceNames.map(async (name) => [name, await readFile(new URL(name, example), "utf8")])),
    readFile(new URL("render-v2-focus-dial.base.rgb565", focusBuild)),
  ]);
  const source = Object.fromEntries(sourceEntries);
  const prepared = prepareRenderV2({ html: source["widget.html"], css: source["widget.css"],
    script: source["widget.js"], rootClass: "render-v2" });
  const atlas = createReadableDemoGlyphAtlas(prepared.scene.glyphs);
  const raster = createTimerRaster(prepared, { sharedBaseFrame });
  const linked = linkRenderV2Raster(prepared, { atlas, ...raster });
  return { sourceEntries, prepared, atlas, raster, linked, firmwareProgram: compileRendererV2Program(linked.spec) };
}
function compare(firmware, framebuffer, result) {
  const frame = leBufferToRgb565Frame(framebuffer);
  assert.deepEqual(result.state, firmware.state);
  assert.equal(diffPixelCount(frame, leBufferToRgb565Frame(result.frame)), 0);
  assert.equal(diffPixelCount(frame, renderTimerFrame(firmware.state)), 0);
}

test("timer uses one scaled-delta opcode and a raster-only total-minute selector through 95:00", async () => {
  const { prepared, linked, firmwareProgram } = await compileExample();
  assert.deepEqual(prepared.script.states.map(({ name, initial }) => [name, initial]),
    [["remainingSeconds", 1500], ["dialPhase", 0]]);
  assert.deepEqual(prepared.script.handlers.map(({ name }) => name),
    ["tick.1s", "input.fn-bottom-knob", "host.rpc:0xB201"]);
  const fnInstructions = prepared.script.handlers[1].instructions;
  assert.equal(fnInstructions.filter(({ opcode }) => opcode === RENDER_V2_OPCODES.ADD_EVENT_SCALED).length, 1);
  assert.deepEqual(fnInstructions.find(({ opcode }) => opcode === RENDER_V2_OPCODES.ADD_EVENT_SCALED),
    { opcode: RENDER_V2_OPCODES.ADD_EVENT_SCALED, dstState: 0, eventField: 1, imm: 300 });
  assert.deepEqual(linked.spec.bindings[2], { state: "remainingSeconds", divisor: 600, modulo: 10,
    patchSet: "patch1", originPixel: 5208 });
  assert.equal(linked.renderSource, "pre-rendered-rgb565");
  assert.deepEqual(linked.budget, { states: 2, handlers: 3, bindings: 7, patchSets: 3,
    variants: 25, spans: 460, pixelBytes: 10366, baseFrameBytes: 62000, programBytes: 14618 });
  assert.equal(DIAL_STEPS, 5);
  assert.ok(linked.budget.spans <= RENDERER_V2_LIMITS.patchSpans);
  assert.ok(linked.budget.pixelBytes <= RENDERER_V2_LIMITS.patchBytes);
  assert.deepEqual(linked.program.binary, firmwareProgram.binary);
  assert.equal(linked.program.sha256, "80e7ca2e30a56ca12c29320256884c69cdaef7fea27a6468a0cb54122cad8979");
});

test("initial, turn+, turn-, countdown tick, and host sync stay pixel-exact", async () => {
  const { linked, firmwareProgram } = await compileExample();
  const base = Buffer.from(linked.baseFrame); const framebuffer = Buffer.from(base);
  const firmware = new RendererV2EventRuntime(firmwareProgram, { framebuffer,
    renderV1Frame(target) { base.copy(target); } }); const sdk = createRenderV2Runtime(linked);
  firmware.tick100ms(); compare(firmware, framebuffer, sdk.dispatch(encodeRenderV2Event({
    kind: "tick.100ms", value: 1, sequence: 1 })));
  assert.equal(firmware.enqueueFnBottomKnob({ encoderId: 1, delta: 1, fnPressed: true }), true);
  firmware.tick100ms(); compare(firmware, framebuffer, sdk.dispatch(encodeRenderV2Event({
    kind: "input.fn-bottom-knob", flags: 1, id: 1, value: 1, sequence: 2 })));
  assert.deepEqual(firmware.state, { remainingSeconds: 1800, dialPhase: 1 });
  assert.equal(firmware.enqueueFnBottomKnob({ encoderId: 1, delta: -1, fnPressed: true }), true);
  firmware.tick100ms(); compare(firmware, framebuffer, sdk.dispatch(encodeRenderV2Event({
    kind: "input.fn-bottom-knob", flags: 1, id: 1, value: -1, sequence: 3 })));
  for (let tick = 0; tick < 7; tick += 1) firmware.tick100ms();
  compare(firmware, framebuffer, sdk.dispatch(encodeRenderV2Event({ kind: "tick.1s", value: 1, sequence: 4 })));
  assert.deepEqual(firmware.state, { remainingSeconds: 1499, dialPhase: 1 });
  assert.equal(firmware.enqueueHostRpc({ rpcEventId: HOST_RPC_EVENT_ID, value: HOST_SYNC_SECONDS }), true);
  firmware.tick100ms(); compare(firmware, framebuffer, sdk.dispatch(encodeRenderV2Event({
    kind: "host.rpc", id: HOST_RPC_EVENT_ID, value: HOST_SYNC_SECONDS, sequence: 5 })));
  assert.deepEqual(firmware.state, { remainingSeconds: 5700, dialPhase: 1 });
});

test("unmodified or non-bottom detents fall through while the timer continues without key-up", async () => {
  const { linked, firmwareProgram } = await compileExample(); const base = Buffer.from(linked.baseFrame);
  const framebuffer = Buffer.from(base); const firmware = new RendererV2EventRuntime(firmwareProgram, {
    framebuffer, renderV1Frame(target) { base.copy(target); } });
  firmware.tick100ms();
  assert.equal(firmware.enqueueFnBottomKnob({ encoderId: 1, delta: 1, fnPressed: false }), false);
  assert.equal(firmware.enqueueFnBottomKnob({ encoderId: 0, delta: 1, fnPressed: true }), false);
  assert.equal(firmware.enqueueFnBottomKnob({ encoderId: 1, delta: 1, fnPressed: true,
    inputAvailable: false }), false);
  assert.equal(firmware.queuedEvents, 0);
  for (let tick = 0; tick < 9; tick += 1) firmware.tick100ms();
  assert.deepEqual(firmware.state, { remainingSeconds: 1499, dialPhase: 1 });
  assert.equal(diffPixelCount(leBufferToRgb565Frame(framebuffer), renderTimerFrame(firmware.state)), 0);
});

test("an Fn detent on the exact second boundary composes with the independent automatic click", async () => {
  const { linked, firmwareProgram } = await compileExample();
  for (const [delta, remainingSeconds, dialPhase] of [[1, 1799, 2], [-1, 1199, 0]]) {
    const base = Buffer.from(linked.baseFrame); const framebuffer = Buffer.from(base);
    const firmware = new RendererV2EventRuntime(firmwareProgram, { framebuffer,
      renderV1Frame(target) { base.copy(target); } });
    for (let tick = 0; tick < 9; tick += 1) firmware.tick100ms();
    assert.equal(firmware.enqueueFnBottomKnob({ encoderId: 1, delta, fnPressed: true }), true);
    const result = firmware.tick100ms();
    assert.equal(result.secondTick, true);
    assert.deepEqual(firmware.state, { remainingSeconds, dialPhase });
    assert.equal(diffPixelCount(leBufferToRgb565Frame(framebuffer), renderTimerFrame(firmware.state)), 0);
  }
});

test("05:00, 55:00, 60:00, and 95:00 render exact unclipped four-digit boundaries", async () => {
  const { linked } = await compileExample(); const runtime = createRenderV2Runtime(linked);
  const expectations = [[300, "05:00"], [3300, "55:00"], [3600, "60:00"], [5700, "95:00"]];
  for (const [remainingSeconds, display] of expectations) {
    const result = runtime.dispatch(encodeRenderV2Event({ kind: "host.rpc", id: HOST_RPC_EVENT_ID,
      value: remainingSeconds, sequence: remainingSeconds }));
    assert.equal(formatTimer(result.state.remainingSeconds), display);
    const expected = renderTimerFrame({ remainingSeconds, knobVariant: 0 });
    const frame = leBufferToRgb565Frame(result.frame); assert.equal(diffPixelCount(frame, expected), 0);
    const lit = [];
    for (let y = 52; y < 84; y += 1) for (let x = 0; x < VIEWPORT.width; x += 1) {
      if (frame[y * VIEWPORT.width + x] !== 0) lit.push(x);
    }
    assert.ok(Math.min(...lit) >= 5 && Math.max(...lit) <= 91,
      `${display} digit pixels must stay within x=5..91`);
  }
});

test("tick.1s reaches and holds the exact 00:00 full raster floor", async () => {
  const { linked } = await compileExample();
  const floorSpec = { ...linked.spec, state: { ...linked.spec.state, remainingSeconds: 1 } };
  const floorProgram = compileRendererV2Program(floorSpec); const base = Buffer.from(linked.baseFrame);
  const framebuffer = Buffer.from(base); const firmware = new RendererV2EventRuntime(floorProgram, {
    framebuffer, renderV1Frame(target) { base.copy(target); } });
  for (let tick = 0; tick < 10; tick += 1) firmware.tick100ms();
  assert.deepEqual(firmware.state, { remainingSeconds: 0, dialPhase: 1 });
  assert.equal(formatTimer(firmware.state.remainingSeconds), "00:00");
  assert.equal(diffPixelCount(leBufferToRgb565Frame(framebuffer), renderTimerFrame(firmware.state)), 0);
  for (let tick = 0; tick < 10; tick += 1) firmware.tick100ms();
  assert.deepEqual(firmware.state, { remainingSeconds: 0, dialPhase: 2 });
  assert.equal(diffPixelCount(leBufferToRgb565Frame(framebuffer), renderTimerFrame(firmware.state)), 0);
});

test("raster selector overrides fail closed outside the admitted variant set", async () => {
  const { prepared, atlas, raster } = await compileExample();
  const invalidModulo = { ...raster.bindingPatches,
    clock_3: { ...raster.bindingPatches.clock_3, modulo: 11 } };
  assert.throws(() => linkRenderV2Raster(prepared, { atlas, baseFrame: raster.baseFrame,
    bindingPatches: invalidModulo }), /modulo override exceeds/u);
  const invalidDivisor = { ...raster.bindingPatches,
    clock_3: { ...raster.bindingPatches.clock_3, divisor: 0 } };
  assert.throws(() => linkRenderV2Raster(prepared, { atlas, baseFrame: raster.baseFrame,
    bindingPatches: invalidDivisor }), /positive uint32/u);
});

test("generated timer lifecycle, boundary frames, and shared-store proof are hash-locked", async () => {
  const { sourceEntries, linked } = await compileExample();
  const [manifestSource, f2ep, sharedStore, focusF1wb, focusF2ep, sharedBase, lifecycle, boundary] = await Promise.all([
    readFile(new URL("build/manifest.json", example), "utf8"),
    readFile(new URL("build/render-v2-focus-timer.f2ep", example)),
    readFile(new URL("build/render-v2-focus-plus-timer.store-fit.bin", example)),
    readFile(new URL("render-v2-focus-dial.base.f1wb", focusBuild)),
    readFile(new URL("render-v2-focus-dial.f2ep", focusBuild)),
    readFile(new URL("render-v2-focus-dial.base.rgb565", focusBuild)),
    readFile(new URL("build/lifecycle-contact-sheet.png", example)),
    readFile(new URL("build/boundary-contact-sheet.png", example)),
  ]);
  const manifest = JSON.parse(manifestSource); const sourceHash = createHash("sha256");
  sourceEntries.forEach(([name, source]) => sourceHash.update(name).update("\0").update(source).update("\0"));
  assert.equal(manifest.source.sha256, sourceHash.digest("hex"));
  assert.equal(manifest.screenProfile, "timer/id27-proposed");
  assert.deepEqual(manifest.compiler.selectorOverrides, { clock_0: { divisor: 36000, modulo: 1 },
    clock_3: { divisor: 600, modulo: 10 } });
  assert.equal(createHash("sha256").update(f2ep).digest("hex"), linked.program.sha256);
  assert.equal(createHash("sha256").update(sharedBase).digest("hex"), manifest.sharedBase.sha256);
  const compressedBase = await readFile(new URL("build/render-v2-focus-timer.base.lzss", example));
  assert.deepEqual(sharedStore, Buffer.concat([focusF1wb, focusF2ep, f2ep, compressedBase]));
  assert.equal(sharedStore.length, manifest.sharedStore.bytes);
  assert.equal(createHash("sha256").update(sharedStore).digest("hex"), manifest.sharedStore.sha256);
  assert.equal(manifest.sharedStore.capacityBytes, 98304);
  assert.equal(manifest.sharedStore.bytes, 95535); assert.equal(manifest.sharedStore.remainingBytes, 2769);
  assert.equal(manifest.sharedStore.sha256, "c7a49c9f7a4f709692299cff9239b9f5e0d9cc0c946efc948d3c54b54b1f5102");
  assert.equal(manifest.timerSwitchBase.compressedBytes, 3335);
  assert.equal(manifest.timerSwitchBase.compressedSha256,
    "cae1a0903e8b9ec09880dee05652a354b420cd5966d10b28c0382e40c0427307");
  assert.equal(lifecycle.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(boundary.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(createHash("sha256").update(lifecycle).digest("hex"), manifest.contactSheetSha256);
  assert.equal(manifest.contactSheetSha256, "3be60cc0a3d6b486bcfd66df748877738c4523b0625e11a382b04eddb588dec6");
  assert.equal(createHash("sha256").update(boundary).digest("hex"), manifest.boundaryContactSheetSha256);
  assert.equal(manifest.boundaryContactSheetSha256, "4e4d383330e6440a89c59a398fd25569321d116619f02420411695c872291439");
  assert.deepEqual(manifest.frames.map(({ semantic }) => semantic), [
    { display: "25:00", dialDetent: 1 }, { display: "30:00", dialDetent: 2 },
    { display: "25:00", dialDetent: 1 }, { display: "24:59", dialDetent: 2 },
    { display: "95:00", dialDetent: 2 },
  ]);
  assert.equal(manifest.design.safeArea.topStatusY, 20);
  assert.equal(manifest.animation.frames.length, 5);
  assert.deepEqual(manifest.boundaryFrames.map(({ display }) => display),
    ["05:00", "00:00", "55:00", "60:00", "95:00"]);
  for (const record of [...manifest.frames, ...manifest.boundaryFrames]) {
    const raw = await readFile(new URL(`build/${record.raw}`, example));
    assert.equal(raw.length, VIEWPORT.width * VIEWPORT.height * 2);
    assert.equal(createHash("sha256").update(raw).digest("hex"), record.rgb565Sha256);
  }
});
