// ─────────────────────────────────────────────────────────────────────────────
// Source-draft persistence — an IDE never loses the user's buffer on reload.
//
// The designer store debounce-writes the committed source (three buffers +
// display name + root class) here on every edit; App restores the draft at
// boot instead of the default example whenever one exists. The gallery needs
// no special casing: the Sidebar already derives the active/custom row from
// CONTENT, so a restored draft that matches a preset highlights that preset
// and anything else pins the "custom" row — exactly as an in-session edit
// does today.
//
// The beforeunload guard (also wired in the store) flushes the pending write
// and warns only when work would actually be lost: the buffer could not be
// persisted (storage unavailable) AND matches no shipped preset, or the
// Source view holds Apply-mode edits that were never committed to the store.
// ─────────────────────────────────────────────────────────────────────────────

import { PRESETS } from "../presets/widgets";
import { RENDER_V2_MQUICKJS_SOURCE_PREFIX } from "../compiler/constants";
import { presetStageCss } from "../components/presetFidelity";

export interface SourceDraft {
  displayName: string;
  rootClass: string;
  html: string;
  css: string;
  js: string;
}

const STORAGE_KEY = "wd-source-draft";

/** Persist the draft. False when storage is unavailable or over quota. */
export function saveSourceDraft(draft: SourceDraft): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

/** The stored draft, or null when absent/corrupt (a corrupt record is
 *  discarded so the shell falls back to the boot example cleanly). */
export function loadSourceDraft(): SourceDraft | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SourceDraft>;
    if (
      typeof parsed !== "object" || parsed === null ||
      typeof parsed.html !== "string" ||
      typeof parsed.css !== "string" ||
      typeof parsed.js !== "string" ||
      typeof parsed.displayName !== "string" ||
      typeof parsed.rootClass !== "string"
    ) {
      return null;
    }
    return {
      displayName: parsed.displayName,
      rootClass: parsed.rootClass,
      html: parsed.html,
      css: parsed.css,
      js: parsed.js,
    };
  } catch {
    return null;
  }
}

/** Preset matching ignores the canonical strict header the shell applies on
 *  load — the same rule the Sidebar's active-card detection uses. */
function withoutHeader(js: string): string {
  return js.startsWith(RENDER_V2_MQUICKJS_SOURCE_PREFIX)
    ? js.slice(RENDER_V2_MQUICKJS_SOURCE_PREFIX.length)
    : js;
}

/** True when the buffer IS some shipped preset (modulo the two transforms the
 *  shell applies on load: strict header, stage-fidelity CSS patch) — the
 *  Sidebar's own predicate, shared so the unload warning agrees with the
 *  gallery about what counts as "edited". */
export function matchesAnyPreset(source: { html: string; css: string; js: string }): boolean {
  return Object.entries(PRESETS).some(([id, w]) => {
    return (
      w.html === source.html &&
      (w.css === source.css || presetStageCss(id, w.css) === source.css) &&
      withoutHeader(w.script) === withoutHeader(source.js)
    );
  });
}

// ── Apply-mode pending edits ─────────────────────────────────────────────────
// In Apply mode the Source view buffers keystrokes locally until the Apply
// click commits them — the store (and with it the persisted draft) never sees
// them. The view flags that gap here so the unload guard can warn about the
// one kind of edit no draft covers.

let pendingEditorDirty = false;

export function setPendingEditorDirty(dirty: boolean): void {
  pendingEditorDirty = dirty;
}

export function isPendingEditorDirty(): boolean {
  return pendingEditorDirty;
}
