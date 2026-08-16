# Framer F1 research widget SDK

This is an unofficial, guarded development kit for the exact Framer F1
firmware 0.4.1 studied in this workspace. Version 0.3 adds the Stage-3E.3 I4
profile, cached composition, a single offline preflight command, and a separate
opt-in app-only device workflow.

It is not Work Louder's SDK and does not claim compatibility with other
firmware. The legacy project builder remains hardware-free. Device transport
is isolated in one fail-closed module and cannot accept the current Stage-3E.3
runtime NO-GO report.

## Current status: WPM ID7 and Music ID1 live accepted

The WPM pet is live-complete: its procedural night background, stars, styled
statistics, mood animation, six-species Fn-plus-bottom-encoder control, and
screen re-entry behavior are accepted. The active frame is expanded into a
controller-owned 96x78 I4 RAM buffer; the original in-page E3A cat remains the
safe fallback. The immutable source bank remains below the exclusive
`0x3c1d0000` runtime boundary.

Music ID1 is also live accepted on exact app SHA-256
`bfce3956d144ffd6747ebd85f22bbfdb806dbced64afa7e3fee9ec2053c8f682`
under proof ID `framer-f1-0.4.1-music-id1-bfce3956`. Physical tests confirmed
title, artist, timeline, radial artwork background, real album art, and track
changes across Apple Music and Chrome/YouTube Music. The host bridge follows
the player that is actually playing, not application focus or stale
MediaRemote state.

Earlier full-DROM and image-scale failures remain regression fixtures. They are
kept in the test suite because they pin the readable-page boundary and prevent
unsupported scaling/cache behavior from returning.

## Sub-second cached offline preflight

From the workspace root:

```sh
node f1-widget-sdk/bin/f1-widget.mjs stage3e3
```

That one command validates all 48 images, the I4 bank and hard boundary,
exact C1 and live/readback E3A bases, same-device rollback backup, pinned
toolchain and ABI, deterministic app composition, ESP checksum/digest,
`esptool image-info`, and output hashes. It writes the app plus a machine-
readable report under `f1-widget-sdk/build/stage3e3`.

Unchanged ABI/toolchain and app inputs use independent cache keys. On this Mac
the measured cold command is below one second and a cache hit is about 0.1-0.2
seconds. Asset changes recompose the app without re-running unchanged ABI
verification.

## Legacy v0.2 offline workflow

From the workspace root:

```sh
node f1-widget-sdk/bin/f1-widget.mjs init my-widget
node f1-widget-sdk/bin/f1-widget.mjs validate my-widget
node f1-widget-sdk/bin/f1-widget.mjs build my-widget
node f1-widget-sdk/bin/f1-widget.mjs inspect my-widget/build/my-widget-app.bin
```

`init` creates two logical 100x310 sky frames and a six-species by eight-state
placeholder roster. The physical/marketed display is separately documented as
310x100. Replace PNGs and edit `widget.json`; the fixed WPM roster profile keeps
the pet centered, WPM at TOP_MID `y=3`, and `Avg`/`Top` at BOTTOM_MID `y=-3`.

The maintained roster sample is [`examples/night-cat`](examples/night-cat).
The separate [`examples/music-player`](examples/music-player) proof demonstrates
a deterministic host adapter/preview/bundle. The reusable
[`src/media-transport`](src/media-transport) package now ports Input's real
macOS provider, exact one-second diffing, RGB565 encoding, 3,072-byte chunking,
capability negotiation, provider arbitration, and an atomic mock sink. Real
device publication is enabled only for the exact live-proven Framer handler ID;
unknown apps, firmware, proof IDs, or omitted opt-in flags still fail closed.

The hardware-free [`examples/jp-matrix`](examples/jp-matrix) and
[`input-lab`](input-lab) now exercise the reusable renderer SDK end to end.
Constrained semantic HTML/CSS compiles to a 1,048-byte F1SC scene with local
keyframes and a pinned F1GA Katakana atlas; arbitrary sandboxed browser output
can instead compile to bounded F1RA RGB565 animation. Three named semantic or
raster previews share one SHA-validated F1WB bundle. This is host/runtime proof,
not authorization to flash the still-gated renderer firmware. See
[`docs/css-renderer.md`](docs/css-renderer.md) for the exact format, budget, and
known/unknown boundaries.

[`examples/less-but-better`](examples/less-but-better) is the complementary
arbitrary-browser example: radial gradients, inline SVG turbulence, blend mode,
transform animation, and captured hover are compiled to bounded F1RA pixels.
Its build emits decoded PNG frames so the exact RGB565 payload can be inspected
without a keyboard.

## Commands

- `init <directory>` creates a complete project and refuses to overwrite it.
- `init-media <directory>` creates a focused media source/session project with
  a mock demo, tests, contract docs, and a default Input session whose Framer
  sink blocks before source or device I/O.
- `validate [directory]` validates target, layout, roster/state order, local
  paths, converter identity, images, dynamic DROM growth, and runtime evidence.
- `build [directory] [--out directory]` emits an offline app/merged image,
  DROM bank, IROM code, rendered sources, disassembly, and manifest.
- `inspect <image>` verifies an app or merged image's checksum, appended digest,
  segment layout, and factory-partition fit.
- `stage3e3 [--manifest file] [--out directory]` runs the complete cached E3.3
  validate/build/ABI/image-info/hash/rollback preflight.
- `combined [--out directory]` builds the corrected WPM ID7 and Music ID1 app
  under one setup wrapper, then verifies both registration ABIs, exact bases,
  recovery, toolchain, deterministic output, image-info, checksum, and hashes.
- `media status` reports the real host-source and blocked device-sink state.
- `media inspect [--port 9230]` reads current macOS media through Input's
  localhost debugger without loading the device SDK or opening hardware. A
  bounded provider timeout is reported as `no-active-media`; debugger/CDP
  failures remain errors.
- `media mock` exercises metadata, RGB565 artwork, handshake, five-chunk
  transfer, and atomic commit entirely in RAM.
- `deploy --app file --approval file [--rollback file] --confirm-app-only`
  runs fast smoke mode only for a separately promoted candidate approval.
  Add `--full-readback` for release mode.

The current E3.3 report is deliberately not a candidate approval and cannot be
deployed by the command.

## Device timing target

- Fast smoke: exact Input `knob_f1` discovery, bootloader entry, same-device
  MAC/chip/security/flash gate, app-only 921600-baud write with esptool's normal
  write-hash verification, watchdog boot, then read-only Input health. Expected
  approximately 1-3 minutes.
- Release: all smoke gates plus a complete 115200-baud app read-back and exact
  comparison before watchdog boot. Expected approximately 4-8 minutes.

Both modes refuse serial-port ambiguity, wrong firmware/MAC, missing recovery,
wrong security state, changed candidate/rollback hashes, or an approval mode
mismatch. They never write bootloader, partition table, NVS, filesystem, or
coredump and never use `erase-all`, `--force`, or encryption overrides. See
[`docs/fast-device-workflow.md`](docs/fast-device-workflow.md).

## Music Player combination status

The `stage3e3` command also caches and audits the existing 1,129-byte Music
Player registration ABI. Stock registry evidence shows ID8 is occupied; only
IDs 1 and 7 are unused. Music therefore stays on ID1 and WPM stays on ID7.

The real deterministic combined app now links Music registration followed by
`stage3e34_register_wpm(a2=registry, a3=navigation)` under exactly one stock
setup call. Both modules add navigation only after `controller+20 == registry`.
The combined code has zero final relocations, Music adds no DROM data, and ID8
is prohibited.

Build it without hardware access:

```sh
node f1-widget-sdk/bin/f1-widget.mjs combined
```

The live-accepted output is
`build/combined-music-string-tuple/framer-0.4.1-combined-music-id1-wpm-id7-app.bin`,
2,032,304 bytes, SHA-256
`bfce3956d144ffd6747ebd85f22bbfdb806dbced64afa7e3fee9ec2053c8f682`.
It was written app-only, booted healthy as `knob_f1` firmware 0.4.1, and is
pinned by receipt `device-1786888204784`. WPM ID7 and Music ID1 are both
physically accepted. Building alone still never authorizes a device write;
live RPC requires the matching proof ID and explicit `--confirm-live-rpc`.

## Documentation and tests

- [`docs/tutorial.md`](docs/tutorial.md): asset-to-offline-build workflow.
- [`docs/widget-spec.md`](docs/widget-spec.md): exact v0.2 declarative contract.
- [`docs/safety-model.md`](docs/safety-model.md): enforced image/ABI guards.
- [`docs/contracts.md`](docs/contracts.md): pinned reverse-engineered facts.
- [`docs/project-documentation.md`](docs/project-documentation.md): living-doc system.
- [`docs/media-transport.md`](docs/media-transport.md): reusable Input media
  source, typed protocol, 1 Hz diffing, chunking, sinks, and live proof.
- [`docs/provider-arbitration.md`](docs/provider-arbitration.md): Apple/Chrome
  ownership policy, source-of-truth matrix, transition handling, and runtime
  troubleshooting.
- [`docs/css-renderer.md`](docs/css-renderer.md): constrained CSS compiler,
  keyframe runtime, memory/CPU budgets, and the proposed Input authoring flow.

```sh
npm --prefix f1-widget-sdk test
```

The suite covers the legacy generator and the v0.3 compact-I4 pipeline, cache,
hard boundary, procedural-background contract, 0x200 scale, screen-local input,
corrected RAM expansion and re-entry behavior, real Music/WPM composition,
exact base/rollback gates, image integrity, and destructive-command rejection.
