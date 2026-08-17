#ifndef FRAMER_PHYSICAL_TELEMETRY_SESSION_H
#define FRAMER_PHYSICAL_TELEMETRY_SESSION_H

#include "../mquickjs-esp32s3-runtime-proof/runtime_proof.h"

#include <stdint.h>

#define FRAMER_PHYSICAL_TELEMETRY_SESSION_TIMEOUT_MS 2000u
#define FRAMER_PHYSICAL_TELEMETRY_PAGES 6u

typedef struct {
    framer_runtime_telemetry snapshot;
    uint32_t ui_max_us;
    uint32_t expected_page;
    uint32_t deadline_ms;
} framer_physical_telemetry_session;

/* Selects the one immutable sample used by an ordered p0..p5 transaction.
 * The caller serializes this state with the telemetry RPC context lock.
 * `latest` is required only for page zero; later pages never read it. */
static inline int framer_physical_telemetry_session_select(
    framer_physical_telemetry_session *session,
    int32_t page,
    uint32_t now_ms,
    const framer_runtime_telemetry *latest,
    uint32_t latest_ui_max_us,
    const framer_runtime_telemetry **selected)
{
    uint32_t active;
    uint32_t expired;
    if (session == (framer_physical_telemetry_session *)0 ||
        selected == (const framer_runtime_telemetry **)0) {
        return 0;
    }
    *selected = (const framer_runtime_telemetry *)0;
    active = session->expected_page;
    expired = active != 0u &&
        (int32_t)(now_ms - session->deadline_ms) >= 0;
    if (page < 0 || page >= (int32_t)FRAMER_PHYSICAL_TELEMETRY_PAGES) {
        session->expected_page = 0u;
        return 0;
    }
    if (page == 0) {
        /* A live duplicate clears and rejects. An expired session may be
         * replaced immediately by a fresh page-zero sample. */
        if ((active != 0u && !expired) ||
            latest == (const framer_runtime_telemetry *)0) {
            session->expected_page = 0u;
            return 0;
        }
        session->snapshot = *latest;
        session->ui_max_us = latest_ui_max_us;
        session->expected_page = 1u;
        session->deadline_ms =
            now_ms + FRAMER_PHYSICAL_TELEMETRY_SESSION_TIMEOUT_MS;
        *selected = &session->snapshot;
        return 1;
    }
    if (active == 0u || expired || (uint32_t)page != active) {
        session->expected_page = 0u;
        return 0;
    }
    *selected = &session->snapshot;
    if ((uint32_t)page + 1u == FRAMER_PHYSICAL_TELEMETRY_PAGES)
        session->expected_page = 0u;
    else
        session->expected_page = (uint32_t)page + 1u;
    return 1;
}

static inline int framer_physical_telemetry_append_ui_max(
    char output[113], uint32_t ui_max_us)
{
    static const char digits[] = "0123456789abcdef";
    uint32_t index = 0u;
    uint32_t shift;
    if (output == (char *)0)
        return 0;
    while (index < 113u && output[index] != 0)
        ++index;
    if (index + 11u >= 113u)
        return 0;
    output[index++] = ';';
    output[index++] = 'U';
    output[index++] = '=';
    for (shift = 28u;; shift -= 4u) {
        output[index++] = digits[(ui_max_us >> shift) & 15u];
        if (shift == 0u)
            break;
    }
    output[index] = 0;
    return 1;
}

#endif
