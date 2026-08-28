// Device tab — the connect → identify → build → push workflow. Connection
// state speaks through the one device pill (§4.9), the build→push flow is a
// vertical stepper (§4.15), gates and failures are proper callouts (never
// bare red prose), and every RPC milestone streams into the session-log rail.
//
// Identification is definitive: the mquickjs capability page 1 advertises the
// base-app SHA-256, which maps to the firmware catalog.

import { useEffect, useRef, useState } from "react";
import type { DesignerState, DesignerActions } from "../designer/store";
import { useDevice } from "../device/useDevice";
import { normalizeSha16, recordSlotPush, useSlotRegistry } from "../device/slotRegistry";
import {
  Badge,
  Button,
  Callout,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  IssueBlock,
  KVTable,
  SegmentedControl,
  Stepper,
  type StepState,
} from "./ui";
import { Icon } from "./icons";
import { DeviceIndicator } from "./DeviceIndicator";
import { ScreensPanel } from "./ScreensPanel";
import { DEVICE_BUILD_PREFIX, humanizeDiagnostic } from "./diagnosticsView";
import {
  consumeDeviceBuildReveal,
  explainDeviceBuildFailure,
  onRevealDeviceBuildStep,
  publishDeviceBuild,
  useDeviceBuildStatus,
  useDeviceEventPreflight,
  type DeviceBuildMode,
} from "./deviceBuild";
import { formatArtifact, usePackageFreshness } from "./pipeline";
import { canInstallFirmware, installWidgetFirmware } from "../device/firmwareInstall";
import { useLegacyTools } from "./legacyTools";
import { useToast } from "./toast";

type FrameChoice = "1" | "5" | "10" | "20";

/** The chooser rejection connectFramer surfaces when the user dismisses the
 *  WebHID prompt without picking a device. */
const CHOOSER_DISMISSED = /Select exactly one Framer F1/i;

/** Set when the user abandons a pending connect from the UI — module scope so
 *  a tab switch mid-chooser can't leak the stale rejection back as an error. */
let connectCancelledAt = 0;

/** Where this Designer's users get the firmware.
 *
 *  A widget cannot reach a keyboard that is not running the Widget Designer
 *  build, so this link is load-bearing, not a footnote: if it 404s, a new
 *  user with stock firmware has no way forward. It resolves in three steps so
 *  it is correct in every place this app actually runs:
 *
 *    1. `window.__WD_FLASHER_URL__` — set it in a <script> beside the bundle
 *       to point at a flasher hosted somewhere else entirely. Nothing has to
 *       be rebuilt to repoint it.
 *    2. localhost — the two Vite apps run on separate dev ports.
 *    3. `./flasher/` — the shipped hosting layout (docs/19): the Designer at
 *       the site root with the flasher published beneath it, so one domain is
 *       self-sufficient and the link is same-origin.
 *
 *  Deliberately NOT `../`: that only worked while the Designer was served from
 *  a subdirectory of the flasher, and silently pointed at the parent domain
 *  once the Designer got its own hostname. */
declare global {
  interface Window {
    __WD_FLASHER_URL__?: string;
  }
}

const FLASHER_URL =
  typeof window !== "undefined" && typeof window.__WD_FLASHER_URL__ === "string"
    ? window.__WD_FLASHER_URL__
    : typeof window !== "undefined" && window.location.hostname === "localhost"
      ? "http://localhost:5173/"
      : "./flasher/";

/** The one canonical remedy link for "this firmware can't do widgets": the
 *  flasher's Widget Designer (multi-widget) card writes the exact pinned
 *  bytes this app is built against. */
function FlashFirmwareLink() {
  return (
    <a
      className="wd-callout-link"
      href={FLASHER_URL}
      target="_blank"
      rel="noreferrer"
    >
      open the web flasher
    </a>
  );
}

/** Screen 28 is widget slot 0, 29 is slot 1, and so on — one widget, one
 *  keyboard screen (docs/17). Everything numbered below it belongs to the
 *  keyboard's own software, and that split is the only thing about the screen
 *  numbering a designer ever needs: this screen can hold my widget, that one
 *  can't. */
const FIRST_WIDGET_SCREEN = 28;

/** What we know about the widget screen behind a chip: `null` when the slot
 *  bank has not been swept (the Screens panel owns that sweep), otherwise
 *  whether something is stored there and what it is called locally. */
type ScreenOccupant = { name: string | null; occupied: boolean };

/** What to CALL a screen, so the roster reads as places on a keyboard rather
 *  than as the protocol's indices. A widget screen wears the name of the
 *  widget standing in it whenever we know it, and its position otherwise. The
 *  raw id is not thrown away — it rides in the tooltip, where it answers a
 *  support question without ever being something the designer must decode. */
function describeScreen(
  screenId: number,
  roster: readonly number[],
  occupantOf: (screenId: number) => ScreenOccupant | null,
): { label: string; title: string } {
  if (screenId >= FIRST_WIDGET_SCREEN) {
    const position = screenId - FIRST_WIDGET_SCREEN + 1;
    const occupant = occupantOf(screenId);
    const where = `Widget screen ${position} (screen id ${screenId})`;
    if (occupant?.name) return { label: occupant.name, title: `${occupant.name} — ${where}` };
    return {
      label: `Widget screen ${position}`,
      title:
        occupant === null ? where
        : occupant.occupied ? `${where} — holds a widget that wasn't sent from this computer, so there's no name for it here`
        : `${where} — empty`,
    };
  }
  // Stock screens: the keyboard advertises that they exist, never what they
  // are, so numbering them by position is the most honest label available —
  // and the only fact that matters is that a widget can't go there.
  const position = roster.filter((id) => id < FIRST_WIDGET_SCREEN).indexOf(screenId) + 1;
  return {
    label: `Built-in screen ${position}`,
    title: `A screen the keyboard's own software owns — widgets don't go here (screen id ${screenId})`,
  };
}

/** Install the firmware, in place, from the callout that explains why it is
 *  needed. This is the whole point of having it here: the alternative was
 *  sending someone to a second website mid-task, and a keyboard that cannot
 *  receive widgets is the one state where the Designer is useless to them.
 *
 *  Consent is explicit and the risky window is named. The browser's own port
 *  picker is the second gate — nothing is written until the user chooses the
 *  keyboard there. */
function InstallFirmwareButton({ device }: { device: ReturnType<typeof useDevice> }) {
  const [phase, setPhase] = useState<"idle" | "installing" | "done" | "failed">("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [writing, setWriting] = useState(false);
  const support = canInstallFirmware();

  if (!support.ok) {
    return <div className="text-xs text-tertiary">{support.reason}</div>;
  }

  const run = async () => {
    setPhase("installing");
    setProgress(0);
    setError("");
    setWriting(false);
    try {
      await installWidgetFirmware(device.client(), {
        onProgress: setProgress,
        onLog: (line) => device.appendLog(line),
        onWriteStart: () => setWriting(true),
      });
      setPhase("done");
    } catch (cause) {
      const message = (cause as Error).message;
      // A dismissed port picker is a choice, not a failure — say so plainly
      // instead of showing an error for something the user meant to do.
      const cancelled = /No port selected|cancell?ed|user gesture/i.test(message);
      setError(cancelled ? "" : message);
      setPhase(cancelled ? "idle" : "failed");
      if (!cancelled) device.appendLog(`Firmware install failed: ${message}`);
    }
  };

  if (phase === "done") {
    return (
      <div className="space-y-2">
        <div className="text-xs" style={{ color: "var(--wd-success, inherit)" }}>
          Firmware installed. Unplug the keyboard and plug it back in, then press
          Connect again — it will be ready for widgets.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <Button variant="primary" size="sm" onClick={() => void run()} busy={phase === "installing"}>
          {phase !== "installing" && <Icon name="download" size={14} />}
          {phase === "installing"
            ? writing
              ? `Updating… ${Math.round(progress * 100)}%`
              : "Preparing…"
            : phase === "failed"
              ? "Try updating again"
              : "Update this keyboard"}
        </Button>
        {phase === "installing" && writing && (
          <span className="text-xs text-tertiary">
            Keep the keyboard plugged in until this finishes.
          </span>
        )}
      </div>
      {phase === "idle" && (
        <div className="text-xs text-tertiary">
          Your keyboard restarts into update mode, then the browser asks which
          device to write to — pick the keyboard when the prompt appears.
        </div>
      )}
      {error && (
        <IssueBlock
          tone="danger"
          summary={`Couldn't update the keyboard: ${humanizeDiagnostic(error)}`}
          detail={error}
        />
      )}
    </div>
  );
}

/** macOS blocks writes to any HID device that also acts as a keyboard until
 *  Chrome is granted Input Monitoring. The device connects, so nothing looks
 *  wrong, and then every write is refused — a dead end nobody can guess their
 *  way out of. When the transport reports that exact cause, show the fix as
 *  steps rather than burying it in an error string.
 *
 *  The quit-and-reopen step is the one people miss: the permission only takes
 *  effect in a freshly launched Chrome, so a reload leaves it still failing. */
function InputMonitoringHelp({ detail, onRetry }: { detail: string; onRetry: () => void }) {
  return (
    <Callout tone="warning">
      <div className="space-y-2">
        <div className="font-medium">macOS is blocking Chrome from talking to your keyboard</div>
        <div className="text-xs">
          Your keyboard is also a keyboard, and macOS protects those. Chrome can see it but
          can't send to it until you allow this — it takes about 20 seconds:
        </div>
        <ol className="text-xs space-y-1" style={{ listStyle: "decimal", paddingLeft: "1.2em" }}>
          <li>Open <strong className="font-medium">System Settings → Privacy &amp; Security → Input Monitoring</strong></li>
          <li>Turn on <strong className="font-medium">Google Chrome</strong> (not listed? click + and add it)</li>
          <li><strong className="font-medium">Quit Chrome completely</strong> (⌘Q) and open it again — reloading isn't enough</li>
          <li>Come back and connect</li>
        </ol>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="primary" size="sm" onClick={onRetry}>
            <Icon name="cable" size={14} />
            Try connecting again
          </Button>
        </div>
        <details className="text-xs text-tertiary">
          <summary>What the keyboard reported</summary>
          <div className="wd-nums" style={{ wordBreak: "break-word" }}>{detail}</div>
        </details>
      </div>
    </Callout>
  );
}

export function DevicePanel({ state, actions, device }: {
  state: DesignerState;
  actions: DesignerActions;
  /** Hoisted to Workspace: the HID connection must survive tab switches. */
  device: ReturnType<typeof useDevice>;
}) {
  const toast = useToast();
  // Legacy tools off = the v3 story only: no "Build package" step (event
  // program / frame capture are render-v2 notions), and the one push path is
  // the mquickjs uploader.
  const legacy = useLegacyTools();
  const [building, setBuilding] = useState(false);
  const [frameCount, setFrameCount] = useState<number>(1);
  // Event-driven is the PREFERRED default: it is the only mode whose package
  // reacts to input on the device. But a pre-selected mode that is guaranteed
  // to fail is worse than the fallback — so the default ADAPTS: the static
  // pre-flight runs the same gates the event compiler runs, and when it
  // rejects this widget the panel pre-selects Frames (the mode that can
  // complete) and names the compiler's objection in a callout right at the
  // mode picker. An explicit user choice wins, scoped to the exact source it
  // was made for — a preset switch re-evaluates the default.
  const preflight = useDeviceEventPreflight({
    html: state.html,
    css: state.css,
    js: state.js,
    rootClass: state.rootClass,
  });
  const sourceKey = `${state.rootClass} ${state.html} ${state.css} ${state.js}`;
  const sourceKeyRef = useRef(sourceKey);
  sourceKeyRef.current = sourceKey;
  const [modeChoice, setModeChoice] = useState<{ key: string; mode: DeviceBuildMode } | null>(null);

  // The build verdict lives in the SHARED deviceBuild status, stamped with
  // the source it ran against — the failed step badge, the failure callout,
  // the footer error pill, and the Export tab's Push note all read this one
  // record, so they survive tab switches together and clear together.
  const buildStatus = useDeviceBuildStatus({ html: state.html, css: state.css, js: state.js });

  // Auto default resolution, in priority order: a surviving FAILED verdict
  // adopts its own mode (the callout it feeds must stay visible after tab
  // navigation — the footer counts it, so a surface must show it), then the
  // pre-flight rejection steers to Frames, else Event-driven.
  const autoMode: DeviceBuildMode =
    buildStatus?.outcome === "failed" ? buildStatus.mode
    : preflight.status === "rejected" ? "frames"
    : "events";
  const mode: DeviceBuildMode = modeChoice?.key === sourceKey ? modeChoice.mode : autoMode;
  const setMode = (next: DeviceBuildMode) => setModeChoice({ key: sourceKeyRef.current, mode: next });

  // …and scoped to the CURRENT build mode for everything this step renders:
  // switching Event-driven ↔ Frames must clear the step's done state and its
  // artifact chips, because a chip minted by the OTHER mode beside this mode's
  // build button would claim a package that mode never produced. A SUCCESS
  // verdict survives in the shared record and returns with its mode; a FAILED
  // verdict is dropped outright on mode switch (see changeMode) — its context
  // is gone, so the footer error pill and this step's callout clear together.
  const modeBuild = buildStatus && buildStatus.mode === mode ? buildStatus : null;

  // User-driven mode change. A failed verdict feeds the footer "1 error" pill
  // through the same shared record as this step's callout — when switching
  // mode hides the callout, the record must die in the SAME gesture, or the
  // footer keeps counting an error no surface can show anymore. (The deep-link
  // reveal sets mode via setMode directly: it ADOPTS a failed verdict's mode
  // to show it, so it must not pass through here.)
  const changeMode = (next: DeviceBuildMode) => {
    if (next !== mode && buildStatus?.outcome === "failed") publishDeviceBuild(null);
    setMode(next);
  };

  // Post-build diagnostics are read through a ref: the store's state updates
  // land after the compile promise resolves, so build() waits a tick and
  // reads the CURRENT props, not the render it started from.
  const stateRef = useRef(state);
  stateRef.current = state;

  // An F2JS package that survived a preset switch describes a different
  // widget — its badge must not render here (same rule as the Export tab).
  const f2jsFreshness = usePackageFreshness(state.js, state.f2js);
  const freshF2js = f2jsFreshness === "fresh" ? state.f2js : null;

  const dev = device.state;
  const connecting = dev.phase === "connecting";
  const connected = dev.connected !== null;
  const identified = dev.phase === "ready";
  // Connect/identify failures flip the phase; push failures keep the session
  // alive and set only the message — each surfaces at ITS OWN step.
  const connectionError = dev.phase === "error" ? dev.error : "";
  const pushError = dev.phase !== "error" ? dev.error : "";

  // ── Cancellable connect ──────────────────────────────────────────────────
  // WebHID gives no handle to close its chooser, so an open prompt can leave
  // the whole tab spinning on "Connecting…" forever. Cancel abandons the
  // pending request panel-side (disconnect resets every surface to idle); if
  // the chooser resolves later anyway, the connection proceeds normally, and
  // its eventual "nothing selected" rejection is swallowed instead of
  // surfacing as a failure the user caused on purpose.
  const startConnect = () => {
    connectCancelledAt = 0;
    void device.connect();
  };
  const cancelConnect = () => {
    connectCancelledAt = Date.now();
    void device.disconnect();
  };
  useEffect(() => {
    if (!connectCancelledAt) return;
    if (Date.now() - connectCancelledAt > 120_000) {
      connectCancelledAt = 0;
      return;
    }
    if (dev.phase === "error" && CHOOSER_DISMISSED.test(dev.error)) {
      connectCancelledAt = 0;
      void device.disconnect();
    } else if (dev.phase === "connected" || dev.phase === "ready" || dev.phase === "identifying") {
      connectCancelledAt = 0;
    }
  }, [dev.phase, dev.error, device]);

  // The chooser can also sit unanswered with no way to know: after 20s the
  // spinner visual times out into a static "still waiting" state — a spinner
  // that can spin forever is a lie about progress.
  const [connectStalled, setConnectStalled] = useState(false);
  useEffect(() => {
    if (!connecting) {
      setConnectStalled(false);
      return;
    }
    const timer = window.setTimeout(() => setConnectStalled(true), 20_000);
    return () => window.clearTimeout(timer);
  }, [connecting]);

  const buildPackage = () =>
    mode === "events" ? actions.compileEventDriven() : actions.compileRenderV2({ frameCount });

  const build = async () => {
    if (building) return;
    setBuilding(true);
    // Snapshot BEFORE the run: the store appends diagnostics, so only items
    // past this index belong to THIS build — never a previous attempt's.
    const source = { html: state.html, css: state.css, js: state.js };
    const diagStart = stateRef.current.diagnostics.items.length;
    publishDeviceBuild(null);
    try {
      await actions.compileF2JS();
      const pkg = await buildPackage();
      // Let the store's state updates land before reading what it filed.
      await new Promise((resolve) => setTimeout(resolve, 50));
      const fresh = stateRef.current.diagnostics.items.slice(diagStart);
      if (pkg) {
        // Frames mode can succeed with an advisory (dropped frames, box-model
        // fallback) — carry it so success never silently degrades.
        const notice =
          fresh.find((d) => d.severity === "warning" && DEVICE_BUILD_PREFIX.test(d.message))?.message ?? null;
        publishDeviceBuild({ outcome: "ok", mode, error: null, notice, source });
      } else {
        // The store already reported WHY; surface that exact reason — never a
        // generic message that sends people looking in the wrong place.
        const error =
          fresh.find((d) => d.severity === "error" && DEVICE_BUILD_PREFIX.test(d.message))?.message ??
          (mode === "events"
            ? "event-driven: not compilable as an event program."
            : "render-v2: capture failed.");
        publishDeviceBuild({ outcome: "failed", mode, error, notice: null, source });
      }
    } catch (e) {
      publishDeviceBuild({
        outcome: "failed",
        mode,
        error: (e as Error).message,
        notice: null,
        source,
      });
    } finally {
      setBuilding(false);
    }
  };

  // Push rides the render-v2 scene RPC. Only a build advertising the generic
  // structural profile admits arbitrary packages; the clock/timer and mquickjs
  // builds carry the same RPC but accept only their one pinned package, so
  // `present` alone is not enough to enable the button. The device advertises
  // its admission profile (firmware 4e045ec2+), so the gate can be truthful
  // instead of optimistic.
  const sceneGate = dev.renderV2;
  const canPush = sceneGate?.genericPackages === true && !dev.pushing;

  // The mquickjs roster is authoritative when present. Builds without the
  // module advertise none, so fall back to the identified build's roster.
  const screenRoster =
    dev.mquickjs?.screenIds.length
      ? dev.mquickjs.screenIds
      : dev.firmware?.screenIds ?? [];

  // Naming the widget screens costs no extra device traffic: the Screens panel
  // already sweeps the slot bank into shared state, and every push it makes
  // records sha → name locally. Subscribing to that registry is what keeps a
  // chip's name current after a push lands in another card of this same tab.
  const slotNames = useSlotRegistry();
  const screenOccupant = (screenId: number): ScreenOccupant | null => {
    const bank = dev.slotBank;
    if (!bank) return null;
    const slot = bank.slots.find((view) => view.slot === screenId - FIRST_WIDGET_SCREEN);
    // An unreadable slot is not an empty one — say nothing rather than promise
    // a screen is free when the keyboard refused to tell us.
    if (!slot || slot.unknown) return null;
    return {
      name: slot.present ? slotNames[normalizeSha16(slot.sha16)]?.name ?? null : null,
      occupied: slot.present,
    };
  };

  const pushNow = async () => {
    const pkg = state.renderV2 ?? (await buildPackage());
    if (!pkg) return;
    const result = await device.push(pkg);
    if (result) {
      // Byte counts, chunk counts and the generation counter already stream
      // into the Session log line by line — that is where evidence belongs.
      // The toast owes the designer the two things no log line answers: can I
      // look at it now, and will it still be there tomorrow.
      toast({
        tone: "success",
        title: "Your widget is on the keyboard screen",
        body: "This one is temporary — unplug the keyboard and it goes back to the widget it boots with.",
      });
    }
  };

  // The mquickjs uploader path exists ONLY when the device advertises
  // uploader=1 on cap page 0; on every other build the panel renders exactly
  // as it did before this path existed.
  const widgetUploaderReady = dev.mquickjs?.runtimeUploader === true;

  const pushWidgetNow = async () => {
    const assemble = async (generation: number) => {
      try {
        return await actions.assembleWidgetUpload({ generation });
      } catch (cause) {
        // The store already filed the specific diagnostics; rethrow so the
        // device log carries the failure too.
        throw cause instanceof Error ? cause : new Error(String(cause));
      }
    };

    // A slot-bank keyboard must ratchet and replace the slot it is actually
    // showing. The legacy no-slot path defaults to slot 0, which is wrong as
    // soon as another slot is live (and can be rejected by slot 0's unrelated
    // generation). Sweep on demand so the primary button remains safe even if
    // it is pressed before the Screens panel's background sweep completes.
    const bank = dev.slotBank ?? (await device.sweepSlots({ silent: true }));
    if (bank) {
      const slot = bank.activeSlot;
      const pushed = await device.pushWidgetToSlot(slot, assemble);
      if (!pushed) return;
      recordSlotPush(pushed.sha16, {
        name: state.displayName,
        generation: pushed.result.generation,
      });
      const activated = await device.activateSlot(slot);
      toast({
        tone: activated ? "success" : "warning",
        title: activated ? "Your widget is on the keyboard screen" : "Widget saved to your keyboard",
        body: activated
          ? "The screen reloaded the new version immediately, and it stays there after you unplug."
          : "It is saved, but the screen could not reload it immediately; power-cycle the keyboard to adopt it.",
      });
      return;
    }

    // Pre-slot firmware: preserve the original running-generation path.
    const result = await device.pushWidget(assemble);
    if (result) {
      // The generation number and the flash write are in the Session log; the
      // payoff moment says only that the widget is theirs to keep, and names
      // the one action standing between them and seeing it.
      toast({
        tone: "success",
        title: "Widget saved to your keyboard",
        body: "Unplug the keyboard and plug it back in to see it on screen. It stays there until you send another.",
      });
    }
  };

  // ── Stage states ─────────────────────────────────────────────────────────
  // The verdict comes from the shared record — scoped to the current mode —
  // so a failed badge survives tab navigation and clears exactly when the
  // callout does (source edit, mode switch, or a later successful build):
  // never one without the other, and never a chip from the other mode.
  const buildFailed = modeBuild?.outcome === "failed";
  const buildFailure = buildFailed && modeBuild ? explainDeviceBuildFailure(modeBuild, state) : null;
  const buildStep: StepState =
    building ? "busy"
    : buildFailed ? "failed"
    : modeBuild?.outcome === "ok" && state.renderV2 ? "done"
    : "active";
  // v3: the ONE push path is the mquickjs uploader — the render-v2 scene RPC
  // ("Send (temporary)") is a legacy route.
  const pushable = legacy
    ? (canPush && state.renderV2 !== null) || widgetUploaderReady
    : widgetUploaderReady;
  const pushStep: StepState =
    dev.pushing ? "busy"
    : pushError ? "failed"
    : dev.pushedThisBoot ? "done"
    : pushable ? "active"
    : "pending";

  // Deep-link target: the footer error pill and the Export tab's Push note
  // land HERE — scroll the build card into view and flash it so the jump has
  // a visible destination. The link chases a VERDICT, and verdicts are
  // mode-scoped: adopt the failed build's mode first, so the destination
  // actually shows the callout the link promised.
  const buildCardRef = useRef<HTMLDivElement | null>(null);
  const buildStatusRef = useRef(buildStatus);
  buildStatusRef.current = buildStatus;
  const [buildFlash, setBuildFlash] = useState(false);
  useEffect(() => {
    let timer: number | undefined;
    let clear: number | undefined;
    const fire = () => {
      const verdict = buildStatusRef.current;
      if (verdict) setMode(verdict.mode);
      timer = window.setTimeout(() => {
        buildCardRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
        setBuildFlash(true);
        clear = window.setTimeout(() => setBuildFlash(false), 1600);
      }, 120);
    };
    if (consumeDeviceBuildReveal()) fire();
    const off = onRevealDeviceBuildStep(fire);
    return () => {
      off();
      window.clearTimeout(timer);
      window.clearTimeout(clear);
    };
  }, []);

  return (
    <div className="wd-dev">
      <div className="wd-dev-main">
        {/* ── Connection ─────────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <div className="wd-stagehead">
              <div>
                <CardTitle>Connection</CardTitle>
                <CardDescription>
                  Framer F1 over WebHID — detect and connect, then identify firmware and screens.
                </CardDescription>
              </div>
              <div className="wd-stagehead-badges">
                <DeviceIndicator device={dev} />
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {!connected ? (
              <>
                {/* Idle and waiting are DIFFERENT states with different copy:
                    while the WebHID chooser is up, the panel says what to do in
                    the chooser and offers a way out — never an indefinite
                    spinner wearing the idle instructions. */}
                <EmptyState
                  icon="keyboard"
                  title={connecting ? "Waiting for the browser prompt" : "No keyboard connected"}
                  hint={
                    connecting
                      ? connectStalled
                        ? "Still waiting — the device chooser may be hidden behind another window, or was already dismissed. Cancel and try again if nothing appears."
                        : "Pick your Framer F1 in the browser's device chooser. Identification reads the advertised capabilities — nothing is written."
                      : "Plug in a Framer F1 and connect over WebHID (Chrome or Edge). Identification reads the advertised capabilities — nothing is written."
                  }
                  action={
                    connecting ? (
                      <span className="inline-flex items-center gap-2">
                        {!connectStalled && (
                          <Button variant="primary" busy>
                            Connecting…
                          </Button>
                        )}
                        <Button onClick={cancelConnect}>Cancel</Button>
                      </span>
                    ) : (
                      <Button variant="primary" onClick={startConnect}>
                        <Icon name="cable" size={14} />
                        Connect keyboard
                      </Button>
                    )
                  }
                />
                {connectionError && dev.errorCode === "macos-input-monitoring" ? (
                  <InputMonitoringHelp detail={connectionError} onRetry={startConnect} />
                ) : connectionError ? (
                  <IssueBlock tone="danger" summary={`Connection failed: ${humanizeDiagnostic(connectionError)}`} detail={connectionError} />
                ) : null}
              </>
            ) : (
              <>
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-sm">
                    {dev.connected!.layout}
                    <span className="text-tertiary"> · firmware </span>
                    <span className="font-mono text-xs">{dev.connected!.version}</span>
                  </span>
                  <span className="flex-1" />
                  <Button
                    variant={identified ? "default" : "primary"}
                    onClick={device.identify}
                    busy={dev.phase === "identifying"}
                  >
                    {dev.phase !== "identifying" && <Icon name="search" size={14} />}
                    {dev.phase === "identifying" ? "Identifying…" : identified ? "Re-identify" : "Identify firmware"}
                  </Button>
                  <Button variant="ghost" onClick={device.disconnect}>Disconnect</Button>
                </div>

                {connectionError && (
                  <IssueBlock tone="danger" summary={`Device error: ${humanizeDiagnostic(connectionError)}`} detail={connectionError} />
                )}

                {identified && (
                  <>
                    <div className="wd-divider" />
                    <div>
                      <h3 className="wd-overline mb-2">Firmware</h3>
                      {dev.firmware ? (
                        <KVTable
                          rows={[
                            {
                              key: "Build",
                              value: (
                                <>
                                  <span className="font-medium">{dev.firmware.name}</span>
                                  <Badge tone="neutral">{dev.firmware.id}</Badge>
                                  {dev.firmware.hasMquickjs && <Badge tone="info">mquickjs</Badge>}
                                </>
                              ),
                            },
                            {
                              key: "Identification",
                              value:
                                dev.firmwareSource === "app-sha256" ? (
                                  <>
                                    <Badge tone="success">identified</Badge>
                                    <span className="wd-kv-dim text-xs">
                                      matched from the advertised base-app SHA-256
                                    </span>
                                  </>
                                ) : (
                                  <>
                                    <Badge tone="info">inferred</Badge>
                                    <span className="wd-kv-dim text-xs">
                                      from the advertised render-v2 admission profile — this build carries no app SHA-256
                                    </span>
                                  </>
                                ),
                            },
                            {
                              key: "SHA-256",
                              mono: true,
                              value: (
                                <>
                                  <span className="wd-artifact-sha" title={dev.firmware.sha256}>{dev.firmware.sha256}</span>
                                  {dev.firmwareSource === "capability-profile" && (
                                    <span className="wd-kv-dim" style={{ fontFamily: "var(--wd-font-sans)" }}>
                                      catalog entry — not read back from this device
                                    </span>
                                  )}
                                </>
                              ),
                            },
                          ]}
                        />
                      ) : (
                        <div className="space-y-2">
                          <Callout tone="warning">
                            This firmware matches no build we have flashed before — a new catalog entry may be required
                            to identify this device. To use the Designer's widget push and screens,{" "}
                            <FlashFirmwareLink /> and install{" "}
                            <strong className="font-medium">Widget Designer (multi-widget)</strong>.
                          </Callout>
                          {dev.mquickjs?.baseAppSha256 && (
                            <KVTable
                              rows={[
                                {
                                  key: "Base app SHA-256",
                                  mono: true,
                                  value: (
                                    <span className="wd-artifact-sha" title={dev.mquickjs.baseAppSha256}>
                                      {dev.mquickjs.baseAppSha256}
                                    </span>
                                  ),
                                },
                              ]}
                            />
                          )}
                        </div>
                      )}
                    </div>

                    {screenRoster.length > 0 && (
                      <>
                        <div className="wd-divider" />
                        <div>
                          <h3 className="wd-overline mb-1">All screens, in knob order</h3>
                          <p className="text-xs text-tertiary mb-2">
                            {dev.mquickjs?.screenIds.length
                              ? "Turn the knob to move between them. Your widgets live on the widget screens, listed in full below."
                              : "This keyboard doesn't list its own screens, so these come from the software we identified on it."}
                          </p>
                          <div className="flex flex-wrap gap-2" role="group" aria-label="All screens, in knob order">
                            {screenRoster.map((screenId) => {
                              const selected = dev.selectedScreen === screenId;
                              // The chip says what the screen IS; the id it
                              // selects with is unchanged and stays reachable
                              // in the tooltip for anyone reading a log beside
                              // this panel. The sans face is deliberate: these
                              // are names now, not keys.
                              const { label, title } = describeScreen(screenId, screenRoster, screenOccupant);
                              return (
                                <button
                                  key={screenId}
                                  type="button"
                                  className="wd-screenchip"
                                  style={{ fontFamily: "var(--wd-font-sans)" }}
                                  aria-pressed={selected}
                                  title={title}
                                  onClick={() => device.selectScreen(screenId)}
                                >
                                  {selected && <Icon name="check" size={12} />}
                                  {label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </>
                    )}
                  </>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* ── Screens: every widget stored on the keyboard ───────────────── */}
        <ScreensPanel state={state} actions={actions} device={device} />

        {/* ── Build & send ───────────────────────────────────────────────── */}
        <div ref={buildCardRef}>
        <Card data-flash={buildFlash ? "true" : undefined}>
          <CardHeader>
            <div className="wd-stagehead">
              <div>
                <CardTitle>{legacy ? <>Build &amp; send</> : "Send"}</CardTitle>
                <CardDescription>
                  {legacy
                    ? "Build the widget into a package the keyboard understands, then send it."
                    : "Send the widget you designed to your keyboard and keep it there."}
                </CardDescription>
              </div>
              <div className="wd-stagehead-badges">
                {legacy && modeBuild?.outcome === "ok" && state.renderV2 && (
                  <Badge tone="success" className="wd-nums">
                    {formatArtifact("render-v2", state.renderV2.bytes)}
                  </Badge>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Stepper
              steps={[
                ...(legacy ? [{
                  id: "build",
                  state: buildStep,
                  label: "Build package",
                  detail:
                    mode === "events"
                      ? "Ships the compiled event program with its pre-rendered pixels — the device runs it, so knob turns, keys and host RPC change the screen immediately. Requires the F1SC subset; the compiler names exactly what it rejects."
                      : "Ships captured snapshots of the live preview — the device replays them on a loop and never runs the widget, so nothing responds to knob, key or RPC events.",
                  children: (
                    <>
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-xs font-medium text-secondary">Mode</span>
                        <SegmentedControl<DeviceBuildMode>
                          semantics="radio"
                          aria-label="Build mode"
                          value={mode}
                          onValueChange={changeMode}
                          items={[
                            { id: "events", label: "Event-driven" },
                            { id: "frames", label: "Frames" },
                          ]}
                        />
                        {mode === "frames" && (
                          <>
                            <span className="text-xs font-medium text-secondary">Frames</span>
                            <SegmentedControl<FrameChoice>
                              semantics="radio"
                              aria-label="Frame count"
                              value={String(frameCount) as FrameChoice}
                              onValueChange={(v) => setFrameCount(Number(v))}
                              items={[
                                { id: "1", label: "1" },
                                { id: "5", label: "5" },
                                { id: "10", label: "10" },
                                { id: "20", label: "20" },
                              ]}
                            />
                            <span className="text-xs text-tertiary">
                              {frameCount === 1 ? "still" : `${frameCount}s loop, captured one tick apart`}
                            </span>
                          </>
                        )}
                      </div>

                      {/* Static pre-flight at the MODE PICKER, not after a
                          failed click: when the event compiler rejects this
                          widget, Frames is pre-selected and the objection is
                          named here — the default build mode must never be a
                          guaranteed failure. Choosing Event-driven anyway
                          upgrades the notice to a warning naming what will
                          fail. */}
                      {preflight.status === "rejected" && preflight.error && !(buildFailure && mode === "events") && (
                        <IssueBlock
                          tone={mode === "events" ? "warning" : "info"}
                          summary={
                            mode === "events"
                              ? `The event compiler rejects this widget — ${humanizeDiagnostic(preflight.error)} Building will fail; Frames ships captured snapshots instead.`
                              : `Event-driven isn't available for this widget — ${humanizeDiagnostic(preflight.error)} Frames is pre-selected: it ships captured snapshots that don't react to input.`
                          }
                          detail={preflight.error}
                        />
                      )}

                      <div className="flex items-center gap-2 flex-wrap">
                        <Button onClick={build} busy={building}>
                          {!building && <Icon name="play" size={14} />}
                          {building
                            ? "Building…"
                            : mode === "events"
                              ? "Build event program"
                              : frameCount === 1 ? "Build package" : `Capture ${frameCount} frames`}
                        </Button>
                        {/* Artifact chips: the ONE formatter, gated on THIS
                            mode's fresh success — a chip must never sit beside
                            a failure callout or a mode that didn't mint it,
                            claiming a package that isn't there. */}
                        {modeBuild?.outcome === "ok" && state.renderV2 && (
                          <Badge tone="success" className="wd-nums">
                            {formatArtifact("render-v2", state.renderV2.bytes)}
                            {state.renderV2.frameCount > 1 ? ` · ${state.renderV2.frameCount}f` : ""}
                          </Badge>
                        )}
                        {modeBuild?.outcome === "ok" && state.eventProgram && (
                          <Badge tone="info" className="wd-nums">
                            {formatArtifact("F2EP", state.eventProgram.programBytes)} · {state.eventProgram.bindings} bindings
                          </Badge>
                        )}
                        {modeBuild?.outcome === "ok" && freshF2js && (
                          <Badge tone="neutral" className="wd-nums">{formatArtifact("F2JS", freshF2js.bytes)}</Badge>
                        )}
                      </div>

                      {/* The reason, inline at the click site, from the shared
                          record — it survives leaving and returning to this
                          tab, and its disclosure carries the rule id, stage,
                          and offending nodes, never the summary again. */}
                      {buildFailure && (
                        <IssueBlock
                          tone="danger"
                          summary={`Build failed: ${humanizeDiagnostic(buildFailure.raw)}`}
                          detail={buildFailure.text}
                          copyText={buildFailure.copyText}
                        />
                      )}
                      {modeBuild?.outcome === "ok" && modeBuild.notice && (
                        <IssueBlock
                          tone="warning"
                          summary={humanizeDiagnostic(modeBuild.notice)}
                          detail={modeBuild.notice}
                        />
                      )}
                    </>
                  ),
                }] : []),
                {
                  id: "push",
                  state: pushStep,
                  label: "Send to keyboard",
                  // Each branch states its OUTCOME, because that is the whole
                  // question here: will my widget be on this keyboard, will it
                  // survive unplugging, and if not, what do I do instead. The
                  // capability names behind each verdict (uploader flag, scene
                  // profile, screen numbers) are milestones in the Session log,
                  // which is where someone debugging goes anyway.
                  detail:
                    sceneGate == null
                      ? "Connect your keyboard and run Identify — that's how the Designer finds out whether this keyboard can take your widget."
                      : widgetUploaderReady
                        ? "Sends the widget exactly as the preview shows it and saves it on the keyboard. It stays there after you unplug; power-cycle the keyboard to bring it on screen."
                        : !legacy
                          ? "This keyboard's software is too old to take Designer widgets. Updating it is a one-time flash over USB — the steps are right below."
                          : canPush || sceneGate.genericPackages
                            ? "Older route: sends the built package straight to the screen the keyboard is showing. It appears at once, but only in memory — unplug and the keyboard goes back to the widget it boots with."
                            : sceneGate.present
                              ? "This keyboard shows only the one widget it was flashed with and won't take another. To send your own, re-flash it with the Widget Designer build from the web flasher."
                              : "This keyboard doesn't answer either way of sending a widget. Re-flash it with the Widget Designer build from the web flasher, then connect again.",
                  children: (
                    <>
                      {legacy && sceneGate?.maxBundleBytes != null && (
                        <p className="text-xs text-tertiary wd-nums">
                          Largest package this keyboard will accept: {sceneGate.maxBundleBytes.toLocaleString()} bytes.
                        </p>
                      )}

                      {/* Only with legacy tools on: without them the remedy
                          callout below already names this exact fix, and two
                          callouts telling someone to re-flash is one too many.
                          What it adds over that one is WHY a keyboard that
                          plainly runs widgets still can't take yours. */}
                      {legacy && dev.mquickjs?.present && !widgetUploaderReady && (
                        <Callout tone="info">
                          This keyboard runs widgets, but its software can't receive new ones over USB — the
                          widget it shows was written when it was flashed. <FlashFirmwareLink /> and install{" "}
                          <strong className="font-medium">Widget Designer (multi-widget)</strong> to send your own.
                        </Callout>
                      )}

                      {/* ONE primary: the currently-valid push path. With
                          legacy tools on, the other route stays reachable as
                          a secondary. No tooltips — the step detail above
                          already states each path and its gate; a bubble
                          would only restate it. */}
                      <div className="flex items-center gap-2 flex-wrap">
                        {!legacy ? (
                          <Button
                            variant="primary"
                            onClick={pushWidgetNow}
                            busy={dev.pushing}
                            disabled={!widgetUploaderReady}
                          >
                            {!dev.pushing && <Icon name="upload" size={14} />}
                            {dev.pushing ? "Sending…" : "Send to keyboard"}
                          </Button>
                        ) : widgetUploaderReady ? (
                          <>
                            <Button variant="primary" onClick={pushWidgetNow} busy={dev.pushing}>
                              {!dev.pushing && <Icon name="upload" size={14} />}
                              {dev.pushing ? "Sending…" : "Send to keyboard"}
                            </Button>
                            <Button onClick={pushNow} disabled={!canPush || !state.renderV2}>
                              Send (temporary)
                            </Button>
                          </>
                        ) : (
                          <Button
                            variant="primary"
                            onClick={pushNow}
                            busy={dev.pushing}
                            disabled={!canPush || !state.renderV2}
                          >
                            {!dev.pushing && <Icon name="upload" size={14} />}
                            {dev.pushing ? "Sending…" : "Send to keyboard"}
                          </Button>
                        )}
                      </div>

                      {/* v3 remedy: the legacy scene-RPC route exists but sits
                          behind the Legacy tools switch — name the way out
                          instead of leaving a dead primary. */}
                      {!legacy && identified && !widgetUploaderReady && (
<Callout tone="info">
                          <div className="space-y-2">
                            <div>
                              This keyboard's software can't receive Designer widgets yet. Updating it takes
                              about a minute and only has to happen once — afterwards widgets send instantly,
                              and each widget you store gets its own keyboard screen.
                            </div>
                            <InstallFirmwareButton device={device} />
                          </div>
                        </Callout>
                      )}

                      {pushError && (
                        <IssueBlock tone="danger" summary={`Couldn't send your widget — ${humanizeDiagnostic(pushError)}`} detail={pushError} />
                      )}

                      {dev.pushedThisBoot && (
                        <Callout tone="warning">
                          This keyboard takes one widget per power-up. Unplug it, plug it back in, then send
                          again — sending now would be refused.
                        </Callout>
                      )}

                      {legacy && state.renderV2 && !widgetUploaderReady && (
                        <p className="text-xs text-tertiary">
                          {state.eventProgram
                            ? "This package carries an event program, so the device reacts to input."
                            : "This package is a frame loop, so the device replays it and ignores input."}
                        </p>
                      )}
                    </>
                  ),
                },
              ]}
            />
          </CardContent>
        </Card>

        </div>
      </div>

      {/* ── Session log rail ─────────────────────────────────────────────── */}
      <div className="wd-dev-logcol">
        <Card>
          <CardHeader>
            <div className="wd-stagehead">
              <div>
                <CardTitle>Session log</CardTitle>
                <CardDescription>Connection, identification and push milestones.</CardDescription>
              </div>
              {dev.log.length > 0 && (
                <div className="wd-stagehead-badges">
                  <Badge tone="neutral" className="wd-nums">{dev.log.length}</Badge>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <SessionLog lines={dev.log} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** Terminal-voiced session log: index gutter, milestone tinting, pinned to
 *  the latest line as new RPC milestones stream in. */
function SessionLog({ lines }: { lines: string[] }) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);
  if (lines.length === 0) {
    return (
      <EmptyState
        size="sm"
        icon="terminal"
        title="Nothing logged yet"
        hint="Connect a keyboard and send a widget — every step the keyboard reports lands here, in order."
      />
    );
  }
  return (
    <div ref={scrollRef} className="wd-dev-log" role="log" aria-label="Device session log">
      {lines.map((line, i) => (
        <div key={i} className="wd-dev-logline" data-kind={logKind(line)}>
          <span className="wd-dev-logidx" aria-hidden="true">{i + 1}</span>
          <span className="wd-dev-logtext">{line}</span>
        </div>
      ))}
    </div>
  );
}

function logKind(line: string): "error" | "ok" | undefined {
  if (/failed|error/i.test(line)) return "error";
  if (/committed|persisted|identified:|^Connected/i.test(line)) return "ok";
  return undefined;
}
