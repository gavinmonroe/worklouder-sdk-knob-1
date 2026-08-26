// ─────────────────────────────────────────────────────────────────────────────
// Host data, derived from the source.
//
// No "Create Schema" cliff: the script IS the declaration. Every host.rpc
// handler the transpiler finds becomes a feed card automatically — the user
// names it, labels its two integer payload fields in plain language, types
// test values and Sends them into the running simulator, and copies a feeder
// (the code their computer runs) that serves the same numbers. Nobody touches
// bits or bytes: it's "what value am I setting for what feed", start to end.
//
// The old snapshot-schema workflow survives intact behind the "Snapshot
// schemas (advanced)" disclosure (SchemaTools) — shown only when the widget
// actually uses one or Legacy tools is on.
// ─────────────────────────────────────────────────────────────────────────────

import * as React from "react";
import type { DesignerActions, DesignerState } from "../designer/store";
import { deriveHostFeeds, feedMetaKey, setFeedMeta, useFeedMeta, type HostFeed } from "./hostFeeds";
import {
  FEED_SERVER_PORT,
  feedServerEndpoint,
  feedServerSlug,
  generateFeedServer,
} from "./feedServer";
import { SchemaTools } from "./SchemaTools";
import { CodeBlock, RunWell, download } from "./serverTools";
import {
  Accordion,
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
  Tooltip,
} from "./ui";
import { Icon } from "./icons";
import { useToast } from "./toast";
import { useLegacyTools } from "./legacyTools";
import type { SimulatedEvent } from "../types";

// The empty state's insertable example — a fully commented feed handler. It
// stays a SINGLE handler on purpose: the strict simulator refuses duplicate
// registrations per kind, so the example must never collide with a tick.1s
// (or any other) handler the script already has. Transpiles as-is (covered
// by test); the comment carries the heartbeat-republish teaching instead.
const EXAMPLE_FEED_PRELUDE = "var feed = 0;";
const EXAMPLE_FEED_SNIPPET = `// Host feed: the Designer lists this id under Host data automatically.
widget.on("host.rpc:0xB301", function (event) {
  // event.value and event.auxiliary are the two integers your feeder sends.
  feed = clamp(event.value, 0, 999);
  document.querySelector("#value").textContent = digits(feed, 3);
  // Tip: also repaint this target in your tick.1s heartbeat so the number
  // stays on screen from boot.
});`;

const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;

function parseFieldInt(raw: string): number | null {
  const text = raw.trim();
  if (!/^-?\d+$/.test(text)) return null;
  const n = Number.parseInt(text, 10);
  if (!Number.isFinite(n) || n < INT32_MIN || n > INT32_MAX) return null;
  return n;
}

export function HostFeedsPanel({
  state,
  actions,
  dispatch,
  dirty,
  onInsert,
  onReveal,
  containerRef,
}: {
  state: DesignerState;
  actions: DesignerActions;
  /** The Source view's wrapped dispatch (strict-sim toast included). */
  dispatch: (event: SimulatedEvent) => void;
  /** True while the JS buffer differs from the committed source (Apply mode). */
  dirty: boolean;
  /** Insert a snippet into the JS buffer at the cursor. */
  onInsert: (snippet: string, prelude?: string) => void;
  /** Scroll the editor to the first occurrence of `needle`. */
  onReveal: (needle: string) => void;
  /** For the ?tab=hostdata deep link — App scrolls this card into view. */
  containerRef?: React.Ref<HTMLDivElement>;
}) {
  const legacy = useLegacyTools();
  const feeds = deriveHostFeeds(state.js, state.handlers);

  // The advanced schema workflow appears only when it's actually in play.
  const schemaRelevant =
    Object.keys(state.hostData).length > 0 || /widget\s*\.\s*snapshot\s*\(/.test(state.js) || legacy;
  const [schemaOpen, setSchemaOpen] = React.useState(() => {
    try {
      return localStorage.getItem("wd-schema-tools") === "open";
    } catch {
      return false;
    }
  });
  const toggleSchema = () => {
    setSchemaOpen((open) => {
      const next = !open;
      try {
        localStorage.setItem("wd-schema-tools", next ? "open" : "closed");
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  };

  return (
    <div ref={containerRef} className="space-y-4 min-w-0">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <CardTitle>Host data</CardTitle>
              <CardDescription>
                Derived from your source — every <span className="font-mono">host.rpc:&lt;id&gt;</span>{" "}
                handler in the script is a feed the outside world can drive. Name it, label its two
                numbers, and test it live.
              </CardDescription>
            </div>
            {dirty && (
              <Tooltip label="Feeds reflect the applied source — Apply your edits and this list follows.">
                <Badge tone="muted">reflects applied source</Badge>
              </Tooltip>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {feeds.length === 0 ? (
            <EmptyState
              size="sm"
              icon="cable"
              title="This script declares no host feeds yet"
              hint={
                <>
                  Add <code>{`widget.on("host.rpc:0x…", function (event) { … })`}</code> to your script
                  and it appears here automatically — no schema, no setup.
                </>
              }
              action={
                <Button
                  variant="primary"
                  onClick={() => onInsert(EXAMPLE_FEED_SNIPPET, EXAMPLE_FEED_PRELUDE)}
                >
                  <Icon name="plus" size={14} />
                  Insert example handler
                </Button>
              }
            />
          ) : (
            feeds.map((feed) => (
              <FeedCard
                key={feed.id}
                feed={feed}
                widgetName={state.displayName}
                dispatch={dispatch}
                onReveal={onReveal}
              />
            ))
          )}
        </CardContent>
        {feeds.length > 0 && (
          <CardContent className="p-0">
            <Accordion
              flush
              storageKey="host-feeds"
              items={[
                {
                  id: "feeder",
                  title: "Feeder — run it on your computer",
                  badge: <Badge tone="muted">Node</Badge>,
                  render: () => <FeederSection state={state} feeds={feeds} dispatch={dispatch} />,
                },
              ]}
            />
          </CardContent>
        )}
        {schemaRelevant && (
          <CardContent className="pt-0">
            <button
              type="button"
              className="wd-disclose"
              aria-expanded={schemaOpen}
              onClick={toggleSchema}
            >
              <Icon name="chevron-right" size={12} className="wd-disclose-chevron" />
              Snapshot schemas (advanced)
            </button>
          </CardContent>
        )}
      </Card>
      {schemaRelevant && schemaOpen && (
        <SchemaTools state={state} actions={actions} dispatch={dispatch} />
      )}
    </div>
  );
}

// ── One feed ─────────────────────────────────────────────────────────────────
// A well, never a nested card: editable name · handler jump chip on the head
// line, then value/auxiliary inputs with user-editable plain-language labels
// and the Send action on the same packed grid.

function FeedCard({
  feed,
  widgetName,
  dispatch,
  onReveal,
}: {
  feed: HostFeed;
  widgetName: string;
  dispatch: (event: SimulatedEvent) => void;
  onReveal: (needle: string) => void;
}) {
  const metaKey = feedMetaKey(widgetName, feed.id);
  const meta = useFeedMeta()[metaKey] ?? {};
  const valueLabel = meta.valueLabel || "value";
  const auxLabel = meta.auxLabel || "auxiliary";
  const value = meta.value ?? "0";
  const auxiliary = meta.auxiliary ?? "0";

  const [errors, setErrors] = React.useState<{ value?: string; auxiliary?: string }>({});
  const [flash, setFlash] = React.useState(false);
  const flashTimer = React.useRef<number | undefined>(undefined);
  React.useEffect(() => () => window.clearTimeout(flashTimer.current), []);

  const send = () => {
    const v = parseFieldInt(value);
    const a = parseFieldInt(auxiliary);
    const next: typeof errors = {};
    if (v === null) next.value = "Enter a whole number (32-bit range).";
    if (a === null) next.auxiliary = "Enter a whole number (32-bit range).";
    setErrors(next);
    if (v === null || a === null) return;
    dispatch({
      kind: "host.rpc",
      id: feed.id,
      value: v,
      auxiliary: a,
      displayName: `${feed.hex} ← ${v}${a !== 0 ? ` · ${a}` : ""}`,
      description: meta.name || undefined,
    });
    setFlash(true);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(false), 1200);
  };

  const inputId = (part: string) => `feed-${feed.id.toString(16)}-${part}`;

  return (
    <div className="wd-well wd-feed">
      <div className="wd-feed-head">
        <input
          className="wd-feed-name"
          value={meta.name ?? ""}
          placeholder="Name this feed"
          aria-label={`Friendly name for feed ${feed.hex}`}
          onChange={(e) => setFeedMeta(metaKey, { name: e.target.value })}
        />
        <Tooltip label="Jump to this handler in the editor">
          <button
            type="button"
            className="wd-feed-chip"
            onClick={() => onReveal(feed.selector)}
            aria-label={`Jump to the ${feed.selector} handler in the source`}
          >
            {feed.selector}
          </button>
        </Tooltip>
      </div>
      <div className="wd-feed-grid">
        <div className="min-w-0">
          <input
            className="wd-feed-fieldlabel"
            value={meta.valueLabel ?? ""}
            placeholder="value"
            aria-label={`Plain-language label for ${feed.hex}'s value field`}
            onChange={(e) => setFeedMeta(metaKey, { valueLabel: e.target.value })}
          />
          <Input
            id={inputId("value")}
            mono
            inputMode="numeric"
            value={value}
            aria-label={`${valueLabel} — the value payload for ${feed.hex}`}
            aria-invalid={errors.value ? true : undefined}
            aria-describedby={errors.value ? `${inputId("value")}-err` : undefined}
            onChange={(e) => {
              setFeedMeta(metaKey, { value: e.target.value });
              if (errors.value) setErrors((prev) => ({ ...prev, value: undefined }));
            }}
            onKeyDown={(e) => e.key === "Enter" && send()}
          />
          {errors.value && (
            <div id={`${inputId("value")}-err`} className="wd-field-error">
              <Icon name="alert-triangle" size={12} />
              {errors.value}
            </div>
          )}
        </div>
        <div className="min-w-0">
          <input
            className="wd-feed-fieldlabel"
            value={meta.auxLabel ?? ""}
            placeholder="auxiliary"
            aria-label={`Plain-language label for ${feed.hex}'s auxiliary field`}
            onChange={(e) => setFeedMeta(metaKey, { auxLabel: e.target.value })}
          />
          <Input
            id={inputId("aux")}
            mono
            inputMode="numeric"
            value={auxiliary}
            aria-label={`${auxLabel} — the auxiliary payload for ${feed.hex}`}
            aria-invalid={errors.auxiliary ? true : undefined}
            aria-describedby={errors.auxiliary ? `${inputId("aux")}-err` : undefined}
            onChange={(e) => {
              setFeedMeta(metaKey, { auxiliary: e.target.value });
              if (errors.auxiliary) setErrors((prev) => ({ ...prev, auxiliary: undefined }));
            }}
            onKeyDown={(e) => e.key === "Enter" && send()}
          />
          {errors.auxiliary && (
            <div id={`${inputId("aux")}-err`} className="wd-field-error">
              <Icon name="alert-triangle" size={12} />
              {errors.auxiliary}
            </div>
          )}
        </div>
        <div className="wd-feed-send">
          <Button variant="primary" onClick={send} data-flash={flash ? "ok" : undefined}>
            <Icon name={flash ? "check" : "send"} size={14} />
            {flash ? "Sent" : "Send"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Feeder ───────────────────────────────────────────────────────────────────

function feedsForServer(widgetName: string, feeds: HostFeed[], meta: ReturnType<typeof useFeedMeta>) {
  return feeds.map((feed) => {
    const m = meta[feedMetaKey(widgetName, feed.id)] ?? {};
    return {
      hex: feed.hex,
      name: m.name || feed.hex,
      valueLabel: m.valueLabel || "value",
      auxLabel: m.auxLabel || "auxiliary",
      value: parseFieldInt(m.value ?? "") ?? 0,
      auxiliary: parseFieldInt(m.auxiliary ?? "") ?? 0,
    };
  });
}

function FeederSection({
  state,
  feeds,
  dispatch,
}: {
  state: DesignerState;
  feeds: HostFeed[];
  dispatch: (event: SimulatedEvent) => void;
}) {
  const toast = useToast();
  const meta = useFeedMeta();
  const source = React.useMemo(
    () => generateFeedServer(state.displayName, feedsForServer(state.displayName, feeds, meta)),
    [state.displayName, feeds, meta],
  );
  const slug = feedServerSlug(state.displayName);
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
    <div className="space-y-4">
      <div className="wd-ins-note" style={{ marginTop: 0 }}>
        This is the code your computer runs to feed the widget. It serves plain numbers over HTTP; the
        Designer relays them into the running widget — the same numbers a host app sends the keyboard.
        Your names and labels ride along as comments.
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <Button onClick={() => download(`${slug}-feeder.mjs`, source)}>
          <Icon name="download" size={14} />
          Download {slug}-feeder.mjs
        </Button>
        <Button onClick={copy}>
          <Icon name={copied ? "check" : "copy"} size={14} />
          {copied ? "Copied" : "Copy source"}
        </Button>
        <code className="wd-hd-cmd">node {slug}-feeder.mjs</code>
      </div>
      <CodeBlock label={`Feeder · GET /feeds on port ${FEED_SERVER_PORT}`}>{source}</CodeBlock>
      <RunWell source={source} />
      <FeedConnectWell feeds={feeds} dispatch={dispatch} />
    </div>
  );
}

/** Fetch live numbers from the running feeder and relay them to the widget —
 *  one host.rpc dispatch per feed, validated by feed id before anything is
 *  sent so a wrong shape names the missing feed instead of half-applying. */
function FeedConnectWell({
  feeds,
  dispatch,
}: {
  feeds: HostFeed[];
  dispatch: (event: SimulatedEvent) => void;
}) {
  const toast = useToast();
  const [url, setUrl] = React.useState(() => feedServerEndpoint());
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(url.trim());
      if (!response.ok) throw new Error(`Server returned HTTP ${response.status}`);
      const payload = await response.json();
      const raw = payload?.feeds;
      if (!raw || typeof raw !== "object") throw new Error("Response has no `feeds` object.");
      // Keys match by numeric id, so "0xb241" and "0xB241" both land.
      const byId = new Map<number, { value: number; auxiliary: number }>();
      for (const [key, entry] of Object.entries(raw as Record<string, unknown>)) {
        const id = Number.parseInt(key, key.trim().toLowerCase().startsWith("0x") ? 16 : 10);
        if (!Number.isFinite(id) || !entry || typeof entry !== "object") continue;
        const v = (entry as Record<string, unknown>).value;
        const a = (entry as Record<string, unknown>).auxiliary ?? 0;
        if (!Number.isInteger(v) || !Number.isInteger(a)) {
          throw new Error(`Feed "${key}" must carry integer \`value\` and \`auxiliary\`.`);
        }
        byId.set(id >>> 0, { value: v as number, auxiliary: a as number });
      }
      const matched = feeds.filter((f) => byId.has(f.id));
      if (matched.length === 0) {
        throw new Error(
          `Response has no feeds this widget handles (expected ${feeds.map((f) => f.hex).join(", ")}).`,
        );
      }
      for (const feed of matched) {
        const entry = byId.get(feed.id)!;
        dispatch({
          kind: "host.rpc",
          id: feed.id,
          value: entry.value,
          auxiliary: entry.auxiliary,
          displayName: `${feed.hex} live`,
        });
      }
      toast({
        tone: "success",
        title: "Live values sent to the widget",
        body:
          `${matched.length} of ${feeds.length} feeds updated` +
          (payload.note ? ` · from ${payload.note}.` : "."),
      });
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wd-well space-y-2">
      <div className="wd-overline">Connect to your running feeder</div>
      <div className="wd-hd-connect">
        <Input
          mono
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          aria-label="Feeder endpoint URL"
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
