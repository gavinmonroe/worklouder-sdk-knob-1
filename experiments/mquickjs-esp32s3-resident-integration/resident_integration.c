#include "resident_integration.h"

_Static_assert(sizeof(framer_resident_mailbox) == 72u,
               "resident mailbox ABI must remain exactly 72 bytes");
_Static_assert(sizeof(framer_mqjs_runtime) == FRAMER_MQJS_RUNTIME_STORAGE_BYTES,
               "resident adapter consumed a stale MicroQuickJS runtime ABI");
_Static_assert(FRAMER_MQJS_RUNTIME_STORAGE_BYTES == 4096u,
               "physical canary requires the frozen 4096-byte runtime ABI");
_Static_assert(FRAMER_MQJS_MIN_HEAP_BYTES == FRAMER_F2JS_HEAP_BYTES,
               "F2JS and engine heap contracts differ");

enum {
    FRAMER_RESIDENT_SOURCES_UNARMED = 0u,
    FRAMER_RESIDENT_SOURCES_LIVE = 1u,
    FRAMER_RESIDENT_SOURCES_RETIRING = 2u,
    FRAMER_RESIDENT_SOURCES_QUIESCED = 3u,
    FRAMER_RESIDENT_SOURCES_FAILED = 4u,
};

enum {
    FRAMER_RESIDENT_RELEASE_NONE = 0u,
    FRAMER_RESIDENT_RELEASE_PUBLISHING = 1u,
    FRAMER_RESIDENT_RELEASE_REQUESTED = 2u,
    FRAMER_RESIDENT_RELEASE_ISSUED = 3u,
    FRAMER_RESIDENT_RELEASE_DRAINED = 4u,
};

static void zero_bytes(void *destination, size_t bytes)
{
    uint8_t *output = (uint8_t *)destination;
    size_t i;
    for (i = 0u; i < bytes; ++i)
        output[i] = 0u;
}

static void copy_bytes(void *destination, const void *source, size_t bytes)
{
    uint8_t *output = (uint8_t *)destination;
    const uint8_t *input = (const uint8_t *)source;
    size_t i;
    for (i = 0u; i < bytes; ++i)
        output[i] = input[i];
}

void framer_resident_mailbox_init(framer_resident_mailbox *mailbox)
{
    if (mailbox == (framer_resident_mailbox *)0)
        return;
    zero_bytes(mailbox, sizeof(*mailbox));
    __atomic_store_n(&mailbox->sequence, 0u, __ATOMIC_RELEASE);
}

void framer_resident_mailbox_write(framer_resident_mailbox *mailbox,
                                   const int32_t slots[FRAMER_MQJS_SLOT_COUNT],
                                   uint32_t admitted_revision)
{
    uint32_t sequence;
    unsigned int i;
    if (mailbox == (framer_resident_mailbox *)0 ||
        slots == (const int32_t *)0)
        return;
    sequence = __atomic_load_n(&mailbox->sequence, __ATOMIC_RELAXED);
    if ((sequence & 1u) != 0u)
        ++sequence;
    __atomic_store_n(&mailbox->sequence, sequence + 1u, __ATOMIC_SEQ_CST);
    __atomic_thread_fence(__ATOMIC_SEQ_CST);
    for (i = 0u; i < FRAMER_MQJS_SLOT_COUNT; ++i)
        __atomic_store_n(&mailbox->slots[i], slots[i], __ATOMIC_SEQ_CST);
    __atomic_store_n(&mailbox->admitted_revision, admitted_revision,
                     __ATOMIC_SEQ_CST);
    __atomic_thread_fence(__ATOMIC_SEQ_CST);
    __atomic_store_n(&mailbox->sequence, sequence + 2u, __ATOMIC_SEQ_CST);
}

int framer_resident_mailbox_try_read(
    const framer_resident_mailbox *mailbox,
    framer_resident_mailbox_snapshot *snapshot)
{
    uint32_t first;
    uint32_t second;
    unsigned int i;
    if (mailbox == (const framer_resident_mailbox *)0 ||
        snapshot == (framer_resident_mailbox_snapshot *)0)
        return 0;
    first = __atomic_load_n(&mailbox->sequence, __ATOMIC_ACQUIRE);
    if ((first & 1u) != 0u)
        return 0;
    for (i = 0u; i < FRAMER_MQJS_SLOT_COUNT; ++i)
        snapshot->slots[i] = __atomic_load_n(&mailbox->slots[i],
                                             __ATOMIC_SEQ_CST);
    snapshot->admitted_revision = __atomic_load_n(
        &mailbox->admitted_revision, __ATOMIC_SEQ_CST);
    __atomic_thread_fence(__ATOMIC_SEQ_CST);
    second = __atomic_load_n(&mailbox->sequence, __ATOMIC_ACQUIRE);
    if (first != second || (second & 1u) != 0u)
        return 0;
    snapshot->sequence = second;
    return 1;
}

void framer_resident_capability_init(framer_resident_capability *capability)
{
    if (capability == (framer_resident_capability *)0)
        return;
    zero_bytes(capability, sizeof(*capability));
    __atomic_store_n(&capability->state, FRAMER_RESIDENT_CAP_COLD,
                     __ATOMIC_RELEASE);
}

int framer_resident_capability_set_ready(framer_resident_capability *capability,
                                         uint32_t component,
                                         int ready)
{
    uint32_t state;
    uint32_t mask;
    if (capability == (framer_resident_capability *)0 || component == 0u ||
        (component & ~FRAMER_RESIDENT_READY_ALL) != 0u ||
        (component & (component - 1u)) != 0u)
        return 0;
    state = __atomic_load_n(&capability->state, __ATOMIC_ACQUIRE);
    if (ready != 0) {
        if (state == FRAMER_RESIDENT_CAP_QUIESCING ||
            state == FRAMER_RESIDENT_CAP_STOPPED ||
            state == FRAMER_RESIDENT_CAP_FAULTED)
            return 0;
        __atomic_fetch_or(&capability->ready_mask, component, __ATOMIC_ACQ_REL);
        if (state == FRAMER_RESIDENT_CAP_COLD)
            __atomic_store_n(&capability->state, FRAMER_RESIDENT_CAP_ASSEMBLING,
                             __ATOMIC_RELEASE);
        return 1;
    }
    mask = __atomic_fetch_and(&capability->ready_mask, ~component,
                              __ATOMIC_ACQ_REL) & ~component;
    (void)mask;
    __atomic_store_n(&capability->advertised, 0u, __ATOMIC_RELEASE);
    if (state == FRAMER_RESIDENT_CAP_ADVERTISED)
        __atomic_store_n(&capability->state, FRAMER_RESIDENT_CAP_ASSEMBLING,
                         __ATOMIC_RELEASE);
    return 1;
}

int framer_resident_capability_advertise(framer_resident_capability *capability,
                                         uint32_t generation)
{
    if (capability == (framer_resident_capability *)0 || generation == 0u ||
        __atomic_load_n(&capability->state, __ATOMIC_ACQUIRE) !=
            FRAMER_RESIDENT_CAP_ASSEMBLING ||
        __atomic_load_n(&capability->ready_mask, __ATOMIC_ACQUIRE) !=
            FRAMER_RESIDENT_READY_ALL)
        return 0;
    __atomic_store_n(&capability->generation, generation, __ATOMIC_RELEASE);
    __atomic_store_n(&capability->advertised, 1u, __ATOMIC_RELEASE);
    __atomic_store_n(&capability->state, FRAMER_RESIDENT_CAP_ADVERTISED,
                     __ATOMIC_RELEASE);
    return 1;
}

void framer_resident_capability_begin_quiesce(
    framer_resident_capability *capability)
{
    uint32_t state;
    if (capability == (framer_resident_capability *)0)
        return;
    state = __atomic_load_n(&capability->state, __ATOMIC_ACQUIRE);
    __atomic_store_n(&capability->advertised, 0u, __ATOMIC_SEQ_CST);
    if (state != FRAMER_RESIDENT_CAP_STOPPED)
        __atomic_store_n(&capability->state, FRAMER_RESIDENT_CAP_QUIESCING,
                         __ATOMIC_RELEASE);
}

int framer_resident_capability_finish_quiesce(
    framer_resident_capability *capability)
{
    uint32_t mask;
    if (capability == (framer_resident_capability *)0 ||
        __atomic_load_n(&capability->state, __ATOMIC_ACQUIRE) !=
            FRAMER_RESIDENT_CAP_QUIESCING)
        return 0;
    mask = __atomic_load_n(&capability->ready_mask, __ATOMIC_ACQUIRE);
    if ((mask & (FRAMER_RESIDENT_READY_VM_TASK |
                 FRAMER_RESIDENT_READY_PARSER |
                 FRAMER_RESIDENT_READY_MAILBOX)) != 0u)
        return 0;
    __atomic_store_n(&capability->state, FRAMER_RESIDENT_CAP_STOPPED,
                     __ATOMIC_RELEASE);
    return 1;
}

int framer_resident_capability_can_unmap(
    const framer_resident_capability *capability)
{
    if (capability == (const framer_resident_capability *)0)
        return 0;
    return __atomic_load_n(&capability->state, __ATOMIC_ACQUIRE) ==
               FRAMER_RESIDENT_CAP_STOPPED &&
           __atomic_load_n(&capability->advertised, __ATOMIC_ACQUIRE) == 0u &&
           (__atomic_load_n(&capability->ready_mask, __ATOMIC_ACQUIRE) &
            FRAMER_RESIDENT_READY_VM_TASK) == 0u;
}

int framer_resident_capability_mark_unmapped(
    framer_resident_capability *capability)
{
    if (!framer_resident_capability_can_unmap(capability))
        return 0;
    __atomic_fetch_and(&capability->ready_mask,
                       ~FRAMER_RESIDENT_READY_MODULE_MAP, __ATOMIC_ACQ_REL);
    return 1;
}

int framer_resident_capability_flash_write_allowed(
    const framer_resident_capability *capability)
{
    return framer_resident_capability_can_unmap(capability) &&
           (__atomic_load_n(&capability->ready_mask, __ATOMIC_ACQUIRE) &
            FRAMER_RESIDENT_READY_MODULE_MAP) == 0u;
}

void framer_resident_capability_fault(framer_resident_capability *capability)
{
    if (capability == (framer_resident_capability *)0)
        return;
    __atomic_store_n(&capability->advertised, 0u, __ATOMIC_SEQ_CST);
    __atomic_store_n(&capability->state, FRAMER_RESIDENT_CAP_FAULTED,
                     __ATOMIC_RELEASE);
}

static uint64_t owner_now_us(void *opaque)
{
    framer_resident_owner *owner = (framer_resident_owner *)opaque;
    if (owner == (framer_resident_owner *)0 ||
        owner->platform.now_us == (uint64_t (*)(void *))0)
        return 0u;
    return owner->platform.now_us(owner->platform.opaque);
}

static uintptr_t owner_thread_token(void *opaque)
{
    framer_resident_owner *owner = (framer_resident_owner *)opaque;
    if (owner == (framer_resident_owner *)0 ||
        owner->platform.current_thread_token ==
            (uintptr_t (*)(void *))0)
        return 0u;
    return owner->platform.current_thread_token(owner->platform.opaque);
}

/* Register first, then inspect the generation gates. Source retirement is the
 * external lifetime handoff that prevents a new entry after its callback has
 * returned; the counter protects the already-entered bounded calls. */
static int owner_ingress_enter(framer_resident_owner *owner,
                               uint32_t generation,
                               int require_input)
{
    int accepted;
    if (owner == (framer_resident_owner *)0 || generation == 0u)
        return 0;
    __atomic_add_fetch(&owner->ingress_inflight, 1u, __ATOMIC_ACQ_REL);
    accepted =
        __atomic_load_n(&owner->ingress_enabled, __ATOMIC_ACQUIRE) != 0u &&
        __atomic_load_n(&owner->ingress_generation, __ATOMIC_ACQUIRE) ==
            generation &&
        __atomic_load_n(&owner->capability.advertised, __ATOMIC_ACQUIRE) != 0u &&
        __atomic_load_n(&owner->telemetry.booted, __ATOMIC_ACQUIRE) != 0u &&
        __atomic_load_n(&owner->telemetry.permanently_disabled,
                        __ATOMIC_ACQUIRE) == 0u;
    if (accepted && require_input != 0)
        accepted = __atomic_load_n(&owner->input_ingress_enabled,
                                   __ATOMIC_ACQUIRE) != 0u;
    if (!accepted)
        __atomic_sub_fetch(&owner->ingress_inflight, 1u, __ATOMIC_RELEASE);
    return accepted;
}

static void owner_ingress_leave(framer_resident_owner *owner)
{
    __atomic_sub_fetch(&owner->ingress_inflight, 1u, __ATOMIC_RELEASE);
}

/* Owner runtime calls use the same close-then-count pattern as producers. The
 * VM task is normally the sole caller; the count makes that ownership explicit
 * to a concurrent control-task teardown and to the host race proof. */
static int owner_runtime_enter(framer_resident_owner *owner)
{
    int accepted;
    __atomic_add_fetch(&owner->owner_runtime_inflight, 1u, __ATOMIC_ACQ_REL);
    accepted =
        __atomic_load_n(&owner->telemetry.booted, __ATOMIC_ACQUIRE) != 0u &&
        __atomic_load_n(&owner->telemetry.permanently_disabled,
                        __ATOMIC_ACQUIRE) == 0u &&
        __atomic_load_n(&owner->capability.advertised, __ATOMIC_ACQUIRE) != 0u &&
        __atomic_load_n(&owner->capability.state, __ATOMIC_ACQUIRE) ==
            FRAMER_RESIDENT_CAP_ADVERTISED &&
        __atomic_load_n(&owner->active_generation, __ATOMIC_ACQUIRE) != 0u;
    if (!accepted)
        __atomic_sub_fetch(&owner->owner_runtime_inflight, 1u, __ATOMIC_RELEASE);
    return accepted;
}

static void owner_runtime_leave(framer_resident_owner *owner)
{
    __atomic_sub_fetch(&owner->owner_runtime_inflight, 1u, __ATOMIC_RELEASE);
}

static void owner_publish_gate_lock(framer_resident_owner *owner)
{
    while (__atomic_exchange_n(&owner->publish_gate_lock, 1u,
                               __ATOMIC_ACQUIRE) != 0u)
        ;
}

static void owner_publish_gate_unlock(framer_resident_owner *owner)
{
    __atomic_store_n(&owner->publish_gate_lock, 0u, __ATOMIC_RELEASE);
}

static int owner_publish(void *opaque,
                         const int32_t slots[FRAMER_MQJS_SLOT_COUNT],
                         uint32_t module_revision)
{
    framer_resident_owner *owner = (framer_resident_owner *)opaque;
    uint32_t generation;
    int accepted;
    if (owner == (framer_resident_owner *)0)
        return 0;
    owner_publish_gate_lock(owner);
    generation = __atomic_load_n(&owner->active_generation, __ATOMIC_ACQUIRE);
    accepted = generation != 0u &&
        __atomic_load_n(&owner->capability.generation, __ATOMIC_ACQUIRE) ==
            generation &&
        __atomic_load_n(&owner->ingress_generation, __ATOMIC_ACQUIRE) ==
            generation &&
        __atomic_load_n(&owner->capability.advertised, __ATOMIC_ACQUIRE) != 0u &&
        __atomic_load_n(&owner->capability.state, __ATOMIC_ACQUIRE) ==
            FRAMER_RESIDENT_CAP_ADVERTISED &&
        __atomic_load_n(&owner->telemetry.permanently_disabled,
                        __ATOMIC_ACQUIRE) == 0u;
    if (!accepted) {
        owner_publish_gate_unlock(owner);
        return 0;
    }
    __atomic_store_n(&owner->telemetry.module_revision, module_revision,
                     __ATOMIC_RELEASE);
    framer_resident_mailbox_write(&owner->mailbox, slots, generation);
    owner_publish_gate_unlock(owner);
    return 1;
}

static void owner_reschedule(framer_resident_owner *owner)
{
    if (owner->platform.reschedule_owner != (void (*)(void *))0) {
        __atomic_add_fetch(&owner->telemetry.reschedules, 1u,
                           __ATOMIC_RELAXED);
        owner->platform.reschedule_owner(owner->platform.opaque);
    }
}

static void owner_shell_arm(framer_resident_owner *owner,
                            const framer_resident_engine_api *engine,
                            const framer_resident_platform *platform)
{
    if (engine != (const framer_resident_engine_api *)0)
        copy_bytes(&owner->engine, engine, sizeof(*engine));
    if (platform != (const framer_resident_platform *)0)
        copy_bytes(&owner->platform, platform, sizeof(*platform));
    framer_resident_capability_init(&owner->capability);
    framer_resident_mailbox_init(&owner->mailbox);
    __atomic_store_n(&owner->event_source_quiesce_state,
                     FRAMER_RESIDENT_SOURCES_UNARMED, __ATOMIC_RELEASE);
    __atomic_store_n(&owner->source_quiesce_state,
                     FRAMER_RESIDENT_SOURCES_UNARMED, __ATOMIC_RELEASE);
    owner->prefer_input = 1u;
}

void framer_resident_owner_init_shell(framer_resident_owner *owner,
                                      const framer_resident_engine_api *engine,
                                      const framer_resident_platform *platform)
{
    if (owner == (framer_resident_owner *)0)
        return;
    zero_bytes(owner, sizeof(*owner));
    owner_shell_arm(owner, engine, platform);
}

void framer_resident_owner_reinit_shell(framer_resident_owner *owner,
                                        const framer_resident_engine_api *engine,
                                        const framer_resident_platform *platform)
{
    size_t stack_at;
    size_t stack_end;
    if (owner == (framer_resident_owner *)0)
        return;
    /* Zero everything around task_stack, never the stack itself: the VM
     * task may be parked ON that stack while another task runs this. */
    stack_at = (size_t)((const uint8_t *)owner->task_stack -
                        (const uint8_t *)owner);
    stack_end = stack_at + sizeof(owner->task_stack);
    zero_bytes(owner, stack_at);
    zero_bytes((uint8_t *)owner + stack_end, sizeof(*owner) - stack_end);
    owner_shell_arm(owner, engine, platform);
}

int framer_resident_owner_mark_module_mapped(framer_resident_owner *owner)
{
    if (owner == (framer_resident_owner *)0)
        return 0;
    return framer_resident_capability_set_ready(
        &owner->capability, FRAMER_RESIDENT_READY_MODULE_MAP, 1);
}

static int engine_api_complete(const framer_resident_engine_api *engine)
{
    return engine->init != (framer_mqjs_result (*)(framer_mqjs_runtime *, void *,
                                                    size_t,
                                                    const framer_mqjs_config *))0 &&
           engine->load != (framer_mqjs_result (*)(framer_mqjs_runtime *,
                                                    const char *, size_t, int))0 &&
           engine->dispatch != (framer_mqjs_result (*)(framer_mqjs_runtime *,
                                                        const char *, int32_t,
                                                        int32_t))0 &&
           engine->input_enqueue != (framer_mqjs_result (*)(framer_mqjs_runtime *,
                                                             uint32_t, int,
                                                             uint32_t))0 &&
           engine->input_request_release_all !=
               (framer_mqjs_result (*)(framer_mqjs_runtime *, uint32_t,
                                        framer_mqjs_input_reason))0 &&
           engine->input_drain != (framer_mqjs_result (*)(framer_mqjs_runtime *,
                                                           uint32_t))0 &&
           engine->input_get_observation !=
               (int (*)(const framer_mqjs_runtime *,
                         framer_mqjs_input_observation *))0 &&
           engine->get_telemetry !=
               (void (*)(const framer_mqjs_runtime *,
                          framer_mqjs_telemetry *))0 &&
           engine->destroy != (void (*)(framer_mqjs_runtime *))0;
}

static void configure_input(framer_resident_owner *owner)
{
    unsigned int i;
    unsigned int key = 0u;
    unsigned int chord = 0u;
    framer_mqjs_input_config *input = &owner->engine_config.input;
    zero_bytes(input, sizeof(*input));
    input->key_count = owner->admission.key_count;
    input->chord_count = owner->admission.chord_count;
    input->debounce_ms = owner->admission.debounce_ms;
    input->hold_delay_ms = owner->admission.hold_delay_ms;
    input->hold_cadence_ms = owner->admission.hold_cadence_ms;
    for (i = 0u; i < owner->admission.event_count; ++i) {
        const framer_f2js_event *event = &owner->admission.events[i];
        if (event->kind == 5u && key < FRAMER_MQJS_MAX_KEYS)
            input->native_tokens[key++] = event->native_token;
        else if (event->kind == 6u && chord < FRAMER_MQJS_MAX_CHORDS)
            input->chord_masks[chord++] = event->held_mask;
    }
}

static int admission_needs_event_sources(const framer_f2js_admission *admission)
{
    unsigned int i;
    for (i = 0u; i < admission->event_count; ++i)
        if (admission->events[i].kind >= 1u &&
            admission->events[i].kind <= 4u)
            return 1;
    return 0;
}

static framer_f2js_result activate_sources_and_advertise(
    framer_resident_owner *owner)
{
    framer_f2js_result result = FRAMER_F2JS_ADMIT_OK;
    int needs_events = admission_needs_event_sources(&owner->admission);
    owner_publish_gate_lock(owner);
    /* The same gate serializes boot activation with control-task shutdown. A
     * source is never externally installed while its lifecycle state still
     * says UNARMED, and shutdown cannot skip an activation in progress. */
    if (__atomic_load_n(&owner->capability.state, __ATOMIC_ACQUIRE) !=
            FRAMER_RESIDENT_CAP_ASSEMBLING ||
        __atomic_load_n(&owner->telemetry.permanently_disabled,
                        __ATOMIC_ACQUIRE) != 0u) {
        result = FRAMER_F2JS_ERR_ARGUMENT;
        goto done;
    }
    if (needs_events && !owner->platform.activate_event_sources(
            owner->platform.opaque, owner, owner->admission.generation)) {
        /* Activation failure is all-or-none. */
        __atomic_store_n(&owner->event_source_quiesce_state,
                         FRAMER_RESIDENT_SOURCES_QUIESCED, __ATOMIC_RELEASE);
        result = FRAMER_F2JS_ERR_EVENT;
        goto done;
    }
    __atomic_store_n(&owner->event_source_quiesce_state,
                     needs_events ? FRAMER_RESIDENT_SOURCES_LIVE
                                  : FRAMER_RESIDENT_SOURCES_QUIESCED,
                     __ATOMIC_RELEASE);
    if (owner->admission.key_count != 0u &&
        !owner->platform.activate_input_sources(
            owner->platform.opaque, owner, owner->admission.generation)) {
        __atomic_store_n(&owner->source_quiesce_state,
                         FRAMER_RESIDENT_SOURCES_QUIESCED, __ATOMIC_RELEASE);
        result = FRAMER_F2JS_ERR_INPUT;
        goto done;
    }
    __atomic_store_n(&owner->source_quiesce_state,
                     owner->admission.key_count != 0u
                         ? FRAMER_RESIDENT_SOURCES_LIVE
                         : FRAMER_RESIDENT_SOURCES_QUIESCED,
                     __ATOMIC_RELEASE);
    __atomic_store_n(&owner->ingress_enabled, 1u, __ATOMIC_RELEASE);
    __atomic_store_n(&owner->input_ingress_enabled,
                     owner->admission.key_count != 0u, __ATOMIC_RELEASE);
    if (!framer_resident_capability_advertise(&owner->capability,
                                               owner->admission.generation))
        result = FRAMER_F2JS_ERR_ARGUMENT;
done:
    owner_publish_gate_unlock(owner);
    return result;
}

framer_f2js_result framer_resident_owner_boot_on_task(
    framer_resident_owner *owner,
    const uint8_t *package,
    size_t package_bytes)
{
    framer_f2js_result admitted;
    framer_mqjs_result engine_result;
    if (owner == (framer_resident_owner *)0 || package == (const uint8_t *)0 ||
        !engine_api_complete(&owner->engine) ||
        owner->platform.allocate_psram == (void *(*)(void *, size_t))0 ||
        owner->platform.free_psram == (void (*)(void *, void *))0 ||
        owner->platform.now_us == (uint64_t (*)(void *))0 ||
        owner->platform.now_ms == (uint32_t (*)(void *))0 ||
        owner->platform.current_thread_token == (uintptr_t (*)(void *))0 ||
        __atomic_load_n(&owner->capability.state, __ATOMIC_ACQUIRE) !=
            FRAMER_RESIDENT_CAP_ASSEMBLING ||
        __atomic_load_n(&owner->capability.ready_mask, __ATOMIC_ACQUIRE) !=
            FRAMER_RESIDENT_READY_MODULE_MAP ||
        __atomic_load_n(&owner->capability.advertised, __ATOMIC_ACQUIRE) != 0u ||
        __atomic_load_n(&owner->telemetry.booted, __ATOMIC_ACQUIRE) != 0u ||
        owner->heap != (void *)0 ||
        __atomic_load_n(&owner->active_generation, __ATOMIC_ACQUIRE) != 0u ||
        __atomic_load_n(&owner->ingress_enabled, __ATOMIC_ACQUIRE) != 0u ||
        __atomic_load_n(&owner->ingress_inflight, __ATOMIC_ACQUIRE) != 0u ||
        __atomic_load_n(&owner->owner_runtime_inflight,
                        __ATOMIC_ACQUIRE) != 0u ||
        __atomic_load_n(&owner->publish_gate_lock, __ATOMIC_ACQUIRE) != 0u ||
        __atomic_load_n(&owner->event_source_quiesce_state,
                        __ATOMIC_ACQUIRE) != FRAMER_RESIDENT_SOURCES_UNARMED ||
        __atomic_load_n(&owner->source_quiesce_state,
                        __ATOMIC_ACQUIRE) != FRAMER_RESIDENT_SOURCES_UNARMED ||
        __atomic_load_n(&owner->terminal_release_state,
                        __ATOMIC_ACQUIRE) != FRAMER_RESIDENT_RELEASE_NONE)
        return FRAMER_F2JS_ERR_ARGUMENT;
    admitted = framer_f2js_admit(package, package_bytes, &owner->admission);
    if (admitted != FRAMER_F2JS_ADMIT_OK) {
        framer_resident_capability_fault(&owner->capability);
        return admitted;
    }
    if (admission_needs_event_sources(&owner->admission) &&
        (owner->platform.activate_event_sources ==
             (int (*)(void *, struct framer_resident_owner *, uint32_t))0 ||
         owner->platform.remove_event_sources ==
             (int (*)(void *, uint32_t))0)) {
        framer_resident_capability_fault(&owner->capability);
        return FRAMER_F2JS_ERR_EVENT;
    }
    if (owner->admission.key_count != 0u &&
        (owner->platform.activate_input_sources ==
             (int (*)(void *, struct framer_resident_owner *, uint32_t))0 ||
         owner->platform.remove_stock_input_hook ==
             (int (*)(void *, uint32_t))0 ||
         owner->platform.cancel_input_poll ==
             (int (*)(void *, uint32_t))0 ||
         owner->platform.schedule_input_poll ==
             (int (*)(void *, uint32_t, uint32_t))0)) {
        framer_resident_capability_fault(&owner->capability);
        return FRAMER_F2JS_ERR_INPUT;
    }
    if (owner->admission.asset_bytes != 0u &&
        (owner->platform.stage_raster_base ==
             (int (*)(void *, const uint8_t *, size_t, uint32_t))0 ||
         !owner->platform.stage_raster_base(
             owner->platform.opaque,
             package + owner->admission.asset_offset,
             owner->admission.asset_bytes,
             owner->admission.generation))) {
        framer_resident_capability_fault(&owner->capability);
        return FRAMER_F2JS_ERR_ASSET;
    }
    owner->heap = owner->platform.allocate_psram(owner->platform.opaque,
                                                  FRAMER_F2JS_HEAP_BYTES);
    if (owner->heap == (void *)0) {
        framer_resident_capability_fault(&owner->capability);
        return FRAMER_F2JS_ERR_ARGUMENT;
    }
    zero_bytes(&owner->engine_config, sizeof(owner->engine_config));
    owner->engine_config.opaque = owner;
    owner->engine_config.now_us = owner_now_us;
    owner->engine_config.current_thread_token = owner_thread_token;
    owner->engine_config.publish = owner_publish;
    owner->engine_config.owner_thread_token = owner_thread_token(owner);
    owner->engine_config.callback_deadline_us = FRAMER_F2JS_CALLBACK_DEADLINE_US;
    configure_input(owner);
    engine_result = owner->engine.init(&owner->runtime, owner->heap,
                                       FRAMER_F2JS_HEAP_BYTES,
                                       &owner->engine_config);
    if (engine_result == FRAMER_MQJS_OK)
        engine_result = owner->engine.load(&owner->runtime,
                                           owner->admission.source,
                                           owner->admission.source_bytes, 1);
    if (engine_result != FRAMER_MQJS_OK) {
        owner->engine.destroy(&owner->runtime);
        owner->platform.free_psram(owner->platform.opaque, owner->heap);
        owner->heap = (void *)0;
        __atomic_store_n(&owner->telemetry.last_result, engine_result,
                         __ATOMIC_RELEASE);
        framer_resident_capability_fault(&owner->capability);
        return FRAMER_F2JS_ERR_SOURCE;
    }
    __atomic_store_n(&owner->active_generation, owner->admission.generation,
                     __ATOMIC_RELEASE);
    __atomic_store_n(&owner->ingress_generation, owner->admission.generation,
                     __ATOMIC_RELEASE);
    __atomic_store_n(&owner->telemetry.booted, 1u, __ATOMIC_RELEASE);
    __atomic_store_n(&owner->telemetry.last_result, FRAMER_MQJS_OK,
                     __ATOMIC_RELEASE);
    {
        framer_mqjs_telemetry engine_telemetry;
        zero_bytes(&engine_telemetry, sizeof(engine_telemetry));
        owner->engine.get_telemetry(&owner->runtime, &engine_telemetry);
        __atomic_store_n(&owner->last_engine_resets, engine_telemetry.resets,
                         __ATOMIC_RELEASE);
    }
    if (!framer_resident_capability_set_ready(&owner->capability,
                                               FRAMER_RESIDENT_READY_PARSER, 1) ||
        !framer_resident_capability_set_ready(&owner->capability,
                                               FRAMER_RESIDENT_READY_VM_TASK, 1) ||
        !framer_resident_capability_set_ready(&owner->capability,
                                               FRAMER_RESIDENT_READY_MAILBOX, 1)) {
        (void)framer_resident_owner_begin_quiesce(
            owner, owner->platform.now_ms(owner->platform.opaque),
            FRAMER_MQJS_INPUT_REASON_DISCONNECT);
        while (!framer_resident_owner_stop_on_task(owner))
            owner_reschedule(owner);
        return FRAMER_F2JS_ERR_ARGUMENT;
    }
    admitted = activate_sources_and_advertise(owner);
    if (admitted != FRAMER_F2JS_ADMIT_OK) {
        framer_resident_capability_fault(&owner->capability);
        (void)framer_resident_owner_begin_quiesce(
            owner, owner->platform.now_ms(owner->platform.opaque),
            FRAMER_MQJS_INPUT_REASON_DISCONNECT);
        while (!framer_resident_owner_stop_on_task(owner))
            owner_reschedule(owner);
        return admitted;
    }
    return FRAMER_F2JS_ADMIT_OK;
}

static size_t bounded_name_length(const char *name)
{
    size_t length;
    if (name == (const char *)0)
        return FRAMER_RESIDENT_EVENT_NAME_BYTES;
    for (length = 0u; length < FRAMER_RESIDENT_EVENT_NAME_BYTES; ++length)
        if (name[length] == '\0')
            return length;
    return FRAMER_RESIDENT_EVENT_NAME_BYTES;
}

static int string_equal(const char *left, const char *right)
{
    size_t i;
    if (left == (const char *)0 || right == (const char *)0)
        return 0;
    for (i = 0u; i < FRAMER_RESIDENT_EVENT_NAME_BYTES; ++i) {
        if (left[i] != right[i])
            return 0;
        if (left[i] == '\0')
            return 1;
    }
    return 0;
}

static int declared_kind(const framer_resident_owner *owner, uint8_t kind,
                         uint16_t id)
{
    unsigned int index;
    for (index = 0u; index < owner->admission.event_count; ++index)
        if (owner->admission.events[index].kind == kind &&
            owner->admission.events[index].id == id)
            return 1;
    return 0;
}

static int owner_enqueue_admitted(framer_resident_owner *owner,
                                  uint32_t generation,
                                  const char *event_name,
                                  int32_t value,
                                  int32_t auxiliary,
                                  uint8_t kind,
                                  uint16_t id,
                                  uint32_t receipt_tag)
{
    size_t length;
    uint32_t head;
    uint32_t tail;
    framer_resident_event *event;
    if (owner == (framer_resident_owner *)0)
        return 0;
    if (!owner_ingress_enter(owner, generation, 0))
        return 0;
    if (!declared_kind(owner, kind, id)) {
        owner_ingress_leave(owner);
        return 0;
    }
    length = bounded_name_length(event_name);
    if (length == 0u || length >= FRAMER_RESIDENT_EVENT_NAME_BYTES) {
        owner_ingress_leave(owner);
        return 0;
    }
    if (__atomic_exchange_n(&owner->queue_producer_lock, 1u,
                            __ATOMIC_ACQUIRE) != 0u) {
        owner_ingress_leave(owner);
        return 0;
    }
    head = __atomic_load_n(&owner->queue_head, __ATOMIC_ACQUIRE);
    tail = __atomic_load_n(&owner->queue_tail, __ATOMIC_RELAXED);
    if (tail - head >= FRAMER_RESIDENT_EVENT_QUEUE_RECORDS) {
        __atomic_add_fetch(&owner->telemetry.queue_overflows, 1u,
                           __ATOMIC_RELAXED);
        __atomic_store_n(&owner->queue_producer_lock, 0u, __ATOMIC_RELEASE);
        owner_ingress_leave(owner);
        return 0;
    }
    event = &owner->queue[tail % FRAMER_RESIDENT_EVENT_QUEUE_RECORDS];
    zero_bytes(event, sizeof(*event));
    copy_bytes(event->name, event_name, length);
    event->value = value;
    event->auxiliary = auxiliary;
    event->receipt_tag = receipt_tag;
    __atomic_store_n(&owner->queue_tail, tail + 1u, __ATOMIC_RELEASE);
    __atomic_store_n(&owner->queue_producer_lock, 0u, __ATOMIC_RELEASE);
    owner_reschedule(owner);
    owner_ingress_leave(owner);
    return 1;
}

int framer_resident_owner_enqueue(framer_resident_owner *owner,
                                  uint32_t generation,
                                  const char *event_name,
                                  int32_t value,
                                  int32_t auxiliary)
{
    uint8_t kind = 0u;
    if (owner == (framer_resident_owner *)0)
        return 0;
    if (string_equal(event_name, "tick.100ms"))
        kind = 1u;
    else if (string_equal(event_name, "tick.1s"))
        kind = 2u;
    else if (string_equal(event_name, "input.fn-bottom-knob"))
        kind = 3u;
    /* Native key/chord selectors are emitted only by the core input queue.
     * Host RPC uses the typed function below. Unknown strings never reach JS. */
    if (kind == 0u)
        return 0;
    return owner_enqueue_admitted(owner, generation, event_name, value,
                                  auxiliary, kind, 0u, 0u);
}

static size_t append_decimal_u16(char *output, uint16_t value)
{
    char reversed[5];
    size_t count = 0u;
    size_t index;
    do {
        reversed[count++] = (char)('0' + value % 10u);
        value = (uint16_t)(value / 10u);
    } while (value != 0u);
    for (index = 0u; index < count; ++index)
        output[index] = reversed[count - 1u - index];
    return count;
}

int framer_resident_owner_enqueue_host_rpc(framer_resident_owner *owner,
                                           uint32_t generation,
                                           uint16_t id,
                                           int32_t value,
                                           int32_t auxiliary)
{
    return framer_resident_owner_enqueue_host_rpc_tagged(
        owner, generation, id, value, auxiliary, 0u);
}

int framer_resident_owner_enqueue_host_rpc_tagged(
    framer_resident_owner *owner, uint32_t generation, uint16_t id,
    int32_t value, int32_t auxiliary, uint32_t receipt_tag)
{
    static const char prefix[] = "host.rpc:";
    char selector[FRAMER_RESIDENT_EVENT_NAME_BYTES];
    size_t prefix_bytes = sizeof(prefix) - 1u;
    size_t digits;
    if (owner == (framer_resident_owner *)0 || id == 0u)
        return 0;
    zero_bytes(selector, sizeof(selector));
    copy_bytes(selector, prefix, prefix_bytes);
    digits = append_decimal_u16(selector + prefix_bytes, id);
    selector[prefix_bytes + digits] = '\0';
    return owner_enqueue_admitted(owner, generation, selector, value,
                                  auxiliary, 4u, id, receipt_tag);
}

int framer_resident_owner_take_tagged_completion(
    framer_resident_owner *owner,
    framer_resident_tagged_completion *completion)
{
    uint32_t first;
    uint32_t second;
    if (owner == (framer_resident_owner *)0 ||
        completion == (framer_resident_tagged_completion *)0)
        return 0;
    first = __atomic_load_n(&owner->tagged_completion_sequence,
                            __ATOMIC_ACQUIRE);
    if ((first & 1u) != 0u ||
        __atomic_load_n(&owner->tagged_completion.tag,
                        __ATOMIC_ACQUIRE) == 0u)
        return 0;
    completion->tag = __atomic_load_n(&owner->tagged_completion.tag,
                                      __ATOMIC_RELAXED);
    completion->result = __atomic_load_n(&owner->tagged_completion.result,
                                         __ATOMIC_RELAXED);
    completion->mailbox_sequence = __atomic_load_n(
        &owner->tagged_completion.mailbox_sequence, __ATOMIC_RELAXED);
    completion->applied_generation = __atomic_load_n(
        &owner->tagged_completion.applied_generation, __ATOMIC_RELAXED);
    completion->applied_revision = __atomic_load_n(
        &owner->tagged_completion.applied_revision, __ATOMIC_RELAXED);
    __atomic_thread_fence(__ATOMIC_ACQUIRE);
    second = __atomic_load_n(&owner->tagged_completion_sequence,
                             __ATOMIC_ACQUIRE);
    if (first != second || (second & 1u) != 0u)
        return 0;
    __atomic_store_n(&owner->tagged_completion.tag, 0u, __ATOMIC_RELEASE);
    return 1;
}

static framer_mqjs_result owner_request_terminal_release(
    framer_resident_owner *owner,
    uint32_t timestamp_ms,
    framer_mqjs_input_reason reason)
{
    uint32_t expected = FRAMER_RESIDENT_RELEASE_NONE;
    if (reason != FRAMER_MQJS_INPUT_REASON_FOCUS_LOSS &&
        reason != FRAMER_MQJS_INPUT_REASON_DISCONNECT)
        return FRAMER_MQJS_ERR_ARGUMENT;
    __atomic_store_n(&owner->input_ingress_enabled, 0u, __ATOMIC_RELEASE);
    if (!__atomic_compare_exchange_n(&owner->terminal_release_state, &expected,
                                     FRAMER_RESIDENT_RELEASE_PUBLISHING, 0,
                                     __ATOMIC_ACQ_REL, __ATOMIC_ACQUIRE))
        return expected >= FRAMER_RESIDENT_RELEASE_REQUESTED
            ? FRAMER_MQJS_INPUT_RESYNC_QUEUED
            : FRAMER_MQJS_ERR_DISABLED;
    __atomic_store_n(&owner->terminal_release_timestamp_ms, timestamp_ms,
                     __ATOMIC_RELAXED);
    __atomic_store_n(&owner->terminal_release_reason, (uint32_t)reason,
                     __ATOMIC_RELAXED);
    __atomic_store_n(&owner->terminal_release_state,
                     FRAMER_RESIDENT_RELEASE_REQUESTED, __ATOMIC_RELEASE);
    __atomic_store_n(&owner->input_pending, 1u, __ATOMIC_RELEASE);
    owner_reschedule(owner);
    return FRAMER_MQJS_INPUT_RESYNC_QUEUED;
}

void framer_resident_owner_notify_input(framer_resident_owner *owner,
                                        uint32_t generation)
{
    if (!owner_ingress_enter(owner, generation, 0))
        return;
    __atomic_store_n(&owner->input_pending, 1u, __ATOMIC_RELEASE);
    owner_reschedule(owner);
    owner_ingress_leave(owner);
}

framer_mqjs_result framer_resident_owner_input_after_stock(
    framer_resident_owner *owner, uint32_t generation, uint32_t native_token,
    int pressed, uint32_t timestamp_ms)
{
    framer_mqjs_result result;
    if (!owner_ingress_enter(owner, generation, 1))
        return FRAMER_MQJS_ERR_DISABLED;
    result = owner->engine.input_enqueue(&owner->runtime, native_token,
                                         pressed, timestamp_ms);
    if (result >= 0) {
        __atomic_store_n(&owner->input_debounce_due_ms,
                         timestamp_ms + owner->admission.debounce_ms,
                         __ATOMIC_RELEASE);
        __atomic_store_n(&owner->input_pending, 1u, __ATOMIC_RELEASE);
        owner_reschedule(owner);
    }
    owner_ingress_leave(owner);
    return result;
}

framer_mqjs_result framer_resident_owner_release_all(
    framer_resident_owner *owner, uint32_t generation, uint32_t timestamp_ms,
    framer_mqjs_input_reason reason)
{
    framer_mqjs_result result;
    if (!owner_ingress_enter(owner, generation, 0))
        return FRAMER_MQJS_ERR_DISABLED;
    result = owner_request_terminal_release(owner, timestamp_ms, reason);
    owner_ingress_leave(owner);
    return result;
}

int framer_resident_owner_get_input_observation(
    framer_resident_owner *owner,
    framer_mqjs_input_observation *observation)
{
    uint32_t generation;
    int result;
    if (owner == (framer_resident_owner *)0 ||
        observation == (framer_mqjs_input_observation *)0)
        return 0;
    generation = __atomic_load_n(&owner->ingress_generation,
                                 __ATOMIC_ACQUIRE);
    if (!owner_ingress_enter(owner, generation, 0))
        return 0;
    result = owner->engine.input_get_observation(&owner->runtime, observation);
    owner_ingress_leave(owner);
    return result;
}

void framer_resident_owner_input_poll_due(framer_resident_owner *owner,
                                          uint32_t generation)
{
    if (!owner_ingress_enter(owner, generation, 0))
        return;
    __atomic_store_n(&owner->input_poll_scheduled, 0u, __ATOMIC_RELEASE);
    __atomic_store_n(&owner->input_pending, 1u, __ATOMIC_RELEASE);
    owner_reschedule(owner);
    owner_ingress_leave(owner);
}

static void schedule_input_poll(framer_resident_owner *owner,
                                uint32_t delay_ms)
{
    uint32_t generation = __atomic_load_n(&owner->ingress_generation,
                                          __ATOMIC_ACQUIRE);
    if (owner->platform.schedule_input_poll ==
            (int (*)(void *, uint32_t, uint32_t))0 ||
        __atomic_load_n(&owner->ingress_enabled, __ATOMIC_ACQUIRE) == 0u ||
        __atomic_exchange_n(&owner->input_poll_scheduled, 1u,
                            __ATOMIC_ACQ_REL) != 0u)
        return;
    if (delay_ms == 0u)
        delay_ms = 1u;
    if (!owner->platform.schedule_input_poll(owner->platform.opaque,
                                              generation, delay_ms))
        __atomic_store_n(&owner->input_poll_scheduled, 0u, __ATOMIC_RELEASE);
}

static framer_mqjs_result owner_issue_terminal_release_on_task(
    framer_resident_owner *owner)
{
    framer_mqjs_result result;
    uint32_t state = __atomic_load_n(&owner->terminal_release_state,
                                     __ATOMIC_ACQUIRE);
    if (state == FRAMER_RESIDENT_RELEASE_PUBLISHING)
        return FRAMER_MQJS_INPUT_MORE_PENDING;
    if (state != FRAMER_RESIDENT_RELEASE_REQUESTED)
        return FRAMER_MQJS_OK;
    result = owner->engine.input_request_release_all(
        &owner->runtime,
        __atomic_load_n(&owner->terminal_release_timestamp_ms,
                        __ATOMIC_RELAXED),
        (framer_mqjs_input_reason)__atomic_load_n(
            &owner->terminal_release_reason, __ATOMIC_RELAXED));
    if (result >= 0) {
        __atomic_store_n(&owner->terminal_release_state,
                         FRAMER_RESIDENT_RELEASE_ISSUED, __ATOMIC_RELEASE);
        __atomic_store_n(&owner->input_pending, 1u, __ATOMIC_RELEASE);
    }
    return result;
}

framer_mqjs_result framer_resident_owner_step(framer_resident_owner *owner)
{
    uint32_t head;
    uint32_t tail;
    uint32_t input_pending;
    uint32_t now_ms;
    int choose_input;
    framer_mqjs_result result;
    framer_mqjs_telemetry before;
    framer_mqjs_telemetry after;
    if (owner == (framer_resident_owner *)0)
        return FRAMER_MQJS_ERR_DISABLED;
    if (!owner_runtime_enter(owner))
        return FRAMER_MQJS_ERR_DISABLED;
    result = owner_issue_terminal_release_on_task(owner);
    if (result < 0) {
        __atomic_store_n(&owner->telemetry.last_result, result,
                         __ATOMIC_RELEASE);
        owner_runtime_leave(owner);
        return result;
    }
    if (result == FRAMER_MQJS_INPUT_MORE_PENDING &&
        __atomic_load_n(&owner->terminal_release_state,
                        __ATOMIC_ACQUIRE) ==
            FRAMER_RESIDENT_RELEASE_PUBLISHING) {
        owner_reschedule(owner);
        owner_runtime_leave(owner);
        return result;
    }
    /* A keyless admission has no input machinery: the engine's drain is a
     * hard error there, so a stray input_pending (e.g. a focus resync latch)
     * must never select the drain leg. Clear it instead of draining. */
    if (owner->admission.key_count == 0u)
        __atomic_store_n(&owner->input_pending, 0u, __ATOMIC_RELEASE);
    head = __atomic_load_n(&owner->queue_head, __ATOMIC_RELAXED);
    tail = __atomic_load_n(&owner->queue_tail, __ATOMIC_ACQUIRE);
    input_pending = __atomic_load_n(&owner->input_pending, __ATOMIC_ACQUIRE);
    if (head == tail && input_pending == 0u) {
        owner_runtime_leave(owner);
        return FRAMER_MQJS_NO_HANDLER;
    }
    choose_input = input_pending != 0u &&
        (head == tail || owner->prefer_input != 0u);
    zero_bytes(&before, sizeof(before));
    zero_bytes(&after, sizeof(after));
    owner->engine.get_telemetry(&owner->runtime, &before);
    now_ms = owner->platform.now_ms(owner->platform.opaque);
    if (choose_input) {
        __atomic_store_n(&owner->input_pending, 0u, __ATOMIC_RELEASE);
        result = owner->engine.input_drain(&owner->runtime, now_ms);
        __atomic_add_fetch(&owner->telemetry.input_drains, 1u,
                           __ATOMIC_RELAXED);
        owner->prefer_input = 0u;
    } else {
        framer_resident_event *event =
            &owner->queue[head % FRAMER_RESIDENT_EVENT_QUEUE_RECORDS];
        uint32_t receipt_tag = event->receipt_tag;
        result = owner->engine.dispatch(&owner->runtime, event->name,
                                        event->value, event->auxiliary);
        if (receipt_tag != 0u) {
            uint32_t sequence = __atomic_load_n(
                &owner->tagged_completion_sequence, __ATOMIC_RELAXED);
            if ((sequence & 1u) != 0u)
                ++sequence;
            __atomic_store_n(&owner->tagged_completion_sequence,
                             sequence + 1u, __ATOMIC_SEQ_CST);
            __atomic_store_n(&owner->tagged_completion.result, result,
                             __ATOMIC_RELAXED);
            __atomic_store_n(&owner->tagged_completion.mailbox_sequence,
                __atomic_load_n(&owner->mailbox.sequence, __ATOMIC_ACQUIRE),
                __ATOMIC_RELAXED);
            __atomic_store_n(&owner->tagged_completion.applied_generation,
                __atomic_load_n(&owner->mailbox.admitted_revision,
                                __ATOMIC_RELAXED), __ATOMIC_RELAXED);
            __atomic_store_n(&owner->tagged_completion.applied_revision,
                (uint32_t)__atomic_load_n(&owner->mailbox.slots[0],
                                          __ATOMIC_RELAXED),
                __ATOMIC_RELAXED);
            __atomic_store_n(&owner->tagged_completion.tag, receipt_tag,
                             __ATOMIC_RELAXED);
            __atomic_thread_fence(__ATOMIC_RELEASE);
            __atomic_store_n(&owner->tagged_completion_sequence,
                             sequence + 2u, __ATOMIC_RELEASE);
        }
        __atomic_store_n(&owner->queue_head, head + 1u, __ATOMIC_RELEASE);
        __atomic_add_fetch(&owner->telemetry.dispatches, 1u,
                           __ATOMIC_RELAXED);
        owner->prefer_input = 1u;
    }
    owner->engine.get_telemetry(&owner->runtime, &after);
    if (choose_input && result >= 0) {
        int32_t until_debounce =
            (int32_t)(__atomic_load_n(&owner->input_debounce_due_ms,
                                      __ATOMIC_ACQUIRE) - now_ms);
        if (result == FRAMER_MQJS_INPUT_MORE_PENDING ||
            result == FRAMER_MQJS_INPUT_RESYNC_QUEUED ||
            after.pending_input_events != 0u) {
            __atomic_store_n(&owner->input_pending, 1u, __ATOMIC_RELEASE);
        } else if (until_debounce > 0) {
            schedule_input_poll(owner, (uint32_t)until_debounce);
        } else if (after.held_key_mask != 0u) {
            /* A 20 ms cooperative poll is the profile's minimum hold cadence.
             * It yields between polls and lets isolated holds/releases mature
             * without requiring another physical producer event. */
            schedule_input_poll(owner, 20u);
        }
        if (__atomic_load_n(&owner->terminal_release_state,
                            __ATOMIC_ACQUIRE) ==
                FRAMER_RESIDENT_RELEASE_ISSUED &&
            result != FRAMER_MQJS_INPUT_MORE_PENDING &&
            result != FRAMER_MQJS_INPUT_RESYNC_QUEUED &&
            after.pending_input_events == 0u && after.held_key_mask == 0u)
            __atomic_store_n(&owner->terminal_release_state,
                             FRAMER_RESIDENT_RELEASE_DRAINED,
                             __ATOMIC_RELEASE);
    }
    __atomic_store_n(&owner->telemetry.last_result, result, __ATOMIC_RELEASE);
    if (result < 0) {
        uint32_t reset_delta = after.resets - before.resets;
        __atomic_add_fetch(&owner->telemetry.engine_failures, 1u,
                           __ATOMIC_RELAXED);
        if (__atomic_load_n(&owner->telemetry.permanently_disabled,
                            __ATOMIC_ACQUIRE) != 0u ||
            __atomic_load_n(&owner->capability.state, __ATOMIC_ACQUIRE) !=
                FRAMER_RESIDENT_CAP_ADVERTISED) {
            /* A callback admitted before the close gate may observe a rejected
             * publish and perform the core's one bounded recovery. Teardown
             * owns the session now; do not fault or schedule a second reset. */
            owner_runtime_leave(owner);
            return result;
        }
        if (choose_input && after.enabled != 0u)
            __atomic_store_n(&owner->input_pending, 1u, __ATOMIC_RELEASE);
        if (after.enabled != 0u && reset_delta != 0u) {
            __atomic_add_fetch(&owner->telemetry.recoveries, reset_delta,
                               __ATOMIC_RELAXED);
            __atomic_store_n(&owner->last_engine_resets, after.resets,
                             __ATOMIC_RELEASE);
            /* Core consumed the failed snapshot and performed the one reserved
             * recovery. Retained FIFO work runs in a later owner iteration. */
            owner_reschedule(owner);
        } else {
            __atomic_add_fetch(&owner->telemetry.recovery_failures, 1u,
                               __ATOMIC_RELAXED);
            __atomic_store_n(&owner->telemetry.permanently_disabled, 1u,
                             __ATOMIC_RELEASE);
            framer_resident_capability_fault(&owner->capability);
        }
        owner_runtime_leave(owner);
        return result;
    }
    if (__atomic_load_n(&owner->telemetry.permanently_disabled,
                        __ATOMIC_ACQUIRE) == 0u &&
        (__atomic_load_n(&owner->input_pending, __ATOMIC_ACQUIRE) != 0u ||
         __atomic_load_n(&owner->queue_head, __ATOMIC_RELAXED) !=
             __atomic_load_n(&owner->queue_tail, __ATOMIC_ACQUIRE)))
        owner_reschedule(owner);
    if (owner->platform.task_stack_high_water_bytes !=
        (uint32_t (*)(void *))0)
        __atomic_store_n(&owner->telemetry.task_stack_high_water_bytes,
            owner->platform.task_stack_high_water_bytes(owner->platform.opaque),
            __ATOMIC_RELEASE);
    owner_runtime_leave(owner);
    return result;
}

int framer_resident_owner_begin_quiesce(framer_resident_owner *owner,
                                        uint32_t timestamp_ms,
                                        framer_mqjs_input_reason reason)
{
    uint32_t event_sources;
    uint32_t sources;
    uint32_t generation;
    if (owner == (framer_resident_owner *)0)
        return 0;
    if (reason != FRAMER_MQJS_INPUT_REASON_FOCUS_LOSS &&
        reason != FRAMER_MQJS_INPUT_REASON_DISCONNECT)
        return 0;
    /* Serialize the mailbox commit point against shutdown. A publish that held
     * the lock completes before advertisement closes; any later publisher sees
     * the closed gate and is rejected before writing the mailbox. */
    owner_publish_gate_lock(owner);
    framer_resident_capability_begin_quiesce(&owner->capability);
    __atomic_store_n(&owner->telemetry.permanently_disabled, 1u,
                     __ATOMIC_RELEASE);
    __atomic_store_n(&owner->ingress_enabled, 0u, __ATOMIC_RELEASE);
    __atomic_store_n(&owner->input_ingress_enabled, 0u, __ATOMIC_RELEASE);
    owner_publish_gate_unlock(owner);
    generation = __atomic_load_n(&owner->ingress_generation,
                                 __ATOMIC_ACQUIRE);

    /* Generic tick/knob/RPC wrappers are retired first. The platform handoff
     * makes the inflight count stable: after it returns, no new wrapper can
     * register against this owner/generation. */
    event_sources = __atomic_load_n(&owner->event_source_quiesce_state,
                                    __ATOMIC_ACQUIRE);
    if (event_sources == FRAMER_RESIDENT_SOURCES_LIVE) {
        uint32_t expected = FRAMER_RESIDENT_SOURCES_LIVE;
        if (!__atomic_compare_exchange_n(
                &owner->event_source_quiesce_state, &expected,
                FRAMER_RESIDENT_SOURCES_RETIRING, 0,
                __ATOMIC_ACQ_REL, __ATOMIC_ACQUIRE))
            return 0;
        if (!owner->platform.remove_event_sources(
                owner->platform.opaque, generation)) {
            __atomic_store_n(&owner->event_source_quiesce_state,
                             FRAMER_RESIDENT_SOURCES_FAILED,
                             __ATOMIC_RELEASE);
            framer_resident_capability_fault(&owner->capability);
            return 0;
        }
        __atomic_store_n(&owner->event_source_quiesce_state,
                         FRAMER_RESIDENT_SOURCES_QUIESCED, __ATOMIC_RELEASE);
    } else if (event_sources == FRAMER_RESIDENT_SOURCES_UNARMED) {
        __atomic_store_n(&owner->event_source_quiesce_state,
                         FRAMER_RESIDENT_SOURCES_QUIESCED, __ATOMIC_RELEASE);
    } else if (event_sources != FRAMER_RESIDENT_SOURCES_QUIESCED) {
        return 0;
    }

    sources = __atomic_load_n(&owner->source_quiesce_state,
                              __ATOMIC_ACQUIRE);
    if (sources == FRAMER_RESIDENT_SOURCES_LIVE) {
        uint32_t expected = FRAMER_RESIDENT_SOURCES_LIVE;
        if (!__atomic_compare_exchange_n(
                &owner->source_quiesce_state, &expected,
                FRAMER_RESIDENT_SOURCES_RETIRING, 0,
                __ATOMIC_ACQ_REL, __ATOMIC_ACQUIRE))
            return 0;
        if (!owner->platform.remove_stock_input_hook(
                owner->platform.opaque, generation) ||
            !owner->platform.cancel_input_poll(
                owner->platform.opaque, generation)) {
            __atomic_store_n(&owner->source_quiesce_state,
                             FRAMER_RESIDENT_SOURCES_FAILED,
                             __ATOMIC_RELEASE);
            framer_resident_capability_fault(&owner->capability);
            return 0;
        }
        __atomic_store_n(&owner->input_poll_scheduled, 0u, __ATOMIC_RELEASE);
        __atomic_store_n(&owner->source_quiesce_state,
                         FRAMER_RESIDENT_SOURCES_QUIESCED, __ATOMIC_RELEASE);
    } else if (sources == FRAMER_RESIDENT_SOURCES_UNARMED) {
        __atomic_store_n(&owner->source_quiesce_state,
                         FRAMER_RESIDENT_SOURCES_QUIESCED, __ATOMIC_RELEASE);
    } else if (sources != FRAMER_RESIDENT_SOURCES_QUIESCED) {
        return 0;
    }
    /* Terminal release is published only after hook/timer retirement. The VM
     * owner issues it; a racing producer can therefore never execute JS. */
    if (__atomic_load_n(&owner->telemetry.booted, __ATOMIC_ACQUIRE) != 0u &&
        owner->admission.key_count != 0u)
        (void)owner_request_terminal_release(owner, timestamp_ms, reason);
    else
        __atomic_store_n(&owner->terminal_release_state,
                         FRAMER_RESIDENT_RELEASE_DRAINED, __ATOMIC_RELEASE);
    owner_reschedule(owner);
    return 1;
}

int framer_resident_owner_stop_on_task(framer_resident_owner *owner)
{
    framer_mqjs_result result = FRAMER_MQJS_OK;
    framer_mqjs_telemetry before;
    framer_mqjs_telemetry after;
    uint32_t state;
    if (owner == (framer_resident_owner *)0)
        return 0;
    if (__atomic_load_n(&owner->event_source_quiesce_state,
                        __ATOMIC_ACQUIRE) !=
            FRAMER_RESIDENT_SOURCES_QUIESCED ||
        __atomic_load_n(&owner->source_quiesce_state, __ATOMIC_ACQUIRE) !=
            FRAMER_RESIDENT_SOURCES_QUIESCED ||
        __atomic_load_n(&owner->capability.state, __ATOMIC_ACQUIRE) !=
            FRAMER_RESIDENT_CAP_QUIESCING)
        return 0;
    /* A control task may have closed the gates while the VM owner was inside a
     * bounded callback. Never call another engine API or destroy until that
     * callback has returned. */
    if (__atomic_load_n(&owner->owner_runtime_inflight,
                        __ATOMIC_ACQUIRE) != 0u) {
        owner_reschedule(owner);
        return 0;
    }
    if (__atomic_load_n(&owner->telemetry.booted, __ATOMIC_ACQUIRE) != 0u &&
        owner->admission.key_count != 0u) {
        result = owner_issue_terminal_release_on_task(owner);
        if (result == FRAMER_MQJS_INPUT_MORE_PENDING) {
            owner_reschedule(owner);
            return 0;
        }
        if (result < 0) {
            __atomic_add_fetch(&owner->telemetry.engine_failures, 1u,
                               __ATOMIC_RELAXED);
            __atomic_store_n(&owner->telemetry.last_result, result,
                             __ATOMIC_RELEASE);
        }
    }
    /* Release is issued before this producer wait because the core release gate
     * is explicitly concurrent-safe with one admitted input producer. Generic
     * and input platform sources are already synchronously retired, so zero is
     * stable once every registered call leaves. */
    if (__atomic_load_n(&owner->ingress_inflight, __ATOMIC_ACQUIRE) != 0u) {
        owner_reschedule(owner);
        return 0;
    }
    __atomic_store_n(&owner->queue_head,
                     __atomic_load_n(&owner->queue_tail, __ATOMIC_ACQUIRE),
                     __ATOMIC_RELEASE);
    state = __atomic_load_n(&owner->terminal_release_state, __ATOMIC_ACQUIRE);
    if (__atomic_load_n(&owner->telemetry.booted, __ATOMIC_ACQUIRE) != 0u &&
        owner->admission.key_count != 0u &&
        state == FRAMER_RESIDENT_RELEASE_ISSUED) {
        zero_bytes(&before, sizeof(before));
        zero_bytes(&after, sizeof(after));
        owner->engine.get_telemetry(&owner->runtime, &before);
        result = owner->engine.input_drain(
            &owner->runtime, owner->platform.now_ms(owner->platform.opaque));
        __atomic_add_fetch(&owner->telemetry.input_drains, 1u,
                           __ATOMIC_RELAXED);
        owner->engine.get_telemetry(&owner->runtime, &after);
        __atomic_store_n(&owner->telemetry.last_result, result,
                         __ATOMIC_RELEASE);
        if (result < 0) {
            uint32_t reset_delta = after.resets - before.resets;
            __atomic_add_fetch(&owner->telemetry.engine_failures, 1u,
                               __ATOMIC_RELAXED);
            if (after.enabled != 0u && reset_delta != 0u) {
                __atomic_add_fetch(&owner->telemetry.recoveries, reset_delta,
                                   __ATOMIC_RELAXED);
                __atomic_store_n(&owner->last_engine_resets, after.resets,
                                 __ATOMIC_RELEASE);
                owner_reschedule(owner);
                return 0;
            }
            __atomic_add_fetch(&owner->telemetry.recovery_failures, 1u,
                               __ATOMIC_RELAXED);
        }
        if (result == FRAMER_MQJS_INPUT_MORE_PENDING ||
            result == FRAMER_MQJS_INPUT_RESYNC_QUEUED ||
            after.pending_input_events != 0u || after.held_key_mask != 0u) {
            owner_reschedule(owner);
            return 0;
        }
        __atomic_store_n(&owner->terminal_release_state,
                         FRAMER_RESIDENT_RELEASE_DRAINED, __ATOMIC_RELEASE);
    }
    if (__atomic_load_n(&owner->telemetry.booted, __ATOMIC_ACQUIRE) != 0u)
        owner->engine.destroy(&owner->runtime);
    if (owner->heap != (void *)0 &&
        owner->platform.free_psram != (void (*)(void *, void *))0)
        owner->platform.free_psram(owner->platform.opaque, owner->heap);
    owner->heap = (void *)0;
    __atomic_store_n(&owner->telemetry.booted, 0u, __ATOMIC_RELEASE);
    __atomic_store_n(&owner->active_generation, 0u, __ATOMIC_RELEASE);
    __atomic_store_n(&owner->ingress_generation, 0u, __ATOMIC_RELEASE);
    __atomic_store_n(&owner->input_pending, 0u, __ATOMIC_RELEASE);
    (void)framer_resident_capability_set_ready(
        &owner->capability, FRAMER_RESIDENT_READY_VM_TASK, 0);
    (void)framer_resident_capability_set_ready(
        &owner->capability, FRAMER_RESIDENT_READY_PARSER, 0);
    (void)framer_resident_capability_set_ready(
        &owner->capability, FRAMER_RESIDENT_READY_MAILBOX, 0);
    return framer_resident_capability_finish_quiesce(&owner->capability);
}

void framer_resident_owner_get_telemetry(
    framer_resident_owner *owner,
    framer_resident_telemetry *telemetry)
{
    if (owner == (framer_resident_owner *)0 ||
        telemetry == (framer_resident_telemetry *)0)
        return;
    if (owner->platform.task_stack_high_water_bytes !=
        (uint32_t (*)(void *))0)
        __atomic_store_n(&owner->telemetry.task_stack_high_water_bytes,
            owner->platform.task_stack_high_water_bytes(owner->platform.opaque),
            __ATOMIC_RELEASE);
    zero_bytes(telemetry, sizeof(*telemetry));
#define LOAD_TELEMETRY(field) \
    telemetry->field = __atomic_load_n(&owner->telemetry.field, __ATOMIC_ACQUIRE)
    LOAD_TELEMETRY(dispatches);
    LOAD_TELEMETRY(input_drains);
    LOAD_TELEMETRY(queue_overflows);
    LOAD_TELEMETRY(engine_failures);
    LOAD_TELEMETRY(recoveries);
    LOAD_TELEMETRY(recovery_failures);
    LOAD_TELEMETRY(reschedules);
    LOAD_TELEMETRY(module_revision);
    LOAD_TELEMETRY(task_stack_high_water_bytes);
    LOAD_TELEMETRY(last_result);
    LOAD_TELEMETRY(booted);
    LOAD_TELEMETRY(permanently_disabled);
#undef LOAD_TELEMETRY
}
