// Shared host-server tooling chrome. The Host data feeder (Source view) and
// the legacy snapshot-schema workflow (SchemaTools) both hand the user a
// generated Node file and run it through the dev-only /__host-server endpoint;
// this module keeps that surface single-sourced: one download helper, one
// code-dump recipe, one run/stop well.

import * as React from "react";
import { Button, Callout, StatusDot, Tooltip } from "./ui";
import { Icon } from "./icons";

export function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Shared code-dump chrome: overline header + copy affordance. The body sizes
 *  to its content — a short JSON shape renders whole, never cropped mid-glyph
 *  at rest. Only a genuinely long dump (>16 lines) folds at an exact line
 *  boundary, with the Expand control taking it from there. */
export function CodeBlock({ label, children }: { label: string; children: string }) {
  const [expanded, setExpanded] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<number | undefined>(undefined);
  React.useEffect(() => () => window.clearTimeout(timer.current), []);
  const lines = children.split("\n").length;
  const collapsible = lines > 16;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* selection stays possible */
    }
  };
  return (
    <div className="wd-codeblock">
      <div className="wd-codeblock-head">
        <span className="wd-overline">{label}</span>
        <span className="inline-flex items-center gap-1">
          {collapsible && (
            <Button variant="ghost" size="sm" onClick={() => setExpanded((v) => !v)}>
              {expanded ? "Collapse" : "Expand"}
            </Button>
          )}
          <Tooltip label={copied ? "Copied" : "Copy"}>
            <button type="button" className="wd-iconbtn" onClick={copy} aria-label={`Copy ${label}`}>
              <Icon name={copied ? "check" : "copy"} size={14} />
            </button>
          </Tooltip>
        </span>
      </div>
      <pre
        className="wd-codeblock-body"
        data-fit="true"
        data-collapsible={collapsible || undefined}
        data-expanded={expanded || undefined}
      >
        {children}
      </pre>
    </div>
  );
}

/**
 * Run the generated server from the Designer.
 *
 * A browser cannot spawn a process, so this posts the generated source to a
 * dev-only endpoint (see hostServerRunner in vite.config.mjs) which runs it
 * with the same Node that serves the app. Output surfaces here so a server
 * that exits immediately explains itself instead of just failing to answer.
 */
export function RunWell({ source }: { source: string }) {
  const [status, setStatus] = React.useState<{ running: boolean; pid: number | null; log: string[] } | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const call = async (path: string, body?: string) => {
    setBusy(path);
    setError(null);
    try {
      const response = await fetch(`/__host-server${path}`, body === undefined ? {} : { method: "POST", body });
      const payload = await response.json();
      if (payload.error) throw new Error(payload.error);
      setStatus(payload);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(null);
    }
  };

  React.useEffect(() => {
    void call("/status");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="wd-well space-y-2">
      <div className="wd-overline">Run from the Designer</div>
      <div className="flex items-center gap-2 flex-wrap">
        <Button onClick={() => call("/start", source)} busy={busy === "/start"} disabled={busy !== null}>
          {busy !== "/start" && <Icon name="terminal" size={14} />}
          {status?.running ? "Restart server" : "Run server"}
        </Button>
        <Button
          variant="ghost"
          onClick={() => call("/stop")}
          busy={busy === "/stop"}
          disabled={busy !== null || !status?.running}
        >
          Stop
        </Button>
        <Button variant="ghost" onClick={() => call("/status")} busy={busy === "/status"} disabled={busy !== null}>
          <Icon name="rotate-ccw" size={14} />
          Refresh
        </Button>
        {status && (
          <span className="wd-hd-runstate">
            <StatusDot state={status.running ? "ok" : "idle"} />
            {status.running ? (
              <>
                Running <span className="wd-hd-dim wd-nums">· pid {status.pid}</span>
              </>
            ) : (
              "Stopped"
            )}
          </span>
        )}
      </div>
      {error && <Callout tone="danger">{error}</Callout>}
      {status?.log?.length ? (
        <pre className="wd-hd-serverlog">{status.log.slice(-8).join("\n")}</pre>
      ) : null}
    </div>
  );
}
