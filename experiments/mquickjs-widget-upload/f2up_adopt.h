#ifndef FRAMER_F2UP_ADOPT_H
#define FRAMER_F2UP_ADOPT_H

#include "f2up_admission.h"

/* Boot-adopt decision for the widget flash slot.
 *
 * Pure: the module maps the slot read-only, hands the window here, and this
 * unit decides.  ANY failure - erased flash, torn write, wrong sha, stale
 * generation - means the module boots the baked-in widget exactly as it does
 * today, so the device can never be left widget-less by a bad upload. */

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    FRAMER_F2UP_ADOPT_OK = 0,
    /* No admissible container in the slot (detail carries the failing gate). */
    FRAMER_F2UP_ADOPT_EMPTY = -1,
    /* Admissible but not newer than the baked widget - baked wins. */
    FRAMER_F2UP_ADOPT_STALE = -2,
    FRAMER_F2UP_ADOPT_ERR_ARGUMENT = -3
} framer_f2up_adopt_result;

/* window is the mapped widget slot (window_bytes >= the stored container).
 * baked_generation is the generation of the module's built-in widget; the slot
 * is adopted only when it is STRICTLY newer.  On OK, `output` holds the
 * admitted section table; `admit_detail` (optional) always receives the
 * framer_f2up_result of the underlying admission for telemetry. */
framer_f2up_adopt_result framer_f2up_adopt_decide(const uint8_t *window,
                                                  uint32_t window_bytes,
                                                  uint32_t baked_generation,
                                                  framer_f2up_admission *output,
                                                  int32_t *admit_detail);

#ifdef __cplusplus
}
#endif

#endif
