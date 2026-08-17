#ifndef FRAMER_RENDERER_V2_F2EP_GENERIC_H
#define FRAMER_RENDERER_V2_F2EP_GENERIC_H

typedef unsigned char renderer_v2_u8;
typedef unsigned short renderer_v2_u16;
typedef unsigned int renderer_v2_u32;
typedef signed int renderer_v2_s32;

#define RENDERER_V2_GENERIC_PROFILE_ID "framer-f1-render-v2-structural-v1"
#define RENDERER_V2_GENERIC_PACKAGE_FORMAT "framer-render-v2-package-v1"
#define RENDERER_V2_GENERIC_F1WB_BYTES 62404u
#define RENDERER_V2_GENERIC_MAX_F1WB_BYTES 98304u
#define RENDERER_V2_GENERIC_FRAME_PIXELS 31000u
#define RENDERER_V2_GENERIC_FRAME_BYTES 62000u
#define RENDERER_V2_GENERIC_MAX_F2EP_BYTES 29824u
#define RENDERER_V2_GENERIC_MAX_PACKAGE_BYTES \
  (RENDERER_V2_GENERIC_F1WB_BYTES + RENDERER_V2_GENERIC_MAX_F2EP_BYTES)
#define RENDERER_V2_GENERIC_MAX_TRANSPORT_BYTES 98304u
#define RENDERER_V2_GENERIC_QUEUE_RECORDS 8u
#define RENDERER_V2_GENERIC_STATE_SLOTS 16u

#define RENDERER_V2_INPUT_FALLBACK 0u
#define RENDERER_V2_INPUT_CONSUMED 1u
#define RENDERER_V2_INPUT_ENQUEUED 2u

#define RENDERER_V2_UPDATE_REJECTED 0u
#define RENDERER_V2_UPDATE_READY 1u
#define RENDERER_V2_UPDATE_BUSY 2u

typedef struct {
  renderer_v2_u8 kind;
  renderer_v2_u8 flags;
  renderer_v2_u16 id;
  renderer_v2_s32 value;
  renderer_v2_u32 sequence;
  renderer_v2_u32 reserved;
} RendererV2GenericEvent;

typedef struct {
  const renderer_v2_u8 *program;
  renderer_v2_u32 program_bytes;
  renderer_v2_u32 section[8];
  renderer_v2_u32 bytecode_bytes;
  renderer_v2_u32 span_count;
  renderer_v2_u32 patch_bytes;
  renderer_v2_u8 state_count;
  renderer_v2_u8 handler_count;
  renderer_v2_u8 patch_set_count;
  renderer_v2_u8 subsecond;
  renderer_v2_u16 binding_count;
  renderer_v2_u16 variant_count;
  renderer_v2_s32 state[RENDERER_V2_GENERIC_STATE_SLOTS];
  RendererV2GenericEvent queue[RENDERER_V2_GENERIC_QUEUE_RECORDS];
  volatile renderer_v2_u32 queue_lock;
  renderer_v2_u8 queue_head;
  renderer_v2_u8 queue_tail;
  renderer_v2_u8 queue_count;
  renderer_v2_u8 descriptor_identity;
  renderer_v2_u32 sequence;
  renderer_v2_u32 tick_count;
  renderer_v2_u32 frame_generation;
  renderer_v2_u32 rejected_events;
  renderer_v2_u32 error;
} RendererV2GenericRuntime;

typedef struct {
  renderer_v2_u32 rendered;
  renderer_v2_u32 second_tick;
  renderer_v2_u32 drained_events;
  renderer_v2_u32 state_changed;
  renderer_v2_u32 frame_generation;
  renderer_v2_u32 descriptor_identity;
  renderer_v2_u32 error;
} RendererV2GenericTickResult;

renderer_v2_u32 renderer_v2_generic_runtime_init(RendererV2GenericRuntime *runtime,
  const renderer_v2_u8 *program, renderer_v2_u32 program_bytes);
renderer_v2_u32 renderer_v2_generic_enqueue_fn_bottom(RendererV2GenericRuntime *runtime,
  renderer_v2_u32 encoder_id, renderer_v2_u32 raw_delta,
  renderer_v2_u32 fn_pressed, renderer_v2_u32 input_available);
renderer_v2_u32 renderer_v2_generic_enqueue_host(RendererV2GenericRuntime *runtime,
  renderer_v2_u16 event_id, renderer_v2_s32 value);
RendererV2GenericTickResult renderer_v2_generic_ui_tick(RendererV2GenericRuntime *runtime,
  renderer_v2_u16 *borrowed_framebuffer, renderer_v2_u32 base_ok);

void *renderer_v2_native_attach(void *setup_owner, void *registry,
  void *renderer_v1_controller, const renderer_v2_u8 *boot_program,
  renderer_v2_u32 boot_program_bytes);
renderer_v2_u32 renderer_v2_native_begin_upload(void *renderer_v1_controller);
renderer_v2_u32 renderer_v2_native_prepare(void *renderer_v1_controller,
  const renderer_v2_u8 *package, renderer_v2_u32 package_bytes,
  renderer_v2_u32 generation);
renderer_v2_u32 renderer_v2_native_stage(void *renderer_v1_controller);
renderer_v2_u32 renderer_v2_native_commit(void *renderer_v1_controller);
renderer_v2_u32 renderer_v2_native_cancel(void *renderer_v1_controller);
renderer_v2_u32 renderer_v2_native_abort_upload(void *renderer_v1_controller);
renderer_v2_u32 renderer_v2_native_host_event(void *renderer_v1_controller,
  renderer_v2_u16 event_id, renderer_v2_s32 value);

#ifdef RENDERER_V2_HOST_TEST
renderer_v2_u32 renderer_v2_generic_host_admit_structure(
  const renderer_v2_u8 *program, renderer_v2_u32 program_bytes);
#endif

#endif
