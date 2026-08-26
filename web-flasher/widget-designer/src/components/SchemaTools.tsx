// ─────────────────────────────────────────────────────────────────────────────
// Snapshot schemas (advanced) — the declare / test / serve / edit workflow for
// widget.snapshot()-style host data.
//
// This is the former Host data tab's schema machinery, rehoused: the primary
// host-data story is now the derived-feed model in HostFeedsPanel (every
// host.rpc handler the source declares is a feed, automatically). Snapshot
// schemas are a preview-runtime notion the v3 DSL cannot express, so this
// surface renders only when the widget actually uses one (state.hostData is
// non-empty, the script calls widget.snapshot) or Legacy tools is on — and
// everything in here keeps working exactly as before when revealed:
//
//   1. Declare  — edit the widget's own schema (records, fields, widths)
//   2. Test     — type values and send them straight into the live preview
//   3. Serve    — download a runnable Node server generated from that schema
//   4. Connect  — point at your running server and fetch real values
//
// Presentation rules are unchanged: values sit NEXT to their keys (one packed
// grid), inner grouping is inset wells — never nested cards — and every async
// action answers at the click site.
// ─────────────────────────────────────────────────────────────────────────────

import * as React from "react";

import type { DesignerActions, DesignerState } from "../designer/store";
import {
  createEmptySchema,
  encodeSnapshot,
  fieldOffsets,
  packRecord,
  type RecordSpec,
  type SnapshotSchema,
} from "../data/schemas";
import { defaultEndpoint, fieldRange, generateHostServer, serverResponseShape } from "../compiler/hostServer";
import { WEATHER_SNAPSHOT_EVENTS, type SampleEvent } from "../events/samples";
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
  Input,
  Label,
  SegmentedControl,
  Select,
  Tooltip,
} from "./ui";
import { Icon } from "./icons";
import { useToast } from "./toast";
import { useLegacyTools } from "./legacyTools";
import CodeMirrorEditor from "./CodeMirrorEditor";
import { CodeBlock, RunWell, download } from "./serverTools";
import { KindText } from "./InspectorPanel";
import type { SimulatedEvent } from "../types";

const hex = (n: number) => `0x${n.toString(16).toUpperCase()}`;

export function SchemaTools({
  state,
  actions,
  dispatch,
}: {
  state: DesignerState;
  actions: DesignerActions;
  /** The Source view's wrapped dispatch (strict-sim toast included) — drives
   *  the legacy Weather-snapshot sample sequence. */
  dispatch: (event: SimulatedEvent) => void;
}) {
  const legacy = useLegacyTools();
  const names = Object.keys(state.hostData);
  const [selected, setSelected] = React.useState<string | null>(names[0] ?? null);
  const active = selected && state.hostData[selected] ? selected : names[0] ?? null;
  const schema = active ? state.hostData[active] : null;

  // External schema changes (preset switch, JSON apply) remount the stateful
  // cards below with fresh baselines; local typing never remounts anything.
  const schemaKey = schema ? `${active}:${JSON.stringify(schema)}` : "";

  return (
    <>
      {!schema || !active ? (
        <Card>
          <CardHeader>
            <CardTitle>Snapshot schemas</CardTitle>
            <CardDescription>
              Declare a schema and it gets a testable RPC channel and a runnable server. Your script reads it
              with <span className="font-mono">{`widget.snapshot("data", { apply: function (d) { … } })`}</span> —
              a preview-runtime API, separate from the raw <span className="font-mono">host.rpc</span> feeds above.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EmptyState
              size="sm"
              icon="cable"
              title="This widget declares no snapshot schema"
              hint="Optional and advanced: most widgets read raw host.rpc feeds instead (see Host data above)."
              action={
                <Button
                  variant="primary"
                  onClick={() => {
                    actions.setHostData({ ...state.hostData, data: createEmptySchema() });
                    setSelected("data");
                  }}
                >
                  <Icon name="plus" size={14} />
                  Add a host-data schema
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <>
          {names.length > 1 && (
            <div className="flex items-center gap-2">
              <span className="wd-overline">Schema</span>
              <SegmentedControl
                semantics="radio"
                aria-label="Active host-data schema"
                value={active}
                onValueChange={setSelected}
                items={names.map((n) => ({ id: n, label: <span className="font-mono">{n}</span> }))}
              />
            </div>
          )}
          <SchemaCard name={active} schema={schema} />
          <TestBench key={`test-${schemaKey}`} name={active} schema={schema} actions={actions} />
          <ServerCard
            widgetName={state.displayName}
            name={active}
            schema={schema}
            hostData={state.hostData}
            onDispatch={actions.dispatch}
          />
          <SchemaEditor key={`edit-${schemaKey}`} name={active} schema={schema} state={state} actions={actions} />
        </>
      )}
      {legacy && <WeatherSnapshotCard dispatch={dispatch} />}
    </>
  );
}

// ── Legacy sample sequence ───────────────────────────────────────────────────
// The old Events tab's Weather-snapshot group — a full begin → records →
// commit sequence generated from WEATHER_SCHEMA. Schema-driven, so it lives
// with the schema tools; Legacy tools reveals it.

function WeatherSnapshotCard({ dispatch }: { dispatch: (event: SimulatedEvent) => void }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <CardTitle>Weather snapshot sample</CardTitle>
            <CardDescription>
              A full begin → records → commit sequence; the widget applies it atomically. Click a row to
              dispatch it, or send the whole sequence in order.
            </CardDescription>
          </div>
          <Tooltip label="Dispatch the whole sequence in order, one event every 120 ms.">
            <Button size="sm" variant="ghost" onClick={() => playSequence(WEATHER_SNAPSHOT_EVENTS, dispatch)}>
              <Icon name="play" size={12} />
              Send all
            </Button>
          </Tooltip>
        </div>
      </CardHeader>
      <CardContent>
        <SampleList events={WEATHER_SNAPSHOT_EVENTS} onDispatch={dispatch} />
      </CardContent>
    </Card>
  );
}

/** Dispatch a list with a firmware-ish cadence so staged sequences (begin →
 *  records → commit) arrive the way a host would actually send them. */
function playSequence(events: SampleEvent[], dispatch: (e: SimulatedEvent) => void) {
  events.forEach((s, i) => {
    window.setTimeout(() => dispatch(s.event), i * 120);
  });
}

type LogFamily = "tick" | "input" | "host" | "sys";

function familyOf(kind: string): LogFamily {
  if (kind.startsWith("tick.")) return "tick";
  if (kind.startsWith("input.")) return "input";
  if (kind.startsWith("host.")) return "host";
  return "sys";
}

/** Structured payload text for a sample event — mirrors the log's grammar
 *  (`id=0xB201 v=7`, `mask=0b0011`) so a dispatched row and its log entry
 *  read as the same object. Knob deltas render as the signed chip instead. */
function payloadOf(e: SimulatedEvent): { detail: string | null; delta: number | null } {
  if (e.kind === "input.fn-bottom-knob") return { detail: null, delta: e.delta };
  if (e.kind === "host.rpc") {
    return {
      detail: `id=0x${e.id.toString(16).toUpperCase()} v=${e.value}${e.auxiliary != null ? ` aux=${e.auxiliary}` : ""}`,
      delta: null,
    };
  }
  if (e.kind === "input.key.down" || e.kind === "input.key.up" || e.kind === "input.key.hold") {
    return { detail: `id=${e.id}`, delta: null };
  }
  if (e.kind === "input.chord.down" || e.kind === "input.chord.up") {
    return { detail: `mask=0b${e.mask.toString(2).padStart(4, "0")}`, delta: null };
  }
  return { detail: null, delta: null };
}

function SampleList({
  events,
  onDispatch,
}: {
  events: SampleEvent[];
  onDispatch: (e: SimulatedEvent) => void;
}) {
  // Click-site acknowledgement: the fired row swaps its play glyph for a
  // check for a beat. Keyed by index — rows are static per group.
  const [sentIdx, setSentIdx] = React.useState<number | null>(null);
  const timerRef = React.useRef<number | undefined>(undefined);
  React.useEffect(() => () => window.clearTimeout(timerRef.current), []);
  const fire = (s: SampleEvent, i: number) => {
    onDispatch(s.event);
    setSentIdx(i);
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setSentIdx(null), 900);
  };
  return (
    // role="list" restores the list semantics Safari drops on list-style:none.
    <ul className="wd-ev-list" role="list">
      {events.map((s, i) => {
        const { detail, delta } = payloadOf(s.event);
        return (
          <li key={i} className="wd-ev-li">
            <button
              type="button"
              className="wd-evrow"
              data-family={familyOf(s.event.kind)}
              data-sent={sentIdx === i || undefined}
              onClick={() => fire(s, i)}
              aria-label={`Dispatch ${s.label}`}
            >
              <span className="wd-ins-logdot" aria-hidden="true" />
              <span className="wd-evrow-kind">
                <KindText kind={s.event.kind} withTitle={false} />
                {detail && <span className="wd-evrow-detail">{detail}</span>}
                {delta !== null && (
                  <span className="wd-ins-logdelta" data-neg={delta < 0 || undefined}>
                    {delta > 0 ? `+${delta}` : delta}
                  </span>
                )}
              </span>
              <span className="wd-evrow-desc">{s.description}</span>
              <span className="wd-evrow-action" aria-hidden="true">
                <Icon name={sentIdx === i ? "check" : "play"} size={12} />
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// ── Declare ──────────────────────────────────────────────────────────────────
// Derived layout: every offset and range comes from the declaration. One
// packed grid — field · bits@offset · range · labels — with record headers
// spanning the row, so values never drift to the far edge of a wide card.

function SchemaCard({ name, schema }: { name: string; schema: SnapshotSchema }) {
  return (
    <Card>
      <CardHeader>
        {/* Deterministic head anatomy: the title block is flex-1 (basis 0),
            so a long description can never push the begin/commit chips onto
            their own row — the chips ALWAYS sit in the head's right slot and
            only genuine width pressure wraps them, identically for a
            single-field custom schema and the five-record weather schema. */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0 grow shrink" style={{ flexBasis: "14rem" }}>
            <CardTitle>
              Schema · <span className="font-mono">{name}</span>
            </CardTitle>
            <CardDescription>
              Offsets are derived from declaration order — nobody writes one. Your script reads this with{" "}
              <span className="font-mono">{`widget.snapshot("${name}", …)`}</span>.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Tooltip label="RPC id that announces the next revision before records are staged.">
              <Badge tone="neutral" className="font-mono">begin {hex(schema.begin)}</Badge>
            </Tooltip>
            <Tooltip label="RPC id that atomically applies the staged snapshot.">
              <Badge tone="neutral" className="font-mono">commit {hex(schema.commit)}</Badge>
            </Tooltip>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="wd-hd-table" role="table" aria-label={`${name} schema layout`}>
          <div className="wd-hd-tr" role="row">
            <span className="wd-hd-th" role="columnheader">Field</span>
            <span className="wd-hd-th" role="columnheader">Bits @ offset</span>
            <span className="wd-hd-th" role="columnheader">Range</span>
            <span className="wd-hd-th" role="columnheader">Labels</span>
          </div>
          {Object.entries(schema.records).map(([recordName, record]) => {
            const offsets = fieldOffsets(record);
            return (
              <React.Fragment key={recordName}>
                <div className="wd-hd-rec" role="row">
                  <span role="cell" className="wd-hd-recname">
                    {recordName}
                    <Badge tone="neutral" className="font-mono">{hex(record.id)}</Badge>
                  </span>
                </div>
                {Object.entries(record.fields).map(([field, spec]) => (
                  <div key={`${recordName}.${field}`} className="wd-hd-tr" role="row">
                    <span className="wd-hd-td" data-strong="true" role="cell">{field}</span>
                    <span className="wd-hd-td wd-nums" role="cell">
                      {spec.bits}b <span className="wd-hd-dim">@{offsets[field]}</span>
                    </span>
                    <span className="wd-hd-td wd-nums" role="cell">{fieldRange(spec.bits, spec.signed)}</span>
                    <span className="wd-hd-td" role="cell">
                      {spec.labels ? (
                        <span className="wd-hd-labels">
                          {spec.labels.map((label, i) => (
                            <span key={label} className="wd-hd-label">
                              <span className="wd-hd-dim">{i}</span>
                              {label}
                            </span>
                          ))}
                        </span>
                      ) : (
                        <span className="wd-hd-none">none</span>
                      )}
                    </span>
                  </div>
                ))}
              </React.Fragment>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Test ─────────────────────────────────────────────────────────────────────
// Type values, send them into the live preview. Fields hold raw strings and
// validate on send — a bad value marks ITS field and names itself, instead of
// silently coercing to 0.

function TestBench({
  name,
  schema,
  actions,
}: {
  name: string;
  schema: SnapshotSchema;
  actions: DesignerActions;
}) {
  const toast = useToast();
  const [values, setValues] = React.useState<Record<string, Record<string, string>>>(() => {
    const shape = serverResponseShape(schema);
    const out: Record<string, Record<string, string>> = {};
    for (const [rec, fields] of Object.entries(shape)) {
      out[rec] = {};
      for (const [field, v] of Object.entries(fields)) out[rec][field] = String(v);
    }
    return out;
  });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [flash, setFlash] = React.useState(false);
  const flashTimer = React.useRef<number | undefined>(undefined);
  React.useEffect(() => () => window.clearTimeout(flashTimer.current), []);

  const send = () => {
    const nextErrors: Record<string, string> = {};
    const numeric: Record<string, Record<string, number>> = {};
    for (const [recordName, record] of Object.entries(schema.records)) {
      numeric[recordName] = {};
      for (const field of Object.keys(record.fields)) {
        const raw = (values[recordName]?.[field] ?? "").trim();
        if (!/^-?\d+$/.test(raw)) {
          nextErrors[`${recordName}.${field}`] = "Enter an integer.";
          continue;
        }
        numeric[recordName][field] = Number.parseInt(raw, 10);
      }
    }
    // Width validation against the declaration, per record so the offending
    // field name survives into the error.
    if (Object.keys(nextErrors).length === 0) {
      for (const [recordName, record] of Object.entries(schema.records)) {
        try {
          packRecord(record, numeric[recordName]);
        } catch (cause) {
          const message = (cause as Error).message;
          const field = /^"([^"]+)"/.exec(message)?.[1];
          nextErrors[field ? `${recordName}.${field}` : `${recordName}.*`] = message;
        }
      }
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const revision = Math.floor(Date.now() / 1000) % 0x7fffffff;
    for (const { id, value } of encodeSnapshot(schema, revision, numeric)) {
      actions.dispatch({ kind: "host.rpc", id, value, displayName: `${hex(id)} test` });
    }
    setFlash(true);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(false), 1200);
    toast({
      tone: "success",
      title: "Snapshot sent to the preview",
      body: `Revision ${revision.toLocaleString()} — begin, ${Object.keys(schema.records).length} records, commit.`,
    });
  };

  const recordError = (recordName: string) => errors[`${recordName}.*`];
  const records = Object.entries(schema.records);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Test values</CardTitle>
        <CardDescription>
          Send these straight into the live preview — no server needed. Out-of-range values are rejected by
          field name instead of wrapping silently.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {records.map(([recordName, record]) => (
          <div key={recordName}>
            {/* Same voice as the schema table's record rows — mono name +
                hex badge. Two label tiers on this tab, never three. */}
            <div className="wd-hd-rechead">
              <span>{recordName}</span>
              <Badge tone="neutral" className="font-mono">{hex(record.id)}</Badge>
            </div>
            {/* Fields span the FULL card width on a fluid grid (3–4 columns
                at desktop). Labeled enums pick by name — the same labels the
                schema table shows — with the raw value in the mono readout
                below; free-number inputs remain only for unlabeled ranges. */}
            <div className="wd-hd-fieldgrid">
              {Object.entries(record.fields).map(([field, spec]) => {
                const key = `${recordName}.${field}`;
                const error = errors[key];
                const id = `hd-${name}-${key}`.replace(/[^\w-]/g, "-");
                const raw = values[recordName]?.[field] ?? "";
                const setField = (next: string) => {
                  setValues((prev) => ({
                    ...prev,
                    [recordName]: { ...prev[recordName], [field]: next },
                  }));
                  if (error) {
                    setErrors((prev) => {
                      const rest = { ...prev };
                      delete rest[key];
                      return rest;
                    });
                  }
                };
                const labels = spec.labels;
                // A raw value that maps onto a declared label picks it;
                // anything else (hand-edited JSON, stale draft) falls into an
                // explicit "custom" option instead of silently snapping to 0.
                const selectedIdx =
                  labels && /^\d+$/.test(raw.trim()) && Number(raw.trim()) < labels.length
                    ? String(Number(raw.trim()))
                    : null;
                return (
                  <div key={field} className="min-w-0">
                    <Label htmlFor={id} className="font-mono">
                      {field}
                    </Label>
                    {labels ? (
                      <>
                        <Select
                          id={id}
                          value={selectedIdx ?? "__custom"}
                          aria-describedby={error ? `${id}-err` : `${id}-range`}
                          onChange={(e) => setField(e.target.value)}
                        >
                          {labels.map((label, i) => (
                            <option key={label} value={String(i)}>
                              {i} · {label}
                            </option>
                          ))}
                          {selectedIdx === null && (
                            <option value="__custom" disabled>
                              {raw === "" ? "—" : raw} (out of range)
                            </option>
                          )}
                        </Select>
                        {error && (
                          <div id={`${id}-err`} className="wd-field-error">
                            <Icon name="alert-triangle" size={12} />
                            {error}
                          </div>
                        )}
                        <div id={`${id}-range`} className="wd-hd-hint wd-nums font-mono">
                          = {raw === "" ? "—" : raw} · {fieldRange(spec.bits, spec.signed)}
                        </div>
                      </>
                    ) : (
                      <>
                        <Input
                          id={id}
                          mono
                          inputMode="numeric"
                          value={raw}
                          aria-invalid={error ? true : undefined}
                          aria-describedby={error ? `${id}-err` : `${id}-range`}
                          onChange={(e) => setField(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && send()}
                        />
                        {error && (
                          <div id={`${id}-err`} className="wd-field-error">
                            <Icon name="alert-triangle" size={12} />
                            {error}
                          </div>
                        )}
                        <div id={`${id}-range`} className="wd-hd-hint wd-nums">
                          {fieldRange(spec.bits, spec.signed)}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            {recordError(recordName) && (
              <Callout tone="danger" className="mt-2">{recordError(recordName)}</Callout>
            )}
          </div>
        ))}
        {/* The form's one action lives in a real footer — full-bleed hairline,
            right-aligned — matching the Apply/Revert rhythm of Edit schema. */}
        <div className="wd-form-footer">
          <Button variant="primary" onClick={send} data-flash={flash ? "ok" : undefined}>
            <Icon name={flash ? "check" : "send"} size={14} />
            {flash ? "Sent" : "Send to preview"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Serve & connect ──────────────────────────────────────────────────────────

function ServerCard({
  widgetName,
  name,
  schema,
  hostData,
  onDispatch,
}: {
  widgetName: string;
  name: string;
  schema: SnapshotSchema;
  hostData: Record<string, SnapshotSchema>;
  onDispatch: DesignerActions["dispatch"];
}) {
  const toast = useToast();
  const source = React.useMemo(() => {
    try {
      return generateHostServer(widgetName, hostData);
    } catch (cause) {
      return `// ${(cause as Error).message}`;
    }
  }, [widgetName, hostData]);
  const slug =
    widgetName.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "") || "widget";
  const [copied, setCopied] = React.useState(false);
  const copyTimer = React.useRef<number | undefined>(undefined);
  React.useEffect(() => () => window.clearTimeout(copyTimer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
      window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ tone: "warning", title: "Clipboard unavailable", body: "Download the file instead." });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your server</CardTitle>
        <CardDescription>
          Generated from this widget's schema. It returns plain numbers — the Designer does the packing, RPC
          ids, and commit sequencing.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Secondary on purpose: a file download must not shout in the same
              ember the app's real primaries use — "Send to preview" owns the
              tab's one accent fill. */}
          <Button onClick={() => download(`${slug}-host.mjs`, source)}>
            <Icon name="download" size={14} />
            Download {slug}-host.mjs
          </Button>
          <Button onClick={copy}>
            <Icon name={copied ? "check" : "copy"} size={14} />
            {copied ? "Copied" : "Copy source"}
          </Button>
          <code className="wd-hd-cmd">node {slug}-host.mjs</code>
        </div>

        <CodeBlock label={`Expected response · GET /${name}`}>
          {JSON.stringify({ values: serverResponseShape(schema) }, null, 2)}
        </CodeBlock>

        <RunWell source={source} />
        <ConnectWell name={name} schema={schema} onDispatch={onDispatch} />
      </CardContent>
    </Card>
  );
}

/**
 * Fetch live values from the running server and send them to the preview.
 * The same validation the test bench uses runs against the server's response,
 * so a wrong shape names the offending record or field instead of rendering
 * nonsense.
 */
function ConnectWell({
  name,
  schema,
  onDispatch,
}: {
  name: string;
  schema: SnapshotSchema;
  onDispatch: DesignerActions["dispatch"];
}) {
  const toast = useToast();
  const [url, setUrl] = React.useState(() => defaultEndpoint(name));
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(url.trim());
      if (!response.ok) throw new Error(`Server returned HTTP ${response.status}`);
      const payload = await response.json();
      const values = payload?.values;
      if (!values || typeof values !== "object") throw new Error("Response has no `values` object.");
      for (const [recordName, record] of Object.entries(schema.records)) {
        if (!values[recordName]) throw new Error(`Response is missing record "${recordName}".`);
        packRecord(record as RecordSpec, values[recordName]);
      }
      const revision = Math.floor(Date.now() / 1000) % 0x7fffffff;
      for (const { id, value } of encodeSnapshot(schema, revision, values)) {
        onDispatch({ kind: "host.rpc", id, value, displayName: `${hex(id)} live` });
      }
      toast({
        tone: "success",
        title: "Live values sent to the preview",
        body: payload.note ? `From ${payload.note} · revision ${revision.toLocaleString()}.` : `Revision ${revision.toLocaleString()}.`,
      });
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wd-well space-y-2">
      <div className="wd-overline">Connect to your running server</div>
      <div className="wd-hd-connect">
        <Input
          mono
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          aria-label="Server endpoint URL"
          onKeyDown={(e) => e.key === "Enter" && !busy && run()}
        />
        <Button onClick={run} busy={busy}>
          {!busy && <Icon name="send" size={14} />}
          {busy ? "Fetching…" : "Fetch and send"}
        </Button>
      </div>
      {error && <Callout tone="danger">Fetch failed: {error}</Callout>}
    </div>
  );
}

// ── Edit ─────────────────────────────────────────────────────────────────────
// The schema itself, as JSON, so a custom widget can define its own. The card
// remounts (key on schema identity) whenever the schema changes externally,
// so the draft can never silently describe a previous widget.

function SchemaEditor({
  name,
  schema,
  state,
  actions,
}: {
  name: string;
  schema: SnapshotSchema;
  state: DesignerState;
  actions: DesignerActions;
}) {
  const toast = useToast();
  const baseline = React.useMemo(() => JSON.stringify(schema, null, 2), [schema]);
  const [draft, setDraft] = React.useState(baseline);
  const [error, setError] = React.useState<string | null>(null);
  const dirty = draft !== baseline;

  const apply = () => {
    try {
      const parsed = JSON.parse(draft) as SnapshotSchema;
      // fieldOffsets throws if a record overflows its 32-bit payload, so this
      // rejects an unusable schema before it reaches the widget.
      for (const record of Object.values(parsed.records ?? {})) fieldOffsets(record);
      actions.setHostData({ ...state.hostData, [name]: parsed });
      setError(null);
      toast({
        tone: "success",
        title: "Schema applied",
        body: "Offsets, ranges, the test bench, and the generated server all follow the new declaration.",
      });
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle>Edit schema</CardTitle>
            <CardDescription>
              Fields are packed in declaration order; widths must total 32 bits or fewer per record.
            </CardDescription>
          </div>
          {dirty && <Badge tone="accent">edited</Badge>}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* The SAME editor chrome as the Source tab — CodeMirror with the
            token theme, line numbers, JSON highlighting, and in-editor lint
            on parse errors. No native resize grip, no second editor voice. */}
        <div className="wd-editor">
          <div className="wd-hd-editorbody">
            <CodeMirrorEditor
              value={draft}
              language="json"
              onChange={setDraft}
              ariaLabel={`${name} schema JSON`}
            />
          </div>
        </div>
        {error && <Callout tone="danger">{error}</Callout>}
        <div className="flex items-center gap-2">
          <Button variant="primary" onClick={apply} disabled={!dirty}>
            Apply schema
          </Button>
          <Button
            variant="ghost"
            disabled={!dirty}
            onClick={() => {
              setDraft(baseline);
              setError(null);
            }}
          >
            <Icon name="rotate-ccw" size={14} />
            Revert
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
