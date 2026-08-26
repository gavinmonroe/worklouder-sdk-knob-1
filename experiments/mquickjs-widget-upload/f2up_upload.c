#include "f2up_upload.h"

void framer_f2up_upload_init(framer_f2up_upload *upload, uint8_t *staging,
                             uint32_t staging_capacity)
{
    unsigned int i;
    uint8_t *raw = (uint8_t *)upload;
    if (upload == (framer_f2up_upload *)0)
        return;
    for (i = 0u; i < sizeof(*upload); ++i)
        raw[i] = 0u;
    upload->state = FRAMER_F2UP_UPLOAD_IDLE;
    upload->staging = staging;
    upload->staging_capacity = staging_capacity;
}

framer_f2up_upload_result framer_f2up_upload_begin(framer_f2up_upload *upload,
                                                   uint32_t generation,
                                                   uint32_t total_bytes,
                                                   uint32_t running_generation)
{
    if (upload == (framer_f2up_upload *)0 ||
        upload->staging == (uint8_t *)0)
        return FRAMER_F2UP_UPLOAD_ERR_ARGUMENT;
    /* The same ratchet the scene push uses: exactly one past the running
     * widget, so a stale Designer session can neither replay nor skip. */
    if (generation != running_generation + 1u || generation == 0xffffffffu)
        return FRAMER_F2UP_UPLOAD_ERR_GENERATION;
    if (total_bytes < FRAMER_F2UP_HEADER_BYTES + 12u ||
        total_bytes > FRAMER_F2UP_MAX_BYTES ||
        total_bytes > upload->staging_capacity)
        return FRAMER_F2UP_UPLOAD_ERR_TOTAL;
    upload->state = FRAMER_F2UP_UPLOAD_OPEN;
    upload->generation = generation;
    upload->total_bytes = total_bytes;
    upload->received_bytes = 0u;
    upload->chunk_count = 0u;
    upload->admit_result = 0;
    return FRAMER_F2UP_UPLOAD_OK;
}

framer_f2up_upload_result framer_f2up_upload_chunk(framer_f2up_upload *upload,
                                                   uint32_t offset,
                                                   const uint8_t *data,
                                                   uint32_t data_bytes)
{
    uint32_t i;
    if (upload == (framer_f2up_upload *)0 || data == (const uint8_t *)0 ||
        upload->staging == (uint8_t *)0)
        return FRAMER_F2UP_UPLOAD_ERR_ARGUMENT;
    if (upload->state != FRAMER_F2UP_UPLOAD_OPEN)
        return FRAMER_F2UP_UPLOAD_ERR_STATE;
    if (data_bytes < 1u || data_bytes > FRAMER_F2UP_CHUNK_RAW_BYTES ||
        upload->chunk_count >= FRAMER_F2UP_MAX_CHUNKS)
        return FRAMER_F2UP_UPLOAD_ERR_OVERFLOW;
    if (offset != upload->received_bytes)
        return FRAMER_F2UP_UPLOAD_ERR_OFFSET;
    if (data_bytes > upload->total_bytes - upload->received_bytes)
        return FRAMER_F2UP_UPLOAD_ERR_OVERFLOW;
    for (i = 0u; i < data_bytes; ++i)
        upload->staging[upload->received_bytes + i] = data[i];
    upload->received_bytes += data_bytes;
    upload->chunk_count += 1u;
    return FRAMER_F2UP_UPLOAD_OK;
}

framer_f2up_upload_result framer_f2up_upload_commit(framer_f2up_upload *upload)
{
    framer_f2up_result admitted;
    if (upload == (framer_f2up_upload *)0 || upload->staging == (uint8_t *)0)
        return FRAMER_F2UP_UPLOAD_ERR_ARGUMENT;
    if (upload->state != FRAMER_F2UP_UPLOAD_OPEN ||
        upload->received_bytes != upload->total_bytes)
        return FRAMER_F2UP_UPLOAD_ERR_STATE;
    admitted = framer_f2up_admit(upload->staging, (size_t)upload->total_bytes,
                                 &upload->admission);
    upload->admit_result = (int32_t)admitted;
    if (admitted != FRAMER_F2UP_OK) {
        upload->state = FRAMER_F2UP_UPLOAD_FAILED;
        return FRAMER_F2UP_UPLOAD_ERR_ADMIT;
    }
    /* The container's own generation is authoritative from here on; it must be
     * the one the transaction was opened for or something rebuilt the payload
     * mid-flight. */
    if (upload->admission.generation != upload->generation) {
        upload->state = FRAMER_F2UP_UPLOAD_FAILED;
        upload->admit_result = (int32_t)FRAMER_F2UP_ERR_GENERATION;
        return FRAMER_F2UP_UPLOAD_ERR_ADMIT;
    }
    upload->state = FRAMER_F2UP_UPLOAD_SEALED;
    return FRAMER_F2UP_UPLOAD_OK;
}

void framer_f2up_upload_abort(framer_f2up_upload *upload)
{
    if (upload == (framer_f2up_upload *)0)
        return;
    upload->state = FRAMER_F2UP_UPLOAD_IDLE;
    upload->generation = 0u;
    upload->total_bytes = 0u;
    upload->received_bytes = 0u;
    upload->chunk_count = 0u;
    upload->admit_result = 0;
}

/* Strict RFC 4648: exactly the canonical alphabet, length a multiple of four,
 * '=' only as final padding, and zero tolerance for whitespace - the Designer
 * emits canonical base64 and anything else is transport corruption. */
static int base64_value(char character)
{
    if (character >= 'A' && character <= 'Z')
        return character - 'A';
    if (character >= 'a' && character <= 'z')
        return character - 'a' + 26;
    if (character >= '0' && character <= '9')
        return character - '0' + 52;
    if (character == '+')
        return 62;
    if (character == '/')
        return 63;
    return -1;
}

int framer_f2up_base64_decode(const char *text, uint32_t text_bytes,
                              uint8_t *output, uint32_t output_capacity,
                              uint32_t *output_bytes)
{
    uint32_t groups;
    uint32_t group;
    uint32_t produced = 0u;
    uint32_t padding = 0u;
    if (text == (const char *)0 || output == (uint8_t *)0 ||
        output_bytes == (uint32_t *)0)
        return 0;
    if (text_bytes == 0u || (text_bytes & 3u) != 0u)
        return 0;
    if (text[text_bytes - 1u] == '=') {
        padding = 1u;
        if (text[text_bytes - 2u] == '=')
            padding = 2u;
    }
    groups = text_bytes / 4u;
    for (group = 0u; group < groups; ++group) {
        const char *quad = text + group * 4u;
        int v0 = base64_value(quad[0]);
        int v1 = base64_value(quad[1]);
        int v2;
        int v3;
        uint32_t last = (group == groups - 1u) ? 1u : 0u;
        if (v0 < 0 || v1 < 0)
            return 0;
        if (last && padding == 2u) {
            if (quad[2] != '=' || quad[3] != '=')
                return 0;
            /* The dropped bits must be zero in canonical base64. */
            if ((v1 & 0x0f) != 0)
                return 0;
            if (produced + 1u > output_capacity)
                return 0;
            output[produced++] = (uint8_t)((v0 << 2) | (v1 >> 4));
            break;
        }
        v2 = base64_value(quad[2]);
        if (last && padding == 1u) {
            if (v2 < 0 || quad[3] != '=')
                return 0;
            if ((v2 & 0x03) != 0)
                return 0;
            if (produced + 2u > output_capacity)
                return 0;
            output[produced++] = (uint8_t)((v0 << 2) | (v1 >> 4));
            output[produced++] = (uint8_t)(((v1 & 0x0f) << 4) | (v2 >> 2));
            break;
        }
        v3 = base64_value(quad[3]);
        if (v2 < 0 || v3 < 0)
            return 0;
        if (produced + 3u > output_capacity)
            return 0;
        output[produced++] = (uint8_t)((v0 << 2) | (v1 >> 4));
        output[produced++] = (uint8_t)(((v1 & 0x0f) << 4) | (v2 >> 2));
        output[produced++] = (uint8_t)(((v2 & 0x03) << 6) | v3);
    }
    *output_bytes = produced;
    return 1;
}
