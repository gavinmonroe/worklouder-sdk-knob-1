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
});

describe("widget file naming", () => {
  it("slugs display names into safe filenames", () => {
    expect(widgetFileName("Focus timer")).toBe("focus-timer.f1widget.json");
    expect(widgetFileName("  Weather (v3)! ")).toBe("weather-v3.f1widget.json");
    expect(widgetFileName("")).toBe("widget.f1widget.json");
  });
});
