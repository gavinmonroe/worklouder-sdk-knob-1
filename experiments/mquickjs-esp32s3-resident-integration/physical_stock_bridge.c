/* This translation unit is intentionally fail-closed. It documents the exact
 * ESP-IDF v5.3.2 source-level ABI, but cannot become a physical candidate until
 * every address and complete function-byte digest is independently recovered
 * from the accepted 36317013... image. */
#include <stddef.h>
#include <stdint.h>

#ifndef FRAMER_PHYSICAL_CANDIDATE
#error "physical_stock_bridge.c is only for an explicitly audited physical candidate"
#endif

#ifndef FRAMER_STOCK_HEAP_CAPS_MALLOC_ADDRESS
#error "UNPROVEN_STOCK_ABI: heap_caps_malloc address/full-byte hash"
#endif
#ifndef FRAMER_STOCK_HEAP_CAPS_FREE_ADDRESS
#error "UNPROVEN_STOCK_ABI: heap_caps_free address/full-byte hash"
#endif
#ifndef FRAMER_STOCK_HEAP_CAPS_FREE_SIZE_ADDRESS
#error "UNPROVEN_STOCK_ABI: heap_caps_get_free_size address/full-byte hash"
#endif
#ifndef FRAMER_STOCK_HEAP_CAPS_LARGEST_ADDRESS
#error "UNPROVEN_STOCK_ABI: heap_caps_get_largest_free_block address/full-byte hash"
#endif
#ifndef FRAMER_STOCK_TASK_CREATE_STATIC_PINNED_ADDRESS
#error "UNPROVEN_STOCK_ABI: xTaskCreateStaticPinnedToCore address/full-byte hash and StaticTask_t size"
#endif
#ifndef FRAMER_STOCK_TASK_DELETE_ADDRESS
#error "UNPROVEN_STOCK_ABI: vTaskDelete address/full-byte hash"
#endif
#ifndef FRAMER_STOCK_TASK_STACK_HIGH_WATER_ADDRESS
#error "UNPROVEN_STOCK_ABI: uxTaskGetStackHighWaterMark address/full-byte hash and enabled config"
#endif
#ifndef FRAMER_STOCK_UI_MAILBOX_CONSUMER_ADDRESS
#error "UNIMPLEMENTED_UI_ABI: stable UI-tick mailbox consumer entry/full-byte hash"
#endif
#ifndef FRAMER_STOCK_EVENT_SOURCE_ACTIVATE_ADDRESS
#error "UNPROVEN_STOCK_ABI: generation-bound tick/knob/host-RPC source activation"
#endif
#ifndef FRAMER_STOCK_EVENT_SOURCE_REMOVE_ADDRESS
#error "UNPROVEN_STOCK_ABI: synchronized tick/knob/host-RPC source retirement"
#endif

#define FRAMER_MALLOC_CAP_8BIT (1u << 2)
#define FRAMER_MALLOC_CAP_SPIRAM (1u << 10)
#define FRAMER_MALLOC_CAP_INTERNAL (1u << 11)

typedef void *(*framer_heap_caps_malloc_fn)(size_t size, uint32_t caps);
typedef void (*framer_heap_caps_free_fn)(void *pointer);
typedef size_t (*framer_heap_caps_size_fn)(uint32_t caps);
typedef void (*framer_task_function_fn)(void *parameter);
typedef void *(*framer_task_create_static_pinned_fn)(
    framer_task_function_fn code, const char *name, uint32_t stack_depth_bytes,
    void *parameter, uint32_t priority, uint32_t *stack_buffer,
    void *static_task_buffer, int32_t core_id);
typedef void (*framer_task_delete_fn)(void *task);
typedef uint32_t (*framer_task_stack_high_water_fn)(void *task);

_Static_assert(FRAMER_MALLOC_CAP_8BIT == 4u &&
               FRAMER_MALLOC_CAP_SPIRAM == 1024u &&
               FRAMER_MALLOC_CAP_INTERNAL == 2048u,
               "ESP-IDF v5.3.2 allocation capabilities changed");

/* No callable bridge is emitted until the compile-time pins above exist. */
