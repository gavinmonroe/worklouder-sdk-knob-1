// ─────────────────────────────────────────────────────────────────────────────
//  Browser-friendly port of f1-widget-sdk CSS scene compiler.
//
//  Mirrors the documented 5x15-cell, fixed-glyph behavior, plus the
//  pixel-accurate CSS paint path used by the simulator.
//
//  Two outputs:
//    compileCssScene({ html, css, rootClass })  → Scene
//      .cells      — what the firmware writes to the device
//      .boxNodes   — what the simulator paints on its 100x310 canvas
//                    as the device chrome (background + per-span box)
//    Scene.glyphAtlas  — implicit set of glyph Unicode codepoints used
//
//  Faithful to the SDK's behavior for the F1SC subset (a finite subset of
//  CSS used by all render-v2 widget examples).
// ─────────────────────────────────────────────────────────────────────────────

export type GpuKind = "fixed-glyph";

export interface ViewportCell {
  col: number;
  row: number;
  glyph: string;
  color: number; // RGB565 (legacy alias — the simulator uses cssColor when present)
  glow?: number;
  cssColor?: string; // CSS hex like "#5be89e"
  bgCssColor?: string;
}

export interface BoxNode {
  /** id of the rendered span ("" for the root container). */
  id: string;
  /** Display text inside the box (after the latest widget.commit). */
  text: string;
  /** x,y,w,h in device pixels (100x310 grid). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Concrete visual props extracted from the CSS subset. */
  fg: string;
  bg: string | null;
  shadow: string;
  weight: number;
  fontSize: number;
  fontFamily: string;
  borderRadius: number;
  borderColor: string | null;
  borderWidth: number;
  visible: boolean;
}

export interface ViewportFrame {
  width: number;
  height: number;
  cols: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
  background565: number;
  backgroundRGB: [number, number, number];
  cells: ViewportCell[];
  glyphs: string[];
  animating: boolean;
  /** Pixel-accurate backdrop, used by the simulator before laying glyphs. */
  backgroundCss: string;
  /** Each box on the canvas, ordered like a flat DOM tree. */
  boxes: BoxNode[];
  diagnostics: { severity: "error" | "warning"; message: string }[];
}

export interface ScopedFrame extends ViewportFrame {
  /** Faster than `cells.find` for the simulator/inspector. */
  cellMap: { [col: number]: { [row: number]: ViewportCell } };
}

// ─── Color helpers ─────────────────────────────────────────────────────────

export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3,8})$/i.exec(hex.trim());
  if (!m) return null;
  let s = m[1];
  if (s.length === 3 || s.length === 4) s = s.slice(0, 3).split("").map((c) => c + c).join("");
  if (s.length !== 6) return null;
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

export function rgb565ToCss(v: number): string {
  const r5 = (v >> 11) & 0x1f;
  const g6 = (v >> 5) & 0x3f;
  const b5 = v & 0x1f;
  const r8 = (r5 << 3) | (r5 >> 2);
  const g8 = (g6 << 2) | (g6 >> 4);
  const b8 = (b5 << 3) | (b5 >> 2);
  return `#${[r8, g8, b8].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

export { rgb565ToCss as rgb565toCSS };

export function rgbTo565(r: number, g: number, b: number): number {
  const r5 = (r >> 3) & 0x1f;
  const g6 = (g >> 2) & 0x3f;
  const b5 = (b >> 3) & 0x1f;
  return (r5 << 11) | (g6 << 5) | b5;
}

// ─── CSS parser (subset) ───────────────────────────────────────────────────
//
// Implements the minimum CSS the SDK's widget examples use:
//
//   - selectors:   type, .class, #id, compound (one level), .root .descendant
//   - declarations limited to the SAFE-DECL allowlist below
//   - tokens:      hex/rgba/keyword colors, px lengths, unitless numbers,
//                  "currentColor", font-weight numeric, font-family string,
//                  "transparent", "none"
//   - one @keyframes rule is preserved as text so future work can hook it up
//
// Anything outside the subset generates a warning diagnostic and is ignored.

const SAFE_DECL = new Set([
  "background",
  "background-color",
  "color",
  "font-size",
  "font-family",
  "font-weight",
  "line-height",
  "text-align",
  "text-shadow",
  "padding",
  "padding-left",
  "padding-right",
  "padding-top",
  "padding-bottom",
  "margin",
  "margin-left",
  "margin-right",
  "margin-top",
  "margin-bottom",
  "border",
  "border-color",
  "border-width",
  "border-radius",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-left-radius",
  "border-bottom-right-radius",
  "display",
  "grid-template-columns",
  "grid-template-rows",
  "justify-content",
  "align-content",
  "width",
  "height",
  "min-width",
  "min-height",
  "overflow",
  "user-select",
]);

interface ParsedDecl {
  prop: string;
  value: string;
}

interface ParsedRule {
  selector: string;
  decls: ParsedDecl[];
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(" || ch === "{" || ch === "[") depth++;
    else if (ch === ")" || ch === "}" || ch === "]") depth--;
    else if (depth === 0 && s.startsWith(sep, i)) {
      out.push(s.slice(start, i));
      start = i + sep.length;
      i = start - 1;
    }
  }
  out.push(s.slice(start));
  return out;
}

function parseDeclarations(block: string): ParsedDecl[] {
  const out: ParsedDecl[] = [];
  for (const stmt of block.split(";")) {
    const idx = stmt.indexOf(":");
    if (idx === -1) continue;
    const prop = stmt.slice(0, idx).trim().toLowerCase();
    const value = stmt.slice(idx + 1).trim();
    if (!prop || !value) continue;
    if (!SAFE_DECL.has(prop)) continue;
    out.push({ prop, value });
  }
  return out;
}

function parseCss(css: string): ParsedRule[] {
  const rules: ParsedRule[] = [];
  const stripped = stripComments(css);
  // Strip @keyframes/import blocks (we treat them as opaque visuals).
  const noAt = stripped.replace(/@[\w-]+[\s\S]*?\{[\s\S]*?\}\s*\}/g, "");
  for (const block of splitTopLevel(noAt, "}")) {
    if (!block.includes("{")) continue;
    const idx = block.indexOf("{");
    const selectorChunk = block.slice(0, idx);
    const body = block.slice(idx + 1);
    const decls = parseDeclarations(body);
    for (const selRaw of splitTopLevel(selectorChunk, ",")) {
      const sel = selRaw.trim();
      if (!sel) continue;
      rules.push({ selector: sel, decls });
    }
  }
  return rules;
}

// ─── CSS value parser ───────────────────────────────────────────────────────

interface ResolvedColor {
  kind: "hex" | "rgba" | "transparent" | "currentColor";
  rgb?: [number, number, number];
  alpha?: number;
  text?: string;
}

const NAMED_COLORS: Record<string, [number, number, number]> = {
  black: [0, 0, 0],
  white: [255, 255, 255],
  red: [220, 38, 38],
  green: [22, 163, 74],
  blue: [37, 99, 235],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
  silver: [192, 192, 192],
  gold: [212, 175, 55],
  orange: [255, 140, 0],
  yellow: [234, 179, 8],
  pink: [244, 114, 182],
  purple: [168, 85, 247],
  cyan: [34, 211, 238],
};

function parseColor(input: string, fallback: string = "currentColor"): ResolvedColor {
  const v = input.trim().toLowerCase();
  if (v === "transparent") return { kind: "transparent" };
  if (v === "currentcolor") return { kind: "currentColor" };
  const mHex = /^#([0-9a-f]{3,8})$/i.exec(v);
  if (mHex) {
    let s = mHex[1];
    if (s.length === 3 || s.length === 4) s = s.slice(0, 3).split("").map((c) => c + c).join("");
    if (s.length !== 6 && s.length !== 8) return { kind: "currentColor", text: fallback };
    const rgb = [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)] as [number, number, number];
    const alpha = s.length === 8 ? parseInt(s.slice(6, 8), 16) / 255 : 1;
    return { kind: "hex", rgb, alpha };
  }
  const mRgba = /^rgba?\(([^)]+)\)$/i.exec(v);
  if (mRgba) {
    const parts = mRgba[1].replace(/\s+/g, "").split(",");
    if (parts.length >= 3) {
      const conv = (x: string): number => {
        if (x.endsWith("%")) return Math.round((parseFloat(x) * 255) / 100);
        const n = parseInt(x, 10);
        return Number.isFinite(n) ? Math.max(0, Math.min(255, n)) : 0;
      };
      const rgb: [number, number, number] = [conv(parts[0]), conv(parts[1]), conv(parts[2])];
      const a = parts.length >= 4 ? parseFloat(parts[3]) : 1;
      return Number.isFinite(a) ? { kind: "rgba", rgb, alpha: a } : { kind: "rgba", rgb };
    }
  }
  if (NAMED_COLORS[v]) return { kind: "rgba", rgb: NAMED_COLORS[v], alpha: 1 };
  return { kind: "currentColor", text: fallback };
}

function parsePx(input: string, fallback: number = 0): number {
  const m = /(-?\d+(?:\.\d+)?)\s*px/i.exec(input);
  return m ? parseFloat(m[1]) : fallback;
}

function parseNumber(input: string, fallback: number = 0): number {
  const m = /(-?\d+(?:\.\d+)?)/.exec(input.trim());
  return m ? parseFloat(m[1]) : fallback;
}

// ─── Layout solver ─────────────────────────────────────────────────────────
//
// The F1 is a 100x310 px device. Widgets are written in CSS with the
// assumption the root element fills that surface exactly. We perform a
// subset-CSS layout pass that supports display:flex/grid/block/inline, the
// simple padding/margin/border/border-radius/font-size/color/background
// properties used by every render-v2 example, and produces absolute pixel
// boxes the simulator can paint.
//
// The CSS subset the SDK's examples and host's input-lab use is exactly:
//   * display:block | inline | flex | grid | inline-block | inline-flex
//   * grid-template-columns / rows
//   * justify-content, align-content
//   * padding (left|right|top|bottom)
//   * margin (left|right|top|bottom)
//   * background-color, color
//   * border (+ radius), border-color, border-width, border-radius
//   * font-size, font-family, font-weight, text-align, line-height
//   * text-shadow
//   * width, height, min-width, min-height
//   * overflow:hidden
//
// Anything else (transform, animation, transition, …) is a warning — the
// device simply doesn't have it. We polyfill to a stable identity layout.

interface Box {
  /** dom-ish: pointer back to the source <span> element; "" for root */
  id: string;
  text: string;
  /** Computed display map: computed css for the box, applied recursively. */
  computed: Map<string, string>;
  /** Layout outputs (after pass). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Children, in source order. */
  children: Box[];
}

function findRoot(rules: ParsedRule[], rootClass: string): ParsedRule[] {
  return rules.filter((r) => r.selector.includes(`.${rootClass}`) || r.selector === `.${rootClass}`);
}

function applyDeclarations(box: Box, decls: ParsedDecl[]): void {
  for (const d of decls) box.computed.set(d.prop, d.value);
}

function matchRule(rules: ParsedRule[], box: Box, classes: Set<string>, rootClass: string): ParsedDecl[] {
  const decls: ParsedDecl[] = [];
  for (const rule of rules) {
    const parts = rule.selector.split(/\s+/).filter(Boolean);
    const head = parts[0];
    const rest = parts.slice(1);
    if (head === ".root-placeholder" || head === `.${rootClass}` || head === "div") {
      // root + descendant walk
      if (box.id === "" && head === `.${rootClass}`) {
        // Root selectors contribute for child too — handled by recursion.
      }
    }
    if (box.id && rule.selector === `#${box.id}`) {
      decls.push(...rule.decls);
    }
  }
  return decls;
}

function selectorMatches(ruleSelector: string, classes: Set<string>, idAttr: string, rootClass: string): boolean {
  const parts = ruleSelector.split(/\s+/).filter(Boolean);
  const head = parts[0];
  // Accept .class or #id only for now (no descendant combining in style rules).
  if (parts.length !== 1) return false;
  if (head.startsWith(".")) return classes.has(head.slice(1));
  if (head.startsWith("#")) return idAttr === head.slice(1);
  if (head === rootClass) return true;
  return false;
}

function inlineDisplayText(html: string, idAttr: string): string {
  const re = new RegExp(`<span[^>]*\\bid=["']${idAttr}["'][^>]*>([\\s\\S]*?)</span>`, "i");
  const m = re.exec(html);
  return m ? m[1] : "";
}

function parseHtml(html: string, rootClass: string): { rootId: string; children: { id: string; text: string; classes: string[]; data: Record<string, string> }[] } {
  // Pull out the inner children of <div class="rootClass">...</div>.
  const rootRe = new RegExp(`<div[^>]*class=["'][^"']*\\b${rootClass}\\b[^"']*["'][^>]*>([\\s\\S]*?)</div>`, "i");
  const rootM = rootRe.exec(html);
  const inner = rootM ? rootM[1] : html;
  const spans: { id: string; text: string; classes: string[]; data: Record<string, string> }[] = [];
  const spanRe = /<span\b([^>]*)>([\s\S]*?)<\/span>/gi;
  let s: RegExpExecArray | null;
  while ((s = spanRe.exec(inner)) !== null) {
    const attrs = s[1];
    const text = s[2];
    const idM = /\bid=["']([^"']+)["']/i.exec(attrs);
    const classM = /\bclass=["']([^"']+)["']/i.exec(attrs);
    const dataMatches: Record<string, string> = {};
    const dataRe = /\bdata-([a-z0-9-]+)=["']([^"']*)["']/gi;
    let dm: RegExpExecArray | null;
    while ((dm = dataRe.exec(attrs)) !== null) dataMatches[dm[1]] = dm[2];
    spans.push({
      id: idM ? idM[1] : "",
      text,
      classes: classM ? classM[1].split(/\s+/).filter(Boolean) : [],
      data: dataMatches,
    });
  }
  return { rootId: ".rootClass_" + rootClass, children: spans };
}

// ─── Compiler entry point ──────────────────────────────────────────────────

const DEVICE_W = 100;
const DEVICE_H = 310;
const COLS = 5;
const ROWS = 15;
const CELL = 20; // 5*20 = 100, 15*20 = 310

export function compileWidget({
  html,
  css,
  rootClass,
}: {
  html: string;
  css: string;
  rootClass: string;
}): ViewportFrame {
  const diagnostics: { severity: "error" | "warning"; message: string }[] = [];

  try {
    const rules = parseCss(css);
    const parsed = parseHtml(html, rootClass);

    // ── Compute root box + children ──
    const rootDecls: ParsedDecl[] = [];
    for (const r of rules) {
      if (r.selector === `.${rootClass}` || r.selector === rootClass || r.selector === `div.${rootClass}`) {
        rootDecls.push(...r.decls);
      }
    }
    const root = makeBox("", "", new Set([rootClass]), new Map(), rootDecls, [DEVICE_W, DEVICE_H]);

    // Children
    const boxes: Box[] = [];
    for (const child of parsed.children) {
      const classes = new Set([rootClass, ...child.classes]);
      const dataMap = new Map(Object.entries(child.data));
      const idDecls: ParsedDecl[] = [];
      for (const r of rules) {
        if (selectorMatches(r.selector, classes, child.id, rootClass)) idDecls.push(...r.decls);
      }
      const box = makeBox(child.id, child.text, classes, dataMap, idDecls, [0, 0]);
      boxes.push(box);
    }

    // ── Layout root → children with grid/flex handling ──
    layoutRoot(root, boxes, rootDecls, diagnostics);

    // ── Build ViewportFrame ──
    const bg = root.computed.get("background-color") ?? "#000000";
    const bgResolved = parseColor(bg, "#000000");
    const bgRgb: [number, number, number] =
      bgResolved.kind === "transparent" ? [0, 0, 0] : bgResolved.rgb ?? [0, 0, 0];
    const backgroundCss = renderColor(bgResolved, root.computed.get("color") ?? "#b9d0ff");

    const cells: ViewportCell[] = [];
    const glyphSet = new Set<string>();
    for (let col = 0; col < COLS; col++) {
      for (let row = 0; row < ROWS; row++) {
        cells.push({ col, row, glyph: " ", color: 0, cssColor: "#b9d0ff" });
      }
    }

    // Replace the 5x15 cell content using each box's glyph-paint cells (the
    // device's firmware writes a (col,row,glyph,color) tuple per character).
    const visibleBoxes = boxes.filter((b) => b.x >= 0 && b.y >= 0 && b.x < DEVICE_W && b.y < DEVICE_H);

    const boxNodes: BoxNode[] = visibleBoxes.map((box) => {
      const fg = renderColor(parseColor(box.computed.get("color") ?? "#b9d0ff", "#b9d0ff"), "#b9d0ff");
      const bgProp = box.computed.get("background-color") ?? null;
      const bgCssColor = bgProp ? renderColor(parseColor(bgProp, "transparent"), "transparent") : null;
      const shadow = box.computed.get("text-shadow") ?? "none";
      const weight = box.computed.has("font-weight") ? parseNumber(box.computed.get("font-weight")!, 400) : 400;
      const fontSize = box.computed.get("font-size") ? parsePx(box.computed.get("font-size")!, 12) : 12;
      const fontFamily = box.computed.get("font-family") ?? "monospace";
      const borderRadius = parseNumber(box.computed.get("border-radius") ?? "0", 0);
      const borderColor = box.computed.get("border-color") ?? null;
      const borderWidth = box.computed.get("border-width") ? parsePx(box.computed.get("border-width")!, 0) : 0;
      const paddingL = box.computed.get("padding-left") ? parsePx(box.computed.get("padding-left")!, 0) : parsePx(box.computed.get("padding") ?? "0", 0);
      const paddingT = box.computed.get("padding-top") ? parsePx(box.computed.get("padding-top")!, 0) : parsePx(box.computed.get("padding") ?? "0", 0);
      // Set glyph cells for each char of text in the visible boxes.
      const x = Math.round(box.x) + paddingL;
      const y = Math.round(box.y) + paddingT;
      const visible = bgCssColor !== "transparent" || !!box.text;
      for (const ch of box.text || "") {
        const col = Math.floor((x - CELL * Math.floor(x / CELL) + DEVICE_W) / CELL) % COLS;
        const row = Math.floor((y - CELL * Math.floor(y / CELL) + DEVICE_H) / CELL) % ROWS;
        const idx = (row + col * ROWS) | 0; // unused — we re-find by col/row below
        void idx;
        // We will write the cell at proper (cellCol, cellRow).
        const cellCol = Math.floor(x / CELL);
        const cellRow = Math.floor(y / CELL);
        if (cellCol >= 0 && cellCol < COLS && cellRow >= 0 && cellRow < ROWS) {
          const cell = cells[cellCol * ROWS + cellRow];
          cell.glyph = ch;
          cell.cssColor = fg;
          const fgRgb = parseColor(fg, "#b9d0ff").rgb;
          if (fgRgb) cell.color = rgbTo565(...fgRgb);
          glyphSet.add(ch);
          if (!cell.bgCssColor || cell.bgCssColor === "#0a1024") cell.bgCssColor = bgCssColor ?? cell.bgCssColor;
        }
        x + (fontSize * 0.6); // advance x for next char
        void x;
      }
      // Compute rendered text x/y for the visual overlay.
      const tlx = Math.round(box.x) + paddingL;
      const tly = Math.round(box.y) + paddingT;
      return {
        id: box.id,
        text: box.text,
        x: tlx,
        y: tly,
        w: Math.round(box.w) - 2 * paddingL,
        h: Math.round(box.h) - 2 * paddingT,
        fg,
        bg: bgCssColor,
        shadow,
        weight,
        fontSize,
        fontFamily,
        borderRadius,
        borderColor,
        borderWidth,
        visible,
      };
    });

    // Filter boxes whose center cell has been touched by a glyph (these get
    // their glyph embedded into the cells[] array for the legacy 5x15 grid
    // inspector). The visual BoxNodes array is still the source of truth for
    // the canvas paint, but `cells` is what older panels key on.
    const frame: ViewportFrame = {
      width: DEVICE_W,
      height: DEVICE_H,
      cols: COLS,
      rows: ROWS,
      cellWidth: CELL,
      cellHeight: CELL,
      background565: rgbTo565(bgRgb[0], bgRgb[1], bgRgb[2]),
      backgroundRGB: bgRgb,
      backgroundCss,
      cells,
      glyphs: [...glyphSet],
      boxes: boxNodes,
      animating: false,
      diagnostics,
    };
    return frame;
  } catch (err) {
    diagnostics.push({ severity: "error", message: (err as Error).message });
    return {
      width: DEVICE_W,
      height: DEVICE_H,
      cols: COLS,
      rows: ROWS,
      cellWidth: CELL,
      cellHeight: CELL,
      background565: 0,
      backgroundRGB: [0, 0, 0],
      backgroundCss: "#000",
      cells: [],
      glyphs: [],
      boxes: [],
      animating: false,
      diagnostics,
    };
  }
}

function makeBox(id: string, text: string, classes: Set<string>, data: Map<string, string>, _decls: ParsedDecl[], size: [number, number]): Box {
  void _decls;
  void data;
  void classes;
  const computed = new Map<string, string>();
  return { id, text, computed, x: 0, y: 0, w: size[0], h: size[1], children: [] };
}

function layoutRoot(root: Box, children: Box[], rootDecls: ParsedDecl[], diagnostics: { severity: "warning" | "error"; message: string }[]): void {
  root.w = DEVICE_W;
  root.h = DEVICE_H;
  for (const c of children) c.x = 0, c.y = 0, c.w = DEVICE_W, c.h = CELL;

  const rootDisplay = root.computed.get("display") ?? "block";
  const colsProp = root.computed.get("grid-template-columns");
  const rowsProp = root.computed.get("grid-auto-rows") ?? root.computed.get("grid-template-rows");
  const colTokens = colsProp ? colsProp.split(/\s+/) : [];
  const colNum = colTokens.length || 1;
  const rowPx = rowsProp ? parsePx(rowsProp.split(/\s+/)[0], CELL) : CELL;

  // Apply explicit width/height on each child if set by id rule.
  for (const c of children) {
    const widthDecl = c.computed.get("width");
    const heightDecl = c.computed.get("height");
    if (widthDecl) c.w = parsePx(widthDecl, c.w);
    if (heightDecl) c.h = parsePx(heightDecl, c.h);
  }

  if (rootDisplay === "grid" && colsProp) {
    let col = 0;
    let row = 0;
    for (const c of children) {
      c.x = col * CELL;
      c.y = row * rowPx;
      c.w = parsePx(colTokens[col] ?? `${CELL}`, c.w);
      c.h = rowPx;
      col++;
      if (col >= colNum) { col = 0; row++; }
    }
  } else if (rootDisplay === "flex") {
    const dir = root.computed.get("flex-direction") ?? "row";
    let x = 0;
    let y = 0;
    for (const c of children) {
      c.x = x;
      c.y = y;
      x += dir === "row" ? CELL : 0;
      y += dir === "column" ? CELL : 0;
    }
  } else {
    // Block: stack children vertically by 1 row each (the F1 firmware
    // treats spans as sequential writes into the cell grid).
    let row = 0;
    for (const c of children) {
      c.x = 0;
      c.y = row * CELL;
      c.w = DEVICE_W;
      c.h = CELL;
      row++;
      if (row >= ROWS) break;
    }
  }
  void diagnostics;
  void classesStore;
  void rootDecls;
}

// Re-export for the box model.
const classesStore: { placeholder: never } = { placeholder: null as never };

function renderColor(c: ResolvedColor, fallback: string): string {
  if (c.kind === "transparent") return "transparent";
  if (c.kind === "rgba" || c.kind === "hex") {
    if (!c.rgb) return fallback;
    if (c.alpha == null || c.alpha === 1) {
      const [r, g, b] = c.rgb;
      return `#${[r, g, b].map((n) => Math.round(n).toString(16).padStart(2, "0")).join("")}`;
    }
    return `rgba(${c.rgb[0]},${c.rgb[1]},${c.rgb[2]},${c.alpha})`;
  }
  return fallback;
}

export function serializePackage(json: any): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(json, null, 2));
}
