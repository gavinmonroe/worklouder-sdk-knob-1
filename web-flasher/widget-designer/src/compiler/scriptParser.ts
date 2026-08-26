// Browser-friendly parser for the documented widget script shape:
//   var name = <int>;
//   widget.on("selector", function (event) { ... });
//
// We extract:
//   - declarations (state slot names + initial int values)
//   - handlers (selector strings + their body source)
//
// This is the same data the f1-widget-sdk `script.mjs` parses, but lifted
// out of the constrained integer-only subset.

export interface ParsedState {
  name: string;
  initial: number;
  index: number;
}

export interface ParsedHandler {
  selector: string;
  body: string;
  /** bytes from cursor to closing brace */
  byteLength: number;
}

export interface ParsedScript {
  states: ParsedState[];
  handlers: ParsedHandler[];
}

const INT_LITERAL = /^-?\d+$/;

export function parseWidgetScript(source: string): ParsedScript {
  // Trim the strict prefix so the rest is uniform.
  const text = source.startsWith("\"use strict\";\n")
    ? source.slice("\"use strict\";\n".length)
    : source;

  const states: ParsedState[] = [];
  const stateByName = new Map<string, ParsedState>();
  const handlers: ParsedHandler[] = [];
  const seenSelectors = new Set<string>();

  let cursor = 0;
  while (cursor < text.length) {
    // skip whitespace & semicolons
    while (cursor < text.length && /[\s;]/.test(text[cursor])) cursor++;
    if (cursor >= text.length) break;

    const declaration = /^(?:let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(-?\d+)\s*;/.exec(text.slice(cursor));
    if (declaration) {
      const name = declaration[1];
      const value = Number(declaration[2]);
      if (stateByName.has(name)) throw new Error(`Duplicate state ${name}.`);
      const entry: ParsedState = { name, initial: value, index: states.length };
      states.push(entry);
      stateByName.set(name, entry);
      cursor += declaration[0].length;
      continue;
    }

    const handlerHeader = /^widget\.on\(\s*(("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*,\s*)(?:function\s*\(\s*event\s*\)\s*\{|\(\s*event\s*\)\s*=>\s*\{)/.exec(text.slice(cursor));
    if (handlerHeader) {
      const fullMatch = handlerHeader[0];
      const quoteStart = text.slice(cursor).indexOf(handlerHeader[1].trim(), handlerHeader[0].indexOf("widget.on("));
      // Easier: re-locate selector literal in this slice
      const sub = text.slice(cursor);
      const litRe = /["']([^"']+)["']/.exec(sub);
      if (!litRe) throw new Error("Malformed widget.on() selector literal.");
      const selector = litRe[1];
      if (seenSelectors.has(selector)) throw new Error(`Duplicate handler for ${selector}.`);
      seenSelectors.add(selector);

      // Find the opening brace after the header
      const openBrace = sub.indexOf("{", handlerHeader[0].length - 1);
      if (openBrace < 0) throw new Error("widget.on() body has no opening brace.");
      const closeBrace = matchBrace(sub, openBrace);
      const body = sub.slice(openBrace + 1, closeBrace).trim();
      handlers.push({ selector, body, byteLength: closeBrace + 1 - 0 });
      cursor += closeBrace + 1;
      // skip trailing `);`
      const tail = /^\s*\)\s*;/.exec(text.slice(cursor));
      if (tail) cursor += tail[0].length;
      continue;
    }

    // Anything else is unsupported.
    throw new Error(`Unsupported script syntax at byte ${cursor}: ${text.slice(cursor, cursor + 40)}…`);
  }

  if (states.length === 0) throw new Error("Script must declare at least one state.");
  if (handlers.length === 0) throw new Error("Script must register at least one handler.");
  return { states, handlers };
}

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
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error("Unclosed widget.on() body.");
}

export const __testing = { matchBrace, INT_LITERAL };
