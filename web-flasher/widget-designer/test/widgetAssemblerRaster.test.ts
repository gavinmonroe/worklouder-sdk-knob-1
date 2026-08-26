// The assembler's DEFAULT path: variantRaster (contract v3). A synthetic
// capture bridge stands in for the live preview — it models per-target text +
// inline colour and renders each dynamic target as a solid rect whose colour
// is a pure function of (text, colour), so every captured byte is predictable
// and the whole choreography (blank → base → per-variant set/capture/restore)
// is observable through the bridge's op log.

import { describe, expect, it } from "vitest";

import {
  assembleWidgetUpload,
  WidgetAssemblyError,
  type VariantCaptureBridge,
} from "../src/compiler/widgetAssembler";
import { decodeUploadContainer } from "../src/compiler/uploadContainer";
import { decodeLzss } from "../src/compiler/lzss";
import { TARGET_FACADE_CONTRACT_V3_SHA256 } from "../src/compiler/f2tfPackage";
import { BASE_FRAME_BYTES } from "../src/compiler/frameCapture";
import { DEVICE_PIXELS, DEVICE_WIDTH } from "../src/compiler/renderV2Package";

const ROOT = new URL("../../../", import.meta.url).pathname;
const contract = await import(`${ROOT}experiments/mquickjs-target-facade/contract.mjs`);
const HAS_V3_CONTRACT = typeof contract.TARGET_FACADE_CONTRACT_V3_SHA256 === "string";

const BG = 0x1234;
const PLACEHOLDER = "PLACEHOLDER";

interface Rect { x: number; y: number; width: number; height: number }

/** Deterministic ≥0x8000 colour per (text, colour) pair — never equals BG. */
function colourFor(text: string, color: string): number {
  let hash = 2166136261 >>> 0;
  for (const character of `${text}|${color}`) {
    hash = (hash ^ character.codePointAt(0)!) >>> 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return 0x8000 | (hash & 0x7fff);
}

/** Synthetic preview: solid-rect renderer over a solid background. */
class FakePreview implements VariantCaptureBridge {
  texts: Record<string, string> = {};
  colors: Record<string, string> = {};
  log: string[] = [];
  constructor(readonly rects: Record<string, Rect>, readonly background: () => Uint16Array) {
    for (const id of Object.keys(rects)) this.texts[id] = PLACEHOLDER;
  }
  private require(id: string): void {
    if (!(id in this.rects)) throw new Error(`the fake preview has no element #${id}`);
  }
  setText(id: string, text: string): void {
    this.require(id);
    this.texts[id] = text;
    this.log.push(`text:${id}=${text}`);
  }
  setColor(id: string, cssColor: string): void {
    this.require(id);
    this.colors[id] = cssColor;
    this.log.push(`color:${id}=${cssColor}`);
  }
  captureFrame(): Uint16Array {
    this.log.push("capture");
    const frame = this.background();
    for (const [id, rect] of Object.entries(this.rects)) {
      const text = this.texts[id];
      if (text.length === 0) continue;
      const colour = colourFor(text, this.colors[id] ?? "");
      for (let row = 0; row < rect.height; row += 1) {
        for (let column = 0; column < rect.width; column += 1) {
          frame[(rect.y + row) * DEVICE_WIDTH + rect.x + column] = colour;
        }
      }
    }
    return frame;
  }
}

const solidBackground = () => new Uint16Array(DEVICE_PIXELS).fill(BG);

// Class-capable fake for the weather v2 preset (the mark is a class-only
// target). Pixel identity = text|class, matching FakePreviewV3's convention.
class FakePreviewV3ForWeather extends FakePreview {
  classes: Record<string, string> = {};
  setClass(id: string, variantClass: string): void {
    if (variantClass === "") delete this.classes[id];
    else this.classes[id] = variantClass;
    this.log.push(`class:${id}=${variantClass}`);
  }
  captureFrame(): Uint16Array {
    this.log.push("capture");
    const frame = this.background();
    for (const [id, rect] of Object.entries(this.rects)) {
      const text = this.texts[id];
      if (text.length === 0) continue;
      const colour = colourFor(`${text}|${this.classes[id] ?? ""}`, this.colors[id] ?? "");
      for (let row = 0; row < rect.height; row += 1) {
        for (let column = 0; column < rect.width; column += 1) {
          frame[(rect.y + row) * DEVICE_WIDTH + rect.x + column] = colour;
        }
      }
    }
    return frame;
  }
}


// status: text-only picks; gear: text + colour in PROVEN lockstep (every
// handler writes both back-to-back from the same index expression).
const LOCKSTEP_DSL = `var counter = 0;
var knobPos = 0;
var hostVal = 0;

widget.on("tick.1s", function (event) {
  counter = mod(counter + 1, 4);
  document.querySelector("#status").textContent = pick(counter, "IDLE", "WARM", "RUN", "COOL");
});

widget.on("input.fn-bottom-knob", function (event) {
  knobPos = mod(knobPos + event.delta, 3);
  document.querySelector("#gear").textContent = pick(knobPos, "LO", "MID", "HI");
  document.querySelector("#gear").style.color = pick(knobPos, "#59E2FF", "#FFB74D", "#FF5F97");
});

widget.on("host.rpc:0xB201", function (event) {
  hostVal = mod(event.value, 3);
  document.querySelector("#gear").textContent = pick(hostVal, "LO", "MID", "HI");
  document.querySelector("#gear").style.color = pick(hostVal, "#59E2FF", "#FFB74D", "#FF5F97");
});
`;

const LAYOUTS = {
  status: { x: 10, y: 20, width: 72, height: 12 },
  gear: { x: 10, y: 40, width: 60, height: 12 },
};

const GEAR_TEXTS = ["LO", "MID", "HI"];
const GEAR_COLOURS = ["#59E2FF", "#FFB74D", "#FF5F97"];
const STATUS_TEXTS = ["IDLE", "WARM", "RUN", "COOL"];

async function assembleLockstep(bridge: FakePreview) {
  return assembleWidgetUpload({
    dsl: LOCKSTEP_DSL,
    generation: 9,
    layouts: LAYOUTS,
    capture: bridge,
  });
}

function decodeFacade(assembled: { sections: { f2js: { sha256: string } } }, f2tf: Uint8Array) {
  return contract.decodeTargetFacadeAsset(Buffer.from(f2tf), {
    expectedGeneration: 9,
    expectedF2jsSha256: assembled.sections.f2js.sha256,
    expectedContractSha256: TARGET_FACADE_CONTRACT_V3_SHA256,
  });
}

describe("assembleWidgetUpload raster default", () => {
  it("blanks every dynamic target BEFORE capturing the base — no placeholder survives", async () => {
    const bridge = new FakePreview(LAYOUTS, solidBackground);
    const assembled = await assembleLockstep(bridge);

    // Choreography: both targets blanked, THEN the first capture (the base).
    const firstCapture = bridge.log.indexOf("capture");
    expect(firstCapture).toBeGreaterThanOrEqual(2);
    expect(bridge.log.slice(0, firstCapture).sort()).toEqual(["text:gear=", "text:status="]);

    // The shipped base is bridge pixels with the placeholders blanked: pure
    // background inside both target rects.
    const decoded = await decodeUploadContainer(assembled.binary);
    const base = decodeLzss(decoded.lzss, BASE_FRAME_BYTES);
    const probe = (x: number, y: number) => base[(y * DEVICE_WIDTH + x) * 2] | (base[(y * DEVICE_WIDTH + x) * 2 + 1] << 8);
    expect(probe(12, 22)).toBe(BG);       // inside #status rect
    expect(probe(15, 45)).toBe(BG);       // inside #gear rect
    expect(probe(0, 0)).toBe(BG);
    const placeholderColour = colourFor(PLACEHOLDER, "");
    for (let index = 0; index < DEVICE_PIXELS; index += 1) {
      const pixel = base[index * 2] | (base[index * 2 + 1] << 8);
      if (pixel === placeholderColour) throw new Error(`placeholder pixel survived at ${index}`);
    }
  });

  it("captures one raster per variant, colour applied, and restores between targets", async () => {
    const bridge = new FakePreview(LAYOUTS, solidBackground);
    await assembleLockstep(bridge);
    // gear's captures carry BOTH the variant text and its lockstep colour.
    for (let variant = 0; variant < 3; variant += 1) {
      expect(bridge.log).toContain(`text:gear=${GEAR_TEXTS[variant]}`);
      expect(bridge.log).toContain(`color:gear=${GEAR_COLOURS[variant]}`);
    }
    // status was re-blanked before gear's variants were captured: its last
    // blanking op precedes gear's first variant op.
    const statusBlank = bridge.log.lastIndexOf("text:status=");
    const gearFirstVariant = bridge.log.indexOf(`text:gear=${GEAR_TEXTS[0]}`);
    expect(statusBlank).toBeGreaterThan(-1);
    expect(statusBlank).toBeLessThan(gearFirstVariant);
    // gear ends blanked with its inline colour cleared.
    expect(bridge.log[bridge.log.length - 2]).toBe("text:gear=");
    expect(bridge.log[bridge.log.length - 1]).toBe("color:gear=");
  });

  it.runIf(HAS_V3_CONTRACT)("ships per-variant tables the strict decoder and oracle reproduce", async () => {
    const bridge = new FakePreview(LAYOUTS, solidBackground);
    const assembled = await assembleLockstep(bridge);
    expect(assembled.renderModes).toEqual({ status: "raster", gear: "raster" });
    expect(assembled.rasterCosts).toEqual([
      { id: "status", variants: 4, width: 72, height: 12, bytes: 4 * 72 * 12 * 2 },
      { id: "gear", variants: 3, width: 60, height: 12, bytes: 3 * 60 * 12 * 2 },
    ]);

    const decoded = await decodeUploadContainer(assembled.binary);
    const facade = decodeFacade(assembled, decoded.f2tf);
    const status = facade.targets[1];
    const gear = facade.targets[2];
    expect(status.id).toBe("status");
    expect(status.format).toBe(12);
    expect(status.slots[0]).toBe(1);       // text slot drives text-only rasters
    expect(status.rasters.length).toBe(4);
    expect(gear.format).toBe(12);
    expect(gear.slots[0]).toBe(2);         // lockstep binds the TEXT slot
    expect(gear.rasters.length).toBe(3);

    // Every status variant is its solid synthetic colour, byte-exact.
    STATUS_TEXTS.forEach((text, variant) => {
      const expected = colourFor(text, "");
      const raster: Buffer = status.rasters[variant];
      expect(raster.length).toBe(72 * 12 * 2);
      for (let pixel = 0; pixel < 72 * 12; pixel += 1) {
        expect(raster.readUInt16LE(pixel * 2)).toBe(expected);
      }
    });
    // gear variant k carries colour k — captured WITH the colour applied.
    GEAR_TEXTS.forEach((text, variant) => {
      expect(gear.rasters[variant].readUInt16LE(0)).toBe(colourFor(text, GEAR_COLOURS[variant]));
    });

    // End to end through the SDK pixel oracle: gear slot 2 → "HI" pink blit.
    const baseFrame = new Uint16Array(DEVICE_PIXELS).fill(BG);
    const slots = Array(16).fill(0);
    slots[0] = 1;
    slots[2] = 2;
    const { result, frame } = contract.renderTargetFacadeHost({
      decoded: facade,
      baseFrame,
      mailbox: { sequence: 2, sequenceAfter: 2, slots, admittedGeneration: 9 },
      state: { lastAppliedRevision: 0 },
      expectedGeneration: 9,
    });
    expect(result).toBe(contract.TARGET_FACADE_RESULT.ok);
    expect(frame[45 * DEVICE_WIDTH + 15]).toBe(colourFor("HI", "#FF5F97"));
    expect(frame[22 * DEVICE_WIDTH + 12]).toBe(colourFor("IDLE", ""));
    expect(frame[0]).toBe(BG);
  });

  it("renders one raster per COLOUR variant for constant text, bound to the colour slot", async () => {
    const dsl = `var sel = 0;
widget.on("input.fn-bottom-knob", function (event) {
  sel = mod(sel + event.delta, 2);
  document.querySelector("#arrow").textContent = pick(0, "→");
  document.querySelector("#arrow").style.color = pick(sel, "#FF8A00", "#77736F");
});
`;
    const layouts = { arrow: { x: 30, y: 60, width: 9, height: 9 } };
    const bridge = new FakePreview(layouts, solidBackground);
    const assembled = await assembleWidgetUpload({ dsl, generation: 9, layouts, capture: bridge });
    expect(assembled.rasterCosts).toEqual([
      { id: "arrow", variants: 2, width: 9, height: 9, bytes: 2 * 9 * 9 * 2 },
    ]);
    const decoded = await decodeUploadContainer(assembled.binary);
    const facade = decodeFacade(assembled, decoded.f2tf);
    const arrow = facade.targets[1];
    expect(arrow.format).toBe(12);
    // text slot is 1, colour slot is 2 — the record binds the COLOUR slot.
    expect(arrow.slots[0]).toBe(2);
    expect(arrow.rasters.length).toBe(2);
    expect(arrow.rasters[0].readUInt16LE(0)).toBe(colourFor("→", "#FF8A00"));
    expect(arrow.rasters[1].readUInt16LE(0)).toBe(colourFor("→", "#77736F"));
  });

  it("applies a single constant colour to every text variant", async () => {
    const dsl = `var n = 0;
widget.on("tick.1s", function (event) {
  n = mod(n + 1, 3);
  document.querySelector("#lamp").textContent = pick(n, "ON", "OFF", "DIM");
  document.querySelector("#lamp").style.color = pick(0, "#ABCDEF");
});
`;
    const layouts = { lamp: { x: 5, y: 5, width: 20, height: 8 } };
    const bridge = new FakePreview(layouts, solidBackground);
    const assembled = await assembleWidgetUpload({ dsl, generation: 9, layouts, capture: bridge });
    const decoded = await decodeUploadContainer(assembled.binary);
    const facade = decodeFacade(assembled, decoded.f2tf);
    const lamp = facade.targets[1];
    expect(lamp.slots[0]).toBe(1); // text slot drives; colour is constant
    expect(lamp.rasters.length).toBe(3);
    ["ON", "OFF", "DIM"].forEach((text, variant) => {
      expect(lamp.rasters[variant].readUInt16LE(0)).toBe(colourFor(text, "#ABCDEF"));
    });
  });

  it("refuses independently-slotted text and colour picks with a directive diagnostic", async () => {
    // The knob moves gear's TEXT while its colour stays — the joint space is a
    // product, inexpressible in one bound slot.
    const dsl = `var knobPos = 0;
var hostVal = 0;
widget.on("input.fn-bottom-knob", function (event) {
  knobPos = mod(knobPos + event.delta, 3);
  document.querySelector("#gear").textContent = pick(knobPos, "LO", "MID", "HI");
});
widget.on("host.rpc:0xB201", function (event) {
  hostVal = mod(event.value, 3);
  document.querySelector("#gear").textContent = pick(hostVal, "LO", "MID", "HI");
  document.querySelector("#gear").style.color = pick(hostVal, "#59E2FF", "#FFB74D", "#FF5F97");
});
`;
    const bridge = new FakePreview({ gear: LAYOUTS.gear }, solidBackground);
    const failure = await assembleWidgetUpload({
      dsl, generation: 9, layouts: { gear: LAYOUTS.gear }, capture: bridge,
    }).catch((cause) => cause as WidgetAssemblyError);
    expect(failure).toBeInstanceOf(WidgetAssemblyError);
    expect(failure.message).toMatch(/independent pick indexes/);
    expect(failure.message).toMatch(/same pick index/);
    expect(failure.message).toMatch(/multiply into 9 rasters/);
    // Refused before any pixel work: the preview was never touched.
    expect(bridge.log).toEqual([]);
  });

  it("also refuses a state mutation BETWEEN paired writes (textual match is not enough)", async () => {
    const dsl = `var n = 0;
widget.on("tick.1s", function (event) {
  n = mod(n + 1, 2);
  document.querySelector("#x").textContent = pick(n, "A", "B");
  n = mod(n + 1, 2);
  document.querySelector("#x").style.color = pick(n, "#111111", "#222222");
});
`;
    const layouts = { x: { x: 0, y: 0, width: 8, height: 8 } };
    const bridge = new FakePreview(layouts, solidBackground);
    await expect(
      assembleWidgetUpload({ dsl, generation: 9, layouts, capture: bridge }),
    ).rejects.toThrow(/independent pick indexes/);
  });

  it("itemizes per-target raster costs when the widget exceeds the container budget", async () => {
    // An incompressible base plus ~59 KB of rasters: the F2TF stays under its
    // own 65,536-byte cap, but the CONTAINER total passes 98,304.
    const noise = () => {
      const frame = new Uint16Array(DEVICE_PIXELS);
      for (let index = 0; index < frame.length; index += 1) {
        frame[index] = Math.imul(index + 1, 2654435761) >>> 16;
      }
      return frame;
    };
    const layouts = {
      status: { x: 0, y: 0, width: 100, height: 34 },
      gear: { x: 0, y: 150, width: 100, height: 60 },
    };
    const bridge = new FakePreview(layouts, noise);
    const failure = await assembleWidgetUpload({
      dsl: LOCKSTEP_DSL, generation: 9, layouts, capture: bridge,
    }).catch((cause) => cause as WidgetAssemblyError);
    expect(failure).toBeInstanceOf(WidgetAssemblyError);
    expect(failure.message).toMatch(/exceeds the 98304-byte \(96 KiB\) upload container/);
    expect(failure.message).toMatch(/"#status" 4 variants × 100×34px × 2 B = 27200 bytes/);
    expect(failure.message).toMatch(/"#gear" 3 variants × 100×60px × 2 B = 36000 bytes/);
  });

  it("itemizes costs when a single facade exceeds the 65,536-byte v3 asset cap", async () => {
    const layouts = {
      status: { x: 0, y: 0, width: 100, height: 100 },
      gear: { x: 0, y: 150, width: 100, height: 60 },
    };
    const bridge = new FakePreview(layouts, solidBackground);
    await expect(
      assembleWidgetUpload({ dsl: LOCKSTEP_DSL, generation: 9, layouts, capture: bridge }),
    ).rejects.toThrow(/cap is 65536.*"#status" 4 variants × 100×100px × 2 B = 80000 bytes/s);
  });

  it("still assembles a widget with NO dom targets by capturing the base via the bridge", async () => {
    // Handlers that only mutate state are legal; the store's raster flow
    // passes a bridge and no baseFrame, and that must keep working.
    const dsl = `var n = 0;
widget.on("tick.1s", function (event) {
  n = mod(n + 1, 10);
});
`;
    const bridge = new FakePreview({}, solidBackground);
    const assembled = await assembleWidgetUpload({ dsl, generation: 9, layouts: {}, capture: bridge });
    expect(assembled.renderModes).toEqual({});
    expect(assembled.rasterCosts).toEqual([]);
    expect(bridge.log).toEqual(["capture"]);
    const decoded = await decodeUploadContainer(assembled.binary);
    const base = decodeLzss(decoded.lzss, BASE_FRAME_BYTES);
    expect(base[0] | (base[1] << 8)).toBe(BG);
  });

  it("requires the capture bridge and refuses a pre-captured base frame", async () => {
    await expect(
      assembleWidgetUpload({ dsl: LOCKSTEP_DSL, generation: 9, layouts: LAYOUTS }),
    ).rejects.toThrow(/needs the live-preview capture bridge/);
    const bridge = new FakePreview(LAYOUTS, solidBackground);
    await expect(
      assembleWidgetUpload({
        dsl: LOCKSTEP_DSL, generation: 9, layouts: LAYOUTS, capture: bridge,
        baseFrame: new Uint8Array(BASE_FRAME_BYTES),
      }),
    ).rejects.toThrow(/captures its own base frame/);
  });

  it("surfaces bridge failures as assembly diagnostics", async () => {
    const bridge = new FakePreview(LAYOUTS, solidBackground);
    bridge.captureFrame = () => new Uint16Array(3) as Uint16Array; // malformed
    await expect(assembleLockstep(bridge)).rejects.toThrow(/malformed frame for the base/);

    const throwing = new FakePreview(LAYOUTS, solidBackground);
    throwing.setText = () => { throw new Error("no element #status"); };
    await expect(assembleLockstep(throwing)).rejects.toThrow(/Variant capture failed: no element/);
  });

  it.runIf(HAS_V3_CONTRACT)("assembles the WEATHER (DEVICE) preset: shared-slot digits, mark classes, weekday picks", async () => {
    // Weather v2: temperature and forecast highs/lows are shared-slot digits()
    // targets (formatter 13, one mailbox slot per number), the condition mark
    // is a class-only variant drawing, weekdays are 7-variant picks. Rects are
    // representative stand-ins for the browser measurement.
    const { PRESETS } = await import("../src/presets/widgets");
    const layouts = {
      "temp-num": { x: 24, y: 113, width: 40, height: 28 },
      condition: { x: 22, y: 143, width: 56, height: 16 },
      mark: { x: 38, y: 15, width: 24, height: 17 },
      "day-1": { x: 8, y: 210, width: 26, height: 14 },
      "low-1": { x: 35, y: 210, width: 18, height: 14 },
      "high-1": { x: 67, y: 210, width: 18, height: 14 },
      "day-2": { x: 8, y: 248, width: 26, height: 14 },
      "low-2": { x: 35, y: 248, width: 18, height: 14 },
      "high-2": { x: 67, y: 248, width: 18, height: 14 },
    };
    const bridge = new FakePreviewV3ForWeather(layouts, solidBackground);
    const assembled = await assembleWidgetUpload({
      dsl: PRESETS.weatherDevice.script,
      generation: 9,
      layouts,
      capture: bridge,
    });
    // 63,184 raster bytes total: comfortably inside the 65,536-byte f2tf cap.
    expect(assembled.rasterCosts).toEqual([
      { id: "condition", variants: 4, width: 56, height: 16, bytes: 7168 },
      { id: "mark", variants: 4, width: 24, height: 17, bytes: 3264 },
      { id: "day-1", variants: 7, width: 26, height: 14, bytes: 5096 },
      { id: "day-2", variants: 7, width: 26, height: 14, bytes: 5096 },
      { id: "temp-num-0", variants: 10, width: 20, height: 28, bytes: 11200 },
      { id: "temp-num-1", variants: 10, width: 20, height: 28, bytes: 11200 },
      { id: "high-1-0", variants: 10, width: 9, height: 14, bytes: 2520 },
      { id: "high-1-1", variants: 10, width: 9, height: 14, bytes: 2520 },
      { id: "low-1-0", variants: 10, width: 9, height: 14, bytes: 2520 },
      { id: "low-1-1", variants: 10, width: 9, height: 14, bytes: 2520 },
      { id: "high-2-0", variants: 10, width: 9, height: 14, bytes: 2520 },
      { id: "high-2-1", variants: 10, width: 9, height: 14, bytes: 2520 },
      { id: "low-2-0", variants: 10, width: 9, height: 14, bytes: 2520 },
      { id: "low-2-1", variants: 10, width: 9, height: 14, bytes: 2520 },
    ]);

    const decoded = await decodeUploadContainer(assembled.binary);
    const facade = decodeFacade(assembled, decoded.f2tf);
    const byId = new Map(facade.targets.map((target: { id: string }) => [target.id, target]));
    // Two-digit temperature: two formatter-13 cells on ONE slot (1) with
    // divisors 10 (tens) and 1 (ones).
    const tempTens = byId.get("temp-num-0") as any;
    const tempOnes = byId.get("temp-num-1") as any;
    expect(tempTens.format).toBe(13);
    expect(tempTens.slots[0]).toBe(1);
    expect(tempTens.divisor).toBe(10);
    expect(tempTens.rasters.length).toBe(10);
    expect(tempOnes.slots[0]).toBe(1);
    expect(tempOnes.divisor).toBe(1);
    // Class-only condition mark: 4 CSS-drawn variants bound to the class slot.
    const mark = byId.get("mark") as any;
    expect(mark.format).toBe(12);
    expect(mark.slots[0]).toBe(3);
    expect(mark.rasters.length).toBe(4);
    // Weekday rows: 7-variant picks plus 2-cell high/low digit pairs.
    expect((byId.get("day-1") as any).rasters.length).toBe(7);
    expect((byId.get("day-2") as any).rasters.length).toBe(7);
    expect((byId.get("high-2-0") as any).divisor).toBe(10);
    expect((byId.get("high-2-1") as any).divisor).toBe(1);
    expect((byId.get("high-2-0") as any).slots[0]).toBe(8);
    expect((byId.get("high-2-1") as any).slots[0]).toBe(8);
  });

  it("keeps variantText available via renderMode and per-target overrides", async () => {
    // Whole-assembly glyphs: no bridge needed, classic baseFrame contract.
    const glyphBase = new Uint8Array(BASE_FRAME_BYTES);
    const glyphs = await assembleWidgetUpload({
      dsl: LOCKSTEP_DSL, generation: 9, layouts: LAYOUTS,
      renderMode: "glyphs", baseFrame: glyphBase,
    });
    expect(glyphs.renderModes).toEqual({ status: "glyphs", gear: "glyphs" });
    expect(glyphs.rasterCosts).toEqual([]);
    const glyphFacade = decodeFacade(glyphs, (await decodeUploadContainer(glyphs.binary)).f2tf);
    expect(glyphFacade.targets[1].format).toBe(11);
    expect(glyphFacade.targets[2].format).toBe(11);

    // Per-target override: gear renders as glyphs, status stays raster.
    const bridge = new FakePreview(LAYOUTS, solidBackground);
    const mixed = await assembleWidgetUpload({
      dsl: LOCKSTEP_DSL, generation: 9,
      layouts: { status: LAYOUTS.status, gear: { ...LAYOUTS.gear, renderMode: "glyphs" } },
      capture: bridge,
    });
    expect(mixed.renderModes).toEqual({ status: "raster", gear: "glyphs" });
    const mixedFacade = decodeFacade(mixed, (await decodeUploadContainer(mixed.binary)).f2tf);
    expect(mixedFacade.targets[1].format).toBe(12);
    expect(mixedFacade.targets[2].format).toBe(11);
    // gear's colours entered the palette (glyph path); no colour ops hit it.
    expect(bridge.log.some((op) => op.startsWith("color:gear="))).toBe(false);
    expect(mixedFacade.palette.length).toBeGreaterThanOrEqual(3);
  });
});
