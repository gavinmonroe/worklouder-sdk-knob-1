#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  decodeRenderV2MQuickJsPackage,
  RENDER_V2_MQUICKJS_ENGINE_COMMIT,
  RENDER_V2_MQUICKJS_LIMITS,
  RENDER_V2_MQUICKJS_PACKAGE_ABI_SHA256,
  RENDER_V2_MQUICKJS_PACKAGE_FORMAT,
  RENDER_V2_MQUICKJS_PROFILE_ID,
  RENDER_V2_MQUICKJS_SOURCE_PREFIX,
} from "../../f1-widget-sdk/src/render-v2/index.mjs";

const execute = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const output = path.join(here, "build");
const engineDirectory = path.join(root, "experiments/mquickjs-esp32s3-canary");
const loaderDirectory = path.join(root, "experiments/mquickjs-esp32s3-module-loader");
const residentDirectory = path.join(root, "experiments/mquickjs-esp32s3-resident-integration");
const stockDirectory = path.join(root, "experiments/mquickjs-esp32s3-stock-bridge");
const targetDirectory = path.join(root, "experiments/mquickjs-target-facade");
const keyDirectory = path.join(root, "f1-widget-sdk/examples/render-v2-mquickjs-canary");
const weatherDirectory = path.join(root,
  "f1-widget-sdk/examples/render-v2-mquickjs-weather-canary");

const EXPECTED_WEATHER = Object.freeze({
  manifestSha256: "62a580eb3273e840764c285d6c899b60a3dbfe03a3ebdc8c0a387e906abbf2bb",
  generation: 18,
  packageSha256: "88537026c8b217b763c393b82d8787ca08256681265976f7bcff6077b2282d20",
  sourceSha256: "68db9d61fa38b0a396e46e88076d75d262a486f2ec4b41b4d398454d7d713e9b",
  sourceBytes: 5_667,
  normalHeapHighWaterBytes: 61_496,
  heapHeadroomBytes: 4_040,
});
const EXPECTED_KEY = Object.freeze({
  manifestSha256: "f7b1f026167cd18d9184bebd5d60069ac518d539047fd319e6ae9e78007b9cd2",
  packageSha256: "68a53cd4300cdfe5f8c22071f0488046f6e21a11ee9054e162bfd74b0ae8fdb9",
});
const EXPECTED_LOADER = Object.freeze({
  manifestSha256: "5839a2625014cddf6b05822236027e702cc14d8e4c40a02c5f9103ecca09c0f1",
  publicAbiSha256: "105640d38d427fddae0617dbc3bcc7fdd00ba750d27c1edc156a1aea454b8948",
});
const EXPECTED_RESIDENT = Object.freeze({
  format: "framer-mquickjs-resident-integration-static-proof-v3",
  manifestSha256: "5b084c3a1c3959f547fb65a2f3698627a7167ed084bf7b1d4507bc6045660445",
  coreSha256: "5cbe985192134c17ec211d8848907dd6d8b78a98d5b2d0e469f60a2ce768e5f4",
  coreBytes: 53_436,
});
const EXPECTED_TARGET = Object.freeze({
  manifestSha256: "d38a5dee4417e9387e6bfe5b2e2aff5f4520173e8dc50b859dc1bf42987cebe8",
  assetSha256: "d9e2ce701755423dc9d843eace93f51f982d1f5cb7c231c6fb9a5f1f1dc9bc94",
  assetBytes: 1_375,
  baseSha256: "2f8263490c50631c3cdb7f992efde976ac794d8a3e599cc785a1e81bfa0e5c68",
  casesSha256: "2de18b1208df8beb7d0b3e00a4081318199625296090d97d5f9618306acc1a9b",
  casesBytes: 800,
  contractSha256: "8220152a09348da34cdd70dd7d370197f2f3fc46a9f45e50d7fb7015bdb8579a",
  objectSha256: "8f66f46205a687a6339dfa6c6b1f604b5bc0deeefd0d273e1bcb48b40e380978",
  objectBytes: 24_840,
  textBytes: 5_289,
  rodataBytes: 90,
  pixelExactCases: 11,
});
const EXPECTED_STOCK = Object.freeze({
  manifestSha256: "0afdc47b8009010fb59ad1308353945a15fa7f9d4e8812354701bea747b64e28",
  coreSha256: "0406f9e8341f79d5f6cc602460c1bf405508c5aff4a4be5fa97244beacc4c676",
  coreBytes: 16_956,
  textBytes: 1_836,
  tailPatchBytes: "c6df15",
  unresolved: Object.freeze([
    "framer_stock_bridge_resident_abort",
    "framer_stock_bridge_resident_boot",
    "framer_stock_bridge_resident_state",
  ]),
});

const invariant = (condition, message) => {
  if (!condition) throw new Error(message);
};
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const relative = (file) => path.relative(root, file);
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
const manifestIdentity = async (file) => {
  const bytes = await readFile(file);
  return Object.freeze({ file: relative(file), bytes: bytes.length, sha256: sha256(bytes) });
};
const verifyFile = async (file, expectedSha256, expectedBytes = null) => {
  const bytes = await readFile(file);
  invariant(expectedBytes == null || bytes.length === expectedBytes,
    `${relative(file)} length changed.`);
  invariant(sha256(bytes) === expectedSha256, `${relative(file)} SHA-256 changed.`);
  return bytes;
};
const sha256Files = async (files) => {
  const digest = createHash("sha256");
  for (const file of files) digest.update(await readFile(file));
  return digest.digest("hex");
};
const runJson = async (file) => {
  const { stdout } = await execute(process.execPath, [file], { cwd: root,
    maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(stdout.trim());
};

const loaderManifestFile = path.join(loaderDirectory, "build/module-loader-manifest.json");
const residentManifestFile = path.join(residentDirectory,
  "build/resident-integration-manifest.json");
const stockManifestFile = path.join(stockDirectory, "build/stock-bridge-manifest.json");
const targetManifestFile = path.join(targetDirectory, "build/manifest.json");
const keyManifestFile = path.join(keyDirectory, "build/manifest.json");
const weatherManifestFile = path.join(weatherDirectory, "build/manifest.json");

const [engine, targetVerifier, loader, resident, stock, key, weather] = await Promise.all([
  runJson(path.join(engineDirectory, "verify.mjs")),
  runJson(path.join(targetDirectory, "verify.mjs")),
  readJson(loaderManifestFile),
  readJson(residentManifestFile),
  readJson(stockManifestFile),
  readJson(keyManifestFile),
  readJson(weatherManifestFile),
]);
const target = await readJson(targetManifestFile);

invariant(engine.status === "PASS_MQUICKJS_HOST_AND_XTENSA_STATIC_CANARY" &&
  engine.hardwareRuntimeProven === false && engine.flashed === false,
"Engine verifier must remain a hardware-free static pass.");
invariant(engine.upstream.commit === RENDER_V2_MQUICKJS_ENGINE_COMMIT &&
  engine.contracts.packageAbiSha256 === RENDER_V2_MQUICKJS_PACKAGE_ABI_SHA256,
"Engine verifier and public SDK no longer share one engine/package ABI.");
invariant(engine.target.fixedHeapBytes === RENDER_V2_MQUICKJS_LIMITS.heapBytes &&
  engine.target.runtimeStorageBytes === 4_096 &&
  engine.contracts.input.maxJsCallbacksPerOwnerCall === 3,
"Engine resource or owner-drain contract changed.");
invariant(engine.host.movingGcAsan === "PASS" && engine.host.timeouts > 0 &&
  engine.host.oom > 0 && engine.host.keyDown > 0 && engine.host.chordDown > 0,
"Engine proof lost moving-GC, failure, key, or chord coverage.");
invariant(await sha256Files([
  "framer_stdlib_gen.c", "framer_mquickjs_canary.h", "framer_mquickjs_canary.c",
  "host_harness.c", "xtensa_link_canary.c",
].map((name) => path.join(engineDirectory, name))) === engine.canarySourceSha256,
"Engine canary source-set SHA-256 changed after its verifier completed.");

invariant(loader.status === "PASS_STATIC_MODULE_LOADER_FEASIBILITY" &&
  loader.hardwareRuntimeProven === false && loader.flashed === false,
"Module loader must remain a hardware-free static pass.");
await verifyFile(loaderManifestFile, EXPECTED_LOADER.manifestSha256);
invariant(loader.module.publicAbi.sdkPackageAbi.sha256 ===
  RENDER_V2_MQUICKJS_PACKAGE_ABI_SHA256 &&
  loader.module.publicAbi.sha256 === EXPECTED_LOADER.publicAbiSha256 &&
  loader.module.publicAbi.upstreamCommit === RENDER_V2_MQUICKJS_ENGINE_COMMIT &&
  loader.companionCoreCanary.sourceSha256 === engine.canarySourceSha256 &&
  loader.companionCoreCanary.targetRawSha256 === engine.target.rawSha256,
"Loader, engine, and SDK identities diverged.");
await verifyFile(loader.healthyBase.app.file, loader.healthyBase.app.sha256,
  loader.healthyBase.app.bytes);
await verifyFile(loader.healthyBase.receipt.file, loader.healthyBase.receipt.sha256);
const moduleText = await verifyFile(
  path.join(loaderDirectory, "build/mquickjs-module-text-page.bin"),
  loader.module.text.paddedSha256, loader.module.text.capacityBytes);
const moduleRodata = await verifyFile(
  path.join(loaderDirectory, "build/mquickjs-module-rodata-page.bin"),
  loader.module.rodata.paddedSha256, loader.module.rodata.capacityBytes);
await verifyFile(path.join(loaderDirectory, "build/resident-loader.bin"),
  loader.residentLoader.sha256, loader.residentLoader.usedBytes);
const moduleSlot = await readFile(path.join(loaderDirectory, "build/module-slot-a.bin"));
invariant(moduleSlot.length === 192 * 1_024 &&
  moduleSlot.equals(Buffer.concat([moduleText, moduleRodata])),
"Module slot A is not the exact 192 KiB text+rodata image.");

invariant(resident.status ===
  "PASS_HOST_XTENSA_RESIDENT_CORE_NO_GO_PHYSICAL_STOCK_BRIDGE" &&
  resident.hardwareRuntimeProven === false && resident.flashed === false,
"Resident integration must be an offline pass with a physical NO-GO.");
await verifyFile(residentManifestFile, EXPECTED_RESIDENT.manifestSha256);
invariant(resident.format === EXPECTED_RESIDENT.format &&
  resident.sdkPackageAbi.sha256 === RENDER_V2_MQUICKJS_PACKAGE_ABI_SHA256 &&
  resident.engineAbi.heapBytes === RENDER_V2_MQUICKJS_LIMITS.heapBytes &&
  resident.engineAbi.callbackDeadlineUs === RENDER_V2_MQUICKJS_LIMITS.callbackDeadlineUs &&
  resident.engineAbi.callbacksPerInputDrain === 3 &&
  resident.engineAbi.recoveryOwner ===
    "engine core only; resident adapter performs no duplicate reset",
"Resident integration no longer matches the frozen SDK/engine owner contract.");
invariant(resident.admission.result === "PASS" && resident.mailbox.result === "PASS" &&
  resident.mailbox.bytes === 72 && resident.mailbox.slots === 16 &&
  resident.owner.result === "PASS_HOST_ARCHITECTURE" &&
  resident.owner.stackBytes === 12_288 && resident.tests.physicalGate === "PASS_FAIL_CLOSED",
"Resident admission, mailbox, owner, or fail-closed proof changed.");
await verifyFile(path.join(residentDirectory, "build/resident-integration-core.o"),
  EXPECTED_RESIDENT.coreSha256, EXPECTED_RESIDENT.coreBytes);
invariant(resident.xtensa.objectSha256 === EXPECTED_RESIDENT.coreSha256 &&
  resident.xtensa.objectBytes === EXPECTED_RESIDENT.coreBytes,
"Resident v3 manifest does not describe the independently frozen Xtensa object.");
await verifyFile(path.join(residentDirectory, "build/plain-canary.f2js"),
  resident.admission.packageSha256);
await verifyFile(path.join(residentDirectory, "build/rich-canary.f2js"),
  resident.admission.rasterPackageSha256);
await verifyFile(path.join(residentDirectory, "build/mutation-parity.bin"),
  resident.admission.corpusSha256, resident.admission.corpusBytes);
for (const sourceFile of resident.sourceFiles) {
  await verifyFile(path.join(residentDirectory, sourceFile.name), sourceFile.sha256,
    sourceFile.bytes);
}

invariant(stock.physicalCandidate === "NO_GO" && stock.failClosed === "PASS_FAIL_CLOSED",
  "Stock bridge must remain fail-closed and physical NO-GO.");
await verifyFile(stockManifestFile, EXPECTED_STOCK.manifestSha256);
invariant(stock.healthyBase.sha256 === loader.healthyBase.app.sha256 &&
  stock.healthyBase.receiptSha256 === loader.healthyBase.receipt.sha256,
"Stock bridge and loader no longer target the same accepted device base.");
invariant(stock.matrix.some((row) => row.seam === "stock-first key ingress" &&
  row.status === "PROVEN_STATIC") &&
  stock.matrix.some((row) => row.seam === "resident integration" &&
  row.status === "FAIL_CLOSED_NO_GO") &&
  stock.matrix.every((row) => !row.status.includes("PROVEN_PHYSICAL")),
"Stock bridge proof matrix no longer expresses the static-only boundary.");
invariant(stock.spans.length === 18 &&
  stock.staticBridge.sha256 === EXPECTED_STOCK.coreSha256 &&
  stock.staticBridge.bytes === EXPECTED_STOCK.coreBytes &&
  stock.staticBridge.textBytes === EXPECTED_STOCK.textBytes &&
  stock.tailPatch.patchBytes === EXPECTED_STOCK.tailPatchBytes &&
  JSON.stringify(stock.staticBridge.unresolved) === JSON.stringify(EXPECTED_STOCK.unresolved),
"Independently audited stock bridge pins changed.");
await verifyFile(path.join(stockDirectory, stock.staticBridge.core),
  stock.staticBridge.sha256, stock.staticBridge.bytes);
for (const sourcePin of stock.sourcePins) {
  await verifyFile(path.join(root, sourcePin.file), sourcePin.sha256);
}

const keyFile = path.join(keyDirectory, "build/timer-multi-input.f2js");
await verifyFile(keyManifestFile, EXPECTED_KEY.manifestSha256);
const keyBytes = await verifyFile(keyFile, EXPECTED_KEY.packageSha256, key.bytes);
const decodedKey = decodeRenderV2MQuickJsPackage(keyBytes);
invariant(key.status === "OFFLINE_PACKAGE_ONLY_NOT_DEVICE_APPROVAL" &&
  key.hardwareRuntimeProven === false && key.syntheticNativeTokens === true &&
  key.profileId === RENDER_V2_MQUICKJS_PROFILE_ID &&
  key.packageAbiSha256 === RENDER_V2_MQUICKJS_PACKAGE_ABI_SHA256 &&
  decodedKey.sha256 === key.sha256 && decodedKey.generation === 1 &&
  decodedKey.source.startsWith(RENDER_V2_MQUICKJS_SOURCE_PREFIX) &&
  decodedKey.input.keyCount === 2 && decodedKey.input.chordCount === 1 &&
  decodedKey.events.length === 6,
"Basic timer/key/chord package no longer matches the frozen canary contract.");

const weatherFile = path.join(weatherDirectory, "build/weather-60601.f2js");
const weatherSourceFile = path.join(weatherDirectory, "weather-widget.js");
await verifyFile(weatherManifestFile, EXPECTED_WEATHER.manifestSha256);
const weatherBytes = await verifyFile(weatherFile, EXPECTED_WEATHER.packageSha256,
  weather.package.bytes);
const weatherSource = await verifyFile(weatherSourceFile, EXPECTED_WEATHER.sourceSha256,
  EXPECTED_WEATHER.sourceBytes);
const decodedWeather = decodeRenderV2MQuickJsPackage(weatherBytes);
invariant(weather.status === "STATIC_OFFLINE_NOT_FLASHABLE" &&
  weather.hardwareRuntimeProven === false && weather.screen.pushAllowed === false &&
  weather.package.generation === EXPECTED_WEATHER.generation &&
  weather.package.sha256 === EXPECTED_WEATHER.packageSha256 &&
  weather.package.sourceSha256 === EXPECTED_WEATHER.sourceSha256 &&
  weather.package.profileId === RENDER_V2_MQUICKJS_PROFILE_ID &&
  weather.package.packageAbiSha256 === RENDER_V2_MQUICKJS_PACKAGE_ABI_SHA256 &&
  decodedWeather.generation === EXPECTED_WEATHER.generation &&
  decodedWeather.source === weatherSource.toString("utf8") &&
  decodedWeather.targets.length === 16 && decodedWeather.events.length === 9,
"Weather generation/package/source/target/event contract changed.");
invariant(weather.providerBoundary ===
  "host-only ZIP lookup; deterministic no-network provider used for this proof" &&
  weather.screen.capabilityGate.engineCommit === RENDER_V2_MQUICKJS_ENGINE_COMMIT &&
  weather.screen.capabilityGate.deliveryReceipt === "applied-revision-v1" &&
  weather.screen.pushAllowed === false,
"Weather provider or capability boundary changed.");
const weatherNative = await runJson(path.join(weatherDirectory, "verify-native.mjs"));
invariant(weatherNative.status === "PASS_WEATHER_SOURCE_ON_PINNED_MQUICKJS_HOST" &&
  weatherNative.hardwareRuntimeProven === false && weatherNative.movingGcAsan === "PASS" &&
  weatherNative.exactSourceBytes === EXPECTED_WEATHER.sourceBytes &&
  weatherNative.heapHighWater === EXPECTED_WEATHER.normalHeapHighWaterBytes &&
  RENDER_V2_MQUICKJS_LIMITS.heapBytes - weatherNative.heapHighWater ===
    EXPECTED_WEATHER.heapHeadroomBytes,
"Weather native execution or exact 4,040-byte heap-headroom proof changed.");

await verifyFile(targetManifestFile, EXPECTED_TARGET.manifestSha256);
const targetAsset = await verifyFile(path.join(targetDirectory,
  "build/weather-gen18.f2tf"), EXPECTED_TARGET.assetSha256, EXPECTED_TARGET.assetBytes);
await verifyFile(path.join(targetDirectory, "build/weather-gen18-base.rgb565le"),
  EXPECTED_TARGET.baseSha256, 100 * 310 * 2);
const targetCases = await verifyFile(path.join(targetDirectory, "build/weather-cases.bin"),
  EXPECTED_TARGET.casesSha256, EXPECTED_TARGET.casesBytes);
invariant(target.status === "STATIC_ONLY_NOT_INTEGRATED" &&
  target.hardwareTouched === false && target.flashable === false &&
  target.generation === EXPECTED_WEATHER.generation &&
  target.asset.bytes === EXPECTED_TARGET.assetBytes &&
  target.asset.sha256 === EXPECTED_TARGET.assetSha256 &&
  target.asset.contractSha256 === EXPECTED_TARGET.contractSha256 &&
  target.asset.f2jsSha256 === EXPECTED_WEATHER.packageSha256 &&
  target.asset.baseSha256 === EXPECTED_TARGET.baseSha256 &&
  target.asset.targetCount === decodedWeather.targets.length,
"Target facade status, association, or frozen F2TF identity changed.");
invariant(targetVerifier.status === target.status &&
  targetVerifier.asset.sha256 === target.asset.sha256 &&
  targetVerifier.xtensa.objectSha256 === target.xtensa.objectSha256 &&
  target.proof.hostVsCFrames === "PIXEL_EXACT" &&
  target.proof.cases.length === EXPECTED_TARGET.pixelExactCases &&
  target.proof.cases.every(({ frameSha256 }) => /^[0-9a-f]{64}$/u.test(frameSha256)) &&
  target.proof.tornMidCopy === "PASS" && target.proof.malformedAssets === "PASS" &&
  target.proof.overlayOverflowBeforeDraw === "PASS",
"Target facade did not dynamically reproduce all 11 pixel-exact/fail-closed cases.");
invariant(target.xtensa.objectSha256 === EXPECTED_TARGET.objectSha256 &&
  target.xtensa.objectBytes === EXPECTED_TARGET.objectBytes &&
  target.xtensa.textBytes === EXPECTED_TARGET.textBytes &&
  target.xtensa.rodataBytes === EXPECTED_TARGET.rodataBytes &&
  target.xtensa.undefinedSymbols === 0 && target.xtensa.writableGlobalBytes === 0 &&
  target.timingEstimate.kind === "analytic-not-device-measured",
"Target facade Xtensa object or static-only timing boundary changed.");

await mkdir(output, { recursive: true });
const bundledKeyFile = path.join(output, "key-chord-knob-canary.f2js");
const bundledWeatherFile = path.join(output, "weather-60601.f2js");
const bundledTargetFile = path.join(output, "weather-gen18.f2tf");
await Promise.all([
  writeFile(bundledKeyFile, keyBytes),
  writeFile(bundledWeatherFile, weatherBytes),
  writeFile(bundledTargetFile, targetAsset),
]);

const [loaderIdentity, residentIdentity, stockIdentity, targetIdentity, keyIdentity,
  weatherIdentity] =
  await Promise.all([
    manifestIdentity(loaderManifestFile), manifestIdentity(residentManifestFile),
    manifestIdentity(stockManifestFile), manifestIdentity(targetManifestFile),
    manifestIdentity(keyManifestFile),
    manifestIdentity(weatherManifestFile),
  ]);

const physicalBlockers = Object.freeze([
  Object.freeze({ id: "target-facade", detail:
    "Link the frozen F2TF facade into the stock UI task and prove its thread, timing, stack, capability, and pixel behavior on hardware." }),
  Object.freeze({ id: "exact-applied-revision-rpc", detail:
    "Return exact event/control receipts plus busy/rejected/queued and the applied generation or weather revision." }),
  Object.freeze({ id: "linked-app", detail:
    "Link the frozen resident owner/parser/mailbox, stock bridge, module loader, and target facade into one accepted app with final non-overlapping hashes." }),
  Object.freeze({ id: "cache-quiesce", detail:
    "Pause and drain every VM/event/key producer before cache-disabled flash or NVS work; logical key detach alone is insufficient." }),
  Object.freeze({ id: "capability-receipt", detail:
    "Advertise the exact engine/key/weather capability only after startup succeeds and retain an exact physical app/module/package receipt." }),
  Object.freeze({ id: "watchdog-lifecycle", detail:
    "Pin and exercise the complete task-WDT add/reset/delete lifecycle, including timeout and teardown paths." }),
  Object.freeze({ id: "physical-recovery", detail:
    "Prove physical OOM/timeout recovery, last-good state, hide/show, USB loss, rollback, and existing-screen regression behavior." }),
  Object.freeze({ id: "physical-soak", detail:
    "Record bounded stack/heap/deadline/WDT telemetry and an exact app/module/package receipt across a sustained device soak." }),
]);

const manifest = {
  format: "framer-render-v2-mquickjs-offline-readiness-v2",
  status: "PASS_STATIC_ONLY_NOT_FLASHABLE",
  physicalVerdict: "NOT_FLASHABLE",
  hardwareRuntimeProven: false,
  deviceRunsJsdom: false,
  flashCommandGenerated: false,
  sdk: {
    profileId: RENDER_V2_MQUICKJS_PROFILE_ID,
    packageFormat: RENDER_V2_MQUICKJS_PACKAGE_FORMAT,
    packageAbiSha256: RENDER_V2_MQUICKJS_PACKAGE_ABI_SHA256,
    engineCommit: RENDER_V2_MQUICKJS_ENGINE_COMMIT,
  },
  engine: {
    status: engine.status,
    sourceSha256: engine.canarySourceSha256,
    targetRawSha256: engine.target.rawSha256,
    fixedHeapBytes: engine.target.fixedHeapBytes,
    runtimeStorageBytes: engine.target.runtimeStorageBytes,
    movingGcAsan: engine.host.movingGcAsan,
    hardwareRuntimeProven: false,
  },
  examples: {
    keyChordKnob: {
      manifest: keyIdentity,
      file: relative(bundledKeyFile),
      generation: key.generation,
      bytes: keyBytes.length,
      sha256: sha256(keyBytes),
      sourceSha256: key.sourceSha256,
      syntheticNativeTokens: true,
      hardwareRuntimeProven: false,
    },
    weather: {
      manifest: weatherIdentity,
      file: relative(bundledWeatherFile),
      generation: weather.package.generation,
      bytes: weatherBytes.length,
      sha256: sha256(weatherBytes),
      sourceSha256: sha256(weatherSource),
      hostRpcIds: weather.protocol.requiredHostRpcIds,
      tickEvent: "tick.1s",
      targetCount: weather.screen.targetCount,
      normalHeapHighWaterBytes: weatherNative.heapHighWater,
      heapHeadroomBytes: RENDER_V2_MQUICKJS_LIMITS.heapBytes - weatherNative.heapHighWater,
      providerBoundary: weather.providerBoundary,
      pushAllowed: false,
      hardwareRuntimeProven: false,
    },
  },
  loader: {
    manifest: loaderIdentity,
    publicAbiSha256: loader.module.publicAbi.sha256,
    text: loader.module.text,
    rodata: loader.module.rodata,
    slotA: { file: relative(path.join(loaderDirectory, "build/module-slot-a.bin")),
      bytes: moduleSlot.length, sha256: sha256(moduleSlot) },
    residentLoader: loader.residentLoader,
    hardwareRuntimeProven: false,
  },
  resident: {
    manifest: residentIdentity,
    status: resident.status,
    xtensaCore: { file: relative(path.join(residentDirectory,
      "build/resident-integration-core.o")), bytes: resident.xtensa.objectBytes,
      sha256: resident.xtensa.objectSha256 },
    admission: resident.admission,
    mailbox: resident.mailbox,
    owner: resident.owner,
    physicalVerdict: resident.physicalStaticVerdict.verdict,
    hardwareRuntimeProven: false,
  },
  targetFacade: {
    manifest: targetIdentity,
    status: target.status,
    asset: {
      file: relative(bundledTargetFile),
      bytes: targetAsset.length,
      sha256: sha256(targetAsset),
      contractSha256: target.asset.contractSha256,
      f2jsSha256: target.asset.f2jsSha256,
      baseSha256: target.asset.baseSha256,
    },
    weatherCases: {
      file: relative(path.join(targetDirectory, "build/weather-cases.bin")),
      bytes: targetCases.length,
      sha256: sha256(targetCases),
      count: target.proof.cases.length,
      comparison: target.proof.hostVsCFrames,
    },
    xtensa: target.xtensa,
    timingEvidence: target.timingEstimate.kind,
    integratedIntoStockUi: false,
    hardwareRuntimeProven: false,
  },
  stockBridge: {
    manifest: stockIdentity,
    physicalCandidate: stock.physicalCandidate,
    core: { file: relative(path.join(stockDirectory, stock.staticBridge.core)),
      bytes: stock.staticBridge.bytes, sha256: stock.staticBridge.sha256 },
    exactSpanCount: stock.spans.length,
    tailPatch: stock.tailPatch,
    hardwareRuntimeProven: false,
  },
  healthyBase: loader.healthyBase,
  inputLab: {
    packageSdk: "available",
    browserKeyChordHoldSimulator: "available-host-only",
    nativeKeyRecorder: "capability-gated-host-library-only",
    visibleMQuickJsEditor: "not-integrated",
    devicePush: "blocked-until-exact-physical-capability-and-applied-revision-receipt",
    weatherZipAndProvider: "host-only-not-keyboard-networking",
  },
  verifiedOfflineChain: [
    "strict F2JS SDK construction and decode",
    "real host MicroQuickJS execution, fixed heap, deadline recovery, moving GC, keys, chords, and key-plus-knob model",
    "deterministic Xtensa module and fixed-MMU loader layout",
    "resident raw-byte F2JS admission parity, owner architecture, and threaded 72-byte mailbox",
    "weather F2TF target facade with 11 pixel-exact host-versus-C cases and a frozen freestanding Xtensa object",
    "exact accepted-image stock startup, heap, task, UI, key, and RPC seams",
    "generation-1 timer/key/chord package and generation-18 weather RPC/tick package",
    "weather revision-stage-commit host simulation and pinned-engine 4,040-byte heap-headroom execution",
  ],
  staticOnlyBoundary:
    "This report cross-checks frozen offline artifacts; it is not a linked app, a physical capability receipt, or authorization to flash.",
  blockingPhysicalIntegration: physicalBlockers,
};
const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
const manifestFile = path.join(output, "readiness-manifest.json");
await writeFile(manifestFile, manifestBytes);

process.stdout.write(`${JSON.stringify({
  status: manifest.status,
  physicalVerdict: manifest.physicalVerdict,
  sdkPackageAbi: manifest.sdk.packageAbiSha256,
  keyPackage: manifest.examples.keyChordKnob.sha256,
  weatherPackage: manifest.examples.weather.sha256,
  weatherSource: manifest.examples.weather.sourceSha256,
  weatherHeapHeadroomBytes: manifest.examples.weather.heapHeadroomBytes,
  moduleAbi: manifest.loader.publicAbiSha256,
  residentCore: manifest.resident.xtensaCore.sha256,
  targetFacadeAsset: manifest.targetFacade.asset.sha256,
  targetFacadeObject: manifest.targetFacade.xtensa.objectSha256,
  targetFacadeCases: manifest.targetFacade.weatherCases.count,
  stockBridgeCore: manifest.stockBridge.core.sha256,
  manifest: sha256(manifestBytes),
  flashCommandGenerated: false,
})}\n`);
