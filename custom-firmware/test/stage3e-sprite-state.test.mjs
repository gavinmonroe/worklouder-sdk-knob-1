import assert from "node:assert/strict";
import test from "node:test";

import {
  STAGE3E_CAT_FRAME,
  STAGE3E_LIMITS,
  createStage3eSpriteState,
  sampleStage3eSprite,
} from "../lib/stage3e-sprite-state.mjs";

function sampleMany(state, count, value) {
  for (let index = 0; index < count; index += 1) sampleStage3eSprite(state, value);
  return state;
}

test("stage-3E frame indices match the pinned asset order", () => {
  assert.deepEqual(Object.values(STAGE3E_CAT_FRAME), [0, 1, 2, 3, 4, 5, 6, 7]);
});

test("stage-3E starts ready, then uses curious and happy warmup frames", () => {
  const state = createStage3eSpriteState();
  sampleStage3eSprite(state, 0);
  assert.equal(state.frame, STAGE3E_CAT_FRAME.ready);

  sampleStage3eSprite(state, 20);
  assert.equal(state.frame, STAGE3E_CAT_FRAME.curious);
  sampleStage3eSprite(state, 50);
  assert.equal(state.frame, STAGE3E_CAT_FRAME.happy);
  sampleStage3eSprite(state, 90);
  assert.equal(state.frame, STAGE3E_CAT_FRAME.happy,
    "absolute WPM does not zoom until the session statistics mature");
});

test("stage-3E zooms near the mature session high after celebration expires", () => {
  const state = createStage3eSpriteState();
  for (let value = 60; value < 60 + STAGE3E_LIMITS.matureSamples; value += 1) {
    sampleStage3eSprite(state, value);
  }
  sampleMany(state, 3, 79);
  assert.equal(state.frame, STAGE3E_CAT_FRAME.zooming);
  assert.ok(state.currentWpm * 10 >= state.highWpm * 9);
});

test("stage-3E uses waiting and sleeping only for non-rising idle time", () => {
  const state = createStage3eSpriteState();
  sampleStage3eSprite(state, 60);
  sampleMany(state, STAGE3E_LIMITS.waitingSamples, 60);
  assert.equal(state.frame, STAGE3E_CAT_FRAME.waiting);
  sampleMany(state,
    STAGE3E_LIMITS.sleepingSamples - STAGE3E_LIMITS.waitingSamples, 0);
  assert.equal(state.frame, STAGE3E_CAT_FRAME.sleeping);

  sampleStage3eSprite(state, 61);
  assert.equal(state.idleSamples, 0);
  assert.equal(state.frame, STAGE3E_CAT_FRAME.fire,
    "a post-sleep session high gets the same bounded celebration as any new high");
});

test("stage-3E mature below-average activity is tired", () => {
  const state = createStage3eSpriteState();
  for (let value = 60; value < 60 + STAGE3E_LIMITS.matureSamples; value += 1) {
    sampleStage3eSprite(state, value);
  }
  sampleMany(state, 3, 30);
  assert.equal(state.sampleCount, STAGE3E_LIMITS.matureSamples + 3);
  assert.equal(state.frame, STAGE3E_CAT_FRAME.tired);
});

test("stage-3E a mature new high celebrates for exactly three painted samples", () => {
  const state = createStage3eSpriteState();
  for (const value of [10, 11, 12, 13]) sampleStage3eSprite(state, value);
  assert.equal(state.frame, STAGE3E_CAT_FRAME.fire);
  assert.equal(state.celebrationSamples, 2);
  sampleStage3eSprite(state, 13);
  assert.equal(state.frame, STAGE3E_CAT_FRAME.fire);
  sampleStage3eSprite(state, 13);
  assert.equal(state.frame, STAGE3E_CAT_FRAME.fire);
  sampleStage3eSprite(state, 13);
  assert.equal(state.frame, STAGE3E_CAT_FRAME.curious);
});

test("stage-3E clamps WPM and rebases long-running statistics", () => {
  const state = createStage3eSpriteState();
  state.everActive = true;
  state.previousWpm = 400;
  state.sampleCount = STAGE3E_LIMITS.rebaseSampleCount;
  state.sampleSum = 65_536 * 500;
  state.highWpm = 800;
  state.lowWpm = 200;

  sampleStage3eSprite(state, 65_535);
  assert.equal(state.currentWpm, 999);
  assert.equal(state.sampleCount, 32_769);
  assert.equal(state.sampleSum, 16_384_999);
  assert.equal(state.averageWpm, 500);
  assert.equal(state.highWpm, 999);
});

test("stage-3E stops adding decaying residual WPM once waiting", () => {
  const state = createStage3eSpriteState();
  sampleStage3eSprite(state, 100);
  for (let value = 99; value >= 90; value -= 1) sampleStage3eSprite(state, value);
  const countAtWaiting = state.sampleCount;
  sampleMany(state, 5, 89);
  assert.equal(state.frame, STAGE3E_CAT_FRAME.waiting);
  assert.equal(state.sampleCount, countAtWaiting);
});

test("stage-3E render caches suppress unchanged label text and color churn", () => {
  const state = createStage3eSpriteState();
  sampleStage3eSprite(state, 50);
  assert.equal(state.wpmRenderChanged, true);
  assert.equal(state.statsRenderChanged, true);
  assert.equal(state.colorRenderChanged, true);

  sampleStage3eSprite(state, 50);
  assert.equal(state.wpmRenderChanged, false);
  assert.equal(state.statsRenderChanged, false);
  assert.equal(state.colorRenderChanged, false);

  sampleStage3eSprite(state, 51);
  assert.equal(state.wpmRenderChanged, true);
  assert.equal(state.statsRenderChanged, true);
  assert.equal(state.colorRenderChanged, false,
    "WPM text changes without repeating the unchanged medium-band color call");
});
