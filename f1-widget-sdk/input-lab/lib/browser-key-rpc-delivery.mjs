function invariant(value, message) {
  if (!value) throw new Error(message);
}

/**
 * Tracks the exact browser-device session that accepted a key-down level. A
 * matching zero is delivered to that same session even when a source revision
 * makes the release preview stale or uncompilable.
 */
export class BrowserKeyRpcDelivery {
  constructor({ dispatchPreview, getTarget } = {}) {
    invariant(typeof dispatchPreview === "function",
      "Browser key RPC delivery requires dispatchPreview().");
    invariant(typeof getTarget === "function", "Browser key RPC delivery requires getTarget().");
    this.dispatchPreview = dispatchPreview;
    this.getTarget = getTarget;
    this.active = null;
  }

  async deliver(payload) {
    invariant(payload && (payload.value === 0 || payload.value === 1),
      "Browser key RPC delivery accepts only level zero or one.");
    invariant(Number.isInteger(payload.id) && payload.id >= 1 && payload.id <= 0xffff,
      "Browser key RPC delivery id must be in 1..65535.");
    if (payload.value === 1) {
      const target = this.getTarget();
      // Record a possible device level before the preview/forward operation. A
      // device ACK can be followed by a stale-source assertion, so a rejected
      // promise does not prove that level one was never delivered. A later
      // defensive zero is harmless when the operation failed before transport.
      const tentative = target?.client ? Object.freeze({ client: target.client,
        capability: target.capability, id: payload.id }) : null;
      if (tentative) this.active = tentative;
      const preview = await this.dispatchPreview(payload);
      if (preview?.forwarded !== true && this.active === tentative) {
        this.active = null;
      }
      return Object.freeze({ ...preview, cleanupFallback: false, previewError: null });
    }

    const active = this.active;
    this.active = null;
    const currentTarget = this.getTarget();
    let preview = null;
    let previewError = null;
    try { preview = await this.dispatchPreview(payload); }
    catch (error) { previewError = error; }
    const sameCapability = currentTarget?.capability === active?.capability || Boolean(
      currentTarget?.capability && active?.capability &&
      currentTarget.capability.committedGeneration === active.capability.committedGeneration &&
      currentTarget.capability.renderV2Profile === active.capability.renderV2Profile);
    const releasedByPreview = Boolean(active && preview?.forwarded === true &&
      currentTarget?.client === active.client && sameCapability && payload.id === active.id);
    let cleanupFallback = false;
    if (active && !releasedByPreview) {
      await active.client.sendRenderV2HostEvent(active.id, 0);
      cleanupFallback = true;
    }
    if (previewError && !cleanupFallback) throw previewError;
    return Object.freeze({ ...(preview ?? {}), cleanupFallback, previewError });
  }
}
