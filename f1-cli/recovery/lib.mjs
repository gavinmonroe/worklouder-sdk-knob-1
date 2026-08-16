import { constants as fsConstants } from "node:fs";
import { access, readdir, stat } from "node:fs/promises";
import path from "node:path";

export const EXPECTED_CHIP = "esp32s3";
export const EXPECTED_CONFIRMATION = "FRAMER-F1";
export const PARTITION_TABLE_OFFSET = 0x8000;
export const PARTITION_TABLE_SIZE = 0x1000;

const SERIAL_PORT_PATTERN = /^(?:cu\.(?:usbmodem|usbserial|SLAB_USBtoUART|wchusbserial|serial)|tty(?:ACM|USB)\d+)/iu;
const ALLOWED_ESPTOOL_COMMANDS = new Set([
  "version",
  "chip-id",
  "read-mac",
  "flash-id",
  "get-security-info",
  "read-flash",
]);

export function isLikelyBootloaderPort(port) {
  return typeof port === "string" && path.dirname(port) === "/dev" && SERIAL_PORT_PATTERN.test(path.basename(port));
}

export async function listLikelyBootloaderPorts() {
  const names = await readdir("/dev");
  return names.map((name) => path.join("/dev", name)).filter(isLikelyBootloaderPort).sort();
}

export async function validateLivePort(port) {
  if (!isLikelyBootloaderPort(port)) {
    throw new Error(`Refusing non-standard serial port: ${String(port)}`);
  }
  const info = await stat(port);
  if (!info.isCharacterDevice()) {
    throw new Error(`Serial target is not a character device: ${port}`);
  }
  return port;
}

export function assertReadOnlyInvocation(kind, args) {
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
    throw new TypeError("Tool arguments must be a string array.");
  }
  const lower = args.map((arg) => arg.toLowerCase());
  const forbidden = lower.find((arg) =>
    arg === "--force" || /^(?:write[-_]|erase(?:[-_]|$)|burn[-_]|encrypt[-_]|set[-_]flash|flash[-_]crypt|run$|load[-_]ram)/u.test(arg)
  );
  if (forbidden) {
    throw new Error(`Refusing mutating tool argument: ${forbidden}`);
  }

  if (kind === "esptool") {
    const commands = lower.filter((arg) => ALLOWED_ESPTOOL_COMMANDS.has(arg));
    if (commands.length !== 1) {
      throw new Error("esptool invocation must contain exactly one audited read-only command.");
    }
    return commands[0];
  }
  if (kind === "espefuse") {
    if (!lower.includes("summary") || lower.some((arg) => arg !== "summary" && /^(?:burn|write|protect|set)/u.test(arg))) {
      throw new Error("Only `espefuse summary` is permitted.");
    }
    return "summary";
  }
  throw new Error(`Unknown tool kind: ${kind}`);
}

export async function findExecutable(explicit, candidates) {
  if (explicit) {
    const absolute = path.resolve(explicit);
    await access(absolute, fsConstants.X_OK);
    return absolute;
  }
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!directory) continue;
    for (const candidate of candidates) {
      const executable = path.join(directory, candidate);
      try {
        await access(executable, fsConstants.X_OK);
        return executable;
      } catch {
        // Continue searching PATH.
      }
    }
  }
  throw new Error(`Could not find ${candidates.join(" or ")} on PATH.`);
}

export function parsePartitionTable(data) {
  if (!Buffer.isBuffer(data) || data.length < 32) {
    throw new Error("Partition table must contain at least one 32-byte entry.");
  }
  const entries = [];
  for (let cursor = 0; cursor + 32 <= data.length; cursor += 32) {
    const magic = data.readUInt16LE(cursor);
    if (magic === 0xffff || magic === 0xebeb) break;
    if (magic !== 0x50aa) {
      throw new Error(`Invalid partition magic 0x${magic.toString(16)} at table offset 0x${cursor.toString(16)}.`);
    }
    const offset = data.readUInt32LE(cursor + 4);
    const size = data.readUInt32LE(cursor + 8);
    const label = data
      .subarray(cursor + 12, cursor + 28)
      .toString("utf8")
      .replace(/\0.*$/u, "");
    if (!label || offset % 0x1000 !== 0 || size === 0 || size % 0x1000 !== 0) {
      throw new Error(`Unsafe partition entry at table offset 0x${cursor.toString(16)}.`);
    }
    entries.push({
      index: entries.length,
      type: data[cursor + 2],
      subtype: data[cursor + 3],
      offset,
      size,
      label,
      flags: data.readUInt32LE(cursor + 28),
    });
  }
  if (entries.length === 0) throw new Error("No ESP partition entries found.");
  return entries;
}

export function selectRecoveryPartitions(entries, flashSize) {
  const sorted = [...entries].sort((a, b) => a.offset - b.offset);
  let previousEnd = 0;
  for (const entry of sorted) {
    const end = entry.offset + entry.size;
    if (!Number.isSafeInteger(end) || end > flashSize || entry.offset < previousEnd) {
      throw new Error(`Partition ${entry.label} is overlapping or outside detected flash.`);
    }
    previousEnd = end;
  }

  const factory = sorted.find((entry) => entry.type === 0 && entry.subtype === 0);
  if (!factory || factory.offset !== 0x10000) {
    throw new Error("Expected a factory app partition at 0x10000; refusing this target.");
  }
  const selected = sorted.filter((entry) => {
    if (entry.type !== 1) return false;
    if (entry.subtype === 0x02 || entry.subtype === 0x82 || entry.subtype === 0x83) return true;
    return /^(?:nvs|fs|littlefs|spiffs)$/iu.test(entry.label);
  });
  if (!selected.some((entry) => entry.subtype === 0x02 || /^nvs$/iu.test(entry.label))) {
    throw new Error("No NVS partition found; refusing an incomplete recovery audit.");
  }
  if (!selected.some((entry) => /^(?:fs|littlefs|spiffs)$/iu.test(entry.label) || entry.subtype === 0x82 || entry.subtype === 0x83)) {
    throw new Error("No filesystem/LittleFS-compatible partition found; refusing an incomplete recovery audit.");
  }
  return { factory, selected };
}

export function parseDetectedFlashSize(output) {
  const match = output.match(/Detected flash size:\s*(\d+)\s*(KB|MB)/iu);
  if (!match) throw new Error("Could not parse detected flash size from esptool output.");
  const amount = Number(match[1]);
  const multiplier = match[2].toUpperCase() === "MB" ? 1024 * 1024 : 1024;
  const bytes = amount * multiplier;
  if (!Number.isSafeInteger(bytes) || bytes < 4 * 1024 * 1024 || bytes > 32 * 1024 * 1024) {
    throw new Error(`Refusing implausible ESP32-S3 flash size: ${match[0]}`);
  }
  return bytes;
}

export function assertFramerIdentity(probe) {
  const hasProduct = probe.includes(Buffer.from("Framer F1"));
  const hasVendorRpc = probe.includes(Buffer.from("v.framer.bubble"));
  if (!hasProduct || !hasVendorRpc) {
    throw new Error("Factory partition probe does not contain both Framer F1 identity markers; refusing full dump.");
  }
}

export function hex(value) {
  return `0x${value.toString(16)}`;
}

export function safePartitionFilename(entry) {
  const label = entry.label.replace(/[^a-z0-9._-]+/giu, "_");
  return `partition-${entry.index}-${label}-${hex(entry.offset)}-${hex(entry.size)}.bin`;
}

export function buildDryRunPlan({ port, baud = 115200 }) {
  const common = ["--chip", EXPECTED_CHIP, "--port", port, "--baud", String(baud)];
  return [
    ["esptool", ...common, "chip-id"],
    ["esptool", ...common, "read-mac"],
    ["esptool", ...common, "--no-stub", "get-security-info"],
    ["espefuse", "--chip", EXPECTED_CHIP, "--port", port, "summary"],
    ["espefuse", "--chip", EXPECTED_CHIP, "--port", port, "summary", "--format", "json", "--file", "<fresh-output>/efuse-summary.json"],
    ["esptool", ...common, "flash-id"],
    ["esptool", ...common, "read-flash", hex(PARTITION_TABLE_OFFSET), hex(PARTITION_TABLE_SIZE), "<fresh-output>/partition-table.bin"],
    ["esptool", ...common, "read-flash", "<factory-offset>", "0x10000", "<fresh-output>/identity-probe.bin"],
    ["verify", "identity-probe contains `Framer F1` and `v.framer.bubble`"],
    ["esptool", ...common, "read-flash", "0x0", "ALL", "<fresh-output>/full-flash.bin"],
    ["esptool", ...common, "read-flash", "<nvs-offset>", "<nvs-size>", "<fresh-output>/partition-nvs.bin"],
    ["esptool", ...common, "read-flash", "<filesystem-offset>", "<filesystem-size>", "<fresh-output>/partition-fs.bin"],
    ["sha256", "all captured reports and binary images"],
  ];
}
