import { createHash } from "node:crypto";

const ESP_IMAGE_MAGIC = 0xe9;
const ESP_CHECKSUM_MAGIC = 0xef;
const HEADER_BYTES = 24;
const DIGEST_BYTES = 32;

function sha256(data) {
  return createHash("sha256").update(data).digest();
}

function checksumSegments(segments) {
  let checksum = ESP_CHECKSUM_MAGIC;
  for (const segment of segments) {
    for (const byte of segment.data) checksum ^= byte;
  }
  return checksum;
}

export function inspectEsp32AppImage(image) {
  if (!Buffer.isBuffer(image) || image.length < HEADER_BYTES) {
    throw new Error("ESP app image is missing or too short.");
  }
  if (image[0] !== ESP_IMAGE_MAGIC) {
    throw new Error(`Invalid ESP image magic 0x${image[0].toString(16)}.`);
  }

  const segmentCount = image[1];
  if (segmentCount === 0 || segmentCount > 16) {
    throw new Error(`Refusing implausible ESP segment count ${segmentCount}.`);
  }

  const segments = [];
  let cursor = HEADER_BYTES;
  for (let index = 0; index < segmentCount; index += 1) {
    if (cursor + 8 > image.length) throw new Error(`Segment ${index} header is truncated.`);
    const headerOffset = cursor;
    const loadAddress = image.readUInt32LE(cursor);
    const length = image.readUInt32LE(cursor + 4);
    cursor += 8;
    if (length === 0 || cursor + length > image.length) {
      throw new Error(`Segment ${index} has an invalid length ${length}.`);
    }
    segments.push({
      index,
      headerOffset,
      dataOffset: cursor,
      loadAddress,
      length,
      data: image.subarray(cursor, cursor + length),
    });
    cursor += length;
  }

  // ESP images place the checksum in the final byte of the next 16-byte block.
  const checksumOffset = cursor + ((15 - (cursor % 16) + 16) % 16);
  if (checksumOffset >= image.length) throw new Error("ESP image checksum is truncated.");
  const dataLength = checksumOffset + 1;
  const digestAppended = image[23] === 1;
  const expectedLength = dataLength + (digestAppended ? DIGEST_BYTES : 0);
  if (image.length !== expectedLength) {
    throw new Error(`Unexpected trailing data: image is ${image.length} bytes; parsed ${expectedLength}.`);
  }

  const calculatedChecksum = checksumSegments(segments);
  const storedChecksum = image[checksumOffset];
  if (storedChecksum !== calculatedChecksum) {
    throw new Error(
      `Invalid ESP checksum: stored 0x${storedChecksum.toString(16)}, calculated 0x${calculatedChecksum.toString(16)}.`,
    );
  }

  let storedDigest;
  let calculatedDigest;
  if (digestAppended) {
    storedDigest = image.subarray(dataLength, dataLength + DIGEST_BYTES);
    calculatedDigest = sha256(image.subarray(0, dataLength));
    if (!storedDigest.equals(calculatedDigest)) throw new Error("Invalid appended ESP SHA-256 digest.");
  }

  return {
    segmentCount,
    segments,
    checksumOffset,
    storedChecksum,
    dataLength,
    digestAppended,
    digestOffset: digestAppended ? dataLength : undefined,
    storedDigest,
  };
}

export function repairEsp32AppIntegrity(image) {
  // Parsing before modification is intentionally not required: the caller may
  // have changed checksummed bytes. Structural bounds are checked independently.
  if (!Buffer.isBuffer(image) || image.length < HEADER_BYTES || image[0] !== ESP_IMAGE_MAGIC) {
    throw new Error("Not an ESP app image.");
  }
  const output = Buffer.from(image);
  const segmentCount = output[1];
  if (segmentCount === 0 || segmentCount > 16) throw new Error("Invalid ESP segment count.");

  const segments = [];
  let cursor = HEADER_BYTES;
  for (let index = 0; index < segmentCount; index += 1) {
    if (cursor + 8 > output.length) throw new Error(`Segment ${index} header is truncated.`);
    const length = output.readUInt32LE(cursor + 4);
    cursor += 8;
    if (length === 0 || cursor + length > output.length) throw new Error(`Segment ${index} is truncated.`);
    segments.push({ data: output.subarray(cursor, cursor + length) });
    cursor += length;
  }

  const checksumOffset = cursor + ((15 - (cursor % 16) + 16) % 16);
  if (checksumOffset >= output.length) throw new Error("ESP image checksum is truncated.");
  output[checksumOffset] = checksumSegments(segments);

  const dataLength = checksumOffset + 1;
  if (output[23] === 1) {
    if (output.length !== dataLength + DIGEST_BYTES) throw new Error("ESP digest is truncated or image has trailing data.");
    sha256(output.subarray(0, dataLength)).copy(output, dataLength);
  } else if (output.length !== dataLength) {
    throw new Error("ESP image has unexpected trailing data.");
  }

  inspectEsp32AppImage(output);
  return output;
}

export function extendEsp32AppSegment(image, { segmentIndex, data }) {
  const original = inspectEsp32AppImage(image);
  if (!Number.isInteger(segmentIndex) || segmentIndex < 0 || segmentIndex >= original.segmentCount) {
    throw new Error("Extended segment index is out of range.");
  }
  if (!Buffer.isBuffer(data) || data.length === 0 || data.length % 4 !== 0) {
    throw new Error("Segment extension must be a non-empty Buffer with a 4-byte-aligned length.");
  }

  const grownLength = original.segments[segmentIndex].length + data.length;
  // ESP-IDF's image loader rejects individual segment lengths at or above
  // 16 MiB even though the on-disk field is uint32.
  if (grownLength >= 0x1000000) throw new Error("Extended segment reaches the ESP-IDF 16 MiB segment limit.");

  const structuralBytes = original.segments.reduce(
    (total, segment, index) => total + 8 + segment.length + (index === segmentIndex ? data.length : 0),
    HEADER_BYTES,
  );
  const checksumOffset = structuralBytes + ((15 - (structuralBytes % 16) + 16) % 16);
  const dataLength = checksumOffset + 1;
  const output = Buffer.alloc(dataLength + (original.digestAppended ? DIGEST_BYTES : 0));
  image.copy(output, 0, 0, HEADER_BYTES);

  let cursor = HEADER_BYTES;
  for (const segment of original.segments) {
    image.copy(output, cursor, segment.headerOffset, segment.headerOffset + 8);
    if (segment.index === segmentIndex) output.writeUInt32LE(grownLength, cursor + 4);
    cursor += 8;
    segment.data.copy(output, cursor);
    cursor += segment.length;
    if (segment.index === segmentIndex) {
      data.copy(output, cursor);
      cursor += data.length;
    }
  }
  if (cursor !== structuralBytes) throw new Error("Extended ESP segment layout is inconsistent.");

  // The placeholder checksum/digest are repaired after the new structure is
  // complete. Buffer.alloc deliberately preserves ESP's zero padding style.
  return repairEsp32AppIntegrity(output);
}
