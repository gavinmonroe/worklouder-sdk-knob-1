import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  APP_FLASH_OFFSET,
  TIMER_LABEL_APP_OFFSET,
  encodeStage1Label,
  patchTimerLabel,
} from "../build-stage1.mjs";
import { inspectEsp32AppImage, repairEsp32AppIntegrity } from "../lib/esp-app-image.mjs";

const firmwareUrl = new URL("../../artifacts/firmware/firmware_0.4.1_merged.bin", import.meta.url);

test("official Framer 0.4.1 app checksum and appended SHA-256 validate", async () => {
  const merged = await readFile(firmwareUrl);
  const app = merged.subarray(APP_FLASH_OFFSET);
  const info = inspectEsp32AppImage(app);
  assert.equal(info.segmentCount, 6);
  assert.equal(info.digestAppended, true);
  assert.equal(info.dataLength + 32, app.length);
  assert.deepEqual(repairEsp32AppIntegrity(app), app);
});

test("patched field is the heading used by the native Timer screen", async () => {
  const merged = await readFile(firmwareUrl);
  const app = merged.subarray(APP_FLASH_OFFSET);
  // IROM literal 0x42002110 resolves to DROM 0x3c125ae0, the exact app
  // offset patched below. Its only analyzed xref is the label setter callsite
  // at IROM 0x4202a096. App file offsets include the 8-byte IROM segment
  // header at 0xb0018; executable bytes begin at 0xb0020.
  assert.equal(app.readUInt32LE(0xb2110), 0x3c125ae0);
  assert.equal(app.subarray(0xda096, 0xda099).toString("hex"), "b11e60");
  assert.equal(app.subarray(TIMER_LABEL_APP_OFFSET, TIMER_LABEL_APP_OFFSET + 8).toString("ascii"), "Timer\0\0\0");
});

test("stage-1 patch changes only label, checksum, and SHA-256 digest", async () => {
  const merged = await readFile(firmwareUrl);
  const app = merged.subarray(APP_FLASH_OFFSET);
  const before = inspectEsp32AppImage(app);
  const patched = patchTimerLabel(app, "Pomo");
  const after = inspectEsp32AppImage(patched);
  assert.equal(patched.subarray(TIMER_LABEL_APP_OFFSET, TIMER_LABEL_APP_OFFSET + 8).toString("hex"), "506f6d6f00000000");

  const allowed = new Set([
    ...Array.from({ length: 8 }, (_, index) => TIMER_LABEL_APP_OFFSET + index),
    before.checksumOffset,
    ...Array.from({ length: 32 }, (_, index) => before.digestOffset + index),
  ]);
  for (let index = 0; index < app.length; index += 1) {
    if (app[index] !== patched[index]) assert.ok(allowed.has(index), `unexpected changed byte at 0x${index.toString(16)}`);
  }
  assert.equal(after.checksumOffset, before.checksumOffset);
  assert.equal(after.digestOffset, before.digestOffset);
});

test("stage-1 label encoder is constrained to the existing field", () => {
  assert.equal(encodeStage1Label("Focus").toString("hex"), "466f637573000000");
  assert.throws(() => encodeStage1Label("Pomodoro"), /printable ASCII|too long/u);
  assert.throws(() => encodeStage1Label("Bad\n"), /printable ASCII/u);
});
