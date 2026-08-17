import { publishWidgetSceneBundle, publishWidgetSceneBundleSmoke } from "../../src/render/scene-rpc.mjs";

function invariant(value, message) {
  if (!value) throw new Error(message);
}

export const FRAMER_SCENE_HANDLER_PROOF_FORMAT = "framer-scene-handler-live-proof-v1";
export const FRAMER_SCENE_PUBLISHING_BLOCKER = Object.freeze({
  code: "NO_LIVE_INPUT_LAB_SCENE_TRANSPORT",
  status: "blocked",
  reason: "No SDK-pinned ID26 scene-RPC proof with accepted heap telemetry is available.",
  hardwareAccess: false,
});

/**
 * This is exact historical evidence for the combined firmware base, not proof
 * that ID26 or widget.scene.* exists in that app. Keeping it outside the live
 * registry prevents a receipt for Music/WPM from being reused as scene proof.
 */
export const FRAMER_SCENE_HANDLER_CANDIDATES = Object.freeze([
  Object.freeze({
    id: "framer-f1-0.4.1-renderer-id26-candidate-b9b8eec6",
    format: FRAMER_SCENE_HANDLER_PROOF_FORMAT,
    target: Object.freeze({ deviceFamily: "knob_f1", firmware: "0.4.1", screenId: 26 }),
    baseApp: Object.freeze({
      bytes: 2_032_368,
      sha256: "b9b8eec6250392f593ae664fa8b8cba64bf861f5ef49a427c65be79e6f355817",
      codeSha256: "0f979d32f1a9b1203287cb71518b66367c66a1fa9e51a2c5f06be71bd15a804b",
    }),
    baseReceipt: Object.freeze({
      id: "device-1786895154649",
      file: "build/device-receipts/device-1786895154649-fast-smoke.json",
      sha256: "95fbafe93ef45785e02e157f9047d9077bfee7030b4cb346ffa13da88a9550bf",
      appOnly: true,
      postBootHealthy: true,
    }),
    liveValidation: Object.freeze({
      rendererId26Accepted: false,
      rpcAcceptancePending: true,
      heapTelemetryAccepted: false,
      singleSceneStoreAccepted: false,
    }),
  }),
]);

// Deliberately empty until a new exact app hash + device receipt proves ID26,
// all six methods, 160,304-byte renderer ownership, and a steady-state soak.
export const LIVE_PROVEN_FRAMER_SCENE_HANDLERS = Object.freeze([]);

function blockedError(reason = FRAMER_SCENE_PUBLISHING_BLOCKER.reason) {
  const error = new Error(reason);
  error.code = FRAMER_SCENE_PUBLISHING_BLOCKER.code;
  return error;
}

export class MockSceneTransport {
  constructor() {
    this.calls = [];
    this.activeSlot = null;
  }

  async applyScene({ scene, binary, slot }) {
    invariant(scene?.viewport?.width === 100 && scene?.viewport?.height === 310,
      "Scene transport requires an exact 100x310 scene.");
    invariant(Buffer.isBuffer(binary) && binary.length > 0, "Scene transport requires compiled bytes.");
    invariant(Number.isInteger(slot) && slot >= 0 && slot < 3, "Scene slot must be 0, 1, or 2.");
    this.activeSlot = slot;
    this.calls.push(Object.freeze({ slot, sha256: scene.sha256, bytes: binary.length }));
    return Object.freeze({ status: "mock-applied", mode: "mock", activeSlot: slot,
      sha256: scene.sha256, bytes: binary.length, hardwareAccess: false });
  }

  async applySceneBundle({ bundle, onProgress = null }) {
    invariant(bundle?.format === "framer-widget-bundle-v1" && Buffer.isBuffer(bundle.binary),
      "Scene transport requires an F1WB bundle.");
    invariant(onProgress === null || typeof onProgress === "function", "Scene progress must be a function.");
    onProgress?.(Object.freeze({ stage: "applying-local" }));
    this.activeSlot = bundle.activeSlot;
    this.calls.push(Object.freeze({ activeSlot: bundle.activeSlot, sha256: bundle.sha256,
      bytes: bundle.binary.length, slots: bundle.slots.length }));
    return Object.freeze({ status: "mock-bundle-applied", mode: "mock", activeSlot: bundle.activeSlot,
      sha256: bundle.sha256, bytes: bundle.binary.length, slots: bundle.slots.length, hardwareAccess: false });
  }
}

export class FailClosedLiveSceneTransport {
  constructor({ transport = null, proofId = null, confirmLiveRpc = false } = {}) {
    this.transport = transport;
    this.proofId = proofId;
    this.confirmLiveRpc = confirmLiveRpc === true;
  }

  #proof() {
    const proof = LIVE_PROVEN_FRAMER_SCENE_HANDLERS.find(({ id }) => id === this.proofId) ?? null;
    if (!proof) throw blockedError();
    if (!this.confirmLiveRpc) throw blockedError("Live scene RPC requires explicit confirmLiveRpc: true opt-in.");
    if (!this.transport || typeof this.transport.rpc !== "function") {
      throw blockedError("A pinned live scene proof still requires an injected rpc() transport.");
    }
    return proof;
  }

  async applyScene() {
    this.#proof();
    const error = new Error("Live scene updates require one complete atomic F1WB bundle.");
    error.code = "LIVE_SCENE_REQUIRES_F1WB";
    throw error;
  }

  async applySceneBundle({ bundle, onProgress = null } = {}) {
    const proof = this.#proof();
    invariant(bundle?.format === "framer-widget-bundle-v1" && Buffer.isBuffer(bundle.binary),
      "Live scene transport requires a compiled F1WB bundle.");
    return publishWidgetSceneBundle({ bundle, expectedProofId: proof.id,
      rpc: this.transport.rpc.bind(this.transport) });
  }
}

/**
 * Explicit research canary for the status-only ID26 callbacks. This transport
 * maintains generation only for one localhost/server session and never adds a
 * candidate to the immutable live-proof registry.
 */
export class StatusOnlyCanarySceneTransport {
  constructor({ transport = null, confirmLiveRpc = false, initialGeneration = 1,
    wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    handoffWaitMs = 150, generationRecoveryWindow = 64 } = {}) {
    invariant(confirmLiveRpc === true,
      "Status-only scene canary requires explicit confirmLiveRpc: true opt-in.");
    invariant(transport && typeof transport.rpc === "function",
      "Status-only scene canary requires an injected rpc() transport.");
    invariant(Number.isInteger(initialGeneration) && initialGeneration >= 0 && initialGeneration < 0xffffffff,
      "Status-only scene canary initialGeneration must be a uint32 below 0xffffffff.");
    invariant(typeof wait === "function", "Status-only scene canary wait must be a function.");
    invariant(Number.isInteger(handoffWaitMs) && handoffWaitMs >= 0 && handoffWaitMs <= 2_000,
      "Status-only scene canary handoffWaitMs must be 0..2000ms.");
    invariant(Number.isInteger(generationRecoveryWindow) && generationRecoveryWindow >= 0 && generationRecoveryWindow <= 256,
      "Status-only scene canary generationRecoveryWindow must be 0..256.");
    this.transport = transport;
    this.committedGeneration = initialGeneration;
    this.wait = wait;
    this.handoffWaitMs = handoffWaitMs;
    this.generationRecoveryWindow = generationRecoveryWindow;
    this.pushes = 0;
    this.busy = false;
    this.indeterminate = false;
  }

  async applyScene() {
    const error = new Error("Status-only live scene updates require one complete atomic F1WB bundle.");
    error.code = "LIVE_SCENE_REQUIRES_F1WB";
    throw error;
  }

  async applySceneBundle({ bundle, onProgress = null } = {}) {
    invariant(bundle?.format === "framer-widget-bundle-v1" && Buffer.isBuffer(bundle.binary) &&
      Array.isArray(bundle.slots) && Number.isInteger(bundle.activeSlot),
      "Status-only scene canary requires a compiled F1WB bundle.");
    if (this.indeterminate) {
      const error = new Error("Prior canary commit is indeterminate; restart Input Lab before another push.");
      error.code = "SCENE_CANARY_SESSION_INDETERMINATE";
      throw error;
    }
    if (this.busy) {
      const error = new Error("A status-only scene canary push is already active.");
      error.code = "SCENE_CANARY_BUSY";
      throw error;
    }
    this.busy = true;
    try {
      if (this.pushes > 0) await this.wait(this.handoffWaitMs);
      let result;
      let lastError;
      for (let offset = 0; offset <= this.generationRecoveryWindow; offset += 1) {
        const expectedGeneration = this.committedGeneration + offset;
        if (expectedGeneration >= 0xffffffff) break;
        try {
          result = await publishWidgetSceneBundleSmoke({ bundle,
            rpc: this.transport.rpc.bind(this.transport), confirmed: true,
            expectedGeneration, retryBeginOnce: true,
            wait: this.wait, beginRetryMs: this.handoffWaitMs, onProgress });
          break;
        } catch (error) {
          const rejectedBegin = error.code === "SCENE_RPC_REJECTED" &&
            /^Scene smoke begin /u.test(error.message) && error.rpcResponse?.status === "error";
          if (!rejectedBegin || offset === this.generationRecoveryWindow) throw error;
          lastError = error;
        }
      }
      if (!result) throw lastError ?? new Error("Unable to recover the keyboard scene generation.");
      this.committedGeneration = result.generation;
      this.pushes++;
      return Object.freeze({ ...result, slots: bundle.slots.length, activeSlot: bundle.activeSlot,
        sessionGeneration: this.committedGeneration });
    } catch (error) {
      if (error.code === "SCENE_COMMIT_INDETERMINATE") this.indeterminate = true;
      throw error;
    } finally {
      this.busy = false;
    }
  }
}

export function requireSceneTransport(transport) {
  invariant(transport && typeof transport.applySceneBundle === "function",
    "An injectable scene transport with applySceneBundle() is required.");
  return transport;
}
