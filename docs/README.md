# Framer F1 research handbook

This handbook records the attempt to build and flash a custom, device-resident
widget for the Work Louder Framer F1. It covers the useful host-side prototype,
the firmware evidence, recovery preparation, and the staged native-firmware
path. The goal is not merely to make a desktop card appear: the end state is a
Pomodoro that runs on the keyboard and survives disconnecting the Mac.

## Current status — 2026-08-15

| Milestone | Status | Evidence |
| --- | --- | --- |
| Extract Input 0.18.2 for inspection | Verified offline | `extracted/input-app/` |
| Force Clock, Pomodoro, and Media Player cards into a lab UI | Verified in lab build | `artifacts/Input Lab.app` and `artifacts/input-lab-widget-proof.png` |
| Display custom content on the physical F1 | Verified live | `v.framer.bubble` proof |
| Run a host-driven Pomodoro on the physical F1 | Verified live | `framer-widgets/pomodoro.mjs` |
| Find a hidden Framer Pomodoro/Media package | Ruled out for stock 0.4.1 | Firmware and SDK inspection |
| Save official Framer 0.4.1 and identify its layout | Verified offline | SHA-256-pinned merged and app images |
| Inspect the attached F1's chip and boot security | Verified live | ESP32-S3, 16 MiB flash, security disabled |
| Capture the complete live 16 MiB flash | Verified live | 16,777,216 bytes, SHA-256 `aa604231…8fdd`; 17/17 saved-file hashes verify |
| Verify bootloader entry without a working app | Live verified on Knob 1; still pending for the F1 | Two buttons beside the Knob 1 spacebar reach ROM download mode with no app involvement, and `sys.bootloader` works without an Input install ([docs/22](./22-app-independent-bootloader-entry.md)). No F1 pad or button is identified yet. |
| Build a persistent stage-1 `Timer` to `Pomo` firmware patch | Verified offline | Tests plus valid ESP checksum and appended digest |
| Flash/read back/boot stage 1 on the F1 | Verified live; heading path later confirmed visually | App-only write and 1,960,000-byte read-back match; the unchanged Stage-1 `Pomo` heading was user-confirmed on the live Stage-3B derivative |
| Build and independently audit native 25/5 ×4 bridge | Static GO; runtime pending | All 9 guarded ranges, control flow, field adapters, and hashes verified; no static crash defect found |
| Audit initial 7-segment growth canary | Rejected / NO-GO; never flash | ESP-IDF 5.3.2 maps only the last IROM segment, which would displace the stock executable mapping; replacement grows the existing IROM |
| Flash/read back/boot corrected single-IROM Stage-3A canary | Verified live; nonvisual by design | Structural/loader GO; 1,960,016-byte app-only write/read-back exact; six segments/one IROM; `knob_f1` returned healthy on 0.4.1 |
| Audit/flash/read back/boot/observe Stage-3B appended-code canary | Static GO; verified live and visually | Four consumers/windowed ABI/hashes independently reproduced; exact read-back; user confirmed `Pomo` / `00:42` |
| Add Pomodoro as a separate selectable widget | Future target | Requires a safe registry/controller extension |
| Reconstruct native WPM tracker and build pet model | Verified offline | Native Space-word EWMA/NVS path plus deterministic hardware-free prototype |
| Audit native WPM registry/view route | Verified offline | Registry, live-length dial navigation, lifecycle, ID `7`, 112-byte controller layout, and 564-byte S3 artifact are machine-pinned |
| Build/flash/read back/boot native selectable WPM | Live image success; runtime PARTIAL/DEFECT | ID `7` exists but opens black; cycling to first screen briefly shows a faint `wpm` popup, then it disappears; typing/update/cleanup acceptance failed pending fix |
| Audit/flash/read back/boot/observe Stage-3C.1 correction | LIVE VISUAL SUCCESS | Exact 1,960,496-byte app matched; persistent white `wpm` text and typing-driven value updates user-confirmed; accepted Stage-3D rollback base |
| Build/flash/read back/boot/observe Stage-3D pet/stat/idle view | Live image/health success; runtime PARTIAL/DEFECT | Screen/text rendered; cat did not update; one non-repeated crash/watchdog reboot after first restart; diagnosis pending |
| Diagnose Stage-3D / build and deploy Stage-3E | LIVE VISUAL SUCCESS | Core pins Stage-3D defects; blue-cat sprite pipeline rendered; logical canvas proved 100×310, so the 100×100 sky occupied the middle third |
| Build Stage-3E.1 full-canvas image | Offline deterministic; NOT LIVE | 100×310 sky milestone with pinned assets, ABI, app, integrity, and tests |
| Build/flash/read back/boot/observe Stage-3E.2 six-species selector | Live image/health success; RUNTIME NO-GO | Boundary analysis exactly explains the bottom 13.6% corruption and white avatars: sky-1 crosses `0x3C1D0000`, and every pet payload starts above it |
| Audit/flash/read back/boot Stage-3E.3A in-page I4 canary | Static GO; live image/health success; visual pending | Exact 2,026,624-byte app/read-back; checksum/digest valid; healthy 0.4.1 boot; awaiting dark-background/transparent-cat observation |
| Build an unofficial widget SDK | Verified offline | Version 0.3 adds cached corrected combined builds and a separate fail-closed app-only deploy workflow; 31/31 SDK tests |
| Prepare Music Player ID-`1` candidate | Write/boot healthy; visual pending | Music ID1 and WPM ID7 link under one setup wrapper; exact app-only write hash verified and booted on 0.4.1, awaiting navigation/visual acceptance |
| SDK automated tests | Verified | 31/31, including deterministic combined image, cache, image-info, recovery gates, and simulated device refusal paths |

## Evidence labels

These labels are used throughout the handbook so observations do not slowly
turn into stronger claims than the evidence supports.

- **Live verified:** observed on the attached physical Framer F1.
- **Offline verified:** reproduced from a saved binary, extracted application,
  source in this workspace, or a deterministic test.
- **Inference:** the best explanation of the evidence, but not yet exercised on
  the physical device.
- **Pending:** a planned step whose success has not been recorded.

## Reading order

1. [Goals, scope, and status](./01-goals-and-status.md)
2. [System architecture](./02-architecture.md)
3. [Evidence and firmware findings](./03-evidence-and-findings.md)
4. [Recovery and backup runbook](./04-recovery-and-restore.md)
5. [Host-driven widget workflow](./05-host-widget.md)
6. [Native custom-firmware workflow](./06-custom-firmware.md)
7. [Reverse-engineering notebook](./07-research-workflow.md)
8. [Useful facts and glossary](./08-facts-and-glossary.md)
9. [Stage-2 native bridge candidate appendix](./09-stage2-patch-candidate.md)
10. [WPM pet widget](./10-wpm-pet-widget.md)
11. [Physical recovery-pad identification appendix](./11-recovery-pad-identification.md)
12. [Native WPM pet screen and segment-growth design](./12-wpm-pet-native-view.md)
13. [Stage-3D diagnosis and Stage-3E native image pipeline](./13-stage3d-image-pipeline.md)
14. [Unofficial hardware-free widget SDK](./14-widget-sdk.md)

The shorter component READMEs remain useful command references:

- [`framer-widgets/README.md`](../framer-widgets/README.md)
- [`f1-cli/README.md`](../f1-cli/README.md)
- [`f1-cli/recovery/README.md`](../f1-cli/recovery/README.md)
- [`custom-firmware/README.md`](../custom-firmware/README.md)
- [`f1-widget-sdk/README.md`](../f1-widget-sdk/README.md)

## Documentation rule

Whenever a live experiment is performed, record the image hash, device
identity, command, result, and recovery route before upgrading its status in
this handbook. Failed experiments are findings too; preserve their baud rate,
offset, and failure boundary.
