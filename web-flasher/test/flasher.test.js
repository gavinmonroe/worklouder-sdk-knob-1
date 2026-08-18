import { describe, expect, it } from "vitest";

import { assertWritableRegions, readBootloaderState } from "../src/lib/flasher.js";

const page = (address, length) => ({
  address,
  kind: "page",
  bytes: new Uint8Array(length).fill(1),
  sha256: "a".repeat(64),
});
const app = () => ({
  address: 0x10000,
  kind: "app",
  bytes: new Uint8Array(64).fill(2),
  sha256: "c".repeat(64),
});

describe("Web Serial bootloader access", () => {
  it("runs identity commands sequentially so the WritableStream is never double-locked", async () => {
    const order = [];
    let activeCommands = 0;
    let maximumConcurrentCommands = 0;
    const command = async (name, value) => {
      activeCommands += 1;
      maximumConcurrentCommands = Math.max(maximumConcurrentCommands, activeCommands);
      order.push(name);
      await Promise.resolve();
      activeCommands -= 1;
      return value;
    };
    let registerIndex = 0;
    const loader = {
      chip: {
        CHIP_NAME: "ESP32-S3",
        readMac: () => command("mac", "a4:cb:8f:af:32:10"),
      },
      detectFlashSize: () => command("flash-size", "16MB"),
      readReg: () => command(`register-${registerIndex += 1}`, 0),
    };

    await expect(readBootloaderState(loader)).resolves.toMatchObject({
      chipName: "ESP32-S3",
      macAddress: "a4:cb:8f:af:32:10",
      flashSize: "16MB",
    });
    expect(maximumConcurrentCommands).toBe(1);
    expect(order).toEqual(["mac", "flash-size", "register-1", "register-2"]);
  });
});

describe("write-scope guard", () => {
  it("accepts module pages followed by the app image", () => {
    const plan = [page(0x210000, 32), page(0x230000, 16), app()];
    expect(assertWritableRegions(plan)).toBe(plan);
    expect(plan.map(({ address }) => address)).toEqual([0x210000, 0x230000, 0x10000]);
  });

  it("accepts the unchanged single-app plan", () => {
    expect(() => assertWritableRegions([app()])).not.toThrow();
  });

  it("refuses anything that is not an ordered, approved plan", () => {
    expect(() => assertWritableRegions([])).toThrow(/No verified flash region/u);
    expect(() => assertWritableRegions(null)).toThrow(/No verified flash region/u);
    expect(() => assertWritableRegions([page(0x210000, 32)])).toThrow(/exactly one verified app region/iu);
    expect(() => assertWritableRegions([app(), app()])).toThrow(/exactly one verified app region/iu);
    // The app must never precede a module page it depends on.
    expect(() => assertWritableRegions([app(), page(0x210000, 32)])).toThrow(/must be written last/u);
    expect(() => assertWritableRegions([page(0x8000, 32), app()])).toThrow(/outside the approved write scope/u);
    expect(() => assertWritableRegions([page(0x0, 32), app()])).toThrow(/outside the approved write scope/u);
    expect(() => assertWritableRegions([page(0x210000, 32), page(0x210000, 32), app()])).toThrow(/queued twice/u);
    expect(() => assertWritableRegions([{ ...app(), address: 0x230000 }])).toThrow(/must be written at 0x10000/u);
    expect(() => assertWritableRegions([{ ...page(0x210000, 0) }, app()])).toThrow(/verified bytes/u);
    expect(() => assertWritableRegions([{ address: 0x210000, kind: "page", bytes: [1, 2] }, app()])).toThrow(
      /verified bytes/u,
    );
  });
});
