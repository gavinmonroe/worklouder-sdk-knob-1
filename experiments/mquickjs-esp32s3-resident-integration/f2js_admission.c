#include "f2js_admission.h"

#include <limits.h>

#define F2JS_VERSION 1u
#define F2JS_SECTION_COUNT 4u
#define F2JS_FLAG_RASTER_BASE 1u
#define F2JS_EVENTS_DIRECTORY 40u
#define F2JS_TARGETS_DIRECTORY 46u
#define F2JS_SOURCE_DIRECTORY 52u
#define F2JS_ASSET_DIRECTORY 58u
#define F2JS_SOURCE_SHA_OFFSET 64u
#define F2JS_BODY_SHA_OFFSET 96u

typedef struct {
    uint32_t offset;
    uint32_t bytes;
} f2js_section;

static uint16_t read_u16(const uint8_t *p)
{
    return (uint16_t)((uint16_t)p[0] | ((uint16_t)p[1] << 8));
}

static uint32_t read_u24(const uint8_t *p)
{
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) |
           ((uint32_t)p[2] << 16);
}

static uint32_t read_u32(const uint8_t *p)
{
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) |
           ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

static int bytes_equal(const uint8_t *left, const uint8_t *right, size_t n)
{
    uint8_t difference = 0u;
    size_t i;
    for (i = 0u; i < n; ++i)
        difference |= (uint8_t)(left[i] ^ right[i]);
    return difference == 0u;
}

static int bytes_zero(const uint8_t *bytes, size_t n)
{
    uint8_t found = 0u;
    size_t i;
    for (i = 0u; i < n; ++i)
        found |= bytes[i];
    return found == 0u;
}

static void copy_bytes(uint8_t *destination, const uint8_t *source, size_t n)
{
    size_t i;
    for (i = 0u; i < n; ++i)
        destination[i] = source[i];
}

static void zero_bytes(void *destination, size_t n)
{
    uint8_t *bytes = (uint8_t *)destination;
    size_t i;
    for (i = 0u; i < n; ++i)
        bytes[i] = 0u;
}

static uint32_t rotate_right(uint32_t value, unsigned int bits)
{
    return (value >> bits) | (value << (32u - bits));
}

static const uint32_t sha256_k[64] = {
    0x428a2f98u,0x71374491u,0xb5c0fbcfu,0xe9b5dba5u,
    0x3956c25bu,0x59f111f1u,0x923f82a4u,0xab1c5ed5u,
    0xd807aa98u,0x12835b01u,0x243185beu,0x550c7dc3u,
    0x72be5d74u,0x80deb1feu,0x9bdc06a7u,0xc19bf174u,
    0xe49b69c1u,0xefbe4786u,0x0fc19dc6u,0x240ca1ccu,
    0x2de92c6fu,0x4a7484aau,0x5cb0a9dcu,0x76f988dau,
    0x983e5152u,0xa831c66du,0xb00327c8u,0xbf597fc7u,
    0xc6e00bf3u,0xd5a79147u,0x06ca6351u,0x14292967u,
    0x27b70a85u,0x2e1b2138u,0x4d2c6dfcu,0x53380d13u,
    0x650a7354u,0x766a0abbu,0x81c2c92eu,0x92722c85u,
    0xa2bfe8a1u,0xa81a664bu,0xc24b8b70u,0xc76c51a3u,
    0xd192e819u,0xd6990624u,0xf40e3585u,0x106aa070u,
    0x19a4c116u,0x1e376c08u,0x2748774cu,0x34b0bcb5u,
    0x391c0cb3u,0x4ed8aa4au,0x5b9cca4fu,0x682e6ff3u,
    0x748f82eeu,0x78a5636fu,0x84c87814u,0x8cc70208u,
    0x90befffau,0xa4506cebu,0xbef9a3f7u,0xc67178f2u,
};

static void sha256_block(uint32_t state[8], const uint8_t block[64])
{
    uint32_t w[16];
    uint32_t a = state[0], b = state[1], c = state[2], d = state[3];
    uint32_t e = state[4], f = state[5], g = state[6], h = state[7];
    unsigned int i;
    for (i = 0u; i < 64u; ++i) {
        uint32_t wi;
        uint32_t s0, s1, choose, majority, t1, t2;
        if (i < 16u) {
            const uint8_t *p = block + i * 4u;
            wi = ((uint32_t)p[0] << 24) | ((uint32_t)p[1] << 16) |
                 ((uint32_t)p[2] << 8) | (uint32_t)p[3];
        } else {
            uint32_t x = w[(i + 1u) & 15u];
            uint32_t y = w[(i + 14u) & 15u];
            s0 = rotate_right(x, 7u) ^ rotate_right(x, 18u) ^ (x >> 3);
            s1 = rotate_right(y, 17u) ^ rotate_right(y, 19u) ^ (y >> 10);
            wi = w[i & 15u] + s0 + w[(i + 9u) & 15u] + s1;
        }
        w[i & 15u] = wi;
        s1 = rotate_right(e, 6u) ^ rotate_right(e, 11u) ^ rotate_right(e, 25u);
        choose = (e & f) ^ ((~e) & g);
        t1 = h + s1 + choose + sha256_k[i] + wi;
        s0 = rotate_right(a, 2u) ^ rotate_right(a, 13u) ^ rotate_right(a, 22u);
        majority = (a & b) ^ (a & c) ^ (b & c);
        t2 = s0 + majority;
        h = g; g = f; f = e; e = d + t1;
        d = c; c = b; b = a; a = t1 + t2;
    }
    state[0] += a; state[1] += b; state[2] += c; state[3] += d;
    state[4] += e; state[5] += f; state[6] += g; state[7] += h;
}

void framer_f2js_sha256(const uint8_t *bytes, size_t length,
                        uint8_t digest[32])
{
    uint32_t state[8];
    uint8_t tail[128];
    size_t offset = 0u;
    size_t remainder;
    size_t tail_bytes;
    uint32_t bit_low;
    uint32_t bit_high;
    unsigned int i;
    state[0] = 0x6a09e667u; state[1] = 0xbb67ae85u;
    state[2] = 0x3c6ef372u; state[3] = 0xa54ff53au;
    state[4] = 0x510e527fu; state[5] = 0x9b05688cu;
    state[6] = 0x1f83d9abu; state[7] = 0x5be0cd19u;
    if (bytes == (const uint8_t *)0 || digest == (uint8_t *)0)
        return;
    while (length - offset >= 64u) {
        sha256_block(state, bytes + offset);
        offset += 64u;
    }
    remainder = length - offset;
    tail_bytes = remainder < 56u ? 64u : 128u;
    zero_bytes(tail, tail_bytes);
    copy_bytes(tail, bytes + offset, remainder);
    tail[remainder] = 0x80u;
    bit_low = (uint32_t)length << 3;
    bit_high = (uint32_t)(length >> 29);
    tail[tail_bytes - 8u] = (uint8_t)(bit_high >> 24);
    tail[tail_bytes - 7u] = (uint8_t)(bit_high >> 16);
    tail[tail_bytes - 6u] = (uint8_t)(bit_high >> 8);
    tail[tail_bytes - 5u] = (uint8_t)bit_high;
    tail[tail_bytes - 4u] = (uint8_t)(bit_low >> 24);
    tail[tail_bytes - 3u] = (uint8_t)(bit_low >> 16);
    tail[tail_bytes - 2u] = (uint8_t)(bit_low >> 8);
    tail[tail_bytes - 1u] = (uint8_t)bit_low;
    sha256_block(state, tail);
    if (tail_bytes == 128u)
        sha256_block(state, tail + 64u);
    for (i = 0u; i < 8u; ++i) {
        digest[i * 4u] = (uint8_t)(state[i] >> 24);
        digest[i * 4u + 1u] = (uint8_t)(state[i] >> 16);
        digest[i * 4u + 2u] = (uint8_t)(state[i] >> 8);
        digest[i * 4u + 3u] = (uint8_t)state[i];
    }
}

static int canonical_utf8(const uint8_t *bytes, size_t length)
{
    size_t i = 0u;
    while (i < length) {
        uint8_t a = bytes[i++];
        uint32_t value;
        unsigned int continuation;
        uint32_t minimum;
        if (a <= 0x7fu)
            continue;
        if (a >= 0xc2u && a <= 0xdfu) {
            value = (uint32_t)(a & 0x1fu);
            continuation = 1u;
            minimum = 0x80u;
        } else if (a >= 0xe0u && a <= 0xefu) {
            value = (uint32_t)(a & 0x0fu);
            continuation = 2u;
            minimum = 0x800u;
        } else if (a >= 0xf0u && a <= 0xf4u) {
            value = (uint32_t)(a & 0x07u);
            continuation = 3u;
            minimum = 0x10000u;
        } else {
            return 0;
        }
        if (i + continuation > length)
            return 0;
        while (continuation-- != 0u) {
            uint8_t b = bytes[i++];
            if ((b & 0xc0u) != 0x80u)
                return 0;
            value = (value << 6) | (uint32_t)(b & 0x3fu);
        }
        if (value < minimum || value > 0x10ffffu ||
            (value >= 0xd800u && value <= 0xdfffu))
            return 0;
    }
    return 1;
}

static unsigned int bit_count_16(uint16_t value)
{
    unsigned int count = 0u;
    while (value != 0u) {
        count += value & 1u;
        value = (uint16_t)(value >> 1);
    }
    return count;
}

static int valid_target_id(const uint8_t *bytes, size_t length)
{
    size_t i;
    if (length == 0u || length > 16u ||
        !((bytes[0] >= (uint8_t)'A' && bytes[0] <= (uint8_t)'Z') ||
          (bytes[0] >= (uint8_t)'a' && bytes[0] <= (uint8_t)'z')))
        return 0;
    for (i = 1u; i < length; ++i) {
        uint8_t value = bytes[i];
        if (!((value >= (uint8_t)'A' && value <= (uint8_t)'Z') ||
              (value >= (uint8_t)'a' && value <= (uint8_t)'z') ||
              (value >= (uint8_t)'0' && value <= (uint8_t)'9') ||
              value == (uint8_t)'_' || value == (uint8_t)'-'))
            return 0;
    }
    return 1;
}

static framer_f2js_result validate_events(const uint8_t *bytes,
                                           uint8_t event_count,
                                           uint8_t key_count,
                                           uint8_t chord_count,
                                           framer_f2js_admission *output)
{
    uint8_t singleton_mask = 0u;
    uint32_t native_tokens[FRAMER_F2JS_MAX_KEYS];
    uint16_t chord_masks[FRAMER_F2JS_MAX_CHORDS];
    uint16_t admitted_mask = key_count == 16u ? 0xffffu :
        (uint16_t)((1u << key_count) - 1u);
    uint16_t last_host_id = 0u;
    uint8_t found_keys = 0u;
    uint8_t found_chords = 0u;
    uint8_t last_kind = 0u;
    uint8_t index;
    for (index = 0u; index < event_count; ++index) {
        const uint8_t *record = bytes + (size_t)index * FRAMER_F2JS_EVENT_BYTES;
        uint8_t kind = record[0];
        uint16_t id = read_u16(record + 2u);
        uint32_t native_token = read_u32(record + 4u);
        uint16_t held_mask = read_u16(record + 8u);
        unsigned int prior;
        if (record[1] != 0u || !bytes_zero(record + 10u, 6u) ||
            kind < 1u || kind > 7u || kind < last_kind)
            return FRAMER_F2JS_ERR_EVENT;
        last_kind = kind;
        if (kind <= 3u || kind == 7u) {
            uint8_t bit = (uint8_t)(1u << (kind - 1u));
            if (id != 0u || native_token != 0u || held_mask != 0u ||
                (singleton_mask & bit) != 0u)
                return FRAMER_F2JS_ERR_EVENT;
            singleton_mask |= bit;
        } else if (kind == 4u) {
            if (id == 0u || id <= last_host_id || native_token != 0u ||
                held_mask != 0u)
                return FRAMER_F2JS_ERR_EVENT;
            last_host_id = id;
        } else if (kind == 5u) {
            if (id != found_keys || id >= key_count || held_mask != 0u)
                return FRAMER_F2JS_ERR_EVENT;
            for (prior = 0u; prior < found_keys; ++prior)
                if (native_tokens[prior] == native_token)
                    return FRAMER_F2JS_ERR_EVENT;
            native_tokens[found_keys++] = native_token;
        } else if (kind == 6u) {
            unsigned int count = bit_count_16(held_mask);
            if (id != found_chords || id >= chord_count || native_token != 0u ||
                (held_mask & (uint16_t)~admitted_mask) != 0u ||
                count < 2u || count > 4u)
                return FRAMER_F2JS_ERR_EVENT;
            for (prior = 0u; prior < found_chords; ++prior)
                if (chord_masks[prior] == held_mask)
                    return FRAMER_F2JS_ERR_EVENT;
            chord_masks[found_chords++] = held_mask;
        } else {
            return FRAMER_F2JS_ERR_EVENT;
        }
        output->events[index].kind = kind;
        output->events[index].id = id;
        output->events[index].native_token = native_token;
        output->events[index].held_mask = held_mask;
    }
    if (found_keys != key_count || found_chords != chord_count)
        return FRAMER_F2JS_ERR_EVENT;
    return FRAMER_F2JS_ADMIT_OK;
}

static framer_f2js_result validate_targets(const uint8_t *bytes,
                                            uint8_t target_count,
                                            framer_f2js_admission *output)
{
    uint8_t index;
    for (index = 0u; index < target_count; ++index) {
        const uint8_t *record = bytes + (size_t)index * FRAMER_F2JS_TARGET_BYTES;
        uint16_t id_index = read_u16(record);
        uint16_t flags = read_u16(record + 2u);
        uint8_t length = record[4];
        uint8_t prior;
        if (id_index != index || flags == 0u || (flags & (uint16_t)~7u) != 0u ||
            length < 1u || length > 16u || !bytes_zero(record + 5u, 3u) ||
            !bytes_zero(record + 8u + length, 24u - length) ||
            !valid_target_id(record + 8u, length))
            return FRAMER_F2JS_ERR_TARGET;
        for (prior = 0u; prior < index; ++prior) {
            if (output->targets[prior].length == length &&
                bytes_equal((const uint8_t *)output->targets[prior].id,
                            record + 8u, length))
                return FRAMER_F2JS_ERR_TARGET;
        }
        output->targets[index].flags = flags;
        output->targets[index].length = length;
        copy_bytes((uint8_t *)output->targets[index].id, record + 8u, length);
        output->targets[index].id[length] = '\0';
    }
    return FRAMER_F2JS_ADMIT_OK;
}

static framer_f2js_result validate_f1ra(const uint8_t *bytes, size_t length)
{
    static const uint8_t magic[4] = { 'F', '1', 'R', 'A' };
    uint8_t digest[32];
    uint16_t cadence;
    if (length != FRAMER_F2JS_RASTER_ANIMATION_BYTES ||
        !bytes_equal(bytes, magic, sizeof(magic)) || bytes[4] != 1u ||
        bytes[5] != 1u || read_u16(bytes + 6u) != 100u ||
        read_u16(bytes + 8u) != 310u || read_u16(bytes + 10u) != 1u)
        return FRAMER_F2JS_ERR_ASSET;
    cadence = read_u16(bytes + 12u);
    if (cadence < 100u || cadence % 100u != 0u || read_u16(bytes + 14u) != 0u ||
        read_u32(bytes + 16u) != cadence || read_u16(bytes + 20u) > 60u ||
        bytes[22] < 1u || bytes[22] > 32u || bytes[23] < 1u || bytes[23] > 32u ||
        read_u32(bytes + 24u) != FRAMER_F2JS_RASTER_ANIMATION_BYTES ||
        read_u32(bytes + 28u) != 62000u)
        return FRAMER_F2JS_ERR_ASSET;
    framer_f2js_sha256(bytes + 64u, length - 64u, digest);
    if (!bytes_equal(digest, bytes + 32u, 32u) || bytes[64] != 0u ||
        bytes[65] != 0u || read_u16(bytes + 66u) != 0u ||
        read_u32(bytes + 68u) != 62000u)
        return FRAMER_F2JS_ERR_ASSET;
    return FRAMER_F2JS_ADMIT_OK;
}

static framer_f2js_result validate_f1wb(const uint8_t *bytes, size_t length,
                                        uint32_t generation)
{
    static const uint8_t magic[4] = { 'F', '1', 'W', 'B' };
    static const uint8_t empty_sha[32] = {
        0xe3u,0xb0u,0xc4u,0x42u,0x98u,0xfcu,0x1cu,0x14u,
        0x9au,0xfbu,0xf4u,0xc8u,0x99u,0x6fu,0xb9u,0x24u,
        0x27u,0xaeu,0x41u,0xe4u,0x64u,0x9bu,0x93u,0x4cu,
        0xa4u,0x95u,0x99u,0x1bu,0x78u,0x52u,0xb8u,0x55u,
    };
    const uint8_t *descriptor = bytes + 20u;
    uint8_t digest[32];
    uint8_t name_length;
    if (length != FRAMER_F2JS_RASTER_BASE_BYTES ||
        !bytes_equal(bytes, magic, sizeof(magic)) || bytes[4] != 1u ||
        bytes[5] != 3u || bytes[6] != 1u || bytes[7] != 0u ||
        read_u32(bytes + 8u) != generation ||
        read_u32(bytes + 12u) != FRAMER_F2JS_RASTER_BASE_BYTES ||
        read_u16(bytes + 16u) != 104u || read_u16(bytes + 18u) != 332u)
        return FRAMER_F2JS_ERR_ASSET;
    name_length = descriptor[2];
    if (descriptor[0] != 1u || descriptor[1] != 2u ||
        name_length < 1u || name_length > 16u || descriptor[3] != 0u ||
        read_u32(descriptor + 4u) != 332u ||
        read_u32(descriptor + 8u) != FRAMER_F2JS_RASTER_ANIMATION_BYTES ||
        read_u32(descriptor + 12u) != 0u || read_u32(descriptor + 16u) != 0u ||
        !bytes_equal(descriptor + 52u, empty_sha, sizeof(empty_sha)) ||
        !canonical_utf8(descriptor + 84u, name_length) ||
        !bytes_zero(descriptor + 84u + name_length, 16u - name_length) ||
        !bytes_zero(descriptor + 100u, 4u) ||
        !bytes_zero(bytes + 124u, 208u))
        return FRAMER_F2JS_ERR_ASSET;
    framer_f2js_sha256(bytes + 332u, FRAMER_F2JS_RASTER_ANIMATION_BYTES,
                       digest);
    if (!bytes_equal(digest, descriptor + 20u, 32u))
        return FRAMER_F2JS_ERR_ASSET;
    return validate_f1ra(bytes + 332u, FRAMER_F2JS_RASTER_ANIMATION_BYTES);
}

framer_f2js_result framer_f2js_admit(const uint8_t *package,
                                     size_t package_bytes,
                                     framer_f2js_admission *output)
{
    static const uint8_t magic[4] = { 'F', '2', 'J', 'S' };
    static const uint8_t strict_prefix[] = "\"use strict\";\n";
    static const uint8_t directories[4] = {
        F2JS_EVENTS_DIRECTORY, F2JS_TARGETS_DIRECTORY,
        F2JS_SOURCE_DIRECTORY, F2JS_ASSET_DIRECTORY,
    };
    f2js_section section[4];
    uint8_t source_digest[32];
    uint8_t body_digest[32];
    uint32_t generation;
    uint32_t flags;
    uint8_t event_count;
    uint8_t target_count;
    uint8_t key_count;
    uint8_t chord_count;
    uint32_t aligned_source_end;
    size_t source_bytes;
    unsigned int i;
    framer_f2js_result result;
    if (package == (const uint8_t *)0 || output == (framer_f2js_admission *)0)
        return FRAMER_F2JS_ERR_ARGUMENT;
    zero_bytes(output, sizeof(*output));
    if (package_bytes < FRAMER_F2JS_HEADER_BYTES ||
        package_bytes > FRAMER_F2JS_MAX_PACKAGE_BYTES ||
        !bytes_equal(package, magic, sizeof(magic)) ||
        read_u16(package + 4u) != F2JS_VERSION ||
        read_u16(package + 6u) != FRAMER_F2JS_HEADER_BYTES ||
        read_u32(package + 8u) != package_bytes)
        return FRAMER_F2JS_ERR_HEADER;
    generation = read_u32(package + 12u);
    flags = read_u32(package + 16u);
    event_count = package[28];
    target_count = package[29];
    key_count = package[30];
    chord_count = package[31];
    if (generation == 0u || (flags & ~F2JS_FLAG_RASTER_BASE) != 0u ||
        read_u32(package + 20u) != FRAMER_F2JS_HEAP_BYTES ||
        read_u32(package + 24u) != FRAMER_F2JS_CALLBACK_DEADLINE_US ||
        event_count > FRAMER_F2JS_MAX_EVENTS ||
        target_count > FRAMER_F2JS_MAX_TARGETS ||
        key_count > FRAMER_F2JS_MAX_KEYS || chord_count > FRAMER_F2JS_MAX_CHORDS ||
        read_u16(package + 38u) != F2JS_SECTION_COUNT)
        return FRAMER_F2JS_ERR_HEADER;
    for (i = 0u; i < 4u; ++i) {
        section[i].offset = read_u24(package + directories[i]);
        section[i].bytes = read_u24(package + directories[i] + 3u);
    }
    if (section[0].offset != FRAMER_F2JS_HEADER_BYTES ||
        section[0].bytes != (uint32_t)event_count * FRAMER_F2JS_EVENT_BYTES ||
        section[1].offset != section[0].offset + section[0].bytes ||
        section[1].bytes != (uint32_t)target_count * FRAMER_F2JS_TARGET_BYTES ||
        section[2].offset != section[1].offset + section[1].bytes ||
        section[2].bytes < 2u ||
        section[2].bytes > FRAMER_F2JS_MAX_SOURCE_BYTES + 1u)
        return FRAMER_F2JS_ERR_DIRECTORY;
    if (section[2].offset > UINT32_MAX - section[2].bytes)
        return FRAMER_F2JS_ERR_DIRECTORY;
    aligned_source_end = (section[2].offset + section[2].bytes + 3u) & ~3u;
    if (section[3].offset != aligned_source_end ||
        section[3].offset > package_bytes || section[3].bytes > package_bytes ||
        section[3].offset + (size_t)section[3].bytes != package_bytes ||
        !bytes_zero(package + section[2].offset + section[2].bytes,
                    section[3].offset - section[2].offset - section[2].bytes) ||
        (((flags & F2JS_FLAG_RASTER_BASE) != 0u) != (section[3].bytes != 0u)))
        return FRAMER_F2JS_ERR_DIRECTORY;
    source_bytes = section[2].bytes - 1u;
    if (package[section[2].offset + source_bytes] != 0u)
        return FRAMER_F2JS_ERR_SOURCE;
    for (i = 0u; i < source_bytes; ++i)
        if (package[section[2].offset + i] == 0u)
            return FRAMER_F2JS_ERR_SOURCE;
    framer_f2js_sha256(package + section[2].offset, source_bytes, source_digest);
    framer_f2js_sha256(package + FRAMER_F2JS_HEADER_BYTES,
                       package_bytes - FRAMER_F2JS_HEADER_BYTES, body_digest);
    if (!bytes_equal(source_digest, package + F2JS_SOURCE_SHA_OFFSET, 32u) ||
        !bytes_equal(body_digest, package + F2JS_BODY_SHA_OFFSET, 32u))
        return FRAMER_F2JS_ERR_HASH;
    if (!canonical_utf8(package + section[2].offset, source_bytes) ||
        source_bytes < sizeof(strict_prefix) - 1u ||
        !bytes_equal(package + section[2].offset, strict_prefix,
                     sizeof(strict_prefix) - 1u))
        return FRAMER_F2JS_ERR_SOURCE;
    if (key_count == 0u) {
        if (read_u16(package + 32u) != 0u || read_u16(package + 34u) != 0u ||
            read_u16(package + 36u) != 0u)
            return FRAMER_F2JS_ERR_INPUT;
    } else if (read_u16(package + 32u) < 1u || read_u16(package + 32u) > 50u ||
               read_u16(package + 34u) < 100u || read_u16(package + 34u) > 5000u ||
               read_u16(package + 36u) < 20u || read_u16(package + 36u) > 1000u) {
        return FRAMER_F2JS_ERR_INPUT;
    }
    result = validate_events(package + section[0].offset, event_count,
                             key_count, chord_count, output);
    if (result != FRAMER_F2JS_ADMIT_OK)
        return result;
    result = validate_targets(package + section[1].offset, target_count, output);
    if (result != FRAMER_F2JS_ADMIT_OK)
        return result;
    if (section[3].bytes != 0u) {
        result = validate_f1wb(package + section[3].offset, section[3].bytes,
                               generation);
        if (result != FRAMER_F2JS_ADMIT_OK)
            return result;
    }
    output->generation = generation;
    output->package_bytes = (uint32_t)package_bytes;
    output->asset_offset = section[3].offset;
    output->asset_bytes = section[3].bytes;
    output->debounce_ms = read_u16(package + 32u);
    output->hold_delay_ms = read_u16(package + 34u);
    output->hold_cadence_ms = read_u16(package + 36u);
    output->event_count = event_count;
    output->target_count = target_count;
    output->key_count = key_count;
    output->chord_count = chord_count;
    output->source_bytes = (uint16_t)source_bytes;
    copy_bytes(output->source_sha256, source_digest, 32u);
    copy_bytes((uint8_t *)output->source, package + section[2].offset, source_bytes);
    output->source[source_bytes] = '\0';
    framer_f2js_sha256(package, package_bytes, output->package_sha256);
    return FRAMER_F2JS_ADMIT_OK;
}

const char *framer_f2js_result_name(framer_f2js_result result)
{
    switch (result) {
    case FRAMER_F2JS_ADMIT_OK: return "ok";
    case FRAMER_F2JS_ERR_ARGUMENT: return "argument";
    case FRAMER_F2JS_ERR_HEADER: return "header";
    case FRAMER_F2JS_ERR_DIRECTORY: return "directory";
    case FRAMER_F2JS_ERR_HASH: return "hash";
    case FRAMER_F2JS_ERR_SOURCE: return "source";
    case FRAMER_F2JS_ERR_INPUT: return "input";
    case FRAMER_F2JS_ERR_EVENT: return "event";
    case FRAMER_F2JS_ERR_TARGET: return "target";
    case FRAMER_F2JS_ERR_ASSET: return "asset";
    default: return "unknown";
    }
}
