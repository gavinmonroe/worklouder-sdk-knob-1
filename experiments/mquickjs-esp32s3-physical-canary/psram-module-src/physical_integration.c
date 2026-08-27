#include "../mquickjs-esp32s3-resident-integration/resident_integration.h"
#include "../mquickjs-target-facade/target_facade.h"
#include "../mquickjs-esp32s3-runtime-proof/runtime_proof.h"
#include "../mquickjs-widget-upload/f2up_upload.h"
#include "../mquickjs-widget-upload/f2up_persist.h"
#include "../mquickjs-widget-upload/f2up_adopt.h"
#include "fatal_retirement.h"
#include "completion_contract.h"
#include "focus_contract.h"
#include "key_gate.h"
#include "publication_contract.h"
#include "telemetry_session.h"

#include <stddef.h>
#include <stdint.h>

#define PHYSICAL_GENERATION 19u
#define PHYSICAL_SCREEN_ID 28u
#define PHYSICAL_MAGIC 0x514a5732u
#define PHYSICAL_PROXY_MAGIC 0x38325057u
#define PHYSICAL_FRAME_BYTES 62000u
#define PHYSICAL_INTERNAL_BEGIN 0x3fc80000u
#define PHYSICAL_INTERNAL_END 0x3fd00000u
#define PHYSICAL_CAP_INTERNAL 0x0800u
#define PHYSICAL_CAP_8BIT 0x0004u
/* MALLOC_CAP_SPIRAM (ESP-IDF 5.3.2 esp_heap_caps.h, bit 10).  The accepted app
 * image itself pins the mapped PSRAM window: the two esp_psram start literals
 * at IROM+0xbdd18 and IROM+0xbdd1c both read 0x3c1d0000 and the reservation is
 * 0x200000 bytes (experiments/mquickjs-esp32s3-module-loader/verify.mjs:111 and
 * .../README.md:46), which matches the live boot log adding a 2048K PSRAM pool.
 * The generic ESP32-S3 external-data window is 0x3c000000..0x3e000000; the low
 * 0x1d0000 of it is the app's own flash DROM mapping, so PSRAM starts above it.
 * Both bounds below are therefore image-derived, not assumed. */
#define PHYSICAL_CAP_SPIRAM 0x0400u
/* PSRAM kept free after the per-slot arenas so the 64 KiB VM heap can always
 * be claimed by the owner task. */
#define PHYSICAL_PSRAM_RESERVE_BYTES (192u * 1024u)
/* Hide after this many ms without any proxy_tick: the stock ticks the visible
 * controller every frame (~30 ms), so 400 ms of silence means no widget screen
 * is fronted.  Well above one frame, well below human perception of "stale". */
#define FRAMER_PHYSICAL_HIDE_SILENCE_MS 400u
/* The reserved ANY-KEY token: HID usage 0x01 is ErrorRollOver, which is never
 * a real key press, so a widget can declare it as a catch-all without
 * colliding with any physical key. */
#define FRAMER_PHYSICAL_ANY_KEY_TOKEN 0x01u
#define PHYSICAL_PSRAM_BEGIN 0x3c1d0000u
#define PHYSICAL_PSRAM_END 0x3c3d0000u
/* heap_caps_malloc returns 8-byte alignment on this build (live evidence
 * 0x3fcd0d58, loader_entry_diag.c:603); the VM heap contract is 16-byte
 * aligned, so over-allocate by one alignment quantum and align up. */
#define PHYSICAL_HEAP_ALIGN_SLACK 16u

/* --- boot-time default renderer-v2 scene (ID26 clock + ID27 timer) --------
 *
 * The 95,535-byte generation-two focus-clock-timer package is RAM-only today:
 * the host pushes it over widget.scene.begin/write/commit into the scene-RPC
 * store and it is lost on reset.  This module re-publishes it at boot from an
 * otherwise unused flash slot, using the exact publish sequence the RPC commit
 * path uses, so no renderer rebuild and no pinned-address move is required.
 *
 * Slot B record at flash paddr 0x240000 (64-byte header, then the package):
 *   +0  "F1SCENE1" | +8 version=1 | +12 package_bytes | +16 generation
 *   +20 expected_generation | +24 sha256[32] | +56 reserved | +60 crc32
 * Built by build-scene-slot-b.mjs.  Erased flash (0xff) fails the magic and the
 * device boots exactly as it does today.  generation is any value >= 2 with
 * expected_generation == generation - 1, so a record this module itself wrote
 * for a later host push is adopted by exactly the same path as the shipped
 * generation-2 default.
 *
 * The mapped window is data-only (MMU_MEM_CAP_READ|8BIT) and is unmapped again
 * before the package is published, so nothing the renderer retains points into
 * flash: the bytes are copied into a PSRAM buffer with the same lifetime and
 * the same address class as the scene-RPC store the live push borrows.
 *
 * After a successful adopt two more things happen, both required for the host
 * to be able to replace the adopted scene (evidence in the block comment above
 * scene_rpc_state_find and scene_rearm_switch):
 *
 *   1. the scene-RPC core's committed_generation is advanced to the adopted
 *      generation, exactly as renderer_scene_rpc_core_commit does
 *      (renderer-v1-scene-rpc-core.c:476), so widget.scene.begin accepts
 *      expected=N / generation=N+1 and renderer_v1_stage_bundle's
 *      "generation <= active_generation" gate passes;
 *   2. the renderer-v2 sidecar's switch_state is returned to EMPTY once the
 *      adopted package has actually gone ACTIVE, because
 *      renderer_v2_native_prepare only CASes from EMPTY and nothing in the
 *      frozen app ever returns it there.
 *
 * SCENE_FLAG_V2_STORE_LATCH is deliberately NOT set: the latch exists only to
 * stop a second transaction from overwriting state->store while renderer-v1
 * has borrowed it (renderer-v1-scene-rpc-core.c:469-471), and boot adopt lends
 * the renderer this module's own PSRAM buffer instead.  state->store is free,
 * so the next live push may use it.  A live push does set the latch, so at most
 * one host push per boot still holds - that is stock behaviour, unchanged. */
#define SCENE_SLOT_B_PADDR 0x00240000u
#define SCENE_SLOT_B_BYTES 0x00030000u
#define SCENE_RECORD_HEADER_BYTES 64u
#define SCENE_RECORD_SHA_OFFSET 24u
#define SCENE_RECORD_VERSION 1u
#define SCENE_RECORD_MAGIC_0 0x43533146u /* "F1SC" */
#define SCENE_RECORD_MAGIC_1 0x31454e45u /* "ENE1" */
#define SCENE_PACKAGE_BYTES 95535u
#define SCENE_FOCUS_F1WB_BYTES 62404u
#define SCENE_F1WB_MAGIC 0x42573146u /* "F1WB" */
/* The shipped default record.  Any generation >= SCENE_MIN_GENERATION is
 * adoptable; these two only pin what build-scene-slot-b.mjs emits today and
 * are what the host proof cross-checks the builder against. */
#define SCENE_GENERATION 2u
#define SCENE_EXPECTED_GENERATION 1u
#define SCENE_MIN_GENERATION 2u
#define SCENE_DATA_WINDOW_BEGIN 0x3c000000u
#define SCENE_DATA_WINDOW_END 0x40000000u
#define MMU_TARGET_FLASH0 1u
#define MMU_MEM_CAP_READ 2u
#define MMU_MEM_CAP_8BIT 16u

/* reserved_flags[0] */
#define SCENE_ADOPT_NOT_ATTEMPTED 0u
#define SCENE_ADOPT_OK 1u
#define SCENE_ADOPT_SLOT_INVALID 2u
#define SCENE_ADOPT_NO_STORE 3u
#define SCENE_ADOPT_GATE_REJECTED 4u
/* reserved_flags[1]: step detail; bit 7 = esp_mmu_unmap reported an error. */
#define SCENE_STEP_NONE 0u
#define SCENE_STEP_NO_SIDECAR 1u
#define SCENE_STEP_MAP_FAILED 2u
#define SCENE_STEP_MAP_RANGE 3u
#define SCENE_STEP_MAGIC 4u
#define SCENE_STEP_VERSION 5u
#define SCENE_STEP_SIZE 6u
#define SCENE_STEP_GENERATION 7u
#define SCENE_STEP_HEADER_CRC 8u
#define SCENE_STEP_PAYLOAD_SHA 9u
#define SCENE_STEP_BUFFER 10u
#define SCENE_STEP_PREPARE_STORE 11u
#define SCENE_STEP_V2_PREPARE 12u
#define SCENE_STEP_STAGE 13u
#define SCENE_STEP_V2_COMMIT 14u
#define SCENE_STEP_F1WB 15u
#define SCENE_STEP_MAP_RESERVE 16u
#define SCENE_STEP_NO_RPC_STATE 17u
#define SCENE_STEP_UNMAP_FAILED 0x80u

/* --- persist-on-commit ----------------------------------------------------
 *
 * scene_persist_status packs, in one aligned word that widget.mquickjs.diag6
 * reports: state | step<<8 | rearm<<16 | attempts<<24.
 *
 * state:  0 idle, 1 armed (a new committed generation is settling), 2 erasing,
 *         3 writing payload, 4 verifying payload, 5 writing header, 6 done,
 *         7 failed (step names where).
 * rearm:  0 not attempted, 1 waiting for the adopted package to go ACTIVE,
 *         2 switch_state returned to EMPTY, 3 no sidecar/controller. */
#define SCENE_PERSIST_IDLE 0u
#define SCENE_PERSIST_ARMED 1u
#define SCENE_PERSIST_ERASE 2u
#define SCENE_PERSIST_WRITE 3u
#define SCENE_PERSIST_VERIFY 4u
#define SCENE_PERSIST_HEADER 5u
#define SCENE_PERSIST_DONE 6u
#define SCENE_PERSIST_FAILED 7u

#define SCENE_PSTEP_NONE 0u
#define SCENE_PSTEP_BOUNDS 1u
#define SCENE_PSTEP_ERASE 2u
#define SCENE_PSTEP_WRITE 3u
#define SCENE_PSTEP_READBACK 4u
#define SCENE_PSTEP_MISMATCH 5u
#define SCENE_PSTEP_MOVED 6u
#define SCENE_PSTEP_HEADER_WRITE 7u
#define SCENE_PSTEP_HEADER_READBACK 8u
#define SCENE_PSTEP_HEADER_MISMATCH 9u
#define SCENE_PSTEP_STORE 10u
#define SCENE_PSTEP_GUARD 11u

#define SCENE_REARM_NOT_ATTEMPTED 0u
#define SCENE_REARM_WAITING 1u
#define SCENE_REARM_DONE 2u
#define SCENE_REARM_NO_SIDECAR 3u

/* Hard-coded slot-B bounds.  Every erase and every write is range-checked
 * against these literals; nothing in the checked expressions is ever derived
 * from flash, RPC or renderer data. */
#define SCENE_PERSIST_BEGIN 0x00240000u
#define SCENE_PERSIST_END 0x00270000u
#define SCENE_PERSIST_SECTOR_BYTES 4096u
#define SCENE_PERSIST_SECTORS 24u
#define SCENE_PERSIST_CHUNK_BYTES 1024u
#define SCENE_PERSIST_VERIFY_BYTES 512u
#define SCENE_PERSIST_SETTLE_MS 500u
_Static_assert(SCENE_RECORD_HEADER_BYTES + SCENE_PACKAGE_BYTES <=
                   SCENE_PERSIST_SECTORS * SCENE_PERSIST_SECTOR_BYTES &&
               SCENE_PERSIST_SECTORS * SCENE_PERSIST_SECTOR_BYTES <=
                   SCENE_PERSIST_END - SCENE_PERSIST_BEGIN &&
               SCENE_PERSIST_BEGIN == SCENE_SLOT_B_PADDR &&
               SCENE_PERSIST_END == SCENE_SLOT_B_PADDR + SCENE_SLOT_B_BYTES,
               "slot-B persist window does not cover the record");
/* ESP-IDF v5.3.2 esp_mmu_map allocates dummy head/tail blocks from the
 * internal heap before the real one, and its first-map error path leaves the
 * private list inconsistent (experiments/mquickjs-esp32s3-module-loader/
 * README.md).  The resident loader already reserves this much for its own two
 * maps; require it again before adding a third, and never retry after a
 * failure. */
#define SCENE_MAP_RESERVE_BYTES 4096u

typedef void *(*pointer_no_args_fn)(void);
typedef void *(*pointer_one_arg_fn)(void *);
typedef size_t (*heap_size_fn)(uint32_t);
typedef void *(*heap_allocate_fn)(size_t, uint32_t);
typedef void (*heap_free_fn)(void *);
typedef void *(*task_create_fn)(void (*)(void *), const char *, uint32_t,
                                void *, uint32_t, uint8_t *, void *, int32_t);
typedef void (*task_delay_fn)(uint32_t);
typedef uint32_t (*stack_water_fn)(void *);
typedef void *(*current_task_fn)(int32_t);
typedef uint64_t (*time_us_fn)(void);
typedef void (*add_controller_fn)(void *, void *);
typedef void (*add_navigation_fn)(void *, uint32_t);
typedef void *(*image_create_fn)(void *);
typedef void (*image_set_source_fn)(void *, const void *);
typedef void (*object_align_fn)(void *, int32_t, int32_t, int32_t);
typedef int32_t (*fn_pressed_fn)(void *);
typedef void *(*rpc_registry_fn)(void);
typedef void (*rpc_register_fn)(void *, void *, const char *, uint32_t, void *);
typedef void (*rpc_reply_fn)(void *, void *, uint32_t, void *);
typedef void (*root_make_fn)(void *, void *);
typedef void (*root_destroy_fn)(void *);

#define STOCK_ROOT_GET ((pointer_no_args_fn)(uintptr_t)0x42004e1cu)
#define STOCK_REGISTRY_FROM_ROOT ((pointer_one_arg_fn)(uintptr_t)0x4210ad9cu)
#define STOCK_NAVIGATION_GET ((pointer_no_args_fn)(uintptr_t)0x42006888u)
#define STOCK_HEAP_FREE_SIZE ((heap_size_fn)(uintptr_t)0x420c8200u)
#define STOCK_HEAP_LARGEST ((heap_size_fn)(uintptr_t)0x420c82c4u)
#define STOCK_HEAP_MALLOC ((heap_allocate_fn)(uintptr_t)0x4037e55cu)
#define STOCK_HEAP_FREE ((heap_free_fn)(uintptr_t)0x4037e250u)
#define STOCK_TASK_CREATE ((task_create_fn)(uintptr_t)0x4038e950u)
#define STOCK_TASK_DELAY ((task_delay_fn)(uintptr_t)0x4038dc3cu)
#define STOCK_STACK_WATER ((stack_water_fn)(uintptr_t)0x4038daf4u)
#define STOCK_CURRENT_TASK ((current_task_fn)(uintptr_t)0x4038eb7cu)
#define STOCK_TIME_US ((time_us_fn)(uintptr_t)0x4037e028u)
#define STOCK_ADD_CONTROLLER ((add_controller_fn)(uintptr_t)0x4204da84u)
#define STOCK_ADD_NAVIGATION ((add_navigation_fn)(uintptr_t)0x420293a8u)
#define STOCK_IMAGE_CREATE ((image_create_fn)(uintptr_t)0x420ae8a0u)
#define STOCK_IMAGE_SET_SOURCE ((image_set_source_fn)(uintptr_t)0x420aeef0u)
#define STOCK_OBJECT_ALIGN ((object_align_fn)(uintptr_t)0x4204f0d0u)
#define STOCK_INPUT_GET ((pointer_no_args_fn)(uintptr_t)0x4200c4c0u)
#define STOCK_FN_PRESSED ((fn_pressed_fn)(uintptr_t)0x4210bfacu)
#define STOCK_RPC_REGISTRY ((rpc_registry_fn)(uintptr_t)0x42004afcu)
#define STOCK_RPC_REGISTER ((rpc_register_fn)(uintptr_t)0x4211b7c8u)
#define STOCK_RPC_REPLY ((rpc_reply_fn)(uintptr_t)0x4211ba58u)
#define STOCK_ROOT_MAKE ((root_make_fn)(uintptr_t)0x4211bac8u)
#define STOCK_ROOT_DESTROY ((root_destroy_fn)(uintptr_t)0x42004f80u)

#define STOCK_BASE_VTABLE ((void *)(uintptr_t)0x3c1acc34u)
#define STOCK_BASE_SLOT0 ((void *)(uintptr_t)0x4204d5dcu)
#define STOCK_BASE_SLOT2 ((void *)(uintptr_t)0x4204d694u)
#define STOCK_BASE_SLOT3 ((void *)(uintptr_t)0x4210882cu)
#define STOCK_BASE_SLOT5 ((void *)(uintptr_t)0x4204d6d0u)
#define STOCK_BASE_SLOT7 ((void *)(uintptr_t)0x42108834u)
#define STOCK_BASE_SLOT10 ((void *)(uintptr_t)0x42108844u)

/* Pinned entry points used only by boot_adopt_default_scene().  Every address
 * below is a symbol in the disassembly of the renderer as linked into the
 * accepted app 36317013a06f306be1e894b6f203a9bf03bf4d70d21194aaccdd1c42f760c32
 * (f1-widget-sdk/build/combined-renderer-v2-clock-blue-timer/
 * renderer-v2-disassembly.txt), or a stock IDF entry the resident loader
 * already pins (experiments/mquickjs-esp32s3-module-loader/resident_loader.ld).
 *
 *   4211ae1c <sha256>                    the digest the RPC commit path runs
 *   42119e74 <renderer_v1_prepare_store> the gate widget.scene.begin runs
 *   4211d5a4 <renderer_v2_native_prepare>
 *   42119ebc <renderer_v1_stage_bundle>
 *   4211d9b8 <renderer_v2_native_commit>
 *   4211d9f4 <renderer_v2_native_cancel>
 *   420f539c esp_mmu_map / 420f5774 esp_mmu_unmap  (resident_loader.ld:3-4)
 *
 * scene-slot-b-host-proof.mjs re-reads both files and fails if any of these
 * literals stops naming the symbol claimed here. */
typedef void (*scene_sha256_fn)(const uint8_t *, uint32_t, uint8_t *);
typedef int32_t (*scene_prepare_store_fn)(void *, const uint8_t *);
typedef int32_t (*scene_stage_bundle_fn)(void *, const uint8_t *, uint32_t);
typedef uint32_t (*scene_v2_prepare_fn)(void *, const uint8_t *, uint32_t,
                                        uint32_t);
typedef uint32_t (*scene_v2_controller_fn)(void *);
typedef int (*mmu_map_fn)(uint32_t, size_t, uint32_t, uint32_t, int, void **);
typedef int (*mmu_unmap_fn)(void *);

#define STOCK_SHA256 ((scene_sha256_fn)(uintptr_t)0x4211ae1cu)
#define STOCK_PREPARE_STORE ((scene_prepare_store_fn)(uintptr_t)0x42119e74u)
#define STOCK_STAGE_BUNDLE ((scene_stage_bundle_fn)(uintptr_t)0x42119ebcu)
#define STOCK_V2_PREPARE ((scene_v2_prepare_fn)(uintptr_t)0x4211d5a4u)
#define STOCK_V2_COMMIT ((scene_v2_controller_fn)(uintptr_t)0x4211d9b8u)
#define STOCK_V2_CANCEL ((scene_v2_controller_fn)(uintptr_t)0x4211d9f4u)
#define STOCK_MMU_MAP ((mmu_map_fn)(uintptr_t)0x420f539cu)
#define STOCK_MMU_UNMAP ((mmu_unmap_fn)(uintptr_t)0x420f5774u)

/* Stock ESP-IDF v5.3 esp_flash public API, as linked into the accepted app.
 * All three live in the app's IRAM segment (load address 0x4037d418), so the
 * routines themselves keep executing while they turn the cache off, and this
 * module's own flash-mapped code only runs before and after that window.
 *
 * Recovery (segment table of framer-0.4.1-...-blue-timer-app.bin; DROM
 * 0x3c120020, IRAM 0x40374000 + 0x4037d418, IROM 0x42000020):
 *   the DROM holds the __func__ strings "esp_flash_erase_region" (0x3c1ba9d4)
 *   and "esp_flash_write" (0x3c1ba9c4) next to the assert file string
 *   "//IDF/components/spi_flash/esp_flash_api.c" (0x3c144510).  The only
 *   l32r in the whole image that loads the literal holding
 *   "esp_flash_erase_region" is at 0x4037f28e, inside the function whose
 *   `entry a1, 64` is at 0x4037f0f0; the only one that loads
 *   "esp_flash_write" is at 0x4037f54d, inside the function whose
 *   `entry a1, 80` is at 0x4037f460.  0x4037f31c is the third function with
 *   the identical esp_flash_api.c prologue and it dispatches
 *   chip->chip_drv->read (host +64) - esp_flash_read.
 *
 * All three open with
 *   s32i a2,a1,N ; l32r a8,[0x40374bfc] ; a8=*a8 ; a8=a8[8] ; a10=a1+N ;
 *   callx8 a8
 * which is rom_spiflash_api_funcs->chip_check(&chip).  *0x40374bfc names the
 * rom_spiflash_api_funcs variable at 0x3fca8434, whose value 0x3fca8438 is the
 * table { start 0x40385e58, end 0x40385e7c, chip_check 0x4037edf0,
 * flash_end_flush_cache 0x4037eda8 }.  chip_check (0x4037edf0) substitutes
 * *(0x40374c00) = esp_flash_default_chip = 0x3fcb2ef8 when the chip argument is
 * NULL, which is why every call below passes NULL.
 *
 * Cache coherency: both mutating entries end through table[12]
 * (flash_end_flush_cache, 0x4037eda8) with a13=address and a14=length - erase
 * at 0x4037f2c4, write at 0x4037f58a - and that routine calls
 * chip->host->driver->flush_cache(host, address, length), i.e.
 * spi_flash_check_and_flush_cache over exactly the written range.  Read-back
 * therefore never needs an unmap/remap of slot B; this module uses
 * esp_flash_read for verification anyway, so it needs no mapping at all.
 *
 * Stall behaviour: esp_flash_write calls start()/end() once per page-sized
 * chunk inside its own loop (end at 0x4037f560, loop back at 0x4037f57a), so a
 * write never holds the bus for more than one page program.  esp_flash_erase
 * holds it for one whole call, which is why this module erases exactly one
 * 4 KiB sector per call with an owner-task delay between them.
 *
 * Region protection: esp_flash_erase_region and esp_flash_write both call
 * chip->os_func->region_protected(chip->os_func_data, start, len) before
 * touching the bus (erase at 0x4037f124, write at the matching site), and treat
 * ESP_ERR_NOT_ALLOWED (0x10d) as a refusal.  The app's os_func table is the
 * DRAM struct at 0x3fca84a4, whose +8 is main_flash_region_protected at
 * 0x4037f904.  That routine is
 *   if (!0x420c2af4(start,len))            return ESP_ERR_NOT_ALLOWED;
 *   if (*(u8 *)(os_func_data + 4) != 0)    return ESP_OK;
 *   if (!0x420c2b44(start,len))            return ESP_ERR_NOT_ALLOWED;
 *   return ESP_OK;
 * 0x420c2af4 walks the partition list and rejects only ranges that overlap a
 * partition whose read-only byte (+42) is set; the F1 table sets flags=0 on
 * every entry.  0x420c2b44 is esp_partition_main_flash_region_safe: it rejects
 * anything at or below *(0x420bdbd0) = 0x8c00, and anything inside the first
 * APP partition - which for this device is factory @0x10000 +0x800000, so slot
 * B at 0x240000 is inside it and would always be refused.
 *
 * The byte at os_func_data+4 is app_func_arg_t::no_protect, the documented
 * ESP-IDF escape (esp_flash_app_disable_protect).  This module raises it for
 * the duration of one stock call and restores the previous value immediately
 * afterwards, and only after scene_flash_span_allowed has already pinned the
 * address inside [0x240000,0x270000) with hard-coded literals.  The chip is
 * identity-checked first: chip->os_func must be exactly 0x3fca84a4 and its
 * region_protected slot exactly 0x4037f904, so on any other firmware the
 * persist machine fails closed instead of writing anything.
 */
#define STOCK_FLASH_DEFAULT_CHIP_SLOT 0x3fcb2ef8u
#define STOCK_FLASH_APP_OS_FUNC 0x3fca84a4u
#define STOCK_FLASH_REGION_PROTECTED 0x4037f904u
#define ESP_FLASH_CHIP_OS_FUNC 8u
#define ESP_FLASH_CHIP_OS_FUNC_DATA 12u
#define ESP_FLASH_OS_FUNC_REGION_PROTECTED 8u
#define ESP_FLASH_ARG_NO_PROTECT 4u

typedef int (*flash_erase_fn)(void *chip, uint32_t start, uint32_t bytes);
typedef int (*flash_write_fn)(void *chip, const void *buffer, uint32_t address,
                              uint32_t bytes);
typedef int (*flash_read_fn)(void *chip, void *buffer, uint32_t address,
                             uint32_t bytes);
#define STOCK_FLASH_ERASE ((flash_erase_fn)(uintptr_t)0x4037f0f0u)
#define STOCK_FLASH_WRITE ((flash_write_fn)(uintptr_t)0x4037f460u)
#define STOCK_FLASH_READ ((flash_read_fn)(uintptr_t)0x4037f31cu)

/* --- scene-RPC core state, reached through the stock RPC registry ---------
 *
 * renderer_scene_rpc_register (0x4211b7f4) allocates the 98,624-byte
 * RendererSceneRpcState with operator new, stores the ID26 controller in its
 * first word (s32i a7,a6,0 at 0x4211b81c) and registers six stock RPC methods
 * whose callback context is that state pointer.  The stock registrar
 * (0x420540f4, reached through renderer_scene_rpc_register_one 0x4211b7c8)
 * inserts into an unordered_map at registry+132: it calls the map helper at
 * 0x42053f78 with a10 = registry + 132 (0x4205416e, `addi a10,a1,132` folded
 * into `movi a10,132; add a10,a2,a10`), and that helper returns node + 28
 * (`addi a2,a2,28` at 0x42053fa6) as the address of the mapped std::function.
 * The map's own find (0x420541d8) walks the same nodes: hashtable+8 is
 * _M_before_begin._M_nxt, hashtable+12 is the element count, node+0 is _M_nxt,
 * node+4 is the key's char pointer and node+8 its length (0x420541e2..0x42054206).
 * A std::function is four words - functor lo/hi, manager, invoker - and the
 * registrar writes the context into functor word 0 (`s32i.n a3,a1,16` at
 * 0x4211b7cd, swapped into node+28 at 0x4205419f).
 *
 * So: walk registry+132's node list, match the 19-byte key
 * "widget.scene.commit", and node+28 is the RendererSceneRpcState.  Its own
 * first word must be the controller this module was handed, which is an
 * independent confirmation that the right object was found.
 *
 * Field offsets are the ones the linked core uses
 * (f1-widget-sdk/examples/renderer-id26/on-device/renderer-v1-scene-rpc-core.c
 * :64-80, asserted there by scene_state_store_offset_must_be_320 and
 * scene_state_size_must_be_98624). */
#define SCENE_RPC_MAP_OFFSET 132u
#define SCENE_RPC_NODE_NEXT 0u
#define SCENE_RPC_NODE_KEY_POINTER 4u
#define SCENE_RPC_NODE_KEY_BYTES 8u
#define SCENE_RPC_NODE_VALUE 28u
#define SCENE_RPC_NODE_MIN_BYTES 44u
#define SCENE_RPC_WALK_LIMIT 256u
#define SCENE_RPC_COMMIT_METHOD_BYTES 19u
#define SCENE_STATE_BYTES 98624u
#define SCENE_STATE_FLAGS 4u
#define SCENE_STATE_COMMITTED_GENERATION 8u
#define SCENE_STATE_TOTAL_BYTES 16u
#define SCENE_STATE_STORE 320u
#define SCENE_FLAG_ACTIVE 1u
#define SCENE_FLAG_V2_STORE_LATCH 2u

/* renderer_v2_native_commit (0x4211d9b8) CASes sidecar+0x4f8 from
 * RV2_SWITCH_PREPARED(2) to RV2_SWITCH_COMMITTED(3) - `movi a8,0x4f8;
 * add a10,a10,a8; movi a9,2; movi a8,3; wsr.scompare1 a9; s32c1i a8,a10,0` -
 * and renderer_v2_native_cancel (0x4211d9f4) uses the identical 0x4f8 literal
 * at 0x4211da05.  renderer_v2_native_prepare only ever CASes that word from
 * RV2_SWITCH_EMPTY(0), and rv2_switch_pending_identity leaves it at
 * RV2_SWITCH_ACTIVE(4) forever (renderer-v2-native-source.c:832). */
#define SCENE_SIDECAR_SWITCH_OFFSET 0x4f8u
#define SCENE_SWITCH_EMPTY 0u
#define SCENE_SWITCH_ACTIVE 4u

extern const uint8_t framer_physical_weather_f2js_start[];
extern const uint8_t framer_physical_weather_f2js_end[];
extern const uint8_t framer_physical_weather_f2tf_start[];
extern const uint8_t framer_physical_weather_f2tf_end[];
extern const uint8_t framer_physical_weather_base_lzss_start[];
extern const uint8_t framer_physical_weather_base_lzss_end[];
extern const uint8_t framer_physical_weather_f2js_sha256[];
extern const uint8_t framer_physical_target_contract_sha256[];
extern int framer_physical_rpc_read_string(void *root, const char *key,
                                           uint32_t key_bytes,
                                           const char **pointer,
                                           uint32_t *length);
extern int framer_physical_rpc_read_integer(void *root, const char *key,
                                             uint32_t key_bytes,
                                             int32_t *value);

typedef struct physical_block physical_block;

typedef struct {
    uint32_t header;
    uint32_t dimensions;
    uint32_t stride;
    uint32_t bytes;
    uint32_t data;
    uint32_t reserved;
} physical_image_descriptor;

typedef struct {
    void *vptr;
    uint32_t common_04;
    uint32_t common_08;
    void *root;
    uint32_t common_16;
    void *registry;
    uint8_t common_24[4];
    void *backend;
    physical_block *block;
    void *image;
    physical_image_descriptor descriptor[2];
    void *local_vtable[11];
    uint32_t source_published;
    uint32_t descriptor_flip;
    uint32_t magic;
    /* Which widget slot this screen presents (screen id = 28 + screen_slot).
     * Appended AFTER every stock-read field so the pinned offsets hold. */
    uint32_t screen_slot;
} physical_proxy;

/* --- widget upload / boot adopt --------------------------------------------
 *
 * The pushed-widget path.  All heavy validation lives in the host-proven units
 * under experiments/mquickjs-widget-upload (admission, upload transaction,
 * bounded NOR persist, adopt decision) - this file only wires tasks, PSRAM and
 * the guarded stock flash seams to them.  The upload STAGING arena and the
 * boot-adopted COPY are distinct PSRAM allocations, so an in-flight upload can
 * never touch the bytes the running widget renders from. */
typedef struct {
    const uint8_t *f2js; uint32_t f2js_bytes;
    const uint8_t *f2tf; uint32_t f2tf_bytes;
    const uint8_t *lzss; uint32_t lzss_bytes;
    const uint8_t *f2js_sha256; /* 32 bytes, same lifetime as the sections */
    uint32_t generation;
    uint32_t source;            /* 0 baked, 1 flash slot */
    int32_t adopt_detail;       /* framer_f2up_result observed at boot */
} physical_widget_assets;

struct __attribute__((aligned(16))) physical_block {
    uint32_t magic;
    uint32_t generation;
    volatile uint32_t visible;
    volatile uint32_t sources_enabled;
    volatile uint32_t input_enabled;
    volatile uint32_t input_sink_inflight;
    volatile uint32_t focus_release_requested;
    volatile uint32_t focus_release_draining;
    volatile uint32_t focus_release_applied;
    volatile uint32_t focus_reopen_pending;
    volatile uint32_t poll_armed;
    volatile uint32_t poll_due_ms;
    volatile uint32_t boot_state;
    volatile uint32_t navigation_published;
    volatile uint32_t rpc_ready;
    volatile uint32_t rpc_event_pending;
    volatile uint32_t rpc_event_armed;
    volatile uint32_t completion_publish_pending;
    volatile uint32_t fatal_sources_retired;
    uint32_t rpc_event_sequence;
    volatile uint32_t runtime_last_completion_sequence;
    volatile int32_t runtime_last_completion_result;
    uint32_t owner_delays;
    uint32_t owner_max_slice_us;
    volatile uint32_t ui_max_tick_us;
    volatile uint32_t ui_applied_revision;
    volatile uint32_t ui_render_failures;
    uint32_t last_telemetry_ms;
    uint32_t boot_started_ms;
    uint32_t boot_finished_ms;
    uint32_t last_tick100;
    uint32_t last_second;
    uint32_t hidden_at_ms;
    uint32_t last_raw_token;
    uint32_t last_raw_level;
    uint32_t observed_space_edges;
    uint32_t observed_shift_edges;
    void *task_handle;
    void *backend;
    void *registry;
    void *navigation;
    physical_proxy *proxy;
    /* One proxy (= one keyboard screen) per widget slot: ONE WIDGET = ONE
     * SCREEN.  Each renders ITS OWN slot's assets, so screens never show one
     * another's pixels (the defect every shared-asset attempt produced). */
    physical_proxy proxy_storage[FRAMER_F2UP_SLOT_COUNT];
    framer_runtime_rpc_context rpc[FRAMER_RUNTIME_RPC_CONTEXT_COUNT];
    framer_runtime_receipt receipt;
    framer_runtime_receipt_snapshot pending_receipt;
    framer_runtime_receipt_snapshot completion_receipt;
    framer_runtime_receipt_snapshot rpc_event_scratch;
    int32_t rpc_event_values[5];
    framer_runtime_capability runtime_capability;
    volatile uint32_t runtime_telemetry_sequence;
    volatile uint32_t runtime_telemetry_lock;
    framer_runtime_telemetry runtime_telemetry;
    framer_physical_telemetry_session telemetry_session;
    framer_runtime_key_probe key_probe;
    /* ANY-KEY input: the exact-token allowlist is gone.  The stream is
     * proven once ONE full down+up cycle of the same token is observed live
     * (the discovery property the old Space/LeftShift probe enforced,
     * without requiring specific keys the user's layout may not have).
     * After proof, EVERY native token forwards; the ENGINE then admits only
     * the tokens the running widget's package declared (key_for_native_token
     * returns no-handler for the rest), so a widget still sees exactly the
     * keys it asked for and nothing else. */
    volatile uint32_t key_stream_proven;
    volatile uint32_t key_cycle_down_token;
    volatile uint32_t key_cycle_down_seen;
    /* Module-computed WPM from the raw key hook (counted BEFORE the focus
     * gate, so it reflects the user's typing on EVERY screen): per-second
     * down-edge buckets over a 60 s window, advanced by the owner loop. */
    volatile uint8_t wpm_counts[60];
    volatile uint32_t wpm_ring_second;
    volatile uint32_t wpm_value;
    volatile uint32_t wpm_keys_60s;
    framer_runtime_visibility visibility;
    uint32_t runtime_events_queued;
    uint32_t runtime_events_applied;
    uint32_t runtime_events_rejected;
    framer_tf_context target;
    framer_tf_metrics target_metrics;
    uint8_t target_admitted;
    uint8_t heap_claimed;
    uint8_t reserved_flags[2];
    /* Boot-scene persistence.  scene_state is the RendererSceneRpcState found
     * once, on the setup task, through the stock RPC registry; the rest is the
     * owner-task persist state machine and the words widget.mquickjs.diag6
     * reports.  All aligned 32-bit, all read by the diagnostic loader with
     * aligned loads only. */
    uint8_t *scene_state;
    volatile uint32_t scene_persist_status;
    volatile uint32_t scene_persist_generation;
    volatile uint32_t scene_persist_observed;
    uint32_t scene_persist_pending;
    uint32_t scene_persist_cursor;
    uint32_t scene_persist_since_ms;
    /* Pushed-widget upload + persist + adopt.  widget_assets is written once,
     * on the setup task, before the owner task or the ID28 proxy exist, and is
     * immutable afterwards.  The persist words follow the scene machine's
     * atomic packing discipline (state | step<<8). */
    physical_widget_assets widget_assets;
    uint8_t widget_f2js_sha[32];
    framer_f2up_upload widget_upload;
    uint8_t *widget_staging;
    void *widget_staging_raw;
    volatile uint32_t widget_persist_status;
    volatile uint32_t widget_persisted_generation;
    uint32_t widget_persist_cursor;
    uint32_t widget_persist_since_ms;
    uint32_t widget_persist_total;
    uint32_t widget_persist_pending_generation;
    /* 0, or the boot stage (5 lzss / 6 facade / 3 f2js) at which an adopted
     * widget failed and the baked fallback took over. */
    uint32_t widget_boot_fallback;
    /* RPC-task scratch for one decoded chunk: the tail of the PSRAM staging
     * arena (staging + FRAMER_F2UP_MAX_BYTES), so the internal-RAM block does
     * not grow by a chunk. */
    uint8_t *widget_chunk_scratch;
    /* Multi-widget slot bank (docs/17).  Scanned once at setup and updated by
     * persist completions; read by the inventory/activate RPC ops. */
    uint32_t widget_slot_generations[FRAMER_F2UP_SLOT_COUNT];
    uint8_t widget_slot_sha16[FRAMER_F2UP_SLOT_COUNT][16];
    uint32_t widget_active_slot;
    uint32_t widget_session_slot;   /* slot bound by upload op 1 */
    uint32_t widget_persist_base;   /* armed persist target base */
    uint8_t *widget_arena;          /* legacy single arena (unused once resident) */
    void *widget_arena_raw;
    /* Per-slot RESIDENT assets: each occupied slot owns a PSRAM arena holding
     * its container, its own f2js sha, its own facade context and admit flag.
     * Internal-RAM cost is tiny (~60 B context + ~44 B assets per slot); the
     * 98 KiB arenas live in PSRAM, which is not the scarce resource. */
    physical_widget_assets slot_assets[FRAMER_F2UP_SLOT_COUNT];
    void *slot_arena_raw[FRAMER_F2UP_SLOT_COUNT];
    uint8_t slot_sha[FRAMER_F2UP_SLOT_COUNT][32];
    framer_tf_context slot_target[FRAMER_F2UP_SLOT_COUNT];
    uint8_t slot_target_admitted[FRAMER_F2UP_SLOT_COUNT];
    uint8_t slot_resident[FRAMER_F2UP_SLOT_COUNT];
    /* Edge-detect for screen changes: the tick pins the desired slot only when
     * the VISIBLE screen actually changes, so a steady-state visible screen
     * cannot veto an RPC activation (the "Activate did nothing" defect). */
    volatile uint32_t visible_screen_slot;
    /* Timestamp of the most recent proxy_tick.  docs/18 §4.2: the TICK is the
     * only visibility signal — build/cleanup fire for NEIGHBOR pre-builds, so
     * with several adjacent widget screens a neighbor's cleanup would zero
     * `visible` while another widget screen is fronted, closing the owner's
     * tick gate (VM never publishes → every dynamic field renders 0).  Show
     * fires on the first tick after silence; hide fires on the owner task when
     * no proxy has ticked for FRAMER_PHYSICAL_HIDE_SILENCE_MS. */
    volatile uint32_t visible_tick_ms;
    /* The slot the display SHOULD show: written by op 6 and by every
     * proxy_build (fronting a screen), consumed level-triggered by the owner
     * loop - the last fronted screen always wins, rapid rotation converges. */
    volatile uint32_t widget_desired_slot;
    /* Stock-lifecycle forensics: how often each screen proxy's build /
     * cleanup / tick callbacks actually fire (upload op 7 reads them). */
    volatile uint32_t proxy_build_counts[FRAMER_F2UP_SLOT_COUNT];
    volatile uint32_t proxy_cleanup_counts[FRAMER_F2UP_SLOT_COUNT];
    volatile uint32_t proxy_tick_counts[FRAMER_F2UP_SLOT_COUNT];
    volatile uint32_t widget_switching;        /* proxy render gate */
    framer_resident_platform owner_platform;   /* for reinit on activation */
    /* The MicroQuickJS heap is no longer resident in this internal-RAM block.
     * vm_heap is the 16-byte-aligned PSRAM view handed to the engine (and used
     * as bounded LZSS/F2TF scratch before the engine claims it); vm_heap_raw is
     * the exact heap_caps_malloc result kept for the matching free.  Both live
     * in the alignment padding that precedes static_task, so removing the
     * 65,536-byte array is the only size change to this block. */
    uint8_t *vm_heap;
    void *vm_heap_raw;
    __attribute__((aligned(16))) uint8_t static_task[352];
    framer_resident_owner owner;
};

_Static_assert(sizeof(void *) == 4u, "physical module is ESP32-S3-only");
/* 148 = the frozen 144-byte stock-facing layout + the appended screen_slot
 * word (multi-screen, docs/17 Phase B).  Every stock-read offset is pinned
 * separately below and unchanged. */
_Static_assert(sizeof(physical_proxy) == 148u, "ID28 proxy layout changed");
_Static_assert(offsetof(physical_proxy, root) ==
                   FRAMER_PHYSICAL_PROXY_ROOT_OFFSET &&
               offsetof(physical_proxy, registry) ==
                   FRAMER_PHYSICAL_PROXY_REGISTRY_OFFSET &&
               offsetof(physical_proxy, backend) == 28u &&
               offsetof(physical_proxy, block) == 32u &&
               offsetof(physical_proxy, image) == 36u &&
               offsetof(physical_proxy, local_vtable) == 88u,
               "ID28 common controller offsets changed");
_Static_assert((offsetof(physical_block, static_task) & 15u) == 0u,
               "physical owned buffers lost 16-byte alignment");
/* The engine heap is an out-of-block PSRAM allocation now.  Keep the two facts
 * the rest of this file depends on pinned: the block records it as a pointer,
 * and the engine's fixed heap size is still the 64 KiB the package declares. */
_Static_assert(sizeof(((physical_block *)0)->vm_heap) == sizeof(void *) &&
               sizeof(((physical_block *)0)->vm_heap_raw) == sizeof(void *) &&
               FRAMER_F2JS_HEAP_BYTES == 65536u &&
               FRAMER_F2JS_HEAP_BYTES > PHYSICAL_FRAME_BYTES,
               "PSRAM VM heap contract changed");
/* The mapped PSRAM window must stay strictly below the module's own rodata
 * page (module.ld places .rodata at 0x3c3f0000).  MicroQuickJS classifies ROM
 * pointers as "outside [ctx, ctx->stack_top)" (vendor/mquickjs/mquickjs_priv.h
 * JS_IS_ROM_PTR), so a VM heap that could ever overlap the stdlib table would
 * silently reclassify ROM values.  This assert makes the overlap impossible. */
_Static_assert(PHYSICAL_PSRAM_END <= 0x3c3f0000u &&
               PHYSICAL_PSRAM_BEGIN < PHYSICAL_PSRAM_END,
               "PSRAM window may overlap the module rodata page");

static int in_internal(const void *pointer, size_t bytes)
{
    uintptr_t start = (uintptr_t)pointer;
    uintptr_t end = start + bytes;
    return start >= PHYSICAL_INTERNAL_BEGIN && end >= start &&
           end <= PHYSICAL_INTERNAL_END;
}

static int in_psram(const void *pointer, size_t bytes)
{
    uintptr_t start = (uintptr_t)pointer;
    uintptr_t end = start + bytes;
    return start >= PHYSICAL_PSRAM_BEGIN && end >= start &&
           end <= PHYSICAL_PSRAM_END;
}

static int in_stock_data(const void *pointer, size_t bytes)
{
    uintptr_t start = (uintptr_t)pointer;
    uintptr_t end = start + bytes;
    if (end < start)
        return 0;
    return (start >= 0x3c1d0000u && end <= 0x3c3d0000u) ||
           (start >= PHYSICAL_INTERNAL_BEGIN && end <= PHYSICAL_INTERNAL_END);
}

static void zero_bytes(void *value, size_t bytes)
{
    uint8_t *output = (uint8_t *)value;
    while (bytes-- != 0u)
        *output++ = 0u;
}

static void copy_text(char *destination, size_t capacity, const char *source)
{
    size_t index = 0u;
    if (destination == (char *)0 || capacity == 0u)
        return;
    while (index + 1u < capacity && source != (const char *)0 &&
           source[index] != 0) {
        destination[index] = source[index];
        ++index;
    }
    destination[index] = 0;
}

static void digest_hex(char output[65], const uint8_t digest[32])
{
    static const char digits[] = "0123456789abcdef";
    uint32_t index;
    for (index = 0u; index < 32u; ++index) {
        output[index * 2u] = digits[digest[index] >> 4u];
        output[index * 2u + 1u] = digits[digest[index] & 15u];
    }
    output[64] = 0;
}

static uint32_t now_ms(void)
{
    return (uint32_t)(STOCK_TIME_US() / 1000u);
}

static int32_t current_core(void)
{
    uint32_t processor;
    __asm__ volatile("rsr.prid %0" : "=a"(processor));
    return (int32_t)((processor >> 13u) & 1u);
}

static uintptr_t current_task_token(void)
{
    return (uintptr_t)STOCK_CURRENT_TASK(current_core());
}

static int32_t signed_delta(uint32_t raw)
{
    return (int32_t)(int8_t)(uint8_t)raw;
}

static int decode_lzss(uint8_t *destination, uint32_t destination_bytes,
                       const uint8_t *source, uint32_t source_bytes)
{
    uint32_t input = 0u;
    uint32_t output = 0u;
    if (destination == (uint8_t *)0 || source == (const uint8_t *)0)
        return 0;
    while (output < destination_bytes) {
        uint32_t flags;
        uint32_t bit;
        if (input >= source_bytes)
            return 0;
        flags = source[input++];
        for (bit = 1u; bit <= 0x80u && output < destination_bytes; bit <<= 1u) {
            if ((flags & bit) == 0u) {
                if (input >= source_bytes)
                    return 0;
                destination[output++] = source[input++];
            } else {
                uint32_t code;
                uint32_t distance;
                uint32_t length;
                uint32_t index;
                if (source_bytes - input < 2u)
                    return 0;
                code = (uint32_t)source[input] |
                       ((uint32_t)source[input + 1u] << 8u);
                input += 2u;
                distance = (code & 1023u) + 1u;
                length = (code >> 10u) + 3u;
                if (distance > output || length > destination_bytes - output)
                    return 0;
                for (index = 0u; index < length; ++index) {
                    destination[output] = destination[output - distance];
                    ++output;
                }
            }
        }
    }
    return input == source_bytes;
}

/* Claim the 64 KiB MicroQuickJS heap from PSRAM.  Called once, at the very top
 * of the dedicated owner task, before any scratch use: the LZSS/F2TF admission
 * step borrows this buffer exactly as the in-block array used to, and
 * platform_allocate clears it again before MicroQuickJS observes the heap.
 * Every failure path leaves the block heap-less and frees nothing it did not
 * allocate, so a rejected allocation can never be handed to the engine. */
static int psram_heap_acquire(physical_block *block)
{
    const uint32_t caps = PHYSICAL_CAP_SPIRAM | PHYSICAL_CAP_8BIT;
    const size_t request = (size_t)FRAMER_F2JS_HEAP_BYTES +
                           (size_t)PHYSICAL_HEAP_ALIGN_SLACK;
    void *raw;
    uintptr_t aligned;
    if (block == (physical_block *)0 || block->vm_heap != (uint8_t *)0 ||
        block->vm_heap_raw != (void *)0 || block->heap_claimed != 0u)
        return 0;
    if (STOCK_HEAP_FREE_SIZE(caps) < request ||
        STOCK_HEAP_LARGEST(caps) < request)
        return 0;
    raw = STOCK_HEAP_MALLOC(request, caps);
    if (raw == (void *)0)
        return 0;
    aligned = ((uintptr_t)raw + 15u) & ~(uintptr_t)15u;
    if (aligned < (uintptr_t)raw ||
        aligned - (uintptr_t)raw > (uintptr_t)PHYSICAL_HEAP_ALIGN_SLACK ||
        !in_psram(raw, request) ||
        !in_psram((const void *)aligned, (size_t)FRAMER_F2JS_HEAP_BYTES)) {
        STOCK_HEAP_FREE(raw);
        return 0;
    }
    zero_bytes((void *)aligned, (size_t)FRAMER_F2JS_HEAP_BYTES);
    block->vm_heap_raw = raw;
    block->vm_heap = (uint8_t *)aligned;
    return 1;
}

static void *platform_allocate(void *opaque, size_t bytes)
{
    physical_block *block = (physical_block *)opaque;
    if (block == (physical_block *)0 ||
        bytes != (size_t)FRAMER_F2JS_HEAP_BYTES ||
        block->heap_claimed != 0u || block->vm_heap == (uint8_t *)0 ||
        ((uintptr_t)block->vm_heap & 15u) != 0u ||
        !in_psram(block->vm_heap, (size_t)FRAMER_F2JS_HEAP_BYTES))
        return (void *)0;
    block->heap_claimed = 1u;
    zero_bytes(block->vm_heap, (size_t)FRAMER_F2JS_HEAP_BYTES);
    return block->vm_heap;
}

static void platform_free(void *opaque, void *allocation)
{
    physical_block *block = (physical_block *)opaque;
    void *raw;
    if (block == (physical_block *)0 || block->vm_heap == (uint8_t *)0 ||
        allocation != (void *)block->vm_heap)
        return;
    zero_bytes(block->vm_heap, (size_t)FRAMER_F2JS_HEAP_BYTES);
    block->heap_claimed = 0u;
    raw = block->vm_heap_raw;
    block->vm_heap = (uint8_t *)0;
    block->vm_heap_raw = (void *)0;
    if (raw != (void *)0)
        STOCK_HEAP_FREE(raw);
}

static uint64_t platform_now_us(void *opaque)
{
    (void)opaque;
    return STOCK_TIME_US();
}

static uint32_t platform_now_ms(void *opaque)
{
    (void)opaque;
    return now_ms();
}

static uintptr_t platform_thread(void *opaque)
{
    (void)opaque;
    return current_task_token();
}

static void platform_reschedule(void *opaque)
{
    (void)opaque;
    /* The dedicated owner delays exactly one RTOS tick after every bounded
     * step, so the next scheduler tick is the wakeup mechanism. */
}

static int platform_activate_events(void *opaque,
                                    struct framer_resident_owner *owner,
                                    uint32_t generation)
{
    physical_block *block = (physical_block *)opaque;
    (void)owner;
    if (block == (physical_block *)0 ||
        generation != block->widget_assets.generation)
        return 0;
    __atomic_store_n(&block->sources_enabled, 1u, __ATOMIC_RELEASE);
    return 1;
}

static int platform_remove_events(void *opaque, uint32_t generation)
{
    physical_block *block = (physical_block *)opaque;
    if (block == (physical_block *)0 ||
        generation != block->widget_assets.generation)
        return 0;
    __atomic_store_n(&block->sources_enabled, 0u, __ATOMIC_RELEASE);
    return 1;
}

static int platform_activate_input(void *opaque,
                                   struct framer_resident_owner *owner,
                                   uint32_t generation)
{
    physical_block *block = (physical_block *)opaque;
    (void)owner;
    if (block == (physical_block *)0 ||
        generation != block->widget_assets.generation)
        return 0;
    __atomic_store_n(&block->input_enabled, 1u, __ATOMIC_RELEASE);
    return 1;
}

static int platform_remove_input(void *opaque, uint32_t generation)
{
    physical_block *block = (physical_block *)opaque;
    if (block == (physical_block *)0 ||
        generation != block->widget_assets.generation)
        return 0;
    __atomic_store_n(&block->input_enabled, 0u, __ATOMIC_RELEASE);
    return 1;
}

static int platform_cancel_poll(void *opaque, uint32_t generation)
{
    physical_block *block = (physical_block *)opaque;
    if (block == (physical_block *)0 ||
        generation != block->widget_assets.generation)
        return 0;
    __atomic_store_n(&block->poll_armed, 0u, __ATOMIC_RELEASE);
    return 1;
}

static int platform_schedule_poll(void *opaque, uint32_t generation,
                                  uint32_t delay_ms)
{
    physical_block *block = (physical_block *)opaque;
    if (block == (physical_block *)0 ||
        generation != block->widget_assets.generation || delay_ms == 0u)
        return 0;
    __atomic_store_n(&block->poll_due_ms, now_ms() + delay_ms,
                     __ATOMIC_RELAXED);
    __atomic_store_n(&block->poll_armed, 1u, __ATOMIC_RELEASE);
    return 1;
}

static uint32_t platform_stack_water(void *opaque)
{
    physical_block *block = (physical_block *)opaque;
    void *task_handle;
    uint32_t raw;
    if (block == (physical_block *)0)
        return 0u;
    task_handle = __atomic_load_n(&block->task_handle, __ATOMIC_ACQUIRE);
    if (task_handle == (void *)0)
        return 0u;
    raw = STOCK_STACK_WATER(task_handle);
    return raw;
}

static const framer_resident_engine_api engine_api = {
    framer_mqjs_init,
    framer_mqjs_load,
    framer_mqjs_dispatch,
    framer_mqjs_input_enqueue,
    framer_mqjs_input_request_release_all,
    framer_mqjs_input_drain,
    framer_mqjs_input_get_observation,
    framer_mqjs_get_telemetry,
    framer_mqjs_destroy,
};

enum {
    PHYSICAL_RPC_CAP = 0,
    PHYSICAL_RPC_TELEMETRY = 1,
    PHYSICAL_RPC_EVENT = 2,
    PHYSICAL_RPC_RECEIPT = 3,
    PHYSICAL_RPC_UPLOAD = 4,
};

static uint8_t *widget_buffer_acquire(void **raw_out, uint32_t extra_bytes);
static void widget_assets_set_baked(physical_block *block);
#define FRAMER_RUNTIME_RPC_VALUE_BYTES 113u

/* ── reconstructed 2026-08-26 ─────────────────────────────────────────────
 * The module glue between the surviving head (constants, block, platform
 * callbacks) and the surviving tail (scene adopt/persist, proxy publishing,
 * startup).  Scene record/persist logic is lifted VERBATIM from the host-
 * proven build-scene-slot-b-host-proof; the RPC/telemetry/proxy scaffolding
 * from the committed module; the widget-slot and one-widget-per-screen paths
 * are rebuilt against docs/16-18 and the intact host-proven units.
 * ──────────────────────────────────────────────────────────────────────── */

/* Forward declarations: the middle and the tail call into each other. */
static physical_block *block_from_rpc(framer_runtime_rpc_context *context,
                                      uint32_t index);
static int rpc_begin_ready(physical_block *block,
                           framer_runtime_rpc_context *context,
                           void *response, void *request);
static void rpc_reply_blocked(framer_runtime_rpc_context *context,
                              void *response, void *request);
static void rpc_callback_common(void *callback, void *response, void *request,
                                uint32_t index,
                                void (*handler)(framer_runtime_rpc_context *,
                                                void *, void *));
static int widget_persist_busy(const physical_block *block);
static int widget_declared_host_rpc(const physical_block *block, uint32_t id);
static void rpc_upload_callback(void *callback, void *response, void *request);
static void scene_persist_step(physical_block *block);
static void widget_persist_step(physical_block *block);
static void widget_slot_adopt(physical_block *block);
static int widget_slot_adopt_from(physical_block *block, uint32_t slot);
static void proxy_build(physical_proxy *proxy);
static void proxy_cleanup(physical_proxy *proxy);
static void proxy_tick(physical_proxy *proxy);
static void proxy_encoder(physical_proxy *proxy, uint32_t encoder,
                          uint32_t raw_delta);
typedef struct {
    int (*erase)(void *opaque, uint32_t address, uint32_t bytes);
    int (*write)(void *opaque, uint32_t address, const uint8_t *source,
                 uint32_t bytes);
    int (*read)(void *opaque, uint32_t address, uint8_t *destination,
                uint32_t bytes);
    void *opaque;
} scene_flash_ops;

typedef struct {
    uint32_t state;
    uint32_t step;
    uint32_t generation;
    uint32_t package_bytes;
    uint32_t cursor;
    const uint8_t *package;
    const uint8_t *digest;
} scene_persist_context;

static uint32_t scene_read32(const uint8_t *data)
{
    return (uint32_t)data[0] | ((uint32_t)data[1] << 8u) |
           ((uint32_t)data[2] << 16u) | ((uint32_t)data[3] << 24u);
}

static uint32_t scene_crc32(const uint8_t *data, uint32_t bytes)
{
    uint32_t crc = 0xffffffffu;
    uint32_t index;
    for (index = 0u; index < bytes; ++index) {
        uint32_t bit;
        crc ^= (uint32_t)data[index];
        for (bit = 0u; bit < 8u; ++bit)
            crc = (crc >> 1u) ^ (0xedb88320u & (0u - (crc & 1u)));
    }
    return crc ^ 0xffffffffu;
}

static int scene_record_is_valid(const uint8_t *header, uint32_t *step,
                                 uint32_t *generation)
{
    uint32_t detail = SCENE_STEP_NONE;
    uint32_t found = 0u;
    int accepted = 0;
    if (header == (const uint8_t *)0) {
        detail = SCENE_STEP_MAGIC;
    } else if (scene_read32(header) != SCENE_RECORD_MAGIC_0 ||
               scene_read32(header + 4u) != SCENE_RECORD_MAGIC_1) {
        detail = SCENE_STEP_MAGIC;
    } else if (scene_read32(header + 8u) != SCENE_RECORD_VERSION) {
        detail = SCENE_STEP_VERSION;
    } else if (scene_read32(header + 12u) != SCENE_PACKAGE_BYTES) {
        detail = SCENE_STEP_SIZE;
    } else if (scene_read32(header + 16u) < SCENE_MIN_GENERATION ||
               scene_read32(header + 16u) == 0xffffffffu ||
               scene_read32(header + 20u) != scene_read32(header + 16u) - 1u) {
        detail = SCENE_STEP_GENERATION;
    } else if (scene_crc32(header, SCENE_RECORD_HEADER_BYTES - 4u) !=
               scene_read32(header + SCENE_RECORD_HEADER_BYTES - 4u)) {
        detail = SCENE_STEP_HEADER_CRC;
    } else {
        found = scene_read32(header + 16u);
        accepted = 1;
    }
    if (step != (uint32_t *)0)
        *step = detail;
    if (generation != (uint32_t *)0)
        *generation = found;
    return accepted;
}

static int scene_package_header_is_f1wb(const uint8_t *package,
                                        uint32_t generation)
{
    return package != (const uint8_t *)0 &&
           generation >= SCENE_MIN_GENERATION &&
           scene_read32(package) == SCENE_F1WB_MAGIC &&
           scene_read32(package + 8u) == generation &&
           scene_read32(package + 12u) == SCENE_FOCUS_F1WB_BYTES;
}

static void scene_copy(uint8_t *destination, const uint8_t *source,
                       uint32_t bytes)
{
    uint32_t words = bytes >> 2u;
    uint32_t index;
    uint32_t *out = (uint32_t *)(void *)destination;
    const uint32_t *in = (const uint32_t *)(const void *)source;
    for (index = 0u; index < words; ++index)
        out[index] = in[index];
    for (index = words << 2u; index < bytes; ++index)
        destination[index] = source[index];
}

static int scene_flash_span_allowed(uint32_t address, uint32_t bytes)
{
    if (bytes == 0u || bytes > SCENE_PERSIST_SECTOR_BYTES)
        return 0;
    if (address < SCENE_PERSIST_BEGIN || address >= SCENE_PERSIST_END)
        return 0;
    if (address > SCENE_PERSIST_END - bytes)
        return 0;
    if (address + bytes > SCENE_PERSIST_BEGIN +
                              SCENE_PERSIST_SECTORS * SCENE_PERSIST_SECTOR_BYTES)
        return 0;
    return 1;
}

static void scene_record_header_build(uint8_t header[64],
                                      uint32_t package_bytes,
                                      uint32_t generation,
                                      const uint8_t digest[32])
{
    uint32_t index;
    uint32_t crc;
    static const uint32_t words[2] = { SCENE_RECORD_MAGIC_0,
                                       SCENE_RECORD_MAGIC_1 };
    for (index = 0u; index < SCENE_RECORD_HEADER_BYTES; ++index)
        header[index] = 0u;
    for (index = 0u; index < 8u; ++index)
        header[index] = (uint8_t)(words[index >> 2u] >> ((index & 3u) * 8u));
    for (index = 0u; index < 4u; ++index) {
        header[8u + index] = (uint8_t)(SCENE_RECORD_VERSION >> (index * 8u));
        header[12u + index] = (uint8_t)(package_bytes >> (index * 8u));
        header[16u + index] = (uint8_t)(generation >> (index * 8u));
        header[20u + index] = (uint8_t)((generation - 1u) >> (index * 8u));
    }
    for (index = 0u; index < 32u; ++index)
        header[SCENE_RECORD_SHA_OFFSET + index] = digest[index];
    crc = scene_crc32(header, SCENE_RECORD_HEADER_BYTES - 4u);
    for (index = 0u; index < 4u; ++index)
        header[SCENE_RECORD_HEADER_BYTES - 4u + index] =
            (uint8_t)(crc >> (index * 8u));
}

static void scene_persist_advance(scene_persist_context *context,
                                  const scene_flash_ops *ops)
{
    uint8_t scratch[SCENE_PERSIST_VERIFY_BYTES];
    uint8_t header[SCENE_RECORD_HEADER_BYTES];
    uint32_t address;
    uint32_t span;
    uint32_t index;
    if (context == (scene_persist_context *)0 ||
        ops == (const scene_flash_ops *)0)
        return;
    if (context->package == (const uint8_t *)0 ||
        context->package_bytes != SCENE_PACKAGE_BYTES ||
        context->generation < SCENE_MIN_GENERATION ||
        context->generation == 0xffffffffu) {
        context->state = SCENE_PERSIST_FAILED;
        context->step = SCENE_PSTEP_STORE;
        return;
    }
    switch (context->state) {
    case SCENE_PERSIST_ERASE:
        if (context->cursor >= SCENE_PERSIST_SECTORS) {
            context->state = SCENE_PERSIST_WRITE;
            context->cursor = 0u;
            return;
        }
        address = SCENE_PERSIST_BEGIN +
                  context->cursor * SCENE_PERSIST_SECTOR_BYTES;
        if (!scene_flash_span_allowed(address, SCENE_PERSIST_SECTOR_BYTES) ||
            (address & (SCENE_PERSIST_SECTOR_BYTES - 1u)) != 0u) {
            context->state = SCENE_PERSIST_FAILED;
            context->step = SCENE_PSTEP_BOUNDS;
            return;
        }
        if (ops->erase(ops->opaque, address, SCENE_PERSIST_SECTOR_BYTES) != 0) {
            context->state = SCENE_PERSIST_FAILED;
            context->step = SCENE_PSTEP_ERASE;
            return;
        }
        context->cursor += 1u;
        return;
    case SCENE_PERSIST_WRITE:
        if (context->cursor >= context->package_bytes) {
            context->state = SCENE_PERSIST_VERIFY;
            context->cursor = 0u;
            return;
        }
        span = context->package_bytes - context->cursor;
        if (span > SCENE_PERSIST_CHUNK_BYTES)
            span = SCENE_PERSIST_CHUNK_BYTES;
        address = SCENE_PERSIST_BEGIN + SCENE_RECORD_HEADER_BYTES +
                  context->cursor;
        if (!scene_flash_span_allowed(address, span)) {
            context->state = SCENE_PERSIST_FAILED;
            context->step = SCENE_PSTEP_BOUNDS;
            return;
        }
        if (ops->write(ops->opaque, address, context->package + context->cursor,
                       span) != 0) {
            context->state = SCENE_PERSIST_FAILED;
            context->step = SCENE_PSTEP_WRITE;
            return;
        }
        context->cursor += span;
        return;
    case SCENE_PERSIST_VERIFY:
        if (context->cursor >= context->package_bytes) {
            context->state = SCENE_PERSIST_HEADER;
            context->cursor = 0u;
            return;
        }
        span = context->package_bytes - context->cursor;
        if (span > SCENE_PERSIST_VERIFY_BYTES)
            span = SCENE_PERSIST_VERIFY_BYTES;
        address = SCENE_PERSIST_BEGIN + SCENE_RECORD_HEADER_BYTES +
                  context->cursor;
        if (!scene_flash_span_allowed(address, span)) {
            context->state = SCENE_PERSIST_FAILED;
            context->step = SCENE_PSTEP_BOUNDS;
            return;
        }
        if (ops->read(ops->opaque, address, scratch, span) != 0) {
            context->state = SCENE_PERSIST_FAILED;
            context->step = SCENE_PSTEP_READBACK;
            return;
        }
        for (index = 0u; index < span; ++index) {
            if (scratch[index] != context->package[context->cursor + index]) {
                context->state = SCENE_PERSIST_FAILED;
                context->step = SCENE_PSTEP_MISMATCH;
                return;
            }
        }
        context->cursor += span;
        return;
    case SCENE_PERSIST_HEADER:
        if (context->digest == (const uint8_t *)0) {
            context->state = SCENE_PERSIST_FAILED;
            context->step = SCENE_PSTEP_STORE;
            return;
        }
        scene_record_header_build(header, context->package_bytes,
                                  context->generation, context->digest);
        if (!scene_flash_span_allowed(SCENE_PERSIST_BEGIN,
                                      SCENE_RECORD_HEADER_BYTES)) {
            context->state = SCENE_PERSIST_FAILED;
            context->step = SCENE_PSTEP_BOUNDS;
            return;
        }
        if (ops->write(ops->opaque, SCENE_PERSIST_BEGIN, header,
                       SCENE_RECORD_HEADER_BYTES) != 0) {
            context->state = SCENE_PERSIST_FAILED;
            context->step = SCENE_PSTEP_HEADER_WRITE;
            return;
        }
        if (ops->read(ops->opaque, SCENE_PERSIST_BEGIN, scratch,
                      SCENE_RECORD_HEADER_BYTES) != 0) {
            context->state = SCENE_PERSIST_FAILED;
            context->step = SCENE_PSTEP_HEADER_READBACK;
            return;
        }
        for (index = 0u; index < SCENE_RECORD_HEADER_BYTES; ++index) {
            if (scratch[index] != header[index]) {
                context->state = SCENE_PERSIST_FAILED;
                context->step = SCENE_PSTEP_HEADER_MISMATCH;
                return;
            }
        }
        context->state = SCENE_PERSIST_DONE;
        context->step = SCENE_PSTEP_NONE;
        return;
    default:
        return;
    }
}

/* --- end exact source ---------------------------------------------------- */

/* --- fake NOR flash (host only) ------------------------------------------
 * 16 MiB of address space is modelled as the 192 KiB slot plus poisoned
 * guards on either side: any access outside [0x240000,0x270000) aborts the
 * run rather than silently succeeding, so a bounds regression cannot pass. */
#define FAKE_BASE 0x00240000u
#define FAKE_BYTES 0x00030000u
static uint8_t fake_flash[FAKE_BYTES];
static uint32_t fake_erases;
static uint32_t fake_writes;
static uint32_t fake_reads;
static uint32_t fake_written_bytes;
static uint32_t fake_out_of_bounds;
static uint32_t fake_fail_after;       /* 0 = never fail */
static uint32_t fake_ops;
static uint32_t fake_tear_at;          /* op index whose write is truncated */
static uint32_t fake_tear_silent;      /* truncated write still reports success */
static uint32_t fake_tear_fired;


/* sha256 of the COPY must equal the record's stored digest. */
static int scene_digest_matches(const uint8_t *expected, const uint8_t *data,
                                uint32_t bytes)
{
    uint8_t digest[32];
    uint32_t index;
    uint32_t difference = 0u;
    if (expected == (const uint8_t *)0 || data == (const uint8_t *)0)
        return 0;
    framer_f2js_sha256(data, (size_t)bytes, digest);
    for (index = 0u; index < 32u; ++index)
        difference |= (uint32_t)(digest[index] ^ expected[index]);
    return difference == 0u;
}

/* PSRAM staging for one scene package; freed by the caller. */
static uint8_t *scene_buffer_acquire(void **raw_out)
{
    const uint32_t caps = PHYSICAL_CAP_SPIRAM | PHYSICAL_CAP_8BIT;
    const size_t request = (size_t)SCENE_PACKAGE_BYTES +
                           (size_t)PHYSICAL_HEAP_ALIGN_SLACK;
    void *raw;
    uintptr_t aligned;
    if (raw_out == (void **)0)
        return (uint8_t *)0;
    *raw_out = (void *)0;
    if (STOCK_HEAP_FREE_SIZE(caps) < request ||
        STOCK_HEAP_LARGEST(caps) < request)
        return (uint8_t *)0;
    raw = STOCK_HEAP_MALLOC(request, caps);
    if (raw == (void *)0)
        return (uint8_t *)0;
    aligned = ((uintptr_t)raw + 15u) & ~(uintptr_t)15u;
    if (aligned < (uintptr_t)raw ||
        aligned - (uintptr_t)raw > (uintptr_t)PHYSICAL_HEAP_ALIGN_SLACK ||
        !in_psram(raw, request) ||
        !in_psram((const void *)aligned, (size_t)SCENE_PACKAGE_BYTES)) {
        STOCK_HEAP_FREE(raw);
        return (uint8_t *)0;
    }
    *raw_out = raw;
    return (uint8_t *)aligned;
}

/* The renderer-v2 sidecar lives at vtable[11] and starts with 'SCV2'. */
static int scene_sidecar_present(void *controller)
{
    void **vtable;
    uint8_t *sidecar;
    if (controller == (void *)0 || !in_stock_data(controller, sizeof(void *)))
        return 0;
    vtable = *(void ***)controller;
    if (vtable == (void **)0 ||
        !in_stock_data(vtable, 12u * sizeof(void *)))
        return 0;
    sidecar = (uint8_t *)vtable[11];
    if (sidecar == (uint8_t *)0 || !in_stock_data(sidecar, 8u))
        return 0;
    return *(const uint32_t *)(const void *)sidecar == 0x32565343u;
}

/* ── widget slot helpers ──────────────────────────────────────────────── */

/* Little-endian word read for the baked F2JS header (generation at +12). */
static uint32_t widget_read_le32(const uint8_t *bytes)
{
    return (uint32_t)bytes[0] | ((uint32_t)bytes[1] << 8) |
           ((uint32_t)bytes[2] << 16) | ((uint32_t)bytes[3] << 24);
}

/* One 16-byte-aligned PSRAM arena of container size (+ optional tail). */
static uint8_t *widget_buffer_acquire(void **raw_out, uint32_t extra_bytes)
{
    const uint32_t caps = PHYSICAL_CAP_SPIRAM | PHYSICAL_CAP_8BIT;
    const size_t body = (size_t)FRAMER_F2UP_MAX_BYTES + (size_t)extra_bytes;
    const size_t request = body + (size_t)PHYSICAL_HEAP_ALIGN_SLACK;
    void *raw;
    uintptr_t aligned;
    if (raw_out == (void **)0)
        return (uint8_t *)0;
    *raw_out = (void *)0;
    if (STOCK_HEAP_FREE_SIZE(caps) < request ||
        STOCK_HEAP_LARGEST(caps) < request)
        return (uint8_t *)0;
    raw = STOCK_HEAP_MALLOC(request, caps);
    if (raw == (void *)0)
        return (uint8_t *)0;
    aligned = ((uintptr_t)raw + 15u) & ~(uintptr_t)15u;
    if (aligned < (uintptr_t)raw ||
        aligned - (uintptr_t)raw > (uintptr_t)PHYSICAL_HEAP_ALIGN_SLACK ||
        !in_psram(raw, request) ||
        !in_psram((const void *)aligned, body)) {
        STOCK_HEAP_FREE(raw);
        return (uint8_t *)0;
    }
    *raw_out = raw;
    return (uint8_t *)aligned;
}

/* The baked weather asset set: the default and the fallback whenever an
 * adopted widget fails any deeper admission gate. */
static void widget_assets_set_baked(physical_block *block)
{
    physical_widget_assets *assets = &block->widget_assets;
    assets->f2js = framer_physical_weather_f2js_start;
    assets->f2js_bytes = (uint32_t)(framer_physical_weather_f2js_end -
                                    framer_physical_weather_f2js_start);
    assets->f2tf = framer_physical_weather_f2tf_start;
    assets->f2tf_bytes = (uint32_t)(framer_physical_weather_f2tf_end -
                                    framer_physical_weather_f2tf_start);
    assets->lzss = framer_physical_weather_base_lzss_start;
    assets->lzss_bytes = (uint32_t)(framer_physical_weather_base_lzss_end -
                                    framer_physical_weather_base_lzss_start);
    assets->f2js_sha256 = framer_physical_weather_f2js_sha256;
    assets->generation =
        widget_read_le32(framer_physical_weather_f2js_start + 12u);
    assets->source = 0u;
}

/* Map one widget slot's flash window into the scene data window. */
static int widget_slot_window_map(uint32_t slot, void **mapped_out)
{
    void *mapped = (void *)0;
    uint32_t base = framer_f2up_slot_base(slot);
    *mapped_out = (void *)0;
    if (base == 0u)
        return 0;
    if (STOCK_MMU_MAP(base, (size_t)FRAMER_F2UP_SLOT_BYTES,
                      MMU_TARGET_FLASH0, MMU_MEM_CAP_READ | MMU_MEM_CAP_8BIT,
                      0, &mapped) != 0 || mapped == (void *)0)
        return 0;
    if ((uintptr_t)mapped < SCENE_DATA_WINDOW_BEGIN ||
        (uintptr_t)mapped > SCENE_DATA_WINDOW_END - FRAMER_F2UP_SLOT_BYTES ||
        ((uintptr_t)mapped & 3u) != 0u) {
        (void)STOCK_MMU_UNMAP(mapped);
        return 0;
    }
    *mapped_out = mapped;
    return 1;
}

/* Fill the slot inventory: generation + f2js sha prefix per admissible slot. */
static void widget_slot_scan(physical_block *block)
{
    uint32_t slot;
    for (slot = 0u; slot < FRAMER_F2UP_SLOT_COUNT; ++slot) {
        void *mapped;
        framer_f2up_admission admission;
        int32_t detail = 0;
        uint32_t index;
        block->widget_slot_generations[slot] = 0u;
        for (index = 0u; index < 16u; ++index)
            block->widget_slot_sha16[slot][index] = 0u;
        if (STOCK_HEAP_FREE_SIZE(PHYSICAL_CAP_INTERNAL | PHYSICAL_CAP_8BIT) <
            (size_t)SCENE_MAP_RESERVE_BYTES)
            continue;
        if (!widget_slot_window_map(slot, &mapped))
            continue;
        if (framer_f2up_adopt_decide((const uint8_t *)mapped,
                                     FRAMER_F2UP_SLOT_BYTES, 0u, &admission,
                                     &detail) == FRAMER_F2UP_ADOPT_OK) {
            block->widget_slot_generations[slot] = admission.generation;
            for (index = 0u; index < 16u; ++index)
                block->widget_slot_sha16[slot][index] =
                    admission.f2js_sha256[index];
        }
        (void)STOCK_MMU_UNMAP(mapped);
    }
    __atomic_store_n(&block->widget_persisted_generation,
                     block->widget_slot_generations[0], __ATOMIC_RELEASE);
}

static physical_block *block_from_rpc(framer_runtime_rpc_context *context,
                                      uint32_t index)
{
    uintptr_t address;
    physical_block *block;
    if (context == (framer_runtime_rpc_context *)0 ||
        index >= FRAMER_RUNTIME_RPC_CONTEXT_COUNT)
        return (physical_block *)0;
    address = (uintptr_t)context - offsetof(physical_block, rpc) -
              index * sizeof(framer_runtime_rpc_context);
    block = (physical_block *)address;
    if (!in_internal(block, sizeof(*block)) || block->magic != PHYSICAL_MAGIC ||
        block->generation != PHYSICAL_GENERATION ||
        &block->rpc[index] != context)
        return (physical_block *)0;
    return block;
}

static void rpc_reply_blocked(framer_runtime_rpc_context *context,
                              void *response, void *request)
{
    if (context != (framer_runtime_rpc_context *)0 && response != (void *)0 &&
        request != (void *)0)
        STOCK_RPC_REPLY(response, request, 0u, context);
}

static int rpc_begin_ready(physical_block *block,
                           framer_runtime_rpc_context *context,
                           void *response, void *request)
{
    if (block == (physical_block *)0 || response == (void *)0 ||
        request == (void *)0 ||
        __atomic_load_n(&block->rpc_ready, __ATOMIC_ACQUIRE) == 0u ||
        !framer_runtime_rpc_begin(context)) {
        rpc_reply_blocked(context, response, request);
        return 0;
    }
    return 1;
}

static int rpc_read_page(void *request, int32_t *page)
{
    __attribute__((aligned(16))) uint8_t root[64];
    int result;
    zero_bytes(root, sizeof(root));
    STOCK_ROOT_MAKE(root, request);
    result = framer_physical_rpc_read_integer(root, "page", 4u, page);
    STOCK_ROOT_DESTROY(root);
    return result;
}

static int rpc_read_event(void *request, int32_t values[5])
{
    static const char *const keys[5] = {
        "id", "value", "auxiliary", "generation", "revision"
    };
    static const uint8_t lengths[5] = { 2u, 5u, 9u, 10u, 8u };
    __attribute__((aligned(16))) uint8_t root[64];
    uint32_t index;
    int result = 1;
    zero_bytes(root, sizeof(root));
    STOCK_ROOT_MAKE(root, request);
    for (index = 0u; index < 5u; ++index)
        if (!framer_physical_rpc_read_integer(root, keys[index],
                                               lengths[index], &values[index]))
            result = 0;
    STOCK_ROOT_DESTROY(root);
    return result;
}

static int weather_rpc_id(uint32_t id)
{
    /* 0xb245 = settings.zipAck (host -> widget ZIP acknowledgement, gen 20). */
    return (id >= 0xb240u && id <= 0xb245u) || id == 0xb24du ||
           id == 0xb24eu || id == 0xb24fu;
}

static int provider_status_value(int32_t value, int32_t auxiliary)
{
    if (value == INT32_MIN && (uint32_t)auxiliary == 0x54494d45u)
        return 1;
    if (value == INT32_MIN + 1 && (uint32_t)auxiliary == 0x4f4f4d21u)
        return 1;
    return (value == 0 || value == 1) && auxiliary >= 0 &&
           auxiliary <= 86400;
}

static void rpc_cap_handler(framer_runtime_rpc_context *context,
                            void *response, void *request)
{
    physical_block *block = block_from_rpc(context, PHYSICAL_RPC_CAP);
    int32_t page;
    if (!rpc_begin_ready(block, context, response, request))
        return;
    if (__atomic_load_n(&block->owner.telemetry.permanently_disabled,
                        __ATOMIC_ACQUIRE) != 0u) {
        STOCK_RPC_REPLY(response, request, 0u, context);
        framer_runtime_rpc_end(context);
        return;
    }
    if (!rpc_read_page(request, &page) || page < 0 ||
        page >= (int32_t)FRAMER_RUNTIME_CAPABILITY_PAGES) {
        STOCK_RPC_REPLY(response, request, 0u, context);
        framer_runtime_rpc_end(context);
        return;
    }
    block->runtime_capability.key_events =
        __atomic_load_n(&block->key_stream_proven, __ATOMIC_ACQUIRE) != 0u;
    block->runtime_capability.chord_events =
        block->runtime_capability.key_events;
    if (!framer_runtime_capability_format(&block->runtime_capability,
                                           (uint32_t)page,
                                           context->value))
        STOCK_RPC_REPLY(response, request, 0u, context);
    else
        STOCK_RPC_REPLY(response, request, 1u, context);
    framer_runtime_rpc_end(context);
}

static int telemetry_snapshot(physical_block *block,
                              framer_runtime_telemetry *output)
{
    uint32_t expected = 0u;
    if (!__atomic_compare_exchange_n(&block->runtime_telemetry_lock, &expected,
                                     1u, 0, __ATOMIC_ACQUIRE,
                                     __ATOMIC_RELAXED))
        return 0;
    *output = block->runtime_telemetry;
    __atomic_store_n(&block->runtime_telemetry_lock, 0u, __ATOMIC_RELEASE);
    return 1;
}

/* --- device->host value channel: telemetry slot pages ----------------------
 *
 * Pages 6 and 7 return the sixteen owner-mailbox integer slots (the values the
 * JavaScript widget publishes) as raw 32-bit words: page 6 carries slots 0..7,
 * page 7 carries slots 8..15.
 *
 * These pages sit deliberately OUTSIDE the
 * "p0-locks-snapshot-ordered-p1-p5-expiry-clear-v1" protocol that governs
 * pages 0..5.  They carry no runtime-telemetry sample, so there is nothing for
 * a page-zero snapshot to make immutable, and a host may poll them at ~1 Hz
 * without opening a session, without taking block->runtime_telemetry_lock, and
 * without clearing or advancing telemetry_session.expected_page.  A slot-page
 * read is therefore invisible to a concurrent p0..p5 transaction.
 *
 * Consistency is per-page and comes from the mailbox seqlock, read with the
 * same discipline as framer_resident_mailbox_try_read() and
 * framer_tf_snapshot_mailbox(): even sequence, SEQ_CST slot loads, SEQ_CST
 * fence, re-read and compare.  framer_resident_mailbox_try_read() is a
 * single-shot helper that would cost a 72-byte snapshot on this stack, so the
 * window read below is open-coded with the identical ordering and bounded to
 * FRAMER_TF_SNAPSHOT_ATTEMPTS retries.  A persistently torn read answers with
 * the blocked reply rather than a half-written page. */
#define PHYSICAL_TELEMETRY_SLOT_PAGE_FIRST 6u
#define PHYSICAL_TELEMETRY_SLOT_PAGE_LAST 7u
#define PHYSICAL_TELEMETRY_SLOTS_PER_PAGE 8u

_Static_assert((PHYSICAL_TELEMETRY_SLOT_PAGE_LAST -
                PHYSICAL_TELEMETRY_SLOT_PAGE_FIRST + 1u) *
               PHYSICAL_TELEMETRY_SLOTS_PER_PAGE == FRAMER_MQJS_SLOT_COUNT,
               "Slot pages must cover the mailbox exactly once.");
/* "v1;p=7" plus eight ";sNN=xxxxxxxx" groups is the longest encoding:
 * 6 + 2 * 12 + 6 * 13 = 108 characters, and the terminator lands at 108. */
_Static_assert(6u + 2u * 12u + 6u * 13u < 113u,
               "Slot page encoding does not fit the RPC status buffer.");

static int mailbox_slot_window(const framer_resident_mailbox *mailbox,
                               uint32_t first_slot,
                               int32_t values[PHYSICAL_TELEMETRY_SLOTS_PER_PAGE])
{
    uint32_t attempt;
    if (mailbox == (const framer_resident_mailbox *)0)
        return 0;
    for (attempt = 0u; attempt < FRAMER_TF_SNAPSHOT_ATTEMPTS; ++attempt) {
        uint32_t first = __atomic_load_n(&mailbox->sequence, __ATOMIC_ACQUIRE);
        uint32_t second;
        uint32_t index;
        if ((first & 1u) != 0u)
            continue;
        for (index = 0u; index < PHYSICAL_TELEMETRY_SLOTS_PER_PAGE; ++index)
            values[index] = __atomic_load_n(&mailbox->slots[first_slot + index],
                                            __ATOMIC_SEQ_CST);
        __atomic_thread_fence(__ATOMIC_SEQ_CST);
        second = __atomic_load_n(&mailbox->sequence, __ATOMIC_ACQUIRE);
        if (first == second && (second & 1u) == 0u)
            return 1;
    }
    return 0;
}

/* v1;p=<page>;s<slot>=<8 lower-case hex digits> per slot, slot numbers
 * absolute (s0..s7 on page 6, s8..s15 on page 7), values written as the raw
 * 32-bit word so negatives arrive as their two's-complement encoding.
 *
 * Deliberately noinline: the eight-word window buffer must live in its own
 * frame rather than widening rpc_telemetry_handler's, which is on the shared
 * prefix of every telemetry call.  Inlined it costs the whole RPC chain 32 B
 * (224 -> 256, the entire remaining budget) on pages that never use it. */
__attribute__((noinline))
static int telemetry_slots_format(const framer_resident_mailbox *mailbox,
                                  uint32_t page, char output[113])
{
    static const char digits[] = "0123456789abcdef";
    int32_t values[PHYSICAL_TELEMETRY_SLOTS_PER_PAGE];
    uint32_t first;
    uint32_t index;
    uint32_t offset = 0u;
    if (output == (char *)0 || page < PHYSICAL_TELEMETRY_SLOT_PAGE_FIRST ||
        page > PHYSICAL_TELEMETRY_SLOT_PAGE_LAST)
        return 0;
    first = (page - PHYSICAL_TELEMETRY_SLOT_PAGE_FIRST) *
            PHYSICAL_TELEMETRY_SLOTS_PER_PAGE;
    if (!mailbox_slot_window(mailbox, first, values))
        return 0;
    output[offset++] = 'v';
    output[offset++] = '1';
    output[offset++] = ';';
    output[offset++] = 'p';
    output[offset++] = '=';
    output[offset++] = (char)('0' + page);
    for (index = 0u; index < PHYSICAL_TELEMETRY_SLOTS_PER_PAGE; ++index) {
        uint32_t slot = first + index;
        uint32_t word = (uint32_t)values[index];
        uint32_t shift;
        output[offset++] = ';';
        output[offset++] = 's';
        if (slot >= 10u)
            output[offset++] = (char)('0' + slot / 10u);
        output[offset++] = (char)('0' + slot % 10u);
        output[offset++] = '=';
        for (shift = 28u;; shift -= 4u) {
            output[offset++] = digits[(word >> shift) & 15u];
            if (shift == 0u)
                break;
        }
    }
    output[offset] = 0;
    return 1;
}

static void rpc_telemetry_handler(framer_runtime_rpc_context *context,
                                  void *response, void *request)
{
    physical_block *block = block_from_rpc(context, PHYSICAL_RPC_TELEMETRY);
    const framer_runtime_telemetry *selected;
    int accepted = 0;
    int32_t page;
    if (!rpc_begin_ready(block, context, response, request))
        return;
    if (rpc_read_page(request, &page)) {
        if (page >= (int32_t)PHYSICAL_TELEMETRY_SLOT_PAGE_FIRST &&
            page <= (int32_t)PHYSICAL_TELEMETRY_SLOT_PAGE_LAST) {
            /* Session-free and lock-free; telemetry_session is untouched so a
             * poll cannot abort an in-flight ordered p0..p5 transaction. */
            accepted = telemetry_slots_format(&block->owner.mailbox,
                                              (uint32_t)page, context->value);
        } else {
            selected = (const framer_runtime_telemetry *)0;
            if (page == 0 && telemetry_snapshot(
                    block, &block->telemetry_session.snapshot)) {
                accepted = framer_physical_telemetry_session_select(
                    &block->telemetry_session, page, now_ms(),
                    &block->telemetry_session.snapshot,
                    __atomic_load_n(&block->ui_max_tick_us, __ATOMIC_ACQUIRE),
                    &selected);
            } else if (page != 0) {
                accepted = framer_physical_telemetry_session_select(
                    &block->telemetry_session, page, now_ms(),
                    (const framer_runtime_telemetry *)0, 0u, &selected);
            } else {
                block->telemetry_session.expected_page = 0u;
            }
            if (accepted && (!framer_runtime_telemetry_format(
                    selected, (uint32_t)page, context->value) ||
                    (page == 5 && !framer_physical_telemetry_append_ui_max(
                        context->value, block->telemetry_session.ui_max_us)))) {
                block->telemetry_session.expected_page = 0u;
                accepted = 0;
            }
        }
    } else {
        block->telemetry_session.expected_page = 0u;
    }
    if (!accepted)
        STOCK_RPC_REPLY(response, request, 0u, context);
    else
        STOCK_RPC_REPLY(response, request, 1u, context);
    framer_runtime_rpc_end(context);
}

static void rpc_event_handler(framer_runtime_rpc_context *context,
                              void *response, void *request)
{
    physical_block *block = block_from_rpc(context, PHYSICAL_RPC_EVENT);
    framer_runtime_receipt_snapshot *snapshot;
    int32_t *values;
    uint32_t sequence;
    uint32_t busy;
    int valid;
    int queued = 0;
    if (!rpc_begin_ready(block, context, response, request))
        return;
    snapshot = &block->rpc_event_scratch;
    values = block->rpc_event_values;
    zero_bytes(snapshot, sizeof(*snapshot));
    busy = __atomic_load_n(&block->rpc_event_pending, __ATOMIC_ACQUIRE);
    valid = rpc_read_event(request, values);
    sequence = __atomic_add_fetch(&block->rpc_event_sequence, 1u,
                                  __ATOMIC_RELAXED);
    if (sequence == 0u)
        sequence = __atomic_add_fetch(&block->rpc_event_sequence, 1u,
                                      __ATOMIC_RELAXED);
    snapshot->event_sequence = sequence;
    if (valid) {
        snapshot->event_id = (uint32_t)values[0];
        snapshot->event_value = values[1];
        snapshot->event_auxiliary = values[2];
        snapshot->generation = (uint32_t)values[3];
        snapshot->revision = (uint32_t)values[4];
        valid = values[0] > 0 && values[0] <= 0xffff &&
                widget_declared_host_rpc(block, (uint32_t)values[0]) &&
                (uint32_t)values[3] == block->widget_assets.generation;
        if (valid && (uint32_t)values[0] == 0xb24du)
            valid = provider_status_value(values[1], values[2]);
    }
    if (busy != 0u) {
        snapshot->state = FRAMER_RUNTIME_RECEIPT_BUSY;
        snapshot->queue_depth = 1u;
    } else if (!valid) {
        snapshot->state = FRAMER_RUNTIME_RECEIPT_REJECTED;
        snapshot->rejected_count =
            __atomic_add_fetch(&block->runtime_events_rejected, 1u,
                               __ATOMIC_RELAXED);
        snapshot->rejection_code = 1u;
        framer_runtime_receipt_publish(&block->receipt, snapshot);
    } else {
        uint32_t expected = 0u;
        if (!__atomic_compare_exchange_n(&block->rpc_event_pending, &expected,
                                         1u, 0, __ATOMIC_ACQ_REL,
                                         __ATOMIC_ACQUIRE)) {
            snapshot->state = FRAMER_RUNTIME_RECEIPT_BUSY;
            snapshot->queue_depth = 1u;
        } else {
            snapshot->state = FRAMER_RUNTIME_RECEIPT_QUEUED;
            snapshot->queue_depth = 1u;
            block->pending_receipt = *snapshot;
            __atomic_store_n(&block->rpc_event_armed, 0u, __ATOMIC_RELEASE);
            queued = framer_resident_owner_enqueue_host_rpc_tagged(
                &block->owner, block->widget_assets.generation,
                (uint16_t)values[0],
                values[1], values[2], sequence);
            if (queued) {
                __atomic_add_fetch(&block->runtime_events_queued, 1u,
                                   __ATOMIC_RELAXED);
                framer_runtime_receipt_publish(&block->receipt, snapshot);
                __atomic_store_n(&block->rpc_event_armed, 1u,
                                 __ATOMIC_RELEASE);
            } else {
                snapshot->state = FRAMER_RUNTIME_RECEIPT_REJECTED;
                snapshot->queue_depth = 0u;
                snapshot->rejected_count = __atomic_add_fetch(
                    &block->runtime_events_rejected, 1u, __ATOMIC_RELAXED);
                snapshot->rejection_code = 2u;
                framer_runtime_receipt_publish(&block->receipt, snapshot);
                __atomic_store_n(&block->rpc_event_pending, 0u,
                                 __ATOMIC_RELEASE);
            }
        }
    }
    if (!framer_runtime_receipt_format(snapshot, context->value))
        STOCK_RPC_REPLY(response, request, 0u, context);
    else
        STOCK_RPC_REPLY(response, request, 1u, context);
    framer_runtime_rpc_end(context);
}

static void rpc_receipt_handler(framer_runtime_rpc_context *context,
                                void *response, void *request)
{
    physical_block *block = block_from_rpc(context, PHYSICAL_RPC_RECEIPT);
    framer_runtime_receipt_snapshot snapshot;
    if (!rpc_begin_ready(block, context, response, request))
        return;
    if (!framer_runtime_receipt_try_read(&block->receipt, &snapshot) ||
        !framer_runtime_receipt_format(&snapshot, context->value))
        STOCK_RPC_REPLY(response, request, 0u, context);
    else
        STOCK_RPC_REPLY(response, request, 1u, context);
    framer_runtime_rpc_end(context);
}

static void rpc_callback_common(void *callback_object, void *response_holder,
                                void *request, uint32_t index,
                                void (*handler)(framer_runtime_rpc_context *,
                                                void *, void *))
{
    framer_runtime_rpc_context *context;
    void *response;
    if (callback_object == (void *)0 || response_holder == (void *)0 ||
        request == (void *)0)
        return;
    context = *(framer_runtime_rpc_context **)callback_object;
    response = *(void **)response_holder;
    if (block_from_rpc(context, index) == (physical_block *)0)
        return;
    handler(context, response, request);
}

static void rpc_cap_callback(void *callback, void *response, void *request)
{
    rpc_callback_common(callback, response, request, PHYSICAL_RPC_CAP,
                        rpc_cap_handler);
}

static void rpc_telemetry_callback(void *callback, void *response, void *request)
{
    rpc_callback_common(callback, response, request, PHYSICAL_RPC_TELEMETRY,
                        rpc_telemetry_handler);
}

static void rpc_event_callback(void *callback, void *response, void *request)
{
    rpc_callback_common(callback, response, request, PHYSICAL_RPC_EVENT,
                        rpc_event_handler);
}

static void rpc_receipt_callback(void *callback, void *response, void *request)
{
    rpc_callback_common(callback, response, request, PHYSICAL_RPC_RECEIPT,
                        rpc_receipt_handler);
}

static int register_rpc(physical_block *block)
{
    static const char *const methods[5] = {
        FRAMER_RUNTIME_RPC_METHOD_CAP, FRAMER_RUNTIME_RPC_METHOD_TELEMETRY,
        FRAMER_RUNTIME_RPC_METHOD_EVENT, FRAMER_RUNTIME_RPC_METHOD_RECEIPT,
        FRAMER_RUNTIME_RPC_METHOD_UPLOAD
    };
    static const uint8_t lengths[5] = { 19u, 25u, 21u, 23u, 22u };
    static void (*const callbacks[5])(void *, void *, void *) = {
        rpc_cap_callback, rpc_telemetry_callback, rpc_event_callback,
        rpc_receipt_callback, rpc_upload_callback
    };
    void *registry = STOCK_RPC_REGISTRY();
    uint32_t index;
    if (registry == (void *)0)
        return 0;
    for (index = 0u; index < 5u; ++index) {
        framer_runtime_rpc_init(&block->rpc[index], methods[index]);
        STOCK_RPC_REGISTER(registry, &block->rpc[index],
                           block->rpc[index].method, lengths[index],
                           (void *)(uintptr_t)callbacks[index]);
    }
    return 1;
}

static int refresh_runtime_telemetry(physical_block *block,
                                     uint32_t terminal_completion);

static int publish_staged_completion(physical_block *block)
{
    if (__atomic_load_n(&block->completion_publish_pending,
                        __ATOMIC_ACQUIRE) == 0u ||
        !refresh_runtime_telemetry(block, 1u) ||
        !framer_physical_completion_can_publish(
            1u, 1u,
            __atomic_load_n(&block->rpc_event_pending,
                            __ATOMIC_ACQUIRE)))
        return 0;
    /* Receipt publication is the final release point. A receipt reader that
     * acquires A/F/R is therefore guaranteed to observe matching p2 n/x.
     * Admission remains closed until after that publication completes. */
    framer_runtime_receipt_publish(&block->receipt,
                                   &block->completion_receipt);
    __atomic_store_n(&block->completion_publish_pending, 0u,
                     __ATOMIC_RELEASE);
    __atomic_store_n(&block->rpc_event_armed, 0u, __ATOMIC_RELEASE);
    __atomic_store_n(&block->rpc_event_pending, 0u, __ATOMIC_RELEASE);
    return 1;
}

static int consume_tagged_completion(physical_block *block)
{
    framer_resident_tagged_completion completion;
    framer_runtime_receipt_snapshot snapshot;
    if (__atomic_load_n(&block->completion_publish_pending,
                        __ATOMIC_ACQUIRE) != 0u)
        return publish_staged_completion(block);
    if (__atomic_load_n(&block->rpc_event_armed, __ATOMIC_ACQUIRE) == 0u ||
        !framer_resident_owner_take_tagged_completion(&block->owner,
                                                       &completion))
        return 0;
    snapshot = block->pending_receipt;
    snapshot.queue_depth = 0u;
    snapshot.applied_generation = completion.applied_generation;
    snapshot.applied_revision = completion.applied_revision;
    if (completion.tag != snapshot.event_sequence) {
        snapshot.state = FRAMER_RUNTIME_RECEIPT_REJECTED;
        snapshot.rejection_code = 3u;
        snapshot.rejected_count = __atomic_add_fetch(
            &block->runtime_events_rejected, 1u, __ATOMIC_RELAXED);
    } else if (completion.result < 0) {
        snapshot.state = FRAMER_RUNTIME_RECEIPT_FAULTED;
        snapshot.rejection_code = (uint32_t)completion.result;
        snapshot.rejected_count = __atomic_add_fetch(
            &block->runtime_events_rejected, 1u, __ATOMIC_RELAXED);
    } else {
        snapshot.state = FRAMER_RUNTIME_RECEIPT_APPLIED;
        __atomic_add_fetch(&block->runtime_events_applied, 1u,
                           __ATOMIC_RELAXED);
    }
    __atomic_store_n(&block->runtime_last_completion_sequence,
                     completion.tag, __ATOMIC_RELEASE);
    __atomic_store_n(&block->runtime_last_completion_result,
                     completion.result, __ATOMIC_RELEASE);
    block->completion_receipt = snapshot;
    __atomic_store_n(&block->completion_publish_pending, 1u,
                     __ATOMIC_RELEASE);
    return publish_staged_completion(block);
}

static int refresh_runtime_telemetry(physical_block *block,
                                     uint32_t terminal_completion)
{
    framer_runtime_telemetry next;
    framer_resident_telemetry resident;
    framer_mqjs_telemetry engine;
    framer_runtime_key_probe key;
    framer_resident_mailbox_snapshot mailbox;
    uint32_t sequence;
    uint32_t expected_lock = 0u;
    if (!__atomic_compare_exchange_n(&block->runtime_telemetry_lock,
                                     &expected_lock, 1u, 0,
                                     __ATOMIC_ACQUIRE, __ATOMIC_RELAXED))
        return 0;
    zero_bytes(&next, sizeof(next));
    zero_bytes(&resident, sizeof(resident));
    zero_bytes(&engine, sizeof(engine));
    zero_bytes(&key, sizeof(key));
    zero_bytes(&mailbox, sizeof(mailbox));
    framer_resident_owner_get_telemetry(&block->owner, &resident);
    block->owner.engine.get_telemetry(&block->owner.runtime, &engine);
    (void)framer_runtime_key_probe_try_read(&block->key_probe, &key);
    next.boot_id = block->runtime_capability.boot_id;
    next.uptime_us = STOCK_TIME_US() - block->runtime_capability.boot_id;
    next.polls = engine.interrupt_polls;
    next.free_internal = (uint32_t)STOCK_HEAP_FREE_SIZE(
        PHYSICAL_CAP_INTERNAL | PHYSICAL_CAP_8BIT);
    next.largest_internal = (uint32_t)STOCK_HEAP_LARGEST(
        PHYSICAL_CAP_INTERNAL | PHYSICAL_CAP_8BIT);
    next.heap_current = engine.heap_used_bytes;
    next.heap_high_water = engine.heap_high_water_bytes;
    next.stack_minimum = resident.task_stack_high_water_bytes;
    next.callbacks = engine.callbacks;
    next.deadline_us = FRAMER_RUNTIME_CALLBACK_DEADLINE_US;
    next.timeouts = engine.timeouts;
    next.oom = engine.out_of_memory;
    next.exceptions = engine.exceptions;
    next.max_slice_us = block->owner_max_slice_us;
    next.loads = engine.source_loads;
    next.source_rejected = engine.source_rejections;
    {
        uint32_t ui_failures = __atomic_load_n(&block->ui_render_failures,
                                                __ATOMIC_ACQUIRE);
        next.publish_failed = engine.publish_failures > UINT32_MAX - ui_failures
            ? UINT32_MAX : engine.publish_failures + ui_failures;
    }
    next.wrong_thread = engine.wrong_thread;
    next.recoveries = resident.recoveries;
    next.recovery_failures = resident.recovery_failures;
    next.last_result = __atomic_load_n(&block->runtime_last_completion_result,
                                       __ATOMIC_ACQUIRE);
    next.last_event_sequence = __atomic_load_n(
        &block->runtime_last_completion_sequence, __ATOMIC_ACQUIRE);
    next.fatal = resident.permanently_disabled;
    next.queue_depth = terminal_completion != 0u ? 0u :
        __atomic_load_n(&block->rpc_event_pending, __ATOMIC_ACQUIRE);
    next.events_queued = __atomic_load_n(&block->runtime_events_queued,
                                         __ATOMIC_ACQUIRE);
    next.events_applied = __atomic_load_n(&block->runtime_events_applied,
                                          __ATOMIC_ACQUIRE);
    next.events_rejected = __atomic_load_n(&block->runtime_events_rejected,
                                           __ATOMIC_ACQUIRE);
    if (framer_resident_mailbox_try_read(&block->owner.mailbox, &mailbox)) {
        next.mailbox_sequence = mailbox.sequence;
        next.applied_generation = mailbox.admitted_revision;
        next.applied_revision = (uint32_t)mailbox.slots[0];
    }
    next.delays = block->owner_delays;
    next.screen = PHYSICAL_SCREEN_ID;
    next.visible = __atomic_load_n(&block->visible, __ATOMIC_ACQUIRE);
    next.replay_count = __atomic_load_n(&block->visibility.replay_pending,
                                        __ATOMIC_ACQUIRE);
    next.key_observations = key.observation_count;
    next.last_token = key.last_token;
    next.last_level = key.last_level;
    next.key_gate = key.committed;
    next.chord_active = engine.held_key_mask == 3u;
    next.weather_applied_revision = __atomic_load_n(
        &block->ui_applied_revision, __ATOMIC_ACQUIRE);
    sequence = __atomic_load_n(&block->runtime_telemetry_sequence,
                               __ATOMIC_RELAXED);
    if ((sequence & 1u) != 0u)
        ++sequence;
    __atomic_store_n(&block->runtime_telemetry_sequence, sequence + 1u,
                     __ATOMIC_SEQ_CST);
    block->runtime_telemetry = next;
    __atomic_thread_fence(__ATOMIC_RELEASE);
    __atomic_store_n(&block->runtime_telemetry_sequence, sequence + 2u,
                     __ATOMIC_RELEASE);
    __atomic_store_n(&block->runtime_telemetry_lock, 0u, __ATOMIC_RELEASE);
    return 1;
}



/* ── widget upload RPC (docs/16 wire protocol + docs/17 slot additions) ── */

static void widget_upload_append(char *output, size_t *offset,
                                 const char *text)
{
    size_t index = 0u;
    while (text[index] != '\0' && *offset + 1u < FRAMER_RUNTIME_RPC_VALUE_BYTES)
        output[(*offset)++] = text[index++];
}

static void widget_upload_append_hex32(char *output, size_t *offset,
                                       uint32_t value)
{
    static const char digits[] = "0123456789abcdef";
    int shift;
    for (shift = 28; shift >= 0; shift -= 4) {
        if (*offset + 1u >= FRAMER_RUNTIME_RPC_VALUE_BYTES)
            return;
        output[(*offset)++] = digits[(value >> (unsigned int)shift) & 15u];
    }
}

static int widget_persist_busy(const physical_block *block)
{
    uint32_t state = __atomic_load_n(&block->widget_persist_status,
                                     __ATOMIC_ACQUIRE) & 0xffu;
    return state != FRAMER_F2UP_PERSIST_IDLE &&
           state != FRAMER_F2UP_PERSIST_DONE &&
           state != FRAMER_F2UP_PERSIST_FAILED;
}

/* Only host.rpc ids the ADMITTED widget declared may be queued. */
static int widget_declared_host_rpc(const physical_block *block, uint32_t id)
{
    const framer_f2js_admission *admission = &block->owner.admission;
    uint32_t index;
    for (index = 0u; index < admission->event_count; ++index)
        if (admission->events[index].kind == 4u &&
            (uint32_t)admission->events[index].id == id)
            return 1;
    return 0;
}

static void widget_upload_reply(physical_block *block,
                                framer_runtime_rpc_context *context,
                                uint32_t op, uint32_t rc)
{
    char *output = context->value;
    size_t offset = 0u;
    widget_upload_append(output, &offset, "v1;op=");
    output[offset++] = (char)('0' + (op <= 9u ? op : 9u));
    widget_upload_append(output, &offset, ";rc=");
    widget_upload_append_hex32(output, &offset, rc);
    widget_upload_append(output, &offset, ";st=");
    output[offset++] = (char)('0' + (block->widget_upload.state & 3u));
    widget_upload_append(output, &offset, ";rx=");
    widget_upload_append_hex32(output, &offset,
                               block->widget_upload.received_bytes);
    widget_upload_append(output, &offset, ";g=");
    widget_upload_append_hex32(output, &offset,
                               block->widget_assets.generation);
    widget_upload_append(output, &offset, ";pg=");
    widget_upload_append_hex32(
        output, &offset,
        __atomic_load_n(&block->widget_persisted_generation,
                        __ATOMIC_ACQUIRE));
    widget_upload_append(output, &offset, ";ps=");
    widget_upload_append_hex32(
        output, &offset,
        __atomic_load_n(&block->widget_persist_status, __ATOMIC_ACQUIRE));
    widget_upload_append(output, &offset, ";ad=");
    widget_upload_append_hex32(output, &offset,
                               (uint32_t)block->widget_upload.admit_result);
    widget_upload_append(output, &offset, ";src=");
    output[offset++] = (char)('0' + (block->widget_assets.source & 1u));
    widget_upload_append(output, &offset, ";fb=");
    output[offset++] = (char)('0' + (block->widget_boot_fallback & 7u));
    widget_upload_append(output, &offset, ";sl=");
    output[offset++] = (char)('0' +
        (__atomic_load_n(&block->widget_active_slot, __ATOMIC_ACQUIRE) & 7u));
    widget_upload_append(output, &offset, ";sn=");
    output[offset++] = (char)('0' + (FRAMER_F2UP_SLOT_COUNT & 7u));
    output[offset] = '\0';
}

static void widget_inventory_reply(physical_block *block,
                                   framer_runtime_rpc_context *context,
                                   uint32_t slot, uint32_t rc)
{
    static const char digits[] = "0123456789abcdef";
    char *output = context->value;
    size_t offset = 0u;
    uint32_t index;
    widget_upload_append(output, &offset, "v1;op=5;rc=");
    widget_upload_append_hex32(output, &offset, rc);
    widget_upload_append(output, &offset, ";slot=");
    output[offset++] = (char)('0' + (slot & 7u));
    if (rc == 0u && slot < FRAMER_F2UP_SLOT_COUNT) {
        uint32_t generation = block->widget_slot_generations[slot];
        widget_upload_append(output, &offset, ";present=");
        output[offset++] = generation != 0u ? '1' : '0';
        widget_upload_append(output, &offset, ";g=");
        widget_upload_append_hex32(output, &offset, generation);
        widget_upload_append(output, &offset, ";sha=");
        for (index = 0u; index < 16u; ++index) {
            uint8_t byte = block->widget_slot_sha16[slot][index];
            output[offset++] = digits[byte >> 4];
            output[offset++] = digits[byte & 15u];
        }
    }
    output[offset] = '\0';
}

/* Per-screen lifecycle forensics (op 7): which proxy the stock actually
 * builds/cleans/ticks, plus active vs desired slot. */
/* The 113-byte RPC value field fits TWO slots of counters, so the reply is
 * paginated: base 0 emits b0/c0/t0/b1/c1/t1 (byte-compatible with the original
 * two-screen reply), base 2 emits b2/c2/t2/b3/c3/t3.  Field names always carry
 * the REAL slot index, so a parser needs no page context. */
static void widget_forensics_reply(physical_block *block,
                                   framer_runtime_rpc_context *context,
                                   uint32_t base)
{
    char *output = context->value;
    size_t offset = 0u;
    uint32_t resident = 0u;
    uint32_t slot;
    if (base > FRAMER_F2UP_SLOT_COUNT - 2u)
        base = FRAMER_F2UP_SLOT_COUNT - 2u;
    for (slot = 0u; slot < FRAMER_F2UP_SLOT_COUNT; ++slot)
        if (block->slot_resident[slot] != 0u)
            resident |= 1u << slot;
    widget_upload_append(output, &offset, "v1;op=7");
    for (slot = base; slot < base + 2u; ++slot) {
        char field[5];
        field[0] = ';'; field[2] = (char)('0' + slot); field[3] = '='; field[4] = 0;
        field[1] = 'b';
        widget_upload_append(output, &offset, field);
        widget_upload_append_hex32(output, &offset,
                                   block->proxy_build_counts[slot]);
        field[1] = 'c';
        widget_upload_append(output, &offset, field);
        widget_upload_append_hex32(output, &offset,
                                   block->proxy_cleanup_counts[slot]);
        field[1] = 't';
        widget_upload_append(output, &offset, field);
        widget_upload_append_hex32(output, &offset,
                                   block->proxy_tick_counts[slot]);
    }
    widget_upload_append(output, &offset, ";sl=");
    output[offset++] = (char)('0' +
        (__atomic_load_n(&block->widget_active_slot, __ATOMIC_ACQUIRE) & 7u));
    widget_upload_append(output, &offset, ";ds=");
    output[offset++] = (char)('0' +
        (__atomic_load_n(&block->widget_desired_slot, __ATOMIC_ACQUIRE) & 7u));
    widget_upload_append(output, &offset, ";r=");
    output[offset++] = (char)('0' + (resident & 7u));
    output[offset] = '\0';
}

static void rpc_upload_handler(framer_runtime_rpc_context *context,
                               void *response, void *request)
{
    physical_block *block = block_from_rpc(context, PHYSICAL_RPC_UPLOAD);
    __attribute__((aligned(16))) uint8_t root[64];
    int32_t op = -1;
    uint32_t rc = (uint32_t)FRAMER_F2UP_UPLOAD_ERR_ARGUMENT;
    int32_t inventory_slot = 9;
    if (!rpc_begin_ready(block, context, response, request))
        return;
    zero_bytes(root, sizeof(root));
    STOCK_ROOT_MAKE(root, request);
    if (!framer_physical_rpc_read_integer(root, "op", 2u, &op) || op < 0 ||
        op > 7) {
        op = 9;
    } else if (op != 0 && op != 5 && op != 7 && widget_persist_busy(block)) {
        /* The owner task is reading the staging arena; nothing may touch the
         * transaction until the machine reaches DONE or FAILED. */
        rc = (uint32_t)FRAMER_F2UP_UPLOAD_ERR_STATE;
    } else if (op == 0) {
        rc = 0u;
    } else if (op == 1) {
        int32_t generation = 0;
        int32_t total = 0;
        int32_t slot = 0;
        /* "slot" is optional: absent selects slot 0, exactly the pre-bank
         * wire behaviour, so older Designers keep working unchanged. */
        if (framer_physical_rpc_read_integer(root, "slot", 4u, &slot) &&
            (slot < 0 || slot >= (int32_t)FRAMER_F2UP_SLOT_COUNT))
            slot = -1;
        if (slot < 0 ||
            !framer_physical_rpc_read_integer(root, "generation", 10u,
                                              &generation) ||
            !framer_physical_rpc_read_integer(root, "totalBytes", 10u,
                                              &total)) {
            rc = (uint32_t)FRAMER_F2UP_UPLOAD_ERR_ARGUMENT;
        } else {
            block->widget_session_slot = (uint32_t)slot;
            if (block->widget_staging == (uint8_t *)0)
                rc = (uint32_t)FRAMER_F2UP_UPLOAD_ERR_ARGUMENT;
            else
                rc = (uint32_t)framer_f2up_upload_begin(
                    &block->widget_upload, (uint32_t)generation,
                    (uint32_t)total,
                    block->widget_slot_generations[block->widget_session_slot]);
        }
    } else if (op == 2) {
        int32_t chunk_offset = 0;
        const char *data = (const char *)0;
        uint32_t data_bytes = 0u;
        uint32_t decoded = 0u;
        if (!framer_physical_rpc_read_integer(root, "offset", 6u,
                                              &chunk_offset) ||
            !framer_physical_rpc_read_string(root, "data", 4u, &data,
                                             &data_bytes) ||
            data_bytes < 4u || data_bytes > 4096u) {
            rc = (uint32_t)FRAMER_F2UP_UPLOAD_ERR_ARGUMENT;
        } else if (block->widget_chunk_scratch == (uint8_t *)0 ||
                   !framer_f2up_base64_decode(
                       data, data_bytes, block->widget_chunk_scratch,
                       FRAMER_F2UP_CHUNK_RAW_BYTES, &decoded)) {
            rc = (uint32_t)FRAMER_F2UP_UPLOAD_ERR_ARGUMENT;
        } else {
            rc = (uint32_t)framer_f2up_upload_chunk(
                &block->widget_upload, (uint32_t)chunk_offset,
                block->widget_chunk_scratch, decoded);
        }
    } else if (op == 3) {
        rc = (uint32_t)framer_f2up_upload_commit(&block->widget_upload);
        if (rc == 0u) {
            block->widget_persist_base =
                framer_f2up_slot_base(block->widget_session_slot);
            block->widget_persist_total = block->widget_upload.total_bytes;
            block->widget_persist_pending_generation =
                block->widget_upload.admission.generation;
            block->widget_persist_cursor = 0u;
            block->widget_persist_since_ms = now_ms();
            __atomic_store_n(&block->widget_persist_status,
                             (uint32_t)FRAMER_F2UP_PERSIST_ARMED,
                             __ATOMIC_RELEASE);
        }
    } else if (op == 5) {
        int32_t slot = 0;
        if (!framer_physical_rpc_read_integer(root, "slot", 4u, &slot) ||
            slot < 0 || slot >= (int32_t)FRAMER_F2UP_SLOT_COUNT) {
            rc = (uint32_t)FRAMER_F2UP_UPLOAD_ERR_ARGUMENT;
        } else {
            rc = 0u;
            inventory_slot = slot;
        }
    } else if (op == 6) {
        int32_t slot = 0;
        if (!framer_physical_rpc_read_integer(root, "slot", 4u, &slot) ||
            slot < 0 || slot >= (int32_t)FRAMER_F2UP_SLOT_COUNT ||
            block->slot_resident[slot] == 0u) {
            rc = (uint32_t)FRAMER_F2UP_UPLOAD_ERR_ARGUMENT;
        } else {
            /* Level-triggered: the owner loop converges the live widget to
             * the desired slot; op 0 reports sl= once it lands. */
            __atomic_store_n(&block->widget_desired_slot, (uint32_t)slot,
                             __ATOMIC_RELEASE);
            rc = 0u;
        }
    } else if (op == 7) {
        int32_t slot = 0;
        if (framer_physical_rpc_read_integer(root, "slot", 4u, &slot) &&
            slot >= 0 && slot < (int32_t)FRAMER_F2UP_SLOT_COUNT)
            inventory_slot = slot;
        else
            inventory_slot = 0;
        rc = 0u;
    } else {
        framer_f2up_upload_abort(&block->widget_upload);
        rc = 0u;
    }
    STOCK_ROOT_DESTROY(root);
    if (op == 5)
        widget_inventory_reply(block, context, (uint32_t)inventory_slot, rc);
    else if (op == 7)
        widget_forensics_reply(block, context,
                               (uint32_t)(inventory_slot & ~1));
    else
        widget_upload_reply(block, context, (uint32_t)op, rc);
    STOCK_RPC_REPLY(response, request, 1u, context);
    framer_runtime_rpc_end(context);
}

static void rpc_upload_callback(void *callback, void *response, void *request)
{
    rpc_callback_common(callback, response, request, PHYSICAL_RPC_UPLOAD,
                        rpc_upload_handler);
}

static void owner_begin_focus_release(physical_block *block,
                                      uint32_t timestamp_ms)
{
    uint32_t requested = __atomic_load_n(&block->focus_release_requested,
                                         __ATOMIC_SEQ_CST);
    if (!framer_physical_focus_can_issue(
            requested,
            __atomic_load_n(&block->focus_release_applied, __ATOMIC_ACQUIRE),
            __atomic_load_n(&block->focus_release_draining, __ATOMIC_ACQUIRE),
            __atomic_load_n(&block->input_sink_inflight, __ATOMIC_SEQ_CST)))
        return;
    if (framer_mqjs_input_request_focus_release(&block->owner.runtime,
                                                timestamp_ms) ==
        FRAMER_MQJS_INPUT_RESYNC_QUEUED) {
        __atomic_store_n(&block->focus_release_draining, requested,
                         __ATOMIC_RELEASE);
        framer_resident_owner_notify_input(&block->owner,
                                           block->widget_assets.generation);
    }
}

static void owner_finish_focus_release(physical_block *block)
{
    framer_mqjs_telemetry telemetry;
    uint32_t draining = __atomic_load_n(&block->focus_release_draining,
                                        __ATOMIC_ACQUIRE);
    if (draining == 0u)
        return;
    zero_bytes(&telemetry, sizeof(telemetry));
    framer_mqjs_get_telemetry(&block->owner.runtime, &telemetry);
    if (!framer_physical_focus_can_ack(
            draining,
            __atomic_load_n(&block->owner.input_pending, __ATOMIC_ACQUIRE),
            telemetry.pending_input_events, telemetry.held_key_mask))
        return;
    /* A pre-hide hold/debounce timer belongs to the closed focus session.
     * Clear both the platform timer and the resident scheduling latch so a
     * later build cannot inherit a stale hidden-screen poll. */
    __atomic_store_n(&block->poll_armed, 0u, __ATOMIC_RELEASE);
    __atomic_store_n(&block->owner.input_poll_scheduled, 0u,
                     __ATOMIC_RELEASE);
    __atomic_store_n(&block->focus_release_applied, draining,
                     __ATOMIC_RELEASE);
    __atomic_store_n(&block->focus_release_draining, 0u, __ATOMIC_RELEASE);
    if (__atomic_load_n(&block->visible, __ATOMIC_ACQUIRE) != 0u &&
        __atomic_load_n(&block->focus_release_requested,
                        __ATOMIC_ACQUIRE) == draining) {
        __atomic_store_n(&block->focus_reopen_pending, 0u, __ATOMIC_RELEASE);
        __atomic_store_n(&block->input_enabled, 1u, __ATOMIC_RELEASE);
    }
}



/* The complete widget boot: engine heap, adopted-widget preflight with baked
 * fallback, LZSS + facade preflight, resident owner boot.  Returns 0 on
 * success, else the boot_state code of the failing stage (11 heap, 5 lzss,
 * 6 facade, 3 resident boot).  Runs at owner-task start and again on every
 * slot activation (after quiesce + stop + reinit_shell). */
static uint32_t owner_boot_widget(physical_block *block)
{
    uint32_t package_bytes;
    uint32_t compressed_bytes;
    uint32_t target_bytes;
    framer_f2js_result boot;
    framer_tf_result target_preflight;
    package_bytes = block->widget_assets.f2js_bytes;
    compressed_bytes = block->widget_assets.lzss_bytes;
    target_bytes = block->widget_assets.f2tf_bytes;
    block->widget_boot_fallback = 0u;
    block->boot_started_ms = now_ms();
    __atomic_store_n(&block->boot_state, 1u, __ATOMIC_RELEASE);
    if (!psram_heap_acquire(block)) {
        block->boot_finished_ms = now_ms();
        return 11u;
    }
    /* An ADOPTED widget is fully pre-flighted here - LZSS, facade admit under
     * ITS OWN generation, and the pure F2JS validator - because
     * framer_resident_owner_boot_on_task faults the capability on failure and
     * is not retryable.  Any slot failure reverts to the baked assets before a
     * non-retryable gate is crossed, and records which stage failed. */
    if (block->widget_assets.source == 1u) {
        uint32_t failed_stage = 0u;
        if (!decode_lzss(block->vm_heap, PHYSICAL_FRAME_BYTES,
                         block->widget_assets.lzss,
                         block->widget_assets.lzss_bytes)) {
            failed_stage = 5u;
        } else if (framer_tf_admit(
                       &block->target, block->widget_assets.f2tf,
                       block->widget_assets.f2tf_bytes,
                       (const uint16_t *)(const void *)block->vm_heap,
                       FRAMER_TF_CANVAS_PIXELS,
                       block->widget_assets.generation,
                       block->widget_assets.f2js_sha256,
                       framer_physical_target_contract_sha256,
                       current_task_token()) != FRAMER_TF_OK) {
            failed_stage = 6u;
        } else if (framer_f2js_admit(block->widget_assets.f2js,
                                     (size_t)block->widget_assets.f2js_bytes,
                                     &block->owner.admission) !=
                   FRAMER_F2JS_ADMIT_OK) {
            failed_stage = 3u;
        }
        zero_bytes(&block->target, sizeof(block->target));
        zero_bytes(block->vm_heap, (size_t)FRAMER_F2JS_HEAP_BYTES);
        if (failed_stage != 0u) {
            block->widget_boot_fallback = failed_stage;
            widget_assets_set_baked(block);
        }
        package_bytes = block->widget_assets.f2js_bytes;
        compressed_bytes = block->widget_assets.lzss_bytes;
        target_bytes = block->widget_assets.f2tf_bytes;
    }
    if (!decode_lzss(block->vm_heap, PHYSICAL_FRAME_BYTES,
                     block->widget_assets.lzss, compressed_bytes)) {
        block->boot_finished_ms = now_ms();
        return 5u;
    }
    target_preflight = framer_tf_admit(
        &block->target, block->widget_assets.f2tf, target_bytes,
        (const uint16_t *)(const void *)block->vm_heap,
        FRAMER_TF_CANVAS_PIXELS, block->widget_assets.generation,
        block->widget_assets.f2js_sha256,
        framer_physical_target_contract_sha256, current_task_token());
    zero_bytes(&block->target, sizeof(block->target));
    zero_bytes(block->vm_heap, (size_t)FRAMER_F2JS_HEAP_BYTES);
    if (target_preflight != FRAMER_TF_OK) {
        block->boot_finished_ms = now_ms();
        return 6u;
    }
    boot = framer_resident_owner_boot_on_task(
        &block->owner, block->widget_assets.f2js, package_bytes);
    block->boot_finished_ms = now_ms();
    if (boot != FRAMER_F2JS_ADMIT_OK) {
        __atomic_store_n(&block->sources_enabled, 0u, __ATOMIC_RELEASE);
        return 3u;
    }
    return 0u;
}

static void owner_task(void *opaque)
{
    physical_block *block = (physical_block *)opaque;
    if (block == (physical_block *)0 || block->magic != PHYSICAL_MAGIC)
        for (;;)
            STOCK_TASK_DELAY(1u);
    {
        uint32_t boot_failed = owner_boot_widget(block);
        if (boot_failed == 11u || boot_failed == 5u || boot_failed == 6u) {
            __atomic_store_n(&block->boot_state, boot_failed, __ATOMIC_RELEASE);
            for (;;)
                STOCK_TASK_DELAY(1u);
        }
        __atomic_store_n(&block->boot_state, boot_failed == 0u ? 2u : 3u,
                         __ATOMIC_RELEASE);
    }
    for (;;) {
        uint32_t milliseconds = now_ms();
        uint32_t tick100 = milliseconds / 100u;
        uint32_t seconds = milliseconds / 1000u;
        uint32_t generation = block->widget_assets.generation;
        /* Converge the LIVE widget to the desired slot: set by op 6 and by a
         * screen change (docs/18 §4.2).  The whole switch runs here, on the
         * owner task, so the VM is never re-entered from another context. */
        {
            uint32_t desired = __atomic_load_n(&block->widget_desired_slot,
                                               __ATOMIC_ACQUIRE);
            if (desired < FRAMER_F2UP_SLOT_COUNT &&
                block->slot_resident[desired] != 0u &&
                __atomic_load_n(&block->widget_active_slot,
                                __ATOMIC_ACQUIRE) != desired) {
                uint32_t attempts;
                uint32_t boot_failed;
                uint32_t previous = __atomic_load_n(&block->widget_active_slot,
                                                    __ATOMIC_ACQUIRE);
                __atomic_store_n(&block->widget_switching, 1u,
                                 __ATOMIC_RELEASE);
                (void)framer_resident_owner_begin_quiesce(
                    &block->owner, milliseconds,
                    FRAMER_MQJS_INPUT_REASON_DISCONNECT);
                for (attempts = 0u;
                     attempts < 1000u &&
                     !framer_resident_owner_stop_on_task(&block->owner);
                     ++attempts)
                    STOCK_TASK_DELAY(1u);
                if (widget_slot_adopt_from(block, desired) != 0) {
                    if (widget_slot_adopt_from(block, previous) != 0)
                        widget_assets_set_baked(block);
                    __atomic_store_n(&block->widget_desired_slot,
                                     __atomic_load_n(&block->widget_active_slot,
                                                     __ATOMIC_ACQUIRE),
                                     __ATOMIC_RELEASE);
                }
                framer_resident_owner_reinit_shell(&block->owner, &engine_api,
                                                   &block->owner_platform);
                (void)framer_resident_owner_mark_module_mapped(&block->owner);
                boot_failed = owner_boot_widget(block);
                __atomic_store_n(&block->boot_state,
                                 boot_failed == 0u ? 7u : boot_failed,
                                 __ATOMIC_RELEASE);
                zero_bytes(&block->target, sizeof(block->target));
                block->target_admitted = 0u;
                __atomic_store_n(&block->widget_switching, 0u,
                                 __ATOMIC_RELEASE);
                generation = block->widget_assets.generation;
            }
        }
        /* HIDE by tick silence (docs/18 §4.2: tick is the ONLY visibility
         * signal).  Mirrors the bookkeeping proxy_cleanup used to do, in the
         * same order: close both producer gates, then publish the release. */
        if (__atomic_load_n(&block->visible, __ATOMIC_ACQUIRE) != 0u) {
            /* Fresh clock + SIGNED delta: `milliseconds` from the loop top is
             * stale after a multi-hundred-ms slot switch, and an unsigned
             * delta against a tick timestamp taken DURING the switch wraps
             * huge — firing a spurious hide/show pulse after every switch. */
            uint32_t now_hide = now_ms();
            if ((int32_t)(now_hide -
                          __atomic_load_n(&block->visible_tick_ms,
                                          __ATOMIC_RELAXED)) >
                (int32_t)FRAMER_PHYSICAL_HIDE_SILENCE_MS) {
                __atomic_store_n(&block->visible, 0u, __ATOMIC_SEQ_CST);
                __atomic_store_n(&block->input_enabled, 0u, __ATOMIC_SEQ_CST);
                __atomic_store_n(&block->poll_armed, 0u, __ATOMIC_RELEASE);
                __atomic_add_fetch(&block->focus_release_requested, 1u,
                                   __ATOMIC_SEQ_CST);
                (void)framer_runtime_visibility_set(&block->visibility, 0);
                block->hidden_at_ms = now_hide;
                (void)framer_resident_owner_enqueue_host_rpc(
                    &block->owner, generation, 0xb24eu, 0, 0);
            }
        }
        owner_begin_focus_release(block, milliseconds);
        /* WPM window maintenance runs UNGATED (the ring must stay fresh even
         * while no widget screen is fronted): zero every bucket the clock
         * skipped past since the last visit, then snapshot the 60 s sums. */
        {
            uint32_t second = seconds % 60u;
            uint32_t last = block->wpm_ring_second;
            if (second != last) {
                uint32_t cursor = last;
                uint32_t sum = 0u;
                uint32_t index;
                do {
                    cursor = (cursor + 1u) % 60u;
                    block->wpm_counts[cursor] = 0u;
                } while (cursor != second);
                block->wpm_ring_second = second;
                for (index = 0u; index < 60u; ++index)
                    sum += block->wpm_counts[index];
                __atomic_store_n(&block->wpm_keys_60s, sum, __ATOMIC_RELAXED);
                __atomic_store_n(&block->wpm_value, sum / 5u,
                                 __ATOMIC_RELAXED);
            }
        }
        if (__atomic_load_n(&block->sources_enabled, __ATOMIC_ACQUIRE) != 0u &&
            __atomic_load_n(&block->visible, __ATOMIC_ACQUIRE) != 0u) {
            if (tick100 != block->last_tick100) {
                block->last_tick100 = tick100;
                (void)framer_resident_owner_enqueue(&block->owner, generation,
                                                    "tick.100ms", 0, 0);
            }
            if (seconds != block->last_second) {
                block->last_second = seconds;
                (void)framer_resident_owner_enqueue(&block->owner, generation,
                                                    "tick.1s", 0, 0);
                /* Built-in device feeds, published at 1 Hz to the ACTIVE
                 * widget.  The engine admits an id only when the widget's
                 * package declared a handler for it, so widgets that never
                 * asked hear nothing.  0xB2F2 = typing speed from the raw
                 * key hook: value = words/minute (chars/5), auxiliary = raw
                 * key-down count over the last 60 s. */
                (void)framer_resident_owner_enqueue_host_rpc(
                    &block->owner, generation, 0xb2f2u,
                    (int32_t)__atomic_load_n(&block->wpm_value,
                                             __ATOMIC_RELAXED),
                    (int32_t)__atomic_load_n(&block->wpm_keys_60s,
                                             __ATOMIC_RELAXED));
            }
        }
        if (__atomic_load_n(&block->visible, __ATOMIC_ACQUIRE) != 0u &&
            __atomic_load_n(&block->input_enabled, __ATOMIC_ACQUIRE) != 0u &&
            __atomic_load_n(&block->poll_armed, __ATOMIC_ACQUIRE) != 0u &&
            (int32_t)(milliseconds - __atomic_load_n(&block->poll_due_ms,
                                                      __ATOMIC_RELAXED)) >= 0) {
            __atomic_store_n(&block->poll_armed, 0u, __ATOMIC_RELEASE);
            framer_resident_owner_input_poll_due(&block->owner, generation);
        }
        {
            uint64_t slice_started = STOCK_TIME_US();
            uint32_t slice_us;
            uint32_t completion_published;
            (void)framer_resident_owner_step(&block->owner);
            completion_published = (uint32_t)consume_tagged_completion(block);
            owner_finish_focus_release(block);
            if (framer_physical_claim_fatal_retirement(
                    &block->fatal_sources_retired,
                    __atomic_load_n(
                        &block->owner.telemetry.permanently_disabled,
                        __ATOMIC_ACQUIRE))) {
                (void)platform_remove_events(block, generation);
                (void)platform_remove_input(block, generation);
                (void)platform_cancel_poll(block, generation);
            }
            if (framer_physical_periodic_refresh_due(
                    completion_published,
                    (uint32_t)(milliseconds - block->last_telemetry_ms))) {
                if (refresh_runtime_telemetry(block, 0u))
                    block->last_telemetry_ms = milliseconds;
            } else if (completion_published != 0u) {
                block->last_telemetry_ms = milliseconds;
            }
            slice_us = (uint32_t)(STOCK_TIME_US() - slice_started);
            if (slice_us > block->owner_max_slice_us)
                block->owner_max_slice_us = slice_us;
        }
        /* Outside the measured VM slice: one bounded flash step per iteration. */
        scene_persist_step(block);
        widget_persist_step(block);
        STOCK_TASK_DELAY(1u);
        block->owner_delays += 1u;
    }
}

static int sidecar_old_tick(void *backend, void (**old_tick)(void *))
{
    void **vtable;
    uint8_t *sidecar;
    if (backend == (void *)0 || old_tick == (void (**)(void *))0)
        return 0;
    vtable = *(void ***)backend;
    if (vtable == (void **)0 || vtable[11] == (void *)0)
        return 0;
    sidecar = (uint8_t *)vtable[11];
    if (*(const uint32_t *)sidecar != 0x32565343u)
        return 0;
    *old_tick = *(void (**)(void *))(void *)(sidecar + 4u);
    return *old_tick != (void (*)(void *))0;
}



static void proxy_build(physical_proxy *proxy)
{
    uint32_t elapsed = 0u;
    if (proxy == (physical_proxy *)0 || proxy->magic != PHYSICAL_PROXY_MAGIC ||
        proxy->block == (physical_block *)0 ||
        !framer_physical_lifecycle_root_ready(proxy->root))
        return;
    if (proxy->screen_slot < FRAMER_F2UP_SLOT_COUNT)
        __atomic_add_fetch(&proxy->block->proxy_build_counts[proxy->screen_slot],
                           1u, __ATOMIC_RELAXED);
    proxy->source_published = 0u;
    proxy->image = STOCK_IMAGE_CREATE(proxy->root);
    (void)elapsed;
    /* NO visibility/focus bookkeeping here: build fires for NEIGHBOR
     * pre-builds too (docs/18 §4.2).  Show runs on the first proxy_tick. */
}

static void proxy_cleanup(physical_proxy *proxy)
{
    if (proxy == (physical_proxy *)0 || proxy->magic != PHYSICAL_PROXY_MAGIC ||
        proxy->block == (physical_block *)0)
        return;
    /* Close both producer gates before publishing the owner-thread release
     * request. A wrapper that already crossed the gate is counted and must
     * retire before owner_begin_focus_release snapshots the raw held bitmap. */
    if (proxy->screen_slot < FRAMER_F2UP_SLOT_COUNT)
        __atomic_add_fetch(&proxy->block->proxy_cleanup_counts[proxy->screen_slot],
                           1u, __ATOMIC_RELAXED);
    /* NO hide bookkeeping here: cleanup fires for screens leaving the
     * pre-build NEIGHBORHOOD while another widget screen stays fronted
     * (docs/18 §4.2) — zeroing `visible` here silenced the owner tick gate
     * for the fronted widget.  Hide runs on the owner task after tick
     * silence (see owner_task). */
    proxy->image = (void *)0;
    proxy->source_published = 0u;
}


__attribute__((used, visibility("default")))
uint32_t framer_physical_weather_id(physical_proxy *proxy)
{
    /* ONE WIDGET = ONE SCREEN: screen id 28 + slot, so each widget slot is a
     * distinct screen in the stock registry and navigation. */
    if (proxy == (physical_proxy *)0 || proxy->magic != PHYSICAL_PROXY_MAGIC)
        return PHYSICAL_SCREEN_ID;
    return PHYSICAL_SCREEN_ID + proxy->screen_slot;
}

static void proxy_tick(physical_proxy *proxy)
{
    physical_block *block;
    uint8_t *framebuffer;
    void (*old_tick)(void *);
    framer_tf_result result = FRAMER_TF_OK;
    uint64_t started;
    if (proxy == (physical_proxy *)0 || proxy->magic != PHYSICAL_PROXY_MAGIC ||
        proxy->block == (physical_block *)0 || proxy->backend == (void *)0 ||
        proxy->image == (void *)0 || !sidecar_old_tick(proxy->backend, &old_tick))
        return;
    block = proxy->block;
    if (proxy->screen_slot < FRAMER_F2UP_SLOT_COUNT)
        __atomic_add_fetch(&block->proxy_tick_counts[proxy->screen_slot], 1u,
                           __ATOMIC_RELAXED);
    started = STOCK_TIME_US();
    /* Visibility is the TICK (docs/18 §4.2): the stock host ticks exactly the
     * one visible controller.  EDGE-triggered, so the steady-state ticks of a
     * visible screen can never veto an RPC activation. */
    {
        uint32_t screen_slot = proxy->screen_slot;
        uint32_t milliseconds = now_ms();
        __atomic_store_n(&block->visible_tick_ms, milliseconds,
                         __ATOMIC_RELAXED);
        if (__atomic_load_n(&block->widget_switching, __ATOMIC_ACQUIRE) == 0u &&
            __atomic_load_n(&block->visible, __ATOMIC_ACQUIRE) == 0u) {
            /* Deferred while switching: enqueueing into the owner mid-
             * reinit_shell would write into memory being zeroed.  The next
             * tick after the switch completes runs the show. */
            /* SHOW — the bookkeeping that used to live in proxy_build, moved
             * to the tick edge because build also fires for neighbor
             * pre-builds (docs/18 §4.2) and therefore cannot own `visible`. */
            uint32_t elapsed = 0u;
            if (block->hidden_at_ms != 0u) {
                elapsed = (milliseconds - block->hidden_at_ms) / 1000u;
                if (elapsed > 604800u)
                    elapsed = 604800u;
            }
            block->hidden_at_ms = 0u;
            __atomic_store_n(&block->visible, 1u, __ATOMIC_SEQ_CST);
            if (framer_physical_focus_can_reopen(
                    1u,
                    __atomic_load_n(&block->focus_release_requested,
                                    __ATOMIC_ACQUIRE),
                    __atomic_load_n(&block->focus_release_applied,
                                    __ATOMIC_ACQUIRE),
                    __atomic_load_n(&block->focus_release_draining,
                                    __ATOMIC_ACQUIRE),
                    __atomic_load_n(
                        &block->owner.telemetry.permanently_disabled,
                        __ATOMIC_ACQUIRE))) {
                __atomic_store_n(&block->focus_reopen_pending, 0u,
                                 __ATOMIC_RELEASE);
                __atomic_store_n(&block->input_enabled, 1u, __ATOMIC_RELEASE);
            } else {
                __atomic_store_n(&block->focus_reopen_pending, 1u,
                                 __ATOMIC_RELEASE);
                __atomic_store_n(&block->input_enabled, 0u, __ATOMIC_RELEASE);
            }
            (void)framer_runtime_visibility_set(&block->visibility, 1);
            (void)framer_resident_owner_enqueue_host_rpc(
                &block->owner, block->widget_assets.generation, 0xb24eu, 1,
                (int32_t)elapsed);
        }
        if (screen_slot < FRAMER_F2UP_SLOT_COUNT &&
            __atomic_load_n(&block->visible_screen_slot, __ATOMIC_ACQUIRE) !=
                screen_slot) {
            __atomic_store_n(&block->visible_screen_slot, screen_slot,
                             __ATOMIC_RELEASE);
            if (block->slot_resident[screen_slot] != 0u)
                __atomic_store_n(&block->widget_desired_slot, screen_slot,
                                 __ATOMIC_RELEASE);
        }
    }
    /* A switch is swapping widget_assets on the owner task.  The stock per-tick
     * TAIL must still run EVERY visible frame (docs/18 §4.3) — skipping it
     * starved the renderer and crashed the device. */
    if (__atomic_load_n(&block->widget_switching, __ATOMIC_ACQUIRE) != 0u) {
        old_tick(proxy->backend);
        goto measured_exit;
    }
    {
        uint32_t screen_slot = proxy->screen_slot;
        const physical_widget_assets *assets = &block->widget_assets;
        framer_tf_context *target = &block->target;
        uint8_t *admitted = &block->target_admitted;
        const framer_tf_mailbox *mailbox =
            (const framer_tf_mailbox *)(const void *)&block->owner.mailbox;
        framer_tf_mailbox idle_mailbox;
        uint32_t active = __atomic_load_n(&block->widget_active_slot,
                                          __ATOMIC_ACQUIRE);
        /* THIS screen renders ITS OWN slot's widget from ITS OWN resident
         * assets and facade context.  Only the ACTIVE slot is driven by the
         * live VM mailbox; every other screen renders its widget's authored
         * default state, so a screen never shows another screen's widget. */
        if (screen_slot < FRAMER_F2UP_SLOT_COUNT &&
            block->slot_resident[screen_slot] != 0u) {
            assets = &block->slot_assets[screen_slot];
            target = &block->slot_target[screen_slot];
            admitted = &block->slot_target_admitted[screen_slot];
            if (screen_slot != active) {
                uint32_t index;
                zero_bytes(&idle_mailbox, sizeof(idle_mailbox));
                idle_mailbox.sequence = 2u;
                idle_mailbox.admitted_generation = assets->generation;
                idle_mailbox.slots[0] = 1;
                for (index = 1u; index < FRAMER_TF_MAILBOX_SLOTS; ++index)
                    idle_mailbox.slots[index] = 0;
                /* Rewound so the overlay re-applies over the base frame this
                 * tick re-decodes. */
                target->last_applied_revision = 0u;
                mailbox = &idle_mailbox;
            }
        }
        old_tick(proxy->backend);
        framebuffer = (uint8_t *)proxy->backend + 160u;
        if (!decode_lzss(framebuffer, PHYSICAL_FRAME_BYTES, assets->lzss,
                         assets->lzss_bytes)) {
            __atomic_add_fetch(&block->ui_render_failures, 1u,
                               __ATOMIC_RELAXED);
            goto measured_exit;
        }
        if (*admitted == 0u) {
            result = framer_tf_admit(
                target, assets->f2tf, assets->f2tf_bytes,
                (const uint16_t *)(const void *)framebuffer,
                FRAMER_TF_CANVAS_PIXELS, assets->generation,
                assets->f2js_sha256, framer_physical_target_contract_sha256,
                current_task_token());
            if (result != FRAMER_TF_OK) {
                __atomic_add_fetch(&block->ui_render_failures, 1u,
                                   __ATOMIC_RELAXED);
                goto measured_exit;
            }
            *admitted = 1u;
        }
        result = framer_tf_render(
            target, mailbox, (uint16_t *)(void *)framebuffer,
            FRAMER_TF_CANVAS_PIXELS, current_task_token(),
            &block->target_metrics);
        if (result == FRAMER_TF_OK || result == FRAMER_TF_HIDDEN) {
            /* The present is mandatory per-tick work for a live screen. */
            proxy->descriptor_flip ^= 1u;
            STOCK_IMAGE_SET_SOURCE(
                proxy->image,
                &proxy->descriptor[proxy->descriptor_flip & 1u]);
            if (proxy->source_published == 0u) {
                STOCK_OBJECT_ALIGN(proxy->image, 9, 0, 0);
                proxy->source_published = 1u;
            }
        }
        if (result == FRAMER_TF_OK && screen_slot == active) {
            framer_runtime_visibility_publish(
                &block->visibility, assets->generation,
                block->target_metrics.applied_revision);
            __atomic_store_n(&block->ui_applied_revision,
                             block->target_metrics.applied_revision,
                             __ATOMIC_RELEASE);
        } else if (result != FRAMER_TF_OK && result != FRAMER_TF_HIDDEN) {
            __atomic_add_fetch(&block->ui_render_failures, 1u,
                               __ATOMIC_RELAXED);
        }
    }
measured_exit:
    {
        uint64_t elapsed64 = STOCK_TIME_US() - started;
        uint32_t elapsed = elapsed64 > UINT32_MAX ? UINT32_MAX :
                           (uint32_t)elapsed64;
        uint32_t maximum = __atomic_load_n(&block->ui_max_tick_us,
                                            __ATOMIC_RELAXED);
        while (elapsed > maximum &&
               !__atomic_compare_exchange_n(&block->ui_max_tick_us,
                                            &maximum, elapsed, 0,
                                            __ATOMIC_RELEASE,
                                            __ATOMIC_RELAXED)) {
        }
    }
}

static void proxy_encoder(physical_proxy *proxy, uint32_t encoder,
                          uint32_t raw_delta)
{
    void *input;
    int intercepted = 0;
    int32_t delta = signed_delta(raw_delta);
    if (proxy == (physical_proxy *)0 || proxy->magic != PHYSICAL_PROXY_MAGIC ||
        proxy->block == (physical_block *)0 || proxy->backend == (void *)0)
        return;
    __atomic_add_fetch(&proxy->block->input_sink_inflight, 1u,
                       __ATOMIC_SEQ_CST);
    input = STOCK_INPUT_GET();
    if (encoder == 1u && delta != 0 && input != (void *)0 &&
        framer_physical_focus_accepts_key(
            __atomic_load_n(&proxy->block->visible, __ATOMIC_SEQ_CST),
            __atomic_load_n(&proxy->block->input_enabled,
                            __ATOMIC_ACQUIRE)) &&
        STOCK_FN_PRESSED(input) != 0) {
        (void)framer_resident_owner_enqueue(
            &proxy->block->owner, proxy->block->widget_assets.generation,
            "input.fn-bottom-knob", delta, (int32_t)encoder);
        intercepted = 1;
    }
    __atomic_sub_fetch(&proxy->block->input_sink_inflight, 1u,
                       __ATOMIC_SEQ_CST);
    if (intercepted)
        return;
    /* Exact renderer-v1 backend encoder slot; never call it on the proxy. */
    {
        void **vtable = *(void ***)proxy->backend;
        if (vtable != (void **)0 && vtable[9] != (void *)0)
            ((void (*)(void *, uint32_t, uint32_t))vtable[9])(
                proxy->backend, encoder, raw_delta);
    }
}

__attribute__((used, visibility("default")))
void framer_physical_key_after_stock(void *controller, uint32_t native_token,
                                     uint8_t level)
{
    physical_proxy *proxy = (physical_proxy *)controller;
    physical_block *block;
    uint32_t logical_token;
    if (proxy == (physical_proxy *)0 || proxy->magic != PHYSICAL_PROXY_MAGIC ||
        proxy->block == (physical_block *)0)
        return;
    block = proxy->block;
    if (block->magic != PHYSICAL_MAGIC ||
        block->generation != PHYSICAL_GENERATION)
        return;
    __atomic_add_fetch(&block->input_sink_inflight, 1u, __ATOMIC_SEQ_CST);
    /* WPM counting happens before every gate: it measures the user's typing
     * on EVERY screen, not just while a widget is fronted. Down edges only. */
    if (level != 0u) {
        uint32_t second = (now_ms() / 1000u) % 60u;
        if (second < 60u)
            block->wpm_counts[second] =
                block->wpm_counts[second] == 255u
                    ? 255u : (uint8_t)(block->wpm_counts[second] + 1u);
    }
    if (!framer_physical_focus_accepts_key(
            __atomic_load_n(&block->visible, __ATOMIC_SEQ_CST),
            __atomic_load_n(&block->input_enabled, __ATOMIC_ACQUIRE)))
        goto finished;
    block->last_raw_token = native_token;
    block->last_raw_level = level;
    /* Telemetry only — the probe's Space/LeftShift bits still feed diag p5. */
    framer_runtime_key_probe_observe(&block->key_probe, native_token, level);
    /* No JS edge is emitted during discovery: the FIRST full down+up cycle of
     * one token proves the stream is live and is itself consumed.  Every
     * edge after proof forwards its native token; the engine admits only the
     * tokens the widget's package declared. */
    if (__atomic_load_n(&block->key_stream_proven, __ATOMIC_ACQUIRE) == 0u) {
        if (level != 0u) {
            block->key_cycle_down_token = native_token;
            block->key_cycle_down_seen = 1u;
        } else if (block->key_cycle_down_seen != 0u &&
                   block->key_cycle_down_token == native_token) {
            __atomic_store_n(&block->key_stream_proven, 1u, __ATOMIC_RELEASE);
        }
        goto finished;
    }
    /* Deliver to the widget's DECLARED token first.  When the widget never
     * declared this key the engine answers NO_HANDLER (1) and nothing was
     * enqueued — so re-deliver under the reserved ANY-KEY token.  A widget
     * that declares "any" (HID 0x01, ErrorRollOver: never a real key press)
     * therefore receives EVERY key the keyboard has, including keys past the
     * engine's 16-token table, while a widget that declared specific keys is
     * unaffected.  Down/up/hold all flow through this one path, so holding
     * an undeclared letter repeats exactly like a declared key. */
    logical_token = native_token;
    if (framer_resident_owner_input_after_stock(
            &block->owner, block->widget_assets.generation, logical_token,
            level != 0u, now_ms()) == FRAMER_MQJS_NO_HANDLER &&
        native_token != FRAMER_PHYSICAL_ANY_KEY_TOKEN)
        (void)framer_resident_owner_input_after_stock(
            &block->owner, block->widget_assets.generation,
            FRAMER_PHYSICAL_ANY_KEY_TOKEN, level != 0u, now_ms());
finished:
    __atomic_sub_fetch(&block->input_sink_inflight, 1u, __ATOMIC_SEQ_CST);
}


/* Make ONE slot resident: its container is copied into its OWN PSRAM arena,
 * re-admitted there (the renderer only ever sees the copy — the scene-adopt
 * lesson), and recorded in slot_assets[slot].  Resident slots can be rendered
 * by their own screen INDEPENDENTLY of which widget the VM is currently
 * running, which is what makes one-widget-per-screen possible.  Best effort:
 * a slot that cannot be made resident simply has no screen of its own.
 * Setup-task only, before the owner task and any proxy exist. */
static int widget_slot_make_resident(physical_block *block, uint32_t slot)
{
    const uint32_t caps = PHYSICAL_CAP_SPIRAM | PHYSICAL_CAP_8BIT;
    void *mapped = (void *)0;
    void *arena_raw = (void *)0;
    uint8_t *arena;
    framer_f2up_admission admission;
    int32_t detail = 0;
    uint32_t index;
    int result = 1;
    if (block == (physical_block *)0 || slot >= FRAMER_F2UP_SLOT_COUNT)
        return 1;
    block->slot_resident[slot] = 0u;
    if (STOCK_HEAP_FREE_SIZE(PHYSICAL_CAP_INTERNAL | PHYSICAL_CAP_8BIT) <
        (size_t)SCENE_MAP_RESERVE_BYTES)
        return 1;
    if (!widget_slot_window_map(slot, &mapped))
        return 1;
    if (framer_f2up_adopt_decide((const uint8_t *)mapped,
                                 FRAMER_F2UP_SLOT_BYTES, 0u, &admission,
                                 &detail) != FRAMER_F2UP_ADOPT_OK)
        goto finished;
    /* Hard PSRAM reserve: the VM heap must ALWAYS be claimable after the
     * arenas, or a resident screen would cost us the running widget. */
    if (STOCK_HEAP_FREE_SIZE(caps) <
        (size_t)FRAMER_F2UP_MAX_BYTES + (size_t)PHYSICAL_HEAP_ALIGN_SLACK +
            (size_t)PHYSICAL_PSRAM_RESERVE_BYTES)
        goto finished;
    arena = widget_buffer_acquire(&arena_raw, 0u);
    if (arena == (uint8_t *)0)
        goto finished;
    scene_copy(arena, (const uint8_t *)mapped, admission.total_bytes);
    if (framer_f2up_admit(arena, (size_t)admission.total_bytes, &admission) !=
        FRAMER_F2UP_OK) {
        STOCK_HEAP_FREE(arena_raw);
        goto finished;
    }
    for (index = 0u; index < 32u; ++index)
        block->slot_sha[slot][index] = admission.f2js_sha256[index];
    block->slot_arena_raw[slot] = arena_raw;
    block->slot_assets[slot].f2js = arena + admission.f2js_offset;
    block->slot_assets[slot].f2js_bytes = admission.f2js_bytes;
    block->slot_assets[slot].f2tf = arena + admission.f2tf_offset;
    block->slot_assets[slot].f2tf_bytes = admission.f2tf_bytes;
    block->slot_assets[slot].lzss = arena + admission.lzss_offset;
    block->slot_assets[slot].lzss_bytes = admission.lzss_bytes;
    block->slot_assets[slot].f2js_sha256 = block->slot_sha[slot];
    block->slot_assets[slot].generation = admission.generation;
    block->slot_assets[slot].source = 1u;
    block->slot_assets[slot].adopt_detail = detail;
    block->slot_resident[slot] = 1u;
    result = 0;
finished:
    if (mapped != (void *)0)
        (void)STOCK_MMU_UNMAP(mapped);
    return result;
}

/* Point the VM's asset set at a RESIDENT slot.  No copy and no flash access:
 * the bytes were staged at setup, so a switch is a pointer swap plus the VM
 * re-boot the caller performs.  Fails (leaving the running widget untouched)
 * for any slot that is not resident. */
static int widget_slot_adopt_from(physical_block *block, uint32_t slot)
{
    if (block == (physical_block *)0 || slot >= FRAMER_F2UP_SLOT_COUNT ||
        block->slot_resident[slot] == 0u)
        return 1;
    block->widget_assets = block->slot_assets[slot];
    __atomic_store_n(&block->widget_active_slot, slot, __ATOMIC_RELEASE);
    return 0;
}

static void widget_slot_adopt(physical_block *block)
{
    uint32_t slot;
    uint32_t best_slot = FRAMER_F2UP_SLOT_COUNT;
    uint32_t best_generation = 0u;
    physical_widget_assets *assets;
    if (block == (physical_block *)0)
        return;
    assets = &block->widget_assets;
    widget_assets_set_baked(block);
    assets->adopt_detail = 0;
    block->widget_active_slot = 0u;
    block->visible_screen_slot = 0u;
    block->visible_tick_ms = 0u;
    widget_slot_scan(block);
    /* Stage EVERY occupied slot into its own arena first: each resident slot
     * earns its own keyboard screen below. */
    for (slot = 0u; slot < FRAMER_F2UP_SLOT_COUNT; ++slot)
        if (block->widget_slot_generations[slot] != 0u)
            (void)widget_slot_make_resident(block, slot);
    for (slot = 0u; slot < FRAMER_F2UP_SLOT_COUNT; ++slot) {
        uint32_t generation = block->widget_slot_generations[slot];
        if (generation > best_generation) {
            best_generation = generation;
            best_slot = slot;
        }
    }
    if (best_slot < FRAMER_F2UP_SLOT_COUNT &&
        best_generation > assets->generation)
        (void)widget_slot_adopt_from(block, best_slot);
}

static int scene_bytes_equal(const uint8_t *left, const uint8_t *right,
                             uint32_t bytes)
{
    uint32_t difference = 0u;
    uint32_t index;
    for (index = 0u; index < bytes; ++index)
        difference |= (uint32_t)(left[index] ^ right[index]);
    return difference == 0u;
}

/* Locate the RendererSceneRpcState through the stock RPC registry.  See the
 * SCENE_RPC_* block comment for the disassembly that fixes every offset used
 * here.  Fails closed: any pointer outside stock data, any key that is not the
 * exact 19-byte "widget.scene.commit", or a state whose own first word is not
 * this controller, returns NULL and the caller simply does nothing. */
static uint8_t *scene_rpc_state_find(void *controller)
{
    static const uint8_t commit_method[SCENE_RPC_COMMIT_METHOD_BYTES] = {
        'w', 'i', 'd', 'g', 'e', 't', '.', 's', 'c', 'e',
        'n', 'e', '.', 'c', 'o', 'm', 'm', 'i', 't'
    };
    const uint8_t *table;
    const uint8_t *node;
    void *registry;
    uint32_t guard;
    if (controller == (void *)0)
        return (uint8_t *)0;
    registry = STOCK_RPC_REGISTRY();
    if (registry == (void *)0 ||
        !in_stock_data(registry, SCENE_RPC_MAP_OFFSET + 16u))
        return (uint8_t *)0;
    table = (const uint8_t *)registry + SCENE_RPC_MAP_OFFSET;
    node = *(const uint8_t *const *)(const void *)(table + 8u);
    for (guard = 0u; guard < SCENE_RPC_WALK_LIMIT; ++guard) {
        const uint8_t *key;
        uint32_t key_bytes;
        if (node == (const uint8_t *)0 ||
            !in_stock_data(node, SCENE_RPC_NODE_MIN_BYTES) ||
            ((uintptr_t)node & 3u) != 0u)
            return (uint8_t *)0;
        key = *(const uint8_t *const *)(const void *)
                  (node + SCENE_RPC_NODE_KEY_POINTER);
        key_bytes = *(const uint32_t *)(const void *)
                        (node + SCENE_RPC_NODE_KEY_BYTES);
        if (key_bytes == SCENE_RPC_COMMIT_METHOD_BYTES &&
            key != (const uint8_t *)0 && in_stock_data(key, key_bytes) &&
            scene_bytes_equal(key, commit_method,
                              SCENE_RPC_COMMIT_METHOD_BYTES)) {
            uint8_t *state = *(uint8_t *const *)(const void *)
                                 (node + SCENE_RPC_NODE_VALUE);
            if (state == (uint8_t *)0 ||
                !in_stock_data(state, SCENE_STATE_BYTES) ||
                ((uintptr_t)state & 3u) != 0u ||
                *(const uint32_t *)(const void *)state !=
                    (uint32_t)(uintptr_t)controller)
                return (uint8_t *)0;
            return state;
        }
        node = *(const uint8_t *const *)(const void *)
                   (node + SCENE_RPC_NODE_NEXT);
    }
    return (uint8_t *)0;
}

static uint32_t scene_state_word(uint8_t *state, uint32_t offset)
{
    return __atomic_load_n((volatile uint32_t *)(void *)(state + offset),
                           __ATOMIC_ACQUIRE);
}

/* The renderer-v2 sidecar's switch word, or NULL. */
static volatile uint32_t *scene_switch_word(void *controller)
{
    void **vtable;
    uint8_t *sidecar;
    if (!scene_sidecar_present(controller))
        return (volatile uint32_t *)0;
    vtable = *(void ***)controller;
    sidecar = (uint8_t *)vtable[11];
    if (!in_stock_data(sidecar, SCENE_SIDECAR_SWITCH_OFFSET + 4u))
        return (volatile uint32_t *)0;
    return (volatile uint32_t *)(void *)(sidecar + SCENE_SIDECAR_SWITCH_OFFSET);
}

/* Republish the frozen clock+timer package at boot, from flash slot B, using
 * the exact sequence renderer_scene_rpc_core_begin/commit runs
 * (f1-widget-sdk/examples/renderer-id26/on-device/renderer-v1-scene-rpc-core.c:
 * 327 prepare_store, 424 v2 prepare, 440 stage_bundle, 456 v2 commit).  Runs
 * once, on the original setup task, after the renderer chain has already seeded
 * committed_generation = 1 and before this module creates its owner task.
 * Every failure is silent and leaves the built-in boot scene untouched. */
static void boot_adopt_default_scene(physical_block *block, void *controller)
{
    void *mapped = (void *)0;
    void *package_raw = (void *)0;
    const uint8_t *record;
    uint8_t *package = (uint8_t *)0;
    uint32_t outcome = SCENE_ADOPT_SLOT_INVALID;
    uint32_t step = SCENE_STEP_NONE;
    uint32_t unmap_flag = 0u;
    uint32_t generation = 0u;
    uint8_t *rpc_state;
    int borrowed = 0;
    if (block == (physical_block *)0)
        return;
    if (!scene_sidecar_present(controller)) {
        outcome = SCENE_ADOPT_NO_STORE;
        step = SCENE_STEP_NO_SIDECAR;
        goto finished;
    }
    if (STOCK_HEAP_FREE_SIZE(PHYSICAL_CAP_INTERNAL | PHYSICAL_CAP_8BIT) <
        (size_t)SCENE_MAP_RESERVE_BYTES) {
        step = SCENE_STEP_MAP_RESERVE;
        goto finished;
    }
    if (STOCK_MMU_MAP(SCENE_SLOT_B_PADDR, (size_t)SCENE_SLOT_B_BYTES,
                      MMU_TARGET_FLASH0, MMU_MEM_CAP_READ | MMU_MEM_CAP_8BIT,
                      0, &mapped) != 0 || mapped == (void *)0) {
        mapped = (void *)0;
        step = SCENE_STEP_MAP_FAILED;
        goto finished;
    }
    if ((uintptr_t)mapped < SCENE_DATA_WINDOW_BEGIN ||
        (uintptr_t)mapped > SCENE_DATA_WINDOW_END - SCENE_SLOT_B_BYTES ||
        ((uintptr_t)mapped & 3u) != 0u) {
        step = SCENE_STEP_MAP_RANGE;
        goto finished;
    }
    record = (const uint8_t *)mapped;
    if (!scene_record_is_valid(record, &step, &generation))
        goto finished;
    /* From here slot B is known to hold generation `generation`, whether or not
     * the renderer later accepts it: the persist machine must never rewrite a
     * record that already holds the committed generation. */
    block->scene_persist_generation = generation;
    package = scene_buffer_acquire(&package_raw);
    if (package == (uint8_t *)0) {
        outcome = SCENE_ADOPT_NO_STORE;
        step = SCENE_STEP_BUFFER;
        goto finished;
    }
    scene_copy(package, record + SCENE_RECORD_HEADER_BYTES,
               SCENE_PACKAGE_BYTES);
    /* Hash the copy, not the window: the renderer only ever sees these bytes,
     * and the mapping is released immediately afterwards. */
    if (!scene_digest_matches(record + SCENE_RECORD_SHA_OFFSET, package,
                              SCENE_PACKAGE_BYTES)) {
        step = SCENE_STEP_PAYLOAD_SHA;
        goto finished;
    }
    if (!scene_package_header_is_f1wb(package, generation)) {
        step = SCENE_STEP_F1WB;
        goto finished;
    }
    if (STOCK_MMU_UNMAP(mapped) != 0)
        unmap_flag = SCENE_STEP_UNMAP_FAILED;
    mapped = (void *)0;
    outcome = SCENE_ADOPT_GATE_REJECTED;
    if (!STOCK_PREPARE_STORE(controller, package)) {
        step = SCENE_STEP_PREPARE_STORE;
        goto finished;
    }
    if (!STOCK_V2_PREPARE(controller, package, SCENE_PACKAGE_BYTES,
                          generation)) {
        step = SCENE_STEP_V2_PREPARE;
        goto finished;
    }
    /* From here the renderer holds raw pointers into the buffer.  Even a failed
     * cancel must not reclaim it, so the buffer becomes boot-lifetime. */
    borrowed = 1;
    if (!STOCK_STAGE_BUNDLE(controller, package, SCENE_FOCUS_F1WB_BYTES)) {
        (void)STOCK_V2_CANCEL(controller);
        step = SCENE_STEP_STAGE;
        goto finished;
    }
    if (!STOCK_V2_COMMIT(controller)) {
        /* renderer-v1 already borrowed the buffer; retain it for the boot
         * lifetime exactly as renderer_scene_rpc_core_commit does. */
        step = SCENE_STEP_V2_COMMIT;
        goto finished;
    }
    outcome = SCENE_ADOPT_OK;
    step = SCENE_STEP_NONE;
    /* Publish the committed generation exactly as a successful RPC commit does
     * (renderer-v1-scene-rpc-core.c:476).  SCENE_FLAG_V2_STORE_LATCH stays
     * clear: the renderer borrowed this module's PSRAM buffer, not
     * state->store, so the next widget.scene.begin may reuse the store.  The
     * store must genuinely be idle and still at the boot-seeded generation 1
     * for this to be safe, so both are re-checked here. */
    rpc_state = block->scene_state;
    if (rpc_state == (uint8_t *)0) {
        step = SCENE_STEP_NO_RPC_STATE;
    } else if (scene_state_word(rpc_state, SCENE_STATE_FLAGS) != 0u ||
               scene_state_word(rpc_state, SCENE_STATE_COMMITTED_GENERATION) >=
                   generation) {
        step = SCENE_STEP_NO_RPC_STATE;
    } else {
        __atomic_store_n((volatile uint32_t *)(void *)
                             (rpc_state + SCENE_STATE_COMMITTED_GENERATION),
                         generation, __ATOMIC_RELEASE);
        block->scene_persist_observed = generation;
        __atomic_store_n(&block->scene_persist_status,
                         SCENE_PERSIST_IDLE |
                             (SCENE_REARM_WAITING << 16u),
                         __ATOMIC_RELEASE);
    }
finished:
    if (mapped != (void *)0 && STOCK_MMU_UNMAP(mapped) != 0)
        unmap_flag = SCENE_STEP_UNMAP_FAILED;
    /* Released only on paths where the renderer never saw the buffer, and only
     * ever through the exact allocator result, never the aligned view. */
    if (package_raw != (void *)0 && borrowed == 0)
        STOCK_HEAP_FREE(package_raw);
    block->reserved_flags[0] = (uint8_t)outcome;
    block->reserved_flags[1] = (uint8_t)(step | unmap_flag);
}

/* --- owner-task persist driver -------------------------------------------
 *
 * chip = NULL selects esp_flash_default_chip inside the stock chip_check
 * (0x4037edf0), so this module never dereferences the chip object itself. */
/* app_func_arg_t::no_protect, or NULL when this is not the firmware whose
 * flash layer was recovered above.  Every dereference is range-checked and the
 * os_func identity is compared against the exact recovered addresses. */
static volatile uint8_t *scene_flash_protect_byte(void)
{
    uint8_t *const *slot = (uint8_t *const *)(uintptr_t)
        STOCK_FLASH_DEFAULT_CHIP_SLOT;
    uint8_t *chip;
    uint8_t *os_func;
    uint8_t *os_func_data;
    if (!in_internal((const void *)slot, sizeof(uint8_t *)))
        return (volatile uint8_t *)0;
    chip = *slot;
    if (chip == (uint8_t *)0 ||
        !in_internal(chip, ESP_FLASH_CHIP_OS_FUNC_DATA + 4u) ||
        ((uintptr_t)chip & 3u) != 0u)
        return (volatile uint8_t *)0;
    os_func = *(uint8_t *const *)(const void *)(chip + ESP_FLASH_CHIP_OS_FUNC);
    if ((uintptr_t)os_func != (uintptr_t)STOCK_FLASH_APP_OS_FUNC)
        return (volatile uint8_t *)0;
    if (*(const uint32_t *)(const void *)
            (os_func + ESP_FLASH_OS_FUNC_REGION_PROTECTED) !=
        STOCK_FLASH_REGION_PROTECTED)
        return (volatile uint8_t *)0;
    os_func_data = *(uint8_t *const *)(const void *)
        (chip + ESP_FLASH_CHIP_OS_FUNC_DATA);
    if (os_func_data == (uint8_t *)0 ||
        !in_internal(os_func_data, ESP_FLASH_ARG_NO_PROTECT + 1u) ||
        ((uintptr_t)os_func_data & 3u) != 0u)
        return (volatile uint8_t *)0;
    return (volatile uint8_t *)(os_func_data + ESP_FLASH_ARG_NO_PROTECT);
}

static int scene_device_erase(void *opaque, uint32_t address, uint32_t bytes)
{
    volatile uint8_t *guard = scene_flash_protect_byte();
    uint8_t saved;
    int result;
    (void)opaque;
    if (guard == (volatile uint8_t *)0)
        return 1;
    saved = *guard;
    *guard = 1u;
    result = STOCK_FLASH_ERASE((void *)0, address, bytes) == 0 ? 0 : 1;
    *guard = saved;
    return result;
}

static int scene_device_write(void *opaque, uint32_t address,
                              const uint8_t *source, uint32_t bytes)
{
    volatile uint8_t *guard = scene_flash_protect_byte();
    uint8_t saved;
    int result;
    (void)opaque;
    if (guard == (volatile uint8_t *)0)
        return 1;
    saved = *guard;
    *guard = 1u;
    result = STOCK_FLASH_WRITE((void *)0, source, address, bytes) == 0 ? 0 : 1;
    *guard = saved;
    return result;
}

static int scene_device_read(void *opaque, uint32_t address,
                             uint8_t *destination, uint32_t bytes)
{
    (void)opaque;
    return STOCK_FLASH_READ((void *)0, destination, address, bytes) == 0 ? 0 : 1;
}

static uint32_t scene_persist_pack(uint32_t state, uint32_t step,
                                   uint32_t rearm, uint32_t started)
{
    return (state & 0xffu) | ((step & 0xffu) << 8u) |
           ((rearm & 0xffu) << 16u) | ((started & 0xffu) << 24u);
}

/* One owner-task iteration of the boot-scene persistence machine.  Never runs
 * anything unbounded: at most one 4 KiB sector erase, one 1 KiB write, one
 * 512-byte verify read, or one 95,535-byte SHA-256 per call, with the caller's
 * one-tick delay in between.  A single failure stops the machine for the rest
 * of the boot; widget.mquickjs.diag6 names the step. */
static void scene_persist_step(physical_block *block)
{
    static const scene_flash_ops device_ops = {
        scene_device_erase, scene_device_write, scene_device_read, (void *)0
    };
    scene_persist_context context;
    uint8_t digest[32];
    const uint8_t *store;
    uint8_t *rpc_state;
    uint32_t status;
    uint32_t state;
    uint32_t step;
    uint32_t rearm;
    uint32_t started;
    uint32_t committed;
    uint32_t flags;
    uint32_t total;
    uint32_t milliseconds;
    if (block == (physical_block *)0)
        return;
    status = __atomic_load_n(&block->scene_persist_status, __ATOMIC_ACQUIRE);
    state = status & 0xffu;
    step = (status >> 8u) & 0xffu;
    rearm = (status >> 16u) & 0xffu;
    started = (status >> 24u) & 0xffu;
    /* (1) Return the renderer-v2 switch to EMPTY once, after the adopted
     * package has actually gone ACTIVE on a UI tick.  Only then are the
     * sidecar's active/observed fields and both admitted flags already set to
     * the adopted identity, so the memoised admission checks never re-read
     * switch_state (renderer-v2-native-source.c:844-846, 886-888) and the next
     * host push can CAS EMPTY -> WRITING in renderer_v2_native_prepare. */
    if (rearm == SCENE_REARM_WAITING) {
        volatile uint32_t *switch_word = scene_switch_word(block->backend);
        if (switch_word == (volatile uint32_t *)0) {
            rearm = SCENE_REARM_NO_SIDECAR;
        } else if (__atomic_load_n(switch_word, __ATOMIC_ACQUIRE) ==
                   SCENE_SWITCH_ACTIVE) {
            __atomic_store_n(switch_word, SCENE_SWITCH_EMPTY, __ATOMIC_RELEASE);
            rearm = SCENE_REARM_DONE;
        }
    }
    rpc_state = block->scene_state;
    if (rpc_state == (uint8_t *)0 || state == SCENE_PERSIST_DONE ||
        state == SCENE_PERSIST_FAILED) {
        __atomic_store_n(&block->scene_persist_status,
                         scene_persist_pack(state, step, rearm, started),
                         __ATOMIC_RELEASE);
        return;
    }
    committed = scene_state_word(rpc_state, SCENE_STATE_COMMITTED_GENERATION);
    flags = scene_state_word(rpc_state, SCENE_STATE_FLAGS);
    total = scene_state_word(rpc_state, SCENE_STATE_TOTAL_BYTES);
    store = rpc_state + SCENE_STATE_STORE;
    block->scene_persist_observed = committed;
    milliseconds = now_ms();
    if (state == SCENE_PERSIST_IDLE) {
        if (committed >= SCENE_MIN_GENERATION &&
            committed != block->scene_persist_generation &&
            (flags & SCENE_FLAG_ACTIVE) == 0u &&
            total == SCENE_PACKAGE_BYTES &&
            scene_package_header_is_f1wb(store, committed)) {
            block->scene_persist_pending = committed;
            block->scene_persist_since_ms = milliseconds;
            state = SCENE_PERSIST_ARMED;
        }
    } else if (state == SCENE_PERSIST_ARMED) {
        if (committed != block->scene_persist_pending ||
            (flags & SCENE_FLAG_ACTIVE) != 0u ||
            total != SCENE_PACKAGE_BYTES ||
            !scene_package_header_is_f1wb(store, committed)) {
            state = SCENE_PERSIST_IDLE;
        } else if ((uint32_t)(milliseconds - block->scene_persist_since_ms) >=
                   SCENE_PERSIST_SETTLE_MS) {
            started = 1u;
            if (scene_flash_protect_byte() == (volatile uint8_t *)0) {
                /* Not the firmware whose flash layer was recovered: refuse to
                 * touch flash at all rather than guess at the guard. */
                state = SCENE_PERSIST_FAILED;
                step = SCENE_PSTEP_GUARD;
            } else {
                block->scene_persist_cursor = 0u;
                state = SCENE_PERSIST_ERASE;
            }
        }
    } else {
        /* Erasing, writing, verifying or sealing.  The upload that produced
         * this store must still be the committed one and must still be idle;
         * anything else stops the machine before the header is written, so a
         * half-written record is never sealed. */
        if (committed != block->scene_persist_pending ||
            (flags & SCENE_FLAG_ACTIVE) != 0u ||
            total != SCENE_PACKAGE_BYTES) {
            state = SCENE_PERSIST_FAILED;
            step = SCENE_PSTEP_MOVED;
        } else {
            context.state = state;
            context.step = step;
            context.generation = block->scene_persist_pending;
            context.package_bytes = SCENE_PACKAGE_BYTES;
            context.cursor = block->scene_persist_cursor;
            context.package = store;
            context.digest = (const uint8_t *)0;
            if (state == SCENE_PERSIST_HEADER) {
                STOCK_SHA256(store, SCENE_PACKAGE_BYTES, digest);
                context.digest = digest;
            }
            scene_persist_advance(&context, &device_ops);
            block->scene_persist_cursor = context.cursor;
            state = context.state;
            step = context.step;
            if (state == SCENE_PERSIST_DONE)
                block->scene_persist_generation = block->scene_persist_pending;
        }
    }
    __atomic_store_n(&block->scene_persist_status,
                     scene_persist_pack(state, step, rearm, started),
                     __ATOMIC_RELEASE);
}

/* One bounded owner-task step of the widget persist machine, exactly the
 * scene machine's cadence: at most one sector erase, one 1 KiB write or one
 * 512-byte verify read per owner-loop iteration.  The machine itself is the
 * host-proven framer_f2up_persist_advance; the flash seams are the same
 * guarded stock wrappers the scene machine writes through. */
static void widget_persist_step(physical_block *block)
{
    static const framer_f2up_flash_ops device_ops = {
        scene_device_erase, scene_device_write, scene_device_read, (void *)0
    };
    framer_f2up_persist_context context;
    uint32_t status;
    uint32_t state;
    uint32_t step;
    if (block == (physical_block *)0)
        return;
    status = __atomic_load_n(&block->widget_persist_status, __ATOMIC_ACQUIRE);
    state = status & 0xffu;
    step = (status >> 8u) & 0xffu;
    if (state == FRAMER_F2UP_PERSIST_IDLE ||
        state == FRAMER_F2UP_PERSIST_DONE ||
        state == FRAMER_F2UP_PERSIST_FAILED)
        return;
    if (state == FRAMER_F2UP_PERSIST_ARMED) {
        if ((uint32_t)(now_ms() - block->widget_persist_since_ms) <
            SCENE_PERSIST_SETTLE_MS)
            return;
        if (scene_flash_protect_byte() == (volatile uint8_t *)0) {
            /* Not the firmware whose flash layer was recovered: refuse to
             * touch flash at all rather than guess at the guard. */
            state = FRAMER_F2UP_PERSIST_FAILED;
            step = FRAMER_F2UP_PSTEP_GUARD;
        } else {
            block->widget_persist_cursor = 0u;
            state = FRAMER_F2UP_PERSIST_ERASE;
            step = FRAMER_F2UP_PSTEP_NONE;
        }
    } else {
        context.state = state;
        context.step = step;
        context.cursor = block->widget_persist_cursor;
        context.container = block->widget_staging;
        context.container_bytes = block->widget_persist_total;
        context.base = block->widget_persist_base;
        framer_f2up_persist_advance(&context, &device_ops);
        block->widget_persist_cursor = context.cursor;
        state = context.state;
        step = context.step;
        if (state == FRAMER_F2UP_PERSIST_DONE) {
            uint32_t slot = block->widget_session_slot;
            __atomic_store_n(&block->widget_persisted_generation,
                             block->widget_persist_pending_generation,
                             __ATOMIC_RELEASE);
            if (slot < FRAMER_F2UP_SLOT_COUNT) {
                uint32_t index;
                block->widget_slot_generations[slot] =
                    block->widget_persist_pending_generation;
                for (index = 0u; index < 16u; ++index)
                    block->widget_slot_sha16[slot][index] =
                        block->widget_upload.admission.f2js_sha256[index];
            }
        }
    }
    __atomic_store_n(&block->widget_persist_status, state | (step << 8u),
                     __ATOMIC_RELEASE);
}

static physical_proxy *publish_proxy_for_slot(physical_block *block,
                                              physical_proxy *proxy,
                                              uint32_t screen_slot)
{
    uint32_t index;
    if (block == (physical_block *)0 || block->registry == (void *)0 ||
        block->navigation == (void *)0 || block->backend == (void *)0 ||
        __atomic_load_n(&block->boot_state, __ATOMIC_ACQUIRE) != 2u)
        return (physical_proxy *)0;
    zero_bytes(proxy, sizeof(*proxy));
    proxy->vptr = STOCK_BASE_VTABLE;
    proxy->common_24[2] = 10u;
    proxy->backend = block->backend;
    proxy->block = block;
    proxy->magic = PHYSICAL_PROXY_MAGIC;
    proxy->screen_slot = screen_slot;
    proxy->descriptor[0].header = 0x00001219u;
    proxy->descriptor[0].dimensions = 0x01360064u;
    proxy->descriptor[0].stride = 200u;
    proxy->descriptor[0].bytes = PHYSICAL_FRAME_BYTES;
    proxy->descriptor[0].data =
        (uint32_t)(uintptr_t)((uint8_t *)block->backend + 160u);
    proxy->descriptor[1] = proxy->descriptor[0];
    for (index = 0u; index < 11u; ++index)
        proxy->local_vtable[index] = (void *)0;
    proxy->local_vtable[0] = STOCK_BASE_SLOT0;
    proxy->local_vtable[1] = (void *)(uintptr_t)proxy_build;
    proxy->local_vtable[2] = STOCK_BASE_SLOT2;
    proxy->local_vtable[3] = STOCK_BASE_SLOT3;
    proxy->local_vtable[4] = (void *)(uintptr_t)proxy_cleanup;
    proxy->local_vtable[5] = STOCK_BASE_SLOT5;
    proxy->local_vtable[6] = (void *)(uintptr_t)proxy_tick;
    proxy->local_vtable[7] = STOCK_BASE_SLOT7;
    proxy->local_vtable[8] = (void *)(uintptr_t)framer_physical_weather_id;
    proxy->local_vtable[9] = (void *)(uintptr_t)proxy_encoder;
    proxy->local_vtable[10] = STOCK_BASE_SLOT10;
    proxy->vptr = proxy->local_vtable;
    /* addController is the first externally reachable module pointer.  No
     * failure from this point may cause the fixed module mapping to be torn
     * down; startup already committed by creating the boot owner task. */
    if (screen_slot == 0u)
        block->proxy = proxy;
    STOCK_ADD_CONTROLLER(block->registry, proxy);
    /* addController is a void, boot-lifetime stock commit.  Once called this
     * function cannot report a recoverable failure or invalidate proxy. */
    return proxy;
}

static physical_proxy *publish_proxy(physical_block *block)
{
    return publish_proxy_for_slot(block, &block->proxy_storage[0], 0u);
}

__attribute__((used, visibility("default")))
const uint32_t framer_physical_block_allocation_bytes = sizeof(physical_block);

__attribute__((used, visibility("default")))
int framer_physical_module_startup(void *controller,
                                   const uint8_t module_sha256[32],
                                   void *owned_block,
                                   uint32_t owned_block_bytes)
{
    framer_resident_platform platform;
    physical_block *block = (physical_block *)owned_block;
    void *root;
    void *registry;
    void *navigation;
    uint32_t wait_ticks;
    physical_proxy *published;
    if (controller == (void *)0 || module_sha256 == (const uint8_t *)0 ||
        owned_block_bytes != sizeof(physical_block) ||
        !in_internal(block, sizeof(*block)) ||
        ((uintptr_t)block & 15u) != 0u) {
        return 0;
    }
    zero_bytes(block, sizeof(*block));
    block->magic = PHYSICAL_MAGIC;
    block->generation = PHYSICAL_GENERATION;
    framer_runtime_receipt_init(&block->receipt);
    framer_runtime_key_probe_init(&block->key_probe);
    block->key_stream_proven = 0u;
    block->key_cycle_down_token = 0u;
    block->key_cycle_down_seen = 0u;
    zero_bytes((void *)block->wpm_counts, sizeof(block->wpm_counts));
    block->wpm_ring_second = 0u;
    block->wpm_value = 0u;
    block->wpm_keys_60s = 0u;
    framer_runtime_visibility_init(&block->visibility);
    (void)framer_runtime_visibility_set(&block->visibility, 0);
    copy_text(block->runtime_capability.base_app_sha256,
              sizeof(block->runtime_capability.base_app_sha256),
              FRAMER_RUNTIME_ACCEPTED_APP_SHA256);
    digest_hex(block->runtime_capability.module_sha256, module_sha256);
    digest_hex(block->runtime_capability.package_sha256,
               framer_physical_weather_f2js_sha256);
    block->runtime_capability.boot_id = STOCK_TIME_US();
    block->runtime_capability.generation = PHYSICAL_GENERATION;
    root = STOCK_ROOT_GET();
    registry = root == (void *)0 ? (void *)0 : STOCK_REGISTRY_FROM_ROOT(root);
    navigation = STOCK_NAVIGATION_GET();
    if (root == (void *)0 || registry == (void *)0 || navigation == (void *)0)
        return 0;
    block->backend = controller;
    block->registry = registry;
    block->navigation = navigation;
    /* Re-publish the persisted default renderer-v2 scene before anything else
     * of this module exists: still the original setup task, the renderer chain
     * has already staged its built-in boot scene and seeded
     * committed_generation = 1, and neither the owner task nor the ID28
     * controller has been created yet.  Fails silently and leaves the built-in
     * scene in place; never changes what this function returns.
     *
     * The scene-RPC state is located first, from this same task, so that the
     * persist machine can observe host commits even when there is no record in
     * slot B yet (the first push a device ever receives). */
    block->scene_state = scene_rpc_state_find(controller);
    boot_adopt_default_scene(block, controller);
    /* Choose this boot's widget - flash slot or baked - before the owner task
     * or the ID28 proxy exist, so both only ever see the final asset set.
     * With the upload RPC registered below, cap page 0 advertises uploader=1
     * and the Designer opens its push gate. */
    /* PSRAM discipline: the adoption arena and the upload staging arena are
     * both claimed ONCE here, while the heap is pristine - activation and
     * upload churn later must never allocate (the fragmentation lesson). */
    block->widget_arena = widget_buffer_acquire(&block->widget_arena_raw, 0u);
    block->widget_staging = widget_buffer_acquire(
        &block->widget_staging_raw, FRAMER_F2UP_CHUNK_RAW_BYTES);
    if (block->widget_staging != (uint8_t *)0) {
        block->widget_chunk_scratch =
            block->widget_staging + FRAMER_F2UP_MAX_BYTES;
        framer_f2up_upload_init(&block->widget_upload, block->widget_staging,
                                FRAMER_F2UP_MAX_BYTES);
    }
    widget_slot_adopt(block);
    block->runtime_capability.runtime_uploader = 1u;
    zero_bytes(&platform, sizeof(platform));
    platform.opaque = block;
    platform.allocate_psram = platform_allocate;
    platform.free_psram = platform_free;
    platform.now_us = platform_now_us;
    platform.now_ms = platform_now_ms;
    platform.current_thread_token = platform_thread;
    platform.reschedule_owner = platform_reschedule;
    platform.activate_event_sources = platform_activate_events;
    platform.remove_event_sources = platform_remove_events;
    platform.activate_input_sources = platform_activate_input;
    platform.remove_stock_input_hook = platform_remove_input;
    platform.cancel_input_poll = platform_cancel_poll;
    platform.schedule_input_poll = platform_schedule_poll;
    platform.task_stack_high_water_bytes = platform_stack_water;
    block->owner_platform = platform;
    framer_resident_owner_init_shell(&block->owner, &engine_api,
                                     &block->owner_platform);
    if (!framer_resident_owner_mark_module_mapped(&block->owner))
        return 0;
    __atomic_store_n(&block->boot_state, 1u, __ATOMIC_RELEASE);
    {
        void *created_task = STOCK_TASK_CREATE(
            owner_task, "framer-mqjs", sizeof(block->owner.task_stack), block,
            1u, block->owner.task_stack, block->static_task, 1);
        if (created_task == (void *)0)
            return 0;
        __atomic_store_n(&block->task_handle, created_task, __ATOMIC_RELEASE);
    }
    /* Stock controller/navigation mutation is setup-lifecycle-only. Yield
     * boundedly while the core-1 owner admits JS and immutable assets, then
     * publish callbacks synchronously on this original setup task. Once the
     * task exists we always return success so loader never unmaps live code. */
    for (wait_ticks = 0u; wait_ticks < 1000u; ++wait_ticks) {
        uint32_t state = __atomic_load_n(&block->boot_state, __ATOMIC_ACQUIRE);
        if (state != 1u)
            break;
        STOCK_TASK_DELAY(1u);
    }
    if (__atomic_load_n(&block->boot_state, __ATOMIC_ACQUIRE) == 2u) {
        if (!register_rpc(block)) {
            __atomic_store_n(&block->boot_state, 8u, __ATOMIC_RELEASE);
            return 1;
        }
        published = publish_proxy(block);
        if (published == (physical_proxy *)0) {
            __atomic_store_n(&block->boot_state, 4u, __ATOMIC_RELEASE);
            return 1;
        }
        if (!framer_physical_registration_matches(
                published->registry, block->registry)) {
            /* addController already owns this callback. Keep the mapping and
             * allocation forever, but never make the dead controller
             * navigable or advertise a ready capability. */
            __atomic_store_n(&block->boot_state, 10u, __ATOMIC_RELEASE);
            return 1;
        }
        /* ONE widget screen. Two-screen status (2026-08-26): the slot bank,
         * op-6 switching and tick-visibility convergence all work, but the
         * second controller registration destabilised the stock renderer
         * twice (first: stale-frame confusion; second: the arrival-blank
         * early-return starved the stock tick tail and crashed the device
         * off USB).  docs/17 Phase B lists the research prerequisites; the
         * op-7 lifecycle forensics stay in for that work. */
        STOCK_ADD_NAVIGATION(block->navigation, PHYSICAL_SCREEN_ID);
        /* ONE WIDGET = ONE SCREEN: every OTHER resident slot gets its own
         * controller (screen id 28 + slot) in the registry and its own
         * navigation entry, so the knob reaches each widget directly and each
         * screen renders its own widget's pixels (docs/18 §6.1). */
        {
            uint32_t slot;
            for (slot = 1u; slot < FRAMER_F2UP_SLOT_COUNT; ++slot) {
                physical_proxy *extra;
                if (block->slot_resident[slot] == 0u)
                    continue;
                extra = publish_proxy_for_slot(block,
                                               &block->proxy_storage[slot],
                                               slot);
                if (extra != (physical_proxy *)0 &&
                    framer_physical_registration_matches(extra->registry,
                                                         block->registry))
                    STOCK_ADD_NAVIGATION(block->navigation,
                                         PHYSICAL_SCREEN_ID + slot);
            }
        }
        __atomic_store_n(&block->navigation_published, 1u, __ATOMIC_RELEASE);
        __atomic_store_n(&block->boot_state, 7u, __ATOMIC_RELEASE);
        __atomic_store_n(&block->rpc_ready, 1u, __ATOMIC_RELEASE);
    } else if (__atomic_load_n(&block->boot_state, __ATOMIC_ACQUIRE) == 1u) {
        __atomic_store_n(&block->boot_state, 9u, __ATOMIC_RELEASE);
    }
    return 1;
}
