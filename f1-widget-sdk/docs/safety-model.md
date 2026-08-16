# Safety model

The SDK fails closed on static/image-integrity contracts. Offline builds do
not imply deployment approval. Device access is isolated behind a separate
candidate approval plus an explicit app-only confirmation.

## v0.3 Stage-3E.3 safe-page profile

The current profile uses 48 binary-alpha LVGL I4 sources, each 52x42 with
26-byte stride. Native descriptor order is `species*8+state`; the 56,640-byte
bank occupies `0x3c1c1190..0x3c1ceed0`, leaving 4,400 bytes before the hard
exclusive `0x3c1d0000` runtime-readable boundary. The root and three stars are
procedural LVGL objects, not bitmap assets. The pet source is scaled once by
`0x200` and screen-local vtable slot 9 owns Fn plus bottom encoder ID 1.

The exact full-48 E3.3 live artifact is a runtime NO-GO because no pet rendered.
The deploy workflow refuses its `deployable: false` report. Stage-3E.3A remains
the live/readback rollback and one-I4 decoder proof.

## Pinned inputs

- Official merged 0.4.1 firmware and exact live-tested Stage-3C.1 app hashes.
- Local Input converter 0.1.28 package, JavaScript, and WASM hashes.
- Exact live-visual Stage-3E converted frames, native bank, and padded bank.
- ESP32-S3 13.2.0_20240530 assembler/linker/binutils hashes.

Before project conversion, the SDK reconstructs the Stage-3E descriptor/data
bank and its one-page pad. This proves the local converter and bank builder
still reproduce the known-good 100x100 reference; it does not prove 100x310 or
multi-page runtime rendering.

## Code guards

Rendered source is assembled and linked twice. Output must be byte-identical,
`elf32-xtensa-le`, aligned, relocation-free, and within a 64-KiB code limit.
The entry symbol must be in appended code. Forbidden global-hook/obsolete
manager addresses are rejected. Runtime literals must be reviewed helper
addresses or generated descriptors. Required screen-local slot-9 input and
exact label/layout instruction patterns are audited.

## Asset and DROM guards

Images must be uncompressed LVGL-v9 I8 (`19 0a`), with a 12-byte header,
1024-byte palette, valid stride, and exact size. They become immutable 24-byte
native descriptors plus palette/index payloads in this order:
`sky0, sky1, species*8+state`.

DROM growth is not hardcoded:

`ceil(nativeBankBytes / 0x10000) * 0x10000`

The IROM physical position and every later segment must shift by that exact
amount while preserving low-16-bit flash/MMU congruence. The manifest also
records which payloads cross or start beyond the first new virtual DROM page.

## Allowed firmware mutation

Relative to exact Stage-3C.1, only three mutation classes are accepted:

1. append the calculated whole-page DROM bank;
2. append compiled widget bytes to IROM;
3. replace the reviewed setup-pointer word with the compiled entry.

All old bytes except that word remain identical. Header shifts are exact. The
stock key callback, WPM tick, and Timer getter must survive. The result must
retain six segments, one DROM, one IROM, valid checksum/digest, and fit the
8-MiB factory partition.

## Known regression gates

All current `wpm-roster-v2` 100x310 builds exceed the live-proven Stage-3E
single-virtual-page geometry. They are emitted only for offline analysis with:

- `OFFLINE_EXPERIMENTAL_KNOWN_LIVE_IMAGE_REGRESSION`;
- `runtimeImageEvidence.status = UNRESOLVED_LIVE_REGRESSION_DO_NOT_PROMOTE`;
- `liveVisualApproved = false`.

The legacy v0.2 project builder contains no hardware transport. Version 0.3's
separate `device-workflow.mjs` can perform an opt-in app-only candidate write.
It requires exact device/firmware/MAC/chip/security/flash, recovery, target,
rollback, approval mode, port, offset, and hash gates. Fast smoke relies on
esptool's normal post-write hash verification; release mode additionally reads
the complete app back before boot. Both modes use watchdog boot and read-only
Input health verification. The argument auditor rejects erase, force, and
encryption bypass tokens and only permits one file at `0x10000`.
