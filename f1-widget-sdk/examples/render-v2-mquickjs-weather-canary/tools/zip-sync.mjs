#!/usr/bin/env node
import { fileURLToPath } from "node:url";

import { normalizeWeatherWidgetConfig } from "../../../src/render-v2/weather.mjs";
import { encodeWeatherCanaryRevision } from "../protocol.mjs";
import { assertLiveMediaRunnerNotRunning, buildEventBatchScript, buildTelemetryPollScript } from
  "./zip-sync-device-rpc.mjs";
import { DEFAULT_ZIP_SYNC_CONFIG_PATH, readZipSyncConfig, writeZipSyncConfig } from "./zip-sync-config.mjs";
import { buildSettingsAckRequest, decideZipSyncAction, nextPollIntervalMs,
  targetPostalCodeFor, adoptsDeviceZipOnStart, ZIP_SYNC_DEFAULT_REFRESH_INTERVAL_MS } from "./zip-sync-policy.mjs";
import { createZipSyncProvider, ZIP_SYNC_PROVIDERS } from "./zip-sync-providers.mjs";
import { decodeMquickjsMailboxSlots, readMquickjsSettings } from "./zip-sync-telemetry.mjs";

/**
 * Host side of the keyboard-editable ZIP: poll the device for a saved ZIP,
 * persist it, fetch weather for it with a real provider, push the weather
 * events, and ack the save. See
 * experiments/mquickjs-esp32s3-physical-canary/ZIP-SETTINGS-PLAN.md and
 * f1-widget-sdk/examples/render-v2-mquickjs-weather-canary/README.md
 * ("ZIP sync host tool") for the full contract.
 *
 * This file only wires together the pure, unit-tested pieces
 * (zip-sync-telemetry.mjs, zip-sync-policy.mjs, zip-sync-config.mjs,
 * zip-sync-providers.mjs, zip-sync-device-rpc.mjs) with real I/O
 * (evaluateInInput, fetch, the filesystem). It is never exercised against
 * real hardware by an automated test; `--once` exists so a human can.
 */

// Generation 19 per the ZIP-settings plan / smoke script: the redesigned
// weather widget that owns the settings word and the 0xB245 handler.
const DEFAULT_GENERATION = 19;
const DEFAULT_EVALUATE_TIMEOUT_MS = 20_000;

function defaultLog(action, fields = {}) {
  process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), action, ...fields })}\n`);
}

export function parseZipSyncArgs(argv = []) {
  const options = { confirmLiveRpc: false, provider: "open-meteo", configPath: DEFAULT_ZIP_SYNC_CONFIG_PATH,
    once: false, help: false, port: 9230, generation: DEFAULT_GENERATION,
    timeoutMs: DEFAULT_EVALUATE_TIMEOUT_MS, refreshIntervalMs: ZIP_SYNC_DEFAULT_REFRESH_INTERVAL_MS };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--confirm-live-rpc") options.confirmLiveRpc = true;
    else if (argument === "--once") options.once = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--provider") options.provider = argv[++index];
    else if (argument === "--config") options.configPath = argv[++index];
    else if (argument === "--port") options.port = Number(argv[++index]);
    else throw Object.assign(new Error(`Unknown zip-sync option: ${argument}`), { code: "ZIP_SYNC_ARG_UNKNOWN" });
  }
  if (!ZIP_SYNC_PROVIDERS.includes(options.provider)) {
    throw Object.assign(new Error(`--provider must be one of ${ZIP_SYNC_PROVIDERS.join(", ")}, received "${options.provider}".`),
      { code: "ZIP_SYNC_ARG_INVALID" });
  }
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65_535) {
    throw Object.assign(new Error("--port must be 0..65535."), { code: "ZIP_SYNC_ARG_INVALID" });
  }
  return Object.freeze(options);
}

function printHelp() {
  process.stdout.write(`zip-sync.mjs --confirm-live-rpc [--provider open-meteo|deterministic] [--config PATH] [--once] [--port 9230]

Polls the device for the ZIP the keyboard-editable weather widget saved,
persists it on the host, fetches weather for it, pushes the weather events,
and acks the save. Requires the Input app running with its debugger open
(default port 9230) and exactly one Framer F1 connected over USB.

  --confirm-live-rpc   required; without it this prints help and exits.
  --provider NAME      open-meteo (default, real forecast) or deterministic (offline fixture).
  --config PATH        ZIP sync config JSON path (default: f1-widget-sdk/build/zip-sync-config.json).
  --once                run one poll+push cycle and exit, instead of looping.
  --port PORT           Input remote-debugging port (default 9230).

Refuses to start while \`npm run media:live\` is running; it shares the device RPC transport.
`);
}

/**
 * Runs one poll cycle: read telemetry, decide what to do, and if anything
 * changed, fetch weather and push the RPC batch. Every dependency that
 * touches the network, the device, the clock, or stdout is injected so this
 * function can be unit-tested without any of them being real.
 *
 * @returns {Promise<{intervalMs:number, config:object}>}
 */
export async function runPollCycle({ options, provider, config, session, evaluate, log = defaultLog,
  now = () => Date.now() }) {
  const telemetry = await evaluate(buildTelemetryPollScript(), { port: options.port, timeoutMs: options.timeoutMs });
  log("telemetry", { page6: telemetry?.page6status ?? null, page7: telemetry?.page7status ?? null });
  const slots = decodeMquickjsMailboxSlots({ page6: telemetry?.page6status, page7: telemetry?.page7status });
  const settings = readMquickjsSettings(slots);
  const decision = decideZipSyncAction({ started: session.started, settings, config, now: now(),
    lastWeatherFetchAt: session.lastWeatherFetchAt, refreshIntervalMs: options.refreshIntervalMs });
  log("decision", { kind: decision.kind, devicePostalCode: settings.postalCode,
    settingsActive: settings.settingsActive, pendingSave: settings.pendingSave, saveSeq: settings.saveSeq });

  if (decision.kind === "idle") return { intervalMs: nextPollIntervalMs(settings), config };

  const targetPostalCode = targetPostalCodeFor({ decision, settings, config });
  const ackRequest = buildSettingsAckRequest({ decision, settings, config, revision: session.revision,
    generation: options.generation });
  const events = ackRequest ? [ackRequest] : [];

  const persistAck = async () => {
    const adopted = adoptsDeviceZipOnStart({ decision, settings, config });
    if (adopted) log("device-zip-adopted", { postalCode: targetPostalCode, saveSeq: settings.saveSeq });
    if (decision.kind !== "settings-save" && !adopted) return config;
    const nextConfig = await writeZipSyncConfig({ postalCode: targetPostalCode, lastSaveSeq: settings.saveSeq,
      updatedAt: new Date(now()).toISOString() }, options.configPath);
    log("config-persisted", nextConfig);
    return nextConfig;
  };

  let snapshot;
  try {
    snapshot = await provider.lookup(normalizeWeatherWidgetConfig({ postalCode: targetPostalCode,
      countryCode: config.countryCode, units: config.units }));
  } catch (error) {
    log("provider-error", { postalCode: targetPostalCode, kind: decision.kind,
      message: error.message, code: error.code ?? null });
    if (events.length === 0) return { intervalMs: nextPollIntervalMs(settings), config };
    const results = await evaluate(buildEventBatchScript(events), { port: options.port, timeoutMs: options.timeoutMs });
    log("event-batch", { kind: decision.kind, postalCode: targetPostalCode, weatherApplied: false, events: results });
    session.started = true;
    return { intervalMs: nextPollIntervalMs(settings), config: await persistAck() };
  }

  const newRevision = session.revision + 1;
  for (const record of encodeWeatherCanaryRevision(snapshot, { revision: newRevision })) {
    events.push({ id: record.id, value: record.value, auxiliary: record.auxiliary,
      generation: options.generation, revision: newRevision });
  }
  const results = await evaluate(buildEventBatchScript(events), { port: options.port, timeoutMs: options.timeoutMs });
  log("event-batch", { kind: decision.kind, postalCode: targetPostalCode, revision: newRevision,
    weatherApplied: true, events: results });
  session.revision = newRevision;
  session.lastWeatherFetchAt = now();
  session.started = true;
  return { intervalMs: nextPollIntervalMs(settings), config: await persistAck() };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function main(argv = process.argv.slice(2), { evaluate, assertMediaRunnerSafe = assertLiveMediaRunnerNotRunning,
  log = defaultLog, now = () => Date.now() } = {}) {
  const options = parseZipSyncArgs(argv);
  if (options.help || !options.confirmLiveRpc) {
    printHelp();
    if (!options.confirmLiveRpc && !options.help) process.exitCode = 1;
    return;
  }
  assertMediaRunnerSafe();
  if (!evaluate) {
    const { evaluateInInput } = await import("../../../../framer-widgets/lib/input-inspector.mjs");
    evaluate = evaluateInInput;
  }
  const provider = createZipSyncProvider(options.provider);
  let config = await readZipSyncConfig(options.configPath);
  log("config-loaded", config);
  const session = { started: false, revision: 0, lastWeatherFetchAt: null };

  if (options.once) {
    const result = await runPollCycle({ options, provider, config, session, evaluate, log, now });
    config = result.config;
    return;
  }

  let stopping = false;
  const stop = () => { stopping = true; };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  while (!stopping) {
    let intervalMs = nextPollIntervalMs(null);
    try {
      const result = await runPollCycle({ options, provider, config, session, evaluate, log, now });
      config = result.config;
      intervalMs = result.intervalMs;
    } catch (error) {
      log("error", { message: error.message, code: error.code ?? null });
    }
    if (stopping) break;
    await sleep(intervalMs);
  }
  log("stopped", {});
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
