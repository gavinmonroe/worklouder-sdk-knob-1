# Input media and Nomad transport evidence

This file distinguishes a verified host provider from an unproven Framer device adapter.

## Input 0.18.2 host provider

The signed Input application includes:

- `/Applications/input.app/Contents/Resources/scripts/media-info-retriever.scpt`
- SHA-256 `1d3262dff8bdf70b1b3140ab7ac556f622783d21d1c05ba0bb4ec6302f555090`
- an identical copy in `artifacts/Input Lab.app`.

Decompilation shows three provider branches:

1. Spotify: name, artist, seconds-duration, player position, HTTPS artwork URL, playback state.
2. Apple Music: name, artist, seconds-duration, player position, raw artwork converted to base64, playback state.
3. MediaRemote fallback: name, artist, duration, elapsed time, and playback rate; artwork may be absent.

Input's main process runs that script once per second while a supported device requests media. It downloads or base64-decodes artwork, uses Jimp to resize it to `80x80`, converts it to the device LVGL format, sends metadata diffs, and sends artwork only after a track-name change.

The new adapter reuses the provider but improves the record parser so commas and colons in title or artist do not split fields. It returns decoded RGBA8 to the provider-neutral music contract rather than calling Input's device converter.

## Nomad-only device path

The extracted `@worklouder/wl-device-kit` 0.1.28 client defines:

- `sendMediaInfo()` -> JSON-RPC method `mp.write_info`;
- `writeMediaArtwork()` -> chunked JSON-RPC method `mp.write_artwork`;
- deprecated alias `writeMediaArtWork()`.

Input's device wrapper registers `mp.fetch_data` notifications and a `mediaPlayer` feature only in the `NomadE` and `NomadEV2` switch branches. Its `Knob`/`KnobF1` branch registers generic alerts but no media notification. Its device-screen service similarly starts media polling only when a Nomad reports screen name `media-player`.

An offline string scan finds no `mp.write_info`, `mp.write_artwork`, or `mp.fetch_data` method string in the captured Framer 0.4.1 factory application or current custom Music module. Negative string evidence is not sufficient alone, but it agrees with the firmware handler/registration audit: Music ID1 is currently a local mock controller with no receive ABI.

## Exact blocker

There is no safe runtime call to expose through the existing Input localhost evaluator today. The missing component is a Framer-specific firmware adapter, not a macOS media provider.

`FRAMER_MEDIA_RUNTIME_BLOCKER` in `src/framer-runtime-sink.mjs` is the machine-readable gate. Its required proof list covers bounded metadata, verified artwork staging, UI-thread application, stale/no-track handling, and Framer lifecycle/rollback tests. The sink performs no discovery, USB, serial, filesystem, or RPC operation.

## Reproducible offline checks

```sh
osadecompile /Applications/input.app/Contents/Resources/scripts/media-info-retriever.scpt
shasum -a 256 /Applications/input.app/Contents/Resources/scripts/media-info-retriever.scpt
rg -n 'sendMediaInfo|writeMediaArtWork|mp\.fetch_data' \
  extracted/input-app/dist-electron/main/index.js \
  extracted/input-app/node_modules/@worklouder/wl-device-kit/dist/index.js
rg -a -n 'mp\.write_info|mp\.write_artwork|mp\.fetch_data' \
  recovery/backups/2026-08-15-framer-f1-a4cb8faf3210-before-custom/partition-1-factory-0x10000-0x800000.bin \
  f1-widget-sdk/examples/music-player/on-device/music-player-id1.S
```

The last command is expected to produce no matches.
