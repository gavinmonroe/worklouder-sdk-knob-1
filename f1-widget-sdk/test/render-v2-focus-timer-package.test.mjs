import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { WIDGET_SCENE_RPC_METHODS } from "../src/render/scene-rpc.mjs";
import { buildFocusTimerPackage, createFocusTimerPackageUpload,
  FOCUS_TIMER_PACKAGE } from "../examples/render-v2-focus-timer/focus-timer-package.mjs";
import { parseFocusTimerPublisherArguments,
  runFocusTimerPublisher } from "../examples/render-v2-focus-timer/tools/push-focus-timer-package.mjs";

const focus = new URL("../examples/render-v2-focus-dial/build/", import.meta.url);
const timer = new URL("../examples/render-v2-focus-timer/build/", import.meta.url);
async function sourceParts() {
  return Promise.all([
    readFile(new URL("render-v2-focus-dial.base.f1wb", focus)),
    readFile(new URL("render-v2-focus-dial.f2ep", focus)),
    readFile(new URL("render-v2-focus-timer.f2ep", timer)),
    readFile(new URL("render-v2-focus-timer.base.lzss", timer)),
  ]);
}

test("focus+timer publisher freezes the 95,535-byte generation pair and 32 chunks", async () => {
  const [focusF1wb, focusF2ep, timerF2ep, timerBaseLzss] = await sourceParts();
  const generationOne = buildFocusTimerPackage({ focusF1wb, focusF2ep, timerF2ep,
    timerBaseLzss, generation: 1 });
  const generationTwo = buildFocusTimerPackage({ focusF1wb, focusF2ep, timerF2ep,
    timerBaseLzss, generation: 2 });
  assert.equal(generationOne.sha256, FOCUS_TIMER_PACKAGE.generationOnePackageSha256);
  assert.equal(generationTwo.sha256, FOCUS_TIMER_PACKAGE.generationTwoPackageSha256);
  assert.deepEqual(generationTwo.binary.subarray(FOCUS_TIMER_PACKAGE.f1wbBytes),
    generationOne.binary.subarray(FOCUS_TIMER_PACKAGE.f1wbBytes));
  const upload = createFocusTimerPackageUpload(generationTwo);
  assert.equal(upload.manifest.expectedGeneration, 1);
  assert.equal(upload.manifest.generation, 2);
  assert.equal(upload.manifest.totalBytes, 95_535);
  assert.equal(upload.chunks.length, 32);
  assert.equal(upload.chunks.at(-1).bytes, 303);
  assert.equal(Buffer.concat(upload.chunks.map(({ data }) => Buffer.from(data, "base64"))).toString("hex"),
    generationTwo.binary.toString("hex"));
});

test("focus+timer live CLI has no host-time mode and commits only the exact composite", async () => {
  assert.throws(() => parseFocusTimerPublisherArguments([]), /--confirm-live-rpc/u);
  assert.throws(() => parseFocusTimerPublisherArguments(["--confirm-live-rpc", "--sync-local-time"]),
    /Unknown/u);
  assert.deepEqual(parseFocusTimerPublisherArguments(["--confirm-live-rpc", "--input-port", "9230"]),
    { confirmed: true, port: 9230 });
  const calls = []; const output = [];
  const result = await runFocusTimerPublisher(["--confirm-live-rpc"], {
    log: (line) => output.push(JSON.parse(line)),
    transportFactory: () => ({ rpc: async (method, params) => {
      calls.push({ method, params }); return { status: "ok" };
    } }),
  });
  assert.equal(result.sha256, FOCUS_TIMER_PACKAGE.generationTwoPackageSha256);
  assert.equal(result.hostClockSync, false);
  assert.deepEqual(calls.map(({ method }) => method), [WIDGET_SCENE_RPC_METHODS.begin,
    ...Array(FOCUS_TIMER_PACKAGE.chunks).fill(WIDGET_SCENE_RPC_METHODS.write),
    WIDGET_SCENE_RPC_METHODS.commit]);
  assert.equal(output[0].hostClockSync, false);
  assert.equal(output.at(-1).status, "FOCUS_TIMER_PACKAGE_COMMIT_ACKNOWLEDGED");
});
