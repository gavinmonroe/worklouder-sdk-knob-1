export const STAGE3D_PET_STATE = Object.freeze({
  ready: 0,
  hatching: 1,
  sleeping: 2,
  waiting: 3,
  fire: 4,
  zooming: 5,
  happy: 6,
  tired: 7,
  steady: 8,
});

export const STAGE3D_LIMITS = Object.freeze({
  uiTickMs: 100,
  sampleEveryTicks: 5,
  warmupSamples: 20,
  waitingTicks: 50,
  sleepingTicks: 300,
  sessionResetTicks: 3000,
  celebrationSamples: 3,
  maximumWpm: 999,
  rebaseSampleCount: 65_536,
});

export function createStage3dPetState({ activityEpoch = 0 } = {}) {
  return {
    divider: 4,
    idleTicks: 0,
    activityEpoch: activityEpoch >>> 0,
    seenEpoch: activityEpoch >>> 0,
    activeSamples: 0,
    sampleCount: 0,
    sampleSum: 0,
    highWpm: 0,
    lowWpm: 0,
    celebrationSamples: 0,
    currentWpm: 0,
    averageWpm: 0,
    petState: STAGE3D_PET_STATE.ready,
    sessionActive: false,
  };
}

export function resetStage3dSession(state) {
  state.activeSamples = 0;
  state.sampleCount = 0;
  state.sampleSum = 0;
  state.highWpm = 0;
  state.lowWpm = 0;
  state.celebrationSamples = 0;
  state.currentWpm = 0;
  state.averageWpm = 0;
  state.petState = STAGE3D_PET_STATE.ready;
  state.sessionActive = false;
  return state;
}

function clampWpm(value) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(STAGE3D_LIMITS.maximumWpm, Math.trunc(value));
}

function selectPetState(state) {
  if (!state.sessionActive) return STAGE3D_PET_STATE.ready;
  if (state.idleTicks >= STAGE3D_LIMITS.sleepingTicks) return STAGE3D_PET_STATE.sleeping;
  if (state.idleTicks >= STAGE3D_LIMITS.waitingTicks) return STAGE3D_PET_STATE.waiting;
  if (state.activeSamples < STAGE3D_LIMITS.warmupSamples || state.sampleCount === 0) {
    return STAGE3D_PET_STATE.hatching;
  }
  if (state.celebrationSamples > 0) return STAGE3D_PET_STATE.fire;
  if (state.highWpm > 0 && state.currentWpm * 10 >= state.highWpm * 9) {
    return STAGE3D_PET_STATE.zooming;
  }
  if (state.currentWpm >= state.averageWpm) return STAGE3D_PET_STATE.happy;
  if (state.currentWpm * 10 <= state.lowWpm * 11) return STAGE3D_PET_STATE.tired;
  return STAGE3D_PET_STATE.steady;
}

function sampleStage3dPet(state, nativeWpm) {
  state.currentWpm = clampWpm(nativeWpm);
  const canSample = state.sessionActive &&
    state.idleTicks < STAGE3D_LIMITS.waitingTicks &&
    state.currentWpm > 0;

  if (canSample) {
    if (state.activeSamples < STAGE3D_LIMITS.warmupSamples) state.activeSamples += 1;
    if (state.activeSamples >= STAGE3D_LIMITS.warmupSamples) {
      if (state.sampleCount >= STAGE3D_LIMITS.rebaseSampleCount) {
        state.sampleCount >>>= 1;
        state.sampleSum >>>= 1;
      }

      const previousCount = state.sampleCount;
      const previousHigh = state.highWpm;
      state.sampleCount += 1;
      state.sampleSum += state.currentWpm;
      if (previousCount === 0) {
        state.highWpm = state.currentWpm;
        state.lowWpm = state.currentWpm;
      } else {
        if (state.currentWpm > previousHigh) {
          state.highWpm = state.currentWpm;
          if (previousCount >= 3) {
            state.celebrationSamples = STAGE3D_LIMITS.celebrationSamples;
          }
        }
        if (state.currentWpm < state.lowWpm) state.lowWpm = state.currentWpm;
      }
    }
  }

  state.averageWpm = state.sampleCount === 0
    ? 0
    : Math.trunc(state.sampleSum / state.sampleCount);
  state.petState = selectPetState(state);
  if (state.celebrationSamples > 0) state.celebrationSamples -= 1;
  return state;
}

/**
 * Executable specification for one native 100-ms LVGL refresh.
 *
 * The key callback is the sole writer of activityEpoch. The UI thread owns all
 * other fields and notices activity with an inequality comparison, so uint32
 * epoch wrap and a key arriving during screen construction are both harmless.
 */
export function advanceStage3dPet(state, { activityEpoch = state.activityEpoch, nativeWpm = 0 } = {}) {
  const epoch = activityEpoch >>> 0;
  state.activityEpoch = epoch;
  if (epoch !== state.seenEpoch) {
    if (state.sessionActive && state.idleTicks >= STAGE3D_LIMITS.sessionResetTicks) {
      resetStage3dSession(state);
    }
    state.seenEpoch = epoch;
    state.idleTicks = 0;
    state.sessionActive = true;
  } else if (state.sessionActive && state.idleTicks < STAGE3D_LIMITS.sessionResetTicks) {
    state.idleTicks += 1;
  }

  state.divider += 1;
  if (state.divider >= STAGE3D_LIMITS.sampleEveryTicks) {
    state.divider = 0;
    sampleStage3dPet(state, nativeWpm);
  }
  return state;
}
