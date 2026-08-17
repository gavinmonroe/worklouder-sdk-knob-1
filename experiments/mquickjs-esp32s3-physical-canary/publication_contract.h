#ifndef FRAMER_PHYSICAL_PUBLICATION_CONTRACT_H
#define FRAMER_PHYSICAL_PUBLICATION_CONTRACT_H

#include <stddef.h>
#include <stdint.h>

#define FRAMER_PHYSICAL_PROXY_ROOT_OFFSET 12u
#define FRAMER_PHYSICAL_PROXY_REGISTRY_OFFSET 20u
#define FRAMER_PHYSICAL_STOCK_INTERNAL_BEGIN 0x3fc80000u
#define FRAMER_PHYSICAL_STOCK_INTERNAL_END 0x3fd00000u
#define FRAMER_PHYSICAL_STOCK_POINTER_BYTES 4u

/* addController owns only the registry association. The common base slot0
 * owns root creation later, immediately before the screen-specific build
 * callback. These helpers deliberately keep those two admissions separate. */
static inline int framer_physical_registration_matches(
    const void *actual_registry,
    const void *expected_registry)
{
    return actual_registry != (const void *)0 &&
           actual_registry == expected_registry;
}

static inline int framer_physical_lifecycle_root_ready(
    const void *root)
{
    uintptr_t start = (uintptr_t)root;
    uintptr_t end = start + FRAMER_PHYSICAL_STOCK_POINTER_BYTES;
    if (end < start ||
        (start & (FRAMER_PHYSICAL_STOCK_POINTER_BYTES - 1u)) != 0u)
        return 0;
    return start >= FRAMER_PHYSICAL_STOCK_INTERNAL_BEGIN &&
           end <= FRAMER_PHYSICAL_STOCK_INTERNAL_END;
}

#endif
