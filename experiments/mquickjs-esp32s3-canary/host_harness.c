#include "framer_mquickjs_canary.h"

#include <assert.h>
#include <inttypes.h>
#include <stdio.h>
#include <string.h>

#ifndef FRAMER_MQJS_HOST_HEAP_BYTES
#define FRAMER_MQJS_HOST_HEAP_BYTES 65536u
#endif

typedef union { uint64_t alignment; uint8_t bytes[FRAMER_MQJS_HOST_HEAP_BYTES]; } aligned_heap;

typedef struct {
    uint64_t now_us, clock_step_us;
    uintptr_t thread_token;
    uint32_t mailbox_publishes, mailbox_revision;
    int reject_publish;
    int32_t mailbox_slots[FRAMER_MQJS_SLOT_COUNT];
} platform_state;

static uint64_t fake_now_us(void *opaque)
{
    platform_state *platform = opaque;
    uint64_t result = platform->now_us;
    platform->now_us += platform->clock_step_us;
    return result;
}

static uintptr_t fake_thread_token(void *opaque)
{
    return ((platform_state *)opaque)->thread_token;
}

/* Models one owner-task-to-UI atomic mailbox publication. */
static int fake_publish(void *opaque,
                        const int32_t slots[FRAMER_MQJS_SLOT_COUNT],
                        uint32_t revision)
{
    platform_state *platform = opaque;
    if (platform->reject_publish) return 0;
    assert(revision == platform->mailbox_revision + 1u);
    memcpy(platform->mailbox_slots, slots, sizeof(platform->mailbox_slots));
    platform->mailbox_revision = revision;
    platform->mailbox_publishes++;
    return 1;
}

static const char widget_source[] =
    "\"use strict\";\n"
    "if (typeof eval !== 'undefined' || typeof Function !== 'undefined' ||"
    " typeof Date !== 'undefined' || typeof Math !== 'undefined' ||"
    " typeof JSON !== 'undefined' || typeof RegExp !== 'undefined' ||"
    " typeof console !== 'undefined' || typeof load !== 'undefined' ||"
    " typeof setTimeout !== 'undefined' || typeof Framer !== 'undefined')"
    " throw 'unsafe native surface';"
    "widget.on('tick.100ms', function(event) {});"
    "widget.on('tick.1ms', function(event) {"
    " if (event.type !== 'tick.1ms' || event.value < 1) throw 'bad 1ms tick'; });"
    "widget.on('tick.1s', function(event) { widget.setInt(0, widget.getInt(0) + event.value); widget.commit(); });"
    "widget.on('input.fn-bottom-knob', function(event) { if (!event.fn) throw 'missing fn';"
    " if (widget.isHeld(event, 0)) widget.setInt(14, widget.getInt(14) + 1);"
    " widget.setInt(1, widget.getInt(1) + event.delta); widget.commit(); });"
    "widget.on('host.rpc:0xB201', function(event) {"
    " if (event.value === 12) { widget.setInt(2, 1200); return; }"
    " if (event.value === 13) { widget.setInt(2, 1300); throw 'host exception'; }"
    " if (event.value === 77) { widget.setInt(2, 7700); var values = []; while (true) values.push('0123456789abcdef'); }"
    " if (event.value === 99) { widget.setInt(2, 9900); while (true) {} }"
    " widget.setInt(2, event.value + event.auxiliary); widget.commit(); });"
    "widget.on('input.key.down', function(event) {"
    " if (event.type !== 'input.key.down' || event.repeat || !widget.isHeld(event, event.key)) throw 'bad key down';"
    " if (event.key === 3) throw 'key exception';"
    " widget.setInt(3, widget.getInt(3) + 1); widget.setInt(8, event.sequence);"
    " widget.setInt(9, event.heldMask); widget.setInt(11, event.key); widget.commit(); });"
    "widget.on('input.key.up', function(event) {"
    " if (event.type !== 'input.key.up' || event.repeat || widget.isHeld(event, event.key)) throw 'bad key up';"
    " widget.setInt(4, widget.getInt(4) + 1);"
    " if (event.synthetic) { widget.setInt(10, widget.getInt(10) + 1); widget.setInt(15, event.timestampMs); }"
    " widget.setInt(8, event.sequence); widget.setInt(9, event.heldMask);"
    " widget.setInt(11, event.key); widget.commit(); });"
    "widget.on('input.key.hold', function(event) {"
    " if (!event.repeat || event.holdCount < 1 || !widget.isHeld(event, event.key)) throw 'bad hold';"
    " widget.setInt(5, widget.getInt(5) + 1); widget.setInt(8, event.sequence);"
    " widget.setInt(13, event.holdCount); widget.commit(); });"
    "widget.on('input.chord.down', function(event) {"
    " if (event.chord !== 0 || event.heldMask !== 3) throw 'bad chord down';"
    " widget.setInt(6, widget.getInt(6) + 1); widget.setInt(8, event.sequence);"
    " widget.setInt(12, event.chord); widget.commit(); });"
    "widget.on('input.chord.up', function(event) {"
    " if (event.chord !== 0) throw 'bad chord up';"
    " widget.setInt(7, widget.getInt(7) + 1); widget.setInt(8, event.sequence);"
    " widget.setInt(12, event.chord); widget.commit(); });";

static const char missing_strict_source[] = "widget.on('tick.1s',function(){});";
static const char sloppy_global_source[] = "\"use strict\";\nframer_sloppy_global = 1;";
static const char invalid_source[] = "\"use strict\";\nFramer.on('tick', function( {";
static const char input_fairness_source[] =
    "\"use strict\";\n"
    "var failKeyFive=true;"
    "widget.on('input.key.down',function(event){"
    " if(event.key===5&&failKeyFive){failKeyFive=false;throw 'queued key failure';}"
    " widget.setInt(3,widget.getInt(3)+1);"
    " if(event.key===0)widget.setInt(14,event.heldMask);"
    " if(event.key===1)widget.setInt(15,event.heldMask);widget.commit();});"
    "widget.on('input.key.up',function(event){widget.setInt(4,widget.getInt(4)+1);widget.commit();});"
    "widget.on('input.key.hold',function(event){"
    " widget.setInt(5,widget.getInt(5)|(1<<event.key));widget.commit();});"
    "widget.on('input.chord.down',function(event){widget.setInt(10,event.sequence);widget.commit();});"
    "widget.on('input.chord.up',function(event){widget.setInt(11,event.sequence);"
    " if(event.synthetic)widget.setInt(12,event.reason);widget.commit();});"
    "widget.on('tick.100ms',function(event){widget.setInt(0,widget.getInt(0)+1);"
    " widget.setInt(6,event.sequence);widget.setInt(9,widget.getInt(3));widget.commit();});"
    "widget.on('input.fn-bottom-knob',function(event){widget.setInt(1,event.delta);"
    " widget.setInt(7,event.sequence);widget.commit();});"
    "widget.on('host.rpc:0xB201',function(event){widget.setInt(2,event.value+event.auxiliary);"
    " widget.setInt(8,event.sequence);widget.commit();});";

static const char all_throw_source[] =
    "\"use strict\";\n"
    "widget.on('input.key.down',function(event){"
    "if(event.key===2)throw 'bounded third-attempt failure';"
    "widget.setInt(0,widget.getInt(0)+1);widget.commit();});";

static void configure(framer_mqjs_config *config, platform_state *platform)
{
    memset(config, 0, sizeof(*config));
    config->opaque = platform;
    config->now_us = fake_now_us;
    config->current_thread_token = fake_thread_token;
    config->publish = fake_publish;
    config->owner_thread_token = 0x51u;
    config->callback_deadline_us = 2000u;
    config->input.key_count = 4u;
    config->input.chord_count = 1u;
    config->input.native_tokens[0] = 0u;
    config->input.native_tokens[1] = 0x11223344u;
    config->input.native_tokens[2] = 0x55667788u;
    config->input.native_tokens[3] = 0xdeadbeefu;
    config->input.chord_masks[0] = 3u;
    config->input.debounce_ms = 5u;
    config->input.hold_delay_ms = 100u;
    config->input.hold_cadence_ms = 50u;
}

int main(void)
{
    aligned_heap heap;
    framer_mqjs_runtime runtime, wrap_runtime, focus_runtime, failure_runtime;
    platform_state platform = {0};
    framer_mqjs_config config;
    framer_mqjs_telemetry telemetry;
    framer_mqjs_telemetry batch_telemetry;
    framer_mqjs_telemetry focus_telemetry;
    framer_mqjs_telemetry failure_telemetry;
    framer_mqjs_input_observation observation;
    int32_t slots[FRAMER_MQJS_SLOT_COUNT];
    uint32_t before;
    unsigned int index;

    platform.thread_token = 0x51u;
    configure(&config, &platform);
    assert(framer_mqjs_init(&runtime, heap.bytes, sizeof(heap.bytes), &config) == FRAMER_MQJS_OK);
    assert(framer_mqjs_input_get_observation(&runtime, &observation) == 0);
    assert(framer_mqjs_load(&runtime, widget_source, sizeof(widget_source) - 1u, 0) == FRAMER_MQJS_ERR_NOT_ADMITTED);
    assert(framer_mqjs_load(&runtime, widget_source, sizeof(widget_source) - 1u, 1) == FRAMER_MQJS_OK);
    assert(framer_mqjs_load(&runtime, missing_strict_source,
                            sizeof(missing_strict_source) - 1u, 1) ==
           FRAMER_MQJS_ERR_SOURCE);
    assert(framer_mqjs_load(&runtime, sloppy_global_source,
                            sizeof(sloppy_global_source) - 1u, 1) ==
           FRAMER_MQJS_ERR_EXCEPTION);

    assert(framer_mqjs_dispatch(&runtime, "tick.1ms", 3, 0) == FRAMER_MQJS_OK);
    assert(framer_mqjs_dispatch(&runtime, "tick.100ms", 1, 0) == FRAMER_MQJS_OK);
    assert(platform.mailbox_publishes == 0u);
    assert(framer_mqjs_dispatch(&runtime, "tick.1s", 1, 0) == FRAMER_MQJS_OK);
    assert(framer_mqjs_dispatch(&runtime, "input.fn-bottom-knob", -3, 0) == FRAMER_MQJS_OK);
    assert(framer_mqjs_dispatch(&runtime, "host.rpc:0xB201", 7, 5) == FRAMER_MQJS_OK);
    assert(platform.mailbox_publishes == 3u && platform.mailbox_revision == 3u);
    assert(platform.mailbox_slots[0] == 1 && platform.mailbox_slots[1] == -3 && platform.mailbox_slots[2] == 12);
    assert(framer_mqjs_dispatch(&runtime, "host.rpc:45569", 12, 0) == FRAMER_MQJS_OK);
    assert(platform.mailbox_publishes == 3u && platform.mailbox_slots[2] == 12);

    platform.thread_token = 0x99u;
    assert(framer_mqjs_dispatch(&runtime, "tick.1s", 1, 0) == FRAMER_MQJS_ERR_WRONG_THREAD);
    platform.thread_token = 0x51u;
    assert(framer_mqjs_load(&runtime, invalid_source, sizeof(invalid_source) - 1u, 1) == FRAMER_MQJS_ERR_EXCEPTION);
    assert(framer_mqjs_dispatch(&runtime, "tick.1s", 2, 0) == FRAMER_MQJS_OK);
    assert(platform.mailbox_slots[0] == 3 && platform.mailbox_publishes == 4u);
    assert(framer_mqjs_dispatch(&runtime, "host.rpc:0xB201", 13, 0) == FRAMER_MQJS_ERR_EXCEPTION);
    assert(platform.mailbox_publishes == 4u);
    assert(framer_mqjs_dispatch(&runtime, "host.rpc:0xB201", 8, 1) == FRAMER_MQJS_OK);
    assert(platform.mailbox_slots[2] == 9 && platform.mailbox_publishes == 5u);
    platform.clock_step_us = 1000u;
    assert(framer_mqjs_dispatch(&runtime, "host.rpc:0xB201", 99, 0) == FRAMER_MQJS_ERR_TIMEOUT);
    platform.clock_step_us = 0u;
    assert(framer_mqjs_dispatch(&runtime, "tick.1s", 4, 0) == FRAMER_MQJS_OK);
    assert(platform.mailbox_slots[0] == 7 && platform.mailbox_publishes == 6u);
    assert(framer_mqjs_dispatch(&runtime, "host.rpc:0xB201", 77, 0) == FRAMER_MQJS_ERR_OOM);
    assert(framer_mqjs_dispatch(&runtime, "input.fn-bottom-knob", 5, 0) == FRAMER_MQJS_OK);
    assert(platform.mailbox_slots[1] == 2 && platform.mailbox_publishes == 7u);
    platform.reject_publish = 1;
    assert(framer_mqjs_dispatch(&runtime, "tick.1s", 100, 0) == FRAMER_MQJS_ERR_PUBLISH);
    platform.reject_publish = 0;
    assert(framer_mqjs_dispatch(&runtime, "tick.1s", 1, 0) == FRAMER_MQJS_OK);
    assert(platform.mailbox_slots[0] == 8 && platform.mailbox_publishes == 8u);

    /* Producer enqueue is non-consuming and never calls JS. Handler failure
     * recovers without sticking the native held state. */
    platform.thread_token = 0x99u;
    before = platform.mailbox_publishes;
    assert(framer_mqjs_input_enqueue(&runtime, 0xdeadbeefu, 1, 900u) == FRAMER_MQJS_OK);
    assert(platform.mailbox_publishes == before);
    assert(framer_mqjs_input_drain(&runtime, 905u) == FRAMER_MQJS_ERR_WRONG_THREAD);
    platform.thread_token = 0x51u;
    assert(framer_mqjs_input_drain(&runtime, 905u) == FRAMER_MQJS_ERR_EXCEPTION);
    assert(framer_mqjs_input_enqueue(&runtime, 0xdeadbeefu, 0, 910u) == FRAMER_MQJS_OK);
    assert(framer_mqjs_input_drain(&runtime, 915u) == FRAMER_MQJS_OK);

    /* Duplicate and bounced raw levels create one down and one up. */
    assert(framer_mqjs_input_enqueue(&runtime, 0u, 1, 1000u) == FRAMER_MQJS_OK);
    assert(framer_mqjs_input_enqueue(&runtime, 0u, 1, 1001u) == FRAMER_MQJS_OK);
    assert(framer_mqjs_input_drain(&runtime, 1004u) == FRAMER_MQJS_OK);
    assert(framer_mqjs_input_enqueue(&runtime, 0u, 0, 1006u) == FRAMER_MQJS_OK);
    assert(framer_mqjs_input_enqueue(&runtime, 0u, 1, 1007u) == FRAMER_MQJS_OK);
    assert(framer_mqjs_input_drain(&runtime, 1012u) == FRAMER_MQJS_OK);
    /* Cross-trigger binding: ordinary owner-task events carry the same held
     * snapshot, so authored JS can gate Fn+knob on an admitted key. */
    assert(framer_mqjs_dispatch(&runtime, "input.fn-bottom-knob", 17, 0) ==
           FRAMER_MQJS_OK);
    assert(platform.mailbox_slots[14] == 1);
    assert(framer_mqjs_input_enqueue(&runtime, 0u, 0, 1013u) == FRAMER_MQJS_OK);
    assert(framer_mqjs_input_drain(&runtime, 1018u) == FRAMER_MQJS_OK);

    /* Reverse producer order at one timestamp yields ascending key IDs and one
     * order-independent exact-mask chord edge. */
    assert(framer_mqjs_input_enqueue(&runtime, 0x11223344u, 1, 1020u) == FRAMER_MQJS_OK);
    assert(framer_mqjs_input_enqueue(&runtime, 0u, 1, 1020u) == FRAMER_MQJS_OK);
    assert(framer_mqjs_input_drain(&runtime, 1025u) == FRAMER_MQJS_OK);
    before = platform.mailbox_publishes;
    assert(framer_mqjs_input_drain(&runtime, 1124u) == FRAMER_MQJS_OK);
    assert(platform.mailbox_publishes == before);
    assert(framer_mqjs_input_drain(&runtime, 1125u) == FRAMER_MQJS_OK);
    assert(framer_mqjs_input_enqueue(&runtime, 0x55667788u, 1, 1130u) == FRAMER_MQJS_OK);
    assert(framer_mqjs_input_drain(&runtime, 1135u) == FRAMER_MQJS_OK);
    assert(framer_mqjs_input_enqueue(&runtime, 0x55667788u, 0, 1140u) == FRAMER_MQJS_OK);
    assert(framer_mqjs_input_drain(&runtime, 1145u) == FRAMER_MQJS_OK);
    assert(framer_mqjs_input_enqueue(&runtime, 0u, 0, 1150u) == FRAMER_MQJS_OK);
    assert(framer_mqjs_input_drain(&runtime, 1155u) == FRAMER_MQJS_OK);
    assert(framer_mqjs_input_enqueue(&runtime, 0x11223344u, 0, 1160u) == FRAMER_MQJS_OK);
    assert(framer_mqjs_input_drain(&runtime, 1165u) == FRAMER_MQJS_OK);

    /* Learn/poll exposes the opaque token and never invents a physical name. */
    assert(framer_mqjs_input_enqueue(&runtime, 0xcafebabeu, 1, 1190u) == FRAMER_MQJS_NO_HANDLER);
    assert(framer_mqjs_input_get_observation(&runtime, &observation) == 1);
    assert(observation.native_token == 0xcafebabeu && observation.pressed == 1u &&
           observation.timestamp_ms == 1190u && observation.observation_sequence > 0u);

    /* Overflow drops stale records and resyncs to the authoritative final up. */
    assert(framer_mqjs_input_enqueue(&runtime, 0u, 1, 1200u) == FRAMER_MQJS_OK);
    assert(framer_mqjs_input_drain(&runtime, 1205u) == FRAMER_MQJS_OK);
    for (index = 0; index < FRAMER_MQJS_INPUT_QUEUE_RECORDS + 1u; index++) {
        int pressed = (index & 1u) != 0u;
        framer_mqjs_result queued = framer_mqjs_input_enqueue(&runtime, 0u, pressed, 1210u + index);
        assert(queued == (index < FRAMER_MQJS_INPUT_QUEUE_RECORDS ? FRAMER_MQJS_OK : FRAMER_MQJS_INPUT_RESYNC_QUEUED));
    }
    assert(framer_mqjs_input_drain(&runtime, 1300u) == FRAMER_MQJS_OK);

    /* One late poll coalesces missed hold cadence into one event. */
    assert(framer_mqjs_input_enqueue(&runtime, 0x11223344u, 1, 1400u) == FRAMER_MQJS_OK);
    assert(framer_mqjs_input_drain(&runtime, 1405u) == FRAMER_MQJS_OK);
    before = platform.mailbox_publishes;
    assert(framer_mqjs_input_drain(&runtime, 2000u) == FRAMER_MQJS_OK);
    assert(platform.mailbox_publishes == before + 1u);
    assert(framer_mqjs_input_drain(&runtime, 2000u) == FRAMER_MQJS_OK);
    assert(platform.mailbox_publishes == before + 1u);

    /* Release first gates ingress, then owner-side resync emits exact synthetic
     * releases. No callback can race the held bitmap back on in this session. */
    /* A newer producer observation cannot make terminal release fail open. */
    assert(framer_mqjs_input_enqueue(&runtime, 0xabcdef01u, 1, 2002u) ==
           FRAMER_MQJS_NO_HANDLER);
    assert(framer_mqjs_input_request_release_all(&runtime, 2001u, FRAMER_MQJS_INPUT_REASON_DISCONNECT) == FRAMER_MQJS_INPUT_RESYNC_QUEUED);
    assert(framer_mqjs_input_drain(&runtime, 2001u) == FRAMER_MQJS_OK);
    assert(framer_mqjs_input_enqueue(&runtime, 0u, 1, 2002u) == FRAMER_MQJS_ERR_DISABLED);

    framer_mqjs_get_last_good_slots(&runtime, slots);
    assert(memcmp(slots, platform.mailbox_slots, sizeof(slots)) == 0);
    framer_mqjs_get_telemetry(&runtime, &telemetry);
    assert(telemetry.enabled == 1u && telemetry.source_loads == 1u);
    assert(telemetry.source_rejections == 2u && telemetry.wrong_thread == 2u);
    assert(telemetry.last_good_revision == 29u && telemetry.commits == 29u);
    assert(telemetry.timeouts == 1u && telemetry.out_of_memory == 1u);
    assert(telemetry.publish_failures == 1u && telemetry.resets == 7u && telemetry.exceptions == 4u);
    assert(telemetry.key_down_events == 7u && telemetry.key_up_events == 7u && telemetry.key_hold_events == 3u);
    assert(telemetry.chord_down_events == 2u && telemetry.chord_up_events == 2u);
    assert(telemetry.input_queue_overflows == 1u && telemetry.input_resyncs == 2u &&
           telemetry.input_resync_sequence == 2u && telemetry.duplicate_key_levels == 1u);
    assert(telemetry.max_input_events_per_drain > 0u &&
           telemetry.max_input_events_per_drain <=
               FRAMER_MQJS_INPUT_MAX_EVENTS_PER_DRAIN);
    assert(telemetry.last_event_sequence == 37u && telemetry.held_key_mask == 0u);
    assert(platform.mailbox_slots[3] == 6 && platform.mailbox_slots[4] == 7 &&
           platform.mailbox_slots[5] == 3 && platform.mailbox_slots[6] == 2 &&
           platform.mailbox_slots[7] == 2 && platform.mailbox_slots[8] == 37 &&
           platform.mailbox_slots[9] == 0 && platform.mailbox_slots[10] == 2 &&
           platform.mailbox_slots[15] == 2002);
    assert(telemetry.heap_capacity_bytes == sizeof(heap.bytes));
    assert(telemetry.heap_high_water_bytes > 0u && telemetry.minimum_free_bytes > 0u);
    framer_mqjs_destroy(&runtime);

    /* Debounce and ordering remain valid across the uint32 ms rollover. */
    memset(platform.mailbox_slots, 0, sizeof(platform.mailbox_slots));
    platform.mailbox_publishes = platform.mailbox_revision = 0u;
    config.input.key_count = 16u;
    config.input.chord_masks[0] = 15u;
    for (index = 4u; index < 16u; index++)
        config.input.native_tokens[index] = 0x10000000u + index;
    assert(framer_mqjs_init(&wrap_runtime, heap.bytes, sizeof(heap.bytes), &config) == FRAMER_MQJS_OK);
    assert(framer_mqjs_load(&wrap_runtime, input_fairness_source,
                            sizeof(input_fairness_source) - 1u, 1) == FRAMER_MQJS_OK);
    assert(framer_mqjs_input_enqueue(&wrap_runtime, 0u, 1, UINT32_MAX - 4u) == FRAMER_MQJS_OK);
    assert(framer_mqjs_input_drain(&wrap_runtime, 0u) == FRAMER_MQJS_OK);
    assert(framer_mqjs_input_enqueue(&wrap_runtime, 0u, 0, 2u) == FRAMER_MQJS_OK);
    assert(framer_mqjs_input_drain(&wrap_runtime, 7u) == FRAMER_MQJS_OK);
    assert(platform.mailbox_slots[3] == 1 && platform.mailbox_slots[4] == 1);

    /* A five-record bounced backlog is split without advancing past the next
     * due raw record; it remains byte-for-byte equivalent to one-at-a-time
     * debounce and produces one final down only. */
    before = platform.mailbox_publishes;
    for (index = 0; index < 5u; index++)
        assert(framer_mqjs_input_enqueue(&wrap_runtime, 0x55667788u,
                                         (index & 1u) == 0u, 10u + index) ==
               FRAMER_MQJS_OK);
    assert(framer_mqjs_input_drain(&wrap_runtime, 19u) ==
           FRAMER_MQJS_INPUT_MORE_PENDING);
    assert(platform.mailbox_publishes == before);
    assert(framer_mqjs_input_drain(&wrap_runtime, 19u) == FRAMER_MQJS_OK);
    assert(platform.mailbox_publishes == before + 1u);
    assert(framer_mqjs_input_enqueue(&wrap_runtime, 0x55667788u, 0, 20u) ==
           FRAMER_MQJS_OK);
    assert(framer_mqjs_input_drain(&wrap_runtime, 25u) == FRAMER_MQJS_OK);

    /* A late drain groups only equal stable timestamps. Key0's t=35 event
     * cannot see key1, whose stable edge is t=36. */
    assert(framer_mqjs_input_enqueue(&wrap_runtime, 0u, 1, 30u) == FRAMER_MQJS_OK);
    assert(framer_mqjs_input_enqueue(&wrap_runtime, 0x11223344u, 1, 31u) ==
           FRAMER_MQJS_OK);
    assert(framer_mqjs_input_drain(&wrap_runtime, 36u) == FRAMER_MQJS_OK);
    assert(platform.mailbox_slots[14] == 1 && platform.mailbox_slots[15] == 3);
    assert(framer_mqjs_input_enqueue(&wrap_runtime, 0u, 0, 40u) == FRAMER_MQJS_OK);
    assert(framer_mqjs_input_enqueue(&wrap_runtime, 0x11223344u, 0, 40u) ==
           FRAMER_MQJS_OK);
    assert(framer_mqjs_input_drain(&wrap_runtime, 45u) == FRAMER_MQJS_OK);

    /* Two-hold batches rotate across four held keys instead of starving keys
     * with higher stable IDs. */
    assert(framer_mqjs_input_enqueue(&wrap_runtime, 0u, 1, 100u) == FRAMER_MQJS_OK);
    assert(framer_mqjs_input_enqueue(&wrap_runtime, 0x11223344u, 1, 100u) ==
           FRAMER_MQJS_OK);
    assert(framer_mqjs_input_enqueue(&wrap_runtime, 0x55667788u, 1, 100u) ==
           FRAMER_MQJS_OK);
    assert(framer_mqjs_input_enqueue(&wrap_runtime, 0xdeadbeefu, 1, 100u) ==
           FRAMER_MQJS_OK);
    assert(framer_mqjs_input_drain(&wrap_runtime, 105u) ==
           FRAMER_MQJS_INPUT_MORE_PENDING);
    assert(framer_mqjs_input_drain(&wrap_runtime, 105u) == FRAMER_MQJS_OK);
    assert(framer_mqjs_input_drain(&wrap_runtime, 205u) == FRAMER_MQJS_OK);
    assert(platform.mailbox_slots[5] == 3);
    assert(framer_mqjs_input_drain(&wrap_runtime, 205u) == FRAMER_MQJS_OK);
    assert(platform.mailbox_slots[5] == 15);

    /* Overflow resync preserves a synthetic chord-up snapshot, then ordinary
     * input can reactivate the exact four-key chord. */
    for (index = 0; index < FRAMER_MQJS_INPUT_QUEUE_RECORDS + 1u; index++)
        (void)framer_mqjs_input_enqueue(&wrap_runtime, 0u,
                                       (index & 1u) != 0u, 210u + index);
    assert(framer_mqjs_input_drain(&wrap_runtime, 250u) == FRAMER_MQJS_OK);
    assert(platform.mailbox_slots[12] == FRAMER_MQJS_INPUT_REASON_QUEUE_RESYNC);
    assert(framer_mqjs_input_enqueue(&wrap_runtime, 0u, 1, 260u) == FRAMER_MQJS_OK);
    assert(framer_mqjs_input_drain(&wrap_runtime, 265u) == FRAMER_MQJS_OK);
    for (index = 0; index < 4u; index++)
        assert(framer_mqjs_input_enqueue(&wrap_runtime,
                                         config.input.native_tokens[index],
                                         0, 270u) == FRAMER_MQJS_OK);
    assert(framer_mqjs_input_drain(&wrap_runtime, 275u) ==
           FRAMER_MQJS_INPUT_MORE_PENDING);
    assert(framer_mqjs_input_drain(&wrap_runtime, 275u) == FRAMER_MQJS_OK);

    /* Sixteen simultaneous edges stage one FIFO. Four raw-record drains build
     * it, and each owner call attempts no more than three events. Tick, knob,
     * and host RPC remain FIFO behind the older edges. The key-5 exception is
     * consumed, its call stops immediately, and later events resume FIFO. */
    for (index = 0; index < 16u; index++)
        assert(framer_mqjs_input_enqueue(&wrap_runtime,
                                         config.input.native_tokens[index],
                                         1, 300u) == FRAMER_MQJS_OK);
    for (index = 0; index < 4u; index++)
        assert(framer_mqjs_input_drain(&wrap_runtime, 305u) ==
               FRAMER_MQJS_INPUT_MORE_PENDING);
    assert(framer_mqjs_dispatch(&wrap_runtime, "tick.100ms", 0, 0) ==
           FRAMER_MQJS_ERR_EXCEPTION);
    assert(framer_mqjs_dispatch(&wrap_runtime, "input.fn-bottom-knob", 7, 0) ==
           FRAMER_MQJS_INPUT_MORE_PENDING);
    assert(framer_mqjs_dispatch(&wrap_runtime, "host.rpc:0xB201", 8, 3) ==
           FRAMER_MQJS_INPUT_MORE_PENDING);
    assert(framer_mqjs_input_drain(&wrap_runtime, 305u) ==
           FRAMER_MQJS_INPUT_MORE_PENDING);
    assert(framer_mqjs_input_drain(&wrap_runtime, 305u) ==
           FRAMER_MQJS_INPUT_MORE_PENDING);
    assert(framer_mqjs_input_drain(&wrap_runtime, 305u) == FRAMER_MQJS_OK);
    assert(platform.mailbox_slots[0] == 1 && platform.mailbox_slots[1] == 7 &&
           platform.mailbox_slots[2] == 11 && platform.mailbox_slots[3] == 24 &&
           platform.mailbox_slots[6] < platform.mailbox_slots[7] &&
           platform.mailbox_slots[7] < platform.mailbox_slots[8] &&
           platform.mailbox_slots[9] == 24);

    /* A terminal 16-key synthetic resync converges over yielded owner
     * calls. The physical adapter must yield between MORE results. */
    assert(framer_mqjs_input_request_release_all(
        &wrap_runtime, 306u, FRAMER_MQJS_INPUT_REASON_DISCONNECT) ==
        FRAMER_MQJS_INPUT_RESYNC_QUEUED);
    for (index = 0; index < 5u; index++)
        assert(framer_mqjs_input_drain(&wrap_runtime, 306u) ==
               FRAMER_MQJS_INPUT_MORE_PENDING);
    assert(framer_mqjs_input_drain(&wrap_runtime, 306u) == FRAMER_MQJS_OK);
    framer_mqjs_get_telemetry(&wrap_runtime, &batch_telemetry);
    assert(batch_telemetry.max_input_events_per_drain == 3u &&
           batch_telemetry.max_input_pending_events >= 16u &&
           batch_telemetry.pending_input_events == 0u &&
           batch_telemetry.input_callback_budget_yields >= 8u &&
           batch_telemetry.key_down_events == 25u &&
           batch_telemetry.key_up_events == 25u);
    framer_mqjs_destroy(&wrap_runtime);

    /* Focus loss is resumable and owner-thread-only. It discards every queued
     * raw edge, emits synthetic chord/key releases with FOCUS_LOSS, preserves
     * both ingress gates, and accepts a clean key/chord session afterward. */
    memset(platform.mailbox_slots, 0, sizeof(platform.mailbox_slots));
    platform.mailbox_publishes = platform.mailbox_revision = 0u;
    config.input.key_count = 2u;
    config.input.chord_count = 1u;
    config.input.chord_masks[0] = 3u;
    assert(framer_mqjs_init(&focus_runtime, heap.bytes, sizeof(heap.bytes),
                            &config) == FRAMER_MQJS_OK);
    assert(framer_mqjs_load(&focus_runtime, widget_source,
                            sizeof(widget_source) - 1u, 1) ==
           FRAMER_MQJS_OK);
    assert(framer_mqjs_input_enqueue(&focus_runtime, 0u, 1, 1000u) ==
           FRAMER_MQJS_OK);
    assert(framer_mqjs_input_enqueue(&focus_runtime, 0x11223344u, 1, 1000u) ==
           FRAMER_MQJS_OK);
    assert(framer_mqjs_input_drain(&focus_runtime, 1005u) == FRAMER_MQJS_OK);
    platform.thread_token = 0x99u;
    assert(framer_mqjs_input_request_focus_release(&focus_runtime, 1006u) ==
           FRAMER_MQJS_ERR_WRONG_THREAD);
    platform.thread_token = 0x51u;
    assert(framer_mqjs_input_request_focus_release(&focus_runtime, 1006u) ==
           FRAMER_MQJS_INPUT_RESYNC_QUEUED);
    assert(framer_mqjs_input_drain(&focus_runtime, 1006u) == FRAMER_MQJS_OK);
    framer_mqjs_get_telemetry(&focus_runtime, &focus_telemetry);
    assert(focus_telemetry.held_key_mask == 0u &&
           focus_telemetry.pending_input_events == 0u &&
           focus_telemetry.chord_up_events == 1u &&
           focus_telemetry.key_up_events == 2u);
    assert(framer_mqjs_input_enqueue(&focus_runtime, 0u, 1, 1100u) ==
           FRAMER_MQJS_OK);
    assert(framer_mqjs_input_enqueue(&focus_runtime, 0x11223344u, 1, 1100u) ==
           FRAMER_MQJS_OK);
    assert(framer_mqjs_input_drain(&focus_runtime, 1105u) == FRAMER_MQJS_OK);
    assert(framer_mqjs_input_drain(&focus_runtime, 1205u) == FRAMER_MQJS_OK);
    assert(framer_mqjs_input_enqueue(&focus_runtime, 0u, 0, 1210u) ==
           FRAMER_MQJS_OK);
    assert(framer_mqjs_input_enqueue(&focus_runtime, 0x11223344u, 0, 1210u) ==
           FRAMER_MQJS_OK);
    assert(framer_mqjs_input_drain(&focus_runtime, 1215u) == FRAMER_MQJS_OK);
    framer_mqjs_get_telemetry(&focus_runtime, &focus_telemetry);
    assert(focus_telemetry.held_key_mask == 0u &&
           focus_telemetry.chord_down_events == 2u &&
           focus_telemetry.chord_up_events == 2u &&
           focus_telemetry.key_down_events == 4u &&
           focus_telemetry.key_up_events == 4u &&
           focus_telemetry.key_hold_events >= 2u);
    framer_mqjs_destroy(&focus_runtime);

    /* A keyless runtime (a widget with no key handlers) must treat a focus
     * release as a completed no-op: queueing a resync would hand the adapter
     * work that input_drain refuses (its key_count gate), which the resident
     * owner then books as an unrecoverable engine failure. Regression for the
     * first zero-key widget permanently disabling itself on hardware. */
    memset(platform.mailbox_slots, 0, sizeof(platform.mailbox_slots));
    platform.mailbox_publishes = platform.mailbox_revision = 0u;
    platform.reject_publish = 0;
    memset(&config.input, 0, sizeof(config.input));
    assert(framer_mqjs_init(&focus_runtime, heap.bytes, sizeof(heap.bytes),
                            &config) == FRAMER_MQJS_OK);
    assert(framer_mqjs_load(&focus_runtime, widget_source,
                            sizeof(widget_source) - 1u, 1) == FRAMER_MQJS_OK);
    assert(framer_mqjs_input_request_focus_release(&focus_runtime, 2000u) ==
           FRAMER_MQJS_OK);
    assert(framer_mqjs_dispatch(&focus_runtime, "host.rpc:0xB201", 7, 5) ==
           FRAMER_MQJS_OK);
    framer_mqjs_get_telemetry(&focus_runtime, &focus_telemetry);
    assert(focus_telemetry.enabled == 1u &&
           focus_telemetry.pending_input_events == 0u);
    framer_mqjs_destroy(&focus_runtime);

    /* The third queued handler throws after two successes. That owner call
     * stops after three callback attempts plus one bounded recovery, retaining
     * the fourth snapshot for a later call without replay or livelock. */
    memset(platform.mailbox_slots, 0, sizeof(platform.mailbox_slots));
    platform.mailbox_publishes = platform.mailbox_revision = 0u;
    configure(&config, &platform);
    config.input.chord_count = 0u;
    assert(framer_mqjs_init(&failure_runtime, heap.bytes, sizeof(heap.bytes),
                            &config) == FRAMER_MQJS_OK);
    assert(framer_mqjs_load(&failure_runtime, all_throw_source,
                            sizeof(all_throw_source) - 1u, 1) ==
           FRAMER_MQJS_OK);
    for (index = 0; index < 4u; index++)
        assert(framer_mqjs_input_enqueue(&failure_runtime,
                                         config.input.native_tokens[index],
                                         1, 400u) == FRAMER_MQJS_OK);
    assert(framer_mqjs_input_drain(&failure_runtime, 405u) ==
           FRAMER_MQJS_ERR_EXCEPTION);
    framer_mqjs_get_telemetry(&failure_runtime, &failure_telemetry);
    assert(failure_telemetry.pending_input_events == 1u &&
           failure_telemetry.callbacks == 3u &&
           failure_telemetry.commits == 2u &&
           failure_telemetry.resets == 1u &&
           failure_telemetry.input_drain_more_pending == 1u);
    assert(framer_mqjs_input_drain(&failure_runtime, 405u) == FRAMER_MQJS_OK);
    framer_mqjs_get_telemetry(&failure_runtime, &failure_telemetry);
    assert(failure_telemetry.callbacks == 4u &&
           failure_telemetry.exceptions == 1u &&
           failure_telemetry.resets == 1u &&
           failure_telemetry.commits == 3u &&
           failure_telemetry.key_down_events == 4u &&
           failure_telemetry.pending_input_events == 0u &&
           failure_telemetry.max_input_events_per_drain == 3u &&
           platform.mailbox_publishes == 3u);
    framer_mqjs_destroy(&failure_runtime);

    printf("{\"status\":\"PASS_HOST_MQUICKJS_CANARY\",\"revision\":%" PRIu32
           ",\"commits\":%" PRIu32 ",\"resets\":%" PRIu32
           ",\"timeouts\":%" PRIu32 ",\"oom\":%" PRIu32
           ",\"wrongThread\":%" PRIu32 ",\"heapBytes\":%" PRIu32
           ",\"heapHighWater\":%" PRIu32 ",\"minimumFree\":%" PRIu32
           ",\"interruptPolls\":%" PRIu64 ",\"keyDown\":%" PRIu32
           ",\"keyUp\":%" PRIu32 ",\"keyHold\":%" PRIu32
           ",\"chordDown\":%" PRIu32 ",\"chordUp\":%" PRIu32
           ",\"queueOverflows\":%" PRIu32 ",\"resyncs\":%" PRIu32
           ",\"eventSequence\":%" PRIu32
           ",\"maxCallbacksPerIteration\":%" PRIu32
           ",\"maxPendingEvents\":%" PRIu32
           ",\"failureCallbacks\":%" PRIu32
           ",\"failureRecoveries\":%" PRIu32
           ",\"failureMaxAttemptsPerIteration\":%" PRIu32 "}\n",
           telemetry.last_good_revision, telemetry.commits, telemetry.resets,
           telemetry.timeouts, telemetry.out_of_memory, telemetry.wrong_thread,
           telemetry.heap_capacity_bytes, telemetry.heap_high_water_bytes,
           telemetry.minimum_free_bytes, telemetry.interrupt_polls,
           telemetry.key_down_events, telemetry.key_up_events, telemetry.key_hold_events,
           telemetry.chord_down_events, telemetry.chord_up_events,
           telemetry.input_queue_overflows, telemetry.input_resyncs,
           telemetry.last_event_sequence,
           batch_telemetry.max_input_events_per_drain,
           batch_telemetry.max_input_pending_events,
           failure_telemetry.callbacks, failure_telemetry.resets,
           failure_telemetry.max_input_events_per_drain);
    return 0;
}
