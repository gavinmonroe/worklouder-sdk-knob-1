import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  WPM_PET_SPECIES,
  WPM_PET_STATES,
  cellBounds,
} from "../tools/extract-wpm-species-frames.mjs";

// ImageMagick is an external host tool, not a repository input. Skipping with a reason
// keeps a fresh clone honest: an absent `magick` is a missing prerequisite, not a defect.
const missingImageMagick = (() => {
  try {
    execFileSync("magick", ["-version"], { stdio: "ignore" });
    return false;
  } catch {
    return "ImageMagick `magick` is not on PATH. See docs/20-local-development-setup.md.";
  }
})();

const root = new URL("../../", import.meta.url);
const normalizedRoot = new URL("../assets/wpm-pet-species-frames-v1/", import.meta.url);
const deviceRoot = new URL("../assets/device-lvgl-v3-species/", import.meta.url);
const sha256 = (data) => createHash("sha256").update(data).digest("hex");

test("six-species extractor pins exact roster, states, and nonoverlapping 4x2 cells", async () => {
  const bytes = await readFile(new URL("manifest.json", normalizedRoot));
  const manifest = JSON.parse(bytes);
  assert.equal(sha256(bytes), "b9f3c6d27144c5ce3c46817e2c137e9402f38bdba5c5c706b973fa47afc0dd69");
  assert.deepEqual(manifest.rosterOrder, WPM_PET_SPECIES.map(({ label }) => label));
  assert.deepEqual(manifest.stateOrder, WPM_PET_STATES);

  for (const species of manifest.species) {
    const cells = species.frames.map(({ crop }) => crop);
    assert.deepEqual(cells, WPM_PET_STATES.map((_, index) =>
      cellBounds(species.width, species.height, index)));
    for (const row of [0, 1]) {
      const rowCells = cells.slice(row * 4, row * 4 + 4);
      assert.equal(rowCells[0].x, 0);
      assert.equal(rowCells.at(-1).x + rowCells.at(-1).width, species.width);
      for (let column = 1; column < rowCells.length; column += 1) {
        assert.equal(rowCells[column - 1].x + rowCells[column - 1].width, rowCells[column].x);
      }
    }
    assert.equal(cells[0].y, 0);
    assert.equal(cells[4].y, cells[0].height);
    assert.equal(cells[4].y + cells[4].height, species.height);
  }
});

test("all 48 normalized frames are exact 68x56 RGBA with real transparency",
  { skip: missingImageMagick }, async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.json", normalizedRoot)));
  for (const species of manifest.species) {
    for (const frame of species.frames) {
      const file = new URL(frame.file, root);
      const bytes = await readFile(file);
      assert.equal(sha256(bytes), frame.pngSha256);
      const identified = execFileSync("magick", ["identify", "-format",
        "%w|%h|%[channels]|%[opaque]", file.pathname], { encoding: "utf8" });
      assert.match(identified, /^68\|56\|[^|]*a[^|]*\|False$/u);
    }
  }
});

test("device converter pins two skies then six times eight pet descriptors", async () => {
  const bytes = await readFile(new URL("manifest.json", deviceRoot));
  const manifest = JSON.parse(bytes);
  assert.equal(sha256(bytes), "5688fcebf05cace46cea79b5bc8684cc352426f9b23777e5e75a3c905f923524");
  assert.equal(manifest.frames.length, 50);
  assert.deepEqual(manifest.frames.slice(0, 2).map(({ name }) => name), ["sky-0", "sky-1"]);
  assert.deepEqual(manifest.frames.slice(2).map(({ name }) => name),
    Array.from({ length: 6 }, (_, species) =>
      Array.from({ length: 8 }, (_, state) => `pet-${species}-${state}`)).flat());
});
