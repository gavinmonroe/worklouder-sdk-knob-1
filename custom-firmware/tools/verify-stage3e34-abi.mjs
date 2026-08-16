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
const source = path.join(root, "custom-firmware/experimental/stage3e34-wpm-pet.S");
const linker = path.join(root, "custom-firmware/experimental/stage3e34-wpm-pet.ld");
const pinned = path.join(root, "custom-firmware/experimental/stage3e34-wpm-pet.hex");
const registerLinker = path.join(root, "custom-firmware/experimental/stage3e34-register-only.ld");
const registerPinned = path.join(root, "custom-firmware/experimental/stage3e34-register-only.hex");
const expected = Object.freeze({
  literalAddress: 0x42116f10,
  literalSize: 0xec,
  textAddress: 0x42116ffc,
  textSize: 0x6dc,
  bytes: 0x7c8,
  sha256: "c0d7293146f1a6e5b7869895dfaa278c952485a8400a2b54244b82a9058bc846",
  symbols: Object.freeze({
    stage3e34_screen_setup_wrapper: [0x42116ffc, 0x30],
    stage3e34_register_wpm: [0x4211702c, 0x98],
    stage3e34_make_image: [0x421170c4, 0x30],
    stage3e34_make_label: [0x421170f4, 0x3a],
    stage3e34_make_star: [0x42117130, 0x54],
    stage3e34_expand_i4: [0x42117184, 0x10a],
    stage3e34_apply_pet_source: [0x42117290, 0x54],
    stage3e34_wpm_build: [0x421172e4, 0xf1],
    stage3e34_wpm_cleanup: [0x421173d8, 0x21],
    stage3e34_wpm_id: [0x421173fc, 0x07],
    stage3e34_wpm_encoder: [0x42117404, 0x45],
    stage3e34_sample_and_render: [0x4211744c, 0x210],
    stage3e34_wpm_ui_refresh: [0x4211765c, 0x7c],
  }),
});
const expectedRegister = Object.freeze({
  literalAddress: 0x42116f10,
  literalSize: 0xdc,
  textAddress: 0x42116fec,
  textSize: 0x6ac,
  bytes: 0x788,
  sha256: "6862764da34424285799e5c91796cd6080fca1adc1374f60f5b171b8d34c6c12",
  entryAddress: 0x42116fec,
});

const tool = (name) => path.join(bin, `xtensa-esp32s3-elf-${name}`);
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
function assert(condition, message) { if (!condition) throw new Error(message); }
function body(disassembly, symbol) {
  const start = disassembly.indexOf(`<${symbol}>:`);
  assert(start >= 0, `Stage-3E.3.4 symbol ${symbol} is absent.`);
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

const temp = await mkdtemp(path.join(os.tmpdir(), "framer-stage3e34-abi-"));
try {
  const object = path.join(temp, "stage3e34.o");
  const elf = path.join(temp, "stage3e34.elf");
  const raw = path.join(temp, "stage3e34.bin");
  const registerElf = path.join(temp, "stage3e34-register.elf");
  const registerRaw = path.join(temp, "stage3e34-register.bin");
  await run(tool("as"), ["-o", object, source]);
  await run(tool("ld"), ["-T", linker, "-o", elf, object]);
  const sections = (await run(tool("objdump"), ["-f", "-h", elf])).stdout;
  assert(/file format elf32-xtensa-le/u.test(sections), "Stage-3E.3.4 is not S3 little-endian ELF.");
  assert(/\.stage3e34_literal\s+000000ec\s+42116f10/u.test(sections), "Stage-3E.3.4 literal section moved.");
  assert(/\.stage3e34_text\s+000006dc\s+42116ffc/u.test(sections), "Stage-3E.3.4 text section moved.");
  const relocations = (await run(tool("readelf"), ["-r", elf])).stdout;
  assert(/There are no relocations in this file\./u.test(relocations), "Stage-3E.3.4 has final relocations.");
  const symbols = parseSymbols((await run(tool("nm"), ["-S", elf])).stdout);
  for (const [name, wanted] of Object.entries(expected.symbols)) {
    assert(JSON.stringify(symbols.get(name)) === JSON.stringify(wanted), `Stage-3E.3.4 symbol ${name} moved.`);
  }

  const disassembly = (await run(tool("objdump"), ["-d", elf], { maxBuffer: 1024 * 1024 })).stdout;
  const setup = body(disassembly, "stage3e34_screen_setup_wrapper");
  const register = body(disassembly, "stage3e34_register_wpm");
  const expand = body(disassembly, "stage3e34_expand_i4");
  const build = body(disassembly, "stage3e34_wpm_build");
  const apply = body(disassembly, "stage3e34_apply_pet_source");
  const encoder = body(disassembly, "stage3e34_wpm_encoder");
  const sample = body(disassembly, "stage3e34_sample_and_render");
  const refresh = body(disassembly, "stage3e34_wpm_ui_refresh");
  const cleanup = body(disassembly, "stage3e34_wpm_cleanup");
  assert((setup.match(/callx8\s+a8/gu) ?? []).length === 4 && /call8\s+4211702c/u.test(setup),
    "Stage-3E.3.4 standalone wrapper no longer delegates once to registration-only ABI.");
  assert(!/4202c108/u.test(register) && /l32r\s+a10,[^\n]+/u.test(register) &&
    /l32i(?:\.n)?\s+a8, a5, 20[\s\S]*bne\s+a8, a7/u.test(register),
    "Stage-3E.3.4 registration calls setup or lost controller+20 registry success gate.");
  assert(/movi(?:\.n)?\s+a8, 4[\s\S]*s32i\s+a8, a5, 124/u.test(register),
    "Stage-3E.3.4 no longer defaults once to Cat at +124.");
  assert(/l32i(?:\.n)?\s+a10, a7, 12[\s\S]*movi\s+a11, 255/u.test(build),
    "Stage-3E.3.4 opaque painted root setup changed.");
  assert(/s32i\s+a10, a7, 84[\s\S]*mov(?:\.n)?\s+a10, a7[\s\S]*movi(?:\.n)?\s+a11, 0[\s\S]*call8\s+42117290/u.test(build) &&
    !/s32i\s+a10, a7, 140/u.test(build),
    "Stage-3E.3.4 lost its single fail-visible image or persisted-species re-entry render.");
  for (const offset of [88, 92, 96, 100, 104]) {
    assert(new RegExp(`s32i(?:\\.n)?\\s+a10, a7, ${offset}`, "u").test(build),
      `Stage-3E.3.4 object +${offset} is not created/stored.`);
  }
  assert(/movi(?:\.n)?\s+a12, 3[\s\S]*movi(?:\.n)?\s+a14, 2/u.test(build) &&
    /movi(?:\.n)?\s+a12, -3[\s\S]*movi(?:\.n)?\s+a14, 5/u.test(build),
    "Stage-3E.3.4 TOP_MID/BOTTOM_MID positions changed.");
  assert(/l32i\s+a5, a7, 124[\s\S]*l32i\s+a4, a7, 84[\s\S]*l32i\s+a8, a7, 128[\s\S]*l32i\s+a9, a7, 132/u.test(apply) &&
    /slli\s+a8, a5, 3[\s\S]*movi(?:\.n)?\s+a9, 24[\s\S]*call8\s+42117184[\s\S]*callx8\s+a8/u.test(apply),
    "Stage-3E.3.4 source-change path lost cached RAM expansion and one-image set_src.");
  assert(/l32i\s+a8, a7, 144[\s\S]*xor\s+a8, a8, a9[\s\S]*s32i\s+a8, a7, 144/u.test(expand) &&
    /movi(?:\.n)?\s+a9, 78[\s\S]*quou[\s\S]*movi(?:\.n)?\s+a9, 96[\s\S]*quou/u.test(expand) &&
    /movi(?:\.n)?\s+a8, 48[\s\S]*s8i\s+a13, a11, 0/u.test(expand),
    "Stage-3E.3.4 96x78 ping-pong nearest-neighbor I4 expansion changed.");
  assert(/bne\s+a3, a8[\s\S]*sext\s+a6, a4, 7/u.test(encoder) &&
    /l32i\s+a5, a7, 124[\s\S]*movi(?:\.n)?\s+a8, 6[\s\S]*s32i\s+a5, a7, 124/u.test(encoder),
    "Stage-3E.3.4 ID1/Fn/signed-delta six-species wrap changed.");
  assert(/movi(?:\.n)?\s+a9, 10[\s\S]*mull\s+a9, a6, a9[\s\S]*movi(?:\.n)?\s+a3, 9[\s\S]*mull\s+a8, a8, a3/u.test(sample),
    "Stage-3E.3.4 mature near-high zoom policy changed.");
  for (const offset of [108, 112, 116, 120]) {
    assert(new RegExp(`l32i(?:\\.n)?\\s+a\\d+, a7, ${offset}`, "u").test(sample) &&
      new RegExp(`s32i(?:\\.n)?\\s+a\\d+, a7, ${offset}`, "u").test(sample),
    `Stage-3E.3.4 render cache +${offset} is not read and written.`);
  }
  assert(/l32i\s+a9, a7, 136[\s\S]*l32i\s+a10, a7, 96[\s\S]*l32i\s+a10, a7, 100[\s\S]*l32i\s+a10, a7, 104/u.test(refresh),
    "Stage-3E.3.4 star phase/color-only update path changed.");
  assert(!/s32i\s+a\d+, a2, 124/u.test(cleanup), "Stage-3E.3.4 cleanup clears persistent species.");
  assert(/s32i\s+a8, a2, 84/u.test(cleanup) && !/s32i\s+a8, a2, 140/u.test(cleanup),
    "Stage-3E.3.4 cleanup no longer owns exactly one image pointer.");
  assert(/movi(?:\.n)?\s+a2, 7[\s\S]*retw\.n/u.test(body(disassembly, "stage3e34_wpm_id")),
    "Stage-3E.3.4 ID method no longer returns 7.");

  await run(tool("objcopy"), ["-O", "binary", elf, raw]);
  const binary = await readFile(raw);
  const pinnedHex = (await readFile(pinned, "utf8")).replace(/\s+/gu, "");
  assert(/^[0-9a-f]+$/u.test(pinnedHex), "Stage-3E.3.4 pinned hex is not canonical lowercase.");
  assert(binary.equals(Buffer.from(pinnedHex, "hex")), "Stage-3E.3.4 assembly differs from pinned hex.");
  assert(binary.length === expected.bytes && sha256(binary) === expected.sha256,
    `Stage-3E.3.4 ABI changed: ${binary.length} bytes ${sha256(binary)}.`);
  for (const literal of [0x4202c108, 0x420ae8a0, 0x420aeef0, 0x4204ef10,
    0x4204efd0, 0x4204f170, 0x4204ee30, 0x4204ef44, 0x3fcaba20, 0x3c1c1190, 0x3c1c162c,
    0x4200c4c0, 0x4210bfac, 65536]) {
    assert(countU32(binary, literal) >= 1, `Stage-3E.3.4 required literal 0x${literal.toString(16)} is absent.`);
  }
  for (const forbidden of [0x420aec94, 0x420a87e0, 0x4206eae0, 0x3fcab378, 0x42003dc8, 0x3fca4f00,
    0x42004f10, 0x4201a930]) {
    assert(countU32(binary, forbidden) === 0, `Stage-3E.3.4 forbidden literal 0x${forbidden.toString(16)} is present.`);
  }
  await run(tool("ld"), ["-T", registerLinker, "-o", registerElf, object]);
  const registerSections = (await run(tool("objdump"), ["-f", "-h", registerElf])).stdout;
  assert(/file format elf32-xtensa-le/u.test(registerSections),
    "Stage-3E.3.4 registration module is not S3 little-endian ELF.");
  assert(/\.stage3e34_register_literal\s+000000dc\s+42116f10/u.test(registerSections),
    "Stage-3E.3.4 registration literal section moved.");
  assert(/\.stage3e34_register_text\s+000006ac\s+42116fec/u.test(registerSections),
    "Stage-3E.3.4 registration text section moved.");
  const registerRelocations = (await run(tool("readelf"), ["-r", registerElf])).stdout;
  assert(/There are no relocations in this file\./u.test(registerRelocations),
    "Stage-3E.3.4 registration module has final relocations.");
  const registerSymbols = parseSymbols((await run(tool("nm"), ["-S", registerElf])).stdout);
  assert(!registerSymbols.has("stage3e34_screen_setup_wrapper"),
    "Stage-3E.3.4 registration module retained the standalone setup wrapper.");
  assert(JSON.stringify(registerSymbols.get("stage3e34_register_wpm")) ===
    JSON.stringify([expectedRegister.entryAddress, expected.symbols.stage3e34_register_wpm[1]]),
    "Stage-3E.3.4 registration entry moved.");
  const registerDisassembly = (await run(tool("objdump"), ["-d", registerElf], { maxBuffer: 1024 * 1024 })).stdout;
  const registerOnlyBody = body(registerDisassembly, "stage3e34_register_wpm");
  assert(!/4202c108/u.test(registerOnlyBody) &&
    /l32i(?:\.n)?\s+a8, a5, 20[\s\S]*bne\s+a8, a7/u.test(registerOnlyBody),
    "Stage-3E.3.4 registration-only entry calls stock setup or lost its success gate.");
  await run(tool("objcopy"), ["-O", "binary", registerElf, registerRaw]);
  const registerBinary = await readFile(registerRaw);
  const registerPinnedHex = (await readFile(registerPinned, "utf8")).replace(/\s+/gu, "");
  assert(/^[0-9a-f]+$/u.test(registerPinnedHex),
    "Stage-3E.3.4 registration pinned hex is not canonical lowercase.");
  assert(registerBinary.equals(Buffer.from(registerPinnedHex, "hex")),
    "Stage-3E.3.4 registration assembly differs from pinned hex.");
  assert(registerBinary.length === expectedRegister.bytes &&
    sha256(registerBinary) === expectedRegister.sha256,
    `Stage-3E.3.4 registration ABI changed: ${registerBinary.length} bytes ${sha256(registerBinary)}.`);
  assert(countU32(registerBinary, 0x4202c108) === 0,
    "Stage-3E.3.4 registration-only ABI contains the stock setup function.");

  process.stdout.write(`${JSON.stringify({
    format: "elf32-xtensa-le", relocations: 0,
    literalAddress: "0x42116f10", literalBytes: expected.literalSize,
    textAddress: "0x42116ffc", textBytes: expected.textSize,
    endAddress: "0x421176d8", binaryBytes: binary.length, sha256: sha256(binary),
    objectFields: { pet: 84, wpm: 88, stats: 92, stars: [96, 100, 104], species: 124,
      renderedSpecies: 128, renderedState: 132, starPhase: 136, activeRamBuffer: 144,
      ramDescriptorA: 208, ramDataA: 232, ramDescriptorB: 4040, ramDataB: 4064 },
    ramImage: { width: 96, height: 78, stride: 48, dataBytes: 3808,
      algorithm: "nearest-neighbor I4 ping-pong; one image object; DROM fallback" },
    imageScale: false, cacheDrop: false,
    registerOnly: { literalAddress: "0x42116f10", literalBytes: expectedRegister.literalSize,
      textAddress: "0x42116fec", textBytes: expectedRegister.textSize,
      entryAddress: "0x42116fec", binaryBytes: registerBinary.length,
      sha256: sha256(registerBinary), stockSetupLiteralCount: countU32(registerBinary, 0x4202c108) },
  }, null, 2)}\n`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
