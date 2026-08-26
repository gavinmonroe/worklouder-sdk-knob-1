import { describe, expect, it } from "vitest";

import { defaultFirmwareId, firmwareCatalog } from "../src/data/firmware.js";
import { ALLOWED_REGION_ADDRESSES, assertRegionPlan } from "../src/lib/firmware.js";

const byId = Object.fromEntries(firmwareCatalog.map((firmware) => [firmware.id, firmware]));

describe("widget catalog policy", () => {
  it("exposes the requested widgets in order", () => {
    expect(firmwareCatalog.map(({ name }) => name)).toEqual([
      "WPM Pet",
      "Music",
      "Custom HTML / CSS Preview",
      "Clock + Timer (render v2)",
      "Weather (MicroQuickJS canary)",
      "Input Lab custom widgets (render v2 generic)",
    ]);
    expect(defaultFirmwareId).toBe("wpm-pet");
    expect(firmwareCatalog.map(({ includes }) => includes)).toEqual([
      ["WPM Pet"],
      ["WPM Pet", "Music"],
      ["WPM Pet", "Music", "Custom HTML / CSS Preview"],
      ["WPM Pet", "Music", "Clock", "Timer"],
      ["WPM Pet", "Music", "Clock", "Timer", "Weather"],
      ["WPM Pet", "Music", "Input Lab custom widgets"],
    ]);
    expect(byId["custom-html-css-preview"].compilerUrl).toBe("https://htmlcss-to-framerf1-widget.g-m.dev");
    expect(byId["input-lab-generic"].compilerUrl).toBe("https://htmlcss-to-framerf1-widget.g-m.dev");
    expect(byId["wpm-pet"].hostCompanion).toBeUndefined();
    expect(byId.music.hostCompanion).toMatchObject({
      url: "./downloads/framer-f1-music-host-macos.zip",
      filename: "framer-f1-music-host-macos.zip",
      platform: "macOS",
    });
    expect(byId["custom-html-css-preview"].hostCompanion).toBe(byId.music.hostCompanion);
    expect(byId.music).toMatchObject({
      bytes: 2_032_368,
      sha256: "b9b8eec6250392f593ae664fa8b8cba64bf861f5ef49a427c65be79e6f355817",
    });
  });

  it("exposes the smoke-approved renderers with explicit warnings", () => {
    expect(firmwareCatalog.map(({ flashable }) => flashable)).toEqual([true, true, true, true, true, true]);
    expect(byId["custom-html-css-preview"].evidence).toBe("Smoke candidate");
    expect(byId["custom-html-css-preview"].notice).toMatch(/not yet live accepted/u);
    expect(byId["input-lab-generic"].evidence).toBe("Smoke candidate");
    expect(byId["input-lab-generic"].evidenceTone).toBe("caution");
    expect(byId["input-lab-generic"].notice).toMatch(/clock, timer, and weather widgets are not in this image/iu);
    expect(byId["input-lab-generic"]).toMatchObject({
      bytes: 2_062_912,
      sha256: "371ee26ebb74c37fde96213ace9f4c506ac98d5293ff09ffe3f863ced9c98f06",
    });
    expect(byId["input-lab-generic"].regions).toBeUndefined();
    expect(byId["input-lab-generic"].scenePackage).toBeUndefined();
  });

  it("pins the clock + timer app and its RAM-only scene package", () => {
    expect(byId["clock-timer"]).toMatchObject({
      evidence: "Live accepted",
      bytes: 2_062_912,
      sha256: "363170139a06f306be1e894b6f203a9bf03bf4d70d21194aaccdd1c42f760c32",
    });
    expect(byId["clock-timer"].regions).toBeUndefined();
    expect(byId["clock-timer"].notice).toMatch(/RAM-only/u);
    expect(byId["clock-timer"].scenePackage).toMatchObject({
      bytes: 95_535,
      sha256: "5b1b9a068e33b8b09f0596b49df0b7f79e22f05ee1f21ce7939b6c6965753ac7",
      expectedGeneration: 1,
      generation: 2,
      chunks: 32,
      actionLabel: "Enable clock & timer",
    });
    // The Weather firmware persists clock+timer to flash itself, so its card
    // gets a distinct, fallback-labeled push descriptor for the same
    // underlying RAM-only package (same bytes/sha/generation).
    expect(byId["weather-mquickjs"].scenePackage).not.toBe(byId["clock-timer"].scenePackage);
    expect(byId["weather-mquickjs"].scenePackage).toMatchObject({
      bytes: 95_535,
      sha256: "5b1b9a068e33b8b09f0596b49df0b7f79e22f05ee1f21ce7939b6c6965753ac7",
      expectedGeneration: 1,
      generation: 2,
      chunks: 32,
      actionLabel: "Push clock & timer again (normally not needed — firmware restores it at boot)",
    });
  });

  it("declares the weather canary as an ordered four-region write", () => {
    const weather = byId["weather-mquickjs"];
    expect(weather.evidence).toBe("Live tested canary");
    expect(weather.evidenceTone).toBe("caution");
    expect(weather.notice).toMatch(/Diag-track build/u);
    expect(weather.notice).toMatch(/2026-08-18/u);
    expect(weather.notice).toMatch(/not go through the audited release pipeline/u);
    expect(weather.notice).toMatch(/host companion/u);
    expect(weather.notice).toMatch(/Includes everything from Clock \+ Timer/u);
    expect(weather.notice).toMatch(/persists the pushed clock\+timer render-v2 package to flash slot B/u);
    expect(weather.notice).toMatch(/boot-adopt \+ persist-on-push/u);
    expect(weather.notice).toMatch(/Bluetooth reconnect patch/u);
    expect(weather.notice).toMatch(/does not fix the Mac reconnect issue yet/u);

    expect(weather.regions.map(({ address, kind, bytes, sha256 }) => ({ address, kind, bytes, sha256 }))).toEqual([
      {
        address: 0x240000,
        kind: "page",
        bytes: 95_599,
        sha256: "599be673ca9aba43a1fc64ec73324137919df70d9475ff8477100aa57cf0008f",
      },
      {
        address: 0x210000,
        kind: "page",
        bytes: 131_072,
        sha256: "f69859e052a8b209faea91ba57e332e5b0ef9698c2431ecf5bd9c832a7433477",
      },
      {
        address: 0x230000,
        kind: "page",
        bytes: 65_536,
        sha256: "6a11369374da2d1ce51a62b7bc05ee517e15746feb97c8c5cb4d2c5f1178ede7",
      },
      {
        address: 0x10000,
        kind: "app",
        bytes: 2_062_912,
        sha256: "5413d4b8735b437048a731b231cd874ae7d261c218dce50710722a9d7e8565dd",
      },
    ]);
    // The slot-B page is 95,599 bytes -- not a multiple of the 4 KiB flash
    // sector size -- and region validation accepts it unpadded.
    expect(weather.regions[0].bytes % 4096).not.toBe(0);
    expect(() => assertRegionPlan(weather.regions)).not.toThrow();
    expect(weather.sha256).toBe(weather.regions.at(-1).sha256);
    expect(weather.bytes).toBe(weather.regions.at(-1).bytes);
  });

  it("keeps the write-scope allowlist minimal and includes the new slot-B address", () => {
    expect(ALLOWED_REGION_ADDRESSES).toEqual([0x10000, 0x210000, 0x230000, 0x240000]);
  });

  it("links the weather host companion without importing the archive", () => {
    expect(byId["weather-mquickjs"].hostCompanion).toMatchObject({
      url: "./downloads/framer-f1-weather-host-macos.zip",
      filename: "framer-f1-weather-host-macos.zip",
      platform: "macOS",
    });
    // The archive is produced separately; the catalog only references it.
    expect(byId["weather-mquickjs"].hostCompanion.url.startsWith("./downloads/")).toBe(true);
  });

  it("keeps every single-app card free of a region plan", () => {
    const multiRegion = firmwareCatalog.filter((firmware) => firmware.regions);
    expect(multiRegion.map(({ id }) => id)).toEqual(["weather-mquickjs"]);
  });
});
