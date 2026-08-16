import { evaluateInInput } from "../../../framer-widgets/lib/input-inspector.mjs";

import {
  MEDIA_CHUNK_RAW_BYTES,
  MEDIA_MAX_ARTWORK_BYTES,
  MEDIA_TRANSPORT_PROTOCOL,
} from "./protocol.mjs";

const METHODS = Object.freeze(new Set(["mp.write_info", "mp.write_artwork"]));

function invariant(value, message) {
  if (!value) throw new Error(message);
}

function boundedPort(value) {
  invariant(Number.isSafeInteger(value) && value >= 1 && value <= 65_535,
    "Input debugger port must be 1..65535.");
  return value;
}

export function buildInputWlrpcExpression(method, params) {
  invariant(METHODS.has(method), `Unsupported Framer media RPC method ${method}.`);
  invariant(params && typeof params === "object" && !Array.isArray(params), "RPC params must be an object.");
  const envelope = Buffer.from(JSON.stringify({ method, params }), "utf8").toString("base64");
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
    return {
      target: { deviceFamily: "knob_f1", firmware: version, usb: true },
      response,
    };
  } finally {
    try { await comm.disconnect(); } catch {}
  }
})()
`;
}

export class InputWlrpcMediaTransport {
  constructor({ evaluate = evaluateInInput, port = 9230, timeoutMs = 30_000 } = {}) {
    invariant(typeof evaluate === "function", "evaluate must be a function.");
    invariant(Number.isSafeInteger(timeoutMs) && timeoutMs >= 1_000 && timeoutMs <= 60_000,
      "RPC timeoutMs must be 1000..60000.");
    this.evaluate = evaluate;
    this.port = boundedPort(port);
    this.timeoutMs = timeoutMs;
  }

  async negotiate() {
    return Object.freeze({
      protocol: MEDIA_TRANSPORT_PROTOCOL,
      type: "device-capabilities",
      deviceFamily: "knob_f1",
      status: "ready",
      runtimeProof: "live-proven",
      metadata: true,
      artwork: true,
      atomicArtworkCommit: true,
      uiThreadApply: true,
      maxTextBytes: 63,
      maxArtworkWidth: 80,
      maxArtworkHeight: 80,
      maxArtworkBytes: Math.min(MEDIA_MAX_ARTWORK_BYTES, 80 * 80 * 2),
      chunkRawBytes: MEDIA_CHUNK_RAW_BYTES,
      artworkFormats: Object.freeze(["rgb565-le"]),
      hardwareAccess: true,
    });
  }

  async rpc(method, params) {
    const result = await this.evaluate(buildInputWlrpcExpression(method, params), {
      port: this.port,
      timeoutMs: this.timeoutMs,
    });
    invariant(result?.target?.deviceFamily === "knob_f1" && result?.target?.firmware === "0.4.1" &&
      result?.target?.usb === true, "Input WLRPC returned an unverified target identity.");
    const response = result.response?.result ?? result.response;
    invariant(response && typeof response === "object", "Input WLRPC returned no response object.");
    return response;
  }
}
