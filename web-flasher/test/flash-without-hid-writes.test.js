import { describe, expect, it } from "vitest";

import {
  assertBootloaderIdentity,
  assertBootloaderRecoveryTarget,
  createNormalFramerIdentity,
} from "../src/lib/device-identity.js";

/**
 * Some hosts refuse every HID write to this keyboard. On macOS the vendor collection
 * shares an interface with a Keyboard collection, so the whole IOHIDDevice inherits the
 * keyboard restriction and every report id is denied to an unprivileged process.
 *
 * That must not make the keyboard unflashable. The write itself goes over serial, which
 * is not blocked, and identity comes from the USB descriptor rather than from any write.
 */
describe("flashing a keyboard whose HID writes are refused", () => {
  const healthy = {
    chipName: "ESP32-S3",
    flashSize: "16MB",
    security: { secureBoot: false, flashEncryption: false },
  };

  it("builds a serial-backed identity from the descriptor alone, with no write", () => {
    // Exactly what navigator.hid hands back before anything is sent to the device.
    const descriptorOnly = {
      vendorId: 0x303a,
      productId: 0x8396,
      serialNumber: "B43A452421F8",
      collections: [{ usagePage: 0xff00 }],
    };
    const identity = createNormalFramerIdentity(descriptorOnly, 1);
    expect(identity).toMatchObject({ mode: "hid-serial", productId: 0x8396 });

    // And it still pins the bootloader to this exact keyboard by MAC.
    expect(assertBootloaderIdentity({
      ...healthy,
      normalIdentity: identity,
      macAddress: "b4:3a:45:24:21:f8",
    })).toBe(true);
    expect(() => assertBootloaderIdentity({
      ...healthy,
      normalIdentity: identity,
      macAddress: "00:11:22:33:44:55",
    })).toThrow(/MAC does not match/u);
  });

  it("still gates the hardware when no normal-mode identity exists at all", () => {
    // flashRegions takes this branch for a caller that passes normalIdentity: null.
    // The chip, flash size and security state are all still verified.
    expect(assertBootloaderRecoveryTarget(healthy)).toBe(true);
    expect(() => assertBootloaderRecoveryTarget({ ...healthy, chipName: "ESP32-C3" }))
      .toThrow(/Expected ESP32-S3/u);
    expect(() => assertBootloaderRecoveryTarget({ ...healthy, flashSize: "8MB" }))
      .toThrow(/16MB/u);
    expect(() => assertBootloaderRecoveryTarget({
      ...healthy,
      security: { secureBoot: true, flashEncryption: false },
    })).toThrow(/Secure Boot/u);
  });

  it("rejects a null identity when one is asserted, which is why the branch is needed", () => {
    // Before flashRegions branched, this is what every caller without an identity hit --
    // after the bootloader had already passed every hardware check above.
    expect(() => assertBootloaderIdentity({ ...healthy, normalIdentity: null, macAddress: "b4:3a:45:24:21:f8" }))
      .toThrow(/Normal-mode Framer identity is unavailable/u);
  });
});
