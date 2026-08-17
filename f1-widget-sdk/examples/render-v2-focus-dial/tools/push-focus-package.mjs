#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { evaluateInInput } from "../../../../framer-widgets/lib/input-inspector.mjs";
import { InputWlrpcSceneTransport } from "../../../input-lab/lib/input-wlrpc-scene-transport.mjs";
import { buildRenderV2HostEventExpression } from "../../render-v2-events/host-event-rpc.mjs";
import {
  buildFocusDialPackage,
  FOCUS_DIAL_PACKAGE,
  publishFocusDialPackageSmoke,
} from "../focus-package.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const buildDirectory = path.resolve(here, "../build");

function invariant(value, message) { if (!value) throw new Error(message); }

export function parseFocusPublisherArguments(argv) {
  /* The combined chain stages its generation-one bootstrap before exposing
   * scene RPC, then seeds scene state committed_generation=1. */
  const options = { confirmed: false, expectedGeneration: 1, port: 9230,
    syncLocalTime: false, hostSeconds: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--confirm-live-rpc") options.confirmed = true;
    else if (argument === "--expected-generation") options.expectedGeneration = Number(argv[++index]);
    else if (argument === "--input-port") options.port = Number(argv[++index]);
    else if (argument === "--sync-local-time") options.syncLocalTime = true;
    else if (argument === "--host-seconds") {
      options.hostSeconds = Number(argv[++index]); options.syncLocalTime = true;
    }
    else throw new Error(`Unknown focus-dial publisher argument ${argument}.`);
  }
  invariant(options.confirmed,
    "Focus-dial live publish requires --confirm-live-rpc; this opens the USB Framer RPC transport.");
  invariant(Number.isInteger(options.expectedGeneration) && options.expectedGeneration >= 0 &&
    options.expectedGeneration < 0xffffffff, "--expected-generation must be a uint32 below 4294967295.");
  invariant(Number.isInteger(options.port) && options.port >= 1 && options.port <= 65_535,
    "--input-port must be 1..65535.");
  invariant(options.hostSeconds === null || (Number.isInteger(options.hostSeconds) &&
    options.hostSeconds >= 0 && options.hostSeconds < 86_400),
  "--host-seconds must be 0..86399.");
  return Object.freeze(options);
}

async function sendLiveHostEvent(value, { port }) {
  const result = await evaluateInInput(buildRenderV2HostEventExpression(value), {
    port, timeoutMs: 30_000,
  });
  const response = result?.response?.result ?? result?.response;
  invariant(result?.target?.deviceFamily === "knob_f1" && result?.target?.firmware === "0.4.1" &&
    result?.target?.usb === true && response?.status === "ok" && Object.keys(response).length === 1,
  "Focus-dial host clock sync did not return exact status-only acknowledgment.");
  return Object.freeze({ value, target: result.target });
}

export async function runFocusDialPublisher(argv, {
  log = (line) => process.stdout.write(`${line}\n`),
  read = readFile,
  transportFactory = (options) => new InputWlrpcSceneTransport(options),
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  sendHostEvent = sendLiveHostEvent,
  now = () => new Date(),
} = {}) {
  const options = parseFocusPublisherArguments(argv);
  const [baseFrame, f2ep] = await Promise.all([
    read(path.join(buildDirectory, "render-v2-focus-dial.base.rgb565")),
    read(path.join(buildDirectory, "render-v2-focus-dial.f2ep")),
  ]);
  const packageValue = buildFocusDialPackage({ baseFrame, f2ep, generation: 1 });
  const transport = transportFactory({ port: options.port, timeoutMs: 30_000 });
  invariant(transport && typeof transport.rpc === "function", "Focus-dial transport must expose rpc().");
  log(JSON.stringify({ status: "FOCUS_DIAL_PACKAGE_READY", target: "knob_f1@0.4.1/id26",
    expectedGeneration: options.expectedGeneration, nextGeneration: options.expectedGeneration + 1,
    bytes: FOCUS_DIAL_PACKAGE.packageBytes, chunks: 26,
    baseRgb565Sha256: "8c7395f123a199f0428350b5061cc8313cbbbab39239f6487bd93f1ec44c8bb3",
    f1raSha256: FOCUS_DIAL_PACKAGE.f1raSha256, f2epSha256: FOCUS_DIAL_PACKAGE.f2epSha256 }));
  const result = await publishFocusDialPackageSmoke({ package: packageValue,
    expectedGeneration: options.expectedGeneration,
    rpc: (method, params) => transport.rpc(method, params),
    onProgress(record) { log(JSON.stringify({ status: "FOCUS_DIAL_PACKAGE_PROGRESS", ...record })); } });
  let hostSync = null;
  if (options.syncLocalTime) {
    /* The switch is intentionally UI-thread paired. Give the 100ms tick hook
     * two opportunities to observe the newly staged pointer/generation. */
    await wait(250);
    const current = now();
    const value = options.hostSeconds ??
      current.getHours() * 3_600 + current.getMinutes() * 60 + current.getSeconds();
    hostSync = await sendHostEvent(value, { port: options.port });
    log(JSON.stringify({ status: "FOCUS_DIAL_HOST_CLOCK_ENQUEUED", id: 0xb201,
      idHex: "0xB201", value, target: hostSync.target }));
  }
  const completed = Object.freeze({ ...result, hostSync });
  log(JSON.stringify(completed));
  return completed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runFocusDialPublisher(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${JSON.stringify({ status: "FOCUS_DIAL_PACKAGE_FAILED",
      code: error.code ?? "ERROR", message: error.message })}\n`);
    process.exitCode = 1;
  });
}
