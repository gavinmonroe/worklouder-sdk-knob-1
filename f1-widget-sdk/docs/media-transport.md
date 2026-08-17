# Media Transport SDK

The Media Transport SDK ports Input's reusable host-side music pipeline into a fail-closed package. It can obtain real macOS media, normalize and diff it at one-second resolution, encode bounded RGB565 artwork, produce exact 3,072-byte chunks, negotiate a runtime contract, and publish through the live-proven Music ID1 handlers only when the operator supplies the explicit live-RPC flag.

Provider ownership, Chrome/Apple precedence, transition handling, and a symptom-driven checklist are maintained separately in
[`provider-arbitration.md`](provider-arbitration.md).

## Status

| Layer | Status | Evidence |
| --- | --- | --- |
| Input localhost media source | Ready | Hash-pinned Input 0.18.2 AppleScript; Spotify, Apple Music, MediaRemote |
| Metadata schema/diff | Ready | Exact Nomad-shaped payload; integer-second diff tests |
| Artwork encoding | Ready | RGBA8 -> RGB565-LE; deterministic size/hash tests |
| Chunk transport contract | Ready | 3,072 raw bytes / at most 4,096 base64 characters |
| Capability handshake | Ready | Framer-specific, versioned, atomic/UI-thread requirements |
| Mock runtime | Ready | Ordered chunk, per-chunk hash, complete commit verification |
| Framer runtime sink | Ready, explicit opt-in | App `b9b8eec6…`, receipt `device-1786895154649`, `DEVICE_HEALTHY`; metadata, album art, progress, and track changes physically accepted |

## CLI

From the workspace root:

```sh
# No Input session or device access; prints the fail-closed status.
node f1-widget-sdk/bin/f1-widget.mjs media status

# Exercises the complete protocol against bounded RAM-only mocks.
node f1-widget-sdk/bin/f1-widget.mjs media mock

# Generates a focused media-widget project, tests, and contract docs.
node f1-widget-sdk/bin/f1-widget.mjs init-media my-media-widget
npm --prefix my-media-widget test
npm --prefix my-media-widget run demo

# Reads current host media through Input's localhost debugger only.
open -n -a input --args --inspect=9230
node f1-widget-sdk/bin/f1-widget.mjs media inspect

# After confirming the live-accepted Music ID1 app is installed, run the 1 Hz bridge.
npm --prefix f1-widget-sdk run media:live -- --confirm-live-rpc

# One deterministic poll, useful for acceptance.
npm --prefix f1-widget-sdk run media:live -- --confirm-live-rpc --once
```

`media inspect` does not load `wl-device-kit`, discover a keyboard, or call RPC.
When Input's packaged provider produces no media before its eight-second bound,
the command reports `no-active-media` with `reason: "provider-timeout"` instead
of treating an idle provider as a transport failure. CDP connection, debugger,
script-hash, and non-timeout provider failures remain errors. Quit and reopen
Input normally when finished to remove the debugger listener.

`media:live` is intentionally different: it discovers exactly one USB `KnobF1`, requires firmware
`0.4.1`, opens one bounded `evaluateInInput` transaction per WLRPC call, and disconnects in `finally`.
It refuses to start without `--confirm-live-rpc`. Press Ctrl-C to stop the 1 Hz session. The equivalent
command from `f1-widget-sdk/` is `npm run media:live -- --confirm-live-rpc`.

## Live runtime requirements

The live-accepted Music ID1 firmware must already be installed. The reconnect
handling in this host SDK does **not** change device firmware and does not
require reflashing an F1 that already has Music ID1.

The preferred end-user path is **Download Mac host companion** on any
Music-containing Web Flasher card. It provides
`framer-f1-music-host-macos.zip`, which is standalone from this repository but
requires Node.js 22+ and the installed Work Louder Input app. Its launcher
starts Input with `--inspect=9230` when safe and keeps the publisher in its
Terminal window; leave that window open. The commands here remain the manual
developer setup and the authoritative runtime/troubleshooting reference.

Launch Input with its localhost inspector before starting the publisher:

```sh
open -n -a input --args --inspect=9230
```

Input provides the inspected media/device services, but Input by itself does
not publish media to the custom Music ID1 screen. Keep
`npm --prefix f1-widget-sdk run media:live -- --confirm-live-rpc` running for
the entire syncing session. With supported media active, successful startup
prints a `running` result followed by `published`. `unchanged` with
`heartbeat:true` is normal when the media snapshot has not changed; it means
the publisher still reached the device.

The current live publisher explicitly supports exactly one USB/HID Framer F1
on firmware 0.4.1. Bluetooth-only delivery is not supported or proven. Even if
the F1 is paired over Bluetooth, its USB connection must remain attached for
this publisher.

If USB is unplugged while the publisher stays running, the next failed
heartbeat/write invalidates its device-side delivery assumptions. After wired
reconnect, the first successful poll resends complete metadata and all artwork
chunks. If the publisher was stopped or its terminal was closed, reconnecting
the keyboard alone cannot resume delivery; restart the publisher command.

## No-update checklist

1. Confirm Input was launched with `--inspect=9230` and its inspector is still
   listening. `node f1-widget-sdk/bin/f1-widget.mjs media inspect` should return
   a snapshot or the explicit `no-active-media` result rather than a debugger
   connection error.
2. Confirm the continuous `media:live` process is still running. Input alone is
   not the Music ID1 publisher.
3. Leave exactly one Framer F1 connected by USB/HID and confirm it reports
   firmware 0.4.1. Disconnect extra F1 devices; Bluetooth alone is insufficient.
4. Start playback in a supported source. App focus is irrelevant: Apple Music
   must report `playing`; Chrome's explicit path requires exactly one valid
   `music.youtube.com/watch?v=...` tab. Other Chrome audio is only available
   through generic MediaRemote and is not a browser-specific guarantee.
5. Read the publisher log. A healthy active session begins with `running` then
   `published`; `unchanged` plus `heartbeat:true` is healthy. Repeated
   `Expected exactly one USB Framer F1` errors mean the wired-device gate is not
   satisfied. After correcting it, leave the same process running for the full
   metadata/artwork resend, or restart it if it already exited.

`init-media` creates `media-project.json`, a mock source, mock and default-blocked Input sessions, a runnable demo, regression tests, and per-project contract/testing docs. It refuses to overwrite an existing path. This keeps custom-widget work focused on the source and presentation contract while the SDK owns protocol bounds and the live-proof gate.

## Package API

```js
import {
  BlockedMediaRuntimeSink,
  FramerMediaRuntimeSink,
  InputLocalhostMediaSource,
  InputWlrpcMediaTransport,
  MediaTransportSession,
  MockMediaRuntimeSink,
} from "framer-f1-research-widget-sdk/media-transport";

const source = new InputLocalhostMediaSource();

// Current production-safe behavior: handshake blocks before source/device I/O.
const blocked = new MediaTransportSession({
  source,
  sink: new BlockedMediaRuntimeSink(),
});
await blocked.pollOnce();

// Live-proven app only; still requires the caller to make this explicit choice.
const live = new MediaTransportSession({
  source,
  sink: new FramerMediaRuntimeSink({
    proofId: "framer-f1-0.4.1-music-id1-b9b8eec6",
    transport: new InputWlrpcMediaTransport(),
  }),
  pollIntervalMs: 1000,
});

// Offline development/evaluation only.
const mock = new MockMediaRuntimeSink();
const simulated = new MediaTransportSession({
  source,
  sink: mock,
  allowMockRuntime: true,
  pollIntervalMs: 1000,
});
```

`MediaTransportSession.start()` uses completion-relative timeouts, so a slow poll cannot overlap the next one. Poll intervals below 1,000 ms are rejected. `pollOnce()` is easier for deterministic tests.

## Input source

`InputLocalhostMediaSource` evaluates one constant expression through the existing localhost CDP bridge. `InputLocalhostMediaAdapter` remains a compatibility alias for the original example. Inside Input it:

1. SHA-256 verifies `/Applications/input.app/Contents/Resources/scripts/media-info-retriever.scpt` as `1d3262dff8bdf70b1b3140ab7ac556f622783d21d1c05ba0bb4ec6302f555090`.
2. Executes it with `/usr/bin/osascript`, an 8-second timeout, and an 8 MiB stdout cap.
3. Parses known record keys without breaking commas/colons inside titles.
4. Caps compressed artwork at 6 MiB and requires HTTPS for Spotify artwork.
5. For `media_remote`, first probes the absolute `/System/Applications/Music.app` through bounded JXA.
   When Music reports `playing`, its title, artist, duration, and position take precedence over stale
   MediaRemote/Chrome data; exact Apple catalog artwork is then resolved without using Music's failing art API.
6. Otherwise, reads only Chrome's tab URL/title through bounded JXA. If an active
   YouTube Music `watch?v=` tab is present, it requires exactly one valid tab and obtains bounded
   title/author/thumbnail data from YouTube oEmbed. Multiple matching tabs fail closed as ambiguous;
   a watch-page/MediaRemote duration mismatch becomes transient inactivity so the grace window retains
   the prior good track. It never executes page JavaScript or applies this override to direct Spotify/Apple providers.
7. If MediaRemote is not verified as YouTube Music, queries Apple's public song catalog for an exact
   normalized title+artist pair and upgrades the selected HTTPS cover to `600x600bb` before processing.
8. Decodes and center-crops with Input's repository-pinned Jimp copy to exact `80x80` RGBA8.
9. Uses a deterministic generated fallback only when all bounded real-art sources are unavailable or invalid.

It never loads the device SDK.

## Capability handshake

The host sends `framer-host-media-v1` `host-hello` with screen ID1, `rgb565-le`, and a 3,072-byte raw chunk requirement. A ready sink must respond with:

- `deviceFamily: "knob_f1"`;
- `runtimeProof: "live-proven"` (or `"mock"` only when the caller explicitly allows mocks);
- metadata and artwork support;
- exact text/dimension/byte budgets;
- `atomicArtworkCommit: true`;
- `uiThreadApply: true`;
- `chunkRawBytes: 3072`;
- `rgb565-le` support.

Production policy rejects mock or unproven runtime claims. `BlockedMediaRuntimeSink` reports `NO_LIVE_PROVEN_FRAMER_MEDIA_HANDLER` and implements no device I/O.

`FramerMediaRuntimeSink` accepts one immutable SDK proof ID:
`framer-f1-0.4.1-music-id1-b9b8eec6`. The proof pins app SHA-256
`b9b8eec6250392f593ae664fa8b8cba64bf861f5ef49a427c65be79e6f355817`, code SHA-256
`0f979d32f1a9b1203287cb71518b66367c66a1fa9e51a2c5f06be71bd15a804b`, and deployment
receipt `device-1786895154649`. Unknown or omitted IDs still block before negotiation or RPC.

## Metadata contract

The typed envelope is `media-metadata`, with monotonic generation, screen ID1, and SHA-256. Its payload intentionally mirrors Input's known client API:

```js
{
  song_title: "Midnight Circuit",
  artist: "Static Bloom",
  elapsed: 102,
  total_duration: 240,
  is_playing: true,
  accent_color: "#16334C"
}
```

Text is trimmed to the negotiated UTF-8 byte limit. Duration and elapsed are non-negative integer seconds. Position is clamped to duration. `accent_color` is an exact bounded `#RRGGBB` string. A transient provider disappearance retains the last complete title, artist, artwork, and frozen position for an eight-second handoff grace. The session publishes `is_playing:false` once during that grace and clears the snapshot only if the provider remains inactive after the deadline. Paused but active media likewise remains visible with `is_playing:false`.

The first accepted transport generation carries all six fields. Later transport generations carry
only fields changed since the last accepted generation; for ordinary playback, the one-second update
is `{ elapsed: nextSecond }`. The Framer runtime sink merges that diff over its last accepted state and
always sends a complete six-field `mp.write_info` snapshot. Its cache advances only after `{status:"ok"}`;
a rejection leaves the prior baseline intact. A stopped payload sends the full empty/zero/false/black
snapshot and clears the cache only after acceptance.

When a live snapshot is otherwise unchanged, the sink repeats the accepted metadata as a one-second
device heartbeat. A missing or rejected device invalidates both transport hashes without advancing the
generation. Polling continues, and the first successful poll after reconnect sends the complete metadata
and all artwork chunks again so a power-cycled widget never inherits the host's pre-unplug cache.

## Artwork contract

RGBA8 is nearest-neighbor resized to the runtime dimensions and alpha-composited over black while encoding RGB565 little-endian. For `80x80`, the result is exactly 12,800 bytes and five chunks:

| Chunk | Offset | Raw bytes | Maximum base64 characters |
| --- | ---: | ---: | ---: |
| 0 | 0 | 3,072 | 4,096 |
| 1 | 3,072 | 3,072 | 4,096 |
| 2 | 6,144 | 3,072 | 4,096 |
| 3 | 9,216 | 3,072 | 4,096 |
| 4 | 12,288 | 512 | 684 |

The transaction has `artwork-begin`, ordered `artwork-chunk` messages, and `artwork-commit`. Every chunk has an offset, total size, raw byte count, and SHA-256. The manifest/commit carry total bytes, total chunks, pixel hash, dimensions, format, generation, and deterministic transaction ID. The sink must stage inactive data and publish only after complete verification.

Framer RPC acknowledgments use the stock-proven response object
`{status:"ok"}`. The SDK normalizes that to transport acceptance;
`{accepted:true}` remains supported for injected mocks and older test adapters.

Artwork is sent only when its encoded pixel hash changes. One-second progress changes send metadata only.

## Live deployment evidence

The exact `b9b8eec6…` application was written app-only and booted as `DEVICE_HEALTHY` under receipt
`build/device-receipts/device-1786895154649-fast-smoke.json` (receipt SHA-256
`95fbafe93ef45785e02e157f9047d9077bfee7030b4cb346ffa13da88a9550bf`). One-shot delivery accepted
real metadata and a complete five-chunk artwork transaction with transaction prefix `6dc74f…`.

Physical acceptance is complete: the user confirmed the correct album cover, title, artist, radial
background, and progress display. The host fixes were also verified against both provider failure modes:

- Apple/MediaRemote: `From the Dining Table` by Harry Styles resolved through `apple-catalog-artwork`
  to exact `80x80` RGBA8 SHA-256 `2934db072f612114e5ac2493f4d42bf4c23696e217cefcd5f17b09d4d08faa5e`.
- Apple Music app switch: despite Input falling through as `media_remote`, the absolute Music.app probe
  selected `The Heart of Life` by John Mayer, preserved live duration/position, and resolved Apple catalog
  art to exact `80x80` RGBA8 SHA-256 `35956b8c502dd22e05d6b4833557e18c6f51b2306388bd42212e130cbaf74c46`.
- Chrome/MediaRemote mismatch: queued Pokémon metadata was replaced by the live YouTube Music tab.
  Inspection resolved `Stardew Valley OST - Grandpa's Theme` by Lewie G with `isPlaying:true`; its
  oEmbed thumbnail processed to exact
  `80x80` RGBA8 SHA-256 `474acf621f4519c6b285ec934470199bb540ac8b6d6469a19935cf7458cb1ef5`.

This proves boot health, host arbitration, metadata RPC, real artwork transport, transaction commit,
track transitions, and physical rendering for proof ID `framer-f1-0.4.1-music-id1-b9b8eec6`.
The linked WPM ID7 literal/text slices remain unchanged byte-for-byte.

## Why existing shortcuts are not the product transport

`fs.writebin` is available on the F1 and already uses 3,072-byte raw chunks for wallpaper. It is not a safe Music shortcut:

- stock `/fs/wallpaper_bg.bin` is loaded through Work Louder's custom wallpaper path;
- direct arbitrary `/fs` paths passed to `lv_image_set_src` are not a reviewed Framer ABI;
- Music ID1 has no file generation/reload notification;
- Input's wallpaper update deletes the prior file before writing/verifying the next one;
- changing art per track introduces flash wear and can disturb the user's wallpaper.

`v.framer.bubble` can show a temporary two-line, 1 Hz metadata demo, but it is a visible global overlay with a ten-second expiry. Hidden mode is not a safe shared-memory contract, and the overlay can contend with WPM. Neither shortcut solves atomic RAM artwork or Music-label ownership.

The live runner uses controller-owned inactive artwork staging and LVGL UI-thread generation apply;
it does not write LittleFS or firmware and sends artwork only when the RGB565 hash changes or a device
disconnect invalidates the last accepted delivery.

## Tests

```sh
node --test f1-widget-sdk/test/media-transport.test.mjs
npm --prefix f1-widget-sdk test
```

The focused tests cover handshake rejection, exact fields, UTF-8/dimension bounds, RGB565 byte order,
five-chunk geometry, one-second diffing, full accepted-state snapshot merging, unplug/reconnect re-sync,
artwork retry cleanup,
active-Music precedence, active-Chrome arbitration, bounded YouTube oEmbed, transition duration guarding,
exact Apple catalog matching, unknown-proof blocking,
safe base64 RPC construction, one-evaluation-per-RPC behavior, explicit runner confirmation, and scaffolding.
