import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  EXPECTED_STAGE3C1_APP_BYTES,
  EXPECTED_STAGE3C1_APP_SHA256,
  EXPECTED_STAGE3C1_CHECKSUM,
  EXPECTED_STAGE3C1_DIGEST,
  EXPECTED_STAGE3C1_MERGED_BYTES,
  EXPECTED_STAGE3C1_MERGED_SHA256,
  STAGE3C1_ABI_APP_OFFSET,
  STAGE3C1_ABI_BYTES,
  STAGE3C1_ABI_SHA256,
  STAGE3C1_ABI_VIRTUAL_ADDRESS,
  STAGE3C1_KEY_CALLBACK_APP_OFFSET,
  STAGE3C1_SCREEN_ID,
  STAGE3C1_SETUP_POINTER_APP_OFFSET,
  STAGE3C1_SETUP_WRAPPER_VIRTUAL_ADDRESS,
  STAGE3C1_WPM_TICK_APP_OFFSET,
  applyStage3c1OwnedLabels,
  decodeStage3c1AbiHex,
} from "../build-stage3c1.mjs";
import {
  REMAINING_GETTER_LITERAL_APP_OFFSET,
  STAGE3B_CODE_VIRTUAL_ADDRESS,
  STOCK_REMAINING_GETTER,
  applyStage3bVisibleCanary,
} from "../build-stage3b.mjs";
import { FRAMER_SCREEN_AUDIT } from "../lib/framer-registry-audit.mjs";

const firmwareUrl = new URL("../../artifacts/firmware/firmware_0.4.1_merged.bin", import.meta.url);
const abiUrl = new URL("../experimental/stage3c1-wpm-labels.hex", import.meta.url);
const sha256 = (data) => createHash("sha256").update(data).digest("hex");

async function fixture() {
  const [official, abiHex] = await Promise.all([readFile(firmwareUrl), readFile(abiUrl, "utf8")]);
  const abi = decodeStage3c1AbiHex(abiHex);
  return { official, abi, output: applyStage3c1OwnedLabels(official, abi) };
}

function countU32(data, value) {
  const needle = Buffer.alloc(4);
  needle.writeUInt32LE(value);
  let count = 0;
  for (let offset = 0; offset <= data.length - 4; offset += 1) {
    if (data.subarray(offset, offset + 4).equals(needle)) count += 1;
  }
  return count;
}

test("stage-3C.1 appends the pinned owned-label ABI and installs only its setup hook", async () => {
  const { official, abi, output } = await fixture();
  const stage3b = applyStage3bVisibleCanary(official);
  const oldIrom = stage3b.stage3b.segments[3];
  const newIrom = output.stage3c1.segments[3];

  assert.equal(abi.length, STAGE3C1_ABI_BYTES);
  assert.equal(sha256(abi), STAGE3C1_ABI_SHA256);
  assert.equal(newIrom.length, oldIrom.length + abi.length);
  assert.equal(newIrom.dataOffset + oldIrom.length, STAGE3C1_ABI_APP_OFFSET);
  assert.equal(newIrom.loadAddress + oldIrom.length, STAGE3C1_ABI_VIRTUAL_ADDRESS);
  assert.deepEqual(newIrom.data.subarray(oldIrom.length), abi);
  assert.equal(output.app.readUInt32LE(STAGE3C1_SETUP_POINTER_APP_OFFSET),
    STAGE3C1_SETUP_WRAPPER_VIRTUAL_ADDRESS);
  assert.equal(output.registry.recommendedWpmScreenId, STAGE3C1_SCREEN_ID);
  assert.ok(!output.registry.navigationIds.includes(STAGE3C1_SCREEN_ID));
});

test("stage-3C.1 uses the stock slot-1 builder lifecycle and owns its labels", async () => {
  const { abi } = await fixture();
  assert.equal(abi.readUInt32LE(10 * 4), 0x42116e44, "slot 1 must build the WPM labels");
  assert.equal(abi.readUInt32LE(12 * 4), 0x4210882c, "slot 3 must remain the stock no-op");
  assert.equal(abi.readUInt32LE(13 * 4), 0x42116ebc, "slot 4 must clear borrowed label pointers");
  assert.equal(abi.readUInt32LE(15 * 4), 0x42116ed0, "slot 6 must refresh the owned value label");
  assert.equal(abi.readUInt32LE(17 * 4), 0x42116ec8, "slot 8 must return screen ID 7");
  for (const helper of [0x4204f170, 0x4204f018, 0x4204f0d0, 0x4204ee30]) {
    assert.equal(countU32(abi, helper), 1, `owned-label helper 0x${helper.toString(16)} must be pinned once`);
  }
  assert.equal(countU32(abi, 0x3c12e738), 1, "existing lowercase wpm title must be reused");
  assert.equal(countU32(abi, 0x3fcaba20), 1, "native current-WPM float must be read directly");
});

test("stage-3C.1 has no appended-code dependency on the global Framer bubble", async () => {
  const { abi } = await fixture();
  for (const forbidden of [0x42003dc8, 0x3fca4f00, 0x42004f10, 0x4201a930]) {
    assert.equal(countU32(abi, forbidden), 0,
      `global bubble value 0x${forbidden.toString(16)} must not be referenced`);
  }
});

test("stage-3C.1 restores Timer and leaves both native WPM callbacks untouched", async () => {
  const { output } = await fixture();
  assert.equal(output.app.readUInt32LE(REMAINING_GETTER_LITERAL_APP_OFFSET), STOCK_REMAINING_GETTER);
  assert.notEqual(output.app.readUInt32LE(REMAINING_GETTER_LITERAL_APP_OFFSET), STAGE3B_CODE_VIRTUAL_ADDRESS);
  assert.equal(output.app.readUInt32LE(STAGE3C1_KEY_CALLBACK_APP_OFFSET),
    FRAMER_SCREEN_AUDIT.wpmKeyCallbackLiteral.expectedValue);
  assert.equal(output.app.readUInt32LE(STAGE3C1_WPM_TICK_APP_OFFSET),
    FRAMER_SCREEN_AUDIT.wpmTickVtablePointer.expectedValue);
});

test("stage-3C.1 preserves later segments and the single-IROM mapping", async () => {
  const { official, abi, output } = await fixture();
  const before = applyStage3bVisibleCanary(official).stage3b;
  const after = output.stage3c1;
  assert.equal(after.segmentCount, 6);
  assert.equal(after.segments.filter(({ loadAddress }) => loadAddress === 0x42000020).length, 1);
  assert.equal(after.segments.filter(({ loadAddress }) => loadAddress === 0x3c120020).length, 1);
  assert.equal(after.segments[3].dataOffset & 0xffff, after.segments[3].loadAddress & 0xffff);
  for (let index = 4; index < 6; index += 1) {
    assert.equal(after.segments[index].headerOffset, before.segments[index].headerOffset + abi.length);
    assert.equal(after.segments[index].dataOffset, before.segments[index].dataOffset + abi.length);
    assert.equal(after.segments[index].loadAddress, before.segments[index].loadAddress);
    assert.equal(after.segments[index].length, before.segments[index].length);
    assert.deepEqual(after.segments[index].data, before.segments[index].data);
  }
});

test("stage-3C.1 integrity, lengths, and complete output hashes are pinned", async () => {
  const { output } = await fixture();
  assert.equal(output.stage3c1.storedChecksum, EXPECTED_STAGE3C1_CHECKSUM);
  assert.equal(output.stage3c1.storedDigest.toString("hex"), EXPECTED_STAGE3C1_DIGEST);
  assert.equal(output.app.length, EXPECTED_STAGE3C1_APP_BYTES);
  assert.equal(output.merged.length, EXPECTED_STAGE3C1_MERGED_BYTES);
  assert.equal(sha256(output.app), EXPECTED_STAGE3C1_APP_SHA256);
  assert.equal(sha256(output.merged), EXPECTED_STAGE3C1_MERGED_SHA256);
});

test("stage-3C.1 rejects ABI drift before producing an image", async () => {
  const [official, abiHex] = await Promise.all([readFile(firmwareUrl), readFile(abiUrl, "utf8")]);
  const abi = decodeStage3c1AbiHex(abiHex);
  const mutated = Buffer.from(abi);
  mutated[mutated.length - 1] ^= 1;
  assert.throws(() => applyStage3c1OwnedLabels(official, mutated), /ABI blob differs/u);
  assert.throws(() => decodeStage3c1AbiHex(`${abiHex}zz`), /non-hexadecimal/u);
});
