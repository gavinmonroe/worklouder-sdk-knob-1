#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define FRAMER_SHA256_NATIVE_KAT 1
#include "resident_loader_canary.c"

int esp_mmu_map(uint32_t paddr_start, size_t size, uint32_t target,
                uint32_t caps, int flags, void **out_ptr)
{
    (void)paddr_start; (void)size; (void)target; (void)caps; (void)flags;
    (void)out_ptr;
    return -1;
}

int esp_mmu_unmap(void *ptr)
{
    (void)ptr;
    return -1;
}

static void words_to_bytes(const uint32_t words[8], uint8_t digest[32])
{
    unsigned int i;
    for (i = 0; i < 8u; ++i) {
        digest[i * 4u] = (uint8_t)(words[i] >> 24);
        digest[i * 4u + 1u] = (uint8_t)(words[i] >> 16);
        digest[i * 4u + 2u] = (uint8_t)(words[i] >> 8);
        digest[i * 4u + 3u] = (uint8_t)words[i];
    }
}

static int digest_matches(const uint8_t *bytes, size_t length,
                          const uint8_t expected[32])
{
    uint32_t words[8];
    uint8_t digest[32];
    framer_mqjs_resident_sha256_words(bytes, length, words);
    words_to_bytes(words, digest);
    return memcmp(digest, expected, sizeof(digest)) == 0;
}

static uint8_t *read_page(const char *path, size_t expected_length)
{
    FILE *file = fopen(path, "rb");
    uint8_t *bytes;
    long length;
    if (file == NULL || fseek(file, 0, SEEK_END) != 0)
        return NULL;
    length = ftell(file);
    if (length < 0 || (size_t)length != expected_length ||
        fseek(file, 0, SEEK_SET) != 0) {
        fclose(file);
        return NULL;
    }
    bytes = (uint8_t *)malloc(expected_length);
    if (bytes == NULL || fread(bytes, 1, expected_length, file) != expected_length) {
        free(bytes);
        fclose(file);
        return NULL;
    }
    fclose(file);
    return bytes;
}

int main(int argc, char **argv)
{
    static const uint8_t empty_digest[32] = {
        0xe3,0xb0,0xc4,0x42,0x98,0xfc,0x1c,0x14,
        0x9a,0xfb,0xf4,0xc8,0x99,0x6f,0xb9,0x24,
        0x27,0xae,0x41,0xe4,0x64,0x9b,0x93,0x4c,
        0xa4,0x95,0x99,0x1b,0x78,0x52,0xb8,0x55,
    };
    static const uint8_t abc_digest[32] = {
        0xba,0x78,0x16,0xbf,0x8f,0x01,0xcf,0xea,
        0x41,0x41,0x40,0xde,0x5d,0xae,0x22,0x23,
        0xb0,0x03,0x61,0xa3,0x96,0x17,0x7a,0x9c,
        0xb4,0x10,0xff,0x61,0xf2,0x00,0x15,0xad,
    };
    static const uint8_t two_block_digest[32] = {
        0x24,0x8d,0x6a,0x61,0xd2,0x06,0x38,0xb8,
        0xe5,0xc0,0x26,0x93,0x0c,0x3e,0x60,0x39,
        0xa3,0x3c,0xe4,0x59,0x64,0xff,0x21,0x67,
        0xf6,0xec,0xed,0xd4,0x19,0xdb,0x06,0xc1,
    };
    static const char two_block[] =
        "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq";
    uint8_t *text;
    uint8_t *rodata;
    framer_mqjs_mapped_module failed_cleanup = {
        (void *)(uintptr_t)1u, (void *)(uintptr_t)2u, (void *)(uintptr_t)3u,
        (const void *)(uintptr_t)4u, MODULE_MAGIC,
    };
    if (argc != 3 ||
        !digest_matches((const uint8_t *)"", 0, empty_digest) ||
        !digest_matches((const uint8_t *)"abc", 3, abc_digest) ||
        !digest_matches((const uint8_t *)two_block, sizeof(two_block) - 1u,
                        two_block_digest))
        return 2;
    text = read_page(argv[1], MODULE_TEXT_CAPACITY);
    rodata = read_page(argv[2], MODULE_RODATA_CAPACITY);
    if (text == NULL || rodata == NULL ||
        !sha256_page_matches(text, MODULE_TEXT_CAPACITY, 1) ||
        !sha256_page_matches(rodata, MODULE_RODATA_CAPACITY, 0))
        return 3;
    text[0] ^= 1u;
    if (sha256_page_matches(text, MODULE_TEXT_CAPACITY, 1))
        return 4;
    rodata[MODULE_RODATA_CAPACITY - 1u] ^= 1u;
    if (sha256_page_matches(rodata, MODULE_RODATA_CAPACITY, 0))
        return 5;
    if (framer_mqjs_unmap_canary(&failed_cleanup) != -32 ||
        failed_cleanup.text == NULL || failed_cleanup.rodata == NULL ||
        failed_cleanup.cleanup == NULL || failed_cleanup.descriptor != NULL ||
        failed_cleanup.probe_result != 0u)
        return 6;
    free(text);
    free(rodata);
    puts("resident SHA-256 KAT/pages/tamper + unmap fail-close: PASS");
    return 0;
}
