import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildStage3e2AssetBank, STAGE3E2_ASSET_SPECS } from "../build-stage3e2.mjs";
import {
  FRAMER_INDEXED_IMAGE,
  FRAMER_LVGL_CACHE_ABI,
  FRAMER_RUNTIME_ASSET_BOUNDARY,
  auditRuntimeAssetBoundary,
  buildNativeLvglIndexedBank,
  indexedStride,
  packIndexedPixels,
  parseSerializedLvglIndexed,
  readVirtualAppBytes,
  serializeLvglIndexed,
} from "../lib/framer-lvgl-indexed.mjs";

const firmwareUrl = new URL("../../artifacts/firmware/framer_app_0.4.1.bin", import.meta.url);
const e2AssetsUrl = new URL("../../framer-widgets/assets/device-lvgl-v3-species/", import.meta.url);

test("stock Framer descriptors pin I2=08, I4=09, and I8=0a layout", async () => {
  const app = await readFile(firmwareUrl);
  const records = [
    { address: 0x3c1a3444, format: "I2", width: 14, height: 14, stride: 4, bytes: 72 },
    { address: 0x3c19ccc8, format: "I4", width: 54, height: 51, stride: 27, bytes: 1441 },
    { address: 0x3c192c34, format: "I8", width: 78, height: 68, stride: 78, bytes: 6328 },
  ];
  for (const record of records) {
    const descriptor = readVirtualAppBytes(app, record.address, 24);
    const format = FRAMER_INDEXED_IMAGE.formats[record.format];
    assert.equal(descriptor[0], 0x19);
    assert.equal(descriptor[1], format.colorFormat);
    assert.equal(descriptor.readUInt16LE(4), record.width);
    assert.equal(descriptor.readUInt16LE(6), record.height);
    assert.equal(descriptor.readUInt16LE(8), record.stride);
    assert.equal(descriptor.readUInt32LE(12), record.bytes);
  }
});

test("I2/I4 packing is high-bit-first and odd widths keep row padding isolated", () => {
  assert.equal(packIndexedPixels(Uint8Array.from([0, 1, 2, 3]),
    { width: 4, height: 1, bitsPerPixel: 2 }).toString("hex"), "1b");
  assert.equal(packIndexedPixels(Uint8Array.from([1, 2, 3]),
    { width: 3, height: 1, bitsPerPixel: 4 }).toString("hex"), "1230");
  assert.equal(indexedStride(52, 4), 26);
});

test("one 52x42 I4 canary and all 48 fixed-size frames fit the original DROM page", () => {
  const indices = new Uint8Array(52 * 42);
  const frame = serializeLvglIndexed({
    width: 52,
    height: 42,
    formatName: "I4",
    paletteBgra: Buffer.alloc(64),
    indices,
  });
  assert.deepEqual(parseSerializedLvglIndexed(frame), {
    flags: 0, width: 52, height: 42, stride: 26, dataBytes: 1156,
    colorFormat: 9, colors: 16, bitsPerPixel: 4, paletteBytes: 64,
  });
  const canary = buildNativeLvglIndexedBank([frame], { baseAddress: FRAMER_RUNTIME_ASSET_BOUNDARY.stockDromEnd });
  assert.equal(canary.bank.length, 1180);
  assert.equal(auditRuntimeAssetBoundary(canary.bank).endAddress, 0x3c1c162c);

  const roster = buildNativeLvglIndexedBank(Array(48).fill(frame), {
    baseAddress: FRAMER_RUNTIME_ASSET_BOUNDARY.stockDromEnd,
  });
  assert.equal(roster.bank.length, 56640);
  assert.deepEqual(auditRuntimeAssetBoundary(roster.bank), {
    baseAddress: 0x3c1c1190,
    endAddress: 0x3c1ceed0,
    bytes: 56640,
    headroom: 4400,
  });
});

test("historical Stage-3E.2 bank fails at the exact live corruption boundary", async () => {
  const frames = await Promise.all(STAGE3E2_ASSET_SPECS.map(({ name }) =>
    readFile(new URL(`${name}.lvgl.bin`, e2AssetsUrl))));
  const assets = buildStage3e2AssetBank(frames);
  assert.throws(() => auditRuntimeAssetBoundary(assets.bank), /crosses the live-proven DROM boundary/u);
  const boundary = FRAMER_RUNTIME_ASSET_BOUNDARY.originalMappedPageEnd;
  const sky1 = assets.descriptors[1];
  const sky1PixelAddress = sky1.dataAddress + FRAMER_INDEXED_IMAGE.formats.I8.paletteBytes;
  const pixelsBeforeBoundary = boundary - sky1PixelAddress;
  assert.equal(Math.floor(pixelsBeforeBoundary / 100), 267);
  assert.equal(pixelsBeforeBoundary % 100, 92);
  assert.ok(assets.descriptors.slice(2).every(({ dataAddress }) => dataAddress >= boundary));
});

test("stock image-cache ABI pins 256 KiB budget and per-source drop wrapper", async () => {
  const app = await readFile(firmwareUrl);
  assert.equal(FRAMER_LVGL_CACHE_ABI.imageCacheBudgetBytes, 0x40000);
  assert.equal(readVirtualAppBytes(app, 0x4207fd34, 4).readUInt32LE(), 0x40000);
  assert.equal(readVirtualAppBytes(app, FRAMER_LVGL_CACHE_ABI.imageCacheInit, 3).toString("hex"), "366100");
  assert.equal(readVirtualAppBytes(app, FRAMER_LVGL_CACHE_ABI.imageCacheDrop, 3).toString("hex"), "368100");
  assert.equal(readVirtualAppBytes(app, FRAMER_LVGL_CACHE_ABI.imageSetSrc, 3).toString("hex"), "36c100");
  assert.equal(readVirtualAppBytes(app, FRAMER_LVGL_CACHE_ABI.rootBackgroundColor, 3).toString("hex"), "368100");
});
