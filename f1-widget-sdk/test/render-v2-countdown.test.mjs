import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  COUNTDOWN_HOST_EVENTS,
  COUNTDOWN_INPUT_CAPABILITIES,
  countdownFrameBytes,
  countdownViewModel,
  createCountdownState,
  encodeCountdownHostChord,
  formatCountdown,
  reduceCountdown,
  renderCountdownRgb565,
  signedCountdownEncoderDelta,
} from "../src/render-v2/index.mjs";

function dispatch(state, event, config) {
  return reduceCountdown(state, event, config).state;
}

test("countdown holds a canonical chord, edits with the bottom encoder, and starts on release", () => {
  const config = { chord: ["space", "fn"], stepSeconds: 60 };
  let state = createCountdownState(config);

  const wrongChord = reduceCountdown(state,
    { kind: "chord", chord: "fn+enter", pressed: true }, config);
  assert.equal(wrongChord.consumed, false);
  assert.equal(wrongChord.reason, "other-chord");
  assert.equal(wrongChord.state, state);

  state = dispatch(state, { kind: "chord", chord: "fn+space", pressed: true }, config);
  assert.equal(state.phase, "editing");
  assert.equal(state.chordHeld, true);
  state = dispatch(state, { kind: "encoder", encoderId: 1, delta: 5 }, config);
  assert.equal(state.draftSeconds, 300);

  const paused = reduceCountdown(state, { kind: "tick.1s" }, config);
  assert.equal(paused.consumed, false);
  assert.equal(paused.reason, "paused-for-edit");
  assert.equal(paused.state, state);

  state = dispatch(state, { kind: "chord", chord: ["space", "fn"], pressed: false }, config);
  assert.equal(state.phase, "running");
  assert.equal(state.initialSeconds, 300);
  assert.equal(state.remainingSeconds, 300);
  state = dispatch(state, { kind: "tick.1s" }, config);
  assert.equal(state.remainingSeconds, 299);
  assert.equal(state.elapsedTicks, 1);
  assert.deepEqual(countdownViewModel(state, config), {
    display: "04:59",
    seconds: 299,
    phase: "running",
    status: "RUNNING",
    progress: 299 / 300,
    needleDegrees: -72 + (299 / 300) * 144,
    chord: "fn+space",
    chordHeld: false,
  });
});

test("countdown ignores other encoders, decodes signed low bytes, clamps, resumes, and finishes", () => {
  const config = { chord: "fn", stepSeconds: 60, maxSeconds: 120, presetSeconds: 60 };
  assert.equal(signedCountdownEncoderDelta(0xff), -1);
  assert.equal(signedCountdownEncoderDelta(0x80), -128);
  assert.equal(signedCountdownEncoderDelta(0x7f), 127);
  assert.throws(() => signedCountdownEncoderDelta(256), /-128\.\.255/u);

  let state = createCountdownState(config);
  state = dispatch(state, { kind: "chord", chord: "fn", pressed: true }, config);
  const other = reduceCountdown(state, { kind: "encoder", encoderId: 2, delta: 1 }, config);
  assert.equal(other.consumed, false);
  assert.equal(other.reason, "other-encoder");
  state = dispatch(state, { kind: "encoder", encoderId: 1, delta: 0xff }, config);
  assert.equal(state.draftSeconds, 0);
  assert.equal(reduceCountdown(state, { kind: "encoder", encoderId: 1, delta: 0xff }, config).reason,
    "limit");
  state = dispatch(state, { kind: "encoder", encoderId: 1, delta: 127 }, config);
  assert.equal(state.draftSeconds, 120);
  state = dispatch(state, { kind: "chord", chord: "fn", pressed: false }, config);
  assert.equal(state.phase, "running");

  state = dispatch(state, { kind: "tick.1s" }, config);
  assert.equal(state.remainingSeconds, 119);
  state = dispatch(state, { kind: "chord", chord: "fn", pressed: true }, config);
  assert.equal(state.phase, "editing");
  assert.equal(state.draftSeconds, 119, "editing a running timer snapshots its remaining time");
  state = dispatch(state, { kind: "encoder", encoderId: 1, delta: 0xff }, config);
  assert.equal(state.draftSeconds, 59);
  state = dispatch(state, { kind: "chord", chord: "fn", pressed: false }, config);
  assert.equal(state.phase, "running");
  assert.equal(state.initialSeconds, 59);

  for (let second = 0; second < 59; second += 1) {
    state = dispatch(state, { kind: "tick.1s" }, config);
  }
  assert.equal(state.phase, "finished");
  assert.equal(state.remainingSeconds, 0);
  assert.equal(formatCountdown(state.remainingSeconds), "00:00");
  assert.equal(reduceCountdown(state, { kind: "tick.1s" }, config).reason, "not-running");
});

test("countdown host envelopes are exact while the capability matrix remains fail-closed", () => {
  assert.equal(COUNTDOWN_INPUT_CAPABILITIES.accepted.bottomEncoder.id, 1);
  assert.equal(COUNTDOWN_INPUT_CAPABILITIES.staticGolden.hostRpc.acceptedEventId, 0xb201);
  assert.equal(COUNTDOWN_HOST_EVENTS.chordLevel, 0xb210);
  assert.notEqual(COUNTDOWN_HOST_EVENTS.chordLevel,
    COUNTDOWN_INPUT_CAPABILITIES.staticGolden.hostRpc.acceptedEventId);
  assert.match(COUNTDOWN_INPUT_CAPABILITIES.notYetProven.arbitraryKeyIdentity, /only an any-key/u);
  assert.match(COUNTDOWN_INPUT_CAPABILITIES.notYetProven.fnReleasePolling, /physical canary/u);
  assert.deepEqual(encodeCountdownHostChord(true), {
    method: "widget.v2.event",
    params: { id: 0xb210, value: 1 },
  });
  assert.deepEqual(encodeCountdownHostChord(false), {
    method: "widget.v2.event",
    params: { id: 0xb210, value: 0 },
  });
  assert.throws(() => encodeCountdownHostChord(1), /must be boolean/u);
});

test("countdown preview is a deterministic 100x310 RGB565 blue/black dial", () => {
  const config = { chord: "fn", stepSeconds: 60 };
  let state = createCountdownState(config);
  state = dispatch(state, { kind: "chord", chord: "fn", pressed: true }, config);
  state = dispatch(state, { kind: "encoder", encoderId: 1, delta: 5 }, config);
  state = dispatch(state, { kind: "chord", chord: "fn", pressed: false }, config);
  state = dispatch(state, { kind: "tick.1s" }, config);

  const frame = renderCountdownRgb565(state, config);
  const bytes = countdownFrameBytes(frame);
  assert.equal(frame.length, 31_000);
  assert.equal(bytes.length, 62_000);
  assert.equal(createHash("sha256").update(bytes).digest("hex"),
    "dcafcfd500c6911f90b8c8a197300ccecf78818fa3558f74facc31307d407993");
  assert.ok(new Set(frame).size > 24, "radial dial should contain a real RGB565 color ramp");
  assert.equal(frame[0], 0x0021, "screen edge remains near-black");
  assert.notEqual(frame[270 * 100 + 50], frame[0], "dial center must be blue-lit");
});

test("countdown primitives are available from the public renderer-v2 SDK export", async () => {
  const sdk = await import("framer-f1-research-widget-sdk/renderer-v2");
  assert.equal(typeof sdk.createCountdownState, "function");
  assert.equal(typeof sdk.reduceCountdown, "function");
  assert.equal(typeof sdk.renderCountdownRgb565, "function");
  assert.equal(sdk.COUNTDOWN_HOST_EVENTS.chordLevel, 0xb210);
});
