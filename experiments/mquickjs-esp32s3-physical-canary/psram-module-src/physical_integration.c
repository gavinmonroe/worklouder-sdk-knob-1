#include "../mquickjs-esp32s3-resident-integration/resident_integration.h"
#include "../mquickjs-target-facade/target_facade.h"
#include "../mquickjs-esp32s3-runtime-proof/runtime_proof.h"
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
#define PHYSICAL_PSRAM_BEGIN 0x3c1d0000u
#define PHYSICAL_PSRAM_END 0x3c3d0000u
/* heap_caps_malloc returns 8-byte alignment on this build (live evidence
 * 0x3fcd0d58, loader_entry_diag.c:603); the VM heap contract is 16-byte
 * aligned, so over-allocate by one alignment quantum and align up. */
#define PHYSICAL_HEAP_ALIGN_SLACK 16u

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

extern const uint8_t framer_physical_weather_f2js_start[];
extern const uint8_t framer_physical_weather_f2js_end[];
extern const uint8_t framer_physical_weather_f2tf_start[];
extern const uint8_t framer_physical_weather_f2tf_end[];
extern const uint8_t framer_physical_weather_base_lzss_start[];
extern const uint8_t framer_physical_weather_base_lzss_end[];
extern const uint8_t framer_physical_weather_f2js_sha256[];
extern const uint8_t framer_physical_target_contract_sha256[];
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
} physical_proxy;

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
    physical_proxy proxy_storage;
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
    framer_runtime_visibility visibility;
    uint32_t runtime_events_queued;
    uint32_t runtime_events_applied;
    uint32_t runtime_events_rejected;
    framer_tf_context target;
    framer_tf_metrics target_metrics;
    uint8_t target_admitted;
    uint8_t heap_claimed;
    uint8_t reserved_flags[2];
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
_Static_assert(sizeof(physical_proxy) == 144u, "ID28 proxy layout changed");
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
    if (block == (physical_block *)0 || generation != block->generation)
        return 0;
    __atomic_store_n(&block->sources_enabled, 1u, __ATOMIC_RELEASE);
    return 1;
}

static int platform_remove_events(void *opaque, uint32_t generation)
{
    physical_block *block = (physical_block *)opaque;
    if (block == (physical_block *)0 || generation != block->generation)
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
    if (block == (physical_block *)0 || generation != block->generation)
        return 0;
    __atomic_store_n(&block->input_enabled, 1u, __ATOMIC_RELEASE);
    return 1;
}

static int platform_remove_input(void *opaque, uint32_t generation)
{
    physical_block *block = (physical_block *)opaque;
    if (block == (physical_block *)0 || generation != block->generation)
        return 0;
    __atomic_store_n(&block->input_enabled, 0u, __ATOMIC_RELEASE);
    return 1;
}

static int platform_cancel_poll(void *opaque, uint32_t generation)
{
    physical_block *block = (physical_block *)opaque;
    if (block == (physical_block *)0 || generation != block->generation)
        return 0;
    __atomic_store_n(&block->poll_armed, 0u, __ATOMIC_RELEASE);
    return 1;
}

static int platform_schedule_poll(void *opaque, uint32_t generation,
                                  uint32_t delay_ms)
{
    physical_block *block = (physical_block *)opaque;
    if (block == (physical_block *)0 || generation != block->generation ||
        delay_ms == 0u)
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
};

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
        __atomic_load_n(&block->key_probe.committed, __ATOMIC_ACQUIRE) != 0u;
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
                weather_rpc_id((uint32_t)values[0]) &&
                (uint32_t)values[3] == block->generation;
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
                &block->owner, block->generation, (uint16_t)values[0],
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
    static const char *const methods[4] = {
        FRAMER_RUNTIME_RPC_METHOD_CAP, FRAMER_RUNTIME_RPC_METHOD_TELEMETRY,
        FRAMER_RUNTIME_RPC_METHOD_EVENT, FRAMER_RUNTIME_RPC_METHOD_RECEIPT
    };
    static const uint8_t lengths[4] = { 19u, 25u, 21u, 23u };
    static void (*const callbacks[4])(void *, void *, void *) = {
        rpc_cap_callback, rpc_telemetry_callback, rpc_event_callback,
        rpc_receipt_callback
    };
    void *registry = STOCK_RPC_REGISTRY();
    uint32_t index;
    if (registry == (void *)0)
        return 0;
    for (index = 0u; index < 4u; ++index) {
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

static physical_proxy *publish_proxy(physical_block *block);

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
        framer_resident_owner_notify_input(&block->owner, block->generation);
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

static void owner_task(void *opaque)
{
    physical_block *block = (physical_block *)opaque;
    const uint32_t package_bytes = (uint32_t)(
        framer_physical_weather_f2js_end - framer_physical_weather_f2js_start);
    const uint32_t compressed_bytes = (uint32_t)(
        framer_physical_weather_base_lzss_end -
        framer_physical_weather_base_lzss_start);
    const uint32_t target_bytes = (uint32_t)(
        framer_physical_weather_f2tf_end - framer_physical_weather_f2tf_start);
    framer_f2js_result boot;
    framer_tf_result target_preflight;
    if (block == (physical_block *)0 || block->magic != PHYSICAL_MAGIC)
        for (;;)
            STOCK_TASK_DELAY(1u);
    block->boot_started_ms = now_ms();
    __atomic_store_n(&block->boot_state, 1u, __ATOMIC_RELEASE);
    /* The engine heap lives in PSRAM.  Claim it here, on the owner task that
     * will own it for the rest of the boot, so the scratch use below sees the
     * same buffer the engine will later claim.  Failing here is terminal in
     * exactly the same way the LZSS/F2TF admission failures below are. */
    if (!psram_heap_acquire(block)) {
        block->boot_finished_ms = now_ms();
        __atomic_store_n(&block->boot_state, 11u, __ATOMIC_RELEASE);
        for (;;)
            STOCK_TASK_DELAY(1u);
    }
    /* The engine heap is still unclaimed here, so it is a bounded scratch
     * buffer for immutable LZSS/F2TF admission. platform_allocate clears it
     * again before MicroQuickJS observes the heap. */
    if (!decode_lzss(block->vm_heap, PHYSICAL_FRAME_BYTES,
                     framer_physical_weather_base_lzss_start,
                     compressed_bytes)) {
        block->boot_finished_ms = now_ms();
        __atomic_store_n(&block->boot_state, 5u, __ATOMIC_RELEASE);
        for (;;)
            STOCK_TASK_DELAY(1u);
    }
    target_preflight = framer_tf_admit(
        &block->target, framer_physical_weather_f2tf_start, target_bytes,
        (const uint16_t *)(const void *)block->vm_heap,
        FRAMER_TF_CANVAS_PIXELS, block->generation,
        framer_physical_weather_f2js_sha256,
        framer_physical_target_contract_sha256, current_task_token());
    zero_bytes(&block->target, sizeof(block->target));
    zero_bytes(block->vm_heap, (size_t)FRAMER_F2JS_HEAP_BYTES);
    if (target_preflight != FRAMER_TF_OK) {
        block->boot_finished_ms = now_ms();
        __atomic_store_n(&block->boot_state, 6u, __ATOMIC_RELEASE);
        for (;;)
            STOCK_TASK_DELAY(1u);
    }
    boot = framer_resident_owner_boot_on_task(
        &block->owner, framer_physical_weather_f2js_start, package_bytes);
    block->boot_finished_ms = now_ms();
    if (boot != FRAMER_F2JS_ADMIT_OK) {
        __atomic_store_n(&block->sources_enabled, 0u, __ATOMIC_RELEASE);
        __atomic_store_n(&block->boot_state, 3u, __ATOMIC_RELEASE);
    } else {
        /* Setup/UI lifecycle owns stock registry mutation. This ACK merely
         * tells that task all VM and immutable-asset admission succeeded. */
        __atomic_store_n(&block->boot_state, 2u, __ATOMIC_RELEASE);
    }
    for (;;) {
        uint32_t milliseconds = now_ms();
        uint32_t tick100 = milliseconds / 100u;
        uint32_t seconds = milliseconds / 1000u;
        uint32_t generation = block->generation;
        owner_begin_focus_release(block, milliseconds);
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
        STOCK_TASK_DELAY(1u);
        block->owner_delays += 1u;
    }
}

static void proxy_build(physical_proxy *proxy)
{
    uint32_t elapsed = 0u;
    if (proxy == (physical_proxy *)0 || proxy->magic != PHYSICAL_PROXY_MAGIC ||
        proxy->block == (physical_block *)0 ||
        !framer_physical_lifecycle_root_ready(proxy->root))
        return;
    proxy->source_published = 0u;
    proxy->image = STOCK_IMAGE_CREATE(proxy->root);
    if (proxy->image == (void *)0)
        return;
    if (proxy->block->hidden_at_ms != 0u) {
        elapsed = (now_ms() - proxy->block->hidden_at_ms) / 1000u;
        if (elapsed > 604800u)
            elapsed = 604800u;
    }
    proxy->block->hidden_at_ms = 0u;
    __atomic_store_n(&proxy->block->visible, 1u, __ATOMIC_SEQ_CST);
    if (framer_physical_focus_can_reopen(
            1u,
            __atomic_load_n(&proxy->block->focus_release_requested,
                            __ATOMIC_ACQUIRE),
            __atomic_load_n(&proxy->block->focus_release_applied,
                            __ATOMIC_ACQUIRE),
            __atomic_load_n(&proxy->block->focus_release_draining,
                            __ATOMIC_ACQUIRE),
            __atomic_load_n(
                &proxy->block->owner.telemetry.permanently_disabled,
                __ATOMIC_ACQUIRE))) {
        __atomic_store_n(&proxy->block->focus_reopen_pending, 0u,
                         __ATOMIC_RELEASE);
        __atomic_store_n(&proxy->block->input_enabled, 1u, __ATOMIC_RELEASE);
    } else {
        __atomic_store_n(&proxy->block->focus_reopen_pending, 1u,
                         __ATOMIC_RELEASE);
        __atomic_store_n(&proxy->block->input_enabled, 0u, __ATOMIC_RELEASE);
    }
    (void)framer_runtime_visibility_set(&proxy->block->visibility, 1);
    (void)framer_resident_owner_enqueue_host_rpc(
        &proxy->block->owner, proxy->block->generation, 0xb24eu, 1,
        (int32_t)elapsed);
}

static void proxy_cleanup(physical_proxy *proxy)
{
    if (proxy == (physical_proxy *)0 || proxy->magic != PHYSICAL_PROXY_MAGIC ||
        proxy->block == (physical_block *)0)
        return;
    /* Close both producer gates before publishing the owner-thread release
     * request. A wrapper that already crossed the gate is counted and must
     * retire before owner_begin_focus_release snapshots the raw held bitmap. */
    __atomic_store_n(&proxy->block->visible, 0u, __ATOMIC_SEQ_CST);
    __atomic_store_n(&proxy->block->input_enabled, 0u, __ATOMIC_SEQ_CST);
    __atomic_store_n(&proxy->block->poll_armed, 0u, __ATOMIC_RELEASE);
    __atomic_add_fetch(&proxy->block->focus_release_requested, 1u,
                       __ATOMIC_SEQ_CST);
    (void)framer_runtime_visibility_set(&proxy->block->visibility, 0);
    proxy->block->hidden_at_ms = now_ms();
    (void)framer_resident_owner_enqueue_host_rpc(
        &proxy->block->owner, proxy->block->generation, 0xb24eu, 0, 0);
    proxy->image = (void *)0;
    proxy->source_published = 0u;
}

__attribute__((used, visibility("default")))
uint32_t framer_physical_weather_id(physical_proxy *proxy)
{
    (void)proxy;
    return PHYSICAL_SCREEN_ID;
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

static void proxy_tick(physical_proxy *proxy)
{
    physical_block *block;
    uint8_t *framebuffer;
    void (*old_tick)(void *);
    framer_tf_result result;
    uint64_t started;
    const uint32_t compressed_bytes = (uint32_t)(
        framer_physical_weather_base_lzss_end -
        framer_physical_weather_base_lzss_start);
    const uint32_t target_bytes = (uint32_t)(
        framer_physical_weather_f2tf_end - framer_physical_weather_f2tf_start);
    if (proxy == (physical_proxy *)0 || proxy->magic != PHYSICAL_PROXY_MAGIC ||
        proxy->block == (physical_block *)0 || proxy->backend == (void *)0 ||
        proxy->image == (void *)0 || !sidecar_old_tick(proxy->backend, &old_tick))
        return;
    block = proxy->block;
    started = STOCK_TIME_US();
    old_tick(proxy->backend);
    framebuffer = (uint8_t *)proxy->backend + 160u;
    if (!decode_lzss(framebuffer, PHYSICAL_FRAME_BYTES,
                     framer_physical_weather_base_lzss_start,
                     compressed_bytes)) {
        __atomic_add_fetch(&block->ui_render_failures, 1u, __ATOMIC_RELAXED);
        goto measured_exit;
    }
    if (block->target_admitted == 0u) {
        result = framer_tf_admit(
            &block->target, framer_physical_weather_f2tf_start, target_bytes,
            (const uint16_t *)(const void *)framebuffer,
            FRAMER_TF_CANVAS_PIXELS, block->generation,
            framer_physical_weather_f2js_sha256,
            framer_physical_target_contract_sha256,
            current_task_token());
        if (result != FRAMER_TF_OK) {
            __atomic_add_fetch(&block->ui_render_failures, 1u,
                               __ATOMIC_RELAXED);
            goto measured_exit;
        }
        block->target_admitted = 1u;
    }
    result = framer_tf_render(
        &block->target, (const framer_tf_mailbox *)(const void *)&block->owner.mailbox,
        (uint16_t *)(void *)framebuffer, FRAMER_TF_CANVAS_PIXELS,
        current_task_token(), &block->target_metrics);
    if (result == FRAMER_TF_OK) {
        framer_runtime_visibility_publish(
            &block->visibility, block->generation,
            block->target_metrics.applied_revision);
        proxy->descriptor_flip ^= 1u;
        STOCK_IMAGE_SET_SOURCE(
            proxy->image,
            &proxy->descriptor[proxy->descriptor_flip & 1u]);
        if (proxy->source_published == 0u) {
            STOCK_OBJECT_ALIGN(proxy->image, 9, 0, 0);
            proxy->source_published = 1u;
        }
        __atomic_store_n(&block->ui_applied_revision,
                         block->target_metrics.applied_revision,
                         __ATOMIC_RELEASE);
    } else if (result != FRAMER_TF_HIDDEN) {
        __atomic_add_fetch(&block->ui_render_failures, 1u, __ATOMIC_RELAXED);
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
            &proxy->block->owner, proxy->block->generation,
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
    if (!framer_physical_focus_accepts_key(
            __atomic_load_n(&block->visible, __ATOMIC_SEQ_CST),
            __atomic_load_n(&block->input_enabled, __ATOMIC_ACQUIRE)))
        goto finished;
    block->last_raw_token = native_token;
    block->last_raw_level = level;
    /* No JS edge is emitted during discovery. The gate flips only after live
     * down+up observations for exact Space and LeftShift; the next physical
     * edge begins a clean logical session. Unknown tokens never wildcard-map. */
    if (framer_physical_key_gate_observe_and_map(
            &block->key_probe, native_token, level, &logical_token))
        (void)framer_resident_owner_input_after_stock(
            &block->owner, block->generation, logical_token, level != 0u,
            now_ms());
finished:
    __atomic_sub_fetch(&block->input_sink_inflight, 1u, __ATOMIC_SEQ_CST);
}

static physical_proxy *publish_proxy(physical_block *block)
{
    physical_proxy *proxy;
    uint32_t index;
    if (block == (physical_block *)0 || block->registry == (void *)0 ||
        block->navigation == (void *)0 || block->backend == (void *)0 ||
        __atomic_load_n(&block->boot_state, __ATOMIC_ACQUIRE) != 2u)
        return (physical_proxy *)0;
    proxy = &block->proxy_storage;
    zero_bytes(proxy, sizeof(*proxy));
    proxy->vptr = STOCK_BASE_VTABLE;
    proxy->common_24[2] = 10u;
    proxy->backend = block->backend;
    proxy->block = block;
    proxy->magic = PHYSICAL_PROXY_MAGIC;
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
    block->proxy = proxy;
    STOCK_ADD_CONTROLLER(block->registry, proxy);
    /* addController is a void, boot-lifetime stock commit.  Once called this
     * function cannot report a recoverable failure or invalidate proxy. */
    return proxy;
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
    framer_resident_owner_init_shell(&block->owner, &engine_api, &platform);
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
        STOCK_ADD_NAVIGATION(block->navigation, PHYSICAL_SCREEN_ID);
        __atomic_store_n(&block->navigation_published, 1u, __ATOMIC_RELEASE);
        __atomic_store_n(&block->boot_state, 7u, __ATOMIC_RELEASE);
        __atomic_store_n(&block->rpc_ready, 1u, __ATOMIC_RELEASE);
    } else if (__atomic_load_n(&block->boot_state, __ATOMIC_ACQUIRE) == 1u) {
        __atomic_store_n(&block->boot_state, 9u, __ATOMIC_RELEASE);
    }
    return 1;
}
