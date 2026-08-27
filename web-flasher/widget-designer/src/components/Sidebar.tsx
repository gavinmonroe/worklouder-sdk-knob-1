// Left sidebar — the example gallery, IDE-style. One rich card per preset
// (sentence-cased name, the teaching tagline, tiny capability glyphs, and a
// "Preview only" chip on the ones the keyboard can't run), the loaded example
// carrying the ember dot + tinted card + accent inset rail.
//
// Picking a card loads source only — it never navigates. A dirty buffer asks
// before being replaced (the same ConfirmLoadDialog the chip strip used, which
// offers to save the edits first so browsing the gallery can never cost work),
// and while the buffer matches no preset a pinned "edited widget" row at the
// top keeps the current location visible.

import * as React from "react";
import { createPortal } from "react-dom";
import { PRESETS, PRESET_ORDER } from "../presets/widgets";
import { RENDER_V2_MQUICKJS_SOURCE_PREFIX } from "../compiler/constants";
import type { DesignerState } from "../designer/store";
import { downloadWidgetFile, serializeWidgetFile, widgetFileName } from "../designer/widgetFile";
import { probeScriptPipeline, preferredPresetSource } from "./pipeline";
import { presetStageCss } from "./presetFidelity";
import { presetCapabilities, type PresetCapability } from "./presetCapabilities";
import { Badge, Button, Tooltip } from "./ui";
import { Icon } from "./icons";

type PresetId = keyof typeof PRESETS;

/** "WEATHER (DEVICE)" → "Weather (device)" — cards speak, they don't shout. */
function sentenceCase(label: string): string {
  const lower = label.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** The shell may load a preset with the canonical strict header applied, so
 *  preset matching (selected card, dirty detection) ignores that header. */
function withoutHeader(js: string): string {
  return js.startsWith(RENDER_V2_MQUICKJS_SOURCE_PREFIX)
    ? js.slice(RENDER_V2_MQUICKJS_SOURCE_PREFIX.length)
    : js;
}

export function Sidebar({
  state,
  onPick,
}: {
  state: DesignerState;
  onPick: (id: PresetId) => void;
}) {
  // The buffer IS some preset ⇔ its three sources match exactly (modulo the
  // two transforms the shell applies on load: the strict script header and
  // the stage-fidelity CSS patch); otherwise it has been edited and replacing
  // it deserves a confirmation.
  const activeId =
    PRESET_ORDER.find((p) => {
      const w = PRESETS[p.id];
      return (
        w.html === state.html &&
        (w.css === state.css || presetStageCss(String(p.id), w.css) === state.css) &&
        withoutHeader(w.script) === withoutHeader(state.js)
      );
    })?.id ?? null;

  // Probed once per mount from the real compiler — never hardcoded, so a
  // fixed example upgrades its own note. The capability glyphs come from the
  // presentation-layer script probe (presetCapabilities.ts).
  const probes = React.useMemo(() => {
    const out = new Map<PresetId, { pushable: boolean; caps: PresetCapability[] }>();
    for (const p of PRESET_ORDER) {
      const probe = probeScriptPipeline(preferredPresetSource(PRESETS[p.id].script));
      out.set(p.id, { pushable: probe.dslOk, caps: presetCapabilities(PRESETS[p.id].script) });
    }
    return out;
  }, []);

  const [confirm, setConfirm] = React.useState<{ id: PresetId; label: string } | null>(null);

  // The rescue the replace dialog offers: the SAME .f1widget.json the topbar's
  // Share button writes — same serializer, same filename rule, so a copy saved
  // here reopens exactly like a shared one. It is spelled out inline rather
  // than called through the store because the gallery is handed only `state`
  // and `onPick`; threading the whole action set in for one download would tie
  // the example list to the store, and the widget-file helpers are the single
  // source of the format either way.
  const saveCopy = React.useCallback(() => {
    downloadWidgetFile(
      serializeWidgetFile({
        name: state.displayName,
        rootClass: state.rootClass,
        html: state.html,
        css: state.css,
        js: state.js,
        hostData: state.hostData,
      }),
      widgetFileName(state.displayName),
    );
  }, [state.displayName, state.rootClass, state.html, state.css, state.js, state.hostData]);

  const pick = (id: PresetId, label: string) => {
    if (id === activeId) return;
    if (activeId === null) setConfirm({ id, label: sentenceCase(label) });
    else onPick(id);
  };

  return (
    <aside className="wd-sidebar" aria-label="Example gallery">
      <div className="wd-sidebar-head">
        <span className="wd-overline">Examples</span>
        <Badge tone="neutral" className="wd-nums">{PRESET_ORDER.length}</Badge>
      </div>
      {/* Location is always visible: while the buffer matches no preset, a
          pinned non-clickable row names the edited widget at the top. */}
      {activeId === null && (
        <div className="wd-sidecard" data-custom="true">
          <span className="wd-sidecard-title">
            <span className="wd-sidecard-dot" aria-hidden="true" />
            <span className="truncate">{state.displayName || "Untitled widget"}</span>
            <Badge tone="neutral">custom</Badge>
          </span>
          <span className="wd-sidecard-tagline">Edited source — no example matches this buffer.</span>
        </div>
      )}
      {PRESET_ORDER.map((p) => {
        const active = p.id === activeId;
        const probe = probes.get(p.id);
        return (
          <button
            key={p.id}
            type="button"
            className="wd-sidecard"
            data-active={active || undefined}
            aria-pressed={active}
            onClick={() => pick(p.id, p.label)}
          >
            <span className="wd-sidecard-title">
              <span className="wd-sidecard-dot" aria-hidden="true" />
              <span className="truncate">{sentenceCase(p.label)}</span>
            </span>
            <span className="wd-sidecard-tagline" title={p.tagline}>
              {p.tagline}
            </span>
            {probe && (
              <span className="wd-sidecard-caps">
                {probe.caps.map((c) => (
                  <Tooltip key={c.id} label={c.label}>
                    <span className="wd-sidecard-cap" tabIndex={-1}>
                      <Icon name={c.icon} size={12} />
                      <span className="sr-only">{c.label}</span>
                    </span>
                  </Tooltip>
                ))}
                {/* Whether an example can ever reach the keyboard is the one
                    fact worth knowing BEFORE the click — an hour of styling a
                    preview-only example ends at a greyed-out "Build widget"
                    with nothing on screen to explain why. So the constraint
                    is a readable chip on the card, not a hover-only glyph;
                    the happy case stays a quiet green mark, because "it
                    works" needs no words. */}
                {probe.pushable ? (
                  <Tooltip label="Runs on your keyboard — this example can go to the device as it is.">
                    <span className="wd-sidecard-cap" data-push tabIndex={-1}>
                      <Icon name="upload" size={12} />
                      <span className="sr-only">Runs on your keyboard</span>
                    </span>
                  </Tooltip>
                ) : (
                  <Tooltip label="Preview only — this example uses things the keyboard can't run. It plays here in the browser, but Build widget stays greyed out.">
                    <Badge tone="warning">Preview only</Badge>
                  </Tooltip>
                )}
              </span>
            )}
          </button>
        );
      })}
      {confirm && (
        <ConfirmLoadDialog
          label={confirm.label}
          onSaveCopy={saveCopy}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            onPick(confirm.id);
            setConfirm(null);
          }}
        />
      )}
    </aside>
  );
}

function ConfirmLoadDialog({
  label,
  onSaveCopy,
  onCancel,
  onConfirm,
}: {
  label: string;
  /** Download the current source as a .f1widget.json before it is replaced. */
  onSaveCopy: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = React.useId();
  // Saving does NOT load: the download can be blocked or ignored by the
  // browser, and a dialog that saved-and-loaded in one motion would leave
  // someone believing a copy exists that never landed. So the copy button
  // acknowledges itself and hands the decision back — you replace your edits
  // only from a click that says it replaces them.
  const [saved, setSaved] = React.useState(false);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return createPortal(
    <div
      className="wd-scrim-layer"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="wd-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="wd-dialog-title" id={titleId}>Replace your edits?</div>
        <div className="wd-dialog-body">
          Your widget has edits no example matches. Loading{" "}
          <strong className="text-fg font-medium">{label}</strong> replaces the HTML, CSS, and
          script in the editor, and there is no undo. Save a copy first if you want it back.
        </div>
        <div className="wd-dialog-actions flex-wrap">
          {/* Text-only, and short: all three actions have to sit on one row
              inside the 400px dialog, and a button that wraps to its own line
              reads as an afterthought — which is the last thing the rescue
              should look like. */}
          <Button className="mr-auto" onClick={() => { onSaveCopy(); setSaved(true); }}>
            {saved ? "Copy saved" : "Save a copy"}
          </Button>
          <Button onClick={onCancel}>Keep editing</Button>
          <Button variant="primary" autoFocus onClick={onConfirm}>
            Discard and load
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
