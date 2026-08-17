#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define RENDERER_V2_HOST_TEST 1
#include "../experimental/renderer-v2-f2ep-generic.c"

extern int renderer_v1_host_validate(const unsigned char *, unsigned int);

static uint32_t read32h(const uint8_t *p) {
  return (uint32_t)p[0] | ((uint32_t)p[1] << 8) |
    ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}
static uint16_t read16h(const uint8_t *p) {
  return (uint16_t)((uint16_t)p[0] | ((uint16_t)p[1] << 8));
}
static void write16h(uint8_t *p, uint16_t value) {
  p[0] = (uint8_t)value; p[1] = (uint8_t)(value >> 8);
}

renderer_v2_u32 renderer_v1_validate_generic_bundle(
    const renderer_v2_u8 *bundle, renderer_v2_u32 bytes,
    renderer_v2_u32 generation) {
  return bundle != NULL && bytes >= 20u && bytes <= 98304u &&
    read32h(bundle + 8u) == generation && bundle[6] >= 1u &&
    bundle[6] <= 3u && bundle[7] < bundle[6] &&
    renderer_v1_host_validate(bundle, bytes) != 0;
}

renderer_v2_u32 renderer_v1_validate_generic_base(
    const renderer_v2_u8 *bundle, renderer_v2_u32 bytes,
    renderer_v2_u32 generation) {
  const uint8_t *descriptor, *raster, *record;
  if (!renderer_v1_validate_generic_bundle(bundle, bytes, generation) ||
      bytes != 62404u || bundle[6] != 1u || bundle[7] != 0u) return 0u;
  descriptor = bundle + 20u;
  if (descriptor[0] != 1u || descriptor[1] != 2u || descriptor[2] == 0u ||
      descriptor[2] > 16u || descriptor[3] != 0u ||
      read32h(descriptor + 4u) != 332u ||
      read32h(descriptor + 8u) != 62072u ||
      read32h(descriptor + 12u) != 0u ||
      read32h(descriptor + 16u) != 0u) return 0u;
  raster = bundle + 332u; record = raster + 64u;
  return memcmp(raster, "F1RA", 4u) == 0 && raster[4] == 1u &&
    raster[5] == 1u && read16h(raster + 6u) == 100u &&
    read16h(raster + 8u) == 310u && read16h(raster + 10u) == 1u &&
    read32h(raster + 24u) == 62072u && read32h(raster + 28u) == 62000u &&
    record[0] == 0u && record[1] == 0u && read16h(record + 2u) == 0u &&
    read32h(record + 4u) == 62000u;
}

static unsigned old_encoder_calls;

renderer_v2_u32 renderer_v1_prepare_store(void *opaque,
    const renderer_v2_u8 *store) {
  RendererV2GenericHostController *controller = opaque;
  if (controller == NULL || store == NULL || controller->pending_bundle != NULL)
    return 0u;
  if (store != controller->active_bundle)
    return controller->freeze_request == NULL;
  controller->freeze_request = store;
  return 0u;
}

renderer_v2_u32 renderer_v1_stage_bundle(void *opaque,
    const renderer_v2_u8 *bundle, renderer_v2_u32 bytes) {
  RendererV2GenericHostController *controller = opaque;
  uint32_t generation;
  if (controller == NULL || bundle == NULL || controller->pending_bundle != NULL ||
      bundle == controller->active_bundle || bytes < 20u) return 0u;
  generation = read32h(bundle + 8u);
  if (controller->active_bundle != NULL &&
      generation <= controller->active_generation) return 0u;
  controller->pending_length = bytes;
  controller->pending_generation = generation;
  controller->pending_bundle = bundle;
  return 1u;
}

static void host_old_tick(void *opaque) {
  RendererV2GenericHostController *controller = opaque;
  if (controller->freeze_request != NULL) {
    if (controller->active_bundle == controller->freeze_request) {
      controller->active_bundle = NULL;
      controller->active_length = 0u;
      controller->error = 0x80000000u;
    }
    controller->freeze_request = NULL;
    return;
  }
  if (controller->pending_bundle != NULL) {
    controller->active_bundle = controller->pending_bundle;
    controller->active_length = controller->pending_length;
    controller->active_generation = controller->pending_generation;
    controller->pending_bundle = NULL;
    controller->pending_length = 0u;
    controller->pending_generation = 0u;
    controller->error = 0u;
  }
}

static void host_old_encoder(void *opaque, renderer_v2_u32 encoder,
    renderer_v2_u32 delta) {
  (void)opaque; (void)encoder; (void)delta; old_encoder_calls++;
}

typedef struct {
  RendererV2GenericHostController controller;
  RendererV2GenericSidecar sidecar;
  void *old_vtable[12];
} Fixture;

static int fixture_init(Fixture *fixture) {
  memset(fixture, 0, sizeof(*fixture));
  fixture->sidecar.owned_bundle = calloc(1u,
    RENDERER_V2_GENERIC_MAX_F1WB_BYTES);
  fixture->sidecar.owned_program = calloc(1u,
    RENDERER_V2_GENERIC_MAX_F2EP_BYTES);
  if (fixture->sidecar.owned_bundle == NULL ||
      fixture->sidecar.owned_program == NULL) return 0;
  fixture->old_vtable[6] = (void *)host_old_tick;
  fixture->old_vtable[9] = (void *)host_old_encoder;
  fixture->sidecar.old_tick = host_old_tick;
  fixture->sidecar.old_encoder = host_old_encoder;
  memcpy(fixture->sidecar.vtable, fixture->old_vtable,
    11u * sizeof(void *));
  fixture->sidecar.vtable[6] = (void *)renderer_v2_generic_live_tick;
  fixture->sidecar.vtable[9] = (void *)renderer_v2_generic_live_encoder;
  fixture->sidecar.vtable[11] = &fixture->sidecar;
  fixture->sidecar.magic = RV2_LIVE_MAGIC;
  fixture->controller.vptr = fixture->sidecar.vtable;
  return 1;
}

static void fixture_free(Fixture *fixture) {
  free(fixture->sidecar.owned_bundle);
  free(fixture->sidecar.owned_program);
}

static uint8_t *read_file(const char *path, uint32_t *bytes) {
  FILE *file = fopen(path, "rb");
  long length;
  uint8_t *value;
  if (file == NULL || fseek(file, 0, SEEK_END) != 0 ||
      (length = ftell(file)) <= 0 || length > 98304 ||
      fseek(file, 0, SEEK_SET) != 0) return NULL;
  value = malloc((size_t)length);
  if (value == NULL || fread(value, 1u, (size_t)length, file) !=
      (size_t)length) return NULL;
  fclose(file); *bytes = (uint32_t)length; return value;
}

static int push_ready(Fixture *fixture, const uint8_t *package,
    uint32_t bytes, uint32_t generation) {
  return renderer_v2_native_begin_upload(&fixture->controller) ==
      RENDERER_V2_UPDATE_READY &&
    renderer_v2_native_prepare(&fixture->controller, package, bytes,
      generation) != 0u &&
    renderer_v2_native_stage(&fixture->controller) != 0u &&
    renderer_v2_native_commit(&fixture->controller) != 0u;
}

static int detach_to_ready(Fixture *fixture) {
  if (renderer_v2_native_begin_upload(&fixture->controller) !=
      RENDERER_V2_UPDATE_BUSY) return 0;
  if (renderer_v2_native_host_event(&fixture->controller, 0xb201u, 1) != 0u)
    return 0;
  renderer_v2_generic_live_tick(&fixture->controller);
  return renderer_v2_native_begin_upload(&fixture->controller) ==
    RENDERER_V2_UPDATE_READY;
}

static int change_host_id(uint8_t *package, uint32_t package_bytes,
    uint16_t id) {
  uint32_t bundle_bytes = read32h(package + 12u);
  uint8_t *program;
  uint32_t handlers, offset, index;
  if (bundle_bytes >= package_bytes) return 0;
  program = package + bundle_bytes; handlers = program[6];
  offset = read32h(program + 20u);
  for (index = 0u; index < handlers; index++) {
    uint8_t *handler = program + offset + index * 12u;
    if (handler[0] == RV2_EVENT_HOST) {
      write16h(handler + 2u, id); return 1;
    }
  }
  return 0;
}

static int lifecycle(const char *p1path, const char *p2path,
    const char *p3path, const char *v1path) {
  Fixture f;
  uint32_t b1, b2, b3, bv1;
  uint8_t *p1 = read_file(p1path, &b1), *p2 = read_file(p2path, &b2);
  uint8_t *p3 = read_file(p3path, &b3), *v1 = read_file(v1path, &bv1);
  int ok = 0;
  if (p1 == NULL || p2 == NULL || p3 == NULL || v1 == NULL ||
      !fixture_init(&f) || !change_host_id(p2, b2, 0x1234u)) goto done;
  /* Initial V2, then the commit-ACK overwrite window. */
  if (!push_ready(&f, p1, b1, 1u) ||
      renderer_v2_native_begin_upload(&f.controller) !=
        RENDERER_V2_UPDATE_BUSY || f.sidecar.copy_started != 0u) goto done_fixture;
  renderer_v2_generic_live_tick(&f.controller);
  if (f.controller.active_generation != 1u || f.sidecar.admitted == 0u ||
      renderer_v2_native_host_event(&f.controller, 0xb201u, 7) == 0u)
    goto done_fixture;
  /* Hidden-screen model: no UI tick means no copy/readiness. */
  if (renderer_v2_native_begin_upload(&f.controller) !=
      RENDERER_V2_UPDATE_BUSY || f.sidecar.admitted != 0u ||
      f.sidecar.runtime.queue_count != 0u ||
      renderer_v2_native_begin_upload(&f.controller) !=
      RENDERER_V2_UPDATE_BUSY || f.sidecar.copy_started != 0u) goto done_fixture;
  renderer_v2_generic_live_tick(&f.controller);
  if (renderer_v2_native_begin_upload(&f.controller) !=
      RENDERER_V2_UPDATE_READY || !renderer_v2_native_prepare(&f.controller,
      p2, b2, 2u) || !renderer_v2_native_stage(&f.controller) ||
      !renderer_v2_native_commit(&f.controller)) goto done_fixture;
  renderer_v2_generic_live_tick(&f.controller);
  if (f.controller.active_generation != 2u ||
      renderer_v2_native_host_event(&f.controller, 0x1234u, 9) == 0u ||
      renderer_v2_native_host_event(&f.controller, 0xb201u, 9) != 0u)
    goto done_fixture;
  /* Abort before copy safely resumes generation 2. */
  if (renderer_v2_native_begin_upload(&f.controller) !=
      RENDERER_V2_UPDATE_BUSY) goto done_fixture;
  renderer_v2_generic_live_tick(&f.controller);
  if (renderer_v2_native_begin_upload(&f.controller) !=
      RENDERER_V2_UPDATE_READY || !renderer_v2_native_abort_upload(&f.controller))
    goto done_fixture;
  renderer_v2_generic_live_tick(&f.controller);
  if (f.controller.active_generation != 2u || f.sidecar.admitted == 0u)
    goto done_fixture;
  /* V2 -> standalone V1: V2 gate closes and encoder falls through. */
  if (!detach_to_ready(&f) || !renderer_v2_native_prepare(&f.controller,
      v1, bv1, 3u) || !renderer_v2_native_stage(&f.controller) ||
      !renderer_v2_native_commit(&f.controller)) goto done_fixture;
  renderer_v2_generic_live_tick(&f.controller);
  old_encoder_calls = 0u;
  renderer_v2_generic_live_encoder(&f.controller, 1u, 1u);
  if (f.controller.active_generation != 3u || f.sidecar.owned_is_v2 != 0u ||
      f.sidecar.admitted != 0u || old_encoder_calls != 1u) goto done_fixture;
  /* V1 -> V2 generation 4 (p3 input is generation 4). */
  if (!detach_to_ready(&f) || !renderer_v2_native_prepare(&f.controller,
      p3, b3, 4u) || !renderer_v2_native_stage(&f.controller) ||
      !renderer_v2_native_commit(&f.controller)) goto done_fixture;
  renderer_v2_generic_live_tick(&f.controller);
  if (f.controller.active_generation != 4u || f.sidecar.admitted == 0u ||
      f.sidecar.owned_is_v2 == 0u) goto done_fixture;
  /* Once copy starts, abort must never claim the overwritten prior program. */
  if (!detach_to_ready(&f) || !renderer_v2_native_prepare(&f.controller,
      p3, b3, 4u) || renderer_v2_native_abort_upload(&f.controller) != 0u ||
      f.controller.active_bundle != NULL || f.sidecar.owned_valid != 0u ||
      f.sidecar.admitted != 0u) goto done_fixture;
  ok = 1;
done_fixture:
  fixture_free(&f);
done:
  free(p1); free(p2); free(p3); free(v1);
  if (ok) puts("repeat=1 commit_window=busy hidden=busy host_id=4660 abort_before_copy=resume abort_after_copy=fail_closed v1_v2=pass");
  return ok ? 0 : 1;
}

static int tamper(const char *path) {
  Fixture f;
  uint32_t bytes, bundle_bytes;
  uint8_t *package = read_file(path, &bytes), *copy;
  int ok = 0;
  if (package == NULL || !fixture_init(&f)) goto done;
  bundle_bytes = read32h(package + 12u); copy = malloc(bytes);
  if (copy == NULL) goto done_fixture;
  memcpy(copy, package, bytes); copy[400u] ^= 1u;
  if (renderer_v2_native_begin_upload(&f.controller) !=
      RENDERER_V2_UPDATE_READY || renderer_v2_native_prepare(&f.controller,
      copy, bytes, 1u) != 0u || !renderer_v2_native_abort_upload(&f.controller))
    goto done_copy;
  memcpy(copy, package, bytes);
  if (!change_host_id(copy, bytes, 0u) ||
      renderer_v2_native_begin_upload(&f.controller) !=
      RENDERER_V2_UPDATE_READY || renderer_v2_native_prepare(&f.controller,
      copy, bytes, 1u) != 0u || !renderer_v2_native_abort_upload(&f.controller))
    goto done_copy;
  if (bundle_bytes != 62404u) goto done_copy;
  ok = 1;
done_copy:
  free(copy);
done_fixture:
  fixture_free(&f);
done:
  free(package);
  if (ok) puts("f1wb_tamper=reject host_id_zero=reject");
  return ok ? 0 : 1;
}

static int fuzz(const char *path) {
  uint32_t bytes, bundle_bytes, program_bytes, seed = 0x8128a31du;
  uint8_t *package = read_file(path, &bytes), *program, *copy;
  unsigned accepted = 0u, rejected = 0u, index;
  if (package == NULL) return 1;
  bundle_bytes = read32h(package + 12u);
  if (bundle_bytes >= bytes) return 1;
  program = package + bundle_bytes; program_bytes = bytes - bundle_bytes;
  copy = malloc(program_bytes); if (copy == NULL) return 1;
  for (index = 0u; index < 4096u; index++) {
    uint32_t at;
    memcpy(copy, program, program_bytes);
    seed = seed * 1664525u + 1013904223u;
    at = seed % program_bytes;
    copy[at] ^= (uint8_t)(1u << ((seed >> 24) & 7u));
    if (renderer_v2_generic_host_admit_structure(copy, program_bytes)) accepted++;
    else rejected++;
  }
  free(copy); free(package);
  if (rejected == 0u) return 1;
  printf("mutations=4096 accepted=%u rejected=%u no_crash=1\n", accepted, rejected);
  return 0;
}

int main(int argc, char **argv) {
  if (argc == 6 && strcmp(argv[1], "lifecycle") == 0)
    return lifecycle(argv[2], argv[3], argv[4], argv[5]);
  if (argc == 3 && strcmp(argv[1], "tamper") == 0) return tamper(argv[2]);
  if (argc == 3 && strcmp(argv[1], "fuzz") == 0) return fuzz(argv[2]);
  fprintf(stderr, "usage: %s lifecycle p1 p2 p3 v1 | tamper p1 | fuzz p1\n", argv[0]);
  return 2;
}
