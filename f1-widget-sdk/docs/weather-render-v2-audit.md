# Weather widget: Render-v2 audit and implementation plan

## Verdict

The current Render-v2 work is a strong deterministic event renderer, but it is not yet the MicroQuickJS edge
pipeline described by the product goal. It can compile a safe JavaScript-shaped subset to F2EP, render exact RGB565
patches, consume ticks and Fn + bottom knob, accept one scalar host event at a time, and transactionally publish a
generic package. The separate generic firmware now removes the exact clock/timer firmware's `0xB201` pin and admits
any host-RPC ID declared by the active compiled program. It still cannot atomically apply a real weather snapshot.

The weather widget can be built now as a **host-fetched snapshot package**. The host accepts a postal code and menu
choices, fetches and normalizes weather, generates the widget source, recompiles the RGB565 base/patches, and pushes
the next package generation. Fn + bottom knob cycles the selected forecast row locally. This is the implementation in
[`../examples/render-v2-weather`](../examples/render-v2-weather).

The intended **incremental host-event path** needs the P0 runtime work below. The SDK now defines its revisioned,
six-record packed-int32 contract so the firmware/MicroQuickJS implementation has a concrete target instead of an
open-ended “weather JSON” requirement.

## Product contract taken from the reference

- Logical canvas: `100x310`, black background, white type, orange current-weather surface and selection accent.
- Current view: location, Today, condition mark, temperature, and concise condition label.
- Forecast view: three daily rows with weekday, low, direction arrow, and high.
- Configuration: postal code, Fahrenheit/Celsius, and refresh interval.
- Device interaction: Fn + bottom knob moves the highlighted forecast row. Unmodified input must continue to fall
  through to stock navigation.
- Network ownership: the host companion fetches weather. The device receives normalized bounded values only.
- Failure behavior: preserve the last good snapshot; show stale/offline state in the host; never blank the device on a
  provider, parse, queue, VM, or package error.

## What is present now

| Capability | Present | Evidence / limit |
|---|---:|---|
| Exact `100x310` RGB565 base | Yes | One 62,000-byte borrowed renderer-v1 framebuffer. |
| Rich reference layout | Yes | Sanitized, pinned Chromium capture plus fresh-render patch parity. |
| Fn + bottom knob | Yes | Screen-local encoder ID 1 with Fn gating and stock fallback. |
| Tick events | Yes | `tick.100ms` and synthesized `tick.1s`. |
| Host scalar events | Yes in generic firmware | The separate generic RPC path admits any ID declared by the compiled program; the exact clock/timer firmware remains pinned to `0xB201`. |
| Generic package admission | In progress | Structural profile exists; the current exact clock/timer profile rejects arbitrary packages. |
| Package generation transaction | Yes | Complete F1WB+F2EP hash, chunks, stage/commit/cancel. |
| Arbitrary JavaScript on device | No | Source is parsed and statically lowered; it is never evaluated on-device. |
| MicroQuickJS on Xtensa | Compiler proof only | Cross-build exists; no fixed-heap, deadline, UI-task, recovery, or hardware proof. |
| General number formatting | No | `formatTime` and finite `pick()` variants only. |
| Atomic multi-field host update | No | Eight-record FIFO has no batch staging/commit semantics. |
| Device-to-host event/request | No | Knob state cannot ask the companion for another forecast page. |
| Persistent widget config | Yes in focused companion | ZIP, units, and refresh interval are validated and stored locally; Input Lab project export/import does not yet carry the typed weather schema. |

## Current implementation

The public Render-v2 SDK now supplies:

- strict postal-code/country/units/refresh configuration normalization;
- fixed-origin Open-Meteo geocoding and forecast URL construction;
- bounded response normalization and WMO-to-eight-condition mapping;
- a provider fetch adapter with injectable `fetch` for deterministic tests;
- a three-day weather snapshot model;
- packed current/day int32 codecs;
- the revisioned six-event incremental contract;
- a source generator for the deployable snapshot-package fallback.

The generated widget is deliberately honest about its delivery mode. Weather values are literals in the compiled
package. The F2EP program controls only the three-row highlight. A refresh means fetching on the host, rebuilding, and
pushing the next package generation.

## Incremental event contract

One snapshot uses six ordered `host.rpc` records:

| Order | ID | Value |
|---:|---:|---|
| 1 | `0xB240` | Begin revision (positive int31). |
| 2 | `0xB241` | Current: signed 10-bit temperature, 4-bit condition, day/night bit. |
| 3 | `0xB242` | Day 1: signed 10-bit low/high, 4-bit condition, 3-bit weekday. |
| 4 | `0xB243` | Day 2, same layout. |
| 5 | `0xB244` | Day 3, same layout. |
| 6 | `0xB24F` | Commit the matching revision. |

This is intentionally smaller than the current eight-entry queue. Queue fit is not atomicity: the runtime must stage
all four payload records and expose them to rendering only when the matching commit arrives. A missing, duplicate,
out-of-order, stale, or mismatched record discards the staging generation and leaves the last good snapshot visible.

## P0: required before incremental weather can be called supported

1. **Ship and prove generic structural admission.** The device capability response must name the generic package
   profile, package format, scene-store size, committed generation, accepted event IDs/ranges, and runtime backend.
   The exact clock/timer allowlist is not a weather-capable target.
2. **Promote and prove the generic declared-ID RPC path.** The separate generic firmware now parses arbitrary
   `id:uint16`/`value:int32` and admits only IDs declared by the active compiled program. Keep that fail-closed behavior,
   advertise it in capabilities, and obtain the exact app SHA/device receipt and soak evidence needed to call it live.
3. **Add revisioned staging/commit.** Implement the six-record contract as one coherent visible state change. Do not
   repaint on the four payload records. Reset staging after timeout, error, new begin, VM reset, package generation
   switch, or hidden-screen policy transition.
4. **Add meaningful flow control.** A status-only `{status:"ok"}` currently proves only callback acceptance. Weather
   needs at least `rejected/busy/queued`, plus an applied revision or queryable runtime generation. The host must be
   able to distinguish “queue accepted” from “visible state committed.”
5. **Implement the edge decode/format facade.** MicroQuickJS needs bounded native helpers for unpacking signed fields,
   selecting condition assets, formatting signed temperatures, and publishing a dirty state. If the deterministic VM
   remains the backend, add equivalent bitfield/derived-binding operations rather than expanding every temperature
   into precompiled whole-string variants.
6. **Prove MicroQuickJS on the actual runtime.** Fixed 32–64 KiB heap, repeatable OOM reset, 2 ms callback deadline,
   interrupt/timeout, no LVGL access off the UI task, last-good-frame recovery, internal/PSRAM telemetry, and a soak
   with Music and WPM still active are all release gates.
7. **Define hidden-screen policy.** Recommended: accept and stage host data while hidden, apply it on next safe UI tick,
   and retain only the newest complete revision. If the implementation instead rejects hidden updates, capability and
   host retry behavior must say so explicitly.
## P1: needed for a good end-user widget

- Integrate the focused Weather companion into Input Lab's durable project schema and export/import flow. The focused
  companion already provides postal-code validation, units, refresh interval, manual/automatic preview refresh,
  last-update/error status, exact compiled preview, and explicit capability-gated device apply.
- Add a location disambiguation picker when geocoding returns multiple places instead of selecting the first bounded
  result.
- Provider abstraction with rate-limit/backoff, timeout, cancellation, cached last-good snapshot, and attribution.
- A supported device-to-host event if knob navigation should request pages that were not preloaded.
- Condition assets designed for the display rather than depending on host font emoji coverage.
- Locale/date policy. The current packed contract sends weekday IDs so the edge does not infer a date from a clock
  that exposes time-of-day only.
- Accessibility and project export/import for the configuration UI.

## Why the current deterministic ABI cannot render the full live design directly

The design contains seven independently changing temperatures (current plus three lows and highs), three weekdays,
and condition state. Exact signed temperature text needs derived glyph selection. F2EP v1 offers 16 state slots,
16 bindings, 64 total patch variants, positive divisor/modulo selection, and no conditional/bitfield operations.
`formatTime` is the only multi-digit formatter. Whole-string `pick()` tables either exceed 64 variants or quantize the
data, while digit-per-binding formatting exceeds the binding budget once sign and three forecast rows are included.

Raising limits alone is not a complete fix. It increases capture cases and tables but still does not give atomic
snapshot publication or signed/conditional formatting. Prefer a reusable numeric glyph compositor/derived binding or
the bounded MicroQuickJS facade.

## Acceptance sequence

1. Host-only fixture tests: config, geocoding choice, WMO mapping, temperature bounds, pack/unpack, revision ordering.
2. Compiler tests: rich raster source, fresh-render parity, non-overlapping patches, knob selection, package budget.
3. Native unit tests: arbitrary declared RPC IDs, malformed IDs/values, full/locked queue, staging timeout, revision
   mismatch, duplicate/out-of-order records, and last-good retention.
4. SDK/native parity: the same six records produce identical decoded state, dirty spans, and RGB565 output.
5. Hardware canary: package push, foreground update, hidden update/re-entry, USB interruption, host restart, rapid
   refresh, malformed snapshot, and rollback.
6. Soak: repeated weather refreshes with Music ID1 and WPM ID7 active, heap high-water marks, UI callback timing, queue
   rejection count, VM resets, and framebuffer generations recorded.
7. Promote only an exact app SHA/device receipt. Offline build success and status-only RPC replies are not physical
   acceptance.

## Verification snapshot (2026-08-17)

- Weather SDK + companion: 7/7 tests pass.
- Offline weather build: 63,786-byte package, 34,518-byte store headroom, one state, one handler, three bindings,
  nine variants, 63 spans, and 630 dynamic pixel bytes.
- Chromium proof: 15 fresh renders covering initial, every individual variant, all binding pairs, and the combined
  state; exact layout/base hashes emitted in the manifest.
- Input Lab production web build: pass.
- Focused moving Render-v2/Input Lab run: 73/73 pass, including canonical string-only capability limits,
  `v1Packages` admission, native canonical-base package rejection, browser delivery, the full raster set, and the
  weather cases.
- The earlier Chromium non-format binding `initial` regression is fixed independently; the rich gradient,
  `formatTime`, reflow rejection, overlap rejection, and hardening checks now pass.
- Generic firmware host-native harness: declared host ID `0x1234` accepted after package admission while the prior
  `0xB201` is rejected; zero ID and F1WB tamper reject; V1/V2 transitions and both abort windows pass; 4,096 mutated
  F2EP structures complete without a crash (3,022 still structurally valid, 1,074 rejected).

## Provider note

The reference adapter uses Open-Meteo because its geocoding search accepts a postal code and its forecast API exposes
current temperature/weather code plus daily weather code/min/max fields. Production use still needs a licensing,
attribution, availability, and commercial-plan decision; the SDK keeps provider I/O on the host so that decision does
not change the device ABI.
