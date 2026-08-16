# Hardware-free host bridge

The macOS half of the media bridge is implemented. The Framer runtime half is not, and the code represents that boundary as an explicit blocked sink instead of borrowing Nomad RPC names.

```text
Input --inspect=9230
  -> localhost CDP Runtime.evaluate
  -> Input's packaged media-info-retriever.scpt
  -> bounded title / artist / time / compressed art
  -> exact 80x80 RGBA8 or deterministic fallback
  -> normalize / color / render / package
  -> BlockedFramerRuntimeSink (no device I/O)
```

## Implemented modules

- `../../../src/media-transport/input-localhost-source.mjs` uses the existing `evaluateInInput` CDP transport. The example's `src/input-localhost-adapter.mjs` is a compatibility re-export. Its generated expression launches only `/usr/bin/osascript` with Input's packaged provider. It does not load `wl-device-kit`, discover devices, open HID/serial, or send RPC.
- `src/host-bridge.mjs` polls a provider-neutral source, suppresses identical one-second progress buckets, renders a complete transaction, and advances its update key and generation only after a sink explicitly returns `accepted: true`.
- `src/framer-runtime-sink.mjs` records the exact current adapter blocker and always returns `BLOCKED_BEFORE_DEVICE_IO` for a valid host bundle.
- `scripts/inspect-input-media.mjs` prints a sanitized real-media snapshot and never constructs a device transport.

The adapter caps AppleScript output at 8 MiB, compressed artwork at 6 MiB, provider/debugger/artwork operations at bounded timeouts, decoded art at `80x80` RGBA8, and title/artist at 256 characters. Spotify artwork URLs must begin and remain HTTPS. Streaming responses stop as soon as they exceed the byte budget. Missing, unavailable, malformed, or undecodable art becomes a deterministic title/artist-derived fallback.

## Run the safe inspector

```sh
open -n -a input --args --inspect=9230
cd f1-widget-sdk/examples/music-player
npm run inspect:host
```

Input's debugger is localhost-only. Quit and reopen Input normally when finished. This command reads host media state; it does not inspect or contact a keyboard.

## Why publication stops

Input and `wl-device-kit` contain a working Nomad protocol:

- device notification `mp.fetch_data` asks the host to start or stop its one-second polling loop;
- `mp.write_info` sends changed song title, artist, duration, elapsed time, and playback state;
- `mp.write_artwork` streams base64 chunks with byte offset and total size.

Input enables that feature and registers the notification only for `NomadE` and `NomadEV2`. `Knob` and `KnobF1` receive alert and wallpaper features, not media. Input's automatic media-screen startup also rejects every device type except those two Nomad variants. Stock Framer 0.4.1 and the current custom Music ID1 module have no proven handler for either write method and no bounded receive/staging buffer.

Calling those generic SDK methods against the F1 just because the client API exposes them would invent compatibility. The code therefore does not do it.

## Required Framer adapter

The next on-device feature must be independently reviewed and should be much smaller than a full rendered-frame transaction:

1. Add a versioned metadata command with strict UTF-8 and integer bounds.
2. Add an artwork transaction with fixed maximum dimensions/bytes, offset ordering, total-size validation, and a final hash.
3. Stage into controller-owned inactive RAM and publish one monotonic generation only after full verification.
4. Apply labels, progress, and the image descriptor on the LVGL UI thread.
5. Define pause, no-track, timeout, stale-generation, disconnect, and screen teardown behavior.
6. Prove repeated enter/leave and malformed/interrupted transfers without heap damage.

Only after that handler exists may an Input-localhost expression obtain exactly one F1 and invoke reviewed Framer-specific methods. The host source, normalizer, renderer, transaction identity, and polling logic do not need to change.

Continually rebuilding or reflashing static DROM for playback progress remains out of scope.

The reusable protocol/session/sink API is documented in [`../../../docs/media-transport.md`](../../../docs/media-transport.md).
