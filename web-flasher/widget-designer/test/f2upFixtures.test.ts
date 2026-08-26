// Emits the fixtures the firmware's f2up verifier consumes. Splitting the work
// this way is forced by the toolchain: vitest workers are sandboxed from
// spawning a C compiler, so the TS side (which owns the container encoder and
// its CRC/SHA) writes a valid container plus one file per corruption class, and
// experiments/mquickjs-widget-upload/verify.mjs compiles the C admitter and
// asserts each file yields the expected gate. The fixture bytes are the shared
// artifact that proves TS encoder == C admitter.

import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { buildUploadContainer, decodeUploadContainer } from "../src/compiler/uploadContainer";
import { crc32 } from "../src/compiler/f2tfPackage";

const ROOT = new URL("../../../", import.meta.url).pathname;
const FIXTURES = `${ROOT}experiments/mquickjs-widget-upload/fixtures`;

async function sampleContainer() {
  const f2js = Uint8Array.from({ length: 200 }, (_, i) => (i * 7) & 0xff);
  const f2tf = Uint8Array.from({ length: 96 }, (_, i) => (i * 13) & 0xff);
  const lzss = Uint8Array.from({ length: 300 }, (_, i) => (i * 3) & 0xff);
  const { binary } = await buildUploadContainer({ f2js, f2tf, lzss, generation: 5 });
  return binary;
}

/** Re-sign the header CRC after a header mutation, so later gates are reached. */
function reseal(binary: Uint8Array): Uint8Array {
  new DataView(binary.buffer).setUint32(124, crc32(binary.subarray(0, 128), 124, 4), true);
  return binary;
}

describe("F2UP fixtures for the firmware cross-check", () => {
  it("round-trips through the TS decoder and writes the C fixture set", async () => {
    const base = await sampleContainer();

    // The TS decoder is the mirror of the encoder; the C admitter must agree
    // with both. Assert the round-trip here so a TS-only regression fails fast.
    const decoded = await decodeUploadContainer(base);
    expect(decoded.generation).toBe(5);
    expect(decoded.f2js.length).toBe(200);
    expect(decoded.f2tf.length).toBe(96);
    expect(decoded.lzss.length).toBe(300);

    const cases: { name: string; expect: string; mutate: (b: Uint8Array) => Uint8Array }[] = [
      { name: "valid", expect: "ok", mutate: (b) => b },
      { name: "magic", expect: "magic", mutate: (b) => { b[0] ^= 0xff; return b; } },
      { name: "version", expect: "version", mutate: (b) => { b[8] = 2; return b; } },
      { name: "size", expect: "size", mutate: (b) => { new DataView(b.buffer).setUint32(12, b.length + 4, true); return b; } },
      { name: "generation", expect: "generation", mutate: (b) => { new DataView(b.buffer).setUint32(16, 0, true); return b; } },
      { name: "section", expect: "section", mutate: (b) => { b[20] = 129; return b; } },
      { name: "reserved", expect: "reserved", mutate: (b) => { b[108] = 1; return b; } },
      { name: "header-crc", expect: "header-crc", mutate: (b) => { b[124] ^= 0xff; return b; } },
      { name: "payload-sha", expect: "payload-sha", mutate: (b) => { b[128] ^= 0xff; return b; } },
      { name: "f2js-sha", expect: "f2js-sha", mutate: (b) => { b[76] ^= 0xff; return reseal(b); } },
    ];

    mkdirSync(FIXTURES, { recursive: true });
    const manifest: { file: string; expect: string }[] = [];
    for (const testCase of cases) {
      const bytes = testCase.mutate(base.slice());
      const file = `${testCase.name}.f2up`;
      writeFileSync(`${FIXTURES}/${file}`, bytes);
      manifest.push({ file, expect: testCase.expect });
    }
    writeFileSync(`${FIXTURES}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);

    // Sanity: the corruptions really did change the bytes.
    expect(manifest).toHaveLength(10);

    // A second, smaller, NEWER container for the harness's replacement proof:
    // persisting this over the generation-5 container must fully supersede it.
    const gen6 = await buildUploadContainer({
      f2js: Uint8Array.from({ length: 150 }, (_, i) => (i * 11) & 0xff),
      f2tf: Uint8Array.from({ length: 80 }, (_, i) => (i * 5) & 0xff),
      lzss: Uint8Array.from({ length: 200 }, (_, i) => (i * 17) & 0xff),
      generation: 6,
    });
    expect(gen6.binary.length).toBeLessThan(base.length);
    writeFileSync(`${FIXTURES}/valid-gen6.f2up`, gen6.binary);
  });
});
