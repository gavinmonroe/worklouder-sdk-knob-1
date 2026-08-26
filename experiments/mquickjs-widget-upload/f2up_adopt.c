#include "f2up_adopt.h"

static uint32_t read32(const uint8_t *bytes)
{
    return (uint32_t)bytes[0] | ((uint32_t)bytes[1] << 8) |
           ((uint32_t)bytes[2] << 16) | ((uint32_t)bytes[3] << 24);
}

framer_f2up_adopt_result framer_f2up_adopt_decide(const uint8_t *window,
                                                  uint32_t window_bytes,
                                                  uint32_t baked_generation,
                                                  framer_f2up_admission *output,
                                                  int32_t *admit_detail)
{
    uint32_t total;
    framer_f2up_result admitted;
    if (admit_detail != (int32_t *)0)
        *admit_detail = (int32_t)FRAMER_F2UP_ERR_ARGUMENT;
    if (window == (const uint8_t *)0 ||
        output == (framer_f2up_admission *)0 ||
        window_bytes < FRAMER_F2UP_HEADER_BYTES)
        return FRAMER_F2UP_ADOPT_ERR_ARGUMENT;
    /* The stored total sizes the admission read.  It is untrusted here: bound
     * it by the window before believing a single further byte.  Erased flash
     * reads 0xffffffff and fails this gate (and the magic) immediately. */
    total = read32(window + 12u);
    if (total < FRAMER_F2UP_HEADER_BYTES || total > FRAMER_F2UP_MAX_BYTES ||
        total > window_bytes) {
        if (admit_detail != (int32_t *)0)
            *admit_detail = (int32_t)FRAMER_F2UP_ERR_SIZE;
        return FRAMER_F2UP_ADOPT_EMPTY;
    }
    admitted = framer_f2up_admit(window, (size_t)total, output);
    if (admit_detail != (int32_t *)0)
        *admit_detail = (int32_t)admitted;
    if (admitted != FRAMER_F2UP_OK)
        return FRAMER_F2UP_ADOPT_EMPTY;
    if (output->generation <= baked_generation)
        return FRAMER_F2UP_ADOPT_STALE;
    return FRAMER_F2UP_ADOPT_OK;
}
