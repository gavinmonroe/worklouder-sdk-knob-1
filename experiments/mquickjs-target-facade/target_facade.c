#include "target_facade.h"

#define TF_UNUSED 255u
#define TF_PROP_TEXT 1u
#define TF_PROP_COLOR 2u
#define TF_PROP_HIDDEN 4u

typedef struct {
    uint8_t bytes[FRAMER_TF_MAX_TEXT_BYTES];
    uint8_t length;
    uint8_t palette;
    uint8_t hidden;
} tf_text;

typedef struct {
    const uint8_t *bytes;
    uint8_t length;
} tf_slice;

static uint16_t read_u16(const uint8_t *bytes)
{
    return (uint16_t)((uint16_t)bytes[0] | ((uint16_t)bytes[1] << 8));
}

static uint32_t read_u32(const uint8_t *bytes)
{
    return (uint32_t)bytes[0] | ((uint32_t)bytes[1] << 8) |
           ((uint32_t)bytes[2] << 16) | ((uint32_t)bytes[3] << 24);
}

static int bytes_equal(const uint8_t *left, const uint8_t *right, size_t count)
{
    size_t i;
    for (i = 0u; i < count; ++i) {
        if (left[i] != right[i])
            return 0;
    }
    return 1;
}

static void zero_bytes(void *value, size_t count)
{
    uint8_t *bytes = (uint8_t *)value;
    size_t i;
    for (i = 0u; i < count; ++i)
        bytes[i] = 0u;
}

static void copy_bytes(void *destination, const void *source, size_t count)
{
    uint8_t *output = (uint8_t *)destination;
    const uint8_t *input = (const uint8_t *)source;
    size_t i;
    for (i = 0u; i < count; ++i)
        output[i] = input[i];
}

uint32_t framer_tf_crc32(const uint8_t *bytes, size_t count)
{
    uint32_t crc = 0xffffffffu;
    size_t i;
    unsigned int bit;
    if (bytes == (const uint8_t *)0 && count != 0u)
        return 0u;
    for (i = 0u; i < count; ++i) {
        crc ^= bytes[i];
        for (bit = 0u; bit < 8u; ++bit)
            crc = (crc >> 1) ^ (0xedb88320u & (uint32_t)-(int32_t)(crc & 1u));
    }
    return crc ^ 0xffffffffu;
}

static uint32_t header_crc32(const uint8_t *bytes)
{
    uint32_t crc = 0xffffffffu;
    size_t i;
    unsigned int bit;
    for (i = 0u; i < FRAMER_TF_HEADER_BYTES; ++i) {
        uint8_t value = i >= 76u && i < 80u ? 0u : bytes[i];
        crc ^= value;
        for (bit = 0u; bit < 8u; ++bit)
            crc = (crc >> 1) ^ (0xedb88320u & (uint32_t)-(int32_t)(crc & 1u));
    }
    return crc ^ 0xffffffffu;
}

static int glyph_index(const framer_tf_context *context, uint8_t code)
{
    unsigned int low = 0u;
    unsigned int high = context->glyph_count;
    while (low < high) {
        unsigned int middle = low + (high - low) / 2u;
        uint8_t candidate = context->asset[context->glyphs_at + middle * 8u];
        if (candidate == code)
            return (int)middle;
        if (candidate < code)
            low = middle + 1u;
        else
            high = middle;
    }
    return -1;
}

static int target_id_valid(const uint8_t *record)
{
    unsigned int i;
    unsigned int length = 0u;
    while (length < 16u && record[length] != 0u)
        ++length;
    if (length == 0u || length > 15u || record[0] < (uint8_t)'a' ||
        record[0] > (uint8_t)'z')
        return 0;
    for (i = 1u; i < length; ++i) {
        uint8_t value = record[i];
        if (!((value >= (uint8_t)'a' && value <= (uint8_t)'z') ||
              (value >= (uint8_t)'A' && value <= (uint8_t)'Z') ||
              (value >= (uint8_t)'0' && value <= (uint8_t)'9') ||
              value == (uint8_t)'-'))
            return 0;
    }
    for (i = length; i < 16u; ++i) {
        if (record[i] != 0u)
            return 0;
    }
    return 1;
}

static uint8_t expected_properties(uint8_t format)
{
    switch (format) {
    case 1u: return TF_PROP_HIDDEN;
    case 2u: return TF_PROP_TEXT;
    case 3u: return TF_PROP_TEXT | TF_PROP_COLOR;
    case 4u: return TF_PROP_TEXT;
    case 5u: return TF_PROP_TEXT | TF_PROP_COLOR;
    case 6u: return TF_PROP_TEXT;
    case 7u: return TF_PROP_TEXT;
    case 8u: return TF_PROP_TEXT | TF_PROP_COLOR;
    case 9u: return TF_PROP_TEXT;
    case 10u: return TF_PROP_TEXT | TF_PROP_COLOR | TF_PROP_HIDDEN;
    default: return 0u;
    }
}

static uint8_t used_slots(uint8_t format)
{
    switch (format) {
    case 1u: case 2u: return format == 1u ? 1u : 0u;
    case 3u: case 4u: case 5u: case 6u: case 7u: case 8u: case 10u: return 2u;
    case 9u: return 3u;
    default: return 0xffu;
    }
}

static uint8_t expected_table_count(uint8_t format)
{
    switch (format) {
    case 1u: return 0u;
    case 2u: return 1u;
    case 3u: return 5u;
    case 4u: return 1u;
    case 5u: return 17u;
    case 6u: return 3u;
    case 7u: return 8u;
    case 8u: return 17u;
    case 9u: return 1u;
    case 10u: return 1u;
    default: return 0xffu;
    }
}

static int table_entry(const framer_tf_context *context,
                       const uint8_t *record,
                       uint8_t requested,
                       tf_slice *slice)
{
    uint32_t relative = read_u16(record + 36u);
    uint32_t count_bytes = record[38];
    const uint8_t *table;
    uint32_t cursor;
    uint8_t count;
    uint8_t index;
    if (record[39] != 0u || relative > context->literal_bytes ||
        count_bytes > context->literal_bytes - relative)
        return 0;
    if (count_bytes == 0u)
        return requested == 0xffu;
    table = context->asset + context->literals_at + relative;
    count = table[0];
    cursor = 1u;
    for (index = 0u; index < count; ++index) {
        uint8_t length;
        if (cursor >= count_bytes)
            return 0;
        length = table[cursor++];
        if (length > FRAMER_TF_MAX_TEXT_BYTES || length > count_bytes - cursor)
            return 0;
        if (index == requested && slice != (tf_slice *)0) {
            slice->bytes = table + cursor;
            slice->length = length;
        }
        cursor += length;
    }
    return cursor == count_bytes && (requested == 0xffu || requested < count);
}

static int validate_table(const framer_tf_context *context,
                          const uint8_t *record,
                          uint8_t format)
{
    uint8_t expected = expected_table_count(format);
    uint32_t relative = read_u16(record + 36u);
    uint32_t count_bytes = record[38];
    const uint8_t *table;
    uint32_t cursor;
    uint8_t count;
    uint8_t index;
    if (record[39] != 0u || relative > context->literal_bytes ||
        count_bytes > context->literal_bytes - relative)
        return 0;
    if (expected == 0u)
        return count_bytes == 0u;
    if (count_bytes == 0u)
        return 0;
    table = context->asset + context->literals_at + relative;
    count = table[0];
    if (count != expected)
        return 0;
    cursor = 1u;
    for (index = 0u; index < count; ++index) {
        uint8_t length;
        uint8_t character;
        if (cursor >= count_bytes)
            return 0;
        length = table[cursor++];
        if (length > FRAMER_TF_MAX_TEXT_BYTES || length > count_bytes - cursor)
            return 0;
        for (character = 0u; character < length; ++character) {
            if (glyph_index(context, table[cursor + character]) < 0)
                return 0;
        }
        cursor += length;
    }
    return cursor == count_bytes;
}

static int target_valid(const framer_tf_context *context,
                        const uint8_t *record,
                        unsigned int target_index)
{
    uint16_t x = read_u16(record + 16u);
    uint16_t y = read_u16(record + 18u);
    uint16_t width = read_u16(record + 20u);
    uint16_t height = read_u16(record + 22u);
    uint8_t format = record[25];
    uint8_t slots;
    unsigned int index;
    if (!target_id_valid(record) || format < 1u || format > 10u ||
        record[24] != expected_properties(format) || width == 0u || height == 0u ||
        x >= FRAMER_TF_CANVAS_WIDTH || y >= FRAMER_TF_CANVAS_HEIGHT ||
        width > FRAMER_TF_CANVAS_WIDTH - x ||
        height > FRAMER_TF_CANVAS_HEIGHT - y)
        return 0;
    for (index = 0u; index < target_index; ++index) {
        const uint8_t *prior = context->asset + context->targets_at + index * FRAMER_TF_TARGET_BYTES;
        if (bytes_equal(prior, record, 16u))
            return 0;
    }
    slots = used_slots(format);
    if (slots == 0xffu)
        return 0;
    for (index = 0u; index < 4u; ++index) {
        if ((index < slots && record[26u + index] >= FRAMER_TF_MAILBOX_SLOTS) ||
            (index >= slots && record[26u + index] != TF_UNUSED))
            return 0;
    }
    if (format == 1u) {
        if (record[30] != TF_UNUSED || record[31] != TF_UNUSED ||
            record[32] != TF_UNUSED || record[33] != 0u || record[34] != 0u ||
            record[35] != 0u)
            return 0;
    } else if (record[30] >= context->palette_count ||
               record[31] >= context->palette_count || record[32] != 0u ||
               record[33] > 2u || record[34] == 0u ||
               record[34] > FRAMER_TF_MAX_TEXT_BYTES || record[35] == 0u ||
               record[35] > 3u) {
        return 0;
    }
    return validate_table(context, record, format);
}

framer_tf_result framer_tf_admit(framer_tf_context *context,
                                 const uint8_t *asset,
                                 size_t asset_bytes,
                                 const uint16_t *base,
                                 size_t base_pixels,
                                 uint32_t expected_generation,
                                 const uint8_t expected_f2js_sha256[32],
                                 const uint8_t expected_contract_sha256[32],
                                 uintptr_t owner_thread_token)
{
    uint32_t targets_at;
    uint32_t targets_bytes;
    uint32_t palette_at;
    uint32_t palette_bytes;
    uint32_t glyphs_at;
    uint32_t glyph_bytes;
    uint32_t literals_at;
    uint32_t literal_bytes;
    unsigned int i;
    framer_tf_context candidate;
    if (context == (framer_tf_context *)0 || asset == (const uint8_t *)0 ||
        base == (const uint16_t *)0 || expected_f2js_sha256 == (const uint8_t *)0 ||
        expected_contract_sha256 == (const uint8_t *)0 || owner_thread_token == 0u)
        return FRAMER_TF_ERR_ARGUMENT;
    zero_bytes(context, sizeof(*context));
    if (asset_bytes < FRAMER_TF_HEADER_BYTES || asset_bytes > FRAMER_TF_MAX_ASSET_BYTES ||
        base_pixels != FRAMER_TF_CANVAS_PIXELS || !bytes_equal(asset, (const uint8_t *)"F2TF", 4u) ||
        read_u16(asset + 4u) != 1u || read_u16(asset + 6u) != FRAMER_TF_HEADER_BYTES ||
        read_u32(asset + 8u) != asset_bytes)
        return FRAMER_TF_ERR_MALFORMED;
    if (framer_tf_crc32(asset + FRAMER_TF_HEADER_BYTES,
                        asset_bytes - FRAMER_TF_HEADER_BYTES) != read_u32(asset + 72u) ||
        header_crc32(asset) != read_u32(asset + 76u))
        return FRAMER_TF_ERR_CRC;
    for (i = 80u; i < 96u; ++i) {
        if (asset[i] != 0u)
            return FRAMER_TF_ERR_MALFORMED;
    }
    if (read_u32(asset + 12u) != expected_generation || expected_generation == 0u ||
        read_u16(asset + 16u) != FRAMER_TF_CANVAS_WIDTH ||
        read_u16(asset + 18u) != FRAMER_TF_CANVAS_HEIGHT || asset[20] != 1u ||
        asset[21] != FRAMER_TF_TARGET_COUNT || asset[22] != FRAMER_TF_TARGET_BYTES ||
        asset[23] == 0u || asset[23] > 16u || read_u16(asset + 24u) == 0u ||
        read_u16(asset + 24u) > 64u || asset[26] != 8u || asset[27] != 5u ||
        asset[28] != 7u || asset[29] != 6u || asset[30] != FRAMER_TF_MAX_TEXT_BYTES ||
        asset[31] != 0u || read_u32(asset + 32u) == 0u ||
        read_u32(asset + 32u) > FRAMER_TF_MAX_OVERLAY_WRITES ||
        !bytes_equal(asset + 128u, expected_f2js_sha256, 32u) ||
        !bytes_equal(asset + 160u, expected_contract_sha256, 32u))
        return FRAMER_TF_ERR_MALFORMED;
    if (framer_tf_crc32((const uint8_t *)base, base_pixels * 2u) != read_u32(asset + 68u))
        return FRAMER_TF_ERR_BASE;
    targets_at = read_u32(asset + 36u); targets_bytes = read_u32(asset + 40u);
    palette_at = read_u32(asset + 44u); palette_bytes = read_u32(asset + 48u);
    glyphs_at = read_u32(asset + 52u); glyph_bytes = read_u32(asset + 56u);
    literals_at = read_u32(asset + 60u); literal_bytes = read_u32(asset + 64u);
    if (targets_at != FRAMER_TF_HEADER_BYTES ||
        targets_bytes != FRAMER_TF_TARGET_COUNT * FRAMER_TF_TARGET_BYTES ||
        palette_at != targets_at + targets_bytes || palette_bytes != (uint32_t)asset[23] * 2u ||
        glyphs_at != palette_at + palette_bytes || glyph_bytes != (uint32_t)read_u16(asset + 24u) * 8u ||
        literals_at != glyphs_at + glyph_bytes || literal_bytes != asset_bytes - literals_at)
        return FRAMER_TF_ERR_MALFORMED;
    zero_bytes(&candidate, sizeof(candidate));
    candidate.asset = asset; candidate.asset_bytes = asset_bytes;
    candidate.base = base; candidate.base_pixels = base_pixels;
    candidate.generation = expected_generation; candidate.owner_thread_token = owner_thread_token;
    candidate.max_overlay_writes = read_u32(asset + 32u);
    candidate.targets_at = targets_at; candidate.palette_at = palette_at;
    candidate.glyphs_at = glyphs_at; candidate.literals_at = literals_at;
    candidate.literal_bytes = literal_bytes; candidate.glyph_count = read_u16(asset + 24u);
    candidate.palette_count = asset[23];
    for (i = 0u; i < candidate.glyph_count; ++i) {
        const uint8_t *glyph = asset + glyphs_at + i * 8u;
        unsigned int column;
        if ((i > 0u && glyph[0] <= asset[glyphs_at + (i - 1u) * 8u]) ||
            glyph[1] != 5u || glyph[7] != 6u)
            return FRAMER_TF_ERR_MALFORMED;
        for (column = 0u; column < 5u; ++column) {
            if ((glyph[2u + column] & 0x80u) != 0u)
                return FRAMER_TF_ERR_MALFORMED;
        }
    }
    for (i = 0u; i < FRAMER_TF_TARGET_COUNT; ++i) {
        if (!target_valid(&candidate, asset + targets_at + i * FRAMER_TF_TARGET_BYTES, i))
            return FRAMER_TF_ERR_MALFORMED;
    }
    candidate.admitted = 1u;
    copy_bytes(context, &candidate, sizeof(candidate));
    return FRAMER_TF_OK;
}

framer_tf_result framer_tf_snapshot_mailbox(
    const framer_tf_mailbox *mailbox,
    framer_tf_snapshot *snapshot,
    framer_tf_snapshot_probe probe,
    void *probe_opaque,
    uint32_t *attempts)
{
    uint32_t attempt;
    unsigned int slot;
    if (mailbox == (const framer_tf_mailbox *)0 || snapshot == (framer_tf_snapshot *)0)
        return FRAMER_TF_ERR_ARGUMENT;
    for (attempt = 1u; attempt <= FRAMER_TF_SNAPSHOT_ATTEMPTS; ++attempt) {
        uint32_t first = __atomic_load_n(&mailbox->sequence, __ATOMIC_ACQUIRE);
        uint32_t second;
        if ((first & 1u) != 0u)
            continue;
        for (slot = 0u; slot < FRAMER_TF_MAILBOX_SLOTS; ++slot)
            snapshot->slots[slot] = __atomic_load_n(&mailbox->slots[slot], __ATOMIC_SEQ_CST);
        snapshot->admitted_generation = __atomic_load_n(&mailbox->admitted_generation,
                                                         __ATOMIC_SEQ_CST);
        if (probe != (framer_tf_snapshot_probe)0)
            probe(probe_opaque, mailbox);
        __atomic_thread_fence(__ATOMIC_SEQ_CST);
        second = __atomic_load_n(&mailbox->sequence, __ATOMIC_ACQUIRE);
        if (first == second && (second & 1u) == 0u) {
            snapshot->sequence = second;
            if (attempts != (uint32_t *)0)
                *attempts = attempt;
            return FRAMER_TF_OK;
        }
    }
    if (attempts != (uint32_t *)0)
        *attempts = FRAMER_TF_SNAPSHOT_ATTEMPTS;
    return FRAMER_TF_ERR_TORN;
}

static int append_byte(tf_text *text, uint8_t value)
{
    if (text->length >= FRAMER_TF_MAX_TEXT_BYTES)
        return 0;
    text->bytes[text->length++] = value;
    return 1;
}

static int append_slice(tf_text *text, const tf_slice *slice)
{
    unsigned int i;
    if ((uint32_t)text->length + slice->length > FRAMER_TF_MAX_TEXT_BYTES)
        return 0;
    for (i = 0u; i < slice->length; ++i)
        text->bytes[text->length++] = slice->bytes[i];
    return 1;
}

static int append_ascii(tf_text *text, const char *value)
{
    while (*value != '\0') {
        if (!append_byte(text, (uint8_t)*value++))
            return 0;
    }
    return 1;
}

static int append_u32(tf_text *text, uint32_t value)
{
    uint8_t digits[10];
    unsigned int count = 0u;
    do {
        digits[count++] = (uint8_t)('0' + value % 10u);
        value /= 10u;
    } while (value != 0u && count < 10u);
    while (count > 0u) {
        if (!append_byte(text, digits[--count]))
            return 0;
    }
    return value == 0u;
}

/* General signed formatter retained by the facade contract even though the
 * weather temperatures arrive as four-byte packed ASCII words. */
static int append_i32(tf_text *text, int32_t value)
{
    uint32_t magnitude;
    if (value < 0) {
        if (!append_byte(text, (uint8_t)'-'))
            return 0;
        magnitude = (uint32_t)(-(value + 1)) + 1u;
    } else {
        magnitude = (uint32_t)value;
    }
    return append_u32(text, magnitude);
}

static int packed_ascii(tf_text *text, uint32_t word, int32_t *numeric)
{
    uint8_t values[4];
    uint8_t length = 0u;
    uint8_t index;
    int negative = 0;
    int ended = 0;
    uint32_t magnitude = 0u;
    for (index = 0u; index < 4u; ++index) {
        uint8_t value = (uint8_t)(word >> (index * 8u));
        if (value == 0u) {
            ended = 1;
            continue;
        }
        if (ended || ((value < (uint8_t)'0' || value > (uint8_t)'9') &&
                      !(length == 0u && value == (uint8_t)'-')))
            return 0;
        values[length++] = value;
    }
    if (length == 0u || length > 4u)
        return 0;
    index = 0u;
    if (values[0] == (uint8_t)'-') {
        negative = 1;
        index = 1u;
        if (length == 1u)
            return 0;
    }
    if ((uint8_t)(length - index) > 3u)
        return 0;
    for (; index < length; ++index)
        magnitude = magnitude * 10u + (uint32_t)(values[index] - (uint8_t)'0');
    if (magnitude > 999u || (uint32_t)text->length + length > FRAMER_TF_MAX_TEXT_BYTES)
        return 0;
    for (index = 0u; index < length; ++index)
        text->bytes[text->length++] = values[index];
    *numeric = negative ? -(int32_t)magnitude : (int32_t)magnitude;
    return 1;
}

static int copy_table(const framer_tf_context *context,
                      const uint8_t *record,
                      uint8_t index,
                      tf_text *text)
{
    tf_slice slice;
    return table_entry(context, record, index, &slice) && append_slice(text, &slice);
}

static int valid_day_meta(uint32_t meta)
{
    return (meta & ~0x3fu) == 0u && (meta & 7u) <= 6u && ((meta >> 3) & 15u) <= 7u;
}

static int prepare_target(const framer_tf_context *context,
                          const uint8_t *record,
                          const int32_t slots[FRAMER_TF_MAILBOX_SLOTS],
                          tf_text *text)
{
    uint8_t format = record[25];
    uint32_t flags;
    int has_good;
    int32_t numeric;
    zero_bytes(text, sizeof(*text));
    text->palette = record[30];
    if (format == 1u) {
        flags = (uint32_t)slots[record[26]];
        if ((flags & ~7u) != 0u)
            return 0;
        text->hidden = (uint8_t)((flags & 2u) != 0u);
        return 1;
    }
    if (format == 9u)
        flags = (uint32_t)slots[record[28]];
    else if (format == 2u)
        flags = (uint32_t)slots[15];
    else
        flags = (uint32_t)slots[record[27]];
    if ((flags & ~7u) != 0u)
        return 0;
    has_good = (flags & 1u) != 0u;
    if (format == 2u) {
        if (!copy_table(context, record, 0u, text)) return 0;
    } else if (format == 3u) {
        int32_t freshness = slots[record[26]];
        if (freshness < 0 || freshness > 4 || !copy_table(context, record, (uint8_t)freshness, text)) return 0;
        if (freshness != 1) text->palette = record[31];
    } else if (format == 4u) {
        if (!has_good) { if (!append_ascii(text, "--")) return 0; }
        else if (!packed_ascii(text, (uint32_t)slots[record[26]], &numeric)) return 0;
        if (!append_byte(text, 0xb0u) || !copy_table(context, record, 0u, text)) return 0;
    } else if (format == 5u) {
        if (!has_good) { if (!copy_table(context, record, 16u, text)) return 0; }
        else {
            uint32_t meta = (uint32_t)slots[record[26]];
            uint8_t condition;
            if ((meta & ~31u) != 0u || (meta & 15u) > 7u) return 0;
            condition = (uint8_t)((meta & 15u) + ((meta & 16u) != 0u ? 0u : 8u));
            if (!copy_table(context, record, condition, text)) return 0;
            if ((meta & 16u) == 0u) text->palette = record[31];
        }
    } else if (format == 6u) {
        if (!has_good) { if (!append_ascii(text, "NO DATA")) return 0; }
        else {
            int32_t age = slots[record[26]];
            uint8_t unit;
            if (age < 0 || age > 604800) return 0;
            unit = age < 60 ? 0u : age < 3600 ? 1u : 2u;
            if (!append_i32(text, unit == 0u ? age : unit == 1u ? age / 60 : age / 3600) ||
                !copy_table(context, record, unit, text)) return 0;
        }
    } else if (format == 7u) {
        if (!has_good) { if (!copy_table(context, record, 7u, text)) return 0; }
        else {
            uint32_t meta = (uint32_t)slots[record[26]];
            if (!valid_day_meta(meta) || !copy_table(context, record, (uint8_t)(meta & 7u), text)) return 0;
        }
    } else if (format == 8u) {
        if (!has_good) { if (!copy_table(context, record, 16u, text)) return 0; }
        else {
            uint32_t meta = (uint32_t)slots[record[26]];
            uint8_t condition;
            if (!valid_day_meta(meta)) return 0;
            condition = (uint8_t)((meta >> 3) & 15u);
            if (!copy_table(context, record, condition, text)) return 0;
            if (condition >= 5u) text->palette = record[31];
        }
    } else if (format == 9u) {
        if (!has_good) { if (!append_ascii(text, "--")) return 0; }
        else {
            int32_t low;
            int32_t high;
            if (!packed_ascii(text, (uint32_t)slots[record[26]], &low) ||
                !append_byte(text, 0xb0u) || !append_byte(text, (uint8_t)' ') ||
                !packed_ascii(text, (uint32_t)slots[record[27]], &high) ||
                !append_byte(text, 0xb0u) || low > high) return 0;
        }
    } else if (format == 10u) {
        int32_t retry = slots[record[26]];
        if (retry < 0 || retry > 86400) return 0;
        text->hidden = (uint8_t)(retry == 0);
        if (!text->hidden && (!copy_table(context, record, 0u, text) ||
            !append_i32(text, retry) || !append_byte(text, (uint8_t)'S'))) return 0;
    } else {
        return 0;
    }
    return text->length <= record[34];
}

static uint16_t palette_color(const framer_tf_context *context, uint8_t index)
{
    return read_u16(context->asset + context->palette_at + (uint32_t)index * 2u);
}

static uint32_t target_pixels(const framer_tf_context *context,
                              const uint8_t *record,
                              const tf_text *text,
                              uint16_t *framebuffer,
                              int draw)
{
    int32_t target_x = read_u16(record + 16u);
    int32_t target_y = read_u16(record + 18u);
    int32_t target_width = read_u16(record + 20u);
    int32_t target_height = read_u16(record + 22u);
    int32_t scale = record[35];
    int32_t text_width = text->length == 0u ? 0 : (int32_t)text->length * 6 * scale - scale;
    int32_t x = target_x;
    int32_t y = target_y + (target_height - 7 * scale) / 2;
    uint32_t writes = 0u;
    uint16_t color;
    uint8_t character;
    if (text->hidden || record[25] == 1u)
        return 0u;
    if (record[33] == 1u)
        x += (target_width - text_width) / 2;
    else if (record[33] == 2u)
        x += target_width - text_width;
    color = palette_color(context, text->palette);
    for (character = 0u; character < text->length; ++character) {
        int glyph = glyph_index(context, text->bytes[character]);
        const uint8_t *record_glyph;
        unsigned int column;
        unsigned int row;
        if (glyph < 0)
            return FRAMER_TF_MAX_OVERLAY_WRITES + 1u;
        record_glyph = context->asset + context->glyphs_at + (uint32_t)glyph * 8u;
        for (column = 0u; column < 5u; ++column) {
            for (row = 0u; row < 7u; ++row) {
                unsigned int sx;
                unsigned int sy;
                if (((record_glyph[2u + column] >> row) & 1u) == 0u)
                    continue;
                for (sy = 0u; sy < (unsigned int)scale; ++sy) {
                    for (sx = 0u; sx < (unsigned int)scale; ++sx) {
                        int32_t pixel_x = x + (int32_t)column * scale + (int32_t)sx;
                        int32_t pixel_y = y + (int32_t)row * scale + (int32_t)sy;
                        if (pixel_x < target_x || pixel_x >= target_x + target_width ||
                            pixel_y < target_y || pixel_y >= target_y + target_height ||
                            pixel_x < 0 || pixel_x >= (int32_t)FRAMER_TF_CANVAS_WIDTH ||
                            pixel_y < 0 || pixel_y >= (int32_t)FRAMER_TF_CANVAS_HEIGHT)
                            continue;
                        ++writes;
                        if (draw)
                            framebuffer[(uint32_t)pixel_y * FRAMER_TF_CANVAS_WIDTH +
                                        (uint32_t)pixel_x] = color;
                    }
                }
            }
        }
        x += (int32_t)record_glyph[7] * scale;
    }
    return writes;
}

static framer_tf_result render_internal(framer_tf_context *context,
                                        const framer_tf_mailbox *mailbox,
                                        uint16_t *framebuffer,
                                        size_t framebuffer_pixels,
                                        uintptr_t current_thread_token,
                                        framer_tf_metrics *metrics,
                                        framer_tf_snapshot_probe probe,
                                        void *probe_opaque)
{
    framer_tf_snapshot snapshot;
    tf_text text[FRAMER_TF_TARGET_COUNT];
    framer_tf_result result;
    uint32_t overlay_writes = 0u;
    uint32_t attempts = 0u;
    unsigned int index;
    if (metrics != (framer_tf_metrics *)0)
        zero_bytes(metrics, sizeof(*metrics));
    if (context == (framer_tf_context *)0 || context->admitted == 0u ||
        mailbox == (const framer_tf_mailbox *)0 || framebuffer == (uint16_t *)0 ||
        framebuffer_pixels != FRAMER_TF_CANVAS_PIXELS)
        return FRAMER_TF_ERR_ARGUMENT;
    if (current_thread_token == 0u || current_thread_token != context->owner_thread_token)
        return FRAMER_TF_ERR_WRONG_THREAD;
    for (index = 0u; index < FRAMER_TF_CANVAS_PIXELS; ++index)
        framebuffer[index] = context->base[index];
    if (metrics != (framer_tf_metrics *)0)
        metrics->base_writes = FRAMER_TF_CANVAS_PIXELS;
    result = framer_tf_snapshot_mailbox(mailbox, &snapshot, probe, probe_opaque, &attempts);
    if (metrics != (framer_tf_metrics *)0)
        metrics->snapshot_attempts = attempts;
    if (result != FRAMER_TF_OK)
        return result;
    if (snapshot.admitted_generation != context->generation)
        return FRAMER_TF_ERR_GENERATION;
    if (snapshot.slots[0] < 0 || (uint32_t)snapshot.slots[0] < context->last_applied_revision)
        return FRAMER_TF_ERR_REVISION;
    for (index = 0u; index < FRAMER_TF_TARGET_COUNT; ++index) {
        const uint8_t *record = context->asset + context->targets_at + index * FRAMER_TF_TARGET_BYTES;
        if (!prepare_target(context, record, snapshot.slots, &text[index]))
            return FRAMER_TF_ERR_FORMAT;
    }
    if (text[0].hidden) {
        context->last_applied_revision = (uint32_t)snapshot.slots[0];
        if (metrics != (framer_tf_metrics *)0) {
            metrics->applied_generation = context->generation;
            metrics->applied_revision = context->last_applied_revision;
        }
        return FRAMER_TF_HIDDEN;
    }
    for (index = 1u; index < FRAMER_TF_TARGET_COUNT; ++index) {
        const uint8_t *record = context->asset + context->targets_at + index * FRAMER_TF_TARGET_BYTES;
        uint32_t writes = target_pixels(context, record, &text[index], framebuffer, 0);
        if (writes > context->max_overlay_writes ||
            overlay_writes > context->max_overlay_writes - writes)
            return FRAMER_TF_ERR_OVERFLOW;
        overlay_writes += writes;
    }
    for (index = 1u; index < FRAMER_TF_TARGET_COUNT; ++index) {
        const uint8_t *record = context->asset + context->targets_at + index * FRAMER_TF_TARGET_BYTES;
        (void)target_pixels(context, record, &text[index], framebuffer, 1);
    }
    context->last_applied_revision = (uint32_t)snapshot.slots[0];
    if (metrics != (framer_tf_metrics *)0) {
        metrics->overlay_writes = overlay_writes;
        metrics->formatted_targets = FRAMER_TF_TARGET_COUNT - 1u;
        metrics->applied_generation = context->generation;
        metrics->applied_revision = context->last_applied_revision;
    }
    return FRAMER_TF_OK;
}

framer_tf_result framer_tf_render(framer_tf_context *context,
                                  const framer_tf_mailbox *mailbox,
                                  uint16_t *framebuffer,
                                  size_t framebuffer_pixels,
                                  uintptr_t current_thread_token,
                                  framer_tf_metrics *metrics)
{
    return render_internal(context, mailbox, framebuffer, framebuffer_pixels,
                           current_thread_token, metrics,
                           (framer_tf_snapshot_probe)0, (void *)0);
}

framer_tf_result framer_tf_render_probe(framer_tf_context *context,
                                        const framer_tf_mailbox *mailbox,
                                        uint16_t *framebuffer,
                                        size_t framebuffer_pixels,
                                        uintptr_t current_thread_token,
                                        framer_tf_metrics *metrics,
                                        framer_tf_snapshot_probe probe,
                                        void *probe_opaque)
{
    return render_internal(context, mailbox, framebuffer, framebuffer_pixels,
                           current_thread_token, metrics, probe, probe_opaque);
}
