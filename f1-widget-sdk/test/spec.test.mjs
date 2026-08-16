import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { ROSTER_STATE_ORDER } from "../src/roster.mjs";
import { validateWidgetSpec } from "../src/spec.mjs";

const projectRoot = new URL("../examples/night-cat/", import.meta.url).pathname;
const raw = JSON.parse(await readFile(new URL("../examples/night-cat/widget.json", import.meta.url), "utf8"));

test("sample spec validates the exact 100x310 LVGL layout and six-by-eight roster", () => {
  const spec = validateWidgetSpec(structuredClone(raw), { projectRoot });
  assert.equal(spec.target.screenId, 7);
  assert.deepEqual(spec.target.logicalCanvas, { width: 100, height: 310 });
  assert.deepEqual(spec.target.physicalDisplay,
    { width: 310, height: 100, orientation: "marketed-landscape" });
  assert.deepEqual(spec.layout.pet, { align: "center", x: 0, y: 0 });
  assert.deepEqual(spec.layout.wpm, { align: "top-mid", x: 0, y: 3 });
  assert.deepEqual(spec.layout.analytics,
    { align: "bottom-mid", x: 0, y: -3, format: "Avg ###\nTop: ###" });
  assert.equal(spec.assets.backgrounds.length, 2);
  assert.equal(spec.assets.roster.length, 6);
  assert.equal(spec.assets.roster.flatMap(({ frames }) => frames).length, 48);
  assert.deepEqual(spec.stateMachine.states, ROSTER_STATE_ORDER);
  assert.equal(spec.assets.defaultSpecies, "cat");
  assert.equal(spec.assets.defaultSpeciesIndex, 4);
  assert.equal(spec.input.chord, "fn+bottom-encoder");
  assert.equal(spec.input.encoder.id, 1);
  assert.equal(spec.input.selectionStorage, "controller-ram-only");
  assert.equal(spec.input.globalKeyHook, false);
});

test("spec guard rejects target drift, escaped assets, and logical/physical canvas conflation", () => {
  const wrongTarget = structuredClone(raw);
  wrongTarget.target.firmware = "0.4.2";
  assert.throws(() => validateWidgetSpec(wrongTarget, { projectRoot }), /Only the pinned/u);

  const escape = structuredClone(raw);
  escape.assets.roster[0].frames[0].source = "../outside.png";
  assert.throws(() => validateWidgetSpec(escape, { projectRoot }), /escapes/u);

  const wrongLogicalCanvas = structuredClone(raw);
  wrongLogicalCanvas.target.logicalCanvas = { width: 310, height: 100 };
  assert.throws(() => validateWidgetSpec(wrongLogicalCanvas, { projectRoot }), /100x310/u);

  const wrongPhysicalDisplay = structuredClone(raw);
  wrongPhysicalDisplay.target.physicalDisplay = { width: 100, height: 310 };
  assert.throws(() => validateWidgetSpec(wrongPhysicalDisplay, { projectRoot }), /310x100/u);

  const croppedBackground = structuredClone(raw);
  croppedBackground.assets.backgrounds[0].height = 100;
  assert.throws(() => validateWidgetSpec(croppedBackground, { projectRoot }), /100x310/u);
});

test("spec guard rejects descriptor-order, layout, and controller-input drift", () => {
  const stateOrder = structuredClone(raw);
  [stateOrder.assets.roster[0].frames[0], stateOrder.assets.roster[0].frames[1]] =
    [stateOrder.assets.roster[0].frames[1], stateOrder.assets.roster[0].frames[0]];
  assert.throws(() => validateWidgetSpec(stateOrder, { projectRoot }), /must be state ready/u);

  const layout = structuredClone(raw);
  layout.layout.analytics.y = -2;
  assert.throws(() => validateWidgetSpec(layout, { projectRoot }), /layout differs/u);

  const input = structuredClone(raw);
  input.input.encoder.id = 0;
  assert.throws(() => validateWidgetSpec(input, { projectRoot }), /input metadata differs/u);

  const missingDefault = structuredClone(raw);
  missingDefault.assets.defaultSpecies = "dragon";
  assert.throws(() => validateWidgetSpec(missingDefault, { projectRoot }), /must name a roster/u);
});
