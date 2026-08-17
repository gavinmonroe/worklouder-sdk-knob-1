/* Exact copy of experiments/mquickjs-esp32s3-physical-canary/physical_host_harness.c
 * (a tracked source that is not edited) with four changes, all forced by the
 * gen20 widget:
 *   1. tick.100ms is no longer registered (its handler slot went to
 *      host.rpc:0xB245), so both dispatches additionally assert that the
 *      callback counter does not move: the engine still accepts the retired
 *      cadence and runs nothing for it;
 *   2. the hostile seventeenth registration moves to host.rpc:0xB246, because
 *      0xB245 is now one of the sixteen handlers the program itself registers;
 *   3. a ZIP settings section drives the real chord/hold/knob edges through the
 *      input queue and checks the published settings word;
 *   4. the JSON adds the settings evidence.
 */
#define FRAMER_RUNTIME_PROOF_EXACT_ABI_ACK 0x36317013u

#include "backend_contract.h"
#include "completion_contract.h"
#include "framer_mquickjs_canary.h"
#include "fatal_retirement.h"
#include "focus_contract.h"
#include "key_gate.h"
#include "key_token.h"
#include "publication_contract.h"
#include "telemetry_session.h"

#include <assert.h>
#include <inttypes.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef union {
    uint64_t alignment;
    uint8_t bytes[FRAMER_MQJS_MIN_HEAP_BYTES];
} aligned_heap;

typedef struct {
    uint64_t now;
    uint32_t step;
    uint32_t publishes;
    uint32_t revision;
    int32_t slots[FRAMER_MQJS_SLOT_COUNT];
} host_state;

typedef struct {
    uint32_t vptr;
    uint32_t common_04;
    uint32_t common_08;
    uint32_t root;
    uint32_t common_16;
    uint32_t registry;
} publication_proxy_model;

typedef struct {
    uint32_t allocations;
    uint32_t maps;
    uint32_t startups;
} backend_gate_effects;

_Static_assert(offsetof(publication_proxy_model, root) ==
                   FRAMER_PHYSICAL_PROXY_ROOT_OFFSET &&
               offsetof(publication_proxy_model, registry) ==
                   FRAMER_PHYSICAL_PROXY_REGISTRY_OFFSET,
               "host publication model lost common controller offsets");

static void model_add_controller(uint32_t registry,
                                 publication_proxy_model *proxy)
{
    proxy->registry = registry;
}

static void model_base_slot0(publication_proxy_model *proxy, uint32_t root)
{
    proxy->root = root;
}

static int model_loader_gate(const framer_physical_backend_snapshot *snapshot,
                             backend_gate_effects *effects)
{
    if (!framer_physical_backend_snapshot_valid(snapshot))
        return 0;
    effects->allocations += 1u;
    effects->maps += 1u;
    effects->startups += 1u;
    return 1;
}

static framer_physical_backend_snapshot valid_backend_snapshot(void)
{
    framer_physical_backend_snapshot snapshot;
    memset(&snapshot, 0, sizeof(snapshot));
    snapshot.controller = 0x3c200000u;
    snapshot.controller_registry = 0x3fc88000u;
    snapshot.expected_registry = snapshot.controller_registry;
    snapshot.sidecar = 0x3fc90000u;
    snapshot.vtable = snapshot.sidecar +
                      FRAMER_PHYSICAL_BACKEND_SIDECAR_VTABLE_OFFSET;
    snapshot.slot6 = FRAMER_PHYSICAL_BACKEND_LIVE_TICK;
    snapshot.slot8 = FRAMER_PHYSICAL_BACKEND_ID26;
    snapshot.slot9 = FRAMER_PHYSICAL_BACKEND_LIVE_ENCODER;
    snapshot.slot11 = snapshot.sidecar;
    snapshot.sidecar_magic = FRAMER_PHYSICAL_BACKEND_SIDECAR_MAGIC;
    snapshot.sidecar_old_tick = FRAMER_PHYSICAL_BACKEND_OLD_TICK;
    snapshot.sidecar_old_encoder = FRAMER_PHYSICAL_BACKEND_OLD_ENCODER;
    return snapshot;
}

static void prove_backend_gate(void)
{
    framer_physical_backend_snapshot valid = valid_backend_snapshot();
    framer_physical_backend_snapshot hostile;
    backend_gate_effects effects;
#define REJECT_WITH_ZERO_EFFECTS(statement) do { \
        memset(&effects, 0, sizeof(effects)); \
        hostile = valid; \
        statement; \
        assert(!model_loader_gate(&hostile, &effects)); \
        assert(effects.allocations == 0u && effects.maps == 0u && \
               effects.startups == 0u); \
    } while (0)
    memset(&effects, 0, sizeof(effects));
    assert(!model_loader_gate(NULL, &effects));
    assert(effects.allocations == 0u && effects.maps == 0u &&
           effects.startups == 0u);
    REJECT_WITH_ZERO_EFFECTS(hostile.controller = 0x11111110u);
    REJECT_WITH_ZERO_EFFECTS(hostile.controller = 0x3c3cfff0u);
    REJECT_WITH_ZERO_EFFECTS(hostile.vtable = 0x11111110u);
    REJECT_WITH_ZERO_EFFECTS(hostile.slot6 = FRAMER_PHYSICAL_BACKEND_OLD_TICK);
    REJECT_WITH_ZERO_EFFECTS(hostile.slot8 = FRAMER_PHYSICAL_BACKEND_OLD_ENCODER);
    REJECT_WITH_ZERO_EFFECTS(hostile.slot9 = FRAMER_PHYSICAL_BACKEND_LIVE_TICK);
    REJECT_WITH_ZERO_EFFECTS(hostile.sidecar = 0x11111110u;
                             hostile.slot11 = hostile.sidecar;
                             hostile.vtable = hostile.sidecar +
                                 FRAMER_PHYSICAL_BACKEND_SIDECAR_VTABLE_OFFSET);
    REJECT_WITH_ZERO_EFFECTS(hostile.sidecar_magic = 0u);
    REJECT_WITH_ZERO_EFFECTS(hostile.sidecar_old_tick =
                                 FRAMER_PHYSICAL_BACKEND_LIVE_TICK);
    REJECT_WITH_ZERO_EFFECTS(hostile.sidecar_old_encoder =
                                 FRAMER_PHYSICAL_BACKEND_LIVE_ENCODER);
    REJECT_WITH_ZERO_EFFECTS(hostile.controller_registry = 0x3fc88004u);
    memset(&effects, 0, sizeof(effects));
    assert(model_loader_gate(&valid, &effects));
    assert(effects.allocations == 1u && effects.maps == 1u &&
           effects.startups == 1u);
#undef REJECT_WITH_ZERO_EFFECTS
}

static uint64_t host_now(void *opaque)
{
    host_state *state = (host_state *)opaque;
    state->now += state->step;
    return state->now;
}

static uintptr_t host_thread(void *opaque)
{
    (void)opaque;
    return (uintptr_t)0x5151u;
}

static int host_publish(void *opaque, const int32_t slots[FRAMER_MQJS_SLOT_COUNT],
                        uint32_t revision)
{
    host_state *state = (host_state *)opaque;
    memcpy(state->slots, slots, sizeof(state->slots));
    state->revision = revision;
    state->publishes += 1u;
    return 1;
}

static char *load_source(const char *path, size_t *bytes)
{
    FILE *file = fopen(path, "rb");
    char *source;
    long length;
    assert(file != NULL && fseek(file, 0, SEEK_END) == 0);
    length = ftell(file);
    assert(length > 0 && fseek(file, 0, SEEK_SET) == 0);
    source = (char *)malloc((size_t)length + 128u);
    assert(source != NULL &&
           fread(source, 1u, (size_t)length, file) == (size_t)length &&
           fclose(file) == 0);
    source[length] = '\0';
    *bytes = (size_t)length;
    return source;
}

static void dispatch_ok(framer_mqjs_runtime *runtime, const char *event,
                        int32_t value, int32_t auxiliary)
{
    framer_mqjs_result result =
        framer_mqjs_dispatch(runtime, event, value, auxiliary);
    if (result != FRAMER_MQJS_OK)
        fprintf(stderr, "dispatch %s returned %d\n", event, (int)result);
    assert(result == FRAMER_MQJS_OK);
}

static void prove_physical_protocol_helpers(void)
{
    framer_physical_telemetry_session session;
    framer_runtime_telemetry first;
    framer_runtime_telemetry refreshed;
    framer_runtime_key_probe key_probe;
    uint32_t observations;
    const framer_runtime_telemetry *selected;
    char page5[113];
    uint8_t boundary[115];
    char *bounded = (char *)(void *)(boundary + 1u);
    uint32_t page;
    volatile uint32_t retired = 0u;
    publication_proxy_model proxy;
    uint32_t registry_word = 0x3fc88000u;
    uint32_t root_word = 0x3fc90000u;
    uint32_t navigation_published = 0u;
    uint32_t rpc_ready = 0u;
    uint32_t focus_visible = 1u;
    uint32_t focus_ready = 1u;
    uint32_t focus_inflight = 1u;
    uint32_t focus_requested = 0u;
    uint32_t focus_draining = 0u;
    uint32_t focus_applied = 0u;
    uint32_t focus_poll_armed = 1u;
    uint32_t focus_held_mask = 3u;
    uint32_t focus_terminal_state = 0u;
    uint32_t focus_late_edges = 0u;
    uint32_t focus_owner_input_pending = 0u;
    uint32_t focus_engine_pending = 0u;
    uint32_t focus_host_queued = 0u;
    uint32_t hidden_knob_js = 0u;
    uint32_t hidden_knob_stock = 0u;
    uint32_t pre_step_armed = 0u;
    uint32_t completion_fields_ready = 0u;
    uint32_t completion_telemetry_ready = 0u;
    uint32_t completion_admission_closed = 1u;
    memset(&session, 0, sizeof(session));
    memset(&first, 0, sizeof(first));
    memset(&refreshed, 0, sizeof(refreshed));
    first.boot_id = UINT64_C(0x1111111111111111);
    refreshed.boot_id = UINT64_C(0x2222222222222222);
    prove_backend_gate();

    /* RPC can arm after the owner's pre-step observation. Only exact tagged
     * consumption is authoritative, and it must force immediate p2 refresh
     * even when the ordinary 100 ms cache cadence is not due. */
    assert(pre_step_armed == 0u);
    completion_fields_ready = 1u;
    assert(!framer_physical_completion_can_publish(
        completion_fields_ready, completion_telemetry_ready,
        completion_admission_closed));
    completion_telemetry_ready = 1u;
    assert(framer_physical_completion_can_publish(
        completion_fields_ready, completion_telemetry_ready,
        completion_admission_closed));
    assert(!framer_physical_periodic_refresh_due(1u, 100u));
    assert(framer_physical_periodic_refresh_due(0u, 100u));

    /* The accepted ABI leaves root+12 unset through addController and writes
     * only registry+20. Navigation/RPC may publish after that registry
     * postcondition. Common base slot0 later owns root+12 and must run before
     * screen-specific build; build admission rejects zero/wrong roots. */
    memset(&proxy, 0, sizeof(proxy));
    assert(proxy.root == 0u && proxy.registry == 0u);
    model_add_controller(registry_word, &proxy);
    assert(proxy.root == 0u &&
           framer_physical_registration_matches(
               (const void *)(uintptr_t)proxy.registry,
               (const void *)(uintptr_t)registry_word));
    if (framer_physical_registration_matches(
            (const void *)(uintptr_t)proxy.registry,
            (const void *)(uintptr_t)registry_word)) {
        navigation_published = 1u;
        rpc_ready = 1u;
    }
    assert(navigation_published == 1u && rpc_ready == 1u);
    assert(!framer_physical_lifecycle_root_ready(
        (const void *)(uintptr_t)proxy.root));
    model_base_slot0(&proxy, root_word);
    assert(framer_physical_lifecycle_root_ready(
        (const void *)(uintptr_t)proxy.root));
    assert(!framer_physical_lifecycle_root_ready(
        (const void *)(uintptr_t)0x3c200000u));
    assert(!framer_physical_lifecycle_root_ready(
        (const void *)(uintptr_t)0x3c3cfffeu));

    /* Model the exact hide race: a wrapper crossed the open gate before
     * cleanup, so cleanup closes visibility/input and cancels polling, but
     * owner issuance waits for that wrapper to enqueue and retire. The
     * resumable release discards the late edge, clears the held chord, leaves
     * both terminal gates untouched, and only then permits re-entry. */
    assert(framer_physical_focus_accepts_key(focus_visible, focus_ready));
    focus_visible = focus_ready = focus_poll_armed = 0u;
    focus_requested += 1u;
    assert(!framer_physical_focus_can_issue(
        focus_requested, focus_applied, focus_draining, focus_inflight));
    focus_late_edges += 1u;
    focus_inflight = 0u;
    assert(framer_physical_focus_can_issue(
        focus_requested, focus_applied, focus_draining, focus_inflight));
    /* A transient MORE_PENDING is not issuance and must remain retryable. */
    assert(focus_draining == 0u &&
           framer_physical_focus_can_issue(
               focus_requested, focus_applied, focus_draining,
               focus_inflight));
    focus_draining = focus_requested;
    focus_owner_input_pending = 1u;
    focus_engine_pending = 0u;
    focus_host_queued = 1u;
    /* prefer_input may let the queued host event win this step. The release
     * cannot ACK from an already-zero held snapshot while resident input is
     * still pending. */
    focus_host_queued = 0u;
    assert(!framer_physical_focus_can_ack(
        focus_draining, focus_owner_input_pending, focus_engine_pending,
        focus_held_mask));
    focus_owner_input_pending = 0u;
    focus_late_edges = 0u;
    focus_held_mask = 0u;
    assert(focus_host_queued == 0u && framer_physical_focus_can_ack(
        focus_draining, focus_owner_input_pending, focus_engine_pending,
        focus_held_mask));
    focus_applied = focus_draining;
    focus_draining = 0u;
    assert(focus_late_edges == 0u && focus_held_mask == 0u &&
           focus_poll_armed == 0u && focus_terminal_state == 0u &&
           !framer_physical_focus_accepts_key(focus_visible, focus_ready));
    if (framer_physical_focus_accepts_key(focus_visible, focus_ready))
        hidden_knob_js += 1u;
    else
        hidden_knob_stock += 1u;
    assert(hidden_knob_js == 0u && hidden_knob_stock == 1u);
    focus_visible = 1u;
    if (framer_physical_focus_can_reopen(
            focus_visible, focus_requested, focus_applied, focus_draining,
            focus_terminal_state))
        focus_ready = 1u;
    assert(framer_physical_focus_accepts_key(focus_visible, focus_ready));
    if (framer_physical_focus_accepts_key(focus_visible, focus_ready))
        hidden_knob_js += 1u;
    assert(hidden_knob_js == 1u && hidden_knob_stock == 1u);

    /* Page zero freezes both telemetry and the UI maximum. Refreshing the
     * live source between every later page cannot tear this transaction. */
    assert(framer_physical_telemetry_session_select(
        &session, 0, 100u, &first, 0x1234u, &selected));
    assert(selected->boot_id == first.boot_id && session.expected_page == 1u);
    for (page = 1u; page < FRAMER_PHYSICAL_TELEMETRY_PAGES; ++page) {
        refreshed.boot_id += 1u;
        assert(framer_physical_telemetry_session_select(
            &session, (int32_t)page, 100u + page, &refreshed, 0x9999u,
            &selected));
        assert(selected->boot_id == first.boot_id &&
               session.ui_max_us == 0x1234u);
    }
    assert(session.expected_page == 0u);
    strcpy(page5, "v1;p=5;r=0000002a");
    assert(framer_physical_telemetry_append_ui_max(page5,
                                                   session.ui_max_us));
    assert(strcmp(page5, "v1;p=5;r=0000002a;U=00001234") == 0);
    memset(boundary, 0xa5, sizeof(boundary));
    memset(bounded, 'x', 101u); bounded[101] = 0;
    assert(framer_physical_telemetry_append_ui_max(bounded, 0x89abcdefu));
    assert(strlen(bounded) == 112u && bounded[112] == 0 &&
           boundary[0] == 0xa5u && boundary[114] == 0xa5u);
    memset(boundary, 0xa5, sizeof(boundary));
    memset(bounded, 'x', 102u); bounded[102] = 0;
    assert(!framer_physical_telemetry_append_ui_max(bounded, 0x89abcdefu));
    assert(bounded[102] == 0 && boundary[0] == 0xa5u &&
           boundary[114] == 0xa5u);

    /* Duplicate, out-of-order, and expired sessions reject and clear. */
    assert(framer_physical_telemetry_session_select(
        &session, 0, 200u, &first, 1u, &selected));
    assert(!framer_physical_telemetry_session_select(
        &session, 0, 201u, &first, 1u, &selected));
    assert(session.expected_page == 0u);
    assert(framer_physical_telemetry_session_select(
        &session, 0, 300u, &first, 1u, &selected));
    assert(!framer_physical_telemetry_session_select(
        &session, 2, 301u, &refreshed, 2u, &selected));
    assert(session.expected_page == 0u);
    assert(framer_physical_telemetry_session_select(
        &session, 0, UINT32_MAX - 100u, &first, 1u, &selected));
    assert(!framer_physical_telemetry_session_select(
        &session, 1, UINT32_MAX - 100u +
            FRAMER_PHYSICAL_TELEMETRY_SESSION_TIMEOUT_MS,
        &refreshed, 2u, &selected));
    assert(session.expected_page == 0u);
    assert(framer_physical_telemetry_session_select(
        &session, 0, 5000u, &refreshed, 2u, &selected));

    assert(framer_physical_normalize_key_token(0xab00002cu) == 0x2cu);
    assert(framer_physical_normalize_key_token(0xcd0000e1u) == 0xe1u);
    assert(framer_physical_normalize_key_token(0xcd0000e5u) == 0xe5u);
    framer_runtime_key_probe_init(&key_probe);
    assert(!framer_physical_key_gate_observe_and_map(
        &key_probe, 0x2cu, 1u, &page));
    assert(!framer_physical_key_gate_observe_and_map(
        &key_probe, 0x2cu, 0u, &page));
    assert(!framer_physical_key_gate_observe_and_map(
        &key_probe, 0xe1u, 1u, &page));
    assert(!framer_physical_key_gate_observe_and_map(
        &key_probe, 0xe1u, 0u, &page));
    assert(key_probe.committed != 0u);
    assert(framer_physical_key_gate_observe_and_map(
        &key_probe, 0x2cu, 1u, &page) && page == 0x2cu);
    observations = key_probe.observation_count;
    assert(!framer_physical_key_gate_observe_and_map(
        &key_probe, 0xe5u, 1u, &page));
    assert(key_probe.observation_count == observations + 1u &&
           key_probe.last_token == 0xe5u);
    assert(!framer_physical_claim_fatal_retirement(&retired, 0u));
    assert(framer_physical_claim_fatal_retirement(&retired, 1u));
    assert(retired == 1u &&
           !framer_physical_claim_fatal_retirement(&retired, 1u));
}

/* One short chord tap: both admitted keys down and up well inside the 500 ms
 * hold delay, which is the "advance one ZIP cell" gesture. */
static uint32_t chord_tap(framer_mqjs_runtime *runtime, uint32_t at)
{
    assert(framer_mqjs_input_enqueue(runtime, 0x2cu, 1, at) == FRAMER_MQJS_OK);
    assert(framer_mqjs_input_drain(runtime, at + 15u) >= FRAMER_MQJS_OK);
    assert(framer_mqjs_input_enqueue(runtime, 0xe1u, 1, at + 20u) == FRAMER_MQJS_OK);
    assert(framer_mqjs_input_drain(runtime, at + 35u) >= FRAMER_MQJS_OK);
    assert(framer_mqjs_input_enqueue(runtime, 0xe1u, 0, at + 60u) == FRAMER_MQJS_OK);
    assert(framer_mqjs_input_drain(runtime, at + 75u) >= FRAMER_MQJS_OK);
    assert(framer_mqjs_input_enqueue(runtime, 0x2cu, 0, at + 80u) == FRAMER_MQJS_OK);
    assert(framer_mqjs_input_drain(runtime, at + 95u) >= FRAMER_MQJS_OK);
    return at + 200u;
}

int main(int argc, char **argv)
{
    static const char seventeenth[] =
        "\nwidget.on(\"host.rpc:0xB246\",function(event){});\n";
    aligned_heap heap;
    framer_mqjs_runtime runtime;
    framer_mqjs_config config;
    framer_mqjs_telemetry telemetry;
    framer_mqjs_telemetry before_focus;
    framer_mqjs_telemetry after_focus;
    host_state state;
    char *source;
    char *hostile;
    size_t source_bytes;
    int32_t weather_revision7[FRAMER_MQJS_SLOT_COUNT];
    int32_t fault_snapshot[FRAMER_MQJS_SLOT_COUNT];
    int32_t before_oom[FRAMER_MQJS_SLOT_COUNT];
    int32_t settings_slots[FRAMER_MQJS_SLOT_COUNT];
    uint32_t settings_word = 0u;
    uint32_t settings_saved_word = 0u;
    uint32_t at;
    unsigned int tap;
    uint32_t publishes;
    uint32_t valid_day = 10u | (20u << 10u) | (4u << 20u) | (2u << 24u);
    assert(argc == 2);
    prove_physical_protocol_helpers();
    source = load_source(argv[1], &source_bytes);
    memset(&state, 0, sizeof(state));
    memset(&config, 0, sizeof(config));
    config.opaque = &state;
    config.now_us = host_now;
    config.current_thread_token = host_thread;
    config.publish = host_publish;
    config.owner_thread_token = (uintptr_t)0x5151u;
    config.callback_deadline_us = 2000u;
    config.input.native_tokens[0] = 0x2cu;
    config.input.native_tokens[1] = 0xe1u;
    config.input.chord_masks[0] = 3u;
    config.input.key_count = 2u;
    config.input.chord_count = 1u;
    config.input.debounce_ms = 10u;
    config.input.hold_delay_ms = 500u;
    config.input.hold_cadence_ms = 100u;
    assert(framer_mqjs_init(&runtime, heap.bytes, sizeof(heap.bytes), &config) ==
           FRAMER_MQJS_OK);
    assert(framer_mqjs_load(&runtime, source, source_bytes, 1) == FRAMER_MQJS_OK);

    /* One coherent weather revision, then both timer cadences and the Fn knob. */
    dispatch_ok(&runtime, "host.rpc:0xB240", 7, 0);
    dispatch_ok(&runtime, "host.rpc:0xB241", 42 | (3 << 10), 7);
    dispatch_ok(&runtime, "host.rpc:0xB242", (int32_t)valid_day, 7);
    dispatch_ok(&runtime, "host.rpc:0xB243", (int32_t)valid_day, 7);
    dispatch_ok(&runtime, "host.rpc:0xB244", (int32_t)valid_day, 7);
    dispatch_ok(&runtime, "host.rpc:0xB24F", 7, 15);
    assert(state.slots[0] == 7 && state.publishes == 1u);
    publishes = state.publishes;
    framer_mqjs_get_telemetry(&runtime, &before_focus);
    dispatch_ok(&runtime, "tick.100ms", 0, 0);
    framer_mqjs_get_telemetry(&runtime, &after_focus);
    assert(state.publishes == publishes &&
           after_focus.callbacks == before_focus.callbacks);
    dispatch_ok(&runtime, "tick.1s", 0, 0);
    dispatch_ok(&runtime, "input.fn-bottom-knob", -3, 1);

    /* Exact Space/LeftShift down/up, a hold, and both chord transitions. */
    assert(framer_mqjs_input_enqueue(&runtime, 0x2cu, 1, 100u) == FRAMER_MQJS_OK);
    assert(framer_mqjs_input_drain(&runtime, 115u) >= FRAMER_MQJS_OK);
    assert(framer_mqjs_input_enqueue(&runtime, 0xe1u, 1, 120u) == FRAMER_MQJS_OK);
    assert(framer_mqjs_input_drain(&runtime, 135u) >= FRAMER_MQJS_OK);
    assert(framer_mqjs_input_drain(&runtime, 650u) >= FRAMER_MQJS_OK);
    assert(framer_mqjs_input_enqueue(&runtime, 0xe1u, 0, 700u) == FRAMER_MQJS_OK);
    assert(framer_mqjs_input_drain(&runtime, 715u) >= FRAMER_MQJS_OK);
    assert(framer_mqjs_input_enqueue(&runtime, 0x2cu, 0, 720u) == FRAMER_MQJS_OK);
    assert(framer_mqjs_input_drain(&runtime, 735u) >= FRAMER_MQJS_OK);

    /* Hold both admitted keys, then model the owner-side half of a hidden
     * focus transition. The nonterminal request emits synthetic key/chord-up
     * with FOCUS_LOSS, a hidden-time poll emits no hold, and the same runtime
     * accepts a complete fresh down/hold/up/chord session after re-entry. */
    framer_mqjs_get_telemetry(&runtime, &before_focus);
    assert(framer_mqjs_input_enqueue(&runtime, 0x2cu, 1, 800u) ==
           FRAMER_MQJS_OK);
    assert(framer_mqjs_input_drain(&runtime, 815u) >= FRAMER_MQJS_OK);
    assert(framer_mqjs_input_enqueue(&runtime, 0xe1u, 1, 820u) ==
           FRAMER_MQJS_OK);
    assert(framer_mqjs_input_drain(&runtime, 835u) >= FRAMER_MQJS_OK);
    assert(framer_mqjs_input_request_focus_release(&runtime, 840u) ==
           FRAMER_MQJS_INPUT_RESYNC_QUEUED);
    assert(framer_mqjs_input_drain(&runtime, 840u) >= FRAMER_MQJS_OK);
    framer_mqjs_get_telemetry(&runtime, &after_focus);
    assert(after_focus.held_key_mask == 0u &&
           after_focus.pending_input_events == 0u &&
           after_focus.key_up_events == before_focus.key_up_events + 2u &&
           after_focus.chord_up_events == before_focus.chord_up_events + 1u);
    before_focus = after_focus;
    assert(framer_mqjs_input_drain(&runtime, 1400u) >= FRAMER_MQJS_OK);
    framer_mqjs_get_telemetry(&runtime, &after_focus);
    assert(after_focus.held_key_mask == 0u &&
           after_focus.key_hold_events == before_focus.key_hold_events);
    assert(framer_mqjs_input_enqueue(&runtime, 0x2cu, 1, 1500u) ==
           FRAMER_MQJS_OK);
    assert(framer_mqjs_input_drain(&runtime, 1515u) >= FRAMER_MQJS_OK);
    assert(framer_mqjs_input_enqueue(&runtime, 0xe1u, 1, 1520u) ==
           FRAMER_MQJS_OK);
    assert(framer_mqjs_input_drain(&runtime, 1535u) >= FRAMER_MQJS_OK);
    assert(framer_mqjs_input_drain(&runtime, 2050u) >= FRAMER_MQJS_OK);
    assert(framer_mqjs_input_enqueue(&runtime, 0xe1u, 0, 2100u) ==
           FRAMER_MQJS_OK);
    assert(framer_mqjs_input_drain(&runtime, 2115u) >= FRAMER_MQJS_OK);
    assert(framer_mqjs_input_enqueue(&runtime, 0x2cu, 0, 2120u) ==
           FRAMER_MQJS_OK);
    assert(framer_mqjs_input_drain(&runtime, 2135u) >= FRAMER_MQJS_OK);
    framer_mqjs_get_telemetry(&runtime, &after_focus);
    assert(after_focus.held_key_mask == 0u &&
           after_focus.key_down_events >= before_focus.key_down_events + 2u &&
           after_focus.key_up_events >= before_focus.key_up_events + 2u &&
           after_focus.key_hold_events >= before_focus.key_hold_events + 1u &&
           after_focus.chord_down_events >=
               before_focus.chord_down_events + 1u &&
           after_focus.chord_up_events >= before_focus.chord_up_events + 1u);

    dispatch_ok(&runtime, "host.rpc:0xB24D", 0, 0);
    framer_mqjs_get_last_good_slots(&runtime, weather_revision7);
    assert(weather_revision7[0] == 7);
    state.step = 1000u;
    assert(framer_mqjs_dispatch(&runtime, "host.rpc:0xB24D", INT32_MIN,
                                (int32_t)0x54494d45u) == FRAMER_MQJS_ERR_TIMEOUT);
    state.step = 0u;
    framer_mqjs_get_last_good_slots(&runtime, fault_snapshot);
    assert(memcmp(weather_revision7, fault_snapshot,
                  sizeof(weather_revision7)) == 0);
    dispatch_ok(&runtime, "host.rpc:0xB24D", 0, 0);
    framer_mqjs_get_last_good_slots(&runtime, fault_snapshot);
    assert(memcmp(weather_revision7, fault_snapshot,
                  sizeof(weather_revision7)) == 0);
    memcpy(before_oom, fault_snapshot, sizeof(before_oom));
    assert(framer_mqjs_dispatch(&runtime, "host.rpc:0xB24D", INT32_MIN + 1,
                                (int32_t)0x4f4f4d21u) == FRAMER_MQJS_ERR_OOM);
    framer_mqjs_get_last_good_slots(&runtime, fault_snapshot);
    assert(memcmp(before_oom, fault_snapshot, sizeof(before_oom)) == 0);
    dispatch_ok(&runtime, "host.rpc:0xB24D", 0, 0);
    framer_mqjs_get_last_good_slots(&runtime, fault_snapshot);
    assert(memcmp(before_oom, fault_snapshot, sizeof(before_oom)) == 0);

    /* Recovery clears transient JS staging, but a strictly newer coherent
     * record must still apply monotonically after both fault cycles. */
    dispatch_ok(&runtime, "host.rpc:0xB240", 8, 0);
    dispatch_ok(&runtime, "host.rpc:0xB241", 55 | (3 << 10), 8);
    dispatch_ok(&runtime, "host.rpc:0xB242", (int32_t)valid_day, 8);
    dispatch_ok(&runtime, "host.rpc:0xB243", (int32_t)valid_day, 8);
    dispatch_ok(&runtime, "host.rpc:0xB244", (int32_t)valid_day, 8);
    dispatch_ok(&runtime, "host.rpc:0xB24F", 8, 15);
    framer_mqjs_get_last_good_slots(&runtime, fault_snapshot);
    assert(fault_snapshot[0] == 8 &&
           memcmp(weather_revision7, fault_snapshot,
                  12u * sizeof(int32_t)) != 0);

    /* ZIP settings: a >= 700 ms chord hold opens the editor, the Fn knob edits
     * the active cell, four chord taps walk to the last cell and the fifth
     * raises pendingSave, and the host acknowledgement returns the weather. */
    assert(framer_mqjs_input_enqueue(&runtime, 0x2cu, 1, 3000u) == FRAMER_MQJS_OK);
    assert(framer_mqjs_input_drain(&runtime, 3015u) >= FRAMER_MQJS_OK);
    assert(framer_mqjs_input_enqueue(&runtime, 0xe1u, 1, 3020u) == FRAMER_MQJS_OK);
    assert(framer_mqjs_input_drain(&runtime, 3035u) >= FRAMER_MQJS_OK);
    assert(framer_mqjs_input_drain(&runtime, 3600u) >= FRAMER_MQJS_OK);
    assert(framer_mqjs_input_drain(&runtime, 3700u) >= FRAMER_MQJS_OK);
    framer_mqjs_get_last_good_slots(&runtime, settings_slots);
    assert((settings_slots[13] & 1) == 0);
    assert(framer_mqjs_input_drain(&runtime, 3800u) >= FRAMER_MQJS_OK);
    framer_mqjs_get_last_good_slots(&runtime, settings_slots);
    assert((settings_slots[13] & 1) == 1 &&
           ((uint32_t)settings_slots[14] >> 17 & 1u) == 1u &&
           (settings_slots[15] & 1) == 0 && settings_slots[2] == 1);
    assert(framer_mqjs_input_enqueue(&runtime, 0xe1u, 0, 3900u) == FRAMER_MQJS_OK);
    assert(framer_mqjs_input_drain(&runtime, 3915u) >= FRAMER_MQJS_OK);
    assert(framer_mqjs_input_enqueue(&runtime, 0x2cu, 0, 3920u) == FRAMER_MQJS_OK);
    assert(framer_mqjs_input_drain(&runtime, 3935u) >= FRAMER_MQJS_OK);
    framer_mqjs_get_last_good_slots(&runtime, settings_slots);
    assert((settings_slots[13] & 3) == 1);
    dispatch_ok(&runtime, "input.fn-bottom-knob", 1, 1);
    framer_mqjs_get_last_good_slots(&runtime, settings_slots);
    assert(settings_slots[3] == 17 && settings_slots[8] == 16);
    at = 4000u;
    for (tap = 0u; tap < 4u; ++tap)
        at = chord_tap(&runtime, at);
    framer_mqjs_get_last_good_slots(&runtime, settings_slots);
    assert(settings_slots[8] == 20 && settings_slots[2] == 1);
    at = chord_tap(&runtime, at);
    framer_mqjs_get_last_good_slots(&runtime, settings_slots);
    settings_word = (uint32_t)settings_slots[14];
    assert(settings_slots[2] == 2 && (settings_word & 0x1ffffu) == 10000u &&
           ((settings_word >> 18) & 1u) == 1u && (settings_word >> 24) == 1u);
    dispatch_ok(&runtime, "host.rpc:0xB245", 10000, 1);
    framer_mqjs_get_last_good_slots(&runtime, settings_slots);
    settings_saved_word = (uint32_t)settings_slots[14];
    assert(settings_slots[2] == 3 && ((settings_saved_word >> 18) & 1u) == 0u &&
           ((settings_saved_word >> 17) & 1u) == 1u);
    dispatch_ok(&runtime, "tick.1s", 0, 0);
    dispatch_ok(&runtime, "tick.1s", 0, 0);
    framer_mqjs_get_last_good_slots(&runtime, settings_slots);
    assert((settings_slots[13] & 1) == 0 && (settings_slots[15] & 1) == 1 &&
           settings_slots[0] == 8 &&
           ((uint32_t)settings_slots[14] & 0x1ffffu) == 10000u);

    /* The exact final program fills all 16 slots; a hostile 17th registration
     * is rejected and recovery preserves the accepted final program. */
    hostile = (char *)malloc(source_bytes + sizeof(seventeenth));
    assert(hostile != NULL);
    memcpy(hostile, source, source_bytes);
    memcpy(hostile + source_bytes, seventeenth, sizeof(seventeenth));
    assert(framer_mqjs_load(&runtime, hostile,
                            source_bytes + sizeof(seventeenth) - 1u, 1) ==
           FRAMER_MQJS_ERR_EXCEPTION);
    framer_mqjs_get_telemetry(&runtime, &before_focus);
    dispatch_ok(&runtime, "tick.100ms", 0, 0);
    framer_mqjs_get_telemetry(&runtime, &after_focus);
    assert(after_focus.callbacks == before_focus.callbacks);

    framer_mqjs_get_telemetry(&runtime, &telemetry);
    assert(telemetry.timeouts == 1u && telemetry.out_of_memory == 1u &&
           telemetry.exceptions >= 1u && telemetry.resets >= 3u &&
           telemetry.key_down_events >= 2u && telemetry.key_up_events >= 2u &&
           telemetry.key_hold_events >= 1u && telemetry.chord_down_events >= 1u &&
           telemetry.chord_up_events >= 1u && telemetry.enabled != 0u);
    printf("{\"status\":\"PASS_EXACT_PHYSICAL_SOURCE\","
           "\"heapHighWater\":%" PRIu32 ",\"minimumFree\":%" PRIu32 ","
           "\"callbacks\":%" PRIu32 ",\"commits\":%" PRIu32 ","
           "\"resets\":%" PRIu32 ",\"timeouts\":%" PRIu32 ","
           "\"oom\":%" PRIu32 ",\"sourceRejections\":%" PRIu32 ","
           "\"keyDown\":%" PRIu32 ",\"keyUp\":%" PRIu32 ","
           "\"keyHold\":%" PRIu32 ",\"chordDown\":%" PRIu32 ","
           "\"chordUp\":%" PRIu32 ",\"settingsWord\":%" PRIu32 ","
           "\"settingsAckWord\":%" PRIu32 ",\"settings\":\"PASS\"}\n",
           telemetry.heap_high_water_bytes, telemetry.minimum_free_bytes,
           telemetry.callbacks, telemetry.commits, telemetry.resets,
           telemetry.timeouts, telemetry.out_of_memory,
           telemetry.source_rejections, telemetry.key_down_events,
           telemetry.key_up_events, telemetry.key_hold_events,
           telemetry.chord_down_events, telemetry.chord_up_events,
           settings_word, settings_saved_word);
    framer_mqjs_destroy(&runtime);
    free(hostile);
    free(source);
    return 0;
}
