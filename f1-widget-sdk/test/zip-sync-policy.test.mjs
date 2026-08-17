import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSettingsAckRequest,
  decideZipSyncAction,
  nextPollIntervalMs,
  targetPostalCodeFor,
  ZIP_SYNC_DEFAULT_REFRESH_INTERVAL_MS,
  ZIP_SYNC_POLL_HZ_ACTIVE_MS,
  ZIP_SYNC_POLL_IDLE_MS,
} from "../examples/render-v2-mquickjs-weather-canary/tools/zip-sync-policy.mjs";

const idleSettings = Object.freeze({ zip: 60_601, postalCode: "60601", settingsActive: false,
  pendingSave: false, saveSeq: 0 });
const config = Object.freeze({ postalCode: "60601", countryCode: "US", units: "fahrenheit", lastSaveSeq: 0 });

test("decideZipSyncAction always starts with a one-time boot push, regardless of telemetry", () => {
  const pendingSettings = { ...idleSettings, pendingSave: true, saveSeq: 5 };
  assert.equal(decideZipSyncAction({ started: false, settings: idleSettings, config, now: 0,
    lastWeatherFetchAt: null }).kind, "start");
  assert.equal(decideZipSyncAction({ started: false, settings: pendingSettings, config, now: 0,
    lastWeatherFetchAt: null }).kind, "start");
});

test("decideZipSyncAction reacts to a newer, unacked pendingSave once started", () => {
  const pendingSettings = { ...idleSettings, pendingSave: true, saveSeq: 5 };
  assert.equal(decideZipSyncAction({ started: true, settings: pendingSettings, config, now: 0,
    lastWeatherFetchAt: 0 }).kind, "settings-save");
  // Same saveSeq as already acked: not a new save.
  const acked = { ...config, lastSaveSeq: 5 };
  assert.equal(decideZipSyncAction({ started: true, settings: pendingSettings, config: acked, now: 0,
    lastWeatherFetchAt: 0 }).kind, "idle");
  // pendingSave false: nothing to acknowledge even with a differing saveSeq.
  assert.equal(decideZipSyncAction({ started: true, settings: { ...idleSettings, saveSeq: 5 }, config, now: 0,
    lastWeatherFetchAt: 0 }).kind, "idle");
});

test("decideZipSyncAction refreshes weather on its interval and otherwise goes idle", () => {
  assert.equal(decideZipSyncAction({ started: true, settings: idleSettings, config, now: 1_000,
    lastWeatherFetchAt: null }).kind, "weather-refresh");
  assert.equal(decideZipSyncAction({ started: true, settings: idleSettings, config,
    now: ZIP_SYNC_DEFAULT_REFRESH_INTERVAL_MS, lastWeatherFetchAt: 0 }).kind, "weather-refresh");
  assert.equal(decideZipSyncAction({ started: true, settings: idleSettings, config,
    now: ZIP_SYNC_DEFAULT_REFRESH_INTERVAL_MS - 1, lastWeatherFetchAt: 0 }).kind, "idle");
  assert.equal(decideZipSyncAction({ started: true, settings: idleSettings, config,
    now: 500, lastWeatherFetchAt: 0, refreshIntervalMs: 1_000 }).kind, "idle");
});

test("pendingSave takes priority over a due weather refresh", () => {
  const pendingSettings = { ...idleSettings, pendingSave: true, saveSeq: 5 };
  assert.equal(decideZipSyncAction({ started: true, settings: pendingSettings, config,
    now: ZIP_SYNC_DEFAULT_REFRESH_INTERVAL_MS, lastWeatherFetchAt: 0 }).kind, "settings-save");
});

test("nextPollIntervalMs is ~1 Hz while settingsActive, else ~5 s", () => {
  assert.equal(nextPollIntervalMs({ settingsActive: true }), ZIP_SYNC_POLL_HZ_ACTIVE_MS);
  assert.equal(nextPollIntervalMs({ settingsActive: false }), ZIP_SYNC_POLL_IDLE_MS);
  assert.equal(nextPollIntervalMs(null), ZIP_SYNC_POLL_IDLE_MS);
});

test("targetPostalCodeFor uses the device's just-saved ZIP for settings-save, else the persisted config ZIP", () => {
  const pendingSettings = { ...idleSettings, zip: 10_001, postalCode: "10001", pendingSave: true, saveSeq: 5 };
  assert.equal(targetPostalCodeFor({ decision: { kind: "settings-save" }, settings: pendingSettings, config }), "10001");
  assert.equal(targetPostalCodeFor({ decision: { kind: "start" }, settings: idleSettings, config }), "60601");
  assert.equal(targetPostalCodeFor({ decision: { kind: "weather-refresh" }, settings: idleSettings, config }), "60601");
  const zeroPadded = { ...config, postalCode: "00501" };
  assert.equal(targetPostalCodeFor({ decision: { kind: "start" }, settings: idleSettings, config: zeroPadded }), "00501");
});

test("buildSettingsAckRequest builds the exact 0xB245 event per decision kind, or null for a plain refresh", () => {
  const pendingSettings = { ...idleSettings, zip: 10_001, pendingSave: true, saveSeq: 42 };
  assert.deepEqual(buildSettingsAckRequest({ decision: { kind: "settings-save" }, settings: pendingSettings,
    config, revision: 3, generation: 19 }), { id: 0xb245, value: 10_001, auxiliary: 42, generation: 19, revision: 3 });
  assert.deepEqual(buildSettingsAckRequest({ decision: { kind: "start" }, settings: idleSettings,
    config, revision: 0, generation: 19 }), { id: 0xb245, value: 60_601, auxiliary: 0, generation: 19, revision: 0 });
  assert.equal(buildSettingsAckRequest({ decision: { kind: "weather-refresh" }, settings: idleSettings,
    config, revision: 3, generation: 19 }), null);
});

test("buildSettingsAckRequest requires a nonnegative revision and a positive generation", () => {
  assert.throws(() => buildSettingsAckRequest({ decision: { kind: "start" }, settings: idleSettings, config,
    revision: -1, generation: 19 }), /revision/u);
  assert.throws(() => buildSettingsAckRequest({ decision: { kind: "start" }, settings: idleSettings, config,
    revision: 0, generation: 0 }), /generation/u);
});
