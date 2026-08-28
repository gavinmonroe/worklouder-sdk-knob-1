// ─────────────────────────────────────────────────────────────────────────────
// Installing the Widget Designer firmware from inside the Designer.
//
// A keyboard that is not running this firmware cannot receive widgets at all,
// so "go to another website and come back" was the one dead end left in the
// studio. This closes it — WITHOUT reimplementing firmware writing.
//
// Every dangerous step is the web flasher's own, imported, not copied:
//   loadFlashPlan      fetches each region and verifies its SHA-256 against the
//                      catalog BEFORE the device is touched at all
//   assertWritableRegions  refuses any address outside the allow-list
//   flashRegions       esptool-js write + per-region MD5 verify + reset
//
// The only thing this module adds is the choreography the Designer can do that
// the flasher cannot: it already holds an open HID connection, so it can put
// the keyboard into its bootloader itself instead of asking the user to.
// ─────────────────────────────────────────────────────────────────────────────

import { WIDGET_FIRMWARE_NAME, WIDGET_FIRMWARE_REGIONS } from "./widgetFirmwareImages";
import { loadFlashPlan, formatRegionAddress } from "@flasher/src/lib/firmware.js";
import {
  assertWritableRegions,
  browserCapabilities,
  flashRegions,
  requestBootloaderPort,
} from "@flasher/src/lib/flasher.js";

/** The catalog id this Designer is built against. If this entry ever leaves
 *  the catalog the install path must fail loudly rather than silently write
 *  some other firmware, so the lookup below throws instead of falling back. */
export const WIDGET_FIRMWARE_ID = "widget-designer-multi";

export interface FirmwareRegionPlan {
  address: number;
  label: string | null;
  bytes: number;
  sha256: string;
}

export interface InstallHandle {
  /** Human name of the firmware being installed. */
  name: string;
  /** What will be written, in write order — shown before anything happens. */
  regions: FirmwareRegionPlan[];
  /** Total bytes across every region. */
  totalBytes: number;
}

export function widgetFirmwareEntry() {
  return {
    id: WIDGET_FIRMWARE_ID,
    name: WIDGET_FIRMWARE_NAME,
    regions: WIDGET_FIRMWARE_REGIONS,
  };
}

/** Web Serial is the flashing transport; WebHID alone is not enough. Chrome and
 *  Edge on desktop have it, and a secure context is required. */
export function canInstallFirmware(): { ok: boolean; reason: string } {
  const caps = browserCapabilities();
  if (!caps.webSerial) {
    return {
      ok: false,
      reason:
        "This browser can't write firmware. Use desktop Chrome or Edge — installing needs Web Serial.",
    };
  }
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return { ok: false, reason: "Firmware installing needs a secure (https) connection." };
  }
  return { ok: true, reason: "" };
}

/**
 * Verify the whole flash plan without touching the keyboard. Returns what would
 * be written so the UI can show it BEFORE asking for consent — a firmware write
 * is not something to start and explain afterwards.
 */
export async function prepareWidgetFirmware(): Promise<InstallHandle> {
  const entry = widgetFirmwareEntry();
  const prepared = await loadFlashPlan(entry);
  const regions: FirmwareRegionPlan[] = prepared.multiRegion
    ? prepared.regions.map((r: { address: number; label: string | null; bytes: Uint8Array; sha256: string }) => ({
        address: r.address,
        label: r.label,
        bytes: r.bytes.length,
        sha256: r.sha256,
      }))
    : [
        {
          address: 0x10000,
          label: entry.name,
          bytes: prepared.bytes.length,
          sha256: prepared.validation.digest,
        },
      ];
  // The allow-list gate the flasher applies, run here too so a bad plan is
  // rejected while nothing is at stake.
  if (prepared.multiRegion) assertWritableRegions(prepared.regions);
  return {
    name: entry.name,
    regions,
    totalBytes: regions.reduce((sum, r) => sum + r.bytes, 0),
  };
}

export interface InstallCallbacks {
  /** Progress across the whole write, 0..1. */
  onProgress?: (fraction: number) => void;
  /** Milestones, in the user's words — these stream into the session log. */
  onLog?: (line: string) => void;
  /** Called once the write has actually begun: from here a power-cycle mid-way
   *  leaves the keyboard in the bootloader, and the fix is to run this again. */
  onWriteStart?: () => void;
}

/**
 * Put the connected keyboard into its bootloader and write the firmware.
 *
 * `enterBootloader` is sent over the HID connection the Designer already has,
 * which is why this can be one button here and is three steps on the flasher
 * site. After it lands the keyboard re-enumerates as a serial device, so the
 * browser asks the user to pick that port — a permission prompt no page can
 * skip, and the one place the user's own hand is required.
 */
export async function installWidgetFirmware(
  client: { enterBootloader: () => Promise<unknown> } | null,
  callbacks: InstallCallbacks = {},
): Promise<{ regions: number; bytes: number }> {
  const { onProgress, onLog, onWriteStart } = callbacks;
  const gate = canInstallFirmware();
  if (!gate.ok) throw new Error(gate.reason);

  // 1. Verify every byte first. Nothing below runs if a region fails its hash.
  const entry = widgetFirmwareEntry();
  const prepared = await loadFlashPlan(entry);
  if (prepared.multiRegion) {
    assertWritableRegions(prepared.regions);
    for (const region of prepared.regions) {
      onLog?.(
        `Checked ${region.label ?? "region"} at ${formatRegionAddress(region.address)} — ` +
          `${region.bytes.length.toLocaleString()} bytes.`,
      );
    }
  } else {
    onLog?.(`Checked ${entry.name} — ${prepared.bytes.length.toLocaleString()} bytes.`);
  }

  // 2. Ask the keyboard to restart into its bootloader. Without a live HID
  //    connection the user can still do it by hand, so this is not fatal.
  if (client) {
    onLog?.("Asking the keyboard to restart in update mode…");
    try {
      await client.enterBootloader();
      onLog?.("The keyboard is in update mode.");
    } catch (cause) {
      onLog?.(
        `The keyboard didn't take the restart command (${(cause as Error).message}). ` +
          "If it is already in update mode, carry on and pick its port.",
      );
    }
    // The device re-enumerates as a serial port; give the OS a moment to see it
    // before the picker opens, or the port the user needs may not be listed.
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  // 3. The user picks the bootloader port. This prompt is deliberate: it is the
  //    browser's own consent for writing to a device.
  onLog?.("Choose the keyboard's update port in the browser prompt.");
  const port = await requestBootloaderPort();

  const result = await flashRegions({
    port,
    regions: prepared.multiRegion
      ? prepared.regions
      : [{ address: 0x10000, kind: "app", label: entry.name, bytes: prepared.bytes, sha256: prepared.validation.digest }],
    normalIdentity: null,
    onProgress: (written: number, total: number) =>
      onProgress?.(total > 0 ? written / total : 0),
    onLog: (line: string) => onLog?.(line),
    onWriteStart: () => onWriteStart?.(),
  });

  const regions = prepared.multiRegion ? prepared.regions.length : 1;
  const bytes = prepared.multiRegion
    ? prepared.regions.reduce((sum: number, r: { bytes: Uint8Array }) => sum + r.bytes.length, 0)
    : prepared.bytes.length;
  void result;
  onLog?.(`Firmware installed: ${regions} region${regions === 1 ? "" : "s"}, ${bytes.toLocaleString()} bytes.`);
  return { regions, bytes };
}
