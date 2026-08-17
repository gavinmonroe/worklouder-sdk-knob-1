FRAMER F1 MUSIC HOST — macOS

The Music widget needs this Mac host companion in addition to the firmware on
the keyboard. Work Louder Input alone does not publish music to custom Music ID 1.

Requirements

- A Framer F1 / Knob F1 on firmware 0.4.1 with the Music widget installed.
- Exactly one Framer F1 connected directly by USB. Bluetooth-only is not supported.
- Work Louder Input installed as /Applications/input.app.
- Node.js 22 or newer from https://nodejs.org.

Start

1. Quit Work Louder Input completely if it is open.
2. Connect the keyboard by USB.
3. Double-click “Start Framer Music Sync.command”.
4. Keep the Terminal window open while using Apple Music or a Chrome / YouTube
   Music tab. “running”, then “published”, means the widget received its state.
   Repeating “unchanged” heartbeat lines are normal.

If macOS does not open the launcher on double-click, open Terminal and run:

  zsh "/path/to/Framer F1 Music Host/Start Framer Music Sync.command"

Reconnect behavior

Leave this companion running when the USB cable is disconnected. It keeps
polling, invalidates the old device cache, and resends the full metadata and
album art after the wired keyboard returns. If this Terminal process is not
running, reconnecting the keyboard alone cannot restart Music sync.

Troubleshooting

- No “running”: confirm Node.js 22+ and /Applications/input.app are installed.
- “Input is already running”: quit Input and launch this companion again.
- “Expected exactly one USB Framer F1”: connect one keyboard by USB and remove
  other supported Work Louder devices.
- “no-active-media”: start playback in Apple Music or Chrome / YouTube Music.
- “unchanged” with correct art/title: the connection is healthy.

No reflash is needed when updating this host companion. Reflash only when the
Music widget firmware itself is not installed on the keyboard.
