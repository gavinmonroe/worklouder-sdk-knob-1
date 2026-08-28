import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { encodeRasterAnimation } from "../src/render/raster-animation.mjs";
import { encodeWidgetBundle } from "../src/render/widget-bundle.mjs";
import { missingToolchain } from "../test-support/pinned-inputs.mjs";

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sourceRoot = path.join(root, "f1-widget-sdk/examples/renderer-id26/on-device");
const toolRoot = path.join(root, ".toolchains/xtensa-esp-elf-13.2.0_20240530/bin");
const tool = (name) => path.join(toolRoot, `xtensa-esp32s3-elf-${name}`);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
let temporary;
let host;
let bundle;
let bundlePath;
let chunkHashes;
let focusPackage;
let focusPackagePath;
let focusChunkHashes;

before(async () => {
  temporary = await mkdtemp(path.join(os.tmpdir(), "renderer-scene-rpc-"));
  host = path.join(temporary, "renderer-scene-rpc-host");
  await run("cc", ["-O2", "-std=c11", "-Wall", "-Wextra", "-Werror", "-DRENDERER_V1_HOST_TEST",
    "-o", host, path.join(sourceRoot, "renderer-v1-scene-rpc-host.c"),
    path.join(root, "custom-firmware/experimental/renderer-v1-id26.c")]);
  const first = new Uint16Array(31_000).fill(0x1357);
  const second = new Uint16Array(first); second.fill(0x2468, 4_000, 4_300);
  const animation = encodeRasterAnimation({ frames: [first, second], width: 100, height: 310,
    fps: 10, loopDurationMs: 200, maxBytes: 128 * 1024 });
  bundle = encodeWidgetBundle({ generation: 1, slots: [
    { name: "host-native", kind: "raster", animationBinary: animation.binary },
  ] }).binary;
  bundlePath = path.join(temporary, "scene.f1wb");
  await writeFile(bundlePath, bundle);
  chunkHashes = Array.from({ length: Math.ceil(bundle.length / 3072) }, (_, index) =>
    sha256(bundle.subarray(index * 3072, Math.min(bundle.length, (index + 1) * 3072))));
  focusPackage = await readFile(path.join(root,
    "f1-widget-sdk/examples/render-v2-focus-timer/build/render-v2-focus-plus-timer.store-fit.bin"));
  assert.equal(focusPackage.length, 95_535);
  assert.equal(sha256(focusPackage),
    "c7a49c9f7a4f709692299cff9239b9f5e0d9cc0c946efc948d3c54b54b1f5102");
  focusPackagePath = path.join(temporary, "focus.package");
  await writeFile(focusPackagePath, focusPackage);
  focusChunkHashes = Array.from({ length: Math.ceil(focusPackage.length / 3072) }, (_, index) =>
    sha256(focusPackage.subarray(index * 3072,
      Math.min(focusPackage.length, (index + 1) * 3072))));
});
after(async () => rm(temporary, { recursive: true, force: true }));

async function invoke(mode) {
  return run(host, [mode, bundlePath, sha256(bundle), ...chunkHashes]);
}
async function invokeFocus(mode) {
  return run(host, [mode, focusPackagePath, sha256(focusPackage), ...focusChunkHashes]);
}

test("native transaction core publishes header last and permits a later generation", async () => {
  const [decoded, base64] = await Promise.all([invoke("success"), invoke("success-b64")]);
  assert.match(decoded.stdout, /commit=1 second=1 abort=1 flags=0 generation=1 stage=1/u);
  assert.match(base64.stdout, /commit=1 second=1 abort=1 flags=0 generation=1 stage=1/u);
});

test("native transaction core fails closed on reorder, torn commit, chunk SHA, and supports abort", async () => {
  const results = await Promise.all(["reorder", "torn", "corrupt", "abort"].map(async (mode) =>
    (await invoke(mode)).stdout.trim()));
  assert.deepEqual(results, ["reorder=-5 flags=0", "torn=-7 flags=0", "corrupt=-6 flags=0",
    "abort=1 flags=0 generation=0"]);
});

test("native transaction core atomically pairs F1WB+focus/timer F2EP and latches the store", async () => {
  const success = await invokeFocus("focus-success");
  assert.match(success.stdout,
    /focus_result=1 second=-1 flags=2 generation=1 stage=1 prepare=1 commit=1 cancel=0/u);
});

test("focus handoff cancels before publication on stage failure and retains storage after commit ambiguity", async () => {
  const [stage, prepare, commit] = await Promise.all([
    invokeFocus("focus-stage-fail"), invokeFocus("focus-prepare-fail"),
    invokeFocus("focus-commit-fail"),
  ]);
  assert.match(stage.stdout,
    /focus_result=-9 second=-3 flags=0 generation=0 stage=1 prepare=1 commit=0 cancel=1/u);
  assert.match(prepare.stdout,
    /focus_result=-10 second=-3 flags=0 generation=0 stage=0 prepare=1 commit=0 cancel=0/u);
  assert.match(commit.stdout,
    /focus_result=-10 second=-1 flags=2 generation=1 stage=1 prepare=1 commit=1 cancel=0/u);
});

test("Framer callback bridge exposes six RAM-built methods and the stock callback ABI", async () => {
  const source = await readFile(path.join(sourceRoot, "renderer-v1-scene-rpc.S"), "utf8");
  for (const method of ["capabilities", "begin", "write", "commit", "abort", "status"])
    assert.match(source, new RegExp(`renderer_scene_rpc_${method}_callback`, "u"));
  assert.match(source, /s32i\s+a3,a1,16[\s\S]*s32i\s+a8,a1,24[\s\S]*s32i\s+a6,a1,28/u);
  assert.match(source, /\.Lscene_callback_closure:\s+\.long 0x4200465c/u);
  assert.match(source, /\.Lscene_callback_destroy:\s+\.long 0x42106ae4/u);
  assert.match(source, /\.Lscene_store_bytes:\s+\.long 98304/u);
  assert.doesNotMatch(source, /\.asciz|\.string/u);
  assert.match(source, /addi\s+a11,\\keys,\(\\keyoff \+ 16\)/u,
    "request parsers must address the initialized SP+16 key table");
  assert.match(source, /SCENE_PARSE_STRING a4,a1,120,11,216,228,[^\n]+[\s\S]*?SCENE_PARSE_STRING a4,a1,132,4,220,224,/u,
    "write bridge must preserve the exact chunkSha/data pointer record layout");
  for (const name of ["begin", "write", "commit"]) {
    const handler = source.slice(source.indexOf(`renderer_scene_rpc_handle_${name}:`),
      source.indexOf(`.size renderer_scene_rpc_handle_${name}`));
    assert.match(handler, /entry\s+a1,384/u, `${name} must stay within the live-proven wl_rpc frame`);
    assert.match(handler, /addi\s+a4,a1,288/u, `${name} must pin its request root at SP+288`);
    assert.doesNotMatch(handler, /416|512/u, `${name} reintroduced the timeout-prone oversized layout`);
  }
  const words = new Map(Array.from(source.matchAll(/^(\.Lw_[A-Za-z0-9_]+):\s+\.long 0x([0-9a-f]+)/gmu),
    (match) => [match[1], Number.parseInt(match[2], 16)]));
  const init = source.slice(source.indexOf("renderer_scene_rpc_init_strings:"),
    source.indexOf(".size renderer_scene_rpc_init_strings"));
  const ram = Buffer.alloc(320); let base = 0; let word = 0;
  for (const line of init.split("\n")) {
    let match = /addi\s+a7,a2,(\d+)/u.exec(line);
    if (match) base = Number(match[1]);
    match = /l32r\s+a8,(\.Lw_[A-Za-z0-9_]+)/u.exec(line);
    if (match) word = words.get(match[1]);
    match = /s32i\s+a8,a7,(\d+)/u.exec(line);
    if (match && Number.isInteger(word)) ram.writeUInt32LE(word, base + Number(match[1]));
  }
  const cString = (offset) => ram.subarray(offset, ram.indexOf(0, offset)).toString("ascii");
  assert.deepEqual([164, 204, 228, 252, 276, 300].map(cString), [
    "widget.scene.capabilities", "widget.scene.begin", "widget.scene.write",
    "widget.scene.commit", "widget.scene.abort", "widget.scene.status",
  ]);
});

test("ESP32-S3 callback/core objects compile and final harness has zero relocations", { skip: missingToolchain() }, async () => {
  const asmObject = path.join(temporary, "rpc.o");
  const coreObject = path.join(temporary, "core.o");
  const stubSource = path.join(temporary, "stage.S");
  const stubObject = path.join(temporary, "stage.o");
  const linker = path.join(temporary, "rpc.ld");
  const elf = path.join(temporary, "rpc.elf");
  await writeFile(stubSource, `.section .text.renderer_scene_rpc,"ax",@progbits\n` +
    `.global renderer_v1_prepare_store\n.type renderer_v1_prepare_store,@function\n.balign 4\n` +
    `renderer_v1_prepare_store:\n entry a1,32\n movi.n a2,1\n retw.n\n` +
    `.global renderer_v1_stage_bundle\n.type renderer_v1_stage_bundle,@function\n.balign 4\n` +
    `renderer_v1_stage_bundle:\n entry a1,32\n movi.n a2,1\n retw.n\n` +
    `.global renderer_v2_native_prepare\n.type renderer_v2_native_prepare,@function\n.balign 4\n` +
    `renderer_v2_native_prepare:\n entry a1,32\n movi.n a2,1\n retw.n\n` +
    `.global renderer_v2_native_commit\n.type renderer_v2_native_commit,@function\n.balign 4\n` +
    `renderer_v2_native_commit:\n entry a1,32\n movi.n a2,1\n retw.n\n` +
    `.global renderer_v2_native_cancel\n.type renderer_v2_native_cancel,@function\n.balign 4\n` +
    `renderer_v2_native_cancel:\n entry a1,32\n movi.n a2,1\n retw.n\n`);
  await writeFile(linker, `ENTRY(renderer_scene_rpc_register)\nSECTIONS {\n . = 0x4211b000;\n` +
    ` .rpc_literal : ALIGN(4) { *(.literal.renderer_scene_rpc) *(.literal) *(.literal.*) }\n` +
    ` .rpc_text : ALIGN(4) { *(.text.renderer_scene_rpc) *(.text) *(.text.*) }\n` +
    ` /DISCARD/ : { *(.comment) *(.xtensa.info) *(.xt.lit) *(.xt.prop) *(.eh_frame*) }\n}\n`);
  await Promise.all([
    run(tool("as"), ["--longcalls", "--text-section-literals", "-o", asmObject,
      path.join(sourceRoot, "renderer-v1-scene-rpc.S")]),
    run(tool("as"), ["--longcalls", "--text-section-literals", "-o", stubObject, stubSource]),
    run(tool("gcc"), ["-c", "-Os", "-mlongcalls", "-std=c11", "-ffreestanding", "-fno-builtin",
      "-fno-jump-tables", "-fno-tree-switch-conversion", "-fdata-sections", "-ffunction-sections",
      "-fno-unwind-tables", "-fno-asynchronous-unwind-tables", "-Wall", "-Wextra", "-Werror",
      "-o", coreObject, path.join(sourceRoot, "renderer-v1-scene-rpc-core.c")]),
  ]);
  const libgcc = (await run(tool("gcc"), ["-print-libgcc-file-name"])).stdout.trim();
  await run(tool("ld"), ["-T", linker, "-o", elf, asmObject, coreObject, stubObject, libgcc]);
  assert.match((await run(tool("objdump"), ["-f", elf])).stdout, /file format elf32-xtensa-le/u);
  assert.match((await run(tool("readelf"), ["-r", elf])).stdout, /There are no relocations in this file\./u);
  const symbols = (await run(tool("nm"), ["-g", elf])).stdout;
  for (const name of ["renderer_scene_rpc_register", "renderer_scene_rpc_core_begin",
    "renderer_scene_rpc_core_write", "renderer_scene_rpc_core_commit", "renderer_scene_rpc_core_abort",
    "renderer_scene_rpc_core_write_base64_args",
    "renderer_v1_prepare_store",
    "renderer_v1_stage_bundle", "renderer_v2_native_prepare", "renderer_v2_native_commit",
    "renderer_v2_native_cancel"])
    assert.match(symbols, new RegExp(`\\b${name}$`, "mu"));
});
