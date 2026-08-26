// CI gate: no shipped example may render collided text on the stage.
// Run via `npm run check:presets` (vitest run ci/) — deliberately outside
// test/ so the protected 247-test contract stays untouched.
//
// WHAT THIS AUDITS ─ The glyph-grid examples lay spans into fixed-width grid
// tracks. A browser (the preview renderer, the raster-capture renderer, and
// the F2UP push all measure real browser boxes) renders each span as ONE grid
// item: a text run wider than its track overflows it and prints through its
// neighbors — the "12:34:56" ∩ "1" ∩ "0" collision that shipped on the stage.
// The shell fixes the known examples with a load-time stage-fidelity CSS
// patch (src/components/presetFidelity.ts); this audit replays the SAME
// patched source the shell loads and asserts, with conservative monospace
// metrics, that every text run fits the track it lands in. A new example (or
// a regressed patch) that would collide fails here before it ships.
//
// Text metrics: common monospace faces advance 0.55–0.602em per glyph
// (Consolas .55, JetBrains Mono .600, Courier New .6007, Menlo .6016); the
// audit charges 0.62em — an upper bound with margin — so a pass here holds on
// every realistic font stack.

import { describe, expect, it } from "vitest";
import { PRESETS, PRESET_ORDER } from "../src/presets/widgets";
import { presetStageCss } from "../src/components/presetFidelity";

const DEVICE_W = 100;
const GLYPH_ADVANCE_EM = 0.62;
const DEFAULT_FONT_PX = 16;

interface GridModel {
  fontPx: number;
  /** Track widths in px, in order. */
  columns: number[];
}

/** Root-class declarations, in source order (later rules override earlier —
 *  exactly how the browser cascades the appended stage patch). */
function rootDecls(css: string, rootClass: string): Map<string, string> {
  const decls = new Map<string, string>();
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(ruleRe)) {
    const selector = m[1].trim();
    if (selector !== `.${rootClass}`) continue;
    for (const decl of m[2].split(";")) {
      const i = decl.indexOf(":");
      if (i < 0) continue;
      decls.set(decl.slice(0, i).trim().toLowerCase(), decl.slice(i + 1).trim());
    }
  }
  return decls;
}

/** Parse `repeat(5, 20px)` / `60px 20px 20px` into track widths. */
function parseColumns(template: string): number[] {
  const repeat = /^repeat\(\s*(\d+)\s*,\s*([\d.]+)px\s*\)$/.exec(template.trim());
  if (repeat) return Array(Number(repeat[1])).fill(Number(repeat[2]));
  return template
    .trim()
    .split(/\s+/)
    .map((t) => {
      const px = /^([\d.]+)px$/.exec(t);
      if (!px) throw new Error(`unsupported track "${t}" in "${template}"`);
      return Number(px[1]);
    });
}

/** The grid model for a preset's STAGE css, or null when the root is not a
 *  fixed-track grid (absolutely-positioned presets audit trivially). */
function gridModel(id: string): GridModel | null {
  const widget = PRESETS[id];
  const css = presetStageCss(id, widget.css);
  const decls = rootDecls(css, widget.rootClass);
  if (decls.get("display") !== "grid") return null;
  const template = decls.get("grid-template-columns");
  if (!template) return null;
  const fontPx = Number(/^([\d.]+)px$/.exec(decls.get("font-size") ?? "")?.[1] ?? DEFAULT_FONT_PX);
  return { fontPx, columns: parseColumns(template) };
}

/** Every direct <span> text run, in DOM (auto-placement) order. */
function spanTexts(html: string): string[] {
  return [...html.matchAll(/<span[^>]*>([^<]*)<\/span>/g)].map((m) => m[1]);
}

/** Auto-place the runs and return every collision (ink wider than its track).
 *  Initial text is representative: every shipped target's pick()/formatTime
 *  variants have the same glyph count as its initial content. */
function collisions(model: GridModel, texts: string[]): string[] {
  const out: string[] = [];
  texts.forEach((text, i) => {
    const track = model.columns[i % model.columns.length];
    const ink = text.length * model.fontPx * GLYPH_ADVANCE_EM;
    if (ink > track) {
      out.push(`"${text}" needs ${ink.toFixed(1)}px in a ${track}px track`);
    }
  });
  return out;
}

const GLYPH_GRID_PRESETS = ["events", "focusDial", "pomodoro"];

it("audits every glyph-grid example (coverage cannot silently shrink)", () => {
  const audited = PRESET_ORDER.filter((p) => gridModel(String(p.id)) !== null).map((p) => String(p.id));
  for (const id of GLYPH_GRID_PRESETS) expect(audited).toContain(id);
});

it("the audit itself has teeth: the raw (unpatched) events grid collides", () => {
  // Sanity-check the detector against the known-bad layout this gate exists
  // for — if this stops failing on raw source, the audit went blind.
  const widget = PRESETS.events;
  const decls = rootDecls(widget.css, widget.rootClass);
  const model: GridModel = {
    fontPx: Number(/^([\d.]+)px$/.exec(decls.get("font-size") ?? "")?.[1] ?? DEFAULT_FONT_PX),
    columns: parseColumns(decls.get("grid-template-columns")!),
  };
  expect(collisions(model, spanTexts(widget.html)).length).toBeGreaterThan(0);
});

for (const p of PRESET_ORDER) {
  const id = String(p.id);
  describe(`preset "${p.label}" (${id}) on the stage`, () => {
    const model = gridModel(id);

    it("renders no collided text", () => {
      if (!model) return; // absolutely-positioned layout — no shared tracks
      expect(collisions(model, spanTexts(PRESETS[id].html))).toEqual([]);
    });

    it("stays inside the 100px device viewport", () => {
      if (!model) return;
      const total = model.columns.reduce((a, b) => a + b, 0);
      expect(total).toBeLessThanOrEqual(DEVICE_W);
    });
  });
}
