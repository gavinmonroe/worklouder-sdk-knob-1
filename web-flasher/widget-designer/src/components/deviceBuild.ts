// Shared device-build status — the ONE source of truth for the Device tab's
// "Build package" outcome.
//
// The build ran from panel-local state before, which unmounted with the tab:
// leaving Device cleared the red step badge and the failure callout while the
// footer still counted "1 error" from the store's append-only diagnostics —
// two surfaces disagreeing about one fact. This module keeps the outcome
// OUTSIDE the panel, stamped with the exact source it was built from, so:
//
//   * the failed step badge and its callout survive tab navigation,
//   * the footer error pill derives from the SAME record (never the store's
//     append-only list, which no success can ever retract), and
//   * everything clears together, by source comparison, the moment the user
//     edits — one publish, one staleness rule, zero disagreement.
//
// The Export tab reads the same record to reflect a Device-side failure on
// its Push stage, so one widget can never be green on Export and red on
// Device without the contradiction being named.

import * as React from "react";
import { revealDeviceTab } from "./diagnosticsView";

export type DeviceBuildMode = "events" | "frames";

export interface DeviceBuildStatus {
  outcome: "ok" | "failed";
  mode: DeviceBuildMode;
  /** Raw compile/capture failure text (null on success). */
  error: string | null;
  /** Post-build advisory on success (e.g. trailing frames dropped). */
  notice: string | null;
  /** The exact source the build ran against — staleness by comparison. */
  source: { html: string; css: string; js: string };
}

let current: DeviceBuildStatus | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Publish a build outcome (or null to clear, e.g. while a build runs). */
export function publishDeviceBuild(next: DeviceBuildStatus | null): void {
  current = next;
  listeners.forEach((l) => l());
}

/**
 * The last device-build outcome, or null when none exists or the source has
 * moved on since the build ran — a verdict about an earlier widget must never
 * outlive its source.
 */
export function useDeviceBuildStatus(source: {
  html: string;
  css: string;
  js: string;
}): DeviceBuildStatus | null {
  const status = React.useSyncExternalStore(subscribe, () => current);
  if (!status) return null;
  const s = status.source;
  return s.html === source.html && s.css === source.css && s.js === source.js ? status : null;
}

// ── Failure anatomy ──────────────────────────────────────────────────────────
// "Show details" must earn its click: the disclosure names the shell's rule id
// for the gate that fired, the pipeline stage, and — when the markup analysis
// can derive them — the exact offending nodes, never just the summary again.

const RULES: { test: RegExp; id: string }[] = [
  { test: /root must contain only direct span children/i, id: "render-v2/root-direct-span-children" },
  { test: /must contain one double-quoted \.\S+ root div/i, id: "render-v2/missing-root-div" },
  { test: /Unsupported render script syntax near byte \d+/i, id: "event-program/unsupported-script-syntax" },
  { test: /Unsupported render script statement:/i, id: "event-program/unsupported-statement" },
  { test: /Render script forbids comments/i, id: "event-program/forbidden-token" },
  { test: /declares no event-driven bindings/i, id: "event-program/no-bindings" },
  { test: /patch-variant budget exceeds/i, id: "event-program/patch-variant-budget" },
  { test: /patch-set budget exceeds/i, id: "event-program/patch-set-budget" },
  { test: /patch-span budget exceeds/i, id: "event-program/patch-span-budget" },
  { test: /patch pixels exceed/i, id: "event-program/patch-bytes-budget" },
  { test: /Unsupported document write in "([^"]+)" handler/i, id: "event-program/unsupported-handler-statement" },
  { test: /Unsupported top-level statement/i, id: "event-program/unsupported-top-level" },
  { test: /live preview never became available/i, id: "capture/preview-unavailable" },
  { test: /outside the box-model fallback/i, id: "capture/outside-f1sc-subset" },
  { test: /no compiled frame to rasterize/i, id: "capture/no-frame" },
];

const MODE_STAGE: Record<DeviceBuildMode, string> = {
  events: "event-driven (F2EP program compile)",
  frames: "frames (render-v2 raster capture)",
};

/**
 * CSS-ish paths of the widget root's non-<span> direct children — the nodes
 * the render-v2 root gate actually rejects. Empty when nothing is derivable
 * (no DOM parser, no root element, or every child already a span).
 */
export function offendingRootChildren(html: string, rootClass: string): string[] {
  const root = rootClass.trim();
  if (root === "" || typeof DOMParser === "undefined") return [];
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const el =
      doc.querySelector(`.${typeof CSS !== "undefined" && CSS.escape ? CSS.escape(root) : root}`) ??
      doc.body.firstElementChild;
    if (!el) return [];
    const out: string[] = [];
    Array.from(el.children).forEach((child, i) => {
      const tag = child.tagName.toLowerCase();
      if (tag === "span") return;
      const cls = child.classList[0] ? `.${child.classList[0]}` : "";
      out.push(`.${root} > ${tag}${cls}:nth-child(${i + 1})`);
    });
    return out;
  } catch {
    return [];
  }
}

/**
 * `script.js:<line>:<col>  <the offending line>` for a parser offset — the
 * "near byte N" message alone points at nothing a person can act on, so the
 * disclosure resolves N into the exact line of the script and quotes it.
 * (The parser counts string offsets; for this app's ASCII-dominant sources
 * that matches bytes, and the quoted line is authoritative either way.)
 */
export function locateScriptOffset(script: string, offset: number): string | null {
  if (!Number.isInteger(offset) || offset < 0 || script === "") return null;
  const at = Math.min(offset, script.length);
  const before = script.slice(0, at);
  const line = before.split("\n").length;
  const lineStart = before.lastIndexOf("\n") + 1;
  const col = at - lineStart + 1;
  const lineEnd = script.indexOf("\n", at);
  const text = script.slice(lineStart, lineEnd === -1 ? script.length : lineEnd).trim();
  const snippet = text.length > 80 ? `${text.slice(0, 77)}…` : text;
  return `script.js:${line}:${col}  ${snippet || "(empty line)"}`;
}

/** First line whose text carries a construct the grammar bans outright. */
function locateForbiddenToken(script: string): string | null {
  const match = /[`']|\/\*|\*\/|\/\//u.exec(script);
  return match ? locateScriptOffset(script, match.index) : null;
}

export interface DeviceBuildFailureDetail {
  /** Shell-side rule id for the gate that fired. */
  rule: string;
  /** Which build pipeline rejected the widget. */
  stage: string;
  /** Offending node paths / script locations, when derivable. */
  nodes: string[];
  /** The compiler's full original text. */
  raw: string;
  /** Aligned plain-text rendering for the disclosure body. */
  text: string;
  /** Payload for the "Copy error" action. */
  copyText: string;
}

export function explainDeviceBuildFailure(
  status: DeviceBuildStatus,
  widget: { html: string; js: string; rootClass: string },
): DeviceBuildFailureDetail {
  const raw = status.error ?? "";
  const rule =
    RULES.find((r) => r.test.test(raw))?.id ??
    (status.mode === "events" ? "event-program/compile-error" : "render-v2/capture-error");
  const stage = MODE_STAGE[status.mode];
  // Name the exact offender for every rule that admits one — never leave the
  // disclosure restating the summary. Markup gates get node paths; script
  // gates get script.js:line:col plus the quoted offending line.
  let nodes: string[] = [];
  if (rule === "render-v2/root-direct-span-children") {
    nodes = offendingRootChildren(widget.html, widget.rootClass);
  } else if (rule === "event-program/unsupported-script-syntax") {
    const offset = Number(/near byte (\d+)/i.exec(raw)?.[1] ?? NaN);
    const located = locateScriptOffset(widget.js, offset);
    if (located) nodes = [located];
  } else if (rule === "event-program/unsupported-statement") {
    const statement = /Unsupported render script statement:\s*([\s\S]+)$/i.exec(raw)?.[1]?.trim();
    if (statement) {
      const at = widget.js.indexOf(statement.split("\n")[0]);
      const located = at >= 0 ? locateScriptOffset(widget.js, at) : null;
      nodes = located ? [located] : [statement.length > 80 ? `${statement.slice(0, 77)}…` : statement];
    }
  } else if (rule === "event-program/forbidden-token") {
    const located = locateForbiddenToken(widget.js);
    if (located) nodes = [located];
  }
  const lines = [
    `rule     ${rule}`,
    `stage    ${stage}`,
    ...nodes.map((n, i) => `${i === 0 ? "node     " : "         "}${n}`),
    `message  ${raw}`,
  ];
  return { rule, stage, nodes, raw, text: lines.join("\n"), copyText: lines.join("\n") };
}

// ── Device event-program pre-flight ──────────────────────────────────────────
// One widget, two compilers: the Export tab's F2JS/F2UP stages can both read
// green while the DEVICE event pipeline (a stricter compiler) rejects the same
// markup. This probe runs the same static gates buildEventProgram() runs
// BEFORE any pixel capture — prepareRenderV2's markup/CSS/script validation
// plus the "declares no bindings" check — so the rejection can surface as a
// pre-flight warning on the Compile stage instead of a surprise on Device.
//
// The SDK compiler must never join the startup import graph (its modules touch
// Node globals at evaluation time; main.tsx installs the shim first), so the
// probe lazy-imports it once and memoizes verdicts per exact source.

export interface DeviceEventPreflight {
  status: "checking" | "ok" | "rejected";
  /** The device compiler's rejection text (only when status is "rejected"). */
  error: string | null;
}

let sdkCompilerPromise: Promise<any> | null = null;
const preflightCache = new Map<string, { ok: boolean; error: string | null }>();

export function useDeviceEventPreflight(source: {
  html: string;
  css: string;
  js: string;
  rootClass: string;
}): DeviceEventPreflight {
  const key = [source.rootClass, source.html, source.css, source.js].join("\u0000");
  const cached = preflightCache.get(key) ?? null;
  const [, bump] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    if (preflightCache.has(key)) return;
    let alive = true;
    sdkCompilerPromise ??= import("@sdk/render-v2/compiler.mjs");
    sdkCompilerPromise
      .then((mod) => {
        if (!alive || preflightCache.has(key)) return;
        let verdict: { ok: boolean; error: string | null };
        try {
          const prepared = mod.prepareRenderV2({
            html: source.html,
            css: source.css,
            script: source.js,
            rootClass: source.rootClass,
          });
          const bindings: { variants?: unknown[] }[] = prepared?.logicalBindings ?? [];
          // The Designer always links through the pre-rendered pixel path,
          // where every binding's patch is a diff against ITS OWN base glyphs
          // — so the cross-binding patch dedupe that lets the SDK's semantic
          // linker collapse formatTime's six digit bindings into one shared
          // patch set cannot occur here. The linker's budgets (8 patch sets,
          // 64 variants — mirrored from the SDK compiler's own invariants)
          // therefore bind per-binding, and both are fully static: predict
          // the overflow now instead of failing after a full pixel capture.
          const variantCount = bindings.reduce((sum, b) => sum + (b.variants?.length ?? 0), 0);
          if (bindings.length === 0) {
            verdict = {
              ok: false,
              error:
                "This widget declares no event-driven bindings: nothing in its script " +
                "writes a glyph target, so there is no state for the device to react to.",
            };
          } else if (bindings.length > 8) {
            verdict = {
              ok: false,
              error:
                `Render v2 patch-set budget exceeds 8: this widget's ${bindings.length} bindings each ` +
                "need their own pixel-captured patch set on the designer's pre-rendered path.",
            };
          } else if (variantCount > 64) {
            verdict = {
              ok: false,
              error:
                `Render v2 patch-variant budget exceeds 64: this widget needs ${variantCount} pixel-captured ` +
                "variants, and the designer's pre-rendered path cannot share them between bindings " +
                "(each one diffs against its own base glyphs).",
            };
          } else {
            verdict = { ok: true, error: null };
          }
        } catch (err) {
          verdict = { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
        if (preflightCache.size > 32) preflightCache.clear();
        preflightCache.set(key, verdict);
        bump();
      })
      .catch(() => {
        /* compiler unavailable — stay "checking"; never cry wolf */
      });
    return () => {
      alive = false;
    };
  }, [key, source.html, source.css, source.js, source.rootClass]);
  if (cached) return { status: cached.ok ? "ok" : "rejected", error: cached.error };
  return { status: "checking", error: null };
}

// ── Reveal bus: footer error pill / Export Push note → Device build step ─────
// Deep links land on the surface that OWNS the failure: the Device tab's
// build step. Same pending-flag pattern as the source reveal — the tab may
// not be mounted when the event fires.

const BUILD_REVEAL_EVENT = "wd-reveal-device-build";
let pendingBuildReveal = false;

export function revealDeviceBuildStep(): void {
  pendingBuildReveal = true;
  revealDeviceTab(); // App owns the tab switch
  window.dispatchEvent(new CustomEvent(BUILD_REVEAL_EVENT));
}

export function onRevealDeviceBuildStep(fn: () => void): () => void {
  window.addEventListener(BUILD_REVEAL_EVENT, fn);
  return () => window.removeEventListener(BUILD_REVEAL_EVENT, fn);
}

/** True exactly once per revealDeviceBuildStep() — the mounting panel consumes it. */
export function consumeDeviceBuildReveal(): boolean {
  const was = pendingBuildReveal;
  pendingBuildReveal = false;
  return was;
}
