import { describe, expect, it } from "vitest";

import { defaultFirmwareId, firmwareCatalog } from "../src/data/firmware.js";

describe("widget catalog policy", () => {
  it("exposes the requested widgets in order", () => {
    expect(firmwareCatalog.map(({ name }) => name)).toEqual([
      "WPM Pet",
      "Music",
      "Custom HTML / CSS Preview",
    ]);
    expect(defaultFirmwareId).toBe("wpm-pet");
    expect(firmwareCatalog.map(({ includes }) => includes)).toEqual([
      ["WPM Pet"],
      ["WPM Pet", "Music"],
      ["WPM Pet", "Music", "Custom HTML / CSS Preview"],
    ]);
    expect(firmwareCatalog[2].compilerUrl).toBe("https://htmlcss-to-framerf1-widget.g-m.dev");
    expect(firmwareCatalog[0].hostCompanion).toBeUndefined();
    expect(firmwareCatalog[1].hostCompanion).toEqual({
      url: "./downloads/framer-f1-music-host-macos.zip",
      filename: "framer-f1-music-host-macos.zip",
      platform: "macOS",
    });
    expect(firmwareCatalog[2].hostCompanion).toBe(firmwareCatalog[1].hostCompanion);
    expect(firmwareCatalog[1]).toMatchObject({
      bytes: 2_032_368,
      sha256: "b9b8eec6250392f593ae664fa8b8cba64bf861f5ef49a427c65be79e6f355817",
    });
  });

  it("exposes the smoke-approved renderer with an explicit warning", () => {
    expect(firmwareCatalog.map(({ flashable }) => flashable)).toEqual([true, true, true]);
    expect(firmwareCatalog[2].evidence).toBe("Smoke candidate");
    expect(firmwareCatalog[2].notice).toMatch(/not yet live accepted/u);
  });
});
