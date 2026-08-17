import { describe, expect, it } from "vitest";

import { readBootloaderState } from "../src/lib/flasher.js";

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
