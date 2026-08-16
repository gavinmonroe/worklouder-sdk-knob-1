import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { REMAINING_GETTER_LITERAL_APP_OFFSET, STOCK_REMAINING_GETTER } from
  "../../custom-firmware/build-stage3b.mjs";
import {
  STAGE3C1_KEY_CALLBACK_APP_OFFSET,
  STAGE3C1_SETUP_POINTER_APP_OFFSET,
  STAGE3C1_WPM_TICK_APP_OFFSET,
} from "../../custom-firmware/build-stage3c1.mjs";
import {
  EXPECTED_STAGE3E3A_APP_SHA256,
  STAGE3E3A_ABI_APP_OFFSET,
  STAGE3E3A_ABI_BYTES,
} from "../../custom-firmware/build-stage3e3a.mjs";
import {
  EXPECTED_STAGE3E31_APP_SHA256,
} from "../../custom-firmware/build-stage3e31.mjs";
import {
  EXPECTED_STAGE3E34_APP_SHA256,
  STAGE3E34_ASSET_BANK_APP_OFFSET,
  STAGE3E34_DROM_GROWTH_BYTES,
  STAGE3E34_PADDED_BANK_SHA256,
} from "../../custom-firmware/build-stage3e34.mjs";
import {
  extendEsp32AppSegment,
  inspectEsp32AppImage,
  repairEsp32AppIntegrity,
} from "../../custom-firmware/lib/esp-app-image.mjs";
import { FRAMER_SCREEN_AUDIT, auditFramerScreenRegistry } from
  "../../custom-firmware/lib/framer-registry-audit.mjs";
import { PINNED, SDK_ROOT, WORKSPACE_ROOT } from "./constants.mjs";
import { inspectImage } from "./firmware.mjs";
import { STAGE3E3_PATHS, verifyRecoveryGate } from "./stage3e3.mjs";
import { assert, sha256, stableJson } from "./util.mjs";

const run = promisify(execFile);
const WPM_SOURCE = path.join(WORKSPACE_ROOT, "custom-firmware/experimental/stage3e34-wpm-pet.S");
const WRAPPER_SOURCE = path.join(WORKSPACE_ROOT,
  "f1-widget-sdk/examples/music-player/on-device/combined-setup-wrapper.S.tmpl");
const MUSIC_SOURCE = path.join(WORKSPACE_ROOT,
  "f1-widget-sdk/examples/music-player/on-device/music-player-id1.S");
const E3A_APP = path.join(WORKSPACE_ROOT,
  "custom-firmware/build/framer-0.4.1-stage3e3a-i4-canary-app.bin");
const E31_APP = path.join(WORKSPACE_ROOT,
  "custom-firmware/build/framer-0.4.1-stage3e31-wpm-pet-full-app.bin");
const E34_APP = path.join(WORKSPACE_ROOT,
  "custom-firmware/build/framer-0.4.1-stage3e34-wpm-pet-full-app.bin");
const E34_REGISTER_HEX = path.join(WORKSPACE_ROOT,
  "custom-firmware/experimental/stage3e34-register-only.hex");
const E34_REGISTER_LINKER = path.join(WORKSPACE_ROOT,
  "custom-firmware/experimental/stage3e34-register-only.ld");
const APP_NAME = "framer-0.4.1-combined-music-id1-wpm-id7-app.bin";
const MERGED_NAME = "framer-0.4.1-combined-music-id1-wpm-id7-merged.bin";
const CODE_NAME = "combined-music-id1-wpm-id7-irom.bin";
const REPORT_NAME = "combined-music-id1-wpm-id7-manifest.json";
const DRAFT_NAME = "combined-device-approval.draft.json";
const FROZEN_LIVE_WPM_LINKED = Object.freeze({
  literalOffset: 0x10, literalBytes: 0xdc,
  literalSha256: "c447cf2300462ad218ab7d687595a5f178c06f0ca9ee5b4adadd2c3d65d24646",
  textOffset: 0x1bc, textBytes: 0x6ac,
  textSha256: "4934ea5a2ec030cb689953d813d0995854d911546b4d4ebd122014bf4b49ec0c",
  musicAddress: 0x42117778,
});

function tool(name) {
  return path.join(PINNED.toolchainDirectory, `xtensa-esp32s3-elf-${name}`);
}

async function runImageInfo(appPath) {
  const result = await run(STAGE3E3_PATHS.esptool, ["image-info", appPath], {
    cwd: WORKSPACE_ROOT, maxBuffer: 4 * 1024 * 1024,
  });
  assert(/ESP32-S3/iu.test(result.stdout) && /Validation hash:/iu.test(result.stdout),
    "esptool image-info did not validate the combined ESP32-S3 app image.");
  return result.stdout;
}

function hashMany(entries) {
  const hash = createHash("sha256");
  for (const [name, bytes] of entries) hash.update(name).update("\0").update(bytes).update("\0");
  return hash.digest("hex");
}

async function readJson(file) {
  try { return JSON.parse(await readFile(file, "utf8")); } catch { return undefined; }
}

function countU32(data, value) {
  const needle = Buffer.alloc(4); needle.writeUInt32LE(value >>> 0);
  let count = 0;
  for (let offset = 0; offset <= data.length - 4; offset += 1) {
    if (data.subarray(offset, offset + 4).equals(needle)) count += 1;
  }
  return count;
}

function body(disassembly, name) {
  const start = disassembly.indexOf(`<${name}>:`);
  assert(start >= 0, `Combined symbol ${name} is missing from disassembly.`);
  const next = disassembly.indexOf("\n\n", start);
  return disassembly.slice(start, next < 0 ? undefined : next);
}

function parseSymbols(text) {
  const symbols = new Map();
  for (const line of text.split("\n")) {
    const match = /^([0-9a-f]+)\s+([0-9a-f]+)\s+[A-Za-z]\s+(\S+)$/u.exec(line.trim());
    if (match) symbols.set(match[3], { address: Number.parseInt(match[1], 16), size: Number.parseInt(match[2], 16) });
  }
  return symbols;
}

function auditMusicTransportSource(text) {
  const info = text.slice(text.indexOf("music_id1_handle_info:"),
    text.indexOf(".size music_id1_handle_info"));
  const ui = text.slice(text.indexOf("music_id1_ui_refresh_transport:"),
    text.indexOf(".size music_id1_ui_refresh_transport"));
  const uiWrapper = text.slice(text.indexOf("music_id1_ui_refresh:"),
    text.indexOf(".size music_id1_ui_refresh"));
  assert(/mov\s+a10, a2\s+call8\s+\.Lui_refresh_transport_entry/u.test(uiWrapper),
    "Music UI wrapper lost its windowed-ABI controller forwarding.");
  assert(info.length > 0 && ui.length > 0, "Music transport source functions are missing.");
  assert(!/\.asciz\b/u.test(text) && !/\.L(?:method|key|value)_.+_ptr:/u.test(text),
    "Music source contains an ordinary appended-IROM string pointer.");
  const registration = text.slice(text.indexOf("music_id1_register_media_rpc:"),
    text.indexOf(".size music_id1_register_media_rpc"));
  const strings = text.slice(text.indexOf("music_id1_init_rpc_strings:"),
    text.indexOf(".size music_id1_init_rpc_strings"));
  assert(text.includes(".Ltransport_state_bytes:        .long 87980") &&
    text.includes(".Lstring_table_offset:          .long 25808") &&
    registration.includes("call8   .Linit_rpc_strings_entry") &&
    (registration.match(/l32r\s+a8, \.Lstring_table_offset/gu)?.length ?? 0) === 2 &&
    (strings.match(/l32r\s+a8, \.Lstr_/gu)?.length ?? 0) === 38 &&
    strings.includes("s32i    a8, a7, 148") && strings.includes("memw"),
  "Music source lost its fixed 152-byte controller-lifetime RPC string table.");
  const outsideStringInit = text.slice(0, text.indexOf("music_id1_init_rpc_strings:")) +
    text.slice(text.indexOf(".size music_id1_init_rpc_strings"));
  assert(!/l32r\s+\w+, \.Lstr_/u.test(outsideStringInit),
    "Music reads an RPC word literal outside its fixed-RAM string-table initializer.");
  assert(info.indexOf("or      a8, a8, a9") >= 0 &&
    info.indexOf("or      a8, a8, a9") < info.indexOf("call8   music_id1_read_string") &&
    /\.Linfo_publish:[\s\S]*memw[\s\S]*l32i\s+a8, a7, 140[\s\S]*addi\s+a8, a8, 1[\s\S]*s32i\s+a8, a7, 140[\s\S]*memw/u.test(info),
  "Music metadata source lost its odd-write/even-publish seqlock.");
  assert((info.match(/max\s+a10, a10, a8/gu)?.length ?? 0) === 2 &&
    (info.match(/min\s+a10, a10, a8/gu)?.length ?? 0) === 2 &&
    info.includes(".Linfo_store_stopped:"),
  "Music metadata numeric clamps or playing normalization changed.");
  const readString = text.slice(text.indexOf("music_id1_read_string:"),
    text.indexOf(".size music_id1_read_string"));
  assert(info.includes("entry   a1, 320") && info.includes("addi    a10, a1, 224") &&
    info.includes("movi.n  a12, 10") && info.includes("movi.n  a12, 6") &&
    info.includes("movi.n  a12, 12") &&
    (info.match(/l32r\s+a8, \.Ljson_proxy_dtor_fn/gu)?.length ?? 0) === 1 &&
    readString.includes("addi    a10, a7, 56") &&
    readString.includes("l32r    a8, .Ljson_lookup_fn") &&
    readString.includes("l32r    a8, .Ljson_string_tuple_fn") &&
    readString.includes("mov     a4, a11") && readString.includes("min     a6, a6, a4") &&
    !/\.Ljson_(?:proxy_ctor|variant|string)_fn/u.test(readString) &&
    !readString.includes(".Ljson_proxy_dtor_fn"),
  "Music metadata lost direct lookup/string-tuple conversion or root-only ownership.");
  for (const pointer of ["addi    a11, a4, 36", "addi    a11, a4, 48",
    "addi    a11, a4, 56", "addi    a11, a4, 64", "addi    a11, a4, 80",
    "mov     a13, a4"]) {
    assert(info.includes(pointer), `Music metadata helper lost fixed RAM pointer ${pointer}.`);
  }
  const artwork = text.slice(text.indexOf("music_id1_handle_art:"),
    text.indexOf(".size music_id1_handle_art"));
  assert(artwork.includes("entry   a1, 320") && artwork.includes("addi    a10, a1, 224") &&
    artwork.includes("addi    a10, a10, 56") && artwork.includes("addi    a11, a4, 92") &&
    artwork.includes("movi.n  a12, 4") && artwork.includes("movi.n  a13, 1") &&
    artwork.includes("addi    a14, a1, 224") && artwork.includes("l32r    a8, .Ljson_lookup_fn") &&
    artwork.includes("l32r    a8, .Ljson_string_tuple_fn") &&
    artwork.includes("s32i    a10, a1, 88") && artwork.includes("s32i    a11, a1, 92") &&
    (artwork.match(/l32r\s+a8, \.Ljson_proxy_dtor_fn/gu)?.length ?? 0) === 2,
  "Music artwork lost direct-lookup/string-tuple sequence or root-only ownership.");
  assert(text.includes(".Lbase64_decode_fn:             .long 0x420cd968") &&
    artwork.includes("addi    a12, a1, 96") && artwork.includes("l32i    a13, a1, 88") &&
    artwork.includes("l32i    a14, a1, 92") && artwork.includes("l32r    a8, .Lbase64_decode_fn") &&
    artwork.includes("bne     a10, a11, .Lart_error_decoded_length") &&
    artwork.includes("add     a9, a9, a11") &&
    /add\s+a9, a9, a11[^\n]*\n\s*memw[^\n]*\n\s*l32r\s+a8, \.Lartwork_bytes[\s\S]*bne\s+a9, a8, \.Lart_reply_ok_proxy/u.test(artwork),
  "Music artwork lost the pinned stock Framer base64 decoder contract.");
  assert(/s32i\s+a8, a7, 196\s+memw[^\n]*\n\.Lart_continue:\s+memw[^\n]*\n\s*l32i\s+a8, a7, 196/u.test(artwork) &&
    !/[ls]32i\s+\w+, a7, 192/u.test(artwork) &&
    /s32i\s+a8, a7, 200\s+memw/u.test(artwork),
    "Music artwork lost transaction-state publish/acquire fences.");
  assert(/beqz\s+a9, \.Lart_offset_allowed[\s\S]*beq\s+a9, a8, \.Lart_offset_allowed[^\n]*3072[\s\S]*beq\s+a9, a10, \.Lart_offset_allowed[^\n]*6144[\s\S]*beq\s+a9, a10, \.Lart_offset_allowed[^\n]*9216[\s\S]*bne\s+a9, a10, \.Lart_error_order[^\n]*12288/u.test(artwork),
    "Music artwork lost exact fixed Input chunk-boundary validation.");
  for (let stage = 1; stage <= 9; stage += 1) {
    assert(text.includes(`.Ldiag_e${stage}:`) &&
      artwork.includes(`movi.n  a12, ${stage}`),
    `Music artwork lost bounded diagnostic stage e${stage}.`);
  }
  for (const [label, stage] of [["data_lookup", 7], ["data_string", 9]]) {
    assert(new RegExp(`\\.Lart_error_${label}:[\\s\\S]*movi\\.n\\s+a12, ${stage}\\b`, "u").test(artwork),
      `Music artwork lost split string diagnostic ${label}/e${stage}.`);
  }
  assert(/\.Lart_error_decode:[\s\S]*movi\.n\s+a12, -1/u.test(artwork) &&
    /\.Lart_error_decoded_length:[\s\S]*movi\.n\s+a12, -1/u.test(artwork),
  "Music post-string decode failures lost bounded generic-error handling.");
  for (const pointer of ["addi    a11, a4, 100", "addi    a11, a4, 108",
    "addi    a11, a4, 92", "mov     a13, a4"]) {
    assert(artwork.includes(pointer), `Music artwork helper lost fixed RAM pointer ${pointer}.`);
  }
  const reply = text.slice(text.indexOf("music_id1_reply_status:"),
    text.indexOf(".size music_id1_reply_status"));
  assert(reply.includes("addi    a4, a5, 116") && reply.includes("addi    a5, a5, 124") &&
    reply.includes("beq     a4, a8, .Lreply_build_error") &&
    reply.includes("sub     a10, a5, a9") && reply.includes("addi    a5, a10, 148") &&
    reply.includes("add     a4, a10, a9") && reply.includes("addi    a4, a4, 116") &&
    reply.includes("mov     a12, a4"),
  "Music response helper lost fixed RAM status key/value pointers.");
  assert(ui.includes("entry   a1, 224") &&
    (ui.match(/l32i\s+a8, a6, 140/gu)?.length ?? 0) === 2 &&
    ui.includes(".Lui_transport_copy_word:") &&
    ui.includes("addi    a11, a1, 16") && ui.includes("addi    a11, a1, 80"),
  "Music UI lost its generation-double-checked private metadata snapshot.");
  assert(/beqz\s+a8, \.Lui_transport_art[\s\S]*movi\.n\s+a10, 1[\s\S]*bne\s+a5, a10, \.Lui_transport_art/u.test(ui) &&
    /bne\s+a8, a9, \.Lui_transport_art_apply[\s\S]*beqz\s+a8, \.Lui_transport_done[\s\S]*bne\s+a5, a10, \.Lui_transport_done/u.test(ui),
  "Music UI lost accepted metadata/artwork replay after a screen rebuild.");
}

export function renderStage3e34RegistrationOnly(source) {
  assert(typeof source === "string", "Stage-3E.3.4 source is required.");
  const required = [
    ".Loriginal_screen_setup:", ".Lroot_registry_getter:", ".Lregistry_from_root:",
    ".Lscreen_manager_getter:", ".global stage3e34_screen_setup_wrapper",
    ".global stage3e34_register_wpm",
  ];
  for (const token of required) assert(source.includes(token), `Stage-3E.3.4 source lost ${token}.`);
  assert(source.includes(".section .literal.stage3e34_setup") &&
    source.includes(".section .text.stage3e34_setup"),
  "WPM setup is not isolated into the owner-reviewed discardable sections.");
  assert(source.includes(".global stage3e34_register_wpm") &&
    /l32i\s+a8, a5, 20[\s\S]*bne\s+a8, a7, \.Lregister_failed/u.test(source),
  "WPM registration export or post-registration navigation gate changed.");
  return source;
}

function combinedLinker() {
  return `ENTRY(f1_combined_setup_wrapper)
SECTIONS {
  . = 0x${PINNED.codeBaseAddress.toString(16)};
  .combined_literal : ALIGN(4) {
    KEEP(*(.literal.f1_combined_setup))
    KEEP(*(.literal.stage3e34_wpm_sprite))
    KEEP(*(.literal.music_id1))
  }
  .combined_text : ALIGN(4) {
    KEEP(*(.text.f1_combined_setup))
    KEEP(*(.text.stage3e34_wpm_sprite))
    KEEP(*(.text.music_id1))
    . = ALIGN(4);
  }
  /DISCARD/ : {
    *(.literal.stage3e34_setup)
    *(.text.stage3e34_setup)
    *(.comment)
    *(.xtensa.info)
  }
}
`;
}

async function compileOnce({ directory, wrapper, wpm, music, linker }) {
  const files = {
    wrapper: path.join(directory, "combined-wrapper.S"),
    wpm: path.join(directory, "stage3e34-registration-only.S"),
    music: path.join(directory, "music-id1.S"),
    linker: path.join(directory, "combined.ld"),
  };
  await Promise.all([
    writeFile(files.wrapper, wrapper), writeFile(files.wpm, wpm), writeFile(files.music, music),
    writeFile(files.linker, linker),
  ]);
  const objects = ["wrapper", "wpm", "music"].map((name) => path.join(directory, `${name}.o`));
  await Promise.all([
    run(tool("as"), ["--longcalls", "--text-section-literals", "-o", objects[0], files.wrapper]),
    run(tool("as"), ["-o", objects[1], files.wpm]),
    run(tool("as"), ["--longcalls", "--text-section-literals", "-o", objects[2], files.music]),
  ]);
  const elf = path.join(directory, "combined.elf");
  const binary = path.join(directory, "combined.bin");
  await run(tool("ld"), ["-T", files.linker, "-o", elf, ...objects]);
  const [header, relocation, symbolResult, disassemblyResult] = await Promise.all([
    run(tool("objdump"), ["-f", "-h", elf]), run(tool("readelf"), ["-r", elf]),
    run(tool("nm"), ["-S", elf]), run(tool("objdump"), ["-d", elf], { maxBuffer: 4 * 1024 * 1024 }),
  ]);
  assert(/elf32-xtensa-le/u.test(header.stdout) && /There are no relocations/u.test(relocation.stdout),
    "Combined ID1/ID7 output must be S3 little-endian and relocation-free.");
  await run(tool("objcopy"), ["-O", "binary", elf, binary]);
  return { bytes: await readFile(binary), sections: header.stdout,
    symbols: parseSymbols(symbolResult.stdout), disassembly: disassemblyResult.stdout };
}

function auditCombinedCode(result) {
  const required = ["f1_combined_setup_wrapper", "music_id1_register", "stage3e34_register_wpm",
    "music_id1_build", "stage3e34_wpm_build", "music_id1_register_media_rpc",
    "music_id1_info_callback", "music_id1_handle_info", "music_id1_art_callback",
    "music_id1_handle_art"];
  for (const name of required) {
    const symbol = result.symbols.get(name);
    assert(symbol && symbol.address >= PINNED.codeBaseAddress &&
      symbol.address + symbol.size <= PINNED.codeBaseAddress + result.bytes.length,
    `Combined symbol ${name} is outside the single appended IROM payload.`);
  }
  assert(!result.symbols.has("stage3e34_screen_setup_wrapper"),
    "Standalone WPM setup wrapper survived the combined link.");
  const firstStringWord = Buffer.from([0x6d, 0x70, 0x2e, 0x77]);
  const lastStringWord = Buffer.from([0x72, 0x00, 0x00, 0x00]);
  const stringStart = result.bytes.indexOf(firstStringWord);
  const stringEndWord = result.bytes.indexOf(lastStringWord, stringStart + 4);
  assert(stringStart >= 0 && stringEndWord >= stringStart,
    "Combined packed RPC word-literal region is missing.");
  for (let offset = stringStart; offset <= stringEndWord; offset += 4) {
    const pointer = Buffer.alloc(4);
    pointer.writeUInt32LE(PINNED.codeBaseAddress + offset);
    assert(!result.bytes.includes(pointer),
      `Combined code contains an ordinary IROM pointer into RPC words at +0x${offset.toString(16)}.`);
  }
  assert(result.symbols.get("music_id1_register").address === FROZEN_LIVE_WPM_LINKED.musicAddress &&
    sha256(result.bytes.subarray(FROZEN_LIVE_WPM_LINKED.literalOffset,
      FROZEN_LIVE_WPM_LINKED.literalOffset + FROZEN_LIVE_WPM_LINKED.literalBytes)) ===
      FROZEN_LIVE_WPM_LINKED.literalSha256 &&
    sha256(result.bytes.subarray(FROZEN_LIVE_WPM_LINKED.textOffset,
      FROZEN_LIVE_WPM_LINKED.textOffset + FROZEN_LIVE_WPM_LINKED.textBytes)) ===
      FROZEN_LIVE_WPM_LINKED.textSha256,
  "Music-only build changed the live-complete WPM linked literals/text byte-for-byte.");
  assert(countU32(result.bytes, 0x4202c108) === 1,
    "Combined code must contain exactly one stock setup literal.");
  const wrapper = body(result.disassembly, "f1_combined_setup_wrapper");
  const music = body(result.disassembly, "music_id1_register");
  const musicRpcRegistration = body(result.disassembly, "music_id1_register_media_rpc");
  const wpm = body(result.disassembly, "stage3e34_register_wpm");
  const musicBuild = body(result.disassembly, "music_id1_build");
  const musicCleanup = body(result.disassembly, "music_id1_cleanup");
  const originalCall = wrapper.indexOf("callx8");
  const musicCall = wrapper.search(/call8\s+(?:0x)?[0-9a-f]+\s+<music_id1_register>/u);
  const wpmCall = wrapper.search(/call8\s+(?:0x)?[0-9a-f]+\s+<stage3e34_register_wpm>/u);
  assert(originalCall >= 0 && musicCall > originalCall && wpmCall > musicCall,
    "Combined setup order is not stock once, Music ID1, then WPM ID7.");
  for (const [name, functionBody, id] of [
    ["Music", `${music}\n${musicRpcRegistration}`, 1], ["WPM", wpm, 7],
  ]) {
    assert(/l32i(?:\.n)?\s+a8, a5, 20[\s\S]*bne\s+a8, a7/u.test(functionBody),
      `${name} navigation lacks the controller+20 registry success gate.`);
    assert(new RegExp(`movi(?:\\.n)?\\s+a11, ${id}\\b`, "u").test(functionBody),
      `${name} registration does not add its exact navigation ID ${id}.`);
  }
  assert(!/call8\s+[^\n]*<music_id1_make_panel>/u.test(musicBuild),
    "Music build contains a forbidden label-as-panel creation path.");
  assert(!/call(?:8|x8)/u.test(musicCleanup),
    "Music cleanup must clear borrowed pointers only and must never free LVGL/controller memory.");
  assert(result.bytes.length < 0x10000, "Combined code exceeds one IROM growth budget page.");
  return { wrapperAddress: result.symbols.get("f1_combined_setup_wrapper").address,
    bytes: result.bytes.length, sha256: sha256(result.bytes), relocations: 0 };
}

function composeCombined({ official, e3a, e31, code, wrapperAddress }) {
  const e3aInfo = inspectEsp32AppImage(e3a);
  const e31Info = inspectEsp32AppImage(e31);
  const assetPage = e31.subarray(STAGE3E34_ASSET_BANK_APP_OFFSET,
    STAGE3E34_ASSET_BANK_APP_OFFSET + STAGE3E34_DROM_GROWTH_BYTES);
  assert(assetPage.length === 0x10000 && sha256(assetPage) === STAGE3E34_PADDED_BANK_SHA256,
    "Combined asset donor is not the exact E3.3.4/E3.3.1 shared page.");
  let app = Buffer.from(e3a);
  assetPage.copy(app, STAGE3E34_ASSET_BANK_APP_OFFSET);
  app = repairEsp32AppIntegrity(app);
  app = extendEsp32AppSegment(app, { segmentIndex: PINNED.iromSegmentIndex,
    data: code.subarray(STAGE3E3A_ABI_BYTES) });
  code.copy(app, STAGE3E3A_ABI_APP_OFFSET);
  app.writeUInt32LE(wrapperAddress, STAGE3C1_SETUP_POINTER_APP_OFFSET);
  app = repairEsp32AppIntegrity(app);
  const final = inspectEsp32AppImage(app);
  const stockDromBytes = e3aInfo.segments[0].length - 0x10000;
  const stockIromBytes = e3aInfo.segments[3].length - STAGE3E3A_ABI_BYTES;
  const setup = STAGE3C1_SETUP_POINTER_APP_OFFSET - e3aInfo.segments[0].dataOffset;
  for (let index = 0; index < 6; index += 1) {
    const before = e3aInfo.segments[index];
    const after = final.segments[index];
    assert(before.loadAddress === after.loadAddress, `Combined segment ${index} VA changed.`);
    if (index === 0) {
      assert(after.length === before.length &&
        after.data.subarray(0, setup).equals(before.data.subarray(0, setup)) &&
        after.data.subarray(setup + 4, stockDromBytes).equals(before.data.subarray(setup + 4, stockDromBytes)) &&
        after.data.subarray(stockDromBytes).equals(assetPage), "Combined DROM mutation escaped setup/page contract.");
    } else if (index === 3) {
      assert(after.length === stockIromBytes + code.length &&
        after.data.subarray(0, stockIromBytes).equals(before.data.subarray(0, stockIromBytes)) &&
        after.data.subarray(stockIromBytes).equals(code), "Combined IROM is not stock prefix plus sole combined code.");
    } else assert(after.data.equals(before.data), `Combined untargeted segment ${index} changed.`);
  }
  assert(e31Info.segments[0].data.subarray(stockDromBytes).equals(assetPage),
    "E3.3.1 donor page comparison changed.");
  assert(app.readUInt32LE(STAGE3C1_SETUP_POINTER_APP_OFFSET) === wrapperAddress,
    "Combined setup pointer is wrong.");
  assert(app.readUInt32LE(STAGE3C1_KEY_CALLBACK_APP_OFFSET + 0x10000) ===
    FRAMER_SCREEN_AUDIT.wpmKeyCallbackLiteral.expectedValue &&
    app.readUInt32LE(STAGE3C1_WPM_TICK_APP_OFFSET) ===
      FRAMER_SCREEN_AUDIT.wpmTickVtablePointer.expectedValue &&
    app.readUInt32LE(REMAINING_GETTER_LITERAL_APP_OFFSET + 0x10000) === STOCK_REMAINING_GETTER,
  "Combined image changed a stock key/WPM/Timer hook.");
  assert(final.segments.filter(({ loadAddress }) => loadAddress === PINNED.dromLoadAddress).length === 1 &&
    final.segments.filter(({ loadAddress }) => loadAddress === PINNED.iromLoadAddress).length === 1,
  "Combined image must retain one DROM and one IROM.");
  assert((final.segments[3].dataOffset & 0xffff) === (final.segments[3].loadAddress & 0xffff) &&
    app.length <= PINNED.factoryPartitionBytes, "Combined mapping/partition gate failed.");
  const merged = Buffer.concat([official.subarray(0, PINNED.appFlashOffset), app]);
  return { app, merged, final, assetPage };
}

export async function buildCombinedFirmware({ outputDirectory = path.join(SDK_ROOT, "build/combined") } = {}) {
  const started = Date.now();
  const outputRoot = path.resolve(outputDirectory);
  await mkdir(outputRoot, { recursive: true });
  const [wrapper, wpmFull, music, builderSource, official, c1, e3a, e31, e34, registerHex, registerLinker,
    stockApp, recovery, ...toolchainBytes] = await Promise.all([
    readFile(WRAPPER_SOURCE, "utf8"), readFile(WPM_SOURCE, "utf8"), readFile(MUSIC_SOURCE, "utf8"),
    readFile(new URL(import.meta.url)),
    readFile(PINNED.officialMerged.path), readFile(STAGE3E3_PATHS.c1), readFile(E3A_APP),
    readFile(E31_APP), readFile(E34_APP),
    readFile(E34_REGISTER_HEX, "utf8"), readFile(E34_REGISTER_LINKER, "utf8"),
    readFile(path.join(WORKSPACE_ROOT, "artifacts/firmware/framer_app_0.4.1.bin")),
    verifyRecoveryGate(),
    ...Object.keys(PINNED.toolchain).map((name) => readFile(tool(name))),
  ]);
  assert(sha256(official) === PINNED.officialMerged.sha256 &&
    sha256(c1) === PINNED.stage3c1Abi.appSha256 && sha256(e3a) === EXPECTED_STAGE3E3A_APP_SHA256 &&
    sha256(e31) === EXPECTED_STAGE3E31_APP_SHA256 && sha256(e34) === EXPECTED_STAGE3E34_APP_SHA256,
  "Combined official/C1/E3A/E3.3.1/E3.3.4 base hash gate failed.");
  Object.entries(PINNED.toolchain).forEach(([name, expected], index) => {
    assert(sha256(toolchainBytes[index]) === expected, `Pinned ${name} toolchain hash failed.`);
  });
  assert(e31.subarray(STAGE3E34_ASSET_BANK_APP_OFFSET,
    STAGE3E34_ASSET_BANK_APP_OFFSET + 0x10000).equals(e34.subarray(STAGE3E34_ASSET_BANK_APP_OFFSET,
      STAGE3E34_ASSET_BANK_APP_OFFSET + 0x10000)),
  "E3.3.4 asset page differs from the live-passed E3.3.1 donor page.");
  const registry = auditFramerScreenRegistry(stockApp);
  assert(registry.controllerIds.includes(8) && JSON.stringify(registry.unusedIds) === JSON.stringify([1, 7]),
    "Combined screen IDs drifted; ID8 must remain stock-occupied and only ID1/ID7 available.");
  const wpm = renderStage3e34RegistrationOnly(wpmFull);
  auditMusicTransportSource(music);
  const pinnedRegisterBytes = Buffer.from(registerHex.replace(/\s+/gu, ""), "hex");
  assert(/^[0-9a-f\s]+$/u.test(registerHex) && pinnedRegisterBytes.length > 0,
    "Pinned Stage-3E.3.4 registration-only hex is invalid.");
  const linker = combinedLinker();
  const sourceFingerprint = hashMany([
    ["wrapper", Buffer.from(wrapper)], ["wpm", Buffer.from(wpmFull)],
    ["music", Buffer.from(music)], ["combined-builder", builderSource],
    ["combined-linker", Buffer.from(linker)],
    ["register-linker", Buffer.from(registerLinker)], ["register-hex", pinnedRegisterBytes],
    ["official", official], ["c1", c1], ["e3a", e3a], ["e31", e31], ["e34", e34],
    ["recovery", Buffer.from(recovery.sha256)],
    ...Object.keys(PINNED.toolchain).map((name, index) => [name, toolchainBytes[index]]),
  ]);
  const appPath = path.join(outputRoot, APP_NAME);
  const mergedPath = path.join(outputRoot, MERGED_NAME);
  const codePath = path.join(outputRoot, CODE_NAME);
  const reportPath = path.join(outputRoot, REPORT_NAME);
  const approvalDraftPath = path.join(outputRoot, DRAFT_NAME);
  const cachePath = path.join(outputRoot, ".combined-cache.json");
  const cache = await readJson(cachePath);
  if (cache?.sourceFingerprint === sourceFingerprint) {
    try {
      const [cachedReport, approvalDraft, app, merged, code] = await Promise.all([
        readJson(reportPath), readJson(approvalDraftPath), readFile(appPath), readFile(mergedPath), readFile(codePath),
      ]);
      assert(cachedReport?.format === "framer-f1-combined-music-id1-wpm-id7-candidate-v1" &&
        cachedReport.sourceFingerprint === sourceFingerprint &&
        cachedReport.outputs?.app?.sha256 === sha256(app) && cachedReport.outputs.app.bytes === app.length &&
        cachedReport.outputs?.merged?.sha256 === sha256(merged) && cachedReport.outputs.merged.bytes === merged.length &&
        cachedReport.code?.sha256 === sha256(code) && cachedReport.code.bytes === code.length,
      "Combined cache output hashes changed.");
      assert(approvalDraft?.status === "AWAITING_MAIN_APPROVAL" &&
        approvalDraft.write?.hardwareWriteApproved === false &&
        approvalDraft.app?.sha256 === sha256(app), "Combined cached approval draft changed.");
      const [inspection, imageInfo] = await Promise.all([inspectImage(appPath), runImageInfo(appPath)]);
      assert(inspection.segmentCount === 6 && /ESP32-S3/iu.test(imageInfo),
        "Combined cache image verification failed.");
      const report = { ...cachedReport, cache: { build: "hit", sourceFingerprint },
        elapsedMs: Date.now() - started };
      await writeFile(reportPath, stableJson(report));
      return Object.freeze({ report, reportPath, approvalDraftPath, appPath, mergedPath, codePath });
    } catch {
      // A partial or changed cache is never reused; the full deterministic build below repairs it.
    }
  }
  const temporary = await mkdtemp(path.join(os.tmpdir(), "f1-combined-id1-id7-"));
  try {
    const firstDir = path.join(temporary, "first");
    const secondDir = path.join(temporary, "second");
    await Promise.all([mkdir(firstDir), mkdir(secondDir)]);
    const registerDir = path.join(temporary, "register-pin");
    await mkdir(registerDir);
    const registerSourcePath = path.join(registerDir, "wpm.S");
    const registerLinkerPath = path.join(registerDir, "wpm.ld");
    const registerObject = path.join(registerDir, "wpm.o");
    const registerElf = path.join(registerDir, "wpm.elf");
    const registerBinary = path.join(registerDir, "wpm.bin");
    await Promise.all([writeFile(registerSourcePath, wpm), writeFile(registerLinkerPath, registerLinker)]);
    await run(tool("as"), ["-o", registerObject, registerSourcePath]);
    await run(tool("ld"), ["-T", registerLinkerPath, "-o", registerElf, registerObject]);
    const registerRelocations = (await run(tool("readelf"), ["-r", registerElf])).stdout;
    assert(/There are no relocations/u.test(registerRelocations), "Pinned WPM registration artifact has relocations.");
    await run(tool("objcopy"), ["-O", "binary", registerElf, registerBinary]);
    const rebuiltRegisterBytes = await readFile(registerBinary);
    assert(rebuiltRegisterBytes.equals(pinnedRegisterBytes),
      "Rendered WPM registration-only object differs from the owner-pinned artifact.");

    const [first, second] = await Promise.all([
      compileOnce({ directory: firstDir, wrapper, wpm, music, linker }),
      compileOnce({ directory: secondDir, wrapper, wpm, music, linker }),
    ]);
    assert(first.bytes.equals(second.bytes), "Two combined builds produced different code.");
    const codeAudit = auditCombinedCode(first);
    const firstImage = composeCombined({ official, e3a, e31: e34, code: first.bytes,
      wrapperAddress: codeAudit.wrapperAddress });
    const secondImage = composeCombined({ official, e3a, e31: e34, code: second.bytes,
      wrapperAddress: codeAudit.wrapperAddress });
    assert(firstImage.app.equals(secondImage.app) && firstImage.merged.equals(secondImage.merged),
      "Two combined image compositions differ.");
    await Promise.all([
      writeFile(appPath, firstImage.app), writeFile(mergedPath, firstImage.merged),
      writeFile(codePath, first.bytes), writeFile(path.join(outputRoot, "combined-rendered-wpm-registration.S"), wpm),
      writeFile(path.join(outputRoot, "combined-rendered.ld"), linker),
      writeFile(path.join(outputRoot, "combined-disassembly.txt"), first.disassembly),
    ]);
    const [inspection, imageInfo] = await Promise.all([inspectImage(appPath), runImageInfo(appPath)]);
    const report = {
      format: "framer-f1-combined-music-id1-wpm-id7-candidate-v1",
      status: "OFFLINE_DETERMINISTIC_CANDIDATE_AWAITING_MAIN_APPROVAL",
      deployable: false,
      target: { device: "knob_f1", firmware: "0.4.1", screenIds: { music: 1, wpm: 7 },
        prohibitedScreenId: 8 },
      setup: { soleWrapper: "f1_combined_setup_wrapper", address: `0x${codeAudit.wrapperAddress.toString(16)}`,
        stockSetupCalls: 1, order: ["stock", "music_id1_register", "stage3e34_register_wpm"] },
      registration: { musicNavGate: "controller+20 == registry", wpmNavGate: "controller+20 == registry",
        independentAllocationFailure: true },
      wpm: { source: WPM_SOURCE, registrationOnly: true, standaloneWrapperLinked: false,
        pinnedRegistrationArtifact: { file: E34_REGISTER_HEX, bytes: pinnedRegisterBytes.length,
          sha256: sha256(pinnedRegisterBytes) },
        runtimeAssetEnd: "0x3c1cf36c", runtimeBoundaryExclusive: "0x3c1d0000", headroomBytes: 3220,
        pet: "96x78 RAM-expanded active I4 source plus exact E3A fallback",
        liveCompleteFrozenLinkedBytes: { ...FROZEN_LIVE_WPM_LINKED, preservedByteForByte: true } },
      music: { source: MUSIC_SOURCE, screenId: 1, dromBytes: 0,
        album: "80x80 RGB565 host-fed ping-pong RAM after initial 64x64 fixture",
        mediaRpc: { metadata: "mp.write_info", artwork: "mp.write_artwork",
          transportStateBytes: 87980, artworkBytes: 12800, chunkRawBytes: 3072,
          rpcStringTableOffset: 25808, rpcStringTableBytes: 152,
          rpcTaskTouchesLvgl: false, uiThreadGenerationApply: true,
          metadataSynchronization: "odd/even seqlock plus private UI snapshot",
          screenRebuildReplay: true },
        crashContainment: "No label-as-panel objects; background image, album image, and three text labels only" },
      code: { file: codePath, ...codeAudit, deterministicRebuilds: 2 },
      outputs: {
        app: { file: appPath, bytes: firstImage.app.length, sha256: sha256(firstImage.app) },
        merged: { file: mergedPath, bytes: firstImage.merged.length, sha256: sha256(firstImage.merged) },
        inspection,
      },
      bases: { officialMergedSha256: sha256(official), exactC1AppSha256: sha256(c1),
        liveE3aRollbackSha256: sha256(e3a), recovery,
        livePassedE31AssetDonorSha256: sha256(e31), exactE34AppSha256: sha256(e34),
        assetPageSha256: sha256(firstImage.assetPage) },
      safety: { hardwareAccess: false, approvalRequired: true, appOnlyOffset: "0x10000",
        stockHooksPreserved: true, segments: 6, dromSegments: 1, iromSegments: 1 },
      verification: { abi: "PASS", deterministicBuild: "PASS", checksumDigest: "PASS",
        esptoolImageInfo: "PASS", esptoolImageInfoSha256: sha256(Buffer.from(imageInfo)),
        rollbackPreflight: "PASS" },
      elapsedMs: Date.now() - started,
      sourceFingerprint,
      cache: { build: "miss", sourceFingerprint },
    };
    const approvalDraft = {
      format: "framer-f1-device-candidate-v1",
      status: "AWAITING_MAIN_APPROVAL",
      target: { device: "knob_f1", firmware: "0.4.1", chip: "ESP32-S3", mac: "a4:cb:8f:af:32:10" },
      write: { offset: "0x10000", scope: "factory-app-only", hardwareWriteApproved: false },
      app: report.outputs.app,
      rollback: { sha256: EXPECTED_STAGE3E3A_APP_SHA256 },
      runtime: { allAssetBytesBelow: "0x3c1d0000", headroomBytes: 3220 },
    };
    await Promise.all([
      writeFile(reportPath, stableJson(report)), writeFile(approvalDraftPath, stableJson(approvalDraft)),
      writeFile(cachePath, stableJson({ sourceFingerprint, appSha256: report.outputs.app.sha256,
        mergedSha256: report.outputs.merged.sha256, codeSha256: report.code.sha256 })),
    ]);
    return Object.freeze({ report, reportPath, approvalDraftPath, appPath, mergedPath, codePath });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
