import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  RENDERER_V2_EVENT_FIELD,
  RENDERER_V2_EVENT_KIND,
  RENDERER_V2_LIMITS,
  RENDERER_V2_OPCODE,
  RendererV2EventRuntime,
  compileRendererV2Program,
  decodeRendererV2Event,
  encodeRendererV2Event,
} from "../lib/renderer-v2-event-vm.mjs";

const DIGITS = Object.freeze([
  ["111", "101", "101", "101", "111"],
  ["010", "110", "010", "010", "111"],
  ["111", "001", "111", "100", "111"],
  ["111", "001", "111", "001", "111"],
  ["101", "101", "111", "001", "001"],
  ["111", "100", "111", "001", "111"],
  ["111", "100", "111", "101", "111"],
  ["111", "001", "010", "010", "010"],
  ["111", "101", "111", "101", "111"],
  ["111", "101", "111", "001", "111"],
]);

function digitVariants() {
  return DIGITS.map((rows) => rows.map((row, index) => ({
    pixelOffset: index * 100,
    colors: [...row].map((pixel) => pixel === "1" ? 0xffff : 0x0000),
  })));
}

function referenceSpec() {
  return {
    state: { tenths: 0, secondsOfDay: 12 * 3600 + 34 * 60 + 58, theme: 0, hostStatus: 0 },
    handlers: [
      { event: "tick100ms", instructions: [
        { op: "add", state: "tenths", imm: 1 },
        { op: "modPositive", state: "tenths", imm: 10 },
      ] },
      { event: "tick1s", instructions: [
        { op: "add", state: "secondsOfDay", imm: 1 },
        { op: "modPositive", state: "secondsOfDay", imm: 86_400 },
      ] },
      { event: "fnBottomKnob", instructions: [
        { op: "addEvent", state: "theme", field: "value" },
        { op: "modPositive", state: "theme", imm: 3 },
      ] },
      { event: "hostRpc", rpcEventId: 0x1201, instructions: [
        { op: "loadEvent", state: "hostStatus", field: "value" },
        { op: "clampMin", state: "hostStatus", imm: 0 },
        { op: "clampMax", state: "hostStatus", imm: 3 },
      ] },
    ],
    patchSets: {
      digit: digitVariants(),
      theme: [0x001f, 0x07e0, 0xf800].map((color) => [{ pixelOffset: 0, colors: [color, color, color, color] }]),
      hostStatus: [0x0000, 0x39e7, 0xffe0, 0xf81f].map((color) => [{ pixelOffset: 0, colors: [color] }]),
      tenths: Array.from({ length: 10 }, (_, value) => [{ pixelOffset: 0, colors: [value + 1] }]),
    },
    bindings: [
      { state: "theme", divisor: 1, modulo: 3, patchSet: "theme", originPixel: 0 },
      { state: "hostStatus", divisor: 1, modulo: 4, patchSet: "hostStatus", originPixel: 10 },
      { state: "tenths", divisor: 1, modulo: 10, patchSet: "tenths", originPixel: 12 },
      ...[36000, 3600, 600, 60, 10, 1].map((divisor, index) => ({
        state: "secondsOfDay", divisor, modulo: [3, 10, 6, 10, 6, 10][index], patchSet: "digit",
        originPixel: 10 * 100 + [5, 10, 18, 23, 31, 36][index],
      })),
    ],
  };
}

function runtimeFor(program = compileRendererV2Program(referenceSpec())) {
  const framebuffer = Buffer.alloc(RENDERER_V2_LIMITS.framebufferBytes, 0xa5);
  const runtime = new RendererV2EventRuntime(program, {
    framebuffer,
    renderV1Frame(target) { target.fill(0); return true; },
  });
  return { program, runtime, framebuffer };
}

function sha(value) { return createHash("sha256").update(value).digest("hex"); }

test("renderer-v2 publishes fixed event/instruction and deterministic F2EP program records", () => {
  const event = encodeRendererV2Event({ kind: "fnBottomKnob", flags: 1, id: 1, value: -2, sequence: 9 });
  assert.equal(event.length, 16);
  assert.deepEqual([...event], [3, 1, 1, 0, 254, 255, 255, 255, 9, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(decodeRendererV2Event(event), {
    kind: RENDERER_V2_EVENT_KIND.fnBottomKnob, event: "fnBottomKnob", flags: 1, id: 1, value: -2, sequence: 9,
  });
  assert.deepEqual(RENDERER_V2_OPCODE, { halt: 0, set: 1, add: 2, loadEvent: 3,
    addEvent: 4, modPositive: 5, clampMin: 6, clampMax: 7, addEventScaled: 8 });
  assert.deepEqual(RENDERER_V2_EVENT_FIELD, { none: 0, value: 1, id: 2, sequence: 3, flags: 4 });

  const first = compileRendererV2Program(referenceSpec());
  const second = compileRendererV2Program(referenceSpec());
  assert.equal(first.sha256, "495aad45e83fb285c568700ca5a4bf5fd1051f5ecb79a42606f3ea1b8735b4dc");
  assert.equal(first.binary.length, 1512);
  assert.ok(first.binary.equals(second.binary));
  assert.equal(first.sha256, second.sha256);
  assert.equal(first.binary.subarray(0, 4).toString("ascii"), "F2EP");
  assert.equal(first.binary[4], 1);
  assert.equal(first.binary.readUInt32LE(12), first.binary.length);
  assert.equal(first.manifest.framebuffer.bytes, 62_000);
  assert.equal(first.manifest.framebuffer.extraFramebufferBytes, 0);
  assert.ok(first.manifest.patches.spans <= RENDERER_V2_LIMITS.patchSpans);
  assert.ok(first.manifest.patches.pixelBytes <= RENDERER_V2_LIMITS.patchBytes);
});

test("100-ms UI ticks derive a one-second clock and paint six reusable digit glyph patches in v1 memory", () => {
  const { runtime, framebuffer } = runtimeFor();
  assert.strictEqual(runtime.framebuffer, framebuffer);
  for (let tick = 0; tick < 9; tick += 1) {
    const result = runtime.tick100ms();
    assert.equal(result.secondTick, false);
  }
  const tenth = runtime.tick100ms();
  assert.equal(tenth.secondTick, true);
  assert.equal(runtime.state.secondsOfDay, 12 * 3600 + 34 * 60 + 59);
  assert.equal(runtime.state.tenths, 0);
  assert.equal(framebuffer.readUInt16LE(12 * 2), 1);
  // Final clock digit is 9: its lower-left pixel is foreground.
  assert.equal(framebuffer.readUInt16LE(((10 + 4) * 100 + 36) * 2), 0xffff);
  assert.equal(runtime.frameGeneration, 10);
  assert.equal(runtime.descriptorIdentity, 0);
});

test("Fn+bottom knob and fixed-ID host RPC events update state on the next UI tick", () => {
  const { runtime, framebuffer } = runtimeFor();
  assert.equal(runtime.enqueueFnBottomKnob({ encoderId: 0, delta: 1, fnPressed: true }), false);
  assert.equal(runtime.enqueueFnBottomKnob({ encoderId: 1, delta: 1, fnPressed: false }), false);
  assert.equal(runtime.enqueueFnBottomKnob({ encoderId: 1, delta: 0xff, fnPressed: true }), true);
  assert.equal(runtime.enqueueHostRpc({ rpcEventId: 0x9999, value: 2 }), false);
  assert.equal(runtime.enqueueHostRpc({ rpcEventId: 0x1201, value: 99 }), true);
  assert.deepEqual(runtime.state, { tenths: 0, secondsOfDay: 45_298, theme: 0, hostStatus: 0 });
  const result = runtime.tick100ms();
  assert.equal(result.drainedEvents, 2);
  assert.deepEqual(runtime.state, { tenths: 1, secondsOfDay: 45_298, theme: 2, hostStatus: 3 });
  assert.equal(framebuffer.readUInt16LE(0), 0xf800);
  assert.equal(framebuffer.readUInt16LE(10 * 2), 0xf81f);
});

test("bounded FIFO rejects its ninth pending callback without unbounded allocation", () => {
  const { runtime } = runtimeFor();
  for (let index = 0; index < RENDERER_V2_LIMITS.eventQueueRecords; index += 1) {
    assert.equal(runtime.enqueueHostRpc({ rpcEventId: 0x1201, value: index }), true);
  }
  assert.equal(runtime.queuedEvents, 8);
  assert.equal(runtime.enqueueHostRpc({ rpcEventId: 0x1201, value: 3 }), false);
  assert.equal(runtime.tick100ms().drainedEvents, 8);
  assert.equal(runtime.state.hostStatus, 3);
});

test("a rejected full-queue event does not consume an observable sequence number", () => {
  const spec = referenceSpec();
  spec.handlers[3].instructions = [
    { op: "loadEvent", state: "hostStatus", field: "sequence" },
  ];
  const { runtime } = runtimeFor(compileRendererV2Program(spec));
  for (let index = 0; index < RENDERER_V2_LIMITS.eventQueueRecords; index += 1) {
    assert.equal(runtime.enqueueHostRpc({ rpcEventId: 0x1201, value: index }), true);
  }
  assert.equal(runtime.enqueueHostRpc({ rpcEventId: 0x1201, value: 99 }), false);
  assert.equal(runtime.tick100ms().drainedEvents, 8);
  assert.equal(runtime.state.hostStatus, 8);
  assert.equal(runtime.enqueueHostRpc({ rpcEventId: 0x1201, value: 7 }), true);
  assert.equal(runtime.tick100ms().drainedEvents, 1);
  assert.equal(runtime.state.hostStatus, 10);
});

test("identical base/event traces yield identical framebuffer digest sequences", () => {
  const run = () => {
    const { runtime, framebuffer } = runtimeFor();
    const digests = [];
    runtime.tick100ms();
    digests.push(sha(framebuffer));
    runtime.enqueueFnBottomKnob({ encoderId: 1, delta: 1, fnPressed: true });
    runtime.tick100ms();
    digests.push(sha(framebuffer));
    runtime.enqueueHostRpc({ rpcEventId: 0x1201, value: 2 });
    for (let tick = 0; tick < 8; tick += 1) runtime.tick100ms();
    digests.push(sha(framebuffer));
    return digests;
  };
  const first = run();
  assert.deepEqual(first, [
    "632b78870e9e77403a6d8f716cbeabdbff0c5dfdbf7b9912eaf78b6013393c38",
    "25a740198d86e2c93f7c84666b78562a09959a12f62b2504d871b81a6b670f20",
    "f2de9ad1a341c9c8c3ac66db2d4f126759859d9a2145454d76a4b325a5344c6e",
  ]);
  assert.deepEqual(first, run());
  assert.equal(new Set(first).size, 3);
});

test("compiler rejects state, instruction, patch, and framebuffer bound violations", () => {
  assert.throws(() => compileRendererV2Program({ ...referenceSpec(),
    state: Object.fromEntries(Array.from({ length: 17 }, (_, index) => [`s${index}`, 0])) }), /1\.\.16 slots/u);
  const tooMany = referenceSpec();
  tooMany.handlers[0].instructions = Array.from({ length: 64 }, () => ({ op: "add", state: "tenths", imm: 1 }));
  assert.throws(() => compileRendererV2Program(tooMany), /1\.\.63 source instructions/u);
  const badPatch = referenceSpec();
  badPatch.patchSets.theme[0] = [{ pixelOffset: 31_000, colors: [1] }];
  assert.throws(() => compileRendererV2Program(badPatch), /exceed the framebuffer/u);
  const program = compileRendererV2Program(referenceSpec());
  assert.throws(() => new RendererV2EventRuntime(program, { framebuffer: Buffer.alloc(100), renderV1Frame() {} }),
    /62000-byte v1 framebuffer/u);
});

test("v1 base-render failure is fail-black and does not publish a descriptor flip", () => {
  const program = compileRendererV2Program(referenceSpec());
  const framebuffer = Buffer.alloc(62_000, 0xff);
  const runtime = new RendererV2EventRuntime(program, { framebuffer, renderV1Frame() { throw new Error("base"); } });
  const result = runtime.tick100ms();
  assert.equal(result.rendered, false);
  assert.ok(framebuffer.every((byte) => byte === 0));
  assert.equal(runtime.frameGeneration, 0);
});
