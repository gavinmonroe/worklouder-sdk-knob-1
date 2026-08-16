import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { REMAINING_GETTER_LITERAL_APP_OFFSET, STOCK_REMAINING_GETTER } from "../build-stage3b.mjs";
import {
  STAGE3C1_KEY_CALLBACK_APP_OFFSET,
  STAGE3C1_SETUP_POINTER_APP_OFFSET,
  STAGE3C1_WPM_TICK_APP_OFFSET,
} from "../build-stage3c1.mjs";
import { STAGE3E3A_ABI_BYTES, STAGE3E3A_DROM_GROWTH_BYTES } from "../build-stage3e3a.mjs";
import {
  EXPECTED_STAGE3E3_APP_BYTES,
  EXPECTED_STAGE3E3_APP_SHA256,
  EXPECTED_STAGE3E3_CHECKSUM,
  EXPECTED_STAGE3E3_DIGEST,
  EXPECTED_STAGE3E3_MERGED_BYTES,
  EXPECTED_STAGE3E3_MERGED_SHA256,
  STAGE3E3_ABI_APP_OFFSET,
  STAGE3E3_ABI_BYTES,
  STAGE3E3_ABI_SHA256,
  STAGE3E3_ASSET_BANK_APP_OFFSET,
  STAGE3E3_ASSET_BANK_BYTES,
  STAGE3E3_ASSET_BANK_SHA256,
  STAGE3E3_ASSET_BANK_VIRTUAL_ADDRESS,
  STAGE3E3_DROM_GROWTH_BYTES,
  STAGE3E3_SETUP_WRAPPER_VIRTUAL_ADDRESS,
  applyStage3e3Full,
  buildStage3e3AssetBank,
  decodeStage3e3AbiHex,
  parseStage3e3AssetManifest,
} from "../build-stage3e3.mjs";
import { FRAMER_RUNTIME_ASSET_BOUNDARY } from "../lib/framer-lvgl-indexed.mjs";
import { FRAMER_SCREEN_AUDIT } from "../lib/framer-registry-audit.mjs";
import { createStage3eSpriteState, sampleStage3eSprite, STAGE3E_CAT_FRAME } from "../lib/stage3e-sprite-state.mjs";
import {
  STAGE3E3_ASSET_BASE,
  STAGE3E3_DEFAULT_SPECIES,
  STAGE3E3_SCALE,
  STAGE3E3_SPECIES,
  STAGE3E3_STATES,
  STAGE3E3_VISIBLE_SIZE,
  cycleStage3e3Species,
  stage3e3PetDescriptorAddress,
  stage3e3PetDescriptorIndex,
} from "../lib/stage3e3-pet-contract.mjs";

const root = new URL("../../", import.meta.url);
const url = (relative) => new URL(relative, root);
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
let cachedFixture;
async function fixture() {
  cachedFixture ??= (async () => {
    const assetDirectory = "framer-widgets/assets/device-lvgl-v5-i4-species/";
    const [official, rollback, abiHex, manifestBytes] = await Promise.all([
      readFile(url("artifacts/firmware/firmware_0.4.1_merged.bin")),
      readFile(url("custom-firmware/build/framer-0.4.1-stage3e3a-i4-canary-app.bin")),
      readFile(url("custom-firmware/experimental/stage3e3-wpm-pet.hex"), "utf8"),
      readFile(url(`${assetDirectory}manifest.json`)),
    ]);
    const manifest = parseStage3e3AssetManifest(manifestBytes);
    const frames = await Promise.all(manifest.frames.map((frame) => readFile(url(frame.output))));
    const abi = decodeStage3e3AbiHex(abiHex);
    return { official, rollback, abi, manifestBytes, manifest, frames,
      output: applyStage3e3Full(official, rollback, abi, manifest, frames) };
  })();
  return cachedFixture;
}

test("Stage-3E.3 deterministically matches pinned app, merged image, checksum, and digest", async () => {
  const { output } = await fixture();
  assert.equal(output.app.length, EXPECTED_STAGE3E3_APP_BYTES);
  assert.equal(output.merged.length, EXPECTED_STAGE3E3_MERGED_BYTES);
  assert.equal(sha256(output.app), EXPECTED_STAGE3E3_APP_SHA256);
  assert.equal(sha256(output.merged), EXPECTED_STAGE3E3_MERGED_SHA256);
  assert.equal(output.stage3e3.storedChecksum, EXPECTED_STAGE3E3_CHECKSUM);
  assert.equal(output.stage3e3.storedDigest.toString("hex"), EXPECTED_STAGE3E3_DIGEST);
  assert.deepEqual(output.app, await readFile(url("custom-firmware/build/framer-0.4.1-stage3e3-wpm-pet-full-app.bin")));
  assert.deepEqual(output.merged, await readFile(url("custom-firmware/build/framer-0.4.1-stage3e3-wpm-pet-full-merged.bin")));
});

test("Stage-3E.3 changes exact E3A only at setup, its existing asset page, and appended-IROM replacement", async () => {
  const { rollback, abi, output } = await fixture();
  const base = (await import("../lib/esp-app-image.mjs")).inspectEsp32AppImage(rollback);
  const final = output.stage3e3;
  const oldDrom = base.segments[0];
  const newDrom = final.segments[0];
  const setup = STAGE3C1_SETUP_POINTER_APP_OFFSET - oldDrom.dataOffset;
  const stockPrefix = 0xa1170;
  assert.deepEqual(newDrom.data.subarray(0, setup), oldDrom.data.subarray(0, setup));
  assert.deepEqual(newDrom.data.subarray(setup + 4, stockPrefix), oldDrom.data.subarray(setup + 4, stockPrefix));
  assert.deepEqual(newDrom.data.subarray(stockPrefix), output.assets.padded);
  const oldIrom = base.segments[3];
  const stockIromBytes = oldIrom.length - STAGE3E3A_ABI_BYTES;
  assert.deepEqual(final.segments[3].data.subarray(0, stockIromBytes), oldIrom.data.subarray(0, stockIromBytes));
  assert.deepEqual(final.segments[3].data.subarray(stockIromBytes), abi);
  for (const index of [1, 2, 4, 5]) assert.deepEqual(final.segments[index].data, base.segments[index].data);
  assert.equal(final.segments[4].headerOffset, 0x1d7598);
  assert.equal(final.segments[4].dataOffset, 0x1d75a0);
  assert.equal(final.segments[5].headerOffset, 0x1eef84);
  assert.equal(final.segments[5].dataOffset, 0x1eef8c);
  assert.equal(final.checksumOffset, 0x1ef09f);
  assert.equal(final.digestOffset, 0x1ef0a0);
});

test("Stage-3E.3 rebuilds exact 48-frame I4 bank wholly below the live-proven DROM boundary", async () => {
  const { output } = await fixture();
  assert.equal(output.assets.bank.length, STAGE3E3_ASSET_BANK_BYTES);
  assert.equal(sha256(output.assets.bank), STAGE3E3_ASSET_BANK_SHA256);
  assert.equal(output.assets.descriptors.length, 48);
  assert.equal(output.assets.boundary.baseAddress, STAGE3E3_ASSET_BANK_VIRTUAL_ADDRESS);
  assert.equal(output.assets.boundary.endAddress, 0x3c1ceed0);
  assert.equal(output.assets.boundary.headroom, 4400);
  assert.ok(output.assets.boundary.endAddress < FRAMER_RUNTIME_ASSET_BOUNDARY.originalMappedPageEnd);
  for (let index = 0; index < output.assets.descriptors.length; index++) {
    const descriptor = output.assets.descriptors[index];
    assert.equal(descriptor.descriptorAddress, STAGE3E3_ASSET_BASE + index * 24);
    assert.equal(descriptor.colorFormat, 0x09);
    assert.equal(descriptor.width, 52);
    assert.equal(descriptor.height, 42);
    assert.ok(descriptor.dataAddress + descriptor.dataBytes <= FRAMER_RUNTIME_ASSET_BOUNDARY.originalMappedPageEnd);
  }
  assert.deepEqual(output.app.subarray(STAGE3E3_ASSET_BANK_APP_OFFSET,
    STAGE3E3_ASSET_BANK_APP_OFFSET + output.assets.bank.length), output.assets.bank);
  assert.ok(output.assets.padded.subarray(output.assets.bank.length).every((byte) => byte === 0));
});

test("Stage-3E.3 keeps stock key/getter/tick and patches only its setup wrapper", async () => {
  const { output } = await fixture();
  assert.equal(output.app.readUInt32LE(STAGE3C1_SETUP_POINTER_APP_OFFSET), STAGE3E3_SETUP_WRAPPER_VIRTUAL_ADDRESS);
  assert.equal(output.finalGetterOffset, REMAINING_GETTER_LITERAL_APP_OFFSET + STAGE3E3_DROM_GROWTH_BYTES);
  assert.equal(output.finalKeyOffset, STAGE3C1_KEY_CALLBACK_APP_OFFSET + STAGE3E3_DROM_GROWTH_BYTES);
  assert.equal(output.app.readUInt32LE(output.finalGetterOffset), STOCK_REMAINING_GETTER);
  assert.equal(output.app.readUInt32LE(output.finalKeyOffset), FRAMER_SCREEN_AUDIT.wpmKeyCallbackLiteral.expectedValue);
  assert.equal(output.app.readUInt32LE(STAGE3C1_WPM_TICK_APP_OFFSET), FRAMER_SCREEN_AUDIT.wpmTickVtablePointer.expectedValue);
  assert.equal(output.stage3e3.segmentCount, 6);
  assert.equal(output.stage3e3.segments[0].length, 0xb1170);
  assert.equal(output.stage3e3.segments[3].length, 0x117578);
  assert.equal(output.stage3e3.segments[3].loadAddress + output.stage3e3.segments[3].length, 0x42117598);
  assert.equal(STAGE3E3_DROM_GROWTH_BYTES, STAGE3E3A_DROM_GROWTH_BYTES);
});

test("Stage-3E.3 executable contract pins mood semantics and screen-local species control", () => {
  assert.deepEqual(STAGE3E3_SPECIES,
    ["Belgian Tervuren", "Pepe", "Angry owl", "Cute ferret", "Cat", "Lazy cow"]);
  assert.deepEqual(STAGE3E3_STATES,
    ["ready", "curious", "happy", "zooming", "fire", "tired", "waiting", "sleeping"]);
  assert.equal(STAGE3E3_DEFAULT_SPECIES, 4);
  assert.equal(STAGE3E3_SCALE, 0x200);
  assert.deepEqual(STAGE3E3_VISIBLE_SIZE, { width: 104, height: 84 });
  const event = { encoderId: 1, fnPressed: true, inputAvailable: true };
  assert.equal(cycleStage3e3Species(4, { ...event, delta: 1 }), 5);
  assert.equal(cycleStage3e3Species(5, { ...event, delta: 1 }), 0);
  assert.equal(cycleStage3e3Species(0, { ...event, delta: 0xff }), 5);
  assert.equal(cycleStage3e3Species(4, { ...event, delta: 0 }), 4);
  assert.equal(cycleStage3e3Species(4, { ...event, delta: 1, fnPressed: false }), 4);
  assert.equal(stage3e3PetDescriptorIndex(4, 7), 39);
  assert.equal(stage3e3PetDescriptorAddress(4, 7), STAGE3E3_ASSET_BASE + 39 * 24);

  const state = createStage3eSpriteState();
  assert.equal(state.frame, STAGE3E_CAT_FRAME.ready);
  for (let wpm = 40; wpm < 60; wpm++) sampleStage3eSprite(state, wpm, { displayLow: false });
  for (let index = 0; index < 3; index++) sampleStage3eSprite(state, 59, { displayLow: false });
  assert.equal(state.frame, STAGE3E_CAT_FRAME.zooming);
  while (state.idleSamples < 10) sampleStage3eSprite(state, 59, { displayLow: false });
  assert.equal(state.frame, STAGE3E_CAT_FRAME.waiting);
  while (state.idleSamples < 60) sampleStage3eSprite(state, 59, { displayLow: false });
  assert.equal(state.frame, STAGE3E_CAT_FRAME.sleeping);
});

test("Stage-3E.3 rejects changed rollback, ABI, manifest, and any frame", async () => {
  const { official, rollback, abi, manifestBytes, manifest, frames } = await fixture();
  const changedRollback = Buffer.from(rollback); changedRollback[0x100] ^= 1;
  assert.throws(() => applyStage3e3Full(official, changedRollback, abi, manifest, frames), /rollback base/u);
  const changedAbi = Buffer.from(abi); changedAbi.at(-1); changedAbi[changedAbi.length - 1] ^= 1;
  assert.throws(() => applyStage3e3Full(official, rollback, changedAbi, manifest, frames), /ABI changed/u);
  const changedManifest = Buffer.from(manifestBytes); changedManifest[changedManifest.length - 2] ^= 1;
  assert.throws(() => parseStage3e3AssetManifest(changedManifest), /manifest changed/u);
  const changedFrames = frames.slice(); changedFrames[39] = Buffer.from(changedFrames[39]); changedFrames[39].at(-1);
  changedFrames[39][changedFrames[39].length - 1] ^= 1;
  assert.throws(() => buildStage3e3AssetBank(manifest, changedFrames), /pet-4-7 differs/u);
  assert.equal(abi.length, STAGE3E3_ABI_BYTES);
  assert.equal(sha256(abi), STAGE3E3_ABI_SHA256);
  assert.deepEqual(abi, (await fixture()).output.app.subarray(STAGE3E3_ABI_APP_OFFSET,
    STAGE3E3_ABI_APP_OFFSET + STAGE3E3_ABI_BYTES));
});
