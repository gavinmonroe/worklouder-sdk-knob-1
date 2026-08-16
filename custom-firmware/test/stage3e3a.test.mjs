import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
  EXPECTED_STAGE3E3A_APP_BYTES,
  EXPECTED_STAGE3E3A_APP_SHA256,
  EXPECTED_STAGE3E3A_CHECKSUM,
  EXPECTED_STAGE3E3A_DIGEST,
  EXPECTED_STAGE3E3A_MERGED_BYTES,
  EXPECTED_STAGE3E3A_MERGED_SHA256,
  STAGE3E3A_ABI_APP_OFFSET,
  STAGE3E3A_ABI_BYTES,
  STAGE3E3A_ABI_SHA256,
  STAGE3E3A_ASSET_BANK_APP_OFFSET,
  STAGE3E3A_ASSET_BANK_BYTES,
  STAGE3E3A_ASSET_BANK_VIRTUAL_ADDRESS,
  STAGE3E3A_DROM_GROWTH_BYTES,
  STAGE3E3A_SETUP_WRAPPER_VIRTUAL_ADDRESS,
  applyStage3e3aCanary,
  buildStage3e3aAssetBank,
  decodeStage3e3aAbiHex,
} from "../build-stage3e3a.mjs";
import { FRAMER_RUNTIME_ASSET_BOUNDARY } from "../lib/framer-lvgl-indexed.mjs";
import { FRAMER_SCREEN_AUDIT } from "../lib/framer-registry-audit.mjs";

const officialUrl = new URL("../../artifacts/firmware/firmware_0.4.1_merged.bin", import.meta.url);
const c1Url = new URL("../experimental/stage3c1-wpm-labels.hex", import.meta.url);
const abiUrl = new URL("../experimental/stage3e3a-i4-canary.hex", import.meta.url);
const assetUrl = new URL("../../framer-widgets/assets/device-lvgl-v4-i4-canary/cat-ready-52x42.lvgl.bin", import.meta.url);
const builtAppUrl = new URL("../build/framer-0.4.1-stage3e3a-i4-canary-app.bin", import.meta.url);
const builtMergedUrl = new URL("../build/framer-0.4.1-stage3e3a-i4-canary-merged.bin", import.meta.url);
const sha256 = (data) => createHash("sha256").update(data).digest("hex");

async function fixture() {
  const [official, c1Hex, abiHex, asset] = await Promise.all([
    readFile(officialUrl), readFile(c1Url, "utf8"), readFile(abiUrl, "utf8"), readFile(assetUrl),
  ]);
  const c1 = decodeStage3c1AbiHex(c1Hex);
  const abi = decodeStage3e3aAbiHex(abiHex);
  return { official, c1, abi, asset, output: applyStage3e3aCanary(official, c1, abi, asset) };
}

test("Stage-3E.3A deterministically matches pinned output and ESP integrity", async () => {
  const { output } = await fixture();
  assert.equal(output.app.length, EXPECTED_STAGE3E3A_APP_BYTES);
  assert.equal(output.merged.length, EXPECTED_STAGE3E3A_MERGED_BYTES);
  assert.equal(sha256(output.app), EXPECTED_STAGE3E3A_APP_SHA256);
  assert.equal(sha256(output.merged), EXPECTED_STAGE3E3A_MERGED_SHA256);
  assert.equal(output.stage3e3a.storedChecksum, EXPECTED_STAGE3E3A_CHECKSUM);
  assert.equal(output.stage3e3a.storedDigest.toString("hex"), EXPECTED_STAGE3E3A_DIGEST);
  assert.deepEqual(output.app, await readFile(builtAppUrl));
  assert.deepEqual(output.merged, await readFile(builtMergedUrl));
});

test("Stage-3E.3A starts from exact live C1 and changes only setup/DROM/IROM append", async () => {
  const { official, c1, abi, output } = await fixture();
  const base = applyStage3c1OwnedLabels(official, c1);
  assert.equal(sha256(base.app), EXPECTED_STAGE3C1_APP_SHA256);
  const oldDrom = base.stage3c1.segments[0];
  const newDrom = output.stage3e3a.segments[0];
  const setup = STAGE3C1_SETUP_POINTER_APP_OFFSET - oldDrom.dataOffset;
  assert.deepEqual(newDrom.data.subarray(0, setup), oldDrom.data.subarray(0, setup));
  assert.deepEqual(newDrom.data.subarray(setup + 4, oldDrom.length), oldDrom.data.subarray(setup + 4));
  assert.equal(newDrom.length, oldDrom.length + STAGE3E3A_DROM_GROWTH_BYTES);
  const oldIrom = base.stage3c1.segments[3];
  const newIrom = output.stage3e3a.segments[3];
  assert.deepEqual(newIrom.data.subarray(0, oldIrom.length), oldIrom.data);
  assert.deepEqual(newIrom.data.subarray(oldIrom.length), abi);
  for (const index of [1, 2, 4, 5]) assert.deepEqual(output.stage3e3a.segments[index].data, base.stage3c1.segments[index].data);
});

test("Stage-3E.3A has one static binary-alpha I4 source entirely below the proven boundary", async () => {
  const { asset, output } = await fixture();
  assert.equal(output.assets.bank.length, STAGE3E3A_ASSET_BANK_BYTES);
  assert.equal(output.assets.descriptors.length, 1);
  assert.equal(output.assets.descriptors[0].descriptorAddress, STAGE3E3A_ASSET_BANK_VIRTUAL_ADDRESS);
  assert.equal(output.assets.descriptors[0].colorFormat, 0x09);
  assert.equal(output.assets.boundary.endAddress, 0x3c1c162c);
  assert.ok(output.assets.boundary.endAddress < FRAMER_RUNTIME_ASSET_BOUNDARY.originalMappedPageEnd);
  assert.deepEqual(new Set(Array.from({ length: 16 }, (_, index) => asset[12 + index * 4 + 3])), new Set([0, 255]));
  assert.deepEqual(output.app.subarray(STAGE3E3A_ASSET_BANK_APP_OFFSET,
    STAGE3E3A_ASSET_BANK_APP_OFFSET + output.assets.bank.length), output.assets.bank);
});

test("Stage-3E.3A keeps stock key/getter/tick and patches only the ID7 setup wrapper", async () => {
  const { output } = await fixture();
  assert.equal(output.app.readUInt32LE(STAGE3C1_SETUP_POINTER_APP_OFFSET), STAGE3E3A_SETUP_WRAPPER_VIRTUAL_ADDRESS);
  assert.equal(output.app.readUInt32LE(output.finalGetterOffset), STOCK_REMAINING_GETTER);
  assert.equal(output.app.readUInt32LE(output.finalKeyOffset), FRAMER_SCREEN_AUDIT.wpmKeyCallbackLiteral.expectedValue);
  assert.equal(output.finalGetterOffset, REMAINING_GETTER_LITERAL_APP_OFFSET + STAGE3E3A_DROM_GROWTH_BYTES);
  assert.equal(output.finalKeyOffset, STAGE3C1_KEY_CALLBACK_APP_OFFSET + STAGE3E3A_DROM_GROWTH_BYTES);
  assert.equal(output.app.readUInt32LE(STAGE3C1_WPM_TICK_APP_OFFSET), FRAMER_SCREEN_AUDIT.wpmTickVtablePointer.expectedValue);
});

test("Stage-3E.3A rejects any changed ABI or indexed asset", async () => {
  const { official, c1, abi, asset } = await fixture();
  const changedAbi = Buffer.from(abi); changedAbi.at(-1); changedAbi[changedAbi.length - 1] ^= 1;
  assert.throws(() => applyStage3e3aCanary(official, c1, changedAbi, asset), /ABI changed/u);
  const changedAsset = Buffer.from(asset); changedAsset[changedAsset.length - 1] ^= 1;
  assert.throws(() => buildStage3e3aAssetBank(changedAsset), /pinned converter output/u);
  assert.equal(abi.length, STAGE3E3A_ABI_BYTES);
  assert.equal(sha256(abi), STAGE3E3A_ABI_SHA256);
  assert.deepEqual(outputSlice(await fixture()), await readFile(builtAppUrl));
});

function outputSlice({ output }) {
  return output.app.subarray(0, EXPECTED_STAGE3E3A_APP_BYTES);
}
