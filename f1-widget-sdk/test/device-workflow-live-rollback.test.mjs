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
const genericDir = path.join(root, "f1-widget-sdk/build/combined-renderer-v2-generic-input-lab");
const genericAppPath = path.join(genericDir,
  "framer-0.4.1-input-lab-renderer-v2-generic-id26-app.bin");
const genericApprovalPath = path.join(genericDir,
  "combined-renderer-v2-generic-input-lab-device-approval.json");
const genericReceiptPath = path.join(root,
  "f1-widget-sdk/build/device-receipts/device-1786939039376-fast-smoke.json");
const focusDialAppPath = path.join(root,
  "f1-widget-sdk/build/combined-renderer-v2-focus-dial/" +
  "framer-0.4.1-music-id1-wpm-id7-renderer-id26-focus-dial-app.bin");
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

test("generic structural profile pins exact bytes and accepts the re-pinned candidate", async () => {
  const [app, rollback, receipt, approvalText, focusDial, clockTimer] = await Promise.all([
    readFile(genericAppPath), readFile(blueTimerAppPath), readFile(genericReceiptPath),
    readFile(genericApprovalPath, "utf8"), readFile(focusDialAppPath), readFile(focusTimerAppPath),
  ]);
  const approval = JSON.parse(approvalText);
  // This asserted /fails the exact capability ABI/ until the approval was re-pinned on
  // 2026-08-18. The capability blacklist in device-workflow.mjs refuses one exact hash,
  // 371ee26e, "until a rebuilt module gives protocol and v1Packages independent JSON
  // storage" -- and that rebuild landed as 4e045ec2, which the pin below now requires.
  // So the profile validates, and the blacklist can no longer fire for any approval that
  // reaches it. The expectation was never updated and had been failing ever since; the
  // refusal it was guarding is now carried by the exact app pin, which the substitution
  // loop below exercises.
  assert.doesNotThrow(() => validateDeviceApproval(approval, { appBytes: app,
    rollbackBytes: rollback, rollbackReceiptBytes: receipt }));

  for (const substituted of [focusDial, clockTimer, rollback]) {
    const changed = structuredClone(approval);
    changed.app.bytes = substituted.length;
    changed.app.sha256 = sha256(substituted);
    assert.throws(() => validateDeviceApproval(changed, { appBytes: substituted,
      rollbackBytes: rollback, rollbackReceiptBytes: receipt }),
    /Generic Render-v2 approval is not pinned/u);
  }

  for (const mutate of [
    (value) => { value.deployable = false; },
    (value) => { value.runtime.maxTransportBytes = 98_303; },
    (value) => { value.runtime.maxF2epBytes = 29_823; },
    (value) => { value.runtime.renderV2Profile = "generic-unreviewed"; },
    (value) => { value.runtime.packageFormat = "framer-render-v2-package-v2"; },
    (value) => { value.runtime.v1Packages = false; },
    (value) => { value.runtime.hostRpcIds = [0xb201]; },
    (value) => { value.runtime.keyboardKeyEvents = true; },
    (value) => { value.runtime.nativeRtc = true; },
    (value) => { value.runtime.bootProgram = true; },
    (value) => { value.runtime.repeatPush = "overwrite-live-buffers"; },
    (value) => { value.runtime.ownedBundleAllocationBytes = 62_404; },
    (value) => { value.runtime.nativeEvents.hostRpc = false; },
    (value) => { value.runtime.screenIds.inputLab = 27; },
    (value) => { value.runtime.additionalScreenIds = [27]; },
    (value) => { value.runtime.integratedIromModuleSha256 = "0".repeat(64); },
    (value) => { value.runtime.wrapperCall.candidateBytes = "25ba01"; },
    (value) => { value.runtime.unreviewedCapability = true; },
    (value) => { value.unreviewedApprovalField = true; },
    (value) => { value.app.file = focusDialAppPath; },
    (value) => { value.rollback.file = focusDialAppPath; },
    (value) => { value.recovery.sha256 = "0".repeat(64); },
    (value) => {
      const inherited = { maxF2epBytes: value.runtime.maxF2epBytes,
        maxTransportBytes: value.runtime.maxTransportBytes };
      delete value.runtime.maxF2epBytes;
      delete value.runtime.maxTransportBytes;
      value.runtime["maxF2epBytes\0maxTransportBytes"] = inherited.maxF2epBytes;
      Object.setPrototypeOf(value.runtime, inherited);
    },
  ]) {
    const changed = structuredClone(approval);
    mutate(changed);
    assert.throws(() => validateDeviceApproval(changed, { appBytes: app,
      rollbackBytes: rollback, rollbackReceiptBytes: receipt }), /Generic Render-v2/u);
  }

  const substitutedReceipt = structuredClone(approval);
  substitutedReceipt.rollback.receipt.file = clockTimerReceiptPath;
  assert.throws(() => validateDeviceApproval(substitutedReceipt, { appBytes: app,
    rollbackBytes: rollback, rollbackReceiptBytes: receipt }), /receipt path\/bytes\/SHA/u);
});

test("public Input Lab flash catalog stays closed to the rejected generic candidate", async () => {
  const [source, catalogText] = await Promise.all([
    readFile(path.join(root, "f1-widget-sdk/input-lab/lib/browser-flash.mjs"), "utf8"),
    readFile(path.join(root, "f1-widget-sdk/input-lab/assets/renderer-flash-catalog.json"), "utf8"),
  ]);
  const catalog = JSON.parse(catalogText);
  assert.deepEqual(catalog, {
    format: "framer-input-lab-public-flash-catalog-v1",
    status: "DEVICE_SMOKE_CANDIDATE",
    deployable: true,
    app: { bytes: 2_062_912,
      sha256: "49cbf8801e3d86b20e0df21f41a2410b3e4d8547f8f64021ca6ed4bd85168840" },
  });
  assert.match(source, /build\/combined-renderer-id26\//u);
  assert.doesNotMatch(source, /combined-renderer-v2-generic|371ee26e/iu);
});
