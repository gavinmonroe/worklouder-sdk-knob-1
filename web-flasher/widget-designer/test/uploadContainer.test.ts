// F2UP v1 container: build must produce exactly the frozen docs/16 layout, and
// decode must be as unforgiving as the device commit path — every corruption
// class is rejected with a message naming the field it blames. Corruptions of
// fields the header crc vouches for re-seal the crc first, so each test hits
// its own validation, not the crc backstop.

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { crc32 } from "../src/compiler/f2tfPackage";
import {
  buildUploadContainer,
  decodeUploadContainer,
  F2UP_HEADER_BYTES,
  F2UP_MAX_BYTES,
} from "../src/compiler/uploadContainer";

const F2JS = Uint8Array.from([0x46, 0x32, 0x4a, 0x53, 0x99]); // 5 bytes -> 3 pad
const F2TF = Uint8Array.from([0x46, 0x32, 0x54, 0x46, 0x01, 0x02]); // 6 -> 2 pad
const LZSS = Uint8Array.from([0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66]); // 7 bytes

const build = () =>
  buildUploadContainer({ f2js: F2JS, f2tf: F2TF, lzss: LZSS, generation: 21 });

/** Re-seal the header crc after deliberately corrupting a covered field. */
function resealHeaderCrc(binary: Uint8Array): Uint8Array {
  const view = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
  view.setUint32(124, crc32(binary.subarray(0, F2UP_HEADER_BYTES), 124, 4), true);
  return binary;
}

describe("F2UP build -> decode round-trip", () => {
  it("recovers every section, the generation, and both verified shas", async () => {
    const built = await build();
    // 128 + (5 -> 8) + (6 -> 8) + 7, with the 4-byte alignment padding.
    expect(built.bytes).toBe(151);
    expect(built.binary.length).toBe(151);
    expect(built.sha256).toBe(createHash("sha256").update(built.binary).digest("hex"));

    const decoded = await decodeUploadContainer(built.binary);
    expect(decoded.generation).toBe(21);
    expect([...decoded.f2js]).toEqual([...F2JS]);
    expect([...decoded.f2tf]).toEqual([...F2TF]);
    expect([...decoded.lzss]).toEqual([...LZSS]);
    expect(decoded.payloadSha256).toBe(
      createHash("sha256").update(built.binary.subarray(F2UP_HEADER_BYTES)).digest("hex"));
    expect(decoded.f2jsSha256).toBe(createHash("sha256").update(F2JS).digest("hex"));
    // Sections are copies, never views into the shared container buffer.
    expect(decoded.f2js.buffer).not.toBe(built.binary.buffer);
  });

  it("lays sections out 4-byte aligned in order f2js, f2tf, lzss", async () => {
    const { binary } = await build();
    const view = new DataView(binary.buffer);
    expect(String.fromCharCode(...binary.subarray(0, 8))).toBe("F2WIDGT1");
    expect(view.getUint32(8, true)).toBe(1); // version
    expect(view.getUint32(12, true)).toBe(binary.length); // totalBytes
    expect(view.getUint32(20, true)).toBe(128); // f2jsOffset
    expect(view.getUint32(24, true)).toBe(5);
    expect(view.getUint32(28, true)).toBe(136); // f2tfOffset = align4(133)
    expect(view.getUint32(32, true)).toBe(6);
    expect(view.getUint32(36, true)).toBe(144); // lzssOffset = align4(142)
    expect(view.getUint32(40, true)).toBe(7);
    // Alignment padding and the reserved header span stay zero.
    expect([...binary.subarray(133, 136)]).toEqual([0, 0, 0]);
    expect([...binary.subarray(142, 144)]).toEqual([0, 0]);
    expect([...binary.subarray(108, 124)]).toEqual(Array(16).fill(0));
  });

  it("build rejects an oversize container and empty sections by name", async () => {
    await expect(buildUploadContainer({
      f2js: F2JS, f2tf: F2TF, lzss: new Uint8Array(F2UP_MAX_BYTES), generation: 1,
    })).rejects.toThrow(/totalBytes/);
    await expect(buildUploadContainer({
      f2js: new Uint8Array(0), f2tf: F2TF, lzss: LZSS, generation: 1,
    })).rejects.toThrow(/f2jsBytes/);
    await expect(buildUploadContainer({
      f2js: F2JS, f2tf: F2TF, lzss: LZSS, generation: 0,
    })).rejects.toThrow(/generation/);
  });
});

describe("F2UP decode rejects every corruption class by name", () => {
  const corrupted = async (mutate: (binary: Uint8Array) => void) => {
    const { binary } = await build();
    const copy = new Uint8Array(binary);
    mutate(copy);
    return copy;
  };

  it("magic", async () => {
    const bad = await corrupted((binary) => { binary[0] ^= 0xff; });
    await expect(decodeUploadContainer(bad)).rejects.toThrow(/magic/);
  });

  it("version", async () => {
    const bad = await corrupted((binary) => {
      new DataView(binary.buffer).setUint32(8, 2, true);
    });
    await expect(decodeUploadContainer(bad)).rejects.toThrow(/version/);
  });

  it("header crc", async () => {
    const bad = await corrupted((binary) => { binary[124] ^= 0xff; });
    await expect(decodeUploadContainer(bad)).rejects.toThrow(/crc32/);
    // Any covered header byte flips the crc verdict too.
    const badGen = await corrupted((binary) => { binary[16] ^= 0x01; });
    await expect(decodeUploadContainer(badGen)).rejects.toThrow(/crc32/);
  });

  it("payload sha", async () => {
    const bad = await corrupted((binary) => { binary[binary.length - 1] ^= 0xff; });
    await expect(decodeUploadContainer(bad)).rejects.toThrow(/payload sha256/);
  });

  it("f2js sha", async () => {
    // Corrupt the pinned sha FIELD (payload untouched, crc re-sealed), so the
    // f2js cross-check itself is what fires.
    const bad = await corrupted((binary) => {
      binary[76] ^= 0xff;
      resealHeaderCrc(binary);
    });
    await expect(decodeUploadContainer(bad)).rejects.toThrow(/f2jsSha256/);
  });

  it("truncation", async () => {
    const { binary } = await build();
    await expect(decodeUploadContainer(binary.slice(0, binary.length - 3)))
      .rejects.toThrow(/totalBytes/);
    await expect(decodeUploadContainer(binary.slice(0, 100)))
      .rejects.toThrow(/truncated/);
  });

  it("misalignment", async () => {
    const bad = await corrupted((binary) => {
      const view = new DataView(binary.buffer);
      view.setUint32(28, view.getUint32(28, true) + 1, true);
      resealHeaderCrc(binary);
    });
    await expect(decodeUploadContainer(bad)).rejects.toThrow(/f2tfOffset.*aligned/);
    // Aligned but out of place is still rejected, naming the offset field.
    const gapped = await corrupted((binary) => {
      const view = new DataView(binary.buffer);
      view.setUint32(36, view.getUint32(36, true) + 4, true);
      resealHeaderCrc(binary);
    });
    await expect(decodeUploadContainer(gapped)).rejects.toThrow(/lzssOffset/);
  });

  it("oversize", async () => {
    const bad = await corrupted((binary) => {
      new DataView(binary.buffer).setUint32(12, F2UP_MAX_BYTES + 4, true);
    });
    await expect(decodeUploadContainer(bad)).rejects.toThrow(/totalBytes.*exceeds/);
  });

  it("generation zero and nonzero reserved bytes", async () => {
    const badGeneration = await corrupted((binary) => {
      new DataView(binary.buffer).setUint32(16, 0, true);
      resealHeaderCrc(binary);
    });
    await expect(decodeUploadContainer(badGeneration)).rejects.toThrow(/generation/);
    const badReserved = await corrupted((binary) => {
      binary[110] = 1;
      resealHeaderCrc(binary);
    });
    await expect(decodeUploadContainer(badReserved)).rejects.toThrow(/reserved/);
  });
});
