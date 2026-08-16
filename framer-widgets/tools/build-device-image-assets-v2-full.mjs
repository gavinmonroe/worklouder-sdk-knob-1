#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseSerializedLvglI8 } from "../../custom-firmware/lib/framer-lvgl-sprite.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(here, "../..");
const require = createRequire(import.meta.url);
const { convertImageToLvgl } = require(
  path.join(workspace, "extracted/input-app/node_modules/@worklouder/wl-device-kit"),
);

const outputDirectory = path.join(workspace, "framer-widgets/assets/device-lvgl-v2-full");
const inputs = [
  ...[0, 1].map((index) => ({
    kind: "sky",
    name: `sky-${index}`,
    expectedWidth: 100,
    expectedHeight: 310,
    source: path.join(workspace, `framer-widgets/assets/night-sky-frames-v2-full/frame-0${index}.png`),
  })),
  ...Array.from({ length: 8 }, (_, index) => ({
    kind: "cat",
    name: `cat-${index}`,
    expectedWidth: 68,
    expectedHeight: 56,
    source: path.join(
      workspace,
      `framer-widgets/assets/wpm-cat-frames-v2-blue/frame-${String(index).padStart(2, "0")}.png`,
    ),
  })),
];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

await mkdir(outputDirectory, { recursive: true });
const frames = [];
for (const input of inputs) {
  const png = await readFile(input.source);
  const serialized = Buffer.from(convertImageToLvgl(png));
  const info = parseSerializedLvglI8(serialized);
  if (info.width !== input.expectedWidth || info.height !== input.expectedHeight) {
    throw new Error(
      `${input.name} converted to ${info.width}x${info.height}; expected ` +
        `${input.expectedWidth}x${input.expectedHeight}.`,
    );
  }
  const output = path.join(outputDirectory, `${input.name}.lvgl.bin`);
  await writeFile(output, serialized, { flag: "w" });
  frames.push({
    name: input.name,
    kind: input.kind,
    source: path.relative(workspace, input.source),
    output: path.relative(workspace, output),
    pngSha256: sha256(png),
    lvglSha256: sha256(serialized),
    width: info.width,
    height: info.height,
    stride: info.stride,
    bytes: serialized.length,
    colorFormat: "LV_COLOR_FORMAT_I8",
  });
}

const manifest = {
  format: "framer-f1-wpm-pet-lvgl-assets-v2-full-canvas",
  converter: "@worklouder/wl-device-kit convertImageToLvgl 0.1.28",
  layout: {
    logicalCanvas: { width: 100, height: 310 },
    sky: { width: 100, height: 310, align: "center", x: 0, y: 0 },
    cat: { width: 68, height: 56, align: "center", x: 0, y: 0 },
    wpm: { align: "top-mid", x: 0, y: 3 },
    analytics: { align: "bottom-mid", x: 0, y: -3, lines: ["Avg ###", "Top: ###"] },
    drawOrder: ["sky", "cat", "wpm", "analytics"],
  },
  frames,
};
await writeFile(
  path.join(outputDirectory, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  { flag: "w" },
);

console.log(JSON.stringify(manifest, null, 2));
