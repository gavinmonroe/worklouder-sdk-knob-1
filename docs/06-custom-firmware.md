# Native custom-firmware workflow

This directory's first custom image is a deliberately small persistent proof.
It changes the visible built-in Timer screen heading to `Pomo`, repairs ESP
image integrity, and leaves the image size and partition layout unchanged.

## Why start with a label patch

A one-field change tests the dangerous mechanics with a small, auditable byte
delta:

- the correct official base image is selected;
- the patch lands at the expected DROM offset;
- the factory image remains parseable;
- its checksum and appended digest are repaired;
- app-only flashing and read-back work;
- the device boots and visibly reflects our bytes;
- official app restoration works if boot fails.

It does **not** prove Pomodoro behavior. The countdown remains the native Timer
until later controller changes are made.

## Rebuild stage 1

```sh
node custom-firmware/build-stage1.mjs
node --test custom-firmware/test/*.test.mjs
.venv-esptool/bin/esptool image-info \
  custom-firmware/build/framer-0.4.1-stage1-pomo-app.bin
```

The builder refuses a base image whose SHA-256 is not the pinned official
0.4.1 hash. It also refuses if the expected `Timer\0\0\0` field is absent at app
offset `0x5AE0`, and labels must be 1–7 printable ASCII characters.

The deterministic default result is:

| Property | Value |
| --- | --- |
| App flash address | `0x10000` |
| App file patch offset | `0x5AE0` |
| Merged-file patch offset | `0x15AE0` |
| Original field | `54 69 6D 65 72 00 00 00` (`Timer`) |
| Patched field | `50 6F 6D 6F 00 00 00 00` (`Pomo`) |
| App bytes | 1,960,000 (`0x1DE840`) |
| App SHA-256 | `92ea0d48bff0652df5cba789713ad1ec7c90f50ccbc88716df7bdc0bbd45c3c2` |
| ESP image checksum | `0xA6` |
| Appended validation digest | `a6d53fb5ab814fd35ee45078bc1eb3d898f3591cad98fa69587ae3cc489be344` |

`custom-firmware/build/stage1-manifest.json` records the source, output, and
integrity offsets. Build outputs are ignored by Git and should be regenerated
from the pinned input.

## Pre-flash gate

Before writing, all of these must be true:

- The full 16 MiB pre-custom backup exists and is exactly 16,777,216 bytes.
- Its SHA-256 and partition hashes are saved.
- Its stock merged prefix matches official 0.4.1.
- The security/eFuse report still says Secure Boot and Flash Encryption are off.
- The connected target is the same ESP32-S3 / MAC recorded in the backup.
- App-independent physical GPIO0/BOOT plus reset/EN access has been located and
  demonstrated on this F1.
- The stage-1 unit tests and `esptool image-info` validation pass.
- The official app-only restoration file and full-backup route are available.

As of 2026-08-15, the full-backup, hash, partition, official-prefix, eFuse,
device-identity, builder-test, and restore-file checks pass. Stage 1 was written
and booted successfully while the chip was already in ROM download mode. That
success does not prove recovery from a future nonbooting app. A live filtered
`usb-reset` probe under normal firmware found no F1 serial port, so physical
GPIO0/BOOT plus reset/EN access remains the only candidate and is pending
before Stage 2.

## Stage-1 app-only write

This is the command shape used for the successful Stage-1 app-only write. The
half-open written range was `0x10000..0x1EE840`, leaving the bootloader,
partition table, NVS, filesystem, and coredump outside the written range:

```sh
FRAMER_PORT=/dev/cu.usbmodem83201
CUSTOM_APP=custom-firmware/build/framer-0.4.1-stage1-pomo-app.bin
shasum -a 256 "$CUSTOM_APP"

.venv-esptool/bin/esptool \
  --chip esp32s3 --port "$FRAMER_PORT" --baud 115200 \
  write-flash --flash-size keep \
  0x10000 "$CUSTOM_APP"
```

Do not write `framer-0.4.1-stage1-pomo-merged.bin` at `0x10000`: a merged image
contains bootloader/partition bytes before its app. The explicit app file is the
correct payload for offset `0x10000`.

## Read-back before boot

```sh
.venv-esptool/bin/esptool \
  --chip esp32s3 --port "$FRAMER_PORT" --baud 115200 \
  --after no-reset read-flash --no-progress \
  0x10000 0x1de840 /tmp/framer-stage1-readback.bin
shasum -a 256 /tmp/framer-stage1-readback.bin "$CUSTOM_APP"
cmp /tmp/framer-stage1-readback.bin "$CUSTOM_APP"
```

The live read-back produced the stage-1 app hash and `cmp` exited with no
differences. Esptool also validated checksum `0xA6` and appended digest
`a6d53fb5ab814fd35ee45078bc1eb3d898f3591cad98fa69587ae3cc489be344`.
The device re-enumerated as `knob_f1` on 0.4.1 and reported 80% battery while
charging. The standalone Stage-1 run was not separately visually recorded. Its
heading bytes remained unchanged in the later live Stage-3B derivative, where
the user confirmed `Pomo` on the physical screen.

## Read-only post-boot verification

Quit and relaunch the signed Input app with its local main-process debugger,
then run the guarded verifier:

```sh
open -n -a input --args --inspect=9230
node recovery/verify-live-firmware.mjs
```

[`recovery/verify-live-firmware.mjs`](../recovery/verify-live-firmware.mjs)
refuses to continue unless it sees exactly one USB-connected Framer F1. It uses
the SDK bundled inside the installed Input app and reads only firmware version,
device status, and current screen; it does not write firmware or settings. For
the Stage-1 boot it reported version `0.4.1`, battery `80`, charging, and normal
`knob_f1` identity. Close and reopen Input normally after verification to stop
the debugger listener.

## Stage-1 experiment record

| Field | Live result |
| --- | --- |
| Date | 2026-08-15 |
| Device MAC | `a4:cb:8f:af:32:10` |
| Security | Unchanged; Secure Boot and Flash Encryption disabled |
| Backup SHA-256 | `aa6042310d075c9cbd3b992044511c064bb4b84713d0740a3adafcbdb3028fdd` |
| Custom app SHA-256 | `92ea0d48bff0652df5cba789713ad1ec7c90f50ccbc88716df7bdc0bbd45c3c2` |
| Write scope/result | App only, `0x10000..0x1EE840`; esptool verification passed |
| Read-back | 1,960,000 bytes; matching SHA-256; zero `cmp` differences |
| Image integrity | Checksum `0xA6` and appended digest valid |
| Boot result | `--after watchdog-reset`; normal `knob_f1` re-enumeration |
| Device status | Version 0.4.1, battery 80%, charging |
| Visible UI | Not separately observed on Stage 1; unchanged `Pomo` heading later user-confirmed on live Stage 3B |
| Restore required | No |

## Path from proof to real Pomodoro

### Stage 2A: repurpose Timer behavior

Bridge the native Timer view and input helpers to the linked but unwired
Pomodoro-like object. Timer and that object have different layouts, so swapping
only their getters is ABI-unsafe. The current offline candidate uses adapter
code in the now-unreachable old Timer getter/constructor body, patches
start/pause/reset/resume/getter helpers, and retains segment sizes. A
deterministic builder now asserts all original ranges, repairs integrity, and
passes changed-byte tests. Independent static review verified all nine guarded
ranges, control flow, field adapters, and hashes and found no static crash
defect. Live behavior is still unproven. This route temporarily replaces Timer
rather than adding a separate widget.

Build and validate the offline candidate:

```sh
node custom-firmware/build-stage2.mjs
node --test custom-firmware/test/*.test.mjs
.venv-esptool/bin/esptool image-info \
  custom-firmware/build/framer-0.4.1-stage2-pomodoro-app.bin
```

The generated app is 1,960,000 bytes with SHA-256
`c61b6e2da9cac2d397bcde2cdcf7850d3fbf4a1daad44db0e8f412df39c9552c`.
It remains an offline candidate, not a flashing recommendation.

The exact current byte map, integrity values, expected 25/5 ×4 behavior, and
audit checklist are preserved in
[the stage-2 candidate appendix](./09-stage2-patch-candidate.md). Static
review is GO; runtime confidence remains medium until live proof.

Known limitations of this candidate are deliberate and documented before live
testing: the break number should count down from `05:00`, but its ring still
uses 1500 seconds as the denominator and begins near 20%; the heading stays
`Focus` during breaks; no transition notification/beep is added; and all state
is lost on reboot. Actual runtime behavior remains unproven.

### Stage 2B: stabilize and test

Test pause/resume, boundary transitions, wraparound, power cycle, USB reconnect,
and return-to-clock behavior. Preserve a watchdog-safe update frequency and
avoid writing countdown state to flash every second.

### Stage 3: controlled growth for separate widgets

The user has accepted application-segment growth when required to add a genuine
widget beside Clock and Timer. Same-length patches remain valuable for the
current bridge, but they are no longer a permanent design restriction. Growth
must proceed as three separately built and reviewed experiments:

1. **Unreferenced IROM-growth canary.** Add uniquely identifiable, harmless
   bytes to the existing mapped IROM segment, with no runtime reference to
   them. Prove image parsing, mapped ranges, checksum/digest, app-only
   write/read-back, and an otherwise unchanged boot.
2. **Callable visible canary.** Add a minimal new routine/data object and call it
   from one understood, bounded screen path so the display proves execution
   from the grown region. Preserve normal Clock, Timer, USB/HID, and navigation.
3. **Registered view/controller.** Add a real Pomodoro view first, then reuse
   the same framework for a WPM pet. Each needs explicit ownership/lifetime,
   controller or vtable/factory wiring, state, label/assets, input dispatch, and
   navigation registration.

The current IROM canary must extend the existing segment. A future segment may
be added only for a type the bootloader explicitly supports; ESP-IDF 5.3.2 must
never be given a second IROM or DROM segment. Loader behavior, alignment,
mapped-address, and segment-count rules must be checked offline. The factory
partition remains the hard boundary: it starts at
`0x10000`, is `0x800000` bytes long, and ends before NVS at `0x810000`. Both the
payload and sector-rounded erase/write range must stay inside it; no growth
experiment may alter the partition table, NVS, filesystem, or coredump.

#### Rejected first Stage-3A artifact

The initial builder appended a seventh, second IROM segment. It is
**REJECTED/NO-GO and must never be flashed**, including by hash or filename from
an old build directory. ESP-IDF 5.3.2's bootloader records only the last IROM
segment it encounters; its own diagnostic says multiple IROM segments result
in only the last one being mapped. The 16-byte canary would therefore replace
the stock executable mapping even though `esptool image-info`, checksum
`0x94`, and the appended digest all validated.

The rejected app SHA-256 is
`487eec34d864f233decfd7dcbf038daac722a6277ebe393baeddb98b7d89500b`;
the rejected merged SHA-256 is
`146163b2cf5396fabba29f40ca020765730c40e962ddcfe0fa5fae031b833b1f`.
Keep those values only as a denylist/history marker. The loader behavior is
visible in Espressif's official
[`bootloader_utility.c` for ESP-IDF 5.3.2](https://github.com/espressif/esp-idf/blob/v5.3.2/components/bootloader_support/src/bootloader_utility.c).

#### Corrected Stage-3A live proof

The replacement keeps one IROM segment, extends that existing segment by 16
unreferenced bytes, and shifts following segment headers/data and the footer.
Independent review reproduced the mapping/hashes and gave STRUCTURAL/LOADER GO;
the exact app was subsequently written, read back, and booted successfully on
the F1.

```sh
node custom-firmware/build-stage3a.mjs
node --test custom-firmware/test/*.test.mjs
.venv-esptool/bin/esptool image-info \
  custom-firmware/build/framer-0.4.1-stage3a-segment-canary-app.bin
```

| Property | Corrected single-IROM value |
| --- | --- |
| Baseline | Exact live write/read-back/boot-verified Stage-1 `Pomo` image |
| Segment count | 6 → 6; exactly one DROM and one IROM |
| IROM header/data/load | app `0xB0018` / app `0xB0020` / VA `0x42000020` |
| IROM length | `0x116CF4` → `0x116D04` |
| Canary | app `0x1C6D14`, VA `0x42116D14`, 16 bytes (`F1SEGMENTCANARY\0`) |
| Segment 4/5 movement | Header/data file offsets shift `+16`; load addresses, lengths, and bytes are unchanged |
| App size/headroom | 1,960,016 bytes; 6,428,592 bytes remain in the 8 MiB factory partition |
| Checksum | app `0x1DE82F` = `0x94`, valid |
| Appended digest | app `0x1DE830` = `2b2be4605c5e7a4b21bd70d70983fbf7bbd4267bee313da4778d4a0c8b1b13fa`, valid |
| App SHA-256 | `088628179c760b919623288c6655449ee48734bc1a7bcadb885bd4a8d47dc24f` |
| Merged SHA-256 | `74bb0bb5d7a3f0a7421198942bbadd88f53062bed7b96d0931ac9a438769b415` |

The implementation is split across the guarded
[`build-stage3a.mjs`](../custom-firmware/build-stage3a.mjs), reusable
[`esp-app-image.mjs`](../custom-firmware/lib/esp-app-image.mjs) structure helper,
and [`stage3a.test.mjs`](../custom-firmware/test/stage3a.test.mjs). The generated
[`stage3a-manifest.json`](../custom-firmware/build/stage3a-manifest.json)
records all final offsets and hashes. Tests prove the Stage-1 `Pomo` field and
all original segment bytes survive, the one IROM grows exactly 16 bytes, later
segments shift intact, the base hash is pinned, and invalid extensions fail.
No runtime reference reaches the canary.

#### Live Stage-3A record

| Field | Live result |
| --- | --- |
| Write scope | App only at `0x10000`; 1,960,016 bytes |
| Esptool write verification | Passed, including on-device hash |
| Full read-back SHA-256 | `088628179c760b919623288c6655449ee48734bc1a7bcadb885bd4a8d47dc24f` |
| Byte comparison | `cmp` reported zero differences against the build |
| Read-back integrity | Checksum `0x94` and appended digest valid |
| Bootloader exit | `--after watchdog-reset`; ROM port disappeared |
| Normal device | `knob_f1`, services ID `4294979630`, firmware `0.4.1` |
| Status | Profile `0`, layer `1`, battery `87%`, charging |
| Visible behavior | No new UI by design; canary has no references and Stage-1 `Pomo` remains |

This proves controlled growth and bootloader mapping for an unreferenced
extension. It does not prove that a call into the grown tail executes correctly
or that a new view can be registered.

In short: Stage 3A is the completed **nonvisual growth/read-back/boot proof**;
Stage 3B is the completed **visible appended-code execution proof**; Stage 3C is the future **new selectable WPM-pet
widget**. The live Stage-3A app remains
SHA-256
`088628179c760b919623288c6655449ee48734bc1a7bcadb885bd4a8d47dc24f`;
the merged comparison image remains
`74bb0bb5d7a3f0a7421198942bbadd88f53062bed7b96d0931ac9a438769b415`.

#### Stage-3B visible canary: static GO, live and visually verified

The builder extends the live-verified Stage-3A IROM by eight bytes and redirects
only the stock Timer remaining-seconds getter pointer. The exact image was
independently audited, subsequently written/read back/booted, and its display
result was confirmed:

| Property | Stage-3B value |
| --- | --- |
| Base | Exact Stage-3A app SHA-256 `088628179c760b919623288c6655449ee48734bc1a7bcadb885bd4a8d47dc24f` |
| Appended code | app `0x1C6D24`, VA `0x42116D24`, 8 bytes |
| Code bytes | `36 41 00 2C A2 1D F0 00` |
| Semantics | `entry a1, 32`; return integer `42`; `retw.n`; alignment byte |
| Hook literal | app `0xB1F18`, literal VA `0x42001F18` |
| Hook change | `0x421084F4` stock remaining getter → `0x42116D24` |
| Image | Six segments, one IROM, 1,960,016 bytes |
| Checksum/digest | `0xB8`; `5355b69b8744ad9be2046e4ca2e50d2e34add3c998d1ba766058e2ce2e9cac59` |
| App SHA-256 | `fe800d21d2527c36bea181e10e381982f9024ed50c3ce09e104b3ef299ead289` |
| Merged SHA-256 | `ed172e48561a4cc2e65c889a10f3b5c65efd5d867cd8badf5e5c5d4689836c3d` |

All four consumers of the shared getter pointer are byte-pinned. Each passes
the Timer controller in `a10` and expects a `u16` seconds result:

| Purpose | Consumer VA | Expected bytes |
| --- | ---: | --- |
| Progress ring | `0x42026699` | `81 1F 6E E0 08 00` |
| Time formatter | `0x420266DA` | `81 0F 6E E0 08 00` |
| Screen-construction cache | `0x420268A5` | `81 9C 6D E0 08 00` |
| Runtime refresh | `0x42029F63` | `81 ED 5F E0 08 00` |

The construction consumer stores 42 at existing Timer-view field `+40`, just
as it stores the stock getter result. This is view-cache behavior; the appended
getter does not mutate controller state.

Independent review gave STATIC GO after reproducing the four consumer
sequences, hashes, image layout, and windowed ABI. The stock `callx8` path maps
callee return `a2` to caller `a10`, matching the `u16` getter contract, and has
no direct-call range limit. The appended code stays on Stage 3A's already-
mapped IROM page, so MMU page count does not increase.

The implementation is in
[`build-stage3b.mjs`](../custom-firmware/build-stage3b.mjs), with reviewed
assembly source
[`stage3b-visible-canary.S`](../custom-firmware/asm/stage3b-visible-canary.S),
tests in [`stage3b.test.mjs`](../custom-firmware/test/stage3b.test.mjs), and the
generated
[`stage3b-manifest.json`](../custom-firmware/build/stage3b-manifest.json).

```sh
node custom-firmware/build-stage3b.mjs
node custom-firmware/tools/verify-stage3b-assembly.mjs
node --test custom-firmware/test/*.test.mjs
.venv-esptool/bin/esptool image-info \
  custom-firmware/build/framer-0.4.1-stage3b-visible-canary-app.bin
```

The assembly verifier deliberately invokes `xtensa-esp32s3-elf-as`,
`xtensa-esp32s3-elf-objdump`, and `xtensa-esp32s3-elf-objcopy`. The generic
`xtensa-esp-elf-*` frontend produces big-endian ELF and is unsafe for future
`.long` function-address literals. Stage 3B's instruction-only bytes happen to
assemble identically, which is not evidence that literal data would. All Stage
3C assembly must use the ESP32-S3-specific little-endian tools. The executable
`.text.stage3b_visible_canary` section has no code or data relocations. The ELF
does contain `.rela.xt.prop` metadata; that is property metadata, not an
executable-section relocation. The verifier disassembles/extracts `.text` and
compares it to the pinned eight-byte sequence. `FRAMER_XTENSA_BIN` may override
only the toolchain directory, not the required tool names.

##### Live Stage-3B record

| Field | Live result |
| --- | --- |
| Write | App only at `0x10000`; target SHA-256 `fe800d21d2527c36bea181e10e381982f9024ed50c3ce09e104b3ef299ead289`; esptool hash passed |
| Full read-back | 1,960,016 bytes at `/private/tmp/framer-stage3b-readback.bin`; same SHA-256; zero `cmp` differences |
| Integrity | Checksum `0xB8` and digest `5355b69b8744ad9be2046e4ca2e50d2e34add3c998d1ba766058e2ce2e9cac59` valid |
| Boot | `--after watchdog-reset`; normal `knob_f1`, `DevSrvsID:4294981265`, firmware `0.4.1` |
| Status | Profile `0`, layer `1`, battery `92%`, charging |
| Visual | User confirmed physical `Pomo` screen displayed stationary `00:42` |

The visual confirmation was obtained without starting the Timer, preserving the
bounded getter-only proof. It proves execution from the appended IROM tail
through the stock ring/formatter/cache/refresh path. It is not a selectable
WPM pet. The ring may reflect the synthetic value but was not part of the
acceptance check.

The narrow rollback target is the Stage-3A app-only image at `0x10000`, SHA-256
`088628179c760b919623288c6655449ee48734bc1a7bcadb885bd4a8d47dc24f`.
Do not write its merged convenience image at the app offset.

#### Stage-3C selectable WPM image: live image success, runtime defect

The deterministic Stage-3C image has now been written app-only, fully read
back, integrity-checked, and booted on the F1. Runtime is PARTIAL/DEFECT: ID `7`
is navigable but opens a black screen, and cycling to the first screen briefly
shows a faint `wpm` popup before it disappears. The builder starts from the
exact live-proven Stage-3B output, restores the normal Timer
getter, appends the pinned 564-byte Stage-3C ABI to the existing IROM, and
installs only the reviewed central setup wrapper. The native key callback and
500-ms WPM tick remain stock; the future idle/key wrapper stays unreferenced.

```sh
node custom-firmware/build-stage3c.mjs
node custom-firmware/tools/verify-stage3c-abi.mjs
node --test custom-firmware/test/*.test.mjs
.venv-esptool/bin/esptool image-info \
  custom-firmware/build/framer-0.4.1-stage3c-selectable-wpm-app.bin
```

| Property | Stage-3C value |
| --- | --- |
| Base | Exact Stage-3B app SHA-256 `fe800d21d2527c36bea181e10e381982f9024ed50c3ce09e104b3ef299ead289` |
| Pinned ABI | app `0x1C6D2C`, VA `0x42116D2C`, 564 bytes, SHA-256 `c661adce78963c562625ece9f647033b864c4e91816d00223c3c6b8800936003` |
| Timer getter | Restored from Stage-3B stub `0x42116D24` to stock `0x421084F4` |
| Setup hook | app `0x8C194`: `0x4202C108` → `0x42116DA8` |
| Native WPM hooks | Key callback app `0xF1568` and tick app `0x90634` unchanged |
| Image | Six segments, one IROM, 1,960,576 bytes |
| Checksum/digest | `0x8E`; `290406408428c37fdf02e7e8fac61dc10f2d6ead192840f3447853e4cc1c305b` |
| App SHA-256 | `4179b868b5a888f155fa93457c6ce9c8e57965ed5c756230dbb076fe27e910e6` |
| Merged SHA-256 | `e48aac41de808daa27addf7fd541f83bf8dc21fa6620378471dc09eb481104da` |
| Current evidence | Live app-only write, exact full read-back, valid integrity, and normal boot; runtime PARTIAL/DEFECT |

Implementation references are
[`build-stage3c.mjs`](../custom-firmware/build-stage3c.mjs), pinned
[`stage3c-wpm-abi.hex`](../custom-firmware/experimental/stage3c-wpm-abi.hex),
five-test [`stage3c.test.mjs`](../custom-firmware/test/stage3c.test.mjs), and
generated
[`stage3c-manifest.json`](../custom-firmware/build/stage3c-manifest.json).

##### Live Stage-3C record

| Field | Live result |
| --- | --- |
| Preflight | `knob_f1`, `DevSrvsID:4294981265`, firmware 0.4.1, battery 96%, charging |
| Security | Secure Boot and Flash Encryption disabled and unchanged |
| Write | App only at `0x10000`, 1,960,576 bytes; sector erase through `0x1EEFFF`; esptool hash passed |
| Post-write state | Remained in ROM bootloader for full verification |
| Full read-back | `/private/tmp/framer-stage3c-readback.bin`; SHA-256 `4179b868b5a888f155fa93457c6ce9c8e57965ed5c756230dbb076fe27e910e6`; zero `cmp` differences |
| Integrity | Checksum `0x8E`; digest `290406408428c37fdf02e7e8fac61dc10f2d6ead192840f3447853e4cc1c305b`; valid |
| Boot | `--after watchdog-reset`; no boot failure |
| Postflight | `knob_f1`, `DevSrvsID:4294982865`, firmware 0.4.1, profile `0`, layer `1`, battery 97%, charging |
| Visual | ID `7` opens black; cycling to first screen briefly shows a faint `wpm` popup, then it disappears |

The intended live visual acceptance test was deliberately narrow: navigate to
the new last dial screen, confirm the `wpm` bubble, type words separated by
spaces and observe the number change, then leave and confirm the bubble hides.
The observed black screen and misplaced transient popup fail that test.
Typing-driven changes and correct cleanup/hide remain unverified. Post-run
analysis found that the process-global bubble is consumed by stock ID `8`,
while ID `7` owned only a blank root; the popup therefore crossed screens
during unload. Do not run Input's host `v.framer.bubble` RPC concurrently
during a corrected retest.

The narrow rollback target for this future experiment is the Stage-3B app-only
image at `0x10000`, SHA-256
`fe800d21d2527c36bea181e10e381982f9024ed50c3ce09e104b3ef299ead289`.
Do not write its merged convenience image at the app offset.

#### Stage-3C.1 owned-label correction: live visual success

Stage 3C.1 replaces the global-bubble design with two LVGL labels owned by ID
`7`'s own content root. The stock slot-`1` phase creates the labels before the
screen loads; slot `3` remains the stock no-op; slot `4` clears borrowed label
pointers after root deletion; and slot `6` null-guards the value pointer before
painting native WPM every 500 ms. The appended code contains no global bubble
model/getter/updater/string-assignment addresses.

```sh
node custom-firmware/build-stage3c1.mjs
node custom-firmware/tools/verify-stage3c1-abi.mjs
node --test custom-firmware/test/*.test.mjs
.venv-esptool/bin/esptool image-info \
  custom-firmware/build/framer-0.4.1-stage3c1-wpm-owned-labels-app.bin
```

| Property | Stage-3C.1 value |
| --- | --- |
| ABI | 484 bytes at app `0x1C6D2C` / VA `0x42116D2C`; SHA-256 `f28b7b48ff43283824fcc3d440d7f591437bd1dc7b4880a7b88695a7df632712` |
| Lifecycle | Slot `1` owns labels; slot `3` no-op; slot `4` clears pointers; slot `6` null-guards/updates |
| Global bubble | No appended references |
| Image | Six segments, one IROM, 1,960,496 bytes |
| Checksum/digest | `0xB5`; `19ea7be90597720134b1bb2cf86144a6e17dc6b68b0cbf20320055139250a1c7` |
| App SHA-256 | `e2e7ba4ab4b9c247af8c0bdc3d7896ac52967bb7f90fb19beae73c0ae4a2b8fd` |
| Merged | 2,026,032 bytes; SHA-256 `461b25b181c504bf07314e2ef7786f68a24d7c202528643d66da35e5cc22ed3c` |
| Status | LIVE VISUAL SUCCESS; persistent white `wpm` and typing-driven updates user-confirmed |

The generated-image audit returned STATIC GO. Live preflight saw `knob_f1`
DevSrvsID `4294982865`, firmware `0.4.1`, profile `0`, layer `1`, and 99%
charging. ROM appeared at `/dev/cu.usbmodem83201` with the same ESP32-S3 rev
`0.2` and MAC `a4:cb:8f:af:32:10`; Secure Boot and Flash Encryption remained
disabled. The app-only 1,960,496-byte image was written at `0x10000`, erasing
`0x10000..0x1EEFFF`; esptool's write hash passed and the device stayed in ROM.
The full `/private/tmp/framer-stage3c1-readback.bin` matched the app SHA-256
above with zero byte differences, while checksum `0xB5` and digest
`19ea7be90597720134b1bb2cf86144a6e17dc6b68b0cbf20320055139250a1c7`
validated. A watchdog reset returned `knob_f1` as DevSrvsID `4294995170`,
firmware `0.4.1`, profile `0`, layer `1`, battery `99%`, charging.

References: [`build-stage3c1.mjs`](../custom-firmware/build-stage3c1.mjs),
[`stage3c1-wpm-labels.S`](../custom-firmware/experimental/stage3c1-wpm-labels.S),
[`stage3c1-wpm-labels.hex`](../custom-firmware/experimental/stage3c1-wpm-labels.hex),
[`verify-stage3c1-abi.mjs`](../custom-firmware/tools/verify-stage3c1-abi.mjs),
seven-test [`stage3c1.test.mjs`](../custom-firmware/test/stage3c1.test.mjs), and
[`stage3c1-manifest.json`](../custom-firmware/build/stage3c1-manifest.json).

The user confirmed the new ID-`7` widget works: white `wpm` text remains visible
and the value updates as expected while typing. Screen-owned labels therefore
fix the Stage-3C black view and faint cross-screen popup. Freeze this app SHA as
the Stage-3D rollback base:
`e2e7ba4ab4b9c247af8c0bdc3d7896ac52967bb7f90fb19beae73c0ae4a2b8fd`.

#### Stage 3D: live image success, runtime partial/defect

Stage 3D retains **LIVE WRITE + FULL READ-BACK + BOOT/HEALTH SUCCESS**, but
runtime is **PARTIAL/DEFECT**. The screen and text rendered; the cat did not
update. One crash/watchdog reboot occurred after the first restart and has not
repeated. Its exact cause is unknown.

The view owns four labels: ASCII cat ears, a stateful face, current `%u wpm`,
and `A%u H%u L%u`. It samples and paints every 500 ms, warms up for 20 active
samples (10 seconds), waits after 5 seconds idle, sleeps after 30 seconds, and
resets the session on the next key after 5 minutes idle. A mature new high shows
the fire state for three samples (1.5 seconds). Other states are ready,
hatching, zooming, happy, tired, and steady.

| Property | Offline Stage-3D value |
| --- | --- |
| ABI | 1,304 bytes, VA `[0x42116F10, 0x42117428)`, SHA-256 `e7788b20cd4d8733f67c96f16e7a4dfc71834f2e8a425279bf562e4fa34d6a17` |
| Hooks | Setup `0x42116FEC`; stock-first key wrapper `0x421173EC` |
| App | 1,961,808 bytes; SHA-256 `dd80791208577a1667ccd17956798d379d6e9a34f943188ac4334d045801c491` |
| Merged | 2,027,344 bytes; SHA-256 `8ffb540587b65e7e3cab72c6b19e8d47091e60df65741d6b7583bde18d5f7856` |
| Integrity | Checksum `0x8F`; digest `1f54861028022199ca9202154abdc40e0f93bc7ee42223fe280a2d4206ce6d27` |
| Layout | Six segments, one IROM |
| Rollback | Live-accepted Stage-3C.1 app SHA-256 `e2e7ba4ab4b9c247af8c0bdc3d7896ac52967bb7f90fb19beae73c0ae4a2b8fd` |
| Status | ABI STATIC GO; live image/health verified; runtime PARTIAL/DEFECT |

Preflight reported `knob_f1` DevSrvsID `4294995170`, firmware `0.4.1`, profile
`0`, layer `1`, battery `100%`, not charging. ROM appeared at
`/dev/cu.usbmodem83201` as ESP32-S3 rev `0.2`, MAC `a4:cb:8f:af:32:10`, with
security flags `0`, Secure Boot disabled, and Flash Encryption disabled. The
app-only 1,961,808-byte image was written at `0x10000`, erasing
`0x10000..0x1EEFFF`; esptool's write hash passed.

The first read mistakenly requested `0x1DEF40`, 16 bytes short. The size guard
rejected it. The corrected full read to
`/private/tmp/framer-stage3d-readback-full.bin` requested `0x1DEF50` / 1,961,808
bytes, matched SHA-256
`dd80791208577a1667ccd17956798d379d6e9a34f943188ac4334d045801c491`,
and had zero byte differences. Checksum `0x8F` and digest
`1f54861028022199ca9202154abdc40e0f93bc7ee42223fe280a2d4206ce6d27`
validated. Watchdog reset returned `knob_f1` as DevSrvsID `4295003845`, firmware
`0.4.1`, profile `0`, layer `1`, battery `100%`.

References: executable model
[`stage3d-pet-state.mjs`](../custom-firmware/lib/stage3d-pet-state.mjs) and its
[six tests](../custom-firmware/test/stage3d-pet-state.test.mjs); ABI
[`stage3d-wpm-pet.S`](../custom-firmware/experimental/stage3d-wpm-pet.S),
[`stage3d-wpm-pet.ld`](../custom-firmware/experimental/stage3d-wpm-pet.ld), and
[`stage3d-wpm-pet.hex`](../custom-firmware/experimental/stage3d-wpm-pet.hex);
[`verify-stage3d-abi.mjs`](../custom-firmware/tools/verify-stage3d-abi.mjs),
[`build-stage3d.mjs`](../custom-firmware/build-stage3d.mjs),
[`stage3d.test.mjs`](../custom-firmware/test/stage3d.test.mjs), and
[`stage3d-manifest.json`](../custom-firmware/build/stage3d-manifest.json).

The rendered Stage-3D text proved only part of that path. Its coredump and
wrong-controller lookup were later diagnosed, and Stage 3E replaced the unsafe
paths rather than treating Stage 3D as accepted.

#### Stage 3E through 3E.3A

Those Stage-3D repair items were completed by Stage 3E: it removes the global
key hook and face label, uses screen-owned immutable LVGL images, retains stock
WPM, and is **LIVE VISUAL SUCCESS** after exact write/read-back/boot proof. The
live screen establishes that LVGL's rotated logical canvas is 100×310. A
centered 100×100 sky covered logical rows `105..204`, so the middle-third result
is expected rather than a decoder failure.

Stage 3E.1 is **OFFLINE BUILT / NOT LIVE**. It uses 100×310 sky frames, a
102,944-byte asset bank (SHA-256
`e627332b347aebb736d6605aa5c7a176077ad5016b615cf148608d62cebba890`),
131,072-byte DROM pad (SHA-256
`e8b37c53dfeb68ca9e2035c391fb2909791970dcbab9eec67eb0b00941da4efe`),
and 1,280-byte ABI (SHA-256
`6842f6246ed40c0e5ddbcdc105b64e74126e7b86735c312d8c6c487b6418b05e`).
Its app SHA-256 is
`cf645558f576df17e66db14ec8636a507004f1679515dc935965cf2d55ca9b04`;
merged SHA-256 is
`787fdf452cb5b782fac13f198a820ac6aa021d82a4b61cb8e34c8bdd3dbea7b7`.
See the exact sources, layout, checksum, digest, and manifest in the
[Stage-3E.1 record](./13-stage3d-image-pipeline.md#stage-3e1--deterministic-full-canvas-milestone).

Stage 3E.2 has **STATIC/INDEPENDENT GO + LIVE WRITE/FULL READ-BACK/BOOT/HEALTH
SUCCESS; RUNTIME NO-GO**. Its six-species roster has 48
normalized frames. ID-`7`-local slot-`9` control is Fn + bottom knob: clockwise
next, counterclockwise previous. Selection is RAM-only, there is no global key
hook, and the DROM pad is `0x50000` bytes.

The 2,289,616-byte app-only write at `0x10000` erased through `0x23EFFF` and
passed its write hash. `/private/tmp/framer-stage3e2-readback.bin` matched SHA-256
`3e6b2b234ade0a3d27d14198ceeedd2a5367dfb81281db8f187aec5f8aa695c5`
with zero differing bytes; checksum `0xD7` and digest
`84411d9cedd4bf8aff9267a583f6b733bbf57423555ceadf02afaf65e6ca6659`
validated. Post-watchdog boot returned healthy firmware `0.4.1`.

Visual acceptance failed: logic/control appears alive, but pet/avatar images
are white squares. During twinkle/background switching, roughly the lower
90–100% glitches black or takes over the background. The exact boundary is now
known: sky-1 crosses `0x3C1D0000` at row `267`, column `92`, while every pet
payload begins above that original mapped-page limit. This matches the lower
13.6% corruption and white squares, making Stage 3E.2 a runtime NO-GO. See the
[Stage-3E.2 deployment record](./13-stage3d-image-pipeline.md#stage-3e2-live-deployment-record).

Stage 3E.3A reduces the experiment to one static 52×42 binary-alpha I4 cat
entirely below the boundary. Independent reconstruction returned STATIC GO.
The 2,026,624-byte app was written app-only at `0x10000`, read back completely
as `/private/tmp/framer-stage3e3a-readback.bin`, and matched SHA-256
`dd8edaaa2c3aa98a1cbdbda319255cc7d1a0e02d0069f543dd574ef040db4b83`
with zero differences. Checksum `0x40` and digest
`1f940f7663310bfae78174ab276a54b74c10617ddb68675acdad908772f1f62d`
validated; watchdog boot returned healthy `knob_f1` 0.4.1 as DevSrvsID
`4295034213`. Visual acceptance is pending: dark painted background, centered
transparent I4 cat, no white square, and no lower-screen corruption. See the
[Stage-3E.3A record](./13-stage3d-image-pipeline.md#stage-3e3a--isolated-in-page-i4-decoder-canary).

### Gates for future behavior-changing experiments

Stage 3C completed successfully without a demonstrated physical GPIO0/BOOT
route; that success is not app-independent recovery proof. Before Stage 2 or a
future crash-prone behavior-changing write, physical PCB GPIO0/BOOT plus
reset/EN should enter ROM from a healthy app and a no-write reset should return
to that app. Preserve the official app-only
restore file and the full same-device backup. For each candidate:

- pin the exact base/output hashes and changed-byte/segment manifest;
- validate the image structure, entry point, mapped ranges, checksum, digest,
  length, factory-boundary margin, and sector-rounded write range offline;
- flash only the factory-app payload at `0x10000`;
- before boot, read back the full written length, compare its hash and bytes,
  and run image validation on the read-back file;
- perform a time-bounded first boot and verify USB/HID, firmware/status/current
  screen, Clock, Timer, and navigation; and
- if normal enumeration fails, stop retrying, use the physical ROM strap, and
  restore the official 0.4.1 app before investigating the saved candidate.

Factory reset is not a boot-failure escape: it erases NVS and reboots the same
app. The physical identification procedure and ESP32-S3 timing are in the
[recovery-pad appendix](./11-recovery-pad-identification.md).

## Rollback

After regaining the ROM through the separately verified recovery route, use the
app-only restoration in
[the recovery runbook](./04-recovery-and-restore.md#app-only-restoration) first.
Use the same-device full 16 MiB dump only when app-only restoration is
insufficient or a non-app partition was changed.
