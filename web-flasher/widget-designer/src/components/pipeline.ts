// Shell-side pipeline capability probe.
//
// The Export tab must never route a click into a raw compiler dump. This
// module asks the (protected, read-only) compiler up front what the current
// script can do, so the shell can disable the paths that would fail and name
// the blocker in plain language BEFORE anything runs:
//
//   * strict simulator  → gates Build F2JS (the store's compileF2JS no-ops
//     without a parsed simulator)
//   * device DSL transpile → gates Assemble F2UP (the assembler transpiles
//     first and throws on the same errors)
//
// It also answers the ONE question the "Add the use-strict header" remedy
// depends on: would prefixing the canonical header actually fix the strict
// simulator, or is the script preview-only for a deeper reason (e.g.
// widget.snapshot / widget.animate, which the strict VM does not provide)?

import * as React from "react";
import { RENDER_V2_MQUICKJS_SOURCE_PREFIX } from "../compiler/constants";
import { createMquickjsSimulator } from "../compiler/mquickjsSimulator";
import { transpileWidgetScript } from "../compiler/mquickjsTranspiler";

export interface ScriptPipeline {
  /** Script already carries the canonical `"use strict";` header. */
  hasStrictHeader: boolean;
  /** The strict simulator accepts the script exactly as it stands. */
  simOk: boolean;
  /** Why the strict simulator rejected the script as-is (null when simOk). */
  simError: string | null;
  /** Prepending the canonical header alone would make the simulator parse. */
  strictHeaderWouldFix: boolean;
  /** Why the header alone does NOT fix it (null when it would, or simOk). */
  prefixedSimError: string | null;
  /** Device-DSL (F2UP transpile gate) errors — empty means assemblable. */
  dslErrors: string[];
  dslOk: boolean;
}

export function probeScriptPipeline(js: string): ScriptPipeline {
  const hasStrictHeader = js.startsWith(RENDER_V2_MQUICKJS_SOURCE_PREFIX);

  let simOk = false;
  let simError: string | null = null;
  try {
    createMquickjsSimulator(js);
    simOk = true;
  } catch (err) {
    simError = (err as Error).message;
  }

  let strictHeaderWouldFix = false;
  let prefixedSimError: string | null = null;
  if (!simOk && !hasStrictHeader) {
    try {
      createMquickjsSimulator(RENDER_V2_MQUICKJS_SOURCE_PREFIX + js);
      strictHeaderWouldFix = true;
    } catch (err) {
      prefixedSimError = (err as Error).message;
    }
  }

  let dslErrors: string[] = [];
  try {
    dslErrors = transpileWidgetScript(js)
      .diagnostics.filter((d) => d.severity === "error")
      .map((d) => d.message);
  } catch (err) {
    dslErrors = [(err as Error).message];
  }

  return {
    hasStrictHeader,
    simOk,
    simError,
    strictHeaderWouldFix,
    prefixedSimError,
    dslErrors,
    dslOk: dslErrors.length === 0,
  };
}

/** Memoized per-source probe for React surfaces. */
export function useScriptPipeline(js: string): ScriptPipeline {
  return React.useMemo(() => probeScriptPipeline(js), [js]);
}

export function withStrictHeader(js: string): string {
  return js.startsWith(RENDER_V2_MQUICKJS_SOURCE_PREFIX) ? js : RENDER_V2_MQUICKJS_SOURCE_PREFIX + js;
}

/**
 * The ONE artifact-chip formatter — "F2JS · 1,936 B" with a spaced middot,
 * identical in the topbar pill, the footer readout, stage badges, and the
 * Device tab's step chips. Never hand-format an artifact label.
 */
export function formatArtifact(format: string, bytes: number): string {
  return `${format} · ${bytes.toLocaleString()} B`;
}

/**
 * Is the most-recent F2JS package built from the CURRENT script? The package
 * records the SHA-256 of its canonicalized source (strict header applied), so
 * the answer is exact: recompute the same digest over the live script and
 * compare. A package that survives a preset switch must present as stale —
 * a success badge describing a previous widget is a lie.
 *
 * Returns null while no package exists; "fresh" until the async digest lands
 * (so the badge never flickers stale on load).
 */
export function usePackageFreshness(
  js: string,
  pkg: { sourceSha256: string } | null,
): "fresh" | "stale" | null {
  const [sha, setSha] = React.useState<string | null>(null);
  React.useEffect(() => {
    let alive = true;
    setSha(null);
    const bytes = new TextEncoder().encode(withStrictHeader(js));
    crypto.subtle
      .digest("SHA-256", bytes)
      .then((buf) => {
        if (!alive) return;
        setSha(
          Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join(""),
        );
      })
      .catch(() => {
        /* WebCrypto unavailable — treat as fresh, never cry wolf */
      });
    return () => {
      alive = false;
    };
  }, [js]);
  if (!pkg) return null;
  if (sha === null) return "fresh";
  return sha === pkg.sourceSha256 ? "fresh" : "stale";
}

/**
 * The source the shell loads for an example: the preset verbatim, plus the
 * canonical strict header exactly when the header alone makes the strict
 * simulator (and with it Build F2JS) pass. Examples whose scripts are
 * preview-only for deeper reasons load untouched and surface the standard
 * informational notice instead.
 */
export function preferredPresetSource(script: string): string {
  if (script.startsWith(RENDER_V2_MQUICKJS_SOURCE_PREFIX)) return script;
  try {
    createMquickjsSimulator(RENDER_V2_MQUICKJS_SOURCE_PREFIX + script);
    return RENDER_V2_MQUICKJS_SOURCE_PREFIX + script;
  } catch {
    return script;
  }
}
