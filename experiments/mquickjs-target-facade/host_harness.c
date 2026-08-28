#include "target_facade.h"

#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static unsigned char *load(const char *name, size_t *bytes)
{
    FILE *file = fopen(name, "rb");
    unsigned char *value;
    long length;
    assert(file != NULL && fseek(file, 0, SEEK_END) == 0);
    length = ftell(file); assert(length >= 0 && fseek(file, 0, SEEK_SET) == 0);
    value = (unsigned char *)malloc((size_t)length); assert(value != NULL);
    assert(fread(value, 1, (size_t)length, file) == (size_t)length && fclose(file) == 0);
    *bytes = (size_t)length; return value;
}

static void hex32(const char *text, uint8_t output[32])
{
    unsigned int i; assert(strlen(text) == 64u);
    for (i = 0u; i < 32u; ++i) {
        unsigned int value; assert(sscanf(text + i * 2u, "%2x", &value) == 1); output[i] = (uint8_t)value;
    }
}

static void tear(void *opaque, const framer_tf_mailbox *mailbox)
{
    (void)opaque;
    __atomic_add_fetch((uint32_t *)&mailbox->sequence, 2u, __ATOMIC_SEQ_CST);
}

static uint32_t header_crc(const uint8_t *bytes)
{
    uint8_t copy[FRAMER_TF_HEADER_BYTES];
    memcpy(copy, bytes, sizeof(copy)); memset(copy + 76, 0, 4);
    return framer_tf_crc32(copy, sizeof(copy));
}

static void write_u32(uint8_t *bytes, uint32_t value)
{
    bytes[0] = (uint8_t)value; bytes[1] = (uint8_t)(value >> 8);
    bytes[2] = (uint8_t)(value >> 16); bytes[3] = (uint8_t)(value >> 24);
}

static void reseal(uint8_t *asset, size_t bytes)
{
    write_u32(asset + 72, framer_tf_crc32(asset + FRAMER_TF_HEADER_BYTES,
                                          bytes - FRAMER_TF_HEADER_BYTES));
    write_u32(asset + 76, header_crc(asset));
}

int main(int argc, char **argv)
{
    size_t asset_bytes, base_bytes, cases_bytes;
    uint8_t *asset; uint8_t *base_raw; uint8_t *cases;
    uint8_t f2js[32], contract[32];
    framer_tf_context context;
    framer_tf_result admitted;
    uint32_t count, index;
    uint16_t frame[FRAMER_TF_CANVAS_PIXELS];
    FILE *output;
    assert(argc == 7);
    asset = load(argv[1], &asset_bytes); base_raw = load(argv[2], &base_bytes);
    cases = load(argv[3], &cases_bytes); hex32(argv[5], f2js); hex32(argv[6], contract);
    assert(base_bytes == FRAMER_TF_CANVAS_PIXELS * 2u && cases_bytes >= 8u &&
           memcmp(cases, "TFCS", 4u) == 0);
    memcpy(&count, cases + 4, 4); assert(cases_bytes == 8u + (size_t)count * 72u);
    admitted = framer_tf_admit(&context, asset, asset_bytes, (const uint16_t *)base_raw,
                              FRAMER_TF_CANVAS_PIXELS, 18u, f2js, contract, 0x12345678u);
    assert(admitted == FRAMER_TF_OK);
    output = fopen(argv[4], "wb"); assert(output != NULL);
    printf("{\"status\":\"PASS_HOST_C_TARGET_FACADE\",\"results\":[");
    for (index = 0u; index < count; ++index) {
        framer_tf_mailbox mailbox; framer_tf_metrics metrics; framer_tf_result result;
        memcpy(&mailbox, cases + 8u + index * 72u, 72u);
        result = framer_tf_render_at(&context, &mailbox, frame,
                                     FRAMER_TF_CANVAS_PIXELS, 0x12345678u,
                                     index * 50u, &metrics);
        assert(fwrite(frame, sizeof(uint16_t), FRAMER_TF_CANVAS_PIXELS, output) == FRAMER_TF_CANVAS_PIXELS);
        printf("%s{\"result\":%u,\"writes\":%u,\"revision\":%u}", index ? "," : "",
               (unsigned int)result, metrics.overlay_writes, metrics.applied_revision);
    }
    assert(fclose(output) == 0);
    {
        framer_tf_mailbox mailbox; framer_tf_metrics metrics; framer_tf_result result;
        memcpy(&mailbox, cases + 8u + 72u, 72u);
        result = framer_tf_render_probe(&context, &mailbox, frame, FRAMER_TF_CANVAS_PIXELS,
                                        0x12345678u, &metrics, tear, NULL);
        assert(result == FRAMER_TF_ERR_TORN && metrics.snapshot_attempts == 3u &&
               memcmp(frame, base_raw, base_bytes) == 0);
    }
    {
        uint8_t *mutated = (uint8_t *)malloc(asset_bytes); framer_tf_context rejected;
        framer_tf_mailbox mailbox;
        memcpy(mutated, asset, asset_bytes); mutated[FRAMER_TF_HEADER_BYTES] ^= 1u;
        assert(framer_tf_admit(&rejected, mutated, asset_bytes, (const uint16_t *)base_raw,
                              FRAMER_TF_CANVAS_PIXELS, 18u, f2js, contract, 1u) == FRAMER_TF_ERR_CRC);
        memcpy(mutated, asset, asset_bytes); mutated[FRAMER_TF_HEADER_BYTES + 3u * 40u + 26u] = 16u;
        reseal(mutated, asset_bytes);
        assert(framer_tf_admit(&rejected, mutated, asset_bytes, (const uint16_t *)base_raw,
                              FRAMER_TF_CANVAS_PIXELS, 18u, f2js, contract, 1u) == FRAMER_TF_ERR_MALFORMED);
        memcpy(mutated, asset, asset_bytes); mutated[FRAMER_TF_HEADER_BYTES + 16u] = 99u;
        mutated[FRAMER_TF_HEADER_BYTES + 20u] = 2u; reseal(mutated, asset_bytes);
        assert(framer_tf_admit(&rejected, mutated, asset_bytes, (const uint16_t *)base_raw,
                              FRAMER_TF_CANVAS_PIXELS, 18u, f2js, contract, 1u) == FRAMER_TF_ERR_MALFORMED);
        /* Budget=1 splits by asset class under the v3 admit rule: an asset
         * with variantRaster targets is REFUSED at admit (their exact write
         * requirement no longer fits - the black-screen class is now caught
         * before render), while a glyph-only asset still admits and then
         * overflows at render exactly as before. */
        {
            uint32_t raster_writes = 0u;
            unsigned int record_index;
            for (record_index = 0u; record_index < 16u; ++record_index) {
                const uint8_t *record =
                    asset + FRAMER_TF_HEADER_BYTES + record_index * 40u;
                if (record[25] == 12u || record[25] == 13u ||
                    record[25] == 14u || record[25] == 15u)
                    raster_writes +=
                        (uint32_t)(record[20] | (record[21] << 8)) *
                        (uint32_t)(record[22] | (record[23] << 8));
            }
            memcpy(mutated, asset, asset_bytes);
            write_u32(mutated + 32u, 1u); reseal(mutated, asset_bytes);
            if (raster_writes > 0u) {
                assert(framer_tf_admit(&rejected, mutated, asset_bytes,
                                      (const uint16_t *)base_raw,
                                      FRAMER_TF_CANVAS_PIXELS, 18u, f2js,
                                      contract, 1u) == FRAMER_TF_ERR_MALFORMED);
            } else {
                assert(framer_tf_admit(&rejected, mutated, asset_bytes,
                                      (const uint16_t *)base_raw,
                                      FRAMER_TF_CANVAS_PIXELS, 18u, f2js,
                                      contract, 1u) == FRAMER_TF_OK);
                memcpy(&mailbox, cases + 8u + 72u, 72u);
                assert(framer_tf_render(&rejected, &mailbox, frame,
                                        FRAMER_TF_CANVAS_PIXELS, 1u, NULL) ==
                       FRAMER_TF_ERR_OVERFLOW &&
                       memcmp(frame, base_raw, base_bytes) == 0);
            }
        }
        free(mutated);
    }
    printf("],\"torn\":\"PASS\",\"malformed\":\"PASS\",\"overflow\":\"PASS\"}\n");
    free(asset); free(base_raw); free(cases); return 0;
}
