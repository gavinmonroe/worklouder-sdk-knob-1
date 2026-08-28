import assert from "node:assert/strict";
import test from "node:test";

import {
  assertLiveMediaRunnerNotRunning,
  buildEventBatchScript,
  buildTelemetryPollScript,
} from "../examples/render-v2-mquickjs-weather-canary/tools/zip-sync-device-rpc.mjs";

test("buildTelemetryPollScript reads telemetry pages 6 and 7 and disconnects in a finally block", () => {
  const script = buildTelemetryPollScript();
  assert.match(script, /widget\.mquickjs\.telemetry/u);
  assert.match(script, /params: \{ page: 6 \}/u);
  assert.match(script, /params: \{ page: 7 \}/u);
  assert.match(script, /page6status/u);
  assert.match(script, /page7status/u);
  assert.match(script, /comm\.disconnect\(\)/u);
  // Both Knob variants run the same 0.4.1 image, so discovery accepts both.
  assert.match(script, /findWLDevices\(\[sdk\.DeviceType\.KnobF1, sdk\.DeviceType\.Knob\]\)/u);
  assert.match(script, /Expected exactly one USB Framer F1/u);
});

test("buildEventBatchScript embeds every request, sends event then reads one receipt, and disconnects", () => {
  const requests = [
    { id: 0xb245, value: 60_601, auxiliary: 0, generation: 19, revision: 0 },
    { id: 0xb240, value: 1, auxiliary: 0, generation: 19, revision: 1 },
  ];
  const script = buildEventBatchScript(requests, { settleMs: 60 });
  assert.match(script, /widget\.mquickjs\.event/u);
  assert.match(script, /widget\.mquickjs\.receipt/u);
  assert.match(script, /comm\.disconnect\(\)/u);
  const embedded = JSON.parse(/const requests = (\[[\s\S]*?\]);/u.exec(script)[1]);
  assert.deepEqual(embedded, requests);
});

test("buildEventBatchScript rejects an empty batch, an oversized batch, and non-integer fields", () => {
  assert.throws(() => buildEventBatchScript([]), /1\.\.16/u);
  const tooMany = Array.from({ length: 17 }, (_, index) => ({ id: 1, value: index, auxiliary: 0, generation: 19, revision: 0 }));
  assert.throws(() => buildEventBatchScript(tooMany), /1\.\.16/u);
  assert.throws(() => buildEventBatchScript([{ id: 1, value: "bad", auxiliary: 0, generation: 19, revision: 0 }]),
    /value must be an integer/u);
});

test("assertLiveMediaRunnerNotRunning passes through when pgrep finds nothing (exit status 1)", () => {
  const exec = () => { throw Object.assign(new Error("no process"), { status: 1 }); };
  assert.doesNotThrow(() => assertLiveMediaRunnerNotRunning({ exec }));
});

test("assertLiveMediaRunnerNotRunning refuses to proceed when the media runner is active", () => {
  const exec = () => "12345 node examples/music-player/tools/run-live-media.mjs\n";
  assert.throws(() => assertLiveMediaRunnerNotRunning({ exec }), { code: "ZIP_SYNC_MEDIA_RUNNER_ACTIVE" });
});

test("assertLiveMediaRunnerNotRunning surfaces an unexpected pgrep failure instead of swallowing it", () => {
  const exec = () => { throw Object.assign(new Error("pgrep: command not found"), { status: 127 }); };
  assert.throws(() => assertLiveMediaRunnerNotRunning({ exec }), { code: "ZIP_SYNC_MEDIA_RUNNER_CHECK_FAILED" });
});
