import { execFileSync } from "node:child_process";

/**
 * Builds the JavaScript text that runs *inside Input's Electron main
 * process* (via framer-widgets/lib/input-inspector.mjs `evaluateInInput`),
 * following the exact device-connect pattern used by the smoke script:
 * discover the one USB Framer F1, connect WLDeviceCommImpl, send
 * WLRPCClient calls sequentially, disconnect. This module only builds
 * strings and checks local process state; it never opens a socket or talks
 * to a device itself, so it is safe to import/unit-test anywhere.
 */

const INPUT_MAIN_ENTRY = "/Applications/input.app/Contents/Resources/app.asar/dist-electron/main/index.js";

function connectPreamble() {
  return String.raw`
  const { createRequire } = process.getBuiltinModule("node:module");
  const requireFromInput = createRequire(${JSON.stringify(INPUT_MAIN_ENTRY)});
  const sdk = requireFromInput("@worklouder/wl-device-kit");
  const devices = new sdk.WLDeviceDiscovery().findWLDevices([sdk.DeviceType.KnobF1]);
  if (devices.length !== 1 || !devices[0].isUsbConnection) throw new Error("Expected exactly one USB Framer F1");
  const comm = new sdk.WLDeviceCommImpl();
  await comm.connect(devices[0]);
  const client = new sdk.WLRPCClient(comm);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));`;
}

/** One batched Input-process script that reads mquickjs telemetry pages 6 and 7. */
export function buildTelemetryPollScript() {
  return String.raw`(async () => {${connectPreamble()}
  try {
    const page6 = await client.sendRpcCall({ method: "widget.mquickjs.telemetry", params: { page: 6 } });
    const page7 = await client.sendRpcCall({ method: "widget.mquickjs.telemetry", params: { page: 7 } });
    return { page6status: page6?.result?.status ?? null, page7status: page7?.result?.status ?? null };
  } finally {
    try { await comm.disconnect(); } catch {}
  }
})()`;
}

/**
 * One batched Input-process script that sends each `widget.mquickjs.event`
 * request in `requests` (in order) and, after a short settle delay, reads
 * one `widget.mquickjs.receipt` per event — the same send-then-read-once
 * pattern the smoke script uses. Returns one `{request, status}` per event.
 */
export function buildEventBatchScript(requests, { settleMs = 60 } = {}) {
  if (!Array.isArray(requests) || requests.length === 0 || requests.length > 16) {
    throw new Error("buildEventBatchScript requires 1..16 event requests.");
  }
  for (const request of requests) {
    for (const field of ["id", "value", "auxiliary", "generation", "revision"]) {
      if (!Number.isInteger(request?.[field])) throw new Error(`Event request.${field} must be an integer.`);
    }
  }
  return String.raw`(async () => {${connectPreamble()}
  const requests = ${JSON.stringify(requests)};
  const results = [];
  try {
    for (const request of requests) {
      await client.sendRpcCall({ method: "widget.mquickjs.event", params: request });
      await wait(${JSON.stringify(settleMs)});
      const receipt = await client.sendRpcCall({ method: "widget.mquickjs.receipt", params: {} });
      results.push({ request, status: receipt?.result?.status ?? null });
    }
    return results;
  } finally {
    try { await comm.disconnect(); } catch {}
  }
})()`;
}

/**
 * `npm run media:live` (examples/music-player/tools/run-live-media.mjs)
 * shares the same device RPC transport. Refuse to start if it is running,
 * per experiments/mquickjs-esp32s3-physical-canary/ZIP-SETTINGS-PLAN.md.
 */
export function assertLiveMediaRunnerNotRunning({ exec = execFileSync } = {}) {
  let output = "";
  try {
    output = exec("pgrep", ["-fl", "run-live-media"], { encoding: "utf8" });
  } catch (error) {
    if (error.status === 1) return; // pgrep: no matching process; safe to proceed.
    throw Object.assign(new Error(`Could not check for a running media runner: ${error.message}`),
      { code: "ZIP_SYNC_MEDIA_RUNNER_CHECK_FAILED", cause: error });
  }
  if (output.trim().length > 0) {
    throw Object.assign(new Error(
      "npm run media:live (run-live-media) appears to be running. Stop it first; it shares the device RPC " +
      "transport zip-sync needs.\n" + output.trim()), { code: "ZIP_SYNC_MEDIA_RUNNER_ACTIVE" });
  }
}
