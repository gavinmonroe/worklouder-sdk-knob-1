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
const source = path.join(projectRoot, "custom-firmware/experimental/stage3e1-wpm-full-canvas.S");
const linkerScript = path.join(projectRoot, "custom-firmware/experimental/stage3e1-wpm-full-canvas.ld");
const pinnedHexPath = path.join(projectRoot, "custom-firmware/experimental/stage3e1-wpm-full-canvas.hex");

const expected = Object.freeze({
  literalAddress: 0x42116f10,
  literalSize: 0xbc,
  textAddress: 0x42116fcc,
  textSize: 0x444,
  binarySize: 0x500,
  sha256: "6842f6246ed40c0e5ddbcdc105b64e74126e7b86735c312d8c6c487b6418b05e",
  symbols: Object.freeze({
    stage3e1_screen_setup_wrapper: Object.freeze({ address: 0x42116fcc, size: 0xa2 }),
    stage3e1_make_image: Object.freeze({ address: 0x42117070, size: 0x30 }),
    stage3e1_make_label: Object.freeze({ address: 0x421170a0, size: 0x3a }),
    stage3e1_wpm_build: Object.freeze({ address: 0x421170dc, size: 0xa5 }),
    stage3e1_wpm_cleanup: Object.freeze({ address: 0x42117184, size: 0x13 }),
    stage3e1_wpm_id: Object.freeze({ address: 0x42117198, size: 0x07 }),
    stage3e1_sample_and_render: Object.freeze({ address: 0x421171a0, size: 0x224 }),
    stage3e1_wpm_ui_refresh: Object.freeze({ address: 0x421173c4, size: 0x4c }),
  }),
  requiredLiterals: Object.freeze([
    0x4202c108, // Original screen setup.
    0x420e7c04, // operator new.
    0x400011e8, // memset.
    0x3c1acc34, // Common controller vtable.
    0x4204da84, // Register controller.
    0x420293a8, // Register navigation ID.
    0x420ae8a0, // lv_image_create.
    0x420aeef0, // lv_image_set_src.
    0x4204f0d0, // LVGL center alignment wrapper.
    0x4204f170, // Label create.
    0x4204f018, // Font setter.
    0x4204ee30, // Label text setter.
    0x4204ef44, // Label color setter.
    0x3c18e960, // Small ASCII font.
    0x3c18ceac, // Large ASCII font.
    0x420f896c, // snprintf.
    0x3fcaba20, // Proven live WPM float.
    0x3c1c1190, // Sky descriptor 0.
    0x3c1c11a8, // Sky descriptor 1.
    0x3c1c11c0, // Cat descriptor 0.
    0x20677641, // "Avg "
    0x6f540a30, // "0\nTo"
    0x30203a70, // "p: 0"
    0x540a7525, // "%u\nT"
    0x203a706f, // "op: "
    65_536, // Long-session rebase threshold.
  ]),
  forbiddenLiterals: Object.freeze([
    0x4206eae0, // No global key hook in Stage-3E.1 code.
    0x3fcab378, // Rejected wrong manager object from Stage-3D.
    0x42003dc8, 0x3fca4f00, 0x42004f10, 0x4201a930, // Global bubble.
  ]),
});

function tool(name) {
  return path.join(toolchainBin, `xtensa-esp32s3-elf-${name}`);
}

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
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

function countU32(data, value) {
  const needle = Buffer.alloc(4);
  needle.writeUInt32LE(value >>> 0);
  let count = 0;
  for (let offset = 0; offset <= data.length - 4; offset += 1) {
    if (data.subarray(offset, offset + 4).equals(needle)) count += 1;
  }
  return count;
}

function functionBody(disassembly, symbol) {
  const start = disassembly.indexOf(`<${symbol}>:`);
  assertCondition(start >= 0, `Stage-3E.1 symbol ${symbol} is absent from disassembly.`);
  const next = disassembly.indexOf("\n\n", start);
  return disassembly.slice(start, next < 0 ? undefined : next);
}

const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "framer-stage3e1-abi-"));
const objectPath = path.join(temporaryDirectory, "stage3e.o");
const elfPath = path.join(temporaryDirectory, "stage3e.elf");
const binaryPath = path.join(temporaryDirectory, "stage3e.bin");

try {
  await run(tool("as"), ["-o", objectPath, source]);
  await run(tool("ld"), ["-T", linkerScript, "-o", elfPath, objectPath]);

  const header = await run(tool("objdump"), ["-f", "-h", elfPath]);
  assertCondition(/file format elf32-xtensa-le/u.test(header.stdout),
    "Stage-3E.1 did not link as ESP32-S3 little-endian ELF.");
  assertCondition(/\.stage3e1_literal\s+000000bc\s+42116f10\s+42116f10/u.test(header.stdout),
    "Stage-3E.1 literal address or size changed.");
  assertCondition(/\.stage3e1_text\s+00000444\s+42116fcc\s+42116fcc/u.test(header.stdout),
    "Stage-3E.1 text address or size changed.");

  const relocations = await run(tool("readelf"), ["-r", elfPath]);
  assertCondition(/There are no relocations in this file\./u.test(relocations.stdout),
    "Stage-3E.1 contains a final-link relocation.");

  const symbolOutput = await run(tool("nm"), ["-S", elfPath]);
  const symbols = parseSymbols(symbolOutput.stdout);
  for (const [name, wanted] of Object.entries(expected.symbols)) {
    const actual = symbols.get(name);
    assertCondition(actual !== undefined, `Stage-3E.1 symbol ${name} is missing.`);
    assertCondition(actual.address === wanted.address && actual.size === wanted.size,
      `Stage-3E.1 symbol ${name} moved or changed size.`);
  }

  const disassembly = (await run(tool("objdump"), ["-d", elfPath], {
    maxBuffer: 1024 * 1024,
  })).stdout;
  const build = functionBody(disassembly, "stage3e1_wpm_build");
  const sample = functionBody(disassembly, "stage3e1_sample_and_render");
  const refresh = functionBody(disassembly, "stage3e1_wpm_ui_refresh");
  const creationStores = [84, 88, 92, 96].map((offset) =>
    build.search(new RegExp(`s32i\\s+a10, a7, ${offset}`, "u")));
  assertCondition(creationStores.every((offset) => offset >= 0) &&
    creationStores.every((offset, index) => index === 0 || offset > creationStores[index - 1]),
  "Stage-3E.1 no longer creates sky, cat, WPM, and stats objects in pinned z-order.");
  assertCondition(/movi(?:\.n)?\s+a12, 3/u.test(build) &&
    /movi(?:\.n)?\s+a14, 2/u.test(build) &&
    /movi(?:\.n)?\s+a12, -3/u.test(build) &&
    /movi(?:\.n)?\s+a14, 5/u.test(build),
  "Stage-3E.1 WPM/stats label positions changed.");
  assertCondition(/l32i\s+a10, a7, 88/u.test(sample) &&
    /l32i\s+a8, a7, 92/u.test(sample) &&
    /l32i\s+a8, a7, 96/u.test(sample) &&
    /l32i\s+a10, a7, 84/u.test(refresh),
  "Stage-3E.1 image/label field offsets regressed.");
  for (const offset of [100, 104, 108, 116]) {
    assertCondition(new RegExp(`l32i\\s+a\\d+, a7, ${offset}`, "u").test(sample),
      `Stage-3E.1 render cache +${offset} is not read.`);
    assertCondition(new RegExp(`s32i\\s+a\\d+, a7, ${offset}`, "u").test(sample),
      `Stage-3E.1 render cache +${offset} is not updated.`);
  }
  assertCondition(!/l32i\s+a15, a7, 60/u.test(sample),
    "Stage-3E.1 rendered the internal low statistic again.");
  assertCondition(/movi(?:\.n)?\s+a9, 10[\s\S]*mull\s+a9, a6, a9[\s\S]*movi(?:\.n)?\s+a3, 9[\s\S]*mull\s+a8, a8, a3[\s\S]*bgeu\s+a9, a8/u.test(sample),
    "Stage-3E.1 lost its mature current*10 >= high*9 zoom rule.");
  assertCondition((sample.match(/l32r\s+a8, 42116f68/gu) ?? []).length >= 2,
    "Stage-3E.1 no longer re-centers both changed labels.");
  assertCondition(/movi(?:\.n)?\s+a2, 7[\s\S]*retw\.n/u.test(
    functionBody(disassembly, "stage3e1_wpm_id")),
  "Stage-3E.1 ID method no longer returns 7.");

  await run(tool("objcopy"), ["-O", "binary", elfPath, binaryPath]);
  const binary = await readFile(binaryPath);
  const pinnedHex = (await readFile(pinnedHexPath, "utf8")).replace(/\s+/gu, "");
  assertCondition(/^[0-9a-f]+$/u.test(pinnedHex) && pinnedHex.length % 2 === 0,
    "Pinned Stage-3E.1 ABI is not canonical lowercase hex.");
  assertCondition(binary.equals(Buffer.from(pinnedHex, "hex")),
    "Assembled Stage-3E.1 differs from the pinned artifact.");
  assertCondition(binary.length === expected.binarySize,
    `Stage-3E.1 binary size changed to ${binary.length}.`);
  const digest = createHash("sha256").update(binary).digest("hex");
  assertCondition(digest === expected.sha256, `Stage-3E.1 binary hash changed to ${digest}.`);
  for (const value of expected.requiredLiterals) {
    assertCondition(countU32(binary, value) >= 1,
      `Stage-3E.1 required literal 0x${value.toString(16)} is absent.`);
  }
  for (const value of expected.forbiddenLiterals) {
    assertCondition(countU32(binary, value) === 0,
      `Stage-3E.1 references forbidden value 0x${value.toString(16)}.`);
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
    fieldOffsets: { sky: 84, cat: 88, wpm: 92, stats: 96 },
    renderCaches: [100, 104, 108, 116],
  }, null, 2)}\n`);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
