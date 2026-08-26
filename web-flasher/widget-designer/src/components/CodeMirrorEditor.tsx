import type { SourceLanguage } from "../types";
import { useEffect, useMemo, useRef } from "react";
import { EditorState, Compartment, RangeSetBuilder } from "@codemirror/state";
import { EditorView, ViewPlugin, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, ViewUpdate, Decoration, hoverTooltip } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, indentOnInput, foldGutter, foldKeymap, syntaxHighlighting, StreamLanguage, ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { classHighlighter } from "@lezer/highlight";
import { closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap, CompletionContext } from "@codemirror/autocomplete";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { linter, lintGutter, forEachDiagnostic } from "@codemirror/lint";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { javascript } from "@codemirror/lang-javascript";
import { findStrayTopLevelText, scriptErrorProbeLine, scriptParseError } from "./diagnosticsView";

// ─── Token-driven editor theme ─────────────────────────────────────────────
//
// Every color flows through the --wd-* custom properties (CodeMirror accepts
// var() strings in theme specs), so one theme object serves light AND dark —
// the palette swaps with the rest of the app, no editor rebuild needed.

const editorTheme = EditorView.theme({
  // The editor fills its frame (.wd-editor-body owns the line-snapped height)
  // and scrolls internally — a long document must never clip against the frame.
  "&": { height: "100%", backgroundColor: "var(--wd-code-bg)", color: "var(--wd-code-text)" },
  "&.cm-focused": { outline: "none" },
  // Scrollbars are auto-hiding overlays: thin, transparent track, and the
  // thumb only materializes while the pointer is over the editor — never a
  // permanent bar parked over content.
  ".cm-scroller": {
    fontFamily: "var(--wd-font-mono)",
    fontSize: "13px",
    lineHeight: "22px",
    scrollbarWidth: "thin",
    scrollbarColor: "transparent transparent",
  },
  "&:hover .cm-scroller": { scrollbarColor: "var(--wd-border-strong) transparent" },
  // 12px above the first line; 16px below the last so the frame border can
  // never sit on a glyph when scrolled to the end.
  ".cm-content": { padding: "12px 0 16px", caretColor: "var(--wd-code-text)" },
  ".cm-line": { padding: "0 14px" },
  // ── In-editor diagnostics ────────────────────────────────────────────────
  // Wavy underline on the offending range (danger/warning tokens — the same
  // escalation colors the badges use) + a solid dot in the lint gutter.
  ".cm-lintRange-error": {
    backgroundImage: "none",
    textDecorationLine: "underline",
    textDecorationStyle: "wavy",
    textDecorationColor: "var(--wd-danger)",
    textDecorationThickness: "1px",
    textUnderlineOffset: "4px",
  },
  ".cm-lintRange-warning": {
    backgroundImage: "none",
    textDecorationLine: "underline",
    textDecorationStyle: "wavy",
    textDecorationColor: "var(--wd-warning)",
    textDecorationThickness: "1px",
    textUnderlineOffset: "4px",
  },
  ".cm-gutter-lint": { width: "14px" },
  ".cm-gutter-lint .cm-gutterElement": { padding: "0" },
  ".cm-lint-marker": {
    content: '""',
    display: "block",
    width: "7px",
    height: "7px",
    margin: "8px auto 0",
    borderRadius: "999px",
  },
  ".cm-lint-marker-error": { content: '""', background: "var(--wd-danger)" },
  ".cm-lint-marker-warning": { content: '""', background: "var(--wd-warning)" },
  ".cm-tooltip-lint": { padding: "2px 0" },
  ".cm-diagnostic": {
    padding: "4px 10px",
    fontFamily: "var(--wd-font-sans)",
    fontSize: "12px",
    lineHeight: "18px",
    border: "none",
    borderLeft: "2px solid transparent",
  },
  ".cm-diagnostic-error": { borderLeft: "2px solid var(--wd-danger)" },
  ".cm-diagnostic-warning": { borderLeft: "2px solid var(--wd-warning)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--wd-code-text)" },
  ".cm-gutters": { backgroundColor: "var(--wd-code-bg)", color: "var(--wd-code-gutter-text)", border: "none", borderRight: "1px solid var(--wd-border-subtle)" },
  ".cm-activeLineGutter": { backgroundColor: "var(--wd-code-activeline)", color: "var(--wd-text-secondary)" },
  ".cm-activeLine": { backgroundColor: "var(--wd-code-activeline)" },
  ".cm-foldPlaceholder": { backgroundColor: "var(--wd-surface-inset)", border: "none", color: "var(--wd-text-tertiary)", borderRadius: "4px", padding: "0 6px" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "var(--wd-code-selection) !important" },
  ".cm-selectionMatch": { backgroundColor: "var(--wd-code-selection)" },
  ".cm-searchMatch": { backgroundColor: "var(--wd-warning-subtle)", outline: "1px solid var(--wd-warning-border)", borderRadius: "2px" },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "var(--wd-accent-subtle)", outline: "1px solid var(--wd-accent-border)" },
  ".cm-tooltip": { backgroundColor: "var(--wd-surface-inverse)", color: "var(--wd-text-inverse)", border: "none", borderRadius: "8px", boxShadow: "var(--wd-shadow-3)" },
  // Event-doc hover (kind literals + event.<field>): same inverse tooltip
  // surface, prose set in the UI face with a mono term line on top.
  ".cm-tooltip .cm-wd-doc": { padding: "8px 10px", maxWidth: "320px" },
  ".cm-wd-doc-term": { fontFamily: "var(--wd-font-mono)", fontSize: "12px", lineHeight: "18px" },
  ".cm-wd-doc-body": { fontFamily: "var(--wd-font-sans)", fontSize: "12px", lineHeight: "18px", opacity: 0.85, marginTop: "2px" },
  ".cm-wd-doc-fields": { fontFamily: "var(--wd-font-mono)", fontSize: "11px", lineHeight: "16px", opacity: 0.7, marginTop: "4px" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "var(--wd-accent)", color: "var(--wd-text-on-accent)" },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": { fontFamily: "inherit" },
  // Search panel (⌘F): chrome surfaces + WD field/button recipes so the
  // built-in panel reads as part of the app in both themes.
  ".cm-panels": { backgroundColor: "var(--wd-surface-panel)", color: "var(--wd-text-primary)", border: "none" },
  ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--wd-border-subtle)" },
  ".cm-panels.cm-panels-bottom": { borderTop: "1px solid var(--wd-border-subtle)" },
  ".cm-panel.cm-search": { padding: "8px 12px", fontFamily: "var(--wd-font-sans)", fontSize: "12px" },
  ".cm-panel.cm-search label": { fontSize: "12px", color: "var(--wd-text-secondary)" },
  ".cm-textfield": {
    backgroundColor: "var(--wd-field-bg)",
    border: "1px solid var(--wd-border-strong)",
    borderRadius: "6px",
    color: "var(--wd-text-primary)",
    padding: "2px 8px",
  },
  ".cm-textfield:focus": { outline: "none", borderColor: "var(--wd-accent)" },
  ".cm-button": {
    background: "var(--wd-surface-panel)",
    backgroundImage: "none",
    border: "1px solid var(--wd-border-strong)",
    borderRadius: "6px",
    color: "var(--wd-text-primary)",
    padding: "2px 10px",
  },
  ".cm-button:active": { background: "var(--wd-surface-active)", backgroundImage: "none" },
  ".cm-panel.cm-search [name=close]": { color: "var(--wd-text-tertiary)", fontSize: "18px" },
});

// ─── Hanging indent for wrapped lines ──────────────────────────────────────
//
// With lineWrapping on, a continuation would otherwise snap flush to column 0
// under the gutter, breaking indentation scanning. The standard CM6 recipe:
// per visible line, measure the leading whitespace and set a negative
// text-indent with matching extra padding-left, so continuations align just
// past the line's own indent level. Widths are in `ch` — the editor is
// strictly monospaced, so 1ch equals one column and the alignment survives
// zoom and font-size changes without re-measuring pixel widths.
//
// The 14px base must match the `.cm-line` horizontal padding in editorTheme.
const LINE_PAD_PX = 14;

function buildHangingIndent(view) {
  const builder = new RangeSetBuilder();
  const tabSize = view.state.tabSize;
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      const ws = /^[\t ]*/.exec(line.text)[0];
      // Whitespace-only lines have nothing to hang; skip them.
      if (ws.length > 0 && ws.length < line.text.length) {
        let cols = 0;
        for (let i = 0; i < ws.length; i++) {
          cols += ws.charCodeAt(i) === 9 ? tabSize - (cols % tabSize) : 1;
        }
        builder.add(
          line.from,
          line.from,
          Decoration.line({
            attributes: {
              style: `text-indent:-${cols}ch;padding-left:calc(${LINE_PAD_PX}px + ${cols}ch);`,
            },
          }),
        );
      }
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

const hangingIndent = ViewPlugin.fromClass(
  class {
    decorations;
    constructor(view) {
      this.decorations = buildHangingIndent(view);
    }
    update(update) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildHangingIndent(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

// classHighlighter emits stable .tok-* classes, so the syntax palette is
// plain CSS over the --wd-code-* tokens — dark mode comes for free.
const highlightTheme = EditorView.theme({
  ".tok-keyword": { color: "var(--wd-code-keyword)" },
  ".tok-string, .tok-string2": { color: "var(--wd-code-string)" },
  ".tok-number, .tok-bool, .tok-atom": { color: "var(--wd-code-number)" },
  ".tok-comment": { color: "var(--wd-code-comment)", fontStyle: "italic" },
  ".tok-typeName, .tok-tagName": { color: "var(--wd-code-number)" },
  ".tok-attributeName": { color: "var(--wd-code-keyword)" },
  ".tok-propertyName, .tok-definition": { color: "var(--wd-code-text)" },
  ".tok-variableName": { color: "var(--wd-code-text)" },
  ".tok-operator, .tok-punctuation": { color: "var(--wd-text-tertiary)" },
});

// Snapshot import for extension-friendly surface.
// Bundler tree-shakes lang-html / lang-css / lang-javascript so only the
// language actually selected is loaded.
async function loadLangFor(name) {
  switch (name) {
    case "html": return html();
    case "css": return css();
    case "js": return javascript({ typescript: false, jsx: false });
    case "json": return jsonLanguage();
    default: throw new Error(`unknown editor language ${name}`);
  }
}

// Minimal JSON mode (schema editor): a stream tokenizer over the standard
// token names, so the same .tok-* palette that colors the Source tab colors
// the schema JSON — no extra grammar package, no second highlight theme.
// (The full lezer JS grammar can't serve here: a bare top-level `{ … }`
// object literal is not a valid JS statement.)
let jsonLangCache = null;
function jsonLanguage() {
  if (jsonLangCache) return jsonLangCache;
  jsonLangCache = StreamLanguage.define({
    token(stream) {
      if (stream.eatSpace()) return null;
      const ch = stream.peek();
      if (ch === '"') {
        stream.next();
        let escaped = false;
        while (!stream.eol()) {
          const c = stream.next();
          if (!escaped && c === '"') break;
          escaped = !escaped && c === "\\";
        }
        return /^\s*:/.test(stream.string.slice(stream.pos)) ? "propertyName" : "string";
      }
      if (/[-\d]/.test(ch) && stream.match(/^-?\d+(\.\d+)?([eE][+-]?\d+)?/)) return "number";
      if (stream.match("true") || stream.match("false")) return "bool";
      if (stream.match("null")) return "null";
      stream.next();
      return null;
    },
  });
  return jsonLangCache;
}

// ─── In-editor diagnostics ─────────────────────────────────────────────────
// Position-accurate lint straight off the syntax tree (JS/CSS/HTML) or
// JSON.parse (schema editor) — the same conditions the app-level diagnostics
// report, now WITH a gutter dot and a wavy underline on the offending range.

function collectSyntaxIssues(state, language) {
  const out = [];
  const docLength = state.doc.length;
  if (language === "json") {
    const text = state.doc.toString();
    if (text.trim() === "") return out;
    try {
      JSON.parse(text);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      let from = 0;
      const posMatch = /position (\d+)/.exec(message);
      const lineMatch = /line (\d+) column (\d+)/.exec(message);
      if (posMatch) {
        from = Math.min(Number(posMatch[1]), Math.max(0, docLength - 1));
      } else if (lineMatch) {
        const line = state.doc.line(Math.max(1, Math.min(Number(lineMatch[1]), state.doc.lines)));
        from = Math.min(line.from + Math.max(0, Number(lineMatch[2]) - 1), line.to);
      }
      const to = Math.min(docLength, from + 1);
      out.push({ from: Math.max(0, Math.min(from, Math.max(0, to - 1))), to, severity: "error", message });
    }
    return out;
  }
  // ── JavaScript: the ENGINE's verdict leads ─────────────────────────────
  // When the script genuinely fails to parse, emit ONE diagnostic whose first
  // line is the engine's exact message ("SyntaxError: Unexpected end of
  // input"), with the consequence sentence as line two — never the generic
  // "Syntax error" boilerplate, and never one marker per recovered lezer
  // error node. The marker anchors on the line the V8 prefix-probe names (the
  // line the author actually broke; lezer's recovery can park its error node
  // far downstream — an unclosed anonymous function only errors at EOF), so
  // the gutter dot, the squiggle, and the Inspect row's "line N" all agree.
  if (language === "js") {
    const text = state.doc.toString();
    const engineError = scriptParseError(text);
    if (engineError !== null) {
      const probeLine = scriptErrorProbeLine(text);
      let from = Math.max(0, docLength - 1);
      let to = docLength;
      if (probeLine !== null && probeLine <= state.doc.lines) {
        const line = state.doc.line(probeLine);
        const ws = (/^\s*/.exec(line.text) ?? [""])[0].length;
        from = Math.min(line.from + ws, Math.max(line.from, line.to - 1));
        to = line.to > from ? line.to : Math.min(docLength, from + 1);
      } else {
        // No localizing probe line — fall back to lezer's first error node.
        const tree = ensureSyntaxTree(state, docLength, 120) ?? syntaxTree(state);
        tree.cursor().iterate((node) => {
          if (!node.type.isError) return;
          from = node.from === node.to ? Math.max(0, node.from - 1) : node.from;
          to = Math.max(node.to, Math.min(docLength, from + 1));
          return false;
        });
      }
      out.push({
        from,
        to,
        severity: "error",
        message: `${engineError}\nThe script will not parse, so packaging and the simulator both reject it.`,
      });
      return dedupeIssues(out);
    }
    // The engine parses; only when lezer still reports error nodes (grammar
    // edge cases) does the generic multi-node path below run.
  }
  const tree = ensureSyntaxTree(state, docLength, 120) ?? syntaxTree(state);
  let lastEnd = -1;
  tree.cursor().iterate((node) => {
    if (out.length >= 8) return false;
    if (!node.type.isError) return;
    let from = node.from;
    let to = node.to;
    if (from === to) {
      from = Math.max(0, from - 1);
      to = Math.min(docLength, from + 1);
    }
    if (from < lastEnd) return; // merge runs of adjacent error nodes
    lastEnd = to;
    out.push({
      from,
      to,
      severity: language === "js" ? "error" : "warning",
      message:
        language === "js"
          ? "Syntax error — the script will not parse, so packaging and the simulator both reject it."
          : language === "css"
            ? "Unparseable CSS — the renderer drops this declaration."
            : "Malformed markup — the parser recovered, but this fragment may not render as written.",
    });
  });
  if (language === "html") {
    const text = state.doc.toString();
    const stray = findStrayTopLevelText(text);
    if (stray !== null) {
      const idx = text.indexOf(stray);
      if (idx >= 0) {
        out.push({
          from: idx,
          to: Math.min(docLength, idx + stray.length),
          severity: "warning",
          message: "Stray text outside any element — the device renderer silently drops it. Wrap it in an element or delete it.",
        });
      }
    }
  }
  return dedupeIssues(out);
}

/** Identical (from, to, severity, message) tuples collapse to one marker —
 *  two systems flagging the same range with the same words must never stack
 *  twin entries into one tooltip. */
function dedupeIssues(issues) {
  const seen = new Set();
  return issues.filter((d) => {
    const key = `${d.from}|${d.to}|${d.severity}|${d.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Walk the editor's completion context. Inside the first string argument of
// widget.on( the popup opens the moment the quote is typed — empty partials
// are valid queries there, and validFor keeps the list open (re-filtering
// locally) while the kind is typed, no Ctrl+Space required. Elsewhere a
// string matching a known event-kind prefix still completes as before.
function makeEventKindCompletionSource(allKinds) {
  const kindOptions = (word, insideQuote) =>
    allKinds
      .filter((k) => word === "" || k.canonical.toLowerCase().startsWith(word))
      .map((k) => ({
        label: k.canonical,
        type: "constant",
        detail: k.detail,
        info: k.doc.replace(/\n/g, " "),
        // Inside an already-typed quote the completion supplies the bare kind
        // (the author's own quotes stay); elsewhere it inserts a quoted literal.
        apply: insideQuote ? k.canonical : `'${k.canonical}'`,
      }));
  return function (ctx) {
    const inOn = ctx.matchBefore(/widget\s*\.\s*on\s*\(\s*["'][\w.\-:]*$/);
    if (inOn) {
      const from = inOn.from + inOn.text.search(/["'][\w.\-:]*$/) + 1;
      const word = ctx.state.sliceDoc(from, ctx.pos).toLowerCase();
      return { from, options: kindOptions(word, true), validFor: /^[\w.\-:]*$/ };
    }
    const before = ctx.matchBefore(/[\w.\-:"]+$/);
    if (!before) return null;
    const word = before.text.replace(/^["']|["']$/g, "").toLowerCase();
    if (!word) return null;
    const opts = kindOptions(word, false);
    return { from: before.from, options: opts, validFor: /^(["']?[\w.\-:]+["']?)?$/ };
  };
}

// `event.` → the device contract's field union (derived in eventReference.ts
// from buildDeviceEvent, so completions can never drift from the device).
function makeEventFieldCompletionSource() {
  return function (ctx) {
    const before = ctx.matchBefore(/event\s*\.\s*[\w$]*$/);
    if (!before) return null;
    const fields = window.__MQUICKJS_INTELLI__?.eventFields;
    if (!fields || fields.length === 0) return null;
    const dot = before.text.indexOf(".");
    const partialStart = before.from + (/^event\s*\.\s*/.exec(before.text)?.[0].length ?? dot + 1);
    return {
      from: partialStart,
      options: fields.map((f) => ({
        label: f.label,
        type: "property",
        detail: f.kinds.length === 9 ? "every event" : f.kinds.join(", "),
        info: f.detail || undefined,
        apply: f.label,
      })),
      validFor: /^[\w$]*$/,
    };
  };
}

function buildCompletions(langName, ctx) {
  const before = ctx.matchBefore(/[\w$.-]*$/);
  if (!before) return null;
  const word = before.text;
  // `event.` belongs to the field source above — widget API and event-kind
  // strings would only be noise there.
  if (langName === "js" && ctx.matchBefore(/event\s*\.\s*[\w$]*$/)) return null;
  if (langName === "js" && (ctx.explicit || /\.\s*$/.test(word) || /widget\s*$/.test(word))) {
    const lower = word.toLowerCase();
    return {
      from: before.from,
      options: [
        ...(window.__MQUICKJS_INTELLI__.widgetApi.map((w) => ({
          label: w.name,
          type: "function",
          detail: w.signature,
          info: w.doc.replace(/\n/g, " "),
          apply: `${w.name}(`,
        }))),
        ...(window.__MQUICKJS_INTELLI__.eventKindSuggestions),
      ],
      validFor: /^[\w$.]*$/,
    };
  }
  return null;
}

// ─── Event-doc hover ───────────────────────────────────────────────────────
// Hovering an event-kind string literal ('tick.1s', 'host.rpc:0xB241') or an
// `event.<field>` token shows the SAME docs the reference rail carries — one
// content source (eventReference.ts), two surfaces.

function docTooltipDom(term, body, fields) {
  const dom = document.createElement("div");
  dom.className = "cm-wd-doc";
  const termEl = document.createElement("div");
  termEl.className = "cm-wd-doc-term";
  termEl.textContent = term;
  dom.appendChild(termEl);
  if (body) {
    const bodyEl = document.createElement("div");
    bodyEl.className = "cm-wd-doc-body";
    bodyEl.textContent = body;
    dom.appendChild(bodyEl);
  }
  if (fields && fields.length > 0) {
    const fieldsEl = document.createElement("div");
    fieldsEl.className = "cm-wd-doc-fields";
    fieldsEl.textContent = `event.{${fields.join(", ")}}`;
    dom.appendChild(fieldsEl);
  }
  return dom;
}

function makeEventDocHover() {
  return hoverTooltip((view, pos) => {
    const intelli = window.__MQUICKJS_INTELLI__;
    if (!intelli) return null;
    const line = view.state.doc.lineAt(pos);
    const text = line.text;
    // event.<field> under the pointer.
    for (const m of text.matchAll(/event\s*\.\s*([A-Za-z_$][\w$]*)/g)) {
      const start = line.from + m.index;
      const end = start + m[0].length;
      if (pos < start || pos > end) continue;
      const doc = intelli.eventFieldDocs?.[m[1]];
      if (!doc) return null;
      return {
        pos: start,
        end,
        above: true,
        create: () => ({ dom: docTooltipDom(`event.${m[1]}`, doc, null) }),
      };
    }
    // An event-kind string literal under the pointer.
    for (const m of text.matchAll(/["']([\w.\-:]+)["']/g)) {
      const start = line.from + m.index;
      const end = start + m[0].length;
      if (pos < start || pos > end) continue;
      const found = intelli.lookupKindDoc?.(m[1]);
      if (!found) return null;
      return {
        pos: start,
        end,
        above: true,
        create: () => ({ dom: docTooltipDom(m[1], found.blurb, found.fields) }),
      };
    }
    return null;
  });
}

/** Insert a snippet at the main selection head (blank-line separated), with an
 *  optional prelude (`var value = 0;`) joining the script's top-of-file state
 *  declarations in the SAME transaction, then select past it, center it, and
 *  focus. Two placement rules keep the result transpilable:
 *    1. Nothing ever lands above the canonical `"use strict";` header — it
 *       must stay line 1 or the strict simulator rejects the whole script.
 *    2. A cursor the user never placed (position 0 / inside the header, the
 *       state right after switching buffers) appends at the END of the
 *       document, where a new handler always parses — never mid-header. */
function insertSnippetInView(view, text, prelude) {
  const doc = view.state.doc;
  const docText = doc.toString();
  const headerMatch = /^\s*(["'])use strict\1;[^\n]*\n?/.exec(docText);
  const headerEnd = headerMatch ? headerMatch[0].length : 0;
  const head = view.state.selection.main.head;
  const target = head > headerEnd ? head : doc.length;
  const before = docText.slice(Math.max(0, target - 2), target);
  const after = docText.slice(target, target + 1);
  let insert = text.replace(/\s+$/, "");
  if (target > 0 && !before.endsWith("\n\n")) insert = (before.endsWith("\n") ? "\n" : "\n\n") + insert;
  if (!after.startsWith("\n")) insert = `${insert}\n`;
  const preludeText = prelude ? `${prelude.replace(/\s+$/, "")}\n` : "";
  const changes = [
    ...(preludeText ? [{ from: headerEnd, insert: preludeText }] : []),
    { from: target, insert },
  ];
  view.dispatch({ changes });
  const cursor = (target >= headerEnd ? preludeText.length : 0) + target + insert.length;
  view.dispatch({
    selection: { anchor: cursor },
    effects: EditorView.scrollIntoView(cursor, { y: "center" }),
  });
  view.focus();
}

/** Select + center the first occurrence of `needle`. False when absent. */
function revealTextInView(view, needle) {
  const idx = view.state.doc.toString().indexOf(needle);
  if (idx < 0) return false;
  view.dispatch({
    selection: { anchor: idx, head: idx + needle.length },
    effects: EditorView.scrollIntoView(idx, { y: "center" }),
  });
  view.focus();
  return true;
}

/** Select + center the first diagnostic. Reads the lint state when it has
 *  already run, else derives the position directly (the linter is debounced —
 *  a click must never race it). */
function focusFirstIssue(view, language) {
  let target = null;
  forEachDiagnostic(view.state, (_d, from, to) => {
    if (target === null) target = { from, to };
  });
  if (target === null) {
    const issues = collectSyntaxIssues(view.state, language);
    if (issues.length > 0) target = { from: issues[0].from, to: issues[0].to };
  }
  if (target === null) return false;
  view.dispatch({
    selection: { anchor: target.from, head: target.to },
    effects: EditorView.scrollIntoView(target.from, { y: "center" }),
  });
  view.focus();
  return true;
}

// ─── Component ───────────────────────────────────────────────────────────────────────────────

/** Imperative surface for the frame chrome (the header's issue pill, the
 *  reference rail's insert action, the host-feed handler chips). */
export interface CodeMirrorEditorApi {
  /** Select + scroll to the first in-editor diagnostic. False when none. */
  focusFirstIssue(): boolean;
  /** Insert a snippet at the cursor (optional top-of-doc prelude), focus. */
  insertSnippet(text: string, prelude?: string): void;
  /** Select + center the first occurrence of `needle`. False when absent. */
  revealText(needle: string): boolean;
}

export interface CodeMirrorEditorProps {
  value: string;
  language: SourceLanguage | "json";
  onChange: (next: string) => void;
  /** Optional: only the panels that show a cursor readout pass this. */
  onCursorActivity?: (state: unknown) => void;
  ariaLabel: string;
  readOnly?: boolean;
  height?: string;
  /** Receives the imperative API once the view exists (jump-to-issue). */
  apiRef?: { current: CodeMirrorEditorApi | null };
  /** Fires after a (re)build completes — used to run a deferred jump. */
  onReady?: () => void;
}

export default function CodeMirrorEditor({
  value,
  language,
  onChange,
  onCursorActivity,
  ariaLabel,
  readOnly = false,
  height = "100%",
  apiRef,
  onReady,
}: CodeMirrorEditorProps) {
  const hostRef = useRef(null);
  const viewRef = useRef(null);
  const langCompartment = useRef(new Compartment());
  const readOnlyCompartment = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  const onCursorRef = useRef(onCursorActivity);
  const onReadyRef = useRef(onReady);

  // Keep latest callback refs without rebuilding the editor.
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { onCursorRef.current = onCursorActivity; }, [onCursorActivity]);
  useEffect(() => { onReadyRef.current = onReady; }, [onReady]);

  // Build once. Recreate only if `language` or `readOnly` change.
  useEffect(() => {
    let cancelled = false;
    let view;
    let roCleanup = false;

    async function build() {
      const lang = await loadLangFor(language);
      if (cancelled || !hostRef.current) return;

      const updateListener = EditorView.updateListener.of((u) => {
        if (u.docChanged) onChangeRef.current?.(u.state.doc.toString());
        if (u.selectionSet || u.docChanged) onCursorRef.current?.(u.state);
      });

      const completionExt =
        language === "js"
          ? [
              autocompletion({
                override: [
                  makeEventFieldCompletionSource(),
                  makeEventKindCompletionSource(window.__MQUICKJS_INTELLI__?.eventKinds ?? []),
                  (ctx) => buildCompletions(language, ctx),
                ],
                closeOnBlur: true,
                activateOnTyping: true,
                maxRenderedOptions: 12,
              }),
              makeEventDocHover(),
            ]
          : [];

      const baseExtensions = [
        lineNumbers(),
        history(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        bracketMatching(),
        indentOnInput(),
        foldGutter(),
        closeBrackets(),
        highlightSelectionMatches(),
        syntaxHighlighting(classHighlighter),
        // Long lines wrap instead of growing a horizontal scrollbar — the
        // frame never parks a scroll bar over the last visible line — and
        // continuations hang at the line's own indent level, not column 0.
        EditorView.lineWrapping,
        hangingIndent,
        // Diagnostics live IN the editor: gutter dot + wavy underline on the
        // offending range, tooltip carries the message.
        linter((view) => collectSyntaxIssues(view.state, language), { delay: 400 }),
        lintGutter(),
        editorTheme,
        highlightTheme,
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...foldKeymap,
          indentWithTab,
        ]),
        updateListener,
        completionExt,
      ];

      const state = EditorState.create({
        doc: value,
        extensions: [
          ...baseExtensions,
          langCompartment.current.of(lang),
          readOnlyCompartment.current.of(EditorState.readOnly.of(readOnly)),
        ],
      });
      view = new EditorView({ state, parent: hostRef.current });
      viewRef.current = view;
      roCleanup = true;
      if (apiRef) {
        apiRef.current = {
          focusFirstIssue: () => focusFirstIssue(view, language),
          insertSnippet: (text, prelude) => insertSnippetInView(view, text, prelude),
          revealText: (needle) => revealTextInView(view, needle),
        };
      }
      onReadyRef.current?.();
    }

    build();

    return () => {
      cancelled = true;
      view?.destroy();
      viewRef.current = null;
      if (apiRef) apiRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  // Sync "value" into the editor when the prop changes (e.g. preset swap).
  // We avoid no-op syncs so the cursor doesn't jump mid-type.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (view.state.doc.toString() === value) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  }, [value]);

  // Sync readonly.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: readOnlyCompartment.current.reconfigure(EditorState.readOnly.of(readOnly)),
    });
  }, [readOnly]);

  return <div ref={hostRef} className="cm-host h-full w-full" aria-label={ariaLabel} style={{ minHeight: typeof height === "number" ? `${height}px` : height }} />;
}
