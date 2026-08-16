import { readFile } from "node:fs/promises";
import path from "node:path";

import { PINNED, SDK_FORMAT } from "./constants.mjs";
import { CONTROLLER_LOCAL_INPUT, ROSTER_STATE_ORDER } from "./roster.mjs";
import { assert, parseInteger, resolveInside } from "./util.mjs";

function validateAsset(asset, description, ids, projectRoot) {
  assert(asset && typeof asset === "object", `${description} must be an object.`);
  assert(typeof asset.id === "string" && /^[a-z][a-z0-9-]*$/u.test(asset.id),
    `${description}.id must be lowercase kebab-case.`);
  assert(!ids.has(asset.id), `Asset id ${asset.id} is duplicated.`);
  ids.add(asset.id);
  assert(["png", "lvgl-i8"].includes(asset.format), `${asset.id}.format must be png or lvgl-i8.`);
  resolveInside(projectRoot, asset.source, `${asset.id}.source`);
  const width = parseInteger(asset.width, `${asset.id}.width`);
  const height = parseInteger(asset.height, `${asset.id}.height`);
  assert(width > 0 && width <= PINNED.logicalCanvas.width, `${asset.id}.width must be 1..100.`);
  assert(height > 0 && height <= PINNED.logicalCanvas.height, `${asset.id}.height must be 1..310.`);
  return Object.freeze({ ...asset, width, height });
}

function exactJson(actual, expected, description) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${description} differs from the reviewed contract.`);
}

export function validateWidgetSpec(raw, { projectRoot }) {
  assert(raw && typeof raw === "object" && !Array.isArray(raw), "widget.json must contain an object.");
  assert(raw.format === SDK_FORMAT, `format must be ${SDK_FORMAT}.`);
  assert(typeof raw.name === "string" && /^[a-z][a-z0-9-]{1,47}$/u.test(raw.name),
    "name must be 2..48 lowercase kebab-case characters.");
  assert(raw.target?.device === PINNED.target && raw.target?.firmware === PINNED.firmware,
    "Only the pinned Framer F1 firmware 0.4.1 target is supported.");
  assert(parseInteger(raw.target?.screenId, "target.screenId") === PINNED.screen.id,
    "This research profile reserves screen ID 7.");
  exactJson(raw.target?.logicalCanvas, PINNED.logicalCanvas,
    "target.logicalCanvas (LVGL rotated coordinates must be 100x310)");
  exactJson(raw.target?.physicalDisplay, PINNED.physicalDisplay,
    "target.physicalDisplay (marketed orientation must be documented as 310x100)");
  assert(raw.profile === "wpm-roster-v2", "Only guarded profile wpm-roster-v2 is supported.");

  const ids = new Set();
  assert(Array.isArray(raw.assets?.backgrounds) && raw.assets.backgrounds.length === 2,
    "wpm-roster-v2 requires exactly two twinkle background frames.");
  const backgrounds = raw.assets.backgrounds.map((asset, index) =>
    validateAsset(asset, `assets.backgrounds[${index}]`, ids, projectRoot));
  for (const asset of backgrounds) {
    assert(asset.width === 100 && asset.height === 310,
      `Background ${asset.id} must fill the exact 100x310 logical LVGL canvas.`);
  }

  assert(Array.isArray(raw.assets?.roster) && raw.assets.roster.length >= 1 && raw.assets.roster.length <= 15,
    "assets.roster must contain 1..15 declarative species.");
  const speciesIds = new Set();
  let sharedFrameShape;
  const roster = raw.assets.roster.map((species, speciesIndex) => {
    assert(species && typeof species === "object", `assets.roster[${speciesIndex}] must be an object.`);
    assert(typeof species.id === "string" && /^[a-z][a-z0-9-]*$/u.test(species.id),
      `assets.roster[${speciesIndex}].id must be lowercase kebab-case.`);
    assert(!speciesIds.has(species.id), `Species id ${species.id} is duplicated.`);
    speciesIds.add(species.id);
    assert(typeof species.name === "string" && species.name.length >= 1 && species.name.length <= 48,
      `Species ${species.id} needs a 1..48 character display name.`);
    assert(Array.isArray(species.frames) && species.frames.length === ROSTER_STATE_ORDER.length,
      `Species ${species.id} requires exactly eight frames.`);
    const frames = species.frames.map((asset, stateIndex) => {
      assert(asset.state === ROSTER_STATE_ORDER[stateIndex],
        `Species ${species.id} frame ${stateIndex} must be state ${ROSTER_STATE_ORDER[stateIndex]}.`);
      const frame = validateAsset(asset, `species ${species.id} frame ${stateIndex}`, ids, projectRoot);
      const shape = `${frame.width}x${frame.height}`;
      sharedFrameShape ??= shape;
      assert(shape === sharedFrameShape, "Every species/state frame must use one normalized dimension.");
      return frame;
    });
    return Object.freeze({ ...species, index: speciesIndex, frames: Object.freeze(frames) });
  });
  assert(speciesIds.has(raw.assets.defaultSpecies), "assets.defaultSpecies must name a roster species id.");
  const defaultSpeciesIndex = roster.findIndex(({ id }) => id === raw.assets.defaultSpecies);

  assert(raw.stateMachine?.input === "native-wpm-float", "State input must be native-wpm-float.");
  exactJson(raw.stateMachine?.states, ROSTER_STATE_ORDER,
    "stateMachine.states (descriptor state order)");
  assert(raw.stateMachine?.behavior === "semantic-wpm-idle-v1",
    "stateMachine.behavior must be semantic-wpm-idle-v1.");

  exactJson(raw.layout, {
    background: { align: "center", x: 0, y: 0, width: 100, height: 310 },
    pet: { align: "center", x: 0, y: 0 },
    wpm: { align: "top-mid", x: 0, y: 3 },
    analytics: { align: "bottom-mid", x: 0, y: -3, format: "Avg ###\nTop: ###" },
  }, "layout");
  exactJson(raw.input, CONTROLLER_LOCAL_INPUT, "input metadata");

  const colors = raw.style?.wpmColors;
  assert(colors && ["idle", "low", "medium", "high"].every((key) =>
    typeof colors[key] === "string" && /^#[0-9a-f]{6}$/iu.test(colors[key])),
  "style.wpmColors must define #RRGGBB idle, low, medium, and high colors.");
  const timing = {
    uiTickMs: parseInteger(raw.timing?.uiTickMs, "timing.uiTickMs"),
    sampleEveryTicks: parseInteger(raw.timing?.sampleEveryTicks, "timing.sampleEveryTicks"),
    twinkleEveryTicks: parseInteger(raw.timing?.twinkleEveryTicks, "timing.twinkleEveryTicks"),
  };
  exactJson(timing, { uiTickMs: 100, sampleEveryTicks: 5, twinkleEveryTicks: 10 }, "timing");

  const assembly = resolveInside(projectRoot, raw.firmware?.assembly, "firmware.assembly");
  const linker = resolveInside(projectRoot, raw.firmware?.linker, "firmware.linker");
  assert(raw.firmware?.base === "live-tested-stage3c1", "Firmware base must be live-tested-stage3c1.");

  return Object.freeze({
    ...raw,
    projectRoot,
    assets: Object.freeze({
      backgrounds: Object.freeze(backgrounds),
      roster: Object.freeze(roster),
      defaultSpecies: raw.assets.defaultSpecies,
      defaultSpeciesIndex,
      frameShape: sharedFrameShape,
    }),
    stateMachine: Object.freeze({ ...raw.stateMachine, states: ROSTER_STATE_ORDER }),
    input: CONTROLLER_LOCAL_INPUT,
    timing: Object.freeze(timing),
    resolved: Object.freeze({ assembly, linker }),
  });
}

export async function loadWidgetSpec(projectDirectory) {
  const projectRoot = path.resolve(projectDirectory);
  const specPath = path.join(projectRoot, "widget.json");
  let raw;
  try {
    raw = JSON.parse(await readFile(specPath, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read ${specPath}: ${error.message}`);
  }
  return { specPath, spec: validateWidgetSpec(raw, { projectRoot }) };
}
