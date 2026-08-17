#!/usr/bin/env node
/* Offline-only build of the ID28 weather + ZIP-settings asset set.
 *
 * Emits, into build/ (the directory FRAMER_DIAG_ASSETS_DIR is pointed at):
 *   weather-id28-gen19.js        the gen20 widget source under the pinned name
 *   weather-id28-gen19.f2js      built from that source
 *   weather-id28-gen19.f2tf      the facade, bound to that package digest
 *   weather-id28-base.rgb565le   the 62,000 B static raster
 *   weather-id28-base.lzss       LZSS of that raster (round-trip checked)
 *   weather-id28-f2js.sha256.bin, target-contract.sha256.bin
 *   contact-sheet.png, manifest.json, weather3-cases.bin, weather3-host-frames.bin
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
import { decodeTargetFacadeAsset, TARGET_FACADE_CONTRACT_SHA256,
  TARGET_FACADE_RESULT } from "../mquickjs-target-facade/contract.mjs";

import { buildWeather3FacadeAsset, FRAME_BYTES, frameToLe, HEIGHT, PIXELS,
  renderWeather3Base, WEATHER3_PACKAGE_TARGETS, WEATHER3_TARGETS, WIDTH } from "./design.mjs";
import { decodeLzss, encodeLzss } from "./lzss.mjs";
import { renderWeather3FacadeHost } from "./oracle.mjs";
import { createWeather3Simulator, decodeSettings, rpc, tick } from "./simulator.mjs";
import { enterSettings, pushRevision, runTests, tapChord } from "./tests.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const output = path.resolve(process.env.FRAMER_WEATHER3_OUTPUT ?? path.join(here, "build"));
const GENERATION = 19;
const HOST_RPC_IDS = Object.freeze([0xb240, 0xb241, 0xb242, 0xb243, 0xb244, 0xb245,
  0xb24d, 0xb24e, 0xb24f]);

const invariant = (ok, message) => { if (!ok) throw new Error(message); };
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

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

const source = await readFile(path.join(here, "weather3-widget.js"), "utf8");
const sourceBytes = Buffer.from(source, "utf8").length;
invariant(sourceBytes <= 8192, `Widget source is ${sourceBytes} B; the F2JS cap is 8192 B.`);
const handlerCount = source.match(/\bwidget\.on\s*\(/gu)?.length ?? 0;
invariant(handlerCount === 16, `Source must register 16 handlers, got ${handlerCount}.`);

/* 1. Logic tests before anything is emitted. */
const tests = runTests(source);
invariant(tests.failed === 0,
  `Widget logic tests failed: ${JSON.stringify(tests.cases.filter(({ ok }) => !ok), null, 2)}`);

/* 2. F2JS package.  The admission metadata the resident loader checks
 *    (generation, 14 event records, 2 keys, 1 chord, 16 targets, no in-package
 *    raster) is identical to the flashed gen19 package; only the source, the
 *    declared RPC set and the target IDs move. */
const packageValue = buildRenderV2MQuickJsPackage({
  source, generation: GENERATION,
  events: { "tick.1s": true, "input.fn-bottom-knob": true, hostRpcIds: HOST_RPC_IDS,
    keys: [{ id: 0, nativeToken: 0x2c }, { id: 1, nativeToken: 0xe1 }],
    chords: [{ id: 0, heldMask: 3 }] },
  input: { debounceMs: 10, holdDelayMs: 500, holdCadenceMs: 100 },
  targets: WEATHER3_PACKAGE_TARGETS,
});
const decodedPackage = decodeRenderV2MQuickJsPackage(packageValue.binary);
invariant(decodedPackage.generation === GENERATION &&
  (decodedPackage.rasterBase?.length ?? 0) === 0 && decodedPackage.events.length === 14 &&
  decodedPackage.input.keyCount === 2 && decodedPackage.input.chordCount === 1 &&
  decodedPackage.targets.length === 16,
`Package admission metadata drifted: events=${decodedPackage.events.length} ` +
  `keys=${decodedPackage.input.keyCount} chords=${decodedPackage.input.chordCount}.`);
invariant(decodedPackage.targets.map(({ id }) => id).join("\0") ===
  WEATHER3_TARGETS.map(({ id }) => id).join("\0"),
"Facade target IDs must stay identical to the F2JS declarations.");

/* 3. Raster base + facade. */
const baseFrame = renderWeather3Base();
const baseBytes = frameToLe(baseFrame);
invariant(baseBytes.length === FRAME_BYTES, "Base raster is not 62,000 bytes.");
const facade = buildWeather3FacadeAsset({ generation: GENERATION, baseFrame,
  f2jsBinary: packageValue.binary });
invariant(facade.binary.length <= 4096,
  `F2TF is ${facade.binary.length} B; FRAMER_TF_MAX_ASSET_BYTES is 4096.`);
invariant(facade.contractSha256 === TARGET_FACADE_CONTRACT_SHA256, "F2TF contract identity changed.");
const decodedFacade = decodeTargetFacadeAsset(facade.binary, { expectedGeneration: GENERATION,
  expectedF2jsSha256: packageValue.sha256, baseFrame });

const compressed = encodeLzss(baseBytes);
invariant(decodeLzss(compressed, FRAME_BYTES).equals(baseBytes),
  "New base LZSS did not round-trip to 62,000 bytes.");

/* 4. Scenario slots come out of the real widget source, not a hand-written
 *    fixture, so every rendered frame is one the device can actually publish. */
const SAMPLE = Object.freeze({
  current: { temperature: 72, condition: 0, isDay: 1 },
  days: [
    { weekday: 3, low: 60, high: 75, condition: 0 },
    { weekday: 4, low: 58, high: 71, condition: 1 },
    { weekday: 5, low: -4, high: 12, condition: 6 },
  ],
});
const EXTREMES = Object.freeze({
  current: { temperature: -8, condition: 7, isDay: 0 },
  days: [
    { weekday: 0, low: -120, high: -99, condition: 6 },
    { weekday: 1, low: 99, high: 104, condition: 4 },
    { weekday: 2, low: 0, high: 100, condition: 2 },
  ],
});

function weatherSlots(snapshot, { ageSeconds = 0, providerError = false, retrySeconds = 0 } = {}) {
  const simulator = createWeather3Simulator(source);
  simulator.dispatch(rpc(0xb245, 60601, 0));
  pushRevision(simulator, 1, snapshot);
  for (let second = 0; second < ageSeconds; second++) simulator.dispatch(tick());
  if (providerError || retrySeconds) {
    simulator.dispatch(rpc(0xb24d, providerError ? 1 : 0, retrySeconds));
  }
  return simulator.slots;
}

function settingsSlots({ zip = 60601, taps = 0, save = false, ack = false } = {}) {
  const simulator = createWeather3Simulator(source);
  simulator.dispatch(rpc(0xb245, zip, 0));
  pushRevision(simulator, 1, SAMPLE);
  enterSettings(simulator);
  for (let index = 0; index < taps; index++) tapChord(simulator);
  if (save) tapChord(simulator);
  if (ack) {
    const state = decodeSettings(simulator.slots);
    simulator.dispatch(rpc(0xb245, state.zip, state.saveSeq));
  }
  return simulator.slots;
}

const scenarios = [
  { name: "boot-no-snapshot", slots: Array(16).fill(0) },
  { name: "sample-72-sunny", slots: weatherSlots(SAMPLE) },
  { name: "provider-error-retry", slots: weatherSlots(SAMPLE, { providerError: true, retrySeconds: 30 }) },
  { name: "extremes-negative", slots: weatherSlots(EXTREMES) },
  { name: "settings-digit-1", slots: settingsSlots({ taps: 0 }) },
  { name: "settings-digit-5", slots: settingsSlots({ taps: 4 }) },
  { name: "settings-saving", slots: settingsSlots({ taps: 4, save: true }) },
  { name: "settings-saved", slots: settingsSlots({ taps: 4, save: true, ack: true }) },
];

const state = { lastAppliedRevision: 0 };
const rendered = scenarios.map((scenario) => {
  const result = renderWeather3FacadeHost({ decoded: decodedFacade, baseFrame,
    mailbox: { sequence: 2, slots: [...scenario.slots], admittedGeneration: GENERATION },
    state: { ...state }, expectedGeneration: GENERATION });
  invariant(result.result === TARGET_FACADE_RESULT.ok,
    `Scenario ${scenario.name} rendered result ${result.result}, expected ok(0).`);
  invariant(result.metrics.overlayWrites <= decodedFacade.header.maxOverlayWrites,
    `Scenario ${scenario.name} exceeded the overlay write budget.`);
  return { scenario, result };
});

/* Pixel-exact settings check.  The card temperature band is rebuilt from the
 * glyph table alone - five ZIP digits plus the caret bar on the active cell -
 * and must equal the rendered band exactly.  Any surviving pixel of the
 * format-4 "--" placeholder that the eraser failed to repaint, or any leaked
 * weather ink, shows up here as a mismatch. */
const INK_BLACK = decodedFacade.palette[1];
function expectedCardBand(slots) {
  const settings = decodeSettings(slots);
  const band = new Uint16Array(baseFrame);
  const stamp = (code, cellX, cellY) => {
    const glyph = decodedFacade.glyphs.get(code);
    invariant(Boolean(glyph), `Glyph 0x${code.toString(16)} is missing from the facade.`);
    for (let column = 0; column < 5; column++) for (let row = 0; row < 7; row++) {
      if (((glyph.columns[column] >>> row) & 1) === 0) continue;
      for (let sy = 0; sy < 3; sy++) for (let sx = 0; sx < 3; sx++) {
        band[(cellY + row * 3 + sy) * WIDTH + cellX + column * 3 + sx] = INK_BLACK;
      }
    }
  };
  settings.digits.forEach((digit, cell) => {
    invariant(digit >= 0 && digit <= 9, `ZIP cell ${cell} is not a digit.`);
    stamp(0x30 + digit, 6 + cell * 18, 120);
  });
  /* The caret only exists while the ZIP is being edited (card label "ZIP"). */
  if (settings.labelIndex === 9) stamp(0x5f, 6 + settings.caret * 18, 125);
  return band;
}
for (const { scenario, result } of rendered) {
  if (!scenario.name.startsWith("settings-")) continue;
  invariant(decodeSettings(scenario.slots).settingsActive,
    `${scenario.name} is not a settings frame.`);
  const band = expectedCardBand(scenario.slots);
  let mismatches = 0;
  for (let y = 117; y < 147; y++) for (let x = 5; x < 95; x++) {
    if (band[y * WIDTH + x] !== result.frame[y * WIDTH + x]) mismatches++;
  }
  invariant(mismatches === 0,
    `${scenario.name} card band differs from the expected ZIP editor in ${mismatches} pixels.`);
}

const png = contactSheet([baseFrame, ...rendered.map(({ result }) => result.frame)]);

/* 5. Emit. */
const paths = {
  source: path.join(output, "weather-id28-gen19.js"),
  f2js: path.join(output, "weather-id28-gen19.f2js"),
  f2tf: path.join(output, "weather-id28-gen19.f2tf"),
  base: path.join(output, "weather-id28-base.rgb565le"),
  compressed: path.join(output, "weather-id28-base.lzss"),
  f2jsSha: path.join(output, "weather-id28-f2js.sha256.bin"),
  contractSha: path.join(output, "target-contract.sha256.bin"),
  png: path.join(output, "contact-sheet.png"),
  cases: path.join(output, "weather3-cases.bin"),
  hostFrames: path.join(output, "weather3-host-frames.bin"),
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
  format: "framer-f1-weather3-zip-id28-asset-set-v1",
  status: "OFFLINE_ONLY_NOT_FLASHED",
  hardwareTouched: false,
  generation: GENERATION,
  canvas: { width: WIDTH, height: HEIGHT, pixels: PIXELS, bytes: FRAME_BYTES, format: "rgb565-le" },
  package: { file: "weather-id28-gen19.f2js", bytes: packageValue.binary.length,
    sha256: packageValue.sha256, sourceSha256: sha256(Buffer.from(source)),
    sourceBytes, handlers: handlerCount, events: decodedPackage.events.length,
    hostRpcIds: HOST_RPC_IDS.map((id) => `0x${id.toString(16).toUpperCase()}`),
    keys: decodedPackage.input.keyCount, chords: decodedPackage.input.chordCount,
    targets: decodedPackage.targets.map(({ id }) => id) },
  facade: { file: "weather-id28-gen19.f2tf", bytes: facade.binary.length,
    sha256: facade.sha256, baseSha256: facade.baseSha256, f2jsSha256: facade.f2jsSha256,
    contractSha256: facade.contractSha256, maxAssetBytes: 4096,
    paletteEntries: facade.paletteCount, glyphRecords: facade.glyphCount,
    maxOverlayWrites: decodedFacade.header.maxOverlayWrites,
    targets: WEATHER3_TARGETS.map(({ id, x, y, width, height, format, slots, scale, align,
      tableName }) => ({ id, x, y, width, height, format,
      slots: slots.filter((slot) => slot !== 0xff), scale, align, tableName })) },
  base: { file: "weather-id28-base.rgb565le", bytes: baseBytes.length, sha256: sha256(baseBytes) },
  compressed: { file: "weather-id28-base.lzss", bytes: compressed.length,
    sha256: sha256(compressed), decodesTo: FRAME_BYTES,
    ratio: Number((compressed.length / baseBytes.length).toFixed(4)) },
  contactSheet: { file: "contact-sheet.png", sha256: sha256(png),
    panels: ["static-base", ...scenarios.map(({ name }) => name)] },
  mailbox: {
    0: "applied weather revision (facade revision gate)",
    1: "current temperature packed ASCII (weather only)",
    2: "card label index: weather condition, or 1 ZIP / 2 Saving / 3 Saved",
    "3..8": "weather: day1 meta/low/high, day2 meta/low/high; settings: five ZIP " +
      "digit metas plus the caret index",
    "9..11": "day3 meta/low/high (weather only)",
    12: "bit0 card-label has-good, bit1 retained has-good",
    13: "bit0 settings active (settings targets has-good), bit1 chord consumed",
    14: "settings word: zip 0..16, settingsActive 17, pendingSave 18, timer 19..23, saveSeq 24..31",
    15: "bit0 weather has-good, bit1 hidden, bit2 provider error",
  },
  interaction: {
    enter: "hold Space+LeftShift (the only chord) >= ~700 ms: input.key.hold with " +
      "heldMask 3 and holdCount >= 3",
    edit: "input.fn-bottom-knob delta changes the active digit 0..9 with wrap",
    advance: "a short chord tap (input.chord.up) moves to the next digit",
    save: "a chord tap on the fifth digit raises pendingSave, increments saveSeq and shows Saving",
    cancel: "another >= ~700 ms chord hold, or 30 s of inactivity on tick.1s",
    ack: "host.rpc:0xB245 value=zip auxiliary=saveSeq clears pendingSave, shows Saved for 2 s " +
      "and returns to the weather view; outside settings it just stores the zip",
  },
  tests: { total: tests.total, passed: tests.passed, failed: tests.failed,
    cases: tests.cases.map(({ name, ok }) => ({ name, ok })) },
  render: rendered.map(({ scenario, result }) => ({ name: scenario.name, result: result.result,
    overlayWrites: result.metrics.overlayWrites, formattedTargets: result.metrics.formattedTargets,
    frameSha256: sha256(frameToLe(result.frame)) })),
  constraints: {
    dynamicFont: "single 5x7 bitmap font, fixed 5 px width / 6 px advance, integer scale 1..3",
    dynamicGlyphs: `${facade.glyphCount}/64 records`,
    closedFormatters: "formatter 4 always appends U+00B0 and can never render nothing, so the " +
      "settings view erases its placeholder with an orange block target instead of hiding it",
    staticText: "'Today', the cloud/sun mark and the card are raster, not facade text",
  },
};
await writeFile(paths.manifest, `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
  status: "PASS_WEATHER3_ASSETS_BUILT_NO_HARDWARE",
  out: output, png: paths.png,
  sourceBytes, tests: `${tests.passed}/${tests.total}`,
  f2js: manifest.package.sha256, f2jsBytes: packageValue.binary.length,
  f2tf: manifest.facade.sha256, f2tfBytes: manifest.facade.bytes,
  base: manifest.base.sha256, lzssBytes: compressed.length,
  glyphs: facade.glyphCount,
  overlayWrites: manifest.render.map(({ overlayWrites }) => overlayWrites),
}, null, 2)}\n`);
