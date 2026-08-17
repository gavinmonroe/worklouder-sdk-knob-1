const UINT32_MAX = 0xffffffff;
const PROFILE_ID = "framer-f1-render-v2-mquickjs-v1";

export const INPUT_LAB_MQUICKJS_INPUT_REASONS = Object.freeze({
  physical: 0,
  focusLoss: 1,
  disconnect: 2,
  queueResync: 3,
});

export const INPUT_LAB_MQUICKJS_INPUT_LIMITS = Object.freeze({
  keys: 16,
  chords: 8,
  chordKeys: 4,
  queueRecords: 32,
  drainRecords: 4,
  drainHolds: 2,
  pendingEvents: 64,
  callbacksPerIteration: 3,
  maxEventsPerDrain: 3,
  maxLogicalEventsPerBatch: 62,
  maxResyncEvents: 18,
  debounceMs: Object.freeze({ minimum: 1, maximum: 50, default: 10 }),
  holdDelayMs: Object.freeze({ minimum: 100, maximum: 5_000, default: 500 }),
  holdCadenceMs: Object.freeze({ minimum: 20, maximum: 1_000, default: 100 }),
});

export const INPUT_LAB_MQUICKJS_KEY_CAPABILITIES = Object.freeze({
  profileId: PROFILE_ID,
  eventNames: Object.freeze([
    "input.key.down",
    "input.key.up",
    "input.key.hold",
    "input.chord.down",
    "input.chord.up",
  ]),
  hostSimulation: true,
  exactHeldSnapshots: true,
  physicalKeyHookProven: false,
  physicalKeyIdentityProven: false,
  nativeTokenLearningProven: false,
  hardwareRuntimeProven: false,
});

function invariant(value, message) {
  if (!value) throw new Error(message);
}

function uint(value, maximum, label) {
  invariant(Number.isInteger(value) && value >= 0 && value <= maximum,
    `${label} must be an integer in 0..${maximum}.`);
  return value;
}

function uint32(value, label) {
  return uint(value, UINT32_MAX, label) >>> 0;
}

function bounded(value, limits, label) {
  invariant(Number.isInteger(value) && value >= limits.minimum && value <= limits.maximum,
    `${label} must be an integer in ${limits.minimum}..${limits.maximum}.`);
  return value;
}

function bitCount16(value) {
  let count = 0;
  for (let bits = value & 0xffff; bits !== 0; bits >>>= 1) count += bits & 1;
  return count;
}

function timeBefore(candidate, reference) {
  return ((candidate - reference) | 0) < 0;
}

function timeElapsed(now, then) {
  return (now - then) >>> 0;
}

function timeAdd(value, delta) {
  return (value + delta) >>> 0;
}

function normalizeReason(reason) {
  if (Number.isInteger(reason)) {
    invariant(Object.values(INPUT_LAB_MQUICKJS_INPUT_REASONS).includes(reason),
      "MicroQuickJS input reason is invalid.");
    return reason;
  }
  invariant(typeof reason === "string" &&
    Object.hasOwn(INPUT_LAB_MQUICKJS_INPUT_REASONS, reason),
  "MicroQuickJS input reason is invalid.");
  return INPUT_LAB_MQUICKJS_INPUT_REASONS[reason];
}

function normalizeCode(value, label) {
  if (value == null || value === "") return null;
  invariant(typeof value === "string" && value.length <= 64 && !/[\u0000-\u001f]/u.test(value),
    `${label} must be a 1..64 character browser KeyboardEvent.code label.`);
  return value;
}

export function normalizeInputLabMQuickJsKeyConfig(value = {}) {
  invariant(value && typeof value === "object" && !Array.isArray(value),
    "MicroQuickJS key configuration must be an object.");
  const sourceKeys = [...(value.keys ?? [])];
  invariant(sourceKeys.length <= INPUT_LAB_MQUICKJS_INPUT_LIMITS.keys,
    `MicroQuickJS Input Lab admits at most ${INPUT_LAB_MQUICKJS_INPUT_LIMITS.keys} keys.`);
  const codes = new Set();
  const tokens = new Set();
  const keys = sourceKeys.map((entry, index) => {
    invariant(entry && typeof entry === "object" && !Array.isArray(entry),
      `MicroQuickJS key ${index} must be an object.`);
    const id = uint(entry.id ?? index, INPUT_LAB_MQUICKJS_INPUT_LIMITS.keys - 1,
      `MicroQuickJS key ${index} ID`);
    invariant(id === index, "MicroQuickJS key IDs must be contiguous and ordered from zero.");
    const browserCode = normalizeCode(entry.browserCode ?? entry.code ?? null,
      `MicroQuickJS key ${index} browser code`);
    invariant(browserCode == null || !codes.has(browserCode),
      "MicroQuickJS browser key codes must be unique.");
    if (browserCode != null) codes.add(browserCode);
    const nativeToken = entry.nativeToken == null ? null :
      uint32(entry.nativeToken, `MicroQuickJS key ${index} native token`);
    invariant(nativeToken == null || !tokens.has(nativeToken),
      "MicroQuickJS native key tokens must be unique.");
    if (nativeToken != null) tokens.add(nativeToken);
    const label = entry.label == null ? browserCode : String(entry.label);
    invariant(label == null || (label.length > 0 && label.length <= 64),
      `MicroQuickJS key ${index} label must be 1..64 characters.`);
    return Object.freeze({ id, browserCode, nativeToken, label });
  });

  const admittedMask = keys.length === 16 ? 0xffff : (1 << keys.length) - 1;
  const chordMasks = new Set();
  const sourceChords = [...(value.chords ?? [])];
  invariant(sourceChords.length <= INPUT_LAB_MQUICKJS_INPUT_LIMITS.chords,
    `MicroQuickJS Input Lab admits at most ${INPUT_LAB_MQUICKJS_INPUT_LIMITS.chords} chords.`);
  const chords = sourceChords.map((entry, index) => {
    invariant(entry && typeof entry === "object" && !Array.isArray(entry),
      `MicroQuickJS chord ${index} must be an object.`);
    const id = uint(entry.id ?? index, INPUT_LAB_MQUICKJS_INPUT_LIMITS.chords - 1,
      `MicroQuickJS chord ${index} ID`);
    invariant(id === index, "MicroQuickJS chord IDs must be contiguous and ordered from zero.");
    const heldMask = uint(entry.heldMask, 0xffff, `MicroQuickJS chord ${index} held mask`);
    const keyCount = bitCount16(heldMask);
    invariant((heldMask & ~admittedMask) === 0 && keyCount >= 2 &&
      keyCount <= INPUT_LAB_MQUICKJS_INPUT_LIMITS.chordKeys,
    `MicroQuickJS chord ${index} must contain two to four admitted keys.`);
    invariant(!chordMasks.has(heldMask), "MicroQuickJS exact chord masks must be unique.");
    chordMasks.add(heldMask);
    return Object.freeze({ id, heldMask });
  });

  const timing = keys.length === 0 ? {
    debounceMs: 0,
    holdDelayMs: 0,
    holdCadenceMs: 0,
  } : {
    debounceMs: bounded(value.debounceMs ?? INPUT_LAB_MQUICKJS_INPUT_LIMITS.debounceMs.default,
      INPUT_LAB_MQUICKJS_INPUT_LIMITS.debounceMs, "MicroQuickJS debounce milliseconds"),
    holdDelayMs: bounded(value.holdDelayMs ?? INPUT_LAB_MQUICKJS_INPUT_LIMITS.holdDelayMs.default,
      INPUT_LAB_MQUICKJS_INPUT_LIMITS.holdDelayMs, "MicroQuickJS hold delay milliseconds"),
    holdCadenceMs: bounded(
      value.holdCadenceMs ?? INPUT_LAB_MQUICKJS_INPUT_LIMITS.holdCadenceMs.default,
      INPUT_LAB_MQUICKJS_INPUT_LIMITS.holdCadenceMs,
      "MicroQuickJS hold cadence milliseconds",
    ),
  };
  invariant(keys.length > 0 || chords.length === 0,
    "MicroQuickJS chords require admitted keys.");
  return Object.freeze({
    keys: Object.freeze(keys),
    chords: Object.freeze(chords),
    ...timing,
    deviceDeployable: keys.every(({ nativeToken }) => nativeToken != null),
  });
}

export function createInputLabMQuickJsPackageInput(value) {
  const config = normalizeInputLabMQuickJsKeyConfig(value);
  invariant(config.deviceDeployable,
    "Every MicroQuickJS device key needs an exact learned/admitted native u32 token.");
  return Object.freeze({
    events: Object.freeze({
      keys: Object.freeze(config.keys.map(({ id, nativeToken }) =>
        Object.freeze({ id, nativeToken }))),
      chords: Object.freeze(config.chords.map(({ id, heldMask }) =>
        Object.freeze({ id, heldMask }))),
    }),
    input: Object.freeze({ debounceMs: config.debounceMs,
      holdDelayMs: config.holdDelayMs, holdCadenceMs: config.holdCadenceMs }),
  });
}

export function mquickJsEventIsHeld(event, keyId) {
  invariant(event && Number.isInteger(event.heldMask),
    "widget.isHeld requires an event held snapshot.");
  uint(keyId, INPUT_LAB_MQUICKJS_INPUT_LIMITS.keys - 1, "MicroQuickJS key ID");
  return (event.heldMask & (1 << keyId)) !== 0;
}

export function normalizeMQuickJsNativeObservation(value) {
  invariant(value && typeof value === "object" && !Array.isArray(value),
    "MicroQuickJS native key observation must be an object.");
  const pressed = value.pressed === true || value.pressed === 1 ? true :
    value.pressed === false || value.pressed === 0 ? false : null;
  invariant(pressed != null, "MicroQuickJS native key observation level must be boolean.");
  return Object.freeze({
    nativeToken: uint32(value.nativeToken, "MicroQuickJS observed native token"),
    pressed,
    timestampMs: uint32(value.timestampMs, "MicroQuickJS observation timestamp"),
    observationSequence: bounded(value.observationSequence,
      { minimum: 1, maximum: UINT32_MAX }, "MicroQuickJS observation sequence"),
  });
}

export function createMQuickJsLearnedKeyBinding({ id, observation, label,
  browserCode = null } = {}) {
  const normalized = normalizeMQuickJsNativeObservation(observation);
  invariant(typeof label === "string" && label.length > 0 && label.length <= 64,
    "A learned MicroQuickJS key needs a 1..64 character user label.");
  return Object.freeze({
    id: uint(id, INPUT_LAB_MQUICKJS_INPUT_LIMITS.keys - 1, "Learned MicroQuickJS key ID"),
    nativeToken: normalized.nativeToken,
    label,
    browserCode: normalizeCode(browserCode, "Learned MicroQuickJS browser code"),
    learnedFromObservationSequence: normalized.observationSequence,
  });
}

export function assessInputLabMQuickJsKeyCapability(value = {}) {
  const errors = [];
  if (value.renderV2Profile !== PROFILE_ID) errors.push("renderV2Profile");
  if (value.nativeKeyEvents !== "opaque-u32-level-sequence-v1") errors.push("nativeKeyEvents");
  if (value.nativeKeyObservation !== "last-u32-level-sequence-v1") {
    errors.push("nativeKeyObservation");
  }
  if (value.stockFirstKeyHookProven !== true) errors.push("stockFirstKeyHookProven");
  if (value.vmOwnerInputQueue !== "fixed-spsc-authoritative-bitmap-v1") {
    errors.push("vmOwnerInputQueue");
  }
  return Object.freeze({ compatible: errors.length === 0,
    recordingCompatible: errors.length === 0, errors: Object.freeze(errors) });
}

export class InputLabMQuickJsNativeKeyRecorder {
  constructor({ capability = null, hostCanary = false } = {}) {
    this.assessment = assessInputLabMQuickJsKeyCapability(capability ?? {});
    invariant(hostCanary === true || this.assessment.recordingCompatible,
      "Device key recording requires the exact proven MicroQuickJS key capability.");
    this.hostCanary = hostCanary === true;
    this.lastObservation = null;
  }

  poll(value) {
    const observation = normalizeMQuickJsNativeObservation(value);
    if (this.lastObservation != null) {
      if (observation.observationSequence === this.lastObservation.observationSequence) return null;
      invariant(!timeBefore(observation.observationSequence,
        this.lastObservation.observationSequence),
      "MicroQuickJS observation sequence moved backward.");
    }
    this.lastObservation = observation;
    return observation;
  }

  bind({ id, label, browserCode = null } = {}) {
    invariant(this.lastObservation != null,
      "Record a native MicroQuickJS key observation before binding it.");
    return createMQuickJsLearnedKeyBinding({ id, observation: this.lastObservation,
      label, browserCode });
  }
}

export class InputLabMQuickJsKeySimulator {
  constructor(value = {}) {
    this.config = normalizeInputLabMQuickJsKeyConfig(value);
    this.codeToKey = new Map(this.config.keys.filter(({ browserCode }) => browserCode != null)
      .map(({ id, browserCode }) => [browserCode, id]));
    this.queue = Array.from({ length: INPUT_LAB_MQUICKJS_INPUT_LIMITS.queueRecords },
      () => ({ timestampMs: 0, key: 0, pressed: false }));
    this.queueHead = 0;
    this.queueTail = 0;
    this.queueCount = 0;
    this.keys = this.config.keys.map(() => ({ rawPressed: false, stablePressed: false,
      rawChangedMs: 0, nextHoldMs: 0, holdCount: 0 }));
    this.authoritativeHeldMask = 0;
    this.heldMask = 0;
    this.activeChord = -1;
    this.holdCursor = 0;
    this.sequence = 0;
    this.producerHasTimestamp = false;
    this.producerTimestampMs = 0;
    this.consumerHasTimestamp = false;
    this.consumerTimestampMs = 0;
    this.pendingResync = false;
    this.pendingResyncReason = INPUT_LAB_MQUICKJS_INPUT_REASONS.queueResync;
    this.deferredResync = null;
    this.pendingEvents = [];
    this.ingressEnabled = true;
    this.duplicateLevels = 0;
    this.queueOverflows = 0;
    this.resyncs = 0;
    this.eventsThisDrain = 0;
    this.logicalEventsThisBatch = 0;
    this.holdCursor = 0;
  }

  enqueueByCode(code, pressed, timestampMs) {
    const key = this.codeToKey.get(code);
    if (key == null) return Object.freeze({ status: "unbound", accepted: false });
    return this.enqueueKey(key, pressed, timestampMs);
  }

  enqueueKey(key, pressed, timestampMs) {
    uint(key, this.config.keys.length - 1, "MicroQuickJS simulator key ID");
    invariant(pressed === true || pressed === false,
      "MicroQuickJS simulator key level must be boolean.");
    const timestamp = uint32(timestampMs, "MicroQuickJS simulator input timestamp");
    if (!this.ingressEnabled) return Object.freeze({ status: "disabled", accepted: false });
    if (this.producerHasTimestamp) {
      invariant(!timeBefore(timestamp, this.producerTimestampMs),
        "MicroQuickJS simulator producer timestamp moved backward.");
    }
    this.producerHasTimestamp = true;
    this.producerTimestampMs = timestamp;
    const bit = 1 << key;
    if (((this.authoritativeHeldMask & bit) !== 0) === pressed) {
      this.duplicateLevels += 1;
      return Object.freeze({ status: "duplicate", accepted: true });
    }
    this.authoritativeHeldMask = pressed ? this.authoritativeHeldMask | bit :
      this.authoritativeHeldMask & ~bit;
    if (this.pendingResync) return Object.freeze({ status: "resync", accepted: true });
    if (this.queueCount === this.queue.length) {
      this.queueOverflows += 1;
      this.pendingResync = true;
      this.pendingResyncReason = INPUT_LAB_MQUICKJS_INPUT_REASONS.queueResync;
      return Object.freeze({ status: "resync", accepted: true });
    }
    const record = this.queue[this.queueHead];
    record.timestampMs = timestamp;
    record.key = key;
    record.pressed = pressed;
    this.queueHead = (this.queueHead + 1) % this.queue.length;
    this.queueCount += 1;
    return Object.freeze({ status: "queued", accepted: true });
  }

  drain(timestampMs) {
    const timestamp = uint32(timestampMs, "MicroQuickJS simulator drain timestamp");
    if (this.consumerHasTimestamp) {
      invariant(!timeBefore(timestamp, this.consumerTimestampMs),
        "MicroQuickJS simulator consumer timestamp moved backward.");
    }
    const events = [];
    this.eventsThisDrain = 0;
    if (this.pendingEvents.length > 0) return this.#finishIteration(false);
    this.logicalEventsThisBatch = 0;
    if (this.deferredResync != null) {
      const deferred = this.deferredResync;
      this.deferredResync = null;
      this.#applyResync(deferred.heldMask, deferred.timestampMs,
        deferred.reason, events);
      this.resyncs += 1;
      return this.#finishIteration(false);
    }
    if (this.pendingResync) {
      this.pendingResync = false;
      this.queueCount = 0;
      this.queueTail = this.queueHead;
      this.#applyResync(this.authoritativeHeldMask, timestamp,
        this.pendingResyncReason, events);
      this.resyncs += 1;
      invariant(events.length <= INPUT_LAB_MQUICKJS_INPUT_LIMITS.maxResyncEvents,
        "MicroQuickJS simulator resync event bound was exceeded.");
      return this.#finishIteration(false);
    }

    let records = 0;
    while (this.queueCount > 0 && records < INPUT_LAB_MQUICKJS_INPUT_LIMITS.drainRecords) {
      const record = this.queue[this.queueTail];
      if (timeBefore(timestamp, record.timestampMs)) break;
      if (!this.consumerHasTimestamp || !timeBefore(record.timestampMs,
        this.consumerTimestampMs)) {
        this.#advanceTo(record.timestampMs, 0, events);
      }
      const keyState = this.keys[record.key];
      if (keyState.rawPressed !== record.pressed) {
        keyState.rawPressed = record.pressed;
        keyState.rawChangedMs = record.timestampMs;
      }
      this.queueTail = (this.queueTail + 1) % this.queue.length;
      this.queueCount -= 1;
      records += 1;
    }
    const dueBacklog = this.queueCount > 0 &&
      !timeBefore(timestamp, this.queue[this.queueTail].timestampMs);
    if (!dueBacklog) this.#advanceTo(timestamp,
      INPUT_LAB_MQUICKJS_INPUT_LIMITS.drainHolds, events);
    return this.#finishIteration(dueBacklog);
  }

  releaseAll(timestampMs, reason = "focusLoss", { disableIngress = false } = {}) {
    const timestamp = uint32(timestampMs, "MicroQuickJS simulator release timestamp");
    const normalizedReason = normalizeReason(reason);
    invariant(normalizedReason === INPUT_LAB_MQUICKJS_INPUT_REASONS.focusLoss ||
      normalizedReason === INPUT_LAB_MQUICKJS_INPUT_REASONS.disconnect,
    "Synthetic release reason must be focusLoss or disconnect.");
    if (this.producerHasTimestamp) {
      invariant(!timeBefore(timestamp, this.producerTimestampMs),
        "MicroQuickJS simulator release timestamp moved backward.");
    }
    this.producerHasTimestamp = true;
    this.producerTimestampMs = timestamp;
    if (disableIngress) this.ingressEnabled = false;
    this.authoritativeHeldMask = 0;
    this.pendingResync = false;
    this.queueCount = 0;
    this.queueTail = this.queueHead;
    const events = [];
    this.eventsThisDrain = 0;
    if (this.pendingEvents.length > 0) {
      this.deferredResync = Object.freeze({ heldMask: 0, timestampMs: timestamp,
        reason: normalizedReason });
      return this.#finishIteration(true);
    }
    this.logicalEventsThisBatch = 0;
    this.#applyResync(0, timestamp, normalizedReason, events);
    this.resyncs += 1;
    return this.#finishIteration(false);
  }

  resumeIngress() {
    invariant(this.heldMask === 0 && this.authoritativeHeldMask === 0,
      "MicroQuickJS ingress can resume only from a released state.");
    this.ingressEnabled = true;
  }

  nextDueIn(timestampMs) {
    const timestamp = uint32(timestampMs, "MicroQuickJS simulator scheduler timestamp");
    if (this.pendingResync || this.deferredResync != null || this.pendingEvents.length > 0) return 0;
    let delay = null;
    if (this.queueCount > 0) {
      const queuedAt = this.queue[this.queueTail].timestampMs;
      delay = timeBefore(timestamp, queuedAt) ? timeElapsed(queuedAt, timestamp) : 0;
    }
    for (const key of this.keys) {
      let dueAt = null;
      if (key.rawPressed !== key.stablePressed) {
        dueAt = timeAdd(key.rawChangedMs, this.config.debounceMs);
      } else if (key.stablePressed) {
        dueAt = key.nextHoldMs;
      }
      if (dueAt == null) continue;
      const candidate = timeBefore(timestamp, dueAt) ? timeElapsed(dueAt, timestamp) : 0;
      if (delay == null || candidate < delay) delay = candidate;
    }
    return delay;
  }

  snapshot() {
    return Object.freeze({ heldMask: this.heldMask,
      authoritativeHeldMask: this.authoritativeHeldMask, sequence: this.sequence,
      queueRecords: this.queueCount, duplicateLevels: this.duplicateLevels,
      queueOverflows: this.queueOverflows, resyncs: this.resyncs,
      pendingEvents: this.pendingEvents.length,
      ingressEnabled: this.ingressEnabled });
  }

  #emit(events, type, timestampMs, details = {}) {
    invariant(this.logicalEventsThisBatch <
      INPUT_LAB_MQUICKJS_INPUT_LIMITS.maxLogicalEventsPerBatch,
    "MicroQuickJS simulator logical staging bound was exceeded.");
    invariant(this.pendingEvents.length < INPUT_LAB_MQUICKJS_INPUT_LIMITS.pendingEvents,
      "MicroQuickJS simulator pending event FIFO was exceeded.");
    this.logicalEventsThisBatch += 1;
    const event = Object.freeze({ type, sequence: 0, timestampMs,
      heldMask: this.heldMask, synthetic: details.synthetic === true, ...details });
    this.pendingEvents.push(event);
  }

  #finishIteration(baseMorePending) {
    const events = [];
    while (this.pendingEvents.length > 0 &&
      events.length < INPUT_LAB_MQUICKJS_INPUT_LIMITS.callbacksPerIteration) {
      invariant(this.sequence < UINT32_MAX, "MicroQuickJS simulator event sequence exhausted.");
      this.sequence += 1;
      const staged = this.pendingEvents.shift();
      events.push(Object.freeze({ ...staged, sequence: this.sequence }));
    }
    this.eventsThisDrain = events.length;
    const morePending = baseMorePending || this.pendingEvents.length > 0 ||
      this.deferredResync != null;
    return Object.freeze({ status: morePending ? "more-pending" : "ok",
      morePending, events: Object.freeze(events), heldMask: this.heldMask });
  }

  #exactChord() {
    return this.config.chords.find(({ heldMask }) => heldMask === this.heldMask)?.id ?? -1;
  }

  #reconcileChord(timestampMs, synthetic, reason, events) {
    const next = this.#exactChord();
    if (next === this.activeChord) return;
    if (this.activeChord >= 0) {
      const previous = this.activeChord;
      this.activeChord = -1;
      this.#emit(events, "input.chord.up", timestampMs,
        { chord: previous, reason, synthetic });
    }
    if (next >= 0) {
      this.activeChord = next;
      this.#emit(events, "input.chord.down", timestampMs,
        { chord: next, reason, synthetic });
    }
  }

  #advanceTo(timestampMs, holdBudget, events) {
    if (this.consumerHasTimestamp) {
      invariant(!timeBefore(timestampMs, this.consumerTimestampMs),
        "MicroQuickJS simulator stable input time moved backward.");
    }
    let dueMask = 0;
    this.keys.forEach((key, index) => {
      if (key.rawPressed !== key.stablePressed &&
        timeElapsed(timestampMs, key.rawChangedMs) >= this.config.debounceMs) {
        dueMask |= 1 << index;
      }
    });
    while (dueMask !== 0) {
      let groupTime = 0;
      let haveGroup = false;
      for (let key = 0; key < this.keys.length; key += 1) {
        if ((dueMask & (1 << key)) === 0) continue;
        const stableAt = timeAdd(this.keys[key].rawChangedMs, this.config.debounceMs);
        if (!haveGroup || timeBefore(stableAt, groupTime)) {
          groupTime = stableAt;
          haveGroup = true;
        }
      }
      let groupMask = 0;
      for (let key = 0; key < this.keys.length; key += 1) {
        if ((dueMask & (1 << key)) === 0) continue;
        const state = this.keys[key];
        const stableAt = timeAdd(state.rawChangedMs, this.config.debounceMs);
        if (stableAt !== groupTime) continue;
        groupMask |= 1 << key;
        state.stablePressed = state.rawPressed;
        state.holdCount = 0;
        if (state.stablePressed) {
          this.heldMask |= 1 << key;
          state.nextHoldMs = timeAdd(stableAt, this.config.holdDelayMs);
        } else {
          this.heldMask &= ~(1 << key);
          state.nextHoldMs = 0;
        }
      }
      for (let key = 0; key < this.keys.length; key += 1) {
        if ((groupMask & (1 << key)) === 0) continue;
        const pressed = this.keys[key].stablePressed;
        this.#emit(events, pressed ? "input.key.down" : "input.key.up", groupTime,
          { key, repeat: false, holdCount: 0,
            reason: INPUT_LAB_MQUICKJS_INPUT_REASONS.physical });
      }
      this.#reconcileChord(groupTime, false,
        INPUT_LAB_MQUICKJS_INPUT_REASONS.physical, events);
      dueMask &= ~groupMask;
    }

    const start = this.holdCursor;
    for (let scanned = 0; scanned < this.keys.length && holdBudget > 0; scanned += 1) {
      const key = (start + scanned) % this.keys.length;
      const state = this.keys[key];
      if (!state.stablePressed || timeBefore(timestampMs, state.nextHoldMs)) continue;
      state.holdCount = Math.min(0xffff, state.holdCount + 1);
      this.#emit(events, "input.key.hold", timestampMs,
        { key, repeat: true, holdCount: state.holdCount,
          reason: INPUT_LAB_MQUICKJS_INPUT_REASONS.physical });
      state.nextHoldMs = timeAdd(timestampMs, this.config.holdCadenceMs);
      this.holdCursor = (key + 1) % this.keys.length;
      holdBudget -= 1;
    }
    this.consumerHasTimestamp = true;
    this.consumerTimestampMs = timestampMs;
  }

  #applyResync(authoritativeMask, timestampMs, reason, events) {
    const changed = this.heldMask ^ authoritativeMask;
    this.heldMask = authoritativeMask;
    this.keys.forEach((state, key) => {
      const pressed = (authoritativeMask & (1 << key)) !== 0;
      state.rawPressed = pressed;
      state.stablePressed = pressed;
      state.rawChangedMs = timestampMs;
      state.holdCount = 0;
      state.nextHoldMs = pressed ? timeAdd(timestampMs, this.config.holdDelayMs) : 0;
      if ((changed & (1 << key)) !== 0) {
        this.#emit(events, pressed ? "input.key.down" : "input.key.up", timestampMs,
          { key, repeat: false, holdCount: 0, reason, synthetic: true });
      }
    });
    this.#reconcileChord(timestampMs, true, reason, events);
    this.consumerHasTimestamp = true;
    this.consumerTimestampMs = timestampMs;
  }
}

function editableTarget(value) {
  if (!value || typeof value !== "object") return false;
  if (value.isContentEditable === true) return true;
  const name = String(value.tagName ?? "").toLowerCase();
  return name === "input" || name === "textarea" || name === "select";
}

export class BrowserMQuickJsKeyBridge {
  constructor({ simulator, config, eventTarget = globalThis,
    documentTarget = eventTarget?.document ?? null,
    nowMs = () => Math.trunc(globalThis.performance?.now?.() ?? Date.now()),
    onEvents = () => {}, setTimer = globalThis.setTimeout?.bind(globalThis),
    clearTimer = globalThis.clearTimeout?.bind(globalThis) } = {}) {
    this.simulator = simulator ?? new InputLabMQuickJsKeySimulator(config);
    invariant(this.simulator instanceof InputLabMQuickJsKeySimulator,
      "Browser MicroQuickJS key bridge requires a key simulator.");
    invariant(eventTarget && typeof eventTarget.addEventListener === "function" &&
      typeof eventTarget.removeEventListener === "function",
    "Browser MicroQuickJS key bridge requires an EventTarget.");
    invariant(typeof nowMs === "function" && typeof onEvents === "function" &&
      typeof setTimer === "function" && typeof clearTimer === "function",
    "Browser MicroQuickJS key bridge dependencies are invalid.");
    this.eventTarget = eventTarget;
    this.documentTarget = documentTarget;
    this.nowMs = nowMs;
    this.onEvents = onEvents;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.timer = null;
    this.started = false;
    this.disconnectDraining = false;
    this.handlers = {
      keydown: (event) => this.#key(event, true),
      keyup: (event) => this.#key(event, false),
      blur: () => this.#release("focusLoss", false),
      pagehide: () => this.#release("focusLoss", false),
      visibilitychange: () => {
        if (this.documentTarget?.hidden === true) this.#release("focusLoss", false);
      },
    };
  }

  start() {
    if (this.started) return this;
    this.started = true;
    this.eventTarget.addEventListener("keydown", this.handlers.keydown);
    this.eventTarget.addEventListener("keyup", this.handlers.keyup);
    this.eventTarget.addEventListener("blur", this.handlers.blur);
    this.eventTarget.addEventListener("pagehide", this.handlers.pagehide);
    this.documentTarget?.addEventListener?.("visibilitychange", this.handlers.visibilitychange);
    return this;
  }

  flush(timestampMs = this.#now()) {
    const result = this.simulator.drain(timestampMs);
    this.#publish(result.events);
    if (this.disconnectDraining && !result.morePending) this.disconnectDraining = false;
    this.#schedule(timestampMs, result.morePending ? 0 : this.simulator.nextDueIn(timestampMs));
    return result;
  }

  disconnect() {
    if (!this.started) return Object.freeze({ status: "ok", morePending: false,
      events: Object.freeze([]), heldMask: this.simulator.snapshot().heldMask });
    const result = this.#release("disconnect", true);
    this.eventTarget.removeEventListener("keydown", this.handlers.keydown);
    this.eventTarget.removeEventListener("keyup", this.handlers.keyup);
    this.eventTarget.removeEventListener("blur", this.handlers.blur);
    this.eventTarget.removeEventListener("pagehide", this.handlers.pagehide);
    this.documentTarget?.removeEventListener?.("visibilitychange", this.handlers.visibilitychange);
    this.started = false;
    this.disconnectDraining = result.morePending;
    return result;
  }

  #now() {
    return uint32(Math.trunc(this.nowMs()) >>> 0, "Browser MicroQuickJS input timestamp");
  }

  #key(event, pressed) {
    if (event?.isComposing === true || (pressed && event?.repeat === true) ||
      editableTarget(event?.target)) return;
    const result = this.simulator.enqueueByCode(event?.code, pressed, this.#now());
    if (result.accepted) this.flush(this.simulator.producerTimestampMs);
  }

  #release(reason, disableIngress) {
    this.#cancelTimer();
    const timestamp = this.#now();
    const result = this.simulator.releaseAll(timestamp, reason, { disableIngress });
    this.#publish(result.events);
    if (result.morePending) this.#schedule(timestamp, 0);
    return result;
  }

  #publish(events) {
    if (events.length > 0) this.onEvents(events);
  }

  #cancelTimer() {
    if (this.timer != null) this.clearTimer(this.timer);
    this.timer = null;
  }

  #schedule(timestampMs, delay) {
    this.#cancelTimer();
    if ((!this.started && !this.disconnectDraining) || delay == null) return;
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.flush(timeAdd(timestampMs, Math.max(0, Math.trunc(delay))));
    }, Math.max(0, Math.trunc(delay)));
  }
}
