import { ESPLoader, Transport } from "esptool-js";
import SparkMD5 from "spark-md5";

import {
  WORK_LOUDER_USB_VENDOR_ID,
  assertBootloaderIdentity,
  assertBootloaderPortInfo,
  assertBootloaderRecoveryTarget,
} from "./device-identity.js";
import {
  ALLOWED_REGION_ADDRESSES,
  APP_REGION_ADDRESS,
  formatRegionAddress,
} from "./firmware.js";

export const APP_FLASH_OFFSET = APP_REGION_ADDRESS;
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

/**
 * Last-line write-scope check, independent of catalog validation: an ordered
 * plan of approved addresses holding exactly one app image, written last.
 */
export function assertWritableRegions(regions) {
  if (!Array.isArray(regions) || regions.length === 0) {
    throw new Error("No verified flash region was prepared.");
  }
  if (regions.filter((region) => region.kind === "app").length !== 1) {
    throw new Error("Exactly one verified app region may be written.");
  }
  if (regions[regions.length - 1].kind !== "app") {
    throw new Error("The app region must be written last, after every module page.");
  }
  const seen = new Set();
  for (const region of regions) {
    if (!ALLOWED_REGION_ADDRESSES.includes(region.address)) {
      throw new Error(
        `Refusing to write ${formatRegionAddress(region.address)}; it is outside the approved write scope.`,
      );
    }
    if (region.kind === "app" && region.address !== APP_REGION_ADDRESS) {
      throw new Error("The app region must be written at 0x10000.");
    }
    if (seen.has(region.address)) {
      throw new Error(`Region ${formatRegionAddress(region.address)} is queued twice.`);
    }
    seen.add(region.address);
    if (!(region.bytes instanceof Uint8Array) || region.bytes.length === 0) {
      throw new Error(`Region ${formatRegionAddress(region.address)} is missing its verified bytes.`);
    }
  }
  return regions;
}

/**
 * Write an ordered plan of already-verified regions in one esptool-js call.
 * esptool-js walks `fileArray` in order and MD5-verifies each entry against the
 * device before moving on, so module pages land before the app that uses them.
 */
export async function flashRegions({ port, regions, normalIdentity, onProgress, onLog, onWriteStart }) {
  assertBootloaderPortInfo(port.getInfo());
  const plan = assertWritableRegions(regions);
  const transport = new Transport(port, false);
  const loader = new ESPLoader({
    transport,
    baudrate: WRITE_BAUD,
    terminal: loaderTerminal(onLog),
    debugLogging: false,
  });

  const sizes = plan.map((region) => region.bytes.length);
  const totalBytes = sizes.reduce((sum, size) => sum + size, 0);
  const startedBytes = sizes.map((_, index) => sizes.slice(0, index).reduce((sum, size) => sum + size, 0));

  try {
    await loader.main();
    const state = await readBootloaderState(loader);
    // Mirror exitBootloaderWithoutWrite: a caller that has no normal-mode identity to
    // offer still gets the chip/flash/security gate. Asserting the identity
    // unconditionally rejected every such caller -- including the Designer, which passes
    // normalIdentity: null -- with "Normal-mode Framer identity is unavailable" after the
    // bootloader had already passed every hardware check.
    if (normalIdentity) {
      assertBootloaderIdentity({ ...state, normalIdentity });
    } else {
      assertBootloaderRecoveryTarget(state);
    }

    onWriteStart?.(plan);
    await loader.writeFlash({
      fileArray: plan.map((region) => ({ data: region.bytes, address: region.address })),
      flashMode: "keep",
      flashFreq: "keep",
      flashSize: "keep",
      eraseAll: false,
      compress: true,
      reportProgress: (fileIndex, written, total) => {
        const fraction = total ? Math.min(written / total, 1) : 0;
        const done = startedBytes[fileIndex] + fraction * sizes[fileIndex];
        onProgress?.(Math.round(done), totalBytes, plan[fileIndex]);
      },
      calculateMD5Hash: md5,
    });
    await resetFramerAfterFlash(loader, transport);

    return Object.freeze({
      ...state,
      baud: WRITE_BAUD,
      hashVerifiedByDevice: true,
      regions: Object.freeze(
        plan.map((region) =>
          Object.freeze({
            address: region.address,
            kind: region.kind,
            bytes: region.bytes.length,
            sha256: region.sha256 ?? null,
          }),
        ),
      ),
    });
  } finally {
    await transport.disconnect().catch(() => {});
  }
}

export async function flashAppOnly({ port, bytes, sha256, normalIdentity, onProgress, onLog, onWriteStart }) {
  const result = await flashRegions({
    port,
    normalIdentity,
    onLog,
    regions: [{ address: APP_FLASH_OFFSET, kind: "app", bytes, sha256 }],
    onWriteStart: () => onWriteStart?.(),
    onProgress: (written, total) => onProgress?.(written, total),
  });
  return Object.freeze({ ...result, offset: APP_FLASH_OFFSET });
}
