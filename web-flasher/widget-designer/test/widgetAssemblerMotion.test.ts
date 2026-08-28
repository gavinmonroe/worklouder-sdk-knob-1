import { describe, expect, it } from "vitest";

import {
  assembleWidgetUpload,
  type VariantCaptureBridge,
  type WidgetMotionTargetSource,
} from "../src/compiler/widgetAssembler";
import {
  TARGET_FACADE_CONTRACT_V4_SHA256,
  TARGET_FACADE_CONTRACT_V5_SHA256,
} from "../src/compiler/f2tfPackage";
import { decodeUploadContainer } from "../src/compiler/uploadContainer";
import { DEVICE_PIXELS } from "../src/compiler/renderV2Package";

const ROOT = new URL("../../../", import.meta.url).pathname;
const contract = await import(`${ROOT}experiments/mquickjs-target-facade/contract.mjs`);

const classes = Array.from({ length: 32 }, (_, index) => `p${index}`);
const pick = (state: string) => `pick(${state}, ${classes.map((name) => `"${name}"`).join(", ")})`;
const DSL = `var a = 0; var b = 0; var c = 0;
widget.on("tick.1ms", function (event) {
  a = mod(a + 1, 32); b = mod(b + 1, 32); c = mod(c + 1, 32);
  document.querySelector("#cloud1").className = ${pick("a")};
  document.querySelector("#cloud2").className = ${pick("b")};
  document.querySelector("#cloud3").className = ${pick("c")};
});`;

function motion(
  width: number,
  height: number,
  y: number,
  tweenMs?: number,
): WidgetMotionTargetSource {
  const colors = new Uint16Array(width * height);
  const alpha = new Uint8Array(width * height);
  for (let pixel = 0; pixel < colors.length; pixel += 1) {
    colors[pixel] = (0x4000 + pixel * 17) & 0xffff;
    alpha[pixel] = pixel % 5 === 0 ? 128 : 255;
  }
  return {
    width, height, colors, alpha,
    positions: Array.from({ length: 32 }, (_, index) => ({
      x: Math.round(-width + (100 + width) * index / 31), y,
    })),
    tweenMs,
  };
}

class MotionPreview implements VariantCaptureBridge {
  hidden: Record<string, boolean> = {};
  setText(): void {}
  setColor(): void {}
  setHidden(id: string, hidden: boolean): void { this.hidden[id] = hidden; }
  captureFrame(): Uint16Array { return new Uint16Array(DEVICE_PIXELS).fill(0x001f); }
}

describe("v4 compact sprite motion assembly", () => {
  it("ships three original-size clouds with 32 positions below the existing caps", async () => {
    const motionTargets = {
      cloud1: motion(44, 44, 38),
      cloud2: motion(58, 23, 132),
      cloud3: motion(40, 23, 226),
    };
    const assembled = await assembleWidgetUpload({
      dsl: DSL,
      generation: 4,
      layouts: {
        cloud1: { x: 0, y: 0, width: 44, height: 44 },
        cloud2: { x: 0, y: 0, width: 58, height: 23 },
        cloud3: { x: 0, y: 0, width: 40, height: 23 },
      },
      motionTargets,
      capture: new MotionPreview(),
    });
    expect(assembled.sections.f2tf.bytes).toBeLessThan(65_536);
    expect(assembled.bytes).toBeLessThan(98_304);
    expect(assembled.rasterCosts.map((cost) => cost.variants)).toEqual([32, 32, 32]);
    expect(assembled.rasterCosts.every((cost) => cost.encoding === "sprite-motion")).toBe(true);
    expect(assembled.rasterCosts.reduce((sum, cost) => sum + cost.bytes, 0)).toBe(12_978);

    const container = await decodeUploadContainer(assembled.binary);
    const decoded = contract.decodeTargetFacadeAsset(Buffer.from(container.f2tf), {
      expectedGeneration: 4,
      expectedF2jsSha256: assembled.sections.f2js.sha256,
      expectedContractSha256: TARGET_FACADE_CONTRACT_V4_SHA256,
    });
    expect(decoded.targets.slice(1, 4).map((target: { format: number }) => target.format))
      .toEqual([14, 14, 14]);
    const rendered = contract.renderTargetFacadeHost({
      decoded,
      baseFrame: new Uint16Array(DEVICE_PIXELS).fill(0x001f),
      mailbox: { sequence: 2, admittedGeneration: 4,
        slots: [1, 0, 15, 31, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
      state: { lastAppliedRevision: 0 }, expectedGeneration: 4,
    });
    expect(rendered.result).toBe(contract.TARGET_FACADE_RESULT.ok);
    expect(rendered.metrics.overlayWrites).toBeGreaterThan(0);

  });

  it("keeps the 16-state ceiling for class targets that are not proven image motion", async () => {
    const ordinary = Array.from({ length: 17 }, (_, index) => `"s${index}"`).join(", ");
    const dsl = `var i = 0;
widget.on("tick.1s", function (event) {
  document.querySelector("#panel").className = pick(i, ${ordinary});
});`;
    await expect(assembleWidgetUpload({
      dsl, generation: 4,
      layouts: { panel: { x: 0, y: 0, width: 20, height: 20 } },
      capture: new MotionPreview(),
    })).rejects.toThrow("at most 16");
  });
});

describe("v5 smooth sprite motion assembly", () => {
  it("stores one sprite and lets the native renderer interpolate between positions", async () => {
    const motionTargets = {
      cloud1: motion(44, 44, 38, 180),
      cloud2: motion(58, 23, 132, 250),
      cloud3: motion(40, 23, 226, 330),
    };
    const assembled = await assembleWidgetUpload({
      dsl: DSL,
      generation: 5,
      layouts: {
        cloud1: { x: 0, y: 0, width: 44, height: 44 },
        cloud2: { x: 0, y: 0, width: 58, height: 23 },
        cloud3: { x: 0, y: 0, width: 40, height: 23 },
      },
      motionTargets,
      capture: new MotionPreview(),
    });
    expect(assembled.sections.f2tf.bytes).toBeLessThan(65_536);
    expect(assembled.bytes).toBeLessThan(98_304);
    expect(assembled.rasterCosts.every((cost) => cost.encoding === "sprite-tween"))
      .toBe(true);

    const container = await decodeUploadContainer(assembled.binary);
    const decoded = contract.decodeTargetFacadeAsset(Buffer.from(container.f2tf), {
      expectedGeneration: 5,
      expectedF2jsSha256: assembled.sections.f2js.sha256,
      expectedContractSha256: TARGET_FACADE_CONTRACT_V5_SHA256,
    });
    expect(decoded.targets.slice(1, 4).map((target: { format: number }) => target.format))
      .toEqual([15, 15, 15]);
    expect(decoded.targets.slice(1, 4).map(
      (target: { sprite: { durationMs: number } }) => target.sprite.durationMs,
    ))
      .toEqual([180, 250, 330]);
  });
});
