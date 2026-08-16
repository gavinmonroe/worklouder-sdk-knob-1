import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  EXPECTED_STAGE3E31_APP_BYTES, EXPECTED_STAGE3E31_APP_SHA256, EXPECTED_STAGE3E31_CHECKSUM,
  EXPECTED_STAGE3E31_DIGEST, EXPECTED_STAGE3E31_MERGED_BYTES, EXPECTED_STAGE3E31_MERGED_SHA256,
  STAGE3E31_ABI_BYTES, STAGE3E31_ABI_SHA256, STAGE3E31_ASSET_BANK_SHA256,
  STAGE3E31_FULL_TABLE_VIRTUAL_ADDRESS, applyStage3e3Full, buildStage3e3AssetBank,
  decodeStage3e3AbiHex, parseStage3e3AssetManifest,
} from "../build-stage3e31.mjs";

const root = new URL("../../", import.meta.url);
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
let cached;
async function fixture() {
  cached ??= (async () => {
    const [official, rollback, abiHex, manifestBytes, canary] = await Promise.all([
      readFile(new URL("artifacts/firmware/firmware_0.4.1_merged.bin", root)),
      readFile(new URL("custom-firmware/build/framer-0.4.1-stage3e3a-i4-canary-app.bin", root)),
      readFile(new URL("custom-firmware/experimental/stage3e31-wpm-pet.hex", root), "utf8"),
      readFile(new URL("framer-widgets/assets/device-lvgl-v5-i4-species/manifest.json", root)),
      readFile(new URL("framer-widgets/assets/device-lvgl-v4-i4-canary/cat-ready-52x42.lvgl.bin", root)),
    ]);
    const manifest = parseStage3e3AssetManifest(manifestBytes);
    const frames = await Promise.all(manifest.frames.map((frame) => readFile(new URL(frame.output, root))));
    const abi = decodeStage3e3AbiHex(abiHex);
    return { official, rollback, abi, manifest, frames, canary,
      output: applyStage3e3Full(official, rollback, abi, manifest, frames, canary) };
  })();
  return cached;
}

test("Stage-3E.3.1 deterministically matches pinned ESP outputs", async () => {
  const { output } = await fixture();
  assert.equal(output.app.length, EXPECTED_STAGE3E31_APP_BYTES);
  assert.equal(output.merged.length, EXPECTED_STAGE3E31_MERGED_BYTES);
  assert.equal(sha256(output.app), EXPECTED_STAGE3E31_APP_SHA256);
  assert.equal(sha256(output.merged), EXPECTED_STAGE3E31_MERGED_SHA256);
  assert.equal(output.stage3e31.storedChecksum, EXPECTED_STAGE3E31_CHECKSUM);
  assert.equal(output.stage3e31.storedDigest.toString("hex"), EXPECTED_STAGE3E31_DIGEST);
});

test("Stage-3E.3.1 keeps exact E3A canary first and all 48 sources below boundary", async () => {
  const { canary, output } = await fixture();
  assert.equal(output.assets.canaryDescriptor.descriptorAddress, 0x3c1c1190);
  assert.equal(output.assets.canaryDescriptor.dataAddress, 0x3c1c11a8);
  assert.equal(output.assets.descriptors[0].descriptorAddress, STAGE3E31_FULL_TABLE_VIRTUAL_ADDRESS);
  assert.equal(output.assets.descriptors.length, 48);
  assert.equal(output.assets.boundary.endAddress, 0x3c1cf36c);
  assert.equal(output.assets.boundary.headroom, 3220);
  assert.equal(sha256(output.assets.bank), STAGE3E31_ASSET_BANK_SHA256);
  assert.deepEqual(output.assets.bank.subarray(24, 24 + 1156), canary.subarray(12));
});

test("Stage-3E.3.1 pins final six-segment mapping and footer", async () => {
  const { output } = await fixture();
  const image = output.stage3e31;
  assert.equal(image.segmentCount, 6);
  assert.equal(image.segments[3].length, 0x1175a8);
  assert.equal(image.segments[3].loadAddress + image.segments[3].length, 0x421175c8);
  assert.equal(image.segments[4].headerOffset, 0x1d75c8);
  assert.equal(image.segments[5].headerOffset, 0x1eefb4);
  assert.equal(image.checksumOffset, 0x1ef0cf);
  assert.equal(image.digestOffset, 0x1ef0d0);
});

test("Stage-3E.3.1 rejects changed ABI, canary, and full frame", async () => {
  const { abi, manifest, frames, canary } = await fixture();
  const changedAbi = Buffer.from(abi); changedAbi[changedAbi.length - 1] ^= 1;
  assert.throws(() => decodeStage3e3AbiHex(changedAbi.toString("hex")), /ABI differs/u);
  const changedCanary = Buffer.from(canary); changedCanary[changedCanary.length - 1] ^= 1;
  assert.throws(() => buildStage3e3AssetBank(manifest, frames, changedCanary), /requires exactly/u);
  const changedFrames = frames.slice(); changedFrames[0] = Buffer.from(frames[0]); changedFrames[0][100] ^= 1;
  assert.throws(() => buildStage3e3AssetBank(manifest, changedFrames, canary), /pet-0-0 differs/u);
  assert.equal(abi.length, STAGE3E31_ABI_BYTES);
  assert.equal(sha256(abi), STAGE3E31_ABI_SHA256);
});
