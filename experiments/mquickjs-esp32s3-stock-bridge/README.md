# ESP32-S3 stock-ABI bridge audit

This directory is a hardware-free, exact-image bridge probe for the accepted
Framer `0.4.1` clock/timer application:

`363170139a06f306be1e894b6f203a9bf03bf4d70d21194aaccdd1c42f760c32`

It produces no firmware and patches no application.  Its result is deliberately
`physicalCandidate: "NO_GO"`: the useful stock seams are now exact, but the
resident owner still has to bind three symbols and the remaining physical
safety gates need device evidence.

Run:

```sh
node experiments/mquickjs-esp32s3-stock-bridge/verify.mjs
```

The verifier re-hashes the complete healthy application, its accepted device
receipt, 18 exact virtual-address spans, and the evidence sources.  It then
cross-compiles a fail-closed Xtensa bridge and proves an illustrative setup-tail
link without writing any firmware.  Results are in
`build/stock-bridge-manifest.json`.

## What is exact now

| Seam | Address/range | Result |
| --- | --- | --- |
| setup registration chain | `0x42118c68..0x42118ce0` | Full-span hash. On the successful path `a6` retains the ID26 controller. The shared failure path may leave it indeterminate, so startup validates the pointer, vtable, slot 6, sidecar, and magic before dereferencing further. |
| setup tail | `0x42118cdd..0x42118ce0` | Exact `retw.n` plus padding (`1d f0 00`). It can hold one 3-byte `J`, not a `call8`. The target is entry-less, passes `a6` as outgoing `a10`, calls startup, then executes the original window's `retw.n`. |
| heap | `free=0x4037e250`, `malloc=0x4037e55c`, `free-size=0x420c8200`, `largest=0x420c82c4` | Full function spans hashed. VM allocation requests `SPIRAM|8BIT`, preflights free/largest, and rejects a result outside the exact current 2 MiB PSRAM window. |
| static task | `create=0x4038e950`, `delete=0x4038db48`, `current-for-core=0x4038eb7c` | Full spans hashed. `StaticTask_t` is exactly `0x160` bytes and stack depth is bytes. The owner acknowledges shutdown and deletes itself with `vTaskDelete(NULL)`; there is no unsafe remote deletion. |
| dynamic task | `0x4038e8b8` | Located and full-span hashed, but deliberately unused. Note the entry is `0x4038e8b8`, not `0x4038e838`. |
| key callback | literal `0x42041568` / app offset `0x101568`; target `0x4206eae0` | Full target hash. The wrapper calls stock first, retains its return value, then copies the opaque `u32` token from `a3` and `u8` level from `a4` into a bounded non-JS sink. |
| UI callback | v2 live tick `0x4211dc40`; sidecar `old_tick` offset `+4` | Slot 6 must **not** be replaced: native v2 helpers require it to remain `0x4211dc40`. The safe seam wraps sidecar `old_tick`, calls renderer-v1 `0x4211960c` first, and then invokes the bounded UI mailbox sink. Both focus ID26 and timer ID27 delegate through that field. |
| status RPC | registry `0x42004afc`; register helper `0x4211b7c8`; reply helper `0x4211ba58` | Full spans hashed. Method, key, values, and callback context occupy resident-owned boot-lifetime RAM. The helper registers a copied closure and destroys only the temporary callback object. |

The production relocatable core intentionally has exactly these unresolved
symbols:

- `framer_stock_bridge_resident_state`
- `framer_stock_bridge_resident_boot`
- `framer_stock_bridge_resident_abort`

That is the handoff contract to the resident lane.  Missing any one causes the
final link to fail; there is no weak/no-op physical fallback.

## UI seam rationale

Replacing controller vtable slot 6 looks attractive but is wrong for this exact
renderer. `rv2_installed_sidecar()` compares that slot to
`renderer_v2_live_tick`; changing it silently disables native prepare, commit,
cancel, and host-event paths.

The v2 live tick instead loads its sidecar from vtable slot 11, validates magic
`0x32565343`, loads `old_tick` at sidecar offset `+4`, and calls it.  Wrapping
that field leaves slot 6 and slot 9 identities untouched.  Detach first disables
the custom sink, atomically restores renderer-v1 tick, then waits for the UI
wrapper inflight count to reach zero.

The hook provides a correct UI-thread place to consume the resident's stable
72-byte seqlock mailbox.  This directory does **not** claim arbitrary 16-slot
DOM/F2JS rendering: the resident/renderer integration still must supply the
bounded `ui_sink` implementation.

## Lifecycle and flash policy

The intended order is:

1. Tail startup validates the already-installed ID26/27 renderer sidecar.
2. The resident boot binding allocates the 64 KiB VM heap in PSRAM, creates the
   caller-owned 12 KiB internal stack/static task, and installs bounded key/UI
   sinks.
3. The bridge wraps sidecar `old_tick`, registers the owned status RPC, enables
   key ingress, and advertises `ready`.
4. Quiescence changes RPC status to `blocked`, disables custom key/UI ingress,
   restores the old UI tick, requests owner shutdown, and waits for wrapper
   inflight counts, task acknowledgement, VM free, and module unmap.
5. Only `framer_stock_bridge_flash_safe()` returning true permits the routed
   module flash operation.

This is an explicit routed policy, not automatic protection.  The stock key
literal is flash-mapped and cannot be restored at runtime; logical detach keeps
calling stock normally.  Before cache-off flash work, the integration must also
pause the stock input source so a new wrapper invocation cannot begin.  No exact
generic flash-operation notification/interception seam has been recovered.

## Remaining physical blockers

- Bind the three resident symbols and implement the bounded mailbox consumer;
  then link them with the already-built MQuickJS module/loader without address
  overlap.
- Prove input delivery is paused across every cache-disabled flash operation,
  or recover an exact stock flash/cache notification seam.
- Recover and hash a complete task-WDT add/reset/delete lifecycle before opting
  into it. The bridge currently does not register with task WDT.
- `uxTaskGetStackHighWaterMark` was linker-GC'd from this image. Use a proven
  caller-owned stack-fill scan or recover another exact telemetry seam; do not
  invent an address.
- Exercise status RPC, key down/up/hold/chords, knob+Fn, UI mailbox application,
  OOM, timeout, destroy/unmap, recovery, and hidden-screen policy on the physical
  keyboard; record exact app/module SHAs and applied revisions.
- Run the bounded soak and retain a final physical receipt. Static feasibility
  is not hardware proof.

The generated manifest is the machine-readable source of truth for every
`PROVEN_STATIC`, conditional, and `NO_GO` claim.
