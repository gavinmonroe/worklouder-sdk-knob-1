import assert from "node:assert/strict";
import test from "node:test";

import {
  cycleRosterSpecies,
  petDescriptorAddress,
  petDescriptorIndex,
  ROSTER_STATE_ORDER,
  signExtendEncoderDelta,
} from "../src/roster.mjs";

test("zero-extended bottom-encoder deltas recover their signed direction", () => {
  assert.equal(signExtendEncoderDelta(0x01), 1);
  assert.equal(signExtendEncoderDelta(0xff), -1);
  assert.equal(signExtendEncoderDelta(0x80), -128);
});

test("Fn plus bottom encoder wraps RAM-only roster selection", () => {
  const input = (delta) => ({ encoderId: 1, delta, inputAvailable: true, fnPressed: true });
  assert.equal(cycleRosterSpecies(4, 6, input(1)), 5);
  assert.equal(cycleRosterSpecies(5, 6, input(1)), 0);
  assert.equal(cycleRosterSpecies(0, 6, input(0xff)), 5);
  assert.equal(cycleRosterSpecies(3, 6, { ...input(1), fnPressed: false }), 3);
  assert.equal(cycleRosterSpecies(3, 6, { ...input(1), encoderId: 0 }), 3);
});

test("pet descriptors follow sky0, sky1, then species*8+state", () => {
  assert.equal(ROSTER_STATE_ORDER.length, 8);
  assert.equal(petDescriptorIndex(0, 0, 6), 2);
  assert.equal(petDescriptorIndex(4, 3, 6), 37);
  assert.equal(petDescriptorIndex(5, 7, 6), 49);
  assert.equal(petDescriptorAddress(5, 7, 6), 0x3c1c1190 + 49 * 24);
  assert.throws(() => petDescriptorIndex(6, 0, 6), /outside/u);
});
