import assert from "node:assert/strict";
import test from "node:test";

import {
  STAGE3E2_DEFAULT_SPECIES,
  STAGE3E2_SPECIES,
  STAGE3E2_STATES,
  cycleStage3e2Species,
  signExtendEncoderDelta,
  stage3e2PetDescriptorAddress,
  stage3e2PetDescriptorIndex,
} from "../lib/stage3e2-species-control.mjs";

test("stage-3E.2 pins the exact requested roster and mood order", () => {
  assert.deepEqual(STAGE3E2_SPECIES, [
    "Belgian Tervuren", "Pepe", "Angry owl", "Cute ferret", "Cat", "Lazy cow",
  ]);
  assert.deepEqual(STAGE3E2_STATES,
    ["ready", "curious", "happy", "zooming", "fire", "tired", "waiting", "sleeping"]);
  assert.equal(STAGE3E2_DEFAULT_SPECIES, 4);
});

test("stage-3E.2 sign-extends the dispatcher's zero-extended delta byte", () => {
  assert.equal(signExtendEncoderDelta(1), 1);
  assert.equal(signExtendEncoderDelta(0xff), -1);
  assert.equal(signExtendEncoderDelta(0x80), -128);
});

test("stage-3E.2 Fn plus bottom encoder cycles and wraps in both directions", () => {
  const event = { encoderId: 1, fnPressed: true, inputAvailable: true };
  assert.equal(cycleStage3e2Species(4, { ...event, delta: 1 }), 5);
  assert.equal(cycleStage3e2Species(5, { ...event, delta: 1 }), 0);
  assert.equal(cycleStage3e2Species(0, { ...event, delta: 0xff }), 5);
  assert.equal(cycleStage3e2Species(3, { ...event, delta: 0xff }), 2);
});

test("stage-3E.2 ignores non-bottom, no-Fn, zero-delta, and unavailable-input events", () => {
  assert.equal(cycleStage3e2Species(4, { encoderId: 0, delta: 1, fnPressed: true }), 4);
  assert.equal(cycleStage3e2Species(4, { encoderId: 1, delta: 1, fnPressed: false }), 4);
  assert.equal(cycleStage3e2Species(4, { encoderId: 1, delta: 0, fnPressed: true }), 4);
  assert.equal(cycleStage3e2Species(4,
    { encoderId: 1, delta: 1, fnPressed: true, inputAvailable: false }), 4);
});

test("stage-3E.2 descriptor math is sky0/sky1 then species*8+state", () => {
  assert.equal(stage3e2PetDescriptorIndex(0, 0), 2);
  assert.equal(stage3e2PetDescriptorIndex(4, 0), 34);
  assert.equal(stage3e2PetDescriptorIndex(5, 7), 49);
  assert.equal(stage3e2PetDescriptorAddress(0, 0), 0x3c1c11c0);
  assert.equal(stage3e2PetDescriptorAddress(4, 0), 0x3c1c14c0);
  assert.equal(stage3e2PetDescriptorAddress(5, 7), 0x3c1c1628);
});
