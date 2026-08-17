import { createHash } from "node:crypto";

import { decodeCssScene } from "../../f1-widget-sdk/src/render/css-scene.mjs";
import { decodeGlyphAtlas } from "../../f1-widget-sdk/src/render/glyph-atlas.mjs";
import { decodeWidgetBundle } from "../../f1-widget-sdk/src/render/widget-bundle.mjs";
import {
  WIDGET_SCENE_RPC_LIMITS,
  WIDGET_SCENE_RPC_METHODS,
  WIDGET_SCENE_RPC_PROTOCOL,
  widgetSceneSha256,
} from "../../f1-widget-sdk/src/render/scene-rpc.mjs";
import {
  RENDERER_V1,
  admitRendererV1DecodedWidgetBundle,
  admitRendererV1Raster,
} from "./renderer-v1-runtime.mjs";

const F1WB_CAPACITY = 3;
const F1WB_DESCRIPTOR_BYTES = 104;
const F1WB_PAYLOAD_OFFSET = 20 + F1WB_CAPACITY * F1WB_DESCRIPTOR_BYTES;
const F1WB_KIND_NAMES = Object.freeze([null, "semantic", "raster"]);

class SceneRpcFault extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function requireValue(value, code, message) {
  if (!value) throw new SceneRpcFault(code, message);
}

function exactKeys(value, required, label) {
  requireValue(value && typeof value === "object" && !Array.isArray(value), "SCENE_RPC_PARAMS", `${label} params must be an object.`);
  const keys = Object.keys(value).sort();
  const expected = [...required].sort();
  requireValue(keys.length === expected.length && keys.every((key, index) => key === expected[index]),
    "SCENE_RPC_PARAMS", `${label} params contain missing or unsupported fields.`);
}

function exactProtocol(value) {
  requireValue(value === WIDGET_SCENE_RPC_PROTOCOL, "SCENE_RPC_PROTOCOL", "Scene RPC protocol mismatch.");
}

function uint32(value, label, { nonzero = false } = {}) {
  requireValue(Number.isInteger(value) && value >= (nonzero ? 1 : 0) && value <= 0xffffffff,
    "SCENE_RPC_RANGE", `${label} must be a ${nonzero ? "nonzero " : ""}uint32.`);
  return value;
}

function exactSha256(value, label) {
  requireValue(typeof value === "string" && /^[0-9a-f]{64}$/u.test(value), "SCENE_RPC_SHA", `${label} must be lowercase SHA-256.`);
  return value;
}

function exactTransactionId(value) {
  requireValue(typeof value === "string" && /^[a-z0-9][a-z0-9._-]{7,39}$/u.test(value) &&
    Buffer.byteLength(value, "utf8") <= WIDGET_SCENE_RPC_LIMITS.maxTransactionIdBytes,
  "SCENE_RPC_TRANSACTION", "Scene transaction ID is invalid or too long.");
  return value;
}

function canonicalBase64(value, expectedBytes) {
  requireValue(typeof value === "string" && value.length > 0 && value.length <= Math.ceil(expectedBytes / 3) * 4,
    "SCENE_RPC_CHUNK", "Scene chunk base64 length is invalid.");
  requireValue(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value),
    "SCENE_RPC_CHUNK", "Scene chunk is not canonical base64.");
  const bytes = Buffer.from(value, "base64");
  requireValue(bytes.length === expectedBytes && bytes.toString("base64") === value,
    "SCENE_RPC_CHUNK", "Scene chunk base64 did not decode to its declared size.");
  return bytes;
}

function digest(value) { return createHash("sha256").update(value).digest(); }

/**
 * Validate F1WB without installing its first 20 bytes in the live scene store.
 * This is the executable reference for the firmware's header-last validator.
 */
function validateSplitWidgetBundle(header, store, totalBytes) {
  requireValue(header.length === WIDGET_SCENE_RPC_LIMITS.f1wbCommitHeaderBytes,
    "SCENE_F1WB_HEADER", "F1WB commit header has the wrong length.");
  requireValue(header.subarray(0, 4).toString("ascii") === "F1WB" && header[4] === 1 && header[5] === 3,
    "SCENE_F1WB_HEADER", "F1WB magic, version, or capacity is invalid.");
  const count = header[6];
  const activeSlot = header[7];
  const generation = header.readUInt32LE(8);
  requireValue(count >= 1 && count <= F1WB_CAPACITY && activeSlot < count &&
    header.readUInt32LE(12) === totalBytes && header.readUInt16LE(16) === F1WB_DESCRIPTOR_BYTES &&
    header.readUInt16LE(18) === F1WB_PAYLOAD_OFFSET,
  "SCENE_F1WB_HEADER", "F1WB header fields are invalid.");
  const slots = [];
  const ranges = [];
  for (let index = 0; index < count; index += 1) {
    const base = 20 + index * F1WB_DESCRIPTOR_BYTES;
    const kind = F1WB_KIND_NAMES[store[base + 1]];
    const nameLength = store[base + 2];
    requireValue(store[base] === 1 && kind && nameLength >= 1 && nameLength <= 16 && store[base + 3] === 0 &&
      store.subarray(base + 100, base + F1WB_DESCRIPTOR_BYTES).every((byte) => byte === 0),
    "SCENE_F1WB_DESCRIPTOR", `F1WB slot ${index} descriptor is invalid.`);
    const primaryOffset = store.readUInt32LE(base + 4);
    const primaryLength = store.readUInt32LE(base + 8);
    const auxiliaryOffset = store.readUInt32LE(base + 12);
    const auxiliaryLength = store.readUInt32LE(base + 16);
    requireValue(primaryLength > 0 && primaryOffset >= F1WB_PAYLOAD_OFFSET &&
      primaryOffset + primaryLength <= totalBytes,
    "SCENE_F1WB_RANGE", `F1WB slot ${index} primary range is invalid.`);
    requireValue(kind === "semantic"
      ? auxiliaryLength > 0 && auxiliaryOffset >= F1WB_PAYLOAD_OFFSET && auxiliaryOffset + auxiliaryLength <= totalBytes
      : auxiliaryLength === 0 && auxiliaryOffset === 0,
    "SCENE_F1WB_RANGE", `F1WB slot ${index} auxiliary range is invalid.`);
    const primary = store.subarray(primaryOffset, primaryOffset + primaryLength);
    const auxiliary = auxiliaryLength ? store.subarray(auxiliaryOffset, auxiliaryOffset + auxiliaryLength) : Buffer.alloc(0);
    requireValue(digest(primary).equals(store.subarray(base + 20, base + 52)) &&
      digest(auxiliary).equals(store.subarray(base + 52, base + 84)),
    "SCENE_F1WB_PAYLOAD_SHA", `F1WB slot ${index} payload SHA-256 failed.`);
    requireValue(primary.subarray(0, 4).toString("ascii") === (kind === "semantic" ? "F1SC" : "F1RA") &&
      (kind !== "semantic" || auxiliary.subarray(0, 4).toString("ascii") === "F1GA"),
    "SCENE_F1WB_PAYLOAD_MAGIC", `F1WB slot ${index} payload magic does not match ${kind}.`);
    ranges.push([primaryOffset, primaryOffset + primaryLength]);
    if (auxiliaryLength) ranges.push([auxiliaryOffset, auxiliaryOffset + auxiliaryLength]);
    slots.push(Object.freeze(kind === "semantic"
      ? { index, kind, sceneBinary: primary, atlasBinary: auxiliary }
      : { index, kind, animationBinary: primary }));
  }
  for (let index = count; index < F1WB_CAPACITY; index += 1) {
    const descriptor = store.subarray(20 + index * F1WB_DESCRIPTOR_BYTES, 20 + (index + 1) * F1WB_DESCRIPTOR_BYTES);
    requireValue(descriptor.every((byte) => byte === 0), "SCENE_F1WB_DESCRIPTOR",
      "F1WB has a nonzero undeclared slot descriptor.");
  }
  ranges.sort((left, right) => left[0] - right[0]);
  for (let index = 1; index < ranges.length; index += 1) {
    requireValue(ranges[index][0] >= ranges[index - 1][1], "SCENE_F1WB_RANGE", "F1WB payload ranges overlap.");
  }
  return Object.freeze({ generation, activeSlot, slots: Object.freeze(slots) });
}

function preflightSlotPayloads(split, semanticRenderers) {
  for (const slot of split.slots) {
    if (slot.kind === "raster") {
      admitRendererV1Raster(slot.animationBinary);
      continue;
    }
    decodeCssScene(slot.sceneBinary);
    const atlas = decodeGlyphAtlas(slot.atlasBinary);
    requireValue(atlas.testOnly !== true, "SCENE_TEST_ATLAS", `F1WB semantic slot ${slot.index} uses a test-only atlas.`);
    const adapter = semanticRenderers[slot.index];
    requireValue(Number.isInteger(adapter?.tickCount) && adapter.tickCount >= 1 && adapter.tickCount <= 65_535 &&
      typeof adapter.renderInto === "function", "SCENE_SEMANTIC_ADAPTER",
    `F1WB semantic slot ${slot.index} has no validated renderer adapter.`);
  }
}

export const RENDERER_V1_SCENE_STORE = Object.freeze({
  maxBundleBytes: WIDGET_SCENE_RPC_LIMITS.maxBundleBytes,
  framebufferBytes: RENDERER_V1.framebufferBytes,
  commitHeaderBytes: WIDGET_SCENE_RPC_LIMITS.f1wbCommitHeaderBytes,
  minimumRendererBytes: WIDGET_SCENE_RPC_LIMITS.maxBundleBytes + RENDERER_V1.framebufferBytes,
  model: "single-store-freeze-header-last",
  rollbackMode: "freeze-last-frame",
});

/**
 * Hardware-free state-machine specification for ID26's RPC task/UI-task handoff.
 * The JS validators may allocate diagnostic objects; the firmware contract is
 * one fixed scene store, one framebuffer, and a 20-byte header scratch only.
 */
export class RendererV1SceneRpcStaging {
  constructor({ runtime, proofId, semanticRenderers = {}, maxBundleBytes = WIDGET_SCENE_RPC_LIMITS.maxBundleBytes,
    chunkRawBytes = WIDGET_SCENE_RPC_LIMITS.chunkRawBytes, committedGeneration = 0,
    committedSha256 = "none", heapTelemetryAccepted = false, transactionTimeoutMs = 15_000,
    now = () => Date.now() } = {}) {
    requireValue(runtime && typeof runtime.queueAtomicBundleApply === "function" &&
      typeof runtime.tick100ms === "function", "SCENE_RUNTIME", "Scene RPC staging requires RendererV1Runtime.");
    requireValue(typeof proofId === "string" && /^[a-z0-9][a-z0-9._-]{7,95}$/u.test(proofId),
      "SCENE_PROOF", "Scene runtime proof ID is invalid.");
    requireValue(Number.isInteger(maxBundleBytes) && maxBundleBytes >= F1WB_PAYLOAD_OFFSET &&
      maxBundleBytes <= WIDGET_SCENE_RPC_LIMITS.maxBundleBytes, "SCENE_MEMORY", "Scene store byte bound is invalid.");
    requireValue(Number.isInteger(chunkRawBytes) && chunkRawBytes >= 256 &&
      chunkRawBytes <= WIDGET_SCENE_RPC_LIMITS.chunkRawBytes, "SCENE_MEMORY", "Scene chunk byte bound is invalid.");
    requireValue(Math.ceil(maxBundleBytes / chunkRawBytes) <= WIDGET_SCENE_RPC_LIMITS.maxChunks,
      "SCENE_MEMORY", "Scene store/chunk bounds exceed the maximum transaction chunk count.");
    uint32(committedGeneration, "committedGeneration");
    requireValue(committedSha256 === "none" || /^[0-9a-f]{64}$/u.test(committedSha256),
      "SCENE_RPC_SHA", "Committed scene SHA-256 is invalid.");
    requireValue(Number.isInteger(transactionTimeoutMs) && transactionTimeoutMs >= 1_000 &&
      transactionTimeoutMs <= 60_000 && typeof now === "function", "SCENE_RPC_RANGE", "Scene transaction timeout is invalid.");
    this.runtime = runtime;
    this.proofId = proofId;
    this.semanticRenderers = semanticRenderers;
    this.maxBundleBytes = maxBundleBytes;
    this.chunkRawBytes = chunkRawBytes;
    this.maxChunks = Math.ceil(maxBundleBytes / chunkRawBytes);
    this.heapTelemetryAccepted = heapTelemetryAccepted === true;
    this.transactionTimeoutMs = transactionTimeoutMs;
    this.now = now;
    this.sceneStore = Buffer.alloc(maxBundleBytes);
    this.dynamicStoreValid = false;
    this.committedGeneration = committedGeneration;
    this.committedSha256 = committedSha256;
    this.displayState = "running";
    this.transaction = null;
    this.pendingCommit = null;
  }

  #baseStatus() {
    return {
      status: "ok", accepted: true, protocol: WIDGET_SCENE_RPC_PROTOCOL,
      proofId: this.proofId, deviceFamily: "knob_f1", firmware: "0.4.1", screenId: 26,
      committedGeneration: this.committedGeneration, committedSha256: this.committedSha256,
      displayState: this.displayState, sceneStoreValid: this.dynamicStoreValid,
      uploadActive: this.transaction !== null, commitPending: this.pendingCommit !== null,
      recoveryRequired: this.displayState !== "running" && this.transaction === null && this.pendingCommit === null,
    };
  }

  #invalidateUpload() {
    this.sceneStore.fill(0, 0, WIDGET_SCENE_RPC_LIMITS.f1wbCommitHeaderBytes);
    this.dynamicStoreValid = false;
    this.transaction = null;
    this.pendingCommit = null;
    this.displayState = "frozen-last-frame";
  }

  #expireUpload() {
    if (this.transaction && this.now() - this.transaction.startedAtMs > this.transactionTimeoutMs) {
      this.#invalidateUpload();
    }
  }

  capabilities(params) {
    exactKeys(params, ["protocol"], "capabilities");
    exactProtocol(params.protocol);
    this.#expireUpload();
    return Object.freeze({ ...this.#baseStatus(), atomicF1wb: true, uiThreadApply: true, ramOnly: true,
      persistence: false, singleSceneStore: true, freezeOnUpload: true, headerLastCommit: true,
      rollbackMode: "freeze-last-frame", maxBundleBytes: this.maxBundleBytes,
      sceneStoreBytes: this.maxBundleBytes, framebufferBytes: RENDERER_V1.framebufferBytes,
      minimumRendererBytes: this.maxBundleBytes + RENDERER_V1.framebufferBytes,
      heapTelemetryAccepted: this.heapTelemetryAccepted, chunkRawBytes: this.chunkRawBytes,
      maxChunks: this.maxChunks });
  }

  status(params) {
    exactKeys(params, ["protocol"], "status");
    exactProtocol(params.protocol);
    this.#expireUpload();
    return Object.freeze(this.#baseStatus());
  }

  begin(params) {
    exactKeys(params, ["protocol", "transactionId", "expectedGeneration", "generation", "totalBytes",
      "totalChunks", "chunkRawBytes", "sha256"], "begin");
    exactProtocol(params.protocol);
    this.#expireUpload();
    requireValue(this.transaction === null && this.pendingCommit === null, "SCENE_RPC_BUSY", "A scene upload or commit is already active.");
    exactTransactionId(params.transactionId);
    uint32(params.expectedGeneration, "expectedGeneration");
    uint32(params.generation, "generation", { nonzero: true });
    requireValue(params.expectedGeneration === this.committedGeneration &&
      params.generation === params.expectedGeneration + 1, "SCENE_RPC_GENERATION", "Scene generation is stale or skipped.");
    requireValue(Number.isInteger(params.totalBytes) && params.totalBytes >= F1WB_PAYLOAD_OFFSET &&
      params.totalBytes <= this.maxBundleBytes, "SCENE_BUNDLE_OVERSIZE", "Scene bundle exceeds the fixed scene store.");
    requireValue(params.chunkRawBytes === this.chunkRawBytes, "SCENE_RPC_CHUNK", "Scene chunk size does not match capabilities.");
    const expectedChunks = Math.ceil(params.totalBytes / this.chunkRawBytes);
    requireValue(params.totalChunks === expectedChunks && expectedChunks >= 1 && expectedChunks <= this.maxChunks,
      "SCENE_RPC_CHUNK", "Scene chunk count does not match byte length.");
    exactSha256(params.sha256, "scene sha256");
    this.sceneStore.fill(0, 0, WIDGET_SCENE_RPC_LIMITS.f1wbCommitHeaderBytes);
    this.dynamicStoreValid = false;
    this.displayState = "frozen-last-frame";
    this.transaction = {
      ...params, header: Buffer.alloc(WIDGET_SCENE_RPC_LIMITS.f1wbCommitHeaderBytes),
      nextIndex: 0, receivedBytes: 0, startedAtMs: this.now(),
    };
    return Object.freeze({ ...this.#baseStatus(), transactionId: params.transactionId,
      generation: params.generation, nextIndex: 0 });
  }

  write(params) {
    try {
      exactKeys(params, ["protocol", "transactionId", "generation", "index", "offset", "bytes",
        "chunkSha256", "data"], "write");
      exactProtocol(params.protocol);
      this.#expireUpload();
      const tx = this.transaction;
      requireValue(tx, "SCENE_RPC_NO_TRANSACTION", "Scene chunk has no active transaction.");
      requireValue(params.transactionId === tx.transactionId && params.generation === tx.generation,
        "SCENE_RPC_TRANSACTION", "Scene chunk transaction or generation does not match.");
      requireValue(params.index === tx.nextIndex && params.offset === tx.receivedBytes,
        "SCENE_RPC_REORDERED", "Scene chunks must be written exactly once in ascending order.");
      const expectedBytes = Math.min(this.chunkRawBytes, tx.totalBytes - params.offset);
      requireValue(Number.isInteger(params.bytes) && params.bytes === expectedBytes && expectedBytes > 0,
        "SCENE_RPC_CHUNK", "Scene chunk has the wrong declared length.");
      exactSha256(params.chunkSha256, "chunkSha256");
      const bytes = canonicalBase64(params.data, expectedBytes);
      requireValue(widgetSceneSha256(bytes) === params.chunkSha256,
        "SCENE_RPC_CHUNK_SHA", "Scene chunk SHA-256 failed.");
      const headerBytes = WIDGET_SCENE_RPC_LIMITS.f1wbCommitHeaderBytes;
      if (params.offset < headerBytes) {
        const count = Math.min(bytes.length, headerBytes - params.offset);
        bytes.copy(tx.header, params.offset, 0, count);
      }
      const payloadOffset = Math.max(headerBytes, params.offset);
      if (payloadOffset < params.offset + bytes.length) {
        const sourceOffset = payloadOffset - params.offset;
        bytes.copy(this.sceneStore, payloadOffset, sourceOffset);
      }
      tx.nextIndex += 1;
      tx.receivedBytes += bytes.length;
      return Object.freeze({ ...this.#baseStatus(), transactionId: tx.transactionId,
        generation: tx.generation, index: params.index, nextIndex: tx.nextIndex });
    } catch (error) {
      if (this.transaction) this.#invalidateUpload();
      throw error;
    }
  }

  commit(params) {
    const hadTransaction = this.transaction !== null;
    try {
      exactKeys(params, ["protocol", "transactionId", "expectedGeneration", "generation", "totalBytes",
        "totalChunks", "sha256"], "commit");
      exactProtocol(params.protocol);
      this.#expireUpload();
      const tx = this.transaction;
      requireValue(tx, "SCENE_RPC_NO_TRANSACTION", "Scene commit has no active transaction.");
      for (const field of ["transactionId", "expectedGeneration", "generation", "totalBytes", "totalChunks", "sha256"]) {
        requireValue(params[field] === tx[field], "SCENE_RPC_COMMIT", `Scene commit ${field} does not match begin.`);
      }
      requireValue(tx.nextIndex === tx.totalChunks && tx.receivedBytes === tx.totalBytes,
        "SCENE_RPC_TORN", "Scene commit is incomplete or torn.");
      const whole = createHash("sha256").update(tx.header)
        .update(this.sceneStore.subarray(WIDGET_SCENE_RPC_LIMITS.f1wbCommitHeaderBytes, tx.totalBytes)).digest("hex");
      requireValue(whole === tx.sha256, "SCENE_RPC_SHA", "Complete scene bundle SHA-256 failed.");
      const split = validateSplitWidgetBundle(tx.header, this.sceneStore, tx.totalBytes);
      requireValue(split.generation === tx.generation, "SCENE_RPC_GENERATION", "F1WB generation does not match upload generation.");
      preflightSlotPayloads(split, this.semanticRenderers);

      // Publication marker is restored only after envelope, SHA, descriptors,
      // slot payloads, and renderer-specific records have all validated.
      tx.header.copy(this.sceneStore, 0);
      const decoded = decodeWidgetBundle(this.sceneStore.subarray(0, tx.totalBytes));
      const admitted = admitRendererV1DecodedWidgetBundle(decoded, { semanticRenderers: this.semanticRenderers });
      const runtimeGeneration = this.runtime.bundleGeneration;
      this.runtime.queueAtomicBundleApply(admitted, { expectedGeneration: runtimeGeneration });
      this.dynamicStoreValid = true;
      this.pendingCommit = Object.freeze({ generation: tx.generation, sha256: tx.sha256,
        totalBytes: tx.totalBytes, runtimeGeneration });
      this.transaction = null;
      return Object.freeze({ ...this.#baseStatus(), generation: params.generation,
        sha256: params.sha256, commitStatus: "queued" });
    } catch (error) {
      if (hadTransaction || this.transaction) this.#invalidateUpload();
      throw error;
    }
  }

  abort(params) {
    exactKeys(params, ["protocol", "transactionId", "generation"], "abort");
    exactProtocol(params.protocol);
    const tx = this.transaction;
    requireValue(tx && params.transactionId === tx.transactionId && params.generation === tx.generation,
      "SCENE_RPC_NO_TRANSACTION", "Scene abort has no matching active upload.");
    this.#invalidateUpload();
    return Object.freeze({ ...this.#baseStatus(), aborted: true, generation: params.generation });
  }

  handleRpc(method, params) {
    try {
      if (method === WIDGET_SCENE_RPC_METHODS.capabilities) return this.capabilities(params);
      if (method === WIDGET_SCENE_RPC_METHODS.begin) return this.begin(params);
      if (method === WIDGET_SCENE_RPC_METHODS.write) return this.write(params);
      if (method === WIDGET_SCENE_RPC_METHODS.commit) return this.commit(params);
      if (method === WIDGET_SCENE_RPC_METHODS.abort) return this.abort(params);
      if (method === WIDGET_SCENE_RPC_METHODS.status) return this.status(params);
      throw new SceneRpcFault("SCENE_RPC_METHOD", `Unsupported scene RPC method ${method}.`);
    } catch (error) {
      return Object.freeze({ status: "error", accepted: false, protocol: WIDGET_SCENE_RPC_PROTOCOL,
        code: error.code ?? "SCENE_RPC_INVALID", reason: error.message });
    }
  }

  tick100ms(args) {
    this.#expireUpload();
    if (this.transaction || this.displayState === "frozen-last-frame" && !this.pendingCommit) {
      return Object.freeze({ rendered: false, reason: "scene-upload-frozen", displayState: this.displayState });
    }
    const frame = this.runtime.tick100ms(args);
    if (this.pendingCommit && this.runtime.bundleGeneration === this.pendingCommit.runtimeGeneration + 1) {
      this.committedGeneration = this.pendingCommit.generation;
      this.committedSha256 = this.pendingCommit.sha256;
      this.pendingCommit = null;
      this.displayState = frame.rendered ? "running" : "fail-black";
    } else if (!this.pendingCommit && this.displayState === "fail-black" && frame.rendered) {
      this.displayState = "running";
    }
    return frame;
  }

  handleEncoder(args) {
    if (this.displayState !== "running" || this.transaction || this.pendingCommit) return false;
    return this.runtime.handleEncoder(args);
  }
}
