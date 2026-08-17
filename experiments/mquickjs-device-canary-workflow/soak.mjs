#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { PINNED, RECEIPT_FORMAT, invariant, sha256, validateApproval,
  verifyApprovalFiles } from "./contract.mjs";
import { validateSoakRecords } from "./telemetry.mjs";

function parse(argv) {
  const options = { input: "-", minimumDurationMs: 3_600_000, maximumSampleGapMs: 10_000,
    requireFaultInjection: true };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (["--approval", "--flash-receipt", "--input", "--out", "--minimum-duration-ms",
      "--maximum-sample-gap-ms"]
      .includes(arg)) {
      const value = argv[++index];
      if (!value) throw new Error(`${arg} requires a value.`);
      if (arg === "--approval") options.approval = value;
      else if (arg === "--flash-receipt") options.flashReceipt = value;
      else if (arg === "--input") options.input = value;
      else if (arg === "--out") options.out = value;
      else if (arg === "--minimum-duration-ms") options.minimumDurationMs = Number(value);
      else options.maximumSampleGapMs = Number(value);
    } else if (arg === "--skip-fault-injection") options.requireFaultInjection = false;
    else throw new Error(`Unknown argument ${arg}.`);
  }
  if (!options.approval) throw new Error("--approval is required.");
  if (!options.flashReceipt) throw new Error("--flash-receipt is required.");
  if (!Number.isInteger(options.minimumDurationMs) || options.minimumDurationMs < 0) {
    throw new Error("--minimum-duration-ms must be a nonnegative integer.");
  }
  if (!Number.isInteger(options.maximumSampleGapMs) || options.maximumSampleGapMs < 100) {
    throw new Error("--maximum-sample-gap-ms must be an integer of at least 100.");
  }
  return options;
}

export function validateFlashReceipt(receipt, approval, { approvalSha256, partitionTableSha256 }) {
  invariant(receipt?.format === RECEIPT_FORMAT && receipt.mode === "flash" &&
    receipt.status === "PASS_FLASH_REBOOTED_CAPABILITY_SMOKE_PENDING" &&
    receipt.hardwareAccess === true && receipt.approvalSha256 === approvalSha256,
  "Flash receipt is not the completed exact app-last canary operation for this approval.");
  invariant(receipt.target?.device === PINNED.device && receipt.target?.chip === PINNED.chip &&
    receipt.target?.mac === PINNED.mac && receipt.identity?.mac === PINNED.mac &&
    receipt.partitionTableSha256 === partitionTableSha256 &&
    receipt.partitionTable?.sha256 === partitionTableSha256,
  "Flash receipt target, MAC, or partition-table identity changed.");
  invariant(JSON.stringify(receipt.order) === JSON.stringify(approval.write.order) &&
    receipt.runtimeModuleUpdates === false && receipt.runtimeUploader === false,
  "Flash receipt does not preserve the approved boot-lifetime/no-uploader policy.");
  const phases = receipt.phases?.filter(({ phase }) =>
    ["module.text", "module.rodata", "candidate.app"].includes(phase));
  invariant(Array.isArray(phases) && phases.length === 3 &&
    JSON.stringify(phases.map(({ phase }) => phase)) === JSON.stringify(approval.write.order),
  "Flash receipt write phases are missing, duplicated, or not app-last.");
  for (const [phase, artifact] of phases.map((value, index) => [value,
    [approval.module.text, approval.module.rodata, approval.candidate.app][index]])) {
    invariant(phase.readback?.offset === artifact.offset && phase.readback?.bytes === artifact.bytes &&
      phase.readback?.sha256 === artifact.sha256 && phase.write?.sha256 === artifact.sha256 &&
      phase.write?.hashVerifiedByEsptool === true &&
      phase.status === (phase.phase === "candidate.app" ? "PASS_BYTE_EXACT_APP_LAST" : "PASS_BYTE_EXACT"),
    `Flash receipt ${phase.phase} is not byte-exact.`);
  }
  invariant(receipt.moduleDeviceIdentity?.semantics === approval.module.deviceIdentity.semantics &&
    receipt.moduleDeviceIdentity?.bytes === approval.module.deviceIdentity.bytes &&
    receipt.moduleDeviceIdentity?.sha256 === approval.module.deviceIdentity.sha256 &&
    receipt.moduleDeviceIdentity?.exact === true,
  "Flash receipt does not bind the exact complete slot-A readback digest.");
  return receipt;
}

async function stdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

export function parseJsonLines(text) {
  return text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); } catch (error) {
      throw new Error(`Invalid JSON on telemetry line ${index + 1}: ${error.message}`);
    }
  });
}

export async function runSoakValidator(options) {
  const approval = validateApproval(JSON.parse(await readFile(options.approval, "utf8")));
  const approvalFiles = await verifyApprovalFiles(approval);
  const flashReceiptBytes = await readFile(options.flashReceipt);
  let flashReceipt;
  try { flashReceipt = JSON.parse(flashReceiptBytes.toString("utf8")); } catch {
    throw new Error("--flash-receipt must be valid JSON.");
  }
  validateFlashReceipt(flashReceipt, approval, approvalFiles);
  const flashReceiptSha256 = sha256(flashReceiptBytes);
  const text = options.input === "-" ? await stdin() : await readFile(options.input, "utf8");
  const records = parseJsonLines(text);
  const receipt = validateSoakRecords(records, approval, { ...options, flashReceiptSha256 });
  const output = { ...receipt, approvalSha256: approvalFiles.approvalSha256 };
  const encoded = JSON.stringify(output, null, 2) + "\n";
  if (options.out) await writeFile(options.out, encoded, { flag: "wx", flush: true });
  return Object.freeze(output);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  runSoakValidator(parse(process.argv.slice(2))).then((value) => {
    process.stdout.write(JSON.stringify(value, null, 2) + "\n");
  }).catch((error) => {
    process.stderr.write(`BLOCKED: ${error.message}\n`);
    process.exitCode = 1;
  });
}
