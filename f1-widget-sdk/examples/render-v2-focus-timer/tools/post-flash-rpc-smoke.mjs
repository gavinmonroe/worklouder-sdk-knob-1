#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import { evaluateInInput } from "../../../../framer-widgets/lib/input-inspector.mjs";

const SCENE_PROTOCOL = "framer-widget-scene-rpc-v1";
const HOST_EVENT_ID = 0xb201;

function invariant(value, message) { if (!value) throw new Error(message); }

export function parsePostFlashSmokeArguments(argv) {
  const options = { confirmed: false, port: 9230, hostSeconds: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--confirm-live-rpc") options.confirmed = true;
    else if (argument === "--input-port") options.port = Number(argv[++index]);
    else if (argument === "--id26-host-seconds") options.hostSeconds = Number(argv[++index]);
    else throw new Error(`Unknown post-flash smoke argument ${argument}.`);
  }
  invariant(options.confirmed,
    "Post-flash smoke requires --confirm-live-rpc; stop the media runner before claiming Input USB RPC.");
  invariant(Number.isInteger(options.port) && options.port >= 1 && options.port <= 65_535,
    "--input-port must be 1..65535.");
  invariant(options.hostSeconds === null || (Number.isInteger(options.hostSeconds) &&
    options.hostSeconds >= 0 && options.hostSeconds < 86_400),
  "--id26-host-seconds must be 0..86399.");
  return Object.freeze(options);
}

function encodedRequest(method, params = undefined) {
  return Buffer.from(JSON.stringify(params === undefined ? { method } : { method, params }), "utf8")
    .toString("base64");
}

/** One Input evaluation, one WLDeviceComm connection, and sequential RPCs avoid transport lock races. */
export function buildPostFlashSmokeExpression({ hostSeconds = null } = {}) {
  invariant(hostSeconds === null || (Number.isInteger(hostSeconds) && hostSeconds >= 0 &&
    hostSeconds < 86_400), "Post-flash host seconds must be 0..86399.");
  const sceneStatus = encodedRequest("widget.scene.status", { protocol: SCENE_PROTOCOL });
  const hostEvent = hostSeconds === null ? null : encodedRequest("widget.v2.event",
    { id: HOST_EVENT_ID, value: hostSeconds });
  return String.raw`
(async () => {
  const { createRequire } = process.getBuiltinModule("node:module");
  const requireFromInput = createRequire(
    "/Applications/input.app/Contents/Resources/app.asar/dist-electron/main/index.js"
  );
  const sdk = requireFromInput("@worklouder/wl-device-kit");
  const devices = new sdk.WLDeviceDiscovery().findWLDevices([sdk.DeviceType.KnobF1, sdk.DeviceType.Knob]);
  if (devices.length !== 1 || !devices[0].isUsbConnection) {
    throw new Error("Expected exactly one USB Framer F1 / Knob1");
  }
  const comm = new sdk.WLDeviceCommImpl();
  await comm.connect(devices[0]);
  try {
    const api = new sdk.WLRPCApi(comm);
    const client = new sdk.WLRPCClient(comm);
    const rawVersion = await api.getFirmwareVersion();
    const version = rawVersion?.version ?? rawVersion?.value ?? rawVersion;
    if (version !== "0.4.1") throw new Error("Framer firmware is not exact 0.4.1");
    const status = await api.getDeviceStatus();
    const decode = (value) => JSON.parse(Buffer.from(value, "base64").toString("utf8"));
    const sceneStatus = await client.sendRpcCall(decode(${JSON.stringify(sceneStatus)}));
    const hostEvent = ${hostEvent === null ? "null" :
      `await client.sendRpcCall(decode(${JSON.stringify(hostEvent)}))`};
    return {
      target: { deviceFamily: "knob_f1", firmware: version, usb: true },
      status,
      sceneStatus,
      hostEvent,
    };
  } finally {
    try { await comm.disconnect(); } catch {}
  }
})()
`;
}

function responseResult(value) { return value?.result ?? value; }

function exactStatusOnly(value, label) {
  const result = responseResult(value);
  invariant(result && typeof result === "object" && !Array.isArray(result) &&
    Object.keys(result).length === 1 && result.status === "ok",
  `${label} did not return exact {status:"ok"}.`);
  return result;
}

export async function runPostFlashRpcSmoke(argv, {
  evaluate = evaluateInInput,
  log = (line) => process.stdout.write(`${line}\n`),
} = {}) {
  const options = parsePostFlashSmokeArguments(argv);
  const result = await evaluate(buildPostFlashSmokeExpression(options), {
    port: options.port, timeoutMs: 30_000,
  });
  invariant(result?.target?.deviceFamily === "knob_f1" &&
    result.target.firmware === "0.4.1" && result.target.usb === true,
  "Post-flash smoke did not return exact USB knob_f1@0.4.1 identity.");
  exactStatusOnly(result.sceneStatus, "widget.scene.status");
  if (options.hostSeconds !== null) exactStatusOnly(result.hostEvent, "widget.v2.event 0xB201");
  const report = Object.freeze({
    status: "POST_FLASH_RPC_SMOKE_OK",
    target: result.target,
    deviceStatus: result.status,
    activeScreen: "manual-only: stock firmware has no active-screen RPC",
    sceneStatus: "ok",
    hostEvent: options.hostSeconds === null ? "not-requested" :
      Object.freeze({ id: HOST_EVENT_ID, idHex: "0xB201", value: options.hostSeconds, status: "ok",
        route: "ID26 diagnostic only" }),
    visualAcceptanceStillRequired: Object.freeze([
      "ID1 music metadata/art/progress",
      "ID7 WPM Pet",
      "ID26 orange shared-RTC clock, +4px header padding, and five-position 1Hz dial rotation",
      "ID27 dark sky-blue timer, +4px header padding, and five-position 1Hz dial rotation",
      "ID27 Fn+bottom-dial edit is visible immediately in five-minute steps",
      "ID27 countdown pauses while hidden and resumes without losing remaining time",
    ]),
  });
  log(JSON.stringify(report));
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPostFlashRpcSmoke(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${JSON.stringify({ status: "POST_FLASH_RPC_SMOKE_FAILED",
      message: error.message })}\n`);
    process.exitCode = 1;
  });
}
