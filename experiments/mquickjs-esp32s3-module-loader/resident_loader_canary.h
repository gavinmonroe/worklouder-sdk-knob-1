#ifndef FRAMER_MQJS_RESIDENT_LOADER_CANARY_H
#define FRAMER_MQJS_RESIDENT_LOADER_CANARY_H

#include <stdint.h>

typedef struct {
    void *text;
    void *rodata;
    void *cleanup;
    const void *descriptor;
    uint32_t probe_result;
} framer_mqjs_mapped_module;

/* Serialized one-shot startup only. The caller must preflight internal heap.
 * After any mapping/allocation error, disable the capability and reboot; do
 * not retry esp_mmu_map in the same boot against possibly unsafe stock-IDF
 * first-map list state. */
int framer_mqjs_map_canary(framer_mqjs_mapped_module *out);
int framer_mqjs_unmap_canary(framer_mqjs_mapped_module *module);

#endif
