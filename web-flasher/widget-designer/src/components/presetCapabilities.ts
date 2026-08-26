// Presentation-layer capability probe for the example gallery: a fixed-order
// regex scan over a preset's script that names the teaching surfaces it
// exercises (knob, keys, ticks, host RPC, animation, digits). Purely a shell
// concern — the compiler is never consulted here (the device-pushable verdict
// comes from probeScriptPipeline at the call site).

import type { IconName } from "./icons";

export interface PresetCapability {
  id: string;
  icon: IconName;
  label: string;
}

const PROBES: { id: string; icon: IconName; label: string; test: RegExp }[] = [
  { id: "knob", icon: "dial", label: "Fn knob input", test: /fn-bottom-knob/ },
  { id: "keys", icon: "keyboard", label: "Keys & chords", test: /input\.(?:key|chord)/ },
  { id: "tick", icon: "clock", label: "Tick heartbeat", test: /tick\.(?:1s|100ms)/ },
  { id: "rpc", icon: "cable", label: "Host RPC data", test: /host\.rpc/ },
  { id: "anim", icon: "film", label: "Animation capture (widget.animate)", test: /widget\s*\.\s*animate\s*\(/ },
  { id: "digits", icon: "terminal", label: "digits() display", test: /\bdigits\s*\(/ },
];

export function presetCapabilities(script: string): PresetCapability[] {
  return PROBES.filter((p) => p.test.test(script)).map(({ id, icon, label }) => ({ id, icon, label }));
}
