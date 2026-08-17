import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createInputLabServer } from "../server.mjs";

const ORIGIN = "https://htmlcss-to-framerf1-widget.g-m.dev";
const proxyHeaders = Object.freeze({ origin: ORIGIN,
  "x-forwarded-host": "htmlcss-to-framerf1-widget.g-m.dev" });
const example = new URL("../../examples/render-v2-events/", import.meta.url);

async function source() {
  const [html, css, script] = await Promise.all(["widget.html", "widget.css", "widget.js"]
    .map((name) => readFile(new URL(name, example), "utf8")));
  return { html, css, script, name: "Input Lab v2" };
}

async function start(context, captureProvider = { capture: async () => { throw new Error("capture not used"); } }) {
  const server = createInputLabServer({ hostedOrigin: ORIGIN,
    captureProvider });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

function deterministicRasterProvider() {
  return { capture: async () => { throw new Error("v1 capture not used"); },
    async captureRenderV2Variants({ cases }) {
      const layout = { elements: [[0, "HTML", "", 2, 0, 0, 6400, 19840, 100, 310, 100, 310]],
        document: [100, 310, 100, 310, 100, 310, 100, 310] };
      return { format: "framer-render-v2-chromium-captures-v1",
        browser: { executable: "/pinned/chrome", product: "Chrome/151.0.7922.138" },
        cases: cases.map(({ name, mutations }) => {
          const frame = Buffer.alloc(62_000);
          if (mutations.some(({ textContent }) => textContent === "1")) frame.writeUInt16LE(0xffff, 42 * 2);
          return { name, mutations, layout, frame };
        }) };
    } };
}

test("hosted Render-v2 API compiles and replays bounded device-identical events", async (context) => {
  const base = await start(context);
  const handshake = await fetch(`${base}/api/bridge`, { headers: proxyHeaders }).then((response) => response.json());
  assert.deepEqual(handshake.renderV2.eventKinds,
    ["tick.100ms", "tick.1s", "input.fn-bottom-knob", "host.rpc"]);
  assert.equal(handshake.renderV2.keyboardKeyEvents, false);
  assert.equal(handshake.renderV2.genericDevicePush, false);
  assert.deepEqual(handshake.renderV2.renderModes, ["auto", "semantic", "raster"]);
  assert.deepEqual(handshake.renderV2.chromiumRaster.exactViewport, { width: 100, height: 310 });
  assert.equal(handshake.renderV2.chromiumRaster.userJavaScriptExecuted, false);
  const headers = { ...proxyHeaders, "content-type": "application/json",
    "x-input-lab-session": handshake.sessionToken };
  const fixture = await source();
  const compiledResponse = await fetch(`${base}/api/render-v2/compile`, {
    method: "POST", headers, body: JSON.stringify(fixture) });
  assert.equal(compiledResponse.status, 200);
  const compiled = await compiledResponse.json();
  assert.equal(compiled.format, "framer-input-lab-render-v2-compilation-v1");
  assert.equal(compiled.mode, "render-v2");
  assert.equal(compiled.renderMode, "semantic");
  assert.equal(compiled.requestedRenderMode, "auto");
  assert.equal(compiled.push.supported, false);
  assert.equal(compiled.push.requiredProfile, "framer-f1-render-v2-structural-v1");
  assert.equal(Buffer.from(compiled.packageBase64, "base64").length, compiled.packageBytes);
  assert.equal(Buffer.from(compiled.frameBase64, "base64").length, 62_000);
  assert.equal(compiled.manifest.execution.deviceRunsJsdom, false);

  const events = [{ kind: "tick.1s", value: 1 },
    { kind: "input.fn-bottom-knob", flags: 1, id: 1, value: 1 },
    { kind: "host.rpc", id: 0xb201, value: 7 }];
  const simulatedResponse = await fetch(`${base}/api/render-v2/simulate`, {
    method: "POST", headers, body: JSON.stringify({ ...fixture, events }) });
  assert.equal(simulatedResponse.status, 200);
  const simulated = await simulatedResponse.json();
  assert.deepEqual(simulated.state, { secondsOfDay: 45297, knobVariant: 1, hostValue: 7 });
  assert.equal(simulated.generation, 3);
  assert.equal(simulated.eventsApplied, 3);
  assert.notEqual(simulated.frameSha256, compiled.frameSha256);

  const keyResponse = await fetch(`${base}/api/render-v2/simulate`, { method: "POST", headers,
    body: JSON.stringify({ ...fixture, events: [{ kind: "input.key", id: 1, value: 1 }] }) });
  assert.equal(keyResponse.status, 422);
  assert.equal((await keyResponse.json()).error, "RENDER_V2_KEY_EVENTS_UNSUPPORTED");
  const historyResponse = await fetch(`${base}/api/render-v2/simulate`, { method: "POST", headers,
    body: JSON.stringify({ ...fixture, events: Array.from({ length: 65 }, () => ({ kind: "tick.1s" })) }) });
  assert.equal(historyResponse.status, 422);
  assert.equal((await historyResponse.json()).error, "RENDER_V2_EVENT_HISTORY_OVERSIZE");
});

test("hosted Render-v2 API auto-falls back to the proven Chromium raster lane", async (context) => {
  const base = await start(context, deterministicRasterProvider());
  const handshake = await fetch(`${base}/api/bridge`, { headers: proxyHeaders }).then((response) => response.json());
  const headers = { ...proxyHeaders, "content-type": "application/json",
    "x-input-lab-session": handshake.sessionToken };
  const fixture = { renderMode: "auto", name: "raster api",
    html: `<div class="render-v2"><main><span id="value">0</span></main></div>`,
    css: `.render-v2{position:relative;width:100px;height:310px;background:linear-gradient(#001,#036);color:white}` +
      `#value{position:absolute;left:10px;top:20px;width:20px;height:20px}`,
    script: `var value=0;widget.on("host.rpc:9",function(event){value=event.value;value=mod(value,2);` +
      `document.querySelector("#value").textContent=pick(value,"0","1");});` };
  const response = await fetch(`${base}/api/render-v2/compile`, { method: "POST", headers,
    body: JSON.stringify(fixture) });
  assert.equal(response.status, 200);
  const compiled = await response.json();
  assert.equal(compiled.requestedRenderMode, "auto");
  assert.equal(compiled.renderMode, "raster");
  assert.equal(compiled.renderSource, "pre-rendered-rgb565");
  assert.equal(compiled.rasterProof.freshRenders, 4);
  assert.equal(compiled.manifest.scene.renderSource, "pinned-chromium-rgb565");
  assert.equal(compiled.manifest.scene.proof.individualVariants, 2);
});
