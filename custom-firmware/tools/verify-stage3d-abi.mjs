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
const source = path.join(projectRoot, "custom-firmware/experimental/stage3d-wpm-pet.S");
const linkerScript = path.join(projectRoot, "custom-firmware/experimental/stage3d-wpm-pet.ld");
const pinnedHexPath = path.join(projectRoot, "custom-firmware/experimental/stage3d-wpm-pet.hex");

const expected = Object.freeze({
  literalAddress: 0x42116f10,
  literalSize: 0xdc,
  textAddress: 0x42116fec,
  textSize: 0x43c,
  binarySize: 0x518,
  sha256: "e7788b20cd4d8733f67c96f16e7a4dfc71834f2e8a425279bf562e4fa34d6a17",
  symbols: Object.freeze({
    stage3d_screen_setup_wrapper: Object.freeze({ address: 0x42116fec, size: 0xa2 }),
    stage3d_make_label: Object.freeze({ address: 0x42117090, size: 0x38 }),
    stage3d_reset_session: Object.freeze({ address: 0x421170c8, size: 0x29 }),
    stage3d_wpm_build: Object.freeze({ address: 0x421170f4, size: 0x85 }),
    stage3d_wpm_cleanup: Object.freeze({ address: 0x4211717c, size: 0x13 }),
    stage3d_wpm_id: Object.freeze({ address: 0x42117190, size: 0x07 }),
    stage3d_write_face: Object.freeze({ address: 0x42117198, size: 0x59 }),
    stage3d_sample_and_render: Object.freeze({ address: 0x421171f4, size: 0x187 }),
    stage3d_wpm_ui_refresh: Object.freeze({ address: 0x4211737c, size: 0x6e }),
    stage3d_key_callback_wrapper: Object.freeze({ address: 0x421173ec, size: 0x3c }),
  }),
  requiredLiterals: Object.freeze([
    0x4202c108, // Original complete screen setup.
    0x4206eae0, // Original stock WPM/key middleware callback.
    0x3fcab378, // Static screen-manager object.
    0x420e7c04, // operator new.
    0x400011e8, // memset.
    0x3c1acc34, // Common controller base vtable.
    0x4204da84, // Add controller.
    0x420293a8, // Add navigation ID.
    0x421170f4, // Slot 1: pet label builder.
    0x4211717c, // Slot 4: borrowed-label cleanup.
    0x4211737c, // Slot 6: LVGL UI refresh.
    0x42117190, // Slot 8: screen ID 7.
    0x4204f170, // Label creation.
    0x4204f018, // Label style/font.
    0x4204f0d0, // Label alignment.
    0x4204ee30, // Label text copy.
    0x3c18e960, // Small ASCII font.
    0x3c18ceac, // Large ASCII font.
    0x420f896c, // snprintf.
    0x3fcaba20, // Stock current-WPM float.
    3000, // Five-minute session-reset threshold in 100-ms ticks.
    65_536, // Long-session sum/count rebase threshold.
  ]),
  forbiddenGlobalBubbleLiterals: Object.freeze([
    0x42003dc8,
    0x3fca4f00,
    0x42004f10,
    0x4201a930,
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
  needle.writeUInt32LE(value >>> 0);
  let count = 0;
  for (let offset = 0; offset <= data.length - 4; offset += 1) {
    if (data.subarray(offset, offset + 4).equals(needle)) count += 1;
  }
  return count;
}

const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "framer-stage3d-abi-"));
const objectPath = path.join(temporaryDirectory, "stage3d.o");
const elfPath = path.join(temporaryDirectory, "stage3d.elf");
const binaryPath = path.join(temporaryDirectory, "stage3d.bin");

try {
  await run(tool("as"), ["-o", objectPath, source]);
  await run(tool("ld"), ["-T", linkerScript, "-o", elfPath, objectPath]);

  const header = await run(tool("objdump"), ["-f", "-h", elfPath]);
  assertCondition(/file format elf32-xtensa-le/u.test(header.stdout),
    "Stage-3D did not link as ESP32-S3 little-endian ELF.");
  assertCondition(/\.stage3d_literal\s+000000dc\s+42116f10\s+42116f10/u.test(header.stdout),
    "Stage-3D literal-pool address or size changed.");
  assertCondition(/\.stage3d_text\s+0000043c\s+42116fec\s+42116fec/u.test(header.stdout),
    "Stage-3D text address or size changed.");

  const relocations = await run(tool("readelf"), ["-r", elfPath]);
  assertCondition(/There are no relocations in this file\./u.test(relocations.stdout),
    "Stage-3D contains a final-link relocation.");

  const symbolOutput = await run(tool("nm"), ["-S", elfPath]);
  const symbols = parseSymbols(symbolOutput.stdout);
  for (const [name, wanted] of Object.entries(expected.symbols)) {
    const actual = symbols.get(name);
    assertCondition(actual !== undefined, `Stage-3D symbol ${name} is missing.`);
    assertCondition(actual.address === wanted.address && actual.size === wanted.size,
      `Stage-3D symbol ${name} moved or changed size.`);
  }

  const disassembly = await run(tool("objdump"), ["-d", elfPath], { maxBuffer: 1024 * 1024 });
  const keyStart = disassembly.stdout.indexOf("<stage3d_key_callback_wrapper>:");
  assertCondition(keyStart >= 0, "Stage-3D key wrapper is absent from disassembly.");
  const keyBody = disassembly.stdout.slice(keyStart);
  assertCondition((keyBody.match(/\bmemw\b/gu) ?? []).length === 2,
    "Stage-3D key wrapper must bracket its epoch update with two memory barriers.");
  assertCondition(/mov\.n\s+a2, a5[\s\S]*retw\.n/u.test(keyBody),
    "Stage-3D key wrapper does not return the stock result through windowed a2.");
  assertCondition(/stage3d_wpm_id[\s\S]*movi\.n\s+a2, 7[\s\S]*retw\.n/u.test(disassembly.stdout),
    "Stage-3D ID method no longer returns screen ID 7.");

  await run(tool("objcopy"), ["-O", "binary", elfPath, binaryPath]);
  const binary = await readFile(binaryPath);
  const pinnedHex = (await readFile(pinnedHexPath, "utf8")).replace(/\s+/gu, "");
  assertCondition(/^[0-9a-f]+$/u.test(pinnedHex) && pinnedHex.length % 2 === 0,
    "Pinned Stage-3D ABI is not canonical lowercase hex.");
  const pinnedBinary = Buffer.from(pinnedHex, "hex");
  assertCondition(binary.length === expected.binarySize,
    `Stage-3D binary size changed to ${binary.length}.`);
  assertCondition(binary.equals(pinnedBinary),
    "Assembled Stage-3D bytes differ from the pinned builder artifact.");
  const digest = createHash("sha256").update(binary).digest("hex");
  assertCondition(digest === expected.sha256, `Stage-3D binary hash changed to ${digest}.`);

  for (const value of expected.requiredLiterals) {
    assertCondition(countU32(binary, value) >= 1,
      `Stage-3D required literal 0x${value.toString(16)} is absent.`);
  }
  for (const value of expected.forbiddenGlobalBubbleLiterals) {
    assertCondition(countU32(binary, value) === 0,
      `Stage-3D references forbidden global bubble value 0x${value.toString(16)}.`);
  }
  for (const ascii of ["/\\_/\\\0", "%u wpm\0", "A%u H%u L%u\0", "(o.o", "(^O^"]) {
    assertCondition(binary.includes(Buffer.from(ascii, "ascii")),
      `Stage-3D pinned artifact is missing ASCII payload ${JSON.stringify(ascii)}.`);
  }

  process.stdout.write(`${JSON.stringify({
    format: "elf32-xtensa-le",
    relocations: 0,
    literalAddress: `0x${expected.literalAddress.toString(16)}`,
    literalSize: expected.literalSize,
    textAddress: `0x${expected.textAddress.toString(16)}`,
    textSize: expected.textSize,
    endAddress: `0x${(expected.textAddress + expected.textSize).toString(16)}`,
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
