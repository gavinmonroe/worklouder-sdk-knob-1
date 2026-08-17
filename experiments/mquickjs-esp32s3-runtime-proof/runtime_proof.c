#include "runtime_proof.h"

enum {
    FRAMER_RUNTIME_ALLOC_FAULT_ARGUMENT = 1u,
    FRAMER_RUNTIME_ALLOC_FAULT_PREFLIGHT = 2u,
    FRAMER_RUNTIME_ALLOC_FAULT_BLOCK = 3u,
    FRAMER_RUNTIME_ALLOC_FAULT_BLOCK_RANGE = 4u,
};

static void zero_bytes(void *destination, size_t bytes)
{
    uint8_t *output = (uint8_t *)destination;
    while (bytes-- != 0u)
        *output++ = 0u;
}

static size_t bounded_length(const char *value, size_t limit)
{
    size_t length = 0u;
    if (value == (const char *)0)
        return 0u;
    while (length < limit && value[length] != 0)
        ++length;
    return length;
}

static void copy_string(char *destination, size_t capacity, const char *source)
{
    size_t length;
    size_t index;
    if (destination == (char *)0 || capacity == 0u)
        return;
    length = bounded_length(source, capacity - 1u);
    for (index = 0u; index < length; ++index)
        destination[index] = source[index];
    destination[length] = 0;
}

void framer_runtime_rpc_init(framer_runtime_rpc_context *context,
                             const char *method)
{
    if (context == (framer_runtime_rpc_context *)0)
        return;
    zero_bytes(context, sizeof(*context));
    copy_string(context->blocked, sizeof(context->blocked), "blocked");
    copy_string(context->value, sizeof(context->value), "v1;s=COLD");
    copy_string(context->status_key, sizeof(context->status_key), "status");
    copy_string(context->method, sizeof(context->method), method);
}

int framer_runtime_rpc_begin(framer_runtime_rpc_context *context)
{
    uint32_t expected = 0u;
    if (context == (framer_runtime_rpc_context *)0 ||
        !__atomic_compare_exchange_n(&context->callback_lock, &expected, 1u, 0,
                                     __ATOMIC_ACQ_REL, __ATOMIC_ACQUIRE))
        return 0;
    __atomic_add_fetch(&context->callback_calls, 1u, __ATOMIC_RELAXED);
    return 1;
}

void framer_runtime_rpc_end(framer_runtime_rpc_context *context)
{
    if (context != (framer_runtime_rpc_context *)0)
        __atomic_store_n(&context->callback_lock, 0u, __ATOMIC_RELEASE);
}

void framer_runtime_receipt_init(framer_runtime_receipt *receipt)
{
    if (receipt == (framer_runtime_receipt *)0)
        return;
    zero_bytes(receipt, sizeof(*receipt));
    receipt->fields.state = FRAMER_RUNTIME_RECEIPT_COLD;
}

void framer_runtime_receipt_publish(
    framer_runtime_receipt *receipt,
    const framer_runtime_receipt_snapshot *snapshot)
{
    uint32_t sequence;
    if (receipt == (framer_runtime_receipt *)0 ||
        snapshot == (const framer_runtime_receipt_snapshot *)0)
        return;
    sequence = __atomic_load_n(&receipt->sequence, __ATOMIC_RELAXED);
    if ((sequence & 1u) != 0u)
        ++sequence;
    __atomic_store_n(&receipt->sequence, sequence + 1u, __ATOMIC_SEQ_CST);
    __atomic_thread_fence(__ATOMIC_SEQ_CST);
#define FRAMER_RECEIPT_COPY(field) \
    __atomic_store_n(&receipt->fields.field, snapshot->field, __ATOMIC_SEQ_CST)
    FRAMER_RECEIPT_COPY(state);
    FRAMER_RECEIPT_COPY(queue_depth);
    FRAMER_RECEIPT_COPY(event_sequence);
    FRAMER_RECEIPT_COPY(generation);
    FRAMER_RECEIPT_COPY(revision);
    FRAMER_RECEIPT_COPY(event_id);
    FRAMER_RECEIPT_COPY(event_value);
    FRAMER_RECEIPT_COPY(event_auxiliary);
    FRAMER_RECEIPT_COPY(applied_generation);
    FRAMER_RECEIPT_COPY(applied_revision);
    FRAMER_RECEIPT_COPY(rejected_count);
    FRAMER_RECEIPT_COPY(rejection_code);
#undef FRAMER_RECEIPT_COPY
    __atomic_thread_fence(__ATOMIC_SEQ_CST);
    __atomic_store_n(&receipt->sequence, sequence + 2u, __ATOMIC_SEQ_CST);
}

int framer_runtime_receipt_try_read(
    const framer_runtime_receipt *receipt,
    framer_runtime_receipt_snapshot *snapshot)
{
    uint32_t first;
    uint32_t second;
    if (receipt == (const framer_runtime_receipt *)0 ||
        snapshot == (framer_runtime_receipt_snapshot *)0)
        return 0;
    first = __atomic_load_n(&receipt->sequence, __ATOMIC_ACQUIRE);
    if ((first & 1u) != 0u)
        return 0;
#define FRAMER_RECEIPT_READ(field) \
    snapshot->field = __atomic_load_n(&receipt->fields.field, __ATOMIC_SEQ_CST)
    FRAMER_RECEIPT_READ(state);
    FRAMER_RECEIPT_READ(queue_depth);
    FRAMER_RECEIPT_READ(event_sequence);
    FRAMER_RECEIPT_READ(generation);
    FRAMER_RECEIPT_READ(revision);
    FRAMER_RECEIPT_READ(event_id);
    FRAMER_RECEIPT_READ(event_value);
    FRAMER_RECEIPT_READ(event_auxiliary);
    FRAMER_RECEIPT_READ(applied_generation);
    FRAMER_RECEIPT_READ(applied_revision);
    FRAMER_RECEIPT_READ(rejected_count);
    FRAMER_RECEIPT_READ(rejection_code);
#undef FRAMER_RECEIPT_READ
    __atomic_thread_fence(__ATOMIC_SEQ_CST);
    second = __atomic_load_n(&receipt->sequence, __ATOMIC_ACQUIRE);
    return first == second && (second & 1u) == 0u;
}

static char state_character(uint32_t state)
{
    switch (state) {
    case FRAMER_RUNTIME_RECEIPT_QUEUED: return 'Q';
    case FRAMER_RUNTIME_RECEIPT_APPLIED: return 'A';
    case FRAMER_RUNTIME_RECEIPT_REJECTED: return 'R';
    case FRAMER_RUNTIME_RECEIPT_BUSY: return 'B';
    case FRAMER_RUNTIME_RECEIPT_HIDDEN: return 'H';
    case FRAMER_RUNTIME_RECEIPT_FAULTED: return 'F';
    default: return 'C';
    }
}

static void append_character(char output[113], size_t *offset, char value)
{
    if (*offset < 112u)
        output[*offset] = value;
    ++*offset;
}

static void append_text(char output[113], size_t *offset, const char *value)
{
    while (*value != 0)
        append_character(output, offset, *value++);
}

static void append_hex32(char output[113], size_t *offset, uint32_t value)
{
    static const char digits[] = "0123456789abcdef";
    unsigned int shift;
    for (shift = 28u;; shift -= 4u) {
        append_character(output, offset, digits[(value >> shift) & 15u]);
        if (shift == 0u)
            break;
    }
}

static void append_hex64(char output[113], size_t *offset, uint64_t value)
{
    append_hex32(output, offset, (uint32_t)(value >> 32u));
    append_hex32(output, offset, (uint32_t)value);
}

static void append_page(char output[113], size_t *offset, uint32_t page)
{
    if (page >= 10u)
        append_character(output, offset, (char)('0' + (page / 10u)));
    append_character(output, offset, (char)('0' + (page % 10u)));
}

static int is_lower_hex_digest(const char value[65])
{
    size_t index;
    if (value == (const char *)0)
        return 0;
    for (index = 0u; index < 64u; ++index) {
        char character = value[index];
        if (!((character >= '0' && character <= '9') ||
              (character >= 'a' && character <= 'f')))
            return 0;
    }
    return value[64] == 0;
}

static int finish_status(char output[113], size_t required)
{
    output[required <= 112u ? required : 112u] = 0;
    return required <= 112u;
}

int framer_runtime_status_copy(const char *value, char output[113])
{
    size_t required = 0u;
    if (value == (const char *)0 || output == (char *)0)
        return 0;
    append_text(output, &required, value);
    return finish_status(output, required);
}

int framer_runtime_receipt_format(
    const framer_runtime_receipt_snapshot *snapshot,
    char output[113])
{
    size_t offset = 0u;
    if (snapshot == (const framer_runtime_receipt_snapshot *)0 ||
        output == (char *)0)
        return 0;
    append_text(output, &offset, "v1;s=");
    append_character(output, &offset, state_character(snapshot->state));
    append_text(output, &offset, ";q="); append_hex32(output, &offset, snapshot->queue_depth);
    append_text(output, &offset, ";seq="); append_hex32(output, &offset, snapshot->event_sequence);
    append_text(output, &offset, ";g="); append_hex32(output, &offset, snapshot->generation);
    append_text(output, &offset, ";r="); append_hex32(output, &offset, snapshot->revision);
    append_text(output, &offset, ";id="); append_hex32(output, &offset, snapshot->event_id);
    append_text(output, &offset, ";v="); append_hex32(output, &offset, (uint32_t)snapshot->event_value);
    append_text(output, &offset, ";a="); append_hex32(output, &offset, (uint32_t)snapshot->event_auxiliary);
    append_text(output, &offset, ";ag="); append_hex32(output, &offset, snapshot->applied_generation);
    append_text(output, &offset, ";ar="); append_hex32(output, &offset, snapshot->applied_revision);
    return finish_status(output, offset);
}

int framer_runtime_capability_format(
    const framer_runtime_capability *capability,
    uint32_t page,
    char output[113])
{
    size_t offset = 0u;
    if (capability == (const framer_runtime_capability *)0 ||
        output == (char *)0 || page >= FRAMER_RUNTIME_CAPABILITY_PAGES ||
        !is_lower_hex_digest(capability->base_app_sha256) ||
        !is_lower_hex_digest(capability->module_sha256) ||
        !is_lower_hex_digest(capability->package_sha256))
        return 0;
    append_text(output, &offset, "v1;p=");
    append_page(output, &offset, page);
    switch (page) {
    case 0u:
        append_text(output, &offset,
            ";profile=" FRAMER_RUNTIME_PROFILE_ID
            ";screen=28;physical=1;proven=0;uploader=0");
        break;
    case 1u:
        append_text(output, &offset, ";baseApp=");
        append_text(output, &offset, capability->base_app_sha256);
        append_text(output, &offset, ";boot=");
        append_hex64(output, &offset, capability->boot_id);
        break;
    case 2u:
        append_text(output, &offset, ";module=");
        append_text(output, &offset, capability->module_sha256);
        append_text(output, &offset, ";slotBytes=00030000");
        break;
    case 3u:
        append_text(output, &offset, ";package=");
        append_text(output, &offset, capability->package_sha256);
        append_text(output, &offset, ";g=");
        append_hex32(output, &offset, capability->generation);
        break;
    case 4u:
        append_text(output, &offset, ";js=1;host=1;timer=1;key=");
        append_character(output, &offset, capability->key_events != 0u ? '1' : '0');
        append_text(output, &offset, ";chord=");
        append_character(output, &offset, capability->chord_events != 0u ? '1' : '0');
        append_text(output, &offset, ";keyGate=live-2x-du");
        break;
    case 5u:
        append_text(output, &offset,
            ";packageFormat=" FRAMER_RUNTIME_PACKAGE_FORMAT);
        break;
    case 6u:
        append_text(output, &offset,
            ";packageAbiSha256=" FRAMER_RUNTIME_PACKAGE_ABI_SHA256);
        break;
    case 7u:
        append_text(output, &offset,
            ";engine=MicroQuickJS;engineCommit=" FRAMER_RUNTIME_ENGINE_COMMIT);
        break;
    case 8u:
        append_text(output, &offset,
            ";javascriptProfile=" FRAMER_RUNTIME_JAVASCRIPT_PROFILE
            ";deviceEvaluatesJavaScript=1;deviceRunsJsdom=0");
        break;
    case 9u:
        append_text(output, &offset,
            ";maxPackageBytes=98304;maxSourceBytes=8192;heapBytes=65536"
            ";callbackDeadlineUs=2000");
        break;
    case 10u:
        append_text(output, &offset,
            ";maxHandlers=16;maxTargets=16;maxKeys=16;maxChords=8");
        break;
    case 11u:
        append_text(output, &offset,
            ";moduleAbiSha256=" FRAMER_RUNTIME_MODULE_ABI_SHA256);
        break;
    default:
        append_text(output, &offset,
            ";screenIds=1,7,26,27,28;methods=0f;wdt=unsubscribed;map=bootlife");
        break;
    }
    return finish_status(output, offset);
}

int framer_runtime_telemetry_format(
    const framer_runtime_telemetry *telemetry,
    uint32_t page,
    char output[113])
{
    size_t offset = 0u;
    if (telemetry == (const framer_runtime_telemetry *)0 ||
        output == (char *)0 || page > 5u)
        return 0;
    append_text(output, &offset, "v1;p=");
    append_character(output, &offset, (char)('0' + page));
#define FIELD32(name, field) \
    do { append_text(output, &offset, name); \
         append_hex32(output, &offset, telemetry->field); } while (0)
#define FIELD64(name, field) \
    do { append_text(output, &offset, name); \
         append_hex64(output, &offset, telemetry->field); } while (0)
    switch (page) {
    case 0u:
        FIELD64(";b=", boot_id); FIELD64(";u=", uptime_us);
        FIELD32(";f=", free_internal); FIELD32(";l=", largest_internal);
        FIELD32(";h=", heap_current); FIELD32(";H=", heap_high_water);
        FIELD32(";s=", stack_minimum);
        break;
    case 1u:
        FIELD32(";c=", callbacks); FIELD64(";p=", polls);
        FIELD32(";d=", deadline_us); FIELD32(";t=", timeouts);
        FIELD32(";o=", oom); FIELD32(";x=", exceptions);
        FIELD32(";m=", max_slice_us);
        break;
    case 2u:
        FIELD32(";l=", loads); FIELD32(";s=", source_rejected);
        FIELD32(";p=", publish_failed); FIELD32(";w=", wrong_thread);
        FIELD32(";r=", recoveries); FIELD32(";R=", recovery_failures);
        append_text(output, &offset, ";x=");
        append_hex32(output, &offset, (uint32_t)telemetry->last_result);
        FIELD32(";n=", last_event_sequence); FIELD32(";f=", fatal);
        break;
    case 3u:
        FIELD32(";q=", queue_depth); FIELD32(";Q=", events_queued);
        FIELD32(";A=", events_applied); FIELD32(";R=", events_rejected);
        FIELD32(";n=", last_event_sequence); FIELD32(";m=", mailbox_sequence);
        FIELD32(";g=", applied_generation); FIELD32(";r=", applied_revision);
        break;
    case 4u:
        append_text(output, &offset, ";w=U;dt=00000001");
        FIELD32(";dc=", delays);
        append_text(output, &offset, ";map=B;flash=0;nvs=0");
        FIELD32(";f=", fatal);
        break;
    default:
        FIELD32(";s=", screen);
        append_text(output, &offset, ";v=");
        append_character(output, &offset, telemetry->visible != 0u ? '1' : '0');
        FIELD32(";y=", replay_count); FIELD32(";k=", key_observations);
        FIELD32(";t=", last_token);
        append_text(output, &offset, ";l=");
        append_character(output, &offset, telemetry->last_level != 0u ? '1' : '0');
        append_text(output, &offset, ";G=");
        append_character(output, &offset, telemetry->key_gate != 0u ? '1' : '0');
        append_text(output, &offset, ";c=");
        append_character(output, &offset, telemetry->chord_active != 0u ? '1' : '0');
        FIELD32(";r=", weather_applied_revision);
        break;
    }
#undef FIELD32
#undef FIELD64
    return finish_status(output, offset);
}

void framer_runtime_key_probe_init(framer_runtime_key_probe *probe)
{
    if (probe != (framer_runtime_key_probe *)0)
        zero_bytes(probe, sizeof(*probe));
}

void framer_runtime_key_probe_observe(framer_runtime_key_probe *probe,
                                      uint32_t token, uint8_t level)
{
    uint32_t sequence;
    if (probe == (framer_runtime_key_probe *)0)
        return;
    sequence = __atomic_load_n(&probe->sequence, __ATOMIC_RELAXED);
    if ((sequence & 1u) != 0u)
        ++sequence;
    __atomic_store_n(&probe->sequence, sequence + 1u, __ATOMIC_SEQ_CST);
    __atomic_store_n(&probe->last_token, token, __ATOMIC_RELAXED);
    __atomic_store_n(&probe->last_level, level != 0u ? 1u : 0u,
                     __ATOMIC_RELAXED);
    __atomic_add_fetch(&probe->observation_count, 1u, __ATOMIC_RELAXED);
    if (token == FRAMER_RUNTIME_TOKEN_SPACE) {
        if (level != 0u)
            __atomic_store_n(&probe->space_down, 1u, __ATOMIC_RELAXED);
        else
            __atomic_store_n(&probe->space_up, 1u, __ATOMIC_RELAXED);
    } else if (token == FRAMER_RUNTIME_TOKEN_LEFT_SHIFT) {
        if (level != 0u)
            __atomic_store_n(&probe->shift_down, 1u, __ATOMIC_RELAXED);
        else
            __atomic_store_n(&probe->shift_up, 1u, __ATOMIC_RELAXED);
    }
    __atomic_store_n(&probe->sequence, sequence + 2u, __ATOMIC_RELEASE);
}

int framer_runtime_key_probe_can_commit(const framer_runtime_key_probe *probe)
{
    return probe != (const framer_runtime_key_probe *)0 &&
        __atomic_load_n(&probe->space_down, __ATOMIC_ACQUIRE) != 0u &&
        __atomic_load_n(&probe->space_up, __ATOMIC_ACQUIRE) != 0u &&
        __atomic_load_n(&probe->shift_down, __ATOMIC_ACQUIRE) != 0u &&
        __atomic_load_n(&probe->shift_up, __ATOMIC_ACQUIRE) != 0u;
}

int framer_runtime_key_probe_commit(framer_runtime_key_probe *probe)
{
    if (!framer_runtime_key_probe_can_commit(probe))
        return 0;
    __atomic_store_n(&probe->committed, 1u, __ATOMIC_RELEASE);
    return 1;
}

int framer_runtime_key_probe_try_read(
    const framer_runtime_key_probe *probe,
    framer_runtime_key_probe *snapshot)
{
    uint32_t first;
    uint32_t second;
    if (probe == (const framer_runtime_key_probe *)0 ||
        snapshot == (framer_runtime_key_probe *)0)
        return 0;
    first = __atomic_load_n(&probe->sequence, __ATOMIC_ACQUIRE);
    if ((first & 1u) != 0u)
        return 0;
#define FRAMER_KEY_READ(field) \
    snapshot->field = __atomic_load_n(&probe->field, __ATOMIC_RELAXED)
    FRAMER_KEY_READ(last_token);
    FRAMER_KEY_READ(last_level);
    FRAMER_KEY_READ(observation_count);
    FRAMER_KEY_READ(space_down);
    FRAMER_KEY_READ(space_up);
    FRAMER_KEY_READ(shift_down);
    FRAMER_KEY_READ(shift_up);
    FRAMER_KEY_READ(committed);
#undef FRAMER_KEY_READ
    __atomic_thread_fence(__ATOMIC_ACQUIRE);
    second = __atomic_load_n(&probe->sequence, __ATOMIC_ACQUIRE);
    snapshot->sequence = second;
    return first == second && (second & 1u) == 0u;
}

int framer_runtime_key_probe_map(const framer_runtime_key_probe *probe,
                                 uint32_t physical_token,
                                 uint32_t *logical_token)
{
    if (probe == (const framer_runtime_key_probe *)0 ||
        logical_token == (uint32_t *)0 ||
        __atomic_load_n(&probe->committed, __ATOMIC_ACQUIRE) == 0u)
        return 0;
    if (physical_token == FRAMER_RUNTIME_TOKEN_SPACE) {
        *logical_token = FRAMER_RUNTIME_TOKEN_SPACE;
        return 1;
    }
    if (physical_token == FRAMER_RUNTIME_TOKEN_LEFT_SHIFT) {
        *logical_token = FRAMER_RUNTIME_TOKEN_LEFT_SHIFT;
        return 1;
    }
    return 0;
}

void framer_runtime_visibility_init(framer_runtime_visibility *visibility)
{
    if (visibility == (framer_runtime_visibility *)0)
        return;
    zero_bytes(visibility, sizeof(*visibility));
    __atomic_store_n(&visibility->visible, 1u, __ATOMIC_RELEASE);
    __atomic_store_n(&visibility->key_ingress_enabled, 1u, __ATOMIC_RELEASE);
}

int framer_runtime_visibility_set(framer_runtime_visibility *visibility,
                                  int visible)
{
    uint32_t next;
    if (visibility == (framer_runtime_visibility *)0)
        return 0;
    next = visible != 0 ? 1u : 0u;
    if (__atomic_load_n(&visibility->visible, __ATOMIC_ACQUIRE) == next)
        return 1;
    if (next == 0u) {
        __atomic_store_n(&visibility->visible, 0u, __ATOMIC_RELEASE);
        __atomic_store_n(&visibility->key_ingress_enabled, 0u,
                         __ATOMIC_RELEASE);
        __atomic_store_n(&visibility->release_all_pending, 1u,
                         __ATOMIC_RELEASE);
    } else {
        __atomic_store_n(&visibility->visible, 1u, __ATOMIC_RELEASE);
        __atomic_store_n(&visibility->key_ingress_enabled, 1u,
                         __ATOMIC_RELEASE);
        __atomic_store_n(&visibility->replay_pending,
            __atomic_load_n(&visibility->last_good_valid, __ATOMIC_ACQUIRE),
            __ATOMIC_RELEASE);
    }
    return 1;
}

void framer_runtime_visibility_publish(framer_runtime_visibility *visibility,
                                       uint32_t generation,
                                       uint32_t revision)
{
    if (visibility == (framer_runtime_visibility *)0 || generation == 0u)
        return;
    __atomic_add_fetch(&visibility->sequence, 1u, __ATOMIC_ACQ_REL);
    __atomic_store_n(&visibility->last_good_generation, generation,
                     __ATOMIC_RELAXED);
    __atomic_store_n(&visibility->last_good_revision, revision,
                     __ATOMIC_RELAXED);
    __atomic_store_n(&visibility->last_good_valid, 1u, __ATOMIC_RELAXED);
    __atomic_add_fetch(&visibility->sequence, 1u, __ATOMIC_RELEASE);
    if (__atomic_load_n(&visibility->visible, __ATOMIC_ACQUIRE) == 0u)
        __atomic_store_n(&visibility->replay_pending, 1u, __ATOMIC_RELEASE);
}

int framer_runtime_visibility_take_replay(framer_runtime_visibility *visibility,
                                          uint32_t *generation,
                                          uint32_t *revision)
{
    if (visibility == (framer_runtime_visibility *)0 ||
        generation == (uint32_t *)0 || revision == (uint32_t *)0 ||
        __atomic_load_n(&visibility->visible, __ATOMIC_ACQUIRE) == 0u ||
        __atomic_load_n(&visibility->replay_pending, __ATOMIC_ACQUIRE) == 0u ||
        __atomic_load_n(&visibility->last_good_valid, __ATOMIC_ACQUIRE) == 0u)
        return 0;
    for (;;) {
        uint32_t first = __atomic_load_n(&visibility->sequence,
                                         __ATOMIC_ACQUIRE);
        uint32_t second;
        if ((first & 1u) != 0u)
            return 0;
        *generation = __atomic_load_n(&visibility->last_good_generation,
                                      __ATOMIC_RELAXED);
        *revision = __atomic_load_n(&visibility->last_good_revision,
                                    __ATOMIC_RELAXED);
        __atomic_thread_fence(__ATOMIC_ACQUIRE);
        second = __atomic_load_n(&visibility->sequence, __ATOMIC_ACQUIRE);
        if (first == second) {
            __atomic_store_n(&visibility->replay_pending, 0u,
                             __ATOMIC_RELEASE);
            return 1;
        }
    }
}

int framer_runtime_allocate_internal(
    const framer_runtime_heap_api *api,
    framer_runtime_internal_allocations *allocations,
    size_t exact_block_bytes)
{
    if (api == (const framer_runtime_heap_api *)0 ||
        allocations == (framer_runtime_internal_allocations *)0 ||
        api->free_size == (size_t (*)(void *, uint32_t))0 ||
        api->largest_block == (size_t (*)(void *, uint32_t))0 ||
        api->allocate == (void *(*)(void *, size_t, uint32_t))0 ||
        api->release == (void (*)(void *, void *))0 ||
        api->internal_range == (int (*)(void *, const void *, size_t))0 ||
        exact_block_bytes < FRAMER_RUNTIME_PHYSICAL_BLOCK_AUDITED_MIN_BYTES ||
        exact_block_bytes > UINT32_MAX - FRAMER_RUNTIME_INTERNAL_RESERVE_BYTES) {
        if (allocations != (framer_runtime_internal_allocations *)0)
            allocations->fault = FRAMER_RUNTIME_ALLOC_FAULT_ARGUMENT;
        return 0;
    }
    zero_bytes(allocations, sizeof(*allocations));
    allocations->sampled_free = (uint32_t)api->free_size(
        api->opaque, FRAMER_RUNTIME_INTERNAL_CAPS);
    allocations->sampled_largest = (uint32_t)api->largest_block(
        api->opaque, FRAMER_RUNTIME_INTERNAL_CAPS);
    allocations->block_bytes = (uint32_t)exact_block_bytes;
    if (allocations->sampled_free <
            exact_block_bytes + FRAMER_RUNTIME_INTERNAL_RESERVE_BYTES ||
        allocations->sampled_largest < exact_block_bytes) {
        allocations->fault = FRAMER_RUNTIME_ALLOC_FAULT_PREFLIGHT;
        return 0;
    }
    /* The final linked block owns control, task, VM state, and heap. */
    allocations->block = api->allocate(api->opaque, exact_block_bytes,
                                       FRAMER_RUNTIME_INTERNAL_CAPS);
    if (allocations->block == (void *)0) {
        allocations->fault = FRAMER_RUNTIME_ALLOC_FAULT_BLOCK;
        return 0;
    }
    if (!api->internal_range(api->opaque, allocations->block,
                             exact_block_bytes)) {
        allocations->fault = FRAMER_RUNTIME_ALLOC_FAULT_BLOCK_RANGE;
        api->release(api->opaque, allocations->block);
        allocations->block = (void *)0;
        return 0;
    }
    return 1;
}

void framer_runtime_release_internal(
    const framer_runtime_heap_api *api,
    framer_runtime_internal_allocations *allocations)
{
    if (api == (const framer_runtime_heap_api *)0 ||
        allocations == (framer_runtime_internal_allocations *)0 ||
        api->release == (void (*)(void *, void *))0)
        return;
    if (allocations->block != (void *)0)
        api->release(api->opaque, allocations->block);
    allocations->block = (void *)0;
}

void framer_runtime_producer_init(framer_runtime_producer_gate *gate,
                                  uint32_t generation)
{
    if (gate == (framer_runtime_producer_gate *)0)
        return;
    zero_bytes(gate, sizeof(*gate));
    gate->generation = generation;
    gate->accepting = generation != 0u ? 1u : 0u;
}

int framer_runtime_producer_enter(framer_runtime_producer_gate *gate,
                                  uint32_t generation)
{
    if (gate == (framer_runtime_producer_gate *)0 || generation == 0u)
        return 0;
    __atomic_add_fetch(&gate->inflight, 1u, __ATOMIC_ACQ_REL);
    if (__atomic_load_n(&gate->accepting, __ATOMIC_ACQUIRE) != 0u &&
        __atomic_load_n(&gate->generation, __ATOMIC_ACQUIRE) == generation)
        return 1;
    __atomic_sub_fetch(&gate->inflight, 1u, __ATOMIC_RELEASE);
    return 0;
}

void framer_runtime_producer_leave(framer_runtime_producer_gate *gate)
{
    if (gate != (framer_runtime_producer_gate *)0)
        __atomic_sub_fetch(&gate->inflight, 1u, __ATOMIC_RELEASE);
}

void framer_runtime_producer_retire(framer_runtime_producer_gate *gate)
{
    if (gate != (framer_runtime_producer_gate *)0)
        __atomic_store_n(&gate->accepting, 0u, __ATOMIC_RELEASE);
}

int framer_runtime_producer_retired(const framer_runtime_producer_gate *gate)
{
    return gate != (const framer_runtime_producer_gate *)0 &&
        __atomic_load_n(&gate->accepting, __ATOMIC_ACQUIRE) == 0u &&
        __atomic_load_n(&gate->inflight, __ATOMIC_ACQUIRE) == 0u;
}

int framer_runtime_owner_iteration(framer_runtime_owner_loop *loop)
{
    int result = 0;
    if (loop == (framer_runtime_owner_loop *)0 ||
        loop->delay == (framer_runtime_delay_fn)0)
        return 0;
    loop->iterations++;
    if (__atomic_load_n(&loop->enabled, __ATOMIC_ACQUIRE) != 0u &&
        loop->step != (framer_runtime_owner_step_fn)0) {
        result = loop->step(loop->opaque);
        loop->last_step_result = (uint32_t)result;
        loop->steps++;
        if (loop->stack_high_water != (framer_runtime_stack_hwm_fn)0) {
            uint32_t current = loop->stack_high_water(loop->task);
            if (loop->minimum_stack_bytes == 0u ||
                current < loop->minimum_stack_bytes)
                loop->minimum_stack_bytes = current;
        }
    }
    loop->delay(FRAMER_RUNTIME_OWNER_DELAY_TICKS);
    loop->delays++;
    return result;
}

int framer_runtime_live_flash_write_allowed(void)
{
    return 0;
}

#if UINTPTR_MAX == 0xffffffffu
_Static_assert(sizeof(framer_runtime_rpc_context) == 352u,
               "persistent RPC context ABI changed");
_Static_assert(offsetof(framer_runtime_rpc_context, blocked) == 192u &&
               offsetof(framer_runtime_rpc_context, value) == 200u &&
               offsetof(framer_runtime_rpc_context, status_key) == 313u &&
               offsetof(framer_runtime_rpc_context, method) == 320u,
               "accepted reply helper offsets changed");
#endif
