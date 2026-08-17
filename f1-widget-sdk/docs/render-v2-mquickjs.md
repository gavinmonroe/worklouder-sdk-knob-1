# Render-v2 MicroQuickJS developer guide

> **Status — 2026-08-17:** this is an offline canary contract, not a physical
> device approval. The SDK builds and strictly decodes deterministic `F2JS`
> packages; the pinned engine runs in host tests; and the Xtensa module/MMU
> layout, resident parser/owner/mailbox architecture, and exact-image stock
> seams have static proofs. No receipt yet proves MicroQuickJS executing on a
> Framer F1. The resident-to-stock final link, target-renderer integration, exact applied-
> revision RPC, cache-safe producer/key-source quiescence, task-WDT lifecycle,
> capability receipt, and physical recovery/soak remain integration blockers.

This guide is the developer-facing contract for the optional Render-v2
MicroQuickJS lane. The existing Render-v2/F2EP documentation remains the
reference for the deterministic renderer. Treat the exported SDK constants and
tests as canonical if this document and code ever disagree.

## Choose the execution profile deliberately

Render v2 has two separate backends. They accept different packages and must
never silently fall back into one another.

| Backend | Profile | Package | What runs on the keyboard |
| --- | --- | --- | --- |
| Deterministic F2EP | `framer-f1-render-v2-structural-v1` | `framer-render-v2-package-v1` | Bounded F2EP state bytecode and precompiled pixel variants |
| MicroQuickJS canary | `framer-f1-render-v2-mquickjs-v1` | `framer-render-v2-mquickjs-package-v1` | Admitted UTF-8 JavaScript source evaluated by the pinned MicroQuickJS engine—after the physical integration is complete |

The orange clock and blue timer built earlier use the first row. Their
JavaScript-shaped authoring source was statically lowered to F2EP; those screens
do **not** prove an embedded JavaScript engine.

The MicroQuickJS lane is different by design. Its package magic is `F2JS`, its
source transport is canonical UTF-8 rather than bytecode, and a device must
advertise the exact canary capability before Input Lab may offer a push. A
missing or mismatched capability is a hard refusal, not a reason to compile the
same project as F2EP.

## What “JavaScript on device” does and does not mean

The engine profile is `mquickjs-es5-strict-v1`. Write conservative ES5-style
code: `var`, function declarations/expressions, integers, booleans, strings,
arrays, and straightforward control flow. Do not assume browser or Node APIs.

The canary intentionally has no:

- `window`, `document`, `HTMLElement`, HTML parser, CSS cascade, layout engine,
  canvas, or `jsdom`;
- network, filesystem, process, console, random, wall-clock, dynamic timer, or
  module-loader native;
- `eval` or version-specific bytecode transport;
- direct LVGL or framebuffer call from JavaScript.

`deviceRunsJsdom` is always `false`. Full `jsdom` is a Node-oriented DOM
implementation and is not the architecture for this keyboard. HTML/CSS may be
used by host tooling to produce a bounded raster base or deterministic renderer
assets, but it is not parsed or laid out by MicroQuickJS.

The package can declare up to 16 DOM-shaped target IDs and writable properties
(`textContent`, `color`, and `hidden`). Those records reserve the boundary for a
future small native facade. The current canary exposes no `document` API and no
target getter. Declaring a target today does not make this valid:

```js
document.getElementById("time").textContent = "05:00"; // Not supported.
```

Use the 16-slot integer facade described below. The weather canary now has a
separately versioned, statically tested `F2TF` companion, but that specialized
consumer is not a general DOM and is not linked into firmware.

## Frozen profile and package identity

The current exported values are:

| Property | Exact value |
| --- | --- |
| Profile ID | `framer-f1-render-v2-mquickjs-v1` |
| Package format | `framer-render-v2-mquickjs-package-v1` |
| Package magic/version | `F2JS` / `1` |
| JavaScript profile | `mquickjs-es5-strict-v1` |
| Engine commit | `203d5bb79789bc47b74855d9207415dab71661a0` |
| Package ABI SHA-256 | `5091736403d809078cbbf12a1b593fbabaff53474a0935a7e00ce81dc8bd67f8` |
| Required source prefix | exact bytes `"use strict";\n` |
| Source transport | canonical UTF-8 source plus one NUL; never bytecode |

Import these values rather than duplicating them in an application:

```js
import {
  RENDER_V2_MQUICKJS_ENGINE_COMMIT,
  RENDER_V2_MQUICKJS_PACKAGE_ABI_SHA256,
  RENDER_V2_MQUICKJS_PACKAGE_FORMAT,
  RENDER_V2_MQUICKJS_PROFILE_ID,
  RENDER_V2_MQUICKJS_SOURCE_PREFIX,
} from "framer-f1-research-widget-sdk/renderer-v2";
```

The SDK prepends the strict prefix if it is absent. The prefix counts against
the 8,192-byte source limit. Source must be NUL-free canonical UTF-8; the
package adds exactly one terminating NUL. A package builder success proves
container admission, not that MicroQuickJS has parsed every language construct
in the source. Engine execution tests remain a separate gate.

### Resource limits

| Resource | Limit |
| --- | ---: |
| Complete `F2JS` package | 98,304 bytes |
| JavaScript source, including strict prefix | 8,192 UTF-8 bytes |
| Caller-owned engine heap | 65,536 bytes |
| Caller-owned runtime storage | 4,096 bytes |
| Cooperative deadline per callback | 2,000 microseconds |
| Registered event handlers | 16 |
| Declared UI targets | 16 |
| Declared keys | 16 |
| Declared exact chords | 8 |
| Keys in one exact chord | 2–4 |
| Event declaration records | 32 |
| Native input queue records | 32 |
| Pending logical input snapshots | 64 |
| Debounce | 1–50 ms; default 10 ms |
| Hold delay | 100–5,000 ms; default 500 ms |
| Hold cadence | 20–1,000 ms; default 100 ms |
| Optional raster base | exact 62,404-byte, one-frame, 100×310 `F1WB` |

Key IDs must be contiguous from zero and map to unique opaque unsigned 32-bit
native tokens. Token zero is valid. Chord IDs are also contiguous from zero;
each chord is a unique, order-independent, exact held mask containing two to
four admitted keys. Host RPC IDs are unique nonzero integers in `1..65535`.
Package generation zero is reserved.

## Runtime API

The global `widget` object has five methods. All state access is callback-only.

### `widget.on(name, callback)`

Registers one callback for an exact event selector while the program is
loading. `name` must be one of the fixed event names or one declared
`host.rpc:<id>` selector. There is a 16-handler total. Registration is not
allowed from an event callback.

```js
widget.on("tick.1s", function (event) {
  // Work is bounded by the callback deadline.
});
```

### `widget.getInt(slot)`

Returns one pending signed 32-bit slot, where `slot` is `0..15`. Each callback
starts from the last successfully published 16-slot snapshot.

### `widget.setInt(slot, value)`

Writes one pending signed 32-bit slot. It does not publish by itself.

### `widget.commit()`

Requests publication of the complete 16-slot snapshot after the callback
returns successfully. Multiple calls in one callback still request one
publication. If the callback does not commit, its pending writes are discarded
on the next callback. A throw, timeout, OOM, or publication failure must never
expose a partial slot set.

```js
widget.on("host.rpc:0x7001", function (event) {
  widget.setInt(0, event.value);
  widget.setInt(1, event.auxiliary);
  widget.commit();
});
```

### `widget.isHeld(event, keyId)`

Reads `keyId` from the immutable-by-contract `heldMask` snapshot carried by
that event. It works for tick, knob, host RPC, key, and chord callbacks, not
only key events. The key ID must have been admitted by the package.

```js
widget.on("input.fn-bottom-knob", function (event) {
  var step = widget.isHeld(event, 0) ? 60 : 5;
  widget.setInt(0, widget.getInt(0) + event.delta * step);
  widget.commit();
});
```

This is the intended key-plus-knob pattern: the knob event is the trigger and
the key's level in the same event snapshot is the modifier. It does not need a
second RPC or an ordering guess.

## Events and callback fields

The exact admitted event-name set is `tick.100ms`, `tick.1s`,
`input.fn-bottom-knob`, `host.rpc:<1..65535>`, `input.key.down`,
`input.key.up`, `input.key.hold`, `input.chord.down`, and `input.chord.up`.
The angle-bracket form describes the allowed host-ID range; source registers a
concrete decimal or `0x` hexadecimal ID.

Every callback receives a fresh event snapshot with these common fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `type` | string | Canonical runtime event type |
| `sequence` | uint32 | Monotonic nonzero runtime sequence; exhaustion disables the runtime rather than wrapping |
| `timestampMs` | uint32 | Monotonic millisecond timestamp with wrap-safe comparisons; not wall-clock time |
| `heldMask` | uint16-shaped number | Exact admitted-key levels for this event snapshot |
| `synthetic` | boolean | `true` for recovery/resynchronization edges rather than a normal debounced physical edge |

Event-specific fields are:

| Subscription | `event.type` | Additional fields |
| --- | --- | --- |
| `tick.100ms` | `tick.100ms` | `value`, `auxiliary` (signed int32 adapter payloads) |
| `tick.1s` | `tick.1s` | `value`, `auxiliary` (signed int32 adapter payloads) |
| `input.fn-bottom-knob` | `input.fn-bottom-knob` | `delta` (signed detents), `fn` (`true`), `auxiliary` |
| `host.rpc:<id>` | `host.rpc` | `id` (1..65535), `value`, `auxiliary` |
| `input.key.down` | `input.key.down` | `key`, `repeat` (`false`), `holdCount` (`0`), `reason` |
| `input.key.up` | `input.key.up` | `key`, `repeat` (`false`), `holdCount` (`0`), `reason` |
| `input.key.hold` | `input.key.hold` | `key`, `repeat` (`true`), `holdCount` (starts at 1), `reason` |
| `input.chord.down` | `input.chord.down` | `chord`, `reason` |
| `input.chord.up` | `input.chord.up` | `chord`, `reason` |

Do not assign undocumented meaning to tick or `auxiliary` values. The physical
adapter must define them in its capability contract first. A host RPC handler
subscribes with its ID (`host.rpc:28673` or `host.rpc:0x7001`) but sees the
general type `host.rpc` plus `event.id`.

Input reason codes are stable in the current canary:

| Code | Name | Meaning |
| ---: | --- | --- |
| 0 | physical | Normal debounced physical input |
| 1 | focus loss | Synthetic release when focus/screen ownership is lost |
| 2 | disconnect | Synthetic release during device/session disconnect |
| 3 | queue resync | Synthetic edge reconstructed from the authoritative held bitmap after overflow |

Key events use one shared selector; filter `event.key` in the callback. A hold
is cadence-coalesced and is not a stream of raw auto-repeat messages. A chord
matches only when the complete held mask exactly equals its declared mask. If
one exact chord changes directly into another, chord-up is emitted before
chord-down. Every key/chord event's `heldMask` is the state after the triggering
transition.

### Multiple trigger examples

Use the held snapshot for modifier combinations:

```js
widget.on("input.key.down", function (event) {
  if (event.key === 2 && widget.isHeld(event, 0) && widget.isHeld(event, 1)) {
    widget.setInt(7, 1);
    widget.commit();
  }
});
```

Use an admitted exact chord when the combination itself has down/up lifecycle:

```js
widget.on("input.chord.down", function (event) {
  if (event.chord === 0) {
    widget.setInt(7, 1);
    widget.commit();
  }
});

widget.on("input.chord.up", function (event) {
  if (event.chord === 0) {
    widget.setInt(7, 0);
    widget.commit();
  }
});
```

The full timer/key/chord/key-plus-knob example is in
[`../examples/render-v2-mquickjs-canary`](../examples/render-v2-mquickjs-canary).

## Build and inspect an `F2JS` package

The SDK builder is hardware-free:

```js
import {
  buildRenderV2MQuickJsPackage,
  decodeRenderV2MQuickJsPackage,
} from "framer-f1-research-widget-sdk/renderer-v2";

const built = buildRenderV2MQuickJsPackage({
  generation: 1,
  source: `
var turns = 0;
widget.on("input.fn-bottom-knob", function (event) {
  if (widget.isHeld(event, 0)) {
    turns = turns + event.delta;
    widget.setInt(0, turns);
    widget.commit();
  }
});`,
  events: {
    "input.fn-bottom-knob": true,
    hostRpcIds: [0x7001],
    keys: [{ id: 0, nativeToken: 0x10203040 }],
    chords: [],
  },
  input: { debounceMs: 10, holdDelayMs: 500, holdCadenceMs: 100 },
});

const inspected = decodeRenderV2MQuickJsPackage(built.binary);
console.log(inspected.sha256, inspected.budget);
```

The token in that snippet is synthetic. A real project is device-deployable
only after the exact physical token was observed through a proven stock-first
adapter and bound to the stable key ID. A browser `KeyboardEvent.code` is useful
for preview labels but is not a physical keyboard token.

`buildRenderV2MQuickJsPackage` canonicalizes and validates:

- a 128-byte little-endian header and four section directory entries;
- event and target records in canonical order;
- strict UTF-8 source and its SHA-256;
- SHA-256 of the complete package body;
- fixed heap/deadline/profile resource values;
- input timing, key, chord, target, generation, asset, and total-size bounds;
- an optional exact one-frame `F1WB` raster base at the same generation.

The SHA fields detect accidental or transport corruption. They are **not** a
signature and do not establish publisher authenticity. A production trust
model needs a separately authorized publisher/signature policy.

The current SDK does not parse JavaScript or prove that handler registrations
match the package's declaration records. The resident admission bridge must
bind those records to the runtime and reject undeclared event/host/key use
before the profile can be advertised.

### Declared target boundary

Target records may be authored as follows for future compatibility:

```js
const targets = [
  { id: "time", writes: ["textContent", "color"] },
  { id: "status", writes: ["textContent", "hidden"] },
];
```

IDs are unique 1–16 byte ASCII identifiers matching
`[A-Za-z][A-Za-z0-9_-]{0,15}`. The record allowlists writes; it does not create
a DOM or authorize arbitrary styles. Keep `targets: []` in executable canary
projects unless a separately versioned companion explicitly binds the exact
target records, package, generation, and raster base. Even then, device push
stays disabled until that consumer is linked, capability-versioned, and proven
on hardware.

## Exact capability gate

The future device capability response must match every field below, including
the string representation of numeric limits:

```js
const capability = {
  renderV2Profile: "framer-f1-render-v2-mquickjs-v1",
  packageFormat: "framer-render-v2-mquickjs-package-v1",
  packageAbiSha256: "5091736403d809078cbbf12a1b593fbabaff53474a0935a7e00ce81dc8bd67f8",
  engineCommit: "203d5bb79789bc47b74855d9207415dab71661a0",
  javascriptProfile: "mquickjs-es5-strict-v1",
  deviceEvaluatesJavaScript: true,
  deviceRunsJsdom: false,
  maxPackageBytes: "98304",
  maxSourceBytes: "8192",
  heapBytes: "65536",
  callbackDeadlineUs: "2000",
  maxHandlers: "16",
  maxTargets: "16",
  maxKeys: "16",
  maxChords: "8",
};
```

Gate it with the SDK rather than loose truthiness checks:

```js
import { assessRenderV2MQuickJsCapability } from
  "framer-f1-research-widget-sdk/renderer-v2";

const assessment = assessRenderV2MQuickJsCapability(capability);
if (!assessment.compatible) {
  throw new Error(assessment.errors.join(" "));
}
```

The physical key recorder requires additional exact claims for the opaque-key
observation protocol, stock-first hook proof, and fixed owner-task queue. Those
claims do not exist on the accepted keyboard firmware today. Input Lab must
keep record/push disabled until both the engine profile and key capability pass.

## Input Lab authoring target

The current implementation boundary is narrower than the intended workflow.
The public SDK can build/decode `F2JS`, and Input Lab's reusable host library
models key down/up/hold, exact chords, overflow recovery, capability-gated
native observations, and held-key-plus-knob input. Those pieces are tested.
The visible Input Lab application does **not** yet expose a MicroQuickJS
JS/HTML/CSS project editor, execute user source in a MicroQuickJS worker, learn
physical tokens from a proven keyboard capability, or push `F2JS` packages to
the device. Its existing F2EP/raster workflow remains separate and usable.

The weather canary is likewise an offline package, host transport simulation,
and visual golden—not a selectable physical screen. ZIP/country/unit input,
provider networking, caching, and attribution belong to the host companion;
they must never be exposed as keyboard JavaScript APIs.

The intended Input Lab workflow is:

1. **Select a backend explicitly.** F2EP remains the deterministic default.
   MicroQuickJS is visibly labeled canary and cannot be selected for device
   push without exact capability negotiation.
2. **Author JavaScript against this guide.** HTML/CSS editors may describe a
   host-rendered base or future target manifest; they are not an on-device DOM.
3. **Declare resources.** Choose event selectors, RPC IDs, key IDs/tokens,
   exact chords, input timing, targets, and an optional raster base. Show every
   budget before build.
4. **Preview in isolation.** Browser key codes can drive the bounded key/chord
   simulator. User source must run in a dedicated isolated MicroQuickJS/WASM
   worker or equivalent sandbox, never the Input Lab page or server process.
   Ordinary browser JavaScript is a convenience preview, not engine parity.
5. **Learn physical keys only from capability-gated observations.** Display the
   opaque u32 token, level, timestamp, and observation sequence; ask the user to
   label it. Never invent a physical name from firmware position guesses.
6. **Build and decode locally.** Show package/source/body SHA-256, generation,
   engine/ABI identity, limits, and synthetic-token warnings.
7. **Export/import the complete project.** Preserve source, base asset, event
   declarations, target declarations, timings, labels, and device-specific key
   tokens. Make device specificity visible on import.
8. **Push only after a second capability check.** Require queued/busy/rejected
   delivery state and an applied generation/revision acknowledgement—not merely
   `{status: "ok"}`.
9. **Show live telemetry.** Surface VM enabled state, last result/revision,
   heap and task-stack high water, callbacks, commits, resets, exceptions,
   timeouts, OOM, publication failures, queue overflow/resync, pending events,
   and current held mask.

Input Lab's current browser key simulator can model down/up/hold/exact-chord
timing and overflow recovery on the host. That is useful authoring evidence,
not proof of the stock key hook, token learning, owner task, device runtime, or
weather delivery.

## Recovery and publication semantics

The isolated engine canary is designed around last-good state:

- candidate source and heap storage are caller-owned, immutable, NUL-terminated,
  and alive for the runtime lifetime;
- a candidate parse/load failure restores the prior accepted source;
- each callback starts with a copy of the last-good 16 slots;
- only a successful callback that requested `commit()` may publish;
- exception, cooperative timeout, OOM, sequence exhaustion, or publication
  failure leaves the prior last-good slots/revision visible and resets or
  disables the failing VM as appropriate;
- publication copies one complete 16-slot array plus an increasing revision;
  JavaScript never calls UI code directly.
- one owner-task drain attempts at most three queued JavaScript callbacks. A
  normal pass is therefore bounded to 6 ms; if the third callback fails, one
  reserved 2 ms recovery keeps the theoretical cooperative slice at 8 ms.
  Later FIFO snapshots remain pending and the adapter must yield and reschedule
  them after recovery rather than spinning or dropping them.

The native canary enforces this contract around its `publish()` callback. The
physical adapter's atomic mailbox and UI consumer are not implemented yet, so
these semantics are not a device guarantee today.

### Hidden-screen policy

`F2JS` v1 does not contain a hidden-screen policy field and the physical policy
is still unproven. The fail-closed first canary should implement and test this
screen-scoped policy before advertising capability:

- do not execute JavaScript or replay queued tick/knob/key callbacks while the
  widget is hidden;
- keep showing/retaining the last-good frame and slot revision;
- continue bounded native level bookkeeping, discard screen-scoped actions,
  and synthesize release/resync so no key remains logically stuck;
- on re-entry, consume one stable mailbox snapshot, reconcile held state once,
  and resume fresh ticks without a backlog burst;
- quiesce the VM before any flash/NVS operation that disables external-memory
  cache.

That is a proposed integration requirement, not an already shipped behavior.
If a future widget needs background work, it needs an explicit separately
versioned policy and scheduler budget rather than silently changing v1.

## Weather and other coherent snapshots

Weather demonstrates why scalar RPC events are not enough. Current `host.rpc`
callbacks carry only one signed `value` and one `auxiliary` value. Sending
current conditions plus three forecast days as independent visible writes can
show a mixed revision after loss, reorder, timeout, or screen transition.

The frozen offline weather canary at
[`../examples/render-v2-mquickjs-weather-canary`](../examples/render-v2-mquickjs-weather-canary)
implements a bounded revision-stage-commit protocol over declared host RPCs and
uses `tick.1s` for freshness. Generation 18 has package SHA-256
`88537026c8b217b763c393b82d8787ca08256681265976f7bcff6077b2282d20`
and source SHA-256
`68db9d61fa38b0a396e46e88076d75d262a486f2ec4b41b4d398454d7d713e9b`.
The exact source runs in the pinned host MicroQuickJS canary with 61,496-byte
normal heap high-water, leaving only 4,040 bytes in the fixed 65,536-byte heap.
That proves a useful workload and warns that production headroom is tight.

The companion `F2TF` weather facade is 1,375 bytes with SHA-256
`d9e2ce701755423dc9d843eace93f51f982d1f5cb7c231c6fb9a5f1f1dc9bc94`
and contract SHA-256
`8220152a09348da34cdd70dd7d370197f2f3fc46a9f45e50d7fb7015bdb8579a`.
Its host oracle and freestanding C consumer match pixel-for-pixel across 11
weather/error/torn-state cases. The frozen Xtensa object has SHA-256
`99f3d9c3c8bb81a7472856e3664220d5d92520c89533d8d672bad66fdf530521`,
4,364 text bytes, 72 read-only bytes, and no undefined symbols or writable
globals. Those are offline results; the consumer is not linked into stock UI.

The host owns ZIP validation, geocoding, provider fetch, caching/backoff, and
attribution. It sends normalized packed records; MicroQuickJS has no network or
provider credentials. The deterministic provider used by tests implements the
same host boundary without network access.

Before this package can honestly appear as a deployable Input Lab screen, the
physical path still needs all of the following:

- begin/stage/commit records carrying one shared nonzero revision;
- atomic visibility only after every required record and matching commit;
- queued/busy/rejected flow control plus an **applied revision** response;
- last-good snapshot retention across partial delivery, disconnect, hidden
  screen, parse failure, timeout, and reboot policy;
- signed bitfield decode and bounded temperature/number formatting at the edge;
- provider caching, backoff, attribution, location disambiguation, and a clear
  statement that network fetch occurs on the host, not inside MicroQuickJS.

Do not interpret the host simulation as a physical acknowledgement. The
package declares 16 target IDs, and `F2JS` v1 target records only authorize
text/color/hidden writes. The frozen `F2TF` companion proves one bounded mapping
offline, but there is no linked or physically measured slot-to-pixel consumer.
The exact applied-revision RPC and hidden-screen lifecycle are also not linked
into the accepted firmware. `screen.pushAllowed` therefore remains `false`.

The same revision-staging rule applies to media metadata, multi-field timers,
or any host snapshot whose fields must be coherent.

## Security and trust boundaries

Treat widget JavaScript and its package as untrusted input:

- validate the complete `F2JS` header, section bounds, reserved bytes, canonical
  order, UTF-8, NUL, hashes, event records, target ASCII, asset, and exact
  profile before mapping the source into the VM;
- reject undeclared event handlers and target writes at the admission boundary;
- keep the fixed heap, deadline, owner task, event rings, and mailbox bounds;
- keep JS/GC off stock key, HID/RPC producer, LVGL, and cache-disabled paths;
- do not expose generic native pointers, network, filesystem, module loading,
  `eval`, firmware RPC, or flash APIs to JavaScript;
- keep source/package integrity separate from publisher authenticity;
- do not advertise the capability after parser, map, task, hook, mailbox, or
  recovery failure;
- teardown in order: disable capability/ingress, remove the stock-first hook,
  quiesce producers, stop/drain the owner task, destroy the VM, then unmap.

The package's optional raster base is data, not permission to execute native
code. The mapped MicroQuickJS module is separately pinned and page-hashed by the
resident loader.

## Proven versus unproven

| Claim | Current evidence | Status |
| --- | --- | --- |
| F2EP clock/timer on the accepted keyboard | Physical receipt and manual screen tests | Proven for F2EP only |
| Deterministic `F2JS` build/decode, mutation rejection, exact capability comparison | SDK Node tests | Proven offline |
| Real MicroQuickJS parses/runs bounded source with fixed heap, deadlines, recovery, key/chord model, and moving-GC checks | Host native/ASan canary verifier | Proven offline |
| Deterministic ESP32-S3 code generation with no unresolved imports/relocations | Pinned Xtensa cross-link verifier | Proven offline |
| Module fits fixed executable/read-only pages and resident loader fits the healthy app cavity | Static layout/MMU/loader verifier | Proven offline |
| Full-page SHA-256 admission and descriptor checks | Native known-answer/tamper tests | Proven offline |
| Resident raw-byte `F2JS` parser and SDK parity | 1,205-case, 33,283,948-byte mutation corpus plus native sanitizer and deterministic Xtensa build | Proven offline |
| Dedicated owner architecture, 12 KiB task stack, fixed heap, fair drain, single recovery owner | Native/sanitizer harness and unresolved-free Xtensa core | Proven offline; physical task not started |
| Atomic 16-slot resident mailbox | Threaded 72-byte seqlock torn-read test | Proven offline; physical UI consumer blocking |
| Weather `F2TF` slot-to-pixel facade | 11 pixel-exact host/C cases; frozen no-undefined Xtensa object | Proven offline; stock-UI link and physical timing blocking |
| Exact accepted-image startup/heap/static-task/UI/key/RPC seams | Full-span hashes and fail-closed stock bridge | Proven static; final resident link blocking |
| Weather generation-18 stage/commit, tick, signed temperature, hidden/last-good behavior | SDK/simulator tests and pinned-engine normal + moving-GC/ASan run | Proven offline; 4,040-byte heap headroom |
| Accepted setup-tail patch plus final resident/stock/module link | Tail jump is proven statically; combined image does not exist | **Unproven / blocking** |
| Applied-generation/revision and busy/rejected/queued RPC | Host state machine is tested; stock helper has no exact receipt ABI | **Unproven / blocking** |
| Generic engine/key/weather capability RPC | Registration seam is static-only; no physical receipt | **Unproven / blocking** |
| Stock-first physical key hook, stable token observations, normal keyboard preservation | Exact callback/literal and stock-first wrapper proven statically | **Unproven on hardware / blocking** |
| Hidden-screen policy and last-good recovery on device | Proposed above | **Unproven / blocking** |
| Task-WDT lifecycle and OOM/timeout/cache-off/soak behavior on physical hardware | No device receipt | **Unproven / blocking** |
| `jsdom` on device | Explicitly outside the architecture | Not supported |

## Physical canary checklist

Do not turn the profile on until all items have auditable artifacts:

1. Freeze the SDK ABI digest, engine commit, module descriptor ABI, source
   limits, event schema, and loader-enabled base-app SHA.
2. Pass the SDK, Input Lab, engine, moving-GC/ASan, deterministic Xtensa,
   full-page hash/tamper, loader teardown, and offline bundle verifiers.
3. Preserve the now-proven resident `F2JS` parser parity, including section
   arithmetic, high-bit target IDs, canonical UTF-8, asset nesting, body/source
   SHA, generation, heap/deadline, and exact profile checks; independently
   review the final frozen source and bind declarations to runtime handlers.
4. Patch and independently audit the exact stock setup-chain tail; preserve
   Music ID1, WPM ID7, clock ID26, timer ID27, and normal boot behavior.
5. Before the one-shot MMU map, measure sufficient internal free/largest-block
   heap. Treat first-map allocation failure as disable-and-reboot/rollback; do
   not retry against potentially inconsistent mapper state.
6. Map before allocating/starting the VM. Allocate the fixed JS heap in verified
   PSRAM and the event/control/task stack in internal RAM.
7. Create one dedicated VM-owner task. Queue tick, knob, host RPC, and key input;
   never parse, execute, collect, or render on producer/UI callbacks.
8. Link the proven stable even-sequence 72-byte mailbox to a bounded UI target
   consumer, then prove no partial frame under failure or concurrent reads.
9. Implement exact capability and health RPCs plus exact event/control and
   applied-generation/revision receipts. Keep them off until module, parser,
   task, mailbox, target facade, input hook, and rollback state are all healthy.
10. Install the key wrapper stock-first, prove down/up/hold/chord/modifier,
    overflow resync, focus/disconnect release, observation sequence, teardown,
    and unchanged normal typing/navigation.
11. Exercise valid source, parse rejection, exception, forced OOM, infinite-loop
    timeout, publish rejection, sequence limits, screen hide/show, USB loss,
    cache-off/flash quiescence, and cold/warm reboot.
12. Confirm manual behavior for all existing screens, collect heap/PSRAM/task
    stack/event/deadline telemetry, run a soak, read back exact bytes, and issue
    a physical SHA/receipt only after the results pass independent review.

## End-of-runway offline handoff

Run these commands from the repository root after the active canary/loader
sources are frozen:

```sh
npm --prefix f1-widget-sdk test
npm --prefix f1-widget-sdk run input-lab:test
node f1-widget-sdk/examples/render-v2-mquickjs-canary/build.mjs
node f1-widget-sdk/examples/render-v2-mquickjs-weather-canary/build.mjs
node f1-widget-sdk/examples/render-v2-mquickjs-weather-canary/verify-native.mjs
node experiments/mquickjs-esp32s3-canary/verify.mjs
node experiments/mquickjs-esp32s3-module-loader/verify.mjs
node experiments/mquickjs-esp32s3-resident-integration/verify.mjs
node experiments/mquickjs-esp32s3-stock-bridge/verify.mjs
node experiments/mquickjs-target-facade/verify.mjs
node experiments/mquickjs-canary-bundle/verify.mjs
```

The final command cross-checks the public SDK/package ABI against the engine,
loader, resident, stock-bridge, and target-facade manifests. It hashes the
accepted app/receipt, padded module pages, resident loader, exact composed
module slot, resident/stock cores, canonical timer/key/chord package,
generation-18 weather package, and its `F2TF` companion; it also reruns native
engine, weather, and pixel-exact target-facade execution. It writes one report at
`experiments/mquickjs-canary-bundle/build/readiness-manifest.json` with status
`PASS_STATIC_ONLY_NOT_FLASHABLE`, physical verdict `NOT_FLASHABLE`, and
intentionally emits no flash command.

The reserved fixed module layout is:

| Region | Flash range | Required mapped address |
| --- | --- | --- |
| Slot A executable page | `[0x210000, 0x230000)` | `[0x423d0000, 0x423f0000)` |
| Slot A read-only page | `[0x230000, 0x240000)` | `[0x3c3f0000, 0x3c400000)` |
| Complete slot A | `[0x210000, 0x240000)` (192 KiB) | n/a |

For a future approved physical update, the recoverable ordering is module slot
first with exact readback verification, then the matching loader-enabled app
last. That ordering is documentation, **not authorization to write either
region now**. There must be no flash command or user approval request until the
physical target-facade integration, exact applied-revision RPC, final linked app,
producer/key-source cache-off quiescence, task-WDT lifecycle, exact
capability/device receipt, and physical recovery/telemetry/rollback/soak proof
all exist.

Related evidence and design documents:

- [`../../experiments/mquickjs-esp32s3-canary/README.md`](../../experiments/mquickjs-esp32s3-canary/README.md)
- [`../../experiments/mquickjs-esp32s3-module-loader/README.md`](../../experiments/mquickjs-esp32s3-module-loader/README.md)
- [`../../experiments/mquickjs-esp32s3-stock-bridge/README.md`](../../experiments/mquickjs-esp32s3-stock-bridge/README.md)
- [`../../experiments/mquickjs-target-facade/README.md`](../../experiments/mquickjs-target-facade/README.md)
- [`../../experiments/mquickjs-canary-bundle/README.md`](../../experiments/mquickjs-canary-bundle/README.md)
- [`render-v2-mquickjs-weather-canary.md`](render-v2-mquickjs-weather-canary.md)
- [`renderer-v2.md`](renderer-v2.md)
- [`weather-render-v2-audit.md`](weather-render-v2-audit.md)
