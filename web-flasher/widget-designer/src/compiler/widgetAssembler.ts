// ─────────────────────────────────────────────────────────────────────────────
// DSL → F2UP assembler: everything between "the author's widget source" and
// "the container the `widget.mquickjs.upload` RPC ships".
//
//   transpile (DSL → device JS + slot/table metadata)
//     → buildF2JSPackage   (source + events + target declarations)
//     → buildF2tfPackage   (facade: rects, palette, glyphs, literal/raster
//                           tables, cross-pinned to the F2JS sha, contract v3)
//     → encodeLzss         (the 62,000-byte RGB565 base frame)
//     → buildUploadContainer (one F2UP v1, generation-stamped)
//
// Rendering modes (contract v3). The DEFAULT is "raster" (variantRaster,
// formatter 12): every variant of every target is pre-rendered as REAL CSS
// pixels through the caller's VariantCaptureBridge — the base frame is
// captured with every dynamic target BLANKED (no placeholder text can survive
// into it), then each variant is set in the live preview, captured, and
// cropped to the target's rect. The device blits, so what was designed is
// what renders. "glyphs" (variantText, formatter 11) remains available via
// `renderMode` or a per-target layout override for callers that want 5×7
// glyph text; that path takes a pre-captured `baseFrame` exactly as before.
//
// v3 authoring features (docs/16 "v3 authoring expansion") are raster-only
// captures layered on the same choreography:
//   * class variants  — each variant captured with the variant class applied
//     on top of the authored className (bridge widget:setClass), then the
//     authored className restored; the class pick shares the target's one
//     value slot, lockstep with text/colour like colour is with text.
//   * animation sampling — widget.animate(#id, frames) captures each frame
//     with the element's CSS animation FROZEN at
//     `animation-delay: -(k/10)s; animation-play-state: paused` (the fixed
//     10fps tick.100ms timebase), then removes the inline overrides. An
//     element with no computed CSS animation refuses by name.
//   * hidden — the target's raster table gets one appended variant holding
//     the BLANKED-BASE pixels of its rect (cropped from the base frame that
//     was already captured; no extra bridge round-trip). So the base must be
//     truly blank there: hidden-capable targets are visibility-blanked for
//     the base via the bridge, not just text-blanked.
//   * digit composition — digits(value, N) renders as N per-digit subtargets
//     (formatter 13, one power-of-ten divisor each): the parent rect splits
//     into N equal-width cells (remainder to the last), and TEN captures of
//     "000…", "111…", …, "999…" produce all N×10 cell rasters.
//
// The assembler invents nothing it cannot know. Geometry comes in through
// `layouts` (the caller measured or authored it); pixels come in through the
// capture bridge or `baseFrame`. Anything the facade cannot express —
// colour-only targets, independently-slotted text+colour rasters, conflicting
// glyph colour tables, non-facade ids, unsupported glyphs, v3 features under
// renderMode "glyphs" — fails with a diagnostic naming the offender, never by
// silently dropping a target.
// ─────────────────────────────────────────────────────────────────────────────

import { transpileWidgetScript, type TranspiledWidget } from "./mquickjsTranspiler";
import { buildF2JSPackage } from "./f2jsPackage";
import {
  buildF2tfPackage,
  F2TF_CANVAS,
  F2TF_DIGIT_DIVISORS,
  F2TF_FORMATTER,
  F2TF_MAX_PALETTE,
  F2TF_MAX_RASTER_VARIANTS,
  F2TF_MAX_SPRITE_POSITIONS,
  F2TF_MAX_TARGETS,
  F2TF_PROPERTY,
  TARGET_FACADE_CONTRACT_V3_SHA256,
  TARGET_FACADE_CONTRACT_V4_SHA256,
  TARGET_FACADE_CONTRACT_V5_SHA256,
  type F2tfPackage,
  type F2tfTarget,
} from "./f2tfPackage";
import { glyphsFor } from "./font5x7";
import { encodeLzss } from "./lzss";
import { buildUploadContainer, F2UP_HEADER_BYTES, F2UP_MAX_BYTES } from "./uploadContainer";
import { DEVICE_PIXELS, rgbTo565 } from "./renderV2Package";
import { BASE_FRAME_BYTES, cropRgb565Frame, rgb565FrameToBytes, type DeviceRect } from "./frameCapture";
import { RENDER_V2_MQUICKJS_TARGET_WRITES } from "./constants";

export type WidgetDiagnostic = TranspiledWidget["diagnostics"][number];

/** How a target's dynamic pixels render on device. */
export type WidgetRenderMode = "raster" | "glyphs";

/**
 * The live-preview operations variantRaster capture needs. In the Designer
 * these are the snapshot.ts postMessage bridge (setPreviewText,
 * setPreviewColor, snapshotIframe); tests supply a synthetic implementation.
 * captureFrame returns the full 100×310 frame as RGB565 — the browser bridge
 * converts with the same rgbaToRgb565 every capture path uses.
 *
 * The v3 operations are optional so pre-v3 bridges keep compiling; a widget
 * that USES a v3 feature fails with the missing operation named.
 */
export interface VariantCaptureBridge {
  setText(id: string, text: string): Promise<void> | void;
  setColor(id: string, cssColor: string): Promise<void> | void;
  captureFrame(): Promise<Uint16Array> | Uint16Array;
  /** v3 class variants: apply one variant class ON TOP of the element's
   *  authored className; "" restores the authored value. */
  setClass?(id: string, variantClass: string): Promise<unknown> | unknown;
  /** v3 hidden: blank (true) / restore (false) the element's pixels via
   *  inline visibility, so the base holds what is BEHIND the element. */
  setHidden?(id: string, hidden: boolean): Promise<void> | void;
  /** v3 animation: the element's computed CSS animation-name ("none" when it
   *  has no animation) — the sampling precondition. */
  probeAnimation?(id: string): Promise<string> | string;
  /** v3 animation: freeze the animation at `delay` (inline
   *  `animation-delay: <delay>; animation-play-state: paused`); null removes
   *  both inline overrides. */
  freezeAnimation?(id: string, delay: string | null): Promise<void> | void;
}

/** Per-target facade geometry, in device pixels. Required for every target the
 *  script writes; the assembler never invents positioning. */
export interface WidgetTargetLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Override the assembly-wide render mode for this target only. */
  renderMode?: WidgetRenderMode;
  /** glyphs only: 0 left (default), 1 center, 2 right. */
  align?: 0 | 1 | 2;
  /** glyphs only: 5x7 glyph scale, 1..3. */
  scale?: 1 | 2 | 3;
  /** glyphs only: defaults to the longest variant's length. */
  maxChars?: number;
  /**
   * glyphs only: text colour for a target WITHOUT a colour slot (CSS
   * "#rgb"/"#rrggbb"; default white). Ignored for colour-slotted targets —
   * their colour comes from the palette the colour tables define. Raster
   * targets carry colour in their pixels.
   */
  color?: string;
}

export interface AssembleWidgetUploadOptions {
  /** The Designer DSL source (widget.on handlers + document writes). */
  dsl: string;
  /**
   * 62,000-byte RGB565 base frame: 100×310 row-major, little-endian.
   * glyphs-only assemblies require it. When ANY target renders as raster the
   * assembler captures its own base — with every dynamic target blanked —
   * through `capture`, and a caller-supplied base is refused: it would bake
   * the preview's placeholder text under blits that may not cover it.
   */
  baseFrame?: Uint8Array;
  /** Container generation; must be the device's running generation + 1. */
  generation: number;
  /** Facade geometry per DSL target id (digit targets: the WHOLE run's rect,
   *  measured at N '8' characters; the assembler splits the cells). */
  layouts: Record<string, WidgetTargetLayout>;
  /** Default render mode for every target; per-layout renderMode overrides. */
  renderMode?: WidgetRenderMode;
  /** Live-preview bridge; required when any target renders as raster. */
  capture?: VariantCaptureBridge;
  /** Designer-proven translated image targets. The browser has already
   * rasterized the attached image once and measured one signed canvas
   * position for every class pick state. */
  motionTargets?: Record<string, WidgetMotionTargetSource>;
}

export interface WidgetMotionTargetSource {
  width: number;
  height: number;
  colors: Uint16Array;
  alpha: Uint8Array;
  positions: { x: number; y: number }[];
  /** Linear CSS transition duration. When present, v5 interpolates positions
   * at physical display cadence and snaps a decreasing index at the loop seam. */
  tweenMs?: number;
}

export interface AssembledWidgetUpload {
  /** The complete F2UP v1 container, ready for pushWidgetUpload. */
  binary: Uint8Array;
  sha256: string;
  bytes: number;
  generation: number;
  sections: {
    f2js: { bytes: number; sha256: string };
    f2tf: { bytes: number; sha256: string };
    lzss: { bytes: number; decompressedBytes: number };
  };
  /** The mode each script target actually rendered with (v3 animation and
   *  digit targets are always "raster"). */
  renderModes: Record<string, WidgetRenderMode>;
  /** Per-target raster table costs (empty for a glyphs-only assembly). */
  rasterCosts: F2tfPackage["rasterCosts"];
  /** Transpiler warnings (a successful assembly carries no errors). */
  diagnostics: WidgetDiagnostic[];
}

/** Thrown for every assembly failure; `diagnostics` carries the full story
 *  (transpiler output plus the assembler's own errors). */
export class WidgetAssemblyError extends Error {
  readonly diagnostics: WidgetDiagnostic[];
  constructor(message: string, diagnostics: WidgetDiagnostic[]) {
    super(message);
    this.name = "WidgetAssemblyError";
    this.diagnostics = diagnostics;
  }
}

/** The facade's id grammar is stricter than the transpiler's (lowercase first
 *  character, no underscore, ≤15 chars), and "root"/"spare-*" are taken by the
 *  root-visibility target and the encoder's inert padding. */
const FACADE_ID = /^[a-z][A-Za-z0-9-]{0,14}$/;

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function parseCssColor(text: string, owner: string): number {
  const value = text.trim();
  if (!HEX_COLOR.test(value)) {
    throw new Error(
      `${owner}: colour ${JSON.stringify(text)} is not a hex CSS colour ` +
        `("#rgb" or "#rrggbb") — the facade palette cannot express it.`,
    );
  }
  const hex = value.slice(1);
  const wide = hex.length === 6 ? hex : hex.split("").map((c) => c + c).join("");
  return rgbTo565(
    parseInt(wide.slice(0, 2), 16),
    parseInt(wide.slice(2, 4), 16),
    parseInt(wide.slice(4, 6), 16),
  );
}

/** The raster feature kind of one facade record, for budget itemization.
 *  Plain text-pick targets stay unlabeled (the pre-v3 format). */
type RasterCostLabel = "class" | "motion" | "animation" | "digit" | "hidden" | "class+hidden" | "animation+hidden";

/** One line per raster target, labeled per v3 feature, for over-budget
 *  diagnostics — the same shape as f2tfPackage's describeRasterCosts with
 *  ` [label]` inserted after the id for class/animation/hidden/digit rasters. */
function describeLabeledRasterCosts(
  costs: F2tfPackage["rasterCosts"],
  labels: Map<string, RasterCostLabel>,
): string {
  return costs
    .map((cost) => {
      const label = labels.get(cost.id);
      return cost.encoding === "sprite-motion"
        ? `"#${cost.id}"${label ? ` [${label}]` : ""} one ${cost.width}×${cost.height}px ` +
          `RGB565+alpha sprite + ${cost.variants} positions = ${cost.bytes} bytes`
        : `"#${cost.id}"${label ? ` [${label}]` : ""} ${cost.variants} variant${cost.variants === 1 ? "" : "s"} × ` +
          `${cost.width}×${cost.height}px × 2 B = ${cost.bytes} bytes`;
    })
    .join("; ");
}

export async function assembleWidgetUpload(
  options: AssembleWidgetUploadOptions,
): Promise<AssembledWidgetUpload> {
  const { dsl, baseFrame, generation, layouts, capture } = options;
  const motionTargets = options.motionTargets ?? {};
  const defaultMode: WidgetRenderMode = options.renderMode ?? "raster";
  const diagnostics: WidgetDiagnostic[] = [];
  const fail = (message: string): never => {
    diagnostics.push({ severity: "error", message });
    throw new WidgetAssemblyError(message, diagnostics);
  };
  const requireBaseFrameShape = (value: Uint8Array | undefined): never | void => {
    if (!(value instanceof Uint8Array) || value.length !== BASE_FRAME_BYTES) {
      fail(
        `Base frame must be exactly ${BASE_FRAME_BYTES} bytes of RGB565 ` +
          `(100×310, row-major, 2 bytes/pixel little-endian); got ` +
          `${value instanceof Uint8Array ? `${value.length} bytes` : typeof value}.`,
      );
    }
  };

  if (!Number.isInteger(generation) || generation < 1 || generation > 0xffffffff) {
    fail(`Upload generation must be an integer 1..4294967295; got ${generation}.`);
  }
  // A caller that supplies a base frame must supply a well-formed one whatever
  // the mode; whether one is REQUIRED (glyphs) or REFUSED (raster) is decided
  // after transpilation, once the target inventory and modes are known.
  if (baseFrame !== undefined) requireBaseFrameShape(baseFrame);

  // ── 1. Transpile ────────────────────────────────────────────────────────────
  const transpiled = transpileWidgetScript(dsl);
  diagnostics.push(...transpiled.diagnostics);
  const errors = transpiled.diagnostics.filter((d) => d.severity === "error");
  if (errors.length > 0) {
    throw new WidgetAssemblyError(
      `The widget script does not transpile: ${errors[0].message}` +
        (errors.length > 1 ? ` (+${errors.length - 1} more error${errors.length > 2 ? "s" : ""})` : ""),
      diagnostics,
    );
  }
  const { deviceSource, slotMap, tables, colorTables, sharedPickIndex, events } = transpiled;
  // v3 authoring metadata (absent maps mean the widget uses no such feature).
  const classTables = transpiled.classTables ?? {};
  const animations = transpiled.animations ?? {};
  const hiddenVariant = transpiled.hiddenVariant ?? {};
  const digitTargets = transpiled.digitTargets ?? {};

  // ── 2. F2JS ─────────────────────────────────────────────────────────────────
  // className joins the write declarations only once the F2JS flag exists in
  // the authoritative constants (device admission owns that vocabulary); until
  // then a class-only target simply is not declared as an F2JS DOM target —
  // its facade record renders from the slot regardless.
  const f2jsTargets = Object.entries(slotMap).flatMap(([id, alloc]) => {
    const writes: ("textContent" | "color" | "className")[] = [];
    if (alloc.textSlot !== undefined) writes.push("textContent");
    if (alloc.colorSlot !== undefined) writes.push("color");
    if (alloc.classSlot !== undefined && "className" in RENDER_V2_MQUICKJS_TARGET_WRITES) {
      writes.push("className");
    }
    return writes.length > 0 ? [{ id, writes }] : [];
  });
  const f2js = await wrapBuild(
    () => buildF2JSPackage({ source: deviceSource, generation, events, targets: f2jsTargets }),
    "F2JS", diagnostics,
  );

  // ── 3. Facade targets ───────────────────────────────────────────────────────
  // Digit parents leave the ordinary per-target path — their pixels come from
  // the ten digit captures, not a variant table — and animation ids are pure
  // v3 targets that may not appear in slotMap at all.
  const digitIds = Object.keys(digitTargets);
  const animationIds = Object.keys(animations);
  const digitIdSet = new Set(digitIds);
  const scriptTargetIds = Object.keys(slotMap).filter((id) => !digitIdSet.has(id));
  for (const id of animationIds) {
    if (slotMap[id] !== undefined || digitIdSet.has(id)) {
      fail(
        `Target "#${id}" is declared widget.animate(...) but the script also writes it ` +
          `(textContent/style.color/className/digits). An animation flipbook binds the ` +
          `target's one value slot, so it cannot be combined with other variant picks — ` +
          `animate a dedicated element instead.`,
      );
    }
  }
  for (const id of scriptTargetIds) {
    const alloc = slotMap[id];
    if (alloc.textSlot === undefined && alloc.classSlot === undefined) {
      // variantText renders text (optionally coloured); a colour with nothing
      // to paint it on is inexpressible in the v2 contract.
      fail(
        `Target "#${id}" writes style.color but never textContent; the facade's ` +
          `variantText formatter cannot express a colour-only target. Add a ` +
          `textContent write for "#${id}".`,
      );
    }
  }
  for (const id of [...scriptTargetIds, ...animationIds, ...digitIds]) {
    if (!FACADE_ID.test(id) || id === "root" || id.startsWith("spare-")) {
      fail(
        `Target id "#${id}" is not a facade id: it must start with a lowercase ` +
          `letter, use only letters, digits and "-", be at most 15 characters, ` +
          `and not collide with the reserved "root" / "spare-*" names.`,
      );
    }
  }

  // Digit groups: normalize count + slot binding before anything counts facade
  // records. One SHARED slot means per-cell power-of-ten divisors (the device
  // extracts digit i as (value/10^(N-1-i)) % 10), so at most 4 cells; distinct
  // per-cell slots carry one digit each (divisor 1).
  interface DigitGroup {
    id: string;
    count: number;
    cellSlots: number[];
    divisors: number[];
    facadeIds: string[];
  }
  const digitGroups: DigitGroup[] = [];
  for (const id of digitIds) {
    const spec = digitTargets[id];
    const count = spec?.count;
    if (!Number.isInteger(count) || count! < 1) {
      fail(`Target "#${id}" declares digits() with a non-positive cell count (${count}); this is a transpiler bug.`);
    }
    if (hiddenVariant[id] !== undefined) {
      fail(
        `Target "#${id}" combines digits() with \`hidden\`: a digit raster table holds ` +
          `exactly the ten digits, so no background variant can be appended. Hide a ` +
          `separate element over or behind "#${id}" instead.`,
      );
    }
    if ((classTables[id] ?? []).length > 0) {
      fail(
        `Target "#${id}" combines digits() with className variants; digit cells bind ` +
          `their slot to the numeric value, leaving no slot for a class pick.`,
      );
    }
    // The transpiler emits SHARED-slot digit targets ({count, slot}): the raw
    // value on one slot, per-cell divisors on-device. The legacy per-cell
    // array shape is still accepted for any external caller.
    const specSlots = (spec as { slots?: number[] }).slots;
    const declaredSlots = Array.isArray(specSlots)
      ? specSlots
      : Number.isInteger((spec as { slot?: number }).slot)
        ? Array.from({ length: count ?? 0 }, () => (spec as { slot: number }).slot)
        : undefined;
    if (!declaredSlots || declaredSlots.length !== count ||
        !declaredSlots.every((slot) => Number.isInteger(slot) && slot >= 0 && slot <= 15)) {
      fail(
        `Target "#${id}" declares digits(value, ${count}) but the transpiler reported ` +
          `no usable value slot binding for its cells; this is a transpiler bug.`,
      );
    }
    // Per-cell slots in display order carry one digit each (divisor 1); a
    // single slot shared by every cell carries the whole value, and each cell
    // extracts its digit with a power-of-ten divisor — both encodings the
    // digitRaster contract admits.
    const shared = count! > 1 && new Set(declaredSlots).size === 1;
    if (shared && count! > F2TF_DIGIT_DIVISORS.length) {
      fail(
        `Target "#${id}" declares digits(value, ${count}): the device extracts digits ` +
          `with a power-of-ten divisor (1..${F2TF_DIGIT_DIVISORS[F2TF_DIGIT_DIVISORS.length - 1]}), ` +
          `so at most ${F2TF_DIGIT_DIVISORS.length} digit cells can share one value slot.`,
      );
    }
    const divisors = shared
      ? Array.from({ length: count! }, (_, cell) => 10 ** (count! - 1 - cell))
      : Array(count!).fill(1);
    const facadeIds = Array.from({ length: count! }, (_, cell) => `${id}-${cell}`);
    for (const facadeId of facadeIds) {
      if (!FACADE_ID.test(facadeId)) {
        fail(
          `Target "#${id}": digit cell id "${facadeId}" does not fit the facade id ` +
            `grammar (≤15 chars of [a-z][A-Za-z0-9-]*); shorten the element id.`,
        );
      }
    }
    digitGroups.push({ id, count: count!, cellSlots: declaredSlots!, divisors, facadeIds });
  }
  {
    // Facade record ids must be unique across script targets, animation
    // targets and every digit cell.
    const seen = new Set<string>();
    for (const id of [...scriptTargetIds, ...animationIds,
      ...digitGroups.flatMap((group) => group.facadeIds)]) {
      if (seen.has(id)) {
        fail(`Facade target id "#${id}" is used twice (a digit cell id collides with another target).`);
      }
      seen.add(id);
    }
  }
  const digitCellTotal = digitGroups.reduce((sum, group) => sum + group.count, 0);
  const facadeRecordCount = scriptTargetIds.length + animationIds.length + digitCellTotal;
  if (1 + facadeRecordCount > F2TF_MAX_TARGETS) {
    fail(
      `The facade renders at most ${F2TF_MAX_TARGETS - 1} script targets ` +
        `(plus the root visibility target); this widget has ${facadeRecordCount}` +
        (digitCellTotal > 0 || animationIds.length > 0
          ? ` (${scriptTargetIds.length} text/class + ${animationIds.length} animation + ` +
            `${digitCellTotal} digit cells)`
          : "") +
        `.`,
    );
  }

  // ── 4. Layouts + render modes ───────────────────────────────────────────────
  // v3 features are raster-only: pre-rendered pixels are the whole mechanism,
  // and the 5×7 glyph path can express none of them. Refuse BEFORE the layout
  // pass so a glyphs-mode assembly names the feature instead of a missing
  // layout.
  const layoutIds = [...scriptTargetIds, ...animationIds, ...digitIds];
  const modeOf = (id: string): WidgetRenderMode => layouts?.[id]?.renderMode ?? defaultMode;
  for (const id of layoutIds) {
    const features: string[] = [];
    if ((classTables[id] ?? []).length > 0) features.push("className variants");
    if (animations[id] !== undefined) features.push(`widget.animate sampling`);
    if (hiddenVariant[id] !== undefined) features.push("a hidden variant");
    if (digitTargets[id] !== undefined) features.push("digits() composition");
    if (features.length > 0 && modeOf(id) === "glyphs") {
      fail(
        `Target "#${id}" uses ${features.join(", ")}, which render as pre-rendered ` +
          `rasters only; renderMode "glyphs" cannot express ${features.length > 1 ? "them" : "it"}. ` +
          `Use renderMode "raster" for "#${id}" (the default), or remove the feature.`,
      );
    }
  }
  // Geometry is shared by both modes and validated before anything touches
  // pixels, so "you forgot a layout" always beats "you forgot the bridge".
  const rects: Record<string, DeviceRect> = {};
  for (const id of layoutIds) {
    const layout = layouts?.[id];
    if (!layout) {
      fail(
        `No layout for target "#${id}": the assembler needs {x, y, width, height} ` +
          `for every target the script writes (it never invents positioning).`,
      );
    }
    const motion = motionTargets[id];
    const { x, y, width, height } = motion
      ? { x: 0, y: 0, width: motion.width, height: motion.height }
      : layout;
    if (![x, y, width, height].every((v) => Number.isInteger(v)) || width < 1 || height < 1 ||
        x < 0 || y < 0 || x + width > F2TF_CANVAS.width || y + height > F2TF_CANVAS.height) {
      fail(
        `Layout for "#${id}" must be an integer rect inside the ` +
          `${F2TF_CANVAS.width}×${F2TF_CANVAS.height} canvas; got ` +
          `x=${x} y=${y} width=${width} height=${height}.`,
      );
    }
    rects[id] = { x, y, width, height };
  }
  const renderModes: Record<string, WidgetRenderMode> = {};
  for (const id of layoutIds) renderModes[id] = modeOf(id);

  // ── 5. Raster plans ─────────────────────────────────────────────────────────
  // A variantRaster record binds ONE value slot, so a target's pixels must be
  // a function of one slot's value:
  //   * text only                → one raster per text variant, on the text slot
  //   * constant text + colours  → one raster per colour variant, on the colour
  //     slot (the count(text)==1 special case)
  //   * texts + constant colour  → one raster per text variant, colour applied
  //   * texts + colours in PROVEN lockstep (one pick index drives both, equal
  //     counts — the transpiler's sharedPickIndex verdict) → one raster per
  //     shared index, colour k applied while capturing text k
  //   * className variants fold onto the same axis: equal count → class k
  //     captured with variant k; one class → constant; a single text/colour
  //     variant → the class pick drives the slot. (The transpiler gives class
  //     no slot of its own — it SHARES the target's value slot — so any other
  //     combination is a product space and is refused, not approximated.)
  //   * a hidden write appends ONE background-patch variant (the blanked-base
  //     crop) after the content variants.
  interface RasterVariantSpec { text?: string; color?: string; className?: string }
  interface RasterPlan {
    id: string;
    kind: "text" | "class";
    bindSlot: number;
    variants: RasterVariantSpec[];
    /** Append the blanked-base crop as variant [variants.length]. */
    hidden: boolean;
  }
  interface MotionPlan {
    id: string;
    bindSlot: number;
    source: WidgetMotionTargetSource;
  }
  /** content+hidden per-target ceiling, with the split named. */
  const requireVariantBudget = (id: string, contentCount: number, hidden: boolean): void => {
    const total = contentCount + (hidden ? 1 : 0);
    if (total > F2TF_MAX_RASTER_VARIANTS) {
      fail(
        hidden
          ? `Target "#${id}" needs ${contentCount} content variants plus its hidden ` +
            `variant = ${total} rasters; a variantRaster table holds at most ` +
            `${F2TF_MAX_RASTER_VARIANTS} (content + hidden together). Reduce the pick variants.`
          : `Target "#${id}" needs ${contentCount} raster variants; a variantRaster ` +
            `table holds at most ${F2TF_MAX_RASTER_VARIANTS}. Reduce the pick variants.`,
      );
    }
  };
  const requireHiddenIndex = (id: string, contentCount: number): void => {
    if (hiddenVariant[id] !== contentCount) {
      fail(
        `Target "#${id}": the transpiler placed the hidden variant at index ` +
          `${hiddenVariant[id]} but the target has ${contentCount} content variants; ` +
          `this is a transpiler bug.`,
      );
    }
  };
  const rasterPlans: RasterPlan[] = [];
  const motionPlans: MotionPlan[] = [];
  for (const id of scriptTargetIds) {
    if (renderModes[id] !== "raster") continue;
    const alloc = slotMap[id];
    const table = tables[id] ?? [];
    const classes = classTables[id] ?? [];
    if (table.length === 0 && classes.length === 0) {
      fail(`Target "#${id}" has a text slot but no variant table; this is a transpiler bug.`);
    }
    const motion = motionTargets[id];
    if (motion) {
      const slot = alloc.classSlot ?? alloc.textSlot;
      const colours = colorTables[id] ?? [];
      if (table.length > 0 || classes.length === 0 || colours.length > 0 ||
          hiddenVariant[id] !== undefined || slot === undefined) {
        fail(
          `Target "#${id}" was offered as compact image motion, but that encoding requires ` +
            `a className-only image target with no text, colour, or hidden writes.`,
        );
      }
      if (classes.length !== motion.positions.length || classes.length > F2TF_MAX_SPRITE_POSITIONS) {
        fail(
          `Target "#${id}" compact image motion needs one position per class variant ` +
            `(1..${F2TF_MAX_SPRITE_POSITIONS}); got ${classes.length} classes and ` +
            `${motion.positions.length} positions.`,
        );
      }
      motionPlans.push({ id, bindSlot: slot, source: motion });
      continue;
    }
    let bindSlot: number;
    let variants: RasterVariantSpec[];
    if (table.length === 0) {
      // Class-only target: the class pick owns the target's value slot.
      const slot = alloc.classSlot ?? alloc.textSlot;
      if (slot === undefined) {
        fail(`Target "#${id}" has className variants but no value slot; this is a transpiler bug.`);
      }
      bindSlot = slot!;
      const colours = colorTables[id] ?? [];
      if (colours.length <= 1) {
        const constantColour = colours[0];
        variants = classes.map((className) =>
          constantColour !== undefined ? { className, color: constantColour } : { className });
      } else if (colours.length === classes.length && sharedPickIndex[id] === true) {
        variants = classes.map((className, index) => ({ className, color: colours[index] }));
      } else {
        fail(
          `Target "#${id}" drives className and style.color from independent pick ` +
            `indexes (${classes.length} classes vs ${colours.length} colours) with no ` +
            `textContent write. Drive both from the same pick index with equal variant ` +
            `counts, or fold the colour into the variant classes.`,
        );
      }
    } else if (alloc.colorSlot === undefined) {
      bindSlot = alloc.textSlot!;
      variants = table.map((text) => ({ text }));
    } else {
      const colours = colorTables[id];
      if (!colours || colours.length === 0) {
        fail(`Target "#${id}" has a colour slot but no colour table; this is a transpiler bug.`);
      }
      if (table.length === 1 && colours.length > 1) {
        bindSlot = alloc.colorSlot;
        variants = colours.map((color) => ({ text: table[0], color }));
      } else if (colours.length === 1) {
        bindSlot = alloc.textSlot!;
        variants = table.map((text) => ({ text, color: colours[0] }));
      } else if (sharedPickIndex[id] === true && table.length === colours.length) {
        bindSlot = alloc.textSlot!;
        variants = table.map((text, index) => ({ text, color: colours[index] }));
      } else {
        fail(
          `Target "#${id}" drives textContent and style.color from independent pick ` +
            `indexes (slots ${alloc.textSlot} and ${alloc.colorSlot}` +
            (table.length === colours.length
              ? ""
              : `; ${table.length} text vs ${colours.length} colour variants`) +
            `). A variantRaster table binds ONE value slot, so independent picks ` +
            `would multiply into ${table.length * colours.length} rasters. In every ` +
            `handler that writes "#${id}", drive textContent and style.color from the ` +
            `same pick index (write them back-to-back with an identical index ` +
            `expression) — or make the text a constant to rasterize per colour.`,
        );
      }
      // The count(text)==1 special case binds the colour slot; a class pick on
      // top of that must be lockstep with the COLOUR variants (equal counts),
      // which the fold below enforces uniformly.
    }
    if (classes.length > 0 && table.length > 0) {
      if (classes.length === 1) {
        variants = variants.map((variant) => ({ ...variant, className: classes[0] }));
      } else if (variants.length === 1) {
        // Constant text (and colour): the class pick drives the slot.
        bindSlot = alloc.classSlot ?? bindSlot;
        variants = classes.map((className) => ({ ...variants[0], className }));
      } else if (classes.length === variants.length && sharedPickIndex[id] === true) {
        variants = variants.map((variant, index) => ({ ...variant, className: classes[index] }));
      } else if (classes.length === variants.length) {
        fail(
          `Target "#${id}" drives className and its text/colour writes from independent ` +
            `pick indexes. A raster table binds ONE value slot, so in every handler that ` +
            `writes "#${id}", drive every property from the same pick index (write them ` +
            `back-to-back with an identical index expression).`,
        );
      } else {
        fail(
          `Target "#${id}" drives className and its text/colour writes from mismatched ` +
            `variant counts (${classes.length} classes vs ${variants.length} text/colour ` +
            `variants). className shares the target's one value slot, so the class pick ` +
            `must move in lockstep with the text/colour pick (equal counts), stay ` +
            `constant (one class), or be the only varying axis.`,
        );
      }
    }
    const hidden = hiddenVariant[id] !== undefined;
    if (hidden) {
      requireHiddenIndex(id, variants.length);
      // The device publishes the hidden state (value N) on the TEXT slot, so
      // a hidden-capable target's raster table must bind exactly that slot —
      // the constant-text-per-colour and class-driven bindings cannot carry it.
      if (bindSlot !== alloc.textSlot) {
        fail(
          `Target "#${id}" writes el.hidden, whose state rides the text slot ` +
            `(${alloc.textSlot}), but its raster variants bind slot ${bindSlot}. ` +
            `Vary the target's textContent (or make its colour/class constant) so ` +
            `the text slot drives the rasters.`,
        );
      }
    }
    requireVariantBudget(id, variants.length, hidden);
    rasterPlans.push({ id, kind: classes.length > 0 ? "class" : "text", bindSlot, variants, hidden });
  }

  // Animation plans: `frames` variants in order, one per tick.100ms step.
  interface AnimationPlan { id: string; slot: number; frames: number; hidden: boolean }
  const animationPlans: AnimationPlan[] = [];
  for (const id of animationIds) {
    const spec = animations[id];
    if (!Number.isInteger(spec.frames) || spec.frames < 2 || spec.frames > F2TF_MAX_RASTER_VARIANTS) {
      fail(
        `Target "#${id}": widget.animate frames must be an integer 2..${F2TF_MAX_RASTER_VARIANTS}; ` +
          `got ${spec.frames}.`,
      );
    }
    if (!Number.isInteger(spec.slot) || spec.slot < 0 || spec.slot > 15) {
      fail(`Target "#${id}": widget.animate has no usable value slot (${spec.slot}); this is a transpiler bug.`);
    }
    const hidden = hiddenVariant[id] !== undefined;
    if (hidden) requireHiddenIndex(id, spec.frames);
    requireVariantBudget(id, spec.frames, hidden);
    animationPlans.push({ id, slot: spec.slot, frames: spec.frames, hidden });
  }

  // Digit cell plans: split the measured parent rect into equal-width cells,
  // integer boundaries, remainder to the LAST cell.
  interface DigitCellPlan { facadeId: string; bindSlot: number; divisor: number; rect: DeviceRect }
  const digitPlans: { id: string; count: number; cells: DigitCellPlan[] }[] = [];
  for (const group of digitGroups) {
    const rect = rects[group.id];
    const cellWidth = Math.floor(rect.width / group.count);
    if (cellWidth < 1) {
      fail(
        `Target "#${group.id}": the measured rect is ${rect.width}px wide, too narrow ` +
          `to split into ${group.count} digit cells.`,
      );
    }
    const cells: DigitCellPlan[] = group.facadeIds.map((facadeId, cell) => ({
      facadeId,
      bindSlot: group.cellSlots[cell],
      divisor: group.divisors[cell],
      rect: {
        x: rect.x + cell * cellWidth,
        y: rect.y,
        width: cell === group.count - 1 ? rect.width - (group.count - 1) * cellWidth : cellWidth,
        height: rect.height,
      },
    }));
    digitPlans.push({ id: group.id, count: group.count, cells });
  }

  // ── 6. Capture (raster) ─────────────────────────────────────────────────────
  let baseFrameBytes: Uint8Array;
  const rasterTables = new Map<string, Uint16Array[]>();
  const rasterPlanById = new Map(rasterPlans.map((plan) => [plan.id, plan]));
  const motionPlanById = new Map(motionPlans.map((plan) => [plan.id, plan]));
  const capturedIds = [
    ...rasterPlans.map((plan) => plan.id),
    ...motionPlans.map((plan) => plan.id),
    ...animationPlans.map((plan) => plan.id),
    ...digitPlans.map((plan) => plan.id),
  ];
  if (capturedIds.length > 0 && !capture) {
    fail(
      `Raster rendering needs the live-preview capture bridge: pass \`capture\` ` +
        `(setText/setColor/captureFrame), or select renderMode "glyphs". ` +
        `Raster targets: ${capturedIds.map((id) => `"#${id}"`).join(", ")}.`,
    );
  }
  // The bridge also serves a widget with NO raster targets (even no targets at
  // all) when the caller provided no base: the blanked-base capture is the
  // v3-era base contract wherever a bridge exists.
  if (capture && (capturedIds.length > 0 || baseFrame === undefined)) {
    if (baseFrame !== undefined) {
      fail(
        `Raster rendering captures its own base frame with every dynamic target ` +
          `blanked; a pre-captured baseFrame would bake the preview's placeholder ` +
          `text into the device image. Remove the baseFrame option (or select ` +
          `renderMode "glyphs" to use it).`,
      );
    }
    // A widget that uses a v3 feature needs the matching bridge operation; a
    // pre-v3 bridge fails here by name instead of mid-choreography.
    const requireOp = (present: unknown, op: string, why: string): void => {
      if (typeof present !== "function") {
        fail(`The capture bridge does not implement ${op}, which ${why}. Update the bridge (see snapshot.ts).`);
      }
    };
    if (rasterPlans.some((plan) => plan.variants.some((variant) => variant.className !== undefined))) {
      requireOp(capture.setClass, "setClass()", "className-variant capture requires");
    }
    if (rasterPlans.some((plan) => plan.hidden) || animationPlans.some((plan) => plan.hidden) ||
        motionPlans.length > 0) {
      requireOp(capture.setHidden, "setHidden()", "hidden-variant base blanking requires");
    }
    if (animationPlans.length > 0) {
      requireOp(capture.probeAnimation, "probeAnimation()", "widget.animate sampling requires");
      requireOp(capture.freezeAnimation, "freezeAnimation()", "widget.animate sampling requires");
    }
    const grabFrame = async (step: string): Promise<Uint16Array> => {
      const frame = await capture!.captureFrame();
      if (!(frame instanceof Uint16Array) || frame.length !== DEVICE_PIXELS) {
        fail(
          `Variant capture returned a malformed frame ${step}: expected ` +
            `${DEVICE_PIXELS} RGB565 pixels, got ` +
            `${frame instanceof Uint16Array ? `${frame.length} pixels` : typeof frame}.`,
        );
      }
      return frame;
    };
    try {
      // Blank EVERY dynamic target before the base capture: no placeholder
      // text may survive into the base — glyph targets paint over it sparsely
      // and raster blits need not cover other targets' rects. Text-bearing
      // targets blank through setText (class-only targets keep their authored
      // static content — it is part of every variant's look); hidden-capable
      // targets ALSO blank via visibility, because their base crop SHIPS as
      // the hidden variant and must hold only what is behind the element.
      for (const id of scriptTargetIds) {
        if ((tables[id] ?? []).length > 0) await capture!.setText(id, "");
      }
      for (const plan of digitPlans) await capture!.setText(plan.id, "");
      for (const plan of rasterPlans) {
        if (plan.hidden) await capture!.setHidden!(plan.id, true);
      }
      for (const plan of motionPlans) await capture!.setHidden!(plan.id, true);
      for (const plan of animationPlans) {
        if (plan.hidden) await capture!.setHidden!(plan.id, true);
      }
      const baseFrame16 = await grabFrame("for the base");
      baseFrameBytes = rgb565FrameToBytes(baseFrame16);
      const baseCrop = (rect: DeviceRect): Uint16Array => cropRgb565Frame(baseFrame16, rect);

      for (const plan of rasterPlans) {
        const rect = rects[plan.id];
        const rasters: Uint16Array[] = [];
        let textTouched = false;
        let colourTouched = false;
        let classTouched = false;
        if (plan.hidden) await capture!.setHidden!(plan.id, false);
        for (const variant of plan.variants) {
          if (variant.text !== undefined) {
            textTouched = true;
            await capture!.setText(plan.id, variant.text);
          }
          if (variant.color !== undefined) {
            colourTouched = true;
            await capture!.setColor(plan.id, variant.color);
          }
          if (variant.className !== undefined) {
            classTouched = true;
            await capture!.setClass!(plan.id, variant.className);
          }
          rasters.push(cropRgb565Frame(await grabFrame(`for "#${plan.id}"`), rect));
        }
        // Re-blank before the next target so this target's last variant can
        // never bleed into a later capture through overlapping rects — and
        // restore the authored className exactly (widget:setClass's "").
        if (textTouched) await capture!.setText(plan.id, "");
        if (colourTouched) await capture!.setColor(plan.id, "");
        if (classTouched) await capture!.setClass!(plan.id, "");
        if (plan.hidden) {
          await capture!.setHidden!(plan.id, true);
          rasters.push(baseCrop(rect));
        }
        rasterTables.set(plan.id, rasters);
      }

      for (const plan of animationPlans) {
        const rect = rects[plan.id];
        if (plan.hidden) await capture!.setHidden!(plan.id, false);
        // Sampling an element with no CSS animation would ship `frames`
        // identical rasters — a flipbook that does not flip — so refuse with
        // the element named while the author can still fix the CSS.
        const animationName = String((await capture!.probeAnimation!(plan.id)) ?? "none");
        if (animationName === "" || animationName === "none") {
          fail(
            `Target "#${plan.id}" is declared widget.animate("#${plan.id}", ${plan.frames}) ` +
              `but its element has no CSS animation in the preview (computed ` +
              `animation-name is "none"). Give "#${plan.id}" a CSS \`animation\` whose ` +
              `keyframes the capture can sample, or remove the widget.animate call.`,
          );
        }
        const rasters: Uint16Array[] = [];
        for (let frame = 0; frame < plan.frames; frame += 1) {
          // The 10fps timebase is fixed: frame k is the animation at k/10s,
          // matching the tick.100ms step that advances the slot on device.
          await capture!.freezeAnimation!(plan.id, `-${frame / 10}s`);
          rasters.push(cropRgb565Frame(await grabFrame(`for "#${plan.id}" frame ${frame}`), rect));
        }
        await capture!.freezeAnimation!(plan.id, null);
        if (plan.hidden) {
          await capture!.setHidden!(plan.id, true);
          rasters.push(baseCrop(rect));
        }
        rasterTables.set(plan.id, rasters);
      }

      for (const plan of digitPlans) {
        // TEN captures produce every cell's ten variants: the element renders
        // digit d repeated in every position ("000", "111", …), one capture
        // per d, and each cell's rect is cropped out of that same frame.
        const perCell: Uint16Array[][] = plan.cells.map(() => []);
        for (let digit = 0; digit <= 9; digit += 1) {
          await capture!.setText(plan.id, String(digit).repeat(plan.count));
          const frame = await grabFrame(`for "#${plan.id}" digit ${digit}`);
          plan.cells.forEach((cell, index) => {
            perCell[index].push(cropRgb565Frame(frame, cell.rect));
          });
        }
        await capture!.setText(plan.id, "");
        plan.cells.forEach((cell, index) => rasterTables.set(cell.facadeId, perCell[index]));
      }
    } catch (cause) {
      if (cause instanceof WidgetAssemblyError) throw cause;
      fail(`Variant capture failed: ${(cause as Error).message}`);
    }
  } else {
    requireBaseFrameShape(baseFrame);
    baseFrameBytes = baseFrame!;
  }

  // ── 7. Palette (glyph targets only) ─────────────────────────────────────────
  // Contract v2's variantText reads a bound colour slot as a DIRECT index into
  // the shared palette (palette[clamp(slots[1])]), while the transpiled script
  // writes the variant index (mod table length). For the device to paint what
  // the Designer previews, palette[v] must therefore hold colour variant v for
  // EVERY colour-slotted glyph target at once. Merge the colour tables
  // index-wise; a disagreement cannot be expressed in one palette and must
  // fail loudly. Raster targets never enter: their pixels carry colour.
  const palette: number[] = [];
  const paletteOwner: string[] = [];
  for (const [id, colours] of Object.entries(colorTables)) {
    if (slotMap[id]?.colorSlot === undefined) continue;
    if (renderModes[id] !== "glyphs") continue;
    colours.forEach((css, index) => {
      const value = failAsDiagnostic(() => parseCssColor(css, `Target "#${id}"`), fail);
      if (palette[index] === undefined) {
        palette[index] = value;
        paletteOwner[index] = `"#${id}" variant ${index} (${css})`;
      } else if (palette[index] !== value) {
        fail(
          `Colour tables conflict at variant index ${index}: ${paletteOwner[index]} ` +
            `vs "#${id}" variant ${index} (${css}). Colour slot values index one ` +
            `shared palette on the device, so every colour-slotted target must ` +
            `agree on the colour at each index.`,
        );
      }
    });
  }
  const paletteIndexFor = (rgb565: number, owner: string): number => {
    const existing = palette.indexOf(rgb565);
    if (existing >= 0) return existing;
    if (palette.length >= F2TF_MAX_PALETTE) {
      fail(
        `Palette budget exhausted: the facade holds at most ${F2TF_MAX_PALETTE} ` +
          `colours and there is no room left for ${owner}.`,
      );
    }
    palette.push(rgb565);
    return palette.length - 1;
  };

  // ── 8. Targets ──────────────────────────────────────────────────────────────
  const targets: F2tfTarget[] = [
    {
      id: "root",
      x: 0, y: 0, width: F2TF_CANVAS.width, height: F2TF_CANVAS.height,
      format: F2TF_FORMATTER.rootVisibility,
      properties: F2TF_PROPERTY.hidden,
      slots: [15],
    },
  ];
  // Which v3 feature each facade record's rasters came from, for the budget
  // guard's itemization (plain text picks stay unlabeled, the pre-v3 format).
  const rasterLabels = new Map<string, RasterCostLabel>();
  for (const id of scriptTargetIds) {
    const alloc = slotMap[id];
    const table = tables[id];
    const layout = layouts[id];
    const { x, y, width, height } = rects[id];
    if (renderModes[id] === "raster") {
      const motion = motionPlanById.get(id);
      if (motion) {
        rasterLabels.set(id, "motion");
        targets.push({
          id,
          x: 0, y: 0, width: motion.source.width, height: motion.source.height,
          format: motion.source.tweenMs
            ? F2TF_FORMATTER.spriteTween
            : F2TF_FORMATTER.spriteMotion,
          properties: F2TF_PROPERTY.text,
          slots: [motion.bindSlot],
          sprite: {
            colors: motion.source.colors,
            alpha: motion.source.alpha,
            positions: motion.source.positions,
            tweenMs: motion.source.tweenMs,
          },
        });
        continue;
      }
      const plan = rasterPlanById.get(id)!;
      const label = plan.kind === "class"
        ? (plan.hidden ? "class+hidden" : "class")
        : plan.hidden ? "hidden" : undefined;
      if (label) rasterLabels.set(id, label);
      targets.push({
        id,
        x, y, width, height,
        format: F2TF_FORMATTER.variantRaster,
        // The record binds the value slot only; pixels carry colour.
        properties: F2TF_PROPERTY.text,
        slots: [plan.bindSlot],
        rasters: rasterTables.get(id),
      });
      continue;
    }
    if (!table || table.length === 0) {
      fail(`Target "#${id}" has a text slot but no variant table; this is a transpiler bug.`);
    }
    const hasColor = alloc.colorSlot !== undefined;
    targets.push({
      id,
      x, y, width, height,
      format: F2TF_FORMATTER.variantText,
      properties: hasColor ? F2TF_PROPERTY.text | F2TF_PROPERTY.color : F2TF_PROPERTY.text,
      slots: hasColor ? [alloc.textSlot!, alloc.colorSlot!] : [alloc.textSlot!],
      // A bound colour slot overrides palette0 on every render (initial slot
      // value 0 selects colour variant 0); an unslotted target paints with its
      // layout colour, defaulting to white.
      palette0: hasColor
        ? 0
        : paletteIndexFor(
            failAsDiagnostic(
              () => parseCssColor(layout.color ?? "#ffffff", `Layout for "#${id}"`),
              fail,
            ),
            `the text colour of "#${id}"`,
          ),
      align: layout.align ?? 0,
      scale: layout.scale ?? 1,
      maxChars: layout.maxChars ?? Math.max(...table.map((t) => t.length), 1),
      table,
    });
  }
  for (const plan of animationPlans) {
    const { x, y, width, height } = rects[plan.id];
    rasterLabels.set(plan.id, plan.hidden ? "animation+hidden" : "animation");
    targets.push({
      id: plan.id,
      x, y, width, height,
      format: F2TF_FORMATTER.variantRaster,
      properties: F2TF_PROPERTY.text,
      slots: [plan.slot],
      rasters: rasterTables.get(plan.id),
    });
  }
  for (const plan of digitPlans) {
    for (const cell of plan.cells) {
      rasterLabels.set(cell.facadeId, "digit");
      targets.push({
        id: cell.facadeId,
        x: cell.rect.x, y: cell.rect.y, width: cell.rect.width, height: cell.rect.height,
        format: F2TF_FORMATTER.digitRaster,
        properties: F2TF_PROPERTY.text,
        slots: [cell.bindSlot],
        divisor: cell.divisor,
        rasters: rasterTables.get(cell.facadeId),
      });
    }
  }
  if (palette.length === 0) palette.push(rgbTo565(255, 255, 255)); // no glyph targets at all

  // ── 9. Glyphs (glyph targets only) ──────────────────────────────────────────
  // Every byte of every LITERAL must have a glyph. The F2TF encoder stores
  // literals as UTF-8 and matches glyphs byte-wise, so non-ASCII characters can
  // never match a single glyph code — they are unsupported here even when the
  // font has the character (e.g. "°"). Raster targets are exempt: their text
  // renders through the browser as pixels, so any character CSS can draw is
  // legal there.
  const glyphText = scriptTargetIds
    .filter((id) => renderModes[id] === "glyphs")
    .map((id) => (tables[id] ?? []).join(""))
    .join("") || " ";
  const nonAscii = [...new Set([...glyphText])].filter((c) => c.charCodeAt(0) > 0x7f);
  const glyphs = failAsDiagnostic(() => glyphsFor(glyphText), (message) =>
    fail(`Unsupported characters in variant text — ${message}`),
  );
  if (nonAscii.length > 0) {
    fail(
      `Unsupported characters in variant text: ` +
        `${nonAscii.map((c) => JSON.stringify(c)).join(", ")} are not ASCII, and the ` +
        `facade's literal tables match glyphs byte-wise. Replace them with ASCII text.`,
    );
  }

  // ── 10. Base frame + F2TF + LZSS + container ────────────────────────────────
  const frame16 = new Uint16Array(BASE_FRAME_BYTES / 2);
  {
    const view = new DataView(baseFrameBytes.buffer, baseFrameBytes.byteOffset, baseFrameBytes.byteLength);
    for (let index = 0; index < frame16.length; index += 1) {
      frame16[index] = view.getUint16(index * 2, true);
    }
  }
  const f2tf = await wrapBuild(
    () =>
      buildF2tfPackage({
        generation,
        baseFrame: frame16,
        f2jsBinary: f2js.binary,
        targets,
        palette,
        glyphs,
        contractSha256: motionPlans.some((plan) => Boolean(plan.source.tweenMs))
          ? TARGET_FACADE_CONTRACT_V5_SHA256
          : motionPlans.length > 0
            ? TARGET_FACADE_CONTRACT_V4_SHA256
            : TARGET_FACADE_CONTRACT_V3_SHA256,
      }),
    "F2TF", diagnostics,
  );

  const lzss = encodeLzss(baseFrameBytes);

  // Budget guard: project the container's exact layout before building it, so
  // an over-budget widget fails with its raster costs itemized instead of a
  // bare byte count — labeled per v3 feature (class/animation/hidden/digit).
  const align4 = (value: number) => (value + 3) & ~3;
  const projectedTotal =
    align4(align4(F2UP_HEADER_BYTES + f2js.binary.length) + f2tf.binary.length) + lzss.length;
  if (projectedTotal > F2UP_MAX_BYTES) {
    fail(
      `Widget exceeds the ${F2UP_MAX_BYTES}-byte (96 KiB) upload container: ` +
        `${projectedTotal} bytes total — f2js ${f2js.binary.length} + f2tf ` +
        `${f2tf.binary.length} (of which raster tables ${f2tf.rasterBytes}) + ` +
        `compressed base ${lzss.length} + header/padding. ` +
        (f2tf.rasterCosts.length > 0
          ? `Raster costs: ${describeLabeledRasterCosts(f2tf.rasterCosts, rasterLabels)}. ` +
            `Shrink target rects or variant counts.`
          : `Simplify the widget.`),
    );
  }

  const container = await wrapBuild(
    () => buildUploadContainer({ f2js: f2js.binary, f2tf: f2tf.binary, lzss, generation }),
    "F2UP", diagnostics,
  );

  return {
    binary: container.binary,
    sha256: container.sha256,
    bytes: container.bytes,
    generation,
    sections: {
      f2js: { bytes: f2js.binary.length, sha256: f2js.sha256 },
      f2tf: { bytes: f2tf.binary.length, sha256: f2tf.sha256 },
      lzss: { bytes: lzss.length, decompressedBytes: BASE_FRAME_BYTES },
    },
    renderModes,
    rasterCosts: f2tf.rasterCosts,
    diagnostics,
  };
}

/** Run a synchronous step, converting its throw into an assembly diagnostic. */
function failAsDiagnostic<T>(step: () => T, fail: (message: string) => never): T {
  try {
    return step();
  } catch (cause) {
    return fail((cause as Error).message);
  }
}

/** Run an encoder, converting its invariant throw into a WidgetAssemblyError
 *  that names which artifact refused the widget. */
async function wrapBuild<T>(
  build: () => Promise<T>,
  artifact: string,
  diagnostics: WidgetDiagnostic[],
): Promise<T> {
  try {
    return await build();
  } catch (cause) {
    if (cause instanceof WidgetAssemblyError) throw cause;
    const message = `${artifact}: ${(cause as Error).message}`;
    diagnostics.push({ severity: "error", message });
    throw new WidgetAssemblyError(message, diagnostics);
  }
}
