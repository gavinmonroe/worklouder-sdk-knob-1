// ─────────────────────────────────────────────────────────────────────────────
// Host feeds — DERIVED FROM THE SOURCE, never declared by hand.
//
// The transpiler already knows every host.rpc handler the script registers
// (events.hostRpcIds); this module reads that inventory (read-only use of the
// frozen compiler — the same accepted pattern as useScriptPipeline) and falls
// back to the store's inferred handlers when the script is preview-only. The
// author's own hex spelling ("0xB241") is recovered from the source text so
// the UI never renames an id the author wrote.
//
// Feed METADATA (friendly name, plain-language labels for the two integer
// payload fields, last test values) is presentation-layer state: a module
// store + localStorage in the exact legacyTools.ts pattern, keyed
// `${widgetName}::0x{id}` so it survives reloads without touching
// DesignerState.
// ─────────────────────────────────────────────────────────────────────────────

import * as React from "react";
import { transpileWidgetScript } from "../compiler/mquickjsTranspiler";
import type { DesignerState } from "../designer/store";

export interface HostFeed {
  /** Canonical numeric id. */
  id: number;
  /** Display spelling — the author's own ("0xB241") when recoverable. */
  hex: string;
  /** The exact selector text in the script, for the jump-to-handler chip. */
  selector: string;
}

const canonicalHex = (id: number) => `0x${id.toString(16).toUpperCase()}`;

// Derivation runs on every render of the Source view; cache per source+handlers.
let feedCache: { js: string; handlerKey: string; feeds: HostFeed[] } | null = null;

/** Every host.rpc feed the COMMITTED script declares, in id order. */
export function deriveHostFeeds(js: string, handlers: DesignerState["handlers"]): HostFeed[] {
  const handlerKey = handlers.map((h) => h.kind).join("|");
  if (feedCache && feedCache.js === js && feedCache.handlerKey === handlerKey) return feedCache.feeds;

  // The author's spelling for each id, first occurrence wins.
  const spelling = new Map<number, string>();
  for (const m of js.matchAll(/host\.rpc:(0x[0-9a-fA-F]+|\d+)/g)) {
    const raw = m[1];
    const n = (raw.toLowerCase().startsWith("0x") ? Number.parseInt(raw, 16) : Number.parseInt(raw, 10)) >>> 0;
    if (Number.isFinite(n) && !spelling.has(n)) spelling.set(n, raw);
  }

  const ids = new Set<number>();
  // Primary: the transpiler's own inventory.
  try {
    for (const id of transpileWidgetScript(js).events.hostRpcIds ?? []) ids.add(id >>> 0);
  } catch {
    /* preview-only script — the handler fallback below still answers */
  }
  // Fallback/union: the store's inferred handlers (sim.parsed + regex).
  for (const h of handlers) {
    if (!h.kind.startsWith("host.rpc:")) continue;
    const raw = h.kind.slice("host.rpc:".length).trim();
    const n = (raw.toLowerCase().startsWith("0x") ? Number.parseInt(raw, 16) : Number.parseInt(raw, 10)) >>> 0;
    if (Number.isFinite(n) && n > 0) ids.add(n);
  }

  const feeds = [...ids]
    .sort((a, b) => a - b)
    .map((id) => {
      const hex = spelling.get(id) ?? canonicalHex(id);
      return { id, hex, selector: `host.rpc:${hex}` };
    });
  feedCache = { js, handlerKey, feeds };
  return feeds;
}

// ── Feed metadata store ──────────────────────────────────────────────────────

export interface FeedMeta {
  /** Friendly name ("Current conditions"). */
  name?: string;
  /** Plain-language label for the `value` payload field. */
  valueLabel?: string;
  /** Plain-language label for the `auxiliary` payload field. */
  auxLabel?: string;
  /** Last test values typed into the Send form (raw strings). */
  value?: string;
  auxiliary?: string;
}

const STORAGE_KEY = "wd-feed-meta";

/** Records are keyed per widget AND per feed so two widgets sharing an id
 *  never fight over one label. */
export function feedMetaKey(widgetName: string, id: number): string {
  return `${widgetName}::${canonicalHex(id)}`;
}

// ── Shipped exemplar metadata ────────────────────────────────────────────────
// The presets teach the labeling feature by example: their feeds arrive
// pre-named, with both payload fields explained in plain language (labels
// mirror the presets' own feed-protocol comments). A default fills a field
// only until the user writes that field themselves — saved metadata always
// wins, including a deliberately cleared value.
const FEED_META_DEFAULTS: Record<string, FeedMeta> = {
  [feedMetaKey("Weather (device DSL)", 0xb241)]: {
    name: "Current conditions",
    valueLabel: "temperature °F (0–99)",
    auxLabel: "condition 0–3",
    value: "72",
    auxiliary: "1",
  },
  [feedMetaKey("Weather (device DSL)", 0xb242)]: {
    name: "Forecast day 1",
    valueLabel: "day of week 0–6",
    auxLabel: "high×100+low",
    value: "1",
    auxiliary: "6448",
  },
  [feedMetaKey("Weather (device DSL)", 0xb243)]: {
    name: "Forecast day 2",
    valueLabel: "day of week 0–6",
    auxLabel: "high×100+low",
    value: "2",
    auxiliary: "6650",
  },
  [feedMetaKey("Clock", 0xb250)]: {
    name: "Wall-clock time",
    valueLabel: "time as hh×100+mm",
    auxLabel: "unused (send 0)",
    value: "1234",
    auxiliary: "0",
  },
};

function withDefaults(store: Record<string, FeedMeta>): Record<string, FeedMeta> {
  const out: Record<string, FeedMeta> = { ...store };
  for (const [key, seed] of Object.entries(FEED_META_DEFAULTS)) {
    out[key] = { ...seed, ...store[key] };
  }
  return out;
}

let metaStore: Record<string, FeedMeta> = (() => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Record<string, FeedMeta>;
  } catch {
    /* storage unavailable or corrupt — start clean */
  }
  return {};
})();

/** What readers see: the saved store over the exemplar defaults. */
let mergedStore: Record<string, FeedMeta> = withDefaults(metaStore);

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setFeedMeta(key: string, patch: Partial<FeedMeta>): void {
  metaStore = { ...metaStore, [key]: { ...metaStore[key], ...patch } };
  mergedStore = withDefaults(metaStore);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(metaStore));
  } catch {
    /* storage unavailable — the in-memory store still works */
  }
  listeners.forEach((l) => l());
}

/** The whole metadata map, exemplar defaults included (object identity
 *  changes on every write). */
export function useFeedMeta(): Record<string, FeedMeta> {
  return React.useSyncExternalStore(subscribe, () => mergedStore);
}
