import { createHash } from "node:crypto";

import { decodeRasterAnimation } from "../render/raster-animation.mjs";
import { decodeWidgetBundle } from "../render/widget-bundle.mjs";

export const RENDER_V2_MQUICKJS_PACKAGE_FORMAT = "framer-render-v2-mquickjs-package-v1";
export const RENDER_V2_MQUICKJS_PROFILE_ID = "framer-f1-render-v2-mquickjs-v1";
export const RENDER_V2_MQUICKJS_ENGINE_COMMIT =
  "203d5bb79789bc47b74855d9207415dab71661a0";
export const RENDER_V2_MQUICKJS_SOURCE_PREFIX = `"use strict";\n`;

export const RENDER_V2_MQUICKJS_EVENT_KINDS = Object.freeze({
  "tick.100ms": 1,
  "tick.1s": 2,
  "input.fn-bottom-knob": 3,
  "host.rpc": 4,
  key: 5,
  chord: 6,
  "tick.1ms": 7,
});

export const RENDER_V2_MQUICKJS_TARGET_WRITES = Object.freeze({
  textContent: 1,
  color: 2,
  hidden: 4,
});

export const RENDER_V2_MQUICKJS_LIMITS = Object.freeze({
  headerBytes: 128,
  packageBytes: 98_304,
  sourceBytes: 8_192,
  heapBytes: 65_536,
  callbackDeadlineUs: 2_000,
  handlers: 16,
  targets: 16,
  keys: 16,
  chords: 8,
  chordKeys: 4,
  eventRecords: 32,
  eventRecordBytes: 16,
  targetRecordBytes: 32,
  rasterBaseBytes: 62_404,
});

const MAGIC = "F2JS";
const MAGIC_BYTES = Buffer.from(MAGIC, "ascii");
const F1WB_MAGIC_BYTES = Buffer.from("F1WB", "ascii");
const VERSION = 1;
const SECTION_COUNT = 4;
const FLAG_RASTER_BASE = 1;
const EVENTS_OFFSET = 40;
const TARGETS_OFFSET = 46;
const SOURCE_OFFSET = 52;
const ASSET_OFFSET = 58;
const SOURCE_SHA_OFFSET = 64;
const BODY_SHA_OFFSET = 96;
const F1WB_BYTES = 62_404;
const F1RA_BYTES = 62_072;

export const RENDER_V2_MQUICKJS_PACKAGE_ABI = Object.freeze({
  magic: MAGIC,
  version: VERSION,
  headerBytes: RENDER_V2_MQUICKJS_LIMITS.headerBytes,
  byteOrder: "little-endian",
  sectionDirectory: "four-u24-offset-u24-length-records",
  sectionDirectoryOffsets: Object.freeze([EVENTS_OFFSET, TARGETS_OFFSET, SOURCE_OFFSET, ASSET_OFFSET]),
  sourceSha256Offset: SOURCE_SHA_OFFSET,
  bodySha256Offset: BODY_SHA_OFFSET,
  eventRecordBytes: RENDER_V2_MQUICKJS_LIMITS.eventRecordBytes,
  targetRecordBytes: RENDER_V2_MQUICKJS_LIMITS.targetRecordBytes,
  eventKinds: RENDER_V2_MQUICKJS_EVENT_KINDS,
  targetWrites: RENDER_V2_MQUICKJS_TARGET_WRITES,
  source: "canonical-utf8-plus-one-nul-no-bytecode",
  strictSourcePrefix: RENDER_V2_MQUICKJS_SOURCE_PREFIX,
  asset: "optional-canonical-62404-byte-one-frame-f1wb",
});
export const RENDER_V2_MQUICKJS_PACKAGE_ABI_SHA256 = sha256(
  Buffer.from(JSON.stringify(RENDER_V2_MQUICKJS_PACKAGE_ABI), "utf8"),
).toString("hex");

export const RENDER_V2_MQUICKJS_PROFILE = Object.freeze({
  id: RENDER_V2_MQUICKJS_PROFILE_ID,
  packageFormat: RENDER_V2_MQUICKJS_PACKAGE_FORMAT,
  packageAbiSha256: RENDER_V2_MQUICKJS_PACKAGE_ABI_SHA256,
  engine: "MicroQuickJS",
  engineCommit: RENDER_V2_MQUICKJS_ENGINE_COMMIT,
  abiVersion: 1,
  javascriptProfile: "mquickjs-es5-strict-v1",
  deviceEvaluatesJavaScript: true,
  deviceRunsJsdom: false,
  sourceTransport: "utf8-source-not-bytecode",
  maxPackageBytes: RENDER_V2_MQUICKJS_LIMITS.packageBytes,
  maxSourceBytes: RENDER_V2_MQUICKJS_LIMITS.sourceBytes,
  heapBytes: RENDER_V2_MQUICKJS_LIMITS.heapBytes,
  callbackDeadlineUs: RENDER_V2_MQUICKJS_LIMITS.callbackDeadlineUs,
  maxHandlers: RENDER_V2_MQUICKJS_LIMITS.handlers,
  maxTargets: RENDER_V2_MQUICKJS_LIMITS.targets,
  maxKeys: RENDER_V2_MQUICKJS_LIMITS.keys,
  maxChords: RENDER_V2_MQUICKJS_LIMITS.chords,
  events: Object.freeze([
    "tick.1ms", "tick.100ms", "tick.1s", "input.fn-bottom-knob", "host.rpc:<1..65535>",
    "input.key.down", "input.key.up", "input.key.hold",
    "input.chord.down", "input.chord.up",
  ]),
  input: Object.freeze({
    physicalIdentity: "declared-opaque-u32-native-token",
    heldState: "authoritative-u16-bitmap",
    overflowRecovery: "held-bitmap-resync-and-synthetic-edges",
  }),
  publication: "atomic-16-int-mailbox-revision",
  hardwareRuntimeProven: false,
});

function invariant(condition, message, code = null) {
  if (condition) return;
  const error = new Error(message);
  if (code) error.code = code;
  throw error;
}

function sha256(value) {
  return createHash("sha256").update(value).digest();
}

function uint(value, maximum, label) {
  invariant(Number.isInteger(value) && value >= 0 && value <= maximum,
    `${label} must be an integer in 0..${maximum}.`);
  return value;
}

function uint32(value, label) {
  return uint(value, 0xffffffff, label);
}

function copyBytes(value, label) {
  invariant(value instanceof Uint8Array, `${label} must be bytes.`);
  return Buffer.from(value);
}

function writeU24LE(buffer, offset, value) {
  uint(value, 0xffffff, "F2JS section value");
  buffer[offset] = value & 0xff;
  buffer[offset + 1] = (value >>> 8) & 0xff;
  buffer[offset + 2] = (value >>> 16) & 0xff;
}

function readU24LE(buffer, offset) {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
}

function align4(value) {
  return (value + 3) & ~3;
}

function bitCount16(value) {
  let count = 0;
  for (let bits = value & 0xffff; bits !== 0; bits >>>= 1) count += bits & 1;
  return count;
}

function normalizeEvents(events = {}) {
  invariant(events && typeof events === "object" && !Array.isArray(events),
    "F2JS events must be an object.");
  const records = [];
  const singleton = ["tick.100ms", "tick.1s", "input.fn-bottom-knob"];
  for (const name of singleton) if (events[name] === true) {
    records.push(Object.freeze({ kind: RENDER_V2_MQUICKJS_EVENT_KINDS[name], id: 0,
      nativeToken: 0, heldMask: 0 }));
  }

  const hostIds = [...(events.hostRpcIds ?? [])].map((value) => uint(value, 0xffff,
    "F2JS host RPC ID"));
  invariant(new Set(hostIds).size === hostIds.length && hostIds.every((id) => id !== 0),
    "F2JS host RPC IDs must be unique nonzero uint16 values.");
  hostIds.sort((a, b) => a - b);
  for (const id of hostIds) records.push(Object.freeze({
    kind: RENDER_V2_MQUICKJS_EVENT_KINDS["host.rpc"], id, nativeToken: 0, heldMask: 0,
  }));

  const keys = [...(events.keys ?? [])];
  invariant(keys.length <= RENDER_V2_MQUICKJS_LIMITS.keys,
    `F2JS admits at most ${RENDER_V2_MQUICKJS_LIMITS.keys} keys.`);
  const tokens = new Set();
  keys.forEach((entry, index) => {
    invariant(entry && typeof entry === "object", `F2JS key ${index} must be an object.`);
    const id = uint(entry.id ?? index, RENDER_V2_MQUICKJS_LIMITS.keys - 1,
      `F2JS key ${index} ID`);
    invariant(id === index, "F2JS key IDs must be contiguous and ordered from zero.");
    const nativeToken = uint32(entry.nativeToken, `F2JS key ${index} native token`);
    invariant(!tokens.has(nativeToken), "F2JS native key tokens must be unique.");
    tokens.add(nativeToken);
    records.push(Object.freeze({ kind: RENDER_V2_MQUICKJS_EVENT_KINDS.key, id,
      nativeToken, heldMask: 0 }));
  });

  const admittedMask = keys.length === 16 ? 0xffff : (1 << keys.length) - 1;
  const chords = [...(events.chords ?? [])];
  invariant(chords.length <= RENDER_V2_MQUICKJS_LIMITS.chords,
    `F2JS admits at most ${RENDER_V2_MQUICKJS_LIMITS.chords} chords.`);
  const chordMasks = new Set();
  chords.forEach((entry, index) => {
    invariant(entry && typeof entry === "object", `F2JS chord ${index} must be an object.`);
    const id = uint(entry.id ?? index, RENDER_V2_MQUICKJS_LIMITS.chords - 1,
      `F2JS chord ${index} ID`);
    invariant(id === index, "F2JS chord IDs must be contiguous and ordered from zero.");
    const heldMask = uint(entry.heldMask, 0xffff, `F2JS chord ${index} held mask`);
    const count = bitCount16(heldMask);
    invariant((heldMask & ~admittedMask) === 0 && count >= 2 &&
      count <= RENDER_V2_MQUICKJS_LIMITS.chordKeys,
    `F2JS chord ${index} must contain two to four admitted keys.`);
    invariant(!chordMasks.has(heldMask), "F2JS exact chord masks must be unique.");
    chordMasks.add(heldMask);
    records.push(Object.freeze({ kind: RENDER_V2_MQUICKJS_EVENT_KINDS.chord, id,
      nativeToken: 0, heldMask }));
  });
  // Kind 7 is deliberately appended after key/chord declarations so the
  // event section remains sorted by kind, as required by both decoders.
  if (events["tick.1ms"] === true) {
    records.push(Object.freeze({ kind: RENDER_V2_MQUICKJS_EVENT_KINDS["tick.1ms"],
      id: 0, nativeToken: 0, heldMask: 0 }));
  }
  invariant(records.length <= RENDER_V2_MQUICKJS_LIMITS.eventRecords,
    `F2JS admits at most ${RENDER_V2_MQUICKJS_LIMITS.eventRecords} event records.`);
  return Object.freeze({ records: Object.freeze(records), keyCount: keys.length,
    chordCount: chords.length });
}

function encodeEvents(value) {
  const binary = Buffer.alloc(value.records.length * RENDER_V2_MQUICKJS_LIMITS.eventRecordBytes);
  value.records.forEach((record, index) => {
    const offset = index * RENDER_V2_MQUICKJS_LIMITS.eventRecordBytes;
    binary[offset] = record.kind;
    binary.writeUInt16LE(record.id, offset + 2);
    binary.writeUInt32LE(record.nativeToken, offset + 4);
    binary.writeUInt16LE(record.heldMask, offset + 8);
  });
  return binary;
}

function normalizeTargets(targets = []) {
  invariant(Array.isArray(targets) && targets.length <= RENDER_V2_MQUICKJS_LIMITS.targets,
    `F2JS admits at most ${RENDER_V2_MQUICKJS_LIMITS.targets} DOM targets.`);
  const ids = new Set();
  return Object.freeze(targets.map((entry, index) => {
    invariant(entry && typeof entry === "object", `F2JS target ${index} must be an object.`);
    const id = String(entry.id ?? "");
    invariant(/^[A-Za-z][A-Za-z0-9_-]{0,15}$/u.test(id) && !ids.has(id),
      "F2JS target IDs must be unique 1..16 byte ASCII DOM IDs.");
    ids.add(id);
    const writes = [...(entry.writes ?? [])];
    invariant(writes.length > 0 && writes.every((name) =>
      Object.hasOwn(RENDER_V2_MQUICKJS_TARGET_WRITES, name)),
    `F2JS target ${id} has an unsupported writable property.`);
    let flags = 0;
    for (const name of new Set(writes)) flags |= RENDER_V2_MQUICKJS_TARGET_WRITES[name];
    return Object.freeze({ index, id, flags });
  }));
}

function encodeTargets(targets) {
  const binary = Buffer.alloc(targets.length * RENDER_V2_MQUICKJS_LIMITS.targetRecordBytes);
  targets.forEach((target, index) => {
    const offset = index * RENDER_V2_MQUICKJS_LIMITS.targetRecordBytes;
    const id = Buffer.from(target.id, "ascii");
    binary.writeUInt16LE(target.index, offset);
    binary.writeUInt16LE(target.flags, offset + 2);
    binary[offset + 4] = id.length;
    id.copy(binary, offset + 8);
  });
  return binary;
}

function validateRasterBase(value, generation) {
  if (value == null) return Buffer.alloc(0);
  const binary = copyBytes(value?.binary ?? value, "F2JS raster base");
  invariant(binary.length === F1WB_BYTES && binary.subarray(0, 4).equals(F1WB_MAGIC_BYTES) &&
    binary.readUInt32LE(12) === F1WB_BYTES,
  "F2JS raster base must be the exact canonical 62,404-byte one-slot F1WB.");
  const bundle = decodeWidgetBundle(binary);
  const nameLength = binary[22];
  const nameBytes = binary.subarray(104, 104 + nameLength);
  let name = null;
  try { name = new TextDecoder("utf-8", { fatal: true }).decode(nameBytes); } catch {}
  invariant(name != null && Buffer.from(name, "utf8").equals(nameBytes) &&
    binary.subarray(104 + nameLength, 120).every((byte) => byte === 0),
  "F2JS raster base slot name or descriptor padding is noncanonical.");
  invariant(bundle.generation === generation && bundle.activeSlot === 0 && bundle.slots.length === 1 &&
    bundle.slots[0].kind === "raster" && bundle.slots[0].animationBinary.length === F1RA_BYTES,
  "F2JS raster base must match the package generation and contain one active F1RA.");
  const animation = decodeRasterAnimation(bundle.slots[0].animationBinary);
  invariant(animation.width === 100 && animation.height === 310 && animation.frames.length === 1 &&
    animation.frames[0].length === 31_000,
  "F2JS raster base must contain exactly one full 100x310 RGB565 frame.");
  return binary;
}

function sourceBytes(value) {
  invariant(typeof value === "string" && !value.includes("\0"),
    "F2JS source must be a NUL-free JavaScript string.");
  const canonical = value.startsWith(RENDER_V2_MQUICKJS_SOURCE_PREFIX) ? value :
    `${RENDER_V2_MQUICKJS_SOURCE_PREFIX}${value}`;
  const binary = Buffer.from(canonical, "utf8");
  invariant(binary.length > 0 && binary.length <= RENDER_V2_MQUICKJS_LIMITS.sourceBytes,
    `F2JS source must be 1..${RENDER_V2_MQUICKJS_LIMITS.sourceBytes} UTF-8 bytes.`);
  invariant(new TextDecoder("utf-8", { fatal: true }).decode(binary) === canonical,
    "F2JS source must be canonical UTF-8.");
  return binary;
}

function inputTiming(input = {}, keyCount) {
  if (keyCount === 0) return Object.freeze({ debounceMs: 0, holdDelayMs: 0, holdCadenceMs: 0 });
  const debounceMs = uint(input.debounceMs ?? 10, 50, "F2JS debounce milliseconds");
  const holdDelayMs = uint(input.holdDelayMs ?? 500, 5_000, "F2JS hold delay milliseconds");
  const holdCadenceMs = uint(input.holdCadenceMs ?? 100, 1_000, "F2JS hold cadence milliseconds");
  invariant(debounceMs >= 1 && holdDelayMs >= 100 && holdCadenceMs >= 20,
    "F2JS input timing is below its bounded minimum.");
  return Object.freeze({ debounceMs, holdDelayMs, holdCadenceMs });
}

export function buildRenderV2MQuickJsPackage({ source, generation = 1, events = {},
  targets = [], rasterBase = null, input = {} } = {}) {
  uint32(generation, "F2JS generation");
  invariant(generation !== 0, "F2JS generation zero is reserved.");
  const sourceBinary = sourceBytes(source);
  const normalizedEvents = normalizeEvents(events);
  const normalizedTargets = normalizeTargets(targets);
  const timing = inputTiming(input, normalizedEvents.keyCount);
  const eventBinary = encodeEvents(normalizedEvents);
  const targetBinary = encodeTargets(normalizedTargets);
  const rasterBinary = validateRasterBase(rasterBase, generation);
  const sourceSection = Buffer.concat([sourceBinary, Buffer.from([0])]);
  const eventsAt = RENDER_V2_MQUICKJS_LIMITS.headerBytes;
  const targetsAt = eventsAt + eventBinary.length;
  const sourceAt = targetsAt + targetBinary.length;
  const assetAt = align4(sourceAt + sourceSection.length);
  const totalBytes = assetAt + rasterBinary.length;
  invariant(totalBytes <= RENDER_V2_MQUICKJS_LIMITS.packageBytes,
    `F2JS package is ${totalBytes} bytes; cap is ${RENDER_V2_MQUICKJS_LIMITS.packageBytes}.`,
  "RENDER_V2_MQUICKJS_PACKAGE_OVERSIZE");
  const binary = Buffer.alloc(totalBytes);
  binary.write(MAGIC, 0, "ascii");
  binary.writeUInt16LE(VERSION, 4);
  binary.writeUInt16LE(RENDER_V2_MQUICKJS_LIMITS.headerBytes, 6);
  binary.writeUInt32LE(totalBytes, 8);
  binary.writeUInt32LE(generation, 12);
  binary.writeUInt32LE(rasterBinary.length === 0 ? 0 : FLAG_RASTER_BASE, 16);
  binary.writeUInt32LE(RENDER_V2_MQUICKJS_LIMITS.heapBytes, 20);
  binary.writeUInt32LE(RENDER_V2_MQUICKJS_LIMITS.callbackDeadlineUs, 24);
  binary[28] = normalizedEvents.records.length;
  binary[29] = normalizedTargets.length;
  binary[30] = normalizedEvents.keyCount;
  binary[31] = normalizedEvents.chordCount;
  binary.writeUInt16LE(timing.debounceMs, 32);
  binary.writeUInt16LE(timing.holdDelayMs, 34);
  binary.writeUInt16LE(timing.holdCadenceMs, 36);
  binary.writeUInt16LE(SECTION_COUNT, 38);
  for (const [offset, start, length] of [
    [EVENTS_OFFSET, eventsAt, eventBinary.length],
    [TARGETS_OFFSET, targetsAt, targetBinary.length],
    [SOURCE_OFFSET, sourceAt, sourceSection.length],
    [ASSET_OFFSET, assetAt, rasterBinary.length],
  ]) {
    writeU24LE(binary, offset, start);
    writeU24LE(binary, offset + 3, length);
  }
  sha256(sourceBinary).copy(binary, SOURCE_SHA_OFFSET);
  eventBinary.copy(binary, eventsAt);
  targetBinary.copy(binary, targetsAt);
  sourceSection.copy(binary, sourceAt);
  rasterBinary.copy(binary, assetAt);
  sha256(binary.subarray(RENDER_V2_MQUICKJS_LIMITS.headerBytes)).copy(binary, BODY_SHA_OFFSET);
  return decodeRenderV2MQuickJsPackage(binary);
}

function decodeEventRecords(binary, keyCount, chordCount) {
  invariant(binary.length % RENDER_V2_MQUICKJS_LIMITS.eventRecordBytes === 0,
    "F2JS event section length is invalid.");
  const records = [];
  const singleton = new Set();
  const hostIds = new Set();
  const tokens = new Set();
  const chordMasks = new Set();
  let foundKeys = 0;
  let foundChords = 0;
  let lastKind = 0;
  let lastHostId = 0;
  for (let offset = 0; offset < binary.length;
    offset += RENDER_V2_MQUICKJS_LIMITS.eventRecordBytes) {
    invariant(binary[offset + 1] === 0 && binary.readUInt16LE(offset + 10) === 0 &&
      binary.readUInt32LE(offset + 12) === 0,
    "F2JS event record reserved fields must be zero.");
    const record = Object.freeze({ kind: binary[offset], id: binary.readUInt16LE(offset + 2),
      nativeToken: binary.readUInt32LE(offset + 4), heldMask: binary.readUInt16LE(offset + 8) });
    invariant(Object.values(RENDER_V2_MQUICKJS_EVENT_KINDS).includes(record.kind),
      "F2JS event record kind is unsupported.");
    invariant(record.kind >= lastKind, "F2JS event records must use canonical kind order.");
    lastKind = record.kind;
    if (record.kind <= RENDER_V2_MQUICKJS_EVENT_KINDS["input.fn-bottom-knob"] ||
        record.kind === RENDER_V2_MQUICKJS_EVENT_KINDS["tick.1ms"]) {
      invariant(record.id === 0 && record.nativeToken === 0 && record.heldMask === 0 &&
        !singleton.has(record.kind), "F2JS built-in event record is noncanonical.");
      singleton.add(record.kind);
    } else if (record.kind === RENDER_V2_MQUICKJS_EVENT_KINDS["host.rpc"]) {
      invariant(record.id !== 0 && record.nativeToken === 0 && record.heldMask === 0 &&
        record.id > lastHostId && !hostIds.has(record.id),
      "F2JS host RPC declaration is noncanonical.");
      hostIds.add(record.id);
      lastHostId = record.id;
    } else if (record.kind === RENDER_V2_MQUICKJS_EVENT_KINDS.key) {
      invariant(record.id === foundKeys && record.id < keyCount && record.heldMask === 0 &&
        !tokens.has(record.nativeToken), "F2JS key declaration is noncanonical.");
      tokens.add(record.nativeToken);
      foundKeys++;
    } else {
      const admittedMask = keyCount === 16 ? 0xffff : (1 << keyCount) - 1;
      const count = bitCount16(record.heldMask);
      invariant(record.id === foundChords && record.id < chordCount && record.nativeToken === 0 &&
        (record.heldMask & ~admittedMask) === 0 && count >= 2 && count <= 4 &&
        !chordMasks.has(record.heldMask), "F2JS chord declaration is noncanonical.");
      chordMasks.add(record.heldMask);
      foundChords++;
    }
    records.push(record);
  }
  invariant(foundKeys === keyCount && foundChords === chordCount,
    "F2JS key/chord record counts differ from the header.");
  return Object.freeze(records);
}

function decodeTargetRecords(binary, targetCount) {
  invariant(binary.length === targetCount * RENDER_V2_MQUICKJS_LIMITS.targetRecordBytes,
    "F2JS target section length differs from the header count.");
  const ids = new Set();
  return Object.freeze(Array.from({ length: targetCount }, (_, index) => {
    const offset = index * RENDER_V2_MQUICKJS_LIMITS.targetRecordBytes;
    const idIndex = binary.readUInt16LE(offset);
    const flags = binary.readUInt16LE(offset + 2);
    const length = binary[offset + 4];
    invariant(idIndex === index && length >= 1 && length <= 16 &&
      (flags & ~7) === 0 && flags !== 0 &&
      binary.subarray(offset + 5, offset + 8).every((byte) => byte === 0) &&
      binary.subarray(offset + 8 + length, offset + 32).every((byte) => byte === 0),
    "F2JS target record is noncanonical.");
    const idBytes = binary.subarray(offset + 8, offset + 8 + length);
    invariant(idBytes.every((byte) => byte <= 0x7f),
      "F2JS target ID contains a non-ASCII byte.");
    const id = idBytes.toString("ascii");
    invariant(/^[A-Za-z][A-Za-z0-9_-]{0,15}$/u.test(id) && !ids.has(id),
      "F2JS target ID is invalid or duplicated.");
    ids.add(id);
    return Object.freeze({ index, id, flags,
      writes: Object.freeze(Object.entries(RENDER_V2_MQUICKJS_TARGET_WRITES)
        .filter(([, bit]) => (flags & bit) !== 0).map(([name]) => name)) });
  }));
}

export function decodeRenderV2MQuickJsPackage(value) {
  const binary = copyBytes(value?.binary ?? value, "F2JS package");
  invariant(binary.length >= RENDER_V2_MQUICKJS_LIMITS.headerBytes &&
    binary.length <= RENDER_V2_MQUICKJS_LIMITS.packageBytes &&
    binary.subarray(0, 4).equals(MAGIC_BYTES) &&
    binary.readUInt16LE(4) === VERSION &&
    binary.readUInt16LE(6) === RENDER_V2_MQUICKJS_LIMITS.headerBytes &&
    binary.readUInt32LE(8) === binary.length,
  "F2JS header, version, or total length is invalid.");
  const generation = binary.readUInt32LE(12);
  const flags = binary.readUInt32LE(16);
  const eventCount = binary[28];
  const targetCount = binary[29];
  const keyCount = binary[30];
  const chordCount = binary[31];
  invariant(generation !== 0 && (flags & ~FLAG_RASTER_BASE) === 0 &&
    binary.readUInt32LE(20) === RENDER_V2_MQUICKJS_LIMITS.heapBytes &&
    binary.readUInt32LE(24) === RENDER_V2_MQUICKJS_LIMITS.callbackDeadlineUs &&
    eventCount <= RENDER_V2_MQUICKJS_LIMITS.eventRecords &&
    targetCount <= RENDER_V2_MQUICKJS_LIMITS.targets &&
    keyCount <= RENDER_V2_MQUICKJS_LIMITS.keys && chordCount <= RENDER_V2_MQUICKJS_LIMITS.chords &&
    binary.readUInt16LE(38) === SECTION_COUNT,
  "F2JS fixed resource contract is invalid.");
  const sections = [EVENTS_OFFSET, TARGETS_OFFSET, SOURCE_OFFSET, ASSET_OFFSET].map((offset) =>
    Object.freeze({ offset: readU24LE(binary, offset), bytes: readU24LE(binary, offset + 3) }));
  const expectedEventsBytes = eventCount * RENDER_V2_MQUICKJS_LIMITS.eventRecordBytes;
  const expectedTargetsBytes = targetCount * RENDER_V2_MQUICKJS_LIMITS.targetRecordBytes;
  invariant(sections[0].offset === RENDER_V2_MQUICKJS_LIMITS.headerBytes &&
    sections[0].bytes === expectedEventsBytes &&
    sections[1].offset === sections[0].offset + sections[0].bytes &&
    sections[1].bytes === expectedTargetsBytes &&
    sections[2].offset === sections[1].offset + sections[1].bytes &&
    sections[2].bytes >= 2 && sections[2].bytes <= RENDER_V2_MQUICKJS_LIMITS.sourceBytes + 1 &&
    sections[3].offset === align4(sections[2].offset + sections[2].bytes) &&
    sections[3].offset + sections[3].bytes === binary.length &&
    binary.subarray(sections[2].offset + sections[2].bytes, sections[3].offset)
      .every((byte) => byte === 0),
  "F2JS section directory is noncanonical or out of bounds.");
  invariant(((flags & FLAG_RASTER_BASE) !== 0) === (sections[3].bytes !== 0),
    "F2JS raster-base flag and asset section disagree.");
  const sourceSection = binary.subarray(sections[2].offset,
    sections[2].offset + sections[2].bytes);
  invariant(sourceSection.at(-1) === 0 && !sourceSection.subarray(0, -1).includes(0),
    "F2JS source must have one trailing NUL and no embedded NUL.");
  const sourceBinary = sourceSection.subarray(0, -1);
  invariant(sha256(sourceBinary).equals(binary.subarray(SOURCE_SHA_OFFSET, BODY_SHA_OFFSET)) &&
    sha256(binary.subarray(RENDER_V2_MQUICKJS_LIMITS.headerBytes))
      .equals(binary.subarray(BODY_SHA_OFFSET, RENDER_V2_MQUICKJS_LIMITS.headerBytes)),
  "F2JS source or body SHA-256 does not match the admitted bytes.");
  const source = new TextDecoder("utf-8", { fatal: true }).decode(sourceBinary);
  invariant(Buffer.from(source, "utf8").equals(sourceBinary) &&
    source.startsWith(RENDER_V2_MQUICKJS_SOURCE_PREFIX),
  "F2JS source is not canonical strict UTF-8.");
  const timing = Object.freeze({ debounceMs: binary.readUInt16LE(32),
    holdDelayMs: binary.readUInt16LE(34), holdCadenceMs: binary.readUInt16LE(36) });
  invariant(keyCount === 0 ? Object.values(timing).every((value) => value === 0) :
    timing.debounceMs >= 1 && timing.debounceMs <= 50 && timing.holdDelayMs >= 100 &&
      timing.holdDelayMs <= 5_000 && timing.holdCadenceMs >= 20 && timing.holdCadenceMs <= 1_000,
  "F2JS input timing is invalid for the declared key count.");
  const events = decodeEventRecords(binary.subarray(sections[0].offset,
    sections[0].offset + sections[0].bytes), keyCount, chordCount);
  const targets = decodeTargetRecords(binary.subarray(sections[1].offset,
    sections[1].offset + sections[1].bytes), targetCount);
  const rasterBase = sections[3].bytes === 0 ? null : validateRasterBase(
    binary.subarray(sections[3].offset, sections[3].offset + sections[3].bytes), generation);
  const digest = sha256(binary).toString("hex");
  return Object.freeze({ format: RENDER_V2_MQUICKJS_PACKAGE_FORMAT, version: VERSION,
    generation, sha256: digest, bytes: binary.length, source, sourceSha256: sha256(sourceBinary).toString("hex"),
    bodySha256: sha256(binary.subarray(RENDER_V2_MQUICKJS_LIMITS.headerBytes)).toString("hex"),
    events, targets, input: Object.freeze({ keyCount, chordCount, ...timing }),
    execution: Object.freeze({ engine: "MicroQuickJS", engineCommit: RENDER_V2_MQUICKJS_ENGINE_COMMIT,
      javascriptProfile: "mquickjs-es5-strict-v1", deviceEvaluatesJavaScript: true,
      deviceRunsJsdom: false, sourceTransport: "utf8-source-not-bytecode" }),
    budget: Object.freeze({ packageBytes: binary.length,
      packageHeadroomBytes: RENDER_V2_MQUICKJS_LIMITS.packageBytes - binary.length,
      sourceBytes: sourceBinary.length, events: eventCount, targets: targetCount,
      keys: keyCount, chords: chordCount, rasterBaseBytes: sections[3].bytes }),
    get binary() { return Buffer.from(binary); },
    get rasterBase() { return rasterBase == null ? null : Buffer.from(rasterBase); },
  });
}

export function assessRenderV2MQuickJsCapability(value) {
  const expected = RENDER_V2_MQUICKJS_PROFILE;
  const errors = [];
  const same = (field, expectedValue) => {
    if (value?.[field] !== expectedValue) errors.push(`${field} must equal ${JSON.stringify(expectedValue)}.`);
  };
  same("renderV2Profile", expected.id);
  same("packageFormat", expected.packageFormat);
  same("packageAbiSha256", expected.packageAbiSha256);
  same("engineCommit", expected.engineCommit);
  same("javascriptProfile", expected.javascriptProfile);
  same("deviceEvaluatesJavaScript", true);
  same("deviceRunsJsdom", false);
  same("maxPackageBytes", String(expected.maxPackageBytes));
  same("maxSourceBytes", String(expected.maxSourceBytes));
  same("heapBytes", String(expected.heapBytes));
  same("callbackDeadlineUs", String(expected.callbackDeadlineUs));
  same("maxHandlers", String(expected.maxHandlers));
  same("maxTargets", String(expected.maxTargets));
  same("maxKeys", String(expected.maxKeys));
  same("maxChords", String(expected.maxChords));
  return Object.freeze({ compatible: errors.length === 0, profileId: expected.id,
    errors: Object.freeze(errors) });
}
