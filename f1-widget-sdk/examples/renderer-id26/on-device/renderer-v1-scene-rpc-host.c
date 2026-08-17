#define RENDERER_SCENE_RPC_HOST_TEST 1
#include "renderer-v1-scene-rpc-core.c"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

extern s32 renderer_v1_host_validate(const u8 *bundle, u32 length);

static const u8 *wanted_bundle;
static u32 wanted_length;
static u32 wanted_stage_length;
static u32 stage_calls;
static u32 v2_prepare_calls;
static u32 v2_commit_calls;
static u32 v2_cancel_calls;
static const char *wanted_mode;

static s32 prepare(void *controller, const u8 *store) {
  return controller == (void *)1 && store != NULL;
}

static s32 stage(void *controller, const u8 *bundle, u32 length) {
  stage_calls++;
  return strcmp(wanted_mode, "focus-stage-fail") != 0 && controller == (void *)1 &&
    length == wanted_stage_length && memcmp(bundle, wanted_bundle, length) == 0 &&
    renderer_v1_host_validate(bundle, length);
}

static u32 v2_prepare(void *controller, const u8 *package,
    u32 package_bytes, u32 generation) {
  v2_prepare_calls++;
  if (strcmp(wanted_mode, "focus-prepare-fail") == 0) return 0u;
  return controller == (void *)1 && package_bytes == SCENE_FOCUS_TIMER_PACKAGE_BYTES &&
    generation == 1u && memcmp(package, wanted_bundle, wanted_length) == 0;
}

static u32 v2_commit(void *controller) {
  v2_commit_calls++;
  return controller == (void *)1 && strcmp(wanted_mode, "focus-commit-fail") != 0;
}

static u32 v2_cancel(void *controller) {
  v2_cancel_calls++;
  return controller == (void *)1;
}

static u8 *load(const char *file, u32 *length) {
  FILE *stream = fopen(file, "rb"); long bytes; u8 *value;
  if (stream == NULL || fseek(stream, 0, SEEK_END) != 0 || (bytes = ftell(stream)) <= 0 ||
      fseek(stream, 0, SEEK_SET) != 0) return NULL;
  value = (u8 *)malloc((size_t)bytes);
  if (value == NULL || fread(value, 1, (size_t)bytes, stream) != (size_t)bytes) return NULL;
  fclose(stream); *length = (u32)bytes; return value;
}
static u32 encode64(const u8 *input, u32 bytes, u8 *output) {
  static const char digits[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  u32 in = 0u, out = 0u;
  while (in < bytes) {
    u32 remaining = bytes - in;
    u32 a = input[in++], b = remaining > 1u ? input[in++] : 0u, c = remaining > 2u ? input[in++] : 0u;
    output[out++] = (u8)digits[a >> 2]; output[out++] = (u8)digits[((a & 3u) << 4) | (b >> 4)];
    output[out++] = remaining > 1u ? (u8)digits[((b & 15u) << 2) | (c >> 6)] : (u8)'=';
    output[out++] = remaining > 2u ? (u8)digits[c & 63u] : (u8)'=';
  }
  return out;
}

int main(int argc, char **argv) {
  static const u8 transaction[] = "f1wb-00000001-hosttest";
  const char *mode; const u8 *bundle_sha; RendererSceneRpcState *state;
  u8 *bundle; u32 length, chunks, index; s32 result;
  if (argc < 5) return 90;
  mode = argv[1]; bundle = load(argv[2], &length); bundle_sha = (const u8 *)argv[3];
  if (bundle == NULL || strlen((const char *)bundle_sha) != 64u) return 91;
  chunks = (length + SCENE_CHUNK_BYTES - 1u) / SCENE_CHUNK_BYTES;
  if (argc != (int)(4u + chunks)) return 92;
  state = (RendererSceneRpcState *)malloc(sizeof(*state));
  if (state == NULL) return 93;
  renderer_scene_rpc_host_init(state, 1u);
  renderer_scene_rpc_host_set_stage(stage);
  renderer_scene_rpc_host_set_prepare(prepare);
  wanted_bundle = bundle; wanted_length = length; wanted_stage_length = length; wanted_mode = mode;
  if (strncmp(mode, "focus-", 6u) == 0) {
    if (length != SCENE_FOCUS_TIMER_PACKAGE_BYTES) return 94;
    wanted_stage_length = SCENE_FOCUS_F1WB_BYTES;
    renderer_scene_rpc_host_set_v2_prepare(v2_prepare);
    renderer_scene_rpc_host_set_v2_commit(v2_commit);
    renderer_scene_rpc_host_set_v2_cancel(v2_cancel);
  }
  result = renderer_scene_rpc_core_begin(state, transaction, (u32)sizeof(transaction) - 1u,
    0u, 1u, length, chunks, SCENE_CHUNK_BYTES, bundle_sha);
  if (result != SCENE_RPC_OK || memcmp(state->store, "\0\0\0\0", 4u) != 0) return 10;

  if (strcmp(mode, "abort") == 0) {
    result = renderer_scene_rpc_core_abort(state, transaction, (u32)sizeof(transaction) - 1u, 1u);
    printf("abort=%d flags=%u generation=%u\n", result, state->flags, state->committed_generation);
    return result == SCENE_RPC_OK && state->flags == 0u ? 0 : 11;
  }
  if (strcmp(mode, "reorder") == 0) {
    u32 reordered = chunks > 1u ? 1u : 0u;
    u32 offset = reordered * SCENE_CHUNK_BYTES;
    u32 bytes = length - offset > SCENE_CHUNK_BYTES ? SCENE_CHUNK_BYTES : length - offset;
    result = renderer_scene_rpc_core_write(state, transaction, (u32)sizeof(transaction) - 1u,
      1u, reordered, offset, bytes, (const u8 *)argv[4 + reordered], bundle + offset, bytes);
    printf("reorder=%d flags=%u\n", result, state->flags);
    return result == SCENE_RPC_ORDER && state->flags == 0u ? 0 : 12;
  }

  for (index = 0; index < chunks; index++) {
    u32 offset = index * SCENE_CHUNK_BYTES;
    u32 bytes = length - offset > SCENE_CHUNK_BYTES ? SCENE_CHUNK_BYTES : length - offset;
    if (strcmp(mode, "torn") == 0 && index + 1u == chunks) break;
    if (strcmp(mode, "corrupt") == 0 && index == 0u) bundle[offset + 40u] ^= 1u;
    if (strcmp(mode, "success-b64") == 0) {
      RendererSceneWriteBase64Args args; u32 encoded_bytes = ((bytes + 2u) / 3u) * 4u;
      u8 *encoded = (u8 *)malloc(encoded_bytes);
      if (encoded == NULL || encode64(bundle + offset, bytes, encoded) != encoded_bytes) return 18;
      args.transaction_id = transaction; args.transaction_id_length = (u32)sizeof(transaction) - 1u;
      args.generation = 1u; args.index = index; args.offset = offset; args.declared_bytes = bytes;
      args.chunk_sha_hex = (const u8 *)argv[4 + index]; args.base64 = encoded; args.base64_bytes = encoded_bytes;
      result = renderer_scene_rpc_core_write_base64_args(state, &args); free(encoded);
    } else result = renderer_scene_rpc_core_write(state, transaction, (u32)sizeof(transaction) - 1u,
      1u, index, offset, bytes, (const u8 *)argv[4 + index], bundle + offset, bytes);
    if (strcmp(mode, "corrupt") == 0) {
      printf("corrupt=%d flags=%u\n", result, state->flags);
      return result == SCENE_RPC_SHA && state->flags == 0u ? 0 : 13;
    }
    if (result != SCENE_RPC_OK) return 14;
  }
  result = renderer_scene_rpc_core_commit(state, transaction, (u32)sizeof(transaction) - 1u,
    0u, 1u, length, chunks, bundle_sha);
  if (strncmp(mode, "focus-", 6u) == 0) {
    s32 second = renderer_scene_rpc_core_begin(state, transaction,
      (u32)sizeof(transaction) - 1u, 1u, 2u, length, chunks,
      SCENE_CHUNK_BYTES, bundle_sha);
    printf("focus_result=%d second=%d flags=%u generation=%u stage=%u prepare=%u commit=%u cancel=%u\n",
      result, second, state->flags, state->committed_generation, stage_calls,
      v2_prepare_calls, v2_commit_calls, v2_cancel_calls);
    if (strcmp(mode, "focus-success") == 0)
      return result == SCENE_RPC_OK && second == SCENE_RPC_BUSY &&
        state->flags == SCENE_FLAG_V2_STORE_LATCH && state->committed_generation == 1u &&
        stage_calls == 1u && v2_prepare_calls == 1u && v2_commit_calls == 1u &&
        v2_cancel_calls == 0u ? 0 : 19;
    if (strcmp(mode, "focus-stage-fail") == 0)
      return result == SCENE_RPC_STAGE && second == SCENE_RPC_GENERATION && state->flags == 0u &&
        state->committed_generation == 0u && stage_calls == 1u && v2_prepare_calls == 1u &&
        v2_commit_calls == 0u && v2_cancel_calls == 1u ? 0 : 20;
    if (strcmp(mode, "focus-prepare-fail") == 0)
      return result == SCENE_RPC_V2 && second == SCENE_RPC_GENERATION && state->flags == 0u &&
        state->committed_generation == 0u && stage_calls == 0u && v2_prepare_calls == 1u &&
        v2_commit_calls == 0u && v2_cancel_calls == 0u ? 0 : 21;
    if (strcmp(mode, "focus-commit-fail") == 0)
      return result == SCENE_RPC_V2 && second == SCENE_RPC_BUSY &&
        state->flags == SCENE_FLAG_V2_STORE_LATCH && state->committed_generation == 1u &&
        stage_calls == 1u && v2_prepare_calls == 1u && v2_commit_calls == 1u &&
        v2_cancel_calls == 0u ? 0 : 22;
    return 23;
  }
  if (strcmp(mode, "torn") == 0) {
    printf("torn=%d flags=%u\n", result, state->flags);
    return result == SCENE_RPC_TORN && state->flags == 0u ? 0 : 15;
  }
  if ((strcmp(mode, "success") != 0 && strcmp(mode, "success-b64") != 0) ||
      result != SCENE_RPC_OK || state->flags != 0u ||
      state->committed_generation != 1u || stage_calls != 1u || memcmp(state->store, "F1WB", 4u) != 0) return 16;
  result = renderer_scene_rpc_core_begin(state, transaction, (u32)sizeof(transaction) - 1u,
    1u, 2u, length, chunks, SCENE_CHUNK_BYTES, bundle_sha);
  if (result != SCENE_RPC_OK) return 17;
  s32 aborted = renderer_scene_rpc_core_abort(state, transaction, (u32)sizeof(transaction) - 1u, 2u);
  printf("commit=1 second=%d abort=%d flags=%u generation=%u stage=%u\n",
    result, aborted, state->flags, state->committed_generation, stage_calls);
  return aborted == SCENE_RPC_OK && state->flags == 0u ? 0 : 18;
}
