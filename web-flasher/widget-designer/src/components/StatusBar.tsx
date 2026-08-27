// Footer status bar: quiet, 32px, tokens only. Left — device connection +
// simulator state; right — diagnostics summary + current package size.
// State is visual, never prose: dots and counts, no sentences. Both left and
// right ends are REAL buttons: the device pill opens the Device tab, and the
// issue summary jumps to the Diagnostics accordion (scroll + flash, even when
// it is already open). Severity presentation comes from the one taxonomy in
// diagnosticsView — never restyled locally.

import type { DesignerState } from "../designer/store";
import type { DeviceState } from "../device/useDevice";
import type { WorkspaceTab } from "./Workspace";
import { DeviceIndicator } from "./DeviceIndicator";
import { StatusDot, Tooltip, type StatusDotState } from "./ui";
import { autoTickReadout } from "./AutoTickControl";
import { revealDiagnostics, summarizeIssues, viewDiagnostics } from "./diagnosticsView";
import { revealDeviceBuildStep, useDeviceBuildStatus } from "./deviceBuild";
import { useF2upStatus } from "./f2upStatus";
import { useLegacyTools } from "./legacyTools";
import { formatArtifact, usePackageFreshness } from "./pipeline";

const SIM_DOT: Record<DesignerState["simState"], StatusDotState> = {
  idle: "idle",
  ready: "ok",
  running: "busy",
};

const SIM_LABEL: Record<DesignerState["simState"], string> = {
  idle: "Sim idle",
  ready: "Sim ready",
  running: "Sim running",
};

export function StatusBar({
  state,
  device,
  onNavigate,
}: {
  state: DesignerState;
  device: DeviceState;
  onNavigate: (tab: WorkspaceTab) => void;
}) {
  // Legacy tools off = the v3 story only: the package readout is F2UP-only
  // and the legacy build-verdict error (whose deep link lands on the
  // legacy-only Device build step) stays out of the count.
  const legacy = useLegacyTools();
  // The Device tab's build failure joins the error count through the SAME
  // shared record its callout reads — the pill and the callout clear in one
  // publish and can never disagree. When the only error is device-owned, the
  // pill deep-links to the Device tab's build step (its owner), never to the
  // Design diagnostics rail.
  const deviceBuild = useDeviceBuildStatus(state);
  const issues = summarizeIssues(viewDiagnostics(state), legacy && deviceBuild?.outcome === "failed" ? 1 : 0);
  const openIssues = issues.owner === "device" ? revealDeviceBuildStep : revealDiagnostics;
  const issuesTip = issues.owner === "device" ? "Build failed — open the Device build step" : "Open diagnostics";
  // Package readout: always present, always honest — "No package" until the
  // first build, byte count while fresh, warning-tone "stale" the moment the
  // source moves on. Below 1180px this is the package state's only home (the
  // topbar pill collapses), so it never disappears.
  const freshness = usePackageFreshness(state.js, state.f2js);
  // The F2UP container assembled on the Export tab counts as a package too —
  // the footer must agree with the header chip and the Export card. When BOTH
  // artifacts exist for the current source, both render as segments (F2JS,
  // then the pipeline-terminal F2UP) — never last-write-wins.
  const f2up = useF2upStatus(state);
  const freshF2js = legacy && freshness !== "stale" ? state.f2js : null;
  // v3 mode: F2UP only — the container the device push uploads — and no
  // stale-F2JS branch (the F2JS artifact is a legacy notion). Legacy tools
  // restore the full taxonomy.
  const segments: string[] =
    legacy && freshness === "stale"
      ? ["F2JS · stale"]
      : [
          ...(freshF2js ? [formatArtifact("F2JS", freshF2js.bytes)] : []),
          ...(f2up ? [formatArtifact("F2UP", f2up.bytes)] : []),
        ];
  const pkgLabel =
    segments.length > 0 ? segments.join(" · ") : legacy ? "No F2JS build" : "Not built yet";
  const pkgTip =
    legacy && freshness === "stale"
      ? "Package built from earlier source — open Export to rebuild"
      : freshF2js && f2up
        ? "F2JS package and F2UP container, both from the current source — open the Export tab"
        : freshF2js
          ? "Open the Export tab"
          : f2up
            ? "F2UP container assembled — open the Export tab"
            : legacy
              ? "No F2JS package built yet — open the Export tab"
              : "No F2UP container assembled yet — open the Export tab";

  return (
    <footer className="wd-statusbar">
      <DeviceIndicator device={device} onOpenDeviceTab={() => onNavigate("device")} />
      <span aria-hidden="true" className="wd-divider-v" />
      <span className="wd-statusitem">
        <StatusDot state={SIM_DOT[state.simState]} />
        <span>{SIM_LABEL[state.simState]}</span>
      </span>
      {state.autoTick !== "off" && (
        <span className="wd-statusitem wd-nums text-tertiary">{autoTickReadout(state.autoTick)}</span>
      )}
      <span className="flex-1" />
      <Tooltip label={issuesTip}>
        <button
          type="button"
          className="wd-statusbtn"
          data-tone={issues.tone}
          aria-label={issues.aria}
          onClick={openIssues}
        >
          <StatusDot state={issues.dot} />
          <span className="wd-nums">{issues.label}</span>
        </button>
      </Tooltip>
      <Tooltip label={pkgTip}>
        <button
          type="button"
          className="wd-statusbtn"
          data-tone={legacy && freshness === "stale" ? "warning" : undefined}
          aria-label={`${pkgLabel} — open Export tab`}
          onClick={() => onNavigate("export")}
        >
          {legacy && freshness === "stale" && <StatusDot state="warn" />}
          {segments.length > 1 ? (
            segments.map((s, i) => (
              <span key={s} className="wd-nums wd-pkg-seg" data-first={i === 0 || undefined}>
                {s}
              </span>
            ))
          ) : (
            <span className="wd-nums">{pkgLabel}</span>
          )}
        </button>
      </Tooltip>
    </footer>
  );
}
