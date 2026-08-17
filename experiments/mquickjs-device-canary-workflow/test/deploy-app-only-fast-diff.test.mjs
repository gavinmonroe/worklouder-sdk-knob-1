import assert from "node:assert/strict";
import test from "node:test";

import { computeFastDiffRanges } from "../deploy-app-only.mjs";

const LENGTH = 200_000;
const FIXED_WINDOW_BYTES = 4096;

// Mirrors computeFastDiffRanges's own window placement so the test asserts
// against independently-derived expectations rather than the implementation's
// internal math.
function expectedFixedWindow(start) {
  const clampedStart = Math.min(Math.max(start, 0), Math.max(LENGTH - FIXED_WINDOW_BYTES, 0));
  return { offset: clampedStart, end: Math.min(clampedStart + FIXED_WINDOW_BYTES, LENGTH) };
}

const EXPECTED_WINDOWS = [
  expectedFixedWindow(0),
  expectedFixedWindow(Math.floor(LENGTH * 0.25)),
  expectedFixedWindow(Math.floor(LENGTH * 0.5)),
  expectedFixedWindow(Math.floor(LENGTH * 0.75)),
  expectedFixedWindow(LENGTH - FIXED_WINDOW_BYTES),
];

function baseApp() {
  return Buffer.alloc(LENGTH, 0xaa);
}

function assertRangesWellFormed(ranges) {
  assert.ok(Array.isArray(ranges) && ranges.length > 0, "ranges must be a nonempty array");
  let previousEnd = -1;
  for (const range of ranges) {
    assert.equal(range.end, range.offset + range.bytes, "range.end must equal offset + bytes");
    assert.ok(range.offset >= 0, "range.offset must be within [0, length)");
    assert.ok(range.end <= LENGTH, "range.end must be within [0, length]");
    assert.ok(range.bytes > 0, "range must be nonempty");
    assert.ok(range.offset >= previousEnd, `ranges must be sorted and non-overlapping (got offset ${range.offset} after previous end ${previousEnd})`);
    previousEnd = range.end;
  }
}

test("identical apps produce only the fixed sample windows", () => {
  const before = baseApp();
  const after = Buffer.from(before);
  const ranges = computeFastDiffRanges(before, after);
  assertRangesWellFormed(ranges);
  assert.equal(ranges.length, EXPECTED_WINDOWS.length);
  for (const [index, window] of EXPECTED_WINDOWS.entries()) {
    assert.equal(ranges[index].offset, window.offset, `window ${index} offset`);
    assert.equal(ranges[index].end, window.end, `window ${index} end`);
  }
});

test("scattered diffs plus fixed windows merge into a sorted, non-overlapping range list", () => {
  const before = baseApp();
  const after = Buffer.from(before);

  // A 3-byte change away from any fixed window.
  const smallChangeOffset = 10_000;
  const smallChangeBytes = 3;
  after.fill(0xff, smallChangeOffset, smallChangeOffset + smallChangeBytes);

  // A 2704-byte change away from any fixed window.
  const largeChangeOffset = 70_000;
  const largeChangeBytes = 2_704;
  after.fill(0xff, largeChangeOffset, largeChangeOffset + largeChangeBytes);

  // A 33-byte footer change that falls inside the last-4096 fixed window, to
  // exercise the overlap-merge path (footer/checksum/sha region).
  const footerChangeOffset = LENGTH - 50;
  const footerChangeBytes = 33;
  after.fill(0xff, footerChangeOffset, footerChangeOffset + footerChangeBytes);
  assert.ok(footerChangeOffset >= EXPECTED_WINDOWS.at(-1).offset, "footer change must land inside the last window");

  const ranges = computeFastDiffRanges(before, after);
  assertRangesWellFormed(ranges);

  // The two isolated changes must appear as their own exact ranges.
  const small = ranges.find((range) => range.offset === smallChangeOffset);
  assert.ok(small, "expected a range for the isolated 3-byte change");
  assert.equal(small.bytes, smallChangeBytes);

  const large = ranges.find((range) => range.offset === largeChangeOffset);
  assert.ok(large, "expected a range for the isolated 2704-byte change");
  assert.equal(large.bytes, largeChangeBytes);

  // The footer change must not produce a separate range: it is subsumed by
  // (merged into) the last fixed window, unchanged.
  const lastWindow = EXPECTED_WINDOWS.at(-1);
  const footerRange = ranges.find((range) => range.offset === lastWindow.offset);
  assert.ok(footerRange, "expected the last fixed window to still be present");
  assert.equal(footerRange.end, lastWindow.end, "footer change must not extend the last window");
  assert.ok(!ranges.some((range) => range.offset === footerChangeOffset),
    "footer change must not appear as a separate range from the last window");

  // All five fixed windows must still be present (merged where they overlap
  // a diff run).
  for (const window of EXPECTED_WINDOWS) {
    assert.ok(ranges.some((range) => range.offset <= window.offset && range.end >= window.end),
      `expected a range covering fixed window [${window.offset}, ${window.end})`);
  }

  // 5 fixed windows + 2 isolated diff ranges; the footer diff merges into the
  // last window instead of adding a range.
  assert.equal(ranges.length, EXPECTED_WINDOWS.length + 2);
});

test("mismatched lengths are rejected", () => {
  const before = Buffer.alloc(100, 0);
  const after = Buffer.alloc(101, 0);
  assert.throws(() => computeFastDiffRanges(before, after), /same length/iu);
});

test("importing the module does not run the CLI", async () => {
  // If deploy-app-only.mjs ran parse()/main() at import time (no isMain
  // guard), importing it here with no CLI argv would throw or attempt
  // filesystem/process access. A bare successful import proves the guard
  // works; re-importing (cached) must also stay side-effect free.
  const module = await import("../deploy-app-only.mjs");
  assert.equal(typeof module.computeFastDiffRanges, "function");
});
