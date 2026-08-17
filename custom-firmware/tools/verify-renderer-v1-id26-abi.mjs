#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const bin = process.env.FRAMER_XTENSA_BIN ??
  path.join(root, ".toolchains/xtensa-esp-elf-13.2.0_20240530/bin");
const source = path.join(root, "custom-firmware/experimental/renderer-v1-id26.c");
const linker = path.join(root, "custom-firmware/experimental/renderer-v1-id26.ld");
const tool = (name) => path.join(bin, `xtensa-esp32s3-elf-${name}`);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const expected = Object.freeze({
  literalAddress: 0x42119000,
  literalBytes: 0x194,
  textAddress: 0x42119194,
  textBytes: 0x1e38,
  endAddress: 0x4211afcc,
  binaryBytes: 8140,
  binarySha256: "942fe3aeb723c24a9d66b2d8b0dfe6fffa04c6ff13c75777daf226456dbbe806",
  symbols: Object.freeze({
    renderer_v1_cleanup: [0x42119194, 0x0b],
    renderer_v1_id: [0x421191a0, 0x07],
    renderer_v1_encoder: [0x421191a8, 0x46],
    renderer_v1_build: [0x421191f0, 0x4f],
    renderer_v1_tick: [0x42119240, 0x826],
    renderer_v1_can_begin: [0x42119a78, 0x2e],
    renderer_v1_prepare_store: [0x42119aa8, 0x45],
    renderer_v1_stage_bundle: [0x42119af0, 0x606],
    renderer_v1_register_id26: [0x4211a0f8, 0xde],
  }),
});

function parseSymbols(output) {
  const symbols = new Map();
  for (const line of output.split("\n")) {
    const match = /^([0-9a-f]+)\s+([0-9a-f]+)\s+[A-Za-z]\s+(\S+)$/u.exec(line.trim());
    if (match) symbols.set(match[3], [Number.parseInt(match[1], 16), Number.parseInt(match[2], 16)]);
  }
  return symbols;
}
function body(disassembly, symbol) {
  const start = disassembly.indexOf(`<${symbol}>:`);
  assert(start >= 0, `Renderer symbol ${symbol} is absent from disassembly.`);
  const next = disassembly.indexOf("\n\n", start);
  return disassembly.slice(start, next < 0 ? undefined : next);
}
function countU32(data, value) {
  const wanted = Buffer.alloc(4); wanted.writeUInt32LE(value >>> 0);
  let count = 0;
  for (let offset = 0; offset <= data.length - 4; offset++)
    if (data.subarray(offset, offset + 4).equals(wanted)) count++;
  return count;
}

const compileFlags = ["-c", "-Os", "-mlongcalls", "-std=c11", "-ffreestanding", "-fno-builtin",
  "-fno-jump-tables", "-fno-tree-switch-conversion", "-fdata-sections", "-ffunction-sections",
  "-fno-unwind-tables", "-fno-asynchronous-unwind-tables", "-Wall", "-Wextra", "-Werror"];
const temp = await mkdtemp(path.join(os.tmpdir(), "renderer-v1-id26-abi-"));
try {
  const libgcc = (await run(tool("gcc"), ["-print-libgcc-file-name"])).stdout.trim();
  const binaries = [];
  for (let pass = 0; pass < 2; pass++) {
    const object = path.join(temp, `renderer-${pass}.o`);
    const elf = path.join(temp, `renderer-${pass}.elf`);
    const raw = path.join(temp, `renderer-${pass}.bin`);
    await run(tool("gcc"), [...compileFlags, "-o", object, source]);
    await run(tool("ld"), ["-T", linker, "-o", elf, object, libgcc]);

    const sections = (await run(tool("objdump"), ["-f", "-h", elf])).stdout;
    assert(/file format elf32-xtensa-le/u.test(sections), "Renderer is not S3 little-endian ELF.");
    assert(/\.renderer_v1_literal\s+00000194\s+42119000/u.test(sections), "Renderer literal section moved.");
    assert(/\.renderer_v1_text\s+00001e38\s+42119194/u.test(sections), "Renderer text section moved.");
    assert(!/\.renderer_v1_rodata\s+0*[^0\s]/u.test(sections) && !/\.eh_frame\s/u.test(sections),
      "Renderer emitted ordinary IROM data or unwind data.");

    const relocations = (await run(tool("readelf"), ["-r", elf])).stdout;
    assert(/There are no relocations in this file\./u.test(relocations), "Renderer has final relocations.");
    const undefinedSymbols = (await run(tool("nm"), ["-u", elf])).stdout.trim();
    assert(undefinedSymbols === "", `Renderer has undefined symbols: ${undefinedSymbols}`);
    const symbols = parseSymbols((await run(tool("nm"), ["-S", elf])).stdout);
    for (const [name, wanted] of Object.entries(expected.symbols))
      assert(JSON.stringify(symbols.get(name)) === JSON.stringify(wanted), `Renderer symbol ${name} moved.`);

    const disassembly = (await run(tool("objdump"), ["-d", elf], { maxBuffer: 4 * 1024 * 1024 })).stdout;
    const register = body(disassembly, "renderer_v1_register_id26");
    const encoder = body(disassembly, "renderer_v1_encoder");
    const stage = body(disassembly, "renderer_v1_stage_bundle");
    const tick = body(disassembly, "renderer_v1_tick");
    const id = body(disassembly, "renderer_v1_id");
    assert(/movi(?:\.n)?\s+a2, 26[\s\S]*retw\.n/u.test(id), "ID method no longer returns 26 in a2.");
    assert(/bnei\s+a3, 1/u.test(encoder) && /extui\s+a4, a4, 0, 8/u.test(encoder) &&
      /sext\s+a4, a4, 7/u.test(encoder) && (encoder.match(/callx8\s+a8/gu) ?? []).length === 2,
    "Slot9 lost bottom-encoder/Fn/signed-delta ABI.");
    assert(/l32i(?:\.n)?\s+a8, a2, 20[\s\S]*beq\s+a8, a7[\s\S]*movi(?:\.n)?\s+a11, 26/u.test(register) &&
      /* Allocation, addController, and addNavigation are all visible calls;
       * their exact firmware targets are independently pinned below. */
      (register.match(/callx8\s+a8/gu) ?? []).length === 3,
    "Registration lost allocation/addController association gate/addNavigation sequence.");
    assert((stage.match(/memw/gu) ?? []).length >= 2 && (tick.match(/memw/gu) ?? []).length >= 2,
      "Producer/UI handoff lost Xtensa memory barriers.");

    await run(tool("objcopy"), ["-O", "binary", elf, raw]);
    const binary = await readFile(raw); binaries.push(binary);
    assert(binary.length === expected.binaryBytes && sha256(binary) === expected.binarySha256,
      `Renderer bytes changed: ${binary.length} bytes ${sha256(binary)}.`);
    assert(countU32(binary, 0x4202c108) === 0, "Renderer illegally embeds the stock setup function.");
    for (const address of [0x420e7c04, 0x4204da84, 0x420293a8, 0x420ae8a0, 0x420aeef0,
      0x4204f0d0, 0x4200c4c0, 0x4210bfac, 0x3c1acc34])
      assert(countU32(binary, address) >= 1, `Renderer lost pinned ABI literal 0x${address.toString(16)}.`);
  }
  assert(binaries[0].equals(binaries[1]), "Renderer compiler/link output is not deterministic.");
  console.log(JSON.stringify({
    status: "PASS_STATIC_ONLY",
    format: "elf32-xtensa-le",
    relocations: 0,
    ordinaryIromDataBytes: 0,
    screenId: 26,
    allocationBytes: 62164,
    f1wbCapBytes: 98304,
    literal: { address: `0x${expected.literalAddress.toString(16)}`, bytes: expected.literalBytes },
    text: { address: `0x${expected.textAddress.toString(16)}`, bytes: expected.textBytes },
    endAddress: `0x${expected.endAddress.toString(16)}`,
    entry: `0x${expected.symbols.renderer_v1_register_id26[0].toString(16)}`,
    stageBundle: `0x${expected.symbols.renderer_v1_stage_bundle[0].toString(16)}`,
    binaryBytes: expected.binaryBytes,
    sha256: expected.binarySha256,
  }, null, 2));
} finally {
  await rm(temp, { recursive: true, force: true });
}
