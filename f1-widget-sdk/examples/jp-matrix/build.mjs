import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  compileCssWidget,
  encodeWidgetBundle,
  rasterizeGlyphAtlasWithMagick,
  renderCssSceneRgb565,
} from "../../src/render/index.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const [html, css] = await Promise.all([
  readFile(path.join(root, "widget.html"), "utf8"),
  readFile(path.join(root, "matrix.css"), "utf8"),
]);
const presets = [
  { name: "matrix-blue", css },
  { name: "matrix-violet", css: css.replaceAll("0, 150, 255", "150, 90, 255")
    .replaceAll("100, 200, 255", "210, 150, 255") },
  { name: "matrix-emerald", css: css.replaceAll("0, 150, 255", "0, 210, 145")
    .replaceAll("100, 200, 255", "90, 255, 190").replaceAll("255, 105, 180", "255, 190, 80") },
].map(({ name, css: presetCss }) => ({ name, ...compileCssWidget({ html, css: presetCss }) }));
const [{ scene, binary }] = presets;
const atlas = await rasterizeGlyphAtlasWithMagick(scene.glyphs);
const bundle = encodeWidgetBundle({ activeSlot: 0, generation: 1,
  slots: presets.map((preset) => ({ name: preset.name, kind: "semantic", sceneBinary: preset.binary, atlas })) });
const frame = renderCssSceneRgb565(scene, atlas, 0);
const frameBytes = Buffer.alloc(frame.length * 2);
frame.forEach((color, index) => frameBytes.writeUInt16LE(color, index * 2));
const output = path.join(root, "build");
await mkdir(output, { recursive: true });
await Promise.all([
  writeFile(path.join(output, "jp-matrix.scene.bin"), binary),
  writeFile(path.join(output, "jp-matrix.scene.json"), `${JSON.stringify(scene, null, 2)}\n`),
  writeFile(path.join(output, "jp-matrix.atlas.bin"), atlas.binary),
  writeFile(path.join(output, "jp-matrix.tick-000.rgb565"), frameBytes),
  writeFile(path.join(output, "jp-matrix-three-slots.f1wb"), bundle.binary),
  writeFile(path.join(output, "jp-matrix-three-slots.json"), `${JSON.stringify({
    format: bundle.format, sha256: bundle.sha256, generation: bundle.generation, activeSlot: bundle.activeSlot,
    slots: presets.map((preset, index) => ({ index, name: preset.name, kind: "semantic",
      sceneSha256: preset.scene.sha256, sceneBytes: preset.binary.length, atlasSha256: atlas.sha256,
      atlasBytes: atlas.binary.length })),
  }, null, 2)}\n`),
]);
process.stdout.write(`${JSON.stringify({ status: "OFFLINE_RENDER_PLAN", sha256: scene.sha256,
  sceneBytes: binary.length, atlasSha256: atlas.sha256, atlasBytes: atlas.binary.length,
  bundleSha256: bundle.sha256, bundleBytes: bundle.binary.length, savedSlots: presets.length,
  budget: scene.budget }, null, 2)}\n`);
