import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  EXPECTED_STAGE3E34_APP_BYTES,
  EXPECTED_STAGE3E34_APP_SHA256,
  EXPECTED_STAGE3E34_CHECKSUM,
  EXPECTED_STAGE3E34_DIGEST,
  EXPECTED_STAGE3E34_MERGED_BYTES,
  EXPECTED_STAGE3E34_MERGED_SHA256,
  STAGE3E34_ABI_BYTES,
  STAGE3E34_ABI_SHA256,
  STAGE3E34_ASSET_BANK_SHA256,
  STAGE3E34_FULL_TABLE_VIRTUAL_ADDRESS,
  applyStage3e3Full,
  buildStage3e3AssetBank,
  decodeStage3e3AbiHex,
  parseStage3e3AssetManifest,
} from "../build-stage3e34.mjs";
import { parseSerializedLvglIndexed } from "../lib/framer-lvgl-indexed.mjs";
import {
  expandStage3e34I4,
  stage3e34ReentryDescriptorIndex,
  STAGE3E34_RAM_IMAGE,
} from "../lib/stage3e34-ram-i4.mjs";

const root = new URL("../../", import.meta.url);
const url = (relative) => new URL(relative, root);
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
let cached;

async function fixture() {
  cached ??= (async () => {
    const [official, rollback, abiHex, registerHex, manifestBytes, canary] = await Promise.all([
      readFile(url("artifacts/firmware/firmware_0.4.1_merged.bin")),
      readFile(url("custom-firmware/build/framer-0.4.1-stage3e3a-i4-canary-app.bin")),
      readFile(url("custom-firmware/experimental/stage3e34-wpm-pet.hex"), "utf8"),
      readFile(url("custom-firmware/experimental/stage3e34-register-only.hex"), "utf8"),
      readFile(url("framer-widgets/assets/device-lvgl-v5-i4-species/manifest.json")),
      readFile(url("framer-widgets/assets/device-lvgl-v4-i4-canary/cat-ready-52x42.lvgl.bin")),
    ]);
    const manifest = parseStage3e3AssetManifest(manifestBytes);
    const frames = await Promise.all(manifest.frames.map((frame) => readFile(url(frame.output))));
    const abi = decodeStage3e3AbiHex(abiHex);
    return { official, rollback, abi, register: Buffer.from(registerHex.replace(/\s+/gu, ""), "hex"),
      manifestBytes, manifest, frames, canary,
      output: applyStage3e3Full(official, rollback, abi, manifest, frames, canary) };
  })();
  return cached;
}

test("Stage-3E.3.4 deterministically matches its pinned six-segment app", async () => {
  const { output } = await fixture();
  assert.equal(output.app.length, EXPECTED_STAGE3E34_APP_BYTES);
  assert.equal(output.merged.length, EXPECTED_STAGE3E34_MERGED_BYTES);
  assert.equal(sha256(output.app), EXPECTED_STAGE3E34_APP_SHA256);
  assert.equal(sha256(output.merged), EXPECTED_STAGE3E34_MERGED_SHA256);
  assert.equal(output.stage3e34.storedChecksum, EXPECTED_STAGE3E34_CHECKSUM);
  assert.equal(output.stage3e34.storedDigest.toString("hex"), EXPECTED_STAGE3E34_DIGEST);
  assert.equal(output.stage3e34.segmentCount, 6);
  assert.equal(output.stage3e34.segments[3].length, 0x1176b8);
  assert.equal(output.stage3e34.segments[3].loadAddress + output.stage3e34.segments[3].length, 0x421176d8);
  assert.equal(output.stage3e34.segments[4].headerOffset, 0x1d76d8);
  assert.equal(output.stage3e34.segments[4].dataOffset, 0x1d76e0);
  assert.equal(output.stage3e34.segments[5].headerOffset, 0x1ef0c4);
  assert.equal(output.stage3e34.segments[5].dataOffset, 0x1ef0cc);
  assert.equal(output.stage3e34.checksumOffset, 0x1ef1df);
  assert.equal(output.stage3e34.digestOffset, 0x1ef1e0);
});

test("Stage-3E.3.4 retains the live E3A fallback and all 48 compact sources below the proven boundary", async () => {
  const { canary, output } = await fixture();
  assert.equal(output.assets.canaryDescriptor.descriptorAddress, 0x3c1c1190);
  assert.equal(output.assets.canaryDescriptor.dataAddress, 0x3c1c11a8);
  assert.equal(output.assets.descriptors[0].descriptorAddress, STAGE3E34_FULL_TABLE_VIRTUAL_ADDRESS);
  assert.equal(output.assets.descriptors.length, 48);
  assert.equal(output.assets.boundary.endAddress, 0x3c1cf36c);
  assert.equal(output.assets.boundary.headroom, 3220);
  assert.equal(sha256(output.assets.bank), STAGE3E34_ASSET_BANK_SHA256);
  assert.deepEqual(output.assets.bank.subarray(24, 24 + 1156), canary.subarray(12));
});

test("Stage-3E.3.4 executable RAM model preserves I4 palette and exact nearest-neighbor mapping", async () => {
  const { frames } = await fixture();
  const source = frames[39];
  const expanded = expandStage3e34I4(source);
  const info = parseSerializedLvglIndexed(expanded);
  assert.deepEqual({ width: info.width, height: info.height, stride: info.stride, dataBytes: info.dataBytes },
    { width: 96, height: 78, stride: 48, dataBytes: 3808 });
  assert.deepEqual(expanded.subarray(12, 76), source.subarray(12, 76));
  assert.equal(STAGE3E34_RAM_IMAGE.descriptorWord0, 0x00000919);
  const sourcePixels = source.subarray(76);
  const outputPixels = expanded.subarray(76);
  const sourceIndex = (x, y) => {
    const byte = sourcePixels[y * 26 + (x >> 1)];
    return (x & 1) === 0 ? byte >> 4 : byte & 15;
  };
  const outputIndex = (x, y) => {
    const byte = outputPixels[y * 48 + (x >> 1)];
    return (x & 1) === 0 ? byte >> 4 : byte & 15;
  };
  for (const [x, y] of [[0, 0], [1, 1], [47, 38], [95, 77], [73, 61]]) {
    assert.equal(outputIndex(x, y), sourceIndex(Math.floor(x * 52 / 96), Math.floor(y * 42 / 78)));
  }
});

test("Stage-3E.3.4 registration-only module excludes stock setup and pins its combined ABI", async () => {
  const { register } = await fixture();
  assert.equal(register.length, 0x788);
  assert.equal(sha256(register), "6862764da34424285799e5c91796cd6080fca1adc1374f60f5b171b8d34c6c12");
  const setup = Buffer.alloc(4); setup.writeUInt32LE(0x4202c108);
  assert.equal(register.indexOf(setup), -1);
});

test("Stage-3E.3.4 re-entry immediately reconstructs the persisted species at ready state", () => {
  assert.equal(stage3e34ReentryDescriptorIndex(4), 32, "default Cat ready");
  assert.equal(stage3e34ReentryDescriptorIndex(1), 8, "persisted Pepe ready, never stale Cat");
  assert.equal(stage3e34ReentryDescriptorIndex(5), 40, "persisted Lazy cow ready");
  assert.throws(() => stage3e34ReentryDescriptorIndex(6), /0\.\.5/u);
});

test("Stage-3E.3.4 rejects changed code, asset manifest, canary, and pet frame", async () => {
  const { abi, manifestBytes, manifest, frames, canary } = await fixture();
  const changedAbi = Buffer.from(abi); changedAbi[changedAbi.length - 1] ^= 1;
  assert.throws(() => decodeStage3e3AbiHex(changedAbi.toString("hex")), /ABI differs/u);
  const changedManifest = Buffer.from(manifestBytes); changedManifest[changedManifest.length - 2] ^= 1;
  assert.throws(() => parseStage3e3AssetManifest(changedManifest), /manifest changed/u);
  const changedCanary = Buffer.from(canary); changedCanary[changedCanary.length - 1] ^= 1;
  assert.throws(() => buildStage3e3AssetBank(manifest, frames, changedCanary), /requires exactly/u);
  const changedFrames = frames.slice(); changedFrames[0] = Buffer.from(frames[0]); changedFrames[0][100] ^= 1;
  assert.throws(() => buildStage3e3AssetBank(manifest, changedFrames, canary), /pet-0-0 differs/u);
  assert.equal(abi.length, STAGE3E34_ABI_BYTES);
  assert.equal(sha256(abi), STAGE3E34_ABI_SHA256);
});
