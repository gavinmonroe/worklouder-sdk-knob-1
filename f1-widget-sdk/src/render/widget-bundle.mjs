import { createHash } from "node:crypto";
import { decodeGlyphAtlas } from "./glyph-atlas.mjs";

const MAGIC = Buffer.from("F1WB", "ascii");
const VERSION = 1;
const CAPACITY = 3;
const HEADER_BYTES = 20;
const DESCRIPTOR_BYTES = 104;
const PAYLOAD_OFFSET = HEADER_BYTES + CAPACITY * DESCRIPTOR_BYTES;
const KINDS = Object.freeze({ semantic: 1, raster: 2 });
const KIND_NAMES = Object.freeze([null, "semantic", "raster"]);

function invariant(value, message) { if (!value) throw new Error(message); }
function digest(value) { return createHash("sha256").update(value).digest(); }
function align4(value) { return (value + 3) & ~3; }
function payload(value, label) {
  invariant(value instanceof Uint8Array, `${label} must be a Uint8Array.`);
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

/** Three-slot heterogeneous bundle: semantic F1SC+F1GA and/or raster F1RA. */
export function encodeWidgetBundle({ slots, activeSlot = 0, generation = 1 }) {
  invariant(Array.isArray(slots) && slots.length >= 1 && slots.length <= CAPACITY,
    "Widget bundle requires 1..3 contiguous slots.");
  invariant(Number.isInteger(activeSlot) && activeSlot >= 0 && activeSlot < slots.length,
    "Widget bundle activeSlot is not populated.");
  invariant(Number.isInteger(generation) && generation >= 0 && generation <= 0xffffffff,
    "Widget bundle generation must be a uint32.");
  const normalized = slots.map((slot, index) => {
    const kindId = KINDS[slot.kind];
    invariant(kindId, `Widget slot ${index} kind must be semantic or raster.`);
    const name = Buffer.from(String(slot.name ?? `slot-${index + 1}`), "utf8");
    invariant(name.length >= 1 && name.length <= 16, `Widget slot ${index} name must be 1..16 UTF-8 bytes.`);
    const primary = payload(slot.kind === "semantic" ? slot.sceneBinary ?? slot.binary :
      slot.animationBinary ?? slot.binary, `Widget slot ${index} primary payload`);
    const auxiliary = slot.kind === "semantic" ? payload(slot.atlasBinary ?? slot.atlas?.binary,
      `Widget slot ${index} atlas`) : Buffer.alloc(0);
    invariant(primary.subarray(0, 4).toString("ascii") === (slot.kind === "semantic" ? "F1SC" : "F1RA"),
      `Widget slot ${index} primary magic does not match ${slot.kind}.`);
    invariant(slot.kind !== "semantic" || auxiliary.subarray(0, 4).toString("ascii") === "F1GA",
      `Widget slot ${index} semantic atlas magic is not F1GA.`);
    invariant(kindId !== KINDS.semantic || decodeGlyphAtlas(auxiliary).testOnly !== true || slot.allowTestAtlas === true,
      `Widget slot ${index} uses a synthetic atlas without allowTestAtlas.`);
    return { kind: slot.kind, kindId, name, primary, auxiliary };
  });
  let cursor = PAYLOAD_OFFSET;
  const records = normalized.map((slot) => {
    const primaryOffset = cursor; cursor = align4(cursor + slot.primary.length);
    const auxiliaryOffset = slot.auxiliary.length ? cursor : 0;
    cursor = align4(cursor + slot.auxiliary.length);
    return { ...slot, primaryOffset, auxiliaryOffset };
  });
  const binary = Buffer.alloc(cursor);
  MAGIC.copy(binary, 0); binary[4] = VERSION; binary[5] = CAPACITY; binary[6] = slots.length; binary[7] = activeSlot;
  binary.writeUInt32LE(generation, 8); binary.writeUInt32LE(binary.length, 12);
  binary.writeUInt16LE(DESCRIPTOR_BYTES, 16); binary.writeUInt16LE(PAYLOAD_OFFSET, 18);
  records.forEach((slot, index) => {
    const base = HEADER_BYTES + index * DESCRIPTOR_BYTES;
    binary[base] = 1; binary[base + 1] = slot.kindId; binary[base + 2] = slot.name.length; binary[base + 3] = 0;
    binary.writeUInt32LE(slot.primaryOffset, base + 4); binary.writeUInt32LE(slot.primary.length, base + 8);
    binary.writeUInt32LE(slot.auxiliaryOffset, base + 12); binary.writeUInt32LE(slot.auxiliary.length, base + 16);
    digest(slot.primary).copy(binary, base + 20); digest(slot.auxiliary).copy(binary, base + 52);
    slot.name.copy(binary, base + 84); slot.primary.copy(binary, slot.primaryOffset);
    if (slot.auxiliary.length) slot.auxiliary.copy(binary, slot.auxiliaryOffset);
  });
  return { format: "framer-widget-bundle-v1", activeSlot, generation, slots: records, binary,
    sha256: digest(binary).toString("hex") };
}

export function decodeWidgetBundle(value) {
  const binary = payload(value, "Widget bundle");
  invariant(binary.length >= PAYLOAD_OFFSET && binary.subarray(0, 4).equals(MAGIC),
    "Widget bundle is truncated or has invalid F1WB magic.");
  invariant(binary[4] === VERSION && binary[5] === CAPACITY && binary.readUInt32LE(12) === binary.length &&
    binary.readUInt16LE(16) === DESCRIPTOR_BYTES && binary.readUInt16LE(18) === PAYLOAD_OFFSET,
  "Widget bundle header is invalid.");
  const count = binary[6]; const activeSlot = binary[7]; const generation = binary.readUInt32LE(8);
  invariant(count >= 1 && count <= CAPACITY && activeSlot < count, "Widget bundle count or active slot is invalid.");
  const slots = [];
  const claimedRanges = [];
  for (let index = 0; index < count; index += 1) {
    const base = HEADER_BYTES + index * DESCRIPTOR_BYTES;
    const kind = KIND_NAMES[binary[base + 1]];
    const nameLength = binary[base + 2];
    invariant(binary[base] === 1 && kind && nameLength >= 1 && nameLength <= 16 && binary[base + 3] === 0,
      `Widget slot ${index} descriptor is invalid.`);
    invariant(binary.subarray(base + 100, base + DESCRIPTOR_BYTES).every((byte) => byte === 0),
      `Widget slot ${index} reserved bytes are nonzero.`);
    const primaryOffset = binary.readUInt32LE(base + 4); const primaryLength = binary.readUInt32LE(base + 8);
    const auxiliaryOffset = binary.readUInt32LE(base + 12); const auxiliaryLength = binary.readUInt32LE(base + 16);
    invariant(primaryLength > 0 && primaryOffset >= PAYLOAD_OFFSET && primaryOffset + primaryLength <= binary.length,
      `Widget slot ${index} primary range is invalid.`);
    invariant(kind === "semantic" ? auxiliaryLength > 0 && auxiliaryOffset >= PAYLOAD_OFFSET &&
      auxiliaryOffset + auxiliaryLength <= binary.length : auxiliaryLength === 0 && auxiliaryOffset === 0,
    `Widget slot ${index} auxiliary range is invalid for ${kind}.`);
    const primary = Buffer.from(binary.subarray(primaryOffset, primaryOffset + primaryLength));
    const auxiliary = auxiliaryLength ? Buffer.from(binary.subarray(auxiliaryOffset, auxiliaryOffset + auxiliaryLength)) : Buffer.alloc(0);
    invariant(digest(primary).equals(binary.subarray(base + 20, base + 52)), `Widget slot ${index} primary SHA failed.`);
    invariant(digest(auxiliary).equals(binary.subarray(base + 52, base + 84)), `Widget slot ${index} auxiliary SHA failed.`);
    invariant(primary.subarray(0, 4).toString("ascii") === (kind === "semantic" ? "F1SC" : "F1RA") &&
      (kind !== "semantic" || auxiliary.subarray(0, 4).toString("ascii") === "F1GA"),
    `Widget slot ${index} payload magic does not match ${kind}.`);
    claimedRanges.push([primaryOffset, primaryOffset + primaryLength]);
    if (auxiliaryLength) claimedRanges.push([auxiliaryOffset, auxiliaryOffset + auxiliaryLength]);
    const common = { index, kind, name: binary.subarray(base + 84, base + 84 + nameLength).toString("utf8") };
    slots.push(kind === "semantic" ? { ...common, sceneBinary: primary, atlasBinary: auxiliary } :
      { ...common, animationBinary: primary });
  }
  for (let index = count; index < CAPACITY; index += 1) {
    const descriptor = binary.subarray(HEADER_BYTES + index * DESCRIPTOR_BYTES,
      HEADER_BYTES + (index + 1) * DESCRIPTOR_BYTES);
    invariant(descriptor.every((byte) => byte === 0), "Widget bundle has a nonzero undeclared slot descriptor.");
  }
  claimedRanges.sort((left, right) => left[0] - right[0]);
  for (let index = 1; index < claimedRanges.length; index += 1) invariant(claimedRanges[index][0] >= claimedRanges[index - 1][1],
    "Widget bundle payload ranges overlap.");
  return { format: "framer-widget-bundle-v1", activeSlot, generation, slots, binary: Buffer.from(binary),
    sha256: digest(binary).toString("hex") };
}

export const WIDGET_BUNDLE_KINDS = Object.freeze(["semantic", "raster"]);
