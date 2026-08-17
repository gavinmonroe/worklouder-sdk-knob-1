import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeMquickjsMailboxSlots,
  decodeSettingsWord,
  encodeSettingsWord,
  parseMquickjsTelemetryPage,
  readMquickjsSettings,
} from "../examples/render-v2-mquickjs-weather-canary/tools/zip-sync-telemetry.mjs";

function hex8(value) {
  return (value >>> 0).toString(16).padStart(8, "0");
}

function page(pageNumber, slots) {
  return `v1;p=${pageNumber};${slots.map((value, index) =>
    `s${pageNumber === 6 ? index : index + 8}=${hex8(value)}`).join(";")}`;
}

test("decodeSettingsWord extracts ZIP, settingsActive, pendingSave, and saveSeq bit fields", () => {
  const word = encodeSettingsWord({ zip: 60_601, settingsActive: true, pendingSave: true, saveSeq: 7 });
  assert.deepEqual(decodeSettingsWord(word), { zip: 60_601, postalCode: "60601",
    settingsActive: true, pendingSave: true, saveSeq: 7 });
});

test("decodeSettingsWord round-trips every corner of its bitfields, including the maximum ZIP and saveSeq", () => {
  for (const fields of [
    { zip: 0, settingsActive: false, pendingSave: false, saveSeq: 0 },
    { zip: 99_999, settingsActive: true, pendingSave: false, saveSeq: 255 },
    { zip: 501, settingsActive: false, pendingSave: true, saveSeq: 128 },
  ]) {
    assert.deepEqual(decodeSettingsWord(encodeSettingsWord(fields)),
      { ...fields, postalCode: String(fields.zip).padStart(5, "0") });
  }
});

test("decodeSettingsWord zero-pads short ZIPs and rejects a ZIP above 99999", () => {
  assert.equal(decodeSettingsWord(encodeSettingsWord({ zip: 501 })).postalCode, "00501");
  // Bits 0..16 hold at most 131071; anything above 99999 is a malformed word.
  assert.throws(() => decodeSettingsWord(0x1_ffff), { code: "ZIP_SYNC_SETTINGS_ZIP_INVALID" });
});

test("decodeSettingsWord decodes two's-complement negative int32 inputs the same as unsigned ones", () => {
  // saveSeq occupies bits 24..31, so saveSeq >= 128 sets the int32 sign bit.
  const word = encodeSettingsWord({ zip: 10_001, settingsActive: true, pendingSave: true, saveSeq: 200 });
  assert.ok(word < 0, "a saveSeq >= 128 makes this word negative as a signed int32");
  assert.deepEqual(decodeSettingsWord(word), { zip: 10_001, postalCode: "10001",
    settingsActive: true, pendingSave: true, saveSeq: 200 });
});

test("parseMquickjsTelemetryPage reads eight hex slots from the v1;p=6/7 grammar", () => {
  const slots6 = [1, 2, 3, 4, 5, 6, 7, 8];
  assert.deepEqual(parseMquickjsTelemetryPage(page(6, slots6), 6), slots6);
  const slots7 = [9, 10, 11, 12, 13, 14, 15, 16];
  assert.deepEqual(parseMquickjsTelemetryPage(page(7, slots7), 7), slots7);
});

test("parseMquickjsTelemetryPage decodes negative two's-complement hex words", () => {
  const status = "v1;p=6;s0=ffffffff;s1=80000000;s2=00000000;s3=00000000;" +
    "s4=00000000;s5=00000000;s6=00000000;s7=00000000";
  assert.deepEqual(parseMquickjsTelemetryPage(status, 6), [-1, -0x80000000, 0, 0, 0, 0, 0, 0]);
});

test("parseMquickjsTelemetryPage fails closed on the wrong page number, short status, or malformed grammar", () => {
  assert.throws(() => parseMquickjsTelemetryPage("v1;p=6;s0=00000000", 6), { code: "ZIP_SYNC_TELEMETRY_GRAMMAR_MISMATCH" });
  assert.throws(() => parseMquickjsTelemetryPage(page(6, [1, 2, 3, 4, 5, 6, 7, 8]), 7), { code: "ZIP_SYNC_TELEMETRY_GRAMMAR_MISMATCH" });
  assert.throws(() => parseMquickjsTelemetryPage(page(7, [1, 2, 3, 4, 5, 6, 7, 8]), 6), { code: "ZIP_SYNC_TELEMETRY_GRAMMAR_MISMATCH" });
  assert.throws(() => parseMquickjsTelemetryPage("v1;p=8;s0=00000000", 8), { code: "ZIP_SYNC_TELEMETRY_PAGE_INVALID" });
  assert.throws(() => parseMquickjsTelemetryPage(42, 6), { code: "ZIP_SYNC_TELEMETRY_INVALID" });
});

test("decodeMquickjsMailboxSlots joins page 6 (slots 0..7) and page 7 (slots 8..15) into the 16-slot mailbox", () => {
  const low = [0, 1, 2, 3, 4, 5, 6, 7];
  const high = [8, 9, 10, 11, 12, 13, 14, 15];
  const slots = decodeMquickjsMailboxSlots({ page6: page(6, low), page7: page(7, high) });
  assert.deepEqual(slots, [...low, ...high]);
  assert.equal(slots.length, 16);
});

test("readMquickjsSettings reads slot 14 (index 6 of page 7) as the settings word", () => {
  const high = [0, 0, 0, 0, 0, 0, encodeSettingsWord({ zip: 90_210, settingsActive: true, pendingSave: false, saveSeq: 9 }), 0];
  const slots = decodeMquickjsMailboxSlots({ page6: page(6, [0, 0, 0, 0, 0, 0, 0, 0]), page7: page(7, high) });
  assert.deepEqual(readMquickjsSettings(slots), { zip: 90_210, postalCode: "90210",
    settingsActive: true, pendingSave: false, saveSeq: 9 });
});
