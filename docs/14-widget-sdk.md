# Unofficial Framer F1 widget SDK

## Outcome

[`f1-widget-sdk`](../f1-widget-sdk/README.md) packages the repeatable parts of
the Stage-3E research into a hardware-free development workflow for custom
Framer F1 widgets. It is an original interoperability tool, not Work Louder's
SDK, and it is intentionally pinned to the exact 0.4.1 firmware base studied in
this workspace.

The CLI supports four commands:

```sh
node f1-widget-sdk/bin/f1-widget.mjs init my-widget
node f1-widget-sdk/bin/f1-widget.mjs validate my-widget
node f1-widget-sdk/bin/f1-widget.mjs build my-widget
node f1-widget-sdk/bin/f1-widget.mjs inspect my-widget/build/my-widget-app.bin
```

- `init` scaffolds a documented widget project with source assets, a
  declarative spec, controller/linker templates, and living test/decision docs.
- `validate` checks target/version, schema, confined paths, dimensions, state
  mapping, the pinned local converter, and the 64-KiB asset-page budget.
- `build` performs deterministic PNG-to-LVGL conversion, native descriptor
  construction, ESP32-S3 little-endian assembly, DROM/IROM composition,
  mutation checks, checksum/digest repair, and manifest generation.
- `inspect` verifies an app or merged image's integrity, segment layout, and
  factory-partition fit.

There is deliberately no device discovery, serial transport, or `flash`
command. SDK output is labeled `OFFLINE_CANDIDATE_NOT_HARDWARE_APPROVED` and
must still pass independent firmware review and the recovery-gated app-only
workflow before hardware use.

## Media Transport SDK

The reusable [`f1-widget-sdk/src/media-transport`](../f1-widget-sdk/src/media-transport)
package ports Input's exact macOS music-provider workflow without enabling
device publication. It provides a hash-pinned localhost Input source, typed
metadata and RGB565 artwork messages, one-second diffing, exact 3,072-byte raw
chunks, capability negotiation, a verifying mock runtime, and a production
sink that blocks before device I/O until Framer handlers are live-proven.

```sh
node f1-widget-sdk/bin/f1-widget.mjs init-media my-media-widget
node f1-widget-sdk/bin/f1-widget.mjs media status
node f1-widget-sdk/bin/f1-widget.mjs media mock
open -n -a input --args --inspect=9230
node f1-widget-sdk/bin/f1-widget.mjs media inspect
```

The existing Input/Nomad `mp.write_info`, `mp.write_artwork`, and
`mp.fetch_data` methods are not assumed to work on Framer. See the
[Media Transport SDK contract](../f1-widget-sdk/docs/media-transport.md) for
the handshake, typed messages, exact chunk layout, and rejected
bubble/filesystem shortcuts.

## Fastest authoring loop

Start from the maintained
[`night-cat` sample](../f1-widget-sdk/examples/night-cat/README.md) or generate
a new project. For ordinary visual changes, edit `widget.json`, replace PNG
frames, and run `validate` then `build`. Editing the assembly template is ABI
work and needs a recorded decision plus new regression coverage.

Detailed references:

- [custom-widget tutorial](../f1-widget-sdk/docs/tutorial.md);
- [widget specification](../f1-widget-sdk/docs/widget-spec.md);
- [safety model](../f1-widget-sdk/docs/safety-model.md);
- [reverse-engineered contracts](../f1-widget-sdk/docs/contracts.md); and
- [per-widget documentation system](../f1-widget-sdk/docs/project-documentation.md).

Each generated project preserves intended state/frame mappings and decisions in
human-readable docs. Each build manifest pins converter/toolchain identity,
input and output hashes, descriptor addresses, code entry, allowed mutations,
integrity locations, partition headroom, and rollback reference.

## Verification status

```sh
npm --prefix f1-widget-sdk test
```

The current SDK passes 48/48 offline tests. They generate widget and media projects, run the
pinned Input converter, build twice, compare deterministic outputs, inspect
image integrity, exercise rejection paths, validate the Music and WPM
registration ABIs and real combined app, simulate the guarded app-only device
workflow, and verify media handshake/diff/chunk/blocked-sink behavior, bounded
idle-provider timeouts, and top-level media CLI imports/dispatch. That
verifies the toolchain behavior; it does not approve a generated widget for
flashing or claim device rendering.

## SDK v0.3 and music-player proof

Status: **SDK v0.3 guarded combined tooling available; Music Player ID-`1` plus
WPM ID-`7` app written and boot-healthy, visual acceptance pending**. The
package is version `0.3.0`; this is not an official SDK release.

The isolated [music-player vertical slice](../f1-widget-sdk/examples/music-player/README.md)
proves a deterministic host-side media contract and 100×310 preview pipeline.
Its [`widget.proposed.json`](../f1-widget-sdk/examples/music-player/widget.proposed.json)
is a review artifact because the current compiler accepts only the guarded WPM
profile. The generated bundle is explicitly
`OFFLINE_MEDIA_BUNDLE_NOT_DEVICE_INSTALLABLE`. The separate
[`on-device` candidate](../f1-widget-sdk/examples/music-player/docs/ON-DEVICE-CANDIDATE.md)
compiles a deterministic, relocation-free 1,129-byte provisional ID-`1` ABI,
SHA-256
`0aa07e8b0d9b36be82d5df37f0422f630a51cd621825d5ff794f60ff70bbbf5b`.
It is a registration module, not an app image.

The real SDK combined builder now links that module with frozen
`stage3e34_register_wpm` under one stock setup wrapper. Its app is 2,029,088
bytes, SHA-256
`6cad38dee31e5a44ce32011686cca38e38ff35b1fe7c32300ced92b68549df26`.
That exact app was written app-only with esptool hash verification and booted
healthy on `knob_f1` firmware 0.4.1. No live host-to-device media transport or
accepted music-widget visual result is claimed; the included Music content is
a deterministic fixture.
