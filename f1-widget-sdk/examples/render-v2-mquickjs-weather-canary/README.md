# Render-v2 MicroQuickJS weather canary

Status: **static/offline only; not flashable and not physical-screen proof**.

This example turns the existing normalized ZIP weather model into a bounded
`F2JS` program. It is a second canary workload for the proposed on-device
MicroQuickJS runtime: eight declared host-RPC handlers deliver one coherent
current + three-day record, and `tick.1s` drives age, retry, and stale state.
The host preview is a separate 100×310 dark-sky screen.

The package is useful now as an ABI and behavior fixture. It must not be shown
as deployable in Input Lab until every capability extension in the generated
manifest is advertised by the physical keyboard.

## Build and test

From `f1-widget-sdk`:

```sh
node examples/render-v2-mquickjs-weather-canary/build.mjs
node --test test/render-v2-mquickjs-weather-canary.test.mjs
node examples/render-v2-mquickjs-weather-canary/verify-native.mjs
```

The build writes:

- `build/weather-60601.f2js` — exact strict-source package;
- `build/manifest.json` — package identity, capability gate, protocol, budgets,
  and blockers;
- `build/golden-screen.svg` — host-only visual golden;
- `build/golden-slots.json` — the exact 16-slot state behind the golden.

The frozen generation-18 package SHA-256 is
`88537026c8b217b763c393b82d8787ca08256681265976f7bcff6077b2282d20`;
the exact source SHA-256 is
`68db9d61fa38b0a396e46e88076d75d262a486f2ec4b41b4d398454d7d713e9b`.
The umbrella
[`MicroQuickJS readiness bundle`](../../../experiments/mquickjs-canary-bundle)
re-decodes this package and joins it to the engine, loader, resident, and stock
bridge evidence in one `NOT_FLASHABLE` report.

No build or test opens the network, writes firmware, or contacts a keyboard.
`createDeterministicWeatherProvider()` implements the same `lookup(config)`
boundary as a real host provider and derives repeatable data from the validated
ZIP code. A production provider may sit behind that boundary; network access
still belongs to the host, never the keyboard JavaScript.

Input Lab may use this deterministic provider and golden screen for offline
preview. The visible app does not yet expose a MicroQuickJS weather project or
ZIP/provider flow, and it must not offer device push until the exact physical
capability and applied-revision receipt are present.

`verify-native.mjs` compiles the existing pinned Bellard MicroQuickJS host
canary twice (normal and moving-GC/ASan), loads the exact 5,667-byte weather
source, and executes partial, reordered, stale, tick, provider-error, hidden,
resume, and negative-temperature callbacks. Its frozen result is
`PASS_WEATHER_SOURCE_ON_PINNED_MQUICKJS_HOST`: six atomic publications,
applied weather revision 3, 61,496-byte heap high-water in the 65,536-byte
fixed heap, and moving-GC/ASan pass. The remaining 4,040 bytes are deliberately
reported as tight canary headroom, not production RAM approval.

## Atomic host protocol

One revision is six scalar RPC records:

| Order | ID | Payload |
| --- | ---: | --- |
| begin | `0xB240` | `value = revision` |
| current | `0xB241` | `value = packed current`, `auxiliary = revision` |
| forecast 1 | `0xB242` | `value = packed day`, `auxiliary = revision` |
| forecast 2 | `0xB243` | `value = packed day`, `auxiliary = revision` |
| forecast 3 | `0xB244` | `value = packed day`, `auxiliary = revision` |
| commit | `0xB24F` | `value = revision`, `auxiliary = 0b1111` |

The program keeps staging fields in JavaScript variables. Only a newer,
matching, complete, valid revision copies all display values to the 16 integer
slots and calls `widget.commit()` once. Data may arrive in any order after
`begin`. A partial commit, stale revision, mismatched revision, malformed
condition/weekday/range bitfield, or conflicting duplicate changes no published
slot. Identical duplicates are harmless. This retains the last-good snapshot
by construction.

`0xB24D` reports provider error/retry state without replacing weather values.
`0xB24E` is the explicit visibility transition described below.

The host state machine never treats scalar acceptance as delivery success.
Every scalar response must echo the exact event name, ID, value, and auxiliary;
controls must additionally report that their callback committed at the current
`appliedRevision`. Snapshot-delivery outcomes are `busy`, `queued`, `rejected`,
or `applied`, and final success requires the exact weather `appliedRevision`.
A transport `busy` or `queued` response means that scalar was not accepted or
asynchronously retained; the host safely replays the complete revision.

All device operations use one serialized host queue. A hide request immediately
gates new snapshots, lets an already-started revision finish, then applies the
hide control; while hidden, only the newest revision remains queued. Rejected or
inexact visibility/provider-status receipts fail closed. The queue replaces an
older pending snapshot only with a newer revision. A reconnecting host must
initialize its next revision from the device's reported applied revision;
restarting at revision 1 could mistake an old retained revision for a new
receipt.

## Slots and signed text

The only current runtime data surface is `widget.setInt(0..15)`. There is no
DOM call in this program.

| Slots | Meaning |
| --- | --- |
| `0` | applied weather revision |
| `1..2` | current signed-temperature ASCII word and condition/day metadata |
| `3..5` | forecast day 1 metadata, low, high |
| `6..8` | forecast day 2 metadata, low, high |
| `9..11` | forecast day 3 metadata, low, high |
| `12` | age seconds |
| `13` | empty/fresh/stale/error freshness enum |
| `14` | retry seconds |
| `15` | has-good/hidden/provider-error flags |

MicroQuickJS decodes signed 10-bit temperatures and formats each number into
one four-byte little-endian ASCII word, including a leading minus sign. The
target consumer appends the degree symbol and configured unit. This proves the
bounded on-device signed-number logic without pretending an integer slot can
already publish an arbitrary JavaScript string.

The package declares exactly 16 target IDs for the visual contract. The host
golden maps those IDs to current temperature/condition, age/status, three
forecast rows, and retry state. Target records only reserve writable names in
`F2JS` v1; they do not implement the slot-to-text/color/hidden consumer.

## Tick and hidden-screen policy

While visible, each delivered `tick.1s` increments the bounded age, decrements
retry time, recalculates freshness, and publishes one full slot snapshot. A
record becomes stale after 1,800 seconds.

The policy is foreground-only and matches the base canary guidance:

1. Dispatch one hide event, retain its last-good mailbox/frame, then suspend
   the VM and stop screen ticks.
2. While hidden, the host queues only the latest complete weather snapshot;
   it does not run JavaScript in the background or accumulate a tick backlog.
3. On re-entry, resume the VM and dispatch one show event whose bounded
   `auxiliary` value is hidden elapsed seconds. This immediately recomputes
   age/stale state.
4. Replay the newest queued complete revision, then resume fresh ticks.

The source also ignores a tick received while marked hidden as a fail-closed
defense. The physical scheduler/navigation hook still has to enforce the
suspension and replay policy.

## Capability gate and decisive gaps

The separate screen requires the exact base MicroQuickJS capability plus:

- `weatherSnapshotProtocol = revision-stage-commit-v1`;
- `targetFacade = weather-int16-targets-v1`;
- `deliveryReceipt = applied-revision-v1`;
- `dispatchReceipt = exact-event-applied-v1`;
- `hiddenScreenPolicy = suspend-and-replay-latest-v1`.

None of those extensions is advertised by proven physical firmware today.
The package manifest therefore has `pushAllowed: false`.

The decisive screen blocker is a bounded native consumer that atomically maps
the 16-slot mailbox into the declared text/color/hidden targets over the raster
base. The current canary has no `document`, `textContent`, or general string
native, and target declarations alone do not render dynamic weather. The
physical RPC path also still needs bounded queue responses and an exact applied
revision receipt plus exact event/control receipts. Resident parser/task/mailbox,
screen lifecycle integration, startup hooks, physical capability advertisement,
recovery, and soak evidence remain required before a hardware test.
