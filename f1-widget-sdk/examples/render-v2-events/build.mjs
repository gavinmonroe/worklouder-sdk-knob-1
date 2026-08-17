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
  linkRenderV2,
  prepareRenderV2,
} from "../../src/render-v2/index.mjs";
import {
  hashRgb565Frame,
  HOST_RPC_EVENT_ID,
  leBufferToRgb565Frame,
  rgb565FrameToLeBuffer,
} from "./program.mjs";
import { createReadableDemoGlyphAtlas } from "./readable-atlas.mjs";
import { renderFreshSemanticState, semanticStateLabel } from "./semantic-parity.mjs";
import { contactSheetPng, diffPixelCount, framePng } from "./visual.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(root, "build");
const sourceNames = ["widget.html", "widget.css", "widget.js"];
const sources = await Promise.all(sourceNames.map((name) => readFile(path.join(root, name), "utf8")));
const [html, css, script] = sources;

// Authoritative prototype chain. The source is parsed but never evaluated.
const prepared = prepareRenderV2({ html, css, script, rootClass: "render-v2" });
const atlas = createReadableDemoGlyphAtlas(prepared.scene.glyphs);
const linked = linkRenderV2(prepared, { atlas });
const program = linked.program;
const firmwareProgram = compileRendererV2Program(linked.spec);
if (!program.binary.equals(firmwareProgram.binary) || program.sha256 !== firmwareProgram.sha256 ||
    JSON.stringify(program.manifest) !== JSON.stringify(firmwareProgram.manifest)) {
  throw new Error("Self-contained SDK F2EP encoder differs from the firmware reference encoder.");
}
const authoredBytecode = Buffer.concat(prepared.script.handlers.map(({ instructionBinary }) => instructionBinary));
if (!authoredBytecode.equals(program.bytecode)) {
  throw new Error("Compiler-linked F2EP bytecode differs from the exact parsed widget.js handlers.");
}

const base = Buffer.from(linked.baseFrame);
const borrowedFramebuffer = Buffer.from(base);
const firmwareRuntime = new RendererV2EventRuntime(firmwareProgram, {
  framebuffer: borrowedFramebuffer,
  renderV1Frame(framebuffer) { base.copy(framebuffer); },
});
const hostRuntime = createRenderV2Runtime(linked);

const snapshots = [];
function capture(name, event, tickResult, hostResult) {
  const frame = leBufferToRgb565Frame(firmwareRuntime.framebuffer);
  const hostFrame = leBufferToRgb565Frame(hostResult.frame);
  const fullFrame = renderFreshSemanticState(prepared, atlas, firmwareRuntime.state);
  const hostDiffPixels = diffPixelCount(frame, hostFrame);
  const fullRenderDiffPixels = diffPixelCount(frame, fullFrame);
  if (hostDiffPixels !== 0 || fullRenderDiffPixels !== 0 ||
      JSON.stringify(hostResult.state) !== JSON.stringify(firmwareRuntime.state)) {
    throw new Error(`Render-v2 parity failed for ${name}: host=${hostDiffPixels}, full=${fullRenderDiffPixels}.`);
  }
  snapshots.push(Object.freeze({ name, event, tickResult, state: firmwareRuntime.state,
    semantic: semanticStateLabel(firmwareRuntime.state), frame, rgb565Sha256: hashRgb565Frame(frame),
    frameGeneration: firmwareRuntime.frameGeneration, descriptorIdentity: firmwareRuntime.descriptorIdentity,
    hostGeneration: hostResult.generation, hostDiffPixels, fullRenderDiffPixels }));
}

capture("boot", "initial tick.100ms", firmwareRuntime.tick100ms(), hostRuntime.dispatch(encodeRenderV2Event({
  kind: "tick.100ms", value: 1, sequence: 1,
})));
for (let tick = 0; tick < 9; tick += 1) firmwareRuntime.tick100ms();
capture("clock-plus-1s", "tick.1s", Object.freeze({ secondTick: true }),
  hostRuntime.dispatch(encodeRenderV2Event({ kind: "tick.1s", value: 1, sequence: 2 })));

if (!firmwareRuntime.enqueueFnBottomKnob({ encoderId: RENDERER_V2_LIMITS.bottomEncoderId, delta: 1,
  fnPressed: true, inputAvailable: true })) throw new Error("Demo Fn+bottom-knob event was rejected.");
capture("fn-knob-plus-1", "input.fn-bottom-knob delta=+1", firmwareRuntime.tick100ms(),
  hostRuntime.dispatch(encodeRenderV2Event({ kind: "input.fn-bottom-knob", flags: 1,
    id: RENDERER_V2_LIMITS.bottomEncoderId, value: 1, sequence: 3 })));

if (!firmwareRuntime.enqueueHostRpc({ rpcEventId: HOST_RPC_EVENT_ID, value: 7 })) {
  throw new Error("Demo host RPC event was rejected.");
}
capture("host-rpc-7", `host.rpc:0x${HOST_RPC_EVENT_ID.toString(16).toUpperCase()} value=7`,
  firmwareRuntime.tick100ms(), hostRuntime.dispatch(encodeRenderV2Event({ kind: "host.rpc",
    id: HOST_RPC_EVENT_ID, value: 7, sequence: 4 })));

const frameRecords = snapshots.map((snapshot, index) => ({
  index,
  name: snapshot.name,
  event: snapshot.event,
  state: snapshot.state,
  semantic: snapshot.semantic,
  frameGeneration: snapshot.frameGeneration,
  descriptorIdentity: snapshot.descriptorIdentity,
  hostGeneration: snapshot.hostGeneration,
  hostDiffPixels: snapshot.hostDiffPixels,
  fullSemanticRenderDiffPixels: snapshot.fullRenderDiffPixels,
  rgb565Sha256: snapshot.rgb565Sha256,
  rgb565Bytes: snapshot.frame.byteLength,
  changedPixelsFromPrevious: index === 0 ? 0 : diffPixelCount(snapshots[index - 1].frame, snapshot.frame),
  png: `frame-${String(index).padStart(2, "0")}-${snapshot.name}.png`,
  raw: `frame-${String(index).padStart(2, "0")}-${snapshot.name}.rgb565`,
}));

const sourceSha256 = createHash("sha256");
sources.forEach((source, index) => sourceSha256.update(sourceNames[index]).update("\0").update(source).update("\0"));
const bytecodeSha256 = createHash("sha256").update(authoredBytecode).digest("hex");
const manifest = {
  format: "framer-renderer-v2-events-demo-v2",
  execution: {
    target: "authored-source-to-deterministic-compiled-event-vm",
    sourceOfTruth: "prepareRenderV2(widget.html, widget.css, widget.js) -> linkRenderV2 -> F2EP",
    deviceEvaluatesJavaScript: false,
    authoredFacade: "ES5-compatible widget.on/document.querySelector subset",
    optionalMQuickJs: { required: false, included: false,
      note: "MicroQuickJS is a future optional execution backend, not part of this deterministic prototype." },
  },
  viewport: { width: 100, height: 310, pixelFormat: "RGB565-LE", borrowedFramebufferBytes: 62000 },
  source: { files: sourceNames, sha256: sourceSha256.digest("hex") },
  compiler: {
    preparedFormat: prepared.format,
    sceneSha256: prepared.scene.sha256,
    sceneBytes: prepared.sceneBinary.length,
    glyphs: prepared.scene.glyphs.length,
    atlasSha256: atlas.sha256,
    atlasBytes: atlas.binary.length,
    linkedFormat: linked.format,
    linkedSha256: linked.sha256,
    linkedBudget: linked.budget,
    authoredBytecodeSha256: bytecodeSha256,
    authoredBytecodeBytes: authoredBytecode.length,
    linkedBytecodeExact: authoredBytecode.equals(program.bytecode),
    sdkFirmwareBinaryExact: program.binary.equals(firmwareProgram.binary),
    sdkFirmwareManifestExact: JSON.stringify(program.manifest) === JSON.stringify(firmwareProgram.manifest),
    hostRuntimeVsFirmwareModel: "pixel-exact",
    firmwareModelVsFreshFullSemanticRender: "pixel-exact",
  },
  program: program.manifest,
  budget: {
    programBinaryBytes: program.binary.length,
    patchPayloadBytes: linked.budget.pixelBytes,
    patchSpanCount: linked.budget.spans,
    stateSlots: linked.budget.states,
    handlerCount: linked.budget.handlers,
    bindingCount: linked.budget.bindings,
    borrowedRendererV1FramebufferBytes: linked.budget.baseFrameBytes,
    additionalFramebufferBytes: 0,
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
  clock: { initialSecondsSinceMidnight: 45296, cadenceMs: 1000, digitGlyphVariants: 10,
    digitBindings: 6, moduli: [3, 10, 6, 10, 6, 10], fullClockFrameTableEntries: 0 },
  events: {
    fnBottomKnob: { encoderId: RENDERER_V2_LIMITS.bottomEncoderId, fnRequired: true },
    hostRpc: { fixedEventId: HOST_RPC_EVENT_ID, fixedEventIdHex: `0x${HOST_RPC_EVENT_ID.toString(16).toUpperCase()}`,
      mutations: ["#host.textContent", "#host.style.color"] },
  },
  frames: frameRecords,
  contactSheet: "contact-sheet.png",
  note: "Hardware-free reference output; it does not alter renderer-v1, Music, WPM Pet, or any device flash artifact.",
};

await mkdir(output, { recursive: true });
await Promise.all([
  writeFile(path.join(output, "render-v2-events.f2ep"), program.binary),
  writeFile(path.join(output, "render-v2-events.scene.bin"), prepared.sceneBinary),
  writeFile(path.join(output, "render-v2-events.atlas.bin"), atlas.binary),
  writeFile(path.join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`),
  writeFile(path.join(output, "contact-sheet.png"), contactSheetPng(snapshots.map(({ frame }) => frame))),
  ...snapshots.flatMap((snapshot, index) => {
    const prefix = `frame-${String(index).padStart(2, "0")}-${snapshot.name}`;
    return [writeFile(path.join(output, `${prefix}.png`), framePng(snapshot.frame)),
      writeFile(path.join(output, `${prefix}.rgb565`), rgb565FrameToLeBuffer(snapshot.frame))];
  }),
]);

process.stdout.write(`${JSON.stringify({ status: "OFFLINE_RENDER_V2_AUTHORED_COMPILER_PROTOTYPE", output,
  sourceOfTruth: manifest.execution.sourceOfTruth, program: program.manifest, compiler: manifest.compiler,
  budget: manifest.budget, frames: frameRecords, contactSheet: manifest.contactSheet }, null, 2)}\n`);
