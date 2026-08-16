# Build a WPM roster widget offline

## 1. Generate the project

```sh
node f1-widget-sdk/bin/f1-widget.mjs init my-pet
```

The starter contains two 100x310 sky PNGs and six species with eight 68x56
placeholder states each. The logical LVGL canvas is 100x310; do not size art to
the separately marketed 310x100 orientation.

## 2. Replace the art

Keep both backgrounds exactly 100x310. Every pet frame across every species
must use one normalized dimension. Preserve state order:

1. ready
2. curious
3. happy
4. zooming
5. fire
6. tired
7. waiting
8. sleeping

Descriptor order is immutable: `sky-0`, `sky-1`, then each roster species'
eight states. For species `s` and state `t`, the descriptor index is
`2 + s*8 + t`.

## 3. Edit declarative behavior

Edit species names/IDs, `defaultSpecies`, and four WPM colors in `widget.json`.
The guarded v0.2 profile intentionally fixes geometry, state semantics, timing,
and input ABI. The pet is CENTER; WPM is TOP_MID `y=3`; analytics is BOTTOM_MID
`y=-3` with `Avg ###\nTop: ###`.

On screen ID 7, Fn + bottom encoder ID 1 selects the roster: clockwise next,
counterclockwise previous, wrapping. Selection is controller RAM-only, survives
screen exit/re-entry for the current boot, and resets on reboot.

## 4. Validate

```sh
node f1-widget-sdk/bin/f1-widget.mjs validate my-pet
```

Validation reports logical/physical sizes, species/frames, native bank size,
calculated DROM pages, and runtime image status. A valid schema can still say
`UNRESOLVED_LIVE_REGRESSION_DO_NOT_PROMOTE`; this is expected until the
full-canvas/multi-page rendering problem is solved.

## 5. Build and inspect

```sh
node f1-widget-sdk/bin/f1-widget.mjs build my-pet
node f1-widget-sdk/bin/f1-widget.mjs inspect my-pet/build/my-pet-app.bin
```

The manifest is the authoritative record. It identifies assets crossing the
`0x3c1d0000` virtual-page boundary, exact DROM/IROM shifts, preserved stock
callbacks, integrity hashes, and rollback reference. Current outputs are
offline regression artifacts and are not approved for hardware.

## 6. Develop a new profile

Changing `src/widget.S.tmpl` or relaxing `wpm-roster-v2` crosses into ABI/SDK
development. Add a distinct profile validator and generator instead of
weakening WPM guards. The music-player example shows this pattern: it builds a
deterministic host-side preview/bundle while leaving its missing device state
channel explicit.
