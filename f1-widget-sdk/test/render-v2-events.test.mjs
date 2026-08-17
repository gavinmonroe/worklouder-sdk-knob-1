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
  linkRenderV2,
  prepareRenderV2,
} from "../src/render-v2/index.mjs";
import { HOST_RPC_EVENT_ID, leBufferToRgb565Frame } from "../examples/render-v2-events/program.mjs";
import { createReadableDemoGlyphAtlas } from "../examples/render-v2-events/readable-atlas.mjs";
import { renderFreshSemanticState } from "../examples/render-v2-events/semantic-parity.mjs";
import { diffPixelCount, VIEWPORT } from "../examples/render-v2-events/visual.mjs";

const example = new URL("../examples/render-v2-events/", import.meta.url);

async function compileExample() {
  const [html, css, script] = await Promise.all(["widget.html", "widget.css", "widget.js"]
    .map((name) => readFile(new URL(name, example), "utf8")));
  const prepared = prepareRenderV2({ html, css, script, rootClass: "render-v2" });
  const atlas = createReadableDemoGlyphAtlas(prepared.scene.glyphs);
  const linked = linkRenderV2(prepared, { atlas });
  const firmwareProgram = compileRendererV2Program(linked.spec);
  return { html, css, script, prepared, atlas, linked, firmwareProgram };
}

test("shipped ES5 source compiles through the self-contained SDK to byte-exact firmware F2EP", async () => {
  const { prepared, linked, firmwareProgram } = await compileExample();
  const authoredBytecode = Buffer.concat(prepared.script.handlers.map(({ instructionBinary }) => instructionBinary));
  assert.deepEqual(prepared.script.states.map(({ name, initial }) => [name, initial]),
    [["secondsOfDay", 45296], ["knobVariant", 0], ["hostValue", 0]]);
  assert.deepEqual(prepared.script.handlers.map(({ name }) => name),
    ["tick.1s", "input.fn-bottom-knob", "host.rpc:0xB201"]);
  assert.deepEqual(linked.program.bytecode, authoredBytecode);
  assert.deepEqual(linked.program.binary, firmwareProgram.binary);
  assert.deepEqual(linked.program.manifest, firmwareProgram.manifest);
  assert.equal(linked.program.sha256, firmwareProgram.sha256);
  assert.deepEqual(linked.budget, { states: 3, handlers: 3, bindings: 8, patchSets: 3,
    variants: 23, spans: 322, pixelBytes: 6440, baseFrameBytes: 62000, programBytes: 9536 });
  assert.ok(linked.budget.spans <= RENDERER_V2_LIMITS.patchSpans);
  assert.ok(linked.budget.pixelBytes <= RENDERER_V2_LIMITS.patchBytes);
});

test("SDK runtime, firmware model, and fresh full semantic renders stay pixel-exact for all events", async () => {
  const { prepared, atlas, linked, firmwareProgram } = await compileExample();
  const base = Buffer.from(linked.baseFrame);
  const framebuffer = Buffer.from(base);
  const firmware = new RendererV2EventRuntime(firmwareProgram, { framebuffer,
    renderV1Frame(output) { base.copy(output); } });
  const sdk = createRenderV2Runtime(linked);
  const compare = (sdkResult) => {
    const firmwareFrame = leBufferToRgb565Frame(framebuffer);
    assert.deepEqual(sdkResult.state, firmware.state);
    assert.equal(diffPixelCount(firmwareFrame, leBufferToRgb565Frame(sdkResult.frame)), 0);
    assert.equal(diffPixelCount(firmwareFrame, renderFreshSemanticState(prepared, atlas, firmware.state)), 0);
  };

  compare(sdk.dispatch(encodeRenderV2Event({ kind: "tick.100ms", value: 1, sequence: 1 })));
  for (let index = 0; index < 10; index += 1) firmware.tick100ms();
  compare(sdk.dispatch(encodeRenderV2Event({ kind: "tick.1s", value: 1, sequence: 2 })));

  assert.equal(firmware.enqueueFnBottomKnob({ encoderId: 1, delta: 1, fnPressed: true }), true);
  firmware.tick100ms();
  compare(sdk.dispatch(encodeRenderV2Event({ kind: "input.fn-bottom-knob", flags: 1,
    id: 1, value: 1, sequence: 3 })));

  assert.equal(firmware.enqueueHostRpc({ rpcEventId: HOST_RPC_EVENT_ID, value: 7 }), true);
  firmware.tick100ms();
  compare(sdk.dispatch(encodeRenderV2Event({ kind: "host.rpc", id: HOST_RPC_EVENT_ID,
    value: 7, sequence: 4 })));
  assert.deepEqual(firmware.state, { secondsOfDay: 45297, knobVariant: 1, hostValue: 7 });
});

test("Fn gating and the fixed RPC ID fail closed in the generated firmware program", async () => {
  const { linked, firmwareProgram } = await compileExample();
  const base = Buffer.from(linked.baseFrame); const framebuffer = Buffer.from(base);
  const runtime = new RendererV2EventRuntime(firmwareProgram, { framebuffer,
    renderV1Frame(output) { base.copy(output); } });
  runtime.tick100ms();
  assert.equal(runtime.enqueueFnBottomKnob({ encoderId: 1, delta: 1, fnPressed: false }), false);
  assert.equal(runtime.enqueueFnBottomKnob({ encoderId: 0, delta: 1, fnPressed: true }), false);
  assert.equal(runtime.enqueueHostRpc({ rpcEventId: HOST_RPC_EVENT_ID + 1, value: 7 }), false);
  runtime.tick100ms();
  assert.deepEqual(runtime.state, { secondsOfDay: 45296, knobVariant: 0, hostValue: 0 });
});

test("generated compiler frames and manifest are hash-locked to the exact source and F2EP", async () => {
  const { html, css, script, linked } = await compileExample();
  const [manifestSource, programBinary, contactSheet] = await Promise.all([
    readFile(new URL("build/manifest.json", example), "utf8"),
    readFile(new URL("build/render-v2-events.f2ep", example)),
    readFile(new URL("build/contact-sheet.png", example)),
  ]);
  const manifest = JSON.parse(manifestSource);
  const sourceHash = createHash("sha256");
  [["widget.html", html], ["widget.css", css], ["widget.js", script]].forEach(([name, source]) =>
    sourceHash.update(name).update("\0").update(source).update("\0"));
  assert.equal(manifest.format, "framer-renderer-v2-events-demo-v2");
  assert.equal(manifest.execution.target, "authored-source-to-deterministic-compiled-event-vm");
  assert.equal(manifest.execution.deviceEvaluatesJavaScript, false);
  assert.equal(manifest.source.sha256, sourceHash.digest("hex"));
  assert.equal(createHash("sha256").update(programBinary).digest("hex"), linked.program.sha256);
  assert.equal(manifest.program.sha256, linked.program.sha256);
  assert.equal(manifest.compiler.sdkFirmwareBinaryExact, true);
  assert.equal(manifest.compiler.sdkFirmwareManifestExact, true);
  assert.ok(manifest.frames.every(({ hostDiffPixels, fullSemanticRenderDiffPixels }) =>
    hostDiffPixels === 0 && fullSemanticRenderDiffPixels === 0));
  assert.deepEqual(manifest.frames.map(({ semantic }) => semantic), [
    { clock: "12:34:56", knob: "1", host: "0", hostColor: "#59E2FF" },
    { clock: "12:34:57", knob: "1", host: "0", hostColor: "#59E2FF" },
    { clock: "12:34:57", knob: "2", host: "0", hostColor: "#59E2FF" },
    { clock: "12:34:57", knob: "2", host: "7", hostColor: "#FF5F97" },
  ]);
  assert.equal(contactSheet.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  for (const record of manifest.frames) {
    const raw = await readFile(new URL(`build/${record.raw}`, example));
    assert.equal(raw.length, VIEWPORT.width * VIEWPORT.height * 2);
    assert.equal(createHash("sha256").update(raw).digest("hex"), record.rgb565Sha256);
  }
});
