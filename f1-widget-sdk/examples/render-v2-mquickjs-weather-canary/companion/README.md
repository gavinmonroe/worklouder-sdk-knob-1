# Framer F1 Weather Host — macOS

## What this does

The Weather widget's ZIP code is edited on the keyboard but stored on the
Mac, and live weather comes from a real network lookup — the keyboard cannot
do either on its own. This host companion, every time it runs:

1. Pushes the clock + timer package to the keyboard. This package lives only
   in the module's RAM, so it is lost every time the keyboard power-cycles
   and must be re-pushed on every boot.
2. Polls the keyboard for a ZIP the Weather widget's settings screen saved,
   persists it on the Mac, fetches current weather + a 3-day forecast for it
   from Open-Meteo, pushes the result to the widget, and acknowledges the
   save.

It must keep running for live weather updates and for ZIP saves made on the
keyboard to take effect. Closing it (or losing the USB connection) stops both.

## Requirements

- A Framer F1 / Knob F1 on firmware 0.4.1 with the Weather widget installed.
- Exactly one Framer F1 connected directly by USB. Bluetooth-only is not
  supported.
- Work Louder Input installed as `/Applications/input.app`.
- Node.js 22 or newer from https://nodejs.org.

This companion never flashes firmware. It only talks to the keyboard over the
RPC transport Input already exposes; nothing here writes to flash or NVS.

## Start

1. Quit the Framer F1 Music Host companion if it is running — it shares the
   same keyboard RPC transport, and this launcher refuses to start while it
   is active.
2. Connect the keyboard by USB.
3. Double-click "Framer F1 Weather Host.command".
4. Keep the Terminal window open. You should see the clock + timer package
   push, then repeating `decision` / `event-batch` lines as the host polls
   and (when there is something new) pushes weather.

If macOS does not open the launcher on double-click, open Terminal and run:

```
zsh "/path/to/Framer F1 Weather Host/Framer F1 Weather Host.command"
```

## Power-cycle behavior

The clock + timer package is RAM-only and does not survive a power-cycle or
reflash. If the keyboard loses power (unplugged, battery empties, etc.),
quit this companion and run the launcher again — it re-pushes the package on
every start. A `begin rejected` line right after "Pushing the clock + timer
package" is expected and harmless; it just means the package was already
applied earlier this boot.

## Changing the ZIP code

**On the keyboard**, while the Weather widget is showing:

- Hold Space and LeftShift together for about a second to open ZIP settings
  (hold the same chord again to leave without saving).
- Turn Fn + the knob to change the highlighted digit.
- Tap Space + LeftShift together (a quick press-release, not a hold) to
  advance to the next digit.
- Tap the chord on the 5th digit to save. The widget shows "Saved…" until
  this host pushes fresh weather for the new ZIP.
- Settings time out and cancel automatically after about 30 seconds of no
  input.

**On the Mac**, you can instead edit the config file directly while this
companion is stopped, then start it again:

```
~/Library/Application Support/FramerF1WeatherHost/zip-sync-config.json
```

Set `"postalCode"` to a 5-digit US ZIP (default `"60601"`). The file is
created automatically the first time a ZIP is saved or changed; it does not
need to exist beforehand.

## Troubleshooting

- No "running" / no clock+timer push line: confirm Node.js 22+ and
  `/Applications/input.app` are installed.
- "The Framer F1 Music Host (run-live-media) appears to be running": quit the
  Music Host companion, then launch this one again. The two share the
  keyboard's RPC transport and cannot run at the same time.
- "Input is already running without remote debugging enabled": quit Input
  completely, then run this launcher again.
- "Expected exactly one USB Framer F1": connect one keyboard by USB and
  remove other supported Work Louder devices.
- `provider-error` lines: the Open-Meteo lookup failed (network issue or an
  invalid ZIP); the widget keeps its last-good weather until the next
  successful fetch.

No reflash is needed to update this host companion. Reflash only when the
Weather widget firmware itself is not installed on the keyboard.
