import {
  createMediaHostHello,
  MEDIA_CHUNK_RAW_BYTES,
  MEDIA_TRANSPORT_PROTOCOL,
  mediaSha256,
  negotiateMediaCapabilities,
  normalizeMediaCapabilities,
} from "./protocol.mjs";

export const FRAMER_MEDIA_PUBLISHING_BLOCKER = Object.freeze({
  code: "NO_LIVE_PROVEN_FRAMER_MEDIA_HANDLER",
  status: "blocked",
  reason: "Host media source is ready, but no explicit SDK-pinned Framer handler proof was selected.",
  hardwareAccess: false,
  nomadMethodsNotAssumedCompatible: Object.freeze(["mp.write_info", "mp.write_artwork", "mp.fetch_data"]),
});

export const FRAMER_MEDIA_HANDLER_PROOF_FORMAT = "framer-media-handler-live-proof-v1";
const FRAMER_METADATA_FIELDS = Object.freeze([
  "song_title", "artist", "elapsed", "total_duration", "is_playing", "accent_color",
]);

export const LIVE_PROVEN_FRAMER_MEDIA_HANDLERS = Object.freeze([
  Object.freeze({
    id: "framer-f1-0.4.1-music-id1-b9b8eec6",
    format: FRAMER_MEDIA_HANDLER_PROOF_FORMAT,
    target: Object.freeze({ deviceFamily: "knob_f1", firmware: "0.4.1", screenId: 1 }),
    app: Object.freeze({
      bytes: 2_032_368,
      sha256: "b9b8eec6250392f593ae664fa8b8cba64bf861f5ef49a427c65be79e6f355817",
    }),
    code: Object.freeze({
      bytes: 6_332,
      sha256: "0f979d32f1a9b1203287cb71518b66367c66a1fa9e51a2c5f06be71bd15a804b",
    }),
    handlers: Object.freeze({ metadata: "mp.write_info", artwork: "mp.write_artwork" }),
    receipt: Object.freeze({
      id: "device-1786895154649",
      file: "build/device-receipts/device-1786895154649-fast-smoke.json",
      sha256: "95fbafe93ef45785e02e157f9047d9077bfee7030b4cb346ffa13da88a9550bf",
      writeHashVerifiedByEsptool: true,
      appOnly: true,
      postBootHealthy: true,
    }),
    liveValidation: Object.freeze({
      metadataAccepted: true,
      artworkChunkBytes: Object.freeze([3072, 3072, 3072, 3072, 512]),
      rpcAcceptancePending: false,
      oneShotTransactionPrefix: "6dc74f",
      uiThreadApply: true,
      wpmId7Preserved: true,
    }),
  }),
]);

export function isAcceptedFramerMediaResponse(response) {
  return response?.status === "ok" || response?.accepted === true;
}

function blockedCapabilities(reason = FRAMER_MEDIA_PUBLISHING_BLOCKER.reason) {
  return Object.freeze({
    protocol: MEDIA_TRANSPORT_PROTOCOL,
    type: "device-capabilities",
    deviceFamily: "knob_f1",
    status: "blocked",
    runtimeProof: "unproven",
    reason,
    hardwareAccess: false,
  });
}

export class BlockedMediaRuntimeSink {
  constructor(blocker = FRAMER_MEDIA_PUBLISHING_BLOCKER) {
    this.blocker = blocker;
  }

  async handshake(hello = createMediaHostHello()) {
    return negotiateMediaCapabilities(hello, blockedCapabilities(this.blocker.reason));
  }

  async publishMetadata() {
    throw new Error(this.blocker.code);
  }

  async beginArtwork() {
    throw new Error(this.blocker.code);
  }

  async writeArtworkChunk() {
    throw new Error(this.blocker.code);
  }

  async commitArtwork() {
    throw new Error(this.blocker.code);
  }
}

function mockCapabilities(overrides = {}) {
  return Object.freeze({
    protocol: MEDIA_TRANSPORT_PROTOCOL,
    type: "device-capabilities",
    deviceFamily: "knob_f1",
    status: "ready",
    runtimeProof: "mock",
    metadata: true,
    artwork: true,
    atomicArtworkCommit: true,
    uiThreadApply: true,
    maxTextBytes: 256,
    maxArtworkWidth: 80,
    maxArtworkHeight: 80,
    maxArtworkBytes: 80 * 80 * 2,
    chunkRawBytes: MEDIA_CHUNK_RAW_BYTES,
    artworkFormats: Object.freeze(["rgb565-le"]),
    hardwareAccess: false,
    ...overrides,
  });
}

export class MockMediaRuntimeSink {
  constructor({ capabilities = {}, reject = null } = {}) {
    this.capabilities = normalizeMediaCapabilities(mockCapabilities(capabilities));
    this.reject = reject;
    this.handshakes = [];
    this.metadata = [];
    this.committedArtwork = [];
    this.inflight = new Map();
  }

  async handshake(hello = createMediaHostHello()) {
    this.handshakes.push(hello);
    return negotiateMediaCapabilities(hello, this.capabilities);
  }

  async publishMetadata(message) {
    if (this.reject === "metadata") return { accepted: false, reason: "mock metadata rejection" };
    this.metadata.push(message);
    return { accepted: true, sha256: message.sha256 };
  }

  async beginArtwork(manifest) {
    if (this.reject === "begin") return { accepted: false, reason: "mock begin rejection" };
    this.inflight.set(manifest.transactionId, { manifest, chunks: [] });
    return { accepted: true, transactionId: manifest.transactionId };
  }

  async writeArtworkChunk(chunk) {
    if (this.reject === `chunk:${chunk.index}`) return { accepted: false, reason: "mock chunk rejection" };
    const transaction = this.inflight.get(chunk.transactionId);
    if (!transaction) throw new Error("Artwork chunk has no active transaction.");
    const expectedOffset = transaction.chunks.reduce((total, bytes) => total + bytes.length, 0);
    if (chunk.index !== transaction.chunks.length || chunk.offset !== expectedOffset) {
      throw new Error("Artwork chunk is out of order.");
    }
    const bytes = Buffer.from(chunk.data, "base64");
    if (bytes.length !== chunk.bytes || mediaSha256(bytes) !== chunk.sha256) {
      throw new Error("Artwork chunk failed size/hash validation.");
    }
    transaction.chunks.push(bytes);
    return { accepted: true, index: chunk.index, offset: chunk.offset };
  }

  async commitArtwork(commit) {
    if (this.reject === "commit") return { accepted: false, reason: "mock commit rejection" };
    const transaction = this.inflight.get(commit.transactionId);
    if (!transaction) throw new Error("Artwork commit has no active transaction.");
    const pixels = Buffer.concat(transaction.chunks);
    if (pixels.length !== commit.totalBytes || transaction.chunks.length !== commit.totalChunks ||
        mediaSha256(pixels) !== commit.sha256) {
      throw new Error("Artwork commit failed complete size/count/hash validation.");
    }
    this.inflight.delete(commit.transactionId);
    this.committedArtwork.push(Object.freeze({ manifest: transaction.manifest, commit, pixels }));
    return { accepted: true, transactionId: commit.transactionId, sha256: commit.sha256 };
  }

  async abortArtwork(manifest) {
    if (manifest?.transactionId) this.inflight.delete(manifest.transactionId);
  }
}

/**
 * Future Framer runtime sink. Its transport is injected so this module never
 * discovers or opens hardware. Today the immutable proof registry is empty,
 * therefore handshake returns blocked before calling transport.negotiate/rpc.
 */
export class FramerMediaRuntimeSink {
  constructor({ transport, proofId } = {}) {
    if (!transport || typeof transport.negotiate !== "function" || typeof transport.rpc !== "function") {
      throw new Error("Framer runtime transport requires injected negotiate() and rpc() functions.");
    }
    this.transport = transport;
    this.proofId = proofId ?? null;
    this.proof = null;
    this.capabilities = null;
    this.inflight = null;
    this.metadataState = null;
  }

  async handshake(hello = createMediaHostHello()) {
    this.proof = LIVE_PROVEN_FRAMER_MEDIA_HANDLERS.find(({ id }) => id === this.proofId) ?? null;
    if (!this.proof) {
      return negotiateMediaCapabilities(hello, blockedCapabilities(
        "No SDK-pinned live proof exists for Framer mp.write_info/mp.write_artwork handlers.",
      ));
    }
    const capabilities = negotiateMediaCapabilities(hello, await this.transport.negotiate(hello));
    if (capabilities.status !== "ready" || capabilities.runtimeProof !== "live-proven") {
      throw new Error("Pinned Framer handler proof did not negotiate a live-proven runtime.");
    }
    this.capabilities = capabilities;
    return capabilities;
  }

  assertReady() {
    if (!this.proof || this.capabilities?.status !== "ready") {
      throw new Error(FRAMER_MEDIA_PUBLISHING_BLOCKER.code);
    }
  }

  async publishMetadata(message) {
    this.assertReady();
    const stopped = message.payload?.song_title === "" && message.payload?.artist === "" &&
      message.payload?.elapsed === 0 && message.payload?.total_duration === 0 &&
      message.payload?.is_playing === false;
    const merged = { ...(this.metadataState ?? {}), ...message.payload };
    if (stopped) merged.accent_color = "#000000";
    for (const field of FRAMER_METADATA_FIELDS) {
      if (!Object.hasOwn(merged, field)) {
        throw new Error(`Framer metadata cannot publish before full field ${field} is known.`);
      }
    }
    const fullPayload = Object.freeze(Object.fromEntries(FRAMER_METADATA_FIELDS.map(
      (field) => [field, merged[field]],
    )));
    const response = await this.transport.rpc("mp.write_info", fullPayload);
    const accepted = isAcceptedFramerMediaResponse(response);
    if (accepted) this.metadataState = stopped ? null : fullPayload;
    return Object.freeze({ accepted, sha256: message.sha256 });
  }

  async heartbeat() {
    this.assertReady();
    if (!this.metadataState) return Object.freeze({ accepted: false, reason: "no accepted media state" });
    const response = await this.transport.rpc("mp.write_info", this.metadataState);
    return Object.freeze({ accepted: isAcceptedFramerMediaResponse(response) });
  }

  resetConnectionState() {
    this.inflight = null;
    this.metadataState = null;
  }

  async beginArtwork(manifest) {
    this.assertReady();
    if (this.inflight) throw new Error("A Framer artwork transaction is already active.");
    this.inflight = { manifest, nextIndex: 0, nextOffset: 0 };
    return Object.freeze({ accepted: true, transactionId: manifest.transactionId });
  }

  async writeArtworkChunk(chunk) {
    this.assertReady();
    if (!this.inflight || chunk.transactionId !== this.inflight.manifest.transactionId ||
        chunk.index !== this.inflight.nextIndex || chunk.offset !== this.inflight.nextOffset) {
      throw new Error("Framer artwork chunk is outside the active ordered transaction.");
    }
    let response;
    try {
      response = await this.transport.rpc("mp.write_artwork", {
        data: chunk.data,
        offset: chunk.offset,
        size: chunk.size,
      });
    } catch (error) {
      this.inflight = null;
      throw error;
    }
    if (!isAcceptedFramerMediaResponse(response)) {
      this.inflight = null;
      return Object.freeze({ accepted: false, reason: "runtime rejected chunk" });
    }
    this.inflight.nextIndex += 1;
    this.inflight.nextOffset += chunk.bytes;
    return Object.freeze({ accepted: true, index: chunk.index, offset: chunk.offset });
  }

  async commitArtwork(commit) {
    this.assertReady();
    if (!this.inflight || commit.transactionId !== this.inflight.manifest.transactionId ||
        this.inflight.nextIndex !== commit.totalChunks || this.inflight.nextOffset !== commit.totalBytes) {
      this.inflight = null;
      throw new Error("Framer artwork commit is incomplete or mismatched.");
    }
    this.inflight = null;
    return Object.freeze({ accepted: true, transactionId: commit.transactionId, sha256: commit.sha256 });
  }

  async abortArtwork() {
    this.inflight = null;
  }
}
