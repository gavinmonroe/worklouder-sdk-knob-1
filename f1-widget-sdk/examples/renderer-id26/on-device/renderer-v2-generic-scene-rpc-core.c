/*
 * Generic Render-v2 scene transaction specialization.
 *
 * Reuse the physically exercised base64/SHA/header-last transaction engine,
 * but give begin/commit/abort separate symbols and replace them below with the
 * repeatable F1WB||F2EP ownership handoff.  The accepted clock/timer core is
 * neither edited nor selected by this profile.
 */
#define renderer_scene_rpc_core_begin renderer_scene_rpc_frozen_begin
#define renderer_scene_rpc_core_commit renderer_scene_rpc_frozen_commit
#define renderer_scene_rpc_core_abort renderer_scene_rpc_frozen_abort
#define renderer_scene_rpc_core_begin_args renderer_scene_rpc_frozen_begin_args
#define renderer_scene_rpc_core_commit_args renderer_scene_rpc_frozen_commit_args
#include "renderer-v1-scene-rpc-core.c"
#undef renderer_scene_rpc_core_begin
#undef renderer_scene_rpc_core_commit
#undef renderer_scene_rpc_core_abort
#undef renderer_scene_rpc_core_begin_args
#undef renderer_scene_rpc_core_commit_args

#define GENERIC_F1WB_BYTES 62404u
#define GENERIC_MAX_F1WB_BYTES 98304u
#define GENERIC_MAX_F2EP_BYTES 29824u
#define GENERIC_MAX_PACKAGE_BYTES (GENERIC_F1WB_BYTES + GENERIC_MAX_F2EP_BYTES)
#define GENERIC_MAX_TRANSPORT_BYTES 98304u
#define GENERIC_F2EP_HEADER_BYTES 64u
#define GENERIC_UPDATE_READY 1u

static void generic_decimal_digit(u32 *value, u32 divisor, u8 **out,
    u32 *started) {
  u32 digit = 0u;
  while (*value >= divisor) { *value -= divisor; digit++; }
  if (*started != 0u || digit != 0u) {
    **out = (u8)('0' + digit); (*out)++; *started = 1u;
  }
}

/* Pinned string-only capability ABI: never guess at a stock JSON numeric
 * overload.  The browser strictly parses this canonical unsigned decimal. */
SCENE_EXPORT
u32 renderer_scene_rpc_u32_decimal(u32 value, u8 out[11]) {
  u8 *cursor = out;
  u32 started = 0u;
  if (out == (u8 *)0) return 0u;
  generic_decimal_digit(&value, 1000000000u, &cursor, &started);
  generic_decimal_digit(&value, 100000000u, &cursor, &started);
  generic_decimal_digit(&value, 10000000u, &cursor, &started);
  generic_decimal_digit(&value, 1000000u, &cursor, &started);
  generic_decimal_digit(&value, 100000u, &cursor, &started);
  generic_decimal_digit(&value, 10000u, &cursor, &started);
  generic_decimal_digit(&value, 1000u, &cursor, &started);
  generic_decimal_digit(&value, 100u, &cursor, &started);
  generic_decimal_digit(&value, 10u, &cursor, &started);
  *cursor++ = (u8)('0' + value);
  *cursor = 0u;
  return (u32)(cursor - out);
}

#ifdef RENDERER_SCENE_RPC_HOST_TEST
typedef u32 (*SceneGenericBeginFn)(void *);
typedef u32 (*SceneGenericStageFn)(void *);
typedef u32 (*SceneGenericAbortFn)(void *);
static SceneGenericBeginFn host_generic_begin;
static SceneGenericStageFn host_generic_stage;
static SceneGenericAbortFn host_generic_abort;
void renderer_scene_rpc_host_set_generic_begin(SceneGenericBeginFn value) {
  host_generic_begin = value;
}
void renderer_scene_rpc_host_set_generic_stage(SceneGenericStageFn value) {
  host_generic_stage = value;
}
void renderer_scene_rpc_host_set_generic_abort(SceneGenericAbortFn value) {
  host_generic_abort = value;
}
#else
extern u32 renderer_v2_native_begin_upload(void *renderer);
extern u32 renderer_v2_native_stage(void *renderer);
extern u32 renderer_v2_native_abort_upload(void *renderer);
#endif

static u32 generic_begin_upload(RendererSceneRpcState *state) {
#ifdef RENDERER_SCENE_RPC_HOST_TEST
  return host_generic_begin == (SceneGenericBeginFn)0 ? 0u :
    host_generic_begin((void *)(uptr)state->controller);
#else
  return renderer_v2_native_begin_upload((void *)(uptr)state->controller);
#endif
}
static u32 generic_stage_owned(RendererSceneRpcState *state) {
#ifdef RENDERER_SCENE_RPC_HOST_TEST
  return host_generic_stage == (SceneGenericStageFn)0 ? 0u :
    host_generic_stage((void *)(uptr)state->controller);
#else
  return renderer_v2_native_stage((void *)(uptr)state->controller);
#endif
}
static void generic_abort_upload(RendererSceneRpcState *state) {
#ifdef RENDERER_SCENE_RPC_HOST_TEST
  if (host_generic_abort != (SceneGenericAbortFn)0)
    (void)host_generic_abort((void *)(uptr)state->controller);
#else
  (void)renderer_v2_native_abort_upload((void *)(uptr)state->controller);
#endif
}

SCENE_EXPORT
s32 renderer_scene_rpc_core_begin(RendererSceneRpcState *state,
    const u8 *transaction_id, u32 transaction_id_length,
    u32 expected_generation, u32 generation, u32 total_bytes,
    u32 total_chunks, u32 chunk_raw_bytes, const u8 *bundle_sha_hex) {
  u8 expected_sha[32];
  if (state == (RendererSceneRpcState *)0 || state->controller == 0u ||
      transaction_id == (const u8 *)0 || bundle_sha_hex == (const u8 *)0)
    return SCENE_RPC_PARAMS;
  if ((state->flags & SCENE_FLAG_ACTIVE) != 0u) return SCENE_RPC_BUSY;
  if (!valid_transaction_id(transaction_id, transaction_id_length) ||
      !lower_hex_digest(bundle_sha_hex, expected_sha)) return SCENE_RPC_PARAMS;
  if (expected_generation != state->committed_generation || generation == 0u ||
      generation != expected_generation + 1u) return SCENE_RPC_GENERATION;
  if (total_bytes < 20u || total_bytes > GENERIC_MAX_TRANSPORT_BYTES ||
      chunk_raw_bytes != SCENE_CHUNK_BYTES || total_chunks == 0u ||
      total_chunks > SCENE_MAX_CHUNKS ||
      total_chunks != (total_bytes + SCENE_CHUNK_BYTES - 1u) /
        SCENE_CHUNK_BYTES) return SCENE_RPC_RANGE;
  if (generic_begin_upload(state) != GENERIC_UPDATE_READY) return SCENE_RPC_BUSY;
  state->expected_generation = expected_generation; state->total_bytes = total_bytes;
  state->total_chunks = total_chunks; state->next_chunk = 0u;
  state->received_bytes = 0u; state->transaction_id_length = transaction_id_length;
  zero_bytes(state->transaction_id, 40u);
  copy_bytes(state->transaction_id, transaction_id, transaction_id_length);
  copy_bytes(state->bundle_sha_hex, bundle_sha_hex, 65u);
  zero_bytes(state->header, SCENE_HEADER_BYTES);
  zero_bytes(state->store, SCENE_HEADER_BYTES);
  state->flags = SCENE_FLAG_ACTIVE; barrier(); return SCENE_RPC_OK;
}

SCENE_EXPORT
s32 renderer_scene_rpc_core_commit(RendererSceneRpcState *state,
    const u8 *transaction_id, u32 transaction_id_length,
    u32 expected_generation, u32 generation, u32 total_bytes,
    u32 total_chunks, const u8 *bundle_sha_hex) {
  u8 expected_sha[32], actual_sha[32];
  u32 bundle_bytes, program_bytes, prepared, committed;
  const u8 *program;
  if (state == (RendererSceneRpcState *)0 ||
      transaction_id == (const u8 *)0 || bundle_sha_hex == (const u8 *)0)
    return SCENE_RPC_PARAMS;
  if ((state->flags & SCENE_FLAG_ACTIVE) == 0u) return SCENE_RPC_REJECTED;
  if (transaction_id_length != state->transaction_id_length ||
      !equal_bytes(transaction_id, state->transaction_id, transaction_id_length) ||
      expected_generation != state->expected_generation ||
      generation != expected_generation + 1u || total_bytes != state->total_bytes ||
      total_chunks != state->total_chunks ||
      !equal_bytes(bundle_sha_hex, state->bundle_sha_hex, 65u) ||
      !lower_hex_digest(bundle_sha_hex, expected_sha)) {
    generic_abort_upload(state); invalidate(state); return SCENE_RPC_PARAMS;
  }
  if (state->next_chunk != state->total_chunks ||
      state->received_bytes != state->total_bytes) {
    generic_abort_upload(state); invalidate(state); return SCENE_RPC_TORN;
  }
  bundle_bytes = read32(state->header + 12u);
  if (!basic_f1wb(state, generation, bundle_bytes) ||
      bundle_bytes > GENERIC_MAX_F1WB_BYTES) {
    generic_abort_upload(state); invalidate(state); return SCENE_RPC_F1WB;
  }
  copy_bytes(state->store, state->header, SCENE_HEADER_BYTES); barrier();
  program_bytes = state->total_bytes - bundle_bytes;
  if (program_bytes != 0u) {
    if (bundle_bytes != GENERIC_F1WB_BYTES ||
        state->total_bytes > GENERIC_MAX_PACKAGE_BYTES ||
        program_bytes < GENERIC_F2EP_HEADER_BYTES ||
        program_bytes > GENERIC_MAX_F2EP_BYTES) {
      generic_abort_upload(state); invalidate(state); return SCENE_RPC_V2;
    }
    program = state->store + bundle_bytes;
    if (program[0] != 'F' || program[1] != '2' || program[2] != 'E' ||
        program[3] != 'P' || program[4] != 1u ||
        read32(program + 12u) != program_bytes) {
      generic_abort_upload(state); invalidate(state); return SCENE_RPC_V2;
    }
  }
  sha256(state->store, state->total_bytes, actual_sha);
  if (!equal_bytes(actual_sha, expected_sha, 32u)) {
    generic_abort_upload(state); invalidate(state); return SCENE_RPC_SHA;
  }
#ifdef RENDERER_SCENE_RPC_HOST_TEST
  prepared = host_v2_prepare == (SceneV2PrepareFn)0 ? 0u : host_v2_prepare(
    (void *)(uptr)state->controller, state->store, state->total_bytes, generation);
#else
  prepared = renderer_v2_native_prepare((void *)(uptr)state->controller,
    state->store, state->total_bytes, generation);
#endif
  if (prepared == 0u || generic_stage_owned(state) == 0u) {
    generic_abort_upload(state); invalidate(state); return SCENE_RPC_V2;
  }
#ifdef RENDERER_SCENE_RPC_HOST_TEST
  committed = host_v2_commit == (SceneV2CommitFn)0 ? 0u :
    host_v2_commit((void *)(uptr)state->controller);
#else
  committed = renderer_v2_native_commit((void *)(uptr)state->controller);
#endif
  if (committed == 0u) {
    /* Stage already published an owned, structurally valid base.  Never claim
     * rollback to the overwritten prior program; remain fail-closed. */
    invalidate(state); return SCENE_RPC_V2;
  }
  state->committed_generation = generation; state->flags = 0u;
  barrier(); return SCENE_RPC_OK;
}

SCENE_EXPORT
s32 renderer_scene_rpc_core_abort(RendererSceneRpcState *state,
    const u8 *transaction_id, u32 transaction_id_length, u32 generation) {
  if (state == (RendererSceneRpcState *)0) return SCENE_RPC_BUSY;
  if ((state->flags & SCENE_FLAG_ACTIVE) == 0u ||
      transaction_id == (const u8 *)0 ||
      transaction_id_length != state->transaction_id_length ||
      !equal_bytes(transaction_id, state->transaction_id, transaction_id_length) ||
      generation != state->expected_generation + 1u) return SCENE_RPC_REJECTED;
  generic_abort_upload(state); invalidate(state); return SCENE_RPC_OK;
}

SCENE_EXPORT s32 renderer_scene_rpc_core_begin_args(
    RendererSceneRpcState *state, const RendererSceneBeginArgs *args) {
  if (args == (const RendererSceneBeginArgs *)0) return SCENE_RPC_PARAMS;
  return renderer_scene_rpc_core_begin(state, args->transaction_id,
    args->transaction_id_length, args->expected_generation, args->generation,
    args->total_bytes, args->total_chunks, args->chunk_raw_bytes,
    args->bundle_sha_hex);
}
SCENE_EXPORT s32 renderer_scene_rpc_core_commit_args(
    RendererSceneRpcState *state, const RendererSceneCommitArgs *args) {
  if (args == (const RendererSceneCommitArgs *)0) return SCENE_RPC_PARAMS;
  return renderer_scene_rpc_core_commit(state, args->transaction_id,
    args->transaction_id_length, args->expected_generation, args->generation,
    args->total_bytes, args->total_chunks, args->bundle_sha_hex);
}
