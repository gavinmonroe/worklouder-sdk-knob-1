# WPM pet widget

## Implementation boundary

| Piece | Current status |
| --- | --- |
| Pet metric/state model | Implemented and tested offline |
| `demo` | Hardware-free deterministic console simulation |
| `rpc-demo` | Prints bubble JSON only; sends nothing |
| Host live-key adapter | Not implemented; would require explicit macOS Input Monitoring permission |
| Stage-3C native screen | Installed and boots; runtime PARTIAL/DEFECT |
| Stage-3C.1 correction | LIVE VISUAL SUCCESS |
| Stage-3D pet/stat/idle screen | Live image/health success; runtime PARTIAL/DEFECT |
| Stage-3E blue-cat sprite | LIVE VISUAL SUCCESS |
| Stage-3E.1 full-canvas sky | Offline deterministic; NOT LIVE |
| Stage-3E.2 six-species selector | Live image/health success; RUNTIME NO-GO |
| Stage-3E.3A in-page I4 canary | Static GO; live image/health success; visual pending |

The host pet model remains a design/behavior proof and is not receiving live
typing. The separately installed native Stage-3C number screen is defective.
Its Stage-3C.1 correction is now installed, booting, and visually accepted.

The separate [native WPM screen design](./12-wpm-pet-native-view.md) now pins
the dynamic controller registry, unused ID `7`, navigation insertion, exact
LVGL lifecycle, controller ABI, WPM hooks, one-IROM growth rules, and staged
callable/selectable plan. The S3-specific assembler/linker round trip now pins a
564-byte ABI artifact. A guarded deterministic builder integrates it into a
six-segment, one-IROM image. That app is now installed and boots normally on the
F1. ID `7` is live-navigable, but its rendering/lifecycle is defective and
typing-driven behavior remains unproven.

The experimental source and linker layout are
[`stage3c-wpm-abi.S`](../custom-firmware/experimental/stage3c-wpm-abi.S) and
[`stage3c-wpm-abi.ld`](../custom-firmware/experimental/stage3c-wpm-abi.ld).
[`verify-stage3c-abi.mjs`](../custom-firmware/tools/verify-stage3c-abi.mjs)
requires the ESP32-S3 little-endian toolchain and pins its 564-byte output to
SHA-256
`c661adce78963c562625ece9f647033b864c4e91816d00223c3c6b8800936003`.
The candidate uses a 112-byte controller with a writable RAM vtable, leaves the
stock 500-ms WPM callback untouched, and refreshes from the native live-WPM
float in the verified 100-ms LVGL controller timer. A divider publishes the
bubble only every 500 ms, matching the native tracker cadence.

The image builder and its five focused tests are
[`build-stage3c.mjs`](../custom-firmware/build-stage3c.mjs) and
[`stage3c.test.mjs`](../custom-firmware/test/stage3c.test.mjs). The generated
app SHA-256 is
`4179b868b5a888f155fa93457c6ce9c8e57965ed5c756230dbb076fe27e910e6`;
the merged comparison image SHA-256 is
`e48aac41de808daa27addf7fd541f83bf8dc21fa6620378471dc09eb481104da`.
The app was subsequently written and completely read back with that exact hash,
passed checksum/digest validation, and booted normally. This proves installed
bytes and bootability. Runtime testing found ID `7`, but it opens a black screen;
cycling to the first screen briefly shows a faint `wpm` popup before it
disappears.

That result fails acceptance. Typing-driven value changes were not verified,
and the misplaced popup's disappearance is not accepted as correct cleanup.
Root-cause analysis found that the process-global bubble is consumed by stock
ID `8`, while ID `7` owned a blank root. The popup therefore crossed screens on
unload.

Stage 3C.1 instead builds title/value labels under ID `7`'s own root in stock
slot `1`, keeps slot `3` as no-op, null-guards periodic value painting, and has
no appended global-bubble references. Its pinned 484-byte ABI SHA-256 is
`f28b7b48ff43283824fcc3d440d7f591437bd1dc7b4880a7b88695a7df632712`;
the 1,960,496-byte app SHA-256 is
`e2e7ba4ab4b9c247af8c0bdc3d7896ac52967bb7f90fb19beae73c0ae4a2b8fd`.
See [`build-stage3c1.mjs`](../custom-firmware/build-stage3c1.mjs),
[`stage3c1-wpm-labels.S`](../custom-firmware/experimental/stage3c1-wpm-labels.S),
[`verify-stage3c1-abi.mjs`](../custom-firmware/tools/verify-stage3c1-abi.mjs),
and [`stage3c1.test.mjs`](../custom-firmware/test/stage3c1.test.mjs).
Independent generated-image review returned STATIC GO. The exact app was
written app-only at `0x10000`, fully read back with the same SHA-256 and zero
byte differences, and booted normally after watchdog reset. Image checksum
`0xB5` and digest
`19ea7be90597720134b1bb2cf86144a6e17dc6b68b0cbf20320055139250a1c7`
validated. The user confirmed persistent white `wpm` text and typing-driven
value updates. The owned labels fix Stage 3C's black screen and misplaced faint
popup. Freeze this app SHA as the Stage-3D rollback base.

Stage 3D now has an executable state model with six focused tests, four-label
ABI, and deterministic firmware builder. It targets a pet plus current,
average, high, and low WPM and explicit idle/sleep behavior. ABI SHA-256 is
`e7788b20cd4d8733f67c96f16e7a4dfc71834f2e8a425279bf562e4fa34d6a17`;
the 1,961,808-byte app SHA-256 is
`dd80791208577a1667ccd17956798d379d6e9a34f943188ac4334d045801c491`.
The ABI has STATIC GO. The exact app was written, fully read back with the same
SHA and zero byte differences, and booted with normal firmware/device health.
Runtime observation found rendered screen/text, a cat that did not update, and
one crash/watchdog reboot after the first restart that has not repeated. No
cause is assigned. The next track is exact coredump diagnosis, key-hook removal
or repair, stock wallpaper/LVGL image research, screen-owned frames, and proof
of real state changes. See the
[native-view evidence and acceptance plan](./12-wpm-pet-native-view.md#stage-3d--on-device-pet-semantics).

Stage 3E subsequently removed both unsafe Stage-3D paths and proved
screen-owned images live. LVGL reports a logical 100×310 canvas, despite the
product's 310×100 marketing orientation; a centered 100×100 sky therefore
filled only the middle third. Stage 3E.1 is the exact offline 100×310 fix.
Stage 3E.2 has exact live write/read-back/boot/health success, but is a runtime
NO-GO. Its six-species control is Fn + bottom knob, local to ID `7`, RAM-only,
and has no global key hook. Sky-1 crosses the original mapped-DROM boundary at
row `267`, column `92`, exactly matching the bottom 13.6% black corruption;
all pet payloads begin above that boundary, matching the white squares.

Stage 3E.3A isolates the decoder to one 52×42 binary-alpha I4 cat wholly below
the boundary. It received independent STATIC GO, and its exact 2,026,624-byte
app was written, fully read back, integrity-validated, and booted healthy on
0.4.1. Visual acceptance remains pending: dark background, centered transparent
cat, no white square, and no lower-screen glitch. Exact Stage-3E.1 through
3E.3A records are in the
[image-pipeline record](./13-stage3d-image-pipeline.md).

## The idea

The WPM pet turns typing rhythm into a tiny companion instead of a sterile
speedometer. It wakes up when typing starts, reacts to the current pace relative
to the session average/high/low, gets bored during a short pause, and sleeps
after a longer idle period.

The hardware-free prototype is in
[`framer-widgets/wpm-pet.mjs`](../framer-widgets/wpm-pet.mjs). It is deterministic
and never opens HID or serial:

```sh
node framer-widgets/wpm-pet.mjs demo
node framer-widgets/wpm-pet.mjs rpc-demo
npm --prefix framer-widgets test
```

`rpc-demo` emits the exact two-line `v.framer.bubble` requests that an opt-in
host adapter could send later. It does not send them itself.

The state implementation is
[`framer-widgets/lib/wpm-pet-model.mjs`](../framer-widgets/lib/wpm-pet-model.mjs)
and its deterministic tests are in
[`framer-widgets/test/wpm-pet-model.test.mjs`](../framer-widgets/test/wpm-pet-model.test.mjs).
They cover native 500-ms EWMA behavior, convergence near steady 60 WPM, warmup
and idle moods, ordinary-key activity without word counting, five-minute
session reset, bubble size/shape constraints, deterministic demo coverage, and
invalid/non-monotonic input rejection.

The WPM model contributes eight tests; with the three Pomodoro option tests,
`npm --prefix framer-widgets test` currently passes 11/11 widget tests.

## A useful surprise in stock Framer firmware

**Offline verified.** Framer F1 0.4.1 already contains a native keyboard-stats
middleware named
`worklouder::kb::extra::middlewares::kb_stats`, configured under the NVS
namespace `wl_kb_stats`. Its persistent key is `wpm_record`.

The relevant native behavior is unusually recoverable from the binary:

- The input callback treats USB HID keycode `0x2C` (Space) as a completed word.
- A timer runs every `0x7A120` microseconds: exactly 500 ms.
- Each tick computes `words_in_tick * 120`, the words-per-minute rate for a
  half-second bucket.
- It smooths the result as `current = 0.9 * previous + 0.1 * bucket_rate`.
- If current exceeds the stored 16-bit record, it writes a new `wpm_record` to
  NVS, then clears the half-second counter.

Useful static addresses in the extracted 0.4.1 IROM are:

| Item | Virtual address |
| --- | ---: |
| Space-key/event callback | `0x4206EAE0` |
| Native WPM timer update | `0x4206ED14` |
| NVS helper/config path | `0x4206EB48` |
| `wpm_record` literal | `0x42041590` -> DROM `0x3C12E7B4` |
| Static `kb_stats` object | BSS `0x3FCAB9E0` |
| Half-second word counter | object `+62`, BSS `0x3FCABA1E` |
| Smoothed current WPM float | object `+64`, BSS `0x3FCABA20` |
| Cached lifetime record | BSS `0x3FCAE930` (`u16`) |
| Record-cache initialized flag | BSS `0x3FCAE932` (`u8`) |

**Backup-only finding.** Parsing the captured pre-custom NVS image shows
namespace id `2` named `wl_kb_stats` and an active unsigned-16
`wpm_record` value of `122`. That is a property of this backup, not a factory
default.

This means a future native pet does not need to invent basic speed collection.
It can either reuse the linked tracker or bridge its current value into a new
controller. What the stock image does **not** expose is a WPM JSON-RPC method,
notification, Input service, visible WPM screen, session average, or session
low. Searches of the firmware RPC strings and Input 0.18.2's device-notify
router found no WPM transport.

**Reference-image finding.** Nomad E v2 0.2.0 carries a newer component named
`kb_telemetry` with strings for `set_wpm_record`, `reset_record`, “WPM record
and current reset,” and new-record/online diagnostics. Framer 0.4.1 carries the
older `kb_stats` form without those reset/logging strings. The Nomad component
is a useful behavioral reference, but it is not evidence that its binary code
or board firmware can be copied directly to the F1.

The native tracker also exposes an important semantic boundary: its persistent
`wpm_record` is a lifetime-style maximum, while the current EWMA lives as a
float in the native object. Reading NVS repeatedly would yield the record, not
a live speed feed, and would be the wrong basis for pet moods.

## Prototype metric and session rules

The prototype intentionally mirrors the native tracker instead of assuming
five arbitrary characters equal a word:

1. Any key refreshes activity/idle time.
2. Space completes one word and increments the current 500-ms bucket.
3. Every 500 ms, the 0.1/0.9 native EWMA updates current WPM.
4. The first 10 seconds and first five words are warmup and do not enter
   session extrema.
5. Average, high, and low are calculated from mature half-second samples while
   the user is active. Zeros during a pause do not become a misleading low.
6. Five seconds without any key enters `waiting`; 30 seconds enters
   `sleeping`.
7. A key after five minutes of inactivity automatically starts a new session.
   Explicit reset is also supported by the model.

The session low is the lowest mature, active smoothed WPM sample. The session
high is the highest. Average is the arithmetic mean of those same samples.
This makes all three statistics comparable to the current EWMA.

## Pet states

| State | Face | Rule |
| --- | --- | --- |
| `ready` | `(o.o)` | No session yet |
| `hatching` | `(?.?)` | Fewer than 10 seconds or five completed words |
| `sleeping` | `(-.-)z` | At least 30 seconds idle |
| `waiting` | `(._.)` | At least 5 seconds idle |
| `fire` | `(^O^)!` | A mature new high, celebrated for 1.5 seconds |
| `zooming` | `(>o<)` | Current is at least 90% of the session high |
| `happy` | `(^.^)` | Current is at or above session average |
| `tired` | `(u.u)` | Current is within 10% of session low |
| `steady` | `(o.o)` | Between the tired and happy bands |

The faces are ASCII because the Framer firmware's available glyph coverage has
not been proven for arbitrary emoji.

## What the bubble can do now

The existing Framer bubble can show only a short label, a short value, a dot,
and visibility. The prototype compresses a sample to:

```json
{
  "method": "v.framer.bubble",
  "params": {
    "l": "PET HAPPY",
    "v": "(^.^) 72 WPM A65 H92 L41",
    "d": 1,
    "s": 1
  }
}
```

Here `A`, `H`, and `L` mean session average, high, and low. An opt-in host event
source could feed the model and use the already-proven bubble transport. It
would need macOS Input Monitoring permission and must refresh within the
bubble's ten-second TTL. It would still be a Mac-owned overlay, not a selectable
device-resident widget.

## What a persistent native widget needs

A true WPM pet on the Framer should:

1. Reuse or safely expose the stock `kb_stats` current EWMA and NVS record.
2. Add session average/low/high and explicit/idle reset semantics without
   increasing NVS write frequency on every half-second sample.
3. Register a real screen/controller in the Framer navigation registry.
4. Draw faces with LVGL primitives or compact monochrome assets, avoiding emoji
   font dependence.
5. Use key activity for idle moods while counting only Space for completed
   words, matching stock behavior.
6. Keep the persistent lifetime record distinct from the resettable session
   high.
7. Add a knob/button action for resetting the session or changing the pet face,
   then test that this does not steal normal keyboard input.

The first native implementation can use text faces and the existing tracker.
Animated sprites, food/experience, daily history, and pet customization are fun
follow-ons once the screen registration and recovery path are proven.
