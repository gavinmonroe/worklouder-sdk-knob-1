import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  compileRendererV2Program,
  RENDERER_V2_LIMITS,
  RendererV2EventRuntime,
} from "../../../custom-firmware/lib/renderer-v2-event-vm.mjs";
import {
  createRenderV2Runtime,
  encodeRenderV2Event,
  linkRenderV2Raster,
  prepareRenderV2,
} from "../../src/render-v2/index.mjs";
import { createReadableDemoGlyphAtlas } from "../render-v2-events/readable-atlas.mjs";
import {
  clockText,
  createFocusDialRaster,
  DIAL_STEPS,
  PALETTE,
  renderFocusDialFrame,
} from "./raster-design.mjs";
import {
  hashRgb565Frame,
  HOST_RPC_EVENT_ID,
  HOST_SYNC_SECONDS,
  leBufferToRgb565Frame,
  rgb565FrameToLeBuffer,
  VIEWPORT,
} from "./program.mjs";
import { contactSheetPng, diffPixelCount, framePng } from "./visual.mjs";
import { buildFocusDialPackage } from "./focus-package.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(root, "build");
const compilerSourceNames = ["widget.html", "widget.css", "widget.js"];
const visualSourceNames = ["raster-design.mjs"];
const sourceNames = [...compilerSourceNames, ...visualSourceNames];
const sourceEntries = await Promise.all(sourceNames.map(async (name) => [name, await readFile(path.join(root, name), "utf8")]));
const source = Object.fromEntries(sourceEntries);

const prepared = prepareRenderV2({ html: source["widget.html"], css: source["widget.css"],
  script: source["widget.js"], rootClass: "render-v2" });
const atlas = createReadableDemoGlyphAtlas(prepared.scene.glyphs);
const raster = createFocusDialRaster(prepared);
const linked = linkRenderV2Raster(prepared, { atlas, ...raster });
const program = linked.program;
const firmwareProgram = compileRendererV2Program(linked.spec);
if (!program.binary.equals(firmwareProgram.binary) || program.sha256 !== firmwareProgram.sha256 ||
    JSON.stringify(program.manifest) !== JSON.stringify(firmwareProgram.manifest)) {
  throw new Error("Focus dial SDK F2EP encoder differs from the firmware reference encoder.");
}
const authoredBytecode = Buffer.concat(prepared.script.handlers.map(({ instructionBinary }) => instructionBinary));
if (!authoredBytecode.equals(program.bytecode)) {
  throw new Error("Focus dial F2EP bytecode differs from the exact parsed widget.js handlers.");
}

const base = Buffer.from(linked.baseFrame); const borrowedFramebuffer = Buffer.from(base);
const firmwareRuntime = new RendererV2EventRuntime(firmwareProgram, { framebuffer: borrowedFramebuffer,
  renderV1Frame(framebuffer) { base.copy(framebuffer); } });
const hostRuntime = createRenderV2Runtime(linked);
const snapshots = [];

function capture(name, event, tickResult, hostResult) {
  const frame = leBufferToRgb565Frame(firmwareRuntime.framebuffer);
  const hostFrame = leBufferToRgb565Frame(hostResult.frame);
  const fullFrame = renderFocusDialFrame(firmwareRuntime.state);
  const hostDiffPixels = diffPixelCount(frame, hostFrame);
  const fullRenderDiffPixels = diffPixelCount(frame, fullFrame);
  if (hostDiffPixels !== 0 || fullRenderDiffPixels !== 0 ||
      JSON.stringify(hostResult.state) !== JSON.stringify(firmwareRuntime.state)) {
    throw new Error(`Focus dial parity failed for ${name}: host=${hostDiffPixels}, full=${fullRenderDiffPixels}.`);
  }
  snapshots.push(Object.freeze({ name, event, tickResult, state: firmwareRuntime.state,
    semantic: Object.freeze({ clock: clockText(firmwareRuntime.state.secondsOfDay),
      dialDetent: firmwareRuntime.state.dialPhase + 1 }), frame, rgb565Sha256: hashRgb565Frame(frame),
    frameGeneration: firmwareRuntime.frameGeneration, descriptorIdentity: firmwareRuntime.descriptorIdentity,
    hostGeneration: hostResult.generation, hostDiffPixels, fullRenderDiffPixels }));
}

capture("boot", "initial tick.100ms", firmwareRuntime.tick100ms(), hostRuntime.dispatch(encodeRenderV2Event({
  kind: "tick.100ms", value: 1, sequence: 1,
})));
for (let tick = 0; tick < 9; tick += 1) firmwareRuntime.tick100ms();
capture("clock-plus-1s", "tick.1s", Object.freeze({ secondTick: true }),
  hostRuntime.dispatch(encodeRenderV2Event({ kind: "tick.1s", value: 1, sequence: 2 })));

for (let detent = 1; detent <= 3; detent += 1) {
  if (!firmwareRuntime.enqueueFnBottomKnob({ encoderId: RENDERER_V2_LIMITS.bottomEncoderId, delta: 1,
    fnPressed: true, inputAvailable: true })) throw new Error("Focus dial Fn+bottom-knob event was rejected.");
  capture(`fn-dial-detent-${detent + 1}`, "input.fn-bottom-knob delta=+1", firmwareRuntime.tick100ms(),
    hostRuntime.dispatch(encodeRenderV2Event({ kind: "input.fn-bottom-knob", flags: 1,
      id: RENDERER_V2_LIMITS.bottomEncoderId, value: 1, sequence: 2 + detent })));
}

if (!firmwareRuntime.enqueueHostRpc({ rpcEventId: HOST_RPC_EVENT_ID, value: HOST_SYNC_SECONDS })) {
  throw new Error("Focus dial host clock-sync RPC was rejected.");
}
capture("host-sync-02-12", `host.rpc:0x${HOST_RPC_EVENT_ID.toString(16).toUpperCase()} seconds=${HOST_SYNC_SECONDS}`,
  firmwareRuntime.tick100ms(), hostRuntime.dispatch(encodeRenderV2Event({ kind: "host.rpc",
    id: HOST_RPC_EVENT_ID, value: HOST_SYNC_SECONDS, sequence: 6 })));

const frameRecords = snapshots.map((snapshot, index) => ({
  index, name: snapshot.name, event: snapshot.event, state: snapshot.state, semantic: snapshot.semantic,
  frameGeneration: snapshot.frameGeneration, descriptorIdentity: snapshot.descriptorIdentity,
  hostGeneration: snapshot.hostGeneration, hostDiffPixels: snapshot.hostDiffPixels,
  fullRasterRenderDiffPixels: snapshot.fullRenderDiffPixels, rgb565Sha256: snapshot.rgb565Sha256,
  rgb565Bytes: snapshot.frame.byteLength,
  changedPixelsFromPrevious: index === 0 ? 0 : diffPixelCount(snapshots[index - 1].frame, snapshot.frame),
  png: `frame-${String(index).padStart(2, "0")}-${snapshot.name}.png`,
  raw: `frame-${String(index).padStart(2, "0")}-${snapshot.name}.rgb565`,
}));
const animationFrames = Array.from({ length: DIAL_STEPS }, (_, dialPhase) => {
  const frame = renderFocusDialFrame({ secondsOfDay: 45_297, dialPhase });
  return Object.freeze({ dialPhase, dialDetent: dialPhase + 1, frame,
    rgb565Sha256: hashRgb565Frame(frame) });
});
const animationContactSheet = contactSheetPng(animationFrames.map(({ frame }) => frame));

const sourceSha256 = createHash("sha256");
sourceEntries.forEach(([name, value]) => sourceSha256.update(name).update("\0").update(value).update("\0"));
const manifest = {
  format: "framer-renderer-v2-focus-dial-demo-v1",
  execution: {
    target: "procedural-rgb565-base-plus-deterministic-compiled-event-vm",
    sourceOfTruth: "raster-design.mjs -> linkRenderV2Raster(prepareRenderV2(widget.*)) -> F2EP",
    deviceEvaluatesJavaScript: false,
    deviceRasterizesDial: false,
    rasterization: "offline deterministic procedural RGB565",
    renderSource: linked.renderSource,
  },
  viewport: { ...VIEWPORT, pixelFormat: "RGB565-LE", borrowedFramebufferBytes: 62000 },
  design: { referenceAdaptation: "black focus clock with lower radial dial", dialDetents: DIAL_STEPS,
    visibleArcTicks: 5, radialFalloff: "continuous smoothstep quantized once to RGB565",
    palette: PALETTE, largeClock: "HH:MM", tinySeconds: true,
    safeArea: { left: 5, right: 5, topStatusY: 20, previousTopStatusY: 16,
      addedTopPaddingPixels: 4, largeDigitsX: [5, 24, 57, 76], clippedPixels: 0 } },
  source: { files: sourceNames, sha256: sourceSha256.digest("hex") },
  compiler: {
    preparedFormat: prepared.format, sceneSha256: prepared.scene.sha256, sceneBytes: prepared.sceneBinary.length,
    glyphs: prepared.scene.glyphs.length, atlasSha256: atlas.sha256, atlasBytes: atlas.binary.length,
    linkedFormat: linked.format, linkedSha256: linked.sha256, linkedBudget: linked.budget,
    baseFrameSha256: createHash("sha256").update(raster.baseFrame).digest("hex"),
    authoredBytecodeSha256: createHash("sha256").update(authoredBytecode).digest("hex"),
    authoredBytecodeBytes: authoredBytecode.length, linkedBytecodeExact: authoredBytecode.equals(program.bytecode),
    sdkFirmwareBinaryExact: program.binary.equals(firmwareProgram.binary),
    sdkFirmwareManifestExact: JSON.stringify(program.manifest) === JSON.stringify(firmwareProgram.manifest),
    hostRuntimeVsFirmwareModel: "pixel-exact", firmwareModelVsFreshFullRasterRender: "pixel-exact",
  },
  program: program.manifest,
  budget: {
    programBinaryBytes: program.binary.length, patchPayloadBytes: linked.budget.pixelBytes,
    patchSpanCount: linked.budget.spans, stateSlots: linked.budget.states,
    handlerCount: linked.budget.handlers, bindingCount: linked.budget.bindings,
    borrowedRendererV1FramebufferBytes: linked.budget.baseFrameBytes, additionalFramebufferBytes: 0,
    eventQueueBytes: RENDERER_V2_LIMITS.eventQueueRecords * RENDERER_V2_LIMITS.eventBytes,
    limits: { patchPayloadBytes: RENDERER_V2_LIMITS.patchBytes, patchSpans: RENDERER_V2_LIMITS.patchSpans,
      stateSlots: RENDERER_V2_LIMITS.stateSlots, bindings: RENDERER_V2_LIMITS.bindings,
      extraFramebufferBytes: RENDERER_V2_LIMITS.extraFramebufferBytes },
    admitted: { patchPayload: linked.budget.pixelBytes <= RENDERER_V2_LIMITS.patchBytes,
      patchSpans: linked.budget.spans <= RENDERER_V2_LIMITS.patchSpans,
      stateSlots: linked.budget.states <= RENDERER_V2_LIMITS.stateSlots,
      bindings: linked.budget.bindings <= RENDERER_V2_LIMITS.bindings,
      extraFramebufferBytes: RENDERER_V2_LIMITS.extraFramebufferBytes === 0 },
  },
  clock: { initialSecondsSinceMidnight: 45296, cadenceMs: 1000, hostSyncEventId: HOST_RPC_EVENT_ID,
    hostSyncSampleSeconds: HOST_SYNC_SECONDS, largeFace: "HH:MM", tinySeconds: "SS",
    fullClockFrameTableEntries: 0 },
  events: { tick: "tick.1s increments the clock modulo 86400 and advances dialPhase modulo 5",
    fnBottomKnob: { encoderId: RENDERER_V2_LIMITS.bottomEncoderId, fnRequired: true, dialModulo: DIAL_STEPS },
    hostClockSync: { fixedEventId: HOST_RPC_EVENT_ID,
      fixedEventIdHex: `0x${HOST_RPC_EVENT_ID.toString(16).toUpperCase()}`, value: "seconds-since-midnight" } },
  animation: { cadenceMs: 1000, model: "five-position clicking rotation synchronized to displayed seconds",
    state: "dialPhase", modulo: DIAL_STEPS,
    frames: animationFrames.map(({ frame: _frame, ...record }) => record),
    contactSheet: "animation-contact-sheet.png",
    contactSheetSha256: createHash("sha256").update(animationContactSheet).digest("hex") },
  frames: frameRecords, contactSheet: "contact-sheet.png",
  note: "Offline preview only; no native firmware, combined image, flash artifact, or connected device was modified.",
};

const livePackage = buildFocusDialPackage({ baseFrame: raster.baseFrame, f2ep: program.binary, generation: 1 });
manifest.livePackage = { format: livePackage.format, generation: livePackage.generation,
  bundleBytes: livePackage.bundle.binary.length, bundleSha256: livePackage.bundle.sha256,
  programBytes: livePackage.f2ep.length, programSha256: program.sha256,
  bytes: livePackage.binary.length, sha256: livePackage.sha256,
  activation: "atomic generation-paired scene-store canary; one upload per boot" };

await mkdir(output, { recursive: true });
await Promise.all([
  writeFile(path.join(output, "render-v2-focus-dial.f2ep"), program.binary),
  writeFile(path.join(output, "render-v2-focus-dial.scene.bin"), prepared.sceneBinary),
  writeFile(path.join(output, "render-v2-focus-dial.atlas.bin"), atlas.binary),
  writeFile(path.join(output, "render-v2-focus-dial.base.rgb565"), raster.baseFrame),
  writeFile(path.join(output, "render-v2-focus-dial.base.f1wb"), livePackage.bundle.binary),
  writeFile(path.join(output, "render-v2-focus-dial.package.bin"), livePackage.binary),
  writeFile(path.join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`),
  writeFile(path.join(output, "contact-sheet.png"), contactSheetPng(snapshots.map(({ frame }) => frame))),
  writeFile(path.join(output, "animation-contact-sheet.png"), animationContactSheet),
  ...snapshots.flatMap((snapshot, index) => {
    const prefix = `frame-${String(index).padStart(2, "0")}-${snapshot.name}`;
    return [writeFile(path.join(output, `${prefix}.png`), framePng(snapshot.frame)),
      writeFile(path.join(output, `${prefix}.rgb565`), rgb565FrameToLeBuffer(snapshot.frame))];
  }),
]);

process.stdout.write(`${JSON.stringify({ status: "OFFLINE_RENDER_V2_FOCUS_DIAL_PREVIEW", output,
  sourceOfTruth: manifest.execution.sourceOfTruth, program: program.manifest, compiler: manifest.compiler,
  budget: manifest.budget, frames: frameRecords, contactSheet: manifest.contactSheet }, null, 2)}\n`);
