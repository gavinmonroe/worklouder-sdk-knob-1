# MicroQuickJS offline readiness bundle

This directory produces one machine-readable report for the complete offline
Render-v2 MicroQuickJS chain. It cross-checks the public `F2JS` SDK ABI, real
host and Xtensa engine canary, fixed-MMU module loader, resident admission/task/
mailbox proof, exact-image stock bridge, frozen weather target facade,
timer/key/chord example, and weather RPC/tick example.

The result is deliberately **`PASS_STATIC_ONLY_NOT_FLASHABLE`** with physical
verdict **`NOT_FLASHABLE`**. The verifier does not discover a device, open HID
or serial, patch an app, generate a flash command, or advertise a capability.

## Reproduce the frozen inputs

From the repository root:

```sh
node f1-widget-sdk/examples/render-v2-mquickjs-canary/build.mjs
node f1-widget-sdk/examples/render-v2-mquickjs-weather-canary/build.mjs
node experiments/mquickjs-esp32s3-canary/verify.mjs
node experiments/mquickjs-esp32s3-module-loader/verify.mjs
node experiments/mquickjs-esp32s3-resident-integration/verify.mjs
node experiments/mquickjs-esp32s3-stock-bridge/verify.mjs
node experiments/mquickjs-target-facade/verify.mjs
node experiments/mquickjs-canary-bundle/verify.mjs
```

The last command reruns the hardware-free engine, weather native execution, and
target-facade checks, verifies every referenced manifest/artifact hash, and
writes:

- `build/key-chord-knob-canary.f2js` — the canonical generation-1 timer,
  key, hold, exact-chord, key-plus-knob, tick, and host-RPC example. Its two
  native key tokens are synthetic.
- `build/weather-60601.f2js` — the frozen generation-18 weather workload,
  package SHA-256
  `88537026c8b217b763c393b82d8787ca08256681265976f7bcff6077b2282d20`
  and source SHA-256
  `68db9d61fa38b0a396e46e88076d75d262a486f2ec4b41b4d398454d7d713e9b`.
- `build/weather-gen18.f2tf` — the frozen 1,375-byte weather target-facade
  companion, SHA-256
  `d9e2ce701755423dc9d843eace93f51f982d1f5cb7c231c6fb9a5f1f1dc9bc94`.
- `build/readiness-manifest.json` — the single static readiness report. It
  records every component manifest/core/page/package hash and the remaining
  physical blockers.

The verifier independently freezes the resident v3 object at 51,088 bytes / SHA-256
`22b946fdc6281c38c54de8dcec1081984553c417dded4167e7a37c3d8811428f`
and its manifest at
`4db75ecc743ef9340a7c01eb9905d9915957f91dbf38c53cd74a2afe6090e82a`.
It also pins stock bridge core
`0406f9e8341f79d5f6cc602460c1bf405508c5aff4a4be5fa97244beacc4c676`,
stock manifest `0afdc47b8009010fb59ad1308353945a15fa7f9d4e8812354701bea747b64e28`,
and module ABI `ad484a3a8b438c51f6bbcda6ea871110735b3460e39e4c2853a4e636f5f728cb`.
It rejects a changed manifest even if a changed artifact describes itself, and
requires module slot A to equal the complete verified text + rodata pages.

The target-facade manifest is independently frozen at
`75dd14da05d0b30ab56558b6c9ab97b8e48d137b2e82a6d3d9394092b6a970d6`.
Its contract SHA-256 is
`8220152a09348da34cdd70dd7d370197f2f3fc46a9f45e50d7fb7015bdb8579a`;
its freestanding Xtensa object SHA-256 is
`99f3d9c3c8bb81a7472856e3664220d5d92520c89533d8d672bad66fdf530521`
with 4,364 text bytes, 72 read-only bytes, and zero undefined symbols or
writable globals. Eleven weather cases render pixel-exactly between the host
oracle and C consumer. This is static evidence, not linked-device evidence.

The weather native run loads its exact 5,667-byte source in pinned
MicroQuickJS. Its normal fixed-heap high-water is 61,496 of 65,536 bytes,
leaving exactly 4,040 bytes. That is useful canary evidence and very tight
headroom, not production RAM approval.

## Weather boundary

The postal-code input and provider belong to the host companion. The keyboard
never receives network, geocoding, or provider credentials. The host validates
the ZIP/country/unit configuration, fetches or deterministically simulates a
normalized snapshot, and sends six revision-stage-commit scalar RPC records.
Final success requires an exact applied revision. `tick.1s` updates freshness
on the device-side program.

The package declares 16 text/color/hidden targets, but declarations are only
an allowlist in `F2JS` v1. A separately versioned `F2TF` companion and bounded
C consumer now prove the weather mapping offline. They are not linked into the
resident module or stock UI tick and have no physical timing/capability receipt,
so this is still not a working keyboard screen.

## Input Lab boundary

Input Lab currently has the `F2JS` package SDK and a tested host-only model for
key down/up/hold, exact chords, overflow recovery, native observation gating,
and key-plus-knob held-state checks. It does not yet have a visible
MicroQuickJS JS/HTML/CSS project editor, a proven device key learner, or a
MicroQuickJS backend that may push to hardware. Weather ZIP/provider UI and
transport also remain host-side integration work. Device push must stay
disabled until exact capability negotiation and applied-revision receipts pass.

## Why it is not flashable

The report keeps these gates explicit and separately machine-readable:

1. physical stock-UI integration and proof of the frozen bounded weather target
   facade;
2. exact per-event/control and applied-generation/revision RPC receipts with
   `busy`, `rejected`, `queued`, and `applied` flow control;
3. a final linked app containing the non-overlapping resident, stock bridge,
   loader, and target facade;
4. physical producer/key-source pause and drain before cache-disabled flash or
   NVS work;
5. exact engine/key/weather capability plus app/module/package device receipt;
6. a pinned and exercised task-watchdog lifecycle;
7. physical OOM/timeout, last-good, hide/show, USB-loss, rollback, and
   existing-screen recovery proof;
8. bounded stack/heap/deadline/WDT telemetry and a sustained device soak.

Until all eight pass independent review, this bundle is evidence for the next
integration step—not firmware and not authorization to flash.
