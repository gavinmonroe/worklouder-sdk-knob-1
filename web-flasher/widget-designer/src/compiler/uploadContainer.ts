// ─────────────────────────────────────────────────────────────────────────────
// F2UP v1 upload container — the single chunked-upload payload that carries a
// widget's three cross-pinned artifacts (F2JS, F2TF, LZSS base frame) to the
// device. Layout frozen in docs/16-mquickjs-widget-pipeline.md:
//
//   +0    8   magic "F2WIDGT1"
//   +8    4   version = 1
//   +12   4   totalBytes (entire container, <= 98304)
//   +16   4   generation (uint32 >= 1)
//   +20   4   f2jsOffset      +24  4  f2jsBytes
//   +28   4   f2tfOffset      +32  4  f2tfBytes
//   +36   4   lzssOffset      +40  4  lzssBytes
//   +44   32  sha256(payload bytes 128..totalBytes)
//   +76   32  sha256(f2js section) — device cross-checks against the F2TF pin
//   +108  16  reserved, zero
//   +124  4   crc32(header bytes 0..128 with this field zeroed)
//   +128  payload; sections 4-byte aligned, in order f2js, f2tf, lzss
//
// All integers little-endian. The decoder here is deliberately as strict as
// the device commit path will be — a container the Designer would not accept
// back must never leave the Designer. It does NOT decompress the LZSS section
// (bounds only): decompression is the device's admission problem, and
// src/compiler/lzss.ts covers the codec itself.
// ─────────────────────────────────────────────────────────────────────────────

import { crc32 } from "./f2tfPackage";

export const F2UP_MAGIC = "F2WIDGT1";
export const F2UP_VERSION = 1;
export const F2UP_HEADER_BYTES = 128;
/** Same ceiling as MQUICKJS_LIMITS.packageBytes — the device staging budget. */
export const F2UP_MAX_BYTES = 98_304;

const CRC_OFFSET = 124;

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const align4 = (value: number) => (value + 3) & ~3;

const hex = (bytes: Uint8Array) =>
  [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

async function sha256Bytes(bytes: Uint8Array): Promise<Uint8Array> {
  // Copy first: subtle.digest reads the WHOLE backing buffer of a view unless
  // handed a tight one, and sections are subarrays of the container.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", copy));
}

export interface F2upBuildOptions {
  f2js: Uint8Array;
  f2tf: Uint8Array;
  /** Compressed base frame; opaque bytes here, bounds-checked only. */
  lzss: Uint8Array;
  generation: number;
}

export interface F2upContainer {
  binary: Uint8Array;
  /** Hex sha256 of the entire container, for upload/commit logging. */
  sha256: string;
  bytes: number;
}

export interface F2upDecoded {
  generation: number;
  f2js: Uint8Array;
  f2tf: Uint8Array;
  lzss: Uint8Array;
  /** Verified hex sha256 of the payload (bytes 128..totalBytes). */
  payloadSha256: string;
  /** Verified hex sha256 of the f2js section. */
  f2jsSha256: string;
}

export async function buildUploadContainer(options: F2upBuildOptions): Promise<F2upContainer> {
  const { f2js, f2tf, lzss, generation } = options;
  invariant(f2js instanceof Uint8Array && f2js.length >= 1, "F2UP f2jsBytes must be at least 1.");
  invariant(f2tf instanceof Uint8Array && f2tf.length >= 1, "F2UP f2tfBytes must be at least 1.");
  invariant(lzss instanceof Uint8Array && lzss.length >= 1, "F2UP lzssBytes must be at least 1.");
  invariant(Number.isInteger(generation) && generation >= 1 && generation <= 0xffffffff,
    "F2UP generation must be an integer 1..4294967295.");

  const f2jsOffset = F2UP_HEADER_BYTES;
  const f2tfOffset = align4(f2jsOffset + f2js.length);
  const lzssOffset = align4(f2tfOffset + f2tf.length);
  const totalBytes = lzssOffset + lzss.length;
  invariant(totalBytes <= F2UP_MAX_BYTES,
    `F2UP totalBytes ${totalBytes} exceeds the ${F2UP_MAX_BYTES}-byte upload limit.`);

  const binary = new Uint8Array(totalBytes); // alignment padding stays zero
  const view = new DataView(binary.buffer);
  for (let index = 0; index < F2UP_MAGIC.length; index += 1) {
    binary[index] = F2UP_MAGIC.charCodeAt(index);
  }
  view.setUint32(8, F2UP_VERSION, true);
  view.setUint32(12, totalBytes, true);
  view.setUint32(16, generation, true);
  view.setUint32(20, f2jsOffset, true);
  view.setUint32(24, f2js.length, true);
  view.setUint32(28, f2tfOffset, true);
  view.setUint32(32, f2tf.length, true);
  view.setUint32(36, lzssOffset, true);
  view.setUint32(40, lzss.length, true);

  binary.set(f2js, f2jsOffset);
  binary.set(f2tf, f2tfOffset);
  binary.set(lzss, lzssOffset);

  binary.set(await sha256Bytes(binary.subarray(F2UP_HEADER_BYTES)), 44);
  binary.set(await sha256Bytes(f2js), 76);
  // Reserved bytes 108..124 stay zero.
  view.setUint32(CRC_OFFSET,
    crc32(binary.subarray(0, F2UP_HEADER_BYTES), CRC_OFFSET, 4), true);

  return { binary, sha256: hex(await sha256Bytes(binary)), bytes: totalBytes };
}

/**
 * Strict inverse of buildUploadContainer. Async because the sha256 checks go
 * through Web Crypto; every rejection names the header field it blames.
 * Checks run header-outward: structure, then the crc that authenticates the
 * header, then the fields it vouches for, then the payload hashes.
 */
export async function decodeUploadContainer(binary: Uint8Array): Promise<F2upDecoded> {
  invariant(binary instanceof Uint8Array, "F2UP container must be a Uint8Array.");
  invariant(binary.length >= F2UP_HEADER_BYTES,
    `F2UP container is truncated: ${binary.length} bytes cannot hold the ${F2UP_HEADER_BYTES}-byte header.`);
  for (let index = 0; index < F2UP_MAGIC.length; index += 1) {
    invariant(binary[index] === F2UP_MAGIC.charCodeAt(index),
      `F2UP magic mismatch: expected "${F2UP_MAGIC}".`);
  }
  const view = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
  const version = view.getUint32(8, true);
  invariant(version === F2UP_VERSION, `F2UP version must be ${F2UP_VERSION}; got ${version}.`);
  const totalBytes = view.getUint32(12, true);
  invariant(totalBytes <= F2UP_MAX_BYTES,
    `F2UP totalBytes ${totalBytes} exceeds the ${F2UP_MAX_BYTES}-byte upload limit.`);
  invariant(totalBytes === binary.length,
    `F2UP totalBytes ${totalBytes} does not match the ${binary.length}-byte container (truncated or padded).`);
  invariant(view.getUint32(CRC_OFFSET, true) ===
    crc32(binary.subarray(0, F2UP_HEADER_BYTES), CRC_OFFSET, 4),
  "F2UP header crc32 mismatch.");

  const generation = view.getUint32(16, true);
  invariant(generation >= 1, "F2UP generation must be >= 1.");

  // Sections must sit exactly at the aligned end of their predecessor: for a
  // 4-aligned offset, "in order with only alignment padding between" has one
  // canonical layout, so equality checks double as overlap and bounds checks.
  const section = (name: string, offset: number, bytes: number, expectedOffset: number) => {
    invariant(offset % 4 === 0, `F2UP ${name}Offset ${offset} must be 4-byte aligned.`);
    invariant(offset === expectedOffset,
      `F2UP ${name}Offset ${offset} must be ${expectedOffset}, the aligned end of the previous section.`);
    invariant(bytes >= 1, `F2UP ${name}Bytes must be at least 1.`);
    invariant(offset + bytes <= totalBytes,
      `F2UP ${name}Bytes ${bytes} escapes the ${totalBytes}-byte container.`);
  };
  const f2jsOffset = view.getUint32(20, true);
  const f2jsBytes = view.getUint32(24, true);
  const f2tfOffset = view.getUint32(28, true);
  const f2tfBytes = view.getUint32(32, true);
  const lzssOffset = view.getUint32(36, true);
  const lzssBytes = view.getUint32(40, true);
  section("f2js", f2jsOffset, f2jsBytes, F2UP_HEADER_BYTES);
  section("f2tf", f2tfOffset, f2tfBytes, align4(f2jsOffset + f2jsBytes));
  section("lzss", lzssOffset, lzssBytes, align4(f2tfOffset + f2tfBytes));
  invariant(lzssOffset + lzssBytes === totalBytes,
    `F2UP totalBytes ${totalBytes} must equal the end of the lzss section (${lzssOffset + lzssBytes}).`);
  for (let index = 108; index < CRC_OFFSET; index += 1) {
    invariant(binary[index] === 0, "F2UP reserved bytes must be zero.");
  }

  const payloadSha256 = hex(await sha256Bytes(binary.subarray(F2UP_HEADER_BYTES)));
  invariant(payloadSha256 === hex(binary.subarray(44, 76)), "F2UP payload sha256 mismatch.");
  // slice() copies: handing callers views into the shared container buffer
  // would let one artifact's consumer silently corrupt another's bytes.
  const f2js = binary.slice(f2jsOffset, f2jsOffset + f2jsBytes);
  const f2jsSha256 = hex(await sha256Bytes(f2js));
  invariant(f2jsSha256 === hex(binary.subarray(76, 108)), "F2UP f2jsSha256 mismatch.");

  return {
    generation,
    f2js,
    f2tf: binary.slice(f2tfOffset, f2tfOffset + f2tfBytes),
    lzss: binary.slice(lzssOffset, lzssOffset + lzssBytes),
    payloadSha256,
    f2jsSha256,
  };
}
