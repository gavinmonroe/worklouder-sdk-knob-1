#include <stddef.h>
#include <stdint.h>

#include "key_token.h"

#ifndef FRAMER_PHYSICAL_ID_VADDR
#error "resident key wrapper must pin the mapped ID28 identity"
#endif
#ifndef FRAMER_PHYSICAL_KEY_SINK_VADDR
#error "resident key wrapper must pin the mapped ID28 key sink"
#endif

typedef void *(*stock_key_fn)(void *, const uint32_t *, const uint8_t *);
typedef void *(*pointer_no_args_fn)(void);
typedef void *(*pointer_one_arg_fn)(void *);
typedef void (*mapped_key_sink_fn)(void *, uint32_t, uint8_t);

#define STOCK_KEY_ORIGINAL ((stock_key_fn)(uintptr_t)0x4206eae0u)
#define STOCK_ROOT_GET ((pointer_no_args_fn)(uintptr_t)0x42004e1cu)
#define STOCK_REGISTRY_FROM_ROOT ((pointer_one_arg_fn)(uintptr_t)0x4210ad9cu)
#define STOCK_CURRENT_CONTROLLER ((pointer_one_arg_fn)(uintptr_t)0x4210af48u)

static int readable_data(const void *pointer, size_t bytes, size_t alignment)
{
    uintptr_t start = (uintptr_t)pointer;
    uintptr_t end = start + bytes;
    if (end < start || alignment == 0u || (start & (alignment - 1u)) != 0u)
        return 0;
    return (start >= 0x3c1d0000u && end <= 0x3c3d0000u) ||
           (start >= 0x3fc80000u && end <= 0x3fd00000u);
}

/* This function remains in the accepted app's IROM zero tail, so a key event
 * before module mapping still calls only stock code. It enters the mapped
 * module only after the exact stock root -> registry -> current-controller
 * chain returns the foreground ID28 proxy and its slot-8 identity matches. */
__attribute__((used, section(".text.physical_key_wrapper")))
void *framer_physical_key_wrapper(void *stock_owner,
                                  const uint32_t *opaque_token,
                                  const uint8_t *level)
{
    void *result = STOCK_KEY_ORIGINAL(stock_owner, opaque_token, level);
    void *root;
    void *registry;
    void *controller;
    void **vtable;
    if (!readable_data(opaque_token, sizeof(*opaque_token), 4u) ||
        !readable_data(level, sizeof(*level), 1u))
        return result;
    root = STOCK_ROOT_GET();
    if (root == (void *)0)
        return result;
    registry = STOCK_REGISTRY_FROM_ROOT(root);
    if (registry == (void *)0)
        return result;
    controller = STOCK_CURRENT_CONTROLLER(registry);
    if (!readable_data(controller, sizeof(void *), 4u))
        return result;
    vtable = *(void ***)controller;
    if (!readable_data(vtable, 11u * sizeof(void *), 4u) ||
        vtable[8] != (void *)(uintptr_t)FRAMER_PHYSICAL_ID_VADDR)
        return result;
    ((mapped_key_sink_fn)(uintptr_t)FRAMER_PHYSICAL_KEY_SINK_VADDR)(
        controller, framer_physical_normalize_key_token(*opaque_token), *level);
    return result;
}
