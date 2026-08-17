/*
 * Native F2EP v1 admission, bounded event VM, RGB565 patcher, and renderer-v1
 * ID26 sidecar hook for the Framer F1 (ESP32-S3).
 *
 * This module intentionally does not contain or overwrite Music/WPM assets.
 * It owns no framebuffer: renderer-v1's existing 100x310 RGB565 buffer is
 * borrowed on the UI thread.  The exact accepted program is the authored demo
 * artifact (9536 bytes, SHA-256 af34f7f9...60469b08).
 */
#include "renderer-v2-f2ep-native.h"

typedef unsigned long renderer_v2_uptr;
typedef unsigned long long renderer_v2_u64;

#define RV2_MAGIC 0x32565246u
#define RV2_F2EP_MAGIC 0x50453246u
#define RV2_LIVE_MAGIC 0x32565343u
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

#define RV2_FIELD_NONE 0u
#define RV2_FIELD_VALUE 1u
#define RV2_FIELD_ID 2u
#define RV2_FIELD_SEQUENCE 3u
#define RV2_FIELD_FLAGS 4u

#define RV2_ERROR_NONE 0u
#define RV2_ERROR_ARGUMENT 1u
#define RV2_ERROR_STRUCTURE 2u
#define RV2_ERROR_DIGEST 3u
#define RV2_ERROR_VM 4u
#define RV2_ERROR_PATCH 5u
#define RV2_ERROR_BASE 6u

#ifdef RENDERER_V2_HOST_TEST
#define RV2_EXPORT
#define RV2_USED
#else
#define RV2_EXPORT __attribute__((section(".text.renderer_v2"), used, visibility("default")))
#define RV2_USED __attribute__((section(".text.renderer_v2"), used))
#endif

#ifndef RENDERER_V2_HOST_TEST
#define RV2_FN_NEW ((void *(*)(renderer_v2_u32))(renderer_v2_uptr)0x420e7c04u)
#define RV2_FN_IMAGE_SET_SRC ((void (*)(void *, const void *))(renderer_v2_uptr)0x420aeef0u)
#define RV2_FN_INPUT_GET ((void *(*)(void))(renderer_v2_uptr)0x4200c4c0u)
#define RV2_FN_FN_PRESSED ((renderer_v2_s32 (*)(void *))(renderer_v2_uptr)0x4210bfacu)
#endif

static renderer_v2_u16 rv2_rd16(const renderer_v2_u8 *p) {
  return (renderer_v2_u16)((renderer_v2_u16)p[0] | ((renderer_v2_u16)p[1] << 8));
}
static renderer_v2_u32 rv2_rd32(const renderer_v2_u8 *p) {
  return (renderer_v2_u32)p[0] | ((renderer_v2_u32)p[1] << 8) |
    ((renderer_v2_u32)p[2] << 16) | ((renderer_v2_u32)p[3] << 24);
}
static renderer_v2_u32 rv2_be32(const renderer_v2_u8 *p) {
  return ((renderer_v2_u32)p[0] << 24) | ((renderer_v2_u32)p[1] << 16) |
    ((renderer_v2_u32)p[2] << 8) | (renderer_v2_u32)p[3];
}
static void rv2_zero(void *value, renderer_v2_u32 bytes) {
  renderer_v2_u8 *p = (renderer_v2_u8 *)value;
  while (bytes-- != 0u) *p++ = 0u;
}
static void rv2_copy(void *destination, const void *source, renderer_v2_u32 bytes) {
  renderer_v2_u8 *d = (renderer_v2_u8 *)destination;
  const renderer_v2_u8 *s = (const renderer_v2_u8 *)source;
  while (bytes-- != 0u) *d++ = *s++;
}
#ifndef RENDERER_V2_HOST_TEST
/* Xtensa GCC may lower ABI structure returns/copies to memcpy even under
 * -ffreestanding -fno-builtin.  Keep a weak module-local implementation: it
 * resolves standalone, while renderer-v1's audited strong definition wins if
 * both sources are linked together. */
RV2_USED __attribute__((weak))
void *memcpy(void *destination, const void *source, renderer_v2_u32 bytes) {
  rv2_copy(destination, source, bytes); return destination;
}
#endif
static renderer_v2_u32 rv2_range(renderer_v2_u32 offset, renderer_v2_u32 bytes,
    renderer_v2_u32 total) {
  return offset <= total && bytes <= total - offset;
}
static renderer_v2_u32 rv2_align4(renderer_v2_u32 value) { return (value + 3u) & ~3u; }
static renderer_v2_u32 rv2_zero_range(const renderer_v2_u8 *p, renderer_v2_u32 bytes) {
  while (bytes-- != 0u) if (*p++ != 0u) return 0u;
  return 1u;
}
#ifdef RENDERER_V2_HOST_TEST
static renderer_v2_u32 rv2_is_data(const void *value, renderer_v2_u32 bytes) {
  return value != (const void *)0 && bytes != 0u;
}
#else
static void rv2_barrier(void) { __asm__ __volatile__("memw" ::: "memory"); }
static renderer_v2_u32 rv2_is_data(const void *value, renderer_v2_u32 bytes) {
  renderer_v2_uptr start = (renderer_v2_uptr)value;
  renderer_v2_uptr end = start + (renderer_v2_uptr)bytes;
  return start >= (renderer_v2_uptr)0x3c000000u && start < (renderer_v2_uptr)0x40000000u &&
    end >= start && end <= (renderer_v2_uptr)0x40000000u;
}
#endif

/* Local SHA-256 avoids any unproven ROM/SDK helper ABI. */
static renderer_v2_u32 rv2_rotr(renderer_v2_u32 x, renderer_v2_u32 n) {
  return (x >> n) | (x << (32u - n));
}
static renderer_v2_u32 rv2_sha_k(renderer_v2_u32 i) {
  switch (i) {
    case 0: return 0x428a2f98u; case 1: return 0x71374491u;
    case 2: return 0xb5c0fbcfu; case 3: return 0xe9b5dba5u;
    case 4: return 0x3956c25bu; case 5: return 0x59f111f1u;
    case 6: return 0x923f82a4u; case 7: return 0xab1c5ed5u;
    case 8: return 0xd807aa98u; case 9: return 0x12835b01u;
    case 10: return 0x243185beu; case 11: return 0x550c7dc3u;
    case 12: return 0x72be5d74u; case 13: return 0x80deb1feu;
    case 14: return 0x9bdc06a7u; case 15: return 0xc19bf174u;
    case 16: return 0xe49b69c1u; case 17: return 0xefbe4786u;
    case 18: return 0x0fc19dc6u; case 19: return 0x240ca1ccu;
    case 20: return 0x2de92c6fu; case 21: return 0x4a7484aau;
    case 22: return 0x5cb0a9dcu; case 23: return 0x76f988dau;
    case 24: return 0x983e5152u; case 25: return 0xa831c66du;
    case 26: return 0xb00327c8u; case 27: return 0xbf597fc7u;
    case 28: return 0xc6e00bf3u; case 29: return 0xd5a79147u;
    case 30: return 0x06ca6351u; case 31: return 0x14292967u;
    case 32: return 0x27b70a85u; case 33: return 0x2e1b2138u;
    case 34: return 0x4d2c6dfcu; case 35: return 0x53380d13u;
    case 36: return 0x650a7354u; case 37: return 0x766a0abbu;
    case 38: return 0x81c2c92eu; case 39: return 0x92722c85u;
    case 40: return 0xa2bfe8a1u; case 41: return 0xa81a664bu;
    case 42: return 0xc24b8b70u; case 43: return 0xc76c51a3u;
    case 44: return 0xd192e819u; case 45: return 0xd6990624u;
    case 46: return 0xf40e3585u; case 47: return 0x106aa070u;
    case 48: return 0x19a4c116u; case 49: return 0x1e376c08u;
    case 50: return 0x2748774cu; case 51: return 0x34b0bcb5u;
    case 52: return 0x391c0cb3u; case 53: return 0x4ed8aa4au;
    case 54: return 0x5b9cca4fu; case 55: return 0x682e6ff3u;
    case 56: return 0x748f82eeu; case 57: return 0x78a5636fu;
    case 58: return 0x84c87814u; case 59: return 0x8cc70208u;
    case 60: return 0x90befffau; case 61: return 0xa4506cebu;
    case 62: return 0xbef9a3f7u; default: return 0xc67178f2u;
  }
}
static void rv2_sha_transform(renderer_v2_u32 h[8], const renderer_v2_u8 block[64]) {
  renderer_v2_u32 w[64], i;
  for (i = 0u; i < 16u; i++) w[i] = rv2_be32(block + i * 4u);
  for (; i < 64u; i++) {
    renderer_v2_u32 x = w[i - 15u], y = w[i - 2u];
    renderer_v2_u32 s0 = rv2_rotr(x, 7u) ^ rv2_rotr(x, 18u) ^ (x >> 3);
    renderer_v2_u32 s1 = rv2_rotr(y, 17u) ^ rv2_rotr(y, 19u) ^ (y >> 10);
    w[i] = w[i - 16u] + s0 + w[i - 7u] + s1;
  }
  renderer_v2_u32 a = h[0], b = h[1], c = h[2], d = h[3];
  renderer_v2_u32 e = h[4], f = h[5], g = h[6], hh = h[7];
  for (i = 0u; i < 64u; i++) {
    renderer_v2_u32 s1 = rv2_rotr(e, 6u) ^ rv2_rotr(e, 11u) ^ rv2_rotr(e, 25u);
    renderer_v2_u32 choice = (e & f) ^ (~e & g);
    renderer_v2_u32 t1 = hh + s1 + choice + rv2_sha_k(i) + w[i];
    renderer_v2_u32 s0 = rv2_rotr(a, 2u) ^ rv2_rotr(a, 13u) ^ rv2_rotr(a, 22u);
    renderer_v2_u32 majority = (a & b) ^ (a & c) ^ (b & c);
    renderer_v2_u32 t2 = s0 + majority;
    hh = g; g = f; f = e; e = d + t1; d = c; c = b; b = a; a = t1 + t2;
  }
  h[0] += a; h[1] += b; h[2] += c; h[3] += d;
  h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
}
static renderer_v2_u32 rv2_sha_is_frozen(const renderer_v2_u8 *data, renderer_v2_u32 bytes) {
  renderer_v2_u32 h[8], i, blocks = bytes / 64u, remainder, tail_bytes;
  renderer_v2_u8 tail[128]; renderer_v2_u64 bits;
  h[0] = 0x6a09e667u; h[1] = 0xbb67ae85u; h[2] = 0x3c6ef372u; h[3] = 0xa54ff53au;
  h[4] = 0x510e527fu; h[5] = 0x9b05688cu; h[6] = 0x1f83d9abu; h[7] = 0x5be0cd19u;
  for (i = 0u; i < blocks; i++) rv2_sha_transform(h, data + i * 64u);
  remainder = bytes - blocks * 64u; tail_bytes = remainder < 56u ? 64u : 128u;
  rv2_zero(tail, tail_bytes); rv2_copy(tail, data + blocks * 64u, remainder); tail[remainder] = 0x80u;
  bits = (renderer_v2_u64)bytes * 8u;
  for (i = 0u; i < 8u; i++) tail[tail_bytes - 1u - i] = (renderer_v2_u8)(bits >> (i * 8u));
  rv2_sha_transform(h, tail); if (tail_bytes == 128u) rv2_sha_transform(h, tail + 64u);
  return h[0] == 0xaf34f7f9u && h[1] == 0x8587d319u && h[2] == 0x29799e32u &&
    h[3] == 0x18beb475u && h[4] == 0x82a0ec79u && h[5] == 0x6085f4d3u &&
    h[6] == 0x6859d37au && h[7] == 0x60469b08u;
}

static renderer_v2_u32 rv2_padding_zero(const renderer_v2_u8 *p,
    renderer_v2_u32 from, renderer_v2_u32 to) {
  return from <= to && rv2_zero_range(p + from, to - from);
}

/* Complete structural admission happens before the SHA pin so corrupt/fuzzed
 * nested records never reach the runtime even if the pin policy changes. */
static renderer_v2_u32 rv2_admit(RendererV2Runtime *r, const renderer_v2_u8 *p,
    renderer_v2_u32 bytes, renderer_v2_u32 require_frozen_sha) {
  renderer_v2_u32 i, j, cursor, prior_end, blob_end;
  if (r == (RendererV2Runtime *)0 || p == (const renderer_v2_u8 *)0 ||
      bytes != RENDERER_V2_F2EP_BYTES || rv2_rd32(p) != RV2_F2EP_MAGIC || p[4] != 1u ||
      p[5] == 0u || p[5] > RENDERER_V2_STATE_SLOTS || p[6] == 0u || p[6] > RV2_MAX_HANDLERS ||
      p[7] == 0u || p[7] > RV2_MAX_PATCH_SETS || rv2_rd16(p + 8) == 0u ||
      rv2_rd16(p + 8) > RV2_MAX_BINDINGS || rv2_rd16(p + 10) == 0u ||
      rv2_rd16(p + 10) > RV2_MAX_VARIANTS || rv2_rd32(p + 12) != bytes ||
      rv2_rd32(p + 52) > RV2_MAX_SPANS || rv2_rd32(p + 56) > RV2_MAX_PATCH_BYTES ||
      rv2_rd32(p + 60) != 0u) return RV2_ERROR_STRUCTURE;

  r->state_count = p[5]; r->handler_count = p[6]; r->patch_set_count = p[7];
  r->binding_count = rv2_rd16(p + 8); r->variant_count = rv2_rd16(p + 10);
  for (i = 0u; i < 8u; i++) r->section[i] = rv2_rd32(p + 16u + i * 4u);
  r->bytecode_bytes = rv2_rd32(p + 48); r->span_count = rv2_rd32(p + 52);
  r->patch_bytes = rv2_rd32(p + 56);

  /* The encoder's canonical layout is part of F2EP v1. */
  cursor = RV2_HEADER_BYTES;
#define RV2_SECTION(index, amount) do { \
  cursor = rv2_align4(cursor); \
  if (r->section[(index)] != cursor || !rv2_range(cursor, (amount), bytes)) return RV2_ERROR_STRUCTURE; \
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
  if (cursor != bytes || (r->patch_bytes & 1u) != 0u || (r->bytecode_bytes & 7u) != 0u)
    return RV2_ERROR_STRUCTURE;

  /* Handler records, unique match keys, and canonical bytecode coverage. */
  cursor = 0u;
  for (i = 0u; i < r->handler_count; i++) {
    const renderer_v2_u8 *h = p + r->section[1] + i * RV2_HANDLER_BYTES;
    renderer_v2_u32 kind = h[0], match = rv2_rd16(h + 2), start = rv2_rd32(h + 4);
    renderer_v2_u32 count = rv2_rd16(h + 8);
    if (kind < RV2_EVENT_TICK100 || kind > RV2_EVENT_HOST || h[1] != 0u ||
        rv2_rd16(h + 10) != 0u || start != cursor || count == 0u || count > 64u ||
        !rv2_range(start, count * RV2_INSTRUCTION_BYTES, r->bytecode_bytes) ||
        ((kind == RV2_EVENT_FN_KNOB && match != RV2_BOTTOM_ENCODER) ||
         ((kind == RV2_EVENT_TICK100 || kind == RV2_EVENT_TICK1) && match != 0u)))
      return RV2_ERROR_STRUCTURE;
    for (j = 0u; j < i; j++) {
      const renderer_v2_u8 *prior = p + r->section[1] + j * RV2_HANDLER_BYTES;
      if (prior[0] == kind && rv2_rd16(prior + 2) == match) return RV2_ERROR_STRUCTURE;
    }
    for (j = 0u; j < count; j++) {
      const renderer_v2_u8 *op = p + r->section[2] + start + j * RV2_INSTRUCTION_BYTES;
      renderer_v2_u32 code = op[0], field = op[2];
      renderer_v2_s32 immediate = (renderer_v2_s32)rv2_rd32(op + 4);
      if (code > RV2_OP_CLAMP_MAX || op[1] >= r->state_count || op[3] != 0u)
        return RV2_ERROR_STRUCTURE;
      if (code == RV2_OP_HALT) {
        if (j + 1u != count || op[1] != 0u || field != 0u || immediate != 0)
          return RV2_ERROR_STRUCTURE;
      } else if (j + 1u == count) return RV2_ERROR_STRUCTURE;
      else if (code == RV2_OP_LOAD_EVENT || code == RV2_OP_ADD_EVENT) {
        if (field < RV2_FIELD_VALUE || field > RV2_FIELD_FLAGS || immediate != 0)
          return RV2_ERROR_STRUCTURE;
      } else if (field != RV2_FIELD_NONE || (code == RV2_OP_MOD_POSITIVE && immediate <= 0))
        return RV2_ERROR_STRUCTURE;
    }
    cursor += count * RV2_INSTRUCTION_BYTES;
  }
  if (cursor != r->bytecode_bytes) return RV2_ERROR_STRUCTURE;

  cursor = 0u;
  for (i = 0u; i < r->patch_set_count; i++) {
    const renderer_v2_u8 *set = p + r->section[3] + i * RV2_PATCH_SET_BYTES;
    renderer_v2_u32 start = rv2_rd16(set), count = rv2_rd16(set + 2);
    if (start != cursor || count == 0u || start + count > r->variant_count || rv2_rd32(set + 4) != 0u)
      return RV2_ERROR_STRUCTURE;
    cursor += count;
  }
  if (cursor != r->variant_count) return RV2_ERROR_STRUCTURE;

  cursor = 0u; blob_end = 0u;
  for (i = 0u; i < r->variant_count; i++) {
    const renderer_v2_u8 *variant = p + r->section[4] + i * RV2_VARIANT_BYTES;
    renderer_v2_u32 start = rv2_rd16(variant), count = rv2_rd16(variant + 2);
    if (start != cursor || count == 0u || start + count > r->span_count || rv2_rd32(variant + 4) != 0u)
      return RV2_ERROR_STRUCTURE;
    prior_end = 0u;
    for (j = 0u; j < count; j++) {
      const renderer_v2_u8 *span = p + r->section[5] + (start + j) * RV2_SPAN_BYTES;
      renderer_v2_u32 pixel = rv2_rd16(span), pixels = rv2_rd16(span + 2), blob = rv2_rd32(span + 4);
      if (pixels == 0u || pixel < prior_end || pixel > RENDERER_V2_FRAME_PIXELS ||
          pixels > RENDERER_V2_FRAME_PIXELS - pixel || blob != blob_end ||
          !rv2_range(blob, pixels * 2u, r->patch_bytes)) return RV2_ERROR_STRUCTURE;
      prior_end = pixel + pixels; blob_end += pixels * 2u;
    }
    cursor += count;
  }
  if (cursor != r->span_count || blob_end != r->patch_bytes) return RV2_ERROR_STRUCTURE;

  for (i = 0u; i < r->binding_count; i++) {
    const renderer_v2_u8 *binding = p + r->section[6] + i * RV2_BINDING_BYTES;
    renderer_v2_u32 state = binding[0], set_index = binding[1], divisor = rv2_rd32(binding + 4);
    renderer_v2_u32 modulo = rv2_rd16(binding + 8), origin = rv2_rd32(binding + 12);
    if (state >= r->state_count || set_index >= r->patch_set_count || rv2_rd16(binding + 2) != 0u ||
        divisor == 0u || modulo == 0u || rv2_rd16(binding + 10) != 0u ||
        origin >= RENDERER_V2_FRAME_PIXELS) return RV2_ERROR_STRUCTURE;
    const renderer_v2_u8 *set = p + r->section[3] + set_index * RV2_PATCH_SET_BYTES;
    renderer_v2_u32 set_start = rv2_rd16(set), set_count = rv2_rd16(set + 2);
    if (modulo > set_count) return RV2_ERROR_STRUCTURE;
    for (j = 0u; j < set_count; j++) {
      const renderer_v2_u8 *variant = p + r->section[4] + (set_start + j) * RV2_VARIANT_BYTES;
      renderer_v2_u32 k, span_start = rv2_rd16(variant), span_count = rv2_rd16(variant + 2);
      for (k = 0u; k < span_count; k++) {
        const renderer_v2_u8 *span = p + r->section[5] + (span_start + k) * RV2_SPAN_BYTES;
        renderer_v2_u32 pixel = rv2_rd16(span), pixels = rv2_rd16(span + 2);
        if (origin > RENDERER_V2_FRAME_PIXELS - pixel ||
            pixels > RENDERER_V2_FRAME_PIXELS - origin - pixel) return RV2_ERROR_STRUCTURE;
      }
    }
  }
  if (require_frozen_sha != 0u && !rv2_sha_is_frozen(p, bytes)) return RV2_ERROR_DIGEST;
  return RV2_ERROR_NONE;
}

RV2_EXPORT
renderer_v2_u32 renderer_v2_runtime_init(RendererV2Runtime *r,
    const renderer_v2_u8 *program, renderer_v2_u32 bytes) {
  renderer_v2_u32 error, i;
  if (r == (RendererV2Runtime *)0 || program == (const renderer_v2_u8 *)0) return 0u;
  rv2_zero(r, (renderer_v2_u32)sizeof(*r));
  if (!rv2_is_data(program, bytes)) { r->error = RV2_ERROR_ARGUMENT; return 0u; }
  error = rv2_admit(r, program, bytes, 1u);
  if (error != RV2_ERROR_NONE) { r->error = error; return 0u; }
  r->program = program; r->program_bytes = bytes;
  for (i = 0u; i < r->state_count; i++)
    r->state[i] = (renderer_v2_s32)rv2_rd32(program + r->section[0] + i * 4u);
  return 1u;
}

static renderer_v2_u32 rv2_try_lock(RendererV2Runtime *r) {
  renderer_v2_u32 expected = 0u;
  return __atomic_compare_exchange_n(&r->queue_lock, &expected, 1u, 0,
    __ATOMIC_ACQUIRE, __ATOMIC_RELAXED);
}
static void rv2_unlock(RendererV2Runtime *r) {
  __atomic_store_n(&r->queue_lock, 0u, __ATOMIC_RELEASE);
}
static renderer_v2_u32 rv2_has_handler(const RendererV2Runtime *r,
    renderer_v2_u32 kind, renderer_v2_u32 id) {
  renderer_v2_u32 i;
  for (i = 0u; i < r->handler_count; i++) {
    const renderer_v2_u8 *h = r->program + r->section[1] + i * RV2_HANDLER_BYTES;
    if (h[0] == kind && rv2_rd16(h + 2) == id) return 1u;
  }
  return 0u;
}
static renderer_v2_u32 rv2_enqueue(RendererV2Runtime *r, renderer_v2_u32 kind,
    renderer_v2_u32 flags, renderer_v2_u32 id, renderer_v2_s32 value) {
  RendererV2EventRecord *event;
  if (!rv2_try_lock(r)) return 0u;
  if (r->queue_count == RENDERER_V2_QUEUE_RECORDS) {
    r->rejected_events++; rv2_unlock(r); return 0u;
  }
  event = &r->queue[r->queue_tail]; event->kind = (renderer_v2_u8)kind;
  event->flags = (renderer_v2_u8)flags; event->id = (renderer_v2_u16)id;
  event->value = value; event->sequence = ++r->sequence; event->reserved = 0u;
  r->queue_tail = (renderer_v2_u8)((r->queue_tail + 1u) % RENDERER_V2_QUEUE_RECORDS);
  r->queue_count++; rv2_unlock(r); return 1u;
}

RV2_EXPORT
renderer_v2_u32 renderer_v2_enqueue_fn_bottom(RendererV2Runtime *r,
    renderer_v2_u32 encoder_id, renderer_v2_u32 raw_delta,
    renderer_v2_u32 fn_pressed, renderer_v2_u32 input_available) {
  renderer_v2_s32 delta = (renderer_v2_s32)(signed char)(renderer_v2_u8)raw_delta;
  renderer_v2_u32 result = RENDERER_V2_INPUT_CONSUMED;
  if (r == (RendererV2Runtime *)0 || r->program == (const renderer_v2_u8 *)0 ||
      encoder_id != RV2_BOTTOM_ENCODER || delta == 0 || fn_pressed == 0u || input_available == 0u ||
      !rv2_has_handler(r, RV2_EVENT_FN_KNOB, RV2_BOTTOM_ENCODER)) return RENDERER_V2_INPUT_FALLBACK;
  if (rv2_enqueue(r, RV2_EVENT_FN_KNOB, 1u, encoder_id, delta)) result |= RENDERER_V2_INPUT_ENQUEUED;
  return result;
}

RV2_EXPORT
renderer_v2_u32 renderer_v2_enqueue_host(RendererV2Runtime *r,
    renderer_v2_u16 event_id, renderer_v2_s32 value) {
  if (r == (RendererV2Runtime *)0 || r->program == (const renderer_v2_u8 *)0 ||
      !rv2_has_handler(r, RV2_EVENT_HOST, event_id)) return 0u;
  return rv2_enqueue(r, RV2_EVENT_HOST, 0u, event_id, value);
}

static renderer_v2_s32 rv2_event_field(renderer_v2_u32 field,
    const RendererV2EventRecord *event) {
  if (field == RV2_FIELD_VALUE) return event->value;
  if (field == RV2_FIELD_ID) return (renderer_v2_s32)event->id;
  if (field == RV2_FIELD_SEQUENCE) return (renderer_v2_s32)event->sequence;
  if (field == RV2_FIELD_FLAGS) return (renderer_v2_s32)event->flags;
  return 0;
}
static renderer_v2_s32 rv2_mod(renderer_v2_s32 value, renderer_v2_s32 modulus) {
  renderer_v2_s32 result = value % modulus;
  return result < 0 ? result + modulus : result;
}
static renderer_v2_s32 rv2_trunc_div_u32(renderer_v2_s32 value, renderer_v2_u32 divisor) {
  renderer_v2_u32 magnitude, quotient;
  if (value >= 0) return (renderer_v2_s32)((renderer_v2_u32)value / divisor);
  /* Unsigned negation represents abs(INT32_MIN) without signed overflow. */
  magnitude = 0u - (renderer_v2_u32)value; quotient = magnitude / divisor;
  return quotient == 0u ? 0 : (renderer_v2_s32)(0u - quotient);
}
static renderer_v2_u32 rv2_execute(const RendererV2Runtime *r, renderer_v2_s32 state[16],
    const renderer_v2_u8 *h, const RendererV2EventRecord *event,
    renderer_v2_u32 *changed) {
  renderer_v2_u32 start = rv2_rd32(h + 4), count = rv2_rd16(h + 8), i;
  for (i = 0u; i < count; i++) {
    const renderer_v2_u8 *op = r->program + r->section[2] + start + i * RV2_INSTRUCTION_BYTES;
    renderer_v2_u32 code = op[0], slot = op[1], field = op[2];
    renderer_v2_s32 immediate = (renderer_v2_s32)rv2_rd32(op + 4), prior, next;
    if (code == RV2_OP_HALT) return 1u;
    if (slot >= r->state_count) return 0u;
    prior = state[slot]; next = prior;
    if (code == RV2_OP_SET) next = immediate;
    else if (code == RV2_OP_ADD)
      next = (renderer_v2_s32)((renderer_v2_u32)prior + (renderer_v2_u32)immediate);
    else if (code == RV2_OP_LOAD_EVENT) next = rv2_event_field(field, event);
    else if (code == RV2_OP_ADD_EVENT)
      next = (renderer_v2_s32)((renderer_v2_u32)prior + (renderer_v2_u32)rv2_event_field(field, event));
    else if (code == RV2_OP_MOD_POSITIVE) next = rv2_mod(prior, immediate);
    else if (code == RV2_OP_CLAMP_MIN) next = prior < immediate ? immediate : prior;
    else if (code == RV2_OP_CLAMP_MAX) next = prior > immediate ? immediate : prior;
    else return 0u;
    state[slot] = next; if (next != prior) *changed = 1u;
  }
  return 0u;
}
static renderer_v2_u32 rv2_dispatch(const RendererV2Runtime *r,
    renderer_v2_s32 state[16], const RendererV2EventRecord *event,
    renderer_v2_u32 *changed) {
  renderer_v2_u32 i;
  for (i = 0u; i < r->handler_count; i++) {
    const renderer_v2_u8 *h = r->program + r->section[1] + i * RV2_HANDLER_BYTES;
    if (h[0] != event->kind) continue;
    if ((event->kind == RV2_EVENT_HOST || event->kind == RV2_EVENT_FN_KNOB) &&
        rv2_rd16(h + 2) != event->id) continue;
    if (!rv2_execute(r, state, h, event, changed)) return 0u;
  }
  return 1u;
}
static renderer_v2_u32 rv2_apply(const RendererV2Runtime *r,
    const renderer_v2_s32 state[16], renderer_v2_u16 *frame) {
  renderer_v2_u32 i, j;
  for (i = 0u; i < r->binding_count; i++) {
    const renderer_v2_u8 *binding = r->program + r->section[6] + i * RV2_BINDING_BYTES;
    renderer_v2_u32 slot = binding[0], set_index = binding[1], divisor = rv2_rd32(binding + 4);
    renderer_v2_u32 modulo = rv2_rd16(binding + 8), origin = rv2_rd32(binding + 12);
    renderer_v2_s32 quotient = rv2_trunc_div_u32(state[slot], divisor);
    renderer_v2_s32 selected = rv2_mod(quotient, (renderer_v2_s32)modulo);
    const renderer_v2_u8 *set = r->program + r->section[3] + set_index * RV2_PATCH_SET_BYTES;
    renderer_v2_u32 variant_index = rv2_rd16(set) + (renderer_v2_u32)selected;
    const renderer_v2_u8 *variant = r->program + r->section[4] + variant_index * RV2_VARIANT_BYTES;
    renderer_v2_u32 start = rv2_rd16(variant), count = rv2_rd16(variant + 2);
    for (j = 0u; j < count; j++) {
      const renderer_v2_u8 *span = r->program + r->section[5] + (start + j) * RV2_SPAN_BYTES;
      renderer_v2_u32 pixel = rv2_rd16(span), pixels = rv2_rd16(span + 2), blob = rv2_rd32(span + 4), k;
      if (origin + pixel + pixels > RENDERER_V2_FRAME_PIXELS || blob + pixels * 2u > r->patch_bytes)
        return 0u;
      for (k = 0u; k < pixels; k++)
        frame[origin + pixel + k] = rv2_rd16(r->program + r->section[7] + blob + k * 2u);
    }
  }
  return 1u;
}

static RendererV2TickResult rv2_overlay_last_good(RendererV2Runtime *r,
    renderer_v2_u16 *frame, renderer_v2_u32 error) {
  RendererV2TickResult result; rv2_zero(&result, (renderer_v2_u32)sizeof(result));
  r->error = error; result.error = error;
  /* renderer-v1 has just rebuilt the base in the borrowed buffer. Reapplying
   * the last committed v2 state prevents a transient unpatched frame without
   * allocating a forbidden second framebuffer. */
  if (rv2_apply(r, r->state, frame)) {
    result.rendered = 1u; result.frame_generation = r->frame_generation;
    result.descriptor_identity = r->descriptor_identity;
  }
  return result;
}

RV2_EXPORT
RendererV2TickResult renderer_v2_ui_tick(RendererV2Runtime *r,
    renderer_v2_u16 *frame, renderer_v2_u32 base_ok) {
  RendererV2TickResult result; RendererV2EventRecord events[RENDERER_V2_QUEUE_RECORDS], tick;
  renderer_v2_s32 next[RENDERER_V2_STATE_SLOTS];
  renderer_v2_u32 count = 0u, i, changed = 0u, next_subsecond;
  renderer_v2_u32 tick100_sequence, tick1_sequence = 0u;
  rv2_zero(&result, (renderer_v2_u32)sizeof(result));
  if (r == (RendererV2Runtime *)0 || r->program == (const renderer_v2_u8 *)0 ||
      frame == (renderer_v2_u16 *)0) { result.error = RV2_ERROR_ARGUMENT; return result; }
  if (base_ok == 0u) { r->error = RV2_ERROR_BASE; result.error = r->error; return result; }
  if (!rv2_try_lock(r)) return rv2_overlay_last_good(r, frame, RV2_ERROR_VM);
  while (r->queue_count != 0u) {
    rv2_copy(&events[count++], &r->queue[r->queue_head],
      (renderer_v2_u32)sizeof(RendererV2EventRecord));
    rv2_zero(&r->queue[r->queue_head], (renderer_v2_u32)sizeof(RendererV2EventRecord));
    r->queue_head = (renderer_v2_u8)((r->queue_head + 1u) % RENDERER_V2_QUEUE_RECORDS); r->queue_count--;
  }
  /* Sequence assignment shares the queue lock with every producer, so record
   * ordering is monotonic without a second atomic primitive or data race. */
  tick100_sequence = ++r->sequence;
  if ((renderer_v2_u32)r->subsecond + 1u == 10u) tick1_sequence = ++r->sequence;
  rv2_unlock(r); for (i = 0u; i < RENDERER_V2_STATE_SLOTS; i++) next[i] = r->state[i];
  for (i = 0u; i < count; i++) if (!rv2_dispatch(r, next, &events[i], &changed)) {
    return rv2_overlay_last_good(r, frame, RV2_ERROR_VM);
  }
  rv2_zero(&tick, (renderer_v2_u32)sizeof(tick)); tick.kind = RV2_EVENT_TICK100;
  tick.value = 1; tick.sequence = tick100_sequence;
  if (!rv2_dispatch(r, next, &tick, &changed)) return rv2_overlay_last_good(r, frame, RV2_ERROR_VM);
  next_subsecond = (renderer_v2_u32)r->subsecond + 1u;
  if (next_subsecond == 10u) {
    next_subsecond = 0u; tick.kind = RV2_EVENT_TICK1; tick.sequence = tick1_sequence;
    if (!rv2_dispatch(r, next, &tick, &changed)) return rv2_overlay_last_good(r, frame, RV2_ERROR_VM);
    result.second_tick = 1u;
  }
  if (!rv2_apply(r, next, frame)) { r->error = RV2_ERROR_PATCH; result.error = r->error; return result; }
  for (i = 0u; i < RENDERER_V2_STATE_SLOTS; i++) r->state[i] = next[i];
  r->subsecond = (renderer_v2_u8)next_subsecond; r->tick_count++; r->frame_generation++;
  r->descriptor_identity ^= 1u; r->error = RV2_ERROR_NONE;
  result.rendered = 1u; result.drained_events = count; result.state_changed = changed;
  result.frame_generation = r->frame_generation; result.descriptor_identity = r->descriptor_identity;
  return result;
}

/* ---- renderer-v1 ID26 live sidecar adapter ---- */
typedef void (*RendererV2OldTick)(void *);
typedef void (*RendererV2OldEncoder)(void *, renderer_v2_u32, renderer_v2_u32);
typedef struct {
  renderer_v2_u32 magic;
  RendererV2OldTick old_tick;
  RendererV2OldEncoder old_encoder;
  void *vtable[12];
  RendererV2Runtime runtime;
} RendererV2Sidecar;

static void renderer_v2_live_tick(void *controller) {
  void **vtable = *(void ***)controller;
  RendererV2Sidecar *sidecar = (RendererV2Sidecar *)vtable[11];
  renderer_v2_u8 *bytes = (renderer_v2_u8 *)controller;
  if (sidecar == (RendererV2Sidecar *)0 || sidecar->magic != RV2_LIVE_MAGIC) return;
  sidecar->old_tick(controller);
  /* Renderer-v1 ABI: active_bundle +28, error +64, framebuffer +160. */
  renderer_v2_u32 base_ok = *(const renderer_v2_u8 **)(bytes + 28u) != (const renderer_v2_u8 *)0 &&
    *(renderer_v2_u32 *)(bytes + 64u) == 0u;
  RendererV2TickResult result = renderer_v2_ui_tick(&sidecar->runtime,
    (renderer_v2_u16 *)(bytes + 160u), base_ok);
#ifndef RENDERER_V2_HOST_TEST
  /* renderer-v1 invalidates once after producing the base.  Invalidate again
   * after v2 patches, alternating descriptor identity, while still on the
   * LVGL/UI callback.  The consumer can therefore never cache the base-only
   * pixels for this tick. Renderer-v1 ABI: image +60, descriptors +68. */
  if (result.rendered != 0u) {
    void *image = *(void **)(bytes + 60u);
    if (image != (void *)0)
      /* renderer-v1 selected old elapsed_tick parity, then incremented +56.
       * Current parity is therefore guaranteed to be the opposite descriptor,
       * including after build/cleanup resets and screen re-entry. */
      RV2_FN_IMAGE_SET_SRC(image, bytes + 68u +
        (*(renderer_v2_u32 *)(bytes + 56u) & 1u) * 24u);
  }
#else
  (void)result;
#endif
}
static void renderer_v2_live_encoder(void *controller, renderer_v2_u32 encoder,
    renderer_v2_u32 raw_delta) {
  void **vtable = *(void ***)controller;
  RendererV2Sidecar *sidecar = (RendererV2Sidecar *)vtable[11];
  renderer_v2_u32 available = 0u, pressed = 0u, result;
  if (sidecar == (RendererV2Sidecar *)0 || sidecar->magic != RV2_LIVE_MAGIC) return;
#ifdef RENDERER_V2_HOST_TEST
  (void)available; (void)pressed;
  result = RENDERER_V2_INPUT_FALLBACK;
#else
  void *input = RV2_FN_INPUT_GET(); available = input != (void *)0;
  pressed = available ? (renderer_v2_u32)(RV2_FN_FN_PRESSED(input) != 0) : 0u;
  result = renderer_v2_enqueue_fn_bottom(&sidecar->runtime, encoder, raw_delta, pressed, available);
#endif
  if ((result & RENDERER_V2_INPUT_CONSUMED) == 0u) sidecar->old_encoder(controller, encoder, raw_delta);
}

static RendererV2Sidecar *rv2_installed_sidecar(void *controller) {
  void **vtable;
  RendererV2Sidecar *sidecar;
  if (controller == (void *)0) return (RendererV2Sidecar *)0;
  vtable = *(void ***)controller;
  if (vtable == (void **)0 || vtable[6] != (void *)renderer_v2_live_tick ||
      vtable[9] != (void *)renderer_v2_live_encoder) return (RendererV2Sidecar *)0;
  sidecar = (RendererV2Sidecar *)vtable[11];
  return sidecar != (RendererV2Sidecar *)0 && sidecar->magic == RV2_LIVE_MAGIC ? sidecar : (RendererV2Sidecar *)0;
}

RV2_EXPORT
void *renderer_v2_native_attach(void *setup_owner, void *registry, void *controller,
    const renderer_v2_u8 *program, renderer_v2_u32 bytes) {
  RendererV2Sidecar *sidecar;
  (void)setup_owner; (void)registry;
  sidecar = rv2_installed_sidecar(controller); if (sidecar != (RendererV2Sidecar *)0) return sidecar;
  if (controller == (void *)0 || program == (const renderer_v2_u8 *)0 ||
      !rv2_is_data(controller, 4u) || !rv2_is_data(program, bytes)) return (void *)0;
#ifdef RENDERER_V2_HOST_TEST
  return (void *)0;
#else
  void **old_vtable; renderer_v2_u32 i;
  sidecar = (RendererV2Sidecar *)RV2_FN_NEW((renderer_v2_u32)sizeof(RendererV2Sidecar));
  if (sidecar == (RendererV2Sidecar *)0) return (void *)0;
  rv2_zero(sidecar, (renderer_v2_u32)sizeof(*sidecar));
  if (!renderer_v2_runtime_init(&sidecar->runtime, program, bytes)) return (void *)0;
  old_vtable = *(void ***)controller;
  if (old_vtable == (void **)0 || old_vtable[6] == (void *)0 || old_vtable[9] == (void *)0) return (void *)0;
  sidecar->old_tick = (RendererV2OldTick)old_vtable[6]; sidecar->old_encoder = (RendererV2OldEncoder)old_vtable[9];
  for (i = 0u; i < 11u; i++) sidecar->vtable[i] = old_vtable[i];
  sidecar->vtable[6] = (void *)renderer_v2_live_tick; sidecar->vtable[9] = (void *)renderer_v2_live_encoder;
  sidecar->vtable[11] = sidecar; sidecar->magic = RV2_LIVE_MAGIC; rv2_barrier();
  *(void ***)controller = sidecar->vtable; rv2_barrier(); return sidecar;
#endif
}

RV2_EXPORT
renderer_v2_u32 renderer_v2_native_host_event(void *controller,
    renderer_v2_u16 event_id, renderer_v2_s32 value) {
  RendererV2Sidecar *sidecar = rv2_installed_sidecar(controller);
  if (sidecar == (RendererV2Sidecar *)0) return 0u;
  return renderer_v2_enqueue_host(&sidecar->runtime, event_id, value);
}

#ifdef RENDERER_V2_HOST_TEST
/* Host fuzz surface validates structural bounds without requiring the frozen
 * digest, while production admission always requires it. */
renderer_v2_u32 renderer_v2_host_admit_structure(const renderer_v2_u8 *program,
    renderer_v2_u32 bytes) {
  RendererV2Runtime runtime; rv2_zero(&runtime, (renderer_v2_u32)sizeof(runtime));
  return rv2_admit(&runtime, program, bytes, 0u) == RV2_ERROR_NONE;
}
#endif
