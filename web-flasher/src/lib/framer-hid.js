import {
  EXPECTED_FIRMWARE_VERSION,
  FRAMER_F1_PRODUCT_IDS,
  FRAMER_USAGE_PAGE,
  SERIAL_IDENTITY_MODE,
  SINGLE_DEVICE_IDENTITY_MODE,
  WORK_LOUDER_USB_VENDOR_ID,
  assertNormalFramerDevice,
  createNormalFramerIdentity,
  describeUsbDevice,
  normalizeSerial,
  serialMatchesMac,
} from "./device-identity.js";

const REPORT_ID = 0x06;
const CHANNEL_RPC = 2;
const REPORT_DATA_BYTES = 63;
const RPC_TIMEOUT_MS = 10_000;

export const framerHidFilters = FRAMER_F1_PRODUCT_IDS.map((productId) => ({
  vendorId: WORK_LOUDER_USB_VENDOR_ID,
  productId,
  usagePage: FRAMER_USAGE_PAGE,
}));

/**
 * Which output report to write, read from the device's own HID descriptor.
 *
 * The Framer F1 declares report 0x06 carrying 63 data bytes, and that pair was
 * hardcoded — so a Work Louder keyboard whose vendor collection declares
 * anything else failed on the very first write with WebHID's opaque "Failed to
 * write the report", after connecting successfully. Ask the device instead:
 * the vendor collection (usage page 0xff00) names its output report id, and the
 * report's items give its size in bits.
 *
 * Falls back to the F1's numbers when a device declares no usable output
 * report, which keeps every already-working keyboard on exactly its current
 * behaviour.
 */
export function resolveVendorOutputReport(device) {
  const vendorCollections = (device?.collections ?? []).filter(
    (collection) => collection.usagePage === FRAMER_USAGE_PAGE,
  );
  for (const collection of vendorCollections) {
    for (const report of collection.outputReports ?? []) {
      const bits = (report.items ?? []).reduce(
        (total, item) => total + (item.reportCount ?? 0) * (item.reportSize ?? 0),
        0,
      );
      const dataBytes = Math.floor(bits / 8);
      // Two bytes are the channel and length header, so anything smaller than
      // three could not carry a single payload byte.
      if (dataBytes >= 3 && Number.isInteger(report.reportId)) {
        return { reportId: report.reportId, dataBytes };
      }
    }
  }
  return { reportId: REPORT_ID, dataBytes: REPORT_DATA_BYTES };
}

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
    const expectedReportId = this.outputReport().reportId;
    if (event.reportId !== expectedReportId || event.data.byteLength < 2) return;
    const bytes = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
    const channel = bytes[0];
    const length = bytes[1];
    if (channel !== CHANNEL_RPC || 2 + length > bytes.length) return;

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

  /** The output report this device actually declares on its vendor collection.
   *  Cached per client: the descriptor cannot change while the device is open. */
  outputReport() {
    if (this.cachedReport) return this.cachedReport;
    this.cachedReport = resolveVendorOutputReport(this.device);
    return this.cachedReport;
  }

  async sendMessage(message) {
    const { reportId, dataBytes } = this.outputReport();
    const maxPayload = dataBytes - 2;
    const encoded = new TextEncoder().encode(message);
    for (let offset = 0; offset < encoded.length; offset += maxPayload) {
      const chunk = encoded.slice(offset, offset + maxPayload);
      const report = new Uint8Array(dataBytes);
      report[0] = CHANNEL_RPC;
      report[1] = chunk.length;
      report.set(chunk, 2);
      try {
        await this.device.sendReport(reportId, report);
      } catch (cause) {
        // WebHID's own message ("Failed to write the report") names nothing a
        // person can act on. Say which device refused, and what we sent it.
        throw new Error(
          `${describeUsbDevice(this.device)} refused the ${dataBytes}-byte report ` +
            `0x${reportId.toString(16)} this app speaks. If this is a keyboard variant ` +
            `we haven't seen, send those numbers to the project. (${(cause && cause.message) || cause})`,
        );
      }
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
  const devices = await navigator.hid.requestDevice({
    filters: [{ vendorId: WORK_LOUDER_USB_VENDOR_ID, usagePage: FRAMER_USAGE_PAGE }],
  });
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
