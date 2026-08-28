import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildMusicId1Candidate } from "../on-device/build-candidate.mjs";
import { missingToolchain } from "../../../test-support/pinned-inputs.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("ID1 module builds twice deterministically without creating an app image", { skip: missingToolchain() }, async (context) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "f1-music-test-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const result = await buildMusicId1Candidate({ output: temporary });
  assert.equal(result.manifest.status, "OFFLINE_ABI_CANDIDATE_NOT_LINKED_NOT_HARDWARE_APPROVED");
  assert.equal(result.manifest.screenId, 1);
  assert.equal(result.manifest.code.bytes, 4420);
  assert.equal(result.manifest.code.sha256, "443b7aaca676002fc7b6577a2cd8111460f7939e5efc7ce413a0f7f5276dbf1a");
  assert.equal(result.manifest.code.integrationHarness.bytes, 4497);
  assert.equal(result.manifest.code.integrationHarness.sha256,
    "20d231ebb65653caae5d0628164441124f98d89e7e06ad1a073239e5f39999f7");
  assert.equal(result.manifest.code.deterministicRebuilds, 2);
  assert.equal(result.manifest.code.relocations, 0);
  assert.equal(result.manifest.memory.appendedDromBytes, 0);
  assert.equal(result.manifest.memory.pixelBytes, 8192);
  assert.equal(result.manifest.memory.transportStateAllocationBytes, 87980);
  assert.deepEqual(result.manifest.memory.rpcStringTable,
    { offset: 25808, bytes: 152, lifetime: "controller", source: "l32r-word-literals" });
  assert.equal(result.manifest.transport.metadataHandler, "mp.write_info");
  assert.equal(result.manifest.transport.artworkHandler, "mp.write_artwork");
  assert.equal(result.manifest.transport.acknowledgement.hostNormalizedAccepted, true);
  assert.equal(result.manifest.code.architecture, "ESP32-S3 elf32-xtensa-le");
  assert.equal(result.manifest.safety.hardwareAccess, false);
  assert.equal(result.manifest.safety.appImageProduced, false);
  assert.equal(result.manifest.safety.callsStockSetup, false);
  assert.equal(result.manifest.safety.littleFsTouched, false);
  assert.equal(result.manifest.safety.labelAsPanelObjectsCreated, false);
  assert.equal(result.manifest.safety.cleanupCallsFree, false);
  assert.equal(result.manifest.safety.crashEvidence.sha256,
    "d3f95812f40d0f05eee0b76dba6ac767b632d61bd6cf9441ec60856f87bd76fa");
  assert.deepEqual(await readFile(path.join(temporary, "music-id1-abi.bin")), result.bytes);
});

test("combined setup contract reserves ID1 and ID7 and calls stock setup exactly once", async () => {
  const contract = JSON.parse(await readFile(path.join(root, "on-device/combined-integration.json"), "utf8"));
  assert.equal(contract.topLevelSetup.callsStockSetup, 1);
  assert.equal(contract.topLevelSetup.setupPointerPatchCount, 1);
  assert.deepEqual(contract.registrations.map(({ screenId }) => screenId), [1, 7]);
  assert.deepEqual(contract.registrations.map(({ symbol }) => symbol),
    ["music_id1_register", "stage3e34_register_wpm"]);
  assert.ok(contract.registrations.every(({ callsStockSetup }) => callsStockSetup === false));
  assert.equal(contract.assetBudget.musicDromBytes, 0);
  assert.equal(contract.assetBudget.runtimeReadableDromUpperBoundExclusive, "0x3c1d0000");
  const wrapper = await readFile(path.join(root, "on-device/combined-setup-wrapper.S.tmpl"), "utf8");
  assert.equal(wrapper.match(/\.long 0x4202c108/gu)?.length, 1);
  assert.equal(wrapper.match(/call8\s+music_id1_register/gu)?.length, 1);
  assert.equal(wrapper.match(/call8\s+stage3e34_register_wpm/gu)?.length, 1);
  assert.match(wrapper, /mov\s+a4, a10\s+\/\* Preserve stock return/u);
  assert.match(wrapper, /mov\s+a2, a4\s*\n\s*retw\.n/u);
});

test("procedural album matches the deterministic 8x8 fixture palette and progress is bounded", () => {
  const pixels = [];
  for (let y = 0; y < 64; y += 1) {
    for (let x = 0; x < 64; x += 1) {
      const cellX = x >> 3;
      const cellY = y >> 3;
      const dark = cellX === 0 || cellX === 7 || cellY === 0 || cellY === 7;
      const cyan = !dark && (cellY === 2 || cellY === 5) && (cellX === 3 || cellX === 4);
      pixels.push(dark ? 0x0084 : cyan ? 0x673f : 0x2c3b);
    }
  }
  assert.equal(pixels.length * 2, 8192);
  assert.equal(pixels.filter((pixel) => pixel === 0x0084).length, 28 * 64);
  assert.equal(pixels.filter((pixel) => pixel === 0x673f).length, 4 * 64);
  assert.equal(pixels.filter((pixel) => pixel === 0x2c3b).length, 32 * 64);
  const progress = Math.max(0, Math.min(1, 102000 / 240000));
  assert.equal(progress, 0.425);
  assert.equal(Math.round(progress * 80), 34);
});

test("music ABI owns no setup wrapper, key hook, WPM tick, or Timer hook", async () => {
  const source = await readFile(path.join(root, "on-device/music-player-id1.S"), "utf8");
  assert.match(source, /\.global music_id1_register/u);
  assert.doesNotMatch(source, /\.global .*setup_wrapper/u);
  for (const address of ["0x4202c108", "0x4206eae0", "0x4206ed14", "0x421084f4", "0x3fcaba20"]) {
    assert.equal(source.includes(address), false, `forbidden runtime literal ${address}`);
  }
  assert.match(source, /\.Lstyle_radius:\s+\.long 0x420a0f38/u);
  assert.match(source, /\.Ldescriptor_word_0:\s+\.long 0x00001219/u);
  assert.match(source, /music_id1_register_media_rpc:[\s\S]*movi\.n\s+a11, 1/u);
  assert.match(source,
    /callx8\s+a8[\s\S]*l32i\s+a8, a5, 20[\s\S]*bne\s+a8, a7, \.Lregister_failed[\s\S]*call8\s+\.Lregister_media_rpc_entry/u,
  "Music navigation ID1 must be gated by add_controller's controller+20 registry postcondition");
});

test("mp.write_info uses stock RPC/JSON ABI and a generation-gated LVGL handoff", async () => {
  const source = await readFile(path.join(root, "on-device/music-player-id1.S"), "utf8");
  assert.doesNotMatch(source, /\.asciz\b/u, "stock C/JSON helpers cannot read ordinary appended-IROM strings");
  for (const literal of [".Lstr_mp_write_0", ".Lstr_info_2", ".Lstr_song_title_0",
    ".Lstr_artist_0", ".Lstr_elapsed_0", ".Lstr_duration_0", ".Lstr_playing_0"]) {
    assert.match(source, new RegExp(`^${literal.replace(".", "\\.")}:\\s+\\.long`, "mu"));
  }
  const initStart = source.indexOf("music_id1_init_rpc_strings:");
  const initEnd = source.indexOf(".size music_id1_init_rpc_strings");
  const stringInit = source.slice(initStart, initEnd);
  assert.equal(stringInit.match(/l32r\s+a8, \.Lstr_/gu)?.length, 38);
  assert.doesNotMatch(source.slice(0, initStart) + source.slice(initEnd), /l32r\s+\w+, \.Lstr_/u,
    "RPC word literals must only be consumed by the fixed-RAM initializer");
  assert.match(source, /\.Lrpc_callback_closure:\s+\.long 0x4200465c/u);
  assert.match(source, /\.Ljson_integer_fn:\s+\.long 0x42059638/u);
  assert.match(source, /\.Ljson_variant_fn:\s+\.long 0x42005590/u);
  assert.match(source, /\.Ljson_string_tuple_fn:\s+\.long 0x420046e0/u);
  assert.match(source, /s32i\s+a7, a1, 16[\s\S]*s32i\s+a8, a1, 24[\s\S]*s32i\s+a8, a1, 28/u,
    "+0 context/+8 closure/+12 dispatch callback layout");
  const handler = source.slice(source.indexOf("music_id1_handle_info:"),
    source.indexOf(".size music_id1_handle_info"));
  const readString = source.slice(source.indexOf("music_id1_read_string:"),
    source.indexOf(".size music_id1_read_string"));
  assert.doesNotMatch(handler, /\.Llabel_|\.Limage_/u);
  assert.match(handler, /entry\s+a1, 320/u);
  assert.match(handler, /addi\s+a10, a1, 224/u, "request root must use stock handler-frame offset");
  assert.match(handler,
    /addi\s+a11, a4, 36[\s\S]*movi\.n\s+a12, 10[\s\S]*addi\s+a11, a4, 48[\s\S]*movi\.n\s+a12, 6[\s\S]*addi\s+a11, a4, 136[\s\S]*movi\.n\s+a12, 12/u,
    "title, artist, and accent must use exact direct-lookup key lengths");
  assert.equal(handler.match(/l32r\s+a8, \.Ljson_proxy_dtor_fn/gu)?.length, 1,
    "metadata handler must destroy only its request root");
  assert.ok(handler.indexOf("call8   .Lreply_status_entry") <
    handler.indexOf("l32r    a8, .Ljson_proxy_dtor_fn"),
  "metadata must follow stock reply-before-request-root-destruction order");
  assert.match(readString,
    /addi\s+a10, a7, 56[\s\S]*l32r\s+a8, \.Ljson_lookup_fn[\s\S]*l32r\s+a8, \.Ljson_string_tuple_fn[\s\S]*mov\s+a4, a11[\s\S]*min\s+a6, a6, a4/u,
    "string helper must use direct lookup and stock node-to-string tuple conversion");
  assert.doesNotMatch(readString, /\.Ljson_(?:proxy_ctor|variant|string)_fn/u,
    "metadata direct extraction must not re-enter the failing proxy path");
  assert.doesNotMatch(readString, /\.Ljson_proxy_dtor_fn/u,
    "request root owns key proxies; individual proxy destruction corrupts its chain");
  assert.ok(handler.indexOf("or      a8, a8, a9") < handler.indexOf("call8   music_id1_read_string"),
    "producer must publish odd before touching shared strings");
  assert.match(handler,
    /\.Linfo_publish:[\s\S]*memw[\s\S]*l32i\s+a8, a7, 140[\s\S]*addi\s+a8, a8, 1[\s\S]*s32i\s+a8, a7, 140[\s\S]*memw/u);
  assert.equal(handler.match(/max\s+a10, a10, a8/gu)?.length, 2);
  assert.equal(handler.match(/min\s+a10, a10, a8/gu)?.length, 2);
  assert.match(handler, /beqz\s+a10, \.Linfo_store_stopped[\s\S]*movi\.n\s+a10, 1/u);
  for (const offset of [36, 48, 56, 64, 80]) {
    assert.match(handler, new RegExp(`addi\\s+a11, a4, ${offset}\\b`, "u"),
      `metadata key at table offset ${offset} must be fixed RAM`);
  }
  assert.match(handler, /mov\s+a13, a4[\s\S]*call8\s+\.Lreply_status_entry/u);
  const ui = source.slice(source.indexOf("music_id1_ui_refresh_transport:"),
    source.indexOf(".size music_id1_ui_refresh_transport"));
  assert.match(ui, /entry\s+a1, 224/u);
  assert.equal(ui.match(/l32i\s+a8, a6, 140/gu)?.length, 2,
    "UI must compare metadata generation before and after copying");
  assert.match(ui, /\.Lui_transport_copy_word:[\s\S]*l32i\.n\s+a9, a10, 0[\s\S]*s32i\.n\s+a9, a11, 0/u);
  assert.match(ui, /addi\s+a11, a1, 16[\s\S]*\.Llabel_set_text/u,
    "title label must consume the private UI snapshot");
  assert.match(ui, /addi\s+a11, a1, 80[\s\S]*\.Llabel_set_text/u,
    "artist label must consume the private UI snapshot");
  assert.match(ui, /beqz\s+a8, \.Lui_transport_art[\s\S]*movi\.n\s+a10, 1[\s\S]*bne\s+a5, a10, \.Lui_transport_art/u,
    "first UI tick must replay accepted metadata after a screen rebuild");
  assert.match(ui, /\.Llabel_set_text/u);
  assert.match(ui, /s32i\s+a8, a6, 144/u);
});

test("metadata seqlock rejects odd/torn reads and replays accepted state after rebuild", () => {
  const state = { generation: 2, uiGeneration: 2, title: "accepted" };
  const consume = ({ firstTick = false, duringCopy } = {}) => {
    const first = state.generation;
    if ((first & 1) !== 0) return null;
    if (first === state.uiGeneration && (!firstTick || first === 0)) return null;
    const snapshot = { title: state.title };
    duringCopy?.();
    const second = state.generation;
    if (first !== second || (second & 1) !== 0) return null;
    state.uiGeneration = second;
    return snapshot;
  };

  assert.deepEqual(consume({ firstTick: true }), { title: "accepted" },
    "a rebuilt screen replays the last nonzero accepted generation");
  state.generation = 3;
  assert.equal(consume(), null, "an in-progress odd producer generation is never displayed");
  state.generation = 4;
  assert.equal(consume({ duringCopy: () => { state.title = "next"; state.generation = 6; } }), null,
    "a generation change during the private copy discards the torn snapshot");
  assert.deepEqual(consume(), { title: "next" });
});

test("mp.write_artwork is strict ordered ping-pong RAM and only the UI task swaps LVGL", async () => {
  const source = await readFile(path.join(root, "on-device/music-player-id1.S"), "utf8");
  assert.doesNotMatch(source, /\.asciz\b/u);
  assert.match(source, /\.Ltransport_state_bytes:\s+\.long 87980/u);
  assert.match(source, /\.Lstring_table_offset:\s+\.long 25808/u);
  assert.match(source, /\.Lartwork_bytes:\s+\.long 12800/u);
  assert.match(source, /\.Lchunk_raw_bytes:\s+\.long 3072/u);
  assert.match(source, /\.Lbase64_decode_fn:\s+\.long 0x420cd968/u);
  assert.match(source, /\.Lartwork_buffer_1_offset:\s+\.long 13008/u);
  const handler = source.slice(source.indexOf("music_id1_handle_art:"),
    source.indexOf(".size music_id1_handle_art"));
  assert.match(handler, /entry\s+a1, 320/u);
  assert.match(handler,
    /addi\s+a10, a1, 224[\s\S]*addi\s+a10, a10, 56[\s\S]*addi\s+a11, a4, 92[\s\S]*movi\.n\s+a12, 4[\s\S]*movi\.n\s+a13, 1[\s\S]*addi\s+a14, a1, 224[\s\S]*l32r\s+a8, \.Ljson_lookup_fn/u,
    "artwork data must mirror Nomad's direct root lookup ABI");
  assert.match(handler, /l32r\s+a8, \.Ljson_string_tuple_fn[\s\S]*s32i\s+a10, a1, 88[\s\S]*s32i\s+a11, a1, 92/u,
    "artwork must convert its direct-lookup node to the exact pointer/length tuple");
  assert.equal(handler.match(/l32r\s+a8, \.Ljson_proxy_dtor_fn/gu)?.length, 2,
    "artwork success and error exits each destroy only the request root");
  assert.doesNotMatch(handler, /\.Limage_|\.Llabel_/u);
  assert.doesNotMatch(handler, /[ls]32i\s+\w+, a7, 192/u,
    "the live-volatile +192 word must not participate in transaction correctness");
  assert.match(handler,
    /s32i\s+a8, a7, 196\s+memw[^\n]*\n\.Lart_continue:\s+memw[^\n]*\n\s*l32i\s+a8, a7, 196/u,
    "transaction initialization and later RPC reads require publish/acquire fences");
  assert.match(handler,
    /beqz\s+a9, \.Lart_offset_allowed[\s\S]*beq\s+a9, a8, \.Lart_offset_allowed[^\n]*3072[\s\S]*beq\s+a9, a10, \.Lart_offset_allowed[^\n]*6144[\s\S]*beq\s+a9, a10, \.Lart_offset_allowed[^\n]*9216[\s\S]*bne\s+a9, a10, \.Lart_error_order[^\n]*12288/u,
    "only the five fixed Input wire offsets are accepted");
  assert.match(handler, /memw[\s\S]*s32i\s+a8, a7, 200\s+memw/u,
    "producer generation must publish only after complete pixels and then fence");
  assert.match(handler,
    /addi\s+a12, a1, 96[\s\S]*l32i\s+a13, a1, 88[\s\S]*l32i\s+a14, a1, 92[\s\S]*l32r\s+a8, \.Lbase64_decode_fn[\s\S]*callx8\s+a8/u,
    "artwork must use the pinned stock Framer base64 decoder with bounded output");
  assert.match(handler,
    /l32i\s+a10, a1, 96[\s\S]*l32i\s+a9, a1, 80[\s\S]*sub\s+a11, a8, a9[\s\S]*min\s+a11, a11, a8[\s\S]*bne\s+a10, a11, \.Lart_error_decoded_length[\s\S]*add\s+a9, a9, a11[^\n]*\n\s*memw[^\n]*\n\s*l32r\s+a8, \.Lartwork_bytes[\s\S]*bne\s+a9, a8, \.Lart_reply_ok_proxy/u,
    "wire offset plus exact Input chunk size alone determines final completion");
  assert.match(handler, /addi\s+a11, a4, 100/u);
  assert.match(handler, /addi\s+a11, a4, 108/u);
  assert.match(handler, /addi\s+a11, a4, 92/u);
  for (const [label, stage] of [
    ["offset", 1], ["size", 2], ["size_value", 3], ["pending", 4],
    ["transaction_size", 5], ["order", 6], ["data_lookup", 7],
    ["data_type", 8], ["data_string", 9],
  ]) {
    assert.match(handler, new RegExp(`\\.Lart_error_${label}:[\\s\\S]*movi\\.n\\s+a12, ${stage}\\b`, "u"));
    assert.match(source, new RegExp(`\\.Ldiag_e${stage}:\\s+\\.long 0x00003${stage}65`, "u"));
  }
  assert.match(handler, /\.Lart_error_decode:[\s\S]*movi\.n\s+a12, -1/u);
  assert.match(handler, /\.Lart_error_decoded_length:[\s\S]*movi\.n\s+a12, -1/u);
  const reply = source.slice(source.indexOf("music_id1_reply_status:"),
    source.indexOf(".size music_id1_reply_status"));
  assert.match(reply, /movi\.n\s+a8, -1[\s\S]*beq\s+a4, a8, \.Lreply_build_error/u,
    "post-string decode failures must use the fixed RAM generic error string");
  const ui = source.slice(source.indexOf("music_id1_ui_refresh_transport:"),
    source.indexOf(".size music_id1_ui_refresh_transport"));
  const uiWrapper = source.slice(source.indexOf("music_id1_ui_refresh:"),
    source.indexOf(".size music_id1_ui_refresh"));
  assert.match(uiWrapper, /mov\s+a10, a2\s+call8\s+\.Lui_refresh_transport_entry/u,
    "windowed ABI wrapper must forward the controller into the transport refresh helper");
  assert.match(ui, /\.Limage_set_src/u);
  assert.match(ui, /s32i\s+a8, a6, 204/u);
  assert.match(ui,
    /bne\s+a8, a9, \.Lui_transport_art_apply[\s\S]*beqz\s+a8, \.Lui_transport_done[\s\S]*bne\s+a5, a10, \.Lui_transport_done/u,
    "first UI tick must replay accepted artwork after a screen rebuild");

  const pixels = Buffer.alloc(12_800, 0x5a);
  const chunks = [];
  for (let offset = 0; offset < pixels.length; offset += 3072) {
    const bytes = pixels.subarray(offset, Math.min(pixels.length, offset + 3072));
    chunks.push({ offset, size: pixels.length, data: bytes.toString("base64"), bytes: bytes.length });
  }
  assert.deepEqual(chunks.map(({ bytes }) => bytes), [3072, 3072, 3072, 3072, 512]);
  assert.ok(chunks.every(({ data }) => data.length <= 4096));
  assert.deepEqual(Buffer.concat(chunks.map(({ data }) => Buffer.from(data, "base64"))), pixels);
});

test("live-crash containment bypasses all label-as-panel creation and cleanup never frees", async () => {
  const source = await readFile(path.join(root, "on-device/music-player-id1.S"), "utf8");
  const build = source.slice(source.indexOf("music_id1_build:"), source.indexOf(".size music_id1_build"));
  assert.doesNotMatch(build, /call8\s+music_id1_make_panel/u);
  const cleanup = source.slice(source.indexOf("music_id1_cleanup:"), source.indexOf(".size music_id1_cleanup"));
  assert.doesNotMatch(cleanup, /\bcall(?:8|x8)\b/u);
});

test("accepted album art is composited into the proven full-screen image before presentation", async () => {
  const source = await readFile(path.join(root, "on-device/music-player-id1.S"), "utf8");
  assert.match(source, /\.Lalbum_background_offset:\s+\.long 49000/u);
  const blit = source.slice(source.indexOf("music_id1_blit_active_art:"),
    source.indexOf(".size music_id1_blit_active_art"));
  assert.match(blit, /l32i\s+a8, a7, 200[\s\S]*l32i\s+a8, a7, 184/u);
  assert.match(blit, /addi\s+a6, a7, 208[\s\S]*\.Lartwork_buffer_1_offset/u);
  assert.match(blit, /l32i\.n\s+a8, a6, 0[\s\S]*s32i\.n\s+a8, a5, 0/u);
  assert.match(blit, /addi\s+a5, a5, 40[^\r\n]*background row tail/u);
  const apply = source.slice(source.indexOf("music_id1_apply_background:"),
    source.indexOf(".size music_id1_apply_background"));
  const radial = source.slice(source.indexOf("music_id1_render_background:"),
    source.indexOf(".size music_id1_render_background"));
  assert.match(radial, /\.Lbackground_x_setup:/u);
  assert.equal(radial.match(/\bquou\b/gu)?.length ?? 0, 2,
    "radial renderer must keep division out of the 31,000-pixel hot loop");
  assert.ok(radial.indexOf(".Lbackground_x_setup:") < radial.indexOf(".Lbackground_x:"));
  assert.ok(apply.indexOf("call8   music_id1_render_background") <
    apply.indexOf("call8   music_id1_blit_active_art"));
  assert.ok(apply.indexOf("call8   music_id1_blit_active_art") <
    apply.indexOf("call8   music_id1_present_background"));
});

test("fast radial fixed-point approximation preserves the accepted shape within one channel value", () => {
  const exactGain = (x, y) => {
    const qx = Math.floor(Math.abs(2 * x - 99) * 255 / 99);
    const qy = Math.floor(Math.abs(2 * y - 309) * 255 / 309);
    const q = qx * qx + qy * qy;
    if (q >= 65025) return 0;
    return Math.floor((65025 - q) ** 2 / 65025);
  };
  const fastDivide65025 = (value) => {
    const rounded = value + 32768;
    return Math.floor(rounded / 65536) + Math.floor(rounded / 8388608);
  };
  const fastGain = (x, y) => {
    const qx = Math.floor(Math.abs(2 * x - 99) * 255 / 99);
    const qy = Math.floor(Math.abs(2 * y - 309) * 255 / 309);
    const q = qx * qx + qy * qy;
    if (q >= 65025) return 0;
    return fastDivide65025((65025 - q) ** 2);
  };
  let maximumChannelError = 0;
  for (let y = 0; y < 310; y += 1) {
    for (let x = 0; x < 100; x += 1) {
      const exact = exactGain(x, y);
      const fast = fastGain(x, y);
      for (const channel of [17, 64, 128, 255]) {
        maximumChannelError = Math.max(maximumChannelError,
          Math.abs(Math.floor(channel * exact / 65025) - fastDivide65025(channel * fast)));
      }
      assert.equal(fast, fastGain(99 - x, 309 - y));
    }
  }
  assert.equal(maximumChannelError, 1);
  assert.deepEqual([[0, 0], [99, 0], [0, 309], [99, 309]].map(
    ([x, y]) => fastGain(x, y)), [0, 0, 0, 0]);
});
