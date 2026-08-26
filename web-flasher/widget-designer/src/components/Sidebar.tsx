// Left sidebar — the example gallery, IDE-style. One rich card per preset
// (sentence-cased name, the teaching tagline, tiny capability glyphs), the
// loaded example carrying the ember dot + tinted card + accent inset rail.
//
// Picking a card loads source only — it never navigates. A dirty buffer asks
// before being replaced (the same ConfirmLoadDialog the chip strip used), and
// while the buffer matches no preset a pinned "edited widget" row at the top
// keeps the current location visible.

import * as React from "react";
import { createPortal } from "react-dom";
import { PRESETS, PRESET_ORDER } from "../presets/widgets";
import { RENDER_V2_MQUICKJS_SOURCE_PREFIX } from "../compiler/constants";
import type { DesignerState } from "../designer/store";
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
                <Tooltip
                  label={
                    probe.pushable
                      ? "Device-pushable example"
                      : "Preview-only example — outside the device DSL"
                  }
                >
                  <span className="wd-sidecard-cap" data-push={probe.pushable || undefined} tabIndex={-1}>
                    <Icon name={probe.pushable ? "upload" : "info"} size={12} />
                    <span className="sr-only">
                      {probe.pushable ? "Device-pushable example" : "Preview-only example"}
                    </span>
                  </span>
                </Tooltip>
              </span>
            )}
          </button>
        );
      })}
      {confirm && (
        <ConfirmLoadDialog
          label={confirm.label}
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
  onCancel,
  onConfirm,
}: {
  label: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = React.useId();
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
        <div className="wd-dialog-title" id={titleId}>Replace edited source?</div>
        <div className="wd-dialog-body">
          The current widget has edits that no preset matches. Loading{" "}
          <strong className="text-fg font-medium">{label}</strong> replaces the HTML, CSS, and
          script in the editor.
        </div>
        <div className="wd-dialog-actions">
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" autoFocus onClick={onConfirm}>
            Load {label}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
