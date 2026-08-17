#!/usr/bin/env node
/* Offline proofs for the restyled ID28 asset set.  No hardware, no serial.
 *
 *  1. freestanding target_facade.c (the exact on-device translation unit) admits
 *     the new F2TF and produces frames pixel-identical to the JS host oracle;
 *  2. the Xtensa cross build of that same translation unit still has no
 *     writable globals and no undefined symbols;
 *  3. the exact pinned physical JS source still runs on the pinned MicroQuickJS
 *     host harness (normal and moving-GC/ASan).
 */

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execute = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(here, "../..");
const assets = path.resolve(process.env.FRAMER_WEATHER2_OUTPUT ?? path.join(here, "build"));
const facadeDir = path.join(repository, "experiments/mquickjs-target-facade");
const canary = path.join(repository, "experiments/mquickjs-esp32s3-canary");
const vendor = path.join(canary, "vendor/mquickjs");
const runtimeProof = path.join(repository, "experiments/mquickjs-esp32s3-runtime-proof");
const physical = path.join(repository, "experiments/mquickjs-esp32s3-physical-canary");
const toolchain = process.env.FRAMER_XTENSA_BIN ?? path.join(repository,
  ".toolchains/xtensa-esp-elf-13.2.0_20240530/bin");
const xtensa = (name) => path.join(toolchain, `xtensa-esp32s3-elf-${name}`);
const cc = process.env.CC ?? "cc";
const run = (command, args, options = {}) => execute(command, args,
  { maxBuffer: 64 * 1024 * 1024, ...options });
const invariant = (ok, message) => { if (!ok) throw new Error(message); };

function sectionBytes(text, prefix) {
  return [...text.matchAll(/^\s*\d+\s+(\.[^\s]+)\s+([0-9a-f]+)/gmu)]
    .filter((match) => match[1] === prefix || match[1].startsWith(`${prefix}.`))
    .reduce((sum, match) => sum + Number.parseInt(match[2], 16), 0);
}

const temporary = await mkdtemp(path.join(os.tmpdir(), "weather2-facade-"));
try {
  const manifest = JSON.parse(await readFile(path.join(assets, "manifest.json"), "utf8"));

  /* 1. host oracle vs freestanding C -------------------------------------- */
  const native = path.join(temporary, "weather2-harness");
  await run(cc, ["-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", "-pedantic",
    `-I${facadeDir}`, path.join(facadeDir, "target_facade.c"), path.join(here, "harness.c"),
    "-o", native]);
  const cFramesPath = path.join(temporary, "c-frames.bin");
  const nativeOutput = JSON.parse((await run(native, [
    path.join(assets, "weather-id28-gen19.f2tf"),
    path.join(assets, "weather-id28-base.rgb565le"),
    path.join(assets, "weather2-cases.bin"), cFramesPath,
    manifest.facade.f2jsSha256, manifest.facade.contractSha256,
    String(manifest.generation)])).stdout);
  const [cFrames, hostFrames] = await Promise.all([
    readFile(cFramesPath), readFile(path.join(assets, "weather2-host-frames.bin"))]);
  invariant(cFrames.equals(hostFrames),
    "Freestanding C and JS host oracle RGB565 frames differ for the restyled facade.");
  invariant(nativeOutput.results.every(({ result }) => result === 0),
    `C render results are not all ok: ${JSON.stringify(nativeOutput.results)}.`);
  invariant(nativeOutput.results.map(({ writes }) => writes).join() ===
    manifest.render.map(({ overlayWrites }) => overlayWrites).join(),
  "Overlay write counts differ between C and the host oracle.");

  /* 2. Xtensa cross build of the exact on-device translation unit ---------- */
  const cross = path.join(temporary, "target_facade.o");
  await run(xtensa("gcc"), ["-std=c11", "-Os", "-ffreestanding", "-fno-builtin",
    "-fno-stack-protector", "-fno-unwind-tables", "-fno-asynchronous-unwind-tables",
    "-ffunction-sections", "-fdata-sections", "-mlongcalls", "-mtext-section-literals",
    "-fstack-usage", "-c", path.join(facadeDir, "target_facade.c"), "-o", cross]);
  const linked = path.join(temporary, "target-facade-core.o");
  await run(xtensa("gcc"), ["-nostdlib", "-Wl,-r", cross, "-lgcc", "-o", linked]);
  const [undefineds, sections] = await Promise.all([
    run(xtensa("nm"), ["-u", linked]), run(xtensa("objdump"), ["-h", linked])]);
  invariant(undefineds.stdout.trim() === "", "Target facade retains undefined Xtensa symbols.");
  const writableBytes = sectionBytes(sections.stdout, ".data") +
    sectionBytes(sections.stdout, ".bss");
  invariant(writableBytes === 0, "Target facade gained writable globals.");

  /* 3. exact pinned source on the pinned MicroQuickJS host ----------------- */
  const generatorExecutable = path.join(temporary, "framer-stdlib-gen");
  await run(cc, ["-std=c11", "-O2", `-I${vendor}`, path.join(canary, "framer_stdlib_gen.c"),
    path.join(vendor, "mquickjs_build.c"), "-o", generatorExecutable]);
  const [atoms, library] = await Promise.all([
    run(generatorExecutable, ["-a"]), run(generatorExecutable, [])]);
  await Promise.all([
    writeFile(path.join(temporary, "mquickjs_atom.h"), atoms.stdout),
    writeFile(path.join(temporary, "framer_stdlib.h"), library.stdout)]);
  const common = ["-std=c11", "-w", "-DFRAMER_RUNTIME_PROOF_EXACT_ABI_ACK=0x36317013u",
    `-I${temporary}`, `-I${canary}`, `-I${vendor}`,
    path.join(canary, "framer_mquickjs_canary.c"), path.join(vendor, "dtoa.c"),
    path.join(vendor, "libm.c"), path.join(vendor, "cutils.c"),
    path.join(runtimeProof, "runtime_proof.c"),
    path.join(physical, "physical_host_harness.c"), "-lm"];
  const sourcePath = path.join(assets, "weather-id28-gen19.js");
  const normal = path.join(temporary, "physical-host");
  await run(cc, ["-O2", ...common, "-o", normal]);
  const normalResult = JSON.parse((await run(normal, [sourcePath])).stdout);
  invariant(normalResult.status === "PASS_EXACT_PHYSICAL_SOURCE" &&
    normalResult.timeouts === 1 && normalResult.oom === 1 && normalResult.keyDown >= 2 &&
    normalResult.keyUp >= 2 && normalResult.keyHold >= 1 && normalResult.chordDown >= 1 &&
    normalResult.chordUp >= 1, `Exact-source host proof changed: ${JSON.stringify(normalResult)}.`);
  const moving = path.join(temporary, "physical-host-moving-asan");
  await run(cc, ["-O1", "-g", "-DDEBUG_GC", "-fsanitize=address", "-fno-omit-frame-pointer",
    ...common, "-o", moving]);
  const movingResult = JSON.parse((await run(moving, [sourcePath],
    { env: { ...process.env, ASAN_OPTIONS: "halt_on_error=1" } })).stdout);
  invariant(movingResult.status === "PASS_EXACT_PHYSICAL_SOURCE" &&
    movingResult.timeouts === 1 && movingResult.oom === 1,
  `Exact-source moving-GC/ASan proof changed: ${JSON.stringify(movingResult)}.`);

  process.stdout.write(`${JSON.stringify({
    status: "PASS_WEATHER2_OFFLINE_PROOFS_NO_HARDWARE",
    facade: { assetBytes: nativeOutput.assetBytes, hostVsC: "PIXEL_EXACT",
      cases: nativeOutput.results, torn: nativeOutput.torn,
      malformed: nativeOutput.malformed, generation: nativeOutput.generation,
      overflow: nativeOutput.overflow },
    xtensa: { undefinedSymbols: 0, writableGlobalBytes: writableBytes,
      textBytes: sectionBytes(sections.stdout, ".text"),
      rodataBytes: sectionBytes(sections.stdout, ".rodata") },
    exactSourceHost: { normal: normalResult.status, movingGcAsan: movingResult.status,
      publishes: normalResult.publishes ?? null,
      heapHighWater: normalResult.heapHighWater ?? null },
  }, null, 2)}\n`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
