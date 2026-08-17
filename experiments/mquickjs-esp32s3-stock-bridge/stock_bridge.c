#include "stock_bridge.h"

/* Absolute symbols are supplied only by stock_bridge.ld after verify.mjs pins
 * the complete accepted-image spans. */
extern void *framer_stock_heap_caps_malloc(size_t bytes, uint32_t caps);
extern void framer_stock_heap_caps_free(void *allocation);
extern size_t framer_stock_heap_caps_get_free_size(uint32_t caps);
extern size_t framer_stock_heap_caps_get_largest_free_block(uint32_t caps);
extern void *framer_stock_task_create_static_pinned(
    void (*entry)(void *), const char *name, uint32_t stack_bytes,
    void *parameter, uint32_t priority, uint8_t *stack,
    void *static_task, int32_t core_id);
extern void framer_stock_task_delete(void *task);
extern void *framer_stock_task_current_for_core(int32_t core_id);
extern void *framer_stock_key_callback_original(
    void *owner, const uint32_t *opaque_token, const uint8_t *level);
extern void *framer_stock_rpc_registry(void);
extern void framer_stock_rpc_register_one(void *registry, void *context,
                                          const char *method,
                                          uint32_t method_bytes,
                                          void *dispatch_thunk);
extern void framer_stock_rpc_reply_status(void *response, void *request,
                                          uint32_t success, void *context);

enum {
    FRAMER_STOCK_FAULT_CONTROLLER = 1u,
    FRAMER_STOCK_FAULT_RESIDENT_BOOT = 2u,
    FRAMER_STOCK_FAULT_UI_HOOK = 3u,
    FRAMER_STOCK_FAULT_RPC = 4u,
    FRAMER_STOCK_FAULT_HEAP = 5u,
    FRAMER_STOCK_FAULT_TASK = 6u,
};

static void zero_bytes(void *value, size_t bytes)
{
    uint8_t *cursor = (uint8_t *)value;
    while (bytes-- != 0u)
        *cursor++ = 0u;
}

static int in_range(uintptr_t value, size_t bytes, uintptr_t begin,
                    uintptr_t end)
{
    uintptr_t limit = value + (uintptr_t)bytes;
    return value >= begin && value < end && limit >= value && limit <= end;
}

static int writable_data(const void *value, size_t bytes)
{
    uintptr_t address = (uintptr_t)value;
    if ((address & (sizeof(void *) - 1u)) != 0u)
        return 0;
    /* The first range is the exact current two-MiB PSRAM window.  The second
     * is the ESP32-S3 internal DRAM data window used by stock heap objects. */
    return in_range(address, bytes, 0x3c1d0000u, 0x3c3d0000u) ||
           in_range(address, bytes, 0x3fc80000u, 0x3fd00000u);
}

static int internal_data(const void *value, size_t bytes)
{
    return in_range((uintptr_t)value, bytes, 0x3fc80000u, 0x3fd00000u);
}

static void init_owned_strings(framer_stock_bridge_rpc_storage *rpc)
{
    static const uint32_t method_words[6] = {
        0x67646977u, 0x6d2e7465u, 0x63697571u,
        0x2e736a6bu, 0x74617473u, 0x00007375u,
    };
    uint32_t *method;
    uint32_t index;
    zero_bytes(rpc, sizeof(*rpc));
    rpc->blocked[0] = 'b'; rpc->blocked[1] = 'l';
    rpc->blocked[2] = 'o'; rpc->blocked[3] = 'c';
    rpc->blocked[4] = 'k'; rpc->blocked[5] = 'e';
    rpc->blocked[6] = 'd'; rpc->blocked[7] = 0;
    rpc->ready_text[0] = 'r'; rpc->ready_text[1] = 'e';
    rpc->ready_text[2] = 'a'; rpc->ready_text[3] = 'd';
    rpc->ready_text[4] = 'y'; rpc->ready_text[5] = 0;
    method = (uint32_t *)(void *)rpc->method;
    for (index = 0u; index < 6u; ++index)
        method[index] = method_words[index];
    rpc->status_key[0] = 's'; rpc->status_key[1] = 't';
    rpc->status_key[2] = 'a'; rpc->status_key[3] = 't';
    rpc->status_key[4] = 'u'; rpc->status_key[5] = 's';
    rpc->status_key[6] = 0;
}

void framer_stock_bridge_state_init(framer_stock_bridge_state *state)
{
    if (state == (framer_stock_bridge_state *)0)
        return;
    zero_bytes(state, sizeof(*state));
    state->task_name[0] = 'f'; state->task_name[1] = 'r';
    state->task_name[2] = 'a'; state->task_name[3] = 'm';
    state->task_name[4] = 'e'; state->task_name[5] = 'r';
    state->task_name[6] = '-'; state->task_name[7] = 'm';
    state->task_name[8] = 'q'; state->task_name[9] = 'j';
    state->task_name[10] = 's'; state->task_name[11] = 0;
    init_owned_strings(&state->rpc);
    __atomic_store_n(&state->lifecycle, FRAMER_STOCK_BRIDGE_COLD,
                     __ATOMIC_RELEASE);
}

static void *probe_renderer_sidecar(void *controller)
{
    void **vtable;
    void *sidecar;
    if (!writable_data(controller, sizeof(void *)))
        return (void *)0;
    vtable = *(void ***)controller;
    if (!writable_data(vtable, 12u * sizeof(void *)) ||
        vtable[6] != (void *)(uintptr_t)FRAMER_STOCK_RENDERER_V2_LIVE_TICK_ADDRESS)
        return (void *)0;
    sidecar = vtable[FRAMER_STOCK_RENDERER_V2_VTABLE_SIDECAR_SLOT];
    if (!writable_data(sidecar, 3u * sizeof(void *)) ||
        *(const uint32_t *)sidecar != FRAMER_STOCK_RENDERER_V2_SIDECAR_MAGIC)
        return (void *)0;
    return sidecar;
}

void *framer_stock_bridge_vm_allocate(framer_stock_bridge_state *state,
                                      size_t bytes)
{
    const uint32_t caps = FRAMER_MALLOC_CAP_SPIRAM | FRAMER_MALLOC_CAP_8BIT;
    void *allocation;
    if (state == (framer_stock_bridge_state *)0 || bytes == 0u ||
        state->vm_heap != (void *)0)
        return (void *)0;
    state->psram_free_bytes =
        (uint32_t)framer_stock_heap_caps_get_free_size(caps);
    state->psram_largest_bytes =
        (uint32_t)framer_stock_heap_caps_get_largest_free_block(caps);
    state->internal_free_bytes = (uint32_t)framer_stock_heap_caps_get_free_size(
        FRAMER_MALLOC_CAP_INTERNAL | FRAMER_MALLOC_CAP_8BIT);
    state->internal_largest_bytes =
        (uint32_t)framer_stock_heap_caps_get_largest_free_block(
            FRAMER_MALLOC_CAP_INTERNAL | FRAMER_MALLOC_CAP_8BIT);
    if (state->psram_free_bytes < bytes || state->psram_largest_bytes < bytes)
        return (void *)0;
    allocation = framer_stock_heap_caps_malloc(bytes, caps);
    if (!in_range((uintptr_t)allocation, bytes, 0x3c1d0000u, 0x3c3d0000u)) {
        if (allocation != (void *)0)
            framer_stock_heap_caps_free(allocation);
        state->last_fault = FRAMER_STOCK_FAULT_HEAP;
        return (void *)0;
    }
    state->vm_heap = allocation;
    state->vm_heap_bytes = bytes;
    return allocation;
}

void framer_stock_bridge_vm_free(framer_stock_bridge_state *state)
{
    void *allocation;
    if (state == (framer_stock_bridge_state *)0)
        return;
    allocation = state->vm_heap;
    state->vm_heap = (void *)0;
    state->vm_heap_bytes = 0u;
    if (allocation != (void *)0)
        framer_stock_heap_caps_free(allocation);
}

int framer_stock_bridge_task_start(framer_stock_bridge_state *state,
                                   void (*entry)(void *), void *parameter,
                                   uint8_t *stack, uint32_t stack_bytes,
                                   uint32_t priority, int32_t core_id)
{
    void *task;
    if (state == (framer_stock_bridge_state *)0 || entry == (void (*)(void *))0 ||
        state->task_handle != (void *)0 || stack_bytes < FRAMER_STOCK_VM_STACK_BYTES ||
        ((uintptr_t)stack & 15u) != 0u ||
        !internal_data(stack, stack_bytes) || (core_id != 0 && core_id != 1))
        return 0;
    zero_bytes(state->static_task, sizeof(state->static_task));
    task = framer_stock_task_create_static_pinned(
        entry, state->task_name, stack_bytes, parameter, priority, stack,
        state->static_task, core_id);
    if (task == (void *)0) {
        state->last_fault = FRAMER_STOCK_FAULT_TASK;
        return 0;
    }
    state->task_handle = task;
    return 1;
}

static int32_t current_core(void)
{
    uint32_t processor_id;
    __asm__ __volatile__("rsr.prid %0" : "=a"(processor_id));
    return (int32_t)((processor_id >> 13u) & 1u);
}

void *framer_stock_bridge_current_task(void)
{
    return framer_stock_task_current_for_core(current_core());
}

void framer_stock_bridge_owner_task_exit(framer_stock_bridge_state *state)
{
    if (state != (framer_stock_bridge_state *)0) {
        state->task_handle = (void *)0;
        __atomic_store_n(&state->stop_acknowledged, 1u, __ATOMIC_RELEASE);
    }
    framer_stock_task_delete((void *)0);
    __builtin_unreachable();
}

int framer_stock_bridge_ui_install(framer_stock_bridge_state *state,
                                   void *controller)
{
    uint8_t *sidecar;
    void *expected;
    void *replacement = (void *)(uintptr_t)framer_stock_bridge_ui_owner_tick;
    if (state != &framer_stock_bridge_resident_state)
        return 0;
    sidecar = (uint8_t *)probe_renderer_sidecar(controller);
    if (sidecar == (uint8_t *)0)
        return 0;
    state->controller = controller;
    state->renderer_sidecar = sidecar;
    state->saved_renderer_v1_tick =
        (void (*)(void *))(uintptr_t)FRAMER_STOCK_RENDERER_V1_TICK_ADDRESS;
    expected = (void *)(uintptr_t)FRAMER_STOCK_RENDERER_V1_TICK_ADDRESS;
    if (!__atomic_compare_exchange_n((void **)(void *)(sidecar +
            FRAMER_STOCK_RENDERER_V2_SIDECAR_OLD_TICK_OFFSET),
            &expected, replacement, 0, __ATOMIC_ACQ_REL, __ATOMIC_ACQUIRE)) {
        state->saved_renderer_v1_tick = (void (*)(void *))0;
        state->renderer_sidecar = (void *)0;
        return 0;
    }
    __atomic_store_n(&state->ui_ingress_enabled, 1u, __ATOMIC_RELEASE);
    return 1;
}

void framer_stock_bridge_ui_owner_tick(void *controller)
{
    framer_stock_bridge_state *state = &framer_stock_bridge_resident_state;
    void (*old_tick)(void *);
    __atomic_fetch_add(&state->ui_wrapper_inflight, 1u, __ATOMIC_ACQ_REL);
    old_tick = state->saved_renderer_v1_tick;
    if (old_tick != (void (*)(void *))0)
        old_tick(controller);
    if (__atomic_load_n(&state->ui_ingress_enabled, __ATOMIC_ACQUIRE) != 0u &&
        state->ui_sink != (framer_stock_bridge_ui_sink)0)
        state->ui_sink(state, controller);
    __atomic_fetch_sub(&state->ui_wrapper_inflight, 1u, __ATOMIC_ACQ_REL);
}

void framer_stock_bridge_ui_detach(framer_stock_bridge_state *state)
{
    uint8_t *sidecar;
    void *expected;
    if (state == (framer_stock_bridge_state *)0)
        return;
    __atomic_store_n(&state->ui_ingress_enabled, 0u, __ATOMIC_RELEASE);
    sidecar = (uint8_t *)state->renderer_sidecar;
    if (writable_data(sidecar, 2u * sizeof(void *))) {
        expected = (void *)(uintptr_t)framer_stock_bridge_ui_owner_tick;
        (void)__atomic_compare_exchange_n((void **)(void *)(sidecar +
                FRAMER_STOCK_RENDERER_V2_SIDECAR_OLD_TICK_OFFSET),
                &expected, (void *)(uintptr_t)state->saved_renderer_v1_tick, 0,
                __ATOMIC_ACQ_REL, __ATOMIC_ACQUIRE);
    }
}

void *framer_stock_bridge_key_callback(void *owner,
                                       const uint32_t *opaque_token,
                                       const uint8_t *level)
{
    framer_stock_bridge_state *state = &framer_stock_bridge_resident_state;
    void *result;
    __atomic_fetch_add(&state->key_wrapper_inflight, 1u, __ATOMIC_ACQ_REL);
    /* Stock always runs first and its exact return value is preserved. */
    result = framer_stock_key_callback_original(owner, opaque_token, level);
    if (__atomic_load_n(&state->key_ingress_enabled, __ATOMIC_ACQUIRE) != 0u &&
        opaque_token != (const uint32_t *)0 && level != (const uint8_t *)0 &&
        state->key_sink != (framer_stock_bridge_key_sink)0)
        (void)state->key_sink(state, *opaque_token, *level);
    __atomic_fetch_sub(&state->key_wrapper_inflight, 1u, __ATOMIC_ACQ_REL);
    return result;
}

void framer_stock_bridge_key_activate(framer_stock_bridge_state *state)
{
    if (state != (framer_stock_bridge_state *)0)
        __atomic_store_n(&state->key_ingress_enabled, 1u, __ATOMIC_RELEASE);
}

void framer_stock_bridge_key_detach(framer_stock_bridge_state *state)
{
    if (state != (framer_stock_bridge_state *)0)
        __atomic_store_n(&state->key_ingress_enabled, 0u, __ATOMIC_RELEASE);
}

void framer_stock_bridge_rpc_callback(void *context, void *response,
                                      void *request)
{
    framer_stock_bridge_rpc_storage *rpc =
        (framer_stock_bridge_rpc_storage *)context;
    uint32_t ready = rpc == (framer_stock_bridge_rpc_storage *)0 ? 0u :
        __atomic_load_n(&rpc->ready, __ATOMIC_ACQUIRE);
    if (rpc != (framer_stock_bridge_rpc_storage *)0 && response != (void *)0 &&
        request != (void *)0)
        framer_stock_rpc_reply_status(response, request, ready != 0u, rpc);
}

int framer_stock_bridge_rpc_register(framer_stock_bridge_state *state)
{
    void *registry;
    if (state == (framer_stock_bridge_state *)0)
        return 0;
    registry = framer_stock_rpc_registry();
    if (registry == (void *)0)
        return 0;
    framer_stock_rpc_register_one(registry, &state->rpc, state->rpc.method, 22u,
                                  (void *)(uintptr_t)framer_stock_bridge_rpc_callback);
    /* The stock registration helper has no delivery receipt.  This flag means
     * attempted, never that a host has observed or applied the capability. */
    __atomic_store_n(&state->rpc_registration_attempted, 1u, __ATOMIC_RELEASE);
    return 1;
}

void framer_stock_bridge_rpc_set_ready(framer_stock_bridge_state *state,
                                       int ready)
{
    if (state != (framer_stock_bridge_state *)0)
        __atomic_store_n(&state->rpc.ready, ready != 0 ? 1u : 0u,
                         __ATOMIC_RELEASE);
}

void framer_stock_bridge_startup(void *controller)
{
    framer_stock_bridge_state *state = &framer_stock_bridge_resident_state;
    framer_stock_bridge_state_init(state);
    __atomic_store_n(&state->lifecycle, FRAMER_STOCK_BRIDGE_STARTING,
                     __ATOMIC_RELEASE);
    state->controller = controller;
    state->renderer_sidecar = probe_renderer_sidecar(controller);
    if (state->renderer_sidecar == (void *)0) {
        state->last_fault = FRAMER_STOCK_FAULT_CONTROLLER;
        __atomic_store_n(&state->lifecycle, FRAMER_STOCK_BRIDGE_FAULTED,
                         __ATOMIC_RELEASE);
        return;
    }
    if (!framer_stock_bridge_resident_boot(state, controller)) {
        state->last_fault = FRAMER_STOCK_FAULT_RESIDENT_BOOT;
        __atomic_store_n(&state->lifecycle, FRAMER_STOCK_BRIDGE_FAULTED,
                         __ATOMIC_RELEASE);
        return;
    }
    if (!framer_stock_bridge_ui_install(state, controller)) {
        state->last_fault = FRAMER_STOCK_FAULT_UI_HOOK;
        framer_stock_bridge_resident_abort(state);
        __atomic_store_n(&state->lifecycle, FRAMER_STOCK_BRIDGE_FAULTED,
                         __ATOMIC_RELEASE);
        return;
    }
    if (!framer_stock_bridge_rpc_register(state)) {
        state->last_fault = FRAMER_STOCK_FAULT_RPC;
        framer_stock_bridge_ui_detach(state);
        framer_stock_bridge_resident_abort(state);
        __atomic_store_n(&state->lifecycle, FRAMER_STOCK_BRIDGE_FAULTED,
                         __ATOMIC_RELEASE);
        return;
    }
    framer_stock_bridge_key_activate(state);
    framer_stock_bridge_rpc_set_ready(state, 1);
    __atomic_store_n(&state->lifecycle, FRAMER_STOCK_BRIDGE_READY,
                     __ATOMIC_RELEASE);
}

void framer_stock_bridge_begin_quiesce(framer_stock_bridge_state *state)
{
    if (state == (framer_stock_bridge_state *)0)
        return;
    framer_stock_bridge_rpc_set_ready(state, 0);
    __atomic_store_n(&state->lifecycle, FRAMER_STOCK_BRIDGE_QUIESCING,
                     __ATOMIC_RELEASE);
    framer_stock_bridge_key_detach(state);
    framer_stock_bridge_ui_detach(state);
    __atomic_store_n(&state->stop_requested, 1u, __ATOMIC_RELEASE);
}

int framer_stock_bridge_try_finish_quiesce(framer_stock_bridge_state *state)
{
    if (state == (framer_stock_bridge_state *)0 ||
        __atomic_load_n(&state->lifecycle, __ATOMIC_ACQUIRE) !=
            FRAMER_STOCK_BRIDGE_QUIESCING ||
        __atomic_load_n(&state->key_wrapper_inflight, __ATOMIC_ACQUIRE) != 0u ||
        __atomic_load_n(&state->ui_wrapper_inflight, __ATOMIC_ACQUIRE) != 0u ||
        __atomic_load_n(&state->stop_acknowledged, __ATOMIC_ACQUIRE) == 0u ||
        state->task_handle != (void *)0 || state->vm_heap != (void *)0 ||
        __atomic_load_n(&state->module_mapped, __ATOMIC_ACQUIRE) != 0u)
        return 0;
    __atomic_store_n(&state->lifecycle, FRAMER_STOCK_BRIDGE_STOPPED,
                     __ATOMIC_RELEASE);
    return 1;
}

int framer_stock_bridge_flash_safe(const framer_stock_bridge_state *state)
{
    return state != (const framer_stock_bridge_state *)0 &&
        __atomic_load_n(&state->lifecycle, __ATOMIC_ACQUIRE) ==
            FRAMER_STOCK_BRIDGE_STOPPED &&
        __atomic_load_n(&state->key_wrapper_inflight, __ATOMIC_ACQUIRE) == 0u &&
        __atomic_load_n(&state->ui_wrapper_inflight, __ATOMIC_ACQUIRE) == 0u &&
        __atomic_load_n(&state->module_mapped, __ATOMIC_ACQUIRE) == 0u &&
        state->task_handle == (void *)0 && state->vm_heap == (void *)0;
}
