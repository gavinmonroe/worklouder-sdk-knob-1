// The v3 authoring expansion's CAPTURE side (docs/16 "v3 authoring expansion:
// class variants, animations, hidden, digits"), through the same synthetic
// bridge style as widgetAssemblerRaster.test.ts: the fake preview models
// per-target text + inline colour + applied variant class + frozen animation
// delay + visibility, and renders each visible element as a solid rect whose
// colour is a pure function of that state — so every captured byte is
// predictable and the whole choreography (blank → base → per-feature
// set/probe/freeze/capture/restore) is observable through the op log.

import { describe, expect, it } from "vitest";

import {
  assembleWidgetUpload,
  WidgetAssemblyError,
  type VariantCaptureBridge,
} from "../src/compiler/widgetAssembler";
import { decodeUploadContainer } from "../src/compiler/uploadContainer";
import { decodeLzss } from "../src/compiler/lzss";
import { TARGET_FACADE_CONTRACT_V3_SHA256 } from "../src/compiler/f2tfPackage";
import { BASE_FRAME_BYTES, cropRgb565Frame } from "../src/compiler/frameCapture";
import { DEVICE_PIXELS, DEVICE_WIDTH } from "../src/compiler/renderV2Package";

const ROOT = new URL("../../../", import.meta.url).pathname;
const contract = await import(`${ROOT}experiments/mquickjs-target-facade/contract.mjs`);
const HAS_V3_CONTRACT = typeof contract.TARGET_FACADE_CONTRACT_V3_SHA256 === "string";

const BG = 0x1234;
const PLACEHOLDER = "PLACEHOLDER";

interface Rect { x: number; y: number; width: number; height: number }

/** Deterministic ≥0x8000 colour for one element state — never equals BG. */
function colourFor(key: string): number {
  let hash = 2166136261 >>> 0;
  for (const character of key) {
    hash = (hash ^ character.codePointAt(0)!) >>> 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return 0x8000 | (hash & 0x7fff);
}

interface FakeElement {
  rect: Rect;
  /** A styled box paints even with empty text (spinner rings, class boxes). */
  box?: boolean;
  /** Computed CSS animation-name the probe reports; default "none". */
  animationName?: string;
}

/** Synthetic preview covering every v3 bridge operation. */
class FakePreviewV3 implements VariantCaptureBridge {
  texts: Record<string, string> = {};
  colors: Record<string, string> = {};
  classes: Record<string, string> = {};
  frozen: Record<string, string> = {};
  hiddenState: Record<string, boolean> = {};
  log: string[] = [];
  constructor(
    readonly elements: Record<string, FakeElement>,
    readonly background: () => Uint16Array,
  ) {
    for (const id of Object.keys(elements)) this.texts[id] = PLACEHOLDER;
  }
  private require(id: string): FakeElement {
    const element = this.elements[id];
    if (!element) throw new Error(`the fake preview has no element #${id}`);
    return element;
  }
  /** The state key one element's pixels are a function of. */
  stateKey(id: string): string {
    return `${this.texts[id]}|${this.colors[id] ?? ""}|${this.classes[id] ?? ""}|${this.frozen[id] ?? ""}`;
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
  setClass(id: string, variantClass: string): void {
    this.require(id);
    if (variantClass === "") delete this.classes[id];
    else this.classes[id] = variantClass;
    this.log.push(`class:${id}=${variantClass}`);
  }
  setHidden(id: string, hidden: boolean): void {
    this.require(id);
    this.hiddenState[id] = hidden;
    this.log.push(`hidden:${id}=${hidden}`);
  }
  probeAnimation(id: string): string {
    const element = this.require(id);
    this.log.push(`probe:${id}`);
    return element.animationName ?? "none";
  }
  freezeAnimation(id: string, delay: string | null): void {
    this.require(id);
    if (delay === null) delete this.frozen[id];
    else this.frozen[id] = delay;
    this.log.push(`freeze:${id}=${delay === null ? "null" : delay}`);
  }
  captureFrame(): Uint16Array {
    this.log.push("capture");
    const frame = this.background();
    for (const [id, element] of Object.entries(this.elements)) {
      if (this.hiddenState[id]) continue;
      if (!element.box && this.texts[id].length === 0) continue;
      const colour = colourFor(this.stateKey(id));
      const { rect } = element;
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
/** Position-dependent (row + 16px column-block) gradient: byte-for-byte crop
 *  comparisons prove alignment, while long runs keep the base compressible. */
const gradientBackground = () => {
  const frame = new Uint16Array(DEVICE_PIXELS);
  for (let y = 0; y < DEVICE_PIXELS / DEVICE_WIDTH; y += 1) {
    for (let x = 0; x < DEVICE_WIDTH; x += 1) {
      frame[y * DEVICE_WIDTH + x] = 0x0400 | ((y & 0xff) << 3) | (x >> 4);
    }
  }
  return frame;
};

// All four v3 features on one screen (the shape of the "pulse" preset):
// badge = className+textContent in proven lockstep, spinner = 8-frame CSS
// animation sample, count = 3-digit composition, toast = constant text with a
// hidden write.
const V3_DSL = `var state = 0;
var count = 0;
var toastOn = 1;

widget.animate("#spinner", 8);

widget.on("input.fn-bottom-knob", function (event) {
  state = mod(state + event.delta, 3);
  document.querySelector("#badge").className = pick(state, "state-ok", "state-warn", "state-err");
  document.querySelector("#badge").textContent = pick(state, "READY", "BUSY", "ALERT");
});

widget.on("input.key.down", function (event) {
  count = clamp(count + 1, 0, 999);
  document.querySelector("#count").textContent = digits(count, 3);
});

widget.on("host.rpc:0xB201", function (event) {
  toastOn = mod(event.value, 2);
  document.querySelector("#toast").textContent = pick(0, "SYNCED");
  document.querySelector("#toast").hidden = mod(toastOn + 1, 2);
});
`;

const BADGE_TEXTS = ["READY", "BUSY", "ALERT"];
const BADGE_CLASSES = ["state-ok", "state-warn", "state-err"];

const LAYOUTS = {
  badge: { x: 10, y: 96, width: 60, height: 22 },
  spinner: { x: 38, y: 18, width: 24, height: 24 },
  toast: { x: 12, y: 214, width: 76, height: 20 },
  // width 32 does not divide by 3: cells split 10 + 10 + 12 (remainder LAST).
  count: { x: 34, y: 150, width: 32, height: 40 },
};

function v3Elements(): Record<string, FakeElement> {
  return {
    badge: { rect: LAYOUTS.badge },
    spinner: { rect: LAYOUTS.spinner, box: true, animationName: "pulse-spin" },
    toast: { rect: LAYOUTS.toast },
    count: { rect: LAYOUTS.count },
  };
}

async function assembleV3(bridge: FakePreviewV3) {
  return assembleWidgetUpload({ dsl: V3_DSL, generation: 9, layouts: LAYOUTS, capture: bridge });
}

function decodeFacade(assembled: { sections: { f2js: { sha256: string } } }, f2tf: Uint8Array) {
  return contract.decodeTargetFacadeAsset(Buffer.from(f2tf), {
    expectedGeneration: 9,
    expectedF2jsSha256: assembled.sections.f2js.sha256,
    expectedContractSha256: TARGET_FACADE_CONTRACT_V3_SHA256,
  });
}

describe("v3 class-swap capture", () => {
  it("applies class+text per variant, captures, and restores the authored className", async () => {
    const bridge = new FakePreviewV3(v3Elements(), solidBackground);
    await assembleV3(bridge);

    // Every lockstep variant was captured WITH its class applied: the ops for
    // variant k are text, class, capture, in that order, back to back.
    for (let variant = 0; variant < 3; variant += 1) {
      const at = bridge.log.indexOf(`text:badge=${BADGE_TEXTS[variant]}`);
      expect(at).toBeGreaterThan(-1);
      expect(bridge.log[at + 1]).toBe(`class:badge=${BADGE_CLASSES[variant]}`);
      expect(bridge.log[at + 2]).toBe("capture");
    }
    // After the last variant the target is re-blanked AND the authored
    // className restored (setClass "") before any other target's captures.
    const lastVariant = bridge.log.indexOf(`class:badge=${BADGE_CLASSES[2]}`);
    expect(bridge.log[lastVariant + 2]).toBe("text:badge=");
    expect(bridge.log[lastVariant + 3]).toBe("class:badge=");
  });

  it.runIf(HAS_V3_CONTRACT)("ships one raster per lockstep variant on the text slot, class pixels applied", async () => {
    const bridge = new FakePreviewV3(v3Elements(), solidBackground);
    const assembled = await assembleV3(bridge);
    const decoded = await decodeUploadContainer(assembled.binary);
    const facade = decodeFacade(assembled, decoded.f2tf);
    const byId = new Map(facade.targets.map((target: { id: string }) => [target.id, target]));
    const badge = byId.get("badge") as any;
    expect(badge.format).toBe(12);
    expect(badge.slots[0]).toBe(2); // textSlot (classSlot 1 carries the same value)
    expect(badge.rasters.length).toBe(3);
    BADGE_TEXTS.forEach((text, variant) => {
      expect(badge.rasters[variant].readUInt16LE(0))
        .toBe(colourFor(`${text}||${BADGE_CLASSES[variant]}|`));
    });
  });

  it("captures a class-only target's variants bound to its class slot", async () => {
    const dsl = `var s = 0;
widget.on("tick.1s", function (event) {
  s = mod(s + 1, 2);
  document.querySelector("#lamp").className = pick(s, "lamp-on", "lamp-off");
});
`;
    const layouts = { lamp: { x: 5, y: 5, width: 20, height: 10 } };
    const bridge = new FakePreviewV3({ lamp: { rect: layouts.lamp, box: true } }, solidBackground);
    const assembled = await assembleWidgetUpload({ dsl, generation: 9, layouts, capture: bridge });
    // No text table: the element is never text-blanked (its authored content
    // is part of every variant), only class-swapped and restored.
    expect(bridge.log).toEqual([
      "capture",              // base (lamp paints its authored box — no blanking op)
      "class:lamp=lamp-on", "capture",
      "class:lamp=lamp-off", "capture",
      "class:lamp=",
    ]);
    expect(assembled.rasterCosts).toEqual([
      { id: "lamp", variants: 2, width: 20, height: 10, bytes: 2 * 20 * 10 * 2 },
    ]);
    if (HAS_V3_CONTRACT) {
      const facade = decodeFacade(assembled, (await decodeUploadContainer(assembled.binary)).f2tf);
      const lamp = facade.targets[1];
      expect(lamp.slots[0]).toBe(1); // the class slot owns the pick
      expect(lamp.rasters[0].readUInt16LE(0)).toBe(colourFor(`${PLACEHOLDER}||lamp-on|`));
      expect(lamp.rasters[1].readUInt16LE(0)).toBe(colourFor(`${PLACEHOLDER}||lamp-off|`));
    }
  });

  it("refuses a pre-v3 bridge (no setClass) by naming the missing operation", async () => {
    const bridge = new FakePreviewV3(v3Elements(), solidBackground);
    (bridge as { setClass?: unknown }).setClass = undefined;
    await expect(assembleV3(bridge)).rejects.toThrow(/does not implement setClass\(\)/);
  });
});

describe("v3 animation frame capture", () => {
  it("probes the animation, freezes each 10fps frame, captures, and removes the overrides", async () => {
    const bridge = new FakePreviewV3(v3Elements(), solidBackground);
    await assembleV3(bridge);
    const probeAt = bridge.log.indexOf("probe:spinner");
    expect(probeAt).toBeGreaterThan(-1);
    const expected: string[] = [];
    for (let frame = 0; frame < 8; frame += 1) {
      expected.push(`freeze:spinner=-${frame / 10}s`, "capture");
    }
    expected.push("freeze:spinner=null");
    expect(bridge.log.slice(probeAt + 1, probeAt + 1 + expected.length)).toEqual(expected);
  });

  it.runIf(HAS_V3_CONTRACT)("ships `frames` rasters in frame order on the animation slot", async () => {
    const bridge = new FakePreviewV3(v3Elements(), solidBackground);
    const assembled = await assembleV3(bridge);
    const facade = decodeFacade(assembled, (await decodeUploadContainer(assembled.binary)).f2tf);
    const byId = new Map(facade.targets.map((target: { id: string }) => [target.id, target]));
    const spinner = byId.get("spinner") as any;
    expect(spinner.format).toBe(12);
    expect(spinner.slots[0]).toBe(5); // allocated after every DOM-write slot
    expect(spinner.rasters.length).toBe(8);
    for (let frame = 0; frame < 8; frame += 1) {
      expect(spinner.rasters[frame].readUInt16LE(0))
        .toBe(colourFor(`${PLACEHOLDER}|||-${frame / 10}s`));
    }
  });

  it("refuses an element with no computed CSS animation, naming the id", async () => {
    const elements = v3Elements();
    elements.spinner.animationName = "none";
    const bridge = new FakePreviewV3(elements, solidBackground);
    const failure = await assembleV3(bridge).catch((cause) => cause as WidgetAssemblyError);
    expect(failure).toBeInstanceOf(WidgetAssemblyError);
    expect(failure.message).toMatch(/"#spinner"/);
    expect(failure.message).toMatch(/computed\s+animation-name is "none"/);
    // The refusal happened at the probe: no frame was ever frozen.
    expect(bridge.log.some((op) => op.startsWith("freeze:"))).toBe(false);
  });
});

describe("v3 hidden variant", () => {
  it("visibility-blanks the target for the base and appends the base crop byte-for-byte", async () => {
    const bridge = new FakePreviewV3(v3Elements(), gradientBackground);
    const assembled = await assembleV3(bridge);

    // Choreography: blanked (text + visibility) BEFORE the base capture;
    // unhidden for its own content captures; re-hidden after.
    const firstCapture = bridge.log.indexOf("capture");
    expect(bridge.log.slice(0, firstCapture)).toEqual([
      "text:badge=", "text:toast=", "text:count=", "hidden:toast=true",
    ]);
    const unhide = bridge.log.indexOf("hidden:toast=false");
    expect(unhide).toBeGreaterThan(firstCapture);
    expect(bridge.log.indexOf("hidden:toast=true", unhide)).toBeGreaterThan(
      bridge.log.indexOf("text:toast=SYNCED"));

    // The shipped table is [content, hidden], and the hidden raster is the
    // decoded base's own crop of the toast rect, byte for byte.
    const decoded = await decodeUploadContainer(assembled.binary);
    const baseBytes = decodeLzss(decoded.lzss, BASE_FRAME_BYTES);
    const base16 = new Uint16Array(BASE_FRAME_BYTES / 2);
    for (let index = 0; index < base16.length; index += 1) {
      base16[index] = baseBytes[index * 2] | (baseBytes[index * 2 + 1] << 8);
    }
    const expectedPatch = cropRgb565Frame(base16, LAYOUTS.toast);
    if (HAS_V3_CONTRACT) {
      const facade = decodeFacade(assembled, decoded.f2tf);
      const byId = new Map(facade.targets.map((target: { id: string }) => [target.id, target]));
      const toast = byId.get("toast") as any;
      expect(toast.format).toBe(12);
      expect(toast.slots[0]).toBe(4); // the text slot carries the hidden state
      expect(toast.rasters.length).toBe(2);
      expect(toast.rasters[0].readUInt16LE(0)).toBe(colourFor("SYNCED|||"));
      const hiddenRaster: Buffer = toast.rasters[1];
      expect(hiddenRaster.length).toBe(expectedPatch.length * 2);
      for (let pixel = 0; pixel < expectedPatch.length; pixel += 1) {
        expect(hiddenRaster.readUInt16LE(pixel * 2)).toBe(expectedPatch[pixel]);
      }
    }
  });

  it("enforces content + hidden ≤ 16 with the split named", async () => {
    const sixteen = Array.from({ length: 16 }, (_, index) => `"V${index}"`).join(", ");
    const dsl = `var v = 0;
widget.on("host.rpc:0xB201", function (event) {
  v = mod(event.value, 16);
  document.querySelector("#gauge").textContent = pick(v, ${sixteen});
  document.querySelector("#gauge").hidden = mod(event.value, 2);
});
`;
    const layouts = { gauge: { x: 0, y: 0, width: 40, height: 10 } };
    const bridge = new FakePreviewV3({ gauge: { rect: layouts.gauge } }, solidBackground);
    const failure = await assembleWidgetUpload({ dsl, generation: 9, layouts, capture: bridge })
      .catch((cause) => cause as WidgetAssemblyError);
    expect(failure).toBeInstanceOf(WidgetAssemblyError);
    expect(failure.message).toMatch(/16 content variants plus its hidden variant = 17 rasters/);
    expect(failure.message).toMatch(/content \+ hidden/);
    // Refused before any pixel work.
    expect(bridge.log).toEqual([]);
  });
});

describe("v3 digit composition", () => {
  it("captures ten repeated-digit frames and crops every cell from each", async () => {
    const bridge = new FakePreviewV3(v3Elements(), solidBackground);
    await assembleV3(bridge);
    // Exactly ten digit captures — "000".."999" — then the re-blank.
    const digitOps = bridge.log.filter((op) => /^text:count=\d+$/.test(op));
    expect(digitOps).toEqual(Array.from({ length: 10 }, (_, digit) => `text:count=${String(digit).repeat(3)}`));
    for (let digit = 0; digit <= 9; digit += 1) {
      const at = bridge.log.indexOf(`text:count=${String(digit).repeat(3)}`);
      expect(bridge.log[at + 1]).toBe("capture");
    }
    const lastDigit = bridge.log.indexOf("text:count=999");
    expect(bridge.log[lastDigit + 2]).toBe("text:count=");
  });

  it.runIf(HAS_V3_CONTRACT)("splits the rect into equal cells (remainder last) bound to the per-digit slots", async () => {
    const bridge = new FakePreviewV3(v3Elements(), solidBackground);
    const assembled = await assembleV3(bridge);
    const facade = decodeFacade(assembled, (await decodeUploadContainer(assembled.binary)).f2tf);
    const byId = new Map(facade.targets.map((target: { id: string }) => [target.id, target]));
    // 32px over 3 cells: 10 + 10 + 12 (integer boundaries, remainder LAST).
    // Shared-slot mode: ONE slot (3) carries the raw value; per-cell divisors
    // extract each display digit on-device (leftmost = highest power of ten).
    const cells = [
      { id: "count-0", x: 34, width: 10, slot: 3, divisor: 100 },
      { id: "count-1", x: 44, width: 10, slot: 3, divisor: 10 },
      { id: "count-2", x: 54, width: 12, slot: 3, divisor: 1 },
    ];
    for (const cell of cells) {
      const target = byId.get(cell.id) as any;
      expect(target).toBeDefined();
      expect(target.format).toBe(13);
      expect(target.divisor).toBe(cell.divisor);
      expect(target.x).toBe(cell.x);
      expect(target.y).toBe(150);
      expect(target.width).toBe(cell.width);
      expect(target.height).toBe(40);
      expect(target.slots[0]).toBe(cell.slot);
      expect(target.rasters.length).toBe(10);
      // Every cell's variant d came from the SAME "ddd" capture.
      for (let digit = 0; digit <= 9; digit += 1) {
        expect(target.rasters[digit].readUInt16LE(0))
          .toBe(colourFor(`${String(digit).repeat(3)}|||`));
      }
    }
    // 10 captures produced 30 variants: itemized as digit rasters.
    expect(assembled.rasterCosts.filter((cost) => cost.id.startsWith("count-"))).toEqual([
      { id: "count-0", variants: 10, width: 10, height: 40, bytes: 10 * 10 * 40 * 2 },
      { id: "count-1", variants: 10, width: 10, height: 40, bytes: 10 * 10 * 40 * 2 },
      { id: "count-2", variants: 10, width: 12, height: 40, bytes: 10 * 12 * 40 * 2 },
    ]);
  });

  it.runIf(HAS_V3_CONTRACT)("renders through the SDK pixel oracle: digits, class, animation, hidden", async () => {
    const bridge = new FakePreviewV3(v3Elements(), solidBackground);
    const assembled = await assembleV3(bridge);
    const facade = decodeFacade(assembled, (await decodeUploadContainer(assembled.binary)).f2tf);
    const baseFrame = new Uint16Array(DEVICE_PIXELS).fill(BG);
    const slots = Array(16).fill(0);
    slots[0] = 1;      // publication revision
    slots[1] = 2;      // badge class pick (lockstep with…
    slots[2] = 2;      // …its text slot): ALERT / state-err
    slots[3] = 429;    // count: raw value; divisors render 4 / 2 / 9
    slots[4] = 1;      // toast: the hidden variant
    slots[5] = 5;      // spinner: frame 5
    const { result, frame } = contract.renderTargetFacadeHost({
      decoded: facade,
      baseFrame,
      mailbox: { sequence: 2, sequenceAfter: 2, slots, admittedGeneration: 9 },
      state: { lastAppliedRevision: 0 },
      expectedGeneration: 9,
    });
    expect(result).toBe(contract.TARGET_FACADE_RESULT.ok);
    const at = (x: number, y: number) => frame[y * DEVICE_WIDTH + x];
    expect(at(11, 100)).toBe(colourFor("ALERT||state-err|"));          // badge
    expect(at(35, 155)).toBe(colourFor("444|||"));                     // count-0 ← digit 4
    expect(at(45, 155)).toBe(colourFor("222|||"));                     // count-1 ← digit 2
    expect(at(60, 155)).toBe(colourFor("999|||"));                     // count-2 ← digit 9
    expect(at(40, 20)).toBe(colourFor(`${PLACEHOLDER}|||-0.5s`));      // spinner frame 5
    expect(at(13, 215)).toBe(BG);                                      // toast hidden = base patch
  });
});

describe("v3 budget itemization and glyphs-mode refusals", () => {
  it("labels class/animation/hidden/digit rasters in the container budget diagnostic", async () => {
    // Incompressible base + ~55 KB of rasters: under the 65,536-byte F2TF cap
    // but over the 98,304-byte container.
    const noise = () => {
      const frame = new Uint16Array(DEVICE_PIXELS);
      for (let index = 0; index < frame.length; index += 1) {
        frame[index] = Math.imul(index + 1, 2654435761) >>> 16;
      }
      return frame;
    };
    const layouts = {
      badge: { x: 0, y: 0, width: 100, height: 34 },
      spinner: { x: 0, y: 40, width: 30, height: 20 },
      toast: { x: 0, y: 70, width: 100, height: 30 },
      count: { x: 0, y: 110, width: 33, height: 20 },
    };
    const elements: Record<string, FakeElement> = {
      badge: { rect: layouts.badge },
      spinner: { rect: layouts.spinner, box: true, animationName: "spin" },
      toast: { rect: layouts.toast },
      count: { rect: layouts.count },
    };
    const bridge = new FakePreviewV3(elements, noise);
    const failure = await assembleWidgetUpload({
      dsl: V3_DSL, generation: 9, layouts, capture: bridge,
    }).catch((cause) => cause as WidgetAssemblyError);
    expect(failure).toBeInstanceOf(WidgetAssemblyError);
    expect(failure.message).toMatch(/exceeds the 98304-byte \(96 KiB\) upload container/);
    expect(failure.message).toMatch(/"#badge" \[class\] 3 variants × 100×34px × 2 B = 20400 bytes/);
    expect(failure.message).toMatch(/"#toast" \[hidden\] 2 variants × 100×30px × 2 B = 12000 bytes/);
    expect(failure.message).toMatch(/"#spinner" \[animation\] 8 variants × 30×20px × 2 B = 9600 bytes/);
    expect(failure.message).toMatch(/"#count-0" \[digit\] 10 variants × 11×20px × 2 B = 4400 bytes/);
  });

  it("refuses every v3 feature under renderMode glyphs with the feature named", async () => {
    const glyphBase = new Uint8Array(BASE_FRAME_BYTES);
    const failure = await assembleWidgetUpload({
      dsl: V3_DSL, generation: 9, layouts: LAYOUTS, renderMode: "glyphs", baseFrame: glyphBase,
    }).catch((cause) => cause as WidgetAssemblyError);
    expect(failure).toBeInstanceOf(WidgetAssemblyError);
    expect(failure.message).toMatch(/"#badge" uses className variants/);
    expect(failure.message).toMatch(/renderMode "glyphs" cannot express/);

    const digitsOnly = `var n = 0;
widget.on("tick.1s", function (event) {
  n = clamp(n + 1, 0, 99);
  document.querySelector("#num").textContent = digits(n, 2);
});
`;
    await expect(assembleWidgetUpload({
      dsl: digitsOnly, generation: 9,
      layouts: { num: { x: 0, y: 0, width: 12, height: 8 } },
      renderMode: "glyphs", baseFrame: glyphBase,
    })).rejects.toThrow(/"#num" uses digits\(\) composition.*glyphs/s);

    // A per-target glyphs override is refused the same way.
    const bridge = new FakePreviewV3(v3Elements(), solidBackground);
    await expect(assembleWidgetUpload({
      dsl: V3_DSL, generation: 9,
      layouts: { ...LAYOUTS, spinner: { ...LAYOUTS.spinner, renderMode: "glyphs" as const } },
      capture: bridge,
    })).rejects.toThrow(/"#spinner" uses widget\.animate sampling.*glyphs/s);
  });
});
