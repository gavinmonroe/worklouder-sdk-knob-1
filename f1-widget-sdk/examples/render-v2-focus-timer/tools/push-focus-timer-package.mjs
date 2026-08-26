#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { InputWlrpcSceneTransport } from "../../../input-lab/lib/input-wlrpc-scene-transport.mjs";
import { FOCUS_TIMER_PACKAGE,
  publishFocusTimerPackageIfNeeded } from "../focus-timer-package.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const timerBuild = path.resolve(here, "../build");
const focusBuild = path.resolve(here, "../../render-v2-focus-dial/build");

function invariant(value, message) { if (!value) throw new Error(message); }

export function parseFocusTimerPublisherArguments(argv) {
  const options = { confirmed: false, port: 9230 };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--confirm-live-rpc") options.confirmed = true;
    else if (argument === "--input-port") options.port = Number(argv[++index]);
    else throw new Error(`Unknown focus-timer publisher argument ${argument}.`);
  }
  invariant(options.confirmed,
    "Focus-timer live publish requires --confirm-live-rpc; this opens Input USB RPC.");
  invariant(Number.isInteger(options.port) && options.port >= 1 && options.port <= 65_535,
    "--input-port must be 1..65535.");
  return Object.freeze(options);
}

export async function runFocusTimerPublisher(argv, {
  log = (line) => process.stdout.write(`${line}\n`),
  read = readFile,
  transportFactory = (options) => new InputWlrpcSceneTransport(options),
} = {}) {
  const options = parseFocusTimerPublisherArguments(argv);
  const [focusF1wb, focusF2ep, timerF2ep, timerBaseLzss] = await Promise.all([
    read(path.join(focusBuild, "render-v2-focus-dial.base.f1wb")),
    read(path.join(focusBuild, "render-v2-focus-dial.f2ep")),
    read(path.join(timerBuild, "render-v2-focus-timer.f2ep")),
    read(path.join(timerBuild, "render-v2-focus-timer.base.lzss")),
  ]);
  const sourceParts = { focusF1wb, focusF2ep, timerF2ep, timerBaseLzss };
  const transport = transportFactory({ port: options.port, timeoutMs: 30_000 });
  invariant(transport && typeof transport.rpc === "function",
    "Focus-timer transport must expose rpc().");
  const target = "knob_f1@0.4.1/id26+id27";
  const result = await publishFocusTimerPackageIfNeeded({
    rpc: (method, params) => transport.rpc(method, params),
    sourceParts,
    onStatus(record) {
      if (record.stage === "status-probe") {
        log(JSON.stringify({ status: "FOCUS_TIMER_PACKAGE_STATUS_PROBE", target,
          source: record.source, committedGeneration: record.committedGeneration }));
      } else if (record.stage === "target-selected") {
        log(JSON.stringify({ status: "FOCUS_TIMER_PACKAGE_READY", target,
          expectedGeneration: record.expectedGeneration, generation: record.generation,
          bytes: record.bytes, chunks: FOCUS_TIMER_PACKAGE.chunks, sha256: record.sha256,
          hostClockSync: false }));
      } else if (record.stage === "already-enabled") {
        log(JSON.stringify({ status: "FOCUS_TIMER_PACKAGE_ALREADY_ENABLED", target,
          generation: record.generation, reason: record.reason }));
      }
    },
    onProgress(record) { log(JSON.stringify({ status: "FOCUS_TIMER_PACKAGE_PROGRESS", ...record })); },
  });
  log(JSON.stringify(result));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runFocusTimerPublisher(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${JSON.stringify({ status: "FOCUS_TIMER_PACKAGE_FAILED",
      code: error.code ?? "ERROR", message: error.message })}\n`);
    process.exitCode = 1;
  });
}
