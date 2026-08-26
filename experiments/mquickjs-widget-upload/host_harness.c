/* Host proof of the whole device-side widget-upload lifecycle, no hardware:
 *
 *   base64 chunks -> upload machine -> seal (framer_f2up_admit)
 *     -> persist machine -> mock NOR flash -> boot-adopt decision
 *
 * The mock flash is NOR-faithful: erase sets 0xff, a write asserts its target
 * bytes are erased first (NOR can only clear bits - this catches any
 * double-write bug), and EVERY op asserts its span sits inside the widget slot
 * [0x270000, 0x290000) - one byte outside is an immediate failure, which is
 * the property that keeps the running firmware safe.
 *
 * Also proves the torn-write matrix (persist stopped in every intermediate
 * state must leave a slot the adopter refuses), container replacement (a
 * smaller, newer container fully supersedes a larger old one), the upload
 * error paths, and strict base64 rejection.
 *
 *   cc f2up_admission.c f2up_upload.c f2up_persist.c f2up_adopt.c \
 *      ../mquickjs-esp32s3-resident-integration/f2js_admission.c \
 *      host_harness.c -o harness && ./harness valid.f2up valid-gen6.f2up
 */
#include "f2up_admission.h"
#include "f2up_upload.h"
#include "f2up_persist.h"
#include "f2up_adopt.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define CHECK(condition, label)                                            \
    do {                                                                   \
        if (!(condition)) {                                                \
            printf("{\"status\":\"FAIL\",\"check\":\"%s\",\"line\":%d}\n", \
                   label, __LINE__);                                       \
            exit(1);                                                       \
        }                                                                  \
    } while (0)

/* --- mock NOR flash -------------------------------------------------------*/

#define SLOT_BYTES (FRAMER_F2UP_PERSIST_END - FRAMER_F2UP_PERSIST_BEGIN)
#define BANK_BYTES (FRAMER_F2UP_SLOT_COUNT * SLOT_BYTES)
#define BANK_END (FRAMER_F2UP_PERSIST_BEGIN + BANK_BYTES)

typedef struct {
    uint8_t bytes[BANK_BYTES];
    uint32_t erases;
    uint32_t writes;
    uint32_t reads;
} mock_flash;

static void mock_reset(mock_flash *flash)
{
    memset(flash->bytes, 0xff, BANK_BYTES);
    flash->erases = 0u;
    flash->writes = 0u;
    flash->reads = 0u;
}

static int mock_span_ok(uint32_t address, uint32_t bytes)
{
    return bytes >= 1u && address >= FRAMER_F2UP_PERSIST_BEGIN &&
           bytes <= BANK_BYTES && address <= BANK_END - bytes;
}

static int mock_erase(void *opaque, uint32_t address, uint32_t bytes)
{
    mock_flash *flash = (mock_flash *)opaque;
    CHECK(mock_span_ok(address, bytes), "erase-in-slot");
    CHECK((address % FRAMER_F2UP_PERSIST_SECTOR_BYTES) == 0u, "erase-aligned");
    memset(flash->bytes + (address - FRAMER_F2UP_PERSIST_BEGIN), 0xff, bytes);
    flash->erases += 1u;
    return 0;
}

static int mock_write(void *opaque, uint32_t address, const uint8_t *source,
                      uint32_t bytes)
{
    mock_flash *flash = (mock_flash *)opaque;
    uint32_t i;
    CHECK(mock_span_ok(address, bytes), "write-in-slot");
    for (i = 0u; i < bytes; ++i)
        CHECK(flash->bytes[address - FRAMER_F2UP_PERSIST_BEGIN + i] == 0xffu,
              "write-to-erased-only");
    memcpy(flash->bytes + (address - FRAMER_F2UP_PERSIST_BEGIN), source, bytes);
    flash->writes += 1u;
    return 0;
}

static int mock_read(void *opaque, uint32_t address, uint8_t *destination,
                     uint32_t bytes)
{
    mock_flash *flash = (mock_flash *)opaque;
    CHECK(mock_span_ok(address, bytes), "read-in-slot");
    memcpy(destination, flash->bytes + (address - FRAMER_F2UP_PERSIST_BEGIN),
           bytes);
    flash->reads += 1u;
    return 0;
}

/* --- helpers ---------------------------------------------------------------*/

static uint8_t *load_file(const char *path, uint32_t *size_out)
{
    FILE *file = fopen(path, "rb");
    long size;
    uint8_t *buffer;
    CHECK(file != NULL, "fixture-open");
    fseek(file, 0, SEEK_END);
    size = ftell(file);
    fseek(file, 0, SEEK_SET);
    CHECK(size > 0, "fixture-size");
    buffer = (uint8_t *)malloc((size_t)size);
    CHECK(buffer != NULL, "fixture-alloc");
    CHECK(fread(buffer, 1u, (size_t)size, file) == (size_t)size, "fixture-read");
    fclose(file);
    *size_out = (uint32_t)size;
    return buffer;
}

/* Canonical base64 encoder, harness-only, so the decoder is proven against an
 * independent implementation of the same RFC. */
static uint32_t b64_encode(const uint8_t *data, uint32_t bytes, char *out)
{
    static const char alphabet[] =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    uint32_t i;
    uint32_t o = 0u;
    for (i = 0u; i + 2u < bytes; i += 3u) {
        out[o++] = alphabet[data[i] >> 2];
        out[o++] = alphabet[((data[i] & 3u) << 4) | (data[i + 1u] >> 4)];
        out[o++] = alphabet[((data[i + 1u] & 15u) << 2) | (data[i + 2u] >> 6)];
        out[o++] = alphabet[data[i + 2u] & 63u];
    }
    if (i + 1u == bytes) {
        out[o++] = alphabet[data[i] >> 2];
        out[o++] = alphabet[(data[i] & 3u) << 4];
        out[o++] = '=';
        out[o++] = '=';
    } else if (i + 2u == bytes) {
        out[o++] = alphabet[data[i] >> 2];
        out[o++] = alphabet[((data[i] & 3u) << 4) | (data[i + 1u] >> 4)];
        out[o++] = alphabet[(data[i + 1u] & 15u) << 2];
        out[o++] = '=';
    }
    return o;
}

/* Feed a whole container through the upload machine as base64 chunks of the
 * transport size, exactly as the RPC handler will. */
static void upload_all(framer_f2up_upload *upload, const uint8_t *container,
                       uint32_t total, uint32_t running_generation,
                       uint32_t container_generation)
{
    static char b64[FRAMER_F2UP_CHUNK_RAW_BYTES * 4u / 3u + 8u];
    static uint8_t decoded[FRAMER_F2UP_CHUNK_RAW_BYTES];
    uint32_t offset = 0u;
    CHECK(framer_f2up_upload_begin(upload, container_generation, total,
                                   running_generation) ==
              FRAMER_F2UP_UPLOAD_OK,
          "begin-ok");
    while (offset < total) {
        uint32_t span = total - offset;
        uint32_t encoded;
        uint32_t decoded_bytes = 0u;
        if (span > FRAMER_F2UP_CHUNK_RAW_BYTES)
            span = FRAMER_F2UP_CHUNK_RAW_BYTES;
        encoded = b64_encode(container + offset, span, b64);
        CHECK(framer_f2up_base64_decode(b64, encoded, decoded, sizeof(decoded),
                                        &decoded_bytes) == 1,
              "b64-roundtrip-decode");
        CHECK(decoded_bytes == span, "b64-roundtrip-size");
        CHECK(memcmp(decoded, container + offset, span) == 0,
              "b64-roundtrip-bytes");
        CHECK(framer_f2up_upload_chunk(upload, offset, decoded,
                                       decoded_bytes) ==
                  FRAMER_F2UP_UPLOAD_OK,
              "chunk-ok");
        offset += span;
    }
    CHECK(framer_f2up_upload_commit(upload) == FRAMER_F2UP_UPLOAD_OK,
          "commit-ok");
    CHECK(upload->state == FRAMER_F2UP_UPLOAD_SEALED, "sealed");
}

/* Drive the persist machine from ERASE to a terminal state, with a hard cap so
 * a livelock is a failure, not a hang.  stop_after_state (or 0 for none) stops
 * the machine the moment it LEAVES that state - the torn-write matrix. */
static uint32_t persist_run(framer_f2up_persist_context *context,
                            const framer_f2up_flash_ops *ops,
                            uint32_t stop_when_reaching)
{
    uint32_t steps = 0u;
    while (context->state != FRAMER_F2UP_PERSIST_DONE &&
           context->state != FRAMER_F2UP_PERSIST_FAILED) {
        if (stop_when_reaching != 0u && context->state == stop_when_reaching)
            return steps;
        framer_f2up_persist_advance(context, ops);
        steps += 1u;
        CHECK(steps < 500000u, "persist-terminates");
    }
    return steps;
}

int main(int argc, char **argv)
{
    static mock_flash flash;
    static uint8_t staging[FRAMER_F2UP_MAX_BYTES];
    framer_f2up_upload upload;
    framer_f2up_persist_context persist;
    framer_f2up_flash_ops ops;
    framer_f2up_admission adopted;
    int32_t detail = 0;
    uint8_t *container_a;
    uint8_t *container_b;
    uint32_t total_a;
    uint32_t total_b;
    uint32_t torn_state;

    CHECK(argc == 3, "usage");
    container_a = load_file(argv[1], &total_a); /* generation 5 */
    container_b = load_file(argv[2], &total_b); /* generation 6, smaller */

    ops.erase = mock_erase;
    ops.write = mock_write;
    ops.read = mock_read;
    ops.opaque = &flash;

    /* 1. Full happy path: upload A as base64 chunks, seal, persist, adopt. */
    mock_reset(&flash);
    framer_f2up_upload_init(&upload, staging, sizeof(staging));
    upload_all(&upload, container_a, total_a, 4u, 5u);
    CHECK(upload.admission.generation == 5u, "admission-generation");

    persist.state = FRAMER_F2UP_PERSIST_ERASE;
    persist.step = FRAMER_F2UP_PSTEP_NONE;
    persist.cursor = 0u;
    persist.container = staging;
    persist.container_bytes = total_a;
    persist.base = 0u; /* legacy zero selects slot 0 */
    persist_run(&persist, &ops, 0u);
    CHECK(persist.state == FRAMER_F2UP_PERSIST_DONE, "persist-done");
    CHECK(flash.erases == FRAMER_F2UP_PERSIST_SECTORS, "erased-all-sectors");
    CHECK(memcmp(flash.bytes, container_a, total_a) == 0, "flash-equals-container");

    CHECK(framer_f2up_adopt_decide(flash.bytes, SLOT_BYTES, 4u, &adopted,
                                   &detail) == FRAMER_F2UP_ADOPT_OK,
          "adopt-ok");
    CHECK(detail == (int32_t)FRAMER_F2UP_OK, "adopt-detail-ok");
    CHECK(adopted.generation == 5u && adopted.total_bytes == total_a,
          "adopt-matches");
    CHECK(adopted.f2js_offset == upload.admission.f2js_offset &&
              adopted.lzss_bytes == upload.admission.lzss_bytes,
          "adopt-sections-match");

    /* 2. Generation ratchet at adopt time: equal or older baked wins. */
    CHECK(framer_f2up_adopt_decide(flash.bytes, SLOT_BYTES, 5u, &adopted,
                                   &detail) == FRAMER_F2UP_ADOPT_STALE,
          "adopt-stale-equal");
    CHECK(framer_f2up_adopt_decide(flash.bytes, SLOT_BYTES, 9u, &adopted,
                                   &detail) == FRAMER_F2UP_ADOPT_STALE,
          "adopt-stale-newer-baked");

    /* 3. Erased slot: never adopted. */
    mock_reset(&flash);
    CHECK(framer_f2up_adopt_decide(flash.bytes, SLOT_BYTES, 0u, &adopted,
                                   &detail) == FRAMER_F2UP_ADOPT_EMPTY,
          "adopt-empty-erased");

    /* 4. Torn-write matrix: persist stopped in EVERY intermediate state must
     * leave a slot the adopter refuses (header only lands last). */
    for (torn_state = FRAMER_F2UP_PERSIST_WRITE;
         torn_state <= FRAMER_F2UP_PERSIST_HEADER; ++torn_state) {
        mock_reset(&flash);
        persist.state = FRAMER_F2UP_PERSIST_ERASE;
        persist.step = FRAMER_F2UP_PSTEP_NONE;
        persist.cursor = 0u;
        persist.container = staging;
        persist.container_bytes = total_a;
        persist.base = 0u;
        persist_run(&persist, &ops, torn_state);
        CHECK(persist.state == torn_state, "torn-stopped-where-asked");
        CHECK(framer_f2up_adopt_decide(flash.bytes, SLOT_BYTES, 0u, &adopted,
                                       &detail) == FRAMER_F2UP_ADOPT_EMPTY,
              "torn-slot-refused");
    }
    /* Mid-payload power cut: a few WRITE steps only. */
    mock_reset(&flash);
    persist.state = FRAMER_F2UP_PERSIST_ERASE;
    persist.cursor = 0u;
    persist.container = staging;
    persist.container_bytes = total_a;
    persist.base = 0u;
    persist_run(&persist, &ops, FRAMER_F2UP_PERSIST_WRITE);
    framer_f2up_persist_advance(&persist, &ops); /* one 1 KiB write */
    framer_f2up_persist_advance(&persist, &ops); /* another */
    CHECK(framer_f2up_adopt_decide(flash.bytes, SLOT_BYTES, 0u, &adopted,
                                   &detail) == FRAMER_F2UP_ADOPT_EMPTY,
          "midwrite-slot-refused");

    /* 5. Replacement: persist A fully, then B (newer, smaller).  The full
     * erase must leave no admissible trace of A and adopt must yield B. */
    mock_reset(&flash);
    persist.state = FRAMER_F2UP_PERSIST_ERASE;
    persist.cursor = 0u;
    persist.container = staging;
    persist.container_bytes = total_a;
    persist.base = 0u;
    persist_run(&persist, &ops, 0u);
    CHECK(persist.state == FRAMER_F2UP_PERSIST_DONE, "replace-a-done");
    framer_f2up_upload_init(&upload, staging, sizeof(staging));
    upload_all(&upload, container_b, total_b, 5u, 6u);
    persist.state = FRAMER_F2UP_PERSIST_ERASE;
    persist.cursor = 0u;
    persist.container = staging;
    persist.container_bytes = total_b;
    persist.base = 0u;
    persist_run(&persist, &ops, 0u);
    CHECK(persist.state == FRAMER_F2UP_PERSIST_DONE, "replace-b-done");
    CHECK(framer_f2up_adopt_decide(flash.bytes, SLOT_BYTES, 5u, &adopted,
                                   &detail) == FRAMER_F2UP_ADOPT_OK,
          "replace-adopts-b");
    CHECK(adopted.generation == 6u && adopted.total_bytes == total_b,
          "replace-is-b");

    /* 6. Upload error paths. */
    framer_f2up_upload_init(&upload, staging, sizeof(staging));
    CHECK(framer_f2up_upload_begin(&upload, 7u, total_a, 4u) ==
              FRAMER_F2UP_UPLOAD_ERR_GENERATION,
          "begin-bad-generation");
    CHECK(framer_f2up_upload_begin(&upload, 5u, FRAMER_F2UP_MAX_BYTES + 1u,
                                   4u) == FRAMER_F2UP_UPLOAD_ERR_TOTAL,
          "begin-bad-total");
    CHECK(framer_f2up_upload_begin(&upload, 5u, total_a, 4u) ==
              FRAMER_F2UP_UPLOAD_OK,
          "begin-again-ok");
    CHECK(framer_f2up_upload_chunk(&upload, 4u, container_a, 16u) ==
              FRAMER_F2UP_UPLOAD_ERR_OFFSET,
          "chunk-out-of-order");
    CHECK(framer_f2up_upload_chunk(&upload, 0u, container_a,
                                   FRAMER_F2UP_CHUNK_RAW_BYTES + 1u) ==
              FRAMER_F2UP_UPLOAD_ERR_OVERFLOW,
          "chunk-too-large");
    CHECK(framer_f2up_upload_commit(&upload) == FRAMER_F2UP_UPLOAD_ERR_STATE,
          "commit-short");
    /* Corrupt a staged byte after upload: commit must fail through admission
     * with the payload gate, and the machine must land in FAILED. */
    CHECK(framer_f2up_upload_begin(&upload, 5u, total_a, 4u) ==
              FRAMER_F2UP_UPLOAD_OK,
          "begin-corrupt-run");
    {
        uint32_t offset = 0u;
        while (offset < total_a) {
            uint32_t span = total_a - offset;
            if (span > FRAMER_F2UP_CHUNK_RAW_BYTES)
                span = FRAMER_F2UP_CHUNK_RAW_BYTES;
            CHECK(framer_f2up_upload_chunk(&upload, offset,
                                           container_a + offset, span) ==
                      FRAMER_F2UP_UPLOAD_OK,
                  "corrupt-run-chunk");
            offset += span;
        }
    }
    staging[FRAMER_F2UP_HEADER_BYTES] ^= 0xffu;
    CHECK(framer_f2up_upload_commit(&upload) == FRAMER_F2UP_UPLOAD_ERR_ADMIT,
          "commit-admit-fails");
    CHECK(upload.state == FRAMER_F2UP_UPLOAD_FAILED, "commit-failed-state");
    CHECK(upload.admit_result == (int32_t)FRAMER_F2UP_ERR_PAYLOAD_SHA,
          "commit-admit-detail");
    framer_f2up_upload_abort(&upload);
    CHECK(upload.state == FRAMER_F2UP_UPLOAD_IDLE, "abort-idle");

    /* 7. Strict base64 negatives. */
    {
        uint8_t out[16];
        uint32_t out_bytes;
        CHECK(framer_f2up_base64_decode("QUJ", 3u, out, sizeof(out),
                                        &out_bytes) == 0,
              "b64-bad-length");
        CHECK(framer_f2up_base64_decode("QUJ*", 4u, out, sizeof(out),
                                        &out_bytes) == 0,
              "b64-bad-char");
        CHECK(framer_f2up_base64_decode("QQ==QQ==", 8u, out, sizeof(out),
                                        &out_bytes) == 0,
              "b64-inner-padding");
        CHECK(framer_f2up_base64_decode("QR==", 4u, out, sizeof(out),
                                        &out_bytes) == 0,
              "b64-nonzero-dropped-bits");
        CHECK(framer_f2up_base64_decode("QUJD", 4u, out, sizeof(out),
                                        &out_bytes) == 1 &&
                  out_bytes == 3u && out[0] == 'A' && out[2] == 'C',
              "b64-positive");
    }

    /* 8. Slot bank: geometry, the parameterized span gate, cross-slot
     * isolation of persist + adopt, and torn-neighbor independence. */
    {
        uint32_t slot;
        const uint8_t *window0 = flash.bytes;
        const uint8_t *window2 = flash.bytes + 2u * SLOT_BYTES;
        CHECK(framer_f2up_slot_base(0u) == FRAMER_F2UP_PERSIST_BEGIN,
              "slot0-base-legacy");
        for (slot = 0u; slot < FRAMER_F2UP_SLOT_COUNT; ++slot)
            CHECK(framer_f2up_slot_base(slot) ==
                      FRAMER_F2UP_PERSIST_BEGIN + slot * SLOT_BYTES,
                  "slot-base-contiguous");
        CHECK(framer_f2up_slot_base(FRAMER_F2UP_SLOT_COUNT) == 0u,
              "slot-base-out-of-bank");
        for (slot = 0u; slot < FRAMER_F2UP_SLOT_COUNT; ++slot) {
            uint32_t base = framer_f2up_slot_base(slot);
            CHECK(framer_f2up_flash_span_allowed_at(base, base, SLOT_BYTES),
                  "span-at-full-slot");
            CHECK(!framer_f2up_flash_span_allowed_at(base, base + SLOT_BYTES,
                                                     1u),
                  "span-at-slot-end");
            CHECK(!framer_f2up_flash_span_allowed_at(base, base + SLOT_BYTES -
                                                              256u, 512u),
                  "span-at-cross-slot-spill");
        }
        CHECK(!framer_f2up_flash_span_allowed_at(0x00280000u, 0x00280000u,
                                                 16u),
              "span-at-unknown-base");
        CHECK(framer_f2up_flash_span_allowed(FRAMER_F2UP_PERSIST_BEGIN,
                                             16u) ==
                  framer_f2up_flash_span_allowed_at(FRAMER_F2UP_PERSIST_BEGIN,
                                                    FRAMER_F2UP_PERSIST_BEGIN,
                                                    16u),
              "span-legacy-equals-at");

        /* Persist A into slot 0, then B into slot 2. */
        mock_reset(&flash);
        framer_f2up_upload_init(&upload, staging, sizeof(staging));
        upload_all(&upload, container_a, total_a, 4u, 5u);
        persist.state = FRAMER_F2UP_PERSIST_ERASE;
        persist.step = FRAMER_F2UP_PSTEP_NONE;
        persist.cursor = 0u;
        persist.container = staging;
        persist.container_bytes = total_a;
        persist.base = framer_f2up_slot_base(0u);
        persist_run(&persist, &ops, 0u);
        CHECK(persist.state == FRAMER_F2UP_PERSIST_DONE, "bank-slot0-done");
        framer_f2up_upload_init(&upload, staging, sizeof(staging));
        upload_all(&upload, container_b, total_b, 5u, 6u);
        persist.state = FRAMER_F2UP_PERSIST_ERASE;
        persist.cursor = 0u;
        persist.container = staging;
        persist.container_bytes = total_b;
        persist.base = framer_f2up_slot_base(2u);
        persist_run(&persist, &ops, 0u);
        CHECK(persist.state == FRAMER_F2UP_PERSIST_DONE, "bank-slot2-done");
        CHECK(memcmp(window0, container_a, total_a) == 0,
              "bank-slot0-intact-after-slot2-persist");
        CHECK(memcmp(window2, container_b, total_b) == 0,
              "bank-slot2-holds-b");
        CHECK(framer_f2up_adopt_decide(window0, SLOT_BYTES, 4u, &adopted,
                                       &detail) == FRAMER_F2UP_ADOPT_OK &&
                  adopted.generation == 5u,
              "bank-adopt-slot0");
        CHECK(framer_f2up_adopt_decide(window2, SLOT_BYTES, 5u, &adopted,
                                       &detail) == FRAMER_F2UP_ADOPT_OK &&
                  adopted.generation == 6u,
              "bank-adopt-slot2");
        CHECK(framer_f2up_adopt_decide(flash.bytes + SLOT_BYTES, SLOT_BYTES,
                                       0u, &adopted, &detail) ==
                  FRAMER_F2UP_ADOPT_EMPTY,
              "bank-slot1-empty");

        /* A torn write into slot 1 must not disturb either neighbour. */
        framer_f2up_upload_init(&upload, staging, sizeof(staging));
        upload_all(&upload, container_a, total_a, 4u, 5u);
        persist.state = FRAMER_F2UP_PERSIST_ERASE;
        persist.cursor = 0u;
        persist.container = staging;
        persist.container_bytes = total_a;
        persist.base = framer_f2up_slot_base(1u);
        persist_run(&persist, &ops, FRAMER_F2UP_PERSIST_WRITE);
        framer_f2up_persist_advance(&persist, &ops);
        framer_f2up_persist_advance(&persist, &ops);
        CHECK(framer_f2up_adopt_decide(flash.bytes + SLOT_BYTES, SLOT_BYTES,
                                       0u, &adopted, &detail) ==
                  FRAMER_F2UP_ADOPT_EMPTY,
              "bank-torn-slot1-refused");
        CHECK(memcmp(window0, container_a, total_a) == 0 &&
                  memcmp(window2, container_b, total_b) == 0,
              "bank-neighbours-survive-torn-slot1");
    }

    printf("{\"status\":\"PASS_F2UP_DEVICE_LIFECYCLE_NO_HARDWARE\","
           "\"containerA\":%u,\"containerB\":%u,"
           "\"tornStatesRefused\":3,\"slotBytes\":%u,"
           "\"slotCount\":%u}\n",
           total_a, total_b, (uint32_t)SLOT_BYTES,
           (uint32_t)FRAMER_F2UP_SLOT_COUNT);
    free(container_a);
    free(container_b);
    return 0;
}
