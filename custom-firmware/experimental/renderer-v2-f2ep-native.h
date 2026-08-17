#ifndef FRAMER_RENDERER_V2_F2EP_NATIVE_H
#define FRAMER_RENDERER_V2_F2EP_NATIVE_H

/* Frozen renderer-v2 event-program ABI.  The implementation is freestanding:
 * no libc, heap, LVGL, FreeRTOS, or JavaScript engine is required by the VM. */
typedef unsigned char renderer_v2_u8;
typedef unsigned short renderer_v2_u16;
typedef unsigned int renderer_v2_u32;
typedef signed int renderer_v2_s32;

#define RENDERER_V2_BOOT_F2EP_BYTES 9536u
#define RENDERER_V2_FOCUS_F2EP_BYTES 15178u
#define RENDERER_V2_TIMER_F2EP_BYTES 14618u
#define RENDERER_V2_TIMER_BASE_LZSS_BYTES 3335u
/* Focused host/fuzz harness compatibility name. Runtime admission accepts both
 * the boot and focus constants above, each under its own exact SHA-256. */
#define RENDERER_V2_F2EP_BYTES RENDERER_V2_FOCUS_F2EP_BYTES
#define RENDERER_V2_BOOT_F1WB_BYTES 748u
#define RENDERER_V2_FOCUS_F1WB_BYTES 62404u
#define RENDERER_V2_FOCUS_TIMER_PACKAGE_BYTES \
  (RENDERER_V2_FOCUS_F1WB_BYTES + RENDERER_V2_FOCUS_F2EP_BYTES + \
   RENDERER_V2_TIMER_F2EP_BYTES + RENDERER_V2_TIMER_BASE_LZSS_BYTES)
#define RENDERER_V2_FRAME_PIXELS 31000u
#define RENDERER_V2_FRAME_BYTES 62000u
#define RENDERER_V2_QUEUE_RECORDS 8u
#define RENDERER_V2_STATE_SLOTS 16u
#define RENDERER_V2_HOST_EVENT_B201 0xb201u

#define RENDERER_V2_INPUT_FALLBACK 0u
#define RENDERER_V2_INPUT_CONSUMED 1u
#define RENDERER_V2_INPUT_ENQUEUED 2u

typedef struct {
  renderer_v2_u8 kind;
  renderer_v2_u8 flags;
  renderer_v2_u16 id;
  renderer_v2_s32 value;
  renderer_v2_u32 sequence;
  renderer_v2_u32 reserved;
} RendererV2EventRecord;

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
  renderer_v2_s32 state[RENDERER_V2_STATE_SLOTS];
  RendererV2EventRecord queue[RENDERER_V2_QUEUE_RECORDS];
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
} RendererV2Runtime;

typedef struct {
  renderer_v2_u32 rendered;
  renderer_v2_u32 second_tick;
  renderer_v2_u32 drained_events;
  renderer_v2_u32 state_changed;
  renderer_v2_u32 frame_generation;
  renderer_v2_u32 descriptor_identity;
  renderer_v2_u32 error;
} RendererV2TickResult;

/* Admission validates the complete nested ABI, then verifies either the frozen
 * bootstrap SHA-256 af34f7f9...60469b08, frozen focus-clock SHA-256
 * b2eadd58...3705aed, or frozen timer SHA-256 80e7ca2e...cad8979.
 * Program bytes remain immutable for runtime lifetime. */
renderer_v2_u32 renderer_v2_runtime_init(RendererV2Runtime *runtime,
  const renderer_v2_u8 *program, renderer_v2_u32 program_bytes);

/* Producer APIs are bounded and nonblocking.  A recognized Fn input is still
 * CONSUMED if the queue is momentarily busy/full, preventing an accidental v1
 * saved-slot switch. */
renderer_v2_u32 renderer_v2_enqueue_fn_bottom(RendererV2Runtime *runtime,
  renderer_v2_u32 encoder_id, renderer_v2_u32 raw_delta,
  renderer_v2_u32 fn_pressed, renderer_v2_u32 input_available);
renderer_v2_u32 renderer_v2_enqueue_host(RendererV2Runtime *runtime,
  renderer_v2_u16 event_id, renderer_v2_s32 value);

/* Must run on the renderer-v1/LVGL UI callback after renderer-v1 has produced
 * the base frame and before returning to the UI loop.  A false base_ok leaves
 * v2 state/generation untouched (last-good publication contract). */
RendererV2TickResult renderer_v2_ui_tick(RendererV2Runtime *runtime,
  renderer_v2_u16 *borrowed_framebuffer, renderer_v2_u32 base_ok);

/* Live ID26 adapter. It allocates a sidecar and an extended vtable, preserving
 * the existing renderer-v1 allocation and its single 62,000-byte framebuffer.
 * f2ep_data must remain persistent and byte-addressable in the ESP32-S3 data
 * address space (mapped immutable DROM or data RAM), never executable IROM.
 * The runtime borrows this immutable storage and never writes or frees it.
 * F2EP remains dormant until renderer-v1 activates the exact 62,404-byte
 * focus-dial raster F1WB. The bootstrap runtime is independently gated to its
 * exact 748-byte F1WB; all other base/program combinations stay v1-only. */
void *renderer_v2_native_attach(void *setup_owner, void *registry,
  void *renderer_v1_controller, const renderer_v2_u8 *f2ep_data,
  renderer_v2_u32 f2ep_bytes);
renderer_v2_u32 renderer_v2_native_host_event(void *renderer_v1_controller,
  renderer_v2_u16 event_id, renderer_v2_s32 value);

/* Scene-store two-phase handoff. prepare validates the persistent contiguous
 * focus-F1WB + focus-F2EP + timer-F2EP + exact blue-base LZSS package and
 * publishes PREPARED only.
 * After renderer-v1 stages the F1WB prefix, commit makes that generation
 * eligible for an infallible UI-thread switch; cancel clears PREPARED after a
 * staging failure. A committed store stays BUSY for the boot lifetime so all
 * all four borrowed pointers remain immutable. */
renderer_v2_u32 renderer_v2_native_prepare(void *renderer_v1_controller,
  const renderer_v2_u8 *package, renderer_v2_u32 package_bytes,
  renderer_v2_u32 generation);
renderer_v2_u32 renderer_v2_native_commit(void *renderer_v1_controller);
renderer_v2_u32 renderer_v2_native_cancel(void *renderer_v1_controller);

#ifdef RENDERER_V2_HOST_TEST
renderer_v2_u32 renderer_v2_host_admit_focus_base(
  const renderer_v2_u8 *bundle, renderer_v2_u32 bundle_bytes);
renderer_v2_u32 renderer_v2_host_decode_timer_base(renderer_v2_u8 *frame,
  renderer_v2_u32 frame_bytes, const renderer_v2_u8 *compressed,
  renderer_v2_u32 compressed_bytes);
renderer_v2_u32 renderer_v2_host_wall_snapshot(const renderer_v2_u8 snapshot[40],
  renderer_v2_u32 *seconds_since_midnight);
renderer_v2_s32 renderer_v2_host_add_event_scaled(renderer_v2_s32 prior,
  renderer_v2_s32 event_value, renderer_v2_s32 scale);
#endif

#endif
