#include "../mquickjs-esp32s3-module-loader/resident_loader_canary.h"
#include "backend_contract.h"

#include <stddef.h>
#include <stdint.h>

_Static_assert(sizeof(void *) == FRAMER_PHYSICAL_BACKEND_POINTER_BYTES,
               "physical backend validation requires the 32-bit target ABI");

#ifndef FRAMER_PHYSICAL_STARTUP_VADDR
#error "physical loader must pin the final module startup address"
#endif

typedef int (*framer_physical_startup_fn)(void *controller,
                                          const uint8_t module_sha256[32],
                                          void *owned_block,
                                          uint32_t owned_block_bytes);
typedef size_t (*heap_size_fn)(uint32_t caps);
typedef void *(*heap_allocate_fn)(size_t bytes, uint32_t caps);
typedef void (*heap_free_fn)(void *allocation);
typedef void *(*pointer_no_args_fn)(void);
typedef void *(*pointer_one_arg_fn)(void *);

#ifndef FRAMER_PHYSICAL_BLOCK_BYTES
#error "physical loader must pin the exact final resident block size"
#endif

#define PHYSICAL_INTERNAL_CAPS 0x0804u
#define PHYSICAL_RUNTIME_RESERVE 32768u
#define PHYSICAL_MAP_BOOKKEEPING_RESERVE 4096u
#define PHYSICAL_INTERNAL_BEGIN 0x3fc80000u
#define PHYSICAL_INTERNAL_END 0x3fd00000u
/* The stock allocator returns 8-byte alignment (live: 0x3fcd0d58) but the
 * module block must be 16-aligned. Over-allocate by this slack and align up. */
#define PHYSICAL_ALIGN_SLACK 16u
#define STOCK_HEAP_MALLOC ((heap_allocate_fn)(uintptr_t)0x4037e55cu)
#define STOCK_HEAP_FREE ((heap_free_fn)(uintptr_t)0x4037e250u)
#define STOCK_HEAP_FREE_SIZE ((heap_size_fn)(uintptr_t)0x420c8200u)
#define STOCK_HEAP_LARGEST ((heap_size_fn)(uintptr_t)0x420c82c4u)
#define STOCK_ROOT_GET ((pointer_no_args_fn)(uintptr_t)0x42004e1cu)
#define STOCK_REGISTRY_FROM_ROOT ((pointer_one_arg_fn)(uintptr_t)0x4210ad9cu)

#ifndef FRAMER_PHYSICAL_MODULE_SHA256_W0
#error "physical loader must embed the final padded module-slot digest"
#endif

__attribute__((used, section(".text.physical_module_identity"), aligned(4)))
static const uint32_t framer_physical_module_sha256[8] = {
    FRAMER_PHYSICAL_MODULE_SHA256_W0, FRAMER_PHYSICAL_MODULE_SHA256_W1,
    FRAMER_PHYSICAL_MODULE_SHA256_W2, FRAMER_PHYSICAL_MODULE_SHA256_W3,
    FRAMER_PHYSICAL_MODULE_SHA256_W4, FRAMER_PHYSICAL_MODULE_SHA256_W5,
    FRAMER_PHYSICAL_MODULE_SHA256_W6, FRAMER_PHYSICAL_MODULE_SHA256_W7,
};

__attribute__((used, noinline, section(".text.physical_backend_validate")))
int framer_physical_backend_validate(void *controller)
{
    framer_physical_backend_snapshot snapshot;
    void *root;
    void *registry;
    void **vtable;
    uint8_t *sidecar;
    uintptr_t controller_address = (uintptr_t)controller;
    if (!framer_physical_backend_readable_range(
            controller_address,
            FRAMER_PHYSICAL_BACKEND_FRAMEBUFFER_OFFSET +
                FRAMER_PHYSICAL_BACKEND_FRAMEBUFFER_BYTES))
        return 0;
    root = STOCK_ROOT_GET();
    if (root == (void *)0)
        return 0;
    registry = STOCK_REGISTRY_FROM_ROOT(root);
    if (registry == (void *)0)
        return 0;
    vtable = *(void ***)controller;
    if (!framer_physical_backend_readable_range(
            (uintptr_t)vtable,
            FRAMER_PHYSICAL_BACKEND_VTABLE_POINTERS *
                FRAMER_PHYSICAL_BACKEND_POINTER_BYTES))
        return 0;
    sidecar = (uint8_t *)vtable[11];
    if (!framer_physical_backend_readable_range(
            (uintptr_t)sidecar, FRAMER_PHYSICAL_BACKEND_SIDECAR_BYTES))
        return 0;
    snapshot.controller = controller_address;
    snapshot.controller_registry =
        (uintptr_t)*(void **)(void *)((uint8_t *)controller + 20u);
    snapshot.expected_registry = (uintptr_t)registry;
    snapshot.vtable = (uintptr_t)vtable;
    snapshot.slot6 = (uintptr_t)vtable[6];
    snapshot.slot8 = (uintptr_t)vtable[8];
    snapshot.slot9 = (uintptr_t)vtable[9];
    snapshot.slot11 = (uintptr_t)vtable[11];
    snapshot.sidecar = (uintptr_t)sidecar;
    snapshot.sidecar_magic = *(const uint32_t *)(const void *)sidecar;
    snapshot.sidecar_old_tick =
        (uintptr_t)*(void **)(void *)(sidecar + 4u);
    snapshot.sidecar_old_encoder =
        (uintptr_t)*(void **)(void *)(sidecar + 8u);
    return framer_physical_backend_snapshot_valid(&snapshot);
}

__attribute__((used, section(".text.physical_loader_start")))
void framer_physical_loader_start(void *controller)
{
    framer_mqjs_mapped_module module;
    framer_physical_startup_fn startup =
        (framer_physical_startup_fn)(uintptr_t)FRAMER_PHYSICAL_STARTUP_VADDR;
    size_t free_internal;
    __attribute__((aligned(4))) uint32_t sha_ram[8];
    void *owned_block;
    void *aligned_block;
    uintptr_t block_start;
    /* The patched setup tail is shared with ID26 creation failure and a6 can
     * then be indeterminate. Reject the complete accepted ID26/v2 identity
     * before the first allocator query, allocation, or MMU map. */
    if (!framer_physical_backend_validate(controller))
        return;
    free_internal = STOCK_HEAP_FREE_SIZE(PHYSICAL_INTERNAL_CAPS);
    if (free_internal < (size_t)FRAMER_PHYSICAL_BLOCK_BYTES +
                            PHYSICAL_ALIGN_SLACK +
                            PHYSICAL_RUNTIME_RESERVE +
                            PHYSICAL_MAP_BOOKKEEPING_RESERVE ||
        STOCK_HEAP_LARGEST(PHYSICAL_INTERNAL_CAPS) <
            (size_t)FRAMER_PHYSICAL_BLOCK_BYTES + PHYSICAL_ALIGN_SLACK)
        return;
    /* Over-allocate by the slack, align up for the module, and keep the raw
     * pointer for loader-side frees. The module never frees the block
     * (boot-lifetime adoption). */
    owned_block = STOCK_HEAP_MALLOC((size_t)FRAMER_PHYSICAL_BLOCK_BYTES +
                                        PHYSICAL_ALIGN_SLACK,
                                    PHYSICAL_INTERNAL_CAPS);
    block_start = ((uintptr_t)owned_block + 15u) & ~(uintptr_t)15u;
    aligned_block = (void *)block_start;
    if (owned_block == (void *)0 || (block_start & 15u) != 0u ||
        block_start < (uintptr_t)owned_block ||
        block_start - (uintptr_t)owned_block > PHYSICAL_ALIGN_SLACK ||
        block_start < PHYSICAL_INTERNAL_BEGIN ||
        block_start + (size_t)FRAMER_PHYSICAL_BLOCK_BYTES < block_start ||
        block_start + (size_t)FRAMER_PHYSICAL_BLOCK_BYTES >
            PHYSICAL_INTERNAL_END) {
        if (owned_block != (void *)0)
            STOCK_HEAP_FREE(owned_block);
        return;
    }
    /* The exact large block is now unavailable to every competing task.
     * Recheck the independent runtime/map reserve immediately before the
     * first esp_mmu_map call. */
    if (STOCK_HEAP_FREE_SIZE(PHYSICAL_INTERNAL_CAPS) <
            PHYSICAL_RUNTIME_RESERVE + PHYSICAL_MAP_BOOKKEEPING_RESERVE ||
        STOCK_HEAP_LARGEST(PHYSICAL_INTERNAL_CAPS) <
            PHYSICAL_MAP_BOOKKEEPING_RESERVE) {
        STOCK_HEAP_FREE(owned_block);
        return;
    }
    if (framer_mqjs_map_canary(&module) != 0) {
        STOCK_HEAP_FREE(owned_block);
        return;
    }
    /* The module hex-formats the digest with byte loads (digest_hex); the
     * IROM instruction bus only supports 32-bit loads (live LoadStoreError at
     * EXCVADDR framer_physical_module_sha256+16). Copy word-wise into RAM and
     * pass the RAM copy; startup consumes it synchronously. */
    {
        volatile const uint32_t *src = framer_physical_module_sha256;
        uint32_t i;
        for (i = 0u; i < 8u; ++i)
            sha_ram[i] = src[i];
    }
    /* A successful startup deliberately leaves both pages mapped for the
     * boot-lifetime ID28 controller. Startup adopts the preallocated block
     * only once its owner task exists. Before that boundary the loader
     * synchronously unmaps and frees the block exactly once. */
    if (!startup(controller, (const uint8_t *)(const void *)sha_ram,
                 aligned_block, FRAMER_PHYSICAL_BLOCK_BYTES)) {
        (void)framer_mqjs_unmap_canary(&module);
        STOCK_HEAP_FREE(owned_block);
    }
}
