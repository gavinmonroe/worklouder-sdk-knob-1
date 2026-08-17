# Persistent default renderer-v2 scene (clock ID26 + timer ID27)

Design only. No implementation, no hardware. All line references are to the
repository as of this document.

**Goal.** The 95,535-byte generation-2 focus-clock-timer package is present and
rendering after every cold boot, with no host attached. Today it is RAM-only and
is lost on reset.

---

## 1. What exists today

### 1.1 The scene store is an anonymous boot-lifetime heap block

`renderer_scene_rpc_register` calls the stock `operator new` (`0x420e7c04`) once
for 98,624 bytes, then clears it with an inline byte loop:

- `f1-widget-sdk/examples/renderer-id26/on-device/renderer-v1-scene-rpc.S:43-46`
  — `allocation_bytes = 98624`, `store_bytes = 98304`, `store_offset = 320`
- `.../renderer-v1-scene-rpc.S:266-283` — `operator new` + `.Lscene_clear` loop
- `.../renderer-v1-scene-rpc-core.c:15` — `SCENE_STORE_BYTES 98304u`
- `.../renderer-v1-scene-rpc-core.c:102-105` — static asserts pinning
  `store_offset == 320` and `sizeof(state) == 98624`

There is **no symbol and no fixed address** for the store, and no static RAM is
permitted at all (`f1-widget-sdk/src/generic-render-v2-sources.mjs:243` asserts
the renderer's data section is zero-sized). Internal RAM vs PSRAM is *not*
pinned — `operator new` is the stock heap, and the only pointer gate is
`rv2_is_data()` accepting the whole `[0x3C000000, 0x40000000)` external+internal
data window (`custom-firmware/experimental/renderer-v2-f2ep-native.c` via
`renderer-v1-id26.c:150-159`). That window **already accepts a flash-mapped
DROM pointer**, which matters for option B below.

### 1.2 Adoption is size + frozen-digest + pointer publication — no copy, no relocation

`renderer_scene_rpc_core_commit`
(`.../renderer-v1-scene-rpc-core.c:385-483`) does, in order:

1. re-verify transaction id / generation pair / chunk and byte totals
2. write the withheld 20-byte F1WB header into `store[0..19]` (header-last), `memw`
3. SHA-256 over `store[0..total_bytes)` against the digest pinned at `begin`
4. `renderer_v2_native_prepare(controller, store, total_bytes, generation)`
5. `renderer_v1_stage_bundle(controller, store, 62404)`
6. `renderer_v2_native_commit(controller)`
7. `committed_generation = generation`, latch `SCENE_FLAG_V2_STORE_LATCH`

`renderer_v2_native_prepare`
(`custom-firmware/experimental/renderer-v2-f2ep-native.c:1159-1201`) requires
`package_bytes == 95535` exactly, `rv2_is_data(package, …)`, and **frozen
SHA-256 digests** of each sub-blob, then stores *raw pointers into the store*
(`sidecar->pending_bundle = bundle`, `:1191-1198`). Nothing is copied and
nothing is relocated; the store is borrowed for the boot lifetime.
`renderer_v2_native_commit` (`:1203-1212`) is a `PREPARED→COMMITTED` CAS; the
real swap happens on the next UI tick.

The package is a plain concatenation:

| Sub-blob | Bytes | Gate |
| --- | ---: | --- |
| focus F1WB (raster envelope) | 62,404 | `rv2_focus_bundle_is_frozen` `:310-330` |
| focus F2EP program | 15,178 | `rv2_sha_is_frozen` `:263-277` |
| timer F2EP program | 14,618 | `rv2_sha_is_frozen` `:263-277` |
| timer base LZSS | 3,335 | `rv2_sha_is_timer_base_lzss` `:279-288` |
| **total** | **95,535** | `renderer-v1-scene-rpc-core.c:22-28` |

**Key property for this design** (`renderer-v2-f2ep-native.c:308-322`): the
F1WB envelope is checked field-by-field against frozen constants *except* the
generation word at `bundle+8`, which must equal the caller-supplied
`generation`. That is why two byte-identical-length artifacts exist —
`focus-clock-timer.generation-{1,2}.package.bin` in
`f1-widget-sdk/build/combined-renderer-v2-clock-blue-timer/`. A boot adopt at
generation *N* needs the artifact whose header word is *N*.

### 1.3 Boot today, and the built-in default scene

`f1-widget-sdk/build/combined-renderer-v2-clock-blue-timer/renderer-v2-chain.S`
is the boot chain (reached by a 3-byte patch of the stock WPM call at
`0x421170c5`):

| Step | Effect |
| --- | --- |
| `renderer_v1_register_id26` | controller + 62,000 B framebuffer |
| `operator new(10284)` | RAM buffer for boot assets |
| `renderer_v2_decode_assets` | LZSS-decode 3,055 B of **DROM rodata at `0x3c1cf400`** |
| `renderer_v1_stage_bundle(ctl, assets, 748)` | stage built-in 748 B F1WB |
| `renderer_v1_tick` | render it before RPC exists |
| `renderer_v2_native_attach(…, assets+748, 9536)` | attach boot F2EP |
| `renderer_scene_rpc_register(ctl)` | `operator new(98624)`, zero, register 6 methods |
| `s32i.n a8,a10,8` with `a8=1`; `memw` | **seed `committed_generation = 1`** |
| `renderer_v2_rpc_register` | `widget.v2.event` surface |

So a fail-closed fallback scene already exists and is independent of the RPC
store. Persistence is explicitly absent by contract, not by omission:
`f1-widget-sdk/docs/renderer-v2.md:292-293` ("Publication is RAM-only and
boot-lifetime"), and the host *requires* the device to advertise
`ramOnly === true && persistence === false`
(`f1-widget-sdk/src/render/scene-rpc.mjs:56-57`). There is no `nvs_*`,
`esp_partition_*`, or `spi_flash_*` call anywhere in `custom-firmware/` or
`f1-widget-sdk/src/`.

### 1.4 Flash map

Partition table at `0x8000` (from the pre-custom dump,
`recovery/backups/2026-08-15-framer-f1-a4cb8faf3210-before-custom/manifest.json:29-90`;
pinned at `experiments/mquickjs-device-canary-workflow/contract.mjs:22-58`):
`phy_init 0x0f000`, **`factory 0x10000 (8 MiB)`**, `nvs 0x810000 (128 KiB)`,
`fs 0x830000 LittleFS (2 MiB)`, `coredump 0xa30000`.

Inside `factory`
(`experiments/mquickjs-device-canary-workflow/README.md:22-38`,
`experiments/mquickjs-esp32s3-module-loader/verify.mjs:40-56`):

| Region | Range | Bytes | Status |
| --- | --- | ---: | --- |
| app | `0x10000..0x207a40` | 2,062,912 | written last |
| erase-safe gap | `0x208000..0x210000` | 32,768 | untouched |
| slot A text | `0x210000..0x230000` | 131,072 | MQuickJS module text |
| slot A rodata | `0x230000..0x240000` | 65,536 | MQuickJS module rodata |
| **slot B** | `0x240000..0x270000` | **196,608** | **unused today** |
| tail | `0x270000..0x810000` | 5,898,240 | free |

---

## 2. Recommended design

### 2.1 Storage: a self-describing record at the start of slot B

Put the package at `0x240000` behind a 64-byte header so that erased flash
(`0xFF…`) is indistinguishable from "no default scene" and the device boots
exactly as it does today.

```
0x240000  magic     "F1DS"            (4)   default-scene record
0x240004  version   1                 (1)
0x240005  flags     0                 (1)
0x240006  reserved  0                 (2)
0x240008  generation                  (4)   must match the F1WB word at payload+8
0x24000c  payloadBytes 95535          (4)
0x240010  payloadSha256               (32)
0x240030  reserved  0                 (12)
0x24003c  headerCrc32                 (4)   over 0x240000..0x24003b
0x240040  payload   95,535 bytes            focus-clock-timer.generation-N.package.bin
```

Ends at `0x25764f` — 95,599 of 196,608 bytes used, leaving room for a second
A/B record at `0x258000` later.

**Write path: provisioning-time, host-side, offline.** The package is flashed to
`0x240000` with the same esptool step that already writes slot A. This is the
decisive simplification: no device-side flash writer, no wear policy, no
cache-off write hazard, no new failure mode on a live device — and it fully
satisfies "present after every boot without a host". A device-side
`widget.scene.persist` RPC is a *later* increment, not part of this one.

Rejected alternatives:
- **Appended app IROM/DROM** — requires image growth and MMU page-index shifts
  (the `renderer-v2-terminal-page-v1` profile,
  `f1-widget-sdk/src/device-workflow.mjs:138-215`) and re-audits far more of the
  image for no benefit. The accepted build deliberately uses the no-growth
  mapped-prefix/LZSS profile with 17 bytes of headroom.
- **NVS (`0x810000`, 128 KiB)** — a 95.5 KB blob nearly fills a partition the
  stock app already owns.
- **LittleFS `fs`** — adds a mount dependency and shares space with user data.

### 2.2 Adoption: copy into the existing store, then run the existing commit path

Insert one call into the boot chain, **after** `renderer_scene_rpc_register`
returns the state pointer and **before** the `committed_generation = 1` seed
(between `renderer-v2-chain.S` `.Lrender_v2_register_scene_rpc` and the
`movi.n a8,1 / s32i.n a8,a10,8` pair). New function
`renderer_scene_default_adopt(controller, state)`:

1. `esp_flash_read` the 64-byte header from `0x240000`. If magic/version/CRC
   mismatch, or `payloadBytes != 95535`, return 0 — chain then seeds
   generation 1 exactly as today.
2. `esp_flash_read` the payload directly into `state->store` in ≤4 KiB chunks
   (the store is already allocated and zeroed at this point).
3. SHA-256 over `store[0..95535)` vs `payloadSha256`, reusing the existing
   in-tree implementation (`renderer-v1-scene-rpc-core.c:210-231`).
4. `renderer_v1_prepare_store(controller, store)` — the same gate `begin` uses
   (`renderer-v1-scene-rpc-core.c:330`).
5. `renderer_v2_native_prepare(controller, store, 95535, header.generation)`
6. `renderer_v1_stage_bundle(controller, store, 62404)`
7. `renderer_v2_native_commit(controller)`
8. `renderer_v1_tick(controller)` to perform the swap before the screen is live
9. return `header.generation`; the chain seeds `state->committed_generation`
   with that value instead of the hard-coded `1`, and sets
   `state->flags = SCENE_FLAG_V2_STORE_LATCH` (or not — see §3.2)

On any failure at steps 1–8, call `renderer_v2_native_cancel`
(`renderer-v2-f2ep-native.c:1214-1233`), leave the boot F2EP/F1WB active, and
seed generation 1. **Fail-closed by construction.**

This reuses every existing validation gate unchanged. No new trust surface:
the frozen-digest gate in `renderer_v2_native_prepare` means only the exact
audited clock+timer package can ever be adopted, whatever is in slot B.

`renderer_v1_stage_bundle` rejects `generation <= active_generation`
(`custom-firmware/experimental/renderer-v1-id26.c:648`) and `store ==
active_bundle` (`:623`); the boot bundle is generation 1 and lives in the
separate 10,284 B asset buffer, so a generation-2 adopt from the store passes
both.

### 2.3 Variant B (not recommended for the first increment): reference-in-place

`rv2_is_data()` accepts `[0x3C000000, 0x40000000)`, so a slot-B region mapped
into DROM via `esp_mmu_map` (`0x420f539c`) would satisfy the pointer gate and
`renderer_v2_native_prepare` would happily keep pointers straight into flash —
zero copy, zero store consumption. Two 64 KiB MMU pages (`0x240000..0x260000`)
fit the free shared linear window, which starts at `0x3d0000`
(`experiments/mquickjs-esp32s3-module-loader/README.md:46`), i.e. vaddr
`0x3c3d0000..0x3c3f0000` — directly below the MQuickJS module's rodata page at
`0x3c3f0000`.

It is deferred because: `esp_mmu_map` is not thread-safe and IDF 5.3.2 leaves
its private list inconsistent after a first-map allocation failure
(`.../module-loader/README.md:86-98`), it collides with the MQuickJS slot-A/B
address budget, and the copy it avoids costs ~96 KB of a buffer that already
exists and is otherwise idle at boot.

---

## 3. What has to change in the audited app image

### 3.1 New device code — rebuild, do not patch the cavity

The free IROM cavity in the accepted image is
`[0x4211e460, 0x4211ff18)` = 6,840 bytes
(`experiments/mquickjs-esp32s3-module-loader/README.md:29-31`), and the
MQuickJS resident loader already consumes 4,732 of those bytes in the current
diagnostic build. That leaves ~2.1 KB — not enough, and taking it would break
the MQuickJS workstream.

The correct path is a **source rebuild** of the combined renderer through
`f1-widget-sdk/src/combined-renderer-v2-firmware.mjs` (source manifest at
`:34-48`, cavity placement at `:765-807`), which regenerates the integrated
IROM region and re-runs the existing byte-preservation, zero-relocation,
determinism (`deterministicRebuilds: 2`) and approval-draft gates. Estimated
new code: ~700–1,100 bytes of `.text` plus the chain edit; the accepted module
currently occupies 23,700 of the 30,540-byte region, so it fits.

### 3.2 The `SCENE_FLAG_V2_STORE_LATCH` begin-lockout

`renderer_scene_rpc_core_begin` returns `SCENE_RPC_BUSY` when
`flags & (SCENE_FLAG_ACTIVE | SCENE_FLAG_V2_STORE_LATCH)` is set
(`renderer-v1-scene-rpc-core.c:314-315`). If the boot adopt sets the latch, a
live re-push becomes impossible — the persisted scene would be unreplaceable
without a reflash. Two options:

- **(a)** Port the detach handshake the generic profile already uses
  (`custom-firmware/experimental/renderer-v2-f2ep-generic.c:902-949`) so the
  latch can be released for a new upload. Correct, and needed anyway.
- **(b)** Do not set the latch on boot adopt. Cheaper, but leaves the store
  writable while the renderer holds pointers into it — the exact hazard the
  latch exists to prevent. **Not acceptable.**

Take (a).

### 3.3 Generation contract

The chain currently hard-codes `committed_generation = 1`, and the host pins
`expectedGeneration: 1, generation: 2`
(`f1-widget-sdk/examples/render-v2-focus-timer/focus-timer-package.mjs:7-25`).
After a generation-2 boot adopt, a live re-push must use generation 3. The host
tool must read `widget.scene.status` and derive `expectedGeneration` from the
device rather than assuming 1, and the package builder must emit a
generation-*N* F1WB header on demand (it already parameterizes this — the
generation-1 and generation-2 artifacts differ only in that word).

### 3.4 Capability contract

`f1-widget-sdk/src/render/scene-rpc.mjs:56-57` and
`f1-widget-sdk/src/combined-renderer-firmware.mjs:483-487` assert
`ramOnly === true && persistence === false`. The device capabilities response,
the host assertion, and the affected tests
(`f1-widget-sdk/test/combined-renderer-firmware.test.mjs`) all need a
coordinated update to a new shape (e.g. `persistence: "flash-default-scene-v1"`,
`ramOnly: false`). This is a contract change, so it needs its own review.

### 3.5 Flash-write scope

Provisioning gains one esptool write at `0x240000`. Every current tool declares
an app-only or app-plus-slot-A write scope
(`experiments/mquickjs-esp32s3-module-loader/verify.mjs:56`,
`web-flasher/README.md:66-67`); slot B must be added explicitly to that scope
and to the rollback plan. Rollback = erase `0x240000..0x240040` (header only);
the device then boots the built-in scene.

---

## 4. Risks

| Risk | Assessment |
| --- | --- |
| **Heap** | None new. The 98,624 B store is already allocated at boot and is idle until the first upload. No additional allocation. |
| **Cache / flash ops** | `esp_flash_read` disables the cache on both cores for the duration. The adopt runs on the setup task during the registration chain, before LVGL timers and before the MQuickJS owner task exists, which is the safest window in the boot. Read in ≤4 KiB chunks so no single cache-off window is long. `docs/renderer-v2.md:266-270` already requires pausing the VM during flash operations — that ordering constraint must be re-checked if the MQuickJS module ever starts earlier. |
| **Boot time** | ~95.5 KB flash read (a few ms) plus SHA-256 over 95,535 B in `rv2_sha_digest` (software, `renderer-v2-f2ep-native.c:250-262`) — and the adopt path runs SHA-256 four times over overlapping data (once for the record digest, three times in the frozen-digest gates). Budget **50–150 ms** added to boot; must be measured on the bench, not assumed. If it is too slow, drop the record-level SHA-256 (step 3): the frozen-digest gates already cover every payload byte except the F1WB header, which is field-checked. |
| **MMU** | Zero, for the recommended copy design. This is the main reason to prefer it over variant B. |
| **Stale slot B after a firmware update** | The frozen digests are compiled into the renderer. A firmware update that changes the package invalidates slot B; adopt fails and the device falls back to the built-in scene. Fail-closed, not a brick — but the provisioning flow must rewrite slot B whenever the app changes, and the record should carry the expected app SHA-256 prefix in its reserved bytes to make that explicit. |
| **Slot B ownership** | Slot B is currently reserved (unwritten) in the MQuickJS canary flash map. Using it for the default scene needs sign-off from that workstream or a move to the `0x270000+` tail. |
| **Unreplaceable scene** | Real if §3.2 is skipped. Do not ship without the detach handshake. |

---

## 5. Effort estimate

| Work | Days |
| --- | ---: |
| Record format, host packer, esptool/provisioning wiring, rollback plan | 0.5 |
| `renderer_scene_default_adopt` + chain edit + host unit tests | 1.5 |
| Latch/detach handshake port from the generic profile (§3.2) | 1.0 |
| Generation-contract changes, host tool + package builder (§3.3) | 0.5 |
| Capability contract change across device/host/tests (§3.4) | 1.0 |
| Rebuild, byte-preservation/determinism/approval gates, diff review | 1.0 |
| Bench validation: boot timing, 20× power-cycle, rollback, live re-push | 1.0 |
| **Total** | **~6.5 engineer-days** |

Add ~3 days if variant B (mmap reference-in-place) is pursued instead, mostly
for the `esp_mmu_map` failure-mode work and address-budget coordination with the
MQuickJS module.

## 6. Recommended sequencing

1. Land §3.2 (detach handshake) on its own — it is independently valuable and
   removes the only hard blocker.
2. Land the record format + provisioning write with the device still ignoring
   slot B. Zero behaviour change; proves the flash plan.
3. Land `renderer_scene_default_adopt` behind the header magic, so an unwritten
   slot B is a no-op and rollback is a 64-byte erase.
4. Land the capability/generation contract changes last, once the device
   behaviour is proven on the bench.
