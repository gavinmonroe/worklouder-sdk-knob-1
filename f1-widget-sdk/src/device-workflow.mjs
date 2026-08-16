import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { EXPECTED_STAGE3E3A_APP_SHA256 } from "../../custom-firmware/build-stage3e3a.mjs";
import { PINNED, SDK_ROOT, WORKSPACE_ROOT } from "./constants.mjs";
import { inspectImage } from "./firmware.mjs";
import { STAGE3E3_PATHS, verifyRecoveryGate } from "./stage3e3.mjs";
import { assert, sha256, stableJson } from "./util.mjs";

const exec = promisify(execFile);
const EXPECTED_MAC = "a4:cb:8f:af:32:10";
const NORMAL_PROBE = path.join(WORKSPACE_ROOT, "recovery/verify-live-firmware.mjs");
const ENTER_BOOTLOADER = path.join(WORKSPACE_ROOT, "recovery/enter-bootloader.mjs");
const PORT_PATTERN = /^cu\.(?:usbmodem|usbserial)[A-Za-z0-9._-]*$/u;
const FORBIDDEN_TOOL_ARGS = new Set([
  "erase-flash", "erase-region", "erase-all", "--erase-all", "--force", "--encrypt",
  "--ignore-flash-enc-efuse", "merge-bin",
]);

export const DEVICE_APPROVAL_FORMAT = "framer-f1-device-candidate-v1";
export const DEVICE_WORKFLOW = Object.freeze({
  deviceType: "knob_f1", firmware: "0.4.1", chip: "ESP32-S3", mac: EXPECTED_MAC,
  appOffset: 0x10000, writeBaud: 921600, readbackBaud: 115200,
  smoke: "write-hash verification + watchdog boot + read-only health; normally about 1-3 minutes",
  release: "smoke plus full app read-back/hash before watchdog boot; normally about 4-8 minutes",
});

export function validateDeviceApproval(approval, { appBytes, rollbackBytes, fullReadback = false }) {
  assert(approval?.format === DEVICE_APPROVAL_FORMAT, `Approval format must be ${DEVICE_APPROVAL_FORMAT}.`);
  assert(approval.target?.device === "knob_f1" && approval.target?.firmware === "0.4.1" &&
    approval.target?.chip === "ESP32-S3" && approval.target?.mac?.toLowerCase() === EXPECTED_MAC,
  "Approval target/device/MAC differs from the one backed-up F1.");
  assert(approval.write?.offset === "0x10000" && approval.write?.scope === "factory-app-only" &&
    approval.write?.hardwareWriteApproved === true,
  "Approval does not explicitly authorize an app-only 0x10000 write.");
  const requiredStatus = fullReadback ? "DEVICE_RELEASE_CANDIDATE" : "DEVICE_SMOKE_CANDIDATE";
  assert(approval.status === requiredStatus,
    `${fullReadback ? "Release" : "Smoke"} mode requires status ${requiredStatus}.`);
  assert(approval.app?.bytes === appBytes.length && approval.app?.sha256 === sha256(appBytes),
    "Approval app size/hash differs from the selected image.");
  assert(approval.rollback?.sha256 === sha256(rollbackBytes) &&
    approval.rollback?.sha256 === EXPECTED_STAGE3E3A_APP_SHA256,
  "Approval rollback is not exact live/readback-verified Stage-3E.3A.");
  assert(approval.runtime?.allAssetBytesBelow === "0x3c1d0000" &&
    Number.isInteger(approval.runtime?.headroomBytes) && approval.runtime.headroomBytes > 0,
  "Approval lacks the hard runtime-readable DROM boundary gate.");
  return approval;
}

export function assertSafeEsptoolInvocation(args, { operation }) {
  assert(Array.isArray(args) && args.every((arg) => typeof arg === "string"), "esptool args must be strings.");
  for (const arg of args) assert(!FORBIDDEN_TOOL_ARGS.has(arg), `Forbidden esptool argument ${arg}.`);
  assert(args.includes("--chip") && args.includes("esp32s3"), "Every device command must pin ESP32-S3.");
  assert(args.includes("--port") && args.some((arg) => /^\/dev\/cu\.(?:usbmodem|usbserial)/u.test(arg)),
    "Every device command must pin one USB serial port.");
  if (operation === "write") {
    const command = args.indexOf("write-flash");
    assert(command >= 0 && args[command + 1] === "--flash-size" && args[command + 2] === "keep" &&
      args[command + 3] === "0x10000" && command + 5 === args.length,
    "Write must contain exactly one app image at 0x10000 with flash size kept.");
    assert(args.includes("921600"), "Smoke/release writes must use 921600 baud.");
  } else {
    assert(!args.includes("write-flash"), "Read-only command unexpectedly writes flash.");
  }
  return true;
}

export function selectBootloaderPort(before, after) {
  const added = after.filter((port) => !before.includes(port));
  assert(added.length === 1, `Bootloader port ambiguity: expected one new USB serial port, found ${added.length}.`);
  assert(after.length === 1, `Bootloader port ambiguity: ${after.length} USB serial ports are present.`);
  return added[0];
}

function deviceVersion(report) {
  const version = report?.version;
  if (version === "0.4.1") return version;
  if (version?.version === "0.4.1" || version?.firmwareVersion === "0.4.1") return "0.4.1";
  if (version && [version.major, version.minor, version.patch].every(Number.isInteger)) {
    return `${version.major}.${version.minor}.${version.patch}`;
  }
  return undefined;
}

export function validateNormalDeviceReport(report) {
  assert(report?.device?.deviceType === "knob_f1" && report.device.isUsbConnection === true,
    "Input did not discover exactly one USB knob_f1.");
  assert(deviceVersion(report) === "0.4.1", "Connected knob_f1 firmware is not exact 0.4.1.");
  return report;
}

export function assertAppOnlyInspection(inspection, description = "Candidate") {
  assert(inspection?.appOffset === "0x0" && inspection.fileBytes === inspection.appBytes &&
    inspection.segmentCount === PINNED.segmentCount && inspection.factoryPartitionFit === true,
  `${description} must be one standalone factory-app image, never merged or full-flash data.`);
  return inspection;
}

async function listUsbPorts() {
  const names = (await readdir("/dev")).filter((name) => PORT_PATTERN.test(name)).sort();
  return names.map((name) => `/dev/${name}`);
}

async function runJsonNode(script, runner = exec) {
  const result = await runner(process.execPath, [script], { cwd: WORKSPACE_ROOT, maxBuffer: 4 * 1024 * 1024 });
  return JSON.parse(result.stdout);
}

async function waitForPort(before, { ports = listUsbPorts, timeoutMs = 12_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = [];
  while (Date.now() < deadline) {
    last = await ports();
    const added = last.filter((port) => !before.includes(port));
    if (added.length > 0) return selectBootloaderPort(before, last);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No unambiguous F1 bootloader serial port appeared; final candidates: ${last.join(", ")}.`);
}

async function waitForNormalHealth({ runner = exec, attempts = 8 } = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { return validateNormalDeviceReport(await runJsonNode(NORMAL_PROBE, runner)); }
    catch (error) { lastError = error; await new Promise((resolve) => setTimeout(resolve, 750)); }
  }
  throw new Error(`App write completed but post-boot health did not pass: ${lastError?.message}`);
}

function parseMac(text) {
  return text.match(/(?:MAC|Address):\s*([0-9a-f:]{17})/iu)?.[1]?.toLowerCase();
}

async function runEsp(esptool, args, operation, runner) {
  assertSafeEsptoolInvocation(args, { operation });
  return runner(esptool, args, { cwd: WORKSPACE_ROOT, maxBuffer: 16 * 1024 * 1024 });
}

async function serialIdentityGate(port, { runner = exec, esptool = STAGE3E3_PATHS.esptool } = {}) {
  const common = ["--chip", "esp32s3", "--port", port, "--baud", "115200", "--after", "no-reset"];
  const chip = await runEsp(esptool, [...common, "chip-id"], "read", runner);
  assert(/ESP32-S3/iu.test(chip.stdout), "Serial target is not ESP32-S3.");
  const mac = await runEsp(esptool, [...common, "read-mac"], "read", runner);
  assert(parseMac(mac.stdout) === EXPECTED_MAC, "Serial target MAC differs from the same-device backup.");
  const security = await runEsp(esptool, [...common, "--no-stub", "get-security-info"], "read", runner);
  assert(/Secure Boot:\s*Disabled/iu.test(security.stdout) &&
    /Flash Encryption:\s*Disabled/iu.test(security.stdout),
  "Secure Boot or Flash Encryption differs from the backed-up device state.");
  const flash = await runEsp(esptool, [...common, "flash-id"], "read", runner);
  assert(/Detected flash size:\s*16MB/iu.test(flash.stdout), "Detected flash is not exact 16MB.");
  return { chip: "ESP32-S3", mac: EXPECTED_MAC, secureBoot: false, flashEncryption: false, flashBytes: 0x1000000 };
}

export async function deployAppOnly({
  appPath,
  approvalPath,
  rollbackPath = STAGE3E3_PATHS.e3a,
  fullReadback = false,
  confirmed = false,
  receiptDirectory = path.join(SDK_ROOT, "build/device-receipts"),
} = {}, dependencies = {}) {
  assert(confirmed === true, "Device workflow is opt-in; pass the explicit app-only flash confirmation flag.");
  const runner = dependencies.runner ?? exec;
  const ports = dependencies.ports ?? listUsbPorts;
  const esptool = dependencies.esptool ?? STAGE3E3_PATHS.esptool;
  const started = Date.now();
  const [app, rollback, approval, recovery] = await Promise.all([
    readFile(path.resolve(appPath)), readFile(path.resolve(rollbackPath)),
    readFile(path.resolve(approvalPath), "utf8").then(JSON.parse), verifyRecoveryGate(),
  ]);
  const [appInspection, rollbackInspection] = await Promise.all([
    inspectImage(path.resolve(appPath)), inspectImage(path.resolve(rollbackPath)),
  ]);
  assertAppOnlyInspection(appInspection, "Candidate");
  assertAppOnlyInspection(rollbackInspection, "Rollback");
  validateDeviceApproval(approval, { appBytes: app, rollbackBytes: rollback, fullReadback });
  assert(recovery.mac === EXPECTED_MAC, "Recovery backup belongs to another device.");

  const normalBefore = validateNormalDeviceReport(await runJsonNode(NORMAL_PROBE, runner));
  const portsBefore = await ports();
  assert(portsBefore.length === 0,
    `Refusing bootloader transition while ${portsBefore.length} USB serial candidate(s) already exist.`);
  await runJsonNode(ENTER_BOOTLOADER, runner);
  const port = await waitForPort(portsBefore, { ports });
  const identity = await serialIdentityGate(port, { runner, esptool });

  const after = fullReadback ? "no-reset" : "watchdog-reset";
  const writeArgs = ["--chip", "esp32s3", "--port", port, "--baud", "921600",
    "--after", after, "write-flash", "--flash-size", "keep", "0x10000", path.resolve(appPath)];
  const write = await runEsp(esptool, writeArgs, "write", runner);
  const writeText = `${write.stdout}\n${write.stderr ?? ""}`;
  assert(/Hash of data verified/iu.test(writeText),
    "esptool did not report its normal post-write hash verification; device remains unaccepted.");

  let fullReadbackResult;
  if (fullReadback) {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "f1-sdk-readback-"));
    const readbackPath = path.join(temporary, "app.bin");
    try {
      const readArgs = ["--chip", "esp32s3", "--port", port, "--baud", "115200", "--after", "no-reset",
        "read-flash", "--no-progress", "0x10000", `0x${app.length.toString(16)}`, readbackPath];
      await runEsp(esptool, readArgs, "read", runner);
      const readback = await readFile(readbackPath);
      assert(readback.length === app.length && sha256(readback) === sha256(app) && readback.equals(app),
        "Full release read-back does not exactly match the app image.");
      fullReadbackResult = { bytes: readback.length, sha256: sha256(readback), exact: true };
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
    const resetArgs = ["--chip", "esp32s3", "--port", port, "--baud", "115200",
      "--after", "watchdog-reset", "chip-id"];
    await runEsp(esptool, resetArgs, "read", runner);
  }

  const postBoot = await waitForNormalHealth({ runner });
  const receipt = {
    format: "framer-f1-device-deployment-receipt-v1",
    mode: fullReadback ? "release-full-readback" : "fast-smoke",
    target: { device: "knob_f1", firmware: "0.4.1", mac: EXPECTED_MAC },
    app: { file: path.resolve(appPath), bytes: app.length, sha256: sha256(app), flashOffset: "0x10000" },
    rollback: { file: path.resolve(rollbackPath), bytes: rollback.length, sha256: sha256(rollback) },
    recovery, normalBefore, serialIdentity: identity,
    write: { baud: 921600, hashVerifiedByEsptool: true, appOnly: true },
    fullReadback: fullReadbackResult,
    postBoot,
    elapsedMs: Date.now() - started,
  };
  await mkdir(receiptDirectory, { recursive: true });
  const receiptPath = path.join(receiptDirectory, `device-${Date.now()}-${receipt.mode}.json`);
  await writeFile(receiptPath, stableJson(receipt), { flag: "wx" });
  return Object.freeze({ receipt, receiptPath });
}
