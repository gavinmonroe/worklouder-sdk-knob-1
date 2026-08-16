export const STAGE3E_CAT_FRAME = Object.freeze({
  ready: 0,
  curious: 1,
  happy: 2,
  zooming: 3,
  fire: 4,
  tired: 5,
  waiting: 6,
  sleeping: 7,
});

export const STAGE3E_LIMITS = Object.freeze({
  sampleMs: 500,
  matureSamples: 20,
  waitingSamples: 10,
  sleepingSamples: 60,
  celebrationSamples: 3,
  zoomingWpm: 80,
  happyWpm: 40,
  maximumWpm: 999,
  rebaseSampleCount: 65_536,
});

export function createStage3eSpriteState() {
  return {
    frame: STAGE3E_CAT_FRAME.ready,
    currentWpm: 0,
    previousWpm: 0,
    averageWpm: 0,
    highWpm: 0,
    lowWpm: 0,
    sampleCount: 0,
    sampleSum: 0,
    idleSamples: 0,
    celebrationSamples: 0,
    everActive: false,
    lastRenderedWpm: -1,
    lastRenderedAverage: -1,
    lastRenderedHigh: -1,
    lastRenderedLow: -1,
    lastColorBand: -1,
    wpmRenderChanged: false,
    statsRenderChanged: false,
    colorRenderChanged: false,
  };
}

function clampWpm(value) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(STAGE3E_LIMITS.maximumWpm, Math.trunc(value));
}

function selectFrame(state) {
  if (!state.everActive) return STAGE3E_CAT_FRAME.ready;
  if (state.idleSamples >= STAGE3E_LIMITS.sleepingSamples) {
    return STAGE3E_CAT_FRAME.sleeping;
  }
  if (state.idleSamples >= STAGE3E_LIMITS.waitingSamples) {
    return STAGE3E_CAT_FRAME.waiting;
  }
  if (state.celebrationSamples > 0) return STAGE3E_CAT_FRAME.fire;
  if (state.sampleCount >= STAGE3E_LIMITS.matureSamples) {
    if (state.highWpm > 0 && state.currentWpm * 10 >= state.highWpm * 9) {
      return STAGE3E_CAT_FRAME.zooming;
    }
    return state.currentWpm < state.averageWpm
      ? STAGE3E_CAT_FRAME.tired
      : STAGE3E_CAT_FRAME.happy;
  }
  return state.currentWpm >= STAGE3E_LIMITS.happyWpm
    ? STAGE3E_CAT_FRAME.happy
    : STAGE3E_CAT_FRAME.curious;
}

/**
 * Executable specification for one Stage-3E 500-ms native WPM sample.
 *
 * Stage-3E intentionally has no global key hook. A rising stock WPM value is
 * treated as activity; a plateau or decline advances the UI-owned idle clock.
 */
export function sampleStage3eSprite(state, nativeWpm, { displayLow = true } = {}) {
  const currentWpm = clampWpm(nativeWpm);
  state.currentWpm = currentWpm;

  if (currentWpm > state.previousWpm) {
    state.everActive = true;
    state.idleSamples = 0;
  } else if (state.everActive && state.idleSamples < STAGE3E_LIMITS.sleepingSamples) {
    state.idleSamples += 1;
  }
  state.previousWpm = currentWpm;

  const canSample = state.everActive &&
    state.idleSamples < STAGE3E_LIMITS.waitingSamples &&
    currentWpm > 0;
  if (canSample) {
    if (state.sampleCount >= STAGE3E_LIMITS.rebaseSampleCount) {
      state.sampleCount >>>= 1;
      state.sampleSum >>>= 1;
    }

    if (state.sampleCount === 0) {
      state.sampleCount = 1;
      state.sampleSum = currentWpm;
      state.highWpm = currentWpm;
      state.lowWpm = currentWpm;
    } else {
      state.sampleSum += currentWpm;
      state.sampleCount += 1;
      if (currentWpm > state.highWpm) {
        state.highWpm = currentWpm;
        if (state.sampleCount >= 4) {
          state.celebrationSamples = STAGE3E_LIMITS.celebrationSamples;
        }
      }
      if (currentWpm < state.lowWpm) state.lowWpm = currentWpm;
    }
  }

  state.averageWpm = state.sampleCount === 0
    ? 0
    : Math.trunc(state.sampleSum / state.sampleCount);
  state.frame = selectFrame(state);
  if (state.celebrationSamples > 0) state.celebrationSamples -= 1;

  const renderedHigh = state.sampleCount === 0 ? 0 : state.highWpm;
  const renderedLow = state.sampleCount === 0 ? 0 : state.lowWpm;
  const colorBand = state.currentWpm === 0
    ? 0
    : state.currentWpm < STAGE3E_LIMITS.happyWpm
      ? 1
      : state.currentWpm < STAGE3E_LIMITS.zoomingWpm ? 2 : 3;
  state.wpmRenderChanged = state.lastRenderedWpm !== state.currentWpm;
  state.statsRenderChanged = state.lastRenderedAverage !== state.averageWpm ||
    state.lastRenderedHigh !== renderedHigh ||
    (displayLow && state.lastRenderedLow !== renderedLow);
  state.colorRenderChanged = state.lastColorBand !== colorBand;
  state.lastRenderedWpm = state.currentWpm;
  state.lastRenderedAverage = state.averageWpm;
  state.lastRenderedHigh = renderedHigh;
  state.lastRenderedLow = renderedLow;
  state.lastColorBand = colorBand;
  return state;
}
