// Widget metadata only. The detected-config accordions (state slots,
// handlers, DOM targets, diagnostics) live in ONE place — the inspector rail
// beside the stage — never duplicated here with divergent labels.

import type { DesignerState, DesignerActions } from "../designer/store";
import { isEmptyRender } from "./diagnosticsView";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label } from "./ui";

export function DesignerPanel({ state, actions }: { state: DesignerState; actions: DesignerActions; }) {
  // The one field on this card that can silently break the render: every
  // renderer hangs the widget off the element carrying this class, so a value
  // that matches nothing in the HTML paints a void. The stage HUD reports the
  // SYMPTOM ("Nothing rendered"); the hint below reports the CAUSE, at the
  // field that caused it, while the author still has their hand on it.
  //
  // Deliberately NOT aria-invalid: either side of the mismatch can be the
  // wrong one (the class here, or the class in the HTML), and the app already
  // grades this a warning — an invalid-red field would convict the wrong half
  // and outrank the diagnostics list it comes from.
  const rootClass = state.rootClass.trim();
  const rootMissing = isEmptyRender(state);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Widget</CardTitle>
        {/* One sentence, and only the half the field labels below don't
            already say — the Inspector card's subtitle owns the "detected"
            explanation, so this line just points at it. */}
        <CardDescription>Everything else is detected from your source.</CardDescription>
      </CardHeader>
      {/* 60/40: the display name ("Focus timer", "Event lab") needs the room;
          class names are short. title= keeps a still-truncated name
          recoverable on hover. The class hint spans BOTH columns — in the
          340px design rail the second column is ~110px wide, where a sentence
          would stack into a seven-line ribbon nobody reads. */}
      <CardContent className="grid grid-cols-1 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-x-3 gap-y-2 items-start">
        <div>
          <Label htmlFor="wd-meta-name">Display name</Label>
          <Input
            id="wd-meta-name"
            value={state.displayName}
            title={state.displayName || undefined}
            onChange={(e) => actions.setMeta({ displayName: e.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="wd-meta-root">Wrapper class</Label>
          <Input
            id="wd-meta-root"
            mono
            value={state.rootClass}
            title={state.rootClass || undefined}
            aria-describedby="wd-meta-root-hint"
            onChange={(e) => actions.setMeta({ rootClass: e.target.value })}
          />
        </div>
        <p
          id="wd-meta-root-hint"
          className={`sm:col-span-2 text-2xs leading-4 ${rootMissing ? "text-warning" : "text-tertiary"}`}
        >
          {rootMissing ? (
            <>
              Nothing in your HTML carries{" "}
              {rootClass ? <code className="font-mono">{rootClass}</code> : "this class"} yet, so the
              widget draws an empty screen. Match the class here to your outermost{" "}
              <code className="font-mono">&lt;div&gt;</code>, or add it there.
            </>
          ) : (
            <>
              Must match the class on your outermost{" "}
              <code className="font-mono">&lt;div&gt;</code> — your CSS and your script find
              everything else inside it, so the two have to agree.
            </>
          )}
        </p>
      </CardContent>
    </Card>
  );
}
