/*
 * Link-only Render-v2 native contract stub.
 *
 * The combined-image builder uses this source only to freeze the Xtensa ABI
 * while the bounded native F2EP VM is developed.  A module containing this
 * marker is deliberately non-deployable and cannot produce a flash approval.
 */

typedef unsigned short u16;
typedef unsigned int u32;
typedef signed int s32;

#define RENDER_V2_EXPORT __attribute__((section(".text.renderer_v2_native"), used, visibility("default")))

RENDER_V2_EXPORT
void *renderer_v2_native_attach(void *registry, void *navigation,
    void *renderer_v1_controller, const unsigned char *f2ep_ram, u32 f2ep_bytes) {
  (void)registry;
  (void)navigation;
  (void)renderer_v1_controller;
  (void)f2ep_ram;
  (void)f2ep_bytes;
  return (void *)0;
}

RENDER_V2_EXPORT
u32 renderer_v2_native_rpc_register(void *renderer_v1_controller) {
  (void)renderer_v1_controller;
  return 0u;
}

RENDER_V2_EXPORT
u32 renderer_v2_native_host_event(void *renderer_v1_controller, u16 id, s32 value) {
  (void)renderer_v1_controller;
  (void)id;
  (void)value;
  return 0u;
}

RENDER_V2_EXPORT
u32 renderer_v2_native_prepare(void *renderer_v1_controller, const unsigned char *bundle,
    u32 bundle_bytes, const unsigned char *program, u32 program_bytes, u32 generation) {
  (void)renderer_v1_controller; (void)bundle; (void)bundle_bytes;
  (void)program; (void)program_bytes; (void)generation;
  return 0u;
}

RENDER_V2_EXPORT
u32 renderer_v2_native_commit(void *renderer_v1_controller) {
  (void)renderer_v1_controller; return 0u;
}

RENDER_V2_EXPORT
u32 renderer_v2_native_cancel(void *renderer_v1_controller) {
  (void)renderer_v1_controller; return 0u;
}
