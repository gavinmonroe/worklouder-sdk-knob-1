/* Host-only CLI around framer_f2up_admit: read a container file, validate it,
 * print the result name and (on success) the parsed section table as one JSON
 * line. Used by the cross-language test in the Widget Designer to prove the TS
 * encoder and this C admitter agree byte-for-byte. Not built into firmware. */
#include "f2up_admission.h"
#include <stdio.h>
#include <stdlib.h>

int main(int argc, char **argv)
{
    FILE *file;
    long size;
    uint8_t *buffer;
    framer_f2up_admission admission;
    framer_f2up_result result;
    if (argc != 2) {
        fprintf(stderr, "usage: %s <container>\n", argv[0]);
        return 2;
    }
    file = fopen(argv[1], "rb");
    if (file == NULL) { fprintf(stderr, "open failed\n"); return 2; }
    fseek(file, 0, SEEK_END);
    size = ftell(file);
    fseek(file, 0, SEEK_SET);
    if (size < 0) { fclose(file); return 2; }
    buffer = (uint8_t *)malloc((size_t)size + 1u);
    if (buffer == NULL) { fclose(file); return 2; }
    if (fread(buffer, 1u, (size_t)size, file) != (size_t)size) {
        fclose(file); free(buffer); return 2;
    }
    fclose(file);

    result = framer_f2up_admit(buffer, (size_t)size, &admission);
    if (result != FRAMER_F2UP_OK) {
        printf("{\"result\":\"%s\"}\n", framer_f2up_result_name(result));
        free(buffer);
        return 0;
    }
    printf("{\"result\":\"ok\",\"generation\":%u,\"totalBytes\":%u,"
           "\"f2jsOffset\":%u,\"f2jsBytes\":%u,"
           "\"f2tfOffset\":%u,\"f2tfBytes\":%u,"
           "\"lzssOffset\":%u,\"lzssBytes\":%u}\n",
           admission.generation, admission.total_bytes,
           admission.f2js_offset, admission.f2js_bytes,
           admission.f2tf_offset, admission.f2tf_bytes,
           admission.lzss_offset, admission.lzss_bytes);
    free(buffer);
    return 0;
}
