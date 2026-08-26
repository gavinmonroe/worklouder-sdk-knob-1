// Screens panel (docs/17) — the on-screen counterpart to the keyboard's
// widget slot bank. It sweeps op 0 (sl/sn) + op 5 per slot into a set of slot
// cards: the ACTIVE slot (live now), OCCUPIED slots (one tap to activate), and
// EMPTY slots (push the current widget here). A local sha→name registry
// (slotRegistry.ts) gives stored widgets friendly names.
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
  /** Name of the widget currently loaded in the Designer — the one "Push
   *  here" sends — so an empty slot names exactly what it will receive. */
  currentWidgetName?: string;
  onRefresh: () => void;
  onIdentify?: () => void;
  onActivate: (slot: number) => void;
  onPush: (slot: number) => void;
}

/** First 8 hex chars — enough to eyeball, short enough to sit on one line. */
function shortSha(sha16: string): string {
  return sha16 ? sha16.slice(0, 8) : "";
}

// ── Pure view ────────────────────────────────────────────────────────────────

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

  return (
    <Card>
      <CardHeader>
        <div className="wd-stagehead">
          <div>
            <CardTitle>Screens</CardTitle>
            <CardDescription>
              The keyboard's widget slot bank — one live at a time, the rest cold storage.
            </CardDescription>
          </div>
          {ready && (
            <div className="wd-stagehead-badges">
              <Badge tone="neutral" className="wd-nums" title="Active slot / slot count">
                slot {model!.activeSlot} / {model!.slotCount}
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                onClick={onRefresh}
                busy={scanning}
                disabled={!canAct && !scanning}
                aria-label="Refresh slots"
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
            hint="Connect and identify a keyboard to see and manage its widget slots."
          />
        )}

        {phase === "needs-identify" && (
          <EmptyState
            size="sm"
            icon="search"
            title="Identify to read the slots"
            hint="The slot bank is read from the device's mquickjs capability — identify the firmware to sweep it."
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
            This firmware exposes a single fixed widget slot — the multi-slot RPC
            (<code>uploader=1</code>) isn't advertised, so there's no slot bank to sweep. Push
            still targets the one live widget from the <strong className="font-medium">Push</strong> card.
          </Callout>
        )}

        {phase === "scanning" && <SlotScanningGrid />}

        {phase === "error" && (
          <div className="space-y-3">
            <Callout tone="danger">
              Couldn't sweep the slot bank{error ? <>: {error}</> : "."}
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
              {model!.slotCount} slot{model!.slotCount === 1 ? "" : "s"} · slot {model!.activeSlot} live ·
              running generation {model!.running}
            </div>
            <div className="wd-slotgrid" role="list" aria-label="Widget slots">
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
        <span className="wd-slotcard-idx">Slot {view.slot}</span>
        <SlotStatusPill state={dataState} />
      </div>

      {dataState === "empty" && (
        <div className="wd-slotcard-empty">
          <span className="wd-slotcard-plus" aria-hidden="true">
            <Icon name="plus" size={18} />
          </span>
          <div className="wd-slotcard-name">Empty slot</div>
          <div className="wd-slotcard-emptyhint">
            {currentWidgetName ? <>Push <strong className="font-medium">{currentWidgetName}</strong> here.</> : "Push the current widget here."}
          </div>
        </div>
      )}

      {dataState === "unknown" && (
        <div className="wd-slotcard-body">
          <div className="wd-slotcard-name text-secondary">Couldn't read this slot</div>
          <div className="wd-slotcard-meta">op 5 returned no inventory.</div>
        </div>
      )}

      {(dataState === "active" || dataState === "occupied") && (
        <div className="wd-slotcard-body">
          <div className="wd-slotcard-name" title={name ?? undefined}>
            {name ?? "Unknown widget"}
          </div>
          <div className="wd-slotcard-meta wd-nums">
            <span>gen {view.generation}</span>
            <span className="wd-slotcard-dot" aria-hidden="true">·</span>
            <span className="wd-slotcard-sha font-mono" title={view.sha16}>
              {shortSha(view.sha16)}
            </span>
          </div>
          {view.active && (
            <div className="wd-slotcard-live">
              <StatusDot state="ok" />
              On screen now
            </div>
          )}
          {!name && (
            <div className="wd-slotcard-unnamed">Not in this browser's push history.</div>
          )}
        </div>
      )}

      <div className="wd-slotcard-actions">
        {dataState === "empty" && (
          <Button variant="primary" size="sm" onClick={onPush} busy={pushing} disabled={lockOthers}>
            {!pushing && <Icon name="upload" size={13} />}
            {pushing ? "Pushing…" : `Push here · gen ${view.nextGeneration}`}
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
            >
              {!activating && <Icon name="play" size={13} />}
              {activating ? "Activating…" : "Activate"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onPush}
              busy={pushing}
              disabled={lockOthers || activating}
            >
              {!pushing && <Icon name="upload" size={13} />}
              {pushing ? "Pushing…" : "Push here"}
            </Button>
          </>
        )}

        {dataState === "active" && (
          <Button variant="default" size="sm" onClick={onPush} busy={pushing} disabled={lockOthers}>
            {!pushing && <Icon name="upload" size={13} />}
            {pushing ? "Pushing…" : `Replace · gen ${view.nextGeneration}`}
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
        Live — on screen now
      </span>
      <span className="wd-slotlegend-item">
        <span className="wd-slotlegend-swatch" data-state="occupied" />
        Stored — one tap to activate
      </span>
      <span className="wd-slotlegend-item">
        <span className="wd-slotlegend-swatch" data-state="empty" />
        Empty — ready for a push
      </span>
    </div>
  );
}

function SlotScanningGrid() {
  return (
    <div className="wd-slotbank">
      <div className="wd-slotbank-meta">
        <Spinner size={12} /> Reading slot inventory…
      </div>
      <div className="wd-slotgrid" aria-hidden="true">
        {[0, 1, 2, 3].map((k) => (
          <div key={k} className="wd-slotcard" data-state="skeleton">
            <div className="wd-slotcard-head">
              <span className="wd-slotcard-idx">Slot {k}</span>
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
    const res = await device.pushWidgetToSlot(slot, (generation) =>
      actions.assembleWidgetUpload({ generation }),
    );
    if (res) {
      recordSlotPush(res.sha16, {
        name: state.displayName,
        generation: res.result.generation,
      });
      toast({
        tone: "success",
        title: `Pushed to slot ${slot}`,
        body: `Generation ${res.result.generation} persisted — activate the slot to show it now.`,
      });
    }
  };

  const onActivate = async (slot: number) => {
    const ok = await device.activateSlot(slot);
    if (ok) {
      toast({
        tone: "success",
        title: `Slot ${slot} is live`,
        body: "The keyboard switched widgets in place — no power-cycle needed.",
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
