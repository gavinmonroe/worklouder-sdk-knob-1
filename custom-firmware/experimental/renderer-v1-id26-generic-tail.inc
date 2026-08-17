/* Appended only by the separate generic Render-v2 builder, after
 * renderer-v1-id26.c.  This keeps the accepted clock/timer source and binary
 * untouched while exposing the exact validator used by the renderer. */
RENDER_EXPORT
u32 renderer_v1_validate_generic_base(const u8 *bundle, u32 length,
    u32 expected_generation) {
  u32 generation, count, active;
  const u8 *descriptor, *raster, *record;
  if (bundle == (const u8 *)0 || length != 62404u ||
      !validate_f1wb(bundle, length, &generation, &count, &active) ||
      generation != expected_generation || count != 1u || active != 0u)
    return 0u;
  descriptor = bundle + F1WB_HEADER;
  if (descriptor[0] != 1u || descriptor[1] != 2u ||
      descriptor[2] == 0u || descriptor[2] > 16u || descriptor[3] != 0u ||
      rd32(descriptor + 4u) != 332u || rd32(descriptor + 8u) != 62072u ||
      rd32(descriptor + 12u) != 0u || rd32(descriptor + 16u) != 0u)
    return 0u;
  raster = bundle + 332u; record = raster + 64u;
  return magic(raster, 'F', '1', 'R', 'A') && raster[4] == 1u &&
    raster[5] == 1u && rd16(raster + 6u) == WIDTH &&
    rd16(raster + 8u) == HEIGHT && rd16(raster + 10u) == 1u &&
    rd32(raster + 24u) == 62072u && rd32(raster + 28u) == FRAME_BYTES &&
    record[0] == 0u && record[1] == 0u && rd16(record + 2u) == 0u &&
    rd32(record + 4u) == FRAME_BYTES;
}

/* Full canonical V1 admission for the dual-envelope Input Lab profile.  This
 * deliberately delegates to the renderer's own recursive F1WB/F1RA/F1SC
 * validator instead of maintaining a second parser. */
RENDER_EXPORT
u32 renderer_v1_validate_generic_bundle(const u8 *bundle, u32 length,
    u32 expected_generation) {
  u32 generation, count, active;
  return bundle != (const u8 *)0 && length >= F1WB_HEADER &&
    length <= F1WB_MAX &&
    validate_f1wb(bundle, length, &generation, &count, &active) &&
    generation == expected_generation && count >= 1u && count <= 3u &&
    active < count;
}
