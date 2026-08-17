/*
 * Generic structurally-admitted Render-v2 profile for Input Lab.
 *
 * Unlike the accepted clock/timer demonstration, this profile has no artifact
 * hash pins, no RTC policy, and no second screen.  Transport SHA-256 protects
 * delivery; the native safety boundary is complete canonical F1WB/F1RA and
 * F2EP structural validation plus fixed resource budgets.
 */
#include "renderer-v2-f2ep-generic.h"

typedef unsigned long renderer_v2_uptr;

#define RV2_F2EP_MAGIC 0x50453246u
#define RV2_LIVE_MAGIC 0x47563252u
#define RV2_HEADER_BYTES 64u
#define RV2_HANDLER_BYTES 12u
#define RV2_INSTRUCTION_BYTES 8u
#define RV2_PATCH_SET_BYTES 8u
#define RV2_VARIANT_BYTES 8u
#define RV2_SPAN_BYTES 8u
#define RV2_BINDING_BYTES 16u
#define RV2_MAX_HANDLERS 16u
#define RV2_MAX_PATCH_SETS 8u
#define RV2_MAX_VARIANTS 64u
#define RV2_MAX_SPANS 512u
#define RV2_MAX_PATCH_BYTES 16384u
#define RV2_MAX_BINDINGS 16u
#define RV2_BOTTOM_ENCODER 1u

#define RV2_EVENT_TICK100 1u
#define RV2_EVENT_TICK1 2u
#define RV2_EVENT_FN_KNOB 3u
#define RV2_EVENT_HOST 4u

#define RV2_OP_HALT 0u
#define RV2_OP_SET 1u
#define RV2_OP_ADD 2u
#define RV2_OP_LOAD_EVENT 3u
#define RV2_OP_ADD_EVENT 4u
#define RV2_OP_MOD_POSITIVE 5u
#define RV2_OP_CLAMP_MIN 6u
#define RV2_OP_CLAMP_MAX 7u
#define RV2_OP_ADD_EVENT_SCALED 8u

#define RV2_FIELD_NONE 0u
#define RV2_FIELD_VALUE 1u
#define RV2_FIELD_ID 2u
#define RV2_FIELD_SEQUENCE 3u
#define RV2_FIELD_FLAGS 4u

#define RV2_ERROR_NONE 0u
#define RV2_ERROR_ARGUMENT 1u
#define RV2_ERROR_STRUCTURE 2u
#define RV2_ERROR_VM 3u
#define RV2_ERROR_PATCH 4u
#define RV2_ERROR_BASE 5u

#define RV2_SWITCH_IDLE 0u
#define RV2_SWITCH_PREPARED 1u
#define RV2_SWITCH_STAGED 2u
#define RV2_SWITCH_COMMITTED 3u

#ifdef RENDERER_V2_HOST_TEST
#define RV2_EXPORT
#define RV2_USED
#else
#define RV2_EXPORT __attribute__((section(".text.renderer_v2"), used, visibility("default")))
#define RV2_USED __attribute__((section(".text.renderer_v2"), used))
#define RV2_FN_NEW ((void *(*)(renderer_v2_u32))(renderer_v2_uptr)0x420e7c04u)
#define RV2_FN_INPUT_GET ((void *(*)(void))(renderer_v2_uptr)0x4200c4c0u)
#define RV2_FN_FN_PRESSED ((renderer_v2_s32 (*)(void *))(renderer_v2_uptr)0x4210bfacu)
#define RV2_FN_IMAGE_SET_SRC ((void (*)(void *, const void *))(renderer_v2_uptr)0x420aeef0u)
#endif

/* Generic-only renderer-v1 tail exports these complete validators/lifecycle
 * helpers from the same source that performs the actual render. */
extern renderer_v2_u32 renderer_v1_validate_generic_base(
  const renderer_v2_u8 *bundle, renderer_v2_u32 bytes,
  renderer_v2_u32 generation);
extern renderer_v2_u32 renderer_v1_validate_generic_bundle(
  const renderer_v2_u8 *bundle, renderer_v2_u32 bytes,
  renderer_v2_u32 generation);
extern renderer_v2_u32 renderer_v1_prepare_store(void *controller,
  const renderer_v2_u8 *store);
extern renderer_v2_u32 renderer_v1_stage_bundle(void *controller,
  const renderer_v2_u8 *bundle, renderer_v2_u32 bytes);

static renderer_v2_u16 rv2_rd16(const renderer_v2_u8 *p) {
  return (renderer_v2_u16)((renderer_v2_u16)p[0] |
    ((renderer_v2_u16)p[1] << 8));
}
static renderer_v2_u32 rv2_rd32(const renderer_v2_u8 *p) {
  return (renderer_v2_u32)p[0] | ((renderer_v2_u32)p[1] << 8) |
    ((renderer_v2_u32)p[2] << 16) | ((renderer_v2_u32)p[3] << 24);
}
static void rv2_zero(void *value, renderer_v2_u32 bytes) {
  renderer_v2_u8 *p = (renderer_v2_u8 *)value;
  while (bytes-- != 0u) *p++ = 0u;
}
static void rv2_copy(void *destination, const void *source,
    renderer_v2_u32 bytes) {
  renderer_v2_u8 *d = (renderer_v2_u8 *)destination;
  const renderer_v2_u8 *s = (const renderer_v2_u8 *)source;
  while (bytes-- != 0u) *d++ = *s++;
}
#ifndef RENDERER_V2_HOST_TEST
RV2_USED __attribute__((weak))
void *memcpy(void *destination, const void *source, renderer_v2_u32 bytes) {
  rv2_copy(destination, source, bytes); return destination;
}
#endif
static renderer_v2_u32 rv2_range(renderer_v2_u32 offset,
    renderer_v2_u32 bytes, renderer_v2_u32 total) {
  return offset <= total && bytes <= total - offset;
}
static renderer_v2_u32 rv2_align4(renderer_v2_u32 value) {
  return (value + 3u) & ~3u;
}
static renderer_v2_u32 rv2_zero_range(const renderer_v2_u8 *p,
    renderer_v2_u32 bytes) {
  while (bytes-- != 0u) if (*p++ != 0u) return 0u;
  return 1u;
}
static renderer_v2_u32 rv2_padding_zero(const renderer_v2_u8 *p,
    renderer_v2_u32 from, renderer_v2_u32 to) {
  return from <= to && rv2_zero_range(p + from, to - from);
}
#ifdef RENDERER_V2_HOST_TEST
static renderer_v2_u32 rv2_is_data(const void *value, renderer_v2_u32 bytes) {
  return value != (const void *)0 && bytes != 0u;
}
static void rv2_barrier(void) { }
#else
static renderer_v2_u32 rv2_is_data(const void *value, renderer_v2_u32 bytes) {
  renderer_v2_uptr start = (renderer_v2_uptr)value;
  renderer_v2_uptr end = start + (renderer_v2_uptr)bytes;
  return start >= (renderer_v2_uptr)0x3c000000u &&
    start < (renderer_v2_uptr)0x40000000u && end >= start &&
    end <= (renderer_v2_uptr)0x40000000u;
}
static void rv2_barrier(void) { __asm__ __volatile__("memw" ::: "memory"); }
#endif

/* Full canonical F2EP-v1 admission.  It is deliberately digest-agnostic: the
 * scene transaction already verifies the SHA of the complete package. */
static renderer_v2_u32 rv2_admit(RendererV2GenericRuntime *r,
    const renderer_v2_u8 *p, renderer_v2_u32 bytes) {
  renderer_v2_u32 i, j, cursor, prior_end, blob_end;
  if (r == (RendererV2GenericRuntime *)0 || p == (const renderer_v2_u8 *)0 ||
      bytes < RV2_HEADER_BYTES || bytes > RENDERER_V2_GENERIC_MAX_F2EP_BYTES ||
      rv2_rd32(p) != RV2_F2EP_MAGIC || p[4] != 1u ||
      p[5] == 0u || p[5] > RENDERER_V2_GENERIC_STATE_SLOTS ||
      p[6] == 0u || p[6] > RV2_MAX_HANDLERS ||
      p[7] == 0u || p[7] > RV2_MAX_PATCH_SETS ||
      rv2_rd16(p + 8u) == 0u || rv2_rd16(p + 8u) > RV2_MAX_BINDINGS ||
      rv2_rd16(p + 10u) == 0u || rv2_rd16(p + 10u) > RV2_MAX_VARIANTS ||
      rv2_rd32(p + 12u) != bytes || rv2_rd32(p + 52u) == 0u ||
      rv2_rd32(p + 52u) > RV2_MAX_SPANS || rv2_rd32(p + 56u) < 2u ||
      rv2_rd32(p + 56u) > RV2_MAX_PATCH_BYTES || rv2_rd32(p + 60u) != 0u)
    return RV2_ERROR_STRUCTURE;

  r->state_count = p[5]; r->handler_count = p[6];
  r->patch_set_count = p[7]; r->binding_count = rv2_rd16(p + 8u);
  r->variant_count = rv2_rd16(p + 10u);
  for (i = 0u; i < 8u; i++) r->section[i] = rv2_rd32(p + 16u + i * 4u);
  r->bytecode_bytes = rv2_rd32(p + 48u);
  r->span_count = rv2_rd32(p + 52u); r->patch_bytes = rv2_rd32(p + 56u);

  cursor = RV2_HEADER_BYTES;
#define RV2_SECTION(index, amount) do { \
  cursor = rv2_align4(cursor); \
  if (r->section[(index)] != cursor || !rv2_range(cursor, (amount), bytes)) \
    return RV2_ERROR_STRUCTURE; \
  cursor += (amount); \
} while (0)
  RV2_SECTION(0, (renderer_v2_u32)r->state_count * 4u);
  if (!rv2_padding_zero(p, cursor, rv2_align4(cursor))) return RV2_ERROR_STRUCTURE;
  RV2_SECTION(1, (renderer_v2_u32)r->handler_count * RV2_HANDLER_BYTES);
  if (!rv2_padding_zero(p, cursor, rv2_align4(cursor))) return RV2_ERROR_STRUCTURE;
  RV2_SECTION(2, r->bytecode_bytes);
  if (!rv2_padding_zero(p, cursor, rv2_align4(cursor))) return RV2_ERROR_STRUCTURE;
  RV2_SECTION(3, (renderer_v2_u32)r->patch_set_count * RV2_PATCH_SET_BYTES);
  if (!rv2_padding_zero(p, cursor, rv2_align4(cursor))) return RV2_ERROR_STRUCTURE;
  RV2_SECTION(4, (renderer_v2_u32)r->variant_count * RV2_VARIANT_BYTES);
  if (!rv2_padding_zero(p, cursor, rv2_align4(cursor))) return RV2_ERROR_STRUCTURE;
  RV2_SECTION(5, r->span_count * RV2_SPAN_BYTES);
  if (!rv2_padding_zero(p, cursor, rv2_align4(cursor))) return RV2_ERROR_STRUCTURE;
  RV2_SECTION(6, (renderer_v2_u32)r->binding_count * RV2_BINDING_BYTES);
  if (!rv2_padding_zero(p, cursor, rv2_align4(cursor))) return RV2_ERROR_STRUCTURE;
  RV2_SECTION(7, r->patch_bytes);
#undef RV2_SECTION
  if (cursor != bytes || (r->patch_bytes & 1u) != 0u ||
      r->bytecode_bytes < RV2_INSTRUCTION_BYTES ||
      (r->bytecode_bytes & (RV2_INSTRUCTION_BYTES - 1u)) != 0u)
    return RV2_ERROR_STRUCTURE;

  cursor = 0u;
  for (i = 0u; i < r->handler_count; i++) {
    const renderer_v2_u8 *h = p + r->section[1] + i * RV2_HANDLER_BYTES;
    renderer_v2_u32 kind = h[0], match = rv2_rd16(h + 2u);
    renderer_v2_u32 start = rv2_rd32(h + 4u), count = rv2_rd16(h + 8u);
    if (kind < RV2_EVENT_TICK100 || kind > RV2_EVENT_HOST || h[1] != 0u ||
        rv2_rd16(h + 10u) != 0u || start != cursor || count == 0u ||
        count > 64u || !rv2_range(start, count * RV2_INSTRUCTION_BYTES,
          r->bytecode_bytes) ||
        (kind == RV2_EVENT_FN_KNOB && match != RV2_BOTTOM_ENCODER) ||
        (kind == RV2_EVENT_HOST && match == 0u) ||
        ((kind == RV2_EVENT_TICK100 || kind == RV2_EVENT_TICK1) && match != 0u))
      return RV2_ERROR_STRUCTURE;
    for (j = 0u; j < i; j++) {
      const renderer_v2_u8 *prior = p + r->section[1] + j * RV2_HANDLER_BYTES;
      if (prior[0] == kind && rv2_rd16(prior + 2u) == match)
        return RV2_ERROR_STRUCTURE;
    }
    for (j = 0u; j < count; j++) {
      const renderer_v2_u8 *op = p + r->section[2] + start +
        j * RV2_INSTRUCTION_BYTES;
      renderer_v2_u32 code = op[0], field = op[2];
      renderer_v2_s32 immediate = (renderer_v2_s32)rv2_rd32(op + 4u);
      if (code > RV2_OP_ADD_EVENT_SCALED || op[1] >= r->state_count ||
          op[3] != 0u) return RV2_ERROR_STRUCTURE;
      if (code == RV2_OP_HALT) {
        if (j + 1u != count || op[1] != 0u || field != 0u || immediate != 0)
          return RV2_ERROR_STRUCTURE;
      } else if (j + 1u == count) return RV2_ERROR_STRUCTURE;
      else if (code == RV2_OP_LOAD_EVENT || code == RV2_OP_ADD_EVENT ||
               code == RV2_OP_ADD_EVENT_SCALED) {
        if (field < RV2_FIELD_VALUE || field > RV2_FIELD_FLAGS ||
            ((code == RV2_OP_ADD_EVENT_SCALED) ? immediate == 0 : immediate != 0))
          return RV2_ERROR_STRUCTURE;
      } else if (field != RV2_FIELD_NONE ||
          (code == RV2_OP_MOD_POSITIVE && immediate <= 0))
        return RV2_ERROR_STRUCTURE;
    }
    cursor += count * RV2_INSTRUCTION_BYTES;
  }
  if (cursor != r->bytecode_bytes) return RV2_ERROR_STRUCTURE;

  cursor = 0u;
  for (i = 0u; i < r->patch_set_count; i++) {
    const renderer_v2_u8 *set = p + r->section[3] + i * RV2_PATCH_SET_BYTES;
    renderer_v2_u32 start = rv2_rd16(set), count = rv2_rd16(set + 2u);
    if (start != cursor || count == 0u || start + count > r->variant_count ||
        rv2_rd32(set + 4u) != 0u) return RV2_ERROR_STRUCTURE;
    cursor += count;
  }
  if (cursor != r->variant_count) return RV2_ERROR_STRUCTURE;

  cursor = 0u; blob_end = 0u;
  for (i = 0u; i < r->variant_count; i++) {
    const renderer_v2_u8 *variant = p + r->section[4] + i * RV2_VARIANT_BYTES;
    renderer_v2_u32 start = rv2_rd16(variant), count = rv2_rd16(variant + 2u);
    if (start != cursor || count == 0u || start + count > r->span_count ||
        rv2_rd32(variant + 4u) != 0u) return RV2_ERROR_STRUCTURE;
    prior_end = 0u;
    for (j = 0u; j < count; j++) {
      const renderer_v2_u8 *span = p + r->section[5] +
        (start + j) * RV2_SPAN_BYTES;
      renderer_v2_u32 pixel = rv2_rd16(span), pixels = rv2_rd16(span + 2u);
      renderer_v2_u32 blob = rv2_rd32(span + 4u);
      if (pixels == 0u || pixel < prior_end ||
          pixel > RENDERER_V2_GENERIC_FRAME_PIXELS ||
          pixels > RENDERER_V2_GENERIC_FRAME_PIXELS - pixel ||
          blob != blob_end || !rv2_range(blob, pixels * 2u, r->patch_bytes))
        return RV2_ERROR_STRUCTURE;
      prior_end = pixel + pixels; blob_end += pixels * 2u;
    }
    cursor += count;
  }
  if (cursor != r->span_count || blob_end != r->patch_bytes)
    return RV2_ERROR_STRUCTURE;

  for (i = 0u; i < r->binding_count; i++) {
    const renderer_v2_u8 *binding = p + r->section[6] + i * RV2_BINDING_BYTES;
    renderer_v2_u32 state = binding[0], set_index = binding[1];
    renderer_v2_u32 divisor = rv2_rd32(binding + 4u);
    renderer_v2_u32 modulo = rv2_rd16(binding + 8u);
    renderer_v2_u32 origin = rv2_rd32(binding + 12u);
    const renderer_v2_u8 *set;
    renderer_v2_u32 set_start, set_count;
    if (state >= r->state_count || set_index >= r->patch_set_count ||
        rv2_rd16(binding + 2u) != 0u || divisor == 0u || modulo == 0u ||
        rv2_rd16(binding + 10u) != 0u ||
        origin >= RENDERER_V2_GENERIC_FRAME_PIXELS) return RV2_ERROR_STRUCTURE;
    set = p + r->section[3] + set_index * RV2_PATCH_SET_BYTES;
    set_start = rv2_rd16(set); set_count = rv2_rd16(set + 2u);
    if (modulo > set_count) return RV2_ERROR_STRUCTURE;
    for (j = 0u; j < set_count; j++) {
      const renderer_v2_u8 *variant = p + r->section[4] +
        (set_start + j) * RV2_VARIANT_BYTES;
      renderer_v2_u32 k, span_start = rv2_rd16(variant);
      renderer_v2_u32 span_count = rv2_rd16(variant + 2u);
      for (k = 0u; k < span_count; k++) {
        const renderer_v2_u8 *span = p + r->section[5] +
          (span_start + k) * RV2_SPAN_BYTES;
        renderer_v2_u32 pixel = rv2_rd16(span), pixels = rv2_rd16(span + 2u);
        if (origin > RENDERER_V2_GENERIC_FRAME_PIXELS - pixel ||
            pixels > RENDERER_V2_GENERIC_FRAME_PIXELS - origin - pixel)
          return RV2_ERROR_STRUCTURE;
      }
    }
  }
  return RV2_ERROR_NONE;
}

RV2_EXPORT renderer_v2_u32 renderer_v2_generic_runtime_init(
    RendererV2GenericRuntime *r, const renderer_v2_u8 *program,
    renderer_v2_u32 bytes) {
  renderer_v2_u32 error, i;
  if (r == (RendererV2GenericRuntime *)0 ||
      program == (const renderer_v2_u8 *)0) return 0u;
  rv2_zero(r, (renderer_v2_u32)sizeof(*r));
  if (!rv2_is_data(program, bytes)) { r->error = RV2_ERROR_ARGUMENT; return 0u; }
  error = rv2_admit(r, program, bytes);
  if (error != RV2_ERROR_NONE) { r->error = error; return 0u; }
  r->program = program; r->program_bytes = bytes;
  for (i = 0u; i < r->state_count; i++)
    r->state[i] = (renderer_v2_s32)rv2_rd32(program + r->section[0] + i * 4u);
  return 1u;
}

static renderer_v2_u32 rv2_try_lock(RendererV2GenericRuntime *r) {
  renderer_v2_u32 expected = 0u;
  return __atomic_compare_exchange_n(&r->queue_lock, &expected, 1u, 0,
    __ATOMIC_ACQUIRE, __ATOMIC_RELAXED);
}
static void rv2_unlock(RendererV2GenericRuntime *r) {
  __atomic_store_n(&r->queue_lock, 0u, __ATOMIC_RELEASE);
}
static renderer_v2_u32 rv2_has_handler(const RendererV2GenericRuntime *r,
    renderer_v2_u32 kind, renderer_v2_u32 id) {
  renderer_v2_u32 i;
  for (i = 0u; i < r->handler_count; i++) {
    const renderer_v2_u8 *h = r->program + r->section[1] +
      i * RV2_HANDLER_BYTES;
    if (h[0] == kind && rv2_rd16(h + 2u) == id) return 1u;
  }
  return 0u;
}
static renderer_v2_u32 rv2_enqueue_guarded(RendererV2GenericRuntime *r,
    renderer_v2_u32 kind, renderer_v2_u32 flags, renderer_v2_u32 id,
    renderer_v2_s32 value, const volatile renderer_v2_u32 *gate,
    const volatile renderer_v2_u32 *epoch, renderer_v2_u32 expected_epoch,
    renderer_v2_u32 require_handler) {
  RendererV2GenericEvent *event;
  if (!rv2_try_lock(r)) return 0u;
  if ((gate != (const volatile renderer_v2_u32 *)0 &&
       (__atomic_load_n(gate, __ATOMIC_ACQUIRE) == 0u ||
        __atomic_load_n(epoch, __ATOMIC_ACQUIRE) != expected_epoch)) ||
      (require_handler != 0u && !rv2_has_handler(r, kind, id))) {
    rv2_unlock(r); return 0u;
  }
  if (r->queue_count == RENDERER_V2_GENERIC_QUEUE_RECORDS) {
    r->rejected_events++; rv2_unlock(r); return 0u;
  }
  event = &r->queue[r->queue_tail]; event->kind = (renderer_v2_u8)kind;
  event->flags = (renderer_v2_u8)flags; event->id = (renderer_v2_u16)id;
  event->value = value; event->sequence = ++r->sequence; event->reserved = 0u;
  r->queue_tail = (renderer_v2_u8)((r->queue_tail + 1u) %
    RENDERER_V2_GENERIC_QUEUE_RECORDS);
  r->queue_count++; rv2_unlock(r); return 1u;
}
static renderer_v2_u32 rv2_enqueue(RendererV2GenericRuntime *r,
    renderer_v2_u32 kind, renderer_v2_u32 flags, renderer_v2_u32 id,
    renderer_v2_s32 value) {
  return rv2_enqueue_guarded(r, kind, flags, id, value,
    (const volatile renderer_v2_u32 *)0,
    (const volatile renderer_v2_u32 *)0, 0u, 0u);
}

RV2_EXPORT renderer_v2_u32 renderer_v2_generic_enqueue_fn_bottom(
    RendererV2GenericRuntime *r, renderer_v2_u32 encoder_id,
    renderer_v2_u32 raw_delta, renderer_v2_u32 fn_pressed,
    renderer_v2_u32 input_available) {
  renderer_v2_s32 delta =
    (renderer_v2_s32)(signed char)(renderer_v2_u8)raw_delta;
  renderer_v2_u32 result = RENDERER_V2_INPUT_CONSUMED;
  if (r == (RendererV2GenericRuntime *)0 ||
      r->program == (const renderer_v2_u8 *)0 ||
      encoder_id != RV2_BOTTOM_ENCODER || delta == 0 || fn_pressed == 0u ||
      input_available == 0u ||
      !rv2_has_handler(r, RV2_EVENT_FN_KNOB, RV2_BOTTOM_ENCODER))
    return RENDERER_V2_INPUT_FALLBACK;
  if (rv2_enqueue(r, RV2_EVENT_FN_KNOB, 1u, encoder_id, delta))
    result |= RENDERER_V2_INPUT_ENQUEUED;
  return result;
}

RV2_EXPORT renderer_v2_u32 renderer_v2_generic_enqueue_host(
    RendererV2GenericRuntime *r, renderer_v2_u16 event_id,
    renderer_v2_s32 value) {
  if (r == (RendererV2GenericRuntime *)0 ||
      r->program == (const renderer_v2_u8 *)0 ||
      !rv2_has_handler(r, RV2_EVENT_HOST, event_id)) return 0u;
  return rv2_enqueue(r, RV2_EVENT_HOST, 0u, event_id, value);
}

static renderer_v2_s32 rv2_event_field(renderer_v2_u32 field,
    const RendererV2GenericEvent *event) {
  if (field == RV2_FIELD_VALUE) return event->value;
  if (field == RV2_FIELD_ID) return (renderer_v2_s32)event->id;
  if (field == RV2_FIELD_SEQUENCE) return (renderer_v2_s32)event->sequence;
  if (field == RV2_FIELD_FLAGS) return (renderer_v2_s32)event->flags;
  return 0;
}
static renderer_v2_s32 rv2_mod(renderer_v2_s32 value,
    renderer_v2_s32 modulus) {
  renderer_v2_s32 result = value % modulus;
  return result < 0 ? result + modulus : result;
}
static renderer_v2_s32 rv2_add_event_scaled(renderer_v2_s32 prior,
    renderer_v2_s32 event_value, renderer_v2_s32 scale) {
  return (renderer_v2_s32)((renderer_v2_u32)prior +
    (renderer_v2_u32)event_value * (renderer_v2_u32)scale);
}
static renderer_v2_s32 rv2_trunc_div_u32(renderer_v2_s32 value,
    renderer_v2_u32 divisor) {
  renderer_v2_u32 magnitude, quotient;
  if (value >= 0) return (renderer_v2_s32)((renderer_v2_u32)value / divisor);
  magnitude = 0u - (renderer_v2_u32)value; quotient = magnitude / divisor;
  return quotient == 0u ? 0 : (renderer_v2_s32)(0u - quotient);
}
static renderer_v2_u32 rv2_execute(const RendererV2GenericRuntime *r,
    renderer_v2_s32 state[RENDERER_V2_GENERIC_STATE_SLOTS],
    const renderer_v2_u8 *h, const RendererV2GenericEvent *event,
    renderer_v2_u32 *changed) {
  renderer_v2_u32 start = rv2_rd32(h + 4u), count = rv2_rd16(h + 8u), i;
  for (i = 0u; i < count; i++) {
    const renderer_v2_u8 *op = r->program + r->section[2] + start +
      i * RV2_INSTRUCTION_BYTES;
    renderer_v2_u32 code = op[0], slot = op[1], field = op[2];
    renderer_v2_s32 immediate = (renderer_v2_s32)rv2_rd32(op + 4u);
    renderer_v2_s32 prior, next;
    if (code == RV2_OP_HALT) return 1u;
    if (slot >= r->state_count) return 0u;
    prior = state[slot]; next = prior;
    if (code == RV2_OP_SET) next = immediate;
    else if (code == RV2_OP_ADD)
      next = (renderer_v2_s32)((renderer_v2_u32)prior +
        (renderer_v2_u32)immediate);
    else if (code == RV2_OP_LOAD_EVENT)
      next = rv2_event_field(field, event);
    else if (code == RV2_OP_ADD_EVENT)
      next = (renderer_v2_s32)((renderer_v2_u32)prior +
        (renderer_v2_u32)rv2_event_field(field, event));
    else if (code == RV2_OP_ADD_EVENT_SCALED)
      next = rv2_add_event_scaled(prior, rv2_event_field(field, event), immediate);
    else if (code == RV2_OP_MOD_POSITIVE) next = rv2_mod(prior, immediate);
    else if (code == RV2_OP_CLAMP_MIN) next = prior < immediate ? immediate : prior;
    else if (code == RV2_OP_CLAMP_MAX) next = prior > immediate ? immediate : prior;
    else return 0u;
    state[slot] = next; if (next != prior) *changed = 1u;
  }
  return 0u;
}
static renderer_v2_u32 rv2_dispatch(const RendererV2GenericRuntime *r,
    renderer_v2_s32 state[RENDERER_V2_GENERIC_STATE_SLOTS],
    const RendererV2GenericEvent *event, renderer_v2_u32 *changed) {
  renderer_v2_u32 i;
  for (i = 0u; i < r->handler_count; i++) {
    const renderer_v2_u8 *h = r->program + r->section[1] +
      i * RV2_HANDLER_BYTES;
    if (h[0] != event->kind) continue;
    if ((event->kind == RV2_EVENT_HOST || event->kind == RV2_EVENT_FN_KNOB) &&
        rv2_rd16(h + 2u) != event->id) continue;
    if (!rv2_execute(r, state, h, event, changed)) return 0u;
  }
  return 1u;
}
static renderer_v2_u32 rv2_apply(const RendererV2GenericRuntime *r,
    const renderer_v2_s32 state[RENDERER_V2_GENERIC_STATE_SLOTS],
    renderer_v2_u16 *frame) {
  renderer_v2_u32 i, j;
  for (i = 0u; i < r->binding_count; i++) {
    const renderer_v2_u8 *binding = r->program + r->section[6] +
      i * RV2_BINDING_BYTES;
    renderer_v2_u32 slot = binding[0], set_index = binding[1];
    renderer_v2_u32 divisor = rv2_rd32(binding + 4u);
    renderer_v2_u32 modulo = rv2_rd16(binding + 8u);
    renderer_v2_u32 origin = rv2_rd32(binding + 12u);
    renderer_v2_s32 quotient = rv2_trunc_div_u32(state[slot], divisor);
    renderer_v2_s32 selected = rv2_mod(quotient, (renderer_v2_s32)modulo);
    const renderer_v2_u8 *set = r->program + r->section[3] +
      set_index * RV2_PATCH_SET_BYTES;
    renderer_v2_u32 variant_index = rv2_rd16(set) +
      (renderer_v2_u32)selected;
    const renderer_v2_u8 *variant = r->program + r->section[4] +
      variant_index * RV2_VARIANT_BYTES;
    renderer_v2_u32 start = rv2_rd16(variant), count = rv2_rd16(variant + 2u);
    for (j = 0u; j < count; j++) {
      const renderer_v2_u8 *span = r->program + r->section[5] +
        (start + j) * RV2_SPAN_BYTES;
      renderer_v2_u32 pixel = rv2_rd16(span), pixels = rv2_rd16(span + 2u);
      renderer_v2_u32 blob = rv2_rd32(span + 4u), k;
      if (origin + pixel + pixels > RENDERER_V2_GENERIC_FRAME_PIXELS ||
          blob + pixels * 2u > r->patch_bytes) return 0u;
      for (k = 0u; k < pixels; k++)
        frame[origin + pixel + k] = rv2_rd16(r->program + r->section[7] +
          blob + k * 2u);
    }
  }
  return 1u;
}

static RendererV2GenericTickResult rv2_overlay_last_good(
    RendererV2GenericRuntime *r, renderer_v2_u16 *frame,
    renderer_v2_u32 error) {
  RendererV2GenericTickResult result;
  rv2_zero(&result, (renderer_v2_u32)sizeof(result));
  r->error = error; result.error = error;
  if (rv2_apply(r, r->state, frame)) {
    result.rendered = 1u; result.frame_generation = r->frame_generation;
    result.descriptor_identity = r->descriptor_identity;
  }
  return result;
}

RV2_EXPORT RendererV2GenericTickResult renderer_v2_generic_ui_tick(
    RendererV2GenericRuntime *r, renderer_v2_u16 *frame,
    renderer_v2_u32 base_ok) {
  RendererV2GenericTickResult result;
  RendererV2GenericEvent events[RENDERER_V2_GENERIC_QUEUE_RECORDS], tick;
  renderer_v2_s32 next[RENDERER_V2_GENERIC_STATE_SLOTS];
  renderer_v2_u32 count = 0u, i, changed = 0u, next_subsecond;
  renderer_v2_u32 tick100_sequence, tick1_sequence = 0u;
  rv2_zero(&result, (renderer_v2_u32)sizeof(result));
  if (r == (RendererV2GenericRuntime *)0 ||
      r->program == (const renderer_v2_u8 *)0 ||
      frame == (renderer_v2_u16 *)0) {
    result.error = RV2_ERROR_ARGUMENT; return result;
  }
  if (base_ok == 0u) {
    r->error = RV2_ERROR_BASE; result.error = r->error; return result;
  }
  if (!rv2_try_lock(r)) return rv2_overlay_last_good(r, frame, RV2_ERROR_VM);
  while (r->queue_count != 0u) {
    rv2_copy(&events[count++], &r->queue[r->queue_head],
      (renderer_v2_u32)sizeof(RendererV2GenericEvent));
    rv2_zero(&r->queue[r->queue_head],
      (renderer_v2_u32)sizeof(RendererV2GenericEvent));
    r->queue_head = (renderer_v2_u8)((r->queue_head + 1u) %
      RENDERER_V2_GENERIC_QUEUE_RECORDS); r->queue_count--;
  }
  tick100_sequence = ++r->sequence;
  if ((renderer_v2_u32)r->subsecond + 1u == 10u)
    tick1_sequence = ++r->sequence;
  rv2_unlock(r);
  for (i = 0u; i < RENDERER_V2_GENERIC_STATE_SLOTS; i++) next[i] = r->state[i];
  for (i = 0u; i < count; i++)
    if (!rv2_dispatch(r, next, &events[i], &changed))
      return rv2_overlay_last_good(r, frame, RV2_ERROR_VM);
  rv2_zero(&tick, (renderer_v2_u32)sizeof(tick));
  tick.kind = RV2_EVENT_TICK100; tick.value = 1;
  tick.sequence = tick100_sequence;
  if (!rv2_dispatch(r, next, &tick, &changed))
    return rv2_overlay_last_good(r, frame, RV2_ERROR_VM);
  next_subsecond = (renderer_v2_u32)r->subsecond + 1u;
  if (next_subsecond == 10u) {
    next_subsecond = 0u; tick.kind = RV2_EVENT_TICK1;
    tick.sequence = tick1_sequence;
    if (!rv2_dispatch(r, next, &tick, &changed))
      return rv2_overlay_last_good(r, frame, RV2_ERROR_VM);
    result.second_tick = 1u;
  }
  if (!rv2_apply(r, next, frame)) {
    r->error = RV2_ERROR_PATCH; result.error = r->error; return result;
  }
  for (i = 0u; i < RENDERER_V2_GENERIC_STATE_SLOTS; i++) r->state[i] = next[i];
  r->subsecond = (renderer_v2_u8)next_subsecond; r->tick_count++;
  r->frame_generation++; r->descriptor_identity ^= 1u;
  r->error = RV2_ERROR_NONE;
  result.rendered = 1u; result.drained_events = count;
  result.state_changed = changed; result.frame_generation = r->frame_generation;
  result.descriptor_identity = r->descriptor_identity;
  return result;
}

/* ---- Generic ID26 adapter and repeat-push ownership ---- */
typedef void (*RendererV2OldTick)(void *);
typedef void (*RendererV2OldEncoder)(void *, renderer_v2_u32, renderer_v2_u32);
typedef struct {
  renderer_v2_u32 magic;
  RendererV2OldTick old_tick;
  RendererV2OldEncoder old_encoder;
  void *vtable[12];
  RendererV2GenericRuntime runtime;
  RendererV2GenericRuntime pending_runtime;
  renderer_v2_u8 *owned_bundle;
  renderer_v2_u8 *owned_program;
  renderer_v2_u32 owned_bundle_bytes;
  renderer_v2_u32 owned_program_bytes;
  renderer_v2_u32 owned_generation;
  renderer_v2_u32 owned_is_v2;
  renderer_v2_u32 pending_bundle_bytes;
  renderer_v2_u32 pending_generation;
  renderer_v2_u32 pending_is_v2;
  volatile renderer_v2_u32 admitted;
  volatile renderer_v2_u32 epoch;
  volatile renderer_v2_u32 switch_state;
  volatile renderer_v2_u32 upload_state;
  volatile renderer_v2_u32 detach_requested;
  volatile renderer_v2_u32 program_detached;
  volatile renderer_v2_u32 copy_started;
  volatile renderer_v2_u32 owned_valid;
  volatile renderer_v2_u32 activation_observed;
} RendererV2GenericSidecar;

#define RV2_UPLOAD_IDLE 0u
#define RV2_UPLOAD_DETACHING 1u
#define RV2_UPLOAD_WRITING 2u

#ifdef RENDERER_V2_HOST_TEST
/* Native lifecycle harness analogue of the 32-bit renderer-v1 ABI.  Accessors
 * below keep host pointer width from corrupting the byte-exact device layout. */
typedef struct {
  void **vptr;
  const renderer_v2_u8 *active_bundle;
  renderer_v2_u32 active_length;
  const renderer_v2_u8 *pending_bundle;
  renderer_v2_u32 pending_length;
  renderer_v2_u32 active_generation;
  renderer_v2_u32 pending_generation;
  renderer_v2_u32 elapsed_tick;
  renderer_v2_u32 descriptor_identity;
  void *image;
  renderer_v2_u32 error;
  renderer_v2_u16 framebuffer[RENDERER_V2_GENERIC_FRAME_PIXELS];
  const renderer_v2_u8 *freeze_request;
} RendererV2GenericHostController;
#endif

static void **rv2_ctl_vtable(void *controller) {
#ifdef RENDERER_V2_HOST_TEST
  return ((RendererV2GenericHostController *)controller)->vptr;
#else
  return *(void ***)controller;
#endif
}
static void
#ifdef RENDERER_V2_HOST_TEST
__attribute__((unused))
#endif
rv2_ctl_set_vtable(void *controller, void **vtable) {
#ifdef RENDERER_V2_HOST_TEST
  ((RendererV2GenericHostController *)controller)->vptr = vtable;
#else
  *(void ***)controller = vtable;
#endif
}
static const renderer_v2_u8 *rv2_ctl_active(void *controller) {
#ifdef RENDERER_V2_HOST_TEST
  return ((RendererV2GenericHostController *)controller)->active_bundle;
#else
  return *(const renderer_v2_u8 **)((renderer_v2_u8 *)controller + 28u);
#endif
}
static renderer_v2_u32 rv2_ctl_active_bytes(void *controller) {
#ifdef RENDERER_V2_HOST_TEST
  return ((RendererV2GenericHostController *)controller)->active_length;
#else
  return *(renderer_v2_u32 *)((renderer_v2_u8 *)controller + 32u);
#endif
}
static renderer_v2_u32 rv2_ctl_generation(void *controller) {
#ifdef RENDERER_V2_HOST_TEST
  return ((RendererV2GenericHostController *)controller)->active_generation;
#else
  return *(renderer_v2_u32 *)((renderer_v2_u8 *)controller + 44u);
#endif
}
static renderer_v2_u32 rv2_ctl_error(void *controller) {
#ifdef RENDERER_V2_HOST_TEST
  return ((RendererV2GenericHostController *)controller)->error;
#else
  return *(renderer_v2_u32 *)((renderer_v2_u8 *)controller + 64u);
#endif
}
static const renderer_v2_u8 *rv2_ctl_freeze(void *controller) {
#ifdef RENDERER_V2_HOST_TEST
  return ((RendererV2GenericHostController *)controller)->freeze_request;
#else
  return *(const renderer_v2_u8 **)((renderer_v2_u8 *)controller + 62160u);
#endif
}
static renderer_v2_u16 *rv2_ctl_framebuffer(void *controller) {
#ifdef RENDERER_V2_HOST_TEST
  return ((RendererV2GenericHostController *)controller)->framebuffer;
#else
  return (renderer_v2_u16 *)((renderer_v2_u8 *)controller + 160u);
#endif
}

static void rv2_queue_clear_locked(RendererV2GenericRuntime *runtime) {
  renderer_v2_u32 i;
  for (i = 0u; i < RENDERER_V2_GENERIC_QUEUE_RECORDS; i++)
    rv2_zero(&runtime->queue[i],
      (renderer_v2_u32)sizeof(RendererV2GenericEvent));
  runtime->queue_head = 0u; runtime->queue_tail = 0u;
  runtime->queue_count = 0u;
}

static RendererV2GenericSidecar *rv2_installed_sidecar(void *controller);

static void rv2_gate_close(RendererV2GenericSidecar *sidecar) {
  __atomic_store_n(&sidecar->admitted, 0u, __ATOMIC_RELEASE);
  (void)__atomic_add_fetch(&sidecar->epoch, 1u, __ATOMIC_ACQ_REL);
  if (rv2_try_lock(&sidecar->runtime)) {
    rv2_queue_clear_locked(&sidecar->runtime); rv2_unlock(&sidecar->runtime);
  }
}

static renderer_v2_u32 rv2_owned_active_identity(
    RendererV2GenericSidecar *sidecar,
    void *controller) {
  return sidecar->owned_valid != 0u &&
    rv2_ctl_active(controller) == sidecar->owned_bundle &&
    rv2_ctl_active_bytes(controller) == sidecar->owned_bundle_bytes &&
    rv2_ctl_generation(controller) == sidecar->owned_generation &&
    rv2_ctl_error(controller) == 0u;
}

static renderer_v2_u32 rv2_active_identity(RendererV2GenericSidecar *sidecar,
    void *controller) {
  return sidecar->owned_is_v2 != 0u &&
    rv2_owned_active_identity(sidecar, controller);
}

static void renderer_v2_generic_live_tick(void *controller) {
  void **vtable = rv2_ctl_vtable(controller);
  RendererV2GenericSidecar *sidecar =
    (RendererV2GenericSidecar *)vtable[11];
  RendererV2GenericTickResult result;
  if (sidecar == (RendererV2GenericSidecar *)0 ||
      sidecar->magic != RV2_LIVE_MAGIC) return;
  sidecar->old_tick(controller);

  /* The renderer-v1 UI callback clears its freeze_request before returning.
   * Do not publish our separate program-detached acknowledgment until this
   * wrapper has also closed the event gate and drained the queue.  A producer
   * therefore cannot overwrite either owned buffer between the two steps. */
  if (__atomic_load_n(&sidecar->detach_requested, __ATOMIC_ACQUIRE) != 0u) {
    rv2_gate_close(sidecar);
    if (rv2_ctl_active(controller) == (const renderer_v2_u8 *)0 &&
        rv2_ctl_freeze(controller) == (const renderer_v2_u8 *)0)
      __atomic_store_n(&sidecar->program_detached, 1u, __ATOMIC_RELEASE);
    return;
  }

  if (__atomic_load_n(&sidecar->switch_state, __ATOMIC_ACQUIRE) ==
      RV2_SWITCH_COMMITTED &&
      rv2_ctl_active(controller) == sidecar->owned_bundle &&
      rv2_ctl_active_bytes(controller) == sidecar->pending_bundle_bytes &&
      rv2_ctl_generation(controller) == sidecar->pending_generation &&
      rv2_ctl_error(controller) == 0u) {
    rv2_gate_close(sidecar);
    if (sidecar->pending_is_v2 == 0u) {
      sidecar->owned_bundle_bytes = sidecar->pending_bundle_bytes;
      sidecar->owned_program_bytes = 0u;
      sidecar->owned_generation = sidecar->pending_generation;
      sidecar->owned_is_v2 = 0u;
      sidecar->pending_bundle_bytes = 0u;
      sidecar->pending_generation = 0u;
      sidecar->pending_is_v2 = 0u;
      __atomic_store_n(&sidecar->switch_state, RV2_SWITCH_IDLE,
        __ATOMIC_RELEASE);
      __atomic_store_n(&sidecar->activation_observed, 1u,
        __ATOMIC_RELEASE);
    } else if (rv2_try_lock(&sidecar->runtime)) {
      sidecar->pending_runtime.queue_lock = 1u;
      rv2_copy(&sidecar->runtime, &sidecar->pending_runtime,
        (renderer_v2_u32)sizeof(RendererV2GenericRuntime));
      sidecar->owned_bundle_bytes = sidecar->pending_bundle_bytes;
      sidecar->owned_generation = sidecar->pending_generation;
      sidecar->owned_is_v2 = 1u;
      sidecar->pending_bundle_bytes = 0u;
      sidecar->pending_generation = 0u;
      sidecar->pending_is_v2 = 0u;
      __atomic_store_n(&sidecar->switch_state, RV2_SWITCH_IDLE,
        __ATOMIC_RELEASE);
      rv2_unlock(&sidecar->runtime);
      __atomic_store_n(&sidecar->admitted, 1u, __ATOMIC_RELEASE);
      __atomic_store_n(&sidecar->activation_observed, 1u,
        __ATOMIC_RELEASE);
    }
  }
  if (rv2_owned_active_identity(sidecar, controller) &&
      __atomic_load_n(&sidecar->switch_state, __ATOMIC_ACQUIRE) ==
        RV2_SWITCH_IDLE)
    __atomic_store_n(&sidecar->activation_observed, 1u, __ATOMIC_RELEASE);
  if (!rv2_active_identity(sidecar, controller)) {
    if (__atomic_load_n(&sidecar->admitted, __ATOMIC_ACQUIRE) != 0u)
      rv2_gate_close(sidecar);
    return;
  }
  if (__atomic_load_n(&sidecar->admitted, __ATOMIC_ACQUIRE) == 0u &&
      sidecar->runtime.program == sidecar->owned_program &&
      sidecar->runtime.program_bytes == sidecar->owned_program_bytes &&
      __atomic_load_n(&sidecar->switch_state, __ATOMIC_ACQUIRE) ==
        RV2_SWITCH_IDLE)
    __atomic_store_n(&sidecar->admitted, 1u, __ATOMIC_RELEASE);
  result = renderer_v2_generic_ui_tick(&sidecar->runtime,
    rv2_ctl_framebuffer(controller), 1u);
#ifndef RENDERER_V2_HOST_TEST
  if (result.rendered != 0u) {
    renderer_v2_u8 *bytes = (renderer_v2_u8 *)controller;
    void *image = *(void **)(bytes + 60u);
    if (image != (void *)0)
      RV2_FN_IMAGE_SET_SRC(image, bytes + 68u +
        (*(renderer_v2_u32 *)(bytes + 56u) & 1u) * 24u);
  }
#else
  (void)result;
#endif
}

static void renderer_v2_generic_live_encoder(void *controller,
    renderer_v2_u32 encoder, renderer_v2_u32 raw_delta) {
  void **vtable = rv2_ctl_vtable(controller);
  RendererV2GenericSidecar *sidecar =
    (RendererV2GenericSidecar *)vtable[11];
  renderer_v2_u32 available = 0u, pressed = 0u, result, epoch;
  renderer_v2_s32 delta =
    (renderer_v2_s32)(signed char)(renderer_v2_u8)raw_delta;
  if (sidecar == (RendererV2GenericSidecar *)0 ||
      sidecar->magic != RV2_LIVE_MAGIC) return;
  if (__atomic_load_n(&sidecar->admitted, __ATOMIC_ACQUIRE) == 0u) {
    sidecar->old_encoder(controller, encoder, raw_delta); return;
  }
  epoch = __atomic_load_n(&sidecar->epoch, __ATOMIC_ACQUIRE);
#ifdef RENDERER_V2_HOST_TEST
  (void)available; (void)pressed; (void)epoch; (void)delta;
  result = RENDERER_V2_INPUT_FALLBACK;
#else
  {
    void *input = RV2_FN_INPUT_GET(); available = input != (void *)0;
    pressed = available ?
      (renderer_v2_u32)(RV2_FN_FN_PRESSED(input) != 0) : 0u;
  }
  result = RENDERER_V2_INPUT_CONSUMED;
  if (encoder != RV2_BOTTOM_ENCODER || delta == 0 || pressed == 0u ||
      available == 0u) result = RENDERER_V2_INPUT_FALLBACK;
  else if (rv2_enqueue_guarded(&sidecar->runtime, RV2_EVENT_FN_KNOB, 1u,
      encoder, delta, &sidecar->admitted, &sidecar->epoch, epoch, 1u))
    result |= RENDERER_V2_INPUT_ENQUEUED;
#endif
  if ((result & RENDERER_V2_INPUT_CONSUMED) == 0u)
    sidecar->old_encoder(controller, encoder, raw_delta);
}

static RendererV2GenericSidecar *rv2_installed_sidecar(void *controller) {
  void **vtable; RendererV2GenericSidecar *sidecar;
  if (controller == (void *)0) return (RendererV2GenericSidecar *)0;
  vtable = rv2_ctl_vtable(controller);
  if (vtable == (void **)0 ||
      vtable[6] != (void *)renderer_v2_generic_live_tick ||
      vtable[9] != (void *)renderer_v2_generic_live_encoder)
    return (RendererV2GenericSidecar *)0;
  sidecar = (RendererV2GenericSidecar *)vtable[11];
  return sidecar != (RendererV2GenericSidecar *)0 &&
    sidecar->magic == RV2_LIVE_MAGIC ? sidecar :
    (RendererV2GenericSidecar *)0;
}

RV2_EXPORT void *renderer_v2_native_attach(void *setup_owner, void *registry,
    void *controller, const renderer_v2_u8 *boot_program,
    renderer_v2_u32 boot_program_bytes) {
  RendererV2GenericSidecar *sidecar;
  (void)setup_owner; (void)registry; (void)boot_program; (void)boot_program_bytes;
  sidecar = rv2_installed_sidecar(controller);
  if (sidecar != (RendererV2GenericSidecar *)0) return sidecar;
  if (controller == (void *)0 || !rv2_is_data(controller, 4u)) return (void *)0;
#ifdef RENDERER_V2_HOST_TEST
  return (void *)0;
#else
  {
    void **old_vtable; renderer_v2_u32 i;
    sidecar = (RendererV2GenericSidecar *)RV2_FN_NEW(
      (renderer_v2_u32)sizeof(RendererV2GenericSidecar));
    if (sidecar == (RendererV2GenericSidecar *)0) return (void *)0;
    rv2_zero(sidecar, (renderer_v2_u32)sizeof(*sidecar));
    sidecar->owned_bundle = (renderer_v2_u8 *)RV2_FN_NEW(
      RENDERER_V2_GENERIC_MAX_F1WB_BYTES);
    sidecar->owned_program = (renderer_v2_u8 *)RV2_FN_NEW(
      RENDERER_V2_GENERIC_MAX_F2EP_BYTES);
    if (sidecar->owned_bundle == (renderer_v2_u8 *)0 ||
        sidecar->owned_program == (renderer_v2_u8 *)0) return (void *)0;
    old_vtable = rv2_ctl_vtable(controller);
    if (old_vtable == (void **)0 || old_vtable[6] == (void *)0 ||
        old_vtable[9] == (void *)0) return (void *)0;
    sidecar->old_tick = (RendererV2OldTick)old_vtable[6];
    sidecar->old_encoder = (RendererV2OldEncoder)old_vtable[9];
    for (i = 0u; i < 11u; i++) sidecar->vtable[i] = old_vtable[i];
    sidecar->vtable[6] = (void *)renderer_v2_generic_live_tick;
    sidecar->vtable[9] = (void *)renderer_v2_generic_live_encoder;
    sidecar->vtable[11] = sidecar; sidecar->magic = RV2_LIVE_MAGIC;
    rv2_barrier(); rv2_ctl_set_vtable(controller, sidecar->vtable); rv2_barrier();
    return sidecar;
  }
#endif
}

RV2_EXPORT renderer_v2_u32 renderer_v2_native_begin_upload(void *controller) {
  RendererV2GenericSidecar *sidecar = rv2_installed_sidecar(controller);
  renderer_v2_u32 expected, upload;
  if (sidecar == (RendererV2GenericSidecar *)0) return RENDERER_V2_UPDATE_REJECTED;
  upload = __atomic_load_n(&sidecar->upload_state, __ATOMIC_ACQUIRE);
  if (upload == RV2_UPLOAD_WRITING) return RENDERER_V2_UPDATE_REJECTED;
  if (upload == RV2_UPLOAD_DETACHING) {
    if (__atomic_load_n(&sidecar->program_detached, __ATOMIC_ACQUIRE) == 0u)
      return RENDERER_V2_UPDATE_BUSY;
    __atomic_store_n(&sidecar->activation_observed, 0u, __ATOMIC_RELEASE);
    __atomic_store_n(&sidecar->upload_state, RV2_UPLOAD_WRITING,
      __ATOMIC_RELEASE);
    return RENDERER_V2_UPDATE_READY;
  }
  /* Commit is only an RPC-task acknowledgement.  The UI task still owns the
   * pending base/program pair until its next tick performs the generation-
   * paired swap.  Never let a second begin overwrite those bytes in the
   * commit-ACK -> UI-tick window.  Likewise, an installed generation must
   * have been observed and admitted by the UI task before it can be detached
   * for replacement. */
  if (__atomic_load_n(&sidecar->switch_state, __ATOMIC_ACQUIRE) !=
        RV2_SWITCH_IDLE || sidecar->pending_generation != 0u)
    return RENDERER_V2_UPDATE_BUSY;
  if (sidecar->owned_valid != 0u && sidecar->owned_generation != 0u &&
      (__atomic_load_n(&sidecar->activation_observed, __ATOMIC_ACQUIRE) == 0u ||
       !rv2_owned_active_identity(sidecar, controller) ||
       (sidecar->owned_is_v2 != 0u &&
        __atomic_load_n(&sidecar->admitted, __ATOMIC_ACQUIRE) == 0u)))
    return RENDERER_V2_UPDATE_BUSY;
  expected = RV2_UPLOAD_IDLE;
  if (!__atomic_compare_exchange_n(&sidecar->upload_state, &expected,
      RV2_UPLOAD_WRITING, 0, __ATOMIC_ACQ_REL, __ATOMIC_ACQUIRE))
    return RENDERER_V2_UPDATE_REJECTED;
  __atomic_store_n(&sidecar->copy_started, 0u, __ATOMIC_RELEASE);
  if (sidecar->owned_valid != 0u &&
      rv2_ctl_active(controller) == sidecar->owned_bundle) {
    /* Stop both native producers before publishing the detach request.  The
     * UI tick repeats this close/drain before acknowledging reusable bytes. */
    rv2_gate_close(sidecar);
    __atomic_store_n(&sidecar->upload_state, RV2_UPLOAD_DETACHING,
      __ATOMIC_RELEASE);
    __atomic_store_n(&sidecar->program_detached, 0u, __ATOMIC_RELEASE);
    __atomic_store_n(&sidecar->detach_requested, 1u, __ATOMIC_RELEASE);
    (void)renderer_v1_prepare_store(controller, sidecar->owned_bundle);
    return RENDERER_V2_UPDATE_BUSY;
  }
  return RENDERER_V2_UPDATE_READY;
}

RV2_EXPORT renderer_v2_u32 renderer_v2_native_prepare(void *controller,
    const renderer_v2_u8 *package, renderer_v2_u32 package_bytes,
    renderer_v2_u32 generation) {
  RendererV2GenericSidecar *sidecar = rv2_installed_sidecar(controller);
  const renderer_v2_u8 *program = (const renderer_v2_u8 *)0;
  renderer_v2_u32 bundle_bytes, program_bytes = 0u, is_v2 = 0u;
  if (sidecar == (RendererV2GenericSidecar *)0 ||
      __atomic_load_n(&sidecar->upload_state, __ATOMIC_ACQUIRE) !=
        RV2_UPLOAD_WRITING || package == (const renderer_v2_u8 *)0 ||
      package_bytes < 20u ||
      package_bytes > RENDERER_V2_GENERIC_MAX_TRANSPORT_BYTES ||
      !rv2_is_data(package, package_bytes) ||
      rv2_rd32(package + 8u) != generation) return 0u;
  bundle_bytes = rv2_rd32(package + 12u);
  if (bundle_bytes < 20u || bundle_bytes > package_bytes) return 0u;
  if (bundle_bytes == package_bytes) {
    if (!renderer_v1_validate_generic_bundle(package, bundle_bytes, generation))
      return 0u;
    rv2_zero(&sidecar->pending_runtime,
      (renderer_v2_u32)sizeof(RendererV2GenericRuntime));
  } else {
    is_v2 = 1u;
    program = package + bundle_bytes;
    program_bytes = package_bytes - bundle_bytes;
    if (bundle_bytes != RENDERER_V2_GENERIC_F1WB_BYTES ||
        package_bytes > RENDERER_V2_GENERIC_MAX_PACKAGE_BYTES ||
        program_bytes < RV2_HEADER_BYTES ||
        program_bytes > RENDERER_V2_GENERIC_MAX_F2EP_BYTES ||
        rv2_rd32(program + 12u) != program_bytes ||
        !renderer_v1_validate_generic_base(package, bundle_bytes, generation) ||
        !renderer_v2_generic_runtime_init(&sidecar->pending_runtime,
          program, program_bytes)) return 0u;
  }
  /* Both consumers are detached before this release becomes visible.  From
   * here onward abort must fail closed: the old owned bytes may be gone. */
  __atomic_store_n(&sidecar->copy_started, 1u, __ATOMIC_RELEASE);
  __atomic_store_n(&sidecar->activation_observed, 0u, __ATOMIC_RELEASE);
  sidecar->owned_valid = 0u; rv2_barrier();
  rv2_copy(sidecar->owned_bundle, package, bundle_bytes);
  if (is_v2 != 0u) {
    rv2_copy(sidecar->owned_program, program, program_bytes);
    if (!renderer_v2_generic_runtime_init(&sidecar->pending_runtime,
        sidecar->owned_program, program_bytes)) return 0u;
  }
  sidecar->owned_program_bytes = program_bytes;
  sidecar->pending_bundle_bytes = bundle_bytes;
  sidecar->pending_generation = generation;
  sidecar->pending_is_v2 = is_v2;
  sidecar->owned_valid = 1u; rv2_barrier();
  __atomic_store_n(&sidecar->switch_state, RV2_SWITCH_PREPARED,
    __ATOMIC_RELEASE);
  return 1u;
}

RV2_EXPORT renderer_v2_u32 renderer_v2_native_stage(void *controller) {
  RendererV2GenericSidecar *sidecar = rv2_installed_sidecar(controller);
  renderer_v2_u32 expected = RV2_SWITCH_PREPARED;
  if (sidecar == (RendererV2GenericSidecar *)0 || sidecar->owned_valid == 0u ||
      !renderer_v1_stage_bundle(controller, sidecar->owned_bundle,
        sidecar->pending_bundle_bytes)) return 0u;
  return __atomic_compare_exchange_n(&sidecar->switch_state, &expected,
    RV2_SWITCH_STAGED, 0, __ATOMIC_ACQ_REL, __ATOMIC_ACQUIRE);
}

RV2_EXPORT renderer_v2_u32 renderer_v2_native_commit(void *controller) {
  RendererV2GenericSidecar *sidecar = rv2_installed_sidecar(controller);
  renderer_v2_u32 expected = RV2_SWITCH_STAGED;
  if (sidecar == (RendererV2GenericSidecar *)0) return 0u;
  if (!__atomic_compare_exchange_n(&sidecar->switch_state, &expected,
      RV2_SWITCH_COMMITTED, 0, __ATOMIC_ACQ_REL, __ATOMIC_ACQUIRE)) return 0u;
  __atomic_store_n(&sidecar->detach_requested, 0u, __ATOMIC_RELEASE);
  __atomic_store_n(&sidecar->program_detached, 0u, __ATOMIC_RELEASE);
  __atomic_store_n(&sidecar->copy_started, 0u, __ATOMIC_RELEASE);
  __atomic_store_n(&sidecar->upload_state, RV2_UPLOAD_IDLE, __ATOMIC_RELEASE);
  return 1u;
}

RV2_EXPORT renderer_v2_u32 renderer_v2_native_cancel(void *controller) {
  RendererV2GenericSidecar *sidecar = rv2_installed_sidecar(controller);
  renderer_v2_u32 state;
  if (sidecar == (RendererV2GenericSidecar *)0) return 0u;
  state = __atomic_load_n(&sidecar->switch_state, __ATOMIC_ACQUIRE);
  if (state == RV2_SWITCH_STAGED || state == RV2_SWITCH_COMMITTED) return 0u;
  if (__atomic_load_n(&sidecar->copy_started, __ATOMIC_ACQUIRE) != 0u)
    sidecar->owned_valid = 0u;
  rv2_zero(&sidecar->pending_runtime,
    (renderer_v2_u32)sizeof(RendererV2GenericRuntime));
  sidecar->pending_bundle_bytes = 0u;
  sidecar->pending_generation = 0u;
  sidecar->pending_is_v2 = 0u;
  __atomic_store_n(&sidecar->switch_state, RV2_SWITCH_IDLE, __ATOMIC_RELEASE);
  return 1u;
}

RV2_EXPORT renderer_v2_u32 renderer_v2_native_abort_upload(void *controller) {
  RendererV2GenericSidecar *sidecar = rv2_installed_sidecar(controller);
  renderer_v2_u32 can_resume;
  if (sidecar == (RendererV2GenericSidecar *)0) return 0u;
  can_resume = __atomic_load_n(&sidecar->copy_started, __ATOMIC_ACQUIRE) == 0u &&
    sidecar->owned_valid != 0u && sidecar->owned_generation != 0u;
  (void)renderer_v2_native_cancel(controller);
  if (can_resume != 0u &&
      rv2_ctl_active(controller) == (const renderer_v2_u8 *)0) {
    if (!renderer_v1_stage_bundle(controller, sidecar->owned_bundle,
        sidecar->owned_bundle_bytes)) can_resume = 0u;
  }
  if (can_resume != 0u)
    __atomic_store_n(&sidecar->activation_observed, 0u, __ATOMIC_RELEASE);
  __atomic_store_n(&sidecar->detach_requested, 0u, __ATOMIC_RELEASE);
  __atomic_store_n(&sidecar->program_detached, 0u, __ATOMIC_RELEASE);
  __atomic_store_n(&sidecar->copy_started, 0u, __ATOMIC_RELEASE);
  __atomic_store_n(&sidecar->upload_state, RV2_UPLOAD_IDLE, __ATOMIC_RELEASE);
  return can_resume != 0u || sidecar->owned_generation == 0u;
}

RV2_EXPORT renderer_v2_u32 renderer_v2_native_host_event(void *controller,
    renderer_v2_u16 event_id, renderer_v2_s32 value) {
  RendererV2GenericSidecar *sidecar = rv2_installed_sidecar(controller);
  renderer_v2_u32 epoch;
  if (sidecar == (RendererV2GenericSidecar *)0 || event_id == 0u ||
      __atomic_load_n(&sidecar->admitted, __ATOMIC_ACQUIRE) == 0u)
    return 0u;
  epoch = __atomic_load_n(&sidecar->epoch, __ATOMIC_ACQUIRE);
  return rv2_enqueue_guarded(&sidecar->runtime, RV2_EVENT_HOST, 0u,
    event_id, value, &sidecar->admitted, &sidecar->epoch, epoch, 1u);
}

#ifdef RENDERER_V2_HOST_TEST
renderer_v2_u32 renderer_v2_generic_host_admit_structure(
    const renderer_v2_u8 *program, renderer_v2_u32 program_bytes) {
  RendererV2GenericRuntime runtime;
  rv2_zero(&runtime, (renderer_v2_u32)sizeof(runtime));
  return rv2_admit(&runtime, program, program_bytes) == RV2_ERROR_NONE;
}
#endif
