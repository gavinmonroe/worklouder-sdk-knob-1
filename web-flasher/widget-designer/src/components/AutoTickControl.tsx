// The ONE auto-tick vocabulary. The Design-tab stage HUD, the Events tab's
// Drive card, and the footer readout all render the same rate labels ("Off",
// "1s", "100ms" — no space before the unit) and the same overline label
// treatment, so the identical control never reads as two different features.

import type { AutoTick } from "../designer/store";
import { SegmentedControl } from "./ui";

/** Rate labels — one unit style everywhere ("1s", never "1 s"). */
export const AUTO_TICK_ITEMS: { id: AutoTick; label: string }[] = [
  { id: "off", label: "Off" },
  { id: "1s", label: "1s" },
  { id: "100ms", label: "100ms" },
];

/** The one status-readout string: "Auto-tick 1s" / "Auto-tick off". */
export function autoTickReadout(rate: AutoTick): string {
  return rate === "off" ? "Auto-tick off" : `Auto-tick ${rate}`;
}

/**
 * Overline label + segmented rate picker. `pill` renders the stage-toolbar
 * variant (rounded thumb inside the floating HUD pill); the recipe, labels,
 * and semantics are identical in both hosts.
 */
export function AutoTickControl({
  value,
  onChange,
  pill = false,
}: {
  value: AutoTick;
  onChange: (rate: AutoTick) => void;
  pill?: boolean;
}) {
  return (
    <span className="wd-autotick">
      <span className="wd-overline wd-autotick-label" aria-hidden="true">
        Auto-tick
      </span>
      <SegmentedControl<AutoTick>
        semantics="radio"
        aria-label="Auto-tick rate"
        value={value}
        onValueChange={onChange}
        items={AUTO_TICK_ITEMS}
        data-shape={pill ? "pill" : undefined}
      />
    </span>
  );
}
