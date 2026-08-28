export const RENDER_V2_HOST_RPC_METHOD = "widget.v2.event";
export const RENDER_V2_HOST_RPC_EVENT_ID = 0xb201;

function invariant(value, message) {
  if (!value) throw new Error(message);
}

export function normalizeRenderV2HostEvent(value) {
  invariant(Number.isInteger(value) && value >= -0x80000000 && value <= 0x7fffffff,
    "Render-v2 host event value must be an int32.");
  return Object.freeze({ id: RENDER_V2_HOST_RPC_EVENT_ID, value });
}

/** Build inert source; the only interpolated content is a base64 JSON envelope. */
export function buildRenderV2HostEventExpression(value) {
  const params = normalizeRenderV2HostEvent(value);
  const envelope = Buffer.from(JSON.stringify({ method: RENDER_V2_HOST_RPC_METHOD, params }), "utf8")
    .toString("base64");
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
    const rawVersion = await api.getFirmwareVersion();
    const version = rawVersion?.version ?? rawVersion?.value ?? rawVersion;
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

