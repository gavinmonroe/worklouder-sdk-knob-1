// Screens panel (docs/17) — the on-screen counterpart to the keyboard's
// widget slot bank. It sweeps op 0 (sl/sn) + op 5 per slot into a set of slot
// cards: the ACTIVE slot (on the keyboard now), OCCUPIED slots (one tap to put
// on screen), and EMPTY slots (send the widget you're designing here).
//
// Every label here is written for a designer, so it names a screen, a widget,
// or what a button is about to do. The protocol facts a card sits on — the
// F2JS content hash the keyboard reports for a slot, the per-slot generation
// the push ratchets — stay reachable as tooltips, because they are the only
// way to answer "are these two really the same widget?" on the rare day that
// question comes up. What they must never be is the thing a designer reads to
// find out what a screen holds: a hash cannot be compared against anything the
// app shows them elsewhere. Names come from a local sha→name registry
// (slotRegistry.ts), which only knows the pushes THIS browser made; a widget
// sent from another browser gets a plain sentence saying so, plus the button
// that resolves it — put it on screen and look at the keyboard.
//
// ScreensView is PURE — model + handlers in, cards out — so the same component
// renders live against the device and, with mock props, in the screenshot
// gallery (screens-gallery.html). ScreensPanel is the thin device wiring.

import * as React from "react";
import type { DesignerState, DesignerActions } from "../designer/store";
import type { useDevice } from "../device/useDevice";
import type { SlotBankModel, SlotView } from "../device/widget-upload";
import { lookupSlotName, recordSlotPush, useSlotRegistry } from "../device/slotRegistry";
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
  Spinner,
  StatusDot,
} from "./ui";
import { Icon } from "./icons";
import { useToast } from "./toast";

export type ScreensPhase =
  | "disconnected"
  | "needs-identify"
  | "unsupported"
  | "scanning"
  | "error"
  | "ready";

export interface ScreensViewProps {
  phase: ScreensPhase;
  model: SlotBankModel | null;
  /** Sweep failure text (phase "error"). */
  error?: string;
  /** True while a refresh is re-sweeping over an already-loaded model. */
  scanning?: boolean;
  /** The slot mid-push/activate (spinner + exclusive lock). */
  busySlot?: number | null;
  busyKind?: "push" | "activate" | null;
  /** Global gate: false while any device op is in flight. */
  canAct: boolean;
  /** Registry lookup → friendly name, or null when this sha is unknown. */
  nameForSha: (sha16: string) => string | null;
  /** Name of the widget currently loaded in the Designer — the one "Send
   *  here" sends — so an empty screen names exactly what it will receive. */
  currentWidgetName?: string;
  onRefresh: () => void;
  onIdentify?: () => void;
  onActivate: (slot: number) => void;
  onPush: (slot: number) => void;
}

// ── Pure view ────────────────────────────────────────────────────────────────

/**
 * What a designer calls this screen. The keyboard indexes its widget slots
 * from zero and the Session log keeps saying "slot 0"; nobody counts the
 * screens on a device that way, and — more to the point — the Device tab's
 * screen roster right above these cards already labels the same screen
 * "Widget screen 1" (DevicePanel.describeScreen, keyed off screen id 28 =
 * slot 0). Two panels on one tab numbering the same screen differently is a
 * contradiction a designer cannot resolve, so both count from one here and the
 * device's own index rides the tooltip for anyone reading it beside the log.
 *
 * Display only: every handler below still passes `view.slot` to the device.
 */
function screenNumber(slot: number): number {
  return slot + 1;
}

export function ScreensView({
  phase,
  model,
  error,
  scanning = false,
  busySlot = null,
  busyKind = null,
  canAct,
  nameForSha,
  currentWidgetName,
  onRefresh,
  onIdentify,
  onActivate,
  onPush,
}: ScreensViewProps) {
  const ready = phase === "ready" && model !== null;
  // A bank of screens raises exactly two questions before any card is read:
  // how much room is left, and which screen is the keyboard showing. Both are
  // already in the sweep, so answer them in the header rather than printing the
  // slot index and generation counters the sweep happens to carry with it.
  const usedCount = model ? model.slots.filter((s) => s.present).length : 0;
  const liveSlot = model ? (model.slots.find((s) => s.active) ?? null) : null;

  return (
    <Card>
      <CardHeader>
        <div className="wd-stagehead">
          <div>
            <CardTitle>Screens</CardTitle>
            <CardDescription>
              Every widget stored on your keyboard. Each one gets its own screen — turn the
              knob to reach it. One is live at a time; the others wait, ready to switch to.
            </CardDescription>
          </div>
          {ready && (
            <div className="wd-stagehead-badges">
              <Badge
                tone="neutral"
                className="wd-nums"
                title="Screens that already hold a widget. The rest are empty and ready for one."
              >
                {usedCount} of {model!.slotCount} screens used
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                onClick={onRefresh}
                busy={scanning}
                disabled={!canAct && !scanning}
                aria-label="Refresh screens"
              >
                {!scanning && <Icon name="rotate-ccw" size={13} />}
                Refresh
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {phase === "disconnected" && (
          <EmptyState
            size="sm"
            icon="keyboard"
            title="No keyboard connected"
            hint="Connect your keyboard to see the widgets it's holding and send it a new one."
          />
        )}

        {phase === "needs-identify" && (
          <EmptyState
            size="sm"
            icon="search"
            title="Check what's on your keyboard"
            hint="Read the keyboard to see which widget is on each screen."
            action={
              onIdentify ? (
                <Button variant="primary" size="sm" onClick={onIdentify}>
                  <Icon name="search" size={13} />
                  Identify firmware
                </Button>
              ) : undefined
            }
          />
        )}

        {phase === "unsupported" && (
          <Callout tone="info">
            This keyboard holds one widget at a time, so sending replaces whatever is on it.
            To keep several widgets and switch between them with the knob, install{" "}
            <strong className="font-medium">Widget Designer (multi-widget)</strong> from the web
            flasher — it's a one-time update.
          </Callout>
        )}

        {phase === "scanning" && <SlotScanningGrid />}

        {phase === "error" && (
          <div className="space-y-3">
            <Callout tone="danger">
              Couldn't read your keyboard's screens{error ? <>: {error}</> : "."}
            </Callout>
            <Button variant="primary" size="sm" onClick={onRefresh}>
              <Icon name="rotate-ccw" size={13} />
              Try again
            </Button>
          </div>
        )}

        {ready && (
          <div className="wd-slotbank">
            <div className="wd-slotbank-meta wd-nums">
              {liveSlot?.present
                ? `Screen ${screenNumber(model!.activeSlot)} is on your keyboard now — turn the knob to switch.`
                : "Nothing on the keyboard's screen yet — send your widget to an empty screen below."}
            </div>
            <div className="wd-slotgrid" role="list" aria-label="Widget screens">
              {model!.slots.map((slot) => (
                <SlotCard
                  key={slot.slot}
                  view={slot}
                  name={slot.present ? nameForSha(slot.sha16) : null}
                  currentWidgetName={currentWidgetName}
                  busy={busySlot === slot.slot ? busyKind : null}
                  canAct={canAct}
                  onActivate={() => onActivate(slot.slot)}
                  onPush={() => onPush(slot.slot)}
                  onRetry={onRefresh}
                />
              ))}
            </div>
            <SlotLegend />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── One slot card ────────────────────────────────────────────────────────────

function SlotCard({
  view,
  name,
  busy,
  canAct,
  onActivate,
  onPush,
  onRetry,
  currentWidgetName,
}: {
  view: SlotView;
  name: string | null;
  busy: "push" | "activate" | null;
  canAct: boolean;
  onActivate: () => void;
  onPush: () => void;
  onRetry: () => void;
  currentWidgetName?: string;
}) {
  const dataState = view.unknown
    ? "unknown"
    : view.active
      ? "active"
      : view.present
        ? "occupied"
        : "empty";
  const pushing = busy === "push";
  const activating = busy === "activate";
  const anyBusy = busy !== null;
  // Other cards' controls lock while any op runs; this card's acting button
  // keeps its spinner.
  const lockOthers = !canAct && !anyBusy;

  return (
    <div className="wd-slotcard" data-state={dataState} role="listitem">
      <div className="wd-slotcard-head">
        <span className="wd-slotcard-idx" title={`Widget screen ${screenNumber(view.slot)} — the keyboard calls it slot ${view.slot}`}>
          Screen {screenNumber(view.slot)}
        </span>
        <SlotStatusPill state={dataState} />
      </div>

      {dataState === "empty" && (
        <div className="wd-slotcard-empty">
          <span className="wd-slotcard-plus" aria-hidden="true">
            <Icon name="plus" size={18} />
          </span>
          <div className="wd-slotcard-name">Empty screen</div>
          <div className="wd-slotcard-emptyhint">
            {currentWidgetName ? <>Send <strong className="font-medium">{currentWidgetName}</strong> here.</> : "Send the widget you're designing here."}
          </div>
        </div>
      )}

      {dataState === "unknown" && (
        <div className="wd-slotcard-body">
          <div className="wd-slotcard-name text-secondary">Couldn't read this screen</div>
          <div className="wd-slotcard-meta">The keyboard didn't answer for this screen.</div>
        </div>
      )}

      {(dataState === "active" || dataState === "occupied") && (
        <div className="wd-slotcard-body">
          {/* The keyboard identifies a stored widget only by the hash of its
              code, so the NAME on this line is ours — recorded when this browser
              pushed that exact hash. Lead with it, and keep the hash on the
              tooltip: its one real use is telling apart two widgets a designer
              gave the same name. */}
          <div
            className="wd-slotcard-name"
            title={name ? `${name} · widget id ${view.sha16}` : `Widget id ${view.sha16}`}
          >
            {name ?? "Unnamed widget"}
          </div>
          <div className="wd-slotcard-meta wd-nums">
            <span title="Goes up by one each time a widget is sent to this screen. The keyboard checks it, so an out-of-date copy can't overwrite a newer one.">
              Version {view.generation}
            </span>
          </div>
          {view.active && (
            <div className="wd-slotcard-live">
              <StatusDot state="ok" />
              On screen now
            </div>
          )}
          {!name && (
            <div className="wd-slotcard-unnamed">
              {view.active
                ? "Sent from another browser, so its name isn't saved here — it's the one you can see on the keyboard right now."
                : "Sent from another browser, so its name isn't saved here. Put it on screen to see which widget it is."}
            </div>
          )}
        </div>
      )}

      <div className="wd-slotcard-actions">
        {dataState === "empty" && (
          <Button
            variant="primary"
            size="sm"
            onClick={onPush}
            busy={pushing}
            disabled={lockOthers}
            title={`Sends ${currentWidgetName || "the widget you're designing"} to screen ${screenNumber(view.slot)} and keeps it there.`}
          >
            {!pushing && <Icon name="upload" size={13} />}
            {pushing ? "Sending…" : "Send here"}
          </Button>
        )}

        {dataState === "occupied" && (
          <>
            <Button
              variant="primary"
              size="sm"
              onClick={onActivate}
              busy={activating}
              disabled={lockOthers || pushing}
              title={`Shows this widget on the keyboard instead of the one on screen now. Nothing is erased — screen ${screenNumber(view.slot)} keeps what it holds.`}
            >
              {!activating && <Icon name="play" size={13} />}
              {activating ? "Switching…" : "Put on screen"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onPush}
              busy={pushing}
              disabled={lockOthers || activating}
              title={`Overwrites screen ${screenNumber(view.slot)} with ${currentWidgetName || "the widget you're designing"}. The widget stored here now is gone.`}
            >
              {!pushing && <Icon name="upload" size={13} />}
              {pushing ? "Sending…" : "Replace"}
            </Button>
          </>
        )}

        {dataState === "active" && (
          <Button
            variant="default"
            size="sm"
            onClick={onPush}
            busy={pushing}
            disabled={lockOthers}
            title={`Overwrites this screen with ${currentWidgetName || "the widget you're designing"}. The widget on it now is gone.`}
          >
            {!pushing && <Icon name="upload" size={13} />}
            {pushing ? "Sending…" : "Replace"}
          </Button>
        )}

        {dataState === "unknown" && (
          <Button variant="ghost" size="sm" onClick={onRetry} disabled={lockOthers}>
            <Icon name="rotate-ccw" size={13} />
            Retry
          </Button>
        )}
      </div>
    </div>
  );
}

function SlotStatusPill({ state }: { state: "active" | "occupied" | "empty" | "unknown" }) {
  if (state === "active") {
    return (
      <span className="wd-slotpill" data-state="active">
        <StatusDot state="ok" />
        On screen
      </span>
    );
  }
  if (state === "occupied") {
    return (
      <span className="wd-slotpill" data-state="occupied">
        Stored
      </span>
    );
  }
  if (state === "unknown") {
    return (
      <span className="wd-slotpill" data-state="unknown">
        Unreadable
      </span>
    );
  }
  return (
    <span className="wd-slotpill" data-state="empty">
      Empty
    </span>
  );
}

function SlotLegend() {
  return (
    <div className="wd-slotlegend" aria-hidden="true">
      <span className="wd-slotlegend-item">
        <span className="wd-slotlegend-swatch" data-state="active" />
        On screen now
      </span>
      <span className="wd-slotlegend-item">
        <span className="wd-slotlegend-swatch" data-state="occupied" />
        Stored — one tap to show it
      </span>
      <span className="wd-slotlegend-item">
        <span className="wd-slotlegend-swatch" data-state="empty" />
        Empty — ready for a widget
      </span>
    </div>
  );
}

function SlotScanningGrid() {
  return (
    <div className="wd-slotbank">
      <div className="wd-slotbank-meta">
        <Spinner size={12} /> Checking what's on your keyboard's screens…
      </div>
      <div className="wd-slotgrid" aria-hidden="true">
        {[0, 1, 2, 3].map((k) => (
          <div key={k} className="wd-slotcard" data-state="skeleton">
            <div className="wd-slotcard-head">
              <span className="wd-slotcard-idx">Screen {screenNumber(k)}</span>
            </div>
            <div className="wd-slotcard-body">
              <span className="wd-skeleton" style={{ width: "62%", height: 14 }} />
              <span className="wd-skeleton" style={{ width: "40%", height: 11, marginTop: 8 }} />
            </div>
            <div className="wd-slotcard-actions">
              <span className="wd-skeleton" style={{ width: 88, height: 28 }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Device-wired container ───────────────────────────────────────────────────

export function ScreensPanel({
  state,
  actions,
  device,
}: {
  state: DesignerState;
  actions: DesignerActions;
  device: ReturnType<typeof useDevice>;
}) {
  const toast = useToast();
  // Subscribe so a fresh push (from here OR the Push card) re-derives names.
  const registry = useSlotRegistry();
  const dev = device.state;

  const connected = dev.connected !== null;
  const identified = dev.phase === "ready";
  const uploader = dev.mquickjs?.runtimeUploader === true;

  const phase: ScreensPhase = !connected
    ? "disconnected"
    : !identified
      ? "needs-identify"
      : !uploader
        ? "unsupported"
        : dev.slotScan === "error" && !dev.slotBank
          ? "error"
          : dev.slotBank
            ? "ready"
            : "scanning";

  // Auto-sweep once when the slot bank first becomes readable. slotBank resets
  // to null on disconnect, so a reconnect re-sweeps; a manual Refresh re-sweeps
  // any time.
  const { sweepSlots } = device;
  React.useEffect(() => {
    if (uploader && identified && dev.slotBank === null && dev.slotScan === "idle") {
      void sweepSlots();
    }
  }, [uploader, identified, dev.slotBank, dev.slotScan, sweepSlots]);

  const nameForSha = React.useCallback(
    (sha16: string) => lookupSlotName(sha16)?.name ?? null,
    // registry identity changes on every record → names re-derive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [registry],
  );

  const busy = dev.slotBusy;
  const canAct = dev.slotScan !== "scanning" && !dev.pushing && busy === null;

  const onPush = async (slot: number) => {
    // Read before the await: a completed push re-sweeps the bank, so asking
    // afterwards would answer for the state we just created, not the one the
    // designer pressed the button in.
    const wroteToLiveScreen = dev.slotBank?.activeSlot === slot;
    const res = await device.pushWidgetToSlot(slot, (generation) =>
      actions.assembleWidgetUpload({ generation }),
    );
    if (res) {
      recordSlotPush(res.sha16, {
        name: state.displayName,
        generation: res.result.generation,
      });
      const activated = wroteToLiveScreen ? await device.activateSlot(slot) : false;
      toast({
        tone: wroteToLiveScreen && !activated ? "warning" : "success",
        title: `Sent to screen ${screenNumber(slot)}`,
        body: wroteToLiveScreen
          ? activated
            ? "The screen reloaded the new version immediately, and it stays there after you unplug."
            : "Saved, but the screen could not reload it immediately; power-cycle the keyboard to adopt it."
          : 'Saved on your keyboard. Choose "Put on screen" on that card to show it now.',
      });
    }
  };

  const onActivate = async (slot: number) => {
    const ok = await device.activateSlot(slot);
    if (ok) {
      toast({
        tone: "success",
        title: `Screen ${screenNumber(slot)} is on your keyboard`,
        body: "It switched over right away — nothing to unplug or restart.",
      });
    }
  };

  return (
    <ScreensView
      phase={phase}
      model={dev.slotBank}
      error={dev.slotError}
      scanning={dev.slotScan === "scanning"}
      busySlot={busy?.slot ?? null}
      busyKind={busy?.kind ?? null}
      canAct={canAct}
      nameForSha={nameForSha}
      currentWidgetName={state.displayName}
      onRefresh={() => void device.sweepSlots()}
      onIdentify={() => void device.identify()}
      onActivate={(slot) => void onActivate(slot)}
      onPush={(slot) => void onPush(slot)}
    />
  );
}
