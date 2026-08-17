# Framer F1 widget research lab

## Browser flasher

[`web-flasher`](./web-flasher) is a static React 19 + Vite catalog for WPM Pet,
Music, and the Custom HTML/CSS Preview widget. The live-accepted images and an
explicitly approved renderer smoke candidate can use Chrome WebHID and Web
Serial to install only their SHA-pinned factory app at `0x10000`. On origins
where Chrome omits the HID serial, an explicit one-connected-device fallback
keeps the chip, layout, flash, security, ROM-MAC recording, and post-boot gates
active. The renderer
entry reads its size, hash, and deployable status from the generated manifest
and remains visibly labeled until its runtime is live accepted. The installer
retains the CLI workflow's ESP32-S3, same-device MAC when exposed, 16MB flash,
security, image-integrity, device-hash, and post-boot health gates.

```sh
npm --prefix web-flasher install
npm --prefix web-flasher run dev
```

This workspace contains a recovery-gated investigation of Work Louder Input
0.18.2 and Framer F1 firmware 0.4.1. It now includes both a verified host-side
Pomodoro and the first offline-validated native firmware patch. Live progress,
evidence levels, and exact recovery steps are maintained in the
[`docs/` handbook](./docs/README.md).

## Result

- The Input desktop UI can be changed: the separate `artifacts/Input Lab.app`
  build shows Clock, Pomodoro, and Media Player cards for a mocked Framer F1.
- The real Framer accepts the undocumented `v.framer.bubble` display RPC.
- `framer-widgets/pomodoro.mjs` implements a working host-driven Pomodoro on the
  physical F1 using that display surface.
- Pomodoro and Media Player are not hidden installable packages in Framer 0.4.1.
  The F1 does contain a linked but unwired Pomodoro-like state machine, but no
  visible Pomodoro view/registry entry or dynamic Framer app runtime.
- A stage-1 custom app image changes the visible Timer screen heading to `Pomo`
  while preserving image length and partition layout. It is built and
  integrity-validated, flashed app-only, read back byte-for-byte, and booted on
  the F1. USB identity/version/status are healthy. The Stage-1 heading bytes
  remain unchanged in Stage 3B, where the user later confirmed `Pomo` on the
  physical display.
- The stage-2 25/5 ×4 native bridge has an independent static GO: all nine
  guarded patches, control flow, field adapters, and hashes verify with no
  static crash defect found. Runtime behavior is still unproven.
- The initial Stage-3A design appended a seventh, second IROM segment and is
  **REJECTED/NO-GO**: ESP-IDF 5.3.2 maps only the last IROM segment, so it could
  displace the stock executable mapping despite passing `esptool`. Never flash
  that artifact. Its replacement now grows the existing single IROM segment,
  retains six segments, passed independent structural/loader audit, and was
  flashed app-only, read back exactly, and booted successfully on the F1. It is
  deliberately nonvisual. The Stage-3B canary then redirected one read-only
  getter to appended code returning 42; it was written/read back exactly,
  received independent STATIC GO, booted normally, and the user confirmed
  `Pomo` / `00:42` on the physical screen. That proves execution from appended
  IROM through the stock display path. Stage 3C is still the actual new
  selectable WPM pet. Its deterministic app has now been written, read back
  exactly, integrity-checked, and booted on the F1. Runtime result is
  **PARTIAL/DEFECT**: ID `7` is navigable but opens black; after cycling to the
  first screen, a faint `wpm` popup appears briefly and disappears.
- Stock firmware already contains a native Space-word WPM tracker. A new
  hardware-free WPM pet model mirrors its 500-ms EWMA and adds documented
  warmup, mood, session-stat, and idle rules with deterministic tests.
- The dynamic device-screen registry, unused ID `7`, exact LVGL lifecycle,
  native WPM hooks, 112-byte controller layout, and a 564-byte ESP32-S3 ABI
  artifact are now machine-pinned. A deterministic Stage-3C builder integrates
  that artifact into a six-segment, one-IROM image. The exact app is now live-
  installed and boots normally, but that Stage-3C WPM view failed visual
  acceptance; the ownership cause was identified after the live run.
- Post-run analysis identified that cause: Stage 3C wrote the process-global
  bubble consumed by stock ID `8`, while ID `7` owned only a blank root. That
  produced the black page and cross-screen popup flash during unload. Stage
  3C.1 replaces it with two labels owned by ID `7`. Independent audit gave
  STATIC GO, and the exact app was written, read back, and booted. The user then
  confirmed the new ID-`7` widget works: white `wpm` text remains visible and
  its value updates while typing. Stage 3C.1 is the accepted Stage-3D rollback
  base, app SHA-256
  `e2e7ba4ab4b9c247af8c0bdc3d7896ac52967bb7f90fb19beae73c0ae4a2b8fd`.
- Stage 3D retains **LIVE WRITE + FULL READ-BACK + BOOT/HEALTH SUCCESS**, but
  runtime is **PARTIAL/DEFECT**: the screen and text rendered, the cat did not
  update, and one crash/watchdog reboot occurred after the first restart. The
  no-update cause is proven: the key wrapper used navigation manager
  `0x3FCAB378 + 12` instead of root `0x3FCAB210 -> +80 registry -> +12 current`.
  A live Xtensa core is captured, but the crash cause is not yet proven. Stage
  3C.1 remains the known-good rollback base.
- Stage 3E removes the unsafe key hook and face label and uses immutable LVGL
  images for two full-screen night skies plus eight centered blue-cat states.
  It has independent static GO. The exact 2,027,312-byte
  app was written app-only, read back byte-for-byte, integrity-checked, and
  booted with normal 0.4.1 health. Stage 3E is now **LIVE VISUAL SUCCESS**.
  The live geometry proves LVGL uses a logical 100×310 canvas, explaining why
  the centered 100×100 sky filled only the middle third.
- Stage 3E.1 is a deterministic offline full-canvas build using 100×310 skies;
  it is not live. Stage 3E.2 has exact app-only write/read-back/boot/health
  success but is a **RUNTIME NO-GO**. Its sky-1 pixels cross the last original
  DROM mapping at row 267/column 92, matching the bottom 13.6% corruption; all
  pet payloads begin above that boundary, matching the white squares.
- Stage 3E.3A isolates that finding to one static 52×42 I4 cat wholly inside
  the proven DROM page. Independent audit gave STATIC GO; the 2,026,624-byte
  app was written app-only, read back exactly, integrity-checked, and booted
  healthy on 0.4.1. Visual acceptance is pending: dark background, centered
  transparent cat, no white square, and no lower-screen glitch.
- SDK v0.3 links the Music Player ID-`1` runtime with corrected WPM ID-`7`
  under one setup wrapper. The deterministic combined app was written app-only,
  booted healthy, and accepted for live metadata, artwork, progress, and track
  changes from Apple Music and Chrome/YouTube Music.
- `f1-widget-sdk/` is an unofficial guarded authoring tool with `init`,
  `validate`, `build`, `inspect`, cached `combined`, and a separate opt-in,
  fail-closed app-only `deploy` workflow. It passes 31/31 SDK tests.

Do **not** flash the Nomad image onto a Framer. The devices have different
display/peripheral drivers. Reflashing official Framer 0.4.1 also will not wire
the latent state machine into a selectable view.

## Run the Music ID1 widget

The live-accepted Music ID1 firmware must already be installed. The host
reconnect fix and these documentation updates do **not** require another
firmware flash.

The preferred end-user setup is any Music-containing Web Flasher card: install
Music ID1 there, then choose **Download Mac host companion** to get
`framer-f1-music-host-macos.zip`. The ZIP is standalone from this repository,
but it requires Node.js 22+ and the installed Work Louder Input app. Its launcher
starts Input with `--inspect=9230` when safe and keeps the publisher in its
Terminal window; leave that window open. For SDK development, the equivalent
manual commands from the workspace root are:

```sh
open -n -a input --args --inspect=9230
npm --prefix f1-widget-sdk run media:live -- --confirm-live-rpc
```

Keep the publisher process running. Input alone reads media but does not publish
it to the custom Music ID1 screen. The current publisher supports exactly one
USB/HID Framer F1 on firmware 0.4.1; Bluetooth-only operation is not supported
or proven, so USB must remain attached. With supported media playing, normal
startup logs `"status":"running"` and then `"status":"published"`.
`"status":"unchanged"` with `"heartbeat":true` is a normal successful device
check when the snapshot has not changed.

If the F1 is unplugged while the publisher remains running, delivery errors are
expected until it returns. On wired reconnect, the publisher invalidates its
old device cache and resends complete metadata and artwork. If the publisher
was stopped, reconnecting the keyboard alone cannot resume syncing; run the
command again. See the full [media transport setup and no-update checklist](./f1-widget-sdk/docs/media-transport.md).

## Use the current Pomodoro proof

Quit Input and relaunch the signed app with a localhost debugger:

```sh
open -n -a input --args --inspect=9230
```

Then run either a short demo or a normal session:

```sh
node framer-widgets/pomodoro.mjs demo
node framer-widgets/pomodoro.mjs start --work-minutes 25 --break-minutes 5 --cycles 4
node framer-widgets/pomodoro.mjs status
node framer-widgets/pomodoro.mjs stop
```

The Pomodoro is a Mac-hosted extension, not an installed firmware app, so it
does not appear in the stock Input Widgets page. The Mac owns the countdown and
sends an update each second. Firmware removes the bubble 10 seconds after the
last update if Input exits, the keyboard disconnects, or the Mac sleeps.

Quit and reopen Input normally after the experiment to close the debugger port.

## Workspace map

- `framer-widgets/`: Framer Pomodoro plus the hardware-free WPM pet model,
  demos, tests, and usage.
- `f1-cli/`: guarded inspection/backup CLI plus a tightly scoped bubble command.
- `custom-firmware/`: deterministic stage-1 app patcher, tests, and manifests.
- `f1-widget-sdk/`: guarded custom-widget scaffolder, builder, inspector,
  documentation system, and sample.
- `recovery/`: bootloader entry and device-specific recovery captures.
- `docs/`: architecture, findings, backup/restore, flashing, and research
  handbook.
- `experiments/send-framer-bubble.mjs`: one-shot live display proof.
- `extracted/input-app/`: formatted extraction of the desktop app for research.
- `artifacts/input-lab-widget-proof.png`: screenshot of the forced-card UI proof.
- `artifacts/firmware/`: official firmware binaries used for offline comparison.

## Safety boundary

The inspection CLI blocks filesystem writes, deletes, app installation, and
firmware flashing. Its only non-read exception is the Framer-only transient
bubble RPC. Native firmware work uses separate, deliberate commands and may
proceed only after the full device backup and physical PCB GPIO0/BOOT plus
reset/EN access pass the recovery gate. Normal firmware exposes custom HID but
no F1 serial port, so a filtered Espressif `usb-reset` probe did not provide an
app-independent route into the ROM bootloader. See
[`docs/04-recovery-and-restore.md`](./docs/04-recovery-and-restore.md).
