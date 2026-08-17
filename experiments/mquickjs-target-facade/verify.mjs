#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { decodeRasterAnimation } from "../../f1-widget-sdk/src/render/raster-animation.mjs";
import { decodeWidgetBundle } from "../../f1-widget-sdk/src/render/widget-bundle.mjs";
import { decodeRenderV2MQuickJsPackage } from "../../f1-widget-sdk/src/render-v2/mquickjs.mjs";
import {
  buildWeatherTargetFacadeAsset, decodeTargetFacadeAsset, packTemperatureAscii,
  renderTargetFacadeHost, TARGET_FACADE_CONTRACT_SHA256, TARGET_FACADE_RESULT,
  WEATHER_TARGET_FACADE_TARGETS,
} from "./contract.mjs";

const execute = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(here, "../..");
const output = path.join(here, "build");
const packagePath = path.join(repository,
  "f1-widget-sdk/examples/render-v2-mquickjs-weather-canary/build/weather-60601.f2js");
const toolchain = process.env.FRAMER_XTENSA_BIN ?? path.join(repository,
  ".toolchains/xtensa-esp-elf-13.2.0_20240530/bin");
const xtensa = (name) => path.join(toolchain, `xtensa-esp32s3-elf-${name}`);
const cc = process.env.CC ?? "cc";
const run = (command, args, options = {}) => execute(command, args,
  { maxBuffer: 32 * 1024 * 1024, ...options });
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const invariant = (value, message) => { if (!value) throw new Error(message); };

function rawFrame(frame) {
  const bytes = Buffer.alloc(frame.length * 2);
  frame.forEach((color, index) => bytes.writeUInt16LE(color, index * 2));
  return bytes;
}

function weatherSlots({ revision = 0, current = 0, currentMeta = 0,
  days = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], age = 0, freshness = 0,
  retry = 0, flags = 0 } = {}) {
  return [revision, packTemperatureAscii(current), currentMeta,
    days[0][0], packTemperatureAscii(days[0][1]), packTemperatureAscii(days[0][2]),
    days[1][0], packTemperatureAscii(days[1][1]), packTemperatureAscii(days[1][2]),
    days[2][0], packTemperatureAscii(days[2][1]), packTemperatureAscii(days[2][2]),
    age, freshness, retry, flags];
}

function encodeCases(cases) {
  const binary = Buffer.alloc(8 + cases.length * 72); binary.write("TFCS", 0, "ascii");
  binary.writeUInt32LE(cases.length, 4);
  cases.forEach((entry, index) => {
    const at = 8 + index * 72; binary.writeUInt32LE(entry.sequence, at);
    entry.slots.forEach((value, slot) => binary.writeInt32LE(value, at + 4 + slot * 4));
    binary.writeUInt32LE(entry.admittedGeneration, at + 68);
  });
  return binary;
}

function sectionBytes(text, prefix) {
  return [...text.matchAll(/^\s*\d+\s+(\.[^\s]+)\s+([0-9a-f]+)/gmu)]
    .filter((match) => match[1] === prefix || match[1].startsWith(`${prefix}.`))
    .reduce((sum, match) => sum + Number.parseInt(match[2], 16), 0);
}

await mkdir(output, { recursive: true });
const temporary = await mkdtemp(path.join(os.tmpdir(), "mquickjs-target-facade-"));
try {
  const f2js = await readFile(packagePath);
  const decodedPackage = decodeRenderV2MQuickJsPackage(f2js);
  invariant(decodedPackage.generation === 18, "Weather fixture is no longer generation 18.");
  invariant(decodedPackage.targets.map(({ id }) => id).join("\0") ===
    WEATHER_TARGET_FACADE_TARGETS.map(({ id }) => id).join("\0"),
  "Companion target IDs no longer exactly match F2JS declarations.");
  const bundle = decodeWidgetBundle(decodedPackage.rasterBase);
  const base = decodeRasterAnimation(bundle.slots[0].animationBinary).frames[0];
  const asset = buildWeatherTargetFacadeAsset({ generation: 18, baseFrame: base, f2jsBinary: f2js });
  const decoded = decodeTargetFacadeAsset(asset.binary, { expectedGeneration: 18,
    expectedF2jsSha256: asset.f2jsSha256, baseFrame: base });

  const negative = weatherSlots({ revision: 7, current: -12, currentMeta: 21,
    days: [[50, -18, 7], [59, -3, 0], [4, 100, 111]], freshness: 1, flags: 1 });
  const positive = weatherSlots({ revision: 8, current: 45, currentMeta: 21,
    days: [[50, 34, 43], [59, 36, 46], [4, 38, 49]], freshness: 1, flags: 1 });
  const cases = [
    { name: "offline-no-snapshot", sequence: 2, admittedGeneration: 18,
      slots: weatherSlots({ freshness: 4, retry: 30, flags: 4 }) },
    { name: "negative-temperatures", sequence: 4, admittedGeneration: 18, slots: negative },
    { name: "stale-tick-same-revision", sequence: 6, admittedGeneration: 18,
      slots: negative.map((value, index) => index === 12 ? 1801 : index === 13 ? 2 : value) },
    { name: "error-last-good", sequence: 8, admittedGeneration: 18,
      slots: negative.map((value, index) => index === 13 ? 3 : index === 14 ? 12 : index === 15 ? 5 : value) },
    { name: "hidden", sequence: 10, admittedGeneration: 18,
      slots: negative.map((value, index) => index === 15 ? 3 : value) },
    { name: "newer-revision", sequence: 12, admittedGeneration: 18, slots: positive },
    { name: "revision-rollback", sequence: 14, admittedGeneration: 18,
      slots: positive.map((value, index) => index === 0 ? 6 : value) },
    { name: "wrong-generation", sequence: 16, admittedGeneration: 17, slots: positive },
    { name: "malformed-packed-ascii", sequence: 18, admittedGeneration: 18,
      slots: positive.map((value, index) => index === 1 ? 0x41414141 : value) },
    { name: "malformed-condition", sequence: 20, admittedGeneration: 18,
      slots: positive.map((value, index) => index === 2 ? 24 : value) },
    { name: "odd-torn-mailbox", sequence: 21, admittedGeneration: 18, slots: positive },
  ];
  const state = { lastAppliedRevision: 0 };
  const host = cases.map((mailbox) => renderTargetFacadeHost({ decoded, baseFrame: base, mailbox, state }));
  const expectedResults = [0, 0, 0, 0, 1, 0, 9, 8, 10, 10, 7];
  invariant(host.map(({ result }) => result).join() === expectedResults.join(),
    `Host result sequence changed: ${host.map(({ result }) => result)}.`);
  const casesBinary = encodeCases(cases);
  const hostFrames = Buffer.concat(host.map(({ frame }) => rawFrame(frame)));

  await Promise.all([
    writeFile(path.join(output, "weather-gen18.f2tf"), asset.binary),
    writeFile(path.join(output, "weather-gen18-base.rgb565le"), asset.baseBytes),
    writeFile(path.join(output, "weather-cases.bin"), casesBinary),
  ]);
  const native = path.join(temporary, "host-harness");
  await run(cc, ["-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", "-pedantic",
    path.join(here, "target_facade.c"), path.join(here, "host_harness.c"), "-o", native]);
  const cFramesPath = path.join(temporary, "c-frames.bin");
  const nativeOutput = JSON.parse((await run(native, [path.join(output, "weather-gen18.f2tf"),
    path.join(output, "weather-gen18-base.rgb565le"), path.join(output, "weather-cases.bin"),
    cFramesPath, asset.f2jsSha256, TARGET_FACADE_CONTRACT_SHA256])).stdout);
  const cFrames = await readFile(cFramesPath);
  invariant(cFrames.equals(hostFrames), "Host and freestanding C RGB565 frames differ.");
  invariant(nativeOutput.results.map(({ result }) => result).join() === expectedResults.join(),
    "C result sequence differs from the host oracle.");

  const cross = path.join(temporary, "target_facade.o");
  await run(xtensa("gcc"), ["-std=c11", "-Os", "-ffreestanding", "-fno-builtin",
    "-fno-stack-protector", "-fno-unwind-tables", "-fno-asynchronous-unwind-tables",
    "-ffunction-sections", "-fdata-sections", "-mlongcalls", "-mtext-section-literals",
    "-fstack-usage", "-c", path.join(here, "target_facade.c"), "-o", cross]);
  const linked = path.join(temporary, "target-facade-core.o");
  await run(xtensa("gcc"), ["-nostdlib", "-Wl,-r", cross, "-lgcc", "-o", linked]);
  const [object, undefineds, sections, compiler, stackUsage] = await Promise.all([
    readFile(linked), run(xtensa("nm"), ["-u", linked]), run(xtensa("objdump"), ["-h", linked]),
    run(xtensa("gcc"), ["--version"]), readFile(cross.replace(/\.o$/u, ".su"), "utf8")]);
  invariant(undefineds.stdout.trim() === "", "Target facade retains undefined Xtensa symbols.");
  const writableBytes = sectionBytes(sections.stdout, ".data") + sectionBytes(sections.stdout, ".bss");
  invariant(writableBytes === 0, "Target facade gained writable globals.");
  const stackFrames = [...stackUsage.matchAll(/\s(\d+)\s+(?:static|dynamic)/gu)].map((match) => Number(match[1]));
  const maxWrites = Math.max(...host.map(({ metrics }) => metrics.overlayWrites));
  const timingCycles = 31_000 * 4 + maxWrites * 12 + 16 * 250 + 512;
  const manifest = {
    format: "framer-mquickjs-target-facade-static-canary-v1",
    status: "STATIC_ONLY_NOT_INTEGRATED",
    hardwareTouched: false, flashable: false, generation: 18,
    asset: { format: "F2TF-v1-companion", bytes: asset.binary.length, sha256: asset.sha256,
      contractSha256: TARGET_FACADE_CONTRACT_SHA256, f2jsSha256: asset.f2jsSha256,
      baseSha256: asset.baseSha256, targetCount: 16, paletteEntries: decoded.palette.length,
      glyphRecords: decoded.glyphs.size, maxOverlayPixelWrites: decoded.header.maxOverlayWrites },
    proof: { hostVsCFrames: "PIXEL_EXACT", cases: cases.map((entry, index) => ({ name: entry.name,
      result: expectedResults[index], frameSha256: sha256(hostFrames.subarray(index * 62_000, (index + 1) * 62_000)),
      overlayWrites: host[index].metrics.overlayWrites })),
      tornMidCopy: nativeOutput.torn, malformedAssets: nativeOutput.malformed,
      overlayOverflowBeforeDraw: nativeOutput.overflow },
    xtensa: { compiler: compiler.stdout.split("\n")[0], objectBytes: object.length,
      objectSha256: sha256(object), textBytes: sectionBytes(sections.stdout, ".text"),
      rodataBytes: sectionBytes(sections.stdout, ".rodata"), writableGlobalBytes: writableBytes,
      undefinedSymbols: 0, maxCompilerReportedFrameBytes: Math.max(...stackFrames),
      conservativeAllStaticFramesBytes: stackFrames.reduce((sum, value) => sum + value, 0) },
    timingEstimate: { kind: "analytic-not-device-measured", cpuMhz: 240, maxObservedOverlayWrites: maxWrites,
      conservativeCycles: timingCycles, microsecondsAt240Mhz: Number((timingCycles / 240).toFixed(1)) },
    requiredProfileExtension: { basePackageAbiUnchanged: true,
      companionAsset: "framer-mquickjs-target-facade-v1", capability: "targetFacade=weather-slot-target-facade-v1",
      packageAssociation: "generation + exact F2JS SHA-256 + exact raster-base SHA-256 + contract SHA-256",
      uiHook: "stock UI task restores admitted base, snapshots resident mailbox, invokes bounded facade" },
    gaps: ["not linked into the resident module or stock UI tick", "no physical capability advertisement",
      "no host-RPC device receipt/transport integration", "no hardware timing, stack high-water, SHA receipt, or soak proof"],
  };
  await writeFile(path.join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ status: manifest.status, asset: manifest.asset, proof: manifest.proof,
    xtensa: manifest.xtensa, timingEstimate: manifest.timingEstimate }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
