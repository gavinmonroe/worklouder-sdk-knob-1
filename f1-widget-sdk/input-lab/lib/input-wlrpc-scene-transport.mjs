import { evaluateInInput } from "../../../framer-widgets/lib/input-inspector.mjs";

import { WIDGET_SCENE_RPC_METHODS } from "../../src/render/scene-rpc.mjs";

/* The scene methods plus the mquickjs module's five methods (docs/16): same
 * inert JSON envelope, no change to how expressions are built - the set only
 * names which methods may ride it. */
const METHODS = Object.freeze(new Set([
  ...Object.values(WIDGET_SCENE_RPC_METHODS),
  "widget.mquickjs.cap",
  "widget.mquickjs.telemetry",
  "widget.mquickjs.event",
  "widget.mquickjs.receipt",
  "widget.mquickjs.upload",
  "widget.mquickjs.diag",
  "widget.mquickjs.diag2",
  "widget.mquickjs.diag3",
  "widget.mquickjs.diag4",
  "widget.mquickjs.diag5",
  "widget.mquickjs.diag6",
]));
const MAX_RPC_ENVELOPE_BYTES = 8 * 1024;

function invariant(value, message) { if (!value) throw new Error(message); }

function boundedPort(value) {
  invariant(Number.isSafeInteger(value) && value >= 1 && value <= 65_535,
    "Input debugger port must be 1..65535.");
  return value;
}

/** Build inert source: all method parameters are JSON/base64, never JS text. */
export function buildInputWlrpcSceneExpression(method, params) {
  invariant(METHODS.has(method), `Unsupported Framer scene RPC method ${method}.`);
  invariant(params && typeof params === "object" && !Array.isArray(params), "Scene RPC params must be an object.");
  const json = Buffer.from(JSON.stringify({ method, params }), "utf8");
  invariant(json.length >= 2 && json.length <= MAX_RPC_ENVELOPE_BYTES,
    `Scene RPC envelope exceeds ${MAX_RPC_ENVELOPE_BYTES} bytes.`);
  const envelope = json.toString("base64");
  return String.raw`
(async () => {
  const { createRequire } = process.getBuiltinModule("node:module");
  const requireFromInput = createRequire(
    "/Applications/input.app/Contents/Resources/app.asar/dist-electron/main/index.js"
  );
  const sdk = requireFromInput("@worklouder/wl-device-kit");
  const devices = new sdk.WLDeviceDiscovery().findWLDevices([sdk.DeviceType.KnobF1]);
  if (devices.length !== 1 || !devices[0].isUsbConnection) {
    throw new Error("Expected exactly one USB Framer F1");
  }
  const comm = new sdk.WLDeviceCommImpl();
  await comm.connect(devices[0]);
  try {
    const api = new sdk.WLRPCApi(comm);
    const rawVersion = await api.getFirmwareVersion();
    const version = rawVersion?.version ?? rawVersion;
    if (version !== "0.4.1") throw new Error("Framer firmware is not 0.4.1");
    const request = JSON.parse(Buffer.from(${JSON.stringify(envelope)}, "base64").toString("utf8"));
    const response = await new sdk.WLRPCClient(comm).sendRpcCall(request);
    return { target: { deviceFamily: "knob_f1", firmware: version, usb: true }, response };
  } finally {
    try { await comm.disconnect(); } catch {}
  }
})()
`;
}

/** Explicitly injected bridge; construction and expression building perform no hardware I/O. */
export class InputWlrpcSceneTransport {
  constructor({ evaluate = evaluateInInput, port = 9230, timeoutMs = 30_000 } = {}) {
    invariant(typeof evaluate === "function", "evaluate must be a function.");
    invariant(Number.isSafeInteger(timeoutMs) && timeoutMs >= 1_000 && timeoutMs <= 60_000,
      "RPC timeoutMs must be 1000..60000.");
    this.evaluate = evaluate;
    this.port = boundedPort(port);
    this.timeoutMs = timeoutMs;
  }

  async rpc(method, params) {
    const result = await this.evaluate(buildInputWlrpcSceneExpression(method, params), {
      port: this.port, timeoutMs: this.timeoutMs,
    });
    invariant(result?.target?.deviceFamily === "knob_f1" && result?.target?.firmware === "0.4.1" &&
      result?.target?.usb === true, "Input WLRPC returned an unverified scene target identity.");
    const response = result.response?.result ?? result.response;
    invariant(response && typeof response === "object", "Input WLRPC returned no scene response object.");
    return response;
  }
}

