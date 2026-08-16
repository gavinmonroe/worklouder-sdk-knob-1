# Native WPM pet: segment growth and real-screen design

## Outcome of the registry audit

Framer 0.4.1 does not use a fixed compile-time switch for its screens. It owns
screen-controller objects in a heap-backed vector, orders them by a virtual
screen-ID method, and keeps physical dial navigation in a second dynamic
integer vector. This makes a genuine additional WPM screen feasible without
deleting Clock or Timer.

The stock image has controller ID `0`, IDs `2` through `6`, and IDs `8` through
`25`; only IDs `1` and `7` are unused. ID `7` is the proposed WPM pet ID. The
stock physical-navigation order is:

```text
8, 22, 16, 17, 3, 15, 14, 19, 18
```

Appending `7` to that list would leave the default screen and all existing
entries unchanged. It would not make a new card appear in Input's desktop
catalog; the desktop catalog and the device's physical screen registry are
separate systems.

The append is also safe at the reviewed navigation code-path level. Function
`0x420293A8` appends the ID to manager vectors `+36` and `+48` and sets its
enabled byte to `1`. On every dial event, handler `0x4202924C` reloads the
`+36`/`+40` begin/end pointers, computes the current length, reads the current
ID, consults the enabled vector at `+48`, and only then calls the selected-ID
setter. It does not retain a boot-time count that would ignore or overrun the
new entry. Both instruction windows are byte-pinned and mutation-tested by the
registry audit. This is strong offline evidence, not a live ID-`7` selection.

The registry evidence is machine-checked by
[`framer-registry-audit.mjs`](../custom-firmware/lib/framer-registry-audit.mjs)
and
[`framer-registry-audit.test.mjs`](../custom-firmware/test/framer-registry-audit.test.mjs).
The audit fails closed if the reviewed firmware bytes, WPM hooks, controller
vtable ABI, or navigation calls differ. The current Stage-3C assembly is
independently assembled, linked, disassembled, and byte-pinned by
[`verify-stage3c-abi.mjs`](../custom-firmware/tools/verify-stage3c-abi.mjs).
The exact ABI is now consumed by a deterministic image builder, but the
screen behavior remains distinct from image evidence: the app is now live-
installed and boots normally, but runtime is PARTIAL/DEFECT. ID `7` opens black;
a faint `wpm` popup appears briefly only after cycling to the first screen.
Post-run analysis identified the ownership mismatch: the process-global bubble
consumer belongs to stock ID `8`, while ID `7` had only a blank root.

## Verified native ABI

| Item | Address / layout |
| --- | ---: |
| Central screen/controller setup | `0x4202BCC0` |
| Add controller object to ordered vector | `0x4204DA84` |
| Add screen ID to dial-navigation vector | `0x420293A8` |
| Screen-manager singleton | `0x42006888` |
| Set selected ID | `0x4210AF1C`, stores `u16` at manager `+24` |
| Get current controller | `0x4210AF48`, loads pointer at manager `+12` |
| Root registry pointer | root object `+80`; manager caches it at `+32` |
| Native WPM key callback | `0x4206EAE0` |
| Native 500-ms WPM update | `0x4206ED14` |
| Current EWMA float | `0x3FCABA20` |
| Cached lifetime record | `0x3FCAE930` (`u16`) |

Every reviewed controller vtable has eleven 32-bit entries. The common
lifecycle is no longer inferred from method names; its dispatch has been traced
instruction by instruction:

- `0x4210AF04` lazily calls slot `0` when controller byte `+4` is clear, then
  returns the controller's root LVGL object at `+8`.
- The screen transition at `0x4204D8D4` calls slot `1`, then loads that root.
- LVGL event `42` reaches `0x4204D6EC`, which calls slot `2`.
- Common slot `2`, `0x4204D694`, creates a 100-ms LVGL timer, calls slot `3`
  once, then calls slot `6` once.
- The timer callback at `0x4204D680` loads its controller from timer user data
  `+12` and dispatches slot `6`.
- LVGL event `43` reaches common slot `5`, `0x4204D6D0`, which calls slot `4`
  and deletes the timer.

The selectable-number proof therefore uses this vtable:

| Vtable slot | Candidate |
| ---: | --- |
| `0` | Common lazy root construction, `0x4204D5DC` |
| `1` | Stock no-op, `0x4210AEFC` |
| `2` | Common activation/timer setup, `0x4204D694` |
| `3` | Appended WPM bubble activation |
| `4` | Appended WPM cleanup/hide function |
| `5` | Common deactivation/timer teardown, `0x4204D6D0` |
| `6` | Appended WPM LVGL-thread refresh |
| `7` | Stock no-op, `0x42108834` |
| `8` | Appended constant-ID getter returning `7` |
| `9` | Stock no-op, `0x4210883C` |
| `10` | Stock no-op, `0x42108844` |

The offline wrapper allocates and zeroes a 112-byte object. Bytes `+0..+27` are
the verified common base, bytes `+28..+63` are reserved for WPM/session state,
and bytes `+64..+107` hold an eleven-word writable vtable. Keeping the vtable in
heap RAM avoids pretending appended IROM is readable through the data bus and
avoids growing DROM. The wrapper performs the stock base-vtable/type-`10`
initialization, installs the RAM vtable, adds the object through `0x4204DA84`,
then adds ID `7` through `0x420293A8`. No new BSS or RAM image segment is needed.

## One mapped IROM, extended in place

Do not add another IROM segment. ESP-IDF's bootloader mapping path treats the
last mapped IROM segment as authoritative, so a seventh IROM record could
replace the stock mapping instead of extending it. The safe layout is the one
used by Stage 3A: grow existing segment `3`, then shift the later RAM/RTC
segment records and footer while preserving their load addresses and bytes.

The fixed mapping rules are:

- ESP32-S3 IROM is `0x42000000 <= address < 0x44000000`.
- The existing IROM header stays at app offset `0xB0018`.
- Its data stays at app offset `0xB0020`, load address `0x42000020`.
- File data offset and mapped address remain congruent modulo `0x10000`.
- The original length is `0x116CF4`; its old end and first append address are
  `0x42116D14`, app offset `0x1C6D14`.
- Every extension is 4-byte aligned. Code entry points and the vtable/literal
  pool should also be 4-byte aligned.
- The ESP XOR checksum, 16-byte footer alignment, and appended SHA-256 digest
  are regenerated after later segment records move.
- The complete app, plus its sector-rounded write range, stays below the
  factory partition end at flash `0x810000`.

The Stage-1 baseline app is `0x1DE840` bytes and has `0x6217C0` bytes of raw
factory headroom. The live-proven Stage-3A app is `0x1DE850` bytes and has
`0x6217B0` raw bytes left. Stage 3B advances the logical IROM end by eight bytes,
but existing footer padding absorbs them, so its live-read app also remains
`0x1DE850` bytes with `0x6217B0` raw headroom. After rounding its write to a
4-KiB sector the usable margin remains `0x621000`. The IROM virtual window has
much more room
(`0x1EE92EC` bytes at the old end), so the 8-MiB factory partition is the
effective limit.

The live-read Stage-3C image grows that app to `0x1DEA80` bytes and leaves
`0x621580` raw bytes in the factory partition. It still rounds within the same
write-sector boundary, leaving `0x621000` sector margin. The complete live
read-back matches that layout and the generated app hash.

The current text-only Stage-3C ABI candidate occupies exactly 564 appended
bytes: a 124-byte literal pool and 440-byte text section. Runtime cost is one
112-byte controller allocation, allocator overhead, a bounded eight-byte stack
format buffer, and any short-string allocation made by the existing bubble
model. It needs no sprite buffer and makes no additional NVS writes.

## Three gated images

### A — unreferenced IROM-extension canary: verified live, nonvisual

Stage 3A extends the existing IROM with an unreachable 16-byte marker. No
instruction, literal, registry entry, or event handler points to it. This proves
image growth, checksum/digest repair, shifted RAM records, flash-length handling,
and normal boot before custom code can execute.

### B — callable visible canary: verified live and visually

The Stage-3B builder takes a smaller route than the earlier startup-wrapper
design. It appends an eight-byte windowed Xtensa function at VA `0x42116D24`
(app `0x1C6D24`) that returns integer `42`, then changes only the existing
remaining-seconds getter literal at app `0xB1F18` from `0x421084F4` to that new
function. No setup call, registry entry, bubble object, Timer state, or LVGL
object is added or changed.

The shared getter pointer has four byte-pinned consumers: progress ring
`0x42026699`, formatter `0x420266DA`, screen-construction cache `0x420268A5`,
and runtime refresh `0x42029F63`. All pass the controller in `a10` and expect a
`u16` seconds value. Construction stores the returned 42 in the existing view
cache at `+40`; this is stock view behavior, not controller-state mutation.

The exact image was written app-only, read back byte-for-byte, integrity-
validated, and booted normally. The user then confirmed the stock Timer screen
with its Stage-1 `Pomo` heading displayed stationary `00:42` without starting
the timer. This proves execution from appended IROM through the stock display
path; it still registers no new screen.

### C — selectable native WPM number: live image success, runtime defect

Stage 3C cannot reuse Stage 3B's narrow getter hook as a registration mechanism.
It has a separately assembled setup wrapper that calls the complete stock setup
first, then registers the new ID-`7` controller and appends `7` to physical
navigation. ID `7` is added last and the wrapper never selects it at boot.

The deterministic builder begins from the exact live-proven Stage-3B layout and
restores the remaining-seconds literal at app `0xB1F18` (virtual
`0x42001F18`) from the Stage-3B stub address back to stock `0x421084F4` before
repairing image integrity. The proven eight-byte return-42 stub remains in IROM
but becomes unreachable. Stage-3C literals then start immediately afterward at
`0x42116D2C`; this restores the normal Timer while retaining the proven tail
layout.

Only one Stage-3C entry patch is applied:

1. Change the setup vtable word at app `0x8C194` from `0x4202C108` to the
   appended setup wrapper.

The kb-stats vtable word at app `0x90634` remains stock `0x4206ED14`. Native
WPM continues updating float `0x3FCABA20` every 500 ms. The active controller's
verified 100-ms LVGL timer reads that float and renders from the UI context.
This removes the earlier cross-thread bubble/string mutation risk and preserves
the entire stock stats path unchanged. The key-callback literal at app
`0xF1568` also remains stock `0x4206EAE0`; the number-only proof does not consume
idle state, so it needs no global keyboard-middleware hook.

For the first selectable proof, the controller is designed to render through the already
linked Framer bubble renderer. It writes the existing two strings and booleans,
then calls the same device-side update path as `v.framer.bubble`; no Mac or host
transport is involved. Slot `6` counts the verified 100-ms UI ticks but publishes
only every fifth call, matching the native 500-ms WPM cadence without copying
and signaling the global bubble ten times per second. The intended result was
to keep the stock ten-second TTL alive and display the latest native value, with
the cleanup hook hiding the bubble on exit. Live behavior did not satisfy that
design: ID `7` was navigable but black, and only after cycling to the first
screen did a faint `wpm` popup appear briefly and disappear. The exact
relocation-free `elf32-xtensa-le` artifact is 564 bytes with SHA-256
`c661adce78963c562625ece9f647033b864c4e91816d00223c3c6b8800936003`.
Its six function addresses, literal words, section addresses/sizes, windowed
return registers, and binary hash are pinned by the verifier. One of those six
functions is an unreferenced key-wrapper ABI exercise reserved for Stage 3D; a
Stage-3C image must not point the stock key callback at it.

[`build-stage3c.mjs`](../custom-firmware/build-stage3c.mjs) consumes the pinned
[`stage3c-wpm-abi.hex`](../custom-firmware/experimental/stage3c-wpm-abi.hex)
and produces a 1,960,576-byte app plus a 2,026,112-byte merged comparison
image. The app SHA-256 is
`4179b868b5a888f155fa93457c6ce9c8e57965ed5c756230dbb076fe27e910e6`;
the merged SHA-256 is
`e48aac41de808daa27addf7fd541f83bf8dc21fa6620378471dc09eb481104da`.
Checksum `0x8E` and appended digest
`290406408428c37fdf02e7e8fac61dc10f2d6ead192840f3447853e4cc1c305b`
validate, and `image-info` reports six segments with one IROM. Five focused
tests in [`stage3c.test.mjs`](../custom-firmware/test/stage3c.test.mjs) pin this
layout and fail closed on ABI drift.

The live experiment wrote only the 1,960,576-byte app at `0x10000`, erasing
through sector end `0x1EEFFF`. Esptool's write hash passed. The device remained
in ROM while `/private/tmp/framer-stage3c-readback.bin` captured the full app;
its SHA-256 matched the build and `cmp` found zero differences. Checksum `0x8E`
and the appended digest validated on the read-back. `--after watchdog-reset`
then returned normal `knob_f1` at `DevSrvsID:4294982865`, firmware 0.4.1,
profile `0`, layer `1`, battery 97%, charging. Preflight was
`DevSrvsID:4294981265`, battery 96%, charging; Secure Boot and Flash Encryption
remained disabled. No boot failure occurred.

This candidate is designed as a selectable, host-free live-WPM-number proof,
not the completed pet. Its image is installed and booting, and ID `7` insertion
is now live-observed. The black view and misplaced transient popup fail visual
acceptance. Typing-driven value changes and correct cleanup/hide behavior were
not verified. A corrected version should address the observed rendering/timing
defect. Stage 3C.1 now replaces the global overlay with dedicated LVGL labels
owned by ID `7`. Its generated image received independent STATIC GO, its exact
bytes were written/read back/booted, and the user confirmed persistent white
`wpm` text plus typing-driven value updates. A later pet can build on that
accepted screen-owned label lifecycle.

### C.1 — self-owned WPM labels: live visual success

The live symptom and offline ownership trail agree: Stage 3C updated the
process-global bubble model rendered under stock ID `8`; ID `7`'s common root
contained no widget. Unloading/cycling exposed the faint cross-screen flash.
Stage 3C.1 removes all appended references to the global bubble model, string
assignment, bubble getter, and bubble updater.

The correction uses the verified stock lifecycle differently:

- Slot `0` still lazily creates ID `7`'s root/content container.
- Slot `1` builds a lowercase `wpm` title and numeric value label as children
  of that content root, using the stock Timer-title label helpers.
- Slot `3` is restored to stock no-op `0x4210882C`.
- Slot `4` clears the two borrowed label pointers after recursive root deletion.
- Slot `6` reads native WPM every 500 ms and updates the owned value label;
  every paint null-checks that pointer and fails soft.

The 484-byte ESP32-S3 little-endian ABI begins at app `0x1C6D2C` / VA
`0x42116D2C` and has SHA-256
`f28b7b48ff43283824fcc3d440d7f591437bd1dc7b4880a7b88695a7df632712`.
The deterministic app remains six segments/one IROM, is 1,960,496 bytes, and
has SHA-256
`e2e7ba4ab4b9c247af8c0bdc3d7896ac52967bb7f90fb19beae73c0ae4a2b8fd`.
Checksum `0xB5` and digest
`19ea7be90597720134b1bb2cf86144a6e17dc6b68b0cbf20320055139250a1c7`
validate. The 2,026,032-byte merged comparison image has SHA-256
`461b25b181c504bf07314e2ef7786f68a24d7c202528643d66da35e5cc22ed3c`.
`image-info` is valid and independent generated-image review returned STATIC
GO.

Live preflight saw `knob_f1` DevSrvsID `4294982865`, firmware `0.4.1`, profile
`0`, layer `1`, battery `99%`, charging. ROM appeared at
`/dev/cu.usbmodem83201` as ESP32-S3 rev `0.2`, MAC `a4:cb:8f:af:32:10`, with
Secure Boot and Flash Encryption disabled. The app-only 1,960,496-byte image
was written at `0x10000`, erasing `0x10000..0x1EEFFF`; esptool's write hash
passed and the device remained in ROM. Full read-back to
`/private/tmp/framer-stage3c1-readback.bin` matched the app SHA-256 above with
zero byte differences; checksum `0xB5` and the appended digest validated.
Watchdog reset returned normal `knob_f1` as DevSrvsID `4294995170`, firmware
`0.4.1`, profile `0`, layer `1`, battery `99%`, charging.

Implementation: [`build-stage3c1.mjs`](../custom-firmware/build-stage3c1.mjs),
[`stage3c1-wpm-labels.S`](../custom-firmware/experimental/stage3c1-wpm-labels.S),
[`stage3c1-wpm-labels.hex`](../custom-firmware/experimental/stage3c1-wpm-labels.hex),
[`verify-stage3c1-abi.mjs`](../custom-firmware/tools/verify-stage3c1-abi.mjs),
[`stage3c1.test.mjs`](../custom-firmware/test/stage3c1.test.mjs), and
[`stage3c1-manifest.json`](../custom-firmware/build/stage3c1-manifest.json).

The user confirmed that the new ID-`7` widget works: white lowercase `wpm` text
remains visible and its value updates as expected while typing. This accepts the
screen-owned-label correction and closes Stage 3C's black-page/faint-popup
defect. Freeze the verified Stage-3C.1 app SHA-256
`e2e7ba4ab4b9c247af8c0bdc3d7896ac52967bb7f90fb19beae73c0ae4a2b8fd`
as the rollback base for Stage 3D.

## Stage 3D — on-device pet semantics

**Live image/health success; runtime PARTIAL/DEFECT.** The executable state
specification and six focused tests pin session,
statistics, mood, and idle semantics. The ABI builds four screen-owned labels:
ASCII cat ears, a stateful face, current `%u wpm`, and `A%u H%u L%u`.

| Property | Offline Stage-3D evidence |
| --- | --- |
| ABI | 1,304 bytes at VA `[0x42116F10, 0x42117428)`; SHA-256 `e7788b20cd4d8733f67c96f16e7a4dfc71834f2e8a425279bf562e4fa34d6a17` |
| Hooks | Setup wrapper `0x42116FEC`; stock-first key wrapper `0x421173EC` |
| App | 1,961,808 bytes; SHA-256 `dd80791208577a1667ccd17956798d379d6e9a34f943188ac4334d045801c491` |
| Merged | 2,027,344 bytes; SHA-256 `8ffb540587b65e7e3cab72c6b19e8d47091e60df65741d6b7583bde18d5f7856` |
| Integrity/layout | Checksum `0x8F`; digest `1f54861028022199ca9202154abdc40e0f93bc7ee42223fe280a2d4206ce6d27`; six segments, one IROM |
| Rollback | Live-accepted Stage-3C.1 app SHA-256 `e2e7ba4ab4b9c247af8c0bdc3d7896ac52967bb7f90fb19beae73c0ae4a2b8fd` |
| Live status | Exact app-only write/read-back and healthy 0.4.1 boot verified; screen/text rendered; cat did not update; one non-repeated crash/watchdog reboot |

Live preflight reported `knob_f1` DevSrvsID `4294995170`, firmware `0.4.1`,
profile `0`, layer `1`, battery `100%`, not charging. ROM appeared at
`/dev/cu.usbmodem83201` as ESP32-S3 rev `0.2`, MAC `a4:cb:8f:af:32:10`, with
security flags `0`, Secure Boot disabled, and Flash Encryption disabled. The
app-only 1,961,808 bytes were written at `0x10000`; esptool erased
`0x10000..0x1EEFFF` and its write hash passed.

The first read requested `0x1DEF40`, exactly 16 bytes short, and was rejected by
the size check. The corrected full read,
`/private/tmp/framer-stage3d-readback-full.bin`, requested `0x1DEF50` /
1,961,808 bytes. Its SHA-256 matched
`dd80791208577a1667ccd17956798d379d6e9a34f943188ac4334d045801c491`
and byte comparison found zero differences. Checksum `0x8F` and digest
`1f54861028022199ca9202154abdc40e0f93bc7ee42223fe280a2d4206ce6d27`
were valid. After watchdog reset, `knob_f1` re-enumerated as DevSrvsID
`4295003845`, firmware `0.4.1`, profile `0`, layer `1`, battery `100%`.

The key wrapper provides real idle activity; native Space processing remains
the only source of WPM. The UI refresh is 100 ms, while statistics and paint
run every fifth refresh to match the native 500-ms cadence. The offline image
changes the key-callback literal at app `0xF1568` from `0x4206EAE0` to
`0x421173EC`. The wrapper calls the stock callback first, obtains the current
controller through `0x4210AF48`, confirms ID `7` through vtable slot `8`, and
touches only controller RAM.

- Warmup: 20 half-second sample ticks (10 seconds) before extrema are trusted.
- Waiting: 50 UI ticks (5 seconds) without a pressed-key event.
- Sleeping: 300 UI ticks (30 seconds) idle.
- Session reset: the next pressed key after 3,000 UI ticks (5 minutes) idle.
- Average/high/low: mature active half-second samples; idle zeros are excluded.
- Fire: three half-second sample ticks after a mature new high.
- Zooming: current at least 90% of session high.
- Happy: current at or above average.
- Tired: current within 10% of session low.
- Persistent `wpm_record`: displayed separately if desired; never reset or
  rewritten by the pet.

ASCII faces avoid unverified emoji glyph coverage. The first value line should
remain compact, for example `(^.^) 72 A65 H92 L41`.

Sources: executable model
[`stage3d-pet-state.mjs`](../custom-firmware/lib/stage3d-pet-state.mjs) and
[`stage3d-pet-state.test.mjs`](../custom-firmware/test/stage3d-pet-state.test.mjs);
ABI source/link/artifact
[`stage3d-wpm-pet.S`](../custom-firmware/experimental/stage3d-wpm-pet.S),
[`stage3d-wpm-pet.ld`](../custom-firmware/experimental/stage3d-wpm-pet.ld), and
[`stage3d-wpm-pet.hex`](../custom-firmware/experimental/stage3d-wpm-pet.hex);
[`verify-stage3d-abi.mjs`](../custom-firmware/tools/verify-stage3d-abi.mjs),
[`build-stage3d.mjs`](../custom-firmware/build-stage3d.mjs),
[`stage3d.test.mjs`](../custom-firmware/test/stage3d.test.mjs), and
[`stage3d-manifest.json`](../custom-firmware/build/stage3d-manifest.json).

Runtime observation:

- the ID-`7` screen and text rendered;
- the cat did not update; and
- one crash/watchdog reboot occurred after the first restart, but has not
  repeated.

This was recorded as PARTIAL/DEFECT, not acceptance. At the time it did not
identify a root cause.
Current/A/H/L changes, pet face/moods, 5-second waiting, 30-second sleeping,
and reliable leave/re-entry remain unverified.

The next track was:

- obtain and diagnose the exact coredump/crash;
- remove or repair the key hook;
- study stock wallpaper and LVGL image-rendering paths;
- use image frames owned by the ID-`7` screen; and
- verify that actual state changes select and render different frames.

Those items were subsequently completed by Stage 3E. The decoded core pins the
Stage-3D label-copy crash, and Stage 3E removes the face label and key hook,
uses screen-owned image frames, and has exact live write/read-back/boot success.
Its visual result is user-confirmed. The logical canvas is 100×310, explaining
the Stage-3E 100×100 sky's middle-third coverage. Stage 3E.1 is the offline
full-canvas milestone. Stage 3E.2 has live image/health success but is a runtime
NO-GO. The original DROM mapping ends at `0x3C1D0000`; sky-1 crosses it at row
`267`, column `92`, and every pet payload begins above it, exactly explaining
the lower 13.6% corruption and white squares. Stage 3E.3A keeps one static I4
cat below that boundary. Independent audit gave STATIC GO; exact
write/read-back/boot/health succeeded, while visual decoder acceptance remains
pending. See the
[Stage-3E live record](./13-stage3d-image-pipeline.md#live-deployment-record).

## Failure-safe entry and present limitation

ID `7` is added last and is never selected during boot. If allocation returns
null, the wrapper skips both registry insertion and dial-list insertion, leaving
the stock screens reachable. Stage 3C does not patch the native WPM or key
callbacks. Its cleanup hook is designed to hide the overlay on exit. Normal
boot and ID-`7` navigation are verified; the view is black and cleanup/hide
behavior is not accepted.

The deterministic Stage-3C image is installed and boots, and its own tests, S3
assembler/disassembler round trip, section layout, literals, calls, windowed
return registers, integrity values, and hashes are machine-pinned. Runtime and
offline ownership analysis establish the global-bubble/blank-root mismatch;
boot success still does not establish app-independent physical recovery. The
remaining risks are material:

- ID `7` opens a black view; the faint `wpm` popup appears only after cycling
  away and then disappears.
- The proof uses Framer's single global bubble model, so a simultaneous host
  `v.framer.bubble` RPC can contend with it.
- `addController` and `addNavigationId` expose no success result, so a partial
  registration cannot yet be rolled back after an internal allocation failure.
- The controller appears app-lifetime and the registry stores a raw pointer,
  but the full shutdown/destructor path has not been audited.
- The proof is a blank common LVGL root plus the global bubble overlay, not a
  self-owned label hierarchy.

Those two Stage-3C global-bubble limitations are removed from Stage 3C.1.
Independent static audit, exact write/read-back/boot, and user-confirmed
persistent/update behavior are verified. It is the known-good rollback base for
Stage 3D.

Stage 3D replaces direct shared-idle writes with a memory-barrier-protected
activity epoch: the key wrapper is the sole epoch writer and the LVGL thread
owns the remaining state. The ABI verifier pins the barriers and stock-first
return path, but the observed static cat and single non-repeated watchdog/crash
require exact diagnosis. Those runtime limits do not undo Stage-3C.1's accepted
on-screen result or Stage-3D's exact byte/boot evidence.

That assembler must be the ESP32-S3-specific little-endian
`xtensa-esp32s3-elf-*` frontend. The generic `xtensa-esp-elf-*` tools produce
big-endian ELF; Stage 3B's instruction-only bytes mask the difference, while
Stage 3C `.long` function literals would not. The Stage-3C builder consumes a
pinned hex artifact, and its associated verifier retains the tool-name,
little-endian, and relocation checks. Precise relocation wording matters:
the executable Stage-3B `.text` has no code/data relocations, while
`.rela.xt.prop` property metadata remains in the ELF.
