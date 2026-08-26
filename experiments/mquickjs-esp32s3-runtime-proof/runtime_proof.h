#ifndef FRAMER_MQUICKJS_RUNTIME_PROOF_H
#define FRAMER_MQUICKJS_RUNTIME_PROOF_H

#include <stddef.h>
#include <stdint.h>

#ifndef FRAMER_RUNTIME_PROOF_EXACT_ABI_ACK
#error "RUNTIME_PROOF_FAIL_CLOSED: exact accepted application acknowledgement required"
#elif FRAMER_RUNTIME_PROOF_EXACT_ABI_ACK != 0x36317013u
#error "RUNTIME_PROOF_FAIL_CLOSED: accepted application acknowledgement changed"
#endif

#ifdef __cplusplus
extern "C" {
#endif

#define FRAMER_RUNTIME_ACCEPTED_APP_SHA256 \
    "363170139a06f306be1e894b6f203a9bf03bf4d70d21194aaccdd1c42f760c32"
#define FRAMER_RUNTIME_PACKAGE_ABI_SHA256 \
    "5091736403d809078cbbf12a1b593fbabaff53474a0935a7e00ce81dc8bd67f8"
#define FRAMER_RUNTIME_MODULE_ABI_SHA256 \
    "ad484a3a8b438c51f6bbcda6ea871110735b3460e39e4c2853a4e636f5f728cb"
#define FRAMER_RUNTIME_PROFILE_ID "framer-f1-render-v2-mquickjs-v1"
#define FRAMER_RUNTIME_PACKAGE_FORMAT \
    "framer-render-v2-mquickjs-package-v1"
#define FRAMER_RUNTIME_ENGINE_COMMIT \
    "203d5bb79789bc47b74855d9207415dab71661a0"
#define FRAMER_RUNTIME_JAVASCRIPT_PROFILE "mquickjs-es5-strict-v1"

#define FRAMER_RUNTIME_SCREEN_ID 28u
#define FRAMER_RUNTIME_MALLOC_CAP_8BIT 0x0004u
#define FRAMER_RUNTIME_MALLOC_CAP_INTERNAL 0x0800u
#define FRAMER_RUNTIME_INTERNAL_CAPS \
    (FRAMER_RUNTIME_MALLOC_CAP_INTERNAL | FRAMER_RUNTIME_MALLOC_CAP_8BIT)
#define FRAMER_RUNTIME_VM_HEAP_BYTES 65536u
#define FRAMER_RUNTIME_OWNER_BYTES 26952u
#define FRAMER_RUNTIME_STATIC_TASK_BYTES 352u
#define FRAMER_RUNTIME_RPC_CONTEXT_BYTES 352u
#define FRAMER_RUNTIME_RPC_CONTEXT_COUNT 5u
#define FRAMER_RUNTIME_BRIDGE_SLACK_BYTES 2048u
#define FRAMER_RUNTIME_PHYSICAL_BLOCK_AUDITED_MIN_BYTES 92896u
#define FRAMER_RUNTIME_INTERNAL_RESERVE_BYTES 32768u

#define FRAMER_RUNTIME_OWNER_STEP_MAX_US 8000u
#define FRAMER_RUNTIME_CALLBACK_DEADLINE_US 2000u
#define FRAMER_RUNTIME_OWNER_DELAY_TICKS 1u
#define FRAMER_RUNTIME_MAX_PACKAGE_BYTES 98304u
#define FRAMER_RUNTIME_MAX_SOURCE_BYTES 8192u
#define FRAMER_RUNTIME_MAX_HANDLERS 16u
#define FRAMER_RUNTIME_MAX_TARGETS 16u
#define FRAMER_RUNTIME_MAX_KEYS 16u
#define FRAMER_RUNTIME_MAX_CHORDS 8u
#define FRAMER_RUNTIME_CAPABILITY_PAGES 13u

#define FRAMER_RUNTIME_TOKEN_SPACE 0x0000002cu
#define FRAMER_RUNTIME_TOKEN_LEFT_SHIFT 0x000000e1u
#define FRAMER_RUNTIME_TWO_KEY_CHORD_MASK 0x00000003u

#define FRAMER_RUNTIME_WEATHER_RPC_ID 0x0000b24du
#define FRAMER_RUNTIME_FAULT_TIMEOUT_VALUE UINT32_C(0x80000000)
#define FRAMER_RUNTIME_FAULT_TIMEOUT_AUXILIARY UINT32_C(0x54494d45)
#define FRAMER_RUNTIME_FAULT_OOM_VALUE UINT32_C(0x80000001)
#define FRAMER_RUNTIME_FAULT_OOM_AUXILIARY UINT32_C(0x4f4f4d21)
#define FRAMER_RUNTIME_RESULT_TIMEOUT (-6)
#define FRAMER_RUNTIME_RESULT_OOM (-7)

#define FRAMER_RUNTIME_RPC_METHOD_CAP "widget.mquickjs.cap"
#define FRAMER_RUNTIME_RPC_METHOD_TELEMETRY "widget.mquickjs.telemetry"
#define FRAMER_RUNTIME_RPC_METHOD_EVENT "widget.mquickjs.event"
#define FRAMER_RUNTIME_RPC_METHOD_RECEIPT "widget.mquickjs.receipt"
#define FRAMER_RUNTIME_RPC_METHOD_UPLOAD "widget.mquickjs.upload"

#define FRAMER_RUNTIME_ADDR_ESP_TIMER_GET_TIME 0x4037e028u
#define FRAMER_RUNTIME_ADDR_HEAP_CAPS_FREE 0x4037e250u
#define FRAMER_RUNTIME_ADDR_HEAP_CAPS_MALLOC 0x4037e55cu
#define FRAMER_RUNTIME_ADDR_STACK_HIGH_WATER 0x4038daf4u
#define FRAMER_RUNTIME_ADDR_VTASK_DELAY 0x4038dc3cu
#define FRAMER_RUNTIME_ADDR_TASK_CREATE_STATIC 0x4038e950u
#define FRAMER_RUNTIME_ADDR_CURRENT_TASK_FOR_CORE 0x4038eb7cu
#define FRAMER_RUNTIME_ADDR_HEAP_FREE_SIZE 0x420c8200u
#define FRAMER_RUNTIME_ADDR_HEAP_LARGEST_BLOCK 0x420c82c4u
#define FRAMER_RUNTIME_ADDR_ROOT_GETTER 0x42004e1cu
#define FRAMER_RUNTIME_ADDR_REGISTRY_FROM_ROOT 0x4210ad9cu
#define FRAMER_RUNTIME_ADDR_CURRENT_CONTROLLER 0x4210af48u
#define FRAMER_RUNTIME_ADDR_KEY_CALLBACK 0x4206eae0u
#define FRAMER_RUNTIME_ADDR_RPC_REGISTRY 0x42004afcu
#define FRAMER_RUNTIME_ADDR_RPC_REGISTER_ONE 0x4211b7c8u
#define FRAMER_RUNTIME_ADDR_RPC_MAKE_ROOT 0x4211bac8u
#define FRAMER_RUNTIME_ADDR_RPC_READ_INTEGER 0x4211ba2cu
#define FRAMER_RUNTIME_ADDR_RPC_REPLY_STATUS 0x4211ba58u

typedef enum {
    FRAMER_RUNTIME_RECEIPT_COLD = 0,
    FRAMER_RUNTIME_RECEIPT_QUEUED = 1,
    FRAMER_RUNTIME_RECEIPT_APPLIED = 2,
    FRAMER_RUNTIME_RECEIPT_REJECTED = 3,
    FRAMER_RUNTIME_RECEIPT_BUSY = 4,
    FRAMER_RUNTIME_RECEIPT_HIDDEN = 5,
    FRAMER_RUNTIME_RECEIPT_FAULTED = 6,
} framer_runtime_receipt_state;

/* The first 320 bytes reproduce the offsets consumed by the accepted
 * renderer_scene_rpc_reply_status helper. Method storage follows that ABI
 * window so the response value can use the full +200..+312 owned range. */
typedef struct {
    uint32_t callback_lock;          /* +0, not interpreted when success set. */
    uint32_t callback_calls;         /* +4, registration observability. */
    uint8_t reserved_008[184];
    char blocked[8];                 /* +192, persistent fallback. */
    char value[113];                 /* +200, persistent response value. */
    char status_key[7];              /* +313, exact stock helper offset. */
    char method[32];                 /* +320, persistent registry method. */
} framer_runtime_rpc_context;

typedef struct {
    uint32_t state;
    uint32_t queue_depth;
    uint32_t event_sequence;
    uint32_t generation;
    uint32_t revision;
    uint32_t event_id;
    int32_t event_value;
    int32_t event_auxiliary;
    uint32_t applied_generation;
    uint32_t applied_revision;
    uint32_t rejected_count;
    uint32_t rejection_code;
} framer_runtime_receipt_snapshot;

typedef struct {
    uint32_t sequence;
    framer_runtime_receipt_snapshot fields;
} framer_runtime_receipt;

typedef struct {
    char base_app_sha256[65];
    char module_sha256[65];
    char package_sha256[65];
    uint64_t boot_id;
    uint32_t generation;
    uint32_t key_events;
    uint32_t chord_events;
    /* Nonzero when the module registers widget.mquickjs.upload, so cap page 0
     * advertises uploader=1 and the Designer enables its push gate. */
    uint32_t runtime_uploader;
} framer_runtime_capability;

typedef struct {
    uint64_t boot_id;
    uint64_t uptime_us;
    uint64_t polls;
    uint32_t free_internal;
    uint32_t largest_internal;
    uint32_t heap_current;
    uint32_t heap_high_water;
    uint32_t stack_minimum;
    uint32_t callbacks;
    uint32_t deadline_us;
    uint32_t timeouts;
    uint32_t oom;
    uint32_t exceptions;
    uint32_t max_slice_us;
    uint32_t loads;
    uint32_t source_rejected;
    uint32_t publish_failed;
    uint32_t wrong_thread;
    uint32_t recoveries;
    uint32_t recovery_failures;
    int32_t last_result;
    uint32_t last_event_sequence;
    uint32_t fatal;
    uint32_t queue_depth;
    uint32_t events_queued;
    uint32_t events_applied;
    uint32_t events_rejected;
    uint32_t mailbox_sequence;
    uint32_t applied_generation;
    uint32_t applied_revision;
    uint32_t delays;
    uint32_t screen;
    uint32_t visible;
    uint32_t replay_count;
    uint32_t key_observations;
    uint32_t last_token;
    uint32_t last_level;
    uint32_t key_gate;
    uint32_t chord_active;
    uint32_t weather_applied_revision;
} framer_runtime_telemetry;

typedef struct {
    uint32_t sequence;
    uint32_t last_token;
    uint32_t last_level;
    uint32_t observation_count;
    uint32_t space_down;
    uint32_t space_up;
    uint32_t shift_down;
    uint32_t shift_up;
    uint32_t committed;
} framer_runtime_key_probe;

typedef struct {
    uint32_t sequence;
    uint32_t visible;
    uint32_t key_ingress_enabled;
    uint32_t release_all_pending;
    uint32_t replay_pending;
    uint32_t last_good_valid;
    uint32_t last_good_generation;
    uint32_t last_good_revision;
} framer_runtime_visibility;

typedef struct {
    void *opaque;
    size_t (*free_size)(void *opaque, uint32_t caps);
    size_t (*largest_block)(void *opaque, uint32_t caps);
    void *(*allocate)(void *opaque, size_t bytes, uint32_t caps);
    void (*release)(void *opaque, void *allocation);
    int (*internal_range)(void *opaque, const void *allocation, size_t bytes);
} framer_runtime_heap_api;

typedef struct {
    void *block;
    uint32_t block_bytes;
    uint32_t sampled_free;
    uint32_t sampled_largest;
    uint32_t fault;
} framer_runtime_internal_allocations;

typedef struct {
    uint32_t accepting;
    uint32_t inflight;
    uint32_t generation;
} framer_runtime_producer_gate;

typedef int (*framer_runtime_owner_step_fn)(void *opaque);
typedef void (*framer_runtime_delay_fn)(uint32_t ticks);
typedef uint32_t (*framer_runtime_stack_hwm_fn)(void *task);

typedef struct {
    void *opaque;
    void *task;
    framer_runtime_owner_step_fn step;
    framer_runtime_delay_fn delay;
    framer_runtime_stack_hwm_fn stack_high_water;
    uint32_t enabled;
    uint32_t iterations;
    uint32_t steps;
    uint32_t delays;
    uint32_t last_step_result;
    uint32_t minimum_stack_bytes;
} framer_runtime_owner_loop;

void framer_runtime_rpc_init(framer_runtime_rpc_context *context,
                             const char *method);
int framer_runtime_rpc_begin(framer_runtime_rpc_context *context);
void framer_runtime_rpc_end(framer_runtime_rpc_context *context);

void framer_runtime_receipt_init(framer_runtime_receipt *receipt);
void framer_runtime_receipt_publish(
    framer_runtime_receipt *receipt,
    const framer_runtime_receipt_snapshot *snapshot);
int framer_runtime_receipt_try_read(
    const framer_runtime_receipt *receipt,
    framer_runtime_receipt_snapshot *snapshot);
int framer_runtime_receipt_format(
    const framer_runtime_receipt_snapshot *snapshot,
    char output[113]);
int framer_runtime_capability_format(
    const framer_runtime_capability *capability,
    uint32_t page,
    char output[113]);
int framer_runtime_telemetry_format(
    const framer_runtime_telemetry *telemetry,
    uint32_t page,
    char output[113]);
int framer_runtime_status_copy(const char *value, char output[113]);

void framer_runtime_key_probe_init(framer_runtime_key_probe *probe);
void framer_runtime_key_probe_observe(framer_runtime_key_probe *probe,
                                      uint32_t token, uint8_t level);
int framer_runtime_key_probe_can_commit(const framer_runtime_key_probe *probe);
int framer_runtime_key_probe_commit(framer_runtime_key_probe *probe);
int framer_runtime_key_probe_try_read(
    const framer_runtime_key_probe *probe,
    framer_runtime_key_probe *snapshot);
int framer_runtime_key_probe_map(const framer_runtime_key_probe *probe,
                                 uint32_t physical_token,
                                 uint32_t *logical_token);

void framer_runtime_visibility_init(framer_runtime_visibility *visibility);
int framer_runtime_visibility_set(framer_runtime_visibility *visibility,
                                  int visible);
void framer_runtime_visibility_publish(framer_runtime_visibility *visibility,
                                       uint32_t generation,
                                       uint32_t revision);
int framer_runtime_visibility_take_replay(framer_runtime_visibility *visibility,
                                          uint32_t *generation,
                                          uint32_t *revision);

int framer_runtime_allocate_internal(
    const framer_runtime_heap_api *api,
    framer_runtime_internal_allocations *allocations,
    size_t exact_block_bytes);
void framer_runtime_release_internal(
    const framer_runtime_heap_api *api,
    framer_runtime_internal_allocations *allocations);

void framer_runtime_producer_init(framer_runtime_producer_gate *gate,
                                  uint32_t generation);
int framer_runtime_producer_enter(framer_runtime_producer_gate *gate,
                                  uint32_t generation);
void framer_runtime_producer_leave(framer_runtime_producer_gate *gate);
void framer_runtime_producer_retire(framer_runtime_producer_gate *gate);
int framer_runtime_producer_retired(const framer_runtime_producer_gate *gate);

int framer_runtime_owner_iteration(framer_runtime_owner_loop *loop);

/* Boot-lifetime canary policy: package/module code does not write flash/NVS,
 * live-unmap, or delete its owner task. Rollback is ROM bootloader + reset. */
int framer_runtime_live_flash_write_allowed(void);

#ifdef __cplusplus
}
#endif

#endif
