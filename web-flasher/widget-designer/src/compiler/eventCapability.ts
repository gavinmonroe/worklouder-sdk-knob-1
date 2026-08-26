// ─────────────────────────────────────────────────────────────────────────────
// "Can this widget be event-driven?" — answered by the real compiler.
//
// A widget ships one of two ways: an F2EP event program (the device computes
// state from real events, so the knob moves pixels) or replayed frames (a loop
// that ignores input entirely). `prepareRenderV2` is the gate between them.
//
// This asks the gate the question WITHOUT building a package: no iframe, no
// pixel capture, no device. That makes it cheap enough to run while the user
// types, so the UI can say why a widget is stuck on frames instead of letting
// them discover it at compile time.
//
// The reason string is the SDK's own message, never a paraphrase — the subset
// is large enough that "unsupported" alone tells an author nothing actionable.
// ─────────────────────────────────────────────────────────────────────────────

// MUST precede the SDK import: those modules touch Buffer at their own top
// level, and ES imports evaluate in source order.
import "../compat/install";

import { prepareRenderV2 } from "@sdk/render-v2/compiler.mjs";

import type { DesignerWidget } from "../types";

/** The sources the render-v2 gate actually reads. */
export type EventCapabilityInput = Pick<DesignerWidget, "html" | "css" | "script"> &
  Partial<Pick<DesignerWidget, "rootClass">>;

export interface EventCapability {
  /** True when the widget compiles to an F2EP program and responds to input. */
  supported: boolean;
  /** Logical bindings the program drives. Present only when supported. */
  bindingCount?: number;
  /** The SDK's verbatim rejection message. Present only when unsupported. */
  reason?: string;
}

export function describeEventCapability(widget: EventCapabilityInput): EventCapability {
  try {
    const prepared: any = prepareRenderV2({
      html: widget.html,
      css: widget.css,
      script: widget.script,
      rootClass: widget.rootClass ?? "render-v2",
    });
    const bindingCount = prepared.logicalBindings?.length ?? 0;
    // Defensive: prepareRenderV2 requires at least one binding today, but a
    // program with nothing to redraw would still be useless as an F2EP package.
    if (bindingCount === 0) {
      return {
        supported: false,
        reason:
          "This widget declares no event-driven bindings: nothing in its script writes a " +
          "glyph target, so there is no state for the device to react to.",
      };
    }
    return { supported: true, bindingCount };
  } catch (error) {
    return { supported: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
