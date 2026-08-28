#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execute = promisify(execFile);
const directory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(directory, "../..");
const vendor = path.join(directory, "vendor/mquickjs");
const toolchain = process.env.FRAMER_XTENSA_BIN ??
  path.join(repository, ".toolchains/xtensa-esp-elf-13.2.0_20240530/bin");
const xtensa = (name) => path.join(toolchain, `xtensa-esp32s3-elf-${name}`);
const nativeCc = process.env.CC ?? "cc";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const invariant = (condition, message) => { if (!condition) throw new Error(message); };
const run = async (command, args, options = {}) => execute(command, args, {
  maxBuffer: 32 * 1024 * 1024, ...options,
});

async function verifyUpstream() {
  const manifest = JSON.parse(await readFile(path.join(directory, "UPSTREAM.json"), "utf8"));
  invariant(manifest.upstream === "https://github.com/bellard/mquickjs.git" &&
    manifest.commit === "203d5bb79789bc47b74855d9207415dab71661a0" &&
    manifest.license === "MIT", "MicroQuickJS upstream pin changed.");
  for (const [name, expected] of Object.entries(manifest.files)) {
    const actual = sha256(await readFile(path.join(vendor, name)));
    invariant(actual === expected, `Pinned MicroQuickJS file changed: ${name}.`);
  }
  invariant(manifest.files.LICENSE === manifest.licenseSha256,
    "MicroQuickJS license digest is inconsistent.");
  return manifest;
}

async function buildGenerator(buildDirectory) {
  const generator = path.join(buildDirectory, "framer-stdlib-gen");
  await run(nativeCc, ["-std=c11", "-O2", `-I${vendor}`,
    path.join(directory, "framer_stdlib_gen.c"), path.join(vendor, "mquickjs_build.c"),
    "-o", generator]);
  // mquickjs_atom.h encodes JS_ATOM_* word offsets into the ROM table, so its
  // word size must match the library it is paired with (host atoms with the
  // host library, -m32 atoms with the -m32/target library) or the interpreter
  // indexes the wrong table entries (observed live as a JS SyntaxError).
  const atoms = (await run(generator, ["-a"])).stdout;
  const targetAtoms = (await run(generator, ["-m32", "-a"])).stdout;
  const hostLibrary = (await run(generator, [])).stdout;
  const targetLibrary = (await run(generator, ["-m32"])).stdout;
  await Promise.all([
    writeFile(path.join(buildDirectory, "mquickjs_atom.h"), atoms),
    writeFile(path.join(buildDirectory, "framer_stdlib_host.h"), hostLibrary),
    writeFile(path.join(buildDirectory, "framer_stdlib_target.h"), targetLibrary),
  ]);
  invariant(!(hostLibrary.includes("js_global_eval") || hostLibrary.includes("js_load") ||
    hostLibrary.includes("js_setTimeout") || hostLibrary.includes("js_print") ||
    hostLibrary.includes("js_date_now") || hostLibrary.includes("js_math_random")),
  "Forbidden native functions entered the Framer ROM library.");
  return { generator, atoms, targetAtoms, hostLibrary, targetLibrary };
}

async function buildAndRunHost(buildDirectory, generated) {
  await writeFile(path.join(buildDirectory, "framer_stdlib.h"), generated.hostLibrary);
  const outputs = [];
  for (let pass = 0; pass < 2; pass += 1) {
    const binary = path.join(buildDirectory, `host-harness-${pass}`);
    await run(nativeCc, ["-std=c11", "-Os", "-w", `-I${buildDirectory}`,
      `-I${directory}`, `-I${vendor}`, path.join(directory, "framer_mquickjs_canary.c"),
      path.join(vendor, "dtoa.c"), path.join(vendor, "libm.c"), path.join(vendor, "cutils.c"),
      path.join(directory, "host_harness.c"), "-lm", "-o", binary]);
    outputs.push((await run(binary, [])).stdout.trim());
  }
  invariant(outputs[0] === outputs[1], "MicroQuickJS host proof is nondeterministic.");
  const result = JSON.parse(outputs[0]);
  invariant(result.status === "PASS_HOST_MQUICKJS_CANARY" && result.revision === 29 &&
    result.commits === 29 && result.resets === 7 && result.timeouts === 1 &&
    result.oom === 1 && result.wrongThread === 2 && result.heapBytes === 65536 &&
    result.keyDown === 7 && result.keyUp === 7 && result.keyHold === 3 &&
    result.chordDown === 2 && result.chordUp === 2 && result.queueOverflows === 1 &&
    result.resyncs === 2 && result.eventSequence === 37 &&
    result.maxCallbacksPerIteration === 3 && result.maxPendingEvents >= 16 &&
    result.failureCallbacks === 4 && result.failureRecoveries === 1 &&
    result.failureMaxAttemptsPerIteration === 3,
  "MicroQuickJS host recovery proof changed.");
  result.heapProfiles = { "65536": { heapHighWater: result.heapHighWater,
    minimumFree: result.minimumFree } };
  return result;
}

async function runMovingGcAsan(buildDirectory) {
  const binary = path.join(buildDirectory, "host-harness-moving-gc-asan");
  await run(nativeCc, ["-std=c11", "-O1", "-g", "-w", "-DDEBUG_GC",
    "-fsanitize=address", "-fno-omit-frame-pointer", `-I${buildDirectory}`,
    `-I${directory}`, `-I${vendor}`, path.join(directory, "framer_mquickjs_canary.c"),
    path.join(vendor, "dtoa.c"), path.join(vendor, "libm.c"), path.join(vendor, "cutils.c"),
    path.join(directory, "host_harness.c"), "-lm", "-o", binary]);
  const output = (await run(binary, [], { env: { ...process.env, ASAN_OPTIONS: "halt_on_error=1" } })).stdout;
  const result = JSON.parse(output);
  invariant(result.status === "PASS_HOST_MQUICKJS_CANARY" && result.oom === 1 &&
    result.timeouts === 1 && result.resets === 7 && result.eventSequence === 37,
  "MicroQuickJS moving-GC/ASan proof changed.");
  return "PASS";
}

const crossFlags = ["-std=c11", "-Os", "-DNDEBUG", "-mlongcalls",
  "-mtext-section-literals", "-ffunction-sections", "-fdata-sections",
  "-fno-unwind-tables", "-fno-asynchronous-unwind-tables"];

async function compileTargetUnit(buildDirectory, source, output, includes, ndebug = true) {
  const flags = ndebug ? crossFlags : crossFlags.filter((flag) => flag !== "-DNDEBUG");
  await run(xtensa("gcc"), [...flags, ...includes.map((value) => `-I${value}`),
    "-c", source, "-o", output]);
}

async function buildXtensaPass(buildDirectory, pass) {
  const prefix = path.join(buildDirectory, `xtensa-${pass}`);
  const objects = {
    runtime: `${prefix}-runtime.o`, canary: `${prefix}-canary.o`,
    dtoa: `${prefix}-dtoa.o`, libm: `${prefix}-libm.o`, cutils: `${prefix}-cutils.o`,
  };
  await compileTargetUnit(buildDirectory, path.join(directory, "framer_mquickjs_canary.c"),
    objects.runtime, [buildDirectory, directory, vendor]);
  await compileTargetUnit(buildDirectory, path.join(directory, "xtensa_link_canary.c"),
    objects.canary, [buildDirectory, directory, vendor]);
  await compileTargetUnit(buildDirectory, path.join(vendor, "dtoa.c"), objects.dtoa,
    [buildDirectory, vendor]);
  await compileTargetUnit(buildDirectory, path.join(vendor, "libm.c"), objects.libm,
    [buildDirectory, vendor], false);
  await compileTargetUnit(buildDirectory, path.join(vendor, "cutils.c"), objects.cutils,
    [buildDirectory, vendor]);
  const elf = `${prefix}.elf`;
  const map = `${prefix}.map`;
  await run(xtensa("gcc"), ["-nostartfiles", "-specs=nosys.specs", "-Wl,--gc-sections",
    "-Wl,-e,framer_mqjs_xtensa_canary_entry", `-Wl,-Map,${map}`, "-o", elf,
    objects.runtime, objects.canary, objects.dtoa, objects.libm, objects.cutils, "-lm"]);
  const raw = `${prefix}.bin`;
  await run(xtensa("objcopy"), ["-O", "binary", elf, raw]);
  return { elf, raw, map, objects };
}

async function inspectXtensa(first, second) {
  const [firstRaw, secondRaw] = await Promise.all([readFile(first.raw), readFile(second.raw)]);
  invariant(firstRaw.equals(secondRaw), "MicroQuickJS Xtensa link output is nondeterministic.");
  const [format, sections, relocations, undefinedSymbols, symbols, size, compiler] =
    await Promise.all([
      run(xtensa("objdump"), ["-f", first.elf]), run(xtensa("objdump"), ["-h", first.elf]),
      run(xtensa("readelf"), ["-r", first.elf]), run(xtensa("nm"), ["-u", first.elf]),
      run(xtensa("nm"), ["-S", first.elf]), run(xtensa("size"), [first.elf]),
      run(xtensa("gcc"), ["--version"]),
    ]);
  invariant(/file format elf32-xtensa-le/u.test(format.stdout),
    "MicroQuickJS target is not an ESP32-S3 little-endian Xtensa ELF.");
  invariant(/There are no relocations in this file\./u.test(relocations.stdout),
    "MicroQuickJS final Xtensa ELF retains relocations.");
  invariant(undefinedSymbols.stdout.trim() === "", "MicroQuickJS Xtensa ELF has undefined symbols.");
  invariant(!/\b(?:malloc|calloc|realloc|free|_sbrk|_write|_read|_kill|getpid)\b/u.test(symbols.stdout),
    "MicroQuickJS canary gained a system allocator or process-I/O dependency.");
  invariant(/\b00010000\s+[bB]\s+canary_heap$/mu.test(symbols.stdout) &&
    /\b00001000\s+[bB]\s+canary_runtime$/mu.test(symbols.stdout),
  "MicroQuickJS caller-owned 64 KiB heap/runtime symbols changed.");
  invariant(/\.text\s+[0-9a-f]{8}/u.test(sections.stdout) &&
    /\.rodata\s+[0-9a-f]{8}/u.test(sections.stdout),
  "MicroQuickJS Xtensa code or ROM table section is missing.");
  invariant(compiler.stdout.startsWith("xtensa-esp-elf-gcc (crosstool-NG esp-13.2.0_20240530) 13.2.0"),
    "MicroQuickJS Xtensa proof used an unpinned compiler.");
  const sizeMatch = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+[0-9a-f]+\s+.+$/mu.exec(size.stdout);
  invariant(sizeMatch != null, "Could not parse MicroQuickJS Xtensa size output.");
  const sectionSizes = Object.fromEntries([...sections.stdout.matchAll(
    /^\s*\d+\s+(\.[^\s]+)\s+([0-9a-f]+)\s+[0-9a-f]+\s+[0-9a-f]+\s+[0-9a-f]+\s+2\*\*\d+\s*$/gmu,
  )].map((match) => [match[1], Number.parseInt(match[2], 16)]));
  for (const name of [".text", ".rodata", ".bss"]) {
    invariant(Object.hasOwn(sectionSizes, name),
      `MicroQuickJS Xtensa ELF section is missing: ${name}.`);
  }
  const elfSections = {
    text: sectionSizes[".text"], rodata: sectionSizes[".rodata"],
    ehFrame: sectionSizes[".eh_frame"] ?? 0, data: sectionSizes[".data"] ?? 0,
    bss: sectionSizes[".bss"],
  };
  const target = {
    format: "elf32-xtensa-le",
    compiler: "xtensa-esp-elf-gcc 13.2.0_20240530",
    textBytes: Number(sizeMatch[1]), dataBytes: Number(sizeMatch[2]),
    bssBytes: Number(sizeMatch[3]), linkedBytes: Number(sizeMatch[4]),
    rawBytes: firstRaw.length, rawSha256: sha256(firstRaw),
    elfSections,
    relocations: 0, undefinedSymbols: 0, systemAllocatorSymbols: 0,
    fixedHeapBytes: 65536, runtimeStorageBytes: 4096,
  };
  // Pins re-recorded after fixing the -m32 atom/library word-size mismatch
  // (mquickjs_atom.h must be generated with -m32 for a -m32 library, or
  // JS_ATOM_* offsets no longer match the ROM table layout); this changes
  // the atom table content and therefore the freshly-built binary's bytes.
  invariant(target.textBytes === 76492 && target.dataBytes === 0 && target.bssBytes === 69704 &&
    target.linkedBytes === 146196 && target.rawBytes === 76508 &&
    target.rawSha256 === "da1a51d7e107e816b6f7b91711d8126022a44e1b954554380670dea547e32f63",
    `MicroQuickJS Xtensa footprint changed: ${JSON.stringify(target)}.`);
  invariant(JSON.stringify(target.elfSections) === JSON.stringify({
    text: 65660, rodata: 10768, ehFrame: 64, data: 0, bss: 69704,
  }), `MicroQuickJS Xtensa ELF sections changed: ${JSON.stringify(target.elfSections)}.`);
  return target;
}

const temp = await mkdtemp(path.join(os.tmpdir(), "framer-mquickjs-canary-"));
try {
  const upstream = await verifyUpstream();
  const generated = await buildGenerator(temp);
  const host = await buildAndRunHost(temp, generated);
  const movingGcAsan = await runMovingGcAsan(temp);
  await Promise.all([
    writeFile(path.join(temp, "mquickjs_atom.h"), generated.targetAtoms),
    writeFile(path.join(temp, "framer_stdlib.h"), generated.targetLibrary),
  ]);
  const first = await buildXtensaPass(temp, 0);
  const second = await buildXtensaPass(temp, 1);
  const target = await inspectXtensa(first, second);
  const canarySources = ["framer_stdlib_gen.c", "framer_mquickjs_canary.h",
    "framer_mquickjs_canary.c", "host_harness.c", "xtensa_link_canary.c"];
  const sourceDigest = createHash("sha256");
  for (const name of canarySources) sourceDigest.update(await readFile(path.join(directory, name)));
  console.log(JSON.stringify({
    status: "PASS_MQUICKJS_HOST_AND_XTENSA_STATIC_CANARY",
    upstream: { url: upstream.upstream, commit: upstream.commit, license: upstream.license,
      vendoredFiles: Object.keys(upstream.files).length },
    host: { ...host, movingGcAsan },
    target,
    contracts: { fixedCallerHeap: true,
      packageAbiSha256: "d536c61f83bfb862601af4ea659e32dcc0014ae98e6715b62ff32aae777d6940",
      namedEvents: ["tick.1ms", "tick.100ms", "tick.1s", "input.fn-bottom-knob", "host.rpc:<id>",
        "input.key.down", "input.key.up", "input.key.hold",
        "input.chord.down", "input.chord.up"],
      nativeApi: ["widget.on", "widget.getInt", "widget.setInt", "widget.commit",
        "widget.isHeld"],
      callerAdmissionGate: true, exactStrictSourcePrefix: "\"use strict\";\\n",
      cooperativeDeadline: true, resetAfterError: true,
      atomicLastGoodState: true, ownerThreadTokenGate: true,
      atomicMailboxPublication: true, telemetry: true,
      input: { maxKeys: 16, maxChords: 8, maxChordKeys: 4,
        queueRecords: 32, drainRecords: 4, drainHolds: 2,
        pendingEvents: 64, maxLogicalEventsPerBatch: 62,
        maxEventAttemptsPerOwnerCall: 3, maxJsCallbacksPerOwnerCall: 3,
        maxFailedCallbacksPerOwnerCall: 1, maxRecoveriesPerOwnerCall: 1,
        stopOnFirstCallbackFailure: true,
        theoreticalSuccessfulCallbackSliceUs: 6000,
        theoreticalWorstFailureRecoverySliceUs: 8000,
        theoreticalOwnerCallJsSliceUs: 8000,
        yieldOnMorePendingRequired: true,
        maxResyncEvents: 18,
        fixedSpscQueue: true, authoritativeHeldBitmap: true,
        exactChordMasks: true, syntheticRelease: true,
        wrapSafeMonotonicTime: true, opaqueNativeTokenObservation: true,
        noJsInProducerCallback: true, stockFirstExternalHookRequired: true,
        stockFirstHookAdapterProven: false, physicalKeyIdentityProven: false } },
    canarySourceSha256: sourceDigest.digest("hex"),
    hardwareRuntimeProven: false, flashed: false,
  }, null, 2));
} finally {
  await rm(temp, { recursive: true, force: true });
}
