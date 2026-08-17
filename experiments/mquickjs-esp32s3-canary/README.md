# MicroQuickJS ESP32-S3 canary

This directory is an isolated feasibility proof for a real MicroQuickJS widget
backend. It does not replace the current F2EP renderer, write firmware, or prove
that MicroQuickJS is running on a keyboard.

The engine is vendored byte-for-byte from Fabrice Bellard's official
[MicroQuickJS repository](https://github.com/bellard/mquickjs) at commit
`203d5bb79789bc47b74855d9207415dab71661a0`. `UPSTREAM.json` pins the upstream
archive, license, and file digests; `verify.mjs` fails on drift.

## Frozen host and Xtensa proof

Run from the repository root:

```sh
node experiments/mquickjs-esp32s3-canary/verify.mjs
```

The verifier proves all of the following without touching hardware:

- MicroQuickJS parses and runs admitted NUL-terminated UTF-8 source in one
  caller-owned 64 KiB heap. There is no system allocator, bytecode transport,
  `eval`, timer, console, wall-clock, random, or module-loader surface.
- The only widget natives are `widget.on`, `widget.getInt`, `widget.setInt`,
  `widget.commit`, and `widget.isHeld`.
- Named events are `tick.100ms`, `tick.1s`, `input.fn-bottom-knob`, declared
  `host.rpc:<1..65535>`, `input.key.down`, `input.key.up`, `input.key.hold`,
  `input.chord.down`, and `input.chord.up`.
- Every callback receives an immutable-by-contract event snapshot with
  `type`, monotonic `sequence`, wrap-safe uint32 `timestampMs`, `heldMask`, and
  `synthetic`. Key events add `key`, `repeat`, `holdCount`, and `reason`; chord
  events add `chord` and `reason`. `widget.isHeld(event, keyId)` reads that
  snapshot, including during ticks, Fn+bottom-knob, and host RPC callbacks.
- Candidate parse failure, JavaScript exception, OOM, cooperative 2 ms timeout,
  and mailbox publication failure recover the prior accepted source and
  last-good 16-slot state. A moving-GC AddressSanitizer pass exercises rooted
  event objects and callbacks.
- The VM runs only on the configured owner task. A callback can request one
  commit, and `publish()` can only copy a complete 16-slot array plus increasing
  revision into an adapter-owned atomic UI mailbox; it must never call UI code.
- Two independent links with pinned ESP32-S3 Xtensa GCC 13.2.0 are byte-identical
  `elf32-xtensa-le`, with no relocations, undefined symbols, system allocator,
  or process-I/O imports.

The frozen final-link footprint is:

| Property | Bytes/value |
| --- | ---: |
| `.text` | 65,600 |
| `.rodata` | 10,768 |
| `.eh_frame` | 64 |
| `.data` | 0 |
| `.bss` | 69,704 |
| GNU `size` loadable total | 76,432 |
| GNU `size` linked total | 146,136 |
| Raw binary | 76,444 |
| Raw SHA-256 | `74a4416f9ceced9e5f5785637dc839d010f0dde58856330ec747803c55e18c1c` |

Relative to the pre-key-event canary, key/chord ingress adds 2,192 loadable
bytes and 3,072 BSS bytes (5,264 linked bytes total). `.text` grows by 1,696,
`.rodata` by 496, and the raw image by 2,160 bytes. BSS is exactly the 65,536-byte
heap, 4,096-byte runtime storage, and 72 bytes of link-harness state.

## Bounded key and chord contract

Package admission assigns at most 16 stable JavaScript key IDs to unique opaque
u32 native tokens; token zero is valid. It also admits at most eight unique
exact held masks, each containing two to four keys. The runtime uses:

- one 16-bit authoritative held bitmap;
- one fixed 32-record SPSC producer queue using acquire/release atomics;
- at most four raw queue records and two coalesced hold events per logical batch;
- one fixed 64-event FIFO that preserves timestamp and held snapshots across
  yielded owner calls;
- debounce 1–50 ms, hold delay 100–5,000 ms, and cadence 20–1,000 ms;
- deterministic key-ID order for simultaneous edges and chord-up before
  chord-down when one exact mask changes to another;
- one down and one up per stable level, with repeated raw levels ignored;
- round-robin holds so low key IDs cannot starve higher IDs;
- queue-overflow bitmap resync, plus focus-loss/disconnect synthetic releases,
  so a dropped release cannot leave a key stuck.

A logical batch is fail-closed at 62 staged events: up to 16 already-pending key
transitions plus four transitions induced by consumed raw records, each
conservatively allowing one key edge and chord up+down, plus two holds. A resync
is separately bounded at 18 events (16 keys plus chord up/down). Three FIFO
events are attempted per `dispatch()` or `input_drain()` call; no-handler events
also consume that budget, so actual JavaScript callbacks cannot exceed three.
The first failed callback ends the call after one recovery and leaves all later
FIFO snapshots queued. At the 2 ms deadline, a successful call is bounded to 6
ms. The worst failed call is two successful callbacks, one failed callback, and
one recovery, bounded to 8 ms. A negative result with pending FIFO telemetry
requires the owner adapter to schedule another iteration after yielding.
The physical adapter must return to its scheduler after `INPUT_MORE_PENDING`,
not tight-loop drains. Hardware latency and WDT behavior still need a soak proof.

The producer callback never executes JavaScript or UI work. A future physical
adapter must first invoke the stock key callback, then enqueue its observed u32
token and boolean level. The existing stock callback at `0x4206EAE0` exposes
those values structurally, but the adapter, physical token identity, and hook
lifetime are not proven. The capability must stay off until loader and VM health
are established.

The observation poll reports only the latest opaque token, level, timestamp, and
monotonic observation sequence through a bounded seqlock read. Input Lab may let
a user attach a label or `KeyboardEvent.code`; neither the runtime nor SDK may
invent a physical key map.

Release-all atomically gates ingress before clearing the authoritative bitmap,
so an in-flight producer cannot repopulate it. Teardown order is mandatory:
disable the advertised capability, remove the stock-first hook, quiesce its
producer, drain or cancel the owner task, destroy the VM, then unmap the module.
Live telemetry and last-good-slot getters are owner-task-only; another RPC task
must read an adapter-owned status/mailbox snapshot. Source and heap storage are
borrowed and must remain immutable/alive until teardown.

## Still unproven on hardware

This canary does not prove a physical runtime, token-to-key map, ESP-IDF task,
watchdog behavior, IRAM/PSRAM placement, cache-disabled operation, capability
advertisement, package loader admission, physical SHA/receipt, or soak result.
The cooperative deadline is checked at MicroQuickJS interrupt polls; hardware
latency and recovery remain unmeasured. Tick, knob, host RPC, and key ingress all
need bounded queues into the same owner task in the eventual adapter.

MicroQuickJS bytecode is intentionally rejected because upstream documents it
as version/word-size dependent and unverified. Cryptographic package SHA/profile
verification belongs to the loader; the public `admitted` boolean is only the
caller's assertion that those checks and bounds already passed.
