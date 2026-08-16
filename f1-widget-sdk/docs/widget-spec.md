# Declarative widget specification

`widget.json` uses format `framer-f1-research-widget-sdk-v1` and guarded profile
`wpm-roster-v2`. Unknown targets/profiles are rejected.

## Target and layout

The only target is Framer F1 firmware 0.4.1, screen ID 7. Two different sizes
must remain explicit:

```json
"logicalCanvas": { "width": 100, "height": 310 },
"physicalDisplay": {
  "width": 310,
  "height": 100,
  "orientation": "marketed-landscape"
}
```

The exact layout is:

- background CENTER, `100x310`;
- pet CENTER, `x=0`, `y=0`;
- WPM TOP_MID, `x=0`, `y=3`;
- analytics BOTTOM_MID, `x=0`, `y=-3`, `Avg ###\nTop: ###`.

## Assets and roster

`assets.backgrounds` has exactly two 100x310 frames. `assets.roster` has 1..15
species. Every species has exactly eight frames in state order ready, curious,
happy, zooming, fire, tired, waiting, sleeping. All pet frames share one size.
`assets.defaultSpecies` must name a roster ID.

Each image has a unique kebab-case `id`, `format` `png` or `lvgl-i8`, a
project-local `source`, and exact `width`/`height`. Paths cannot escape the
project. PNGs use the pinned local Input converter; it is not redistributed.

Immutable descriptor order is `sky0, sky1, species*8+state`.

## State and input

State input is the native WPM float with `semantic-wpm-idle-v1`. Timing is fixed
at a 100-ms UI tick, WPM sample every five ticks, and twinkle every ten ticks.

Input metadata is exact: controller-local screen ID 7 vtable slot 9, chord
`fn+bottom-encoder`, encoder ID 1, zero-extended signed-i8 delta, clockwise
next/counterclockwise previous with wrap, controller-RAM-only selection, reboot
reset, no global key hook, and no hardware access.

## Style and firmware

`style.wpmColors` defines `idle`, `low`, `medium`, and `high` as `#RRGGBB`.
Firmware base is exact `live-tested-stage3c1`; assembly/linker paths must remain
inside the project. Generated tokens cover descriptor bases, roster count,
default species, screen ID, code base, and colors. Unknown tokens fail.

The spec deliberately cannot describe music metadata, arbitrary object trees,
or host-fed state. Those require a separate profile and reviewed ABI; see the
music example's `docs/SDK-GAPS.md`.
