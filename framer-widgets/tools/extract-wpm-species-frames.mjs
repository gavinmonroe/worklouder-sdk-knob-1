#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(here, "../..");
const outputRoot = path.join(workspace, "framer-widgets/assets/wpm-pet-species-frames-v1");

export const WPM_PET_STATES = Object.freeze([
  "ready", "curious", "happy", "zooming", "fire", "tired", "waiting", "sleeping",
]);

export const WPM_PET_SPECIES = Object.freeze([
  Object.freeze({
    id: 0,
    slug: "belgian-tervuren",
    label: "Belgian Tervuren",
    source: "framer-widgets/assets/wpm-belgian-tervuren-sprite-concept-v1.png",
    sourceSha256: "7bae61f604f9c3d9f7e89ebda02c34e7f55e2d13f5d9323dadab3ae0692aa5a3",
    width: 1774,
    height: 887,
  }),
  Object.freeze({
    id: 1,
    slug: "pepe",
    label: "Pepe",
    source: "framer-widgets/assets/wpm-pepe-sprite-concept-v2-transparent.png",
    sourceSha256: "a4bbfffa888206e1c13c6d9fb30300f3422f2fe1db2adb1f8973ae063bb38821",
    width: 1844,
    height: 853,
  }),
  Object.freeze({
    id: 2,
    slug: "angry-owl",
    label: "Angry owl",
    source: "framer-widgets/assets/wpm-angry-owl-sprite-concept-v1.png",
    sourceSha256: "82e273428a4f3ecbef36af51f097202a9941702ae6e79f56febb40404bd55097",
    width: 1672,
    height: 941,
  }),
  Object.freeze({
    id: 3,
    slug: "cute-ferret",
    label: "Cute ferret",
    source: "framer-widgets/assets/wpm-cute-ferret-sprite-concept-v1.png",
    sourceSha256: "68fafb76f08d2fc6c5c665d8b89314907ee8142d26b59f906ebbaf410e83c5d9",
    width: 1672,
    height: 941,
  }),
  Object.freeze({
    id: 4,
    slug: "cat",
    label: "Cat",
    source: "framer-widgets/assets/wpm-cat-sprite-concept-v3-blue-transparent.png",
    sourceSha256: "b5d0019b50c213170f3141971fb8e146eda9f5d68a221d5d1967bfcd0c4581a4",
    width: 1774,
    height: 887,
  }),
  Object.freeze({
    id: 5,
    slug: "lazy-cow",
    label: "Lazy cow",
    source: "framer-widgets/assets/wpm-lazy-cow-sprite-concept-v1.png",
    sourceSha256: "7f82fd18e54c17c0d745fe751f92708bf64525db10a4cab236ce93c3f34b5c17",
    width: 1672,
    height: 941,
  }),
]);

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function cellBounds(width, height, stateIndex) {
  if (!Number.isInteger(stateIndex) || stateIndex < 0 || stateIndex >= 8) {
    throw new Error("State index must be an integer from 0 through 7.");
  }
  const column = stateIndex % 4;
  const row = Math.floor(stateIndex / 4);
  const x = Math.floor((column * width) / 4);
  const right = Math.floor(((column + 1) * width) / 4);
  const y = Math.floor((row * height) / 2);
  const bottom = Math.floor(((row + 1) * height) / 2);
  return Object.freeze({ x, y, width: right - x, height: bottom - y });
}

function identify(file, format) {
  return execFileSync("magick", ["identify", "-format", format, file], { encoding: "utf8" });
}

async function extractSpecies(species) {
  const source = path.join(workspace, species.source);
  const sourceBytes = await readFile(source);
  if (sha256(sourceBytes) !== species.sourceSha256) {
    throw new Error(`${species.label} source hash changed.`);
  }
  const dimensions = identify(source, "%w|%h|%[channels]|%[opaque]").trim().split("|");
  if (Number(dimensions[0]) !== species.width || Number(dimensions[1]) !== species.height ||
      !dimensions[2].includes("a") || dimensions[3] !== "False") {
    throw new Error(`${species.label} source dimensions or alpha channel changed.`);
  }

  const directory = path.join(outputRoot, species.slug);
  await mkdir(directory, { recursive: true });
  const frames = [];
  for (let index = 0; index < WPM_PET_STATES.length; index += 1) {
    const bounds = cellBounds(species.width, species.height, index);
    const output = path.join(directory, `frame-${String(index).padStart(2, "0")}.png`);
    execFileSync("magick", [
      source,
      "-crop", `${bounds.width}x${bounds.height}+${bounds.x}+${bounds.y}`,
      "+repage",
      "-trim",
      "+repage",
      "-filter", "Lanczos",
      "-resize", "68x56",
      "-background", "none",
      "-gravity", "center",
      "-extent", "68x56",
      "-strip",
      `PNG32:${output}`,
    ]);
    const bytes = await readFile(output);
    const result = identify(output, "%w|%h|%[channels]|%[opaque]|%@").trim().split("|");
    if (result[0] !== "68" || result[1] !== "56" || !result[2].includes("a") ||
        result[3] !== "False") {
      throw new Error(`${species.label} ${WPM_PET_STATES[index]} lost its 68x56 alpha canvas.`);
    }
    frames.push(Object.freeze({
      stateId: index,
      state: WPM_PET_STATES[index],
      crop: bounds,
      file: path.relative(workspace, output),
      pngSha256: sha256(bytes),
      alphaBounds: result[4],
      bytes: bytes.length,
    }));
  }
  return Object.freeze({ ...species, frames });
}

export async function extractWpmSpeciesFrames() {
  await mkdir(outputRoot, { recursive: true });
  const species = [];
  for (const record of WPM_PET_SPECIES) species.push(await extractSpecies(record));

  const rowPaths = [];
  for (const record of species) {
    const row = path.join(outputRoot, `.preview-row-${record.slug}.png`);
    execFileSync("magick", [
      ...record.frames.map((frame) => path.join(workspace, frame.file)),
      "+append",
      row,
    ]);
    rowPaths.push(row);
  }
  const preview = path.join(outputRoot, "preview-6-species-x-8-states.png");
  execFileSync("magick", [
    ...rowPaths,
    "-append",
    "-background", "#10151f",
    "-alpha", "remove",
    "-alpha", "off",
    preview,
  ]);
  const previewBytes = await readFile(preview);
  const version = execFileSync("magick", ["-version"], { encoding: "utf8" }).split("\n", 1)[0];
  const manifest = {
    format: "framer-f1-wpm-pet-species-frames-v1",
    extractor: `${version}; exact 4x2 floor-divided cells; alpha trim; Lanczos contain; 68x56 RGBA extent`,
    rosterOrder: species.map(({ label }) => label),
    stateOrder: WPM_PET_STATES,
    output: { width: 68, height: 56, format: "PNG32 RGBA" },
    species,
    preview: {
      file: path.relative(workspace, preview),
      sha256: sha256(previewBytes),
      rows: "species order",
      columns: "state order",
    },
  };
  await writeFile(path.join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  extractWpmSpeciesFrames()
    .then((manifest) => console.log(JSON.stringify(manifest, null, 2)))
    .catch((error) => {
      console.error(`Error: ${error.message}`);
      process.exitCode = 1;
    });
}
