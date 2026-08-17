#ifndef FRAMER_F2JS_ADMISSION_H
#define FRAMER_F2JS_ADMISSION_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define FRAMER_F2JS_HEADER_BYTES 128u
#define FRAMER_F2JS_MAX_PACKAGE_BYTES 98304u
#define FRAMER_F2JS_MAX_SOURCE_BYTES 8192u
#define FRAMER_F2JS_SOURCE_STORAGE_BYTES 8193u
#define FRAMER_F2JS_MAX_EVENTS 32u
#define FRAMER_F2JS_MAX_TARGETS 16u
#define FRAMER_F2JS_MAX_KEYS 16u
#define FRAMER_F2JS_MAX_CHORDS 8u
#define FRAMER_F2JS_EVENT_BYTES 16u
#define FRAMER_F2JS_TARGET_BYTES 32u
#define FRAMER_F2JS_RASTER_BASE_BYTES 62404u
#define FRAMER_F2JS_RASTER_ANIMATION_BYTES 62072u
#define FRAMER_F2JS_HEAP_BYTES 65536u
#define FRAMER_F2JS_CALLBACK_DEADLINE_US 2000u

typedef enum {
    FRAMER_F2JS_ADMIT_OK = 0,
    FRAMER_F2JS_ERR_ARGUMENT = -1,
    FRAMER_F2JS_ERR_HEADER = -2,
    FRAMER_F2JS_ERR_DIRECTORY = -3,
    FRAMER_F2JS_ERR_HASH = -4,
    FRAMER_F2JS_ERR_SOURCE = -5,
    FRAMER_F2JS_ERR_INPUT = -6,
    FRAMER_F2JS_ERR_EVENT = -7,
    FRAMER_F2JS_ERR_TARGET = -8,
    FRAMER_F2JS_ERR_ASSET = -9,
} framer_f2js_result;

typedef struct {
    uint8_t kind;
    uint16_t id;
    uint32_t native_token;
    uint16_t held_mask;
} framer_f2js_event;

typedef struct {
    uint16_t flags;
    uint8_t length;
    char id[17];
} framer_f2js_target;

/* The source copy is owned by this object and remains readable at
 * source[source_bytes]. It is never aliased to the transport buffer. */
typedef struct {
    uint32_t generation;
    uint32_t package_bytes;
    uint32_t asset_offset;
    uint32_t asset_bytes;
    uint16_t debounce_ms;
    uint16_t hold_delay_ms;
    uint16_t hold_cadence_ms;
    uint8_t event_count;
    uint8_t target_count;
    uint8_t key_count;
    uint8_t chord_count;
    uint16_t source_bytes;
    uint8_t package_sha256[32];
    uint8_t source_sha256[32];
    framer_f2js_event events[FRAMER_F2JS_MAX_EVENTS];
    framer_f2js_target targets[FRAMER_F2JS_MAX_TARGETS];
    char source[FRAMER_F2JS_SOURCE_STORAGE_BYTES];
} framer_f2js_admission;

framer_f2js_result framer_f2js_admit(const uint8_t *package,
                                     size_t package_bytes,
                                     framer_f2js_admission *output);

void framer_f2js_sha256(const uint8_t *bytes, size_t length,
                        uint8_t digest[32]);

const char *framer_f2js_result_name(framer_f2js_result result);

#ifdef __cplusplus
}
#endif

#endif
