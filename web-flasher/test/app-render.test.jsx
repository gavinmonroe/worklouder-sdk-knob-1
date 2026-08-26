import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import App, { ScenePackageNotice, WriteScopeAddresses } from "../src/App.jsx";
import { firmwareCatalog } from "../src/data/firmware.js";

const byId = Object.fromEntries(firmwareCatalog.map((firmware) => [firmware.id, firmware]));
const idleScene = { phase: "idle", progress: 0, error: "", result: null, busy: false };

describe("catalog page", () => {
  it("renders every card without a device", () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain("Framer F1 Flasher");
    for (const firmware of firmwareCatalog) {
      expect(html).toContain(firmware.name);
      expect(html).toContain(firmware.evidence);
    }
    expect(html).toContain("6 widgets");
  });
});

describe("write-scope addresses", () => {
  it("shows one address for a single-app card", () => {
    const html = renderToStaticMarkup(<WriteScopeAddresses firmware={byId.music} />);
    expect(html).toContain("0x10000");
    expect(html).not.toContain("0x210000");
  });

  it("lists all four weather regions in write order", () => {
    const html = renderToStaticMarkup(<WriteScopeAddresses firmware={byId["weather-mquickjs"]} />);
    expect(html.indexOf("0x240000")).toBeLessThan(html.indexOf("0x210000"));
    expect(html.indexOf("0x210000")).toBeLessThan(html.indexOf("0x230000"));
    expect(html.indexOf("0x230000")).toBeLessThan(html.indexOf("0x10000"));
    expect(html).toContain("Clock + Timer scene slot B (persisted)");
    expect(html).toContain("MicroQuickJS text page");
    expect(html).toContain("MicroQuickJS rodata page");
    expect(html).toContain("Weather app");
  });
});

describe("scene package action", () => {
  it("is absent for cards without a RAM-only package", () => {
    expect(
      renderToStaticMarkup(
        <ScenePackageNotice firmware={byId.music} scene={idleScene} supported onEnable={() => {}} />,
      ),
    ).toBe("");
  });

  it("offers the enable action on clock-timer", () => {
    const html = renderToStaticMarkup(
      <ScenePackageNotice firmware={byId["clock-timer"]} scene={idleScene} supported onEnable={() => {}} />,
    );
    expect(html).toContain("Enable clock &amp; timer");
    expect(html).toContain("32 chunks");
    expect(html).toContain("generation 1 → 2");
    expect(html).toMatch(/RAM, not flash/u);
    expect(html).toContain("after every power cycle");
  });

  it("offers only the fallback push action on weather-mquickjs, since firmware persists it", () => {
    const html = renderToStaticMarkup(
      <ScenePackageNotice firmware={byId["weather-mquickjs"]} scene={idleScene} supported onEnable={() => {}} />,
    );
    expect(html).toContain("Push clock &amp; timer again");
    expect(html).toContain("normally not needed");
    expect(html).toContain("firmware restores it at boot");
    expect(html).not.toContain("Enable clock &amp; timer");
    expect(html).toContain("32 chunks");
    expect(html).toContain("generation 1 → 2");
  });

  it("surfaces a rejected begin and the acknowledged commit", () => {
    const rejected = renderToStaticMarkup(
      <ScenePackageNotice
        firmware={byId["clock-timer"]}
        scene={{ ...idleScene, phase: "scene-error", error: "already enabled this boot, or power-cycle and retry" }}
        supported
        onEnable={() => {}}
      />,
    );
    expect(rejected).toContain("already enabled this boot");
    expect(rejected).toContain("scene-error");

    const enabled = renderToStaticMarkup(
      <ScenePackageNotice
        firmware={byId["clock-timer"]}
        scene={{
          ...idleScene,
          phase: "enabled",
          progress: 100,
          result: { status: "FOCUS_TIMER_PACKAGE_COMMIT_ACKNOWLEDGED", alreadyEnabled: false, generation: 2, chunks: 32 },
        }}
        supported
        onEnable={() => {}}
      />,
    );
    expect(enabled).toContain("Enabled (generation 2)");
    expect(enabled).toContain("32 chunks accepted");
    expect(enabled).toContain("Push again");
  });

  it("reports an already-enabled-by-firmware result without implying a push happened", () => {
    const alreadyEnabled = renderToStaticMarkup(
      <ScenePackageNotice
        firmware={byId["clock-timer"]}
        scene={{
          ...idleScene,
          phase: "enabled",
          progress: 100,
          result: { status: "FOCUS_TIMER_PACKAGE_ALREADY_ENABLED", alreadyEnabled: true,
            generation: 4, reason: "committed-sha-match" },
        }}
        supported
        onEnable={() => {}}
      />,
    );
    expect(alreadyEnabled).toContain("Already enabled by firmware (generation 4)");
    expect(alreadyEnabled).not.toContain("Enabled (generation 4)");
  });

  it("disables the action when WebHID is unavailable", () => {
    const html = renderToStaticMarkup(
      <ScenePackageNotice firmware={byId["clock-timer"]} scene={idleScene} supported={false} onEnable={() => {}} />,
    );
    expect(html).toContain("disabled");
  });
});
