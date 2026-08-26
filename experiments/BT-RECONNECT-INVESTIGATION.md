# BT slot-switch reconnect failure — static investigation (Framer F1, fw 0.4.1)

Status: **investigation only**. No hardware touched, no tracked files modified.
Scratch: `/private/tmp/claude-501/-Users-gavin-Documents-ChatGPT-worklouder-sdk-knob-1/f973e561-f8d0-476c-8af0-be194189be9c/scratchpad/bt/`

Symptom under investigation: switching BT host slot 1 → 2 works; switching back
2 → 1 never reconnects to host 1 until "some other action".

All addresses are virtual addresses in the app IROM segment
(`0x42000020`.. , file offset `0xB0020` in `artifacts/firmware/framer_app_0.4.1.bin`,
`0xC0020` in the accepted app
`f1-widget-sdk/build/combined-renderer-v2-clock-blue-timer/framer-0.4.1-music-id1-wpm-id7-renderer-id26-clock-id27-blue-timer-app.bin`).
Every byte quoted below was verified byte-identical in both images.

---

## 1. Stack and module map (evidence)

BLE stack is **NimBLE** (ESP-IDF `components/bt/host/nimble/...`) with the
NimBLE-Arduino C++ wrapper (`NimBLEDevice`, `NimBLEServer`, `NimBLEAdvertising`
at `0x3c1344dc`, `0x3c134974`, ...). No Bluedroid.

On top of it Work Louder ship their own driver, namespace
`worklouder::comms::channels::ble::drivers::wl_ble_device`, source files named
in DROM:

| String addr | File |
| --- | --- |
| `0x3c126f78` | `core_libs/core/wl-comms/src/channels/ble/drivers/wl_ble_device.cpp` |
| `0x3c127adc` | `.../wl_ble_device_callbacks.cpp` |
| `0x3c128454` | `.../wl_ble_device_connection.cpp` |
| `0x3c128a68` | `.../wl_ble_device_debug.cpp` |
| `0x3c128c04` | `.../wl_ble_device_pairing.cpp` |
| `0x3c128db0` | `.../wl_ble_device_reports.cpp` |
| `0x3c1291bc` | `.../wl_ble_store_slot.cpp` |
| `0x3c126db4` | `core_libs/core/wl-comms/src/channels/ble/ble.cpp` |
| `0x3c129890` | `core_libs/core/wl-comms/src/wl_comm_manager.cpp` |

### Per-slot NVS layout (`wl_ble_store_slot.cpp`)

- namespace `wl_bles` (`0x3c12913c`), opened RW in `0x4203b210`, handle cached at
  RAM `0x3fcae3bc`, mutex at `0x3fcae3b0`.
- key format `s%u_%s` (`0x3c129144`), tags: `bp` (`0x3c129158`), `ad`
  (`0x3c12915c`), `li` (`0x3c129160`), `gs` (`0x3c129164`), `nimble_bond`
  (`0x3c12914c`); CCCD keys `s%u_c%04X` (`0x3c129304`).
  → `s0_bp`, `s0_ad`, `s0_li`, `s0_gs`, `s0_nimble_bond`, `s0_c002A`, …
- `bp` blob is **14 bytes** = two `ble_addr_t` (`{type, val[6]}` ×2 —
  peer_id_addr + peer_ota_addr). Verified in `0x4203b774`
  (`get_peer(slot,out)`, requires `len == 14`) and `0x4203b860` (`set_peer`).
- `ad` = per-slot identity address, `li` = per-slot local IRK
  (`wl_ble_store_slot_ensure_identity_addr` `0x3c129284`,
  `wl_ble_store_slot_ensure_irk` `0x3c1292e4`).

**Design note (rules out the naive hypotheses):** each slot has its *own*
identity address and IRK, so each host sees a distinct BLE device. Slot switching
does not rotate one address between hosts. `wl_ble_store_slot_reset`
(`0x4203d074`) — the only thing that erases `bp`/`ad`/`li` — has exactly **one**
caller, `0x42038d32` inside `reset_pairing_impl`. So a slot switch does **not**
delete the other slot's bond.

### Active-slot selection is a single global

`wl_ble_store_slot_set_active` = `0x4203bdf4`:

```
4203bdf4  entry a1,48
4203bdf7  l32r a10, 0x3fcae3b8            ; <-- ONE global "active slot" byte
4203bdfd  movi a12, 3                     ; __ATOMIC_RELEASE
4203bdff  mov  a11, a2                    ; new slot
4203be01  callx8 __atomic_exchange_1 (0x4039270c)
4203be09  beq a2, a10 -> ret              ; unchanged: no log
4203be0f  log "store set_active: slot %u -> %u"
```

No lock is taken. All NimBLE `ble_store` read/write/delete callbacks resolve
their NVS keys through this one global. Callers: `0x420354af` (`begin()`),
`0x420389e4` (`load_and_apply_slot_identity_and_name`), `0x4203c0b8`,
`0x4203d086`.

### No host-side API

`/Applications/input.app/.../node_modules/@worklouder/wl-device-kit/dist/index.js`
exposes RPCs `sys.*`, `fs.*`, `ui.wallpaper_*`, `ui.home_accent_color`,
`ui.active_screen`, `appmgr.*`, `device.status`, `host.focused_app`,
`lights.preview`, `mp.*`. **Nothing BT/BLE/pair/slot related.** Its
`connectionType` enum is `0 = serial`, `1 = hid` — the *host transport*, not the
BT slot. `device.status` returns only `profile_index` / `layer_index` /
`is_charging` (`0x3c12e82c`, `0x3c12e83c`, `0x3c12e848`). Also note `ui.active_screen`
is **not** in the 0.4.1 firmware string table — the SDK method targets newer
firmware. Slot switching is therefore **device-local only** (Fn-key path →
comm-manager → `ble.cpp`); there is nothing to drive or observe from the host SDK.

---

## 2. The advertising gate — root-cause mechanism

### 2.1 Three per-slot bitmask bytes

Tiny helpers, all `__atomic_or_1`(`0x403928c8`) / `__atomic_and_1`(`0x40392860`)
on `this + <off>`:

| Function | Effect |
| --- | --- |
| `0x42038910` | set bit(slot) in `this+0x249` |
| `0x42038930` | clear bit(slot) in `this+0x249` |
| `0x42038954` | set bit(slot) in `this+0x24b` |
| `0x42038974` | clear bit(slot) in `this+0x24b` |
| **`0x42038998`** | **set bit(slot) in `this+0x24a`  ← the advertising gate** |
| **`0x420389b8`** | **clear bit(slot) in `this+0x24a`** |

Related scalars: `this+0x1cc` = current slot; `this+0x24c` = "gated" flag;
`this+0x24d/0x24e` = adv-ladder step; `this+0x1c4` = "hold armed";
`this+0x1c8` = hold deadline; `this+37` = is-advertising; `this+38` =
advertising-enabled; `this+0x288` = open-pairing; `this+0x25d` = slot_switch.

### 2.2 `start_advertising_impl` = `0x420343d4` — the gate is checked first and is self-sticky

```
420343d4  entry a1,128
420343d7  if ([this+56] == 0)        return           ; no NimBLEAdvertising
420343dc  if (byte[this+36] == 0)    return           ; run_state stopped
420343eb  if (byte[this+16] != 0)    return           ; stopped/teardown
420343f7  if (byte[this+38] == 0)    goto 0x420346a6  ; advertising disabled
4203440d  a6 = byte[this+0x288]                       ; open-pairing
42034419  if (a6 != 0) goto 0x42034455                ; open pairing skips standby gates
          ... standby / host-off / backoff gates -> 0x420346a6
42034455  a7 = byte[this+0x1cc]                       ; CURRENT SLOT
4203445e  bgeui a7, 8, 0x42034470
42034461  a9 = byte[this+0x24a]                       ; GATE MASK
4203446d  bbs  a9, a7, 0x4203449d       <<<<<<<<<<<<<< GATE HIT
...
4203449d  byte[this+0x24c] = 1                        ; mark gated
420344a5..c4  is_advertising := 0, notify
420346a1  call 0x42037868               <<<<<<<<<<<<<< RE-ARM 60 s hold deadline
420346a6  ... return                                  ; NO ADVERTISING
```

Only when the gate bit is **clear** does execution reach the identity load
(`0x420344f5 call 0x420389dc`) and, at `0x42034576`, `call 0x420389b8`
(**clear** gate). So `start_advertising_impl` can never clear a gate that is
already set — it returns at `0x4203446d` first.

The three "adv-gate" refusals that *set* the gate (each: `0x42038910` +
`0x42038998` + `byte[+0x24c]=1` + `is_advertising:=0` + log + re-arm):

| Code | Log (DROM) |
| --- | --- |
| `0x42034525`/`0x4203452c` | `diag adv-gate: slot %u is open-pairing with no pairing request, advertising held for %u ms` (`0x3c12756c`, line 0x8CA) — reached when `open_pairing == 0 && has_peer(slot) == 0` |
| `0x420345f6`/`0x420345fd` | `diag adv-gate: slot %u peer read failed, advertising held for %u ms` (`0x3c1275c8`, line 0x8EE) |
| `0x4203466d`/`0x42034674` | `diag adv-gate: slot %u has no saved peer address, advertising held for %u ms` (`0x3c12760c`, line 0x901) |

`%u ms` is the literal `0xEA60` = **60000**.
(`identity load failed, radio stays down`, `0x3c127514`, returns without gating.)

The `bp` record is used purely as a *gate predicate* — after the all-zero check
at `0x4203461e..0x42034666` the 14-byte buffer at `a1+54` is not passed to the
advertising call, so this is not directed advertising; it is "do we believe this
slot has a real host".

### 2.3 The hold timer is global, and it is re-armed on every gated tick

```
42037868  arm_hold(this):                 ; called from the gated bail at 0x420346a3
4203786b    now = esp_timer_get_time()
42037871    [this+0x1c8] = now + 0xEA60    ; 60 s
42037887    byte[this+0x1c4] = 1
```

```
42037dd0  poll_manual_hold_auto_resume(this):
42037ddb    if (byte[this+0x1c4] == 0) return
42037df9    if (!deadline_passed(now, [this+0x1c8])) return
42037e0a    byte[this+0x1c4] = 0
42037e13    if (byte[this+0x24c] == 0) return
42037e22    log "dead-link hold: auto-resume after %ums, re-advertising to bond"
42037e37    slot = get_current_slot(0x42109814)          <<<< CURRENT slot, not the gated one
42037e41    release_adv_hold(this, slot)   -> 0x420388c0
```

```
420388c0  release_adv_hold(this, slot):
420388cc    byte[this+0x24c] = 0
420388d8    byte[this+0x1c4] = 0
420388f2    clear bit(slot) in this+0x24a
420388ff    byte[this+0x24d] = 5
42038904    is_advertising := 1
42038909    call 0x42034744 (ensure_advertising)
```

### 2.4 The BLE channel tick calls them in the wrong order — permanent livelock

`ble::update()` = `0x42032960` (worker-task loop, loop head `0x42032a46`):

```
42032a49  if (!is_advertising())                                   ; 0x42109778
42032a54     log "BLE: background advertising was off while route active - re-asserting"  (0x3c126d6c)
42032a69     set_advertising_enabled(this, 1)   -> 0x42034788 -> 0x42034744 -> start_advertising_impl
...
42032ac1  call 0x42034744          ; ensure_advertising -> start_advertising_impl  (RE-ARMS deadline)
42032ae2  call 0x42037dd0          ; poll_manual_hold_auto_resume (checks deadline)
42032ae7  call 0x42037e48 / 0x42037ef8 / 0x42033de8 / 0x42039530   ; other watchdogs
```

Because the gated path in `start_advertising_impl` unconditionally re-arms
`[this+0x1c8] = now + 60000` **before** the poll evaluates it, and the tick
period is far shorter than 60 s (it also drives ms-granularity conn-param /
watchdog polls), **the deadline can never expire**. The 60 s auto-resume never
fires.

### 2.5 Nothing in the slot switch clears the gate

`set_slot` = `0x420386c4`:

```
420386c4  entry a1,32
420386d0  cur = byte[this+0x1cc]
420386e2  if (cur == new) goto SAME
420386ee  byte[this+0x26c]=0; [0x26d]=0; [0x26e]=0
42038708  byte[this+0x25d] = 1              ; slot_switch
4203870e  flush_hid_releases_impl(0x42039750)
42038713  call 0x42039390                   ; teardown
4203871b  byte[this+0x24d] = 5; byte[this+0x24e] = 0
42038726  rc = (*0x42109718)(this)          ; disconnect
...APPLY:
42038761  call 0x42033960(this,1,0)
42038767  byte[this+0x288] = 0              ; leave open pairing
4203877d  byte[this+0x1cc] = new_slot       ; COMMIT
420387a0  byte[this+0x25d] = 0
420387a3  movi a11,1 ; call 0x42033454      ; is_advertising := 1
420387aa  call 0x420343d4                   ; start_advertising_impl
420387cb  retw
```

`this+0x24a` is **never touched**. Verified exhaustively: the only writers of
`0x24a` in the whole image are `0x420388e7` (release_adv_hold),
`0x420389a3` (`0x42038998` set), `0x420389c9` (`0x420389b8` clear),
`0x42038c4f`, `0x42038e89` (`grep 'movi a10, 0x24a'`).

### 2.6 Who sets the gate for slot 1 in the first place

Callers of `0x42038998` (set gate) outside `start_advertising_impl`:

- **`0x420367c4`** — `onAuthenticationComplete` security-failure path
  (`auth_complete: hold reconnect (...) - bond mismatch %s`, `0x3c127f08`;
  `auth_complete: sec-fail on slot %u while slot %u is selected` `0x3c127d8c`).
  Also arms the hold at `0x420367d0`.
- **`0x420373f5`** — `onDisconnect` (`0x3c12823c`). Reason filter at
  `0x42037372`: `reason == 0x18` ∨ `(reason & ~8) == 6` (i.e. `0x06`
  PIN_OR_KEY_MISSING, `0x0E` CONN_REJ_SECURITY) ∨ `reason == 0x2F`
  INSUFFICIENT_SECURITY. Gate is set for **the connection's slot**
  (`[a1+64]`), and the `is_advertising := 0` + hold-arm block that follows
  (`0x42037401..0x4203741d`) only runs when that slot equals the *current* slot
  (`0x420373fb beq`). Non-security reasons (`0x13` REM_USER_TERM, `0x16`
  LOCAL_HOST_TERM, `0x08` supervision timeout) take the benign path at
  `0x4203754d`.
- **`0x42039730`** — `evaluate_zombie_link` escalation
  (`zombie link: %u consecutive fires - escalating to pairing-required`,
  `0x3c128f54`).

Callers of `0x420389b8` (clear gate): `0x4203409d` (`start_advertising_open`,
i.e. **hold-to-pair**), `0x42034576` (unreachable while gated), `0x42036e37`
(auth-complete success), `0x42037342` / `0x420373ba` (onDisconnect benign paths).
Plus the inline clear in `release_adv_hold`, reached from
`poll_manual_hold_auto_resume` (dead, §2.4) and from `set_standby_quiet`
(`0x42034ce0`, log `dead-link hold: standby wake, resuming reconnect early`,
`0x3c127700`).

All of the clear paths except `start_advertising_open` and the standby-wake one
require a *connection event* — which cannot happen while the device is silent.

---

## 3. Hypotheses, ranked

**H1 — Sticky per-slot advertising gate + never-expiring global hold (the "never
recovers" half). Confidence: high, fully pinned statically.**
Once bit(slot 1) is set in `this+0x24a`, `start_advertising_impl` bails at
`0x4203446d` on every tick and re-arms the 60 s deadline at `0x420346a3`, so
`poll_manual_hold_auto_resume` (called *after* it, `0x42032ac1` then
`0x42032ae2`) never sees it expire. `set_slot` (`0x420386c4`) does not clear it.
Recovery is limited to: reboot (mask is RAM-only), hold-to-pair
(`start_advertising_open` `0x42034064`), or a standby→wake cycle
(`0x42034ce0`). This exactly matches "never reconnects until some other action".
**Diagnostic signature:** the console spams
`BLE: background advertising was off while route active - re-asserting`
(`0x3c126d6c`) once per tick while stuck.

**H2 — The gate for slot 1 is set by `onDisconnect` with a security reason, at or
around the switch away from slot 1. Confidence: medium-high.**
`0x42037372` matches `0x06 / 0x0E / 0x18 / 0x2F`. If macOS drops or refuses the
LTK on the next reconnect attempt, the F1 gates slot 1 and (per H1) never
re-advertises. Cannot be confirmed statically — needs the disconnect reason from
the device (`diag disconnect: ... reason_hci=0x%02x reason_name=%s`,
`0x3c1281b0`).

**H3 — The auto-resume releases the wrong slot. Confidence: high (code-pinned),
impact secondary.**
`poll_manual_hold_auto_resume` (`0x42037e37`) releases `current_slot`, not the
slot that was gated, and it clears the single global `this+0x1c4` while doing so.
So a gate raised on slot 1 while slot 2 is active can be consumed/ignored. Even
if H1's re-arm bug were fixed, this remains a hole.

**H4 — Store `set_active` race corrupting slot 1's records. Confidence: low-medium.**
`set_active` is an unlocked global (`0x3fcae3b8`), while NimBLE store callbacks
run on the host task. A slot switch flips the global; an in-flight bond/CCCD
write for the old link would then land under the new slot's keys. The authors
guard the *connection* layer against this (`auth_complete: ignore slot-mismatch
handle=%u pending_slot=%u current_slot=%u`, `0x3c127e38`; `rejecting connect
handle=%u (suppress=%u slot_switch=%u)`, `0x3c127c80`) but not the store. If
`s1_bp` were lost this way, `start_advertising_impl` would take the
`has_peer==0` gate at `0x42034525` → same terminal state via H1. Would show as
`store record corrupt (slot=%u tag=%.*s)` (`0x3c129168`) or
`COMM MANAGER: slot %u reads unbonded but absence is not confirmed`
(`0x3c129948`) in the log.

**H5 — Transient conn-handle bail (`u16[this+0x238] != 0xffff` at `0x42034494`)
because the old link's disconnect is asynchronous. Confidence: high that it
happens, low that it matters** — it neither gates nor arms, and the next tick
retries. Not a candidate for a permanent failure.

**Ruled out:** bond deletion on slot switch (only `reset_pairing` erases,
`0x4203d074` ← `0x42038d32`); shared/rotating identity address (per-slot `ad` +
`li`); host-side SDK involvement (no BT RPC exists).

---

## 4. Reproduction plan

Nothing here needs a firmware change.

1. **Instrument first.** Capture the ESP-IDF console over the USB-JTAG serial
   (see `docs/04-recovery-and-restore.md`). The stock firmware already logs
   everything needed; grep for:
   - `diag adv-gate:` — which of the three gate conditions fired, and for which slot
   - `diag disconnect: ... reason_hci=0x%02x reason_name=%s ... slot_switch=%u`
   - `auth_complete: hold reconnect (... adv_mode=%u ... stack_erased=%u) - bond mismatch`
   - `store set_active: slot %u -> %u`
   - `BLE: background advertising was off while route active - re-asserting`
     ← if this repeats every tick, H1 is confirmed live
   - `dead-link hold: auto-resume after %ums` ← if this **never** appears while
     stuck, the re-arm livelock (§2.4) is confirmed
2. **Repro sequence** (all on-device; there is no host RPC for this):
   a. Pair slot 1 to Mac A, confirm `Connected`.
   b. Switch to slot 2 (Fn + slot key), pair/connect Mac B.
   c. Switch back to slot 1. Expect: no advertising, Mac A never sees the device.
   d. Record the console from step (b) onward.
3. **Confirm the recovery set** (this identifies the user's "some other action"):
   - hold-to-pair on slot 1 (`start_advertising_open` clears the gate) → expect recovery
   - leave idle until STANDBY then wake (`set_standby_quiet` → `release_adv_hold`) → expect recovery
   - power cycle → expect recovery (mask is RAM)
   - waiting 60 s with the device awake → predict **no** recovery (this is the
     falsifiable test of §2.4)
4. **Cross-check the NVS store** after the failure with the existing `fs.*`/NVS
   tooling or a flash read: `s1_bp` (14 bytes), `s1_ad`, `s1_li`,
   `s1_nimble_bond` must all still be present. If `s1_bp` is gone → H4.
5. **On-device BLE debug screen** (zero-patch if it can be reached): title
   `ble dbg...` (`0x3c125298`), renderer `0x4201f46c`, controller vtable
   `0x3c1ab7d0`, constructed at `0x42029451`. It shows `BLE %s` / `slot %u` /
   `addr` / interval / timeout / rssi / subscriptions / queue depths plus a ring
   log whose event tokens include `gate`, `auth-r`, `auth-r*`, `sec-fail`,
   `late-sw`, `late-stop`, `unsub`, `reap`, `stale`, `rt-off`, `keep`, `wipe`,
   `wipe-k` (`0x3c1252bc`..`0x3c125368`). Its catalog IDs (6/4/5) are registered
   unconditionally at `0x42029462`/`0x4203946b`/`0x42029474`, but the
   dial-navigation registration is gated by `beqz.n a3, 0x42029490` at
   `0x42029479`.

### Cheap telemetry we could add

- 2-byte patch at `0x42029479`: `9c 33` (`beqz.n a3, …`) → `3d 03`
  (`mov.n a3, a3`) — exposes the debug screens (incl. `ble dbg…`) on the
  Fn+dial ring. Same length, no relocation. Uses exactly the mechanism already
  documented in `docs/12-wpm-pet-native-view.md` (`0x420293A8`).
- `debug_dump_events` (`0x3c128b74`, `ring dump: %u event(s)`) already exists;
  hooking it to a vendor RPC in appended IROM would give host-visible history
  without a console.

---

## 5. Patch feasibility for our pipeline

Our pipeline can (a) overwrite stock code bytes at pinned addresses and
(b) append IROM. Note appended IROM lives above ~`0x42117000`, which is
~0xDF000 bytes from the BLE code — **out of `call8` range (±0x80000)** — so a
direct `call8` retarget into appended code from `0x4203xxxx` will not link. Any
non-trivial hook needs an `l32r`+`callx8` with a literal placed within
`l32r` range (−256 KB, PC-relative, word-aligned) — doable but more work. All
proposals below are in-place, same-length edits.

### P1 (recommended) — make a slot switch always release that slot's gate

`set_slot` `0x420387a3`, 5 bytes:

```
before: 0c 1b            movi.n a11, 1
        e5 ca fa         call8  0x42033454        ; set_is_advertising(this, true)
after : bd 03            mov.n  a11, a3           ; a3 = new_slot (preserved across call8)
        <call8>          call8  0x420388c0        ; release_adv_hold(this, new_slot)
```

`release_adv_hold` already does `is_advertising := 1` internally (`0x42038904`)
plus clears `this+0x24c`, `this+0x1c4`, the gate bit, and resets the adv ladder,
then calls `0x42034744`. The following `call8 0x420343d4` at `0x420387aa` can
stay (idempotent).

- **Effect:** "switch away and back" becomes a deterministic recovery, which is
  what the user already expects to work.
- **Risk: low.** If the host really has lost the bond, the F1 will advertise,
  fail security once, and re-gate — identical to post-hold-to-pair behaviour. No
  runaway: the gate re-arms on the next failure.
- **Effort:** small. One `call8` offset recomputation; both instructions are
  length-preserving. Register `a3` is in the `a0–a7` window and is preserved
  across the intervening `call8`s.
- **Audit:** byte-pin `0x420386c4`, `0x4203879b..0x420387ac`, `0x420388c0` the
  same way `custom-firmware/test/framer-registry-audit.test.mjs` pins the WPM
  hooks.

### P2 (complementary) — stop the gated path from re-arming the 60 s deadline

The G5 bail joins the shared tail at `0x420346a1` (`call 0x42037868`). Only the
G5 path can be redirected without touching the three adv-gate refusals:

```
420344c4: 46 76 00   j 0x420346a1     ->   j 0x420346a6    (skip arm_hold)
```

3 bytes, same length. Then the deadline armed by the *original* gating event
stands and expires, so `poll_manual_hold_auto_resume` can fire.

- **Risk: medium.** Changes global hold semantics for every slot; also still
  subject to H3 (releases the current slot). Best applied only together with P1
  or after the live log confirms §2.4.

### P3 — fix the wrong-slot release (H3)

`0x42037e37..0x42037e41` calls `get_current_slot` then
`release_adv_hold(this, that)`. Making it clear the whole mask needs new code
(zero `byte[this+0x24a]`), i.e. appended IROM + an `l32r`/`callx8` thunk within
range. **Effort: medium-high.** P1 makes this largely unnecessary for the
reported symptom.

### P4 (blunt, not recommended) — disable the gate entirely

`0x4203446d`: `77 d9 2c` (`bbs a9, a7, 0x4203449d`) → 3-byte `nop`/never-taken.
Removes the whole per-slot advertising suppression. High risk: this gate is what
prevents a connect/security-fail storm against a host that has genuinely lost
the bond, and what implements the "hold advertising for a host that is off".
Mentioned only for completeness.

---

## 6. What cannot be determined statically

- **Which condition actually raises the gate for slot 1** in the user's flow
  (H2 vs H4 vs the `has_peer==0` refusal). Needs the console log — the firmware
  already prints exactly that.
- The tick period of `ble::update()` (it is a `wl_module_timer`; the value is
  computed, not a single pinned constant). §2.4 only requires it to be < 60 s,
  which is implied by the ms-granularity watchdogs it drives, but it is worth
  confirming from the log timestamps.
- Whether macOS is dropping the bond (host-side). If `reason_hci` on the failing
  reconnect is `0x06 PIN_OR_KEY_MISSING`, that is a *host* bond loss and the
  firmware gate is behaving as designed — the bug is then only that it never
  recovers (H1), which P1 fixes.
- Whether `s1_bp` survives the switch (H4) — needs an NVS read after the failure.

## 7. Verified byte pins (stock == accepted app)

| VA | Bytes | Meaning |
| --- | --- | --- |
| `0x420343d4` | `36 01 01 88 e2 16 38 36` | `start_advertising_impl` entry |
| `0x4203446d` | `77 d9 2c` | `bbs a9, a7, 0x4203449d` — gate check |
| `0x420344f5` | `65 4e 04` | `call8 load_and_apply_slot_identity_and_name` |
| `0x42032ac1` | `25 c8 01` | tick: `call8 0x42034744` (ensure_advertising) |
| `0x42032ae2` | `e5 2e 05` | tick: `call8 0x42037dd0` (auto-resume poll) |
| `0x42037868` | `36 41 00 81 9a 28 e0 08 00 91 22 2c` | `arm_hold` |
| `0x420386c4` | `36 41 00 52 a1 cc 50 52 80 c0 20 00 82 05 00 72` | `set_slot` entry |
| `0x4203879b` | `ad 02 c0 20 00 62 47 5d 0c 1b e5 ca fa ad 02 a5` | `set_slot` APPLY tail (P1 site) |
| `0x420388c0` | `36 41 00 82 a0 00 72 d2 02 c0 20 00 82 47 4c 92` | `release_adv_hold` |

Comparison performed against the app image at file offset
`0xC0020 + (VA - 0x42000020)` (segment 3, load `0x42000020`, len `0x11FEF8`).

---

# Appendix A — after P1 (round 2)

New facts from the coordinator/user:

- P1 was applied exactly (`bd 03 a5 11 00` at `0x420387a3`; the `call8` encodes to
  `0x420388c0` — verified) and **the bug still reproduces**.
- host 1 = **macOS** on slot 1, host 2 = **Windows** on slot 2. Switch chord =
  hold Fn, press `1` / `2`.
- After switching back to slot 1 the BT icon **blinks** — i.e. the device *is*
  advertising. Windows (slot 2) reconnects fine.

That kills §2 as the primary cause (the sticky gate is not engaged) and moves the
problem to "advertising, but the Mac never answers".

## A1 — What the blinking icon means (pinned)

Status text mapper `0x42003324`, input struct `{u8 state, u8 enabled}`:

```
42003327  a8 = byte[in+1]                       ; enabled
4200332a  if (a8 == 0)  -> "Bluetooth off"      (0x3c120134)
4200332f  if (state==3) -> "Connecting..."      (0x3c120150)
42003335  if (state==1) -> ...
42003338  if (state==2) -> "Pairing..."         (0x3c120144)
42003344  if (state==4) -> "Connected"          (0x3c120160)
42003364  default       -> "Hold to pair"       (0x3c12016c)
```

Driver run-state (`byte[this+36]`): `start_advertising_impl` sets it to **2** on a
successful `NimBLEAdvertising::start` (`0x42034727 movi a8,2 ; s8i a8,a2,36`);
`post_auth_adv_impl` sets it to **3** (`0x42034270`). So a blinking/"Connecting…"
icon with no link = **radio up, advertising, no central connecting**. The gate of
§2 would instead show `is_advertising = 0`. Confirmed: the gate is not the
active fault.

## A2 — Deliverable: `custom-firmware/apply-ble-debug-screen-patch.mjs`

### The patch

`0x420293c8` is the diagnostics screen-group builder. It constructs three
controllers and **always** registers screen IDs 6, 4, 5 in the catalog
(`0x420290fc`), but only appends them to the Fn+dial navigation ring
(`0x420293a8`) when its bool argument is set:

```
42029462  movi.n a11,6 ; mov.n a10,a2 ; call8 0x420290fc   ; catalog add 6
4202946b  movi.n a11,4 ; ...          ; call8 0x420290fc   ; catalog add 4
42029472  movi.n a11,5 ; ...          ; call8 0x420290fc   ; catalog add 5
42029479  beqz.n a3, 0x42029490            (9c 33)         ; <<< PATCH SITE
4202947b  movi.n a11,6 ; ...          ; call8 0x420293a8   ; nav add 6
42029482  movi.n a11,4 ; ...          ; call8 0x420293a8   ; nav add 4
42029489  movi.n a11,5 ; ...          ; call8 0x420293a8   ; nav add 5
42029490  retw.n
```

| VA | before | after | disasm |
| --- | --- | --- | --- |
| `0x42029479` | `9c 33` | `3d f0` | `beqz.n a3, 0x42029490` → `nop.n` |

Same length, no relocation. The script mirrors `apply-bt-p1-patch.mjs`
(assembles `nop.n` with the pinned toolchain, asserts the 2-byte encoding,
verifies original bytes, repairs checksum + appended SHA-256, `--revert`).
It additionally verifies **5 guard sites** (the three `nav_add` call sites, the
branch target `retw.n`, and the ble-dbg id stub) so it fails closed if the image
is not stock here.

Verified round-trip against the accepted app:

```
apply : sha256 3631701…c32  ->  e67647c…d93   PASS_BLE_DEBUG_SCREEN_APPLIED
revert: sha256 e67647c…d93  ->  3631701…c32   PASS_BLE_DEBUG_SCREEN_REVERTED  (byte-identical to input)
```

### Which screen, and why it is a no-op elsewhere

`0x4204da84(vec, ctrl)` (docs/12 "add controller to ordered vector") reads the
controller's **vtable slot 8** to get its screen ID and stores it at `vec[id]`:

```
4204da8a  a8 = ctrl->vtable ; a8 = [a8+32] ; a10 = ctrl ; callx8 a8   ; id
4204dadd  vec[id] = ctrl
```

| vtable | slot 1 (render) | slot 8 (id stub) | ID |
| --- | --- | --- | --- |
| `0x3c1abbc4` | `0x420259e8` | `0x42108bbc` → `movi.n a2,6` | **6** |
| `0x3c1ab758` | `0x4201e9f8` | `0x42108860` → `movi.n a2,4` | **4** |
| **`0x3c1ab7d0`** | **`0x4201f46c`** (`ble dbg...`, `0x3c125298`) | `0x4210887c` → `movi.n a2,5` | **5** |

So the `ble dbg…` screen is **ID 5**. The patch changes nothing except making
the three `nav_add` calls unconditional:

- **No new IDs.** 6/4/5 are already registered in the catalog unconditionally at
  `0x42029462`/`0x4202946b`/`0x42029472`; only the *nav ring* membership changes.
- **No registry overflow.** `0x420293a8` is a growing `std::vector` push-back
  (`0x42028fa4` grows `[this+36]`, `0x420291b8` grows `[this+48]`, then sets a
  byte flag) — there is no fixed capacity. For reference the stock ring already
  holds 11 entries (`8, 22, 16, 17, 3, 15, 14, 19, 18` from `0x4202bfd6..0x4202c012`
  plus this group's 6, 4, 5 when enabled).
- **Idempotent with the built-in toggle** (below): the toggle calls the same
  builder with `enable = !state`; with the branch nop'd the "off" direction just
  re-adds the same three IDs. Duplicate entries in the ring are the only cosmetic
  side effect if the user also uses the gesture. Recommendation: use the patch
  **or** the gesture, not both.

### Zero-patch alternative (found while pinning the branch)

`0x4202509c` is vtable slot 10 of the controller with vtable `0x3c1abb90`, whose
id stub `0x42108ba8` returns **18** — i.e. it is the key handler of screen ID 18,
already in the dial ring.

```
4202509c  entry a1,32
4202509f  proceed only if (type == 5) && (arg4 == 0)      ; type 5 = both-Fn-keys
                                                          ; (docs/04: factory-reset chord is also "both Fn keys/type 5")
420250c1  if (now - [this+56] > 500 ms) count = 0          ; 500 ms inter-press window
420250d3  count++
420250de  if (count <= 9) return                           ; needs 10
420250e8  a10 = get_debug_nav_flag(0x42029678)             ; RAM byte 0x3fcadb80
420250ed  a4  = !a10
420250f3  a10 = screen_manager(0x42006888)
420250f8  call 0x420293c8(manager, a4)                     ; toggle the 6/4/5 group
```

**So on stock firmware: go to screen ID 18, then press both Fn keys 10 times with
≤500 ms between presses.** That toggles screens 6/4/5 into the dial ring
(flag is RAM-only at `0x3fcadb80`, so it resets on reboot). Try this before
flashing anything.

### What the user will see on `ble dbg…` (ID 5)

Renderer `0x4201f46c`. Header/status block (format strings `0x3c125368`..`0x3c125436`):

```
BLE ADVERT | BLE OFF | IDLE      up %lus
slot %u
addr %02X%02X%02X / %02X%02X%02X
int  %u ms      tmo  %u ms
rssi %d dB
sub k%c m%c v%c        (keyboard / media / vendor CCCD subscriptions)
queue k%u v%u   drop k%lu r%u   retry k%lu/%lu   mbuf %ld/%ld   heap %uk
-- log (new) --
```

Ring log: writer `ring_log_event` = `0x42038548`, ring base `0x3fca5808`,
8 bytes per entry, index at `0x3fcae3a4` with `idx = (idx+1) % 40` (the
`0xcccccccd`/`srli 5` magic at `0x42038563`..`0x42038573`) → **40 entries,
circular**. The UI pulls up to 40 (`movi.n a11, 40` at `0x4201f7b0`) and renders
a page of 15 (`movi.n a6, 15` at `0x4201f7d0`), newest first under
`-- log (new) --`; turn the dial to page through, the ring overwrites oldest.
`debug_dump_events` (`0x3c128b74`, `ring dump: %u event(s)`) prints the same ring
to the console.

Line formats and what each token means (`0x3c125451`..`0x3c125511`, tokens
`0x3c1252bc`..`0x3c125368`):

| Line | Meaning |
| --- | --- |
| `%s up s%u %dms` | link came up on slot %u after %d ms |
| `%s auth %s s%u` | auth result (`ok` / `authfail` / `timeout` / `sec-st`) on slot |
| `%s dc %s` / `%s dc x%02X` | disconnect, named reason (`host-end`, `host-res`, `host-off`, `we-ended`, `lmp-tmo`, `bad-itvl`, `mic-err`, `estb-fail`) or raw HCI hex |
| `%s sub %s %d` | CCCD subscribe/unsubscribe |
| `%s lag %s r%d` | notify stalled / rejected, rc |
| `%s ZOMBIE %s r%d` | zombie-link watchdog fired |
| `%s end rt-off>%s` / `%s end %s` | advertising/session ended (`rt-off` = route off, `rt-wd` = route watchdog, `stale`, `reap`, `late-stop`, `late-sw`) |
| `%s pair s%u %s` | pairing/store action on slot (`keep`, `wipe`, `wipe-k`) |
| `%s cfg %u/%d%s` | conn-param update |
| **`gate`** (`0x3c1252fc`) | **the advertising gate of §2 refused to advertise for the current slot** — its presence proves the §2 path; its *absence* proves the radio is up |
| `auth-r` / `auth-r*` / `auth-r?` | auth retry / retry-with-hint / retry-unknown |
| `sec-fail` | security procedure failed (LTK/bond mismatch) |
| `unsub` | keyboard CCCD never arrived (host GATT cache stale) |

## A3 — Fn + digit → `set_slot`, traced

Keymap action dispatch (`0x4206a49d`, 24-bit action code in `a3`):

```
4206a4a3  if (code == 0x401)  submit{act=0x101, ch=0x200, slot=255}       ; route to USB
4206a4d8  else (BLE slot group)  a3 -= 16
          submit{act=0x101, ch=0x101, slot=a3, [5]=0, [6]=0}              ; APPLY  <-- Fn+digit
4206a505  else (pair group)      a3 -= 32
          submit{act=0x201, ch=0x101, slot=a3, [5]=1, [6]=1}              ; PAIRING <-- hold-to-pair
```

all three via `call8 0x4203f544` = `wl_comm_manager::submit(mgr@0x3fcaacf0, req)`.
So **Fn+1 / Fn+2 emit a plain "APPLY channel=BLE slot=N" request** — no
disconnect/terminate is carried in the request, and nothing is held while Fn is
down. `submit` may rewrite APPLY→PAIRING when the bond is provably absent
(`0x42042bb4` → `COMM MANAGER: rewrite BLE APPLY to pairing slot=%u`) or keep
APPLY (`slot %u reads unbonded but absence is not confirmed`).

Chain: `submit` → executor → `ble::set_slot` `0x420326dc` → `0x4203881c` →
`wl_ble_device::set_slot` `0x420386c4`.

`0x420326dc` additionally, when the slot actually changes, calls `0x42039410`
and two interface vtable slots `[+68]` (HID release flush on the keyboard and
media interfaces) before `0x4203881c`.

## A4 — `set_slot` does **not** wait for `BLE_GAP_EVENT_DISCONNECT`

```
42038713  call 0x42039390(this)              ; teardown / queue disconnects (async)
42038726  rc = (*0x42109718)(this)           ; connected count
4203872c  if (rc == 0) -> APPLY
4203872e  j 0x4203874e -> ring_log_event(8,0,0) [0x42038548]  ; then falls into APPLY
42038759  APPLY: commit slot, ..., start_advertising_impl()
```

Both branches reach APPLY immediately. The teardown is asynchronous (hence
`schedule_disconnect` `0x3c127118`, `stop_all_activity: cleared stale handles
after timeout` `0x3c127294`). `start_advertising_impl` then refuses while a
handle is still live:

```
42034488  a9 = u16[this+0x238]  ; active handle
42034494  if (a9 != 0xffff) -> 0x420346ae     ; bail: no adv, no gate, no timer
420344ca  a8 = u16[this+0x23c]  ; pending handle
420344d0  if (a8 != 0xffff) -> 0x420346ae     ; bail
```

This is **transient and self-healing** — the periodic `ble::update()` retries
once the handles clear — and it neither gates nor arms a hold. Consistent with
the icon eventually blinking. Not the fault.

## A5 — Advertising mode: **undirected, whitelist emptied, filter off** (directed-adv hypothesis RULED OUT)

Three independent pieces of evidence from `start_advertising_impl`:

1. **The stored peer address never reaches the advertising API.** The 14-byte
   `s{n}_bp` blob is read into the stack buffer at `a1+54`
   (`0x420345d3..0x420345ed`), then only OR-tested for all-zero
   (`0x4203461e..0x42034666`). After that the buffer is dead — it is not passed
   to `NimBLEAdvertising` or to the start call. It is a **gate predicate only**
   ("does this slot believe it has a real host"), never a directed-adv peer.
2. **The whitelist is actively emptied before advertising:**
   ```
   420345ba  call8 0x420956ec              ; whitelist count
   42034588  build 7-byte addr ; call8 0x42095e70   ; remove entry   (loop)
   420345c4  a12 = 0 ; a10 = [this+56] ; a11 = 0 ; callx8 [0x4210d318]  ; scan/connect filter := (false,false)
   ```
   `start_advertising_open` does the same at `0x420340b8..0x420340fc`.
3. **The only per-attempt tuning is the interval**: `0x42037758(this, step)`
   reads table `0x3c1ac4e8` and calls `setMinInterval`/`setMaxInterval`
   (`0x4210d308` / `0x4210d310`). No connect-mode/discovery-mode/own-addr
   argument is ever set from the driver, and no `BLE_GAP_CONN_MODE_DIR` (2)
   constant appears on any path out of `start_advertising_impl`.

Consequences for the coordinator's questions:

- macOS RPA rotation is **irrelevant to connection acceptance**: as a peripheral
  with an empty whitelist and filter policy `(0,0)`, the F1 accepts a connection
  from *any* central address. No resolving-list entry for the peer IRK is needed
  for that. (The *local* identity/IRK is per-slot: `s{n}_ad` + `s{n}_li`, applied
  by `load_and_apply_slot_identity_and_name` `0x420389dc`; failure logs
  `slot %u: IRK apply failed` `0x3c128b9c` line 140.)
- Directed advertising to a stale RPA cannot be happening.
- Slot 2 (Windows) and slot 1 (macOS) use the **same** advertising mode. The
  asymmetry must come from somewhere else — see A6.

## A6 — The advertising **ladder** and the 3-minute session cap (new dominant hypothesis)

Table `0x3c1ac4e8`, 10 × 8 bytes `{u32 dwell_ms, u16 min, u16 max}` (units of
0.625 ms):

| step | interval | dwell |
| ---: | ---: | ---: |
| 0 | **20.0 – 30.0 ms** | 30 s |
| 1 | 152.5 – 165.0 ms | 30 s |
| 2 | 211.3 – 223.8 ms | 30 s |
| 3 | 318.8 – 331.3 ms | 30 s |
| 4 | 417.5 – 430.0 ms | 60 s |
| 5 | 546.3 – 558.8 ms | 120 s |
| 6 | 760.0 – 772.5 ms | 300 s |
| 7 | 852.5 – 865.0 ms | 600 s |
| 8 | 1022.5 – 1035.0 ms | 1200 s |
| 9 | **1285.0 – 1297.5 ms** | 0 (terminal) |

`adv_ladder_step_impl` = `0x42037f6c`, current step in `byte[this+0x19f]`:

```
42037ff6  a4 = byte[this+0x26c]                    ; "host off" hint
42038005  if (a4 == 0) -> 0x42038018
42038007  movi a8,3 ; s8i a8,a5,159                ; host_off  -> pin step 3 (~320 ms)
42038018  movi.n a8,9 ; s8i a8,a5,159              ; otherwise -> pin step 9 (~1.29 s)
42038030  log "diag adv-ladder: session cap (%ums) reached, holding step=%u (host_off=%u)"
          with 0x2bf20 = 180000 ms = 3 minutes
42038046  a8 = byte[this+0x19f] + 1
42038049  movi.n a10, 9
4203804e  if (9 < a8) -> hold                      ; else advance one step
42038062  log "diag adv-ladder: step=%u (min=%u max=%u dwell_ms=%u)"
420380a1  adv.stop() ; setMinInterval(tbl[step].min) ; setMaxInterval(tbl[step].max) ; adv.start()
```

After a slot switch the ladder **is** reset to the fast window
(`0x420346f9 s8i a7,a4,159` with `a7 = 0`, and `0x4203470c` applies step 0), so
the first 30 s are at 20–30 ms. Then it walks 1→2→3, and at **T+180 s the
session cap pins step 9 ≈ 1.29 s** and it stays there.

`adv_boost_impl` = `0x42038118` is the escape:

```
4203811b  if (!atomic_exchange(&byte[this+0x1ad], 0)) return    ; "there was input" flag
420381b7  if (byte[this+0x19f] == 0) return                     ; already fast
420381c3  log "diag adv-ladder: input boost from step=%u back to fast window"
420381d6  byte[this+0x19f] = 0 ; adv.stop() ; setMinInterval(32) ; ... ; restart
```

**So: pressing any key / turning the dial snaps advertising back to 20–30 ms.**
That is almost certainly the user's unidentified "some other action".

### Why this is macOS-vs-Windows asymmetric

Both slots advertise identically, but the *centrals* differ. Windows' BLE
reconnect scan for bonded peripherals is effectively continuous, so it catches a
1.29 s advertiser quickly. macOS's background reconnect scan for known BLE HID
peripherals is a low-duty-cycle windowed scan; against a ~1.29 s advertising
interval the expected time-to-discovery stretches into many minutes and is
routinely experienced as "never". The user's exact report — icon blinking
(advertising) for minutes, Windows fine, Mac not — matches this precisely.

## A7 — Re-ranked hypotheses (post-P1, post-blinking-icon)

| # | Hypothesis | Rank | What the ring log / console shows |
| --- | --- | --- | --- |
| **H-A** | **Adv ladder + 180 s session cap pins step 9 (~1.29 s); macOS's low-duty reconnect scan misses it** | **dominant** | `diag adv-ladder: step=1..3 (...)` then `diag adv-ladder: session cap (180000ms) reached, holding step=9 (host_off=0)`. `ble dbg` header shows `BLE ADVERT` with `int` ≈ 1285 ms. Typing produces `input boost from step=9 back to fast window` and the Mac then connects → **confirms H-A outright**. |
| H-B | macOS dropped/mismatched the bond; it sees the adv but will not initiate | high | No `dc`/`auth` ring entries at all (the Mac never connects), `ble dbg` shows `sub k- m- v-`, no `sec-fail`. Discriminator vs H-A: with H-B, an input boost to 20–30 ms still does **not** produce a connection. Fix is host-side re-pair. |
| H-C | Identity/IRK for slot 1 failed to apply → advertising with the wrong address | medium | `slot %u: IRK apply failed - will retry on next identity load` (`0x3c128b9c`), or `begin: slot 0 identity load/apply FAILED - advertising with a per-boot random address` (`0x3c127940`). `ble dbg` `addr` line would not match what macOS has bonded. |
| H-D | Sticky gate of §2 re-armed right after `set_slot` | **demoted** | Would show ring token `gate` and `diag adv-gate: …advertising held for 60000 ms`, and the icon would **not** blink. Contradicted by the observed blinking. P1 also now clears it on every switch. |
| H-E | Directed advertising / whitelist to a stale RPA | **ruled out** | §A5 — peer address never reaches the adv API; whitelist emptied; filter `(0,0)`. |
| H-F | Still-live handle blocks advertising | ruled out as *permanent* cause | Transient only (§A4); no log, self-heals on the next tick. |
| H-G | onDisconnect security-reason gate (`0x06/0x0E/0x18/0x2F`) / auth sec-fail `0x420367c4` / zombie escalation `0x42039730` | low while the icon blinks | Each requires a completed connection first; ring would show `dc x06` / `sec-fail` / `ZOMBIE`. If any of these appear, we are back in §2 and P1's release is being re-gated. |

## A8 — P3 (targeted at H-A) — **do not assume it works before the ring log confirms H-A**

Two independent 2-byte, same-length, in-place edits. Either alone helps; both
together mean the F1 never advertises slower than ~331 ms while unconnected.

| # | VA | before | after | disasm | effect |
| --- | --- | --- | --- | --- | --- |
| P3a | `0x42038049` | `0c 9a` | `0c 3a` | `movi.n a10, 9` → `movi.n a10, 3` | ladder walk clamps at **step 3** (318.8–331.3 ms) instead of step 9 |
| P3b | `0x42038018` | `0c 98` | `0c 38` | `movi.n a8, 9` → `movi.n a8, 3` | 180 s session cap pins **step 3** instead of step 9 (reuses the value the `host_off` branch at `0x42038007` already uses) |

Both bytes verified present in the accepted app image. `movi.n` immediate is
encoded in the high nibble of byte 1 (`0c 9a` = `movi.n a10,9`, `0c 3a` =
`movi.n a10,3`), so the length and all surrounding branch offsets are unchanged.

**Risk: low-medium.** The only cost is radio duty cycle while unconnected:
~331 ms vs ~1.29 s advertising is roughly 4× the (already small) advertising
current, and only in the "no host" state — the ladder still backs off from
20 ms to 331 ms exactly as before, and `adv_boost_impl` still snaps back to
20–30 ms on input. Step 3 is a value the firmware already selects itself for
the `host_off` case, so it is inside the vendor's own design envelope. It does
**not** change connection, bonding, pairing, or gate behaviour.

Deliberately **not** proposed: freezing at step 0 (20–30 ms) — that would be a
real battery regression, and it is not needed if H-A holds.

If the log instead shows H-B (Mac never connects even at step 0 after an input
boost), **no firmware patch will fix it** — the Mac must forget and re-pair the
device; the actionable follow-up would then be to make that state visible in the
UI rather than to change the radio.

## A9 — What to capture, in order

1. Enable `ble dbg…` (ID 5) — try the built-in 10-tap gesture on screen 18
   first; flash `apply-ble-debug-screen-patch.mjs` only if the gesture does not
   work.
2. Reproduce 1 → 2 → 1, **without touching any key afterwards**, and watch the
   `ble dbg` header `int  %u ms` field for ~4 minutes.
   - `int` climbing 20 → 152 → 211 → 319 → **1285 ms**, no ring entries → **H-A**.
   - Then press one key: expect `input boost from step=9 back to fast window`,
     `int` back to ~20 ms. If the Mac connects within seconds → **H-A confirmed,
     apply P3**.
   - If it still does not connect at ~20 ms → **H-B**, re-pair on the Mac.
3. If ring token `gate` or `diag adv-gate:` appears at any point, or the icon is
   *not* blinking, we are back in §2 — capture the preceding `dc x%02X` /
   `sec-fail` / `unsub` / `ZOMBIE` entries, which name the setter.

---

# Appendix B — identity / IRK / RPA trace (round 3)

Test results that reframe everything: input boost to the fast window did **not**
make the Mac connect (H-A dead); the Mac lists the keyboard as **paired but
"Not Connected"**; 2→1→2 works and Windows reconnects instantly; a **keyboard
reboot** fixes slot 1. So: the F1 advertises, the Mac hears it and declines to
auto-reconnect — the classic signature of a peripheral whose advertised address
can no longer be resolved against the IRK the Mac stored at pairing.

## B1 — Where the IRK is actually applied (pinned)

`0x4203c060` = **`apply_slot_irk(slot)`**:

```
4203c060  entry a1,48
4203c063  zero 16 bytes at a1
4203c074  rc = wl_ble_store_slot_ensure_irk(slot, a1)   ; 0x4203bf14 -> NVS key s{n}_li
4203c079  if (rc != 0) return rc
4203c07b  a10 = a1 ; call8 0x4207959c                   ; <<< ble_hs_pvcy_set_our_irk(irk)  (1 arg, 16-byte ptr)
4203c082  call8 0x42079964                              ; <<< second ble_hs_pvcy call (RPA/resolve config, no args)
4203c085  a7 |= a10
4203c088  a2 = (a7 != 0) ? 1 : 0
4203c08d  a2 = -a2                                      ; 0 = ok, -1 = failed
```

Reached only through `wl_ble_store_slot_init_ex` = `0x4203c094`, **flag bit 3**:

```
4203c0ed  bbci a3, 0, ...   -> bit0: 0x4203baac
4203c109  bbci a3, 1, ...   -> bit1: 0x4203be28  ensure identity addr  s{n}_ad  -> out+3 ; out[2]=1
4203c11c  bbsi a3, 2, ...   -> bit2: 0x4203bf14  ensure IRK            s{n}_li  -> out+10; out[9]=1
4203c136  bbci a3, 3, ...   -> bit3: 0x4203c060  APPLY IRK TO NIMBLE            ; out[26]=ok
```

The local identity **address** is applied separately, later, by
`load_and_apply_slot_identity_and_name`:

```
42038add  a10 = a1+19 (= out+3) ; call8 0x420958b0
420958b5  -> call8 0x4207f30c                           ; ble_hs_id_set_rnd(rnd_addr)
          (returns 1 on success; on failure logs via NimBLEDevice tag 0x3c134974)
42038af8  one retry after a 30 ms wait (0x4203372c), then give up
```

Supporting IDs: `0x4207f44c` = `ble_hs_id_copy_addr(type, out, out_is_nrpa)`
(used by `0x42095870(type,NULL,NULL)` as an existence probe and by
`0x420957c8` = `NimBLEDevice::getAddress()`, which selects the type from the
global `byte[0x3fcaf128] & 1`). Correction to §A5: `0x42094430` is
`isAdvertising()` (it wraps `0x420781e4` → `ble_gap_adv_active()`), not `start()`;
the actual start is `0x420947b4`. Nothing else in §A5 changes.

## B2 — The defect: the IRK apply is **non-fatal**

`load_and_apply_slot_identity_and_name` = `0x420389dc`:

```
420389e4  wl_ble_store_slot_set_active(slot)                     ; global byte @0x3fcae3b8
420389f8  a8 = byte[this+0x1cf]                                  ; "identity applied" latch
42038a01  if (a8 != 0) -> 0x42038a34 ......... flags = 6   (0b0110: addr + IRK-load, **bit3 CLEAR** -> no apply)
42038a06  else ......................... flags = 14  (0b1110: addr + IRK-load + **bit3 APPLY**)
42038a29  call 0x4203c094(slot, flags, out38)
42038a74  a8 = byte[a1+42] (= out[26], "IRK applied ok")
42038a77  if (a8 == 0) -> 0x42038a88                             ; <<< FAILURE PATH
42038a79     byte[this+0x1cf] = 1                                ; latch, only on success
42038a84     j 0x42038aa0
42038a88  log "slot %u: IRK apply failed - will retry on next identity load"   (0x3c128b9c, line 140)
42038a9d  ... and FALLS THROUGH to 0x42038aa0                    ; <<< NOT an error return
42038aa0  ...
42038ac2  if (u16[this+0x238] != 0xffff) return 0                ; only conn handles are fatal
42038ad1  if (u16[this+0x23c] != 0xffff) return 0
42038add  ble_hs_id_set_rnd(out+3)                               ; identity ADDRESS applied
42038b9f  return 1                                               ; SUCCESS
```

**So a failed `ble_hs_pvcy_set_our_irk` does not fail the identity load.**
`start_advertising_impl` sees `a10 != 0` at `0x420344f8`, skips the
`identity load failed, radio stays down` branch, and advertises — with the new
slot's identity **address** but the **previous slot's local IRK** still in the
controller. If the advertised own address is an RPA (which is why a local IRK
exists per slot at all), macOS computes `ah(IRK_slot1, prand)` against the RPA it
now hears, gets no match, treats the advertiser as an unknown device, and never
initiates — exactly "paired, Not Connected". Windows, still on the IRK that *is*
loaded (or matching on a static identity address), reconnects instantly.

## B3 — Boot vs `set_slot`, instruction by instruction

Both paths call the **same** function — there is no separate "init-only"
identity loader:

| | boot | slot switch |
| --- | --- | --- |
| entry | `begin()` `0x420350d0` | `set_slot` `0x420386c4` |
| create NimBLE device/server/adv | `0x42035486`..`0x42035495` | — (already exists) |
| `wl_ble_store_slot_set_active` | `0x420354af` (slot 0) | inside `load_and_apply` |
| identity/IRK load+apply | **`0x420354d0`** `load_and_apply(this, 0)` | `0x420387aa` → `start_advertising_impl` → **`0x420344f5`** `load_and_apply(this, slot)` |
| advertising state at that moment | **never started** — `NimBLEAdvertising` was constructed a few instructions earlier and no start has been issued | previously running; `set_slot` calls `stop_advertising` (`0x420335f4`) at **`0x42038772`**, then `0x42033fc8` at `0x42038777`, and the `ble::update()` tick re-asserts advertising every tick (`BLE: background advertising was off while route active - re-asserting`, `0x3c126d6c` → `0x42034788`) |
| latch `byte[this+0x1cf]` | 0 → flags 14 | cleared at **`0x42038798`** → flags 14 |

`0x42039390` (the "teardown" in `set_slot`, `0x42038713`) is **not** an
advertising stop — it walks the three report queues at `this+0xac / +0xf4 / +0x13c`,
resets the string at `this+92` and calls `0x4038e380`. The only advertising stop
in `set_slot` is `0x420335f4` at `0x42038772`.

This is the whole difference: **at boot the resolving-list HCI commands issued by
`ble_hs_pvcy_set_our_irk` run with advertising provably idle; on a slot switch
they run in a window that the periodic advertising re-assert can and does
reopen.** `LE Clear Resolving List` / `LE Add Device To Resolving List` are
Command-Disallowed while advertising is enabled with address resolution on — the
firmware's own `IRK apply failed - will retry on next identity load` string
exists precisely because the author expected this to fail sometimes. And the
promised retry never lands, because every retry is issued from
`start_advertising_impl`, i.e. from the same "advertising is being (re)asserted"
context.

Consistency check against every observation:

| observation | explained |
| --- | --- |
| icon blinks (advertising) | identity load returns success; only the IRK apply failed | 
| Mac: paired but Not Connected, never initiates | RPA generated from the stale IRK does not resolve against the Mac's stored IRK |
| Windows/slot 2 reconnects instantly | it is the IRK that remained loaded (or it matches on the static identity address) |
| reboot fixes slot 1 | `begin()` applies slot 0/1 IRK with the radio idle |
| key press / adv boost does not fix it | `adv_boost_impl` `0x42038118` only changes the interval; it never re-applies identity or IRK |
| hold-to-pair fixes it | a fresh pairing redistributes a new IRK to the host |
| P1 did not help | the gate was never engaged |

## B4 — `has_peer` / `s{n}_bp` / `s{n}_nimble_bond` on switch

- `s{n}_bp` is **not** consulted for reconnect targeting — §A5: read at
  `0x420345ed`, only OR-tested for all-zero. `has_peer(slot)` = `0x4203b7f4` is
  used as a boolean by the §2 gate (`0x42034514`) and by the comm manager
  (`0x42042b98`/`0x42042bb4`).
- The bond itself is **not** re-loaded into NimBLE on a switch, and does not need
  to be: `wl_ble_store_slot_set_active` (`0x4203bdf4`) flips one global byte at
  `0x3fcae3b8`, and NimBLE's `ble_store` read/write/delete callbacks resolve
  `s{n}_nimble_bond` / `s{n}_c{HHHH}` through it lazily, on demand. There is no
  eager `ble_store_util` reload to miss — and no lock, which remains the §H4
  race, unchanged.
- So the bond/LTK side of a switch is fine. The identity side is not.

## B5 — P4 (evidence-gated): apply identity + IRK from the stopped window in `set_slot`

Move the identity/IRK reload out of `start_advertising_impl` and into `set_slot`
itself, at a point after `stop_advertising` (`0x42038772`) and after the slot
commit (`0x4203877d`), so `ble_hs_pvcy_set_our_irk` runs before anything
re-asserts advertising.

Window `0x420387a3`..`0x420387ac` — **exactly 10 bytes**, currently the P1 pair
plus the direct advertise call:

```
before (stock 0.4.1):   0c 1b  e5 ca fa  ad 02  a5 c2 fb
        movi.n a11,1 ; call8 0x42033454 ; mov.n a10,a2 ; call8 0x420343d4
before (P1 applied):    bd 03  a5 11 00  ad 02  a5 c2 fb
        mov.n a11,a3 ; call8 0x420388c0 (release_adv_hold) ; mov.n a10,a2 ; call8 0x420343d4 (start_advertising_impl)

after : c2 a0 00  bd 03  ad 02  25 23 00
        movi  a12,0        ; out38 = NULL  (a12 is clobbered by the preceding call8 — must be zeroed,
                           ;  0x42038b9d memcpy's the out struct to a4 when non-NULL)
        mov.n a11,a3       ; new slot
        mov.n a10,a2       ; this
        call8 0x420389dc   ; load_and_apply_slot_identity_and_name(this, new_slot, NULL)
```

`call8` encoding check: PC `0x420387aa`, `(PC+4)&~3 = 0x420387ac`,
`(0x420389dc − 0x420387ac)/4 = 0x8C`, `(0x8C<<6)|0x25 = 0x2325` → `25 23 00`
(same method that verifies the existing `a5 c2 fb` → `0x420343d4`).

**Risks / trade-offs — read before flashing:**

- **Replaces P1.** The `release_adv_hold` call is dropped. Acceptable only
  because the gate is now known not to be the active fault (§A1); if §2 ever
  recurs, P1 and P4 cannot both live in this window and P4 would need to move.
- **`set_slot` no longer starts advertising directly.** Restart falls to the next
  `ble::update()` tick, which re-asserts advertising whenever it is off and the
  route is active (`0x42032a49` → `0x42034788` → `0x42034744`). Expect a
  sub-tick delay before the icon starts blinking after a switch. If that delay is
  visible or the restart does not happen, revert immediately.
- **Does not stop advertising itself.** It relies on `0x42038772` having stopped
  it and on nothing re-asserting before `0x420387aa`. If the log still shows
  `IRK apply failed` after P4, the stop is not holding and the fix needs an
  explicit `stop_advertising` in the same window — which does **not** fit in
  10 bytes and would need an appended-IROM thunk (out of `call8` range, so
  `l32r`+`callx8` with an in-range literal).
- **Do not flash P4 before the log confirms `IRK apply failed`.** If that line is
  absent, the IRK is being applied correctly and this whole appendix is wrong.

## B6 — What the log must show to confirm (or kill) B2

Console (`ESP_LOG`), during the 2→1 switch:

| line | meaning |
| --- | --- |
| `store set_active: slot 2 -> 1` (`0x3c129204`) | the store followed the switch |
| **`slot 1: IRK apply failed - will retry on next identity load`** (`0x3c128b9c`) | **B2 confirmed** — `ble_hs_pvcy_set_our_irk` was rejected; the advertised RPA is still slot 2's |
| absence of that line | B2 refuted — the IRK was applied; look instead at whether the Mac's bond is simply gone (re-pair) |
| `diag adv-gate: slot 1 identity load failed, radio stays down` (`0x3c127514`) | the *address* apply also failed — different, and the icon would not blink |
| `identity addr record corrupt (slot=1 err=0x%x) - regenerating` (`0x3c129244`) or `IRK record corrupt (slot=1 err=0x%x) - regenerating` (`0x3c1292ac`) | NVS damage — the slot's identity/IRK was regenerated, so **every** bonded host for that slot must re-pair |

On the `ble dbg…` screen (ID 5) the decisive field is the two `addr` lines
(`0x3c125387` / `0x3c125399`, `addr %02X%02X%02X` + `%02X%02X%02X`), which render
the address from `NimBLEDevice::getAddress()` (`0x420957c8`):

- **Reboot on slot 1, note the 6 bytes. Then switch 1→2→1 and compare.**
  - Same address both times, and its top two bits are `0b01` (a resolvable
    private address) → the address is an RPA and the IRK behind it is what
    changed → B2.
  - Address differs between boot and post-switch → the identity address itself is
    not being restored → address-apply failure, check `ble_hs_id_set_rnd`.
  - Same address, top two bits `0b11` (static random) → the Mac matches on
    address, not RPA, so B2 cannot be the mechanism → fall back to "macOS lost
    the bond, re-pair".
- Ring tokens stay silent in the B2 scenario: **no** `gate`, **no** `dc`, **no**
  `sec-fail`, **no** `auth` — because no connection is ever attempted. A ring
  with only `up`/`dc` from the *old* slot-2 session and nothing after the switch
  is itself strong evidence for B2.

## B7 — Zero-patch debug-screen procedure (exact)

No flash needed. Handler `0x4202509c` is vtable slot 10 of the controller whose
id stub `0x42108ba8` returns **18**, i.e. it only runs while **screen ID 18** is
the active screen. Screen 18's renderer (`0x42025288`, vtable `0x3c1abb90`
slot 1) draws `Idle` (`0x3c125830`), `Standby` (`0x3c125838`), `Firmware`
(`0x3c125840`), `Protocol ID` (`0x3c12584c`) and `Press and hold` / `fn to exit`
(`0x3c125630` / `0x3c125643`) — **the settings / device-info screen showing the
Idle and Standby timeouts, the firmware version and the Protocol ID.**

Procedure:

1. Turn the dial to that settings/device-info screen (Idle / Standby / Firmware /
   Protocol ID). It must be the *active* screen — the gesture is dispatched to
   the current controller only.
2. Press **both Fn keys together, 10 times**, with **less than 500 ms between
   presses**. Evidence: `0x4202509f` requires event type 5 (docs/04 identifies
   type 5 as the both-Fn-keys event) with the second arg 0; `0x420250c1..c9`
   resets the counter when `now − last > 500` (`0x1f4`); `0x420250de` requires
   `count > 9`; `0x420250e8..f8` then toggles.
3. The three diagnostic screens (IDs **6, 4, 5**) are now in the dial ring. Turn
   the dial to `ble dbg…` (**ID 5**).
4. The flag lives in RAM at `0x3fcadb80` — it is **lost on reboot**, and the same
   10-tap toggles it back off. Redo step 2 after every power cycle.

Only flash `custom-firmware/apply-ble-debug-screen-patch.mjs` (§A2) if the
gesture does not take — and do not use both, or the three IDs get appended to the
nav ring twice.

## Resolution (2026-08-18, live)

- User's `ble dbg` `addr` line after the gesture: `CD:93:E5:81:3F:FB` — first nibble `C` ⇒ static random identity, so hypothesis B2 (IRK/RPA mismatch) cannot apply on this unit.
- The Mac held **two** paired records named "Framer F1 #1" (`E4:F4:12:D2:71:7B` stale, `CD:93:E5:81:3F:FB` current). Forgetting the device on the Mac and re-pairing on slot 1 fixed the bug: Fn+1 → Fn+2 → Fn+1 now reconnects. macOS shows "Not Connected" for the working BLE HID link (display quirk).
- Root cause: **stale duplicate bond on the Mac**, not the F1 firmware. P1 (set_slot → release_adv_hold) remains flashed (harmless, closes the sticky-gate hole); P3/P4 were NOT applied. Tools kept for future use: custom-firmware/apply-bt-p1-patch.mjs, apply-bt-p3-patch.mjs, apply-ble-debug-screen-patch.mjs.
- User remedy to document: if a slot stops auto-reconnecting to a Mac after slot switching, remove ALL "Framer F1" entries in macOS Bluetooth settings and re-pair once; the on-device `ble dbg…` screen (Settings screen → both Fn ×10 quickly) shows the identity address for confirmation.
