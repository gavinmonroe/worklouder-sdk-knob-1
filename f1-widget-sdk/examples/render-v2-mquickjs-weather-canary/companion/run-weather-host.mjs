#!/usr/bin/env node

import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runFocusTimerPublisher } from "../../render-v2-focus-timer/tools/push-focus-timer-package.mjs";
import { assertLiveMediaRunnerNotRunning } from "../tools/zip-sync-device-rpc.mjs";
import { main as runZipSyncMain } from "../tools/zip-sync.mjs";

/**
 * Host-side orchestrator for the keyboard-editable-ZIP Weather widget
 * companion. Every boot needs two things done once Input's local debugger is
 * open on 9230:
 *
 *  1. Push the clock+timer package, status-derived and idempotent
 *     (examples/render-v2-focus-timer/tools/push-focus-timer-package.mjs).
 *     A firmware that has not yet boot-adopted or persisted it still loses
 *     it on every power-cycle, so it is re-pushed on every boot; a firmware
 *     that already has this exact package committed (boot-adopted from
 *     flash, or persisted from an earlier push) is detected via
 *     widget.scene.capabilities/status and is left alone, not re-pushed.
 *  2. Run the zip-sync poll/push loop in the foreground
 *     (tools/zip-sync.mjs): persists the keyboard-saved ZIP, fetches
 *     Open-Meteo weather for it, pushes the weather events, and acks.
 *
 * See f1-widget-sdk/examples/render-v2-mquickjs-weather-canary/README.md and
 * experiments/mquickjs-esp32s3-physical-canary/ZIP-SETTINGS-PLAN.md for the
 * full contract each piece implements.
 */

export const WEATHER_HOST_CONFIG_PATH = path.join(
  homedir(), "Library", "Application Support", "FramerF1WeatherHost", "zip-sync-config.json",
);

function defaultLog(line) {
  process.stdout.write(`${line}\n`);
}

/**
 * Pushes the clock+timer composite once, status-derived and idempotent (see
 * publishFocusTimerPackageIfNeeded in focus-timer-package.mjs for the exact
 * rule). Tolerates both an "already enabled" result -- returned, not thrown,
 * whenever the probed committed generation already matches or a push at
 * that generation is rejected -- and, as a legacy safety net for firmware
 * that predates the status/capabilities generation report, a directly
 * thrown rejected `begin` (device already has it applied this boot). Any
 * other failure propagates.
 */
export async function pushClockTimerPackageOnce({ log = defaultLog, port = 9230,
  runPublisher = runFocusTimerPublisher } = {}) {
  try {
    const result = await runPublisher(["--confirm-live-rpc", "--input-port", String(port)], { log });
    if (result?.alreadyEnabled) {
      log(JSON.stringify({ status: "FOCUS_TIMER_PACKAGE_ALREADY_APPLIED",
        detail: `clock + timer package is already enabled by firmware (generation ${result.generation})`,
        reason: result.reason }));
    }
  } catch (error) {
    if (error.code === "FOCUS_TIMER_RPC_REJECTED" && /\bbegin\b/i.test(error.message ?? "")) {
      log(JSON.stringify({ status: "FOCUS_TIMER_PACKAGE_ALREADY_APPLIED",
        detail: "begin rejected; clock + timer package is already pushed for this boot" }));
      return;
    }
    throw error;
  }
}

/**
 * Runs the full weather-host sequence: refuse if the Music Host's
 * run-live-media shares the RPC transport, push the clock+timer package
 * once, then hand off to zip-sync's own foreground poll loop (which
 * re-checks the same media-runner guard before it starts polling).
 */
export async function runWeatherHost({ log = defaultLog, port = 9230,
  pushPackage = pushClockTimerPackageOnce, zipSyncMain = runZipSyncMain,
  assertMediaRunnerSafe = assertLiveMediaRunnerNotRunning,
  configPath = WEATHER_HOST_CONFIG_PATH } = {}) {
  assertMediaRunnerSafe();
  await pushPackage({ log, port });
  await zipSyncMain(["--confirm-live-rpc", "--provider", "open-meteo",
    "--config", configPath, "--port", String(port)]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await runWeatherHost();
  } catch (error) {
    process.stderr.write(`Weather host stopped: ${error.message}\n`);
    process.exitCode = 1;
  }
}
