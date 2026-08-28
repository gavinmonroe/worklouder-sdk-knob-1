import { describe, expect, it } from "vitest";

import {
  assertBootloaderIdentity,
  assertBootloaderRecoveryTarget,
  assertNormalFramerDevice,
  createNormalFramerIdentity,
  framerLayout,
  framerModelName,
  isFramerProductId,
  normalizeSerial,
  serialMatchesMac,
} from "../src/lib/device-identity.js";

describe("Framer identity gates", () => {
  const deviceWithoutSerial = {
    vendorId: 0x303a,
    productId: 0x8396,
    serialNumber: "",
    collections: [{ usagePage: 0xff00 }],
  };

  it("matches the normal HID serial to the ROM MAC", () => {
    expect(normalizeSerial("A4CB8FAF3210")).toBe("a4cb8faf3210");
    expect(serialMatchesMac("A4CB8FAF3210", "a4:cb:8f:af:32:10")).toBe(true);
  });

  it("knows both Framer F1 layouts", () => {
    expect(framerLayout(0x8396)).toBe("ANSI");
    expect(framerLayout(0x8397)).toBe("ISO");
  });

  it("accepts the Knob1 variants that share the 0.4.1 image", () => {
    // Same firmware image, two product variants: the 0.4.1 app carries both
    // "Framer F1" and "knob1" identity strings at app offset 0x12c.
    expect(isFramerProductId(0x8296)).toBe(true);
    expect(isFramerProductId(0x82e3)).toBe(true);
    expect(framerLayout(0x8296)).toBe("ANSI");
    expect(framerLayout(0x82e3)).toBe("ISO");
  });

  it("names the detected model rather than assuming Framer F1", () => {
    expect(framerModelName(0x8396)).toBe("Framer F1");
    expect(framerModelName(0x8296)).toBe("Knob1");
    expect(framerModelName(0x1234)).toBe("Unknown Work Louder device");
  });

  it("still rejects Work Louder devices that are not Knob-family", () => {
    // Nomad E (33428) and Creator Micro V2 (33431) must never be admitted.
    expect(isFramerProductId(33428)).toBe(false);
    expect(isFramerProductId(33431)).toBe(false);
    expect(() =>
      assertNormalFramerDevice({
        vendorId: 0x303a,
        productId: 33428,
        collections: [{ usagePage: 0xff00 }],
      }),
    ).toThrow(/this app doesn.t know yet/u);
  });

  it("uses an explicit single-device identity when Chrome omits the HID serial", () => {
    expect(assertNormalFramerDevice(deviceWithoutSerial)).toBe(deviceWithoutSerial);
    expect(createNormalFramerIdentity(deviceWithoutSerial, 1)).toMatchObject({
      mode: "single-device",
      serialNumber: null,
      productId: 0x8396,
    });
    expect(() => createNormalFramerIdentity(deviceWithoutSerial, 2)).toThrow(/more than one/u);
  });

  it("rejects a bootloader from a different keyboard", () => {
    expect(() => assertBootloaderIdentity({
      chipName: "ESP32-S3",
      flashSize: "16MB",
      normalIdentity: {
        mode: "hid-serial",
        serialNumber: "A4CB8FAF3210",
      },
      macAddress: "00:11:22:33:44:55",
      security: { secureBoot: false, flashEncryption: false },
    })).toThrow(/MAC does not match/u);
  });

  it("rejects security drift", () => {
    expect(() => assertBootloaderIdentity({
      chipName: "ESP32-S3",
      flashSize: "16MB",
      normalIdentity: {
        mode: "hid-serial",
        serialNumber: "A4CB8FAF3210",
      },
      macAddress: "a4:cb:8f:af:32:10",
      security: { secureBoot: true, flashEncryption: false },
    })).toThrow(/Secure Boot/u);
  });

  it("requires explicit confirmation before using the single-device fallback", () => {
    const input = {
      chipName: "ESP32-S3",
      flashSize: "16MB",
      normalIdentity: { mode: "single-device", productId: 0x8396 },
      macAddress: "a4:cb:8f:af:32:10",
      security: { secureBoot: false, flashEncryption: false },
    };
    expect(() => assertBootloaderIdentity(input)).toThrow(/Confirm that only one/u);
    expect(assertBootloaderIdentity({
      ...input,
      normalIdentity: { ...input.normalIdentity, singleDeviceConfirmed: true },
    })).toBe(true);
  });

  it("allows reset-only recovery after checking the Framer hardware state", () => {
    expect(assertBootloaderRecoveryTarget({
      chipName: "ESP32-S3",
      flashSize: "16MB",
      security: { secureBoot: false, flashEncryption: false },
    })).toBe(true);
    expect(() => assertBootloaderRecoveryTarget({
      chipName: "ESP32-S3",
      flashSize: "8MB",
      security: { secureBoot: false, flashEncryption: false },
    })).toThrow(/16MB/u);
  });
});
