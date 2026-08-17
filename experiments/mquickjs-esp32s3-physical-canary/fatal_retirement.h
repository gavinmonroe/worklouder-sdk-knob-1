#ifndef FRAMER_PHYSICAL_FATAL_RETIREMENT_H
#define FRAMER_PHYSICAL_FATAL_RETIREMENT_H

#include <stdint.h>

static inline int framer_physical_claim_fatal_retirement(
    volatile uint32_t *retired,
    uint32_t permanently_disabled)
{
    uint32_t expected = 0u;
    return retired != (volatile uint32_t *)0 && permanently_disabled != 0u &&
        __atomic_compare_exchange_n(retired, &expected, 1u, 0,
                                    __ATOMIC_ACQ_REL, __ATOMIC_ACQUIRE);
}

#endif
