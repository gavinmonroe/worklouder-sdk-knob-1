#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { parsePartitionTable } from "../f1-cli/recovery/lib.mjs";

const FULL_FLASH_BYTES = 0x1000000;
const PARTITION_TABLE_OFFSET = 0x8000;
const PARTITION_TABLE_BYTES = 0x1000;
const OFFICIAL_SHA256 = "c8926bd181bc06062d8c79221c6bb1c7f85463f0034444f263e1995cb383b976";

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

function safeLabel(label) {
  return label.replace(/[^a-z0-9._-]+/giu, "_");
}

async function writeBinary(target, data) {
  await writeFile(target, data);
  const saved = await readFile(target);
  if (!saved.equals(data)) throw new Error(`Verification read differs for ${target}.`);
}

async function hashRegularFiles(directory) {
  const ignored = new Set(["SHA256SUMS.txt"]);
  const names = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && !ignored.has(entry.name))
    .map((entry) => entry.name)
    .sort();
  const rows = [];
  for (const name of names) {
    const data = await readFile(path.join(directory, name));
    rows.push({ name, bytes: data.length, sha256: sha256(data) });
  }
  await writeFile(path.join(directory, "SHA256SUMS.txt"), `${rows.map((row) => `${row.sha256}  ${row.name}`).join("\n")}\n`);
  return rows;
}

async function main() {
  const directoryArg = process.argv[2];
  if (!directoryArg || process.argv.length !== 3) {
    throw new Error("Usage: node recovery/finalize-backup.mjs BACKUP_DIRECTORY");
  }
  const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const directory = path.resolve(directoryArg);
  const fullPath = path.join(directory, "full-flash-16mb.bin");
  const officialPath = path.join(projectRoot, "artifacts/firmware/firmware_0.4.1_merged.bin");
  const [full, official] = await Promise.all([readFile(fullPath), readFile(officialPath)]);

  if (full.length !== FULL_FLASH_BYTES) {
    throw new Error(`Full dump is ${full.length} bytes; expected ${FULL_FLASH_BYTES}.`);
  }
  if (sha256(official) !== OFFICIAL_SHA256) throw new Error("Pinned official 0.4.1 firmware hash mismatch.");
  const installedPrefixMatchesOfficial = full.subarray(0, official.length).equals(official);
  if (!installedPrefixMatchesOfficial) {
    throw new Error("Live flash prefix differs from the pinned official Framer 0.4.1 merged image.");
  }

  const partitionTable = full.subarray(PARTITION_TABLE_OFFSET, PARTITION_TABLE_OFFSET + PARTITION_TABLE_BYTES);
  const entries = parsePartitionTable(partitionTable);
  await writeBinary(path.join(directory, "partition-table.bin"), partitionTable);

  const extracted = [];
  for (const entry of entries) {
    const end = entry.offset + entry.size;
    if (end > full.length) throw new Error(`Partition ${entry.label} extends beyond the full dump.`);
    const name = `partition-${entry.index}-${safeLabel(entry.label)}-0x${entry.offset.toString(16)}-0x${entry.size.toString(16)}.bin`;
    const data = full.subarray(entry.offset, end);
    await writeBinary(path.join(directory, name), data);
    extracted.push({ ...entry, file: name, sha256: sha256(data) });
  }

  const manifest = {
    format: "framer-f1-live-recovery-set-v1",
    finalizedAt: new Date().toISOString(),
    device: {
      product: "Framer F1 / knob_f1",
      chip: "ESP32-S3 QFN56 revision 0.2",
      mac: "a4:cb:8f:af:32:10",
      detectedFlashBytes: FULL_FLASH_BYTES,
      embeddedPsramBytes: 0x200000,
    },
    securityObservedLive: {
      secureBoot: false,
      flashEncryption: false,
      spiBootCryptCount: 0,
      securityInfoFlags: 0,
      note: "Re-check captured eFuse/security reports before any restore.",
    },
    fullFlash: { file: path.basename(fullPath), bytes: full.length, sha256: sha256(full) },
    officialFirmwareComparison: {
      file: path.relative(projectRoot, officialPath),
      bytes: official.length,
      sha256: OFFICIAL_SHA256,
      installedPrefixMatchesExactly: installedPrefixMatchesOfficial,
    },
    partitionTable: { offset: PARTITION_TABLE_OFFSET, bytes: PARTITION_TABLE_BYTES },
    partitions: extracted,
    verifiedBaud: 115200,
    rejectedBaudsForLongReads: [921600, 460800],
  };
  await writeFile(path.join(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  const restoreReference = `# REFERENCE ONLY — review docs/recovery.md before use.\n` +
    `# Same-device full restore; never erase first and never add --force.\n` +
    `.venv-esptool/bin/esptool --chip esp32s3 --port /dev/cu.usbmodemNNNN --baud 115200 \\\n` +
    `  write-flash --flash-size keep 0x0 full-flash-16mb.bin\n`;
  await writeFile(path.join(directory, "RESTORE-COMMAND-REFERENCE.txt"), restoreReference);
  const hashes = await hashRegularFiles(directory);
  console.log(JSON.stringify({ ok: true, directory, manifest, hashedFiles: hashes.length }, null, 2));
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});

