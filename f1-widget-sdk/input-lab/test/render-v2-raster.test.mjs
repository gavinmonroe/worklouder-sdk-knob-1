import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createRenderV2Runtime } from "../../src/render-v2/index.mjs";
import { ChromiumRasterCaptureProvider } from "../lib/chromium-raster-capture.mjs";
import { compileInputLabRenderV2, serializeInputLabRenderV2 } from "../lib/render-v2.mjs";

const GRADIENT_HTML = `<div class="render-v2">
  <header><small>FRAMER F1</small><b>LIVE</b></header>
  <div class="dial"><i></i></div>
  <section><span id="mode">READY</span></section>
  <footer><em>HOST</em><span id="signal">0</span></footer>
</div>`;

const GRADIENT_CSS = `.render-v2 {
  position: relative; width: 100px; height: 310px; overflow: hidden; color: #eef8ff;
  background: radial-gradient(circle at 50% 72%, #1769ce 0, #082958 29%, #031128 55%, #01040a 80%);
}
.render-v2::before { content: ""; position: absolute; inset: 112px -82px -94px; border-radius: 50%;
  background: conic-gradient(from 25deg, #173886, #35b7ff, #2354db, #071736, #173886); filter: blur(10px); }
header { position: absolute; box-sizing: border-box; left: 8px; right: 8px; top: 12px; height: 22px;
  display: flex; align-items: center; justify-content: space-between; font: 7px monospace; letter-spacing: .6px; }
header b { color: #64d9ff; font-weight: 500; }
.dial { position: absolute; box-sizing: border-box; left: -34px; top: 122px; width: 168px; height: 168px;
  border-radius: 50%; border: 1px solid rgba(105,201,255,.45); box-shadow: inset 0 0 28px #0a1835; }
.dial i { position: absolute; left: 81px; top: 8px; width: 4px; height: 35px; border-radius: 3px;
  background: linear-gradient(#fff,#52bdff); transform: rotate(18deg); transform-origin: 2px 76px; }
section { position: absolute; left: 8px; top: 58px; width: 84px; height: 38px; }
#mode { display: block; width: 84px; height: 38px; color: #9cddff; text-align: center;
  font: 18px/38px monospace; letter-spacing: 1px; }
footer { position: absolute; left: 8px; right: 8px; bottom: 12px; height: 18px; display: flex;
  align-items: center; justify-content: space-between; font: 9px/18px monospace; }
footer em { color: #5680a8; font-style: normal; }
#signal { display: block; width: 18px; height: 18px; text-align: center; color: #57d6ff; }`;

const GRADIENT_SCRIPT = `var dial = 0;
var host = 0;
widget.on("input.fn-bottom-knob", function (event) {
  dial += event.delta;
  dial = mod(dial, 2);
  document.querySelector("#mode").textContent = pick(dial, "READY", "FOCUS");
});
widget.on("host.rpc:0xB201", function (event) {
  host = event.value;
  host = mod(host, 2);
  document.querySelector("#signal").textContent = pick(host, "0", "1");
  document.querySelector("#signal").style.color = pick(host, "#57D6FF", "#FFB24D");
});`;

test("Chromium Render v2 compiles a nested large-gradient layout with deterministic composability proof", async () => {
  const provider = new ChromiumRasterCaptureProvider();
  const source = { html: GRADIENT_HTML, css: GRADIENT_CSS, script: GRADIENT_SCRIPT,
    rootClass: "render-v2", renderMode: "raster", name: "gradient-v2" };
  const first = await compileInputLabRenderV2(source, { captureProvider: provider });
  const second = await compileInputLabRenderV2(source, { captureProvider: provider });
  assert.equal(first.renderMode, "raster");
  assert.equal(first.compilation.linked.renderSource, "pre-rendered-rgb565");
  assert.equal(first.compilation.package.sha256, second.compilation.package.sha256);
  assert.deepEqual(first.compilation.rasterProof, second.compilation.rasterProof);
  const response = serializeInputLabRenderV2(first);
  assert.equal(response.renderSource, "pre-rendered-rgb565");
  assert.equal(response.rasterProof.format, "framer-render-v2-raster-proof-v1");
  assert.equal(response.manifest.scene.renderSource, "pinned-chromium-rgb565");
  assert.deepEqual({ initial: first.compilation.rasterProof.initialVariants,
    individual: first.compilation.rasterProof.individualVariants,
    pairwise: first.compilation.rasterProof.pairwiseStates,
    combined: first.compilation.rasterProof.combinedStates },
  { initial: 2, individual: 4, pairwise: 1, combined: 1 });
  assert.ok(first.compilation.linked.budget.pixelBytes > 0);
  assert.ok(first.compilation.linked.budget.pixelBytes <= 16 * 1024);
  const runtime = createRenderV2Runtime(first.compilation.linked);
  const before = runtime.frame;
  const dial = runtime.dispatch({ kind: "input.fn-bottom-knob", flags: 1, id: 1, value: 1 });
  assert.notDeepEqual(dial.frame, before);
  const host = runtime.dispatch({ kind: "host.rpc", id: 0xb201, value: 1 });
  assert.notDeepEqual(host.frame, dial.frame);
});

test("Chromium Render v2 captures every reachable formatTime digit and proves combined clock parity", async () => {
  const provider = new ChromiumRasterCaptureProvider();
  const html = `<div class="render-v2"><div class="sky"></div><span id="clock">12:34:56</span></div>`;
  const css = `.render-v2{position:relative;width:100px;height:310px;overflow:hidden;` +
    `background:radial-gradient(circle at 50% 80%,#126bd2,#04142d 55%,#01040a);color:white}` +
    `.sky{position:absolute;inset:150px -50px -80px;border-radius:50%;background:linear-gradient(#248cff,#08142e)}` +
    `#clock{position:absolute;box-sizing:border-box;left:2px;top:72px;display:block;width:96px;height:34px;` +
    `background:#030812;color:#dff7ff;text-align:center;font:16px/34px monospace;font-variant-numeric:tabular-nums}`;
  const script = `var seconds=45296;widget.on("tick.1s",function(event){seconds+=1;` +
    `seconds=mod(seconds,86400);document.querySelector("#clock").textContent=formatTime(seconds);});`;
  const compiled = await compileInputLabRenderV2({ html, css, script, renderMode: "raster" },
    { captureProvider: provider });
  assert.equal(compiled.compilation.linked.budget.bindings, 6);
  assert.deepEqual({ initial: compiled.compilation.rasterProof.initialVariants,
    individual: compiled.compilation.rasterProof.individualVariants,
    pairwise: compiled.compilation.rasterProof.pairwiseStates,
    combined: compiled.compilation.rasterProof.combinedStates },
  { initial: 6, individual: 45, pairwise: 15, combined: 1 });
  assert.ok(compiled.compilation.linked.budget.spans <= 512);
  assert.ok(compiled.compilation.linked.budget.pixelBytes <= 16 * 1024);
});

test("Chromium Render v2 rejects text mutations that cause layout reflow", async () => {
  const provider = new ChromiumRasterCaptureProvider();
  const html = `<div class="render-v2"><span id="label">W</span></div>`;
  const css = `.render-v2{width:100px;height:310px;background:#001;color:white}` +
    `#label{display:inline;font:24px Arial,sans-serif}`;
  const script = `var value=0;widget.on("host.rpc:7",function(event){value=event.value;value=mod(value,2);` +
    `document.querySelector("#label").textContent=pick(value,"W","i");});`;
  await assert.rejects(() => compileInputLabRenderV2({ html, css, script, renderMode: "raster" },
    { captureProvider: provider }), (error) => error.code === "RENDER_V2_RASTER_REFLOW");
});

test("Chromium Render v2 rejects overlapping absolute patch bindings", async () => {
  const provider = new ChromiumRasterCaptureProvider();
  const html = `<div class="render-v2"><span id="a">0</span><span id="b">0</span></div>`;
  const css = `.render-v2{position:relative;width:100px;height:310px;background:#001;color:white}` +
    `.render-v2 span{position:absolute;left:30px;top:80px;display:block;width:40px;height:40px;` +
    `font:28px/40px monospace;text-align:center}`;
  const script = `var a=0;var b=0;` +
    `widget.on("host.rpc:7",function(event){a=event.value;a=mod(a,2);` +
    `document.querySelector("#a").textContent=pick(a,"0","1");});` +
    `widget.on("host.rpc:8",function(event){b=event.value;b=mod(b,2);` +
    `document.querySelector("#b").textContent=pick(b,"0","1");});`;
  await assert.rejects(() => compileInputLabRenderV2({ html, css, script, renderMode: "raster" },
    { captureProvider: provider }), (error) => error.code === "RENDER_V2_RASTER_BINDING_OVERLAP");
});

test("Chromium Render v2 validates unsafe content before starting capture", async () => {
  let captures = 0;
  const captureProvider = { async captureRenderV2Variants() { captures += 1; throw new Error("must not run"); } };
  const script = `var value=0;widget.on("host.rpc:7",function(event){value=event.value;value=mod(value,2);` +
    `document.querySelector("#label").textContent=pick(value,"0","1");});`;
  await assert.rejects(() => compileInputLabRenderV2({ html: `<div class="render-v2"><span id="label">0</span>` +
    `<img src="https://example.test/x"></div>`, css: ".render-v2{color:white}", script, renderMode: "raster" },
  { captureProvider }), /resource-loading|Navigable/u);
  assert.equal(captures, 0);
});

test("hosted release copies the Chromium Render v2 compiler beside its API adapter", async () => {
  const builder = await readFile(new URL("../tools/build-hosted-release.mjs", import.meta.url), "utf8");
  assert.match(builder, /copy\("input-lab\/lib\/render-v2-raster\.mjs", "input-lab\/lib\/render-v2-raster\.mjs"\)/u);
});
