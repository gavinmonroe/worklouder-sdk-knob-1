// The whole render-v2 package is content-addressed by SHA-256, and the device
// rejects a package whose declared digest does not match. A subtly wrong hash
// would produce packages that build cleanly and are refused on the wire, so
// this is checked against published FIPS 180-4 vectors AND against the
// platform's own implementation on payloads the size we actually ship.

import { describe, expect, it } from "vitest";
import { createHash } from "../src/compat/node-crypto";

const hex = (bytes: Uint8Array) =>
  [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

async function subtleSha256(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", copy)));
}

describe("node:crypto browser shim", () => {
  it("matches the published vectors", () => {
    expect(createHash("sha256").update("").digest("hex"))
      .toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(createHash("sha256").update("abc").digest("hex"))
      .toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(
      createHash("sha256")
        .update("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")
        .digest("hex"),
    ).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  });

  it("hashes across a block boundary correctly", async () => {
    // 55/56/64 bytes are the padding edge cases that naive implementations miss.
    for (const length of [54, 55, 56, 57, 63, 64, 65, 119, 120]) {
      const bytes = new Uint8Array(length).map((_, i) => (i * 7) & 0xff);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(await subtleSha256(bytes));
    }
  });

  it("agrees with Web Crypto on a full-size package payload", async () => {
    const bytes = new Uint8Array(62_404).map((_, i) => (i * 31) & 0xff);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(await subtleSha256(bytes));
  });

  it("concatenates chunked updates like the streaming API", async () => {
    const a = new Uint8Array([1, 2, 3, 4, 5]);
    const b = new Uint8Array([6, 7, 8]);
    const joined = new Uint8Array([...a, ...b]);
    expect(createHash("sha256").update(a).update(b).digest("hex")).toBe(await subtleSha256(joined));
  });

  it("returns raw bytes when no encoding is given", () => {
    const digest = createHash("sha256").update("abc").digest();
    expect(digest).toBeInstanceOf(Uint8Array);
    expect(hex(digest as Uint8Array))
      .toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("refuses algorithms it does not actually implement", () => {
    expect(() => createHash("sha512")).toThrow(/only implements sha256/);
  });
});
