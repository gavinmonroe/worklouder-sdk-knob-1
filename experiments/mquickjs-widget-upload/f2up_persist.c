#include "f2up_persist.h"
#include "f2up_admission.h"

_Static_assert(FRAMER_F2UP_PERSIST_SECTORS * FRAMER_F2UP_PERSIST_SECTOR_BYTES ==
                   FRAMER_F2UP_PERSIST_END - FRAMER_F2UP_PERSIST_BEGIN,
               "sector plan must cover the widget slot exactly");
_Static_assert(FRAMER_F2UP_HEADER_BYTES + FRAMER_F2UP_MAX_BYTES <=
                   FRAMER_F2UP_PERSIST_END - FRAMER_F2UP_PERSIST_BEGIN,
               "the largest container must fit the slot");

uint32_t framer_f2up_slot_base(uint32_t slot)
{
    if (slot >= FRAMER_F2UP_SLOT_COUNT)
        return 0u;
    return FRAMER_F2UP_PERSIST_BEGIN + slot * FRAMER_F2UP_SLOT_BYTES;
}

int framer_f2up_flash_span_allowed_at(uint32_t base, uint32_t address,
                                      uint32_t bytes)
{
    uint32_t slot;
    int known = 0;
    /* The base must be one of the bank's literal slot bases: the gate never
     * trusts a caller-computed address range. */
    for (slot = 0u; slot < FRAMER_F2UP_SLOT_COUNT; ++slot)
        if (framer_f2up_slot_base(slot) == base)
            known = 1;
    if (!known)
        return 0;
    /* bytes is bounded first so address + bytes cannot wrap. */
    if (bytes < 1u || bytes > FRAMER_F2UP_SLOT_BYTES)
        return 0;
    if (address < base || address > base + FRAMER_F2UP_SLOT_BYTES - bytes)
        return 0;
    return 1;
}

int framer_f2up_flash_span_allowed(uint32_t address, uint32_t bytes)
{
    return framer_f2up_flash_span_allowed_at(FRAMER_F2UP_PERSIST_BEGIN,
                                             address, bytes);
}

/* The context's slot window: base 0 (a zero-initialised context) selects
 * the legacy slot-0 window. */
static uint32_t context_base(const framer_f2up_persist_context *context)
{
    return context->base == 0u ? FRAMER_F2UP_PERSIST_BEGIN : context->base;
}

void framer_f2up_persist_advance(framer_f2up_persist_context *context,
                                 const framer_f2up_flash_ops *ops)
{
    uint8_t scratch[FRAMER_F2UP_PERSIST_VERIFY_BYTES];
    uint32_t address;
    uint32_t span;
    uint32_t index;
    uint32_t payload_bytes;
    if (context == (framer_f2up_persist_context *)0 ||
        ops == (const framer_f2up_flash_ops *)0)
        return;
    if (context->container == (const uint8_t *)0 ||
        context->container_bytes < FRAMER_F2UP_HEADER_BYTES + 12u ||
        context->container_bytes > FRAMER_F2UP_MAX_BYTES) {
        context->state = FRAMER_F2UP_PERSIST_FAILED;
        context->step = FRAMER_F2UP_PSTEP_STORE;
        return;
    }
    payload_bytes = context->container_bytes - FRAMER_F2UP_HEADER_BYTES;
    switch (context->state) {
    case FRAMER_F2UP_PERSIST_ERASE:
        /* All sectors, unconditionally: a shrunk container must never leave a
         * stale tail behind it. Sector 0 goes first, so the old record's magic
         * is gone before any new byte lands. */
        if (context->cursor >= FRAMER_F2UP_PERSIST_SECTORS) {
            context->state = FRAMER_F2UP_PERSIST_WRITE;
            context->cursor = 0u;
            return;
        }
        address = context_base(context) +
                  context->cursor * FRAMER_F2UP_PERSIST_SECTOR_BYTES;
        if (!framer_f2up_flash_span_allowed_at(context_base(context), address,
                                               FRAMER_F2UP_PERSIST_SECTOR_BYTES) ||
            (address & (FRAMER_F2UP_PERSIST_SECTOR_BYTES - 1u)) != 0u) {
            context->state = FRAMER_F2UP_PERSIST_FAILED;
            context->step = FRAMER_F2UP_PSTEP_BOUNDS;
            return;
        }
        if (ops->erase(ops->opaque, address,
                       FRAMER_F2UP_PERSIST_SECTOR_BYTES) != 0) {
            context->state = FRAMER_F2UP_PERSIST_FAILED;
            context->step = FRAMER_F2UP_PSTEP_ERASE;
            return;
        }
        context->cursor += 1u;
        return;
    case FRAMER_F2UP_PERSIST_WRITE:
        if (context->cursor >= payload_bytes) {
            context->state = FRAMER_F2UP_PERSIST_VERIFY;
            context->cursor = 0u;
            return;
        }
        span = payload_bytes - context->cursor;
        if (span > FRAMER_F2UP_PERSIST_CHUNK_BYTES)
            span = FRAMER_F2UP_PERSIST_CHUNK_BYTES;
        address = context_base(context) + FRAMER_F2UP_HEADER_BYTES +
                  context->cursor;
        if (!framer_f2up_flash_span_allowed_at(context_base(context), address,
                                               span)) {
            context->state = FRAMER_F2UP_PERSIST_FAILED;
            context->step = FRAMER_F2UP_PSTEP_BOUNDS;
            return;
        }
        if (ops->write(ops->opaque, address,
                       context->container + FRAMER_F2UP_HEADER_BYTES +
                           context->cursor,
                       span) != 0) {
            context->state = FRAMER_F2UP_PERSIST_FAILED;
            context->step = FRAMER_F2UP_PSTEP_WRITE;
            return;
        }
        context->cursor += span;
        return;
    case FRAMER_F2UP_PERSIST_VERIFY:
        if (context->cursor >= payload_bytes) {
            context->state = FRAMER_F2UP_PERSIST_HEADER;
            context->cursor = 0u;
            return;
        }
        span = payload_bytes - context->cursor;
        if (span > FRAMER_F2UP_PERSIST_VERIFY_BYTES)
            span = FRAMER_F2UP_PERSIST_VERIFY_BYTES;
        address = context_base(context) + FRAMER_F2UP_HEADER_BYTES +
                  context->cursor;
        if (!framer_f2up_flash_span_allowed_at(context_base(context), address,
                                               span)) {
            context->state = FRAMER_F2UP_PERSIST_FAILED;
            context->step = FRAMER_F2UP_PSTEP_BOUNDS;
            return;
        }
        if (ops->read(ops->opaque, address, scratch, span) != 0) {
            context->state = FRAMER_F2UP_PERSIST_FAILED;
            context->step = FRAMER_F2UP_PSTEP_READBACK;
            return;
        }
        for (index = 0u; index < span; ++index) {
            if (scratch[index] !=
                context->container[FRAMER_F2UP_HEADER_BYTES +
                                   context->cursor + index]) {
                context->state = FRAMER_F2UP_PERSIST_FAILED;
                context->step = FRAMER_F2UP_PSTEP_MISMATCH;
                return;
            }
        }
        context->cursor += span;
        return;
    case FRAMER_F2UP_PERSIST_HEADER:
        if (!framer_f2up_flash_span_allowed_at(context_base(context),
                                               context_base(context),
                                               FRAMER_F2UP_HEADER_BYTES)) {
            context->state = FRAMER_F2UP_PERSIST_FAILED;
            context->step = FRAMER_F2UP_PSTEP_BOUNDS;
            return;
        }
        if (ops->write(ops->opaque, context_base(context),
                       context->container, FRAMER_F2UP_HEADER_BYTES) != 0) {
            context->state = FRAMER_F2UP_PERSIST_FAILED;
            context->step = FRAMER_F2UP_PSTEP_HEADER_WRITE;
            return;
        }
        if (ops->read(ops->opaque, context_base(context), scratch,
                      FRAMER_F2UP_HEADER_BYTES) != 0) {
            context->state = FRAMER_F2UP_PERSIST_FAILED;
            context->step = FRAMER_F2UP_PSTEP_HEADER_READBACK;
            return;
        }
        for (index = 0u; index < FRAMER_F2UP_HEADER_BYTES; ++index) {
            if (scratch[index] != context->container[index]) {
                context->state = FRAMER_F2UP_PERSIST_FAILED;
                context->step = FRAMER_F2UP_PSTEP_HEADER_MISMATCH;
                return;
            }
        }
        context->state = FRAMER_F2UP_PERSIST_DONE;
        context->step = FRAMER_F2UP_PSTEP_NONE;
        return;
    default:
        return;
    }
}
