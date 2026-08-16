import {
  createStage3eSpriteState,
  sampleStage3eSprite,
} from "./stage3e-sprite-state.mjs";

export const STAGE3E1_LAYOUT = Object.freeze({
  canvas: Object.freeze({ width: 100, height: 310 }),
  sky: Object.freeze({ width: 100, height: 310, align: 9, x: 0, y: 0 }),
  pet: Object.freeze({ width: 68, height: 56, align: 9, x: 0, y: 0 }),
  wpm: Object.freeze({ align: 2, x: 0, y: 3 }),
  analytics: Object.freeze({ align: 5, x: 0, y: -3 }),
});

const clampMetric = (value) => Number.isFinite(value)
  ? Math.max(0, Math.min(999, Math.trunc(value)))
  : 0;

export function formatStage3e1Analytics(averageWpm, highWpm) {
  return `Avg ${clampMetric(averageWpm)}\nTop: ${clampMetric(highWpm)}`;
}

export function createStage3e1SpriteState() {
  return createStage3eSpriteState();
}

export function sampleStage3e1Sprite(state, nativeWpm) {
  return sampleStage3eSprite(state, nativeWpm, { displayLow: false });
}
