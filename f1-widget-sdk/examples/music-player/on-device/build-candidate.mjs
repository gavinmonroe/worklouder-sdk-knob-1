import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const workspaceRoot = path.resolve(moduleRoot, "../../../..");
const toolchain = path.join(workspaceRoot, ".toolchains/xtensa-esp-elf-13.2.0_20240530/bin");
const source = path.join(moduleRoot, "music-player-id1.S");
const linker = path.join(moduleRoot, "music-player-id1.ld");
const officialApp = path.join(workspaceRoot, "artifacts/firmware/framer_app_0.4.1.bin");
const defaultOutput = path.join(moduleRoot, "../generated/on-device-candidate");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function stableJson(value) {
  return `${JSON.stringify(stable(value), null, 2)}\n`;
}

const STOCK_WINDOWS = Object.freeze([
  [0x420e7c04, "3414948f9d5fefc040714fdee428ff559e501097826268628de6d36a1c75cf81", "operator new"],
  [0x3c1acc34, "c9128709a6bfab7a00768221964b9af618a643239186be59a3a805431cff239e", "controller base vtable"],
  [0x4204da84, "f3820932cac4b57f5e8111645cb0e01183623bb16119bd44086f598fe82fbb66", "registry add controller"],
  [0x420293a8, "129929f12eb7726028927fdac27d624df1c0e558873fde489dc49f7d08b47c8c", "navigation add ID"],
  [0x420ae8a0, "257132ed2e582d49cb814b0e709239b5968badb8a3143a08e5ab324830f260f8", "LVGL image create"],
  [0x420aeef0, "a8fa32979cc2e8239796b00154f07376910b6815f175613d9743cd78d3008d7f", "LVGL image set source"],
  [0x4204f170, "fc7a0a882d28271d5080af908166fb1a7b4a6982e4f366295117eb57c1b860fa", "label create"],
  [0x4204f018, "2d9620e1ad1826bf06e06a93ee7c30e090e1cf9b1969d0a8332c345466b51f21", "label font"],
  [0x4204ee30, "211965b244a4642b1b68722494b300e507a4e2084de1ce01298da4cceaf357fb", "label text"],
  [0x4204ef44, "9abeca42351ef686a3b278b10b34de73f9b9424bbd013821082c16b0246a309a", "label text color"],
  [0x4209d154, "e940da1caedb9ec2f7b45583790084196769881d1cc8284345bb0655e5a67480", "LVGL object size"],
  [0x4204f0d0, "77671ad32016ce758110635db0efc813ce0f8fd36b1bc26c052a50918ebc9dac", "LVGL object alignment"],
  [0x4204ef10, "a7ec82aa4a21c87c6b9cfdc48ce2d1a9484d8cfbd09e35ef29d5bce7b9096a06", "background color"],
  [0x4204efd0, "d6cee49ec8631e76a417cba4c5c63eb643bc33732e752c07e76dbe210b7a8619", "background opacity"],
  [0x420a0f38, "b5c80591ff1e74051710a0159373e78e7cdcaaf101b8126cca7ba432bb8f582d", "style radius property 12"],
  [0x3c18e960, "0c4c96c92c3de5cf5b76713b51d9a32281e51afe42a5d573880a0071f46b5a17", "small ASCII font"],
  [0x42004afc, "7f4a92ac254fc84160e4dd757ba73389b2adeaf26227203538c5bba3752082c2", "Framer RPC registry"],
  [0x420540f4, "9d8fd56a6afea380160ee953dfca34a4e81f56e11a670a066bcb22fd8f98cb4a", "Framer RPC method registration"],
  [0x42106ae4, "d59c655a982b1d98d68c470a79f19606f2d49795bde397c47709f77f85294a35", "RPC callback temporary destructor"],
  [0x4200465c, "6dbb9120bfd531122164a1dabd45f7de3d4ea0fe56f682fd40dd22550ab467c6", "RPC callback closure ABI"],
  [0x420576a4, "e6739d321e7883d8f9ddc62c09bf3cb736d5a12eac0f4f1bd68205859ff573f1", "request JSON root constructor"],
  [0x420052e4, "0dd5b72161c9c18a102184d37c708d4d81d39959bdc705ea126eca04dc503e9c", "JSON key proxy constructor"],
  [0x42005590, "f58b5ef9263a2a5567cc63490e8ce310cc835e08511f92aaf8c622dd614addc3", "JSON variant materialization/type gate"],
  [0x420055c0, "586e5389428d2ce260e86cf6c5ecd7ef3c31722e36893f82c9be1dec763d7f05", "bounded metadata string accessor"],
  [0x420046e0, "5a25f88e25fc4a3b4fff7db2a75dc94b9d683e53c03681c8320d4310a34ae963", "JSON variant node to string tuple"],
  [0x42004f80, "a1d36c472aedcb81ce712e72b68990e849083140d8a20158c1262a3f4e54b2bb", "JSON proxy/root destructor"],
  [0x42005560, "ea9e11672401e7f126fae8a18b9158128eb5898fd1e0c7416733a06660e5261f", "direct JSON key lookup"],
  [0x42059638, "ceb8498c901e490cdc6776865b388a6e8bd5cc5debbf6da8215e0a006f506c07", "Nomad-homolog numeric JSON conversion"],
  [0x42005240, "ea5662298be488cf01cf382f1269a9ac353faa840575cf77bd1a68a87eb60a02", "stock response key builder"],
  [0x42005a18, "97de13fd6c9f286f36a56f7519dada7b2fbcd98665187009ab282bd15cdd8cf7", "stock response string assignment"],
  [0x42057d40, "adb9e4c55bb93f499023d383477e19029641cd2bf5c4fe1f986f85e48125f59e", "stock RPC response dispatch"],
  [0x420cd968, "9cc390a1b35c767f76fa861ec9fc422259249b6403b6533010ce73551de2438b", "stock Framer base64 decoder"],
]);

const APP_SEGMENTS = Object.freeze([
  { start: 0x3c120020, fileOffset: 0x20, bytes: 0xa1170 },
  { start: 0x42000020, fileOffset: 0xb0020, bytes: 0x116cf4 },
  { start: 0x4037d418, fileOffset: 0x1c6d1c, bytes: 0x179e4 },
]);

function readVirtual(app, address, bytes) {
  const segment = APP_SEGMENTS.find((candidate) => address >= candidate.start &&
    address + bytes <= candidate.start + candidate.bytes);
  if (!segment) throw new Error(`Stock address 0x${address.toString(16)} is not in a pinned app segment.`);
  const offset = segment.fileOffset + address - segment.start;
  return app.subarray(offset, offset + bytes);
}

async function auditStockWindows() {
  const app = await readFile(officialApp);
  return STOCK_WINDOWS.map(([address, expectedSha256, purpose]) => {
    const actualSha256 = sha256(readVirtual(app, address, 16));
    if (actualSha256 !== expectedSha256) throw new Error(`${purpose} stock window drifted.`);
    return { address: `0x${address.toString(16)}`, bytes: 16, sha256: actualSha256, purpose };
  });
}

async function buildOnce(directory) {
  const object = path.join(directory, "music-id1.o");
  const elf = path.join(directory, "music-id1.elf");
  const binary = path.join(directory, "music-id1-abi.bin");
  const tools = {
    as: path.join(toolchain, "xtensa-esp32s3-elf-as"),
    ld: path.join(toolchain, "xtensa-esp32s3-elf-ld"),
    objcopy: path.join(toolchain, "xtensa-esp32s3-elf-objcopy"),
    readelf: path.join(toolchain, "xtensa-esp32s3-elf-readelf"),
    nm: path.join(toolchain, "xtensa-esp32s3-elf-nm"),
    objdump: path.join(toolchain, "xtensa-esp32s3-elf-objdump"),
  };
  await run(tools.as, ["--longcalls", "--text-section-literals", "-o", object, source]);
  await run(tools.ld, ["-T", linker, "-o", elf, object]);
  const [relocations, header, disassembly] = await Promise.all([
    run(tools.readelf, ["-r", elf]).then(({ stdout }) => stdout),
    run(tools.objdump, ["-f", elf]).then(({ stdout }) => stdout),
    run(tools.objdump, ["-d", elf], { maxBuffer: 2 * 1024 * 1024 }).then(({ stdout }) => stdout),
  ]);
  if (!/There are no relocations/u.test(relocations)) throw new Error("Final music ABI retains relocations.");
  if (!/file format elf32-xtensa-le/u.test(header)) throw new Error("Music ABI is not ESP32-S3 little-endian.");
  const symbols = (await run(tools.nm, ["-n", elf])).stdout;
  for (const symbol of ["music_id1_register", "music_id1_build", "music_id1_cleanup",
    "music_id1_ui_refresh", "music_id1_id", "music_id1_encoder", "music_id1_register_media_rpc",
    "music_id1_info_callback", "music_id1_handle_info", "music_id1_art_callback",
    "music_id1_handle_art", "music_id1_decode_base64"]) {
    if (!new RegExp(`\\b${symbol}$`, "mu").test(symbols)) throw new Error(`Missing exported ${symbol}.`);
  }
  await run(tools.objcopy, ["-O", "binary", elf, binary]);
  return { bytes: await readFile(binary), elf, symbols, disassembly };
}

async function buildIntegrationHarness(directory) {
  const tools = {
    as: path.join(toolchain, "xtensa-esp32s3-elf-as"),
    ld: path.join(toolchain, "xtensa-esp32s3-elf-ld"),
    objcopy: path.join(toolchain, "xtensa-esp32s3-elf-objcopy"),
    readelf: path.join(toolchain, "xtensa-esp32s3-elf-readelf"),
    nm: path.join(toolchain, "xtensa-esp32s3-elf-nm"),
    objdump: path.join(toolchain, "xtensa-esp32s3-elf-objdump"),
  };
  const wrapperObject = path.join(directory, "combined-wrapper.o");
  const musicObject = path.join(directory, "combined-music.o");
  const stubSource = path.join(directory, "wpm-registration-stub.S");
  const stubObject = path.join(directory, "wpm-registration-stub.o");
  const harnessLinker = path.join(directory, "combined-harness.ld");
  const elf = path.join(directory, "combined-harness.elf");
  const binary = path.join(directory, "combined-harness.bin");
  await writeFile(stubSource, `.section .text.wpm_registration_stub, "ax", @progbits
.global stage3e34_register_wpm
.type stage3e34_register_wpm, @function
stage3e34_register_wpm:
  entry a1, 32
  retw.n
`);
  await writeFile(harnessLinker, `ENTRY(f1_combined_setup_wrapper)
SECTIONS {
  . = 0x42118000;
  .combined_literal : ALIGN(4) {
    KEEP(*(.literal.f1_combined_setup))
    KEEP(*(.literal.music_id1))
  }
  .combined_text : ALIGN(4) {
    KEEP(*(.text.f1_combined_setup))
    KEEP(*(.text.music_id1))
    KEEP(*(.text.wpm_registration_stub))
  }
  /DISCARD/ : { *(.comment) *(.xtensa.info) }
}
`);
  await Promise.all([
    run(tools.as, ["--longcalls", "--text-section-literals", "-o", wrapperObject,
      path.join(moduleRoot, "combined-setup-wrapper.S.tmpl")]),
    run(tools.as, ["--longcalls", "--text-section-literals", "-o", musicObject, source]),
    run(tools.as, ["--longcalls", "--text-section-literals", "-o", stubObject, stubSource]),
  ]);
  await run(tools.ld, ["-T", harnessLinker, "-o", elf, wrapperObject, musicObject, stubObject]);
  const relocations = (await run(tools.readelf, ["-r", elf])).stdout;
  if (!/There are no relocations/u.test(relocations)) throw new Error("Combined registration harness retains relocations.");
  const symbols = (await run(tools.nm, ["-n", elf])).stdout;
  for (const symbol of ["f1_combined_setup_wrapper", "music_id1_register", "stage3e34_register_wpm"]) {
    if (!new RegExp(`\\b${symbol}$`, "mu").test(symbols)) throw new Error(`Harness is missing ${symbol}.`);
  }
  await run(tools.objcopy, ["-O", "binary", elf, binary]);
  const bytes = await readFile(binary);
  const wrapperSource = await readFile(path.join(moduleRoot, "combined-setup-wrapper.S.tmpl"), "utf8");
  const setupLiteralSourceCount = wrapperSource.match(/\.long 0x4202c108/gu)?.length ?? 0;
  if (setupLiteralSourceCount !== 1) throw new Error("Combined wrapper source must own one stock-setup literal.");
  return { bytes: bytes.length, sha256: sha256(bytes), relocations: 0, wpmRegistrationStub: true,
    setupLiteralSourceCount };
}

function auditAbi(bytes) {
  for (const forbidden of [
    0x4202c108, // stock setup must be owned by the combined wrapper
    0x4206eae0, // stock key callback
    0x4206ed14, // native WPM tick
    0x421084f4, // Timer getter
    0x3fcaba20, // native WPM float
    0x3fcab378, // obsolete Stage-3D global manager
  ]) {
    const needle = Buffer.alloc(4);
    needle.writeUInt32LE(forbidden);
    if (bytes.includes(needle)) throw new Error(`Music ABI references forbidden 0x${forbidden.toString(16)}.`);
  }
  if (bytes.length > 8192) throw new Error("Music registration ABI exceeded its 8-KiB provisional code budget.");
  const firstStringWord = Buffer.from([0x6d, 0x70, 0x2e, 0x77]);
  const lastStringWord = Buffer.from([0x72, 0x00, 0x00, 0x00]);
  const stringStart = bytes.indexOf(firstStringWord);
  const stringEndWord = bytes.indexOf(lastStringWord, stringStart + 4);
  if (stringStart < 0 || stringEndWord < stringStart) {
    throw new Error("Packed RPC word-literal region is missing.");
  }
  for (let offset = stringStart; offset <= stringEndWord; offset += 4) {
    const pointer = Buffer.alloc(4);
    pointer.writeUInt32LE(0x42118000 + offset);
    if (bytes.includes(pointer)) {
      throw new Error(`Music ABI contains an ordinary IROM pointer into RPC words at +0x${offset.toString(16)}.`);
    }
  }
}

function auditCrashContainmentSource(text) {
  const start = text.indexOf("music_id1_build:");
  const end = text.indexOf(".size music_id1_build", start);
  if (start < 0 || end < 0) throw new Error("Music build function is missing.");
  const build = text.slice(start, end);
  if (build.includes("call8   music_id1_make_panel"))
    throw new Error("Music build must contain no label-as-panel object creation.");
  const cleanupStart = text.indexOf("music_id1_cleanup:");
  const cleanupEnd = text.indexOf(".size music_id1_cleanup", cleanupStart);
  const cleanup = text.slice(cleanupStart, cleanupEnd);
  if (/\bcall(?:8|x8)\b/u.test(cleanup)) throw new Error("Music cleanup must never call a free/delete path.");
  return true;
}

function auditMediaTransportSource(text) {
  for (const token of [
    ".Lstr_mp_write_0:               .long 0x772e706d",
    ".Lstr_info_2:                   .long 0x666e695f",
    ".Lstr_art_2:                    .long 0x7472615f",
    ".Lstr_song_title_0:             .long 0x676e6f73",
    ".Lstr_duration_0:               .long 0x61746f74",
    ".Lstr_status_0:                 .long 0x74617473",
    ".Ltransport_state_bytes:        .long 87980",
    ".Lstring_table_offset:          .long 25808",
    ".Lrpc_callback_closure:         .long 0x4200465c",
    ".Ljson_integer_fn:              .long 0x42059638",
    ".Lrpc_respond_fn:               .long 0x42057d40",
  ]) {
    if (!text.includes(token)) throw new Error(`Music metadata transport lost ${token}.`);
  }
  if (/\.asciz\b/u.test(text) || /\.L(?:method|key|value)_.+_ptr:/u.test(text)) {
    throw new Error("Music transport contains an ordinary IROM string/pointer instead of fixed RAM strings.");
  }
  const registration = text.slice(text.indexOf("music_id1_register_media_rpc:"),
    text.indexOf(".size music_id1_register_media_rpc"));
  if (!(registration.indexOf("s32i    a8, a1, 24") < registration.indexOf("s32i    a8, a1, 28") &&
      registration.includes("s32i    a7, a1, 16"))) {
    throw new Error("RPC callback no longer uses stock +0 context/+8 closure/+12 thunk layout.");
  }
  if (!registration.includes("call8   .Linit_rpc_strings_entry") ||
      (registration.match(/l32r\s+a8, \.Lstring_table_offset/gu)?.length ?? 0) !== 2 ||
      !registration.includes("add     a8, a5, a8") ||
      !registration.includes("addi    a8, a8, 16")) {
    throw new Error("RPC registration no longer gives both method names fixed transport-state RAM lifetime.");
  }
  const stringInit = text.slice(text.indexOf("music_id1_init_rpc_strings:"),
    text.indexOf(".size music_id1_init_rpc_strings"));
  if ((stringInit.match(/l32r\s+a8, \.Lstr_/gu)?.length ?? 0) !== 38 ||
      !stringInit.includes("s32i    a8, a7, 148") || !stringInit.includes("memw")) {
    throw new Error("Fixed 152-byte RPC string table initialization changed.");
  }
  const outsideStringInit = text.slice(0, text.indexOf("music_id1_init_rpc_strings:")) +
    text.slice(text.indexOf(".size music_id1_init_rpc_strings"));
  if (/l32r\s+\w+, \.Lstr_/u.test(outsideStringInit)) {
    throw new Error("An RPC word literal is read outside the one fixed-RAM string-table initializer.");
  }
  const handler = text.slice(text.indexOf("music_id1_handle_info:"),
    text.indexOf(".size music_id1_handle_info"));
  if (/\.Llabel_|\.Limage_|music_id1_ui_refresh_transport/u.test(handler)) {
    throw new Error("RPC metadata handler must not call or mutate LVGL.");
  }
  const oddPublish = handler.indexOf("or      a8, a8, a9");
  const firstMetadataRead = handler.indexOf("call8   music_id1_read_string");
  const evenPublish = handler.indexOf(".Linfo_publish:");
  if (!(oddPublish >= 0 && oddPublish < firstMetadataRead && firstMetadataRead < evenPublish) ||
      !/\.Linfo_publish:[\s\S]*memw[\s\S]*l32i\s+a8, a7, 140[\s\S]*addi\s+a8, a8, 1[\s\S]*s32i\s+a8, a7, 140[\s\S]*memw/u.test(handler)) {
    throw new Error("Metadata handler lost odd-write/even-publish seqlock commit.");
  }
  if ((handler.match(/max\s+a10, a10, a8/gu)?.length ?? 0) !== 2 ||
      (handler.match(/min\s+a10, a10, a8/gu)?.length ?? 0) !== 2 ||
      !handler.includes(".Linfo_store_stopped:")) {
    throw new Error("Metadata numeric clamps/playing normalization changed.");
  }
  for (const pointer of ["addi    a11, a4, 36", "addi    a11, a4, 48",
    "addi    a11, a4, 56", "addi    a11, a4, 64", "addi    a11, a4, 80"]) {
    if (!handler.includes(pointer)) throw new Error(`Metadata JSON key is not fixed RAM: ${pointer}.`);
  }
  if (!handler.includes("mov     a13, a4")) {
    throw new Error("Metadata response does not receive the fixed RAM status string table.");
  }
  const readString = text.slice(text.indexOf("music_id1_read_string:"),
    text.indexOf(".size music_id1_read_string"));
  if (!handler.includes("entry   a1, 320") || !handler.includes("addi    a10, a1, 224") ||
      !handler.includes("movi.n  a12, 10") || !handler.includes("movi.n  a12, 6") ||
      !handler.includes("movi.n  a12, 12") ||
      (handler.match(/l32r\s+a8, \.Ljson_proxy_dtor_fn/gu)?.length ?? 0) !== 1 ||
      !readString.includes("addi    a10, a7, 56") ||
      !readString.includes("l32r    a8, .Ljson_lookup_fn") ||
      !readString.includes("l32r    a8, .Ljson_string_tuple_fn") ||
      !readString.includes("mov     a4, a11") || !readString.includes("min     a6, a6, a4") ||
      /\.Ljson_(?:proxy_ctor|variant|string)_fn/u.test(readString) ||
      readString.includes(".Ljson_proxy_dtor_fn")) {
    throw new Error("Metadata lost direct lookup/string-tuple conversion or root-only ownership.");
  }
  const ui = text.slice(text.indexOf("music_id1_ui_refresh_transport:"),
    text.indexOf(".size music_id1_ui_refresh_transport"));
  const uiWrapper = text.slice(text.indexOf("music_id1_ui_refresh:"),
    text.indexOf(".size music_id1_ui_refresh"));
  if (!/mov\s+a10, a2\s+call8\s+\.Lui_refresh_transport_entry/u.test(uiWrapper)) {
    throw new Error("Music UI wrapper lost its windowed-ABI controller forwarding.");
  }
  if (!ui.includes(".Llabel_set_text") || !ui.includes("s32i    a8, a6, 144") ||
      !ui.includes(".Limage_set_src") || !ui.includes("s32i    a8, a6, 204")) {
    throw new Error("LVGL-thread metadata generation handoff is missing.");
  }
  if (!ui.includes("entry   a1, 224") ||
      (ui.match(/l32i\s+a8, a6, 140/gu)?.length ?? 0) !== 2 ||
      !ui.includes(".Lui_transport_copy_word:") ||
      !ui.includes("addi    a11, a1, 16") || !ui.includes("addi    a11, a1, 80") ||
      !/beqz\s+a8, \.Lui_transport_art[\s\S]*movi\.n\s+a10, 1[\s\S]*bne\s+a5, a10, \.Lui_transport_art/u.test(ui)) {
    throw new Error("UI metadata handoff lost stable private snapshot or screen-rebuild replay.");
  }
  if (!/bne\s+a8, a9, \.Lui_transport_art_apply[\s\S]*beqz\s+a8, \.Lui_transport_done[\s\S]*bne\s+a5, a10, \.Lui_transport_done/u.test(ui)) {
    throw new Error("UI artwork handoff lost screen-rebuild replay.");
  }
  if (!handler.includes("addi    a11, a4, 136") ||
      !handler.includes("movi.n  a12, 12") ||
      !handler.includes("l32r    a8, .Laccent_value_offset")) {
    throw new Error("Metadata lost exact bounded accent_color #RRGGBB staging.");
  }
  if (!/addi\s+a5, a7, 64[\s\S]*addi\s+a5, a7, 88[\s\S]*s32i\s+a9, a5, 16/u.test(ui)) {
    throw new Error("Artwork UI lost distinct buffer-indexed descriptors at controller +64/+88.");
  }
  const radial = text.slice(text.indexOf("music_id1_render_background:"),
    text.indexOf(".size music_id1_render_background"));
  const progress = text.slice(text.indexOf("music_id1_render_progress:"),
    text.indexOf(".size music_id1_render_progress"));
  if (!text.includes(".Lbackground_descriptor_word_1: .long 0x01360064") ||
      !text.includes(".Lbackground_bytes:             .long 62000") ||
      !radial.includes(".Lradial_one_q16") || radial.includes("music_id1_isqrt") ||
      !radial.includes(".Lbackground_x_setup") ||
      (radial.match(/\bquou\b/gu)?.length ?? 0) !== 2 ||
      !radial.includes("bgeu    a10, a9, .Lbackground_black") ||
      !progress.includes(".Lprogress_buffer_offset") || !progress.includes("bltui   a5, 5")) {
    throw new Error("Owned 100x310 symmetric radial/progress renderer contract changed.");
  }
  const artwork = text.slice(text.indexOf("music_id1_handle_art:"),
    text.indexOf(".size music_id1_handle_art"));
  if (/\.Llabel_|\.Limage_/u.test(artwork)) {
    throw new Error("RPC artwork handler must not call or mutate LVGL.");
  }
  if (!artwork.includes("entry   a1, 320") || !artwork.includes("addi    a10, a1, 224") ||
      !artwork.includes("addi    a10, a10, 56") || !artwork.includes("addi    a11, a4, 92") ||
      !artwork.includes("movi.n  a12, 4") || !artwork.includes("movi.n  a13, 1") ||
      !artwork.includes("addi    a14, a1, 224") || !artwork.includes("l32r    a8, .Ljson_lookup_fn") ||
      !artwork.includes("l32r    a8, .Ljson_string_tuple_fn") ||
      !artwork.includes("s32i    a10, a1, 88") || !artwork.includes("s32i    a11, a1, 92") ||
      (artwork.match(/l32r\s+a8, \.Ljson_proxy_dtor_fn/gu)?.length ?? 0) !== 2) {
    throw new Error("Artwork lost direct-lookup/string-tuple sequence or root-only ownership.");
  }
  for (const gate of [
    ".Ltransport_state_bytes:        .long 87980",
    ".Lartwork_bytes:                .long 12800",
    ".Lchunk_raw_bytes:              .long 3072",
    ".Lbase64_decode_fn:             .long 0x420cd968",
    ".Lartwork_buffer_1_offset:      .long 13008",
    "bne     a10, a8, .Lart_error_size_value",
    "memw                                /* publish transaction initialization */",
    "memw                                /* acquire staged transaction size */",
    "bgeu    a9, a10, .Lart_error_order",
    "beq     a9, a8, .Lart_offset_allowed /* 3072 */",
    "beq     a9, a10, .Lart_offset_allowed /* 6144 */",
    "beq     a9, a10, .Lart_offset_allowed /* 9216 */",
    "bne     a9, a10, .Lart_error_order   /* final offset 12288 */",
    "s32i    a8, a7, 200",
    "memw                                /* publish final generation after pixels */",
    "addi    a12, a1, 96",
    "l32i    a13, a1, 88",
    "l32i    a14, a1, 92",
    "bne     a10, a11, .Lart_error_decoded_length",
    "add     a9, a9, a11",
    "memw                                /* publish decoded bytes before success ack */",
    "l32r    a8, .Lartwork_bytes         /* completion compares against total */",
  ]) {
    if (!text.includes(gate)) throw new Error(`Artwork transaction lost ${gate}.`);
  }
  for (const pointer of ["addi    a11, a4, 100", "addi    a11, a4, 108",
    "addi    a11, a4, 92", "mov     a13, a4"]) {
    if (!artwork.includes(pointer)) throw new Error(`Artwork JSON/status string is not fixed RAM: ${pointer}.`);
  }
  const reply = text.slice(text.indexOf("music_id1_reply_status:"),
    text.indexOf(".size music_id1_reply_status"));
  if (!reply.includes("addi    a4, a5, 116") || !reply.includes("addi    a5, a5, 124") ||
      !reply.includes("beq     a4, a8, .Lreply_build_error") ||
      !reply.includes("sub     a10, a5, a9") || !reply.includes("addi    a5, a10, 148") ||
      !reply.includes("add     a4, a10, a9") || !reply.includes("addi    a4, a4, 116") ||
      !reply.includes("mov     a12, a4")) {
    throw new Error("RPC status response key/value pointers are not fixed RAM.");
  }
  for (const [label, stage] of [["data_lookup", 7], ["data_type", 8], ["data_string", 9]]) {
    if (!new RegExp(`\\.Lart_error_${label}:[\\s\\S]*movi\\.n\\s+a12, ${stage}\\b`, "u").test(artwork)) {
      throw new Error(`Artwork string diagnostic ${label}/e${stage} is missing.`);
    }
  }
  if (!/\.Lart_error_decode:[\s\S]*movi\.n\s+a12, -1/u.test(artwork) ||
      !/\.Lart_error_decoded_length:[\s\S]*movi\.n\s+a12, -1/u.test(artwork)) {
    throw new Error("Post-string artwork failures must use the bounded generic RAM error.");
  }
  return true;
}

export async function buildMusicId1Candidate({ output = defaultOutput } = {}) {
  const sourceText = await readFile(source, "utf8");
  auditCrashContainmentSource(sourceText);
  auditMediaTransportSource(sourceText);
  const temporary = await mkdtemp(path.join(os.tmpdir(), "f1-music-id1-"));
  try {
    const firstDir = path.join(temporary, "first");
    const secondDir = path.join(temporary, "second");
    const harnessDir = path.join(temporary, "harness");
    await Promise.all([mkdir(firstDir), mkdir(secondDir), mkdir(harnessDir)]);
    const [first, second, stockWindows, integration, integrationHarness] = await Promise.all([
      buildOnce(firstDir), buildOnce(secondDir), auditStockWindows(),
      readFile(path.join(moduleRoot, "combined-integration.json"), "utf8").then(JSON.parse),
      buildIntegrationHarness(harnessDir),
    ]);
    if (!first.bytes.equals(second.bytes)) throw new Error("Music ABI rebuild is not deterministic.");
    auditAbi(first.bytes);
    await mkdir(output, { recursive: true });
    await writeFile(path.join(output, "music-id1-abi.bin"), first.bytes);
    await writeFile(path.join(output, "music-id1-abi.hex"), `${first.bytes.toString("hex")}\n`);
    const manifest = {
      format: "framer-f1-music-id1-offline-candidate-v1",
      status: "OFFLINE_ABI_CANDIDATE_NOT_LINKED_NOT_HARDWARE_APPROVED",
      target: "Framer F1 firmware 0.4.1",
      screenId: 1,
      behavior: {
        initialTrack: "Midnight Circuit — Static Bloom (deterministic fixture until first host update)",
        metadata: "mp.write_info host-fed title, artist, elapsed, duration, and playing state",
        durationMs: 240000,
        positionMs: 102000,
        progressPermille: 425,
        progressPixels: 34,
        logicalCanvas: { width: 100, height: 310 },
        albumArt: "64x64 RGB565, generated into controller-owned RAM",
        background: "flat painted root; rounded label-as-panel objects disabled after live teardown crash",
        progress: "text-only fixture while label-as-panel progress objects remain disabled",
      },
      memory: {
        controllerAllocationBytes: 8424,
        nativeDescriptorOffset: 208,
        nativeDescriptorBytes: 24,
        pixelOffset: 232,
        pixelBytes: 8192,
        transportStateAllocationBytes: 87980,
        transportStatePointerOffset: 56,
        metadataTextBytesEach: 64,
        producerGenerationOffset: 140,
        uiGenerationOffset: 144,
        artwork: {
          bytes: 12800, width: 80, height: 80, format: "rgb565-le",
          activeIndexOffset: 184, stagingIndexOffset: 188,
          stagedBytesOffset: 192, expectedBytesOffset: 196,
          producerGenerationOffset: 200, uiGenerationOffset: 204,
          buffers: [{ offset: 208, bytes: 12800 }, { offset: 13008, bytes: 12800 }],
        },
        rpcStringTable: { offset: 25808, bytes: 152, lifetime: "controller", source: "l32r-word-literals" },
        appendedDromBytes: 0,
        runtimeReadableDromUpperBoundExclusive: "0x3c1d0000",
      },
      code: {
        provisionalVirtualAddress: "0x42118000",
        finalAddressOwnedByCombinedLinker: true,
        bytes: first.bytes.length,
        sha256: sha256(first.bytes),
        deterministicRebuilds: 2,
        relocations: 0,
        entry: "music_id1_register",
        architecture: "ESP32-S3 elf32-xtensa-le",
        integrationHarness,
      },
      integration,
      stockWindows,
      transport: {
        implemented: true,
        metadataHandler: "mp.write_info",
        artworkHandler: "mp.write_artwork",
        nativeMediaRpcProven: "stock Framer registration/request/response ABI pinned; custom handler not live-proven",
        acknowledgement: { wire: { status: "ok" }, hostNormalizedAccepted: true },
        taskBoundary: "RPC publishes an odd/even metadata seqlock; LVGL refresh applies only a stable private snapshot",
        metadataCommit: "odd while mutating, even after memw; UI double-checks and copies 128 bytes before LVGL",
        screenRebuildReplay: "first UI tick reapplies nonzero accepted metadata and artwork generations",
        artworkContract: "strict 12800-byte ordered transaction, <=3072 raw bytes per base64 chunk",
        artworkCommit: "inactive ping-pong buffer; generation published only on exact completion",
      },
      safety: {
        hardwareAccess: false,
        appImageProduced: false,
        flashCommandProvided: false,
        callsStockSetup: false,
        setupPointerPatched: false,
        stockKeyCallbackTouched: false,
        nativeWpmTickTouched: false,
        timerGetterTouched: false,
        littleFsTouched: false,
        navigationIdAddedOnlyAfterRegistryAssociation: true,
        registrationSuccessPostcondition: "controller+20 equals expected registry after add_controller returns",
        labelAsPanelObjectsCreated: false,
        runtimeOwnedObjects: "background image, album image, and three ordinary labels",
        cleanupCallsFree: false,
        crashEvidence: {
          core: "/private/tmp/framer-combined-music-crash-coredump.bin",
          bytes: 65536,
          sha256: "d3f95812f40d0f05eee0b76dba6ac767b632d61bd6cf9441ec60856f87bd76fa",
          task: "wl_lvgl",
          panic: "multi_heap_free multi_heap_poisoning.c:279 (head != NULL)",
        },
      },
    };
    await writeFile(path.join(output, "manifest.json"), stableJson(manifest));
    return { manifest, output, bytes: first.bytes };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  buildMusicId1Candidate().then(({ manifest, output }) => console.log(stableJson({
    status: manifest.status,
    output,
    screenId: manifest.screenId,
    abi: manifest.code,
    hardwareAccess: false,
  }).trimEnd())).catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  });
}
