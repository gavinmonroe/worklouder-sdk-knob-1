# 15 — Widget Designer push (render-v2, screen 26)

How the Widget Designer gets a widget onto the keyboard, and why it does not
go through mquickjs.

## Why not mquickjs / screen 28

The designer's original Push button was gated on
`widget.mquickjs.cap` page 0 reporting `uploader=1`. It never can:

- `uploader=0` is a **compile-time string literal**
  (`experiments/mquickjs-esp32s3-runtime-proof/runtime_proof.c:259`).
- The whole mquickjs RPC surface is `cap`, `telemetry`, `event`, `receipt`
  (`runtime_proof.h:67-70`). There is no method that receives a package.
- The approved posture is `boot-lifetime-read-only-no-uploader-no-runtime-unmap`,
  and `mquickjs-device-canary-workflow/contract.mjs:273` fails the build if that
  string changes.

Screen 28 scenes ship in flash. That is the design, not a gap.

## The path that does work

The stock renderer's scene RPC — `widget.scene.begin / write / commit` — accepts
packages at runtime into a **RAM** scene store. A power cycle reverts to the
firmware's boot scene; no flash region is written.

But carrying the RPC is not enough. Two admission profiles exist:

| Firmware | `renderV2Profile` advertised | Admits |
|---|---|---|
| clock+timer, mqjs weather | *(none)* | only its one pinned package |
| **input-lab-generic** | `framer-f1-render-v2-structural-v1` | any structurally valid package |

The designer reads the profile directly from `widget.scene.capabilities`
(firmware 4e045ec2+) and gates Push on `genericPackages === true`, so a build
that carries the scene RPC but only accepts its own pinned package is refused up
front rather than failing mid-transfer. It also takes `committedGeneration` from
the same response, so nothing has to probe for it.

## Package format

A **standalone F1WB** — no F2EP tail. The device's generic gate
(`renderer-v2-generic-scene-rpc-core.c:175`) skips the F2EP branch entirely when
`total_bytes == bundle_bytes`, and `basic_f1wb`
(`renderer-v1-scene-rpc-core.c:368`) then requires:

```
magic F1WB · version 1 · capacity 3 · 1..3 slots · activeSlot < count
u32@8  == generation      (must be committedGeneration + 1)
u32@12 == bundle_bytes
u16@16 == 104   u16@18 == 332
bundle_bytes <= 98304
```

The designer rasterizes the live preview to 100×310 RGB565 (see *Where the
pixels come from*), wraps the frames as an F1RA raster slot, and wraps that as a
one-slot F1WB. `src/compiler/renderV2Package.ts`
is a byte-exact browser port of the SDK encoders — `test/renderV2Package.test.ts`
re-encodes a package the firmware has already accepted and compares bytes.

Generation is restamped at push time (`rewriteGeneration`), because only the
keyboard knows its `committedGeneration` and the gate compares the two exactly.

## Flashing the generic app

The designer needs the `input-lab-generic` app in the app region. This is an
**app-only** write; slot A (`0x210000`–`0x240000`, the mquickjs module) is never
touched and survives untouched.

Cost: while this app is flashed, screen 28 / weather-mquickjs is not active.
Restoring is the same one-command operation in reverse.

| | SHA-256 | File |
|---|---|---|
| Target | `371ee26e…c98f06` | `f1-widget-sdk/build/combined-renderer-v2-generic-input-lab/framer-0.4.1-input-lab-renderer-v2-generic-id26-app.bin` |
| Restore | `5413d4b8…8565dd` | `experiments/mquickjs-esp32s3-physical-canary/releases/2026-08-18-id28-persist-btp1/framer-0.4.1-mqjs-id28-weather-zip-persist-btp1-app.bin` |

Both are six-segment images of the pinned 2,062,912-byte size, so both pass the
deploy tool's structural gate.

### 1. Enter the ROM bootloader

```bash
node recovery/enter-bootloader.mjs
```

Then confirm the port appears:

```bash
ls /dev/cu.usbmodem*
```

### 2. Write the generic app

Fast-diff against the exact bytes believed live, so a mismatch aborts before any
write:

```bash
node experiments/mquickjs-device-canary-workflow/deploy-app-only.mjs --app f1-widget-sdk/build/combined-renderer-v2-generic-input-lab/framer-0.4.1-input-lab-renderer-v2-generic-id26-app.bin --expect-live-app experiments/mquickjs-esp32s3-physical-canary/releases/2026-08-18-id28-persist-btp1/framer-0.4.1-mqjs-id28-weather-zip-persist-btp1-app.bin --port /dev/cu.usbmodemXXXX --out experiments/mquickjs-device-canary-workflow/receipts/2026-08-18-generic-input-lab/app --confirm APPONLY_371EE26EBB74C37F --execute
```

### 3. Push a widget

Open the designer, Connect → Identify. The gate line should read *"Device admits
generic render-v2 packages. Push targets screen 26 at generation N."* Build
package → Push to device. One push per boot — power-cycle before pushing again;
a second attempt reports `code 1` (busy) rather than an unexplained error.

### Rolling back to mquickjs

Same command with the two files swapped and the token
`APPONLY_5413D4B8735B4370`.

## Where the pixels come from

Pixels are captured from the **live preview iframe**, so what ships is what you
see — including DOM the widget script mutated.

That iframe is sandboxed `allow-scripts` *without* `allow-same-origin`, so it
sits in an opaque origin: `contentDocument` is null and
`contentWindow.__widgetRuntime` is unreachable. (`bindWidgetRuntime` has
therefore always thrown, which is why the "live runtime" dispatch path never
actually ran.) The shim now exposes a postMessage bridge — `widget:snapshot`,
`widget:dispatch`, `widget:reset` — the one channel that crosses an opaque
origin. The designer asks for serialized body markup, wraps it in
`<svg><foreignObject>`, and draws it to a canvas. The srcdoc references no
external resource, so the canvas is never tainted and `getImageData` stays
readable.

`cssScene`'s box model remains only as a fallback, and a lossy one:
`compileWidget()` never receives simulator slots or runtime DOM writes, so it
renders the widget's *initial* state. A capture that falls back says so in the
diagnostics.

## Animation

Frames are captured one `tick.1s` apart, matching the cadence the device
replays them at. Delta encoding makes extra frames nearly free — measured on the
V2 Events preset:

| Frames | Package | Chunks | Of 96 KiB ceiling |
|---|---|---|---|
| 1 | 62,404 B | 21 | 63.5% |
| 10 | 64,804 B | 22 | 65.9% |
| 20 | 66,992 B | 22 | 68.1% |

Capture runs ~2 ms/frame. There is deliberately **no paint wait** between
advance and snapshot: the shim mutates the DOM synchronously before it replies,
and the snapshot reads serialized DOM rather than painted pixels. An earlier
`requestAnimationFrame` wait made a 20-frame capture take 18 s in a backgrounded
tab, where rAF never fires; removing it cut that to 30 ms.

If a capture will not fit the scene store, trailing frames are dropped and the
kept count is reported, rather than failing a capture you already waited for.

## Proven end-to-end (2026-08-18)

Pushed to real hardware on the generic build, routed around the broken
capabilities RPC:

```
detect: {"sceneAlive":true}          via widget.scene.status
build : 62,404 B · 21 chunks
begin : {"status":"ok"}
write : 21 chunks {"status":"ok"}
commit: {"status":"ok"}              generation 1 live on screen 26
```

Reproduce with `experiments/mquickjs-device-canary-workflow/prove-render-v2-push.mjs`
(`--dry-run` builds and validates with no device; `--confirm-live-rpc` pushes).

### capabilities: fixed in 4e045ec2 (was fatal in 371ee26e)

`widget.scene.capabilities` used to fault the generic build every time
(LoadProhibited, EXCVADDR 6, PC 0x42106f58).

**Cause: stack-backed JSON strings.** The stock JSON layer stores *pointers* and
serializes after the handler's frame is gone. The one field that always worked
says why, in the handler's own comment:

```
/* status/ok are persistent RAM substrings in the accepted scene state. */
```

`status`/`ok` come from `state+192/+200/+313` — persistent RAM. Every other key
and value was built on the stack, so by serialization time they dangled.
`device-workflow.mjs` blacklists `371ee26e` for exactly this: *"the protocol and
v1Packages fields reuse borrowed **stack-backed** JSON key/value storage."*

**Two fixes that did NOT work** (build `df92b3e5`, reverted): adding 64 bytes of
frame headroom, and de-aliasing by removing `v1Packages`. Both treated *"reuse"*
as the defect. The operative word was *"stack-backed"*.

**The fix** (`4e045ec2`): every key and value moved to persistent RAM. The scene
RPC allocation grows `98_624 -> 99_136`, `store[98_304]` keeps its pinned +320
offset, and a 512-byte region at the tail holds the table (252 B used).
`init_strings` writes it once at registration.

Growing is safe to attempt because `renderer_scene_rpc_register` null-checks
`operator new` and falls through to `.Lscene_register_fail` (returns 0): a
failed allocation means the scene RPC simply does not register — visible at once
because `widget.scene.status` stops answering, and fixed by reflashing. Verified
across 4 power cycles: capabilities answered every time.

Live result:

```json
{ "status": "ok",
  "renderV2Profile": "framer-f1-render-v2-structural-v1",
  "packageFormat": "framer-render-v2-package-v1",
  "maxBundleBytes": "98304", "chunkRawBytes": "3072", "maxChunks": "32",
  "committedGeneration": "0" }
```

`committedGeneration` is now readable, so hosts no longer have to probe for it.

### Status codes

Handlers used to flatten every core return value to a boolean, so BUSY,
GENERATION, RANGE and PARAMS all arrived as the same bare `{"status":"error"}`.
`reply_status` now carries the code, using the same persistent-storage rule.
Codes are negated to small positives: `BUSY=1, PARAMS=2, GENERATION=3, RANGE=4,
ORDER=5, SHA=6, TORN=7, F1WB=8, STAGE=9, V2=10; REJECTED=0`.

A second push in one boot now answers `{"status":"error","code":"1"}` — proving
the one-push limit is the producer-slot latch (BUSY), not a generation
mismatch. That distinction previously took hours to infer.

### One push per boot

The build's manifest documents `repeat=1`, `commit_window=busy`,
`hidden=busy`, `commitAckWindowReturnsBusy`, `hiddenScreenWaitsForUiTick`. A
second `begin` in the same boot was refused at both generation 0 and 1, so it is
not a generation mismatch. Power-cycle between pushes; showing screen 26 may
also be required. The designer surfaces this after a successful push.

## The device does not run your JavaScript

This is the most important thing to understand about the push. The F1 replays
**captured raster frames**; the widget's script runs in the browser during
capture, never on the device. So:

- `Frames = 1` (the default) pushes a **still**. A clock will not tick.
- `Frames = 10/20` pushes that many snapshots taken one `tick.1s` apart, and the
  device loops them. That is recorded motion, not a running script.
- Knob and key handlers do nothing on device. Live behaviour needs F2EP, which
  is not ported.

## The preview must stay mounted

`Workspace.tsx` used to render the design tab conditionally, so the preview
iframe **did not exist while the Device tab was showing** — which is the tab you
build and push from. Every capture found no iframe and fell through to the box
model: one static frame, dim for `events`, fully black for `weather`. The
symptom looked like a device or firmware fault; the tell was a package of
exactly 62,404 B (a one-frame package) while Frames was set to 10.

The design tab now stays mounted and is hidden with `display:none` on other
tabs. A hidden iframe still loads and runs its scripts, and the capture
rasterizes from serialized DOM rather than painted pixels, so hiding costs
nothing — and widget state now survives tab switches. If the preview is ever
genuinely missing, the build says so instead of silently shipping a still.

Verified building from the Device tab:

| | before | after |
|---|---|---|
| frames captured | 1 | 10 |
| weather, first frame | 0 lit (black) | 8,097 lit |
| events package | 62,404 B | 64,804 B, 9 non-zero deltas |

## Capture readiness

Switching presets replaces the iframe's srcdoc, and **until the new document
loads the OLD one still answers the postMessage bridge — instantly, with stale
markup**. "Does the bridge reply" is therefore not a readiness test.

`waitForPreview(iframe, marker)` polls until both the applied srcdoc and the
body the frame reports contain the current widget's `rootClass`. Measured on
back-to-back preset switches with no settle time, it waits ~1 s and then
captures correctly; without it the capture returned the previous widget or a
blank frame.

If capture fails and the box-model fallback has **no boxes**, the build is now
refused rather than shipped. The fallback only understands the F1SC subset —
for the weather preset it produces 0 boxes and rasterizes to pure black, which
looked exactly like a device fault:

| preset | fallback boxes | fallback lit pixels |
|---|---|---|
| events | 10 | 673 |
| weather | 0 | **0 — fully black** |

## Host data: nobody writes an offset

One schema is the source of truth (`src/data/schemas.ts`). A record lists its
fields **in order with widths**, and offsets are *derived* by packing
sequentially from bit 0:

```ts
current: {
  id: 0xB241,
  fields: {
    temperature: { bits: 10, signed: true },   // -> offset 0
    condition:   { bits: 4, labels: CONDITIONS }, // -> offset 10
    isDay:       { bits: 1 },                  // -> offset 14
  },
},
```

That derivation reproduces the SDK's real wire layout exactly;
`test/schemas.test.ts` pins it against an independent re-implementation of
`f1-widget-sdk/src/render-v2/weather.mjs`, including the hardware-verified
payloads (`16456`, `16853050`, …). Reorder a field and the tests fail rather
than the device rendering nonsense.

The same schema drives **both** sides:

* `encodeSnapshot()` builds the host events, so samples are generated, not
  hand-computed literals
* `widget.snapshot(name, ...)` decodes them in the runtime shim

so a layout change lands on both at once and cannot drift.

A widget names its data source and gets values:

```js
widget.snapshot("weather", {
  apply: function (data) {
    document.querySelector("#temp").textContent = data.current.temperature;
    document.querySelector("#condition").textContent = data.current.conditionLabel;
  },
});
```

No ids, no offsets, no masks, no sign extension, no staging, no torn-snapshot
handling. Fields declaring `labels` also arrive as `<field>Label`, so widgets
render names instead of magic numbers. `apply()` runs only when the commit
revision matches the begin **and** every declared record has arrived.

Verified live: placeholders become `72° Sunny / Mon 58/74 / Wed 55/70 /
LIVE 42` from the generated events; incomplete and revision-mismatched
snapshots are both ignored.

### Live data

A schema may declare a `source` — a label, an input hint, and a `fetch()` that
returns record values. The Designer renders **one generic control** for it:
nothing in that UI knows what weather is, so a new schema with a source gets
live data with no new code.

`WEATHER_SCHEMA.source` calls Open-Meteo (no key, permissive CORS), maps WMO
codes to the declared condition ids, and clamps temperatures to the declared
field width so a freak reading cannot break packing.

Verified live end to end on hardware:

```
Fetch live from Open-Meteo -> "Live weather from Chicago, Illinois"
preview                    -> 76° · Wed 64/77 · Thu 65/84 · Fri 67/83
Build (10 frames)          -> RENDER-V2 62,476 B · 10F
Push                       -> Generation 1 committed, 21 chunks
```

Order matters: the device replays captured frames, so **fetch first, then
Build**. Build before fetching and you ship the placeholders.

### Running the server from the Designer

A browser cannot spawn a process, so "run your server" used to mean "download
this and run it in a terminal". The **dev server** can spawn it, so the Host
data tab has Run / Stop / Restart directly.

`hostServerRunner` in `vite.config.mjs` is registered under `apply: "serve"`, so
it exists only in dev. It writes the generated source to a temp file, spawns it
with the same Node that serves the app, tracks one process at a time, buffers
stdout/stderr, and kills any child when the dev server closes. A server that
exits immediately reports why:

```
POST /__host-server/start -> running: true, pid 72299, log: "Host RPC server on http://localhost:842"
GET  :842/weather         -> real JSON
GET  /__host-server/stop  -> running: false, exit { signal: SIGTERM }
crashing server           -> exit { code: 1 }, log: "stderr: Error: boom: missing config"
```

Verified through the UI: Run -> Fetch and send -> "Live from weather host" ->
Stop.

### Host data belongs to the widget

There is **no global schema registry**. A widget carries its own schemas in
`DesignerWidget.hostData`, keyed by the name its script passes to
`widget.snapshot(name, …)`. That is what lets *any* custom widget have its own
RPC server rather than only the ones the Designer shipped with.

The **Host data** tab is the whole loop, and none of it is weather-specific:

1. **Declare** — a widget with no host data offers to add a schema; the JSON
   editor defines records, fields and widths. `fieldOffsets()` rejects a record
   that overflows its 32-bit payload before it can reach the widget.
2. **Test** — type values, Send, and they go straight into the live preview.
   Out-of-range values are rejected by field name rather than wrapping.
3. **Serve** — download a runnable Node server generated from that schema, with
   each field's width, derived offset, range and labels in comments.
4. **Connect** — point at the running server and fetch real values.

The generated server carries **no protocol knowledge** — no bit packing, no RPC
ids, no begin/commit sequencing. It returns numbers; the Designer packs them and
the runtime decodes them. `test/hostServer.test.ts` asserts that, stripping
comments and failing if `>>>`, `<<`, `begin` or `commit` appear in the emitted
code.

Verified with a schema the Designer had never seen — a CI/probe widget, not
weather:

```
schema applied   durationSec 12b @9 · celsius 9b @0 -256..255 · labels main dev release
Send             values -> host.rpc events, round-trip exact incl. celsius -12
generated server node pomodoro-host.mjs -> http://localhost:8431/data
GET /data        {"values":{"build":{...},"probe":{...}},"note":"pomodoro host …"}
```

### Bugs this surfaced

* The sample-event lists were **silently empty** — `SampleList` was typed
  `SimulatedEvent[]` but samples carry their payload at `.event`.
* The knob and key samples carried `value` where widgets read `delta` / `mask`,
  so those buttons dispatched events that did nothing.
* **Injected events never reached the preview.** `bindWidgetRuntime` cannot work
  against an opaque origin, so `runtimeDispatchRef` was always null and every
  event landed only in the bare simulator — slots moved, the preview did not.
  Dispatch now goes through the postMessage bridge.
* The shim's frozen event object exposed neither `delta` nor `mask`, which every
  knob and chord handler reads.
* The shim selects handlers by `event.name` while designer events carry `kind`;
  that normalisation now happens once in `dispatchToPreview`.
* **Reset never reset anything.** It zeroed the mailbox slots, but widgets keep
  state in plain `var`s, so the widget carried on from wherever it was. Reset
  now reloads the preview document, which re-runs the script from its initial
  values.
* The inspector's budget table read `MAX_*` names `MQUICKJS_LIMITS` never had,
  so every cap rendered `undefined` and `bytes.length` on a number gave `NaN`.
* `bindWidgetRuntime()` is **deleted**. It could never succeed against an opaque
  origin; callers caught its throw and silently fell back, which is what made
  event injection look broken for so long.

Typecheck errors: 46 -> 0.

Typecheck errors are down 46 → 21 as a result.

## Event-driven is PROVEN on hardware (2026-08-19)

A digits-only widget built by the Designer and pushed over the scene RPC ran as
an event program on screen 26: the digit advanced once per second from the
device's own `tick.1s`, and the bottom knob drove a second digit immediately.
No frame loop, no rasterizer on device.

```
package  67,068 B (F1WB 62,404 + F2EP 4,664) · 22 chunks · 2 bindings, 13 variants
push     committed, generation 1
observed digits updating on their own; knob controls working
```

### The bug that made an earlier attempt look like dead firmware

The first F2EP push committed cleanly and rendered a frozen widget. The device
was faithfully running the program; the patches painted nothing.

```
scene says cell 0 is at (0, 5)  -> lit pixels there: 0
browser actually draws the text at rows 134-165
```

Variant pixels were being located with the **F1SC scene's** cell grid but
captured from the **browser's** render, and the two layouts differ by ~130px, so
every variant captured identical background.

Patch rects are now derived by diffing each variant against the base frame
(`unionChangedRect`), so no geometry model is involved and the two cannot drift
apart. `captureBindingPatches` refuses to emit a binding whose variants change
no pixels, because shipping one looks exactly like a dead widget.

## Event-driven (F2EP) vs frames

The Device tab has two modes. **Event-driven** ships an F2EP program: the device
computes state from its own events and each binding selects a pre-rendered pixel
variant, so knob/key/tick change pixels immediately. **Frames** ships captured
snapshots the device replays; it ignores input.

The Designer imports the SDK's real compiler
(`f1-widget-sdk/src/render-v2/compiler.mjs`) rather than reimplementing it, so
the two cannot drift. Two shims make those Node-targeted modules load in a
browser: `src/compat/node-crypto.ts` (synchronous SHA-256) and
`src/compat/buffer.ts`.

**Install the globals with a SIDE-EFFECT import** (`src/compat/install.ts`)
placed above any SDK import. ES imports are hoisted, and `render/css-scene.mjs`
touches `Buffer` at its own top level, so calling an install function from the
app entry runs too late and the page renders blank with
`ReferenceError: Buffer is not defined`. `tsc` and `vite build` both pass while
this is broken; only the browser catches it.

Measured on the `events` preset: 8 bindings, 73 variants captured from the live
preview in ~80 ms, a 12,912-byte F2EP program, and a 75,316-byte package
(F1WB 62,404 + F2EP) in 25 chunks.

### Hard limits a widget must fit

* **64 patch variants total.** The `events` preset needs 73 (6 clock digits x 10
  + knob 3 + host 10) and is refused. `focusDial` uses 12, `pomodoro` 10.
* **Atlas coverage.** `createReadableDemoGlyphAtlas` has bitmaps for
  `0-9 : E N T V` only, so `pomodoro`'s "WORK"/"REST" cannot render even though
  it fits the variant budget.

Both are real ceilings, not Designer bugs, and both are reported with the SDK's
own message.

### Which widgets qualify

`describeEventCapability()` in `src/compiler/eventCapability.ts` answers this
cheaply (no iframe, no pixel capture) and returns the SDK's verbatim reason.

| preset | event-driven | bindings |
|---|---|---|
| events | yes | 8 |
| focusDial | yes | 3 |
| pomodoro | yes | 3 |
| weather | **no** | — |

`weather` cannot convert: its nested `<div>` markup violates "root must contain
only direct span children", its script uses function declarations the grammar
rejects, and `widget.snapshot()` host data has no equivalent in an 8-opcode
integer ABI with `pick()` capped at 16 variants. Redrawing it as a flat glyph
grid without host data would be a different widget.

The F1SC subset is narrower than the simulator's DSL in three independent
layers: script grammar (no `if`, no `|0`, no string concatenation), CSS
selectors (`#id` rejected; only `.root`, `.root > span`, `:nth-child()`), and
CSS property policy (`font-size` root-scope only, no `font-weight` policy).

## Known limits

- **Repeat pushes need a power cycle** (see above); the exact condition that
  clears the busy latch is not yet pinned down.
- **Interactivity needs F2EP.** Knob and key handlers compile to an F2EP event
  program, which is not ported to the browser yet. A pushed package renders and
  animates on its own cadence; it does not respond to input.
- **Fonts must be local.** foreignObject rasterization resolves system and
  inline fonts. A widget pulling a remote webfont renders in the preview but
  falls back on the device capture.
