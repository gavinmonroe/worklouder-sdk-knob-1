// ─────────────────────────────────────────────────────────────────────────────
// Designer DSL → device MicroQuickJS transpiler.
//
// The Designer authors widgets against a DOM (`document.querySelector("#id")
// .textContent = pick(...)`), but the keyboard's VM has no DOM at all: a widget
// publishes 16 int32 mailbox slots (widget.setInt/commit) and the native target
// facade renders text/colors by indexing literal tables with those slot values
// (see experiments/.../build-diag-module-weather2/assets/weather-id28-gen19.js
// for the hand-written shape this generates).
//
// This module bridges the two: every DOM write becomes a slot write, the string
// variants move out of the script into per-target tables the facade owns, and
// the returned metadata (slotMap/tables/events) is exactly what a caller needs
// to feed buildF2JSPackage and the target facade.
//
// Parsing is deliberately statement-oriented regex work, matching
// scriptParser.ts: the DSL is a documented flat subset and a real JS parser
// dependency would outweigh the grammar it parses. The scanners are still
// string- and comment-aware, so a quoted "}" or a commented-out write cannot
// derail them.
//
// ── v3 authoring expansion (the capture/assembler contract) ──────────────────
// Four additive DSL forms lower onto the same 1..14 slot pool (docs/16,
// "v3 authoring expansion"). The output fields are the contract the assembler
// side builds against:
//
//   el.className = pick(i, "a", "b", …)  → `classSlot` joins slotMap and the
//     class strings land in `classTables[id]` (≤16 variants, the raster-table
//     cap). A target combining className with textContent / style.color must
//     drive EVERY property from one pick index; the proof is the same lockstep
//     rule as sharedPickIndex, and an unprovable combination is an ERROR here
//     rather than an assembler refusal, because class variants only exist as
//     captured pixels — there is no glyph fallback to degrade to.
//     sharedPickIndex[id] now covers any target with ≥2 of textSlot/colorSlot/
//     classSlot. A verdict proves identical INDEX EXPRESSIONS (equal slot
//     values); table LENGTHS may still differ — the single-variant/constant
//     patterns stay the assembler's decision tree, exactly as for colour.
//
//   widget.animate("#id", frames)  → `animations[id] = { frames, slot }`,
//     frames 2..16 (literal). Load-time statement like widget.on. The
//     transpiler reserves an internal state var and merges
//     `__animK_id = mod(__animK_id + 1, frames); __set(slot, __animK_id);`
//     into the tick.100ms handler — creating the handler (and setting
//     events["tick.100ms"]) when the author has none, else appending AFTER the
//     author's statements. The slot publishes the frame index 0..frames-1
//     under the usual commit-once discipline. An animated id is frame-driven
//     only (no DOM writes to it), and animation slots are allocated AFTER
//     every DOM-write slot, in declaration order.
//
//   el.hidden = expr  → `hiddenVariant[id] = N` where N == tables[id].length:
//     the extra slot VALUE the assembler renders as the background patch
//     (0..N-1 stay the content variants). Allowed only on targets whose
//     content is ONE textContent write in the SAME handler, textually BEFORE
//     the hidden write; the emitted `__hide(slot, cond, N)` overwrites the
//     staged text slot with N when cond is truthy and restores the staged
//     content value otherwise. The text slot is therefore the only slot that
//     carries the hidden state — a raster binding for a hidden-capable target
//     must bind the text slot.
//
//   el.textContent = digits(value, N)  → `digitTargets[id] = { count, slot }`,
//     N literal 1..4. SHARED-SLOT mode: the RAW value publishes to ONE slot;
//     the facade's digitRaster records (formatter 13) extract each display
//     digit on-device via per-cell divisors 10^(count-1-k) — so an N-digit
//     number costs one slot, not N. Negatives floor at zero at render.
//     A digits target admits no other writes.
//
// The assembler's target universe is keys(slotMap) ∪ keys(animations) ∪
// keys(digitTargets); the three key sets are disjoint by construction. The
// `__hide`/`__digits` prelude helpers are emitted only when used, so a script
// using none of the v3 forms transpiles to byte-identical v2 output.
// ─────────────────────────────────────────────────────────────────────────────

import { RENDER_V2_MQUICKJS_SOURCE_PREFIX } from "./constants";

export interface TranspiledWidget {
  /** Canonical device source: strict prefix, prelude, state, wrapped handlers. */
  deviceSource: string;
  /** Per target id: which mailbox slot carries its text / color / class variant index. */
  slotMap: Record<string, { textSlot?: number; colorSlot?: number; classSlot?: number }>;
  /** Per target id: text variant literals in slot-value order. */
  tables: Record<string, string[]>;
  /** Per target id: CSS color literals in slot-value order. */
  colorTables: Record<string, string[]>;
  /** Per target id: className literals in slot-value order (≤16 variants). */
  classTables: Record<string, string[]>;
  /**
   * Per target id that writes TWO OR MORE of textContent / style.color /
   * className: true when the properties are PROVABLY driven by one pick index,
   * i.e. in every handler that touches the target all of its properties are
   * written, their pick-index expressions are textually identical, and only
   * DOM writes (which cannot mutate state) sit between them — so the slots
   * always carry the same value. The raster assembler needs this to render one
   * raster per shared index; anything unprovable stays false and multiplies.
   * (For className-bearing combinations an unprovable pairing is additionally
   * a transpiler ERROR — see the header.)
   */
  sharedPickIndex: Record<string, boolean>;
  /**
   * Per animated target id: the sampled frame count (2..16) and the slot that
   * publishes the current frame index each tick.100ms. Animated ids never
   * appear in slotMap/tables.
   */
  animations: Record<string, { frames: number; slot: number }>;
  /**
   * Per hidden-capable target id: the reserved variant index N (== the
   * target's text variant count). The device publishes N on the target's TEXT
   * slot while hidden; the assembler renders index N as the background patch.
   */
  hiddenVariant: Record<string, number>;
  /**
   * Per digits target id: the digit count and the N consecutive slots in
   * display order (slots[0] = most significant digit). Each slot carries a
   * digit index 0..9. Digits ids never appear in slotMap/tables.
   */
  digitTargets: Record<string, { count: number; slot: number }>;
  /** Ready for buildF2JSPackage's `events` option. */
  events: {
    "tick.100ms"?: boolean;
    "tick.1s"?: boolean;
    "input.fn-bottom-knob"?: boolean;
    hostRpcIds?: number[];
    keys?: { id: number; nativeToken: number }[];
    chords?: { id: number; heldMask: number }[];
  };
  diagnostics: { severity: "error" | "warning"; message: string }[];
}

type Diagnostic = TranspiledWidget["diagnostics"][number];

const SOURCE_PREFIX = RENDER_V2_MQUICKJS_SOURCE_PREFIX;
const SOURCE_BUDGET_BYTES = 8192;

// Slot 0 carries the publication revision and slot 15 the flags word (bit 1 =
// root hidden), so targets may only occupy 1..14.
const FIRST_TARGET_SLOT = 1;
const LAST_TARGET_SLOT = 14;

/**
 * The one hard ceiling a designer runs into while doing something completely
 * ordinary — adding one more changing value to a screen. "Slot" is not a word
 * that appears anywhere in the language they write, so the refusal leads with
 * the number they CAN count (fourteen things that change), names what spends
 * it in their own vocabulary, and says what to remove. The mailbox mechanism
 * still ships, parenthesised last, for whoever is reading the generated device
 * source — and because everything before that first " (" is what the toast
 * shows (see diagnosticsView.humanizeDiagnostic), the actionable half is
 * guaranteed to be the half that fits.
 *
 * `subject` names the thing that could not be placed, phrased to follow "so".
 */
function liveValueBudgetMessage(subject: string): string {
  return (
    `This screen already shows all ${LAST_TARGET_SLOT} live values the keyboard can hold ` +
    `at once, so ${subject} has nowhere to go. Anything that changes while the widget ` +
    `runs spends one of them — a text, a colour, a class variant, a digits() number, an ` +
    `animated element — so drop one, or drive two of them from the same value. ` +
    `(On the device those live values ride mailbox slots 1..${LAST_TARGET_SLOT}: slot 0 ` +
    `carries the publish revision and slot 15 the flags word.)`
  );
}

// Device budget: widget.on throws on the 17th registration, so refuse earlier
// with a diagnostic the Designer can show instead of a load-time crash.
const HANDLER_BUDGET = 16;

// Class variants and animation frames both materialize as raster variants, so
// both inherit the facade's per-target raster cap (F2TF_MAX_RASTER_VARIANTS).
const CLASS_VARIANT_BUDGET = 16;
const ANIMATION_MIN_FRAMES = 2;
const ANIMATION_MAX_FRAMES = 16;
const DIGITS_MIN_COUNT = 1;
const DIGITS_MAX_COUNT = 4;

// ANY-KEY input (firmware 2eeb3f0f+): the firmware forwards every physical
// key; the ENGINE admits only the tokens this package declares, so a widget
// receives exactly the keys it asked for. `widget.keys("space", "a", ...)`
// declares them (event.key is the declared index); a script with key/chord
// handlers and no declaration gets DEFAULT_KEYS — the F1's own physical
// layout — so "any key on the keyboard" works out of the box.
// The table below is deliberately a WHOLE keyboard, not a useful subset: the
// moment a real key has no name here — f5, the comma — the only way forward is
// an HID usage table, and looking one up is exactly the detour this app exists
// to remove. The numbers are HID usage codes, but nothing the author reads ever
// says so. A raw "0xNN" string still resolves for firmware bring-up; it is kept
// out of every user-facing string so nobody is ever pointed at it.
export const KEY_TOKEN_NAMES: Record<string, number> = (() => {
  const table: Record<string, number> = {
    space: 0x2c, enter: 0x28, esc: 0x29, backspace: 0x2a, tab: 0x2b,
    shift: 0xe1, ctrl: 0xe0, alt: 0xe2, gui: 0xe3, cmd: 0xe3,
    right: 0x4f, left: 0x50, down: 0x51, up: 0x52,
    capslock: 0x39, insert: 0x49, delete: 0x4c,
    home: 0x4a, end: 0x4d, pageup: 0x4b, pagedown: 0x4e,
    // Punctuation goes by name because the key-name grammar admits letters and
    // digits only: an author writes "comma", never ",".
    comma: 0x36, period: 0x37, slash: 0x38, semicolon: 0x33, quote: 0x34,
    minus: 0x2d, equals: 0x2e, lbracket: 0x2f, rbracket: 0x30,
    backslash: 0x31, grave: 0x35,
    // Catch-all: the firmware re-delivers any key the widget did NOT declare
    // under this reserved token (HID ErrorRollOver, never a real press), so
    // "any" receives every key on the keyboard — letters included — with
    // down/up/hold all behaving like a declared key.
    any: 0x01,
  };
  for (let i = 0; i < 26; i++) table[String.fromCharCode(97 + i)] = 0x04 + i;
  for (let i = 1; i <= 9; i++) table[String(i)] = 0x1e + (i - 1);
  table["0"] = 0x27;
  for (let i = 1; i <= 12; i++) table[`f${i}`] = 0x3a + (i - 1);
  // Second names for keys whose cap reads differently depending on which
  // keyboard the author is looking at. Rejecting "escape" or "return" would be
  // a pure vocabulary failure — the widget they described was never wrong.
  const alternates: Record<string, string> = {
    escape: "esc", return: "enter", del: "delete", caps: "capslock",
    pgup: "pageup", pgdn: "pagedown", control: "ctrl", option: "alt",
    win: "gui", backtick: "grave", apostrophe: "quote",
  };
  for (const [alternate, name] of Object.entries(alternates)) table[alternate] = table[name];
  return table;
})();
// No widget.keys() declaration: space and shift keep their historical ids 0
// and 1 (so the chord stays space+shift), and "any" catches EVERY other key,
// which is what makes an undeclared widget respond to the whole keyboard.
const DEFAULT_KEYS = ["space", "shift", "any"]
  .map((name, id) => ({ id, nativeToken: KEY_TOKEN_NAMES[name] }));
// The one admitted chord: the FIRST TWO declared keys held together
// (space+shift under DEFAULT_KEYS — unchanged for existing widgets).
const WIRED_CHORDS: { id: number; heldMask: number }[] = [{ id: 0, heldMask: 3 }];
const MAX_DECLARED_KEYS = 16;

// Names the prelude/wrapper machinery owns; user state shadowing them would
// silently break the transpiled program, so it is refused up front. `digits`
// is reserved even though the emitted source never defines it: the preview
// runtime implements it as an intrinsic, and a state var of that name would
// make the same script behave differently in the Designer than on-device.
const RESERVED_NAMES = new Set([
  "mod",
  "clamp",
  "pick",
  "digits",
  "widget",
  "event",
  "document",
  "__rev",
  "__wrote",
  "__set",
  "__hide",
  "__digits",
]);

// mod/clamp/pick MUST produce the same values as the preview intrinsics in
// widgetRuntime.ts, or a widget renders differently on-device than in the
// Designer — the exact bug class this pipeline exists to prevent. __set marks
// that a slot write happened so the handler wrapper knows to bump the
// publication revision (slot 0) and commit exactly once per dispatch.
const PRELUDE = `function mod(a, b) {
  a = a | 0; b = b | 0;
  if (b === 0) return 0;
  return ((a % b) + b) % b;
}
function clamp(value, minimum, maximum) {
  var v = value | 0;
  if (v < (minimum | 0)) v = minimum | 0;
  if (v > (maximum | 0)) v = maximum | 0;
  return v;
}
function pick(index) {
  var n = arguments.length - 1;
  if (n < 1) return undefined;
  var i = index | 0;
  return arguments[1 + (((i % n) + n) % n)];
}
var __rev = 0;
var __wrote = 0;
function __set(slot, value) {
  __wrote = 1;
  widget.setInt(slot, value);
}`;

// Emitted only when a script uses `el.hidden = expr`. Reads the STAGED slot
// (widget.getInt inside an active dispatch sees pending writes on both the
// device and the simulator), so a falsy cond restores whatever the content
// write staged earlier in the same handler.
const HIDE_HELPER = `function __hide(slot, cond, index) {
  __set(slot, cond ? index : widget.getInt(slot));
}`;

// digits() needs no prelude helper in shared-slot mode: the raw value goes to
// one slot with __set, and the facade's per-cell divisors (formatter 13)
// extract the display digits on-device.
const DIGITS_HELPER = "";

interface ScannedState {
  name: string;
  initial: number;
}

interface ScannedHandler {
  selector: string;
  body: string;
}

interface ScannedAnimate {
  id: string;
  frames: number;
}

interface Statement {
  /** Authored text (comments removed), for diagnostics. */
  raw: string;
  /** One line, whitespace collapsed outside strings — what the classifiers see. */
  normalized: string;
  /** normalized with string contents blanked, so token probes cannot be fooled
   *  by literals like "document" inside a variant. */
  masked: string;
}

const DOM_WRITE =
  /^document\s*\.\s*querySelector\s*\(\s*(["'])#([A-Za-z][A-Za-z0-9_-]{0,15})\1\s*\)\s*\.\s*(textContent|className|hidden|style\s*\.\s*color)\s*=\s*([\s\S]+)$/;
const PICK_CALL = /^pick\s*\(([\s\S]*)\)$/;
const DIGITS_CALL = /^digits\s*\(([\s\S]*)\)$/;
const STRING_LITERAL = /^(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')$/;
const DOCUMENT_TOKEN = /(?:^|[^\w$.])document\b/;

type PropKind = "text" | "color" | "class";

interface PropWrite {
  id: string;
  kind: PropKind;
  expr: string;
  at: number;
}

interface HandlerFacts {
  /** Ordered pick-index expressions of each lowered target-property write. */
  writes: PropWrite[];
  /** Per statement: true when the statement is a DOM write (inert — it only
   *  stages slot values, never mutates user state). */
  inert: boolean[];
}

export function transpileWidgetScript(dslSource: string): TranspiledWidget {
  const diagnostics: Diagnostic[] = [];
  const text = dslSource.startsWith(SOURCE_PREFIX)
    ? dslSource.slice(SOURCE_PREFIX.length)
    : dslSource;

  const { states, handlers, animates, keyNames } = scanTopLevel(text, diagnostics);

  for (const state of states) {
    if (RESERVED_NAMES.has(state.name) || state.name.startsWith("__anim")) {
      diagnostics.push({
        severity: "error",
        message: `State name "${state.name}" is reserved by the transpiler prelude; rename it.`,
      });
    }
  }

  // Animation declarations are validated up front so handler processing can
  // refuse DOM writes to animated ids at the offending statement.
  const animationDecls: ScannedAnimate[] = [];
  {
    const seen = new Set<string>();
    for (const declared of animates) {
      if (
        !Number.isInteger(declared.frames) ||
        declared.frames < ANIMATION_MIN_FRAMES ||
        declared.frames > ANIMATION_MAX_FRAMES
      ) {
        diagnostics.push({
          severity: "error",
          message:
            `widget.animate("#${declared.id}", ${declared.frames}): frames must be an ` +
            `integer ${ANIMATION_MIN_FRAMES}..${ANIMATION_MAX_FRAMES} (the assembler samples ` +
            `that many CSS animation frames).`,
        });
        continue;
      }
      if (seen.has(declared.id)) {
        diagnostics.push({
          severity: "error",
          message: `Duplicate widget.animate("#${declared.id}"); each target animates once.`,
        });
        continue;
      }
      seen.add(declared.id);
      animationDecls.push(declared);
    }
  }
  const animatedIds = new Set(animationDecls.map((declared) => declared.id));

  // Target slot allocation. Slots are handed out in first-encounter order so a
  // widget's slot layout is stable under re-transpilation. Animation slots are
  // allocated after every DOM-write slot (see the header).
  const slotMap: TranspiledWidget["slotMap"] = {};
  const tables: TranspiledWidget["tables"] = {};
  const colorTables: TranspiledWidget["colorTables"] = {};
  const classTables: TranspiledWidget["classTables"] = {};
  const hiddenVariant: TranspiledWidget["hiddenVariant"] = {};
  const digitTargets: TranspiledWidget["digitTargets"] = {};
  let nextSlot = FIRST_TARGET_SLOT;
  let usesHide = false;
  let usesDigits = false;

  function allocate(
    id: string,
    kind: PropKind,
    variants: string[],
    raw: string,
  ): { slot: number; tableSize: number } | null {
    const property = kind === "text" ? "textContent" : kind === "class" ? "className" : "style.color";
    const store = kind === "text" ? tables : kind === "class" ? classTables : colorTables;
    const slotKey =
      kind === "text" ? ("textSlot" as const) : kind === "class" ? ("classSlot" as const) : ("colorSlot" as const);
    const existingSlot = slotMap[id]?.[slotKey];
    if (existingSlot !== undefined) {
      const existing = store[id];
      if (!tablesEqual(existing, variants)) {
        diagnostics.push({
          severity: "error",
          message:
            `Target "#${id}" ${property} variants differ between writes; every write to the ` +
            `same target must list identical variants. Offending statement: ${raw}`,
        });
      }
      // Emit against the canonical (first-seen) table either way so the source
      // stays runnable while the author fixes the mismatch.
      return { slot: existingSlot, tableSize: existing.length };
    }
    if (nextSlot > LAST_TARGET_SLOT) {
      diagnostics.push({
        severity: "error",
        message: liveValueBudgetMessage(`the changing ${property} on "#${id}"`),
      });
      return null;
    }
    const slot = nextSlot++;
    const entry = slotMap[id] ?? (slotMap[id] = {});
    entry[slotKey] = slot;
    store[id] = variants.slice();
    return { slot, tableSize: variants.length };
  }

  // Per-handler write facts, folded into the lockstep evidence after every
  // handler is processed (the verdict needs the target's FINAL property set).
  const handlerFactsList: HandlerFacts[] = [];

  function transformBody(selector: string, body: string): string[] {
    const emitted: string[] = [];
    const statementIsDomWrite: boolean[] = [];
    const writes: PropWrite[] = [];
    // Emitted hidden writes, for this handler's ordering rules.
    const hiddenWrites: { id: string; at: number }[] = [];
    let statementAt = -1;
    for (const statement of splitStatements(body)) {
      statementAt += 1;
      const domWrite = DOM_WRITE.exec(statement.normalized);
      statementIsDomWrite.push(Boolean(domWrite));
      if (domWrite) {
        const id = domWrite[2];
        const property = domWrite[3];
        const kind: PropKind | "hidden" =
          property === "textContent"
            ? "text"
            : property === "className"
              ? "class"
              : property === "hidden"
                ? "hidden"
                : "color";
        const rhs = domWrite[4].trim();
        if (animatedIds.has(id)) {
          diagnostics.push({
            severity: "error",
            message:
              `Target "#${id}" is animated (widget.animate); an animated target is ` +
              `frame-driven only and cannot also be written by handlers. ` +
              `Offending statement: ${statement.raw}`,
          });
          continue;
        }
        const isDigitsWrite = kind === "text" && DIGITS_CALL.test(rhs);
        if (digitTargets[id] && !isDigitsWrite) {
          diagnostics.push({
            severity: "error",
            message:
              `Target "#${id}" mixes digits() with other writes; a digits target is ` +
              `digit-driven only. Offending statement: ${statement.raw}`,
          });
          continue;
        }
        if (kind === "hidden") {
          const textSlot = slotMap[id]?.textSlot;
          const priorText = writes.some((write) => write.id === id && write.kind === "text");
          if (rhs.length === 0 || textSlot === undefined || !priorText) {
            diagnostics.push({
              severity: "error",
              message:
                `Set "#${id}" textContent earlier in the same handler, above the line that ` +
                `hides it. The keyboard hides an element by painting over the text it was ` +
                `last given, so it has to be given that text first — in this handler, not ` +
                `another one. Offending statement: ${statement.raw}`,
            });
            continue;
          }
          const reserved = tables[id].length;
          const previous = hiddenVariant[id];
          if (previous !== undefined && previous !== reserved) {
            // Unreachable while variant tables are append-only, but a silent
            // divergence here would corrupt the assembler's variant plan.
            diagnostics.push({
              severity: "error",
              message: `Target "#${id}" hidden variant index changed between writes; transpiler bug.`,
            });
            continue;
          }
          hiddenVariant[id] = reserved;
          usesHide = true;
          emitted.push(`__hide(${textSlot}, ${rhs}, ${reserved});`);
          hiddenWrites.push({ id, at: statementAt });
          continue;
        }
        if (kind === "text" && isDigitsWrite) {
          const args = splitTopLevelArgs(DIGITS_CALL.exec(rhs)![1]);
          if (!args || args.length !== 2 || args[0].length === 0) {
            diagnostics.push({
              severity: "error",
              message: `digits() takes exactly (value, count): ${statement.raw}`,
            });
            continue;
          }
          if (!/^\d+$/.test(args[1])) {
            diagnostics.push({
              severity: "error",
              message:
                `digits(value, count) needs a plain number for the count — write ` +
                `${DIGITS_MIN_COUNT} to ${DIGITS_MAX_COUNT} out in full, not a variable. ` +
                `How many digit positions the widget has is decided when it is built, ` +
                `before it ever runs, so it cannot be worked out on the keyboard. ` +
                `Offending statement: ${statement.raw}`,
            });
            continue;
          }
          const count = Number(args[1]);
          if (count < DIGITS_MIN_COUNT || count > DIGITS_MAX_COUNT) {
            diagnostics.push({
              severity: "error",
              message:
                `digits(value, ${count}): count must be ${DIGITS_MIN_COUNT}..` +
                `${DIGITS_MAX_COUNT}: ${statement.raw}`,
            });
            continue;
          }
          if (slotMap[id] || hiddenVariant[id] !== undefined) {
            diagnostics.push({
              severity: "error",
              message:
                `Target "#${id}" mixes digits() with other writes; a digits target is ` +
                `digit-driven only. Offending statement: ${statement.raw}`,
            });
            continue;
          }
          let alloc = digitTargets[id];
          if (alloc && alloc.count !== count) {
            diagnostics.push({
              severity: "error",
              message:
                `Target "#${id}" digit count differs between writes (${alloc.count} vs ` +
                `${count}); every digits() write to one target must use the same count. ` +
                `Offending statement: ${statement.raw}`,
            });
            // Emit against the canonical (first-seen) allocation, as for tables.
          } else if (!alloc) {
            if (nextSlot > LAST_TARGET_SLOT) {
              diagnostics.push({
                severity: "error",
                message: liveValueBudgetMessage(`the ${count}-digit number on "#${id}"`),
              });
              continue;
            }
            alloc = { count, slot: nextSlot++ };
            digitTargets[id] = alloc;
          }
          usesDigits = true;
          emitted.push(`__set(${alloc.slot}, (${args[0]}) | 0);`);
          continue;
        }
        if (kind === "text" && STRING_LITERAL.test(rhs)) {
          // Constant text still goes through a (single-entry) table so the
          // native facade needs exactly one rendering path.
          const allocation = allocate(id, "text", [decodeStringLiteral(rhs)], statement.raw);
          if (allocation) emitted.push(`__set(${allocation.slot}, 0);`);
          writes.push({ id, kind, expr: "0", at: statementAt });
          continue;
        }
        const pickMatch = PICK_CALL.exec(rhs);
        if (pickMatch) {
          const args = splitTopLevelArgs(pickMatch[1]);
          if (args && args.length >= 2 && args.slice(1).every((arg) => STRING_LITERAL.test(arg))) {
            const variants = args.slice(1).map(decodeStringLiteral);
            if (kind === "class" && variants.length > CLASS_VARIANT_BUDGET) {
              diagnostics.push({
                severity: "error",
                message:
                  `Target "#${id}" className lists ${variants.length} variants; class ` +
                  `variants are captured rasters and the facade renders at most ` +
                  `${CLASS_VARIANT_BUDGET} per target.`,
              });
              continue;
            }
            const allocation = allocate(id, kind, variants, statement.raw);
            if (allocation) {
              emitted.push(`__set(${allocation.slot}, mod(${args[0]}, ${allocation.tableSize}));`);
            }
            writes.push({ id, kind, expr: args[0], at: statementAt });
            continue;
          }
        }
        diagnostics.push({
          severity: "error",
          message:
            `Unsupported document write in "${selector}" handler (transpilable forms: ` +
            `textContent = pick(expr, "…", …); style.color = pick(expr, "…", …); ` +
            `className = pick(expr, "…", …); textContent = "literal"; ` +
            `textContent = digits(expr, 1..4); hidden = expr): ${statement.raw}`,
        });
        continue;
      }
      {
        // The mailbox API is the transpiler's PRIVATE lowering: it owns which
        // slot each target uses, so a hand-written setInt/commit silently
        // overwrites a render slot (verified: it passed through with zero
        // diagnostics and corrupted the screen). Refuse it by name, and say
        // what to write instead.
        const mailbox = /(?:^|[^\w$.])widget\s*\.\s*(setInt|getInt|commit|snapshot|on|keys)\b/.exec(
          statement.masked,
        );
        if (mailbox) {
          diagnostics.push({
            severity: "error",
            message:
              `widget.${mailbox[1]} cannot be called inside a handler — the compiler owns ` +
              `the widget's value slots. Set what the screen shows with ` +
              `document.querySelector("#id").textContent = … instead: ${statement.raw}`,
          });
          continue;
        }
      }
      if (/(?:^|[^\w$.])widget\s*\.\s*animate\b/.test(statement.masked)) {
        // A passthrough would emit widget.animate into the device source,
        // where no such method exists — the dispatch would throw on-device.
        diagnostics.push({
          severity: "error",
          message:
            `widget.animate is a top-level (load-time) declaration like widget.on; ` +
            `move it out of the "${selector}" handler: ${statement.raw}`,
        });
        continue;
      }
      if (DOCUMENT_TOKEN.test(statement.masked)) {
        // The device has no DOM at all, so anything else touching `document`
        // cannot be lowered onto mailbox slots.
        let hint = "";
        if (/\.\s*hidden\b/.test(statement.masked)) {
          hint =
            " (only `el.hidden = expr` WRITES are supported, and only after the target's" +
            " textContent write in the same handler)";
        } else if (/innerHTML/.test(statement.masked)) {
          hint = " (innerHTML does not exist on the device; use textContent with pick variants)";
        } else if (/classList/.test(statement.masked)) {
          hint = " (classList does not exist on the device; use className = pick variants)";
        }
        diagnostics.push({
          severity: "error",
          message: `Unsupported document access in "${selector}" handler${hint}: ${statement.raw}`,
        });
        continue;
      }
      if (/^return\b/.test(statement.masked)) {
        // The auto-commit runs after the body, so an early return silently
        // drops staged writes. Warn instead of erroring: the statement is
        // legal JS and the author may know what they are doing.
        diagnostics.push({
          severity: "warning",
          message:
            `"${selector}" handler returns early; slot writes staged before the return ` +
            `will not commit (the auto-commit runs at the end of the handler body).`,
        });
      }
      emitted.push(statement.normalized.endsWith("}") ? statement.normalized : `${statement.normalized};`);
    }

    // Ordering rules for the hidden writes this handler emitted: exactly one
    // content pick drives the wrapped slot, and nothing content-writes the
    // target after its hidden write (that would silently unhide it).
    for (const hiddenWrite of hiddenWrites) {
      if (hiddenWrites.filter((other) => other.id === hiddenWrite.id).length > 1) {
        diagnostics.push({
          severity: "error",
          message:
            `Target "#${hiddenWrite.id}" has more than one hidden write in the ` +
            `"${selector}" handler; a second __hide would wrap the hidden index itself. ` +
            `Write hidden once, after the content write.`,
        });
        break;
      }
      if (writes.some((write) => write.id === hiddenWrite.id && write.at > hiddenWrite.at)) {
        diagnostics.push({
          severity: "error",
          message:
            `Target "#${hiddenWrite.id}" content writes must come before its hidden ` +
            `write in the "${selector}" handler (a later content write would silently ` +
            `unhide it).`,
        });
      }
      const textWrites = writes.filter(
        (write) => write.id === hiddenWrite.id && write.kind === "text",
      ).length;
      if (textWrites > 1) {
        diagnostics.push({
          severity: "error",
          message:
            `Target "#${hiddenWrite.id}" hidden needs its content driven by ONE ` +
            `textContent write in the "${selector}" handler; found ${textWrites}.`,
        });
      }
    }

    handlerFactsList.push({ writes, inert: statementIsDomWrite });
    return emitted;
  }

  interface EmittedHandler {
    canonical: string;
    lines: string[];
  }

  const handlerRecords: EmittedHandler[] = [];
  let tickRecord: EmittedHandler | null = null;
  const seenKeys = new Set<string>();
  let tick100 = false;
  let tick1s = false;
  let knob = false;
  let hasKey = false;
  let hasChord = false;
  const hostIds = new Set<number>();

  for (const handler of handlers) {
    const info = normalizeSelector(handler.selector);
    if (!info) {
      diagnostics.push({
        severity: "error",
        message: `Unknown event selector "${handler.selector}"; the device never delivers it.`,
      });
      continue;
    }
    if (seenKeys.has(info.dedupeKey)) {
      diagnostics.push({
        severity: "error",
        message: `Duplicate handler for "${info.canonical}"; the device VM rejects re-registration.`,
      });
      continue;
    }
    seenKeys.add(info.dedupeKey);
    switch (info.kind) {
      case "tick100": tick100 = true; break;
      case "tick1s": tick1s = true; break;
      case "knob": knob = true; break;
      case "host": hostIds.add(info.hostId as number); break;
      case "key": hasKey = true; break;
      case "chord": hasChord = true; break;
    }

    const record: EmittedHandler = {
      canonical: info.canonical,
      lines: transformBody(info.canonical, handler.body),
    };
    handlerRecords.push(record);
    if (info.kind === "tick100") tickRecord = record;
  }

  // ── animations: reserve state + slot, merge the step into tick.100ms ────────
  const animations: TranspiledWidget["animations"] = {};
  const animationVars: string[] = [];
  const animationSteps: string[] = [];
  for (const [ordinal, declared] of animationDecls.entries()) {
    if (slotMap[declared.id] || digitTargets[declared.id]) {
      // The statement-level refusals above cover writes AFTER the declaration
      // scan; this covers nothing today but keeps the invariant explicit.
      diagnostics.push({
        severity: "error",
        message:
          `Target "#${declared.id}" is animated (widget.animate); an animated target ` +
          `is frame-driven only and cannot also be written by handlers.`,
      });
      continue;
    }
    if (nextSlot > LAST_TARGET_SLOT) {
      diagnostics.push({
        severity: "error",
        message: liveValueBudgetMessage(`the animation on "#${declared.id}"`),
      });
      continue;
    }
    const slot = nextSlot++;
    animations[declared.id] = { frames: declared.frames, slot };
    const varName = `__anim${ordinal}_${declared.id.replace(/[^A-Za-z0-9_]/g, "_")}`;
    animationVars.push(`var ${varName} = 0;`);
    animationSteps.push(`${varName} = mod(${varName} + 1, ${declared.frames});`);
    animationSteps.push(`__set(${slot}, ${varName});`);
  }
  if (animationSteps.length > 0) {
    if (tickRecord) {
      // The author's statements run first; the animation steps advance after.
      tickRecord.lines.push(...animationSteps);
    } else {
      handlerRecords.push({ canonical: "tick.100ms", lines: animationSteps });
      tick100 = true;
    }
  }

  const emittedHandlers = handlerRecords.map((record) =>
    [
      `widget.on(${JSON.stringify(record.canonical)}, function (event) {`,
      "  __wrote = 0;",
      ...record.lines.map((line) => `  ${line}`),
      // Commit exactly once per dispatch, and only when something was
      // staged: slot 0 must be strictly increasing per committed publish or
      // the renderer rejects the revision.
      "  if (__wrote) {",
      "    __rev = (__rev + 1) | 0;",
      "    widget.setInt(0, __rev);",
      "    widget.commit();",
      "  }",
      "});",
    ].join("\n"),
  );

  if (emittedHandlers.length === 0) {
    diagnostics.push({
      severity: "error",
      message: "Script registers no transpilable handlers; the widget would never run.",
    });
  }
  if (emittedHandlers.length > HANDLER_BUDGET) {
    diagnostics.push({
      severity: "error",
      message: `Handler budget exceeded: ${emittedHandlers.length} handlers, device limit is ${HANDLER_BUDGET}.`,
    });
  }

  const preludeSections = [PRELUDE];
  if (usesHide) preludeSections.push(HIDE_HELPER);
  if (usesDigits && DIGITS_HELPER) preludeSections.push(DIGITS_HELPER);
  const sections: string[] = [preludeSections.join("\n")];
  const stateLines = [
    ...states.map((state) => `var ${state.name} = ${state.initial};`),
    ...animationVars,
  ];
  if (stateLines.length > 0) {
    sections.push(stateLines.join("\n"));
  }
  sections.push(...emittedHandlers);
  const deviceSource = SOURCE_PREFIX + sections.join("\n\n") + "\n";

  const byteLength = utf8Length(deviceSource);
  if (byteLength > SOURCE_BUDGET_BYTES) {
    diagnostics.push({
      severity: "error",
      message:
        `Transpiled source is ${byteLength} bytes UTF-8; the device budget is ` +
        `${SOURCE_BUDGET_BYTES} bytes. Remove handlers or statements.`,
    });
  }

  // A widget only appears on the keyboard once it publishes; the device shows
  // whatever was last painted until then. Without a 1-second handler that
  // rewrites its targets, a widget driven purely by keys or feeds sits blank
  // from boot until the first event arrives — the single most confusing thing
  // a new widget can do, and invisible in the Designer (where the simulator
  // paints immediately). Warn, do not block: some widgets legitimately wait.
  if (!tick1s && !tick100 && emittedHandlers.length > 0) {
    diagnostics.push({
      severity: "warning",
      message:
        'No "tick.1s" handler: on the keyboard this widget stays blank until its ' +
        "first key, knob or feed event arrives. Add a tick.1s handler that rewrites " +
        "what it shows, so it paints as soon as it appears.",
    });
  }

  const events: TranspiledWidget["events"] = {};
  if (tick100) events["tick.100ms"] = true;
  if (tick1s) events["tick.1s"] = true;
  if (knob) events["input.fn-bottom-knob"] = true;
  if (hostIds.size > 0) events.hostRpcIds = [...hostIds].sort((a, b) => a - b);
  {
    let declaredKeys: { id: number; nativeToken: number }[] | null = null;
    if (keyNames !== null) {
      const tokens: number[] = [];
      const seenTokens = new Set<number>();
      for (const name of keyNames) {
        const hex = /^0x([0-9a-f]{1,2})$/.exec(name);
        const token = hex ? parseInt(hex[1], 16) : KEY_TOKEN_NAMES[name];
        if (token === undefined || token === 0) {
          diagnostics.push({
            severity: "error",
            message:
              `widget.keys: there is no key called "${name}". Name keys the way you say ` +
              `them — a-z, 0-9, f1-f12, up/down/left/right, space, enter, tab, esc, ` +
              `backspace, delete, insert, home, end, pageup, pagedown, capslock, ` +
              `shift/ctrl/alt/cmd, punctuation spelled out like comma or slash, or "any" ` +
              `for every key you did not name. ` +
              `(Punctuation in full: comma, period, slash, semicolon, quote, minus, ` +
              `equals, lbracket, rbracket, backslash, grave.)`,
          });
          continue;
        }
        if (seenTokens.has(token)) {
          diagnostics.push({ severity: "error", message: `widget.keys: "${name}" is declared twice.` });
          continue;
        }
        seenTokens.add(token);
        tokens.push(token);
      }
      if (tokens.length > MAX_DECLARED_KEYS) {
        diagnostics.push({
          severity: "error",
          message: `widget.keys declares ${tokens.length} keys; the device admits at most ${MAX_DECLARED_KEYS}.`,
        });
      }
      declaredKeys = tokens.map((nativeToken, id) => ({ id, nativeToken }));
      if (!hasKey && !hasChord) {
        diagnostics.push({
          severity: "error",
          message: "widget.keys is declared but no input.key.* or input.chord.* handler uses it.",
        });
      }
      if (hasChord && declaredKeys.length < 2) {
        diagnostics.push({
          severity: "error",
          message: "Chord handlers need at least two declared keys (the chord is the first two held together).",
        });
      }
    }
    if (hasKey || hasChord) {
      events.keys = (declaredKeys ?? DEFAULT_KEYS).map((key) => ({ ...key }));
    }
    if (hasChord) events.chords = WIRED_CHORDS.map((chord) => ({ ...chord }));
  }

  // ── lockstep evidence ───────────────────────────────────────────────────────
  // Folded across handlers against each target's FINAL property set: in every
  // handler that touches a target, all of its properties must be written with
  // textually identical pick-index expressions and only inert (DOM-write)
  // statements between them.
  const sharedEvidence = new Map<string, boolean>();
  for (const facts of handlerFactsList) {
    for (const id of new Set(facts.writes.map((write) => write.id))) {
      const kinds: PropKind[] = [];
      if (slotMap[id]?.textSlot !== undefined) kinds.push("text");
      if (slotMap[id]?.colorSlot !== undefined) kinds.push("color");
      if (slotMap[id]?.classSlot !== undefined) kinds.push("class");
      const lasts = kinds.map((kind) =>
        facts.writes.filter((write) => write.id === id && write.kind === kind).pop(),
      );
      let paired = lasts.every((last) => last !== undefined);
      if (paired && lasts.length > 1) {
        const defined = lasts as PropWrite[];
        paired = defined.every((last) => last.expr === defined[0].expr);
        if (paired) {
          const from = Math.min(...defined.map((last) => last.at));
          const to = Math.max(...defined.map((last) => last.at));
          for (let between = from + 1; between < to; between += 1) {
            // A non-write statement between the pair could mutate the index
            // expression's state, so the textual match would prove nothing.
            if (!facts.inert[between] && !defined.some((last) => last.at === between)) {
              paired = false;
            }
          }
        }
      }
      sharedEvidence.set(id, (sharedEvidence.get(id) ?? true) && paired);
    }
  }

  // Verdicts only for targets with two or more properties; the assembler never
  // needs (or should trust) an answer for anything else.
  const sharedPickIndex: TranspiledWidget["sharedPickIndex"] = {};
  for (const [id, alloc] of Object.entries(slotMap)) {
    const propertyCount = [alloc.textSlot, alloc.colorSlot, alloc.classSlot].filter(
      (slot) => slot !== undefined,
    ).length;
    if (propertyCount >= 2) {
      sharedPickIndex[id] = sharedEvidence.get(id) === true;
    }
    // Class variants only exist as captured pixels, so an unprovable pairing
    // can never assemble — refuse it here instead of at capture time.
    if (alloc.classSlot !== undefined && propertyCount >= 2 && sharedEvidence.get(id) !== true) {
      diagnostics.push({
        severity: "error",
        message:
          `Write "#${id}" className and its other properties back-to-back from the same ` +
          `pick index — the identical expression in every handler that touches it. Right ` +
          `now className is picked independently of the rest. ` +
          `(The keyboard draws each combination ahead of time and chooses between them ` +
          `with a single value, so a styled element's properties cannot vary apart.)`,
      });
    }
  }

  return {
    deviceSource,
    slotMap,
    tables,
    colorTables,
    classTables,
    sharedPickIndex,
    animations,
    hiddenVariant,
    digitTargets,
    events,
    diagnostics,
  };
}

// ── selector handling ────────────────────────────────────────────────────────

// Named device feeds: data the FIRMWARE publishes on its own. A designer
// subscribes by name — widget.on("device.typing-speed") — and never needs to
// know that it travels as a host.rpc packet on a particular id. The id is an
// implementation detail of the transport, so it lives here and nowhere the
// user can see it.
export const DEVICE_FEEDS: Record<string, { id: number; summary: string; value: string; auxiliary: string }> = {
  "device.typing-speed": {
    id: 0xb2f2,
    summary: "How fast you are typing, published by the keyboard once a second.",
    value: "words per minute",
    auxiliary: "keys pressed in the last 60 seconds",
  },
};

// ── Named feeds a designer defines themselves ────────────────────────────────
// A widget subscribes to its own data by NAME — widget.on("feed.room-temp") —
// and never invents a channel number. The channel is DERIVED from the name, so
// it is stable across machines and rebuilds without any registry: the same
// name always means the same channel, and the generated feeder script computes
// it the same way. Ids live in 0xC000..0xFEFF, clear of the device feeds and of
// every id the bundled examples ever used.
// Feeds with a FIXED channel because something already ships that sends them:
// the weather host companion and the clock feeder use these exact ids today.
// They get names here (not hash-derived ids) so the bundled examples read in
// plain language while staying wire-compatible with the feeders people already
// run. Everything else a designer names is derived — see userFeedId.
export const PINNED_FEEDS: Record<string, { id: number; summary: string; value: string; auxiliary: string }> = {
  "feed.weather-now": {
    id: 0xb241,
    summary: "Current conditions from the weather companion on your computer.",
    value: "temperature in °F (0–99)",
    auxiliary: "condition: 0 clear, 1 cloudy, 2 rain, 3 windy",
  },
  "feed.forecast-day-1": {
    id: 0xb242,
    summary: "Tomorrow's forecast row from the weather companion.",
    value: "weekday, 0 = Monday",
    auxiliary: "high × 100 + low",
  },
  "feed.forecast-day-2": {
    id: 0xb243,
    summary: "The day-after forecast row from the weather companion.",
    value: "weekday, 0 = Monday",
    auxiliary: "high × 100 + low",
  },
  "feed.wall-clock-time": {
    id: 0xb250,
    summary: "The time of day, sent from your computer once a minute.",
    value: "hours × 100 + minutes (13:45 → 1345)",
    auxiliary: "unused",
  },
};

export const USER_FEED_PREFIX = "feed.";
const USER_FEED_BASE = 0xc000;
const USER_FEED_SPAN = 0x3f00;

export function userFeedSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** FNV-1a over the slug — deterministic in every browser and in Node. */
export function userFeedId(slug: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < slug.length; i += 1) {
    hash ^= slug.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return USER_FEED_BASE + (hash % USER_FEED_SPAN);
}

interface SelectorInfo {
  canonical: string;
  /** host.rpc dedupes by numeric id, matching the simulator's keyFor(). */
  dedupeKey: string;
  kind: "tick100" | "tick1s" | "knob" | "host" | "key" | "chord";
  hostId?: number;
  /** Set for feed.<name> selectors: the slug the designer wrote. */
  feedSlug?: string;
}

function normalizeSelector(selector: string): SelectorInfo | null {
  if (selector === "tick.100ms") return { canonical: selector, dedupeKey: selector, kind: "tick100" };
  if (selector === "tick.1s") return { canonical: selector, dedupeKey: selector, kind: "tick1s" };
  if (selector === "input.fn-bottom-knob" || selector === "fn-bottom-knob") {
    // The authoring shorthand is normalized so the emitted source registers
    // under the exact name the device (and simulator) dispatch by.
    return { canonical: "input.fn-bottom-knob", dedupeKey: "input.fn-bottom-knob", kind: "knob" };
  }
  {
    const feed = DEVICE_FEEDS[selector];
    if (feed) {
      // Canonicalized to the wire selector so the device and simulator both
      // dispatch it; the user's source keeps the readable name.
      return {
        canonical: `host.rpc:${feed.id}`,
        dedupeKey: `host.rpc:${feed.id}`,
        kind: "host",
        hostId: feed.id,
      };
    }
  }
  {
    // Pinned names resolve FIRST, so a shipped feeder keeps working.
    const pinned = PINNED_FEEDS[selector];
    if (pinned) {
      return {
        canonical: `host.rpc:${pinned.id}`,
        dedupeKey: `host.rpc:${pinned.id}`,
        kind: "host",
        hostId: pinned.id,
        feedSlug: selector.slice(USER_FEED_PREFIX.length),
      };
    }
  }
  if (selector.startsWith(USER_FEED_PREFIX)) {
    const slug = userFeedSlug(selector.slice(USER_FEED_PREFIX.length));
    if (slug.length === 0) return null;
    const hostId = userFeedId(slug);
    return {
      canonical: `host.rpc:${hostId}`,
      dedupeKey: `host.rpc:${hostId}`,
      kind: "host",
      hostId,
      feedSlug: slug,
    };
  }
  if (selector.startsWith("host.rpc:")) {
    const hostId = Number(selector.slice("host.rpc:".length));
    if (!Number.isInteger(hostId) || hostId < 1 || hostId > 0xffff) return null;
    return { canonical: selector, dedupeKey: `host.rpc:${hostId}`, kind: "host", hostId };
  }
  if (selector === "input.key.down" || selector === "input.key.up" || selector === "input.key.hold") {
    return { canonical: selector, dedupeKey: selector, kind: "key" };
  }
  if (selector === "input.chord.down" || selector === "input.chord.up") {
    return { canonical: selector, dedupeKey: selector, kind: "chord" };
  }
  return null;
}

// ── top-level scanning ───────────────────────────────────────────────────────

// The entire legal top level, in one place. Each form's PATTERN is what the
// scanner matches and its EXAMPLE is what the refusal at the bottom of
// scanTopLevel offers back, so the grammar and the sentence describing it
// cannot disagree. They used to be written twice and did disagree: the message
// listed everything except widget.keys, which the scanner had accepted all
// along and which the Event Lab preset opens with — so an author who tripped
// any unrelated top-level error was told, authoritatively, to delete a correct
// line. Adding a form means adding it here, which makes that impossible.
// (Patterns are anchored and flagless, so sharing one across calls is safe:
// exec on a non-global regex keeps no state.)
const TOP_LEVEL_STATE_FORM = {
  example: "var name = 0;",
  pattern: /^(?:let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(-?\d+)\s*;/,
};
const TOP_LEVEL_ANIMATE_FORM = {
  example: 'widget.animate("#id", frames);',
  pattern: /^widget\s*\.\s*animate\s*\(\s*(["'])#([A-Za-z][A-Za-z0-9_-]{0,15})\1\s*,\s*(-?\d+)\s*\)\s*;?/,
};
const TOP_LEVEL_KEYS_FORM = {
  example: 'widget.keys("space", "a");',
  pattern: /^widget\s*\.\s*keys\s*\(([^)]*)\)\s*;?/,
};
const TOP_LEVEL_HANDLER_FORM = {
  example: 'widget.on("tick.1s", function (event) { … });',
  pattern:
    /^widget\.on\(\s*(["'])([^"'\\]*)\1\s*,\s*(?:function\s*\(\s*(?:event\s*)?\)\s*\{|\(\s*(?:event\s*)?\)\s*=>\s*\{)/,
};
const TOP_LEVEL_FORMS = [
  TOP_LEVEL_STATE_FORM,
  TOP_LEVEL_KEYS_FORM,
  TOP_LEVEL_ANIMATE_FORM,
  TOP_LEVEL_HANDLER_FORM,
];

function scanTopLevel(
  text: string,
  diagnostics: Diagnostic[],
): { states: ScannedState[]; handlers: ScannedHandler[]; animates: ScannedAnimate[]; keyNames: string[] | null } {
  const states: ScannedState[] = [];
  const seenStates = new Set<string>();
  const handlers: ScannedHandler[] = [];
  const animates: ScannedAnimate[] = [];
  let keyNames: string[] | null = null;
  let cursor = 0;
  while (cursor < text.length) {
    const ch = text[cursor];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === ";") {
      cursor++;
      continue;
    }
    if (ch === "/" && text[cursor + 1] === "/") {
      const newline = text.indexOf("\n", cursor);
      cursor = newline < 0 ? text.length : newline + 1;
      continue;
    }
    if (ch === "/" && text[cursor + 1] === "*") {
      const close = text.indexOf("*/", cursor + 2);
      if (close < 0) {
        diagnostics.push({ severity: "error", message: "Unterminated block comment." });
        cursor = text.length;
        continue;
      }
      cursor = close + 2;
      continue;
    }
    const slice = text.slice(cursor);
    const decl = TOP_LEVEL_STATE_FORM.pattern.exec(slice);
    if (decl) {
      const name = decl[1];
      if (seenStates.has(name)) {
        diagnostics.push({ severity: "error", message: `Duplicate state declaration "${name}".` });
      } else {
        seenStates.add(name);
        states.push({ name, initial: Number(decl[2]) });
      }
      cursor += decl[0].length;
      continue;
    }
    const animate = TOP_LEVEL_ANIMATE_FORM.pattern.exec(slice);
    if (animate) {
      animates.push({ id: animate[2], frames: Number(animate[3]) });
      cursor += animate[0].length;
      continue;
    }
    const keysDecl = TOP_LEVEL_KEYS_FORM.pattern.exec(slice);
    if (keysDecl) {
      const names: string[] = [];
      let ok = true;
      const body = keysDecl[1].trim();
      if (body.length > 0) {
        for (const part of body.split(",")) {
          const m = /^\s*(["'])([A-Za-z0-9x]+)\1\s*$/.exec(part);
          if (!m) { ok = false; break; }
          names.push(m[2].toLowerCase());
        }
      }
      if (!ok || names.length === 0) {
        diagnostics.push({
          severity: "error",
          message:
            'widget.keys takes 1..16 string key names, e.g. widget.keys("space", "a", "enter").',
        });
      } else if (keyNames !== null) {
        diagnostics.push({ severity: "error", message: "Duplicate widget.keys declaration; declare the key set once." });
      } else {
        keyNames = names;
      }
      cursor += keysDecl[0].length;
      continue;
    }
    if (/^widget\s*\.\s*keys\b/.test(slice)) {
      const end = skipStatement(text, cursor);
      diagnostics.push({
        severity: "error",
        message:
          'widget.keys takes a flat list of string key names: ' +
          text.slice(cursor, end).trim().replace(/\s+/g, " ").slice(0, 80),
      });
      cursor = Math.max(end, cursor + 1);
      continue;
    }
    if (/^widget\s*\.\s*animate\b/.test(slice)) {
      const end = skipStatement(text, cursor);
      const snippet = text.slice(cursor, end).trim().replace(/\s+/g, " ").slice(0, 80);
      diagnostics.push({
        severity: "error",
        message:
          `widget.animate takes ("#id", frames) with a literal integer frame count: ${snippet}`,
      });
      cursor = Math.max(end, cursor + 1);
      continue;
    }
    const header = TOP_LEVEL_HANDLER_FORM.pattern.exec(slice);
    if (header) {
      const open = header[0].length - 1;
      const close = matchBrace(slice, open);
      if (close < 0) {
        diagnostics.push({
          severity: "error",
          message: `Unclosed widget.on("${header[2]}") body.`,
        });
        cursor = text.length;
        continue;
      }
      handlers.push({ selector: header[2], body: slice.slice(open + 1, close) });
      cursor += close + 1;
      const tail = /^\s*\)\s*;?/.exec(text.slice(cursor));
      if (tail) cursor += tail[0].length;
      continue;
    }
    const end = skipStatement(text, cursor);
    const snippet = text.slice(cursor, end).trim().replace(/\s+/g, " ").slice(0, 80);
    diagnostics.push({
      severity: "error",
      message:
        `Unsupported top-level statement. Outside a handler a widget can only declare a ` +
        `starting number, the keys it listens to, an animation, or a handler — ` +
        `${TOP_LEVEL_FORMS.map((form) => form.example).join(" ")} — so move this line ` +
        `inside one of your widget.on handlers. Offending statement: ${snippet}`,
    });
    cursor = Math.max(end, cursor + 1);
  }
  return { states, handlers, animates, keyNames };
}

/** Find the matching close brace, skipping strings AND comments — a "}" inside
 *  either must not close the handler body. Returns -1 when unbalanced. */
function matchBrace(text: string, openAt: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = openAt; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") {
      const newline = text.indexOf("\n", i);
      if (newline < 0) return -1;
      i = newline;
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      const close = text.indexOf("*/", i + 2);
      if (close < 0) return -1;
      i = close + 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Skip one unsupported top-level statement so scanning can resume after it.
 *  Ends after a ";" at depth zero, or after a brace group (function/object)
 *  plus its optional trailing ";". */
function skipStatement(text: string, from: number): number {
  let quote: string | null = null;
  let braces = 0;
  let parens = 0;
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") {
      const newline = text.indexOf("\n", i);
      if (newline < 0) return text.length;
      i = newline;
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      const close = text.indexOf("*/", i + 2);
      if (close < 0) return text.length;
      i = close + 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
    if (ch === "(" || ch === "[") { parens++; continue; }
    if (ch === ")" || ch === "]") { if (parens > 0) parens--; continue; }
    if (ch === "{") { braces++; continue; }
    if (ch === "}") {
      braces--;
      if (braces <= 0 && parens === 0) {
        const tail = /^\s*;/.exec(text.slice(i + 1));
        return i + 1 + (tail ? tail[0].length : 0);
      }
      continue;
    }
    if (ch === ";" && braces === 0 && parens === 0) return i + 1;
  }
  return text.length;
}

// ── statement scanning inside handler bodies ─────────────────────────────────

/** Split a handler body into statements at top-level ";" boundaries. The DSL is
 *  line-oriented but a statement may wrap (multi-line pick variant lists), so
 *  splitting happens on syntax, not lines. Comments are dropped; whitespace is
 *  collapsed outside string literals only. */
function splitStatements(body: string): Statement[] {
  const statements: Statement[] = [];
  let raw = "";
  let normalized = "";
  let masked = "";
  let quote: string | null = null;
  let parens = 0;
  let braces = 0;

  const flush = () => {
    if (raw.trim().length > 0) {
      statements.push({ raw: raw.trim(), normalized: normalized.trim(), masked: masked.trim() });
    }
    raw = "";
    normalized = "";
    masked = "";
  };
  const appendCode = (ch: string) => {
    raw += ch;
    normalized += ch;
    masked += ch;
  };
  const appendSeparator = () => {
    if (normalized.length > 0 && normalized[normalized.length - 1] !== " ") {
      raw += " ";
      normalized += " ";
      masked += " ";
    }
  };

  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote) {
      raw += ch;
      normalized += ch;
      if (ch === "\\") {
        const next = body[i + 1] ?? "";
        raw += next;
        normalized += next;
        i++;
        continue;
      }
      if (ch === quote) {
        masked += ch;
        quote = null;
      }
      continue;
    }
    if (ch === "/" && body[i + 1] === "/") {
      while (i < body.length && body[i] !== "\n") i++;
      i--; // reprocess the newline as whitespace so tokens stay separated
      continue;
    }
    if (ch === "/" && body[i + 1] === "*") {
      i += 2;
      while (i < body.length && !(body[i] === "*" && body[i + 1] === "/")) i++;
      i++; // land on "/", the for-loop increment steps past it
      appendSeparator();
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      raw += ch;
      normalized += ch;
      masked += ch;
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      raw += ch;
      if (normalized.length > 0 && normalized[normalized.length - 1] !== " ") {
        normalized += " ";
        masked += " ";
      }
      continue;
    }
    if (ch === "(" || ch === "[") { parens++; appendCode(ch); continue; }
    if (ch === ")" || ch === "]") { parens--; appendCode(ch); continue; }
    if (ch === "{") { braces++; appendCode(ch); continue; }
    if (ch === "}") {
      braces--;
      appendCode(ch);
      if (braces <= 0 && parens === 0) {
        braces = 0;
        // Keep `else` glued to its `if` so a passthrough block survives intact.
        if (!/^\s*else\b/.test(body.slice(i + 1))) flush();
      }
      continue;
    }
    if (ch === ";" && parens === 0 && braces === 0) { flush(); continue; }
    appendCode(ch);
  }
  flush();
  return statements;
}

/** Split a call's argument text at top-level commas. Returns null when the text
 *  is not one balanced argument list (e.g. `pick(a,"x") + rest`). */
function splitTopLevelArgs(argsText: string): string[] | null {
  const args: string[] = [];
  let current = "";
  let quote: string | null = null;
  let depth = 0;
  for (let i = 0; i < argsText.length; i++) {
    const ch = argsText[i];
    if (quote) {
      current += ch;
      if (ch === "\\") { current += argsText[i + 1] ?? ""; i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; current += ch; continue; }
    if (ch === "(" || ch === "[" || ch === "{") { depth++; current += ch; continue; }
    if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (depth < 0) return null;
      current += ch;
      continue;
    }
    if (ch === "," && depth === 0) { args.push(current.trim()); current = ""; continue; }
    current += ch;
  }
  if (quote) return null;
  args.push(current.trim());
  return args;
}

/** Decode a quoted JS string literal into its value (the table entries the
 *  native facade renders must be the actual text, not source escapes). */
function decodeStringLiteral(literal: string): string {
  const body = literal.slice(1, -1);
  let out = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch !== "\\") { out += ch; continue; }
    const next = body[++i];
    if (next === "n") out += "\n";
    else if (next === "t") out += "\t";
    else if (next === "r") out += "\r";
    else if (next === "u") {
      out += String.fromCharCode(parseInt(body.slice(i + 1, i + 5), 16));
      i += 4;
    } else out += next ?? "";
  }
  return out;
}

function tablesEqual(a: string[] | undefined, b: string[]): boolean {
  if (!a || a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}
