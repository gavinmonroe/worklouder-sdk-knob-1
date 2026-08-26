import { useLayoutEffect, useEffect, useRef } from "react";
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

export function Workspace({
  state, actions, tab, device, onScrolledChange,
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
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

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
          <section className="wd-design-stage-pane" aria-label="Device stage">
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
