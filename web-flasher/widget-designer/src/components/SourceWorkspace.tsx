// Source tab — the widget's home. One frame owns the whole editing surface:
// a slim toolbar (buffer facts, diagnostics, recompile mode, the Reference
// toggle) sits INSIDE the code frame, the CodeMirror surface fills the rest
// with the event-reference rail docked at its right edge, and the Host data
// card (feeds derived from the source) sits directly below — events and host
// data are part of the source, not separate tabs. The live preview, the
// simulator (drive + event log), and the buffer budget ride shotgun in the
// fixed right rail.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CodeMirrorEditor, { type CodeMirrorEditorApi } from "./CodeMirrorEditor";
import { ViewportShell } from "./ViewportShell";
import type { DesignerState, DesignerActions } from "../designer/store";
import { MQUICKJS_LIMITS } from "../compiler/constants";
import {
  Accordion,
  Badge,
  BudgetMeter,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  SegmentedControl,
  Tooltip,
} from "./ui";
import { Icon } from "./icons";
import { useDebouncedEffect } from "../hooks/useDebouncedEffect";
import {
  consumeHostDataReveal,
  consumeReferenceReveal,
  consumeSourceReveal,
  countLabel,
  onRevealSource,
  revealDiagnostics,
  viewDiagnostics,
} from "./diagnosticsView";
import { EventReferenceRail } from "./EventReferenceRail";
import type { EventReferenceEntry } from "./eventReference";
import { HostFeedsPanel } from "./HostFeedsPanel";
import { SimulatorCard, useSimDispatch } from "./SimulatorCard";
import { setPendingEditorDirty } from "../designer/sourceDraft";

import type { SourceLanguage as Language } from "../types";
type RecompileMode = "auto" | "apply";

const MODES: { id: RecompileMode; label: string }[] = [
  { id: "auto", label: "Auto" },
  { id: "apply", label: "Apply" },
];

const bytesOf = (text: string) => new TextEncoder().encode(text).length;

/** Reference-rail visibility: an explicit choice persists; with none stored,
 *  wide viewports (≥1440px) open it and narrower ones boot closed. */
function initialRefOpen(): boolean {
  try {
    const stored = localStorage.getItem("wd-ref-rail");
    if (stored === "open") return true;
    if (stored === "closed") return false;
  } catch {
    /* storage unavailable */
  }
  return window.innerWidth >= 1440;
}

export function SourceWorkspace({ state, actions }: { state: DesignerState; actions: DesignerActions }) {
  const [language, setLanguage] = useState<Language>("html");
  const [mode, setMode] = useState<RecompileMode>("auto");
  const [pendingSource, setPendingSource] = useState({
    html: state.html,
    css: state.css,
    js: state.js,
  });

  // Re-sync the buffer when the source-of-truth changes (preset load).
  useMemo(() => {
    setPendingSource({ html: state.html, css: state.css, js: state.js });
    return undefined;
  }, [state.html, state.css, state.js]);

  // Live recompile — auto (debounced ~330 ms) or via Apply click.
  useDebouncedEffect(
    () => {
      if (mode !== "auto") return;
      actions.recompile({ ...pendingSource, name: state.displayName, rootClass: state.rootClass });
    },
    mode === "auto" ? 330 : 60_000,
    [pendingSource.html, pendingSource.css, pendingSource.js, mode],
  );

  const onChange = useCallback(
    (next: string) => setPendingSource((p) => ({ ...p, [language]: next })),
    [language],
  );

  // Apply-mode feedback: the button acknowledges the click with a check flash.
  const [applied, setApplied] = useState(false);
  const appliedTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(appliedTimer.current), []);
  const apply = useCallback(() => {
    actions.recompile({ ...pendingSource, name: state.displayName, rootClass: state.rootClass });
    setApplied(true);
    window.clearTimeout(appliedTimer.current);
    appliedTimer.current = window.setTimeout(() => setApplied(false), 1200);
  }, [pendingSource, state.displayName, state.rootClass, actions]);

  const dirty = {
    html: pendingSource.html !== state.html,
    css: pendingSource.css !== state.css,
    js: pendingSource.js !== state.js,
  };
  const anyDirty = dirty.html || dirty.css || dirty.js;

  // Apply-mode edits live only in this view until the Apply click commits
  // them — flag the gap so the unload guard (designer/sourceDraft.ts) can
  // warn before they are lost. Auto mode clears within the debounce, and the
  // flag drops with the view (a tab switch discards the pending buffer today,
  // so it must not keep warning afterwards).
  useEffect(() => {
    setPendingEditorDirty(mode === "apply" && anyDirty);
  }, [mode, anyDirty]);
  useEffect(() => () => setPendingEditorDirty(false), []);

  const diag = viewDiagnostics(state);
  const buffer = pendingSource[language];
  const totalBytes = bytesOf(pendingSource.html) + bytesOf(pendingSource.css) + bytesOf(pendingSource.js);

  // The one wrapped dispatch for this view: reference-rail samples, host-feed
  // Sends, and the simulator card all go through it, so a dispatch the strict
  // simulator can't log announces itself exactly once.
  const simDispatch = useSimDispatch(state, actions);

  // ── Issue pill → in-editor jump ─────────────────────────────────────────
  // The header count is a BUTTON: it selects the first offending range in the
  // editor (switching to the buffer that owns it first, when needed) — the
  // diagnostic is one click from the glyph that caused it. If nothing in a
  // buffer is addressable (an app-level diagnostic with no position), it
  // falls back to the same deep link the footer uses.
  const editorApi = useRef<CodeMirrorEditorApi | null>(null);
  const pendingJump = useRef(false);
  const jumpToFirstIssue = useCallback(() => {
    const SOURCE_LANG: Record<string, Language> = { html: "html", css: "css", script: "js" };
    const first = diag.items.find((i) => i.severity !== "info");
    const target: Language = first ? SOURCE_LANG[first.source] ?? language : language;
    if (target !== language) {
      pendingJump.current = true;
      setLanguage(target);
      return;
    }
    if (!editorApi.current) {
      // Editor still building (fresh mount from a "Go to source" deep link):
      // park the jump for onEditorReady instead of bouncing away.
      pendingJump.current = true;
      return;
    }
    if (!editorApi.current.focusFirstIssue()) revealDiagnostics();
  }, [diag.items, language]);

  // ── Snippet insert + handler reveal (reference rail, host feeds) ────────
  // Inserts land at the cursor of the JS buffer; from another buffer the
  // request parks in a ref and the editor consumes it once the JS instance is
  // ready — the exact pattern pendingJump uses. A snippet's prelude
  // (`var value = 0;`) joins the insert only when the buffer does not already
  // declare that state var.
  const pendingJsRef = useRef(pendingSource.js);
  pendingJsRef.current = pendingSource.js;
  const pendingInsert = useRef<{ text: string; prelude?: string } | null>(null);
  const pendingReveal = useRef<string | null>(null);

  const insertIntoJs = useCallback(
    (snippet: string, prelude?: string) => {
      let neededPrelude: string | undefined = undefined;
      if (prelude) {
        const name = /var\s+([A-Za-z_$][\w$]*)/.exec(prelude)?.[1];
        if (!name || !new RegExp(`\\bvar\\s+${name}\\b`).test(pendingJsRef.current)) {
          neededPrelude = prelude;
        }
      }
      if (language !== "js" || !editorApi.current) {
        pendingInsert.current = { text: snippet, ...(neededPrelude ? { prelude: neededPrelude } : {}) };
        if (language !== "js") setLanguage("js");
        return;
      }
      editorApi.current.insertSnippet(snippet, neededPrelude);
    },
    [language],
  );

  const revealInJs = useCallback(
    (needle: string) => {
      if (language !== "js" || !editorApi.current) {
        pendingReveal.current = needle;
        if (language !== "js") setLanguage("js");
        return;
      }
      editorApi.current.revealText(needle);
    },
    [language],
  );

  const onEditorReady = useCallback(() => {
    if (pendingJump.current) {
      pendingJump.current = false;
      editorApi.current?.focusFirstIssue();
    }
    const insert = pendingInsert.current;
    if (insert) {
      pendingInsert.current = null;
      editorApi.current?.insertSnippet(insert.text, insert.prelude);
    }
    const reveal = pendingReveal.current;
    if (reveal) {
      pendingReveal.current = null;
      editorApi.current?.revealText(reveal);
    }
  }, []);

  // "Go to source" links from Inspector diagnostic rows. Mounted: the event
  // lands here directly. Not mounted: App switches to this tab and the mount
  // effect consumes the pending request once — the jump then waits on
  // onEditorReady like any cross-buffer jump.
  useEffect(
    () =>
      onRevealSource(() => {
        consumeSourceReveal();
        jumpToFirstIssue();
      }),
    [jumpToFirstIssue],
  );
  useEffect(() => {
    if (consumeSourceReveal()) jumpToFirstIssue();
    // Mount only — a stale pending flag must not re-trigger on later renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Reference rail ──────────────────────────────────────────────────────
  const [refOpen, setRefOpen] = useState(initialRefOpen);
  const toggleRefRail = useCallback(() => {
    setRefOpen((open) => {
      const next = !open;
      try {
        localStorage.setItem("wd-ref-rail", next ? "open" : "closed");
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  }, []);

  // Legacy-URL reveals (?tab=events → the reference rail; ?tab=hostdata →
  // the Host data card), consumed once on mount.
  const hostDataRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (consumeReferenceReveal()) setRefOpen(true);
    if (consumeHostDataReveal()) {
      window.setTimeout(() => {
        hostDataRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
      }, 120);
    }
    // Mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A dirty dot on a language segment says "this buffer differs from what the
  // simulator is running" — only meaningful in Apply mode, where the gap can
  // outlive the debounce.
  const langItems = (["html", "css", "js"] as const).map((id) => ({
    id,
    label: (
      <span className="inline-flex items-center gap-1.5">
        {id.toUpperCase()}
        {mode === "apply" && dirty[id] && <span className="wd-src-dirty" aria-hidden="true" />}
      </span>
    ),
  }));

  return (
    // 380px rail = the shared right-rail track, so the page frame never
    // reflows when switching tabs.
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-4 items-start">
      {/* ─── Work column: editor hero + Host data ──────────────────────── */}
      <div className="space-y-4 min-w-0">
        <Card className="min-w-0">
          <CardHeader>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <CardTitle>Source</CardTitle>
                <CardDescription>
                  HTML, CSS, and JavaScript — every keystroke recompiles the simulator in{" "}
                  <Tooltip label="Auto-recompile runs ~330 ms after the last keystroke. Switch to Apply for full control.">
                    <span className="underline decoration-dotted underline-offset-2 cursor-help">Auto mode</span>
                  </Tooltip>
                  .
                </CardDescription>
              </div>
              <SegmentedControl
                aria-label="Editor language"
                value={language}
                onValueChange={(v) => setLanguage(v)}
                items={langItems}
              />
            </div>
          </CardHeader>

          <CardContent>
            <div className="wd-editor">
              <div className="wd-editor-head">
                <div className="wd-editor-meta">
                  <span className="font-mono">widget.{language}</span>
                  <span className="wd-editor-sep" aria-hidden="true" />
                  <span className="wd-nums">
                    {buffer.length.toLocaleString()} chars · {bytesOf(buffer).toLocaleString()} B
                  </span>
                  {(diag.errors > 0 || diag.warnings > 0) && (
                    <Tooltip label="Jump to the first problem in the source">
                      <button
                        type="button"
                        className="wd-badge"
                        data-tone={diag.errors > 0 ? "danger" : "warning"}
                        onClick={jumpToFirstIssue}
                        aria-label={`${
                          diag.errors > 0
                            ? countLabel(diag.errors, "error")
                            : countLabel(diag.warnings, "warning")
                        } — jump to the first problem`}
                      >
                        <Icon name={diag.errors > 0 ? "x-circle" : "alert-triangle"} size={12} />
                        {diag.errors > 0
                          ? countLabel(diag.errors, "error")
                          : countLabel(diag.warnings, "warning")}
                      </button>
                    </Tooltip>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Tooltip
                    label={
                      refOpen
                        ? "Hide the event reference"
                        : "Event reference — all nine event kinds, their fields, and insertable handlers"
                    }
                  >
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-pressed={refOpen}
                      data-active={refOpen || undefined}
                      onClick={toggleRefRail}
                    >
                      <Icon name="book" size={12} />
                      Reference
                    </Button>
                  </Tooltip>
                  <SegmentedControl
                    semantics="radio"
                    aria-label="Recompile mode"
                    value={mode}
                    onValueChange={(v) => setMode(v)}
                    items={MODES}
                  />
                  {mode === "apply" && (
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={apply}
                      disabled={!anyDirty && !applied}
                      data-flash={applied ? "ok" : undefined}
                    >
                      <Icon name={applied ? "check" : "play"} size={12} />
                      {applied ? "Applied" : "Apply"}
                    </Button>
                  )}
                </div>
              </div>
              <div className="wd-editor-split">
                <div className="wd-editor-body">
                  <CodeMirrorEditor
                    value={buffer}
                    language={language}
                    onChange={onChange}
                    ariaLabel={`${language.toUpperCase()} editor`}
                    apiRef={editorApi}
                    onReady={onEditorReady}
                  />
                </div>
                {refOpen && (
                  <EventReferenceRail
                    handlers={state.handlers}
                    onInsert={(entry: EventReferenceEntry) => insertIntoJs(entry.snippet, entry.prelude)}
                    onFire={simDispatch}
                    onReveal={revealInJs}
                  />
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <HostFeedsPanel
          state={state}
          actions={actions}
          dispatch={simDispatch}
          dirty={mode === "apply" && dirty.js}
          onInsert={insertIntoJs}
          onReveal={revealInJs}
          containerRef={hostDataRef}
        />
      </div>

      {/* ─── Live preview + simulator + buffer rail ────────────────────── */}
      <div className="space-y-4 min-w-0">
        <ViewportShell state={state} actions={actions} embedded />

        <SimulatorCard state={state} actions={actions} dispatch={simDispatch} />

        <Card>
          <CardHeader>
            <CardTitle>Buffer</CardTitle>
            <CardDescription>
              Each language is buffered independently — switching never loses an edit.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Accordion
              flush
              storageKey="source-buffer"
              items={[
                {
                  id: "budget",
                  title: "Source budget",
                  defaultOpen: true,
                  badge: (
                    <Badge
                      tone={totalBytes > MQUICKJS_LIMITS.sourceBytes ? "danger" : "neutral"}
                      className="wd-nums"
                      title="Combined HTML+CSS+JS bytes as a share of the source cap"
                    >
                      <span className="wd-badge-prefix">used</span>
                      {Math.round((totalBytes / MQUICKJS_LIMITS.sourceBytes) * 100)}%
                    </Badge>
                  ),
                  render: () => (
                    <div>
                      <div className="wd-ins-meters-rail">
                        <BudgetMeter label="Combined" value={totalBytes} cap={MQUICKJS_LIMITS.sourceBytes} />
                      </div>
                      <div className="wd-src-bytes">
                        {(["html", "css", "js"] as const).map((l) => (
                          <div key={l} className="wd-src-bytesrow" data-active={l === language || undefined}>
                            <span className="wd-src-byteslang">{l.toUpperCase()}</span>
                            <span className="wd-nums">{bytesOf(pendingSource[l]).toLocaleString()} B</span>
                          </div>
                        ))}
                      </div>
                      <div className="wd-ins-note">
                        The mquickjs engine refuses to flash a package whose combined source exceeds{" "}
                        {MQUICKJS_LIMITS.sourceBytes.toLocaleString()} B.
                      </div>
                    </div>
                  ),
                },
              ]}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
