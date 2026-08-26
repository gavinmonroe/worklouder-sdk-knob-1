// ─────────────────────────────────────────────────────────────────────────────
// Local sha→name registry for the Screens panel (docs/17).
//
// The keyboard's op-5 inventory reports each slot's widget by its F2JS sha256
// (first 16 bytes = 32 hex chars) and nothing more — no on-device name (that is
// a container-v3 nicety, docs/17 phase C). The Designer bridges the gap: every
// successful push records `sha16 → { name, pushedAt, generation }` here, so a
// swept slot whose sha matches something we pushed shows its friendly name.
//
// The key is EXACTLY what op-5 returns and what
// `AssembledWidgetUpload.sections.f2js.sha256.slice(0, 32)` produces — the two
// hash the same F2JS bytes with the same lowercase hex, so they collide by
// construction. Persistence is localStorage (survives reloads); a same-process
// in-memory mirror lets any surface subscribe (the toast writer and the panel
// live in different trees), mirroring f2upStatus.ts / assembleAction.ts.
// ─────────────────────────────────────────────────────────────────────────────

import * as React from "react";

export interface SlotRegistryEntry {
  /** The widget's display name at push time. */
  name: string;
  /** Epoch ms of the most recent push of this sha. */
  pushedAt: number;
  /** The generation this sha was last pushed at (advisory). */
  generation?: number;
}

/** sha16 (32 lowercase hex chars) → entry. */
export type SlotRegistry = Record<string, SlotRegistryEntry>;

const STORAGE_KEY = "wd-slot-registry";

// ── Pure helpers (unit-tested; no storage, no React) ─────────────────────────

/** Lowercase, strip non-hex, clamp to the 32-char (16-byte) op-5 key width. */
export function normalizeSha16(sha: unknown): string {
  if (typeof sha !== "string") return "";
  return sha.toLowerCase().replace(/[^0-9a-f]/g, "").slice(0, 32);
}

/** Validate one stored entry, coercing loosely so a hand-edited blob can't crash. */
function coerceEntry(value: unknown): SlotRegistryEntry | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.name !== "string") return null;
  const pushedAt = typeof v.pushedAt === "number" && Number.isFinite(v.pushedAt) ? v.pushedAt : 0;
  const generation =
    typeof v.generation === "number" && Number.isFinite(v.generation) ? v.generation : undefined;
  return { name: v.name, pushedAt, ...(generation !== undefined ? { generation } : {}) };
}

/** Parse a persisted registry blob, dropping anything malformed. Never throws. */
export function parseRegistry(raw: unknown): SlotRegistry {
  let source: unknown = raw;
  if (typeof raw === "string") {
    try {
      source = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (!source || typeof source !== "object") return {};
  const out: SlotRegistry = {};
  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    const sha16 = normalizeSha16(key);
    const entry = coerceEntry(value);
    if (sha16.length === 32 && entry) out[sha16] = entry;
  }
  return out;
}

/** Immutably fold one push into a registry (last write wins for a sha). */
export function mergeEntry(
  registry: SlotRegistry,
  sha16: string,
  entry: SlotRegistryEntry,
): SlotRegistry {
  const key = normalizeSha16(sha16);
  if (key.length !== 32) return registry;
  return { ...registry, [key]: entry };
}

// ── localStorage-backed external store ───────────────────────────────────────

let cache: SlotRegistry | null = null;
const listeners = new Set<() => void>();

function ensure(): SlotRegistry {
  if (cache) return cache;
  try {
    cache = parseRegistry(globalThis.localStorage?.getItem(STORAGE_KEY) ?? null);
  } catch {
    cache = {};
  }
  return cache;
}

function persist(next: SlotRegistry): void {
  cache = next;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable — the in-memory mirror still serves this session */
  }
  listeners.forEach((l) => l());
}

/** Record a successful push, so a future sweep can name this sha. */
export function recordSlotPush(
  sha16: string,
  entry: { name: string; generation?: number },
): void {
  const key = normalizeSha16(sha16);
  if (key.length !== 32) return;
  persist(
    mergeEntry(ensure(), key, {
      name: entry.name.trim() || "Widget",
      pushedAt: Date.now(),
      ...(entry.generation !== undefined ? { generation: entry.generation } : {}),
    }),
  );
}

/** Look up a friendly entry for a swept sha (any casing/whitespace tolerated). */
export function lookupSlotName(sha16: string): SlotRegistryEntry | null {
  const key = normalizeSha16(sha16);
  if (key.length !== 32) return null;
  return ensure()[key] ?? null;
}

/** Subscribe React trees to the registry so a push re-renders every reader. */
export function useSlotRegistry(): SlotRegistry {
  return React.useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    ensure,
    ensure,
  );
}

/** Test seam: drop the in-memory mirror so the next read re-hydrates. */
export function __resetSlotRegistryCache(): void {
  cache = null;
}
