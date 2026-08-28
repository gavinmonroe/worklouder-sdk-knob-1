// The shareable .f1widget.json format: every preset must survive a
// share → open round trip byte-for-byte, and Open must reject anything
// malformed with a message a person can act on (never load broken state).

import { describe, expect, it } from "vitest";
import {
  parseWidgetFile,
  serializeWidgetFile,
  widgetFileName,
  WIDGET_FILE_VERSION,
} from "../src/designer/widgetFile";
import { PRESETS, PRESET_ORDER } from "../src/presets/widgets";

describe("widget file round trip", () => {
  for (const p of PRESET_ORDER) {
    it(`round-trips "${p.label}" exactly`, () => {
      const w = PRESETS[p.id];
      const json = serializeWidgetFile({
        name: w.name,
        rootClass: w.rootClass,
        html: w.html,
        css: w.css,
        js: w.script,
        hostData: w.hostData,
      });
      const back = parseWidgetFile(json);
      expect(back.name).toBe(w.name);
      expect(back.rootClass).toBe(w.rootClass);
      expect(back.html).toBe(w.html);
      expect(back.css).toBe(w.css);
      expect(back.js).toBe(w.script);
      if (w.hostData && Object.keys(w.hostData).length > 0) {
        expect(back.hostData).toEqual(w.hostData);
      } else {
        expect(back.hostData).toBeUndefined();
      }
    });
  }

  it("the file is human-diffable JSON with the format marker first", () => {
    const json = serializeWidgetFile({
      name: "X", rootClass: "x", html: "<b/>", css: "", js: "",
    });
    expect(json.startsWith('{\n  "format": "f1widget"')).toBe(true);
    expect(json.endsWith("\n")).toBe(true);
  });

  it("carries attached images and upgrades them through the v2 format", () => {
    const assets = {
      cloud: {
        id: "cloud",
        name: "cloud.png",
        mimeType: "image/png" as const,
        data: "AQID",
        bytes: 3,
        width: 24,
        height: 12,
      },
    };
    const json = serializeWidgetFile({
      name: "Cloud", rootClass: "cloud", html: '<img src="asset://cloud">', css: "", js: "", assets,
    });
    expect(parseWidgetFile(json).assets).toEqual(assets);
  });

  it("still opens v1 source-only widget files", () => {
    const file = JSON.parse(serializeWidgetFile({
      name: "Old", rootClass: "old", html: "<div/>", css: "", js: "",
    }));
    file.version = 1;
    delete file.assets;
    const parsed = parseWidgetFile(JSON.stringify(file));
    expect(parsed.version).toBe(WIDGET_FILE_VERSION);
    expect(parsed.assets).toBeUndefined();
  });
});

describe("widget file rejection", () => {
  const valid = () =>
    JSON.parse(serializeWidgetFile({
      name: "Widget", rootClass: "w", html: "<span/>", css: ".w{}", js: "var a = 0;",
    })) as Record<string, unknown>;

  it("rejects non-JSON", () => {
    expect(() => parseWidgetFile("not json {")).toThrow(/not valid JSON/);
  });

  it("rejects JSON that is not an object", () => {
    expect(() => parseWidgetFile("[1,2]")).toThrow(/expected a JSON object/);
  });

  it("rejects a missing format marker", () => {
    const f = valid();
    delete f.format;
    expect(() => parseWidgetFile(JSON.stringify(f))).toThrow(/format marker/);
  });

  it("rejects a future version with an actionable message", () => {
    const f = valid();
    f.version = WIDGET_FILE_VERSION + 1;
    expect(() => parseWidgetFile(JSON.stringify(f))).toThrow(/Update the Designer/);
  });

  it("rejects a missing source field by name", () => {
    const f = valid();
    delete f.css;
    expect(() => parseWidgetFile(JSON.stringify(f))).toThrow(/"css"/);
  });

  it("rejects an absurdly large field instead of loading it", () => {
    const f = valid();
    f.js = "x".repeat(200_001);
    expect(() => parseWidgetFile(JSON.stringify(f))).toThrow(/Refusing to load/);
  });

  it("rejects a non-object hostData", () => {
    const f = valid();
    f.hostData = [1];
    expect(() => parseWidgetFile(JSON.stringify(f))).toThrow(/hostData/);
  });

  it("rejects malformed or mismatched asset records", () => {
    const f = valid();
    f.assets = { cloud: { id: "other", name: "cloud.png", mimeType: "image/png", data: "AQID", bytes: 3, width: 1, height: 1 } };
    expect(() => parseWidgetFile(JSON.stringify(f))).toThrow(/mismatched id/);
  });
});

describe("widget file naming", () => {
  it("slugs display names into safe filenames", () => {
    expect(widgetFileName("Focus timer")).toBe("focus-timer.f1widget.json");
    expect(widgetFileName("  Weather (v3)! ")).toBe("weather-v3.f1widget.json");
    expect(widgetFileName("")).toBe("widget.f1widget.json");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Named feeds: a designer subscribes by name and never types a channel number.
// Two guarantees are load-bearing and easy to break silently, so they are
// pinned here:
//   1. PINNED_FEEDS keep the EXACT ids the shipped feeders already send —
//      renaming must never silently move a widget onto a dead channel.
//   2. Derived ids are stable: the same name must mean the same channel on
//      every machine and across rebuilds, or a shared widget stops receiving.
// ─────────────────────────────────────────────────────────────────────────────

import {
  PINNED_FEEDS,
  DEVICE_FEEDS,
  transpileWidgetScript,
  userFeedId,
  userFeedSlug,
} from "../src/compiler/mquickjsTranspiler";
import { ALL_EVENT_KINDS } from "../src/compiler/constants";

describe("named feeds", () => {
  it("keeps the wire ids the shipped feeders already send", () => {
    expect(PINNED_FEEDS["feed.weather-now"].id).toBe(0xb241);
    expect(PINNED_FEEDS["feed.forecast-day-1"].id).toBe(0xb242);
    expect(PINNED_FEEDS["feed.forecast-day-2"].id).toBe(0xb243);
    expect(PINNED_FEEDS["feed.wall-clock-time"].id).toBe(0xb250);
    expect(DEVICE_FEEDS["device.typing-speed"].id).toBe(0xb2f2);
  });

  it("compiles the bundled examples onto exactly those ids", () => {
    const clock = transpileWidgetScript(PRESETS.clock.script);
    expect(clock.events.hostRpcIds).toEqual([0xb250]);
    const weather = transpileWidgetScript(PRESETS.weatherDevice.script);
    expect(weather.events.hostRpcIds).toEqual([0xb241, 0xb242, 0xb243]);
    const lab = transpileWidgetScript(PRESETS.eventLab.script);
    expect(lab.events.hostRpcIds).toEqual([0xb2f2]);
  });

  it("no bundled example makes a designer type a channel number", () => {
    for (const p of PRESET_ORDER) {
      expect(PRESETS[p.id].script).not.toMatch(/host\.rpc:/);
      expect(PRESETS[p.id].html).not.toMatch(/0x[0-9A-Fa-f]{3,}/);
    }
  });

  it("derives a stable channel from a name, in the user range", () => {
    const id = userFeedId(userFeedSlug("Room Temp"));
    expect(id).toBe(userFeedId("room-temp"));
    expect(id).toBeGreaterThanOrEqual(0xc000);
    expect(id).toBeLessThanOrEqual(0xfeff);
    // Same name, same channel — a shared widget keeps receiving.
    expect(userFeedId("room-temp")).toBe(userFeedId("room-temp"));
  });

  it("every completion the editor offers actually compiles", () => {
    // The editor once offered a bare "host.rpc" selector the compiler rejects,
    // walking the user into an error. Never again.
    for (const kind of ALL_EVENT_KINDS) {
      const script =
        `var v = 0;\nwidget.on(${JSON.stringify(kind.canonical)}, function (event) {\n` +
        `  document.querySelector("#v").textContent = digits(v, 3);\n});`;
      const unknown = transpileWidgetScript(script).diagnostics.filter(
        (d) => d.severity === "error" && /Unknown event selector/.test(d.message),
      );
      expect(unknown, `completion "${kind.canonical}" does not compile`).toEqual([]);
    }
  });

  it("refuses the compiler's private slot API inside a handler", () => {
    // widget.setInt used to pass through and silently overwrite a render slot.
    const script =
      `var v = 0;\nwidget.on("tick.1s", function (event) {\n  widget.setInt(3, 7);\n});`;
    const out = transpileWidgetScript(script);
    expect(out.diagnostics.some((d) => d.severity === "error" && /widget\.setInt/.test(d.message))).toBe(true);
    expect(out.deviceSource).not.toMatch(/setInt\(3/);
  });
});
