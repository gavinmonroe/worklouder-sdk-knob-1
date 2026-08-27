# 18 — Stock two-screen contract (Framer F1)

How the STOCK firmware runs many screens on ONE physical renderer, derived
entirely from static analysis of the 16 MiB flash dump. This is the reference
contract our module's second-screen attempt must obey. No hardware was
involved in producing this document.

Source of truth: `recovery/backups/2026-08-15-framer-f1-a4cb8faf3210-before-custom/full-flash-16mb.bin`
(read-only). Our integration under study:
`experiments/mquickjs-esp32s3-physical-canary/psram-module-src/physical_integration.c`.
Prior measured findings: `docs/17-multi-widget-slots.md` ("Phase B round 2").

---

## 1. Flash → vaddr mapping recipe (reproducible)

The dump is a full 16 MiB flash image. The app partition begins at file
offset `0x10000`. The ESP32-S3 MMU maps flash into two CPU windows: IROM
(instructions) at `0x42000000+` and DROM (rodata) at `0x3C000000+`. To
disassemble a function at a known vaddr you must translate vaddr → file
offset through the app image's segment table.

```sh
DUMP=recovery/backups/2026-08-15-framer-f1-a4cb8faf3210-before-custom/full-flash-16mb.bin
OBJDUMP=.toolchains/xtensa-esp-elf-13.2.0_20240530/bin/xtensa-esp32s3-elf-objdump
ESPTOOL=.venv-esptool/bin/esptool

# 1. Carve the app partition out of the dump (never modify the dump itself).
dd if="$DUMP" of=/tmp/app.bin bs=1 skip=$((0x10000)) 2>/dev/null

# 2. Read the segment table: each row is (load vaddr, file offset, length).
"$ESPTOOL" image_info /tmp/app.bin
#   IROM segment loads at 0x42000020  = app.bin + 0x000b0020
#   DROM segment loads at 0x3c120020  (rodata / vtables live here)

# 3. For a target vaddr V in a segment [seg_vaddr, seg_file_off]:
#       file_off(V) = seg_file_off + (V - seg_vaddr)
#    Carve that segment to its own file and disassemble with --adjust-vma
#    so objdump prints real vaddrs:
"$OBJDUMP" -D -b binary -mxtensa --adjust-vma=0x42000020 \
    --start-address=0x4204da84 --stop-address=0x4204db00 /tmp/irom.bin
```

Validate the mapping against the ground-truth anchors (disassembling each
MUST yield a sane xtensa prologue — windowed functions begin with `entry`):

| Anchor | vaddr |
|---|---|
| STOCK_ADD_CONTROLLER | `0x4204da84` |
| STOCK_ADD_NAVIGATION | `0x420293a8` |
| STOCK_ROOT_GET | `0x42004e1c` |
| STOCK_REGISTRY_FROM_ROOT | `0x4210ad9c` |
| STOCK_NAVIGATION_GET | `0x42006888` |
| STOCK_IMAGE_CREATE | `0x420ae8a0` |
| STOCK_IMAGE_SET_SOURCE | `0x420aeef0` |
| Base controller vtable | `0x3c1acc34` (DROM) |

IROM ends at `0x42116d14`. Any code above that (e.g. the `scene_rpc`
symbols at `0x4211b7f4`) is NOT in the stock app — it is in the loaded
renderer module. This boundary is load-bearing for §2's id26/id27 evidence.

---

## 2. Registration, enumeration, navigation — TWO distinct controllers, not a multiplexer

The stock UI is a **retained-mode scene graph** with **one physical
renderer backend** and **N independent screen controllers**. It is not one
controller multiplexing, and not one framebuffer per screen.

### 2.1 The registry is an id-indexed table of distinct objects

- `STOCK_ROOT_GET` (`0x42004e1c`) is a Meyers singleton → root pointer at
  DRAM `0x3fcab210`.
- `STOCK_REGISTRY_FROM_ROOT` (`0x4210ad9c`) is `l32i a2,[root+80]` → the
  controller registry is the `std::vector<Controller*>` at `root+0x50`
  (`{begin@+0, end@+4}`).
- `STOCK_ADD_CONTROLLER` (`0x4204da84`, args a2=registry, a3=controller):
  calls the controller's OWN `slot8` screenId
  (`l32i a8,[a3+0]; l32i a8,[a8+32]; callx8`), grows the vector, stores the
  pointer at `vector[screenId]` (`addx4 a7,screenId,begin; s32i a3,[a7]`),
  and writes the registry back-pointer into `controller+20`.

So the registry is a **screen-id-indexed table of distinct controller
objects**, one object + one vtable per screen.

### 2.2 Master init builds each screen identically

`0x4202bcc0` (called from `0x4202c114`) does root_get → registry_from_root →
navigation_get, then for each screen:

1. `new(size)` via `0x420e7c04` (sizes seen: 28/32/36/48/52/164/296 bytes —
   far too small to be framebuffers), `memset0` via `0x400011e8`.
2. write BASE vtable `0x3c1acc34` to `obj+0`.
3. write a **kind byte** at `obj+26` (stock uses `0x1a` = 10) and sometimes a
   **secondary byte** at `obj+27` (e.g. 50 for id9).
4. **OVERWRITE** `obj+0` with that screen's own specific vtable.
5. call `STOCK_ADD_CONTROLLER`.

A smaller earlier init at `0x420293c7` builds two more (id4 vtable
`0x3c1ab758`, id5 `0x3c1ab7d0`).

### 2.3 The vtable layout (11 slots, slot N at offset 4N)

Base `0x3c1acc34` is shared by every screen for the framework slots; each
screen overrides only its lifecycle slots:

| Slot | Off | Role | Base impl | Overridden per-screen? |
|---|---|---|---|---|
| 0 | 0 | ctor | `0x4204d5dc` | no (shared) |
| 1 | 4 | **build** | `0x4210aefc` (stub) | **yes** |
| 2 | 8 | framework render-pass wrapper | `0x4204d694` | no (shared) |
| 3 | 12 | layout hook | `0x4210882c` (empty stub) | no |
| 4 | 16 | **cleanup** | `0x42108874` (stub) | **yes** |
| 5 | 20 | framework teardown wrapper | `0x4204d6d0` | no (shared) |
| 6 | 24 | **tick / paint** | `0x42108b8c` (empty stub) | **yes** |
| 7 | 28 | hook | `0x42108834` (empty stub) | no |
| 8 | 32 | **screenId** | returns 0 | **yes** |
| 9 | 36 | **encoder** | `0x4210883c` | **yes** |
| 10 | 40 | value-change handler | `0x4204f0d0` | no (shared) |

Enumeration result: **24 screen controllers, screen ids 0..25** (ids 1 and 7
absent), each a distinct object with a distinct vtable sharing base
slot0/2/3/5/7/10 and overriding slot1/4/6/8/9. Sample id → vtable:

```
0 ->3c1ab804   2 ->3c1abb28   3 ->3c1abe8c   4 ->3c1ab758   5 ->3c1ab7d0
6 ->3c1abbc4   8 ->3c1ab980   9 ->3c1abe24  10->3c1abe58  11->3c1abd0c
12->3c1abdf0  13->3c1abd88  14->3c1abab4  15->3c1ab9fc  16->3c1abae8
17->3c1aba5c  18->3c1abb90  19->3c1abb5c  20->3c1ab8ac  21->3c1ab838
22->3c1abc48  23->3c1abcb0  24->3c1abc7c  25->3c1ab724
```

### 2.4 Navigation is a SEPARATE ordered list

`STOCK_NAVIGATION_GET` (`0x42006888`) is its own singleton at `0x3fcab378`.
`STOCK_ADD_NAVIGATION` (`0x420293a8`) appends a screen id (arg a11) to the
nav model's ordered list at `nav+36` (`0x24`) — this is the **knob-cycle
order**, independent of the registry index. Fronting order is **LIFO**: the
most-recently-`addNavigation`-ed entry sits next to home. The master init
registers cycle order ids: 8, 22, 16, 17, 3, 15, 14, 19, 18, 20 (plus 0 from
the early init). A screen must be in **both** indexes: registry (to be
ticked) and navigation (to be reachable by the knob).

### 2.5 The id26 / id27 evidence — they are NOT screen ids

The task vocabulary calls the two built-in screens "clock id26" and "timer
id27". **No controller returns slot8 == 26 or 27.** An exhaustive IROM scan
for id-return functions (`entry; movi.n a2,K; retw`) found the screen-id
space is exactly 0..25 — there is no id 26 or 27.

The numbers 26/27 are **struct field offsets**: the kind byte the master
init writes at `obj+26` (0x1a) and the secondary byte at `obj+27`. Every
controller gets them. Separately, the `scene_rpc` symbols at `0x4211b7f4`
sit **past IROM end `0x42116d14`**, i.e. in the loaded renderer module, not
the stock app — so there is no stock "clock/timer duplication" to model on.
The "clock" and "timer" are simply two of ids 0..25: two separate controller
objects with their own vtables and their own slot6 tick functions, sharing
the one registry vector and the one navigation list. **Definitively not one
controller multiplexing.** Our module already uses id **28** (and would use
**29** for a second screen), safely outside the stock 0..25 space.

---

## 3. Per-screen framebuffer / surface ownership — SHARED framebuffer, SEPARATE subtrees

Screens do **not** each own a framebuffer. There is **one** shared
framebuffer owned by a single global display/scene singleton at DRAM
`0x3fcaf438` (scene root at `display+16`). Each screen owns only:

- a tiny controller object (28–296 bytes), plus
- its own **retained widget subtree**, rooted at the framework-supplied
  surface handle at `controller+8`, with node handles stored in the
  controller struct (id0 stores its image node at `obj+28`).

Each **image node** carries its own SOURCE pixel buffer (source ptr at
`node+52`, width `node+68`, height `node+72`, flags halfword `node+96`) —
that is per-image input pixels, never a shared panel surface.
`STOCK_IMAGE_CREATE` (`0x420ae8a0`) is a thin factory that allocates NO
framebuffer; it links the node as a child of a parent container
(`parent+0x2b4` = children ptr, `parent+0x2d0` = count).

How pixels reach the panel: a single dirty-rect compositor composites only
the **visible** screen's nodes into the one framebuffer each tick. Base
`slot2` (`0x4204d694`) ACQUIRES the shared display-context singleton
(handle at `0x3fcaf4ac` via `0x420ab3e8`) into `obj+16` — and **dead-loops
at `0x420ab410`** if it is null (the wedge). Base `slot5` (`0x4204d6d0`)
RELEASES it via `0x420ab448`. All screens share this one context/framebuffer.

**Consequence:** sharing the framebuffer is mandatory and correct. Sharing
is safe **only because exactly one screen is visible/ticked at a time** and
each rebuilds/re-publishes its own image source on build. Never allocate,
own, or blank a per-screen framebuffer; never give a screen its own physical
backend. The per-screen "surface" is the scene-graph subtree, not the
framebuffer.

---

## 4. Render-tick visibility contract

### 4.1 Exactly one controller is ticked per frame

A renderer-host proxy singleton (DRAM `0x3fcaacf0`, built by `proxy_get`
`0x42003b00`, vtable at DROM `0x3c147418`) ticks **exactly one** controller
per frame — the currently visible one, read from a single volatile pointer.

- Host tick = proxy `slot3` `0x42006468`. It calls resolver `0x42006428` →
  `proxy_get` + `0x4203f034` → `0x42109d44`, whose body is
  `memw; l32i a2,[a2+0x1f8]; memw; retw`: it loads the current-controller
  pointer from **proxy+0x228** (`0x30+0x1f8`) with hardware memory barriers
  (published cross-context).
- `0x42006468` then: `beqz cur -> ret; l32i a8,[cur+0]; l32i a8,[a8+24];
  callx8 a8` — loads the current controller's OWN vtable and calls **slot6
  (offset 24)**. Null current ⇒ nothing renders.

The whole lifecycle is forwarded through thin host forwarders (each
re-resolves current then calls one child slot): slot2→child off8,
slot3→child off24 (**TICK**), slot4→child off28, slot5→child off32
(screenId), slot6→child off20. The stock drives the host vtable; the host
relays to the single live screen. **The stock never iterates the registry to
tick — there is no "tick all screens" loop.**

### 4.2 Visibility is owned externally, never self-decided

- set-current-id `0x4202951c`: `l8ui a8,[nav+124]; beq a8,id -> ret`
  (`nav+124` = `0x7C` = current visible screen-id byte); on change it
  `s8i id,[nav+124]`, calls `0x4200e198`, then activation `0x42003bc0(id)`,
  then notify `0x420294b0`.
- activation `0x42003bc0`: loads the proxy, reads active id at `proxy+17`,
  `beq -> ret` if unchanged (idempotent on same id), tears down the outgoing
  screen (`0x4203f420`/`0x4203f088`/`0x4203f068`), then `s8i id,[proxy+17]`
  and republishes the current pointer that tick reads. Only after activation
  does the new controller start receiving slot6. id 0 is a sentinel/empty in
  nav-map lookups (`beqz current -> empty`) with a special activation branch.

**tick() is therefore the ONLY reliable visibility signal.** Because the
host only ever calls slot6 on the one current controller, receiving a tick ==
"I am visible this frame". build() (slot1) and cleanup() (slot4) are NOT
gated this way — they also fire for navigation NEIGHBOURS during slide
transitions (pre-builds). Gating visibility on build is exactly the carousel
"one screen behind" bug.

### 4.3 The mandatory per-tick tail (skipping it crashes the device)

Every stock tick runs shared housekeeping — the "tick tail" — and a live
screen that owns its present MUST run it to completion every frame:

- Fetch the shared manager (`0x420067a4` → singleton `0x3fcab400`).
- Run the dirty predicate `0x4210968c` (`l8ui [self+60]; return state != 6`).
- On dirty, push redraw event id 20 via `0x4210af1c`, plus honor staleness /
  heartbeat timers vs thresholds (`0x1770` = 6000 ms, `0xabe`, `0x708`).
- Drive the shared render/present pump `0x4209e118` (reached via the image
  source-publish path, e.g. from `0x420aebd3`) and re-publish the image
  source (`STOCK_IMAGE_SET_SOURCE` `0x420aeef0`).

A static screen (e.g. base tick `0x42108b8c` and id3 tick `0x42108d54` are
both `entry; retw.n`) may legitimately do zero per-tick work — its retained
subtree is re-presented for free. That is valid **only** because it mutates
nothing per frame. A live/framebuffer-backed screen that owns the present
must always run the present. In our module the tail is the stock backend's
ORIGINAL tick, stashed in the backend vtable[11] sidecar (magic
`0x32565343` 'SCV2', `old_tick` at `sidecar+4`), and it must be called every
visible frame.

---

## 5. Why our module's second-screen attempt failed

Mapped to the two crashes recorded in `docs/17` "Phase B round 2"
(`docs/17-multi-widget-slots.md:174-188`) and the code in
`physical_integration.c`.

### Crash 1 — "stale frames / one screen behind" (visibility-signal violation)

The switch-on-**build** carousel design treated `build()` as "I am now
visible". Per §4.2, build/cleanup fire for navigation NEIGHBOURS during
slide transitions (pre-builds), so the wrong screen's content was published.
This violates the **tick-is-the-only-visibility-signal** contract. It was
fixed by driving desired-slot convergence from the render tick
(`physical_integration.c:2278-2282`: `widget_desired_slot` set inside
`proxy_tick`), matching the stock, and the op-7 trace then showed
active/desired tracking the fronted screen through a full rotation.

### Crash 2 — permanent black then device crash off USB (skipped tick tail)

The arrival-transient fix blanked the shared framebuffer and **early-returned
before `old_tick`**. In the current source this is
`physical_integration.c:2270-2273`:

```c
if (__atomic_load_n(&block->widget_switching, __ATOMIC_ACQUIRE) != 0u) {
    zero_bytes((uint8_t *)proxy->backend + 160u, PHYSICAL_FRAME_BYTES);
    return;                 /* <-- returns BEFORE old_tick(backend) */
}
```

`old_tick(proxy->backend)` (line 2289) is the stock tick tail (§4.3) — it
drives `source_published` / image machinery and the shared render pump for
the ONE shared renderer. Returning before it **starved the stock renderer's
per-tick machinery**: screens went permanently black, then the device
crashed off USB. This directly violates the **mandatory-tick-tail** contract.
It is survivable only for a screen that does nothing per-tick; our proxy is
LIVE content (its image source must be re-published every visible frame), so
it must always run the present.

### What was NOT the cause

The stale frames were **not** caused by sharing the framebuffer — sharing is
mandatory and correct (§3). They came from two things: (a) the wrong
visibility signal (crash 1) and (b) two controllers plus a tick that skipped
the shared present pump (crash 2). No per-screen framebuffer is needed or
wanted.

### Contract-violation summary

| Symptom | Stock contract violated | Fix direction |
|---|---|---|
| Stale / one-behind frames | tick is the only visibility signal (§4.2) | converge desired-slot from `proxy_tick`, never `proxy_build` |
| Permanent black → crash | mandatory per-tick tail must always run (§4.3) | never early-return before `old_tick`; render a real frame instead |
| (avoided) framebuffer confusion | one shared framebuffer, per-screen subtrees (§3) | keep the single shared backend; give each screen its own image node |

---

## 6. Round-3 redo plan for `physical_integration.c`

Goal: add a SECOND widget screen that obeys the stock contract, verifiable on
the bench with op-7 lifecycle forensics before any hand-off. The building
blocks already exist — `publish_proxy_for_slot(block, storage, screen_slot)`
(`physical_integration.c:3488`) already builds a fully-formed second
controller (id `28 + screen_slot`) with the correct base+override vtable, and
`framer_physical_weather_id` already returns a unique id per slot. What
changed the device were the two tick-path violations above, not the
registration shape.

### 6.1 Registration (obey §2 — two distinct controllers, both indexes)

1. Add a second proxy storage to `physical_block` (e.g.
   `proxy_storage_2`) and, in `framer_physical_module_startup`, after the
   existing `publish_proxy(block)` succeeds and its registry match verifies,
   register the second:
   ```c
   physical_proxy *second = publish_proxy_for_slot(block, &block->proxy_storage_2, 1u);
   ```
   This gives a DISTINCT controller object, its own local vtable (base
   slot0/2/3/5/7/10 + our slot1/4/6/8/9), screenId **29**, kind byte 10 at
   `common_24[2]` (obj+26), sharing `block->backend`. Do NOT override slot2
   or slot5 — they own the shared display-context acquire/release.
2. Verify the second registry match exactly like the first
   (`framer_physical_registration_matches`); on mismatch, keep the mapping
   but do not make it navigable (mirror the existing id28 failure branch).
3. Append the second screen to navigation AFTER the first (LIFO fronting):
   ```c
   STOCK_ADD_NAVIGATION(block->navigation, PHYSICAL_SCREEN_ID);       /* 28 */
   STOCK_ADD_NAVIGATION(block->navigation, PHYSICAL_SCREEN_ID + 1u);  /* 29 */
   ```
   Both must be in the registry (ticked) AND navigation (reachable). Screen
   ids 28/29 stay outside the stock 0..25 space.

### 6.2 Tick path (obey §4 — the two fixes that matter)

4. **Delete the blank-and-early-return.** Replace
   `physical_integration.c:2270-2273` so the `widget_switching` gate NEVER
   returns before `old_tick`. Always run:
   ```c
   old_tick(proxy->backend);           /* stock tick tail — always */
   ```
   then present a REAL frame. To hide the arrival transient during a switch,
   decode the incoming slot's BASE frame (cheap lzss from its arena/flash
   window) into the framebuffer as an underlay instead of zeroing it, keeping
   `old_tick` + `STOCK_IMAGE_SET_SOURCE` on every tick. Never write the
   framebuffer and skip the present.
5. **Keep visibility tick-driven.** Retain the existing
   `widget_desired_slot` convergence inside `proxy_tick` (lines 2278-2282);
   never move activation decisions into `proxy_build`. Each slot's proxy only
   presents when it is the ticked (visible) one — the stock host guarantees
   only one is ticked, so no explicit "am I visible" flag is needed beyond
   "I received a tick".
6. Each screen re-publishes its OWN image source every visible frame
   (`STOCK_IMAGE_SET_SOURCE`, with the first-time `STOCK_OBJECT_ALIGN` once
   via `source_published`). Reset `source_published` on build; null the image
   on cleanup. Never point two proxies' image nodes at one node object.

### 6.3 Bench verification (op-7 forensics BEFORE hand-off)

7. Keep per-proxy op-7 lifecycle counters in the build (build/cleanup/tick
   counts per slot + active/desired). The bench protocol is the op-7 watcher
   plus a rotation choreography:
   - Confirm **only the visible** proxy's tick count advances at any moment
     (the other proxy's tick count is flat while it is off-screen) — proves
     one-ticked-at-a-time and correct visibility routing.
   - Rotate through home → id28 → id29 → home repeatedly and confirm
     active/desired track the fronted screen with NO stale/one-behind frame.
   - Confirm the frame counter keeps advancing across every switch (no wedge,
     no black screen) — proves the tick tail is never skipped.
   - Only after a clean full rotation with no wedge and no crash off USB does
     the second screen graduate to a hand-off. This is offline / bench only,
     NOT the daily-driver keyboard, per `docs/17` Round-3 prerequisites.

Minimal-change principle: the registration shape and the second controller
are already correct in `publish_proxy_for_slot`; Round 3 is (a) wire the
second `publish_proxy_for_slot` + second `addNavigation` call, and (b) fix
the tick path so it never skips `old_tick` and never gates on build. Those
are the two contract violations that broke the device.

## 7. Round 3 hardware result — the deeper root cause (2026-08-26)

Round 3 (app 677f00d0, tick tail always run, tick-driven visibility) did NOT
skip the tick tail and did NOT crash off USB — the op-7 trace confirmed a
healthy render loop (only the visible proxy ticks, +12/s, stable). But the
user-visible symptom persisted: BOTH widget screens show the SAME (active)
widget ("timer→timer / weather→weather"), and a direct widget→widget
rotation goes black.

**§3's conclusion "no per-screen framebuffer is needed" was WRONG for our
one-VM case.** Why the stock gets away with a shared framebuffer: each stock
screen owns a full RETAINED widget tree (LVGL-style objects). The shared
framebuffer is just scratch the compositor redraws the CURRENT screen's tree
into, on demand, every time that screen is shown. The stock can therefore
present any screen at any time by re-rendering its retained tree.

We have NO per-screen retained tree — we have ONE MicroQuickJS VM producing
ONE raster into the ONE shared framebuffer. So:
- Both proxies' image nodes read the same framebuffer bytes ⇒ both screens
  show identical pixels = whatever the single active widget last rendered.
  That is the "both screens show the same widget" duplication.
- During the stock's slide transition both screens are composited at once,
  but only one raster exists; the switching-gate blanking makes that black.
- Switch-on-navigate can make the widget FOLLOW the visible screen, but there
  is an unavoidable ~130 ms re-boot per crossing, and during it the incoming
  screen has no fresh pixels of its own.

**The true fix (Round 4): per-slot framebuffers.** Give each screen its own
62 KiB PSRAM surface holding ITS widget's last frame; bind each proxy's image
node to its own surface (not the shared backend buffer); the active slot's
surface is live-updated by the VM, each inactive slot's surface retains its
last good frame (frozen but correct). Then screen 28 shows weather and screen
29 shows timer SIMULTANEOUSLY and correctly, the off-screen one simply not
animating. Prerequisite research (another disassembly pass, bench only):
how STOCK_IMAGE_SET_SOURCE binds a buffer to an image node, and the present
pump that pushes a node's buffer to the panel, so each screen can present its
OWN buffer instead of the shared one. RAM: 2×62 KiB in PSRAM is fine.

Until Round 4: single widget screen + the Designer **Screens panel** (op-6
RPC switching, shipped) is the reliable multi-widget experience. Native
per-knob screens wait for the per-slot-framebuffer work on a bench.

## §8 Round 5 — ONE WIDGET = ONE SCREEN: SHIPPED AND HARDWARE-PROVEN (2026-08-27)

Round 4's per-slot-framebuffer plan proved unnecessary. Because the proxy
tick RE-DECODES the base frame and RE-RENDERS the facade every visible frame,
per-slot RENDER CONTEXTS are enough: each resident slot owns its assets
(PSRAM arena), its own `framer_tf_context`, and its own admit flag; the
visible screen's tick renders ITS OWN slot into the shared framebuffer —
the active slot from the live VM mailbox, every other slot from a synthetic
idle mailbox (revision 1, all values 0 = authored default state). One
surface, correct pixels on every screen, no cross-contamination.

Two contract violations had to be fixed to make it real:

1. **Visibility must be tick-derived (§4.2 enforced).** The module's shared
   `visible` flag was still owned by proxy_build/cleanup. With 3 adjacent
   widget screens the stock's neighbor pre-build/cleanup zeroed it while
   another widget screen was fronted → the owner's tick gate closed → no
   tick.1s ever reached the VM → every dynamic field rendered 0 and widget
   input was dead (both gate on `visible`). Now: SHOW runs on the first
   proxy_tick after silence (skipped while `widget_switching` — enqueueing
   into an owner mid-reinit_shell writes into memory being zeroed), HIDE
   runs on the owner task after 400 ms of tick silence, with a fresh clock
   and a SIGNED delta (the loop-top timestamp goes stale across a slot
   switch; unsigned math fired a spurious hide/show pulse every switch).

2. **Screen-change edge triggers the slot switch** (unchanged from Round 4
   prep): the tick stores `widget_desired_slot` only when the visible screen
   CHANGES, so steady-state ticks cannot veto an op-6 activation.

Proof (app 12ae9a54…, module pins blockBytes 31840 + upload-state 1824):
resident bitmask 7, screens 28/29/30 each build+tick as fronted, and the
live mailbox revision advances ~1/s while a widget screen is visible
(rev 10→13 over 3 s on the clock screen, real values in the slots).
Forensics op 7 now covers all 4 slots, paginated by slot pair
(`slot:2` → b2/c2/t2/b3/c3/t3) to stay inside the 113 B RPC value field.

Overnight footnote: after the fix landed the device flickered on/off the
USB bus for ~an hour, which looked like a crash loop; it self-stabilized by
morning and answered RPC on the first try. The pattern (idle death with
zero lifecycle counters, then clean recovery after re-seating) matches a
weak USB path, not firmware — but the two race fixes above were real bugs
found while it was down, so the scare paid for itself.
