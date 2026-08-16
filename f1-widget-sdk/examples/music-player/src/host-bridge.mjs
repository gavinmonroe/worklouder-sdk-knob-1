import { extractMainAlbumColor, normalizeMediaSnapshot, planHostUpdate } from "./media-contract.mjs";
import { buildOfflineMediaBundle } from "./package-media.mjs";
import { renderMusicFrame } from "./render.mjs";

function invariant(value, message) {
  if (!value) throw new Error(message);
}

/**
 * Provider-neutral host orchestrator. A source supplies media; a sink decides
 * whether the complete bounded transaction can be accepted. The bridge only
 * advances its update key/generation after an explicit sink acceptance.
 */
export class HostMediaBridge {
  constructor({ source, sink, progressBucketMs = 1000, initialGeneration = 1 } = {}) {
    invariant(source && typeof source.getCurrentMedia === "function",
      "source.getCurrentMedia() is required.");
    invariant(sink && typeof sink.publish === "function", "sink.publish() is required.");
    invariant(Number.isSafeInteger(progressBucketMs) && progressBucketMs > 0,
      "progressBucketMs must be a positive integer.");
    invariant(Number.isSafeInteger(initialGeneration) && initialGeneration > 0,
      "initialGeneration must be a positive integer.");
    this.source = source;
    this.sink = sink;
    this.progressBucketMs = progressBucketMs;
    this.nextGeneration = initialGeneration;
    this.previousKey = null;
  }

  async poll() {
    const raw = await this.source.getCurrentMedia();
    if (raw === null || raw === undefined) {
      return Object.freeze({ status: "no-active-media", generation: null, updateKey: null });
    }

    const snapshot = normalizeMediaSnapshot(raw);
    const plan = planHostUpdate(this.previousKey, snapshot, {
      progressBucketMs: this.progressBucketMs,
    });
    if (!plan.changed) {
      return Object.freeze({
        status: "unchanged",
        generation: this.nextGeneration - 1,
        updateKey: plan.updateKey,
      });
    }

    const mainColor = extractMainAlbumColor(snapshot.albumArt);
    const rendered = renderMusicFrame(snapshot, mainColor);
    const bundle = buildOfflineMediaBundle(snapshot, mainColor, rendered, {
      generation: this.nextGeneration,
    });
    const delivery = await this.sink.publish(Object.freeze({
      snapshot,
      mainColor,
      rendered,
      bundle,
      provenance: raw.provenance ?? null,
    }));

    if (delivery?.accepted !== true) {
      return Object.freeze({
        status: delivery?.status ?? "sink-rejected",
        generation: this.nextGeneration,
        updateKey: plan.updateKey,
        accepted: false,
        blocker: delivery?.blocker ?? null,
      });
    }

    this.previousKey = plan.updateKey;
    const generation = this.nextGeneration;
    this.nextGeneration += 1;
    return Object.freeze({
      status: "published",
      generation,
      updateKey: plan.updateKey,
      transactionId: bundle.manifest.transactionId,
      accepted: true,
    });
  }
}

export { MediaTransportSession } from "../../../src/media-transport/session.mjs";
