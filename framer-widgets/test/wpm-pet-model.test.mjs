import assert from "node:assert/strict";
import test from "node:test";

import {
  WpmPetModel,
  createDemoTimeline,
  toBubbleRequest,
} from "../lib/wpm-pet-model.mjs";

function feedSteadyWords(model, { startMs, endMs, wpm }) {
  const intervalMs = 60_000 / wpm;
  for (let atMs = startMs; atMs <= endMs; atMs += intervalMs) model.recordWord(atMs);
}

test("mirrors the firmware's 500 ms 0.1/0.9 WPM smoothing", () => {
  const model = new WpmPetModel();
  model.recordWord(100);
  assert.equal(model.snapshot(600).currentWpm, 12);
  assert.equal(model.snapshot(1_100).currentWpm, 11);
  assert.equal(model.snapshot(1_600).currentWpm, 10);
});

test("converges near a steady stream of 60 completed words per minute", () => {
  const model = new WpmPetModel();
  feedSteadyWords(model, { startMs: 100, endMs: 30_100, wpm: 60 });
  const snapshot = model.snapshot(30_600);
  assert.ok(snapshot.currentWpm >= 54 && snapshot.currentWpm <= 66, snapshot.currentWpm);
  assert.ok(snapshot.averageWpm >= 54 && snapshot.averageWpm <= 66, snapshot.averageWpm);
  assert.equal(snapshot.mature, true);
});

test("moves from warmup to waiting and sleeping based on all-key activity", () => {
  const model = new WpmPetModel();
  feedSteadyWords(model, { startMs: 100, endMs: 12_100, wpm: 60 });
  assert.notEqual(model.snapshot(12_600).state, "hatching");
  assert.equal(model.snapshot(17_100).state, "waiting");
  assert.equal(model.snapshot(42_100).state, "sleeping");
});

test("an ordinary key refreshes idle time without counting a word", () => {
  const model = new WpmPetModel();
  model.recordWord(100);
  model.recordKey(4_900);
  const snapshot = model.snapshot(5_100);
  assert.equal(snapshot.idleForMs, 200);
  assert.equal(snapshot.completedWords, 1);
  assert.equal(snapshot.state, "hatching");
});

test("starts a fresh session after a five-minute idle gap", () => {
  const model = new WpmPetModel();
  model.recordWord(100);
  const firstSession = model.snapshot(600).session;
  model.recordWord(300_100);
  const next = model.snapshot(300_600);
  assert.ok(next.session > firstSession);
  assert.equal(next.completedWords, 1);
  assert.equal(next.averageWpm, null);
});

test("formats a compact, ASCII-safe bubble request", () => {
  const model = new WpmPetModel();
  model.recordWord(100);
  const request = toBubbleRequest(model.snapshot(600));
  assert.equal(request.method, "v.framer.bubble");
  assert.deepEqual(Object.keys(request.params).sort(), ["d", "l", "s", "v"]);
  assert.match(request.params.l, /^PET /u);
  assert.ok(Buffer.byteLength(request.params.l) <= 32);
  assert.ok(Buffer.byteLength(request.params.v) <= 64);
  assert.equal(request.params.s, 1);
});

test("the demo is deterministic and exercises active plus idle pet states", () => {
  const first = createDemoTimeline();
  const second = createDemoTimeline();
  assert.deepEqual(first, second);
  const states = new Set(first.map((frame) => frame.state));
  for (const expected of ["ready", "hatching", "zooming", "waiting", "sleeping"]) {
    assert.ok(states.has(expected), `missing ${expected}`);
  }
  assert.ok(first.some((frame) => frame.averageWpm !== null));
});

test("rejects non-monotonic events and invalid timing configuration", () => {
  const model = new WpmPetModel();
  model.recordKey(10);
  assert.throws(() => model.recordKey(9), /monotonic/u);
  assert.throws(() => new WpmPetModel({ idleMs: 50, sleepMs: 40 }), /sleepMs/u);
});
