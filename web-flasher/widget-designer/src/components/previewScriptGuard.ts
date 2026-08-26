// ─────────────────────────────────────────────────────────────────────────────
// Preview script guard.
//
// The srcdoc runtime (compiler/widgetRuntime.ts) inlines the author's script
// inside a try/catch, but a PARSE error is not catchable that way: the whole
// inline <script> block fails at parse time and the browser logs a raw
// uncaught SyntaxError from the sandbox to the console — twice, once per live
// preview iframe — while the author is still mid-keystroke.
//
// Routing the source through an indirect eval turns that parse failure into a
// catchable runtime exception, so it lands in window.__widgetError — the same
// channel the runtime's own try/catch uses — and surfaces through the
// Diagnostics panel instead of leaking to the console.
//
// Semantics are preserved: (0, eval) is an indirect eval, so it executes in
// the sandbox's GLOBAL scope exactly like the inlined script did — the
// widget/mod/pick intrinsics resolve, and the script's own top-level `var`
// and function declarations still become globals for later dispatches.
// ─────────────────────────────────────────────────────────────────────────────

export function guardWidgetScript(script: string): string {
  return [
    "try {",
    `  (0, eval)(${JSON.stringify(script)});`,
    "} catch (e) {",
    "  window.__widgetError = String(e && e.message || e);",
    "}",
  ].join("\n");
}
