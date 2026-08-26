#ifndef FRAMER_F2UP_UPLOAD_H
#define FRAMER_F2UP_UPLOAD_H

#include "f2up_admission.h"

/* The widget.mquickjs.upload transaction machine.
 *
 * Pure: no platform calls, no flash, no allocation.  The module injects a
 * staging buffer (PSRAM) and feeds it decoded chunk bytes; the machine tracks
 * strict in-order progress and seals only through framer_f2up_admit, so a
 * sealed transaction is BY CONSTRUCTION a fully validated container.  The
 * persist machine (f2up_persist.h) then copies the sealed bytes to flash.
 *
 * Chunk transport mirrors the proven scene push exactly: raw chunks of
 * FRAMER_F2UP_CHUNK_RAW_BYTES (3072) and at most FRAMER_F2UP_MAX_CHUNKS (32)
 * of them - 32 * 3072 == FRAMER_F2UP_MAX_BYTES exactly.  Chunks arrive as
 * base64 text in the RPC request; framer_f2up_base64_decode is the strict
 * decoder for that leg. */

#ifdef __cplusplus
extern "C" {
#endif

#define FRAMER_F2UP_CHUNK_RAW_BYTES 3072u
#define FRAMER_F2UP_MAX_CHUNKS 32u

typedef enum {
    FRAMER_F2UP_UPLOAD_IDLE = 0,
    FRAMER_F2UP_UPLOAD_OPEN = 1,
    FRAMER_F2UP_UPLOAD_SEALED = 2,
    FRAMER_F2UP_UPLOAD_FAILED = 3
} framer_f2up_upload_state;

typedef enum {
    FRAMER_F2UP_UPLOAD_OK = 0,
    FRAMER_F2UP_UPLOAD_ERR_ARGUMENT = -1,
    FRAMER_F2UP_UPLOAD_ERR_STATE = -2,
    FRAMER_F2UP_UPLOAD_ERR_GENERATION = -3,
    FRAMER_F2UP_UPLOAD_ERR_TOTAL = -4,
    FRAMER_F2UP_UPLOAD_ERR_OFFSET = -5,
    FRAMER_F2UP_UPLOAD_ERR_OVERFLOW = -6,
    FRAMER_F2UP_UPLOAD_ERR_ADMIT = -7
} framer_f2up_upload_result;

typedef struct {
    uint32_t state;            /* framer_f2up_upload_state */
    uint32_t generation;       /* from begin */
    uint32_t total_bytes;      /* from begin */
    uint32_t received_bytes;   /* strict in-order cursor */
    uint32_t chunk_count;
    int32_t admit_result;      /* framer_f2up_result of the sealing admit */
    uint8_t *staging;
    uint32_t staging_capacity;
    framer_f2up_admission admission; /* valid only in SEALED */
} framer_f2up_upload;

/* Bind the machine to its staging buffer.  capacity must be at least
 * FRAMER_F2UP_MAX_BYTES for uploads up to the format maximum. */
void framer_f2up_upload_init(framer_f2up_upload *upload, uint8_t *staging,
                             uint32_t staging_capacity);

/* Open a transaction.  generation must be exactly running_generation + 1 -
 * the same ratchet the scene push uses - and total_bytes must fit both the
 * format maximum and the staging buffer.  begin always resets whatever came
 * before it; there is one host, so a new begin simply replaces a stale
 * transaction. */
framer_f2up_upload_result framer_f2up_upload_begin(framer_f2up_upload *upload,
                                                   uint32_t generation,
                                                   uint32_t total_bytes,
                                                   uint32_t running_generation);

/* Append decoded chunk bytes.  offset must equal the bytes received so far
 * (strict order, no gaps, no rewrites) and the chunk must not pass
 * total_bytes. */
framer_f2up_upload_result framer_f2up_upload_chunk(framer_f2up_upload *upload,
                                                   uint32_t offset,
                                                   const uint8_t *data,
                                                   uint32_t data_bytes);

/* Seal: requires all total_bytes received, then runs framer_f2up_admit over
 * the staging buffer.  On success state is SEALED and `admission` holds the
 * section table; on admit failure state is FAILED and admit_result names the
 * gate. */
framer_f2up_upload_result framer_f2up_upload_commit(framer_f2up_upload *upload);

void framer_f2up_upload_abort(framer_f2up_upload *upload);

/* Strict RFC 4648 base64: canonical alphabet, correct '=' padding, no
 * whitespace, no line breaks.  Returns 1 and sets *output_bytes on success. */
int framer_f2up_base64_decode(const char *text, uint32_t text_bytes,
                              uint8_t *output, uint32_t output_capacity,
                              uint32_t *output_bytes);

#ifdef __cplusplus
}
#endif

#endif
