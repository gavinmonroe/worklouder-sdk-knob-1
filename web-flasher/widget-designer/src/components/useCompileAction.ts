// Click-site feedback for compileF2JS — one loop, shared by the topbar
// Compile button and the Export tab's Build button so the two never diverge.
// State is visual, never prose: spinner while busy, a 1.2s result flash after,
// and the caller decides how to surface a failure (toast vs inline callout).

import * as React from "react";
import type { DesignerState, DesignerActions } from "../designer/store";
import { viewDiagnostics } from "./diagnosticsView";

export type CompileStatus = "idle" | "busy" | "ok" | "fail";

export interface CompileResult {
  ok: boolean;
  /** Human-readable blocker when the build failed (null on success). */
  message: string | null;
}

export function useCompileAction(state: DesignerState, actions: DesignerActions) {
  const stateRef = React.useRef(state);
  stateRef.current = state;
  const [status, setStatus] = React.useState<CompileStatus>("idle");
  // status is read through a ref inside run() so the callback stays stable.
  const statusRef = React.useRef(status);
  statusRef.current = status;
  const [failure, setFailure] = React.useState<string | null>(null);
  const flashTimer = React.useRef<number | undefined>(undefined);
  React.useEffect(() => () => window.clearTimeout(flashTimer.current), []);

  const run = React.useCallback(async (): Promise<CompileResult> => {
    if (statusRef.current === "busy") return { ok: false, message: null };
    window.clearTimeout(flashTimer.current);
    setStatus("busy");
    setFailure(null);
    const prevPkg = stateRef.current.f2js;
    try {
      await actions.compileF2JS();
    } catch {
      /* judged by state below */
    }
    // Let the store's state updates land before judging the result.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const next = stateRef.current;
    const ok = next.f2js !== null && next.f2js !== prevPkg;
    const message = ok
      ? null
      : viewDiagnostics(next).buildBlocker ?? "The F2JS package could not be built.";
    setStatus(ok ? "ok" : "fail");
    setFailure(message);
    flashTimer.current = window.setTimeout(() => setStatus("idle"), 1200);
    return { ok, message };
  }, [actions]);

  const clearFailure = React.useCallback(() => setFailure(null), []);

  return { status, failure, run, clearFailure };
}
