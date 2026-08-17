#!/usr/bin/env node
/* Offline-only build of the restyled ID28 weather asset set.
 *
 * Emits, into build/ (which is also the FRAMER_DIAG_ASSETS_DIR the diagnostic
 * module build consumes):
 *   weather-id28-gen19.js        exact pinned physical source (copied)
 *   weather-id28-gen19.f2js      rebuilt from that source; must equal the pin
 *   weather-id28-gen19.f2tf      NEW facade (new palette/glyphs/tables/targets)
 *   weather-id28-base.rgb565le   NEW 62,000 B static raster
 *   weather-id28-base.lzss       LZSS of that raster (round-trip checked)
 *   contact-sheet.png            host-oracle render with sample weather
 *   manifest.json
 *
 * Never opens a serial port, never touches the keyboard.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { encodeRgbaPng } from "../../f1-widget-sdk/src/png.mjs";
import { buildRenderV2MQuickJsPackage, decodeRenderV2MQuickJsPackage } from
  "../../f1-widget-sdk/src/render-v2/mquickjs.mjs";
import { packWeatherCurrent, packWeatherDay } from
  "../../f1-widget-sdk/src/render-v2/weather.mjs";
import { requiredWeatherCanaryHostRpcIds, WEATHER_MQUICKJS_TARGETS } from
  "../../f1-widget-sdk/examples/render-v2-mquickjs-weather-canary/protocol.mjs";
import { createWeatherCanarySimulator } from
  "../../f1-widget-sdk/examples/render-v2-mquickjs-weather-canary/simulator.mjs";
import { decodeTargetFacadeAsset, renderTargetFacadeHost, TARGET_FACADE_CONTRACT_SHA256,
  TARGET_FACADE_RESULT } from "../mquickjs-target-facade/contract.mjs";

import { buildWeather2FacadeAsset, FRAME_BYTES, frameToLe, HEIGHT, PIXELS,
  renderWeather2Base, WEATHER2_TARGETS, WIDTH } from "./design.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(here, "../..");
const release = path.join(repository,
  "experiments/mquickjs-esp32s3-physical-canary/releases/2026-08-17-id28-abi3-674054a6");
const output = path.resolve(process.env.FRAMER_WEATHER2_OUTPUT ?? path.join(here, "build"));
const GENERATION = 19;

const pins = Object.freeze({
  sourceSha256: "a9b1a833a75f8a296ae5e2575f31ec1030af0c8a944031858e0506456f8864ab",
  f2jsSha256: "7aeeecde59bd686b3455feadc74b4b7705ca0c8ea933f9b0669cb8dc656c284e",
  contractSha256: "8220152a09348da34cdd70dd7d370197f2f3fc46a9f45e50d7fb7015bdb8579a",
});

const invariant = (ok, message) => { if (!ok) throw new Error(message); };
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

/* --------------------------------------------------------------- LZSS ---- */
/* Byte-identical to experiments/mquickjs-esp32s3-physical-canary/verify.mjs. */
function encodeLzss(bytes) {
  const outputBytes = [];
  let cursor = 0;
  while (cursor < bytes.length) {
    const flagsAt = outputBytes.length;
    outputBytes.push(0);
    let flags = 0;
    for (let bit = 0; bit < 8 && cursor < bytes.length; bit++) {
      let bestLength = 0;
      let bestDistance = 0;
      const first = Math.max(0, cursor - 1024);
      for (let candidate = cursor - 1; candidate >= first; candidate--) {
        if (bytes[candidate] !== bytes[cursor]) continue;
        let length = 1;
        while (length < 66 && cursor + length < bytes.length &&
          bytes[candidate + length] === bytes[cursor + length]) length++;
        if (length >= 3 && length > bestLength) {
          bestLength = length; bestDistance = cursor - candidate;
          if (length === 66) break;
        }
      }
      if (bestLength >= 3) {
        flags |= 1 << bit;
        const code = ((bestLength - 3) << 10) | (bestDistance - 1);
        outputBytes.push(code & 0xff, code >>> 8); cursor += bestLength;
      } else outputBytes.push(bytes[cursor++]);
    }
    outputBytes[flagsAt] = flags;
  }
  return Buffer.from(outputBytes);
}

export function decodeLzss(bytes, outputBytes) {
  const decoded = Buffer.alloc(outputBytes);
  let source = 0; let destination = 0;
  while (destination < decoded.length) {
    invariant(source < bytes.length, "LZSS flags overrun.");
    const flags = bytes[source++];
    for (let bit = 1; bit <= 0x80 && destination < decoded.length; bit <<= 1) {
      if ((flags & bit) === 0) decoded[destination++] = bytes[source++];
      else {
        const code = bytes.readUInt16LE(source); source += 2;
        const distance = (code & 1023) + 1; const length = (code >>> 10) + 3;
        invariant(distance <= destination && length <= decoded.length - destination,
          "LZSS match escaped output.");
        for (let index = 0; index < length; index++) {
          decoded[destination] = decoded[destination - distance]; destination++;
        }
      }
    }
  }
  invariant(source === bytes.length, "LZSS trailing bytes.");
  return decoded;
}

/* ----------------------------------------------------------------- PNG --- */
function frameToRgba(frame) {
  const rgba = Buffer.alloc(frame.length * 4);
  frame.forEach((color, index) => {
    const r = ((color >>> 11) & 0x1f); const g = ((color >>> 5) & 0x3f); const b = color & 0x1f;
    rgba[index * 4] = (r << 3) | (r >>> 2);
    rgba[index * 4 + 1] = (g << 2) | (g >>> 4);
    rgba[index * 4 + 2] = (b << 3) | (b >>> 2);
    rgba[index * 4 + 3] = 255;
  });
  return rgba;
}

function contactSheet(panels, { scale = 2, gap = 10, label = 12 } = {}) {
  const sheetWidth = panels.length * WIDTH * scale + (panels.length + 1) * gap;
  const sheetHeight = HEIGHT * scale + gap * 2 + label;
  const rgba = Buffer.alloc(sheetWidth * sheetHeight * 4);
  for (let index = 0; index < sheetWidth * sheetHeight; index++) {
    rgba[index * 4] = 24; rgba[index * 4 + 1] = 24; rgba[index * 4 + 2] = 28;
    rgba[index * 4 + 3] = 255;
  }
  panels.forEach((frame, panelIndex) => {
    const source = frameToRgba(frame);
    const x0 = gap + panelIndex * (WIDTH * scale + gap);
    for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
      const at = (y * WIDTH + x) * 4;
      for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
        const to = ((gap + y * scale + sy) * sheetWidth + x0 + x * scale + sx) * 4;
        rgba[to] = source[at]; rgba[to + 1] = source[at + 1];
        rgba[to + 2] = source[at + 2]; rgba[to + 3] = 255;
      }
    }
  });
  return encodeRgbaPng(sheetWidth, sheetHeight, rgba);
}

/* ---------------------------------------------------------------- build -- */
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

/* 1. Exact pinned physical source -> F2JS package (unchanged by this restyle). */
const source = await readFile(path.join(release, "weather-id28-gen19.js"), "utf8");
invariant(sha256(Buffer.from(source)) === pins.sourceSha256,
  "Pinned physical weather source changed; the restyle must not move it.");
const handlerCount = source.match(/\bwidget\.on\s*\(/gu)?.length ?? 0;
invariant(handlerCount === 16, `Physical source must register 16 handlers, got ${handlerCount}.`);
const packageValue = buildRenderV2MQuickJsPackage({
  source, generation: GENERATION,
  events: { "tick.1s": true, "tick.100ms": true, "input.fn-bottom-knob": true,
    hostRpcIds: requiredWeatherCanaryHostRpcIds(),
    keys: [{ id: 0, nativeToken: 0x2c }, { id: 1, nativeToken: 0xe1 }],
    chords: [{ id: 0, heldMask: 3 }] },
  input: { debounceMs: 10, holdDelayMs: 500, holdCadenceMs: 100 },
  targets: WEATHER_MQUICKJS_TARGETS,
});
const decodedPackage = decodeRenderV2MQuickJsPackage(packageValue.binary);
invariant(decodedPackage.generation === GENERATION &&
  (decodedPackage.rasterBase?.length ?? 0) === 0 && decodedPackage.events.length === 14 &&
  decodedPackage.input.keyCount === 2 && decodedPackage.input.chordCount === 1,
"Restyled package declarations drifted from the flashed package.");
invariant(packageValue.sha256 === pins.f2jsSha256,
  `Rebuilt F2JS ${packageValue.sha256} != flashed pin ${pins.f2jsSha256}.`);
invariant(decodedPackage.targets.map(({ id }) => id).join("\0") ===
  WEATHER2_TARGETS.map(({ id }) => id).join("\0"),
"Facade target IDs must stay identical to the F2JS declarations.");

/* 2. New raster base + new facade. */
const baseFrame = renderWeather2Base();
const baseBytes = frameToLe(baseFrame);
invariant(baseBytes.length === FRAME_BYTES, "Base raster is not 62,000 bytes.");
const facade = buildWeather2FacadeAsset({ generation: GENERATION, baseFrame,
  f2jsBinary: packageValue.binary });
invariant(facade.binary.length <= 4096,
  `F2TF is ${facade.binary.length} B; FRAMER_TF_MAX_ASSET_BYTES is 4096.`);
invariant(facade.contractSha256 === pins.contractSha256, "F2TF contract identity changed.");
const decodedFacade = decodeTargetFacadeAsset(facade.binary, { expectedGeneration: GENERATION,
  expectedF2jsSha256: packageValue.sha256, baseFrame });

const compressed = encodeLzss(baseBytes);
invariant(decodeLzss(compressed, FRAME_BYTES).equals(baseBytes),
  "New base LZSS did not round-trip to 62,000 bytes.");

/* 3. Drive the real widget source through the logic simulator with sample data,
 *    then render those exact 16 slots through the facade host oracle. */
function slotsFor({ current, days, ageSeconds = 0, retrySeconds = 0, providerError = false,
  hidden = false }) {
  const simulator = createWeatherCanarySimulator(source);
  const revision = 1;
  simulator.dispatch({ name: "host.rpc:0xB240", type: "host.rpc", id: 0xb240, value: revision });
  simulator.dispatch({ name: "host.rpc:0xB241", type: "host.rpc", id: 0xb241,
    value: packWeatherCurrent(current), auxiliary: revision });
  days.forEach((day, index) => simulator.dispatch({ name: `host.rpc:0x${(0xb242 + index).toString(16)}`,
    type: "host.rpc", id: 0xb242 + index, value: packWeatherDay(day), auxiliary: revision }));
  simulator.dispatch({ name: "host.rpc:0xB24F", type: "host.rpc", id: 0xb24f,
    value: revision, auxiliary: 0b1111 });
  for (let second = 0; second < ageSeconds; second++) {
    simulator.dispatch({ name: "tick.1s", type: "tick.1s", value: 0, auxiliary: 0 });
  }
  if (providerError || retrySeconds) {
    simulator.dispatch({ name: "host.rpc:0xB24D", type: "host.rpc", id: 0xb24d,
      value: providerError ? 1 : 0, auxiliary: retrySeconds });
  }
  if (hidden) {
    simulator.dispatch({ name: "host.rpc:0xB24E", type: "host.rpc", id: 0xb24e,
      value: 0, auxiliary: 0 });
  }
  return simulator.slots;
}

const sample = {
  current: { temperature: 72, condition: { id: 0, isDay: true } },
  days: [
    { weekdayId: 3, low: 60, high: 75, condition: 0 },   /* Wed */
    { weekdayId: 4, low: 58, high: 71, condition: 1 },   /* Thu */
    { weekdayId: 5, low: -4, high: 12, condition: 6 },   /* Fri */
  ],
};
const extremes = {
  current: { temperature: -8, condition: { id: 7, isDay: false } },
  days: [
    { weekdayId: 0, low: -120, high: -99, condition: 6 },
    { weekdayId: 1, low: 99, high: 104, condition: 4 },
    { weekdayId: 2, low: 0, high: 100, condition: 2 },
  ],
};

const scenarios = [
  { name: "boot-no-snapshot", slots: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { name: "sample-72-sunny", slots: slotsFor(sample) },
  { name: "sample-aged-90s", slots: slotsFor({ ...sample, ageSeconds: 90 }) },
  { name: "provider-error-retry", slots: slotsFor({ ...sample, providerError: true, retrySeconds: 30 }) },
  { name: "extremes-negative", slots: slotsFor(extremes) },
];

const state = { lastAppliedRevision: 0 };
const rendered = scenarios.map((scenario) => {
  const result = renderTargetFacadeHost({ decoded: decodedFacade, baseFrame,
    mailbox: { sequence: 2, slots: [...scenario.slots], admittedGeneration: GENERATION },
    state: { ...state }, expectedGeneration: GENERATION });
  invariant(result.result === TARGET_FACADE_RESULT.ok,
    `Scenario ${scenario.name} rendered result ${result.result}, expected ok(0).`);
  invariant(result.metrics.overlayWrites <= decodedFacade.header.maxOverlayWrites,
    `Scenario ${scenario.name} exceeded the overlay write budget.`);
  return { scenario, result };
});

const png = contactSheet([baseFrame, ...rendered.map(({ result }) => result.frame)]);

/* 4. Emit. */
const paths = {
  source: path.join(output, "weather-id28-gen19.js"),
  f2js: path.join(output, "weather-id28-gen19.f2js"),
  f2tf: path.join(output, "weather-id28-gen19.f2tf"),
  base: path.join(output, "weather-id28-base.rgb565le"),
  compressed: path.join(output, "weather-id28-base.lzss"),
  f2jsSha: path.join(output, "weather-id28-f2js.sha256.bin"),
  contractSha: path.join(output, "target-contract.sha256.bin"),
  png: path.join(output, "contact-sheet.png"),
  cases: path.join(output, "weather2-cases.bin"),
  hostFrames: path.join(output, "weather2-host-frames.bin"),
  manifest: path.join(output, "manifest.json"),
};
const casesBinary = Buffer.alloc(8 + scenarios.length * 72);
casesBinary.write("TFCS", 0, "ascii");
casesBinary.writeUInt32LE(scenarios.length, 4);
scenarios.forEach((scenario, index) => {
  const at = 8 + index * 72;
  casesBinary.writeUInt32LE(2 + index * 2, at);
  scenario.slots.forEach((value, slot) => casesBinary.writeInt32LE(value, at + 4 + slot * 4));
  casesBinary.writeUInt32LE(GENERATION, at + 68);
});
await Promise.all([
  writeFile(paths.cases, casesBinary),
  writeFile(paths.hostFrames, Buffer.concat(rendered.map(({ result }) => frameToLe(result.frame)))),
]);
await Promise.all([
  writeFile(paths.source, source),
  writeFile(paths.f2js, packageValue.binary),
  writeFile(paths.f2tf, facade.binary),
  writeFile(paths.base, baseBytes),
  writeFile(paths.compressed, compressed),
  writeFile(paths.f2jsSha, Buffer.from(packageValue.sha256, "hex")),
  writeFile(paths.contractSha, Buffer.from(TARGET_FACADE_CONTRACT_SHA256, "hex")),
  writeFile(paths.png, png),
]);

const manifest = {
  format: "framer-f1-weather2-id28-asset-set-v1",
  status: "OFFLINE_ONLY_NOT_FLASHED",
  hardwareTouched: false,
  generation: GENERATION,
  canvas: { width: WIDTH, height: HEIGHT, pixels: PIXELS, bytes: FRAME_BYTES,
    format: "rgb565-le" },
  package: { file: "weather-id28-gen19.f2js", bytes: packageValue.binary.length,
    sha256: packageValue.sha256, sourceSha256: sha256(Buffer.from(source)),
    unchangedFromFlashed: packageValue.sha256 === pins.f2jsSha256,
    handlers: handlerCount, events: decodedPackage.events.length,
    keys: decodedPackage.input.keyCount, chords: decodedPackage.input.chordCount },
  facade: { file: "weather-id28-gen19.f2tf", bytes: facade.binary.length,
    sha256: facade.sha256, baseSha256: facade.baseSha256, f2jsSha256: facade.f2jsSha256,
    contractSha256: facade.contractSha256, maxAssetBytes: 4096,
    paletteEntries: facade.paletteCount, glyphRecords: facade.glyphCount,
    maxOverlayWrites: decodedFacade.header.maxOverlayWrites,
    targets: WEATHER2_TARGETS.map(({ id, x, y, width, height, format, scale, align, tableName }) =>
      ({ id, x, y, width, height, format, scale, align, tableName })) },
  base: { file: "weather-id28-base.rgb565le", bytes: baseBytes.length,
    sha256: sha256(baseBytes) },
  compressed: { file: "weather-id28-base.lzss", bytes: compressed.length,
    sha256: sha256(compressed), decodesTo: FRAME_BYTES,
    ratio: Number((compressed.length / baseBytes.length).toFixed(4)) },
  contactSheet: { file: "contact-sheet.png", sha256: sha256(png),
    panels: ["static-base", ...scenarios.map(({ name }) => name)] },
  render: rendered.map(({ scenario, result }) => ({ name: scenario.name,
    result: result.result, overlayWrites: result.metrics.overlayWrites,
    formattedTargets: result.metrics.formattedTargets,
    frameSha256: sha256(frameToLe(result.frame)) })),
  constraints: {
    dynamicFont: "single 5x7 bitmap font, fixed 5 px width / 6 px advance, integer scale 1..3",
    dynamicGlyphs: `${facade.glyphCount}/64 records (space, '-', 0-9, A-Z, ` +
      "16 lowercase letters, degree)",
    degreeSign: "formatter 4 always appends U+00B0; a bare number is not expressible",
    staticText: "'Today', the cloud/sun mark, the card and the arrows are raster, not facade text",
  },
};
await writeFile(paths.manifest, `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
  status: "PASS_WEATHER2_ASSETS_BUILT_NO_HARDWARE",
  out: output, png: paths.png,
  f2js: manifest.package.sha256, f2jsUnchanged: manifest.package.unchangedFromFlashed,
  f2tf: manifest.facade.sha256, f2tfBytes: manifest.facade.bytes,
  base: manifest.base.sha256, lzssBytes: compressed.length,
  glyphs: facade.glyphCount, overlayWrites: manifest.render.map(({ overlayWrites }) => overlayWrites),
}, null, 2)}\n`);
