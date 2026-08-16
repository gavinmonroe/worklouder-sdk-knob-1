#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { STAGE3B_CODE } from "../build-stage3b.mjs";

const run = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const toolchainBin = process.env.FRAMER_XTENSA_BIN ??
  path.join(projectRoot, ".toolchains/xtensa-esp-elf-13.2.0_20240530/bin");
const source = path.join(projectRoot, "custom-firmware/asm/stage3b-visible-canary.S");
const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "framer-stage3b-asm-"));
const objectPath = path.join(temporaryDirectory, "stage3b.o");
const binaryPath = path.join(temporaryDirectory, "stage3b.bin");

try {
  await run(path.join(toolchainBin, "xtensa-esp32s3-elf-as"), ["-o", objectPath, source]);
  const disassembly = await run(path.join(toolchainBin, "xtensa-esp32s3-elf-objdump"), ["-dr", objectPath]);
  if (/R_XTENSA_/u.test(disassembly.stdout)) {
    throw new Error("Stage-3B .text contains an unresolved Xtensa relocation.");
  }
  await run(path.join(toolchainBin, "xtensa-esp32s3-elf-objcopy"), [
    "-O", "binary",
    "--only-section=.text.stage3b_visible_canary",
    objectPath,
    binaryPath,
  ]);
  const assembled = await readFile(binaryPath);
  if (!assembled.equals(STAGE3B_CODE)) {
    throw new Error(`Assembly mismatch: expected ${STAGE3B_CODE.toString("hex")}, got ${assembled.toString("hex")}.`);
  }
  process.stdout.write(`${disassembly.stdout}\nVerified Stage-3B bytes: ${assembled.toString("hex")}\n`);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
