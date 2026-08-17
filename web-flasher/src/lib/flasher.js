import { ESPLoader, Transport } from "esptool-js";
import SparkMD5 from "spark-md5";

import {
  WORK_LOUDER_USB_VENDOR_ID,
  assertBootloaderIdentity,
  assertBootloaderPortInfo,
  assertBootloaderRecoveryTarget,
} from "./device-identity.js";

export const APP_FLASH_OFFSET = 0x10000;
export const WRITE_BAUD = 921600;
export const RECOVERY_BAUD = 115200;
const ESP32_S3_EFUSE_BASE = 0x60007000;
const SPI_BOOT_CRYPT_CNT_REGISTER = ESP32_S3_EFUSE_BASE + 0x34;
const SECURE_BOOT_REGISTER = ESP32_S3_EFUSE_BASE + 0x38;
const USB_SERIAL_JTAG_CONF0_REGISTER = 0x6000812c;

export function browserCapabilities() {
  return Object.freeze({
    secureContext: globalThis.isSecureContext === true,
    webHid: typeof navigator !== "undefined" && "hid" in navigator,
    webSerial: typeof navigator !== "undefined" && "serial" in navigator,
  });
}

export function browserIsSupported(capabilities = browserCapabilities()) {
  return capabilities.secureContext && capabilities.webHid && capabilities.webSerial;
}

export function requestBootloaderPort() {
  return navigator.serial.requestPort({
    filters: [{ usbVendorId: WORK_LOUDER_USB_VENDOR_ID }],
  });
}

function md5(bytes) {
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return SparkMD5.ArrayBuffer.hash(copy);
}

function countSetBits(value) {
  let bits = 0;
  for (let input = value >>> 0; input; input >>>= 1) bits += input & 1;
  return bits;
}

export async function readSecurityState(loader) {
  const cryptRegister = (await loader.readReg(SPI_BOOT_CRYPT_CNT_REGISTER)) >>> 0;
  const secureRegister = (await loader.readReg(SECURE_BOOT_REGISTER)) >>> 0;
  const cryptCount = (cryptRegister >>> 18) & 0x7;
  return Object.freeze({
    secureBoot: Boolean(secureRegister & (1 << 20)),
    flashEncryption: countSetBits(cryptCount) % 2 === 1,
    cryptCount,
  });
}

export async function resetFramerAfterFlash(loader, transport) {
  await loader.writeReg(USB_SERIAL_JTAG_CONF0_REGISTER, 0);
  await new Promise((resolve) => setTimeout(resolve, 100));
  await transport.setDTR(false);
  await new Promise((resolve) => setTimeout(resolve, 100));
  await transport.setDTR(true);
}

function loaderTerminal(onLog) {
  return {
    clean: () => {},
    writeLine: (line) => onLog?.(String(line).trim()),
    write: (data) => onLog?.(String(data).trim()),
  };
}

export async function readBootloaderState(loader) {
  // A Web Serial WritableStream permits one writer. Keep every command
  // sequential so esptool-js never races itself for that exclusive lock.
  const chipName = loader.chip?.CHIP_NAME;
  const macAddress = await loader.chip.readMac(loader);
  const flashSize = await loader.detectFlashSize();
  const security = await readSecurityState(loader);
  return Object.freeze({ chipName, macAddress, flashSize, security });
}

export async function exitBootloaderWithoutWrite({ port, normalIdentity, onLog }) {
  assertBootloaderPortInfo(port.getInfo());
  const transport = new Transport(port, false);
  const loader = new ESPLoader({
    transport,
    baudrate: RECOVERY_BAUD,
    terminal: loaderTerminal(onLog),
    debugLogging: false,
  });

  try {
    await loader.main();
    const state = await readBootloaderState(loader);
    if (normalIdentity) {
      assertBootloaderIdentity({ ...state, normalIdentity });
    } else {
      assertBootloaderRecoveryTarget(state);
    }
    onLog?.("Approved Framer bootloader found. Resetting to the existing app; no flash region will be written.");
    await resetFramerAfterFlash(loader, transport);
    return state;
  } finally {
    await transport.disconnect().catch(() => {});
  }
}

export async function flashAppOnly({ port, bytes, normalIdentity, onProgress, onLog, onWriteStart }) {
  assertBootloaderPortInfo(port.getInfo());
  const transport = new Transport(port, false);
  const loader = new ESPLoader({
    transport,
    baudrate: WRITE_BAUD,
    terminal: loaderTerminal(onLog),
    debugLogging: false,
  });

  try {
    await loader.main();
    const state = await readBootloaderState(loader);
    assertBootloaderIdentity({ ...state, normalIdentity });

    onWriteStart?.();
    await loader.writeFlash({
      fileArray: [{ data: bytes, address: APP_FLASH_OFFSET }],
      flashMode: "keep",
      flashFreq: "keep",
      flashSize: "keep",
      eraseAll: false,
      compress: true,
      reportProgress: (_fileIndex, written, total) => onProgress?.(written, total),
      calculateMD5Hash: md5,
    });
    await resetFramerAfterFlash(loader, transport);

    return Object.freeze({
      ...state,
      offset: APP_FLASH_OFFSET,
      baud: WRITE_BAUD,
      hashVerifiedByDevice: true,
    });
  } finally {
    await transport.disconnect().catch(() => {});
  }
}
