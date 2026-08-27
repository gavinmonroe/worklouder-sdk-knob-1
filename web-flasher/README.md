# Framer F1 Web Flasher

A static React 19 + Vite catalog for the widget builds in this workspace. It
runs entirely in desktop Chrome or Edge, using WebHID for normal-mode identity
and Web Serial for the ESP32-S3 bootloader when a live-approved image is
selected.

Every card pins the exact bytes and SHA-256 of what it writes. Cards whose
binaries come from a generated manifest read their size, hash, and deployable
state from that manifest. A `DEVICE_SMOKE_CANDIDATE` is installable but clearly
labeled because renderer visuals, repeated scene uploads, and heap stability
still need live acceptance.

## Catalog

| Card | Contents | Evidence | Writes | After boot |
| --- | --- | --- | --- | --- |
| WPM Pet | WPM Pet | Live accepted | app `0x10000` | — |
| Music | WPM Pet + Music | Live accepted | app `0x10000` | Mac host companion |
| Custom HTML / CSS Preview | WPM Pet + Music + renderer ID 26 | Smoke candidate | app `0x10000` | Input Lab pushes |
| Clock + Timer (render v2) | WPM Pet + Music + clock ID 26 + timer ID 27 | Live accepted | app `0x10000` | **Enable clock & timer** (RAM only) |
| Weather (MicroQuickJS canary) | WPM Pet + Music + clock + timer + weather ID 28 | Live tested canary | pages `0x240000`, `0x210000`, `0x230000`, then app `0x10000` | Weather host companion, **Push clock & timer again** (fallback; firmware persists it) |
| Widget Designer (multi-widget) | WPM Pet + Music + clock + timer + widget screens 28-31 | Live tested 2026-08-27 | pages `0x240000`, `0x210000`, `0x230000`, then app `0x10000` | Build and push widgets from the [Widget Designer](./widget-designer/); each stored widget gets its own keyboard screen |
| Input Lab custom widgets (render v2 generic) | WPM Pet + Music + generic renderer ID 26 | Smoke candidate | app `0x10000` | Input Lab pushes |

Choose **Input Lab custom widgets** to push your own compiled scenes from
<https://htmlcss-to-framerf1-widget.g-m.dev>; the clock, timer, and weather
widgets are not in that image. Choose **Weather** for the built-in set.

## Clock and timer

The orange focus clock and dark sky-blue timer come from a RAM-only render-v2
scene package. The **Clock + Timer** card's image has no on-flash copy of it,
so its **Enable clock & timer** button pushes the frozen 95,535-byte
generation-2 package (`focus-clock-timer.generation-2.package.bin`, SHA-256
`5b1b9a06…6965753ac7`) over the normal-mode vendor HID RPC channel — no
bootloader, no flash write — and it must be repeated after every power cycle.

The **Weather** card's firmware (release `2026-08-18-id28-persist-btp1`) is
different: it persists whatever clock+timer package was last pushed to flash
slot B (`0x240000`, written as a fourth flash region alongside the app) and
re-adopts it at every boot (boot-adopt + persist-on-push), live-verified on
2026-08-18. Clock and timer therefore survive reboots and crashes with no host
needed. The Weather card still exposes **Push clock & timer again (normally
not needed — firmware restores it at boot)** as a manual fallback for the same
underlying package, in case the keyboard is ever missing the content. The push
itself (`scene-push.js`) is status-derived and idempotent: it probes the
device's committed generation first and no-ops when it already matches, so
pressing it when the firmware has already restored the content is safe.

The push is `widget.scene.begin` with `expectedGeneration` 1 (or the device's
probed generation, for a re-push), then 32 `widget.scene.write` chunks of
3,072 raw bytes each, then `widget.scene.commit`. Any failure after a
successful begin sends `widget.scene.abort`; an indeterminate commit reply
deliberately does not, and asks for a power cycle instead. Success reports
`FOCUS_TIMER_PACKAGE_COMMIT_ACKNOWLEDGED`, or
`FOCUS_TIMER_PACKAGE_ALREADY_ENABLED` when the probe already found a matching
generation. The payload shapes are identical to
[`focus-timer-package.mjs`](../f1-widget-sdk/examples/render-v2-focus-timer/focus-timer-package.mjs),
and the transport is a browser port of Input Lab's
[`browser-scene-hid.mjs`](../f1-widget-sdk/input-lab/lib/browser-scene-hid.mjs).

If begin is refused, the package is already enabled this boot or a stale
transaction is still open; power-cycle the keyboard and retry. Keep the
keyboard on screen ID 26 so its UI tick can release the previous widget.

## Weather is a four-region write

The Weather card is the only entry that declares `regions`. It writes the
persisted clock+timer scene slot first, then the two MicroQuickJS module
pages, then the app image last:

| Order | Region | Address | Bytes |
| ---: | --- | --- | ---: |
| 1 | `scene-slot-b.bin` | `0x240000` | 95,599 |
| 2 | `mqjs-id28-text-page.bin` | `0x210000` | 131,072 |
| 3 | `mqjs-id28-rodata-page.bin` | `0x230000` | 65,536 |
| 4 | `framer-0.4.1-mqjs-id28-weather-zip-persist-btp1-app.bin` | `0x10000` | 2,062,912 |

All four addresses are inside the existing `factory` partition
(`0x10000`–`0x810000`), and the flasher refuses any address outside that exact
four-entry allowlist. Every region's size and SHA-256 is verified before the
first byte is written; a single mismatch rejects the whole plan. `scene-slot-b.bin`
is 95,599 bytes — not a multiple of the 4 KiB flash sector size — and is
written unpadded: the flasher's region validation has no alignment
requirement on region byte counts, and `esptool-js`'s `writeFlash` already
rounds erase/write block counts up to `FLASH_WRITE_SIZE` and only pads the
final transfer block to 0xFF, so no sector padding was needed for this region.
The regions go out as one `esptool-js` `writeFlash` call whose `fileArray`
preserves that order, with `eraseAll: false`, flash parameters kept, and
per-region device-side MD5 verification.

This is a diag-track build (PSRAM VM heap, ZIP settings assets, telemetry
pages, and a 5-byte Bluetooth reconnect diagnostic patch — `release_adv_hold`,
"P1"). It was live-tested on one unit on 2026-08-18, including a push →
firmware-persist → reset → boot-adopt cycle at generation 3, and did **not**
go through the audited release pipeline. The BT P1 patch does not fix the
Mac reconnect issue yet; that remains under investigation. Offsets, byte
counts, and hashes come from
[`release-closure.json`](../experiments/mquickjs-esp32s3-physical-canary/releases/2026-08-18-id28-persist-btp1/release-closure.json).

## Run locally

```sh
npm --prefix web-flasher install
npm --prefix web-flasher run dev
```

Open the localhost URL printed by Vite. WebHID and Web Serial require a secure
context; `localhost` is accepted. A production build is also static:

```sh
npm --prefix web-flasher run build
npm --prefix web-flasher run preview
```

The build output is `web-flasher/dist`. Its relative asset paths allow that
directory to be hosted below any HTTPS path, but it should not be opened as a
plain `file://` page.

## Music host companion

The preferred end-user Music setup is to select any card that includes Music,
install its firmware, and choose **Download Mac host companion**. The download
is `framer-f1-music-host-macos.zip`, a self-contained companion that runs
without a repository checkout. It still requires Node.js 22+ and the installed
Work Louder Input app. Its launcher starts Input with `--inspect=9230` when safe
and keeps the publisher in its Terminal window; leave that window open whenever
the Music widget should sync.

The companion does not add Bluetooth transport: the current live runtime still
requires exactly one USB/HID Framer F1 on firmware 0.4.1. The equivalent manual
developer workflow remains in
[`f1-widget-sdk/docs/media-transport.md`](../f1-widget-sdk/docs/media-transport.md).

## Weather host companion

The Weather card links `framer-f1-weather-host-macos.zip`, built by the
weather canary's own packager into `public/downloads/`. It has the same
requirements as the Music companion — macOS, Node.js 22+, and the installed
Work Louder Input app — and it is what supplies live weather to the keyboard
and receives the ZIP code you edit with the knob. Music sync is included, so
the two companions do not need to run together. The UI only links the archive;
nothing imports it, so the site still builds before that file exists.

## Flash workflow

1. Select one of the catalog-pinned builds. The frontend shows the cumulative
   contents list, the exact write scope, and any RAM-only follow-up before any
   USB action. The evidence badge and any candidate warning describe its
   current approval level.
2. Connect the normal Framer F1 over WebHID. The app accepts Work Louder VID
   `0x303A`, Framer ANSI PID `0x8396`, or Framer ISO PID `0x8397`, the vendor
   usage page `0xFF00`, and exact firmware `0.4.1`.
3. The app loads every binary the card declares and verifies each one's size and
   catalog SHA-256 before sending the existing `sys.bootloader` RPC. App images
   are additionally checked for ESP checksum, appended digest, ESP32-S3 chip ID,
   and the reviewed six-segment layout. Module pages are opaque data and are
   only size- and hash-checked.
4. Select the newly enumerated Espressif serial port in Chrome. The flasher
   requires ESP32-S3, 16MB flash, disabled Secure Boot, and disabled Flash
   Encryption. When Chrome exposes the normal-mode HID serial, it must exactly
   match the ROM MAC. If Chrome omits that optional value, the app only
   continues after you confirm that one supported keyboard is connected; the
   ROM MAC is recorded and the matching layout must return unambiguously.
5. Exactly one app image is written at `0x10000` with `eraseAll: false`, flash
   parameters kept, and device-side MD5 verification. Cards that declare
   `regions` additionally write their module pages, always before the app and
   always inside the `0x210000` / `0x230000` / `0x240000` allowlist. No
   bootloader, partition table, NVS, filesystem, or coredump region is ever
   written.
6. The keyboard is reset and must reappear over WebHID on firmware `0.4.1`
   before the UI reports success. A local JSON receipt can then be downloaded;
   it records every written region with its address, kind, size, and hash.
7. The **Clock + Timer** card still needs **Enable clock & timer** once the
   keyboard is back in normal mode, and again after every power cycle. The
   **Weather** card's firmware restores clock and timer on its own at boot;
   its **Push clock & timer again** button is only a manual fallback.

Quit Work Louder Input before connecting if Chrome cannot claim the HID
interface.

If the keyboard is already showing as a serial bootloader, use **Keyboard
already in bootloader?** in step one. It verifies the ESP32-S3, 16MB flash, and
security state, then resets into the existing app without writing any flash
region. A physical USB power-cycle provides the same immediate recovery when a
failure is known to have occurred before the app write began.

The Custom HTML/CSS and Input Lab custom widget builds link to the hosted
compiler at <https://htmlcss-to-framerf1-widget.g-m.dev>.

On a shared host, serve `dist` over HTTPS and grant USB access again for that
site origin. Browser USB permissions are origin-specific. A missing HID serial
will now show the single-device confirmation instead of stopping during step
one; disconnect every other Framer F1 / Knob F1 before confirming it.

## Tests

```sh
npm --prefix web-flasher test
```

The tests re-read every source binary and pin its exact hash and ESP image
structure, including the gated preview candidates and the pinned scene package.
They also cover the device identity refusal paths, multi-region plan validation
(address allowlist, one app written last, no overlaps, rejection when any region
hash mismatches, acceptance of the non-4KiB-aligned `scene-slot-b.bin` page
length), the write-scope guard the flasher applies immediately before writing,
the 32 × 3,072-byte scene chunking and begin/write/commit/abort payload shapes
against a fake HID transport, and a server-rendered pass over the catalog page.
