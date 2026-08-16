import assert from "node:assert/strict";
import test from "node:test";

import {
  STAGE3E1_LAYOUT,
  createStage3e1SpriteState,
  formatStage3e1Analytics,
  sampleStage3e1Sprite,
} from "../lib/stage3e1-full-canvas.mjs";

test("stage-3E.1 fills the logical 100x310 canvas and centers the pet", () => {
  assert.deepEqual(STAGE3E1_LAYOUT.canvas, { width: 100, height: 310 });
  assert.deepEqual(STAGE3E1_LAYOUT.sky, { width: 100, height: 310, align: 9, x: 0, y: 0 });
  assert.deepEqual(STAGE3E1_LAYOUT.pet, { width: 68, height: 56, align: 9, x: 0, y: 0 });
  assert.deepEqual(STAGE3E1_LAYOUT.wpm, { align: 2, x: 0, y: 3 });
  assert.deepEqual(STAGE3E1_LAYOUT.analytics, { align: 5, x: 0, y: -3 });
});

test("stage-3E.1 analytics are exactly Avg and Top on two lines", () => {
  assert.equal(formatStage3e1Analytics(42, 91), "Avg 42\nTop: 91");
  assert.equal(formatStage3e1Analytics(-1, 5_000), "Avg 0\nTop: 999");
  assert.equal(formatStage3e1Analytics(Number.NaN, 1.9), "Avg 0\nTop: 1");
});

test("stage-3E.1 keeps internal low statistics out of the display cache", () => {
  const state = createStage3e1SpriteState();
  sampleStage3e1Sprite(state, 50);
  sampleStage3e1Sprite(state, 50);
  assert.equal(state.statsRenderChanged, false);

  state.lowWpm = 1;
  state.lastRenderedLow = 999;
  sampleStage3e1Sprite(state, 50);
  assert.equal(state.statsRenderChanged, false,
    "a low-only change must not call lv_label_set_text for the Avg/Top label");
});
