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
const source = path.join(projectRoot, "custom-firmware/experimental/stage3c-wpm-abi.S");
const linkerScript = path.join(projectRoot, "custom-firmware/experimental/stage3c-wpm-abi.ld");
const pinnedHexPath = path.join(projectRoot, "custom-firmware/experimental/stage3c-wpm-abi.hex");

const expected = Object.freeze({
  literalAddress: 0x42116d2c,
  literalSize: 0x7c,
  textAddress: 0x42116da8,
  textSize: 0x1b8,
  binarySize: 0x234,
  sha256: "c661adce78963c562625ece9f647033b864c4e91816d00223c3c6b8800936003",
  symbols: Object.freeze({
    stage3c_screen_setup_wrapper: Object.freeze({ address: 0x42116da8, size: 0xb1 }),
    stage3c_wpm_show: Object.freeze({ address: 0x42116e5c, size: 0x42 }),
    stage3c_wpm_cleanup: Object.freeze({ address: 0x42116ea0, size: 0x1f }),
    stage3c_wpm_id: Object.freeze({ address: 0x42116ec0, size: 0x07 }),
    stage3c_wpm_ui_refresh: Object.freeze({ address: 0x42116ec8, size: 0x51 }),
    stage3c_key_callback_wrapper: Object.freeze({ address: 0x42116f1c, size: 0x41 }),
  }),
  literals: Object.freeze([
    0x4202c108, // Original complete screen setup.
    0x42004e1c, // Root getter.
    0x4210ad9c, // Root -> controller registry.
    0x42006888, // Screen manager getter.
    0x4210af48, // Current controller getter.
    0x420e7c04, // operator new.
    0x400011e8, // memset.
    0x3c1acc34, // Common controller base vtable.
    0x4204da84, // Add controller.
    0x420293a8, // Add navigation ID.
    0x4204d5dc, // Slot 0: lazy root construction.
    0x4210aefc, // Slot 1: no-op.
    0x4204d694, // Slot 2: active-view timer setup.
    0x42116e5c, // Slot 3: WPM activation.
    0x42116ea0, // Slot 4: WPM cleanup.
    0x4204d6d0, // Slot 5: timer teardown.
    0x42116ec8, // Slot 6: WPM LVGL refresh.
    0x42108834, // Slot 7: no-op.
    0x42116ec0, // Slot 8: ID getter.
    0x4210883c, // Slot 9: no-op.
    0x42108844, // Slot 10: no-op.
    0x42003dc8, // std::string assignment from C string.
    0x3fca4f00, // Existing bubble model.
    0x3c12e738, // Existing "wpm" string.
    0x3c12eaf7, // Existing "OK" string.
    0x42004f10, // Bubble view getter.
    0x4201a930, // Bubble update.
    0x420f896c, // snprintf.
    0x3c1258d8, // Existing "%4u" string.
    0x3fcaba20, // Native current-WPM float.
    0x4206eae0, // Original any-key callback.
  ]),
});

function tool(name) {
  return path.join(toolchainBin, `xtensa-esp32s3-elf-${name}`);
}

function parseSymbols(stdout) {
  const symbols = new Map();
  for (const line of stdout.split("\n")) {
    const match = /^([0-9a-f]+)\s+([0-9a-f]+)\s+[A-Za-z]\s+(\S+)$/u.exec(line.trim());
    if (match) symbols.set(match[3], { address: Number.parseInt(match[1], 16), size: Number.parseInt(match[2], 16) });
  }
  return symbols;
}

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "framer-stage3c-abi-"));
const objectPath = path.join(temporaryDirectory, "stage3c.o");
const elfPath = path.join(temporaryDirectory, "stage3c.elf");
const binaryPath = path.join(temporaryDirectory, "stage3c.bin");

try {
  await run(tool("as"), ["--no-transform", "-o", objectPath, source]);
  await run(tool("ld"), ["-T", linkerScript, "-o", elfPath, objectPath]);

  const header = await run(tool("objdump"), ["-f", "-h", elfPath]);
  assertCondition(/file format elf32-xtensa-le/u.test(header.stdout), "Stage-3C did not link as ESP32-S3 little-endian ELF.");
  assertCondition(
    /\.stage3c_literal\s+0000007c\s+42116d2c\s+42116d2c/u.test(header.stdout),
    "Stage-3C literal-pool address or size changed.",
  );
  assertCondition(
    /\.stage3c_text\s+000001b8\s+42116da8\s+42116da8/u.test(header.stdout),
    "Stage-3C text address or size changed.",
  );

  const relocations = await run(tool("readelf"), ["-r", elfPath]);
  assertCondition(/There are no relocations in this file\./u.test(relocations.stdout), "Stage-3C contains an unresolved relocation.");

  const symbolOutput = await run(tool("nm"), ["-S", elfPath]);
  const symbols = parseSymbols(symbolOutput.stdout);
  for (const [name, wanted] of Object.entries(expected.symbols)) {
    const actual = symbols.get(name);
    assertCondition(actual !== undefined, `Stage-3C symbol ${name} is missing.`);
    assertCondition(
      actual.address === wanted.address && actual.size === wanted.size,
      `Stage-3C symbol ${name} moved or changed size.`,
    );
  }

  const disassembly = await run(tool("objdump"), ["-d", elfPath], { maxBuffer: 1024 * 1024 });
  assertCondition(/stage3c_screen_setup_wrapper[\s\S]*or\s+a2, a4, a4[\s\S]*retw\.n/u.test(disassembly.stdout),
    "Setup wrapper does not return through its windowed a2 register.");
  assertCondition(/stage3c_wpm_id[\s\S]*movi\.n\s+a2, 7[\s\S]*retw\.n/u.test(disassembly.stdout),
    "Screen-ID method does not return ID 7 through its windowed a2 register.");
  assertCondition(/stage3c_key_callback_wrapper[\s\S]*or\s+a2, a5, a5[\s\S]*retw\.n/u.test(disassembly.stdout),
    "Key wrapper does not preserve the stock result through its windowed a2 register.");

  await run(tool("objcopy"), ["-O", "binary", elfPath, binaryPath]);
  const binary = await readFile(binaryPath);
  const pinnedHex = (await readFile(pinnedHexPath, "utf8")).replace(/\s+/gu, "");
  assertCondition(/^[0-9a-f]+$/u.test(pinnedHex) && pinnedHex.length % 2 === 0,
    "Pinned Stage-3C ABI artifact is not canonical lowercase hex.");
  const pinnedBinary = Buffer.from(pinnedHex, "hex");
  assertCondition(binary.length === expected.binarySize, `Stage-3C binary size changed to ${binary.length}.`);
  assertCondition(binary.equals(pinnedBinary), "Assembled Stage-3C bytes differ from the pinned builder artifact.");
  const digest = createHash("sha256").update(binary).digest("hex");
  assertCondition(digest === expected.sha256, `Stage-3C binary hash changed to ${digest}.`);
  for (const [index, value] of expected.literals.entries()) {
    assertCondition(binary.readUInt32LE(index * 4) === value, `Stage-3C literal ${index} changed.`);
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
    symbols: Object.fromEntries(
      Object.entries(expected.symbols).map(([name, value]) => [name, {
        address: `0x${value.address.toString(16)}`,
        size: value.size,
      }]),
    ),
  }, null, 2)}\n`);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
