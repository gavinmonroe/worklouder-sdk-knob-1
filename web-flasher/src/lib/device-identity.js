export const WORK_LOUDER_USB_VENDOR_ID = 0x303a;
// Work Louder ships one firmware image for two product variants; the 0.4.1
// image in artifacts/firmware carries both "Framer F1" and "knob1" identity
// strings (app offset 0x12c), and Input maps both types to knob-fw-releases
// with identical feature flags. Product IDs come from the vendor device kit's
// DEVICE_REGISTRY (@worklouder/wl-device-kit dist/index.js:5036-5040).
export const KNOB_F1_PRODUCT_IDS = Object.freeze([0x8396, 0x8397]);
export const KNOB_PRODUCT_IDS = Object.freeze([0x8296, 0x82e3]);
export const FRAMER_F1_PRODUCT_IDS = Object.freeze([
  ...KNOB_F1_PRODUCT_IDS,
  ...KNOB_PRODUCT_IDS,
]);
export const FRAMER_USAGE_PAGE = 0xff00;
export const EXPECTED_FIRMWARE_VERSION = "0.4.1";
export const ESP32_S3_CHIP_NAME = "ESP32-S3";
export const EXPECTED_FLASH_SIZE = "16MB";
export const SERIAL_IDENTITY_MODE = "hid-serial";
export const SINGLE_DEVICE_IDENTITY_MODE = "single-device";

export function isFramerProductId(productId) {
  return FRAMER_F1_PRODUCT_IDS.includes(productId);
}

export function framerLayout(productId) {
  if (productId === 0x8396 || productId === 0x8296) return "ANSI";
  if (productId === 0x8397 || productId === 0x82e3) return "ISO";
  return "Unknown";
}

export function framerModelName(productId) {
  if (KNOB_F1_PRODUCT_IDS.includes(productId)) return "Framer F1";
  if (KNOB_PRODUCT_IDS.includes(productId)) return "Knob1";
  return "Unknown Work Louder device";
}

export function normalizeSerial(value) {
  return String(value ?? "")
    .replace(/[^0-9a-f]/giu, "")
    .toLowerCase();
}

export function serialMatchesMac(serialNumber, macAddress) {
  const serial = normalizeSerial(serialNumber);
  const mac = normalizeSerial(macAddress);
  return serial.length === 12 && serial === mac;
}

export function assertNormalFramerDevice(device) {
  if (!device || device.vendorId !== WORK_LOUDER_USB_VENDOR_ID || !isFramerProductId(device.productId)) {
    throw new Error("The selected USB device is not a supported Framer F1 / Knob F1.");
  }
  const hasVendorCollection = device.collections?.some(
    (collection) => collection.usagePage === FRAMER_USAGE_PAGE,
  );
  if (!hasVendorCollection) {
    throw new Error("The selected device does not expose the Framer vendor HID interface.");
  }
  return device;
}

export function createNormalFramerIdentity(device, supportedDeviceCount = 1) {
  assertNormalFramerDevice(device);
  const normalizedSerial = normalizeSerial(device.serialNumber);
  if (normalizedSerial.length === 12) {
    return Object.freeze({
      mode: SERIAL_IDENTITY_MODE,
      serialNumber: String(device.serialNumber),
      normalizedSerial,
      productId: device.productId,
    });
  }
  if (supportedDeviceCount !== 1) {
    throw new Error(
      "Chrome did not expose a Framer serial number and more than one supported keyboard is available. Disconnect the others and try again.",
    );
  }
  return Object.freeze({
    mode: SINGLE_DEVICE_IDENTITY_MODE,
    serialNumber: null,
    normalizedSerial: null,
    productId: device.productId,
  });
}

export function assertBootloaderPortInfo(info) {
  if (info?.usbVendorId !== WORK_LOUDER_USB_VENDOR_ID) {
    throw new Error("The selected serial port is not an Espressif / Work Louder bootloader.");
  }
  return info;
}

export function assertBootloaderRecoveryTarget({ chipName, flashSize, security }) {
  if (chipName !== ESP32_S3_CHIP_NAME) {
    throw new Error(`Expected ESP32-S3, but the serial target reported ${chipName || "an unknown chip"}.`);
  }
  if (flashSize !== EXPECTED_FLASH_SIZE) {
    throw new Error(`Expected a 16MB Framer flash, but detected ${flashSize || "an unknown size"}.`);
  }
  if (security?.secureBoot || security?.flashEncryption) {
    throw new Error("Secure Boot or Flash Encryption differs from the approved Framer state.");
  }
  return true;
}

export function assertBootloaderIdentity({ chipName, flashSize, normalIdentity, macAddress, security }) {
  assertBootloaderRecoveryTarget({ chipName, flashSize, security });
  if (normalIdentity?.mode === SERIAL_IDENTITY_MODE && !serialMatchesMac(normalIdentity.serialNumber, macAddress)) {
    throw new Error("Bootloader MAC does not match the Framer selected in normal mode.");
  }
  if (
    normalIdentity?.mode === SINGLE_DEVICE_IDENTITY_MODE &&
    normalIdentity.singleDeviceConfirmed !== true
  ) {
    throw new Error("Confirm that only one Framer F1 / Knob F1 is connected before selecting its bootloader port.");
  }
  if (![SERIAL_IDENTITY_MODE, SINGLE_DEVICE_IDENTITY_MODE].includes(normalIdentity?.mode)) {
    throw new Error("Normal-mode Framer identity is unavailable; the bootloader cannot be approved.");
  }
  return true;
}
