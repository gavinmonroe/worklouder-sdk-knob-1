// A keyboard we cannot write to over HID must still be installable.
//
// This is the Knob 1 case: on macOS every HID output report to it is refused,
// so the "restart into update mode" RPC can never land — but the two buttons
// beside its spacebar reach ROM download mode with no HID involved, and the
// flash itself runs over Web Serial, which the block does not touch. The whole
// fix is that installWidgetFirmware accepts a null client and skips straight to
// the port picker, so this asserts exactly that: no RPC attempted, still flashed.

import { beforeEach, describe, expect, it, vi } from "vitest";

const flashRegions = vi.fn(async () => ({ ok: true }));
const requestBootloaderPort = vi.fn(async () => ({ port: "fake" }));

vi.mock("@flasher/src/lib/flasher.js", () => ({
  browserCapabilities: () => ({ webSerial: true }),
  assertWritableRegions: () => {},
  flashRegions: (...args: unknown[]) => flashRegions(...(args as [])),
  requestBootloaderPort: () => requestBootloaderPort(),
}));

vi.mock("@flasher/src/lib/firmware.js", () => ({
  formatRegionAddress: (a: number) => `0x${a.toString(16)}`,
  loadFlashPlan: async () => ({
    multiRegion: true,
    regions: [
      { address: 0x10000, kind: "app", label: "app", bytes: new Uint8Array(4), sha256: "a".repeat(64) },
    ],
  }),
}));

const { installWidgetFirmware } = await import("../src/device/firmwareInstall");

describe("installing without a usable HID connection", () => {
  beforeEach(() => {
    flashRegions.mockClear();
    requestBootloaderPort.mockClear();
    vi.stubGlobal("window", { isSecureContext: true });
  });

  it("skips the restart RPC entirely when there is no client, and still writes", async () => {
    const result = await installWidgetFirmware(null);
    expect(requestBootloaderPort).toHaveBeenCalledTimes(1);
    expect(flashRegions).toHaveBeenCalledTimes(1);
    expect(result.regions).toBe(1);
  });

  it("does not tell the user to wait for a restart that will never happen", async () => {
    const log: string[] = [];
    await installWidgetFirmware(null, { onLog: (line) => log.push(line) });
    expect(log.join(" ")).not.toMatch(/restart|update mode/iu);
    expect(log.join(" ")).toMatch(/Choose the keyboard's update port/u);
  });

  it("still asks a live keyboard to restart when one is connected", async () => {
    const enterBootloader = vi.fn(async () => undefined);
    await installWidgetFirmware({ enterBootloader });
    expect(enterBootloader).toHaveBeenCalledTimes(1);
    expect(flashRegions).toHaveBeenCalledTimes(1);
  });

  it("carries on to the port picker when a connected keyboard refuses the restart", async () => {
    // The Knob 1 that is blocked mid-session, rather than blocked at connect.
    const enterBootloader = vi.fn(async () => { throw new Error("Failed to write the report."); });
    const log: string[] = [];
    await installWidgetFirmware({ enterBootloader }, { onLog: (line) => log.push(line) });
    expect(flashRegions).toHaveBeenCalledTimes(1);
    expect(log.join(" ")).toMatch(/didn't take the restart command/u);
  });
});
