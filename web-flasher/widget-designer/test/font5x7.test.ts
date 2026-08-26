// The Designer's glyph library: structural validity for every glyph, visual
// spot checks against the device-proven masks, and an end-to-end proof that
// glyphsFor() output flows through the F2TF encoder, the SDK's strict decoder,
// and the pixel oracle to light real, digit-specific pixels.

import { describe, expect, it } from "vitest";

import { FONT_5X7, glyphsFor } from "../src/compiler/font5x7";
import { buildF2tfPackage, F2TF_FORMATTER, F2TF_PROPERTY } from "../src/compiler/f2tfPackage";

const ROOT = new URL("../../../", import.meta.url).pathname;

const REQUIRED_CHARACTERS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789" +
  " .,:;!?%+-/()#'\"°<>=_";

describe("FONT_5X7 structure", () => {
  it("covers the full required character set", () => {
    for (const character of REQUIRED_CHARACTERS) {
      expect(FONT_5X7[character], `missing glyph for ${JSON.stringify(character)}`).toBeDefined();
    }
  });

  it("every glyph is five 7-bit columns under a single-character key", () => {
    for (const [character, columns] of Object.entries(FONT_5X7)) {
      expect(character.length).toBe(1);
      expect(columns.length).toBe(5);
      for (const column of columns) {
        expect(Number.isInteger(column)).toBe(true);
        expect(column).toBeGreaterThanOrEqual(0);
        expect(column).toBeLessThanOrEqual(0x7f);
      }
    }
  });

  it("spot checks: strokes land where the eye expects them", () => {
    // Space paints nothing.
    expect(FONT_5X7[" "]).toEqual([0, 0, 0, 0, 0]);
    // "1" carries its full-height vertical stroke in the middle column.
    expect(FONT_5X7["1"][2]).toBe(0x7f);
    // "0" is left-right symmetric.
    expect(FONT_5X7["0"][0]).toBe(FONT_5X7["0"][4]);
    // "_" is exactly the bottom row (bit 6, since bit 0 is the top row).
    expect(FONT_5X7._).toEqual([0x40, 0x40, 0x40, 0x40, 0x40]);
    // "." sits in the bottom half: no pixel in the top three rows.
    for (const column of FONT_5X7["."]) expect(column & 0b0000111).toBe(0);
    // The degree ring hugs the top rows, as on the flashed weather display.
    for (const column of FONT_5X7["°"]) expect(column & 0b1110000).toBe(0);
    expect("°".charCodeAt(0)).toBe(0xb0); // the byte the F2TF encoder stores
    // All ten digits are distinct drawings.
    const digits = "0123456789";
    expect(new Set([...digits].map((d) => FONT_5X7[d].join(","))).size).toBe(10);
  });
});

describe("glyphsFor", () => {
  it("selects exactly the requested subset, deduplicated, as copies", () => {
    const selected = glyphsFor("AABBA °");
    expect(Object.keys(selected).sort()).toEqual([" ", "A", "B", "°"].sort());
    expect(selected.A).toEqual(FONT_5X7.A);
    expect(selected.A).not.toBe(FONT_5X7.A); // mutation cannot reach the library
  });

  it("throws naming every character it lacks", () => {
    expect(() => glyphsFor("A✓B□")).toThrow(/"✓".*"□"/u);
    expect(() => glyphsFor("ABC")).not.toThrow();
  });
});

describe("glyphsFor through the F2TF encoder and SDK oracle", () => {
  const BLACK = 0x0000;
  const GREEN = 0x07e0;

  it("renders digit-specific pixels for a variantText digit table", async () => {
    const contract = await import(`${ROOT}experiments/mquickjs-target-facade/contract.mjs`);
    const baseFrame = new Uint16Array(31_000).fill(BLACK);
    const f2jsBinary = Uint8Array.from([9, 9, 9, 9]);
    const digits = [..."0123456789"];
    const built = await buildF2tfPackage({
      generation: 5,
      baseFrame,
      f2jsBinary,
      palette: [BLACK, GREEN],
      glyphs: glyphsFor("0123456789"),
      contractSha256: contract.TARGET_FACADE_CONTRACT_V2_SHA256,
      targets: [
        {
          id: "root",
          x: 0, y: 0, width: 100, height: 310,
          format: F2TF_FORMATTER.rootVisibility,
          properties: F2TF_PROPERTY.hidden,
          slots: [15],
        },
        {
          id: "digit",
          x: 10, y: 20, width: 40, height: 10,
          format: F2TF_FORMATTER.variantText,
          properties: F2TF_PROPERTY.text,
          slots: [1],
          palette0: 1,
          table: digits,
          maxChars: 1,
          scale: 1,
        },
      ],
    });
    const decoded = contract.decodeTargetFacadeAsset(built.binary, {
      expectedGeneration: 5,
      expectedF2jsSha256: built.f2jsSha256,
      expectedContractSha256: contract.TARGET_FACADE_CONTRACT_V2_SHA256,
    });

    const signatures = digits.map((_, digit) => {
      const slots = Array(16).fill(0);
      slots[0] = 1; // revision
      slots[1] = digit; // variant selector
      const { result, frame } = contract.renderTargetFacadeHost({
        decoded,
        baseFrame,
        mailbox: { sequence: 2, sequenceAfter: 2, slots, admittedGeneration: 5 },
        state: { lastAppliedRevision: 0 },
        expectedGeneration: 5,
      });
      expect(result).toBe(contract.TARGET_FACADE_RESULT.ok);
      const lit: number[] = [];
      for (let y = 20; y < 30; y += 1)
        for (let x = 10; x < 50; x += 1)
          if (frame[y * 100 + x] === GREEN) lit.push(y * 100 + x);
      // Every digit must actually paint inside its rect.
      expect(lit.length).toBeGreaterThan(0);
      return lit.join(",");
    });

    // Distinct glyphs must produce distinct pixel patterns — all ten differ.
    expect(new Set(signatures).size).toBe(10);
  });
});
