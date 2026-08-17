
typedef unsigned char rv2_asset_u8;
typedef unsigned int rv2_asset_u32;
__attribute__((used,visibility("default"),section(".text.renderer_v2_assets")))
rv2_asset_u32 renderer_v2_decode_assets(rv2_asset_u8 *dst, rv2_asset_u32 dst_bytes,
    const rv2_asset_u8 *src, rv2_asset_u32 src_bytes) {
  rv2_asset_u32 in = 0u, out = 0u;
  while (out < dst_bytes) {
    rv2_asset_u32 flags, bit;
    if (in >= src_bytes) return 0u;
    flags = src[in++];
    for (bit = 1u; bit <= 0x80u && out < dst_bytes; bit <<= 1u) {
      if ((flags & bit) == 0u) {
        if (in >= src_bytes) return 0u;
        dst[out++] = src[in++];
      } else {
        rv2_asset_u32 code, distance, length, index;
        if (src_bytes - in < 2u) return 0u;
        code = (rv2_asset_u32)src[in] | ((rv2_asset_u32)src[in + 1u] << 8u); in += 2u;
        distance = (code & 1023u) + 1u; length = (code >> 10u) + 3u;
        if (distance > out || length > dst_bytes - out) return 0u;
        for (index = 0u; index < length; index++) { dst[out] = dst[out - distance]; out++; }
      }
    }
  }
  return in == src_bytes;
}
