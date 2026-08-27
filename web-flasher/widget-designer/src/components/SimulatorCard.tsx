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
  Select,
  StatusDot,
  Tooltip,
} from "./ui";
import { Icon } from "./icons";
import { useToast } from "./toast";
import { viewDiagnostics } from "./diagnosticsView";
import { EventLogList, logEntryId, peekNextLogId } from "./InspectorPanel";
import { deriveHostFeeds, feedMetaKey, useFeedMeta } from "./hostFeeds";
import { feedDisplayName } from "./HostFeedsPanel";
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
              title: "Send test data",
              render: () => <SendTestDataForm state={state} onSend={dispatch} />,
            },
          ]}
        />
      </CardContent>
    </Card>
  );
}

// ── Send test data ───────────────────────────────────────────────────────────
// The fastest answer to "does my handler work?", sitting right beside the log:
// pick one of the feeds THIS widget listens for — by the name the designer
// gave it — type the two numbers under their own labels, Send.
//
// The channel number never appears. A feed's channel is derived from its name
// by the compiler, and the picker resolves it here the same way, so a designer
// who wrote widget.on("feed.room-temp", …) sends to it by choosing
// "room-temp". Anyone who lands on this form looking for "send test data" used
// to meet a hexadecimal field they could not fill in without knowing what an
// RPC id is; now the id is something the app knows and they don't.
//
// Raw-channel entry survives as the LAST option in the picker, for poking at a
// handler the script hasn't declared yet or a channel some host app owns. It
// stays reachable and stays secondary: last in the list, named in words, and
// its field only exists once it is chosen.

/** Picker value for the raw-channel escape hatch. Not a channel — the ids are
 *  numbers, so no feed can ever collide with it. */
const RAW_TARGET = "raw";

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

function SendTestDataForm({
  state,
  onSend,
}: {
  state: DesignerState;
  onSend: (e: SimulatedEvent) => void;
}) {
  const feeds = deriveHostFeeds(state.js, state.handlers);
  const meta = useFeedMeta();

  const [target, setTarget] = React.useState<string>("");
  const [id, setId] = React.useState("");
  const [value, setValue] = React.useState("1");
  const [auxiliary, setAuxiliary] = React.useState("0");
  const [errors, setErrors] = React.useState<{ id?: string; value?: string; auxiliary?: string }>({});
  const [flash, setFlash] = React.useState(false);
  const flashTimer = React.useRef<number | undefined>(undefined);
  React.useEffect(() => () => window.clearTimeout(flashTimer.current), []);

  // Resolved on every render rather than held in state: editing the script
  // retires feeds, and a picker still pointing at a channel the widget stopped
  // listening for would send into nothing while looking correct. Falling back
  // to the first feed also means a widget with no feeds at all lands on the
  // raw entry with no extra bookkeeping.
  const feed =
    target === RAW_TARGET ? null : (feeds.find((f) => String(f.id) === target) ?? feeds[0] ?? null);
  const feedMeta = feed ? meta[feedMetaKey(state.displayName, feed.id)] : undefined;
  const feedName = feed ? feedDisplayName(feed, feedMeta) : "";
  // The designer's own labels for the two numbers when they wrote them on the
  // Host data card; otherwise the names their handler reads them by.
  const valueLabel = feedMeta?.valueLabel?.trim() || "Value";
  const auxLabel = feedMeta?.auxLabel?.trim() || "Auxiliary";

  const send = () => {
    const n = feed ? feed.id : parseRpcId(id);
    const v = parseRpcValue(value);
    const a = parseRpcValue(auxiliary);
    const next: typeof errors = {};
    if (n === null) next.id = "Enter a channel as a whole number, or as 0x hex.";
    if (v === null) next.value = "Enter a whole number.";
    if (a === null) next.auxiliary = "Enter a whole number.";
    setErrors(next);
    if (n === null || v === null || a === null) return;
    const hex = `0x${n.toString(16).toUpperCase()}`;
    onSend({
      kind: "host.rpc",
      id: n,
      value: v,
      auxiliary: a,
      displayName: `${feed ? feedName : hex} ← ${v}${a !== 0 ? ` · ${a}` : ""}`,
      description: feed ? feed.hex : "Sent by hand",
    });
    setFlash(true);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(false), 1200);
  };

  return (
    <div className="space-y-2">
      {feeds.length > 0 && (
        <div className="min-w-0">
          <Label htmlFor="sim-rpc-feed">Feed</Label>
          <Select
            id="sim-rpc-feed"
            value={feed ? String(feed.id) : RAW_TARGET}
            onChange={(e) => {
              setTarget(e.target.value);
              if (errors.id) setErrors((prev) => ({ ...prev, id: undefined }));
            }}
          >
            {feeds.map((f) => (
              <option key={f.id} value={String(f.id)}>
                {feedDisplayName(f, meta[feedMetaKey(state.displayName, f.id)])}
              </option>
            ))}
            <option value={RAW_TARGET}>Another channel…</option>
          </Select>
        </div>
      )}
      <div className="wd-sim-rpcgrid">
        {!feed && (
          <div className="min-w-0">
            <Label htmlFor="sim-rpc-id">Channel</Label>
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
        )}
        <div className="min-w-0">
          <Label htmlFor="sim-rpc-value">{valueLabel}</Label>
          <Input
            id="sim-rpc-value"
            mono
            value={value}
            inputMode="numeric"
            placeholder="1"
            aria-label={feed ? `${valueLabel} — the first number sent to ${feedName}` : undefined}
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
          <Label htmlFor="sim-rpc-aux">{auxLabel}</Label>
          <Input
            id="sim-rpc-aux"
            mono
            value={auxiliary}
            inputMode="numeric"
            placeholder="0"
            aria-label={feed ? `${auxLabel} — the second number sent to ${feedName}` : undefined}
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
        {feeds.length === 0 ? (
          <>
            This widget doesn&apos;t listen for any data yet. Add{" "}
            <code>{`widget.on("feed.my-data", function (event) { … })`}</code> to your script and it
            appears in this list, ready to test.
          </>
        ) : feed ? (
          <>
            Your handler reads these two numbers as <span className="font-mono">event.value</span> and{" "}
            <span className="font-mono">event.auxiliary</span>. Whole numbers only.
          </>
        ) : (
          <>
            Nothing happens unless your script listens for this exact channel — pick a feed above to
            send to one it already handles.
          </>
        )}
      </div>
    </div>
  );
}
