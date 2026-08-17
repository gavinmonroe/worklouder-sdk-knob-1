/*
 * Allocation-free transaction core for renderer-v1 scene RPC.
 *
 * The Framer callback/JSON bridge is renderer-v1-scene-rpc.S.  Keeping the
 * transaction engine free of firmware JSON types gives us an executable host
 * test for the exact same code that is linked into the ESP32-S3 image.
 */

typedef unsigned char u8;
typedef unsigned int u32;
typedef unsigned long long u64;
typedef unsigned long uptr;
typedef signed int s32;

#define SCENE_STORE_BYTES 98304u
#define SCENE_CHUNK_BYTES 3072u
#define SCENE_MAX_CHUNKS 32u
#define SCENE_HEADER_BYTES 20u
#define SCENE_MIN_F1WB_BYTES 332u
#define SCENE_FLAG_ACTIVE 1u
#define SCENE_FLAG_V2_STORE_LATCH 2u
#define SCENE_FOCUS_F1WB_BYTES 62404u
#define SCENE_FOCUS_F2EP_BYTES 15178u
#define SCENE_TIMER_F2EP_BYTES 14618u
#define SCENE_TIMER_BASE_LZSS_BYTES 3335u
#define SCENE_FOCUS_TIMER_PACKAGE_BYTES \
  (SCENE_FOCUS_F1WB_BYTES + SCENE_FOCUS_F2EP_BYTES + SCENE_TIMER_F2EP_BYTES + \
    SCENE_TIMER_BASE_LZSS_BYTES)
#ifdef RENDERER_SCENE_RPC_NO_V2
#define SCENE_V2_ENABLED 0
#else
#define SCENE_V2_ENABLED 1
#endif

#ifdef RENDERER_SCENE_RPC_HOST_TEST
#define SCENE_EXPORT
typedef s32 (*SceneStageFn)(void *, const u8 *, u32);
typedef s32 (*ScenePrepareFn)(void *, const u8 *);
typedef u32 (*SceneV2PrepareFn)(void *, const u8 *, u32, u32);
typedef u32 (*SceneV2CommitFn)(void *);
typedef u32 (*SceneV2CancelFn)(void *);
static SceneStageFn host_stage;
static ScenePrepareFn host_prepare;
static SceneV2PrepareFn host_v2_prepare;
static SceneV2CommitFn host_v2_commit;
static SceneV2CancelFn host_v2_cancel;
void renderer_scene_rpc_host_set_stage(SceneStageFn value) { host_stage = value; }
void renderer_scene_rpc_host_set_prepare(ScenePrepareFn value) { host_prepare = value; }
void renderer_scene_rpc_host_set_v2_prepare(SceneV2PrepareFn value) { host_v2_prepare = value; }
void renderer_scene_rpc_host_set_v2_commit(SceneV2CommitFn value) { host_v2_commit = value; }
void renderer_scene_rpc_host_set_v2_cancel(SceneV2CancelFn value) { host_v2_cancel = value; }
#else
#define SCENE_EXPORT __attribute__((section(".text.renderer_scene_rpc"), used, visibility("default")))
extern s32 renderer_v1_stage_bundle(void *renderer, const u8 *bundle, u32 length);
extern s32 renderer_v1_prepare_store(void *renderer, const u8 *store);
#if SCENE_V2_ENABLED
extern u32 renderer_v2_native_prepare(void *renderer, const u8 *package,
  u32 package_bytes, u32 generation);
extern u32 renderer_v2_native_commit(void *renderer);
extern u32 renderer_v2_native_cancel(void *renderer);
#endif
#endif

typedef struct {
  u32 controller;                    /* +0, ESP32-S3 pointer word */
  u32 flags;                         /* +4 */
  u32 committed_generation;          /* +8 */
  u32 expected_generation;           /* +12 */
  u32 total_bytes;                   /* +16 */
  u32 total_chunks;                  /* +20 */
  u32 next_chunk;                    /* +24 */
  u32 received_bytes;                /* +28 */
  u32 transaction_id_length;         /* +32 */
  u8 transaction_id[40];             /* +36 */
  u8 bundle_sha_hex[65];             /* +76 */
  u8 padding_141[3];                 /* +141 */
  u8 header[SCENE_HEADER_BYTES];      /* +144 */
  u8 rpc_strings[156];               /* +164 */
  u8 store[SCENE_STORE_BYTES];        /* +320 */
} RendererSceneRpcState;

typedef struct {
  const u8 *transaction_id; u32 transaction_id_length;
  u32 expected_generation; u32 generation; u32 total_bytes; u32 total_chunks;
  u32 chunk_raw_bytes; const u8 *bundle_sha_hex;
} RendererSceneBeginArgs;
typedef struct {
  const u8 *transaction_id; u32 transaction_id_length; u32 generation;
  u32 index; u32 offset; u32 declared_bytes; const u8 *chunk_sha_hex;
  const u8 *decoded; u32 decoded_bytes;
} RendererSceneWriteArgs;
typedef struct {
  const u8 *transaction_id; u32 transaction_id_length; u32 generation;
  u32 index; u32 offset; u32 declared_bytes; const u8 *chunk_sha_hex;
  const u8 *base64; u32 base64_bytes;
} RendererSceneWriteBase64Args;
typedef struct {
  const u8 *transaction_id; u32 transaction_id_length; u32 expected_generation;
  u32 generation; u32 total_bytes; u32 total_chunks; const u8 *bundle_sha_hex;
} RendererSceneCommitArgs;

typedef char scene_state_store_offset_must_be_320
  [__builtin_offsetof(RendererSceneRpcState, store) == 320u ? 1 : -1];
typedef char scene_state_size_must_be_98624
  [sizeof(RendererSceneRpcState) == 98624u ? 1 : -1];

enum {
  SCENE_RPC_OK = 1,
  SCENE_RPC_REJECTED = 0,
  SCENE_RPC_BUSY = -1,
  SCENE_RPC_PARAMS = -2,
  SCENE_RPC_GENERATION = -3,
  SCENE_RPC_RANGE = -4,
  SCENE_RPC_ORDER = -5,
  SCENE_RPC_SHA = -6,
  SCENE_RPC_TORN = -7,
  SCENE_RPC_F1WB = -8,
  SCENE_RPC_STAGE = -9,
  SCENE_RPC_V2 = -10,
};

static void zero_bytes(void *value, u32 bytes) {
  u8 *p = (u8 *)value;
  while (bytes-- != 0u) *p++ = 0u;
}
static void copy_bytes(void *to, const void *from, u32 bytes) {
  u8 *d = (u8 *)to; const u8 *s = (const u8 *)from;
  while (bytes-- != 0u) *d++ = *s++;
}
static s32 equal_bytes(const u8 *left, const u8 *right, u32 bytes) {
  u8 difference = 0u;
  while (bytes-- != 0u) difference |= (u8)(*left++ ^ *right++);
  return difference == 0u;
}
static u32 read32(const u8 *p) {
  return (u32)p[0] | ((u32)p[1] << 8) | ((u32)p[2] << 16) | ((u32)p[3] << 24);
}
static u32 read16(const u8 *p) { return (u32)p[0] | ((u32)p[1] << 8); }
static void barrier(void) {
#ifdef RENDERER_SCENE_RPC_HOST_TEST
  __asm__ __volatile__("" ::: "memory");
#else
  __asm__ __volatile__("memw" ::: "memory");
#endif
}

static u32 rotate_right(u32 x, u32 n) { return (x >> n) | (x << (32u - n)); }
static u32 sha_constant(u32 index) {
  switch (index) {
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
static u32 big32(const u8 *p) {
  return ((u32)p[0] << 24) | ((u32)p[1] << 16) | ((u32)p[2] << 8) | p[3];
}
static void sha_transform(u32 state[8], const u8 block[64]) {
  u32 words[64], index;
  for (index = 0; index < 16u; index++) words[index] = big32(block + index * 4u);
  for (; index < 64u; index++) {
    u32 x = words[index - 15u], y = words[index - 2u];
    u32 s0 = rotate_right(x, 7u) ^ rotate_right(x, 18u) ^ (x >> 3);
    u32 s1 = rotate_right(y, 17u) ^ rotate_right(y, 19u) ^ (y >> 10);
    words[index] = words[index - 16u] + s0 + words[index - 7u] + s1;
  }
  u32 a = state[0], b = state[1], c = state[2], d = state[3];
  u32 e = state[4], f = state[5], g = state[6], h = state[7];
  for (index = 0; index < 64u; index++) {
    u32 s1 = rotate_right(e, 6u) ^ rotate_right(e, 11u) ^ rotate_right(e, 25u);
    u32 choice = (e & f) ^ (~e & g);
    u32 t1 = h + s1 + choice + sha_constant(index) + words[index];
    u32 s0 = rotate_right(a, 2u) ^ rotate_right(a, 13u) ^ rotate_right(a, 22u);
    u32 majority = (a & b) ^ (a & c) ^ (b & c);
    u32 t2 = s0 + majority;
    h = g; g = f; f = e; e = d + t1; d = c; c = b; b = a; a = t1 + t2;
  }
  state[0] += a; state[1] += b; state[2] += c; state[3] += d;
  state[4] += e; state[5] += f; state[6] += g; state[7] += h;
}
static void sha256(const u8 *data, u32 length, u8 output[32]) {
  u32 state[8], blocks = length / 64u, index;
  u8 tail[128];
  state[0] = 0x6a09e667u; state[1] = 0xbb67ae85u;
  state[2] = 0x3c6ef372u; state[3] = 0xa54ff53au;
  state[4] = 0x510e527fu; state[5] = 0x9b05688cu;
  state[6] = 0x1f83d9abu; state[7] = 0x5be0cd19u;
  for (index = 0; index < blocks; index++) sha_transform(state, data + index * 64u);
  u32 remainder = length - blocks * 64u;
  u32 tail_bytes = remainder < 56u ? 64u : 128u;
  zero_bytes(tail, tail_bytes); copy_bytes(tail, data + blocks * 64u, remainder);
  tail[remainder] = 0x80u;
  u64 bits = (u64)length * 8u;
  for (index = 0; index < 8u; index++) tail[tail_bytes - 1u - index] = (u8)(bits >> (index * 8u));
  sha_transform(state, tail); if (tail_bytes == 128u) sha_transform(state, tail + 64u);
  for (index = 0; index < 8u; index++) {
    output[index * 4u] = (u8)(state[index] >> 24);
    output[index * 4u + 1u] = (u8)(state[index] >> 16);
    output[index * 4u + 2u] = (u8)(state[index] >> 8);
    output[index * 4u + 3u] = (u8)state[index];
  }
}
static s32 lower_hex_digest(const u8 *text, u8 digest[32]) {
  u32 index;
  if (text == (const u8 *)0) return 0;
  for (index = 0; index < 32u; index++) {
    u8 high = text[index * 2u], low = text[index * 2u + 1u];
    if (!((high >= '0' && high <= '9') || (high >= 'a' && high <= 'f')) ||
        !((low >= '0' && low <= '9') || (low >= 'a' && low <= 'f'))) return 0;
    high = high <= (u8)'9' ? (u8)(high - (u8)'0') : (u8)(high - (u8)'a' + (u8)10);
    low = low <= (u8)'9' ? (u8)(low - (u8)'0') : (u8)(low - (u8)'a' + (u8)10);
    digest[index] = (u8)((high << 4) | low);
  }
  return text[64] == 0u;
}
static s32 valid_transaction_id(const u8 *value, u32 length) {
  u32 index;
  if (value == (const u8 *)0 || length < 8u || length > 40u) return 0;
  for (index = 0; index < length; index++) {
    u8 c = value[index];
    if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') ||
          (index > 0u && (c == '.' || c == '_' || c == '-')))) return 0;
  }
  return 1;
}
static s32 base64_digit(u8 value) {
  if (value >= (u8)'A' && value <= (u8)'Z') return (s32)(value - (u8)'A');
  if (value >= (u8)'a' && value <= (u8)'z') return (s32)(value - (u8)'a' + (u8)26);
  if (value >= (u8)'0' && value <= (u8)'9') return (s32)(value - (u8)'0' + (u8)52);
  if (value == (u8)'+') return 62;
  if (value == (u8)'/') return 63;
  return -1;
}
/* Canonical base64 only: exact encoded length, padding only in the final
 * quartet, and unused low bits zero.  Output goes directly into the private
 * un-published scene store. */
static s32 decode_base64(const u8 *input, u32 input_bytes, u8 *output, u32 output_bytes) {
  u32 in = 0u, out = 0u;
  if (input == (const u8 *)0 || output == (u8 *)0 || input_bytes != ((output_bytes + 2u) / 3u) * 4u)
    return 0;
  while (in < input_bytes) {
    s32 a = base64_digit(input[in]), b = base64_digit(input[in + 1u]);
    s32 c = input[in + 2u] == (u8)'=' ? -2 : base64_digit(input[in + 2u]);
    s32 d = input[in + 3u] == (u8)'=' ? -2 : base64_digit(input[in + 3u]);
    u32 remaining = output_bytes - out;
    if (a < 0 || b < 0 || c == -1 || d == -1 || (c == -2 && d != -2) ||
        (c == -2 && ((u32)b & 15u) != 0u) || (d == -2 && c >= 0 && ((u32)c & 3u) != 0u) ||
        (remaining >= 3u && (c < 0 || d < 0)) || (remaining == 2u && (c < 0 || d != -2)) ||
        (remaining == 1u && (c != -2 || d != -2)) || remaining == 0u) return 0;
    output[out++] = (u8)(((u32)a << 2) | ((u32)b >> 4));
    if (remaining >= 2u) output[out++] = (u8)(((u32)b << 4) | ((u32)c >> 2));
    if (remaining >= 3u) output[out++] = (u8)(((u32)c << 6) | (u32)d);
    in += 4u;
  }
  return out == output_bytes;
}
static void invalidate(RendererSceneRpcState *state) {
#if SCENE_V2_ENABLED
  u32 retained;
#endif
  if (state == (RendererSceneRpcState *)0) return;
#if SCENE_V2_ENABLED
  retained = state->flags & SCENE_FLAG_V2_STORE_LATCH;
  state->flags = retained;
#else
  state->flags = 0u;
#endif
  state->next_chunk = 0u; state->received_bytes = 0u;
  zero_bytes(state->header, SCENE_HEADER_BYTES);
  zero_bytes(state->store, SCENE_HEADER_BYTES);
  barrier();
}

SCENE_EXPORT
s32 renderer_scene_rpc_core_begin(RendererSceneRpcState *state, const u8 *transaction_id,
    u32 transaction_id_length, u32 expected_generation, u32 generation, u32 total_bytes,
    u32 total_chunks, u32 chunk_raw_bytes, const u8 *bundle_sha_hex) {
  u8 expected_sha[32];
  if (state == (RendererSceneRpcState *)0 || state->controller == 0u ||
      transaction_id == (const u8 *)0 || bundle_sha_hex == (const u8 *)0) return SCENE_RPC_PARAMS;
#if SCENE_V2_ENABLED
  if ((state->flags & (SCENE_FLAG_ACTIVE | SCENE_FLAG_V2_STORE_LATCH)) != 0u) return SCENE_RPC_BUSY;
#else
  if ((state->flags & SCENE_FLAG_ACTIVE) != 0u) return SCENE_RPC_BUSY;
#endif
  if (!valid_transaction_id(transaction_id, transaction_id_length) || !lower_hex_digest(bundle_sha_hex, expected_sha))
    return SCENE_RPC_PARAMS;
  if (expected_generation != state->committed_generation || generation == 0u ||
      generation != expected_generation + 1u) return SCENE_RPC_GENERATION;
  if (total_bytes < SCENE_MIN_F1WB_BYTES || total_bytes > SCENE_STORE_BYTES ||
      chunk_raw_bytes != SCENE_CHUNK_BYTES || total_chunks == 0u || total_chunks > SCENE_MAX_CHUNKS ||
      total_chunks != (total_bytes + SCENE_CHUNK_BYTES - 1u) / SCENE_CHUNK_BYTES) return SCENE_RPC_RANGE;
#ifdef RENDERER_SCENE_RPC_HOST_TEST
  if (host_prepare != (ScenePrepareFn)0 &&
      !host_prepare((void *)(uptr)state->controller, state->store)) return SCENE_RPC_BUSY;
#else
  if (!renderer_v1_prepare_store((void *)(uptr)state->controller, state->store)) return SCENE_RPC_BUSY;
#endif
  state->expected_generation = expected_generation; state->total_bytes = total_bytes;
  state->total_chunks = total_chunks; state->next_chunk = 0u; state->received_bytes = 0u;
  state->transaction_id_length = transaction_id_length;
  zero_bytes(state->transaction_id, 40u); copy_bytes(state->transaction_id, transaction_id, transaction_id_length);
  copy_bytes(state->bundle_sha_hex, bundle_sha_hex, 65u);
  zero_bytes(state->header, SCENE_HEADER_BYTES); zero_bytes(state->store, SCENE_HEADER_BYTES);
  state->flags = SCENE_FLAG_ACTIVE; barrier(); return SCENE_RPC_OK;
}

SCENE_EXPORT
s32 renderer_scene_rpc_core_write(RendererSceneRpcState *state, const u8 *transaction_id,
    u32 transaction_id_length, u32 generation, u32 index, u32 offset, u32 declared_bytes,
    const u8 *chunk_sha_hex, const u8 *decoded, u32 decoded_bytes) {
  u8 expected_sha[32], actual_sha[32]; u32 exact_bytes, header_part, source_offset;
  if (state == (RendererSceneRpcState *)0 || transaction_id == (const u8 *)0 ||
      chunk_sha_hex == (const u8 *)0 || decoded == (const u8 *)0) return SCENE_RPC_PARAMS;
  if ((state->flags & SCENE_FLAG_ACTIVE) == 0u) return SCENE_RPC_REJECTED;
  if (transaction_id_length != state->transaction_id_length ||
      !equal_bytes(transaction_id, state->transaction_id, transaction_id_length) ||
      generation != state->expected_generation + 1u) { invalidate(state); return SCENE_RPC_PARAMS; }
  if (index != state->next_chunk || offset != state->received_bytes) { invalidate(state); return SCENE_RPC_ORDER; }
  exact_bytes = state->total_bytes - offset;
  if (exact_bytes > SCENE_CHUNK_BYTES) exact_bytes = SCENE_CHUNK_BYTES;
  if (exact_bytes == 0u || declared_bytes != exact_bytes || decoded_bytes != exact_bytes ||
      !lower_hex_digest(chunk_sha_hex, expected_sha)) { invalidate(state); return SCENE_RPC_RANGE; }
  sha256(decoded, decoded_bytes, actual_sha);
  if (!equal_bytes(actual_sha, expected_sha, 32u)) { invalidate(state); return SCENE_RPC_SHA; }
  header_part = offset < SCENE_HEADER_BYTES ? SCENE_HEADER_BYTES - offset : 0u;
  if (header_part > decoded_bytes) header_part = decoded_bytes;
  if (header_part != 0u) copy_bytes(state->header + offset, decoded, header_part);
  source_offset = header_part;
  if (decoded_bytes > source_offset) copy_bytes(state->store + offset + source_offset,
      decoded + source_offset, decoded_bytes - source_offset);
  state->next_chunk++; state->received_bytes += decoded_bytes; barrier(); return SCENE_RPC_OK;
}

static s32 basic_f1wb(const RendererSceneRpcState *state, u32 generation
#if SCENE_V2_ENABLED
    , u32 bundle_bytes
#endif
    ) {
  const u8 *h = state->header;
  return h[0] == 'F' && h[1] == '1' && h[2] == 'W' && h[3] == 'B' &&
    h[4] == 1u && h[5] == 3u && h[6] >= 1u && h[6] <= 3u && h[7] < h[6] &&
#if SCENE_V2_ENABLED
    read32(h + 8) == generation && read32(h + 12) == bundle_bytes &&
    bundle_bytes >= SCENE_MIN_F1WB_BYTES && bundle_bytes <= state->total_bytes &&
#else
    read32(h + 8) == generation && read32(h + 12) == state->total_bytes &&
#endif
    read16(h + 16) == 104u && read16(h + 18) == 332u;
}

SCENE_EXPORT
s32 renderer_scene_rpc_core_commit(RendererSceneRpcState *state, const u8 *transaction_id,
    u32 transaction_id_length, u32 expected_generation, u32 generation, u32 total_bytes,
    u32 total_chunks, const u8 *bundle_sha_hex) {
  u8 expected_sha[32], actual_sha[32];
#if SCENE_V2_ENABLED
  u32 bundle_bytes, focus_timer_package, v2_prepared = 0u;
#endif
  s32 staged;
  if (state == (RendererSceneRpcState *)0 || transaction_id == (const u8 *)0 ||
      bundle_sha_hex == (const u8 *)0) return SCENE_RPC_PARAMS;
  if ((state->flags & SCENE_FLAG_ACTIVE) == 0u) return SCENE_RPC_REJECTED;
  if (transaction_id_length != state->transaction_id_length ||
      !equal_bytes(transaction_id, state->transaction_id, transaction_id_length) ||
      expected_generation != state->expected_generation || generation != expected_generation + 1u ||
      total_bytes != state->total_bytes || total_chunks != state->total_chunks ||
      !equal_bytes(bundle_sha_hex, state->bundle_sha_hex, 65u) ||
      !lower_hex_digest(bundle_sha_hex, expected_sha)) { invalidate(state); return SCENE_RPC_PARAMS; }
  if (state->next_chunk != state->total_chunks || state->received_bytes != state->total_bytes) {
    invalidate(state); return SCENE_RPC_TORN;
  }
#if SCENE_V2_ENABLED
  bundle_bytes = read32(state->header + 12u);
  focus_timer_package = state->total_bytes == SCENE_FOCUS_TIMER_PACKAGE_BYTES &&
    bundle_bytes == SCENE_FOCUS_F1WB_BYTES;
  if (!basic_f1wb(state, generation, bundle_bytes) ||
      (!focus_timer_package && bundle_bytes != state->total_bytes)) {
    invalidate(state); return SCENE_RPC_F1WB;
  }
#else
  if (!basic_f1wb(state, generation)) { invalidate(state); return SCENE_RPC_F1WB; }
#endif
  copy_bytes(state->store, state->header, SCENE_HEADER_BYTES); barrier();
  sha256(state->store, state->total_bytes, actual_sha);
  if (!equal_bytes(actual_sha, expected_sha, 32u)) { invalidate(state); return SCENE_RPC_SHA; }
#if SCENE_V2_ENABLED
  if (focus_timer_package) {
#ifdef RENDERER_SCENE_RPC_HOST_TEST
    v2_prepared = host_v2_prepare == (SceneV2PrepareFn)0 ? 0u : host_v2_prepare(
      (void *)(uptr)state->controller, state->store, state->total_bytes, generation);
#else
    v2_prepared = renderer_v2_native_prepare((void *)(uptr)state->controller,
      state->store, state->total_bytes, generation);
#endif
    if (v2_prepared == 0u) { invalidate(state); return SCENE_RPC_V2; }
  }
#endif
#ifdef RENDERER_SCENE_RPC_HOST_TEST
  staged = host_stage == (SceneStageFn)0 ? 0 : host_stage((void *)(uptr)state->controller,
#if SCENE_V2_ENABLED
    state->store, bundle_bytes);
#else
    state->store, state->total_bytes);
#endif
#else
#if SCENE_V2_ENABLED
  staged = renderer_v1_stage_bundle((void *)(uptr)state->controller, state->store, bundle_bytes);
#else
  staged = renderer_v1_stage_bundle((void *)(uptr)state->controller, state->store, state->total_bytes);
#endif
#endif
  if (!staged) {
#if SCENE_V2_ENABLED
    if (v2_prepared != 0u) {
#ifdef RENDERER_SCENE_RPC_HOST_TEST
      if (host_v2_cancel != (SceneV2CancelFn)0)
        (void)host_v2_cancel((void *)(uptr)state->controller);
#else
      (void)renderer_v2_native_cancel((void *)(uptr)state->controller);
#endif
    }
#endif
    invalidate(state); return SCENE_RPC_STAGE;
  }
#if SCENE_V2_ENABLED
  if (v2_prepared != 0u) {
    u32 committed;
#ifdef RENDERER_SCENE_RPC_HOST_TEST
    committed = host_v2_commit == (SceneV2CommitFn)0 ? 0u :
      host_v2_commit((void *)(uptr)state->controller);
#else
    committed = renderer_v2_native_commit((void *)(uptr)state->controller);
#endif
    if (committed == 0u) {
      /* renderer-v1 already borrowed this store. Retain it for boot lifetime
       * even if the supposedly infallible PREPARED->COMMITTED CAS fails. */
      state->committed_generation = generation;
      state->flags = SCENE_FLAG_V2_STORE_LATCH; barrier(); return SCENE_RPC_V2;
    }
  }
#endif
  state->committed_generation = generation;
#if SCENE_V2_ENABLED
  state->flags = focus_timer_package ? SCENE_FLAG_V2_STORE_LATCH : 0u;
#else
  state->flags = 0u;
#endif
  barrier(); return SCENE_RPC_OK;
}

SCENE_EXPORT
s32 renderer_scene_rpc_core_abort(RendererSceneRpcState *state, const u8 *transaction_id,
    u32 transaction_id_length, u32 generation) {
  if (state == (RendererSceneRpcState *)0) return SCENE_RPC_BUSY;
  if ((state->flags & SCENE_FLAG_ACTIVE) == 0u || transaction_id == (const u8 *)0 ||
      transaction_id_length != state->transaction_id_length ||
      !equal_bytes(transaction_id, state->transaction_id, transaction_id_length) ||
      generation != state->expected_generation + 1u) return SCENE_RPC_REJECTED;
  invalidate(state); return SCENE_RPC_OK;
}

SCENE_EXPORT
u32 renderer_scene_rpc_core_flags(const RendererSceneRpcState *state) {
  return state == (const RendererSceneRpcState *)0 ? 0u : state->flags;
}

/* Two-register callback bridge surface.  Assembly builds one bounded argument
 * record on its stack, which avoids depending on Xtensa's overflow-argument
 * convention for the wide wire envelopes. */
SCENE_EXPORT s32 renderer_scene_rpc_core_begin_args(RendererSceneRpcState *state,
    const RendererSceneBeginArgs *args) {
  if (args == (const RendererSceneBeginArgs *)0) return SCENE_RPC_PARAMS;
  return renderer_scene_rpc_core_begin(state, args->transaction_id, args->transaction_id_length,
    args->expected_generation, args->generation, args->total_bytes, args->total_chunks,
    args->chunk_raw_bytes, args->bundle_sha_hex);
}
SCENE_EXPORT s32 renderer_scene_rpc_core_write_args(RendererSceneRpcState *state,
    const RendererSceneWriteArgs *args) {
  if (args == (const RendererSceneWriteArgs *)0) return SCENE_RPC_PARAMS;
  return renderer_scene_rpc_core_write(state, args->transaction_id, args->transaction_id_length,
    args->generation, args->index, args->offset, args->declared_bytes, args->chunk_sha_hex,
    args->decoded, args->decoded_bytes);
}
SCENE_EXPORT s32 renderer_scene_rpc_core_write_base64_args(RendererSceneRpcState *state,
    const RendererSceneWriteBase64Args *args) {
  u8 expected_sha[32], actual_sha[32]; u32 exact_bytes;
  if (state == (RendererSceneRpcState *)0 || args == (const RendererSceneWriteBase64Args *)0 ||
      args->transaction_id == (const u8 *)0 || args->chunk_sha_hex == (const u8 *)0 ||
      args->base64 == (const u8 *)0) return SCENE_RPC_PARAMS;
  if ((state->flags & SCENE_FLAG_ACTIVE) == 0u) return SCENE_RPC_REJECTED;
  if (args->transaction_id_length != state->transaction_id_length ||
      !equal_bytes(args->transaction_id, state->transaction_id, args->transaction_id_length) ||
      args->generation != state->expected_generation + 1u) { invalidate(state); return SCENE_RPC_PARAMS; }
  if (args->index != state->next_chunk || args->offset != state->received_bytes) {
    invalidate(state); return SCENE_RPC_ORDER;
  }
  exact_bytes = state->total_bytes - args->offset;
  if (exact_bytes > SCENE_CHUNK_BYTES) exact_bytes = SCENE_CHUNK_BYTES;
  if (exact_bytes == 0u || args->declared_bytes != exact_bytes ||
      !lower_hex_digest(args->chunk_sha_hex, expected_sha) ||
      !decode_base64(args->base64, args->base64_bytes, state->store + args->offset, exact_bytes)) {
    invalidate(state); return SCENE_RPC_RANGE;
  }
  sha256(state->store + args->offset, exact_bytes, actual_sha);
  if (!equal_bytes(actual_sha, expected_sha, 32u)) { invalidate(state); return SCENE_RPC_SHA; }
  if (args->offset == 0u) {
    copy_bytes(state->header, state->store, SCENE_HEADER_BYTES);
    zero_bytes(state->store, SCENE_HEADER_BYTES);
  }
  state->next_chunk++; state->received_bytes += exact_bytes; barrier(); return SCENE_RPC_OK;
}
SCENE_EXPORT s32 renderer_scene_rpc_core_commit_args(RendererSceneRpcState *state,
    const RendererSceneCommitArgs *args) {
  if (args == (const RendererSceneCommitArgs *)0) return SCENE_RPC_PARAMS;
  return renderer_scene_rpc_core_commit(state, args->transaction_id, args->transaction_id_length,
    args->expected_generation, args->generation, args->total_bytes, args->total_chunks,
    args->bundle_sha_hex);
}

#ifdef RENDERER_SCENE_RPC_HOST_TEST
u32 renderer_scene_rpc_host_state_bytes(void) { return (u32)sizeof(RendererSceneRpcState); }
void renderer_scene_rpc_host_init(RendererSceneRpcState *state, u32 controller) {
  zero_bytes(state, (u32)sizeof(*state)); state->controller = controller;
}
const u8 *renderer_scene_rpc_host_store(const RendererSceneRpcState *state) { return state->store; }
u32 renderer_scene_rpc_host_generation(const RendererSceneRpcState *state) { return state->committed_generation; }
#endif
