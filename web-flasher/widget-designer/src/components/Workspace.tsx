import { useCallback, useLayoutEffect, useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { DesignerPanel } from "./DesignerPanel";
import { InspectorPanel } from "./InspectorPanel";
import { SourceWorkspace } from "./SourceWorkspace";
import { CompilerPanel } from "./CompilerPanel";
import { DevicePanel } from "./DevicePanel";
import type { useDevice } from "../device/useDevice";
import { ViewportShell } from "./ViewportShell";
import type { DesignerState, DesignerActions } from "../designer/store";

// Four tabs. Events + Host data dissolved INTO Source (they are part of the
// widget's source — see SourceWorkspace), and Inspect folded into the Design
// rail (the same sections, compact); legacy ?tab= URLs map in App.tsx.
export type WorkspaceTab = "design" | "source" | "export" | "device";

/**
 * Has this browser been shown the getting-started steps? Storage failures
 * (private window, blocked site data) answer "yes" deliberately: a guide that
 * cannot remember being dismissed would come back on every single load, which
 * is a worse experience than never meeting it. Same "wd-" key convention as
 * wd-sidebar and wd-knob-hint-seen.
 */
function firstRunSeen(): boolean {
  try {
    return localStorage.getItem("wd-first-run-seen") === "1";
  } catch {
    return true;
  }
}

/**
 * The three moves that make up this product, said once, in the stage pane a
 * cold open lands on. Without it the first screen is somebody else's weather
 * widget on a dark rectangle, a rail of accordions and four tab names — with
 * nothing anywhere saying what gets made here or where to start. Each step is
 * a button that puts the designer where that step happens, and the strip is
 * FLOW content above the stage, never a layer over it: the device preview is
 * the one thing that must always stay visible.
 */
function FirstRunSteps({
  onShowExamples,
  onNavigate,
  onDismiss,
}: {
  onShowExamples: () => void;
  onNavigate: (tab: WorkspaceTab) => void;
  onDismiss: () => void;
}) {
  const steps = [
    {
      title: "Pick an example",
      detail: "Start from a widget that already works.",
      go: onShowExamples,
    },
    {
      title: "Make it yours",
      detail: "Edit its HTML, CSS and JavaScript in Source.",
      go: () => onNavigate("source"),
    },
    {
      title: "Send it to your keyboard",
      detail: "Plug in your F1, then send the widget over.",
      go: () => onNavigate("device"),
    },
  ];
  return (
    <div
      className="rounded-md border border-border bg-panel px-3 py-2.5"
      role="group"
      aria-label="Getting started"
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-fg">
          New here? Building a widget takes three moves.
        </span>
        <button
          type="button"
          className="wd-iconbtn ml-auto"
          aria-label="Hide the getting-started steps"
          onClick={onDismiss}
        >
          <Icon name="x" size={14} />
        </button>
      </div>
      <ol className="mt-1.5 flex flex-wrap gap-2">
        {steps.map((step, i) => (
          <li key={step.title} className="min-w-[220px] flex-1">
            <button
              type="button"
              onClick={step.go}
              className="flex w-full items-start gap-2 rounded-md border border-transparent bg-inset px-2.5 py-2 text-left transition-colors hover:border-accent-border hover:bg-raised"
            >
              {/* The <ol> already carries the order for assistive tech, so the
                  numeral is decoration — it exists to make the sequence
                  readable at a glance. */}
              <span
                aria-hidden="true"
                className="mt-px flex h-4 w-4 flex-none items-center justify-center rounded-full bg-accent text-[10px] font-semibold leading-none text-accent-fg"
              >
                {i + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-medium text-fg">{step.title}</span>
                <span className="block text-xs text-muted-fg">{step.detail}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function Workspace({
  state, actions, tab, device, onScrolledChange, onNavigate, onShowExamples,
}: {
  state: DesignerState;
  actions: DesignerActions;
  tab: WorkspaceTab;
  // Owned by App, not by DevicePanel: the WebHID client and device state must
  // survive tab switches, or every visit to another tab silently drops the
  // connection (and leaks the open HID handle).
  device: ReturnType<typeof useDevice>;
  /** Reports whether the workspace has scrolled (topbar elevation). */
  onScrolledChange?: (scrolled: boolean) => void;
  /** Switches tabs — the first-run steps take the designer to the tab each
   *  step happens on. */
  onNavigate: (tab: WorkspaceTab) => void;
  /** Reveals the example gallery (the sidebar boots collapsed under 1200px). */
  onShowExamples: () => void;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Shown until the designer dismisses it, then gone for good on this browser.
  const [firstRun, setFirstRun] = useState(() => !firstRunSeen());
  const dismissFirstRun = useCallback(() => {
    setFirstRun(false);
    try {
      localStorage.setItem("wd-first-run-seen", "1");
    } catch {
      /* storage unavailable */
    }
  }, []);

  // Topbar elevation: a 1px sentinel at the top of the document-style scroll
  // container; once it leaves, the header casts its shadow. The Design tab
  // has NO document scroller — its two panes scroll independently and the
  // stage never slides under the header — so elevation resets there.
  useEffect(() => {
    if (!onScrolledChange) return;
    if (tab === "design") {
      onScrolledChange(false);
      return;
    }
    const scroller = scrollerRef.current;
    const sentinel = sentinelRef.current;
    if (!scroller || !sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => onScrolledChange(!entry.isIntersecting),
      { root: scroller },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [onScrolledChange, tab]);

  // Per-tab scroll memory: each document-style tab keeps its own scroll
  // position instead of inheriting wherever the previous tab left the shared
  // container. (The Design tab's rail keeps its own position for free — it
  // stays mounted, so its scrollTop simply survives.)
  const scrollMemory = useRef<Partial<Record<WorkspaceTab, number>>>({});
  const prevTabRef = useRef(tab);
  useLayoutEffect(() => {
    if (prevTabRef.current !== tab) {
      prevTabRef.current = tab;
      const scroller = scrollerRef.current;
      if (scroller) scroller.scrollTop = scrollMemory.current[tab] ?? 0;
    }
  }, [tab]);

  return (
    <main className="wd-main">
      {/*
        The design tab stays MOUNTED on other tabs, hidden OFF-SCREEN rather
        than display:none: the device push measures target geometry from the
        live preview via getBoundingClientRect, and a display:none iframe has
        no layout - every rect comes back zero-sized, which shipped a widget
        whose facade painted text into nothing. visibility:hidden +
        position:fixed off-screen keeps real layout (and the running widget
        state) while contributing no visible box and no scroll space.

        inert + aria-hidden belt the hiding: while parked off-screen, none of
        the tab's controls (accordion rows, "Show details" disclosures, the
        stage knob) can be reached by keyboard, hit by automation, or read by
        AT — layout survives (inert never removes boxes), so the push path's
        getBoundingClientRect measurements are unaffected.
      */}
      <div
        className="wd-design-tab"
        inert={tab !== "design"}
        aria-hidden={tab === "design" ? undefined : true}
        style={tab === "design" ? undefined : {
          visibility: "hidden", position: "fixed", left: "-20000px", top: 0,
          width: "1400px", pointerEvents: "none",
        }}
      >
        {/* Fixed-height app layout: the stage pane and the inspector rail are
            siblings that each own their scroll. Expanding rail sections can
            never push the device, the sim pill, or the zoom toolbar
            off-screen. */}
        <div className="wd-design-grid">
          {/* While the first-run steps are up, the pane is a two-row grid: an
              auto row for the strip and a minmax(0,1fr) row for the stage. The
              stage is height:100%, so it needs a row with a DEFINITE height —
              stacked as plain blocks it would keep claiming the pane's full
              height and push its own zoom and simulator controls below the
              fold. Dismissed, the pane is exactly the single-child block it
              has always been, with no layout delta at all. */}
          <section
            className="wd-design-stage-pane"
            aria-label="Device stage"
            style={
              firstRun
                ? {
                    display: "grid",
                    gridTemplateRows: "auto minmax(0, 1fr)",
                    gap: "var(--wd-space-3)",
                  }
                : undefined
            }
          >
            {firstRun && (
              <FirstRunSteps
                onShowExamples={onShowExamples}
                onNavigate={onNavigate}
                onDismiss={dismissFirstRun}
              />
            )}
            <ViewportShell state={state} actions={actions} />
          </section>
          <aside className="wd-design-rail" aria-label="Widget inspector rail">
            <DesignerPanel state={state} actions={actions} />
            <InspectorPanel state={state} actions={actions} compact />
          </aside>
        </div>
      </div>
      {tab !== "design" && (
        <div
          ref={scrollerRef}
          className="wd-scroller"
          onScroll={(e) => {
            scrollMemory.current[tab] = e.currentTarget.scrollTop;
          }}
        >
          {/* Elevation sentinel: absolutely positioned so it adds zero flow
              height — the content gutter stays an exact 20px on the 4px grid. */}
          <div
            ref={sentinelRef}
            aria-hidden="true"
            style={{ position: "absolute", top: 0, left: 0, width: 1, height: 1 }}
          />
          {/* px-6 = the app's one 24px left rail (topbar brand, Examples strip,
              cards, footer all share it). Full-width padding, never a centered
              fixed-width block, so no half-pixel card origins. */}
          <div className="px-6 py-5">
            {tab === "source" && <SourceWorkspace state={state} actions={actions} />}
            {tab === "export" && <CompilerPanel state={state} actions={actions} device={device} />}
            {tab === "device" && <DevicePanel state={state} actions={actions} device={device} />}
          </div>
        </div>
      )}
    </main>
  );
}
