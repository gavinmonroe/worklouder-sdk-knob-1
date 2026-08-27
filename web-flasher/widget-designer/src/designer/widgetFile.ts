// ─────────────────────────────────────────────────────────────────────────────
// The shareable widget file: `<name>.f1widget.json`.
//
// Everything the Designer needs to reproduce a widget — source, root class,
// name, declared host-data schemas — and nothing it doesn't. Plain JSON so the
// file is diffable, reviewable, and safe to email/Slack/commit; the receiving
// Designer re-runs its own pipeline on the source, so a shared file can never
// smuggle a stale or hand-edited binary past the gates (the F2UP a recipient
// pushes is always assembled from THIS source on THEIR machine).
//
// Versioned defensively: parse rejects unknown formats/versions with messages
// a person can act on, and every field is validated before it touches the
// store — a malformed file must fail at Open, never as a broken editor state.
// ─────────────────────────────────────────────────────────────────────────────

import type { SnapshotSchema } from "../data/schemas";

export const WIDGET_FILE_FORMAT = "f1widget";
export const WIDGET_FILE_VERSION = 1;
export const WIDGET_FILE_EXTENSION = ".f1widget.json";

export interface WidgetFileV1 {
  format: typeof WIDGET_FILE_FORMAT;
  version: typeof WIDGET_FILE_VERSION;
  name: string;
  rootClass: string;
  html: string;
  css: string;
  js: string;
  hostData?: Record<string, SnapshotSchema>;
}

export function widgetFileName(name: string): string {
  const slug = (name || "widget")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${slug || "widget"}${WIDGET_FILE_EXTENSION}`;
}

export function serializeWidgetFile(widget: {
  name: string;
  rootClass: string;
  html: string;
  css: string;
  js: string;
  hostData?: Record<string, SnapshotSchema>;
}): string {
  const file: WidgetFileV1 = {
    format: WIDGET_FILE_FORMAT,
    version: WIDGET_FILE_VERSION,
    name: widget.name,
    rootClass: widget.rootClass,
    html: widget.html,
    css: widget.css,
    js: widget.js,
    ...(widget.hostData && Object.keys(widget.hostData).length > 0
      ? { hostData: widget.hostData }
      : {}),
  };
  // 2-space indent: the file is meant to be read and diffed by people.
  return JSON.stringify(file, null, 2) + "\n";
}

function requireString(value: unknown, field: string, maxBytes: number): string {
  if (typeof value !== "string") {
    throw new Error(`Not a widget file: "${field}" is missing or not text.`);
  }
  if (value.length > maxBytes) {
    throw new Error(
      `"${field}" is ${value.length.toLocaleString()} characters — larger than any real widget (limit ${maxBytes.toLocaleString()}). Refusing to load it.`,
    );
  }
  return value;
}

export function parseWidgetFile(text: string): WidgetFileV1 {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("Not a widget file: the file is not valid JSON.");
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Not a widget file: expected a JSON object.");
  }
  const record = raw as Record<string, unknown>;
  if (record.format !== WIDGET_FILE_FORMAT) {
    throw new Error(
      'Not a widget file: missing the "f1widget" format marker. Share widgets with the Share button so the file carries it.',
    );
  }
  if (record.version !== WIDGET_FILE_VERSION) {
    throw new Error(
      `This widget file is version ${String(record.version)}, but this Designer reads version ${WIDGET_FILE_VERSION}. Update the Designer to open it.`,
    );
  }
  const file: WidgetFileV1 = {
    format: WIDGET_FILE_FORMAT,
    version: WIDGET_FILE_VERSION,
    name: requireString(record.name, "name", 200),
    rootClass: requireString(record.rootClass, "rootClass", 200),
    html: requireString(record.html, "html", 200_000),
    css: requireString(record.css, "css", 200_000),
    js: requireString(record.js, "js", 200_000),
  };
  if (record.hostData !== undefined) {
    if (record.hostData === null || typeof record.hostData !== "object" || Array.isArray(record.hostData)) {
      throw new Error('Not a widget file: "hostData" must be an object when present.');
    }
    file.hostData = record.hostData as Record<string, SnapshotSchema>;
  }
  return file;
}

/** Browser download of the serialized file. */
export function downloadWidgetFile(json: string, filename: string): void {
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}
