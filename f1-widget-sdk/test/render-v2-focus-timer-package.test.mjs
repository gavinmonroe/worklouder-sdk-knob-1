import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { WIDGET_SCENE_RPC_METHODS } from "../src/render/scene-rpc.mjs";
import { buildFocusTimerPackage, createFocusTimerPackageUpload,
  FOCUS_TIMER_MINIMUM_BOOT_ADOPTED_GENERATION, FOCUS_TIMER_PACKAGE,
  probeFocusTimerCommittedPackage,
  publishFocusTimerPackageIfNeeded } from "../examples/render-v2-focus-timer/focus-timer-package.mjs";
import { parseFocusTimerPublisherArguments,
  runFocusTimerPublisher } from "../examples/render-v2-focus-timer/tools/push-focus-timer-package.mjs";

const focus = new URL("../examples/render-v2-focus-dial/build/", import.meta.url);
const timer = new URL("../examples/render-v2-focus-timer/build/", import.meta.url);
async function sourceParts() {
  const [focusF1wb, focusF2ep, timerF2ep, timerBaseLzss] = await Promise.all([
    readFile(new URL("render-v2-focus-dial.base.f1wb", focus)),
    readFile(new URL("render-v2-focus-dial.f2ep", focus)),
    readFile(new URL("render-v2-focus-timer.f2ep", timer)),
    readFile(new URL("render-v2-focus-timer.base.lzss", timer)),
  ]);
  return { focusF1wb, focusF2ep, timerF2ep, timerBaseLzss };
}

test("focus+timer publisher freezes the 95,535-byte generation pair and 32 chunks", async () => {
  const parts = await sourceParts();
  const generationOne = buildFocusTimerPackage({ ...parts, generation: 1 });
  const generationTwo = buildFocusTimerPackage({ ...parts, generation: 2 });
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

test("focus+timer package rebuilds at an arbitrary generation, changing only the sha and F1WB generation word", async () => {
  const parts = await sourceParts();
  const generationTwo = buildFocusTimerPackage({ ...parts, generation: 2 });
  const generationSix = buildFocusTimerPackage({ ...parts, generation: 6 });
  assert.equal(generationSix.generation, 6);
  assert.equal(generationSix.binary.length, FOCUS_TIMER_PACKAGE.packageBytes);
  assert.notEqual(generationSix.sha256, generationTwo.sha256);
  // Every byte outside the four-byte F1WB generation word (offset 8..11) is
  // identical: the frozen focus/timer/raster inputs did not change, only the
  // committed generation did.
  assert.deepEqual(generationSix.binary.subarray(12), generationTwo.binary.subarray(12));
  assert.equal(generationSix.binary.readUInt32LE(8), 6);
  assert.equal(generationTwo.binary.readUInt32LE(8), 2);

  const upload = createFocusTimerPackageUpload(generationSix, { expectedGeneration: 5 });
  assert.equal(upload.manifest.expectedGeneration, 5);
  assert.equal(upload.manifest.generation, 6);
  assert.equal(upload.manifest.transactionId, `f2pt-00000006-${generationSix.sha256.slice(0, 16)}`);
  assert.equal(upload.chunks.length, 32);
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
    // A transport that answers every method (including the new
    // capabilities/status probe) with a bare {status:"ok"}, matching
    // today's real firmware, which has not yet shipped committedGeneration
    // reporting. The probe should find nothing and fall back to the
    // historical generation 1 -> 2 push.
    transportFactory: () => ({ rpc: async (method, params) => {
      calls.push({ method, params }); return { status: "ok" };
    } }),
  });
  assert.equal(result.sha256, FOCUS_TIMER_PACKAGE.generationTwoPackageSha256);
  assert.equal(result.hostClockSync, false);
  assert.equal(result.alreadyEnabled, false);
  assert.deepEqual(calls.map(({ method }) => method), [
    WIDGET_SCENE_RPC_METHODS.capabilities, WIDGET_SCENE_RPC_METHODS.status,
    WIDGET_SCENE_RPC_METHODS.begin,
    ...Array(FOCUS_TIMER_PACKAGE.chunks).fill(WIDGET_SCENE_RPC_METHODS.write),
    WIDGET_SCENE_RPC_METHODS.commit]);
  const statusProbeLine = output.find((line) => line.status === "FOCUS_TIMER_PACKAGE_STATUS_PROBE");
  assert.equal(statusProbeLine.committedGeneration, null);
  const readyLine = output.find((line) => line.status === "FOCUS_TIMER_PACKAGE_READY");
  assert.equal(readyLine.hostClockSync, false);
  assert.equal(readyLine.expectedGeneration, 1);
  assert.equal(readyLine.generation, 2);
  assert.equal(output.at(-1).status, "FOCUS_TIMER_PACKAGE_COMMIT_ACKNOWLEDGED");
});

test("probeFocusTimerCommittedPackage parses a numeric or canonical-decimal-string committedGeneration", async () => {
  const numeric = await probeFocusTimerCommittedPackage({
    rpc: async (method) => (method === WIDGET_SCENE_RPC_METHODS.capabilities
      ? { status: "ok", committedGeneration: 4 } : { status: "ok" }),
  });
  assert.deepEqual(numeric, { source: WIDGET_SCENE_RPC_METHODS.capabilities, generation: 4, sha256: null });

  const decimalString = await probeFocusTimerCommittedPackage({
    rpc: async (method) => (method === WIDGET_SCENE_RPC_METHODS.status
      ? { status: "ok", committedGeneration: "7", committedSha256: "a".repeat(64) } : { status: "ok" }),
  });
  assert.deepEqual(decimalString, { source: WIDGET_SCENE_RPC_METHODS.status, generation: 7, sha256: "a".repeat(64) });
});

test("probeFocusTimerCommittedPackage treats an unreachable, erroring, or fieldless probe as unavailable", async () => {
  const unavailable = await probeFocusTimerCommittedPackage({ rpc: async () => { throw new Error("no such method"); } });
  assert.deepEqual(unavailable, { source: "unavailable", generation: null, sha256: null });

  const bareOk = await probeFocusTimerCommittedPackage({ rpc: async () => ({ status: "ok" }) });
  assert.deepEqual(bareOk, { source: "unavailable", generation: null, sha256: null });

  const errorStatus = await probeFocusTimerCommittedPackage({
    rpc: async () => ({ status: "error", committedGeneration: 3 }),
  });
  assert.deepEqual(errorStatus, { source: "unavailable", generation: null, sha256: null });

  const malformedGeneration = await probeFocusTimerCommittedPackage({
    rpc: async () => ({ status: "ok", committedGeneration: "-1" }),
  });
  assert.deepEqual(malformedGeneration, { source: "unavailable", generation: null, sha256: null });
});

function fakeRpc({ committedGeneration = null, committedSha256 = null, beginStatus = "ok",
  writeStatus = () => "ok", commitStatus = "ok" } = {}) {
  const calls = [];
  const rpc = async (method, params) => {
    calls.push({ method, params });
    if (method === WIDGET_SCENE_RPC_METHODS.capabilities) {
      return committedGeneration === null ? { status: "ok" } :
        { status: "ok", committedGeneration, ...(committedSha256 ? { committedSha256 } : {}) };
    }
    if (method === WIDGET_SCENE_RPC_METHODS.status) return { status: "ok" };
    if (method === WIDGET_SCENE_RPC_METHODS.begin) return { status: beginStatus };
    if (method === WIDGET_SCENE_RPC_METHODS.write) return { status: writeStatus(params.index) };
    if (method === WIDGET_SCENE_RPC_METHODS.commit) return { status: commitStatus };
    if (method === WIDGET_SCENE_RPC_METHODS.abort) return { status: "ok" };
    throw new Error(`unexpected method ${method}`);
  };
  return { rpc, calls };
}

test("publishFocusTimerPackageIfNeeded skips the push when the committed sha already matches", async () => {
  const parts = await sourceParts();
  const generationFour = buildFocusTimerPackage({ ...parts, generation: 4 });
  const { rpc, calls } = fakeRpc({ committedGeneration: 4, committedSha256: generationFour.sha256 });
  const result = await publishFocusTimerPackageIfNeeded({ rpc, sourceParts: parts });
  assert.deepEqual(result, { status: "FOCUS_TIMER_PACKAGE_ALREADY_ENABLED", alreadyEnabled: true,
    generation: 4, reason: "committed-sha-match", hostClockSync: false });
  assert.deepEqual(calls.map(({ method }) => method), [WIDGET_SCENE_RPC_METHODS.capabilities]);
});

test("publishFocusTimerPackageIfNeeded pushes N -> N+1 when the committed sha does not match", async () => {
  const parts = await sourceParts();
  const { rpc, calls } = fakeRpc({ committedGeneration: 4, committedSha256: "0".repeat(64) });
  const result = await publishFocusTimerPackageIfNeeded({ rpc, sourceParts: parts });
  assert.equal(result.alreadyEnabled, false);
  assert.equal(result.generation, 5);
  const methods = calls.map(({ method }) => method);
  assert.deepEqual(methods.slice(0, 1), [WIDGET_SCENE_RPC_METHODS.capabilities]);
  assert.equal(methods.filter((method) => method === WIDGET_SCENE_RPC_METHODS.begin).length, 1);
  const begin = calls.find(({ method }) => method === WIDGET_SCENE_RPC_METHODS.begin);
  assert.equal(begin.params.expectedGeneration, 4);
  assert.equal(begin.params.generation, 5);
});

test("publishFocusTimerPackageIfNeeded classifies a rejected push as already-enabled when the committed generation is known and boot-adopted", async () => {
  const parts = await sourceParts();
  assert.equal(FOCUS_TIMER_MINIMUM_BOOT_ADOPTED_GENERATION, 2);
  const { rpc, calls } = fakeRpc({ committedGeneration: 2, beginStatus: "error" });
  const result = await publishFocusTimerPackageIfNeeded({ rpc, sourceParts: parts });
  assert.deepEqual(result, { status: "FOCUS_TIMER_PACKAGE_ALREADY_ENABLED", alreadyEnabled: true,
    generation: 2, reason: "rejected-at-known-boot-adopted-generation", hostClockSync: false });
  assert.deepEqual(calls.map(({ method }) => method),
    [WIDGET_SCENE_RPC_METHODS.capabilities, WIDGET_SCENE_RPC_METHODS.begin]);
});

test("publishFocusTimerPackageIfNeeded also classifies a rejected write or commit as already-enabled at a known boot-adopted generation", async () => {
  const parts = await sourceParts();
  const { rpc: writeRpc } = fakeRpc({ committedGeneration: 2, writeStatus: (index) => (index === 3 ? "error" : "ok") });
  const writeResult = await publishFocusTimerPackageIfNeeded({ rpc: writeRpc, sourceParts: parts });
  assert.equal(writeResult.alreadyEnabled, true);
  assert.equal(writeResult.generation, 2);

  const { rpc: commitRpc } = fakeRpc({ committedGeneration: 2, commitStatus: "error" });
  const commitResult = await publishFocusTimerPackageIfNeeded({ rpc: commitRpc, sourceParts: parts });
  assert.equal(commitResult.alreadyEnabled, true);
  assert.equal(commitResult.generation, 2);
});

test("publishFocusTimerPackageIfNeeded falls back to the legacy begin-rejected classification when no generation is reported", async () => {
  const parts = await sourceParts();
  const { rpc, calls } = fakeRpc({ committedGeneration: null, beginStatus: "error" });
  const result = await publishFocusTimerPackageIfNeeded({ rpc, sourceParts: parts });
  assert.deepEqual(result, { status: "FOCUS_TIMER_PACKAGE_ALREADY_ENABLED", alreadyEnabled: true,
    generation: 1, reason: "begin-rejected-generation-unknown-legacy", hostClockSync: false });
  assert.deepEqual(calls.map(({ method }) => method), [
    WIDGET_SCENE_RPC_METHODS.capabilities, WIDGET_SCENE_RPC_METHODS.status, WIDGET_SCENE_RPC_METHODS.begin]);
});

test("publishFocusTimerPackageIfNeeded does not swallow a genuine write/commit failure when no generation is reported", async () => {
  const parts = await sourceParts();
  const { rpc: writeRpc } = fakeRpc({ committedGeneration: null, writeStatus: (index) => (index === 5 ? "error" : "ok") });
  await assert.rejects(publishFocusTimerPackageIfNeeded({ rpc: writeRpc, sourceParts: parts }),
    { code: "FOCUS_TIMER_RPC_REJECTED" });

  const { rpc: commitRpc } = fakeRpc({ committedGeneration: null, commitStatus: "error" });
  await assert.rejects(publishFocusTimerPackageIfNeeded({ rpc: commitRpc, sourceParts: parts }),
    { code: "FOCUS_TIMER_RPC_REJECTED" });
});
