const ESP_IMAGE_MAGIC = 0xe9;
const ESP_CHECKSUM_MAGIC = 0xef;
const ESP32_S3_IMAGE_CHIP_ID = 9;
const HEADER_BYTES = 24;
const DIGEST_BYTES = 32;
const EXPECTED_SEGMENTS = 6;

function hex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function readUint16LE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32LE(bytes, offset) {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

export async function sha256(bytes) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}

export async function inspectEsp32S3App(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < HEADER_BYTES) {
    throw new Error("Firmware is missing or too short to be an ESP application image.");
  }
  if (bytes[0] !== ESP_IMAGE_MAGIC) throw new Error("Firmware has invalid ESP image magic.");
  if (bytes[1] !== EXPECTED_SEGMENTS) {
    throw new Error(`Firmware must retain the reviewed six-segment layout; found ${bytes[1]}.`);
  }
  if (readUint16LE(bytes, 12) !== ESP32_S3_IMAGE_CHIP_ID) {
    throw new Error("Firmware is not marked for ESP32-S3.");
  }

  let cursor = HEADER_BYTES;
  let checksum = ESP_CHECKSUM_MAGIC;
  for (let index = 0; index < bytes[1]; index += 1) {
    if (cursor + 8 > bytes.length) throw new Error(`Firmware segment ${index} header is truncated.`);
    const length = readUint32LE(bytes, cursor + 4);
    cursor += 8;
    if (length === 0 || cursor + length > bytes.length) {
      throw new Error(`Firmware segment ${index} has an invalid length.`);
    }
    for (let offset = cursor; offset < cursor + length; offset += 1) checksum ^= bytes[offset];
    cursor += length;
  }

  const checksumOffset = cursor + ((15 - (cursor % 16) + 16) % 16);
  if (checksumOffset >= bytes.length || bytes[checksumOffset] !== checksum) {
    throw new Error("Firmware ESP checksum is invalid.");
  }

  const dataLength = checksumOffset + 1;
  const digestAppended = bytes[23] === 1;
  const expectedLength = dataLength + (digestAppended ? DIGEST_BYTES : 0);
  if (!digestAppended || bytes.length !== expectedLength) {
    throw new Error("Firmware is missing its exact appended digest or contains trailing data.");
  }
  const calculatedDigest = await sha256(bytes.slice(0, dataLength));
  const storedDigest = hex(bytes.slice(dataLength));
  if (calculatedDigest !== storedDigest) throw new Error("Firmware appended SHA-256 digest is invalid.");

  return Object.freeze({ segmentCount: bytes[1], checksumOffset, digestAppended });
}

export async function validateFirmwareBytes(bytes, firmware) {
  if (bytes.length !== firmware.bytes) {
    throw new Error(`Firmware size changed: expected ${firmware.bytes}, received ${bytes.length} bytes.`);
  }
  const digest = await sha256(bytes);
  if (digest !== firmware.sha256) throw new Error("Firmware SHA-256 does not match the pinned catalog entry.");
  const image = await inspectEsp32S3App(bytes);
  return Object.freeze({ digest, image });
}

export async function loadFirmware(firmware, fetchImpl = fetch) {
  const response = await fetchImpl(firmware.url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load ${firmware.name} (${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const validation = await validateFirmwareBytes(bytes, firmware);
  return Object.freeze({ bytes, validation });
}
