import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { DEVICE_APPROVAL_FORMAT, validateDeviceApproval } from "../src/device-workflow.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const rollbackPath = path.join(root,
  "f1-widget-sdk/build/rollbacks/framer-0.4.1-live-49590ca4-focus-dial-app.bin");
const receiptPath = path.join(root,
  "f1-widget-sdk/build/device-receipts/device-1786932732117-fast-smoke.json");
const clockTimerRollbackPath = path.join(root,
  "f1-widget-sdk/build/rollbacks/framer-0.4.1-live-7838eea0-clock-timer-app.bin");
const clockTimerReceiptPath = path.join(root,
  "f1-widget-sdk/build/device-receipts/device-1786936722535-fast-smoke.json");
const focusTimerDir = path.join(root, "f1-widget-sdk/build/combined-renderer-v2-clock-timer");
const focusTimerAppPath = path.join(focusTimerDir,
  "framer-0.4.1-music-id1-wpm-id7-renderer-id26-clock-id27-timer-app.bin");
const focusTimerApprovalPath = path.join(focusTimerDir,
  "combined-renderer-v2-clock-timer-device-approval.draft.json");
const blueTimerDir = path.join(root, "f1-widget-sdk/build/combined-renderer-v2-clock-blue-timer");
const blueTimerAppPath = path.join(blueTimerDir,
  "framer-0.4.1-music-id1-wpm-id7-renderer-id26-clock-id27-blue-timer-app.bin");
const blueTimerApprovalPath = path.join(blueTimerDir,
  "combined-renderer-v2-clock-blue-timer-device-approval.draft.json");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("49590 focus-dial receipt is an exact accepted-live rollback and rejects substitutions", async () => {
  const [rollback, receipt] = await Promise.all([readFile(rollbackPath), readFile(receiptPath)]);
  const app = Buffer.from("next-render-v2-candidate", "utf8");
  const approval = {
    format: DEVICE_APPROVAL_FORMAT,
    status: "DEVICE_SMOKE_CANDIDATE",
    target: { device: "knob_f1", firmware: "0.4.1", chip: "ESP32-S3",
      mac: "a4:cb:8f:af:32:10" },
    write: { offset: "0x10000", scope: "factory-app-only", hardwareWriteApproved: true },
    app: { bytes: app.length, sha256: sha256(app) },
    rollback: { mode: "accepted-live-receipt-v1", file: rollbackPath,
      bytes: rollback.length, sha256: sha256(rollback),
      receipt: { file: receiptPath, bytes: receipt.length, sha256: sha256(receipt) } },
    runtime: { allAssetBytesBelow: "0x3c1d0000", headroomBytes: 1 },
  };

  assert.equal(validateDeviceApproval(approval, { appBytes: app, rollbackBytes: rollback,
    rollbackReceiptBytes: receipt }), approval);

  const changedReceipt = Buffer.from(receipt);
  changedReceipt[changedReceipt.length - 2] ^= 1;
  assert.throws(() => validateDeviceApproval(approval, { appBytes: app, rollbackBytes: rollback,
    rollbackReceiptBytes: changedReceipt }), /receipt bytes/u);

  const substitutedPath = structuredClone(approval);
  substitutedPath.rollback.receipt.file = path.join(root, "substituted-receipt.json");
  assert.throws(() => validateDeviceApproval(substitutedPath, { appBytes: app,
    rollbackBytes: rollback, rollbackReceiptBytes: receipt }), /receipt path\/bytes\/SHA/u);

  const changedRollback = Buffer.from(rollback);
  changedRollback[changedRollback.length - 1] ^= 1;
  assert.throws(() => validateDeviceApproval(approval, { appBytes: app,
    rollbackBytes: changedRollback, rollbackReceiptBytes: receipt }), /rollback app/u);
});

test("7838eea0 clock-timer receipt is an exact accepted-live rollback and rejects substitutions", async () => {
  const [rollback, receipt] = await Promise.all([
    readFile(clockTimerRollbackPath), readFile(clockTimerReceiptPath),
  ]);
  const app = Buffer.from("next-render-v2-clock-timer-candidate", "utf8");
  const approval = {
    format: DEVICE_APPROVAL_FORMAT,
    status: "DEVICE_SMOKE_CANDIDATE",
    target: { device: "knob_f1", firmware: "0.4.1", chip: "ESP32-S3",
      mac: "a4:cb:8f:af:32:10" },
    write: { offset: "0x10000", scope: "factory-app-only", hardwareWriteApproved: true },
    app: { bytes: app.length, sha256: sha256(app) },
    rollback: { mode: "accepted-live-receipt-v1", file: clockTimerRollbackPath,
      bytes: rollback.length, sha256: sha256(rollback),
      receipt: { file: clockTimerReceiptPath, bytes: receipt.length, sha256: sha256(receipt) } },
    runtime: { allAssetBytesBelow: "0x3c1d0000", headroomBytes: 1 },
  };

  assert.equal(validateDeviceApproval(approval, { appBytes: app, rollbackBytes: rollback,
    rollbackReceiptBytes: receipt }), approval);

  const changedReceipt = Buffer.from(receipt);
  changedReceipt[changedReceipt.length - 2] ^= 1;
  assert.throws(() => validateDeviceApproval(approval, { appBytes: app, rollbackBytes: rollback,
    rollbackReceiptBytes: changedReceipt }), /receipt bytes/u);

  const changedReceiptPath = structuredClone(approval);
  changedReceiptPath.rollback.receipt.file = receiptPath;
  assert.throws(() => validateDeviceApproval(changedReceiptPath, { appBytes: app,
    rollbackBytes: rollback, rollbackReceiptBytes: receipt }), /receipt path\/bytes\/SHA/u);

  const changedRollback = Buffer.from(rollback);
  changedRollback[changedRollback.length - 1] ^= 1;
  assert.throws(() => validateDeviceApproval(approval, { appBytes: app,
    rollbackBytes: changedRollback, rollbackReceiptBytes: receipt }), /rollback app/u);
});

test("49590 focus-timer profile accepts only the frozen package/runtime and bounded app", async () => {
  const [app, rollback, receipt, approvalText] = await Promise.all([
    readFile(focusTimerAppPath), readFile(rollbackPath), readFile(receiptPath),
    readFile(focusTimerApprovalPath, "utf8"),
  ]);
  const approval = JSON.parse(approvalText);
  assert.equal(validateDeviceApproval(approval, { appBytes: app, rollbackBytes: rollback,
    rollbackReceiptBytes: receipt }), approval);

  const changedPackage = structuredClone(approval);
  changedPackage.runtime.focusTimerPackageChunks = 30;
  assert.throws(() => validateDeviceApproval(changedPackage, { appBytes: app,
    rollbackBytes: rollback, rollbackReceiptBytes: receipt }), /package, memory, or lifecycle/u);

  const changedScreens = structuredClone(approval);
  changedScreens.runtime.screenIds.focusTimer = 28;
  assert.throws(() => validateDeviceApproval(changedScreens, { appBytes: app,
    rollbackBytes: rollback, rollbackReceiptBytes: receipt }), /navigation contract/u);

  const changedApp = Buffer.from(app);
  changedApp[changedApp.length - 1] ^= 1;
  const changedAppApproval = structuredClone(approval);
  changedAppApproval.app.sha256 = sha256(changedApp);
  assert.throws(() => validateDeviceApproval(changedAppApproval, { appBytes: changedApp,
    rollbackBytes: rollback, rollbackReceiptBytes: receipt }), /frozen candidate/u);
});

test("7838 blue-timer profile accepts only the frozen image, package, and visual contract", async () => {
  const [app, rollback, receipt, approvalText] = await Promise.all([
    readFile(blueTimerAppPath), readFile(clockTimerRollbackPath), readFile(clockTimerReceiptPath),
    readFile(blueTimerApprovalPath, "utf8"),
  ]);
  const approval = JSON.parse(approvalText);
  assert.equal(validateDeviceApproval(approval, { appBytes: app, rollbackBytes: rollback,
    rollbackReceiptBytes: receipt }), approval);

  for (const mutate of [
    (value) => { value.runtime.focusTimerPackageChunks = 31; },
    (value) => { value.runtime.focusTimerPackageLastChunkBytes = 304; },
    (value) => { value.runtime.storeHeadroomBytes = 2_768; },
    (value) => { value.runtime.timerBaseLzssSha256 = "0".repeat(64); },
    (value) => { value.runtime.timerPalette = "orange"; },
    (value) => { value.runtime.headerTopPaddingPx = 3; },
    (value) => { value.runtime.dialAnimation.cadenceMs = 500; },
    (value) => { value.runtime.dialAnimation.fnImmediate = false; },
    (value) => { value.runtime.timerHiddenPolicy = "run-while-hidden"; },
    (value) => { value.runtime.screenIds.focusTimer = 28; },
    (value) => { value.runtime.rtc.decode.sha256 = "0".repeat(64); },
    (value) => { value.runtime.integratedIromModuleSha256 = "0".repeat(64); },
  ]) {
    const changed = structuredClone(approval); mutate(changed);
    assert.throws(() => validateDeviceApproval(changed, { appBytes: app, rollbackBytes: rollback,
      rollbackReceiptBytes: receipt }), /Blue-timer/u);
  }

  const changedApp = Buffer.from(app); changedApp[changedApp.length - 1] ^= 1;
  const changedAppApproval = structuredClone(approval);
  changedAppApproval.app.sha256 = sha256(changedApp);
  assert.throws(() => validateDeviceApproval(changedAppApproval, { appBytes: changedApp,
    rollbackBytes: rollback, rollbackReceiptBytes: receipt }), /frozen candidate/u);
});
