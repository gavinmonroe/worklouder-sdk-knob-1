import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { inspectEsp32AppImage } from "../../custom-firmware/lib/esp-app-image.mjs";
import {
  buildCombinedRendererV2Firmware,
  LIVE_RENDER_V2_BASE,
} from "../src/combined-renderer-v2-firmware.mjs";
import { validateDeviceApproval } from "../src/device-workflow.mjs";
import { PINNED } from "../src/constants.mjs";
import { missingRecoveryBackup } from "../test-support/pinned-inputs.mjs";
import {
  buildRenderV2HostEventExpression,
  normalizeRenderV2HostEvent,
} from "../examples/render-v2-events/host-event-rpc.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const nativeSource = path.join(root, "custom-firmware/experimental/renderer-v2-f2ep-native.c");
const rollbackPath = path.join(root,
  "f1-widget-sdk/build/rollbacks/framer-0.4.1-live-7838eea0-clock-timer-app.bin");
const receiptPath = path.join(root,
  "f1-widget-sdk/build/device-receipts/device-1786936722535-fast-smoke.json");

async function fixture(context) {
  const output = await mkdtemp(path.join(os.tmpdir(), "f1-render-v2-combined-test-"));
  context.after(() => rm(output, { recursive: true, force: true }));
  const rejectedNames = ["renderer-v2-irom-trampoline.bin", "renderer-v2-irom-trampoline.S",
    "renderer-v2-irom-trampoline.ld", "renderer-v2-irom-trampoline-disassembly.txt",
    "renderer-v2-drom-page.bin"];
  await Promise.all(rejectedNames.map((name) => writeFile(path.join(output, name), "UNSAFE_IRAM_STALE")));
  const result = await buildCombinedRendererV2Firmware({ outputDirectory: output,
    nativeSourcePath: nativeSource, nativeContractAccepted: true });
  for (const name of rejectedNames) {
    await assert.rejects(readFile(path.join(output, name)), { code: "ENOENT" });
  }
  return result;
}

test("clock+blue-timer build starts from accepted 7838 and passes exact ID26+ID27 paths", { skip: missingRecoveryBackup() }, async (context) => {
  const result = await fixture(context);
  const { manifest, approval } = result;
  assert.equal(manifest.status, "DEVICE_SMOKE_CANDIDATE");
  assert.equal(manifest.deployable, true);
  assert.equal(manifest.liveBase.app.sha256, LIVE_RENDER_V2_BASE.appSha256);
  assert.equal(manifest.liveBase.receipt.sha256, LIVE_RENDER_V2_BASE.receiptSha256);
  assert.deepEqual(manifest.target.screenIds,
    { music: 1, wpm: 7, focusClock: 26, focusTimer: 27 });
  assert.equal(manifest.setup.soleWrapper, "f1_combined_setup_wrapper");
  assert.equal(manifest.setup.stockSetupCalls, 1);
  assert.equal(manifest.setup.mutation.address, "0x421170c5");
  assert.equal(manifest.setup.mutation.bytes, 3);
  assert.deepEqual(manifest.setup.order, ["stock", "music_id1_register", "stage3e34_register_wpm",
    "renderer_id26_register", "renderer_v2_decode_assets", "renderer_v2_native_attach",
    "renderer_scene_rpc_register", "renderer_v2_rpc_register"]);
  for (const record of [manifest.preservation.musicLiteral, manifest.preservation.musicText,
    manifest.preservation.wpmLiteral, manifest.preservation.wpmText]) {
    assert.equal(record.preservedByteForByte, true);
  }
  assert.equal(manifest.preservation.rendererV1Behavior.retainedInIntegratedRebuild, true);
  assert.equal(manifest.preservation.allLiveDromAssets.preservedByteForByte, true);
  assert.equal(manifest.preservation.allLiveDromAssets.mutationBytes, 0);
  assert.deepEqual(manifest.rendererV2.golden.frameSha256, [
    "6571fc6cfb349275cd7eff9f613a761879ee2e97231c5998a65fa86fce0bb27d",
    "9f1c6bd9e5036f4ae99b6b1b01673da5f8602a1e95e82a2fd182e4fe30e30c81",
    "47416873a4fb528c7a9ea9803e9deb61f7fc51bbf9de920839e05ded17682ea0",
    "853808133392497d78ec8fdab221312c57a7d41bc284a370a263915dab52b7e1",
    "a606bc0102aaa48a675a026891b9c840e214ab1fb1cae367cddb3be7c93c6c7b",
    "31b4504634f2598d1c3f38faaff4e7227505b596fe8f8235d9ac0fdfc29db159",
    "31b4504634f2598d1c3f38faaff4e7227505b596fe8f8235d9ac0fdfc29db159",
  ]);
  assert.deepEqual(manifest.rendererV2.golden.timerFrameSha256, [
    "d8308c853da7da6745f8fdc6b40b1189bcc379800650671e568d32d65333b165",
    "c5d8e92863e9fd34789429f18f57eaede72419943fe26694b19adc16ecc3df93",
    "d8308c853da7da6745f8fdc6b40b1189bcc379800650671e568d32d65333b165",
    "dbe4e53243da971cf3664ae173ad95a0e9eeb9b827826cf621d426962709638a",
    "59c476eec3aa106ac69410d206cad7eb45855a3077b92d3304450d87e7140981",
    "140f718768620b513ebe28534e7595d5463f6349769423ea09341253ebdcf80f",
    "140f718768620b513ebe28534e7595d5463f6349769423ea09341253ebdcf80f",
  ]);
  assert.match(manifest.rendererV2.golden.fuzzOutput,
    /mutations=2048 structural_bounds=6 frozen_digest=pass/u);
  assert.match(manifest.rendererV2.golden.scenarioOutput, /fn=3 rpc=1 fail_last_good=1/u);
  assert.match(manifest.rendererV2.golden.transitionOutput,
    /generation_pair=pass.*error_gate=closed.*null_prepare=reject/u);
  assert.match(manifest.rendererV2.golden.wallRuntimeOutput,
    /malformed_bcd_last_good=1.*polls=7/u);
  assert.equal(manifest.rendererV2.baseScene.bytes, 748);
  assert.equal(manifest.rendererV2.baseScene.sha256,
    "5f1edc6879adcec0d25d5e6c999bfc80e19089aa05a72fbd14f3f5acd8899f2e");
  assert.equal(manifest.rendererV2.program.sha256,
    "af34f7f98587d31929799e3218beb47582a0ec796085f4d36859d37a60469b08");
  assert.equal(manifest.rendererV2.rpc.method, "widget.v2.event");
  assert.equal(manifest.rendererV2.rpc.fixedEventId, 0xb201);
  assert.equal(manifest.rendererV2.focusDial.generationTwoPackage.sha256,
    "5b1b9a068e33b8b09f0596b49df0b7f79e22f05ee1f21ce7939b6c6965753ac7");
  assert.equal(manifest.rendererV2.focusDial.sceneStore.immutableAfterCommit, true);
  assert.equal(manifest.rendererV2.focusDial.sceneStore.packageBytes, 95_535);
  assert.equal(manifest.rendererV2.focusDial.sceneStore.chunks, 32);
  assert.equal(manifest.rendererV2.focusDial.sceneStore.finalChunkBytes, 303);
  assert.equal(manifest.rendererV2.focusTimer.screenId, 27);
  assert.equal(manifest.rendererV2.focusTimer.input.stepSeconds, 300);
  assert.equal(manifest.rendererV2.focusTimer.lifecycle.hiddenPolicy, "pause");
  assert.equal(manifest.rendererV2.rtc.hostClockSyncRequired, false);
  assert.equal(approval.write.hardwareWriteApproved, true);
  assert.equal(approval.rollback.mode, "accepted-live-receipt-v1");
  assert.equal(approval.rollback.sha256, LIVE_RENDER_V2_BASE.appSha256);
  assert.equal(manifest.flash.scope, "factory-app-only");
  assert.match(manifest.flash.command, /--rollback .*live-7838eea0.* --confirm-app-only$/u);
  assert.match(manifest.flash.postFlashProvisionCommand,
    /push-focus-timer-package\.mjs --confirm-live-rpc$/u);
});

test("combined mutation replaces only the renderer cavity plus bounded call and preserves 7838 DROM", { skip: missingRecoveryBackup() }, async (context) => {
  const result = await fixture(context);
  const [liveApp, candidateApp, module, compressedAssets] = await Promise.all([
    readFile(rollbackPath), readFile(result.appPath), readFile(result.modulePath),
    readFile(result.compressedAssetsPath),
  ]);
  const live = inspectEsp32AppImage(liveApp);
  const candidate = inspectEsp32AppImage(candidateApp);
  for (let index = 1; index < live.segmentCount; index += 1) {
    if (index !== PINNED.iromSegmentIndex && index !== PINNED.dromSegmentIndex) {
      assert.ok(candidate.segments[index].data.equals(live.segments[index].data));
    }
    assert.equal(candidate.segments[index].dataOffset, live.segments[index].dataOffset);
    assert.equal(candidate.segments[index].length, live.segments[index].length);
  }
  const liveDrom = live.segments[PINNED.dromSegmentIndex];
  const candidateDrom = candidate.segments[PINNED.dromSegmentIndex];
  const compressedOffset = 0x3c1cf400 - liveDrom.loadAddress;
  assert.ok(liveDrom.data.subarray(compressedOffset,
    compressedOffset + compressedAssets.length).equals(compressedAssets));
  assert.ok(candidateDrom.data.equals(liveDrom.data));
  assert.ok(candidate.segments[2].data.equals(live.segments[2].data));
  const liveIrom = live.segments[PINNED.iromSegmentIndex].data;
  const candidateIrom = candidate.segments[PINNED.iromSegmentIndex].data;
  const codeStart = liveIrom.length - LIVE_RENDER_V2_BASE.codeBytes;
  assert.ok(candidateIrom.subarray(0, codeStart).equals(liveIrom.subarray(0, codeStart)));
  const liveCode = liveIrom.subarray(codeStart);
  const candidateCode = candidateIrom.subarray(codeStart);
  const patch = LIVE_RENDER_V2_BASE.wrapperChainCallAddress - PINNED.codeBaseAddress;
  assert.ok(candidateCode.subarray(0, patch).equals(liveCode.subarray(0, patch)));
  assert.ok(candidateCode.subarray(patch + 3, liveCode.length)
    .subarray(0, LIVE_RENDER_V2_BASE.rendererModuleOffset - patch - 3)
    .equals(liveCode.subarray(patch + 3, LIVE_RENDER_V2_BASE.rendererModuleOffset)));
  assert.notDeepEqual(candidateCode.subarray(patch, patch + 3), liveCode.subarray(patch, patch + 3));
  assert.ok(candidateCode.subarray(LIVE_RENDER_V2_BASE.rendererModuleOffset,
    LIVE_RENDER_V2_BASE.rendererModuleOffset + module.length).equals(module));
  assert.equal(candidate.segments[PINNED.iromSegmentIndex].loadAddress +
    candidate.segments[PINNED.iromSegmentIndex].length, 0x4211ff18);
  assert.equal(result.manifest.verification.iromDromMmuAliasAvoided, "PASS");
  assert.equal(result.manifest.rendererV2.module.placement.kind, "fixed-cavity-replacement");
  assert.equal(result.manifest.rendererV2.compressedAssets.bytes, 3055);
  assert.equal(result.manifest.rendererV2.compressedAssets.capacity, 3072);
  assert.equal(result.approval.runtime.dromMappingProfile,
    "accepted-7838-blue-timer-animation-reuse-v1");
  assert.equal(result.approval.runtime.dromMutationBytes, 0);
});

test("receipt-backed current-live rollback validates and rejects any receipt mutation", { skip: missingRecoveryBackup() }, async (context) => {
  const result = await fixture(context);
  const [app, rollback, receipt] = await Promise.all([
    readFile(result.appPath), readFile(rollbackPath), readFile(receiptPath),
  ]);
  assert.equal(validateDeviceApproval(result.approval, { appBytes: app, rollbackBytes: rollback,
    rollbackReceiptBytes: receipt }), result.approval);
  const changed = Buffer.from(receipt); changed[changed.length - 2] ^= 1;
  assert.throws(() => validateDeviceApproval(result.approval, { appBytes: app, rollbackBytes: rollback,
    rollbackReceiptBytes: changed }), /receipt bytes/u);
  assert.throws(() => validateDeviceApproval(result.approval, { appBytes: app, rollbackBytes: rollback }),
    /receipt bytes/u);
});

test("host smoke sender emits only the fixed bounded widget.v2.event envelope", () => {
  const expression = buildRenderV2HostEventExpression(-7);
  const match = /Buffer\.from\(("[A-Za-z0-9+/=]+"), "base64"\)/u.exec(expression);
  assert.ok(match);
  const request = JSON.parse(Buffer.from(JSON.parse(match[1]), "base64").toString("utf8"));
  assert.deepEqual(request, { method: "widget.v2.event", params: { id: 0xb201, value: -7 } });
  assert.deepEqual(normalizeRenderV2HostEvent(0x7fffffff), { id: 0xb201, value: 0x7fffffff });
  assert.throws(() => normalizeRenderV2HostEvent(0x80000000), /int32/u);
  assert.doesNotMatch(expression, /write-flash|erase-flash|LVGL/u);
});
