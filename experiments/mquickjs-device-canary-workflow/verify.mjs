#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALLOCATION_MAP_ORDERING,
  KEY_NEGATIVE_HARNESS,
  KEY_TOKEN_NORMALIZATION,
  PINNED,
  TELEMETRY_SNAPSHOT_PROTOCOL,
  UI_LATENCY_METRIC,
  WORKFLOW_FORMAT,
  approvalDigest,
  assertSafeEsptoolInvocation,
  confirmationToken,
  sha256,
  validateApproval,
  validateReleaseReportAbiIdentity,
} from "./contract.mjs";
import { validateSoakRecords } from "./telemetry.mjs";
import { validateFlashReceipt } from "./soak.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const absolute = (name) => path.join(root, "experiments/mquickjs-device-canary-workflow", name);
const digest = (character) => character.repeat(64);
const artifact = (file, bytes, value, offset = undefined) => ({ file: absolute(file), bytes,
  sha256: value, ...(offset === undefined ? {} : { offset, end: offset + bytes }) });

function approvalFixture() {
  const receipt = artifact("receipt.json", PINNED.healthyReceipt.bytes, PINNED.healthyReceipt.sha256);
  const healthy = artifact("healthy.bin", PINNED.healthyApp.bytes, PINNED.healthyApp.sha256,
    PINNED.healthyApp.offset);
  return {
    format: WORKFLOW_FORMAT, status: "LINKED_STATIC_GO_PENDING_PHYSICAL", deployable: true,
    target: { device: PINNED.device, firmware: PINNED.firmware, chip: PINNED.chip,
      mac: PINNED.mac, flashBytes: PINNED.flashBytes },
    factory: { ...PINNED.factory },
    baseline: { app: { ...healthy }, receipt: { ...receipt },
      recovery: artifact("full.bin", PINNED.recovery.bytes, PINNED.recovery.sha256) },
    candidate: { app: artifact("candidate.bin", PINNED.healthyApp.bytes, digest("1"),
      PINNED.healthyApp.offset), patchProof: { reportFile: absolute("link.json"),
      reportSha256: digest("2"), ranges: [{ offset: 100, bytes: 4, end: 104,
        beforeSha256: digest("3"), afterSha256: digest("4") }] } },
    module: { slot: "A",
      text: artifact("text.bin", PINNED.module.text.bytes, digest("5"), PINNED.module.text.offset),
      rodata: artifact("rodata.bin", PINNED.module.rodata.bytes, digest("6"), PINNED.module.rodata.offset),
      deviceIdentity: { semantics:
        "sha256(text[0x210000,0x230000)+rodata[0x230000,0x240000))",
        bytes: 0x30000, sha256: digest("f") },
      slotB: { ...PINNED.module.slotB, policy: "untouched" } },
    write: { order: ["module.text", "module.rodata", "candidate.app"],
      readback: "each-region-byte-exact-before-next-write", appLast: true,
      partitionTableUnchanged: true, scope: "factory-app-plus-slot-a-only" },
    rollback: { order: ["healthy.app"], app: { ...healthy },
      residualModulePolicy: "inert-after-healthy-app-first; no erase required", receipt: { ...receipt } },
    runtime: { profile: "framer-f1-render-v2-mquickjs-v1",
      packageFormat: "framer-render-v2-mquickjs-package-v1",
      packageAbiSha256: PINNED.packageAbiSha256, moduleAbiSha256: PINNED.moduleAbiSha256,
      engineCommit: PINNED.engineCommit, generation: 19,
      rpcProtocol: "framer-f1-mquickjs-canary-rpc-v1", capabilityMethod: "widget.mquickjs.cap",
      telemetryMethod: "widget.mquickjs.telemetry", eventMethod: "widget.mquickjs.event",
      receiptMethod: "widget.mquickjs.receipt",
      telemetrySnapshotProtocol: TELEMETRY_SNAPSHOT_PROTOCOL,
      uiLatencyMetric: UI_LATENCY_METRIC,
      allocationMapOrdering: ALLOCATION_MAP_ORDERING,
      keyNegativeHarness: KEY_NEGATIVE_HARNESS,
      screens: [...PINNED.screens], rpcIds: [...PINNED.rpcIds], embedded: {
        policy: "boot-lifetime-read-only-no-uploader-no-runtime-unmap",
        canary: artifact("canary.f2js", 200, digest("8")),
        weatherFacade: artifact("weather.f2tf", 300, digest("9")),
        weatherBase: artifact("weather.lzss", 400, digest("a")),
      } },
    keyEvents: { enabled: true, mode: "fixed-token-map-v1", stockFirst: true,
      carrier: { address: "0x4206eae0", bytes: 104,
        sha256: "96316a9091816bf7290c75ebe6be76e4ed184ee13fdef6c50b77e791b5ecfa2b" },
      literal: { address: "0x42041568", bytes: 4,
        sha256: "3d5174006fa28e9caeef531cbcdec7bd1d552b0ab7ad1d4f4a8d30c44c0e1dda" },
      tokenProof: { status: "EXACT_TOKEN_MAP_PROVEN", reportFile: absolute("keys.json"),
        reportSha256: digest("b"), acceptedAppSha256: PINNED.healthyApp.sha256,
        evidence: { callbackSpanSha256:
          "96316a9091816bf7290c75ebe6be76e4ed184ee13fdef6c50b77e791b5ecfa2b",
          callbackLiteralSha256:
          "3d5174006fa28e9caeef531cbcdec7bd1d552b0ab7ad1d4f4a8d30c44c0e1dda",
          spaceInstructionSha256: digest("d"), leftShiftInstructionSha256: digest("e") },
        mappings: [{ logical: 0, nativeToken: 44 }, { logical: 1, nativeToken: 225 }],
        chordHeldMask: 3, keyTokenNormalization: KEY_TOKEN_NORMALIZATION,
        rejectedLow24Tokens: [229], postFlashObservationRequired: true, learning: null } },
    audit: { verdict: "GO", reviewer: "independent-fixture", reportFile: absolute("audit.json"),
      reportSha256: digest("c") },
    recovery: { physicalBoot: { gpio0Located: true, enLocated: true, procedureRehearsed: true,
      unrehearsedRiskAccepted: false,
      operator: "fixture", evidence: "fixture-only; no hardware action" },
      failurePolicy: "no-map-retry; disable-capability; physical-boot; restore-healthy-app-first" },
  };
}

function expectReject(mutator, pattern) {
  const value = structuredClone(approvalFixture());
  mutator(value);
  let error;
  try { validateApproval(value); } catch (caught) { error = caught; }
  if (!error || !pattern.test(error.message)) throw new Error(`Expected rejection ${pattern}, got ${error?.message}.`);
}

const approval = validateApproval(approvalFixture());
if (!confirmationToken(approval).endsWith(approvalDigest(approval).slice(0, 16).toUpperCase())) {
  throw new Error("Confirmation token is not bound to the exact approval document.");
}
expectReject((value) => { value.write.order = ["candidate.app", "module.text", "module.rodata"]; }, /ordering/iu);
expectReject((value) => { value.module.rodata.bytes = 0x20000; value.module.rodata.end = 0x250000; }, /range/iu);
expectReject((value) => { value.module.slotB.policy = "write"; }, /untouched/iu);
expectReject((value) => { value.keyEvents.tokenProof.mappings[0].nativeToken = 0x10203040; }, /synthetic/iu);
expectReject((value) => { value.keyEvents.tokenProof.keyTokenNormalization = "raw-u32"; }, /normalize/iu);
expectReject((value) => { value.keyEvents.tokenProof.rejectedLow24Tokens = []; }, /Right Shift/iu);
expectReject((value) => { value.runtime.keyNegativeHarness = "unproven"; }, /identity/iu);
expectReject((value) => { value.recovery.physicalBoot.procedureRehearsed = false; }, /recovery/iu);
// Silent downgrade is rejected; explicit accepted-unrehearsed attestation is accepted only when
// all three located/rehearsed flags are false AND the evidence names the app-RPC route.
expectReject((value) => { value.recovery.physicalBoot.unrehearsedRiskAccepted = true; }, /recovery/iu);
expectReject((value) => { Object.assign(value.recovery.physicalBoot, { gpio0Located: false,
  enLocated: false, procedureRehearsed: false, unrehearsedRiskAccepted: true,
  evidence: "no explanation" }); }, /recovery/iu);
{
  const accepted = structuredClone(approvalFixture());
  Object.assign(accepted.recovery.physicalBoot, { gpio0Located: false, enLocated: false,
    procedureRehearsed: false, unrehearsedRiskAccepted: true,
    evidence: "GPIO0/EN pads not located; recovery relies on app-RPC sendIntoBootloader route" });
  validateApproval(accepted);
  if (confirmationToken(accepted) === confirmationToken(approval)) {
    throw new Error("Accepted-unrehearsed approval must produce a distinct confirmation token.");
  }
}

const exactReleaseAbi = {
  packageAbiSha256: PINNED.packageAbiSha256,
  moduleAbiSha256: PINNED.moduleAbiSha256,
};
validateReleaseReportAbiIdentity(exactReleaseAbi, "Exact fixture report");
for (const hostileReport of [
  { ...exactReleaseAbi, moduleAbiSha256: PINNED.packageAbiSha256 },
  { ...exactReleaseAbi, packageAbiSha256: PINNED.moduleAbiSha256 },
  { packageAbiSha256: PINNED.packageAbiSha256 },
]) {
  let abiRejected = false;
  try { validateReleaseReportAbiIdentity(hostileReport, "Hostile fixture report"); }
  catch (error) { abiRejected = /distinct package and ABI3 module identities/iu.test(error.message); }
  if (!abiRejected) throw new Error("Swapped or omitted release ABI identity was not rejected.");
}

const port = "/dev/cu.usbmodem-fixture";
assertSafeEsptoolInvocation(["--chip", "esp32s3", "--port", port, "--baud", "921600", "--after",
  "no-reset", "write-flash", "--flash-size", "keep", "0x210000", approval.module.text.file],
{ operation: "write", approval, artifact: approval.module.text });
let unsafeRejected = false;
try {
  assertSafeEsptoolInvocation(["--chip", "esp32s3", "--port", port, "erase-flash"],
    { operation: "identity" });
} catch { unsafeRejected = true; }
if (!unsafeRejected) throw new Error("Destructive esptool command was not rejected.");

validateFlashReceipt({ format: "framer-f1-mquickjs-multi-region-flash-receipt-v1", mode: "flash",
  status: "PASS_FLASH_REBOOTED_CAPABILITY_SMOKE_PENDING", hardwareAccess: true,
  approvalSha256: approvalDigest(approval), target: approval.target,
  identity: { mac: PINNED.mac }, partitionTableSha256: digest("e"),
  partitionTable: { sha256: digest("e") }, order: approval.write.order,
  runtimeModuleUpdates: false, runtimeUploader: false,
  phases: [approval.module.text, approval.module.rodata, approval.candidate.app].map((artifact, index) => ({
    phase: approval.write.order[index], status: index === 2 ? "PASS_BYTE_EXACT_APP_LAST" : "PASS_BYTE_EXACT",
    write: { sha256: artifact.sha256, hashVerifiedByEsptool: true },
    readback: { offset: artifact.offset, bytes: artifact.bytes, sha256: artifact.sha256 },
  })), moduleDeviceIdentity: { ...approval.module.deviceIdentity, exact: true } }, approval, {
  approvalSha256: approvalDigest(approval), partitionTableSha256: digest("e"),
});

const boot = "0123456789abcdef";
const hex8 = (value) => (value >>> 0).toString(16).padStart(8, "0");
const hex16 = (value) => BigInt(value).toString(16).padStart(16, "0");
let rpcSample = 1;
const records = [];
const addPageSet = (method, hostTimeMs, statuses) => {
  const sample = rpcSample++;
  statuses.forEach((status, page) => records.push({ kind: "rpc", hostTimeMs, sample, method,
    request: { page }, response: { status } }));
};
const capabilityPages = [
  "v1;p=0;profile=framer-f1-render-v2-mquickjs-v1;screen=28;physical=1;proven=0;uploader=0",
  `v1;p=1;baseApp=${PINNED.healthyApp.sha256};boot=${boot}`,
  `v1;p=2;module=${approval.module.deviceIdentity.sha256};slotBytes=00030000`,
  `v1;p=3;package=${approval.runtime.embedded.canary.sha256};g=${hex8(approval.runtime.generation)}`,
  "v1;p=4;js=1;host=1;timer=1;key=1;chord=1;keyGate=live-2x-du",
  "v1;p=5;packageFormat=framer-render-v2-mquickjs-package-v1",
  `v1;p=6;packageAbiSha256=${PINNED.packageAbiSha256}`,
  `v1;p=7;engine=MicroQuickJS;engineCommit=${PINNED.engineCommit}`,
  "v1;p=8;javascriptProfile=mquickjs-es5-strict-v1;deviceEvaluatesJavaScript=1;deviceRunsJsdom=0",
  "v1;p=9;maxPackageBytes=98304;maxSourceBytes=8192;heapBytes=65536;callbackDeadlineUs=2000",
  "v1;p=10;maxHandlers=16;maxTargets=16;maxKeys=16;maxChords=8",
  `v1;p=11;moduleAbiSha256=${PINNED.moduleAbiSha256}`,
  "v1;p=12;screenIds=1,7,26,27,28;methods=0f;wdt=unsubscribed;map=bootlife",
];

const telemetry = {
  callbacks: 1, polls: 1, timeout: 0, oom: 0, exceptions: 0, maxSlice: 100,
  loads: 1, sourceRejected: 0, publishFailed: 0, wrongThread: 0, recoveries: 0,
  recoveryFailures: 0, lastResult: 0, lastSequence: 0, fatal: 0, queueDepth: 0,
  eventsQueued: 0, eventsApplied: 0, eventsRejected: 0, sequence: 0, mailboxSequence: 0,
  appliedGeneration: 19, appliedRevision: 0, delays: 1, platformFatal: 0, screen: 28,
  visible: 1, replay: 0, keyObserved: 0, token: 0, level: 0, keyGate: 0, chord: 0,
  weatherAppliedRevision: 0, free: 32_768, largest: 16_384, heap: 50_000,
  heapHigh: 50_000, stackMinimum: 3_000, uiMaximum: 100,
};
const addTelemetry = (hostTimeMs) => addPageSet(approval.runtime.telemetryMethod, hostTimeMs, [
  `v1;p=0;b=${boot};u=${hex16(BigInt(hostTimeMs) * 1000n)};f=${hex8(telemetry.free)};l=${hex8(telemetry.largest)};h=${hex8(telemetry.heap)};H=${hex8(telemetry.heapHigh)};s=${hex8(telemetry.stackMinimum)}`,
  `v1;p=1;c=${hex8(telemetry.callbacks)};p=${hex16(telemetry.polls)};d=000007d0;t=${hex8(telemetry.timeout)};o=${hex8(telemetry.oom)};x=${hex8(telemetry.exceptions)};m=${hex8(telemetry.maxSlice)}`,
  `v1;p=2;l=${hex8(telemetry.loads)};s=${hex8(telemetry.sourceRejected)};p=${hex8(telemetry.publishFailed)};w=${hex8(telemetry.wrongThread)};r=${hex8(telemetry.recoveries)};R=${hex8(telemetry.recoveryFailures)};x=${hex8(telemetry.lastResult)};n=${hex8(telemetry.lastSequence)};f=${hex8(telemetry.fatal)}`,
  `v1;p=3;q=${hex8(telemetry.queueDepth)};Q=${hex8(telemetry.eventsQueued)};A=${hex8(telemetry.eventsApplied)};R=${hex8(telemetry.eventsRejected)};n=${hex8(telemetry.sequence)};m=${hex8(telemetry.mailboxSequence)};g=${hex8(telemetry.appliedGeneration)};r=${hex8(telemetry.appliedRevision)}`,
  `v1;p=4;w=U;dt=00000001;dc=${hex8(telemetry.delays)};map=B;flash=0;nvs=0;f=${hex8(telemetry.platformFatal)}`,
  `v1;p=5;s=${hex8(telemetry.screen)};v=${telemetry.visible};y=${hex8(telemetry.replay)};k=${hex8(telemetry.keyObserved)};t=${hex8(telemetry.token)};l=${telemetry.level};G=${telemetry.keyGate};c=${telemetry.chord};r=${hex8(telemetry.weatherAppliedRevision)};U=${hex8(telemetry.uiMaximum)}`,
]);

let hostTimeMs = 1;
addTelemetry(hostTimeMs++);
for (const [index, [token, level]] of [[44, 1], [44, 0], [225, 1], [225, 0]].entries()) {
  telemetry.keyObserved += 1;
  telemetry.token = token;
  telemetry.level = level;
  telemetry.keyGate = index === 3 ? 1 : 0;
  telemetry.polls += 1;
  telemetry.delays += 1;
  addTelemetry(hostTimeMs++);
}
addPageSet(approval.runtime.capabilityMethod, hostTimeMs++, capabilityPages);
for (const [token, level, chord] of [[44, 1, 0], [44, 0, 0], [225, 1, 0], [44, 1, 1],
  [44, 0, 0], [225, 0, 0]]) {
  telemetry.keyObserved += 1;
  telemetry.token = token;
  telemetry.level = level;
  telemetry.chord = chord;
  telemetry.callbacks += 1;
  telemetry.polls += 1;
  telemetry.delays += 1;
  addTelemetry(hostTimeMs++);
}
records.push({ kind: "observation", hostTimeMs: hostTimeMs++, source: "operator",
  type: "key-rejection", normalizedLow24Token: 229, status: "stock-preserved-js-rejected",
  evidence: "static-validator-physical-right-shift-fixture" });
telemetry.keyObserved += 2;
telemetry.token = 229;
telemetry.level = 0;
telemetry.polls += 1;
telemetry.delays += 1;
addTelemetry(hostTimeMs++);

let eventSequence = 0;
const receiptStatus = (state, request, sequence, appliedRevision) =>
  `v1;s=${state};q=${state === "Q" ? "00000001" : "00000000"};seq=${hex8(sequence)};g=${hex8(request.generation)};r=${hex8(request.revision)};id=${hex8(request.id)};v=${hex8(request.value)};a=${hex8(request.auxiliary)};ag=${hex8(telemetry.appliedGeneration)};ar=${hex8(appliedRevision)}`;
const addEvent = ({ id, value, auxiliary, revision = 18 }, state = "A", appliedRevision = telemetry.appliedRevision) => {
  const request = { id, value, auxiliary, generation: approval.runtime.generation, revision };
  const sequence = ++eventSequence;
  const sample = rpcSample++;
  records.push({ kind: "rpc", hostTimeMs: hostTimeMs++, sample,
    method: approval.runtime.eventMethod, request,
    response: { status: receiptStatus("Q", request, sequence, telemetry.appliedRevision) } });
  records.push({ kind: "rpc", hostTimeMs: hostTimeMs++, sample,
    method: approval.runtime.receiptMethod, request: {},
    response: { status: receiptStatus(state, request, sequence, appliedRevision) } });
  telemetry.sequence = sequence;
  telemetry.eventsQueued += 1;
  if (state === "A") telemetry.eventsApplied += 1;
  else telemetry.eventsRejected += 1;
  return sequence;
};

for (const request of [
  { id: 0xb240, value: 18, auxiliary: 0 },
  { id: 0xb241, value: 0x00480001, auxiliary: 18 },
  { id: 0xb242, value: 0x013c4b01, auxiliary: 18 },
  { id: 0xb243, value: 0x023a4705, auxiliary: 18 },
  { id: 0xb244, value: 0x03fc0c06, auxiliary: 18 },
  { id: 0xb24d, value: 1, auxiliary: 30 },
  { id: 0xb24e, value: 0, auxiliary: 0 },
]) addEvent(request);
addEvent({ id: 0xb24f, value: 18, auxiliary: 15 }, "A", 18);
telemetry.appliedRevision = 18;
telemetry.weatherAppliedRevision = 18;
telemetry.mailboxSequence += 1;
telemetry.lastSequence = eventSequence;
addTelemetry(hostTimeMs++);

for (const fault of [
  { value: -0x80000000, auxiliary: 0x54494d45, result: -6, counter: "timeout" },
  { value: -0x7fffffff, auxiliary: 0x4f4f4d21, result: -7, counter: "oom" },
]) {
  const sequence = addEvent({ id: 0xb24d, value: fault.value, auxiliary: fault.auxiliary }, "F", 18);
  telemetry[fault.counter] += 1;
  telemetry.recoveries += 1;
  telemetry.lastResult = fault.result;
  telemetry.lastSequence = sequence;
  telemetry.maxSlice = 8_000;
  addTelemetry(hostTimeMs++);
  addEvent({ id: 0xb24d, value: 0, auxiliary: 0 }, "A", 18);
  telemetry.lastResult = 0;
  telemetry.lastSequence = eventSequence;
  addTelemetry(hostTimeMs++);
}

for (const id of PINNED.screens) records.push({ kind: "observation", hostTimeMs: hostTimeMs++,
  source: "operator", type: "screen", screenId: id, status: "rendered-nonblack",
  evidence: `static-validator-camera-fixture-screen-${id}` });
telemetry.callbacks = 40_000;
telemetry.polls = 36_000;
telemetry.delays = 36_000;
telemetry.heap = 50_500;
telemetry.heapHigh = 62_000;
telemetry.uiMaximum = 90_000;
telemetry.screen = 28;
telemetry.token = 225;
telemetry.level = 0;
telemetry.chord = 0;
addTelemetry(3_600_001);

const soak = validateSoakRecords(records, approval, { maximumSampleGapMs: 3_600_000,
  flashReceiptSha256: digest("0") });
if (soak.status !== "PASS_PHYSICAL_MQUICKJS_ONE_HOUR_CANARY_SOAK") {
  throw new Error("Synthetic raw-RPC soak gate failed.");
}
const outOfOrderTelemetry = structuredClone(records);
const firstTelemetry = outOfOrderTelemetry.findIndex(({ method }) =>
  method === approval.runtime.telemetryMethod);
[outOfOrderTelemetry[firstTelemetry], outOfOrderTelemetry[firstTelemetry + 1]] =
  [outOfOrderTelemetry[firstTelemetry + 1], outOfOrderTelemetry[firstTelemetry]];
let tornSessionRejected = false;
try {
  validateSoakRecords(outOfOrderTelemetry, approval, { maximumSampleGapMs: 3_600_000,
    flashReceiptSha256: digest("0") });
} catch (error) { tornSessionRejected = /out of order/iu.test(error.message); }
if (!tornSessionRejected) throw new Error("Out-of-order telemetry page session was not rejected.");

const expectSoakReject = (mutated, pattern, label) => {
  let rejected = false;
  try {
    validateSoakRecords(mutated, approval, { maximumSampleGapMs: 3_600_000,
      flashReceiptSha256: digest("0") });
  } catch (error) { rejected = pattern.test(error.message); }
  if (!rejected) throw new Error(`${label} was not rejected by the synthetic soak gate.`);
};
const firstDiscovery = records.find(({ method, response }) => method === approval.runtime.telemetryMethod &&
  response.status.includes(";t=0000002c;l=1;G=0;"));
expectSoakReject(records.filter(({ sample }) => sample !== firstDiscovery.sample), /discovery edges/iu,
  "Missing discovery edge");
expectSoakReject(records.filter(({ type }) => type !== "key-rejection"), /Right Shift/iu,
  "Missing Right Shift physical action");
const admittedRightShift = structuredClone(records);
const rightShiftP5 = admittedRightShift.find(({ method, response }) =>
  method === approval.runtime.telemetryMethod && response.status.includes(";t=000000e5;l=0;G=1;"));
rightShiftP5.response.status = rightShiftP5.response.status.replace("t=000000e5", "t=000000e1");
expectSoakReject(admittedRightShift, /Right Shift/iu, "Right Shift JS admission");

const healthyFile = path.join(root,
  "f1-widget-sdk/build/combined-renderer-v2-clock-blue-timer/" +
  "framer-0.4.1-music-id1-wpm-id7-renderer-id26-clock-id27-blue-timer-app.bin");
const receiptFile = path.join(root,
  "f1-widget-sdk/build/device-receipts/device-1786939039376-fast-smoke.json");
const recoveryFile = path.join(root,
  "recovery/backups/2026-08-15-framer-f1-a4cb8faf3210-before-custom/full-flash-16mb.bin");
const [healthyBytes, receiptBytes, recoveryBytes] = await Promise.all([
  readFile(healthyFile), readFile(receiptFile), readFile(recoveryFile),
]);
if (healthyBytes.length !== PINNED.healthyApp.bytes || sha256(healthyBytes) !== PINNED.healthyApp.sha256 ||
    receiptBytes.length !== PINNED.healthyReceipt.bytes || sha256(receiptBytes) !== PINNED.healthyReceipt.sha256 ||
    recoveryBytes.length !== PINNED.recovery.bytes || sha256(recoveryBytes) !== PINNED.recovery.sha256) {
  throw new Error("Healthy app, receipt, or full-flash recovery identity changed.");
}

process.stdout.write(JSON.stringify({
  status: "PASS_GUARDED_WORKFLOW_STATIC_NO_HARDWARE",
  hardwareAccess: false,
  healthyAppSha256: PINNED.healthyApp.sha256,
  healthyReceiptSha256: PINNED.healthyReceipt.sha256,
  recoverySha256: PINNED.recovery.sha256,
  factoryRange: ["0x10000", "0x810000"],
  appRange: ["0x10000", "0x207a40"],
  appEraseRange: ["0x10000", "0x208000"],
  moduleTextRange: ["0x210000", "0x230000"],
  moduleRodataRange: ["0x230000", "0x240000"],
  untouchedSlotB: ["0x240000", "0x270000"],
  appToModuleEraseGapBytes: 0x8000,
  writeOrder: ["module.text", "module.rodata", "candidate.app"],
  rollbackOrder: ["healthy.app"],
  staticMutationRejects: 12,
  syntheticSoakValidator: "PASS_WITH_4_HOSTILE_MUTATIONS_REJECTED",
  physicalCandidate: "WAITING_FOR_LINK_HASHES_KEY_TOKEN_PROOF_INDEPENDENT_AUDIT_GPIO0_REHEARSAL_OR_ACCEPTED_UNREHEARSED",
}, null, 2) + "\n");
