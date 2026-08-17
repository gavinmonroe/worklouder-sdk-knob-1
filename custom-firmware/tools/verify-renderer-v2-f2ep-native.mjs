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
const tool = (name) => path.join(bin, `xtensa-esp32s3-elf-${name}`);
const source = path.join(root, "custom-firmware/experimental/renderer-v2-f2ep-native.c");
const linker = path.join(root, "custom-firmware/experimental/renderer-v2-f2ep-native.ld");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const expected = Object.freeze({
  literalAddress: 0x4211b000, literalBytes: 0x28c,
  textAddress: 0x4211b28c, textBytes: 0x224a, endAddress: 0x4211d4d6,
  binaryBytes: 9430,
  sha256: "050d10067cb0592b00561a65d9fcf057b05843b3b0954873c8d55560a8e9ddfa",
  symbols: Object.freeze({
    renderer_v2_runtime_init: [0x4211b29c, 0x778],
    renderer_v2_enqueue_fn_bottom: [0x4211ba14, 0x58],
    renderer_v2_enqueue_host: [0x4211ba6c, 0x3a],
    renderer_v2_ui_tick: [0x4211baa8, 0x1f1],
    renderer_v2_native_prepare: [0x4211bc9c, 0x411],
    renderer_v2_native_commit: [0x4211c0b0, 0x3a],
    renderer_v2_native_cancel: [0x4211c0ec, 0x74],
    renderer_v2_native_attach: [0x4211c160, 0x17e],
    renderer_v2_native_host_event: [0x4211c2e0, 0x58],
    renderer_v2_timer_build: [0x4211ca44, 0x16],
    renderer_v2_timer_encoder: [0x4211cbdc, 0x78],
    renderer_v2_timer_tick: [0x4211d180, 0x217],
    renderer_v2_timer_cleanup: [0x4211d484, 0x0e],
    renderer_v2_timer_id: [0x4211d494, 0x07],
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
function countU32(data, value) {
  const target = Buffer.alloc(4); target.writeUInt32LE(value >>> 0);
  let count = 0;
  for (let offset = 0; offset <= data.length - 4; offset += 1)
    if (data.subarray(offset, offset + 4).equals(target)) count += 1;
  return count;
}

const flags = ["-c", "-Os", "-mlongcalls", "-std=c11", "-ffreestanding", "-fno-builtin",
  "-fno-jump-tables", "-fno-tree-switch-conversion", "-fdata-sections", "-ffunction-sections",
  "-fno-unwind-tables", "-fno-asynchronous-unwind-tables", "-fno-stack-protector",
  "-Wall", "-Wextra", "-Werror"];
const temp = await mkdtemp(path.join(os.tmpdir(), "renderer-v2-native-"));
try {
  const libgcc = (await run(tool("gcc"), ["-print-libgcc-file-name"])).stdout.trim();
  const binaries = [];
  for (let pass = 0; pass < 2; pass += 1) {
    const object = path.join(temp, `renderer-${pass}.o`);
    const elf = path.join(temp, `renderer-${pass}.elf`);
    const raw = path.join(temp, `renderer-${pass}.bin`);
    await run(tool("gcc"), [...flags, "-o", object, source]);
    await run(tool("ld"), ["-T", linker, "-o", elf, object, libgcc]);
    const sections = (await run(tool("objdump"), ["-f", "-h", elf])).stdout;
    assert(/file format elf32-xtensa-le/u.test(sections), "Renderer-v2 is not ESP32-S3 little-endian ELF.");
    assert(/\.renderer_v2_literal\s+0000028c\s+4211b000/u.test(sections), "Renderer-v2 literal section moved.");
    assert(/\.renderer_v2_text\s+0000224a\s+4211b28c/u.test(sections), "Renderer-v2 text section moved.");
    assert(!/\.renderer_v2_rodata\s+0*[^0\s]/u.test(sections) && !/\.bss\s+0*[^0\s]/u.test(sections),
      "Renderer-v2 emitted ordinary IROM data or static RAM state.");
    assert(/There are no relocations in this file\./u.test((await run(tool("readelf"), ["-r", elf])).stdout),
      "Renderer-v2 final ELF contains relocations.");
    assert((await run(tool("nm"), ["-u", elf])).stdout.trim() === "", "Renderer-v2 has undefined symbols.");
    const symbols = parseSymbols((await run(tool("nm"), ["-S", elf])).stdout);
    for (const [name, wanted] of Object.entries(expected.symbols))
      assert(JSON.stringify(symbols.get(name)) === JSON.stringify(wanted), `Renderer-v2 symbol ${name} moved.`);
    const disassembly = (await run(tool("objdump"), ["-d", elf], { maxBuffer: 4 * 1024 * 1024 })).stdout;
    assert((disassembly.match(/s32c1i/gu) ?? []).length >= 2, "Renderer-v2 queue lost Xtensa atomic CAS gates.");
    assert(!/\b(?:malloc|free|calloc|realloc)\b/u.test(disassembly), "Renderer-v2 VM gained an allocator dependency.");
    await run(tool("objcopy"), ["-O", "binary", elf, raw]);
    const bytes = await readFile(raw); binaries.push(bytes);
    assert(bytes.length === expected.binaryBytes && sha256(bytes) === expected.sha256,
      `Renderer-v2 bytes changed: ${bytes.length} ${sha256(bytes)}.`);
    for (const address of [0x420e7c04, 0x4204da84, 0x420293a8, 0x420ae8a0,
      0x420aeef0, 0x4204f0d0, 0x4200c4c0, 0x4210bfac, 0x42068f04, 0x4037e028])
      assert(countU32(bytes, address) >= 1, `Renderer-v2 lost pinned live ABI 0x${address.toString(16)}.`);
  }
  assert(binaries[0].equals(binaries[1]), "Renderer-v2 native build is nondeterministic.");
  console.log(JSON.stringify({
    status: "PASS_STATIC_NATIVE_F2EP",
    format: "elf32-xtensa-le", relocations: 0, undefinedSymbols: 0,
    ordinaryIromDataBytes: 0, staticRamBytes: 0,
    programs: {
      boot: { bytes: 9536, sha256: "af34f7f98587d31929799e3218beb47582a0ec796085f4d36859d37a60469b08" },
      focus: { bytes: 15178, sha256: "b2eadd5884c6ee3b1546ac50c3c077d16eb384adbf1a82631551e69f93705aed" },
      timer: { bytes: 14618, sha256: "80e7ca2e30a56ca12c29320256884c69cdaef7fea27a6468a0cb54122cad8979" },
    },
    bases: {
      boot: { bytes: 748, sha256: "5f1edc6879adcec0d25d5e6c999bfc80e19089aa05a72fbd14f3f5acd8899f2e" },
      focus: { f1wbBytes: 62404,
        rasterSha256: "4de389c225407bc3d616b0f86cfbe2cb645bda0cb989c5785addff67d72028c7" },
      timer: { decodedBytes: 62000,
        decodedSha256: "13daabad2f5c578a5ebfed2fceef9dde60ae7f38c8ab51404b34133ef1b4e3e8",
        lzssBytes: 3335,
        lzssSha256: "cae1a0903e8b9ec09880dee05652a354b420cd5966d10b28c0382e40c0427307" },
    },
    limits: { queueRecords: 8, queueBytes: 128, stateSlots: 16,
      instructionsPerHandler: 64, patchSpans: 512, patchBytes: 16384,
      borrowedFramebufferBytes: 62000, extraFramebufferBytes: 0 },
    sidecarAllocationBytes: 1300, timerProxyAllocationBytes: 136,
    literal: { address: `0x${expected.literalAddress.toString(16)}`, bytes: expected.literalBytes },
    text: { address: `0x${expected.textAddress.toString(16)}`, bytes: expected.textBytes },
    endAddress: `0x${expected.endAddress.toString(16)}`,
    entry: `0x${expected.symbols.renderer_v2_native_attach[0].toString(16)}`,
    binaryBytes: expected.binaryBytes, sha256: expected.sha256,
  }, null, 2));
} finally {
  await rm(temp, { recursive: true, force: true });
}
