/* Host-only: admit a widget's F2TF exactly as the module's boot path does -
 * decoded base as canvas, the CONTAINER's generation, the container's f2js
 * sha - and prove the generation cross-pin both ways.  This is the gate that
 * would have caught the boot_state=6 halt offline: the module originally
 * passed its own constant generation instead of the widget's.
 *
 *   tf_boot_check <container.f2up> <decoded-base.bin> <v2-contract-sha-hex>
 * Prints one JSON line; exit 0 only when the right generation admits and the
 * wrong one refuses. */
#include "f2up_admission.h"
#include "../mquickjs-target-facade/target_facade.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static uint8_t *load(const char *path, uint32_t *bytes_out)
{
    FILE *file = fopen(path, "rb");
    long size;
    uint8_t *buffer;
    if (file == NULL) { perror(path); exit(2); }
    fseek(file, 0, SEEK_END); size = ftell(file); fseek(file, 0, SEEK_SET);
    buffer = (uint8_t *)malloc((size_t)size);
    if (buffer == NULL || fread(buffer, 1u, (size_t)size, file) != (size_t)size)
        exit(2);
    fclose(file);
    *bytes_out = (uint32_t)size;
    return buffer;
}

static int hex_digest(const char *text, uint8_t digest[32])
{
    unsigned int i;
    if (strlen(text) != 64u)
        return 0;
    for (i = 0u; i < 32u; ++i) {
        unsigned int value;
        if (sscanf(text + i * 2u, "%2x", &value) != 1)
            return 0;
        digest[i] = (uint8_t)value;
    }
    return 1;
}

int main(int argc, char **argv)
{
    uint32_t container_bytes, base_bytes;
    uint8_t *container, *base;
    uint8_t contract[32];
    framer_f2up_admission admission;
    static framer_tf_context context;
    framer_tf_result right, wrong;
    if (argc != 4) { fprintf(stderr, "usage: container base sha\n"); return 2; }
    container = load(argv[1], &container_bytes);
    base = load(argv[2], &base_bytes);
    if (base_bytes != 62000u || !hex_digest(argv[3], contract)) return 2;
    if (framer_f2up_admit(container, container_bytes, &admission) !=
        FRAMER_F2UP_OK) {
        printf("{\"result\":\"container-rejected\"}\n");
        return 1;
    }
    memset(&context, 0, sizeof(context));
    right = framer_tf_admit(&context, container + admission.f2tf_offset,
                            admission.f2tf_bytes,
                            (const uint16_t *)(const void *)base, 31000u,
                            admission.generation, admission.f2js_sha256,
                            contract, (uintptr_t)1u);
    memset(&context, 0, sizeof(context));
    wrong = framer_tf_admit(&context, container + admission.f2tf_offset,
                            admission.f2tf_bytes,
                            (const uint16_t *)(const void *)base, 31000u,
                            admission.generation - 1u, admission.f2js_sha256,
                            contract, (uintptr_t)1u);
    /* RENDER leg: admission alone once passed an asset whose raster targets
     * could never fit the overlay budget - every on-device render failed and
     * the proxy never published a frame (a black screen).  A container is not
     * boot-ready until the facade also RENDERS it. */
    {
        static framer_tf_context render_context;
        static framer_tf_mailbox mailbox;
        static uint16_t framebuffer[31000];
        framer_tf_result rendered;
        memset(&render_context, 0, sizeof(render_context));
        memcpy(framebuffer, base, 62000u);
        if (framer_tf_admit(&render_context, container + admission.f2tf_offset,
                            admission.f2tf_bytes, framebuffer, 31000u,
                            admission.generation, admission.f2js_sha256,
                            contract, (uintptr_t)1u) != FRAMER_TF_OK) {
            printf("{\"result\":\"render-admit-failed\"}\n");
            return 1;
        }
        memset(&mailbox, 0, sizeof(mailbox));
        mailbox.sequence = 2u;
        mailbox.admitted_generation = admission.generation;
        mailbox.slots[0] = 1;
        memcpy(framebuffer, base, 62000u);
        rendered = framer_tf_render(&render_context, &mailbox, framebuffer,
                                    31000u, (uintptr_t)1u, (framer_tf_metrics *)0);
        if (rendered != FRAMER_TF_OK && rendered != FRAMER_TF_HIDDEN) {
            printf("{\"result\":\"render-failed\",\"code\":%d}\n",
                   (int)rendered);
            return 1;
        }
    }
    printf("{\"result\":\"%s\",\"generation\":%u,\"rightAdmit\":%d,"
           "\"wrongGenerationRefused\":%s}\n",
           (right == FRAMER_TF_OK && wrong != FRAMER_TF_OK) ? "ok" : "fail",
           admission.generation, (int)right,
           wrong != FRAMER_TF_OK ? "true" : "false");
    return (right == FRAMER_TF_OK && wrong != FRAMER_TF_OK) ? 0 : 1;
}
