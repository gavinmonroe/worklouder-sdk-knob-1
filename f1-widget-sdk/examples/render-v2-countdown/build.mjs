import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

import { encodeRgbaPng } from "../../src/png.mjs";
import {
  COUNTDOWN_INPUT_CAPABILITIES,
  countdownFrameBytes,
  countdownViewModel,
  createCountdownState,
  reduceCountdown,
  renderCountdownRgb565,
} from "../../src/render-v2/index.mjs";

const width = 100;
const height = 310;
const scale = 2;
const columns = 3;
const rows = 2;
const gutter = 8;
const outputDirectory = new URL("build/", import.meta.url);
const config = Object.freeze({ chord: "fn", stepSeconds: 60, maxSeconds: 99 * 60 + 59 });

function apply(state, event) {
  return reduceCountdown(state, event, config).state;
}

function rgba(frame) {
  const output = Buffer.alloc(width * height * 4);
  frame.forEach((value, index) => {
    output[index * 4] = ((value >>> 11) & 0x1f) * 255 / 31;
    output[index * 4 + 1] = ((value >>> 5) & 0x3f) * 255 / 63;
    output[index * 4 + 2] = (value & 0x1f) * 255 / 31;
    output[index * 4 + 3] = 255;
  });
  return output;
}

let state = createCountdownState(config);
const snapshots = [{ name: "01-idle", state }];
state = apply(state, { kind: "chord", chord: "fn", pressed: true });
snapshots.push({ name: "02-hold-edit", state });
state = apply(state, { kind: "encoder", encoderId: 1, delta: 5 });
snapshots.push({ name: "03-turn-five", state });
state = apply(state, { kind: "chord", chord: "fn", pressed: false });
snapshots.push({ name: "04-release-running", state });
state = apply(state, { kind: "tick.1s" });
snapshots.push({ name: "05-tick-04-59", state });
for (let tick = 0; tick < 299; tick += 1) state = apply(state, { kind: "tick.1s" });
snapshots.push({ name: "06-finished", state });

await mkdir(outputDirectory, { recursive: true });
const rendered = [];
for (const snapshot of snapshots) {
  const frame = renderCountdownRgb565(snapshot.state, config);
  const frameBytes = countdownFrameBytes(frame);
  const image = rgba(frame);
  const filename = `${snapshot.name}.png`;
  await writeFile(new URL(filename, outputDirectory), encodeRgbaPng(width, height, image));
  rendered.push({ ...snapshot, frame, image, filename,
    sha256: createHash("sha256").update(frameBytes).digest("hex"),
    view: countdownViewModel(snapshot.state, config) });
}

const sheetWidth = columns * width * scale + (columns + 1) * gutter;
const sheetHeight = rows * height * scale + (rows + 1) * gutter;
const sheet = Buffer.alloc(sheetWidth * sheetHeight * 4);
for (let index = 0; index < sheetWidth * sheetHeight; index += 1) {
  sheet[index * 4] = 8; sheet[index * 4 + 1] = 11; sheet[index * 4 + 2] = 18; sheet[index * 4 + 3] = 255;
}
rendered.forEach(({ image }, index) => {
  const column = index % columns; const row = Math.floor(index / columns);
  const originX = gutter + column * (width * scale + gutter);
  const originY = gutter + row * (height * scale + gutter);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const source = (y * width + x) * 4;
    for (let sy = 0; sy < scale; sy += 1) for (let sx = 0; sx < scale; sx += 1) {
      const target = ((originY + y * scale + sy) * sheetWidth + originX + x * scale + sx) * 4;
      image.copy(sheet, target, source, source + 4);
    }
  }
});
await writeFile(new URL("countdown-contact-sheet.png", outputDirectory),
  encodeRgbaPng(sheetWidth, sheetHeight, sheet));

const manifest = {
  format: "framer-render-v2-countdown-proof-v1",
  viewport: { width, height, format: "RGB565 little-endian" },
  config,
  sequence: rendered.map(({ name, filename, sha256, state: snapshotState, view }) => ({
    name, filename, sha256, state: snapshotState, view,
  })),
  inputBoundary: {
    liveFallback: "Fn level + bottom encoder ID 1; release polling from UI tick still requires a physical canary.",
    arbitraryChord: "Modeled through exact host level event 0xB210; not accepted until RPC allowlist/native queue support lands.",
    ordering: "Chord and encoder events enter one bounded ordered queue; no LVGL work occurs off the UI tick.",
  },
  capabilities: COUNTDOWN_INPUT_CAPABILITIES,
};
await writeFile(new URL("manifest.json", outputDirectory), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ contactSheet: new URL("countdown-contact-sheet.png", outputDirectory).pathname,
  frames: rendered.map(({ name, sha256, view }) => ({ name, sha256, display: view.display, status: view.status })) }, null, 2));
