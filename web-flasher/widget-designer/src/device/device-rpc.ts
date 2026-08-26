// ─────────────────────────────────────────────────────────────────────────────
// Device RPC surface for the designer.
//
// Reuses the web-flasher's proven WebHID transport (FramerHidClient) and adds
// the Framer F1's OWN RPC surface (NOT the stock Work Louder RPCs, which this
// firmware does not implement):
//
//   sys.version                 → firmware version string
//   widget.scene.capabilities   → admission profile + committed generation
//                                 (safe on firmware 4e045ec2+, see docs/15)
//   widget.mquickjs.cap {page} → MicroQuickJS capability pages (0..12)
//
// The mquickjs capability is the definitive read-only identification:
//   page 0  → profile + screen=28 + uploader flag
//   page 1  → baseApp=<sha256>  (the exact app-region hash → firmware identity)
//   page 12 → screenIds=1,7,26,27,28  (the screen roster)
//
// IMPORTANT: nothing here writes flash or pushes a package. It only reads
// device state and negotiates capability.
// ─────────────────────────────────────────────────────────────────────────────

import { FramerHidClient, requestFramerHid, resolveFramerIdentity } from "@flasher/src/lib/framer-hid.js";
import { framerLayout } from "@flasher/src/lib/device-identity.js";
import { FIRMWARE_CATALOG, identifyFirmware, type FirmwareEntry } from "./firmware-catalog";

// WebHID types are not in the standard DOM lib; the web-flasher libs are
// plain JS and treat the device as an opaque object.
type HIDDevice = any;

export interface FramerIdentity {
  mode: "hid-serial" | "single-device";
  serialNumber: string | null;
  normalizedSerial: string | null;
  productId: number;
  layout: string;
}

export interface ConnectedFramer {
  device: HIDDevice;
  identity: FramerIdentity;
  version: string;
  layout: string;
}

export interface MQuickJsCapability {
  /** Raw page-0 status string, or null if the device has no mquickjs module. */
  page0: string | null;
  /** True when the device advertises the mquickjs render-v2 profile. */
  present: boolean;
  /** True when the device accepts F2JS package uploads (currently false). */
  runtimeUploader: boolean;
  /** The base-app SHA-256 advertised on page 1 (identifies the firmware). */
  baseAppSha256: string | null;
  /** Screen IDs advertised on page 12. */
  screenIds: number[];
  /** Human-readable gate summary. */
  gate: string;
}

export interface RenderV2Capability {
  present: boolean;
  committedGeneration: number | null;
  packageFormat: string | null;
  /** The advertised admission profile id, e.g. framer-f1-render-v2-structural-v1. */
  renderV2Profile: string | null;
  /**
   * True when the device admits arbitrary structurally valid packages rather
   * than one pinned build. Only the generic firmware advertises this; the
   * clock/timer and mquickjs builds answer without a profile at all.
   */
  genericPackages: boolean;
  /** Device-advertised bundle ceiling, when it reports one. */
  maxBundleBytes: number | null;
  gate: string;
}

/** The profile id emitted by the generic render-v2 firmware. */
export const GENERIC_RENDER_V2_PROFILE = "framer-f1-render-v2-structural-v1";
export const GENERIC_RENDER_V2_PACKAGE_FORMAT = "framer-render-v2-package-v1";

/**
 * Open a normal-mode Framer over WebHID, verify firmware, and resolve identity.
 *
 * Returns the OPEN client rather than closing it. The caller owns it from here
 * and must close it. This used to close the device and let the caller
 * immediately reopen it, which meant every connect churned the HID endpoint
 * open → close → open for no benefit. That churn is harmless on an idle bus and
 * decidedly not harmless when another host (Input.app) is polling the same
 * device: the firmware reassembles RPC lines from HID reports into one buffer,
 * so overlapping sessions can interleave fragments into malformed input.
 *
 * Quitting the contending app is still the actual fix — see
 * docs/04-recovery-and-restore.md — but there is no reason to add churn on top.
 */
export async function connectFramer(): Promise<ConnectedFramer & { client: FramerHidClient }> {
  const device = await requestFramerHid();
  const identity = await resolveFramerIdentity(device);
  const client = new FramerHidClient(device);
  await client.open();
  try {
    const version = await client.verifyVersion();
    return {
      device,
      client,
      identity: {
        mode: identity.mode,
        serialNumber: identity.serialNumber,
        normalizedSerial: identity.normalizedSerial,
        productId: identity.productId,
        layout: framerLayout(identity.productId),
      },
      version,
      layout: framerLayout(identity.productId),
    };
  } catch (cause) {
    await client.close().catch(() => {});
    throw cause;
  }
}

/**
 * FramerHidClient.call() resolves with `response.result`. For the mquickjs
 * capability RPC that result is `{ status: "v1;p=N;..." }` — an object whose
 * `.status` field is the page string. Extract it defensively.
 */
function statusString(result: unknown): string | null {
  if (typeof result === "string") return result;
  if (result && typeof result === "object" && typeof (result as any).status === "string") {
    return (result as any).status;
  }
  return null;
}

/**
 * Probe the MicroQuickJS capability (pages 0, 1, 12) to learn whether the
 * device has the mquickjs module, which firmware it is (baseApp SHA), and its
 * screen roster. This is the definitive read-only identification.
 */
export async function probeMQuickJsCapability(client: FramerHidClient): Promise<MQuickJsCapability> {
  const readPage = async (page: number): Promise<string | null> => {
    try {
      const result = await client.call("widget.mquickjs.cap", { page });
      return statusString(result);
    } catch {
      return null;
    }
  };

  const page0 = await readPage(0);
  if (page0 == null) {
    return { page0: null, present: false, runtimeUploader: false, baseAppSha256: null, screenIds: [], gate: "no mquickjs module" };
  }

  const present = /profile=framer-f1-render-v2-mquickjs-v1/.test(page0);
  const runtimeUploader = /uploader=1/.test(page0);

  // Page 1: baseApp=<sha256>;boot=<hex16>
  const page1 = await readPage(1);
  const baseAppMatch = page1 ? /baseApp=([0-9a-f]{64})/.exec(page1) : null;
  const baseAppSha256 = baseAppMatch ? baseAppMatch[1] : null;

  // Page 12: screenIds=1,7,26,27,28;...
  const page12 = await readPage(12);
  const screenMatch = page12 ? /screenIds=([0-9,]+)/.exec(page12) : null;
  const screenIds = screenMatch
    ? screenMatch[1].split(",").map((n) => parseInt(n, 10)).filter((n) => Number.isInteger(n))
    : [];

  const gate = !present
    ? "mquickjs profile not advertised"
    : runtimeUploader
      ? "uploader enabled"
      : "uploader disabled (runtimeUploader=false)";

  return { page0, present, runtimeUploader, baseAppSha256, screenIds, gate };
}

/**
 * Read the render-v2 scene capability.
 *
 * History matters here: this RPC used to crash the generic build. Its JSON keys
 * and values were built on the stack, but the stock JSON layer stores pointers
 * and serializes after the handler's frame is gone, so they dangled
 * (LoadProhibited, EXCVADDR 6). Firmware 4e045ec2 moves every key and value into
 * persistent RAM and it now answers correctly — see docs/15.
 *
 * That fix is firmware-side, so this call is only safe on 4e045ec2 or later.
 * Against the older generic build (371ee26e) it still faults the keyboard, which
 * is why a failure here is reported rather than retried.
 */
export async function probeRenderV2Capability(client: FramerHidClient): Promise<RenderV2Capability> {
  try {
    const result = await client.call("widget.scene.capabilities", { protocol: "framer-widget-scene-rpc-v1" });
    if (!result || typeof result !== "object") return absentRenderV2("no render-v2 scene capability");

    const number = (value: unknown): number | null =>
      typeof value === "string" && /^\d+$/.test(value) ? parseInt(value, 10) : null;
    const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

    const renderV2Profile = text(result.renderV2Profile);
    const packageFormat = text(result.packageFormat);
    const genericPackages =
      renderV2Profile === GENERIC_RENDER_V2_PROFILE && packageFormat === GENERIC_RENDER_V2_PACKAGE_FORMAT;

    return {
      present: true,
      committedGeneration: number(result.committedGeneration),
      packageFormat,
      renderV2Profile,
      genericPackages,
      maxBundleBytes: number(result.maxBundleBytes),
      gate: genericPackages
        ? "generic render-v2 admission — arbitrary packages accepted"
        : "scene RPC present, but this build does not advertise generic admission",
    };
  } catch {
    return absentRenderV2("no render-v2 scene capability");
  }
}

function absentRenderV2(gate: string): RenderV2Capability {
  return {
    present: false,
    committedGeneration: null,
    packageFormat: null,
    renderV2Profile: null,
    genericPackages: false,
    maxBundleBytes: null,
    gate,
  };
}

/**
 * Identify the firmware on the device from its advertised base-app SHA-256.
 * Returns the catalog entry, or null when the hash is unknown (meaning we
 * have not flashed this exact build before and may need to make a new one).
 */
export function identifyFirmwareFromSha(sha256: string | null): FirmwareEntry | null {
  if (!sha256) return null;
  return identifyFirmware(sha256);
}

/** How a firmware identification was reached — the two routes differ in strength. */
export type IdentificationSource = "app-sha256" | "capability-profile" | "none";

export interface FirmwareIdentification {
  firmware: FirmwareEntry | null;
  source: IdentificationSource;
}

/**
 * Identify the running firmware.
 *
 * The definitive route is the app SHA-256 on mquickjs capability page 1. Builds
 * without the mquickjs module — the generic render-v2 app among them — advertise
 * no app hash at all, so there is nothing to match against the catalog and the
 * SHA route reports "unknown build".
 *
 * For those, fall back to the advertised admission profile. This is weaker: it
 * identifies the *capability*, not the exact image, so two builds sharing a
 * profile are indistinguishable. Callers surface which route was used rather
 * than presenting both as equivalent.
 */
export function identifyFirmwareFromCapabilities(
  mquickjs: MQuickJsCapability | null,
  renderV2: RenderV2Capability | null,
): FirmwareIdentification {
  const bySha = identifyFirmwareFromSha(mquickjs?.baseAppSha256 ?? null);
  if (bySha) return { firmware: bySha, source: "app-sha256" };

  if (renderV2?.genericPackages === true) {
    const generic = FIRMWARE_CATALOG.find((entry) => entry.id === "input-lab-generic") ?? null;
    if (generic) return { firmware: generic, source: "capability-profile" };
  }
  return { firmware: null, source: "none" };
}
