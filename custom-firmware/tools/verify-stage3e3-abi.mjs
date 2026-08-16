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
const source = path.join(root, "custom-firmware/experimental/stage3e3-wpm-pet.S");
const linker = path.join(root, "custom-firmware/experimental/stage3e3-wpm-pet.ld");
const pinned = path.join(root, "custom-firmware/experimental/stage3e3-wpm-pet.hex");
const expected = Object.freeze({
  literalAddress: 0x42116f10,
  literalSize: 0xd4,
  textAddress: 0x42116fe4,
  textSize: 0x5b4,
  bytes: 0x688,
  sha256: "67f5ff528d691c7a5f5fb685e16b0f857ef291670f450b5eb03f5e347cb77992",
  symbols: Object.freeze({
    stage3e3_screen_setup_wrapper: [0x42116fe4, 0xa6],
    stage3e3_make_image: [0x4211708c, 0x30],
    stage3e3_make_label: [0x421170bc, 0x3a],
    stage3e3_make_star: [0x421170f8, 0x54],
    stage3e3_apply_pet_source: [0x4211714c, 0x44],
    stage3e3_wpm_build: [0x42117190, 0x109],
    stage3e3_wpm_cleanup: [0x4211729c, 0x21],
    stage3e3_wpm_id: [0x421172c0, 0x07],
    stage3e3_wpm_encoder: [0x421172c8, 0x45],
    stage3e3_sample_and_render: [0x42117310, 0x20c],
    stage3e3_wpm_ui_refresh: [0x4211751c, 0x7c],
  }),
});

const tool = (name) => path.join(bin, `xtensa-esp32s3-elf-${name}`);
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
function assert(condition, message) { if (!condition) throw new Error(message); }
function body(disassembly, symbol) {
  const start = disassembly.indexOf(`<${symbol}>:`);
  assert(start >= 0, `Stage-3E.3 symbol ${symbol} is absent.`);
  const next = disassembly.indexOf("\n\n", start);
  return disassembly.slice(start, next < 0 ? undefined : next);
}
function parseSymbols(output) {
  const found = new Map();
  for (const line of output.split("\n")) {
    const match = /^([0-9a-f]+)\s+([0-9a-f]+)\s+[A-Za-z]\s+(\S+)$/u.exec(line.trim());
    if (match) found.set(match[3], [Number.parseInt(match[1], 16), Number.parseInt(match[2], 16)]);
  }
  return found;
}
function countU32(data, value) {
  const wanted = Buffer.alloc(4); wanted.writeUInt32LE(value >>> 0);
  let count = 0;
  for (let offset = 0; offset <= data.length - 4; offset++) {
    if (data.subarray(offset, offset + 4).equals(wanted)) count++;
  }
  return count;
}

const temp = await mkdtemp(path.join(os.tmpdir(), "framer-stage3e3-abi-"));
try {
  const object = path.join(temp, "stage3e3.o");
  const elf = path.join(temp, "stage3e3.elf");
  const raw = path.join(temp, "stage3e3.bin");
  await run(tool("as"), ["-o", object, source]);
  await run(tool("ld"), ["-T", linker, "-o", elf, object]);
  const sections = (await run(tool("objdump"), ["-f", "-h", elf])).stdout;
  assert(/file format elf32-xtensa-le/u.test(sections), "Stage-3E.3 is not S3 little-endian ELF.");
  assert(/\.stage3e3_literal\s+000000d4\s+42116f10/u.test(sections), "Stage-3E.3 literal section moved.");
  assert(/\.stage3e3_text\s+000005b4\s+42116fe4/u.test(sections), "Stage-3E.3 text section moved.");
  const relocations = (await run(tool("readelf"), ["-r", elf])).stdout;
  assert(/There are no relocations in this file\./u.test(relocations), "Stage-3E.3 has final relocations.");
  const symbols = parseSymbols((await run(tool("nm"), ["-S", elf])).stdout);
  for (const [name, wanted] of Object.entries(expected.symbols)) {
    assert(JSON.stringify(symbols.get(name)) === JSON.stringify(wanted), `Stage-3E.3 symbol ${name} moved.`);
  }

  const disassembly = (await run(tool("objdump"), ["-d", elf], { maxBuffer: 1024 * 1024 })).stdout;
  const setup = body(disassembly, "stage3e3_screen_setup_wrapper");
  const build = body(disassembly, "stage3e3_wpm_build");
  const apply = body(disassembly, "stage3e3_apply_pet_source");
  const encoder = body(disassembly, "stage3e3_wpm_encoder");
  const sample = body(disassembly, "stage3e3_sample_and_render");
  const refresh = body(disassembly, "stage3e3_wpm_ui_refresh");
  const cleanup = body(disassembly, "stage3e3_wpm_cleanup");
  const setupCall = setup.indexOf("l32r\ta8, 42116f10");
  const allocationCall = setup.indexOf("l32r\ta8, 42116f20");
  assert(setupCall >= 0 && allocationCall > setupCall &&
    (setup.match(/l32r\s+a8, 42116f10/gu) ?? []).length === 1 &&
    /l32r\s+a8, 42116f10[^\n]*\n[^\n]*callx8\s+a8/u.test(setup),
  "Stage-3E.3 must call the stock setup exactly once before allocation/registration.");
  assert(/movi(?:\.n)?\s+a8, 4[\s\S]*s32i\s+a8, a5, 124/u.test(setup),
    "Stage-3E.3 no longer defaults once to Cat at +124.");
  assert(/l32i(?:\.n)?\s+a10, a7, 12[\s\S]*movi\s+a11, 255/u.test(build),
    "Stage-3E.3 opaque painted root setup changed.");
  assert(/s32i\s+a10, a7, 84[\s\S]*beqz\s+a10[^\n]*\n[^\n]*movi\s+a11, 0x200[^\n]*\n[^\n]*l32r\s+a8, 42116f68[^\n]*\n[^\n]*callx8\s+a8/u.test(build) &&
    (build.match(/l32r\s+a8, 42116f68/gu) ?? []).length === 1 && !/42116f68/u.test(apply),
    "Stage-3E.3 lost its one-time 2x image scale after pet creation.");
  for (const offset of [88, 92, 96, 100, 104]) {
    assert(new RegExp(`s32i(?:\\.n)?\\s+a10, a7, ${offset}`, "u").test(build),
      `Stage-3E.3 object +${offset} is not created/stored.`);
  }
  assert(/movi(?:\.n)?\s+a12, 3[\s\S]*movi(?:\.n)?\s+a14, 2/u.test(build) &&
    /movi(?:\.n)?\s+a12, -3[\s\S]*movi(?:\.n)?\s+a14, 5/u.test(build),
    "Stage-3E.3 TOP_MID/BOTTOM_MID positions changed.");
  assert(/l32i\s+a5, a7, 124[\s\S]*l32i\s+a4, a7, 84[\s\S]*l32i\s+a8, a7, 128[\s\S]*l32i\s+a9, a7, 132/u.test(apply) &&
    /slli\s+a8, a5, 3[\s\S]*movi(?:\.n)?\s+a9, 24/u.test(apply),
    "Stage-3E.3 cached species*8+state source selection changed.");
  assert(/bne\s+a3, a8[\s\S]*sext\s+a6, a4, 7/u.test(encoder) &&
    /l32i\s+a5, a7, 124[\s\S]*movi(?:\.n)?\s+a8, 6[\s\S]*s32i\s+a5, a7, 124/u.test(encoder),
    "Stage-3E.3 ID1/Fn/signed-delta six-species wrap changed.");
  assert(/movi(?:\.n)?\s+a9, 10[\s\S]*mull\s+a9, a6, a9[\s\S]*movi(?:\.n)?\s+a3, 9[\s\S]*mull\s+a8, a8, a3/u.test(sample),
    "Stage-3E.3 mature near-high zoom policy changed.");
  for (const offset of [108, 112, 116, 120]) {
    assert(new RegExp(`l32i(?:\\.n)?\\s+a\\d+, a7, ${offset}`, "u").test(sample) &&
      new RegExp(`s32i(?:\\.n)?\\s+a\\d+, a7, ${offset}`, "u").test(sample),
    `Stage-3E.3 render cache +${offset} is not read and written.`);
  }
  assert(/l32i\s+a9, a7, 136[\s\S]*l32i\s+a10, a7, 96[\s\S]*l32i\s+a10, a7, 100[\s\S]*l32i\s+a10, a7, 104/u.test(refresh),
    "Stage-3E.3 star phase/color-only update path changed.");
  assert(!/s32i\s+a\d+, a2, 124/u.test(cleanup), "Stage-3E.3 cleanup clears persistent species.");
  assert(/movi(?:\.n)?\s+a2, 7[\s\S]*retw\.n/u.test(body(disassembly, "stage3e3_wpm_id")),
    "Stage-3E.3 ID method no longer returns 7.");

  await run(tool("objcopy"), ["-O", "binary", elf, raw]);
  const binary = await readFile(raw);
  const pinnedHex = (await readFile(pinned, "utf8")).replace(/\s+/gu, "");
  assert(/^[0-9a-f]+$/u.test(pinnedHex), "Stage-3E.3 pinned hex is not canonical lowercase.");
  assert(binary.equals(Buffer.from(pinnedHex, "hex")), "Stage-3E.3 assembly differs from pinned hex.");
  assert(binary.length === expected.bytes && sha256(binary) === expected.sha256,
    `Stage-3E.3 ABI changed: ${binary.length} bytes ${sha256(binary)}.`);
  for (const literal of [0x4202c108, 0x420ae8a0, 0x420aeef0, 0x420aec94, 0x4204ef10,
    0x4204efd0, 0x4204f170, 0x4204ee30, 0x4204ef44, 0x3fcaba20, 0x3c1c1190,
    0x4200c4c0, 0x4210bfac, 65536]) {
    assert(countU32(binary, literal) >= 1, `Stage-3E.3 required literal 0x${literal.toString(16)} is absent.`);
  }
  for (const forbidden of [0x420a87e0, 0x4206eae0, 0x3fcab378, 0x42003dc8, 0x3fca4f00,
    0x42004f10, 0x4201a930]) {
    assert(countU32(binary, forbidden) === 0, `Stage-3E.3 forbidden literal 0x${forbidden.toString(16)} is present.`);
  }
  process.stdout.write(`${JSON.stringify({
    format: "elf32-xtensa-le", relocations: 0,
    literalAddress: "0x42116f10", literalBytes: expected.literalSize,
    textAddress: "0x42116fe4", textBytes: expected.textSize,
    endAddress: "0x42117598", binaryBytes: binary.length, sha256: sha256(binary),
    objectFields: { pet: 84, wpm: 88, stats: 92, stars: [96, 100, 104], species: 124,
      renderedSpecies: 128, renderedState: 132, starPhase: 136 },
    imageScale: "0x200 once after create", cacheDrop: false,
  }, null, 2)}\n`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
