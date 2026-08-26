#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { inspectEsp32AppImage } from "../../custom-firmware/lib/esp-app-image.mjs";
import { encodeRasterAnimation } from "../../f1-widget-sdk/src/render/raster-animation.mjs";
import { encodeWidgetBundle } from "../../f1-widget-sdk/src/render/widget-bundle.mjs";
import {
  buildRenderV2MQuickJsPackage,
  decodeRenderV2MQuickJsPackage,
  RENDER_V2_MQUICKJS_PACKAGE_ABI_SHA256,
  RENDER_V2_MQUICKJS_PROFILE,
} from "../../f1-widget-sdk/src/render-v2/index.mjs";

const execute = promisify(execFile);
const directory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(directory, "../..");
const outputDirectory = path.join(directory, "build");
const canaryDirectory = path.join(repository, "experiments/mquickjs-esp32s3-canary");
const toolchain = process.env.FRAMER_XTENSA_BIN ?? path.join(repository,
  ".toolchains/xtensa-esp-elf-13.2.0_20240530/bin");
const xtensa = (name) => path.join(toolchain, `xtensa-esp32s3-elf-${name}`);
const nativeCc = process.env.CC ?? "cc";
const run = async (command, args, options = {}) => execute(command, args, {
  maxBuffer: 64 * 1024 * 1024, ...options,
});
const invariant = (value, message) => { if (!value) throw new Error(message); };
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const expectedPackageAbi =
  "5091736403d809078cbbf12a1b593fbabaff53474a0935a7e00ce81dc8bd67f8";
const expectedHealthyApp =
  "363170139a06f306be1e894b6f203a9bf03bf4d70d21194aaccdd1c42f760c32";
const healthyAppPath = path.join(repository,
  "f1-widget-sdk/build/combined-renderer-v2-clock-blue-timer/" +
  "framer-0.4.1-music-id1-wpm-id7-renderer-id26-clock-id27-blue-timer-app.bin");

const SOURCE = `var presses = 0;
widget.on("input.key.down", function (event) {
  if (widget.isHeld(event, 0)) {
    presses = presses + 1;
    widget.setInt(0, presses);
    widget.commit();
  }
});
widget.on("input.fn-bottom-knob", function (event) {
  widget.setInt(1, event.delta);
  widget.commit();
});
widget.on("host.rpc:4660", function (event) {
  widget.setInt(2, event.value);
  widget.commit();
});`;

function packageOptions(overrides = {}) {
  return {
    source: SOURCE,
    generation: 7,
    events: {
      "tick.100ms": true,
      "input.fn-bottom-knob": true,
      hostRpcIds: [0x1234, 0xb201],
      keys: [{ id: 0, nativeToken: 0x10203040 },
        { id: 1, nativeToken: 0xaabbccdd }],
      chords: [{ id: 0, heldMask: 3 }],
    },
    targets: [{ id: "counter", writes: ["textContent", "color", "hidden"] }],
    input: { debounceMs: 8, holdDelayMs: 450, holdCadenceMs: 75 },
    ...overrides,
  };
}

function rasterBase() {
  const frame = new Uint16Array(31_000);
  frame.fill(0x1234);
  const animation = encodeRasterAnimation({ frames: [frame], width: 100, height: 310,
    fps: 1, loopDurationMs: 1_000, maxBytes: 128 * 1024 });
  return encodeWidgetBundle({ generation: 7, activeSlot: 0,
    slots: [{ name: "mqjs", kind: "raster", animationBinary: animation.binary }] }).binary;
}

function sdkAdmits(binary) {
  try { decodeRenderV2MQuickJsPackage(binary); return true; } catch { return false; }
}

function resealBody(binary) {
  createHash("sha256").update(binary.subarray(128)).digest().copy(binary, 96);
  return binary;
}

function readU24(binary, offset) {
  return binary[offset] | (binary[offset + 1] << 8) | (binary[offset + 2] << 16);
}

function buildParityCases(plain, rich) {
  const cases = [{ binary: Buffer.from(plain), expected: true },
    { binary: Buffer.from(rich), expected: true }];
  for (let offset = 0; offset < plain.length; offset++) {
    const mutated = Buffer.from(plain);
    mutated[offset] ^= 0x80;
    cases.push({ binary: mutated, expected: sdkAdmits(mutated) });
  }
  let random = 0x6d2b79f5;
  for (let index = 0; index < 512; index++) {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    const offset = random % rich.length;
    const mutated = Buffer.from(rich);
    mutated[offset] ^= 1 << (index & 7);
    cases.push({ binary: mutated, expected: sdkAdmits(mutated) });
  }

  const targetAt = readU24(rich, 46);
  const sourceAt = readU24(rich, 52);
  const sourceLength = readU24(rich, 55) - 1;
  const assetAt = readU24(rich, 58);
  const targeted = [
    (value) => { value[targetAt + 8] |= 0x80; resealBody(value); },
    (value) => { value[assetAt] |= 0x80; resealBody(value); },
    (value) => { value[assetAt + 104 + 4] = 1; resealBody(value); },
    (value) => {
      value[sourceAt] = 0x27;
      createHash("sha256").update(value.subarray(sourceAt, sourceAt + sourceLength))
        .digest().copy(value, 64);
      resealBody(value);
    },
    (value) => { value[128 + 1] = 1; resealBody(value); },
    (value) => { value[32] = 0; value[33] = 0; },
    (value) => { value[8] -= 1; },
  ];
  for (const mutate of targeted) {
    const mutated = Buffer.from(rich);
    mutate(mutated);
    cases.push({ binary: mutated, expected: sdkAdmits(mutated) });
  }
  return cases;
}

function encodeCorpus(cases) {
  const header = Buffer.alloc(8);
  header.write("F2PC", 0, "ascii");
  header.writeUInt32LE(cases.length, 4);
  const records = cases.map(({ binary, expected }) => {
    const record = Buffer.alloc(8 + binary.length);
    record.writeUInt32LE(binary.length, 0);
    record[4] = expected ? 1 : 0;
    binary.copy(record, 8);
    return record;
  });
  return Buffer.concat([header, ...records]);
}

async function buildNativeHarness(buildDirectory) {
  const executable = path.join(buildDirectory, "resident-host-harness");
  const includes = [`-I${directory}`, `-I${canaryDirectory}`];
  const sources = [path.join(directory, "host_harness.c"),
    path.join(directory, "resident_integration.c"), path.join(directory, "f2js_admission.c")];
  await run(nativeCc, ["-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", "-pedantic",
    "-pthread", ...includes, ...sources, "-o", executable]);
  return executable;
}

async function runSanitizers(buildDirectory, args) {
  const executable = path.join(buildDirectory, "resident-host-harness-sanitized");
  const sources = [path.join(directory, "host_harness.c"),
    path.join(directory, "resident_integration.c"), path.join(directory, "f2js_admission.c")];
  try {
    await run(nativeCc, ["-std=c11", "-O1", "-g", "-fno-omit-frame-pointer",
      "-fsanitize=address,undefined", "-pthread", `-I${directory}`, `-I${canaryDirectory}`,
      ...sources, "-o", executable]);
    const result = await run(executable, args, { env: { ...process.env,
      ASAN_OPTIONS: "detect_leaks=0:abort_on_error=1",
      UBSAN_OPTIONS: "halt_on_error=1" } });
    return { status: "PASS", output: result.stdout.trim() };
  } catch (error) {
    if (/unsupported argument|unrecognized command-line option|cannot find -lasan/u.test(
      `${error.stderr ?? ""}${error.message ?? ""}`))
      return { status: "UNAVAILABLE" };
    throw error;
  }
}

async function runThreadSanitizer(buildDirectory, args) {
  const executable = path.join(buildDirectory, "resident-host-harness-tsan");
  const sources = [path.join(directory, "host_harness.c"),
    path.join(directory, "resident_integration.c"), path.join(directory, "f2js_admission.c")];
  try {
    await run(nativeCc, ["-std=c11", "-O1", "-g", "-fno-omit-frame-pointer",
      "-fsanitize=thread", "-pthread", `-I${directory}`, `-I${canaryDirectory}`,
      ...sources, "-o", executable]);
    const result = await run(executable, args, { env: { ...process.env,
      TSAN_OPTIONS: "halt_on_error=1" } });
    return { status: "PASS", output: result.stdout.trim() };
  } catch (error) {
    if (/unsupported argument|unrecognized command-line option|cannot find -ltsan/u.test(
      `${error.stderr ?? ""}${error.message ?? ""}`))
      return { status: "UNAVAILABLE" };
    throw error;
  }
}

async function crossBuild(buildDirectory, label) {
  const target = path.join(buildDirectory, label);
  await mkdir(target, { recursive: true });
  const flags = ["-std=c11", "-Os", "-ffreestanding", "-fno-builtin", "-fno-stack-protector",
    "-fno-unwind-tables", "-fno-asynchronous-unwind-tables", "-ffunction-sections",
    "-fdata-sections", "-mlongcalls", "-mtext-section-literals", `-I${directory}`,
    `-I${canaryDirectory}`];
  const objects = [];
  for (const source of ["f2js_admission.c", "resident_integration.c"]) {
    const object = path.join(target, source.replace(/\.c$/u, ".o"));
    await run(xtensa("gcc"), [...flags, "-c", path.join(directory, source), "-o", object]);
    objects.push(object);
  }
  const combined = path.join(target, "resident-integration-core.o");
  await run(xtensa("gcc"), ["-nostdlib", "-Wl,-r", ...objects, "-lgcc",
    "-o", combined]);
  const [binary, undefineds, sections] = await Promise.all([
    readFile(combined), run(xtensa("nm"), ["-u", combined]),
    run(xtensa("objdump"), ["-h", combined]),
  ]);
  invariant(undefineds.stdout.trim() === "", "Xtensa core retains undefined symbols.");
  for (const name of [".data", ".bss"]) {
    const match = sections.stdout.match(new RegExp(
      `^\\s*\\d+\\s+\\${name}\\s+([0-9a-f]+)`, "mu"));
    invariant(match == null || Number.parseInt(match[1], 16) === 0,
      `Xtensa core has writable global section ${name}.`);
  }
  return { binary, sha256: sha256(binary), bytes: binary.length,
    sections: sections.stdout };
}

async function expectPhysicalGateFailure(buildDirectory) {
  const object = path.join(buildDirectory, "must-not-exist.o");
  try {
    await run(xtensa("gcc"), ["-std=c11", "-DFRAMER_PHYSICAL_CANDIDATE=1", "-c",
      path.join(directory, "physical_stock_bridge.c"), "-o", object]);
  } catch (error) {
    const message = `${error.stderr ?? ""}${error.stdout ?? ""}`;
    invariant(message.includes("UNPROVEN_STOCK_ABI"),
      "Physical bridge failed for an unexpected reason.");
    return "PASS_FAIL_CLOSED";
  }
  throw new Error("Physical bridge compiled without proven stock ABI pins.");
}

async function inspectHealthyUiTick() {
  const app = await readFile(healthyAppPath);
  invariant(sha256(app) === expectedHealthyApp, "Healthy app SHA changed.");
  const image = inspectEsp32AppImage(app);
  const irom = image.segments[3];
  const start = 0x4211d3b0;
  const end = 0x4211d5a4;
  const bytes = irom.data.subarray(start - irom.loadAddress, end - irom.loadAddress);
  invariant(bytes.length === 500, "Existing renderer_v2_ui_tick span changed.");
  return { address: "0x4211d3b0", end: "0x4211d5a4", bytes: bytes.length,
    sha256: sha256(bytes), signature:
      "RendererV2TickResult(RendererV2Runtime*,uint16_t*,uint32_t)",
    mailboxConsumerImplemented: false };
}

async function main() {
  invariant(RENDER_V2_MQUICKJS_PACKAGE_ABI_SHA256 === expectedPackageAbi &&
    RENDER_V2_MQUICKJS_PROFILE.packageAbiSha256 === expectedPackageAbi,
  "SDK F2JS package ABI digest changed.");
  const [canaryHeader, compilerIdentity] = await Promise.all([
    readFile(path.join(canaryDirectory, "framer_mquickjs_canary.h")),
    run(xtensa("gcc"), ["--version"]),
  ]);
  invariant(canaryHeader.includes(Buffer.from(
    "#define FRAMER_MQJS_RUNTIME_STORAGE_BYTES 4096u")),
  "Resident integration requires final 4096-byte canary runtime storage.");
  invariant(canaryHeader.includes(Buffer.from(
    "#define FRAMER_MQJS_INPUT_CALLBACKS_PER_ITERATION 3u")),
  "Resident integration must consume the frozen three-attempt drain bound.");

  const temporary = await mkdtemp(path.join(os.tmpdir(), "framer-resident-integration-"));
  try {
    const plain = buildRenderV2MQuickJsPackage(packageOptions()).binary;
    const rich = buildRenderV2MQuickJsPackage(packageOptions({ rasterBase: rasterBase() })).binary;
    // A weather-v2-shaped admission: knob + host.rpc only, zero keys/chords.
    const keyless = buildRenderV2MQuickJsPackage(packageOptions({
      events: { "input.fn-bottom-knob": true, hostRpcIds: [0xb241], keys: [], chords: [] },
      input: { debounceMs: 0, holdDelayMs: 0, holdCadenceMs: 0 },
    })).binary;
    const cases = buildParityCases(plain, rich);
    const corpus = encodeCorpus(cases);
    const plainPath = path.join(temporary, "plain.f2js");
    const richPath = path.join(temporary, "rich.f2js");
    const keylessPath = path.join(temporary, "keyless.f2js");
    const corpusPath = path.join(temporary, "parity.bin");
    await Promise.all([writeFile(plainPath, plain), writeFile(richPath, rich),
      writeFile(keylessPath, keyless), writeFile(corpusPath, corpus)]);
    const harness = await buildNativeHarness(temporary);
    const harnessArgs = [corpusPath, plainPath, richPath, keylessPath];
    const host = await run(harness, harnessArgs);
    invariant(host.stdout.includes(`parity=${cases.length}`) &&
      host.stdout.includes("recovery_bound=pass") &&
      host.stdout.includes("teardown_race=pass") &&
      host.stdout.includes("event_retirement=pass") &&
      host.stdout.includes("callback_shutdown=pass") &&
      host.stdout.includes("second_boot=pass") &&
      host.stdout.includes("keyless=pass") &&
      host.stdout.includes("slot_switch=pass") &&
      host.stdout.includes("mailbox_bytes=72"), "Host harness proof is incomplete.");
    const [sanitizer, threadSanitizer] = await Promise.all([
      runSanitizers(temporary, harnessArgs),
      runThreadSanitizer(temporary, harnessArgs),
    ]);
    const [first, second, uiTick, physicalGate] = await Promise.all([
      crossBuild(temporary, "cross-a"), crossBuild(temporary, "cross-b"),
      inspectHealthyUiTick(), expectPhysicalGateFailure(temporary),
    ]);
    invariant(first.sha256 === second.sha256 && first.binary.equals(second.binary),
      "Xtensa resident core build is nondeterministic.");
    await mkdir(outputDirectory, { recursive: true });
    await Promise.all([
      writeFile(path.join(outputDirectory, "resident-integration-core.o"), first.binary),
      writeFile(path.join(outputDirectory, "plain-canary.f2js"), plain),
      writeFile(path.join(outputDirectory, "rich-canary.f2js"), rich),
      writeFile(path.join(outputDirectory, "mutation-parity.bin"), corpus),
    ]);
    const sourceFiles = await Promise.all(["f2js_admission.h", "f2js_admission.c",
      "resident_integration.h", "resident_integration.c", "host_harness.c",
      "physical_stock_bridge.c", "verify.mjs"].map(async (name) => {
      const value = await readFile(path.join(directory, name));
      return { name, bytes: value.length, sha256: sha256(value) };
    }));
    const manifest = {
      format: "framer-mquickjs-resident-integration-static-proof-v3",
      status: "PASS_HOST_XTENSA_RESIDENT_CORE_NO_GO_PHYSICAL_STOCK_BRIDGE",
      hardwareRuntimeProven: false,
      flashed: false,
      sdkPackageAbi: { version: 1, sha256: expectedPackageAbi,
        source: "f1-widget-sdk/src/render-v2/mquickjs.mjs" },
      engineAbi: { source: "experiments/mquickjs-esp32s3-canary/framer_mquickjs_canary.h",
        headerSha256: sha256(canaryHeader), runtimeStorageBytes: 4096,
        heapBytes: 65536, callbackDeadlineUs: 2000,
        callbacksPerInputDrain: 3,
        worstOwnerDrainUs: 8000,
        recoveryOwner: "engine core only; resident adapter performs no duplicate reset" },
      admission: { result: "PASS", cases: cases.length,
        corpusBytes: corpus.length, corpusSha256: sha256(corpus),
        sourceOwnership: "fixed framer_f2js_admission storage outside VM task stack",
        rasterOwnership: "validated F1WB atomically copied by platform stage callback before advertise",
        packageSha256: sha256(plain), rasterPackageSha256: sha256(rich) },
      mailbox: { result: "PASS", bytes: 72, slots: 16,
        algorithm: "single-writer odd/even seqlock with atomic u32 payload accesses",
        threadedTornReadTest: "PASS" },
      owner: { result: "PASS_HOST_ARCHITECTURE", stackBytes: 12288,
        runtimeBytes: 4096, heapBytes: 65536, heapPlacement: "PSRAM",
        admissionPlacement: "fixed owner storage, never automatic VM-task storage",
        fairness: "alternating native drain and admitted ordinary event",
        inputProgress: "platform timer invokes poll-due; cooperative <=20ms while held",
        eventIngress: "declared builtins plus typed declared host RPC only; every wrapper supplies its captured generation",
        ingressBarrier: "generation-tagged atomic admission plus generic/input inflight reference count",
        publicationGate: "serialized mailbox publish requires matching active/capability/ingress generation, ADVERTISED state, advertised bit, and non-disabled session",
        ownerRuntimeBarrier: "owner runtime inflight count blocks release/destroy while a bounded callback crosses shutdown",
        teardownOrder: "serialize publish close; advertise off; close ingress; synchronize generic tick/knob/RPC sources; synchronize stock hook; cancel generation timer; wait owner callback; owner terminal release; wait producers; bounded owner drains; destroy",
        platformHandoff: "generic source removal, stock hook removal, and timer cancellation prevent new callbacks and synchronize already-started wrappers before returning",
        secondBoot: "reject unless unbooted, heap-null, ASSEMBLING, module-only ready, zero active generation",
        faultTeardown: "parser, boot, and runtime faults can quiesce, unmap, then permit flash" },
      tests: { host: host.stdout.trim(), sanitizer, threadSanitizer,
        deterministicXtensaBuilds: 2, physicalGate },
      xtensa: { compiler: compilerIdentity.stdout.split("\n")[0],
        objectBytes: first.bytes, objectSha256: first.sha256,
        undefinedSymbols: 0, writableGlobalDataBytes: 0 },
      healthyBase: { app: healthyAppPath, appSha256: expectedHealthyApp,
        existingUiTick: uiTick },
      stockAbi: {
        source: "ESP-IDF v5.3.2",
        sourceCommit: "6920def9f050fe55df29954a2e8a41350b76b1d2",
        sourceHeaderPins: {
          espHeapCapsH: "25c0eed65df0ede58fce9ccd45efd96b8498de734d29d37a19aa2b5832a95ae7",
          freertosTaskH: "ac666bcbe4acb21c44cc820631f8c579d089698967015054c5ab42d092dddc2d",
        },
        sourceLevelContracts: {
          heapCapsMalloc: "void*(size_t,uint32_t)", heapCapsFree: "void(void*)",
          heapCapsGetFreeSize: "size_t(uint32_t)",
          heapCapsGetLargestFreeBlock: "size_t(uint32_t)",
          taskCreate: "xTaskCreateStaticPinnedToCore(TaskFunction_t,const char*,uint32_t,void*,UBaseType_t,StackType_t*,StaticTask_t*,BaseType_t)",
          taskDelete: "void(TaskHandle_t)",
          stackHighWater: "UBaseType_t(TaskHandle_t); result is words, bridge normalizes to bytes",
        },
        acceptedImagePins: {
          heapCapsMalloc: null, heapCapsFree: null, heapCapsGetFreeSize: null,
          heapCapsGetLargestFreeBlock: null, taskCreateStaticPinnedToCore: null,
          taskDelete: null, taskStackHighWater: null,
        },
        physicalCandidateReady: false,
      },
      physicalStaticVerdict: {
        verdict: "NO_GO",
        blockers: [
          "accepted-image addresses, exact function bounds, and full-byte SHA-256 pins for heap_caps allocation/free/telemetry are not independently proven",
          "accepted-image xTaskCreateStaticPinnedToCore/vTaskDelete/uxTaskGetStackHighWaterMark addresses, bounds, hashes, config gates, and StaticTask_t size are not proven",
          "accepted-image generation-bound tick/knob/host-RPC activation and synchronized retirement hooks are not independently proven",
          "the pinned existing renderer_v2_ui_tick does not consume the 72-byte mailbox; a stable consumer entry and rebuilt full-byte hash do not exist",
          "the resident core is not inserted into the accepted app and no physical PSRAM/stack/deadline/OOM/timeout/soak receipt exists",
        ],
      },
      sourceFiles,
    };
    await writeFile(path.join(outputDirectory, "resident-integration-manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`);
    process.stdout.write(`${host.stdout.trim()}\n` +
      `resident_integration_static=GO physical_candidate=NO_GO ` +
      `xtensa_sha256=${first.sha256} manifest=` +
      `${path.join(outputDirectory, "resident-integration-manifest.json")}\n`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

await main();
