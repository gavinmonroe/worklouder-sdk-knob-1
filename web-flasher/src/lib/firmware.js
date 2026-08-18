// Every address this app is ever allowed to write. All three live inside the
// existing `factory` partition (0x10000..0x810000); the bootloader, partition
// table, NVS, filesystem, and coredump regions are unreachable by design.
export const APP_REGION_ADDRESS = 0x10000;
export const MODULE_TEXT_PAGE_ADDRESS = 0x210000;
export const MODULE_RODATA_PAGE_ADDRESS = 0x230000;
export const ALLOWED_REGION_ADDRESSES = Object.freeze([
  APP_REGION_ADDRESS,
  MODULE_TEXT_PAGE_ADDRESS,
  MODULE_RODATA_PAGE_ADDRESS,
]);
export const REGION_KINDS = Object.freeze(["page", "app"]);

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

export function formatRegionAddress(address) {
  return `0x${address.toString(16)}`;
}

/**
 * A multi-region catalog entry must describe an ordered, non-overlapping write
 * plan inside the approved address set, with exactly one app image written last.
 */
export function assertRegionPlan(regions) {
  if (!Array.isArray(regions) || regions.length === 0) {
    throw new Error("A multi-region catalog entry must declare at least one flash region.");
  }
  if (regions.filter((region) => region.kind === "app").length !== 1) {
    throw new Error("A multi-region catalog entry must declare exactly one app region.");
  }
  if (regions[regions.length - 1].kind !== "app") {
    throw new Error("A multi-region catalog entry must write its app region last.");
  }

  const seen = new Set();
  for (const region of regions) {
    if (!REGION_KINDS.includes(region.kind)) {
      throw new Error(`Region kind "${region.kind}" is not supported.`);
    }
    if (!ALLOWED_REGION_ADDRESSES.includes(region.address)) {
      throw new Error(
        `Region address ${formatRegionAddress(region.address)} is outside the approved write scope.`,
      );
    }
    if (region.kind === "app" && region.address !== APP_REGION_ADDRESS) {
      throw new Error("The app region must be written at 0x10000.");
    }
    if (region.kind === "page" && region.address === APP_REGION_ADDRESS) {
      throw new Error("A module page may not be written at the app address 0x10000.");
    }
    if (seen.has(region.address)) {
      throw new Error(`Region address ${formatRegionAddress(region.address)} is declared twice.`);
    }
    seen.add(region.address);
    if (!Number.isInteger(region.bytes) || region.bytes <= 0) {
      throw new Error(`Region ${formatRegionAddress(region.address)} must pin a positive byte count.`);
    }
    if (typeof region.sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(region.sha256)) {
      throw new Error(`Region ${formatRegionAddress(region.address)} must pin a lowercase SHA-256.`);
    }
    if (typeof region.url !== "string" || region.url.length === 0) {
      throw new Error(`Region ${formatRegionAddress(region.address)} must reference an imported binary.`);
    }
  }

  const ordered = [...regions].sort((left, right) => left.address - right.address);
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    if (previous.address + previous.bytes > ordered[index].address) {
      throw new Error(
        `Region ${formatRegionAddress(previous.address)} overlaps ${formatRegionAddress(ordered[index].address)}.`,
      );
    }
  }
  return regions;
}

export async function validateRegionBytes(bytes, region) {
  const label = `${region.kind === "app" ? "App" : "Module page"} ${formatRegionAddress(region.address)}`;
  if (bytes.length !== region.bytes) {
    throw new Error(`${label} size changed: expected ${region.bytes}, received ${bytes.length} bytes.`);
  }
  const digest = await sha256(bytes);
  if (digest !== region.sha256) {
    throw new Error(`${label} SHA-256 does not match the pinned catalog entry.`);
  }
  const image = region.kind === "app" ? await inspectEsp32S3App(bytes) : null;
  return Object.freeze({ digest, image });
}

/**
 * Load and fully verify every declared region before the caller may write any
 * of them. A single mismatch rejects the whole plan.
 */
export async function loadFirmwareRegions(firmware, fetchImpl = fetch) {
  const plan = assertRegionPlan(firmware.regions);
  const loaded = [];
  for (const region of plan) {
    const response = await fetchImpl(region.url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(
        `Could not load ${firmware.name} region ${formatRegionAddress(region.address)} (${response.status}).`,
      );
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const validation = await validateRegionBytes(bytes, region);
    loaded.push(
      Object.freeze({
        address: region.address,
        kind: region.kind,
        label: region.label ?? null,
        bytes,
        sha256: validation.digest,
        validation,
      }),
    );
  }
  return Object.freeze(loaded);
}

/**
 * One prepared, fully verified write plan for either catalog shape. Entries
 * without `regions` keep the original single-app behaviour.
 */
export async function loadFlashPlan(firmware, fetchImpl = fetch) {
  if (firmware.regions) {
    const regions = await loadFirmwareRegions(firmware, fetchImpl);
    const app = regions.find((region) => region.kind === "app");
    return Object.freeze({ multiRegion: true, regions, bytes: app.bytes, validation: app.validation });
  }
  const { bytes, validation } = await loadFirmware(firmware, fetchImpl);
  return Object.freeze({
    multiRegion: false,
    regions: Object.freeze([
      Object.freeze({
        address: APP_REGION_ADDRESS,
        kind: "app",
        label: null,
        bytes,
        sha256: validation.digest,
        validation,
      }),
    ]),
    bytes,
    validation,
  });
}
