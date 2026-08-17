#ifndef FRAMER_MQUICKJS_STOCK_BRIDGE_H
#define FRAMER_MQUICKJS_STOCK_BRIDGE_H

#include <stddef.h>
#include <stdint.h>

/* Deliberate build gate.  This bridge is meaningful only for the accepted
 * healthy application whose complete SHA-256 starts with this word. */
#ifndef FRAMER_STOCK_BRIDGE_EXACT_ABI_ACK
#error "STOCK_BRIDGE_FAIL_CLOSED: define FRAMER_STOCK_BRIDGE_EXACT_ABI_ACK only after verify.mjs passes"
#elif FRAMER_STOCK_BRIDGE_EXACT_ABI_ACK != 0x36317013u
#error "STOCK_BRIDGE_FAIL_CLOSED: healthy application ABI acknowledgement changed"
#endif

#ifdef __cplusplus
extern "C" {
#endif

#define FRAMER_STOCK_BRIDGE_HEALTHY_SHA256 \
    "363170139a06f306be1e894b6f203a9bf03bf4d70d21194aaccdd1c42f760c32"

#define FRAMER_STOCK_SETUP_ENTRY_ADDRESS 0x42118c68u
#define FRAMER_STOCK_SETUP_TAIL_ADDRESS 0x42118cddu
#define FRAMER_STOCK_SETUP_TAIL_BYTES 3u
#define FRAMER_STOCK_KEY_LITERAL_ADDRESS 0x42041568u
#define FRAMER_STOCK_KEY_LITERAL_APP_OFFSET 0x00101568u
#define FRAMER_STOCK_KEY_CALLBACK_ADDRESS 0x4206eae0u
#define FRAMER_STOCK_RENDERER_V1_TICK_ADDRESS 0x4211960cu
#define FRAMER_STOCK_RENDERER_V2_LIVE_TICK_ADDRESS 0x4211dc40u
#define FRAMER_STOCK_RENDERER_V2_SIDECAR_MAGIC 0x32565343u
#define FRAMER_STOCK_RENDERER_V2_SIDECAR_OLD_TICK_OFFSET 4u
#define FRAMER_STOCK_RENDERER_V2_VTABLE_SIDECAR_SLOT 11u

#define FRAMER_MALLOC_CAP_8BIT 0x0004u
#define FRAMER_MALLOC_CAP_SPIRAM 0x0400u
#define FRAMER_MALLOC_CAP_INTERNAL 0x0800u
#define FRAMER_MALLOC_CAP_DEFAULT 0x1000u
#define FRAMER_STOCK_VM_HEAP_BYTES 65536u
#define FRAMER_STOCK_VM_STACK_BYTES 12288u
#define FRAMER_STOCK_STATIC_TASK_BYTES 352u

typedef enum {
    FRAMER_STOCK_BRIDGE_COLD = 0,
    FRAMER_STOCK_BRIDGE_STARTING = 1,
    FRAMER_STOCK_BRIDGE_READY = 2,
    FRAMER_STOCK_BRIDGE_QUIESCING = 3,
    FRAMER_STOCK_BRIDGE_STOPPED = 4,
    FRAMER_STOCK_BRIDGE_FAULTED = 5,
} framer_stock_bridge_lifecycle;

/* This intentionally reproduces the offsets consumed by the already-linked
 * renderer_scene_rpc_reply_status helper.  All method/key/value bytes live in
 * resident-owned RAM for the entire boot; no temporary or mapped-module string
 * is handed to the stock RPC registry. */
typedef struct {
    volatile uint32_t ready;       /* +0: callback chooses blocked/ready. */
    uint8_t reserved_004[188];
    char blocked[8];               /* +192: "blocked\0". */
    char ready_text[8];             /* +200: "ready\0". */
    uint8_t reserved_208[16];
    char method[32];                /* +224: "widget.mquickjs.status\0". */
    uint8_t reserved_256[57];
    char status_key[7];             /* +313: "status\0". */
} framer_stock_bridge_rpc_storage;

struct framer_stock_bridge_state;
typedef int (*framer_stock_bridge_key_sink)(
    struct framer_stock_bridge_state *state, uint32_t opaque_token,
    uint8_t level);
typedef void (*framer_stock_bridge_ui_sink)(
    struct framer_stock_bridge_state *state, void *controller);

typedef struct framer_stock_bridge_state {
    volatile uint32_t lifecycle;
    volatile uint32_t key_ingress_enabled;
    volatile uint32_t key_wrapper_inflight;
    volatile uint32_t ui_ingress_enabled;
    volatile uint32_t ui_wrapper_inflight;
    volatile uint32_t stop_requested;
    volatile uint32_t stop_acknowledged;
    volatile uint32_t rpc_registration_attempted;
    volatile uint32_t module_mapped;
    volatile uint32_t last_fault;
    uint32_t internal_free_bytes;
    uint32_t internal_largest_bytes;
    uint32_t psram_free_bytes;
    uint32_t psram_largest_bytes;
    void *controller;
    void *renderer_sidecar;
    void (*saved_renderer_v1_tick)(void *controller);
    void *task_handle;
    void *vm_heap;
    size_t vm_heap_bytes;
    void *owner_context;
    framer_stock_bridge_key_sink key_sink;
    framer_stock_bridge_ui_sink ui_sink;
    char task_name[16];
    __attribute__((aligned(16))) uint8_t static_task[FRAMER_STOCK_STATIC_TASK_BYTES];
    framer_stock_bridge_rpc_storage rpc;
} framer_stock_bridge_state;

_Static_assert(sizeof(void *) == 4u, "stock bridge is ESP32-S3-only");
_Static_assert(sizeof(framer_stock_bridge_rpc_storage) == 320u,
               "RPC owned-storage ABI changed");
_Static_assert(offsetof(framer_stock_bridge_rpc_storage, blocked) == 192u &&
                   offsetof(framer_stock_bridge_rpc_storage, ready_text) == 200u &&
                   offsetof(framer_stock_bridge_rpc_storage, method) == 224u &&
                   offsetof(framer_stock_bridge_rpc_storage, status_key) == 313u,
               "stock status helper offsets changed");
_Static_assert(sizeof(((framer_stock_bridge_state *)0)->static_task) == 352u,
               "ESP-IDF StaticTask_t proof changed");

/* The resident integration must provide these three symbols.  Leaving any one
 * absent is intentional: the production bridge object then cannot link. */
extern framer_stock_bridge_state framer_stock_bridge_resident_state;
int framer_stock_bridge_resident_boot(framer_stock_bridge_state *state,
                                      void *controller);
void framer_stock_bridge_resident_abort(framer_stock_bridge_state *state);

void framer_stock_bridge_state_init(framer_stock_bridge_state *state);
void framer_stock_bridge_startup(void *controller);

void *framer_stock_bridge_vm_allocate(framer_stock_bridge_state *state,
                                      size_t bytes);
void framer_stock_bridge_vm_free(framer_stock_bridge_state *state);
int framer_stock_bridge_task_start(framer_stock_bridge_state *state,
                                   void (*entry)(void *), void *parameter,
                                   uint8_t *stack, uint32_t stack_bytes,
                                   uint32_t priority, int32_t core_id);
void *framer_stock_bridge_current_task(void);
void framer_stock_bridge_owner_task_exit(framer_stock_bridge_state *state)
    __attribute__((noreturn));

int framer_stock_bridge_ui_install(framer_stock_bridge_state *state,
                                   void *controller);
void framer_stock_bridge_ui_detach(framer_stock_bridge_state *state);
void framer_stock_bridge_ui_owner_tick(void *controller);

void *framer_stock_bridge_key_callback(void *owner,
                                       const uint32_t *opaque_token,
                                       const uint8_t *level);
void framer_stock_bridge_key_activate(framer_stock_bridge_state *state);
void framer_stock_bridge_key_detach(framer_stock_bridge_state *state);

int framer_stock_bridge_rpc_register(framer_stock_bridge_state *state);
void framer_stock_bridge_rpc_callback(void *context, void *response,
                                      void *request);
void framer_stock_bridge_rpc_set_ready(framer_stock_bridge_state *state,
                                       int ready);

void framer_stock_bridge_begin_quiesce(framer_stock_bridge_state *state);
int framer_stock_bridge_try_finish_quiesce(framer_stock_bridge_state *state);
int framer_stock_bridge_flash_safe(const framer_stock_bridge_state *state);

/* Entry-less target for the exact three-byte setup-tail jump. */
void framer_stock_bridge_tail_trampoline(void);

#ifdef __cplusplus
}
#endif

#endif
