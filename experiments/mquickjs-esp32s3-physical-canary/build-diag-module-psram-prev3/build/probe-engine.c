#include "framer_mquickjs_canary.c"
#include <stddef.h>
__attribute__((used, section(".probe")))
const unsigned int framer_probe_values[] = {
    (unsigned int)(sizeof(runtime_state)),
    (unsigned int)(offsetof(runtime_state, last_error)),
    (unsigned int)(FRAMER_MQJS_DIAG_LAST_ERROR_BYTES),
};
