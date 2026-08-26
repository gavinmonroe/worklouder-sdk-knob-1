#ifndef FRAMER_F2UP_PERSIST_H
#define FRAMER_F2UP_PERSIST_H

#include <stddef.h>
#include <stdint.h>

/* Bounded flash-persist machine for a sealed F2UP container, cloned from the
 * proven scene persist machine (physical_integration.c scene_persist_advance)
 * with the widget slot's layout:
 *
 *   - the record IS the container: no separate flash header;
 *   - payload (container bytes 128..total) is written and verified FIRST at
 *     slot+128, and the container's own 128-byte header is written LAST, so a
 *     torn write can never present an admissible record (erased sector 0
 *     fails the magic, half-written payload fails the payload sha);
 *   - every erase/write is range-checked against hard-coded slot literals;
 *     nothing in the checked expressions derives from RPC or flash data.
 *
 * The unit is pure: flash access goes through injected ops (the module passes
 * its guarded stock wrappers, the host proof passes a RAM mock), and one call
 * performs at most one sector erase, one 1 KiB write or one 512-byte verify
 * read, so the owner task can yield between calls. */

#ifdef __cplusplus
extern "C" {
#endif

/* Widget slot 0: 128 KiB directly after scene slot B, inside the factory
 * partition the module already persists to. Slots 1..COUNT-1 follow it
 * contiguously (0x270000 + slot * 0x20000); the whole bank ends at
 * 0x2F0000, far below the 0x810000 factory-partition ceiling. Slot 0 is
 * byte-compatible with the original single-slot layout. */
#define FRAMER_F2UP_PERSIST_BEGIN 0x00270000u
#define FRAMER_F2UP_PERSIST_END 0x00290000u
#define FRAMER_F2UP_PERSIST_SECTOR_BYTES 4096u
#define FRAMER_F2UP_PERSIST_SECTORS 32u
#define FRAMER_F2UP_PERSIST_CHUNK_BYTES 1024u
#define FRAMER_F2UP_PERSIST_VERIFY_BYTES 512u
#define FRAMER_F2UP_SLOT_COUNT 4u
#define FRAMER_F2UP_SLOT_BYTES (FRAMER_F2UP_PERSIST_END - FRAMER_F2UP_PERSIST_BEGIN)

/* Base flash address of a widget slot, or 0 for a slot outside the bank
 * (0 is never a valid base, so it doubles as the failure sentinel). */
uint32_t framer_f2up_slot_base(uint32_t slot);

typedef enum {
    FRAMER_F2UP_PERSIST_IDLE = 0,
    FRAMER_F2UP_PERSIST_ARMED = 1,
    FRAMER_F2UP_PERSIST_ERASE = 2,
    FRAMER_F2UP_PERSIST_WRITE = 3,
    FRAMER_F2UP_PERSIST_VERIFY = 4,
    FRAMER_F2UP_PERSIST_HEADER = 5,
    FRAMER_F2UP_PERSIST_DONE = 6,
    FRAMER_F2UP_PERSIST_FAILED = 7
} framer_f2up_persist_state;

typedef enum {
    FRAMER_F2UP_PSTEP_NONE = 0,
    FRAMER_F2UP_PSTEP_BOUNDS = 1,
    FRAMER_F2UP_PSTEP_ERASE = 2,
    FRAMER_F2UP_PSTEP_WRITE = 3,
    FRAMER_F2UP_PSTEP_READBACK = 4,
    FRAMER_F2UP_PSTEP_MISMATCH = 5,
    FRAMER_F2UP_PSTEP_HEADER_WRITE = 7,
    FRAMER_F2UP_PSTEP_HEADER_READBACK = 8,
    FRAMER_F2UP_PSTEP_HEADER_MISMATCH = 9,
    FRAMER_F2UP_PSTEP_STORE = 10,
    /* Module-level: the stock flash layer's identity check failed, so the
     * machine refused to arm rather than guess at the protect guard. */
    FRAMER_F2UP_PSTEP_GUARD = 11
} framer_f2up_persist_step;

typedef struct {
    int (*erase)(void *opaque, uint32_t address, uint32_t bytes);
    int (*write)(void *opaque, uint32_t address, const uint8_t *source,
                 uint32_t bytes);
    int (*read)(void *opaque, uint32_t address, uint8_t *destination,
                uint32_t bytes);
    void *opaque;
} framer_f2up_flash_ops;

typedef struct {
    uint32_t state;         /* framer_f2up_persist_state */
    uint32_t step;          /* framer_f2up_persist_step on FAILED */
    uint32_t cursor;
    const uint8_t *container; /* the SEALED staging buffer */
    uint32_t container_bytes;
    /* Target slot base from framer_f2up_slot_base(). 0 selects the legacy
     * slot-0 window, so a zero-initialised context behaves exactly as the
     * original single-slot machine did. */
    uint32_t base;
} framer_f2up_persist_context;

/* One bounded unit of work.  The caller arms the context with state=ERASE,
 * cursor=0 and the sealed container, then calls until state is DONE or
 * FAILED. */
void framer_f2up_persist_advance(framer_f2up_persist_context *context,
                                 const framer_f2up_flash_ops *ops);

/* The literal-bounded span check, exported so the module and the host proof
 * gate on exactly the same predicate. The legacy form checks slot 0; the
 * _at form checks the same predicate against any valid slot base (a base
 * not returned by framer_f2up_slot_base() always fails). */
int framer_f2up_flash_span_allowed(uint32_t address, uint32_t bytes);
int framer_f2up_flash_span_allowed_at(uint32_t base, uint32_t address,
                                      uint32_t bytes);

#ifdef __cplusplus
}
#endif

#endif
