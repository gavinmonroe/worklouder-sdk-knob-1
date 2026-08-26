// ─────────────────────────────────────────────────────────────────────────────
// Event reference rail — in-editor documentation for all nine event kinds.
//
// Docked inside the editor frame (a flex sibling of the CodeMirror body), so
// writing a handler is learnable WITHOUT leaving the JS buffer: each row is
// one event kind — family dot · mono selector — expanding to when-it-fires,
// the exact fields the device puts on the event object (derived from the
// device contract in eventReference.ts), and two actions: insert an idiomatic
// handler at the cursor, or fire a sample event through the simulator.
// ─────────────────────────────────────────────────────────────────────────────

import * as React from "react";
import {
  COMMON_EVENT_FIELDS,
  EVENT_REFERENCE,
  type EventReferenceEntry,
} from "./eventReference";
import { KindText } from "./InspectorPanel";
import { Button, Tooltip } from "./ui";
import { Icon } from "./icons";
import type { DesignerState } from "../designer/store";
import type { SimulatedEvent } from "../types";

/**
 * The device allows ONE handler per kind (the strict simulator rejects a
 * duplicate registration), so an entry whose kind the script already handles
 * swaps its Insert action for a jump to the existing handler. host.rpc is
 * per-id: only a script already handling the snippet's own example id
 * (0xB301) counts as existing.
 */
function existingHandlerKind(
  entry: EventReferenceEntry,
  handlers: DesignerState["handlers"],
): string | null {
  if (entry.kind === "host.rpc") {
    const hit = handlers.find((h) => h.kind.toLowerCase() === "host.rpc:0xb301");
    return hit ? hit.kind : null;
  }
  const hit = handlers.find(
    (h) =>
      h.kind === entry.kind ||
      (entry.kind === "input.fn-bottom-knob" && h.kind === "fn-bottom-knob"),
  );
  return hit ? hit.kind : null;
}

export function EventReferenceRail({
  handlers,
  onInsert,
  onFire,
  onReveal,
}: {
  /** The committed script's inferred handlers (duplicate-kind detection). */
  handlers: DesignerState["handlers"];
  /** Insert the entry's snippet into the JS buffer at the cursor. */
  onInsert: (entry: EventReferenceEntry) => void;
  /** Dispatch the entry's sample event through the simulator. */
  onFire: (event: SimulatedEvent) => void;
  /** Scroll the editor to the first occurrence of `needle`. */
  onReveal: (needle: string) => void;
}) {
  const [open, setOpen] = React.useState<ReadonlySet<string>>(() => new Set([EVENT_REFERENCE[0].kind]));
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Click-site acknowledgement for "Fire sample".
  const [firedKind, setFiredKind] = React.useState<string | null>(null);
  const firedTimer = React.useRef<number | undefined>(undefined);
  React.useEffect(() => () => window.clearTimeout(firedTimer.current), []);
  const fire = (entry: EventReferenceEntry) => {
    onFire(entry.sample);
    setFiredKind(entry.kind);
    window.clearTimeout(firedTimer.current);
    firedTimer.current = window.setTimeout(() => setFiredKind(null), 900);
  };

  const [commonOpen, setCommonOpen] = React.useState(false);

  return (
    <aside className="wd-ref-rail" aria-label="Event reference">
      <div className="wd-ref-scroll">
        <div className="wd-ref-head">
          <span className="wd-overline">Event reference</span>
          <span className="wd-ref-count wd-nums">{EVENT_REFERENCE.length} kinds</span>
        </div>
        <div className="wd-ref-intro">
          Everything a widget can react to. Insert a handler to start from working, idiomatic code.
        </div>
        {EVENT_REFERENCE.map((entry) => {
          const isOpen = open.has(entry.kind);
          return (
            <div key={entry.kind} className="wd-ref-item">
              <button
                type="button"
                className="wd-ref-row"
                data-family={entry.family}
                aria-expanded={isOpen}
                onClick={() => toggle(entry.kind)}
              >
                <Icon name="chevron-right" size={12} className="wd-ref-chevron" />
                <span className="wd-ins-logdot" aria-hidden="true" />
                <KindText kind={entry.selector} withTitle={false} />
              </button>
              {isOpen && (
                <div className="wd-ref-body">
                  <div className="wd-ref-blurb">{entry.blurb}</div>
                  {entry.fields.length > 0 && (
                    <dl className="wd-ref-fields">
                      {entry.fields.map((f) => (
                        <React.Fragment key={f.name}>
                          <dt className="wd-ref-fieldname">event.{f.name}</dt>
                          {f.doc && <dd className="wd-ref-fielddoc">{f.doc}</dd>}
                        </React.Fragment>
                      ))}
                    </dl>
                  )}
                  <div className="wd-ref-actions">
                    {(() => {
                      const existing = existingHandlerKind(entry, handlers);
                      return existing ? (
                        <Tooltip
                          label={`This script already handles ${existing} — the device allows one handler per kind. Jump to it.`}
                        >
                          <Button size="sm" onClick={() => onReveal(existing)}>
                            <Icon name="search" size={12} />
                            Go to handler
                          </Button>
                        </Tooltip>
                      ) : (
                        <Tooltip label="Insert a working, commented handler at the cursor">
                          <Button size="sm" onClick={() => onInsert(entry)}>
                            <Icon name="plus" size={12} />
                            Insert handler
                          </Button>
                        </Tooltip>
                      );
                    })()}
                    <Tooltip label={`Dispatch ${entry.sampleLabel} through the simulator`}>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => fire(entry)}
                        data-flash={firedKind === entry.kind ? "ok" : undefined}
                      >
                        <Icon name={firedKind === entry.kind ? "check" : "play"} size={12} />
                        Fire sample
                      </Button>
                    </Tooltip>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        <div className="wd-ref-item">
          <button
            type="button"
            className="wd-ref-row"
            data-family="sys"
            aria-expanded={commonOpen}
            onClick={() => setCommonOpen((v) => !v)}
          >
            <Icon name="chevron-right" size={12} className="wd-ref-chevron" />
            <span className="wd-ins-logdot" aria-hidden="true" />
            <span className="wd-ref-commonlabel">every event also carries…</span>
          </button>
          {commonOpen && (
            <div className="wd-ref-body">
              <dl className="wd-ref-fields">
                {COMMON_EVENT_FIELDS.map((f) => (
                  <React.Fragment key={f.name}>
                    <dt className="wd-ref-fieldname">event.{f.name}</dt>
                    {f.doc && <dd className="wd-ref-fielddoc">{f.doc}</dd>}
                  </React.Fragment>
                ))}
              </dl>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
