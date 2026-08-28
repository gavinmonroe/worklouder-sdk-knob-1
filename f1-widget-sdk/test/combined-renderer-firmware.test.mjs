import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { inspectEsp32AppImage } from "../../custom-firmware/lib/esp-app-image.mjs";
import {
  buildCombinedRendererFirmware,
  LIVE_RENDERER_BASE,
} from "../src/combined-renderer-firmware.mjs";
import { PINNED } from "../src/constants.mjs";
import { missingRecoveryBackup } from "../test-support/pinned-inputs.mjs";

const APP_SHA256 = "49cbf8801e3d86b20e0df21f41a2410b3e4d8547f8f64021ca6ed4bd85168840";
const CODE_SHA256 = "29ab7e856deea7bc4d87df784ecceb8e9c66210674a14264f277d801cb8c5276";
const MODULE_SHA256 = "4241be7b22d9b9198c2e4247a6daec3299557fe8fe424588ddff5702d2a79d5e";
const MERGED_SHA256 = "d2f62725d20859db26142927b5f18f1e9db82c48928cb1d8a6fecae61253fd97";

test("combined renderer ID26 preserves the accepted Music/WPM image and appends one registration module", { skip: missingRecoveryBackup() }, async (context) => {
  const output = await mkdtemp(path.join(os.tmpdir(), "f1-sdk-renderer-combined-test-"));
  context.after(() => rm(output, { recursive: true, force: true }));
  const result = await buildCombinedRendererFirmware({ outputDirectory: output });
  const manifest = result.manifest;
  assert.equal(manifest.status, "DEVICE_SMOKE_CANDIDATE");
  assert.equal(manifest.deployable, true);
  assert.deepEqual(manifest.target.screenIds, { music: 1, wpm: 7, renderer: 26 });
  assert.equal(manifest.liveBase.proofId, "framer-f1-0.4.1-music-id1-b9b8eec6");
  assert.equal(manifest.liveBase.app.sha256, LIVE_RENDERER_BASE.appSha256);
  assert.equal(manifest.liveBase.code.sha256, LIVE_RENDERER_BASE.codeSha256);
  assert.equal(manifest.liveBase.receipt.sha256, LIVE_RENDERER_BASE.receiptSha256);
  assert.equal(manifest.liveBase.receipt.deviceHealthy, true);
  assert.equal(manifest.setup.stockSetupCalls, 1);
  assert.deepEqual(manifest.setup.order,
    ["stock", "music_id1_register", "stage3e34_register_wpm", "renderer_id26_register"]);
  assert.deepEqual(manifest.setup.mutation, { address: "0x421170c5", bytes: 3,
    purpose: "redirect frozen WPM call through append-only WPM-then-renderer chain" });
  for (const item of [manifest.preservation.musicLiteral, manifest.preservation.musicText,
    manifest.preservation.wpmLiteral, manifest.preservation.wpmText,
    manifest.preservation.allLiveDromAssets]) assert.equal(item.preservedByteForByte, true);

  assert.equal(manifest.renderer.screenId, 26);
  assert.equal(manifest.renderer.registrationOnly, true);
  assert.equal(manifest.renderer.ownsStockSetup, false);
  assert.equal(manifest.renderer.navigationGate, "controller+20 == registry");
  assert.equal(manifest.renderer.module.baseAddress, "0x421187cc");
  assert.equal(manifest.renderer.module.entryAddress, "0x4211cb8c");
  assert.equal(manifest.renderer.module.bytes, 30_540);
  assert.equal(manifest.renderer.module.sha256, MODULE_SHA256);
  assert.equal(manifest.renderer.module.relocations, 0);
  assert.equal(manifest.renderer.module.deterministicRebuilds, 2);
  assert.deepEqual(manifest.renderer.formats.semantic, ["F1SC v1", "F1GA v1"]);
  assert.equal(manifest.renderer.formats.bundle, "F1WB v1");
  assert.equal(manifest.renderer.formats.raster, "F1RA v1");
  assert.deepEqual(manifest.renderer.startupScene, {
    file: path.join(path.resolve(import.meta.dirname, ".."),
      "examples/jp-matrix/build/jp-matrix-three-slots.f1wb"),
    bytes: 9_488,
    sha256: "fbfeefff128bc80c44663515830d3300083c84d18335f837f8949027051b2274",
    slots: 3,
    generation: 1,
    activation: "setup-time renderer_v1_tick before RPC registration",
    storage: "IROM word literals copied once into a dedicated retained 9488-byte RAM allocation",
    uploadLatch: "unused; RPC store is seeded to active generation 1 and remains writable",
  });

  assert.deepEqual(manifest.renderer.persistentRam, { controllerAndFramebufferBytes: 62164,
    framebufferBytes: 62000, descriptorIdentities: 2, embeddedDefaultBytes: 9488,
    rpcStateAndStoreBytes: 98624, successfulRegistrationBytes: 170276,
    failSoftRendererOnlyBytes: 62164 });
  assert.equal(manifest.renderer.plannedSingleStoreUploadRam.peakBytes, 170276);
  assert.deepEqual(manifest.renderer.rpc.requiredCapabilityContract, {
    atomicF1wb: true, uiThreadApply: true, ramOnly: true, persistence: false,
    singleSceneStore: true, freezeOnUpload: true, headerLastCommit: true,
    rollbackMode: "freeze-last-frame", maxBundleBytes: 98304, sceneStoreBytes: 98304,
    framebufferBytes: 62000, minimumRendererBytes: 160304, chunkRawBytes: 3072, maxChunks: 32,
  });
  assert.equal(manifest.renderer.rpc.acceptancePending, true);
  assert.equal(manifest.renderer.rpc.handlersImplemented, true);
  assert.equal(manifest.renderer.rpc.singleSceneStoreAccepted, false);
  assert.equal(manifest.renderer.rpc.heapTelemetryAccepted, false);
  assert.equal(manifest.renderer.rpc.liveProofId, null);
  assert.equal(manifest.renderer.rpc.firstSuccessfulUploadPerBoot, false);
  assert.equal(manifest.renderer.rpc.repeatedPush, true);
  assert.equal(manifest.renderer.rpc.generationSeed, 1);
  assert.equal(manifest.renderer.rpc.activeStoreOverwriteHandshake,
    "timer-tick detach for every active-store overwrite");
  assert.equal(manifest.renderer.rpc.responseEnvelope, "proven RAM-backed {status:ok|error} canary");
  assert.equal(manifest.verification.rendererRpcStaticImplementation, "PASS");
  assert.equal(manifest.verification.rendererRpcAcceptance, "PENDING");
  assert.equal(manifest.verification.heapTelemetry, "PENDING");

  assert.deepEqual(manifest.outputs.app, { file: result.appPath, bytes: 2_062_912, sha256: APP_SHA256 });
  assert.equal(manifest.outputs.code.bytes, 36_872);
  assert.equal(manifest.outputs.code.sha256, CODE_SHA256);
  assert.equal(manifest.outputs.merged.sha256, MERGED_SHA256);
  assert.equal(manifest.outputs.inspection.checksum.valid, true);
  assert.equal(manifest.outputs.inspection.digest.valid, true);
  assert.equal(manifest.outputs.inspection.factoryPartitionFit, true);
  assert.equal(manifest.safety.hardwareAccess, false);
  assert.equal(manifest.safety.rendererLiveProof, false);
  assert.equal(manifest.safety.newDromAssets, false);
});

test("combined renderer mutation is exactly one live-wrapper call plus append-only IROM", { skip: missingRecoveryBackup() }, async (context) => {
  const output = await mkdtemp(path.join(os.tmpdir(), "f1-sdk-renderer-byte-test-"));
  context.after(() => rm(output, { recursive: true, force: true }));
  const result = await buildCombinedRendererFirmware({ outputDirectory: output });
  const [liveApp, liveCode, candidateApp, candidateCode, module] = await Promise.all([
    readFile(result.manifest.liveBase.app.file), readFile(result.manifest.liveBase.code.file),
    readFile(result.appPath), readFile(result.codePath), readFile(result.modulePath),
  ]);
  const live = inspectEsp32AppImage(liveApp);
  const candidate = inspectEsp32AppImage(candidateApp);
  assert.ok(candidate.segments[PINNED.dromSegmentIndex].data.equals(live.segments[PINNED.dromSegmentIndex].data));
  for (let index = 0; index < live.segmentCount; index += 1) {
    if (index !== PINNED.iromSegmentIndex) assert.ok(candidate.segments[index].data.equals(live.segments[index].data));
  }
  const patchOffset = LIVE_RENDERER_BASE.wrapperWpmCallAddress - PINNED.codeBaseAddress;
  assert.ok(candidateCode.subarray(0, patchOffset).equals(liveCode.subarray(0, patchOffset)));
  assert.ok(candidateCode.subarray(patchOffset + 3, liveCode.length)
    .equals(liveCode.subarray(patchOffset + 3)));
  assert.notDeepEqual(candidateCode.subarray(patchOffset, patchOffset + 3),
    liveCode.subarray(patchOffset, patchOffset + 3));
  assert.ok(candidateCode.subarray(liveCode.length).equals(module));
  for (const slice of Object.values(LIVE_RENDERER_BASE.slices)) {
    assert.ok(candidateCode.subarray(slice.offset, slice.offset + slice.bytes)
      .equals(liveCode.subarray(slice.offset, slice.offset + slice.bytes)));
  }
});

test("embedded JP Matrix F1WB is copied into separate retained RAM before RPC generation seeding", { skip: missingRecoveryBackup() }, async (context) => {
  const output = await mkdtemp(path.join(os.tmpdir(), "f1-sdk-renderer-startup-test-"));
  context.after(() => rm(output, { recursive: true, force: true }));
  const result = await buildCombinedRendererFirmware({ outputDirectory: output });
  const [chain, expected] = await Promise.all([
    readFile(path.join(output, "renderer-id26-registration-chain.S"), "utf8"),
    readFile(result.manifest.renderer.startupScene.file),
  ]);
  const literals = Array.from(chain.matchAll(
    /^\.Lrenderer_bundle_(\d+): \.long 0x([0-9a-f]{8})$/gmu));
  assert.equal(literals.length, expected.length / 4);
  const reconstructed = Buffer.alloc(expected.length);
  for (const match of literals) reconstructed.writeUInt32LE(Number.parseInt(match[2], 16), Number(match[1]) * 4);
  assert.ok(reconstructed.equals(expected));
  assert.match(chain, /call8 renderer_id26_stage_embedded_bundle[\s\S]*call8 renderer_scene_rpc_register/u);
  assert.match(chain, /l32r a8,\.Lrenderer_operator_new[\s\S]*callx8 a8[\s\S]*call8 renderer_v1_stage_bundle[\s\S]*beqz a10,\.Lembedded_stage_fail[\s\S]*call8 renderer_v1_tick/u);
  assert.equal(chain.match(/call8 renderer_v1_tick/gu)?.length, 1);
  assert.match(chain, /call8 renderer_scene_rpc_register[\s\S]*s32i\.n a8,a10,8[\s\S]*memw/u);
  assert.equal(result.manifest.renderer.startupScene.activation,
    "setup-time renderer_v1_tick before RPC registration");
  const stage = chain.slice(chain.indexOf("renderer_id26_stage_embedded_bundle:"),
    chain.indexOf(".size renderer_id26_stage_embedded_bundle"));
  assert.doesNotMatch(stage, /s32i\.n a8,a5,(?:4|8)/u);
});

test("renderer smoke approval is app-only while runtime acceptance remains pending", { skip: missingRecoveryBackup() }, async (context) => {
  const output = await mkdtemp(path.join(os.tmpdir(), "f1-sdk-renderer-approval-test-"));
  context.after(() => rm(output, { recursive: true, force: true }));
  const result = await buildCombinedRendererFirmware({ outputDirectory: output });
  const approval = JSON.parse(await readFile(result.approvalPath, "utf8"));
  assert.equal(approval.status, "DEVICE_SMOKE_CANDIDATE");
  assert.equal(approval.deployable, true);
  assert.equal(approval.write.hardwareWriteApproved, true);
  assert.equal(approval.runtime.allAssetBytesBelow, "0x3c1d0000");
  assert.equal(approval.runtime.headroomBytes, 3220);
  assert.equal(approval.runtime.persistentRamBytes, 170276);
  assert.equal(approval.runtime.rendererRpcAcceptancePending, true);
  assert.equal(approval.runtime.heapTelemetryAccepted, false);
  assert.equal(approval.runtime.singleSceneStoreAccepted, false);
  assert.equal(approval.runtime.screen26VisualAcceptancePending, true);
  assert.equal(approval.runtime.newDromAssets, false);
});
