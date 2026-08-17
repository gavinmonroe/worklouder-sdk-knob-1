/* DIAGNOSTIC variant of loader_entry.c.
 *
 * Runs the exact same admission sequence as the release loader, but first
 * allocates one internal-RAM pool holding four 352-byte RPC contexts and
 * registers four stock RPC methods:
 *
 *   widget.mquickjs.diag   loader admission gates (unchanged v1 record)
 *   widget.mquickjs.diag2  live owner-task boot state + timing + heap
 *   widget.mquickjs.diag3  live owner admission forensics (why boot failed)
 *   widget.mquickjs.diag4  captured JS exception text (instrumented module only)
 *
 * Every response string is re-rendered from live memory inside the RPC
 * callback, so repeated reads show progression rather than a frozen snapshot
 * of what the loader saw on its way out.
 *
 * Constraints inherited from the release loader: text-only (loader.ld discards
 * .rodata/.data/.bss), so every string is built from packed 32-bit words that
 * the compiler emits as .literal entries, and no 0x42... pointer is ever handed
 * to a stock helper.  Every read of the module's resident block is a 32-bit
 * DRAM load through diag_peek(); the IROM bus (0x42......) is never byte-read.
 *
 * v1 (widget.mquickjs.diag), <=112 chars, hex without 0x:
 *   v1;g=<gate>;f0=<free>;l0=<largest>;b=<raw block>;f1=<free>;l1=<largest>
 *     ;m=<maprc>;s=<startup>;r=<regticks>
 * gate: 0 entered, 1 backend-identity reject, 2 pre-alloc admission reject,
 *       3 alloc null/misaligned/out-of-range, 4 post-alloc reserve reject,
 *       5 map failed (m=code), 6 startup returned 0, 7 startup returned 1.
 *
 * v2 (widget.mquickjs.diag2), exactly 112 chars:
 *   v2;b=<boot_state>;y=<rpc_ready>;s=<sources_enabled>;t=<boot_started_ms>
 *     ;f=<boot_finished_ms>;k=<task_handle>;w=<stack high water>
 *     ;u=<us from loader entry to startup return>;h=<free internal now>
 *     ;g=<largest internal now>
 *
 * v3 (widget.mquickjs.diag3), exactly 112 chars:
 *   v3;m=<block magic>;c=<owner.capability.state>;r=<capability.ready_mask>
 *     ;a=<owner.admission.generation>;n=<key|chord<<8|source_bytes<<16>
 *     ;e=<admission.events[0]: kind|id<<16>;p=<owner.heap>
 *     ;l=<owner.telemetry.last_result>;d=<booted|permanently_disabled<<8>
 *     ;v=<owner.source_quiesce_state>
 *
 * v4 (widget.mquickjs.diag4), <=112 chars:
 *   v4;<printable ASCII copy of runtime_state::last_error>
 * The instrumented diagnostic module writes that buffer in
 * classify_exception ("<Error name>: <message> @<stack>") and preserves it
 * across framer_mqjs_destroy.  A release module never writes it, so the field
 * reads "v4;empty" there.  Non-printable bytes are folded to '.'.
 *
 * Any field reads 0xffffffff when the resident block pointer is unknown or
 * outside internal RAM (nothing was mapped, or startup was never reached).
 */

#include "../mquickjs-esp32s3-module-loader/resident_loader_canary.h"
#include "backend_contract.h"

#include <stddef.h>
#include <stdint.h>

_Static_assert(sizeof(void *) == FRAMER_PHYSICAL_BACKEND_POINTER_BYTES,
               "physical backend validation requires the 32-bit target ABI");

#ifndef FRAMER_PHYSICAL_STARTUP_VADDR
#error "physical loader must pin the final module startup address"
#endif
#ifndef FRAMER_PHYSICAL_BLOCK_BYTES
#error "physical loader must pin the exact final resident block size"
#endif
#ifndef FRAMER_PHYSICAL_MODULE_SHA256_W0
#error "physical loader must embed the final padded module-slot digest"
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
typedef void (*rpc_register_fn)(void *, void *, const char *, uint32_t, void *);
typedef void (*rpc_reply_fn)(void *, void *, uint32_t, void *);
typedef void (*task_delay_fn)(uint32_t);
typedef uint64_t (*time_us_fn)(void);
typedef uint32_t (*stack_water_fn)(void *task);

#define PHYSICAL_INTERNAL_CAPS 0x0804u
#define PHYSICAL_RUNTIME_RESERVE 32768u
#define PHYSICAL_MAP_BOOKKEEPING_RESERVE 4096u
#define PHYSICAL_ALIGN_SLACK 16u
#define PHYSICAL_INTERNAL_BEGIN 0x3fc80000u
#define PHYSICAL_INTERNAL_END 0x3fd00000u
#define STOCK_HEAP_MALLOC ((heap_allocate_fn)(uintptr_t)0x4037e55cu)
#define STOCK_HEAP_FREE ((heap_free_fn)(uintptr_t)0x4037e250u)
#define STOCK_HEAP_FREE_SIZE ((heap_size_fn)(uintptr_t)0x420c8200u)
#define STOCK_HEAP_LARGEST ((heap_size_fn)(uintptr_t)0x420c82c4u)
#define STOCK_ROOT_GET ((pointer_no_args_fn)(uintptr_t)0x42004e1cu)
#define STOCK_REGISTRY_FROM_ROOT ((pointer_one_arg_fn)(uintptr_t)0x4210ad9cu)
#define STOCK_RPC_REGISTRY ((pointer_no_args_fn)(uintptr_t)0x42004afcu)
#define STOCK_RPC_REGISTER ((rpc_register_fn)(uintptr_t)0x4211b7c8u)
#define STOCK_RPC_REPLY ((rpc_reply_fn)(uintptr_t)0x4211ba58u)
#define STOCK_TASK_DELAY ((task_delay_fn)(uintptr_t)0x4038dc3cu)
#define STOCK_TIME_US ((time_us_fn)(uintptr_t)0x4037e028u)
#define STOCK_STACK_WATER ((stack_water_fn)(uintptr_t)0x4038daf4u)

/* Exact framer_runtime_rpc_context layout (352 bytes). */
#define DIAG_CTX_BYTES 352u
#define DIAG_CTX_COUNT 4u
#define DIAG_OFF_LOCK 0u
#define DIAG_OFF_CALLS 4u
/* reserved[+8..+191] is free for the loader's own bookkeeping. */
/* 1 = v1 gates, 2 = v2 owner, 3 = v3 admission, 4 = v4 exception text. */
#define DIAG_OFF_TAG 8u
#define DIAG_OFF_BLOCK 12u   /* 16-aligned resident block pointer, 0 = unknown */
#define DIAG_OFF_ELAPSED 16u /* us from loader entry to startup return, 0 = n/a */
#define DIAG_OFF_RECORD 24u  /* 9 words: the v1 gate record */
#define DIAG_OFF_BLOCKED 192u
#define DIAG_OFF_VALUE 200u
#define DIAG_OFF_STATUS_KEY 313u
#define DIAG_OFF_METHOD 320u
#define DIAG_VALUE_BYTES 113u
#define DIAG_REGISTRY_WAIT_TICKS 1000u

/* "v2"/"v3" plus ten ";k=xxxxxxxx" fields is exactly 112 chars + NUL. */
_Static_assert(2u + 10u * 11u + 1u <= DIAG_VALUE_BYTES,
               "diag value string would overrun framer_runtime_rpc_context");
_Static_assert(DIAG_OFF_VALUE + DIAG_VALUE_BYTES == DIAG_OFF_STATUS_KEY,
               "diag value/status_key layout changed");

/* physical_block field offsets.  Every BLK_* value below is supplied by the
 * build script as a -D define, re-derived for the exact sources being built by
 * compiling an offsetof probe against physical_integration.c (and, for
 * BLK_LAST_ERROR, against the instrumented engine) with this same compiler.
 * Nothing here is hard-coded, so the release-module and diagnostic-module
 * builds each get their own correct table.
 *
 * BLK_OWNER_ADM_COUNTS packs key_count | chord_count<<8 | source_bytes<<16 and
 * BLK_OWNER_ADM_EVENT0 packs admission.events[0] kind | id<<16, each in one
 * aligned word.  BLK_OWNER_TEL_BOOTED packs telemetry.booted |
 * telemetry.permanently_disabled<<8. */
#if !defined(BLK_MAGIC) || !defined(BLK_BOOT_STATE) || \
    !defined(BLK_OWNER_TEL_BOOTED) || !defined(BLK_LAST_ERROR) || \
    !defined(BLK_LAST_ERROR_BYTES)
#error "diagnostic loader must receive physical_block offsets from the build"
#endif

/* "v4;" plus the whole last_error buffer plus NUL must fit the RPC value. */
_Static_assert(3u + (uint32_t)BLK_LAST_ERROR_BYTES + 1u <= DIAG_VALUE_BYTES,
               "diag4 exception text would overrun framer_runtime_rpc_context");
_Static_assert(((uint32_t)BLK_LAST_ERROR & 3u) == 0u &&
                   ((uint32_t)BLK_LAST_ERROR_BYTES & 3u) == 0u,
               "diag4 reads last_error with aligned 32-bit loads only");

enum {
    DIAG_REC_GATE = 0,
    DIAG_REC_FREE0 = 1,
    DIAG_REC_LARGEST0 = 2,
    DIAG_REC_BLOCK = 3,
    DIAG_REC_FREE1 = 4,
    DIAG_REC_LARGEST1 = 5,
    DIAG_REC_MAP = 6,
    DIAG_REC_STARTUP = 7,
    DIAG_REC_TICKS = 8,
    DIAG_REC_WORDS = 9,
};

typedef struct {
    uint32_t gate;
    uint32_t free0;
    uint32_t largest0;
    uint32_t block;
    uint32_t free1;
    uint32_t largest1;
    uint32_t map_result;
    uint32_t startup_result;
    uint32_t registry_ticks;
} diag_record;

__attribute__((used, section(".text.physical_module_identity"), aligned(4)))
static const uint32_t framer_physical_module_sha256[8] = {
    FRAMER_PHYSICAL_MODULE_SHA256_W0, FRAMER_PHYSICAL_MODULE_SHA256_W1,
    FRAMER_PHYSICAL_MODULE_SHA256_W2, FRAMER_PHYSICAL_MODULE_SHA256_W3,
    FRAMER_PHYSICAL_MODULE_SHA256_W4, FRAMER_PHYSICAL_MODULE_SHA256_W5,
    FRAMER_PHYSICAL_MODULE_SHA256_W6, FRAMER_PHYSICAL_MODULE_SHA256_W7,
};

/* --- RAM string helpers (no rodata, no builtins) ------------------------- */

__attribute__((noinline)) static void diag_zero(uint8_t *dst, uint32_t count)
{
    uint32_t i;
    for (i = 0u; i < count; ++i)
        dst[i] = 0u;
}

/* Store the low `count` bytes of `word` little-endian at dst. */
__attribute__((noinline)) static uint8_t *diag_word(uint8_t *dst, uint32_t word,
                                                    uint32_t count)
{
    uint32_t i;
    for (i = 0u; i < count; ++i) {
        dst[i] = (uint8_t)(word & 0xffu);
        word >>= 8;
    }
    return dst + count;
}

#define W4(a, b, c, d) \
    ((uint32_t)(uint8_t)(a) | ((uint32_t)(uint8_t)(b) << 8) | \
     ((uint32_t)(uint8_t)(c) << 16) | ((uint32_t)(uint8_t)(d) << 24))

__attribute__((noinline)) static uint8_t *diag_hex32(uint8_t *dst, uint32_t value)
{
    int shift;
    for (shift = 28; shift >= 0; shift -= 4) {
        uint32_t nibble = (value >> (uint32_t)shift) & 0xfu;
        *dst++ = (uint8_t)(nibble < 10u ? ('0' + nibble) : ('a' + nibble - 10u));
    }
    return dst;
}

/* ";k=" then 8 hex digits: k is a single ASCII char, k2 optional second char. */
__attribute__((noinline)) static uint8_t *diag_field(uint8_t *dst, uint32_t key,
                                                     uint32_t key_bytes,
                                                     uint32_t value)
{
    *dst++ = ';';
    dst = diag_word(dst, key, key_bytes);
    *dst++ = '=';
    return diag_hex32(dst, value);
}

/* --- live 32-bit DRAM reads of the module's resident block ---------------- */

__attribute__((noinline)) static uint32_t diag_slot(const uint8_t *ctx,
                                                    uint32_t offset)
{
    return *(const volatile uint32_t *)(const void *)(ctx + offset);
}

__attribute__((noinline)) static void diag_slot_set(uint8_t *ctx,
                                                    uint32_t offset,
                                                    uint32_t value)
{
    *(volatile uint32_t *)(void *)(ctx + offset) = value;
}

/* 32-bit load from the resident block.  Refuses anything that is not a
 * 16-aligned internal-RAM block pointer, so a stale/absent block reads as
 * 0xffffffff instead of faulting, and never touches the IROM bus. */
__attribute__((noinline)) static uint32_t diag_peek(uint32_t base,
                                                    uint32_t offset)
{
    uint32_t address;
    if (base < PHYSICAL_INTERNAL_BEGIN || (base & 15u) != 0u ||
        base >= PHYSICAL_INTERNAL_END ||
        offset > (uint32_t)FRAMER_PHYSICAL_BLOCK_BYTES - 4u)
        return 0xffffffffu;
    address = base + offset;
    if (address + 4u > PHYSICAL_INTERNAL_END)
        return 0xffffffffu;
    return *(const volatile uint32_t *)(uintptr_t)address;
}

/* --- response renderers (re-run on every RPC request) -------------------- */

__attribute__((noinline)) static void diag_render_gates(uint8_t *ctx)
{
    uint8_t *value = ctx + DIAG_OFF_VALUE;
    uint8_t *p = value;
    uint32_t base = DIAG_OFF_RECORD;
    diag_zero(value, DIAG_VALUE_BYTES);
    p = diag_word(p, W4('v', '1', 0, 0), 2u);
    p = diag_field(p, W4('g', 0, 0, 0), 1u, diag_slot(ctx, base + 4u * DIAG_REC_GATE));
    p = diag_field(p, W4('f', '0', 0, 0), 2u, diag_slot(ctx, base + 4u * DIAG_REC_FREE0));
    p = diag_field(p, W4('l', '0', 0, 0), 2u, diag_slot(ctx, base + 4u * DIAG_REC_LARGEST0));
    p = diag_field(p, W4('b', 0, 0, 0), 1u, diag_slot(ctx, base + 4u * DIAG_REC_BLOCK));
    p = diag_field(p, W4('f', '1', 0, 0), 2u, diag_slot(ctx, base + 4u * DIAG_REC_FREE1));
    p = diag_field(p, W4('l', '1', 0, 0), 2u, diag_slot(ctx, base + 4u * DIAG_REC_LARGEST1));
    p = diag_field(p, W4('m', 0, 0, 0), 1u, diag_slot(ctx, base + 4u * DIAG_REC_MAP));
    p = diag_field(p, W4('s', 0, 0, 0), 1u, diag_slot(ctx, base + 4u * DIAG_REC_STARTUP));
    p = diag_field(p, W4('r', 0, 0, 0), 1u, diag_slot(ctx, base + 4u * DIAG_REC_TICKS));
    *p = 0u; /* 2 + 9 fields * <=12 = 110 bytes worst case < 113 */
}

__attribute__((noinline)) static void diag_render_owner(uint8_t *ctx)
{
    uint8_t *value = ctx + DIAG_OFF_VALUE;
    uint8_t *p = value;
    uint32_t block = diag_slot(ctx, DIAG_OFF_BLOCK);
    uint32_t task = diag_peek(block, BLK_TASK_HANDLE);
    uint32_t water = 0xffffffffu;
    if (task != 0u && task != 0xffffffffu)
        water = STOCK_STACK_WATER((void *)(uintptr_t)task);
    diag_zero(value, DIAG_VALUE_BYTES);
    p = diag_word(p, W4('v', '2', 0, 0), 2u);
    p = diag_field(p, W4('b', 0, 0, 0), 1u, diag_peek(block, BLK_BOOT_STATE));
    p = diag_field(p, W4('y', 0, 0, 0), 1u, diag_peek(block, BLK_RPC_READY));
    p = diag_field(p, W4('s', 0, 0, 0), 1u, diag_peek(block, BLK_SOURCES_ENABLED));
    p = diag_field(p, W4('t', 0, 0, 0), 1u, diag_peek(block, BLK_BOOT_STARTED_MS));
    p = diag_field(p, W4('f', 0, 0, 0), 1u, diag_peek(block, BLK_BOOT_FINISHED_MS));
    p = diag_field(p, W4('k', 0, 0, 0), 1u, task);
    p = diag_field(p, W4('w', 0, 0, 0), 1u, water);
    p = diag_field(p, W4('u', 0, 0, 0), 1u, diag_slot(ctx, DIAG_OFF_ELAPSED));
    p = diag_field(p, W4('h', 0, 0, 0), 1u,
                   (uint32_t)STOCK_HEAP_FREE_SIZE(PHYSICAL_INTERNAL_CAPS));
    p = diag_field(p, W4('g', 0, 0, 0), 1u,
                   (uint32_t)STOCK_HEAP_LARGEST(PHYSICAL_INTERNAL_CAPS));
    *p = 0u; /* 2 + 10 * 11 = 112 bytes exactly */
}

__attribute__((noinline)) static void diag_render_admit(uint8_t *ctx)
{
    uint8_t *value = ctx + DIAG_OFF_VALUE;
    uint8_t *p = value;
    uint32_t block = diag_slot(ctx, DIAG_OFF_BLOCK);
    diag_zero(value, DIAG_VALUE_BYTES);
    p = diag_word(p, W4('v', '3', 0, 0), 2u);
    p = diag_field(p, W4('m', 0, 0, 0), 1u, diag_peek(block, BLK_MAGIC));
    p = diag_field(p, W4('c', 0, 0, 0), 1u, diag_peek(block, BLK_OWNER_CAP_STATE));
    p = diag_field(p, W4('r', 0, 0, 0), 1u, diag_peek(block, BLK_OWNER_CAP_READY_MASK));
    p = diag_field(p, W4('a', 0, 0, 0), 1u, diag_peek(block, BLK_OWNER_ADM_GENERATION));
    p = diag_field(p, W4('n', 0, 0, 0), 1u, diag_peek(block, BLK_OWNER_ADM_COUNTS));
    p = diag_field(p, W4('e', 0, 0, 0), 1u, diag_peek(block, BLK_OWNER_ADM_EVENT0));
    p = diag_field(p, W4('p', 0, 0, 0), 1u, diag_peek(block, BLK_OWNER_HEAP));
    p = diag_field(p, W4('l', 0, 0, 0), 1u, diag_peek(block, BLK_OWNER_TEL_LAST_RESULT));
    p = diag_field(p, W4('d', 0, 0, 0), 1u, diag_peek(block, BLK_OWNER_TEL_BOOTED));
    p = diag_field(p, W4('v', 0, 0, 0), 1u, diag_peek(block, BLK_OWNER_SOURCE_QUIESCE));
    *p = 0u; /* 2 + 10 * 11 = 112 bytes exactly */
}

/* runtime_state::last_error, copied byte by byte out of aligned 32-bit DRAM
 * loads and sanitised again on the way out.  BLK_LAST_ERROR_BYTES is a
 * multiple of four and the buffer is word aligned, so no unaligned or
 * out-of-block load is ever issued. */
__attribute__((noinline)) static void diag_render_error(uint8_t *ctx)
{
    uint8_t *value = ctx + DIAG_OFF_VALUE;
    uint8_t *p = value;
    uint32_t block = diag_slot(ctx, DIAG_OFF_BLOCK);
    uint32_t first = diag_peek(block, BLK_LAST_ERROR);
    uint32_t offset;
    diag_zero(value, DIAG_VALUE_BYTES);
    p = diag_word(p, W4('v', '4', ';', 0), 3u);
    if (first == 0xffffffffu) {
        /* A recorded message is printable ASCII, so 0xffffffff can only mean
         * the resident block pointer is unknown or out of range. */
        p = diag_word(p, W4('n', 'o', '-', 'b'), 4u);
        p = diag_word(p, W4('l', 'o', 'c', 'k'), 4u);
        *p = 0u;
        return;
    }
    if ((first & 0xffu) == 0u) {
        p = diag_word(p, W4('e', 'm', 'p', 't'), 4u);
        p = diag_word(p, W4('y', 0, 0, 0), 1u);
        *p = 0u;
        return;
    }
    for (offset = 0u; offset < (uint32_t)BLK_LAST_ERROR_BYTES; offset += 4u) {
        uint32_t word = offset == 0u ? first
                                     : diag_peek(block, BLK_LAST_ERROR + offset);
        uint32_t shift;
        for (shift = 0u; shift < 32u; shift += 8u) {
            uint32_t byte = (word >> shift) & 0xffu;
            if (byte == 0u) {
                *p = 0u;
                return;
            }
            *p++ = (uint8_t)(byte >= 0x20u && byte < 0x7fu ? byte : '.');
        }
    }
    *p = 0u; /* 3 + 108 = 111 bytes worst case < 113 */
}

/* Stock registration hands the callback a copied closure whose first word is
 * the context pointer we registered; the response holder's first word is the
 * response object.  Render from live memory here, then reply with flag 1 so
 * the helper emits context->value. */
__attribute__((used, noinline, section(".text.physical_diag_rpc")))
static void diag_rpc_callback(void *callback_object, void *response_holder,
                              void *request)
{
    uint8_t *context;
    void *response;
    uint32_t tag;
    if (callback_object == (void *)0 || response_holder == (void *)0 ||
        request == (void *)0)
        return;
    context = *(uint8_t **)callback_object;
    response = *(void **)response_holder;
    if (context == (uint8_t *)0 || response == (void *)0)
        return;
    tag = diag_slot(context, DIAG_OFF_TAG);
    if (tag == 2u)
        diag_render_owner(context);
    else if (tag == 3u)
        diag_render_admit(context);
    else if (tag == 4u)
        diag_render_error(context);
    else
        diag_render_gates(context);
    STOCK_RPC_REPLY(response, request, 1u, context);
}

/* --- context pool -------------------------------------------------------- */

/* Returns the method-name length so the caller can register it. */
__attribute__((noinline)) static uint32_t diag_context_init(uint8_t *ctx,
                                                            uint32_t tag)
{
    uint8_t *p;
    diag_zero(ctx, DIAG_CTX_BYTES);
    /* blocked = "blocked" */
    p = ctx + DIAG_OFF_BLOCKED;
    p = diag_word(p, W4('b', 'l', 'o', 'c'), 4u);
    p = diag_word(p, W4('k', 'e', 'd', 0), 4u);
    /* status_key = "status" */
    p = ctx + DIAG_OFF_STATUS_KEY;
    p = diag_word(p, W4('s', 't', 'a', 't'), 4u);
    p = diag_word(p, W4('u', 's', 0, 0), 3u);
    diag_slot_set(ctx, DIAG_OFF_TAG, tag);
    /* method = "widget.mquickjs.diag" [+ '2' | '3' | '4'] */
    p = ctx + DIAG_OFF_METHOD;
    p = diag_word(p, W4('w', 'i', 'd', 'g'), 4u);
    p = diag_word(p, W4('e', 't', '.', 'm'), 4u);
    p = diag_word(p, W4('q', 'u', 'i', 'c'), 4u);
    p = diag_word(p, W4('k', 'j', 's', '.'), 4u);
    p = diag_word(p, W4('d', 'i', 'a', 'g'), 4u);
    if (tag == 1u) {
        *p = 0u;
        return 20u;
    }
    p = diag_word(p, W4('0' + tag, 0, 0, 0), 1u);
    *p = 0u;
    return 21u;
}

/* One allocation for all four contexts: fewer heap objects means less
 * fragmentation ahead of the 95568-byte resident-block allocation.  The stock
 * allocator returns 8-byte alignment and DIAG_CTX_BYTES is a multiple of 8, so
 * every carved context stays 8-aligned (the layout only needs 4). */
__attribute__((noinline)) static uint8_t *diag_pool_create(void)
{
    uint8_t *pool = (uint8_t *)STOCK_HEAP_MALLOC(DIAG_CTX_BYTES * DIAG_CTX_COUNT,
                                                 PHYSICAL_INTERNAL_CAPS);
    uint32_t index;
    if (pool == (uint8_t *)0)
        return pool;
    for (index = 0u; index < DIAG_CTX_COUNT; ++index)
        (void)diag_context_init(pool + index * DIAG_CTX_BYTES, index + 1u);
    return pool;
}

__attribute__((noinline)) static void diag_publish(uint8_t *pool,
                                                   const diag_record *rec)
{
    uint8_t *ctx = pool;
    diag_slot_set(ctx, DIAG_OFF_RECORD + 4u * DIAG_REC_GATE, rec->gate);
    diag_slot_set(ctx, DIAG_OFF_RECORD + 4u * DIAG_REC_FREE0, rec->free0);
    diag_slot_set(ctx, DIAG_OFF_RECORD + 4u * DIAG_REC_LARGEST0, rec->largest0);
    diag_slot_set(ctx, DIAG_OFF_RECORD + 4u * DIAG_REC_BLOCK, rec->block);
    diag_slot_set(ctx, DIAG_OFF_RECORD + 4u * DIAG_REC_FREE1, rec->free1);
    diag_slot_set(ctx, DIAG_OFF_RECORD + 4u * DIAG_REC_LARGEST1, rec->largest1);
    diag_slot_set(ctx, DIAG_OFF_RECORD + 4u * DIAG_REC_MAP, rec->map_result);
    diag_slot_set(ctx, DIAG_OFF_RECORD + 4u * DIAG_REC_STARTUP,
                  rec->startup_result);
    diag_slot_set(ctx, DIAG_OFF_RECORD + 4u * DIAG_REC_TICKS,
                  rec->registry_ticks);
    diag_render_gates(ctx);
}

__attribute__((noinline)) static void diag_broadcast(uint8_t *pool,
                                                     uint32_t offset,
                                                     uint32_t value)
{
    uint32_t index;
    for (index = 0u; index < DIAG_CTX_COUNT; ++index)
        diag_slot_set(pool + index * DIAG_CTX_BYTES, offset, value);
}

/* Returns ticks waited (0 if the registry was immediately available), or
 * 0xffffffff when no registry appeared and nothing was registered. */
__attribute__((noinline)) static uint32_t diag_register(uint8_t *pool)
{
    uint32_t ticks;
    for (ticks = 0u; ticks <= DIAG_REGISTRY_WAIT_TICKS; ++ticks) {
        void *registry = STOCK_RPC_REGISTRY();
        if (registry != (void *)0) {
            uint32_t index;
            for (index = 0u; index < DIAG_CTX_COUNT; ++index) {
                uint8_t *ctx = pool + index * DIAG_CTX_BYTES;
                STOCK_RPC_REGISTER(registry, ctx,
                                   (const char *)(ctx + DIAG_OFF_METHOD),
                                   index == 0u ? 20u : 21u,
                                   (void *)(uintptr_t)diag_rpc_callback);
            }
            return ticks;
        }
        STOCK_TASK_DELAY(1u);
    }
    return 0xffffffffu;
}

/* --- identical to release loader ----------------------------------------- */

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
    diag_record rec;
    uint8_t *diag;
    uint32_t entered_us;
    size_t free_internal;
    __attribute__((aligned(4))) uint32_t sha_ram[8];
    void *owned_block;
    void *aligned_block;
    uintptr_t block_start;
    int map_result;
    int started;

    /* 64-bit esp_timer_get_time truncated to 32 bits: the difference of two
     * truncations is the true elapsed microseconds modulo 2^32 (71 minutes),
     * and no 64-bit arithmetic (hence no libgcc helper) is emitted. */
    entered_us = (uint32_t)STOCK_TIME_US();

    rec.gate = 0u; rec.free0 = 0u; rec.largest0 = 0u; rec.block = 0u;
    rec.free1 = 0u; rec.largest1 = 0u; rec.map_result = 0u;
    rec.startup_result = 0u; rec.registry_ticks = 0u;

    diag = diag_pool_create();
    if (diag != (uint8_t *)0) {
        diag_publish(diag, &rec);
        rec.registry_ticks = diag_register(diag);
        diag_publish(diag, &rec);
    }

    if (!framer_physical_backend_validate(controller)) {
        rec.gate = 1u;
        goto record;
    }
    free_internal = STOCK_HEAP_FREE_SIZE(PHYSICAL_INTERNAL_CAPS);
    rec.free0 = (uint32_t)free_internal;
    rec.largest0 = (uint32_t)STOCK_HEAP_LARGEST(PHYSICAL_INTERNAL_CAPS);
    if (free_internal < (size_t)FRAMER_PHYSICAL_BLOCK_BYTES +
                            PHYSICAL_ALIGN_SLACK +
                            PHYSICAL_RUNTIME_RESERVE +
                            PHYSICAL_MAP_BOOKKEEPING_RESERVE ||
        rec.largest0 < (uint32_t)FRAMER_PHYSICAL_BLOCK_BYTES +
                           PHYSICAL_ALIGN_SLACK) {
        rec.gate = 2u;
        goto record;
    }
    /* The stock allocator returns 8-byte alignment (live: 0x3fcd0d58); the
     * module block must be 16-aligned.  Over-allocate by the slack, align up
     * for the module, and keep the raw pointer for loader-side frees.  The
     * module never frees the block (boot-lifetime adoption). */
    owned_block = STOCK_HEAP_MALLOC((size_t)FRAMER_PHYSICAL_BLOCK_BYTES +
                                        PHYSICAL_ALIGN_SLACK,
                                    PHYSICAL_INTERNAL_CAPS);
    block_start = ((uintptr_t)owned_block + 15u) & ~(uintptr_t)15u;
    aligned_block = (void *)block_start;
    rec.block = (uint32_t)(uintptr_t)owned_block;
    if (owned_block == (void *)0 || (block_start & 15u) != 0u ||
        block_start < (uintptr_t)owned_block ||
        block_start - (uintptr_t)owned_block > PHYSICAL_ALIGN_SLACK ||
        block_start < PHYSICAL_INTERNAL_BEGIN ||
        block_start + (size_t)FRAMER_PHYSICAL_BLOCK_BYTES < block_start ||
        block_start + (size_t)FRAMER_PHYSICAL_BLOCK_BYTES >
            PHYSICAL_INTERNAL_END) {
        if (owned_block != (void *)0)
            STOCK_HEAP_FREE(owned_block);
        rec.gate = 3u;
        goto record;
    }
    rec.free1 = (uint32_t)STOCK_HEAP_FREE_SIZE(PHYSICAL_INTERNAL_CAPS);
    rec.largest1 = (uint32_t)STOCK_HEAP_LARGEST(PHYSICAL_INTERNAL_CAPS);
    if (rec.free1 < PHYSICAL_RUNTIME_RESERVE + PHYSICAL_MAP_BOOKKEEPING_RESERVE ||
        rec.largest1 < PHYSICAL_MAP_BOOKKEEPING_RESERVE) {
        STOCK_HEAP_FREE(owned_block);
        rec.gate = 4u;
        goto record;
    }
    map_result = framer_mqjs_map_canary(&module);
    rec.map_result = (uint32_t)map_result;
    if (map_result != 0) {
        STOCK_HEAP_FREE(owned_block);
        rec.gate = 5u;
        goto record;
    }
    /* Publish the pre-startup record now: startup may not return promptly.
     * The aligned block is only advertised to the live renderers once it is
     * about to be handed to the module, and is withdrawn again if startup
     * rejects it (the loader then frees the allocation). */
    if (diag != (uint8_t *)0) {
        diag_publish(diag, &rec);
        diag_broadcast(diag, DIAG_OFF_BLOCK, (uint32_t)block_start);
    }
    /* The module hex-formats the digest with byte loads (digest_hex); the
     * IROM instruction bus only supports 32-bit loads (live LoadStoreError at
     * EXCVADDR framer_physical_module_sha256+16).  Copy word-wise into RAM
     * and pass the RAM copy; startup consumes it synchronously. */
    {
        volatile const uint32_t *src = framer_physical_module_sha256;
        uint32_t i;
        for (i = 0u; i < 8u; ++i)
            sha_ram[i] = src[i];
    }
    started = startup(controller, (const uint8_t *)(const void *)sha_ram,
                      aligned_block, FRAMER_PHYSICAL_BLOCK_BYTES);
    rec.startup_result = (uint32_t)started;
    if (diag != (uint8_t *)0)
        diag_broadcast(diag, DIAG_OFF_ELAPSED,
                       (uint32_t)STOCK_TIME_US() - entered_us);
    if (!started) {
        if (diag != (uint8_t *)0)
            diag_broadcast(diag, DIAG_OFF_BLOCK, 0u);
        (void)framer_mqjs_unmap_canary(&module);
        STOCK_HEAP_FREE(owned_block);
        rec.gate = 6u;
    } else {
        rec.gate = 7u;
    }
record:
    if (diag != (uint8_t *)0)
        diag_publish(diag, &rec);
}
