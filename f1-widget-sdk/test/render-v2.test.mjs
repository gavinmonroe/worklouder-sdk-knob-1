import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createRenderV2Runtime,
  decodeRenderV2Lzss,
  encodeRenderV2Lzss,
  encodeRenderV2Event,
  linkRenderV2,
  parseRenderV2Script,
  prepareRenderV2,
  RENDER_V2_ABI_LIMITS,
  RENDER_V2_LZSS,
  RenderV2CompileError,
} from "../src/render-v2/index.mjs";
import { createDeterministicTestGlyphAtlas, renderCssSceneRgb565 } from "../src/render/index.mjs";
import {
  compileRendererV2Program,
  encodeRendererV2Event,
  RENDERER_V2_LIMITS,
  RendererV2EventRuntime,
} from "../../custom-firmware/lib/renderer-v2-event-vm.mjs";

const example = new URL("../examples/render-v2-events/", import.meta.url);
const HOST_RPC_ID = 0xb201;

async function compileFixture() {
  const [html, css, script] = await Promise.all([
    readFile(new URL("widget.html", example), "utf8"),
    readFile(new URL("widget.css", example), "utf8"),
    readFile(new URL("widget.js", example), "utf8"),
  ]);
  const prepared = prepareRenderV2({ html, css, script });
  const atlas = createDeterministicTestGlyphAtlas(prepared.scene.glyphs, { width: 8, height: 12 });
  const linked = linkRenderV2(prepared, { atlas });
  const firmwareProgram = compileRendererV2Program(linked.spec);
  return { html, css, script, prepared, atlas, linked, firmwareProgram };
}

function frameBytes(frame) {
  const output = Buffer.alloc(frame.length * 2);
  frame.forEach((color, index) => output.writeUInt16LE(color, index * 2));
  return output;
}

function parse565(value) {
  const digits = value.slice(1); const r = Number.parseInt(digits.slice(0, 2), 16);
  const g = Number.parseInt(digits.slice(2, 4), 16); const b = Number.parseInt(digits.slice(4, 6), 16);
  return ((r >>> 3) << 11) | ((g >>> 2) << 5) | (b >>> 3);
}

function exactExpectedFrame(prepared, atlas, { secondsOfDay, knobVariant, hostValue }) {
  const targets = Object.fromEntries(prepared.runs.filter(({ id }) => id).map((run) => [run.id, run]));
  const time = [Math.floor(secondsOfDay / 3600), Math.floor(secondsOfDay / 60) % 60, secondsOfDay % 60]
    .map((value) => String(value).padStart(2, "0")).join(":");
  const text = { clock: time, knob: String(knobVariant + 1), host: String(hostValue) };
  const hostColors = ["#59E2FF", "#42DCE1", "#5BE89E", "#8FE16C", "#D3D54E",
    "#FFB74D", "#FF875B", "#FF5F97", "#DE5BE2", "#BB6AFF"];
  const glyphIds = new Map(prepared.scene.glyphs.map((glyph, index) => [glyph, index]));
  const cells = prepared.scene.cells.map((cell) => ({ ...cell }));
  for (const [id, value] of Object.entries(text)) targets[id].cellIndices.forEach((cellIndex, index) => {
    cells[cellIndex].glyphId = glyphIds.get(Array.from(value)[index]);
    if (id === "host") cells[cellIndex].color565 = parse565(hostColors[hostValue]);
  });
  return frameBytes(renderCssSceneRgb565({ ...prepared.scene, cells }, atlas, 0));
}

test("Render v2 parses the shipped ES5 DOM source and compiles exact bounded F2EP bytecode", async () => {
  const { script, prepared, linked, firmwareProgram } = await compileFixture();
  const parsed = parseRenderV2Script(script);
  assert.deepEqual(parsed.states.map(({ name }) => name), ["secondsOfDay", "knobVariant", "hostValue"]);
  assert.deepEqual(parsed.handlers.map(({ name }) => name),
    ["tick.1s", "input.fn-bottom-knob", "host.rpc:0xB201"]);
  assert.equal(linked.budget.states, 3);
  assert.equal(linked.budget.handlers, 3);
  assert.equal(linked.budget.bindings, 8);
  assert.equal(linked.budget.patchSets, 3);
  assert.ok(linked.budget.spans <= RENDERER_V2_LIMITS.patchSpans);
  assert.ok(linked.budget.pixelBytes <= RENDERER_V2_LIMITS.patchBytes);
  assert.equal(RENDER_V2_ABI_LIMITS.maxPatchSpans, RENDERER_V2_LIMITS.patchSpans);
  assert.deepEqual(linked.program.bytecode,
    Buffer.concat(prepared.script.handlers.map(({ instructionBinary }) => instructionBinary)));
  assert.equal(linked.program.sha256, firmwareProgram.sha256);
  assert.deepEqual(linked.program.binary, firmwareProgram.binary);
  const second = linkRenderV2(prepared, { atlas: linked.atlas });
  assert.equal(second.program.sha256, linked.program.sha256);
  assert.deepEqual(second.program.binary, linked.program.binary);
});

test("Render v2 event records match firmware and all three events produce pixel-exact full frames", async () => {
  const { prepared, atlas, linked, firmwareProgram } = await compileFixture();
  const events = [
    [{ kind: "tick.1s", value: 1, sequence: 1 }, { kind: "tick1s", value: 1, sequence: 1 }],
    [{ kind: "input.fn-bottom-knob", flags: 1, id: 1, value: 1, sequence: 2 },
      { kind: "fnBottomKnob", flags: 1, id: 1, value: 1, sequence: 2 }],
    [{ kind: "host.rpc", id: HOST_RPC_ID, value: 7, sequence: 3 },
      { kind: "hostRpc", id: HOST_RPC_ID, value: 7, sequence: 3 }],
  ];
  events.forEach(([sdk, firmware]) => assert.deepEqual(encodeRenderV2Event(sdk), encodeRendererV2Event(firmware)));
  const patchSet = linked.spec.patchSets[Object.keys(linked.spec.patchSets)[0]];
  assert.throws(() => { patchSet[0][0].colors[0] = 0; }, TypeError,
    "linked patch colors must be immutable after the program SHA is computed");
  assert.throws(() => { linked.script.handlers[0].instructions[0].imm = 99; }, TypeError,
    "host runtime instructions must be immutable after F2EP compilation");
  const leakedBase = linked.baseFrame;
  leakedBase.fill(0);
  assert.notDeepEqual(linked.baseFrame, leakedBase, "baseFrame getter must not expose runtime-owned bytes");
  const runtime = createRenderV2Runtime(linked);
  assert.throws(() => runtime.dispatch({ kind: "tick.1s", flags: 2 }), /Fn bit zero/u);
  assert.throws(() => runtime.dispatch({ kind: "tick.1s", value: Number.POSITIVE_INFINITY }), /int32/u);
  let result = runtime.dispatch(encodeRenderV2Event(events[0][0]));
  assert.equal(result.state.secondsOfDay, 45297);
  assert.deepEqual(result.frame, exactExpectedFrame(prepared, atlas,
    { secondsOfDay: 45297, knobVariant: 0, hostValue: 0 }));
  result = runtime.dispatch({ kind: "input.fn-bottom-knob", flags: 1, value: 1 });
  assert.equal(result.state.knobVariant, 0, "missing encoder id must not match the firmware's bottom encoder");
  result = runtime.dispatch({ kind: "input.fn-bottom-knob", flags: 1, id: 2, value: 1 });
  assert.equal(result.state.knobVariant, 0, "a non-bottom encoder must not match");
  result = runtime.dispatch(encodeRenderV2Event(events[1][0]));
  assert.equal(result.state.knobVariant, 1);
  assert.deepEqual(result.frame, exactExpectedFrame(prepared, atlas,
    { secondsOfDay: 45297, knobVariant: 1, hostValue: 0 }));
  result = runtime.dispatch(encodeRenderV2Event(events[2][0]));
  assert.equal(result.state.hostValue, 7);
  assert.deepEqual(result.frame, exactExpectedFrame(prepared, atlas,
    { secondsOfDay: 45297, knobVariant: 1, hostValue: 7 }));
  assert.ok(result.changedPixels > 0);
});

test("the exact F2EP program executes the same clock, Fn+bottom-knob, and fixed-ID RPC on the firmware model", async () => {
  const { prepared, atlas, linked, firmwareProgram } = await compileFixture();
  const framebuffer = Buffer.alloc(62_000);
  const runtime = new RendererV2EventRuntime(firmwareProgram, { framebuffer,
    renderV1Frame(target) { linked.baseFrame.copy(target); return true; } });
  for (let index = 0; index < 10; index += 1) assert.equal(runtime.tick100ms().rendered, true);
  assert.equal(runtime.state.secondsOfDay, 45297);
  assert.equal(runtime.enqueueFnBottomKnob({ encoderId: 1, delta: 1, fnPressed: true }), true);
  runtime.tick100ms();
  assert.equal(runtime.state.knobVariant, 1);
  assert.equal(runtime.enqueueHostRpc({ rpcEventId: HOST_RPC_ID, value: 7 }), true);
  runtime.tick100ms();
  assert.equal(runtime.state.hostValue, 7);
  assert.deepEqual(framebuffer, exactExpectedFrame(prepared, atlas,
    { secondsOfDay: 45297, knobVariant: 1, hostValue: 7 }));
});

test("Render v2 fails closed on arbitrary JS, unsafe DOM, bad event flags, and unsupported slot switching", async () => {
  assert.throws(() => parseRenderV2Script("var x=0; while (true) { x += 1; }"), RenderV2CompileError);
  assert.throws(() => parseRenderV2Script(
    "var x=0; widget.on(\"tick.1s\", function(event){ fetch(\"https://x\"); });"), RenderV2CompileError);
  assert.throws(() => encodeRenderV2Event({ kind: "tick.1s", flags: 2 }), /Fn bit zero/u);
  assert.throws(() => parseRenderV2Script(
    "var x=0; widget.on(\"tick.1s\", function(event){ document.querySelector(\"#host\").textContent = pick(x, \"0\", \"1\"); x += 1; });"),
  /place DOM assignments last/u);
  assert.throws(() => parseRenderV2Script(
    "var x=0; widget.on(\"tick.1s\", function(event){ document.querySelector(\"#a/*not-comment*/\").textContent = pick(x, \"0\", \"1\"); });"),
  /forbids comments/u);
  const { html, css, script: fixtureScript } = await compileFixture();
  assert.throws(() => prepareRenderV2({ html: html.replace("12:34:56", "00:00:00"), css, script: fixtureScript }),
    /initial text must equal 12:34:56/u);
  assert.throws(() => prepareRenderV2({ html: html.replace('data-glyphs="123">1', 'data-glyphs="123">2'),
    css, script: fixtureScript }), /initial text does not match/u);
  assert.throws(() => prepareRenderV2({ html, css, script: fixtureScript.replace("#59E2FF", "#29D6FF") }),
    /initial CSS color does not match/u);
  const splitActions = `var hostValue=0;
widget.on("tick.1s", function(event){ hostValue += 1; hostValue = mod(hostValue, 10);
document.querySelector("#host").textContent = pick(hostValue, "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"); });
widget.on("host.rpc:0xB201", function(event){ hostValue = event.value; hostValue = mod(hostValue, 10);
document.querySelector("#host").style.color = pick(hostValue, "#59E2FF", "#42DCE1", "#5BE89E", "#8FE16C", "#D3D54E", "#FFB74D", "#FF875B", "#FF5F97", "#DE5BE2", "#BB6AFF"); });`;
  assert.throws(() => prepareRenderV2({ html, css, script: splitActions }), /without every pick-text\+pick-color action/u);
  const script = "var slot=0; widget.on(\"input.fn-bottom-knob\", function(event){ slot += event.delta; widget.activeSlot = slot; document.querySelector(\"#knob\").textContent = pick(slot, \"1\", \"2\", \"3\"); });";
  assert.throws(() => prepareRenderV2({ html, css, script }), /activeSlot.+not implemented/u);
});

test("identical pick bindings may be authored by every handler that mutates their shared state", async () => {
  const { html, css } = await compileFixture();
  const script = `var knobVariant=0;
widget.on("tick.1s", function(event){ knobVariant += 1; knobVariant = mod(knobVariant, 3);
document.querySelector("#knob").textContent = pick(knobVariant, "1", "2", "3"); });
widget.on("input.fn-bottom-knob", function(event){ knobVariant += event.delta; knobVariant = mod(knobVariant, 3);
document.querySelector("#knob").textContent = pick(knobVariant, "1", "2", "3"); });`;
  const prepared = prepareRenderV2({ html, css, script });
  assert.equal(prepared.logicalBindings.length, 1);
  assert.equal(prepared.logicalBindings[0].name, "knob");
  const marker = 'pick(knobVariant, "1", "2", "3")'; const offset = script.lastIndexOf(marker);
  const drift = `${script.slice(0, offset)}pick(knobVariant, "1", "3", "2")${script.slice(offset + marker.length)}`;
  assert.throws(() => prepareRenderV2({ html, css, script: drift }), /different variants/u);
});

test("the bounded renderer-v2 LZSS codec is deterministic, exact, and fails closed", () => {
  const source = Buffer.alloc(62_000);
  for (let index = 0; index < source.length; index += 1) {
    source[index] = index % 173 < 140 ? (index >>> 3) & 0xff : index & 0xff;
  }
  const first = encodeRenderV2Lzss(source); const second = encodeRenderV2Lzss(source);
  assert.deepEqual(first, second);
  assert.deepEqual(decodeRenderV2Lzss(first, source.length), source);
  assert.equal(RENDER_V2_LZSS.codec, "lzss-1k-len3-66-v1");
  assert.equal(RENDER_V2_LZSS.distanceMaximum, 1024);
  assert.equal(RENDER_V2_LZSS.lengthMaximum, 66);
  assert.throws(() => decodeRenderV2Lzss(first.subarray(0, first.length - 1), source.length),
    /overran/u);
  assert.throws(() => decodeRenderV2Lzss(Buffer.concat([first, Buffer.from([0])]), source.length),
    /trailing/u);
  assert.throws(() => decodeRenderV2Lzss(first, -1), /nonnegative integer/u);
});

test("the package renderer-v2 export resolves to the self-contained compiler", async () => {
  const sdk = await import("framer-f1-research-widget-sdk/renderer-v2");
  assert.equal(typeof sdk.prepareRenderV2, "function");
  assert.equal(typeof sdk.compileRenderV2Program, "function");
  assert.equal(typeof sdk.encodeRenderV2Lzss, "function");
  assert.equal(sdk.RENDER_V2_ABI_LIMITS.maxPatchSpans, 512);
});
