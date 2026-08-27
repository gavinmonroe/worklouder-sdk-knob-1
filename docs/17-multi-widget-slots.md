# 17 — Multi-widget slots: any number of widgets, picked from the Designer

Goal: the keyboard stores SEVERAL uploaded widgets at once; the Designer
shows a screen picker (occupied slots + free slots), and pushing targets an
exact slot. Switching which widget is on the display happens instantly,
without reflashing or re-pushing.

## Constraints that shaped the design (measured 2026-08-25)

- **Flash is not the limit.** Factory partition 0x10000..0x810000 (8 MiB);
  everything from 0x290000 to 0x810000 (~5.5 MiB) is unused. The current
  single widget slot is 0x270000..0x290000.
- **Internal RAM is the limit.** A live widget owner costs ~95 KiB of
  internal RAM (owner struct 27 KiB, task stack 12 KiB, block + staging);
  free internal heap on the running device is ~79 KiB with a 31 KiB largest
  block. N concurrent VMs do not fit.
- **VM boot is cheap.** Owner boot (admit + engine load + advertise) is
  ~130 ms on hardware, and teardown + second boot are host-proven paths
  (`second_boot=pass`, `keyless=pass` in the resident harness).
- **Screens are boot-lifetime commits.** `addController`/navigation entries
  are registered once at setup; multiple native screens is a separate
  research phase, not a blocker for the feature.

## Architecture: slot bank + single live VM + instant activation

- **Slot bank**: `FRAMER_F2UP_SLOT_BASE(k) = 0x270000 + k * 0x20000`,
  `FRAMER_F2UP_SLOT_COUNT = 4` (raiseable later; 0x2F0000 end is far below
  the 0x810000 factory ceiling). Slot 0 is byte-compatible with today's
  single slot: existing devices upgrade in place.
- **One live VM at a time** (the internal-RAM budget). The active slot's
  widget is booted exactly like today. The other slots are cold storage
  with their generations/identities readable over RPC.
- **Activation switch**: a new upload op quiesces the running owner
  (proven teardown), re-runs `widget_slot_adopt` against the requested
  slot, and boots it — the same code path as a power-cycle adoption, minus
  the power-cycle. Expected switch latency well under a second.
- **Boot policy**: on power-up, adopt the slot recorded in the active-slot
  record (one flash sector at the end of the bank; falls back to the
  highest admissible generation, then the baked widget).

## Wire protocol: additive v2 of `widget.mquickjs.upload` (docs/16 stays valid)

All existing ops keep their exact behavior when `slot` is absent
(defaults to 0) — old Designers keep working against new firmware.

- **op 0 status**: reply gains `sl=<active slot>;sn=<slot count>`.
- **op 1 begin**: new optional integer `slot` (0..count-1). The staging
  session records it; generation ratchet is checked against THAT slot's
  persisted generation.
- **op 3 commit**: persists into the session's slot window.
- **op 5 inventory** (new): `slot` param → reply
  `v1;op=5;rc=0;slot=k;present=0|1;g=<gen>;sha=<f2js sha256 first 16>`.
  The Designer maps `sha` to names/thumbnails via its local push history —
  no container format change needed for naming (a header name field can
  come later as a v3 nicety).
- **op 6 activate** (new): `slot` param → quiesce current owner, adopt +
  boot the requested slot, write the active-slot record. Reply carries the
  new `g`/`src`. Errors (empty slot, admit failure) leave the current
  widget running.

## Phases

- **A — storage + protocol core (host-proven first, this doc's sprint)**
  1. `experiments/mquickjs-widget-upload`: slot-aware persist (base joins
     the persist context; span gate takes the base; slot table exported),
     per-slot generation ratchet in the upload session, adopt unchanged
     (it already takes a caller-mapped window). Host proof: slot matrix in
     `verify.mjs` (persist to every slot, cross-slot isolation, torn-write
     per slot, ratchet per slot).
  2. Module glue: slot param on ops 0/1/5/6, per-slot mmap in
     `widget_slot_adopt(block, slot)`, activation via
     quiesce → adopt → boot, active-slot record.
  3. Designer: "Screens" panel on the Device tab — op 0 + op 5 sweep →
     slot cards (active / occupied / empty), push-to-slot (generation =
     slot's + 1), activate button, local sha→name registry from push
     history.
- **B — native multi-screen (research)**: register N proxies/screens with
  the stock navigation so each widget is its own keyboard screen; VM
  migrates to the visible screen (boot-on-navigate). Open question:
  `addController` multiplicity and screen-ID allocation.
- **C — niceties**: on-device widget names (container v3 header field),
  slot delete/clear op, preview thumbnails in the picker.

## Invariants preserved

- The F2UP container format is untouched.
- Adoption remains "admit a mapped window, copy, re-admit the copy".
- The persist machine still performs one bounded flash unit per call and
  writes the header sector LAST.
- Flash writes stay inside the factory partition and below scene-protect
  rules (span gate now parameterized by slot base, same predicate).

## Status 2026-08-26: firmware glue IMPLEMENTED (app f6490fe8…)

Module glue landed in psram-module-src/physical_integration.c and
compile-gated (xtensa, all pins; block +176 B justified in
build-psram-module.mjs):

- `widget_slot_scan` fills the per-slot inventory (generation + f2js sha16)
  at setup; `widget_slot_adopt_from` adopts any slot into a fresh arena and
  swaps `widget_assets` ONLY on full re-admission (failure leaves the
  running widget untouched, old arena freed only after success).
- Boot policy: highest-generation slot wins when it out-ranks the baked
  widget — i.e. the most recently pushed widget is what a power-cycle
  shows; every other widget stays in its slot, one op-6 away.
- RPC v2 (additive): op 1 takes optional `slot` (ratchets against THAT
  slot's persisted generation, so a first push to an empty slot is
  generation 1); op 3 persists into the session slot's window; op 5
  `slot=k` → `present/g/sha` inventory; op 6 `slot=k` → activation request;
  op 0 reply gains `sl=` (active slot) and `sn=` (slot count).
- Activation runs wholly on the owner task: proxy render gated by
  `widget_switching`, quiesce → bounded stop → adopt-from-slot →
  `reinit_shell` (recycles the owner around its own live task stack — the
  host-proven `slot_switch=pass` sequence) → `owner_boot_widget` (the
  extracted boot path shared with task start) → facade re-admit via the
  cleared `target_admitted` gate.

Remaining: flash + hardware proof (push a second widget to slot 1, verify
slot 0 untouched via op 5, switch with op 6), then the Designer Screens
panel (after the AAA restyle workflow completes, to avoid conflicts) with
push-to-slot, activate buttons, and the sha→name registry.

## Phase B FIRST ATTEMPT — WEDGED ON HARDWARE, ROLLED BACK (2026-08-26)

Two keyboard screens, one per widget slot, both registered at boot:

- `physical_proxy` gained an appended `screen_slot` word (stock-facing
  offsets pinned and unchanged; size pin 144 → 148). `publish_proxy_for_slot`
  registers screen 28 = slot 0 and screen 29 = slot 1 against the SAME
  renderer backend/framebuffer — only one screen is ever visible, so they
  share it safely. `framer_physical_weather_id` returns 28 + screen_slot.
- **Boot-on-navigate**: `proxy_build` (screen fronted) requests the op-6
  activation when its slot holds a widget that is not the active one — the
  keyboard's own screen navigation now switches widgets. An empty slot's
  screen shows the active widget until something is pushed there.
- **Fragmentation fix** (the first-flight bug): the adoption arena and the
  upload staging arena are both acquired ONCE at setup while PSRAM is
  pristine; `widget_slot_adopt_from` copies into the reused arena and never
  allocates. Since the copy clobbers the previous widget, any adoption
  failure re-adopts the PREVIOUS slot from its flash window (flash is the
  source of truth), then falls back to baked. Block +144 B, pin 928,
  justified in build-psram-module.mjs.

**Hardware result: the shared-backend piggyback is NOT viable.** With two
controllers registered against the one renderer backend, the stock UI
wedged: both screens black, input dead, while the RPC task kept answering
(which made remote probes look healthy - the flash-verification gap that
let this ship). The user power-cycled; app 81906a77… rolls back to ONE
widget screen. Everything else from the Phase B build is kept and good:
the setup-owned arenas (fragmentation fix verified on hardware - upload
after switching now succeeds), the appended proxy screen_slot field, and
op-6 switching.

Phase B redo prerequisites, in order:
1. VERIFY RENDERING after every display-path flash - ui_render_failures /
   frame counters via telemetry, or the user's eyes - never RPC health
   alone.
2. Understand the stock controller/backend contract before registering a
   second screen: how the registry ticks controllers, whether a backend is
   1:1 with a controller, and whether the stock renderer can create a
   SECOND backend instance (the clock+timer pair id26/id27 suggests the
   stock side can host multiple screens - study how those two share or
   split their renderer state, e.g. via the id27 disassembly).
3. Prototype with the diag build and a bench protocol that can observe a
   wedge (frame counter via diag2 f= advancing) before committing the
   navigation entry.

## Phase B round 2 — measured stock-renderer facts, second crash, retreat (2026-08-26)

The retry (the first "wedge" was plausibly just the bootloader-mode flash
window) produced REAL knowledge via per-proxy lifecycle counters
(upload op 7: build/cleanup/tick counts per screen + active/desired):

- **Ticks are the only trustworthy visibility signal.** The stock asks only
  the visible screen's controller to paint. `build`/`cleanup` also fire for
  neighbour PRE-builds during slide transitions and mislead any
  switch-on-build design (that was the "one screen behind" carousel).
- **Navigation fronting order is LIFO**: the most recently
  `addNavigation`-ed entry sits adjacent to home.
- **Tick-driven level convergence works**: with desired-slot set from the
  render tick, the op-7 trace showed active/desired tracking the fronted
  screen correctly through an entire rotation sequence.
- **The stock tick tail must ALWAYS run.** Blanking the framebuffer and
  early-returning from the proxy tick (to hide the stale previous widget on
  arrival) starved the stock renderer's own per-tick machinery: screens
  went permanently black, then the device crashed off USB entirely.
  Whatever presents the frame (source_published/image machinery, the
  old_tick underlay) is not optional per-tick work.

Round 3 prerequisites (offline, NOT on the daily-driver keyboard):
1. Disassemble how the stock clock/timer screens (id26/id27) implement two
   screens on one renderer - they are the working reference for controller
   duplication, per-screen framebuffers vs shared, and the tick contract.
2. Solve the arrival-transient WITHOUT skipping the tick tail: e.g. render
   the incoming slot's BASE frame from its arena/flash window (cheap lzss
   decode) instead of blanking, or keep per-slot base caches.
3. Keep op 7 forensics in every experimental build; bench protocol =
   op-7 watcher + the rotation choreography before any hand-off.

Current firmware: app a85b7f4d… - ONE widget screen, slot bank + op-6
switching + eager arenas + tick-visibility store (inert but harmless with
one screen) + op-7 forensics. All crash suspects removed.

## Phase B round 3 — ROOT CAUSE FOUND (disassembly), fix STAGED (2026-08-26)

The stock two-screen contract is now reverse-engineered from the flash dump
— see **docs/18-stock-two-screen-contract.md** (full evidence + recipe).
Headline corrections to the earlier postmortems:

- **Sharing the framebuffer was NEVER the bug.** The stock runs every screen
  on ONE shared framebuffer with per-screen subtrees; that is mandatory and
  correct. My "shared backend wedged it" theory (round 1) was wrong.
- **"id26/id27" are not screen ids** — the stock screen-id space is 0..25;
  26/27 were struct field offsets. Our screens are 28/29, correctly outside
  that range. The registration shape (`publish_proxy_for_slot`) was already
  correct.
- **The real killer: a skipped per-tick tail.** The stock host ticks exactly
  ONE controller per frame (the visible one → tick() is the only honest
  visibility signal), and every visible frame MUST run the stock tick tail
  (`old_tick`, the backend's original tick that drives the shared present
  pump). Our `widget_switching` gate zeroed the framebuffer and returned
  BEFORE `old_tick` → renderer starved → black then crash off USB.

Round-3 fix STAGED in physical_integration.c (app 677f00d0…, compile-gated,
NOT yet flashed): (1) re-register the second screen (28 then 29); (2) the
tick path never early-returns before `old_tick` — during a switch it runs
`old_tick` and re-presents the last-good frame instead of zeroing; (3)
visibility stays tick-driven, never build-driven. Bench protocol before any
hand-off: op-7 watcher must show only the visible proxy's tick advancing,
active/desired tracking the fronted screen, and the frame counter never
stalling across switches. Safe restore: app-rollback-81906a77 (single
screen) or the full-flash backup.

## Status 2026-08-27: ONE WIDGET = ONE SCREEN shipped (app 12ae9a54…)

Every resident slot is its own keyboard screen (28+slot) with its own PSRAM
arena, facade context, and admit flag; the visible screen renders its own
widget (active slot live via the VM, others at authored default). Visibility
is tick-derived per docs/18 §8 — build/cleanup no longer touch it. Hardware
proven: 3 widgets on 3 screens, live values, knob navigation switches the VM
to the fronted slot. Phase B is DONE; remaining niceties: slot delete/clear
op, on-device names, thumbnails.
