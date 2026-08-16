export const DEFAULT_WPM_PET_CONFIG = Object.freeze({
  tickMs: 500,
  smoothingNew: 0.1,
  smoothingOld: 0.9,
  warmupMs: 10_000,
  minimumWarmupWords: 5,
  idleMs: 5_000,
  sleepMs: 30_000,
  sessionResetMs: 5 * 60_000,
  celebrationMs: 1_500,
});

export const PET_FACES = Object.freeze({
  ready: "(o.o)",
  hatching: "(?.?)",
  sleeping: "(-.-)z",
  waiting: "(._.)",
  fire: "(^O^)!",
  zooming: "(>o<)",
  happy: "(^.^)",
  steady: "(o.o)",
  tired: "(u.u)",
});

function finiteTimestamp(value, label = "timestamp") {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a finite, non-negative number`);
  }
  return value;
}

function rounded(value) {
  return value === null ? null : Math.max(0, Math.round(value));
}

function validateConfig(input) {
  const config = { ...DEFAULT_WPM_PET_CONFIG, ...input };
  for (const key of [
    "tickMs",
    "warmupMs",
    "minimumWarmupWords",
    "idleMs",
    "sleepMs",
    "sessionResetMs",
    "celebrationMs",
  ]) {
    if (!Number.isFinite(config[key]) || config[key] <= 0) {
      throw new RangeError(`${key} must be greater than zero`);
    }
  }
  if (config.sleepMs <= config.idleMs) throw new RangeError("sleepMs must be greater than idleMs");
  if (config.sessionResetMs <= config.sleepMs) {
    throw new RangeError("sessionResetMs must be greater than sleepMs");
  }
  if (
    !Number.isFinite(config.smoothingNew) ||
    !Number.isFinite(config.smoothingOld) ||
    config.smoothingNew < 0 ||
    config.smoothingOld < 0 ||
    Math.abs(config.smoothingNew + config.smoothingOld - 1) > Number.EPSILON * 8
  ) {
    throw new RangeError("smoothingNew and smoothingOld must be non-negative and sum to 1");
  }
  return Object.freeze(config);
}

/**
 * Hardware-free model of the WPM tracker found in Framer F1 0.4.1.
 *
 * A completed word is a Space-key press. Every 500 ms the stock firmware
 * computes an instantaneous words/minute rate and applies a 0.1/0.9 EWMA.
 * `recordKey()` accepts every key for idle tracking and `wordCompleted: true`
 * for the Space event that contributes to WPM.
 */
export class WpmPetModel {
  constructor(config = {}) {
    this.config = validateConfig(config);
    this.sessionSerial = 0;
    this.lastObservedAtMs = null;
    this._clearSession();
  }

  _clearSession() {
    this.sessionStartMs = null;
    this.lastActivityMs = null;
    this.nextTickMs = null;
    this.pendingWords = 0;
    this.totalWords = 0;
    this.currentWpm = 0;
    this.sampleCount = 0;
    this.sampleSum = 0;
    this.highWpm = null;
    this.lowWpm = null;
    this.celebrateUntilMs = null;
  }

  reset(atMs = this.lastObservedAtMs ?? 0) {
    const at = finiteTimestamp(atMs);
    if (this.lastObservedAtMs !== null && at < this.lastObservedAtMs) {
      throw new RangeError("timestamps must be monotonic");
    }
    this.lastObservedAtMs = at;
    this.sessionSerial += 1;
    this._clearSession();
    return this.snapshot(at);
  }

  _assertMonotonic(atMs) {
    const at = finiteTimestamp(atMs);
    if (this.lastObservedAtMs !== null && at < this.lastObservedAtMs) {
      throw new RangeError("timestamps must be monotonic");
    }
    this.lastObservedAtMs = at;
    return at;
  }

  _beginSession(atMs) {
    this.sessionSerial += 1;
    this.sessionStartMs = atMs;
    this.lastActivityMs = atMs;
    this.nextTickMs = atMs + this.config.tickMs;
  }

  _advanceTicks(atMs, inclusive) {
    if (this.nextTickMs === null) return;
    const shouldAdvance = () => (inclusive ? this.nextTickMs <= atMs : this.nextTickMs < atMs);
    while (shouldAdvance()) {
      this._applyTick(this.nextTickMs);
      this.nextTickMs += this.config.tickMs;
    }
  }

  _applyTick(atMs) {
    const rawWpm = this.pendingWords * (60_000 / this.config.tickMs);
    this.currentWpm =
      this.currentWpm * this.config.smoothingOld + rawWpm * this.config.smoothingNew;
    this.pendingWords = 0;

    const ageMs = atMs - this.sessionStartMs;
    const idleForMs = atMs - this.lastActivityMs;
    const mature = ageMs >= this.config.warmupMs && this.totalWords >= this.config.minimumWarmupWords;
    if (!mature || idleForMs >= this.config.idleMs) return;

    const previousHigh = this.highWpm;
    const previousSampleCount = this.sampleCount;
    this.sampleCount += 1;
    this.sampleSum += this.currentWpm;
    this.highWpm = previousHigh === null ? this.currentWpm : Math.max(previousHigh, this.currentWpm);
    this.lowWpm = this.lowWpm === null ? this.currentWpm : Math.min(this.lowWpm, this.currentWpm);

    if (
      previousHigh !== null &&
      previousSampleCount >= 3 &&
      this.currentWpm > previousHigh + 0.5
    ) {
      this.celebrateUntilMs = atMs + this.config.celebrationMs;
    }
  }

  recordKey(atMs, { wordCompleted = false } = {}) {
    const at = this._assertMonotonic(atMs);
    if (
      this.lastActivityMs !== null &&
      at - this.lastActivityMs >= this.config.sessionResetMs
    ) {
      this._clearSession();
    }
    if (this.sessionStartMs === null) this._beginSession(at);

    // An event at a tick boundary belongs to that tick, matching a timer that
    // observes the counter after the event handler has run.
    this._advanceTicks(at, false);
    this.lastActivityMs = at;
    if (wordCompleted) {
      this.pendingWords += 1;
      this.totalWords += 1;
    }
    return this._makeSnapshot(at);
  }

  recordWord(atMs) {
    return this.recordKey(atMs, { wordCompleted: true });
  }

  snapshot(atMs) {
    const at = this._assertMonotonic(atMs);
    this._advanceTicks(at, true);
    return this._makeSnapshot(at);
  }

  _petState(atMs, metrics) {
    if (this.sessionStartMs === null) return "ready";
    if (metrics.idleForMs >= this.config.sleepMs) return "sleeping";
    if (metrics.idleForMs >= this.config.idleMs) return "waiting";
    if (!metrics.mature) return "hatching";
    if (this.celebrateUntilMs !== null && atMs <= this.celebrateUntilMs) return "fire";

    const high = this.highWpm ?? this.currentWpm;
    const average = this.sampleCount === 0 ? this.currentWpm : this.sampleSum / this.sampleCount;
    const low = this.lowWpm ?? this.currentWpm;
    if (high > 0 && this.currentWpm >= high * 0.9) return "zooming";
    if (this.currentWpm >= average) return "happy";
    if (this.currentWpm <= low * 1.1) return "tired";
    return "steady";
  }

  _makeSnapshot(atMs) {
    if (this.sessionStartMs === null) {
      return Object.freeze({
        atMs,
        session: this.sessionSerial,
        state: "ready",
        face: PET_FACES.ready,
        mature: false,
        idleForMs: null,
        currentWpm: 0,
        averageWpm: null,
        highWpm: null,
        lowWpm: null,
        completedWords: 0,
        samples: 0,
      });
    }

    const ageMs = atMs - this.sessionStartMs;
    const idleForMs = Math.max(0, atMs - this.lastActivityMs);
    const mature = ageMs >= this.config.warmupMs && this.totalWords >= this.config.minimumWarmupWords;
    const average = this.sampleCount === 0 ? null : this.sampleSum / this.sampleCount;
    const metrics = { ageMs, idleForMs, mature };
    const state = this._petState(atMs, metrics);
    return Object.freeze({
      atMs,
      session: this.sessionSerial,
      state,
      face: PET_FACES[state],
      mature,
      idleForMs,
      currentWpm: rounded(this.currentWpm),
      averageWpm: rounded(average),
      highWpm: rounded(this.highWpm),
      lowWpm: rounded(this.lowWpm),
      completedWords: this.totalWords,
      samples: this.sampleCount,
    });
  }
}

export function toBubbleRequest(snapshot) {
  const stats = snapshot.averageWpm === null
    ? `${snapshot.currentWpm} WPM | WARMING UP`
    : `${snapshot.currentWpm} WPM A${snapshot.averageWpm} H${snapshot.highWpm} L${snapshot.lowWpm}`;
  return Object.freeze({
    method: "v.framer.bubble",
    params: Object.freeze({
      l: `PET ${snapshot.state.toUpperCase()}`,
      v: `${snapshot.face} ${stats}`,
      d: ["ready", "waiting", "sleeping"].includes(snapshot.state) ? 0 : 1,
      s: 1,
    }),
  });
}

export const DEMO_PHASES = Object.freeze([
  Object.freeze({ name: "warmup", startMs: 0, endMs: 12_000, wpm: 30 }),
  Object.freeze({ name: "cruise", startMs: 12_000, endMs: 28_000, wpm: 60 }),
  Object.freeze({ name: "sprint", startMs: 28_000, endMs: 40_000, wpm: 105 }),
  Object.freeze({ name: "cooldown", startMs: 40_000, endMs: 52_000, wpm: 35 }),
]);

export function createDemoTimeline({ endMs = 90_000 } = {}) {
  const events = [];
  for (const phase of DEMO_PHASES) {
    const intervalMs = 60_000 / phase.wpm;
    for (let atMs = phase.startMs + intervalMs / 2; atMs < phase.endMs; atMs += intervalMs) {
      events.push({ atMs, phase: phase.name });
    }
  }
  events.sort((left, right) => left.atMs - right.atMs);

  const model = new WpmPetModel();
  const timeline = [];
  let eventIndex = 0;
  for (let atMs = 0; atMs <= endMs; atMs += model.config.tickMs) {
    while (eventIndex < events.length && events[eventIndex].atMs <= atMs) {
      model.recordWord(events[eventIndex].atMs);
      eventIndex += 1;
    }
    const snapshot = model.snapshot(atMs);
    timeline.push(Object.freeze({ ...snapshot, request: toBubbleRequest(snapshot) }));
  }
  return Object.freeze(timeline);
}
