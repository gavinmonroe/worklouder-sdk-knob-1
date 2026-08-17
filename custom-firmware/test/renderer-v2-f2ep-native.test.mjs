import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { encodeRasterAnimation } from "../../f1-widget-sdk/src/render/raster-animation.mjs";
import { encodeWidgetBundle } from "../../f1-widget-sdk/src/render/widget-bundle.mjs";

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const example = path.join(root, "f1-widget-sdk/examples/render-v2-focus-dial/build");
const program = path.join(example, "render-v2-focus-dial.f2ep");
const base = path.join(example, "render-v2-focus-dial.base.rgb565");
const timerExample = path.join(root, "f1-widget-sdk/examples/render-v2-focus-timer/build");
const timerProgram = path.join(timerExample, "render-v2-focus-timer.f2ep");
const timerBase = path.join(timerExample, "render-v2-focus-timer.base.rgb565");
const timerBaseLzss = path.join(timerExample, "render-v2-focus-timer.base.lzss");
const bootProgram = path.join(root, "f1-widget-sdk/examples/render-v2-events/build/render-v2-events.f2ep");
const bootBundle = path.join(root, "f1-widget-sdk/build/combined-renderer-v2-events/render-v2-base.f1wb");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
let directory;
let host;

before(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "renderer-v2-native-test-"));
  host = path.join(directory, "renderer-v2-native-host");
  await run("cc", ["-O2", "-std=c11", "-Wall", "-Wextra", "-Werror", "-o", host,
    path.join(root, "custom-firmware/experimental/renderer-v2-f2ep-native-host.c")]);
});
after(async () => { await rm(directory, { recursive: true, force: true }); });

test("native scaled-event arithmetic and coherent stock RTC snapshot gates are exact", async () => {
  assert.match((await run(host, ["scaled-event", "-"])).stdout,
    /plus=1200 minus=600 int32_wrap=pass/u);
  assert.match((await run(host, ["wall-clock", "-"])).stdout,
    /coherent=86399 invalid=last-good poll=once-per-second/u);
});

test("native F2EP VM is pixel-exact with the frozen focus-dial model for all three event paths", async () => {
  const prefix = path.join(directory, "native-frame");
  const result = await run(host, ["scenario", program, base, prefix]);
  assert.match(result.stdout,
    /seconds=7920 knob=4 generation=14 sequence=19 fn=3 rpc=1 fail_last_good=1/u);
  const manifest = JSON.parse(await readFile(path.join(example, "manifest.json"), "utf8"));
  assert.equal(manifest.compiler.hostRuntimeVsFirmwareModel, "pixel-exact");
  assert.equal(manifest.program.sha256,
    "b2eadd5884c6ee3b1546ac50c3c077d16eb384adbf1a82631551e69f93705aed");
  for (let index = 0; index < 6; index += 1) {
    const [native, golden] = await Promise.all([
      readFile(`${prefix}-${index}.rgb565`),
      readFile(path.join(example, manifest.frames[index].raw)),
    ]);
    assert.equal(native.length, 62_000);
    assert.deepEqual(native, golden, manifest.frames[index].name);
    assert.equal(sha256(native), manifest.frames[index].rgb565Sha256);
  }
  assert.deepEqual(await readFile(`${prefix}-6.rgb565`), await readFile(`${prefix}-5.rgb565`),
    "a failed base tick must preserve the last published frame");
});

test("native admission rejects 2,048 frozen-program mutations and malformed nested bounds", async () => {
  assert.equal((await run(host, ["admit", program])).stdout, "");
  assert.equal((await run(host, ["admit-boot", bootProgram])).stdout, "");
  assert.equal((await run(host, ["admit-timer", timerProgram])).stdout, "");
  const result = await run(host, ["fuzz", program]);
  assert.match(result.stdout, /mutations=2048 structural_bounds=6 frozen_digest=pass/u);
});

test("live overlay gate admits only the exact one-frame focus raster F1WB", async () => {
  const raw = await readFile(base);
  const frame = new Uint16Array(31_000);
  for (let index = 0; index < frame.length; index += 1) frame[index] = raw.readUInt16LE(index * 2);
  const raster = encodeRasterAnimation({ frames: [frame], fps: 1, loopDurationMs: 1_000 });
  assert.equal(raster.binary.length, 62_072);
  assert.equal(sha256(raster.binary),
    "4de389c225407bc3d616b0f86cfbe2cb645bda0cb989c5785addff67d72028c7");
  const bundle = encodeWidgetBundle({ generation: 1, activeSlot: 0,
    slots: [{ name: "focus-dial", kind: "raster", animationBinary: raster.binary }] }).binary;
  assert.equal(bundle.length, 62_404);
  assert.equal(sha256(bundle),
    "fa5580257a2432301acfe87434f277493e3d1a8fd8470d793b8bd9ce66850b18");
  const bundlePath = path.join(directory, "focus-dial.f1wb");
  await writeFile(bundlePath, bundle);
  assert.match((await run(host, ["focus-base", bundlePath])).stdout,
    /focus_f1wb_bytes=62404 frozen_digest=pass mutation=reject/u);
});

test("generation-paired composite handoff is two-phase, v1-safe, and permanently latched after commit", async () => {
  const raw = await readFile(base);
  const frame = new Uint16Array(31_000);
  for (let index = 0; index < frame.length; index += 1) frame[index] = raw.readUInt16LE(index * 2);
  const raster = encodeRasterAnimation({ frames: [frame], fps: 1, loopDurationMs: 1_000 });
  const bundle = encodeWidgetBundle({ generation: 2, activeSlot: 0,
    slots: [{ name: "focus-dial", kind: "raster", animationBinary: raster.binary }] }).binary;
  const composite = Buffer.concat([bundle, await readFile(program), await readFile(timerProgram),
    await readFile(timerBaseLzss)]);
  assert.equal(composite.length, 95_535);
  const compositePath = path.join(directory, "focus-dial-generation-2.composite");
  await writeFile(compositePath, composite);
  assert.match((await run(host, ["transition", bootProgram, compositePath])).stdout,
    /EMPTY-PREPARED-CANCEL-EMPTY-PREPARED-COMMITTED-ACTIVE generation_pair=pass old_on_focus=blocked error_gate=closed stale_epoch=reject null_prepare=reject store_latched_busy=pass/u);
});

test("native timer applies scaled detents immediately, clamps extremes, ticks, and pauses hidden", async () => {
  const prefix = path.join(directory, "timer-frame");
  const result = await run(host, ["timer-scenario", timerProgram, timerBase, prefix]);
  assert.match(result.stdout,
    /initial=1500 plus=1800 minus=1500 clamp_min=300 clamp_max=5700 tick=5699 hidden=pause reentry=5699 same_tick=pass/u);
  for (let index = 0; index < 7; index += 1) {
    const frame = await readFile(`${prefix}-${index}.rgb565`);
    assert.equal(frame.length, 62_000);
  }
});

test("native timer blue base LZSS consumes the exact source and rejects mutations", async () => {
  const result = await run(host, ["timer-base", timerBaseLzss, timerBase]);
  assert.match(result.stdout,
    /timer_base_raw=62000 compressed=3335 exact_consumption=pass exact_sha=pass mutation=reject/u);
});

test("native RTC overwrite is authoritative at boundary, fail-closed, latency-bounded, and re-entry fresh", async () => {
  const result = await run(host, ["wall-runtime", program, base]);
  assert.match(result.stdout,
    /initial=86399 rollover=0 invalid_last_good=1 malformed_bcd_last_good=1 queued_host_overridden=3723 latency_reject=pass reentry=7384 polls=7/u);
});

test("bootstrap overlay remains admitted only on its exact retained F1WB", async () => {
  const bytes = await readFile(bootBundle);
  assert.equal(bytes.length, 748);
  assert.equal(sha256(bytes), "5f1edc6879adcec0d25d5e6c999bfc80e19089aa05a72fbd14f3f5acd8899f2e");
  assert.match((await run(host, ["boot-base", bootBundle])).stdout,
    /boot_f1wb_bytes=748 frozen_digest=pass mutation=reject/u);
});

test("fixed queue, Fn consume/fallback arbitration, lock-busy overlay, and RPC 0xB201 are bounded", async () => {
  const result = await run(host, ["contracts", program, base]);
  assert.match(result.stdout,
    /queue_capacity=8 ninth_fn=consumed_not_enqueued fallback=pass lock_busy=last_good rpc_b201=pass u32_divisor=pass/u);
});

test("ESP32-S3 native VM is deterministic little-endian, relocation-free, and allocator-free", async () => {
  const result = await run(process.execPath,
    [path.join(root, "custom-firmware/tools/verify-renderer-v2-f2ep-native.mjs")]);
  const report = JSON.parse(result.stdout);
  assert.deepEqual({ status: report.status, format: report.format, relocations: report.relocations,
    undefinedSymbols: report.undefinedSymbols, ordinaryIromDataBytes: report.ordinaryIromDataBytes,
    staticRamBytes: report.staticRamBytes, sidecarAllocationBytes: report.sidecarAllocationBytes,
    binaryBytes: report.binaryBytes, sha256: report.sha256 }, {
    status: "PASS_STATIC_NATIVE_F2EP", format: "elf32-xtensa-le", relocations: 0,
    undefinedSymbols: 0, ordinaryIromDataBytes: 0, staticRamBytes: 0,
    sidecarAllocationBytes: 1_300, binaryBytes: 9_430,
    sha256: "050d10067cb0592b00561a65d9fcf057b05843b3b0954873c8d55560a8e9ddfa",
  });
});
