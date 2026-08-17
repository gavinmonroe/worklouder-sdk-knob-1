# ESP32-S3 fixed-mmap MicroQuickJS module feasibility

## Verdict

**GO for the static module/link/loader layout. NO-GO, for now, for a claim that
MicroQuickJS has run on the physical keyboard.** Nothing in this experiment
flashes or touches hardware.

The accepted blue clock/timer app has enough flash and ESP32-S3 linear MMU
space to keep screens 26/27 and map a real Xtensa MicroQuickJS payload from the
unused tail of its 8 MiB factory partition. The proof produces deterministic
128 KiB executable and 64 KiB read-only pages, plus a resident loader that fits
the accepted app's exact 6,840-byte zero tail. Code is executed in place; it is
not copied into RAM.

What is not yet present is equally important: the loader has not been inserted
into the accepted app, the F2JS package parser/startup bridge is not linked, a
dedicated VM task is not created, and PSRAM/deadline/recovery behavior has not
been measured on the device.

## Pinned healthy base

- App: `framer-0.4.1-music-id1-wpm-id7-renderer-id26-clock-id27-blue-timer-app.bin`
  - bytes: 2,062,912
  - flash: `[0x10000, 0x207a40)`
  - SHA-256: `363170139a06f306be1e894b6f203a9bf03bf4d70d21194aaccdd1c42f760c32`
- Physical receipt: `device-1786939039376-fast-smoke.json`
  - SHA-256: `1363d31eabba2b61e068d760d966ab25f8b17d1c635a4c91ba7ecd2a0de238e9`
- Preserved installed behavior: screen IDs 26 and 27.
- Loader cavity: `[0x4211e460, 0x4211ff18)`, exactly 6,840 zero bytes in the
  accepted app.

The verifier rejects any different app, receipt, flash size, security state,
segment layout, runtime reservation literal, or nonzero cavity byte.

## Exact shared-MMU calculation

ESP32-S3 uses one 32 MiB linear external-memory range with IROM and DROM
aliases and 64 KiB pages. The calculation is based on the accepted app's
runtime linker literals, not on padded image-segment ends:

| Reservation | Accepted-app evidence | Rounded linear bytes |
| --- | --- | ---: |
| IROM | IRAM+`0x90c=0x42116d12`, `0x910=0x42000020` | `0x120000` |
| DROM | IRAM+`0x914=0x3c1c1190`, `0x918=0x3c120020` | `0x0b0000` |
| PSRAM | IROM+`0xbdd18` and `0xbdd1c` both `0x3c1d0000` | `0x200000` |

Thus the first free shared linear address is `0x3d0000`. Before this module,
the free interval is `[0x003d0000, 0x02000000)`, or 29,556,736 bytes.

The fixed contract is:

| Payload | Flash paddr | Bytes | Required returned vaddr | Map caps |
| --- | --- | ---: | --- | --- |
| executable | `[0x210000,0x230000)` | 131,072 | `[0x423d0000,0x423f0000)` | `EXEC|32BIT = 0x09` |
| read-only | `[0x230000,0x240000)` | 65,536 | `[0x3c3f0000,0x3c400000)` | `READ|8BIT = 0x12` |

EXEC must be mapped first. After both mappings the remaining free interval is
`[0x00400000, 0x02000000)`, or 29,360,128 bytes. Any returned-address mismatch
fails closed and is unmapped; an unmap failure retains the handle for telemetry
and disables capability advertisement.

The exact accepted-app functions are pinned byte-for-byte:

- `esp_mmu_map` at `0x420f539c`, 982 bytes, SHA-256
  `cbd61aaf9138bb59e94d50780ee4b5a53ec315cd347eee341e7f1514b07aeab5`.
- `esp_mmu_unmap` at `0x420f5774`, 302 bytes, SHA-256
  `a397751ec73aacb36858a2ab98f72503d57e4d9fbb7ca03d7968e54e6ac62163`.

Their ABI and MMU behavior are checked against primary ESP-IDF v5.3.2 source:
[esp_mmu_map.c](https://github.com/espressif/esp-idf/blob/v5.3.2/components/esp_mm/esp_mmu_map.c),
[ext_mem_layout.c](https://github.com/espressif/esp-idf/blob/v5.3.2/components/esp_mm/port/esp32s3/ext_mem_layout.c),
and [flash_mmap.c](https://github.com/espressif/esp-idf/blob/v5.3.2/components/spi_flash/flash_mmap.c),
at commit `6920def9f050fe55df29954a2e8a41350b76b1d2`.
`esp_mmu_map` is not thread-safe, so mapping is a serialized, one-shot startup
operation before the VM task exists.

There is also a stock-IDF failure-path gate for hardware. ESP-IDF v5.3.2
allocates dummy head/tail MMU blocks before the real block; on a first-map
allocation failure its error path frees those objects without removing the
inserted list entries. A physical candidate must measure and reserve sufficient
internal heap before mapping, log pre/post internal free and largest-block
telemetry, and treat any map-allocation failure as no-retry for that boot:
disable capability and reboot/rollback. It must not call `esp_mmu_map` again on
possibly inconsistent list state.

## Admission and integrity

The resident loader performs this exact sequence:

1. Temporarily data-map the complete 128 KiB executable page at `0x3c3d0000`,
   SHA-256 all bytes, and unmap it.
2. Temporarily data-map the complete 64 KiB read-only page at the same address,
   SHA-256 all bytes, and unmap it.
3. Map executable first and require `0x423d0000`.
4. Map read-only second and require `0x3c3f0000`.
5. Validate descriptor magic/version/size, exact capacities, heap/runtime/slot
   contract, public ABI digest, and every aligned function pointer against the
   actually used executable span; then call the bounded probe.

Both page files are explicitly zero-padded, and SHA-256 covers the padding and
prefetch guards. The SHA implementation is self-contained in the loader; it
does not depend on an opaque ROM or stock crypto ABI. The verifier runs the
same C implementation against empty/`abc`/two-block known-answer vectors, both
built pages, one-byte tampering of each page, and teardown with three simulated
unmap failures (public descriptor/probe state clears while raw handles remain).

This is fail-closed byte identity relative to the pinned loader-enabled app,
not publisher authenticity or protection from an attacker who can rewrite app
flash. The accepted receipt proves secure boot and flash encryption are off.

The descriptor exports `probe`, `init`, `load`, `dispatch`, key enqueue,
terminal release-all, resumable focus release, drain, observation, telemetry,
last-good slots, and destroy. Its
loader/export ABI is distinct from SDK package ABI v1. The expected F2JS package
ABI SHA-256 is
`5091736403d809078cbbf12a1b593fbabaff53474a0935a7e00ce81dc8bd67f8`.
Admitted source must begin with the exact bytes `"use strict";\n`; this is a
profile rule, not an implicit parser mode.
The resident parser that admits that package format remains an integration
gap; it must compare F2JS/F1WB/F1RA magic as exact raw bytes and reject every
high-bit target-ID byte before ASCII decoding. It must also require canonical
UTF-8 for the one-slot F1WB name and zero bytes in descriptor name padding
`104 + nameLength .. 119`, after validating the resealed package/animation
hashes. This proof does not pretend a raw package can already be handed to the
module.

## Flash slots and rollback

The 16 MiB device flash contains an 8 MiB factory partition at
`[0x10000,0x810000)`. Slot A is `[0x210000,0x240000)` and slot B is
`[0x240000,0x270000)`, each 192 KiB. There are 34,240 unused bytes between the
healthy app and slot A, and 5,898,240 bytes after slot B within factory.

For an eventual update, write and readback-verify the inactive module slot
first, then write the loader-enabled app last. The current artifact pins slot A
at compile time; selecting slot B requires a deterministic resident-loader
relink and therefore a new loader-enabled app SHA. There is deliberately no
mutable slot selector from unauthenticated flash. Rollback writes the healthy
`36317013...` app first, immediately making both module slots inert; they can be
left untouched or erased later. Never select a partially written slot.

## Required physical-canary architecture

- One dedicated VM-owner task, with a proposed 12,288-byte internal fixed
  stack. JavaScript, parsing, and GC never run on the LVGL/UI callback stack.
- Caller-owned 4,096-byte aligned runtime storage and a fixed 65,536-byte heap,
  preferably in PSRAM.
- At most 8,192 immutable UTF-8 source bytes plus a readable NUL, beginning
  with the exact `"use strict";\n` byte prefix.
- Bounded producer ingress; only the owner task drains events and calls the VM.
  The frozen key ABI has 32 queue records, consumes at most four records plus
  two coalesced holds per logical batch, stages at most 62 logical events into
  a fixed 64-event FIFO, and admits at most 18 resync events. Each owner call
  attempts at most three FIFO events, so it can execute at most three
  JavaScript callbacks before yielding when more work remains.
- A proposed 72-byte single-writer seqlock mailbox: one atomic sequence, 16
  committed `int32` slots, and one admitted revision. The UI copies only a
  stable even sequence and renders through the existing F2EP renderer.
- A 2,000 microsecond callback deadline and last-good snapshot retention. A
  successful owner call is bounded to 6 ms. The first callback failure stops
  the call after one bounded recovery, leaves later FIFO snapshots queued, and
  caps the failure-plus-recovery path at 8 ms before the owner yields.

Map before allocating/starting the VM. Before unmap or any module flash update,
disable input capability, remove and quiesce the producer hook, stop the owner
task, destroy the VM, and only then touch mappings. PSRAM-backed runtime memory
must never be accessed while the flash/external-memory cache is disabled.

Still blocking a physical-runtime claim are exact stock setup-chain,
`heap_caps`/static-task/key-hook ABIs, the F2JS parser/integrity-and-profile
admission adapter (package SHA is integrity, not authenticity),
the mailbox-to-F2EP consumer, and physical stack/high-water/deadline/OOM/soak
receipts.

The accepted current renderer chain does provide a narrow candidate seam. Its
entry is `0x42118c68`; after all existing ID26/27 registration it reaches
`retw.n` at `0x42118cdd`, followed by one padding byte, and the next live helper
starts at `0x42118ce0`. A future builder can replace exactly
`[0x42118cdd,0x42118ce0)` with a three-byte tail jump to an **entry-less**
resident trampoline. That trampoline must `call8` a real startup function and
then `retw.n`, preserving the current chain's caller window. Replacing the
window with `call8` directly is invalid because its return address would enter
the live helper at `0x42118ce0`. The current mapping artifact intentionally
does not include this trampoline; adding it changes the loader address/hash and
must be re-linked and re-audited together with the real task/parser bridge.

## Reproduce

From the repository root:

```sh
node experiments/mquickjs-esp32s3-canary/verify.mjs
node experiments/mquickjs-esp32s3-module-loader/verify.mjs
```

The second command asserts the exact Xtensa compiler identity
`xtensa-esp-elf-gcc (crosstool-NG esp-13.2.0_20240530) 13.2.0`, performs two
independent deterministic fixed-address builds, runs the native SHA KAT, and
publishes artifacts under `build/`. The key handoff artifacts are
`module-loader-manifest.json`, `mquickjs-module.elf`, the two padded module page
files, `resident-loader.elf`, its map/disassembly, and `module-slot-a.bin`.
