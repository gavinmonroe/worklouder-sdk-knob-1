# Music-player vertical slice

This example contains both the original hardware-free Music widget proof and
the live publisher for the accepted custom Music ID1 firmware on Framer F1
0.4.1. It accepts title, artist, decoded RGBA album art, duration, and position
through a small adapter contract. The offline path clamps progress, extracts a
deterministic album color, renders an edge-normalized radial background over
the exact logical `100x310` canvas, centers album art, and packages one offline
asset transaction.

The host bridge reuses Input 0.18.2's real macOS media provider through Input's
localhost debugger. It runs Input's hash-pinned
`media-info-retriever.scpt`, bounds and decodes artwork to RGBA8, and feeds the
same source contract. Hardware-free sessions remain blocked before device I/O;
the separate `media:live` runner opts into the one exact live-proven Music ID1
handler.

It deliberately does **not** contain `widget.json`: the current SDK compiler only accepts `wpm-roster-v2`, while this example needs a new host-fed media profile. [`widget.proposed.json`](./widget.proposed.json) is a review artifact, not something to pass to `f1-widget build`.

Run the isolated proof:

```sh
cd f1-widget-sdk/examples/music-player
npm test
npm run build:preview
npm run build:on-device
```

To inspect the currently playing macOS media without opening USB/HID, first launch Input's main process debugger and then run the host inspector:

```sh
open -n -a input --args --inspect=9230
cd f1-widget-sdk/examples/music-player
npm run inspect:host
```

The inspector prints metadata, progress, decoded-art dimensions, main color, and provenance. It does not publish anything to the keyboard. Quit and reopen Input normally to remove the debugger listener.

## Publish to the live Music ID1 widget

The live-accepted Music ID1 firmware must already be installed. Changes to the
host publisher, including reconnect cache invalidation, do **not** require a
firmware reflash.

The preferred end-user path is **Download Mac host companion** on any
Music-containing Web Flasher card. It downloads
`framer-f1-music-host-macos.zip`, which is standalone from this repository but
requires Node.js 22+ and the installed Work Louder Input app. Its launcher
starts Input with `--inspect=9230` when safe and keeps the publisher in its
Terminal window; leave that window open. The commands below are retained for
manual SDK development. From the workspace root:

```sh
open -n -a input --args --inspect=9230
npm --prefix f1-widget-sdk run media:live -- --confirm-live-rpc
```

Keep the publisher process running. Input alone does not publish to custom
Music ID1. The current runner supports exactly one USB/HID Framer F1 on firmware
0.4.1, so Bluetooth-only operation is not supported or proven and USB must stay
attached. With active supported media, successful startup logs `running` and
then `published`. `unchanged` with `heartbeat:true` is normal for an identical
snapshot.

If the F1 is unplugged while this process remains running, the failed delivery
invalidates the cached metadata and artwork. The first successful poll after a
wired reconnect sends both in full. Reconnecting alone cannot restore syncing
if the publisher has stopped; rerun the command.

Apple Music is selected when the actual Music app reports `playing`, regardless
of focus, and its artwork is resolved separately through the Apple catalog.
Chrome's explicit source path scans tabs for exactly one valid YouTube Music
`watch?v=` URL and uses bounded oEmbed metadata/art; generic Chrome playback is
only a MediaRemote fallback and is not guaranteed as a Chrome-specific source.

If the screen does not update, check in this order:

1. Input's inspector is listening on port 9230.
2. The continuous `media:live` terminal process is still running.
3. Exactly one firmware-0.4.1 F1 is connected over USB/HID.
4. Apple Music is playing, or exactly one valid YouTube Music watch tab is
   playing.
5. The log reaches `published`; `unchanged` plus a heartbeat is healthy, while
   `Expected exactly one USB Framer F1` identifies the wired-device gate.

See the authoritative [Media Transport SDK guide](../../docs/media-transport.md)
for the full contract and troubleshooting details.

The build command writes deterministic files under `generated/mock-transaction-0001/`:

- `preview-100x310.png` — visual proof only;
- `album-art.rgba8` — adapter-provided decoded art;
- `background-100x310.rgba8` — the album-color radial background;
- `frame-100x310.rgba8` — composited host preview;
- `manifest.json` — hashes, generation, progress, and explicit safety status.

The preview bundle status is `OFFLINE_MEDIA_BUNDLE_NOT_DEVICE_INSTALLABLE`.
Building that bundle has no hardware access or flashing path and does not itself
publish to the live widget.

The separate [`on-device/`](./on-device/) module is the development source for
screen ID1 in the accepted combined image with WPM Pet on ID7. It uses a
compiled mock track, zero music DROM bytes, controller-owned RGB565 album RAM,
and painted rounded LVGL gradient panels. The example module by itself still
produces an ABI artifact, never an app or flash command. See
[`docs/ON-DEVICE-CANDIDATE.md`](./docs/ON-DEVICE-CANDIDATE.md).

## What is proven

- A deterministic adapter can supply current title, artist, art, duration, and position.
- Input's existing macOS provider can supply Spotify, Apple Music, or MediaRemote metadata over its localhost debugger without loading the device SDK.
- Input artwork is bounded to 6 MiB compressed, decoded with the repository-pinned Jimp copy, and resized to an exact `80x80` RGBA8 buffer. Missing or bad art receives a deterministic fallback.
- Position is bounded to `[0, duration]`; progress is bounded to `[0, 1]` and also represented as integer permille.
- The album palette algorithm deterministically favors the most frequent chromatic 4-bit RGB bucket, falling back to all opaque pixels for neutral art.
- The generated gradient begins at the main album color and reaches `#040814` at every logical edge.
- The square `84x84` art rectangle is horizontally centered at logical x=50.
- A track/progress-bucket key prevents needless identical updates.
- The offline bundle is byte-deterministic and self-verifying.
- The proof-gated live runner publishes metadata, progress, and atomic five-chunk
  RGB565 artwork to the accepted Music ID1 app.
- A delivery failure invalidates the host's accepted device cache, and wired
  reconnect performs a full metadata/artwork resend while the runner remains
  active.

## What is not proven

- Bluetooth-only delivery, multiple simultaneously connected F1 devices, other
  device families, or Framer firmware other than 0.4.1.
- A generic media RPC for stock Framer firmware. Live publishing is limited to
  the exact SDK-pinned custom Music ID1 app and explicit proof ID.
- A Chrome-specific integration for arbitrary sites. The bounded explicit
  browser path is YouTube Music; other Chrome playback depends on MediaRemote.
- Persistence without a running Mac host publisher. The device does not fetch
  or resume media by itself after the process exits.

Read [`docs/HOST-TRANSPORT.md`](./docs/HOST-TRANSPORT.md) for the implemented host boundary, [`docs/INPUT-MEDIA-EVIDENCE.md`](./docs/INPUT-MEDIA-EVIDENCE.md) for the Input/Nomad evidence, and [`docs/SDK-GAPS.md`](./docs/SDK-GAPS.md) for the exact core changes required before this can become a guarded build profile.
