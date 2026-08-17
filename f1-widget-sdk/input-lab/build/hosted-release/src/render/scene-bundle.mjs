import { createHash } from "node:crypto";
import { decodeGlyphAtlas } from "./glyph-atlas.mjs";

const MAGIC = Buffer.from("F1SB", "ascii");
const VERSION = 1;
const SLOT_CAPACITY = 3;
const HEADER_BYTES = 20;
const DESCRIPTOR_BYTES = 100;
const PAYLOAD_OFFSET = HEADER_BYTES + SLOT_CAPACITY * DESCRIPTOR_BYTES;

function invariant(value, message) {
  if (!value) throw new Error(message);
}

function digest(value) {
  return createHash("sha256").update(value).digest();
}

function align4(value) {
  return (value + 3) & ~3;
}

function normalizePayload(value, label) {
  invariant(value instanceof Uint8Array, `${label} must be a Uint8Array.`);
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

/** Encode up to three independently valid scene+atlas generations. */
export function encodeSceneBundle({ slots, activeSlot = 0, generation = 1 }) {
  invariant(Array.isArray(slots) && slots.length > 0 && slots.length <= SLOT_CAPACITY,
    "A scene bundle requires 1..3 slots.");
  invariant(Number.isInteger(generation) && generation >= 0 && generation <= 0xffffffff,
    "Bundle generation must be a uint32.");
  const normalized = Array.from({ length: SLOT_CAPACITY }, (_, index) => {
    const slot = slots[index];
    if (!slot) return null;
    const name = String(slot.name ?? `scene-${index + 1}`);
    const nameBytes = Buffer.from(name, "utf8");
    invariant(nameBytes.length > 0 && nameBytes.length <= 16, `Slot ${index} name must be 1..16 UTF-8 bytes.`);
    const scene = normalizePayload(slot.sceneBinary ?? slot.binary, `Slot ${index} scene`);
    const atlas = normalizePayload(slot.atlasBinary ?? slot.atlas?.binary, `Slot ${index} atlas`);
    invariant(scene.length > 0 && atlas.length > 0, `Slot ${index} payloads cannot be empty.`);
    invariant(decodeGlyphAtlas(atlas).testOnly !== true || slot.allowTestAtlas === true,
      `Slot ${index} uses a synthetic test atlas; set allowTestAtlas only in tests/labs.`);
    return { name, nameBytes, scene, atlas };
  });
  const present = normalized.filter(Boolean).length;
  invariant(present === slots.length, "Scene bundle slots must be contiguous from slot zero.");
  invariant(Number.isInteger(activeSlot) && activeSlot >= 0 && activeSlot < SLOT_CAPACITY && normalized[activeSlot],
    "Active slot must identify a populated scene.");
  let cursor = PAYLOAD_OFFSET;
  const records = normalized.map((slot) => {
    if (!slot) return null;
    const sceneOffset = cursor;
    cursor = align4(cursor + slot.scene.length);
    const atlasOffset = cursor;
    cursor = align4(cursor + slot.atlas.length);
    return { ...slot, sceneOffset, atlasOffset };
  });
  const output = Buffer.alloc(cursor);
  MAGIC.copy(output, 0);
  output[4] = VERSION;
  output[5] = SLOT_CAPACITY;
  output[6] = present;
  output[7] = activeSlot;
  output.writeUInt32LE(generation, 8);
  output.writeUInt32LE(output.length, 12);
  output.writeUInt16LE(DESCRIPTOR_BYTES, 16);
  output.writeUInt16LE(PAYLOAD_OFFSET, 18);
  records.forEach((record, index) => {
    if (!record) return;
    const base = HEADER_BYTES + index * DESCRIPTOR_BYTES;
    output[base] = 1;
    output[base + 1] = record.nameBytes.length;
    output.writeUInt16LE(0, base + 2);
    output.writeUInt32LE(record.sceneOffset, base + 4);
    output.writeUInt32LE(record.scene.length, base + 8);
    output.writeUInt32LE(record.atlasOffset, base + 12);
    output.writeUInt32LE(record.atlas.length, base + 16);
    digest(record.scene).copy(output, base + 20);
    digest(record.atlas).copy(output, base + 52);
    record.nameBytes.copy(output, base + 84);
    record.scene.copy(output, record.sceneOffset);
    record.atlas.copy(output, record.atlasOffset);
  });
  return { format: "framer-scene-bundle-v1", slots: records, activeSlot, generation, binary: output,
    sha256: digest(output).toString("hex") };
}

export function decodeSceneBundle(value) {
  const binary = normalizePayload(value, "Scene bundle");
  invariant(binary.length >= PAYLOAD_OFFSET && binary.subarray(0, 4).equals(MAGIC),
    "Scene bundle is truncated or has invalid magic.");
  invariant(binary[4] === VERSION && binary[5] === SLOT_CAPACITY, "Unsupported scene bundle version/capacity.");
  const slotCount = binary[6];
  const activeSlot = binary[7];
  const generation = binary.readUInt32LE(8);
  invariant(slotCount >= 1 && slotCount <= SLOT_CAPACITY && binary.readUInt32LE(12) === binary.length &&
    binary.readUInt16LE(16) === DESCRIPTOR_BYTES && binary.readUInt16LE(18) === PAYLOAD_OFFSET,
  "Scene bundle header is invalid.");
  const slots = [];
  for (let index = 0; index < SLOT_CAPACITY; index += 1) {
    const base = HEADER_BYTES + index * DESCRIPTOR_BYTES;
    const present = binary[base];
    if (!present) continue;
    invariant(index === slots.length, "Scene bundle slots are not contiguous.");
    const nameLength = binary[base + 1];
    invariant(nameLength > 0 && nameLength <= 16 && binary.readUInt16LE(base + 2) === 0,
      `Slot ${index} descriptor is invalid.`);
    const sceneOffset = binary.readUInt32LE(base + 4);
    const sceneLength = binary.readUInt32LE(base + 8);
    const atlasOffset = binary.readUInt32LE(base + 12);
    const atlasLength = binary.readUInt32LE(base + 16);
    invariant(sceneLength > 0 && atlasLength > 0 && sceneOffset >= PAYLOAD_OFFSET && atlasOffset >= PAYLOAD_OFFSET &&
      sceneOffset + sceneLength <= binary.length && atlasOffset + atlasLength <= binary.length,
    `Slot ${index} payload range is invalid.`);
    const sceneBinary = Buffer.from(binary.subarray(sceneOffset, sceneOffset + sceneLength));
    const atlasBinary = Buffer.from(binary.subarray(atlasOffset, atlasOffset + atlasLength));
    invariant(digest(sceneBinary).equals(binary.subarray(base + 20, base + 52)), `Slot ${index} scene SHA-256 failed.`);
    invariant(digest(atlasBinary).equals(binary.subarray(base + 52, base + 84)), `Slot ${index} atlas SHA-256 failed.`);
    const name = binary.subarray(base + 84, base + 84 + nameLength).toString("utf8");
    slots.push({ index, name, sceneBinary, atlasBinary, sceneSha256: digest(sceneBinary).toString("hex"),
      atlasSha256: digest(atlasBinary).toString("hex") });
  }
  invariant(slots.length === slotCount && slots.some(({ index }) => index === activeSlot),
    "Scene bundle slot count or active slot is invalid.");
  return { format: "framer-scene-bundle-v1", slots, activeSlot, generation, binary: Buffer.from(binary),
    sha256: digest(binary).toString("hex") };
}

export const SCENE_SLOT_CAPACITY = SLOT_CAPACITY;
