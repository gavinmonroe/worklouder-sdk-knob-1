#ifndef FRAMER_MQUICKJS_TARGET_FACADE_H
#define FRAMER_MQUICKJS_TARGET_FACADE_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define FRAMER_TF_CANVAS_WIDTH 100u
#define FRAMER_TF_CANVAS_HEIGHT 310u
#define FRAMER_TF_CANVAS_PIXELS 31000u
#define FRAMER_TF_MAILBOX_SLOTS 16u
#define FRAMER_TF_TARGET_COUNT 16u
#define FRAMER_TF_HEADER_BYTES 192u
#define FRAMER_TF_TARGET_BYTES 40u
/* Contract v3 raised this from 4096: variantRaster tables carry pre-rendered
 * RGB565 pixels inside the F2TF section, so the asset cap now matches the
 * space the frozen 96 KB upload container can devote to the facade. */
#define FRAMER_TF_MAX_ASSET_BYTES 65536u
#define FRAMER_TF_MAX_TEXT_BYTES 23u
/* v3: one full frame.  variantRaster blits write exactly rect.w*rect.h pixels
 * and realistic widgets exceed the glyph-era 4096; the base decode already
 * rewrites all 31,000 pixels per tick, so this is the physical ceiling. */
#define FRAMER_TF_MAX_OVERLAY_WRITES 31000u
#define FRAMER_TF_SNAPSHOT_ATTEMPTS 3u

typedef enum {
    FRAMER_TF_OK = 0,
    FRAMER_TF_HIDDEN = 1,
    FRAMER_TF_ERR_ARGUMENT = 2,
    FRAMER_TF_ERR_WRONG_THREAD = 3,
    FRAMER_TF_ERR_MALFORMED = 4,
    FRAMER_TF_ERR_CRC = 5,
    FRAMER_TF_ERR_BASE = 6,
    FRAMER_TF_ERR_TORN = 7,
    FRAMER_TF_ERR_GENERATION = 8,
    FRAMER_TF_ERR_REVISION = 9,
    FRAMER_TF_ERR_FORMAT = 10,
    FRAMER_TF_ERR_OVERFLOW = 11
} framer_tf_result;

/* Layout-compatible with the resident integration's 72-byte publication.
 * admitted_generation is the resident field currently named
 * admitted_revision; the producer writes the active F2JS package generation. */
typedef struct {
    uint32_t sequence;
    int32_t slots[FRAMER_TF_MAILBOX_SLOTS];
    uint32_t admitted_generation;
} framer_tf_mailbox;

typedef struct {
    int32_t slots[FRAMER_TF_MAILBOX_SLOTS];
    uint32_t admitted_generation;
    uint32_t sequence;
} framer_tf_snapshot;

typedef struct {
    uint32_t base_writes;
    uint32_t overlay_writes;
    uint32_t formatted_targets;
    uint32_t snapshot_attempts;
    uint32_t applied_generation;
    uint32_t applied_revision;
} framer_tf_metrics;

typedef struct {
    const uint8_t *asset;
    size_t asset_bytes;
    const uint16_t *base;
    size_t base_pixels;
    uint32_t generation;
    uint32_t last_applied_revision;
    uintptr_t owner_thread_token;
    uint32_t max_overlay_writes;
    uint32_t targets_at;
    uint32_t palette_at;
    uint32_t glyphs_at;
    uint32_t literals_at;
    uint32_t literal_bytes;
    uint16_t glyph_count;
    uint8_t palette_count;
    uint8_t admitted;
} framer_tf_context;

/* Test-only deterministic tear injection. Production callers pass NULL. */
typedef void (*framer_tf_snapshot_probe)(void *opaque,
                                         const framer_tf_mailbox *mailbox);

uint32_t framer_tf_crc32(const uint8_t *bytes, size_t count);

framer_tf_result framer_tf_admit(framer_tf_context *context,
                                 const uint8_t *asset,
                                 size_t asset_bytes,
                                 const uint16_t *base,
                                 size_t base_pixels,
                                 uint32_t expected_generation,
                                 const uint8_t expected_f2js_sha256[32],
                                 const uint8_t expected_contract_sha256[32],
                                 uintptr_t owner_thread_token);

framer_tf_result framer_tf_snapshot_mailbox(
    const framer_tf_mailbox *mailbox,
    framer_tf_snapshot *snapshot,
    framer_tf_snapshot_probe probe,
    void *probe_opaque,
    uint32_t *attempts);

framer_tf_result framer_tf_render(framer_tf_context *context,
                                  const framer_tf_mailbox *mailbox,
                                  uint16_t *framebuffer,
                                  size_t framebuffer_pixels,
                                  uintptr_t current_thread_token,
                                  framer_tf_metrics *metrics);

framer_tf_result framer_tf_render_probe(framer_tf_context *context,
                                        const framer_tf_mailbox *mailbox,
                                        uint16_t *framebuffer,
                                        size_t framebuffer_pixels,
                                        uintptr_t current_thread_token,
                                        framer_tf_metrics *metrics,
                                        framer_tf_snapshot_probe probe,
                                        void *probe_opaque);

#ifdef __cplusplus
}
#endif

#endif
