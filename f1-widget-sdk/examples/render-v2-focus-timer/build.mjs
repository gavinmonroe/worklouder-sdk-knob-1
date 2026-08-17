import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compileRendererV2Program, RENDERER_V2_LIMITS,
  RendererV2EventRuntime } from "../../../custom-firmware/lib/renderer-v2-event-vm.mjs";
import { createRenderV2Runtime, encodeRenderV2Event, linkRenderV2Raster,
  prepareRenderV2 } from "../../src/render-v2/index.mjs";
import { decodeRenderV2Lzss, encodeRenderV2Lzss,
  RENDER_V2_LZSS } from "../../src/render-v2/lzss.mjs";
import { createReadableDemoGlyphAtlas } from "../render-v2-events/readable-atlas.mjs";
import { createTimerRaster, DIAL_STEPS, formatTimer, PALETTE,
  renderTimerFrame } from "./timer-design.mjs";
import { hashRgb565Frame, HOST_RPC_EVENT_ID, HOST_SYNC_SECONDS, INITIAL_SECONDS,
  leBufferToRgb565Frame, rgb565FrameToLeBuffer, TIMER_MAX_SECONDS, TIMER_MIN_SECONDS,
  TIMER_STEP_SECONDS, VIEWPORT } from "./program.mjs";
import { contactSheetPng, diffPixelCount, framePng } from "./visual.mjs";

const root = path.dirname(fileURLToPath(import.meta.url)); const output = path.join(root, "build");
const focusBuild = path.join(root, "../render-v2-focus-dial/build");
const sourceNames = ["widget.html", "widget.css", "widget.js", "timer-design.mjs"];
const sourceEntries = await Promise.all(sourceNames.map(async (name) => [name, await readFile(path.join(root, name), "utf8")]));
const source = Object.fromEntries(sourceEntries);
const [sharedBaseFrame, sharedF1wb, focusF2ep, focusManifestSource] = await Promise.all([
  readFile(path.join(focusBuild, "render-v2-focus-dial.base.rgb565")),
  readFile(path.join(focusBuild, "render-v2-focus-dial.base.f1wb")),
  readFile(path.join(focusBuild, "render-v2-focus-dial.f2ep")),
  readFile(path.join(focusBuild, "manifest.json"), "utf8"),
]);
const focusManifest = JSON.parse(focusManifestSource);
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
if (sharedBaseFrame.length !== VIEWPORT.width * VIEWPORT.height * 2 ||
    sha256(sharedBaseFrame) !== focusManifest.compiler.baseFrameSha256 ||
    sharedF1wb.length !== focusManifest.livePackage.bundleBytes ||
    sha256(sharedF1wb) !== focusManifest.livePackage.bundleSha256 ||
    focusF2ep.length !== focusManifest.livePackage.programBytes ||
    sha256(focusF2ep) !== focusManifest.livePackage.programSha256) {
  throw new Error("Timer requires the exact frozen focus-clock/ID26 base, F1WB, and F2EP artifacts.");
}
const prepared = prepareRenderV2({ html: source["widget.html"], css: source["widget.css"],
  script: source["widget.js"], rootClass: "render-v2" });
const atlas = createReadableDemoGlyphAtlas(prepared.scene.glyphs);
const raster = createTimerRaster(prepared, { sharedBaseFrame });
const linked = linkRenderV2Raster(prepared, { atlas, ...raster }); const program = linked.program;
const firmwareProgram = compileRendererV2Program(linked.spec);
if (!program.binary.equals(firmwareProgram.binary) || program.sha256 !== firmwareProgram.sha256 ||
    JSON.stringify(program.manifest) !== JSON.stringify(firmwareProgram.manifest)) {
  throw new Error("Focus timer SDK F2EP encoder differs from the firmware reference encoder.");
}
const authoredBytecode = Buffer.concat(prepared.script.handlers.map(({ instructionBinary }) => instructionBinary));
if (!authoredBytecode.equals(program.bytecode)) throw new Error("Focus timer authored bytecode differs from F2EP.");

const base = Buffer.from(linked.baseFrame); const framebuffer = Buffer.from(base);
const compressedTimerBase = encodeRenderV2Lzss(base);
if (!decodeRenderV2Lzss(compressedTimerBase, base.length).equals(base)) {
  throw new Error("Compressed blue timer base did not round-trip exactly.");
}
const firmware = new RendererV2EventRuntime(firmwareProgram, { framebuffer,
  renderV1Frame(target) { base.copy(target); } });
const sdk = createRenderV2Runtime(linked); const snapshots = [];
function capture(name, event, tickResult, sdkResult) {
  const frame = leBufferToRgb565Frame(framebuffer); const sdkFrame = leBufferToRgb565Frame(sdkResult.frame);
  const fresh = renderTimerFrame(firmware.state); const hostDiffPixels = diffPixelCount(frame, sdkFrame);
  const fullRenderDiffPixels = diffPixelCount(frame, fresh);
  if (hostDiffPixels !== 0 || fullRenderDiffPixels !== 0 || JSON.stringify(sdkResult.state) !== JSON.stringify(firmware.state)) {
    throw new Error(`Focus timer parity failed for ${name}: host=${hostDiffPixels}, fresh=${fullRenderDiffPixels}.`);
  }
  snapshots.push(Object.freeze({ name, event, tickResult, state: firmware.state,
    semantic: Object.freeze({ display: formatTimer(firmware.state.remainingSeconds),
      dialDetent: firmware.state.dialPhase + 1 }), frame, rgb565Sha256: hashRgb565Frame(frame),
    frameGeneration: firmware.frameGeneration, descriptorIdentity: firmware.descriptorIdentity,
    hostGeneration: sdkResult.generation, hostDiffPixels, fullRenderDiffPixels }));
}

capture("initial-25-00", "initial tick.100ms", firmware.tick100ms(), sdk.dispatch(encodeRenderV2Event({
  kind: "tick.100ms", value: 1, sequence: 1 })));
if (!firmware.enqueueFnBottomKnob({ encoderId: RENDERER_V2_LIMITS.bottomEncoderId, delta: 1,
  fnPressed: true, inputAvailable: true })) throw new Error("Timer turn+ was rejected.");
capture("turn-plus-30-00", "Fn+bottom-knob delta=+1", firmware.tick100ms(), sdk.dispatch(encodeRenderV2Event({
  kind: "input.fn-bottom-knob", flags: 1, id: RENDERER_V2_LIMITS.bottomEncoderId, value: 1, sequence: 2 })));
if (!firmware.enqueueFnBottomKnob({ encoderId: RENDERER_V2_LIMITS.bottomEncoderId, delta: -1,
  fnPressed: true, inputAvailable: true })) throw new Error("Timer turn- was rejected.");
capture("turn-minus-25-00", "Fn+bottom-knob delta=-1", firmware.tick100ms(), sdk.dispatch(encodeRenderV2Event({
  kind: "input.fn-bottom-knob", flags: 1, id: RENDERER_V2_LIMITS.bottomEncoderId, value: -1, sequence: 3 })));
let tickResult;
for (let tick = 0; tick < 7; tick += 1) tickResult = firmware.tick100ms();
capture("countdown-tick-24-59", "tick.1s", tickResult,
  sdk.dispatch(encodeRenderV2Event({ kind: "tick.1s", value: 1, sequence: 4 })));
if (!firmware.enqueueHostRpc({ rpcEventId: HOST_RPC_EVENT_ID, value: HOST_SYNC_SECONDS })) {
  throw new Error("Timer host sync was rejected.");
}
capture("host-sync-95-00", `host.rpc:0x${HOST_RPC_EVENT_ID.toString(16).toUpperCase()} seconds=${HOST_SYNC_SECONDS}`,
  firmware.tick100ms(), sdk.dispatch(encodeRenderV2Event({ kind: "host.rpc", id: HOST_RPC_EVENT_ID,
    value: HOST_SYNC_SECONDS, sequence: 5 })));

const records = snapshots.map((snapshot, index) => ({ index, name: snapshot.name, event: snapshot.event,
  state: snapshot.state, semantic: snapshot.semantic, frameGeneration: snapshot.frameGeneration,
  descriptorIdentity: snapshot.descriptorIdentity, hostGeneration: snapshot.hostGeneration,
  hostDiffPixels: snapshot.hostDiffPixels, fullRasterRenderDiffPixels: snapshot.fullRenderDiffPixels,
  rgb565Sha256: snapshot.rgb565Sha256, rgb565Bytes: snapshot.frame.byteLength,
  changedPixelsFromPrevious: index === 0 ? 0 : diffPixelCount(snapshots[index - 1].frame, snapshot.frame),
  png: `frame-${String(index).padStart(2, "0")}-${snapshot.name}.png`,
  raw: `frame-${String(index).padStart(2, "0")}-${snapshot.name}.rgb565` }));
const boundaryFrames = [5 * 60, 0, 55 * 60, 60 * 60, 95 * 60].map((remainingSeconds) => {
  const frame = renderTimerFrame({ remainingSeconds, dialPhase: 0 }); const display = formatTimer(remainingSeconds);
  return Object.freeze({ remainingSeconds, display, frame, rgb565Sha256: hashRgb565Frame(frame),
    png: `boundary-${display.replace(":", "-")}.png`, raw: `boundary-${display.replace(":", "-")}.rgb565` });
});
const lifecycleContactSheet = contactSheetPng(snapshots.map(({ frame }) => frame));
const boundaryContactSheet = contactSheetPng(boundaryFrames.map(({ frame }) => frame));
const animationFrames = Array.from({ length: DIAL_STEPS }, (_, dialPhase) => {
  const frame = renderTimerFrame({ remainingSeconds: 1499, dialPhase });
  return Object.freeze({ dialPhase, dialDetent: dialPhase + 1, frame,
    rgb565Sha256: hashRgb565Frame(frame) });
});
const animationContactSheet = contactSheetPng(animationFrames.map(({ frame }) => frame));

const storeCapacityBytes = 98_304;
const sharedStoreFitBinary = Buffer.concat([sharedF1wb, focusF2ep, program.binary, compressedTimerBase]);
const sharedStoreFitSha256 = sha256(sharedStoreFitBinary);
if (sharedStoreFitBinary.length > storeCapacityBytes) {
  throw new Error(`Focus F1WB plus both F2EP programs exceed the ${storeCapacityBytes}-byte single-store budget.`);
}
const sourceSha256 = createHash("sha256");
sourceEntries.forEach(([name, value]) => sourceSha256.update(name).update("\0").update(value).update("\0"));
const manifest = {
  format: "framer-renderer-v2-focus-timer-demo-v1", screenProfile: "timer/id27-proposed",
  execution: { target: "focus-id26-base-plus-lzss-blue-timer-base-plus-deterministic-timer-f2ep",
    sourceOfTruth: "timer-design.mjs blue RGB565 base -> exact bounded LZSS -> linkRenderV2Raster(prepareRenderV2(widget.*)) -> F2EP",
    deviceEvaluatesJavaScript: false, deviceRasterizesDial: false, renderSource: linked.renderSource,
    nativeOrCombinedFirmwareChanged: false },
  viewport: { ...VIEWPORT, pixelFormat: "RGB565-LE", borrowedFramebufferBytes: 62000 },
  sharedBase: { owner: "focus-clock/id26", relativeArtifact: "../render-v2-focus-dial/build/render-v2-focus-dial.base.rgb565",
    bytes: sharedBaseFrame.length, sha256: sha256(sharedBaseFrame), separateTimerBaseStored: true,
    repaintStrategy: "ID26 restores its exact orange F1WB base; ID27 decodes the exact blue timer switch-base before applying timer F2EP patches" },
  timerSwitchBase: { rawArtifact: "render-v2-focus-timer.base.rgb565", bytes: base.length,
    sha256: sha256(base), compressedArtifact: "render-v2-focus-timer.base.lzss",
    compressedBytes: compressedTimerBase.length, compressedSha256: sha256(compressedTimerBase),
    codec: RENDER_V2_LZSS.codec, exactRoundTrip: true },
  design: { largeFace: "MM:SS", palette: PALETTE, dialDetents: DIAL_STEPS, visibleArcTicks: 5,
    radialFalloff: "continuous smoothstep quantized once to RGB565",
    safeArea: { left: 5, right: 5, topStatusY: 20, previousTopStatusY: 16,
      addedTopPaddingPixels: 4, largeDigitsX: [5, 24, 57, 76], clippedPixels: 0 } },
  source: { files: sourceNames, sha256: sourceSha256.digest("hex") },
  compiler: { preparedFormat: prepared.format, sceneSha256: prepared.scene.sha256,
    sceneBytes: prepared.sceneBinary.length, glyphs: prepared.scene.glyphs.length,
    atlasSha256: atlas.sha256, atlasBytes: atlas.binary.length, linkedFormat: linked.format,
    linkedSha256: linked.sha256, linkedBudget: linked.budget,
    baseFrameSha256: createHash("sha256").update(raster.baseFrame).digest("hex"),
    authoredBytecodeSha256: createHash("sha256").update(authoredBytecode).digest("hex"),
    authoredBytecodeBytes: authoredBytecode.length, linkedBytecodeExact: authoredBytecode.equals(program.bytecode),
    sdkFirmwareBinaryExact: program.binary.equals(firmwareProgram.binary),
    sdkFirmwareManifestExact: JSON.stringify(program.manifest) === JSON.stringify(firmwareProgram.manifest),
    selectorOverrides: raster.selectorOverrides, selectorOverrideScope: "offline raster linker only; F2EP ABI unchanged",
    hostRuntimeVsFirmwareModel: "pixel-exact", firmwareModelVsFreshFullRasterRender: "pixel-exact" },
  program: program.manifest,
  budget: { programBinaryBytes: program.binary.length, patchPayloadBytes: linked.budget.pixelBytes,
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
      extraFramebufferBytes: RENDERER_V2_LIMITS.extraFramebufferBytes === 0 } },
  timer: { initialSeconds: INITIAL_SECONDS, minimumEditSeconds: TIMER_MIN_SECONDS,
    maximumSeconds: TIMER_MAX_SECONDS, knobStepSeconds: TIMER_STEP_SECONDS,
    countdownFloorSeconds: 0, authoredScaledDelta: "remainingSeconds += event.delta * 300" },
  events: { tick: "tick.1s subtracts one and clamps at zero",
    fnBottomKnob: { encoderId: RENDERER_V2_LIMITS.bottomEncoderId, fnRequired: true,
      signedDeltaScaleSeconds: TIMER_STEP_SECONDS, editClampSeconds: [TIMER_MIN_SECONDS, TIMER_MAX_SECONDS] },
    hostSync: { fixedEventId: HOST_RPC_EVENT_ID,
      fixedEventIdHex: `0x${HOST_RPC_EVENT_ID.toString(16).toUpperCase()}`,
      value: "remaining seconds", clampSeconds: [TIMER_MIN_SECONDS, TIMER_MAX_SECONDS] } },
  sharedStore: { accountingArtifact: "render-v2-focus-plus-timer.store-fit.bin",
    deployableContainer: false,
    layout: ["focus-id26.f1wb", "focus-id26.f2ep", "timer-id27.f2ep", "timer-id27.base.lzss"],
    capacityBytes: storeCapacityBytes, bytes: sharedStoreFitBinary.length,
    remainingBytes: storeCapacityBytes - sharedStoreFitBinary.length, sha256: sharedStoreFitSha256,
    focusF1wbBytes: sharedF1wb.length, focusF1wbSha256: sha256(sharedF1wb),
    focusF2epBytes: focusF2ep.length, focusF2epSha256: sha256(focusF2ep),
    timerF2epBytes: program.binary.length, timerF2epSha256: program.sha256,
    timerBaseLzssBytes: compressedTimerBase.length, timerBaseLzssSha256: sha256(compressedTimerBase) },
  animation: { cadenceMs: 1000, model: "five-position clicking rotation synchronized to displayed seconds",
    state: "dialPhase", modulo: DIAL_STEPS,
    exactSecondBoundaryPolicy: "queued Fn click is applied first, then the independent automatic second click; both are retained",
    frames: animationFrames.map(({ frame: _frame, ...record }) => record),
    contactSheet: "animation-contact-sheet.png", contactSheetSha256: sha256(animationContactSheet) },
  frames: records, boundaryFrames: boundaryFrames.map(({ frame: _frame, ...record }) => record),
  contactSheet: "lifecycle-contact-sheet.png", contactSheetSha256: sha256(lifecycleContactSheet),
  boundaryContactSheet: "boundary-contact-sheet.png", boundaryContactSheetSha256: sha256(boundaryContactSheet),
  note: "Separate timer/ID27 F2EP linked to its exact compressed blue switch-base; ID26 keeps its orange F1WB base. No native/combined image or hardware was modified." };

await mkdir(output, { recursive: true });
await Promise.all(["render-v2-focus-timer.base.rgb565", "render-v2-focus-timer.base.lzss",
  "render-v2-focus-timer.base.f1ra",
  "render-v2-focus-timer.base.f1wb", "render-v2-focus-timer.package.bin"]
  .map((name) => rm(path.join(output, name), { force: true })));
await Promise.all([
  writeFile(path.join(output, "render-v2-focus-timer.f2ep"), program.binary),
  writeFile(path.join(output, "render-v2-focus-timer.base.rgb565"), base),
  writeFile(path.join(output, "render-v2-focus-timer.base.lzss"), compressedTimerBase),
  writeFile(path.join(output, "render-v2-focus-timer.scene.bin"), prepared.sceneBinary),
  writeFile(path.join(output, "render-v2-focus-timer.atlas.bin"), atlas.binary),
  writeFile(path.join(output, "render-v2-focus-plus-timer.store-fit.bin"), sharedStoreFitBinary),
  writeFile(path.join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`),
  writeFile(path.join(output, "lifecycle-contact-sheet.png"), lifecycleContactSheet),
  writeFile(path.join(output, "boundary-contact-sheet.png"), boundaryContactSheet),
  writeFile(path.join(output, "animation-contact-sheet.png"), animationContactSheet),
  ...snapshots.flatMap((snapshot, index) => { const prefix = `frame-${String(index).padStart(2, "0")}-${snapshot.name}`;
    return [writeFile(path.join(output, `${prefix}.png`), framePng(snapshot.frame)),
      writeFile(path.join(output, `${prefix}.rgb565`), rgb565FrameToLeBuffer(snapshot.frame))]; }),
  ...boundaryFrames.flatMap(({ frame, png, raw }) => [writeFile(path.join(output, png), framePng(frame)),
    writeFile(path.join(output, raw), rgb565FrameToLeBuffer(frame))]),
]);
process.stdout.write(`${JSON.stringify({ status: "OFFLINE_RENDER_V2_FOCUS_TIMER_PREVIEW", output,
  program: program.manifest, budget: manifest.budget, sharedBase: manifest.sharedBase,
  sharedStore: manifest.sharedStore,
  frames: records, boundaryFrames: manifest.boundaryFrames,
  contactSheet: manifest.contactSheet, boundaryContactSheet: manifest.boundaryContactSheet }, null, 2)}\n`);
