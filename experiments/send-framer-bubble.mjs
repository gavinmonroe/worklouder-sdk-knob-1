#!/usr/bin/env node

const inspectorPort = Number(process.env.INPUT_INSPECTOR_PORT ?? 9230);
const label = process.argv[2] ?? "Input Lab";
const value = process.argv[3] ?? "Custom widget proof";

if (label.length > 32 || value.length > 64) {
  throw new Error("Label/value are too long for the Framer display proof");
}

const targets = await fetch(`http://127.0.0.1:${inspectorPort}/json/list`).then(
  (response) => response.json(),
);
const target = targets.find((candidate) => candidate.webSocketDebuggerUrl);
if (!target) throw new Error(`No Input main-process debugger on ${inspectorPort}`);

const expression = `
(async () => {
  const { createRequire } = process.getBuiltinModule("node:module");
  const requireFromInput = createRequire(
    "/Applications/input.app/Contents/Resources/app.asar/dist-electron/main/index.js"
  );
  const sdk = requireFromInput("@worklouder/wl-device-kit");
  const devices = new sdk.WLDeviceDiscovery().findWLDevices([sdk.DeviceType.KnobF1, sdk.DeviceType.Knob]);
  if (devices.length !== 1) {
    throw new Error("Expected exactly one Framer F1 / Knob1; found " + devices.length);
  }
  const comm = new sdk.WLDeviceCommImpl();
  try {
    await comm.connect(devices[0]);
    const rpc = new sdk.WLRPCApi(comm).getRpcClient();
    const response = await rpc.sendRpcCall({
      method: "v.framer.bubble",
      params: ${JSON.stringify({ l: label, v: value, d: 1, s: 1 })}
    });
    return { device: devices[0], response };
  } finally {
    await comm.disconnect();
  }
})()
`;

const socket = new WebSocket(target.webSocketDebuggerUrl);
const result = await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("Inspector call timed out")), 15000);
  socket.addEventListener("open", () => {
    socket.send(
      JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: {
          expression,
          awaitPromise: true,
          returnByValue: true,
        },
      }),
    );
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== 1) return;
    clearTimeout(timeout);
    if (message.error) reject(new Error(JSON.stringify(message.error)));
    else resolve(message.result);
  });
  socket.addEventListener("error", () => reject(new Error("Inspector socket failed")));
});

socket.close();
if (result.exceptionDetails) {
  throw new Error(result.exceptionDetails.exception?.description ?? "Evaluation failed");
}
console.log(JSON.stringify(result.result?.value ?? result, null, 2));
