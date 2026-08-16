# Goals, scope, and status

## The actual goal

The project is aiming for a **custom Pomodoro widget flashed onto the Framer
F1**. The final widget should be device-resident, selectable from the keyboard's
normal interface, controlled by the knob/button, and usable without a Mac
process refreshing the display.

There are three increasingly strong proofs:

1. A changed desktop card proves the Input application UI can be modified.
2. A host-driven display proves the physical F1 can show our content.
3. A persistent firmware change proves our bytes boot and affect the keyboard.

Only the third proof is custom firmware. The first two were worthwhile because
they exposed the protocol and supplied a working behavioral reference, but they
are not substitutes for the requested end state.

## Success criteria

A complete native Pomodoro should eventually satisfy all of these:

- It is built for Framer F1 hardware rather than copied from a Nomad image.
- It is stored in flash and works after Input is closed.
- It appears as its own selectable widget, without deleting Clock or Timer.
- It implements focus and break periods, repeat cycles, and visible phase/time.
- The knob/button provides a deliberate start, pause, skip, or reset interaction.
- Normal keyboard, display, USB, and existing-widget behavior still works.
- The exact custom image and source inputs are hash-pinned and reproducible.
- A known-good 0.4.1 full-flash backup restores the same physical keyboard.

## Staged delivery

### Stage 0 — host prototype: complete

`framer-widgets/pomodoro.mjs` runs the countdown in Input's Electron main
process and refreshes an undocumented Framer bubble once per second. This was
verified on the physical keyboard. It defines useful copy and timing behavior.

### Stage 1 — persistent firmware proof: flashed and booted; heading later confirmed

The stage-1 image changes the visible native Timer screen heading from `Timer`
to `Pomo`. Offline control flow shows literal VA `0x42002110` resolving to DROM
`0x3C125AE0`; visible-label callsite `0x4202A096` passes it to label text setter
`0x4204EE30`. This is a live heading path, not a guessed registry string. It
does not yet change countdown behavior. Its purpose is to prove the firmware
image parser, patch boundary, checksum/digest repair,
app-only flash, boot, and recovery workflow with the smallest possible delta.

The app-only image has now been written and read back byte-for-byte on the F1.
Its read-back hash matches the build, ESP integrity validates, and the keyboard
re-enumerates normally as `knob_f1` on firmware 0.4.1. The exact Stage-1 heading
bytes were retained in the later live Stage-3B image, where the user confirmed
that the physical Timer screen rendered `Pomo`. The standalone Stage-1 image
was not separately visually recorded.

### Stage 2 — native Pomodoro behavior: offline candidate built

The deterministic stage-2 builder connects the existing Timer view/helpers to
the linked but currently unwired Pomodoro-like controller using in-place
adapters. The candidate implements 25/5 minutes for four cycles without segment
growth. An independent static audit verified all nine ranges, control flow,
field adapters, and hashes and found no static crash defect. Live runtime/UI
behavior remains unproven.

### Stage 3 — controlled growth: growth and appended execution verified live

Register a new Pomodoro controller beside Clock and Timer, preserving the stock
widgets. The user has explicitly accepted controlled application-segment growth
when it is necessary for a genuine additional widget; fixed-size patching is a
Stage-1/Stage-2 risk-control technique, not a permanent product constraint.

Growth will be introduced in three independently testable proofs: an
unreferenced existing-IROM growth canary, a callable visible canary, and only
then a registered Pomodoro or WPM view/controller. Every build must remain inside the
8 MiB factory partition (`0x10000..0x810000`), leave NVS/filesystem partitions
untouched, pass structural and integrity checks, and be read back byte-for-byte
before first boot. Stage 3B supplied the callable-canary proof without a tested
physical escape, and Stage 3C later completed its exact write/read-back/boot
successfully as well. That success does not prove app-independent recovery;
physical GPIO0/BOOT plus reset/EN remains an important risk-control gate for
future crash-prone images.

The first Stage-3A implementation appended a second IROM segment. Independent
audit rejected it: ESP-IDF 5.3.2 retains only the last IROM mapping, so the
canary could replace the stock executable mapping even though checksum, digest,
and `esptool image-info` all passed. That artifact is **NO-GO and must never be
flashed**. The corrected build grows the existing single IROM segment by 16
unreferenced bytes and shifts later segments/footer instead of creating a
second IROM. It retains six segments, passes local structural/integrity tests,
and received an independent STRUCTURAL/LOADER GO. Its 1,960,016-byte app-only
write, complete read-back, checksum/digest, byte comparison, and normal boot all
verified on the F1. This proves safe unreferenced growth of the existing IROM;
it does not by itself prove execution from the added bytes; Stage 3B supplied
that proof separately. Stage 3C subsequently booted successfully too, without
proving the separate physical recovery route. GPIO0/BOOT plus reset/EN remains
a material risk control for Stage 2 and future crash-prone images.
The WPM pet's dynamic registry, unused ID `7`, controller lifecycle, 112-byte
layout, and 564-byte ESP32-S3 ABI artifact are now machine-pinned in the
[native-view design](./12-wpm-pet-native-view.md). A deterministic Stage-3C
builder now integrates that exact artifact into a six-segment, one-IROM app.
That exact app has now been written at `0x10000`, read back byte-for-byte,
integrity-checked, and booted normally on the F1. Visual selection and WPM
behavior were then tested with a partial/defective result: ID `7` exists and is
navigable but opens a black screen. Cycling to the first screen briefly shows a
faint `wpm` popup before it disappears.

The milestone distinction is exact: Stage 3A was nonvisual and proved image
growth, mapping, exact read-back, and boot. Stage 3B now has full binary and
visual live proof: the app read back exactly, booted normally, and the user
confirmed `Pomo` / `00:42`, proving the appended getter executes through the
stock screen path. Stage 3C is still the first actual new selectable WPM-pet
screen. Live navigation now proves that ID `7` was inserted, but the black view
and misplaced transient popup fail the UI acceptance test. Typing-driven value
updates and correct cleanup/hide behavior remain unverified pending a fix.
Success at one stage does not imply success at the next.

Post-run analysis found the Stage-3C ownership error: ID `7` had a blank root,
while its appended code wrote the process-global bubble consumed by stock ID
`8`. The popup therefore appeared across screens during unload rather than as
content owned by ID `7`. Stage 3C.1 is the owned-label correction. It creates
two labels beneath ID `7`'s own root in stock lifecycle slot `1`, keeps slot `3`
as the stock no-op, guards a null value-label pointer, and contains no appended
references to the global bubble model/getter/updater. Its generated image
received independent STATIC GO and was then written app-only, read back exactly,
integrity-validated, and booted normally. The user confirmed the resulting ID
`7` widget works: its white `wpm` text remains visible and its value updates as
expected while typing. This closes the Stage-3C black-screen/cross-screen-popup
defect with screen-owned labels. Freeze the Stage-3C.1 app SHA-256
`e2e7ba4ab4b9c247af8c0bdc3d7896ac52967bb7f90fb19beae73c0ae4a2b8fd`
as the rollback base for Stage 3D.

Stage 3D now has **LIVE WRITE + FULL READ-BACK + BOOT/HEALTH SUCCESS**. Its
executable state model, four-label ESP32-S3 ABI, deterministic builder, and
tests remain the offline behavioral evidence; the live evidence proves the
exact app bytes and healthy boot. Runtime is **PARTIAL/DEFECT**: the screen and
text rendered, but the cat did not update. One crash/watchdog reboot occurred
after the first restart and has not repeated. The no-update root cause is now
proven: the wrapper read `0x3FCAB378 + 12`; the real path is root
`0x3FCAB210 -> +80 registry -> +12 current`. The decoded `wl_lvgl` core records
`StoreProhibited`, `EXCVADDR=0xEE`, in ROM `strcpy` through
`lv_label_set_text`, returning immediately after Stage 3D's face-label update.
Those are separate defects. Stage 3C.1 remains the frozen rollback base.

Stage 3E removes the global key hook and face label, uses screen-owned LVGL
images, and caches the remaining label updates. Its blue-cat/night-sky app has
independent static GO and exact live app-only
write/read-back/boot success. The 2,027,312-byte app SHA-256 is
`546ece0044e4a69ae8db9d9a781edc776f3d1d20d82105afd9ee6de47ff01aba`.
Postflight returned healthy `knob_f1` firmware 0.4.1, and the user confirmed
the rendered result: Stage 3E is LIVE VISUAL SUCCESS. LVGL's logical canvas is
100×310 despite the marketed 310×100 orientation; this explains why its
centered 100×100 sky filled only the middle third.

Stage 3E.1 is an offline deterministic 100×310 full-canvas milestone and is not
live. Stage 3E.2 now has static/independent GO plus live write, exact full
read-back, and boot/health success. Its ID-`7`-local Fn + bottom-knob slot-`9`
selection has no global key hook and is RAM-only. Full-canvas layout, default
Cat, and species visuals failed acceptance: logic/control appears alive, but
pet/avatar images are white squares. During twinkle/background switching,
roughly the lower 90–100% of the display glitches black or takes over the
background. The cause is exact: sky-1 crosses the original mapped-DROM limit
`0x3C1D0000` at row `267`, column `92`, while every pet payload begins above
that limit. This matches the bottom 13.6% corruption and white squares, so
Stage 3E.2 is a RUNTIME NO-GO.

Stage 3E.3A is the constrained decoder canary. Its only runtime-read asset is a
single 52×42 binary-alpha I4 cat at `0x3C1C1190..0x3C1C162C`, wholly inside
the proven final DROM page. Independent reconstruction gave STATIC GO. The
2,026,624-byte app was then written at `0x10000`, fully read back with SHA-256
`dd8edaaa2c3aa98a1cbdbda319255cc7d1a0e02d0069f543dd574ef040db4b83`
and zero differences, validated at checksum `0x40`/digest
`1f940f7663310bfae78174ab276a54b74c10617ddb68675acdad908772f1f62d`,
and booted healthy as firmware 0.4.1. Visual acceptance remains pending. The
expected screen has a painted dark background and one centered transparent I4
cat, with neither a white square nor lower-screen corruption. Stage 3E is the
prior live visual rollback for this image track; Stage 3C.1 remains the smaller
owned-label recovery baseline.

The workspace now also includes an unofficial guarded
[widget SDK](../f1-widget-sdk/README.md). Version 0.3 provides `init`,
`validate`, `build`, `inspect`, a cached real `combined` builder, and a separate
opt-in fail-closed app-only `deploy` workflow. It is pinned to this exact Framer
0.4.1 research base and passes 31/31 SDK tests.

The Music Player ID-`1` module is now linked with corrected WPM ID-`7` under a
sole setup wrapper. The exact 2,029,088-byte app SHA-256
`6cad38dee31e5a44ce32011686cca38e38ff35b1fe7c32300ced92b68549df26`
was written app-only at 921600 baud with esptool's write hash verification and
booted healthy as `knob_f1` firmware 0.4.1. Runtime visual/navigation acceptance
is pending user observation.

## Explicit non-goals and constraints

- Do not cross-flash Nomad firmware onto the Framer F1.
- Do not treat forced Input cards as installed firmware apps.
- Do not overwrite NVS or filesystem data for an app-only experiment.
- Do not use `erase-flash`, `--force`, or eFuse-writing commands.
- Do not redistribute Work Louder's extracted private SDK or recovered
  proprietary code. Research notes and original interoperability tooling can be
  documented without republishing their package.
- Do not claim a full backup or flashed custom image is verified until the live
  file size, hashes, read-back, and boot behavior are recorded.

## Next decision gates

The complete 16 MiB read, hashes, partition extraction, security reports, and
restore reference are recorded, and the narrow stage-1 app write/read-back/boot
test passed. Before a stage-2 behavior write, the remaining recovery gate is a
demonstrated way to enter the ROM bootloader **without calling the running
firmware**. The current Input
RPC cannot help if a custom image does not boot, and firmware analysis found no
independent front-panel bootloader path. A live, VID/PID-filtered Espressif
`usb-reset` probe also found no F1 serial port under the normal Stage-1 app:
macOS exposed only the product's custom HID interface. Physical PCB
GPIO0/BOOT plus reset/EN access should therefore be verified. Stage 1 still
has no standalone visual record, but its unchanged `Pomo` heading was later
confirmed on live Stage 3B; stage 2 remains unflashed.
The conservative identification and proof procedure is in the
[recovery-pad appendix](./11-recovery-pad-identification.md).
