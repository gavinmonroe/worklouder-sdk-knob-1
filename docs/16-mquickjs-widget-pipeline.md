# 16 — mquickjs widget pipeline (Designer → keyboard)

The mquickjs path runs REAL JavaScript on the keyboard. A widget is three
cross-pinned artifacts, all already live-tested by the id28 weather canary:

| artifact | contents | live example |
|---|---|---|
| **F2JS** | ES5 source (≤8 KB) + event declarations (≤32) + target declarations (≤16) + input config | `weather-id28-gen19.f2js`, 7,416 B |
| **F2TF** | target facade: rects, palette (≤16), 5×7 glyphs (≤64, ×1..×3 scale), literal tables | `weather-id28-gen19.f2tf`, 1,420 B |
| **LZSS base** | compressed 62,000-byte RGB565 base frame (the full HTML/CSS look, WYSIWYG) | `weather-id28-base.lzss`, 2,145 B |

On device: the VM runs the JS; handlers write 16 int32 **mailbox slots** and
`widget.commit()`; the native facade repaints target rects from slots. There is
no `document` and no DOM — the Designer's DSL is transpiled to the mailbox
model (`src/compiler/mquickjsTranspiler.ts`).

## Slot conventions (from the live weather widget)

- slot 0 — publication revision, strictly increasing per commit
- slots 1..14 — widget state / target bindings
- slot 15 — flags; bit 1 hides the root

## Event contract

The device builds per-kind JS event objects (`build_event_object`,
`framer_mquickjs_canary.c:660`): knob → `delta`+`fn`, keys →
`key`/`repeat`/`holdCount`/`reason`, chords → `chord`+`reason`, host.rpc →
`id`/`value`/`auxiliary`, ticks → `value`/`auxiliary`; all carry
`type`/`sequence`/`timestampMs`/`heldMask`/`synthetic`. The Designer mirrors
this exactly in `src/compiler/deviceEvent.ts` (tests: `test/deviceEvents.test.ts`).

`tick.1ms` is a best-effort, coalesced logical clock. Its `value` is elapsed
milliseconds since the prior delivered 1 ms tick (normally 1, greater after a
busy iteration). Firmware permits at most one pending 1 ms tick, so slow widget
code cannot flood the owner queue. Authors should advance state by
`event.value`; neither the VM nor the LCD promises 1,000 physical repaints/s.

Physically wired key tokens on this hardware: `0x2c` (key id 0) and `0xe1`
(key id 1); the proven chord mask is `3`.

## Facade contract v2

`experiments/mquickjs-target-facade/contract.mjs` now carries two canonicals:
v1 (frozen; sha `8220152a…` embedded in the flashed weather asset — every
existing verifier still passes) and **v2**, which adds formatter 11:

- **variantText (11)** — text = `table[clamp(slots[0], 0, count-1)]`;
  colour = `palette0`, or `palette[clamp(slots[1])]` when `slots[1]` is bound;
  properties `text` or `text|color`; 1..16 literals; independent of the weather
  flags word.

The Designer's F2TF encoder (`src/compiler/f2tfPackage.ts`) emits only
formatters 1 and 11 and is validated by the SDK's strict decoder and pixel
oracle (`test/f2tfPackage.test.ts`).

## Upload container — F2UP v1 (frozen here)

One chunked upload carries all three artifacts. All integers little-endian;
sections 4-byte aligned, in order f2js, f2tf, lzss.

```
+0    8   magic "F2WIDGT1"
+8    4   version = 1
+12   4   totalBytes (entire container, <= 98304)
+16   4   generation (uint32 >= 1)
+20   4   f2jsOffset      +24  4  f2jsBytes
+28   4   f2tfOffset      +32  4  f2tfBytes
+36   4   lzssOffset      +40  4  lzssBytes   (decompresses to exactly 62000)
+44   32  sha256(payload bytes 128..totalBytes)
+76   32  sha256(f2js section)  — device cross-checks against the F2TF's pin
+108  16  reserved, zero
+124  4   crc32(header bytes 0..124 with this field zeroed)
+128  payload
```

## Delivery (firmware) — dedicated upload RPC

VERIFIED reversal: the mqjs weather build's scene RPC is **pinned** to the one
frozen 95,535-byte clock/timer package (`SCENE_PACKAGE_BYTES`,
`rv2_focus_bundle_is_frozen`, physical_integration.c:2110), so it rejects any
other package before it reaches the store. The F2UP container therefore CANNOT
ride the scene RPC; it needs its own method under the namespace the mquickjs
module registers and owns.

The module already registers four methods (cap/telemetry/event/receipt) through
`STOCK_RPC_REGISTER` (physical_integration.c:1323). The upload path adds a
fifth, `widget.mquickjs.upload` (21 chars), with begin/write/commit ops carried
in the request — the same chunked shape the scene RPC uses, but entirely inside
the module, leaving the frozen scene/focus-timer path untouched:

1. `begin` stages a transaction: total bytes, chunk count, sha, into a PSRAM
   staging buffer (allocated from the same PSRAM the module already owns).
2. `write` appends a base64 chunk (bounded, ordered, per-chunk sha).
3. `commit` validates the whole F2UP container: header + CRCs + payload sha +
   `framer_f2js_admit` dry-run + F2TF header/CRC (contract **v2** sha) + LZSS
   decompresses to exactly 62,000 bytes; then persists it to the widget flash
   slot and restarts. Any gate fails closed with a typed code, nothing is
   written, the running widget is undisturbed.

**Persist + boot-adopt** reuses the proven scene-slot-B machinery verbatim (the
pinned `STOCK_FLASH_ERASE`/`STOCK_FLASH_WRITE`, the erase→write→verify→seal step
machine, `esp_partition_main_flash_region_safe`), retargeted to the widget slot:

- Widget slot: `0x270000..0x290000` (128 KB), inside `factory`
  (`0x10000..0x810000`), past scene slot B (`0x240000..0x270000`), clear of the
  app image (ends `0x207a40`). `0x270000..0x810000` is 5,760 KB free, so size is
  never the constraint — the platform budget the earlier work established holds.
- Record: `"F1WIDGT1"` magic + version + container bytes + generation +
  sha256 + crc32 header, then the F2UP container. Erased flash (0xff) fails the
  magic and the device boots the baked weather widget exactly as today.
- At boot, a valid widget record is copied to PSRAM, re-validated, and its F2JS
  booted via `framer_resident_owner_boot_on_task` with the F2TF admitted through
  `framer_tf_admit` and the base decompressed from LZSS — INSTEAD of the baked
  weather asset set. Any failure falls back to weather.

`widget.mquickjs.cap` page 0 flips `uploader=0` → `uploader=1` and adds a
slot-status page (empty / staged generation / boot outcome). The Designer's push
gate keys off exactly that flag.

## Verified so far (Phase 0)

- Designer F2JS encoder rebuilds the flashed weather package **byte-for-byte**
  (`test/f2jsParity.test.ts`).
- All ten event kinds flow through the simulator with device-exact objects;
  the **exact flashed weather source runs unmodified** in the Designer
  simulator, including torn-snapshot rejection (`test/weatherWidgetParity.test.ts`).
- F2TF encoder accepted by the SDK's strict decoder; oracle renders variants,
  slot-driven colour, clamping, and root-hide (`test/f2tfPackage.test.ts`).
- Facade contract v1 sha unchanged (`8220152a…`); both frozen verifiers exit 0.

## Upload wire protocol — `widget.mquickjs.upload` (frozen)

One RPC method (22-byte name), op-discriminated. Integer params ride the
existing `framer_physical_rpc_read_integer` shim; `data` rides the stock JSON
string reader (`json_lookup 0x42005560` → `json_string_tuple 0x420046e0`, the
music-player pattern). Chunk transport mirrors the proven scene push: raw
chunks of **3072 bytes** (4096 base64 chars), at most **32 chunks** —
32 × 3072 = 98304 = the F2UP maximum exactly.

Request params:

| op | meaning | extra params |
|----|---------|--------------|
| 0  | status  | — |
| 1  | begin   | `generation` (must equal running generation + 1), `totalBytes` |
| 2  | chunk   | `offset` (strict in-order), `data` (canonical base64, ≤4096 chars) |
| 3  | commit  | — (seals via `framer_f2up_admit`, then arms the persist machine) |
| 4  | abort   | — |

Reply (the RPC status string, ≤113 chars):

```
v1;op=<n>;rc=<hex32>;st=<upload state 0..3>;rx=<hex32 bytes received>;
g=<hex32 running generation>;pg=<hex32 last persisted generation>;
ps=<hex32 packed persist status>;ad=<hex32 admit detail>
```

`rc=0` is success (values are `framer_f2up_upload_result` /
`framer_f2up_result` codes). `ps` packs `state | step<<8` of the persist
machine (state 6 = DONE). The Designer polls `op=0` after commit until
`ps` state reads DONE, then tells the user to power-cycle: **adoption happens
at boot**, never hot. `begin` always resets a stale transaction. The staging
arena and the boot arena are distinct PSRAM allocations, so an upload can
never corrupt the RUNNING widget.

Host-side C units (all host-proven, `experiments/mquickjs-widget-upload/`):
`f2up_admission.c` (container gates, TS↔C byte parity),
`f2up_upload.c` (transaction machine + strict base64),
`f2up_persist.c` (bounded NOR persist, slot literals 0x270000..0x290000,
container header written LAST), `f2up_adopt.c` (boot decision, generation
ratchet, fall back to baked on any failure).
`node experiments/mquickjs-widget-upload/verify.mjs` proves the whole
lifecycle including the torn-write matrix against a NOR-faithful mock flash:
`PASS_F2UP_DEVICE_LIFECYCLE_NO_HARDWARE`.

## Status: Phases 1–2 complete offline (2026-08-19)

Firmware: `physical_integration.c` carries widget_slot_adopt (setup task,
before owner/proxy — fall back to baked on any failure), the
`widget.mquickjs.upload` RPC (5 methods registered), widget_persist_step
(owner loop, guarded stock flash seams), string shim in rpc_shims.S
(music-player pattern). Capability page 0 advertises `uploader=1`
(runtime_proof capability field). Contract v2 everywhere; build scripts
reseal a v1 F2TF source to v2. Internal block pinned at 30,656 B
(`widgetUploadBlockBytes = 608` in build-psram-module.mjs).

Designer: `widgetAssembler.ts` (DSL→container), `frameCapture.ts`,
`widget-upload.ts` push client, all gated on `runtimeUploader === true`;
flag-false behavior byte-identical to before.

Cross-stack proof: the Designer's real assembled widget
(`fixtures/assembled-widget.f2up`, generation 20) is admitted by the compiled
firmware C. Flash-ready app (weather3-zip asset set): sha `52b1061d…`.
NOT yet flashed — pending hardware. Phase 3 (on-device per-event proof)
follows the flash.

## Status: Phase 3 HARDWARE-PROVEN (2026-08-19)

Flashed app `9725d6b9…` (weather3-zip asset set, contract v2). Live proof on
the Framer F1, all via the frozen wire protocol from node:

- Pushed the Designer-assembled widget (generation 20, 5,143 B) over
  `widget.mquickjs.upload`: begin → 2 chunks → commit SEALED on-device →
  persist DONE (`pg=0x14`). Reboot → **adopted from the flash slot**
  (`g=20, src=1, fb=0`), facade admitted, boot_state 7.
- Events on the pushed widget: **tick.1s** (status slot cycles at 1 Hz,
  revision strictly increasing), **Fn+knob** (gear slot steps mod 3),
  **host.rpc 0xB201** (receipt Queued→Applied, gear text+colour = value mod 3),
  **key.down** (Space / LShift bump status), **chord.down** (both keys reset
  status) — key/chord confirmed physically.

Three firmware bugs found ON HARDWARE and fixed — all one class, "module
generation conflated with widget generation":
1. `framer_tf_admit` was passed PHYSICAL_GENERATION instead of the widget's
   own (boot_state 6 halt). Now `widget_assets.generation`; regression pinned
   offline by `tf_boot_check` in the widget-upload verifier.
2. Every platform hook + owner enqueue used `block->generation` (boot_state 3:
   event-source activation refused, heap never claimed). Swept to
   `widget_assets.generation`; identity checks keep PHYSICAL_GENERATION.
3. `weather_rpc_id` hardcoded the baked widget's host-RPC ids; replaced by
   `widget_declared_host_rpc` reading the ADMITTED decls (kind 4), matching
   the owner's own internal rule.

Also: adopted widgets are now FULLY pre-flighted on the owner task (LZSS +
facade admit + pure F2JS admit) BEFORE the non-retryable
`framer_resident_owner_boot_on_task`, falling back to the baked widget with
the failing stage recorded in the upload reply's `fb=` field — a bad push can
never leave the device widget-less.

Not yet verified: the Designer's in-browser button flow (assemble→push behind
uploader=1) — the wire path it drives is the one proven above; tick.100ms /
key.up / key.hold / chord.up on a PUSHED widget (this widget doesn't declare
them; the machinery is shared with the weather widget which proved them).

## Facade contract v3 — variantRaster (formatter 12): design-true rendering

Hardware feedback (2026-08-19, first browser-pushed widget): variantText's
5x7 glyphs ignore the widget's CSS — wrong size/shape/position — and the
one-shot base capture bakes placeholder text in forever. v3 makes dynamic
updates render EXACTLY like the HTML/CSS:

- **Formatter 12 `variantRaster`**: the record binds a value slot (properties
  1; no colour slot — pixels carry colour) and a table of PRE-RENDERED
  RGB565 rasters, one per variant, each exactly the record's rect (w*h*2
  bytes, contiguous, count 1..16). Render: `blit(table[clamp(slots[value],
  0, count-1)])` into the framebuffer at the rect. Flag-independent like
  variantText. A blit fully covers its rect, so stale pixels cannot survive.
- **Asset cap**: FRAMER_TF_MAX_ASSET_BYTES rises 4096 → 65536 in v3 (no
  frozen verifier pins the old cap; container stays frozen at 96KB total —
  rasters live INSIDE the F2TF section). Admission validates each raster
  table's byte length = count * w * h * 2 exactly, rects inside the canvas.
- **Versioning**: v1 (`8220152a…`) and v2 (`0176edae…`) stay frozen;
  v3 = v2 + formatter 12, exported as TARGET_FACADE_CONTRACT_V3_SHA256.
  The module pins v3; the build reseals the baked weather f2tf to v3 (the
  v1→v2 splice tooling, parameterized by target version).
- **Designer**: the assembler captures the BASE with every dynamic target
  BLANKED (no ghost placeholders), then per target per variant: set the text
  via the preview bridge, capture, crop the rect — CSS fidelity by
  construction. variantText remains for callers that want glyph text; the
  assembler default is raster. Budget guard: sum of raster bytes + base +
  f2js against the container, failing with per-target costs when over.
- **Unchanged**: F2JS, the transpiler, slots, events, upload, persist,
  boot-adopt — "paint variant N" is the only semantic that changes.

## v3 revision: overlay budget + renderability-at-admit (black-screen postmortem)

First hardware push of a v3 raster widget black-screened: the weather rasters
need ~5,400 overlay writes/render but the asset header declared the glyph-era
4,096 cap — admission passed, EVERY render overflowed, and the proxy never
publishes after a failed render, so no frame was ever displayed. Reproduced
offline in one run of a host render-check against the browser-assembled
container (admit 0 / render 11 = FRAMER_TF_ERR_OVERFLOW).

Fixes (v3 sha revised in place to `5c056c1aed3b7f7b82742beb0c664257e9667ca4
3d3121ddf1312eec65cee696` — sole consumer was this bench):
- v3 overlay ceiling = 31,000 (one full frame; the base decode already
  rewrites every pixel per tick). v1/v2 canonicals untouched.
- **Renderability at admit, both engines**: sum of formatter-12 rect areas
  must fit the asset's declared budget — admit-pass now implies
  raster-render-cannot-overflow. The old black-screen container is REFUSED
  at admission (on device: graceful fallback to baked, never black).
- The Designer writes the HONEST budget (4,096 glyph allowance + exact
  raster sum, ≤ 31,000, loud failure over).
- The offline boot gate (`tf_boot_check`) now REQUIRES a successful
  `framer_tf_render`, not just admission — this class can never reach
  hardware again.
- New Export-tab "Assemble F2UP" inspector: assembles the exact push
  container with no device attached, for byte-level inspection — how the
  postmortem container was obtained.

## v3 authoring expansion: class variants, animations, hidden, digits

Hardware-proven raster rendering makes expressiveness a DESIGNER-side
problem: the device blits whatever pixels the capture pipeline pre-renders.
Four additive authoring features, no firmware or contract change:

1. **Class-swap variants** — DSL: `el.className = pick(index, "a", "b", …)`.
   Each variant is captured with that class applied to the element (bridge
   sets className, captures, restores). Any CSS a class can express becomes
   a variant: gradients, shadows, borders, transforms, fonts. Transpiler:
   className joins textContent/style.color as a lowered DOM write, sharing
   the target's value slot (lockstep rules as for colour).
2. **CSS animation sampling** — DSL: `widget.animate("#id", frames)` with
   `frames` 2..16, requires the element to carry a CSS animation. Transpiler
   reserves a state var and auto-registers/merges a `tick.100ms` step:
   `__anim_<id> = mod(__anim_<id> + 1, frames)` driving the target's frame
   pick. Assembler captures each frame with the animation FROZEN at
   `animation-delay: -(k/10)s; animation-play-state: paused`. The device
   plays a 10fps flipbook of real CSS keyframes. The preview runs the native
   animation; fidelity contract: device shows the sampled frames.
3. **hidden** — DSL: `el.hidden = expr` (0 visible, else hidden). Assembler
   auto-appends a background-patch variant (the blanked-base pixels of the
   rect) and lowers hidden into the variant pick. Show/hide costs one extra
   variant slot of budget.
4. **Digit composition** — a numeric target declared
   `el.textContent = digits(value, N)` renders as N per-digit subtargets,
   each with raster variants "0".."9" captured in the element's own style
   (monospace/tabular-nums recommended). Live numbers in design fonts
   without variant enumeration. Budget: N × 10 × digitRect.
Slots: every feature rides existing value slots (≤14 total unchanged).
Budget guard itemizes per-feature raster costs as today.

## Portable image assets (`asset://`)

The Designer treats images as first-class widget source instead of remote page
dependencies. **Assets → Add images** accepts PNG, JPEG, and WebP and gives each
file a stable URL such as `asset://cloud` or `asset://sprites`:

```html
<img id="cloud" src="asset://cloud" alt="">
```

```css
.character { background-image: url("asset://sprites"); }
```

The asset bank is serialized into `.f1widget.json` v2, so Share/Open retains
every image. Version-1 source-only files remain readable. Identical attached
files are deduplicated; missing asset references and remote HTTP image URLs are
source diagnostics rather than late black-frame/fallback failures. Inline
`data:image/...` sources remain self-contained and continue to work, but the
asset bank avoids inflating HTML/CSS buffers and makes reuse explicit.

The memory rule is **flatten once, never ship twice**:

- original compressed files exist only in the Designer and shared authoring
  file; they are not copied into F2UP/F1WB;
- static image pixels become part of the already-required 100×310 base frame,
  which LZSS compresses for storage and expands into the one 62,000-byte
  framebuffer the runtime already owns;
- arbitrary dynamic image changes remain RGB565 raster tables for only the
  measured changing rect. Pure translated attached images use the v4 compact
  sprite path below. Both encodings are itemized and refused before upload if
  the 65,536-byte F2TF or 96 KiB container ceiling is crossed.

This is also the sprite/animation path. `widget.animate("#cloud", 12)` samples
the real CSS keyframes at 10 fps, unions transformed bounds across all samples,
and drives those variants from the device's `tick.100ms`. A sprite sheet can
use `background-position` in class variants; a tick, key, knob, or host event
can select those classes through the existing `className = pick(...)` lowering.
No DOM, PNG decoder, image object, or second sprite framebuffer is required on
the keyboard.

## Facade contract v4 — compact translated images (formatter 14)

Class-driven `<img src="asset://…">` motion no longer duplicates the union rect
for every state. The Designer pauses event/tick delivery, reloads the preview,
and proves across every class that the element is the same attached image with
the same size and visual styling and only its translation changes. Eligible
targets lower to `spriteMotion` (formatter 14):

- one device-sized RGB565 plane and one alpha8 plane (`width*height*3` bytes);
- 1..32 signed `(x,y)` positions (`4` bytes each), selected by the target's
  existing mailbox value slot;
- clipped alpha blending directly into the normal base framebuffer, with no
  image decoder, heap allocation, or extra framebuffer on device.

The three-cloud 32-state test uses 44×44, 58×23, and 40×23 sprites. Their
motion tables cost 12,978 bytes total instead of hundreds of kilobytes of union
rasters, and the complete real Designer build is 17,429 bytes. Unsupported
styling or non-image class changes fall back to v3's design-true rasters and
retain its 16-variant ceiling; the compact path alone raises class authoring to
32 states. Firmware pinned to v4 continues admitting installed v3 packages.

Capture is transactional: auto-ticks are stopped, manual dispatch is gated,
the preview is reset before measurement/capture, and its prior tick rate is
restored afterward. This prevents live 1 ms handlers from moving an element
between class application and measurement—the race that previously produced
different target widths on consecutive builds.

## Facade contract v5 — smooth translated images (formatter 15)

A compact translated image can opt into native linear interpolation with an
ordinary CSS transition:

```css
#cloud { transition: transform 180ms linear; }
.p0 { transform: translateX(0); transition: none !important; }
.p1 { transform: translateX(8px); }
```

The Designer verifies that every forward class uses the same zero-delay linear
`transform` transition, then records its duration beside the v4 sprite and
position table. Formatter 15 therefore uses the same image bytes and 32
positions as formatter 14; it does not store intermediate frames. At display
refresh time, the native facade interpolates signed `(x,y)` coordinates between
the last and current mailbox picks. A decreasing pick, such as `p31` back to
`p0`, snaps immediately so an off-right cloud respawns off-left instead of
crossing the display backward.

Keep class writes inside the condition that advances the state. For example,
with `tick.1ms`, update the class only after the 180 ms accumulator expires.
The transpiler lowers these conditional writes directly, so the VM does not
publish thousands of unchanged mailbox revisions per second while the native
renderer supplies the smooth in-between motion.

V5 firmware continues to admit v4 and v3 assets under their own frozen contract
hashes. Older firmware rejects v5 packages before activation rather than
rendering them incorrectly.

## Shared-slot digits (formatter 13 in practice) — revision of feature 4

`digits(value, N)` now costs ONE mailbox slot per number, not N. The
transpiler publishes the raw value (`__set(slot, (expr) | 0)`, no helper);
the assembler splits the rect into N cells, each a formatter-13
`digitRaster` record bound to the SAME slot with divisor `10^(N-1-cell)`.
The device extracts each display digit as `(max(value,0)/divisor) % 10`.
Per-cell divisor-1 records (the pre-shared-slot form) remain valid F2TF.
This is what makes a weather layout with five live numbers (temp + two
high/low pairs) fit the 14-slot budget with room to spare.

## Keyless-widget postmortem: focus-release resync permanently disabled the VM (2026-08-25)

Weather v2 (gen 21) was the first widget pushed with ZERO key/chord
handlers, and it black-screened after adoption. Boot forensics (diag2/3):
capability FAULTED (c=5), `permanently_disabled=1` (d=0x0101),
`last_result=-9` (ERR_DISABLED), every host RPC receipt REJECTED (`s=R` is
REJECTED, not "running"). Chain, reproduced byte-exact on host with the
real resident owner + real MicroQuickJS + the adopted f2js package:

1. The module's screen show/hide path calls
   `framer_mqjs_input_request_focus_release`, which queued an input RESYNC
   and latched `input_pending` even on a runtime with `key_count == 0`.
2. `framer_resident_owner_step`'s drain leg (the one NOT guarded by
   `admission.key_count`) then called `framer_mqjs_input_drain`, whose
   keyless gate returns ERR_DISABLED (-9).
3. The owner books any negative engine result without a matching engine
   reset as a failed recovery: `permanently_disabled=1` + capability fault.
   Every later enqueue is rejected at ingress. PULSE and weather v1 never
   hit this because they declared keys.

Fixes (both landed, host-proven, verifier battery green):
- Engine (`framer_mquickjs_canary.c`): `input_request_focus_release` on a
  keyless runtime returns OK and queues nothing — there is no held bitmap
  to release and no drain that could service a resync.
- Resident (`resident_integration.c`): `owner_step` clears a stray
  `input_pending` latch when `admission.key_count == 0` instead of ever
  selecting the drain leg. Regression tests: canary harness keyless
  section, resident harness `keyless=pass` (mock drain armed to fail).

Second, independent flaw the same push exposed: the facade only paints
after the FIRST mailbox publication, so a widget with no tick handlers
shows a black screen until its first event. Authoring rule: every widget
should keep a 1 Hz heartbeat (`widget.on("tick.1s", ...)` republishing any
slot) so the design paints from the first second after boot. The weather
preset does this now.

New pre-push gate: run the container's f2js through the host owner+engine
harness (real `framer_resident_owner_boot_on_task` + dispatches + the
focus/release/stray-key chaos battery) in addition to the render gate.
