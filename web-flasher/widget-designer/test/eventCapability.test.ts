// Which presets can ship as an F2EP event program, and — for the ones that
// cannot — whether the Designer relays the compiler's real objection.
//
// These numbers are the contract the preset strip advertises. A preset that
// silently stops compiling drops to replayed frames, where the knob does
// nothing, and nothing else in the app would notice.

import { describe, expect, it } from "vitest";

import "../src/compat/install";
import { prepareRenderV2 } from "@sdk/render-v2/compiler.mjs";

import { describeEventCapability } from "../src/compiler/eventCapability";
import { PRESETS } from "../src/presets/widgets";
import { LEGACY_PRESETS } from "./fixtures/legacyPresets";

/** Presets that compile, and the binding count each one drives. */
const EVENT_DRIVEN: Record<string, number> = {
  events: 8,
  focusDial: 3,
  pomodoro: 3,
};

describe("preset event capability", () => {
  for (const [id, bindingCount] of Object.entries(EVENT_DRIVEN)) {
    it(`compiles ${id} to ${bindingCount} bindings`, () => {
      expect(describeEventCapability(LEGACY_PRESETS[id])).toEqual({ supported: true, bindingCount });
    });
  }

  it("reports weather as frames-only because of its nested markup", () => {
    const capability = describeEventCapability(LEGACY_PRESETS.weather);
    expect(capability.supported).toBe(false);
    expect(capability.bindingCount).toBeUndefined();
    // The weather widget is a real HTML/CSS raster: divs for the mark, the
    // temperature card and the forecast rows. The render-v2 cell model admits
    // direct spans only, so it can never be an event program without being
    // redrawn as a glyph grid.
    expect(capability.reason).toBe("Render v2 root must contain only direct span children.");
  });

  it("covers every shipped preset", () => {
    // Every preset the Designer now ships is a REAL mquickjs-DSL widget
    // (docs/17-era roster): none of them is an F2EP event-program build, so
    // the event-capability probe reports each as frames-only.
    expect(Object.keys(PRESETS).sort()).toEqual(
      ["clock", "counter", "eventLab", "focusTimer", "metronome", "weatherDevice"].sort());
    for (const preset of Object.values(PRESETS))
      expect(describeEventCapability(preset).supported).toBe(false);
  });
});

describe("event capability reasons", () => {
  it("relays the SDK's own message rather than a generic one", () => {
    const widget = LEGACY_PRESETS.weather;
    let sdkMessage = "";
    try {
      prepareRenderV2({
        html: widget.html, css: widget.css, script: widget.script, rootClass: widget.rootClass,
      });
    } catch (error) {
      sdkMessage = (error as Error).message;
    }
    expect(sdkMessage).not.toBe("");
    expect(describeEventCapability(widget).reason).toBe(sdkMessage);
  });

  it("names the script restriction a comment trips, not just 'unsupported'", () => {
    const capability = describeEventCapability({
      ...LEGACY_PRESETS.events,
      script: `// a comment the render-v2 grammar rejects\n${LEGACY_PRESETS.events.script}`,
    });
    expect(capability).toEqual({
      supported: false,
      reason: "Render script forbids comments, template strings, and single-quoted strings.",
    });
  });

  it("names the offending CSS selector when a rule leaves the subset", () => {
    const capability = describeEventCapability({
      ...LEGACY_PRESETS.events,
      css: `${LEGACY_PRESETS.events.css}\n#clock { color: #FFB74D; }`,
    });
    expect(capability.supported).toBe(false);
    // CssCompileError only counts the failures in its message; the per-selector
    // detail lives in `diagnostics`. Pinning the count keeps the helper honest
    // about surfacing the compiler's text verbatim.
    expect(capability.reason).toBe("CSS compilation failed with 1 unsupported construct(s).");
  });
});
