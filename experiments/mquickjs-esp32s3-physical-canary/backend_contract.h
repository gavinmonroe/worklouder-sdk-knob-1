#ifndef FRAMER_PHYSICAL_BACKEND_CONTRACT_H
#define FRAMER_PHYSICAL_BACKEND_CONTRACT_H

#include <stddef.h>
#include <stdint.h>

#define FRAMER_PHYSICAL_BACKEND_PSRAM_BEGIN 0x3c1d0000u
#define FRAMER_PHYSICAL_BACKEND_PSRAM_END 0x3c3d0000u
#define FRAMER_PHYSICAL_BACKEND_INTERNAL_BEGIN 0x3fc80000u
#define FRAMER_PHYSICAL_BACKEND_INTERNAL_END 0x3fd00000u
#define FRAMER_PHYSICAL_BACKEND_FRAMEBUFFER_OFFSET 160u
#define FRAMER_PHYSICAL_BACKEND_FRAMEBUFFER_BYTES 62000u
#define FRAMER_PHYSICAL_BACKEND_POINTER_BYTES 4u
#define FRAMER_PHYSICAL_BACKEND_POINTER_ALIGNMENT 4u
#define FRAMER_PHYSICAL_BACKEND_VTABLE_POINTERS 12u
#define FRAMER_PHYSICAL_BACKEND_SIDECAR_VTABLE_OFFSET 12u
#define FRAMER_PHYSICAL_BACKEND_SIDECAR_BYTES 60u
#define FRAMER_PHYSICAL_BACKEND_SIDECAR_MAGIC 0x32565343u
#define FRAMER_PHYSICAL_BACKEND_LIVE_TICK 0x4211dc40u
#define FRAMER_PHYSICAL_BACKEND_ID26 0x4211956cu
#define FRAMER_PHYSICAL_BACKEND_LIVE_ENCODER 0x4211c79cu
#define FRAMER_PHYSICAL_BACKEND_OLD_TICK 0x4211960cu
#define FRAMER_PHYSICAL_BACKEND_OLD_ENCODER 0x42119574u

typedef struct {
    uintptr_t controller;
    uintptr_t controller_registry;
    uintptr_t expected_registry;
    uintptr_t vtable;
    uintptr_t slot6;
    uintptr_t slot8;
    uintptr_t slot9;
    uintptr_t slot11;
    uintptr_t sidecar;
    uint32_t sidecar_magic;
    uintptr_t sidecar_old_tick;
    uintptr_t sidecar_old_encoder;
} framer_physical_backend_snapshot;

static inline int framer_physical_backend_readable_range(uintptr_t start,
                                                          size_t bytes)
{
    uintptr_t end = start + (uintptr_t)bytes;
    if (end < start ||
        (start & (FRAMER_PHYSICAL_BACKEND_POINTER_ALIGNMENT - 1u)) != 0u)
        return 0;
    return (start >= FRAMER_PHYSICAL_BACKEND_PSRAM_BEGIN &&
            end <= FRAMER_PHYSICAL_BACKEND_PSRAM_END) ||
           (start >= FRAMER_PHYSICAL_BACKEND_INTERNAL_BEGIN &&
            end <= FRAMER_PHYSICAL_BACKEND_INTERNAL_END);
}

/* This is a value-only predicate so the host harness can exercise every
 * hostile carrier without dereferencing synthetic addresses. Target code
 * performs range checks before collecting each field into this snapshot. */
static inline int framer_physical_backend_snapshot_valid(
    const framer_physical_backend_snapshot *snapshot)
{
    if (snapshot == (const framer_physical_backend_snapshot *)0 ||
        !framer_physical_backend_readable_range(
            snapshot->controller,
            FRAMER_PHYSICAL_BACKEND_FRAMEBUFFER_OFFSET +
                FRAMER_PHYSICAL_BACKEND_FRAMEBUFFER_BYTES) ||
        !framer_physical_backend_readable_range(
            snapshot->vtable,
            FRAMER_PHYSICAL_BACKEND_VTABLE_POINTERS *
                FRAMER_PHYSICAL_BACKEND_POINTER_BYTES) ||
        !framer_physical_backend_readable_range(
            snapshot->sidecar, FRAMER_PHYSICAL_BACKEND_SIDECAR_BYTES))
        return 0;
    return snapshot->expected_registry != 0u &&
           snapshot->controller_registry == snapshot->expected_registry &&
           snapshot->slot6 == FRAMER_PHYSICAL_BACKEND_LIVE_TICK &&
           snapshot->slot8 == FRAMER_PHYSICAL_BACKEND_ID26 &&
           snapshot->slot9 == FRAMER_PHYSICAL_BACKEND_LIVE_ENCODER &&
           snapshot->slot11 == snapshot->sidecar &&
           snapshot->vtable == snapshot->sidecar +
                                   FRAMER_PHYSICAL_BACKEND_SIDECAR_VTABLE_OFFSET &&
           snapshot->sidecar_magic == FRAMER_PHYSICAL_BACKEND_SIDECAR_MAGIC &&
           snapshot->sidecar_old_tick == FRAMER_PHYSICAL_BACKEND_OLD_TICK &&
           snapshot->sidecar_old_encoder == FRAMER_PHYSICAL_BACKEND_OLD_ENCODER;
}

#endif
