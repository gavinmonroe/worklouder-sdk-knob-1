import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  EXPECTED_STAGE3C_APP_BYTES,
  EXPECTED_STAGE3C_APP_SHA256,
  EXPECTED_STAGE3C_CHECKSUM,
  EXPECTED_STAGE3C_DIGEST,
  EXPECTED_STAGE3C_MERGED_BYTES,
  EXPECTED_STAGE3C_MERGED_SHA256,
  STAGE3C_ABI_APP_OFFSET,
  STAGE3C_ABI_BYTES,
  STAGE3C_ABI_SHA256,
  STAGE3C_ABI_VIRTUAL_ADDRESS,
  STAGE3C_KEY_CALLBACK_APP_OFFSET,
  STAGE3C_SCREEN_ID,
  STAGE3C_SETUP_POINTER_APP_OFFSET,
  STAGE3C_SETUP_WRAPPER_VIRTUAL_ADDRESS,
  STAGE3C_UNREFERENCED_KEY_WRAPPER_VIRTUAL_ADDRESS,
  STAGE3C_WPM_TICK_APP_OFFSET,
  applyStage3cSelectableWpm,
  decodeStage3cAbiHex,
} from "../build-stage3c.mjs";
import {
  REMAINING_GETTER_LITERAL_APP_OFFSET,
  STAGE3B_CODE_VIRTUAL_ADDRESS,
  STOCK_REMAINING_GETTER,
  applyStage3bVisibleCanary,
} from "../build-stage3b.mjs";
import { FRAMER_SCREEN_AUDIT } from "../lib/framer-registry-audit.mjs";

const firmwareUrl = new URL("../../artifacts/firmware/firmware_0.4.1_merged.bin", import.meta.url);
const abiUrl = new URL("../experimental/stage3c-wpm-abi.hex", import.meta.url);
const sha256 = (data) => createHash("sha256").update(data).digest("hex");

async function fixture() {
  const [official, abiHex] = await Promise.all([readFile(firmwareUrl), readFile(abiUrl, "utf8")]);
  const abi = decodeStage3cAbiHex(abiHex);
  return { official, abi, output: applyStage3cSelectableWpm(official, abi) };
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

test("stage-3C appends the pinned native WPM ABI and installs only its setup hook", async () => {
  const { official, abi, output } = await fixture();
  const stage3b = applyStage3bVisibleCanary(official);
  const oldIrom = stage3b.stage3b.segments[3];
  const newIrom = output.stage3c.segments[3];

  assert.equal(abi.length, STAGE3C_ABI_BYTES);
  assert.equal(sha256(abi), STAGE3C_ABI_SHA256);
  assert.equal(newIrom.length, oldIrom.length + abi.length);
  assert.equal(newIrom.dataOffset + oldIrom.length, STAGE3C_ABI_APP_OFFSET);
  assert.equal(newIrom.loadAddress + oldIrom.length, STAGE3C_ABI_VIRTUAL_ADDRESS);
  assert.deepEqual(newIrom.data.subarray(oldIrom.length), abi);
  assert.equal(output.app.readUInt32LE(STAGE3C_SETUP_POINTER_APP_OFFSET), STAGE3C_SETUP_WRAPPER_VIRTUAL_ADDRESS);
  assert.equal(output.registry.recommendedWpmScreenId, STAGE3C_SCREEN_ID);
  assert.ok(!output.registry.navigationIds.includes(STAGE3C_SCREEN_ID));
});

test("stage-3C restores Timer and leaves both native WPM callbacks untouched", async () => {
  const { output } = await fixture();
  assert.equal(output.app.readUInt32LE(REMAINING_GETTER_LITERAL_APP_OFFSET), STOCK_REMAINING_GETTER);
  assert.notEqual(output.app.readUInt32LE(REMAINING_GETTER_LITERAL_APP_OFFSET), STAGE3B_CODE_VIRTUAL_ADDRESS);
  assert.equal(
    output.app.readUInt32LE(STAGE3C_KEY_CALLBACK_APP_OFFSET),
    FRAMER_SCREEN_AUDIT.wpmKeyCallbackLiteral.expectedValue,
  );
  assert.equal(
    output.app.readUInt32LE(STAGE3C_WPM_TICK_APP_OFFSET),
    FRAMER_SCREEN_AUDIT.wpmTickVtablePointer.expectedValue,
  );
  assert.equal(countU32(output.app, STAGE3C_UNREFERENCED_KEY_WRAPPER_VIRTUAL_ADDRESS), 0);
});

test("stage-3C preserves all later segment bytes and the single-IROM mapping", async () => {
  const { official, abi, output } = await fixture();
  const before = applyStage3bVisibleCanary(official).stage3b;
  const after = output.stage3c;
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

test("stage-3C integrity, lengths, and complete output hashes are independently pinned", async () => {
  const { output } = await fixture();
  assert.equal(output.stage3c.storedChecksum, EXPECTED_STAGE3C_CHECKSUM);
  assert.equal(output.stage3c.storedDigest.toString("hex"), EXPECTED_STAGE3C_DIGEST);
  assert.equal(output.app.length, EXPECTED_STAGE3C_APP_BYTES);
  assert.equal(output.merged.length, EXPECTED_STAGE3C_MERGED_BYTES);
  assert.equal(sha256(output.app), EXPECTED_STAGE3C_APP_SHA256);
  assert.equal(sha256(output.merged), EXPECTED_STAGE3C_MERGED_SHA256);
});

test("stage-3C rejects ABI drift before producing an image", async () => {
  const [official, abiHex] = await Promise.all([readFile(firmwareUrl), readFile(abiUrl, "utf8")]);
  const abi = decodeStage3cAbiHex(abiHex);
  const mutated = Buffer.from(abi);
  mutated[mutated.length - 1] ^= 1;
  assert.throws(() => applyStage3cSelectableWpm(official, mutated), /ABI blob differs/u);
  assert.throws(() => decodeStage3cAbiHex(`${abiHex}zz`), /non-hexadecimal/u);
});
