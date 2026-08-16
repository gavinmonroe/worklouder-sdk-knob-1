# Evidence and firmware findings

## Source and release audit

**Offline verified.** The public Work Louder GitHub organization exposed nine
repositories during the 2026-08-15 audit. `knob-fw-releases` publishes merged
Framer firmware binaries, but no Framer source tree, ELF, link map, board
configuration, or SDK-enabled F1 build was found. Guessed source repository
names returned no public repository.

The official SDK alpha release is explicitly labeled for Nomad v1 and ships a
merged firmware binary plus Input installers. It is not a Framer SDK image.

Useful primary links:

- [Framer F1 firmware 0.4.1 release](https://github.com/worklouder/knob-fw-releases/releases/tag/v0.4.1)
- [Work Louder SDK alpha release](https://github.com/worklouder/input-releases-internal/releases/tag/sdk-alpha-0.1)
- [Work Louder SDK documentation](https://worklouder.notion.site/sdk-docs)

This establishes that no public buildable base was found; it does not prove
that no private source exists.

## Pinned firmware artifacts

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| Official Framer 0.4.1 merged | 2,025,536 | `c8926bd181bc06062d8c79221c6bb1c7f85463f0034444f263e1995cb383b976` |
| Extracted Framer 0.4.1 app | 1,960,000 | `ee3127e3ffabb462f719ff493642592110cc7020df569e44acc50b6a5a736000` |
| Nomad E v2 0.2.0 merged reference | 4,795,600 | `cd4ec7f6f5ed661b10f1bbccd5c22008231676410772cd43d08f65f8f219ff55` |
| Stage-1 `Pomo` app | 1,960,000 | `92ea0d48bff0652df5cba789713ad1ec7c90f50ccbc88716df7bdc0bbd45c3c2` |
| Stage-1 `Pomo` merged convenience image | 2,025,536 | `5f682dd99d6424e1e5945fefe1786057947ef03938865b755744885597f7c3ae` |
| Corrected Stage-3A single-IROM canary app | 1,960,016 | `088628179c760b919623288c6655449ee48734bc1a7bcadb885bd4a8d47dc24f` |
| Corrected Stage-3A merged convenience image | 2,025,552 | `74bb0bb5d7a3f0a7421198942bbadd88f53062bed7b96d0931ac9a438769b415` |
| Stage-3B visible-canary app | 1,960,016 | `fe800d21d2527c36bea181e10e381982f9024ed50c3ce09e104b3ef299ead289` |
| Stage-3B merged convenience image | 2,025,552 | `ed172e48561a4cc2e65c889a10f3b5c65efd5d867cd8badf5e5c5d4689836c3d` |
| Stage-3C selectable-WPM app, live installed | 1,960,576 | `4179b868b5a888f155fa93457c6ce9c8e57965ed5c756230dbb076fe27e910e6` |
| Stage-3C merged convenience image, offline comparison only | 2,026,112 | `e48aac41de808daa27addf7fd541f83bf8dc21fa6620378471dc09eb481104da` |
| Stage-3C.1 owned-label correction app, live installed | 1,960,496 | `e2e7ba4ab4b9c247af8c0bdc3d7896ac52967bb7f90fb19beae73c0ae4a2b8fd` |
| Stage-3C.1 merged convenience image, offline only | 2,026,032 | `461b25b181c504bf07314e2ef7786f68a24d7c202528643d66da35e5cc22ed3c` |
| Stage-3D WPM-pet app, live installed | 1,961,808 | `dd80791208577a1667ccd17956798d379d6e9a34f943188ac4334d045801c491` |
| Stage-3D merged convenience image, offline only | 2,027,344 | `8ffb540587b65e7e3cab72c6b19e8d47091e60df65741d6b7583bde18d5f7856` |
| Stage-3E blue-cat sprite app, live visual | 2,027,312 | `546ece0044e4a69ae8db9d9a781edc776f3d1d20d82105afd9ee6de47ff01aba` |
| Stage-3E.1 full-canvas app, offline only | 2,092,848 | `cf645558f576df17e66db14ec8636a507004f1679515dc935965cf2d55ca9b04` |
| Stage-3E.2 six-species app, live installed | 2,289,616 | `3e6b2b234ade0a3d27d14198ceeedd2a5367dfb81281db8f187aec5f8aa695c5` |
| Stage-3E.2 merged convenience image, offline only | 2,355,152 | `699b85f33f53f2ad24820baf3982698b892a91d494f08f2b22dc117eb1f81951` |
| Stage-3E.3A in-page I4 canary app, live installed | 2,026,624 | `dd8edaaa2c3aa98a1cbdbda319255cc7d1a0e02d0069f543dd574ef040db4b83` |
| Stage-3E.3A merged convenience image, offline only | 2,092,160 | `2349e1317320e8d2e7d4a6291fb2211d62af1f78fb03c3bf7369f05d4d659797` |

The merged convenience images are useful for comparison. Live custom writes
have used the app-only image at `0x10000`, not the merged image.

## Rejected Stage-3A seven-segment experiment

**Offline audited NO-GO; never flash.** The first growth experiment appended a
second, seventh IROM segment to the exact live-verified Stage-1 `Pomo` image.
Its 1,960,016-byte app SHA-256 was
`487eec34d864f233decfd7dcbf038daac722a6277ebe393baeddb98b7d89500b` and
its merged SHA-256 was
`146163b2cf5396fabba29f40ca020765730c40e962ddcfe0fa5fae031b833b1f`.
Those hashes identify a rejected historical artifact, not a candidate.

The ESP checksum `0x94`, appended digest
`df4216b3dc5da49134ece9c138e4ff8c1c94b6294bd2f8db3586cac798e243ba`,
and `esptool image-info` all validated. That was insufficient: ESP-IDF 5.3.2's
bootloader emits “Image contains multiple IROM segments. Only the last one will
be mapped” and overwrites the remembered IROM mapping as it iterates. The
appended canary would therefore displace the stock executable segment. See
Espressif's official
[`bootloader_utility.c` at v5.3.2](https://github.com/espressif/esp-idf/blob/v5.3.2/components/bootloader_support/src/bootloader_utility.c).

The corrected approach grows the existing single IROM segment and shifts the
later RAM/RTC segments and footer. That replacement subsequently received
independent STRUCTURAL/LOADER GO and completed exact live
write/read-back/boot verification.

## Corrected Stage-3A single-IROM live experiment

**Structural/loader audit GO and live verified.** The replacement uses the
exact live-verified Stage-1 `Pomo` image as its base, keeps the image at six
segments with exactly one IROM, and extends existing segment 3:

| Property | Corrected value |
| --- | --- |
| IROM header/data/load | app `0xB0018` / app `0xB0020` / VA `0x42000020` |
| IROM length | `0x116CF4` → `0x116D04` |
| Canary | app `0x1C6D14`, VA `0x42116D14`, 16 bytes |
| Later segments | Segment 4/5 headers and data shift `+16`; load addresses, lengths, and bytes remain unchanged |
| Total app bytes | 1,960,016; 6,428,592 bytes remain in the factory partition |
| Checksum | app `0x1DE82F` = `0x94`, valid |
| Appended digest | app `0x1DE830` = `2b2be4605c5e7a4b21bd70d70983fbf7bbd4267bee313da4778d4a0c8b1b13fa`, valid |

No branch, literal, registry entry, or event handler references the canary, so
this tests image growth only. `esptool image-info` reports six segments and one
IROM. Independent review reproduced its hashes/mapping and gave a
STRUCTURAL/LOADER GO.

The live experiment wrote only the 1,960,016-byte app at `0x10000`; esptool's
on-device hash verification passed. A complete read-back had SHA-256
`088628179c760b919623288c6655449ee48734bc1a7bcadb885bd4a8d47dc24f`,
exactly matching the build, and `cmp` found zero differences. The read-back
checksum `0x94` and appended digest also validated. Bootloader exit used
`--after watchdog-reset`; the ROM port disappeared and the F1 re-enumerated as
`knob_f1` with device-services ID `4294979630`, firmware `0.4.1`, profile `0`,
layer `1`, battery `87%`, and charging. No new visible behavior is expected:
the 16 canary bytes are deliberately unreferenced, so the screen remains the
Stage-1 `Pomo` behavior by design.

## Stage-3B visible executable canary

**Independent STATIC GO; live and visually verified.** Stage 3B uses the
live-verified Stage-3A app as its exact base, grows the existing single IROM by
eight bytes, and appends function bytes
`36 41 00 2C A2 1D F0 00` at app offset `0x1C6D24`, VA `0x42116D24`.
The assembled function is equivalent to `entry a1, 32; movi.n a2, 42; retw.n`
plus one alignment byte.

ESP32-S3-specific little-endian assembly verification reproduces those exact
bytes. The executable `.text.stage3b_visible_canary` has no code or data
relocations. The object does contain `.rela.xt.prop` property metadata; that is
not an executable relocation and should not be summarized as a completely
relocation-free ELF.

Only the remaining-seconds getter literal changes: app `0xB1F18` (literal VA
`0x42001F18`) is redirected from stock getter `0x421084F4` to the appended
function at `0x42116D24`. Four callsites consume that shared pointer. Each
passes the Timer controller in `a10` and expects an unsigned 16-bit seconds
result:

| Consumer | VA | Pinned instruction bytes |
| --- | ---: | --- |
| Progress ring | `0x42026699` | `81 1F 6E E0 08 00` |
| Time formatter | `0x420266DA` | `81 0F 6E E0 08 00` |
| Screen-construction cache | `0x420268A5` | `81 9C 6D E0 08 00` |
| Runtime refresh | `0x42029F63` | `81 ED 5F E0 08 00` |

The construction path stores the returned 42 in the existing Timer-view cache
at view `+40`, exactly as it stores the stock getter result. That is stock view
state/cache behavior, not a mutation of the Timer controller. The
initial-duration getter, status getter, and LVGL object construction remain
stock.

Independent review reproduced all four instruction sequences and the windowed
ABI: callers supply the controller in caller `a10`; `callx8` rotates it into the
callee window, and the getter's `a2` return appears in caller `a10` as the
expected `u16` seconds. The existing indirect call has no direct-branch
displacement limit, so no trampoline is required. The eight bytes remain on the
same already-live-proven MMU page as Stage 3A; IROM page count and the six-
segment layout do not change.

The app remains 1,960,016 bytes because existing footer padding absorbs the
eight-byte extension. Its checksum is `0xB8`; appended digest is
`5355b69b8744ad9be2046e4ca2e50d2e34add3c998d1ba766058e2ce2e9cac59`.

The live experiment wrote only that app at `0x10000`; esptool's on-device hash
verification passed. Full 1,960,016-byte read-back file
`/private/tmp/framer-stage3b-readback.bin` had SHA-256
`fe800d21d2527c36bea181e10e381982f9024ed50c3ce09e104b3ef299ead289`
and `cmp` reported zero differences. `image-info` validated checksum `0xB8` and
the appended digest. Bootloader exit used `--after watchdog-reset`; the device
re-enumerated as `knob_f1` at `DevSrvsID:4294981265`, firmware `0.4.1`, profile
`0`, layer `1`, battery `92%`, charging.

The user then visually confirmed the physical `Pomo` screen showed stationary
`00:42` without starting the Timer. This is the requested proof that execution
reached the appended IROM-tail function and returned through the four stock
consumers into the existing display path. It does not create or register the
Stage-3C WPM pet. The progress ring may reflect the artificial remaining value,
but its appearance was not part of the visual acceptance criterion.

## Stage-3C selectable WPM image

**Live write/read-back/boot verified; runtime PARTIAL/DEFECT.** The
deterministic [`build-stage3c.mjs`](../custom-firmware/build-stage3c.mjs)
recreates the exact live-proven Stage-3B base, restores its Timer getter at app
`0xB1F18` to stock `0x421084F4`, appends the pinned 564-byte ABI at app
`0x1C6D2C` / VA `0x42116D2C`, and changes the central setup pointer at app
`0x8C194` to wrapper `0x42116DA8`. The stock key callback at app `0xF1568` and
native WPM tick at app `0x90634` remain unchanged. The future key wrapper is
present in the appended blob but has no pointer reference in this image.

The generated app remains at six segments with exactly one IROM mapping. Its
1,960,576-byte output has checksum `0x8E`, appended digest
`290406408428c37fdf02e7e8fac61dc10f2d6ead192840f3447853e4cc1c305b`,
and SHA-256
`4179b868b5a888f155fa93457c6ce9c8e57965ed5c756230dbb076fe27e910e6`.
The 2,026,112-byte merged comparison image has SHA-256
`e48aac41de808daa27addf7fd541f83bf8dc21fa6620378471dc09eb481104da`.
`esptool image-info` accepts the structure and integrity values.

The source ABI, pinned byte input, tests, and generated manifest are:

- [`stage3c-wpm-abi.S`](../custom-firmware/experimental/stage3c-wpm-abi.S)
- [`stage3c-wpm-abi.hex`](../custom-firmware/experimental/stage3c-wpm-abi.hex)
- [`stage3c.test.mjs`](../custom-firmware/test/stage3c.test.mjs)
- [`stage3c-manifest.json`](../custom-firmware/build/stage3c-manifest.json)

The five focused tests pin the ABI hash, one-IROM growth, restored Timer,
single setup hook, untouched WPM callbacks, later-segment bytes, final
integrity/hashes, and rejection of ABI drift.

The live record is:

| Check | Recorded result |
| --- | --- |
| Preflight | `knob_f1`, `DevSrvsID:4294981265`, firmware 0.4.1, battery 96%, charging |
| Security | Secure Boot and Flash Encryption remained disabled |
| Written range | App only: 1,960,576 bytes at `0x10000`; sector erase through `0x1EEFFF` |
| Write verification | Esptool hash passed; device remained in ROM for read-back |
| Full read-back | `/private/tmp/framer-stage3c-readback.bin`; SHA-256 `4179b868b5a888f155fa93457c6ce9c8e57965ed5c756230dbb076fe27e910e6`; zero `cmp` differences |
| Read-back integrity | Checksum `0x8E`; appended digest valid |
| Boot exit | `--after watchdog-reset`; no boot failure |
| Postflight | `knob_f1`, `DevSrvsID:4294982865`, firmware 0.4.1, profile `0`, layer `1`, battery 97%, charging |
| Runtime UI | ID `7` exists and opens, but its screen is black; cycling to the first screen briefly shows a faint `wpm` popup, then it disappears |

This fails the intended acceptance test. Registry/navigation insertion is now
live-observed because ID `7` exists, but the popup is not rendered correctly on
that screen. Typing-driven number changes were not verified. The brief
disappearance after the misplaced popup is not accepted as cleanup proof. The
runtime path needs correction before retesting. Post-run analysis identified
the ownership error described below. The Input host bubble RPC must remain off
during that proof.

## Stage-3C.1 owned-label correction

**LIVE VISUAL SUCCESS.** Independent review returned STATIC GO; exact live
write/read-back/boot passed; and the user confirmed persistent white `wpm` text
and typing-driven value updates. Stage 3C wrote the
process-global Framer bubble model, whose stock consumer belongs to controller
ID `8`. ID `7` itself owned only the blank common root. This explains the live
black ID-`7` page and the faint cross-screen bubble flash during unload/cycling.

Stage 3C.1 removes that dependency. It uses the stock slot-`1` build phase to
create a lowercase `wpm` title label and value label as children of ID `7`'s
own content root. Slot `3` remains stock no-op `0x4210882C`; slot `4` clears the
borrowed label pointers after recursive root deletion; slot `6` reads native
current WPM and updates the owned value label every 500 ms. Every periodic
paint checks the value-label pointer for null and fails soft. The appended code
contains no references to the global bubble model `0x3FCA4F00`, string assign
`0x42003DC8`, bubble getter `0x42004F10`, or updater `0x4201A930`.

The pinned ESP32-S3 little-endian ABI is 484 bytes at app `0x1C6D2C` / VA
`0x42116D2C`, with SHA-256
`f28b7b48ff43283824fcc3d440d7f591437bd1dc7b4880a7b88695a7df632712`.
The generated six-segment, one-IROM app is 1,960,496 bytes with checksum
`0xB5`, appended digest
`19ea7be90597720134b1bb2cf86144a6e17dc6b68b0cbf20320055139250a1c7`,
and SHA-256
`e2e7ba4ab4b9c247af8c0bdc3d7896ac52967bb7f90fb19beae73c0ae4a2b8fd`.
The 2,026,032-byte merged comparison image has SHA-256
`461b25b181c504bf07314e2ef7786f68a24d7c202528643d66da35e5cc22ed3c`.
`image-info` validates the structure, checksum, and digest. Independent review
reproduced the generated-image guards and returned STATIC GO.

The exact app-only image was then written to the same F1. Preflight saw
`knob_f1` DevSrvsID `4294982865`, firmware `0.4.1`, profile `0`, layer `1`, and
99% charging. ROM appeared at `/dev/cu.usbmodem83201` as the same ESP32-S3 rev
`0.2`, MAC `a4:cb:8f:af:32:10`, with Secure Boot and Flash Encryption disabled.
The 1,960,496-byte write at `0x10000` erased `0x10000..0x1EEFFF`, passed
esptool's write hash, and remained in ROM. Full read-back to
`/private/tmp/framer-stage3c1-readback.bin` had SHA-256
`e2e7ba4ab4b9c247af8c0bdc3d7896ac52967bb7f90fb19beae73c0ae4a2b8fd`
and zero byte differences. Checksum `0xB5` and digest
`19ea7be90597720134b1bb2cf86144a6e17dc6b68b0cbf20320055139250a1c7`
validated. After watchdog reset, `knob_f1` re-enumerated as DevSrvsID
`4294995170`, firmware `0.4.1`, profile `0`, layer `1`, and 99% charging.

Implementation references:

- [`build-stage3c1.mjs`](../custom-firmware/build-stage3c1.mjs)
- [`stage3c1-wpm-labels.S`](../custom-firmware/experimental/stage3c1-wpm-labels.S)
- [`stage3c1-wpm-labels.hex`](../custom-firmware/experimental/stage3c1-wpm-labels.hex)
- [`stage3c1-wpm-labels.ld`](../custom-firmware/experimental/stage3c1-wpm-labels.ld)
- [`verify-stage3c1-abi.mjs`](../custom-firmware/tools/verify-stage3c1-abi.mjs)
- [`stage3c1.test.mjs`](../custom-firmware/test/stage3c1.test.mjs)
- [`stage3c1-manifest.json`](../custom-firmware/build/stage3c1-manifest.json)

The observed owned-label widget fixes Stage 3C's black ID-`7` screen and faint
cross-screen popup: the ID-`7` content now remains visible and updates in place.
Freeze the verified app SHA-256
`e2e7ba4ab4b9c247af8c0bdc3d7896ac52967bb7f90fb19beae73c0ae4a2b8fd`
as the Stage-3D rollback base.

## Stage-3D offline pet image

**Live image/health success; runtime PARTIAL/DEFECT.** The executable state
model has six focused tests. The screen ABI owns four
labels—cat ears, stateful face, current WPM, and A/H/L—and retains the native
WPM source. Its states are ready, hatching, fire, zooming, happy, tired, steady,
waiting, and sleeping. Sampling/painting is 500 ms; warmup is 10 seconds; wait
and sleep begin at 5 and 30 seconds idle; the next key after 5 minutes resets
the session; and a mature new high celebrates for 1.5 seconds.

The ABI is 1,304 bytes at VA `[0x42116F10, 0x42117428)`, SHA-256
`e7788b20cd4d8733f67c96f16e7a4dfc71834f2e8a425279bf562e4fa34d6a17`.
Setup is `0x42116FEC`; the stock-first key wrapper is `0x421173EC`. The
six-segment, one-IROM app is 1,961,808 bytes, SHA-256
`dd80791208577a1667ccd17956798d379d6e9a34f943188ac4334d045801c491`,
checksum `0x8F`, digest
`1f54861028022199ca9202154abdc40e0f93bc7ee42223fe280a2d4206ce6d27`.
The 2,027,344-byte merged comparison image SHA-256 is
`8ffb540587b65e7e3cab72c6b19e8d47091e60df65741d6b7583bde18d5f7856`.
Rollback remains live-accepted Stage 3C.1, SHA-256
`e2e7ba4ab4b9c247af8c0bdc3d7896ac52967bb7f90fb19beae73c0ae4a2b8fd`.

Live preflight saw `knob_f1` DevSrvsID `4294995170`, firmware `0.4.1`, profile
`0`, layer `1`, battery `100%`, not charging. ROM was
`/dev/cu.usbmodem83201`, ESP32-S3 rev `0.2`, MAC `a4:cb:8f:af:32:10`, security
flags `0`, with Secure Boot and Flash Encryption disabled. The app-only
1,961,808 bytes were written at `0x10000`; erase range was
`0x10000..0x1EEFFF`, and the write hash passed.

An initial `0x1DEF40` read was 16 bytes short and correctly failed the size
check. The corrected `/private/tmp/framer-stage3d-readback-full.bin` read was
`0x1DEF50` / 1,961,808 bytes, matched the app SHA above, and had zero byte
differences. Checksum `0x8F` and the appended digest validated. Watchdog reset
returned healthy `knob_f1`, DevSrvsID `4295003845`, firmware `0.4.1`, profile
`0`, layer `1`, battery `100%`.

Evidence: [`stage3d-pet-state.mjs`](../custom-firmware/lib/stage3d-pet-state.mjs),
[`stage3d-pet-state.test.mjs`](../custom-firmware/test/stage3d-pet-state.test.mjs),
[`stage3d-wpm-pet.S`](../custom-firmware/experimental/stage3d-wpm-pet.S),
[`stage3d-wpm-pet.ld`](../custom-firmware/experimental/stage3d-wpm-pet.ld),
[`stage3d-wpm-pet.hex`](../custom-firmware/experimental/stage3d-wpm-pet.hex),
[`verify-stage3d-abi.mjs`](../custom-firmware/tools/verify-stage3d-abi.mjs),
[`build-stage3d.mjs`](../custom-firmware/build-stage3d.mjs),
[`stage3d.test.mjs`](../custom-firmware/test/stage3d.test.mjs), and
[`stage3d-manifest.json`](../custom-firmware/build/stage3d-manifest.json).

Runtime observation was narrower: the screen and text rendered, but the cat did
not update. One crash/watchdog reboot occurred after the first restart and did
not repeat. Subsequent coredump decoding identified `wl_lvgl`
`StoreProhibited` at `EXCVADDR=0xEE` in the label-copy path, while separate
analysis proved the key hook used the wrong singleton. Stage 3E removes both
paths and uses screen-owned images. Its exact app was live-written, read back,
booted healthy, and user-confirmed on-screen: **LIVE VISUAL SUCCESS**. The live
logical canvas is 100×310; this explains why a centered 100×100 sky covered
only the middle third. Stage 3E.1 is the deterministic offline 100×310
full-canvas follow-up. Stage 3E.2 has exact live write/read-back/boot/health
success, but runtime is a NO-GO. Its sky-1 payload crosses the original mapped
DROM boundary `0x3C1D0000` at row `267`, column `92`, exactly matching the
bottom 13.6% corruption; every pet payload begins above the boundary, matching
the white squares. Stage 3E.3A therefore keeps one static I4 cat entirely at
`0x3C1C1190..0x3C1C162C`. It received independent STATIC GO, was written and
read back exactly at the app hash above, and booted healthy as 0.4.1. Visual
acceptance is still pending. See
[the Stage-3E record](./13-stage3d-image-pipeline.md).

## Live hardware and security inventory

**Live verified on the attached unit.** The following came from esptool 5.2.0
while the F1 was in its serial bootloader:

| Property | Observed value |
| --- | --- |
| Bootloader port | `/dev/cu.usbmodem83201` for this session |
| Chip | ESP32-S3 QFN56 revision 0.2 |
| CPU | Dual-core plus low-power core, 240 MHz |
| Crystal | 40 MHz |
| Embedded PSRAM | 2 MiB |
| Flash | 16 MiB, quad I/O, detected at 3.3 V |
| USB | USB Serial/JTAG available |
| Device MAC | `a4:cb:8f:af:32:10` |
| Security-info flags | `0` |
| Secure Boot | Disabled |
| Flash Encryption | Disabled |
| `SPI_BOOT_CRYPT_CNT` | `0` |
| Key blocks | Empty |
| `DIS_USB_SERIAL_JTAG` | `False` — peripheral not disabled |
| `DIS_USB_SERIAL_JTAG_DOWNLOAD_MODE` | `False` — USB download not disabled |
| `DIS_USB_OTG_DOWNLOAD_MODE` | `False` — OTG download not disabled |

The disabled protections mean a correctly formed unsigned replacement app can
boot and a raw flash backup can be restored to this same unit. They do not make
an arbitrary firmware image hardware-compatible.

## Partition layout

**Offline verified from the official image.** The live full-flash capture will
be used to reconfirm it before writing.

| Label | Offset | Size | Purpose |
| --- | ---: | ---: | --- |
| Partition table | `0x8000` | `0x1000` | ESP partition descriptors |
| `phy_init` | `0xF000` | `0x1000` | PHY initialization data |
| `factory` | `0x10000` | `0x800000` | Main application partition |
| `nvs` | `0x810000` | `0x20000` | Persistent configuration |
| `fs` | `0x830000` | `0x200000` | Application filesystem data |
| `coredump` | `0xA30000` | `0x10000` | Crash dump storage |

Filesystem subtype `0x82` is historically called SPIFFS in ESP-IDF partition
tables, but an application may mount the bytes with LittleFS. Preserve the raw
partition and do not rename its actual format based only on the subtype.

## Completed live recovery set

**Live verified.** The full 16 MiB read completed at 115200 baud and was
finalized here:

```text
recovery/backups/2026-08-15-framer-f1-a4cb8faf3210-before-custom/
```

| Capture | Bytes | SHA-256 |
| --- | ---: | --- |
| Full flash | 16,777,216 | `aa6042310d075c9cbd3b992044511c064bb4b84713d0740a3adafcbdb3028fdd` |
| Factory partition | 8,388,608 | `cf0f0f0213a84535ffabbb2f93e2931ac7e7af3930af8b287b43936e718c5d2f` |
| NVS | 131,072 | `8d8bb8219483cae0e41daaeb59f4a165601307bdd36438c8915098a72a22e994` |
| Filesystem | 2,097,152 | `f3b64790eeb7bad0687b0ff2a11707755013fc20149c79b90c20dee338008cd0` |
| Coredump | 65,536 | `71189f7fb6aed638640078fba3a35fda6c39c8962e74dcc75935aac948da9063` |

The first 2,025,536 bytes match the official 0.4.1 merged image exactly. The
saved `SHA256SUMS.txt` verifies all 17 captured binaries, reports, manifest, and
restore reference. NVS and filesystem bytes are sensitive and remain ignored by
Git.

## Application image information

**Offline verified with `esptool image-info`.** The app is project
`nomad-e-fw`, version `0.4.1`, built with ESP-IDF `5.3.2.250210`. The internal
project name is shared history, not evidence that a Nomad image is safe on a
Framer.

| Segment | Length | Load address | File offset | Kind |
| ---: | ---: | ---: | ---: | --- |
| 0 | `0xA1170` | `0x3C120020` | `0x18` | DROM |
| 1 | `0x05A60` | `0x3FCA4F00` | `0xA1190` | DRAM |
| 2 | `0x09418` | `0x40374000` | `0xA6BF8` | IRAM |
| 3 | `0x116CF4` | `0x42000020` | `0xB0018` | IROM |
| 4 | `0x179E4` | `0x4037D418` | `0x1C6D14` | IRAM |
| 5 | `0x00108` | `0x600FE000` | `0x1DE700` | RTC memory |

The official image has a valid XOR checksum and appended SHA-256 validation
hash. The stage-1 builder repairs both after changing the screen heading and esptool
validates the new checksum `0xA6` and new appended digest.

## Why the missing widgets are not simply hidden

**Offline verified.** Framer 0.4.1 contains a native Timer controller and a
linked Pomodoro-like state object, but no visible Pomodoro view, navigation
registration, or installable package. It does not contain the Nomad
`media_player`, app-switcher, quick-app, or last-widget controllers, and it
lacks the MicroPython/`wlsdk` runtime expected by the SDK alpha's packages.

Generic notification strings such as `POMODORO_*` also occur in the F1 image.
Strings and a linked state machine still do not establish a usable widget: the
stock image has no matching visible view/registry wiring or installable bundle.

## Linked but unwired Pomodoro-like controller

**Strong offline reverse-engineering evidence; pending live invocation and
final Nomad comparison.** Framer 0.4.1 contains a singleton-like object at BSS
`0x3FCAE1E8` with a coherent Pomodoro state machine:

| Evidence | Address or offset |
| --- | --- |
| Constructor | `0x4202BB54` |
| Getter | `0x4202BBAC` |
| Reset routine | `0x4201A968` |
| Phase transition | `0x4201A984` |
| Tick/decrement logic | around `0x4201A9CC` |
| Remaining-time field | object `+28` |
| Cycle field | object `+34` |
| Target cycles | object `+35`, initialized to `4` |
| Work/rest durations | object `+36` and `+40` |
| Mode field | object `+44` |

Overall initialization calls the getter/reset path at `0x4202C058`, so the code
is linked and initialized rather than dead padding. No visible screen,
navigation entry, or input path has been found wired to it. “Pomodoro-like” is
therefore the careful current name until live invocation and a final Nomad
implementation comparison confirm its intended identity.

The current adapter design and exact proposed byte map are documented in the
[stage-2 candidate appendix](./09-stage2-patch-candidate.md). Its independent
static audit is GO; it is not yet a flashed or runtime-verified image.

## Framer bubble semantics

**Live and offline verified.** The `v.framer.bubble` handler stores this
RAM-backed model:

| Field | Type | Meaning |
| --- | --- | --- |
| `l` | string | First/label line |
| `v` | string | Second/value line |
| `d` | byte boolean | Show the 8×8 status dot when `1` |
| `s` | byte boolean | Show when `1`, hide when `0` |

Missing parameters retain their previous values. Every call resets a hardcoded
10-second expiry. The firmware does not parse or decrement the displayed time.

Useful offline addresses in Framer 0.4.1:

- RPC handler: `0x42005B60`
- RAM model: `0x3FCA4F00`
- UI update/deadline reset: `0x4201A930`
- expiry check: `0x42014F08`
- renderer: `0x4201DDDC`

## Native Timer heading trail

**Offline verified.** The raw `Timer` field is at app file offset `0x5AE0` and
maps to DROM `0x3C125AE0`. Literal VA `0x42002110` (app file offset `0xB2110`)
resolves that DROM address. Visible-label callsite `0x4202A096` (`0xDA096` in
the original app file) passes it to label text setter `0x4204EE30`. This
confirms the field supplies the visible Timer screen heading rather than an
unreferenced/dead string. The flashed app and normal boot now prove the path at
the firmware level; the unchanged patched heading was later visually confirmed
on live Stage 3B.

## Live stage-1 app experiment

**Live verified.** The experiment targeted device MAC
`a4:cb:8f:af:32:10`; its security state remained unchanged with Secure Boot
and Flash Encryption disabled. The standalone Stage-1 run was not separately
visually recorded, but its unchanged heading patch was later observed on the
live Stage-3B derivative.

| Check | Recorded result |
| --- | --- |
| Written flash range | `0x10000` through `0x1EE840` (end exclusive) |
| Payload scope | Factory app only; 1,960,000 bytes |
| Written/read-back SHA-256 | `92ea0d48bff0652df5cba789713ad1ec7c90f50ccbc88716df7bdc0bbd45c3c2` |
| Read-back comparison | Full 1,960,000 bytes; `cmp` reported zero differences |
| Esptool write verification | Passed |
| ESP app checksum | `0xA6`, valid |
| ESP appended digest | `a6d53fb5ab814fd35ee45078bc1eb3d898f3591cad98fa69587ae3cc489be344`, valid |
| Bootloader exit | `--after watchdog-reset` succeeded; USB RTS `run` left the chip in ROM |
| Normal re-enumeration | `knob_f1`, firmware `0.4.1` |
| Reported power status | Battery 80%, charging |
| Visible `Pomo` heading | User-confirmed on live Stage-3B derivative, which preserves the Stage-1 heading bytes |

No bootloader, partition-table, NVS, filesystem, or coredump range was written.
This proves our exact custom app bytes flash, verify, read back, boot, and retain
normal device identity/status. The later Stage-3B observation separately proves
that the preserved heading patch reaches the physical display.

The guarded read-only post-boot check is
[`recovery/verify-live-firmware.mjs`](../recovery/verify-live-firmware.mjs). It
uses Input's installed SDK, requires exactly one USB-connected F1, and reads
only firmware version, device status, and current screen.

## Live app-independent recovery probe

**Live verified failure.** With the Stage-1 app booted normally, macOS IOUSB
identified `Framer F1` as custom HID: VID `12346`/`0x303A`, PID
`33686`/`0x8396`, and serial `A4CB8FAF3210`. PySerial found only the Mac's
Bluetooth/debug-console entries and no F1 TTY. This filtered probe:

```sh
esptool \
  --port-filter vid=12346 --port-filter pid=33686 \
  --before usb-reset --after no-reset \
  chip-id
```

found zero serial ports and could not connect. The USB-download eFuses are
enabled, but normal Framer firmware does not present the serial endpoint that
`usb-reset` needs. Combined with the static finding that the only Bootloader
screen selector is the running-app RPC, physical PCB GPIO0/BOOT plus reset/EN
is the only remaining app-independent recovery candidate. It is not yet
located or live-proven.

## Serial reliability finding

**Live verified.** Full reads at 921600 and 460800 baud failed after roughly the
first 4 KiB with serial noise. A 64 KiB read at 115200 succeeded, and the saved
prefix matched the official merged 0.4.1 bytes for that range. The complete
16 MiB backup then finished and verified at 115200.

This is a device/cable/session observation, not a universal Framer limit. The
runbook nevertheless defaults live recovery work for this unit to the known
reliable 115200 rate.

## Native WPM tracker and future widget opportunity

**Offline firmware evidence.** Stock F1 0.4.1 contains
`worklouder::kb::extra::middlewares::kb_stats` and NVS namespace
`wl_kb_stats` with key `wpm_record`. The callback treats USB HID keycode `0x2C`
(Space) as a completed word and increments the half-second word counter; other
keys do not contribute words. A 500,000-microsecond timer updates a words-per-
minute estimate using:

```text
instant = completed_words_in_tick * 120
smoothed = 0.9 * previous + 0.1 * instant
```

The routine persists a new maximum as a `uint16` and clears the word counter for
the next half-second window. Useful static addresses are Space/event callback
`0x4206EAE0`, timer update `0x4206ED14`, NVS path `0x4206EB48`, and the
`wpm_record` literal at `0x42041590` resolving to DROM `0x3C12E7B4`.
The static tracker object is BSS `0x3FCAB9E0`: its `u16` half-second word
counter is object `+62` (`0x3FCABA1E`) and its live smoothed WPM is a `float` at
object `+64` (`0x3FCABA20`). The cached `u16` record and initialization flag are
at `0x3FCAE930` and `0x3FCAE932`.

**Live backup evidence.** Parsing the active NVS backup found
`wpm_record = 0x007A`, or decimal `122`. This is the persistent record in this
device's backup, not a factory default or a snapshot of current WPM.

**Current limitation/inference.** No WPM RPC or Input consumer has been found,
so a Mac-hosted extension cannot safely read the current native estimate through
the known SDK. A future device-resident WPM widget can potentially reuse or
bridge the existing tracker instead of reimplementing keystroke accounting.
The deterministic model, pet-state rules, commands, tests, and native-widget
plan are in [the WPM pet guide](./10-wpm-pet-widget.md).

**Offline reference only.** Nomad E v2 0.2.0 has a newer `kb_telemetry`
component with set/reset and diagnostic strings that are absent from Framer's
older `kb_stats`. It is useful for behavioral comparison, not binary-code or
cross-flash portability.
