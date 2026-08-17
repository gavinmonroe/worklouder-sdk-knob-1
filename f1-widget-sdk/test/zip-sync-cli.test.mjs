import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { normalizeZipSyncConfig } from "../examples/render-v2-mquickjs-weather-canary/tools/zip-sync-config.mjs";
import { encodeSettingsWord } from "../examples/render-v2-mquickjs-weather-canary/tools/zip-sync-telemetry.mjs";
import { createZipSyncProvider } from "../examples/render-v2-mquickjs-weather-canary/tools/zip-sync-providers.mjs";
import { parseZipSyncArgs, runPollCycle } from "../examples/render-v2-mquickjs-weather-canary/tools/zip-sync.mjs";

function hex8(value) {
  return (value >>> 0).toString(16).padStart(8, "0");
}

function page(pageNumber, slots) {
  return `v1;p=${pageNumber};${slots.map((value, index) =>
    `s${pageNumber === 6 ? index : index + 8}=${hex8(value)}`).join(";")}`;
}

function telemetryFor(settingsWord) {
  const page6 = page(6, [0, 0, 0, 0, 0, 0, 0, 0]);
  const page7 = page(7, [0, 0, 0, 0, 0, 0, settingsWord, 0]);
  return { page6, page7 };
}

function fakeEvaluate({ page6, page7 }) {
  const calls = [];
  const evaluate = async (script) => {
    calls.push(script);
    if (script.includes("widget.mquickjs.telemetry")) return { page6status: page6, page7status: page7 };
    const requests = JSON.parse(/const requests = (\[[\s\S]*?\]);/u.exec(script)[1]);
    return requests.map((request) => ({ request, status: "v1;s=A;q=00000000;seq=00000001" }));
  };
  return { calls, evaluate };
}

function collectLog() {
  const lines = [];
  return { lines, log: (action, fields) => lines.push({ action, ...fields }) };
}

async function withTempConfigPath(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "zip-sync-cli-test-"));
  try {
    return await run(path.join(directory, "zip-sync-config.json"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const baseConfig = normalizeZipSyncConfig({ postalCode: "60601" });
const options = Object.freeze({ port: 9230, timeoutMs: 20_000, generation: 19, refreshIntervalMs: 600_000 });

test("parseZipSyncArgs applies documented defaults and accepts every flag", () => {
  assert.deepEqual(parseZipSyncArgs([]).confirmLiveRpc, false);
  const parsed = parseZipSyncArgs(["--confirm-live-rpc", "--provider", "deterministic", "--config", "/tmp/x.json",
    "--once", "--port", "9999"]);
  assert.equal(parsed.confirmLiveRpc, true);
  assert.equal(parsed.provider, "deterministic");
  assert.equal(parsed.configPath, "/tmp/x.json");
  assert.equal(parsed.once, true);
  assert.equal(parsed.port, 9_999);
  assert.equal(parsed.generation, 19);
});

test("parseZipSyncArgs rejects an unknown option, bad provider, and out-of-range port", () => {
  assert.throws(() => parseZipSyncArgs(["--bogus"]), { code: "ZIP_SYNC_ARG_UNKNOWN" });
  assert.throws(() => parseZipSyncArgs(["--provider", "nope"]), { code: "ZIP_SYNC_ARG_INVALID" });
  assert.throws(() => parseZipSyncArgs(["--port", "70000"]), { code: "ZIP_SYNC_ARG_INVALID" });
});

test("runPollCycle: first cycle always pushes the persisted ZIP (start), regardless of device telemetry", async () => {
  const telemetry = telemetryFor(encodeSettingsWord({ zip: 60_601 }));
  const { calls, evaluate } = fakeEvaluate(telemetry);
  const { lines, log } = collectLog();
  const session = { started: false, revision: 0, lastWeatherFetchAt: null };
  const provider = createZipSyncProvider("deterministic");
  const result = await runPollCycle({ options, provider, config: baseConfig, session, evaluate, log, now: () => 1_000 });

  assert.equal(calls.length, 2, "one telemetry batch + one event batch");
  const eventRequests = JSON.parse(/const requests = (\[[\s\S]*?\]);/u.exec(calls[1])[1]);
  assert.equal(eventRequests.length, 7, "one 0xB245 ack + six weather records");
  assert.deepEqual(eventRequests[0], { id: 0xb245, value: 60_601, auxiliary: 0, generation: 19, revision: 0 });
  assert.equal(eventRequests[1].id, 0xb240);
  assert.equal(eventRequests.at(-1).id, 0xb24f);
  assert.ok(eventRequests.slice(1).every((request) => request.revision === 1));

  assert.equal(session.started, true);
  assert.equal(session.revision, 1);
  assert.equal(session.lastWeatherFetchAt, 1_000);
  assert.equal(result.config, baseConfig, "a start push does not rewrite the config file");
  assert.equal(result.intervalMs, 5_000, "settingsActive is false in this fixture");
  assert.deepEqual(lines.map(({ action }) => action), ["telemetry", "decision", "event-batch"]);
});

test("runPollCycle: an unacked pendingSave adopts the device ZIP, acks with its saveSeq, and persists it", async () => {
  await withTempConfigPath(async (configPath) => {
    const telemetry = telemetryFor(encodeSettingsWord({ zip: 10_001, settingsActive: true, pendingSave: true, saveSeq: 9 }));
    const { calls, evaluate } = fakeEvaluate(telemetry);
    const { lines, log } = collectLog();
    const session = { started: true, revision: 2, lastWeatherFetchAt: 500 };
    const provider = createZipSyncProvider("deterministic");
    const result = await runPollCycle({
      options: { ...options, configPath },
      provider, config: baseConfig, session, evaluate, log, now: () => 2_000,
    });

    const eventRequests = JSON.parse(/const requests = (\[[\s\S]*?\]);/u.exec(calls[1])[1]);
    assert.deepEqual(eventRequests[0], { id: 0xb245, value: 10_001, auxiliary: 9, generation: 19, revision: 2 });
    assert.ok(eventRequests.slice(1).every((request) => request.revision === 3));
    assert.equal(session.revision, 3);
    assert.equal(session.lastWeatherFetchAt, 2_000);
    assert.equal(result.config.postalCode, "10001");
    assert.equal(result.config.lastSaveSeq, 9);
    assert.deepEqual(lines.map(({ action }) => action), ["telemetry", "decision", "event-batch", "config-persisted"]);
  });
});

test("runPollCycle: idle telemetry with fresh weather makes no event batch call at all", async () => {
  const telemetry = telemetryFor(encodeSettingsWord({ zip: 60_601 }));
  const { calls, evaluate } = fakeEvaluate(telemetry);
  const { lines, log } = collectLog();
  const session = { started: true, revision: 1, lastWeatherFetchAt: 1_000 };
  const provider = createZipSyncProvider("deterministic");
  const result = await runPollCycle({ options, provider, config: baseConfig, session, evaluate, log, now: () => 1_500 });

  assert.equal(calls.length, 1, "telemetry only; nothing to push");
  assert.deepEqual(lines.map(({ action }) => action), ["telemetry", "decision"]);
  assert.equal(result.intervalMs, 5_000);
  assert.equal(session.revision, 1, "idle cycles never touch the session");
});

test("runPollCycle: a due weather refresh sends only the six weather records, no 0xB245 ack", async () => {
  const telemetry = telemetryFor(encodeSettingsWord({ zip: 60_601 }));
  const { calls, evaluate } = fakeEvaluate(telemetry);
  const { log } = collectLog();
  const session = { started: true, revision: 4, lastWeatherFetchAt: 0 };
  const provider = createZipSyncProvider("deterministic");
  await runPollCycle({ options, provider, config: baseConfig, session, evaluate, log, now: () => options.refreshIntervalMs + 1 });

  const eventRequests = JSON.parse(/const requests = (\[[\s\S]*?\]);/u.exec(calls[1])[1]);
  assert.equal(eventRequests.length, 6, "no settings ack on a plain refresh");
  assert.deepEqual(eventRequests.map(({ id }) => id), [0xb240, 0xb241, 0xb242, 0xb243, 0xb244, 0xb24f]);
  assert.equal(session.revision, 5);
});

test("runPollCycle: a settings-save still persists lastSaveSeq even when the weather provider fails", async () => {
  await withTempConfigPath(async (configPath) => {
    const telemetry = telemetryFor(encodeSettingsWord({ zip: 90_210, pendingSave: true, saveSeq: 3 }));
    const { calls, evaluate } = fakeEvaluate(telemetry);
    const { lines, log } = collectLog();
    const session = { started: true, revision: 1, lastWeatherFetchAt: 0 };
    const provider = { lookup: async () => { throw Object.assign(new Error("outage"), { code: "WEATHER_FETCH_FAILED" }); } };
    const result = await runPollCycle({
      options: { ...options, configPath }, provider, config: baseConfig, session, evaluate, log, now: () => 999,
    });

    assert.equal(calls.length, 2, "telemetry + an ack-only event batch");
    const eventRequests = JSON.parse(/const requests = (\[[\s\S]*?\]);/u.exec(calls[1])[1]);
    assert.equal(eventRequests.length, 1, "only the 0xB245 ack; no weather records");
    assert.equal(eventRequests[0].id, 0xb245);
    assert.equal(result.config.postalCode, "90210");
    assert.equal(result.config.lastSaveSeq, 3);
    assert.equal(session.revision, 1, "weather never applied, so the revision does not advance");
    assert.equal(session.lastWeatherFetchAt, 0, "no successful fetch happened");
    assert.deepEqual(lines.map(({ action }) => action),
      ["telemetry", "decision", "provider-error", "event-batch", "config-persisted"]);
  });
});

test("runPollCycle: a failed weather refresh sends nothing and leaves state untouched for a retry", async () => {
  const telemetry = telemetryFor(encodeSettingsWord({ zip: 60_601 }));
  const { calls, evaluate } = fakeEvaluate(telemetry);
  const { lines, log } = collectLog();
  const session = { started: true, revision: 1, lastWeatherFetchAt: null };
  const provider = { lookup: async () => { throw Object.assign(new Error("outage"), { code: "WEATHER_FETCH_FAILED" }); } };
  const result = await runPollCycle({ options, provider, config: baseConfig, session, evaluate, log, now: () => 999 });

  assert.equal(calls.length, 1, "telemetry only; there is no ack to send on a plain refresh");
  assert.equal(session.lastWeatherFetchAt, null);
  assert.equal(session.revision, 1);
  assert.equal(result.config, baseConfig);
  assert.deepEqual(lines.map(({ action }) => action), ["telemetry", "decision", "provider-error"]);
});
