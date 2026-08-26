// Full DSL → F2UP round trip for the GLYPHS (variantText) path, which remains
// available behind `renderMode: "glyphs"` now that the assembler defaults to
// variantRaster (see test/widgetAssemblerRaster.test.ts for the default). The
// assembled container must decode with the strict F2UP decoder, its F2TF
// section must satisfy the SDK's own strict facade decoder — under the v3
// contract sha, which the assembler stamps in BOTH modes because the v3
// module admits only v3 assets — its F2JS section must be byte-identical to
// buildF2JSPackage run directly, and its LZSS section must decompress to the
// exact base frame that went in.

import { describe, expect, it } from "vitest";

import { assembleWidgetUpload, WidgetAssemblyError } from "../src/compiler/widgetAssembler";
import { decodeUploadContainer } from "../src/compiler/uploadContainer";
import { decodeLzss } from "../src/compiler/lzss";
import { buildF2JSPackage } from "../src/compiler/f2jsPackage";
import { transpileWidgetScript } from "../src/compiler/mquickjsTranspiler";
import {
  TARGET_FACADE_CONTRACT_V2_SHA256,
  TARGET_FACADE_CONTRACT_V3_SHA256,
} from "../src/compiler/f2tfPackage";
import { BASE_FRAME_BYTES } from "../src/compiler/frameCapture";
import { rgbTo565 } from "../src/compiler/renderV2Package";

const ROOT = new URL("../../../", import.meta.url).pathname;

// Representative DSL, in the transpiler fixture's style: knob + tick + key +
// chord + host.rpc handlers; two text targets, one of them coloured.
const DSL = `var counter = 0;
var knobPos = 0;
var hostVal = 0;

widget.on("tick.1s", function (event) {
  counter = mod(counter + 1, 4);
  document.querySelector("#status").textContent = pick(counter, "IDLE", "WARM", "RUN", "COOL");
});

widget.on("input.fn-bottom-knob", function (event) {
  knobPos = mod(knobPos + event.delta, 3);
  document.querySelector("#gear").textContent = pick(knobPos, "LO", "MID", "HI");
});

widget.on("host.rpc:0xB201", function (event) {
  hostVal = mod(event.value, 3);
  document.querySelector("#gear").textContent = pick(hostVal, "LO", "MID", "HI");
  document.querySelector("#gear").style.color = pick(hostVal,
    "#59E2FF", "#FFB74D", "#FF5F97");
});

widget.on("input.key.down", function (event) {
  counter = clamp(counter + 1, 0, 3);
  document.querySelector("#status").textContent = pick(counter, "IDLE", "WARM", "RUN", "COOL");
});

widget.on("input.chord.down", function (event) {
  document.querySelector("#status").textContent = pick(0, "IDLE", "WARM", "RUN", "COOL");
});
`;

const LAYOUTS = {
  status: { x: 10, y: 20, width: 72, height: 12 },
  gear: { x: 10, y: 40, width: 60, height: 12 },
};

/** Deterministic, compressible base frame: banded colour rows. */
function sampleBaseFrame(): Uint8Array {
  const bytes = new Uint8Array(BASE_FRAME_BYTES);
  const view = new DataView(bytes.buffer);
  for (let y = 0; y < 310; y += 1) {
    const colour = y < 100 ? 0x0861 : y < 200 ? 0x18e3 : 0x2965;
    for (let x = 0; x < 100; x += 1) view.setUint16((y * 100 + x) * 2, colour, true);
  }
  view.setUint16(0, 0xf800, true); // one distinctive corner pixel
  return bytes;
}

const GENERATION = 7;

async function assembleSample() {
  // INVALIDATED-BY-DEFAULT NOTE: this suite predates contract v3 and pins the
  // glyph path, which the default flip to "raster" would otherwise break —
  // raster assemblies capture their own base through a bridge and refuse a
  // pre-captured baseFrame. The glyph output itself is byte-identical to the
  // v2-era output except for the contract sha in the F2TF header.
  return assembleWidgetUpload({
    dsl: DSL,
    baseFrame: sampleBaseFrame(),
    generation: GENERATION,
    layouts: LAYOUTS,
    renderMode: "glyphs",
  });
}

describe("assembleWidgetUpload round trip", () => {
  it("pins the v2 contract sha to the experiments source of truth", async () => {
    const contract = await import(`${ROOT}experiments/mquickjs-target-facade/contract.mjs`);
    expect(TARGET_FACADE_CONTRACT_V2_SHA256).toBe(contract.TARGET_FACADE_CONTRACT_V2_SHA256);
  });

  it("assembles a container the strict F2UP decoder accepts", async () => {
    const assembled = await assembleSample();
    expect(assembled.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(assembled.bytes).toBe(assembled.binary.length);
    expect(assembled.generation).toBe(GENERATION);

    const decoded = await decodeUploadContainer(assembled.binary);
    expect(decoded.generation).toBe(GENERATION);
    expect(decoded.f2js.length).toBeGreaterThan(0);
    expect(decoded.f2tf.length).toBeGreaterThan(0);
    expect(decoded.lzss.length).toBeGreaterThan(0);
    expect(decoded.f2js.length).toBe(assembled.sections.f2js.bytes);
    expect(decoded.f2tf.length).toBe(assembled.sections.f2tf.bytes);
    expect(decoded.lzss.length).toBe(assembled.sections.lzss.bytes);
    expect(decoded.f2jsSha256).toBe(assembled.sections.f2js.sha256);
  });

  it("carries an F2JS section byte-identical to buildF2JSPackage run directly", async () => {
    const assembled = await assembleSample();
    const decoded = await decodeUploadContainer(assembled.binary);

    const out = transpileWidgetScript(DSL);
    expect(out.diagnostics).toEqual([]);
    const direct = await buildF2JSPackage({
      source: out.deviceSource,
      generation: GENERATION,
      events: out.events,
      targets: Object.entries(out.slotMap).map(([id, alloc]) => {
        const writes: ("textContent" | "color")[] = [];
        if (alloc.textSlot !== undefined) writes.push("textContent");
        if (alloc.colorSlot !== undefined) writes.push("color");
        return { id, writes };
      }),
    });
    expect(direct.binary.length).toBe(decoded.f2js.length);
    expect(Buffer.from(decoded.f2js).equals(Buffer.from(direct.binary))).toBe(true);
    expect(direct.sha256).toBe(assembled.sections.f2js.sha256);
  });

  it("carries an F2TF section the SDK strict decoder accepts under the v3 sha", async () => {
    const assembled = await assembleSample();
    const decoded = await decodeUploadContainer(assembled.binary);
    const contract = await import(`${ROOT}experiments/mquickjs-target-facade/contract.mjs`);

    // The assembler stamps v3 in both modes (the v3 module admits only v3);
    // a glyph-only asset has no rasters section, so the frozen decoder still
    // parses it byte-for-byte under the caller-supplied sha.
    const facade = contract.decodeTargetFacadeAsset(Buffer.from(decoded.f2tf), {
      expectedGeneration: GENERATION,
      expectedF2jsSha256: assembled.sections.f2js.sha256,
      expectedContractSha256: TARGET_FACADE_CONTRACT_V3_SHA256,
    });

    // Target 0 is the root visibility target on the flags slot.
    expect(facade.targets[0].format).toBe(1);
    expect(facade.targets[0].slots[0]).toBe(15);

    // Slot-map order: #status (text only, slot 1), #gear (text 2, colour 3).
    const status = facade.targets[1];
    expect(status.id).toBe("status");
    expect(status.format).toBe(11);
    expect(status.properties).toBe(1);
    expect(status.slots.slice(0, 2)).toEqual([1, 0xff]);
    expect(status.tables.map((t: Buffer) => t.toString("ascii"))).toEqual(["IDLE", "WARM", "RUN", "COOL"]);
    expect(status.x).toBe(10);
    expect(status.y).toBe(20);
    expect(status.width).toBe(72);
    expect(status.height).toBe(12);

    const gear = facade.targets[2];
    expect(gear.id).toBe("gear");
    expect(gear.properties).toBe(3);
    expect(gear.slots.slice(0, 2)).toEqual([2, 3]);
    expect(gear.tables.map((t: Buffer) => t.toString("ascii"))).toEqual(["LO", "MID", "HI"]);

    // Colour-slot values index the palette directly, so the gear colour
    // variants occupy indices 0..2 in table order; the status target's default
    // white was appended after them.
    expect(facade.palette.slice(0, 3)).toEqual([
      rgbTo565(0x59, 0xe2, 0xff),
      rgbTo565(0xff, 0xb7, 0x4d),
      rgbTo565(0xff, 0x5f, 0x97),
    ]);
    expect(facade.palette[status.palette0]).toBe(rgbTo565(255, 255, 255));

    // Every character of every variant has a glyph.
    const used = new Set([..."IDLEWARMRUNCOOLMIDHI"].map((c) => c.charCodeAt(0)));
    for (const code of used) expect(facade.glyphs.has(code)).toBe(true);
  });

  it("renders the transpiled slot semantics through the SDK oracle", async () => {
    const assembled = await assembleSample();
    const decoded = await decodeUploadContainer(assembled.binary);
    const contract = await import(`${ROOT}experiments/mquickjs-target-facade/contract.mjs`);
    const facade = contract.decodeTargetFacadeAsset(Buffer.from(decoded.f2tf), {
      expectedGeneration: GENERATION,
      expectedF2jsSha256: assembled.sections.f2js.sha256,
      expectedContractSha256: TARGET_FACADE_CONTRACT_V3_SHA256,
    });

    const baseBytes = sampleBaseFrame();
    const baseFrame = new Uint16Array(31_000);
    const view = new DataView(baseBytes.buffer);
    for (let i = 0; i < baseFrame.length; i += 1) baseFrame[i] = view.getUint16(i * 2, true);

    // gear text slot (2) = variant 2 "HI"; gear colour slot (3) = 2 → #FF5F97.
    const slots = Array(16).fill(0);
    slots[0] = 1;
    slots[2] = 2;
    slots[3] = 2;
    const { result, frame } = contract.renderTargetFacadeHost({
      decoded: facade,
      baseFrame,
      mailbox: { sequence: 2, sequenceAfter: 2, slots, admittedGeneration: GENERATION },
      state: { lastAppliedRevision: 0 },
      expectedGeneration: GENERATION,
    });
    expect(result).toBe(contract.TARGET_FACADE_RESULT.ok);
    const pink = rgbTo565(0xff, 0x5f, 0x97);
    let painted = 0;
    for (let y = 40; y < 52; y += 1)
      for (let x = 10; x < 70; x += 1)
        if (frame[y * 100 + x] === pink) painted += 1;
    expect(painted).toBeGreaterThan(0);
  });

  it("compresses the base frame losslessly", async () => {
    const assembled = await assembleSample();
    const decoded = await decodeUploadContainer(assembled.binary);
    const baseBytes = sampleBaseFrame();
    const decompressed = decodeLzss(decoded.lzss, BASE_FRAME_BYTES);
    expect(Buffer.from(decompressed).equals(Buffer.from(baseBytes))).toBe(true);
    expect(assembled.sections.lzss.decompressedBytes).toBe(BASE_FRAME_BYTES);
  });
});

describe("assembleWidgetUpload error paths", () => {
  const base = () => sampleBaseFrame();

  it("fails with the transpiler's diagnostics when the DSL does not transpile", async () => {
    const dsl = `var a = 0;
widget.on("tick.1s", function (event) {
  document.querySelector("#x").innerHTML = "hi";
});
`;
    const failure = await assembleWidgetUpload({
      dsl, baseFrame: base(), generation: 1, layouts: {},
    }).catch((cause) => cause as WidgetAssemblyError);
    expect(failure).toBeInstanceOf(WidgetAssemblyError);
    expect(failure.message).toMatch(/does not transpile/);
    expect(failure.diagnostics.some((d) => d.severity === "error" && /innerHTML/.test(d.message))).toBe(true);
  });

  // INVALIDATED-BY-DEFAULT NOTE: the two glyph-charset rejections below are
  // glyph-path contracts — the raster default renders any character CSS can
  // draw (that is its point), so these now pin renderMode: "glyphs".
  it("lists unsupported glyph characters", async () => {
    const dsl = `var a = 0;
widget.on("tick.1s", function (event) {
  a = mod(a + 1, 2);
  document.querySelector("#w").textContent = pick(a, "SUN", "RAIN☂");
});
`;
    await expect(
      assembleWidgetUpload({
        dsl, baseFrame: base(), generation: 1, renderMode: "glyphs",
        layouts: { w: { x: 0, y: 0, width: 40, height: 10 } },
      }),
    ).rejects.toThrow(/Unsupported characters .*☂/);
  });

  it("rejects non-ASCII characters the font DOES have, byte-wise honesty", async () => {
    const dsl = `var a = 0;
widget.on("tick.1s", function (event) {
  a = mod(a + 1, 2);
  document.querySelector("#t").textContent = pick(a, "20°", "21°");
});
`;
    await expect(
      assembleWidgetUpload({
        dsl, baseFrame: base(), generation: 1, renderMode: "glyphs",
        layouts: { t: { x: 0, y: 0, width: 40, height: 10 } },
      }),
    ).rejects.toThrow(/not ASCII/);
  });

  it("rejects a wrong-sized base frame", async () => {
    await expect(
      assembleWidgetUpload({
        dsl: DSL, baseFrame: new Uint8Array(100), generation: 1, layouts: LAYOUTS,
      }),
    ).rejects.toThrow(/exactly 62000 bytes/);
  });

  it("rejects a missing layout, naming the target", async () => {
    await expect(
      assembleWidgetUpload({
        dsl: DSL, baseFrame: base(), generation: 1,
        layouts: { status: LAYOUTS.status },
      }),
    ).rejects.toThrow(/No layout for target "#gear"/);
  });

  it("rejects a colour-only target", async () => {
    const dsl = `var a = 0;
widget.on("tick.1s", function (event) {
  a = mod(a + 1, 2);
  document.querySelector("#led").style.color = pick(a, "#FF0000", "#00FF00");
});
`;
    await expect(
      assembleWidgetUpload({
        dsl, baseFrame: base(), generation: 1,
        layouts: { led: { x: 0, y: 0, width: 10, height: 10 } },
      }),
    ).rejects.toThrow(/colour-only target/);
  });

  it("rejects colour tables that disagree at an index", async () => {
    // INVALIDATED-BY-DEFAULT NOTE: the shared-palette constraint is a glyph
    // (variantText) limitation — raster pixels carry their own colour and
    // render this DSL fine — so this rejection now pins renderMode: "glyphs".
    const dsl = `var a = 0;
widget.on("tick.1s", function (event) {
  a = mod(a + 1, 2);
  document.querySelector("#a").textContent = pick(a, "X", "Y");
  document.querySelector("#a").style.color = pick(a, "#FF0000", "#00FF00");
  document.querySelector("#b").textContent = pick(a, "X", "Y");
  document.querySelector("#b").style.color = pick(a, "#0000FF", "#00FF00");
});
`;
    await expect(
      assembleWidgetUpload({
        dsl, baseFrame: base(), generation: 1, renderMode: "glyphs",
        layouts: {
          a: { x: 0, y: 0, width: 10, height: 10 },
          b: { x: 0, y: 20, width: 10, height: 10 },
        },
      }),
    ).rejects.toThrow(/Colour tables conflict at variant index 0/);
  });

  it("rejects ids the facade grammar cannot carry", async () => {
    const dsl = `var a = 0;
widget.on("tick.1s", function (event) {
  a = mod(a + 1, 2);
  document.querySelector("#My_Target").textContent = pick(a, "X", "Y");
});
`;
    await expect(
      assembleWidgetUpload({
        dsl, baseFrame: base(), generation: 1,
        layouts: { My_Target: { x: 0, y: 0, width: 10, height: 10 } },
      }),
    ).rejects.toThrow(/not a facade id/);
  });

  it("rejects a bad generation before doing any work", async () => {
    await expect(
      assembleWidgetUpload({ dsl: DSL, baseFrame: base(), generation: 0, layouts: LAYOUTS }),
    ).rejects.toThrow(/generation must be an integer 1\.\./i);
  });
});
