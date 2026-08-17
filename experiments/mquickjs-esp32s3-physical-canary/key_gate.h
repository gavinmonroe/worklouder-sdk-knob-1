#ifndef FRAMER_PHYSICAL_KEY_GATE_H
#define FRAMER_PHYSICAL_KEY_GATE_H

#include "../mquickjs-esp32s3-runtime-proof/runtime_proof.h"

#include <stdint.h>

/* Discovery edges are observations only. Even the edge which completes and
 * commits the live token proof returns zero; the next edge is the first one
 * eligible for JavaScript dispatch. */
static inline int framer_physical_key_gate_observe_and_map(
    framer_runtime_key_probe *probe,
    uint32_t native_token,
    uint8_t level,
    uint32_t *logical_token)
{
    uint32_t was_committed;
    if (probe == (framer_runtime_key_probe *)0)
        return 0;
    was_committed = __atomic_load_n(&probe->committed, __ATOMIC_ACQUIRE);
    framer_runtime_key_probe_observe(probe, native_token, level);
    if (was_committed == 0u) {
        if (framer_runtime_key_probe_can_commit(probe))
            (void)framer_runtime_key_probe_commit(probe);
        return 0;
    }
    return framer_runtime_key_probe_map(probe, native_token, logical_token);
}

#endif
