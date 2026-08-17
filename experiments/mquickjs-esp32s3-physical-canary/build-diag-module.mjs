#!/usr/bin/env node
// Builds the DIAGNOSTIC module slot (new text+rodata pages) plus a matching
// diagnostic loader and app, without touching the release pipeline.
//
// The only source difference from the frozen ABI-v3 release module is
// diag-module-src/framer_mquickjs_canary.c, which records the classified JS
// exception ("<name>: <message> @<stack>") into a fixed runtime_state buffer
// that survives framer_mqjs_destroy.  That buffer lives inside the existing
// fixed-size framer_mqjs_runtime storage, so physical_block keeps byte-for-byte
// identical offsets and size; every other module source, the assets, the linker
// scripts, and the release verify pins are untouched.
//
// Environment:
//   FRAMER_DIAG_MODULE_OUTPUT  output directory (default build-diag-module/)
//   FRAMER_DIAG_ASSETS_DIR     optional directory of locally generated ID28
//                              assets (weather-id28-gen19.js/.f2js/.f2tf,
//                              weather-id28-base.lzss/.rgb565le).  In that mode
//                              only the four asset SHA-256 pins are relaxed;
//                              the embedded F2JS digest is recomputed, the base
//                              must inflate to exactly 62,000 B and match the
//                              .rgb565le, the F2TF must stay <= 4,096 B and
//                              decode/admit at generation 19 against that exact
//                              package digest and the pinned contract digest,
//                              and the manifest records customAssets:true plus
//                              the actual digests.
//
// Outputs into the output directory:
//   mqjs-id28-text-page-diag.bin      0x20000, flash at 0x210000
//   mqjs-id28-rodata-page-diag.bin    0x10000, flash at 0x230000
//   mqjs-id28-slot-a-diag.bin         concatenation the loader digests
//   mqjs-id28-resident-loader-diag.bin
//   framer-0.4.1-mqjs-id28-DIAG-module-app.bin   flash at 0x10000
//   diag-module-manifest.json
//
// Never touches hardware.  Flashing stays a manual step.

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { inspectEsp32AppImage, repairEsp32AppIntegrity } from
  "../../custom-firmware/lib/esp-app-image.mjs";
import { decodeRenderV2MQuickJsPackage } from
  "../../f1-widget-sdk/src/render-v2/mquickjs.mjs";
import { decodeTargetFacadeAsset, TARGET_FACADE_CONTRACT_SHA256 } from
  "../mquickjs-target-facade/contract.mjs";

const execute = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(here, "../..");
const release = path.join(here, "releases/2026-08-17-id28-abi3-674054a6");
const diagSource = path.join(here, "diag-module-src");
const canary = path.join(repository, "experiments/mquickjs-esp32s3-canary");
const vendor = path.join(canary, "vendor/mquickjs");
const resident = path.join(repository, "experiments/mquickjs-esp32s3-resident-integration");
const moduleLoader = path.join(repository, "experiments/mquickjs-esp32s3-module-loader");
const target = path.join(repository, "experiments/mquickjs-target-facade");
const runtimeProof = path.join(repository, "experiments/mquickjs-esp32s3-runtime-proof");
const healthyApp = path.join(repository,
  "f1-widget-sdk/build/combined-renderer-v2-clock-blue-timer/" +
  "framer-0.4.1-music-id1-wpm-id7-renderer-id26-clock-id27-blue-timer-app.bin");
const output = process.env.FRAMER_DIAG_MODULE_OUTPUT ??
  path.join(here, "build-diag-module");
// Optional restyle/iteration mode: a directory holding a locally generated ID28
// asset set (weather-id28-gen19.js/.f2js/.f2tf, weather-id28-base.lzss and
// weather-id28-base.rgb565le).  Only the four *asset* SHA-256 pins are relaxed;
// every module/loader/app pin still applies, and the assets are re-validated
// here against the same rules `framer_tf_admit` and the resident LZSS decoder
// enforce on the device.
const customAssetsDir = process.env.FRAMER_DIAG_ASSETS_DIR
  ? path.resolve(process.env.FRAMER_DIAG_ASSETS_DIR) : null;
const toolchain = process.env.FRAMER_XTENSA_BIN ?? path.join(repository,
  ".toolchains/xtensa-esp-elf-13.2.0_20240530/bin");
const xtensa = (name) => path.join(toolchain, `xtensa-esp32s3-elf-${name}`);
const cc = process.env.CC ?? "cc";

// Identical to verify.mjs `layout`.
const layout = Object.freeze({
  textPaddr: 0x210000, textVaddr: 0x423d0000, textBytes: 0x20000,
  rodataPaddr: 0x230000, rodataVaddr: 0x3c3f0000, rodataBytes: 0x10000,
  loaderVaddr: 0x4211e460, loaderEnd: 0x4211ff18,
  setupTail: 0x42118cdd, keyLiteral: 0x42041568,
});
const expected = Object.freeze({
  candidateAppSha256: "674054a6e9d6536ad2414096cd89c1025e78904dff6b4a1aee0ef8cab434e808",
  healthyAppSha256: "363170139a06f306be1e894b6f203a9bf03bf4d70d21194aaccdd1c42f760c32",
  releaseTextSha256: "bd46e3473b8493291aadebcf1d093e812a0788866e787663920637a3d76c8c43",
  releaseRodataSha256: "72a2a26cb9cb0c0c52ab0ee897ad5d59b0a3c9765d3f495bfe96565b305a8c43",
  releaseSlotSha256: "b1104134b37c9b6726e96f852b28e1eb971ba3aa4870d44543cfd1c5e8c6a6c1",
  releaseLoaderSha256: "cd0e352b46d23193d07c696355442ee2a68311c44ad3a901692627560fbde97c",
  moduleAbi: "ad484a3a8b438c51f6bbcda6ea871110735b3460e39e4c2853a4e636f5f728cb",
  packageAbi: "5091736403d809078cbbf12a1b593fbabaff53474a0935a7e00ce81dc8bd67f8",
  f2jsSha256: "7aeeecde59bd686b3455feadc74b4b7705ca0c8ea933f9b0669cb8dc656c284e",
  f2tfSha256: "c436eea7ec9bfc85bbb9514923ea5bf4084ecbcb712ab5c183b9dd2adfd75743",
  lzssSha256: "dbf16d41750555b7a3403b4b568530a0b5cab1d6b3bf0558c836823749293a12",
  sourceSha256: "a9b1a833a75f8a296ae5e2575f31ec1030af0c8a944031858e0506456f8864ab",
  targetContractSha256: "8220152a09348da34cdd70dd7d370197f2f3fc46a9f45e50d7fb7015bdb8579a",
  // ID28 asset shape, enforced whether the assets come from the release or from
  // FRAMER_DIAG_ASSETS_DIR.  PHYSICAL_GENERATION / PHYSICAL_FRAME_BYTES /
  // FRAMER_TF_MAX_ASSET_BYTES in the module sources.
  generation: 19,
  baseFrameBytes: 62000,
  maxFacadeAssetBytes: 4096,
  packageEvents: 14,
  packageKeys: 2,
  packageChords: 1,
  // Frozen release identity: the diagnostic module must keep the same block
  // size and startup/id/key-sink placement discipline, but its addresses are
  // re-derived below and are allowed to move.
  releaseBlockBytes: 95568,
  releaseStartupVaddr: 0x423e3510,
  // Only the instrumented engine differs, and only inside a fixed-size buffer.
  engineSourceRelative: "experiments/mquickjs-esp32s3-physical-canary/diag-module-src/framer_mquickjs_canary.c",
});

const invariant = (ok, message) => { if (!ok) throw new Error(message); };
const hex = (value) => `0x${value.toString(16)}`;
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const shaBytes = (bytes) => createHash("sha256").update(bytes).digest();
const words = (digest, endian) => Array.from({ length: 8 }, (_, i) =>
  digest[endian === "le" ? "readUInt32LE" : "readUInt32BE"](i * 4));
const wordDefines = (prefix, values) => values.map((v, i) => `-D${prefix}_W${i}=${hex(v)}u`);
async function run(file, args) {
  return execute(file, args, { cwd: repository, maxBuffer: 64 * 1024 * 1024 });
}
function sectionTable(text) {
  return Object.fromEntries([...text.matchAll(
    /^\s*\d+\s+(\.[^\s]+)\s+([0-9a-f]+)\s+([0-9a-f]+)/gmu,
  )].map((m) => [m[1], { bytes: Number.parseInt(m[2], 16),
    vaddr: Number.parseInt(m[3], 16) }]));
}
function symbolAddress(text, name) {
  const m = new RegExp(`^([0-9a-f]+)\\s+[A-Za-z]\\s+${name}$`, "mu").exec(text);
  invariant(m, `Missing symbol ${name}.`);
  return Number.parseInt(m[1], 16);
}
function readVirtual(image, start, end) {
  const irom = image.segments[3];
  return irom.data.subarray(start - irom.loadAddress, end - irom.loadAddress);
}
// Mirror of the resident decoder in physical_integration.c / verify.mjs; used
// only to prove a custom base still inflates to exactly 62,000 bytes.
function decodeLzss(bytes, outputBytes) {
  const decoded = Buffer.alloc(outputBytes);
  let source = 0; let destination = 0;
  while (destination < decoded.length) {
    invariant(source < bytes.length, "LZSS flags overrun.");
    const flags = bytes[source++];
    for (let bit = 1; bit <= 0x80 && destination < decoded.length; bit <<= 1) {
      if ((flags & bit) === 0) decoded[destination++] = bytes[source++];
      else {
        const code = bytes.readUInt16LE(source); source += 2;
        const distance = (code & 1023) + 1; const length = (code >>> 10) + 3;
        invariant(distance <= destination && length <= decoded.length - destination,
          "LZSS match escaped output.");
        for (let index = 0; index < length; index++) {
          decoded[destination] = decoded[destination - distance]; destination++;
        }
      }
    }
  }
  invariant(source === bytes.length, "LZSS trailing bytes.");
  return decoded;
}
function diffRanges(a, b) {
  const runs = []; let i = 0;
  while (i < a.length) {
    while (i < a.length && a[i] === b[i]) i++;
    if (i === a.length) break;
    const start = i; while (i < a.length && a[i] !== b[i]) i++;
    runs.push({ start, end: i });
  }
  return runs;
}

// Exactly verify.mjs buildModule flags.
const moduleFlags = ["-std=c11", "-Os", "-DNDEBUG", "-fno-builtin",
  "-fno-stack-protector", "-fno-unwind-tables", "-fno-asynchronous-unwind-tables",
  "-ffunction-sections", "-fdata-sections", "-mlongcalls", "-mtext-section-literals",
  "-fstack-usage"];
// Exactly build-diag-loader.mjs / verify.mjs buildLoader flags.
const loaderFlags = ["-std=c11", "-Os", "-DNDEBUG", "-fno-builtin",
  "-fno-stack-protector", "-fno-unwind-tables", "-fno-asynchronous-unwind-tables",
  "-ffunction-sections", "-fdata-sections", "-mlongcalls", "-mtext-section-literals",
  "-fno-jump-tables", "-fno-tree-loop-distribute-patterns"];
async function compileWith(flags, source, destination, includes, extra) {
  await run(xtensa("gcc"), [...flags, ...extra, ...includes.map((i) => `-I${i}`),
    "-c", source, "-o", destination]);
}

// Identical to verify.mjs generator(): the atom table and stdlib are generated,
// never checked in, so the diagnostic module keeps the pinned engine surface.
async function generator(directory) {
  const executable = path.join(directory, "framer-stdlib-gen");
  await run(cc, ["-std=c11", "-O2", `-I${vendor}`,
    path.join(canary, "framer_stdlib_gen.c"),
    path.join(vendor, "mquickjs_build.c"), "-o", executable]);
  const [atoms, library] = await Promise.all([
    run(executable, ["-m32", "-a"]), run(executable, ["-m32"]),
  ]);
  await Promise.all([
    writeFile(path.join(directory, "mquickjs_atom.h"), atoms.stdout),
    writeFile(path.join(directory, "framer_stdlib.h"), library.stdout),
  ]);
}

/* Compile an offsetof probe with the exact module compiler/flags/includes and
 * read the answers back out of a dedicated section: no host-side struct
 * modelling, no parsing of debug info. */
async function probe(name, body, includes, extra, labels) {
  const source = path.join(build, `${name}.c`);
  const object = path.join(build, `${name}.o`);
  const binary = path.join(build, `${name}.bin`);
  await writeFile(source,
    `${body}\n#include <stddef.h>\n` +
    `__attribute__((used, section(".probe")))\n` +
    `const unsigned int framer_probe_values[] = {\n` +
    labels.map(([, expression]) => `    (unsigned int)(${expression}),\n`).join("") +
    `};\n`);
  await compileWith(moduleFlags.filter((flag) => flag !== "-fstack-usage"),
    source, object, includes, extra);
  await run(xtensa("objcopy"), ["-O", "binary", "-j", ".probe", object, binary]);
  const bytes = await readFile(binary);
  invariant(bytes.length === labels.length * 4,
    `Probe ${name} returned ${bytes.length} bytes for ${labels.length} values.`);
  return Object.fromEntries(labels.map(([label], index) =>
    [label, bytes.readUInt32LE(index * 4)]));
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const build = path.join(output, "build");
const assets = path.join(output, "assets");
await Promise.all([mkdir(build), mkdir(assets)]);

// --- inputs -----------------------------------------------------------------
const releaseFile = (name) => path.join(release, name);
const assetFile = (name) => path.join(customAssetsDir ?? release, name);
const [candidate, healthy, releaseText, releaseRodata, releaseLoader,
  f2js, f2tf, lzss, weatherSource, header] = await Promise.all([
  readFile(releaseFile("framer-0.4.1-mqjs-id28-canary-NO-GO-app.bin")),
  readFile(healthyApp),
  readFile(releaseFile("mqjs-id28-text-page.bin")),
  readFile(releaseFile("mqjs-id28-rodata-page.bin")),
  readFile(releaseFile("mqjs-id28-resident-loader.bin")),
  readFile(assetFile("weather-id28-gen19.f2js")),
  readFile(assetFile("weather-id28-gen19.f2tf")),
  readFile(assetFile("weather-id28-base.lzss")),
  readFile(assetFile("weather-id28-gen19.js")),
  readFile(path.join(canary, "framer_mquickjs_canary.h"), "utf8"),
]);
invariant(sha(candidate) === expected.candidateAppSha256, "Released candidate app changed.");
invariant(sha(healthy) === expected.healthyAppSha256, "Healthy app changed.");
invariant(sha(releaseText) === expected.releaseTextSha256 &&
  sha(releaseRodata) === expected.releaseRodataSha256 &&
  sha(Buffer.concat([releaseText, releaseRodata])) === expected.releaseSlotSha256,
"Release module pages changed.");
invariant(sha(releaseLoader) === expected.releaseLoaderSha256, "Release loader changed.");
const assetSha = Object.freeze({ f2js: sha(f2js), f2tf: sha(f2tf), lzss: sha(lzss),
  source: sha(weatherSource) });
if (!customAssetsDir) {
  invariant(assetSha.f2js === expected.f2jsSha256 && assetSha.f2tf === expected.f2tfSha256 &&
    assetSha.lzss === expected.lzssSha256 && assetSha.source === expected.sourceSha256,
  "Released ID28 assets changed.");
}
invariant(TARGET_FACADE_CONTRACT_SHA256 === expected.targetContractSha256,
  "F2TF contract identity changed.");
// Whatever the asset source, the module only boots if the base inflates to
// exactly one 100x310 RGB565 frame and the facade admits against the exact
// package digest it is bound to.  Prove both here rather than on the keyboard.
const baseFrameBytes = decodeLzss(lzss, expected.baseFrameBytes);
invariant(baseFrameBytes.length === expected.baseFrameBytes,
  `Base LZSS inflated to ${baseFrameBytes.length} B, not ${expected.baseFrameBytes} B.`);
invariant(f2tf.length <= expected.maxFacadeAssetBytes,
  `F2TF is ${f2tf.length} B; FRAMER_TF_MAX_ASSET_BYTES is ${expected.maxFacadeAssetBytes}.`);
const facadeBaseFrame = new Uint16Array(baseFrameBytes.buffer.slice(
  baseFrameBytes.byteOffset, baseFrameBytes.byteOffset + baseFrameBytes.length));
const decodedFacade = decodeTargetFacadeAsset(f2tf, {
  expectedGeneration: expected.generation, expectedF2jsSha256: assetSha.f2js,
  expectedContractSha256: TARGET_FACADE_CONTRACT_SHA256, baseFrame: facadeBaseFrame });
invariant(decodedFacade.targets.length === 16,
  "F2TF must declare exactly 16 targets.");
let customPackage = null;
if (customAssetsDir) {
  const rawBase = await readFile(assetFile("weather-id28-base.rgb565le"));
  invariant(rawBase.equals(baseFrameBytes),
    "weather-id28-base.lzss does not decode to weather-id28-base.rgb565le.");
  // The resident admission surface must not drift: same package format,
  // generation, declared event/key/chord counts, and no in-package raster.
  const decodedPackage = decodeRenderV2MQuickJsPackage(f2js);
  invariant(decodedPackage.generation === expected.generation &&
    (decodedPackage.rasterBase?.length ?? 0) === 0 &&
    decodedPackage.events.length === expected.packageEvents &&
    decodedPackage.input.keyCount === expected.packageKeys &&
    decodedPackage.input.chordCount === expected.packageChords &&
    decodedPackage.targets.length === 16,
  `Custom F2JS admission metadata drifted: generation=${decodedPackage.generation} ` +
    `events=${decodedPackage.events.length} keys=${decodedPackage.input.keyCount} ` +
    `chords=${decodedPackage.input.chordCount}.`);
  invariant(decodedPackage.targets.map(({ id }) => id).join("\0") ===
    decodedFacade.targets.map(({ id }) => id).join("\0"),
  "Custom F2JS target IDs differ from the F2TF target IDs.");
  invariant(decodedPackage.sha256 === assetSha.f2js, "Custom F2JS did not round-trip.");
  customPackage = { generation: decodedPackage.generation,
    events: decodedPackage.events.length, keys: decodedPackage.input.keyCount,
    chords: decodedPackage.input.chordCount,
    matchesFlashedPackage: assetSha.f2js === expected.f2jsSha256 };
}
// The diagnostic module must differ from the release engine only in the copied
// source, never through an edited release source file.
invariant(await readFile(path.join(canary, "framer_mquickjs_canary.c"), "utf8") !==
  await readFile(path.join(diagSource, "framer_mquickjs_canary.c"), "utf8"),
"diag-module-src engine copy is identical to the release engine: nothing to diagnose.");
const runtimeStorageBytes = Number(
  /FRAMER_MQJS_RUNTIME_STORAGE_BYTES\s+(\d+)u/u.exec(header)[1]);
const heapBytes = Number(/FRAMER_MQJS_MIN_HEAP_BYTES\s+(\d+)u/u.exec(header)[1]);

// --- assets (embedded verbatim) ---------------------------------------------
// buildAssets() only writes these five files for the module link: the three
// payloads plus two 32-byte digests.  Re-encoding them here would be a second,
// unpinned implementation of the package/LZSS builders, so the artifacts are
// embedded exactly as their producer emitted them - the frozen release by
// default, or FRAMER_DIAG_ASSETS_DIR when a restyled set is being tried.  The
// embedded F2JS digest is always recomputed from the bytes actually embedded,
// so `framer_tf_admit`'s package binding holds either way.
const assetPaths = {
  f2js: path.join(assets, "weather-id28-gen19.f2js"),
  f2tf: path.join(assets, "weather-id28-gen19.f2tf"),
  compressed: path.join(assets, "weather-id28-base.lzss"),
  f2jsSha: path.join(assets, "weather-id28-f2js.sha256.bin"),
  contractSha: path.join(assets, "target-contract.sha256.bin"),
  source: path.join(assets, "weather-id28-gen19.js"),
};
await Promise.all([
  writeFile(assetPaths.f2js, f2js), writeFile(assetPaths.f2tf, f2tf),
  writeFile(assetPaths.compressed, lzss), writeFile(assetPaths.source, weatherSource),
  writeFile(assetPaths.f2jsSha, shaBytes(f2js)),
  writeFile(assetPaths.contractSha, Buffer.from(TARGET_FACADE_CONTRACT_SHA256, "hex")),
]);

// --- module link ------------------------------------------------------------
await generator(build);
const includes = [build, diagSource, canary, vendor, resident, target, runtimeProof, here];
const abiWords = words(Buffer.from(expected.moduleAbi, "hex"), "le");
const sources = [
  // The one instrumented translation unit.
  [path.join(diagSource, "framer_mquickjs_canary.c"), "runtime.o", []],
  [path.join(moduleLoader, "module_adapter.c"), "adapter.o",
    wordDefines("FRAMER_MQJS_ABI_SHA256", abiWords)],
  [path.join(vendor, "dtoa.c"), "dtoa.o", []],
  [path.join(vendor, "libm.c"), "libm.o", ["-UNDEBUG"]],
  [path.join(vendor, "cutils.c"), "cutils.o", []],
  [path.join(resident, "f2js_admission.c"), "f2js.o", []],
  [path.join(resident, "resident_integration.c"), "resident.o", []],
  [path.join(target, "target_facade.c"), "target.o", []],
  [path.join(runtimeProof, "runtime_proof.c"), "runtime-proof.o",
    ["-DFRAMER_RUNTIME_PROOF_EXACT_ABI_ACK=0x36317013u"]],
  [path.join(here, "physical_integration.c"), "physical.o",
    ["-DFRAMER_RUNTIME_PROOF_EXACT_ABI_ACK=0x36317013u"]],
];
const moduleObjects = [];
for (const [source, name, extra] of sources) {
  const object = path.join(build, name);
  await compileWith(moduleFlags, source, object, includes, extra);
  moduleObjects.push(object);
}
const rpcShim = path.join(build, "rpc-shims.o");
await run(xtensa("gcc"), ["-c", path.join(here, "rpc_shims.S"), "-o", rpcShim]);
moduleObjects.push(rpcShim);
const assetAssembly = path.join(build, "assets.S");
const assetObject = path.join(build, "assets.o");
const entry = (symbol, file) => `.global ${symbol}_start\n${symbol}_start:\n` +
  `.incbin ${JSON.stringify(file)}\n.global ${symbol}_end\n${symbol}_end:\n`;
await writeFile(assetAssembly,
  `.section .rodata.physical_assets,"a",@progbits\n.balign 16\n` +
  entry("framer_physical_weather_f2js", assetPaths.f2js) + `.balign 16\n` +
  entry("framer_physical_weather_f2tf", assetPaths.f2tf) + `.balign 16\n` +
  entry("framer_physical_weather_base_lzss", assetPaths.compressed) + `.balign 16\n` +
  `.global framer_physical_weather_f2js_sha256\nframer_physical_weather_f2js_sha256:\n` +
  `.incbin ${JSON.stringify(assetPaths.f2jsSha)}\n.balign 16\n` +
  `.global framer_physical_target_contract_sha256\nframer_physical_target_contract_sha256:\n` +
  `.incbin ${JSON.stringify(assetPaths.contractSha)}\n`);
await run(xtensa("gcc"), ["-c", assetAssembly, "-o", assetObject]);
moduleObjects.push(assetObject);

const moduleElf = path.join(build, "module.elf");
const moduleMap = path.join(build, "module.map");
await run(xtensa("gcc"), ["-nostartfiles", "-specs=nosys.specs", "-Wl,--gc-sections",
  `-Wl,-T,${path.join(here, "module.ld")}`, `-Wl,-Map,${moduleMap}`, "-o", moduleElf,
  ...moduleObjects, "-lm"]);
const [moduleHeaders, moduleRelocations, moduleUndefineds, moduleSymbols] =
  await Promise.all([
    run(xtensa("objdump"), ["-h", moduleElf]), run(xtensa("readelf"), ["-r", moduleElf]),
    run(xtensa("nm"), ["-u", moduleElf]), run(xtensa("nm"), ["-n", moduleElf]),
  ]);
invariant(/There are no relocations/u.test(moduleRelocations.stdout) &&
  !moduleUndefineds.stdout.trim(),
`Diagnostic module retained relocations/undefined symbols: ${moduleUndefineds.stdout}`);
const moduleSections = sectionTable(moduleHeaders.stdout);
invariant(moduleSections[".text"]?.vaddr === layout.textVaddr &&
  moduleSections[".text"].bytes <= layout.textBytes &&
  moduleSections[".rodata"]?.vaddr === layout.rodataVaddr &&
  moduleSections[".rodata"].bytes <= layout.rodataBytes &&
  (moduleSections[".data"]?.bytes ?? 0) === 0 &&
  (moduleSections[".bss"]?.bytes ?? 0) === 0,
`Diagnostic module section placement changed: ${JSON.stringify(moduleSections)}`);
const textFile = path.join(output, "mqjs-id28-text-page-diag.bin");
const rodataFile = path.join(output, "mqjs-id28-rodata-page-diag.bin");
await Promise.all([
  run(xtensa("objcopy"), ["-O", "binary", "-j", ".text", "--gap-fill=0x00",
    `--pad-to=${hex(layout.textVaddr + layout.textBytes)}`, moduleElf, textFile]),
  run(xtensa("objcopy"), ["-O", "binary", "-j", ".rodata", "--gap-fill=0x00",
    `--pad-to=${hex(layout.rodataVaddr + layout.rodataBytes)}`, moduleElf, rodataFile]),
]);
const [textPage, rodataPage] = await Promise.all([readFile(textFile), readFile(rodataFile)]);
invariant(textPage.length === layout.textBytes && rodataPage.length === layout.rodataBytes,
  "Diagnostic module padded page length changed.");
const slot = Buffer.concat([textPage, rodataPage]);
const slotFile = path.join(output, "mqjs-id28-slot-a-diag.bin");
await writeFile(slotFile, slot);
invariant(!textPage.equals(releaseText),
  "Diagnostic text page equals the release page: the instrumentation was not compiled in.");

const startupVaddr = symbolAddress(moduleSymbols.stdout, "framer_physical_module_startup");
const id28IdentityVaddr = symbolAddress(moduleSymbols.stdout, "framer_physical_weather_id");
const keySinkVaddr = symbolAddress(moduleSymbols.stdout, "framer_physical_key_after_stock");
const blockBytes = rodataPage.readUInt32LE(
  symbolAddress(moduleSymbols.stdout, "framer_physical_block_allocation_bytes") -
  layout.rodataVaddr);
// The descriptor must still carry the distinct ABI3 module identity.
const descriptor = symbolAddress(moduleSymbols.stdout, "framer_mqjs_module") -
  layout.rodataVaddr;
invariant(rodataPage.readUInt16LE(descriptor + 4) === 3 &&
  rodataPage.readUInt16LE(descriptor + 6) === 116 &&
  rodataPage.subarray(descriptor + 36, descriptor + 68).toString("hex") ===
    expected.moduleAbi &&
  rodataPage.subarray(descriptor + 36, descriptor + 68).toString("hex") !==
    expected.packageAbi,
"Diagnostic descriptor lost the distinct ABI3 module identity.");
const stackUsage = [];
for (const name of (await readdir(build)).filter((n) => n.endsWith(".su")).sort()) {
  const text = await readFile(path.join(build, name), "utf8");
  for (const line of text.trim().split(/\n/u)) {
    const match = /:([A-Za-z0-9_.$]+)\t([0-9]+)\t([^\t]+)$/u.exec(line);
    if (match) stackUsage.push({ object: name.replace(/\.su$/u, ".o"),
      function: match[1], bytes: Number.parseInt(match[2], 10), kind: match[3] });
  }
}
invariant(stackUsage.length > 0 && stackUsage.every((item) => item.kind === "static"),
  "Diagnostic module stack usage is missing or dynamic.");

// --- offsets, re-derived against the instrumented sources -------------------
const blockLabels = [
  ["sizeofBlock", "sizeof(physical_block)"],
  ["BLK_MAGIC", "offsetof(physical_block, magic)"],
  ["BLK_SOURCES_ENABLED", "offsetof(physical_block, sources_enabled)"],
  ["BLK_BOOT_STATE", "offsetof(physical_block, boot_state)"],
  ["BLK_RPC_READY", "offsetof(physical_block, rpc_ready)"],
  ["BLK_BOOT_STARTED_MS", "offsetof(physical_block, boot_started_ms)"],
  ["BLK_BOOT_FINISHED_MS", "offsetof(physical_block, boot_finished_ms)"],
  ["BLK_TASK_HANDLE", "offsetof(physical_block, task_handle)"],
  ["BLK_OWNER", "offsetof(physical_block, owner)"],
  ["BLK_OWNER_RUNTIME",
    "offsetof(physical_block, owner) + offsetof(framer_resident_owner, runtime)"],
  ["BLK_OWNER_CAP_READY_MASK",
    "offsetof(physical_block, owner) + offsetof(framer_resident_owner, capability) +" +
    " offsetof(framer_resident_capability, ready_mask)"],
  ["BLK_OWNER_CAP_STATE",
    "offsetof(physical_block, owner) + offsetof(framer_resident_owner, capability) +" +
    " offsetof(framer_resident_capability, state)"],
  ["BLK_OWNER_ADM_GENERATION",
    "offsetof(physical_block, owner) + offsetof(framer_resident_owner, admission) +" +
    " offsetof(framer_f2js_admission, generation)"],
  ["BLK_OWNER_ADM_COUNTS",
    "offsetof(physical_block, owner) + offsetof(framer_resident_owner, admission) +" +
    " offsetof(framer_f2js_admission, key_count)"],
  ["BLK_OWNER_ADM_EVENT0",
    "offsetof(physical_block, owner) + offsetof(framer_resident_owner, admission) +" +
    " offsetof(framer_f2js_admission, events)"],
  ["BLK_OWNER_HEAP",
    "offsetof(physical_block, owner) + offsetof(framer_resident_owner, heap)"],
  ["BLK_OWNER_SOURCE_QUIESCE",
    "offsetof(physical_block, owner) +" +
    " offsetof(framer_resident_owner, source_quiesce_state)"],
  ["BLK_OWNER_TEL_LAST_RESULT",
    "offsetof(physical_block, owner) + offsetof(framer_resident_owner, telemetry) +" +
    " offsetof(framer_resident_telemetry, last_result)"],
  ["BLK_OWNER_TEL_BOOTED",
    "offsetof(physical_block, owner) + offsetof(framer_resident_owner, telemetry) +" +
    " offsetof(framer_resident_telemetry, booted)"],
];
const blockProbe = await probe("probe-block", `#include "physical_integration.c"`,
  includes, ["-DFRAMER_RUNTIME_PROOF_EXACT_ABI_ACK=0x36317013u"], blockLabels);
const engineProbe = await probe("probe-engine", `#include "framer_mquickjs_canary.c"`,
  includes, [], [
    ["sizeofRuntimeState", "sizeof(runtime_state)"],
    ["lastErrorOffset", "offsetof(runtime_state, last_error)"],
    ["lastErrorBytes", "FRAMER_MQJS_DIAG_LAST_ERROR_BYTES"],
  ]);
invariant(blockProbe.sizeofBlock === blockBytes,
  `Probe sizeof(physical_block)=${blockProbe.sizeofBlock} != linked ` +
  `framer_physical_block_allocation_bytes=${blockBytes}.`);
invariant(blockBytes === expected.releaseBlockBytes,
  `Diagnostic block size ${blockBytes} moved off the release size ` +
  `${expected.releaseBlockBytes}: the instrumentation escaped the fixed runtime storage.`);
invariant(blockProbe.BLK_OWNER_RUNTIME === blockProbe.BLK_OWNER,
  "framer_mqjs_runtime is no longer the first member of framer_resident_owner.");
invariant(engineProbe.sizeofRuntimeState <= runtimeStorageBytes,
  `Instrumented runtime_state (${engineProbe.sizeofRuntimeState} B) overflows the ` +
  `${runtimeStorageBytes} B runtime storage.`);
invariant(engineProbe.lastErrorBytes === 108 &&
  (engineProbe.lastErrorOffset & 3) === 0 && (engineProbe.lastErrorBytes & 3) === 0,
"last_error must stay 108 bytes and word aligned for the loader's 32-bit reads.");
const lastErrorOffset = blockProbe.BLK_OWNER_RUNTIME + engineProbe.lastErrorOffset;
invariant(lastErrorOffset + engineProbe.lastErrorBytes <= blockBytes,
  "last_error escaped the resident block.");
const offsets = Object.freeze({
  ...Object.fromEntries(blockLabels.slice(1)
    .filter(([name]) => name !== "BLK_OWNER" && name !== "BLK_OWNER_RUNTIME")
    .map(([name]) => [name, blockProbe[name]])),
  BLK_LAST_ERROR: lastErrorOffset,
  BLK_LAST_ERROR_BYTES: engineProbe.lastErrorBytes,
});
const offsetDefines = Object.entries(offsets).map(([n, v]) => `-D${n}=${v}u`);

// --- diagnostic loader against THESE pages ----------------------------------
const textDigest = shaBytes(textPage);
const rodataDigest = shaBytes(rodataPage);
const slotDigest = shaBytes(slot);
const loaderObjects = {
  tail: path.join(build, "tail.o"), entry: path.join(build, "loader-entry-diag.o"),
  key: path.join(build, "key-wrapper.o"), loader: path.join(build, "resident-loader.o"),
};
await Promise.all([
  compileWith(loaderFlags, path.join(moduleLoader, "resident_loader_canary.c"),
    loaderObjects.loader, [moduleLoader], [
      `-DFRAMER_MODULE_RUNTIME_STORAGE_BYTES=${runtimeStorageBytes}u`,
      `-DFRAMER_MODULE_MIN_HEAP_BYTES=${heapBytes}u`,
      `-DFRAMER_MODULE_TEXT_USED_BYTES=${moduleSections[".text"].bytes}u`,
      ...wordDefines("FRAMER_MODULE_TEXT_SHA256", words(textDigest, "be")),
      ...wordDefines("FRAMER_MODULE_RODATA_SHA256", words(rodataDigest, "be")),
      ...wordDefines("FRAMER_MQJS_ABI_SHA256", abiWords),
    ]),
  compileWith(loaderFlags, path.join(here, "loader_entry_diag.c"),
    loaderObjects.entry, [moduleLoader], [
      `-DFRAMER_PHYSICAL_STARTUP_VADDR=${hex(startupVaddr)}u`,
      `-DFRAMER_PHYSICAL_BLOCK_BYTES=${blockBytes}u`,
      ...offsetDefines,
      ...wordDefines("FRAMER_PHYSICAL_MODULE_SHA256", words(slotDigest, "le")),
    ]),
  compileWith(loaderFlags, path.join(here, "key_wrapper.c"), loaderObjects.key, [], [
    `-DFRAMER_PHYSICAL_ID_VADDR=${hex(id28IdentityVaddr)}u`,
    `-DFRAMER_PHYSICAL_KEY_SINK_VADDR=${hex(keySinkVaddr)}u`,
  ]),
  run(xtensa("gcc"), ["-c", path.join(here, "tail_trampoline.S"), "-o", loaderObjects.tail]),
]);
// loader.ld discards writable/rodata payload, so no object may carry any.
for (const [name, object] of Object.entries(loaderObjects)) {
  const table = sectionTable((await run(xtensa("objdump"), ["-h", object])).stdout);
  for (const [section, info] of Object.entries(table))
    invariant(!/^\.(rodata|data|bss|sdata|sbss)/u.test(section) || info.bytes === 0,
      `${name} object carries ${section} (${info.bytes} B); loader must be text-only.`);
}
const loaderElf = path.join(build, "resident-loader-diag.elf");
await run(xtensa("gcc"), ["-nostdlib", "-Wl,--gc-sections",
  `-Wl,-T,${path.join(here, "loader.ld")}`, "-o", loaderElf,
  loaderObjects.tail, loaderObjects.entry, loaderObjects.key, loaderObjects.loader,
  "-lgcc"]);
const [loaderHeaders, loaderRelocations, loaderUndefineds, loaderSymbols, disassembly] =
  await Promise.all([
    run(xtensa("objdump"), ["-h", loaderElf]), run(xtensa("readelf"), ["-r", loaderElf]),
    run(xtensa("nm"), ["-u", loaderElf]), run(xtensa("nm"), ["-n", loaderElf]),
    run(xtensa("objdump"), ["-d", loaderElf]),
  ]);
invariant(/There are no relocations/u.test(loaderRelocations.stdout) &&
  !loaderUndefineds.stdout.trim(),
`Loader retained relocations/undefined symbols: ${loaderUndefineds.stdout}`);
const loaderSections = sectionTable(loaderHeaders.stdout);
const cavityBytes = layout.loaderEnd - layout.loaderVaddr;
invariant(loaderSections[".text"]?.vaddr === layout.loaderVaddr &&
  loaderSections[".text"].bytes <= cavityBytes,
`Loader escaped cavity: ${JSON.stringify(loaderSections[".text"])}`);
const loaderFile = path.join(output, "mqjs-id28-resident-loader-diag.bin");
await run(xtensa("objcopy"), ["-O", "binary", "-j", ".text", loaderElf, loaderFile]);
const loaderRaw = await readFile(loaderFile);
await writeFile(path.join(output, "resident-loader-diag.dis.txt"), disassembly.stdout);
const tailAddress = symbolAddress(loaderSymbols.stdout, "framer_physical_tail_trampoline");
const keyWrapper = symbolAddress(loaderSymbols.stdout, "framer_physical_key_wrapper");
invariant(tailAddress === layout.loaderVaddr, "Tail trampoline must sit at the cavity start.");
for (const helper of ["0x42004afc", "0x4211b7c8", "0x4211ba58", "0x4038dc3c", "0x420c8200",
  "0x420c82c4", "0x4037e55c", "0x4037e250", "0x4037e028", "0x4038daf4"])
  invariant(disassembly.stdout.includes(helper.slice(2)),
    `Loader disassembly lacks helper ${helper}.`);
for (const forbidden of ["<memcpy>", "<memset>", "<memmove>", "<bzero>"])
  invariant(!disassembly.stdout.includes(forbidden),
    `Loader disassembly calls ${forbidden}; loader must stay builtin-free.`);
// The startup pointer the loader jumps to must be this module's, not the frozen one.
invariant(disassembly.stdout.includes(hex(startupVaddr).slice(2)),
  "Loader disassembly does not embed the diagnostic module startup address.");

// --- compose app from the released candidate --------------------------------
const before = inspectEsp32AppImage(candidate);
const irom = before.segments[3];
const cavity = readVirtual(before, layout.loaderVaddr, layout.loaderEnd);
invariant(cavity.subarray(0, releaseLoader.length).equals(releaseLoader) &&
  cavity.subarray(releaseLoader.length).every((b) => b === 0),
"Candidate cavity does not hold the released loader + zeros.");
invariant(readVirtual(before, layout.setupTail, layout.setupTail + 3).toString("hex") !== "1df000",
  "Candidate setup tail is not patched.");
const app = Buffer.from(candidate);
const cavityOffset = irom.dataOffset + layout.loaderVaddr - irom.loadAddress;
app.fill(0, cavityOffset, cavityOffset + cavityBytes);
loaderRaw.copy(app, cavityOffset);
app.writeUInt32LE(keyWrapper, irom.dataOffset + layout.keyLiteral - irom.loadAddress);
const repaired = repairEsp32AppIntegrity(app);
const after = inspectEsp32AppImage(repaired);
invariant(after.segmentCount === before.segmentCount && after.segmentCount === 6 &&
  repaired.length === candidate.length && repaired.length === 2062912,
`Diag app layout/length changed: ${after.segmentCount} segments, ${repaired.length} bytes.`);
for (let i = 0; i < before.segmentCount; i++) {
  invariant(before.segments[i].loadAddress === after.segments[i].loadAddress &&
    before.segments[i].length === after.segments[i].length, `Segment ${i} layout changed.`);
  if (i !== 3) invariant(before.segments[i].data.equals(after.segments[i].data),
    `Non-IROM segment ${i} changed.`);
}
const allowed = [
  [irom.dataOffset + layout.setupTail - irom.loadAddress, 3],
  [irom.dataOffset + layout.keyLiteral - irom.loadAddress, 4],
  [cavityOffset, cavityBytes],
  [candidate.length - 33, 33],
];
for (const range of diffRanges(healthy, repaired))
  invariant(allowed.some(([s, n]) => range.start >= s && range.end <= s + n),
    `Unexpected diff vs healthy app at ${range.start}..${range.end}`);
const appFile = path.join(output, "framer-0.4.1-mqjs-id28-DIAG-module-app.bin");
await writeFile(appFile, repaired);
await copyFile(assetPaths.source, path.join(output, "weather-id28-gen19.js"));

const manifest = {
  format: "framer-f1-mquickjs-diag-module-build-v1",
  purpose: "Capture the JS exception text behind framer_mqjs_load = -5 and expose it over widget.mquickjs.diag4",
  hardwareTouched: false,
  instrumentation: {
    source: expected.engineSourceRelative,
    sha256: sha(await readFile(path.join(diagSource, "framer_mquickjs_canary.c"))),
    releaseEngineUntouched: "experiments/mquickjs-esp32s3-canary/framer_mquickjs_canary.c",
    change: "runtime_state gains char last_error[108]; classify_exception writes " +
      "\"<Error name>: <message> @<stack>\" (printable ASCII, bounded, NUL-terminated, " +
      "no libc); framer_mqjs_destroy preserves it across its teardown memset because " +
      "the resident owner destroys the runtime immediately after a failed load",
    residentBlockLayout: "unchanged - the buffer fits inside the fixed " +
      `${runtimeStorageBytes} B framer_mqjs_runtime storage ` +
      `(runtime_state ${engineProbe.sizeofRuntimeState}/${runtimeStorageBytes} B)`,
  },
  module: {
    abiVersion: 3, moduleAbiSha256: expected.moduleAbi,
    text: { file: path.relative(repository, textFile), paddr: hex(layout.textPaddr),
      vaddr: hex(layout.textVaddr), usedBytes: moduleSections[".text"].bytes,
      capacityBytes: layout.textBytes, sha256: sha(textPage) },
    rodata: { file: path.relative(repository, rodataFile), paddr: hex(layout.rodataPaddr),
      vaddr: hex(layout.rodataVaddr), usedBytes: moduleSections[".rodata"].bytes,
      capacityBytes: layout.rodataBytes, sha256: sha(rodataPage) },
    slot: { file: path.relative(repository, slotFile), bytes: slot.length,
      sha256: sha(slot),
      identitySemantics: "SHA-256 of padded text[0x20000] || padded rodata[0x10000]" },
    relocations: 0, undefinedSymbols: 0, writableStaticBytes: 0,
    residentBlockBytes: blockBytes,
    startupVaddr: hex(startupVaddr), id28IdentityVaddr: hex(id28IdentityVaddr),
    keySinkVaddr: hex(keySinkVaddr),
    stackUsageRecords: stackUsage.length,
    releaseComparison: {
      textSha256: expected.releaseTextSha256, rodataSha256: expected.releaseRodataSha256,
      slotSha256: expected.releaseSlotSha256,
      releaseStartupVaddr: hex(expected.releaseStartupVaddr),
      blockBytesUnchanged: blockBytes === expected.releaseBlockBytes,
    },
  },
  loader: { file: path.relative(repository, loaderFile), bytes: loaderRaw.length,
    sha256: sha(loaderRaw), cavityBytes, tailAddress: hex(tailAddress),
    keyWrapper: hex(keyWrapper) },
  app: { file: path.relative(repository, appFile), bytes: repaired.length,
    sha256: sha(repaired), offset: "0x10000",
    baseCandidateAppSha256: expected.candidateAppSha256,
    healthyAppSha256: expected.healthyAppSha256,
    segmentCount: after.segmentCount,
    diffVsHealthy: ["setup tail (3 B @0x42118cdd)", "key literal (4 B @0x42041568)",
      `loader cavity (${cavityBytes} B @0x4211e460)`, "image footer (33 B)"] },
  flashPlan: [
    { file: path.relative(repository, textFile), offset: hex(layout.textPaddr),
      bytes: textPage.length },
    { file: path.relative(repository, rodataFile), offset: hex(layout.rodataPaddr),
      bytes: rodataPage.length },
    { file: path.relative(repository, appFile), offset: "0x10000", bytes: repaired.length },
  ],
  rollback: { app: path.relative(repository, healthyApp),
    sha256: expected.healthyAppSha256, offset: "0x10000",
    note: "slot-A pages may be left in place; the healthy app never maps them" },
  rpc: {
    responseKey: "status",
    reader: "experiments/mquickjs-esp32s3-physical-canary/diag-read.mjs",
    note: "every value is re-rendered from live memory inside the RPC callback",
    methods: {
      "widget.mquickjs.diag": { format: "v1;g=;f0=;l0=;b=;f1=;l1=;m=;s=;r= (hex)" },
      "widget.mquickjs.diag2": { format: "v2;b=;y=;s=;t=;f=;k=;w=;u=;h=;g= (hex)" },
      "widget.mquickjs.diag3": { format: "v3;m=;c=;r=;a=;n=;e=;p=;l=;d=;v= (hex)" },
      "widget.mquickjs.diag4": {
        format: "v4;<runtime_state::last_error as printable ASCII, <=108 chars>",
        empty: "v4;empty means nothing recorded (no exception, or a release module)",
        noBlock: "v4;no-block means the resident block pointer was never published",
      },
    },
  },
  blockOffsets: { ...offsets, sizeofBlock: blockBytes,
    derivation: "xtensa offsetof probe compiled against the exact sources in this build" },
  assets: {
    customAssets: Boolean(customAssetsDir),
    embeddedVerbatimFrom: path.relative(repository, customAssetsDir ?? release),
    generation: expected.generation,
    f2jsSha256: assetSha.f2js, f2tfSha256: assetSha.f2tf,
    lzssSha256: assetSha.lzss, sourceSha256: assetSha.source,
    embeddedF2jsDigestSha256: assetSha.f2js,
    targetContractSha256: TARGET_FACADE_CONTRACT_SHA256,
    facade: { bytes: f2tf.length, maxBytes: expected.maxFacadeAssetBytes,
      paletteEntries: decodedFacade.palette.length, glyphRecords: decodedFacade.glyphs.size,
      maxOverlayWrites: decodedFacade.header.maxOverlayWrites,
      baseSha256: sha(baseFrameBytes),
      targets: decodedFacade.targets.map(({ id, format, x, y, width, height, scale }) =>
        ({ id, format, x, y, width, height, scale })) },
    base: { compressedBytes: lzss.length, inflatedBytes: baseFrameBytes.length },
    package: customPackage,
    releaseComparison: {
      f2jsSha256: expected.f2jsSha256, f2tfSha256: expected.f2tfSha256,
      lzssSha256: expected.lzssSha256, sourceSha256: expected.sourceSha256,
      identical: assetSha.f2js === expected.f2jsSha256 &&
        assetSha.f2tf === expected.f2tfSha256 && assetSha.lzss === expected.lzssSha256 &&
        assetSha.source === expected.sourceSha256,
    },
  },
};
await writeFile(path.join(output, "diag-module-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
  status: "PASS_DIAG_MODULE_BUILT_NO_HARDWARE",
  textSha256: manifest.module.text.sha256, rodataSha256: manifest.module.rodata.sha256,
  slotSha256: manifest.module.slot.sha256, appSha256: manifest.app.sha256,
  loaderBytes: loaderRaw.length, loaderSha256: manifest.loader.sha256,
  blockBytes, startupVaddr: hex(startupVaddr), keyWrapper: hex(keyWrapper),
  lastErrorOffset, customAssets: Boolean(customAssetsDir),
  assetSource: path.relative(repository, customAssetsDir ?? release),
  f2jsSha256: assetSha.f2js, f2tfSha256: assetSha.f2tf, lzssSha256: assetSha.lzss,
  out: output,
}, null, 2)}\n`);
