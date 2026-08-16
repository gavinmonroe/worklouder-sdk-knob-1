#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const bin = process.env.FRAMER_XTENSA_BIN ?? path.join(root, ".toolchains/xtensa-esp-elf-13.2.0_20240530/bin");
const source = path.join(root, "custom-firmware/experimental/stage3e3a-i4-canary.S");
const linker = path.join(root, "custom-firmware/experimental/stage3e3a-i4-canary.ld");
const pinnedHex = path.join(root, "custom-firmware/experimental/stage3e3a-i4-canary.hex");
const expected = Object.freeze({
  bytes: 0x244,
  sha256: "13cc66c1d97616af9c3efa535133fb3b40e1a509eabe6bb5b62342c6f19f3f6d",
  symbols: Object.freeze({
    stage3e3a_screen_setup_wrapper: [0x42116fa0, 0x9e],
    stage3e3a_wpm_show: [0x42117040, 0xba],
    stage3e3a_wpm_cleanup: [0x421170fc, 0x0d],
    stage3e3a_wpm_id: [0x4211710c, 0x07],
    stage3e3a_wpm_ui_refresh: [0x42117114, 0x3e],
  }),
});
const tool = (name) => path.join(bin, `xtensa-esp32s3-elf-${name}`);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const temp = await mkdtemp(path.join(os.tmpdir(), "framer-stage3e3a-abi-"));
try {
  const object = path.join(temp, "canary.o");
  const elf = path.join(temp, "canary.elf");
  const raw = path.join(temp, "canary.bin");
  await run(tool("as"), ["-o", object, source]);
  await run(tool("ld"), ["-T", linker, "-o", elf, object]);
  const sections = (await run(tool("objdump"), ["-f", "-h", elf])).stdout;
  assert(/file format elf32-xtensa-le/u.test(sections), "Stage-3E.3A is not S3 little-endian ELF.");
  assert(/\.stage3e3a_literal\s+00000090\s+42116f10\s+42116f10/u.test(sections), "Stage-3E.3A literal layout changed.");
  assert(/\.stage3e3a_text\s+000001b4\s+42116fa0\s+42116fa0/u.test(sections), "Stage-3E.3A text layout changed.");
  const relocations = (await run(tool("readelf"), ["-r", elf])).stdout;
  assert(/There are no relocations in this file\./u.test(relocations), "Stage-3E.3A contains relocations.");
  const nm = (await run(tool("nm"), ["-S", elf])).stdout;
  for (const [name, [address, size]] of Object.entries(expected.symbols)) {
    assert(new RegExp(`^${address.toString(16)}\\s+${size.toString(16).padStart(8, "0")}\\s+T\\s+${name}$`, "mu").test(nm),
      `Stage-3E.3A symbol ${name} moved or changed size.`);
  }
  const disassembly = (await run(tool("objdump"), ["-d", elf], { maxBuffer: 1024 * 1024 })).stdout;
  assert(/stage3e3a_wpm_id[\s\S]*movi\.n\s+a2, 7[\s\S]*retw\.n/u.test(disassembly), "Stage-3E.3A no longer returns screen ID7.");
  assert(/stage3e3a_wpm_show[\s\S]*l32i\.n\s+a10, a5, 12[\s\S]*movi\s+a11, 255[\s\S]*movi\.n\s+a11, 9/u.test(disassembly),
    "Stage-3E.3A lost root opacity or centered image creation.");
  assert(/stage3e3a_wpm_ui_refresh[\s\S]*l32i\.n\s+a7, a2, 40[\s\S]*beqz\.n\s+a7/u.test(disassembly),
    "Stage-3E.3A WPM label guard changed.");
  await run(tool("objcopy"), ["-O", "binary", elf, raw]);
  const [assembled, hexText] = await Promise.all([readFile(raw), readFile(pinnedHex, "utf8")]);
  const pinned = Buffer.from(hexText.replace(/\s+/gu, ""), "hex");
  const hash = createHash("sha256").update(assembled).digest("hex");
  assert(assembled.length === expected.bytes && assembled.equals(pinned) && hash === expected.sha256,
    "Stage-3E.3A source does not reproduce the pinned ABI artifact.");
  for (const forbidden of [0x3fcab378, 0x3fca4f00, 0x42003dc8, 0x4200c4c0, 0x4210bfac, 0x420a87e0]) {
    const needle = Buffer.alloc(4); needle.writeUInt32LE(forbidden);
    assert(!assembled.includes(needle), `Stage-3E.3A contains forbidden hook/cache value 0x${forbidden.toString(16)}.`);
  }
  const descriptor = Buffer.alloc(4); descriptor.writeUInt32LE(0x3c1c1190);
  const setSource = Buffer.alloc(4); setSource.writeUInt32LE(0x420aeef0);
  assert(assembled.indexOf(descriptor) === assembled.lastIndexOf(descriptor), "Stage-3E.3A must use one descriptor literal.");
  assert(assembled.indexOf(setSource) === assembled.lastIndexOf(setSource), "Stage-3E.3A must expose one static source setter.");
  console.log(JSON.stringify({ format: "elf32-xtensa-le", relocations: 0, bytes: assembled.length,
    sha256: hash, literal: "0x42116f10+0x90", text: "0x42116fa0+0x1b4", symbols: expected.symbols }, null, 2));
} finally {
  await rm(temp, { recursive: true, force: true });
}
