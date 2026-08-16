# Music-player vertical slice

This isolated example proves the host-side shape of a Framer F1 music widget without pretending that stock firmware 0.4.1 exposes a media controller. It accepts title, artist, decoded RGBA album art, duration, and position through a small adapter contract. It then clamps progress, extracts a deterministic album color, renders an edge-normalized radial background over the exact logical `100x310` canvas, centers album art, and packages one offline asset transaction.

The hardware-free bridge now also reuses Input 0.18.2's real macOS media provider. It evaluates only through Input's proven localhost debugger, runs Input's hash-pinned `media-info-retriever.scpt`, bounds and decodes artwork to RGBA8, and feeds the same deterministic pipeline. Its terminal Framer sink is intentionally blocked before device discovery or I/O because the Framer firmware has no reviewed runtime media adapter.

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

The build command writes deterministic files under `generated/mock-transaction-0001/`:

- `preview-100x310.png` — visual proof only;
- `album-art.rgba8` — adapter-provided decoded art;
- `background-100x310.rgba8` — the album-color radial background;
- `frame-100x310.rgba8` — composited host preview;
- `manifest.json` — hashes, generation, progress, and explicit safety status.

The bundle status is `OFFLINE_MEDIA_BUNDLE_NOT_DEVICE_INSTALLABLE`. There is no hardware access, flashing path, device transport, or assertion of live compatibility here.

The separate [`on-device/`](./on-device/) module prepares screen ID1 for a future combined image with WPM Pet on ID7. It uses a compiled mock track, zero music DROM bytes, controller-owned RGB565 album RAM, and painted rounded LVGL gradient panels. It produces an ABI candidate only—never an app or flash command. See [`docs/ON-DEVICE-CANDIDATE.md`](./docs/ON-DEVICE-CANDIDATE.md).

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

## What is not proven

- A native Framer F1 media RPC/controller. Input's `mp.write_info`, `mp.write_artwork`, and `mp.fetch_data` path is explicitly Nomad-only, and no matching Framer handler is proven.
- A host-to-Framer transport suitable for periodic media asset updates. The current sink returns `BLOCKED_BEFORE_DEVICE_IO` and cannot be mistaken for delivery.
- Safe device-side storage, atomic generation switching, runtime pixel buffers, LVGL descriptor replacement, or UI-thread invalidation.
- Acceptable update latency, flash wear, RAM/PSRAM use, or playback-provider permissions.

Read [`docs/HOST-TRANSPORT.md`](./docs/HOST-TRANSPORT.md) for the implemented host boundary, [`docs/INPUT-MEDIA-EVIDENCE.md`](./docs/INPUT-MEDIA-EVIDENCE.md) for the Input/Nomad evidence, and [`docs/SDK-GAPS.md`](./docs/SDK-GAPS.md) for the exact core changes required before this can become a guarded build profile.
