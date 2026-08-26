import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { EXPECTED_STAGE3E3A_APP_SHA256 } from "../../custom-firmware/build-stage3e3a.mjs";
import { inspectEsp32AppImage } from "../../custom-firmware/lib/esp-app-image.mjs";
import { PINNED, SDK_ROOT, WORKSPACE_ROOT } from "./constants.mjs";
import { inspectImage } from "./firmware.mjs";
import { STAGE3E3_PATHS, verifyRecoveryGate } from "./stage3e3.mjs";
import { assert, sha256, stableJson } from "./util.mjs";

const exec = promisify(execFile);
const EXPECTED_MAC = "a4:cb:8f:af:32:10";
const NORMAL_PROBE = path.join(WORKSPACE_ROOT, "recovery/verify-live-firmware.mjs");
const ENTER_BOOTLOADER = path.join(WORKSPACE_ROOT, "recovery/enter-bootloader.mjs");
const PORT_PATTERN = /^cu\.(?:usbmodem|usbserial)[A-Za-z0-9._-]*$/u;
const FORBIDDEN_TOOL_ARGS = new Set([
  "erase-flash", "erase-region", "erase-all", "--erase-all", "--force", "--encrypt",
  "--ignore-flash-enc-efuse", "merge-bin",
]);

export const DEVICE_APPROVAL_FORMAT = "framer-f1-device-candidate-v1";
export const ACCEPTED_LIVE_ROLLBACKS = Object.freeze({
  "3d821fbc31053f39d49dd945164cf7399a3632d5bbb8a193dd0f7b110d376906": Object.freeze({
    proofId: "framer-f1-0.4.1-music-wpm-renderer-id26-49cbf880",
    appBytes: 2_062_912,
    appSha256: "49cbf8801e3d86b20e0df21f41a2410b3e4d8547f8f64021ca6ed4bd85168840",
    recoveryBytes: 16_777_216,
    recoverySha256: "aa6042310d075c9cbd3b992044511c064bb4b84713d0740a3adafcbdb3028fdd",
  }),
  "6457f02906008fca27c54e03f0d29a48a32b09cb8554b3cd9e6c9edfbdf824dc": Object.freeze({
    proofId: "framer-f1-0.4.1-music-wpm-renderer-v2-7ad9054a",
    appBytes: 2_062_912,
    appSha256: "7ad9054ad11f65aea130776b405c3228766a70d38e77988524795d728dd420b6",
    recoveryBytes: 16_777_216,
    recoverySha256: "aa6042310d075c9cbd3b992044511c064bb4b84713d0740a3adafcbdb3028fdd",
  }),
  "1f613e2f375692283c3285b742b88f0a4ab8415712281b30de2ad3b676a28523": Object.freeze({
    proofId: "framer-f1-0.4.1-music-wpm-renderer-v2-focus-dial-49590ca4",
    receiptFile: path.join(SDK_ROOT,
      "build/device-receipts/device-1786932732117-fast-smoke.json"),
    receiptBytes: 2_397,
    receiptSha256: "1f613e2f375692283c3285b742b88f0a4ab8415712281b30de2ad3b676a28523",
    device: "knob_f1",
    firmware: "0.4.1",
    mac: EXPECTED_MAC,
    appBytes: 2_062_912,
    appSha256: "49590ca4dc0a26c5b998a83d217eb4e2d0b4586f5894cad00d9b48defd7eacf4",
    recoveryBytes: 16_777_216,
    recoverySha256: "aa6042310d075c9cbd3b992044511c064bb4b84713d0740a3adafcbdb3028fdd",
  }),
  "792f03f487d062d25d340b52b16b7e820592bb6b1c2f66f2824a83056bd0e5e0": Object.freeze({
    proofId: "framer-f1-0.4.1-music-wpm-renderer-v2-clock-timer-7838eea0",
    receiptFile: path.join(SDK_ROOT,
      "build/device-receipts/device-1786936722535-fast-smoke.json"),
    receiptBytes: 2_403,
    receiptSha256: "792f03f487d062d25d340b52b16b7e820592bb6b1c2f66f2824a83056bd0e5e0",
    device: "knob_f1",
    firmware: "0.4.1",
    mac: EXPECTED_MAC,
    appBytes: 2_062_912,
    appSha256: "7838eea09b7e712a76cbdb5786efa3752079a852aa0bcad49d4cd8c596b070e5",
    recoveryBytes: 16_777_216,
    recoverySha256: "aa6042310d075c9cbd3b992044511c064bb4b84713d0740a3adafcbdb3028fdd",
  }),
  "1363d31eabba2b61e068d760d966ab25f8b17d1c635a4c91ba7ecd2a0de238e9": Object.freeze({
    proofId: "framer-f1-0.4.1-renderer-v2-blue-clock-timer-36317013",
    receiptFile: path.join(SDK_ROOT,
      "build/device-receipts/device-1786939039376-fast-smoke.json"),
    receiptBytes: 2_414,
    receiptSha256: "1363d31eabba2b61e068d760d966ab25f8b17d1c635a4c91ba7ecd2a0de238e9",
    device: "knob_f1",
    firmware: "0.4.1",
    mac: EXPECTED_MAC,
    appBytes: 2_062_912,
    appSha256: "363170139a06f306be1e894b6f203a9bf03bf4d70d21194aaccdd1c42f760c32",
    recoveryBytes: 16_777_216,
    recoverySha256: "aa6042310d075c9cbd3b992044511c064bb4b84713d0740a3adafcbdb3028fdd",
  }),
});
export const DEVICE_WORKFLOW = Object.freeze({
  deviceType: "knob_f1", firmware: "0.4.1", chip: "ESP32-S3", mac: EXPECTED_MAC,
  appOffset: 0x10000, writeBaud: 921600, readbackBaud: 115200,
  smoke: "write-hash verification + watchdog boot + read-only health; normally about 1-3 minutes",
  release: "smoke plus full app read-back/hash before watchdog boot; normally about 4-8 minutes",
});

function validateAcceptedLiveRollback(approval, rollbackBytes, receiptBytes) {
  const selected = approval.rollback;
  assert(selected?.mode === "accepted-live-receipt-v1" &&
    typeof selected.receipt?.file === "string" && selected.receipt.file.length > 0 &&
    Number.isInteger(selected.receipt?.bytes) && selected.receipt.bytes > 0 &&
    /^[0-9a-f]{64}$/u.test(selected.receipt?.sha256 ?? ""),
  "Accepted-live rollback approval lacks its exact receipt file/bytes/SHA.");
  assert(Buffer.isBuffer(receiptBytes) && receiptBytes.length === selected.receipt.bytes &&
    sha256(receiptBytes) === selected.receipt.sha256,
  "Accepted-live rollback receipt bytes differ from the approval.");
  const pinned = ACCEPTED_LIVE_ROLLBACKS[selected.receipt.sha256];
  assert(pinned, "Accepted-live rollback receipt is not in the immutable SDK proof registry.");
  if (pinned.receiptFile !== undefined) {
    assert(path.resolve(selected.receipt.file) === pinned.receiptFile &&
      selected.receipt.bytes === pinned.receiptBytes &&
      selected.receipt.sha256 === pinned.receiptSha256,
    "Accepted-live rollback receipt path/bytes/SHA differ from the immutable SDK proof.");
  }
  let receipt;
  try { receipt = JSON.parse(receiptBytes.toString("utf8")); } catch {
    throw new Error("Accepted-live rollback receipt is not valid JSON.");
  }
  assert(selected.bytes === rollbackBytes.length && selected.sha256 === sha256(rollbackBytes) &&
    selected.bytes === pinned.appBytes && selected.sha256 === pinned.appSha256,
  "Accepted-live rollback app differs from the pinned physical app proof.");
  assert(receipt?.format === "framer-f1-device-deployment-receipt-v1" &&
    ["fast-smoke", "release-full-readback"].includes(receipt.mode) &&
    receipt.target?.device === (pinned.device ?? "knob_f1") &&
    receipt.target?.firmware === (pinned.firmware ?? "0.4.1") &&
    receipt.target?.mac?.toLowerCase() === (pinned.mac ?? EXPECTED_MAC) &&
    receipt.app?.bytes === pinned.appBytes && receipt.app?.sha256 === pinned.appSha256 &&
    receipt.app?.flashOffset === "0x10000" && receipt.write?.appOnly === true &&
    receipt.write?.hashVerifiedByEsptool === true &&
    receipt.postBoot?.device?.deviceType === "knob_f1" &&
    receipt.postBoot?.device?.isUsbConnection === true && deviceVersion(receipt.postBoot) === "0.4.1" &&
    receipt.recovery?.bytes === pinned.recoveryBytes && receipt.recovery?.sha256 === pinned.recoverySha256,
  "Accepted-live rollback receipt is not a healthy same-device app-only physical proof.");
  return pinned;
}

function mmuPageIndices(segment) {
  const output = new Set();
  const first = segment.loadAddress >>> 16;
  const last = (segment.loadAddress + segment.length - 1) >>> 16;
  for (let page = first; page <= last; page += 1) output.add(page & 0xff);
  return output;
}

function validateRendererV2TerminalDrom(approval, appBytes, rollbackBytes) {
  const runtime = approval.runtime;
  assert(runtime?.dromMappingProfile === "renderer-v2-terminal-page-v1" &&
    runtime.allAssetBytesBelow === "0x3c1e0000" && runtime.newDromAssets === true &&
    runtime.dromExtensionBytes === 0x10000 && runtime.acceptedDromPrefixBytes === 0xb1170 &&
    runtime.acceptedIromBytes === 0x11fef8 && runtime.iromEndExclusive === "0x42120000",
  "Render-v2 terminal-DROM approval lacks its exact mapping profile.");
  const candidate = inspectEsp32AppImage(appBytes);
  const live = inspectEsp32AppImage(rollbackBytes);
  assert(candidate.segmentCount === 6 && live.segmentCount === 6,
    "Render-v2 terminal-DROM profile requires the accepted six-segment image shape.");
  const candidateDrom = candidate.segments[PINNED.dromSegmentIndex];
  const liveDrom = live.segments[PINNED.dromSegmentIndex];
  const candidateIrom = candidate.segments[PINNED.iromSegmentIndex];
  const liveIrom = live.segments[PINNED.iromSegmentIndex];
  const mapPatch = runtime.runtimeMapPatch;
  assert(mapPatch?.rodataEndOffset === "0x914" &&
    mapPatch?.psramOffsets?.length === 2 && mapPatch.psramOffsets[0] === "0xbdd18" &&
    mapPatch.psramOffsets[1] === "0xbdd1c" && mapPatch.psramStartValue === "0x3c1e0000",
  "Render-v2 approval lacks the exact three-word cpu_start/PSRAM mapping patch.");
  assert(candidateDrom.loadAddress === 0x3c120020 && liveDrom.loadAddress === 0x3c120020 &&
    liveDrom.length === runtime.acceptedDromPrefixBytes &&
    candidateDrom.length === liveDrom.length + runtime.dromExtensionBytes &&
    candidateDrom.data.subarray(0, liveDrom.length).equals(liveDrom.data),
  "Render-v2 candidate changed the accepted DROM prefix or extension size.");
  assert(candidateIrom.loadAddress === liveIrom.loadAddress &&
    candidateIrom.length === liveIrom.length && candidateIrom.length === runtime.acceptedIromBytes &&
    candidateIrom.loadAddress + candidateIrom.length === 0x4211ff18,
  "Render-v2 candidate changed the accepted IROM mapping range.");
  for (let index = 1; index < live.segmentCount; index += 1) {
    assert(candidate.segments[index].loadAddress === live.segments[index].loadAddress &&
      candidate.segments[index].length === live.segments[index].length &&
      candidate.segments[index].dataOffset - live.segments[index].dataOffset === 0x10000,
    `Render-v2 one-page DROM insertion changed segment ${index} mapping/congruence.`);
    if (index !== PINNED.iromSegmentIndex && index !== 2) {
      assert(candidate.segments[index].data.equals(live.segments[index].data),
        `Render-v2 candidate changed preserved segment ${index}.`);
    }
  }
  const liveIram = live.segments[2];
  const candidateIram = candidate.segments[2];
  const expectedIram = Buffer.from(liveIram.data);
  const rodataEndValue = Number.parseInt(mapPatch.rodataEndValue, 16);
  assert(liveIram.data.readUInt32LE(0x914) === 0x3c1c1190 &&
    Number.isInteger(rodataEndValue) && rodataEndValue > 0x3c1d0000 &&
    rodataEndValue < 0x3c1e0000,
  "Render-v2 accepted rodata-end literal or approved replacement is invalid.");
  expectedIram.writeUInt32LE(rodataEndValue, 0x914);
  assert(candidateIram.data.equals(expectedIram),
    "Render-v2 candidate changed IRAM beyond the one cpu_start rodata-end literal.");
  assert(liveIrom.data.readUInt32LE(0xbdd18) === 0x3c1d0000 &&
    liveIrom.data.readUInt32LE(0xbdd1c) === 0x3c1d0000 &&
    candidateIrom.data.readUInt32LE(0xbdd18) === 0x3c1e0000 &&
    candidateIrom.data.readUInt32LE(0xbdd1c) === 0x3c1e0000,
  "Render-v2 exact PSRAM-boundary literals were not shifted to 0x3c1e0000.");
  assert((candidateDrom.dataOffset & 0xffff) === (candidateDrom.loadAddress & 0xffff) &&
    (candidateIrom.dataOffset & 0xffff) === (candidateIrom.loadAddress & 0xffff),
  "Render-v2 DROM/IROM physical/virtual low-16 congruence failed.");
  const dromPages = mmuPageIndices(candidateDrom);
  const iromPages = mmuPageIndices(candidateIrom);
  assert([...dromPages].every((page) => !iromPages.has(page)),
    "Render-v2 candidate aliases one ESP32-S3 DROM/IROM MMU index.");
  for (const [name, expected] of [["baseBundle", runtime.baseBundle], ["f2ep", runtime.f2ep]]) {
    assert(typeof expected?.address === "string" && /^0x[0-9a-f]+$/u.test(expected.address) &&
      Number.isInteger(expected.bytes) && expected.bytes > 0 && /^[0-9a-f]{64}$/u.test(expected.sha256),
    `Render-v2 approval lacks exact ${name} address/bytes/SHA.`);
    const address = Number.parseInt(expected.address, 16);
    const offset = address - candidateDrom.loadAddress;
    assert(address >= 0x3c1d0000 && address + expected.bytes <= 0x3c1e0000 &&
      offset >= 0 && offset + expected.bytes <= candidateDrom.length &&
      sha256(candidateDrom.data.subarray(offset, offset + expected.bytes)) === expected.sha256,
    `Render-v2 ${name} bytes escaped the accepted terminal DROM page or changed.`);
  }
  assert(rodataEndValue === Number.parseInt(runtime.f2ep.address, 16) + runtime.f2ep.bytes,
    "Render-v2 cpu_start DROM end does not equal the exact immutable asset end.");
  assert(Number.isInteger(runtime.headroomBytes) && runtime.headroomBytes > 0,
    "Render-v2 terminal DROM page has no positive asset headroom.");
}

function validateRendererV2MappedPrefixLzss(approval, appBytes, rollbackBytes) {
  const runtime = approval.runtime;
  const blob = runtime?.compressedAssets;
  assert(runtime?.dromMappingProfile === "renderer-v2-mapped-prefix-lzss-v1" &&
    runtime.allAssetBytesBelow === "0x3c1d0000" && runtime.newDromAssets === true &&
    runtime.dromExtensionBytes === 0 && runtime.acceptedDromPrefixBytes === 0xb1170 &&
    runtime.acceptedIromBytes === 0x11fef8 && runtime.iromEndExclusive === "0x42120000" &&
    runtime.runtimeMapPatch === null && runtime.decodedAssetRamBytes === 10284,
  "Render-v2 mapped-prefix approval lacks its exact LZSS/runtime profile.");
  assert(blob?.address === "0x3c1cf400" && blob.capacity === 3072 &&
    Number.isInteger(blob.bytes) && blob.bytes > 0 && blob.bytes <= blob.capacity &&
    blob.decodedBytes === runtime.decodedAssetRamBytes &&
    /^[0-9a-f]{64}$/u.test(blob.sha256) && /^[0-9a-f]{64}$/u.test(blob.decodedSha256) &&
    runtime.headroomBytes === blob.capacity - blob.bytes && runtime.headroomBytes > 0,
  "Render-v2 mapped-prefix compressed blob bounds/hash metadata are invalid.");
  const candidate = inspectEsp32AppImage(appBytes);
  const live = inspectEsp32AppImage(rollbackBytes);
  assert(candidate.segmentCount === 6 && live.segmentCount === 6 && appBytes.length === rollbackBytes.length,
    "Render-v2 mapped-prefix profile requires the unchanged six-segment app shape.");
  for (let index = 0; index < live.segmentCount; index += 1) {
    assert(candidate.segments[index].loadAddress === live.segments[index].loadAddress &&
      candidate.segments[index].length === live.segments[index].length &&
      candidate.segments[index].dataOffset === live.segments[index].dataOffset,
    `Render-v2 mapped-prefix candidate changed segment ${index} layout.`);
    if (index !== PINNED.dromSegmentIndex && index !== PINNED.iromSegmentIndex) {
      assert(candidate.segments[index].data.equals(live.segments[index].data),
        `Render-v2 mapped-prefix candidate changed preserved segment ${index}.`);
    }
  }
  const candidateDrom = candidate.segments[PINNED.dromSegmentIndex];
  const liveDrom = live.segments[PINNED.dromSegmentIndex];
  const offset = Number.parseInt(blob.address, 16) - liveDrom.loadAddress;
  assert(candidateDrom.loadAddress === 0x3c120020 && liveDrom.length === runtime.acceptedDromPrefixBytes &&
    offset >= 0 && offset + blob.capacity <= liveDrom.length &&
    liveDrom.data.subarray(offset, offset + blob.capacity).every((value) => value === 0) &&
    candidateDrom.data.subarray(0, offset).equals(liveDrom.data.subarray(0, offset)) &&
    sha256(candidateDrom.data.subarray(offset, offset + blob.bytes)) === blob.sha256 &&
    candidateDrom.data.subarray(offset + blob.bytes).equals(liveDrom.data.subarray(offset + blob.bytes)),
  "Render-v2 mapped-prefix candidate escaped the exact all-zero DROM page-1C slot.");
  const candidateIrom = candidate.segments[PINNED.iromSegmentIndex];
  const liveIrom = live.segments[PINNED.iromSegmentIndex];
  assert(candidateIrom.length === runtime.acceptedIromBytes &&
    candidateIrom.loadAddress + candidateIrom.length === 0x4211ff18 &&
    candidateIrom.data.readUInt32LE(0xbdd18) === liveIrom.data.readUInt32LE(0xbdd18) &&
    candidateIrom.data.readUInt32LE(0xbdd1c) === liveIrom.data.readUInt32LE(0xbdd1c) &&
    candidate.segments[2].data.readUInt32LE(0x914) === live.segments[2].data.readUInt32LE(0x914),
  "Render-v2 mapped-prefix candidate changed an accepted DROM/PSRAM runtime-map literal.");
  const dromPages = mmuPageIndices(candidateDrom);
  const iromPages = mmuPageIndices(candidateIrom);
  assert([...dromPages].every((page) => !iromPages.has(page)),
    "Render-v2 mapped-prefix candidate aliases one ESP32-S3 DROM/IROM MMU index.");
}

function validateRendererV2Accepted7adReuse(approval, appBytes, rollbackBytes) {
  const runtime = approval.runtime;
  const blob = runtime?.compressedAssets;
  const wrapper = runtime?.wrapperCall;
  assert(runtime?.dromMappingProfile === "accepted-7ad-page1c-bootstrap-reuse-v1" &&
    runtime.allAssetBytesBelow === "0x3c1d0000" && runtime.newDromAssets === false &&
    runtime.dromMutationBytes === 0 && runtime.dromExtensionBytes === 0 &&
    runtime.acceptedDromPrefixBytes === 0xb1170 && runtime.acceptedIromBytes === 0x11fef8 &&
    runtime.iromEndExclusive === "0x42120000" && runtime.runtimeMapPatch === null &&
    runtime.decodedAssetRamBytes === 10_284 && runtime.baseBundleBytes === 748 &&
    runtime.f2epBytes === 9_536 && runtime.focusSceneStoreBytes === 98_304 &&
    runtime.focusPackageBytes === 77_566 &&
    runtime.focusPackageSha256 === "2845673ea5020a5fa4658f5e38ee23a9d408ec05956e61d77c437d5fdfddc776" &&
    runtime.focusUploadOncePerBoot === true,
  "Focus-dial approval lacks its exact accepted-7ad reuse profile.");
  assert(blob?.address === "0x3c1cf400" && blob.bytes === 3_055 && blob.capacity === 3_072 &&
    blob.sha256 === "843d7848a8ad206b2314e2a3025ba0b50b78dfa537d6909e8f5c456a69885337" &&
    blob.decodedBytes === 10_284 &&
    blob.decodedSha256 === "1b01bbba47f7462abad20dbf3fc572b22f25806900a8c6f7823c579792309ca5" &&
    runtime.headroomBytes === 17,
  "Focus-dial approval lost the exact inherited page1C bootstrap blob.");
  assert(runtime.integratedIromModuleAddress === "0x421187cc" &&
    runtime.integratedIromEntryAddress === "0x42118c00" &&
    runtime.integratedIromModuleBytes === 22_032 && runtime.integratedIromCavityBytes === 30_540 &&
    runtime.integratedIromModuleSha256 ===
      "96f16c2062e1ee0662adf9a9964b2146789b8bef7a709197beb3965f5dbb5f98" &&
    wrapper?.address === "0x421170c5" && wrapper.acceptedBytes === "25aa01" &&
    wrapper.candidateBytes === "a5b301",
  "Focus-dial approval lost its exact bounded IROM cavity/call mutation.");

  const candidate = inspectEsp32AppImage(appBytes);
  const live = inspectEsp32AppImage(rollbackBytes);
  assert(candidate.segmentCount === 6 && live.segmentCount === 6 && appBytes.length === rollbackBytes.length,
    "Focus-dial profile requires the accepted six-segment app shape.");
  for (let index = 0; index < live.segmentCount; index += 1) {
    assert(candidate.segments[index].loadAddress === live.segments[index].loadAddress &&
      candidate.segments[index].length === live.segments[index].length &&
      candidate.segments[index].dataOffset === live.segments[index].dataOffset,
    `Focus-dial candidate changed segment ${index} layout.`);
    if (index !== PINNED.iromSegmentIndex) {
      assert(candidate.segments[index].data.equals(live.segments[index].data),
        `Focus-dial candidate changed accepted segment ${index}.`);
    }
  }
  const liveDrom = live.segments[PINNED.dromSegmentIndex];
  const blobOffset = Number.parseInt(blob.address, 16) - liveDrom.loadAddress;
  assert(blobOffset >= 0 && blobOffset + blob.capacity <= liveDrom.length &&
    sha256(liveDrom.data.subarray(blobOffset, blobOffset + blob.bytes)) === blob.sha256 &&
    liveDrom.data.subarray(blobOffset + blob.bytes, blobOffset + blob.capacity)
      .every((value) => value === 0),
  "Focus-dial accepted 7ad page1C bootstrap bytes changed.");

  const candidateIrom = candidate.segments[PINNED.iromSegmentIndex];
  const liveIrom = live.segments[PINNED.iromSegmentIndex];
  const wrapperOffset = Number.parseInt(wrapper.address, 16) - liveIrom.loadAddress;
  const moduleOffset = Number.parseInt(runtime.integratedIromModuleAddress, 16) - liveIrom.loadAddress;
  assert(wrapperOffset >= 0 && moduleOffset > wrapperOffset + 3 &&
    candidateIrom.data.subarray(0, wrapperOffset).equals(liveIrom.data.subarray(0, wrapperOffset)) &&
    liveIrom.data.subarray(wrapperOffset, wrapperOffset + 3).toString("hex") === wrapper.acceptedBytes &&
    candidateIrom.data.subarray(wrapperOffset, wrapperOffset + 3).toString("hex") === wrapper.candidateBytes &&
    candidateIrom.data.subarray(wrapperOffset + 3, moduleOffset)
      .equals(liveIrom.data.subarray(wrapperOffset + 3, moduleOffset)),
  "Focus-dial candidate escaped the exact wrapper-call prefix mutation.");
  const cavityEnd = moduleOffset + runtime.integratedIromCavityBytes;
  assert(cavityEnd === candidateIrom.length &&
    sha256(candidateIrom.data.subarray(moduleOffset,
      moduleOffset + runtime.integratedIromModuleBytes)) === runtime.integratedIromModuleSha256 &&
    candidateIrom.data.subarray(moduleOffset + runtime.integratedIromModuleBytes, cavityEnd)
      .every((value) => value === 0),
  "Focus-dial candidate escaped the exact fixed IROM cavity replacement.");
  assert(candidateIrom.data.readUInt32LE(0xbdd18) === liveIrom.data.readUInt32LE(0xbdd18) &&
    candidateIrom.data.readUInt32LE(0xbdd1c) === liveIrom.data.readUInt32LE(0xbdd1c) &&
    candidate.segments[2].data.readUInt32LE(0x914) === live.segments[2].data.readUInt32LE(0x914),
  "Focus-dial candidate changed an accepted DROM/PSRAM runtime-map literal.");
  const dromPages = mmuPageIndices(liveDrom);
  const iromPages = mmuPageIndices(candidateIrom);
  assert([...dromPages].every((page) => !iromPages.has(page)),
    "Focus-dial candidate aliases one ESP32-S3 DROM/IROM MMU index.");
}

function validateRendererV2Accepted49590FocusTimerReuse(approval, appBytes, rollbackBytes) {
  const runtime = approval.runtime;
  const blob = runtime?.compressedAssets;
  const wrapper = runtime?.wrapperCall;
  const rtc = runtime?.rtc;
  assert(approval.app?.bytes === 2_062_912 && approval.app.sha256 ===
      "7838eea09b7e712a76cbdb5786efa3752079a852aa0bcad49d4cd8c596b070e5" &&
    approval.rollback?.bytes === 2_062_912 && approval.rollback.sha256 ===
      "49590ca4dc0a26c5b998a83d217eb4e2d0b4586f5894cad00d9b48defd7eacf4",
  "Focus-timer approval is not pinned to the frozen candidate and accepted 49590 rollback.");
  assert(runtime?.dromMappingProfile === "accepted-49590-focus-timer-reuse-v1" &&
    runtime.allAssetBytesBelow === "0x3c1d0000" && runtime.headroomBytes === 17 &&
    runtime.newDromAssets === false && runtime.dromMutationBytes === 0 &&
    runtime.dromExtensionBytes === 0 && runtime.acceptedDromPrefixBytes === 725_360 &&
    runtime.acceptedIromBytes === 1_179_384 && runtime.iromEndExclusive === "0x42120000" &&
    runtime.runtimeMapPatch === null && runtime.borrowedFramebufferBytes === 62_000 &&
    runtime.extraFramebufferBytes === 0 && runtime.sidecarAllocationBytes === 1_284 &&
    runtime.timerProxyAllocationBytes === 136 && runtime.baseBundleBytes === 748 &&
    runtime.f2epBytes === 9_536 && runtime.decodedAssetRamBytes === 10_284 &&
    runtime.focusSceneStoreBytes === 98_304 && runtime.focusTimerPackageBytes === 92_806 &&
    runtime.focusTimerPackageSha256 ===
      "d618954f7c70e8eaf24e5b5bd0cb89cc3db65a416a15422dec0116742f9b1480" &&
    runtime.focusTimerPackageChunks === 31 &&
    runtime.generationOneAccountingPackageSha256 ===
      "23fc839f72ce6b3ba4eee669929a139f1e51754a6276ffddc46423997a2bfc40" &&
    runtime.focusF1wbBytes === 62_404 && runtime.focusF1wbSha256 ===
      "d404eb952f42e7667ffe015948c3ebfd2f410856f2815354d8516e7b93e73d68" &&
    runtime.focusF2epBytes === 15_162 && runtime.focusF2epSha256 ===
      "6cacd3e546a8ee2792f2df6644cb24e71a56e59af347a9ea93c5fa7be22a8e5f" &&
    runtime.timerF2epBytes === 15_240 && runtime.timerF2epSha256 ===
      "82555e619d6b61db47f2587e1cc3008a60f66ddffa36435aee2c41990dac0455" &&
    runtime.focusF1wbBytes + runtime.focusF2epBytes + runtime.timerF2epBytes ===
      runtime.focusTimerPackageBytes && runtime.focusUploadOncePerBoot === true &&
    runtime.nativeContractAccepted === true &&
    runtime.timerHiddenPolicy === "pause-while-id27-hidden",
  "Focus-timer approval lacks its exact package, memory, or lifecycle contract.");
  assert(runtime.screenIds?.music === 1 && runtime.screenIds?.wpm === 7 &&
    runtime.screenIds?.focusClock === 26 && runtime.screenIds?.focusTimer === 27 &&
    Object.keys(runtime.screenIds).length === 4 &&
    Array.isArray(runtime.manualScreenAcceptancePending) &&
    runtime.manualScreenAcceptancePending.length === 2 &&
    runtime.manualScreenAcceptancePending[0] === 26 &&
    runtime.manualScreenAcceptancePending[1] === 27,
  "Focus-timer approval lost the exact ID1/ID7/ID26/ID27 navigation contract.");
  assert(blob?.address === "0x3c1cf400" && blob.bytes === 3_055 && blob.capacity === 3_072 &&
    blob.sha256 === "843d7848a8ad206b2314e2a3025ba0b50b78dfa537d6909e8f5c456a69885337" &&
    blob.decodedBytes === 10_284 && blob.decodedSha256 ===
      "1b01bbba47f7462abad20dbf3fc572b22f25806900a8c6f7823c579792309ca5",
  "Focus-timer approval lost the inherited page1C bootstrap pin.");
  assert(runtime.integratedIromModuleAddress === "0x421187cc" &&
    runtime.integratedIromEntryAddress === "0x42118c40" &&
    runtime.integratedIromModuleBytes === 23_344 && runtime.integratedIromCavityBytes === 30_540 &&
    runtime.integratedIromModuleSha256 ===
      "750c403518845586929cfcd899bfdd3d07b735f2ce3b4a3910ea00676e93516b" &&
    wrapper?.address === "0x421170c5" && wrapper.acceptedBytes === "a5b301" &&
    wrapper.candidateBytes === "a5b701",
  "Focus-timer approval lost its exact audited module, entry, cavity, or wrapper pin.");
  assert(rtc?.decode?.address === "0x42068f04" && rtc.decode.bytes === 499 &&
    rtc.decode.sha256 === "68b2d186e4ae76f0a074a87988acfb643fe461047ba0c610bbe572a7b546c2aa" &&
    rtc.monotonic?.address === "0x4037e028" && rtc.monotonic.bytes === 24 &&
    rtc.monotonic.sha256 === "75e03adc4a2e9d122f0accb175d4eabbabacf8b20982c9afda3f55f865b3a587" &&
    rtc.freshnessUs === 20_000,
  "Focus-timer approval lost the exact stock RTC/monotonic code pins.");

  const candidate = inspectEsp32AppImage(appBytes);
  const live = inspectEsp32AppImage(rollbackBytes);
  const expectedSegments = [
    [0x3c120020, 725_360, 32,
      "e108e7e3aefc9cccaa1abc22eb9de77026e8a1d9e145e1a8219edb96917c47f1"],
    [0x3fca4f00, 23_136, 725_400,
      "04b0bae3b9d09209cd7d152e5d7cdb3ff6b5ad24560f6386f98effc30f8c62d7"],
    [0x40374000, 37_912, 748_544,
      "0910ab78b191cc60879c62d565c1bc2d1b792dd6d4ba2b4bf1dd93fa541e2d8c"],
    [0x42000020, 1_179_384, 786_464,
      "cafc0eb85518cc33f5215d511e6cf2c6da29a828a395638c2fbc286859c7a916"],
    [0x4037d418, 96_740, 1_965_856,
      "247858cbc0937d3a22b0f596cedf97b125334b0ec1e5f4c75848acd69b22e696"],
    [0x600fe000, 264, 2_062_604,
      "9f83770ff14f9c88f49ebcef1e9294f136fe9112e2f2aec69fd24c137c1dc581"],
  ];
  assert(candidate.segmentCount === expectedSegments.length &&
    live.segmentCount === expectedSegments.length && appBytes.length === rollbackBytes.length,
  "Focus-timer profile requires the exact accepted six-segment app shape.");
  for (let index = 0; index < expectedSegments.length; index += 1) {
    const [address, bytes, dataOffset, liveSha] = expectedSegments[index];
    const candidateSegment = candidate.segments[index];
    const liveSegment = live.segments[index];
    assert(liveSegment.loadAddress === address && liveSegment.length === bytes &&
      liveSegment.dataOffset === dataOffset && sha256(liveSegment.data) === liveSha &&
      candidateSegment.loadAddress === address && candidateSegment.length === bytes &&
      candidateSegment.dataOffset === dataOffset,
    `Focus-timer candidate or rollback changed exact segment ${index} layout/hash.`);
    if (index !== PINNED.iromSegmentIndex) {
      assert(candidateSegment.data.equals(liveSegment.data),
        `Focus-timer candidate changed preserved segment ${index}.`);
    }
  }
  const candidateIrom = candidate.segments[PINNED.iromSegmentIndex];
  const liveIrom = live.segments[PINNED.iromSegmentIndex];
  assert(sha256(candidateIrom.data) ===
    "31805244863b3ed5527e595445f032e3b4d355ccf4db9d92212ce32f860a1e48",
  "Focus-timer candidate IROM differs from the frozen audited segment.");
  const wrapperOffset = Number.parseInt(wrapper.address, 16) - liveIrom.loadAddress;
  const moduleOffset = Number.parseInt(runtime.integratedIromModuleAddress, 16) - liveIrom.loadAddress;
  const moduleEnd = moduleOffset + runtime.integratedIromModuleBytes;
  const cavityEnd = moduleOffset + runtime.integratedIromCavityBytes;
  const entryAddress = Number.parseInt(runtime.integratedIromEntryAddress, 16);
  assert(wrapperOffset >= 0 && moduleOffset > wrapperOffset + 3 &&
    entryAddress >= Number.parseInt(runtime.integratedIromModuleAddress, 16) &&
    entryAddress < Number.parseInt(runtime.integratedIromModuleAddress, 16) +
      runtime.integratedIromModuleBytes &&
    candidateIrom.data.subarray(0, wrapperOffset).equals(liveIrom.data.subarray(0, wrapperOffset)) &&
    liveIrom.data.subarray(wrapperOffset, wrapperOffset + 3).toString("hex") ===
      wrapper.acceptedBytes &&
    candidateIrom.data.subarray(wrapperOffset, wrapperOffset + 3).toString("hex") ===
      wrapper.candidateBytes &&
    candidateIrom.data.subarray(wrapperOffset + 3, moduleOffset)
      .equals(liveIrom.data.subarray(wrapperOffset + 3, moduleOffset)),
  "Focus-timer candidate escaped the exact three-byte wrapper mutation.");
  assert(cavityEnd === candidateIrom.length && moduleEnd <= cavityEnd &&
    sha256(candidateIrom.data.subarray(moduleOffset, moduleEnd)) ===
      runtime.integratedIromModuleSha256 &&
    candidateIrom.data.subarray(moduleEnd, cavityEnd).every((value) => value === 0),
  "Focus-timer candidate escaped the exact audited module plus zero-tail IROM cavity.");

  const liveDrom = live.segments[PINNED.dromSegmentIndex];
  const blobOffset = Number.parseInt(blob.address, 16) - liveDrom.loadAddress;
  assert(blobOffset >= 0 && blobOffset + blob.capacity <= liveDrom.length &&
    sha256(liveDrom.data.subarray(blobOffset, blobOffset + blob.bytes)) === blob.sha256 &&
    liveDrom.data.subarray(blobOffset + blob.bytes, blobOffset + blob.capacity)
      .every((value) => value === 0),
  "Focus-timer inherited page1C bootstrap bytes or zero headroom changed.");
  const rtcOffset = Number.parseInt(rtc.decode.address, 16) - candidateIrom.loadAddress;
  const monotonicAddress = Number.parseInt(rtc.monotonic.address, 16);
  const monotonicSegment = candidate.segments.find((segment) =>
    monotonicAddress >= segment.loadAddress &&
    monotonicAddress + rtc.monotonic.bytes <= segment.loadAddress + segment.length);
  const monotonicOffset = monotonicSegment === undefined ? -1 :
    monotonicAddress - monotonicSegment.loadAddress;
  assert(rtcOffset >= 0 && rtcOffset + rtc.decode.bytes <= candidateIrom.length &&
    sha256(candidateIrom.data.subarray(rtcOffset, rtcOffset + rtc.decode.bytes)) ===
      rtc.decode.sha256 &&
    monotonicOffset >= 0 && monotonicOffset + rtc.monotonic.bytes <= monotonicSegment.length &&
    sha256(monotonicSegment.data.subarray(monotonicOffset,
      monotonicOffset + rtc.monotonic.bytes)) === rtc.monotonic.sha256,
  "Focus-timer candidate changed the pinned stock RTC decoder or monotonic clock code.");
  assert(candidateIrom.data.readUInt32LE(0xbdd18) === liveIrom.data.readUInt32LE(0xbdd18) &&
    candidateIrom.data.readUInt32LE(0xbdd1c) === liveIrom.data.readUInt32LE(0xbdd1c) &&
    candidate.segments[2].data.readUInt32LE(0x914) === live.segments[2].data.readUInt32LE(0x914),
  "Focus-timer candidate changed an accepted DROM/PSRAM runtime-map literal.");
  const dromPages = mmuPageIndices(liveDrom);
  const iromPages = mmuPageIndices(candidateIrom);
  assert([...dromPages].every((page) => !iromPages.has(page)),
    "Focus-timer candidate aliases an ESP32-S3 DROM/IROM MMU index.");
}

function validateRendererV2Accepted7838BlueTimerAnimationReuse(approval, appBytes, rollbackBytes) {
  const runtime = approval.runtime;
  const blob = runtime?.compressedAssets;
  const wrapper = runtime?.wrapperCall;
  const rtc = runtime?.rtc;
  const animation = runtime?.dialAnimation;
  assert(approval.app?.bytes === 2_062_912 && approval.app.sha256 ===
      "363170139a06f306be1e894b6f203a9bf03bf4d70d21194aaccdd1c42f760c32" &&
    approval.rollback?.bytes === 2_062_912 && approval.rollback.sha256 ===
      "7838eea09b7e712a76cbdb5786efa3752079a852aa0bcad49d4cd8c596b070e5",
  "Blue-timer approval is not pinned to the frozen candidate and accepted 7838 rollback.");
  assert(runtime?.dromMappingProfile === "accepted-7838-blue-timer-animation-reuse-v1" &&
    runtime.allAssetBytesBelow === "0x3c1d0000" && runtime.headroomBytes === 17 &&
    runtime.newDromAssets === false && runtime.dromMutationBytes === 0 &&
    runtime.dromExtensionBytes === 0 && runtime.acceptedDromPrefixBytes === 725_360 &&
    runtime.acceptedIromBytes === 1_179_384 && runtime.iromEndExclusive === "0x42120000" &&
    runtime.runtimeMapPatch === null && runtime.borrowedFramebufferBytes === 62_000 &&
    runtime.extraFramebufferBytes === 0 && runtime.sidecarAllocationBytes === 1_300 &&
    runtime.timerProxyAllocationBytes === 136 && runtime.baseBundleBytes === 748 &&
    runtime.f2epBytes === 9_536 && runtime.decodedAssetRamBytes === 10_284 &&
    runtime.focusSceneStoreBytes === 98_304 && runtime.focusTimerPackageBytes === 95_535 &&
    runtime.focusTimerPackageSha256 ===
      "5b1b9a068e33b8b09f0596b49df0b7f79e22f05ee1f21ce7939b6c6965753ac7" &&
    runtime.focusTimerPackageChunks === 32 && runtime.focusTimerPackageLastChunkBytes === 303 &&
    runtime.storeHeadroomBytes === 2_769 &&
    runtime.generationOneAccountingPackageSha256 ===
      "c7a49c9f7a4f709692299cff9239b9f5e0d9cc0c946efc948d3c54b54b1f5102" &&
    runtime.focusF1wbBytes === 62_404 && runtime.focusF1wbSha256 ===
      "fa5580257a2432301acfe87434f277493e3d1a8fd8470d793b8bd9ce66850b18" &&
    runtime.focusF1wbGenerationTwoSha256 ===
      "e518d8c0a528f37961a88fcc2664e6abd90fce5a0f33138c75a2256a58683254" &&
    runtime.focusF2epBytes === 15_178 && runtime.focusF2epSha256 ===
      "b2eadd5884c6ee3b1546ac50c3c077d16eb384adbf1a82631551e69f93705aed" &&
    runtime.timerF2epBytes === 14_618 && runtime.timerF2epSha256 ===
      "80e7ca2e30a56ca12c29320256884c69cdaef7fea27a6468a0cb54122cad8979" &&
    runtime.timerBaseLzssBytes === 3_335 && runtime.timerBaseLzssSha256 ===
      "cae1a0903e8b9ec09880dee05652a354b420cd5966d10b28c0382e40c0427307" &&
    runtime.timerBaseDecodedBytes === 62_000 && runtime.timerBaseDecodedSha256 ===
      "13daabad2f5c578a5ebfed2fceef9dde60ae7f38c8ab51404b34133ef1b4e3e8" &&
    runtime.focusF1wbBytes + runtime.focusF2epBytes + runtime.timerF2epBytes +
      runtime.timerBaseLzssBytes === runtime.focusTimerPackageBytes &&
    runtime.focusSceneStoreBytes - runtime.focusTimerPackageBytes === runtime.storeHeadroomBytes &&
    runtime.timerPalette === "dark-sky-blue" && runtime.headerTopPaddingPx === 4 &&
    animation?.cadenceMs === 1_000 && animation.positions === 5 &&
    animation.clock === true && animation.timer === true && animation.fnImmediate === true &&
    Object.keys(animation).length === 5 && runtime.focusUploadOncePerBoot === true &&
    runtime.nativeContractAccepted === true &&
    runtime.timerHiddenPolicy === "pause-while-id27-hidden",
  "Blue-timer approval lacks its exact package, palette, animation, memory, or lifecycle contract.");
  assert(runtime.screenIds?.music === 1 && runtime.screenIds?.wpm === 7 &&
    runtime.screenIds?.focusClock === 26 && runtime.screenIds?.focusTimer === 27 &&
    Object.keys(runtime.screenIds).length === 4 &&
    Array.isArray(runtime.manualScreenAcceptancePending) &&
    runtime.manualScreenAcceptancePending.length === 2 &&
    runtime.manualScreenAcceptancePending[0] === 26 &&
    runtime.manualScreenAcceptancePending[1] === 27,
  "Blue-timer approval lost the exact ID1/ID7/ID26/ID27 navigation contract.");
  assert(blob?.address === "0x3c1cf400" && blob.bytes === 3_055 && blob.capacity === 3_072 &&
    blob.sha256 === "843d7848a8ad206b2314e2a3025ba0b50b78dfa537d6909e8f5c456a69885337" &&
    blob.decodedBytes === 10_284 && blob.decodedSha256 ===
      "1b01bbba47f7462abad20dbf3fc572b22f25806900a8c6f7823c579792309ca5",
  "Blue-timer approval lost the inherited page1C bootstrap pin.");
  assert(runtime.integratedIromModuleAddress === "0x421187cc" &&
    runtime.integratedIromEntryAddress === "0x42118c68" &&
    runtime.integratedIromModuleBytes === 23_700 && runtime.integratedIromCavityBytes === 30_540 &&
    runtime.integratedIromModuleSha256 ===
      "4521408133f1f84c04312312a9a1baddac1c75ec0795ea4b12f69e222389e29a" &&
    wrapper?.address === "0x421170c5" && wrapper.acceptedBytes === "a5b701" &&
    wrapper.candidateBytes === "25ba01",
  "Blue-timer approval lost its exact audited module, entry, cavity, or wrapper pin.");
  assert(rtc?.decode?.address === "0x42068f04" && rtc.decode.bytes === 499 &&
    rtc.decode.sha256 === "68b2d186e4ae76f0a074a87988acfb643fe461047ba0c610bbe572a7b546c2aa" &&
    rtc.monotonic?.address === "0x4037e028" && rtc.monotonic.bytes === 24 &&
    rtc.monotonic.sha256 === "75e03adc4a2e9d122f0accb175d4eabbabacf8b20982c9afda3f55f865b3a587" &&
    rtc.freshnessUs === 20_000,
  "Blue-timer approval lost the exact stock RTC/monotonic code pins.");

  const candidate = inspectEsp32AppImage(appBytes);
  const live = inspectEsp32AppImage(rollbackBytes);
  const expectedSegments = [
    [0x3c120020, 725_360, 32,
      "e108e7e3aefc9cccaa1abc22eb9de77026e8a1d9e145e1a8219edb96917c47f1"],
    [0x3fca4f00, 23_136, 725_400,
      "04b0bae3b9d09209cd7d152e5d7cdb3ff6b5ad24560f6386f98effc30f8c62d7"],
    [0x40374000, 37_912, 748_544,
      "0910ab78b191cc60879c62d565c1bc2d1b792dd6d4ba2b4bf1dd93fa541e2d8c"],
    [0x42000020, 1_179_384, 786_464,
      "31805244863b3ed5527e595445f032e3b4d355ccf4db9d92212ce32f860a1e48"],
    [0x4037d418, 96_740, 1_965_856,
      "247858cbc0937d3a22b0f596cedf97b125334b0ec1e5f4c75848acd69b22e696"],
    [0x600fe000, 264, 2_062_604,
      "9f83770ff14f9c88f49ebcef1e9294f136fe9112e2f2aec69fd24c137c1dc581"],
  ];
  assert(candidate.segmentCount === expectedSegments.length &&
    live.segmentCount === expectedSegments.length && appBytes.length === rollbackBytes.length,
  "Blue-timer profile requires the exact accepted six-segment app shape.");
  for (let index = 0; index < expectedSegments.length; index += 1) {
    const [address, bytes, dataOffset, liveSha] = expectedSegments[index];
    const candidateSegment = candidate.segments[index];
    const liveSegment = live.segments[index];
    assert(liveSegment.loadAddress === address && liveSegment.length === bytes &&
      liveSegment.dataOffset === dataOffset && sha256(liveSegment.data) === liveSha &&
      candidateSegment.loadAddress === address && candidateSegment.length === bytes &&
      candidateSegment.dataOffset === dataOffset,
    `Blue-timer candidate or rollback changed exact segment ${index} layout/hash.`);
    if (index !== PINNED.iromSegmentIndex) {
      assert(candidateSegment.data.equals(liveSegment.data),
        `Blue-timer candidate changed preserved segment ${index}.`);
    }
  }
  const candidateIrom = candidate.segments[PINNED.iromSegmentIndex];
  const liveIrom = live.segments[PINNED.iromSegmentIndex];
  assert(sha256(candidateIrom.data) ===
    "ef1e041021d2f2076e63d2677215f875716ebf526a7871be499f80627a98bf19",
  "Blue-timer candidate IROM differs from the frozen audited segment.");
  const wrapperOffset = Number.parseInt(wrapper.address, 16) - liveIrom.loadAddress;
  const moduleOffset = Number.parseInt(runtime.integratedIromModuleAddress, 16) - liveIrom.loadAddress;
  const moduleEnd = moduleOffset + runtime.integratedIromModuleBytes;
  const cavityEnd = moduleOffset + runtime.integratedIromCavityBytes;
  const entryAddress = Number.parseInt(runtime.integratedIromEntryAddress, 16);
  assert(wrapperOffset >= 0 && moduleOffset > wrapperOffset + 3 &&
    entryAddress >= Number.parseInt(runtime.integratedIromModuleAddress, 16) &&
    entryAddress < Number.parseInt(runtime.integratedIromModuleAddress, 16) +
      runtime.integratedIromModuleBytes &&
    candidateIrom.data.subarray(0, wrapperOffset).equals(liveIrom.data.subarray(0, wrapperOffset)) &&
    liveIrom.data.subarray(wrapperOffset, wrapperOffset + 3).toString("hex") ===
      wrapper.acceptedBytes &&
    candidateIrom.data.subarray(wrapperOffset, wrapperOffset + 3).toString("hex") ===
      wrapper.candidateBytes &&
    candidateIrom.data.subarray(wrapperOffset + 3, moduleOffset)
      .equals(liveIrom.data.subarray(wrapperOffset + 3, moduleOffset)),
  "Blue-timer candidate escaped the exact three-byte wrapper mutation.");
  assert(cavityEnd === candidateIrom.length && moduleEnd <= cavityEnd &&
    sha256(candidateIrom.data.subarray(moduleOffset, moduleEnd)) ===
      runtime.integratedIromModuleSha256 &&
    candidateIrom.data.subarray(moduleEnd, cavityEnd).every((value) => value === 0),
  "Blue-timer candidate escaped the exact audited module plus zero-tail IROM cavity.");

  const liveDrom = live.segments[PINNED.dromSegmentIndex];
  const blobOffset = Number.parseInt(blob.address, 16) - liveDrom.loadAddress;
  assert(blobOffset >= 0 && blobOffset + blob.capacity <= liveDrom.length &&
    sha256(liveDrom.data.subarray(blobOffset, blobOffset + blob.bytes)) === blob.sha256 &&
    liveDrom.data.subarray(blobOffset + blob.bytes, blobOffset + blob.capacity)
      .every((value) => value === 0),
  "Blue-timer inherited page1C bootstrap bytes or zero headroom changed.");
  const rtcOffset = Number.parseInt(rtc.decode.address, 16) - candidateIrom.loadAddress;
  const monotonicAddress = Number.parseInt(rtc.monotonic.address, 16);
  const monotonicSegment = candidate.segments.find((segment) =>
    monotonicAddress >= segment.loadAddress &&
    monotonicAddress + rtc.monotonic.bytes <= segment.loadAddress + segment.length);
  const monotonicOffset = monotonicSegment === undefined ? -1 :
    monotonicAddress - monotonicSegment.loadAddress;
  assert(rtcOffset >= 0 && rtcOffset + rtc.decode.bytes <= candidateIrom.length &&
    sha256(candidateIrom.data.subarray(rtcOffset, rtcOffset + rtc.decode.bytes)) ===
      rtc.decode.sha256 && monotonicOffset >= 0 &&
    monotonicOffset + rtc.monotonic.bytes <= monotonicSegment.length &&
    sha256(monotonicSegment.data.subarray(monotonicOffset,
      monotonicOffset + rtc.monotonic.bytes)) === rtc.monotonic.sha256,
  "Blue-timer candidate changed the pinned stock RTC decoder or monotonic clock code.");
  assert(candidateIrom.data.readUInt32LE(0xbdd18) === liveIrom.data.readUInt32LE(0xbdd18) &&
    candidateIrom.data.readUInt32LE(0xbdd1c) === liveIrom.data.readUInt32LE(0xbdd1c) &&
    candidate.segments[2].data.readUInt32LE(0x914) === live.segments[2].data.readUInt32LE(0x914),
  "Blue-timer candidate changed an accepted DROM/PSRAM runtime-map literal.");
  const dromPages = mmuPageIndices(liveDrom);
  const iromPages = mmuPageIndices(candidateIrom);
  assert([...dromPages].every((page) => !iromPages.has(page)),
    "Blue-timer candidate aliases an ESP32-S3 DROM/IROM MMU index.");
}

function exactObjectKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) return false;
  const actual = Object.keys(value);
  const allowed = new Set(expected);
  return actual.length === allowed.size && expected.length === allowed.size &&
    actual.every((key) => allowed.has(key));
}

function validateRendererV2GenericStructuralReuse(approval, appBytes, rollbackBytes) {
  const runtime = approval.runtime;
  const wrapper = runtime?.wrapperCall;
  const expectedAppFile = path.join(SDK_ROOT,
    "build/combined-renderer-v2-generic-input-lab/" +
    "framer-0.4.1-input-lab-renderer-v2-generic-id26-app.bin");
  const expectedRollbackFile = path.join(SDK_ROOT,
    "build/combined-renderer-v2-clock-blue-timer/" +
    "framer-0.4.1-music-id1-wpm-id7-renderer-id26-clock-id27-blue-timer-app.bin");
  const expectedRecoveryFile = path.join(WORKSPACE_ROOT,
    "recovery/backups/2026-08-15-framer-f1-a4cb8faf3210-before-custom/" +
    "full-flash-16mb.bin");
  const runtimeKeys = [
    "acceptedDromPrefixBytes", "acceptedIromBytes", "additionalScreenIds",
    "allAssetBytesBelow", "bootProgram", "borrowedFramebufferBytes",
    "dromExtensionBytes", "dromMappingProfile", "dromMutationBytes",
    "eventRpcAllocationBytes", "extraFramebufferBytes", "headroomBytes",
    "hostRpcIds", "integratedIromCavityBytes", "integratedIromEntryAddress",
    "integratedIromModuleAddress", "integratedIromModuleBytes",
    "integratedIromModuleSha256", "iromEndExclusive", "keyboardKeyEvents",
    "manualScreenAcceptancePending", "maxF2epBytes", "maxTransportBytes",
    "nativeEvents", "nativeRtc", "newDromAssets", "ownedBundleAllocationBytes",
    "ownedProgramAllocationBytes", "packageFormat", "renderV2Profile",
    "rendererControllerAllocationBytes", "repeatPush", "runtimeMapPatch",
    "sceneRpcAllocationBytes", "screenIds", "sidecarAllocationBytes",
    "v1Packages", "wrapperCall",
  ];
  assert(exactObjectKeys(approval, ["format", "status", "deployable", "target", "write",
    "app", "rollback", "recovery", "runtime"]) &&
    exactObjectKeys(approval.target, ["device", "firmware", "chip", "mac"]) &&
    exactObjectKeys(approval.write, ["offset", "scope", "hardwareWriteApproved"]) &&
    exactObjectKeys(approval.app, ["file", "bytes", "sha256"]) &&
    exactObjectKeys(approval.rollback, ["mode", "file", "bytes", "sha256", "receipt"]) &&
    exactObjectKeys(approval.rollback.receipt, ["file", "bytes", "sha256"]) &&
    exactObjectKeys(approval.recovery, ["file", "bytes", "sha256"]) &&
    path.resolve(approval.app.file) === expectedAppFile &&
    path.resolve(approval.rollback.file) === expectedRollbackFile &&
    path.resolve(approval.recovery.file) === expectedRecoveryFile &&
    approval.recovery.bytes === 16_777_216 && approval.recovery.sha256 ===
      "aa6042310d075c9cbd3b992044511c064bb4b84713d0740a3adafcbdb3028fdd",
  "Generic Render-v2 approval changed its exact document shape or artifact paths.");
  // Re-pinned 2026-08-18 to 4e045ec2. Every capability key/value now lives in
  // persistent RAM (scene allocation 98_624 -> 99_136, store unchanged at
  // 98_304), which is the rebuild the blacklist below asks for. reply_status
  // also carries the core status code instead of flattening it to a boolean.
  assert(approval.deployable === true && approval.app?.bytes === 2_062_912 &&
    approval.app.sha256 ===
      "4e045ec270462754e8415c1e2d30181f500791db9d55cbeb98b8650621a78d1d" &&
    approval.rollback?.bytes === 2_062_912 && approval.rollback.sha256 ===
      "363170139a06f306be1e894b6f203a9bf03bf4d70d21194aaccdd1c42f760c32",
  "Generic Render-v2 approval is not pinned to the frozen candidate and accepted 363 rollback.");
  assert(exactObjectKeys(runtime, runtimeKeys) &&
    runtime.dromMappingProfile === "generic-render-v2-structural-v1" &&
    runtime.allAssetBytesBelow === "0x3c1d0000" && runtime.headroomBytes === 17 &&
    runtime.newDromAssets === false && runtime.dromMutationBytes === 0 &&
    runtime.dromExtensionBytes === 0 && runtime.acceptedDromPrefixBytes === 725_360 &&
    runtime.acceptedIromBytes === 1_179_384 &&
    runtime.iromEndExclusive === "0x42120000" && runtime.runtimeMapPatch === null &&
    runtime.borrowedFramebufferBytes === 62_000 && runtime.extraFramebufferBytes === 0 &&
    runtime.rendererControllerAllocationBytes === 62_164 &&
    runtime.sidecarAllocationBytes === 692 && runtime.ownedBundleAllocationBytes === 98_304 &&
    runtime.ownedProgramAllocationBytes === 29_824 &&
    runtime.sceneRpcAllocationBytes === 99_136 && runtime.eventRpcAllocationBytes === 40 &&
    runtime.renderV2Profile === "framer-f1-render-v2-structural-v1" &&
    runtime.packageFormat === "framer-render-v2-package-v1" &&
    runtime.v1Packages === true && runtime.maxTransportBytes === 98_304 &&
    runtime.maxF2epBytes === 29_824 &&
    runtime.repeatPush === "ui-detach-copy-swap-owned-buffers-v1" &&
    Array.isArray(runtime.hostRpcIds) && runtime.hostRpcIds.length === 2 &&
    runtime.hostRpcIds[0] === 1 && runtime.hostRpcIds[1] === 65_535 &&
    runtime.keyboardKeyEvents === false && runtime.nativeRtc === false &&
    runtime.bootProgram === false,
  "Generic Render-v2 approval lost its exact memory, capability, or ownership contract.");
  assert(exactObjectKeys(runtime.screenIds, ["music", "wpm", "inputLab"]) &&
    runtime.screenIds.music === 1 && runtime.screenIds.wpm === 7 &&
    runtime.screenIds.inputLab === 26 &&
    exactObjectKeys(runtime.nativeEvents, ["tick100", "tick1", "fnBottomKnob", "hostRpc"]) &&
    runtime.nativeEvents.tick100 === true && runtime.nativeEvents.tick1 === true &&
    runtime.nativeEvents.fnBottomKnob === true && runtime.nativeEvents.hostRpc === true &&
    Array.isArray(runtime.additionalScreenIds) && runtime.additionalScreenIds.length === 0 &&
    Array.isArray(runtime.manualScreenAcceptancePending) &&
    runtime.manualScreenAcceptancePending.length === 1 &&
    runtime.manualScreenAcceptancePending[0] === 26,
  "Generic Render-v2 approval lost its exact event or ID26 screen contract.");
  assert(runtime.integratedIromModuleAddress === "0x421187cc" &&
    runtime.integratedIromEntryAddress === "0x42118c74" &&
    runtime.integratedIromModuleBytes === 22_728 &&
    runtime.integratedIromCavityBytes === 30_540 &&
    runtime.integratedIromModuleSha256 ===
      "46d1636c2bac5777d7a90e1edce5868708953502326720c6ee85402079571f0d" &&
    exactObjectKeys(wrapper, ["address", "acceptedBytes", "candidateBytes"]) &&
    wrapper.address === "0x421170c5" && wrapper.acceptedBytes === "25ba01" &&
    wrapper.candidateBytes === "e5ba01",
  "Generic Render-v2 approval lost its exact audited module, entry, cavity, or wrapper pin.");

  const candidate = inspectEsp32AppImage(appBytes);
  const live = inspectEsp32AppImage(rollbackBytes);
  const expectedSegments = [
    [0x3c120020, 725_360, 32,
      "e108e7e3aefc9cccaa1abc22eb9de77026e8a1d9e145e1a8219edb96917c47f1"],
    [0x3fca4f00, 23_136, 725_400,
      "04b0bae3b9d09209cd7d152e5d7cdb3ff6b5ad24560f6386f98effc30f8c62d7"],
    [0x40374000, 37_912, 748_544,
      "0910ab78b191cc60879c62d565c1bc2d1b792dd6d4ba2b4bf1dd93fa541e2d8c"],
    [0x42000020, 1_179_384, 786_464,
      "ef1e041021d2f2076e63d2677215f875716ebf526a7871be499f80627a98bf19"],
    [0x4037d418, 96_740, 1_965_856,
      "247858cbc0937d3a22b0f596cedf97b125334b0ec1e5f4c75848acd69b22e696"],
    [0x600fe000, 264, 2_062_604,
      "9f83770ff14f9c88f49ebcef1e9294f136fe9112e2f2aec69fd24c137c1dc581"],
  ];
  assert(candidate.segmentCount === expectedSegments.length &&
    live.segmentCount === expectedSegments.length && appBytes.length === rollbackBytes.length,
  "Generic Render-v2 profile requires the exact accepted six-segment app shape.");
  for (let index = 0; index < expectedSegments.length; index += 1) {
    const [address, bytes, dataOffset, liveSha] = expectedSegments[index];
    const candidateSegment = candidate.segments[index];
    const liveSegment = live.segments[index];
    assert(liveSegment.loadAddress === address && liveSegment.length === bytes &&
      liveSegment.dataOffset === dataOffset && sha256(liveSegment.data) === liveSha &&
      candidateSegment.loadAddress === address && candidateSegment.length === bytes &&
      candidateSegment.dataOffset === dataOffset,
    `Generic Render-v2 candidate or rollback changed exact segment ${index} layout/hash.`);
    if (index !== PINNED.iromSegmentIndex) {
      assert(candidateSegment.data.equals(liveSegment.data),
        `Generic Render-v2 candidate changed preserved segment ${index}.`);
    }
  }
  const candidateIrom = candidate.segments[PINNED.iromSegmentIndex];
  const liveIrom = live.segments[PINNED.iromSegmentIndex];
  assert(sha256(candidateIrom.data) ===
    "59a539406707384c2ef35cbceafc182d7a8aa91e5e7e4e20ed3e43fa734df531",
  "Generic Render-v2 candidate IROM differs from the frozen audited segment.");
  const wrapperOffset = Number.parseInt(wrapper.address, 16) - liveIrom.loadAddress;
  const moduleAddress = Number.parseInt(runtime.integratedIromModuleAddress, 16);
  const moduleOffset = moduleAddress - liveIrom.loadAddress;
  const moduleEnd = moduleOffset + runtime.integratedIromModuleBytes;
  const cavityEnd = moduleOffset + runtime.integratedIromCavityBytes;
  const entryAddress = Number.parseInt(runtime.integratedIromEntryAddress, 16);
  assert(wrapperOffset >= 0 && moduleOffset > wrapperOffset + 3 &&
    entryAddress >= moduleAddress && entryAddress < moduleAddress + runtime.integratedIromModuleBytes &&
    candidateIrom.data.subarray(0, wrapperOffset).equals(liveIrom.data.subarray(0, wrapperOffset)) &&
    liveIrom.data.subarray(wrapperOffset, wrapperOffset + 3).toString("hex") ===
      wrapper.acceptedBytes &&
    candidateIrom.data.subarray(wrapperOffset, wrapperOffset + 3).toString("hex") ===
      wrapper.candidateBytes &&
    candidateIrom.data.subarray(wrapperOffset + 3, moduleOffset)
      .equals(liveIrom.data.subarray(wrapperOffset + 3, moduleOffset)),
  "Generic Render-v2 candidate escaped the exact three-byte wrapper mutation.");
  assert(cavityEnd === candidateIrom.length && moduleEnd <= cavityEnd &&
    sha256(candidateIrom.data.subarray(moduleOffset, moduleEnd)) ===
      runtime.integratedIromModuleSha256 &&
    candidateIrom.data.subarray(moduleEnd, cavityEnd).every((value) => value === 0),
  "Generic Render-v2 candidate escaped the exact audited module plus zero-tail IROM cavity.");
  const candidateDrom = candidate.segments[PINNED.dromSegmentIndex];
  const dromPages = mmuPageIndices(candidateDrom);
  const iromPages = mmuPageIndices(candidateIrom);
  assert(candidateDrom.data.equals(live.segments[PINNED.dromSegmentIndex].data) &&
    candidateIrom.loadAddress + candidateIrom.length <= 0x42120000 &&
    [...dromPages].every((page) => !iromPages.has(page)),
  "Generic Render-v2 candidate changed DROM or aliases an ESP32-S3 DROM/IROM MMU index.");
  /* Deliberately keep this exact frozen hash non-deployable until a rebuilt module
   * gives protocol and v1Packages independent JSON storage and receives a new audit. */
  assert(approval.app.sha256 !==
    "371ee26ebb74c37fde96213ace9f4c506ac98d5293ff09ffe3f863ced9c98f06",
  "Generic Render-v2 frozen candidate fails the exact capability ABI: the protocol and " +
  "v1Packages fields reuse borrowed stack-backed JSON key/value storage.");
}

export function validateDeviceApproval(approval, { appBytes, rollbackBytes,
  rollbackReceiptBytes = null, fullReadback = false }) {
  assert(approval?.format === DEVICE_APPROVAL_FORMAT, `Approval format must be ${DEVICE_APPROVAL_FORMAT}.`);
  assert(approval.target?.device === "knob_f1" && approval.target?.firmware === "0.4.1" &&
    approval.target?.chip === "ESP32-S3" && approval.target?.mac?.toLowerCase() === EXPECTED_MAC,
  "Approval target/device/MAC differs from the one backed-up F1.");
  assert(approval.write?.offset === "0x10000" && approval.write?.scope === "factory-app-only" &&
    approval.write?.hardwareWriteApproved === true,
  "Approval does not explicitly authorize an app-only 0x10000 write.");
  const requiredStatus = fullReadback ? "DEVICE_RELEASE_CANDIDATE" : "DEVICE_SMOKE_CANDIDATE";
  assert(approval.status === requiredStatus,
    `${fullReadback ? "Release" : "Smoke"} mode requires status ${requiredStatus}.`);
  assert(approval.app?.bytes === appBytes.length && approval.app?.sha256 === sha256(appBytes),
    "Approval app size/hash differs from the selected image.");
  if (approval.rollback?.mode === "accepted-live-receipt-v1") {
    validateAcceptedLiveRollback(approval, rollbackBytes, rollbackReceiptBytes);
  } else {
    assert(approval.rollback?.sha256 === sha256(rollbackBytes) &&
      approval.rollback?.sha256 === EXPECTED_STAGE3E3A_APP_SHA256,
    "Approval rollback is neither exact Stage-3E.3A nor a receipt-backed accepted live app.");
  }
  if (approval.runtime?.dromMappingProfile === "renderer-v2-terminal-page-v1") {
    validateRendererV2TerminalDrom(approval, appBytes, rollbackBytes);
  } else if (approval.runtime?.dromMappingProfile === "renderer-v2-mapped-prefix-lzss-v1") {
    validateRendererV2MappedPrefixLzss(approval, appBytes, rollbackBytes);
  } else if (approval.runtime?.dromMappingProfile === "accepted-7ad-page1c-bootstrap-reuse-v1") {
    validateRendererV2Accepted7adReuse(approval, appBytes, rollbackBytes);
  } else if (approval.runtime?.dromMappingProfile === "accepted-49590-focus-timer-reuse-v1") {
    validateRendererV2Accepted49590FocusTimerReuse(approval, appBytes, rollbackBytes);
  } else if (approval.runtime?.dromMappingProfile ===
      "accepted-7838-blue-timer-animation-reuse-v1") {
    validateRendererV2Accepted7838BlueTimerAnimationReuse(approval, appBytes, rollbackBytes);
  } else if (approval.runtime?.dromMappingProfile === "generic-render-v2-structural-v1") {
    validateRendererV2GenericStructuralReuse(approval, appBytes, rollbackBytes);
  } else {
    assert(approval.runtime?.allAssetBytesBelow === "0x3c1d0000" &&
      Number.isInteger(approval.runtime?.headroomBytes) && approval.runtime.headroomBytes > 0,
    "Approval lacks the hard runtime-readable DROM boundary gate.");
  }
  return approval;
}

export function assertSafeEsptoolInvocation(args, { operation }) {
  assert(Array.isArray(args) && args.every((arg) => typeof arg === "string"), "esptool args must be strings.");
  for (const arg of args) assert(!FORBIDDEN_TOOL_ARGS.has(arg), `Forbidden esptool argument ${arg}.`);
  assert(args.includes("--chip") && args.includes("esp32s3"), "Every device command must pin ESP32-S3.");
  assert(args.includes("--port") && args.some((arg) => /^\/dev\/cu\.(?:usbmodem|usbserial)/u.test(arg)),
    "Every device command must pin one USB serial port.");
  if (operation === "write") {
    const command = args.indexOf("write-flash");
    assert(command >= 0 && args[command + 1] === "--flash-size" && args[command + 2] === "keep" &&
      args[command + 3] === "0x10000" && command + 5 === args.length,
    "Write must contain exactly one app image at 0x10000 with flash size kept.");
    assert(args.includes("921600"), "Smoke/release writes must use 921600 baud.");
  } else {
    assert(!args.includes("write-flash"), "Read-only command unexpectedly writes flash.");
  }
  return true;
}

export function selectBootloaderPort(before, after) {
  const added = after.filter((port) => !before.includes(port));
  assert(added.length === 1, `Bootloader port ambiguity: expected one new USB serial port, found ${added.length}.`);
  assert(after.length === 1, `Bootloader port ambiguity: ${after.length} USB serial ports are present.`);
  return added[0];
}

function deviceVersion(report) {
  const version = report?.version;
  if (version === "0.4.1") return version;
  if (version?.version === "0.4.1" || version?.firmwareVersion === "0.4.1") return "0.4.1";
  if (version && [version.major, version.minor, version.patch].every(Number.isInteger)) {
    return `${version.major}.${version.minor}.${version.patch}`;
  }
  return undefined;
}

export function validateNormalDeviceReport(report) {
  assert(report?.device?.deviceType === "knob_f1" && report.device.isUsbConnection === true,
    "Input did not discover exactly one USB knob_f1.");
  assert(deviceVersion(report) === "0.4.1", "Connected knob_f1 firmware is not exact 0.4.1.");
  return report;
}

export function assertAppOnlyInspection(inspection, description = "Candidate") {
  assert(inspection?.appOffset === "0x0" && inspection.fileBytes === inspection.appBytes &&
    inspection.segmentCount === PINNED.segmentCount && inspection.factoryPartitionFit === true,
  `${description} must be one standalone factory-app image, never merged or full-flash data.`);
  return inspection;
}

async function listUsbPorts() {
  const names = (await readdir("/dev")).filter((name) => PORT_PATTERN.test(name)).sort();
  return names.map((name) => `/dev/${name}`);
}

async function runJsonNode(script, runner = exec) {
  const result = await runner(process.execPath, [script], { cwd: WORKSPACE_ROOT, maxBuffer: 4 * 1024 * 1024 });
  return JSON.parse(result.stdout);
}

async function waitForPort(before, { ports = listUsbPorts, timeoutMs = 12_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = [];
  while (Date.now() < deadline) {
    last = await ports();
    const added = last.filter((port) => !before.includes(port));
    if (added.length > 0) return selectBootloaderPort(before, last);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No unambiguous F1 bootloader serial port appeared; final candidates: ${last.join(", ")}.`);
}

async function waitForNormalHealth({ runner = exec, attempts = 8 } = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { return validateNormalDeviceReport(await runJsonNode(NORMAL_PROBE, runner)); }
    catch (error) { lastError = error; await new Promise((resolve) => setTimeout(resolve, 750)); }
  }
  throw new Error(`App write completed but post-boot health did not pass: ${lastError?.message}`);
}

function parseMac(text) {
  return text.match(/(?:MAC|Address):\s*([0-9a-f:]{17})/iu)?.[1]?.toLowerCase();
}

async function runEsp(esptool, args, operation, runner) {
  assertSafeEsptoolInvocation(args, { operation });
  return runner(esptool, args, { cwd: WORKSPACE_ROOT, maxBuffer: 16 * 1024 * 1024 });
}

async function serialIdentityGate(port, { runner = exec, esptool = STAGE3E3_PATHS.esptool } = {}) {
  const common = ["--chip", "esp32s3", "--port", port, "--baud", "115200", "--after", "no-reset"];
  const chip = await runEsp(esptool, [...common, "chip-id"], "read", runner);
  assert(/ESP32-S3/iu.test(chip.stdout), "Serial target is not ESP32-S3.");
  const mac = await runEsp(esptool, [...common, "read-mac"], "read", runner);
  assert(parseMac(mac.stdout) === EXPECTED_MAC, "Serial target MAC differs from the same-device backup.");
  const security = await runEsp(esptool, [...common, "--no-stub", "get-security-info"], "read", runner);
  assert(/Secure Boot:\s*Disabled/iu.test(security.stdout) &&
    /Flash Encryption:\s*Disabled/iu.test(security.stdout),
  "Secure Boot or Flash Encryption differs from the backed-up device state.");
  const flash = await runEsp(esptool, [...common, "flash-id"], "read", runner);
  assert(/Detected flash size:\s*16MB/iu.test(flash.stdout), "Detected flash is not exact 16MB.");
  return { chip: "ESP32-S3", mac: EXPECTED_MAC, secureBoot: false, flashEncryption: false, flashBytes: 0x1000000 };
}

export async function deployAppOnly({
  appPath,
  approvalPath,
  rollbackPath = STAGE3E3_PATHS.e3a,
  fullReadback = false,
  confirmed = false,
  receiptDirectory = path.join(SDK_ROOT, "build/device-receipts"),
} = {}, dependencies = {}) {
  assert(confirmed === true, "Device workflow is opt-in; pass the explicit app-only flash confirmation flag.");
  const runner = dependencies.runner ?? exec;
  const ports = dependencies.ports ?? listUsbPorts;
  const esptool = dependencies.esptool ?? STAGE3E3_PATHS.esptool;
  const started = Date.now();
  const approval = await readFile(path.resolve(approvalPath), "utf8").then(JSON.parse);
  const [app, rollback, recovery, rollbackReceiptBytes] = await Promise.all([
    readFile(path.resolve(appPath)), readFile(path.resolve(rollbackPath)), verifyRecoveryGate(),
    approval.rollback?.mode === "accepted-live-receipt-v1" ?
      readFile(path.resolve(approval.rollback.receipt.file)) : Promise.resolve(null),
  ]);
  const [appInspection, rollbackInspection] = await Promise.all([
    inspectImage(path.resolve(appPath)), inspectImage(path.resolve(rollbackPath)),
  ]);
  assertAppOnlyInspection(appInspection, "Candidate");
  assertAppOnlyInspection(rollbackInspection, "Rollback");
  validateDeviceApproval(approval, { appBytes: app, rollbackBytes: rollback,
    rollbackReceiptBytes, fullReadback });
  assert(recovery.mac === EXPECTED_MAC, "Recovery backup belongs to another device.");

  const normalBefore = validateNormalDeviceReport(await runJsonNode(NORMAL_PROBE, runner));
  const portsBefore = await ports();
  assert(portsBefore.length === 0,
    `Refusing bootloader transition while ${portsBefore.length} USB serial candidate(s) already exist.`);
  await runJsonNode(ENTER_BOOTLOADER, runner);
  const port = await waitForPort(portsBefore, { ports });
  const identity = await serialIdentityGate(port, { runner, esptool });

  const after = fullReadback ? "no-reset" : "watchdog-reset";
  const writeArgs = ["--chip", "esp32s3", "--port", port, "--baud", "921600",
    "--after", after, "write-flash", "--flash-size", "keep", "0x10000", path.resolve(appPath)];
  const write = await runEsp(esptool, writeArgs, "write", runner);
  const writeText = `${write.stdout}\n${write.stderr ?? ""}`;
  assert(/Hash of data verified/iu.test(writeText),
    "esptool did not report its normal post-write hash verification; device remains unaccepted.");

  let fullReadbackResult;
  if (fullReadback) {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "f1-sdk-readback-"));
    const readbackPath = path.join(temporary, "app.bin");
    try {
      const readArgs = ["--chip", "esp32s3", "--port", port, "--baud", "115200", "--after", "no-reset",
        "read-flash", "--no-progress", "0x10000", `0x${app.length.toString(16)}`, readbackPath];
      await runEsp(esptool, readArgs, "read", runner);
      const readback = await readFile(readbackPath);
      assert(readback.length === app.length && sha256(readback) === sha256(app) && readback.equals(app),
        "Full release read-back does not exactly match the app image.");
      fullReadbackResult = { bytes: readback.length, sha256: sha256(readback), exact: true };
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
    const resetArgs = ["--chip", "esp32s3", "--port", port, "--baud", "115200",
      "--after", "watchdog-reset", "chip-id"];
    await runEsp(esptool, resetArgs, "read", runner);
  }

  const postBoot = await waitForNormalHealth({ runner });
  const receipt = {
    format: "framer-f1-device-deployment-receipt-v1",
    mode: fullReadback ? "release-full-readback" : "fast-smoke",
    target: { device: "knob_f1", firmware: "0.4.1", mac: EXPECTED_MAC },
    app: { file: path.resolve(appPath), bytes: app.length, sha256: sha256(app), flashOffset: "0x10000" },
    rollback: { file: path.resolve(rollbackPath), bytes: rollback.length, sha256: sha256(rollback) },
    recovery, normalBefore, serialIdentity: identity,
    write: { baud: 921600, hashVerifiedByEsptool: true, appOnly: true },
    fullReadback: fullReadbackResult,
    postBoot,
    elapsedMs: Date.now() - started,
  };
  await mkdir(receiptDirectory, { recursive: true });
  const receiptPath = path.join(receiptDirectory, `device-${Date.now()}-${receipt.mode}.json`);
  await writeFile(receiptPath, stableJson(receipt), { flag: "wx" });
  return Object.freeze({ receipt, receiptPath });
}
