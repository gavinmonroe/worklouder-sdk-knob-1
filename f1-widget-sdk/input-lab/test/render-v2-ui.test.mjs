import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { BrowserKeyRpcBridge, isEditableKeyboardTarget,
  normalizeKeyboardRpcConfig } from "../lib/browser-key-rpc.mjs";
import { BrowserKeyRpcDelivery } from "../lib/browser-key-rpc-delivery.mjs";
import { appendRenderV2PreviewEvent, createRenderV2ApiSource, createRenderV2PreviewEvent,
  decodeRenderV2Frame, INPUT_LAB_RENDER_V2_MAX_EVENTS, parseRenderV2HostRpcId,
  renderV2FrameToRgba } from "../lib/render-v2-browser.mjs";
import { RenderV2OperationGate } from "../lib/render-v2-operations.mjs";

const root = path.resolve(import.meta.dirname, "..");

class FakeTarget {
  constructor(tagName = "DIV") { this.tagName = tagName; this.dataset = {}; this.listeners = new Map(); }
  addEventListener(name, listener) { this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]); }
  removeEventListener(name, listener) {
    this.listeners.set(name, (this.listeners.get(name) ?? []).filter((value) => value !== listener));
  }
  dispatch(name, event = {}) { for (const listener of this.listeners.get(name) ?? []) listener(event); }
}

function keyEvent(code, extra = {}) {
  return { code, target: { tagName: "DIV", isContentEditable: false }, preventDefault() { this.prevented = true; },
    ...extra };
}

test("Render v2 browser events are canonical, int32-bounded, and replay-capped", () => {
  assert.equal(parseRenderV2HostRpcId("0xB201"), 0xb201);
  assert.equal(parseRenderV2HostRpcId("45569"), 45569);
  assert.throws(() => parseRenderV2HostRpcId("0x10000"), /1\.\.65535/u);
  assert.deepEqual(createRenderV2PreviewEvent({ kind: "input.fn-bottom-knob", value: -2, sequence: 1 }),
    { kind: "input.fn-bottom-knob", flags: 1, id: 1, value: -2, sequence: 1 });
  assert.deepEqual(createRenderV2PreviewEvent({ kind: "host.rpc", id: 0xb201, value: 7, sequence: 2 }),
    { kind: "host.rpc", flags: 0, id: 0xb201, value: 7, sequence: 2 });
  let events = Object.freeze([]);
  for (let index = 0; index < INPUT_LAB_RENDER_V2_MAX_EVENTS; index += 1) events = appendRenderV2PreviewEvent(events,
    createRenderV2PreviewEvent({ kind: "tick.100ms", sequence: index + 1 }));
  assert.throws(() => appendRenderV2PreviewEvent(events,
    createRenderV2PreviewEvent({ kind: "tick.1s", sequence: 65 })), /reset/u);
  const source = createRenderV2ApiSource({ html: "h", css: "c", script: "s", mode: "raster" }, events);
  assert.equal(source.events.length, 64);
  assert.equal(source.renderMode, "raster");
  assert.throws(() => createRenderV2ApiSource({ html: "h", css: "c", script: "s", mode: "dynamic" }),
    /mode must be/u);
});

test("Render v2 RGB565 preview decodes the exact native 100x310 frame", () => {
  const frame = Buffer.alloc(62_000);
  frame.writeUInt16LE(0xf800, 0);
  frame.writeUInt16LE(0x07e0, 2);
  frame.writeUInt16LE(0x001f, 4);
  const base64 = frame.toString("base64");
  assert.equal(decodeRenderV2Frame(base64).length, 62_000);
  assert.deepEqual(Array.from(renderV2FrameToRgba(base64).subarray(0, 12)),
    [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]);
  assert.throws(() => decodeRenderV2Frame(Buffer.alloc(2).toString("base64")), /62000/u);
});

test("focused browser key bridge serializes down/up as host RPC levels and synthesizes release", async () => {
  const pad = new FakeTarget();
  const documentTarget = new FakeTarget();
  documentTarget.visibilityState = "visible";
  const windowTarget = new FakeTarget();
  const events = [];
  const bridge = new BrowserKeyRpcBridge({ element: pad, documentTarget, windowTarget,
    getConfig: () => ({ code: "Space", rpcId: "0xB201" }),
    onEvent: async (event) => { await Promise.resolve(); events.push(event); } });
  assert.equal(bridge.handleKeyDown(keyEvent("KeyA")), false);
  assert.equal(bridge.handleKeyDown(keyEvent("Space", { repeat: true })), false);
  assert.equal(bridge.handleKeyDown(keyEvent("Space", { isComposing: true })), false);
  assert.equal(bridge.handleKeyDown(keyEvent("Space")), true);
  assert.equal(bridge.handleKeyUp(keyEvent("Space")), true);
  await bridge.tail;
  assert.deepEqual(events.map(({ id, value, phase, synthetic }) => ({ id, value, phase, synthetic })), [
    { id: 0xb201, value: 1, phase: "down", synthetic: false },
    { id: 0xb201, value: 0, phase: "up", synthetic: false },
  ]);
  bridge.handleKeyDown(keyEvent("Space"));
  pad.dispatch("blur");
  await bridge.tail;
  assert.deepEqual(events.slice(-2).map(({ value, reason, synthetic }) => ({ value, reason, synthetic })), [
    { value: 1, reason: "keydown", synthetic: false },
    { value: 0, reason: "blur", synthetic: true },
  ]);
  bridge.handleKeyDown(keyEvent("Space"));
  windowTarget.dispatch("blur");
  await bridge.tail;
  assert.deepEqual(events.slice(-2).map(({ value, reason, synthetic }) => ({ value, reason, synthetic })), [
    { value: 1, reason: "keydown", synthetic: false },
    { value: 0, reason: "window-blur", synthetic: true },
  ]);
  await bridge.destroy();
});

test("a forwarded key-down receives exactly one device zero when source invalidation precedes window blur", async () => {
  const calls = [];
  const client = { async sendRenderV2HostEvent(id, value) { calls.push({ id, value }); } };
  let sourceRevision = 1;
  const delivery = new BrowserKeyRpcDelivery({
    getTarget: () => ({ client, capability: { committedGeneration: 4 } }),
    async dispatchPreview(payload) {
      if (sourceRevision !== 1) throw Object.assign(new Error("stale preview"),
        { code: "RENDER_V2_STALE_OPERATION" });
      return { forwarded: payload.value === 1 };
    },
  });
  const pad = new FakeTarget();
  const documentTarget = new FakeTarget();
  documentTarget.visibilityState = "visible";
  const windowTarget = new FakeTarget();
  const deliveries = [];
  const bridge = new BrowserKeyRpcBridge({ element: pad, documentTarget, windowTarget,
    getConfig: () => ({ code: "Space", rpcId: "0xB201" }),
    onEvent: async (payload) => { deliveries.push(await delivery.deliver(payload)); } });
  bridge.handleKeyDown(keyEvent("Space"));
  await bridge.tail;
  sourceRevision += 1;
  windowTarget.dispatch("blur");
  await bridge.tail;
  const released = deliveries.at(-1);
  assert.equal(released.cleanupFallback, true);
  assert.equal(released.previewError.code, "RENDER_V2_STALE_OPERATION");
  assert.deepEqual(calls, [{ id: 0xb201, value: 0 }]);
  windowTarget.dispatch("blur");
  await bridge.tail;
  assert.equal(calls.length, 1, "cleanup is single-shot after the active level is cleared");
  await bridge.destroy();
});

test("a post-ACK stale key-down still records the exact device session for zero cleanup", async () => {
  const calls = [];
  let acknowledgeDown;
  let signalDown;
  const downAcknowledged = new Promise((resolve) => { acknowledgeDown = resolve; });
  const downStarted = new Promise((resolve) => { signalDown = resolve; });
  const capability = Object.freeze({ committedGeneration: 9,
    renderV2Profile: "framer-f1-render-v2-structural-v1" });
  const client = { async sendRenderV2HostEvent(id, value) {
    calls.push({ id, value });
    if (value === 1) { signalDown(); await downAcknowledged; }
  } };
  let stale = false;
  const delivery = new BrowserKeyRpcDelivery({
    getTarget: () => ({ client, capability }),
    async dispatchPreview(payload) {
      if (stale && payload.value === 0) throw Object.assign(new Error("stale before release forwarding"),
        { code: "RENDER_V2_STALE_OPERATION" });
      await client.sendRenderV2HostEvent(payload.id, payload.value);
      if (stale) throw Object.assign(new Error("stale after device ACK"),
        { code: "RENDER_V2_STALE_OPERATION" });
      return { forwarded: true };
    },
  });
  const down = delivery.deliver({ id: 0xb201, value: 1 });
  await downStarted;
  stale = true;
  acknowledgeDown();
  await assert.rejects(down, { code: "RENDER_V2_STALE_OPERATION" });
  const released = await delivery.deliver({ id: 0xb201, value: 0 });
  assert.equal(released.cleanupFallback, true);
  assert.equal(released.previewError.code, "RENDER_V2_STALE_OPERATION");
  assert.deepEqual(calls, [{ id: 0xb201, value: 1 }, { id: 0xb201, value: 0 }]);
});

test("Render v2 operation gate serializes work and rejects deferred stale results", async () => {
  let releaseFirst;
  const firstDeferred = new Promise((resolve) => { releaseFirst = resolve; });
  const busy = [];
  const invoked = [];
  const gate = new RenderV2OperationGate({ onBusyChange: (value) => busy.push(value) });
  const first = gate.run("compile", async () => { invoked.push("compile"); await firstDeferred; return "old"; });
  const second = gate.run("simulate", async () => { invoked.push("simulate"); return "never"; });
  const firstRejected = assert.rejects(first, { code: "RENDER_V2_STALE_OPERATION" });
  const secondRejected = assert.rejects(second, { code: "RENDER_V2_STALE_OPERATION" });
  await Promise.resolve();
  gate.invalidate("source changed");
  releaseFirst();
  await Promise.all([firstRejected, secondRejected, gate.idle()]);
  assert.deepEqual(invoked, ["compile"], "queued stale work must not call the compiler or device");
  assert.deepEqual(busy, [true, false]);

  let active = 0; let maximum = 0;
  const order = [];
  const run = (name) => gate.run(name, async () => {
    active += 1; maximum = Math.max(maximum, active); order.push(`${name}:start`);
    await Promise.resolve(); order.push(`${name}:end`); active -= 1; return name;
  });
  assert.deepEqual(await Promise.all([run("apply"), run("host-rpc")]), ["apply", "host-rpc"]);
  assert.equal(maximum, 1);
  assert.deepEqual(order, ["apply:start", "apply:end", "host-rpc:start", "host-rpc:end"]);
});

test("keyboard bridge configuration is bounded and editable event targets are ignored", () => {
  assert.deepEqual(normalizeKeyboardRpcConfig({ code: "KeyK", rpcId: "0xB201" }),
    { code: "KeyK", rpcId: 0xb201 });
  assert.throws(() => normalizeKeyboardRpcConfig({ code: " ", rpcId: 1 }), /KeyboardEvent\.code/u);
  assert.equal(isEditableKeyboardTarget({ tagName: "INPUT" }), true);
  assert.equal(isEditableKeyboardTarget({ tagName: "DIV", isContentEditable: true }), true);
  assert.equal(isEditableKeyboardTarget({ tagName: "DIV" }), false);
});

test("Input Lab exposes bounded V2 authoring, preview events, active ID26 Push, and honest key RPC copy", async () => {
  const [html, app] = await Promise.all([
    readFile(path.join(root, "index.html"), "utf8"),
    readFile(path.join(root, "app.mjs"), "utf8"),
  ]);
  for (const id of ["renderer-version", "js-source", "render-v2-controls", "v2-tick-100", "v2-tick-1s",
    "v2-knob-down", "v2-knob-up", "v2-host-send", "v2-key-pad", "v2-key-code", "v2-key-rpc-id"])
    assert.match(html, new RegExp(`id="${id}"`, "u"));
  assert.match(html, /parsed, never executed as arbitrary JavaScript or jsdom/u);
  assert.match(html, /browser key-to-host-RPC bridge, not a native/u);
  assert.match(app, /request\("\/api\/render-v2\/compile"/u);
  assert.match(app, /request\("\/api\/render-v2\/simulate"/u);
  assert.match(app, /pushRenderV2Package/u);
  assert.match(app, /active widget → ID26/u);
  assert.match(app, /sendRenderV2HostEvent/u);
  assert.doesNotMatch(app, /kind:\s*"input\.key"/u);
});
