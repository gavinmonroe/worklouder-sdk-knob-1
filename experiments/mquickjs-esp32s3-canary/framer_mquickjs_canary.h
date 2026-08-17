#ifndef FRAMER_MQUICKJS_CANARY_H
#define FRAMER_MQUICKJS_CANARY_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define FRAMER_MQJS_SLOT_COUNT 16u
#define FRAMER_MQJS_MAX_KEYS 16u
#define FRAMER_MQJS_MAX_CHORDS 8u
#define FRAMER_MQJS_MAX_BINDINGS 16u
#define FRAMER_MQJS_INPUT_QUEUE_RECORDS 32u
#define FRAMER_MQJS_INPUT_DRAIN_RECORDS 4u
#define FRAMER_MQJS_INPUT_DRAIN_HOLDS 2u
#define FRAMER_MQJS_INPUT_PENDING_EVENTS 64u
#define FRAMER_MQJS_INPUT_CALLBACKS_PER_ITERATION 3u
/* One logical batch can mature every admitted key plus one transition induced
 * by each consumed record. Each transition stages one key edge and,
 * conservatively, chord up plus down; the final poll can stage two holds. */
#define FRAMER_MQJS_INPUT_MAX_LOGICAL_EVENTS_PER_BATCH \
    (3u * (FRAMER_MQJS_MAX_KEYS + FRAMER_MQJS_INPUT_DRAIN_RECORDS) + \
     FRAMER_MQJS_INPUT_DRAIN_HOLDS)
#define FRAMER_MQJS_INPUT_MAX_EVENTS_PER_DRAIN \
    FRAMER_MQJS_INPUT_CALLBACKS_PER_ITERATION
#define FRAMER_MQJS_INPUT_MAX_RESYNC_EVENTS 18u
#define FRAMER_MQJS_MIN_HEAP_BYTES 65536u
#define FRAMER_MQJS_RUNTIME_STORAGE_BYTES 4096u
/* The initial source load (parse + top-level run of a several-KB script from
 * flash-cached code) takes far longer than one steady-state callback slice;
 * live device result under the ordinary callback_deadline_us budget was
 * ERR_TIMEOUT ("callback deadline expired") on a healthy script. This is a
 * separate, generous one-shot budget applied only while state->loading is
 * set (see begin_deadline in framer_mquickjs_canary.c); steady-state
 * callbacks keep using config.callback_deadline_us. */
#define FRAMER_MQJS_LOAD_DEADLINE_US 3000000u

typedef union {
    uint64_t alignment;
    uint8_t bytes[FRAMER_MQJS_RUNTIME_STORAGE_BYTES];
} framer_mqjs_runtime;

typedef uint64_t (*framer_mqjs_now_us_fn)(void *opaque);
typedef uintptr_t (*framer_mqjs_thread_token_fn)(void *opaque);
typedef int (*framer_mqjs_publish_fn)(void *opaque,
                                      const int32_t slots[FRAMER_MQJS_SLOT_COUNT],
                                      uint32_t revision);

typedef struct {
    /* Package admission assigns stable JavaScript key IDs 0..key_count-1 to
     * exact native u32 tokens. Physical token/name discovery is outside this
     * canary and remains unproven. */
    uint32_t native_tokens[FRAMER_MQJS_MAX_KEYS];
    /* Each chord is an exact held-mask match. Masks must contain 2..4 admitted
     * keys and may not repeat. */
    uint16_t chord_masks[FRAMER_MQJS_MAX_CHORDS];
    uint16_t debounce_ms;
    uint16_t hold_delay_ms;
    uint16_t hold_cadence_ms;
    uint8_t key_count;
    uint8_t chord_count;
} framer_mqjs_input_config;

typedef struct {
    void *opaque;
    framer_mqjs_now_us_fn now_us;
    framer_mqjs_thread_token_fn current_thread_token;
    /* publish() must only copy the complete slot array plus revision into one
     * atomic target mailbox. It must not call the UI from the VM-owner task. */
    framer_mqjs_publish_fn publish;
    uintptr_t owner_thread_token;
    uint32_t callback_deadline_us;
    framer_mqjs_input_config input;
} framer_mqjs_config;

typedef enum {
    FRAMER_MQJS_INPUT_REASON_PHYSICAL = 0,
    FRAMER_MQJS_INPUT_REASON_FOCUS_LOSS = 1,
    FRAMER_MQJS_INPUT_REASON_DISCONNECT = 2,
    FRAMER_MQJS_INPUT_REASON_QUEUE_RESYNC = 3,
} framer_mqjs_input_reason;

typedef struct {
    uint32_t native_token;
    uint32_t timestamp_ms;
    uint32_t observation_sequence;
    uint8_t pressed;
} framer_mqjs_input_observation;

typedef enum {
    FRAMER_MQJS_OK = 0,
    FRAMER_MQJS_NO_HANDLER = 1,
    FRAMER_MQJS_INPUT_RESYNC_QUEUED = 2,
    FRAMER_MQJS_INPUT_MORE_PENDING = 3,
    FRAMER_MQJS_ERR_ARGUMENT = -1,
    FRAMER_MQJS_ERR_WRONG_THREAD = -2,
    FRAMER_MQJS_ERR_NOT_ADMITTED = -3,
    FRAMER_MQJS_ERR_SOURCE = -4,
    FRAMER_MQJS_ERR_EXCEPTION = -5,
    FRAMER_MQJS_ERR_TIMEOUT = -6,
    FRAMER_MQJS_ERR_OOM = -7,
    FRAMER_MQJS_ERR_PUBLISH = -8,
    FRAMER_MQJS_ERR_DISABLED = -9,
    FRAMER_MQJS_ERR_SEQUENCE = -10,
} framer_mqjs_result;

typedef struct {
    uint32_t heap_capacity_bytes;
    uint32_t heap_used_bytes;
    uint32_t heap_high_water_bytes;
    uint32_t free_bytes;
    uint32_t minimum_free_bytes;
    uint32_t stack_used_bytes;
    uint32_t stack_high_water_bytes;
    uint32_t last_good_revision;
    uint64_t interrupt_polls;
    uint32_t source_loads;
    uint32_t callbacks;
    uint32_t commits;
    uint32_t resets;
    uint32_t source_rejections;
    uint32_t exceptions;
    uint32_t timeouts;
    uint32_t out_of_memory;
    uint32_t publish_failures;
    uint32_t wrong_thread;
    uint32_t key_down_events;
    uint32_t key_up_events;
    uint32_t key_hold_events;
    uint32_t chord_down_events;
    uint32_t chord_up_events;
    uint32_t input_queue_overflows;
    uint32_t input_resyncs;
    uint32_t input_resync_sequence;
    uint32_t duplicate_key_levels;
    uint32_t input_drain_batches;
    uint32_t input_drain_more_pending;
    uint32_t max_input_events_per_drain;
    uint32_t max_input_pending_events;
    uint32_t input_callback_budget_yields;
    uint32_t pending_input_events;
    uint32_t last_event_sequence;
    uint16_t held_key_mask;
    int32_t last_result;
    uint8_t enabled;
} framer_mqjs_telemetry;

/*
 * The heap and source text remain caller-owned. Both must remain alive and
 * immutable for the runtime lifetime; source[source_len] must be a readable
 * NUL byte as required by the pinned MicroQuickJS parser.
 */
framer_mqjs_result framer_mqjs_init(framer_mqjs_runtime *runtime,
                                    void *heap,
                                    size_t heap_bytes,
                                    const framer_mqjs_config *config);

/* The admitted flag is an admission assertion from the caller; signature or
 * package verification remains the adapter's responsibility. Source must begin
 * with the exact bytes `"use strict";\n`. A rejected candidate restores the
 * prior accepted program and never publishes partial state. */
framer_mqjs_result framer_mqjs_load(framer_mqjs_runtime *runtime,
                                    const char *source,
                                    size_t source_len,
                                    int admitted);

/* Exact event names are "tick.100ms", "tick.1s",
 * "input.fn-bottom-knob", "host.rpc:<1..65535>" (decimal or 0x hex),
 * "input.key.down", "input.key.up", "input.key.hold",
 * "input.chord.down", and "input.chord.up".
 * Calls must originate on the configured VM-owner task. Every callback gets
 * one event snapshot object; widget.isHeld(event, keyId) reads its heldMask.
 * If older staged input consumes the three-attempt owner-iteration budget, the
 * event is retained FIFO and INPUT_MORE_PENDING is returned. */
framer_mqjs_result framer_mqjs_dispatch(framer_mqjs_runtime *runtime,
                                        const char *event_name,
                                        int32_t value,
                                        int32_t auxiliary);

/* Single-producer, non-blocking ingress for the stock-first key hook. It only
 * updates an authoritative bitmap and fixed queue; it never runs JavaScript.
 * The VM-owner task calls drain(). Queue overflow requests a bitmap resync so
 * a lost release cannot leave a key logically stuck. Logical transitions are
 * staged with their exact timestamp/held snapshot. An owner call attempts at
 * most three staged events (and therefore at most three JS callbacks). The
 * first failed callback is consumed and ends that call after one bounded
 * recovery; every later snapshot remains FIFO. This reserves the fourth 2 ms
 * slice for recovery even when the third attempted callback fails. */
framer_mqjs_result framer_mqjs_input_enqueue(framer_mqjs_runtime *runtime,
                                             uint32_t native_token,
                                             int pressed,
                                             uint32_t timestamp_ms);
/* This terminal session gate may run on a control task while one producer call
 * is in flight. It disables ingress before publishing release, and drain waits
 * for that bounded producer call before reading the authoritative zero bitmap.
 * No hook may be reinstalled until a new runtime session is created. */
framer_mqjs_result framer_mqjs_input_request_release_all(
    framer_mqjs_runtime *runtime,
    uint32_t timestamp_ms,
    framer_mqjs_input_reason reason);
/* Resumable focus transition, owner-thread only. The caller must first close
 * its physical ingress gate and drain any wrapper calls already in flight.
 * This clears the authoritative held bitmap and queues a FOCUS_LOSS resync,
 * but deliberately leaves both core and adapter terminal ingress open. */
framer_mqjs_result framer_mqjs_input_request_focus_release(
    framer_mqjs_runtime *runtime,
    uint32_t timestamp_ms);
framer_mqjs_result framer_mqjs_input_drain(framer_mqjs_runtime *runtime,
                                           uint32_t timestamp_ms);
/* Capability-gated learn/poll seam. It reports the last token exactly as
 * observed after the stock callback, including tokens not yet admitted. */
int framer_mqjs_input_get_observation(
    const framer_mqjs_runtime *runtime,
    framer_mqjs_input_observation *observation);

/* These two snapshots are VM-owner-only. Cross-task status/RPC code must read
 * an adapter-owned mailbox snapshot rather than race the live runtime. */
void framer_mqjs_get_telemetry(const framer_mqjs_runtime *runtime,
                               framer_mqjs_telemetry *telemetry);
void framer_mqjs_get_last_good_slots(const framer_mqjs_runtime *runtime,
                                     int32_t slots[FRAMER_MQJS_SLOT_COUNT]);
/* Teardown order is mandatory: disable the advertised input capability,
 * remove the stock-first hook, quiesce its single producer, drain/cancel the
 * owner task, then destroy and (for a mapped module) unmap code. */
void framer_mqjs_destroy(framer_mqjs_runtime *runtime);

#ifdef __cplusplus
}
#endif

#endif
