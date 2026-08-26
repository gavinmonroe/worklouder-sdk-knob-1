// Widget metadata only. The detected-config accordions (state slots,
// handlers, DOM targets, diagnostics) live in ONE place — the inspector rail
// beside the stage — never duplicated here with divergent labels.

import type { DesignerState, DesignerActions } from "../designer/store";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label } from "./ui";

export function DesignerPanel({ state, actions }: { state: DesignerState; actions: DesignerActions; }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Widget</CardTitle>
        {/* One sentence, and only the half the field labels below don't
            already say — the Inspector card's subtitle owns the "detected"
            explanation, so this line just points at it. */}
        <CardDescription>Everything else is detected from your source.</CardDescription>
      </CardHeader>
      {/* 60/40: the display name ("Weather (device DSL)") needs the room;
          root-class values are short. title= keeps a still-truncated name
          recoverable on hover. */}
      <CardContent className="grid grid-cols-1 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-3">
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
          <Label htmlFor="wd-meta-root">Root class</Label>
          <Input
            id="wd-meta-root"
            mono
            value={state.rootClass}
            onChange={(e) => actions.setMeta({ rootClass: e.target.value })}
          />
        </div>
      </CardContent>
    </Card>
  );
}
