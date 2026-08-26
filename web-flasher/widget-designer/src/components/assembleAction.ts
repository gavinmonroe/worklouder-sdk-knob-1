// Shared "Assemble F2UP" action — one run loop, one busy/error record, so the
// topbar's primary Assemble (legacy tools off) and the Export tab's Assemble
// stage can never show diverging spinners or contradictory errors.
//
// The assemble body is the exact code that lived in CompilerPanel: it reads
// ?f2upGen at click time (the pin chip on the Export tab surfaces it), calls
// actions.assembleWidgetUpload byte-for-byte, and mirrors the result into the
// shared F2UP status (publishF2up) that the header pill, footer readout, and
// Export artifact card all read.
//
// Same shared-record pattern as f2upStatus.ts / deviceBuild.ts: the record is
// stamped with the source it ran against, and a failure message is shown only
// while the buffer still matches — a source edit invalidates it by comparison,
// exactly as CompilerPanel's old useEffect reset did.

import * as React from "react";
import type { DesignerActions } from "../designer/store";
import { publishF2up } from "./f2upStatus";

export interface AssembleSource {
  html: string;
  css: string;
  js: string;
}

interface AssembleRecord {
  busy: boolean;
  /** Failure text from the last run ("" when none). */
  error: string;
  /** The exact source the last run started from (staleness by comparison). */
  source: AssembleSource | null;
}

let current: AssembleRecord = { busy: false, error: "", source: null };
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish(next: AssembleRecord): void {
  current = next;
  listeners.forEach((l) => l());
}

export interface AssembleResult {
  ok: boolean;
  /** Failure text when the run failed (null on success or when skipped). */
  error: string | null;
}

/**
 * Run the F2UP assembly for the given source. No-ops (returns ok:false,
 * error:null) while a run is already in flight — callers gate on their own
 * `dslOk` pre-flight before calling, exactly as the Export button did.
 */
export async function runAssemble(
  actions: DesignerActions,
  source: AssembleSource,
): Promise<AssembleResult> {
  if (current.busy) return { ok: false, error: null };
  publish({ busy: true, error: "", source });
  try {
    // Generation is honored end-to-end (F2JS, F2TF, container must agree),
    // so device-bound assemblies pass ?f2upGen=<running+1> in the URL.
    const generation = Number(new URLSearchParams(window.location.search).get("f2upGen") ?? "1") || 1;
    const assembled = await actions.assembleWidgetUpload({ generation });
    let binary = "";
    const bytes = assembled.binary;
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length, i + 0x8000)));
    }
    // Mirror the result to the shared status so the header package chip and
    // the footer readout reflect the assembled container immediately —
    // adjacent indicators must never contradict each other. Stamped with
    // the source it was built from; staleness is decided by comparison.
    publishF2up({
      sha256: assembled.sha256,
      bytes: bytes.length,
      source,
      base64: btoa(binary),
      generation: assembled.generation,
      sections: assembled.sections,
    });
    publish({ busy: false, error: "", source });
    return { ok: true, error: null };
  } catch (error) {
    const message = (error as Error).message;
    publishF2up(null);
    publish({ busy: false, error: message, source });
    return { ok: false, error: message };
  }
}

/**
 * The shared assemble state, scoped to the caller's CURRENT source: `busy` is
 * global (one assembly at a time), while `error` surfaces only as long as the
 * buffer still matches the source the failed run started from — a failure
 * message from the previous widget must not survive a source edit.
 */
export function useAssembleStatus(source: AssembleSource): { busy: boolean; error: string } {
  const record = React.useSyncExternalStore(subscribe, () => current);
  const s = record.source;
  const matches =
    s !== null && s.html === source.html && s.css === source.css && s.js === source.js;
  return { busy: record.busy, error: matches ? record.error : "" };
}
