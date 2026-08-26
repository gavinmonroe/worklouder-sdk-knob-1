import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Topbar } from "./components/Topbar";
import { Workspace } from "./components/Workspace";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { ToastProvider } from "./components/toast";
import { TabNav, Tooltip } from "./components/ui";
import { Icon } from "./components/icons";
import {
  onRevealDeviceTab,
  onRevealDiagnostics,
  onRevealSource,
  requestHostDataReveal,
  requestReferenceReveal,
} from "./components/diagnosticsView";
import { markLogSession } from "./components/logSessions";
import { preferredPresetSource } from "./components/pipeline";
import { presetStageCss } from "./components/presetFidelity";
import { PRESETS } from "./presets/widgets";
import { useDesignerStore } from "./designer/store";
import { loadSourceDraft } from "./designer/sourceDraft";
import { useDevice } from "./device/useDevice";
import type { WorkspaceTab } from "./components/Workspace";

const TAB_IDS: readonly WorkspaceTab[] = ["design", "source", "export", "device"];

const TAB_ITEMS: { id: WorkspaceTab; label: string }[] = [
  { id: "design", label: "Design" },
  { id: "source", label: "Source" },
  { id: "export", label: "Export" },
  { id: "device", label: "Device" },
];

/**
 * Pre-restructure tab URLs keep working: Events and Host data dissolved into
 * the Source view (a one-shot reveal flag steers the workspace to the exact
 * surface the URL named), and Inspect folded into the Design rail. The mount
 * effect below rewrites the URL to the canonical tab name.
 */
const LEGACY_TAB_ALIASES: Record<string, WorkspaceTab> = {
  events: "source",
  hostdata: "source",
  inspect: "design",
};

/**
 * The example the shell boots into. "Weather (device DSL)" is the flagship:
 * it renders a clean first frame (no glyph overflow), and — loaded with the
 * canonical strict header — passes the strict simulator, Build F2JS, and the
 * F2UP device-DSL gate, so the very first thing a new user sees is the whole
 * pipeline green.
 */
const BOOT_PRESET: keyof typeof PRESETS = "weatherDevice";

function tabFromUrl(): WorkspaceTab {
  const t = new URLSearchParams(window.location.search).get("tab");
  if (t && t in LEGACY_TAB_ALIASES) {
    // The dissolved tabs deep-link to their new homes inside Source.
    if (t === "events") requestReferenceReveal();
    if (t === "hostdata") requestHostDataReveal();
    return LEGACY_TAB_ALIASES[t];
  }
  return (TAB_IDS as readonly string[]).includes(t ?? "") ? (t as WorkspaceTab) : "design";
}

/**
 * Reflect a USER tab change into ?tab=. Two hygiene rules keep the URL honest:
 *
 *   1. Write-on-change only — if the URL already names this tab (or names no
 *      tab and this is the boot default), leave the URL exactly as the user
 *      typed it. A cleared URL must never be silently re-populated moments
 *      after load by boot-time effects.
 *   2. Touch nothing but `tab`. Every other param (notably ?f2upGen, which
 *      pins the assemble generation and renders as a visible pin on the
 *      Export tab) is carried verbatim — never added, never resurrected.
 */
function syncTabToUrl(tab: WorkspaceTab) {
  const url = new URL(window.location.href);
  const current = url.searchParams.get("tab");
  if (current === tab) return;
  if (current === null && tab === "design") return;
  url.searchParams.set("tab", tab);
  window.history.replaceState(window.history.state, "", url);
}

/** Sidebar visibility: an explicit choice persists; with none stored, wide
 *  viewports open it and narrow ones (<1200px) boot collapsed. */
function initialSidebarOpen(): boolean {
  try {
    const stored = localStorage.getItem("wd-sidebar");
    if (stored === "open") return true;
    if (stored === "collapsed") return false;
  } catch {
    /* storage unavailable */
  }
  return window.innerWidth >= 1200;
}

export default function App() {
  const [tab, setTabState] = useState<WorkspaceTab>(tabFromUrl);
  const [scrolled, setScrolled] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(initialSidebarOpen);
  const { state, actions } = useDesignerStore();
  // Lives here, above every tab: the WebHID client must survive tab switches.
  const device = useDevice();

  const setTab = useCallback((t: WorkspaceTab) => {
    setTabState(t);
    syncTabToUrl(t);
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((open) => {
      const next = !open;
      try {
        localStorage.setItem("wd-sidebar", next ? "open" : "collapsed");
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  }, []);

  // Picking an example replaces the source and NOTHING else — the current tab
  // stays put and its content refreshes with the new widget. The shell loads
  // the source it can stand behind: the strict header is applied when that
  // alone unlocks the packaging pipeline (same edit the Export remedy button
  // makes), and the glyph-grid examples get their stage-fidelity CSS patch so
  // no shipped example renders collided text (see presetFidelity.ts).
  // Session boundary for the event log: rows dispatched before this load
  // belong to the outgoing widget, and every log view draws a labeled divider
  // at the boundary so stale rows are never read as the new widget's output.
  const logRef = useRef(state.eventLog);
  logRef.current = state.eventLog;

  const pickPreset = useCallback(
    (id: keyof typeof PRESETS) => {
      markLogSession(logRef.current, PRESETS[id].name);
      actions.loadPreset(id);
      const preferred = preferredPresetSource(PRESETS[id].script);
      if (preferred !== PRESETS[id].script) actions.setJs(preferred);
      const stageCss = presetStageCss(id, PRESETS[id].css);
      if (stageCss !== PRESETS[id].css) actions.setCss(stageCss);
    },
    [actions],
  );

  // Boot into the flagship example BEFORE the workspace (and its preview
  // iframe) ever mounts: layout effects flush synchronously before paint, and
  // swapping an iframe's srcdoc while its very first load is still in flight
  // can leave the stale document painted. Holding the workspace back one
  // unpainted frame guarantees the first srcdoc the iframe ever receives is
  // already the boot example — a clean first frame, no glyph collision.
  //
  // A persisted source draft (the store debounce-writes one on every edit)
  // takes precedence: a reload returns to exactly the widget you were on. The
  // Sidebar derives active/custom rows from CONTENT, so a draft matching a
  // preset highlights that preset and an edited draft pins the "custom" row.
  const [booted, setBooted] = useState(false);
  useLayoutEffect(() => {
    if (booted) return;
    const draft = loadSourceDraft();
    if (draft) {
      actions.recompile({
        html: draft.html,
        css: draft.css,
        js: draft.js,
        name: draft.displayName,
        rootClass: draft.rootClass,
      });
    } else {
      pickPreset(BOOT_PRESET);
    }
    setBooted(true);
  }, [booted, pickPreset, actions]);

  // A legacy ?tab= URL (events/hostdata/inspect) already landed on its new
  // home via tabFromUrl; rewrite the URL once so it names the canonical tab.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t && t in LEGACY_TAB_ALIASES) syncTabToUrl(LEGACY_TAB_ALIASES[t]);
  }, []);

  // "View diagnostics" deep links (footer issue button, compile-failure
  // toasts, blocked-build callouts) land on the Design tab, where the
  // inspector rail opens + flashes its Diagnostics row.
  useEffect(() => onRevealDiagnostics(() => setTab("design")), [setTab]);

  // "Go to source" deep links (Inspector diagnostic rows) land on the Source
  // tab; the workspace consumes the pending jump once its editor is ready.
  useEffect(() => onRevealSource(() => setTab("source")), [setTab]);

  // "Open Device tab" handoff from the Export pipeline's Push stage.
  useEffect(() => onRevealDeviceTab(() => setTab("device")), [setTab]);

  return (
    <ToastProvider>
      <div className="f1-shell">
        <header className="wd-header">
          <Topbar state={state} actions={actions} />
        </header>
        {/* IDE body: examples sidebar left, center pane (tab row + workspace).
            CRITICAL: neither .wd-ide nor .wd-center may ever carry transform,
            filter, contain, or will-change — the parked off-screen Design tab
            (Workspace) relies on position:fixed geometry for push capture. */}
        <div className="wd-ide" data-sidebar={sidebarOpen ? undefined : "collapsed"}>
          <Sidebar state={state} onPick={pickPreset} />
          <div className="wd-center">
            <div className="wd-tabrow" data-scrolled={scrolled || undefined}>
              <Tooltip label={sidebarOpen ? "Hide the example gallery" : "Show the example gallery"}>
                <button
                  type="button"
                  className="wd-iconbtn wd-tabrow-toggle"
                  aria-label={sidebarOpen ? "Hide the example gallery" : "Show the example gallery"}
                  aria-expanded={sidebarOpen}
                  onClick={toggleSidebar}
                >
                  <Icon name="sidebar" size={15} />
                </button>
              </Tooltip>
              <TabNav<WorkspaceTab>
                value={tab}
                onValueChange={setTab}
                items={TAB_ITEMS}
                aria-label="Workspace"
              />
            </div>
            {booted ? (
              <Workspace
                state={state}
                actions={actions}
                tab={tab}
                device={device}
                onScrolledChange={setScrolled}
              />
            ) : (
              <main aria-hidden="true" />
            )}
          </div>
        </div>
        <StatusBar state={state} device={device.state} onNavigate={setTab} />
      </div>
    </ToastProvider>
  );
}
