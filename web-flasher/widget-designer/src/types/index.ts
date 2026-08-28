import type { SnapshotSchema } from "../data/schemas";
import type { WidgetAssetMap } from "../compiler/widgetAssets";

// Core domain types for the Widget Designer.
// Mirrors the bounded render-v2 + mquickjs contract enforced by f1-widget-sdk.

export type GpuKind = "fixed-glyph";

/** Editable source panes. */
export type SourceLanguage = "html" | "css" | "js";

export interface DesignerWidget {
  /** Stable id used by the compiler / SDK. Display name shown in toolbars. */
  name: string;
  /** CSS selector used by the firmware to mount the widget in the device UI. */
  rootClass: string;
  /** Widget HTML (the inner children of the root element). */
  html: string;
  /** Widget CSS. Restricted to the F1SC subset. */
  css: string;
  /** Widget JS source. Will be parsed for `var name = N;` + `widget.on(…)`. */
  script: string;
  /** Original compressed images used by asset:// references in HTML/CSS. */
  assets?: WidgetAssetMap;
  /** Whether the firmware's first paint should start from a non-default background. */
  hasRasterBase?: boolean;
  /**
   * Host-data schemas this widget declares, keyed by the name its script passes
   * to widget.snapshot(name, ...). Owned by the WIDGET, not a global registry —
   * that is what lets any custom widget define and serve its own data.
   */
  hostData?: Record<string, SnapshotSchema>;
  /** Declared integer state slots, surfaced in the inspector. */
  states?: DesignerWidgetState[];
  /** Declared event handlers, surfaced in the inspector. */
  handlers?: DesignerEventHandler[];
  /** Declared DOM write targets, surfaced in the inspector. */
  targets?: DesignerMquickjsTarget[];
  /** How the device renders this widget. "raster" = real HTML+CSS bitmap
   *  (the browser renders it pixel-perfect); "glyph" = fixed-glyph grid. */
  renderMode?: "raster" | "glyph";
}

export interface DesignerWidgetState {
  name: string;
  initial: number;
}

export interface DesignerEventHandler {
  id: string;
  /** Event selector, e.g. "input.fn-bottom-knob" or "host.rpc:0xB241". */
  selector: string;
  /** Human-readable summary of what the handler does. */
  body: string;
  /**
   * SDK-side id. Optional because it duplicates `selector` — the inspector
   * renders the selector the store infers from the script, not this field.
   */
  kind?: string;
}

export type DesignerMquickjsTarget = { id: string; writes: ("textContent" | "color" | "hidden" | "className" | "animation")[] };

export interface DesignerInferred {
  states: { name: string; initial: number }[];
  handlers: DesignerEventHandler[];
  targets: DesignerMquickjsTarget[];
}

export interface ViewportCell {
  col: number;
  row: number;
  glyph: string;
  color: number; // RGB565
  glow: number;
  bg?: number;
  fg?: number;
}

export interface ViewportFrame {
  cols: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
  backgroundRGB: [number, number, number];
  cells: ViewportCell[];
  glyphs: string[];
  animating: boolean;
}

// ── Event simulation ────────────────────────────────────────────────────────
export type TickKind = "tick.100ms" | "tick.1s";
export type KnobKind = "input.fn-bottom-knob";
export type RpcKind = "host.rpc";
export type KeyKind = "input.key.down" | "input.key.up" | "input.key.hold";
export type ChordKind = "input.chord.down" | "input.chord.up";

export type SimulatedEvent =
  | { kind: TickKind; displayName?: string; description?: string }
  | { kind: KnobKind; delta: number; displayName?: string; description?: string }
  | { kind: RpcKind; id: number; value: number; auxiliary?: number; displayName?: string; description?: string }
  | { kind: KeyKind; id: number; displayName?: string; description?: string }
  | { kind: ChordKind; mask: number; displayName?: string; description?: string };

// ── Compile diagnostics & artifacts ────────────────────────────────────────
export type CompileSeverity = "info" | "warning" | "error";
export type CompileSource = "html" | "css" | "script" | "compilation" | "package";

export interface CompileDiagnostic {
  severity: CompileSeverity;
  message: string;
  source: CompileSource;
}

export interface F2JSPackage {
  /** Raw F2JS binary. */
  binary: Uint8Array;
  /** Full-package SHA-256 (hex). */
  sha256: string;
  /** Package generation (uint32). */
  generation: number;
  /** Total byte count. */
  bytes: number;
  /** Source-section SHA-256 (hex). */
  sourceSha256: string;
  /** Body-section SHA-256 (hex). */
  bodySha256: string;
  /** Normalized event records. */
  events: { records: { kind: number; id: number; nativeToken: number; heldMask: number }[]; keyCount: number; chordCount: number };
  /** Normalized target records. */
  targets: { index: number; id: string; flags: number }[];
  /** Budget snapshot. */
  budget: { packageBytes: number; sourceBytes: number; events: number; targets: number };
}

export interface DesignerRunState {
  busRevision: number;
  isBusy: boolean;
  fps: number;
}
