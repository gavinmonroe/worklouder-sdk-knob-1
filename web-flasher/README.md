# Framer F1 Web Flasher

A static React 19 + Vite catalog for the WPM Pet, Music, and Custom HTML/CSS
Preview widgets in this workspace. It runs entirely in desktop Chrome or Edge,
using WebHID for normal-mode identity and Web Serial for the ESP32-S3
bootloader when a live-approved image is selected.

WPM Pet and Music are live accepted. The Custom HTML/CSS entry reads its exact
size, hash, and deployable state from the generated renderer manifest. A
`DEVICE_SMOKE_CANDIDATE` is installable but clearly labeled because renderer
visuals, repeated scene uploads, and heap stability still need live acceptance.

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

## Flash workflow

1. Select one of the three catalog-pinned builds. WPM Pet contains WPM Pet;
   Music contains WPM Pet + Music; Custom HTML/CSS contains all three widgets.
   The frontend shows this cumulative contents list before any USB action. The
   evidence badge and any candidate warning describe its current approval level.
2. Connect the normal Framer F1 over WebHID. The app accepts Work Louder VID
   `0x303A`, Framer ANSI PID `0x8396`, or Framer ISO PID `0x8397`, the vendor
   usage page `0xFF00`, and exact firmware `0.4.1`.
3. The app loads the binary, verifies its size, catalog SHA-256, ESP checksum,
   appended digest, ESP32-S3 chip ID, and six-segment layout before sending the
   existing `sys.bootloader` RPC.
4. Select the newly enumerated Espressif serial port in Chrome. The flasher
   requires ESP32-S3, 16MB flash, disabled Secure Boot, and disabled Flash
   Encryption. When Chrome exposes the normal-mode HID serial, it must exactly
   match the ROM MAC. If Chrome omits that optional value, the app only
   continues after you confirm that one supported keyboard is connected; the
   ROM MAC is recorded and the matching layout must return unambiguously.
5. Exactly one app image is written at `0x10000` with `eraseAll: false`, flash
   parameters kept, and device-side MD5 verification. No bootloader, partition
   table, NVS, filesystem, or coredump region is written.
6. The keyboard is reset and must reappear over WebHID on firmware `0.4.1`
   before the UI reports success. A local JSON receipt can then be downloaded.

Quit Work Louder Input before connecting if Chrome cannot claim the HID
interface.

If the keyboard is already showing as a serial bootloader, use **Keyboard
already in bootloader?** in step one. It verifies the ESP32-S3, 16MB flash, and
security state, then resets into the existing app without writing any flash
region. A physical USB power-cycle provides the same immediate recovery when a
failure is known to have occurred before the app write began.

The Custom HTML/CSS build links to the hosted compiler at
<https://htmlcss-to-framerf1-widget.g-m.dev>.

On a shared host, serve `dist` over HTTPS and grant USB access again for that
site origin. Browser USB permissions are origin-specific. A missing HID serial
will now show the single-device confirmation instead of stopping during step
one; disconnect every other Framer F1 / Knob F1 before confirming it.

## Tests

```sh
npm --prefix web-flasher test
```

The tests re-read all three source binaries and pin their exact hashes and ESP
image structure, including the gated preview candidate, plus the device
identity refusal paths.
