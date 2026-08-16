import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { APP_FLASH_OFFSET, patchTimerLabel } from "../build-stage1.mjs";
import {
  CANARY_DATA,
  CANARY_VIRTUAL_ADDRESS,
  EXPECTED_CANARY_APP_SHA256,
  EXPECTED_CANARY_CHECKSUM,
  EXPECTED_CANARY_DATA_OFFSET,
  EXPECTED_CANARY_DIGEST,
  EXPECTED_CANARY_MERGED_SHA256,
  FACTORY_PARTITION_BYTES,
  IROM_SEGMENT_INDEX,
  applyStage3aCanary,
} from "../build-stage3a.mjs";
import { extendEsp32AppSegment, inspectEsp32AppImage } from "../lib/esp-app-image.mjs";

const firmwareUrl = new URL("../../artifacts/firmware/firmware_0.4.1_merged.bin", import.meta.url);
const sha256 = (data) => createHash("sha256").update(data).digest("hex");

test("stage-3A extends the one existing IROM segment with an unreferenced canary", async () => {
  const official = await readFile(firmwareUrl);
  const output = applyStage3aCanary(official);
  const before = output.before.segments[IROM_SEGMENT_INDEX];
  const after = output.after.segments[IROM_SEGMENT_INDEX];
  assert.equal(output.before.segmentCount, 6);
  assert.equal(output.after.segmentCount, 6);
  assert.equal(after.dataOffset + before.length, EXPECTED_CANARY_DATA_OFFSET);
  assert.equal(after.loadAddress + before.length, CANARY_VIRTUAL_ADDRESS);
  assert.deepEqual(after.data.subarray(before.length), CANARY_DATA);
  assert.equal(after.dataOffset & 0xffff, after.loadAddress & 0xffff);
  assert.ok(output.app.length <= FACTORY_PARTITION_BYTES);
  assert.equal(inspectEsp32AppImage(output.app).storedChecksum, output.after.storedChecksum);
  assert.equal(output.after.storedChecksum, EXPECTED_CANARY_CHECKSUM);
  assert.equal(output.after.storedDigest.toString("hex"), EXPECTED_CANARY_DIGEST);
  assert.equal(sha256(output.app), EXPECTED_CANARY_APP_SHA256);
  assert.equal(sha256(output.merged), EXPECTED_CANARY_MERGED_SHA256);
});

test("stage-3A preserves every live Stage-1 segment byte and adds only 16 app bytes overall", async () => {
  const official = await readFile(firmwareUrl);
  const originalApp = patchTimerLabel(official.subarray(APP_FLASH_OFFSET), "Pomo");
  const output = applyStage3aCanary(official);
  assert.equal(output.app.length, originalApp.length + 16);
  assert.equal(output.app.subarray(0x5ae0, 0x5ae8).toString("hex"), "506f6d6f00000000");
  for (let index = 0; index < output.before.segmentCount; index += 1) {
    const before = output.before.segments[index];
    const after = output.after.segments[index];
    assert.equal(after.loadAddress, before.loadAddress);
    if (index < IROM_SEGMENT_INDEX) {
      assert.equal(after.headerOffset, before.headerOffset);
      assert.equal(after.dataOffset, before.dataOffset);
      assert.equal(after.length, before.length);
      assert.deepEqual(after.data, before.data);
    } else if (index === IROM_SEGMENT_INDEX) {
      assert.equal(after.headerOffset, before.headerOffset);
      assert.equal(after.dataOffset, before.dataOffset);
      assert.equal(after.length, before.length + 16);
      assert.deepEqual(after.data.subarray(0, before.length), before.data);
    } else {
      assert.equal(after.headerOffset, before.headerOffset + 16);
      assert.equal(after.dataOffset, before.dataOffset + 16);
      assert.equal(after.length, before.length);
      assert.deepEqual(after.data, before.data);
    }
  }
  assert.notEqual(sha256(output.app), sha256(originalApp));
});

test("segment extender rejects invalid data and the pinned builder rejects a mutated base", async () => {
  const official = Buffer.from(await readFile(firmwareUrl));
  const app = official.subarray(APP_FLASH_OFFSET);
  assert.throws(
    () => extendEsp32AppSegment(app, { segmentIndex: IROM_SEGMENT_INDEX, data: Buffer.from([1, 2, 3]) }),
    /4-byte-aligned/u,
  );
  official[0x200] ^= 1;
  assert.throws(() => applyStage3aCanary(official), /hash mismatch/u);
});
