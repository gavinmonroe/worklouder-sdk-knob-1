import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CANARY_DATA,
  EXPECTED_CANARY_APP_SHA256,
  IROM_SEGMENT_INDEX,
  applyStage3aCanary,
} from "../build-stage3a.mjs";
import {
  EXPECTED_STAGE3B_APP_SHA256,
  EXPECTED_STAGE3B_CHECKSUM,
  EXPECTED_STAGE3B_DIGEST,
  EXPECTED_STAGE3B_MERGED_SHA256,
  REMAINING_GETTER_CONSUMERS,
  REMAINING_GETTER_LITERAL_APP_OFFSET,
  STAGE3B_CODE,
  STAGE3B_CODE_APP_OFFSET,
  STAGE3B_CODE_VIRTUAL_ADDRESS,
  STOCK_REMAINING_GETTER,
  applyStage3bVisibleCanary,
} from "../build-stage3b.mjs";

const firmwareUrl = new URL("../../artifacts/firmware/firmware_0.4.1_merged.bin", import.meta.url);
const sha256 = (data) => createHash("sha256").update(data).digest("hex");

test("stage-3B appends an assembled return-42 function and redirects only the remaining-time getter", async () => {
  const official = await readFile(firmwareUrl);
  const stage3a = applyStage3aCanary(official);
  const output = applyStage3bVisibleCanary(official);
  const oldIrom = stage3a.after.segments[IROM_SEGMENT_INDEX];
  const newIrom = output.stage3b.segments[IROM_SEGMENT_INDEX];

  assert.equal(sha256(stage3a.app), EXPECTED_CANARY_APP_SHA256);
  assert.equal(stage3a.app.readUInt32LE(REMAINING_GETTER_LITERAL_APP_OFFSET), STOCK_REMAINING_GETTER);
  assert.equal(output.app.readUInt32LE(REMAINING_GETTER_LITERAL_APP_OFFSET), STAGE3B_CODE_VIRTUAL_ADDRESS);
  assert.equal(newIrom.length, oldIrom.length + STAGE3B_CODE.length);
  assert.deepEqual(newIrom.data.subarray(oldIrom.length - CANARY_DATA.length, oldIrom.length), CANARY_DATA);
  assert.deepEqual(newIrom.data.subarray(oldIrom.length), STAGE3B_CODE);
  assert.equal(newIrom.dataOffset + oldIrom.length, STAGE3B_CODE_APP_OFFSET);
  assert.equal(newIrom.loadAddress + oldIrom.length, STAGE3B_CODE_VIRTUAL_ADDRESS);
  assert.equal(output.stage3b.segmentCount, 6);
  const irom = output.stage3b.segments[IROM_SEGMENT_INDEX];
  for (const consumer of REMAINING_GETTER_CONSUMERS) {
    const offset = consumer.virtualAddress - irom.loadAddress;
    assert.equal(irom.data.subarray(offset, offset + 6).toString("hex"), consumer.expectedHex);
  }
});

test("stage-3B preserves pre-IROM segments and shifts later segment data intact", async () => {
  const official = await readFile(firmwareUrl);
  const output = applyStage3bVisibleCanary(official);
  for (let index = 0; index < output.stage3a.segmentCount; index += 1) {
    const before = output.stage3a.segments[index];
    const after = output.stage3b.segments[index];
    assert.equal(after.loadAddress, before.loadAddress);
    if (index < IROM_SEGMENT_INDEX) {
      assert.equal(after.headerOffset, before.headerOffset);
      assert.equal(after.dataOffset, before.dataOffset);
      assert.equal(after.length, before.length);
      assert.deepEqual(after.data, before.data);
    } else if (index > IROM_SEGMENT_INDEX) {
      assert.equal(after.headerOffset, before.headerOffset + STAGE3B_CODE.length);
      assert.equal(after.dataOffset, before.dataOffset + STAGE3B_CODE.length);
      assert.equal(after.length, before.length);
      assert.deepEqual(after.data, before.data);
    }
  }
});

test("stage-3B integrity values and full output hashes are independently pinned", async () => {
  const official = await readFile(firmwareUrl);
  const output = applyStage3bVisibleCanary(official);
  assert.equal(output.stage3b.storedChecksum, EXPECTED_STAGE3B_CHECKSUM);
  assert.equal(output.stage3b.storedDigest.toString("hex"), EXPECTED_STAGE3B_DIGEST);
  assert.equal(sha256(output.app), EXPECTED_STAGE3B_APP_SHA256);
  assert.equal(sha256(output.merged), EXPECTED_STAGE3B_MERGED_SHA256);
});

test("stage-3B rejects a mutated official base", async () => {
  const official = Buffer.from(await readFile(firmwareUrl));
  official[0x234] ^= 1;
  assert.throws(() => applyStage3bVisibleCanary(official), /hash mismatch/u);
});
