#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import { inspectEsp32AppImage } from "../../custom-firmware/lib/esp-app-image.mjs";

const execute = promisify(execFile);
const directory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(directory, "../..");
const canary = path.join(repository, "experiments/mquickjs-esp32s3-canary");
const vendor = path.join(canary, "vendor/mquickjs");
const outputDirectory = path.join(directory, "build");
const toolchain = process.env.FRAMER_XTENSA_BIN ??
  path.join(repository, ".toolchains/xtensa-esp-elf-13.2.0_20240530/bin");
const xtensa = (name) => path.join(toolchain, `xtensa-esp32s3-elf-${name}`);
const nativeCc = process.env.CC ?? "cc";
const run = async (command, args, options = {}) => execute(command, args, {
  maxBuffer: 64 * 1024 * 1024, ...options,
});
const invariant = (condition, message) => { if (!condition) throw new Error(message); };
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sha256Bytes = (bytes) => createHash("sha256").update(bytes).digest();
const hex = (value) => `0x${value.toString(16)}`;
const digestWordsLe = (digest) => Array.from({ length: 8 }, (_, index) =>
  digest.readUInt32LE(index * 4));
const digestWordsBe = (digest) => Array.from({ length: 8 }, (_, index) =>
  digest.readUInt32BE(index * 4));
const wordDefines = (prefix, words) => words.map((value, index) =>
  `-D${prefix}_W${index}=${hex(value)}u`);

const layout = Object.freeze({
  flashBytes: 0x1000000,
  factoryStart: 0x10000,
  factoryBytes: 0x800000,
  pageBytes: 0x10000,
  iromLinearReservedBytes: 0x120000,
  dromLinearReservedBytes: 0x0b0000,
  psramBytes: 0x200000,
  freeLinearStart: 0x3d0000,
  linearEnd: 0x2000000,
  textPaddr: 0x210000,
  textVaddr: 0x423d0000,
  textCapacity: 0x20000,
  rodataPaddr: 0x230000,
  rodataVaddr: 0x3c3f0000,
  rodataCapacity: 0x10000,
  slotAEnd: 0x240000,
  slotBStart: 0x240000,
  slotBEnd: 0x270000,
  loaderVaddr: 0x4211e460,
  loaderCapacity: 0x1ab8,
  mapAddress: 0x420f539c,
  mapEnd: 0x420f5772,
  mapSha256: "cbd61aaf9138bb59e94d50780ee4b5a53ec315cd347eee341e7f1514b07aeab5",
  unmapAddress: 0x420f5774,
  unmapEnd: 0x420f58a2,
  unmapSha256: "a397751ec73aacb36858a2ab98f72503d57e4d9fbb7ca03d7968e54e6ac62163",
});

const healthyAppPath = path.join(repository,
  "f1-widget-sdk/build/combined-renderer-v2-clock-blue-timer/" +
  "framer-0.4.1-music-id1-wpm-id7-renderer-id26-clock-id27-blue-timer-app.bin");
const healthyAppSha256 = "363170139a06f306be1e894b6f203a9bf03bf4d70d21194aaccdd1c42f760c32";
const healthyReceiptPath = path.join(repository,
  "f1-widget-sdk/build/device-receipts/device-1786939039376-fast-smoke.json");
const healthyReceiptSha256 = "1363d31eabba2b61e068d760d966ab25f8b17d1c635a4c91ba7ecd2a0de238e9";
const expectedCompilerIdentity =
  "xtensa-esp-elf-gcc (crosstool-NG esp-13.2.0_20240530) 13.2.0";
const expectedPackageAbiSha256 =
  "5091736403d809078cbbf12a1b593fbabaff53474a0935a7e00ce81dc8bd67f8";
const expectedCoreCanarySourceSha256 =
  "f634d62094e6c3d08f7d6cf1975edf9afa5b9f53799599014a9a2ac3d09e1c19";
const expectedCoreCanaryTargetRawSha256 =
  "74a4416f9ceced9e5f5785637dc839d010f0dde58856330ec747803c55e18c1c";

async function verifyHealthyBase() {
  const [app, receiptBytes, evidence] = await Promise.all([
    readFile(healthyAppPath), readFile(healthyReceiptPath),
    readFile(path.join(repository, "docs/03-evidence-and-findings.md"), "utf8"),
  ]);
  invariant(app.length === 2_062_912 && sha256(app) === healthyAppSha256,
    "Healthy blue clock/timer app pin changed.");
  invariant(sha256(receiptBytes) === healthyReceiptSha256,
    "Healthy physical-device receipt pin changed.");
  const receipt = JSON.parse(receiptBytes);
  invariant(receipt.app?.sha256 === healthyAppSha256 && receipt.app?.flashOffset === "0x10000" &&
    receipt.serialIdentity?.flashBytes === layout.flashBytes &&
    receipt.serialIdentity?.secureBoot === false && receipt.serialIdentity?.flashEncryption === false &&
    receipt.write?.hashVerifiedByEsptool === true && receipt.postBoot?.version === "0.4.1",
  "Healthy receipt no longer proves the exact app/device/write/boot tuple.");
  invariant(evidence.includes("| Embedded PSRAM | 2 MiB |"),
    "Physical 2 MiB PSRAM evidence changed.");

  const image = inspectEsp32AppImage(app);
  const irom = image.segments[3];
  const iram = image.segments[2];
  invariant(image.segmentCount === 6 && irom.loadAddress === 0x42000020 &&
    irom.length === 0x11fef8 && irom.loadAddress + irom.length === 0x4211ff18 &&
    image.segments[0].loadAddress === 0x3c120020 && image.segments[0].length === 0xb1170,
  "Healthy app segment layout changed.");
  invariant(iram.data.readUInt32LE(0x90c) === 0x42116d12 &&
    iram.data.readUInt32LE(0x910) === 0x42000020 &&
    iram.data.readUInt32LE(0x914) === 0x3c1c1190 &&
    iram.data.readUInt32LE(0x918) === 0x3c120020 &&
    irom.data.readUInt32LE(0xbdd18) === 0x3c1d0000 &&
    irom.data.readUInt32LE(0xbdd1c) === 0x3c1d0000,
  "Runtime rodata reservation or PSRAM start literals changed.");
  const readIrom = (start, end) => irom.data.subarray(start - irom.loadAddress,
    end - irom.loadAddress);
  invariant(sha256(readIrom(layout.mapAddress, layout.mapEnd)) === layout.mapSha256 &&
    sha256(readIrom(layout.unmapAddress, layout.unmapEnd)) === layout.unmapSha256,
  "Stock esp_mmu_map/unmap ABI bytes changed.");
  const loaderOffset = layout.loaderVaddr - irom.loadAddress;
  invariant(loaderOffset >= 0 && loaderOffset + layout.loaderCapacity === irom.length &&
    irom.data.subarray(loaderOffset).every((value) => value === 0),
  "Healthy screen module no longer has the exact 6,840-byte zero tail.");

  const factoryEnd = layout.factoryStart + layout.factoryBytes;
  const appFlashEnd = layout.factoryStart + app.length;
  invariant(appFlashEnd === 0x207a40 && appFlashEnd <= layout.textPaddr &&
    layout.slotBEnd <= factoryEnd && factoryEnd === 0x810000,
  "Module A/B slots escaped unused factory flash.");
  invariant(layout.iromLinearReservedBytes + layout.dromLinearReservedBytes === 0x1d0000 &&
    0x1d0000 + layout.psramBytes === layout.freeLinearStart &&
    layout.textVaddr === 0x42000000 + layout.freeLinearStart &&
    layout.rodataVaddr === 0x3c000000 + layout.freeLinearStart + layout.textCapacity,
  "Shared ESP32-S3 MMU linear-space arithmetic changed.");

  return { app, image, receipt, appFlashEnd, factoryEnd };
}

async function buildGenerator(buildDirectory) {
  const generator = path.join(buildDirectory, "framer-stdlib-gen");
  await run(nativeCc, ["-std=c11", "-O2", `-I${vendor}`,
    path.join(canary, "framer_stdlib_gen.c"), path.join(vendor, "mquickjs_build.c"),
    "-o", generator]);
  const atoms = (await run(generator, ["-a"])).stdout;
  const targetLibrary = (await run(generator, ["-m32"])).stdout;
  await Promise.all([
    writeFile(path.join(buildDirectory, "mquickjs_atom.h"), atoms),
    writeFile(path.join(buildDirectory, "framer_stdlib.h"), targetLibrary),
  ]);
  return { targetLibrarySha256: sha256(Buffer.from(targetLibrary)) };
}

const crossFlags = ["-std=c11", "-Os", "-DNDEBUG", "-mlongcalls",
  "-mtext-section-literals", "-ffunction-sections", "-fdata-sections",
  "-fno-unwind-tables", "-fno-asynchronous-unwind-tables"];

async function compile(buildDirectory, source, output, includes, extra = []) {
  await run(xtensa("gcc"), [...crossFlags, ...extra,
    ...includes.map((value) => `-I${value}`), "-c", source, "-o", output]);
}

async function inspectElf(elf, expected) {
  const [format, sections, relocations, undefinedSymbols, symbols, size] = await Promise.all([
    run(xtensa("objdump"), ["-f", elf]), run(xtensa("objdump"), ["-h", elf]),
    run(xtensa("readelf"), ["-r", elf]), run(xtensa("nm"), ["-u", elf]),
    run(xtensa("nm"), ["-S", elf]), run(xtensa("size"), [elf]),
  ]);
  invariant(/file format elf32-xtensa-le/u.test(format.stdout), "Output is not Xtensa LE.");
  invariant(/There are no relocations in this file\./u.test(relocations.stdout),
    "Final ELF retains relocations.");
  invariant(undefinedSymbols.stdout.trim() === "", "Final ELF retains undefined symbols.");
  const parsed = Object.fromEntries([...sections.stdout.matchAll(
    /^\s*\d+\s+(\.[^\s]+)\s+([0-9a-f]+)\s+([0-9a-f]+)\s+[0-9a-f]+\s+[0-9a-f]+\s+2\*\*\d+\s*$/gmu,
  )].map((match) => [match[1], {
    bytes: Number.parseInt(match[2], 16), vaddr: Number.parseInt(match[3], 16),
  }]));
  for (const [name, contract] of Object.entries(expected.sections)) {
    invariant(parsed[name]?.vaddr === contract.vaddr && parsed[name]?.bytes <= contract.capacity,
      `${name} placement/capacity changed: ${JSON.stringify(parsed[name])}.`);
  }
  for (const forbidden of expected.forbidden)
    invariant((parsed[forbidden]?.bytes ?? 0) === 0, `Forbidden section is nonempty: ${forbidden}.`);
  return { format: format.stdout.trim(), sections: parsed, symbols: symbols.stdout,
    size: size.stdout.trim(), relocations: 0, undefinedSymbols: 0 };
}

async function buildModulePass(buildDirectory, pass, abiWords) {
  const prefix = path.join(buildDirectory, `module-${pass}`);
  const objects = {
    runtime: `${prefix}-runtime.o`, adapter: `${prefix}-adapter.o`, dtoa: `${prefix}-dtoa.o`,
    libm: `${prefix}-libm.o`, cutils: `${prefix}-cutils.o`,
  };
  const includes = [buildDirectory, canary, vendor];
  await compile(buildDirectory, path.join(canary, "framer_mquickjs_canary.c"),
    objects.runtime, includes);
  await compile(buildDirectory, path.join(directory, "module_adapter.c"), objects.adapter, includes,
    wordDefines("FRAMER_MQJS_ABI_SHA256", abiWords));
  await compile(buildDirectory, path.join(vendor, "dtoa.c"), objects.dtoa, includes);
  await compile(buildDirectory, path.join(vendor, "libm.c"), objects.libm, includes,
    ["-UNDEBUG"]);
  await compile(buildDirectory, path.join(vendor, "cutils.c"), objects.cutils, includes);
  const elf = `${prefix}.elf`;
  const map = `${prefix}.map`;
  await run(xtensa("gcc"), ["-nostartfiles", "-specs=nosys.specs", "-Wl,--gc-sections",
    `-Wl,-T,${path.join(directory, "module.ld")}`, `-Wl,-Map,${map}`, "-o", elf,
    objects.runtime, objects.adapter, objects.dtoa, objects.libm, objects.cutils, "-lm"]);
  const text = `${prefix}-text.bin`;
  const rodata = `${prefix}-rodata.bin`;
  await run(xtensa("objcopy"), ["-O", "binary", "-j", ".text", "--gap-fill=0x00",
    `--pad-to=${hex(layout.textVaddr + layout.textCapacity)}`, elf, text]);
  await run(xtensa("objcopy"), ["-O", "binary", "-j", ".rodata", "--gap-fill=0x00",
    `--pad-to=${hex(layout.rodataVaddr + layout.rodataCapacity)}`, elf, rodata]);
  const inspection = await inspectElf(elf, {
    sections: { ".text": { vaddr: layout.textVaddr, capacity: layout.textCapacity },
      ".rodata": { vaddr: layout.rodataVaddr, capacity: layout.rodataCapacity } },
    forbidden: [".data", ".bss", ".forbidden_data"],
  });
  const [textBytes, rodataBytes] = await Promise.all([readFile(text), readFile(rodata)]);
  invariant(textBytes.length === layout.textCapacity && rodataBytes.length === layout.rodataCapacity,
    "Fixed page extraction length changed.");
  invariant(textBytes.subarray(inspection.sections[".text"].bytes)
    .every((value) => value === 0) &&
    rodataBytes.subarray(inspection.sections[".rodata"].bytes)
      .every((value) => value === 0),
  "Module page prefetch/guard tail is not all zero.");
  invariant(!/\b(?:canary_heap|canary_runtime|malloc|calloc|realloc|free|_sbrk)\b/u
    .test(inspection.symbols), "Module gained caller storage or a system allocator symbol.");
  invariant(new RegExp(`^${layout.rodataVaddr.toString(16)}\\s+.+framer_mqjs_module$`, "mu")
    .test(inspection.symbols), "Module descriptor is not first in the DROM page.");
  for (const symbol of ["framer_mqjs_module_probe", "framer_mqjs_init", "framer_mqjs_load",
    "framer_mqjs_dispatch", "framer_mqjs_input_enqueue",
    "framer_mqjs_input_request_release_all", "framer_mqjs_input_drain",
    "framer_mqjs_input_get_observation", "framer_mqjs_get_telemetry",
    "framer_mqjs_get_last_good_slots", "framer_mqjs_destroy"]) {
    invariant(new RegExp(`^[0-9a-f]+\\s+[0-9a-f]+\\s+T\\s+${symbol}$`, "mu")
      .test(inspection.symbols), `Module public ABI export is absent: ${symbol}.`);
  }
  return { elf, map, text, rodata, textBytes, rodataBytes, inspection };
}

async function buildLoaderPass(buildDirectory, pass, module, runtimeStorageBytes,
  minimumHeapBytes, abiWords) {
  const prefix = path.join(buildDirectory, `loader-${pass}`);
  const object = `${prefix}.o`;
  const textDigest = sha256Bytes(module.textBytes);
  const rodataDigest = sha256Bytes(module.rodataBytes);
  await compile(buildDirectory, path.join(directory, "resident_loader_canary.c"), object,
    [directory], ["-fno-jump-tables", "-fno-builtin", "-fno-tree-loop-distribute-patterns",
      `-DFRAMER_MODULE_RUNTIME_STORAGE_BYTES=${runtimeStorageBytes}u`,
      `-DFRAMER_MODULE_MIN_HEAP_BYTES=${minimumHeapBytes}u`,
      `-DFRAMER_MODULE_TEXT_USED_BYTES=${module.inspection.sections[".text"].bytes}u`,
      ...wordDefines("FRAMER_MODULE_TEXT_SHA256", digestWordsBe(textDigest)),
      ...wordDefines("FRAMER_MODULE_RODATA_SHA256", digestWordsBe(rodataDigest)),
      ...wordDefines("FRAMER_MQJS_ABI_SHA256", abiWords)]);
  const elf = `${prefix}.elf`;
  const map = `${prefix}.map`;
  await run(xtensa("gcc"), ["-nostdlib", "-Wl,--gc-sections",
    `-Wl,-T,${path.join(directory, "resident_loader.ld")}`, `-Wl,-Map,${map}`,
    "-o", elf, object, "-lgcc"]);
  const raw = `${prefix}.bin`;
  const disassembly = `${prefix}-disassembly.txt`;
  await run(xtensa("objcopy"), ["-O", "binary", "-j", ".text", elf, raw]);
  const disassembled = await run(xtensa("objdump"), ["-dr", elf]);
  await writeFile(disassembly, disassembled.stdout);
  const inspection = await inspectElf(elf, {
    sections: { ".text": { vaddr: layout.loaderVaddr, capacity: layout.loaderCapacity } },
    forbidden: [".rodata", ".data", ".bss", ".forbidden_storage"],
  });
  invariant(new RegExp(`^${layout.mapAddress.toString(16)}\\s+A\\s+esp_mmu_map$`, "mu")
    .test(inspection.symbols) &&
    new RegExp(`^${layout.unmapAddress.toString(16)}\\s+A\\s+esp_mmu_unmap$`, "mu")
      .test(inspection.symbols), "Loader no longer resolves the pinned stock MMU ABI.");
  const rawBytes = await readFile(raw);
  invariant(rawBytes.length > 0 && rawBytes.length <= layout.loaderCapacity,
    "Resident loader escaped the healthy app cavity tail.");
  return { elf, map, raw, disassembly, rawBytes, inspection, textDigest, rodataDigest };
}

async function runResidentShaKat(buildDirectory, module, runtimeStorageBytes,
  minimumHeapBytes, abiWords) {
  const executable = path.join(buildDirectory, "resident-sha256-kat");
  const textDigest = sha256Bytes(module.textBytes);
  const rodataDigest = sha256Bytes(module.rodataBytes);
  await run(nativeCc, ["-std=c11", "-O2", `-I${directory}`,
    `-DFRAMER_MODULE_RUNTIME_STORAGE_BYTES=${runtimeStorageBytes}u`,
    `-DFRAMER_MODULE_MIN_HEAP_BYTES=${minimumHeapBytes}u`,
    `-DFRAMER_MODULE_TEXT_USED_BYTES=${module.inspection.sections[".text"].bytes}u`,
    ...wordDefines("FRAMER_MODULE_TEXT_SHA256", digestWordsBe(textDigest)),
    ...wordDefines("FRAMER_MODULE_RODATA_SHA256", digestWordsBe(rodataDigest)),
    ...wordDefines("FRAMER_MQJS_ABI_SHA256", abiWords),
    path.join(directory, "resident_sha256_harness.c"), "-o", executable]);
  const result = await run(executable, [module.text, module.rodata]);
  invariant(result.stdout.trim() ===
    "resident SHA-256 KAT/pages/tamper + unmap fail-close: PASS",
    "Resident SHA-256 native KAT did not pass exactly.");
  return result.stdout.trim();
}

async function publishArtifacts(module, loader, manifest) {
  await mkdir(outputDirectory, { recursive: true });
  const copies = [
    [module.elf, "mquickjs-module.elf"], [module.map, "mquickjs-module.map"],
    [module.text, "mquickjs-module-text-page.bin"],
    [module.rodata, "mquickjs-module-rodata-page.bin"],
    [loader.elf, "resident-loader.elf"], [loader.map, "resident-loader.map"],
    [loader.raw, "resident-loader.bin"],
    [loader.disassembly, "resident-loader-disassembly.txt"],
  ];
  await Promise.all(copies.map(([source, name]) => copyFile(source, path.join(outputDirectory, name))));
  await writeFile(path.join(outputDirectory, "module-slot-a.bin"),
    Buffer.concat([module.textBytes, module.rodataBytes]));
  await writeFile(path.join(outputDirectory, "module-loader-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`);
}

const temp = await mkdtemp(path.join(os.tmpdir(), "framer-mqjs-module-loader-"));
try {
  const base = await verifyHealthyBase();
  const compilerVersion = (await run(xtensa("gcc"), ["--version"])).stdout.trim();
  invariant(compilerVersion.split("\n")[0] === expectedCompilerIdentity,
    "Fixed-vaddr module compiler identity changed.");
  const sdkContractPath = path.join(repository, "f1-widget-sdk/src/render-v2/mquickjs.mjs");
  const sdkContract = await import(pathToFileURL(sdkContractPath).href);
  invariant(sdkContract.RENDER_V2_MQUICKJS_PACKAGE_ABI_SHA256 ===
    expectedPackageAbiSha256 && sdkContract.RENDER_V2_MQUICKJS_PROFILE?.abiVersion === 1 &&
    sdkContract.RENDER_V2_MQUICKJS_LIMITS?.sourceBytes === 8192 &&
    sdkContract.RENDER_V2_MQUICKJS_LIMITS?.heapBytes === 65536 &&
    sdkContract.RENDER_V2_MQUICKJS_LIMITS?.callbackDeadlineUs === 2000 &&
    sdkContract.RENDER_V2_MQUICKJS_LIMITS?.keys === 16 &&
    sdkContract.RENDER_V2_MQUICKJS_LIMITS?.chords === 8 &&
    sdkContract.RENDER_V2_MQUICKJS_SOURCE_PREFIX === `"use strict";\n`,
  "SDK F2JS package ABI/profile changed.");
  const canarySourceNames = ["framer_stdlib_gen.c", "framer_mquickjs_canary.h",
    "framer_mquickjs_canary.c", "host_harness.c", "xtensa_link_canary.c"];
  const [header, upstreamBytes, adapterBytes, canarySourceBytes] = await Promise.all([
    readFile(path.join(canary, "framer_mquickjs_canary.h"), "utf8"),
    readFile(path.join(canary, "UPSTREAM.json")),
    readFile(path.join(directory, "module_adapter.c")),
    Promise.all(canarySourceNames.map((name) => readFile(path.join(canary, name)))),
  ]);
  const coreCanarySourceSha256 = sha256(Buffer.concat(canarySourceBytes));
  invariant(coreCanarySourceSha256 === expectedCoreCanarySourceSha256,
    "Frozen core canary source digest changed.");
  const runtimeMatch = /^#define FRAMER_MQJS_RUNTIME_STORAGE_BYTES\s+(\d+)u$/mu.exec(header);
  const minimumHeapMatch = /^#define FRAMER_MQJS_MIN_HEAP_BYTES\s+(\d+)u$/mu.exec(header);
  invariant(runtimeMatch, "Could not read the current MicroQuickJS runtime storage ABI.");
  invariant(minimumHeapMatch, "Could not read the current MicroQuickJS heap ABI.");
  const runtimeStorageBytes = Number(runtimeMatch[1]);
  const minimumHeapBytes = Number(minimumHeapMatch[1]);
  const numericHeaderConstant = (name) => {
    const match = new RegExp(`^#define ${name}\\s+(\\d+)u$`, "mu").exec(header);
    invariant(match, `Could not read frozen input ABI constant ${name}.`);
    return Number(match[1]);
  };
  const inputContract = {
    queueRecords: numericHeaderConstant("FRAMER_MQJS_INPUT_QUEUE_RECORDS"),
    consumedRecordsPerBatch: numericHeaderConstant("FRAMER_MQJS_INPUT_DRAIN_RECORDS"),
    coalescedHoldsPerBatch: numericHeaderConstant("FRAMER_MQJS_INPUT_DRAIN_HOLDS"),
    pendingEventCapacity: numericHeaderConstant("FRAMER_MQJS_INPUT_PENDING_EVENTS"),
    maxEventAttemptsPerOwnerCall:
      numericHeaderConstant("FRAMER_MQJS_INPUT_CALLBACKS_PER_ITERATION"),
    maxResyncEvents: numericHeaderConstant("FRAMER_MQJS_INPUT_MAX_RESYNC_EVENTS"),
    maxLogicalEventsPerBatch: 3 * (16 + 4) + 2,
  };
  invariant(runtimeStorageBytes === 4096 && minimumHeapBytes === 65536 &&
    JSON.stringify(inputContract) === JSON.stringify({ queueRecords: 32,
      consumedRecordsPerBatch: 4, coalescedHoldsPerBatch: 2,
      pendingEventCapacity: 64, maxEventAttemptsPerOwnerCall: 3,
      maxResyncEvents: 18, maxLogicalEventsPerBatch: 62 }),
  "Frozen runtime/input bounds changed.");
  const generated = await buildGenerator(temp);
  const upstream = JSON.parse(upstreamBytes);
  const abiDigest = sha256Bytes(Buffer.concat([
    Buffer.from("framer-mqjs-module-public-abi-v3\0"), Buffer.from(header),
    Buffer.from(`\0${upstream.commit}\0${generated.targetLibrarySha256}\0`), adapterBytes,
    Buffer.from(`\0framer-f2js-package-abi-v1\0${expectedPackageAbiSha256}\0`),
  ]));
  const abiWords = digestWordsLe(abiDigest);
  const [first, second] = await Promise.all([
    buildModulePass(temp, 0, abiWords), buildModulePass(temp, 1, abiWords),
  ]);
  invariant(first.textBytes.equals(second.textBytes) &&
    first.rodataBytes.equals(second.rodataBytes), "Fixed-vaddr module build is nondeterministic.");
  const descriptor = first.rodataBytes;
  invariant(descriptor.readUInt32LE(0) === 0x534a514d &&
    descriptor.readUInt16LE(4) === 3 && descriptor.readUInt16LE(6) === 116 &&
    descriptor.readUInt32LE(8) === layout.textVaddr &&
    descriptor.readUInt32LE(12) === layout.textCapacity &&
    descriptor.readUInt32LE(16) === layout.rodataVaddr &&
    descriptor.readUInt32LE(20) === layout.rodataCapacity &&
    descriptor.readUInt32LE(24) === minimumHeapBytes &&
    descriptor.readUInt32LE(28) === runtimeStorageBytes &&
    descriptor.readUInt32LE(32) === 16 &&
    descriptor.subarray(36, 68).equals(abiDigest),
  "Mapped module descriptor fields, size, or public ABI digest changed.");
  const textUsedForDescriptor = first.inspection.sections[".text"].bytes;
  for (let offset = 68; offset < 116; offset += 4) {
    const pointer = descriptor.readUInt32LE(offset);
    invariant(pointer >= layout.textVaddr &&
      pointer < layout.textVaddr + textUsedForDescriptor && (pointer & 3) === 0,
    `Mapped module descriptor function pointer is out of used text: ${hex(pointer)}.`);
  }
  const [firstLoader, secondLoader] = await Promise.all([
    buildLoaderPass(temp, 0, first, runtimeStorageBytes, minimumHeapBytes, abiWords),
    buildLoaderPass(temp, 1, second, runtimeStorageBytes, minimumHeapBytes, abiWords),
  ]);
  invariant(firstLoader.rawBytes.equals(secondLoader.rawBytes),
    "Resident loader build is nondeterministic.");
  const residentShaKat = await runResidentShaKat(temp, first, runtimeStorageBytes,
    minimumHeapBytes, abiWords);

  const textUsed = first.inspection.sections[".text"].bytes;
  const rodataUsed = first.inspection.sections[".rodata"].bytes;
  const loaderUsed = firstLoader.inspection.sections[".text"].bytes;
  const manifest = {
    format: "framer-f1-mquickjs-fixed-mmap-canary-v1",
    status: "PASS_STATIC_MODULE_LOADER_FEASIBILITY",
    hardwareRuntimeProven: false,
    flashed: false,
    healthyBase: {
      app: { file: healthyAppPath, bytes: base.app.length, sha256: healthyAppSha256,
        flashOffset: hex(layout.factoryStart), flashEnd: hex(base.appFlashEnd) },
      receipt: { file: healthyReceiptPath, sha256: healthyReceiptSha256 },
      preservedScreens: [26, 27], loaderInsertion: { vaddr: hex(layout.loaderVaddr),
        capacityBytes: layout.loaderCapacity, acceptedTailWasAllZero: true },
    },
    companionCoreCanary: {
      sourceSha256: coreCanarySourceSha256,
      targetRawSha256: expectedCoreCanaryTargetRawSha256,
      runtimeStorageBytes,
      minimumHeapBytes,
      maxEventAttemptsPerOwnerCall: inputContract.maxEventAttemptsPerOwnerCall,
      worstFailureRecoverySliceUs: 8000,
    },
    mmu: {
      pageBytes: layout.pageBytes, sharedLinearRange: ["0x00000000", "0x02000000"],
      iromReserved: ["0x00000000", hex(layout.iromLinearReservedBytes)],
      dromReservationBytes: layout.dromLinearReservedBytes,
      psram: { bytes: layout.psramBytes, linearRange: ["0x001d0000", "0x003d0000"] },
      freeBeforeModule: { linearRange: [hex(layout.freeLinearStart), hex(layout.linearEnd)],
        bytes: layout.linearEnd - layout.freeLinearStart },
      freeAfterModule: { linearRange: ["0x00400000", hex(layout.linearEnd)],
        bytes: layout.linearEnd - 0x400000 },
      callOrder: [
        "serialized one-shot startup; no concurrent esp_mmu_map caller",
        "temporary DATA|8BIT(0x12) map 128 KiB text; require 0x3c3d0000; full-page SHA-256; unmap",
        "temporary DATA|8BIT(0x12) map 64 KiB rodata; require 0x3c3d0000; full-page SHA-256; unmap",
        "EXEC|32BIT(0x09) map text first; require 0x423d0000",
        "READ|8BIT(0x12) map rodata second; require 0x3c3f0000",
      ],
      stockAbi: {
        espMmuMap: { address: hex(layout.mapAddress), bytes: layout.mapEnd - layout.mapAddress,
          sha256: layout.mapSha256,
          signature: "esp_err_t(uint32_t,size_t,mmu_target_t,mmu_mem_caps_t,int,void**)" },
        espMmuUnmap: { address: hex(layout.unmapAddress),
          bytes: layout.unmapEnd - layout.unmapAddress, sha256: layout.unmapSha256,
          signature: "esp_err_t(void*)" },
        source: "ESP-IDF v5.3.2 components/esp_mm/esp_mmu_map.c",
        sourceCommit: "6920def9f050fe55df29954a2e8a41350b76b1d2",
        threadSafety: "not-thread-safe; map once during controlled startup before VM task launch",
      },
      runtimeReservationPins: {
        iramSegmentOffsets: { instructionReservedEnd: "0x90c=0x42116d12",
          instructionReservedStart: "0x910=0x42000020",
          rodataReservedEnd: "0x914=0x3c1c1190",
          rodataReservedStart: "0x918=0x3c120020" },
        iromPsramStartOffsets: ["0xbdd18=0x3c1d0000", "0xbdd1c=0x3c1d0000"],
      },
    },
    factoryFlash: {
      bytes: layout.factoryBytes, range: [hex(layout.factoryStart), hex(base.factoryEnd)],
      slotA: { range: [hex(layout.textPaddr), hex(layout.slotAEnd)], bytes: 0x30000 },
      slotB: { range: [hex(layout.slotBStart), hex(layout.slotBEnd)], bytes: 0x30000 },
      unusedGapBeforeSlotABytes: layout.textPaddr - base.appFlashEnd,
      headroomAfterSlotBBytes: base.factoryEnd - layout.slotBEnd,
    },
    module: {
      format: "elf32-xtensa-le", deterministicBuilds: 2,
      runtimeStorageBytes, minimumHeapBytes, externalWritableStorageOnly: true,
      publicAbi: { version: 3, sha256: abiDigest.toString("hex"),
        wordEncoding: "digest bytes stored unchanged as eight little-endian u32 words",
        upstreamCommit: upstream.commit,
        generatedStdlibSha256: generated.targetLibrarySha256,
        sdkPackageAbi: { version: 1, sha256: expectedPackageAbiSha256,
          source: "f1-widget-sdk/src/render-v2/mquickjs.mjs" },
        exports: ["probe", "init", "load", "dispatch", "input_enqueue",
          "input_request_release_all", "input_request_focus_release", "input_drain",
          "input_get_observation",
          "get_telemetry", "get_last_good_slots", "destroy"] },
      text: { paddr: hex(layout.textPaddr), vaddr: hex(layout.textVaddr),
        usedBytes: textUsed, capacityBytes: layout.textCapacity,
        prefetchGuardBytes: layout.textCapacity - textUsed, guardFill: "zero",
        paddedSha256: sha256(first.textBytes), residentSha256Admission: true },
      rodata: { paddr: hex(layout.rodataPaddr), vaddr: hex(layout.rodataVaddr),
        usedBytes: rodataUsed, capacityBytes: layout.rodataCapacity,
        guardBytes: layout.rodataCapacity - rodataUsed, guardFill: "zero",
        paddedSha256: sha256(first.rodataBytes), residentSha256Admission: true },
      relocations: 0, undefinedSymbols: 0, dataBytes: 0, bssBytes: 0,
    },
    residentLoader: {
      vaddr: hex(layout.loaderVaddr), usedBytes: loaderUsed,
      capacityBytes: layout.loaderCapacity, remainingBridgeBytes: layout.loaderCapacity - loaderUsed,
      sha256: sha256(firstLoader.rawBytes), relocations: 0, undefinedSymbols: 0,
      rodataBytes: 0, dataBytes: 0, bssBytes: 0,
      integrity: "resident SHA-256 of both complete padded mappings plus host SHA-256/esptool readback",
      integrityScope: "fail-closed byte identity relative to the pinned loader-enabled app; not publisher authenticity or resistance to an attacker who can rewrite app flash (secure boot and flash encryption are off)",
      sha256Kat: residentShaKat,
      capabilityGate: "do not advertise mquickjs until map, descriptor, probe, VM init, and task/mailbox startup all succeed",
      teardown: "unmap returns failure; caller records telemetry and disables the capability",
    },
    buildToolchain: {
      compiler: xtensa("gcc"),
      compilerOverride: Object.hasOwn(process.env, "FRAMER_XTENSA_BIN"),
      identity: compilerVersion.split("\n")[0],
      expectedIdentity: expectedCompilerIdentity,
    },
    runtimeArchitectureRequiredForHardwareCanary: {
      vmTask: "dedicated 12,288-byte internal fixed stack; sole engine/runtime owner",
      eventIngress: "bounded producer queue; no parser/GC on LVGL callback stack",
      inputDrainBounds: { ...inputContract,
        maxJsCallbacksPerOwnerCall: 3, maxFailedCallbacksPerOwnerCall: 1,
        maxRecoveriesPerOwnerCall: 1, stopOnFirstCallbackFailure: true,
        successfulCallbackSliceUs: 6000, worstFailureRecoverySliceUs: 8000,
        yieldOnMorePendingRequired: true },
      apply: "72-byte single-writer seqlock target: atomic u32 sequence + 16 int32 slots + u32 admitted revision",
      uiTick: "consume latest complete mailbox revision and apply through existing F2EP bindings",
      source: "8,192 UTF-8 bytes plus readable NUL, caller-owned and immutable; exact required prefix is \"use strict\";\\n",
      runtimeStorage: `${runtimeStorageBytes.toLocaleString("en-US")} bytes, caller-owned, 8-byte aligned`,
      heap: "65,536-byte fixed caller allocation, prefer PSRAM; never access while flash cache is disabled",
      deadlineUs: 2000,
      recovery: "retain last-good state; first callback failure stops the owner call after one bounded recovery, leaves later FIFO snapshots queued, and requires a scheduler yield before retry; watchdog remains armed",
      mappingSerialization: "map before VM allocation/task start; stop/quiesce/destroy task before unmap or flash update",
      stockMapAllocationGate: "measure/reserve internal heap before first map and log pre/post free/largest block; ESP-IDF v5.3.2 first-map allocation failure may leave TAILQ state unsafe, so disable capability and reboot/rollback without an in-boot retry on any map allocation failure",
    },
    integrationGapsBlockingPhysicalRuntimeProof: [
      "resident F2JS parser/integrity+profile admission adapter for SDK package ABI v1: exact raw-byte F2JS/F1WB/F1RA magic; high-bit target-ID rejection before text conversion; canonical UTF-8 one-slot F1WB name; zero slot-name padding [104+nameLength,120); bounds, resealed hashes, and profile checks; package SHA alone is not authenticity",
      "real resident trampoline/startup bridge re-link at accepted chain tail 0x42118cdd after preserved ID26/27 registration",
      "exact stock heap_caps/static-task/key-hook ABIs and lifecycle bridge",
      "measured internal-heap reserve for esp_mmu_map metadata plus pre/post telemetry and no-retry reboot policy on map allocation failure",
      "linked/tested 72-byte mailbox consumer into existing F2EP renderer",
      "physical PSRAM heap, 12 KiB stack high-water, 2 ms deadline, OOM/timeout recovery and soak receipts",
    ],
    packaging: {
      currentArtifactSelects: "slot A via compile-time paddr 0x210000; slot B use requires a deterministic resident-loader relink and a new loader-enabled app SHA",
      selectorPolicy: "no mutable/dynamic slot selector in the resident loader; paddr and both full-page digests are compile-time pins",
      update: ["write and readback-verify inactive 192 KiB module slot",
        "relink the resident loader if the selected slot paddr changes",
        "write loader-enabled app last", "reboot and require exact capability/SHA receipt"],
      rollback: ["write healthy 36317013 app first so no module is referenced",
        "module slots may then be left inert or erased independently"],
      partialWritePolicy: "never select a slot until both padded pages match the pinned digests",
    },
  };
  await publishArtifacts(first, firstLoader, manifest);
  console.log(JSON.stringify({
    status: manifest.status, module: manifest.module, residentLoader: manifest.residentLoader,
    mmu: { freeBeforeModule: manifest.mmu.freeBeforeModule,
      freeAfterModule: manifest.mmu.freeAfterModule, callOrder: manifest.mmu.callOrder },
    factoryFlash: manifest.factoryFlash,
    artifacts: { directory: outputDirectory,
      manifest: path.join(outputDirectory, "module-loader-manifest.json") },
    hardwareRuntimeProven: false, flashed: false,
  }, null, 2));
} finally {
  await rm(temp, { recursive: true, force: true });
}
