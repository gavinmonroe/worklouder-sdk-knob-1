#ifndef FRAMER_PHYSICAL_FOCUS_CONTRACT_H
#define FRAMER_PHYSICAL_FOCUS_CONTRACT_H

#include <stdint.h>

/* Value-only policy shared by the target implementation and host race model.
 * Atomic ordering is supplied by the caller: target gates/epochs use the
 * single seq-cst order across cleanup, wrappers, and the owner task. */
static inline int framer_physical_focus_can_issue(uint32_t requested,
                                                   uint32_t applied,
                                                   uint32_t draining,
                                                   uint32_t wrappers_inflight)
{
    return requested != applied && draining == 0u && wrappers_inflight == 0u;
}

static inline int framer_physical_focus_can_reopen(uint32_t visible,
                                                    uint32_t requested,
                                                    uint32_t applied,
                                                    uint32_t draining,
                                                    uint32_t permanently_disabled)
{
    return visible != 0u && requested == applied && draining == 0u &&
           permanently_disabled == 0u;
}

static inline int framer_physical_focus_can_ack(uint32_t draining,
                                                 uint32_t owner_input_pending,
                                                 uint32_t engine_pending,
                                                 uint32_t held_mask)
{
    return draining != 0u && owner_input_pending == 0u &&
           engine_pending == 0u && held_mask == 0u;
}

static inline int framer_physical_focus_accepts_key(uint32_t visible,
                                                     uint32_t input_ready)
{
    return visible != 0u && input_ready != 0u;
}

#endif
