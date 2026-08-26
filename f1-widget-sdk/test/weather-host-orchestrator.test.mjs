import assert from "node:assert/strict";
import test from "node:test";

import { pushClockTimerPackageOnce } from
  "../examples/render-v2-mquickjs-weather-canary/companion/run-weather-host.mjs";

/**
 * pushClockTimerPackageOnce is the weather-host orchestrator's one call into
 * the status-derived, idempotent focus-timer publisher
 * (publishFocusTimerPackageIfNeeded, exercised directly in
 * render-v2-focus-timer-package.test.mjs). These tests only cover the
 * orchestrator's own tolerance contract: an "already enabled" result
 * returned by the publisher (both the known-generation and legacy
 * unknown-generation reasons) must be logged and treated as non-fatal, a
 * thrown legacy begin-rejected error must still be tolerated as a safety
 * net, and any other failure must propagate so zip-sync is not started
 * against a keyboard in an unknown state.
 */

function collectLog() {
  const lines = [];
  return { log: (line) => lines.push(JSON.parse(line)), lines };
}

test("pushClockTimerPackageOnce logs and swallows an already-enabled result (known boot-adopted generation)", async () => {
  const { log, lines } = collectLog();
  await pushClockTimerPackageOnce({
    log,
    runPublisher: async () => ({ status: "FOCUS_TIMER_PACKAGE_ALREADY_ENABLED", alreadyEnabled: true,
      generation: 2, reason: "rejected-at-known-boot-adopted-generation", hostClockSync: false }),
  });
  const notice = lines.find((line) => line.status === "FOCUS_TIMER_PACKAGE_ALREADY_APPLIED");
  assert.ok(notice, "expected an already-applied notice");
  assert.match(notice.detail, /generation 2/u);
  assert.equal(notice.reason, "rejected-at-known-boot-adopted-generation");
});

test("pushClockTimerPackageOnce logs and swallows an already-enabled result (committed sha match, no push attempted)", async () => {
  const { log, lines } = collectLog();
  await pushClockTimerPackageOnce({
    log,
    runPublisher: async () => ({ status: "FOCUS_TIMER_PACKAGE_ALREADY_ENABLED", alreadyEnabled: true,
      generation: 9, reason: "committed-sha-match", hostClockSync: false }),
  });
  const notice = lines.find((line) => line.status === "FOCUS_TIMER_PACKAGE_ALREADY_APPLIED");
  assert.ok(notice);
  assert.match(notice.detail, /generation 9/u);
});

test("pushClockTimerPackageOnce does not log an extra notice on a normal successful push", async () => {
  const { log, lines } = collectLog();
  await pushClockTimerPackageOnce({
    log,
    runPublisher: async () => ({ status: "FOCUS_TIMER_PACKAGE_COMMIT_ACKNOWLEDGED", alreadyEnabled: false,
      generation: 3, bytes: 95_535, chunks: 32, sha256: "f".repeat(64), hostClockSync: false }),
  });
  assert.equal(lines.filter((line) => line.status === "FOCUS_TIMER_PACKAGE_ALREADY_APPLIED").length, 0);
});

test("pushClockTimerPackageOnce still tolerates a directly thrown legacy begin-rejected error", async () => {
  const { log, lines } = collectLog();
  await pushClockTimerPackageOnce({
    log,
    runPublisher: async () => {
      const error = new Error("Focus-timer begin was rejected.");
      error.code = "FOCUS_TIMER_RPC_REJECTED";
      throw error;
    },
  });
  const notice = lines.find((line) => line.status === "FOCUS_TIMER_PACKAGE_ALREADY_APPLIED");
  assert.ok(notice);
  assert.match(notice.detail, /already pushed for this boot/u);
});

test("pushClockTimerPackageOnce propagates a genuine, non-begin failure", async () => {
  await assert.rejects(pushClockTimerPackageOnce({
    log: () => {},
    runPublisher: async () => {
      const error = new Error("Focus-timer chunk 5 was rejected.");
      error.code = "FOCUS_TIMER_RPC_REJECTED";
      throw error;
    },
  }), /chunk 5/u);

  await assert.rejects(pushClockTimerPackageOnce({
    log: () => {},
    runPublisher: async () => { throw new Error("transport exploded"); },
  }), /transport exploded/u);
});
