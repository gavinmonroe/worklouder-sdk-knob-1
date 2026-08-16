import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  FRAMER_SPRITE_LAYOUT,
  LVGL_IMAGE,
  auditFramerImagePipeline,
  buildNativeLvglI8SpriteBank,
  padSpriteBankForMappedDrom,
  parseSerializedLvglI8,
} from "../lib/framer-lvgl-sprite.mjs";

const officialAppUrl = new URL("../../artifacts/firmware/framer_app_0.4.1.bin", import.meta.url);

function syntheticI8(width, height, { seed = 0, stride = width } = {}) {
  const dataBytes = LVGL_IMAGE.i8PaletteBytes + stride * height;
  const output = Buffer.alloc(LVGL_IMAGE.serializedHeaderBytes + dataBytes);
  output[0] = LVGL_IMAGE.magic;
  output[1] = LVGL_IMAGE.colorFormatI8;
  output.writeUInt16LE(width, 4);
  output.writeUInt16LE(height, 6);
  output.writeUInt16LE(stride, 8);
  for (let offset = LVGL_IMAGE.serializedHeaderBytes; offset < output.length; offset += 1) {
    output[offset] = (offset + seed) & 0xff;
  }
  return output;
}

test("Input converter I8 files have a 12-byte header, 1024-byte palette, and indexed rows", () => {
  const frame = syntheticI8(7, 5, { stride: 8 });
  assert.deepEqual(parseSerializedLvglI8(frame), {
    flags: 0,
    width: 7,
    height: 5,
    stride: 8,
    dataBytes: 1024 + 40,
    serializedBytes: 12 + 1024 + 40,
  });
});

test("native sprite bank builds 24-byte pointer descriptors without treating file bytes as pointers", () => {
  const frames = [syntheticI8(4, 3, { seed: 1 }), syntheticI8(4, 3, { seed: 9 })];
  const baseAddress = FRAMER_SPRITE_LAYOUT.stockDromEndAddress;
  const result = buildNativeLvglI8SpriteBank(frames, { baseAddress });
  assert.equal(result.descriptorTableBytes, 48);
  for (const descriptor of result.descriptors) {
    const offset = descriptor.descriptorOffset;
    assert.equal(result.bank[offset], 0x19);
    assert.equal(result.bank[offset + 1], 0x0a);
    assert.equal(result.bank.readUInt32LE(offset + 12), 1024 + 12);
    assert.equal(result.bank.readUInt32LE(offset + 16), descriptor.dataAddress);
    assert.equal(result.bank.readUInt32LE(offset + 20), 0);
    assert.equal(descriptor.dataAddress & 3, 0);
  }
  assert.deepEqual(result.bank.subarray(result.descriptors[0].dataOffset,
    result.descriptors[0].dataOffset + 1024 + 12), frames[0].subarray(12));
});

test("nine 64x64 I8 pet frames fit in one 64-KiB DROM mapping page", () => {
  const frames = Array.from({ length: 9 }, (_, index) => syntheticI8(64, 64, { seed: index }));
  const { bank } = buildNativeLvglI8SpriteBank(frames, {
    baseAddress: FRAMER_SPRITE_LAYOUT.stockDromEndAddress,
  });
  assert.equal(bank.length, 46_296);
  const padded = padSpriteBankForMappedDrom(bank);
  assert.equal(padded.length, 0x10000);
  assert.deepEqual(padded.subarray(0, bank.length), bank);
  assert.ok(padded.subarray(bank.length).every((byte) => byte === 0));
});

test("I8 parser rejects wrong format, truncated data, and an undersized stride", () => {
  const wrongFormat = syntheticI8(2, 2);
  wrongFormat[1] = 0x12;
  assert.throws(() => parseSerializedLvglI8(wrongFormat), /19 0a/u);
  assert.throws(() => parseSerializedLvglI8(syntheticI8(2, 2).subarray(0, -1)), /byte count/u);
  assert.throws(() => parseSerializedLvglI8(syntheticI8(3, 2, { stride: 2 })), /stride/u);
});

test("official Framer 0.4.1 pins the wallpaper helpers and the true current-controller path", async () => {
  const result = auditFramerImagePipeline(await readFile(officialAppUrl));
  assert.equal(result.pinnedWindows, 10);
  assert.deepEqual(result.currentControllerPath, {
    root: 0x3fcab210,
    registryOffset: 80,
    currentControllerOffset: 12,
  });
});
