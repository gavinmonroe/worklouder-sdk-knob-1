import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { inspectEsp32AppImage } from "../../custom-firmware/lib/esp-app-image.mjs";
import { decodeRenderV2MQuickJsPackage } from "../../f1-widget-sdk/src/render-v2/mquickjs.mjs";

export const WORKFLOW_FORMAT = "framer-f1-mquickjs-multi-region-candidate-v1";
export const RECEIPT_FORMAT = "framer-f1-mquickjs-multi-region-flash-receipt-v1";
export const TELEMETRY_FORMAT = "framer-f1-mquickjs-telemetry-v1";
export const SOAK_RECEIPT_FORMAT = "framer-f1-mquickjs-soak-receipt-v1";
export const TELEMETRY_SNAPSHOT_PROTOCOL =
  "p0-locks-snapshot-ordered-p1-p5-expiry-clear-v1";
export const UI_LATENCY_METRIC =
  "id28-full-proxy-tick-oldtick-base-lzss-f2tf-publish-us-v1";
export const KEY_TOKEN_NORMALIZATION = "raw-low24-after-stock-first-v1";
export const ALLOCATION_MAP_ORDERING =
  "internal-block-before-first-mmu-map-adopt-or-rollback-v1";
export const KEY_NEGATIVE_HARNESS = "low24-e5-observed-never-mapped-pass-v1";

export const PINNED = Object.freeze({
  device: "knob_f1",
  firmware: "0.4.1",
  chip: "ESP32-S3",
  mac: "a4:cb:8f:af:32:10",
  flashBytes: 0x1000000,
  factory: Object.freeze({ offset: 0x10000, bytes: 0x800000, end: 0x810000 }),
  partitionTable: Object.freeze({ offset: 0x8000, bytes: 0x1000 }),
  healthyApp: Object.freeze({
    offset: 0x10000,
    bytes: 2_062_912,
    end: 0x207a40,
    sha256: "363170139a06f306be1e894b6f203a9bf03bf4d70d21194aaccdd1c42f760c32",
  }),
  healthyReceipt: Object.freeze({
    bytes: 2_414,
    sha256: "1363d31eabba2b61e068d760d966ab25f8b17d1c635a4c91ba7ecd2a0de238e9",
  }),
  recovery: Object.freeze({
    bytes: 16_777_216,
    sha256: "aa6042310d075c9cbd3b992044511c064bb4b84713d0740a3adafcbdb3028fdd",
  }),
  module: Object.freeze({
    slot: "A",
    text: Object.freeze({
      offset: 0x210000,
      bytes: 0x20000,
      end: 0x230000,
      sha256: null,
    }),
    rodata: Object.freeze({
      offset: 0x230000,
      bytes: 0x10000,
      end: 0x240000,
      sha256: null,
    }),
    slotB: Object.freeze({ offset: 0x240000, bytes: 0x30000, end: 0x270000 }),
  }),
  packageAbiSha256: "5091736403d809078cbbf12a1b593fbabaff53474a0935a7e00ce81dc8bd67f8",
  moduleAbiSha256: "ad484a3a8b438c51f6bbcda6ea871110735b3460e39e4c2853a4e636f5f728cb",
  engineCommit: "203d5bb79789bc47b74855d9207415dab71661a0",
  screens: Object.freeze([1, 7, 26, 27, 28]),
  rpcIds: Object.freeze([
    0xb240, 0xb241, 0xb242, 0xb243, 0xb244, 0xb24d, 0xb24e, 0xb24f,
  ]),
});

export const WRITE_ORDER = Object.freeze(["module.text", "module.rodata", "candidate.app"]);
export const ROLLBACK_ORDER = Object.freeze(["healthy.app"]);

const HEX_64 = /^[0-9a-f]{64}$/u;
const PORT = /^\/dev\/cu\.(?:usbmodem|usbserial)[A-Za-z0-9._-]+$/u;
const FORBIDDEN_TOOL_ARGS = new Set([
  "erase-flash", "erase-region", "erase-all", "--erase-all", "--force", "--encrypt",
  "--ignore-flash-enc-efuse", "merge-bin", "--no-verify",
]);

export const invariant = (condition, message) => {
  if (!condition) throw new Error(message);
};

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const hex = (value) => `0x${value.toString(16)}`;
export const alignUp = (value, alignment) => Math.ceil(value / alignment) * alignment;

function exactKeys(value, expected, label) {
  invariant(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object.`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  invariant(JSON.stringify(actual) === JSON.stringify(wanted), `${label} keys changed.`);
}

function validateDigest(value, label) {
  invariant(HEX_64.test(value ?? ""), `${label} must be a lowercase SHA-256.`);
}

function validateArtifact(value, expected, label) {
  exactKeys(value, ["file", "offset", "bytes", "end", "sha256"], label);
  invariant(typeof value.file === "string" && path.isAbsolute(value.file), `${label}.file must be absolute.`);
  invariant(value.offset === expected.offset && value.bytes === expected.bytes && value.end === expected.end,
    `${label} range changed.`);
  validateDigest(value.sha256, `${label}.sha256`);
  if (expected.sha256) invariant(value.sha256 === expected.sha256, `${label} digest changed.`);
}

function disjoint(first, second) {
  return first.end <= second.offset || second.end <= first.offset;
}

export function approvalDigest(approval) {
  const canonical = JSON.stringify(approval, null, 2) + "\n";
  return sha256(Buffer.from(canonical));
}

export function confirmationToken(approval) {
  return `FLASH_MQUICKJS_CANARY_A4CB8FAF3210_${approvalDigest(approval).slice(0, 16).toUpperCase()}`;
}

export function rollbackConfirmationToken(approval) {
  return `RESTORE_HEALTHY_APP_A4CB8FAF3210_${approvalDigest(approval).slice(0, 16).toUpperCase()}`;
}

export function validateReleaseReportAbiIdentity(report, label = "Release report") {
  invariant(report && typeof report === "object" &&
    report.packageAbiSha256 === PINNED.packageAbiSha256 &&
    report.moduleAbiSha256 === PINNED.moduleAbiSha256 &&
    report.packageAbiSha256 !== report.moduleAbiSha256,
  `${label} must pin the distinct package and ABI3 module identities.`);
  return report;
}

export function validateApproval(approval, { requireIndependentAudit = true } = {}) {
  exactKeys(approval, [
    "format", "status", "deployable", "target", "factory", "baseline", "candidate", "module",
    "write", "rollback", "runtime", "keyEvents", "audit", "recovery",
  ], "approval");
  invariant(approval.format === WORKFLOW_FORMAT, "Approval format changed.");
  invariant(approval.status === "LINKED_STATIC_GO_PENDING_PHYSICAL" && approval.deployable === true,
    "Approval is not a linked, deployable static candidate.");

  exactKeys(approval.target, ["device", "firmware", "chip", "mac", "flashBytes"], "approval.target");
  invariant(approval.target.device === PINNED.device && approval.target.firmware === PINNED.firmware &&
    approval.target.chip === PINNED.chip && approval.target.mac === PINNED.mac &&
    approval.target.flashBytes === PINNED.flashBytes, "Approval target differs from the same-device proof.");

  exactKeys(approval.factory, ["offset", "bytes", "end"], "approval.factory");
  invariant(approval.factory.offset === PINNED.factory.offset && approval.factory.bytes === PINNED.factory.bytes &&
    approval.factory.end === PINNED.factory.end, "Factory partition changed.");

  exactKeys(approval.baseline, ["app", "receipt", "recovery"], "approval.baseline");
  validateArtifact(approval.baseline.app, PINNED.healthyApp, "approval.baseline.app");
  exactKeys(approval.baseline.receipt, ["file", "bytes", "sha256"], "approval.baseline.receipt");
  invariant(path.isAbsolute(approval.baseline.receipt.file) &&
    approval.baseline.receipt.bytes === PINNED.healthyReceipt.bytes &&
    approval.baseline.receipt.sha256 === PINNED.healthyReceipt.sha256,
  "Healthy physical receipt changed.");
  exactKeys(approval.baseline.recovery, ["file", "bytes", "sha256"], "approval.baseline.recovery");
  invariant(path.isAbsolute(approval.baseline.recovery.file) &&
    approval.baseline.recovery.bytes === PINNED.recovery.bytes &&
    approval.baseline.recovery.sha256 === PINNED.recovery.sha256,
  "Full-flash recovery changed.");

  exactKeys(approval.candidate, ["app", "patchProof"], "approval.candidate");
  validateArtifact(approval.candidate.app, {
    offset: PINNED.factory.offset,
    bytes: approval.candidate.app.bytes,
    end: PINNED.factory.offset + approval.candidate.app.bytes,
  }, "approval.candidate.app");
  invariant(approval.candidate.app.bytes === PINNED.healthyApp.bytes,
    "Canary app must retain the accepted standalone-app byte length.");
  invariant(approval.candidate.app.sha256 !== PINNED.healthyApp.sha256,
    "Canary app is byte-identical to the healthy rollback app.");
  exactKeys(approval.candidate.patchProof, ["reportFile", "reportSha256", "ranges"],
    "approval.candidate.patchProof");
  invariant(path.isAbsolute(approval.candidate.patchProof.reportFile),
    "Candidate patch proof report must use an absolute path.");
  validateDigest(approval.candidate.patchProof.reportSha256,
    "approval.candidate.patchProof.reportSha256");
  invariant(Array.isArray(approval.candidate.patchProof.ranges) &&
    approval.candidate.patchProof.ranges.length > 0 && approval.candidate.patchProof.ranges.length <= 64,
  "Candidate patch proof requires 1..64 exact ranges.");
  let previousPatchEnd = 0;
  for (const [index, range] of approval.candidate.patchProof.ranges.entries()) {
    exactKeys(range, ["offset", "bytes", "end", "beforeSha256", "afterSha256"],
      `approval.candidate.patchProof.ranges[${index}]`);
    invariant(Number.isInteger(range.offset) && Number.isInteger(range.bytes) && range.bytes > 0 &&
      range.end === range.offset + range.bytes && range.offset >= previousPatchEnd &&
      range.end <= approval.candidate.app.bytes,
    "Candidate patch ranges must be sorted, non-overlapping, nonempty, and inside the app file.");
    validateDigest(range.beforeSha256, "Candidate patch before SHA-256");
    validateDigest(range.afterSha256, "Candidate patch after SHA-256");
    invariant(range.beforeSha256 !== range.afterSha256, "A candidate patch range does not change bytes.");
    previousPatchEnd = range.end;
  }

  exactKeys(approval.module, ["slot", "text", "rodata", "deviceIdentity", "slotB"], "approval.module");
  invariant(approval.module.slot === "A", "This approval profile selects only immutable slot A.");
  validateArtifact(approval.module.text, PINNED.module.text, "approval.module.text");
  validateArtifact(approval.module.rodata, PINNED.module.rodata, "approval.module.rodata");
  exactKeys(approval.module.deviceIdentity, ["semantics", "bytes", "sha256"],
    "approval.module.deviceIdentity");
  invariant(approval.module.deviceIdentity.semantics ===
    "sha256(text[0x210000,0x230000)+rodata[0x230000,0x240000))" &&
    approval.module.deviceIdentity.bytes === 0x30000,
  "Device module identity must cover the exact complete slot-A text+rodata bytes.");
  validateDigest(approval.module.deviceIdentity.sha256, "approval.module.deviceIdentity.sha256");
  exactKeys(approval.module.slotB, ["offset", "bytes", "end", "policy"], "approval.module.slotB");
  invariant(approval.module.slotB.offset === PINNED.module.slotB.offset &&
    approval.module.slotB.bytes === PINNED.module.slotB.bytes &&
    approval.module.slotB.end === PINNED.module.slotB.end && approval.module.slotB.policy === "untouched",
  "Slot B must remain untouched.");

  const appErase = { offset: approval.candidate.app.offset,
    end: alignUp(approval.candidate.app.end, 0x1000) };
  invariant(approval.candidate.app.offset >= PINNED.factory.offset &&
    approval.candidate.app.end <= PINNED.factory.end &&
    approval.module.text.offset >= PINNED.factory.offset &&
    approval.module.rodata.end <= PINNED.factory.end,
  "A write escaped the factory partition.");
  invariant(disjoint(appErase, approval.module.text) && disjoint(approval.module.text, approval.module.rodata) &&
    disjoint(approval.module.rodata, approval.module.slotB),
  "App erase sectors, module pages, or untouched slot B overlap.");
  invariant(approval.candidate.app.end === 0x207a40 && appErase.end === 0x208000 &&
    approval.module.text.offset - appErase.end === 0x8000,
  "The frozen 32 KiB erase-safe gap before slot A changed.");

  exactKeys(approval.write, ["order", "readback", "appLast", "partitionTableUnchanged", "scope"],
    "approval.write");
  invariant(JSON.stringify(approval.write.order) === JSON.stringify(WRITE_ORDER) &&
    approval.write.readback === "each-region-byte-exact-before-next-write" &&
    approval.write.appLast === true && approval.write.partitionTableUnchanged === true &&
    approval.write.scope === "factory-app-plus-slot-a-only",
  "Write ordering or readback policy changed.");

  exactKeys(approval.rollback, ["order", "app", "residualModulePolicy", "receipt"], "approval.rollback");
  invariant(JSON.stringify(approval.rollback.order) === JSON.stringify(ROLLBACK_ORDER) &&
    approval.rollback.residualModulePolicy === "inert-after-healthy-app-first; no erase required",
  "Rollback must restore the healthy app first and leave module pages inert.");
  validateArtifact(approval.rollback.app, PINNED.healthyApp, "approval.rollback.app");
  invariant(approval.rollback.receipt.sha256 === PINNED.healthyReceipt.sha256,
    "Rollback receipt is not the healthy same-device receipt.");
  exactKeys(approval.rollback.receipt, ["file", "bytes", "sha256"], "approval.rollback.receipt");
  invariant(path.isAbsolute(approval.rollback.receipt.file) &&
    approval.rollback.receipt.bytes === PINNED.healthyReceipt.bytes,
  "Rollback receipt path/length changed.");

  exactKeys(approval.runtime, [
    "profile", "packageFormat", "packageAbiSha256", "moduleAbiSha256", "engineCommit", "generation",
    "rpcProtocol", "capabilityMethod", "telemetryMethod", "eventMethod", "receiptMethod",
    "telemetrySnapshotProtocol", "uiLatencyMetric", "allocationMapOrdering", "keyNegativeHarness",
    "screens", "rpcIds", "embedded",
  ], "approval.runtime");
  invariant(approval.runtime.profile === "framer-f1-render-v2-mquickjs-v1" &&
    approval.runtime.packageFormat === "framer-render-v2-mquickjs-package-v1" &&
    approval.runtime.packageAbiSha256 === PINNED.packageAbiSha256 &&
    approval.runtime.moduleAbiSha256 === PINNED.moduleAbiSha256 &&
    approval.runtime.engineCommit === PINNED.engineCommit && approval.runtime.generation === 19 &&
    approval.runtime.rpcProtocol === "framer-f1-mquickjs-canary-rpc-v1" &&
    approval.runtime.telemetrySnapshotProtocol === TELEMETRY_SNAPSHOT_PROTOCOL &&
    approval.runtime.uiLatencyMetric === UI_LATENCY_METRIC &&
    approval.runtime.allocationMapOrdering === ALLOCATION_MAP_ORDERING &&
    approval.runtime.keyNegativeHarness === KEY_NEGATIVE_HARNESS,
  "Runtime ABI identity changed.");
  invariant(approval.runtime.capabilityMethod === "widget.mquickjs.cap" &&
    approval.runtime.telemetryMethod === "widget.mquickjs.telemetry" &&
    approval.runtime.eventMethod === "widget.mquickjs.event" &&
    approval.runtime.receiptMethod === "widget.mquickjs.receipt" &&
    JSON.stringify(approval.runtime.screens) === JSON.stringify(PINNED.screens) &&
    JSON.stringify(approval.runtime.rpcIds) === JSON.stringify(PINNED.rpcIds),
  "Runtime methods, screens, or declared RPC IDs changed.");
  exactKeys(approval.runtime.embedded, ["policy", "canary", "weatherFacade", "weatherBase"],
    "approval.runtime.embedded");
  invariant(approval.runtime.embedded.policy === "boot-lifetime-read-only-no-uploader-no-runtime-unmap",
    "Initial canary must use only boot-lifetime embedded packages.");
  for (const [name, artifact] of Object.entries(approval.runtime.embedded)) {
    if (name === "policy") continue;
    exactKeys(artifact, ["file", "bytes", "sha256"], `approval.runtime.embedded.${name}`);
    invariant(path.isAbsolute(artifact.file) && Number.isInteger(artifact.bytes) && artifact.bytes > 0,
      `Embedded ${name} artifact identity is incomplete.`);
    validateDigest(artifact.sha256, `approval.runtime.embedded.${name}.sha256`);
  }

  exactKeys(approval.keyEvents, ["enabled", "mode", "stockFirst", "carrier", "literal", "tokenProof"],
    "approval.keyEvents");
  invariant(approval.keyEvents.enabled === true && approval.keyEvents.stockFirst === true,
    "Physical key events are mandatory and must preserve stock-first delivery.");
  invariant(approval.keyEvents.mode === "fixed-token-map-v1",
    "This linked canary requires the exact fixed low-24-bit token map.");
  exactKeys(approval.keyEvents.carrier, ["address", "bytes", "sha256"], "approval.keyEvents.carrier");
  invariant(approval.keyEvents.carrier.address === "0x4206eae0" &&
    approval.keyEvents.carrier.bytes === 104 && approval.keyEvents.carrier.sha256 ===
      "96316a9091816bf7290c75ebe6be76e4ed184ee13fdef6c50b77e791b5ecfa2b",
  "Stock-first key carrier changed.");
  exactKeys(approval.keyEvents.literal, ["address", "bytes", "sha256"], "approval.keyEvents.literal");
  invariant(approval.keyEvents.literal.address === "0x42041568" &&
    approval.keyEvents.literal.bytes === 4 && approval.keyEvents.literal.sha256 ===
      "3d5174006fa28e9caeef531cbcdec7bd1d552b0ab7ad1d4f4a8d30c44c0e1dda",
  "Key callback literal carrier changed.");
  exactKeys(approval.keyEvents.tokenProof,
    ["status", "reportFile", "reportSha256", "acceptedAppSha256", "evidence", "mappings",
      "chordHeldMask", "keyTokenNormalization", "rejectedLow24Tokens",
      "postFlashObservationRequired", "learning"],
    "approval.keyEvents.tokenProof");
  invariant(path.isAbsolute(approval.keyEvents.tokenProof.reportFile) &&
    approval.keyEvents.tokenProof.acceptedAppSha256 === PINNED.healthyApp.sha256,
  "Key events cannot use a proof from another accepted app.");
  validateDigest(approval.keyEvents.tokenProof.reportSha256,
    "approval.keyEvents.tokenProof.reportSha256");
  exactKeys(approval.keyEvents.tokenProof.evidence, ["callbackSpanSha256", "callbackLiteralSha256",
    "spaceInstructionSha256", "leftShiftInstructionSha256"], "approval.keyEvents.tokenProof.evidence");
  invariant(approval.keyEvents.tokenProof.evidence.callbackSpanSha256 ===
    approval.keyEvents.carrier.sha256 &&
    approval.keyEvents.tokenProof.evidence.callbackLiteralSha256 === approval.keyEvents.literal.sha256,
  "Key proof callback span/literal identity changed.");
  validateDigest(approval.keyEvents.tokenProof.evidence.spaceInstructionSha256,
    "Space comparison instruction SHA-256");
  validateDigest(approval.keyEvents.tokenProof.evidence.leftShiftInstructionSha256,
    "Left Shift comparison instruction SHA-256");
  invariant(approval.keyEvents.tokenProof.chordHeldMask === 3 &&
    approval.keyEvents.tokenProof.keyTokenNormalization === KEY_TOKEN_NORMALIZATION &&
    JSON.stringify(approval.keyEvents.tokenProof.rejectedLow24Tokens) === JSON.stringify([229]) &&
    approval.keyEvents.tokenProof.postFlashObservationRequired === true,
  "Canary keys must normalize raw low24 after stock-first, reject Right Shift, form held-mask 3, " +
  "and require post-flash observation confirmation.");
  invariant(Array.isArray(approval.keyEvents.tokenProof.mappings), "Key mappings must be an array.");
  const nativeTokens = new Set();
  approval.keyEvents.tokenProof.mappings.forEach((mapping, index) => {
    exactKeys(mapping, ["logical", "nativeToken"], `approval.keyEvents.tokenProof.mappings[${index}]`);
    invariant(mapping.logical === index && Number.isInteger(mapping.nativeToken) &&
      mapping.nativeToken >= 0 && mapping.nativeToken <= 0xffffffff &&
      ![0x10203040, 0x50607080].includes(mapping.nativeToken) && !nativeTokens.has(mapping.nativeToken),
    "Native key tokens must be unique, contiguous, real values—not the synthetic SDK fixtures.");
    nativeTokens.add(mapping.nativeToken);
  });
  invariant(approval.keyEvents.tokenProof.status === "EXACT_TOKEN_MAP_PROVEN" &&
    approval.keyEvents.tokenProof.mappings.length === 2 &&
    approval.keyEvents.tokenProof.mappings[0].nativeToken === 44 &&
    approval.keyEvents.tokenProof.mappings[1].nativeToken === 225 &&
    approval.keyEvents.tokenProof.learning === null,
  "Fixed token map must be exact normalized low24 logical 0=HID Space(44), " +
  "logical 1=Left Shift(225), with no runtime-learning ambiguity.");

  exactKeys(approval.audit, ["verdict", "reviewer", "reportFile", "reportSha256"], "approval.audit");
  if (requireIndependentAudit) {
    invariant(approval.audit.verdict === "GO" && typeof approval.audit.reviewer === "string" &&
      approval.audit.reviewer.length > 0 && path.isAbsolute(approval.audit.reportFile),
    "An independent static GO report is required.");
    validateDigest(approval.audit.reportSha256, "approval.audit.reportSha256");
  }

  exactKeys(approval.recovery, ["physicalBoot", "failurePolicy"], "approval.recovery");
  exactKeys(approval.recovery.physicalBoot,
    ["gpio0Located", "enLocated", "procedureRehearsed", "operator", "evidence"],
    "approval.recovery.physicalBoot");
  invariant(approval.recovery.physicalBoot.gpio0Located === true &&
    approval.recovery.physicalBoot.enLocated === true &&
    approval.recovery.physicalBoot.procedureRehearsed === true &&
    typeof approval.recovery.physicalBoot.operator === "string" &&
    approval.recovery.physicalBoot.operator.length > 0 &&
    typeof approval.recovery.physicalBoot.evidence === "string" &&
    approval.recovery.physicalBoot.evidence.length > 0,
  "Physical GPIO0/BOOT + EN recovery must be located and rehearsed before the canary write.");
  invariant(approval.recovery.failurePolicy ===
    "no-map-retry; disable-capability; physical-boot; restore-healthy-app-first",
  "Failure policy changed.");
  return approval;
}

export async function verifyApprovalFiles(approval, options = {}) {
  validateApproval(approval, options);
  const artifacts = [
    [approval.baseline.app, "healthy app"],
    [approval.baseline.receipt, "healthy receipt"],
    [approval.baseline.recovery, "full-flash recovery"],
    [approval.candidate.app, "candidate app"],
    [{ file: approval.candidate.patchProof.reportFile,
      sha256: approval.candidate.patchProof.reportSha256 }, "candidate patch proof"],
    [approval.module.text, "module text"],
    [approval.module.rodata, "module rodata"],
    [approval.rollback.app, "rollback app"],
    [approval.rollback.receipt, "rollback receipt"],
    [approval.keyEvents.tokenProof && {
      file: approval.keyEvents.tokenProof.reportFile,
      sha256: approval.keyEvents.tokenProof.reportSha256,
    }, "key token proof"],
  ];
  for (const [name, artifact] of Object.entries(approval.runtime.embedded)) {
    if (name !== "policy") artifacts.push([artifact, `embedded ${name}`]);
  }
  if (options.requireIndependentAudit !== false) {
    artifacts.push([{ file: approval.audit.reportFile, sha256: approval.audit.reportSha256 },
      "independent audit report"]);
  }
  for (const [artifact, label] of artifacts) {
    const bytes = await readFile(path.resolve(artifact.file));
    if (artifact.bytes !== undefined) invariant(bytes.length === artifact.bytes, `${label} length changed.`);
    invariant(sha256(bytes) === artifact.sha256, `${label} SHA-256 changed.`);
  }
  const link = JSON.parse(await readFile(approval.candidate.patchProof.reportFile, "utf8"));
  validateReleaseReportAbiIdentity(link, "Linked physical candidate report");
  invariant(link.telemetrySnapshotProtocol === TELEMETRY_SNAPSHOT_PROTOCOL,
    "Linked physical candidate lacks the exact coherent telemetry snapshot protocol proof.");
  invariant(link.uiLatencyMetric === UI_LATENCY_METRIC,
    "Linked physical candidate lacks the exact full ID28 proxy-tick latency metric proof.");
  invariant(link.allocationMapOrdering === ALLOCATION_MAP_ORDERING,
    "Linked physical candidate lacks the exact allocation-before-map rollback proof.");
  invariant(link.keyTokenNormalization === KEY_TOKEN_NORMALIZATION &&
    JSON.stringify(link.mappings) === JSON.stringify([
      { logical: 0, nativeToken: 44 }, { logical: 1, nativeToken: 225 },
    ]) && link.chordHeldMask === 3 &&
    JSON.stringify(link.rejectedLow24Tokens) === JSON.stringify([229]),
  "Linked physical candidate lacks the exact normalized key/chord/Right Shift rejection proof.");
  invariant(link.keyNegativeHarness === KEY_NEGATIVE_HARNESS,
    "Linked physical candidate lacks the exact low24 e5 negative harness proof.");
  if (options.requireIndependentAudit !== false) {
    const audit = JSON.parse(await readFile(approval.audit.reportFile, "utf8"));
    validateReleaseReportAbiIdentity(audit, "Independent audit report");
    invariant(audit.telemetrySnapshotProtocol === TELEMETRY_SNAPSHOT_PROTOCOL,
      "Independent audit did not pin the coherent telemetry snapshot protocol.");
    invariant(audit.uiLatencyMetric === UI_LATENCY_METRIC,
      "Independent audit did not pin the full ID28 proxy-tick latency metric.");
    invariant(audit.allocationMapOrdering === ALLOCATION_MAP_ORDERING,
      "Independent audit did not pin allocation-before-map rollback ordering.");
    invariant(audit.keyTokenNormalization === KEY_TOKEN_NORMALIZATION &&
      JSON.stringify(audit.mappings) === JSON.stringify([
        { logical: 0, nativeToken: 44 }, { logical: 1, nativeToken: 225 },
      ]) && audit.chordHeldMask === 3 &&
      JSON.stringify(audit.rejectedLow24Tokens) === JSON.stringify([229]),
    "Independent audit did not pin normalized key/chord/Right Shift rejection semantics.");
    invariant(audit.keyNegativeHarness === KEY_NEGATIVE_HARNESS,
      "Independent audit did not pin the exact low24 e5 negative harness proof.");
  }
  const [healthyApp, candidateApp, moduleText, moduleRodata] = await Promise.all([
    readFile(approval.baseline.app.file), readFile(approval.candidate.app.file),
    readFile(approval.module.text.file), readFile(approval.module.rodata.file),
  ]);
  invariant(sha256(Buffer.concat([moduleText, moduleRodata])) === approval.module.deviceIdentity.sha256,
    "Device-emitted module identity does not match the complete approved module pages.");
  const healthyImage = inspectEsp32AppImage(healthyApp);
  const candidateImage = inspectEsp32AppImage(candidateApp);
  invariant(healthyImage.segmentCount === 6 && candidateImage.segmentCount === healthyImage.segmentCount,
    "Candidate must retain the exact accepted six-segment app shape.");
  for (let index = 0; index < healthyImage.segmentCount; index += 1) {
    const before = healthyImage.segments[index];
    const after = candidateImage.segments[index];
    invariant(after.loadAddress === before.loadAddress && after.length === before.length &&
      after.dataOffset === before.dataOffset,
    `Candidate changed segment ${index} shape or mapping.`);
  }
  const covered = new Uint8Array(candidateApp.length);
  for (const range of approval.candidate.patchProof.ranges) {
    invariant(sha256(healthyApp.subarray(range.offset, range.end)) === range.beforeSha256 &&
      sha256(candidateApp.subarray(range.offset, range.end)) === range.afterSha256,
    `Candidate patch range ${hex(range.offset)} byte identity changed.`);
    covered.fill(1, range.offset, range.end);
  }
  const acceptedIrom = healthyImage.segments.find(({ loadAddress }) => loadAddress === 0x42000020);
  invariant(acceptedIrom, "Accepted app lost its exact IROM segment.");
  const iromEnd = acceptedIrom.dataOffset + acceptedIrom.length;
  const digestEnd = healthyImage.digestAppended ? healthyImage.digestOffset + 32 : 0;
  for (let offset = 0; offset < candidateApp.length; offset += 1) {
    invariant(candidateApp[offset] === healthyApp[offset] || covered[offset] === 1,
      `Candidate changed unapproved app byte ${hex(offset)}.`);
    if (candidateApp[offset] !== healthyApp[offset]) {
      invariant((offset >= acceptedIrom.dataOffset && offset < iromEnd) ||
        offset === healthyImage.checksumOffset ||
        (healthyImage.digestAppended && offset >= healthyImage.digestOffset && offset < digestEnd),
      `Candidate changed non-IROM, non-integrity app byte ${hex(offset)}.`);
    }
  }
  const recovery = await readFile(approval.baseline.recovery.file);
  const partitionTable = recovery.subarray(PINNED.partitionTable.offset,
    PINNED.partitionTable.offset + PINNED.partitionTable.bytes);
  const canaryPackage = decodeRenderV2MQuickJsPackage(
    await readFile(approval.runtime.embedded.canary.file));
  const expectedSelectors = [
    "host.rpc:0xB240", "host.rpc:0xB241", "host.rpc:0xB242", "host.rpc:0xB243",
    "host.rpc:0xB244", "host.rpc:0xB24D", "host.rpc:0xB24E", "host.rpc:0xB24F",
    "tick.1s", "input.fn-bottom-knob", "input.key.down", "input.key.up", "input.key.hold",
    "input.chord.down", "input.chord.up", "tick.100ms",
  ];
  const normalizeSelector = (selector) => selector.replace(/host\.rpc:0x([0-9a-f]+)/iu,
    (_match, digits) => `host.rpc:0x${digits.toUpperCase()}`);
  const selectors = [...canaryPackage.source.matchAll(/widget\.on\("([^"]+)"/gu)]
    .map((match) => normalizeSelector(match[1]));
  invariant(canaryPackage.generation === approval.runtime.generation && selectors.length === 16 &&
    JSON.stringify([...selectors].sort()) === JSON.stringify([...expectedSelectors].sort()),
  "Embedded physical package must contain the exact bounded 16-handler canary.");
  const eventNames = canaryPackage.events.map((event) => event.kind === 1 ? "tick.100ms" :
    event.kind === 2 ? "tick.1s" : event.kind === 3 ? "input.fn-bottom-knob" :
      event.kind === 4 ? `host.rpc:0x${event.id.toString(16).padStart(4, "0")}` :
        event.kind === 5 ? `key:${event.id}` : event.kind === 6 ? `chord:${event.id}` : "unknown");
  invariant(["tick.100ms", "tick.1s", "input.fn-bottom-knob"].every((name) => eventNames.includes(name)) &&
    PINNED.rpcIds.every((id) => eventNames.includes(`host.rpc:0x${id.toString(16).padStart(4, "0")}`)) &&
    canaryPackage.input.keyCount === 2 && canaryPackage.input.chordCount === 1,
  "Embedded physical package lost a timer, knob, weather RPC, key, or chord declaration.");
  const keyRecords = canaryPackage.events.filter(({ kind }) => kind === 5);
  const chordRecords = canaryPackage.events.filter(({ kind }) => kind === 6);
  invariant(keyRecords.length === 2 && keyRecords[0].id === 0 && keyRecords[0].nativeToken === 44 &&
    keyRecords[1].id === 1 && keyRecords[1].nativeToken === 225 &&
    chordRecords.length === 1 && chordRecords[0].id === 0 && chordRecords[0].heldMask === 3,
  "Embedded package key/chord records differ from Space(44), Left Shift(225), mask 3.");
  return Object.freeze({ approvalSha256: approvalDigest(approval),
    confirmationToken: confirmationToken(approval),
    rollbackConfirmationToken: rollbackConfirmationToken(approval),
    partitionTableSha256: sha256(partitionTable), canaryPackageSha256: canaryPackage.sha256 });
}

export function assertPort(port) {
  invariant(PORT.test(port ?? ""), "Port must be one explicit /dev/cu.usbmodem* or /dev/cu.usbserial* path.");
  return port;
}

export function assertSafeEsptoolInvocation(args, { operation, approval, artifact = null } = {}) {
  invariant(Array.isArray(args) && args.length > 0 && args.every((value) => typeof value === "string"),
    "esptool args must be nonempty strings.");
  for (const arg of args) invariant(!FORBIDDEN_TOOL_ARGS.has(arg), `Forbidden esptool argument ${arg}.`);
  const chip = args.indexOf("--chip");
  const port = args.indexOf("--port");
  invariant(chip >= 0 && args[chip + 1] === "esp32s3" && port >= 0 && assertPort(args[port + 1]),
    "Every invocation must pin ESP32-S3 and one explicit serial port.");
  const writes = args.filter((arg) => arg === "write-flash").length;
  const reads = args.filter((arg) => arg === "read-flash").length;
  invariant(writes + reads <= 1, "One esptool invocation may contain at most one flash operation.");
  if (operation === "identity") {
    invariant(writes === 0 && reads === 0 &&
      ["chip-id", "read-mac", "get-security-info", "flash-id"].some((command) => args.includes(command)),
    "Identity gate may only use read-only identity commands.");
    return true;
  }
  if (operation === "read") {
    invariant(reads === 1 && writes === 0 && args.includes("--no-progress"),
      "Readback must be one no-progress read-flash command.");
    const read = args.indexOf("read-flash");
    invariant(artifact && Number.isInteger(artifact.offset) && Number.isInteger(artifact.bytes) &&
      typeof artifact.file === "string" && args[read + 1] === "--no-progress" &&
      Number(args[read + 2]) === artifact.offset && Number(args[read + 3]) === artifact.bytes &&
      path.resolve(args[read + 4]) === path.resolve(artifact.file) && args.length === read + 5,
    "Readback must contain exactly one explicit approved range and destination.");
    return true;
  }
  invariant(operation === "write" && approval && artifact, "Write validation requires approval and artifact.");
  validateApproval(approval);
  const write = args.indexOf("write-flash");
  invariant(write >= 0 && reads === 0 && args[write + 1] === "--flash-size" &&
    args[write + 2] === "keep" && args.length === write + 5,
  "Write must contain exactly one file, one offset, and --flash-size keep.");
  invariant(Number(args[write + 3]) === artifact.offset && path.resolve(args[write + 4]) === path.resolve(artifact.file),
    "Write offset/file differ from the sealed artifact.");
  const allowed = [approval.module.text, approval.module.rodata, approval.candidate.app, approval.rollback.app];
  invariant(allowed.some((value) => value.offset === artifact.offset && value.bytes === artifact.bytes &&
    value.sha256 === artifact.sha256),
  "Write artifact is not one exact approved region.");
  return true;
}
