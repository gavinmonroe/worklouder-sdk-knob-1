import { FramerHidClient, requestFramerHid } from "./framer-hid.js";

// Browser port of the Input Lab scene transport
// (f1-widget-sdk/input-lab/lib/browser-scene-hid.mjs) restricted to the one
// operation this flasher performs: pushing a frozen, catalog-pinned RAM-only
// render-v2 package over the existing normal-mode vendor HID RPC channel.
// The begin/write/commit/abort payload shapes are identical to
// f1-widget-sdk/examples/render-v2-focus-timer/focus-timer-package.mjs.
export const SCENE_RPC_PROTOCOL = "framer-widget-scene-rpc-v1";

export const SCENE_RPC_METHODS = Object.freeze({
  capabilities: "widget.scene.capabilities",
  begin: "widget.scene.begin",
  write: "widget.scene.write",
  commit: "widget.scene.commit",
  abort: "widget.scene.abort",
  status: "widget.scene.status",
});

// The generation baked into today's flashed clock+timer image (see
// f1-widget-sdk/examples/render-v2-focus-timer/focus-timer-package.mjs,
// FOCUS_TIMER_PACKAGE.generation). Used by the idempotency rule below to
// tell a genuine boot-adopted/committed generation reading apart from the
// absence of one.
const MINIMUM_BOOT_ADOPTED_GENERATION = 2;

export const SCENE_RPC_LIMITS = Object.freeze({
  maxBundleBytes: 96 * 1024,
  chunkRawBytes: 3072,
  maxChunks: 32,
});

export const SCENE_BEGIN_REJECTED_MESSAGE =
  "The keyboard refused to start the scene transfer. This package is already enabled this boot, or a stale transaction is still open — power-cycle the keyboard and retry.";

function sceneError(message, code, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause !== undefined) error.cause = cause;
  return error;
}

function invariant(value, message, code) {
  if (!value) throw sceneError(message, code);
}

function hex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(bytes) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}

function base64(bytes) {
  let output = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    output += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + 0x8000)));
  }
  return btoa(output);
}

function statusOnly(response) {
  return (
    response !== null &&
    typeof response === "object" &&
    !Array.isArray(response) &&
    Object.keys(response).length === 1 &&
    ["ok", "error"].includes(response.status)
  );
}

function assertStatusOnly(response, operation) {
  if (!statusOnly(response)) {
    throw sceneError(
      `Scene ${operation} returned a non-status-only response; the keyboard state is indeterminate.`,
      "SCENE_RPC_INDETERMINATE",
    );
  }
  return response;
}

/**
 * The F1WB header stores its generation as a little-endian uint32 at byte
 * offset 8 (see f1-widget-sdk/src/render/widget-bundle.mjs encodeWidgetBundle
 * / decodeWidgetBundle). Every other byte -- raster/program payloads
 * included -- is generation-independent, so advancing the generation is a
 * four-byte patch, not a rebuild. Mirrors the same rewrite
 * f1-widget-sdk/input-lab/lib/browser-scene-hid.mjs already performs for the
 * generic render-v2 package.
 */
function rewriteGeneration(bytes, generation) {
  const rewritten = new Uint8Array(bytes);
  new DataView(rewritten.buffer, rewritten.byteOffset, rewritten.byteLength).setUint32(8, generation, true);
  return rewritten;
}

/**
 * Build the exact begin / write / commit payloads for one pinned package.
 * `expectedGeneration` defaults to the descriptor's own pinned
 * expectedGeneration (the historical generation-1-to-2 push); passing a
 * different value rewrites the F1WB generation word in place before hashing
 * and chunking, so a status-derived caller can push "whatever the device
 * reports, plus one" without a second frozen build of the package.
 */
export async function createScenePackageUpload(input, descriptor, { expectedGeneration: expectedGenerationOverride } = {}) {
  invariant(
    descriptor && Number.isInteger(descriptor.bytes) && typeof descriptor.sha256 === "string",
    "A scene package descriptor must pin its exact byte count and SHA-256.",
    "SCENE_PACKAGE_INVALID",
  );
  invariant(
    Number.isInteger(descriptor.expectedGeneration) &&
      descriptor.expectedGeneration >= 0 &&
      descriptor.generation === descriptor.expectedGeneration + 1,
    "A scene package must advance the committed generation by exactly one.",
    "SCENE_PACKAGE_INVALID",
  );
  const resolvedExpectedGeneration = expectedGenerationOverride ?? descriptor.expectedGeneration;
  invariant(
    Number.isInteger(resolvedExpectedGeneration) && resolvedExpectedGeneration >= 0 &&
      resolvedExpectedGeneration < 0xffffffff,
    "Scene push expected generation must be a uint32 below its maximum.",
    "SCENE_PACKAGE_INVALID",
  );

  const original = input instanceof Uint8Array ? input : new Uint8Array(input);
  invariant(
    original.length === descriptor.bytes,
    `Scene package size changed: expected ${descriptor.bytes}, received ${original.length} bytes.`,
    "SCENE_PACKAGE_INVALID",
  );
  invariant(
    original.length > 0 && original.length <= SCENE_RPC_LIMITS.maxBundleBytes,
    "Scene package exceeds the 96 KiB scene-store bound.",
    "SCENE_PACKAGE_INVALID",
  );

  const generation = resolvedExpectedGeneration + 1;
  const bytes = generation === descriptor.generation ? original : rewriteGeneration(original, generation);
  const sha256 = await sha256Hex(bytes);
  if (resolvedExpectedGeneration === descriptor.expectedGeneration) {
    // Canonical case: the frozen, catalog-pinned composite advancing from
    // the boot template generation straight to its exact frozen sha. Pin it
    // so this well-trodden path can never silently drift.
    invariant(
      sha256 === descriptor.sha256,
      "Scene package SHA-256 does not match the pinned catalog entry.",
      "SCENE_PACKAGE_INVALID",
    );
  }

  const totalChunks = Math.ceil(bytes.length / SCENE_RPC_LIMITS.chunkRawBytes);
  invariant(
    totalChunks >= 1 && totalChunks <= SCENE_RPC_LIMITS.maxChunks,
    "Scene package exceeds the 32-chunk scene-store cap.",
    "SCENE_PACKAGE_INVALID",
  );
  invariant(
    descriptor.chunks === undefined || descriptor.chunks === totalChunks,
    `Scene package chunk count changed: expected ${descriptor.chunks}, computed ${totalChunks}.`,
    "SCENE_PACKAGE_INVALID",
  );

  const expectedGeneration = resolvedExpectedGeneration;
  const transactionId = `f2pt-${generation.toString(16).padStart(8, "0")}-${sha256.slice(0, 16)}`;
  const manifest = Object.freeze({
    protocol: SCENE_RPC_PROTOCOL,
    transactionId,
    expectedGeneration,
    generation,
    totalBytes: bytes.length,
    totalChunks,
    chunkRawBytes: SCENE_RPC_LIMITS.chunkRawBytes,
    sha256,
  });

  const chunks = [];
  for (let index = 0; index < totalChunks; index += 1) {
    const offset = index * SCENE_RPC_LIMITS.chunkRawBytes;
    const chunk = bytes.slice(offset, Math.min(bytes.length, offset + SCENE_RPC_LIMITS.chunkRawBytes));
    chunks.push(
      Object.freeze({
        protocol: SCENE_RPC_PROTOCOL,
        transactionId,
        generation,
        index,
        offset,
        bytes: chunk.length,
        chunkSha256: await sha256Hex(chunk),
        data: base64(chunk),
      }),
    );
  }

  return Object.freeze({
    manifest,
    chunks: Object.freeze(chunks),
    commit: Object.freeze({
      protocol: SCENE_RPC_PROTOCOL,
      transactionId,
      expectedGeneration,
      generation,
      totalBytes: bytes.length,
      totalChunks,
      sha256,
    }),
    abort: Object.freeze({
      protocol: SCENE_RPC_PROTOCOL,
      transactionId,
      generation,
    }),
  });
}

function parseCanonicalGeneration(value) {
  const text = typeof value === "number" && Number.isInteger(value) ? String(value) : value;
  if (typeof text !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(text)) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed < 0xffffffff ? parsed : null;
}

function parseCommittedSha256(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value) ? value : null;
}

/**
 * Best-effort read of the device's committed scene generation (and, where
 * advertised, package identity) before a push. Tries
 * widget.scene.capabilities, then widget.scene.status; either method being
 * unreachable, erroring, or answering without a committedGeneration field
 * (today's flashed firmware replies bare {status:"ok"}) is expected, not a
 * failure -- the probe just reports "unavailable". See
 * f1-widget-sdk/examples/render-v2-focus-timer/focus-timer-package.mjs's
 * matching probeFocusTimerCommittedPackage for the full idempotency rule
 * this implements, mirrored here for the browser transport.
 */
export async function probeScenePackageStatus(rpc) {
  invariant(typeof rpc === "function", "Scene status probe requires an rpc() transport.", "SCENE_PACKAGE_INVALID");
  for (const method of [SCENE_RPC_METHODS.capabilities, SCENE_RPC_METHODS.status]) {
    let response;
    try { response = await rpc(method, { protocol: SCENE_RPC_PROTOCOL }); }
    catch { continue; }
    if (!response || typeof response !== "object" || Array.isArray(response) || response.status === "error") continue;
    const generation = parseCanonicalGeneration(response.committedGeneration);
    if (generation === null) continue;
    return Object.freeze({ source: method, generation,
      sha256: parseCommittedSha256(response.committedSha256 ?? response.packageSha256) });
  }
  return Object.freeze({ source: "unavailable", generation: null, sha256: null });
}

function alreadyEnabledResult(generation, reason) {
  return Object.freeze({ status: "FOCUS_TIMER_PACKAGE_ALREADY_ENABLED", alreadyEnabled: true, generation, reason });
}

/**
 * Status-derived, idempotent push: probes the device's committed
 * generation, skips the push entirely (no begin/write/commit at all) when
 * the reported package identity already matches, otherwise pushes
 * expectedGeneration -> +1 (begin -> 32 writes -> commit, aborting on any
 * failure that did not leave the keyboard indeterminate). A push rejection
 * is classified as "already enabled" instead of an error exactly per the
 * rule in probeFocusTimerCommittedPackage's doc comment: any rejected stage
 * when the probed committedGeneration is known and >=
 * MINIMUM_BOOT_ADOPTED_GENERATION, or specifically a rejected `begin` when
 * the probe found no generation at all (legacy firmware).
 */
export async function pushScenePackage({ rpc, bytes, package: descriptor, onProgress = null } = {}) {
  invariant(typeof rpc === "function", "Scene push requires an rpc() transport.", "SCENE_PACKAGE_INVALID");

  const status = await probeScenePackageStatus(rpc);
  onProgress?.({ stage: "status-probe", source: status.source, committedGeneration: status.generation });

  if (status.generation !== null && status.sha256) {
    const candidateBytes = status.generation === descriptor.generation
      ? (bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))
      : rewriteGeneration(bytes, status.generation);
    if ((await sha256Hex(candidateBytes)) === status.sha256) {
      return alreadyEnabledResult(status.generation, "committed-sha-match");
    }
  }

  const expectedGeneration = status.generation ?? descriptor.expectedGeneration;
  const upload = await createScenePackageUpload(bytes, descriptor, { expectedGeneration });
  let begun = false;
  let indeterminate = false;
  try {
    onProgress?.({ stage: "starting", current: 0, total: upload.chunks.length });
    const began = assertStatusOnly(await rpc(SCENE_RPC_METHODS.begin, upload.manifest), "begin");
    if (began.status !== "ok") throw sceneError(SCENE_BEGIN_REJECTED_MESSAGE, "SCENE_BEGIN_REJECTED");
    begun = true;

    onProgress?.({ stage: "uploading-chunks", current: 0, total: upload.chunks.length });
    for (const chunk of upload.chunks) {
      const acknowledged = assertStatusOnly(await rpc(SCENE_RPC_METHODS.write, chunk), `chunk ${chunk.index}`);
      if (acknowledged.status !== "ok") {
        throw sceneError(`Scene chunk ${chunk.index} was rejected by the keyboard.`, "SCENE_RPC_REJECTED");
      }
      onProgress?.({ stage: "uploading-chunks", current: chunk.index + 1, total: upload.chunks.length });
    }

    onProgress?.({ stage: "applying-on-keyboard", current: upload.chunks.length, total: upload.chunks.length });
    let committed;
    try {
      committed = await rpc(SCENE_RPC_METHODS.commit, upload.commit);
    } catch (cause) {
      indeterminate = true;
      throw sceneError(
        "The scene commit reply never arrived; the keyboard state is indeterminate. Power-cycle it before retrying.",
        "SCENE_COMMIT_INDETERMINATE",
        cause,
      );
    }
    if (!statusOnly(committed)) {
      indeterminate = true;
      throw sceneError(
        "The scene commit reply was malformed; the keyboard state is indeterminate. Power-cycle it before retrying.",
        "SCENE_COMMIT_INDETERMINATE",
      );
    }
    if (committed.status !== "ok") throw sceneError("The scene commit was rejected.", "SCENE_RPC_REJECTED");

    begun = false;
    return Object.freeze({
      status: "FOCUS_TIMER_PACKAGE_COMMIT_ACKNOWLEDGED",
      alreadyEnabled: false,
      generation: upload.commit.generation,
      bytes: upload.commit.totalBytes,
      chunks: upload.commit.totalChunks,
      sha256: upload.commit.sha256,
    });
  } catch (error) {
    if (begun && !indeterminate && error.code !== "SCENE_RPC_INDETERMINATE") {
      await rpc(SCENE_RPC_METHODS.abort, upload.abort).catch(() => {});
    }
    const rejected = error.code === "SCENE_RPC_REJECTED" || error.code === "SCENE_BEGIN_REJECTED";
    if (rejected) {
      const knownBootAdopted = status.generation !== null && status.generation >= MINIMUM_BOOT_ADOPTED_GENERATION;
      if (knownBootAdopted) return alreadyEnabledResult(status.generation, "rejected-at-known-boot-adopted-generation");
      if (status.generation === null && error.code === "SCENE_BEGIN_REJECTED") {
        return alreadyEnabledResult(expectedGeneration, "begin-rejected-generation-unknown-legacy");
      }
    }
    throw error;
  }
}

export async function loadScenePackage(descriptor, fetchImpl = fetch) {
  const response = await fetchImpl(descriptor.url, { cache: "no-store" });
  if (!response.ok) {
    throw sceneError(
      `Could not load the ${descriptor.name} package (${response.status}).`,
      "SCENE_PACKAGE_UNAVAILABLE",
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  await createScenePackageUpload(bytes, descriptor);
  return bytes;
}

/**
 * Push a pinned package to a normal-mode Framer over WebHID. No flash region is
 * touched: the package lives in the renderer scene store until the next boot.
 */
export async function pushScenePackageOverHid({ device, bytes, package: descriptor, onProgress = null } = {}) {
  const target = device ?? (await requestFramerHid());
  const client = new FramerHidClient(target);
  await client.open();
  try {
    await client.verifyVersion();
    const result = await pushScenePackage({
      rpc: (method, params) => client.call(method, params),
      bytes,
      package: descriptor,
      onProgress,
    });
    return Object.freeze({ ...result, device: target });
  } finally {
    await client.close().catch(() => {});
  }
}
