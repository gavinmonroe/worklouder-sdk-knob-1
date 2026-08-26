// Formatter 12 (variantRaster) encoding, byte-level, plus the v3 contract sha
// mirror. The wire form under test is the contract's CONTRACT_V3_EXTENSION:
// raster tables ride the LITERAL section as raw contiguous RGB565 LE
// row-major variants (count * rect.w * rect.h * 2 bytes exactly), addressed
// by the record's u16 offset at 36 and a byte length that WIDENS to the u16
// at 38..39; the section layout and header stay the frozen v2 shape (reserved
// bytes 80..96 zero).
//
// The strict-decoder round trip runs when contract.mjs exports the v3
// constant (landed by the parallel contract/C agent); if it were absent a
// placeholder test would document the cross-check as PENDING, and the sha
// mirror is verified by recomputing the canonical from contract.mjs's own
// exports either way.

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  buildF2tfPackage,
  F2TF_FORMATTER,
  F2TF_HEADER_BYTES,
  F2TF_MAX_ASSET_BYTES,
  F2TF_PROPERTY,
  TARGET_FACADE_CONTRACT_V2_SHA256,
  TARGET_FACADE_CONTRACT_V3_SHA256,
  crc32,
  type F2tfTarget,
} from "../src/compiler/f2tfPackage";

const ROOT = new URL("../../../", import.meta.url).pathname;
const contract = await import(`${ROOT}experiments/mquickjs-target-facade/contract.mjs`);
const HAS_V3_CONTRACT = typeof contract.TARGET_FACADE_CONTRACT_V3_SHA256 === "string";

const GLYPHS = { "0": [0x3e, 0x51, 0x49, 0x45, 0x3e], "1": [0x00, 0x42, 0x7f, 0x40, 0x00] };

const ROOT_TARGET: F2tfTarget = {
  id: "root",
  x: 0, y: 0, width: 100, height: 310,
  format: F2TF_FORMATTER.rootVisibility,
  properties: F2TF_PROPERTY.hidden,
  slots: [15],
};

/** Deterministic per-variant pixel fill so every byte is predictable. */
function fillRaster(width: number, height: number, seed: number): Uint16Array {
  const raster = new Uint16Array(width * height);
  for (let index = 0; index < raster.length; index += 1) {
    raster[index] = (seed * 4099 + index * 31) & 0xffff;
  }
  return raster;
}

async function buildMixedSample() {
  // Two raster targets (different rects and counts) and one glyph target, so
  // the raster section holds two back-to-back tables AND coexists with a
  // literal table.
  const rasterA = [fillRaster(11, 4, 1), fillRaster(11, 4, 2), fillRaster(11, 4, 3)];
  const rasterB = [fillRaster(5, 7, 9)];
  const built = await buildF2tfPackage({
    generation: 21,
    baseFrame: new Uint16Array(31_000).fill(0x0861),
    f2jsBinary: Uint8Array.from([9, 9, 9]),
    palette: [0x0000, 0x07e0],
    glyphs: GLYPHS,
    contractSha256: TARGET_FACADE_CONTRACT_V3_SHA256,
    targets: [
      ROOT_TARGET,
      {
        id: "alpha", x: 10, y: 20, width: 11, height: 4,
        format: F2TF_FORMATTER.variantRaster, properties: F2TF_PROPERTY.text,
        slots: [1], rasters: rasterA,
      },
      {
        id: "beta", x: 40, y: 100, width: 5, height: 7,
        format: F2TF_FORMATTER.variantRaster, properties: F2TF_PROPERTY.text,
        slots: [2], rasters: rasterB,
      },
      {
        id: "digit", x: 60, y: 200, width: 12, height: 9,
        format: F2TF_FORMATTER.variantText, properties: F2TF_PROPERTY.text,
        slots: [3], palette0: 1, table: ["0", "1"], maxChars: 1, scale: 1,
      },
    ],
  });
  return { built, rasterA, rasterB };
}

describe("v3 contract sha mirror", () => {
  it("matches the canonical recomputed from contract.mjs's exported fields", () => {
    // Rebuild the canonical JSON exactly the way contract.mjs builds it (same
    // key order, same fields), with version 3, the full formatter map, and
    // the v3 extension (rasterTable encoding + maxAssetBytes). Recomputing v2
    // first proves this local canonicalizer is byte-faithful to the source of
    // truth.
    const canonical = (
      version: number,
      formatters: Record<string, number>,
      extension: Record<string, unknown> = {},
    ) => JSON.stringify({
      format: contract.TARGET_FACADE_FORMAT,
      profile: contract.TARGET_FACADE_PROFILE,
      version,
      canvas: contract.TARGET_FACADE_CANVAS,
      headerBytes: contract.TARGET_FACADE_HEADER_BYTES,
      targetBytes: contract.TARGET_FACADE_TARGET_BYTES,
      targetCount: 16,
      glyph: { recordBytes: contract.TARGET_FACADE_GLYPH_BYTES, width: 5, height: 7, advance: 6 },
      limits: {
        overlayPixelWrites: contract.TARGET_FACADE_MAX_OVERLAY_WRITES,
        textBytes: contract.TARGET_FACADE_MAX_TEXT_BYTES,
      },
      mailbox: { bytes: 72, sequence: "u32-seqlock", slots: "16xi32", generation: "u32" },
      properties: contract.TARGET_FACADE_PROPERTY,
      formatters,
      ...extension,
    });
    const sha = (text: string) => createHash("sha256").update(text).digest("hex");
    // v2 froze BEFORE variantRaster and digitRaster joined the formatter map.
    const { variantRaster: _raster, digitRaster: _digit, ...v2Formatters } = contract.TARGET_FACADE_FORMATTER;
    expect(sha(canonical(2, v2Formatters))).toBe(TARGET_FACADE_CONTRACT_V2_SHA256);
    const v3Formatters = { ...contract.TARGET_FACADE_FORMATTER, variantRaster: 12, digitRaster: 13 };
    const v3Extension = {
      rasterTable: {
        pixelFormat: "rgb565-le", order: "row-major",
        stridePadding: 0, variants: { min: 1, max: 16 },
        record: { offset: "u16le@36", bytes: "u16le@38" },
        bytesRule: "count*rect.width*rect.height*2",
      },
      maxAssetBytes: contract.TARGET_FACADE_MAX_ASSET_BYTES ?? 65_536,
      // v3 scopes its own limits: the raster overlay ceiling is one full
      // frame, and admission enforces the formatter-12/13 write sum against
      // the asset's declared budget.
      limits: {
        overlayPixelWrites: contract.TARGET_FACADE_MAX_OVERLAY_WRITES_V3 ?? 31_000,
        textBytes: contract.TARGET_FACADE_MAX_TEXT_BYTES,
        admitRule: "sum(formatter-12/13 rect areas) <= header.maxOverlayWrites",
      },
      // Digit composition rides the same raster-table wire form with the
      // count fixed at ten and a per-record power-of-ten divisor.
      digitRaster: {
        format: 13, divisor: "u32le@30 power-of-ten 1..1000",
        table: "exactly 10 raster variants", pick: "(max(slot,0)/divisor) % 10",
      },
    };
    expect(sha(canonical(3, v3Formatters, v3Extension))).toBe(TARGET_FACADE_CONTRACT_V3_SHA256);
  });

  it.runIf(HAS_V3_CONTRACT)("matches contract.mjs's own TARGET_FACADE_CONTRACT_V3_SHA256", () => {
    expect(TARGET_FACADE_CONTRACT_V3_SHA256).toBe(contract.TARGET_FACADE_CONTRACT_V3_SHA256);
    expect(F2TF_MAX_ASSET_BYTES).toBe(contract.TARGET_FACADE_MAX_ASSET_BYTES);
  });

  it.runIf(!HAS_V3_CONTRACT)("contract.mjs v3 export is PENDING the parallel contract/C agent", () => {
    // When the contract agent lands TARGET_FACADE_CONTRACT_V3_SHA256, the
    // direct comparison above takes over and this placeholder skips.
    expect(HAS_V3_CONTRACT).toBe(false);
  });
});

describe("variantRaster wire format", () => {
  it("stores raster tables in the literal section with u16 offset/length records", async () => {
    const { built, rasterA, rasterB } = await buildMixedSample();
    const binary = built.binary;
    const view = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);

    const literalsAt = view.getUint32(60, true);
    const literalBytes = view.getUint32(64, true);
    const alphaBytes = rasterA.length * 11 * 4 * 2;
    const betaBytes = rasterB.length * 5 * 7 * 2;
    // The header keeps the frozen v2 shape: the literal section ends the
    // asset, and the reserved bytes stay zero — no new header fields in v3.
    expect(literalsAt + literalBytes).toBe(binary.length);
    expect([...binary.subarray(80, 96)]).toEqual(Array(16).fill(0));
    expect(built.rasterBytes).toBe(alphaBytes + betaBytes);
    expect(built.rasterCosts).toEqual([
      { id: "alpha", variants: 3, width: 11, height: 4, bytes: alphaBytes },
      { id: "beta", variants: 1, width: 5, height: 7, bytes: betaBytes },
    ]);

    // Record fields: format 12, properties text-only, one bound slot, inert
    // text metadata, and the table range as (u16 offset, u16 BYTE length) —
    // the length widens into byte 39, which stays zero for text formats.
    const record = (index: number) => binary.subarray(
      F2TF_HEADER_BYTES + index * 40, F2TF_HEADER_BYTES + (index + 1) * 40);
    const recordView = (index: number) => {
      const bytes = record(index);
      return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    };
    const alpha = record(1);
    expect(alpha[25]).toBe(12);
    expect(alpha[24]).toBe(F2TF_PROPERTY.text);
    expect([...alpha.subarray(26, 30)]).toEqual([1, 0xff, 0xff, 0xff]);
    expect([alpha[30], alpha[31], alpha[32]]).toEqual([0xff, 0xff, 0xff]);
    expect([alpha[33], alpha[34], alpha[35]]).toEqual([0, 0, 0]);
    const alphaOffset = recordView(1).getUint16(36, true);
    expect(recordView(1).getUint16(38, true)).toBe(alphaBytes);

    const beta = record(2);
    expect(beta[25]).toBe(12);
    const betaOffset = recordView(2).getUint16(36, true);
    expect(recordView(2).getUint16(38, true)).toBe(betaBytes);
    // Tables land in target order with no gaps between them.
    expect(alphaOffset).toBe(0);
    expect(betaOffset).toBe(alphaBytes);

    // The glyph target after them still carries a u8-length LITERAL table
    // (with byte 39 zero), placed after the raster blobs.
    const digit = record(3);
    expect(digit[25]).toBe(11);
    expect(digit[39]).toBe(0);
    expect(digit[38]).toBeGreaterThan(0);
    const digitOffset = recordView(3).getUint16(36, true);
    expect(digitOffset).toBe(alphaBytes + betaBytes);
    expect(digitOffset + digit[38]).toBeLessThanOrEqual(literalBytes);

    // Raster tables: contiguous variants, exact bytes, little-endian.
    const expectPixels = (tableOffset: number, variant: number, raster: Uint16Array) => {
      for (let index = 0; index < raster.length; index += 1) {
        const at = literalsAt + tableOffset + variant * raster.length * 2 + index * 2;
        expect(view.getUint16(at, true)).toBe(raster[index]);
      }
    };
    rasterA.forEach((raster, variant) => expectPixels(alphaOffset, variant, raster));
    expectPixels(betaOffset, 0, rasterB[0]);

    // The payload CRC covers the raster bytes: recompute both CRCs.
    expect(view.getUint32(72, true)).toBe(crc32(binary.subarray(F2TF_HEADER_BYTES)));
    expect(view.getUint32(76, true)).toBe(crc32(binary.subarray(0, F2TF_HEADER_BYTES), 76, 4));
  });

  it("keeps a glyph-only asset byte-compatible with the v2 layout", async () => {
    const buildGlyphOnly = (contractSha256: string) => buildF2tfPackage({
      generation: 5,
      baseFrame: new Uint16Array(31_000),
      f2jsBinary: Uint8Array.from([1]),
      palette: [0x0000],
      glyphs: GLYPHS,
      contractSha256,
      targets: [ROOT_TARGET, {
        id: "digit", x: 0, y: 0, width: 10, height: 8,
        format: F2TF_FORMATTER.variantText, properties: F2TF_PROPERTY.text,
        slots: [1], palette0: 0, table: ["0", "1"], maxChars: 1, scale: 1,
      }],
    });
    const v3 = await buildGlyphOnly(TARGET_FACADE_CONTRACT_V3_SHA256);
    const v2 = await buildGlyphOnly(TARGET_FACADE_CONTRACT_V2_SHA256);
    expect(v3.rasterBytes).toBe(0);
    // No rasters → the raster header words stay zero (still v2-reserved form).
    expect([...v3.binary.subarray(80, 96)]).toEqual(Array(16).fill(0));
    // Identical bytes except the contract sha (160..192) and the header crc
    // (76..80) that seals it.
    expect(v3.binary.length).toBe(v2.binary.length);
    for (let index = 0; index < v3.binary.length; index += 1) {
      if ((index >= 160 && index < 192) || (index >= 76 && index < 80)) continue;
      if (v3.binary[index] !== v2.binary[index]) {
        throw new Error(`glyph-only v3 build diverged from v2 at byte ${index}`);
      }
    }
    // And the frozen strict decoder still parses it under the v3 sha.
    const decoded = contract.decodeTargetFacadeAsset(Buffer.from(v3.binary), {
      expectedGeneration: 5,
      expectedF2jsSha256: v3.f2jsSha256,
      expectedContractSha256: TARGET_FACADE_CONTRACT_V3_SHA256,
    });
    expect(decoded.targets[1].format).toBe(11);
  });

  it.runIf(HAS_V3_CONTRACT)("round-trips a raster asset through the strict v3 decoder", async () => {
    const { built, rasterA, rasterB } = await buildMixedSample();
    const decoded = contract.decodeTargetFacadeAsset(Buffer.from(built.binary), {
      expectedGeneration: 21,
      expectedF2jsSha256: built.f2jsSha256,
      expectedContractSha256: contract.TARGET_FACADE_CONTRACT_V3_SHA256,
    });
    const alpha = decoded.targets[1];
    expect(alpha.id).toBe("alpha");
    expect(alpha.format).toBe(12);
    expect(alpha.properties).toBe(1);
    expect(alpha.slots[0]).toBe(1);
    expect(alpha.rasters.length).toBe(3);
    rasterA.forEach((raster: Uint16Array, variant: number) => {
      const bytes = Buffer.alloc(raster.length * 2);
      raster.forEach((pixel, index) => bytes.writeUInt16LE(pixel, index * 2));
      expect(alpha.rasters[variant].equals(bytes)).toBe(true);
    });
    expect(decoded.targets[2].rasters.length).toBe(rasterB.length);
    // Glyph targets keep literal tables, raster targets have none.
    expect(alpha.tables.length).toBe(0);
    expect(decoded.targets[3].format).toBe(11);
    expect(decoded.targets[3].rasters).toBeNull();
  });

  it.runIf(HAS_V3_CONTRACT)("blits the slot-selected variant through the SDK pixel oracle", async () => {
    const { built, rasterA, rasterB } = await buildMixedSample();
    const decoded = contract.decodeTargetFacadeAsset(Buffer.from(built.binary), {
      expectedGeneration: 21,
      expectedF2jsSha256: built.f2jsSha256,
      expectedContractSha256: contract.TARGET_FACADE_CONTRACT_V3_SHA256,
    });
    const baseFrame = new Uint16Array(31_000).fill(0x0861);
    const slots = Array(16).fill(0);
    slots[0] = 1;  // revision
    slots[1] = 7;  // alpha value — clamps to its last variant (index 2)
    slots[2] = 0;  // beta variant 0
    const { result, frame } = contract.renderTargetFacadeHost({
      decoded,
      baseFrame,
      mailbox: { sequence: 2, sequenceAfter: 2, slots, admittedGeneration: 21 },
      state: { lastAppliedRevision: 0 },
      expectedGeneration: 21,
    });
    expect(result).toBe(contract.TARGET_FACADE_RESULT.ok);
    // alpha rect (10,20 11x4): every pixel equals clamped variant 2, exactly.
    for (let row = 0; row < 4; row += 1) {
      for (let column = 0; column < 11; column += 1) {
        expect(frame[(20 + row) * 100 + 10 + column]).toBe(rasterA[2][row * 11 + column]);
      }
    }
    // beta rect (40,100 5x7): variant 0.
    for (let row = 0; row < 7; row += 1) {
      for (let column = 0; column < 5; column += 1) {
        expect(frame[(100 + row) * 100 + 40 + column]).toBe(rasterB[0][row * 5 + column]);
      }
    }
    // One pixel just outside each rect stays base — the blit is rect-exact.
    expect(frame[19 * 100 + 10]).toBe(0x0861);
    expect(frame[20 * 100 + 21]).toBe(0x0861);
  });

  it.runIf(!HAS_V3_CONTRACT)("strict v3 decoder round-trip is PENDING the parallel contract/C agent", () => {
    expect(HAS_V3_CONTRACT).toBe(false);
  });
});

describe("variantRaster validation", () => {
  const build = (targets: F2tfTarget[]) => buildF2tfPackage({
    generation: 1,
    baseFrame: new Uint16Array(31_000),
    f2jsBinary: Uint8Array.from([1]),
    palette: [0],
    glyphs: GLYPHS,
    contractSha256: TARGET_FACADE_CONTRACT_V3_SHA256,
    targets: [ROOT_TARGET, ...targets],
  });

  it("rejects an empty raster table and one beyond 16 variants", async () => {
    await expect(build([{
      id: "a", x: 0, y: 0, width: 2, height: 2,
      format: F2TF_FORMATTER.variantRaster, properties: F2TF_PROPERTY.text,
      slots: [1], rasters: [],
    }])).rejects.toThrow(/needs 1\.\.16 rasters; got 0/);
    await expect(build([{
      id: "a", x: 0, y: 0, width: 2, height: 2,
      format: F2TF_FORMATTER.variantRaster, properties: F2TF_PROPERTY.text,
      slots: [1], rasters: Array.from({ length: 17 }, () => new Uint16Array(4)),
    }])).rejects.toThrow(/needs 1\.\.16 rasters; got 17/);
  });

  it("rejects a raster whose byte length is not exactly rect.w*rect.h*2", async () => {
    await expect(build([{
      id: "a", x: 0, y: 0, width: 3, height: 2,
      format: F2TF_FORMATTER.variantRaster, properties: F2TF_PROPERTY.text,
      slots: [1], rasters: [new Uint16Array(5)],
    }])).rejects.toThrow(/variant 0 must be exactly 3×2 = 6 RGB565 pixels; got 5/);
  });

  it("rejects colour-slotted or property-mismatched raster records", async () => {
    await expect(build([{
      id: "a", x: 0, y: 0, width: 2, height: 2,
      format: F2TF_FORMATTER.variantRaster,
      properties: F2TF_PROPERTY.text | F2TF_PROPERTY.color,
      slots: [1], rasters: [new Uint16Array(4)],
    }])).rejects.toThrow(/exactly the text property/);
    await expect(build([{
      id: "a", x: 0, y: 0, width: 2, height: 2,
      format: F2TF_FORMATTER.variantRaster, properties: F2TF_PROPERTY.text,
      slots: [1, 2], rasters: [new Uint16Array(4)],
    }])).rejects.toThrow(/exactly one value slot/);
  });

  it("enforces the 65536-byte asset cap, itemizing per-target raster costs", async () => {
    // One full-canvas rect at two variants is 124,000 raster bytes on its own.
    const pixels = 100 * 310;
    await expect(build([{
      id: "big", x: 0, y: 0, width: 100, height: 310,
      format: F2TF_FORMATTER.variantRaster, properties: F2TF_PROPERTY.text,
      slots: [1], rasters: [new Uint16Array(pixels), new Uint16Array(pixels)],
    }])).rejects.toThrow(
      /cap is 65536.*"#big" 2 variants × 100×310px × 2 B = 124000 bytes/s,
    );
  });
});
