#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  ALLOCATION_MAP_ORDERING,
  KEY_NEGATIVE_HARNESS,
  KEY_TOKEN_NORMALIZATION,
  PINNED,
  TELEMETRY_SNAPSHOT_PROTOCOL,
  UI_LATENCY_METRIC,
  WORKFLOW_FORMAT,
  confirmationToken,
  rollbackConfirmationToken,
  sha256,
  validateApproval,
  validateReleaseReportAbiIdentity,
  verifyApprovalFiles,
} from "./contract.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const healthyAppFile = path.join(root,
  "f1-widget-sdk/build/combined-renderer-v2-clock-blue-timer/" +
  "framer-0.4.1-music-id1-wpm-id7-renderer-id26-clock-id27-blue-timer-app.bin");
const healthyReceiptFile = path.join(root,
  "f1-widget-sdk/build/device-receipts/device-1786939039376-fast-smoke.json");
const recoveryFile = path.join(root,
  "recovery/backups/2026-08-15-framer-f1-a4cb8faf3210-before-custom/full-flash-16mb.bin");
function parse(argv) {
  const options = {};
  const names = new Set([
    "--candidate-app", "--module-text", "--module-rodata", "--link-report", "--audit-report", "--key-proof",
    "--canary-package", "--weather-facade", "--weather-base", "--operator",
    "--physical-recovery-evidence", "--out",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!names.has(arg)) throw new Error(`Unknown argument ${arg}.`);
    const value = argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value.`);
    options[arg.slice(2).replaceAll("-", "_")] = value;
  }
  for (const name of names) {
    const key = name.slice(2).replaceAll("-", "_");
    if (!options[key]) throw new Error(`${name} is required.`);
  }
  return options;
}

async function artifact(file, offset = undefined) {
  const absolute = path.resolve(file);
  const bytes = await readFile(absolute);
  const value = { file: absolute, bytes: bytes.length, sha256: sha256(bytes) };
  if (offset !== undefined) Object.assign(value, { offset, end: offset + bytes.length });
  return Object.freeze(value);
}

function patchRanges(before, after) {
  if (before.length !== after.length) throw new Error("Candidate app length differs from the healthy app.");
  const runs = [];
  let offset = 0;
  while (offset < before.length) {
    while (offset < before.length && before[offset] === after[offset]) offset += 1;
    if (offset === before.length) break;
    const start = offset;
    while (offset < before.length && before[offset] !== after[offset]) offset += 1;
    runs.push({ start, end: offset });
  }
  // Coalesce close checksum/linker changes into auditable ranges without granting
  // authority over the rest of the image.
  const merged = [];
  for (const run of runs) {
    const previous = merged.at(-1);
    if (previous && run.start - previous.end <= 32) previous.end = run.end;
    else merged.push({ ...run });
  }
  if (merged.length === 0 || merged.length > 64) {
    throw new Error(`Candidate diff has ${merged.length} ranges; expected 1..64 after 32-byte coalescing.`);
  }
  return merged.map(({ start, end }) => Object.freeze({ offset: start, bytes: end - start, end,
    beforeSha256: sha256(before.subarray(start, end)), afterSha256: sha256(after.subarray(start, end)) }));
}

function parseJson(bytes, label) {
  try { return JSON.parse(bytes.toString("utf8")); } catch {
    throw new Error(`${label} must be JSON.`);
  }
}

export async function prepareApproval(options) {
  const [healthy, candidate, healthyApp, receipt, recovery, text, rodata, canary, facade, base,
    linkReport, auditReport, keyProof] = await Promise.all([
    readFile(healthyAppFile), readFile(path.resolve(options.candidate_app)),
    artifact(healthyAppFile, PINNED.healthyApp.offset), artifact(healthyReceiptFile), artifact(recoveryFile),
    artifact(options.module_text, PINNED.module.text.offset),
    artifact(options.module_rodata, PINNED.module.rodata.offset), artifact(options.canary_package),
    artifact(options.weather_facade), artifact(options.weather_base),
    artifact(options.link_report), artifact(options.audit_report), artifact(options.key_proof),
  ]);
  const candidateArtifact = await artifact(options.candidate_app, PINNED.healthyApp.offset);
  const moduleIdentitySha256 = sha256(Buffer.concat([
    await readFile(text.file), await readFile(rodata.file),
  ]));
  const link = parseJson(await readFile(linkReport.file), "Link report");
  const audit = parseJson(await readFile(auditReport.file), "Independent audit report");
  const keys = parseJson(await readFile(keyProof.file), "Key-token proof");
  validateReleaseReportAbiIdentity(link, "Link report");
  validateReleaseReportAbiIdentity(audit, "Independent audit report");
  if (link.verdict !== "GO" || link.candidateAppSha256 !== candidateArtifact.sha256 ||
      link.moduleTextSha256 !== text.sha256 || link.moduleRodataSha256 !== rodata.sha256 ||
      link.moduleSlotSha256 !== moduleIdentitySha256 ||
      link.telemetrySnapshotProtocol !== TELEMETRY_SNAPSHOT_PROTOCOL ||
      link.uiLatencyMetric !== UI_LATENCY_METRIC ||
      link.allocationMapOrdering !== ALLOCATION_MAP_ORDERING ||
      link.keyNegativeHarness !== KEY_NEGATIVE_HARNESS ||
      link.keyTokenNormalization !== KEY_TOKEN_NORMALIZATION ||
      JSON.stringify(link.mappings) !== JSON.stringify([
        { logical: 0, nativeToken: 44 }, { logical: 1, nativeToken: 225 },
      ]) || link.chordHeldMask !== 3 ||
      JSON.stringify(link.rejectedLow24Tokens) !== JSON.stringify([229])) {
    throw new Error("Link report does not pin the exact candidate app and both frozen module pages.");
  }
  if (audit.format !== "framer-f1-mquickjs-physical-link-audit-v1" || audit.verdict !== "GO" ||
      audit.candidateAppSha256 !== candidateArtifact.sha256 || audit.linkReportSha256 !== linkReport.sha256 ||
      audit.moduleTextSha256 !== text.sha256 || audit.moduleRodataSha256 !== rodata.sha256 ||
      audit.moduleSlotSha256 !== moduleIdentitySha256 ||
      audit.telemetrySnapshotProtocol !== TELEMETRY_SNAPSHOT_PROTOCOL ||
      audit.uiLatencyMetric !== UI_LATENCY_METRIC ||
      audit.allocationMapOrdering !== ALLOCATION_MAP_ORDERING ||
      audit.keyNegativeHarness !== KEY_NEGATIVE_HARNESS ||
      audit.keyTokenNormalization !== KEY_TOKEN_NORMALIZATION ||
      JSON.stringify(audit.mappings) !== JSON.stringify([
        { logical: 0, nativeToken: 44 }, { logical: 1, nativeToken: 225 },
      ]) || audit.chordHeldMask !== 3 ||
      JSON.stringify(audit.rejectedLow24Tokens) !== JSON.stringify([229]) ||
      audit.keyTokenProofSha256 !== keyProof.sha256 || typeof audit.reviewer !== "string" || !audit.reviewer) {
    throw new Error("Independent audit is not an exact GO over the link, module pages, and key-token proof.");
  }
  if (keys.format !== "framer-f1-mquickjs-key-token-proof-v1" ||
      keys.status !== "EXACT_TOKEN_MAP_PROVEN" ||
      keys.acceptedAppSha256 !== PINNED.healthyApp.sha256 || !Array.isArray(keys.mappings) ||
      JSON.stringify(keys.mappings) !== JSON.stringify([
        { logical: 0, nativeToken: 44 }, { logical: 1, nativeToken: 225 },
      ]) || keys.chordHeldMask !== 3 || keys.keyTokenNormalization !== KEY_TOKEN_NORMALIZATION ||
      JSON.stringify(keys.rejectedLow24Tokens) !== JSON.stringify([229]) ||
      keys.postFlashObservationRequired !== true ||
      keys.callbackSpanSha256 !== "96316a9091816bf7290c75ebe6be76e4ed184ee13fdef6c50b77e791b5ecfa2b" ||
      keys.callbackLiteralSha256 !== "3d5174006fa28e9caeef531cbcdec7bd1d552b0ab7ad1d4f4a8d30c44c0e1dda" ||
      !/^[0-9a-f]{64}$/u.test(keys.spaceInstructionSha256 ?? "") ||
      !/^[0-9a-f]{64}$/u.test(keys.leftShiftInstructionSha256 ?? "")) {
    throw new Error("Key-token proof is absent or not exact for the accepted app.");
  }
  const keyMode = "fixed-token-map-v1";
  const approval = {
    format: WORKFLOW_FORMAT,
    status: "LINKED_STATIC_GO_PENDING_PHYSICAL",
    deployable: true,
    target: { device: PINNED.device, firmware: PINNED.firmware, chip: PINNED.chip,
      mac: PINNED.mac, flashBytes: PINNED.flashBytes },
    factory: { ...PINNED.factory },
    baseline: { app: { ...healthyApp }, receipt: { ...receipt }, recovery: { ...recovery } },
    candidate: { app: { ...candidateArtifact }, patchProof: { reportFile: linkReport.file,
      reportSha256: linkReport.sha256, ranges: patchRanges(healthy, candidate) } },
    module: { slot: "A", text: { ...text }, rodata: { ...rodata }, deviceIdentity: {
      semantics: "sha256(text[0x210000,0x230000)+rodata[0x230000,0x240000))",
      bytes: 0x30000, sha256: moduleIdentitySha256 },
      slotB: { ...PINNED.module.slotB, policy: "untouched" } },
    write: { order: ["module.text", "module.rodata", "candidate.app"],
      readback: "each-region-byte-exact-before-next-write", appLast: true,
      partitionTableUnchanged: true, scope: "factory-app-plus-slot-a-only" },
    rollback: { order: ["healthy.app"], app: { ...healthyApp },
      residualModulePolicy: "inert-after-healthy-app-first; no erase required",
      receipt: { ...receipt } },
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
        canary: { ...canary }, weatherFacade: { ...facade },
        weatherBase: { ...base },
      } },
    keyEvents: { enabled: true, mode: keyMode, stockFirst: true,
      carrier: { address: "0x4206eae0", bytes: 104,
        sha256: "96316a9091816bf7290c75ebe6be76e4ed184ee13fdef6c50b77e791b5ecfa2b" },
      literal: { address: "0x42041568", bytes: 4,
        sha256: "3d5174006fa28e9caeef531cbcdec7bd1d552b0ab7ad1d4f4a8d30c44c0e1dda" },
      tokenProof: { status: keys.status, reportFile: keyProof.file, reportSha256: keyProof.sha256,
        acceptedAppSha256: keys.acceptedAppSha256, evidence: {
          callbackSpanSha256: keys.callbackSpanSha256,
          callbackLiteralSha256: keys.callbackLiteralSha256,
          spaceInstructionSha256: keys.spaceInstructionSha256,
          leftShiftInstructionSha256: keys.leftShiftInstructionSha256,
        }, mappings: keys.mappings, chordHeldMask: keys.chordHeldMask,
        keyTokenNormalization: keys.keyTokenNormalization,
        rejectedLow24Tokens: keys.rejectedLow24Tokens,
        postFlashObservationRequired: keys.postFlashObservationRequired,
        learning: null } },
    audit: { verdict: audit.verdict, reviewer: audit.reviewer, reportFile: auditReport.file,
      reportSha256: auditReport.sha256 },
    recovery: { physicalBoot: { gpio0Located: true, enLocated: true, procedureRehearsed: true,
      operator: options.operator, evidence: options.physical_recovery_evidence },
      failurePolicy: "no-map-retry; disable-capability; physical-boot; restore-healthy-app-first" },
  };
  validateApproval(approval);
  const verified = await verifyApprovalFiles(approval);
  const output = path.resolve(options.out);
  await writeFile(output, JSON.stringify(approval, null, 2) + "\n", { flag: "wx", flush: true });
  return Object.freeze({ status: "PASS_EXACT_APPROVAL_PREPARED_NO_HARDWARE", file: output,
    approvalSha256: verified.approvalSha256, flashToken: confirmationToken(approval),
    rollbackToken: rollbackConfirmationToken(approval), hardwareAccess: false });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  prepareApproval(parse(process.argv.slice(2))).then((value) => {
    process.stdout.write(JSON.stringify(value, null, 2) + "\n");
  }).catch((error) => {
    process.stderr.write(`BLOCKED: ${error.message}\n`);
    process.exitCode = 1;
  });
}
