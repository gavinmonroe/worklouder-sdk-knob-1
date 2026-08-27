// Presentation-layer view over the store's raw diagnostics — and the ONE
// severity taxonomy for the whole shell.
//
// Every surface that shows a diagnostic (Inspector rows, Export callouts, the
// footer counter, compile toasts) reads through this module, so a given
// condition carries the same level, icon, color, and noun everywhere:
//
//   error   → red    · x-circle       · "error"    (the pipeline failed)
//   warning → amber  · alert-triangle · "warning"  (built, but degraded)
//   info    → blue   · info           · "notice"   (informational; e.g. the
//             strict-simulator notice on preview-only example scripts)
//
// The strict-simulator notice ("Simulator requires exact strict F2JS source.")
// is a *packaging* limitation, not a defect: the live preview renders the
// widget's real DOM regardless, so shipped presets that use preview-only
// JavaScript must not boot the app into a red error state. The store (and the
// compiler that throws the TypeError) are protected surfaces, so the
// reclassification to an informational notice happens here.

import { javascriptLanguage } from "@codemirror/lang-javascript";
import type { DesignerState } from "../designer/store";
import type { CompileDiagnostic } from "../types";
import { RENDER_V2_MQUICKJS_SOURCE_PREFIX } from "../compiler/constants";
import { createMquickjsSimulator } from "../compiler/mquickjsSimulator";
import type { IconName } from "./icons";

export type DiagnosticSeverity = "error" | "warning" | "info";

/** The one severity → presentation mapping. Never restyle a level locally. */
export const SEVERITY_META: Record<
  DiagnosticSeverity,
  {
    /** The noun the UI counts ("1 error", "2 notices"). */
    noun: string;
    badgeTone: "danger" | "warning" | "info";
    calloutTone: "danger" | "warning" | "info";
    dot: "error" | "warn" | "info";
    icon: IconName;
  }
> = {
  error: { noun: "error", badgeTone: "danger", calloutTone: "danger", dot: "error", icon: "x-circle" },
  warning: { noun: "warning", badgeTone: "warning", calloutTone: "warning", dot: "warn", icon: "alert-triangle" },
  info: { noun: "notice", badgeTone: "info", calloutTone: "info", dot: "info", icon: "info" },
};

export interface DiagnosticViewItem {
  severity: DiagnosticSeverity;
  message: string;
  source: CompileDiagnostic["source"];
  /** True for items this view reclassified from error → informational. */
  reclassified?: boolean;
  /** 1-based position in the owning buffer, when the view could derive one —
   *  the same position the editor's lint gutter marks, so "line 12" here and
   *  the gutter dot always agree. */
  line?: number;
  col?: number;
}

export interface DiagnosticsView {
  items: DiagnosticViewItem[];
  errors: number;
  warnings: number;
  /** Reclassified notices only — handler-inference chatter is not counted. */
  notices: number;
  /**
   * Set when the script is DELIBERATELY preview-only: it parses cleanly but
   * uses a preview-runtime API (widget.snapshot / widget.animate) the strict
   * F2JS VM does not provide, so no header edit could ever satisfy the strict
   * simulator. That is a *mode* of the widget, not a defect of its source —
   * it renders as a quiet mode note in the Inspector, never as a counted
   * notice, so shipped preview-only examples load with "No issues".
   * `api` names the preview API when one could be identified.
   */
  previewOnly: { api: string | null } | null;
  /** The strict F2JS parser rejected the script, so packaging cannot run. */
  simBlocked: boolean;
  /**
   * Best single message naming the current F2JS *build* blocker, if any.
   * Widget-upload (F2UP assemble) failures are excluded — they belong to the
   * Export tab's container card, never to the build card's banner.
   */
  buildBlocker: string | null;
}

const SIM_STRICT = /Simulator requires exact strict F2JS source/;
/** The one shell-synthesized diagnostic: the markup carries no root-class
 *  element, so the widget's CSS anchors nothing and the screen is a void.
 *  Kept here so every surface (footer count, Inspector rows, stage HUD)
 *  agrees on the wording — and it names the field by the label the Design
 *  rail actually shows, "Wrapper class". Sending someone to look for a "root
 *  class" field they cannot find is the same dead end as saying nothing. */
export const EMPTY_RENDER_MESSAGE =
  "Nothing rendered — no element in your HTML carries the widget's wrapper class, so your CSS and script anchor to nothing. Match the Wrapper class on the Design tab to the class on your outermost <div>, or add it there.";

/**
 * True when the widget markup contains no element carrying the root class —
 * e.g. the HTML buffer was replaced with plain text. Every renderer (preview
 * iframe, raster capture, device facade) hangs the widget off that root, so
 * without it the aperture paints a bare void while the script still parses;
 * the compiled-scene box count is NOT usable here, because raster presets
 * (weather) legitimately compile to zero subset boxes yet render fully.
 */
export function isEmptyRender(state: DesignerState): boolean {
  const root = state.rootClass.trim();
  if (root === "") return false; // no contract to check against
  // An element whose class attribute contains the root class as a whole token.
  for (const m of state.html.matchAll(/<[a-zA-Z][^>]*\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    if ((m[1] ?? m[2] ?? "").split(/\s+/).includes(root)) return false;
  }
  return true;
}
/** Handler-inference chatter ("Handler #1: tick.1s") — the Handlers accordion
 *  already lists these; they are inference notes, not diagnostics. */
const HANDLER_CHATTER = /^Handler #\d+:/;
const UPLOAD_PREFIX = /^widget upload:/;
/**
 * Device-build diagnostics ("event-driven: …", "render-v2: …") are OWNED by
 * the Device tab, single-sourced through the shared deviceBuild status (which
 * a later successful build or source edit actually retracts). The store's
 * list is append-only — counting these here would leave the footer claiming
 * an error that no surviving surface still shows, and that a mode-switched
 * successful rebuild can never clear. They are filtered out of this view and
 * counted by the footer from the deviceBuild record instead.
 */
export const DEVICE_BUILD_PREFIX = /^(?:event-driven|render-v2):/;

// ── Panel-side source lint ───────────────────────────────────────────────────
// The compiler is a protected surface, and it is *forgiving* in exactly the
// wrong places for authors: junk pasted after the markup is swallowed as a
// perfectly valid HTML text node, and a script the strict parser rejects
// surfaces only as the (reclassified, informational) strict-header notice.
// Both leave Diagnostics reading "OK" while the author stares at a mistake.
// This lint runs over the raw buffers here in the view layer, so the most
// common authoring errors actually reach an error/warning row.

/** First non-whitespace run of text sitting OUTSIDE every element — the HTML
 *  parser keeps it as a top-level text node the device renderer never draws. */
export function findStrayTopLevelText(html: string): string | null {
  // DOMParser (browser) is authoritative: parse the fragment and look for
  // non-whitespace text nodes that are direct children of <body>.
  if (typeof DOMParser !== "undefined") {
    try {
      const doc = new DOMParser().parseFromString(html, "text/html");
      for (const node of Array.from(doc.body.childNodes)) {
        if (node.nodeType === 3 /* TEXT_NODE */) {
          const text = (node.textContent ?? "").trim();
          if (text !== "") return text;
        }
      }
      return null;
    } catch {
      /* fall through to the tokenizer */
    }
  }
  // Non-DOM environments: a small depth tokenizer over the fragment.
  const VOID = /^(?:area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)$/i;
  let depth = 0;
  let i = 0;
  while (i < html.length) {
    if (html.startsWith("<!--", i)) {
      const end = html.indexOf("-->", i);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html[i] === "<") {
      const end = html.indexOf(">", i);
      if (end === -1) break;
      const tag = html.slice(i, end + 1);
      const name = /^<\/?([a-zA-Z][a-zA-Z0-9-]*)/.exec(tag)?.[1] ?? "";
      if (tag[1] === "/") depth = Math.max(0, depth - 1);
      else if (name !== "" && !VOID.test(name) && !tag.endsWith("/>")) depth += 1;
      i = end + 1;
      continue;
    }
    if (depth === 0 && !/\s/.test(html[i])) {
      const run = /^[^<]+/.exec(html.slice(i))?.[0] ?? html[i];
      return run.trim();
    }
    i += 1;
  }
  return null;
}

/** Syntax-check the script buffer (parse only — nothing executes). Returns the
 *  parser's own message on failure, null when the script parses. */
export function scriptParseError(js: string): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function(js);
    return null;
  } catch (err) {
    return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  }
}

/** offset → 1-based line/column. */
function positionAt(text: string, offset: number): { line: number; col: number } {
  const upTo = text.slice(0, Math.max(0, offset));
  const lastBreak = upTo.lastIndexOf("\n");
  return { line: upTo.split("\n").length, col: offset - lastBreak };
}

/**
 * Where the script breaks, per the SAME grammar the editor lints with (the
 * lezer JS parser behind the Source tab's gutter dot) — so "line 12" in an
 * Inspector row and the in-editor marker always name the same spot. Null when
 * the tree carries no error node (e.g. a runtime-only failure).
 */
export function scriptErrorPosition(js: string): { line: number; col: number } | null {
  try {
    const tree = javascriptLanguage.parser.parse(js);
    let found: number | null = null;
    tree.iterate({
      enter(node) {
        if (found !== null) return false;
        if (node.type.isError) {
          found = node.from;
          return false;
        }
        return undefined;
      },
    });
    return found === null ? null : positionAt(js, found);
  } catch {
    return null;
  }
}

/**
 * V8 prefix-probe: the first line whose prefix already fails with the SAME
 * message the full script fails with — i.e. the line the author actually
 * broke. Lezer's recovery often parks its error node far downstream (an
 * unclosed anonymous function surfaces at EOF); V8's own message appears the
 * moment the offending line enters the prefix, so this pins "Function
 * statements require a function name" to the `function () {` line itself.
 * Null when the script parses or the failure never localizes.
 */
export function scriptErrorProbeLine(js: string): number | null {
  const full = scriptParseError(js);
  if (full === null) return null;
  const lines = js.split("\n");
  if (lines.length > 2000) return null; // pathological paste — skip the O(n²) probe
  for (let i = 0; i < lines.length; i += 1) {
    const prefix = lines.slice(0, i + 1).join("\n");
    try {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      new Function(prefix);
    } catch (err) {
      const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      if (msg === full) return i + 1;
    }
  }
  return null;
}

// viewDiagnostics runs on every render of every diagnostic surface; the lint
// only re-runs when a buffer actually changed.
let lintCache: { html: string; js: string; items: DiagnosticViewItem[] } | null = null;

function lintSource(html: string, js: string): DiagnosticViewItem[] {
  if (lintCache && lintCache.html === html && lintCache.js === js) return lintCache.items;
  const items: DiagnosticViewItem[] = [];
  const parseError = scriptParseError(js);
  if (parseError !== null) {
    // The V8 probe names the line the author broke; the lezer position adds
    // the column when both agree (otherwise the column would lie).
    const probeLine = scriptErrorProbeLine(js);
    const pos = scriptErrorPosition(js);
    const line = probeLine ?? pos?.line;
    const col = pos && pos.line === line ? pos.col : undefined;
    items.push({
      severity: "error",
      source: "script",
      message: `The script does not parse — packaging and the simulator will both reject it.\n${parseError}`,
      ...(line !== undefined ? { line } : {}),
      ...(col !== undefined ? { col } : {}),
    });
  }
  const stray = findStrayTopLevelText(html);
  if (stray !== null) {
    const snippet = stray.length > 60 ? `${stray.slice(0, 57)}…` : stray;
    const idx = html.indexOf(stray);
    items.push({
      severity: "warning",
      source: "html",
      message: `Stray text outside any element is silently dropped by the renderer.\nThe HTML parser kept “${snippet}” as a bare text node — wrap it in an element or delete it.`,
      ...(idx >= 0 ? positionAt(html, idx) : {}),
    });
  }
  lintCache = { html, js, items };
  return items;
}

// ── Preview-only mode probe ──────────────────────────────────────────────────
// A script that parses as JavaScript but still fails the strict simulator WITH
// the canonical header prepended is preview-only by design (it leans on
// preview-runtime APIs the strict VM lacks). Cached per source — the probe
// evaluates the script once, exactly like the preset strip's capability probe.

let previewOnlyCache: { js: string; inherent: boolean; api: string | null } | null = null;

function inherentlyPreviewOnly(js: string): { inherent: boolean; api: string | null } {
  if (previewOnlyCache && previewOnlyCache.js === js) return previewOnlyCache;
  let inherent = false;
  let api: string | null = null;
  if (!js.startsWith(RENDER_V2_MQUICKJS_SOURCE_PREFIX) && scriptParseError(js) === null) {
    try {
      createMquickjsSimulator(RENDER_V2_MQUICKJS_SOURCE_PREFIX + js);
      // The header alone satisfies the strict VM → the notice stays
      // actionable ("add the use-strict header"), not a mode.
    } catch {
      inherent = true;
      api = /widget\s*\.\s*snapshot\s*\(/.test(js)
        ? "widget.snapshot"
        : /widget\s*\.\s*animate\s*\(/.test(js)
          ? "widget.animate"
          : null;
    }
  }
  previewOnlyCache = { js, inherent, api };
  return previewOnlyCache;
}

export function viewDiagnostics(state: DesignerState): DiagnosticsView {
  const items: DiagnosticViewItem[] = [];
  const seen = new Set<string>();
  // Captured even when the strict notice is absorbed into preview-only mode:
  // the Export tab's build blocker still needs the exact wording.
  let strictMessage: string | null = null;
  let previewOnly: DiagnosticsView["previewOnly"] = null;
  for (const d of state.diagnostics.items) {
    if (d.severity === "info" && HANDLER_CHATTER.test(d.message)) continue;
    // Device-build outcomes live on the Device tab (see DEVICE_BUILD_PREFIX).
    if (d.source === "compilation" && DEVICE_BUILD_PREFIX.test(d.message)) continue;
    if (d.severity === "error" && SIM_STRICT.test(d.message)) {
      strictMessage = d.message;
      // Deliberately preview-only scripts (widget.snapshot / widget.animate)
      // present the strict-VM gap as a MODE, never as a counted notice — a
      // shipped preview-only example must load with "No issues".
      const probe = inherentlyPreviewOnly(state.js);
      if (probe.inherent) {
        previewOnly = { api: probe.api };
        continue;
      }
    }
    const item: DiagnosticViewItem =
      d.severity === "error" && SIM_STRICT.test(d.message)
        ? { severity: "info", message: d.message, source: d.source, reclassified: true }
        : { severity: d.severity, message: d.message, source: d.source };
    // Repeated failed runs append identical diagnostics to the store; the view
    // collapses them so the footer count means "distinct problems", not
    // "number of clicks".
    const key = `${item.severity}|${item.source}|${item.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }
  // Panel-side lint (unparseable script, stray top-level HTML text) — the
  // author mistakes the forgiving compiler swallows without a word.
  for (const item of lintSource(state.html, state.js)) {
    const key = `${item.severity}|${item.source}|${item.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }
  // Shell-synthesized: a widget whose scene draws nothing must never present
  // as all-green ("No issues" + a package pill over a black void). The store
  // is a protected surface, so the advisory joins the view here.
  if (isEmptyRender(state)) {
    items.push({ severity: "warning", message: EMPTY_RENDER_MESSAGE, source: "html" });
  }
  const errors = items.filter((i) => i.severity === "error").length;
  const warnings = items.filter((i) => i.severity === "warning").length;
  const notices = items.filter((i) => i.reclassified).length;
  const simBlocked = state.simState === "idle";
  const buildError = items.find((i) => i.severity === "error" && !UPLOAD_PREFIX.test(i.message));
  const strictNotice = items.find((i) => i.reclassified);
  return {
    items,
    errors,
    warnings,
    notices,
    previewOnly,
    simBlocked,
    buildBlocker:
      buildError?.message ??
      (simBlocked ? strictNotice?.message ?? strictMessage ?? null : null),
  };
}

/** "1 issue" / "3 issues" — never "1 issues". */
export function countLabel(n: number, noun: string): string {
  return `${n.toLocaleString()} ${noun}${n === 1 ? "" : "s"}`;
}

/**
 * One-line human summary for a raw compiler/assembler message. The full text
 * stays available behind "Show details" — never verbatim in shell chrome.
 *
 * NO character-count truncation here: a JS slice ellipsizes mid-word
 * ("Match the Wrapper clas…"), which reads as a broken layout. A long summary
 * WRAPS; any surface that must cap its height clamps at a rendered line
 * boundary with CSS line-clamp instead (see .wd-ins-diagtext, .wd-toast-body).
 */
export function humanizeDiagnostic(message: string): string {
  const text = message.replace(/^(F2JS|widget upload|render-v2|event-driven):\s*/i, "");
  const docWrite = /^Unsupported document write in "([^"]+)" handler/.exec(text);
  if (docWrite) return `Unsupported statement in the ${docWrite[1]} handler.`;
  // The transpiler's own message for this now opens with the fix and lists the
  // four forms a top level may contain, so the ONLY reason to shorten it here
  // is height — not vocabulary. It used to swap the whole thing for "outside
  // the device DSL", which named a language the author has never been shown
  // and left them nothing to do; this keeps the instruction and drops the list.
  if (/^Unsupported top-level statement/.test(text)) {
    return "This line can't sit outside a handler — move it inside one of your widget.on handlers.";
  }
  if (SIM_STRICT.test(text)) {
    return "The simulator requires the strict F2JS header (“use strict”).";
  }
  const firstLine = text.split("\n")[0].trim();
  const cut = firstLine.indexOf(" (");
  return cut > 24 ? firstLine.slice(0, cut) : firstLine;
}

/**
 * Footer summary: the highest severity wins the dot, tone, and label.
 * `deviceErrors` (the shared deviceBuild record's failure, 0 or 1) joins the
 * count here so the pill and the Device tab's callout share one source; when
 * the ONLY error is device-owned, `owner` steers the pill's deep link to the
 * Device tab's build step instead of the Design diagnostics rail.
 */
export function summarizeIssues(
  view: DiagnosticsView,
  deviceErrors = 0,
): {
  label: string;
  dot: "error" | "warn" | "info" | "ok";
  tone: "danger" | "warning" | "info" | undefined;
  aria: string;
  /** Which surface owns the click-through when errors exist. */
  owner: "design" | "device";
} {
  const errors = view.errors + deviceErrors;
  if (errors > 0) {
    const owner = view.errors > 0 ? "design" : "device";
    const label = [
      countLabel(errors, SEVERITY_META.error.noun),
      view.warnings > 0 ? countLabel(view.warnings, SEVERITY_META.warning.noun) : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return {
      label,
      dot: "error",
      tone: "danger",
      aria:
        owner === "device"
          ? "Device build failed — open the Device tab's build step"
          : `View ${countLabel(errors, "diagnostic error")}`,
      owner,
    };
  }
  if (view.warnings > 0) {
    return {
      label: countLabel(view.warnings, SEVERITY_META.warning.noun),
      dot: "warn",
      tone: "warning",
      aria: `View ${countLabel(view.warnings, "diagnostic warning")}`,
      owner: "design",
    };
  }
  if (view.notices > 0) {
    return {
      label: countLabel(view.notices, SEVERITY_META.info.noun),
      dot: "info",
      tone: "info",
      aria: `View ${countLabel(view.notices, "diagnostic notice")}`,
      owner: "design",
    };
  }
  return { label: "No issues", dot: "ok", tone: undefined, aria: "View diagnostics — no issues", owner: "design" };
}

// ── Reveal bus ───────────────────────────────────────────────────────────────
// Footer "1 error" and "View diagnostics" links jump the user to the Design
// tab and flash the Diagnostics accordion open. App owns the tab switch; the
// Design-tab inspector owns opening + highlighting the row — including when
// the row is already open, so the click always has a visible response.

const REVEAL_EVENT = "wd-reveal-diagnostics";

export function revealDiagnostics() {
  window.dispatchEvent(new CustomEvent(REVEAL_EVENT));
}

export function onRevealDiagnostics(fn: () => void): () => void {
  window.addEventListener(REVEAL_EVENT, fn);
  return () => window.removeEventListener(REVEAL_EVENT, fn);
}

// ── Device reveal (Export pipeline → Device tab) ─────────────────────────────
// The Export tab's Push stage is a handoff: its "Open Device tab" action rides
// the same reveal-bus pattern as diagnostics/source deep links. App owns the
// tab switch.

const DEVICE_EVENT = "wd-reveal-device";

export function revealDeviceTab() {
  window.dispatchEvent(new CustomEvent(DEVICE_EVENT));
}

export function onRevealDeviceTab(fn: () => void): () => void {
  window.addEventListener(DEVICE_EVENT, fn);
  return () => window.removeEventListener(DEVICE_EVENT, fn);
}

// ── Source reveal (diagnostic → editor) ──────────────────────────────────────
// "Go to source" links jump from a diagnostic row to the offending range in
// the Source editor. App owns the tab switch; the Source workspace owns the
// in-editor jump. The pending flag survives the mount gap: when the Source
// tab isn't mounted yet, the workspace consumes the request in its mount
// effect and jumps once the editor is ready.

const SOURCE_EVENT = "wd-reveal-source";
let pendingSourceReveal = false;

export function revealSource() {
  pendingSourceReveal = true;
  window.dispatchEvent(new CustomEvent(SOURCE_EVENT));
}

export function onRevealSource(fn: () => void): () => void {
  window.addEventListener(SOURCE_EVENT, fn);
  return () => window.removeEventListener(SOURCE_EVENT, fn);
}

/** True exactly once per revealSource() — whoever acts on it consumes it. */
export function consumeSourceReveal(): boolean {
  const was = pendingSourceReveal;
  pendingSourceReveal = false;
  return was;
}

// ── Source-view section reveals (legacy tab URLs → dissolved surfaces) ───────
// ?tab=events and ?tab=hostdata now land on the Source tab; these one-shot
// flags (same pattern as consumeSourceReveal) tell the Source workspace which
// dissolved surface the URL was really asking for: the event-reference rail
// or the Host data card.

let pendingReferenceReveal = false;

export function requestReferenceReveal() {
  pendingReferenceReveal = true;
}

/** True exactly once per requestReferenceReveal(). */
export function consumeReferenceReveal(): boolean {
  const was = pendingReferenceReveal;
  pendingReferenceReveal = false;
  return was;
}

let pendingHostDataReveal = false;

export function requestHostDataReveal() {
  pendingHostDataReveal = true;
}

/** True exactly once per requestHostDataReveal(). */
export function consumeHostDataReveal(): boolean {
  const was = pendingHostDataReveal;
  pendingHostDataReveal = false;
  return was;
}
