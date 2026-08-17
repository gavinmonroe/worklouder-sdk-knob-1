#define RENDERER_SCENE_RPC_HOST_TEST 1
#include "../examples/renderer-id26/on-device/renderer-v2-generic-scene-rpc-core.c"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static u32 begin_result = GENERIC_UPDATE_READY;
static u32 prepare_calls, stage_calls, commit_calls, abort_calls;
static u32 upload_active, resume_calls;

static u32 begin_upload(void *controller) {
  if (controller != (void *)1 || begin_result != GENERIC_UPDATE_READY ||
      upload_active != 0u) return begin_result == GENERIC_UPDATE_READY ? 0u : begin_result;
  upload_active = 1u;
  return GENERIC_UPDATE_READY;
}
static u32 prepare_package(void *controller, const u8 *package,
    u32 package_bytes, u32 generation) {
  prepare_calls++;
  return controller == (void *)1 && package != NULL && package_bytes >= 20u &&
    read32(package + 8u) == generation;
}
static u32 stage_owned(void *controller) {
  stage_calls++; return controller == (void *)1;
}
static u32 commit_owned(void *controller) {
  commit_calls++;
  if (controller != (void *)1 || upload_active == 0u) return 0u;
  upload_active = 0u;
  return 1u;
}
static u32 abort_upload(void *controller) {
  abort_calls++;
  if (controller != (void *)1 || upload_active == 0u) return 0u;
  upload_active = 0u;
  resume_calls++;
  return 1u;
}

static u8 *load(const char *path, u32 *bytes) {
  FILE *file = fopen(path, "rb"); long length; u8 *value;
  if (file == NULL || fseek(file, 0, SEEK_END) != 0 ||
      (length = ftell(file)) <= 0 || length > GENERIC_MAX_TRANSPORT_BYTES ||
      fseek(file, 0, SEEK_SET) != 0) return NULL;
  value = malloc((size_t)length);
  if (value == NULL || fread(value, 1u, (size_t)length, file) !=
      (size_t)length) return NULL;
  fclose(file); *bytes = (u32)length; return value;
}

static void digest_hex(const u8 *value, u32 bytes, u8 out[65]) {
  static const u8 hex[] = "0123456789abcdef";
  u8 digest[32]; u32 index;
  sha256(value, bytes, digest);
  for (index = 0u; index < 32u; index++) {
    out[index * 2u] = hex[digest[index] >> 4u];
    out[index * 2u + 1u] = hex[digest[index] & 15u];
  }
  out[64] = 0u;
}

static s32 transaction(RendererSceneRpcState *state, const u8 *package,
    u32 bytes, u32 expected, u32 generation) {
  static const u8 id[] = "generic-host-transaction";
  u8 package_sha[65], chunk_sha[65]; u32 chunks, index; s32 result;
  digest_hex(package, bytes, package_sha);
  chunks = (bytes + SCENE_CHUNK_BYTES - 1u) / SCENE_CHUNK_BYTES;
  result = renderer_scene_rpc_core_begin(state, id, sizeof(id) - 1u,
    expected, generation, bytes, chunks, SCENE_CHUNK_BYTES, package_sha);
  if (result != SCENE_RPC_OK) return result;
  for (index = 0u; index < chunks; index++) {
    u32 offset = index * SCENE_CHUNK_BYTES;
    u32 amount = bytes - offset > SCENE_CHUNK_BYTES ?
      SCENE_CHUNK_BYTES : bytes - offset;
    digest_hex(package + offset, amount, chunk_sha);
    result = renderer_scene_rpc_core_write(state, id, sizeof(id) - 1u,
      generation, index, offset, amount, chunk_sha, package + offset, amount);
    if (result != SCENE_RPC_OK) return result;
  }
  return renderer_scene_rpc_core_commit(state, id, sizeof(id) - 1u,
    expected, generation, bytes, chunks, package_sha);
}

enum RecoveryFailure {
  RECOVERY_MALFORMED = 1,
  RECOVERY_ORDER = 2,
  RECOVERY_SHA = 3,
  RECOVERY_BASE64 = 4,
};

static s32 recovery_case(RendererSceneRpcState *state, const u8 *package,
    u32 bytes, enum RecoveryFailure failure, s32 expected_error) {
  static const u8 id[] = "generic-recovery-transaction";
  static const u8 zero_sha[] =
    "0000000000000000000000000000000000000000000000000000000000000000";
  static const u8 malformed_base64[] = "!!!!";
  u8 package_sha[65], chunk_sha[65];
  u32 chunks = (bytes + SCENE_CHUNK_BYTES - 1u) / SCENE_CHUNK_BYTES;
  u32 amount = bytes > SCENE_CHUNK_BYTES ? SCENE_CHUNK_BYTES : bytes;
  u32 abort_before = abort_calls, resume_before = resume_calls;
  s32 result;
  digest_hex(package, bytes, package_sha);
  digest_hex(package, amount, chunk_sha);
  result = renderer_scene_rpc_core_begin(state, id, sizeof(id) - 1u,
    state->committed_generation, state->committed_generation + 1u, bytes,
    chunks, SCENE_CHUNK_BYTES, package_sha);
  if (result != SCENE_RPC_OK || upload_active != 1u) return 40;
  if (failure == RECOVERY_MALFORMED) {
    result = renderer_scene_rpc_core_write(state, id, sizeof(id) - 1u,
      state->committed_generation + 1u, 0u, 0u, amount - 1u, chunk_sha,
      package, amount);
  } else if (failure == RECOVERY_ORDER) {
    result = renderer_scene_rpc_core_write(state, id, sizeof(id) - 1u,
      state->committed_generation + 1u, 1u, SCENE_CHUNK_BYTES, amount,
      chunk_sha, package, amount);
  } else if (failure == RECOVERY_SHA) {
    result = renderer_scene_rpc_core_write(state, id, sizeof(id) - 1u,
      state->committed_generation + 1u, 0u, 0u, amount, zero_sha,
      package, amount);
  } else {
    RendererSceneWriteBase64Args args;
    args.transaction_id = id;
    args.transaction_id_length = sizeof(id) - 1u;
    args.generation = state->committed_generation + 1u;
    args.index = 0u; args.offset = 0u; args.declared_bytes = amount;
    args.chunk_sha_hex = chunk_sha;
    args.base64 = malformed_base64;
    args.base64_bytes = sizeof(malformed_base64) - 1u;
    result = renderer_scene_rpc_core_write_base64_args(state, &args);
  }
  if (result != expected_error || (state->flags & SCENE_FLAG_ACTIVE) != 0u ||
      upload_active != 0u || abort_calls != abort_before + 1u ||
      resume_calls != resume_before + 1u) return 41;
  /* The failed transaction must not advance generation, and the immediately
   * following transaction must be acquirable.  Abort that probe cleanly so
   * the next recovery case starts from the same live prior generation. */
  result = renderer_scene_rpc_core_begin(state, id, sizeof(id) - 1u,
    state->committed_generation, state->committed_generation + 1u, bytes,
    chunks, SCENE_CHUNK_BYTES, package_sha);
  if (result != SCENE_RPC_OK || upload_active != 1u) return 42;
  result = renderer_scene_rpc_core_abort(state, id, sizeof(id) - 1u,
    state->committed_generation + 1u);
  if (result != SCENE_RPC_OK || upload_active != 0u ||
      abort_calls != abort_before + 2u || resume_calls != resume_before + 2u)
    return 43;
  return SCENE_RPC_OK;
}

int main(int argc, char **argv) {
  RendererSceneRpcState *state; u8 *v2a, *v2b, *v1;
  u32 v2a_bytes, v2b_bytes, v1_bytes; u8 decimal[11]; s32 result;
  if (argc != 4) return 90;
  v2a = load(argv[1], &v2a_bytes); v2b = load(argv[2], &v2b_bytes);
  v1 = load(argv[3], &v1_bytes);
  state = calloc(1u, sizeof(*state));
  if (v2a == NULL || v2b == NULL || v1 == NULL || state == NULL) return 91;
  renderer_scene_rpc_host_init(state, 1u);
  renderer_scene_rpc_host_set_generic_begin(begin_upload);
  renderer_scene_rpc_host_set_generic_stage(stage_owned);
  renderer_scene_rpc_host_set_generic_abort(abort_upload);
  renderer_scene_rpc_host_set_v2_prepare(prepare_package);
  renderer_scene_rpc_host_set_v2_commit(commit_owned);
  if (renderer_scene_rpc_u32_decimal(0u, decimal) != 1u ||
      strcmp((const char *)decimal, "0") != 0 ||
      renderer_scene_rpc_u32_decimal(4294967295u, decimal) != 10u ||
      strcmp((const char *)decimal, "4294967295") != 0) return 10;
  if (transaction(state, v2a, v2a_bytes, 0u, 1u) != SCENE_RPC_OK ||
      state->committed_generation != 1u) return 11;
  begin_result = 2u;
  {
    static const u8 id[] = "generic-host-transaction";
    u8 digest[65]; u32 chunks = (v2b_bytes + SCENE_CHUNK_BYTES - 1u) /
      SCENE_CHUNK_BYTES;
    digest_hex(v2b, v2b_bytes, digest);
    result = renderer_scene_rpc_core_begin(state, id, sizeof(id) - 1u,
      1u, 2u, v2b_bytes, chunks, SCENE_CHUNK_BYTES, digest);
    if (result != SCENE_RPC_BUSY || (state->flags & SCENE_FLAG_ACTIVE) != 0u)
      return 12;
  }
  begin_result = GENERIC_UPDATE_READY;
  if (transaction(state, v2b, v2b_bytes, 1u, 2u) != SCENE_RPC_OK ||
      transaction(state, v1, v1_bytes, 2u, 3u) != SCENE_RPC_OK ||
      state->committed_generation != 3u || prepare_calls != 3u ||
      stage_calls != 3u || commit_calls != 3u || abort_calls != 0u) return 13;
  if (recovery_case(state, v2a, v2a_bytes, RECOVERY_MALFORMED,
        SCENE_RPC_RANGE) != SCENE_RPC_OK || state->committed_generation != 3u)
    return 14;
  if (recovery_case(state, v2a, v2a_bytes, RECOVERY_ORDER,
        SCENE_RPC_ORDER) != SCENE_RPC_OK || state->committed_generation != 3u)
    return 15;
  if (recovery_case(state, v2a, v2a_bytes, RECOVERY_SHA,
        SCENE_RPC_SHA) != SCENE_RPC_OK || state->committed_generation != 3u)
    return 16;
  if (recovery_case(state, v2a, v2a_bytes, RECOVERY_BASE64,
        SCENE_RPC_RANGE) != SCENE_RPC_OK || state->committed_generation != 3u)
    return 17;
  if (abort_calls != 8u || resume_calls != 8u || upload_active != 0u)
    return 18;
  puts("decimal=canonical repeated_transactions=3 busy_retry=pass v1_v2=pass recovery=malformed,order,sha,base64 next_begin=pass prior_generation=resume");
  free(state); free(v2a); free(v2b); free(v1); return 0;
}
