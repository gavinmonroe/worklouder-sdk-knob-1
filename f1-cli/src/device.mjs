import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { BUBBLE_METHOD, validateBubblePayload } from "./bubble.mjs";
import { ReadOnlyTransport } from "./read-only-transport.mjs";

export const F1_DEVICE_TYPES = Object.freeze(new Set(["knob_f1"]));

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
    throw new Error("No matching Framer F1 / Knob F1 device was found.");
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
  if (device?.deviceType !== "knob_f1") {
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

async function capture(label, operation) {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    return { ok: false, error: `${label}: ${error.message}` };
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
