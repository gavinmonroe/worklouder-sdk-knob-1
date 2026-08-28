import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { BUBBLE_METHOD, validateBubblePayload } from "./bubble.mjs";
import { FIRMWARE_PROBE_METHODS, ReadOnlyTransport } from "./read-only-transport.mjs";

// Work Louder ships one firmware line for both variants: the 0.4.1 image carries both
// "Framer F1" and "knob1" identity strings, and wl-device-kit maps each to
// knob-fw-releases. The Knob 1 reports deviceType "knob" (PID 0x8296/0x82e3), so
// filtering to "knob_f1" alone hid it behind --all-devices even though every read-only
// RPC below works on it.
export const F1_DEVICE_TYPES = Object.freeze(new Set(["knob_f1", "knob"]));

// The transient display bubble stays restricted to the Framer F1: it is a display RPC
// and has never been exercised on a Knob 1.
export const BUBBLE_DEVICE_TYPES = Object.freeze(new Set(["knob_f1"]));

const noop = () => {};
export const quietLogger = Object.freeze({
  info: noop,
  debug: noop,
  warn: noop,
  error: noop,
});

export function publicDevice(device, index) {
  return {
    index,
    deviceType: device.deviceType,
    layoutType: device.layoutType,
    connectionType: device.connectionType === 1 ? "hid" : "serial",
    isUsbConnection: device.isUsbConnection,
    productId: device.devicePid,
    portPath: device.portPath,
  };
}

export async function discoverDevices(sdk, { allDevices = false } = {}) {
  const discovery = new sdk.WLDeviceDiscovery(quietLogger);
  const discovered = discovery.findWLDevices();
  const devices = allDevices
    ? discovered
    : discovered.filter((device) => F1_DEVICE_TYPES.has(device.deviceType));
  const permissions = new sdk.WLPermissions(quietLogger);
  const permissionGranted = await permissions.check(
    devices.map((device) => device.portPath).filter(Boolean),
  );
  return { devices, permissionGranted, discoveredCount: discovered.length };
}

export function selectDevice(devices, requestedIndex) {
  if (devices.length === 0) {
    throw new Error("No matching Framer F1 / Knob 1 device was found.");
  }

  if (requestedIndex === undefined && devices.length > 1) {
    throw new Error(
      `Found ${devices.length} matching devices. Re-run with --device <index>.`,
    );
  }

  const index = requestedIndex ?? 0;
  if (!Number.isInteger(index) || index < 0 || index >= devices.length) {
    throw new Error(`Device index ${String(index)} is out of range.`);
  }
  return devices[index];
}

export async function withReadOnlyDevice(sdk, device, operation) {
  const comm = new sdk.WLDeviceCommImpl(quietLogger);
  const connected = await comm.connect(device);
  if (!connected) {
    throw new Error("The device connection could not be opened.");
  }

  try {
    const guardedTransport = new ReadOnlyTransport(comm);
    const api = new sdk.WLRPCApi(guardedTransport, quietLogger);
    return await operation(api);
  } finally {
    await comm.disconnect();
  }
}

/**
 * Sends the one audited, transient Framer display action. This path is kept
 * separate from inspection/backup so their transports never allow it.
 */
export async function sendTransientBubble(sdk, device, input) {
  if (!BUBBLE_DEVICE_TYPES.has(device?.deviceType)) {
    throw new Error("Bubble is restricted to a Framer F1 (knob_f1) device.");
  }
  const payload = validateBubblePayload(input);
  const comm = new sdk.WLDeviceCommImpl(quietLogger);
  const connected = await comm.connect(device);
  if (!connected) {
    throw new Error("The device connection could not be opened.");
  }

  try {
    const guardedTransport = new ReadOnlyTransport(comm, { allowTransientBubble: true });
    const rpc = new sdk.WLRPCClient(guardedTransport, quietLogger);
    return await rpc.sendRpcCall({ method: BUBBLE_METHOD, params: payload });
  } finally {
    await comm.disconnect();
  }
}

// macOS refuses HID output reports to a device whose vendor collection shares an
// interface with a keyboard collection, which is exactly the Knob 1's descriptor:
// IOHIDDeviceOpen succeeds, then IOHIDDeviceSetReport returns kIOReturnNotPermitted
// (0xe00002e2) and seizing returns kIOReturnNotPrivileged (0xe00002c1). Both succeed as
// root. Input Monitoring governs reading input reports, not sending output reports, so
// granting it is necessary but not sufficient. See docs/21-knob1-macos-hid-access.md.
export function explainWriteFailure(message) {
  if (process.platform !== "darwin" || !/cannot write to hid device/iu.test(message)) {
    return message;
  }
  return `${message}. On macOS the kernel denies HID output reports to this device ` +
    "because its vendor interface shares the keyboard interface; re-run the same command " +
    "with sudo. See docs/21-knob1-macos-hid-access.md.";
}

async function capture(label, operation) {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    return { ok: false, error: `${label}: ${explainWriteFailure(error.message)}` };
  }
}

export async function inspectConnectedDevice(api, { includeApps = false } = {}) {
  const version = await capture("firmware version", () => api.getFirmwareVersion());
  const status = await capture("device status", () => api.getDeviceStatus());
  const files = await capture("file list", () => api.getFileList({ recursive: true }));
  const currentScreen = await capture("current screen", () => api.getDeviceCurrentScreen());

  const result = { version, status, files, currentScreen };
  if (includeApps) {
    result.activeApps = await capture("active app list", () => api.getFwActiveApps());
    result.installedApps = await capture("installed app list", () => api.getFwInstalledApps());
  }
  return result;
}

export function safeRelativeDevicePath(deviceName) {
  if (typeof deviceName !== "string" || deviceName.length === 0) {
    throw new Error("Device returned an empty filename.");
  }
  if (deviceName.includes("\\") || /[\u0000-\u001f\u007f]/u.test(deviceName)) {
    throw new Error(`Unsafe device filename: ${JSON.stringify(deviceName)}`);
  }

  const segments = deviceName.split("/").filter(Boolean);
  if (segments.length === 0 || segments.some((part) => part === "." || part === "..")) {
    throw new Error(`Unsafe device filename: ${JSON.stringify(deviceName)}`);
  }
  return segments.join(path.sep);
}

export async function createFreshBackupDirectory(outputPath) {
  const absolute = path.resolve(outputPath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await mkdir(absolute, { recursive: false });
  return absolute;
}

export async function backupConnectedDevice(api, backupRoot, deviceInfo) {
  const files = await api.getFileList({ recursive: true });
  const manifestFiles = [];

  for (const summary of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    let relativePath;
    try {
      relativePath = safeRelativeDevicePath(summary.name);
    } catch (error) {
      manifestFiles.push({ ...summary, saved: false, error: error.message });
      continue;
    }

    // fs.list reports directories without a checksum (the Knob 1's "wallpapers" is one).
    // Reading one as a file always fails, which used to turn a complete backup into a
    // partial one and exit 3. Record it as skipped instead.
    if (summary.checksum === undefined || summary.checksum === null) {
      manifestFiles.push({ ...summary, saved: false, skipped: "directory" });
      continue;
    }

    const data = await api.readFileChunked(summary.name);
    if (!Buffer.isBuffer(data)) {
      manifestFiles.push({ ...summary, saved: false, error: "Device read failed" });
      continue;
    }

    const destination = path.resolve(backupRoot, relativePath);
    const relativeCheck = path.relative(backupRoot, destination);
    if (relativeCheck.startsWith("..") || path.isAbsolute(relativeCheck)) {
      manifestFiles.push({ ...summary, saved: false, error: "Unsafe local path" });
      continue;
    }

    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, data, { flag: "wx" });
    manifestFiles.push({
      ...summary,
      saved: true,
      localPath: relativePath.split(path.sep).join("/"),
      bytesRead: data.length,
      sha256: createHash("sha256").update(data).digest("hex"),
    });
  }

  const manifest = {
    format: "framer-f1-readonly-backup-v1",
    createdAt: new Date().toISOString(),
    device: deviceInfo,
    files: manifestFiles,
  };
  await writeFile(
    path.join(backupRoot, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { flag: "wx" },
  );
  return manifest;
}

/**
 * Calls the unaudited-but-read-only firmware methods behind FIRMWARE_PROBE_METHODS.
 * Kept separate from inspect/backup so their transports never allow these, mirroring
 * how the transient bubble is isolated. Every call is reported individually: a device
 * on older firmware simply answers "Method not found", which is a result, not a fault.
 */
export async function probeFirmwareReads(sdk, device, { file } = {}) {
  const comm = new sdk.WLDeviceCommImpl(quietLogger);
  if (!(await comm.connect(device))) {
    throw new Error("The device connection could not be opened.");
  }
  try {
    const guarded = new ReadOnlyTransport(comm, { allowFirmwareProbes: true });
    const rpc = new sdk.WLRPCClient(guarded, quietLogger);
    const calls = [
      ["ui.wallpaper_list", { offset: 0, limit: 20 }],
      ["sentry.get", undefined],
      ["sys.charger_diagnostic_summary", undefined],
    ];
    // The firmware's error is generated from "Missing %s parameter" with %s = "file",
    // so the key is `file`. Note ui.wallpaper_select uses a different literal,
    // "Missing name param", and really does take `name`.
    if (file !== undefined) calls.push(["fs.chksm", { file }]);

    const results = {};
    for (const [method, params] of calls) {
      results[method] = await capture(method, () =>
        rpc.sendRpcCall(params === undefined ? { method } : { method, params }));
    }
    return { probed: [...FIRMWARE_PROBE_METHODS], results };
  } finally {
    await comm.disconnect();
  }
}
