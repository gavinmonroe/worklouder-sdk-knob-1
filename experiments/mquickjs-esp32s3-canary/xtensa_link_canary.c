#include "framer_mquickjs_canary.h"

#include <stdint.h>

typedef union {
    uint64_t alignment;
    uint8_t bytes[65536];
} aligned_heap;

static aligned_heap canary_heap;
static framer_mqjs_runtime canary_runtime;
static volatile uint64_t canary_clock;
static volatile int32_t canary_slots[FRAMER_MQJS_SLOT_COUNT];

/* The real ESP-IDF port supplies its own panic path. This keeps the static
 * link canary independent of newlib's process/signal stubs. */
__attribute__((noreturn)) void abort(void)
{
    for (;;) {
    }
}

static uint64_t canary_now(void *opaque)
{
    (void)opaque;
    return canary_clock++;
}

static uintptr_t canary_thread(void *opaque)
{
    (void)opaque;
    return 1u;
}

static int canary_publish(void *opaque,
                          const int32_t slots[FRAMER_MQJS_SLOT_COUNT],
                          uint32_t revision)
{
    unsigned int i;
    (void)opaque;
    (void)revision;
    for (i = 0; i < FRAMER_MQJS_SLOT_COUNT; i++)
        canary_slots[i] = slots[i];
    return 1;
}

int framer_mqjs_xtensa_canary_entry(void)
{
    static const char source[] =
        "\"use strict\";\n"
        "widget.on('tick.1s',function(event){"
        "widget.setInt(0,widget.getInt(0)+event.value);widget.commit();});";
    framer_mqjs_config config = {0};
    framer_mqjs_result result;

    config.opaque = 0;
    config.now_us = canary_now;
    config.current_thread_token = canary_thread;
    config.publish = canary_publish;
    config.owner_thread_token = 1u;
    config.callback_deadline_us = 2000u;
    result = framer_mqjs_init(&canary_runtime, canary_heap.bytes,
                              sizeof(canary_heap.bytes), &config);
    if (result == FRAMER_MQJS_OK)
        result = framer_mqjs_load(&canary_runtime, source,
                                  sizeof(source) - 1u, 1);
    if (result == FRAMER_MQJS_OK)
        result = framer_mqjs_dispatch(&canary_runtime, "tick.1s", 1, 0);
    return (int)result;
}
