#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const toolchainBin = process.env.FRAMER_XTENSA_BIN ??
  path.join(projectRoot, ".toolchains/xtensa-esp-elf-13.2.0_20240530/bin");
const source = path.join(projectRoot, "custom-firmware/experimental/stage3c1-wpm-labels.S");
const linkerScript = path.join(projectRoot, "custom-firmware/experimental/stage3c1-wpm-labels.ld");
const pinnedHexPath = path.join(projectRoot, "custom-firmware/experimental/stage3c1-wpm-labels.hex");

const expected = Object.freeze({
  literalAddress: 0x42116d2c,
  literalSize: 0x78,
  textAddress: 0x42116da4,
  textSize: 0x16c,
  binarySize: 0x1e4,
  sha256: "f28b7b48ff43283824fcc3d440d7f591437bd1dc7b4880a7b88695a7df632712",
  symbols: Object.freeze({
    stage3c1_screen_setup_wrapper: Object.freeze({ address: 0x42116da4, size: 0x9e }),
    stage3c1_wpm_show: Object.freeze({ address: 0x42116e44, size: 0x76 }),
    stage3c1_wpm_cleanup: Object.freeze({ address: 0x42116ebc, size: 0x0b }),
    stage3c1_wpm_id: Object.freeze({ address: 0x42116ec8, size: 0x07 }),
    stage3c1_wpm_ui_refresh: Object.freeze({ address: 0x42116ed0, size: 0x3e }),
  }),
  literals: Object.freeze([
    0x4202c108, // Original complete screen setup.
    0x42004e1c, // Root getter.
    0x4210ad9c, // Root -> controller registry.
    0x42006888, // Screen manager getter.
    0x420e7c04, // operator new.
    0x400011e8, // memset.
    0x3c1acc34, // Common controller base vtable.
    0x4204da84, // Add controller.
    0x420293a8, // Add navigation ID.
    0x4204d5dc, // Slot 0: lazy root construction.
    0x42116e44, // Slot 1: WPM-owned label construction.
    0x4204d694, // Slot 2: active-view timer setup.
    0x4210882c, // Slot 3: stock no-op activation hook.
    0x42116ebc, // Slot 4: WPM cleanup.
    0x4204d6d0, // Slot 5: timer teardown.
    0x42116ed0, // Slot 6: WPM LVGL refresh.
    0x42108834, // Slot 7: no-op.
    0x42116ec8, // Slot 8: ID getter.
    0x4210883c, // Slot 9: no-op.
    0x42108844, // Slot 10: no-op.
    0x4204f170, // Label creation.
    0x4204f018, // Label style/font.
    0x4204f0d0, // Label alignment.
    0x4204ee30, // Label text.
    0x3c18e960, // Existing visible label font/style.
    0x3c12e738, // Existing "wpm" string.
    0x3c12eaf7, // Existing "OK" string.
    0x420f896c, // snprintf.
    0x3c1258d8, // Existing "%4u" string.
    0x3fcaba20, // Native current-WPM float.
  ]),
  forbiddenGlobalBubbleLiterals: Object.freeze([
    0x42003dc8, // std::string assignment from C string.
    0x3fca4f00, // Process-global Framer bubble model.
    0x42004f10, // Global bubble view getter.
    0x4201a930, // Global bubble update.
  ]),
});

function tool(name) {
  return path.join(toolchainBin, `xtensa-esp32s3-elf-${name}`);
}

function parseSymbols(stdout) {
  const symbols = new Map();
  for (const line of stdout.split("\n")) {
    const match = /^([0-9a-f]+)\s+([0-9a-f]+)\s+[A-Za-z]\s+(\S+)$/u.exec(line.trim());
    if (match) {
      symbols.set(match[3], {
        address: Number.parseInt(match[1], 16),
        size: Number.parseInt(match[2], 16),
      });
    }
  }
  return symbols;
}

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function countU32(data, value) {
  const needle = Buffer.alloc(4);
  needle.writeUInt32LE(value);
  let count = 0;
  for (let offset = 0; offset <= data.length - 4; offset += 1) {
    if (data.subarray(offset, offset + 4).equals(needle)) count += 1;
  }
  return count;
}

const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "framer-stage3c1-abi-"));
const objectPath = path.join(temporaryDirectory, "stage3c1.o");
const elfPath = path.join(temporaryDirectory, "stage3c1.elf");
const binaryPath = path.join(temporaryDirectory, "stage3c1.bin");

try {
  // Match the canonical Stage-3B path: allow the S3 assembler to select its
  // reviewed dense encodings, then compare every emitted byte to pinned hex.
  await run(tool("as"), ["-o", objectPath, source]);
  await run(tool("ld"), ["-T", linkerScript, "-o", elfPath, objectPath]);

  const header = await run(tool("objdump"), ["-f", "-h", elfPath]);
  assertCondition(/file format elf32-xtensa-le/u.test(header.stdout),
    "Stage-3C.1 did not link as ESP32-S3 little-endian ELF.");
  assertCondition(/\.stage3c1_literal\s+00000078\s+42116d2c\s+42116d2c/u.test(header.stdout),
    "Stage-3C.1 literal-pool address or size changed.");
  assertCondition(/\.stage3c1_text\s+0000016c\s+42116da4\s+42116da4/u.test(header.stdout),
    "Stage-3C.1 text address or size changed.");

  const relocations = await run(tool("readelf"), ["-r", elfPath]);
  assertCondition(/There are no relocations in this file\./u.test(relocations.stdout),
    "Stage-3C.1 contains an unresolved relocation.");

  const symbolOutput = await run(tool("nm"), ["-S", elfPath]);
  const symbols = parseSymbols(symbolOutput.stdout);
  for (const [name, wanted] of Object.entries(expected.symbols)) {
    const actual = symbols.get(name);
    assertCondition(actual !== undefined, `Stage-3C.1 symbol ${name} is missing.`);
    assertCondition(actual.address === wanted.address && actual.size === wanted.size,
      `Stage-3C.1 symbol ${name} moved or changed size.`);
  }

  const disassembly = await run(tool("objdump"), ["-d", elfPath], { maxBuffer: 1024 * 1024 });
  assertCondition(/stage3c1_screen_setup_wrapper[\s\S]*mov\.n\s+a2, a4[\s\S]*retw\.n/u.test(disassembly.stdout),
    "Setup wrapper does not return through its windowed a2 register.");
  assertCondition(/stage3c1_wpm_id[\s\S]*movi\.n\s+a2, 7[\s\S]*retw\.n/u.test(disassembly.stdout),
    "Screen-ID method does not return ID 7 through its windowed a2 register.");
  assertCondition(/stage3c1_wpm_ui_refresh[\s\S]*l32i\.n\s+a7, a2, 40[\s\S]*beqz\.n\s+a7/u.test(disassembly.stdout),
    "WPM refresh no longer fail-soft guards its owned value-label pointer.");

  await run(tool("objcopy"), ["-O", "binary", elfPath, binaryPath]);
  const binary = await readFile(binaryPath);
  const pinnedHex = (await readFile(pinnedHexPath, "utf8")).replace(/\s+/gu, "");
  assertCondition(/^[0-9a-f]+$/u.test(pinnedHex) && pinnedHex.length % 2 === 0,
    "Pinned Stage-3C.1 ABI artifact is not canonical lowercase hex.");
  const pinnedBinary = Buffer.from(pinnedHex, "hex");
  assertCondition(binary.length === expected.binarySize,
    `Stage-3C.1 binary size changed to ${binary.length}.`);
  assertCondition(binary.equals(pinnedBinary),
    "Assembled Stage-3C.1 bytes differ from the pinned builder artifact.");
  const digest = createHash("sha256").update(binary).digest("hex");
  assertCondition(digest === expected.sha256, `Stage-3C.1 binary hash changed to ${digest}.`);
  for (const [index, value] of expected.literals.entries()) {
    assertCondition(binary.readUInt32LE(index * 4) === value, `Stage-3C.1 literal ${index} changed.`);
  }
  for (const value of expected.forbiddenGlobalBubbleLiterals) {
    assertCondition(countU32(binary, value) === 0,
      `Stage-3C.1 still references forbidden global bubble value 0x${value.toString(16)}.`);
  }

  process.stdout.write(`${disassembly.stdout}\n`);
  process.stdout.write(`${JSON.stringify({
    format: "elf32-xtensa-le",
    relocations: 0,
    literalAddress: `0x${expected.literalAddress.toString(16)}`,
    literalSize: expected.literalSize,
    textAddress: `0x${expected.textAddress.toString(16)}`,
    textSize: expected.textSize,
    binarySize: binary.length,
    sha256: digest,
    globalBubbleReferences: 0,
    symbols: Object.fromEntries(Object.entries(expected.symbols).map(([name, value]) => [name, {
      address: `0x${value.address.toString(16)}`,
      size: value.size,
    }])),
  }, null, 2)}\n`);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
