#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  EXPECTED_CHIP,
  EXPECTED_CONFIRMATION,
  PARTITION_TABLE_OFFSET,
  PARTITION_TABLE_SIZE,
  assertFramerIdentity,
  assertReadOnlyInvocation,
  buildDryRunPlan,
  findExecutable,
  hex,
  isLikelyBootloaderPort,
  parseDetectedFlashSize,
  parsePartitionTable,
  safePartitionFilename,
  selectRecoveryPartitions,
  validateLivePort,
} from "./lib.mjs";

function usage() {
  return `Framer F1 ESP32-S3 read-only recovery audit

Usage:
  node recovery/audit.mjs --port /dev/cu.usbmodemNNNN \\
    --confirm-device FRAMER-F1 [--output PATH] [--baud 115200]

  node recovery/audit.mjs --port /dev/cu.usbmodem-FRAMER-F1 \\
    --confirm-device FRAMER-F1 --dry-run

No erase, write-flash, burn, encryption, or --force operation is implemented.
`;
}

function parseArgs(argv) {
  const options = { port: undefined, confirmation: undefined, output: undefined, baud: 115200, dryRun: false, esptool: undefined, espefuse: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") options.dryRun = true;
    else if (["--port", "--confirm-device", "--output", "--baud", "--esptool", "--espefuse"].includes(arg)) {
      const value = argv[++index];
      if (!value) throw new Error(`${arg} requires a value.`);
      if (arg === "--port") options.port = value;
      else if (arg === "--confirm-device") options.confirmation = value;
      else if (arg === "--output") options.output = value;
      else if (arg === "--baud") options.baud = Number(value);
      else if (arg === "--esptool") options.esptool = value;
      else options.espefuse = value;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else throw new Error(`Unknown option: ${arg}`);
  }
  if (options.help) return options;
  if (!isLikelyBootloaderPort(options.port)) throw new Error("--port must be an explicit, likely USB serial device under /dev.");
  if (options.confirmation !== EXPECTED_CONFIRMATION) {
    throw new Error(`--confirm-device must be exactly ${EXPECTED_CONFIRMATION}.`);
  }
  if (!Number.isInteger(options.baud) || options.baud < 115200 || options.baud > 921600) {
    throw new Error("--baud must be an integer from 115200 through 921600.");
  }
  return options;
}

async function runProcess(kind, executable, args, logPath) {
  assertReadOnlyInvocation(kind, args);
  const result = await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") }));
  });
  const combined = [`$ ${[executable, ...args].join(" ")}`, result.stdout, result.stderr].filter(Boolean).join("\n");
  await writeFile(logPath, `${combined.trim()}\n`, { flag: "wx" });
  if (result.code !== 0) throw new Error(`${path.basename(executable)} failed; see ${logPath}`);
  return result.stdout + result.stderr;
}

async function hashFiles(directory) {
  const names = (await readdir(directory)).filter((name) => name !== "SHA256SUMS.txt").sort();
  const hashes = [];
  for (const name of names) {
    const target = path.join(directory, name);
    const data = await readFile(target);
    hashes.push({ name, bytes: data.length, sha256: createHash("sha256").update(data).digest("hex") });
  }
  await writeFile(
    path.join(directory, "SHA256SUMS.txt"),
    `${hashes.map((item) => `${item.sha256}  ${item.name}`).join("\n")}\n`,
    { flag: "wx" },
  );
  return hashes;
}

function makeRestoreReference(port, partitions) {
  const lines = [
    "# REFERENCE ONLY — NEVER EXECUTED BY THE AUDIT SCRIPT",
    "# Review get-security-info.txt and efuse-summary.* before any restoration.",
    "# If Secure Boot or Flash Encryption is enabled, STOP: generic restore may brick",
    "# the device, encrypted dumps may be same-chip-only, and UART download may be restricted.",
    "# Never add --force and never restore to a different chip.",
    `PORT=${JSON.stringify(port)}`,
    "esptool --chip esp32s3 --port \"$PORT\" chip-id",
    "esptool --chip esp32s3 --port \"$PORT\" --no-stub get-security-info",
    "shasum -a 256 -c SHA256SUMS.txt",
    "",
    "# Full restore alternative (do not combine with the individual alternative):",
    "esptool --chip esp32s3 --port \"$PORT\" --baud 115200 write-flash --flash-size keep 0x0 full-flash.bin",
    "",
    "# Individual-data restore alternative after firmware compatibility is established:",
    "esptool --chip esp32s3 --port \"$PORT\" --baud 115200 write-flash --flash-size keep 0x8000 partition-table.bin",
    ...partitions.map((entry) =>
      `esptool --chip esp32s3 --port \"$PORT\" --baud 115200 write-flash --flash-size keep ${hex(entry.offset)} ${safePartitionFilename(entry)}`
    ),
    "",
  ];
  return lines.join("\n");
}

async function performAudit(options) {
  await validateLivePort(options.port);
  const esptool = await findExecutable(options.esptool, ["esptool"]);
  const espefuse = await findExecutable(options.espefuse, ["espefuse"]);
  const output = path.resolve(options.output ?? path.join(process.cwd(), "recovery-backups", new Date().toISOString().replaceAll(":", "-")));
  await mkdir(path.dirname(output), { recursive: true });
  await mkdir(output, { recursive: false });

  const common = ["--chip", EXPECTED_CHIP, "--port", options.port, "--baud", String(options.baud)];
  const runEsp = (name, args) => runProcess("esptool", esptool, args, path.join(output, `${name}.txt`));
  const runFuse = (name, args) => runProcess("espefuse", espefuse, args, path.join(output, `${name}.txt`));

  const version = await runEsp("esptool-version", ["version"]);
  const chipId = await runEsp("chip-id", [...common, "chip-id"]);
  if (!/ESP32-S3/iu.test(chipId)) throw new Error("esptool did not identify this target as ESP32-S3; refusing reads.");
  const mac = await runEsp("read-mac", [...common, "read-mac"]);
  const security = await runEsp("get-security-info", [...common, "--no-stub", "get-security-info"]);
  const efuseText = await runFuse("efuse-summary", ["--chip", EXPECTED_CHIP, "--port", options.port, "summary"]);
  const efuseJsonPath = path.join(output, "efuse-summary.json");
  await runFuse("efuse-summary-json-log", ["--chip", EXPECTED_CHIP, "--port", options.port, "summary", "--format", "json", "--file", efuseJsonPath]);
  const flashId = await runEsp("flash-id", [...common, "flash-id"]);
  const flashSize = parseDetectedFlashSize(flashId);

  const partitionTablePath = path.join(output, "partition-table.bin");
  await runEsp("read-partition-table", [...common, "read-flash", hex(PARTITION_TABLE_OFFSET), hex(PARTITION_TABLE_SIZE), partitionTablePath]);
  const entries = parsePartitionTable(await readFile(partitionTablePath));
  const recovery = selectRecoveryPartitions(entries, flashSize);

  const probePath = path.join(output, "identity-probe.bin");
  const probeSize = Math.min(0x10000, recovery.factory.size);
  await runEsp("read-identity-probe", [...common, "read-flash", hex(recovery.factory.offset), hex(probeSize), probePath]);
  assertFramerIdentity(await readFile(probePath));

  const fullFlashPath = path.join(output, "full-flash.bin");
  await runEsp("read-full-flash", [...common, "read-flash", "0x0", "ALL", fullFlashPath]);
  const fullFlash = await readFile(fullFlashPath);
  if (fullFlash.length !== flashSize) {
    throw new Error(`Full flash length ${fullFlash.length} does not equal detected size ${flashSize}.`);
  }

  for (const entry of recovery.selected) {
    await runEsp(
      `read-${entry.index}-${entry.label}`,
      [...common, "read-flash", hex(entry.offset), hex(entry.size), path.join(output, safePartitionFilename(entry))],
    );
  }

  let efuseJson;
  try {
    efuseJson = JSON.parse(await readFile(efuseJsonPath, "utf8"));
  } catch {
    efuseJson = { parseError: "Review efuse-summary.txt and efuse-summary-json-log.txt manually." };
  }
  const securityFields = Object.fromEntries(
    ["SECURE_BOOT_EN", "SPI_BOOT_CRYPT_CNT", "DIS_DOWNLOAD_MODE", "ENABLE_SECURITY_DOWNLOAD", "DIS_DOWNLOAD_MANUAL_ENCRYPT"]
      .filter((key) => efuseJson[key] !== undefined)
      .map((key) => [key, efuseJson[key]]),
  );
  const manifest = {
    format: "framer-f1-esp32s3-recovery-audit-v1",
    createdAt: new Date().toISOString(),
    port: options.port,
    expectedChip: EXPECTED_CHIP,
    identityMarkersVerified: ["Framer F1", "v.framer.bubble"],
    flashSize,
    partitionTableOffset: PARTITION_TABLE_OFFSET,
    partitionTableSize: PARTITION_TABLE_SIZE,
    partitions: entries,
    recoveryPartitions: recovery.selected,
    securityFields,
    capturedReports: { version, chipId, mac, security, efuseText },
  };
  await writeFile(path.join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  await writeFile(path.join(output, "RESTORE-COMMANDS-REFERENCE.txt"), makeRestoreReference(options.port, recovery.selected), { flag: "wx" });
  const hashes = await hashFiles(output);
  return { ok: true, deviceReadOnly: true, output, filesHashed: hashes.length, manifest };
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
      return 0;
    }
    if (options.dryRun) {
      console.log(JSON.stringify({
        ok: true,
        dryRun: true,
        hardwareAccessed: false,
        createsOutputDirectory: false,
        expectedChip: EXPECTED_CHIP,
        confirmation: EXPECTED_CONFIRMATION,
        plan: buildDryRunPlan(options),
      }, null, 2));
      return 0;
    }
    console.log(JSON.stringify(await performAudit(options), null, 2));
    return 0;
  } catch (error) {
    console.error(`Error: ${error.message}`);
    return 1;
  }
}

process.exitCode = await main();
