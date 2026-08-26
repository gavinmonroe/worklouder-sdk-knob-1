// ─────────────────────────────────────────────────────────────────────────────
// Simulator card — the Source rail's drive-and-observe surface.
//
// The old Events tab's DriveCard + LogCard, rehoused beside the editor: drive
// the simulator (auto-tick, sample loop, reset), watch every handled event
// land in the log, and send an arbitrary host.rpc packet — all without
// leaving the source. One dispatch grammar everywhere: the reference rail's
// "Fire sample", the host-feed Send buttons, and the custom RPC form all run
// through useSimDispatch, so a dispatch that can't reach the strict simulator
// says so in a toast instead of vanishing.
// ─────────────────────────────────────────────────────────────────────────────

import * as React from "react";
import type { DesignerState, DesignerActions } from "../designer/store";
import { AutoTickControl, autoTickReadout } from "./AutoTickControl";
import {
  Accordion,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Label,
  StatusDot,
  Tooltip,
} from "./ui";
import { Icon } from "./icons";
import { useToast } from "./toast";
import { viewDiagnostics } from "./diagnosticsView";
import { EventLogList, logEntryId, peekNextLogId } from "./InspectorPanel";
import type { SimulatedEvent } from "../types";

/**
 * The one dispatch path for the Source view: when the strict simulator can't
 * run this script, the event still drives the live preview — but it never
 * lands in the log, so the first such dispatch says so instead of silently
 * eating the click. A recompile that unblocks (or re-blocks) the sim re-arms
 * the notice.
 */
export function useSimDispatch(
  state: DesignerState,
  actions: DesignerActions,
): (event: SimulatedEvent) => void {
  const toast = useToast();
  const simBlocked = viewDiagnostics(state).simBlocked;
  const warnedRef = React.useRef(false);
  React.useEffect(() => {
    warnedRef.current = false;
  }, [simBlocked]);
  return React.useCallback(
    (event: SimulatedEvent) => {
      actions.dispatch(event);
      if (simBlocked && !warnedRef.current) {
        warnedRef.current = true;
        toast({
          tone: "warning",
          title: "Strict simulator unavailable",
          body: "The event reached the live preview, but the device simulator can't parse this script — nothing lands in the log.",
        });
      }
    },
    [actions, simBlocked, toast],
  );
}

const LOG_CARD_ROWS = 15;

export function SimulatorCard({
  state,
  actions,
  dispatch,
}: {
  state: DesignerState;
  actions: DesignerActions;
  dispatch: (event: SimulatedEvent) => void;
}) {
  const ticking = state.autoTick !== "off";

  // Event-log clear watermark: the store's rolling log is protected, so
  // "Clear" hides what's already seen until new events land. Freshness
  // baseline mirrors the Inspector's — rows landing after it flash once.
  const baseline = React.useRef<number | null>(null);
  if (baseline.current === null) {
    state.eventLog.forEach(logEntryId);
    baseline.current = peekNextLogId();
  }
  React.useEffect(() => {
    state.eventLog.forEach(logEntryId);
    baseline.current = peekNextLogId();
  });
  const [clearedBefore, setClearedBefore] = React.useState<number | null>(null);
  const visible = React.useMemo(
    () =>
      clearedBefore === null
        ? state.eventLog
        : state.eventLog.filter((e) => logEntryId(e) >= clearedBefore),
    [state.eventLog, clearedBefore],
  );
  const clear = React.useCallback(() => {
    state.eventLog.forEach(logEntryId);
    setClearedBefore(peekNextLogId());
  }, [state.eventLog]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Simulator</CardTitle>
        <CardDescription>
          Auto-tick at the firmware's cadence or replay a short timeline — every handled event lands in the
          log below.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-3 flex-wrap">
          <AutoTickControl value={state.autoTick} onChange={actions.setAutoTick} />
          <Tooltip label="Replay a 7-event timeline (ticks, knob detents, host RPC) through the simulator.">
            <Button size="sm" onClick={actions.playSampleLoop}>
              <Icon name="play" size={12} />
              Play loop
            </Button>
          </Tooltip>
          <Button size="sm" variant="ghost" onClick={actions.resetSimulator}>
            <Icon name="rotate-ccw" size={12} />
            Reset
          </Button>
          {/* Same string as the footer: "Auto-tick 1s" / "Auto-tick off". */}
          <span className="wd-ev-tickstate ml-auto" data-on={ticking || undefined}>
            <StatusDot state={ticking ? "busy" : "idle"} />
            {autoTickReadout(state.autoTick)}
          </span>
        </div>
      </CardContent>
      <CardContent className="p-0">
        <Accordion
          flush
          storageKey="sim-card"
          items={[
            {
              id: "log",
              title: "Event log",
              defaultOpen: true,
              badge: <Badge tone="muted">{visible.length}</Badge>,
              actions:
                visible.length > 0 ? (
                  <Button size="sm" variant="ghost" onClick={clear} aria-label="Clear event log">
                    Clear
                  </Button>
                ) : undefined,
              render: () =>
                visible.length === 0 ? (
                  <EmptyState
                    size="sm"
                    icon="terminal"
                    title={clearedBefore !== null ? "Log cleared" : "No events yet"}
                    hint="Fire a sample from the reference rail, start auto-tick, or turn the stage knob — every handled event lands here."
                  />
                ) : (
                  <EventLogList log={visible} newSince={baseline.current} rows={LOG_CARD_ROWS} />
                ),
            },
            {
              id: "rpc",
              title: "Custom host RPC",
              badge: (
                <Badge tone="muted" className="font-mono">
                  0x…
                </Badge>
              ),
              render: () => <CustomRpcForm onSend={dispatch} />,
            },
          ]}
        />
      </CardContent>
    </Card>
  );
}

// ── Custom host RPC ──────────────────────────────────────────────────────────
// Send ANY host.rpc packet — declared or not — for poking at handlers the
// Host data section doesn't list yet. Rail-compact: stacked fields, one Send.

function parseRpcId(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;
  const n = text.toLowerCase().startsWith("0x") ? Number.parseInt(text, 16) : Number.parseInt(text, 10);
  return Number.isFinite(n) && n >= 0 ? n >>> 0 : null;
}

function parseRpcValue(raw: string): number | null {
  const text = raw.trim();
  if (!text || !/^-?\d+$/.test(text)) return null;
  const n = Number.parseInt(text, 10);
  return Number.isFinite(n) ? n >>> 0 : null;
}

function CustomRpcForm({ onSend }: { onSend: (e: SimulatedEvent) => void }) {
  const [id, setId] = React.useState("0xB201");
  const [value, setValue] = React.useState("1");
  const [auxiliary, setAuxiliary] = React.useState("0");
  const [errors, setErrors] = React.useState<{ id?: string; value?: string; auxiliary?: string }>({});
  const [flash, setFlash] = React.useState(false);
  const flashTimer = React.useRef<number | undefined>(undefined);
  React.useEffect(() => () => window.clearTimeout(flashTimer.current), []);

  const send = () => {
    const n = parseRpcId(id);
    const v = parseRpcValue(value);
    const a = parseRpcValue(auxiliary);
    const next: typeof errors = {};
    if (n === null) next.id = "Enter a decimal or 0x-hex id.";
    if (v === null) next.value = "Enter an integer value.";
    if (a === null) next.auxiliary = "Enter an integer value.";
    setErrors(next);
    if (n === null || v === null || a === null) return;
    onSend({
      kind: "host.rpc",
      id: n,
      value: v,
      auxiliary: a,
      displayName: `0x${n.toString(16).toUpperCase()} ← ${v}${a !== 0 ? ` · ${a}` : ""}`,
      description: "Custom dispatch",
    });
    setFlash(true);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(false), 1200);
  };

  return (
    <div className="space-y-2">
      <div className="wd-sim-rpcgrid">
        <div className="min-w-0">
          <Label htmlFor="sim-rpc-id">Id — decimal or 0x hex</Label>
          <Input
            id="sim-rpc-id"
            mono
            value={id}
            inputMode="numeric"
            placeholder="0xB201"
            aria-invalid={errors.id ? true : undefined}
            aria-describedby={errors.id ? "sim-rpc-id-err" : undefined}
            onChange={(e) => {
              setId(e.target.value);
              if (errors.id) setErrors((prev) => ({ ...prev, id: undefined }));
            }}
            onKeyDown={(e) => e.key === "Enter" && send()}
          />
          {errors.id && (
            <div id="sim-rpc-id-err" className="wd-field-error">
              <Icon name="alert-triangle" size={12} />
              {errors.id}
            </div>
          )}
        </div>
        <div className="min-w-0">
          <Label htmlFor="sim-rpc-value">Value — 32-bit integer</Label>
          <Input
            id="sim-rpc-value"
            mono
            value={value}
            inputMode="numeric"
            placeholder="1"
            aria-invalid={errors.value ? true : undefined}
            aria-describedby={errors.value ? "sim-rpc-value-err" : undefined}
            onChange={(e) => {
              setValue(e.target.value);
              if (errors.value) setErrors((prev) => ({ ...prev, value: undefined }));
            }}
            onKeyDown={(e) => e.key === "Enter" && send()}
          />
          {errors.value && (
            <div id="sim-rpc-value-err" className="wd-field-error">
              <Icon name="alert-triangle" size={12} />
              {errors.value}
            </div>
          )}
        </div>
        <div className="min-w-0">
          <Label htmlFor="sim-rpc-aux">Auxiliary — 32-bit integer</Label>
          <Input
            id="sim-rpc-aux"
            mono
            value={auxiliary}
            inputMode="numeric"
            placeholder="0"
            aria-invalid={errors.auxiliary ? true : undefined}
            aria-describedby={errors.auxiliary ? "sim-rpc-aux-err" : undefined}
            onChange={(e) => {
              setAuxiliary(e.target.value);
              if (errors.auxiliary) setErrors((prev) => ({ ...prev, auxiliary: undefined }));
            }}
            onKeyDown={(e) => e.key === "Enter" && send()}
          />
          {errors.auxiliary && (
            <div id="sim-rpc-aux-err" className="wd-field-error">
              <Icon name="alert-triangle" size={12} />
              {errors.auxiliary}
            </div>
          )}
        </div>
      </div>
      <div className="flex justify-end">
        <Button size="sm" variant="primary" onClick={send} data-flash={flash ? "ok" : undefined}>
          <Icon name={flash ? "check" : "send"} size={12} />
          {flash ? "Sent" : "Send"}
        </Button>
      </div>
      <div className="wd-ins-note">
        Only ids with a declared <span className="font-mono">host.rpc:…</span> handler are consumed by your
        widget.
      </div>
    </div>
  );
}
