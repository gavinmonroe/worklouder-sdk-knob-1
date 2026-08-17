import {
  EXPECTED_FIRMWARE_VERSION,
  FRAMER_F1_PRODUCT_IDS,
  FRAMER_USAGE_PAGE,
  SERIAL_IDENTITY_MODE,
  SINGLE_DEVICE_IDENTITY_MODE,
  WORK_LOUDER_USB_VENDOR_ID,
  assertNormalFramerDevice,
  createNormalFramerIdentity,
  normalizeSerial,
  serialMatchesMac,
} from "./device-identity.js";

const REPORT_ID = 0x06;
const CHANNEL_RPC = 2;
const REPORT_DATA_BYTES = 63;
const MAX_PAYLOAD_BYTES = 61;
const RPC_TIMEOUT_MS = 10_000;

export const framerHidFilters = FRAMER_F1_PRODUCT_IDS.map((productId) => ({
  vendorId: WORK_LOUDER_USB_VENDOR_ID,
  productId,
  usagePage: FRAMER_USAGE_PAGE,
}));

function randomRpcId() {
  return crypto.getRandomValues(new Uint16Array(1))[0] % 999;
}

function withTimeout(promise, message, timeoutMs = RPC_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export class FramerHidClient {
  constructor(device) {
    this.device = assertNormalFramerDevice(device);
    this.decoder = new TextDecoder();
    this.rpcBuffer = "";
    this.pending = new Map();
    this.onInputReport = this.onInputReport.bind(this);
  }

  async open() {
    if (!this.device.opened) await this.device.open();
    this.device.addEventListener("inputreport", this.onInputReport);
    return this;
  }

  async close() {
    this.device.removeEventListener("inputreport", this.onInputReport);
    for (const pending of this.pending.values()) pending.reject(new Error("Framer HID connection closed."));
    this.pending.clear();
    if (this.device.opened) await this.device.close();
  }

  onInputReport(event) {
    if (event.reportId !== REPORT_ID || event.data.byteLength < 2) return;
    const bytes = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
    const channel = bytes[0];
    const length = bytes[1];
    if (channel !== CHANNEL_RPC || length > MAX_PAYLOAD_BYTES || 2 + length > bytes.length) return;

    this.rpcBuffer += this.decoder.decode(bytes.slice(2, 2 + length), { stream: true });
    const lines = this.rpcBuffer.split(/\r?\n/u);
    this.rpcBuffer = lines.pop() ?? "";
    for (const line of lines) this.acceptLine(line.trim());
  }

  acceptLine(line) {
    if (!line) return;
    let response;
    try {
      response = JSON.parse(line.slice(line.indexOf("{")));
    } catch {
      return;
    }
    const id = response.id ?? response.i;
    const pending = this.pending.get(String(id));
    if (!pending) return;
    this.pending.delete(String(id));
    if (response.error) pending.reject(new Error(response.error.message || "Framer RPC failed."));
    else pending.resolve(response.result);
  }

  async sendMessage(message) {
    const encoded = new TextEncoder().encode(message);
    for (let offset = 0; offset < encoded.length; offset += MAX_PAYLOAD_BYTES) {
      const chunk = encoded.slice(offset, offset + MAX_PAYLOAD_BYTES);
      const report = new Uint8Array(REPORT_DATA_BYTES);
      report[0] = CHANNEL_RPC;
      report[1] = chunk.length;
      report.set(chunk, 2);
      await this.device.sendReport(REPORT_ID, report);
    }
  }

  call(method, params = null) {
    const id = String(randomRpcId());
    const request = JSON.stringify({ method, params, id: Number(id) });
    const response = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    return withTimeout(
      this.sendMessage(request).then(() => response),
      `${method} did not receive a response from the Framer.`,
    ).finally(() => this.pending.delete(id));
  }

  async verifyVersion() {
    const result = await this.call("sys.version");
    const version = typeof result === "string" ? result : result?.version;
    if (version !== EXPECTED_FIRMWARE_VERSION) {
      throw new Error(`Framer firmware must be ${EXPECTED_FIRMWARE_VERSION}; detected ${version || "unknown"}.`);
    }
    return version;
  }

  async enterBootloader() {
    let resolveDisconnect;
    const disconnected = new Promise((resolve) => {
      resolveDisconnect = resolve;
    });
    const onDisconnect = (event) => {
      if (event.device === this.device) resolveDisconnect();
    };
    navigator.hid.addEventListener("disconnect", onDisconnect);
    try {
      await Promise.race([this.call("sys.bootloader"), disconnected]);
    } finally {
      navigator.hid.removeEventListener("disconnect", onDisconnect);
    }
  }
}

export async function requestFramerHid() {
  const devices = await navigator.hid.requestDevice({ filters: framerHidFilters });
  if (devices.length !== 1) throw new Error("Select exactly one Framer F1 in the Chrome device chooser.");
  return assertNormalFramerDevice(devices[0]);
}

function supportedGrantedFramers(devices) {
  return devices.filter((device) => {
    try {
      assertNormalFramerDevice(device);
      return true;
    } catch {
      return false;
    }
  });
}

export async function resolveFramerIdentity(device) {
  assertNormalFramerDevice(device);
  if (normalizeSerial(device.serialNumber).length === 12) {
    return createNormalFramerIdentity(device);
  }
  const granted = supportedGrantedFramers(await navigator.hid.getDevices());
  return createNormalFramerIdentity(device, granted.length);
}

export async function findGrantedFramer(normalIdentity, expectedMacAddress) {
  const devices = await navigator.hid.getDevices();
  const supported = supportedGrantedFramers(devices);
  if (normalIdentity?.mode === SERIAL_IDENTITY_MODE) {
    return supported.find(
      (device) => normalizeSerial(device.serialNumber) === normalIdentity.normalizedSerial,
    );
  }
  if (normalIdentity?.mode !== SINGLE_DEVICE_IDENTITY_MODE) return undefined;

  const candidates = supported.filter((device) => device.productId === normalIdentity.productId);
  if (candidates.length > 1) {
    throw new Error("More than one matching Framer returned after reboot; health verification is ambiguous.");
  }
  const device = candidates[0];
  if (
    device &&
    expectedMacAddress &&
    normalizeSerial(device.serialNumber).length === 12 &&
    !serialMatchesMac(device.serialNumber, expectedMacAddress)
  ) {
    throw new Error("The Framer that returned after reboot does not match the bootloader ROM MAC.");
  }
  return device;
}

export async function waitForHealthyFramer(
  normalIdentity,
  { expectedMacAddress, attempts = 16, intervalMs = 750 } = {},
) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const device = await findGrantedFramer(normalIdentity, expectedMacAddress);
    if (device) {
      const client = new FramerHidClient(device);
      try {
        await client.open();
        const version = await client.verifyVersion();
        return { device, version };
      } catch (error) {
        lastError = error;
      } finally {
        await client.close().catch(() => {});
      }
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`The app write verified, but normal Framer health did not return: ${lastError?.message || "device not found"}`);
}
