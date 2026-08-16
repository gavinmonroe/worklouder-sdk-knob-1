# Screen-ID1 on-device candidate

The Music widget starts as a relocatable registration module in
[`on-device/music-player-id1.S`](../on-device/music-player-id1.S). It compiles
to a relocation-free 1,129-byte ABI and is now linked with corrected WPM ID7
by the SDK combined builder. The resulting app remains unapproved for hardware
until its separate approval draft is promoted.

## First combined proof

The next combined candidate reserves:

- screen ID `1` for Music Player;
- screen ID `7` for the corrected WPM Pet.

ID `8` is not an alternative. The exact stock 0.4.1 registry audit finds
controller ID 8 already occupied and also finds a stock navigation registration
for ID 8. Across controller IDs 0 through 25, only IDs 1 and 7 are unused.

One top-level wrapper must call the stock setup routine exactly once. It then resolves the stock screen registry and navigation manager once and calls `music_id1_register(registry, navigationManager)` followed by the WPM module's registration-only entry. Neither module may wrap or call stock setup. Only the combined builder patches the setup pointer.

[`combined-setup-wrapper.S.tmpl`](../on-device/combined-setup-wrapper.S.tmpl)
captures that call order and stock-return preservation. The isolated Music
build leaves it unresolved; `f1-widget combined` supplies both real modules,
places all literals/code together, and verifies zero final relocations.

The final WPM adapter is `stage3e34_register_wpm`, taking
`a2=screenRegistry` and `a3=navigationManager`, returning the allocated
controller (or zero), never calling stock setup, and adding navigation ID7 only
after the registry-association postcondition succeeds. The combined builder
compiles the original WPM source unchanged and discards only its isolated setup
sections in the linker; textual source deletion is forbidden because it changes
Xtensa relaxation.

The combined app is
`f1-widget-sdk/build/combined/framer-0.4.1-combined-music-id1-wpm-id7-app.bin`,
2,029,088 bytes, SHA-256
`6cad38dee31e5a44ce32011686cca38e38ff35b1fe7c32300ced92b68549df26`.
It was written app-only at 921600 baud with esptool write-hash verification and
booted healthy as `knob_f1` firmware 0.4.1. Music navigation and screen visuals
still require user acceptance.

The first music proof is deliberately deterministic: `Midnight Circuit` by `Static Bloom`, at `1:42 / 4:00` (42.5%). This lets hardware testing isolate controller registration, navigation, LVGL ownership, art decoding, layout, and cleanup from macOS media permissions and an unproven transport.

## DROM regression constraint

No music asset is appended to DROM. The corrected WPM bank owns the remaining runtime-readable range from stock end `0x3C1C1190` up to, but never including, `0x3C1D0000`.

The music controller allocates 8,424 bytes. Its vtable remains at `+160`; a native 24-byte LVGL descriptor is stored at `+208`; and a `64x64` RGB565 buffer occupies `+232..+8423`. The controller generates the fixture pixels once in RAM. The descriptor therefore never points into appended IROM or into the WPM DROM slack.

The first hardware gate must still measure heap availability and repeat screen enter/leave cycles. The RAM is part of the controller allocation, so there is no separate pixel allocation to leak and controller lifetime dominates the LVGL image source.

## Painted gradient

The screen root is painted `#040814`. Seven screen-owned blank label objects are sized, colored, aligned, and assigned `LV_RADIUS_CIRCLE` using stock LVGL style functions. Largest-to-smallest rounded panels transition through the album's dominant blue and leave the root edge visible on every side. The album image and metadata are created afterward, so draw order is deterministic.

The background is made from LVGL objects, not a `100x310` bitmap. Album art alone uses a RAM image descriptor. This preserves DROM and establishes the buffer shape that a future host-fed transaction could replace.

## LittleFS decision

Stock firmware has a capable custom wallpaper loader and LittleFS RPCs, but it is not the safe first route for this controller:

- the custom loader's public callable ABI and ownership contract are not pinned;
- a raw `/fs/...` path passed directly to `lv_image_set_src` is not proven;
- reusing `/fs/wallpaper_bg.bin` would collide with the user's wallpaper;
- a new music namespace has no proven generation, rollback, or atomic commit behavior.

The candidate therefore touches neither LittleFS nor the wallpaper path. A live adapter remains a separate phase: host media snapshot → decoded/bounded asset transaction → proven bounded RAM/file staging channel → UI-thread descriptor swap. Progress should eventually be a compact state update, not a repeated album-art transfer.

Build and audit without hardware:

```sh
cd f1-widget-sdk/examples/music-player
npm run build:on-device
npm test
```

Generated status remains `OFFLINE_ABI_CANDIDATE_NOT_LINKED_NOT_HARDWARE_APPROVED`.

Build the real combined app from the workspace root with:

```sh
node f1-widget-sdk/bin/f1-widget.mjs combined
```
