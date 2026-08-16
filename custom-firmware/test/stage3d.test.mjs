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
  EXPECTED_STAGE3D_APP_BYTES,
  EXPECTED_STAGE3D_APP_SHA256,
  EXPECTED_STAGE3D_CHECKSUM,
  EXPECTED_STAGE3D_DIGEST,
  EXPECTED_STAGE3D_MERGED_BYTES,
  EXPECTED_STAGE3D_MERGED_SHA256,
  STAGE3D_ABI_APP_OFFSET,
  STAGE3D_ABI_BYTES,
  STAGE3D_ABI_SHA256,
  STAGE3D_ABI_VIRTUAL_ADDRESS,
  STAGE3D_KEY_WRAPPER_VIRTUAL_ADDRESS,
  STAGE3D_SCREEN_ID,
  STAGE3D_SETUP_WRAPPER_VIRTUAL_ADDRESS,
  applyStage3dPet,
  decodeStage3dAbiHex,
} from "../build-stage3d.mjs";
import { FRAMER_SCREEN_AUDIT } from "../lib/framer-registry-audit.mjs";

const firmwareUrl = new URL("../../artifacts/firmware/firmware_0.4.1_merged.bin", import.meta.url);
const stage3c1AbiUrl = new URL("../experimental/stage3c1-wpm-labels.hex", import.meta.url);
const stage3dAbiUrl = new URL("../experimental/stage3d-wpm-pet.hex", import.meta.url);
const sha256 = (data) => createHash("sha256").update(data).digest("hex");

async function fixture() {
  const [official, stage3c1Hex, stage3dHex] = await Promise.all([
    readFile(firmwareUrl),
    readFile(stage3c1AbiUrl, "utf8"),
    readFile(stage3dAbiUrl, "utf8"),
  ]);
  const stage3c1Abi = decodeStage3c1AbiHex(stage3c1Hex);
  const stage3dAbi = decodeStage3dAbiHex(stage3dHex);
  return {
    official,
    stage3c1Abi,
    stage3dAbi,
    output: applyStage3dPet(official, stage3c1Abi, stage3dAbi),
  };
}

function countU32(data, value) {
  const needle = Buffer.alloc(4);
  needle.writeUInt32LE(value >>> 0);
  let count = 0;
  for (let offset = 0; offset <= data.length - 4; offset += 1) {
    if (data.subarray(offset, offset + 4).equals(needle)) count += 1;
  }
  return count;
}

test("stage-3D appends the audited pet ABI and installs exactly its two hooks", async () => {
  const { official, stage3c1Abi, stage3dAbi, output } = await fixture();
  const stage3c1 = applyStage3c1OwnedLabels(official, stage3c1Abi);
  const oldIrom = stage3c1.stage3c1.segments[3];
  const newIrom = output.stage3d.segments[3];

  assert.equal(STAGE3D_SCREEN_ID, 7);
  assert.equal(stage3dAbi.length, STAGE3D_ABI_BYTES);
  assert.equal(sha256(stage3dAbi), STAGE3D_ABI_SHA256);
  assert.equal(newIrom.length, oldIrom.length + stage3dAbi.length);
  assert.equal(newIrom.dataOffset + oldIrom.length, STAGE3D_ABI_APP_OFFSET);
  assert.equal(newIrom.loadAddress + oldIrom.length, STAGE3D_ABI_VIRTUAL_ADDRESS);
  assert.deepEqual(newIrom.data.subarray(oldIrom.length), stage3dAbi);
  assert.equal(output.app.readUInt32LE(STAGE3C1_SETUP_POINTER_APP_OFFSET),
    STAGE3D_SETUP_WRAPPER_VIRTUAL_ADDRESS);
  assert.equal(output.app.readUInt32LE(STAGE3C1_KEY_CALLBACK_APP_OFFSET),
    STAGE3D_KEY_WRAPPER_VIRTUAL_ADDRESS);
});

test("stage-3D ABI owns four labels and carries the bounded pet/stat payload", async () => {
  const { stage3dAbi } = await fixture();
  for (const helper of [0x4204f170, 0x4204f018, 0x4204f0d0, 0x4204ee30]) {
    assert.equal(countU32(stage3dAbi, helper), 1,
      `owned-label helper 0x${helper.toString(16)} must be pinned once`);
  }
  assert.equal(countU32(stage3dAbi, 0x3fcaba20), 1, "native current WPM must be read once");
  assert.equal(countU32(stage3dAbi, 0x3fcab378), 1, "direct screen-manager object must be pinned once");
  assert.equal(countU32(stage3dAbi, 0x4206eae0), 1, "stock key handler must be called by the wrapper");
  assert.ok(stage3dAbi.includes(Buffer.from("/\\_/\\\0", "ascii")));
  assert.ok(stage3dAbi.includes(Buffer.from("%u wpm\0", "ascii")));
  assert.ok(stage3dAbi.includes(Buffer.from("A%u H%u L%u\0", "ascii")));
  assert.ok(stage3dAbi.includes(Buffer.from("(?.?", "ascii")));
  assert.ok(stage3dAbi.includes(Buffer.from("(-.-", "ascii")));
  assert.ok(stage3dAbi.includes(Buffer.from("(^O^", "ascii")));
  assert.ok(stage3dAbi.includes(Buffer.from("(>o<", "ascii")));
  for (const forbidden of [0x42003dc8, 0x3fca4f00, 0x42004f10, 0x4201a930]) {
    assert.equal(countU32(stage3dAbi, forbidden), 0,
      `global bubble value 0x${forbidden.toString(16)} must not be referenced`);
  }
});

test("stage-3D preserves Timer and the native 500-ms WPM writer", async () => {
  const { output } = await fixture();
  assert.equal(output.app.readUInt32LE(REMAINING_GETTER_LITERAL_APP_OFFSET), STOCK_REMAINING_GETTER);
  assert.equal(output.app.readUInt32LE(STAGE3C1_WPM_TICK_APP_OFFSET),
    FRAMER_SCREEN_AUDIT.wpmTickVtablePointer.expectedValue);
  assert.equal(countU32(output.app, STAGE3D_SETUP_WRAPPER_VIRTUAL_ADDRESS), 1);
  assert.equal(countU32(output.app, STAGE3D_KEY_WRAPPER_VIRTUAL_ADDRESS), 1);
});

test("stage-3D changes only setup/key words, appends code, and shifts later segments intact", async () => {
  const { official, stage3c1Abi, stage3dAbi, output } = await fixture();
  const before = applyStage3c1OwnedLabels(official, stage3c1Abi).stage3c1;
  const after = output.stage3d;
  assert.equal(after.segmentCount, 6);
  assert.equal(after.segments.filter(({ loadAddress }) => loadAddress === 0x42000020).length, 1);
  assert.equal(after.segments.filter(({ loadAddress }) => loadAddress === 0x3c120020).length, 1);
  assert.equal(after.segments[3].dataOffset & 0xffff, after.segments[3].loadAddress & 0xffff);

  const setupRelative = STAGE3C1_SETUP_POINTER_APP_OFFSET - before.segments[0].dataOffset;
  assert.deepEqual(after.segments[0].data.subarray(0, setupRelative),
    before.segments[0].data.subarray(0, setupRelative));
  assert.deepEqual(after.segments[0].data.subarray(setupRelative + 4),
    before.segments[0].data.subarray(setupRelative + 4));

  const keyRelative = STAGE3C1_KEY_CALLBACK_APP_OFFSET - before.segments[3].dataOffset;
  assert.deepEqual(after.segments[3].data.subarray(0, keyRelative),
    before.segments[3].data.subarray(0, keyRelative));
  assert.deepEqual(after.segments[3].data.subarray(keyRelative + 4, before.segments[3].length),
    before.segments[3].data.subarray(keyRelative + 4));
  assert.deepEqual(after.segments[3].data.subarray(before.segments[3].length), stage3dAbi);

  for (let index = 4; index < 6; index += 1) {
    assert.equal(after.segments[index].headerOffset, before.segments[index].headerOffset + stage3dAbi.length);
    assert.equal(after.segments[index].dataOffset, before.segments[index].dataOffset + stage3dAbi.length);
    assert.equal(after.segments[index].loadAddress, before.segments[index].loadAddress);
    assert.equal(after.segments[index].length, before.segments[index].length);
    assert.deepEqual(after.segments[index].data, before.segments[index].data);
  }
});

test("stage-3D integrity, lengths, and complete output hashes are pinned", async () => {
  const { output } = await fixture();
  assert.equal(output.stage3d.storedChecksum, EXPECTED_STAGE3D_CHECKSUM);
  assert.equal(output.stage3d.storedDigest.toString("hex"), EXPECTED_STAGE3D_DIGEST);
  assert.equal(output.app.length, EXPECTED_STAGE3D_APP_BYTES);
  assert.equal(output.merged.length, EXPECTED_STAGE3D_MERGED_BYTES);
  assert.equal(sha256(output.app), EXPECTED_STAGE3D_APP_SHA256);
  assert.equal(sha256(output.merged), EXPECTED_STAGE3D_MERGED_SHA256);
});

test("stage-3D rejects ABI and live-base drift before producing an image", async () => {
  const [official, stage3c1Hex, stage3dHex] = await Promise.all([
    readFile(firmwareUrl),
    readFile(stage3c1AbiUrl, "utf8"),
    readFile(stage3dAbiUrl, "utf8"),
  ]);
  const stage3c1Abi = decodeStage3c1AbiHex(stage3c1Hex);
  const stage3dAbi = decodeStage3dAbiHex(stage3dHex);
  const mutatedAbi = Buffer.from(stage3dAbi);
  mutatedAbi[mutatedAbi.length - 1] ^= 1;
  assert.throws(() => applyStage3dPet(official, stage3c1Abi, mutatedAbi), /ABI blob differs/u);
  assert.throws(() => decodeStage3dAbiHex(`${stage3dHex}zz`), /non-hexadecimal/u);

  const mutatedOfficial = Buffer.from(official);
  mutatedOfficial[0x10020] ^= 1;
  assert.throws(() => applyStage3dPet(mutatedOfficial, stage3c1Abi, stage3dAbi));
  assert.equal(sha256(applyStage3c1OwnedLabels(official, stage3c1Abi).app), EXPECTED_STAGE3C1_APP_SHA256);
});
