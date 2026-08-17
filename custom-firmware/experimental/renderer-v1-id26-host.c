#define RENDERER_V1_HOST_TEST 1
#include "renderer-v1-id26.c"

#include <stdio.h>
#include <stdlib.h>

int main(int argc, char **argv) {
  if (argc != 5) return 64;
  FILE *input = fopen(argv[1], "rb");
  if (input == NULL || fseek(input, 0, SEEK_END) != 0) return 65;
  long size = ftell(input);
  if (size < 0 || size > (long)F1WB_MAX || fseek(input, 0, SEEK_SET) != 0) return 65;
  u8 *bundle = (u8 *)malloc((size_t)size), *frame = (u8 *)malloc(FRAME_BYTES);
  if (bundle == NULL || frame == NULL || fread(bundle, 1, (size_t)size, input) != (size_t)size) return 66;
  fclose(input);
  u32 slot = (u32)strtoul(argv[2], NULL, 0), tick = (u32)strtoul(argv[3], NULL, 0);
  if (!renderer_v1_host_render(bundle, (u32)size, slot, tick, frame)) return 67;
  FILE *output = fopen(argv[4], "wb");
  if (output == NULL || fwrite(frame, 1, FRAME_BYTES, output) != FRAME_BYTES || fclose(output) != 0) return 68;
  free(frame); free(bundle); return 0;
}
