# Framer F1 native custom firmware

This directory is the staged path to a persistent, device-resident Pomodoro.
It modifies the official Framer 0.4.1 factory app while preserving the stock
bootloader, partition table, NVS, and LittleFS data.

## Stage 1: persistent native-widget proof

The first build changes the built-in Timer screen heading from `Timer` to
`Pomo`. The heading is referenced at IROM `0x4202a096` and passed to the label
text setter at `0x4204ee30`, so this is a persistent visual proof rather than a
dead string edit. This intentionally tiny patch proves all of the risky
mechanics before changing controller code:

- the exact official input image is hash-pinned;
- the target bytes must still contain the expected original value;
- the app length and partition layout do not change;
- the ESP XOR checksum and appended SHA-256 digest are regenerated;
- tests reject any unexpected changed byte.

Build and validate it offline:

```sh
node custom-firmware/build-stage1.mjs
node --test custom-firmware/test/*.test.mjs
.venv-esptool/bin/esptool image-info \
  custom-firmware/build/framer-0.4.1-stage1-pomo-app.bin
```

The stage-1 app was flashed only at factory-app offset `0x10000` after the full
16 MiB backup and security/eFuse report were verified. Its complete read-back
matched the build and the F1 booted normally. Stage 3B preserved the Stage-1
heading bytes, and the user later confirmed `Pomo` on that live derivative;
the standalone Stage-1 image was not separately visually recorded. The Input
RPC cannot recover a nonbooting app, and static analysis found no independent
front-panel bootloader path. A live filtered `usb-reset` probe also found no F1
serial port under normal firmware, only custom HID, so physical PCB GPIO0/BOOT
plus reset/EN access remains the recovery prerequisite for Stage 2. Stage 1 is
not a completed Pomodoro: countdown behavior remains the original Timer.

No automatic flasher is included here. Any further live write remains a
deliberate, reviewed recovery-gated step.

## Stage 2: native Pomodoro candidate

`build-stage2.mjs` adapts the visible Timer view to the dormant Framer
focus/break controller using only same-length in-place patches. It fixes the
work/rest periods at 25/5 minutes, keeps the existing target of four cycles,
and adds Timer-compatible start, pause, resume, reset, remaining-time, and
status adapters in the old getter body after rerouting that getter.

```sh
node custom-firmware/build-stage2.mjs
node --test custom-firmware/test/*.test.mjs
.venv-esptool/bin/esptool image-info \
  custom-firmware/build/framer-0.4.1-stage2-pomodoro-app.bin
```

The build is guarded by the official merged-image hash, the original bytes at
all nine patch ranges, and independently derived final checksum, appended
digest, and merged-image hash. An independent static audit gave GO after
checking all nine ranges, control flow, field adapters, and hashes; no static
crash defect was found. The complete backup also passes. A live Stage-2 write
is now gated on verified physical PCB GPIO0/BOOT plus reset/EN access. The
heading stays `Focus` during breaks, and state does not survive reboot. The
break number should count down from `05:00`, but the ring retains a 1500-second denominator and therefore
starts near 20%; no phase-transition notification or beep is added. All of
those behaviors remain runtime-unproven until the image is tested on the F1.

## Stage 3A: controlled-growth canary

The first implementation appended a seventh, second IROM segment. Independent
review marked it **REJECTED/NO-GO; never flash it**. ESP-IDF 5.3.2 maps only the
last IROM segment, so the added canary could displace the stock executable
mapping despite a valid image checksum, digest, and `esptool image-info` report.
The rejected app SHA-256 begins `487eec34…` and the rejected merged SHA-256
begins `146163b2…`; treat those as denylist/history markers.

The corrected builder now grows the existing single IROM segment by 16
unreferenced bytes and shifts later segments/footer. It retains six segments;
its app SHA-256 is
`088628179c760b919623288c6655449ee48734bc1a7bcadb885bd4a8d47dc24f`
and merged SHA-256 is
`74bb0bb5d7a3f0a7421198942bbadd88f53062bed7b96d0931ac9a438769b415`.
Independent audit gave STRUCTURAL/LOADER GO. The image was then flashed
app-only, fully read back with the same app hash and zero differences, and
booted normally as `knob_f1` on firmware 0.4.1. Its bytes are unreferenced, so
this proves growth/mapping only, not execution from the new tail. Stage 3C has
since written/read back exactly and booted normally without a demonstrated
physical GPIO0 route; that remains a recovery risk for future crash-prone
images. The loader finding comes from Espressif's official
[`bootloader_utility.c` at ESP-IDF 5.3.2](https://github.com/espressif/esp-idf/blob/v5.3.2/components/bootloader_support/src/bootloader_utility.c).

```sh
node custom-firmware/build-stage3a.mjs
node --test custom-firmware/test/*.test.mjs
.venv-esptool/bin/esptool image-info \
  custom-firmware/build/framer-0.4.1-stage3a-segment-canary-app.bin
```

## Stage 3B: visible appended-code canary

Stage 3B has **independent STATIC GO and is verified live and visually**. It
appends an assembled eight-byte getter at app `0x1C6D24` / VA
`0x42116D24`, then redirects only the Timer remaining-seconds getter literal at
app `0xB1F18` from `0x421084F4` to that function. The getter returns constant
`42`; it does not mutate timer state or construct UI objects.

```sh
node custom-firmware/build-stage3b.mjs
node custom-firmware/tools/verify-stage3b-assembly.mjs
node --test custom-firmware/test/*.test.mjs
.venv-esptool/bin/esptool image-info \
  custom-firmware/build/framer-0.4.1-stage3b-visible-canary-app.bin
```

The verifier requires the ESP32-S3-specific little-endian
`xtensa-esp32s3-elf-as`, `objdump`, and `objcopy` tools. Do not substitute the
generic `xtensa-esp-elf-*` frontend: it emits big-endian ELF and will misencode
future `.long` address literals even though Stage 3B's instruction-only bytes
happen to match. The executable `.text` has no code/data relocations;
`.rela.xt.prop` metadata exists but is not executable relocation content. Stage
3C must retain this tool-name guard.

The live/read-back app SHA-256 is
`fe800d21d2527c36bea181e10e381982f9024ed50c3ce09e104b3ef299ead289`;
merged SHA-256 is
`ed172e48561a4cc2e65c889a10f3b5c65efd5d867cd8badf5e5c5d4689836c3d`.
Checksum `0xB8` and appended digest
`5355b69b8744ad9be2046e4ca2e50d2e34add3c998d1ba766058e2ce2e9cac59`
validate offline.

All four shared-getter consumers—ring `0x42026699`, formatter `0x420266DA`,
construction cache `0x420268A5`, and refresh `0x42029F63`—pass the controller in
`a10` and expect `u16` seconds. The construction path stores 42 in the stock
view cache at `+40`; the getter does not mutate controller state.

The app-only write and complete read-back matched the app hash with zero byte
differences, and normal 0.4.1 boot succeeded. The user visually confirmed
heading `Pomo` with stationary value `00:42` without starting the Timer. Stage
3B therefore proves appended-code execution through the stock display path; it
is not the selectable WPM pet.

Independent review reproduced all four consumers, the windowed `callx8` getter
ABI, same-MMU-page mapping, integrity values, and final hashes. The ring may
reflect the synthetic remaining value but was not part of the visual proof.
App-only rollback uses the Stage-3A image at `0x10000`, SHA-256
`088628179c760b919623288c6655449ee48734bc1a7bcadb885bd4a8d47dc24f`.

## Stage 3C: live-installed selectable WPM screen candidate

Stage 3C has **live write/read-back/boot success but a PARTIAL/DEFECT runtime
result**. The deterministic builder consumes the pinned ABI hex, starts from the exact
live-proven Stage-3B output, restores the Timer getter, appends the reviewed
code to the existing single IROM, and changes only the central setup pointer.
The machine-checked candidate allocates a 112-byte
controller, installs an eleven-word writable vtable in its RAM tail, registers
unused ID `7`, and appends `7` to physical navigation. The traced stock
lifecycle supplies lazy root construction, activation, a 100-ms LVGL refresh
timer, deactivation, and timer teardown. The candidate leaves the native
500-ms `kb_stats` callback at `0x4206ED14` unchanged; its UI refresh reads the
native EWMA float at `0x3FCABA20` from LVGL context and divides the timer down
to one bubble publication every 500 ms.

The dial handler at `0x4202924C` reloads the navigation vectors and computes
their live length on each event; it does not cache the stock count at boot.
The append helper at `0x420293A8`, both vector windows, and the selected-ID call
are byte-pinned and mutation-tested. This makes post-setup ID insertion a
verified code path. Live navigation confirms ID `7` exists, but its screen
behavior failed acceptance.

The ESP32-S3 little-endian artifact is 564 bytes with SHA-256
`c661adce78963c562625ece9f647033b864c4e91816d00223c3c6b8800936003`.
Its source, pinned hex, linker layout, symbols, literal pool, executable
relocations, and hash are verified before the image is accepted:

```sh
node custom-firmware/build-stage3c.mjs
node custom-firmware/tools/verify-stage3c-abi.mjs
node --test custom-firmware/test/*.test.mjs
.venv-esptool/bin/esptool image-info \
  custom-firmware/build/framer-0.4.1-stage3c-selectable-wpm-app.bin
```

The 1,960,576-byte app has SHA-256
`4179b868b5a888f155fa93457c6ce9c8e57965ed5c756230dbb076fe27e910e6`;
the 2,026,112-byte merged comparison image has SHA-256
`e48aac41de808daa27addf7fd541f83bf8dc21fa6620378471dc09eb481104da`.
It retains six segments and one IROM; checksum `0x8E` and appended digest
`290406408428c37fdf02e7e8fac61dc10f2d6ead192840f3447853e4cc1c305b`
validate. Five Stage-3C tests pin the appended ABI, setup hook, restored
Timer getter, untouched native callbacks, shifted segment bytes, image hashes,
and fail-closed ABI drift behavior.

| Live check | Recorded result |
| --- | --- |
| Preflight | `knob_f1`, `DevSrvsID:4294981265`, firmware 0.4.1, battery 96%, charging |
| Security | Secure Boot and Flash Encryption remained disabled |
| Write | App only, 1,960,576 bytes at `0x10000`; erased through `0x1EEFFF`; esptool hash passed |
| Bootloader state | Remained in ROM after write for read-back |
| Full read-back | `/private/tmp/framer-stage3c-readback.bin`; exact app SHA-256; zero `cmp` differences |
| Read-back integrity | Checksum `0x8E` and appended digest valid |
| Boot | `--after watchdog-reset`; no boot failure |
| Postflight | `knob_f1`, `DevSrvsID:4294982865`, firmware 0.4.1, profile `0`, layer `1`, battery 97%, charging |
| Visual WPM behavior | PARTIAL/DEFECT: ID `7` opens black; cycling to the first screen briefly shows a faint `wpm` popup, then it disappears |

The intended acceptance was: navigate to the new last dial screen, confirm a
`wpm` bubble, type words separated by spaces and observe the number change,
then leave and confirm the bubble hides. The observed black ID-`7` screen and
brief faint popup on the first screen do not satisfy it. Typing updates and
correct cleanup remain unverified pending a fix. Do not run the Input host
bubble RPC during future retests.

See the [native WPM screen design](../docs/12-wpm-pet-native-view.md) for the
exact lifecycle and remaining limitations. The image is installed and booting,
but the widget is explicitly not visually accepted.

## Stage 3C.1: accepted live owned-label correction

Stage 3C.1 received an independent **STATIC GO** and the exact app-only image
was written, fully read back, integrity-checked, and booted successfully. The
user then confirmed that the new ID-`7` widget works: white `wpm` text remains
visible and its number updates as expected while typing. The screen-owned label
design fixes Stage 3C's black screen and misplaced faint popup.
Post-run analysis found that Stage 3C wrote the process-global bubble consumed
by stock ID `8`, while ID `7` owned only a blank root. The faint popup therefore
crossed screens during unload instead of rendering as ID-`7` content.

The correction creates two labels beneath ID `7`'s own content root during the
stock slot-`1` build phase. Slot `3` stays the stock no-op. Slot `4` clears the
borrowed label pointers after root-owned recursive deletion, and slot `6`
updates the owned value label every 500 ms from native WPM. A null pointer guard
makes a failed value-label allocation skip painting. The ABI contains no global
bubble model, getter, updater, or string-assignment references.

```sh
node custom-firmware/build-stage3c1.mjs
node custom-firmware/tools/verify-stage3c1-abi.mjs
node --test custom-firmware/test/*.test.mjs
.venv-esptool/bin/esptool image-info \
  custom-firmware/build/framer-0.4.1-stage3c1-wpm-owned-labels-app.bin
```

| Property | Stage-3C.1 value |
| --- | --- |
| ABI | 484 bytes at app `0x1C6D2C` / VA `0x42116D2C` |
| ABI SHA-256 | `f28b7b48ff43283824fcc3d440d7f591437bd1dc7b4880a7b88695a7df632712` |
| Setup wrapper | `0x42116DA4` |
| Lifecycle | Slot `1` builds owned labels; slot `3` stock no-op; slot `4` clears pointers; slot `6` null-guards and paints |
| Global bubble | No appended references |
| Image | Six segments, one IROM, 1,960,496 bytes |
| Checksum/digest | `0xB5`; `19ea7be90597720134b1bb2cf86144a6e17dc6b68b0cbf20320055139250a1c7` |
| App SHA-256 | `e2e7ba4ab4b9c247af8c0bdc3d7896ac52967bb7f90fb19beae73c0ae4a2b8fd` |
| Merged image | 2,026,032 bytes; SHA-256 `461b25b181c504bf07314e2ef7786f68a24d7c202528643d66da35e5cc22ed3c` |
| Status | LIVE VISUAL SUCCESS; persistent white `wpm` and typing-driven updates user-confirmed |

Live record for the same F1:

| Step | Verified result |
| --- | --- |
| Preflight | `knob_f1`, DevSrvsID `4294982865`, firmware `0.4.1`, profile `0`, layer `1`, battery `99%`, charging |
| ROM bootloader | `/dev/cu.usbmodem83201`; ESP32-S3 rev `0.2`; MAC `a4:cb:8f:af:32:10`; Secure Boot and Flash Encryption disabled |
| Write | App-only 1,960,496 bytes at `0x10000`; erase range `0x10000..0x1EEFFF`; esptool write hash passed; device remained in ROM |
| Read-back | `/private/tmp/framer-stage3c1-readback.bin`; SHA-256 `e2e7ba4ab4b9c247af8c0bdc3d7896ac52967bb7f90fb19beae73c0ae4a2b8fd`; byte comparison found zero differences |
| Image validation | Checksum `0xB5` and appended digest `19ea7be90597720134b1bb2cf86144a6e17dc6b68b0cbf20320055139250a1c7` valid |
| Boot/postflight | Watchdog reset; `knob_f1` re-enumerated as DevSrvsID `4294995170`, firmware `0.4.1`, profile `0`, layer `1`, battery `99%`, charging |

Sources and evidence are
[`build-stage3c1.mjs`](./build-stage3c1.mjs),
[`stage3c1-wpm-labels.S`](./experimental/stage3c1-wpm-labels.S),
[`stage3c1-wpm-labels.hex`](./experimental/stage3c1-wpm-labels.hex),
[`stage3c1-wpm-labels.ld`](./experimental/stage3c1-wpm-labels.ld),
[`verify-stage3c1-abi.mjs`](./tools/verify-stage3c1-abi.mjs),
[`stage3c1.test.mjs`](./test/stage3c1.test.mjs), and
[`stage3c1-manifest.json`](./build/stage3c1-manifest.json).

Stage 3C.1 is the frozen rollback base for Stage 3D. Use only its app-only
image, SHA-256
`e2e7ba4ab4b9c247af8c0bdc3d7896ac52967bb7f90fb19beae73c0ae4a2b8fd`,
for that rollback target.

## Stage 3D: pet, statistics, and idle states

Stage 3D retains **LIVE WRITE + FULL READ-BACK + BOOT/HEALTH SUCCESS**, but its
runtime result is **PARTIAL/DEFECT**. The screen and text rendered; the cat did
not update. One crash/watchdog reboot occurred after the first restart and has
not repeated. Do not infer a root cause from that single event.

```sh
node custom-firmware/tools/verify-stage3d-abi.mjs
node custom-firmware/build-stage3d.mjs
node --test custom-firmware/test/stage3d-pet-state.test.mjs \
  custom-firmware/test/stage3d.test.mjs
.venv-esptool/bin/esptool image-info \
  custom-firmware/build/framer-0.4.1-stage3d-wpm-pet-app.bin
```

| Property | Offline Stage-3D value |
| --- | --- |
| State-model evidence | Executable JavaScript specification; 6 focused model tests |
| Labels | ASCII cat ears; stateful face; current `%u wpm`; `A%u H%u L%u` |
| Pet states | Ready, hatching, fire, zooming, happy, tired, steady, waiting, sleeping |
| Timing | 500-ms sample/paint; 10-s warmup; wait at 5 s; sleep at 30 s; reset on the next key after 5 min idle; 1.5-s new-high celebration |
| ABI | 1,304 bytes, VA `[0x42116F10, 0x42117428)`, SHA-256 `e7788b20cd4d8733f67c96f16e7a4dfc71834f2e8a425279bf562e4fa34d6a17` |
| Hooks | Setup wrapper `0x42116FEC`; key wrapper `0x421173EC`, which calls the stock handler first |
| Image | Six segments, one IROM, 1,961,808-byte app; checksum `0x8F`; digest `1f54861028022199ca9202154abdc40e0f93bc7ee42223fe280a2d4206ce6d27` |
| App SHA-256 | `dd80791208577a1667ccd17956798d379d6e9a34f943188ac4334d045801c491` |
| Merged image | 2,027,344 bytes; SHA-256 `8ffb540587b65e7e3cab72c6b19e8d47091e60df65741d6b7583bde18d5f7856` |
| Rollback | Stage-3C.1 app SHA-256 `e2e7ba4ab4b9c247af8c0bdc3d7896ac52967bb7f90fb19beae73c0ae4a2b8fd` |
| Status | ABI STATIC GO; live image/health verified; runtime PARTIAL/DEFECT |

Live record for the same F1:

| Step | Verified result |
| --- | --- |
| Preflight | `knob_f1`, DevSrvsID `4294995170`, firmware `0.4.1`, profile `0`, layer `1`, battery `100%`, not charging |
| ROM bootloader | `/dev/cu.usbmodem83201`; ESP32-S3 rev `0.2`; MAC `a4:cb:8f:af:32:10`; security flags `0`; Secure Boot and Flash Encryption disabled |
| Write | App-only 1,961,808 bytes at `0x10000`; erase range `0x10000..0x1EEFFF`; esptool write hash passed |
| Guardrail caught | First read requested `0x1DEF40`, 16 bytes short; the size check rejected it rather than accepting a partial read-back |
| Correct read-back | `/private/tmp/framer-stage3d-readback-full.bin`, `0x1DEF50` / 1,961,808 bytes; SHA-256 `dd80791208577a1667ccd17956798d379d6e9a34f943188ac4334d045801c491`; byte comparison found zero differences |
| Image validation | Checksum `0x8F` and digest `1f54861028022199ca9202154abdc40e0f93bc7ee42223fe280a2d4206ce6d27` valid |
| Boot/postflight | Watchdog reset; `knob_f1` re-enumerated as DevSrvsID `4295003845`, firmware `0.4.1`, profile `0`, layer `1`, battery `100%` |

Sources and evidence:
[`stage3d-pet-state.mjs`](./lib/stage3d-pet-state.mjs),
[`stage3d-pet-state.test.mjs`](./test/stage3d-pet-state.test.mjs),
[`stage3d-wpm-pet.S`](./experimental/stage3d-wpm-pet.S),
[`stage3d-wpm-pet.ld`](./experimental/stage3d-wpm-pet.ld),
[`stage3d-wpm-pet.hex`](./experimental/stage3d-wpm-pet.hex),
[`verify-stage3d-abi.mjs`](./tools/verify-stage3d-abi.mjs),
[`build-stage3d.mjs`](./build-stage3d.mjs),
[`stage3d.test.mjs`](./test/stage3d.test.mjs), and
[`stage3d-manifest.json`](./build/stage3d-manifest.json).

Observed runtime: the ID-`7` screen and text rendered, but the cat did not
update. One crash/watchdog reboot occurred after the first restart; it has not
repeated. Current/A/H/L changes, pet moods, 5-second wait, 30-second sleep, and
reliable re-entry are not accepted.

Stage 3D's two defects are now separated. The stuck ready face came from using
the navigation manager at `0x3FCAB378` as a controller registry. The captured
core records `StoreProhibited`, `EXCVADDR=0xEE`, in the label string-copy path
immediately after the face update. Stage 3C.1 remains the rollback.

## Stage 3E: live visual native blue-cat sprite

Stage 3E has independent **STATIC GO** plus exact live app-only
write/read-back/boot success and **LIVE VISUAL SUCCESS**. It
rebuilds exact live Stage 3C.1, leaves the stock key callback and native WPM
tick in place, appends one 64-KiB DROM page containing two 100×100 skies and
eight 68×56 blue-cat frames, and appends a 1,272-byte S3 ABI to the existing
single IROM. ID `7` owns the sky image, cat image, WPM label, and A/H/L label.

```sh
node custom-firmware/tools/verify-stage3e-abi.mjs
node --test custom-firmware/test/*.test.mjs
node custom-firmware/build-stage3e.mjs
```

| Property | Stage-3E value |
| --- | --- |
| ABI | 1,272 bytes at VA `0x42116F10`; SHA-256 `e96498a5a7dde80dff9bd043554463a5b48b28ebc5d87091bc625afb52f405f3` |
| Assets | 60,944-byte native bank; 65,536-byte padded DROM page |
| Image layout | Six segments, one DROM ending `0x3C1D1190`, one IROM ending `0x42117408` |
| App | 2,027,312 bytes; SHA-256 `546ece0044e4a69ae8db9d9a781edc776f3d1d20d82105afd9ee6de47ff01aba` |
| Merged | 2,092,848 bytes; SHA-256 `aed65c609fa5317921b0c06c081876ef504788aa3868d43f6e5c8781301b6f1d` |
| Integrity | Checksum `0x51`; digest `dee6f1b159886c1a878debd247c21907c2dd4499573a16f8aa4f9ce72e8a79f7` |
| Tests | Current firmware suite 97/97 plus all Stage 3B–3E.3A ABI verifiers |
| Status | Static/independent GO; exact app-only write/read-back/boot and user visual acceptance passed |

The first sprite build has no global key hook. A rising stock WPM float is its
activity signal; ten non-rising 500-ms samples wait and sixty sleep. After
twenty samples, current within 90% of the session high zooms, a below-average
current is tired, and a new mature high shows fire for three samples. Label
text/color calls are cached and changed labels are re-centered to reduce the
Stage-3D crash surface.

Live preflight reported `knob_f1` DevSrvsID `4295022895`, firmware `0.4.1`,
profile `0`, layer `1`, battery `100%`, not charging. The same ESP32-S3/MAC
`a4:cb:8f:af:32:10` had Secure Boot and Flash Encryption disabled. The exact
2,027,312-byte app was written at `0x10000`, with sector erase ending
`0x1FEFFF`; the write hash passed and the unit stayed in ROM. The successful
retry read-back, `/private/tmp/framer-stage3e-wpm-sprite-readback2.bin`,
completed in 178.7 seconds, matched the app size/SHA byte-for-byte, and passed
six-segment/one-DROM/one-IROM, checksum, and digest validation. An earlier
read-back process had hung and was terminated without producing a file.
Watchdog reset returned healthy `knob_f1` as DevSrvsID `4295024385`, firmware
`0.4.1`, profile `0`, layer `1`, battery `100%`, not charging. The user then
confirmed the rendered Stage-3E result. The live geometry proves LVGL exposes
the rotated screen as logical 100×310: a centered 100×100 sky filled only the
middle third, as expected from that coordinate system.

Sources and evidence:
[`build-stage3e.mjs`](./build-stage3e.mjs),
[`stage3e-wpm-sprite.S`](./experimental/stage3e-wpm-sprite.S),
[`verify-stage3e-abi.mjs`](./tools/verify-stage3e-abi.mjs),
[`stage3e.test.mjs`](./test/stage3e.test.mjs), and
[`stage3e-manifest.json`](./build/stage3e-manifest.json).

## Stage 3E.1: offline deterministic full canvas

Stage 3E.1 is **OFFLINE BUILT / NOT LIVE**. It replaces the 100×100 skies with
100×310 skies while retaining the centered 68×56 blue cat and top/bottom labels.
The 102,944-byte asset bank SHA-256 is
`e627332b347aebb736d6605aa5c7a176077ad5016b615cf148608d62cebba890`;
its 131,072-byte DROM pad SHA-256 is
`e8b37c53dfeb68ca9e2035c391fb2909791970dcbab9eec67eb0b00941da4efe`.
The 1,280-byte ABI SHA-256 is
`6842f6246ed40c0e5ddbcdc105b64e74126e7b86735c312d8c6c487b6418b05e`.
The 2,092,848-byte app SHA-256 is
`cf645558f576df17e66db14ec8636a507004f1679515dc935965cf2d55ca9b04`;
the 2,158,384-byte merged SHA-256 is
`787fdf452cb5b782fac13f198a820ac6aa021d82a4b61cb8e34c8bdd3dbea7b7`.
Checksum is `0x66`; digest is
`98af4d78e8f77cd6508b6dd87c6238d45cdfe15445f7a67e81eb4b001d0e7995`.

References: [`build-stage3e1.mjs`](./build-stage3e1.mjs),
[`stage3e1-wpm-full-canvas.S`](./experimental/stage3e1-wpm-full-canvas.S),
[`stage3e1-wpm-full-canvas.ld`](./experimental/stage3e1-wpm-full-canvas.ld),
[`stage3e1-wpm-full-canvas.hex`](./experimental/stage3e1-wpm-full-canvas.hex),
[`verify-stage3e1-abi.mjs`](./tools/verify-stage3e1-abi.mjs),
[`stage3e1-full-canvas.test.mjs`](./test/stage3e1-full-canvas.test.mjs),
[`stage3e1.test.mjs`](./test/stage3e1.test.mjs), and
[`stage3e1-manifest.json`](./build/stage3e1-manifest.json).

## Stage 3E.2: six selectable species

Stage 3E.2 has **STATIC/INDEPENDENT GO + LIVE WRITE/FULL READ-BACK/BOOT/HEALTH
SUCCESS; RUNTIME NO-GO**. Roster order is
Belgian Tervuren, Pepe, Angry owl, Cute ferret, Cat, and Lazy cow. The generated
bank has 48 normalized 68×56 RGBA source frames. ID-`7`-local vtable slot `9`
control is Fn + bottom knob: clockwise selects the next species and
counterclockwise the previous. Selection is RAM-only, defaults to Cat (index
4), and there is no global key hook. Slot 9 changes only controller RAM; the
dispatcher's immediate slot-6 callback repaints the selected descriptor.

| Property | Stage-3E.2 value |
| --- | --- |
| Converted assets | 50 descriptors; manifest SHA-256 `5688fcebf05cace46cea79b5bc8684cc352426f9b23777e5e75a3c905f923524` |
| Native/padded bank | 297,184 bytes SHA-256 `e06ba6d81e6f3dab82798cbf3edcfd1307740eedbd27a7bb48adbe3958e86a13`; `0x50000` bytes SHA-256 `21e30977cea669ebe74ddc85a7ecbefc4954070f320d7dc5db25ab34292e9dfd` |
| ABI | 1,440 bytes; SHA-256 `705866dae8a2968a69bbbda33e38c9bfec3760019149c6b266909e67d0a3b66f` |
| App | 2,289,616 bytes; SHA-256 `3e6b2b234ade0a3d27d14198ceeedd2a5367dfb81281db8f187aec5f8aa695c5` |
| Merged | 2,355,152 bytes; SHA-256 `699b85f33f53f2ad24820baf3982698b892a91d494f08f2b22dc117eb1f81951` |
| Integrity | Checksum `0xD7`; digest `84411d9cedd4bf8aff9267a583f6b733bbf57423555ceadf02afaf65e6ca6659` |
| Layout | Six segments; DROM end `0x3C211190`; IROM end `0x421174B0` |
| Verification | S3 little-endian, zero relocations; 13/13 focused tests; 97/97 firmware suite |

Roster/frame evidence:
[`wpm-pet-species-frames-v1/manifest.json`](../framer-widgets/assets/wpm-pet-species-frames-v1/manifest.json).
Builder/ABI evidence:
[`build-stage3e2.mjs`](./build-stage3e2.mjs),
[`stage3e2-wpm-species.S`](./experimental/stage3e2-wpm-species.S),
[`verify-stage3e2-abi.mjs`](./tools/verify-stage3e2-abi.mjs), and
[`stage3e2.test.mjs`](./test/stage3e2.test.mjs).

The 2,289,616-byte app-only image was written at `0x10000`, erasing through
`0x23EFFF`; esptool's write hash passed. Full read-back
`/private/tmp/framer-stage3e2-readback.bin` matched the app size and SHA-256
above, and `cmp` found zero differences. Checksum `0xD7` and the digest above
validated. Watchdog reset returned healthy `knob_f1` as DevSrvsID `4295032152`,
firmware `0.4.1`, profile `0`, layer `1`, battery `100%`, not charging.

Runtime observation failed visual acceptance. Logic/control appears alive, but
pet/avatar images render as white squares. During twinkle/background switching,
roughly the lower 90–100% glitches black or takes over the background. Do not
claim full-canvas or species success. The cause is now exact: sky-1 begins at
`0x3C1C9758` and crosses the original DROM mapping boundary `0x3C1D0000`
after 26,792 pixels, row `267`, column `92`; every pet payload begins at or
above `0x3C1D1070`. That matches the lower 13.6% corruption and white squares.
Stage 3E.2 is a runtime NO-GO.

## Stage 3E.3A: isolated in-page I4 decoder canary

Stage 3E.3A has **INDEPENDENT STATIC GO + LIVE WRITE/FULL READ-BACK/BOOT/HEALTH
SUCCESS; VISUAL ACCEPTANCE PENDING**. It paints an opaque dark root and creates
one centered, screen-owned 52×42 binary-alpha I4 cat. There is no source
switch, full-canvas sky, species control, cache drop, or global key hook. Its
1,180-byte native bank occupies only `0x3C1C1190..0x3C1C162C`, leaving 59,860
bytes before the empirically usable boundary.

| Property | Stage-3E.3A value |
| --- | --- |
| ABI | 580 bytes at `0x42116F10`; SHA-256 `13cc66c1d97616af9c3efa535133fb3b40e1a509eabe6bb5b62342c6f19f3f6d` |
| App | 2,026,624 bytes; SHA-256 `dd8edaaa2c3aa98a1cbdbda319255cc7d1a0e02d0069f543dd574ef040db4b83` |
| Merged | 2,092,160 bytes; SHA-256 `2349e1317320e8d2e7d4a6291fb2211d62af1f78fb03c3bf7369f05d4d659797` |
| Integrity | Checksum `0x40`; digest `1f940f7663310bfae78174ab276a54b74c10617ddb68675acdad908772f1f62d` |
| Verification | Clean-room reconstruction exact; five focused tests; 97/97 firmware suite |

The app-only write at `0x10000` erased through `0x1FEFFF` and passed the write
hash. `/private/tmp/framer-stage3e3a-readback.bin` matched the app size/hash
above with zero differences, and watchdog reset returned healthy `knob_f1`
0.4.1 as DevSrvsID `4295034213`, profile `0`, layer `1`, battery `100%`, not
charging. Visual acceptance still requires a dark background with a centered
transparent cat, no white square, and no lower-screen glitch.

Builder/evidence:
[`build-stage3e3a.mjs`](./build-stage3e3a.mjs),
[`stage3e3a-i4-canary.S`](./experimental/stage3e3a-i4-canary.S),
[`verify-stage3e3a-abi.mjs`](./tools/verify-stage3e3a-abi.mjs), and
[`stage3e3a.test.mjs`](./test/stage3e3a.test.mjs).

The Stage-3E live visual app remains the prior image-track rollback, SHA-256
`546ece0044e4a69ae8db9d9a781edc776f3d1d20d82105afd9ee6de47ff01aba`.
The exact Stage-3C.1 app remains the smaller accepted recovery baseline,
SHA-256
`e2e7ba4ab4b9c247af8c0bdc3d7896ac52967bb7f90fb19beae73c0ae4a2b8fd`.
