import assert from "node:assert/strict";
import test from "node:test";

import {
  compileRenderV2Program,
  encodeRenderV2Event,
  executeRenderV2Instructions,
  parseRenderV2Script,
  RENDER_V2_EVENT_FIELDS,
  RENDER_V2_OPCODES,
  RenderV2CompileError,
} from "../src/render-v2/index.mjs";
import {
  compileRendererV2Program,
  RENDERER_V2_OPCODE,
} from "../../custom-firmware/lib/renderer-v2-event-vm.mjs";

const TIMER_SOURCE = `var remainingSeconds=900;
widget.on("input.fn-bottom-knob", function(event){
  remainingSeconds += event.delta * 300;
  remainingSeconds = clamp(remainingSeconds, 300, 5700);
});`;

test("scaled event addition parses to one bounded opcode and clamps timer detents exactly", () => {
  const parsed = parseRenderV2Script(TIMER_SOURCE);
  assert.deepEqual(parsed.handlers[0].instructions, [
    { opcode: RENDER_V2_OPCODES.ADD_EVENT_SCALED, dstState: 0,
      eventField: RENDER_V2_EVENT_FIELDS.value, imm: 300 },
    { opcode: RENDER_V2_OPCODES.CLAMP_MIN, dstState: 0, eventField: 0, imm: 300 },
    { opcode: RENDER_V2_OPCODES.CLAMP_MAX, dstState: 0, eventField: 0, imm: 5700 },
    { opcode: RENDER_V2_OPCODES.HALT, dstState: 0, eventField: 0, imm: 0 },
  ]);
  const state = new Int32Array(16); state[0] = 900;
  executeRenderV2Instructions({ instructions: parsed.handlers[0].instructions, state,
    event: encodeRenderV2Event({ kind: "input.fn-bottom-knob", flags: 1, id: 1, value: 2 }) });
  assert.equal(state[0], 1500);
  executeRenderV2Instructions({ instructions: parsed.handlers[0].instructions, state,
    event: encodeRenderV2Event({ kind: "input.fn-bottom-knob", flags: 1, id: 1, value: -128 }) });
  assert.equal(state[0], 300);
  executeRenderV2Instructions({ instructions: parsed.handlers[0].instructions, state,
    event: encodeRenderV2Event({ kind: "input.fn-bottom-knob", flags: 1, id: 1, value: 127 }) });
  assert.equal(state[0], 5700);
});

test("scaled event addition is byte-identical across both encoders with defined int32 wrap", () => {
  const spec = {
    state: { remainingSeconds: 900 },
    handlers: [{ event: "fnBottomKnob", instructions: [
      { op: "addEventScaled", state: "remainingSeconds", field: "value", imm: 300 },
      { op: "clampMin", state: "remainingSeconds", imm: 300 },
      { op: "clampMax", state: "remainingSeconds", imm: 5700 },
    ] }],
    patchSets: { timer: [[{ pixelOffset: 0, colors: [0] }]] },
    bindings: [{ state: "remainingSeconds", patchSet: "timer", divisor: 300, modulo: 1 }],
  };
  const sdk = compileRenderV2Program(spec); const firmware = compileRendererV2Program(spec);
  assert.equal(RENDERER_V2_OPCODE.addEventScaled, RENDER_V2_OPCODES.ADD_EVENT_SCALED);
  assert.deepEqual(sdk.binary, firmware.binary);

  const executeExtreme = ({ initial = 0, imm, value }) => {
    const state = new Int32Array(16); state[0] = initial;
    executeRenderV2Instructions({ instructions: [
      { opcode: RENDER_V2_OPCODES.ADD_EVENT_SCALED, dstState: 0,
        eventField: RENDER_V2_EVENT_FIELDS.value, imm },
      { opcode: RENDER_V2_OPCODES.HALT, dstState: 0, eventField: 0, imm: 0 },
    ], state, event: encodeRenderV2Event({ kind: "host.rpc", id: 1, value }) });
    return state[0];
  };
  assert.equal(executeExtreme({ imm: 0x7fffffff, value: 2 }), -2,
    "INT32_MAX positive scale wraps its product before addition");
  assert.equal(executeExtreme({ imm: -0x80000000, value: 1 }), -0x80000000,
    "INT32_MIN negative scale remains the exact signed product");
  assert.equal(executeExtreme({ initial: -1, imm: -0x80000000, value: 1 }), 0x7fffffff,
    "adding an INT32_MIN scaled product wraps at the signed floor");

  for (const imm of [0x7fffffff, -0x80000000]) {
    const extremeSpec = { ...spec, handlers: [{ event: "fnBottomKnob", instructions: [
      { op: "addEventScaled", state: "remainingSeconds", field: "value", imm },
    ] }] };
    assert.deepEqual(compileRenderV2Program(extremeSpec).binary,
      compileRendererV2Program(extremeSpec).binary);
  }
});

test("scaled event syntax fails closed outside its exact bounded shape", () => {
  assert.throws(() => parseRenderV2Script(TIMER_SOURCE.replace("* 300", "* 0")),
    RenderV2CompileError);
  assert.throws(() => parseRenderV2Script(TIMER_SOURCE.replace("event.delta * 300", "300 * event.delta")),
    RenderV2CompileError);
  assert.throws(() => compileRenderV2Program({
    state: { x: 0 }, handlers: [{ event: "fnBottomKnob",
      instructions: [{ op: "addEventScaled", state: "x", field: "value", imm: 0 }] }],
    patchSets: { x: [[{ pixelOffset: 0, colors: [0] }]] },
    bindings: [{ state: "x", patchSet: "x" }],
  }), /nonzero scale/u);
});
