// Everything the designer inferred from the widget source, in ONE accordion
// vocabulary: the Design tab renders the compact rail, the Inspect tab the
// full instance — same component, same labels ("DOM targets", never
// "Targets"), so the concepts never fork.
//
// The sections are LIVE readouts, not documentation: state slots carry the
// simulator's current values, the event log flashes rows as they land, and
// the supported-kinds list marks which kinds this script already handles.
//
// Header anatomy is deliberately uniform: every section header is ONE 36px
// line — chevron · title · badge — no subtitles, no second anatomy. Detail
// prose lives in the bodies.

import * as React from "react";
import type { DesignerState, DesignerActions } from "../designer/store";
import { MQUICKJS_LIMITS } from "../compiler/constants";
import {
  Accordion,
  type AccordionItem,
  Badge,
  BudgetMeter,
  budgetTone,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
} from "./ui";
import { Icon } from "./icons";
import {
  SEVERITY_META,
  countLabel,
  humanizeDiagnostic,
  onRevealDiagnostics,
  revealSource,
  viewDiagnostics,
  type DiagnosticViewItem,
  type DiagnosticsView,
} from "./diagnosticsView";
import { usePackageFreshness } from "./pipeline";
import { useF2upStatus } from "./f2upStatus";
import { useLegacyTools } from "./legacyTools";
import { formatEventTime } from "./eventTime";
import { getLogSessions, logEntryId, peekNextLogId } from "./logSessions";

// Log identity lives in logSessions.ts now; re-exported so existing imports
// (SimulatorCard's log accordion) keep one canonical path.
export { logEntryId, peekNextLogId } from "./logSessions";

export function InspectorPanel({
  state,
  actions: _actions,
  compact = false,
}: {
  state: DesignerState;
  actions: DesignerActions;
  compact?: boolean;
}) {
  const diag = viewDiagnostics(state);

  // Deep links ("View diagnostics", footer issue button) open + flash the
  // Diagnostics row. Both instances listen; only the visible one scrolls.
  const [reveal, setReveal] = React.useState({ id: "diag", nonce: 0 });
  React.useEffect(
    () => onRevealDiagnostics(() => setReveal((r) => ({ id: "diag", nonce: r.nonce + 1 }))),
    [],
  );

  // Badge tone/noun come from the one severity taxonomy (§diagnosticsView) —
  // the same condition reads identically here, on Export, and in the footer.
  const diagBadge =
    diag.errors > 0 ? <Badge tone={SEVERITY_META.error.badgeTone}>{diag.errors}</Badge>
    : diag.warnings > 0 ? <Badge tone={SEVERITY_META.warning.badgeTone}>{diag.warnings}</Badge>
    : diag.notices > 0 ? <Badge tone={SEVERITY_META.info.badgeTone}>{diag.notices}</Badge>
    : <Badge tone="success">OK</Badge>;

  const wiredCount = SUPPORTED_KINDS.filter((k) => isKindWired(state.handlers, k)).length;

  // Budgets live at the top so the section HEADER can carry a badge like every
  // sibling: the worst utilization across the four meters, tinted at the SAME
  // thresholds the fills themselves turn at (budgetTone: amber ≥70%, red
  // ≥90%) so the header escalates with the bars, and titled with its
  // provenance — "57%" alone doesn't say it's a max. An unmeasured package
  // simply sits out of the max, never fakes a 0%.
  const srcBytes = new Blob([state.html + "\n" + state.css + "\n" + state.js]).size;
  const freshness = usePackageFreshness(state.js, state.f2js);
  // v3 mode reads the F2UP container only — the F2JS package is a legacy
  // artifact, so its fresh-build branch exists only with Legacy tools on.
  const legacy = useLegacyTools();
  const f2jsBytes = legacy && freshness === "fresh" && state.f2js ? state.f2js.bytes : null;
  const f2up = useF2upStatus({ html: state.html, css: state.css, js: state.js });
  const pkgBytes = f2jsBytes ?? (f2up ? f2up.bytes : null);
  const ratios = [
    pkgBytes === null ? null : pkgBytes / MQUICKJS_LIMITS.packageBytes,
    srcBytes / MQUICKJS_LIMITS.sourceBytes,
    state.handlers.length / MQUICKJS_LIMITS.eventRecords,
    state.targets.length / MQUICKJS_LIMITS.targets,
  ].filter((r): r is number => r !== null);
  const worstRatio = ratios.length > 0 ? Math.max(...ratios) : 0;
  // A non-zero worst never rounds down to a "0%" lie.
  const worstPct = worstRatio <= 0 ? 0 : Math.max(1, Math.round(worstRatio * 100));
  const worstTone = budgetTone(worstRatio);
  // "peak 58%" — the badge NAMES its metric (the max across the meters), so
  // it can never be misread as an average or a total.
  const budgetsBadge = (
    <Badge
      tone={worstTone === "accent" ? "muted" : worstTone}
      title="Peak utilization — the fullest of the budget meters below"
    >
      <span className="wd-badge-prefix">peak</span>
      {worstPct}%
    </Badge>
  );

  // Event-log freshness baseline: entries known before this render are old
  // news; a row whose id lands at or past the baseline flashes once. The
  // effect (post-paint) folds every current entry in — including ones that
  // arrive while the section is closed, so opening it later never back-flashes.
  const logBaseline = React.useRef<number | null>(null);
  if (logBaseline.current === null) {
    state.eventLog.forEach(logEntryId);
    logBaseline.current = peekNextLogId();
  }
  React.useEffect(() => {
    state.eventLog.forEach(logEntryId);
    logBaseline.current = peekNextLogId();
  });

  // Per-section clear: the store's rolling log is protected, so clearing is a
  // panel-local watermark — entries below it stay in the store but leave this
  // section (badge count included) until new events land.
  const [clearedBefore, setClearedBefore] = React.useState<number | null>(null);
  const visibleLog = React.useMemo(
    () =>
      clearedBefore === null
        ? state.eventLog
        : state.eventLog.filter((e) => logEntryId(e) >= clearedBefore),
    [state.eventLog, clearedBefore],
  );
  const clearLog = React.useCallback(() => {
    state.eventLog.forEach(logEntryId);
    setClearedBefore(peekNextLogId());
  }, [state.eventLog]);

  // One item vocabulary, two compositions: the 340px rail stacks all seven
  // sections in a single accordion; the full Inspect tab lays them out as a
  // two-column data sheet (states + handlers | targets + log) over full-width
  // rows (diagnostics, budgets, supported kinds) — content spans its column,
  // so every divider shares one right edge instead of three ragged ones.
  const sections: AccordionItem[] = [
            {
              id: "states",
              title: "State slots",
              badge: <Badge tone="muted">{state.states.length}</Badge>,
              defaultOpen: true,
              render: () =>
                state.states.length === 0 ? (
                  <EmptyState
                    size="sm"
                    icon="search"
                    title="No state slots yet"
                    hint={
                      <>
                        Declare <code>var temp = 72;</code> at the top of the script — each var
                        becomes a device state slot.
                      </>
                    }
                  />
                ) : (
                  <StatesTable state={state} />
                ),
            },
            {
              id: "handlers",
              title: "Handlers",
              badge: <Badge tone="muted">{state.handlers.length}</Badge>,
              defaultOpen: true,
              render: () =>
                state.handlers.length === 0 ? (
                  <EmptyState
                    size="sm"
                    icon="keyboard"
                    title="No handlers yet"
                    hint={
                      <>
                        Register one with <code>widget.on('tick.1s', …)</code> — any kind under
                        Supported event kinds works.
                      </>
                    }
                  />
                ) : (
                  <div className="wd-ins-rows">
                    {state.handlers.map((h, i) => (
                      <div key={i} className="wd-ins-row">
                        <span className="wd-ins-idx" aria-hidden="true">#{i}</span>
                        <KindText kind={h.kind} />
                        {h.detail && (
                          <span className="wd-ins-detail" title={h.detail}>
                            {h.detail}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                ),
            },
            {
              id: "targets",
              title: "Elements",
              badge: <Badge tone="muted">{state.targets.length}</Badge>,
              defaultOpen: !compact,
              render: () =>
                state.targets.length === 0 ? (
                  <EmptyState
                    size="sm"
                    icon="search"
                    title="No elements bound yet"
                    hint={
                      <>
                        Reference elements by id — <code>document.querySelector('#temp')</code> —
                        and the compiler binds them.
                      </>
                    }
                  />
                ) : (
                  <TargetsList targets={state.targets} />
                ),
            },
            {
              id: "events",
              title: "Event log",
              badge: <Badge tone="muted">{visibleLog.length}</Badge>,
              defaultOpen: !compact,
              actions:
                visibleLog.length > 0 ? (
                  <Button size="sm" variant="ghost" onClick={clearLog} aria-label="Clear event log">
                    Clear
                  </Button>
                ) : undefined,
              render: () =>
                visibleLog.length === 0 ? (
                  <EmptyState
                    size="sm"
                    icon="terminal"
                    title={clearedBefore !== null ? "Log cleared" : "No events yet"}
                    hint="Turn the stage knob, fire a sample from the Source view's reference rail, or start auto-tick — every event the simulator handles lands here."
                  />
                ) : (
                  <EventLogList log={visibleLog} newSince={logBaseline.current} />
                ),
            },
            {
              id: "diag",
              title: "Diagnostics",
              badge: diagBadge,
              defaultOpen: !compact,
              render: () => (
                <div>
                  {diag.items.length === 0 ? (
                    <div className="wd-ins-okrow">
                      <Icon name="check-circle" size={14} />
                      The source compiled cleanly.
                    </div>
                  ) : (
                    <div className="wd-ins-diag">
                      {diag.items.map((d) => (
                        <DiagnosticRow key={`${d.severity}|${d.source}|${d.message}`} item={d} />
                      ))}
                    </div>
                  )}
                  {diag.previewOnly && <PreviewOnlyNote mode={diag.previewOnly} />}
                </div>
              ),
            },
            {
              id: "budgets",
              // Sentence case like every sibling ("State slots", "Handlers");
              // the engine name survives in the body's provenance note.
              title: "Runtime budgets",
              badge: budgetsBadge,
              defaultOpen: !compact,
              render: () => (
                <Budgets
                  state={state}
                  compact={compact}
                  pkgBytes={pkgBytes}
                  f2jsBytes={f2jsBytes}
                  srcBytes={srcBytes}
                />
              ),
            },
            {
              id: "supported",
              title: "Supported event kinds",
              // Number-led like every sibling badge: a scannable "3" first,
              // the unit as a dimmed suffix — never a phrase pill.
              badge: (
                <Badge tone={wiredCount > 0 ? "accent" : "muted"}>
                  {wiredCount}
                  <span className="wd-badge-suffix">in use</span>
                </Badge>
              ),
              render: () => (
                <div>
                  <div className="wd-ins-kinds">
                    {SUPPORTED_KINDS.map((k) => {
                      const on = isKindWired(state.handlers, k);
                      return (
                        <div key={k} className="wd-ins-kindrow" data-on={on || undefined}>
                          <span className="wd-ins-kinddot" aria-hidden="true" />
                          <KindText kind={k} />
                          <span className="sr-only">{on ? "— handled" : "— not handled"}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="wd-ins-note">
                    {wiredCount > 0
                      ? "Highlighted kinds already have a handler in this script — any of them works inside widget.on(…)."
                      : "None handled yet — register one with widget.on(…)."}
                  </div>
                </div>
              ),
            },
  ];

  const byId = (id: string) => sections.find((s) => s.id === id)!;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Inspector</CardTitle>
        <CardDescription>
          {compact
            ? "Detected from your widget source."
            : "Everything the designer has inferred from your widget source. Useful when a handler isn’t firing."}
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {compact ? (
          <Accordion flush storageKey="inspector-rail" reveal={reveal} items={sections} />
        ) : (
          <div className="wd-ins-grid">
            <div className="wd-ins-gridcol">
              <Accordion flush storageKey="inspect-col-a" items={[byId("states"), byId("handlers")]} />
            </div>
            <div className="wd-ins-gridcol">
              <Accordion flush storageKey="inspect-col-b" items={[byId("targets"), byId("events")]} />
            </div>
            <div className="wd-ins-gridspan">
              <Accordion
                flush
                storageKey="inspect-span"
                reveal={reveal}
                items={[byId("diag"), byId("budgets"), byId("supported")]}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const SUPPORTED_KINDS = [
  "tick.1ms",
  "tick.100ms",
  "tick.1s",
  "input.fn-bottom-knob",
  "host.rpc",
  "input.key.down",
  "input.key.up",
  "input.key.hold",
  "input.chord.down",
  "input.chord.up",
] as const;

/** Does the current script register a handler for this supported kind?
 *  Covers exact matches, host.rpc:<id> details, and the compiler's
 *  fn-bottom-knob shorthand. */
function isKindWired(handlers: DesignerState["handlers"], kind: string): boolean {
  return handlers.some(
    (h) =>
      h.kind === kind ||
      h.kind.startsWith(`${kind}:`) ||
      (kind === "input.fn-bottom-knob" && h.kind === "fn-bottom-knob"),
  );
}

/** `input.key.down` → dim `input.key.` + strong `down`; `host.rpc:0xB241`
 *  splits before the detail, so the leaf keeps its `rpc:0xB241`. */
function splitKind(kind: string): { prefix: string; leaf: string } {
  const colon = kind.indexOf(":");
  const head = colon === -1 ? kind : kind.slice(0, colon);
  const dot = head.lastIndexOf(".");
  if (dot === -1) return { prefix: "", leaf: kind };
  return { prefix: kind.slice(0, dot + 1), leaf: kind.slice(dot + 1) };
}

export function KindText({ kind, withTitle = true }: { kind: string; withTitle?: boolean }) {
  const { prefix, leaf } = splitKind(kind);
  // Prefix and leaf are separate flex items and truncation is TAIL-ONLY: the
  // dim family namespace ("input.") never loses a glyph — it IS the semantic
  // family signal, and front-truncating it ("…fn-bottom-knob") left the row's
  // colored dot as the only family cue. Under pressure the leaf end-ellipsizes
  // instead ("input.fn-bottom-k…"); the full kind survives in title= — except
  // on surfaces whose fixed kind column never truncates (Events sample rows
  // pass withTitle={false}), where a native tooltip would only add a second
  // tooltip system beside the styled one.
  return (
    <span className="wd-ins-kind" title={withTitle ? kind : undefined}>
      {prefix && <span className="wd-ins-kindpre">{prefix}</span>}
      <span className="wd-ins-kindleaf">{leaf}</span>
    </span>
  );
}

// ── State slots ──────────────────────────────────────────────────────────────
// slot · name · initial value. (The store's published slot array mirrors the
// strict sim's MAILBOX, which closure-var scripts never write — presenting it
// as a live "now" column would lie whenever the preview runs real JS.)

function StatesTable({ state }: { state: DesignerState }) {
  return (
    <div className="wd-ins-table" role="table" aria-label="State slots">
      <div className="wd-ins-tr" role="row">
        <span className="wd-ins-th" role="columnheader">Slot</span>
        <span className="wd-ins-th" role="columnheader">Name</span>
        <span className="wd-ins-th" data-num="true" role="columnheader">Init</span>
      </div>
      {state.states.map((s) => (
        <div key={s.slot} className="wd-ins-tr" role="row">
          <span className="wd-ins-td" data-dim="true" role="cell">[{s.slot}]</span>
          <span className="wd-ins-td" role="cell">
            <span className="truncate" title={s.name}>{s.name}</span>
          </span>
          <span className="wd-ins-td" data-num="true" role="cell">
            {s.init.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── DOM targets ──────────────────────────────────────────────────────────────
// When every target shares one binding type, the type is stated ONCE under the
// list ("9 × textContent") — a column repeating the same word nine times is
// noise. Per-row labels return only when the bindings actually differ.

function TargetsList({ targets }: { targets: DesignerState["targets"] }) {
  const uniform =
    targets.length > 0 && targets.every((t) => t.method === targets[0].method)
      ? targets[0].method
      : null;
  return (
    <div>
      <div className="wd-ins-targets" data-uniform={uniform !== null || undefined}>
        {targets.map((t) => (
          <div key={t.id} className="wd-ins-target">
            <span className="wd-ins-target-id" title={`#${t.id}`}>
              <span className="wd-ins-hash">#</span>
              {t.id}
            </span>
            {uniform === null && <span className="wd-ins-target-method">{t.method}</span>}
          </div>
        ))}
      </div>
      {uniform !== null && (
        <div className="wd-ins-note">
          {targets.length === 1
            ? `Bound via ${uniform}.`
            : `All ${targets.length} × ${uniform}.`}
        </div>
      )}
    </div>
  );
}

// ── Event log ────────────────────────────────────────────────────────────────
// Newest first over the store's rolling 100. Consecutive identical events
// coalesce into ONE row with a ×N counter — 3s of 100ms auto-tick is one row
// counting up, never fifteen twins flushing the knob turns off the list.
// Rows are keyed by the group's first entry (WeakMap ids from logSessions —
// the store appends, so references are stable), and a group that STARTS after
// the panel's baseline flashes once as it enters. Preset loads partition the
// list with a labeled session divider — rows above the divider belong to the
// newly-loaded widget, rows below to the one before it.

type LogFamily = "tick" | "input" | "host" | "sys" | "error";

/** Structure a raw store label ("input.fn-bottom-knob +1", "host.rpc
 *  id=0xB201 v=7", "tick.1s", "reset", "kind (error: …)") for display. */
function parseLogLabel(label: string): {
  kind: string;
  detail: string | null;
  delta: number | null;
  family: LogFamily;
} {
  const failed = /\((?:error|preview):/.test(label);
  const space = label.indexOf(" ");
  const kind = space === -1 ? label : label.slice(0, space);
  let detail = space === -1 ? null : label.slice(space + 1);
  let delta: number | null = null;
  if (detail && /^[+-]\d+$/.test(detail)) {
    delta = Number.parseInt(detail, 10);
    detail = null;
  }
  const family: LogFamily = failed
    ? "error"
    : kind.startsWith("tick.")
      ? "tick"
      : kind.startsWith("input.")
        ? "input"
        : kind.startsWith("host.")
          ? "host"
          : "sys";
  return { kind, detail, delta, family };
}

interface LogGroup {
  /** Id of the group's FIRST entry — stable while the group coalesces. */
  key: number;
  label: string;
  count: number;
  /** Latest occurrence — live-updates while a tick group counts up. */
  at: Date;
}

function groupLog(log: DesignerState["eventLog"], floors: readonly number[]): LogGroup[] {
  const groups: LogGroup[] = [];
  // Never coalesce across a session boundary: a tick fired before a preset
  // load and one fired after are different widgets' events, so the divider
  // must be able to sit between them.
  let fi = 0;
  for (const entry of log) {
    const id = logEntryId(entry);
    let crossed = false;
    while (fi < floors.length && id >= floors[fi]) {
      crossed = true;
      fi += 1;
    }
    const last = groups[groups.length - 1];
    if (!crossed && last && last.label === entry.label) {
      last.count += 1;
      last.at = entry.at;
    } else {
      groups.push({ key: id, label: entry.label, count: 1, at: entry.at });
    }
  }
  return groups;
}

const LOG_ROWS = 15;

/** The ONE event-log presentation — the Inspector sections and the Events
 *  tab's log card render identical rows (family dots, coalescing, deltas,
 *  timestamps), differing only in how many rows they keep on screen. Preset
 *  loads render as labeled session dividers, and failed dispatches expand in
 *  place — the full message is a click away, never a native title tooltip. */
export function EventLogList({
  log,
  newSince,
  rows = LOG_ROWS,
}: {
  log: DesignerState["eventLog"];
  newSince: number | null;
  rows?: number;
}) {
  const sessions = getLogSessions();
  const groups = groupLog(
    log,
    sessions.map((s) => s.floor),
  );
  const recent = groups.slice(-rows).reverse();
  const shownEvents = recent.reduce((n, g) => n + g.count, 0);

  // Error rows expand in place to show the full failure message.
  const [expanded, setExpanded] = React.useState<ReadonlySet<number>>(() => new Set());
  const toggleExpanded = (key: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Interleave session dividers, newest-first: a divider sits ABOVE the first
  // row that predates its floor, so everything below it reads as the previous
  // widget's output. Markers with no older rows beneath them never render.
  const items: React.ReactNode[] = [];
  let si = sessions.length - 1;
  for (const g of recent) {
    while (si >= 0 && sessions[si].floor > g.key) {
      const s = sessions[si];
      items.push(
        <div key={`s${s.floor}`} className="wd-ins-logsession" role="separator">
          <span className="wd-ins-logsession-label">
            Loaded {s.label} · <span className="wd-nums">{formatEventTime(s.at)}</span>
          </span>
        </div>,
      );
      si -= 1;
    }
    const { kind, detail, delta, family } = parseLogLabel(g.label);
    const isError = family === "error";
    const isOpen = isError && expanded.has(g.key);
    const inner = (
      <>
        <span className="wd-ins-logdot" aria-hidden="true" />
        <span className="wd-ins-loglabel">
          <KindText kind={kind} withTitle={false} />
          {detail && <span className="wd-ins-logdetail">{detail}</span>}
        </span>
        {delta !== null && (
          <span className="wd-ins-logdelta" data-neg={delta < 0 || undefined}>
            {delta > 0 ? `+${delta}` : delta}
            <span className="sr-only"> knob detents</span>
          </span>
        )}
        {g.count > 1 && (
          <span className="wd-ins-logcount">
            ×{g.count}
            <span className="sr-only"> {countLabel(g.count, "occurrence")} in a row</span>
          </span>
        )}
        <span className="wd-ins-logtime">{formatEventTime(g.at)}</span>
      </>
    );
    items.push(
      <div
        key={g.key}
        className="wd-ins-logitem"
        data-family={family}
        data-new={(newSince !== null && g.key >= newSince) || undefined}
      >
        {isError ? (
          // The failure message is usually longer than the row: the row stays
          // one line (kind whole, message end-ellipsized) and CLICK expands
          // the full text beneath it — the app's own disclosure, not title=.
          <button
            type="button"
            className="wd-ins-logrow"
            data-family="error"
            aria-expanded={isOpen}
            onClick={() => toggleExpanded(g.key)}
          >
            {inner}
            <Icon name="chevron-right" size={12} className="wd-ins-logchev" />
          </button>
        ) : (
          <div className="wd-ins-logrow" data-family={family}>
            {inner}
          </div>
        )}
        {isOpen && <div className="wd-ins-logmsg">{g.label}</div>}
      </div>,
    );
  }

  return (
    <div>
      <div className="wd-ins-log" role="log" aria-label="Simulator event log">
        {items}
      </div>
      {log.length > shownEvents && (
        <div className="wd-ins-note">
          Latest {countLabel(shownEvents, "event")} shown · {log.length.toLocaleString()} logged.
        </div>
      )}
      {/* Dot legend — the family colors are load-bearing once labels get
          tight, so the key lives right here as the section's footer hint
          (mirroring the DOM-targets "All 9 × textContent." pattern). Purely
          visual: screen readers already hear the kind names, so the swatch
          row stays out of the tree. */}
      <div className="wd-ins-note wd-ins-legend" aria-hidden="true">
        {LOG_FAMILIES.map((f) => (
          <span key={f} className="wd-ins-legend-item" data-family={f}>
            <span className="wd-ins-logdot" />
            {f}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Legend order mirrors how often each family shows up in practice. */
const LOG_FAMILIES: readonly LogFamily[] = ["tick", "input", "host", "sys", "error"];

// ── Diagnostics ──────────────────────────────────────────────────────────────
// Severity icon + human summary; the raw compiler text stays behind the shared
// "Show details" disclosure — never verbatim in shell chrome.
//
// The summary NEVER character-truncates (a mid-word "Check the root clas…"
// reads as a broken layout, doubly so above a "Show details" affordance).
// A summary with no hidden detail simply wraps in full; one that DOES carry a
// disclosure clamps at a rendered line boundary (CSS line-clamp, 3 lines) —
// clipping, when it happens at all, looks intentional and the full text is
// one click away.

function DiagnosticRow({ item }: { item: DiagnosticViewItem }) {
  const meta = SEVERITY_META[item.severity];
  const summary = humanizeDiagnostic(item.message);
  const [open, setOpen] = React.useState(false);
  const hasDetail = item.message.trim() !== summary;
  // A diagnostic that lives in a source buffer links straight back to it:
  // "Go to source" opens the Source tab and selects the first offending
  // range — the same range the editor's lint gutter marks.
  const jumpable =
    item.severity !== "info" &&
    (item.source === "script" || item.source === "html" || item.source === "css");
  return (
    <div className="wd-ins-diagrow" data-sev={item.severity}>
      <Icon name={meta.icon} size={14} className="wd-ins-diagicon" />
      <div className="min-w-0 flex-1">
        <div className="wd-ins-diagtext" data-clamp={hasDetail || undefined}>
          <span className="sr-only">{meta.noun}: </span>
          {summary}{" "}
          <span className="wd-ins-diagsrc">
            · {item.source}
            {item.line !== undefined && <span className="wd-nums"> · line {item.line}</span>}
          </span>
        </div>
        {(jumpable || hasDetail) && (
          <div className="wd-ins-diagmeta">
            {jumpable && (
              <button type="button" className="wd-disclose" data-link onClick={revealSource}>
                Go to source
                <Icon name="chevron-right" size={12} />
              </button>
            )}
            {hasDetail && (
              <button
                type="button"
                className="wd-disclose"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
              >
                <Icon name="chevron-right" size={12} className="wd-disclose-chevron" />
                {open ? "Hide details" : "Show details"}
              </button>
            )}
          </div>
        )}
        {hasDetail && open && (
          <pre className="wd-issue-detail">
            {item.message}
            {item.line !== undefined && (
              <span className="wd-issue-detail-pos">
                {"\n"}— line {item.line}
                {item.col !== undefined ? `, column ${item.col}` : ""} in {item.source}
              </span>
            )}
          </pre>
        )}
      </div>
    </div>
  );
}

/** Preview-only widgets: a quiet MODE note, not a counted diagnostic. */
function PreviewOnlyNote({ mode }: { mode: NonNullable<DiagnosticsView["previewOnly"]> }) {
  const legacy = useLegacyTools();
  return (
    <div className="wd-ins-modenote">
      <Icon name="info" size={14} />
      <span>
        Preview-only widget — {mode.api ? <code>{mode.api}()</code> : "this script"} runs in the
        live preview but not in the {legacy ? "strict F2JS VM" : "strict device VM"}, so Build
        widget stays greyed out. The preview and every event surface stay fully interactive.
      </span>
    </div>
  );
}

// ── mquickjs budgets ─────────────────────────────────────────────────────────
// The Package meter reads whichever artifact is fresh for THIS exact source:
// the F2JS build first, else the assembled F2UP container (so the header's
// green "Ready to send · 56,599 B" chip and this bar can never contradict
// each other).
// With neither, the footnote names the action that fills it.

function Budgets({
  state,
  compact,
  pkgBytes,
  f2jsBytes,
  srcBytes,
}: {
  state: DesignerState;
  compact: boolean;
  /** Freshness-gated package size (see InspectorPanel) — a stale package's
   *  size is not this widget's budget, so null renders explicit empty. */
  pkgBytes: number | null;
  f2jsBytes: number | null;
  srcBytes: number;
}) {
  const legacy = useLegacyTools();
  const meters = (
    <>
      <BudgetMeter label="Package" value={pkgBytes} cap={MQUICKJS_LIMITS.packageBytes} />
      <BudgetMeter label="Source size" value={srcBytes} cap={MQUICKJS_LIMITS.sourceBytes} />
      <BudgetMeter label="Events" value={state.handlers.length} cap={MQUICKJS_LIMITS.eventRecords} />
      <BudgetMeter label="Elements" value={state.targets.length} cap={MQUICKJS_LIMITS.targets} />
    </>
  );
  return (
    <div>
      {compact ? (
        <div className="wd-ins-meters-rail space-y-1">{meters}</div>
      ) : (
        <div className="wd-meters wd-ins-meters">{meters}</div>
      )}
      {pkgBytes === null ? (
        <div className="wd-ins-note">
          {legacy
            ? "Nothing built yet — run Build F2JS or Build widget on the Send tab."
            : "Nothing built yet — press Build widget (top right, or on the Send tab) to measure it."}
        </div>
      ) : legacy && f2jsBytes === null ? (
        <div className="wd-ins-note">Measured from the built widget, not the F2JS package.</div>
      ) : null}
      {!compact && (
        <div className="wd-ins-note">
          Caps come straight from the engine — handler, target, and byte budgets are hard limits.
        </div>
      )}
    </div>
  );
}
