#include "resident_integration.h"

#include <pthread.h>
#include <sched.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void require(int condition, const char *message)
{
    if (!condition) {
        fprintf(stderr, "FAIL: %s\n", message);
        exit(1);
    }
}

static uint32_t read_u32(const uint8_t *p)
{
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) |
           ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

static uint32_t read_u24(const uint8_t *p)
{
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) |
           ((uint32_t)p[2] << 16);
}

static uint8_t *read_file(const char *file, size_t *bytes)
{
    FILE *stream = fopen(file, "rb");
    long length;
    uint8_t *output;
    require(stream != NULL, "open input file");
    require(fseek(stream, 0, SEEK_END) == 0, "seek input file");
    length = ftell(stream);
    require(length >= 0 && fseek(stream, 0, SEEK_SET) == 0, "size input file");
    output = (uint8_t *)malloc((size_t)length);
    require(output != NULL && fread(output, 1u, (size_t)length, stream) ==
        (size_t)length, "read input file");
    require(fclose(stream) == 0, "close input file");
    *bytes = (size_t)length;
    return output;
}

static uint32_t test_parity_corpus(const char *file)
{
    size_t bytes;
    uint8_t *corpus = read_file(file, &bytes);
    uint32_t cases;
    uint32_t index;
    size_t cursor = 8u;
    require(bytes >= 8u && memcmp(corpus, "F2PC", 4u) == 0,
            "parity corpus header");
    cases = read_u32(corpus + 4u);
    for (index = 0u; index < cases; ++index) {
        uint32_t package_bytes;
        int expected;
        framer_f2js_admission admission;
        framer_f2js_result result;
        require(cursor + 8u <= bytes, "parity record header bounds");
        package_bytes = read_u32(corpus + cursor);
        expected = corpus[cursor + 4u] != 0u;
        require(corpus[cursor + 5u] == 0u && corpus[cursor + 6u] == 0u &&
                corpus[cursor + 7u] == 0u &&
                cursor + 8u + package_bytes <= bytes,
                "parity record canonical bounds");
        result = framer_f2js_admit(corpus + cursor + 8u, package_bytes,
                                   &admission);
        if ((result == FRAMER_F2JS_ADMIT_OK) != expected) {
            fprintf(stderr, "parity case %u expected=%d result=%s\n", index,
                    expected, framer_f2js_result_name(result));
            exit(1);
        }
        cursor += 8u + package_bytes;
    }
    require(cursor == bytes, "parity corpus trailing bytes");
    free(corpus);
    return cases;
}

typedef struct {
    framer_resident_mailbox mailbox;
    uint32_t done;
    uint32_t reads;
} mailbox_test;

static void *mailbox_writer(void *opaque)
{
    mailbox_test *test = (mailbox_test *)opaque;
    uint32_t revision;
    for (revision = 1u; revision <= 50000u; ++revision) {
        int32_t slots[FRAMER_MQJS_SLOT_COUNT];
        unsigned int i;
        for (i = 0u; i < FRAMER_MQJS_SLOT_COUNT; ++i)
            slots[i] = (int32_t)(revision * 32u + i);
        framer_resident_mailbox_write(&test->mailbox, slots, revision);
    }
    __atomic_store_n(&test->done, 1u, __ATOMIC_RELEASE);
    return NULL;
}

static void *mailbox_reader(void *opaque)
{
    mailbox_test *test = (mailbox_test *)opaque;
    while (__atomic_load_n(&test->done, __ATOMIC_ACQUIRE) == 0u) {
        framer_resident_mailbox_snapshot snapshot;
        unsigned int i;
        if (!framer_resident_mailbox_try_read(&test->mailbox, &snapshot) ||
            snapshot.admitted_revision == 0u)
            continue;
        for (i = 0u; i < FRAMER_MQJS_SLOT_COUNT; ++i)
            require(snapshot.slots[i] ==
                (int32_t)(snapshot.admitted_revision * 32u + i),
                "mailbox reader observed torn revision");
        test->reads++;
    }
    return NULL;
}

static void test_mailbox(void)
{
    mailbox_test test;
    pthread_t writer;
    pthread_t reader;
    framer_resident_mailbox_snapshot snapshot;
    memset(&test, 0, sizeof(test));
    framer_resident_mailbox_init(&test.mailbox);
    __atomic_store_n(&test.mailbox.sequence, 1u, __ATOMIC_RELEASE);
    require(!framer_resident_mailbox_try_read(&test.mailbox, &snapshot),
            "mailbox rejects in-progress odd sequence");
    __atomic_store_n(&test.mailbox.sequence, 0u, __ATOMIC_RELEASE);
    require(pthread_create(&reader, NULL, mailbox_reader, &test) == 0,
            "create mailbox reader");
    require(pthread_create(&writer, NULL, mailbox_writer, &test) == 0,
            "create mailbox writer");
    require(pthread_join(writer, NULL) == 0, "join mailbox writer");
    require(pthread_join(reader, NULL) == 0, "join mailbox reader");
    require(test.reads != 0u &&
            framer_resident_mailbox_try_read(&test.mailbox, &snapshot) &&
            snapshot.admitted_revision == 50000u,
            "mailbox final coherent snapshot");
}

typedef struct {
    pthread_mutex_t engine_mutex;
    const framer_mqjs_config *config;
    framer_mqjs_telemetry telemetry;
    framer_mqjs_input_observation observation;
    uint32_t init_calls;
    uint32_t load_calls;
    uint32_t destroy_calls;
    uint32_t dispatch_calls;
    uint32_t drain_calls;
    uint32_t raw_pending;
    uint32_t raw_timestamp;
    uint32_t now_ms;
    uint32_t scheduled_ms;
    uint32_t schedules;
    uint32_t reschedules;
    uint32_t stage_calls;
    uint32_t event_activation_calls;
    uint32_t event_remove_calls;
    uint32_t activation_calls;
    uint32_t remove_calls;
    uint32_t cancel_calls;
    uint32_t active_generation;
    uint32_t hook_enabled;
    uint32_t timer_enabled;
    uint32_t event_enabled;
    uint32_t event_wrapper_inflight;
    uint32_t timer_wrapper_inflight;
    uint32_t retirement_order;
    uint32_t event_remove_order;
    uint32_t remove_order;
    uint32_t cancel_order;
    uint32_t destroyed;
    uint32_t calls_after_destroy;
    uint32_t input_enqueue_calls;
    uint32_t release_calls;
    uint32_t block_input;
    uint32_t input_entered;
    uint32_t allow_input_finish;
    uint32_t core_input_enabled;
    uint32_t fail_next_drain;
    uint32_t fatal_next_drain;
    uint32_t block_dispatch;
    uint32_t dispatch_entered;
    uint32_t allow_dispatch_finish;
    uint32_t publish_rejections;
    uint8_t raw_pressed;
    uint8_t fail_allocation;
    uint8_t *staged_asset;
    size_t staged_asset_bytes;
} mock_control;

static mock_control *mock;

static void mock_control_init(mock_control *control)
{
    memset(control, 0, sizeof(*control));
    require(pthread_mutex_init(&control->engine_mutex, NULL) == 0,
            "initialize mock engine mutex");
}

static void mock_control_destroy(mock_control *control)
{
    require(pthread_mutex_destroy(&control->engine_mutex) == 0,
            "destroy mock engine mutex");
}

static void mock_engine_lock(void)
{
    require(pthread_mutex_lock(&mock->engine_mutex) == 0,
            "lock mock engine");
    if (mock->destroyed != 0u)
        mock->calls_after_destroy++;
}

static void mock_engine_unlock(void)
{
    require(pthread_mutex_unlock(&mock->engine_mutex) == 0,
            "unlock mock engine");
}

static framer_mqjs_result mock_init(framer_mqjs_runtime *runtime, void *heap,
                                    size_t heap_bytes,
                                    const framer_mqjs_config *config)
{
    (void)runtime;
    mock_engine_lock();
    require(heap != NULL && heap_bytes == FRAMER_F2JS_HEAP_BYTES,
            "mock fixed heap contract");
    require(config->callback_deadline_us == FRAMER_F2JS_CALLBACK_DEADLINE_US,
            "mock deadline contract");
    mock->config = config;
    mock->init_calls++;
    mock->telemetry.enabled = 1u;
    mock->core_input_enabled = 1u;
    mock->telemetry.heap_capacity_bytes = (uint32_t)heap_bytes;
    mock_engine_unlock();
    return FRAMER_MQJS_OK;
}

static framer_mqjs_result mock_load(framer_mqjs_runtime *runtime,
                                    const char *source, size_t source_bytes,
                                    int admitted)
{
    (void)runtime;
    mock_engine_lock();
    require(admitted != 0 && source_bytes >= 14u &&
            memcmp(source, "\"use strict\";\n", 14u) == 0,
            "mock admitted strict source");
    mock->load_calls++;
    mock->telemetry.source_loads++;
    mock_engine_unlock();
    return FRAMER_MQJS_OK;
}

static framer_mqjs_result mock_dispatch(framer_mqjs_runtime *runtime,
                                        const char *name, int32_t value,
                                        int32_t auxiliary)
{
    int32_t slots[FRAMER_MQJS_SLOT_COUNT] = { 0 };
    int published;
    (void)runtime;
    (void)name;
    if (__atomic_load_n(&mock->block_dispatch, __ATOMIC_ACQUIRE) != 0u) {
        __atomic_store_n(&mock->dispatch_entered, 1u, __ATOMIC_RELEASE);
        while (__atomic_load_n(&mock->allow_dispatch_finish,
                               __ATOMIC_ACQUIRE) == 0u)
            sched_yield();
    }
    mock_engine_lock();
    mock->dispatch_calls++;
    slots[0] = value;
    slots[1] = auxiliary;
    mock->telemetry.last_good_revision++;
    published = mock->config->publish(mock->config->opaque, slots,
                                      mock->telemetry.last_good_revision);
    if (!published) {
        mock->publish_rejections++;
        mock->telemetry.publish_failures++;
        /* The real core performs its single reserved recovery here. */
        mock->telemetry.resets++;
        mock->telemetry.last_result = FRAMER_MQJS_ERR_PUBLISH;
        mock_engine_unlock();
        return FRAMER_MQJS_ERR_PUBLISH;
    }
    mock_engine_unlock();
    return FRAMER_MQJS_OK;
}

static framer_mqjs_result mock_input_enqueue(framer_mqjs_runtime *runtime,
                                             uint32_t token, int pressed,
                                             uint32_t timestamp_ms)
{
    (void)runtime;
    if (__atomic_load_n(&mock->block_input, __ATOMIC_ACQUIRE) != 0u) {
        __atomic_store_n(&mock->input_entered, 1u, __ATOMIC_RELEASE);
        while (__atomic_load_n(&mock->allow_input_finish,
                               __ATOMIC_ACQUIRE) == 0u)
            sched_yield();
    }
    mock_engine_lock();
    mock->input_enqueue_calls++;
    if (mock->core_input_enabled == 0u) {
        mock_engine_unlock();
        return FRAMER_MQJS_ERR_DISABLED;
    }
    mock->raw_pending = 1u;
    mock->raw_pressed = pressed != 0;
    mock->raw_timestamp = timestamp_ms;
    mock->observation.native_token = token;
    mock->observation.pressed = pressed != 0;
    mock->observation.timestamp_ms = timestamp_ms;
    mock->observation.observation_sequence++;
    mock_engine_unlock();
    return FRAMER_MQJS_OK;
}

static framer_mqjs_result mock_release_all(framer_mqjs_runtime *runtime,
                                           uint32_t timestamp_ms,
                                           framer_mqjs_input_reason reason)
{
    (void)runtime;
    (void)reason;
    mock_engine_lock();
    mock->release_calls++;
    mock->core_input_enabled = 0u;
    mock->raw_pending = 0u;
    mock->raw_pressed = 0u;
    mock->raw_timestamp = timestamp_ms;
    mock->telemetry.held_key_mask = 0u;
    mock->telemetry.pending_input_events = 0u;
    mock_engine_unlock();
    return FRAMER_MQJS_INPUT_RESYNC_QUEUED;
}

static framer_mqjs_result mock_drain(framer_mqjs_runtime *runtime,
                                     uint32_t timestamp_ms)
{
    (void)runtime;
    mock_engine_lock();
    mock->drain_calls++;
    if (mock->fatal_next_drain != 0u) {
        mock->fatal_next_drain = 0u;
        mock->telemetry.enabled = 0u;
        mock->telemetry.last_result = FRAMER_MQJS_ERR_SEQUENCE;
        mock_engine_unlock();
        return FRAMER_MQJS_ERR_SEQUENCE;
    }
    if (mock->fail_next_drain != 0u) {
        mock->fail_next_drain = 0u;
        mock->telemetry.resets++;
        mock->telemetry.enabled = 1u;
        mock->telemetry.last_result = FRAMER_MQJS_ERR_EXCEPTION;
        mock_engine_unlock();
        return FRAMER_MQJS_ERR_EXCEPTION;
    }
    if (mock->raw_pending != 0u &&
        (int32_t)(timestamp_ms - (mock->raw_timestamp + 8u)) >= 0) {
        mock->telemetry.held_key_mask = mock->raw_pressed != 0u ? 1u : 0u;
        mock->raw_pending = 0u;
    }
    mock->telemetry.last_result = FRAMER_MQJS_OK;
    mock_engine_unlock();
    return FRAMER_MQJS_OK;
}

static int mock_observation(const framer_mqjs_runtime *runtime,
                            framer_mqjs_input_observation *observation)
{
    (void)runtime;
    mock_engine_lock();
    *observation = mock->observation;
    {
        int result = mock->observation.observation_sequence != 0u;
        mock_engine_unlock();
        return result;
    }
}

static void mock_get_telemetry(const framer_mqjs_runtime *runtime,
                               framer_mqjs_telemetry *telemetry)
{
    (void)runtime;
    mock_engine_lock();
    *telemetry = mock->telemetry;
    mock_engine_unlock();
}

static void mock_destroy(framer_mqjs_runtime *runtime)
{
    (void)runtime;
    mock_engine_lock();
    mock->destroy_calls++;
    mock->destroyed = 1u;
    mock_engine_unlock();
}

static void *mock_allocate(void *opaque, size_t bytes)
{
    mock_control *control = (mock_control *)opaque;
    if (control->fail_allocation != 0u)
        return NULL;
    return malloc(bytes);
}

static void mock_free(void *opaque, void *allocation)
{
    (void)opaque;
    free(allocation);
}

static uint64_t mock_now(void *opaque)
{
    return (uint64_t)__atomic_load_n(&((mock_control *)opaque)->now_ms,
                                     __ATOMIC_ACQUIRE) * 1000u;
}

static uint32_t mock_now_ms(void *opaque)
{
    return __atomic_load_n(&((mock_control *)opaque)->now_ms,
                           __ATOMIC_ACQUIRE);
}

static uintptr_t mock_token(void *opaque)
{
    return (uintptr_t)opaque;
}

static void mock_reschedule(void *opaque)
{
    __atomic_add_fetch(&((mock_control *)opaque)->reschedules, 1u,
                       __ATOMIC_RELAXED);
}

static int mock_activate_events(void *opaque, framer_resident_owner *owner,
                                uint32_t generation)
{
    mock_control *control = (mock_control *)opaque;
    require(owner != NULL && generation != 0u,
            "mock event activation generation contract");
    __atomic_store_n(&control->active_generation, generation, __ATOMIC_RELEASE);
    __atomic_store_n(&control->event_enabled, 1u, __ATOMIC_RELEASE);
    __atomic_add_fetch(&control->event_activation_calls, 1u, __ATOMIC_RELAXED);
    return 1;
}

static int mock_remove_events(void *opaque, uint32_t generation)
{
    mock_control *control = (mock_control *)opaque;
    require(generation == __atomic_load_n(&control->active_generation,
                                           __ATOMIC_ACQUIRE),
            "mock event removal exact generation");
    __atomic_store_n(&control->event_enabled, 0u, __ATOMIC_RELEASE);
    while (__atomic_load_n(&control->event_wrapper_inflight,
                           __ATOMIC_ACQUIRE) != 0u)
        sched_yield();
    __atomic_store_n(&control->event_remove_order,
        __atomic_add_fetch(&control->retirement_order, 1u, __ATOMIC_ACQ_REL),
        __ATOMIC_RELEASE);
    __atomic_add_fetch(&control->event_remove_calls, 1u, __ATOMIC_RELAXED);
    return 1;
}

static int mock_activate_sources(void *opaque, framer_resident_owner *owner,
                                 uint32_t generation)
{
    mock_control *control = (mock_control *)opaque;
    require(owner != NULL && generation != 0u,
            "mock activate generation contract");
    __atomic_store_n(&control->active_generation, generation, __ATOMIC_RELEASE);
    __atomic_store_n(&control->hook_enabled, 1u, __ATOMIC_RELEASE);
    __atomic_store_n(&control->timer_enabled, 1u, __ATOMIC_RELEASE);
    __atomic_add_fetch(&control->activation_calls, 1u, __ATOMIC_RELAXED);
    return 1;
}

static int mock_remove_hook(void *opaque, uint32_t generation)
{
    mock_control *control = (mock_control *)opaque;
    require(generation == __atomic_load_n(&control->active_generation,
                                           __ATOMIC_ACQUIRE),
            "mock remove exact generation");
    __atomic_store_n(&control->hook_enabled, 0u, __ATOMIC_RELEASE);
    __atomic_store_n(&control->remove_order,
        __atomic_add_fetch(&control->retirement_order, 1u, __ATOMIC_ACQ_REL),
        __ATOMIC_RELEASE);
    __atomic_add_fetch(&control->remove_calls, 1u, __ATOMIC_RELAXED);
    return 1;
}

static int mock_cancel_poll(void *opaque, uint32_t generation)
{
    mock_control *control = (mock_control *)opaque;
    require(generation == __atomic_load_n(&control->active_generation,
                                           __ATOMIC_ACQUIRE),
            "mock cancel exact generation");
    __atomic_store_n(&control->timer_enabled, 0u, __ATOMIC_RELEASE);
    while (__atomic_load_n(&control->timer_wrapper_inflight,
                           __ATOMIC_ACQUIRE) != 0u)
        sched_yield();
    __atomic_store_n(&control->cancel_order,
        __atomic_add_fetch(&control->retirement_order, 1u, __ATOMIC_ACQ_REL),
        __ATOMIC_RELEASE);
    __atomic_add_fetch(&control->cancel_calls, 1u, __ATOMIC_RELAXED);
    return 1;
}

static int mock_schedule_poll(void *opaque, uint32_t generation,
                              uint32_t delay_ms)
{
    mock_control *control = (mock_control *)opaque;
    if (__atomic_load_n(&control->timer_enabled, __ATOMIC_ACQUIRE) == 0u ||
        generation != __atomic_load_n(&control->active_generation,
                                       __ATOMIC_ACQUIRE))
        return 0;
    __atomic_store_n(&control->scheduled_ms, delay_ms, __ATOMIC_RELEASE);
    __atomic_add_fetch(&control->schedules, 1u, __ATOMIC_RELAXED);
    return 1;
}

static int mock_stage(void *opaque, const uint8_t *f1wb, size_t bytes,
                      uint32_t generation)
{
    mock_control *control = (mock_control *)opaque;
    require(generation != 0u && bytes == FRAMER_F2JS_RASTER_BASE_BYTES,
            "mock raster stage contract");
    free(control->staged_asset);
    control->staged_asset = (uint8_t *)malloc(bytes);
    require(control->staged_asset != NULL, "mock raster stage allocation");
    memcpy(control->staged_asset, f1wb, bytes);
    control->staged_asset_bytes = bytes;
    control->stage_calls++;
    return 1;
}

static uint32_t mock_stack_water(void *opaque)
{
    (void)opaque;
    return 8192u;
}

static framer_resident_engine_api engine_api(void)
{
    framer_resident_engine_api api = {
        mock_init, mock_load, mock_dispatch, mock_input_enqueue,
        mock_release_all, mock_drain, mock_observation, mock_get_telemetry,
        mock_destroy,
    };
    return api;
}

static framer_resident_platform platform_api(mock_control *control)
{
    framer_resident_platform platform = {
        .opaque = control,
        .allocate_psram = mock_allocate,
        .free_psram = mock_free,
        .now_us = mock_now,
        .now_ms = mock_now_ms,
        .current_thread_token = mock_token,
        .reschedule_owner = mock_reschedule,
        .activate_event_sources = mock_activate_events,
        .remove_event_sources = mock_remove_events,
        .activate_input_sources = mock_activate_sources,
        .remove_stock_input_hook = mock_remove_hook,
        .cancel_input_poll = mock_cancel_poll,
        .schedule_input_poll = mock_schedule_poll,
        .stage_raster_base = mock_stage,
        .task_stack_high_water_bytes = mock_stack_water,
    };
    return platform;
}

static framer_resident_owner *boot_owner(mock_control *control,
                                         uint8_t *package,
                                         size_t package_bytes)
{
    framer_resident_engine_api engine = engine_api();
    framer_resident_platform platform = platform_api(control);
    framer_resident_owner *owner =
        (framer_resident_owner *)calloc(1u, sizeof(*owner));
    require(owner != NULL, "allocate owner outside VM task stack");
    mock = control;
    framer_resident_owner_init_shell(owner, &engine, &platform);
    require(framer_resident_owner_mark_module_mapped(owner),
            "mark module mapped");
    require(framer_resident_owner_boot_on_task(owner, package, package_bytes) ==
            FRAMER_F2JS_ADMIT_OK, "boot resident owner");
    require(owner->capability.advertised == 1u &&
            owner->capability.ready_mask == FRAMER_RESIDENT_READY_ALL,
            "capability advertised only at complete readiness");
    return owner;
}

static void stop_and_unmap(framer_resident_owner *owner)
{
    unsigned int attempts;
    mock_control *control = (mock_control *)owner->platform.opaque;
    require(framer_resident_owner_begin_quiesce(
                owner, 4000u, FRAMER_MQJS_INPUT_REASON_DISCONNECT),
            "begin synchronized quiesce");
    require(owner->capability.advertised == 0u,
            "capability disabled before teardown");
    if (__atomic_load_n(&control->event_activation_calls, __ATOMIC_ACQUIRE) != 0u)
        require(__atomic_load_n(&control->event_remove_calls,
                                __ATOMIC_ACQUIRE) == 1u,
                "generic event sources retire exactly once");
    if (__atomic_load_n(&control->activation_calls, __ATOMIC_ACQUIRE) != 0u)
        require(__atomic_load_n(&control->event_remove_order,
                                __ATOMIC_ACQUIRE) <
                    __atomic_load_n(&control->remove_order, __ATOMIC_ACQUIRE) &&
                __atomic_load_n(&control->remove_calls, __ATOMIC_ACQUIRE) == 1u &&
                __atomic_load_n(&control->cancel_calls, __ATOMIC_ACQUIRE) == 1u &&
                __atomic_load_n(&control->remove_order, __ATOMIC_ACQUIRE) <
                    __atomic_load_n(&control->cancel_order, __ATOMIC_ACQUIRE),
                "event, hook, and timer retirement order is exact");
    for (attempts = 0u; attempts < 64u &&
         !framer_resident_owner_stop_on_task(owner); ++attempts)
        ;
    require(attempts < 64u, "bounded owner teardown drain");
    require(framer_resident_capability_can_unmap(&owner->capability),
            "stopped owner permits unmap");
    require(framer_resident_capability_mark_unmapped(&owner->capability) &&
            framer_resident_capability_flash_write_allowed(&owner->capability),
            "flash allowed only after unmap");
    free(owner);
}

static void test_owner(uint8_t *package, size_t package_bytes)
{
    mock_control control;
    framer_resident_owner *owner;
    framer_resident_mailbox_snapshot snapshot;
    uint32_t init_calls;
    uint32_t load_calls;
    mock_control_init(&control);
    owner = boot_owner(&control, package, package_bytes);
    {
        void *heap = owner->heap;
        uint32_t input_calls = control.input_enqueue_calls;
        uint32_t reschedules = control.reschedules;
        require(framer_resident_owner_boot_on_task(owner, package,
                                                   package_bytes) ==
                    FRAMER_F2JS_ERR_ARGUMENT &&
                owner->heap == heap && owner->capability.advertised == 1u &&
                control.init_calls == 1u && control.load_calls == 1u,
                "second boot rejects without mutating active generation");
        require(framer_resident_owner_input_after_stock(
                    owner, 6u, 0x10203040u, 1, 90u) ==
                    FRAMER_MQJS_ERR_DISABLED &&
                control.input_enqueue_calls == input_calls,
                "stale hook generation never touches runtime");
        framer_resident_owner_input_poll_due(owner, 6u);
        require(control.reschedules == reschedules,
                "stale timer generation never reschedules owner");
    }
    require(!framer_resident_owner_enqueue(owner, 7u, "tick.1s", 1, 2) &&
            !framer_resident_owner_enqueue_host_rpc(owner, 7u, 999u, 1, 2) &&
            control.dispatch_calls == 0u,
            "undeclared ingress causes no VM call");
    require(!framer_resident_owner_enqueue_host_rpc(owner, 6u, 0x1234u, 9, 4) &&
            framer_resident_owner_enqueue_host_rpc(owner, 7u, 0x1234u, 9, 4),
            "declared host RPC admitted");
    require(framer_resident_owner_step(owner) == FRAMER_MQJS_OK &&
            control.dispatch_calls == 1u &&
            framer_resident_mailbox_try_read(&owner->mailbox, &snapshot) &&
            snapshot.slots[0] == 9 &&
            snapshot.admitted_revision == owner->admission.generation,
            "typed host RPC publishes atomic admitted revision");

    control.now_ms = 100u;
    require(framer_resident_owner_input_after_stock(owner, 7u, 0x10203040u, 1,
                                                     100u) == FRAMER_MQJS_OK,
            "stock-first key ingress");
    require(framer_resident_owner_step(owner) == FRAMER_MQJS_OK &&
            control.scheduled_ms == 8u, "isolated press schedules debounce");
    control.now_ms += control.scheduled_ms;
    framer_resident_owner_input_poll_due(owner, 7u);
    require(framer_resident_owner_step(owner) == FRAMER_MQJS_OK &&
            control.telemetry.held_key_mask == 1u &&
            control.scheduled_ms == 20u, "isolated press matures and hold polls");
    control.now_ms += control.scheduled_ms;
    framer_resident_owner_input_poll_due(owner, 7u);
    require(framer_resident_owner_step(owner) == FRAMER_MQJS_OK,
            "isolated hold continues without producer event");
    require(framer_resident_owner_input_after_stock(owner, 7u, 0x10203040u, 0,
                                                     control.now_ms) ==
            FRAMER_MQJS_OK, "isolated release ingress");
    require(framer_resident_owner_step(owner) == FRAMER_MQJS_OK,
            "isolated release enters debounce");
    control.now_ms += 20u;
    framer_resident_owner_input_poll_due(owner, 7u);
    require(framer_resident_owner_step(owner) == FRAMER_MQJS_OK &&
            control.telemetry.held_key_mask == 0u,
            "isolated release matures without later producer event");

    require(framer_resident_owner_input_after_stock(owner, 7u, 0x10203040u, 1,
                                                     control.now_ms) ==
            FRAMER_MQJS_OK, "failure input queued");
    control.fail_next_drain = 1u;
    init_calls = control.init_calls;
    load_calls = control.load_calls;
    require(framer_resident_owner_step(owner) == FRAMER_MQJS_ERR_EXCEPTION &&
            control.init_calls == init_calls && control.load_calls == load_calls &&
            owner->telemetry.recoveries == 1u && owner->input_pending == 1u,
            "adapter observes core recovery without duplicate reset");
    require(framer_resident_owner_step(owner) == FRAMER_MQJS_OK,
            "retained native FIFO runs in later owner iteration");

    require(framer_resident_owner_input_after_stock(owner, 7u, 0x10203040u, 0,
                                                     control.now_ms) ==
            FRAMER_MQJS_OK, "fatal input queued");
    control.fatal_next_drain = 1u;
    require(framer_resident_owner_step(owner) == FRAMER_MQJS_ERR_SEQUENCE &&
            owner->capability.state == FRAMER_RESIDENT_CAP_FAULTED &&
            owner->capability.advertised == 0u,
            "unrecovered core failure faults closed");
    stop_and_unmap(owner);
    require(control.calls_after_destroy == 0u,
            "no engine call after destroy");
    mock_control_destroy(&control);
}

static void test_tagged_completion_interleave(uint8_t *package,
                                              size_t package_bytes)
{
    mock_control control;
    framer_resident_owner *owner;
    framer_resident_tagged_completion completion;
    const uint32_t tag = 0x51a7c0deu;
    mock_control_init(&control);
    owner = boot_owner(&control, package, package_bytes);
    control.now_ms = 100u;
    require(framer_resident_owner_enqueue(owner, 7u, "tick.100ms", 1, 0),
            "ordinary tick admitted before tagged host record");
    require(framer_resident_owner_step(owner) >= FRAMER_MQJS_OK &&
            !framer_resident_owner_take_tagged_completion(owner, &completion),
            "preceding tick cannot complete tagged host receipt");
    require(framer_resident_owner_enqueue_host_rpc_tagged(
                owner, 7u, 0x1234u, 44, 55, tag) &&
            framer_resident_owner_enqueue(owner, 7u, "tick.100ms", 2, 0),
            "tagged host record admitted before following tick");
    require(framer_resident_owner_input_after_stock(
                owner, 7u, 0x10203040u, 1, control.now_ms) ==
                FRAMER_MQJS_OK,
            "key drain interleaves with tagged host record");
    require(framer_resident_owner_step(owner) >= FRAMER_MQJS_OK &&
            !framer_resident_owner_take_tagged_completion(owner, &completion),
            "key drain cannot complete tagged host receipt");
    require(framer_resident_owner_step(owner) == FRAMER_MQJS_OK &&
            framer_resident_owner_take_tagged_completion(owner, &completion) &&
            completion.tag == tag && completion.result == FRAMER_MQJS_OK &&
            completion.mailbox_sequence != 0u &&
            completion.applied_generation == 7u &&
            completion.applied_revision == 44u,
            "only exact consumed host record publishes tagged completion");
    require(!framer_resident_owner_take_tagged_completion(owner, &completion),
            "tagged completion is consumed exactly once");
    require(framer_resident_owner_step(owner) >= FRAMER_MQJS_OK &&
            !framer_resident_owner_take_tagged_completion(owner, &completion),
            "following tick cannot recreate consumed host completion");
    stop_and_unmap(owner);
    mock_control_destroy(&control);
}

static void test_failure_teardown(uint8_t *package, size_t package_bytes)
{
    framer_resident_engine_api engine = engine_api();
    mock_control control;
    framer_resident_platform platform;
    framer_resident_owner *owner;
    uint8_t saved;
    mock_control_init(&control);
    platform = platform_api(&control);
    mock = &control;
    owner = (framer_resident_owner *)calloc(1u, sizeof(*owner));
    require(owner != NULL, "allocate parser-fault owner");
    framer_resident_owner_init_shell(owner, &engine, &platform);
    require(framer_resident_owner_mark_module_mapped(owner), "parser fault map");
    saved = package[0]; package[0] ^= 0x80u;
    require(framer_resident_owner_boot_on_task(owner, package, package_bytes) !=
            FRAMER_F2JS_ADMIT_OK &&
            owner->capability.state == FRAMER_RESIDENT_CAP_FAULTED,
            "parser fault latched");
    package[0] = saved;
    stop_and_unmap(owner);
    mock_control_destroy(&control);

    mock_control_init(&control);
    control.fail_allocation = 1u;
    platform = platform_api(&control);
    mock = &control;
    owner = (framer_resident_owner *)calloc(1u, sizeof(*owner));
    require(owner != NULL, "allocate boot-fault owner");
    framer_resident_owner_init_shell(owner, &engine, &platform);
    require(framer_resident_owner_mark_module_mapped(owner), "boot fault map");
    require(framer_resident_owner_boot_on_task(owner, package, package_bytes) !=
            FRAMER_F2JS_ADMIT_OK &&
            owner->capability.state == FRAMER_RESIDENT_CAP_FAULTED,
            "heap boot fault latched");
    stop_and_unmap(owner);
    mock_control_destroy(&control);
}

static void test_raster_transport(uint8_t *package, size_t package_bytes)
{
    mock_control control;
    framer_resident_owner *owner;
    uint32_t asset_offset = read_u24(package + 58u);
    uint8_t staged_first;
    mock_control_init(&control);
    owner = boot_owner(&control, package, package_bytes);
    require(control.stage_calls == 1u &&
            control.staged_asset_bytes == FRAMER_F2JS_RASTER_BASE_BYTES,
            "raster staged before advertise");
    staged_first = control.staged_asset[0];
    package[asset_offset] ^= 0xffu;
    require(control.staged_asset[0] == staged_first,
            "staged raster survives transport overwrite");
    package[asset_offset] ^= 0xffu;
    stop_and_unmap(owner);
    free(control.staged_asset);
    mock_control_destroy(&control);
}

typedef struct {
    framer_resident_owner *owner;
    mock_control *control;
    uint32_t run;
    uint32_t input_result;
    uint32_t release_result;
    uint32_t timer_calls;
    uint32_t event_calls;
} teardown_race;

static void *race_input(void *opaque)
{
    teardown_race *race = (teardown_race *)opaque;
    framer_mqjs_result result = framer_resident_owner_input_after_stock(
        race->owner, 7u, 0x10203040u, 1, 500u);
    __atomic_store_n(&race->input_result, (uint32_t)result, __ATOMIC_RELEASE);
    return NULL;
}

static void *race_release(void *opaque)
{
    teardown_race *race = (teardown_race *)opaque;
    framer_mqjs_result result = framer_resident_owner_release_all(
        race->owner, 7u, 501u, FRAMER_MQJS_INPUT_REASON_FOCUS_LOSS);
    __atomic_store_n(&race->release_result, (uint32_t)result,
                     __ATOMIC_RELEASE);
    return NULL;
}

static void *race_timer(void *opaque)
{
    teardown_race *race = (teardown_race *)opaque;
    while (__atomic_load_n(&race->run, __ATOMIC_ACQUIRE) != 0u) {
        __atomic_add_fetch(&race->control->timer_wrapper_inflight, 1u,
                           __ATOMIC_ACQ_REL);
        if (__atomic_load_n(&race->control->timer_enabled,
                            __ATOMIC_ACQUIRE) != 0u)
            framer_resident_owner_input_poll_due(race->owner, 7u);
        __atomic_sub_fetch(&race->control->timer_wrapper_inflight, 1u,
                           __ATOMIC_RELEASE);
        __atomic_add_fetch(&race->timer_calls, 1u, __ATOMIC_RELAXED);
        sched_yield();
    }
    return NULL;
}

static void *race_events(void *opaque)
{
    teardown_race *race = (teardown_race *)opaque;
    int32_t value = 0;
    while (__atomic_load_n(&race->run, __ATOMIC_ACQUIRE) != 0u) {
        __atomic_add_fetch(&race->control->event_wrapper_inflight, 1u,
                           __ATOMIC_ACQ_REL);
        if (__atomic_load_n(&race->control->event_enabled,
                            __ATOMIC_ACQUIRE) != 0u)
            (void)framer_resident_owner_enqueue_host_rpc(
                race->owner, 7u, 0x1234u, value++, 0);
        __atomic_sub_fetch(&race->control->event_wrapper_inflight, 1u,
                           __ATOMIC_RELEASE);
        __atomic_add_fetch(&race->event_calls, 1u, __ATOMIC_RELAXED);
        sched_yield();
    }
    return NULL;
}

static void test_concurrent_teardown(uint8_t *package, size_t package_bytes)
{
    mock_control control;
    framer_resident_owner *owner;
    teardown_race race;
    pthread_t input_thread;
    pthread_t release_thread;
    pthread_t timer_thread;
    pthread_t event_thread;
    unsigned int attempts;
    uint32_t calls_before;
    uint32_t reschedules_before;
    mock_control_init(&control);
    owner = boot_owner(&control, package, package_bytes);
    memset(&race, 0, sizeof(race));
    race.owner = owner;
    race.control = &control;
    __atomic_store_n(&race.run, 1u, __ATOMIC_RELEASE);
    __atomic_store_n(&control.block_input, 1u, __ATOMIC_RELEASE);
    require(pthread_create(&input_thread, NULL, race_input, &race) == 0,
            "create blocked input producer");
    for (attempts = 0u; attempts < 1000000u &&
         __atomic_load_n(&control.input_entered, __ATOMIC_ACQUIRE) == 0u;
         ++attempts)
        sched_yield();
    require(attempts < 1000000u &&
            __atomic_load_n(&owner->ingress_inflight, __ATOMIC_ACQUIRE) == 1u,
            "blocked producer registered before teardown");
    require(pthread_create(&timer_thread, NULL, race_timer, &race) == 0,
            "create concurrent timer producer");
    require(pthread_create(&event_thread, NULL, race_events, &race) == 0,
            "create concurrent ordinary event producer");
    require(pthread_create(&release_thread, NULL, race_release, &race) == 0,
            "create concurrent terminal release producer");
    require(pthread_join(release_thread, NULL) == 0,
            "join terminal release producer");
    require((framer_mqjs_result)__atomic_load_n(
                &race.release_result, __ATOMIC_ACQUIRE) ==
                FRAMER_MQJS_INPUT_RESYNC_QUEUED,
            "concurrent release published owner request");
    for (attempts = 0u; attempts < 1000000u &&
         (__atomic_load_n(&race.timer_calls, __ATOMIC_ACQUIRE) == 0u ||
          __atomic_load_n(&race.event_calls, __ATOMIC_ACQUIRE) == 0u);
         ++attempts)
        sched_yield();
    require(attempts < 1000000u,
            "timer and ordinary producers entered before retirement");
    require(framer_resident_owner_begin_quiesce(
                owner, 600u, FRAMER_MQJS_INPUT_REASON_DISCONNECT),
            "teardown retires source generation");
    require(__atomic_load_n(&race.timer_calls, __ATOMIC_ACQUIRE) != 0u &&
            __atomic_load_n(&race.event_calls, __ATOMIC_ACQUIRE) != 0u,
            "concurrent timer and ordinary ingress exercised");
    calls_before = control.input_enqueue_calls;
    reschedules_before = __atomic_load_n(&control.reschedules,
                                         __ATOMIC_ACQUIRE);
    require(framer_resident_owner_input_after_stock(
                owner, 7u, 0x10203040u, 0, 601u) ==
                FRAMER_MQJS_ERR_DISABLED,
            "retired hook callback rejected");
    framer_resident_owner_input_poll_due(owner, 7u);
    require(control.input_enqueue_calls == calls_before &&
            __atomic_load_n(&control.reschedules, __ATOMIC_ACQUIRE) ==
                reschedules_before,
            "callbacks after disable never touch runtime or scheduler");
    require(!framer_resident_owner_stop_on_task(owner) &&
            control.release_calls == 1u && control.destroy_calls == 0u &&
            __atomic_load_n(&owner->ingress_inflight, __ATOMIC_ACQUIRE) == 1u,
            "owner issues terminal release then yields for inflight producer");
    __atomic_store_n(&control.allow_input_finish, 1u, __ATOMIC_RELEASE);
    require(pthread_join(input_thread, NULL) == 0,
            "join bounded pre-disable producer");
    require((framer_mqjs_result)__atomic_load_n(
                &race.input_result, __ATOMIC_ACQUIRE) ==
                FRAMER_MQJS_ERR_DISABLED &&
            __atomic_load_n(&owner->ingress_inflight, __ATOMIC_ACQUIRE) == 0u,
            "terminal core gate rejects raced producer and barrier drains");
    for (attempts = 0u; attempts < 64u &&
         !framer_resident_owner_stop_on_task(owner); ++attempts)
        sched_yield();
    require(attempts < 64u && control.destroy_calls == 1u &&
            control.calls_after_destroy == 0u,
            "destroy occurs once after producer/timer/owner quiescence");
    /* Platform gates, not manually stopping the producer threads, make zero
     * inflight stable. These wrappers keep running across destroy but cannot
     * dereference owner after their synchronized removal. */
    __atomic_store_n(&race.run, 0u, __ATOMIC_RELEASE);
    require(pthread_join(timer_thread, NULL) == 0,
            "join retired timer producer after destroy");
    require(pthread_join(event_thread, NULL) == 0,
            "join retired event producer after destroy");
    require(framer_resident_capability_mark_unmapped(&owner->capability) &&
            framer_resident_capability_flash_write_allowed(&owner->capability),
            "race teardown permits unmap only after destroy");
    free(owner);
    mock_control_destroy(&control);
}

typedef struct {
    framer_resident_owner *owner;
    uint32_t result;
} callback_shutdown_race;

static void *race_owner_callback(void *opaque)
{
    callback_shutdown_race *race = (callback_shutdown_race *)opaque;
    framer_mqjs_result result = framer_resident_owner_step(race->owner);
    __atomic_store_n(&race->result, (uint32_t)result, __ATOMIC_RELEASE);
    return NULL;
}

static void test_callback_crossing_shutdown(uint8_t *package,
                                            size_t package_bytes)
{
    mock_control control;
    framer_resident_owner *owner;
    callback_shutdown_race race;
    pthread_t callback_thread;
    unsigned int attempts;
    uint32_t mailbox_sequence;
    mock_control_init(&control);
    owner = boot_owner(&control, package, package_bytes);
    memset(&race, 0, sizeof(race));
    race.owner = owner;
    mailbox_sequence = __atomic_load_n(&owner->mailbox.sequence,
                                       __ATOMIC_ACQUIRE);
    require(framer_resident_owner_enqueue_host_rpc(
                owner, 7u, 0x1234u, 44, 0),
            "queue callback crossing shutdown");
    __atomic_store_n(&control.block_dispatch, 1u, __ATOMIC_RELEASE);
    require(pthread_create(&callback_thread, NULL, race_owner_callback, &race) == 0,
            "create owner callback crossing shutdown");
    for (attempts = 0u; attempts < 1000000u &&
         __atomic_load_n(&control.dispatch_entered, __ATOMIC_ACQUIRE) == 0u;
         ++attempts)
        sched_yield();
    require(attempts < 1000000u &&
            __atomic_load_n(&owner->owner_runtime_inflight,
                            __ATOMIC_ACQUIRE) == 1u,
            "owner callback registered before shutdown");
    require(framer_resident_owner_begin_quiesce(
                owner, 700u, FRAMER_MQJS_INPUT_REASON_DISCONNECT),
            "close gates while owner callback is active");
    require(owner->capability.advertised == 0u &&
            !framer_resident_owner_stop_on_task(owner) &&
            control.destroy_calls == 0u && control.release_calls == 0u,
            "destroy and release wait for active owner callback");
    __atomic_store_n(&control.allow_dispatch_finish, 1u, __ATOMIC_RELEASE);
    require(pthread_join(callback_thread, NULL) == 0,
            "join callback crossing shutdown");
    require((framer_mqjs_result)__atomic_load_n(&race.result,
                                                __ATOMIC_ACQUIRE) ==
                FRAMER_MQJS_ERR_PUBLISH &&
            control.publish_rejections == 1u &&
            __atomic_load_n(&owner->mailbox.sequence, __ATOMIC_ACQUIRE) ==
                mailbox_sequence &&
            owner->capability.state == FRAMER_RESIDENT_CAP_QUIESCING &&
            owner->owner_runtime_inflight == 0u,
            "callback after close cannot publish or fault teardown");
    for (attempts = 0u; attempts < 64u &&
         !framer_resident_owner_stop_on_task(owner); ++attempts)
        sched_yield();
    require(attempts < 64u && control.destroy_calls == 1u &&
            framer_resident_capability_mark_unmapped(&owner->capability) &&
            framer_resident_capability_flash_write_allowed(&owner->capability),
            "callback race drains before destroy and unmap");
    free(owner);
    mock_control_destroy(&control);
}

int main(int argc, char **argv)
{
    uint32_t cases;
    uint8_t *plain;
    uint8_t *rich;
    size_t plain_bytes;
    size_t rich_bytes;
    require(argc == 4, "usage: host_harness corpus plain.f2js rich.f2js");
    cases = test_parity_corpus(argv[1]);
    plain = read_file(argv[2], &plain_bytes);
    rich = read_file(argv[3], &rich_bytes);
    test_mailbox();
    test_owner(plain, plain_bytes);
    test_tagged_completion_interleave(plain, plain_bytes);
    test_failure_teardown(plain, plain_bytes);
    test_raster_transport(rich, rich_bytes);
    test_concurrent_teardown(plain, plain_bytes);
    test_callback_crossing_shutdown(plain, plain_bytes);
    free(plain);
    free(rich);
    printf("resident_integration parity=%u mailbox=pass owner=pass "
           "recovery_bound=pass teardown=pass teardown_race=pass "
           "second_boot=pass input_poll=pass raster=pass "
           "event_retirement=pass callback_shutdown=pass "
           "tagged_interleave=pass "
           "mailbox_bytes=%zu admission_bytes=%zu owner_bytes=%zu "
           "task_stack_bytes=%u\n",
           cases, sizeof(framer_resident_mailbox),
           sizeof(framer_f2js_admission), sizeof(framer_resident_owner),
           FRAMER_RESIDENT_VM_STACK_BYTES);
    return 0;
}
