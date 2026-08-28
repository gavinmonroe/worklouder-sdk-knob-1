// Designer store. React 19 + plain hooks, no zustand needed.
//
// The store holds:
//   * the widget source (HTML/CSS/JS + meta + scripts' states/handlers/targets
//     inferred from the script for the inspector)
//   * the live viewport (cell grid from the F1SC compile)
//   * the simulator + auto-tick interval
//   * the most-recent F2JS package + event log
//
// The store does NOT bundle any preset state — a preset simply replaces
// the three source strings and triggers a recompile.

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type {
  CompileDiagnostic,
  DesignerEventHandler,
  DesignerMquickjsTarget,
  DesignerWidget,
  F2JSPackage,
  SimulatedEvent,
} from "../types";
import { PRESETS } from "../presets/widgets";
import { compileWidget, type ViewportFrame } from "../compiler/cssScene";
import { createMquickjsSimulator } from "../compiler/mquickjsSimulator";
import { parseWidgetScript } from "../compiler/scriptParser";
import { buildF2JSPackage, downloadPackage as downloadF2JSBytes } from "../compiler/f2jsPackage";
import {
  downloadWidgetFile,
  parseWidgetFile,
  serializeWidgetFile,
  widgetFileName,
} from "./widgetFile";
import { buildRenderV2RasterPackage, type RenderV2Package } from "../compiler/renderV2Package";
import type { F2epBuildResult } from "../compiler/f2epPackage";
import type { SnapshotSchema } from "../data/schemas";
import { rasterizeFrame } from "../compiler/rasterize";
import {
  captureFrames,
  dispatchToPreview,
  freezePreviewAnimation,
  measurePreviewGlyphs,
  measurePreviewRect,
  probePreviewAnimation,
  resetPreview,
  setPreviewClass,
  setPreviewColor,
  setPreviewHidden,
  setPreviewText,
  snapshotIframe,
  waitForPreview,
} from "../compiler/snapshot";
import { alignRectToDevicePixels, rgb565FrameToBytes } from "../compiler/frameCapture";
import { transpileWidgetScript } from "../compiler/mquickjsTranspiler";
import {
  assembleWidgetUpload as buildWidgetUpload,
  WidgetAssemblyError,
  type AssembledWidgetUpload,
  type WidgetRenderMode,
  type WidgetTargetLayout,
} from "../compiler/widgetAssembler";
import { F2TF_CANVAS } from "../compiler/f2tfPackage";
import { isPendingEditorDirty, matchesAnyPreset, saveSourceDraft } from "./sourceDraft";
import {
  importWidgetImageAsset,
  referencedWidgetAssetIds,
  type WidgetAssetMap,
} from "../compiler/widgetAssets";

const DEMO_PRESET: DesignerWidget = PRESETS.counter;

/** What `buildEventDrivenPackage` returns: a pushable package plus its program facts. */
export type EventDrivenPackage = RenderV2Package & {
  programBytes: number;
  bindings: F2epBuildResult["bindings"];
};

export type AutoTick = "off" | "1s" | "100ms";

export interface DesignerState {
  // Source
  displayName: string;
  rootClass: string;
  html: string;
  css: string;
  js: string;
  assets: WidgetAssetMap;
  // Inferred
  states: { slot: number; name: string; init: number }[];
  handlers: { kind: string; detail?: string }[];
  targets: { id: string; method: string }[];
  diagnostics: { items: CompileDiagnostic[]; errors: number; warnings: number };
  // Simulator
  lastFrame: ViewportFrame | null;
  lastEventKind: string | null;
  eventLog: { label: string; at: Date }[];
  simState: "idle" | "ready" | "running";
  autoTick: AutoTick;
  slots: number[];
  /**
   * The device program's OWN committed mailbox slots — the 16 int32 values the
   * transpiled `deviceSource` publishes (slot 0 = publication revision). Unlike
   * `slots` (the raw-DSL inspector sim, dead for scripts outside the DSL
   * subset), these come from running the exact program the assembler lowered,
   * so the Device-frame oracle renders what the hardware would compute. All
   * zeros until an event commits — the honest unpublished-at-boot state.
   */
  deviceSlots: number[];
  /** Publication revision of `deviceSlots` (device VM's slot 0 / commit count). */
  deviceRevision: number;
  /** True when `deviceSource` transpiled and loaded a runnable device sim. */
  deviceSimReady: boolean;
  // Package
  f2js: F2JSPackage | null;
  /** The widget's own host-data schemas, keyed by widget.snapshot() name. */
  hostData: Record<string, SnapshotSchema>;
  /** Standalone-F1WB render-v2 package, the format the generic firmware admits. */
  renderV2: RenderV2Package | null;
  /**
   * Program facts for `renderV2` when it was built event-driven, null when it
   * holds captured frames. The two packages push identically but behave nothing
   * alike on device, so the UI must be able to tell them apart.
   */
  eventProgram: { programBytes: number; bindings: number } | null;
}

export interface DesignerActions {
  setMeta: (next: Partial<Pick<DesignerState, "displayName" | "rootClass">>) => void;
  setHtml: (v: string) => void;
  setCss: (v: string) => void;
  setJs: (v: string) => void;
  /** Attach portable image files for asset:// references in HTML/CSS. */
  addAssets: (files: File[]) => Promise<void>;
  removeAsset: (id: string) => void;
  /** Replace the widget's host-data schemas. */
  setHostData: (next: Record<string, SnapshotSchema>) => void;
  recompile: (next: {
    html?: string;
    css?: string;
    js?: string;
    name?: string;
    rootClass?: string;
    assets?: WidgetAssetMap;
  }) => void;
  loadPreset: (id: keyof typeof PRESETS) => void;
  dispatch: (event: SimulatedEvent) => void;
  /** Register the preview iframe. Events and captures reach it via postMessage. */
  registerPreview: (iframe: HTMLIFrameElement | null) => void;
  setAutoTick: (rate: AutoTick) => void;
  resetSimulator: () => void;
  compileF2JS: () => Promise<void>;
  downloadF2JS: () => Promise<void>;
  /** Download the current widget as a shareable .f1widget.json source file. */
  shareWidget: () => void;
  /** Load a shared .f1widget.json file into the editor (throws with a
   *  human-readable message on anything malformed — callers toast it). */
  openWidget: (file: File) => Promise<void>;
  /** Rasterize the current frame into a pushable render-v2 package. */
  compileRenderV2: (options?: { frameCount?: number }) => Promise<RenderV2Package | null>;
  /** Compile the widget into an F1WB bundle plus an F2EP event program. */
  compileEventDriven: () => Promise<EventDrivenPackage | null>;
  /**
   * Assemble the widget into an F2UP container for the mquickjs uploader
   * (gated in the UI on the device advertising `uploader=1`). Throws with the
   * failure already surfaced in the diagnostics panel. renderMode defaults to
   * "raster" (design-true pre-rendered variants); "glyphs" keeps the 5×7
   * variantText path.
   */
  assembleWidgetUpload: (options: {
    generation: number;
    renderMode?: WidgetRenderMode;
  }) => Promise<AssembledWidgetUpload>;
  playSampleLoop: () => void;
}

export function useDesignerStore(): { state: DesignerState; actions: DesignerActions } {
  const [widget, setWidget] = useState<DesignerWidget>(DEMO_PRESET);
  const widgetRef = useRef(widget);
  widgetRef.current = widget;

  const [autoTick, setAutoTickState] = useState<AutoTick>("off");
  const [lastFrame, setLastFrame] = useState<ViewportFrame | null>(null);
  const [lastEventKind, setLastEventKind] = useState<string | null>(null);
  const [eventLog, setEventLog] = useState<{ label: string; at: Date }[]>([]);
  const [slots, setSlots] = useState<number[]>(Array(16).fill(0));
  // Device-frame mailbox: the transpiled program's committed slots, driven in
  // lockstep with the preview so the oracle raster tracks what the user does.
  const [deviceSlots, setDeviceSlots] = useState<number[]>(Array(16).fill(0));
  const [deviceRevision, setDeviceRevision] = useState<number>(0);
  const [deviceSimReady, setDeviceSimReady] = useState<boolean>(false);
  const [simState, setSimState] = useState<"idle" | "ready" | "running">("idle");
  const [inferred, setInferred] = useState<{
    states: { slot: number; name: string; init: number }[];
    handlers: { kind: string; detail?: string }[];
    targets: { id: string; method: string }[];
  }>({ states: [], handlers: [], targets: [] });
  const [diagnostics, setDiagnostics] = useState<CompileDiagnostic[]>([]);
  const [f2js, setF2JS] = useState<F2JSPackage | null>(null);
  const [renderV2, setRenderV2] = useState<RenderV2Package | null>(null);
  const [eventProgram, setEventProgram] = useState<DesignerState["eventProgram"]>(null);

  const simulatorRef = useRef<ReturnType<typeof createMquickjsSimulator> | null>(null);
  // The device VM the Device-frame view renders: built from the SAME
  // transpiled deviceSource the assembler lowers, so preview and device sims
  // consume the identical event objects and cannot diverge.
  const deviceSimRef = useRef<ReturnType<typeof createMquickjsSimulator> | null>(null);
  const deviceSlotRef = useRef<number[]>(Array(16).fill(0));
  const tickHandleRef = useRef<number | null>(null);
  const slotRef = useRef<number[]>(Array(16).fill(0));
  const previewIframeRef = useRef<HTMLIFrameElement | null>(null);

  // Recompute viewport + simulator whenever source changes.
  const recompute = useCallback((w: DesignerWidget) => {
    // 1. CSS compile
    let frame: ViewportFrame;
    try {
      frame = compileWidget({ html: w.html, css: w.css, rootClass: w.rootClass });
    } catch (err) {
      frame = {
        width: 100, height: 310, cols: 5, rows: 15,
        cellWidth: 20, cellHeight: 20,
        background565: 0, backgroundRGB: [5, 10, 23],
        backgroundCss: "#050a17",
        cells: [], glyphs: [], boxes: [], animating: false,
        diagnostics: [{ severity: "error", message: (err as Error).message }],
      };
    }
    setLastFrame(frame);

    const diags: CompileDiagnostic[] = frame.diagnostics.map((d) => ({
      severity: d.severity as "error" | "warning",
      message: d.message,
      source: "css",
    }));

    // Asset URLs are part of source correctness. Unknown asset:// references
    // would otherwise turn into a broken image only during SVG capture, while
    // remote images taint the readable canvas. Name both at edit time.
    const assets = w.assets ?? {};
    for (const id of referencedWidgetAssetIds(w.html, w.css)) {
      if (!assets[id]) {
        diags.push({
          severity: "error",
          source: w.html.includes(`asset://${id}`) ? "html" : "css",
          message: `Image asset "${id}" is not attached. Add it in Assets, then keep the asset://${id} reference.`,
        });
      }
    }
    const imgSources = [...w.html.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/giu)]
      .map((match) => match[1]);
    const externalImg = imgSources.find((source) => !/^(?:asset:\/\/|data:image\/)/iu.test(source));
    if (externalImg || /<img\b[^>]*\bsrcset\s*=/iu.test(w.html)) {
      diags.push({
        severity: "error",
        source: "html",
        message: "External or responsive <img> sources cannot be captured safely. Attach each image and use one asset:// URL in src instead.",
      });
    }
    const cssUrls = [...w.css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/giu)].map((match) => match[1].trim());
    const externalCssImage = cssUrls.find((source) => !/^(?:asset:\/\/|data:image\/|#)/iu.test(source));
    if (externalCssImage) {
      diags.push({
        severity: "error",
        source: "css",
        message: "External CSS image URLs cannot be captured safely. Attach the image and use url(\"asset://…\") instead.",
      });
    }

    // 2. Script + simulator
    try {
      const sim = createMquickjsSimulator(w.script);
      simulatorRef.current = sim;
      const parsed = sim.parsed;
      const detectedStates = parsed.states.map((s, i) => ({ slot: i, name: s.name, init: s.initial }));
      const detectedHandlers: { kind: string; detail?: string }[] = parsed.handlers.map((h) => ({
        kind: h.selector,
        detail: undefined,
      }));
      // Targets
      const targetIds = new Set<string>();
      const allQueries = (w.script.match(/querySelector\s*\(\s*"([^"]+)"/g) || []).join("\n");
      for (const m of allQueries.matchAll(/#([a-zA-Z][\w-]*)/g)) targetIds.add(m[1]);
      const idRegex = /^[a-z][\w-]{0,31}$/i;
      const detectedTargets: { id: string; method: string }[] = [];
      targetIds.forEach((id) => {
        if (idRegex.test(id) && id.length <= 16) detectedTargets.push({ id, method: "textContent" });
      });
      // Method inference
      detectedTargets.forEach((t) => {
        if (new RegExp(`#${t.id}[\\s\\S]{0,80}\\.color`).test(w.script)) t.method = "textContent · color";
        else if (new RegExp(`#${t.id}[\\s\\S]{0,80}\\.hidden`).test(w.script)) t.method = "textContent · hidden";
      });

      const initialSlots = Array(16).fill(0);
      detectedStates.forEach((s) => { initialSlots[s.slot] = s.init; });
      slotRef.current = initialSlots.slice();
      setSlots(initialSlots.slice());

      parsed.handlers.forEach((h, i) => {
        diags.push({ severity: "info", message: `Handler #${i + 1}: ${h.selector}`, source: "script" });
      });

      setInferred({ states: detectedStates, handlers: detectedHandlers, targets: detectedTargets });
      setSimState((prev) => (prev === "running" ? "running" : "ready"));
    } catch (err) {
      simulatorRef.current = null;
      slotRef.current = Array(16).fill(0);
      setSlots(Array(16).fill(0));
      setInferred({ states: [], handlers: [], targets: [] });
      setSimState("idle");
      diags.push({ severity: "error", source: "script", message: (err as Error).message });
    }

    // 3. Device sim (isolated from the preview path above). Transpile the DSL to
    // the canonical deviceSource and load it into its own mquickjs VM — the SAME
    // program the assembler lowers. A transpile/load failure simply leaves the
    // Device frame without a sim (deviceSimReady=false); it never disturbs the
    // preview or its diagnostics, which the block above already reported.
    deviceSlotRef.current = Array(16).fill(0);
    setDeviceSlots(Array(16).fill(0));
    setDeviceRevision(0);
    try {
      const transpiled = transpileWidgetScript(w.script);
      const hasError = transpiled.diagnostics.some((d) => d.severity === "error");
      if (hasError) {
        deviceSimRef.current = null;
        setDeviceSimReady(false);
      } else {
        deviceSimRef.current = createMquickjsSimulator(transpiled.deviceSource);
        setDeviceSimReady(true);
      }
    } catch {
      deviceSimRef.current = null;
      setDeviceSimReady(false);
    }

    setDiagnostics(diags);
  }, []);

  // Recompile whenever widget source changes.
  useEffect(() => {
    recompute(widget);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widget.html, widget.css, widget.script, widget.assets]);

  // ── Draft persistence (additive UI state) ────────────────────────────────
  // Every edit debounce-writes the committed source to localStorage; App
  // restores the draft at boot, so a reload never loses the buffer. The boot
  // preset-load itself lands here too — which is exactly right: reloading
  // returns you to whichever widget you were on, edited or not.
  const draftTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (draftTimerRef.current != null) window.clearTimeout(draftTimerRef.current);
    draftTimerRef.current = window.setTimeout(() => {
      draftTimerRef.current = null;
      const w = widgetRef.current;
      saveSourceDraft({
        displayName: w.name,
        rootClass: w.rootClass,
        html: w.html,
        css: w.css,
        js: w.script,
        assets: w.assets,
      });
    }, 400);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widget.html, widget.css, widget.script, widget.name, widget.rootClass, widget.assets]);

  // Unload guard: flush the pending draft write, then warn only when leaving
  // would actually lose work — the draft could not be persisted and the
  // buffer matches no shipped preset, or the Source view still holds
  // uncommitted Apply-mode edits (which no draft covers).
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (draftTimerRef.current != null) {
        window.clearTimeout(draftTimerRef.current);
        draftTimerRef.current = null;
      }
      const w = widgetRef.current;
      const persisted = saveSourceDraft({
        displayName: w.name,
        rootClass: w.rootClass,
        html: w.html,
        css: w.css,
        js: w.script,
        assets: w.assets,
      });
      const committedAtRisk =
        !persisted && !matchesAnyPreset({ html: w.html, css: w.css, js: w.script });
      if (committedAtRisk || isPendingEditorDirty()) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const setSource = useCallback((patch: Partial<DesignerWidget>) => {
    setWidget((prev) => ({ ...prev, ...patch }));
  }, []);

  const setMeta = useCallback<DesignerActions["setMeta"]>((next) => {
    setWidget((prev) => ({ ...prev, ...next }));
  }, []);

  const setHtml = useCallback<DesignerActions["setHtml"]>((v) => setSource({ html: v }), [setSource]);
  const setCss = useCallback<DesignerActions["setCss"]>((v) => setSource({ css: v }), [setSource]);
  const setJs = useCallback<DesignerActions["setJs"]>((v) => setSource({ script: v }), [setSource]);

  const addAssets = useCallback<DesignerActions["addAssets"]>(async (files) => {
    if (files.length === 0) return;
    const next: WidgetAssetMap = { ...(widgetRef.current.assets ?? {}) };
    for (const file of files) {
      const asset = await importWidgetImageAsset(file, next);
      next[asset.id] = asset;
    }
    setWidget((prev) => ({ ...prev, assets: next }));
  }, []);

  const removeAsset = useCallback<DesignerActions["removeAsset"]>((id) => {
    setWidget((prev) => {
      if (!prev.assets?.[id]) return prev;
      const next = { ...prev.assets };
      delete next[id];
      return { ...prev, assets: next };
    });
  }, []);

  const recompile = useCallback<DesignerActions["recompile"]>((next) => {
    setWidget((prev) => ({
      ...prev,
      html: next.html ?? prev.html,
      css: next.css ?? prev.css,
      script: next.js ?? prev.script,
      name: next.name ?? prev.name,
      rootClass: next.rootClass ?? prev.rootClass,
      assets: next.assets ?? prev.assets,
    }));
    // Always reset simulator state — a recompile invalidates the simulator.
    slotRef.current = Array(16).fill(0);
    setSlots(Array(16).fill(0));
    deviceSlotRef.current = Array(16).fill(0);
    setDeviceSlots(Array(16).fill(0));
    setDeviceRevision(0);
    setLastEventKind(null);
  }, []);

  const loadPreset = useCallback<DesignerActions["loadPreset"]>((id) => {
    setWidget({ ...PRESETS[id], assets: {} });
  }, []);

  const logEvent = useCallback((label: string) => {
    setEventLog((prev) => {
      const next = [...prev, { label, at: new Date() }];
      return next.length > 100 ? next.slice(next.length - 100) : next;
    });
  }, []);

  const dispatchEvent = useCallback<DesignerActions["dispatch"]>((event) => {
    // Drive the real preview DOM through the postMessage bridge. bindWidgetRuntime
    // cannot work here — the iframe is an opaque origin — so runtimeDispatchRef is
    // always null and every injected event used to land only in the bare simulator,
    // updating slots while the preview sat unchanged.
    const previewFrame = previewIframeRef.current;
    if (previewFrame) {
      dispatchToPreview(previewFrame, event as unknown as Record<string, unknown>).catch((cause) => {
        logEvent(`${event.kind} (preview: ${(cause as Error).message})`);
      });
    }

    // Drive the device VM too, from the same event object — its committed slots
    // feed the Device-frame oracle. Isolated: a device-sim throw must not stop
    // the preview sim below (they run the same program, but the device frame is
    // additive and can never regress the design preview).
    const deviceSim = deviceSimRef.current;
    if (deviceSim) {
      try {
        const dr = deviceSim.dispatch(event as any);
        deviceSlotRef.current = dr.slots.slice();
        setDeviceSlots(dr.slots.slice());
        setDeviceRevision(dr.publicationRevision);
      } catch {
        /* device-frame only; leave the last good device slots in place */
      }
    }

    const sim = simulatorRef.current;
    if (!sim) return;
    try {
      const result = sim.dispatch(event as any);
      slotRef.current = result.slots.slice();
      setSlots(result.slots.slice());
      setLastEventKind(event.kind);
      setSimState("ready");
      // Rebuild the frame after slots change.
      const w = widgetRef.current;
      try {
        const frame = compileWidget({ html: w.html, css: w.css, rootClass: w.rootClass });
        setLastFrame(frame);
      } catch { /* leave previous frame */ }
    } catch (err) {
      setSimState("idle");
      logEvent(`${event.kind} (error: ${(err as Error).message})`);
      return;
    }
    logEvent(prettyEvent(event));
  }, [logEvent]);

  const setHostData = useCallback<DesignerActions["setHostData"]>((next) => {
    setWidget((prev) => ({ ...prev, hostData: next }));
  }, []);

  const registerPreview = useCallback<DesignerActions["registerPreview"]>((iframe) => {
    previewIframeRef.current = iframe;
  }, []);

  const resetSimulator = useCallback<DesignerActions["resetSimulator"]>(() => {
    // Reset the preview too. Resetting only the simulator left the on-screen
    // widget holding its old state, so "Reset sim" appeared to do nothing.
    const previewFrame = previewIframeRef.current;
    if (previewFrame) {
      resetPreview(previewFrame, widgetRef.current.rootClass).catch((cause) => {
        logEvent(`reset (preview: ${(cause as Error).message})`);
      });
    }
    // Reset the device VM too, so the Device frame returns to its boot state
    // (all-zero mailbox, revision 0) alongside the preview.
    if (deviceSimRef.current) {
      deviceSimRef.current.reset();
      deviceSlotRef.current = Array(16).fill(0);
      setDeviceSlots(Array(16).fill(0));
      setDeviceRevision(0);
    }
    const sim = simulatorRef.current;
    if (!sim) return;
    sim.reset();
    const w = widgetRef.current;
    const initial = Array(16).fill(0);
    inferred.states.forEach((s) => { initial[s.slot] = s.init; });
    slotRef.current = initial.slice();
    setSlots(initial);
    try {
      const frame = compileWidget({ html: w.html, css: w.css, rootClass: w.rootClass });
      setLastFrame(frame);
    } catch { /* ignore */ }
    setLastEventKind(null);
    logEvent("reset");
  }, [inferred, logEvent]);

  // Auto-tick interval.
  useEffect(() => {
    if (tickHandleRef.current != null) {
      window.clearInterval(tickHandleRef.current);
      tickHandleRef.current = null;
    }
    if (autoTick === "off") {
      setSimState((s) => (s === "running" ? "ready" : s));
      return;
    }
    setSimState("running");
    const ms = autoTick === "1s" ? 1000 : 100;
    tickHandleRef.current = window.setInterval(() => {
      dispatchEvent({ kind: autoTick === "1s" ? "tick.1s" : "tick.100ms", displayName: "auto", description: "auto" });
    }, ms);
    return () => {
      if (tickHandleRef.current != null) {
        window.clearInterval(tickHandleRef.current);
        tickHandleRef.current = null;
      }
    };
  }, [autoTick, dispatchEvent]);

  const setAutoTick = useCallback<DesignerActions["setAutoTick"]>((rate) => {
    setAutoTickState(rate);
  }, []);

  const compileF2JS = useCallback<DesignerActions["compileF2JS"]>(async () => {
    if (!simulatorRef.current) return;
    const w = widgetRef.current;
    const eventsPayload: any = {};
    const hostRpcIds: number[] = [];
    for (const h of inferred.handlers) {
      if (h.kind === "tick.100ms") eventsPayload["tick.100ms"] = true;
      else if (h.kind === "tick.1s") eventsPayload["tick.1s"] = true;
      else if (h.kind === "input.fn-bottom-knob") eventsPayload["input.fn-bottom-knob"] = true;
      else if (h.kind.startsWith("host.rpc:")) {
        const id = parseInt(h.kind.slice("host.rpc:".length), 16);
        if (Number.isFinite(id) && id > 0) hostRpcIds.push(id);
      }
    }
    if (hostRpcIds.length > 0) eventsPayload.hostRpcIds = Array.from(new Set(hostRpcIds)).sort((a, b) => a - b);
    try {
      const pkg = await buildF2JSPackage({
        source: w.script,
        generation: 1,
        events: eventsPayload,
        targets: inferred.targets.map((t) => ({ id: t.id, writes: ["textContent"] })),
        rasterBase: null,
      });
      setF2JS(pkg);
    } catch (err) {
      setDiagnostics((prev) => [
        ...prev,
        { severity: "error", source: "compilation", message: `F2JS: ${(err as Error).message}` },
      ]);
    }
  }, [inferred]);

  /**
   * Rasterize the widget into a standalone-F1WB package.
   *
   * Pixels come from the live preview iframe, so what ships is what the user
   * sees — including DOM the script mutated. The box-model frame is only a
   * fallback, and a lossy one: compileWidget() never receives simulator slots
   * or runtime DOM writes, so it renders the widget's *initial* state.
   *
   * The generation baked in here is provisional: the push transport restamps
   * it to the device's committedGeneration + 1, because only the keyboard
   * knows what that is and its admission gate compares the two exactly.
   */
  const compileRenderV2 = useCallback<DesignerActions["compileRenderV2"]>(async (options) => {
    const requested = Math.max(1, Math.min(60, Math.round(options?.frameCount ?? 1)));
    const name = (widgetRef.current.name || "widget").toLowerCase().replace(/\s+/g, "-").slice(0, 16);
    const note = (message: string, severity: "error" | "warning" = "error") =>
      setDiagnostics((prev) => [...prev, { severity, source: "compilation", message }]);

    const iframe = await awaitPreviewIframe(previewIframeRef);

    let frames: Uint16Array[] | null = null;
    if (!iframe) {
      note("render-v2: the live preview never became available, so nothing could be captured. " +
        "Open the Design tab once, then build again.");
      return null;
    }
    if (iframe) {
      try {
        // A preset switch reloads the iframe, and until the new document loads
        // the OLD one still answers the bridge. Wait for the preview to be
        // showing THIS widget before capturing.
        await waitForPreview(iframe, widgetRef.current.rootClass);
        frames = await captureFrames({
          iframe,
          css: widgetRef.current.css,
          assets: widgetRef.current.assets ?? {},
          frameCount: requested,
          // Frames replay on the device at a 1s cadence, so advance the widget
          // by the matching tick — otherwise the captured motion would not
          // correspond to what the device shows.
          advance: () => dispatchToPreview(iframe, { kind: "tick.1s", name: "tick.1s" }),
        });
      } catch (err) {
        note(`render-v2: live preview capture failed (${(err as Error).message}); using the box-model approximation, which shows the widget's initial state.`, "warning");
      }
    }

    if (!frames) {
      if (!lastFrame) {
        note("render-v2: no compiled frame to rasterize yet.");
        return null;
      }
      // The box model only understands the F1SC subset. For markup it cannot
      // parse it produces no boxes at all, and rasterizes to a fully black
      // frame. Pushing that is never what anyone wants, so refuse it rather
      // than shipping a blank screen that looks like a device fault.
      if (lastFrame.boxes.length === 0) {
        note(
          "render-v2: could not capture the live preview, and this widget's markup is outside " +
            "the box-model fallback's subset — it would render as a black screen. Wait for the " +
            "preview to finish loading and build again.",
        );
        return null;
      }
      try {
        frames = [rasterizeFrame(lastFrame)];
      } catch (err) {
        note(`render-v2: ${(err as Error).message}`);
        return null;
      }
    }

    // Delta encoding makes multi-frame cheap but not free. Rather than fail a
    // capture the user already waited for, drop trailing frames until it fits.
    for (let count = frames.length; count >= 1; count -= 1) {
      try {
        const pkg = await buildRenderV2RasterPackage({
          frames: frames.slice(0, count),
          name: name || "widget",
          generation: 1,
          fps: 1,
        });
        if (count < frames.length) {
          note(`render-v2: kept ${count} of ${frames.length} frames to fit the device's 96 KiB scene store.`, "warning");
        }
        setRenderV2(pkg);
        // These frames replace whatever was built before; keeping the old
        // program facts would advertise event handling this package lacks.
        setEventProgram(null);
        return pkg;
      } catch (err) {
        if (count === 1) {
          note(`render-v2: ${(err as Error).message}`);
          return null;
        }
      }
    }
    return null;
  }, [lastFrame]);

  /**
   * Compile the widget into an event-driven package: an F1WB bundle carrying
   * one base frame, followed by the F2EP program that patches it.
   *
   * Unlike the frame path this has no fallback. The SDK compiler rejects
   * anything outside the F1SC subset with a specific reason, and frames would
   * behave nothing like the program the user asked for on device, so the reason
   * is surfaced and the build stops.
   */
  const compileEventDriven = useCallback<DesignerActions["compileEventDriven"]>(async () => {
    const note = (message: string) =>
      setDiagnostics((prev) => [
        ...prev,
        { severity: "error", source: "compilation", message },
      ]);

    const iframe = await awaitPreviewIframe(previewIframeRef);
    if (!iframe) {
      note("event-driven: the live preview never became available, so no pixels could be " +
        "captured for the program's variants. Open the Design tab once, then build again.");
      return null;
    }

    const w = widgetRef.current;
    const name = (w.name || "widget").toLowerCase().replace(/\s+/g, "-").slice(0, 16);
    try {
      // Loaded on demand: the SDK compiler this pulls in touches Node globals
      // while its modules evaluate, so it must not join the startup import
      // graph — that runs before main.tsx installs the Buffer shim.
      const { buildEventDrivenPackage } = await import("../compiler/f2epPackage");
      const pkg = await buildEventDrivenPackage({
        iframe,
        html: w.html,
        css: w.css,
        script: w.script,
        rootClass: w.rootClass,
        name: name || "widget",
        generation: 1,
        assets: w.assets ?? {},
      });
      setRenderV2(pkg);
      setEventProgram({ programBytes: pkg.programBytes, bindings: pkg.bindings.length });
      return pkg;
    } catch (err) {
      note(`event-driven: ${(err as Error).message}`);
      return null;
    }
  }, []);

  /**
   * Assemble the widget into an F2UP container (F2JS + F2TF + LZSS base) for
   * the mquickjs `widget.mquickjs.upload` path.
   *
   * Facade geometry is measured from the preview DOM rather than invented
   * (the srcdoc body is the device's 100×310 pixel grid, so client
   * coordinates ARE device coordinates), and the preview is reloaded
   * afterwards to undo every mutation.
   *
   * Raster (the default): each target's rect is the UNION of every text
   * variant's measured boxes — all rasters in a table share the record's one
   * rect — then the assembler drives the capture bridge below: it blanks
   * every dynamic target, captures the base (so no placeholder text survives
   * into it), and captures each variant as real CSS pixels, colour applied.
   *
   * Glyphs (opt-in): the base frame is the live preview EXACTLY as it stands,
   * captured before anything mutates it; each target is measured at its
   * longest variant and widened to the 5×7 facade font's footprint so no
   * variant clips on device.
   */
  const assembleWidgetUploadAction = useCallback<DesignerActions["assembleWidgetUpload"]>(
    async ({ generation, renderMode = "raster" }) => {
      const w = widgetRef.current;
      const note = (message: string, severity: "error" | "warning" = "error") =>
        setDiagnostics((prev) => [...prev, { severity, source: "compilation", message }]);

      const iframe = await awaitPreviewIframe(previewIframeRef);
      if (!iframe) {
        const message =
          "widget upload: the live preview never became available, so neither the base " +
          "frame nor the target geometry could be captured. Open the Design tab once, then push again.";
        note(message);
        throw new Error(message);
      }
      await waitForPreview(iframe, w.rootClass);

      // Transpile first: the target inventory drives the measurement pass, and
      // a script that does not transpile should fail before touching the preview.
      const transpiled = transpileWidgetScript(w.script);
      const scriptErrors = transpiled.diagnostics.filter((d) => d.severity === "error");
      if (scriptErrors.length > 0) {
        for (const diagnostic of scriptErrors) note(`widget upload: ${diagnostic.message}`);
        throw new Error(`widget upload: ${scriptErrors[0].message}`);
      }

      // Glyphs mode ships the preview EXACTLY as it stands, so its base must
      // be captured before the measurement pass mutates anything. Raster mode
      // never pre-captures: the assembler takes its own blanked base.
      const baseFrame =
        renderMode === "glyphs" ? rgb565FrameToBytes(await snapshotIframe(iframe, w.css, w.assets)) : undefined;

      const layouts: Record<string, WidgetTargetLayout> = {};
      let mutated = false;
      const classTables = transpiled.classTables ?? {};
      const animations = transpiled.animations ?? {};
      const digitTargets = transpiled.digitTargets ?? {};
      try {
        const measureGlyphBoxes = async (
          id: string,
        ): Promise<{ x: number; y: number; width: number; height: number }[]> => {
          const boxes = await measurePreviewGlyphs(iframe, id);
          if (boxes.length === 0) {
            throw new Error(
              `widget upload: could not measure "#${id}" in the preview (no rendered text boxes).`,
            );
          }
          if (boxes.every((b) => b.width <= 0 || b.height <= 0)) {
            // A hidden-without-layout preview (display:none ancestry) measures
            // every box at zero; encoding those rects ships a widget whose
            // facade paints text into nothing. Fail loudly instead.
            throw new Error(
              `widget upload: "#${id}" measured zero-sized in the preview — the preview has no ` +
              `layout. Open the Design tab once so it lays out, then push again.`,
            );
          }
          return boxes;
        };
        for (const [id, alloc] of Object.entries(transpiled.slotMap)) {
          // Colour-only targets are the assembler's to name; class-only
          // targets (classSlot without textSlot) measure through the raster
          // path below, and in glyphs mode the assembler refuses the feature.
          if (alloc.textSlot === undefined && (renderMode === "glyphs" || alloc.classSlot === undefined)) continue;
          const table = transpiled.tables[id] ?? [];
          const measure = () => measureGlyphBoxes(id);
          if (renderMode === "glyphs") {
            const longest = table.reduce((a, b) => (b.length > a.length ? b : a), table[0] ?? "");
            mutated = true;
            await setPreviewText(iframe, id, longest);
            const boxes = await measure();
            const minX = Math.floor(Math.min(...boxes.map((b) => b.x)));
            const minY = Math.floor(Math.min(...boxes.map((b) => b.y)));
            const maxX = Math.ceil(Math.max(...boxes.map((b) => b.x + b.width)));
            const maxY = Math.ceil(Math.max(...boxes.map((b) => b.y + b.height)));
            // The facade draws 5×7 glyphs on a 6px advance; widen the CSS rect to
            // that footprint so the widest variant never clips on device.
            const width = Math.min(F2TF_CANVAS.width, Math.max(maxX - minX, longest.length * 6 - 1, 1));
            const height = Math.min(F2TF_CANVAS.height, Math.max(maxY - minY, 7));
            layouts[id] = {
              x: Math.max(0, Math.min(minX, F2TF_CANVAS.width - width)),
              y: Math.max(0, Math.min(minY, F2TF_CANVAS.height - height)),
              width,
              height,
            };
          } else {
            // Raster: every variant of a table blits into ONE record rect, so
            // the rect is the union of every variant's measured boxes — a
            // proportional font's widest string is not always its longest.
            // Class variants join the same union with the class APPLIED while
            // measuring (a class can change metrics), and add the element's
            // own border box: backgrounds, borders and shadows a class paints
            // reach beyond the text run's glyph boxes.
            const classes = classTables[id] ?? [];
            let minX = Infinity;
            let minY = Infinity;
            let maxX = -Infinity;
            let maxY = -Infinity;
            const unionBox = (box: { x: number; y: number; width: number; height: number }) => {
              if (box.width <= 0 || box.height <= 0) return;
              minX = Math.min(minX, box.x);
              minY = Math.min(minY, box.y);
              maxX = Math.max(maxX, box.x + box.width);
              maxY = Math.max(maxY, box.y + box.height);
            };
            const variantCount = Math.max(table.length, classes.length, 1);
            for (let index = 0; index < variantCount; index += 1) {
              mutated = true;
              const text = table.length > 0 ? table[index % table.length] : undefined;
              if (text !== undefined) await setPreviewText(iframe, id, text);
              if (classes.length > 0) await setPreviewClass(iframe, id, classes[index % classes.length]);
              if (text !== undefined && text.length > 0) {
                for (const box of await measure()) unionBox(box);
              }
              if (classes.length > 0) unionBox(await measurePreviewRect(iframe, id));
              if (text === undefined && classes.length === 0) break; // nothing to vary
            }
            if (classes.length > 0) await setPreviewClass(iframe, id, "");
            if (!(maxX > minX) || !(maxY > minY)) {
              throw new Error(
                `widget upload: no variant of "#${id}" rendered any measurable pixels in the preview.`,
              );
            }
            layouts[id] = alignRectToDevicePixels({
              x: minX, y: minY, width: maxX - minX, height: maxY - minY,
            });
          }
        }

        if (renderMode === "raster") {
          // Animated targets: the rect must cover the element at EVERY sampled
          // frame (transforms move and scale it), so freeze each frame on the
          // fixed 10fps timebase, union the element boxes, then remove the
          // overrides. The frames themselves are captured by the assembler.
          for (const [id, spec] of Object.entries(animations)) {
            mutated = true;
            let minX = Infinity;
            let minY = Infinity;
            let maxX = -Infinity;
            let maxY = -Infinity;
            for (let frame = 0; frame < spec.frames; frame += 1) {
              await freezePreviewAnimation(iframe, id, `-${frame / 10}s`);
              const box = await measurePreviewRect(iframe, id);
              if (box.width <= 0 || box.height <= 0) continue;
              minX = Math.min(minX, box.x);
              minY = Math.min(minY, box.y);
              maxX = Math.max(maxX, box.x + box.width);
              maxY = Math.max(maxY, box.y + box.height);
            }
            await freezePreviewAnimation(iframe, id, null);
            if (!(maxX > minX) || !(maxY > minY)) {
              throw new Error(
                `widget upload: "#${id}" measured zero-sized at every animation frame — the ` +
                `preview has no layout. Open the Design tab once so it lays out, then push again.`,
              );
            }
            layouts[id] = alignRectToDevicePixels({
              x: minX, y: minY, width: maxX - minX, height: maxY - minY,
            });
          }
          // Digit targets: measure the run at its widest — N '8's — and hand
          // the WHOLE rect to the assembler, which splits the equal-width
          // cells (remainder to the last).
          for (const [id, spec] of Object.entries(digitTargets)) {
            mutated = true;
            await setPreviewText(iframe, id, "8".repeat(Math.max(1, spec.count)));
            const boxes = await measureGlyphBoxes(id);
            const minX = Math.min(...boxes.map((b) => b.x));
            const minY = Math.min(...boxes.map((b) => b.y));
            const maxX = Math.max(...boxes.map((b) => b.x + b.width));
            const maxY = Math.max(...boxes.map((b) => b.y + b.height));
            layouts[id] = alignRectToDevicePixels({
              x: minX, y: minY, width: maxX - minX, height: maxY - minY,
            });
          }
        }

        // Raster capture mutates the preview through the bridge (blank base,
        // per-variant set/capture), so the finally-reset below covers it too.
        if (renderMode === "raster") mutated = true;
        const assembled = await buildWidgetUpload({
          dsl: w.script,
          generation,
          layouts,
          renderMode,
          ...(renderMode === "glyphs"
            ? { baseFrame }
            : {
                capture: {
                  setText: (id: string, text: string) => setPreviewText(iframe, id, text),
                  setColor: (id: string, cssColor: string) => setPreviewColor(iframe, id, cssColor),
                  setClass: (id: string, variantClass: string) => setPreviewClass(iframe, id, variantClass),
                  setHidden: (id: string, hidden: boolean) => setPreviewHidden(iframe, id, hidden),
                  probeAnimation: (id: string) => probePreviewAnimation(iframe, id),
                  freezeAnimation: (id: string, delay: string | null) =>
                    freezePreviewAnimation(iframe, id, delay),
                  captureFrame: () => snapshotIframe(iframe, w.css, w.assets),
                },
              }),
        });
        for (const diagnostic of assembled.diagnostics) {
          if (diagnostic.severity === "warning") note(`widget upload: ${diagnostic.message}`, "warning");
        }
        return assembled;
      } catch (cause) {
        if (cause instanceof WidgetAssemblyError) {
          for (const diagnostic of cause.diagnostics) {
            if (diagnostic.severity === "error") note(`widget upload: ${diagnostic.message}`);
          }
        } else {
          note(`widget upload: ${(cause as Error).message}`);
        }
        throw cause;
      } finally {
        // Reloading the srcdoc is the only true undo across an opaque origin;
        // it leaves the widget state exactly as a fresh load would.
        if (mutated) await resetPreview(iframe, w.rootClass).catch(() => {});
      }
    },
    [],
  );

  const downloadF2JS = useCallback<DesignerActions["downloadF2JS"]>(async () => {
    if (!f2js) await compileF2JS();
    if (!f2js) return;
    const name = (widgetRef.current.name || "widget").toLowerCase().replace(/\s+/g, "-");
    downloadF2JSBytes(f2js.binary, `${name}.f2js`);
  }, [f2js, compileF2JS]);

  const shareWidget = useCallback<DesignerActions["shareWidget"]>(() => {
    const w = widgetRef.current;
    downloadWidgetFile(
      serializeWidgetFile({
        name: w.name,
        rootClass: w.rootClass,
        html: w.html,
        css: w.css,
        js: w.script,
        hostData: w.hostData,
        assets: w.assets,
      }),
      widgetFileName(w.name),
    );
  }, []);

  const openWidget = useCallback<DesignerActions["openWidget"]>(async (file) => {
    const parsed = parseWidgetFile(await file.text());
    // recompile() is the ONE source-replacement path: it swaps every source
    // field and resets both simulators, exactly like a preset load.
    recompile({
      html: parsed.html,
      css: parsed.css,
      js: parsed.js,
      name: parsed.name,
      rootClass: parsed.rootClass,
      assets: parsed.assets ?? {},
    });
    setHostData(parsed.hostData ?? {});
  }, [recompile, setHostData]);

  const playSampleLoop = useCallback<DesignerActions["playSampleLoop"]>(() => {
    const events: SimulatedEvent[] = [
      { kind: "tick.1s", displayName: "loop", description: "" },
      { kind: "tick.100ms", displayName: "loop", description: "" },
      { kind: "input.fn-bottom-knob", delta: 1, displayName: "loop", description: "" },
      { kind: "input.fn-bottom-knob", delta: -2, displayName: "loop", description: "" },
      { kind: "host.rpc", id: 0xB201, value: 7, displayName: "loop", description: "" },
      { kind: "host.rpc", id: 0xC001, value: 25, auxiliary: 1, displayName: "loop", description: "" },
      { kind: "tick.1s", displayName: "loop", description: "" },
    ];
    let i = 0;
    const id = window.setInterval(() => {
      const ev = events[i % events.length];
      if (ev) dispatchEvent(ev);
      i++;
      if (i >= events.length) {
        window.clearInterval(id);
      }
    }, 350);
  }, [dispatchEvent]);

  // Cleanup
  useEffect(() => () => {
    if (tickHandleRef.current != null) {
      window.clearInterval(tickHandleRef.current);
      tickHandleRef.current = null;
    }
    if (draftTimerRef.current != null) {
      window.clearTimeout(draftTimerRef.current);
      draftTimerRef.current = null;
    }
  }, []);

  const errs = diagnostics.filter((d) => d.severity === "error").length;
  const warns = diagnostics.filter((d) => d.severity === "warning").length;

  const state: DesignerState = {
    displayName: widget.name,
    rootClass: widget.rootClass,
    html: widget.html,
    css: widget.css,
    js: widget.script,
    assets: widget.assets ?? {},
    states: inferred.states,
    handlers: inferred.handlers,
    targets: inferred.targets,
    diagnostics: { items: diagnostics, errors: errs, warnings: warns },
    lastFrame,
    lastEventKind,
    eventLog,
    simState,
    autoTick,
    slots,
    deviceSlots,
    deviceRevision,
    deviceSimReady,
    f2js,
    hostData: widget.hostData ?? {},
    renderV2,
    eventProgram,
  };
  return {
    state,
    actions: {
      setMeta, setHtml, setCss, setJs, addAssets, removeAsset, setHostData, recompile, loadPreset,
      dispatch: dispatchEvent,
      registerPreview,
      setAutoTick,
      resetSimulator,
      compileF2JS,
      downloadF2JS,
    shareWidget,
    openWidget,
      compileRenderV2,
      compileEventDriven,
      assembleWidgetUpload: assembleWidgetUploadAction,
      playSampleLoop,
    },
  };
}

/**
 * Wait for the preview iframe to register itself, which can lag a click made
 * immediately after startup or a tab switch.
 *
 * Waiting is far better than building without it: every build path needs real
 * rendered pixels, and the box-model fallback ships a single static frame — a
 * black one for widgets outside the F1SC subset.
 */
async function awaitPreviewIframe(
  ref: RefObject<HTMLIFrameElement | null>,
  timeoutMs = 5000,
): Promise<HTMLIFrameElement | null> {
  // Wait for a LIVE window, not just the ref: right after a preset switch or
  // source apply the srcdoc reloads, and during that beat the old iframe is
  // detached (contentWindow === null). Capturing then fails with "the preview
  // iframe has no window" even though the Design tab is mounted.
  for (let waited = 0; waited < timeoutMs; waited += 100) {
    const iframe = ref.current;
    if (iframe && iframe.contentWindow) return iframe;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return ref.current && ref.current.contentWindow ? ref.current : null;
}

function prettyEvent(e: SimulatedEvent): string {
  if (e.kind === "tick.100ms" || e.kind === "tick.1s") return e.kind;
  if (e.kind === "input.fn-bottom-knob") return `input.fn-bottom-knob ${e.delta >= 0 ? "+" : ""}${e.delta}`;
  if (e.kind === "host.rpc") return `host.rpc id=0x${e.id.toString(16).toUpperCase()} v=${e.value}`;
  if (e.kind === "input.key.down" || e.kind === "input.key.up") return `${e.kind} id=${e.id}`;
  if (e.kind === "input.chord.down") return `input.chord.down mask=0b${e.mask.toString(2).padStart(4, "0")}`;
  return e.kind;
}
