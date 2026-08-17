#ifndef FRAMER_PHYSICAL_COMPLETION_CONTRACT_H
#define FRAMER_PHYSICAL_COMPLETION_CONTRACT_H

#include <stdint.h>

/* The terminal receipt is the release point: exact completion fields and a
 * coherent telemetry refresh must both precede it while admission stays
 * closed. */
static inline int framer_physical_completion_can_publish(
    uint32_t completion_fields_ready,
    uint32_t telemetry_refreshed,
    uint32_t admission_closed)
{
    return completion_fields_ready != 0u && telemetry_refreshed != 0u &&
           admission_closed != 0u;
}

static inline int framer_physical_periodic_refresh_due(
    uint32_t terminal_published,
    uint32_t telemetry_elapsed_ms)
{
    return terminal_published == 0u && telemetry_elapsed_ms >= 100u;
}

#endif
