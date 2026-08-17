import { createHash } from "node:crypto";

import { decodeWidgetBundle, encodeWidgetBundle } from "./widget-bundle.mjs";

export const WIDGET_SCENE_RPC_PROTOCOL = "framer-widget-scene-rpc-v1";
export const WIDGET_SCENE_RPC_METHODS = Object.freeze({
  capabilities: "widget.scene.capabilities",
  begin: "widget.scene.begin",
  write: "widget.scene.write",
  commit: "widget.scene.commit",
  abort: "widget.scene.abort",
  status: "widget.scene.status",
});
export const WIDGET_SCENE_RPC_LIMITS = Object.freeze({
  maxBundleBytes: 96 * 1024,
  chunkRawBytes: 3072,
  maxChunks: 32,
  maxTransactionIdBytes: 40,
  f1wbCommitHeaderBytes: 20,
  statusPollMs: 100,
  maxStatusPolls: 20,
  framebufferBytes: 62_000,
  sceneStoreBytes: 96 * 1024,
  minimumPeakBytes: 96 * 1024 + 62_000,
});

function invariant(value, message, code) {
  if (!value) {
    const error = new Error(message);
    if (code) error.code = code;
    throw error;
  }
}

export function widgetSceneSha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function exactBuffer(value, label) {
  invariant(value instanceof Uint8Array, `${label} must be bytes.`);
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

function exactProofId(value) {
  invariant(typeof value === "string" && /^[a-z0-9][a-z0-9._-]{7,95}$/u.test(value),
    "Scene handler proof ID is invalid.");
  return value;
}

function normalizeCapabilities(value, expectedProofId) {
  invariant(value?.status === "ok" && value.accepted === true, "Scene runtime rejected capability negotiation.");
  invariant(value.protocol === WIDGET_SCENE_RPC_PROTOCOL, "Scene runtime protocol does not match renderer-v1.");
  invariant(value.proofId === expectedProofId, "Scene runtime proof ID does not match the selected live proof.");
  invariant(value.deviceFamily === "knob_f1" && value.firmware === "0.4.1" && value.screenId === 26,
    "Scene runtime target identity is not exact Framer F1 renderer ID26.");
  invariant(value.atomicF1wb === true && value.uiThreadApply === true && value.ramOnly === true &&
    value.persistence === false, "Scene runtime did not promise atomic RAM-only UI-thread apply.");
  invariant(value.singleSceneStore === true && value.freezeOnUpload === true &&
    value.headerLastCommit === true && value.rollbackMode === "freeze-last-frame",
  "Scene runtime did not promise the bounded single-store/header-last publication contract.");
  invariant(Number.isInteger(value.maxBundleBytes) && value.maxBundleBytes > 0 &&
    value.maxBundleBytes <= WIDGET_SCENE_RPC_LIMITS.maxBundleBytes,
  "Scene runtime bundle limit is invalid or exceeds the host safety cap.");
  invariant(value.sceneStoreBytes === value.maxBundleBytes &&
    value.framebufferBytes === WIDGET_SCENE_RPC_LIMITS.framebufferBytes &&
    value.minimumRendererBytes === value.sceneStoreBytes + value.framebufferBytes,
  "Scene runtime memory declaration does not match one scene store plus one framebuffer.");
  invariant(value.heapTelemetryAccepted === true,
    "Scene runtime has no accepted steady-state heap telemetry for its declared renderer allocation.");
  invariant(Number.isInteger(value.chunkRawBytes) && value.chunkRawBytes > 0 &&
    value.chunkRawBytes <= WIDGET_SCENE_RPC_LIMITS.chunkRawBytes,
  "Scene runtime chunk size is invalid or exceeds Input's proven RPC bound.");
  invariant(Number.isInteger(value.maxChunks) && value.maxChunks > 0 &&
    value.maxChunks <= WIDGET_SCENE_RPC_LIMITS.maxChunks, "Scene runtime chunk count is invalid.");
  invariant(Number.isInteger(value.committedGeneration) && value.committedGeneration >= 0 &&
    value.committedGeneration < 0xffffffff, "Scene runtime committed generation is invalid.");
  invariant(typeof value.committedSha256 === "string" && /^(?:[0-9a-f]{64}|none)$/u.test(value.committedSha256),
    "Scene runtime committed SHA-256 is invalid.");
  return Object.freeze({ ...value });
}

function bundleAtGeneration(value, generation) {
  const input = value?.binary ?? value;
  const decoded = decodeWidgetBundle(exactBuffer(input, "F1WB bundle"));
  if (decoded.generation === generation) return { decoded, binary: decoded.binary, sha256: decoded.sha256 };
  const slots = decoded.slots.map((slot) => slot.kind === "semantic"
    ? { name: slot.name, kind: "semantic", sceneBinary: slot.sceneBinary, atlasBinary: slot.atlasBinary }
    : { name: slot.name, kind: "raster", animationBinary: slot.animationBinary });
  const rebuilt = encodeWidgetBundle({ slots, activeSlot: decoded.activeSlot, generation });
  return { decoded: decodeWidgetBundle(rebuilt.binary), binary: rebuilt.binary, sha256: rebuilt.sha256 };
}

export function createWidgetSceneUpload(value, { generation, expectedGeneration,
  maxBundleBytes = WIDGET_SCENE_RPC_LIMITS.maxBundleBytes,
  chunkRawBytes = WIDGET_SCENE_RPC_LIMITS.chunkRawBytes,
  maxChunks = WIDGET_SCENE_RPC_LIMITS.maxChunks } = {}) {
  invariant(Number.isInteger(generation) && generation >= 1 && generation <= 0xffffffff,
    "Scene upload generation must be a nonzero uint32.");
  invariant(Number.isInteger(expectedGeneration) && expectedGeneration >= 0 && expectedGeneration < generation,
    "Scene upload expected generation is invalid.");
  invariant(generation === expectedGeneration + 1, "Scene upload generation must advance exactly once.");
  invariant(Number.isInteger(maxBundleBytes) && maxBundleBytes > 0 &&
    maxBundleBytes <= WIDGET_SCENE_RPC_LIMITS.maxBundleBytes, "Scene upload maxBundleBytes is invalid.");
  invariant(Number.isInteger(chunkRawBytes) && chunkRawBytes > 0 &&
    chunkRawBytes <= WIDGET_SCENE_RPC_LIMITS.chunkRawBytes, "Scene upload chunkRawBytes is invalid.");
  invariant(Number.isInteger(maxChunks) && maxChunks > 0 && maxChunks <= WIDGET_SCENE_RPC_LIMITS.maxChunks,
    "Scene upload maxChunks is invalid.");
  const bundle = bundleAtGeneration(value, generation);
  invariant(bundle.binary.length <= maxBundleBytes,
    `F1WB upload is ${bundle.binary.length} bytes; RAM-only live cap is ${maxBundleBytes}.`, "SCENE_BUNDLE_OVERSIZE");
  const totalChunks = Math.ceil(bundle.binary.length / chunkRawBytes);
  invariant(totalChunks >= 1 && totalChunks <= maxChunks,
    `F1WB upload needs ${totalChunks} chunks; device permits ${maxChunks}.`, "SCENE_CHUNK_COUNT_EXCEEDED");
  const transactionId = `f1wb-${generation.toString(16).padStart(8, "0")}-${bundle.sha256.slice(0, 16)}`;
  invariant(Buffer.byteLength(transactionId) <= WIDGET_SCENE_RPC_LIMITS.maxTransactionIdBytes,
    "Scene transaction ID exceeds its bound.");
  const manifest = Object.freeze({ protocol: WIDGET_SCENE_RPC_PROTOCOL, transactionId,
    expectedGeneration, generation, totalBytes: bundle.binary.length, totalChunks,
    chunkRawBytes, sha256: bundle.sha256 });
  const chunks = Object.freeze(Array.from({ length: totalChunks }, (_, index) => {
    const offset = index * chunkRawBytes;
    const bytes = Buffer.from(bundle.binary.subarray(offset, Math.min(bundle.binary.length, offset + chunkRawBytes)));
    return Object.freeze({ protocol: WIDGET_SCENE_RPC_PROTOCOL, transactionId, generation, index, offset,
      bytes: bytes.length, chunkSha256: widgetSceneSha256(bytes), data: bytes.toString("base64") });
  }));
  const commit = Object.freeze({ protocol: WIDGET_SCENE_RPC_PROTOCOL, transactionId,
    expectedGeneration, generation, totalBytes: bundle.binary.length, totalChunks, sha256: bundle.sha256 });
  return Object.freeze({ bundle: Object.freeze(bundle), manifest, chunks, commit });
}

function accepted(response, operation) {
  invariant(response?.accepted === true && response.status === "ok",
    `Scene runtime rejected ${operation}: ${response?.reason ?? "unknown reason"}.`, "SCENE_RPC_REJECTED");
  return response;
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/** Hardware-agnostic publisher. Callers must perform immutable live-proof gating before constructing it. */
export async function publishWidgetSceneBundle({ bundle, rpc, expectedProofId,
  wait = delay, maxStatusPolls = WIDGET_SCENE_RPC_LIMITS.maxStatusPolls } = {}) {
  invariant(typeof rpc === "function", "Scene publisher requires an injected rpc(method, params) function.");
  exactProofId(expectedProofId);
  invariant(typeof wait === "function", "Scene publisher wait must be injectable.");
  invariant(Number.isInteger(maxStatusPolls) && maxStatusPolls >= 1 && maxStatusPolls <= 100,
    "Scene status poll count is invalid.");
  const capabilities = normalizeCapabilities(await rpc(WIDGET_SCENE_RPC_METHODS.capabilities,
    { protocol: WIDGET_SCENE_RPC_PROTOCOL }), expectedProofId);
  const upload = createWidgetSceneUpload(bundle, { generation: capabilities.committedGeneration + 1,
    expectedGeneration: capabilities.committedGeneration, maxBundleBytes: capabilities.maxBundleBytes,
    chunkRawBytes: capabilities.chunkRawBytes, maxChunks: capabilities.maxChunks });
  let begun = false;
  let queued = false;
  try {
    accepted(await rpc(WIDGET_SCENE_RPC_METHODS.begin, upload.manifest), "begin");
    begun = true;
    for (const chunk of upload.chunks) accepted(await rpc(WIDGET_SCENE_RPC_METHODS.write, chunk),
      `chunk ${chunk.index}`);
    const commitResponse = accepted(await rpc(WIDGET_SCENE_RPC_METHODS.commit, upload.commit), "commit");
    queued = commitResponse.commitStatus !== "committed";
    if (commitResponse.commitStatus === "committed") {
      return Object.freeze({ status: "live-bundle-applied", mode: "live", hardwareAccess: true,
        generation: upload.commit.generation, sha256: upload.commit.sha256,
        bytes: upload.commit.totalBytes, chunks: upload.commit.totalChunks });
    }
    for (let poll = 0; poll < maxStatusPolls; poll += 1) {
      await wait(WIDGET_SCENE_RPC_LIMITS.statusPollMs);
      const status = accepted(await rpc(WIDGET_SCENE_RPC_METHODS.status,
        { protocol: WIDGET_SCENE_RPC_PROTOCOL }), "status");
      if (status.committedGeneration === upload.commit.generation && status.committedSha256 === upload.commit.sha256) {
        return Object.freeze({ status: "live-bundle-applied", mode: "live", hardwareAccess: true,
          generation: upload.commit.generation, sha256: upload.commit.sha256,
          bytes: upload.commit.totalBytes, chunks: upload.commit.totalChunks });
      }
      invariant(status.committedGeneration === upload.commit.expectedGeneration,
        "Scene runtime reported an unexpected committed generation while apply was pending.");
    }
    const error = new Error("Scene commit was queued but UI-thread acceptance was not observed within 2 seconds.");
    error.code = "SCENE_COMMIT_INDETERMINATE";
    throw error;
  } catch (error) {
    if (begun && !queued) {
      try {
        await rpc(WIDGET_SCENE_RPC_METHODS.abort, { protocol: WIDGET_SCENE_RPC_PROTOCOL,
          transactionId: upload.manifest.transactionId, generation: upload.manifest.generation });
      } catch {}
    }
    throw error;
  }
}

/**
 * Status-only hardware canary for a newly flashed, not-yet-promoted ID26
 * handler. It deliberately skips rich capability/status negotiation. An
 * `{status:"ok"}` commit proves only that the callback synchronously accepted
 * the transaction for UI-thread handoff; it is not a live-proof receipt.
 */
export async function publishWidgetSceneBundleSmoke({ bundle, rpc, confirmed = false,
  expectedGeneration = 0, retryBeginOnce = false, wait = delay,
  beginRetryMs = WIDGET_SCENE_RPC_LIMITS.statusPollMs, onProgress = null } = {}) {
  invariant(confirmed === true, "Scene smoke upload requires explicit confirmed: true opt-in.");
  invariant(typeof rpc === "function", "Scene smoke upload requires an injected rpc(method, params) function.");
  invariant(typeof wait === "function", "Scene smoke upload wait must be injectable.");
  invariant(typeof retryBeginOnce === "boolean", "Scene smoke begin retry flag must be boolean.");
  invariant(onProgress === null || typeof onProgress === "function",
    "Scene smoke progress must be a function.");
  invariant(Number.isInteger(beginRetryMs) && beginRetryMs >= 0 && beginRetryMs <= 2_000,
    "Scene smoke begin retry delay must be 0..2000ms.");
  const reportProgress = (event) => {
    try { onProgress?.(Object.freeze(event)); } catch {}
  };
  const generation = expectedGeneration + 1;
  const upload = createWidgetSceneUpload(bundle, { expectedGeneration, generation });
  reportProgress({ stage: "uploading-chunks", current: 0, total: upload.chunks.length });
  const statusOnlyAccepted = (response, operation) => {
    const exact = response && typeof response === "object" && !Array.isArray(response) &&
      Object.keys(response).length === 1 && response.status === "ok";
    if (!exact) {
      const error = new Error(`Scene smoke ${operation} did not return exact status-only acknowledgment.`);
      error.code = "SCENE_RPC_REJECTED";
      error.rpcResponse = response;
      throw error;
    }
    return response;
  };
  const begin = async () => statusOnlyAccepted(
    await rpc(WIDGET_SCENE_RPC_METHODS.begin, upload.manifest), "begin");
  let begun = false;
  try {
    try {
      await begin();
    } catch (error) {
      const explicitRejection = error.code === "SCENE_RPC_REJECTED" &&
        error.rpcResponse?.status === "error" && Object.keys(error.rpcResponse).length === 1;
      if (!retryBeginOnce || !explicitRejection) throw error;
      await wait(beginRetryMs);
      await begin();
    }
    begun = true;
    for (const chunk of upload.chunks) {
      statusOnlyAccepted(await rpc(WIDGET_SCENE_RPC_METHODS.write, chunk), `chunk ${chunk.index}`);
      reportProgress({ stage: "uploading-chunks", current: chunk.index + 1,
        total: upload.chunks.length });
    }
  } catch (error) {
    if (begun) {
      try {
        await rpc(WIDGET_SCENE_RPC_METHODS.abort, { protocol: WIDGET_SCENE_RPC_PROTOCOL,
          transactionId: upload.manifest.transactionId, generation });
      } catch {}
    }
    throw error;
  }

  let commitResponse;
  reportProgress({ stage: "applying-on-keyboard" });
  try {
    commitResponse = await rpc(WIDGET_SCENE_RPC_METHODS.commit, upload.commit);
  } catch (cause) {
    const error = new Error("Scene smoke commit reply is indeterminate; restart the canary session before another push.",
      { cause });
    error.code = "SCENE_COMMIT_INDETERMINATE";
    throw error;
  }
  try {
    statusOnlyAccepted(commitResponse, "commit");
  } catch (error) {
    if (commitResponse?.status === "error" && Object.keys(commitResponse).length === 1) {
      try {
        await rpc(WIDGET_SCENE_RPC_METHODS.abort, { protocol: WIDGET_SCENE_RPC_PROTOCOL,
          transactionId: upload.manifest.transactionId, generation });
      } catch {}
    } else {
      error.code = "SCENE_COMMIT_INDETERMINATE";
    }
    throw error;
  }
  return Object.freeze({ status: "live-canary-commit-acknowledged", mode: "live-canary",
    hardwareAccess: true, proofBacked: false, uiHandoffVerified: false,
    expectedGeneration, generation, sha256: upload.commit.sha256,
    bytes: upload.commit.totalBytes, chunks: upload.commit.totalChunks });
}
