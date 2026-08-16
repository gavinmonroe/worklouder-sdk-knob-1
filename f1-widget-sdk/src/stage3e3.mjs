import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import {
  STAGE3C1_KEY_CALLBACK_APP_OFFSET,
  STAGE3C1_SETUP_POINTER_APP_OFFSET,
  STAGE3C1_WPM_TICK_APP_OFFSET,
} from "../../custom-firmware/build-stage3c1.mjs";
import { REMAINING_GETTER_LITERAL_APP_OFFSET, STOCK_REMAINING_GETTER } from
  "../../custom-firmware/build-stage3b.mjs";
import {
  EXPECTED_STAGE3E3A_APP_SHA256,
  STAGE3E3A_ABI_BYTES,
  STAGE3E3A_DROM_GROWTH_BYTES,
} from "../../custom-firmware/build-stage3e3a.mjs";
import {
  STAGE3E3_ABI_APP_OFFSET,
  STAGE3E3_ABI_BYTES,
  STAGE3E3_ABI_SHA256,
  STAGE3E3_ASSET_BANK_APP_OFFSET,
  STAGE3E3_ASSET_BANK_BYTES,
  STAGE3E3_ASSET_BANK_VIRTUAL_ADDRESS,
  STAGE3E3_DROM_GROWTH_BYTES,
  STAGE3E3_SETUP_WRAPPER_VIRTUAL_ADDRESS,
  decodeStage3e3AbiHex,
} from "../../custom-firmware/build-stage3e3.mjs";
import {
  extendEsp32AppSegment,
  inspectEsp32AppImage,
  repairEsp32AppIntegrity,
} from "../../custom-firmware/lib/esp-app-image.mjs";
import {
  FRAMER_RUNTIME_ASSET_BOUNDARY,
  auditRuntimeAssetBoundary,
  buildNativeLvglIndexedBank,
  parseSerializedLvglIndexed,
} from "../../custom-firmware/lib/framer-lvgl-indexed.mjs";
import { FRAMER_SCREEN_AUDIT } from "../../custom-firmware/lib/framer-registry-audit.mjs";
import { PINNED, SDK_ROOT, WORKSPACE_ROOT } from "./constants.mjs";
import { prepareCombinedIntegration } from "./combined.mjs";
import { inspectImage } from "./firmware.mjs";
import { assert, sha256, stableJson } from "./util.mjs";

const run = promisify(execFile);
const STATE_ORDER = Object.freeze([
  "ready", "curious", "happy", "zooming", "fire", "tired", "waiting", "sleeping",
]);
const ROSTER_ORDER = Object.freeze([
  "Belgian Tervuren", "Pepe", "Angry owl", "Cute ferret", "Cat", "Lazy cow",
]);
const APP_NAME = "framer-0.4.1-stage3e3-sdk-app.bin";
const MERGED_NAME = "framer-0.4.1-stage3e3-sdk-merged.bin";
const REPORT_NAME = "stage3e3-sdk-preflight.json";

export const STAGE3E3_SDK_PROFILE = Object.freeze({
  format: "framer-f1-stage3e3-sdk-profile-v1",
  screenId: 7,
  logicalCanvas: Object.freeze({ width: 100, height: 310 }),
  physicalDisplay: Object.freeze({ width: 310, height: 100 }),
  sourceFrame: Object.freeze({ width: 52, height: 42, format: "LVGL I4", colorFormat: 0x09 }),
  scale: 0x200,
  visiblePet: Object.freeze({ width: 104, height: 84, align: "center" }),
  background: "procedural opaque #06152B root plus three created-once color-twinkled star labels",
  descriptorOrder: "species*8+state",
  roster: ROSTER_ORDER,
  states: STATE_ORDER,
  input: Object.freeze({ scope: "screen-local", chord: "Fn+bottom encoder", encoderId: 1 }),
  runtimeAssetBoundaryExclusive: FRAMER_RUNTIME_ASSET_BOUNDARY.originalMappedPageEnd,
  liveStatus: "RUNTIME_NO_GO_FULL48_PET_NOT_VISIBLE_2026_08_15",
  liveEvidence: "Background, stars, labels, boot, and health passed; no pet rendered, so mood/Fn switching was unobservable.",
});

export const STAGE3E3_PATHS = Object.freeze({
  official: PINNED.officialMerged.path,
  c1: path.join(WORKSPACE_ROOT, "custom-firmware/build/framer-0.4.1-stage3c1-wpm-owned-labels-app.bin"),
  e3a: path.join(WORKSPACE_ROOT, "custom-firmware/build/framer-0.4.1-stage3e3a-i4-canary-app.bin"),
  abiHex: path.join(WORKSPACE_ROOT, "custom-firmware/experimental/stage3e3-wpm-pet.hex"),
  abiSource: path.join(WORKSPACE_ROOT, "custom-firmware/experimental/stage3e3-wpm-pet.S"),
  abiLinker: path.join(WORKSPACE_ROOT, "custom-firmware/experimental/stage3e3-wpm-pet.ld"),
  abiVerifier: path.join(WORKSPACE_ROOT, "custom-firmware/tools/verify-stage3e3-abi.mjs"),
  manifest: path.join(WORKSPACE_ROOT, "framer-widgets/assets/device-lvgl-v5-i4-species/manifest.json"),
  recoveryManifest: path.join(WORKSPACE_ROOT,
    "recovery/backups/2026-08-15-framer-f1-a4cb8faf3210-before-custom/manifest.json"),
  esptool: path.join(WORKSPACE_ROOT, ".venv-esptool/bin/esptool"),
});

function hashMany(items) {
  const hash = createHash("sha256");
  for (const [name, bytes] of items) {
    hash.update(name); hash.update("\0"); hash.update(bytes); hash.update("\0");
  }
  return hash.digest("hex");
}

async function readCache(file) {
  try { return JSON.parse(await readFile(file, "utf8")); } catch { return {}; }
}

function assertInsideWorkspace(file, description) {
  const resolved = path.resolve(file);
  const relative = path.relative(WORKSPACE_ROOT, resolved);
  assert(relative && !relative.startsWith("..") && !path.isAbsolute(relative),
    `${description} must stay inside the workspace.`);
  return resolved;
}

export function validateStage3e3Manifest(raw) {
  assert(raw?.format === "framer-f1-wpm-pet-lvgl-assets-v5-i4-six-species",
    "Stage-3E.3 manifest format changed.");
  assert(JSON.stringify(raw.rosterOrder) === JSON.stringify(ROSTER_ORDER),
    "Stage-3E.3 roster order must remain the declarative six-species contract.");
  assert(JSON.stringify(raw.stateOrder) === JSON.stringify(STATE_ORDER),
    "Stage-3E.3 state order must remain the declarative eight-mood contract.");
  assert(raw.descriptorOrder === "species*8+state; no background bitmap descriptors",
    "Stage-3E.3 must not add a DROM background bitmap.");
  assert(raw.layout?.background === "opaque programmatic root #06152B",
    "Stage-3E.3 background must remain procedural.");
  assert(Array.isArray(raw.frames) && raw.frames.length === 48,
    "Stage-3E.3 requires exactly six species times eight mood frames.");
  for (let index = 0; index < raw.frames.length; index += 1) {
    const frame = raw.frames[index];
    const species = Math.floor(index / 8);
    const state = index % 8;
    assert(frame.name === `pet-${species}-${state}` && frame.speciesId === species &&
      frame.species === ROSTER_ORDER[species] && frame.stateId === state &&
      frame.state === STATE_ORDER[state], `Stage-3E.3 frame ${index} order changed.`);
    assert(frame.width === 52 && frame.height === 42 && frame.stride === 26 && frame.bytes === 1168,
      `Stage-3E.3 frame ${index} is not exact compact 52x42 I4.`);
    assert(typeof frame.output === "string" && /^[0-9a-f]{64}$/u.test(frame.lvglSha256),
      `Stage-3E.3 frame ${index} path/hash is invalid.`);
  }
  return raw;
}

async function loadDeclarativeAssets(manifestPath) {
  const manifestBytes = await readFile(assertInsideWorkspace(manifestPath, "Asset manifest"));
  const manifest = validateStage3e3Manifest(JSON.parse(manifestBytes.toString("utf8")));
  const frameEntries = [];
  const frames = [];
  for (const spec of manifest.frames) {
    const file = assertInsideWorkspace(path.join(WORKSPACE_ROOT, spec.output), `Frame ${spec.name}`);
    const bytes = await readFile(file);
    assert(sha256(bytes) === spec.lvglSha256, `Frame ${spec.name} differs from its declarative hash.`);
    const parsed = parseSerializedLvglIndexed(bytes);
    assert(parsed.colorFormat === 0x09 && parsed.width === 52 && parsed.height === 42 && parsed.stride === 26,
      `Frame ${spec.name} is not LVGL I4 52x42 stride 26.`);
    const alphas = Array.from({ length: 16 }, (_, index) => bytes[12 + index * 4 + 3]);
    assert(alphas.every((alpha) => alpha === 0 || alpha === 255) && alphas.includes(0) && alphas.includes(255),
      `Frame ${spec.name} must use binary-alpha I4.`);
    frames.push(bytes);
    frameEntries.push([spec.output, bytes]);
  }
  const native = buildNativeLvglIndexedBank(frames, { baseAddress: STAGE3E3_ASSET_BANK_VIRTUAL_ADDRESS });
  assert(native.bank.length === STAGE3E3_ASSET_BANK_BYTES && native.descriptorTableBytes === 48 * 24,
    "Compact I4 bank shape changed.");
  const boundary = auditRuntimeAssetBoundary(native.bank);
  assert(boundary.endAddress === 0x3c1ceed0 &&
    boundary.endAddress < STAGE3E3_SDK_PROFILE.runtimeAssetBoundaryExclusive,
  "Every descriptor, palette, and pixel byte must end below 0x3C1D0000.");
  for (const descriptor of native.descriptors) {
    assert(descriptor.colorFormat === 0x09 && descriptor.width === 52 && descriptor.height === 42 &&
      descriptor.dataAddress + descriptor.dataBytes < STAGE3E3_SDK_PROFILE.runtimeAssetBoundaryExclusive,
    "A Stage-3E.3 descriptor escapes the original runtime-readable DROM page.");
  }
  const padded = Buffer.alloc(STAGE3E3_DROM_GROWTH_BYTES);
  native.bank.copy(padded);
  return Object.freeze({ manifest, manifestBytes, frames, native, boundary, padded,
    fingerprint: hashMany([[path.relative(WORKSPACE_ROOT, manifestPath), manifestBytes], ...frameEntries]) });
}

function auditComposedImage(e3a, app, abi, padded) {
  const before = inspectEsp32AppImage(e3a);
  const after = inspectEsp32AppImage(app);
  assert(before.segmentCount === 6 && after.segmentCount === 6, "Stage-3E.3 must retain six segments.");
  const setup = STAGE3C1_SETUP_POINTER_APP_OFFSET - before.segments[0].dataOffset;
  const stockDromBytes = before.segments[0].length - STAGE3E3A_DROM_GROWTH_BYTES;
  const stockIromBytes = before.segments[3].length - STAGE3E3A_ABI_BYTES;
  for (let index = 0; index < 6; index += 1) {
    const oldSegment = before.segments[index];
    const newSegment = after.segments[index];
    assert(oldSegment.loadAddress === newSegment.loadAddress, `Segment ${index} load address changed.`);
    if (index === 0) {
      assert(newSegment.length === oldSegment.length, "Stage-3E.3 may only replace E3A's existing DROM page.");
      assert(newSegment.data.subarray(0, setup).equals(oldSegment.data.subarray(0, setup)) &&
        newSegment.data.subarray(setup + 4, stockDromBytes).equals(oldSegment.data.subarray(setup + 4, stockDromBytes)) &&
        newSegment.data.subarray(stockDromBytes).equals(padded), "Unexpected DROM mutation.");
    } else if (index === 3) {
      assert(newSegment.length === stockIromBytes + abi.length &&
        newSegment.data.subarray(0, stockIromBytes).equals(oldSegment.data.subarray(0, stockIromBytes)) &&
        newSegment.data.subarray(stockIromBytes).equals(abi), "Unexpected IROM mutation.");
    } else {
      assert(newSegment.data.equals(oldSegment.data), `Untargeted segment ${index} changed.`);
    }
  }
  assert(app.readUInt32LE(STAGE3C1_SETUP_POINTER_APP_OFFSET) === STAGE3E3_SETUP_WRAPPER_VIRTUAL_ADDRESS,
    "Setup pointer does not target Stage-3E.3.");
  assert(app.readUInt32LE(STAGE3C1_KEY_CALLBACK_APP_OFFSET + STAGE3E3_DROM_GROWTH_BYTES) ===
    FRAMER_SCREEN_AUDIT.wpmKeyCallbackLiteral.expectedValue, "Stock key callback changed.");
  assert(app.readUInt32LE(STAGE3C1_WPM_TICK_APP_OFFSET) ===
    FRAMER_SCREEN_AUDIT.wpmTickVtablePointer.expectedValue, "Native WPM tick changed.");
  assert(app.readUInt32LE(REMAINING_GETTER_LITERAL_APP_OFFSET + STAGE3E3_DROM_GROWTH_BYTES) ===
    STOCK_REMAINING_GETTER, "Stock Timer getter changed.");
  assert(after.segments.filter(({ loadAddress }) => loadAddress === PINNED.dromLoadAddress).length === 1 &&
    after.segments.filter(({ loadAddress }) => loadAddress === PINNED.iromLoadAddress).length === 1,
  "Final image must retain one DROM and one IROM segment.");
  assert((after.segments[3].dataOffset & 0xffff) === (after.segments[3].loadAddress & 0xffff),
    "IROM flash/MMU congruence changed.");
  assert(app.length <= PINNED.factoryPartitionBytes, "App exceeds the factory partition.");
  return after;
}

function composeStage3e3(official, e3a, abi, assets) {
  let app = Buffer.from(e3a);
  assets.padded.copy(app, STAGE3E3_ASSET_BANK_APP_OFFSET);
  app = repairEsp32AppIntegrity(app);
  app = extendEsp32AppSegment(app, { segmentIndex: PINNED.iromSegmentIndex,
    data: abi.subarray(STAGE3E3A_ABI_BYTES) });
  abi.copy(app, STAGE3E3_ABI_APP_OFFSET);
  app.writeUInt32LE(STAGE3E3_SETUP_WRAPPER_VIRTUAL_ADDRESS, STAGE3C1_SETUP_POINTER_APP_OFFSET);
  app = repairEsp32AppIntegrity(app);
  const info = auditComposedImage(e3a, app, abi, assets.padded);
  const merged = Buffer.concat([official.subarray(0, PINNED.appFlashOffset), app]);
  assert(merged.subarray(PINNED.appFlashOffset).equals(app), "Merged app payload differs.");
  return { app, merged, info };
}

export async function verifyRecoveryGate() {
  const bytes = await readFile(STAGE3E3_PATHS.recoveryManifest);
  const manifest = JSON.parse(bytes.toString("utf8"));
  assert(manifest.format === "framer-f1-live-recovery-set-v1" &&
    manifest.device?.product === "Framer F1 / knob_f1" &&
    manifest.device?.mac === "a4:cb:8f:af:32:10" &&
    manifest.securityObservedLive?.secureBoot === false &&
    manifest.securityObservedLive?.flashEncryption === false,
  "Same-device recovery manifest gate failed.");
  const fullFlash = path.join(path.dirname(STAGE3E3_PATHS.recoveryManifest), manifest.fullFlash.file);
  const fullBytes = await readFile(fullFlash);
  assert(fullBytes.length === manifest.fullFlash.bytes && sha256(fullBytes) === manifest.fullFlash.sha256,
    "Same-device full recovery image hash failed.");
  return Object.freeze({ manifest: STAGE3E3_PATHS.recoveryManifest, fullFlash,
    bytes: fullBytes.length, sha256: sha256(fullBytes), mac: manifest.device.mac });
}

async function runAbiVerifier() {
  const result = await run(process.execPath, [STAGE3E3_PATHS.abiVerifier], {
    cwd: WORKSPACE_ROOT, maxBuffer: 4 * 1024 * 1024,
  });
  return JSON.parse(result.stdout);
}

async function runImageInfo(appPath) {
  const result = await run(STAGE3E3_PATHS.esptool, ["image-info", appPath], {
    cwd: WORKSPACE_ROOT, maxBuffer: 4 * 1024 * 1024,
  });
  assert(/ESP32-S3/iu.test(result.stdout) && /Validation hash:/iu.test(result.stdout),
    "esptool image-info did not validate an ESP32-S3 hash-appended image.");
  return result.stdout;
}

export async function prepareStage3e3({
  outputDirectory = path.join(SDK_ROOT, "build/stage3e3"),
  manifestPath = STAGE3E3_PATHS.manifest,
} = {}) {
  const started = Date.now();
  const outputRoot = path.resolve(outputDirectory);
  await mkdir(outputRoot, { recursive: true });
  const combinedPromise = prepareCombinedIntegration({ outputDirectory: outputRoot });
  const cachePath = path.join(outputRoot, ".stage3e3-cache.json");
  const cache = await readCache(cachePath);
  const [official, c1, e3a, abiHex, abiSource, abiLinker, abiVerifier, recovery, assets] = await Promise.all([
    readFile(STAGE3E3_PATHS.official), readFile(STAGE3E3_PATHS.c1), readFile(STAGE3E3_PATHS.e3a),
    readFile(STAGE3E3_PATHS.abiHex, "utf8"), readFile(STAGE3E3_PATHS.abiSource),
    readFile(STAGE3E3_PATHS.abiLinker), readFile(STAGE3E3_PATHS.abiVerifier),
    verifyRecoveryGate(), loadDeclarativeAssets(manifestPath),
  ]);
  assert(sha256(official) === PINNED.officialMerged.sha256, "Official 0.4.1 merged image drifted.");
  assert(sha256(c1) === PINNED.stage3c1Abi.appSha256, "Exact Stage-3C.1 base gate failed.");
  assert(sha256(e3a) === EXPECTED_STAGE3E3A_APP_SHA256, "Exact live/readback Stage-3E.3A rollback gate failed.");
  const abi = decodeStage3e3AbiHex(abiHex);
  assert(abi.length === STAGE3E3_ABI_BYTES && sha256(abi) === STAGE3E3_ABI_SHA256,
    "Pinned Stage-3E.3 ABI gate failed.");

  const toolEntries = [];
  for (const [name, expected] of Object.entries(PINNED.toolchain)) {
    const bytes = await readFile(path.join(PINNED.toolchainDirectory, `xtensa-esp32s3-elf-${name}`));
    assert(sha256(bytes) === expected, `Pinned ${name} toolchain hash failed.`);
    toolEntries.push([name, bytes]);
  }
  const abiFingerprint = hashMany([
    ["abi.hex", Buffer.from(abiHex)], ["abi.S", abiSource], ["abi.ld", abiLinker],
    ["verify.mjs", abiVerifier], ...toolEntries,
  ]);
  let abiVerification = cache.abiVerification;
  const abiCacheHit = cache.abiFingerprint === abiFingerprint &&
    abiVerification?.sha256 === STAGE3E3_ABI_SHA256 && abiVerification?.relocations === 0;
  if (!abiCacheHit) abiVerification = await runAbiVerifier();

  const buildFingerprint = hashMany([
    ["official", official], ["c1", c1], ["e3a", e3a], ["abi", abi],
    ["assets", Buffer.from(assets.fingerprint)],
  ]);
  const appPath = path.join(outputRoot, APP_NAME);
  const mergedPath = path.join(outputRoot, MERGED_NAME);
  let app;
  let merged;
  let buildCacheHit = false;
  if (cache.buildFingerprint === buildFingerprint) {
    try {
      [app, merged] = await Promise.all([readFile(appPath), readFile(mergedPath)]);
      buildCacheHit = sha256(app) === cache.appSha256 && sha256(merged) === cache.mergedSha256;
    } catch { buildCacheHit = false; }
  }
  if (!buildCacheHit) {
    ({ app, merged } = composeStage3e3(official, e3a, abi, assets));
    await Promise.all([writeFile(appPath, app), writeFile(mergedPath, merged)]);
  } else {
    auditComposedImage(e3a, app, abi, assets.padded);
  }

  const [inspection, imageInfo, combined] = await Promise.all([
    inspectImage(appPath), runImageInfo(appPath), combinedPromise,
  ]);
  const report = {
    format: "framer-f1-stage3e3-sdk-preflight-v1",
    status: STAGE3E3_SDK_PROFILE.liveStatus,
    deployable: false,
    reason: STAGE3E3_SDK_PROFILE.liveEvidence,
    profile: STAGE3E3_SDK_PROFILE,
    gates: {
      officialMergedSha256: sha256(official), c1AppSha256: sha256(c1),
      liveE3aRollbackSha256: sha256(e3a), recovery,
      abi: abiVerification, imageInfo: "PASS", checksumDigest: "PASS",
    },
    assets: {
      manifest: path.resolve(manifestPath), frames: 48, format: "I4 binary alpha",
      bankBytes: assets.native.bank.length, bankSha256: sha256(assets.native.bank),
      runtimeEndAddress: `0x${assets.boundary.endAddress.toString(16)}`,
      runtimeBoundaryExclusive: "0x3c1d0000", headroomBytes: assets.boundary.headroom,
      proceduralBackground: true, createdOnceTwinkleStars: 3,
    },
    outputs: {
      app: { file: appPath, bytes: app.length, sha256: sha256(app) },
      merged: { file: mergedPath, bytes: merged.length, sha256: sha256(merged) },
      inspection,
    },
    cache: { abi: abiCacheHit ? "hit" : "miss", build: buildCacheHit ? "hit" : "miss",
      assetFingerprint: assets.fingerprint, abiFingerprint, buildFingerprint },
    timings: { totalMs: Date.now() - started },
    deployment: {
      smoke: "BLOCKED: current full-48 live test rendered no pet",
      release: "BLOCKED: requires corrected canary plus full read-back",
      nextAdapter: "Use this structural composer after the corrected ABI/asset hypothesis is independently promoted.",
    },
    combinedId1Id7: combined.report,
    esptoolImageInfoSha256: sha256(Buffer.from(imageInfo)),
  };
  await Promise.all([
    writeFile(path.join(outputRoot, REPORT_NAME), stableJson(report)),
    writeFile(cachePath, stableJson({ abiFingerprint, abiVerification, buildFingerprint,
      appSha256: sha256(app), mergedSha256: sha256(merged) })),
  ]);
  return Object.freeze({ report, outputRoot, reportPath: path.join(outputRoot, REPORT_NAME), appPath, mergedPath });
}
