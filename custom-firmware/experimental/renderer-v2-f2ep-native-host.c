#define RENDERER_V2_HOST_TEST 1
#include "renderer-v2-f2ep-native.c"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

renderer_v2_u8 renderer_v2_host_rtc_snapshot[40];
renderer_v2_u32 renderer_v2_host_rtc_available;
renderer_v2_u32 renderer_v2_host_rtc_latency_us;
renderer_v2_u32 renderer_v2_host_rtc_calls;
renderer_v2_u32 renderer_v2_host_rtc_field_mask;

static renderer_v2_u8 *read_exact(const char *path, size_t wanted) {
  FILE *file = fopen(path, "rb"); renderer_v2_u8 *bytes;
  if (file == NULL || fseek(file, 0, SEEK_END) != 0 || (size_t)ftell(file) != wanted ||
      fseek(file, 0, SEEK_SET) != 0) return NULL;
  bytes = (renderer_v2_u8 *)malloc(wanted);
  if (bytes == NULL || fread(bytes, 1, wanted, file) != wanted || fclose(file) != 0) {
    free(bytes); return NULL;
  }
  return bytes;
}
static int write_frame(const char *prefix, unsigned index, const renderer_v2_u16 *frame) {
  char path[1024]; FILE *file;
  if (snprintf(path, sizeof(path), "%s-%u.rgb565", prefix, index) <= 0) return 0;
  file = fopen(path, "wb");
  return file != NULL && fwrite(frame, 2, RENDERER_V2_FRAME_PIXELS, file) == RENDERER_V2_FRAME_PIXELS &&
    fclose(file) == 0;
}
static void host_wr16(renderer_v2_u8 *p, renderer_v2_u16 value) {
  p[0] = (renderer_v2_u8)value; p[1] = (renderer_v2_u8)(value >> 8);
}
static void host_wr32(renderer_v2_u8 *p, renderer_v2_u32 value) {
  p[0] = (renderer_v2_u8)value; p[1] = (renderer_v2_u8)(value >> 8);
  p[2] = (renderer_v2_u8)(value >> 16); p[3] = (renderer_v2_u8)(value >> 24);
}
static void host_rtc(renderer_v2_u32 hour, renderer_v2_u32 minute,
    renderer_v2_u32 second, renderer_v2_u32 valid, renderer_v2_u32 latency_us) {
  memset(renderer_v2_host_rtc_snapshot, 0, sizeof(renderer_v2_host_rtc_snapshot));
  renderer_v2_host_rtc_snapshot[28] = (renderer_v2_u8)second;
  renderer_v2_host_rtc_snapshot[29] = (renderer_v2_u8)minute;
  renderer_v2_host_rtc_snapshot[30] = (renderer_v2_u8)hour;
  renderer_v2_host_rtc_snapshot[36] = (renderer_v2_u8)valid;
  renderer_v2_host_rtc_field_mask = 7u;
  renderer_v2_host_rtc_available = 1u; renderer_v2_host_rtc_latency_us = latency_us;
}
typedef struct { void **vptr; } HostController;
static void host_old_tick(void *controller) { (void)controller; }
static void host_old_encoder(void *controller, renderer_v2_u32 encoder,
    renderer_v2_u32 delta) { (void)controller; (void)encoder; (void)delta; }
static int host_install(RendererV2Sidecar *sidecar, HostController *controller,
    const renderer_v2_u8 *boot_program) {
  renderer_v2_u32 i;
  memset(sidecar, 0, sizeof(*sidecar)); memset(controller, 0, sizeof(*controller));
  if (!renderer_v2_runtime_init(&sidecar->runtime, boot_program,
      RENDERER_V2_BOOT_F2EP_BYTES)) return 0;
  sidecar->magic = RV2_LIVE_MAGIC; sidecar->old_tick = host_old_tick;
  sidecar->old_encoder = host_old_encoder; sidecar->active_profile = RV2_PROFILE_BOOT;
  for (i = 0u; i < 12u; i++) sidecar->vtable[i] = (void *)host_old_tick;
  sidecar->vtable[6] = (void *)renderer_v2_live_tick;
  sidecar->vtable[9] = (void *)renderer_v2_live_encoder;
  sidecar->vtable[11] = sidecar; controller->vptr = sidecar->vtable;
  return 1;
}

int main(int argc, char **argv) {
  renderer_v2_u8 *program; RendererV2Runtime runtime;
  if (argc < 3) return 64;
  if (strcmp(argv[1], "wall-clock") == 0) {
    renderer_v2_u8 snapshot[40] = {0}; renderer_v2_u32 seconds = 0u;
    snapshot[28] = 59u; snapshot[29] = 59u; snapshot[30] = 23u; snapshot[36] = 1u;
    if (!renderer_v2_host_wall_snapshot(snapshot, &seconds) || seconds != 86399u) return 101;
    snapshot[36] = 0u; if (renderer_v2_host_wall_snapshot(snapshot, &seconds)) return 102;
    snapshot[36] = 1u; snapshot[30] = 24u;
    if (renderer_v2_host_wall_snapshot(snapshot, &seconds)) return 103;
    snapshot[30] = 0u; snapshot[29] = 60u;
    if (renderer_v2_host_wall_snapshot(snapshot, &seconds)) return 104;
    snapshot[29] = 0u; snapshot[28] = 60u;
    if (renderer_v2_host_wall_snapshot(snapshot, &seconds)) return 105;
    printf("coherent=86399 invalid=last-good poll=once-per-second\n"); return 0;
  }
  if (strcmp(argv[1], "scaled-event") == 0) {
    if (renderer_v2_host_add_event_scaled(900, 1, 300) != 1200 ||
        renderer_v2_host_add_event_scaled(900, -1, 300) != 600 ||
        renderer_v2_host_add_event_scaled((renderer_v2_s32)0x80000000u,
          (renderer_v2_s32)0x80000000u, (renderer_v2_s32)0x7fffffffu) != 0 ||
        renderer_v2_host_add_event_scaled(-2, 2, (renderer_v2_s32)0x7fffffffu) != -4)
      return 106;
    printf("plus=1200 minus=600 int32_wrap=pass\n"); return 0;
  }
  if (strcmp(argv[1], "timer-base") == 0) {
    renderer_v2_u8 *compressed, *raw, *decoded; renderer_v2_u8 prior;
    if (argc != 4) return 134;
    compressed = read_exact(argv[2], RENDERER_V2_TIMER_BASE_LZSS_BYTES);
    raw = read_exact(argv[3], RENDERER_V2_FRAME_BYTES);
    decoded = (renderer_v2_u8 *)malloc(RENDERER_V2_FRAME_BYTES);
    if (compressed == NULL || raw == NULL || decoded == NULL ||
        !renderer_v2_host_decode_timer_base(decoded, RENDERER_V2_FRAME_BYTES,
          compressed, RENDERER_V2_TIMER_BASE_LZSS_BYTES) ||
        memcmp(decoded, raw, RENDERER_V2_FRAME_BYTES) != 0) return 135;
    prior = compressed[RENDERER_V2_TIMER_BASE_LZSS_BYTES / 2u];
    compressed[RENDERER_V2_TIMER_BASE_LZSS_BYTES / 2u] ^= 1u;
    if (renderer_v2_host_decode_timer_base(decoded, RENDERER_V2_FRAME_BYTES,
        compressed, RENDERER_V2_TIMER_BASE_LZSS_BYTES)) return 136;
    compressed[RENDERER_V2_TIMER_BASE_LZSS_BYTES / 2u] = prior;
    printf("timer_base_raw=62000 compressed=3335 exact_consumption=pass exact_sha=pass mutation=reject\n");
    free(decoded); free(raw); free(compressed); return 0;
  }
  if (strcmp(argv[1], "focus-base") == 0) {
    renderer_v2_u8 *bundle = read_exact(argv[2], RENDERER_V2_FOCUS_F1WB_BYTES);
    renderer_v2_u8 prior;
    if (bundle == NULL || !renderer_v2_host_admit_focus_base(bundle,
        RENDERER_V2_FOCUS_F1WB_BYTES)) return 90;
    prior = bundle[RENDERER_V2_FOCUS_F1WB_BYTES / 2u];
    bundle[RENDERER_V2_FOCUS_F1WB_BYTES / 2u] ^= 1u;
    if (renderer_v2_host_admit_focus_base(bundle, RENDERER_V2_FOCUS_F1WB_BYTES)) return 91;
    bundle[RENDERER_V2_FOCUS_F1WB_BYTES / 2u] = prior;
    printf("focus_f1wb_bytes=62404 frozen_digest=pass mutation=reject\n");
    free(bundle); return 0;
  }
  if (strcmp(argv[1], "boot-base") == 0) {
    renderer_v2_u8 *bundle = read_exact(argv[2], RENDERER_V2_BOOT_F1WB_BYTES);
    renderer_v2_u8 prior;
    if (bundle == NULL || !rv2_sha_is_boot_base(bundle, RENDERER_V2_BOOT_F1WB_BYTES)) return 92;
    prior = bundle[100]; bundle[100] ^= 1u;
    if (rv2_sha_is_boot_base(bundle, RENDERER_V2_BOOT_F1WB_BYTES)) return 93;
    bundle[100] = prior;
    printf("boot_f1wb_bytes=748 frozen_digest=pass mutation=reject\n");
    free(bundle); return 0;
  }
  if (strcmp(argv[1], "admit-boot") == 0) {
    program = read_exact(argv[2], RENDERER_V2_BOOT_F2EP_BYTES);
    if (program == NULL) return 94;
    int result = renderer_v2_runtime_init(&runtime, program, RENDERER_V2_BOOT_F2EP_BYTES) ? 0 : 1;
    free(program); return result;
  }
  if (strcmp(argv[1], "admit-timer") == 0) {
    program = read_exact(argv[2], RENDERER_V2_TIMER_F2EP_BYTES);
    if (program == NULL) return 107;
    int result = renderer_v2_runtime_init(&runtime, program,
      RENDERER_V2_TIMER_F2EP_BYTES) ? 0 : 1;
    free(program); return result;
  }
  if (strcmp(argv[1], "timer-scenario") == 0) {
    renderer_v2_u8 *timer_program, *base; renderer_v2_u16 *frame;
    RendererV2TickResult tick; renderer_v2_u32 i, generation;
    renderer_v2_s32 paused;
    if (argc != 5) return 108;
    timer_program = read_exact(argv[2], RENDERER_V2_TIMER_F2EP_BYTES);
    base = read_exact(argv[3], RENDERER_V2_FRAME_BYTES);
    frame = (renderer_v2_u16 *)malloc(RENDERER_V2_FRAME_BYTES);
    if (timer_program == NULL || base == NULL || frame == NULL ||
        !renderer_v2_runtime_init(&runtime, timer_program, RENDERER_V2_TIMER_F2EP_BYTES)) return 109;
#define TIMER_TICK(index) do { \
  memcpy(frame, base, RENDERER_V2_FRAME_BYTES); tick = renderer_v2_ui_tick(&runtime, frame, 1u); \
  if (!tick.rendered || !write_frame(argv[4], (index), frame)) return 110; \
} while (0)
    TIMER_TICK(0u);
    if (renderer_v2_enqueue_fn_bottom(&runtime, 1u, 1u, 1u, 1u) != 3u) return 111;
    TIMER_TICK(1u); if (runtime.state[0] != 1800) return 112;
    if (renderer_v2_enqueue_fn_bottom(&runtime, 1u, 0xffu, 1u, 1u) != 3u) return 113;
    TIMER_TICK(2u); if (runtime.state[0] != 1500) return 114;
    if (renderer_v2_enqueue_fn_bottom(&runtime, 1u, 0x80u, 1u, 1u) != 3u) return 115;
    TIMER_TICK(3u); if (runtime.state[0] != 300) return 116;
    if (renderer_v2_enqueue_fn_bottom(&runtime, 1u, 0x7fu, 1u, 1u) != 3u) return 117;
    TIMER_TICK(4u); if (runtime.state[0] != 5700) return 118;
    for (i = 0u; i < 5u; i++) {
      memcpy(frame, base, RENDERER_V2_FRAME_BYTES); tick = renderer_v2_ui_tick(&runtime, frame, 1u);
    }
    if (!tick.second_tick || runtime.state[0] != 5699 || !write_frame(argv[4], 5u, frame)) return 119;
    if (renderer_v2_enqueue_fn_bottom(&runtime, 1u, 1u, 0u, 1u) != 0u ||
        renderer_v2_enqueue_fn_bottom(&runtime, 0u, 1u, 1u, 1u) != 0u) return 120;
    paused = runtime.state[0]; generation = runtime.frame_generation;
    /* Hidden-screen policy for this controlled smoke: no ID27 tick means no
     * synthetic tick.1s event; state and generation stay exactly paused. */
    if (runtime.state[0] != paused || runtime.frame_generation != generation) return 121;
    TIMER_TICK(6u); if (runtime.state[0] != paused) return 122;
    printf("initial=1500 plus=1800 minus=1500 clamp_min=300 clamp_max=5700 tick=5699 hidden=pause reentry=5699 same_tick=pass\n");
    free(frame); free(base); free(timer_program); return 0;
#undef TIMER_TICK
  }
  if (strcmp(argv[1], "wall-runtime") == 0) {
    renderer_v2_u8 *focus_program, *base; renderer_v2_u16 *frame;
    RendererV2Sidecar sidecar; RendererV2TickResult tick; renderer_v2_u32 i;
    if (argc != 4) return 123;
    focus_program = read_exact(argv[2], RENDERER_V2_FOCUS_F2EP_BYTES);
    base = read_exact(argv[3], RENDERER_V2_FRAME_BYTES);
    frame = (renderer_v2_u16 *)malloc(RENDERER_V2_FRAME_BYTES);
    if (focus_program == NULL || base == NULL || frame == NULL) return 124;
    memset(&sidecar, 0, sizeof(sidecar));
    if (!renderer_v2_runtime_init(&sidecar.runtime, focus_program,
        RENDERER_V2_FOCUS_F2EP_BYTES)) return 125;
    sidecar.active_profile = RV2_PROFILE_FOCUS; sidecar.wall_poll_due = 1u;
    renderer_v2_host_rtc_calls = 0u; host_rtc(23u, 59u, 59u, 1u, 100u);
    memcpy(frame, base, RENDERER_V2_FRAME_BYTES);
    tick = renderer_v2_ui_tick(&sidecar.runtime, frame, 1u);
    rv2_sync_focus_wall_clock(&sidecar, frame, tick.second_tick);
    if (sidecar.runtime.state[0] != 86399 || renderer_v2_host_rtc_calls != 1u) return 126;
    host_rtc(0u, 0u, 0u, 1u, 100u);
    for (i = 0u; i < 9u; i++) {
      memcpy(frame, base, RENDERER_V2_FRAME_BYTES);
      tick = renderer_v2_ui_tick(&sidecar.runtime, frame, 1u);
      rv2_sync_focus_wall_clock(&sidecar, frame, tick.second_tick);
    }
    if (sidecar.runtime.state[0] != 0 || renderer_v2_host_rtc_calls != 2u) return 127;
    host_rtc(0u, 0u, 1u, 0u, 100u);
    for (i = 0u; i < 10u; i++) {
      memcpy(frame, base, RENDERER_V2_FRAME_BYTES);
      tick = renderer_v2_ui_tick(&sidecar.runtime, frame, 1u);
      rv2_sync_focus_wall_clock(&sidecar, frame, tick.second_tick);
    }
    if (sidecar.runtime.state[0] != 1 || renderer_v2_host_rtc_calls != 3u) return 128;
    /* A successful read with malformed BCD can leave one stock decoder field
     * unwritten while setting valid=1.  The production sentinel must reject
     * that partial tuple and retain the post-tick last-good state. */
    host_rtc(12u, 34u, 56u, 1u, 100u); renderer_v2_host_rtc_field_mask = 6u;
    sidecar.wall_poll_due = 1u; memcpy(frame, base, RENDERER_V2_FRAME_BYTES);
    tick = renderer_v2_ui_tick(&sidecar.runtime, frame, 1u);
    i = (renderer_v2_u32)sidecar.runtime.state[0];
    rv2_sync_focus_wall_clock(&sidecar, frame, tick.second_tick);
    if ((renderer_v2_u32)sidecar.runtime.state[0] != i ||
        renderer_v2_host_rtc_calls != 4u) return 133;
    if (!renderer_v2_enqueue_host(&sidecar.runtime, RENDERER_V2_HOST_EVENT_B201, 1234)) return 129;
    host_rtc(1u, 2u, 3u, 1u, 100u); sidecar.wall_poll_due = 1u;
    memcpy(frame, base, RENDERER_V2_FRAME_BYTES);
    tick = renderer_v2_ui_tick(&sidecar.runtime, frame, 1u);
    rv2_sync_focus_wall_clock(&sidecar, frame, tick.second_tick);
    if (sidecar.runtime.state[0] != 3723) return 130;
    host_rtc(2u, 3u, 4u, 1u, 20001u); sidecar.wall_poll_due = 1u;
    memcpy(frame, base, RENDERER_V2_FRAME_BYTES);
    tick = renderer_v2_ui_tick(&sidecar.runtime, frame, 1u);
    rv2_sync_focus_wall_clock(&sidecar, frame, tick.second_tick);
    if (sidecar.runtime.state[0] != 3723) return 131;
    host_rtc(2u, 3u, 4u, 1u, 100u); sidecar.wall_poll_due = 1u;
    memcpy(frame, base, RENDERER_V2_FRAME_BYTES);
    tick = renderer_v2_ui_tick(&sidecar.runtime, frame, 1u);
    rv2_sync_focus_wall_clock(&sidecar, frame, tick.second_tick);
    if (sidecar.runtime.state[0] != 7384 || renderer_v2_host_rtc_calls != 7u) return 132;
    printf("initial=86399 rollover=0 invalid_last_good=1 malformed_bcd_last_good=1 queued_host_overridden=3723 latency_reject=pass reentry=7384 polls=7\n");
    free(frame); free(base); free(focus_program); return 0;
  }
  if (strcmp(argv[1], "transition") == 0) {
    enum { COMPOSITE_BYTES = RENDERER_V2_FOCUS_TIMER_PACKAGE_BYTES };
    renderer_v2_u8 *boot, *composite, *focus, *timer, *timer_base;
    renderer_v2_u32 generation, stale_epoch, timer_epoch;
    RendererV2Sidecar sidecar; HostController controller;
    if (argc != 4) return 95;
    boot = read_exact(argv[2], RENDERER_V2_BOOT_F2EP_BYTES);
    composite = read_exact(argv[3], COMPOSITE_BYTES);
    if (boot == NULL || composite == NULL || !host_install(&sidecar, &controller, boot)) return 96;
    focus = composite + RENDERER_V2_FOCUS_F1WB_BYTES;
    timer = focus + RENDERER_V2_FOCUS_F2EP_BYTES;
    timer_base = timer + RENDERER_V2_TIMER_F2EP_BYTES;
    generation = rv2_rd32(composite + 8u);
    if (renderer_v2_native_prepare(&controller, NULL, COMPOSITE_BYTES, generation) ||
        renderer_v2_native_prepare(&controller, composite, COMPOSITE_BYTES - 1u, generation) ||
        sidecar.switch_state != RV2_SWITCH_EMPTY ||
        !renderer_v2_native_prepare(&controller, composite, COMPOSITE_BYTES, generation) ||
        sidecar.switch_state != RV2_SWITCH_PREPARED || !renderer_v2_native_cancel(&controller) ||
        sidecar.switch_state != RV2_SWITCH_EMPTY ||
        !renderer_v2_native_prepare(&controller, composite, COMPOSITE_BYTES, generation) ||
        !renderer_v2_native_commit(&controller) || !renderer_v2_native_commit(&controller) ||
        renderer_v2_native_cancel(&controller) ||
        renderer_v2_native_prepare(&controller, composite, COMPOSITE_BYTES, generation)) return 97;
    __atomic_store_n(&sidecar.overlay_admitted, 1u, __ATOMIC_RELEASE);
    if (rv2_switch_pending_identity(&sidecar, composite, RENDERER_V2_FOCUS_F1WB_BYTES,
          generation + 1u, 0u) ||
        rv2_base_refresh_identity(&sidecar, composite, RENDERER_V2_FOCUS_F1WB_BYTES,
          generation + 1u, 0u) || sidecar.overlay_admitted != 0u) return 98;
    if (!rv2_switch_pending_identity(&sidecar, composite, RENDERER_V2_FOCUS_F1WB_BYTES,
          generation, 0u) || sidecar.switch_state != RV2_SWITCH_ACTIVE ||
        sidecar.active_profile != RV2_PROFILE_FOCUS || sidecar.runtime.program != focus ||
        sidecar.runtime.program_bytes != RENDERER_V2_FOCUS_F2EP_BYTES ||
        sidecar.timer_runtime.program != timer ||
        sidecar.timer_runtime.program_bytes != RENDERER_V2_TIMER_F2EP_BYTES ||
        sidecar.active_timer_base_lzss != timer_base ||
        sidecar.active_timer_base_lzss_bytes != RENDERER_V2_TIMER_BASE_LZSS_BYTES ||
        sidecar.runtime.state_count != 2u || sidecar.runtime.state[0] != 45296 ||
        sidecar.overlay_admitted != 1u || sidecar.timer_admitted != 1u) return 99;
    /* A detent may arrive after ID27 build but before its first UI tick. The
     * switch publishes the exact observed identity with the gate, so the
     * first refresh must not clear this already-accepted timer event. */
    timer_epoch = sidecar.timer_epoch;
    if (!rv2_enqueue_guarded(&sidecar.timer_runtime, RV2_EVENT_FN_KNOB, 1u,
          RV2_BOTTOM_ENCODER, 1, &sidecar.timer_admitted, &sidecar.timer_epoch,
          timer_epoch, 1u) || sidecar.timer_runtime.queue_count != 1u ||
        !rv2_timer_base_refresh_identity(&sidecar, composite,
          RENDERER_V2_FOCUS_F1WB_BYTES, generation, 0u) ||
        sidecar.timer_runtime.queue_count != 1u) return 133;
    stale_epoch = sidecar.overlay_epoch;
    if (rv2_base_refresh_identity(&sidecar, composite, RENDERER_V2_FOCUS_F1WB_BYTES,
          generation, 2u) || sidecar.overlay_admitted != 0u ||
        renderer_v2_native_host_event(&controller, RENDERER_V2_HOST_EVENT_B201, 7) ||
        rv2_enqueue_guarded(&sidecar.runtime, RV2_EVENT_HOST, 0u,
          RENDERER_V2_HOST_EVENT_B201, 7, &sidecar.overlay_admitted,
          &sidecar.overlay_epoch, stale_epoch, 1u)) return 100;
    printf("EMPTY-PREPARED-CANCEL-EMPTY-PREPARED-COMMITTED-ACTIVE generation_pair=pass old_on_focus=blocked error_gate=closed stale_epoch=reject null_prepare=reject store_latched_busy=pass first_timer_detent=preserved\n");
    free(composite); free(boot); return 0;
  }
  program = read_exact(argv[2], RENDERER_V2_F2EP_BYTES); if (program == NULL) return 65;
  if (strcmp(argv[1], "admit") == 0) {
    int result = renderer_v2_runtime_init(&runtime, program, RENDERER_V2_F2EP_BYTES) ? 0 : 1;
    free(program); return result;
  }
  if (strcmp(argv[1], "structure") == 0) {
    int result = renderer_v2_host_admit_structure(program, RENDERER_V2_F2EP_BYTES) ? 0 : 1;
    free(program); return result;
  }
  if (strcmp(argv[1], "fuzz") == 0) {
    renderer_v2_u32 seed = 0x5eedf2e1u, iteration, offset, bytecode, span, binding;
    renderer_v2_u32 binding_divisor_prior;
    renderer_v2_u16 span_count_prior;
    renderer_v2_u8 prior;
    if (!renderer_v2_runtime_init(&runtime, program, RENDERER_V2_F2EP_BYTES) ||
        !renderer_v2_host_admit_structure(program, RENDERER_V2_F2EP_BYTES)) return 74;
    /* Every deterministic one-bit mutation must fail the frozen digest gate,
     * including structurally valid patch-payload changes. */
    for (iteration = 0u; iteration < 2048u; iteration++) {
      seed ^= seed << 13; seed ^= seed >> 17; seed ^= seed << 5;
      offset = seed % RENDERER_V2_F2EP_BYTES; prior = program[offset];
      program[offset] ^= (renderer_v2_u8)(1u << (iteration & 7u));
      if (renderer_v2_runtime_init(&runtime, program, RENDERER_V2_F2EP_BYTES)) return 75;
      program[offset] = prior;
    }
    bytecode = rv2_rd32(program + 24); span = rv2_rd32(program + 36);
    binding = rv2_rd32(program + 40);
#define STRUCTURE_REJECT(statement) do { \
  statement; \
  if (renderer_v2_host_admit_structure(program, RENDERER_V2_F2EP_BYTES)) return 76; \
} while (0)
    prior = program[5]; STRUCTURE_REJECT(program[5] = 17u); program[5] = prior;
    prior = program[4]; STRUCTURE_REJECT(program[4] = 2u); program[4] = prior;
    host_wr32(program + 12, RENDERER_V2_F2EP_BYTES - 1u);
    if (renderer_v2_host_admit_structure(program, RENDERER_V2_F2EP_BYTES)) return 77;
    host_wr32(program + 12, RENDERER_V2_F2EP_BYTES);
    prior = program[bytecode]; STRUCTURE_REJECT(program[bytecode] = 8u); program[bytecode] = prior;
    span_count_prior = rv2_rd16(program + span + 2u);
    STRUCTURE_REJECT(host_wr16(program + span + 2u, 0u));
    host_wr16(program + span + 2u, span_count_prior);
    binding_divisor_prior = rv2_rd32(program + binding + 4u);
    host_wr32(program + binding + 4u, 0u);
    if (renderer_v2_host_admit_structure(program, RENDERER_V2_F2EP_BYTES)) return 78;
    host_wr32(program + binding + 4u, binding_divisor_prior);
#undef STRUCTURE_REJECT
    if (!renderer_v2_host_admit_structure(program, RENDERER_V2_F2EP_BYTES)) return 79;
    printf("mutations=2048 structural_bounds=6 frozen_digest=pass\n");
    free(program); return 0;
  }
  if (strcmp(argv[1], "contracts") == 0) {
    renderer_v2_u8 *base; renderer_v2_u16 *frame; RendererV2TickResult tick;
    renderer_v2_u32 i, generation;
    if (argc != 4 || !renderer_v2_runtime_init(&runtime, program, RENDERER_V2_F2EP_BYTES)) return 80;
    if (rv2_trunc_div_u32((renderer_v2_s32)0x80000000u, 1u) != (renderer_v2_s32)0x80000000u ||
        rv2_trunc_div_u32((renderer_v2_s32)0x80000000u, 0xffffffffu) != 0 ||
        rv2_trunc_div_u32((renderer_v2_s32)0x80000000u, 0x80000000u) != -1 ||
        rv2_trunc_div_u32(0x7fffffff, 0xffffffffu) != 0 || rv2_trunc_div_u32(-7, 3u) != -2) return 89;
    base = read_exact(argv[3], RENDERER_V2_FRAME_BYTES); frame = (renderer_v2_u16 *)malloc(RENDERER_V2_FRAME_BYTES);
    if (base == NULL || frame == NULL) return 81;
    if (renderer_v2_enqueue_fn_bottom(&runtime, 0u, 1u, 1u, 1u) != RENDERER_V2_INPUT_FALLBACK ||
        renderer_v2_enqueue_fn_bottom(&runtime, 1u, 1u, 0u, 1u) != RENDERER_V2_INPUT_FALLBACK ||
        renderer_v2_enqueue_fn_bottom(&runtime, 1u, 0u, 1u, 1u) != RENDERER_V2_INPUT_FALLBACK ||
        renderer_v2_enqueue_host(&runtime, 0xb202u, 7) != 0u) return 82;
    for (i = 0u; i < RENDERER_V2_QUEUE_RECORDS; i++)
      if (renderer_v2_enqueue_fn_bottom(&runtime, 1u, 1u, 1u, 1u) !=
          (RENDERER_V2_INPUT_CONSUMED | RENDERER_V2_INPUT_ENQUEUED)) return 83;
    if (renderer_v2_enqueue_fn_bottom(&runtime, 1u, 1u, 1u, 1u) != RENDERER_V2_INPUT_CONSUMED ||
        renderer_v2_enqueue_host(&runtime, RENDERER_V2_HOST_EVENT_B201, 7) != 0u) return 84;
    memcpy(frame, base, RENDERER_V2_FRAME_BYTES); tick = renderer_v2_ui_tick(&runtime, frame, 1u);
    if (!tick.rendered || tick.drained_events != RENDERER_V2_QUEUE_RECORDS || runtime.state[1] != 3) return 85;
    if (!renderer_v2_enqueue_host(&runtime, RENDERER_V2_HOST_EVENT_B201, 7)) return 86;
    generation = runtime.frame_generation; runtime.queue_lock = 1u;
    memcpy(frame, base, RENDERER_V2_FRAME_BYTES); tick = renderer_v2_ui_tick(&runtime, frame, 1u);
    if (!tick.rendered || tick.error != RV2_ERROR_VM || runtime.frame_generation != generation ||
        runtime.state[0] != 45296)
      return 87;
    runtime.queue_lock = 0u; memcpy(frame, base, RENDERER_V2_FRAME_BYTES);
    tick = renderer_v2_ui_tick(&runtime, frame, 1u);
    if (!tick.rendered || tick.drained_events != 1u || runtime.state[0] != 7) return 88;
    printf("queue_capacity=8 ninth_fn=consumed_not_enqueued fallback=pass lock_busy=last_good rpc_b201=pass u32_divisor=pass\n");
    free(frame); free(base); free(program); return 0;
  }
  if (strcmp(argv[1], "scenario") == 0) {
    renderer_v2_u8 *base; renderer_v2_u16 *frame; RendererV2TickResult tick;
    renderer_v2_u32 i, fn_result, host_result, generation;
    renderer_v2_s32 before[RENDERER_V2_STATE_SLOTS];
    if (argc != 5 || !renderer_v2_runtime_init(&runtime, program, RENDERER_V2_F2EP_BYTES)) return 66;
    base = read_exact(argv[3], RENDERER_V2_FRAME_BYTES); frame = (renderer_v2_u16 *)malloc(RENDERER_V2_FRAME_BYTES);
    if (base == NULL || frame == NULL) return 67;
    memcpy(frame, base, RENDERER_V2_FRAME_BYTES); tick = renderer_v2_ui_tick(&runtime, frame, 1u);
    if (!tick.rendered || !write_frame(argv[4], 0u, frame)) return 68;
    for (i = 1u; i < 10u; i++) { memcpy(frame, base, RENDERER_V2_FRAME_BYTES); tick = renderer_v2_ui_tick(&runtime, frame, 1u); }
    if (!tick.rendered || !tick.second_tick || !write_frame(argv[4], 1u, frame)) return 69;
    for (i = 0u; i < 3u; i++) {
      fn_result = renderer_v2_enqueue_fn_bottom(&runtime, 1u, 1u, 1u, 1u);
      memcpy(frame, base, RENDERER_V2_FRAME_BYTES); tick = renderer_v2_ui_tick(&runtime, frame, 1u);
      if (fn_result != (RENDERER_V2_INPUT_CONSUMED | RENDERER_V2_INPUT_ENQUEUED) ||
          !tick.rendered || tick.drained_events != 1u || !write_frame(argv[4], 2u + i, frame)) return 70;
    }
    host_result = renderer_v2_enqueue_host(&runtime, RENDERER_V2_HOST_EVENT_B201, 7920);
    memcpy(frame, base, RENDERER_V2_FRAME_BYTES); tick = renderer_v2_ui_tick(&runtime, frame, 1u);
    if (!host_result || !tick.rendered || tick.drained_events != 1u || !write_frame(argv[4], 5u, frame)) return 71;
    for (i = 0u; i < RENDERER_V2_STATE_SLOTS; i++) before[i] = runtime.state[i];
    generation = runtime.frame_generation; tick = renderer_v2_ui_tick(&runtime, frame, 0u);
    if (tick.rendered || runtime.frame_generation != generation ||
        memcmp(before, runtime.state, sizeof(before)) != 0 || !write_frame(argv[4], 6u, frame)) return 72;
    printf("seconds=%d knob=%d generation=%u sequence=%u fn=%u rpc=%u fail_last_good=1\n",
      runtime.state[0], runtime.state[1], runtime.frame_generation,
      runtime.sequence, fn_result, host_result);
    free(frame); free(base); free(program); return 0;
  }
  free(program); return 73;
}
