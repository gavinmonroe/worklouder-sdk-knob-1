// Legacy tools toggle — the ONE switch that decides whether the older
// render-v2 / F2JS "event program" build paths (Compile F2JS, Build F2JS,
// F2EP preflight notions, frame-capture modes) appear anywhere in the shell.
//
// The platform has fully moved to the v3 mquickjs pipeline (transpile DSL →
// Assemble F2UP → push), so the default experience is 100% v3: this defaults
// OFF, hiding every legacy affordance behind the Settings menu. All legacy
// code paths stay compiled and fully reachable the moment the switch turns on.
//
// Same shared-record pattern as f2upStatus.ts / deviceBuild.ts: a module
// store + useSyncExternalStore hook, persisted to localStorage so the choice
// survives reloads.

import * as React from "react";

const STORAGE_KEY = "wd-legacy-tools";

let current: boolean = (() => {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
})();

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Flip the legacy-tools switch (persisted; every surface re-renders). */
export function setLegacyTools(on: boolean): void {
  current = on;
  try {
    localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
  } catch {
    /* storage unavailable — the in-memory switch still works */
  }
  listeners.forEach((l) => l());
}

/** Whether the legacy F2JS / render-v2 surfaces are visible right now. */
export function useLegacyTools(): boolean {
  return React.useSyncExternalStore(subscribe, () => current);
}
