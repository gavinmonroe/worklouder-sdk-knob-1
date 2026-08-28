#!/usr/bin/env node
/**
 * Enter the ESP32-S3 ROM bootloader via the vendor `sys.bootloader` RPC.
 *
 * The repository's recovery/enter-bootloader.mjs drives this same SDK call from inside
 * the installed Input app. This does it directly against the extracted SDK, so no Input
 * install is needed. On macOS a Knob 1 must run this under sudo, because
 * IOHIDDeviceSetReport is denied there at uid 501 and succeeds at uid 0 — measured, but
 * not yet explained; see docs/21-knob1-macos-hid-access.md. (An earlier note here blamed
 * the vendor collection sharing the keyboard interface. A Framer F1 shares one too and is
 * written unprivileged, so that is not the cause.) An F1 does not need sudo.
 *
 * This is a STATE-CHANGING call. It is NOT routed through f1-cli's ReadOnlyTransport,
 * because sys.bootloader is deliberately not in that allowlist. Nothing is written to
 * flash; the device reboots into ROM download mode and re-enumerates as a serial port.
 * Power-cycling the device returns it to normal firmware.
 */
import { readdirSync } from "node:fs";
import { loadExtractedSdk } from "../f1-cli/src/sdk.mjs";

const noop = () => {};
const quiet = Object.freeze({ info: noop, debug: noop, warn: noop, error: noop });
const ports = () => readdirSync("/dev").filter((n) => n.startsWith("cu.")).sort();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!process.argv.includes("--confirm")) {
  console.error("Refusing to run without --confirm.\n" +
    "This reboots the keyboard into ROM download mode (reversible by unplugging it).");
  process.exit(2);
}

const sdk = loadExtractedSdk();
const discovery = new sdk.WLDeviceDiscovery(quiet);
const devices = discovery.findWLDevices();
if (devices.length !== 1) {
  console.error(`Expected exactly one Work Louder device; found ${devices.length}.`);
  process.exit(1);
}
const device = devices[0];
if (!device.isUsbConnection) {
  console.error("The device must be connected over USB, not Bluetooth.");
  process.exit(1);
}
console.log("target:", JSON.stringify({ deviceType: device.deviceType,
  layoutType: device.layoutType, devicePid: device.devicePid, portPath: device.portPath }));

const before = ports();
console.log("serial ports before:", before.join(", ") || "(none)");

const comm = new sdk.WLDeviceCommImpl(quiet);
if (!(await comm.connect(device))) {
  console.error("The device connection could not be opened.");
  process.exit(1);
}

try {
  const api = new sdk.WLRPCApi(comm, quiet);
  // The device drops its HID interface as it reboots, so this call may never return a
  // response. A timeout or transport error here is an expected outcome, not a failure.
  const response = await Promise.race([
    api.sendIntoBootloader().then((r) => ({ ok: true, response: r })),
    sleep(6000).then(() => ({ ok: "timeout", response: null })),
  ]);
  console.log("sys.bootloader:", JSON.stringify(response));
} catch (error) {
  console.log("sys.bootloader threw (often normal, the device disconnects):", error.message);
} finally {
  try { await comm.disconnect(); } catch {}
}

for (let i = 0; i < 12; i += 1) {
  await sleep(1000);
  const now = ports();
  const added = now.filter((p) => !before.includes(p));
  if (added.length) {
    console.log(`\nNEW SERIAL PORT after ${i + 1}s: ${added.join(", ")}`);
    console.log("The device is in ROM download mode. Next: read its chip id with esptool.");
    process.exit(0);
  }
}
console.log("\nNo new serial port appeared within 12s.");
console.log("Ports now:", ports().join(", ") || "(none)");
