/*
 * DIAGNOSTIC COPY of experiments/mquickjs-esp32s3-canary/framer_mquickjs_canary.c.
 *
 * The only difference from the release engine is an exception-text recorder:
 * runtime_state gains a fixed `last_error` buffer (108 bytes, NUL-terminated,
 * ASCII-sanitised) that classify_exception fills with
 * "<Error name>: <message> @<stack>" and framer_mqjs_destroy preserves across
 * its teardown memset.  The buffer lives inside the caller-owned
 * framer_mqjs_runtime storage (fixed FRAMER_MQJS_RUNTIME_STORAGE_BYTES), so
 * physical_block keeps byte-identical field offsets and size; only the module
 * text/rodata differ from the release build.  Nothing else is changed, no
 * header is touched, and no static/writable storage is added.
 *
 * The release source stays pinned by verify.mjs; this copy is built only by
 * build-diag-module.mjs.
 *
 * Isolated MicroQuickJS runtime canary. This translation unit intentionally
 * includes the exact pinned upstream engine so telemetry can observe the
 * pinned context layout without modifying third-party source.
 */
#include "framer_mquickjs_canary.h"

#include <limits.h>
#include <string.h>

#include "mquickjs.c"

#define STRICT_SOURCE_PREFIX "\"use strict\";\n"
#define STRICT_SOURCE_PREFIX_BYTES (sizeof(STRICT_SOURCE_PREFIX) - 1u)

/* DIAG ONLY. 107 printable characters plus NUL: the diagnostic RPC prefixes
 * "v4;" and framer_runtime_rpc_context::value holds at most 112 characters. */
#define FRAMER_MQJS_DIAG_LAST_ERROR_BYTES 108u

typedef enum {
    EVENT_TICK_100MS = 1,
    EVENT_TICK_1S = 2,
    EVENT_FN_BOTTOM_KNOB = 3,
    EVENT_HOST_RPC = 4,
    EVENT_KEY_DOWN = 5,
    EVENT_KEY_UP = 6,
    EVENT_KEY_HOLD = 7,
    EVENT_CHORD_DOWN = 8,
    EVENT_CHORD_UP = 9,
    EVENT_TICK_1MS = 10,
} event_id;

#define MAX_EVENT_HANDLERS FRAMER_MQJS_MAX_BINDINGS

typedef struct {
    uint8_t registered;
    uint8_t kind;
    uint16_t id;
    JSGCRef callback;
} event_handler;

typedef struct {
    uint8_t kind;
    uint16_t id;
} event_selector;

typedef struct {
    uint32_t timestamp_ms;
    uint8_t key;
    uint8_t pressed;
    uint8_t reserved[2];
} input_queue_record;

typedef struct {
    uint32_t raw_changed_ms;
    uint32_t next_hold_ms;
    uint16_t hold_count;
    uint8_t raw_pressed;
    uint8_t stable_pressed;
} input_key_state;

typedef struct {
    event_selector selector;
    uint32_t sequence;
    uint32_t timestamp_ms;
    int32_t value;
    int32_t auxiliary;
    uint16_t held_mask;
    uint16_t hold_count;
    int16_t key;
    int16_t chord;
    uint8_t synthetic;
    uint8_t repeat;
    uint8_t reason;
} native_event;

typedef struct {
    uint32_t marker;
    JSContext *ctx;
    void *heap;
    size_t heap_bytes;
    framer_mqjs_config config;
    event_handler handlers[MAX_EVENT_HANDLERS];
    input_queue_record input_queue[FRAMER_MQJS_INPUT_QUEUE_RECORDS];
    native_event input_pending_events[FRAMER_MQJS_INPUT_PENDING_EVENTS];
    input_key_state keys[FRAMER_MQJS_MAX_KEYS];
    volatile uint32_t input_head;
    volatile uint32_t input_tail;
    volatile uint32_t producer_held_mask;
    volatile uint32_t input_resync_pending;
    volatile uint32_t input_resync_reason;
    volatile uint32_t input_resync_sequence;
    volatile uint32_t input_terminal_release;
    volatile uint32_t input_terminal_reason;
    volatile uint32_t input_terminal_timestamp_ms;
    volatile uint32_t input_queue_overflows;
    volatile uint32_t producer_duplicate_levels;
    volatile uint32_t input_ingress_enabled;
    volatile uint32_t input_producer_active;
    volatile uint32_t observation_guard;
    volatile uint32_t observation_token;
    volatile uint32_t observation_timestamp_ms;
    volatile uint32_t observation_sequence;
    volatile uint32_t observation_pressed;
    volatile uint32_t producer_last_timestamp_ms;
    uint32_t last_input_timestamp_ms;
    uint32_t event_sequence;
    uint32_t input_events_this_drain;
    uint32_t input_logical_events_this_batch;
    int32_t input_pending_error;
    uint16_t held_mask;
    int8_t active_chord;
    uint8_t hold_cursor;
    uint8_t input_pending_head;
    uint8_t input_pending_tail;
    uint8_t input_pending_count;
    volatile uint32_t producer_has_timestamp;
    uint8_t consumer_has_timestamp;
    uint8_t loading;
    uint8_t in_callback;
    uint8_t commit_requested;
    uint8_t deadline_active;
    uint8_t deadline_hit;
    uint8_t has_last_good_source;
    const char *last_good_source;
    size_t last_good_source_len;
    uint64_t deadline_at_us;
    int32_t pending_slots[FRAMER_MQJS_SLOT_COUNT];
    int32_t last_good_slots[FRAMER_MQJS_SLOT_COUNT];
    framer_mqjs_telemetry telemetry;
    /* DIAG ONLY: last classified exception as printable ASCII. Trailing member
     * with alignment 1, so every other field keeps its release offset. */
    char last_error[FRAMER_MQJS_DIAG_LAST_ERROR_BYTES];
} runtime_state;

#define RUNTIME_MARKER 0x4d514a53u

_Static_assert(sizeof(runtime_state) <= FRAMER_MQJS_RUNTIME_STORAGE_BYTES,
               "FRAMER_MQJS_RUNTIME_STORAGE_BYTES is too small");
/* The loader reads this buffer with aligned 32-bit DRAM loads. */
_Static_assert((offsetof(runtime_state, last_error) & 3u) == 0u &&
                   (FRAMER_MQJS_DIAG_LAST_ERROR_BYTES & 3u) == 0u,
               "diag last_error must stay word aligned and word sized");

static runtime_state *state_of(framer_mqjs_runtime *runtime)
{
    runtime_state *state = (runtime_state *)(void *)runtime->bytes;
    return state->marker == RUNTIME_MARKER ? state : NULL;
}

static const runtime_state *const_state_of(const framer_mqjs_runtime *runtime)
{
    const runtime_state *state = (const runtime_state *)(const void *)runtime->bytes;
    return state->marker == RUNTIME_MARKER ? state : NULL;
}

static int is_owner_thread(runtime_state *state)
{
    return state->config.current_thread_token(state->config.opaque) ==
           state->config.owner_thread_token;
}

static void sample_memory(runtime_state *state)
{
    uint32_t heap_used;
    uint32_t stack_used;
    uint32_t free_bytes;

    if (state->ctx == NULL)
        return;
    heap_used = (uint32_t)(state->ctx->heap_free - state->ctx->heap_base);
    stack_used = (uint32_t)(state->ctx->stack_top - (uint8_t *)state->ctx->sp);
    free_bytes = (uint32_t)((uint8_t *)state->ctx->sp - state->ctx->heap_free);
    state->telemetry.heap_used_bytes = heap_used;
    state->telemetry.stack_used_bytes = stack_used;
    state->telemetry.free_bytes = free_bytes;
    if (heap_used > state->telemetry.heap_high_water_bytes)
        state->telemetry.heap_high_water_bytes = heap_used;
    if (stack_used > state->telemetry.stack_high_water_bytes)
        state->telemetry.stack_high_water_bytes = stack_used;
    if (state->telemetry.minimum_free_bytes == 0 ||
        free_bytes < state->telemetry.minimum_free_bytes)
        state->telemetry.minimum_free_bytes = free_bytes;
}

static int interrupt_handler(JSContext *ctx, void *opaque)
{
    runtime_state *state = opaque;
    uint64_t now;
    (void)ctx;
    state->telemetry.interrupt_polls++;
    sample_memory(state);
    if (!state->deadline_active)
        return 0;
    now = state->config.now_us(state->config.opaque);
    if (now >= state->deadline_at_us) {
        state->deadline_hit = 1;
        return 1;
    }
    return 0;
}

/* DIAG: the initial source load (parse + top-level run of a ~6.5 KB script
 * from flash-cached code at 240 MHz) needs far more than the 2 ms callback
 * budget; live device result was ERR_TIMEOUT "callback deadline expired".
 * Use a separate generous budget while state->loading is set. */
#define FRAMER_MQJS_DIAG_LOAD_DEADLINE_US 3000000u

static void begin_deadline(runtime_state *state)
{
    uint64_t now = state->config.now_us(state->config.opaque);
    uint64_t delta = state->loading ? (uint64_t)FRAMER_MQJS_DIAG_LOAD_DEADLINE_US
                                    : state->config.callback_deadline_us;
    state->deadline_at_us = UINT64_MAX - now < delta ? UINT64_MAX : now + delta;
    state->deadline_hit = 0;
    state->deadline_active = 1;
}

static void end_deadline(runtime_state *state)
{
    state->deadline_active = 0;
}

static int parse_host_rpc_id(const char *text, uint16_t *result)
{
    uint32_t value = 0;
    unsigned int digits = 0;
    unsigned int base = 10;
    if (text[0] == '0' && (text[1] == 'x' || text[1] == 'X')) {
        base = 16;
        text += 2;
    }
    while (*text != '\0') {
        unsigned int digit;
        if (*text >= '0' && *text <= '9')
            digit = (unsigned int)(*text - '0');
        else if (base == 16 && *text >= 'a' && *text <= 'f')
            digit = (unsigned int)(*text - 'a') + 10u;
        else if (base == 16 && *text >= 'A' && *text <= 'F')
            digit = (unsigned int)(*text - 'A') + 10u;
        else
            return 0;
        if (digit >= base || value > (65535u - digit) / base)
            return 0;
        value = value * base + digit;
        digits++;
        text++;
    }
    if (digits == 0 || value == 0)
        return 0;
    *result = (uint16_t)value;
    return 1;
}

static int event_from_name(const char *name, event_selector *selector)
{
    static const char host_prefix[] = "host.rpc:";
    if (name == NULL || selector == NULL)
        return 0;
    selector->id = 0;
    if (strcmp(name, "tick.1ms") == 0)
        selector->kind = EVENT_TICK_1MS;
    else if (strcmp(name, "tick.100ms") == 0)
        selector->kind = EVENT_TICK_100MS;
    else if (strcmp(name, "tick.1s") == 0)
        selector->kind = EVENT_TICK_1S;
    else if (strcmp(name, "input.fn-bottom-knob") == 0)
        selector->kind = EVENT_FN_BOTTOM_KNOB;
    else if (strcmp(name, "input.key.down") == 0)
        selector->kind = EVENT_KEY_DOWN;
    else if (strcmp(name, "input.key.up") == 0)
        selector->kind = EVENT_KEY_UP;
    else if (strcmp(name, "input.key.hold") == 0)
        selector->kind = EVENT_KEY_HOLD;
    else if (strcmp(name, "input.chord.down") == 0)
        selector->kind = EVENT_CHORD_DOWN;
    else if (strcmp(name, "input.chord.up") == 0)
        selector->kind = EVENT_CHORD_UP;
    else if (strncmp(name, host_prefix, sizeof(host_prefix) - 1u) == 0 &&
             parse_host_rpc_id(name + sizeof(host_prefix) - 1u, &selector->id))
        selector->kind = EVENT_HOST_RPC;
    else
        return 0;
    return 1;
}

static event_handler *find_handler(runtime_state *state,
                                   const event_selector *selector)
{
    int i;
    for (i = 0; i < MAX_EVENT_HANDLERS; i++) {
        if (state->handlers[i].registered &&
            state->handlers[i].kind == selector->kind &&
            state->handlers[i].id == selector->id)
            return &state->handlers[i];
    }
    return NULL;
}

static JSValue js_framer_on(JSContext *ctx, JSValue *this_val,
                            int argc, JSValue *argv)
{
    runtime_state *state = JS_GetContextOpaque(ctx);
    JSCStringBuf string_buffer;
    const char *name;
    event_selector selector;
    event_handler *handler;
    int i;
    (void)this_val;
    if (!state->loading)
        return JS_ThrowTypeError(ctx, "widget.on is only allowed while loading");
    if (argc != 2 || !JS_IsString(ctx, argv[0]) || !JS_IsFunction(ctx, argv[1]))
        return JS_ThrowTypeError(ctx, "widget.on expects an event name and function");
    name = JS_ToCString(ctx, argv[0], &string_buffer);
    if (!event_from_name(name, &selector))
        return JS_ThrowRangeError(ctx, "unsupported widget event");
    handler = find_handler(state, &selector);
    if (handler == NULL) {
        for (i = 0; i < MAX_EVENT_HANDLERS; i++) {
            if (!state->handlers[i].registered) {
                handler = &state->handlers[i];
                handler->registered = 1;
                handler->kind = selector.kind;
                handler->id = selector.id;
                JS_AddGCRef(ctx, &handler->callback);
                break;
            }
        }
    }
    if (handler == NULL)
        return JS_ThrowRangeError(ctx, "widget handler budget exceeds 16");
    handler->callback.val = argv[1];
    return JS_UNDEFINED;
}

static int callback_slot(JSContext *ctx, int argc, JSValue *argv, int *slot)
{
    if (argc < 1 || JS_ToInt32(ctx, slot, argv[0]))
        return -1;
    if (*slot < 0 || *slot >= (int)FRAMER_MQJS_SLOT_COUNT) {
        JS_ThrowRangeError(ctx, "Framer slot is outside 0..15");
        return -1;
    }
    return 0;
}

static JSValue js_framer_get_int(JSContext *ctx, JSValue *this_val,
                                 int argc, JSValue *argv)
{
    runtime_state *state = JS_GetContextOpaque(ctx);
    int slot;
    (void)this_val;
    if (!state->in_callback)
        return JS_ThrowTypeError(ctx, "widget.getInt requires an event callback");
    if (callback_slot(ctx, argc, argv, &slot))
        return JS_EXCEPTION;
    return JS_NewInt32(ctx, state->pending_slots[slot]);
}

static JSValue js_framer_set_int(JSContext *ctx, JSValue *this_val,
                                 int argc, JSValue *argv)
{
    runtime_state *state = JS_GetContextOpaque(ctx);
    int slot;
    int value;
    (void)this_val;
    if (!state->in_callback)
        return JS_ThrowTypeError(ctx, "widget.setInt requires an event callback");
    if (argc != 2 || callback_slot(ctx, argc, argv, &slot) ||
        JS_ToInt32(ctx, &value, argv[1]))
        return JS_EXCEPTION;
    state->pending_slots[slot] = value;
    return JS_UNDEFINED;
}

static JSValue js_framer_commit(JSContext *ctx, JSValue *this_val,
                                int argc, JSValue *argv)
{
    runtime_state *state = JS_GetContextOpaque(ctx);
    (void)this_val;
    (void)argc;
    (void)argv;
    if (!state->in_callback)
        return JS_ThrowTypeError(ctx, "widget.commit requires an event callback");
    state->commit_requested = 1;
    return JS_UNDEFINED;
}

static JSValue js_framer_is_held(JSContext *ctx, JSValue *this_val,
                                 int argc, JSValue *argv)
{
    runtime_state *state = JS_GetContextOpaque(ctx);
    JSValue held_value;
    uint32_t held_mask;
    int key;
    (void)this_val;
    if (!state->in_callback)
        return JS_ThrowTypeError(ctx, "widget.isHeld requires an event callback");
    if (argc != 2 || JS_ToInt32(ctx, &key, argv[1]) || key < 0 ||
        key >= state->config.input.key_count)
        return JS_ThrowRangeError(ctx, "widget.isHeld key is outside admitted input keys");
    held_value = JS_GetPropertyStr(ctx, argv[0], "heldMask");
    if (JS_IsException(held_value) || JS_ToUint32(ctx, &held_mask, held_value))
        return JS_ThrowTypeError(ctx, "widget.isHeld expects an event snapshot");
    return JS_NewBool((held_mask & (1u << key)) != 0u);
}

#include "framer_stdlib.h"

static void release_context(runtime_state *state)
{
    int i;
    if (state->ctx == NULL)
        return;
    for (i = 0; i < MAX_EVENT_HANDLERS; i++) {
        if (state->handlers[i].registered)
            JS_DeleteGCRef(state->ctx, &state->handlers[i].callback);
        state->handlers[i].registered = 0;
    }
    JS_FreeContext(state->ctx);
    state->ctx = NULL;
    state->loading = 0;
    state->in_callback = 0;
    state->deadline_active = 0;
}

static void create_context(runtime_state *state)
{
    state->ctx = JS_NewContext(state->heap, state->heap_bytes, &js_stdlib);
    JS_SetContextOpaque(state->ctx, state);
    JS_SetInterruptHandler(state->ctx, interrupt_handler);
}

/* DIAG ONLY. Bounded, always NUL-terminated, non-printable bytes folded to
 * '.'. No libc call and no allocation: `at` is the current write cursor and the
 * new cursor is returned. `limit` caps how much of one source string is kept so
 * a long message cannot crowd out the stack line that follows it. */
static uint32_t diag_error_append(runtime_state *state, uint32_t at,
                                  const char *text, uint32_t limit)
{
    uint32_t taken = 0u;
    if (text == NULL)
        return at;
    while (at + 1u < FRAMER_MQJS_DIAG_LAST_ERROR_BYTES && taken < limit &&
           text[taken] != '\0') {
        unsigned char value = (unsigned char)text[taken];
        state->last_error[at] = (value >= 0x20u && value < 0x7fu)
                                    ? (char)value
                                    : '.';
        at++;
        taken++;
    }
    state->last_error[at] = '\0';
    return at;
}

static framer_mqjs_result classify_exception(runtime_state *state)
{
    JSGCRef exception_ref;
    JSValue *exception;
    JSValue message;
    JSValue name;
    JSValue stack;
    JSCStringBuf buffer;
    const char *text = NULL;
    uint32_t at = 0u;
    int out_of_memory = 0;

    state->last_error[0] = '\0';
    if (state->deadline_hit) {
        (void)JS_GetException(state->ctx);
        (void)diag_error_append(state, 0u, "callback deadline expired",
                                FRAMER_MQJS_DIAG_LAST_ERROR_BYTES);
        return FRAMER_MQJS_ERR_TIMEOUT;
    }
    /* The exception is rooted while its properties are read: JS_GetPropertyStr
     * may collect, and the pinned collector moves objects. */
    exception = JS_PushGCRef(state->ctx, &exception_ref);
    *exception = JS_GetException(state->ctx);
    if (JS_IsNull(*exception)) {
        (void)JS_PopGCRef(state->ctx, &exception_ref);
        (void)diag_error_append(state, 0u, "null exception (engine heap)",
                                FRAMER_MQJS_DIAG_LAST_ERROR_BYTES);
        return FRAMER_MQJS_ERR_OOM;
    }
    if (JS_IsError(state->ctx, *exception)) {
        name = JS_GetPropertyStr(state->ctx, *exception, "name");
        if (JS_IsString(state->ctx, name)) {
            at = diag_error_append(state, at,
                                   JS_ToCString(state->ctx, name, &buffer), 24u);
            at = diag_error_append(state, at, ": ", 2u);
        }
        message = JS_GetPropertyStr(state->ctx, *exception, "message");
        if (JS_IsString(state->ctx, message))
            text = JS_ToCString(state->ctx, message, &buffer);
        if (text != NULL) {
            if (strcmp(text, "out of memory") == 0)
                out_of_memory = 1;
            at = diag_error_append(state, at, text, 64u);
        }
        /* Error.prototype exposes only name/message in the pinned stdlib, so
         * the captured stack comes from the engine getter directly (magic 1).
         * It allocates nothing and cannot throw for a proven Error object. */
        stack = js_error_get_message(state->ctx, exception, 0, NULL, 1);
        if (JS_IsString(state->ctx, stack)) {
            at = diag_error_append(state, at, " @", 2u);
            (void)diag_error_append(state, at,
                                    JS_ToCString(state->ctx, stack, &buffer),
                                    FRAMER_MQJS_DIAG_LAST_ERROR_BYTES);
        }
        (void)JS_PopGCRef(state->ctx, &exception_ref);
        if (out_of_memory)
            return FRAMER_MQJS_ERR_OOM;
        return FRAMER_MQJS_ERR_EXCEPTION;
    }
    at = diag_error_append(state, at, "thrown: ", 8u);
    (void)diag_error_append(state, at,
                            JS_ToCString(state->ctx, *exception, &buffer),
                            FRAMER_MQJS_DIAG_LAST_ERROR_BYTES);
    (void)JS_PopGCRef(state->ctx, &exception_ref);
    return FRAMER_MQJS_ERR_EXCEPTION;
}

static void record_failure(runtime_state *state, framer_mqjs_result result)
{
    if (result == FRAMER_MQJS_ERR_TIMEOUT)
        state->telemetry.timeouts++;
    else if (result == FRAMER_MQJS_ERR_OOM)
        state->telemetry.out_of_memory++;
    else
        state->telemetry.exceptions++;
    state->telemetry.last_result = result;
}

static framer_mqjs_result evaluate(runtime_state *state,
                                   const char *source,
                                   size_t source_len)
{
    JSValue result;
    framer_mqjs_result status;
    state->loading = 1;
    begin_deadline(state);
    result = JS_Eval(state->ctx, source, source_len, "widget.js",
                     JS_EVAL_STRIP_COL);
    end_deadline(state);
    state->loading = 0;
    sample_memory(state);
    if (JS_IsException(result)) {
        status = classify_exception(state);
        record_failure(state, status);
        return status;
    }
    if (find_handler(state, &(event_selector){ EVENT_TICK_1MS, 0 }) == NULL &&
        find_handler(state, &(event_selector){ EVENT_TICK_100MS, 0 }) == NULL &&
        find_handler(state, &(event_selector){ EVENT_TICK_1S, 0 }) == NULL &&
        find_handler(state, &(event_selector){ EVENT_FN_BOTTOM_KNOB, 0 }) == NULL) {
        int found = 0;
        int i;
        for (i = 0; i < MAX_EVENT_HANDLERS; i++)
            found |= state->handlers[i].registered;
        if (found)
            return FRAMER_MQJS_OK;
        state->telemetry.exceptions++;
        state->telemetry.last_result = FRAMER_MQJS_ERR_SOURCE;
        return FRAMER_MQJS_ERR_SOURCE;
    }
    return FRAMER_MQJS_OK;
}

static int recover_last_good(runtime_state *state)
{
    framer_mqjs_result status;
    if (!state->has_last_good_source) {
        release_context(state);
        state->telemetry.enabled = 0;
        return 0;
    }
    release_context(state);
    create_context(state);
    status = evaluate(state, state->last_good_source,
                      state->last_good_source_len);
    state->telemetry.resets++;
    if (status != FRAMER_MQJS_OK) {
        release_context(state);
        state->telemetry.enabled = 0;
        return 0;
    }
    state->telemetry.enabled = 1;
    return 1;
}

static unsigned int bit_count16(uint16_t value)
{
    unsigned int count = 0;
    while (value != 0u) {
        count += value & 1u;
        value >>= 1;
    }
    return count;
}

static int input_config_valid(const framer_mqjs_input_config *input)
{
    unsigned int i;
    unsigned int j;
    uint32_t admitted_mask;
    if (input->key_count == 0u)
        return input->chord_count == 0u && input->debounce_ms == 0u &&
               input->hold_delay_ms == 0u && input->hold_cadence_ms == 0u;
    if (input->key_count > FRAMER_MQJS_MAX_KEYS ||
        input->chord_count > FRAMER_MQJS_MAX_CHORDS ||
        input->debounce_ms == 0u || input->debounce_ms > 50u ||
        input->hold_delay_ms < 100u || input->hold_delay_ms > 5000u ||
        input->hold_cadence_ms < 20u || input->hold_cadence_ms > 1000u)
        return 0;
    for (i = 0; i < input->key_count; i++)
        for (j = i + 1u; j < input->key_count; j++)
            if (input->native_tokens[i] == input->native_tokens[j])
                return 0;
    admitted_mask = input->key_count == 16u ? 0xffffu :
                    (1u << input->key_count) - 1u;
    for (i = 0; i < input->chord_count; i++) {
        uint16_t mask = input->chord_masks[i];
        unsigned int bits = bit_count16(mask);
        if (((uint32_t)mask & ~admitted_mask) != 0u || bits < 2u || bits > 4u)
            return 0;
        for (j = i + 1u; j < input->chord_count; j++)
            if (mask == input->chord_masks[j])
                return 0;
    }
    return 1;
}

framer_mqjs_result framer_mqjs_init(framer_mqjs_runtime *runtime,
                                    void *heap,
                                    size_t heap_bytes,
                                    const framer_mqjs_config *config)
{
    runtime_state *state;
    if (runtime == NULL || heap == NULL || config == NULL ||
        config->now_us == NULL || config->current_thread_token == NULL ||
        config->publish == NULL || config->callback_deadline_us == 0 ||
        !input_config_valid(&config->input) ||
        heap_bytes < FRAMER_MQJS_MIN_HEAP_BYTES ||
        heap_bytes > UINT32_MAX ||
        ((uintptr_t)heap & 7u) != 0)
        return FRAMER_MQJS_ERR_ARGUMENT;
    memset(runtime, 0, sizeof(*runtime));
    state = (runtime_state *)(void *)runtime->bytes;
    state->marker = RUNTIME_MARKER;
    state->heap = heap;
    state->heap_bytes = heap_bytes;
    state->config = *config;
    state->active_chord = -1;
    state->input_ingress_enabled = 1u;
    state->telemetry.heap_capacity_bytes = (uint32_t)heap_bytes;
    state->telemetry.minimum_free_bytes = (uint32_t)heap_bytes;
    state->telemetry.last_result = FRAMER_MQJS_OK;
    create_context(state);
    sample_memory(state);
    return FRAMER_MQJS_OK;
}

framer_mqjs_result framer_mqjs_load(framer_mqjs_runtime *runtime,
                                    const char *source,
                                    size_t source_len,
                                    int admitted)
{
    runtime_state *state;
    const char *previous_source;
    size_t previous_len;
    uint8_t had_previous;
    framer_mqjs_result status;

    if (runtime == NULL || source == NULL || source_len == 0 ||
        source[source_len] != '\0')
        return FRAMER_MQJS_ERR_ARGUMENT;
    state = state_of(runtime);
    if (state == NULL)
        return FRAMER_MQJS_ERR_ARGUMENT;
    if (!is_owner_thread(state)) {
        state->telemetry.wrong_thread++;
        state->telemetry.last_result = FRAMER_MQJS_ERR_WRONG_THREAD;
        return FRAMER_MQJS_ERR_WRONG_THREAD;
    }
    if (!admitted) {
        state->telemetry.source_rejections++;
        state->telemetry.last_result = FRAMER_MQJS_ERR_NOT_ADMITTED;
        return FRAMER_MQJS_ERR_NOT_ADMITTED;
    }
    if (state->input_pending_count != 0u)
        return FRAMER_MQJS_INPUT_MORE_PENDING;
    if (source_len < STRICT_SOURCE_PREFIX_BYTES ||
        memcmp(source, STRICT_SOURCE_PREFIX, STRICT_SOURCE_PREFIX_BYTES) != 0) {
        state->telemetry.source_rejections++;
        state->telemetry.last_result = FRAMER_MQJS_ERR_SOURCE;
        return FRAMER_MQJS_ERR_SOURCE;
    }
    previous_source = state->last_good_source;
    previous_len = state->last_good_source_len;
    had_previous = state->has_last_good_source;
    release_context(state);
    create_context(state);
    status = evaluate(state, source, source_len);
    if (status != FRAMER_MQJS_OK) {
        state->last_good_source = previous_source;
        state->last_good_source_len = previous_len;
        state->has_last_good_source = had_previous;
        (void)recover_last_good(state);
        return status;
    }
    state->last_good_source = source;
    state->last_good_source_len = source_len;
    state->has_last_good_source = 1;
    state->telemetry.source_loads++;
    state->telemetry.enabled = 1;
    state->telemetry.last_result = FRAMER_MQJS_OK;
    return FRAMER_MQJS_OK;
}

static const char *event_type_name(uint8_t kind)
{
    if (kind == EVENT_TICK_1MS) return "tick.1ms";
    if (kind == EVENT_TICK_100MS) return "tick.100ms";
    if (kind == EVENT_TICK_1S) return "tick.1s";
    if (kind == EVENT_FN_BOTTOM_KNOB) return "input.fn-bottom-knob";
    if (kind == EVENT_HOST_RPC) return "host.rpc";
    if (kind == EVENT_KEY_DOWN) return "input.key.down";
    if (kind == EVENT_KEY_UP) return "input.key.up";
    if (kind == EVENT_KEY_HOLD) return "input.key.hold";
    if (kind == EVENT_CHORD_DOWN) return "input.chord.down";
    if (kind == EVENT_CHORD_UP) return "input.chord.up";
    return "unknown";
}

static int set_event_property(JSContext *ctx, JSValue *object,
                              const char *name, JSValue value)
{
    return JS_IsException(JS_SetPropertyStr(ctx, *object, name, value));
}

static int create_event_object(runtime_state *state,
                               const native_event *event,
                               JSGCRef *object_ref,
                               JSValue **object_root)
{
    JSContext *ctx = state->ctx;
    JSValue object;
    int failed;
    *object_root = JS_PushGCRef(ctx, object_ref);
    **object_root = JS_UNDEFINED;
    object = JS_NewObject(ctx);
    **object_root = object;
    if (JS_IsException(object))
        return 0;
    failed = set_event_property(ctx, *object_root, "type",
                           JS_NewString(ctx, event_type_name(event->selector.kind))) ||
        set_event_property(ctx, *object_root, "sequence",
                           JS_NewUint32(ctx, event->sequence)) ||
        set_event_property(ctx, *object_root, "timestampMs",
                           JS_NewUint32(ctx, event->timestamp_ms)) ||
        set_event_property(ctx, *object_root, "heldMask",
                           JS_NewInt32(ctx, event->held_mask)) ||
        set_event_property(ctx, *object_root, "synthetic",
                           JS_NewBool(event->synthetic));
    if (!failed && (event->selector.kind == EVENT_TICK_1MS ||
                    event->selector.kind == EVENT_TICK_100MS ||
                    event->selector.kind == EVENT_TICK_1S)) {
        failed = set_event_property(ctx, *object_root, "value", JS_NewInt32(ctx, event->value)) ||
            set_event_property(ctx, *object_root, "auxiliary",
                               JS_NewInt32(ctx, event->auxiliary));
    } else if (!failed && event->selector.kind == EVENT_FN_BOTTOM_KNOB) {
        failed = set_event_property(ctx, *object_root, "delta", JS_NewInt32(ctx, event->value)) ||
            set_event_property(ctx, *object_root, "fn", JS_NewBool(1)) ||
            set_event_property(ctx, *object_root, "auxiliary",
                               JS_NewInt32(ctx, event->auxiliary));
    } else if (!failed && event->selector.kind == EVENT_HOST_RPC) {
        failed = set_event_property(ctx, *object_root, "id",
                               JS_NewInt32(ctx, event->selector.id)) ||
            set_event_property(ctx, *object_root, "value", JS_NewInt32(ctx, event->value)) ||
            set_event_property(ctx, *object_root, "auxiliary",
                               JS_NewInt32(ctx, event->auxiliary));
    } else if (!failed && (event->selector.kind == EVENT_KEY_DOWN ||
               event->selector.kind == EVENT_KEY_UP ||
               event->selector.kind == EVENT_KEY_HOLD)) {
        failed = set_event_property(ctx, *object_root, "key", JS_NewInt32(ctx, event->key)) ||
            set_event_property(ctx, *object_root, "repeat", JS_NewBool(event->repeat)) ||
            set_event_property(ctx, *object_root, "holdCount",
                               JS_NewInt32(ctx, event->hold_count)) ||
            set_event_property(ctx, *object_root, "reason",
                               JS_NewInt32(ctx, event->reason));
    } else if (!failed) {
        failed = set_event_property(ctx, *object_root, "chord",
                               JS_NewInt32(ctx, event->chord)) ||
            set_event_property(ctx, *object_root, "reason",
                               JS_NewInt32(ctx, event->reason));
    }
    return !failed;
}

static framer_mqjs_result dispatch_native_event(runtime_state *state,
                                                native_event *event)
{
    event_handler *handler;
    JSGCRef event_object_ref;
    JSValue *event_object;
    JSValue result;
    framer_mqjs_result status;
    uint32_t revision;

    if (!state->telemetry.enabled || state->ctx == NULL)
        return FRAMER_MQJS_ERR_DISABLED;
    if (state->event_sequence == UINT32_MAX) {
        state->telemetry.enabled = 0;
        state->telemetry.last_result = FRAMER_MQJS_ERR_SEQUENCE;
        return FRAMER_MQJS_ERR_SEQUENCE;
    }
    event->sequence = ++state->event_sequence;
    state->telemetry.last_event_sequence = event->sequence;
    state->telemetry.held_key_mask = event->held_mask;
    if (event->selector.kind == EVENT_KEY_DOWN) state->telemetry.key_down_events++;
    else if (event->selector.kind == EVENT_KEY_UP) state->telemetry.key_up_events++;
    else if (event->selector.kind == EVENT_KEY_HOLD) state->telemetry.key_hold_events++;
    else if (event->selector.kind == EVENT_CHORD_DOWN) state->telemetry.chord_down_events++;
    else if (event->selector.kind == EVENT_CHORD_UP) state->telemetry.chord_up_events++;
    handler = find_handler(state, &event->selector);
    if (handler == NULL)
        return FRAMER_MQJS_NO_HANDLER;

    memcpy(state->pending_slots, state->last_good_slots,
           sizeof(state->pending_slots));
    state->commit_requested = 0;
    state->in_callback = 1;
    begin_deadline(state);
    if (!create_event_object(state, event, &event_object_ref, &event_object) ||
        JS_StackCheck(state->ctx, 3)) {
        (void)JS_PopGCRef(state->ctx, &event_object_ref);
        result = JS_EXCEPTION;
    } else {
        JS_PushArg(state->ctx, *event_object);
        (void)JS_PopGCRef(state->ctx, &event_object_ref);
        JS_PushArg(state->ctx, handler->callback.val);
        JS_PushArg(state->ctx, JS_NULL);
        result = JS_Call(state->ctx, 1);
    }
    end_deadline(state);
    state->in_callback = 0;
    state->telemetry.callbacks++;
    sample_memory(state);
    if (JS_IsException(result)) {
        status = classify_exception(state);
        record_failure(state, status);
        (void)recover_last_good(state);
        return status;
    }
    if (!state->commit_requested) {
        state->telemetry.last_result = FRAMER_MQJS_OK;
        return FRAMER_MQJS_OK;
    }
    if (state->telemetry.last_good_revision == UINT32_MAX) {
        state->telemetry.enabled = 0;
        state->telemetry.last_result = FRAMER_MQJS_ERR_SEQUENCE;
        return FRAMER_MQJS_ERR_SEQUENCE;
    }
    revision = state->telemetry.last_good_revision + 1u;
    if (!state->config.publish(state->config.opaque, state->pending_slots,
                               revision)) {
        state->telemetry.publish_failures++;
        state->telemetry.last_result = FRAMER_MQJS_ERR_PUBLISH;
        (void)recover_last_good(state);
        return FRAMER_MQJS_ERR_PUBLISH;
    }
    memcpy(state->last_good_slots, state->pending_slots,
           sizeof(state->last_good_slots));
    state->telemetry.last_good_revision = revision;
    state->telemetry.commits++;
    state->telemetry.last_result = FRAMER_MQJS_OK;
    return FRAMER_MQJS_OK;
}

static framer_mqjs_result stage_native_event(runtime_state *state,
                                             const native_event *event)
{
    if (state->input_pending_count >= FRAMER_MQJS_INPUT_PENDING_EVENTS) {
        state->telemetry.enabled = 0;
        state->telemetry.last_result = FRAMER_MQJS_ERR_SEQUENCE;
        return FRAMER_MQJS_ERR_SEQUENCE;
    }
    state->input_pending_events[state->input_pending_head] = *event;
    state->input_pending_head = (uint8_t)((state->input_pending_head + 1u) %
                                         FRAMER_MQJS_INPUT_PENDING_EVENTS);
    state->input_pending_count++;
    state->telemetry.pending_input_events = state->input_pending_count;
    if (state->input_pending_count > state->telemetry.max_input_pending_events)
        state->telemetry.max_input_pending_events = state->input_pending_count;
    return FRAMER_MQJS_OK;
}

static framer_mqjs_result dispatch_staged_iteration(runtime_state *state,
                                                    framer_mqjs_result base)
{
    unsigned int attempted = 0u;
    if (base < 0 && state->input_pending_error == FRAMER_MQJS_OK)
        state->input_pending_error = base;
    while (state->input_pending_count != 0u &&
           attempted < FRAMER_MQJS_INPUT_CALLBACKS_PER_ITERATION) {
        native_event event = state->input_pending_events[state->input_pending_tail];
        framer_mqjs_result result;
        state->input_pending_tail = (uint8_t)((state->input_pending_tail + 1u) %
                                             FRAMER_MQJS_INPUT_PENDING_EVENTS);
        state->input_pending_count--;
        state->telemetry.pending_input_events = state->input_pending_count;
        result = dispatch_native_event(state, &event);
        attempted++;
        state->input_events_this_drain++;
        /* Recovery evaluates the admitted source under its own deadline. Stop
         * after the first failed callback so one owner call can contain at
         * most one failed 2 ms callback plus one 2 ms recovery. The failed
         * snapshot is consumed; every later snapshot remains FIFO for the
         * next owner iteration. */
        if (result < 0) {
            if (state->input_events_this_drain >
                state->telemetry.max_input_events_per_drain)
                state->telemetry.max_input_events_per_drain =
                    state->input_events_this_drain;
            if (state->input_pending_count != 0u) {
                state->telemetry.input_callback_budget_yields++;
                state->telemetry.input_drain_more_pending++;
            }
            state->telemetry.last_result = result;
            return result;
        }
    }
    if (state->input_events_this_drain >
        state->telemetry.max_input_events_per_drain)
        state->telemetry.max_input_events_per_drain =
            state->input_events_this_drain;
    if (state->input_pending_count != 0u) {
        state->telemetry.input_callback_budget_yields++;
        state->telemetry.input_drain_more_pending++;
        return FRAMER_MQJS_INPUT_MORE_PENDING;
    }
    if (state->input_pending_error < 0) {
        framer_mqjs_result error = (framer_mqjs_result)state->input_pending_error;
        state->input_pending_error = FRAMER_MQJS_OK;
        state->telemetry.last_result = error;
        return error;
    }
    if (base == FRAMER_MQJS_INPUT_MORE_PENDING) {
        state->telemetry.input_drain_more_pending++;
        return base;
    }
    return base;
}

framer_mqjs_result framer_mqjs_dispatch(framer_mqjs_runtime *runtime,
                                        const char *event_name,
                                        int32_t value,
                                        int32_t auxiliary)
{
    runtime_state *state;
    native_event event;
    uint64_t now_us;
    if (runtime == NULL)
        return FRAMER_MQJS_ERR_ARGUMENT;
    state = state_of(runtime);
    if (state == NULL)
        return FRAMER_MQJS_ERR_ARGUMENT;
    if (!is_owner_thread(state)) {
        state->telemetry.wrong_thread++;
        state->telemetry.last_result = FRAMER_MQJS_ERR_WRONG_THREAD;
        return FRAMER_MQJS_ERR_WRONG_THREAD;
    }
    memset(&event, 0, sizeof(event));
    if (!event_from_name(event_name, &event.selector) ||
        (event.selector.kind >= EVENT_KEY_DOWN &&
         event.selector.kind <= EVENT_CHORD_UP))
        return FRAMER_MQJS_ERR_ARGUMENT;
    now_us = state->config.now_us(state->config.opaque);
    event.timestamp_ms = (uint32_t)(now_us / 1000u);
    event.value = value;
    event.auxiliary = auxiliary;
    event.held_mask = state->held_mask;
    event.key = -1;
    event.chord = -1;
    if (stage_native_event(state, &event) != FRAMER_MQJS_OK)
        return FRAMER_MQJS_ERR_SEQUENCE;
    state->input_events_this_drain = 0u;
    return dispatch_staged_iteration(state, FRAMER_MQJS_OK);
}

static int key_for_native_token(const runtime_state *state, uint32_t token)
{
    unsigned int key;
    for (key = 0; key < state->config.input.key_count; key++)
        if (state->config.input.native_tokens[key] == token)
            return (int)key;
    return -1;
}

/* All admitted intervals are far below 2^31 ms. Signed subtraction therefore
 * gives a wrap-safe monotonic order across the uint32 millisecond rollover. */
static int input_time_before(uint32_t candidate, uint32_t reference)
{
    return (int32_t)(candidate - reference) < 0;
}

static void record_input_observation(runtime_state *state,
                                     uint32_t native_token,
                                     int pressed,
                                     uint32_t timestamp_ms)
{
    uint32_t guard = __atomic_load_n(&state->observation_guard, __ATOMIC_SEQ_CST);
    uint32_t sequence = __atomic_load_n(&state->observation_sequence,
                                        __ATOMIC_SEQ_CST);
    __atomic_store_n(&state->observation_guard, guard + 1u, __ATOMIC_SEQ_CST);
    __atomic_store_n(&state->observation_token, native_token, __ATOMIC_SEQ_CST);
    __atomic_store_n(&state->observation_timestamp_ms, timestamp_ms,
                     __ATOMIC_SEQ_CST);
    __atomic_store_n(&state->observation_pressed, pressed != 0, __ATOMIC_SEQ_CST);
    if (sequence != UINT32_MAX)
        sequence++;
    __atomic_store_n(&state->observation_sequence, sequence, __ATOMIC_SEQ_CST);
    __atomic_store_n(&state->observation_guard, guard + 2u, __ATOMIC_SEQ_CST);
}

static framer_mqjs_result finish_input_producer(runtime_state *state,
                                                framer_mqjs_result result)
{
    if (__atomic_load_n(&state->input_ingress_enabled, __ATOMIC_ACQUIRE) == 0u)
        __atomic_store_n(&state->producer_held_mask, 0u, __ATOMIC_RELEASE);
    __atomic_sub_fetch(&state->input_producer_active, 1u, __ATOMIC_RELEASE);
    return result;
}

framer_mqjs_result framer_mqjs_input_enqueue(framer_mqjs_runtime *runtime,
                                             uint32_t native_token,
                                             int pressed,
                                             uint32_t timestamp_ms)
{
    runtime_state *state;
    uint32_t has_timestamp;
    uint32_t last_timestamp;
    uint32_t held;
    uint32_t bit;
    uint32_t head;
    uint32_t tail;
    int key;
    if (runtime == NULL || (pressed != 0 && pressed != 1))
        return FRAMER_MQJS_ERR_ARGUMENT;
    state = state_of(runtime);
    if (state == NULL)
        return FRAMER_MQJS_ERR_ARGUMENT;
    if (__atomic_load_n(&state->input_ingress_enabled, __ATOMIC_ACQUIRE) == 0u)
        return FRAMER_MQJS_ERR_DISABLED;
    __atomic_add_fetch(&state->input_producer_active, 1u, __ATOMIC_ACQ_REL);
    if (__atomic_load_n(&state->input_ingress_enabled, __ATOMIC_ACQUIRE) == 0u)
        return finish_input_producer(state, FRAMER_MQJS_ERR_DISABLED);
    has_timestamp = __atomic_load_n(&state->producer_has_timestamp,
                                    __ATOMIC_ACQUIRE);
    last_timestamp = __atomic_load_n(&state->producer_last_timestamp_ms,
                                     __ATOMIC_ACQUIRE);
    if (has_timestamp != 0u &&
        input_time_before(timestamp_ms, last_timestamp))
        return finish_input_producer(state, FRAMER_MQJS_ERR_ARGUMENT);
    __atomic_store_n(&state->producer_last_timestamp_ms, timestamp_ms,
                     __ATOMIC_RELEASE);
    __atomic_store_n(&state->producer_has_timestamp, 1u, __ATOMIC_RELEASE);
    record_input_observation(state, native_token, pressed, timestamp_ms);
    key = key_for_native_token(state, native_token);
    if (key < 0)
        return finish_input_producer(state, FRAMER_MQJS_NO_HANDLER);
    bit = 1u << (unsigned int)key;
    held = __atomic_load_n(&state->producer_held_mask, __ATOMIC_RELAXED);
    if (((held & bit) != 0u) == (pressed != 0)) {
        __atomic_add_fetch(&state->producer_duplicate_levels, 1u,
                           __ATOMIC_RELAXED);
        return finish_input_producer(state, FRAMER_MQJS_OK);
    }
    held = pressed ? held | bit : held & ~bit;
    __atomic_store_n(&state->producer_held_mask, held, __ATOMIC_RELEASE);
    if (__atomic_load_n(&state->input_ingress_enabled, __ATOMIC_ACQUIRE) == 0u) {
        __atomic_store_n(&state->producer_held_mask, 0u, __ATOMIC_RELEASE);
        return finish_input_producer(state, FRAMER_MQJS_ERR_DISABLED);
    }
    if (__atomic_load_n(&state->input_resync_pending, __ATOMIC_ACQUIRE) != 0u)
        return finish_input_producer(state, FRAMER_MQJS_INPUT_RESYNC_QUEUED);
    head = __atomic_load_n(&state->input_head, __ATOMIC_RELAXED);
    tail = __atomic_load_n(&state->input_tail, __ATOMIC_ACQUIRE);
    if (head - tail >= FRAMER_MQJS_INPUT_QUEUE_RECORDS) {
        __atomic_add_fetch(&state->input_queue_overflows, 1u, __ATOMIC_RELAXED);
        __atomic_store_n(&state->input_resync_reason,
                         FRAMER_MQJS_INPUT_REASON_QUEUE_RESYNC, __ATOMIC_RELAXED);
        __atomic_add_fetch(&state->input_resync_sequence, 1u, __ATOMIC_RELAXED);
        __atomic_store_n(&state->input_resync_pending, 1u, __ATOMIC_RELEASE);
        return finish_input_producer(state, FRAMER_MQJS_INPUT_RESYNC_QUEUED);
    }
    state->input_queue[head % FRAMER_MQJS_INPUT_QUEUE_RECORDS] =
        (input_queue_record){ timestamp_ms, (uint8_t)key, (uint8_t)pressed, { 0, 0 } };
    __atomic_store_n(&state->input_head, head + 1u, __ATOMIC_RELEASE);
    return finish_input_producer(state, FRAMER_MQJS_OK);
}

framer_mqjs_result framer_mqjs_input_request_release_all(
    framer_mqjs_runtime *runtime,
    uint32_t timestamp_ms,
    framer_mqjs_input_reason reason)
{
    runtime_state *state;
    uint32_t producer_has_timestamp;
    uint32_t producer_timestamp;
    if (runtime == NULL ||
        (reason != FRAMER_MQJS_INPUT_REASON_FOCUS_LOSS &&
         reason != FRAMER_MQJS_INPUT_REASON_DISCONNECT))
        return FRAMER_MQJS_ERR_ARGUMENT;
    state = state_of(runtime);
    if (state == NULL)
        return FRAMER_MQJS_ERR_ARGUMENT;
    /* Terminal release cannot fail open because a producer timestamp raced it. */
    __atomic_exchange_n(&state->input_ingress_enabled, 0u, __ATOMIC_ACQ_REL);
    producer_has_timestamp = __atomic_load_n(&state->producer_has_timestamp,
                                              __ATOMIC_ACQUIRE);
    producer_timestamp = __atomic_load_n(&state->producer_last_timestamp_ms,
                                         __ATOMIC_ACQUIRE);
    if (producer_has_timestamp != 0u &&
        input_time_before(timestamp_ms, producer_timestamp))
        timestamp_ms = producer_timestamp;
    __atomic_store_n(&state->producer_held_mask, 0u, __ATOMIC_RELEASE);
    __atomic_store_n(&state->input_terminal_timestamp_ms, timestamp_ms,
                     __ATOMIC_RELAXED);
    __atomic_store_n(&state->input_terminal_reason, (uint32_t)reason,
                     __ATOMIC_RELAXED);
    __atomic_store_n(&state->input_terminal_release, 1u, __ATOMIC_RELEASE);
    __atomic_store_n(&state->input_resync_reason, (uint32_t)reason,
                     __ATOMIC_RELAXED);
    __atomic_add_fetch(&state->input_resync_sequence, 1u, __ATOMIC_RELAXED);
    __atomic_store_n(&state->input_resync_pending, 1u, __ATOMIC_RELEASE);
    return FRAMER_MQJS_INPUT_RESYNC_QUEUED;
}

framer_mqjs_result framer_mqjs_input_request_focus_release(
    framer_mqjs_runtime *runtime,
    uint32_t timestamp_ms)
{
    runtime_state *state;
    uint32_t producer_has_timestamp;
    uint32_t producer_timestamp;
    if (runtime == NULL)
        return FRAMER_MQJS_ERR_ARGUMENT;
    state = state_of(runtime);
    if (state == NULL)
        return FRAMER_MQJS_ERR_ARGUMENT;
    if (!is_owner_thread(state)) {
        state->telemetry.wrong_thread++;
        state->telemetry.last_result = FRAMER_MQJS_ERR_WRONG_THREAD;
        return FRAMER_MQJS_ERR_WRONG_THREAD;
    }
    if (__atomic_load_n(&state->input_ingress_enabled, __ATOMIC_ACQUIRE) == 0u)
        return FRAMER_MQJS_ERR_DISABLED;
    /* The physical owner closes its wrapper gate before this call. A producer
     * already inside the core must finish before we snapshot/clear its bitmap;
     * returning MORE_PENDING makes that ordering explicit and retryable. */
    if (__atomic_load_n(&state->input_producer_active, __ATOMIC_ACQUIRE) != 0u)
        return FRAMER_MQJS_INPUT_MORE_PENDING;
    producer_has_timestamp = __atomic_load_n(&state->producer_has_timestamp,
                                              __ATOMIC_ACQUIRE);
    producer_timestamp = __atomic_load_n(&state->producer_last_timestamp_ms,
                                         __ATOMIC_ACQUIRE);
    if (producer_has_timestamp != 0u &&
        input_time_before(timestamp_ms, producer_timestamp))
        timestamp_ms = producer_timestamp;
    __atomic_store_n(&state->producer_held_mask, 0u, __ATOMIC_RELEASE);
    __atomic_store_n(&state->input_terminal_timestamp_ms, timestamp_ms,
                     __ATOMIC_RELAXED);
    __atomic_store_n(&state->input_resync_reason,
                     FRAMER_MQJS_INPUT_REASON_FOCUS_LOSS, __ATOMIC_RELAXED);
    __atomic_add_fetch(&state->input_resync_sequence, 1u, __ATOMIC_RELAXED);
    __atomic_store_n(&state->input_resync_pending, 1u, __ATOMIC_RELEASE);
    return FRAMER_MQJS_INPUT_RESYNC_QUEUED;
}

static framer_mqjs_result emit_input_event(runtime_state *state,
                                           uint8_t kind,
                                           uint32_t timestamp_ms,
                                           int key,
                                           int chord,
                                           uint16_t hold_count,
                                           int synthetic,
                                           framer_mqjs_input_reason reason)
{
    native_event event;
    if (state->input_logical_events_this_batch >=
        FRAMER_MQJS_INPUT_MAX_LOGICAL_EVENTS_PER_BATCH) {
        /* Valid admitted input cannot exceed the static logical staging bound. */
        state->telemetry.enabled = 0;
        state->telemetry.last_result = FRAMER_MQJS_ERR_SEQUENCE;
        return FRAMER_MQJS_ERR_SEQUENCE;
    }
    state->input_logical_events_this_batch++;
    memset(&event, 0, sizeof(event));
    event.selector.kind = kind;
    event.timestamp_ms = timestamp_ms;
    event.held_mask = state->held_mask;
    event.hold_count = hold_count;
    event.key = (int16_t)key;
    event.chord = (int16_t)chord;
    event.synthetic = synthetic != 0;
    event.repeat = kind == EVENT_KEY_HOLD;
    event.reason = (uint8_t)reason;
    return stage_native_event(state, &event);
}

static int exact_chord_for_mask(const runtime_state *state, uint16_t held_mask)
{
    unsigned int chord;
    for (chord = 0; chord < state->config.input.chord_count; chord++)
        if (state->config.input.chord_masks[chord] == held_mask)
            return (int)chord;
    return -1;
}

static framer_mqjs_result reconcile_chord(runtime_state *state,
                                          uint32_t timestamp_ms,
                                          int synthetic,
                                          framer_mqjs_input_reason reason)
{
    int next = exact_chord_for_mask(state, state->held_mask);
    framer_mqjs_result result;
    framer_mqjs_result first_error = FRAMER_MQJS_OK;
    if (next == state->active_chord)
        return FRAMER_MQJS_OK;
    if (state->active_chord >= 0) {
        int previous = state->active_chord;
        state->active_chord = -1;
        result = emit_input_event(state, EVENT_CHORD_UP, timestamp_ms, -1,
                                  previous, 0u, synthetic, reason);
        if (result < 0) first_error = result;
    }
    if (next >= 0) {
        state->active_chord = (int8_t)next;
        result = emit_input_event(state, EVENT_CHORD_DOWN, timestamp_ms, -1,
                                  next, 0u, synthetic, reason);
        if (result < 0 && first_error == FRAMER_MQJS_OK) first_error = result;
    }
    return first_error;
}

static uint32_t bounded_time_add(uint32_t value, uint32_t delta)
{
    return value + delta;
}

static framer_mqjs_result advance_input_to(runtime_state *state,
                                           uint32_t timestamp_ms,
                                           unsigned int hold_budget)
{
    unsigned int key;
    uint16_t due_mask = 0u;
    framer_mqjs_result result;
    framer_mqjs_result first_error = FRAMER_MQJS_OK;
    if (state->consumer_has_timestamp &&
        input_time_before(timestamp_ms, state->last_input_timestamp_ms))
        return FRAMER_MQJS_ERR_ARGUMENT;
    for (key = 0; key < state->config.input.key_count; key++) {
        input_key_state *input = &state->keys[key];
        if (input->raw_pressed == input->stable_pressed ||
            timestamp_ms - input->raw_changed_ms < state->config.input.debounce_ms)
            continue;
        due_mask |= (uint16_t)(1u << key);
    }
    while (due_mask != 0u) {
        uint16_t group_mask = 0u;
        uint32_t group_time = 0u;
        int have_group = 0;
        for (key = 0; key < state->config.input.key_count; key++) {
            uint32_t stable_at;
            if ((due_mask & (1u << key)) == 0u)
                continue;
            stable_at = bounded_time_add(state->keys[key].raw_changed_ms,
                                         state->config.input.debounce_ms);
            if (!have_group || input_time_before(stable_at, group_time)) {
                group_time = stable_at;
                have_group = 1;
            }
        }
        for (key = 0; key < state->config.input.key_count; key++) {
            input_key_state *input;
            uint32_t stable_at;
            if ((due_mask & (1u << key)) == 0u)
                continue;
            input = &state->keys[key];
            stable_at = bounded_time_add(input->raw_changed_ms,
                                         state->config.input.debounce_ms);
            if (stable_at != group_time)
                continue;
            group_mask |= (uint16_t)(1u << key);
            input->stable_pressed = input->raw_pressed;
            input->hold_count = 0u;
            if (input->stable_pressed) {
                state->held_mask |= (uint16_t)(1u << key);
                input->next_hold_ms = bounded_time_add(
                    stable_at, state->config.input.hold_delay_ms);
            } else {
                state->held_mask &= (uint16_t)~(1u << key);
                input->next_hold_ms = 0u;
            }
        }
        for (key = 0; key < state->config.input.key_count; key++) {
            input_key_state *input;
            if ((group_mask & (1u << key)) == 0u)
                continue;
            input = &state->keys[key];
            result = emit_input_event(state,
                                      input->stable_pressed ? EVENT_KEY_DOWN : EVENT_KEY_UP,
                                      group_time, (int)key, -1, 0u, 0,
                                      FRAMER_MQJS_INPUT_REASON_PHYSICAL);
            if (result < 0 && first_error == FRAMER_MQJS_OK)
                first_error = result;
        }
        result = reconcile_chord(state, group_time, 0,
                                 FRAMER_MQJS_INPUT_REASON_PHYSICAL);
        if (result < 0 && first_error == FRAMER_MQJS_OK)
            first_error = result;
        due_mask &= (uint16_t)~group_mask;
    }
    {
        unsigned int scanned;
        unsigned int start = state->hold_cursor;
        for (scanned = 0; scanned < state->config.input.key_count; scanned++) {
        input_key_state *input;
        if (hold_budget == 0u)
            break;
        key = (start + scanned) % state->config.input.key_count;
        input = &state->keys[key];
        if (!input->stable_pressed ||
            input_time_before(timestamp_ms, input->next_hold_ms))
            continue;
        if (input->hold_count != UINT16_MAX)
            input->hold_count++;
        result = emit_input_event(state, EVENT_KEY_HOLD, timestamp_ms, (int)key,
                                  -1, input->hold_count, 0,
                                  FRAMER_MQJS_INPUT_REASON_PHYSICAL);
        if (result < 0 && first_error == FRAMER_MQJS_OK) first_error = result;
        input->next_hold_ms = bounded_time_add(timestamp_ms,
                                               state->config.input.hold_cadence_ms);
        state->hold_cursor = (uint8_t)((key + 1u) %
                                      state->config.input.key_count);
        hold_budget--;
        }
    }
    state->last_input_timestamp_ms = timestamp_ms;
    state->consumer_has_timestamp = 1u;
    return first_error;
}

static framer_mqjs_result apply_input_resync(runtime_state *state,
                                             uint16_t authoritative_mask,
                                             uint32_t timestamp_ms,
                                             framer_mqjs_input_reason reason)
{
    unsigned int key;
    uint16_t changed = state->held_mask ^ authoritative_mask;
    framer_mqjs_result result;
    framer_mqjs_result first_error = FRAMER_MQJS_OK;
    state->held_mask = authoritative_mask;
    for (key = 0; key < state->config.input.key_count; key++) {
        input_key_state *input = &state->keys[key];
        int pressed = (authoritative_mask & (1u << key)) != 0u;
        input->raw_pressed = (uint8_t)pressed;
        input->stable_pressed = (uint8_t)pressed;
        input->raw_changed_ms = timestamp_ms;
        input->hold_count = 0u;
        input->next_hold_ms = pressed ? bounded_time_add(
            timestamp_ms, state->config.input.hold_delay_ms) : 0u;
        if ((changed & (1u << key)) == 0u)
            continue;
        result = emit_input_event(state, pressed ? EVENT_KEY_DOWN : EVENT_KEY_UP,
                                  timestamp_ms, (int)key, -1, 0u, 1, reason);
        if (result < 0 && first_error == FRAMER_MQJS_OK) first_error = result;
    }
    result = reconcile_chord(state, timestamp_ms, 1, reason);
    if (result < 0 && first_error == FRAMER_MQJS_OK) first_error = result;
    state->last_input_timestamp_ms = timestamp_ms;
    state->consumer_has_timestamp = 1u;
    state->telemetry.input_resyncs++;
    return first_error;
}

framer_mqjs_result framer_mqjs_input_drain(framer_mqjs_runtime *runtime,
                                           uint32_t timestamp_ms)
{
    runtime_state *state;
    uint32_t head;
    uint32_t tail;
    unsigned int records = 0u;
    framer_mqjs_result result;
    if (runtime == NULL)
        return FRAMER_MQJS_ERR_ARGUMENT;
    state = state_of(runtime);
    if (state == NULL)
        return FRAMER_MQJS_ERR_ARGUMENT;
    if (!is_owner_thread(state)) {
        state->telemetry.wrong_thread++;
        state->telemetry.last_result = FRAMER_MQJS_ERR_WRONG_THREAD;
        return FRAMER_MQJS_ERR_WRONG_THREAD;
    }
    if (state->config.input.key_count == 0u)
        return FRAMER_MQJS_ERR_DISABLED;
    if (state->consumer_has_timestamp &&
        input_time_before(timestamp_ms, state->last_input_timestamp_ms))
        return FRAMER_MQJS_ERR_ARGUMENT;
    state->input_events_this_drain = 0u;
    state->telemetry.input_drain_batches++;
    if (state->input_pending_count != 0u)
        return dispatch_staged_iteration(state, FRAMER_MQJS_OK);
    state->input_logical_events_this_batch = 0u;
    if (__atomic_load_n(&state->input_resync_pending, __ATOMIC_ACQUIRE) != 0u &&
        __atomic_load_n(&state->input_producer_active, __ATOMIC_ACQUIRE) != 0u) {
        return dispatch_staged_iteration(state, FRAMER_MQJS_INPUT_MORE_PENDING);
    }
    if (__atomic_exchange_n(&state->input_resync_pending, 0u,
                            __ATOMIC_ACQ_REL) != 0u) {
        uint16_t held;
        framer_mqjs_input_reason reason;
        uint32_t resync_timestamp_ms = timestamp_ms;
        head = __atomic_load_n(&state->input_head, __ATOMIC_ACQUIRE);
        __atomic_store_n(&state->input_tail, head, __ATOMIC_RELEASE);
        held = (uint16_t)__atomic_load_n(&state->producer_held_mask,
                                        __ATOMIC_ACQUIRE);
        if (__atomic_load_n(&state->input_terminal_release,
                            __ATOMIC_ACQUIRE) != 0u) {
            uint32_t producer_has_timestamp = __atomic_load_n(
                &state->producer_has_timestamp, __ATOMIC_ACQUIRE);
            uint32_t terminal_timestamp_ms = __atomic_load_n(
                &state->input_terminal_timestamp_ms, __ATOMIC_RELAXED);
            uint32_t producer_timestamp_ms = __atomic_load_n(
                &state->producer_last_timestamp_ms, __ATOMIC_ACQUIRE);
            reason = (framer_mqjs_input_reason)__atomic_load_n(
                &state->input_terminal_reason, __ATOMIC_RELAXED);
            if (input_time_before(resync_timestamp_ms, terminal_timestamp_ms))
                resync_timestamp_ms = terminal_timestamp_ms;
            if (producer_has_timestamp != 0u &&
                input_time_before(resync_timestamp_ms, producer_timestamp_ms))
                resync_timestamp_ms = producer_timestamp_ms;
        } else {
            reason = (framer_mqjs_input_reason)__atomic_load_n(
                &state->input_resync_reason, __ATOMIC_RELAXED);
        }
        result = apply_input_resync(state, held, resync_timestamp_ms, reason);
        state->telemetry.input_queue_overflows = __atomic_load_n(
            &state->input_queue_overflows, __ATOMIC_RELAXED);
        state->telemetry.input_resync_sequence = __atomic_load_n(
            &state->input_resync_sequence, __ATOMIC_RELAXED);
        state->telemetry.duplicate_key_levels = __atomic_load_n(
            &state->producer_duplicate_levels, __ATOMIC_RELAXED);
        return dispatch_staged_iteration(state, result);
    }
    tail = __atomic_load_n(&state->input_tail, __ATOMIC_RELAXED);
    head = __atomic_load_n(&state->input_head, __ATOMIC_ACQUIRE);
    while (tail != head && records < FRAMER_MQJS_INPUT_DRAIN_RECORDS) {
        input_queue_record record =
            state->input_queue[tail % FRAMER_MQJS_INPUT_QUEUE_RECORDS];
        input_key_state *input;
        if (input_time_before(timestamp_ms, record.timestamp_ms))
            break;
        if (!state->consumer_has_timestamp ||
            !input_time_before(record.timestamp_ms,
                               state->last_input_timestamp_ms)) {
            result = advance_input_to(state, record.timestamp_ms, 0u);
            if (result < 0)
                return dispatch_staged_iteration(state, result);
        }
        input = &state->keys[record.key];
        if (input->raw_pressed != record.pressed) {
            input->raw_pressed = record.pressed;
            input->raw_changed_ms = record.timestamp_ms;
        }
        tail++;
        records++;
        __atomic_store_n(&state->input_tail, tail, __ATOMIC_RELEASE);
    }
    head = __atomic_load_n(&state->input_head, __ATOMIC_ACQUIRE);
    tail = __atomic_load_n(&state->input_tail, __ATOMIC_RELAXED);
    if (tail != head && !input_time_before(
            timestamp_ms,
            state->input_queue[tail % FRAMER_MQJS_INPUT_QUEUE_RECORDS].timestamp_ms))
        result = FRAMER_MQJS_INPUT_MORE_PENDING;
    else
        result = advance_input_to(state, timestamp_ms,
                                  FRAMER_MQJS_INPUT_DRAIN_HOLDS);
    state->telemetry.input_queue_overflows = __atomic_load_n(
        &state->input_queue_overflows, __ATOMIC_RELAXED);
    state->telemetry.input_resync_sequence = __atomic_load_n(
        &state->input_resync_sequence, __ATOMIC_RELAXED);
    state->telemetry.duplicate_key_levels = __atomic_load_n(
        &state->producer_duplicate_levels, __ATOMIC_RELAXED);
    return dispatch_staged_iteration(state, result);
}

int framer_mqjs_input_get_observation(
    const framer_mqjs_runtime *runtime,
    framer_mqjs_input_observation *observation)
{
    const runtime_state *state;
    uint32_t before;
    uint32_t after;
    unsigned int attempt;
    if (runtime == NULL || observation == NULL)
        return 0;
    state = const_state_of(runtime);
    if (state == NULL) {
        memset(observation, 0, sizeof(*observation));
        return 0;
    }
    for (attempt = 0; attempt < 8u; attempt++) {
        before = __atomic_load_n(&state->observation_guard, __ATOMIC_SEQ_CST);
        if ((before & 1u) != 0u)
            continue;
        observation->native_token = __atomic_load_n(&state->observation_token,
                                                     __ATOMIC_SEQ_CST);
        observation->timestamp_ms = __atomic_load_n(
            &state->observation_timestamp_ms, __ATOMIC_SEQ_CST);
        observation->observation_sequence = __atomic_load_n(
            &state->observation_sequence, __ATOMIC_SEQ_CST);
        observation->pressed = (uint8_t)__atomic_load_n(
            &state->observation_pressed, __ATOMIC_SEQ_CST);
        after = __atomic_load_n(&state->observation_guard, __ATOMIC_SEQ_CST);
        if (before == after && (after & 1u) == 0u) {
            if (observation->observation_sequence != 0u)
                return 1;
            memset(observation, 0, sizeof(*observation));
            return 0;
        }
    }
    memset(observation, 0, sizeof(*observation));
    return 0;
}

void framer_mqjs_get_telemetry(const framer_mqjs_runtime *runtime,
                               framer_mqjs_telemetry *telemetry)
{
    const runtime_state *state;
    if (runtime == NULL || telemetry == NULL)
        return;
    state = const_state_of(runtime);
    if (state == NULL) {
        memset(telemetry, 0, sizeof(*telemetry));
        return;
    }
    *telemetry = state->telemetry;
}

void framer_mqjs_get_last_good_slots(const framer_mqjs_runtime *runtime,
                                     int32_t slots[FRAMER_MQJS_SLOT_COUNT])
{
    const runtime_state *state;
    if (runtime == NULL || slots == NULL)
        return;
    state = const_state_of(runtime);
    if (state == NULL) {
        memset(slots, 0, sizeof(int32_t) * FRAMER_MQJS_SLOT_COUNT);
        return;
    }
    memcpy(slots, state->last_good_slots, sizeof(state->last_good_slots));
}

void framer_mqjs_destroy(framer_mqjs_runtime *runtime)
{
    runtime_state *state;
    /* DIAG ONLY: the resident owner destroys the runtime immediately after a
     * failed init/load, so the captured exception text has to survive the
     * teardown memset for the loader-side diagnostic RPC to report it. */
    char preserved[FRAMER_MQJS_DIAG_LAST_ERROR_BYTES];
    uint32_t index;
    if (runtime == NULL)
        return;
    state = state_of(runtime);
    if (state == NULL)
        return;
    for (index = 0u; index < FRAMER_MQJS_DIAG_LAST_ERROR_BYTES; ++index)
        preserved[index] = state->last_error[index];
    __atomic_store_n(&state->input_ingress_enabled, 0u, __ATOMIC_RELEASE);
    release_context(state);
    memset(runtime, 0, sizeof(*runtime));
    for (index = 0u; index < FRAMER_MQJS_DIAG_LAST_ERROR_BYTES; ++index)
        state->last_error[index] = preserved[index];
}
