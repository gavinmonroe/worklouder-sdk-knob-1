import {
  createArtworkTransaction,
  createMediaHostHello,
  createMediaMetadataPayload,
  createMetadataMessage,
  createStoppedMetadataMessage,
  mediaSha256,
  normalizeMediaCapabilities,
  normalizeTransportSnapshot,
} from "./protocol.mjs";

function invariant(value, message) {
  if (!value) throw new Error(message);
}

function accepted(result, stage) {
  if (result?.accepted !== true) throw new Error(`${stage} rejected: ${result?.reason ?? "unknown reason"}`);
  return result;
}

export class MediaTransportSession {
  constructor({
    source,
    sink,
    pollIntervalMs = 1000,
    inactiveGraceMs = 8000,
    clock = Date.now,
    allowMockRuntime = false,
    initialGeneration = 1,
  } = {}) {
    invariant(source && typeof source.getCurrentMedia === "function", "source.getCurrentMedia() is required.");
    invariant(sink && typeof sink.handshake === "function", "sink.handshake() is required.");
    invariant(Number.isSafeInteger(pollIntervalMs) && pollIntervalMs >= 1000 && pollIntervalMs <= 60_000,
      "pollIntervalMs must be an integer in 1000..60000.");
    invariant(Number.isSafeInteger(initialGeneration) && initialGeneration > 0,
      "initialGeneration must be a positive integer.");
    invariant(Number.isSafeInteger(inactiveGraceMs) && inactiveGraceMs >= 0 && inactiveGraceMs <= 60_000,
      "inactiveGraceMs must be an integer in 0..60000.");
    invariant(typeof clock === "function", "clock must be a function.");
    this.source = source;
    this.sink = sink;
    this.pollIntervalMs = pollIntervalMs;
    this.inactiveGraceMs = inactiveGraceMs;
    this.clock = clock;
    this.allowMockRuntime = allowMockRuntime;
    this.nextGeneration = initialGeneration;
    this.capabilities = null;
    this.metadataKey = null;
    this.artworkKey = null;
    this.hadActiveMedia = false;
    this.previousSnapshot = null;
    this.inactiveSince = null;
    this.needsFullSync = false;
    this.running = false;
    this.timer = null;
    this.lastResult = null;
  }

  async handshake() {
    if (this.capabilities) return this.capabilities;
    const capabilities = normalizeMediaCapabilities(await this.sink.handshake(createMediaHostHello()));
    if (capabilities.status === "blocked") {
      this.capabilities = capabilities;
      return capabilities;
    }
    if (capabilities.runtimeProof !== "live-proven" &&
        !(this.allowMockRuntime && capabilities.runtimeProof === "mock")) {
      throw new Error(`Refusing ${capabilities.runtimeProof} media runtime; live proof is required.`);
    }
    this.capabilities = capabilities;
    return capabilities;
  }

  async publishArtwork(transaction) {
    try {
      accepted(await this.sink.beginArtwork(transaction.manifest), "artwork begin");
      for (const chunk of transaction.chunks) {
        accepted(await this.sink.writeArtworkChunk(chunk), `artwork chunk ${chunk.index}`);
      }
      accepted(await this.sink.commitArtwork(transaction.commit), "artwork commit");
    } catch (error) {
      await this.sink.abortArtwork?.(transaction.manifest);
      throw error;
    }
  }

  invalidatePublishedState() {
    this.metadataKey = null;
    this.artworkKey = null;
    this.needsFullSync = true;
    this.sink.resetConnectionState?.();
  }

  async pollOnce() {
    const capabilities = await this.handshake();
    if (capabilities.status === "blocked") {
      return Object.freeze({ status: "blocked", reason: capabilities.reason, hardwareAccess: capabilities.hardwareAccess });
    }

    const raw = await this.source.getCurrentMedia();
    if (raw === null || raw === undefined) {
      if (!this.hadActiveMedia) return Object.freeze({ status: "no-active-media", generation: null });
      const now = this.clock();
      if (this.inactiveSince === null) this.inactiveSince = now;
      const inactiveForMs = Math.max(0, now - this.inactiveSince);
      if (inactiveForMs < this.inactiveGraceMs) {
        let metadata = false;
        let generation = this.nextGeneration - 1;
        if (this.previousSnapshot?.isPlaying === true) {
          const retained = Object.freeze({ ...this.previousSnapshot, isPlaying: false });
          const message = createMetadataMessage(retained, capabilities, this.nextGeneration,
            this.needsFullSync ? null : this.previousSnapshot);
          try { accepted(await this.sink.publishMetadata(message), "transient inactive metadata"); }
          catch (error) { this.invalidatePublishedState(); throw error; }
          generation = this.nextGeneration++;
          this.metadataKey = mediaSha256(createMediaMetadataPayload(retained, capabilities));
          this.previousSnapshot = retained;
          this.needsFullSync = false;
          metadata = true;
        }
        return Object.freeze({ status: "retained-transient-inactive",
          generation, inactiveForMs, graceMs: this.inactiveGraceMs, metadata, artwork: false });
      }
      const stopped = createStoppedMetadataMessage(capabilities, this.nextGeneration);
      try { accepted(await this.sink.publishMetadata(stopped), "stopped metadata"); }
      catch (error) { this.invalidatePublishedState(); throw error; }
      const generation = this.nextGeneration++;
      this.metadataKey = null;
      this.artworkKey = null;
      this.hadActiveMedia = false;
      this.previousSnapshot = null;
      this.inactiveSince = null;
      this.needsFullSync = false;
      return Object.freeze({ status: "published-stopped", generation, metadata: true, artwork: false });
    }

    const snapshot = normalizeTransportSnapshot(raw, { maxTextBytes: capabilities.maxTextBytes });
    this.inactiveSince = null;
    const metadata = createMetadataMessage(snapshot, capabilities, this.nextGeneration,
      this.needsFullSync ? null : this.previousSnapshot);
    const artwork = createArtworkTransaction(snapshot, capabilities, this.nextGeneration);
    const metadataKey = mediaSha256(createMediaMetadataPayload(snapshot, capabilities));
    const artworkKey = mediaSha256(artwork.pixels);
    const metadataChanged = metadataKey !== this.metadataKey;
    const artworkChanged = artworkKey !== this.artworkKey;
    if (!metadataChanged && !artworkChanged) {
      if (typeof this.sink.heartbeat === "function") {
        try { accepted(await this.sink.heartbeat(), "media heartbeat"); }
        catch (error) { this.invalidatePublishedState(); throw error; }
        return Object.freeze({ status: "unchanged", generation: this.nextGeneration - 1, heartbeat: true });
      }
      return Object.freeze({ status: "unchanged", generation: this.nextGeneration - 1 });
    }

    try {
      if (artworkChanged) await this.publishArtwork(artwork);
      if (metadataChanged) accepted(await this.sink.publishMetadata(metadata), "media metadata");
    } catch (error) {
      this.invalidatePublishedState();
      throw error;
    }
    const generation = this.nextGeneration++;
    this.metadataKey = metadataKey;
    this.artworkKey = artworkKey;
    this.hadActiveMedia = true;
    this.previousSnapshot = snapshot;
    this.needsFullSync = false;
    return Object.freeze({
      status: "published",
      generation,
      metadata: metadataChanged,
      artwork: artworkChanged,
      transactionId: artworkChanged ? artwork.manifest.transactionId : null,
    });
  }

  start({ onResult, onError } = {}) {
    invariant(!this.running, "Media transport session is already running.");
    this.running = true;
    const tick = async () => {
      if (!this.running) return;
      const startedAt = this.clock();
      try {
        this.lastResult = await this.pollOnce();
        onResult?.(this.lastResult);
      } catch (error) {
        onError?.(error);
      }
      /* Maintain start-to-start cadence without overlap. Slow polls schedule
       * the next sample immediately; fast polls wait only the remaining part
       * of the interval instead of adding a full second after completion. */
      const elapsedMs = Math.max(0, this.clock() - startedAt);
      if (this.running) this.timer = setTimeout(tick, Math.max(0, this.pollIntervalMs - elapsedMs));
    };
    void tick();
    return () => this.stop();
  }

  stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
