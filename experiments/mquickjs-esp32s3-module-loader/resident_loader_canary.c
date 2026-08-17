#include "resident_loader_canary.h"

#include <stddef.h>
#include <stdint.h>

#ifndef FRAMER_MODULE_TEXT_SHA256_W0
#error "FRAMER_MODULE_TEXT_SHA256_W0 must pin the complete padded text payload"
#endif
#ifndef FRAMER_MODULE_RODATA_SHA256_W0
#error "FRAMER_MODULE_RODATA_SHA256_W0 must pin the complete padded rodata payload"
#endif
#ifndef FRAMER_MODULE_RUNTIME_STORAGE_BYTES
#error "FRAMER_MODULE_RUNTIME_STORAGE_BYTES must pin the engine ABI"
#endif
#ifndef FRAMER_MODULE_MIN_HEAP_BYTES
#error "FRAMER_MODULE_MIN_HEAP_BYTES must pin the engine heap contract"
#endif
#ifndef FRAMER_MODULE_TEXT_USED_BYTES
#error "FRAMER_MODULE_TEXT_USED_BYTES must bound every exported function"
#endif
#ifndef FRAMER_MQJS_ABI_SHA256_W0
#error "The loader must reject a stale engine/input ABI"
#endif

#define ESP_OK 0
#define MMU_TARGET_FLASH0 1u
#define MMU_MEM_CAP_EXEC 1u
#define MMU_MEM_CAP_READ 2u
#define MMU_MEM_CAP_32BIT 8u
#define MMU_MEM_CAP_8BIT 16u

#define MODULE_MAGIC 0x534a514dUL
#define MODULE_ABI_VERSION 3u
#define MODULE_TEXT_PADDR 0x00210000UL
#define MODULE_TEXT_VADDR 0x423d0000UL
#define MODULE_TEXT_CAPACITY 0x00020000UL
#define MODULE_RODATA_PADDR 0x00230000UL
#define MODULE_RODATA_VADDR 0x3c3f0000UL
#define MODULE_RODATA_CAPACITY 0x00010000UL
#define MODULE_VERIFY_VADDR 0x3c3d0000UL

typedef int (*esp_mmu_map_fn)(uint32_t paddr_start, size_t size,
                              uint32_t target, uint32_t caps, int flags,
                              void **out_ptr);
typedef int (*esp_mmu_unmap_fn)(void *ptr);

extern int esp_mmu_map(uint32_t paddr_start, size_t size, uint32_t target,
                       uint32_t caps, int flags, void **out_ptr);
extern int esp_mmu_unmap(void *ptr);

typedef struct {
    uint32_t magic;
    uint16_t abi_version;
    uint16_t descriptor_bytes;
    uint32_t text_vaddr;
    uint32_t text_capacity;
    uint32_t rodata_vaddr;
    uint32_t rodata_capacity;
    uint32_t minimum_heap_bytes;
    uint32_t runtime_storage_bytes;
    uint32_t slot_count;
    uint32_t abi_sha256[8];
    uintptr_t probe;
    uintptr_t init;
    uintptr_t load;
    uintptr_t dispatch;
    uintptr_t input_enqueue;
    uintptr_t input_request_release_all;
    uintptr_t input_request_focus_release;
    uintptr_t input_drain;
    uintptr_t input_get_observation;
    uintptr_t get_telemetry;
    uintptr_t get_last_good_slots;
    uintptr_t destroy;
} framer_mqjs_module_descriptor;

static uint32_t rotate_right(uint32_t value, unsigned int bits)
{
    return (value >> bits) | (value << (32u - bits));
}

/* The loader maps flash with MMU_MEM_CAP_32BIT. Keeping this aligned table in
 * its executable section permits indexed aligned reads without a DROM/data
 * dependency, while the linker still rejects any standalone rodata. */
#ifdef FRAMER_SHA256_NATIVE_KAT
#define FRAMER_SHA256_K_ATTRIBUTES __attribute__((aligned(4), used))
#else
#define FRAMER_SHA256_K_ATTRIBUTES \
    __attribute__((section(".literal.sha256_k"), aligned(4), used))
#endif
static const uint32_t sha256_k[64] FRAMER_SHA256_K_ATTRIBUTES = {
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
#undef FRAMER_SHA256_K_ATTRIBUTES

static void sha256_block(uint32_t state[8], const uint8_t block[64])
{
    uint32_t w[16];
    uint32_t a = state[0], b = state[1], c = state[2], d = state[3];
    uint32_t e = state[4], f = state[5], g = state[6], h = state[7];
    unsigned int i;
    for (i = 0; i < 64u; ++i) {
        uint32_t wi;
        uint32_t s0, s1, choose, majority, t1, t2;
        if (i < 16u) {
            const uint8_t *p = block + i * 4u;
            wi = ((uint32_t)p[0] << 24) | ((uint32_t)p[1] << 16) |
                 ((uint32_t)p[2] << 8) | (uint32_t)p[3];
        } else {
            uint32_t x = w[(i + 1u) & 15u];
            uint32_t y = w[(i + 14u) & 15u];
            s0 = rotate_right(x, 7) ^ rotate_right(x, 18) ^ (x >> 3);
            s1 = rotate_right(y, 17) ^ rotate_right(y, 19) ^ (y >> 10);
            wi = w[i & 15u] + s0 + w[(i + 9u) & 15u] + s1;
        }
        w[i & 15u] = wi;
        s1 = rotate_right(e, 6) ^ rotate_right(e, 11) ^ rotate_right(e, 25);
        choose = (e & f) ^ ((~e) & g);
        t1 = h + s1 + choose + sha256_k[i] + wi;
        s0 = rotate_right(a, 2) ^ rotate_right(a, 13) ^ rotate_right(a, 22);
        majority = (a & b) ^ (a & c) ^ (b & c);
        t2 = s0 + majority;
        h = g; g = f; f = e; e = d + t1;
        d = c; c = b; b = a; a = t1 + t2;
    }
    state[0] += a; state[1] += b; state[2] += c; state[3] += d;
    state[4] += e; state[5] += f; state[6] += g; state[7] += h;
}

void framer_mqjs_resident_sha256_words(const uint8_t *bytes, size_t length,
                                        uint32_t state[8])
{
    uint8_t tail[128];
    size_t offset = 0;
    size_t remainder;
    size_t tail_bytes;
    unsigned int i;
    uint32_t bit_low;
    uint32_t bit_high;
    state[0] = 0x6a09e667u; state[1] = 0xbb67ae85u;
    state[2] = 0x3c6ef372u; state[3] = 0xa54ff53au;
    state[4] = 0x510e527fu; state[5] = 0x9b05688cu;
    state[6] = 0x1f83d9abu; state[7] = 0x5be0cd19u;
    if (length > 0x1fffffffu)
        return;
    while (length - offset >= 64u) {
        sha256_block(state, bytes + offset);
        offset += 64u;
    }
    remainder = length - offset;
    tail_bytes = remainder < 56u ? 64u : 128u;
    for (i = 0; i < tail_bytes; ++i)
        tail[i] = 0;
    for (i = 0; i < remainder; ++i)
        tail[i] = bytes[offset + i];
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
}

static int sha256_page_matches(const uint8_t *bytes, size_t length, int text_page)
{
    uint32_t state[8];
    if ((length & 63u) != 0u || length > 0x1fffffffu)
        return 0;
    framer_mqjs_resident_sha256_words(bytes, length, state);
    if (text_page) {
        return state[0] == FRAMER_MODULE_TEXT_SHA256_W0 &&
               state[1] == FRAMER_MODULE_TEXT_SHA256_W1 &&
               state[2] == FRAMER_MODULE_TEXT_SHA256_W2 &&
               state[3] == FRAMER_MODULE_TEXT_SHA256_W3 &&
               state[4] == FRAMER_MODULE_TEXT_SHA256_W4 &&
               state[5] == FRAMER_MODULE_TEXT_SHA256_W5 &&
               state[6] == FRAMER_MODULE_TEXT_SHA256_W6 &&
               state[7] == FRAMER_MODULE_TEXT_SHA256_W7;
    }
    return state[0] == FRAMER_MODULE_RODATA_SHA256_W0 &&
           state[1] == FRAMER_MODULE_RODATA_SHA256_W1 &&
           state[2] == FRAMER_MODULE_RODATA_SHA256_W2 &&
           state[3] == FRAMER_MODULE_RODATA_SHA256_W3 &&
           state[4] == FRAMER_MODULE_RODATA_SHA256_W4 &&
           state[5] == FRAMER_MODULE_RODATA_SHA256_W5 &&
           state[6] == FRAMER_MODULE_RODATA_SHA256_W6 &&
           state[7] == FRAMER_MODULE_RODATA_SHA256_W7;
}

static int verify_flash_page(uint32_t paddr, size_t length, int text_page,
                             void **cleanup)
{
    void *mapped = NULL;
    int result = esp_mmu_map(paddr, length, MMU_TARGET_FLASH0,
                             MMU_MEM_CAP_READ | MMU_MEM_CAP_8BIT,
                             0, &mapped);
    if (result != ESP_OK)
        return -10;
    if ((uintptr_t)mapped != MODULE_VERIFY_VADDR) {
        if (esp_mmu_unmap(mapped) != ESP_OK) {
            *cleanup = mapped;
            return -13;
        }
        return -11;
    }
    result = sha256_page_matches((const uint8_t *)mapped, length, text_page) ? 0 : -12;
    if (esp_mmu_unmap(mapped) != ESP_OK) {
        *cleanup = mapped;
        result = -13;
    }
    return result;
}

static int descriptor_is_bounded(const framer_mqjs_module_descriptor *descriptor)
{
    const uintptr_t text_start = MODULE_TEXT_VADDR;
    const uintptr_t text_end = MODULE_TEXT_VADDR + FRAMER_MODULE_TEXT_USED_BYTES;
    const uintptr_t functions[] = {
        descriptor->probe, descriptor->init, descriptor->load,
        descriptor->dispatch, descriptor->input_enqueue,
        descriptor->input_request_release_all,
        descriptor->input_request_focus_release, descriptor->input_drain,
        descriptor->input_get_observation, descriptor->get_telemetry,
        descriptor->get_last_good_slots, descriptor->destroy,
    };
    size_t i;
    if (descriptor->magic != MODULE_MAGIC ||
        descriptor->abi_version != MODULE_ABI_VERSION ||
        descriptor->descriptor_bytes != sizeof(*descriptor) ||
        descriptor->text_vaddr != MODULE_TEXT_VADDR ||
        descriptor->text_capacity != MODULE_TEXT_CAPACITY ||
        descriptor->rodata_vaddr != MODULE_RODATA_VADDR ||
        descriptor->rodata_capacity != MODULE_RODATA_CAPACITY ||
        descriptor->minimum_heap_bytes != FRAMER_MODULE_MIN_HEAP_BYTES ||
        descriptor->runtime_storage_bytes != FRAMER_MODULE_RUNTIME_STORAGE_BYTES ||
        descriptor->slot_count != 16u ||
        descriptor->abi_sha256[0] != FRAMER_MQJS_ABI_SHA256_W0 ||
        descriptor->abi_sha256[1] != FRAMER_MQJS_ABI_SHA256_W1 ||
        descriptor->abi_sha256[2] != FRAMER_MQJS_ABI_SHA256_W2 ||
        descriptor->abi_sha256[3] != FRAMER_MQJS_ABI_SHA256_W3 ||
        descriptor->abi_sha256[4] != FRAMER_MQJS_ABI_SHA256_W4 ||
        descriptor->abi_sha256[5] != FRAMER_MQJS_ABI_SHA256_W5 ||
        descriptor->abi_sha256[6] != FRAMER_MQJS_ABI_SHA256_W6 ||
        descriptor->abi_sha256[7] != FRAMER_MQJS_ABI_SHA256_W7)
        return 0;
    for (i = 0; i < sizeof(functions) / sizeof(functions[0]); ++i) {
        if (functions[i] < text_start || functions[i] >= text_end ||
            (functions[i] & 3u) != 0u)
            return 0;
    }
    return 1;
}

int framer_mqjs_map_canary(framer_mqjs_mapped_module *out)
{
    framer_mqjs_module_descriptor *descriptor;
    uint32_t (*probe)(void);
    void *text = NULL;
    void *rodata = NULL;
    int result;
    if (out == NULL)
        return -1;
    out->text = NULL;
    out->rodata = NULL;
    out->cleanup = NULL;
    out->descriptor = NULL;
    out->probe_result = 0;

    result = verify_flash_page(MODULE_TEXT_PADDR, MODULE_TEXT_CAPACITY, 1,
                               &out->cleanup);
    if (result != 0)
        return result;
    result = verify_flash_page(MODULE_RODATA_PADDR, MODULE_RODATA_CAPACITY, 0,
                               &out->cleanup);
    if (result != 0)
        return result;

    result = esp_mmu_map(MODULE_TEXT_PADDR, MODULE_TEXT_CAPACITY,
                         MMU_TARGET_FLASH0,
                         MMU_MEM_CAP_EXEC | MMU_MEM_CAP_32BIT, 0, &text);
    if (result != ESP_OK)
        return -20;
    if ((uintptr_t)text != MODULE_TEXT_VADDR) {
        out->cleanup = text;
        if (esp_mmu_unmap(text) == ESP_OK)
            out->cleanup = NULL;
        return out->cleanup == NULL ? -21 : -41;
    }
    result = esp_mmu_map(MODULE_RODATA_PADDR, MODULE_RODATA_CAPACITY,
                         MMU_TARGET_FLASH0,
                         MMU_MEM_CAP_READ | MMU_MEM_CAP_8BIT,
                         0, &rodata);
    if (result != ESP_OK || (uintptr_t)rodata != MODULE_RODATA_VADDR) {
        int map_failed = result != ESP_OK;
        out->text = text;
        if (result == ESP_OK)
            out->rodata = rodata;
        result = framer_mqjs_unmap_canary(out);
        return result == 0 ? (map_failed ? -22 : -23) : -42;
    }

    out->text = text;
    out->rodata = rodata;
    descriptor = (framer_mqjs_module_descriptor *)rodata;
    if (!descriptor_is_bounded(descriptor)) {
        result = framer_mqjs_unmap_canary(out);
        return result == 0 ? -24 : -43;
    }
    probe = (uint32_t (*)(void))descriptor->probe;
    if (probe() != MODULE_MAGIC) {
        result = framer_mqjs_unmap_canary(out);
        return result == 0 ? -25 : -44;
    }

    out->descriptor = descriptor;
    out->probe_result = MODULE_MAGIC;
    return 0;
}

int framer_mqjs_unmap_canary(framer_mqjs_mapped_module *module)
{
    int result = 0;
    if (module == NULL)
        return -1;
    /* Capability is unusable as soon as teardown starts. Keep only failed
     * raw mapping handles so the caller can report/retry cleanup. */
    module->descriptor = NULL;
    module->probe_result = 0;
    if (module->rodata != NULL && esp_mmu_unmap(module->rodata) != ESP_OK)
        result = -30;
    else
        module->rodata = NULL;
    if (module->text != NULL && esp_mmu_unmap(module->text) != ESP_OK)
        result = -31;
    else
        module->text = NULL;
    if (module->cleanup != NULL && esp_mmu_unmap(module->cleanup) != ESP_OK)
        result = -32;
    else
        module->cleanup = NULL;
    return result;
}
