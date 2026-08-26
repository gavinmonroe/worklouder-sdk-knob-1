// Shared F2UP assembly status — the tiny shell-side bridge that keeps the
// header package chip and the Export card's "Assemble F2UP" result from ever
// contradicting each other ("56,599 B · sha256…" beside "No package").
//
// The store (protected) tracks only the F2JS build; the F2UP container is
// assembled inside CompilerPanel, whose local state unmounts with the Export
// tab. This module keeps the last successful assembly OUTSIDE the panel,
// stamped with the exact source it was built from, so any surface can show it
// and staleness is decided by comparison — never by a reset that a
// mid-unmount panel might miss.

import * as React from "react";

export interface F2upStatus {
  bytes: number;
  sha256: string;
  /** The exact source the container was assembled from (reference compare). */
  source: { html: string; css: string; js: string };
  /**
   * Optional inspection payload (Export tab artifact card). Kept here — not in
   * panel-local state — so the assembled container survives tab switches and
   * the artifact card, the header pill, and the footer readout always describe
   * the same bytes.
   */
  base64?: string;
  generation?: number;
  sections?: {
    f2js: { bytes: number; sha256: string };
    f2tf: { bytes: number; sha256: string };
    lzss: { bytes: number; decompressedBytes: number };
  };
}

let current: F2upStatus | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Publish a successful assembly (or null after a failed run). */
export function publishF2up(next: F2upStatus | null): void {
  current = next;
  listeners.forEach((l) => l());
}

/**
 * The last assembled F2UP container, or null when none exists or the source
 * has moved on since it was assembled — a stale container under new source
 * must never mint a fresh-looking pill.
 */
export function useF2upStatus(source: { html: string; css: string; js: string }): F2upStatus | null {
  const status = React.useSyncExternalStore(subscribe, () => current);
  if (!status) return null;
  const s = status.source;
  return s.html === source.html && s.css === source.css && s.js === source.js ? status : null;
}
