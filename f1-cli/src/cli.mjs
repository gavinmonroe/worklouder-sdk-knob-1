import path from "node:path";
import { fileURLToPath } from "node:url";

import { BUBBLE_METHOD, validateBubblePayload } from "./bubble.mjs";
import {
  backupConnectedDevice,
  createFreshBackupDirectory,
  discoverDevices,
  inspectConnectedDevice,
  publicDevice,
  sendTransientBubble,
  selectDevice,
  withReadOnlyDevice,
} from "./device.mjs";
import { ReadOnlyTransport, ReadOnlyViolationError } from "./read-only-transport.mjs";
import { getExtractedSdkMetadata, loadExtractedSdk } from "./sdk.mjs";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WRITE_LIKE_COMMANDS = /^(write|install|uninstall|delete|remove|flash|update|upload|deploy|enable|disable|modify|restore)$/iu;

function usage() {
  return `Framer F1 read-only CLI

Usage:
  node bin/f1-readonly.mjs inspect [--apps] [--discover-only] [--device N] [--all-devices] [--json]
  node bin/f1-readonly.mjs backup [--output PATH] [--device N] [--all-devices] [--json]
  node bin/f1-readonly.mjs bubble --label TEXT --value TEXT [--d 0|1] [--s 0|1] [--device N] [--dry-run] [--json]
  node bin/f1-readonly.mjs self-test [--json]

Safety: persistent writes remain unavailable. The only transient exception is
the Framer F1 bubble display RPC; firmware, install, delete, and filesystem writes
are blocked.
`;
}

function parseArgs(argv) {
  const [command = "help", ...rest] = argv;
  const options = {
    apps: false,
    discoverOnly: false,
    allDevices: false,
    json: false,
    deviceIndex: undefined,
    output: undefined,
    label: undefined,
    value: undefined,
    d: 1,
    s: 1,
    dryRun: false,
  };

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === "--apps") options.apps = true;
    else if (arg === "--discover-only") options.discoverOnly = true;
    else if (arg === "--all-devices") options.allDevices = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--label" || arg === "--l") {
      const raw = rest[++i];
      if (raw === undefined) throw new Error(`${arg} requires text.`);
      options.label = raw;
    } else if (arg === "--value" || arg === "--v") {
      const raw = rest[++i];
      if (raw === undefined) throw new Error(`${arg} requires text.`);
      options.value = raw;
    } else if (arg === "--d" || arg === "--s") {
      const raw = rest[++i];
      if (raw === undefined || !/^\d+$/u.test(raw)) throw new Error(`${arg} requires a non-negative integer.`);
      options[arg.slice(2)] = Number(raw);
    }
    else if (arg === "--device") {
      const raw = rest[++i];
      if (raw === undefined || !/^\d+$/u.test(raw)) throw new Error("--device requires a non-negative integer.");
      options.deviceIndex = Number(raw);
    } else if (arg === "--output") {
      const raw = rest[++i];
      if (!raw) throw new Error("--output requires a path.");
      options.output = raw;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return { command, options };
}

function print(value, asJson) {
  if (asJson) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  console.log(JSON.stringify(value, null, 2));
}

function isoDirectoryName() {
  return new Date().toISOString().replaceAll(":", "-");
}

async function runInspect(options) {
  const sdk = loadExtractedSdk();
  const sdkMetadata = getExtractedSdkMetadata();
  const discovery = await discoverDevices(sdk, options);
  const devices = discovery.devices.map(publicDevice);
  const base = {
    mode: "read-only",
    sdk: sdkMetadata,
    platformPermissionGranted: discovery.permissionGranted,
    totalWorkLouderDevices: discovery.discoveredCount,
    matchingDevices: devices,
  };

  if (options.discoverOnly || discovery.devices.length === 0) {
    print(base, options.json);
    return discovery.devices.length === 0 ? 2 : 0;
  }
  if (!discovery.permissionGranted) {
    throw new Error("Input Monitoring / HID permission is not granted; refusing to connect.");
  }

  const device = selectDevice(discovery.devices, options.deviceIndex);
  const inspection = await withReadOnlyDevice(sdk, device, (api) =>
    inspectConnectedDevice(api, { includeApps: options.apps }),
  );
  print({ ...base, selectedDevice: publicDevice(device, options.deviceIndex ?? 0), inspection }, options.json);
  return 0;
}

async function runBackup(options) {
  const sdk = loadExtractedSdk();
  const discovery = await discoverDevices(sdk, options);
  if (!discovery.permissionGranted) {
    throw new Error("Input Monitoring / HID permission is not granted; refusing to connect.");
  }
  const device = selectDevice(discovery.devices, options.deviceIndex);
  const requestedOutput = options.output ?? path.join(PROJECT_ROOT, "backups", isoDirectoryName());

  // Create a fresh local directory only after discovery and permission checks.
  // Existing directories are refused, so backups never overwrite local data.
  const backupRoot = await createFreshBackupDirectory(requestedOutput);
  const deviceInfo = publicDevice(device, options.deviceIndex ?? 0);
  const manifest = await withReadOnlyDevice(sdk, device, (api) =>
    backupConnectedDevice(api, backupRoot, deviceInfo),
  );
  const failed = manifest.files.filter((file) => !file.saved);
  print(
    {
      mode: "read-only",
      backupDirectory: backupRoot,
      filesSaved: manifest.files.length - failed.length,
      filesFailed: failed.length,
      manifest,
    },
    options.json,
  );
  return failed.length === 0 ? 0 : 3;
}

async function runBubble(options) {
  if (options.apps || options.discoverOnly || options.allDevices || options.output) {
    throw new Error("bubble does not accept inspect/backup or --all-devices options.");
  }
  const payload = validateBubblePayload({
    l: options.label,
    v: options.value,
    d: options.d,
    s: options.s,
  });
  const request = { method: BUBBLE_METHOD, params: payload };

  if (options.dryRun) {
    print(
      {
        ok: true,
        dryRun: true,
        hardwareAccessed: false,
        deviceRestriction: "knob_f1",
        request,
      },
      options.json,
    );
    return 0;
  }

  const sdk = loadExtractedSdk();
  const discovery = await discoverDevices(sdk, { allDevices: false });
  if (!discovery.permissionGranted) {
    throw new Error("Input Monitoring / HID permission is not granted; refusing to connect.");
  }
  const device = selectDevice(discovery.devices, options.deviceIndex);
  if (device.deviceType !== "knob_f1") {
    throw new Error("Bubble is restricted to a Framer F1 (knob_f1) device.");
  }

  const response = await sendTransientBubble(sdk, device, payload);
  print(
    {
      ok: true,
      dryRun: false,
      transient: true,
      filesystemModified: false,
      device: publicDevice(device, options.deviceIndex ?? 0),
      request,
      response,
    },
    options.json,
  );
  return 0;
}

class MockDeviceTransport {
  constructor() {
    this.requests = [];
  }

  async sendJsonRpcRequest(raw, id) {
    const request = JSON.parse(raw);
    this.requests.push(request.method);
    const resultByMethod = {
      "sys.version": { version: "0.0.0-offline" },
      "device.status": {
        version: "0.0.0-offline",
        profile_index: 0,
        layer_index: 0,
        battery: 100,
        is_charging: false,
      },
      "fs.list": [{ name: "/apps/demo.bin", size: 4, checksum: "offline" }],
      "appmgr.list_active": [{ bundle: "clock", name: "Clock", native: true }],
      "appmgr.list_installed": [],
    };
    return JSON.stringify({ id, result: resultByMethod[request.method] });
  }
}

export async function runSelfTest() {
  const sdk = loadExtractedSdk();
  const mock = new MockDeviceTransport();
  const guard = new ReadOnlyTransport(mock);
  const api = new sdk.WLRPCApi(guard);

  const version = await api.getFirmwareVersion();
  const status = await api.getDeviceStatus();
  const files = await api.getFileList({ recursive: true });
  const activeApps = await api.getFwActiveApps();
  const installedApps = await api.getFwInstalledApps();

  let blockedWrite = false;
  try {
    await guard.sendJsonRpcRequest(JSON.stringify({ id: 999, method: "fs.write", params: {} }), "999");
  } catch (error) {
    blockedWrite = error instanceof ReadOnlyViolationError;
  }
  if (!blockedWrite || mock.requests.includes("fs.write")) {
    throw new Error("Read-only guard self-test failed.");
  }

  return {
    ok: true,
    hardwareAccessed: false,
    sdk: getExtractedSdkMetadata(),
    allowedRequestsObserved: mock.requests,
    blockedRequest: "fs.write",
    mockResults: { version, status, files, activeApps, installedApps },
  };
}

export async function runCli(argv) {
  try {
    const { command, options } = parseArgs(argv);
    if (WRITE_LIKE_COMMANDS.test(command)) {
      console.error(
        `Refusing persistent device-write command: ${command}. Bubble is the only transient exception.`,
      );
      return 64;
    }
    if (command === "help" || command === "--help" || command === "-h") {
      console.log(usage());
      return 0;
    }
    if (command === "inspect") return await runInspect(options);
    if (command === "backup") return await runBackup(options);
    if (command === "bubble") return await runBubble(options);
    if (command === "self-test") {
      print(await runSelfTest(), options.json);
      return 0;
    }
    console.error(`Unknown command: ${command}\n\n${usage()}`);
    return 64;
  } catch (error) {
    console.error(`Error: ${error.message}`);
    if (process.env.F1_CLI_DEBUG === "1" && error.cause) console.error(error.cause);
    return 1;
  }
}
