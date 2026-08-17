#ifndef FRAMER_PHYSICAL_KEY_TOKEN_H
#define FRAMER_PHYSICAL_KEY_TOKEN_H

#include <stdint.h>

/* Stock consumes the original opaque word first. JavaScript sees only the
 * accepted callback's low-24-bit native token; category remains private. */
static inline uint32_t framer_physical_normalize_key_token(uint32_t raw)
{
    return raw & 0x00ffffffu;
}

#endif
