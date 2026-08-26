// The SDK's encoders write every package field through Buffer. A shim that is
// subtly wrong (an off-by-one subarray, a copy that ignores targetStart, a
// signed/unsigned mix-up) yields packages that build cleanly and are refused by
// the device. These check the exact surface the SDK uses.

import { describe, expect, it } from "vitest";
import { BufferShim as Buffer } from "../src/compat/buffer";

describe("Buffer browser shim", () => {
  it("round-trips the integer widths the encoders use", () => {
    const b = Buffer.alloc(16);
    b.writeUInt16LE(0xbeef, 0);
    b.writeUInt32LE(0xdeadbeef, 2);
    b.writeInt32LE(-12345, 6);
    b.writeUInt8(0x7f, 10);
    expect(b.readUInt16LE(0)).toBe(0xbeef);
    expect(b.readUInt32LE(2)).toBe(0xdeadbeef);
    expect(b.readInt32LE(6)).toBe(-12345);
    expect(b.readUInt8(10)).toBe(0x7f);
  });

  it("writes little-endian byte order", () => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(0x01020304, 0);
    expect([...b]).toEqual([0x04, 0x03, 0x02, 0x01]);
  });

  it("keeps subarray as a live view, like Node", () => {
    const b = Buffer.alloc(8);
    const tail = b.subarray(4);
    tail.writeUInt16LE(0x1234, 0);
    // A copy instead of a view would leave the parent untouched.
    expect(b.readUInt16LE(4)).toBe(0x1234);
    expect(tail.readUInt16LE(0)).toBe(0x1234);
  });

  it("reads offsets relative to the subarray, not the parent", () => {
    const b = Buffer.from([0, 0, 0, 0, 9, 0, 0, 0]);
    expect(b.subarray(4).readUInt8(0)).toBe(9);
  });

  it("honours copy(target, targetStart, sourceStart, sourceEnd)", () => {
    const source = Buffer.from([1, 2, 3, 4, 5]);
    const target = Buffer.alloc(6);
    const written = source.copy(target, 2, 1, 4);
    expect(written).toBe(3);
    expect([...target]).toEqual([0, 0, 2, 3, 4, 0]);
  });

  it("concatenates and respects an explicit total length", () => {
    const joined = Buffer.concat([Buffer.from([1, 2]), Buffer.from([3, 4])]);
    expect([...joined]).toEqual([1, 2, 3, 4]);
    expect([...Buffer.concat([Buffer.from([1, 2]), Buffer.from([3, 4])], 3)]).toEqual([1, 2, 3]);
  });

  it("compares contents with equals", () => {
    expect(Buffer.from([1, 2, 3]).equals(Buffer.from([1, 2, 3]))).toBe(true);
    expect(Buffer.from([1, 2, 3]).equals(Buffer.from([1, 2, 4]))).toBe(false);
    expect(Buffer.from([1, 2]).equals(Buffer.from([1, 2, 3]))).toBe(false);
  });

  it("converts to and from the encodings the SDK uses", () => {
    expect(Buffer.from("F1WB").toString("ascii")).toBe("F1WB");
    expect(Buffer.from([0xde, 0xad]).toString("hex")).toBe("dead");
    expect([...Buffer.from("dead", "hex")]).toEqual([0xde, 0xad]);
    expect(Buffer.byteLength("F1WB")).toBe(4);
  });

  it("reports buffer identity the way the SDK checks it", () => {
    expect(Buffer.isBuffer(Buffer.alloc(1))).toBe(true);
    expect(Buffer.isBuffer(new Uint8Array(1))).toBe(false);
    expect(Buffer.isView(new Uint8Array(1))).toBe(true);
  });

  it("writes ascii magic the way the encoders do", () => {
    const b = Buffer.alloc(8);
    expect(b.write("F1WB", 0, 4, "ascii")).toBe(4);
    expect(b.toString("ascii", 0, 4)).toBe("F1WB");
  });

  it("accepts write(string, offset, encoding), the overload the SDK uses", () => {
    // binary.write("F2EP", 0, "ascii") — treating "ascii" as a length wrote
    // nothing and silently dropped the package magic.
    const b = Buffer.alloc(8);
    expect(b.write("F2EP", 0, "ascii")).toBe(4);
    expect(b.toString("ascii", 0, 4)).toBe("F2EP");
  });

  it("slice shares memory, matching Node rather than Array.slice", () => {
    const b = Buffer.alloc(4);
    b.slice(2).writeUInt16LE(0xabcd, 0);
    expect(b.readUInt16LE(2)).toBe(0xabcd);
  });

  it("finds byte and string needles with indexOf", () => {
    const b = Buffer.from("xxF1WB");
    expect(b.indexOf("F1WB")).toBe(2);
    expect(b.indexOf(0x42)).toBe(5); // 'B' in "xxF1WB"
    expect(b.indexOf("nope")).toBe(-1);
  });

  it("refuses an encoding it does not implement rather than guessing", () => {
    expect(() => Buffer.alloc(2).toString("ucs2")).toThrow(/does not implement/);
  });
});
