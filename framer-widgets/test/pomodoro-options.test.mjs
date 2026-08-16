import assert from "node:assert/strict";
import test from "node:test";

import { formatClock, parsePomodoroArgs } from "../lib/pomodoro-options.mjs";

test("formats countdown values", () => {
  assert.equal(formatClock(1500), "25:00");
  assert.equal(formatClock(9.2), "00:10");
  assert.equal(formatClock(-1), "00:00");
});

test("parses standard Pomodoro options", () => {
  assert.deepEqual(parsePomodoroArgs(["start", "--work-minutes", "30", "--cycles", "2"]), {
    command: "start",
    options: { workSeconds: 1800, breakSeconds: 300, cycles: 2, port: 9230 },
  });
});

test("demo is short and rejects unsafe values", () => {
  assert.equal(parsePomodoroArgs(["demo"]).options.workSeconds, 8);
  assert.throws(() => parsePomodoroArgs(["start", "--cycles", "0"]));
  assert.throws(() => parsePomodoroArgs(["start", "--work-minutes", "999"]));
});

