#!/usr/bin/env node

import { evaluateInInput } from "../framer-widgets/lib/input-inspector.mjs";

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
  if (!devices[0].isUsbConnection) {
    throw new Error("The Framer must be connected over USB for live verification");
  }

  const comm = new sdk.WLDeviceCommImpl();
  await comm.connect(devices[0]);
  try {
    const api = new sdk.WLRPCApi(comm);
    const [version, status, currentScreen] = await Promise.all([
      api.getFirmwareVersion(),
      api.getDeviceStatus(),
      api.getDeviceCurrentScreen(),
    ]);
    return { device: devices[0], version, status, currentScreen };
  } finally {
    try { await comm.disconnect(); } catch {}
  }
})()
`;

evaluateInInput(expression, { timeoutMs: 20_000 })
  .then((result) => console.log(JSON.stringify(result, null, 2)))
  .catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  });
