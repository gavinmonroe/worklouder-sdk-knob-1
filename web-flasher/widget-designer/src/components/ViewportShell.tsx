import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DesignerState, DesignerActions } from "../designer/store";
import { Button, SegmentedControl, StatusDot, Tooltip, type StatusDotState } from "./ui";
import { AutoTickControl } from "./AutoTickControl";
import { Icon } from "./icons";
import { isEmptyRender } from "./diagnosticsView";
import { buildWidgetSrcdoc } from "../compiler/widgetRuntime";
import { guardWidgetScript } from "./previewScriptGuard";
import { DeviceFrameView } from "./DeviceFrameView";
import { useF2upStatus } from "./f2upStatus";

/**
 * Renders the simulated F1 device surface on the device stage (§5): a dotted
 * canvas, a charcoal hardware bezel (screen deck + knob chin) under a
 * Figma-style frame label, HUD pills for sim state, and a floating zoom pill
 * with Fit + percentage readout. The canvas pans (drag / scroll) and zooms
 * (⌘/Ctrl+scroll, presets) like a design tool — no raw scrollbars.
 *
 * The widget's real HTML+CSS is rendered in a sandboxed iframe (so the
 * author's CSS can't leak into the designer), and its script runs against
 * that DOM with the mquickjs intrinsics (mod/pick/formatTime) + widget shim
 * injected. The browser is the renderer, so raster widgets (weather, etc.)
 * are pixel-perfect — no subset-CSS glyph approximation.
 *
 * Everything stage-related wraps AROUND the iframe: the srcdoc composition,
 * registerPreview timing, and the zoom-transform sizing math are untouched.
 */

/* Bezel chrome at 1× (see .wd-bezel: every chrome dimension is Npx × zoom):
   width = 100 aperture + 2×8 side padding; height = 8 top padding + 310
   aperture + 8 seam gap + 28 chin — a symmetric 8u rhythm above the glass and
   between glass and knob deck. The frame label above is app chrome and does
   NOT scale. */
const FRAME_BASE_W = 116;
const FRAME_BASE_H = 354;
const FRAME_LABEL_H = 24; // 16px label + 8px gap
/* Fit keeps the frame clear of the 40px floating HUD rows (12px inset + 40px
   toolbar + 4px breathing room). */
const FIT_MARGIN = 56;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 6;

const clampNum = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

type ZoomPresetId = "fit" | "1" | "2" | "3" | "4";

export function ViewportShell({
  state,
  actions,
  embedded = false,
}: {
  state: DesignerState;
  actions: DesignerActions;
  embedded?: boolean;
}) {
  // Fit is the default composition (embedded keeps its fixed 2×): the
  // signature view must load with the frame floating clear of every edge,
  // never wedged against the canvas. The mount effect below resolves the
  // actual fitting scale before first paint.
  const [zoom, setZoom] = useState<number>(2);
  // Preview stage view: "design" is the current HTML/CSS iframe; "device" is the
  // oracle raster — the actual on-device 100×310 pixels — layered over the SAME
  // (still-laid-out) iframe. Additive; the iframe/registerPreview path is
  // untouched. Only the full stage has the toggle; embedded stays "design".
  const [viewMode, setViewMode] = useState<"design" | "device">("design");
  const [fitMode, setFitMode] = useState(() => !embedded);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  // Which canvas edges the frame currently overflows — drives the scroll
  // shadows that say "there is more device past this edge; pan".
  const [clipped, setClipped] = useState({ top: false, right: false, bottom: false, left: false });
  const [zoomDraft, setZoomDraft] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);

  const srcdoc = useMemo(
    () =>
      buildWidgetSrcdoc({
        html: state.html,
        css: state.css,
        // Guarded, not raw: a parse error in the author's script must land in
        // window.__widgetError / Diagnostics, never as an uncaught console
        // error from the sandbox (see previewScriptGuard.ts). The composition
        // itself — buildWidgetSrcdoc, memo deps, registerPreview timing — is
        // unchanged.
        script: guardWidgetScript(state.js),
        rootClass: state.rootClass,
        hostData: state.hostData,
      }),
    [state.html, state.css, state.js, state.rootClass, state.hostData],
  );

  // Re-dispatch the last event whenever the source changes (so a recompile
  // re-runs the script against the fresh DOM).
  const lastEventRef = useRef(state.lastEventKind);
  useEffect(() => {
    lastEventRef.current = state.lastEventKind;
  }, [state.lastEventKind]);

  // Register the iframe runtime with the store, so events route into the
  // real DOM.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    // Register the element only. Events and snapshots go through the
    // postMessage bridge, which is the sole channel into an opaque origin.
    //
    // Register IMMEDIATELY, not just on `load`: a srcdoc iframe can finish
    // loading before this effect attaches its listener (and the opaque origin
    // hides readyState, so that race is undetectable). Consumers that need
    // the widget shim answering — capture, measure — poll the bridge via
    // waitForPreview, so registering a still-loading element is safe.
    actions.registerPreview(iframe);
    const onLoad = () => actions.registerPreview(iframe);
    iframe.addEventListener("load", onLoad);
    return () => iframe.removeEventListener("load", onLoad);
  }, [srcdoc, actions]);

  // ── Canvas geometry ──────────────────────────────────────────────────────

  /** Largest scale (not integer-limited) where the frame + 48px margin fits. */
  const computeFit = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return 2;
    const availW = c.clientWidth - FIT_MARGIN * 2;
    const availH = c.clientHeight - FIT_MARGIN * 2 - FRAME_LABEL_H;
    if (availW <= 0 || availH <= 0) return 2;
    return clampNum(Math.min(availW / FRAME_BASE_W, availH / FRAME_BASE_H), ZOOM_MIN, ZOOM_MAX);
  }, []);

  /** Keep the frame reachable: at least 48px of it stays inside the canvas. */
  const clampPan = useCallback((p: { x: number; y: number }) => {
    const c = canvasRef.current;
    const f = frameRef.current;
    if (!c || !f) return p;
    const limX = Math.max(0, (c.clientWidth + f.offsetWidth) / 2 - 48);
    const limY = Math.max(0, (c.clientHeight + f.offsetHeight) / 2 - 48);
    return { x: clampNum(p.x, -limX, limX), y: clampNum(p.y, -limY, limY) };
  }, []);

  const applyPreset = useCallback(
    (id: ZoomPresetId) => {
      let nextPan = { x: 0, y: 0 }; // recenter on every zoom-preset change
      if (id === "fit") {
        setFitMode(true);
        setZoom(computeFit());
      } else {
        setFitMode(false);
        const z = Number(id);
        setZoom(z);
        // Caption clearance: when the centered frame would park its label
        // within 24px of the canvas top (the near-fit band, e.g. 2× in a
        // 736px canvas), nudge the frame down so the label keeps a 24px
        // offset — the bottom clip is announced by the scroll shadow. A
        // frame that overflows far past the top (3×/4×) stays truly
        // centered so first paint shows the middle of the widget.
        const c = canvasRef.current;
        if (c) {
          const frameH = FRAME_BASE_H * z + FRAME_LABEL_H;
          const centeredTop = (c.clientHeight - frameH) / 2;
          if (centeredTop < 24 && centeredTop > -(FRAME_LABEL_H + 24)) {
            nextPan = { x: 0, y: 24 - centeredTop };
          }
        }
      }
      setPan(nextPan);
      // Defense in depth beside the pan reset: the canvas is overflow:clip
      // (unscrollable), but if any native scroll offset ever sneaks in (a
      // focus scroll, a stale engine offset), a zoom change flushes it so
      // "Fit" always means centered — never a frame stuck against one edge.
      const c = canvasRef.current;
      if (c) {
        c.scrollTop = 0;
        c.scrollLeft = 0;
      }
    },
    [computeFit],
  );

  // Default = Fit: resolve the fitting scale against the real canvas before
  // first paint, so the signature view never flashes a cramped 2×.
  useLayoutEffect(() => {
    if (embedded) return;
    setZoom(computeFit());
    // Mount only — after this, Fit liveness belongs to the ResizeObserver.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fit stays live: while active, track canvas resizes (panel collapse,
  // window resize) and recompute the fitting scale.
  useEffect(() => {
    if (embedded || !fitMode) return;
    const c = canvasRef.current;
    if (!c) return;
    const ro = new ResizeObserver(() => setZoom(computeFit()));
    ro.observe(c);
    return () => ro.disconnect();
  }, [embedded, fitMode, computeFit]);

  // Scroll-shadow bookkeeping: whenever pan/zoom/layout move the frame past a
  // canvas edge, that edge gains a soft inset shadow — the affordance that
  // more device exists off-screen and the canvas pans.
  useEffect(() => {
    if (embedded) return;
    const measure = () => {
      const c = canvasRef.current;
      const f = frameRef.current;
      if (!c || !f) return;
      const cr = c.getBoundingClientRect();
      const fr = f.getBoundingClientRect();
      const next = {
        top: fr.top < cr.top - 1,
        right: fr.right > cr.right + 1,
        bottom: fr.bottom > cr.bottom + 1,
        left: fr.left < cr.left - 1,
      };
      setClipped((p) =>
        p.top === next.top && p.right === next.right && p.bottom === next.bottom && p.left === next.left
          ? p
          : next,
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (canvasRef.current) ro.observe(canvasRef.current);
    return () => ro.disconnect();
  }, [embedded, pan, zoom]);

  // Re-clamp the pan when the zoom changes underneath it (wheel-zoom keeps
  // the pan; a smaller frame must not strand itself outside the canvas).
  useLayoutEffect(() => {
    setPan((p) => {
      if (p.x === 0 && p.y === 0) return p;
      const q = clampPan(p);
      return q.x === p.x && q.y === p.y ? p : q;
    });
  }, [zoom, clampPan]);

  // Wheel: plain scroll pans, ⌘/Ctrl+scroll (and trackpad pinch) zooms.
  // Native non-passive listener — React's synthetic onWheel is passive and
  // cannot preventDefault the page scroll.
  useEffect(() => {
    if (embedded) return;
    const c = canvasRef.current;
    if (!c) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        setFitMode(false);
        setZoom((z) => clampNum(z * Math.exp(-e.deltaY * 0.0022), ZOOM_MIN, ZOOM_MAX));
      } else {
        setPan((p) => clampPan({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
      }
    };
    c.addEventListener("wheel", onWheel, { passive: false });
    return () => c.removeEventListener("wheel", onWheel);
  }, [embedded, clampPan]);

  // Drag-to-pan (Figma hand tool, no modifier needed — the canvas is not a
  // text surface). Pointer capture keeps the drag alive outside the stage.
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (embedded || e.button !== 0) return;
    dragRef.current = { px: e.clientX, py: e.clientY, ox: pan.x, oy: pan.y };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // A pointer that vanished between down and capture (or a synthetic
      // event) still pans — capture only widens the drag's reach.
    }
    setPanning(true);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    setPan(clampPan({ x: d.ox + (e.clientX - d.px), y: d.oy + (e.clientY - d.py) }));
  };
  const onPointerEnd = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setPanning(false);
  };

  const status = state.simState;
  // The assembled container for the CURRENT source (null when none / stale).
  // Read here only for the "pixel-exact" reassurance chip's sha; DeviceFrameView
  // owns the decode/render. The sha is literally the value CompilerPanel's
  // #f2up-base64 exposes as data-sha256 — same bytes as the push.
  const f2up = useF2upStatus({ html: state.html, css: state.css, js: state.js });
  const deviceMode = !embedded && viewMode === "device";
  // A compiled scene with zero visible boxes is a void — the HUD must say so
  // instead of minting a green "Ready" over a black screen (the same signal
  // feeds the diagnostics count and the aperture overlay below).
  const empty = isEmptyRender(state);

  const SIM_DOT: Record<DesignerState["simState"], StatusDotState> = {
    idle: "idle",
    ready: "ok",
    running: "busy",
  };
  const SIM_LABEL: Record<DesignerState["simState"], string> = {
    idle: "Idle",
    ready: "Ready",
    running: "Running",
  };

  // ── The bezel knob is the F1's primary input, so it WORKS on the stage:
  // click = one detent clockwise (Shift = counter-clockwise), scroll or arrow
  // keys turn it, and each detent dispatches a real input.fn-bottom-knob
  // event through the simulator — same path as the Events tab. The cap's
  // position tick rotates 30° per detent so the hardware answers visibly.
  const knobRef = useRef<HTMLButtonElement | null>(null);
  const knobWheelAcc = useRef(0);
  const [knobTurn, setKnobTurn] = useState(0);
  // First-run hint: a one-time floating micro-pill saying the knob is a live
  // control. Purely additive stage chrome — dismissed (and remembered) on the
  // first detent, or after ~6 seconds of the stage actually being on screen
  // (the parked off-screen design tab must not burn the one showing).
  const [knobHint, setKnobHint] = useState<boolean>(() => {
    if (embedded) return false;
    try {
      return localStorage.getItem("wd-knob-hint-seen") !== "1";
    } catch {
      return false;
    }
  });
  const dismissKnobHint = useCallback(() => {
    setKnobHint((was) => {
      if (!was) return was;
      try {
        localStorage.setItem("wd-knob-hint-seen", "1");
      } catch {
        /* storage unavailable */
      }
      return false;
    });
  }, []);
  useEffect(() => {
    if (!knobHint) return;
    let visibleSeconds = 0;
    const interval = window.setInterval(() => {
      const el = canvasRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      // The design tab parks at left:-20000px while other tabs show — only
      // seconds the stage is actually visible count toward the timeout.
      if (rect.left > -1000 && rect.width > 0) {
        visibleSeconds += 1;
        if (visibleSeconds >= 6) dismissKnobHint();
      }
    }, 1000);
    return () => window.clearInterval(interval);
  }, [knobHint, dismissKnobHint]);
  // Each detent blinks the status LED for a beat — the hardware acknowledges
  // the input even when the widget itself doesn't visibly change.
  const [ledFlash, setLedFlash] = useState(false);
  const ledFlashTimer = useRef<number | undefined>(undefined);
  const turnKnob = useCallback(
    (delta: number) => {
      setKnobTurn((t) => t + delta);
      setLedFlash(true);
      window.clearTimeout(ledFlashTimer.current);
      ledFlashTimer.current = window.setTimeout(() => setLedFlash(false), 320);
      dismissKnobHint();
      actions.dispatch({
        kind: "input.fn-bottom-knob",
        delta,
        displayName: "Fn knob",
        description: "stage bezel knob",
      });
    },
    [actions, dismissKnobHint],
  );
  useEffect(() => () => window.clearTimeout(ledFlashTimer.current), []);
  // Native non-passive wheel listener: the canvas' own wheel handler pans the
  // stage, so knob scrolls must preventDefault + stopPropagation before it.
  useEffect(() => {
    const el = knobRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      knobWheelAcc.current += e.deltaY !== 0 ? e.deltaY : e.deltaX;
      // ~24px of wheel travel per detent — coarse enough that a trackpad
      // flick lands single detents instead of spraying events.
      while (Math.abs(knobWheelAcc.current) >= 24) {
        const step = knobWheelAcc.current > 0 ? 1 : -1;
        knobWheelAcc.current -= step * 24;
        turnKnob(step);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [turnKnob]);

  const zoomPct = Math.round(zoom * 100);
  const zoomPreset: ZoomPresetId | "" = fitMode
    ? "fit"
    : Number.isInteger(zoom) && zoom >= 1 && zoom <= 4
      ? (String(zoom) as ZoomPresetId)
      : "";

  // The % readout is a live zoom field (Figma-style): focus selects, typing a
  // number commits on Enter/blur, Escape reverts — so it is a control, not a
  // duplicate of the selected chip.
  // Escape must revert, but the blur it triggers still sees the stale draft —
  // the ref flag lets the revert win over the immediately-following commit.
  const zoomEscapedRef = useRef(false);
  const commitZoomDraft = useCallback(() => {
    if (zoomEscapedRef.current) {
      zoomEscapedRef.current = false;
      setZoomDraft(null);
      return;
    }
    if (zoomDraft === null) return;
    const n = Number.parseFloat(zoomDraft.replace("%", "").trim());
    setZoomDraft(null);
    if (Number.isFinite(n) && n > 0) {
      setFitMode(false);
      setZoom(clampNum(n / 100, ZOOM_MIN, ZOOM_MAX));
    }
  }, [zoomDraft]);

  // The dot grid lives in canvas-space: it translates with the pan and scales
  // with the zoom (halving/doubling in octaves, clamped to an 8–32px visual
  // pitch so 4× never paints giant dots) — a canvas, not a wallpaper.
  const gridPitch = useMemo(() => {
    let p = 16 * zoom;
    while (p > 32) p /= 2;
    while (p < 8) p *= 2;
    return p;
  }, [zoom]);

  const device = (
    <div className="wd-frame" ref={frameRef}>
      {/* Figma-style frame name: the widget's display name, live from the
          Display name field. */}
      <div className="wd-frame-label" title={state.displayName || undefined}>
        {state.displayName || "Untitled widget"}
      </div>
      <div className="wd-bezel" style={{ "--wd-dz": zoom } as React.CSSProperties}>
        <div
          className="wd-aperture"
          style={{ width: 100 * zoom, height: 310 * zoom }}
          aria-label={`100x310 device viewport at ${zoomPct}%`}
          role="img"
        >
          <iframe
            ref={iframeRef}
            title="widget preview"
            srcDoc={srcdoc}
            sandbox="allow-scripts"
            className="block border-0"
            style={{ width: 100, height: 310, transform: `scale(${zoom})`, transformOrigin: "top left" }}
          />
          {/* Empty-render hint: OVER the glass, never inside the iframe. A
              scene with zero boxes paints a bare background, and a black void
              under a green HUD reads as success — this quiet overlay (plus
              the neutral HUD pill and the diagnostics warning) says what is
              actually happening and where the way out is. */}
          {empty && viewMode === "design" && (
            <div className="wd-aperture-empty" aria-hidden="true">
              <span className="wd-aperture-empty-title">Nothing rendered</span>
              <span className="wd-aperture-empty-hint">Check DOM targets</span>
            </div>
          )}
          {/* Device frame: the oracle raster, layered OVER the (still laid-out)
              iframe. Renders nothing when not in Device mode, so the iframe —
              which the assemble/capture geometry pass measures — stays painted
              underneath and is never display:none'd. */}
          <DeviceFrameView
            state={state}
            actions={actions}
            visible={deviceMode}
            zoom={zoom}
          />
        </div>
        {/* Chin deck: engraved mark · rotary knob · status LED — the F1's
            hardware silhouette, laid out (not overflowed) in a real-height
            grid row. The knob is a live control; the mark and LED stay
            decorative. */}
        <div className="wd-bezel-foot">
          <span className="wd-bezel-mark" aria-hidden="true">F1</span>
          <Tooltip
            label={
              <span>
                Fn knob — click or scroll to turn
                <span className="wd-tooltip-note">
                  Dispatches input.fn-bottom-knob into the simulator
                </span>
              </span>
            }
          >
            <button
              type="button"
              ref={knobRef}
              className="wd-knob"
              style={{ "--wd-knob-turn": `${knobTurn * 30}deg` } as React.CSSProperties}
              aria-label="Fn bottom knob — click for one detent clockwise, Shift-click for counter-clockwise, scroll or arrow keys to turn"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => turnKnob(e.shiftKey ? -1 : 1)}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
                  e.preventDefault();
                  turnKnob(-1);
                } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
                  e.preventDefault();
                  turnKnob(1);
                }
              }}
            />
          </Tooltip>
          <span
            className="wd-led"
            data-state={empty ? "idle" : status}
            data-flash={ledFlash || undefined}
            aria-hidden="true"
          />
        </div>
      </div>
    </div>
  );

  // The sim-status readout, shared by both stage variants. The label slot is
  // fixed-width (sized to "Running") so Idle → Ready → Running never shifts
  // the chrome around it.
  const simStatus = empty ? (
    <Tooltip label="The compiled scene has no visible DOM boxes — nothing paints. See diagnostics.">
      <span className="wd-stage-status">
        <StatusDot state="idle" />
        <span className="wd-hud-sim-label">Empty</span>
      </span>
    </Tooltip>
  ) : (
    <span className="wd-stage-status">
      <StatusDot state={SIM_DOT[status]} />
      <span className="wd-hud-sim-label">{SIM_LABEL[status]}</span>
    </span>
  );

  return (
    <div className="wd-stage" data-embedded={embedded || undefined}>
      {/* Embedded (Source tab): the status is a REAL toolbar row above the
          canvas — panel surface, hairline below — so no floating pill ever
          straddles the card border or its rounded corner. */}
      {embedded && (
        <div className="wd-stage-topbar" role="status" aria-label="Simulator state">
          {simStatus}
          <span className="wd-stage-topbar-note wd-nums" aria-hidden="true">
            Zoom 2×
          </span>
        </div>
      )}
      <div
        className="wd-stage-canvas"
        ref={canvasRef}
        data-panning={panning || undefined}
        style={
          {
            "--wd-grid-size": `${gridPitch}px`,
            "--wd-grid-x": `${pan.x}px`,
            "--wd-grid-y": `${pan.y}px`,
          } as React.CSSProperties
        }
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
        <div
          className="wd-stage-pan"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}
        >
          {device}
        </div>
      </div>

      {/* Scroll shadows: each canvas edge the frame currently overflows gains
          a soft inset gradient — the visible affordance that the device
          continues past that edge and the canvas pans. */}
      {!embedded &&
        (["top", "right", "bottom", "left"] as const).map((edge) => (
          <span
            key={edge}
            className="wd-stage-clip"
            data-edge={edge}
            data-on={clipped[edge] || undefined}
            aria-hidden="true"
          />
        ))}

      {/* View toggle (full stage only): Design (the HTML/CSS iframe) vs Device
          (the oracle raster). Top-center, in the same 40px frosted-toolbar
          grammar as every other cluster. In Device mode a "pixel-exact" chip
          shows the container sha — the same bytes CompilerPanel's #f2up-base64
          reports, and the push uploads. */}
      {!embedded && (
        <div className="wd-stage-hud" data-corner="tc">
          <div className="wd-stage-toolbar" role="group" aria-label="Preview mode">
            <SegmentedControl<"design" | "device">
              value={viewMode}
              onValueChange={setViewMode}
              semantics="radio"
              aria-label="Preview mode"
              items={[
                { id: "design", label: "Design" },
                { id: "device", label: "Device" },
              ]}
              data-shape="pill"
            />
            {deviceMode && f2up && (
              <>
                <span className="wd-stage-toolbar-divider" aria-hidden="true" />
                <Tooltip
                  label={
                    <span>
                      Pixel-exact: the Device frame renders this container through
                      the on-device oracle.
                      <span className="wd-tooltip-note">
                        SHA-256 {f2up.sha256} — the same bytes as the push.
                      </span>
                    </span>
                  }
                >
                  <span className="wd-device-verify" role="status">
                    <Icon name="check-circle" size={13} />
                    <span className="wd-device-verify-label">Pixel-exact</span>
                    <span className="wd-device-verify-sha wd-nums" aria-hidden="true">
                      {f2up.sha256.slice(0, 8)}
                    </span>
                  </span>
                </Tooltip>
              </>
            )}
          </div>
        </div>
      )}

      {/* Left HUD (full stage only): the same elevated 40px toolbar recipe as
          the sim controls and zoom pill — one chrome grammar for every
          floating cluster, all fully inside the canvas. */}
      {!embedded && (
        <div className="wd-stage-hud" data-corner="tl">
          <div className="wd-stage-toolbar" role="status" aria-label="Simulator state">
            {simStatus}
            {/* Last-event ticker: always present so the readout has a stable
                home. Before the first event it shows an explicitly-empty "—"
                (§5) — a dead readout reads as empty, not broken. The value
                remounts per LOGGED event (not per kind), so repeated same-kind
                events — the auto-tick heartbeat — restart the 300ms flash
                every time. */}
            <span className="wd-stage-toolbar-divider" aria-hidden="true" />
            <span className="wd-stage-status">
              <span className="wd-hud-ticker-key">Last event</span>
              {state.lastEventKind === null ? (
                <span className="wd-hud-ticker-val" data-empty="true">
                  —
                </span>
              ) : (
                <span
                  className="wd-hud-ticker-val wd-nums"
                  key={state.eventLog.length}
                  title={state.lastEventKind}
                >
                  {state.lastEventKind}
                </span>
              )}
            </span>
          </div>
        </div>
      )}

      {/* Sim controls: one floating toolbar — speed chips + reset. Auto-tick
          compares/sets the store's literal "off" (never null); labels and
          the overline treatment come from the ONE AutoTickControl the Events
          tab renders too. */}
      {!embedded && (
        <div className="wd-stage-hud" data-corner="tr">
          <div className="wd-stage-toolbar" role="group" aria-label="Simulator controls">
            <AutoTickControl pill value={state.autoTick} onChange={actions.setAutoTick} />
            <span className="wd-stage-toolbar-divider" aria-hidden="true" />
            <Tooltip label="Reset state and replay the same event">
              <Button variant="ghost" size="sm" onClick={actions.resetSimulator}>
                <Icon name="rotate-ccw" size={14} />
                Reset sim
              </Button>
            </Tooltip>
          </div>
        </div>
      )}

      {/* First-run knob hint: floats at the canvas foot (near the bezel's
          knob chin), in the same frosted-toolbar chrome as every stage pill.
          One showing ever — dismissed by the first detent or a 6s timeout. */}
      {!embedded && knobHint && (
        <div className="wd-stage-hint" role="status">
          <Icon name="dial" size={14} />
          <span>Try the knob — click or scroll</span>
        </div>
      )}

      {!embedded && (
        <div className="wd-stage-zoom" role="group" aria-label="Zoom">
          <SegmentedControl<ZoomPresetId>
            value={zoomPreset as ZoomPresetId}
            onValueChange={applyPreset}
            semantics="radio"
            aria-label="Zoom level"
            items={[
              { id: "fit", label: "Fit" },
              { id: "1", label: "1×" },
              { id: "2", label: "2×" },
              { id: "3", label: "3×" },
              { id: "4", label: "4×" },
            ]}
            data-shape="pill"
          />
          {/* Same anatomy as the sim-controls pill: chip group · divider ·
              trailing item. The readout is a live zoom field, not a label. */}
          <span className="wd-stage-toolbar-divider" aria-hidden="true" />
          <input
            className="wd-zoom-readout wd-nums"
            value={zoomDraft ?? `${zoomPct}%`}
            aria-label="Zoom percentage"
            inputMode="numeric"
            spellCheck={false}
            autoComplete="off"
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setZoomDraft(e.target.value)}
            onBlur={commitZoomDraft}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                commitZoomDraft();
                e.currentTarget.blur();
              } else if (e.key === "Escape") {
                zoomEscapedRef.current = true;
                e.currentTarget.blur();
              }
            }}
          />
        </div>
      )}
    </div>
  );
}
