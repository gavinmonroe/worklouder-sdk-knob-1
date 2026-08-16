import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DEVICE_APPROVAL_FORMAT,
  assertAppOnlyInspection,
  assertSafeEsptoolInvocation,
  deployAppOnly,
  selectBootloaderPort,
  validateDeviceApproval,
  validateNormalDeviceReport,
} from "../src/device-workflow.mjs";
import { prepareStage3e3, STAGE3E3_SDK_PROFILE, validateStage3e3Manifest } from "../src/stage3e3.mjs";

const expectedApp = "e7af67227d3969e3fefb5e9d3cc093fc20509f81c0426a4442ea87100f3dae44";
const expectedRollback = "dd8edaaa2c3aa98a1cbdbda319255cc7d1a0e02d0069f543dd574ef040db4b83";

test("Stage-3E.3 SDK pipeline composes exact I4 app then reuses ABI/build cache", async (context) => {
  const output = await mkdtemp(path.join(os.tmpdir(), "f1-sdk-fast-test-"));
  context.after(() => rm(output, { recursive: true, force: true }));
  const first = await prepareStage3e3({ outputDirectory: output });
  assert.equal(first.report.status, "RUNTIME_NO_GO_FULL48_PET_NOT_VISIBLE_2026_08_15");
  assert.equal(first.report.deployable, false);
  assert.equal(first.report.outputs.app.sha256, expectedApp);
  assert.equal(first.report.assets.frames, 48);
  assert.equal(first.report.assets.bankBytes, 56_640);
  assert.equal(first.report.assets.runtimeEndAddress, "0x3c1ceed0");
  assert.equal(first.report.assets.runtimeBoundaryExclusive, "0x3c1d0000");
  assert.equal(first.report.assets.headroomBytes, 4_400);
  assert.equal(first.report.profile.scale, 0x200);
  assert.deepEqual(first.report.profile.input,
    { scope: "screen-local", chord: "Fn+bottom encoder", encoderId: 1 });
  assert.equal(first.report.combinedId1Id7.status, "READY_FOR_FINAL_COMBINED_LINK_AUDIT");
  assert.equal(first.report.combinedId1Id7.stockRegistry.occupiedId8, true);
  assert.deepEqual(first.report.combinedId1Id7.stockRegistry.unusedIds, [1, 7]);
  assert.equal(first.report.combinedId1Id7.music.screenId, 1);
  assert.equal(first.report.combinedId1Id7.music.appendedDromBytes, 0);
  assert.equal(first.report.combinedId1Id7.setup.stockSetupCalls, 1);
  const second = await prepareStage3e3({ outputDirectory: output });
  assert.deepEqual({ abi: second.report.cache.abi, build: second.report.cache.build },
    { abi: "hit", build: "hit" });
  assert.ok(second.report.timings.totalMs < 5_000);
  assert.equal(second.report.combinedId1Id7.music.cache, "hit");
});

test("declarative Stage-3E.3 manifest pins six species, eight moods, and no bitmap background", async () => {
  const file = new URL("../../framer-widgets/assets/device-lvgl-v5-i4-species/manifest.json", import.meta.url);
  const raw = JSON.parse(await readFile(file, "utf8"));
  assert.equal(validateStage3e3Manifest(raw).frames.length, 48);
  const bitmap = structuredClone(raw); bitmap.layout.background = "sky.png";
  assert.throws(() => validateStage3e3Manifest(bitmap), /procedural/u);
  const reordered = structuredClone(raw);
  [reordered.frames[0], reordered.frames[1]] = [reordered.frames[1], reordered.frames[0]];
  assert.throws(() => validateStage3e3Manifest(reordered), /frame 0 order/u);
  assert.equal(STAGE3E3_SDK_PROFILE.visiblePet.width, 104);
  assert.equal(STAGE3E3_SDK_PROFILE.visiblePet.height, 84);
});

test("device approval fails closed on mode, hash, MAC, rollback, and DROM boundary", () => {
  const app = Buffer.from("candidate");
  const rollback = Buffer.from("rollback");
  const approval = {
    format: DEVICE_APPROVAL_FORMAT,
    status: "DEVICE_SMOKE_CANDIDATE",
    target: { device: "knob_f1", firmware: "0.4.1", chip: "ESP32-S3", mac: "a4:cb:8f:af:32:10" },
    write: { offset: "0x10000", scope: "factory-app-only", hardwareWriteApproved: true },
    app: { bytes: app.length, sha256: "wrong" },
    rollback: { sha256: expectedRollback },
    runtime: { allAssetBytesBelow: "0x3c1d0000", headroomBytes: 1 },
  };
  assert.throws(() => validateDeviceApproval(approval, { appBytes: app, rollbackBytes: rollback }), /app size\/hash/u);
  assert.throws(() => validateDeviceApproval({ ...approval, target: { ...approval.target, mac: "00:00:00:00:00:00" } },
    { appBytes: app, rollbackBytes: rollback }), /MAC/u);
  assert.throws(() => validateDeviceApproval({ ...approval, status: "DEVICE_SMOKE_CANDIDATE" },
    { appBytes: app, rollbackBytes: rollback, fullReadback: true }), /DEVICE_RELEASE_CANDIDATE/u);
});

test("device command guard allows only one app-only write and rejects destructive tokens", () => {
  const safe = ["--chip", "esp32s3", "--port", "/dev/cu.usbmodem1", "--baud", "921600",
    "--after", "watchdog-reset", "write-flash", "--flash-size", "keep", "0x10000", "/tmp/app.bin"];
  assert.equal(assertSafeEsptoolInvocation(safe, { operation: "write" }), true);
  assert.throws(() => assertSafeEsptoolInvocation([...safe, "--force"], { operation: "write" }), /Forbidden/u);
  assert.throws(() => assertSafeEsptoolInvocation(safe.map((value) => value === "0x10000" ? "0x0" : value),
    { operation: "write" }), /exactly one app/u);
  assert.equal(selectBootloaderPort([], ["/dev/cu.usbmodem1"]), "/dev/cu.usbmodem1");
  assert.throws(() => selectBootloaderPort([], ["/dev/cu.usbmodem1", "/dev/cu.usbmodem2"]), /ambiguity/u);
  assert.throws(() => selectBootloaderPort(["/dev/cu.usbmodem1"], ["/dev/cu.usbmodem1"]), /one new/u);
  const appOnly = { appOffset: "0x0", fileBytes: 100, appBytes: 100,
    segmentCount: 6, factoryPartitionFit: true };
  assert.equal(assertAppOnlyInspection(appOnly), appOnly);
  assert.throws(() => assertAppOnlyInspection({ ...appOnly, appOffset: "0x10000", fileBytes: 65_636 }),
    /never merged or full-flash/u);
});

test("read-only Input health gate requires exact USB knob_f1 firmware 0.4.1", () => {
  const report = { device: { deviceType: "knob_f1", isUsbConnection: true },
    version: { major: 0, minor: 4, patch: 1 } };
  assert.equal(validateNormalDeviceReport(report), report);
  assert.throws(() => validateNormalDeviceReport({ ...report, device: { ...report.device, deviceType: "nomad_e" } }),
    /knob_f1/u);
  assert.throws(() => validateNormalDeviceReport({ ...report, version: "0.4.2" }), /0.4.1/u);
});

test("fast smoke workflow is fully injectable and emits only one guarded app write", async (context) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "f1-sdk-device-sim-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const appPath = new URL("../../custom-firmware/build/framer-0.4.1-stage3e3-wpm-pet-full-app.bin", import.meta.url);
  const rollbackPath = new URL("../../custom-firmware/build/framer-0.4.1-stage3e3a-i4-canary-app.bin", import.meta.url);
  const [app, rollback] = await Promise.all([readFile(appPath), readFile(rollbackPath)]);
  const crypto = await import("node:crypto");
  const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
  const approval = {
    format: DEVICE_APPROVAL_FORMAT, status: "DEVICE_SMOKE_CANDIDATE",
    target: { device: "knob_f1", firmware: "0.4.1", chip: "ESP32-S3", mac: "a4:cb:8f:af:32:10" },
    write: { offset: "0x10000", scope: "factory-app-only", hardwareWriteApproved: true },
    app: { bytes: app.length, sha256: hash(app) },
    rollback: { sha256: hash(rollback) },
    runtime: { allAssetBytesBelow: "0x3c1d0000", headroomBytes: 4400 },
  };
  const approvalPath = path.join(temporary, "approval.json");
  await writeFile(approvalPath, JSON.stringify(approval));
  const commands = [];
  const normal = JSON.stringify({ device: { deviceType: "knob_f1", isUsbConnection: true }, version: "0.4.1" });
  const runner = async (executable, args) => {
    commands.push([executable, ...args]);
    if (executable === process.execPath) {
      return { stdout: args[0].endsWith("enter-bootloader.mjs") ? JSON.stringify({ response: true }) : normal,
        stderr: "" };
    }
    if (args.includes("chip-id")) return { stdout: "Chip is ESP32-S3", stderr: "" };
    if (args.includes("read-mac")) return { stdout: "MAC: a4:cb:8f:af:32:10", stderr: "" };
    if (args.includes("get-security-info")) {
      return { stdout: "Secure Boot: Disabled\nFlash Encryption: Disabled", stderr: "" };
    }
    if (args.includes("flash-id")) return { stdout: "Detected flash size: 16MB", stderr: "" };
    if (args.includes("write-flash")) return { stdout: "Hash of data verified.", stderr: "" };
    throw new Error(`Unexpected simulated command ${args.join(" ")}`);
  };
  let portCalls = 0;
  const ports = async () => (++portCalls === 1 ? [] : ["/dev/cu.usbmodem-test"]);
  const result = await deployAppOnly({ appPath: appPath.pathname, rollbackPath: rollbackPath.pathname,
    approvalPath, confirmed: true, receiptDirectory: temporary }, { runner, ports, esptool: "/mock/esptool" });
  assert.equal(result.receipt.mode, "fast-smoke");
  assert.equal(result.receipt.write.hashVerifiedByEsptool, true);
  const writes = commands.filter((command) => command.includes("write-flash"));
  assert.equal(writes.length, 1);
  assert.ok(writes[0].includes("0x10000"));
  assert.ok(writes[0].includes("921600"));
});
