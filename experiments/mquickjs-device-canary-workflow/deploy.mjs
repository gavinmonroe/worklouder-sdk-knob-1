#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  PINNED,
  RECEIPT_FORMAT,
  approvalDigest,
  assertPort,
  assertSafeEsptoolInvocation,
  confirmationToken,
  hex,
  invariant,
  rollbackConfirmationToken,
  sha256,
  validateApproval,
  verifyApprovalFiles,
} from "./contract.mjs";

const executeFile = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const defaultEsptool = path.join(root, ".venv-esptool/bin/esptool");

function parse(argv) {
  const [command, ...args] = argv;
  invariant(["preflight", "flash", "rollback"].includes(command),
    "Usage: deploy.mjs preflight|flash|rollback --approval FILE [--port PORT --out DIR --confirm TOKEN --execute].");
  const options = { command, execute: false, esptool: defaultEsptool };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (["--approval", "--port", "--out", "--confirm", "--esptool"].includes(arg)) {
      const value = args[++index];
      invariant(value && !value.startsWith("--"), `${arg} requires a value.`);
      options[arg.slice(2)] = value;
    } else if (arg === "--execute") options.execute = true;
    else throw new Error(`Unknown argument ${arg}.`);
  }
  invariant(options.approval, "--approval is required.");
  if (command !== "preflight") {
    invariant(options.execute === true, `${command} requires --execute.`);
    invariant(options.port && options.out && options.confirm,
      `${command} requires --port, --out, and --confirm.`);
    assertPort(options.port);
  } else invariant(options.execute === false, "preflight rejects --execute.");
  return options;
}

async function runEsp(esptool, args, policy) {
  assertSafeEsptoolInvocation(args, policy);
  return executeFile(esptool, args, { cwd: root, maxBuffer: 16 * 1024 * 1024 });
}

function common(port, baud = 115200) {
  return ["--chip", "esp32s3", "--port", port, "--baud", String(baud), "--after", "no-reset"];
}

function parseMac(text) {
  return text.match(/(?:MAC|Address):\s*([0-9a-f:]{17})/iu)?.[1]?.toLowerCase();
}

async function identityGate(options) {
  const invoke = (suffix) => runEsp(options.esptool, [...common(options.port), ...suffix],
    { operation: "identity" });
  const chip = await invoke(["chip-id"]);
  invariant(/ESP32-S3/iu.test(chip.stdout), "Serial target is not ESP32-S3.");
  const mac = await invoke(["read-mac"]);
  invariant(parseMac(mac.stdout) === PINNED.mac, "Serial target MAC differs from the same-device backup.");
  const security = await invoke(["--no-stub", "get-security-info"]);
  invariant(/Secure Boot:\s*Disabled/iu.test(security.stdout) &&
    /Flash Encryption:\s*Disabled/iu.test(security.stdout),
  "Secure Boot or Flash Encryption differs from the recovery proof.");
  const flash = await invoke(["flash-id"]);
  invariant(/Detected flash size:\s*16MB/iu.test(flash.stdout), "Detected flash is not exact 16 MB.");
  return Object.freeze({ chip: PINNED.chip, mac: PINNED.mac, secureBoot: false,
    flashEncryption: false, flashBytes: PINNED.flashBytes });
}

async function readRegion(options, artifact) {
  const args = [...common(options.port), "read-flash", "--no-progress", hex(artifact.offset),
    hex(artifact.bytes), artifact.file];
  await runEsp(options.esptool, args, { operation: "read", artifact });
  const bytes = await readFile(artifact.file);
  invariant(bytes.length === artifact.bytes, `Readback ${artifact.file} length changed.`);
  return Object.freeze({ file: artifact.file, offset: artifact.offset, bytes: bytes.length,
    sha256: sha256(bytes) });
}

async function sealedArtifact(source, directory, name) {
  const bytes = await readFile(source.file);
  invariant(bytes.length === source.bytes && sha256(bytes) === source.sha256,
    `Approved ${name} bytes changed before sealing.`);
  const file = path.join(directory, `${name}.bin`);
  await writeFile(file, bytes, { flag: "wx", mode: 0o400 });
  return Object.freeze({ file, offset: source.offset, end: source.end,
    bytes: source.bytes, sha256: source.sha256 });
}

async function writeRegion(options, approval, artifact, after = "no-reset") {
  const args = ["--chip", "esp32s3", "--port", options.port, "--baud", "921600", "--after", after,
    "write-flash", "--flash-size", "keep", hex(artifact.offset), artifact.file];
  const result = await runEsp(options.esptool, args, { operation: "write", approval, artifact });
  const output = `${result.stdout}\n${result.stderr ?? ""}`;
  invariant(/Hash of data verified/iu.test(output),
    `esptool did not verify the write hash for ${hex(artifact.offset)}.`);
  return Object.freeze({ offset: artifact.offset, bytes: artifact.bytes, sha256: artifact.sha256,
    baud: 921600, hashVerifiedByEsptool: true });
}

async function resetFromRom(options) {
  await runEsp(options.esptool, ["--chip", "esp32s3", "--port", options.port, "--baud", "115200",
    "--after", "watchdog-reset", "chip-id"], { operation: "identity" });
}

async function createOutput(directory) {
  await mkdir(directory, { recursive: false });
  return path.resolve(directory);
}

async function journal(file, value) {
  await writeFile(file, JSON.stringify(value, null, 2) + "\n", { flush: true });
}

async function physical(options, approval, approvalFiles) {
  const expectedToken = options.command === "flash" ? confirmationToken(approval) :
    rollbackConfirmationToken(approval);
  invariant(options.confirm === expectedToken, `Confirmation mismatch. Exact token: ${expectedToken}`);
  const output = await createOutput(options.out);
  const journalFile = path.join(output, "operation-journal.json");
  const state = {
    format: RECEIPT_FORMAT,
    mode: options.command,
    status: "STARTED_NO_WRITE",
    startedAt: new Date().toISOString(),
    approvalSha256: approvalFiles.approvalSha256,
    target: approval.target,
    order: options.command === "flash" ? approval.write.order : approval.rollback.order,
    partitionTableSha256: approvalFiles.partitionTableSha256,
    phases: [],
  };
  await journal(journalFile, state);
  const temporary = await mkdtemp(path.join(os.tmpdir(), "f1-mquickjs-sealed-"));
  try {
    const identity = await identityGate(options);
    state.identity = identity;
    state.phases.push({ phase: "identity", status: "PASS_READ_ONLY" });
    const partitionFile = path.join(output, "partition-table-before.bin");
    const partition = await readRegion(options, { file: partitionFile, ...PINNED.partitionTable });
    invariant(partition.sha256 === approvalFiles.partitionTableSha256,
      "Live partition table differs from the same-device full-flash recovery.");
    state.partitionTable = partition;

    const beforeAppFile = path.join(output, "app-before.bin");
    const beforeApp = await readRegion(options, { file: beforeAppFile,
      offset: PINNED.healthyApp.offset, bytes: PINNED.healthyApp.bytes });
    if (options.command === "flash") {
      invariant(beforeApp.sha256 === PINNED.healthyApp.sha256,
        "Initial canary flash requires the exact healthy 36317013 app live on device.");
    }
    state.preWrite = { app: beforeApp };
    state.phases.push({ phase: "baseline", status: "PASS_READ_ONLY", appSha256: beforeApp.sha256 });
    await journal(journalFile, state);

    if (options.command === "rollback") {
      const healthy = await sealedArtifact(approval.rollback.app, temporary, "healthy-app");
      state.status = "WRITE_STARTED_ROLLBACK_APP_FIRST";
      await journal(journalFile, state);
      const write = await writeRegion(options, approval, healthy);
      const readback = await readRegion(options, { file: path.join(output, "healthy-app-readback.bin"),
        offset: healthy.offset, bytes: healthy.bytes });
      invariant(readback.sha256 === healthy.sha256, "Healthy rollback app readback mismatch.");
      state.phases.push({ phase: "healthy.app", status: "PASS_BYTE_EXACT", write, readback });
      state.residualModulePolicy = approval.rollback.residualModulePolicy;
      state.status = "PASS_ROLLBACK_READBACK_MODULE_INERT_REBOOTING";
      await journal(journalFile, state);
      await resetFromRom(options);
      state.status = "PASS_ROLLBACK_REBOOTED_NORMAL_HEALTH_PENDING";
    } else {
      const text = await sealedArtifact(approval.module.text, temporary, "module-text");
      const rodata = await sealedArtifact(approval.module.rodata, temporary, "module-rodata");
      const app = await sealedArtifact(approval.candidate.app, temporary, "candidate-app");
      for (const [name, artifact] of [["module.text", text], ["module.rodata", rodata]]) {
        state.status = `WRITE_STARTED_${name.toUpperCase().replace(".", "_")}`;
        await journal(journalFile, state);
        const write = await writeRegion(options, approval, artifact);
        const readback = await readRegion(options, { file: path.join(output, `${name}-readback.bin`),
          offset: artifact.offset, bytes: artifact.bytes });
        invariant(readback.sha256 === artifact.sha256, `${name} readback mismatch; candidate app remains inactive.`);
        state.phases.push({ phase: name, status: "PASS_BYTE_EXACT", write, readback });
        await journal(journalFile, state);
      }
      const moduleReadback = Buffer.concat([
        await readFile(path.join(output, "module.text-readback.bin")),
        await readFile(path.join(output, "module.rodata-readback.bin")),
      ]);
      invariant(moduleReadback.length === approval.module.deviceIdentity.bytes &&
        sha256(moduleReadback) === approval.module.deviceIdentity.sha256,
      "Combined slot-A module identity differs from the device-emitted full-slot digest.");
      state.moduleDeviceIdentity = { semantics: approval.module.deviceIdentity.semantics,
        bytes: moduleReadback.length, sha256: sha256(moduleReadback), exact: true };
      state.status = "MODULE_SLOT_A_SEALED_APP_WRITE_STARTING_LAST";
      await journal(journalFile, state);
      const appWrite = await writeRegion(options, approval, app);
      const appReadback = await readRegion(options, { file: path.join(output, "candidate-app-readback.bin"),
        offset: app.offset, bytes: app.bytes });
      invariant(appReadback.sha256 === app.sha256,
        "Candidate app readback mismatch; use physical GPIO0/BOOT + EN rollback immediately.");
      state.phases.push({ phase: "candidate.app", status: "PASS_BYTE_EXACT_APP_LAST",
        write: appWrite, readback: appReadback });
      state.status = "PASS_ALL_READBACKS_REBOOTING";
      await journal(journalFile, state);
      await resetFromRom(options);
      state.status = "PASS_FLASH_REBOOTED_CAPABILITY_SMOKE_PENDING";
    }
    state.finishedAt = new Date().toISOString();
    state.hardwareAccess = true;
    state.runtimeModuleUpdates = false;
    state.runtimeUploader = false;
    state.next = options.command === "flash" ?
      "Require exact capability + RPC smoke; on absence/fault, physical-boot and run rollback." :
      "Require normal knob_f1 0.4.1 health; slot A is inert under the healthy app.";
    await journal(journalFile, state);
    await writeFile(path.join(output, "flash-receipt.json"), JSON.stringify(state, null, 2) + "\n",
      { flag: "wx", flush: true });
    return Object.freeze(state);
  } catch (error) {
    state.status = "FAILED_STOPPED";
    state.error = error.message;
    state.recovery = options.command === "flash" ?
      "Do not retry mapping or write a module at runtime. Use physical GPIO0/BOOT + EN, then rollback healthy app first." :
      "Keep device in ROM; verify MAC/partition table and retry only the exact healthy-app rollback.";
    await journal(journalFile, state).catch(() => {});
    throw error;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function run(options) {
  const approval = validateApproval(JSON.parse(await readFile(path.resolve(options.approval), "utf8")));
  const files = await verifyApprovalFiles(approval);
  if (options.command === "preflight") {
    return Object.freeze({ status: "PASS_OFFLINE_PREFLIGHT_NO_HARDWARE", approvalSha256: files.approvalSha256,
      partitionTableSha256: files.partitionTableSha256, writeOrder: approval.write.order,
      rollbackOrder: approval.rollback.order, flashToken: confirmationToken(approval),
      rollbackToken: rollbackConfirmationToken(approval), hardwareAccess: false });
  }
  return physical(options, approval, files);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  run(parse(process.argv.slice(2))).then((value) => {
    process.stdout.write(JSON.stringify(value, null, 2) + "\n");
  }).catch((error) => {
    process.stderr.write(`BLOCKED: ${error.message}\n`);
    process.exitCode = 1;
  });
}
