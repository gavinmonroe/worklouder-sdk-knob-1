import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { APP_FLASH_OFFSET } from "../build-stage1.mjs";
import { STAGE2_PATCHES, applyStage2Patches } from "../build-stage2.mjs";
import { inspectEsp32AppImage } from "../lib/esp-app-image.mjs";

const firmwareUrl = new URL("../../artifacts/firmware/firmware_0.4.1_merged.bin", import.meta.url);
const sha256 = (data) => createHash("sha256").update(data).digest("hex");

test("stage-2 bridge matches independently derived integrity values", async () => {
  const official = await readFile(firmwareUrl);
  const output = applyStage2Patches(official);
  const info = inspectEsp32AppImage(output.app);
  assert.equal(info.storedChecksum, 0x8e);
  assert.equal(info.storedDigest.toString("hex"), "34cc73c5a3465420907b6b765ef9266a483330063b543ce27044212629de3d7e");
  assert.equal(sha256(output.merged), "461e86542b80dbf34c830c768b764195ae8fe1b0d9bf6fbdf14154cc85828c77");
  assert.equal(output.app.length, official.length - APP_FLASH_OFFSET);
});

test("stage-2 changes only declared adapters plus ESP checksum and digest", async () => {
  const official = await readFile(firmwareUrl);
  const output = applyStage2Patches(official);
  const info = inspectEsp32AppImage(output.app);
  const allowed = new Set([
    ...STAGE2_PATCHES.flatMap((patch) =>
      Array.from({ length: patch.after.length }, (_, index) => patch.mergedOffset - APP_FLASH_OFFSET + index)
    ),
    info.checksumOffset,
    ...Array.from({ length: 32 }, (_, index) => info.digestOffset + index),
  ]);
  const officialApp = official.subarray(APP_FLASH_OFFSET);
  for (let index = 0; index < officialApp.length; index += 1) {
    if (officialApp[index] !== output.app[index]) assert.ok(allowed.has(index), `unexpected changed byte at app 0x${index.toString(16)}`);
  }
});

test("stage-2 rejects a base image with any unexpected original byte", async () => {
  const official = Buffer.from(await readFile(firmwareUrl));
  official[STAGE2_PATCHES[1].mergedOffset] ^= 1;
  assert.throws(() => applyStage2Patches(official), /hash mismatch/u);
});

