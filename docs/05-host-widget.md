# Host-driven widget workflow

The host Pomodoro is a verified prototype and protocol test. It is useful now,
but it is intentionally different from the native custom-firmware goal.

## What it does

`framer-widgets/pomodoro.mjs` injects a small session into Input's Electron main
process. That session owns the countdown, connects to exactly one Framer F1,
and sends a `v.framer.bubble` update when the visible second or phase changes.

It supports:

- focus and break durations;
- a fixed number of cycles;
- `FOCUS n/N`, `BREAK n/N`, and `MM:SS` output;
- a short demo mode;
- status and stop commands;
- absolute deadlines so transport latency does not accumulate into timer drift.

## Start Input's local debugger

Quit existing Input/Input Lab instances, then launch the signed installed app:

```sh
open -n -a input --args --inspect=9230
```

The debugger listens on localhost and lets the script evaluate in Input's main
process, where the packaged native SDK can be loaded. Quit and reopen Input
normally when finished.

## Run the Pomodoro

```sh
node framer-widgets/pomodoro.mjs demo
node framer-widgets/pomodoro.mjs start --work-minutes 25 --break-minutes 5 --cycles 4
node framer-widgets/pomodoro.mjs status
node framer-widgets/pomodoro.mjs stop
```

The start command returns after installing the session. The timer continues in
Input's main process until it completes, stops, errors, or Input exits.

## One-shot display experiments

The guarded CLI can preview the exact request without opening the device:

```sh
node f1-cli/bin/f1-readonly.mjs bubble \
  --label "Input Lab" --value "Custom bubble proof" --dry-run
```

With exactly one F1 connected, remove `--dry-run` to display it. Hide it with:

```sh
node f1-cli/bin/f1-readonly.mjs bubble \
  --label "Input Lab" --value "Hide" --d 0 --s 0
```

## Why it does not appear in Widgets

The script does not create a package under the device filesystem or add a
controller to firmware. It uses a transient overlay whose fixed expiry is 10
seconds. Refreshing once per second keeps it visible; closing Input, sleeping
the Mac, losing USB, or stopping updates lets it disappear.

This also explains why reflashing official 0.4.1 cannot make the host prototype
appear as a selectable widget. Although that image contains a linked Pomodoro-
like state object, it has no visible Pomodoro view/registration or dynamic
Framer app runtime.

## What to reuse in native firmware

The host implementation is a practical specification for:

- phase names and cycle numbering;
- focus-to-break and break-to-next-focus transitions;
- completion behavior;
- formatting remaining time;
- drift-resistant deadline arithmetic.

The native version must replace the Mac's timers and RPC updates with firmware
state, native screen updates, and knob/button callbacks.
