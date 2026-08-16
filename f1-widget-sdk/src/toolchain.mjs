import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { ALLOWED_RUNTIME_ADDRESSES, PINNED } from "./constants.mjs";
import { assert, sha256 } from "./util.mjs";

const run = promisify(execFile);

function tool(name) {
  return path.join(PINNED.toolchainDirectory, `xtensa-esp32s3-elf-${name}`);
}

async function auditToolchain() {
  const hashes = {};
  for (const [name, expected] of Object.entries(PINNED.toolchain)) {
    let bytes;
    try {
      bytes = await readFile(tool(name));
    } catch (error) {
      throw new Error(`Pinned ESP32-S3 tool ${name} is unavailable: ${error.message}`);
    }
    hashes[name] = sha256(bytes);
    assert(hashes[name] === expected, `Pinned ESP32-S3 tool ${name} drifted.`);
  }
  return Object.freeze(hashes);
}

function parseSymbols(stdout) {
  const symbols = new Map();
  for (const line of stdout.split("\n")) {
    const match = /^([0-9a-f]+)\s+([0-9a-f]+)\s+[A-Za-z]\s+(\S+)$/u.exec(line.trim());
    if (match) symbols.set(match[3], {
      address: Number.parseInt(match[1], 16),
      size: Number.parseInt(match[2], 16),
    });
  }
  return symbols;
}

function auditSourceAddressLiterals(source, descriptorAddresses) {
  const dynamic = new Set(descriptorAddresses);
  const numericLong = /^\s*\.long\s+(0x[0-9a-f]+|[0-9]+)\s*(?:\/\*.*)?$/gimu;
  for (const match of source.matchAll(numericLong)) {
    const value = Number.parseInt(match[1], match[1].toLowerCase().startsWith("0x") ? 16 : 10) >>> 0;
    if (value >= 0x3c000000 && value < 0x44000000) {
      assert(ALLOWED_RUNTIME_ADDRESSES.has(value) || dynamic.has(value),
        `Assembly references unreviewed runtime address 0x${value.toString(16)}.`);
    }
  }
  for (const address of PINNED.forbiddenAddresses) {
    assert(!source.toLowerCase().includes(`0x${address.toString(16)}`),
      `Assembly source references forbidden address 0x${address.toString(16)}.`);
  }
}

function replaceTokens(template, values, description) {
  let output = template;
  for (const [name, value] of Object.entries(values)) {
    output = output.replaceAll(`{{${name}}}`, String(value));
  }
  const unresolved = [...output.matchAll(/\{\{([A-Z0-9_]+)\}\}/gu)].map((match) => match[1]);
  assert(unresolved.length === 0, `${description} has unresolved tokens: ${unresolved.join(", ")}.`);
  return output;
}

async function compileOnce(source, linker) {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "f1-widget-sdk-"));
  const sourcePath = path.join(temporaryDirectory, "widget.S");
  const linkerPath = path.join(temporaryDirectory, "widget.ld");
  const objectPath = path.join(temporaryDirectory, "widget.o");
  const elfPath = path.join(temporaryDirectory, "widget.elf");
  const binaryPath = path.join(temporaryDirectory, "widget.bin");
  try {
    await Promise.all([writeFile(sourcePath, source), writeFile(linkerPath, linker)]);
    await run(tool("as"), ["-o", objectPath, sourcePath]);
    await run(tool("ld"), ["-T", linkerPath, "-o", elfPath, objectPath]);
    const [header, relocations, symbolOutput, disassembly] = await Promise.all([
      run(tool("objdump"), ["-f", "-h", elfPath]),
      run(tool("readelf"), ["-r", elfPath]),
      run(tool("nm"), ["-S", elfPath]),
      run(tool("objdump"), ["-d", elfPath], { maxBuffer: 4 * 1024 * 1024 }),
    ]);
    assert(/file format elf32-xtensa-le/u.test(header.stdout),
      "Widget did not link as ESP32-S3 little-endian ELF.");
    assert(/There are no relocations in this file\./u.test(relocations.stdout),
      "Widget contains unresolved relocations.");
    await run(tool("objcopy"), ["-O", "binary", elfPath, binaryPath]);
    return {
      binary: await readFile(binaryPath),
      symbols: parseSymbols(symbolOutput.stdout),
      sections: header.stdout,
      disassembly: disassembly.stdout,
    };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export async function compileWidget({ sourceTemplate, linkerTemplate, tokens, descriptorAddresses }) {
  const toolchainHashes = await auditToolchain();
  const source = replaceTokens(sourceTemplate, tokens, "Assembly template");
  const linker = replaceTokens(linkerTemplate, tokens, "Linker template");
  auditSourceAddressLiterals(source, descriptorAddresses);
  const first = await compileOnce(source, linker);
  const second = await compileOnce(source, linker);
  assert(first.binary.equals(second.binary), "Two identical assembly builds produced different code bytes.");
  assert(first.binary.length > 0 && first.binary.length % 4 === 0,
    "Widget code must be non-empty and 4-byte aligned.");
  const entry = first.symbols.get(PINNED.entrySymbol);
  assert(entry, `Required entry symbol ${PINNED.entrySymbol} is missing.`);
  assert(entry.address >= PINNED.codeBaseAddress &&
    entry.address + entry.size <= PINNED.codeBaseAddress + first.binary.length,
  "Setup entry symbol lies outside appended IROM.");
  assert(first.binary.length <= 0x10000, "Guarded widget code exceeds one 64-KiB IROM budget page.");
  for (const name of [
    "f1_widget_build", "f1_widget_cleanup", "f1_widget_ui_refresh", "f1_widget_id",
    "f1_widget_encoder", "f1_widget_sample_and_render",
  ]) {
    const symbol = first.symbols.get(name);
    assert(symbol && symbol.address >= PINNED.codeBaseAddress &&
      symbol.address + symbol.size <= PINNED.codeBaseAddress + first.binary.length,
    `Required controller ABI symbol ${name} is missing or outside appended IROM.`);
  }
  assert(/<f1_widget_screen_setup_wrapper>:[\s\S]*mov\.n\s+a2, a4[\s\S]*retw\.n/u.test(first.disassembly),
    "Setup wrapper no longer returns through its windowed a2 register.");
  assert(/<f1_widget_id>:[\s\S]*movi\.n\s+a2, 7[\s\S]*retw\.n/u.test(first.disassembly),
    "Controller ID method no longer returns guarded screen ID 7.");
  assert(/<f1_widget_ui_refresh>:[\s\S]*l32i(?:\.n)?\s+a10, a7, 84[\s\S]*beqz\.n\s+a10/u.test(first.disassembly),
    "UI refresh no longer fail-soft guards its background image pointer.");
  assert(/<f1_widget_encoder>:[\s\S]*bne\s+a3, a8[\s\S]*sext\s+a6, a4, 7[\s\S]*l32i\s+a5, a7, 120[\s\S]*s32i\s+a5, a7, 120/u.test(first.disassembly),
    "Slot-9 controller-local signed-delta species selection ABI changed.");
  assert(/<f1_widget_build>:[\s\S]*movi(?:\.n)?\s+a12, 3[\s\S]*movi(?:\.n)?\s+a14, 2[\s\S]*movi(?:\.n)?\s+a12, -3[\s\S]*movi(?:\.n)?\s+a14, 5/u.test(first.disassembly),
    "TOP_MID WPM or BOTTOM_MID analytics label layout changed.");
  for (const word of ["41766720", "25750a54", "6f703a20", "25750000"]) {
    assert(first.binary.includes(Buffer.from(word, "hex")),
      "Analytics literals are no longer exactly `Avg %u\\nTop: %u`.");
  }

  const literalMatch = /\.f1_widget_literal\s+([0-9a-f]+)\s+([0-9a-f]+)/u.exec(first.sections);
  assert(literalMatch && Number.parseInt(literalMatch[2], 16) === PINNED.codeBaseAddress,
    "Widget literal pool is absent or moved from the reviewed append boundary.");
  const literalBytes = Number.parseInt(literalMatch[1], 16);
  assert(literalBytes > 0 && literalBytes % 4 === 0 && literalBytes <= first.binary.length,
    "Widget literal pool has an invalid size.");
  const dynamicAddresses = new Set(descriptorAddresses);
  for (let offset = 0; offset < literalBytes; offset += 4) {
    const value = first.binary.readUInt32LE(offset);
    if (value >= 0x3c000000 && value < 0x44000000) {
      const internal = value >= PINNED.codeBaseAddress && value < PINNED.codeBaseAddress + first.binary.length;
      assert(internal || ALLOWED_RUNTIME_ADDRESSES.has(value) || dynamicAddresses.has(value),
        `Compiled literal pool contains unreviewed runtime address 0x${value.toString(16)}.`);
    }
  }
  for (const address of PINNED.forbiddenAddresses) {
    const needle = Buffer.alloc(4);
    needle.writeUInt32LE(address);
    assert(!first.binary.includes(needle), `Compiled code contains forbidden address 0x${address.toString(16)}.`);
  }
  return Object.freeze({
    ...first,
    source,
    linker,
    entry,
    sha256: sha256(first.binary),
    toolchainHashes,
    deterministicRebuilds: 2,
  });
}
