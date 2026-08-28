// The Designer bundles the firmware it installs, rather than importing the
// flasher's catalog (which would pull in every build it lists — 8 MB of images
// this app never writes). That saving costs a second copy of the region list,
// so this test is the thing that keeps the copy honest: if someone rebuilds the
// firmware and repins the flasher catalog, this fails HERE, at build time,
// instead of the install failing on a stranger's keyboard with a hash mismatch.

import { describe, expect, it } from "vitest";
import { firmwareCatalog } from "@flasher/src/data/firmware.js";
import {
  WIDGET_FIRMWARE_NAME,
  WIDGET_FIRMWARE_REGIONS,
} from "../src/device/widgetFirmwareImages";
import { WIDGET_FIRMWARE_ID } from "../src/device/firmwareInstall";

interface CatalogRegion {
  address: number;
  kind: string;
  label?: string;
  bytes: number;
  sha256: string;
}

describe("the firmware the Designer installs", () => {
  const entry = firmwareCatalog.find(
    (f: { id: string }) => f.id === WIDGET_FIRMWARE_ID,
  ) as { name: string; regions?: readonly CatalogRegion[] } | undefined;

  it("is still the build the web flasher publishes under the same id", () => {
    expect(entry, `"${WIDGET_FIRMWARE_ID}" left the flasher catalog`).toBeTruthy();
    expect(entry!.name).toBe(WIDGET_FIRMWARE_NAME);
  });

  it("writes exactly the catalog's regions, in the same order", () => {
    const catalogRegions = entry!.regions ?? [];
    expect(WIDGET_FIRMWARE_REGIONS).toHaveLength(catalogRegions.length);
    catalogRegions.forEach((region, index) => {
      const mine = WIDGET_FIRMWARE_REGIONS[index];
      expect(mine.address, `region ${index} address`).toBe(region.address);
      expect(mine.kind, `region ${index} kind`).toBe(region.kind);
      expect(mine.bytes, `region ${index} size`).toBe(region.bytes);
      // The hash is the whole point: it is what refuses a corrupted or stale
      // image before a single byte reaches the keyboard.
      expect(mine.sha256, `region ${index} sha256`).toBe(region.sha256);
    });
  });

  it("writes the app last, so a half-written update never boots a mismatched pair", () => {
    const last = WIDGET_FIRMWARE_REGIONS[WIDGET_FIRMWARE_REGIONS.length - 1];
    expect(last.kind).toBe("app");
    expect(last.address).toBe(0x10000);
  });
});
