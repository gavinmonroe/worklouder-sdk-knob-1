# Framer F1 widgets lab

This is the first Framer-specific reconstruction of a Nomad widget: a
host-driven Pomodoro timer rendered through the Framer firmware's undocumented
`v.framer.bubble` RPC.

It is intentionally non-persistent. It does not flash firmware, install an app,
or write the keyboard filesystem. Input `0.18.2` must be installed at its normal
`/Applications/input.app` path and the Framer must be connected.

## Run

Quit Input, then launch the signed app with its main-process debugger listening
on localhost:

```sh
open -n -a input --args --inspect=9230
```

Try a 12-second work/break cycle:

```sh
node framer-widgets/pomodoro.mjs demo
node framer-widgets/pomodoro.mjs status
```

Start a normal session, or stop the current one:

```sh
node framer-widgets/pomodoro.mjs start --work-minutes 25 --break-minutes 5 --cycles 4
node framer-widgets/pomodoro.mjs stop
```

The timer continues inside Input's main process after the command returns. Quit
and reopen Input normally when finished to remove the local debugger endpoint.

## WPM pet prototype

The WPM pet is a deterministic, hardware-free prototype of a second custom
widget. It mirrors the smoothing constants and half-second update cadence found
in the stock firmware's native keyboard-statistics middleware, then maps the
current, average, high, low, and idle time to small pet moods.

```sh
node framer-widgets/wpm-pet.mjs demo
node framer-widgets/wpm-pet.mjs rpc-demo
```

`rpc-demo` prints exact `v.framer.bubble` request objects but deliberately does
not send them. This makes its output testable without Input or a keyboard. See
[`docs/10-wpm-pet-widget.md`](../docs/10-wpm-pet-widget.md) for the state model,
firmware evidence, and host prototype. The byte-pinned native registry/view
design is in
[`docs/12-wpm-pet-native-view.md`](../docs/12-wpm-pet-native-view.md); it is a
machine-audited design, not a flash-ready Stage-3C builder.

## Current scope

- Displays `FOCUS n/N`, `BREAK n/N`, and a `MM:SS` countdown on the Framer.
- Keeps time against absolute deadlines, so HID latency does not accumulate.
- Uses only `v.framer.bubble` with `{l, v, d, s}`. Firmware analysis confirms
  `s=1` shows the bubble and `d=1` shows its small running-status dot.
- Refreshes once per second because firmware removes stale bubbles 10 seconds
  after the last update. The Mac owns the countdown; the keyboard does not.
- Does not yet bind the Framer knob/button to pause, skip, or reset.
