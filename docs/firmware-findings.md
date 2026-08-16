# Firmware findings (legacy summary)

The maintained evidence record has moved to
[`03-evidence-and-findings.md`](./03-evidence-and-findings.md). This short page
is retained for existing links.

## Why the forced cards cannot install the Nomad widgets

Framer F1 0.4.1 contains the native Timer controller plus a linked but unwired
Pomodoro-like state machine. It does not contain the Nomad `media_player`,
app-switcher, quick-app, or last-widget code, and it has no visible Pomodoro
view/registration. Nomad 0.2.0 contains a distinct Pomodoro UI/controller and
significantly more embedded UI assets. Neither stock image provides a general
dynamic widget runtime for the Framer.

The forced desktop cards therefore prove that Input's renderer can be changed;
they do not create firmware functionality.

## Framer bubble model

The Framer-only `v.framer.bubble` handler stores this RAM-backed model:

| Field | Type | Meaning |
| --- | --- | --- |
| `l` | string | First/label line |
| `v` | string | Second/value line |
| `d` | byte boolean | Show the 8×8 status dot when `1` |
| `s` | byte boolean | Show the bubble when `1`; hide it when `0` |

Example visible call:

```json
{"method":"v.framer.bubble","params":{"l":"FOCUS","v":"25:00","d":1,"s":1},"id":1}
```

Missing parameters preserve their last values. Every call resets a fixed
10-second expiry, so a host can keep a countdown visible with one update per
second. The firmware does not decrement the value itself.

Offline evidence locations in Framer 0.4.1:

- RPC handler: `0x42005b60`
- Persistent model: `0x3fca4f00`
- UI update/deadline reset: `0x4201a930`
- Expiry check: `0x42014f08`
- Renderer: `0x4201dddc`

## Why a Nomad cross-flash is unsafe

Although the downloaded images use the same ESP32-S3 partition layout, the
Framer build uses its TFT-specific driver path while Nomad uses an i80/ST7789
display path and different encoder/buzzer peripherals. A same-layout binary is
not evidence of hardware compatibility.

## Persistent-widget path

A true selectable widget needs a Framer-targeted replacement or patched
firmware connecting state, a view, navigation registration, and input handling.
The read-only backup now passes. Static analysis found no independent
front-panel ROM selector, and a live filtered `usb-reset` probe found no F1
serial port under normal firmware, only custom HID. Further native behavior
work therefore remains gated on verified physical PCB GPIO0/BOOT plus reset/EN
access. A deterministic Stage-3C selectable-WPM image has now been written,
read back exactly, and booted normally. Runtime is partial/defective: ID `7`
opens black, while a faint `wpm` popup appears briefly after cycling away.
Typing updates and correct cleanup remain unverified. The host-driven bubble
Pomodoro is the lower-risk reference implementation for that firmware work.
Stage 3C.1 corrects the identified ID-`8` global-bubble/blank-ID-`7` ownership
mismatch with labels owned by ID `7`. Its generated image received independent
STATIC GO, and the exact app-only bytes were written, read back, and booted.
The user confirmed persistent white `wpm` text and typing-driven value updates,
so the correction is accepted. Its app SHA
`e2e7ba4ab4b9c247af8c0bdc3d7896ac52967bb7f90fb19beae73c0ae4a2b8fd`
is the Stage-3D rollback base. Stage 3D is offline-built with ABI STATIC GO and
now has exact live write/read-back plus boot/health success. Runtime is
PARTIAL/DEFECT: screen/text rendered, the cat did not update, and one crash/
watchdog reboot occurred after the first restart but has not repeated. The
no-update cause is the wrong `0x3FCAB378 + 12` lookup; the true current screen is
`0x3FCAB210 -> +80 -> +12`. The captured core has not yet established the crash
cause.

Stage 3E removed the Stage-3D key hook/face-label paths and is now LIVE VISUAL
SUCCESS. It proves LVGL's logical canvas is 100×310; the marketed 310×100 is the
physical orientation, so a centered 100×100 sky filled only the middle third.
Stage 3E.1 is a deterministic offline 100×310 full-canvas image. Stage 3E.2's
six-species, 48-frame, ID-`7`-local Fn + bottom-knob selector has exact live
write/read-back/boot/health evidence but is a runtime NO-GO. Sky-1 crosses the
original mapped-DROM boundary `0x3C1D0000` at row `267`, column `92`; all pet
payloads begin above it. Those addresses exactly explain the bottom 13.6%
corruption and white avatar squares.

Stage 3E.3A reduces the test to one static 52×42 I4 cat below that boundary.
It has independent STATIC GO and exact live write/read-back/boot/health success;
visual acceptance remains pending.
