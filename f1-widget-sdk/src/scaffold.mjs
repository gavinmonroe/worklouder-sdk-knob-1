import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { PINNED, SDK_FORMAT, SDK_ROOT } from "./constants.mjs";
import { encodeRgbaPng } from "./png.mjs";
import { CONTROLLER_LOCAL_INPUT, ROSTER_STATE_ORDER } from "./roster.mjs";
import { stableJson } from "./util.mjs";

export const STARTER_ROSTER = Object.freeze([
  Object.freeze({ id: "belgian-tervuren", name: "Belgian Tervuren" }),
  Object.freeze({ id: "pepe", name: "Pepe" }),
  Object.freeze({ id: "angry-owl", name: "Angry owl" }),
  Object.freeze({ id: "cute-ferret", name: "Cute ferret" }),
  Object.freeze({ id: "cat", name: "Cat" }),
  Object.freeze({ id: "lazy-cow", name: "Lazy cow" }),
]);

function rgba(width, height, color = [0, 0, 0, 0]) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels[offset] = color[0];
    pixels[offset + 1] = color[1];
    pixels[offset + 2] = color[2];
    pixels[offset + 3] = color[3];
  }
  return pixels;
}

function setPixel(pixels, width, height, x, y, color) {
  if (x < 0 || x >= width || y < 0 || y >= height) return;
  const offset = (y * width + x) * 4;
  for (let index = 0; index < 4; index += 1) pixels[offset + index] = color[index];
}

function rectangle(pixels, width, height, left, top, right, bottom, color) {
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) setPixel(pixels, width, height, x, y, color);
  }
}

export function createStarterSkyFrame(frame) {
  const { width, height } = PINNED.logicalCanvas;
  const pixels = rgba(width, height, [5, 12, 29, 255]);
  const stars = Array.from({ length: 30 }, (_, index) => [
    6 + ((index * 29) % 89),
    8 + ((index * 73) % 293),
  ]);
  stars.forEach(([x, y], index) => {
    const bright = (index + frame) % 2 === 0;
    setPixel(pixels, width, height, x, y, bright ? [199, 224, 255, 255] : [77, 112, 164, 255]);
    if (bright) {
      setPixel(pixels, width, height, x - 1, y, [95, 142, 204, 255]);
      setPixel(pixels, width, height, x + 1, y, [95, 142, 204, 255]);
    }
  });
  return encodeRgbaPng(width, height, pixels);
}

export function createStarterPetFrame(speciesIndex, stateIndex) {
  if (!Number.isInteger(speciesIndex) || speciesIndex < 0 || speciesIndex >= STARTER_ROSTER.length ||
      !Number.isInteger(stateIndex) || stateIndex < 0 || stateIndex >= ROSTER_STATE_ORDER.length) {
    throw new Error("Starter pet species/state index is invalid.");
  }
  const width = 68;
  const height = 56;
  const pixels = rgba(width, height);
  const palettes = [
    [[40, 29, 25, 255], [154, 106, 70, 255]],
    [[21, 48, 25, 255], [91, 174, 91, 255]],
    [[42, 30, 20, 255], [187, 129, 53, 255]],
    [[39, 26, 32, 255], [196, 139, 160, 255]],
    [[4, 8, 18, 255], [59, 105, 151, 255]],
    [[38, 34, 38, 255], [210, 203, 194, 255]],
  ];
  const [dark, body] = palettes[speciesIndex];
  const light = [Math.min(255, body[0] + 55), Math.min(255, body[1] + 55),
    Math.min(255, body[2] + 55), 255];
  rectangle(pixels, width, height, 14, 13, 53, 45, body);
  rectangle(pixels, width, height, 18, 9, 27, 17, body);
  rectangle(pixels, width, height, 40, 9, 49, 17, body);
  rectangle(pixels, width, height, 20, 12, 47, 18, dark);
  if (speciesIndex === 2) {
    rectangle(pixels, width, height, 10, 18, 18, 36, body);
    rectangle(pixels, width, height, 49, 18, 57, 36, body);
  } else if (speciesIndex === 5) {
    rectangle(pixels, width, height, 8, 17, 18, 20, light);
    rectangle(pixels, width, height, 49, 17, 59, 20, light);
  } else if (speciesIndex === 3) {
    rectangle(pixels, width, height, 9, 37, 17, 41, body);
    rectangle(pixels, width, height, 51, 37, 59, 41, body);
  }

  const sleeping = stateIndex === 7;
  const waiting = stateIndex === 6;
  if (sleeping || waiting) {
    rectangle(pixels, width, height, 23, 27, 28, 27, dark);
    rectangle(pixels, width, height, 39, 27, 44, 27, dark);
  } else {
    rectangle(pixels, width, height, 24, 24, 28, 31, light);
    rectangle(pixels, width, height, 39, 24, 43, 31, light);
    const shift = (stateIndex % 3) - 1;
    setPixel(pixels, width, height, 26 + shift, 28, dark);
    setPixel(pixels, width, height, 41 + shift, 28, dark);
  }
  setPixel(pixels, width, height, 34, 34, dark);
  const mouthY = stateIndex === 5 ? 39 : 38;
  setPixel(pixels, width, height, 32, mouthY, dark);
  setPixel(pixels, width, height, 36, mouthY, dark);
  if (stateIndex === 4 || stateIndex === 3) {
    rectangle(pixels, width, height, 29, 44, 39, 46, light);
  }
  for (let index = 0; index < stateIndex; index += 1) {
    setPixel(pixels, width, height, 13 + index * 6, 51 - (index % 2), index < 4 ? body : light);
  }
  return encodeRgbaPng(width, height, pixels);
}

/* Compatibility helper for callers that only want the starter Cat row. */
export function createStarterCatFrame(stateIndex) {
  return createStarterPetFrame(4, stateIndex);
}

export async function initProject(destination) {
  const projectRoot = path.resolve(destination);
  try {
    await access(projectRoot);
    throw new Error(`Refusing to overwrite existing path ${projectRoot}.`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await Promise.all([
    mkdir(path.join(projectRoot, "src"), { recursive: true }),
    mkdir(path.join(projectRoot, "assets/backgrounds"), { recursive: true }),
    mkdir(path.join(projectRoot, "docs"), { recursive: true }),
    ...STARTER_ROSTER.map(({ id }) => mkdir(path.join(projectRoot, `assets/roster/${id}`), { recursive: true })),
  ]);
  const [assembly, linker] = await Promise.all([
    readFile(path.join(SDK_ROOT, "templates/widget.S.tmpl")),
    readFile(path.join(SDK_ROOT, "templates/widget.ld.tmpl")),
  ]);
  await Promise.all([
    writeFile(path.join(projectRoot, "src/widget.S.tmpl"), assembly, { flag: "wx" }),
    writeFile(path.join(projectRoot, "src/widget.ld.tmpl"), linker, { flag: "wx" }),
    ...[0, 1].map((frame) => writeFile(
      path.join(projectRoot, `assets/backgrounds/sky-${frame}.png`), createStarterSkyFrame(frame), { flag: "wx" })),
    ...STARTER_ROSTER.flatMap((species, speciesIndex) => ROSTER_STATE_ORDER.map((state, stateIndex) =>
      writeFile(path.join(projectRoot, `assets/roster/${species.id}/${state}.png`),
        createStarterPetFrame(speciesIndex, stateIndex), { flag: "wx" }))),
  ]);

  let projectName = path.basename(projectRoot).toLowerCase().replace(/[^a-z0-9-]/gu, "-").replace(/^-+/u, "");
  if (!/^[a-z]/u.test(projectName)) projectName = `widget-${projectName}`;
  if (projectName.length < 2) projectName = `${projectName || "widget"}-widget`;
  projectName = projectName.slice(0, 48).replace(/-+$/u, "");
  const spec = {
    format: SDK_FORMAT,
    name: projectName,
    profile: "wpm-roster-v2",
    target: {
      device: PINNED.target,
      firmware: PINNED.firmware,
      screenId: PINNED.screen.id,
      logicalCanvas: PINNED.logicalCanvas,
      physicalDisplay: PINNED.physicalDisplay,
    },
    assets: {
      backgrounds: [0, 1].map((index) => ({
        id: `sky-${index}`,
        format: "png",
        source: `assets/backgrounds/sky-${index}.png`,
        width: 100,
        height: 310,
      })),
      roster: STARTER_ROSTER.map((species) => ({
        ...species,
        frames: ROSTER_STATE_ORDER.map((state) => ({
          id: `${species.id}-${state}`,
          state,
          format: "png",
          source: `assets/roster/${species.id}/${state}.png`,
          width: 68,
          height: 56,
        })),
      })),
      defaultSpecies: "cat",
    },
    layout: {
      background: { align: "center", x: 0, y: 0, width: 100, height: 310 },
      pet: { align: "center", x: 0, y: 0 },
      wpm: { align: "top-mid", x: 0, y: 3 },
      analytics: { align: "bottom-mid", x: 0, y: -3, format: "Avg ###\nTop: ###" },
    },
    stateMachine: {
      input: "native-wpm-float",
      behavior: "semantic-wpm-idle-v1",
      states: ROSTER_STATE_ORDER,
    },
    input: CONTROLLER_LOCAL_INPUT,
    style: { wpmColors: { idle: "#8fb8ff", low: "#79a6ff", medium: "#63e6ff", high: "#ffee88" } },
    timing: { uiTickMs: 100, sampleEveryTicks: 5, twinkleEveryTicks: 10 },
    firmware: {
      base: "live-tested-stage3c1",
      assembly: "src/widget.S.tmpl",
      linker: "src/widget.ld.tmpl",
    },
  };
  const cli = path.join(SDK_ROOT, "bin/f1-widget.mjs");
  const readme = `# ${spec.name}\n\n` +
    `Generated by the unofficial Framer F1 research widget SDK. The logical LVGL canvas is 100x310; ` +
    `the separately documented physical/marketed orientation is 310x100.\n\n` +
    `\`\`\`sh\nnode ${cli} validate .\nnode ${cli} build .\n\`\`\`\n\n` +
    `Builds are offline regression artifacts only. The current 100x310/multi-page image path ` +
    `has a known unresolved live visual defect and this project contains no flashing command.\n`;
  const projectDocs = `# Widget development record\n\n` +
    `## Immutable descriptor order\n\n\`sky-0, sky-1, then species * 8 + state\`.\n\n` +
    `Roster: ${STARTER_ROSTER.map(({ name }) => name).join(", ")}.\n\n` +
    `States: ${ROSTER_STATE_ORDER.join(", ")}.\n\n` +
    `Input: on screen ID 7, Fn + bottom encoder; clockwise next, counterclockwise previous; ` +
    `selection wraps and remains in controller RAM only.\n\n` +
    `## Known live regression\n\nStage-3E.2 pets rendered as white squares and twinkle switching corrupted ` +
    `the lower screen. The sky-1 payload crosses virtual DROM page 0x3c1d0000 and pet payloads ` +
    `start beyond it; this is a correlation, not a proven cause.\n\n` +
    `## Findings\n\nRecord runtime observations here; do not silently turn observations into ABI facts.\n`;
  const decisions = `# Decisions\n\n| Date | Decision | Evidence | Revisit when |\n|---|---|---|---|\n| YYYY-MM-DD | Example | Build manifest or live observation | Condition |\n`;
  const testing = `# Test record\n\n## Offline\n\n- [ ] \`validate\` passes.\n` +
    `- [ ] The backgrounds are exactly 100x310.\n- [ ] Descriptor order is sky0, sky1, species*8+state.\n` +
    `- [ ] DROM growth equals ceil(bank/0x10000)*0x10000.\n- [ ] \`build\` is deterministic.\n` +
    `- [ ] Runtime image status is UNRESOLVED_LIVE_REGRESSION_DO_NOT_PROMOTE.\n` +
    `- [ ] liveVisualApproved remains false until a controlled fix is proven.\n` +
    `- [ ] Stock key callback, WPM tick, and Timer getter remain preserved.\n` +
    `- [ ] Manifest lists only one patched word plus DROM/IROM appends.\n\n` +
    `## Independent hardware handoff\n\nDo not promote the current image output while the known regression is open. ` +
    `This SDK does not authorize or perform deployment. ` +
    `Record recovery verification, independent ABI/image audit, exact output hash, readback hash, ` +
    `boot result, visual result, and rollback result in the workspace recovery workflow.\n`;
  await Promise.all([
    writeFile(path.join(projectRoot, "widget.json"), stableJson(spec), { flag: "wx" }),
    writeFile(path.join(projectRoot, "README.md"), readme, { flag: "wx" }),
    writeFile(path.join(projectRoot, "docs/README.md"), projectDocs, { flag: "wx" }),
    writeFile(path.join(projectRoot, "docs/DECISIONS.md"), decisions, { flag: "wx" }),
    writeFile(path.join(projectRoot, "docs/TESTING.md"), testing, { flag: "wx" }),
  ]);
  return projectRoot;
}
