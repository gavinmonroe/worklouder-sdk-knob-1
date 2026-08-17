#include "framer_mquickjs_canary.h"

#include <assert.h>
#include <inttypes.h>
#include <stdio.h>
#include <string.h>

typedef union { uint64_t alignment; uint8_t bytes[65536u]; } aligned_heap;

typedef struct {
    uint64_t now_us;
    uintptr_t thread_token;
    uint32_t publishes;
    uint32_t revision;
    int32_t slots[FRAMER_MQJS_SLOT_COUNT];
} platform_state;

static uint64_t fake_now_us(void *opaque)
{
    platform_state *platform = opaque;
    return platform->now_us++;
}

static uintptr_t fake_thread_token(void *opaque)
{
    return ((platform_state *)opaque)->thread_token;
}

static int fake_publish(void *opaque,
                        const int32_t slots[FRAMER_MQJS_SLOT_COUNT],
                        uint32_t revision)
{
    platform_state *platform = opaque;
    assert(revision == platform->revision + 1u);
    memcpy(platform->slots, slots, sizeof(platform->slots));
    platform->revision = revision;
    platform->publishes++;
    return 1;
}

static void dispatch(framer_mqjs_runtime *runtime,
                     const char *name,
                     int32_t value,
                     int32_t auxiliary)
{
    assert(framer_mqjs_dispatch(runtime, name, value, auxiliary) == FRAMER_MQJS_OK);
}

static void complete_revision(framer_mqjs_runtime *runtime,
                              int32_t revision,
                              int32_t current)
{
    dispatch(runtime, "host.rpc:0xB240", revision, 0);
    /* Deliberately reordered fields. */
    dispatch(runtime, "host.rpc:0xB244", 67159078, revision);
    dispatch(runtime, "host.rpc:0xB242", 39889954, revision);
    dispatch(runtime, "host.rpc:0xB241", current, revision);
    dispatch(runtime, "host.rpc:0xB243", 57718820, revision);
    dispatch(runtime, "host.rpc:0xB24F", revision, 15);
}

int main(int argc, char **argv)
{
    static aligned_heap heap;
    static framer_mqjs_runtime runtime;
    static char source[8193u];
    platform_state platform = { .now_us = 1u, .thread_token = 0x77656174686572u };
    framer_mqjs_config config = { .opaque = &platform, .now_us = fake_now_us,
        .current_thread_token = fake_thread_token, .publish = fake_publish,
        .owner_thread_token = platform.thread_token, .callback_deadline_us = 2000u };
    framer_mqjs_telemetry telemetry;
    FILE *file;
    size_t source_len;

    assert(argc == 2);
    file = fopen(argv[1], "rb");
    assert(file != NULL);
    source_len = fread(source, 1u, 8192u, file);
    assert(!ferror(file) && feof(file) && fclose(file) == 0);
    source[source_len] = '\0';

    assert(framer_mqjs_init(&runtime, heap.bytes, sizeof(heap.bytes), &config) == FRAMER_MQJS_OK);
    assert(framer_mqjs_load(&runtime, source, source_len, 1) == FRAMER_MQJS_OK);

    /* Matching partial commit publishes nothing. */
    dispatch(&runtime, "host.rpc:0xB240", 1, 0);
    dispatch(&runtime, "host.rpc:0xB241", 21549, 1);
    dispatch(&runtime, "host.rpc:0xB24F", 1, 15);
    assert(platform.publishes == 0u);

    complete_revision(&runtime, 2, 21549);
    assert(platform.publishes == 1u && platform.slots[0] == 2 &&
           platform.slots[1] == 13620 && platform.slots[13] == 1);

    /* A stale full revision leaves the last-good mailbox untouched. */
    complete_revision(&runtime, 1, 22516);
    assert(platform.publishes == 1u && platform.slots[0] == 2 && platform.slots[1] == 13620);

    dispatch(&runtime, "tick.1s", 0, 0);
    assert(platform.publishes == 2u && platform.slots[12] == 1 && platform.slots[13] == 1);
    dispatch(&runtime, "host.rpc:0xB24D", 1, 12);
    assert(platform.publishes == 3u && platform.slots[1] == 13620 &&
           platform.slots[13] == 3 && platform.slots[14] == 12 && platform.slots[15] == 5);

    dispatch(&runtime, "host.rpc:0xB24E", 0, 0);
    assert(platform.publishes == 4u && (platform.slots[15] & 2) != 0);
    dispatch(&runtime, "tick.1s", 0, 0);
    assert(platform.publishes == 4u);
    dispatch(&runtime, "host.rpc:0xB24E", 1, 1801);
    assert(platform.publishes == 5u && platform.slots[12] == 1802 && platform.slots[13] == 3);

    /* A complete newer revision clears error and formats -12 as ASCII "-12". */
    complete_revision(&runtime, 3, 22516);
    assert(platform.publishes == 6u && platform.slots[0] == 3 &&
           platform.slots[1] == 3289389 && platform.slots[12] == 0 &&
           platform.slots[13] == 1 && platform.slots[15] == 1);

    framer_mqjs_get_telemetry(&runtime, &telemetry);
    assert(telemetry.source_loads == 1u && telemetry.commits == 6u &&
           telemetry.last_good_revision == 6u && telemetry.timeouts == 0u &&
           telemetry.out_of_memory == 0u && telemetry.exceptions == 0u);
    printf("{\"status\":\"PASS_WEATHER_SOURCE_ON_PINNED_MQUICKJS_HOST\","
           "\"sourceBytes\":%zu,\"publishes\":%" PRIu32
           ",\"appliedWeatherRevision\":%" PRId32
           ",\"heapHighWater\":%" PRIu32 "}\n",
           source_len, platform.publishes, platform.slots[0], telemetry.heap_high_water_bytes);
    framer_mqjs_destroy(&runtime);
    return 0;
}
