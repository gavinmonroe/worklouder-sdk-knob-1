function invariant(value, message) {
  if (!value) throw new Error(message);
}

function staleError(token, currentRevision, reason) {
  return Object.assign(new Error(
    `Render v2 ${token.kind} belongs to source revision ${token.revision}, but revision ${currentRevision} is active${reason ? ` (${reason})` : ""}.`),
  { code: "RENDER_V2_STALE_OPERATION", operation: token.kind,
    operationRevision: token.revision, currentRevision });
}

/**
 * Single-flight coordinator for browser Render-v2 work. Source mutations
 * invalidate already running and queued work; callers must cross the supplied
 * assertion after every external await before publishing a result or touching
 * the device.
 */
export class RenderV2OperationGate {
  constructor({ onBusyChange = null } = {}) {
    invariant(onBusyChange === null || typeof onBusyChange === "function",
      "Render v2 operation gate onBusyChange must be a function.");
    this.onBusyChange = onBusyChange;
    this.revision = 0;
    this.serial = 0;
    this.pending = 0;
    this.reason = "initial";
    this.tail = Promise.resolve();
  }

  get busy() { return this.pending > 0; }

  invalidate(reason = "source changed") {
    this.revision += 1;
    this.reason = String(reason);
    return this.revision;
  }

  capture() {
    return Object.freeze({ revision: this.revision });
  }

  isCurrent(token) {
    return token?.revision === this.revision;
  }

  assertCurrent(token) {
    if (!this.isCurrent(token)) throw staleError(token, this.revision, this.reason);
  }

  run(kind, operation, { revision = this.revision } = {}) {
    invariant(typeof kind === "string" && kind.length > 0,
      "Render v2 operation kind is required.");
    invariant(typeof operation === "function", "Render v2 operation callback is required.");
    invariant(Number.isSafeInteger(revision) && revision >= 0,
      "Render v2 operation revision is invalid.");
    const token = Object.freeze({ kind, revision, serial: ++this.serial });
    this.pending += 1;
    if (this.pending === 1) this.onBusyChange?.(true, token);
    const invoke = async () => {
      this.assertCurrent(token);
      const guard = Object.freeze({ token,
        isCurrent: () => this.isCurrent(token),
        assertCurrent: () => this.assertCurrent(token) });
      const result = await operation(guard);
      this.assertCurrent(token);
      return result;
    };
    const result = this.tail.then(invoke, invoke);
    this.tail = result.then(() => undefined, () => undefined);
    result.then(() => this.#settled(token), () => this.#settled(token));
    return result;
  }

  #settled(token) {
    invariant(this.pending > 0, "Render v2 operation gate pending count underflowed.");
    this.pending -= 1;
    if (this.pending === 0) this.onBusyChange?.(false, token);
  }

  async idle() { await this.tail; }
}
