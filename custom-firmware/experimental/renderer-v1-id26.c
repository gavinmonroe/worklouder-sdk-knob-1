/*
 * Renderer-v1 ID26 registration-only firmware candidate.
 *
 * This module never parses HTML/CSS and never owns the upload transport.  It
 * consumes an immutable, canonical F1WB v1 buffer supplied by a separately
 * audited transport, validates every nested record and SHA-256, and publishes
 * the pointer to the 100-ms UI consumer with a release barrier.  The producer
 * must retain the active buffer until a later bundle has become active.
 *
 * Static candidate only: the fixed Framer F1 0.4.1 ABI addresses below are
 * pinned by tools/verify-renderer-v1-id26-abi.mjs.  No setup wrapper or global
 * input hook is present.
 */

typedef unsigned char u8;
typedef unsigned short u16;
typedef unsigned int u32;
typedef signed int s32;
typedef unsigned long long u64;
typedef unsigned long uptr;

#define SCREEN_ID 26u
#define WIDTH 100u
#define HEIGHT 310u
#define PIXELS 31000u
#define FRAME_BYTES 62000u
#define TICK_MS 100u
#define F1WB_HEADER 20u
#define F1WB_DESCRIPTOR 104u
#define F1WB_PAYLOAD 332u
/* The live transport contract is intentionally smaller than the theoretical
 * three-times-128KiB wire maximum.  The current mixed presets fit this cap. */
#define F1WB_MAX 98304u
#define F1RA_MAX 131072u
#define F1SC_MAX 2048u
#define VTABLE_SLOTS 11u
#define RENDERER_ERROR_FROZEN 0x80000000u

#ifdef RENDERER_V1_HOST_TEST
#define RENDER_EXPORT
#define RENDER_USED
#else
#define RENDER_EXPORT __attribute__((section(".text.renderer_v1"), used, visibility("default")))
#define RENDER_USED __attribute__((section(".text.renderer_v1"), used))
#endif

#define FN_NEW ((void *(*)(u32))(uptr)0x420e7c04u)
#define FN_ADD_CONTROLLER ((void (*)(void *, void *))(uptr)0x4204da84u)
#define FN_ADD_NAV ((void (*)(void *, u32))(uptr)0x420293a8u)
#define FN_IMAGE_CREATE ((void *(*)(void *))(uptr)0x420ae8a0u)
#define FN_IMAGE_SET_SRC ((void (*)(void *, const void *))(uptr)0x420aeef0u)
#define FN_OBJ_ALIGN ((void (*)(void *, s32, s32, s32))(uptr)0x4204f0d0u)
#define FN_INPUT_GET ((void *(*)(void))(uptr)0x4200c4c0u)
#define FN_FN_PRESSED ((s32 (*)(void *))(uptr)0x4210bfacu)

#define BASE_VTABLE ((void *)(uptr)0x3c1acc34u)
#define BASE_SLOT0 ((void (*)(void *))(uptr)0x4204d5dcu)
#define BASE_SLOT2 ((void (*)(void *))(uptr)0x4204d694u)
#define BASE_SLOT3 ((void (*)(void *))(uptr)0x4210882cu)
#define BASE_SLOT5 ((void (*)(void *))(uptr)0x4204d6d0u)
#define BASE_SLOT7 ((void (*)(void *))(uptr)0x42108834u)
#define BASE_SLOT10 ((void (*)(void *))(uptr)0x42108844u)

typedef struct {
  u32 header;
  u32 dimensions;
  u32 stride;
  u32 bytes;
  u32 data;
  u32 reserved;
} LvImageDescriptor;

typedef struct Renderer Renderer;
struct Renderer {
  void *vptr;                 /* +0: common controller ABI. */
  u32 common_04;
  u32 common_08;
  void *root;                 /* +12: common root, owned by stock lifecycle. */
  u32 common_16;
  void *registry;             /* +20: addController association postcondition. */
  u8 common_24[4];

  const u8 *active_bundle;    /* +28: immutable producer-owned bytes. */
  u32 active_length;          /* +32 */
  const u8 *pending_bundle;   /* +36: producer publishes this word last. */
  u32 pending_length;         /* +40 */
  u32 active_generation;      /* +44 */
  u32 pending_generation;     /* +48 */
  u32 current_slot;           /* +52 */
  u32 elapsed_tick;           /* +56 */
  void *image;                /* +60: root-owned LVGL child; borrowed pointer. */
  u32 error;                  /* +64: fail-black diagnostic code. */
  LvImageDescriptor descriptor[2]; /* +68: two identities, one pixel buffer. */
  void *local_vtable[VTABLE_SLOTS]; /* +116 */
  u16 framebuffer[PIXELS];    /* +160: the only decoded pixel buffer. */
  const u8 *freeze_request;    /* +62160: UI-thread detach handshake. */
};

#ifndef RENDERER_V1_HOST_TEST
typedef char renderer_size_must_be_62164[(sizeof(Renderer) == 62164u) ? 1 : -1];
#endif

typedef struct { u32 start; u32 end; } Range;

static u16 rd16(const u8 *p) { return (u16)((u16)p[0] | ((u16)p[1] << 8)); }
static u32 rd32(const u8 *p) {
  return (u32)p[0] | ((u32)p[1] << 8) | ((u32)p[2] << 16) | ((u32)p[3] << 24);
}
static void zero_bytes(void *value, u32 length) {
  u8 *p = (u8 *)value;
  while (length-- != 0u) *p++ = 0u;
}
static void copy_bytes(void *to, const void *from, u32 length) {
  u8 *d = (u8 *)to; const u8 *s = (const u8 *)from;
  while (length-- != 0u) *d++ = *s++;
}
/* GCC may lower a fixed-size structure copy to this symbol even with a
 * freestanding build.  Keep the implementation inside the audited module. */
#ifndef RENDERER_V1_HOST_TEST
RENDER_USED
void *memcpy(void *to, const void *from, u32 length) {
  copy_bytes(to, from, length); return to;
}
#endif
static s32 bytes_equal(const u8 *left, const u8 *right, u32 length) {
  u8 difference = 0u;
  while (length-- != 0u) difference |= (u8)(*left++ ^ *right++);
  return difference == 0u;
}
static s32 bytes_zero(const u8 *value, u32 length) {
  while (length-- != 0u) if (*value++ != 0u) return 0;
  return 1;
}
static s32 magic(const u8 *p, u8 a, u8 b, u8 c, u8 d) {
  return p[0] == a && p[1] == b && p[2] == c && p[3] == d;
}
static s32 range_ok(u32 offset, u32 length, u32 total) {
  return offset <= total && length <= total - offset;
}
static u32 min_u32(u32 a, u32 b) { return a < b ? a : b; }
static u32 abs_s32(s32 value) { return (u32)(value < 0 ? -value : value); }
#ifdef RENDERER_V1_HOST_TEST
static void barrier(void) { }
#else
static void barrier(void) { __asm__ __volatile__("memw" ::: "memory"); }
#endif

/* Reject executable-IROM pointers: the F1 crash history proves they are not
 * ordinary byte-addressable data for ROM/LVGL consumers. */
static s32 is_data_range(const void *value, u32 length) {
#ifdef RENDERER_V1_HOST_TEST
  return value != (const void *)0 || length == 0u;
#else
  uptr start = (uptr)value;
  uptr end = start + (uptr)length;
  return start >= (uptr)0x3c000000u && start < (uptr)0x40000000u &&
    end >= start && end <= (uptr)0x40000000u;
#endif
}

/* SHA-256 is local so F1WB/F1RA hashes do not depend on an unproven firmware
 * helper ABI.  -fno-jump-tables keeps this table as instruction literals,
 * never as an ordinary data pointer into IROM. */
static u32 rotr(u32 x, u32 n) { return (x >> n) | (x << (32u - n)); }
static u32 sha_k(u32 i) {
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
static u32 be32(const u8 *p) {
  return ((u32)p[0] << 24) | ((u32)p[1] << 16) | ((u32)p[2] << 8) | p[3];
}
static void sha_transform(u32 h[8], const u8 block[64]) {
  u32 w[64]; u32 i;
  for (i = 0; i < 16u; i++) w[i] = be32(block + i * 4u);
  for (; i < 64u; i++) {
    u32 x = w[i - 15u], y = w[i - 2u];
    u32 s0 = rotr(x, 7u) ^ rotr(x, 18u) ^ (x >> 3);
    u32 s1 = rotr(y, 17u) ^ rotr(y, 19u) ^ (y >> 10);
    w[i] = w[i - 16u] + s0 + w[i - 7u] + s1;
  }
  u32 a = h[0], b = h[1], c = h[2], d = h[3];
  u32 e = h[4], f = h[5], g = h[6], hh = h[7];
  for (i = 0; i < 64u; i++) {
    u32 s1 = rotr(e, 6u) ^ rotr(e, 11u) ^ rotr(e, 25u);
    u32 choice = (e & f) ^ (~e & g);
    u32 t1 = hh + s1 + choice + sha_k(i) + w[i];
    u32 s0 = rotr(a, 2u) ^ rotr(a, 13u) ^ rotr(a, 22u);
    u32 majority = (a & b) ^ (a & c) ^ (b & c);
    u32 t2 = s0 + majority;
    hh = g; g = f; f = e; e = d + t1;
    d = c; c = b; b = a; a = t1 + t2;
  }
  h[0] += a; h[1] += b; h[2] += c; h[3] += d;
  h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
}
static void sha256(const u8 *data, u32 length, u8 out[32]) {
  u32 h[8]; u8 tail[128]; u32 blocks = length / 64u; u32 i;
  h[0] = 0x6a09e667u; h[1] = 0xbb67ae85u;
  h[2] = 0x3c6ef372u; h[3] = 0xa54ff53au;
  h[4] = 0x510e527fu; h[5] = 0x9b05688cu;
  h[6] = 0x1f83d9abu; h[7] = 0x5be0cd19u;
  for (i = 0; i < blocks; i++) sha_transform(h, data + i * 64u);
  u32 remainder = length - blocks * 64u;
  u32 tail_bytes = remainder < 56u ? 64u : 128u;
  zero_bytes(tail, tail_bytes);
  copy_bytes(tail, data + blocks * 64u, remainder);
  tail[remainder] = 0x80u;
  u64 bits = (u64)length * 8u;
  for (i = 0; i < 8u; i++) tail[tail_bytes - 1u - i] = (u8)(bits >> (i * 8u));
  sha_transform(h, tail);
  if (tail_bytes == 128u) sha_transform(h, tail + 64u);
  for (i = 0; i < 8u; i++) {
    out[i * 4u] = (u8)(h[i] >> 24); out[i * 4u + 1u] = (u8)(h[i] >> 16);
    out[i * 4u + 2u] = (u8)(h[i] >> 8); out[i * 4u + 3u] = (u8)h[i];
  }
}
static s32 sha_matches(const u8 *data, u32 length, const u8 *expected) {
  u8 digest[32]; sha256(data, length, digest); return bytes_equal(digest, expected, 32u);
}

static s32 validate_f1ra(const u8 *p, u32 length) {
  if (length < 64u || length > F1RA_MAX || !magic(p, 'F', '1', 'R', 'A') ||
      p[4] != 1u || p[5] != 1u || rd16(p + 6) != WIDTH || rd16(p + 8) != HEIGHT)
    return 0;
  u32 frames = rd16(p + 10), cadence = rd16(p + 12), loop = rd32(p + 16);
  u32 key = rd16(p + 20), tw = p[22], th = p[23];
  if (frames == 0u || frames > 60u || cadence < 100u || cadence % 100u != 0u ||
      rd16(p + 14) != 0u || loop != frames * cadence || key > 60u ||
      tw == 0u || tw > 32u || th == 0u || th > 32u || rd32(p + 24) != length ||
      rd32(p + 28) != FRAME_BYTES || !sha_matches(p + 64, length - 64u, p + 32)) return 0;
  u32 cursor = 64u, frame;
  for (frame = 0; frame < frames; frame++) {
    if (!range_ok(cursor, 8u, length)) return 0;
    u32 type = p[cursor], items = rd16(p + cursor + 2), bytes = rd32(p + cursor + 4);
    if (p[cursor + 1] != 0u || !range_ok(cursor + 8u, bytes, length) ||
        (frame == 0u && type != 0u) || (key != 0u && frame % key == 0u && type != 0u)) return 0;
    u32 pos = cursor + 8u, end = pos + bytes, item;
    if (type == 0u) {
      if (items != 0u || bytes != FRAME_BYTES) return 0;
      pos = end;
    } else if (type == 1u) {
      if (bytes != items * 4u) return 0;
      u32 previous = 0u;
      for (item = 0; item < items; item++, pos += 4u) {
        u32 pixel = rd16(p + pos);
        if (pixel >= PIXELS || (item != 0u && pixel <= previous)) return 0;
        previous = pixel;
      }
    } else if (type == 2u) {
      u32 previous_end = 0u;
      for (item = 0; item < items; item++) {
        if (!range_ok(pos, 4u, end)) return 0;
        u32 start = rd16(p + pos), count = rd16(p + pos + 2); pos += 4u;
        if (count == 0u || start < previous_end || start > PIXELS || count > PIXELS - start ||
            !range_ok(pos, count * 2u, end)) return 0;
        pos += count * 2u; previous_end = start + count;
      }
    } else if (type == 3u) {
      u32 columns = (WIDTH + tw - 1u) / tw, rows = (HEIGHT + th - 1u) / th;
      u32 previous = 0u;
      for (item = 0; item < items; item++) {
        if (!range_ok(pos, 2u, end)) return 0;
        u32 tile = rd16(p + pos); pos += 2u;
        if (tile >= columns * rows || (item != 0u && tile <= previous)) return 0;
        u32 x = (tile % columns) * tw, y = (tile / columns) * th;
        u32 tile_bytes = min_u32(tw, WIDTH - x) * min_u32(th, HEIGHT - y) * 2u;
        if (!range_ok(pos, tile_bytes, end)) return 0;
        pos += tile_bytes; previous = tile;
      }
    } else return 0;
    if (pos != end) return 0;
    cursor = end;
  }
  return cursor == length;
}

typedef struct {
  const u8 *scene;
  u32 scene_length;
  const u8 *atlas;
  u32 atlas_length;
  u32 glyph_count;
  u32 cell_count;
  u32 animation_count;
  u32 track_count;
  u32 cells_offset;
  u32 animations_offset;
  u32 tracks_offset;
  u32 atlas_width;
  u32 atlas_height;
  u32 atlas_stride;
} SemanticView;

static s32 validate_semantic(const u8 *scene, u32 scene_length, const u8 *atlas,
    u32 atlas_length, SemanticView *view) {
  if (scene_length < 24u || scene_length > F1SC_MAX || !magic(scene, 'F', '1', 'S', 'C') ||
      scene[4] != 1u || scene[5] != WIDTH || rd16(scene + 6) != HEIGHT ||
      rd16(scene + 8) != TICK_MS || scene[10] != 5u || scene[11] != 15u) return 0;
  u32 cells = rd16(scene + 12), glyphs = rd16(scene + 14);
  u32 animations = rd16(scene + 16), tracks = rd16(scene + 18);
  if (cells == 0u || cells > 75u || glyphs == 0u || glyphs > 255u ||
      animations > 16u || tracks > 16u) return 0;
  u32 glyph_offset = 24u, cell_offset = glyph_offset + glyphs * 4u;
  u32 animation_offset = cell_offset + cells * 8u;
  u32 track_offset = animation_offset + animations * 8u;
  if (!range_ok(glyph_offset, glyphs * 4u, scene_length) ||
      !range_ok(cell_offset, cells * 8u, scene_length) ||
      !range_ok(animation_offset, animations * 8u, scene_length)) return 0;
  u32 i;
  for (i = 0; i < glyphs; i++) {
    u32 cp = rd32(scene + glyph_offset + i * 4u);
    if (cp > 0x10ffffu || (cp >= 0xd800u && cp <= 0xdfffu)) return 0;
  }
  for (i = 0; i < cells; i++) {
    const u8 *cell = scene + cell_offset + i * 8u;
    u32 x = cell[0], y = rd16(cell + 1), animation = cell[4];
    if (x >= WIDTH || y >= HEIGHT || x + 20u > WIDTH || y + 20u > HEIGHT ||
        cell[3] >= glyphs || (animation != 255u && animation >= animations) || cell[7] > 3u) return 0;
  }
  for (i = 0; i < animations; i++) {
    const u8 *animation = scene + animation_offset + i * 8u;
    if (rd16(animation) == 0u || animation[4] >= tracks || animation[5] > 1u ||
        rd16(animation + 6) != 0u) return 0;
  }
  u32 cursor = track_offset;
  for (i = 0; i < tracks; i++) {
    if (!range_ok(cursor, 4u, scene_length)) return 0;
    u32 stops = scene[cursor];
    if (stops < 2u || stops > 8u || !bytes_zero(scene + cursor + 1u, 3u) ||
        !range_ok(cursor + 4u, stops * 8u, scene_length)) return 0;
    u32 stop, previous = 0u;
    for (stop = 0; stop < stops; stop++) {
      const u8 *record = scene + cursor + 4u + stop * 8u;
      if (record[0] > 100u || record[5] > 3u || (stop != 0u && record[0] <= previous)) return 0;
      if ((stop == 0u && record[0] != 0u) || (stop + 1u == stops && record[0] != 100u)) return 0;
      previous = record[0];
    }
    cursor += 4u + stops * 8u;
  }
  if (cursor != scene_length || atlas_length < 16u || !magic(atlas, 'F', '1', 'G', 'A') ||
      atlas[4] != 1u || atlas[5] != 1u) return 0; /* Reject testOnly bit. */
  u32 aw = atlas[6], ah = atlas[7], ag = rd16(atlas + 8), stride = rd16(atlas + 10);
  u32 payload = rd32(atlas + 12);
  if (aw == 0u || aw > 20u || ah == 0u || ah > 20u || ag != glyphs ||
      stride != (aw + 7u) / 8u || payload != glyphs * stride * ah ||
      atlas_length != 16u + payload) return 0;
  view->scene = scene; view->scene_length = scene_length;
  view->atlas = atlas; view->atlas_length = atlas_length;
  view->glyph_count = glyphs; view->cell_count = cells;
  view->animation_count = animations; view->track_count = tracks;
  view->cells_offset = cell_offset; view->animations_offset = animation_offset;
  view->tracks_offset = track_offset; view->atlas_width = aw;
  view->atlas_height = ah; view->atlas_stride = stride;
  return 1;
}

static s32 validate_f1wb(const u8 *p, u32 length, u32 *generation, u32 *count, u32 *active) {
  if (!is_data_range(p, length) || length < F1WB_PAYLOAD || length > F1WB_MAX ||
      !magic(p, 'F', '1', 'W', 'B') || p[4] != 1u || p[5] != 3u ||
      rd32(p + 12) != length || rd16(p + 16) != F1WB_DESCRIPTOR ||
      rd16(p + 18) != F1WB_PAYLOAD) return 0;
  u32 slots = p[6], selected = p[7], i, ranges_count = 0u;
  Range ranges[6]; SemanticView semantic;
  if (slots == 0u || slots > 3u || selected >= slots) return 0;
  for (i = 0; i < slots; i++) {
    const u8 *d = p + F1WB_HEADER + i * F1WB_DESCRIPTOR;
    u32 kind = d[1], name = d[2], po = rd32(d + 4), pl = rd32(d + 8);
    u32 ao = rd32(d + 12), al = rd32(d + 16);
    if (d[0] != 1u || (kind != 1u && kind != 2u) || name == 0u || name > 16u || d[3] != 0u ||
        !bytes_zero(d + 100, 4u) || pl == 0u || po < F1WB_PAYLOAD || (po & 3u) != 0u ||
        !range_ok(po, pl, length)) return 0;
    if (kind == 1u) {
      if (al == 0u || ao < F1WB_PAYLOAD || (ao & 3u) != 0u || !range_ok(ao, al, length)) return 0;
    } else if (ao != 0u || al != 0u) return 0;
    if (!sha_matches(p + po, pl, d + 20) || !sha_matches(p + ao, al, d + 52)) return 0;
    ranges[ranges_count].start = po; ranges[ranges_count++].end = po + pl;
    if (al != 0u) { ranges[ranges_count].start = ao; ranges[ranges_count++].end = ao + al; }
    if (kind == 1u) {
      if (!validate_semantic(p + po, pl, p + ao, al, &semantic)) return 0;
    } else if (!validate_f1ra(p + po, pl)) return 0;
  }
  for (; i < 3u; i++) if (!bytes_zero(p + F1WB_HEADER + i * F1WB_DESCRIPTOR, F1WB_DESCRIPTOR)) return 0;
  for (i = 0; i < ranges_count; i++) {
    u32 j;
    for (j = i + 1u; j < ranges_count; j++)
      if (ranges[i].start < ranges[j].end && ranges[j].start < ranges[i].end) return 0;
  }
  *generation = rd32(p + 8); *count = slots; *active = selected;
  return 1;
}

static void black(Renderer *renderer) {
  zero_bytes(renderer->framebuffer, FRAME_BYTES);
}

static s32 apply_raster_record(const u8 *binary, u32 length, u32 cursor, u16 *framebuffer) {
  if (!range_ok(cursor, 8u, length)) return 0;
  u32 type = binary[cursor], items = rd16(binary + cursor + 2);
  u32 bytes = rd32(binary + cursor + 4), pos = cursor + 8u, end;
  if (!range_ok(pos, bytes, length)) return 0;
  end = pos + bytes;
  if (type == 0u) { copy_bytes(framebuffer, binary + pos, FRAME_BYTES); pos = end; }
  else if (type == 1u) {
    u32 i; for (i = 0; i < items; i++, pos += 4u)
      framebuffer[rd16(binary + pos)] = rd16(binary + pos + 2);
  } else if (type == 2u) {
    u32 i; for (i = 0; i < items; i++) {
      u32 start = rd16(binary + pos), count = rd16(binary + pos + 2); pos += 4u;
      copy_bytes(framebuffer + start, binary + pos, count * 2u); pos += count * 2u;
    }
  } else if (type == 3u) {
    u32 tw = binary[22], th = binary[23], columns = (WIDTH + tw - 1u) / tw, i;
    for (i = 0; i < items; i++) {
      u32 tile = rd16(binary + pos); pos += 2u;
      u32 x = (tile % columns) * tw, y = (tile / columns) * th;
      u32 actual_width = min_u32(tw, WIDTH - x), actual_height = min_u32(th, HEIGHT - y), row;
      for (row = 0; row < actual_height; row++) {
        copy_bytes(framebuffer + (y + row) * WIDTH + x, binary + pos, actual_width * 2u);
        pos += actual_width * 2u;
      }
    }
  } else return 0;
  return pos == end;
}

static s32 render_f1ra(const u8 *binary, u32 length, u32 tick, u16 *framebuffer) {
  u32 frames = rd16(binary + 10), cadence_ticks = rd16(binary + 12) / TICK_MS;
  u32 loop_ticks = frames * cadence_ticks;
  u32 target = (tick % loop_ticks) / cadence_ticks, cursor = 64u, frame;
  for (frame = 0; frame <= target; frame++) {
    if (!apply_raster_record(binary, length, cursor, framebuffer)) return 0;
    cursor += 8u + rd32(binary + cursor + 4);
  }
  return 1;
}

static const u8 *track_at(const SemanticView *view, u32 wanted) {
  const u8 *p = view->scene + view->tracks_offset; u32 i;
  for (i = 0; i < wanted; i++) p += 4u + (u32)p[0] * 8u;
  return p;
}
static u32 divide_round_u64(u64 numerator, u32 denominator) {
  return (u32)((numerator + denominator / 2u) / denominator);
}
static s32 mix_q(s32 left, s32 right, u32 amount) {
  s32 difference = right - left;
  s32 adjustment = (s32)divide_round_u64((u64)abs_s32(difference) * amount, 65535u);
  return difference < 0 ? left - adjustment : left + adjustment;
}
static u16 rgba_over_background(u32 r, u32 g, u32 b, u32 a, u16 background) {
  u32 br5 = (background >> 11) & 31u, bg6 = (background >> 5) & 63u, bb5 = background & 31u;
  u32 br = (br5 << 3) | (br5 >> 2), bg = (bg6 << 2) | (bg6 >> 4), bb = (bb5 << 3) | (bb5 >> 2);
  r = (r * a + br * (255u - a) + 127u) / 255u;
  g = (g * a + bg * (255u - a) + 127u) / 255u;
  b = (b * a + bb * (255u - a) + 127u) / 255u;
  return (u16)(((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3));
}
static u16 blend565(u16 background, u16 foreground, u32 alpha) {
  u32 br5 = (background >> 11) & 31u, bg6 = (background >> 5) & 63u, bb5 = background & 31u;
  u32 fr5 = (foreground >> 11) & 31u, fg6 = (foreground >> 5) & 63u, fb5 = foreground & 31u;
  u32 br = (br5 << 3) | (br5 >> 2), bg = (bg6 << 2) | (bg6 >> 4), bb = (bb5 << 3) | (bb5 >> 2);
  u32 fr = (fr5 << 3) | (fr5 >> 2), fg = (fg6 << 2) | (fg6 >> 4), fb = (fb5 << 3) | (fb5 >> 2);
  u32 inverse = 255u - alpha;
  u32 r = (fr * alpha + br * inverse + 127u) / 255u;
  u32 g = (fg * alpha + bg * inverse + 127u) / 255u;
  u32 b = (fb * alpha + bb * inverse + 127u) / 255u;
  return (u16)(((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3));
}
static s32 mask_pixel(const SemanticView *view, u32 glyph, s32 x, s32 y) {
  if (x < 0 || y < 0 || (u32)x >= view->atlas_width || (u32)y >= view->atlas_height) return 0;
  const u8 *mask = view->atlas + 16u + glyph * view->atlas_stride * view->atlas_height;
  return (mask[(u32)y * view->atlas_stride + ((u32)x >> 3)] >> (7u - ((u32)x & 7u))) & 1u;
}
static void sample_cell(const SemanticView *view, const u8 *cell, u32 tick, u16 *color, u32 *glow) {
  u32 animation_id = cell[4];
  *color = rd16(cell + 5); *glow = cell[7];
  if (animation_id == 255u) return;
  const u8 *animation = view->scene + view->animations_offset + animation_id * 8u;
  u32 duration = rd16(animation), delay = rd16(animation + 2);
  if (tick < delay) return;
  u32 phase = (tick - delay) % duration;
  const u8 *track = track_at(view, animation[4]); u32 stops = track[0], right = 0u;
  const u8 *records = track + 4u;
  while (right < stops && (u32)records[right * 8u] * duration < phase * 100u) right++;
  if (right == 0u) right = 1u;
  if (right >= stops) right = stops - 1u;
  const u8 *left = records + (right - 1u) * 8u, *r = records + right * 8u;
  u32 denominator = ((u32)r[0] - left[0]) * duration;
  u32 base = (u32)left[0] * duration;
  u32 numerator = phase * 100u > base ? phase * 100u - base : 0u;
  u32 amount = divide_round_u64((u64)numerator * 65535u, denominator == 0u ? 1u : denominator);
  if (amount > 65535u) amount = 65535u;
  if (animation[5] == 1u) {
    u32 squared = divide_round_u64((u64)amount * amount, 65535u);
    u32 cubed = divide_round_u64((u64)squared * amount, 65535u);
    amount = 3u * squared >= 2u * cubed ? 3u * squared - 2u * cubed : 0u;
    if (amount > 65535u) amount = 65535u;
  }
  u32 red = (u32)mix_q(left[1], r[1], amount), green = (u32)mix_q(left[2], r[2], amount);
  u32 blue = (u32)mix_q(left[3], r[3], amount), alpha = (u32)mix_q(left[4], r[4], amount);
  *glow = (u32)mix_q(left[5], r[5], amount);
  *color = rgba_over_background(red, green, blue, alpha, rd16(view->scene + 20));
}

static s32 render_semantic(const u8 *scene, u32 scene_length, const u8 *atlas, u32 atlas_length,
    u32 tick, u16 *framebuffer) {
  SemanticView view;
  if (!validate_semantic(scene, scene_length, atlas, atlas_length, &view)) return 0;
  u16 background = rd16(scene + 20); u32 i;
  for (i = 0; i < PIXELS; i++) framebuffer[i] = background;
  for (i = 0; i < view.cell_count; i++) {
    const u8 *cell = scene + view.cells_offset + i * 8u;
    u16 color; u32 radius; sample_cell(&view, cell, tick, &color, &radius);
    s32 x0 = (s32)cell[0] + (s32)(20u - view.atlas_width) / 2;
    s32 y0 = (s32)rd16(cell + 1) + (s32)(20u - view.atlas_height) / 2;
    s32 gy;
    for (gy = -(s32)radius; gy < (s32)view.atlas_height + (s32)radius; gy++) {
      s32 y = y0 + gy, cell_y = (s32)rd16(cell + 1);
      if (y < cell_y || y >= cell_y + 20 || y < 0 || y >= (s32)HEIGHT) continue;
      s32 gx;
      for (gx = -(s32)radius; gx < (s32)view.atlas_width + (s32)radius; gx++) {
        s32 x = x0 + gx, cell_x = cell[0];
        if (x < cell_x || x >= cell_x + 20 || x < 0 || x >= (s32)WIDTH) continue;
        s32 solid = mask_pixel(&view, cell[3], gx, gy);
        u32 distance = solid ? 0u : radius + 1u;
        if (!solid && radius != 0u) {
          s32 dy, dx;
          for (dy = -(s32)radius; dy <= (s32)radius; dy++) for (dx = -(s32)radius; dx <= (s32)radius; dx++) {
            u32 candidate = min_u32(0xffffffffu, abs_s32(dx) > abs_s32(dy) ? abs_s32(dx) : abs_s32(dy));
            if (candidate < distance && mask_pixel(&view, cell[3], gx + dx, gy + dy)) distance = candidate;
          }
        }
        if (distance <= radius) {
          u32 pixel = (u32)y * WIDTH + (u32)x;
          if (distance == 0u) framebuffer[pixel] = color;
          else {
            u32 alpha = ((radius - distance + 1u) * 192u) / (radius + 1u);
            if (alpha > 192u) alpha = 192u;
            framebuffer[pixel] = blend565(framebuffer[pixel], color, alpha);
          }
        }
      }
    }
  }
  return 1;
}

static s32 render_slot(Renderer *renderer) {
  const u8 *bundle = renderer->active_bundle; u32 length = renderer->active_length;
  if (bundle == (const u8 *)0 || length < F1WB_PAYLOAD) return 0;
  u32 count = bundle[6]; if (count == 0u || renderer->current_slot >= count) return 0;
  const u8 *d = bundle + F1WB_HEADER + renderer->current_slot * F1WB_DESCRIPTOR;
  u32 po = rd32(d + 4), pl = rd32(d + 8), ao = rd32(d + 12), al = rd32(d + 16);
  if (!range_ok(po, pl, length) || (al != 0u && !range_ok(ao, al, length))) return 0;
  if (d[1] == 1u) return render_semantic(bundle + po, pl, bundle + ao, al,
      renderer->elapsed_tick, renderer->framebuffer);
  if (d[1] == 2u) return render_f1ra(bundle + po, pl, renderer->elapsed_tick, renderer->framebuffer);
  return 0;
}

#ifdef RENDERER_V1_HOST_TEST
/* Host-only golden-test surface.  It is absent from the Xtensa artifact. */
s32 renderer_v1_host_validate(const u8 *bundle, u32 length) {
  u32 generation, count, active;
  return validate_f1wb(bundle, length, &generation, &count, &active);
}
s32 renderer_v1_host_render(const u8 *bundle, u32 length, u32 slot, u32 tick, u8 *output) {
  u32 generation, count, active; Renderer renderer;
  if (!validate_f1wb(bundle, length, &generation, &count, &active) || slot >= count) return 0;
  zero_bytes(&renderer, (u32)sizeof(renderer));
  renderer.active_bundle = bundle; renderer.active_length = length;
  renderer.current_slot = slot; renderer.elapsed_tick = tick;
  if (!render_slot(&renderer)) return 0;
  copy_bytes(output, renderer.framebuffer, FRAME_BYTES); return 1;
}
#endif

static void refresh_image(Renderer *renderer) {
  if (renderer->image != (void *)0) {
    const LvImageDescriptor *descriptor = &renderer->descriptor[renderer->elapsed_tick & 1u];
    FN_IMAGE_SET_SRC(renderer->image, descriptor);
  }
}

/* Begin gate for the transport, checked before it writes byte zero.  A second
 * store may be used while the first is active; the active store itself may
 * never be overwritten in place. */
RENDER_EXPORT
s32 renderer_v1_can_begin(Renderer *renderer, const u8 *store) {
  return renderer != (Renderer *)0 && store != (const u8 *)0 &&
    renderer->pending_bundle == (const u8 *)0 && store != renderer->active_bundle &&
    is_data_range(store, F1WB_MAX);
}

/* Producer/UI handshake for repeated use of one staging store.  The producer
 * may write immediately while the store differs from the active bundle.  If
 * it is active, request a UI-tick detach and return BUSY; the host retries the
 * same begin after one 100-ms tick. */
RENDER_EXPORT
s32 renderer_v1_prepare_store(Renderer *renderer, const u8 *store) {
  if (renderer == (Renderer *)0 || store == (const u8 *)0 ||
      renderer->pending_bundle != (const u8 *)0 || !is_data_range(store, F1WB_MAX)) return 0;
  if (store != renderer->active_bundle) return renderer->freeze_request == (const u8 *)0;
  renderer->freeze_request = store;
  barrier();
  return 0;
}

/* Producer API.  Result: 1 accepted, 0 rejected.  No LVGL calls occur here. */
RENDER_EXPORT
s32 renderer_v1_stage_bundle(Renderer *renderer, const u8 *bundle, u32 length) {
  u32 generation, count, active;
  if (!renderer_v1_can_begin(renderer, bundle) ||
      !validate_f1wb(bundle, length, &generation, &count, &active)) return 0;
  (void)count; (void)active;
  if (renderer->active_bundle != (const u8 *)0 && generation <= renderer->active_generation) return 0;
  renderer->pending_length = length;
  renderer->pending_generation = generation;
  barrier();
  renderer->pending_bundle = bundle;
  barrier();
  return 1;
}

RENDER_EXPORT
void renderer_v1_build(Renderer *renderer) {
  if ((renderer->error & RENDERER_ERROR_FROZEN) == 0u) black(renderer);
  renderer->elapsed_tick = 0u;
  renderer->image = FN_IMAGE_CREATE(renderer->root);
  if (renderer->image != (void *)0) {
    FN_IMAGE_SET_SRC(renderer->image, &renderer->descriptor[0]);
    FN_OBJ_ALIGN(renderer->image, 9, 0, 0);
  } else renderer->error = 1u;
}

RENDER_EXPORT
void renderer_v1_cleanup(Renderer *renderer) {
  renderer->image = (void *)0; /* Root owns and deletes the child. */
  renderer->elapsed_tick = 0u;
}

RENDER_EXPORT
u32 renderer_v1_id(Renderer *renderer) { (void)renderer; return SCREEN_ID; }

RENDER_EXPORT
void renderer_v1_encoder(Renderer *renderer, u32 encoder, u32 raw_delta) {
  if (encoder != 1u || (s32)(signed char)(u8)raw_delta == 0) return;
  void *input = FN_INPUT_GET();
  if (input == (void *)0 || !FN_FN_PRESSED(input)) return;
  const u8 *bundle = renderer->active_bundle; if (bundle == (const u8 *)0) return;
  u32 count = bundle[6]; if (count == 0u || count > 3u) return;
  if ((s32)(signed char)(u8)raw_delta > 0)
    renderer->current_slot = renderer->current_slot + 1u < count ? renderer->current_slot + 1u : 0u;
  else renderer->current_slot = renderer->current_slot == 0u ? count - 1u : renderer->current_slot - 1u;
  renderer->elapsed_tick = 0u;
}

RENDER_EXPORT
void renderer_v1_tick(Renderer *renderer) {
  const u8 *freeze = renderer->freeze_request;
  if (freeze != (const u8 *)0) {
    barrier();
    if (renderer->active_bundle == freeze) {
      renderer->active_bundle = (const u8 *)0;
      renderer->active_length = 0u;
      renderer->error = RENDERER_ERROR_FROZEN;
    }
    /* Publish the detached active pointer before acknowledging the producer.
     * The RPC task may begin overwriting the store as soon as it observes the
     * cleared request. */
    barrier();
    renderer->freeze_request = (const u8 *)0;
    barrier();
    return;
  }
  const u8 *pending = renderer->pending_bundle;
  if (pending != (const u8 *)0) {
    barrier();
    u32 old_count = renderer->active_bundle == (const u8 *)0 ? 0u : renderer->active_bundle[6];
    u32 new_count = pending[6];
    renderer->active_bundle = pending; renderer->active_length = renderer->pending_length;
    renderer->active_generation = renderer->pending_generation;
    renderer->current_slot = old_count == 0u ? pending[7] : renderer->current_slot % new_count;
    renderer->elapsed_tick = 0u; renderer->pending_bundle = (const u8 *)0;
    renderer->pending_length = 0u; renderer->pending_generation = 0u;
    renderer->error = 0u; barrier();
  }
  if (renderer->active_bundle == (const u8 *)0) return;
  if (!render_slot(renderer)) { renderer->error = 2u; black(renderer); }
  else renderer->error = 0u;
  refresh_image(renderer);
  renderer->elapsed_tick++;
}

/* Registration-only ABI: a2=registry, a3=navigation; returns controller/null. */
RENDER_EXPORT
Renderer *renderer_v1_register_id26(void *registry, void *navigation) {
  if (registry == (void *)0 || navigation == (void *)0) return (Renderer *)0;
  Renderer *renderer = (Renderer *)FN_NEW((u32)sizeof(Renderer));
  if (renderer == (Renderer *)0) return (Renderer *)0;
  zero_bytes(renderer, (u32)sizeof(Renderer));
  *(void *volatile *)&renderer->vptr = BASE_VTABLE;
  barrier();
  renderer->common_24[2] = 10u;
  renderer->descriptor[0].header = 0x00001219u;
  renderer->descriptor[0].dimensions = 0x01360064u;
  renderer->descriptor[0].stride = 200u;
  renderer->descriptor[0].bytes = FRAME_BYTES;
  renderer->descriptor[0].data = (u32)(uptr)renderer->framebuffer;
  renderer->descriptor[1] = renderer->descriptor[0];
  renderer->local_vtable[0] = (void *)BASE_SLOT0;
  renderer->local_vtable[1] = (void *)renderer_v1_build;
  renderer->local_vtable[2] = (void *)BASE_SLOT2;
  renderer->local_vtable[3] = (void *)BASE_SLOT3;
  renderer->local_vtable[4] = (void *)renderer_v1_cleanup;
  renderer->local_vtable[5] = (void *)BASE_SLOT5;
  renderer->local_vtable[6] = (void *)renderer_v1_tick;
  renderer->local_vtable[7] = (void *)BASE_SLOT7;
  renderer->local_vtable[8] = (void *)renderer_v1_id;
  renderer->local_vtable[9] = (void *)renderer_v1_encoder;
  renderer->local_vtable[10] = (void *)BASE_SLOT10;
  renderer->vptr = renderer->local_vtable;
  FN_ADD_CONTROLLER(registry, renderer);
  if (renderer->registry != registry) return (Renderer *)0;
  FN_ADD_NAV(navigation, SCREEN_ID);
  return renderer;
}
