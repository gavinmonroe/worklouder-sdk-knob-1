/**
 * Pure decode helpers for the ZIP-settings telemetry contract described in
 * experiments/mquickjs-esp32s3-physical-canary/ZIP-SETTINGS-PLAN.md.
 *
 * Device -> host: `widget.mquickjs.telemetry` with params `{ page: 6 }` and
 * `{ page: 7 }` each return `{ status: "v1;p=6;s0=xxxxxxxx;...;s7=xxxxxxxx" }`
 * (page 6 carries mailbox slots 0..7) and `"v1;p=7;s8=...;...;s15=..."` (page 7
 * carries mailbox slots 8..15). Every slot is an 8-hex two's-complement int32.
 *
 * Slot 14 is the settings word:
 *   bits 0..16  ZIP code, 0..99999
 *   bit  17     settingsActive
 *   bit  18     pendingSave
 *   bits 24..31 saveSeq (wraps 0..255)
 *
 * No network or hardware I/O happens in this module; it only parses strings
 * already returned by an RPC call made elsewhere.
 */

const HEX8 = "[0-9a-fA-F]{8}";

function invariant(value, message, code = "ZIP_SYNC_TELEMETRY_INVALID") {
  if (!value) throw Object.assign(new Error(message), { code });
}

function pagePattern(page, startSlot, count) {
  const fields = Array.from({ length: count }, (_, index) => `s${startSlot + index}=(${HEX8})`).join(";");
  return new RegExp(`^v1;p=${page};${fields}$`, "u");
}

const PAGE_PATTERNS = Object.freeze({ 6: pagePattern(6, 0, 8), 7: pagePattern(7, 8, 8) });

function hexToInt32(hex) {
  return Number.parseInt(hex, 16) | 0;
}

/** Parses one `widget.mquickjs.telemetry` page-6 or page-7 status string into its 8 raw int32 slot values. */
export function parseMquickjsTelemetryPage(status, page) {
  const pattern = PAGE_PATTERNS[page];
  invariant(pattern, `Telemetry page must be 6 or 7, received ${page}.`, "ZIP_SYNC_TELEMETRY_PAGE_INVALID");
  invariant(typeof status === "string" && status.length <= 128,
    `Telemetry page ${page} response must be a bounded status string.`);
  const match = pattern.exec(status);
  invariant(match, `Telemetry page ${page} does not match the expected "v1;p=${page};s..=xxxxxxxx" grammar.`,
    "ZIP_SYNC_TELEMETRY_GRAMMAR_MISMATCH");
  return Object.freeze(match.slice(1).map(hexToInt32));
}

/** Combines page 6 (slots 0..7) and page 7 (slots 8..15) status strings into the 16-slot mailbox. */
export function decodeMquickjsMailboxSlots({ page6, page7 } = {}) {
  const low = parseMquickjsTelemetryPage(page6, 6);
  const high = parseMquickjsTelemetryPage(page7, 7);
  const slots = Object.freeze([...low, ...high]);
  invariant(slots.length === 16, "Decoded mquickjs mailbox must contain exactly 16 slots.");
  return slots;
}

/** Decodes mailbox slot 14 (the settings word) into its ZIP/active/pending-save/save-sequence fields. */
export function decodeSettingsWord(rawValue) {
  invariant(Number.isInteger(rawValue), "Settings word must be an int32.");
  const word = rawValue >>> 0;
  const zip = word & 0x1_ffff;
  invariant(zip <= 99_999, `Settings word ZIP ${zip} exceeds the 0..99999 range.`, "ZIP_SYNC_SETTINGS_ZIP_INVALID");
  return Object.freeze({
    zip,
    postalCode: String(zip).padStart(5, "0"),
    settingsActive: Boolean((word >>> 17) & 1),
    pendingSave: Boolean((word >>> 18) & 1),
    saveSeq: (word >>> 24) & 0xff,
  });
}

/** Encodes a settings word from its fields; the inverse of decodeSettingsWord(). Useful for fixtures/tests. */
export function encodeSettingsWord({ zip, settingsActive = false, pendingSave = false, saveSeq = 0 } = {}) {
  invariant(Number.isInteger(zip) && zip >= 0 && zip <= 99_999, "encodeSettingsWord zip must be 0..99999.");
  invariant(Number.isInteger(saveSeq) && saveSeq >= 0 && saveSeq <= 0xff, "encodeSettingsWord saveSeq must be 0..255.");
  const word = (zip & 0x1_ffff) | ((settingsActive ? 1 : 0) << 17) | ((pendingSave ? 1 : 0) << 18) |
    ((saveSeq & 0xff) << 24);
  return word | 0;
}

/** Reads the settings word (slot 14) out of a decoded 16-slot mailbox. */
export function readMquickjsSettings(slots) {
  invariant(Array.isArray(slots) && slots.length === 16, "readMquickjsSettings requires the 16 decoded slots.");
  return decodeSettingsWord(slots[14]);
}
