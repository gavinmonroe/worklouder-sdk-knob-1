import type { DesignerWidget } from "../types";

export interface DesignerMetaPatch {
  displayName?: string;
  rootClass?: string;
}

/** Translate the UI's metadata names into the persisted widget model. */
export function applyDesignerMeta(
  widget: DesignerWidget,
  patch: DesignerMetaPatch,
): DesignerWidget {
  return {
    ...widget,
    name: patch.displayName ?? widget.name,
    rootClass: patch.rootClass ?? widget.rootClass,
  };
}
