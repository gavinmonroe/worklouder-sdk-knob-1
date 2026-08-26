#include "f2up_admission.h"

/* SHA-256 is reused from the resident integration's already host-tested
 * implementation rather than duplicated, so there is exactly one SHA on device.
 */
#include "../mquickjs-esp32s3-resident-integration/f2js_admission.h"

static uint32_t read32(const uint8_t *bytes)
{
    return (uint32_t)bytes[0] | ((uint32_t)bytes[1] << 8) |
           ((uint32_t)bytes[2] << 16) | ((uint32_t)bytes[3] << 24);
}

static int digests_equal(const uint8_t *a, const uint8_t *b)
{
    unsigned int i;
    uint8_t difference = 0u;
    for (i = 0u; i < 32u; ++i)
        difference |= (uint8_t)(a[i] ^ b[i]);
    return difference == 0u;
}

/* IEEE CRC32 (reflected, poly 0xEDB88320, init/final 0xFFFFFFFF). Matches
 * f2tfPackage.ts crc32, which is what the Designer signs the container with. */
uint32_t framer_f2up_crc32(const uint8_t *bytes, size_t length)
{
    uint32_t crc = 0xffffffffu;
    size_t index;
    unsigned int bit;
    if (bytes == (const uint8_t *)0)
        return 0u;
    for (index = 0u; index < length; ++index) {
        crc ^= bytes[index];
        for (bit = 0u; bit < 8u; ++bit)
            crc = (crc >> 1) ^ (0xedb88320u & (uint32_t)(-(int32_t)(crc & 1u)));
    }
    return crc ^ 0xffffffffu;
}

/* CRC over the 128-byte header with the 4 CRC bytes (124..128) read as zero.
 * Equivalent to crc32 of header[0..124] followed by four zero bytes, which is
 * NOT the same as crc32 of header[0..124] alone. */
static uint32_t header_crc(const uint8_t *header)
{
    uint32_t crc = 0xffffffffu;
    size_t index;
    unsigned int bit;
    for (index = 0u; index < FRAMER_F2UP_HEADER_BYTES; ++index) {
        uint8_t byte = (index >= 124u) ? 0u : header[index];
        crc ^= byte;
        for (bit = 0u; bit < 8u; ++bit)
            crc = (crc >> 1) ^ (0xedb88320u & (uint32_t)(-(int32_t)(crc & 1u)));
    }
    return crc ^ 0xffffffffu;
}

/* A section must be 4-aligned, nonzero, and lie wholly inside the payload
 * region [128, total). Sections are validated in canonical order f2js, f2tf,
 * lzss with no overlap and no gap, matching the Designer's encoder. */
static int section_ok(uint32_t offset, uint32_t bytes, uint32_t expected_offset,
                      uint32_t total)
{
    return (offset & 3u) == 0u && bytes >= 1u &&
           offset == expected_offset &&
           offset >= FRAMER_F2UP_HEADER_BYTES &&
           bytes <= total - offset;
}

framer_f2up_result framer_f2up_admit(const uint8_t *container,
                                     size_t container_bytes,
                                     framer_f2up_admission *output)
{
    uint32_t total;
    uint32_t generation;
    uint32_t f2js_off, f2js_len, f2tf_off, f2tf_len, lzss_off, lzss_len;
    uint32_t reserved_or;
    unsigned int i;
    uint8_t digest[32];

    if (container == (const uint8_t *)0 || output == (framer_f2up_admission *)0)
        return FRAMER_F2UP_ERR_ARGUMENT;
    if (container_bytes < FRAMER_F2UP_HEADER_BYTES ||
        container_bytes > FRAMER_F2UP_MAX_BYTES)
        return FRAMER_F2UP_ERR_SIZE;

    if (read32(container) != FRAMER_F2UP_MAGIC_0 ||
        read32(container + 4u) != FRAMER_F2UP_MAGIC_1)
        return FRAMER_F2UP_ERR_MAGIC;
    if (read32(container + 8u) != FRAMER_F2UP_VERSION)
        return FRAMER_F2UP_ERR_VERSION;

    total = read32(container + 12u);
    if (total != (uint32_t)container_bytes || total > FRAMER_F2UP_MAX_BYTES ||
        total < FRAMER_F2UP_HEADER_BYTES)
        return FRAMER_F2UP_ERR_SIZE;

    generation = read32(container + 16u);
    if (generation < 1u || generation == 0xffffffffu)
        return FRAMER_F2UP_ERR_GENERATION;

    f2js_off = read32(container + 20u); f2js_len = read32(container + 24u);
    f2tf_off = read32(container + 28u); f2tf_len = read32(container + 32u);
    lzss_off = read32(container + 36u); lzss_len = read32(container + 40u);

    /* Canonical placement: each section begins at the 4-aligned end of the
     * previous, the first at the header boundary, and the last ends exactly at
     * total. This subsumes overlap and bounds. */
    if (!section_ok(f2js_off, f2js_len, FRAMER_F2UP_HEADER_BYTES, total))
        return FRAMER_F2UP_ERR_SECTION;
    {
        uint32_t after_f2js = (f2js_off + f2js_len + 3u) & ~3u;
        uint32_t after_f2tf;
        if (!section_ok(f2tf_off, f2tf_len, after_f2js, total))
            return FRAMER_F2UP_ERR_SECTION;
        after_f2tf = (f2tf_off + f2tf_len + 3u) & ~3u;
        if (!section_ok(lzss_off, lzss_len, after_f2tf, total))
            return FRAMER_F2UP_ERR_SECTION;
        if (lzss_off + lzss_len != total)
            return FRAMER_F2UP_ERR_SECTION;
    }

    reserved_or = 0u;
    for (i = 108u; i < 124u; ++i)
        reserved_or |= container[i];
    if (reserved_or != 0u)
        return FRAMER_F2UP_ERR_RESERVED;

    if (header_crc(container) != read32(container + 124u))
        return FRAMER_F2UP_ERR_HEADER_CRC;

    /* Payload integrity: sha256 of everything past the header, then the F2JS
     * section's own sha, which the F2TF also pins — the device thus proves the
     * two artifacts belong together before booting either. */
    framer_f2js_sha256(container + FRAMER_F2UP_HEADER_BYTES,
                       (size_t)(total - FRAMER_F2UP_HEADER_BYTES), digest);
    if (!digests_equal(digest, container + 44u))
        return FRAMER_F2UP_ERR_PAYLOAD_SHA;

    framer_f2js_sha256(container + f2js_off, (size_t)f2js_len, digest);
    if (!digests_equal(digest, container + 76u))
        return FRAMER_F2UP_ERR_F2JS_SHA;

    output->generation = generation;
    output->total_bytes = total;
    output->f2js_offset = f2js_off; output->f2js_bytes = f2js_len;
    output->f2tf_offset = f2tf_off; output->f2tf_bytes = f2tf_len;
    output->lzss_offset = lzss_off; output->lzss_bytes = lzss_len;
    for (i = 0u; i < 32u; ++i) {
        output->payload_sha256[i] = container[44u + i];
        output->f2js_sha256[i] = container[76u + i];
    }
    return FRAMER_F2UP_OK;
}

const char *framer_f2up_result_name(framer_f2up_result result)
{
    switch (result) {
    case FRAMER_F2UP_OK: return "ok";
    case FRAMER_F2UP_ERR_ARGUMENT: return "argument";
    case FRAMER_F2UP_ERR_MAGIC: return "magic";
    case FRAMER_F2UP_ERR_VERSION: return "version";
    case FRAMER_F2UP_ERR_SIZE: return "size";
    case FRAMER_F2UP_ERR_GENERATION: return "generation";
    case FRAMER_F2UP_ERR_SECTION: return "section";
    case FRAMER_F2UP_ERR_RESERVED: return "reserved";
    case FRAMER_F2UP_ERR_HEADER_CRC: return "header-crc";
    case FRAMER_F2UP_ERR_PAYLOAD_SHA: return "payload-sha";
    case FRAMER_F2UP_ERR_F2JS_SHA: return "f2js-sha";
    default: return "unknown";
    }
}
