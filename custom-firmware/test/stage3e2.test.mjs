import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { APP_FLASH_OFFSET } from "../build-stage1.mjs";
import { REMAINING_GETTER_LITERAL_APP_OFFSET, STOCK_REMAINING_GETTER } from "../build-stage3b.mjs";
import {
  EXPECTED_STAGE3C1_APP_SHA256,
  STAGE3C1_KEY_CALLBACK_APP_OFFSET,
  STAGE3C1_SETUP_POINTER_APP_OFFSET,
  STAGE3C1_WPM_TICK_APP_OFFSET,
  applyStage3c1OwnedLabels,
  decodeStage3c1AbiHex,
} from "../build-stage3c1.mjs";
import {
  EXPECTED_STAGE3E2_APP_BYTES,
  EXPECTED_STAGE3E2_APP_SHA256,
  EXPECTED_STAGE3E2_CHECKSUM,
  EXPECTED_STAGE3E2_DIGEST,
  EXPECTED_STAGE3E2_MERGED_BYTES,
  EXPECTED_STAGE3E2_MERGED_SHA256,
  STAGE3E2_ABI_APP_OFFSET,
  STAGE3E2_ABI_BYTES,
  STAGE3E2_ABI_SHA256,
  STAGE3E2_ABI_VIRTUAL_ADDRESS,
  STAGE3E2_ASSET_BANK_APP_OFFSET,
  STAGE3E2_ASSET_BANK_BYTES,
  STAGE3E2_ASSET_BANK_SHA256,
  STAGE3E2_ASSET_MANIFEST_SHA256,
  STAGE3E2_ASSET_BANK_VIRTUAL_ADDRESS,
  STAGE3E2_ASSET_SPECS,
  STAGE3E2_DROM_GROWTH_BYTES,
  STAGE3E2_PADDED_BANK_SHA256,
  STAGE3E2_SETUP_WRAPPER_VIRTUAL_ADDRESS,
  applyStage3e2Species,
  buildStage3e2AssetBank,
  decodeStage3e2AbiHex,
} from "../build-stage3e2.mjs";
import { FRAMER_SCREEN_AUDIT } from "../lib/framer-registry-audit.mjs";

const firmwareUrl = new URL("../../artifacts/firmware/firmware_0.4.1_merged.bin", import.meta.url);
const c1AbiUrl = new URL("../experimental/stage3c1-wpm-labels.hex", import.meta.url);
const stage3e2AbiUrl = new URL("../experimental/stage3e2-wpm-species.hex", import.meta.url);
const assetManifestUrl = new URL("../../framer-widgets/assets/device-lvgl-v3-species/manifest.json", import.meta.url);
const assetRootUrl = new URL("../../framer-widgets/assets/device-lvgl-v3-species/", import.meta.url);
const sha256 = (data) => createHash("sha256").update(data).digest("hex");

async function fixture() {
  const [official, c1Hex, stage3e2Hex, assetManifestBytes, ...frames] = await Promise.all([
    readFile(firmwareUrl),
    readFile(c1AbiUrl, "utf8"),
    readFile(stage3e2AbiUrl, "utf8"),
    readFile(assetManifestUrl),
    ...STAGE3E2_ASSET_SPECS.map((spec) => readFile(new URL(`${spec.name}.lvgl.bin`, assetRootUrl))),
  ]);
  const c1Abi = decodeStage3c1AbiHex(c1Hex);
  const stage3e2Abi = decodeStage3e2AbiHex(stage3e2Hex);
  const assetManifest = JSON.parse(assetManifestBytes);
  return {
    official,
    c1Abi,
    stage3e2Abi,
    frames,
    assetManifest,
    assetManifestBytes,
    output: applyStage3e2Species(official, c1Abi, stage3e2Abi, frames),
  };
}

test("stage-3E.2 deterministically matches the pinned app, merged image, and ESP integrity", async () => {
  const { output } = await fixture();
  assert.equal(output.app.length, EXPECTED_STAGE3E2_APP_BYTES);
  assert.equal(output.merged.length, EXPECTED_STAGE3E2_MERGED_BYTES);
  assert.equal(sha256(output.app), EXPECTED_STAGE3E2_APP_SHA256);
  assert.equal(sha256(output.merged), EXPECTED_STAGE3E2_MERGED_SHA256);
  assert.equal(output.stage3e2.storedChecksum, EXPECTED_STAGE3E2_CHECKSUM);
  assert.equal(output.stage3e2.storedDigest.toString("hex"), EXPECTED_STAGE3E2_DIGEST);
});

test("stage-3E.2 starts from exact live C1 and changes only setup plus reviewed DROM/IROM appends", async () => {
  const { official, c1Abi, stage3e2Abi, output } = await fixture();
  const c1 = applyStage3c1OwnedLabels(official, c1Abi);
  assert.equal(sha256(c1.app), EXPECTED_STAGE3C1_APP_SHA256);
  assert.equal(output.stage3e2.segmentCount, 6);

  const oldDrom = c1.stage3c1.segments[0];
  const newDrom = output.stage3e2.segments[0];
  const setupRelative = STAGE3C1_SETUP_POINTER_APP_OFFSET - oldDrom.dataOffset;
  assert.deepEqual(newDrom.data.subarray(0, setupRelative), oldDrom.data.subarray(0, setupRelative));
  assert.deepEqual(
    newDrom.data.subarray(setupRelative + 4, oldDrom.length),
    oldDrom.data.subarray(setupRelative + 4),
  );
  assert.equal(newDrom.length, oldDrom.length + STAGE3E2_DROM_GROWTH_BYTES);
  assert.deepEqual(newDrom.data.subarray(oldDrom.length), output.assets.padded);

  const oldIrom = c1.stage3c1.segments[3];
  const newIrom = output.stage3e2.segments[3];
  assert.equal(newIrom.dataOffset, oldIrom.dataOffset + STAGE3E2_DROM_GROWTH_BYTES);
  assert.equal(newIrom.length, oldIrom.length + stage3e2Abi.length);
  assert.deepEqual(newIrom.data.subarray(0, oldIrom.length), oldIrom.data);
  assert.deepEqual(newIrom.data.subarray(oldIrom.length), stage3e2Abi);
  for (const index of [1, 2, 4, 5]) {
    assert.deepEqual(output.stage3e2.segments[index].data, c1.stage3c1.segments[index].data);
  }
});

test("stage-3E.2 keeps one DROM/one IROM with MMU-congruent in-place growth", async () => {
  const { output } = await fixture();
  const drom = output.stage3e2.segments.filter((segment) =>
    segment.loadAddress >= 0x3c000000 && segment.loadAddress < 0x3e000000);
  const irom = output.stage3e2.segments.filter((segment) =>
    segment.loadAddress >= 0x42000000 && segment.loadAddress < 0x44000000);
  assert.equal(drom.length, 1);
  assert.equal(irom.length, 1);
  assert.equal(drom[0].dataOffset & 0xffff, drom[0].loadAddress & 0xffff);
  assert.equal(irom[0].dataOffset & 0xffff, irom[0].loadAddress & 0xffff);
  assert.equal(drom[0].loadAddress + drom[0].length - STAGE3E2_DROM_GROWTH_BYTES,
    STAGE3E2_ASSET_BANK_VIRTUAL_ADDRESS);
  assert.equal(irom[0].dataOffset + irom[0].length - STAGE3E2_ABI_BYTES,
    STAGE3E2_ABI_APP_OFFSET);
  assert.equal(irom[0].loadAddress + irom[0].length - STAGE3E2_ABI_BYTES,
    STAGE3E2_ABI_VIRTUAL_ADDRESS);
});

test("stage-3E.2 installs only setup while stock key, getter, and DROM WPM tick remain exact", async () => {
  const { output } = await fixture();
  assert.equal(output.app.readUInt32LE(STAGE3C1_SETUP_POINTER_APP_OFFSET),
    STAGE3E2_SETUP_WRAPPER_VIRTUAL_ADDRESS);
  assert.equal(output.finalKeyOffset, STAGE3C1_KEY_CALLBACK_APP_OFFSET + STAGE3E2_DROM_GROWTH_BYTES);
  assert.equal(output.app.readUInt32LE(output.finalKeyOffset),
    FRAMER_SCREEN_AUDIT.wpmKeyCallbackLiteral.expectedValue);
  assert.equal(output.finalGetterOffset,
    REMAINING_GETTER_LITERAL_APP_OFFSET + STAGE3E2_DROM_GROWTH_BYTES);
  assert.equal(output.app.readUInt32LE(output.finalGetterOffset), STOCK_REMAINING_GETTER);
  assert.equal(output.app.readUInt32LE(STAGE3C1_WPM_TICK_APP_OFFSET),
    FRAMER_SCREEN_AUDIT.wpmTickVtablePointer.expectedValue,
  "the tick pointer is in DROM before the append boundary, so its app offset does not shift");
});

test("stage-3E.2 asset manifest/order/hashes and native descriptors are pinned", async () => {
  const { assetManifest, assetManifestBytes, frames, output } = await fixture();
  assert.equal(sha256(assetManifestBytes), STAGE3E2_ASSET_MANIFEST_SHA256);
  assert.equal(assetManifest.format, "framer-f1-wpm-pet-lvgl-assets-v3-six-species");
  assert.deepEqual(assetManifest.rosterOrder,
    ["Belgian Tervuren", "Pepe", "Angry owl", "Cute ferret", "Cat", "Lazy cow"]);
  assert.deepEqual(assetManifest.stateOrder,
    ["ready", "curious", "happy", "zooming", "fire", "tired", "waiting", "sleeping"]);
  assert.deepEqual(assetManifest.frames.slice(0, 2).map(({ width, height }) => [width, height]),
    [[100, 310], [100, 310]]);
  assert.deepEqual(assetManifest.frames.map(({ name }) => name),
    STAGE3E2_ASSET_SPECS.map(({ name }) => name));
  for (let index = 0; index < STAGE3E2_ASSET_SPECS.length; index += 1) {
    const spec = STAGE3E2_ASSET_SPECS[index];
    const record = assetManifest.frames[index];
    const descriptor = output.assets.descriptors[index];
    assert.equal(sha256(frames[index]), record.lvglSha256);
    assert.equal(record.width, spec.width);
    assert.equal(record.height, spec.height);
    assert.equal(descriptor.descriptorAddress, STAGE3E2_ASSET_BANK_VIRTUAL_ADDRESS + index * 24);
    const appOffset = STAGE3E2_ASSET_BANK_APP_OFFSET + index * 24;
    assert.equal(output.app[appOffset], 0x19);
    assert.equal(output.app[appOffset + 1], 0x0a);
    assert.equal(output.app.readUInt16LE(appOffset + 4), spec.width);
    assert.equal(output.app.readUInt16LE(appOffset + 6), spec.height);
    assert.equal(output.app.readUInt32LE(appOffset + 16), descriptor.dataAddress);
  }
  assert.equal(output.assets.bank.length, STAGE3E2_ASSET_BANK_BYTES);
  assert.equal(sha256(output.assets.bank), STAGE3E2_ASSET_BANK_SHA256);
  assert.equal(sha256(output.assets.padded), STAGE3E2_PADDED_BANK_SHA256);
});

test("stage-3E.2 preserves every pre-app merged byte and appends no second payload", async () => {
  const { official, output } = await fixture();
  assert.deepEqual(output.merged.subarray(0, APP_FLASH_OFFSET), official.subarray(0, APP_FLASH_OFFSET));
  assert.deepEqual(output.merged.subarray(APP_FLASH_OFFSET), output.app);
});

test("stage-3E.2 rejects a changed ABI or any changed converted asset", async () => {
  const { official, c1Abi, stage3e2Abi, frames } = await fixture();
  const changedAbi = Buffer.from(stage3e2Abi);
  changedAbi[changedAbi.length - 1] ^= 1;
  assert.throws(() => applyStage3e2Species(official, c1Abi, changedAbi, frames),
    /machine-verified artifact/u);

  const changedFrames = frames.map(Buffer.from);
  changedFrames[4][changedFrames[4].length - 1] ^= 1;
  assert.throws(() => buildStage3e2AssetBank(changedFrames), /native descriptor\/data bank changed/u);
});

test("stage-3E.2 ABI remains the exact machine-verified no-hook blob", async () => {
  const { stage3e2Abi } = await fixture();
  assert.equal(stage3e2Abi.length, STAGE3E2_ABI_BYTES);
  assert.equal(sha256(stage3e2Abi), STAGE3E2_ABI_SHA256);
  for (const forbidden of [0x4206eae0, 0x3fcab378]) {
    const needle = Buffer.alloc(4);
    needle.writeUInt32LE(forbidden);
    assert.equal(stage3e2Abi.includes(needle), false);
  }
});
