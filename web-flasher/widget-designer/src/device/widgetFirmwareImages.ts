// ─────────────────────────────────────────────────────────────────────────────
// The firmware images the Designer can install, and ONLY those.
//
// Importing the flasher's whole catalog would be simpler, but its module pulls
// in every build it lists — WPM Pet, Music, the renderers, Weather — because
// each is a top-level `?url` import. That is 8 MB of firmware this app will
// never write, downloaded by everyone who opens the Designer. Naming the four
// regions of the one build it does write costs 2.3 MB instead.
//
// The price of that saving is a second copy of the region list, so
// test/widgetFirmwareImages.test.ts asserts this file and the flasher catalog
// describe byte-identical regions. If someone rebuilds the firmware and
// repins the catalog, that test fails here rather than the install failing on
// a stranger's keyboard.
// ─────────────────────────────────────────────────────────────────────────────

import appUrl from "../../../../experiments/mquickjs-esp32s3-physical-canary/build-diag-module-psram/framer-0.4.1-mqjs-id28-PSRAM-module-app.bin?url";
import textPageUrl from "../../../../experiments/mquickjs-esp32s3-physical-canary/build-diag-module-psram/mqjs-id28-text-page-psram.bin?url";
import rodataPageUrl from "../../../../experiments/mquickjs-esp32s3-physical-canary/build-diag-module-psram/mqjs-id28-rodata-page-psram.bin?url";
import sceneSlotBUrl from "../../../../experiments/mquickjs-esp32s3-physical-canary/releases/2026-08-27-id28-multi-widget/scene-slot-b.bin?url";

export interface FirmwareRegionSource {
  address: number;
  kind: "page" | "app";
  label: string;
  url: string;
  bytes: number;
  sha256: string;
}

/** Write order matters: the app at 0x10000 is written LAST, so a write that
 *  dies partway leaves a keyboard whose app does not yet expect module pages
 *  that were not fully written — the same order the flasher uses. */
export const WIDGET_FIRMWARE_NAME = "Widget Designer (multi-widget)";

export const WIDGET_FIRMWARE_REGIONS: readonly FirmwareRegionSource[] = Object.freeze([
  Object.freeze({
    address: 0x240000,
    kind: "page" as const,
    label: "Clock + Timer scene slot B (persisted)",
    url: sceneSlotBUrl,
    bytes: 95_599,
    sha256: "599be673ca9aba43a1fc64ec73324137919df70d9475ff8477100aa57cf0008f",
  }),
  Object.freeze({
    address: 0x210000,
    kind: "page" as const,
    label: "MicroQuickJS text page",
    url: textPageUrl,
    bytes: 131_072,
    sha256: "51a13ab4e0583d62e46acd7764fea4a896c1d9506c937bcc33789b344b3ee97f",
  }),
  Object.freeze({
    address: 0x230000,
    kind: "page" as const,
    label: "MicroQuickJS rodata page",
    url: rodataPageUrl,
    bytes: 65_536,
    sha256: "2eabd5afc626b9198559a42cb2b9269a6816067039d640f39c86324cd8c5ac85",
  }),
  Object.freeze({
    address: 0x10000,
    kind: "app" as const,
    label: "Widget Designer app",
    url: appUrl,
    bytes: 2_062_912,
    sha256: "2062c22f110c616e91ad5d3a7368fefd79eb10f24bc372b00f7c661f223c9649",
  }),
]);
