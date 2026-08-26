#ifndef FRAMER_F2UP_ADMISSION_H
#define FRAMER_F2UP_ADMISSION_H

#include <stddef.h>
#include <stdint.h>

/* F2UP: the on-device admission validator for a widget upload container.
 *
 * A widget upload bundles three cross-pinned artifacts (F2JS source+decls, F2TF
 * target facade, LZSS-compressed base frame) in one container so a single
 * chunked transfer delivers a complete widget. This unit is deliberately pure:
 * it validates STRUCTURE, CRC and SHA and reports the section offsets. It calls
 * no stock firmware address and touches no flash, so it is provable on a host
 * `cc` exactly like framer_f2js_admit. The module layers framer_f2js_admit /
 * framer_tf_admit / LZSS decode on top using the offsets this returns.
 *
 * Wire format (little-endian; docs/16-mquickjs-widget-pipeline.md, frozen):
 *   +0    8   magic "F2WIDGT1"
 *   +8    4   version = 1
 *   +12   4   totalBytes (<= FRAMER_F2UP_MAX_BYTES)
 *   +16   4   generation (>= 1)
 *   +20   4   f2jsOffset    +24 4 f2jsBytes
 *   +28   4   f2tfOffset    +32 4 f2tfBytes
 *   +36   4   lzssOffset    +40 4 lzssBytes
 *   +44   32  sha256(payload bytes 128..totalBytes)
 *   +76   32  sha256(f2js section)
 *   +108  16  reserved, zero
 *   +124  4   crc32(header bytes 0..124, with this field zeroed)
 *   +128  payload
 */

#ifdef __cplusplus
extern "C" {
#endif

#define FRAMER_F2UP_HEADER_BYTES 128u
#define FRAMER_F2UP_MAX_BYTES 98304u
#define FRAMER_F2UP_MAGIC_0 0x49573246u /* "F2WI" */
#define FRAMER_F2UP_MAGIC_1 0x31544744u /* "DGT1" */
#define FRAMER_F2UP_VERSION 1u
/* The base frame decompresses to exactly one 100x310 RGB565 frame. */
#define FRAMER_F2UP_BASE_BYTES 62000u

typedef enum {
    FRAMER_F2UP_OK = 0,
    FRAMER_F2UP_ERR_ARGUMENT = -1,
    FRAMER_F2UP_ERR_MAGIC = -2,
    FRAMER_F2UP_ERR_VERSION = -3,
    FRAMER_F2UP_ERR_SIZE = -4,
    FRAMER_F2UP_ERR_GENERATION = -5,
    FRAMER_F2UP_ERR_SECTION = -6,
    FRAMER_F2UP_ERR_RESERVED = -7,
    FRAMER_F2UP_ERR_HEADER_CRC = -8,
    FRAMER_F2UP_ERR_PAYLOAD_SHA = -9,
    FRAMER_F2UP_ERR_F2JS_SHA = -10
} framer_f2up_result;

typedef struct {
    uint32_t generation;
    uint32_t total_bytes;
    uint32_t f2js_offset;
    uint32_t f2js_bytes;
    uint32_t f2tf_offset;
    uint32_t f2tf_bytes;
    uint32_t lzss_offset;
    uint32_t lzss_bytes;
    uint8_t payload_sha256[32];
    uint8_t f2js_sha256[32];
} framer_f2up_admission;

/* Validate a whole container. On FRAMER_F2UP_OK, `output` holds the section
 * offsets/bytes (relative to `container`) and the two digests, ready for the
 * module to run framer_f2js_admit(container + f2js_offset, f2js_bytes, ...),
 * framer_tf_admit on the F2TF, and LZSS decode of the base. Any failure returns
 * the first failing gate and leaves the device's running widget untouched. */
framer_f2up_result framer_f2up_admit(const uint8_t *container,
                                     size_t container_bytes,
                                     framer_f2up_admission *output);

/* IEEE CRC32, matching the F2TF/scene-slot header CRC convention. */
uint32_t framer_f2up_crc32(const uint8_t *bytes, size_t length);

const char *framer_f2up_result_name(framer_f2up_result result);

#ifdef __cplusplus
}
#endif

#endif
