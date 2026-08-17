#include "framer_mquickjs_canary.h"

#include <stdint.h>

#define FRAMER_MQJS_MODULE_MAGIC 0x534a514dUL
#define FRAMER_MQJS_MODULE_ABI_VERSION 3u
#define FRAMER_MQJS_TEXT_VADDR 0x423d0000UL
#define FRAMER_MQJS_TEXT_CAPACITY 0x00020000UL
#define FRAMER_MQJS_RODATA_VADDR 0x3c3f0000UL
#define FRAMER_MQJS_RODATA_CAPACITY 0x00010000UL

#ifndef FRAMER_MQJS_ABI_SHA256_W0
#error "The fixed module must pin the complete public engine/input ABI digest"
#endif

typedef struct {
    uint32_t magic;
    uint16_t abi_version;
    uint16_t descriptor_bytes;
    uint32_t text_vaddr;
    uint32_t text_capacity;
    uint32_t rodata_vaddr;
    uint32_t rodata_capacity;
    uint32_t minimum_heap_bytes;
    uint32_t runtime_storage_bytes;
    uint32_t slot_count;
    uint32_t abi_sha256[8];
    uintptr_t probe;
    uintptr_t init;
    uintptr_t load;
    uintptr_t dispatch;
    uintptr_t input_enqueue;
    uintptr_t input_request_release_all;
    uintptr_t input_request_focus_release;
    uintptr_t input_drain;
    uintptr_t input_get_observation;
    uintptr_t get_telemetry;
    uintptr_t get_last_good_slots;
    uintptr_t destroy;
} framer_mqjs_module_descriptor;

uint32_t framer_mqjs_module_probe(void)
{
    return FRAMER_MQJS_MODULE_MAGIC;
}

/* The proof links without newlib process stubs. A physical adapter must route
 * a fatal engine invariant into its watchdog/recovery policy. */
__attribute__((noreturn)) void abort(void)
{
    for (;;) {
    }
}

__attribute__((used, section(".rodata.framer_mqjs_descriptor"), aligned(16)))
const framer_mqjs_module_descriptor framer_mqjs_module = {
    FRAMER_MQJS_MODULE_MAGIC,
    FRAMER_MQJS_MODULE_ABI_VERSION,
    (uint16_t)sizeof(framer_mqjs_module_descriptor),
    FRAMER_MQJS_TEXT_VADDR,
    FRAMER_MQJS_TEXT_CAPACITY,
    FRAMER_MQJS_RODATA_VADDR,
    FRAMER_MQJS_RODATA_CAPACITY,
    FRAMER_MQJS_MIN_HEAP_BYTES,
    FRAMER_MQJS_RUNTIME_STORAGE_BYTES,
    FRAMER_MQJS_SLOT_COUNT,
    {
        FRAMER_MQJS_ABI_SHA256_W0, FRAMER_MQJS_ABI_SHA256_W1,
        FRAMER_MQJS_ABI_SHA256_W2, FRAMER_MQJS_ABI_SHA256_W3,
        FRAMER_MQJS_ABI_SHA256_W4, FRAMER_MQJS_ABI_SHA256_W5,
        FRAMER_MQJS_ABI_SHA256_W6, FRAMER_MQJS_ABI_SHA256_W7,
    },
    (uintptr_t)framer_mqjs_module_probe,
    (uintptr_t)framer_mqjs_init,
    (uintptr_t)framer_mqjs_load,
    (uintptr_t)framer_mqjs_dispatch,
    (uintptr_t)framer_mqjs_input_enqueue,
    (uintptr_t)framer_mqjs_input_request_release_all,
    (uintptr_t)framer_mqjs_input_request_focus_release,
    (uintptr_t)framer_mqjs_input_drain,
    (uintptr_t)framer_mqjs_input_get_observation,
    (uintptr_t)framer_mqjs_get_telemetry,
    (uintptr_t)framer_mqjs_get_last_good_slots,
    (uintptr_t)framer_mqjs_destroy,
};
