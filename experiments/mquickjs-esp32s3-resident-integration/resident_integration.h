#ifndef FRAMER_MQJS_RESIDENT_INTEGRATION_H
#define FRAMER_MQJS_RESIDENT_INTEGRATION_H

#include "f2js_admission.h"
#include "../mquickjs-esp32s3-canary/framer_mquickjs_canary.h"

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define FRAMER_RESIDENT_VM_STACK_BYTES 12288u
#define FRAMER_RESIDENT_EVENT_QUEUE_RECORDS 32u
#define FRAMER_RESIDENT_EVENT_NAME_BYTES 24u

typedef struct {
    uint32_t sequence;
    int32_t slots[FRAMER_MQJS_SLOT_COUNT];
    uint32_t admitted_revision;
} framer_resident_mailbox;

typedef struct {
    int32_t slots[FRAMER_MQJS_SLOT_COUNT];
    uint32_t admitted_revision;
    uint32_t sequence;
} framer_resident_mailbox_snapshot;

void framer_resident_mailbox_init(framer_resident_mailbox *mailbox);
void framer_resident_mailbox_write(framer_resident_mailbox *mailbox,
                                   const int32_t slots[FRAMER_MQJS_SLOT_COUNT],
                                   uint32_t admitted_revision);
int framer_resident_mailbox_try_read(
    const framer_resident_mailbox *mailbox,
    framer_resident_mailbox_snapshot *snapshot);

enum {
    FRAMER_RESIDENT_READY_MODULE_MAP = 1u << 0,
    FRAMER_RESIDENT_READY_PARSER = 1u << 1,
    FRAMER_RESIDENT_READY_VM_TASK = 1u << 2,
    FRAMER_RESIDENT_READY_MAILBOX = 1u << 3,
    FRAMER_RESIDENT_READY_ALL = (1u << 4) - 1u,
};

typedef enum {
    FRAMER_RESIDENT_CAP_COLD = 0,
    FRAMER_RESIDENT_CAP_ASSEMBLING = 1,
    FRAMER_RESIDENT_CAP_ADVERTISED = 2,
    FRAMER_RESIDENT_CAP_QUIESCING = 3,
    FRAMER_RESIDENT_CAP_STOPPED = 4,
    FRAMER_RESIDENT_CAP_FAULTED = 5,
} framer_resident_capability_state;

typedef struct {
    uint32_t ready_mask;
    uint32_t state;
    uint32_t advertised;
    uint32_t generation;
} framer_resident_capability;

void framer_resident_capability_init(framer_resident_capability *capability);
int framer_resident_capability_set_ready(framer_resident_capability *capability,
                                         uint32_t component,
                                         int ready);
int framer_resident_capability_advertise(framer_resident_capability *capability,
                                         uint32_t generation);
void framer_resident_capability_begin_quiesce(
    framer_resident_capability *capability);
int framer_resident_capability_finish_quiesce(
    framer_resident_capability *capability);
int framer_resident_capability_can_unmap(
    const framer_resident_capability *capability);
int framer_resident_capability_mark_unmapped(
    framer_resident_capability *capability);
int framer_resident_capability_flash_write_allowed(
    const framer_resident_capability *capability);
void framer_resident_capability_fault(framer_resident_capability *capability);

typedef struct {
    framer_mqjs_result (*init)(framer_mqjs_runtime *, void *, size_t,
                              const framer_mqjs_config *);
    framer_mqjs_result (*load)(framer_mqjs_runtime *, const char *, size_t, int);
    framer_mqjs_result (*dispatch)(framer_mqjs_runtime *, const char *,
                                  int32_t, int32_t);
    framer_mqjs_result (*input_enqueue)(framer_mqjs_runtime *, uint32_t, int,
                                       uint32_t);
    framer_mqjs_result (*input_request_release_all)(framer_mqjs_runtime *,
                                                    uint32_t,
                                                    framer_mqjs_input_reason);
    framer_mqjs_result (*input_drain)(framer_mqjs_runtime *, uint32_t);
    int (*input_get_observation)(const framer_mqjs_runtime *,
                                 framer_mqjs_input_observation *);
    void (*get_telemetry)(const framer_mqjs_runtime *, framer_mqjs_telemetry *);
    void (*destroy)(framer_mqjs_runtime *);
} framer_resident_engine_api;

struct framer_resident_owner;

typedef struct {
    void *opaque;
    void *(*allocate_psram)(void *opaque, size_t bytes);
    void (*free_psram)(void *opaque, void *allocation);
    uint64_t (*now_us)(void *opaque);
    uint32_t (*now_ms)(void *opaque);
    uintptr_t (*current_thread_token)(void *opaque);
    void (*reschedule_owner)(void *opaque);
    /* Tick, knob, and host-RPC producers are an explicit generation-bound
     * platform source just like the stock key hook. Activation is all-or-none.
     * Removal first prevents a new wrapper invocation from beginning, then
     * returns only after every invocation already begun has either registered
     * in owner.ingress_inflight or returned. Wrappers must pass their captured
     * generation to owner_enqueue()/owner_enqueue_host_rpc(). */
    int (*activate_event_sources)(void *opaque,
                                  struct framer_resident_owner *owner,
                                  uint32_t generation);
    int (*remove_event_sources)(void *opaque, uint32_t generation);
    /* A successful activation installs the stock-first wrapper for exactly
     * this owner/generation. Failure must leave all input sources disarmed.
     * The wrapper must pass the captured generation to input_after_stock(). */
    int (*activate_input_sources)(void *opaque,
                                  struct framer_resident_owner *owner,
                                  uint32_t generation);
    /* Retirement is a synchronization handoff, not a best-effort request.
     * remove_stock_input_hook() returns only when no new wrapper invocation
     * for generation can begin and every invocation already begun has either
     * registered in owner.ingress_inflight or returned. cancel_input_poll()
     * provides the same handoff for expiry callbacks and atomically invalidates
     * the timer generation. A schedule racing cancellation must fail. Existing
     * registered adapter calls are allowed to finish boundedly. */
    int (*remove_stock_input_hook)(void *opaque, uint32_t generation);
    int (*cancel_input_poll)(void *opaque, uint32_t generation);
    /* The timer captures generation and invokes input_poll_due(owner,
     * generation) on expiry. It never runs JavaScript. Return zero when the
     * generation was canceled or scheduling otherwise failed. */
    int (*schedule_input_poll)(void *opaque, uint32_t generation,
                               uint32_t delay_ms);
    /* Must atomically copy/stage the complete validated F1WB before returning.
     * An asset package is rejected when this operation is absent or fails. */
    int (*stage_raster_base)(void *opaque, const uint8_t *f1wb, size_t bytes,
                             uint32_t generation);
    uint32_t (*task_stack_high_water_bytes)(void *opaque);
} framer_resident_platform;

typedef struct {
    char name[FRAMER_RESIDENT_EVENT_NAME_BYTES];
    int32_t value;
    int32_t auxiliary;
    uint32_t receipt_tag;
} framer_resident_event;

typedef struct {
    uint32_t tag;
    int32_t result;
    uint32_t mailbox_sequence;
    uint32_t applied_generation;
    uint32_t applied_revision;
} framer_resident_tagged_completion;

typedef struct {
    uint32_t dispatches;
    uint32_t input_drains;
    uint32_t queue_overflows;
    uint32_t engine_failures;
    uint32_t recoveries;
    uint32_t recovery_failures;
    uint32_t reschedules;
    uint32_t module_revision;
    uint32_t task_stack_high_water_bytes;
    int32_t last_result;
    uint8_t booted;
    uint8_t permanently_disabled;
} framer_resident_telemetry;

typedef struct framer_resident_owner {
    framer_mqjs_runtime runtime;
    framer_f2js_admission admission;
    framer_mqjs_config engine_config;
    framer_resident_engine_api engine;
    framer_resident_platform platform;
    framer_resident_capability capability;
    framer_resident_mailbox mailbox;
    framer_resident_event queue[FRAMER_RESIDENT_EVENT_QUEUE_RECORDS];
    uint8_t task_stack[FRAMER_RESIDENT_VM_STACK_BYTES];
    void *heap;
    uint32_t queue_head;
    uint32_t queue_tail;
    uint32_t queue_producer_lock;
    uint32_t publish_gate_lock;
    uint32_t input_pending;
    uint32_t input_poll_scheduled;
    uint32_t input_debounce_due_ms;
    uint32_t ingress_enabled;
    uint32_t input_ingress_enabled;
    uint32_t ingress_generation;
    uint32_t ingress_inflight;
    uint32_t owner_runtime_inflight;
    uint32_t event_source_quiesce_state;
    uint32_t source_quiesce_state;
    uint32_t terminal_release_state;
    uint32_t terminal_release_timestamp_ms;
    uint32_t terminal_release_reason;
    uint32_t prefer_input;
    uint32_t active_generation;
    uint32_t last_engine_resets;
    uint32_t tagged_completion_sequence;
    framer_resident_tagged_completion tagged_completion;
    framer_resident_telemetry telemetry;
} framer_resident_owner;

void framer_resident_owner_init_shell(framer_resident_owner *owner,
                                      const framer_resident_engine_api *engine,
                                      const framer_resident_platform *platform);
/* Identical to init_shell EXCEPT that owner->task_stack is preserved, so a
 * STOPPED owner can be recycled for a new boot from any task — including a
 * task whose live stack IS owner->task_stack (the slot-switch case: the VM
 * task parks in its loop, another task re-initialises everything around the
 * stack it is standing on, and the VM task then boots the next widget).
 * Only call after framer_resident_owner_stop_on_task() returned nonzero. */
void framer_resident_owner_reinit_shell(framer_resident_owner *owner,
                                        const framer_resident_engine_api *engine,
                                        const framer_resident_platform *platform);
int framer_resident_owner_mark_module_mapped(framer_resident_owner *owner);
/* This must be called by the dedicated VM-owner task. Parsing, allocation,
 * engine init, and source load all occur on that task, never in a producer or
 * UI callback. The transport may be released after this call returns. */
framer_f2js_result framer_resident_owner_boot_on_task(
    framer_resident_owner *owner,
    const uint8_t *package,
    size_t package_bytes);
int framer_resident_owner_enqueue(framer_resident_owner *owner,
                                  uint32_t generation,
                                  const char *event_name,
                                  int32_t value,
                                  int32_t auxiliary);
int framer_resident_owner_enqueue_host_rpc(framer_resident_owner *owner,
                                           uint32_t generation,
                                           uint16_t id,
                                           int32_t value,
                                           int32_t auxiliary);
/* Exactly correlated host ingress. A nonzero caller-owned tag travels with
 * this queue record and is published only after that exact record is consumed
 * by the owner. Ticks and input drains can interleave without false ACKs. */
int framer_resident_owner_enqueue_host_rpc_tagged(
    framer_resident_owner *owner, uint32_t generation, uint16_t id,
    int32_t value, int32_t auxiliary, uint32_t receipt_tag);
int framer_resident_owner_take_tagged_completion(
    framer_resident_owner *owner,
    framer_resident_tagged_completion *completion);
/* The caller is the independently proven stock-first wrapper: call the stock
 * callback first, then forward the observed opaque token/level here. */
framer_mqjs_result framer_resident_owner_input_after_stock(
    framer_resident_owner *owner, uint32_t generation, uint32_t native_token,
    int pressed, uint32_t timestamp_ms);
framer_mqjs_result framer_resident_owner_release_all(
    framer_resident_owner *owner, uint32_t generation, uint32_t timestamp_ms,
    framer_mqjs_input_reason reason);
int framer_resident_owner_get_input_observation(
    framer_resident_owner *owner,
    framer_mqjs_input_observation *observation);
void framer_resident_owner_notify_input(framer_resident_owner *owner,
                                        uint32_t generation);
void framer_resident_owner_input_poll_due(framer_resident_owner *owner,
                                          uint32_t generation);
/* One step fairly chooses one native-input drain or one ordinary event. It
 * never raises the engine's callback-attempt bound from the current canary
 * header. The engine owns its single bounded recovery. The adapter detects
 * that recovery through telemetry and never performs a duplicate reset. */
framer_mqjs_result framer_resident_owner_step(framer_resident_owner *owner);
/* Teardown is deliberately split across the control and owner tasks.
 * begin_quiesce performs, in order: atomically close publication,
 * advertisement, and ingress; synchronously retire tick/knob/host-RPC
 * producers; remove the stock hook; cancel the generation-tagged timer; then
 * publish a terminal release request. It returns zero and leaves the runtime
 * mapped if any platform synchronization handoff fails.
 *
 * stop_on_task issues terminal release on the VM owner, waits (without
 * blocking) for owner_runtime_inflight and ingress_inflight to reach zero,
 * consumes at most one bounded native drain per call, then destroys. Return
 * zero means reschedule/yield and call again; one means destroy completed and
 * unmap is permitted. */
int framer_resident_owner_begin_quiesce(framer_resident_owner *owner,
                                        uint32_t timestamp_ms,
                                        framer_mqjs_input_reason reason);
int framer_resident_owner_stop_on_task(framer_resident_owner *owner);
void framer_resident_owner_get_telemetry(
    framer_resident_owner *owner,
    framer_resident_telemetry *telemetry);

#ifdef __cplusplus
}
#endif

#endif
