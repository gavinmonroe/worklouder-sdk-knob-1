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
  const collections = device?.collections ?? [];
  // Vendor-defined usage pages are 0xff00..0xffff. The Framer F1 speaks on
  // 0xff00, but that is a choice, not a rule: a Knob 1 reported a 0xff00
  // collection with NO writable report and refused report 0x06, which means
  // its writable endpoint lives on another vendor page (QMK's raw-HID sits on
  // 0xff60). Prefer 0xff00 for continuity, then take any other vendor page,
  // rather than assuming one number for every keyboard Work Louder ships.
  const isVendorPage = (page) => typeof page === "number" && page >= 0xff00 && page <= 0xffff;
  const ordered = [
    ...collections.filter((c) => c.usagePage === FRAMER_USAGE_PAGE),
    ...collections.filter((c) => c.usagePage !== FRAMER_USAGE_PAGE && isVendorPage(c.usagePage)),
  ];
  for (const collection of ordered) {
    for (const report of collection.outputReports ?? []) {
      const bits = (report.items ?? []).reduce(
        (total, item) => total + (item.reportCount ?? 0) * (item.reportSize ?? 0),
        0,
      );
      const dataBytes = Math.floor(bits / 8);
      // Two bytes are the channel and length header, so anything smaller than
      // three could not carry a single payload byte.
      if (dataBytes >= 3 && Number.isInteger(report.reportId)) {
        return { reportId: report.reportId, dataBytes, usagePage: collection.usagePage };
      }
    }
  }
  return { reportId: REPORT_ID, dataBytes: REPORT_DATA_BYTES, usagePage: null };
}

/** A compact, copy-pasteable description of what a device declares. When a
 *  write is refused this is the only thing that identifies the variant, so it
 *  goes in the error rather than sitting in a console somewhere. */
/** macOS treats any HID device that exposes keyboard or consumer-control
 *  collections as protected input hardware. Chrome can enumerate and OPEN such
 *  a device, and then every write is refused until the user grants Chrome
 *  "Input Monitoring" — which is why this fails after a connection that looked
 *  successful, with no other program holding the keyboard. Every Work Louder
 *  keyboard carries those collections, so this is the first thing to check on
 *  a Mac. */
export const HID_WRITE_BLOCKED_MACOS = "macos-input-monitoring";
export const HID_WRITE_BLOCKED_BUSY = "device-busy";

function looksLikeMac() {
  if (typeof navigator === "undefined") return false;
  const platform = navigator.userAgentData?.platform || navigator.platform || "";
  return /mac/i.test(platform) || /Mac OS X/i.test(navigator.userAgent || "");
}

function hasProtectedCollection(device) {
  return (device?.collections ?? []).some(
    (collection) => collection.usagePage === 0x01 || collection.usagePage === 0x0c,
  );
}

export function describeHidDescriptor(device) {
  const parts = [];
  for (const collection of device?.collections ?? []) {
    const page = `0x${(collection.usagePage ?? 0).toString(16)}`;
    const out = (collection.outputReports ?? [])
      .map((r) => {
        const bits = (r.items ?? []).reduce(
          (t, i) => t + (i.reportCount ?? 0) * (i.reportSize ?? 0),
          0,
        );
        return `out 0x${(r.reportId ?? 0).toString(16)}/${Math.floor(bits / 8)}B`;
      })
      .join(" ");
    const inp = (collection.inputReports ?? [])
      .map((r) => {
        const bits = (r.items ?? []).reduce(
          (t, i) => t + (i.reportCount ?? 0) * (i.reportSize ?? 0),
          0,
        );
        return `in 0x${(r.reportId ?? 0).toString(16)}/${Math.floor(bits / 8)}B`;
      })
      .join(" ");
    parts.push(`page ${page}[${[out, inp].filter(Boolean).join(" ") || "no reports"}]`);
  }
  return parts.join(", ") || "no collections";
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
      } catch (firstCause) {
        try {
          if (this.device.opened) await this.device.close();
          await this.device.open();
          await this.device.sendReport(reportId, report);
          continue;
        } catch (cause) {
          void firstCause;
        // WebHID's own message ("Failed to write the report") names nothing a
        // person can act on. Say which device refused, and what we sent it.
          const name = (cause && cause.name) || "Error";
          const detail = (cause && cause.message) || String(cause);
          const blockedByMac = looksLikeMac() && hasProtectedCollection(this.device);
          const macGuidance =
            looksLikeMac() && hasProtectedCollection(this.device)
              ? " On macOS, check in this order: (1) if Chrome is NOT yet allowed under " +
                "System Settings > Privacy & Security > Input Monitoring, turn it on, then " +
                "QUIT and reopen Chrome (a reload is not enough); (2) if it IS already " +
                "allowed, this is Chrome refusing the interface rather than a setting — " +
                "unplug and replug the keyboard, then reconnect, and send this whole message " +
                "to the project."
              : " Most often another program is holding the keyboard: quit Work Louder Input, " +
                "VIA, or QMK Toolbox and try again.";
          const failure = new Error(
            `${describeUsbDevice(this.device)} connected, but refused report ` +
              `0x${reportId.toString(16)} (${dataBytes} bytes) twice — ${name}: ${detail}.` +
              macGuidance +
              ` [declares: ${describeHidDescriptor(this.device)}]`,
          );
          // The code is what the UI keys off: prose is for humans, this is for
          // showing the right remedy without parsing sentences.
          failure.code = blockedByMac ? HID_WRITE_BLOCKED_MACOS : HID_WRITE_BLOCKED_BUSY;
          failure.deviceDescriptor = describeHidDescriptor(this.device);
          failure.cause = cause;
          throw failure;
        }
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

/**
 * Open the keyboard entry that can actually be WRITTEN to.
 *
 * Chrome can expose several HIDDevice entries for one physical keyboard, and
 * more than one of them may advertise the vendor collection — a Knob 1 owner
 * reported two connection attempts whose collection lists differed, with the
 * write refused as NotAllowedError even though the report it declared
 * (0x06/63B) was exactly what we send, and even with macOS Input Monitoring
 * granted. Chrome refuses writes on an entry it considers protected, so the
 * entry the chooser happens to return can be the wrong one.
 *
 * Rather than trusting the first entry, try each granted entry for the same
 * keyboard and keep the first that accepts a real RPC. Every rejected
 * candidate is recorded, so a failure reports what was tried instead of
 * blaming the one device the user happened to pick.
 */
export async function openWritableFramer(preferred, { verify } = {}) {
  const check = verify ?? ((client) => client.verifyVersion());
  let siblings = [];
  try {
    siblings = (await navigator.hid.getDevices()).filter(
      (candidate) =>
        candidate !== preferred &&
        candidate.vendorId === preferred.vendorId &&
        candidate.productId === preferred.productId &&
        (candidate.collections ?? []).some((c) => c.usagePage === FRAMER_USAGE_PAGE),
    );
  } catch {
    /* getDevices can reject in odd permission states; the preferred entry still stands. */
  }
  const tried = [];
  let lastError;
  for (const candidate of [preferred, ...siblings]) {
    const client = new FramerHidClient(candidate);
    try {
      await client.open();
      const result = await check(client);
      return { client, device: candidate, verified: result, alternates: siblings.length };
    } catch (cause) {
      lastError = cause;
      tried.push(`${describeHidDescriptor(candidate)} -> ${(cause && cause.name) || "Error"}`);
      await client.close().catch(() => {});
    }
  }
  const failure = new Error(
    `${describeUsbDevice(preferred)} connected, but no interface accepted a write. ` +
      `Tried ${tried.length}: ${tried.join(" | ")}. ` +
      ((lastError && lastError.message) || ""),
  );
  failure.code = (lastError && lastError.code) || "no-writable-interface";
  failure.cause = lastError;
  throw failure;
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
