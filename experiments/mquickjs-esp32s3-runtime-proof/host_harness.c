#include "runtime_proof.h"

#include <assert.h>
#include <stdio.h>
#include <string.h>

typedef struct {
    uint8_t block[FRAMER_RUNTIME_PHYSICAL_BLOCK_AUDITED_MIN_BYTES];
    uint32_t calls;
    uint32_t caps[4];
    size_t bytes[4];
    uint32_t releases;
    uint32_t delays;
    uint32_t delay_ticks;
    uint32_t steps;
} mock_platform;

typedef struct {
    char output[113];
    uint8_t guard;
} guarded_status;

static size_t mock_free(void *opaque, uint32_t caps)
{
    mock_platform *mock = (mock_platform *)opaque;
    mock->caps[mock->calls++] = caps;
    return FRAMER_RUNTIME_PHYSICAL_BLOCK_AUDITED_MIN_BYTES +
           FRAMER_RUNTIME_INTERNAL_RESERVE_BYTES + 4096u;
}

static size_t mock_largest(void *opaque, uint32_t caps)
{
    mock_platform *mock = (mock_platform *)opaque;
    mock->caps[mock->calls++] = caps;
    return FRAMER_RUNTIME_PHYSICAL_BLOCK_AUDITED_MIN_BYTES + 4096u;
}

static void *mock_allocate(void *opaque, size_t bytes, uint32_t caps)
{
    mock_platform *mock = (mock_platform *)opaque;
    unsigned int call = mock->calls++;
    mock->caps[call] = caps;
    mock->bytes[call] = bytes;
    if (bytes == FRAMER_RUNTIME_PHYSICAL_BLOCK_AUDITED_MIN_BYTES)
        return mock->block;
    return NULL;
}

static void mock_release(void *opaque, void *allocation)
{
    mock_platform *mock = (mock_platform *)opaque;
    assert(allocation == mock->block);
    mock->releases++;
}

static int mock_internal(void *opaque, const void *allocation, size_t bytes)
{
    mock_platform *mock = (mock_platform *)opaque;
    return allocation == mock->block && bytes == sizeof(mock->block);
}

static mock_platform *active_mock;

static int mock_step(void *opaque)
{
    mock_platform *mock = (mock_platform *)opaque;
    mock->steps++;
    return 7;
}

static void mock_delay(uint32_t ticks)
{
    active_mock->delays++;
    active_mock->delay_ticks = ticks;
}

static uint32_t mock_hwm(void *task)
{
    assert(task == (void *)(uintptr_t)0x1234u);
    return 8192u;
}

int main(void)
{
    framer_runtime_rpc_context rpc;
    framer_runtime_rpc_context rpc_methods[FRAMER_RUNTIME_RPC_CONTEXT_COUNT];
    char mutable_methods[FRAMER_RUNTIME_RPC_CONTEXT_COUNT][32] = {
        "widget.mquickjs.cap", "widget.mquickjs.telemetry",
        "widget.mquickjs.event", "widget.mquickjs.receipt",
    };
    framer_runtime_receipt receipt;
    framer_runtime_receipt_snapshot input = {0};
    framer_runtime_receipt_snapshot output = {0};
    framer_runtime_capability capability = {0};
    framer_runtime_telemetry telemetry = {0};
    framer_runtime_key_probe probe;
    framer_runtime_key_probe probe_snapshot;
    framer_runtime_visibility visibility;
    framer_runtime_internal_allocations allocations;
    framer_runtime_producer_gate gate;
    framer_runtime_owner_loop loop = {0};
    mock_platform mock = {0};
    framer_runtime_heap_api heap = {
        .opaque = &mock, .free_size = mock_free, .largest_block = mock_largest,
        .allocate = mock_allocate, .release = mock_release,
        .internal_range = mock_internal,
    };
    uint32_t logical = 0u;
    uint32_t generation = 0u;
    uint32_t revision = 0u;
    unsigned int page;
    guarded_status guarded;
    char exact_boundary[113];
    char one_over_boundary[114];
    char package_abi_page[113] = {0};
    char module_abi_page[113] = {0};

    assert(sizeof(rpc) == 352u);
    assert(offsetof(framer_runtime_rpc_context, blocked) == 192u);
    assert(offsetof(framer_runtime_rpc_context, value) == 200u);
    assert(offsetof(framer_runtime_rpc_context, status_key) == 313u);
    assert(offsetof(framer_runtime_rpc_context, method) == 320u);
    framer_runtime_rpc_init(&rpc, "widget.mquickjs.event");
    assert(strcmp(rpc.blocked, "blocked") == 0 &&
           strcmp(rpc.status_key, "status") == 0 &&
           strcmp(rpc.method, "widget.mquickjs.event") == 0);
    assert(strcmp(FRAMER_RUNTIME_RPC_METHOD_CAP, "widget.mquickjs.cap") == 0 &&
           strcmp(FRAMER_RUNTIME_RPC_METHOD_TELEMETRY,
                  "widget.mquickjs.telemetry") == 0 &&
           strcmp(FRAMER_RUNTIME_RPC_METHOD_EVENT,
                  "widget.mquickjs.event") == 0 &&
           strcmp(FRAMER_RUNTIME_RPC_METHOD_RECEIPT,
                  "widget.mquickjs.receipt") == 0);
    assert(framer_runtime_rpc_begin(&rpc));
    assert(!framer_runtime_rpc_begin(&rpc));
    framer_runtime_rpc_end(&rpc);
    assert(rpc.callback_calls == 1u);
    for (unsigned int method = 0u;
         method < FRAMER_RUNTIME_RPC_CONTEXT_COUNT; ++method) {
        char expected[32];
        memcpy(expected, mutable_methods[method], sizeof(expected));
        framer_runtime_rpc_init(&rpc_methods[method], mutable_methods[method]);
        memset(mutable_methods[method], 'x', sizeof(mutable_methods[method]));
        assert(strcmp(rpc_methods[method].method, expected) == 0);
        assert(rpc_methods[method].method != rpc_methods[(method + 3u) %
            FRAMER_RUNTIME_RPC_CONTEXT_COUNT].method);
    }

    framer_runtime_receipt_init(&receipt);
    input.state = FRAMER_RUNTIME_RECEIPT_QUEUED;
    input.queue_depth = 1u;
    input.event_sequence = 9u;
    input.generation = 18u;
    input.revision = 3u;
    input.event_id = 0xb24fu;
    input.event_value = 3;
    input.event_auxiliary = 15;
    input.applied_generation = 18u;
    input.applied_revision = 2u;
    framer_runtime_receipt_publish(&receipt, &input);
    assert(framer_runtime_receipt_try_read(&receipt, &output));
    assert(memcmp(&input, &output, sizeof(input)) == 0);
    assert(framer_runtime_receipt_format(&output, rpc.value));
    assert(strcmp(rpc.value,
        "v1;s=Q;q=00000001;seq=00000009;g=00000012;r=00000003;id=0000b24f;v=00000003;a=0000000f;ag=00000012;ar=00000002") == 0);
    input.state = FRAMER_RUNTIME_RECEIPT_FAULTED;
    input.event_sequence = 17u;
    input.event_id = FRAMER_RUNTIME_WEATHER_RPC_ID;
    input.event_value = (int32_t)FRAMER_RUNTIME_FAULT_TIMEOUT_VALUE;
    input.event_auxiliary = (int32_t)FRAMER_RUNTIME_FAULT_TIMEOUT_AUXILIARY;
    framer_runtime_receipt_publish(&receipt, &input);
    assert(framer_runtime_receipt_try_read(&receipt, &output));
    assert(framer_runtime_receipt_format(&output, rpc.value));
    assert(strcmp(rpc.value,
        "v1;s=F;q=00000001;seq=00000011;g=00000012;r=00000003;id=0000b24d;v=80000000;a=54494d45;ag=00000012;ar=00000002") == 0);
    for (page = FRAMER_RUNTIME_RECEIPT_COLD;
         page <= FRAMER_RUNTIME_RECEIPT_FAULTED; ++page) {
        guarded.guard = 0xa5u;
        output.state = page;
        assert(framer_runtime_receipt_format(&output, guarded.output));
        assert(strlen(guarded.output) <= 112u && guarded.guard == 0xa5u);
    }

    memset(capability.base_app_sha256, 'a', 64u);
    memset(capability.module_sha256, 'b', 64u);
    memset(capability.package_sha256, 'c', 64u);
    capability.boot_id = UINT64_C(0x0123456789abcdef);
    capability.generation = 19u;
    for (page = 0u; page < FRAMER_RUNTIME_CAPABILITY_PAGES; ++page) {
        guarded.guard = 0xa5u;
        assert(framer_runtime_capability_format(&capability, page,
                                                 guarded.output));
        assert(strlen(guarded.output) <= 112u && guarded.guard == 0xa5u);
        memcpy(rpc.value, guarded.output, strlen(guarded.output) + 1u);
        if (page == 6u)
            memcpy(package_abi_page, guarded.output,
                   strlen(guarded.output) + 1u);
        else if (page == 11u)
            memcpy(module_abi_page, guarded.output,
                   strlen(guarded.output) + 1u);
    }
    /* uploader= on page 0 follows the capability field; everything else on
     * the page is unchanged by the flag. */
    capability.runtime_uploader = 1u;
    guarded.guard = 0xa5u;
    assert(framer_runtime_capability_format(&capability, 0u, guarded.output));
    assert(strlen(guarded.output) <= 112u && guarded.guard == 0xa5u);
    assert(strstr(guarded.output, ";uploader=1") != (char *)0);
    capability.runtime_uploader = 0u;
    guarded.guard = 0xa5u;
    assert(framer_runtime_capability_format(&capability, 0u, guarded.output));
    assert(strstr(guarded.output, ";uploader=0") != (char *)0);

    assert(strcmp(FRAMER_RUNTIME_PACKAGE_ABI_SHA256,
                  FRAMER_RUNTIME_MODULE_ABI_SHA256) != 0);
    assert(strcmp(package_abi_page,
                  "v1;p=6;packageAbiSha256="
                  FRAMER_RUNTIME_PACKAGE_ABI_SHA256) == 0);
    assert(strcmp(module_abi_page,
                  "v1;p=11;moduleAbiSha256="
                  FRAMER_RUNTIME_MODULE_ABI_SHA256) == 0);
    assert(strstr(package_abi_page, FRAMER_RUNTIME_MODULE_ABI_SHA256) == NULL &&
           strstr(module_abi_page, FRAMER_RUNTIME_PACKAGE_ABI_SHA256) == NULL);
    assert(strcmp(rpc.value,
        "v1;p=12;screenIds=1,7,26,27,28;methods=0f;wdt=unsubscribed;map=bootlife") == 0);

    telemetry.boot_id = UINT64_C(0x0123456789abcdef);
    telemetry.uptime_us = UINT64_C(0x1111111122222222);
    telemetry.polls = UINT64_C(0x3333333344444444);
    telemetry.free_internal = 1u;
    telemetry.largest_internal = 2u;
    telemetry.heap_current = 3u;
    telemetry.heap_high_water = 4u;
    telemetry.stack_minimum = 5u;
    telemetry.callbacks = 6u;
    telemetry.deadline_us = FRAMER_RUNTIME_CALLBACK_DEADLINE_US;
    telemetry.timeouts = 7u;
    telemetry.oom = 8u;
    telemetry.exceptions = 9u;
    telemetry.max_slice_us = 10u;
    telemetry.loads = 11u;
    telemetry.source_rejected = 12u;
    telemetry.publish_failed = 13u;
    telemetry.wrong_thread = 14u;
    telemetry.recoveries = 1u;
    telemetry.recovery_failures = 0u;
    telemetry.last_result = FRAMER_RUNTIME_RESULT_TIMEOUT;
    telemetry.last_event_sequence = 17u;
    telemetry.fatal = 0u;
    telemetry.queue_depth = 19u;
    telemetry.events_queued = 20u;
    telemetry.events_applied = 21u;
    telemetry.events_rejected = 22u;
    telemetry.mailbox_sequence = 23u;
    telemetry.applied_generation = 19u;
    telemetry.applied_revision = 24u;
    telemetry.delays = 25u;
    telemetry.screen = FRAMER_RUNTIME_SCREEN_ID;
    telemetry.visible = 1u;
    telemetry.replay_count = 26u;
    telemetry.key_observations = 27u;
    telemetry.last_token = FRAMER_RUNTIME_TOKEN_SPACE;
    telemetry.last_level = 1u;
    telemetry.key_gate = 1u;
    telemetry.chord_active = 1u;
    telemetry.weather_applied_revision = 28u;
    for (page = 0u; page < 6u; ++page) {
        guarded.guard = 0xa5u;
        assert(framer_runtime_telemetry_format(&telemetry, page,
                                                guarded.output));
        assert(strlen(guarded.output) <= 112u && guarded.guard == 0xa5u);
        memcpy(rpc.value, guarded.output, strlen(guarded.output) + 1u);
        if (page == 2u)
            assert(strcmp(rpc.value,
                "v1;p=2;l=0000000b;s=0000000c;p=0000000d;w=0000000e;r=00000001;R=00000000;x=fffffffa;n=00000011;f=00000000") == 0);
    }
    memset(exact_boundary, 'x', 112u);
    exact_boundary[112] = 0;
    memset(one_over_boundary, 'x', 113u);
    one_over_boundary[113] = 0;
    guarded.guard = 0xa5u;
    assert(framer_runtime_status_copy(exact_boundary, guarded.output));
    assert(strlen(guarded.output) == 112u && guarded.guard == 0xa5u);
    guarded.guard = 0xa5u;
    assert(!framer_runtime_status_copy(one_over_boundary, guarded.output));
    assert(strlen(guarded.output) == 112u && guarded.guard == 0xa5u);
    assert(FRAMER_RUNTIME_FAULT_TIMEOUT_VALUE == UINT32_C(0x80000000) &&
           FRAMER_RUNTIME_FAULT_TIMEOUT_AUXILIARY == UINT32_C(0x54494d45) &&
           FRAMER_RUNTIME_FAULT_OOM_VALUE == UINT32_C(0x80000001) &&
           FRAMER_RUNTIME_FAULT_OOM_AUXILIARY == UINT32_C(0x4f4f4d21));
    assert((int32_t)FRAMER_RUNTIME_FAULT_TIMEOUT_VALUE < 0 &&
           (int32_t)FRAMER_RUNTIME_FAULT_OOM_VALUE < 0);

    framer_runtime_key_probe_init(&probe);
    framer_runtime_key_probe_observe(&probe, FRAMER_RUNTIME_TOKEN_SPACE, 1u);
    framer_runtime_key_probe_observe(&probe, FRAMER_RUNTIME_TOKEN_SPACE, 0u);
    framer_runtime_key_probe_observe(&probe, FRAMER_RUNTIME_TOKEN_LEFT_SHIFT, 1u);
    assert(!framer_runtime_key_probe_commit(&probe));
    framer_runtime_key_probe_observe(&probe, FRAMER_RUNTIME_TOKEN_LEFT_SHIFT, 0u);
    assert(framer_runtime_key_probe_commit(&probe));
    assert(framer_runtime_key_probe_try_read(&probe, &probe_snapshot));
    assert(probe_snapshot.last_token == FRAMER_RUNTIME_TOKEN_LEFT_SHIFT &&
           probe_snapshot.last_level == 0u &&
           probe_snapshot.observation_count == 4u &&
           probe_snapshot.committed == 1u);
    assert(framer_runtime_key_probe_map(&probe, FRAMER_RUNTIME_TOKEN_SPACE,
                                        &logical) &&
           logical == FRAMER_RUNTIME_TOKEN_SPACE);
    assert(!framer_runtime_key_probe_map(&probe, 0xe5u, &logical));

    framer_runtime_visibility_init(&visibility);
    framer_runtime_visibility_publish(&visibility, 18u, 2u);
    assert(framer_runtime_visibility_set(&visibility, 0));
    assert(__atomic_load_n(&visibility.key_ingress_enabled,
                           __ATOMIC_ACQUIRE) == 0u &&
           __atomic_load_n(&visibility.release_all_pending,
                           __ATOMIC_ACQUIRE) != 0u);
    framer_runtime_visibility_publish(&visibility, 18u, 3u);
    assert(!framer_runtime_visibility_take_replay(&visibility, &generation,
                                                  &revision));
    assert(framer_runtime_visibility_set(&visibility, 1));
    assert(framer_runtime_visibility_take_replay(&visibility, &generation,
                                                 &revision));
    assert(generation == 18u && revision == 3u);

    assert(framer_runtime_allocate_internal(
        &heap, &allocations,
        FRAMER_RUNTIME_PHYSICAL_BLOCK_AUDITED_MIN_BYTES));
    assert(mock.calls == 3u && mock.caps[0] == FRAMER_RUNTIME_INTERNAL_CAPS &&
           mock.caps[1] == FRAMER_RUNTIME_INTERNAL_CAPS &&
           mock.caps[2] == FRAMER_RUNTIME_INTERNAL_CAPS);
    assert(mock.bytes[2] ==
           FRAMER_RUNTIME_PHYSICAL_BLOCK_AUDITED_MIN_BYTES);
    framer_runtime_release_internal(&heap, &allocations);
    assert(mock.releases == 1u);

    framer_runtime_producer_init(&gate, 18u);
    assert(framer_runtime_producer_enter(&gate, 18u));
    framer_runtime_producer_retire(&gate);
    assert(!framer_runtime_producer_retired(&gate));
    framer_runtime_producer_leave(&gate);
    assert(framer_runtime_producer_retired(&gate));
    assert(!framer_runtime_producer_enter(&gate, 18u));

    active_mock = &mock;
    loop.opaque = &mock;
    loop.task = (void *)(uintptr_t)0x1234u;
    loop.step = mock_step;
    loop.delay = mock_delay;
    loop.stack_high_water = mock_hwm;
    loop.enabled = 1u;
    assert(framer_runtime_owner_iteration(&loop) == 7);
    loop.enabled = 0u;
    assert(framer_runtime_owner_iteration(&loop) == 0);
    assert(loop.iterations == 2u && loop.steps == 1u && loop.delays == 2u &&
           mock.steps == 1u && mock.delays == 2u &&
           mock.delay_ticks == FRAMER_RUNTIME_OWNER_DELAY_TICKS &&
           loop.minimum_stack_bytes == 8192u);
    assert(!framer_runtime_live_flash_write_allowed());

    printf("runtime_proof rpc=pass receipt=pass keys=space+left-shift chord=0x3 "
           "internal=%u reserve=%u owner_step_us=%u delay_ticks=%u "
           "visibility=foreground-release-replay flash_runtime=disabled\n",
           FRAMER_RUNTIME_PHYSICAL_BLOCK_AUDITED_MIN_BYTES,
           FRAMER_RUNTIME_INTERNAL_RESERVE_BYTES,
           FRAMER_RUNTIME_OWNER_STEP_MAX_US,
           FRAMER_RUNTIME_OWNER_DELAY_TICKS);
    return 0;
}
