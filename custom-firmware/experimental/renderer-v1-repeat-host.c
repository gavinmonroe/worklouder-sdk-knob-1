#define RENDERER_V1_HOST_TEST 1
#include "renderer-v1-id26.c"

#include <stdio.h>
#include <stdlib.h>

static u8 *load(const char *file, u32 *length) {
  FILE *stream = fopen(file, "rb"); long bytes; u8 *value;
  if (stream == NULL || fseek(stream, 0, SEEK_END) != 0 || (bytes = ftell(stream)) <= 0 ||
      fseek(stream, 0, SEEK_SET) != 0) return NULL;
  value = (u8 *)malloc((size_t)bytes);
  if (value == NULL || fread(value, 1, (size_t)bytes, stream) != (size_t)bytes) return NULL;
  fclose(stream); *length = (u32)bytes; return value;
}

int main(int argc, char **argv) {
  Renderer renderer; u32 first_length, second_length, third_length;
  u8 *first, *second, *third; s32 active_busy, active_ready, inactive_busy, inactive_ready;
  if (argc != 4) return 64;
  first = load(argv[1], &first_length); second = load(argv[2], &second_length);
  third = load(argv[3], &third_length);
  if (first == NULL || second == NULL || third == NULL) return 65;
  zero_bytes(&renderer, (u32)sizeof(renderer));

  if (!renderer_v1_stage_bundle(&renderer, first, first_length)) return 66;
  renderer_v1_tick(&renderer);
  if (renderer.active_bundle != first) return 67;

  /* A distinct staging store never needs to freeze the active default. */
  if (!renderer_v1_prepare_store(&renderer, second) ||
      !renderer_v1_stage_bundle(&renderer, second, second_length)) return 68;
  renderer_v1_tick(&renderer);
  if (renderer.active_bundle != second) return 69;

  /* On-screen same-store overwrite requests a tick handoff, then retries. */
  renderer.common_04 = 1u;
  active_busy = renderer_v1_prepare_store(&renderer, second);
  if (active_busy != 0 || renderer.freeze_request != second) return 70;
  renderer_v1_tick(&renderer);
  if (renderer.active_bundle != NULL || renderer.freeze_request != NULL ||
      renderer.error != RENDERER_ERROR_FROZEN) return 71;
  active_ready = renderer_v1_prepare_store(&renderer, second);
  if (active_ready != 1) return 72;

  /* Re-stage and prove off-screen replacement uses the same timer handshake:
   * the stock common timer still dispatches slot6 while common_04 is zero. */
  if (!renderer_v1_stage_bundle(&renderer, third, third_length)) return 73;
  renderer_v1_tick(&renderer);
  renderer.common_04 = 0u;
  inactive_busy = renderer_v1_prepare_store(&renderer, third);
  if (inactive_busy != 0 || renderer.freeze_request != third) return 74;
  renderer_v1_tick(&renderer);
  if (renderer.active_bundle != NULL || renderer.freeze_request != NULL ||
      renderer.error != RENDERER_ERROR_FROZEN) return 75;
  inactive_ready = renderer_v1_prepare_store(&renderer, third);
  if (inactive_ready != 1) return 76;

  printf("distinct=1 active_busy=%d active_ready=%d inactive_busy=%d inactive_ready=%d frozen=1\n",
    active_busy, active_ready, inactive_busy, inactive_ready);
  free(third); free(second); free(first); return 0;
}
