#!/usr/bin/env node

import { evaluateInInput } from "../framer-widgets/lib/input-inspector.mjs";

const expression = `
(async () => {
  const { createRequire } = process.getBuiltinModule("node:module");
  const requireFromInput = createRequire(
    "/Applications/input.app/Contents/Resources/app.asar/dist-electron/main/index.js"
  );
  const sdk = requireFromInput("@worklouder/wl-device-kit");
  const devices = new sdk.WLDeviceDiscovery().findWLDevices([sdk.DeviceType.KnobF1]);
  if (devices.length !== 1) {
    throw new Error("Expected exactly one Framer F1; found " + devices.length);
  }
  if (!devices[0].isUsbConnection) {
    throw new Error("The Framer must be connected over USB before entering bootloader mode");
  }
  const comm = new sdk.WLDeviceCommImpl();
  await comm.connect(devices[0]);
  try {
    const api = new sdk.WLRPCApi(comm);
    const response = await api.sendIntoBootloader();
    return { device: devices[0], response };
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
