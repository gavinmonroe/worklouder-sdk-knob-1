# Music ID1 media RPC

Status: the composite-art/radial-UI transport is LIVE-PROVEN and physically accepted on the Framer F1
with exact app `b9b8eec6250392f593ae664fa8b8cba64bf861f5ef49a427c65be79e6f355817`,
deployment receipt `device-1786895154649`, and post-write result `DEVICE_HEALTHY`. Correct title,
artist, album cover, radial background, and progress all passed on the screen. One
prior candidate failed during method registration because it passed an appended-IROM string to a
stock ROM copy helper. The next reached `mp.write_info`, but individually destroyed a temporary JSON
key proxy that Framer's request root owns, corrupting the root's lifetime chain. A later live
diagnostic proved proxy-to-string conversion rejects artwork as `e7`. Metadata retains Framer's
exact materialize/type-gate/fresh-proxy/string-conversion sequence. Artwork now mirrors Nomad's
actual direct request-root lookup and type mapping instead of using that metadata-only ABI. The reusable
host sink is enabled only for the exact immutable SDK proof ID and explicit live-RPC runner.

## Wire methods

- `mp.write_info` accepts Input-compatible keys `song_title`, `artist`, `elapsed`,
  `total_duration`, `is_playing`, and exact bounded `accent_color: "#RRGGBB"`. Partial metadata
  patches preserve omitted fields.
- `mp.write_artwork` accepts `{data, offset, size}`. `data` is strict base64; `offset` must
  equal the next staged byte; `size` must be exactly 12,800; and one decoded chunk is capped
  at 3,072 bytes / 4,096 base64 characters.
- Success uses Framer's stock-proven `{status:"ok"}` response object. The SDK transport
  normalizes that to `accepted:true`; any other status is rejected.

Input 0.18.2 still gates its native `mp.fetch_data` listener to Nomad devices. This firmware
does not pretend that branch exists for `knob_f1`. The reusable SDK source polls Input's packaged
macOS provider and publishes through these methods after a live proof is pinned.

## Task and memory ownership

The controller remains the live-tested 8,424-byte allocation. Offset `+56` points to one
controller-lifetime 87,980-byte transport state. Paired artwork descriptors live at `+64/+88`,
paired background descriptors at `+112/+136`, and `+60` is the borrowed background-image child:

| Offset | Bytes | Owner | Meaning |
| ---: | ---: | --- | --- |
| 0 | 64 | RPC writes, UI reads | bounded title |
| 64 | 64 | RPC writes, UI reads | bounded artist |
| 128..136 | 12 | RPC writes, UI snapshots | elapsed, duration, normalized playing |
| 140..144 | 8 | RPC/UI synchronization | odd/even producer seqlock and accepted UI generation |
| 148..183 | 36 | reserved | no shared formatted-text buffer; UI formats into its stack snapshot |
| 184..208 | 24 | split by generation | active/staging indices, unused +192 word, expected size, artwork generations |
| 208 | 12,800 | inactive RPC / active UI | RGB565 buffer 0 |
| 13,008 | 12,800 | inactive RPC / active UI | RGB565 buffer 1 |
| 25,808 | 152 | initialized once, read-only afterward | method, JSON-key, status, and accent-key string table |
| 25,960 | 8 | RPC writes, UI snapshots | exact bounded `#RRGGBB` accent |
| 25,972..25,979 | 8 | UI only | background descriptor index and applied accent |
| 25,980 | 62,000 | UI only | 100x310 RGB565 radial background and progress pixels |

Ordinary data reads from appended IROM are invalid on this firmware. The string table is initialized
once by loading 38 packed words with `l32r` and storing them in transport-state RAM. Method
registration, request lookup/conversion, and response construction receive only pointers within
`state+25,808..25,959`; no stock C/JSON helper receives a `0x421...` string pointer.

The RPC task never calls LVGL. Metadata uses a seqlock: the producer writes an odd generation before
mutating shared fields, fences, writes bounded strings and clamped numerics, fences again, and
publishes the next even generation. The UI rejects odd generations, copies both 64-byte strings and
all numerics into a private 224-byte stack frame, and verifies the generation a second time before
calling LVGL. This prevents a later 1 Hz RPC update from tearing text while LVGL copies it.

The request root has the same stack lifetime as Framer's stock bubble handler. Metadata and artwork
strings both use the proven direct lookup `0x42005560(root+56,key,keyLength,1,root)`, followed by
Framer's exact tuple converter `0x420046e0(node)`. That converter returns the payload pointer and
bounded length for node tags 2/4/5; the firmware copies metadata within fixed limits and decodes
artwork from that exact tuple. No request-owned child is individually destroyed. After the reply,
exactly one request-root destructor releases the complete chain.

Artwork is published only after an exact transaction completes. Buffer 0 always selects controller
descriptor `+64`; buffer 1 always selects descriptor `+88`. The UI calls `lv_image_set_src` with the
distinct completed descriptor and then records the UI generation. A new
artwork transaction is rejected while one complete generation is pending, so the UI can never swap
to a buffer being overwritten. The first UI tick after each screen build replays any nonzero accepted
metadata and artwork generation, even when the prior screen instance had already consumed it.
Each decoder result must equal `min(3072, 12800-offset)` exactly, and only wire offsets
`0, 3072, 6144, 9216, 12288` are accepted. Live testing proved transport-state `+192` does not persist
between RPCs, so it has no role in correctness. Input awaits every chunk response; each chunk writes
to `inactive_buffer+wire_offset`, and only `offset+decoded_length == 12800` publishes the generation.
Transaction size, decoded pixels, and final generation are fenced with `memw`.

For the current UI candidate, the accepted active 80x80 buffer is also copied directly into the
already-proven full-screen RGB565 buffer at `x=10,y=115`. Every full radial redraw re-blits the
active artwork before the paired background descriptor is presented. This bypasses the separate
album image's unresolved LVGL source/cache path without changing the live-proven RPC transaction.
The host retains the last complete snapshot across an eight-second provider gap, publishes only
`is_playing:false` once to freeze progress, and does not clear title, artist, or art until the grace expires.

The crash-causing rounded gradient and progress `lv_label` panels have no call sites. Runtime LVGL
ownership is one full-screen background image, one album image, and three ordinary text labels.
The background is a normalized, half-pixel-symmetric 100x310 ellipse centered with the album at
`(49.5,154.5)`, weighted by `max(0,1-q)^2`; every edge pixel is exact black. A real 80x5 progress
bar is drawn into owned background pixels at `x=10..89,y=272..276`. Title, artist, and elapsed/total
are centered at `y=82`, `204`, and `236`. Cleanup clears borrowed pointers and calls no free/delete path.

## Deterministic artifacts

- Source: `examples/music-player/on-device/music-player-id1.S`
- Standalone ABI: `examples/music-player/generated/on-device-candidate/music-id1-abi.bin`
  - 4,420 bytes
  - SHA-256 `443b7aaca676002fc7b6577a2cd8111460f7939e5efc7ce413a0f7f5276dbf1a`
  - ESP32-S3 `elf32-xtensa-le`, zero relocations
- Combined app: `build/combined-music-fast-gradient/framer-0.4.1-combined-music-id1-wpm-id7-app.bin`
  - 2,032,368 bytes
  - SHA-256 `b9b8eec6250392f593ae664fa8b8cba64bf861f5ef49a427c65be79e6f355817`
- Combined IROM: `build/combined-music-fast-gradient/combined-music-id1-wpm-id7-irom.bin`
  - 6,332 bytes
  - SHA-256 `0f979d32f1a9b1203287cb71518b66367c66a1fa9e51a2c5f06be71bd15a804b`
- Combined merged image: `build/combined-music-fast-gradient/framer-0.4.1-combined-music-id1-wpm-id7-merged.bin`
  - SHA-256 `dbc29e0d74b30c8244fbe5e04960781ed58945e23cea525de0d44428434ebf54`

The combined builder verifies the live-complete WPM linked literal and text slices byte-for-byte.
All modifications are after or inside Music ID1; WPM ID7 and its asset page are unchanged.

The corrected candidate was independently rebuilt and byte-compared. It is ESP32-S3 little-endian
with zero relocations, one DROM/one IROM, six segments, and the SDK test suite passing. The focused
IROM/RAM-string and proxy/root-lifetime audits pass. Factory-partition headroom remains over
6.35 MiB. The accepted image checksum is `0x5a` and image digest is
`be056aaecc4ffa27a8593f6c7489dec18efa91e71547c66f3713f9ba28c37c47`. This is an independent
static approval backed by a healthy live app-only deployment, accepted RPC transactions, and final
physical acceptance of the title, artist, real album cover, background, and progress rendering.

The prior boot-failure coredump is `/private/tmp/framer-music-media-boot-failure-coredump.bin`,
65,536 bytes, SHA-256 `9fcf88c73104cce444aa8dc46e189c172b2e59f3ffcdcbbf6c799fff1d5a115d`.
It recorded task `mp.write_inf`, PC `0x40056fac`, `LoadStoreError`, and source pointer
`0x42117b8c`. The WPM-safe app was restored and booted healthy before this correction was built.

The later metadata coredump is `/private/tmp/framer-music-metadata-rpc-crash-coredump.bin`,
65,536 bytes, SHA-256 `3a4aec5e30382646a8627d842d085eed5c48f35c84d6149fd351340b9a230afe`.
It recorded task `wl_rpc`, `LoadProhibited`, `EXCVADDR=1`, and failure in the JSON root/proxy
destructor chain. Root-only ownership, metadata acknowledgement, the five artwork chunks, and
healthy boot of the exact final app are now live-proven.

## Exact live proof

- SDK proof ID: `framer-f1-0.4.1-music-id1-b9b8eec6`
- Fast-smoke receipt: `build/device-receipts/device-1786895154649-fast-smoke.json`
- Receipt SHA-256: `95fbafe93ef45785e02e157f9047d9077bfee7030b4cb346ffa13da88a9550bf`
- Device result: `DEVICE_HEALTHY`
- One-shot: real metadata and complete artwork accepted, transaction prefix `6dc74f…`
- Physical display: correct cover/title/artist/background/progress accepted by the user
- Host arbitration: Apple catalog and active YouTube Music/oEmbed paths both verified with real `80x80` art
- WPM ID7: linked literal/text slices unchanged byte-for-byte

## Verification and live sequence

Run the hardware-free verification:

```sh
cd f1-widget-sdk
npm test
node bin/f1-widget.mjs combined --out build/combined-music-fast-gradient
```

The guarded deployment writes only the application at `0x10000`; it does not touch NVS,
LittleFS, partitions, erase-all, or `--force`. The live proof registry pins the final app and
deployment receipt. With Input running under `--inspect=9230`, start the 1 Hz bridge explicitly:

```sh
cd f1-widget-sdk
npm run media:live -- --confirm-live-rpc

# One deterministic metadata/artwork transaction.
npm run media:live -- --confirm-live-rpc --once
```

For end users, **Download Mac host companion** on any Music-containing Web
Flasher card is the preferred setup. It provides
`framer-f1-music-host-macos.zip`; the standalone ZIP requires Node.js 22+ and
the installed Work Louder Input app. Its launcher starts Input with
`--inspect=9230` when safe and keeps the publisher in its Terminal window.
These commands remain the manual developer path. Either way, keep the publisher
running and leave exactly one firmware-0.4.1 Framer F1 attached over USB/HID;
Bluetooth-only delivery is not supported. The complete runtime requirements,
reconnect behavior, and no-update checklist are in
[`media-transport.md`](media-transport.md).
