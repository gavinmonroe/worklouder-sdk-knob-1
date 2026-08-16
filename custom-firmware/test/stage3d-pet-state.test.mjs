import assert from "node:assert/strict";
import test from "node:test";

import {
  STAGE3D_LIMITS,
  STAGE3D_PET_STATE,
  advanceStage3dPet,
  createStage3dPetState,
} from "../lib/stage3d-pet-state.mjs";

function tick(state, count, options) {
  for (let index = 0; index < count; index += 1) advanceStage3dPet(state, options);
  return state;
}

test("stage-3D begins on ready and any-key activity starts hatching", () => {
  const state = createStage3dPetState();
  advanceStage3dPet(state, { nativeWpm: 60 });
  assert.equal(state.petState, STAGE3D_PET_STATE.ready);

  advanceStage3dPet(state, { activityEpoch: 1, nativeWpm: 60 });
  assert.equal(state.sessionActive, true);
  assert.equal(state.idleTicks, 0);
  assert.equal(state.petState, STAGE3D_PET_STATE.ready,
    "the second call is between 500-ms samples and must not paint early");
  tick(state, 4, { activityEpoch: 1, nativeWpm: 60 });
  assert.equal(state.petState, STAGE3D_PET_STATE.hatching);
});

test("stage-3D matures after twenty active 500-ms samples and tracks A/H/L", () => {
  const state = createStage3dPetState();
  let epoch = 1;
  for (let sample = 0; sample < STAGE3D_LIMITS.warmupSamples; sample += 1) {
    tick(state, 5, { activityEpoch: epoch, nativeWpm: 40 + sample });
    epoch += 1;
  }
  assert.equal(state.activeSamples, STAGE3D_LIMITS.warmupSamples);
  assert.equal(state.sampleCount, 1);
  assert.equal(state.highWpm, 59);
  assert.equal(state.lowWpm, 59);
  assert.equal(state.averageWpm, 59);
  assert.equal(state.petState, STAGE3D_PET_STATE.zooming);

  for (const wpm of [50, 70, 55, 90]) {
    tick(state, 5, { activityEpoch: epoch++, nativeWpm: wpm });
  }
  assert.equal(state.activeSamples, STAGE3D_LIMITS.warmupSamples,
    "the firmware saturates its warmup counter once mature");
  assert.equal(state.sampleCount, 5);
  assert.equal(state.highWpm, 90);
  assert.equal(state.lowWpm, 50);
  assert.equal(state.averageWpm, 64);
  assert.equal(state.petState, STAGE3D_PET_STATE.fire);
});

test("stage-3D waits, sleeps, and resets only on the first key after five minutes", () => {
  const state = createStage3dPetState();
  tick(state, 5, { activityEpoch: 1, nativeWpm: 70 });
  tick(state, STAGE3D_LIMITS.waitingTicks, { activityEpoch: 1, nativeWpm: 70 });
  assert.equal(state.petState, STAGE3D_PET_STATE.waiting);
  tick(state, STAGE3D_LIMITS.sleepingTicks - STAGE3D_LIMITS.waitingTicks,
    { activityEpoch: 1, nativeWpm: 70 });
  assert.equal(state.petState, STAGE3D_PET_STATE.sleeping);
  tick(state, STAGE3D_LIMITS.sessionResetTicks, { activityEpoch: 1, nativeWpm: 70 });
  assert.equal(state.sessionActive, true, "idle alone preserves the sleeping session");

  advanceStage3dPet(state, { activityEpoch: 2, nativeWpm: 70 });
  assert.equal(state.sessionActive, true);
  assert.equal(state.idleTicks, 0);
  assert.equal(state.activeSamples, 1,
    "a wake key on a 500-ms boundary becomes the first sample of the new warmup");
  assert.equal(state.sampleCount, 0);
});

test("stage-3D clamps display and statistics to three digits", () => {
  const state = createStage3dPetState();
  state.sessionActive = true;
  state.seenEpoch = 1;
  state.activityEpoch = 1;
  state.activeSamples = STAGE3D_LIMITS.warmupSamples - 1;
  advanceStage3dPet(state, { activityEpoch: 1, nativeWpm: 65_535 });
  assert.equal(state.currentWpm, 999);
  assert.equal(state.sampleSum, 999);
  assert.equal(state.highWpm, 999);
  assert.equal(state.lowWpm, 999);
});

test("stage-3D rebases mature counters before uint32-scale accumulation grows indefinitely", () => {
  const state = createStage3dPetState();
  state.sessionActive = true;
  state.activeSamples = STAGE3D_LIMITS.warmupSamples;
  state.sampleCount = STAGE3D_LIMITS.rebaseSampleCount;
  state.sampleSum = 65_536 * 500;
  state.highWpm = 800;
  state.lowWpm = 200;
  advanceStage3dPet(state, { nativeWpm: 600 });
  assert.equal(state.sampleCount, 32_769);
  assert.equal(state.sampleSum, 16_384_600);
  assert.equal(state.averageWpm, 500);
});

test("stage-3D activity epoch comparison survives uint32 wrap", () => {
  const state = createStage3dPetState({ activityEpoch: 0xffff_ffff });
  advanceStage3dPet(state, { activityEpoch: 0, nativeWpm: 40 });
  assert.equal(state.seenEpoch, 0);
  assert.equal(state.sessionActive, true);
  assert.equal(state.idleTicks, 0);
});
