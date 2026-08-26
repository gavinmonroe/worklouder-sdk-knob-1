// Stage-fidelity patches for shipped examples — the shell-side companion to
// `preferredPresetSource` (pipeline.ts), which already rewrites an example's
// SCRIPT on load when that makes the pipeline greener. This module does the
// same for an example's CSS when that makes the preview render truthfully.
//
// WHY THIS EXISTS ─ The three glyph-grid examples (V2 events, Focus dial,
// Pomodoro) ship the SDK's original `repeat(5, 20px)` cell grid with
// multi-glyph targets ("12:34:56", "IDEAL", "WORK") sitting in single 20px
// cells. The DEVICE's fixed-glyph renderer flows one glyph per cell, so it
// never overlaps — but a real browser renders the whole span as one grid item
// that overflows its 20px track and collides with its neighbors
// ("12:34:56" printed through "1" and "0"). The preview iframe renders the
// widget's real HTML+CSS (a protected surface, as is src/presets/widgets.ts),
// so the fix happens where the script header fix already happens: the source
// the SHELL LOADS gives each glyph run a column wide enough for its longest
// variant. Only subset-safe properties are used (`grid-template-columns` is
// on cssScene's SAFE_DECL allowlist), so diagnostics stay clean and both
// Build F2JS and the F2UP raster push consume the same non-colliding layout.
//
// Guardrails:
//   * A patch applies ONLY when the preset's CSS still contains the exact
//     cell-grid marker it was written against — if widgets.ts ever revises an
//     example, the stale patch silently stands down instead of fighting it.
//   * ci/stage-collision.test.ts audits the SAME patched source this module
//     produces, so a future example (or a regressed patch) that would render
//     collided text on the stage fails CI before it ships.

/** The exact template these patches were written against. */
const CELL_GRID_MARKER = "grid-template-columns: repeat(5, 20px);";

/**
 * Column templates sized to each example's longest text run (monospace ink is
 * ~0.62em per glyph; every track below clears its occupant with margin):
 *
 *   events    — 12px Courier: "12:34:56" needs 8·7.2 = 57.6px → 60px, and the
 *               knob/host digits keep their 20px cells beside it, so the three
 *               live targets share the first row.
 *   focusDial — 12px mono: "IDEAL"/"FOCUS"/"BREAK" (36px) and "25:00" (36px)
 *               are ADJACENT, which no 100px 5-track row can hold; a single
 *               100px column renders every run on its own centered row — a
 *               vertical stack that suits the 100×310 portrait screen.
 *   pomodoro  — 16px mono (root sets no size): "WORK" needs 4·9.6 = 38.4px
 *               → 44px so a visible gap survives; "25", ":", "00" get
 *               20/12/20, so the first row reads "WORK 25:00" and the
 *               interpunct + cycle "1 / 4" wrap onto the next row.
 */
const STAGE_PATCH: Record<string, string> = {
  events: `

/* Stage-fidelity patch (applied by the designer shell on load): the device's
   fixed-glyph renderer flows one glyph per cell, but a browser renders each
   span as ONE grid item — "12:34:56" overflows a 20px track and collides
   with its neighbors. Wider tracks give every glyph run real room. */
.render-v2 { grid-template-columns: 60px 20px 20px; }
`,
  focusDial: `

/* Stage-fidelity patch (applied by the designer shell on load): "IDEAL" and
   "25:00" are adjacent 36px runs no five-track 100px row can hold without
   overlap; one full-width column stacks every run on its own centered row. */
.render-v2 { grid-template-columns: 100px; }
`,
  pomodoro: `

/* Stage-fidelity patch (applied by the designer shell on load): "WORK" is a
   38px run in a 20px track; sized tracks — with real air between runs — let
   the timer row render "WORK 25:00" cleanly, and the interpunct + cycle
   "1 / 4" wrap onto their own row. */
.render-v2 { grid-template-columns: 44px 20px 12px 20px; }
`,
};

/**
 * The CSS the shell loads for an example: the preset verbatim plus, for the
 * known glyph-grid examples, an appended subset-safe override that removes
 * text collisions in any faithful box renderer (browser preview, raster
 * capture, F2UP push). Unknown presets — and any preset whose CSS no longer
 * matches the cell-grid marker the patch was written against — load untouched.
 */
export function presetStageCss(id: string, css: string): string {
  const patch = STAGE_PATCH[id];
  if (!patch || !css.includes(CELL_GRID_MARKER)) return css;
  return css + patch;
}
