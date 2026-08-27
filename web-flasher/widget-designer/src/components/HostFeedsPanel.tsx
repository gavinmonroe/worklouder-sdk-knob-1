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
import {
  deriveHostFeeds,
  feedMetaKey,
  setFeedMeta,
  useFeedMeta,
  type FeedMeta,
  type HostFeed,
} from "./hostFeeds";
import { DEVICE_FEEDS, PINNED_FEEDS, USER_FEED_PREFIX } from "../compiler/mquickjsTranspiler";
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
const EXAMPLE_FEED_SNIPPET = `// Name the feed whatever you like - it appears under Host data below.
widget.on("feed.my-data", function (event) {
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

// ── What to CALL a feed ──────────────────────────────────────────────────────
// One channel has up to three spellings and only one of them belongs to the
// designer: the name they typed on the card, the name they wrote in the
// script, and the raw channel number. Every surface a person reads — card
// labels, screen-reader names, the simulator's picker, timeline rows — runs
// through here, so the number is the LAST resort and never the identity.
//
// The pinned and device feeds keep fixed channel numbers that predate the
// name-derives-the-channel scheme, so deriveHostFeeds cannot recover their
// names by hashing the slug. Reading the compiler's own tables (read-only, the
// same accepted pattern hostFeeds.ts already uses) puts "weather-now" on the
// card even in a widget whose saved metadata was never seeded — and keeps it
// there after the designer renames the widget, which retires those seeds.
const PLATFORM_FEED_SELECTORS = new Map<number, string>(
  [...Object.entries(DEVICE_FEEDS), ...Object.entries(PINNED_FEEDS)].map(
    ([selector, feed]) => [feed.id, selector] as [number, string],
  ),
);

/** The script's own word for this feed. Deliberately independent of the name
 *  the designer is typing, so a screen reader never renames a field mid-edit. */
export function feedScriptName(feed: HostFeed): string {
  const selector = feed.name ? `${USER_FEED_PREFIX}${feed.name}` : PLATFORM_FEED_SELECTORS.get(feed.id);
  if (!selector) return feed.hex;
  // "feed." is plumbing the designer never has to say out loud; "device." is
  // load-bearing (it says the keyboard publishes this one) and stays.
  return selector.startsWith(USER_FEED_PREFIX) ? selector.slice(USER_FEED_PREFIX.length) : selector;
}

/** What the designer calls this feed: the name they typed, then the name they
 *  wrote in the script, and only then the raw channel. */
export function feedDisplayName(feed: HostFeed, meta: FeedMeta | undefined): string {
  return meta?.name?.trim() || feedScriptName(feed);
}

/** Every spelling of this feed a feeder's JSON key might legitimately use. */
function feedKeySpellings(feed: HostFeed): string[] {
  const out = [feed.hex, feed.selector];
  const platform = PLATFORM_FEED_SELECTORS.get(feed.id);
  if (platform) out.push(platform);
  if (feed.name) out.push(`${USER_FEED_PREFIX}${feed.name}`);
  return out.map((s) => s.toLowerCase());
}

/** Resolve one key of a feeder's `feeds` object to a channel.
 *
 *  Named feeds made the numeric-only reading of these keys a dead end: the
 *  generated feeder keys its entries by the author's own spelling, which for
 *  `widget.on("feed.room-temp", …)` is "feed.room-temp" and parses as NaN. So
 *  both spellings a person could reasonably write are accepted — the feed's
 *  NAME, and the raw channel as decimal or 0x hex ("0xb241" and "0xB241" alike).
 *  Anything else still resolves to null and is skipped, exactly as before. */
function feedKeyId(key: string, feeds: HostFeed[]): number | null {
  const text = key.trim().toLowerCase();
  const named = feeds.find((f) => feedKeySpellings(f).includes(text));
  if (named) return named.id;
  const n = Number.parseInt(text, text.startsWith("0x") ? 16 : 10);
  return Number.isFinite(n) ? n >>> 0 : null;
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
                Live numbers your computer can send this widget. Every{" "}
                <span className="font-mono">feed.&lt;name&gt;</span> handler in your script shows up
                here — label its two numbers, test it live, and copy the ready-made script that
                sends it.
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
              title="This widget doesn't take any data from your computer yet"
              hint={
                <>
                  Add <code>{`widget.on("feed.my-data", function (event) { … })`}</code> to your
                  script — name it anything — and it appears here, ready to label and test.
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
  // `label` follows the name field as it is typed (so every other control on
  // the card renames with it); `scriptName` is the fixed identity from the
  // source, used where a moving accessible name would be disorienting.
  const label = feedDisplayName(feed, meta);
  const scriptName = feedScriptName(feed);
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
      // The timeline row leads with the designer's own word for the feed; the
      // channel spelling rides along as the secondary line, where it is
      // evidence for whoever is debugging a feeder and not an identity anyone
      // has to recognise.
      displayName: `${label} ← ${v}${a !== 0 ? ` · ${a}` : ""}`,
      description: feed.hex,
    });
    setFlash(true);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(false), 1200);
  };

  const inputId = (part: string) => `feed-${feed.id.toString(16)}-${part}`;

  return (
    <div className="wd-well wd-feed" role="group" aria-label={`${label} feed`}>
      <div className="wd-feed-head">
        <input
          className="wd-feed-name"
          value={meta.name ?? ""}
          placeholder="Name this feed"
          aria-label={`Friendly name for the ${scriptName} feed`}
          onChange={(e) => setFeedMeta(metaKey, { name: e.target.value })}
        />
        <Tooltip label="Jump to this handler in the editor">
          <button
            type="button"
            className="wd-feed-chip"
            onClick={() => onReveal(feed.selector)}
            /* The selector stays inside the spoken name because it is also the
               visible text of the chip — a name that omitted it would leave
               voice-control users with nothing to say. */
            aria-label={`Jump to the ${label} handler (${feed.selector}) in the source`}
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
            aria-label={`Plain-language label for the ${label} feed's first number`}
            onChange={(e) => setFeedMeta(metaKey, { valueLabel: e.target.value })}
          />
          <Input
            id={inputId("value")}
            mono
            inputMode="numeric"
            value={value}
            aria-label={`${valueLabel} — the first number sent to ${label}`}
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
            aria-label={`Plain-language label for the ${label} feed's second number`}
            onChange={(e) => setFeedMeta(metaKey, { auxLabel: e.target.value })}
          />
          <Input
            id={inputId("aux")}
            mono
            inputMode="numeric"
            value={auxiliary}
            aria-label={`${auxLabel} — the second number sent to ${label}`}
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
      // `hex` is the JSON key the feeder writes and the Designer matches on —
      // it stays the author's own spelling. Only the comment above it is
      // renamed, and it now falls back to the script's name rather than
      // repeating the key.
      hex: feed.hex,
      name: m.name?.trim() || feedScriptName(feed),
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
      <FeedConnectWell feeds={feeds} widgetName={state.displayName} dispatch={dispatch} />
    </div>
  );
}

/** Fetch live numbers from the running feeder and relay them to the widget —
 *  one host.rpc dispatch per feed, validated by feed id before anything is
 *  sent so a wrong shape names the missing feed instead of half-applying. */
function FeedConnectWell({
  feeds,
  widgetName,
  dispatch,
}: {
  feeds: HostFeed[];
  widgetName: string;
  dispatch: (event: SimulatedEvent) => void;
}) {
  const toast = useToast();
  const meta = useFeedMeta();
  const nameOf = (feed: HostFeed) => feedDisplayName(feed, meta[feedMetaKey(widgetName, feed.id)]);
  const [url, setUrl] = React.useState(() => feedServerEndpoint());
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      // The fetch is separated from the parsing so a feeder that simply is not
      // running produces a sentence about starting it, rather than the
      // browser's bare "Failed to fetch".
      let response: Response;
      try {
        response = await fetch(url.trim());
      } catch {
        throw new Error(
          `Nothing answered at ${url.trim()}. Start the feeder on your computer — download it above and run it — then try again.`,
        );
      }
      if (!response.ok) {
        throw new Error(
          `The server at ${url.trim()} answered HTTP ${response.status}. Check the address, then check the feeder is still running.`,
        );
      }
      const payload = await response.json();
      const raw = payload?.feeds;
      if (!raw || typeof raw !== "object") {
        throw new Error(
          "That response has no `feeds` object. The feeder must answer { feeds: { … } } — the downloadable one above already does.",
        );
      }
      const byId = new Map<number, { value: number; auxiliary: number }>();
      for (const [key, entry] of Object.entries(raw as Record<string, unknown>)) {
        const id = feedKeyId(key, feeds);
        if (id === null || !entry || typeof entry !== "object") continue;
        const v = (entry as Record<string, unknown>).value;
        const a = (entry as Record<string, unknown>).auxiliary ?? 0;
        if (!Number.isInteger(v) || !Number.isInteger(a)) {
          throw new Error(
            `Feed "${key}" must carry whole numbers for \`value\` and \`auxiliary\` — edit readFeeds() in your feeder.`,
          );
        }
        byId.set(id, { value: v as number, auxiliary: a as number });
      }
      const matched = feeds.filter((f) => byId.has(f.id));
      if (matched.length === 0) {
        throw new Error(
          `That feeder answered, but none of its feeds belong to this widget. Key each entry in readFeeds() after a feed this widget listens for: ${feeds
            .map((f) => nameOf(f))
            .join(", ")}.`,
        );
      }
      for (const feed of matched) {
        const entry = byId.get(feed.id)!;
        dispatch({
          kind: "host.rpc",
          id: feed.id,
          value: entry.value,
          auxiliary: entry.auxiliary,
          displayName: `${nameOf(feed)} ← ${entry.value}${entry.auxiliary !== 0 ? ` · ${entry.auxiliary}` : ""} (live)`,
          description: feed.hex,
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
      {/* Each thrown message above is already a whole sentence that ends in the
          next move, so the callout adds no "Fetch failed:" preamble in front
          of it. */}
      {error && <Callout tone="danger">{error}</Callout>}
    </div>
  );
}
