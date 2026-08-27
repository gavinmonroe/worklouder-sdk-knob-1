// Topbar: 48px, grid [auto 1fr auto]. Left — logo mark + product name +
// version. Center — the widget's display name (Figma-file style). Right —
// package status and the pipeline's primary action, per mode:
//
//   * v3 (default): Assemble F2UP is the one primary — the F2UP container is
//     the artifact the device push uploads. The chip is F2UP-only.
//   * Legacy tools ON: the older Compile (F2JS) + Download pair returns as
//     SECONDARY buttons beside the primary (Assemble F2UP never demotes),
//     with the full F2JS/F2UP chip taxonomy.
//
// State is visual, never prose: spinner while busy, a 1.2s result flash, and
// a sticky failure toast that names the blocker.

import { useEffect, useRef, useState } from "react";
import pkg from "../../package.json";
import type { DesignerState, DesignerActions } from "../designer/store";
import { Tooltip, Badge, Button, Spinner } from "./ui";
import { Icon } from "./icons";
import { ThemeToggle } from "./ThemeToggle";
import { SettingsMenu } from "./SettingsMenu";
import { useToast } from "./toast";
import { humanizeDiagnostic, revealDiagnostics } from "./diagnosticsView";
import { useF2upStatus } from "./f2upStatus";
import { useCompileAction } from "./useCompileAction";
import { runAssemble, useAssembleStatus } from "./assembleAction";
import { useLegacyTools } from "./legacyTools";
import { formatArtifact, usePackageFreshness, useScriptPipeline } from "./pipeline";

export function Topbar({
  state, actions,
}: {
  state: DesignerState;
  actions: DesignerActions;
}) {
  const legacy = useLegacyTools();
  const hasPkg = state.f2js !== null;
  const freshness = usePackageFreshness(state.js, state.f2js);
  // The F2UP container assembled on the Export tab (null when stale or none):
  // the chip reflects it so the header never contradicts the Export card.
  const f2up = useF2upStatus(state);
  const toast = useToast();

  // The click site owns its feedback: spinner while compiling, a 1.2s result
  // flash after, and a sticky error toast that deep-links to diagnostics.
  const { status, run } = useCompileAction(state, actions);

  // A "Compile failed" toast describes ONE build of ONE source. It must not
  // outlive its own failure: a later successful compile dismisses it, a fresh
  // failure replaces it, and any source change (edit, preset load) that makes
  // the message stale invalidates it too — an error toast that survives its
  // error is the silent-failure sin in reverse.
  const failToastRef = useRef<number | null>(null);
  const sourceKey = `${state.html} ${state.css} ${state.js}`;
  const sourceKeyRef = useRef(sourceKey);
  sourceKeyRef.current = sourceKey;
  const failSourceRef = useRef<string | null>(null);
  const clearFailToast = () => {
    if (failToastRef.current !== null) toast.dismiss(failToastRef.current);
    failToastRef.current = null;
    failSourceRef.current = null;
  };
  useEffect(() => {
    if (failToastRef.current !== null && failSourceRef.current !== null && sourceKey !== failSourceRef.current) {
      clearFailToast();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey]);

  const compile = async () => {
    const result = await run();
    if (result.ok) {
      clearFailToast();
    } else if (result.message !== null) {
      clearFailToast();
      failToastRef.current = toast({
        tone: "danger",
        title: "Compile failed",
        body: humanizeDiagnostic(result.message),
        action: { label: "View diagnostics", onClick: revealDiagnostics },
      });
      failSourceRef.current = sourceKeyRef.current;
    }
  };

  // ── v3 primary: Assemble F2UP (shared action — the Export stage and this
  // button read the SAME busy/error record, so they can never diverge). ─────
  const pipeline = useScriptPipeline(state.js);
  const assemble = useAssembleStatus({ html: state.html, css: state.css, js: state.js });
  const [assembleFlash, setAssembleFlash] = useState<"ok" | "fail" | null>(null);
  const flashTimer = useRef<number | undefined>(undefined);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => () => window.clearTimeout(flashTimer.current), []);
  const assembleNow = async () => {
    if (assemble.busy || !pipeline.dslOk) return;
    const result = await runAssemble(actions, {
      html: state.html, css: state.css, js: state.js,
    });
    setAssembleFlash(result.ok ? "ok" : "fail");
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setAssembleFlash(null), 1200);
    if (!result.ok && result.error !== null) {
      toast({
        tone: "danger",
        title: "Couldn't build your widget",
        body: humanizeDiagnostic(result.error),
      });
    }
  };

  return (
    <div className="wd-topbar">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="wd-logo" aria-hidden="true">F1</div>
        {/* The one h1: the product name IS the page title (preflight strips
            heading margins/size, so the promotion is visually inert). Every
            card title below it is an h2. */}
        <h1 className="text-sm font-semibold tracking-tight text-fg whitespace-nowrap">
          Widget Designer
        </h1>
        <span className="text-[11px] leading-4 text-tertiary wd-nums">v{pkg.version}</span>
      </div>

      {/* Center: the open widget's name, Figma-file style — quiet, truncating,
          purely informational (the frame label on the stage mirrors it). */}
      <div className="wd-topbar-file" aria-hidden="true">
        <span className="truncate">{state.displayName || "Untitled widget"}</span>
      </div>

      <div className="wd-topbar-right">
        {/* The ONE package-state pill (the Send card carries none). In v3
            mode it is F2UP-only — the container the device push uploads — and
            it wears the same words the Send tab's badge and the footer readout
            use for that container ("Ready to send · N B"), because all three
            describe one artifact and a designer comparing them must not have
            to work out that they agree. Legacy tools restore the F2JS branches
            (stale = warning tone, the pill itself the remedy: clicking it
            recompiles). Below 1180px the pill collapses to its short form (the
            footer readout carries the full state). */}
        {!legacy ? (
          f2up ? (
            <Tooltip label="Built from your current source and ready to send to the keyboard.">
              <Badge tone="success" className="wd-nums wd-pkg">
                <span className="wd-pkg-full">{`Ready to send · ${f2up.bytes.toLocaleString()} B`}</span>
                <span className="wd-pkg-mini">{`${f2up.bytes.toLocaleString()} B`}</span>
              </Badge>
            </Tooltip>
          ) : (
            <span className="wd-badge wd-pkg" data-tone="neutral" data-empty="true">
              Not built yet
            </span>
          )
        ) : freshness === "stale" ? (
          <Tooltip label="Package built from earlier source — click to recompile.">
            <button
              type="button"
              className="wd-badge wd-pkg wd-nums"
              data-tone="warning"
              onClick={compile}
              disabled={status === "busy"}
            >
              <span className="wd-dot" data-state="warn" aria-hidden="true" />
              <span className="wd-pkg-full">F2JS · stale</span>
              <span className="wd-pkg-mini">Stale</span>
            </button>
          </Tooltip>
        ) : hasPkg && f2up ? (
          // Both artifacts exist for the current source: both render as
          // segments (F2JS, then the pipeline-terminal F2UP) — which artifact
          // is "current" must never depend on which built last.
          <Tooltip label="F2JS package and F2UP container, both built from the current source.">
            <Badge tone="success" className="wd-nums wd-pkg">
              <span className="wd-pkg-full wd-pkg-seg" data-first="true">{formatArtifact("F2JS", state.f2js!.bytes)}</span>
              <span className="wd-pkg-full wd-pkg-seg">{formatArtifact("F2UP", f2up.bytes)}</span>
              <span className="wd-pkg-mini">{formatArtifact("F2UP", f2up.bytes)}</span>
            </Badge>
          </Tooltip>
        ) : hasPkg ? (
          <Badge tone="success" className="wd-nums wd-pkg">
            <span className="wd-pkg-full">{formatArtifact("F2JS", state.f2js!.bytes)}</span>
            <span className="wd-pkg-mini">{`${state.f2js!.bytes.toLocaleString()} B`}</span>
          </Badge>
        ) : f2up ? (
          // No F2JS build, but the Export tab assembled an F2UP container
          // from the CURRENT source — say so, in the same success tone the
          // Export card uses, so the two never contradict each other.
          <Tooltip label="Widget built on the Send tab. Build F2JS separately for the download path.">
            <Badge tone="success" className="wd-nums wd-pkg">
              <span className="wd-pkg-full">{formatArtifact("F2UP", f2up.bytes)}</span>
              <span className="wd-pkg-mini">{`${f2up.bytes.toLocaleString()} B`}</span>
            </Badge>
          </Tooltip>
        ) : (
          // "No F2JS build", not "No package": the F2UP container above is
          // also a package, and this chip must never appear to deny it.
          <span className="wd-badge wd-pkg" data-tone="neutral" data-empty="true">
            No F2JS build
          </span>
        )}

        {/* Legacy tools ADD the F2JS-era pair as secondary actions — they
            never displace the v3 primary. Assemble F2UP stays the one primary
            action in both modes. */}
        {legacy && (
          <>
            <button
              type="button"
              className="wd-btn"
              data-flash={status === "ok" ? "ok" : status === "fail" ? "fail" : undefined}
              disabled={status === "busy"}
              aria-busy={status === "busy" || undefined}
              onClick={compile}
              style={{ minWidth: 100 }}
            >
              {status === "busy" ? <Spinner /> : status === "ok" ? <Icon name="check" size={14} /> : status === "fail" ? <Icon name="x-circle" size={14} /> : <Icon name="play" size={14} />}
              {status === "busy" ? "Compiling…" : status === "ok" ? "Compiled" : status === "fail" ? "Failed" : "Compile"}
            </button>
            {/* State-aware tooltip: the wrapper span carries the hover
                handlers and the disabled button drops pointer-events, so the
                "why is this disabled" answer is always reachable. */}
            <Tooltip
              label={
                hasPkg
                  ? "Download the most recent .f2js package"
                  : "No F2JS package built yet — Compile first"
              }
            >
              <Button
                className="wd-btn-tippable"
                onClick={actions.downloadF2JS}
                disabled={!hasPkg}
                aria-label="Download package"
              >
                <Icon name="download" size={14} />
                <span className="wd-dl-label">Download</span>
              </Button>
            </Tooltip>
          </>
        )}
        {/* Widget files: Open loads a shared .f1widget.json into the editor
            (same reset path as a preset load), Share downloads the current
            source as one. Sharing SOURCE, never binaries: the recipient's
            Designer re-runs its own pipeline, so a shared file can never
            smuggle stale bytes past the gates. */}
        <Tooltip label="Open a shared widget file (.f1widget.json) — replaces the current source">
          <Button
            className="wd-btn-tippable"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Open widget file"
          >
            <Icon name="folder-open" size={14} />
            <span className="wd-dl-label">Open</span>
          </Button>
        </Tooltip>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = "";
            if (!file) return;
            void actions.openWidget(file).then(
              () => toast({ tone: "success", title: `Opened ${file.name}` }),
              (cause: unknown) =>
                toast({
                  tone: "danger",
                  title: "Could not open widget file",
                  body: (cause as Error).message,
                }),
            );
          }}
        />
        <Tooltip label="Share this widget — downloads its source as a .f1widget.json anyone can Open">
          <Button
            className="wd-btn-tippable"
            onClick={actions.shareWidget}
            aria-label="Share widget"
          >
            <Icon name="share" size={14} />
            <span className="wd-dl-label">Share</span>
          </Button>
        </Tooltip>
        {/* THE primary: assemble the F2UP container — the same shared action
            the Export tab's Assemble stage runs. Disabled (with the blocker
            named) while the script sits outside the device DSL. */}
        <Tooltip
          label={
            !pipeline.dslOk
              ? "Can't build yet — your script has errors. The Send tab explains them."
              : "Build this widget from the live preview, ready to send to your keyboard."
          }
        >
          <button
            type="button"
            className="wd-btn wd-btn-tippable"
            data-variant="primary"
            data-flash={assembleFlash ?? undefined}
            disabled={assemble.busy || !pipeline.dslOk}
            aria-busy={assemble.busy || undefined}
            onClick={assembleNow}
            style={{ minWidth: 128 }}
          >
            {assemble.busy ? <Spinner /> : assembleFlash === "ok" ? <Icon name="check" size={14} /> : assembleFlash === "fail" ? <Icon name="x-circle" size={14} /> : <Icon name="terminal" size={14} />}
            {assemble.busy ? "Building…" : assembleFlash === "ok" ? "Built" : assembleFlash === "fail" ? "Failed" : "Build widget"}
          </button>
        </Tooltip>
        <span aria-hidden="true" className="wd-divider-v" />
        <SettingsMenu />
        <ThemeToggle />
      </div>
    </div>
  );
}
