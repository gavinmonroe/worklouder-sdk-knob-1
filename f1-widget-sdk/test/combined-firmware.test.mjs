import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildCombinedFirmware, renderStage3e34RegistrationOnly } from "../src/combined-firmware.mjs";
import { validateDeviceApproval } from "../src/device-workflow.mjs";
import { missingRecoveryBackup, missingToolchain } from "../test-support/pinned-inputs.mjs";

const APP_SHA256 = "b9b8eec6250392f593ae664fa8b8cba64bf861f5ef49a427c65be79e6f355817";
const MERGED_SHA256 = "dbc29e0d74b30c8244fbe5e04960781ed58945e23cea525de0d44428434ebf54";
const CODE_SHA256 = "0f979d32f1a9b1203287cb71518b66367c66a1fa9e51a2c5f06be71bd15a804b";
const REGISTER_SHA256 = "6862764da34424285799e5c91796cd6080fca1adc1374f60f5b171b8d34c6c12";

test("real combined Music ID1 plus WPM ID7 app builds deterministically under one setup wrapper", { skip: missingRecoveryBackup() || missingToolchain() }, async (context) => {
  const output = await mkdtemp(path.join(os.tmpdir(), "f1-sdk-combined-test-"));
  context.after(() => rm(output, { recursive: true, force: true }));
  const result = await buildCombinedFirmware({ outputDirectory: output });
  assert.equal(result.report.status, "OFFLINE_DETERMINISTIC_CANDIDATE_AWAITING_MAIN_APPROVAL");
  assert.equal(result.report.deployable, false);
  assert.deepEqual(result.report.target.screenIds, { music: 1, wpm: 7 });
  assert.equal(result.report.target.prohibitedScreenId, 8);
  assert.equal(result.report.setup.stockSetupCalls, 1);
  assert.deepEqual(result.report.setup.order, ["stock", "music_id1_register", "stage3e34_register_wpm"]);
  assert.equal(result.report.setup.address, "0x42117094");
  assert.equal(result.report.code.bytes, 6332);
  assert.equal(result.report.code.sha256, CODE_SHA256);
  assert.equal(result.report.code.relocations, 0);
  assert.equal(result.report.code.deterministicRebuilds, 2);
  assert.equal(result.report.outputs.app.bytes, 2_032_368);
  assert.equal(result.report.outputs.app.sha256, APP_SHA256);
  assert.equal(result.report.outputs.merged.sha256, MERGED_SHA256);
  assert.equal(result.report.outputs.inspection.segmentCount, 6);
  assert.equal(result.report.outputs.inspection.checksum.value, "0x5a");
  assert.equal(result.report.outputs.inspection.digest.sha256,
    "be056aaecc4ffa27a8593f6c7489dec18efa91e71547c66f3713f9ba28c37c47");
  assert.equal(result.report.wpm.standaloneWrapperLinked, false);
  assert.equal(result.report.wpm.pinnedRegistrationArtifact.sha256, REGISTER_SHA256);
  assert.equal(result.report.registration.musicNavGate, "controller+20 == registry");
  assert.equal(result.report.registration.wpmNavGate, "controller+20 == registry");
  assert.equal(result.report.music.dromBytes, 0);
  assert.deepEqual(result.report.music.mediaRpc, {
    metadata: "mp.write_info", artwork: "mp.write_artwork", transportStateBytes: 87980,
    artworkBytes: 12800, chunkRawBytes: 3072, rpcTaskTouchesLvgl: false,
    rpcStringTableOffset: 25808, rpcStringTableBytes: 152,
    uiThreadGenerationApply: true,
    metadataSynchronization: "odd/even seqlock plus private UI snapshot",
    screenRebuildReplay: true,
  });
  assert.equal(result.report.music.crashContainment,
    "No label-as-panel objects; background image, album image, and three text labels only");
  assert.equal(result.report.wpm.liveCompleteFrozenLinkedBytes.preservedByteForByte, true);
  assert.deepEqual(result.report.verification, {
    abi: "PASS", deterministicBuild: "PASS", checksumDigest: "PASS",
    esptoolImageInfo: "PASS", esptoolImageInfoSha256: result.report.verification.esptoolImageInfoSha256,
    rollbackPreflight: "PASS",
  });
  assert.equal(result.report.bases.exactC1AppSha256,
    "e2e7ba4ab4b9c247af8c0bdc3d7896ac52967bb7f90fb19beae73c0ae4a2b8fd");
  assert.equal(result.report.bases.recovery.sha256,
    "aa6042310d075c9cbd3b992044511c064bb4b84713d0740a3adafcbdb3028fdd");
  assert.equal(result.report.cache.build, "miss");
  const cached = await buildCombinedFirmware({ outputDirectory: output });
  assert.equal(cached.report.cache.build, "hit");
  assert.equal(cached.report.outputs.app.sha256, APP_SHA256);
});

test("combined linker uses original WPM source and owner-reviewed setup-section discard", async () => {
  const source = await readFile(new URL("../../custom-firmware/experimental/stage3e34-wpm-pet.S", import.meta.url), "utf8");
  assert.equal(renderStage3e34RegistrationOnly(source), source,
    "textual deletion would change Xtensa relaxation and is forbidden");
  assert.match(source, /\.section \.literal\.stage3e34_setup/u);
  assert.match(source, /\.section \.text\.stage3e34_setup/u);
  assert.match(source, /\.global stage3e34_register_wpm/u);
});

test("generated approval is a non-deployable draft until main approval", { skip: missingRecoveryBackup() || missingToolchain() }, async (context) => {
  const output = await mkdtemp(path.join(os.tmpdir(), "f1-sdk-combined-draft-test-"));
  context.after(() => rm(output, { recursive: true, force: true }));
  const result = await buildCombinedFirmware({ outputDirectory: output });
  const [approval, app, rollback] = await Promise.all([
    readFile(result.approvalDraftPath, "utf8").then(JSON.parse), readFile(result.appPath),
    readFile(new URL("../../custom-firmware/build/framer-0.4.1-stage3e3a-i4-canary-app.bin", import.meta.url)),
  ]);
  assert.equal(approval.status, "AWAITING_MAIN_APPROVAL");
  assert.equal(approval.write.hardwareWriteApproved, false);
  assert.throws(() => validateDeviceApproval(approval, { appBytes: app, rollbackBytes: rollback }),
    /explicitly authorize|DEVICE_SMOKE_CANDIDATE/u);
});
