# Reverse-engineering notebook

This page records reproducible offline methods. It is intentionally separate
from the live flash runbook so analysis commands cannot be mistaken for device
writes.

## Preserve originals first

Hash downloaded binaries before analysis:

```sh
shasum -a 256 artifacts/firmware/firmware_0.4.1_merged.bin
shasum -a 256 artifacts/firmware/nomad_e_v2_0.2.0_merged.bin
```

Never patch the pinned source file in place. Builders copy it into an ignored
output directory and assert the expected original bytes before changing them.

## Extract the factory app

The merged Framer image places the app at flash offset `0x10000`:

```sh
dd if=artifacts/firmware/firmware_0.4.1_merged.bin \
  of=artifacts/firmware/framer_app_0.4.1.bin \
  bs=1 skip=65536

.venv-esptool/bin/esptool image-info \
  artifacts/firmware/framer_app_0.4.1.bin
```

The output must report ESP32-S3, six segments, entry point `0x4037D010`, a valid
checksum/hash, project `nomad-e-fw`, and version `0.4.1`.

## Extract mapped DROM and IROM

Using the segment offsets printed by esptool:

```sh
dd if=artifacts/firmware/framer_app_0.4.1.bin \
  of=artifacts/firmware/framer_app_drom.bin \
  bs=1 skip=32 count=659824

dd if=artifacts/firmware/framer_app_0.4.1.bin \
  of=artifacts/firmware/framer_app_irom.bin \
  bs=1 skip=720928 count=1142004
```

Esptool's displayed file offsets (`0x18` and `0xB0018`) point to each 8-byte
segment header; mapped bytes start 8 bytes later. Earlier raw extractions in this
workspace included those headers, shifting every apparent instruction by 8
bytes. The corrected mapping bases are `0x3C120020` for DROM and `0x42000020`
for IROM. `artifacts/firmware/framer_app_segment_map.json` records header, data,
merged, and virtual ranges so future address conversions use one checked
formula. Open the corrected Xtensa instruction segment in radare2 with:

```sh
r2 -NN -a xtensa -b 32 -m 0x42000020 \
  artifacts/firmware/framer_app_irom.bin
```

Inside radare2, use targeted analysis and cross-references before broad
auto-analysis; full `aaaa` output is very noisy on this stripped image.

## Useful string work

```sh
strings -a -t x artifacts/firmware/framer_app_0.4.1.bin | less
xxd -g 1 -s 0x5a80 -l 0x100 artifacts/firmware/framer_app_0.4.1.bin
rg -a -n "Timer|pomodoro|media_player|v\.framer\.bubble" \
  artifacts/firmware/framer_app_0.4.1.bin
```

Raw string presence is a lead, not proof of a feature. Confirm whether mapped
code loads the address, which function uses it, and whether matching state,
callbacks, and UI objects exist.

## Current Timer trace

- App offset `0x5AE0` contains `Timer`.
- Its mapped DROM address is `0x3C125AE0`.
- Literal virtual address `0x42002110` (app file offset `0xB2110`) resolves to
  the Timer DROM heading.
- Visible-label callsite `0x4202A096` (`0xDA096` in the original app file)
  passes it to label text setter `0x4204EE30`.
- This proves a visible screen-heading path; it is not an inferred registry
  label.

Next useful work is to trace the Timer input handlers and bridge them safely to
the linked but unwired Pomodoro-like state object.

## Current stage-2 bridge candidate

**Strong offline candidate; built, tested, and independently audited but not
flashed.** Nomad uses a distinct Pomodoro view/controller, while Framer's Timer
and dormant state-machine object have different layouts. Replacing a getter
alone is ABI-unsafe because Timer callers would interpret the wrong fields and
methods.

The current in-place design instead uses adapters. It would reuse the now-
unreachable body of the old Timer getter/constructor as a bounded code cave,
map dormant state into Timer's expected status, start the dormant base timer,
and patch the Timer start, pause, reset, resume, and getter helpers. The builder
retains all segment lengths, asserts original bytes, and verifies its final
checksum/digest/hash. Exact addresses and bytes are in the
[stage-2 appendix](./09-stage2-patch-candidate.md). Independent caller/ABI audit
is GO; runtime verification remains pending.

## Planned segment-growth notebook

Fixed segment lengths are a Stage-1/Stage-2 safety technique, not a permanent
constraint on separate widgets. The next architecture proof is controlled
growth, staged as an unreferenced IROM-growth canary, a callable visible canary,
and then a registered Pomodoro/WPM view.

For every growth build, extend the evidence trail with the app's old/new total
length, every segment header and mapped range, alignment/padding, entry point,
segment count, checksum byte, appended digest, factory-partition headroom, and
sector-rounded flash end. Disassemble all new callable code and every new edge
from existing code before live use. A callable or behavior-changing live run is
not eligible until physical ROM entry is proven; after flashing, read back and
compare the entire written payload before the first boot.

The first attempt to implement that canary by appending a second IROM segment
is a preserved **NO-GO** finding, not a usable build pattern. ESP-IDF 5.3.2 maps
only the last IROM segment, so a formally valid seven-segment image can lose the
stock executable mapping at boot. The replacement grows the one existing IROM
segment and shifts later segments/footer. Loader-source review is therefore a
required structural check in addition to `esptool image-info`.

The corrected builder now performs that single-IROM extension against the
live-verified Stage-1 baseline. Its canary begins at app offset `0x1C6D14` /
VA `0x42116D14`; later RAM/RTC segment file offsets move by 16 bytes while their
content, load addresses, and lengths remain unchanged. Local tests pass,
independent audit reproduced the mapping/hashes with STRUCTURAL/LOADER GO, and
the exact app-only image was written/read back/booted successfully.

That proof was implemented in `build-stage3b.mjs`. It appends
an assembled eight-byte function at app `0x1C6D24` / VA `0x42116D24` and
redirects only the remaining-seconds getter literal at app `0xB1F18`. The
function returns 42, producing the bounded visual `Pomo` / `00:42` without
starting the Timer. The exact app was subsequently written/read back,
booted, and user-confirmed at `00:42`. Independent STATIC GO reproduced the four
`callx8` consumers, windowed return ABI, same-MMU-page mapping, integrity, and
hashes. This completes the appended-code proof. Stage 3C later completed its
own exact write/read-back/boot successfully without proving physical recovery.

The deterministic `build-stage3c.mjs` constructs that broader image from the
exact Stage-3B base and pinned 564-byte ABI hex. Five focused tests and
`image-info` pass. The exact app was then written at `0x10000`, fully read back,
integrity-checked, and booted normally. Runtime testing found ID `7` navigable
but black; cycling to the first screen briefly displayed a faint `wpm` popup
before it disappeared. This is a defect record, not visual acceptance.
Treat the app SHA-256
`4179b868b5a888f155fa93457c6ce9c8e57965ed5c756230dbb076fe27e910e6`
as both the reproducible build identifier and the verified live read-back hash.

Root-cause analysis mapped the global bubble consumer to stock ID `8`; ID `7`
owned only a blank root. `build-stage3c1.mjs` is the owned-label corrective branch:
stock slot `1` builds two root-owned labels, slot `3` stays no-op, slot `6`
null-guards and refreshes the value, and no global-bubble references remain.
Its 1,960,496-byte app SHA-256 is
`e2e7ba4ab4b9c247af8c0bdc3d7896ac52967bb7f90fb19beae73c0ae4a2b8fd`.
Independent generated-image review returned STATIC GO. The exact app was
written app-only at `0x10000`, fully read back with the same SHA-256 and zero
byte differences, validated at checksum `0xB5` and digest
`19ea7be90597720134b1bb2cf86144a6e17dc6b68b0cbf20320055139250a1c7`,
then booted normally after watchdog reset. The user confirmed persistent white
`wpm` text and typing-driven value updates, closing the prior black-screen/
cross-screen-popup defect. Treat that exact SHA as the Stage-3D rollback base.
Stage 3D has an executable state model, pinned four-label ABI with STATIC GO,
deterministic builder, and offline tests. Its exact app-only image was then
written, fully read back, and booted with normal device health. Do not promote
that byte/boot evidence into a UI claim. Runtime is PARTIAL/DEFECT: screen/text
rendered, the cat did not update, and one crash/watchdog reboot occurred after
the first restart but has not repeated. Next, diagnose the exact crash/coredump,
remove or repair the key hook, study stock wallpaper/LVGL image paths, and prove
screen-owned frame/state changes without assuming a root cause.

Stage 3E completed that repair and is now live-visual. The device proved a
100×310 logical LVGL canvas; this made the centered 100×100 sky occupy only the
middle third. Stage 3E.1 deterministically builds 100×310 full-canvas skies but
is not live. Stage 3E.2 subsequently received exact live
write/read-back/boot/health success, but runtime is a NO-GO. Sky-1 crosses the
original DROM mapping limit `0x3C1D0000` at row `267`, column `92`, and every
pet payload begins above that limit. Those locations exactly match the bottom
13.6% black corruption and white avatar squares. Stage 3E.3A isolates one
static 52×42 I4 cat wholly below the limit. Independent audit, exact
write/read-back, and boot/health pass; visual acceptance is pending.

## Xtensa toolchain endianness guard

Use only the `xtensa-esp32s3-elf-*` assembler, objdump, and objcopy for appended
Framer code. The generic `xtensa-esp-elf-*` frontend emits big-endian ELF. The
current instruction-only Stage-3B bytes are coincidentally unchanged, but a
future `.long` address literal would be encoded in the wrong byte order and
could redirect execution catastrophically. This matters directly to Stage 3C,
whose appended ABI contains nearby function-address literals.

Run [`verify-stage3b-assembly.mjs`](../custom-firmware/tools/verify-stage3b-assembly.mjs)
to assemble with the ESP32-S3-specific tools, verify that executable `.text`
has no code/data relocations, disassemble the object, extract only the canary
section, and compare it against the pinned bytes. `.rela.xt.prop` metadata may
exist in the ELF and is not an executable relocation. The Stage-3C builder
consumes only the hash-pinned hex artifact, while
[`verify-stage3c-abi.mjs`](../custom-firmware/tools/verify-stage3c-abi.mjs)
retains the little-endian tool-name and zero-final-relocation guards.

## Compare Framer and Nomad carefully

Useful comparisons include:

- partition tables and application descriptors;
- controller and event strings;
- embedded assets;
- app-registry/runtime markers;
- display and peripheral driver strings;
- release-to-release changes within the same hardware family.

Do not infer compatibility from a shared project name or ESP32-S3 target. Nomad
and Framer driver paths differ, and the Nomad SDK alpha is a behavioral/source-
shape reference only.

## Desktop application inspection

The extracted Input app is research material. Search its formatted renderer for
widget catalog filters and its main process for SDK calls. Keep experiments in
the separate `Input Lab.app`; do not replace the signed application needed for
native SDK loading.

The local-debugger bridge in `framer-widgets/lib/input-inspector.mjs` evaluates
inside the installed app and loads its packaged SDK through `createRequire`.
The debugger is localhost-only, should be enabled only for the experiment, and
is removed by quitting/reopening Input normally.

## Maintain an evidence trail

For every new address or patch, record:

- firmware filename and SHA-256;
- app/merged file offset and mapped address;
- exact original bytes;
- instruction or data interpretation;
- cross-reference/caller evidence;
- confidence label: verified, inference, or pending live test;
- test that will reject an incorrect target in future firmware.

That makes the work reproducible and prevents an address from one release being
silently reused against another.
