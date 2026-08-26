// Export tab — the compile → assemble → push flow presented as ONE connected
// pipeline: a stepnode rail runs down the stage cards, each stage carries its
// own gate/failure callouts, and successful stages mint artifact cards
// (sha, sizes, sections). The Push stage is an explicit handoff to the
// Device tab — the same vocabulary (§4.15 stepper nodes) on both ends.

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { DesignerState, DesignerActions } from "../designer/store";
import type { useDevice } from "../device/useDevice";
import { MQUICKJS_LIMITS } from "../compiler/constants";
import { F2UP_MAX_BYTES } from "../compiler/uploadContainer";
import {
  Badge,
  BudgetMeter,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  IssueBlock,
  KVTable,
  StepNode,
  Tooltip,
  type KVRow,
  type StepState,
} from "./ui";
import { Icon } from "./icons";
import { DeviceIndicator } from "./DeviceIndicator";
import {
  countLabel,
  humanizeDiagnostic,
  revealDeviceTab,
  revealDiagnostics,
  viewDiagnostics,
} from "./diagnosticsView";
import { useF2upStatus, type F2upStatus } from "./f2upStatus";
import { runAssemble, useAssembleStatus } from "./assembleAction";
import { revealDeviceBuildStep, useDeviceBuildStatus, useDeviceEventPreflight } from "./deviceBuild";
import { useLegacyTools } from "./legacyTools";
import { useToast } from "./toast";
import { useCompileAction } from "./useCompileAction";
import { formatArtifact, usePackageFreshness, useScriptPipeline, withStrictHeader } from "./pipeline";

export function CompilerPanel({ state, actions, device }: {
  state: DesignerState;
  actions: DesignerActions;
  /** Owned by App: the Push stage reads the live connection for its handoff. */
  device: ReturnType<typeof useDevice>;
}) {
  const diag = viewDiagnostics(state);
  // Legacy tools off = the v3 rail only (Assemble → Push): the Compile
  // (Build F2JS) stage, the F2EP preflight qualification, and the F2JS
  // budget meter are all legacy-era notions.
  const legacy = useLegacyTools();
  // Asked up front, not discovered by clicking: what can this script do?
  // The probe runs the same strict-simulator and device-DSL gates the real
  // pipeline runs, so a disabled button always names its exact blocker.
  const pipeline = useScriptPipeline(state.js);
  const blocked = diag.simBlocked;
  const build = useCompileAction(state, actions);
  // A package that survived a source change (e.g. a preset switch) is stale:
  // its badge and meta line describe a different widget and must not render.
  const freshness = usePackageFreshness(state.js, state.f2js);
  const freshPkg = freshness === "fresh" ? state.f2js : null;

  // Device-free F2UP assembly: runs the exact push pipeline (capture, measure,
  // per-variant rasters, container) against the live preview and surfaces the
  // result for download/inspection. Invaluable when a pushed widget misrenders:
  // the container can be examined without touching the keyboard.
  //
  // The assembled container lives in the SHARED f2up status (stamped with its
  // source, staleness by comparison) so it survives tab switches and the
  // header pill, footer readout, and this artifact card always agree. The RUN
  // itself is shared too (assembleAction.ts): the topbar's primary Assemble
  // (legacy tools off) and this stage consume one busy/error record, so their
  // spinners and failure messages can never diverge.
  const f2up = useF2upStatus({ html: state.html, css: state.css, js: state.js });
  const { busy: f2upBusy, error: f2upError } = useAssembleStatus({
    html: state.html,
    css: state.css,
    js: state.js,
  });
  // ?f2upGen as VISIBLE UI state: the assemble reads the param at click
  // time, so a pinned generation must never ride along invisibly in the URL —
  // it renders as a pin chip beside the Assemble action, with an explicit
  // "Unpin" that removes the param (back to the default generation 1).
  const [pinnedGen, setPinnedGen] = useState<number | null>(() => {
    const raw = new URLSearchParams(window.location.search).get("f2upGen");
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  });
  const clearPinnedGen = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("f2upGen");
    window.history.replaceState(window.history.state, "", url);
    setPinnedGen(null);
  };
  const assembleF2up = () => {
    if (f2upBusy || !pipeline.dslOk) return;
    void runAssemble(actions, { html: state.html, css: state.css, js: state.js });
  };

  // The Device tab's build verdict for THIS exact source (null when none or
  // stale). One widget must never read green here and red there without the
  // contradiction being named — a fresh Device-side failure surfaces on the
  // Push stage below as a warning that deep-links to its owner.
  const deviceBuild = useDeviceBuildStatus({ html: state.html, css: state.css, js: state.js });
  const deviceBuildFailed = deviceBuild?.outcome === "failed";

  // Pre-flight the STRICTER compiler: the device event pipeline can reject a
  // widget these stages happily build (its markup gate demands direct span
  // children, its DSL is narrower). The probe runs the same static checks the
  // Device tab's event build runs, so a rejection is named right here on the
  // Compile stage — the stepper never shows unqualified green for a widget the
  // device would bounce.
  const preflight = useDeviceEventPreflight({
    html: state.html,
    css: state.css,
    js: state.js,
    rootClass: state.rootClass,
  });
  // Legacy-only qualification: the device EVENT pipeline (F2EP) is a legacy
  // path, so its rejection must not amber-qualify the v3 rail.
  const preflightRejected = legacy && !blocked && preflight.status === "rejected";
  // The Push-stage reconciliation note only earns its place when it says
  // something the Compile-stage pre-flight warning has not already said —
  // i.e. a frames-mode or capture-time failure the static probe cannot see.
  // (Legacy-only too: the verdict it reconciles comes from the legacy-only
  // Device build step, where its deep link lands.)
  const deviceNoteIsNews =
    legacy && deviceBuildFailed && !(preflightRejected && deviceBuild?.mode === "events");

  // ── Stage states (the rail's story) ──────────────────────────────────────
  // UNNUMBERED stages on purpose: Compile (F2JS) and Assemble (F2UP) are
  // independent build paths — either can complete without the other — so the
  // rail shows per-stage status glyphs, never a 1-2-3 order it doesn't enforce.
  // A package the device event pipeline would reject is DONE-BUT-QUALIFIED:
  // the node goes warning-gold, never an unqualified green check sitting on
  // top of an amber "the device will bounce this" callout — stage status and
  // callout always tell the same story.
  const compileState: StepState =
    build.status === "busy" ? "busy"
    : build.status === "fail" ? "failed"
    : freshPkg ? (preflightRejected ? "warning" : "done")
    : blocked ? "pending"
    : "active";
  // One frontier: Assemble reads "active" only once Compile is settled (done —
  // qualified or not — or permanently gated) — the rail should light exactly
  // one next step, even though the Assemble button itself works independently.
  // With legacy tools off the Compile stage does not exist, so it counts as
  // settled and Assemble is the rail's first live step.
  const compileSettled =
    !legacy || compileState === "done" || compileState === "warning" || compileState === "pending";
  const assembleState: StepState =
    f2upBusy ? "busy"
    : f2upError ? "failed"
    : f2up ? "done"
    : !pipeline.dslOk ? "pending"
    : compileSettled ? "active"
    : "pending";
  const dev = device.state;
  const connected = dev.connected !== null;
  const uploaderReady = dev.mquickjs?.runtimeUploader === true;
  const pushReady = connected && (uploaderReady || dev.renderV2?.genericPackages === true);
  const pushState: StepState =
    dev.pushing ? "busy"
    : deviceNoteIsNews ? "warning"
    : pushReady ? "active"
    : "pending";

  return (
    <div className="wd-export">
      <div className="wd-pipe">
        {/* ── Stage · Compile (legacy tools only — the v3 pipeline goes
            straight to Assemble) ────────────────────────────────────────── */}
        {legacy && (
        <PipeStage state={compileState}>
          <Card>
            <CardHeader>
              <div className="wd-stagehead">
                <div>
                  <CardTitle>Compile</CardTitle>
                  <CardDescription>
                    The same binary layout as <span className="font-mono">buildRenderV2MQuickJsPackage()</span> from{" "}
                    <span className="font-mono">f1-widget-sdk</span> — compiled entirely in the browser, no upload, no server.
                  </CardDescription>
                </div>
                <div className="wd-stagehead-badges">
                  {build.status === "busy" ? (
                    <Badge tone="neutral">Building…</Badge>
                  ) : freshPkg && preflightRejected ? (
                    // Qualified success: the badge carries the caveat the
                    // warning callout below explains, in the same gold as the
                    // stage node — never a green chip contradicting an amber
                    // "the device will reject this" one card-height away.
                    <Tooltip label="Compiled for the preview, but the device event pipeline rejects this widget — see the warning below.">
                      <Badge tone="warning" className="wd-nums">
                        {formatArtifact("F2JS", freshPkg.bytes)} · preview only
                      </Badge>
                    </Tooltip>
                  ) : freshPkg ? (
                    <Badge tone="success" className="wd-nums">{formatArtifact("F2JS", freshPkg.bytes)}</Badge>
                  ) : state.f2js && freshness === "stale" ? (
                    <Tooltip label="The last package was built from earlier source — rebuild to refresh it.">
                      <Badge tone="warning">Stale</Badge>
                    </Tooltip>
                  ) : blocked ? (
                    <Badge tone="info">Blocked</Badge>
                  ) : null}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                {/* Secondary on purpose: the topbar Compile owns the one primary
                    slot; this is the same action surfaced in context. The topbar
                    pill is the package-state indicator — no second pill here,
                    and no Download here either: the topbar's Download is the
                    ONE download affordance (one affordance per action).
                    No tooltip: the card description and the blocked callout
                    below already carry everything a bubble would restate. */}
                <Button
                  onClick={() => void build.run()}
                  busy={build.status === "busy"}
                  disabled={blocked}
                  data-flash={build.status === "ok" ? "ok" : build.status === "fail" ? "fail" : undefined}
                >
                  {build.status === "busy" ? null : build.status === "ok" ? <Icon name="check" size={14} /> : <Icon name="play" size={14} />}
                  {build.status === "busy" ? "Building…" : "Build F2JS"}
                </Button>
              </div>
              {/* The blocked condition is the same informational notice the
                  Inspector and footer show — info tone, info icon, ONE block. */}
              {blocked && (
                <IssueBlock
                  tone="info"
                  summary={buildBlockedSummary(pipeline)}
                  detail={[pipeline.simError, pipeline.prefixedSimError]
                    .filter(Boolean)
                    .join("\n")}
                >
                  {/* The header remedy renders ONLY when the header alone fixes
                      the parse — never for unrelated DSL violations. */}
                  {pipeline.strictHeaderWouldFix && (
                    <>
                      <button
                        type="button"
                        className="wd-callout-link"
                        onClick={() => actions.setJs(withStrictHeader(state.js))}
                      >
                        Add the “use strict” header
                      </button>
                      <span aria-hidden="true"> · </span>
                    </>
                  )}
                  <button type="button" className="wd-callout-link" onClick={revealDiagnostics}>
                    View diagnostics
                  </button>
                </IssueBlock>
              )}
              {!blocked && build.status === "fail" && build.failure && (
                <IssueBlock
                  tone="danger"
                  summary={`Build failed: ${humanizeDiagnostic(build.failure)}`}
                  detail={build.failure}
                  copyText={build.failure}
                >
                  <button type="button" className="wd-callout-link" onClick={revealDiagnostics}>
                    View diagnostics
                  </button>
                </IssueBlock>
              )}
              {/* Pre-flight verdict from the DEVICE event compiler: this stage
                  can build green while that stricter pipeline rejects the same
                  widget. Qualify the green here, at compile time — never let
                  the user discover it on the Device tab. */}
              {preflightRejected && preflight.error && (
                <IssueBlock
                  tone="warning"
                  summary={`Builds for preview, but the device event pipeline will reject it — ${humanizeDiagnostic(preflight.error)}`}
                  detail={preflight.error}
                >
                  <button type="button" className="wd-callout-link" onClick={revealDeviceBuildStep}>
                    Open the Device build step
                  </button>
                </IssueBlock>
              )}
              {freshPkg && (
                <ArtifactCard
                  format="F2JS"
                  name="FRMRv2MJS package"
                  bytes={freshPkg.bytes}
                  rows={[
                    { key: "SHA-256", value: <ShaValue sha={freshPkg.sha256} />, mono: true },
                    { key: "Generation", value: <span className="wd-nums">{freshPkg.generation}</span> },
                    {
                      key: "Source",
                      value: <span className="wd-nums">{freshPkg.budget.sourceBytes.toLocaleString()} B strict F2JS</span>,
                    },
                    {
                      key: "Events",
                      value: (
                        <span className="wd-nums">
                          {freshPkg.budget.events} records
                          <span className="wd-kv-dim">
                            {" "}· {freshPkg.events.keyCount} key, {freshPkg.events.chordCount} chord
                          </span>
                        </span>
                      ),
                    },
                    { key: "DOM targets", value: <span className="wd-nums">{freshPkg.budget.targets}</span> },
                  ]}
                />
              )}
            </CardContent>
          </Card>
        </PipeStage>
        )}

        {/* ── Stage · Assemble ──────────────────────────────────────────── */}
        <PipeStage state={assembleState}>
          <Card>
            <CardHeader>
              <div className="wd-stagehead">
                <div>
                  <CardTitle>Assemble</CardTitle>
                  <CardDescription>
                    Wraps the runtime, facade and base frame into the <span className="font-mono">F2UP</span> container
                    that the device push uploads — assembled from the live preview, no keyboard needed.
                  </CardDescription>
                </div>
                <div className="wd-stagehead-badges">
                  {f2upBusy ? (
                    <Badge tone="neutral">Assembling…</Badge>
                  ) : f2up ? (
                    <Badge tone="success" className="wd-nums">{formatArtifact("F2UP", f2up.bytes)}</Badge>
                  ) : !pipeline.dslOk ? (
                    <Badge tone="info">Blocked</Badge>
                  ) : null}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                {/* No tooltip — the card description says what Assemble does,
                    and the gate callout below names any blocker. */}
                <Button onClick={assembleF2up} busy={f2upBusy} disabled={!pipeline.dslOk}>
                  {!f2upBusy && <Icon name="terminal" size={14} />}
                  {f2upBusy ? "Assembling…" : "Assemble F2UP"}
                </Button>
                {/* The ?f2upGen pin, surfaced: an invisible URL param must not
                    silently steer what Assemble builds. */}
                {pinnedGen !== null && (
                  <span className="inline-flex items-center gap-1">
                    <Tooltip label="Device-bound assemblies pass ?f2upGen=<running+1> in the URL; this assembly is pinned to that generation.">
                      <Badge tone="accent" className="wd-nums">
                        Generation pinned · {pinnedGen.toLocaleString()}
                      </Badge>
                    </Tooltip>
                    <Button variant="ghost" size="sm" onClick={clearPinnedGen} aria-label={`Unpin generation ${pinnedGen}`}>
                      Unpin
                    </Button>
                  </span>
                )}
              </div>
              {/* Pre-flight gate: the same transpile the assembler would run, so
                  the raw parser dump never becomes the first thing a user sees.
                  Info tone on purpose — "unavailable" is an availability notice
                  (like the Compile gate above), not a counted warning. */}
              {!pipeline.dslOk && (
                <IssueBlock
                  tone="info"
                  summary={
                    `Assemble unavailable — ${humanizeDiagnostic(pipeline.dslErrors[0])}` +
                    (pipeline.dslErrors.length > 1
                      ? ` (+ ${countLabel(pipeline.dslErrors.length - 1, "more issue")})`
                      : "")
                  }
                  detail={pipeline.dslErrors.join("\n\n")}
                />
              )}
              {/* A real assemble attempt failed at runtime (capture/measure/…):
                  one danger block — summary first, full compiler text behind the
                  disclosure, never duplicated anywhere else on this screen. */}
              {pipeline.dslOk && f2upError && (
                <IssueBlock
                  tone="danger"
                  summary={`Assemble failed: ${humanizeDiagnostic(f2upError)}`}
                  detail={f2upError}
                  copyText={f2upError}
                />
              )}
              {f2up && (
                <ArtifactCard
                  format="F2UP"
                  name="Widget upload container"
                  bytes={f2up.bytes}
                  rows={[
                    { key: "SHA-256", value: <ShaValue sha={f2up.sha256} />, mono: true },
                    ...(f2up.generation !== undefined
                      ? [{ key: "Generation", value: <span className="wd-nums">{f2up.generation}</span> } satisfies KVRow]
                      : []),
                  ]}
                >
                  {f2up.sections && <SectionMap total={f2up.bytes} sections={f2up.sections} legacy={legacy} />}
                </ArtifactCard>
              )}
              {f2up?.base64 && <F2upDump sha256={f2up.sha256} base64={f2up.base64} />}
            </CardContent>
          </Card>
        </PipeStage>

        {/* ── Stage · Push (handoff to the Device tab) ──────────────────── */}
        <PipeStage state={pushState}>
          <Card>
            <CardHeader>
              <div className="wd-stagehead">
                <div>
                  <CardTitle>Push</CardTitle>
                  <CardDescription>
                    Hand the widget to a Framer F1 over WebHID. The device names the target generation; the push
                    re-assembles from the live preview so all three artifacts agree.
                  </CardDescription>
                </div>
                <div className="wd-stagehead-badges">
                  <DeviceIndicator device={dev} onOpenDeviceTab={revealDeviceTab} />
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Button onClick={revealDeviceTab}>
                  <Icon name="keyboard" size={14} />
                  Open Device tab
                </Button>
              </div>
              {/* Reconciliation with the Device tab's build path — but only
                  when it adds NEWS: an events-mode failure the Compile-stage
                  pre-flight already named must not repeat itself down here.
                  What remains are frames-mode and capture-time failures the
                  static probe cannot see. */}
              {deviceNoteIsNews && deviceBuild && (
                <IssueBlock
                  tone="warning"
                  summary={`Device package build failed — ${humanizeDiagnostic(deviceBuild.error ?? "the device compiler rejected this widget.")} The F2JS and F2UP artifacts above are unaffected.`}
                >
                  <button type="button" className="wd-callout-link" onClick={revealDeviceBuildStep}>
                    Open the Device build step
                  </button>
                </IssueBlock>
              )}
              {connected ? (
                <KVTable
                  rows={[
                    {
                      key: "Admission",
                      value: uploaderReady ? (
                        <span>
                          mquickjs uploader <span className="font-mono text-xs">uploader=1</span>
                          <span className="wd-kv-dim"> · persists to the widget flash slot</span>
                        </span>
                      ) : dev.renderV2?.genericPackages ? (
                        <span>
                          Generic render-v2 packages<span className="wd-kv-dim"> · RAM scene store</span>
                        </span>
                      ) : dev.renderV2?.present ? (
                        <span>
                          Pinned package only<span className="wd-kv-dim"> · this build admits no arbitrary pushes</span>
                        </span>
                      ) : (
                        <span className="wd-kv-dim">No render-v2 scene RPC</span>
                      ),
                    },
                    {
                      key: "Running generation",
                      value: <span className="wd-nums">{dev.committedGeneration.toLocaleString()}</span>,
                    },
                    ...(dev.renderV2?.maxBundleBytes != null
                      ? [{
                          key: "Bundle ceiling",
                          value: <span className="wd-nums">{dev.renderV2.maxBundleBytes.toLocaleString()} B</span>,
                        } satisfies KVRow]
                      : []),
                  ]}
                />
              ) : (
                <p className="text-xs text-tertiary">
                  No keyboard connected yet — the pipeline ends at a Framer F1 over WebHID. Connect and identify on the
                  Device tab; this stage lights up when the device admits pushes.
                </p>
              )}
            </CardContent>
          </Card>
        </PipeStage>
      </div>

      {/* ── Right rail: budgets + provenance ───────────────────────────── */}
      <aside className="wd-export-rail" aria-label="Budgets and pipeline notes">
        <Card>
          <CardHeader>
            <CardTitle>Budget</CardTitle>
            <CardDescription>
              The engine's hard caps plus the <span className="font-mono">F2UP</span> upload ceiling.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Budgets state={state} f2up={f2up} legacy={legacy} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>What this does</CardTitle></CardHeader>
          <CardContent className="text-sm text-secondary leading-relaxed">
            {legacy ? (
              <ul className="list-disc pl-5 space-y-1.5">
                <li>Compiles the F1SC CSS subset into a fixed-glyph scene (col, row, glyph, color, glow).</li>
                <li>Emits a MicroQuickJS bundle for the <span className="font-mono">widget on / getInt / setInt / commit / isHeld</span> surface.</li>
                <li>Wraps the scene + runtime into a single <span className="font-mono">FRMRv2MJS</span> F2JS blob.</li>
                <li>Round-trips with the SDK's <span className="font-mono">decodeRenderV2MQuickJsPackage()</span>.</li>
              </ul>
            ) : (
              <ul className="list-disc pl-5 space-y-1.5">
                <li>Transpiles the widget DSL (<span className="font-mono">widget.on / getInt / setInt / commit</span>) for the on-device MicroQuickJS engine.</li>
                <li>Captures the live preview into an <span className="font-mono">F2TF</span> facade with its pre-rendered pixels.</li>
                <li>Wraps runtime, facade, and the compressed base frame into one <span className="font-mono">F2UP</span> container.</li>
                <li>The device push streams that container over the mquickjs uploader and persists it to the widget flash slot.</li>
              </ul>
            )}
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}

/** One pipeline stage: status node rail on the left, the stage card at right.
 *  Unnumbered — the node carries state, never an order the flow doesn't
 *  enforce. The rail line bridges the inter-card gap; :last-child hides it. */
function PipeStage({ state, children }: { state: StepState; children: ReactNode }) {
  return (
    <section className="wd-pipe-stage" data-state={state}>
      <div className="wd-pipe-rail" aria-hidden="true">
        <StepNode state={state} />
        <span className="wd-pipe-line" />
      </div>
      <div className="wd-pipe-body">{children}</div>
    </section>
  );
}

/** One-line summary for the Build gate, specific to WHY the simulator balks:
 *  missing header (fixable), preview-only widget API, or the actual error. */
function buildBlockedSummary(pipeline: ReturnType<typeof useScriptPipeline>): string {
  if (pipeline.strictHeaderWouldFix) {
    return "Build unavailable — this script is missing the strict F2JS header (“use strict”).";
  }
  const deep = pipeline.prefixedSimError ?? pipeline.simError;
  const api = deep && /(widget\.\w+) is not a function/.exec(deep);
  if (api) {
    return `Build unavailable — this example uses ${api[1]}, a preview-only API the strict simulator doesn’t provide. The live preview still renders it.`;
  }
  return `Build unavailable — ${humanizeDiagnostic(deep ?? "the simulator can’t parse this script.")}`;
}

/** A build output presented like a CI artifact row: format chip + byte count
 *  in an inset head bar, then KV facts (sha, generation, sizes) and any
 *  extras (section map, byte dump). */
function ArtifactCard({
  format,
  name,
  bytes,
  rows,
  children,
}: {
  format: string;
  name: string;
  bytes: number;
  rows: KVRow[];
  children?: ReactNode;
}) {
  return (
    <div className="wd-artifact">
      <div className="wd-artifact-head">
        <span className="wd-artifact-format">{format}</span>
        <span className="wd-artifact-name">{name}</span>
        <span className="wd-artifact-size">{bytes.toLocaleString()} B</span>
      </div>
      <div className="wd-artifact-body">
        <KVTable rows={rows} />
        {children}
      </div>
    </div>
  );
}

/** Full sha rendered mono + truncated with a copy affordance — the value the
 *  device logs pin against is always one click away. Success swaps the icon
 *  to a check (announced via the live region); a clipboard REJECTION is never
 *  silent — it lands as a toast naming the manual path out. */
function ShaValue({ sha }: { sha: string }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(sha);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({
        tone: "danger",
        title: "Copy failed",
        body: "The browser blocked clipboard access — select the SHA-256 text and copy it manually.",
      });
    }
  };
  return (
    <>
      <span className="wd-artifact-sha" title={sha}>{sha}</span>
      <Tooltip label={copied ? "Copied" : "Copy SHA-256"}>
        <button type="button" className="wd-iconbtn" onClick={copy} aria-label="Copy SHA-256">
          <Icon name={copied ? "check" : "copy"} size={13} />
        </button>
      </Tooltip>
      <span className="sr-only" role="status">{copied ? "Copied" : ""}</span>
    </>
  );
}

/** Proportional section map of the F2UP container: header, runtime, facade,
 *  compressed base frame — the "what is actually in these bytes" answer.
 *  Every nonzero slice keeps a 5px minimum (hairline gaps between), so every
 *  legend swatch has a findable counterpart in the bar; each slice carries a
 *  title naming itself. Legend rows render name · annotation as IDENTICAL
 *  flex tokens with one shared gap — one dot rhythm across all four rows. */
function SectionMap({
  total,
  sections,
  legacy = false,
}: {
  total: number;
  sections: NonNullable<F2upStatus["sections"]>;
  /** Legacy tools restore the F2JS-era section name; v3 speaks plainly. */
  legacy?: boolean;
}) {
  const header = Math.max(0, total - sections.f2js.bytes - sections.f2tf.bytes - sections.lzss.bytes);
  const slices = [
    { id: "header", label: "Header + alignment", bytes: header, meta: null as { text: string; mono: boolean } | null },
    { id: "f2js", label: legacy ? "F2JS runtime" : "Widget runtime (mquickjs)", bytes: sections.f2js.bytes, meta: { text: sections.f2js.sha256.slice(0, 8), mono: true } },
    { id: "f2tf", label: "F2TF facade", bytes: sections.f2tf.bytes, meta: { text: sections.f2tf.sha256.slice(0, 8), mono: true } },
    {
      id: "lzss",
      label: "Base frame (LZSS)",
      bytes: sections.lzss.bytes,
      meta: { text: `${sections.lzss.decompressedBytes.toLocaleString()} B decompressed`, mono: false },
    },
  ];
  return (
    <div className="wd-secmap">
      <div
        className="wd-secmap-bar"
        role="img"
        aria-label={`Container sections: ${slices.map((s) => `${s.label} ${s.bytes.toLocaleString()} bytes`).join(", ")}`}
      >
        {slices.map((s) => (
          <span
            key={s.id}
            data-sec={s.id}
            style={{ flexGrow: Math.max(s.bytes, 1) }}
            title={`${s.label} — ${s.bytes.toLocaleString()} B`}
          />
        ))}
      </div>
      <div className="wd-secmap-legend">
        {slices.map((s) => (
          <div key={s.id} className="wd-secmap-row">
            <span className="wd-secmap-swatch" data-sec={s.id} aria-hidden="true" />
            <span className="wd-secmap-label">
              <span className="wd-secmap-name">{s.label}</span>
              {s.meta && (
                <>
                  <span className="wd-secmap-sep" aria-hidden="true">·</span>
                  <span className={s.meta.mono ? "wd-secmap-meta font-mono" : "wd-secmap-meta"}>
                    {s.meta.text}
                  </span>
                </>
              )}
            </span>
            <span className="wd-secmap-bytes">{s.bytes.toLocaleString()} B</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The container byte dump. The `#f2up-base64` id, `data-sha256` attribute,
 * and content are protocol surface (external tooling reads them) — only the
 * chrome around the <pre> is styled: an exact-line-multiple collapsed height,
 * a copy button, and an expander, so no base64 line is ever sliced mid-glyph.
 */
function F2upDump({ sha256, base64 }: { sha256: string; base64: string }) {
  const toast = useToast();
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  // Measured, not assumed: the fade mask and the toggle render only when the
  // dump actually overflows its 6-line fold at the current width.
  const [overflows, setOverflows] = useState(false);
  const preRef = useRef<HTMLPreElement | null>(null);
  const copyTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(copyTimer.current), []);
  useEffect(() => {
    const el = preRef.current;
    if (!el) return;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [base64, expanded]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(base64);
      setCopied(true);
      window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({
        tone: "danger",
        title: "Copy failed",
        body: "The browser blocked clipboard access — expand the dump and select the text manually.",
      });
    }
  };
  return (
    <div className="wd-codeblock">
      <div className="wd-codeblock-head">
        <span className="wd-overline">F2UP · base64</span>
        <span className="inline-flex items-center gap-2">
          {/* One control, one visual class in BOTH states — only the label
              and the chevron rotation change, never the button's weight. */}
          {(overflows || expanded) && (
            <button
              type="button"
              className="wd-disclose wd-codeblock-toggle"
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
            >
              <Icon name="chevron-right" size={12} className="wd-disclose-chevron" />
              {expanded ? "Collapse" : "Show all"}
            </button>
          )}
          <Tooltip label={copied ? "Copied" : "Copy base64"}>
            <button type="button" className="wd-iconbtn" onClick={copy} aria-label="Copy base64">
              <Icon name={copied ? "check" : "copy"} size={14} />
            </button>
          </Tooltip>
          <span className="sr-only" role="status">{copied ? "Copied" : ""}</span>
        </span>
      </div>
      <pre
        ref={preRef}
        id="f2up-base64"
        data-sha256={sha256}
        data-expanded={expanded || undefined}
        data-clipped={(!expanded && overflows) || undefined}
        className="wd-codeblock-body"
      >
        {base64}
      </pre>
    </div>
  );
}

/** Every meter names the ARTIFACT its cap governs: "F2JS package" (legacy
 *  tools only) is the compiled blob against the device staging budget, "F2UP
 *  upload" is the assembled container against the upload ceiling — after
 *  Assemble, the row that fills is the artifact the push actually sends.
 *  Unbuilt artifacts show explicit empties, never zeros. */
function Budgets({ state, f2up, legacy }: { state: DesignerState; f2up: F2upStatus | null; legacy: boolean }) {
  const srcBytes = new Blob([state.html + "\n" + state.css + "\n" + state.js]).size;
  // A stale package's size is not this widget's budget — show explicit empty.
  const freshness = usePackageFreshness(state.js, state.f2js);
  const pkgBytes = freshness === "fresh" && state.f2js ? state.f2js.bytes : null;
  return (
    <div className="wd-meters">
      {legacy && (
        <BudgetMeter label="F2JS package" value={pkgBytes} cap={MQUICKJS_LIMITS.packageBytes} />
      )}
      <BudgetMeter label="F2UP upload" value={f2up ? f2up.bytes : null} cap={F2UP_MAX_BYTES} />
      <BudgetMeter label="Source" value={srcBytes} cap={MQUICKJS_LIMITS.sourceBytes} />
      <BudgetMeter label="Events" value={state.handlers.length} cap={MQUICKJS_LIMITS.eventRecords} />
      <BudgetMeter label="DOM targets" value={state.targets.length} cap={MQUICKJS_LIMITS.targets} />
    </div>
  );
}
