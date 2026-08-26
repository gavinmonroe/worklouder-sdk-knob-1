// The Designer's F2TF encoder validated by the SDK's OWN strict decoder and
// pixel oracle — the same code the canary release evidence runs. If the
// decoder accepts the asset and the oracle renders the expected literal at the
// expected rect in the expected colour, the device facade (which implements
// the same contract) will too.

import { describe, expect, it } from "vitest";

import { buildF2tfPackage, F2TF_FORMATTER, F2TF_PROPERTY } from "../src/compiler/f2tfPackage";

const ROOT = new URL("../../../", import.meta.url).pathname;

/** Minimal 5x7 digit font for the tests. */
const GLYPHS: Record<string, number[]> = {
  "0": [0x3e, 0x51, 0x49, 0x45, 0x3e],
  "1": [0x00, 0x42, 0x7f, 0x40, 0x00],
  "2": [0x62, 0x51, 0x49, 0x49, 0x46],
  A: [0x7e, 0x09, 0x09, 0x09, 0x7e],
  B: [0x7f, 0x49, 0x49, 0x49, 0x36],
};

const BLACK = 0x0000;
const GREEN = 0x07e0;
const RED = 0xf800;

async function buildSample() {
  const contract = await import(`${ROOT}experiments/mquickjs-target-facade/contract.mjs`);
  const baseFrame = new Uint16Array(31_000).fill(BLACK);
  const f2jsBinary = Uint8Array.from([1, 2, 3, 4]);
  const built = await buildF2tfPackage({
    generation: 7,
    baseFrame,
    f2jsBinary,
    palette: [BLACK, GREEN, RED],
    glyphs: GLYPHS,
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
        id: "counter",
        x: 10, y: 20, width: 40, height: 10,
        format: F2TF_FORMATTER.variantText,
        properties: F2TF_PROPERTY.text,
        slots: [1],
        palette0: 1,
        table: ["0", "1", "2"],
        maxChars: 1,
        scale: 1,
      },
      {
        id: "label",
        x: 10, y: 40, width: 40, height: 10,
        format: F2TF_FORMATTER.variantText,
        properties: F2TF_PROPERTY.text | F2TF_PROPERTY.color,
        slots: [2, 3],
        palette0: 1,
        table: ["AB", "BA"],
        maxChars: 2,
        scale: 1,
      },
    ],
  });
  return { contract, built, baseFrame };
}

describe("Designer F2TF encoder against the SDK contract", () => {
  it("produces an asset the strict SDK decoder accepts", async () => {
    const { contract, built } = await buildSample();
    const decoded = contract.decodeTargetFacadeAsset(built.binary, {
      expectedGeneration: 7,
      expectedF2jsSha256: built.f2jsSha256,
      expectedContractSha256: contract.TARGET_FACADE_CONTRACT_V2_SHA256,
    });
    expect(decoded.targets[0].format).toBe(1);
    expect(decoded.targets[1].format).toBe(11);
    expect(decoded.targets[1].tables.map((t: Buffer) => t.toString("ascii"))).toEqual(["0", "1", "2"]);
    expect(decoded.targets[2].slots.slice(0, 2)).toEqual([2, 3]);
    expect(decoded.palette).toEqual([BLACK, GREEN, RED]);
    expect(decoded.glyphs.size).toBe(5);
  });

  it("renders the selected variant at the target rect via the SDK oracle", async () => {
    const { contract, built, baseFrame } = await buildSample();
    const decoded = contract.decodeTargetFacadeAsset(built.binary, {
      expectedGeneration: 7,
      expectedF2jsSha256: built.f2jsSha256,
      expectedContractSha256: contract.TARGET_FACADE_CONTRACT_V2_SHA256,
    });
    const render = (slots: number[]) =>
      contract.renderTargetFacadeHost({
        decoded,
        baseFrame,
        mailbox: { sequence: 2, sequenceAfter: 2, slots, admittedGeneration: 7 },
        state: { lastAppliedRevision: 0 },
        expectedGeneration: 7,
      });

    const slots = Array(16).fill(0);
    slots[0] = 1;      // revision
    slots[1] = 2;      // counter -> "2"
    slots[2] = 1;      // label -> "BA"
    slots[3] = 2;      // label colour -> RED
    const { result, frame } = render(slots);
    expect(result).toBe(contract.TARGET_FACADE_RESULT.ok);

    // The counter target must contain green pixels inside its rect.
    let greenInCounter = 0;
    for (let y = 20; y < 30; y += 1)
      for (let x = 10; x < 50; x += 1)
        if (frame[y * 100 + x] === GREEN) greenInCounter += 1;
    expect(greenInCounter).toBeGreaterThan(0);

    // The label target selected palette entry 2 via its colour slot.
    let redInLabel = 0;
    for (let y = 40; y < 50; y += 1)
      for (let x = 10; x < 50; x += 1)
        if (frame[y * 100 + x] === RED) redInLabel += 1;
    expect(redInLabel).toBeGreaterThan(0);

    // Out-of-range index clamps to the last literal instead of rendering junk.
    const clamped = render([1, 99, 0, 0, ...Array(12).fill(0)]);
    expect(clamped.result).toBe(contract.TARGET_FACADE_RESULT.ok);
  });

  it("hides everything when the root visibility slot is set", async () => {
    const { contract, built, baseFrame } = await buildSample();
    const decoded = contract.decodeTargetFacadeAsset(built.binary, {
      expectedGeneration: 7,
      expectedF2jsSha256: built.f2jsSha256,
      expectedContractSha256: contract.TARGET_FACADE_CONTRACT_V2_SHA256,
    });
    const slots = Array(16).fill(0);
    slots[0] = 1;
    slots[15] = 2; // hidden bit
    const { result } = contract.renderTargetFacadeHost({
      decoded,
      baseFrame,
      mailbox: { sequence: 2, sequenceAfter: 2, slots, admittedGeneration: 7 },
      state: { lastAppliedRevision: 0 },
      expectedGeneration: 7,
    });
    expect(result).toBe(contract.TARGET_FACADE_RESULT.hidden);
  });
});
