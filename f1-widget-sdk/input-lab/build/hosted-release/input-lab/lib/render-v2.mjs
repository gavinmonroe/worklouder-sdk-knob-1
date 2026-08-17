import { createHash } from "node:crypto";

import { compileRenderV2Widget, createRenderV2Runtime, RENDER_V2_CURRENT_DEVICE_PROFILE,
  RENDER_V2_GENERIC_ADMISSION_PROFILE } from "../../src/render-v2/index.mjs";
import { createInputLabGlyphAtlas } from "./compiler.mjs";
import { compileInputLabRenderV2Raster, INPUT_LAB_RENDER_V2_RASTER_LIMITS,
  INPUT_LAB_RENDER_V2_RASTER_MUTATION_ISOLATION } from "./render-v2-raster.mjs";

export const INPUT_LAB_RENDER_V2_FORMAT = "framer-input-lab-render-v2-compilation-v1";
export const INPUT_LAB_RENDER_V2_MAX_EVENTS = 64;
export const INPUT_LAB_RENDER_V2_CAPABILITIES = Object.freeze({
  compiler: true,
  simulator: true,
  packageFormat: "framer-render-v2-package-v1",
  genericAdmissionProfile: RENDER_V2_GENERIC_ADMISSION_PROFILE.id,
  currentDeviceProfile: RENDER_V2_CURRENT_DEVICE_PROFILE.id,
  eventKinds: Object.freeze(["tick.100ms", "tick.1s", "input.fn-bottom-knob", "host.rpc"]),
  keyboardKeyEvents: false,
  maxReplayEvents: INPUT_LAB_RENDER_V2_MAX_EVENTS,
  renderModes: Object.freeze(["auto", "semantic", "raster"]),
  chromiumRaster: Object.freeze({ supported: true, exactViewport: Object.freeze({ width: 100, height: 310 }),
    maxBindings: INPUT_LAB_RENDER_V2_RASTER_LIMITS.maxBindings,
    maxVariants: INPUT_LAB_RENDER_V2_RASTER_LIMITS.maxVariants,
    mutationIsolation: INPUT_LAB_RENDER_V2_RASTER_MUTATION_ISOLATION,
    userJavaScriptExecuted: false, layoutReflow: false }),
  deviceEvaluatesJavaScript: false,
  deviceRunsJsdom: false,
});

function invariant(value, message, code = null) {
  if (!value) { const error = new Error(message); if (code) error.code = code; throw error; }
}

function bytesSha256(value) { return createHash("sha256").update(value).digest("hex"); }

function stateOf(linked) { return Object.freeze({ ...linked.spec.state }); }

function compactManifest(compilation) {
  const { manifest, package: packageValue } = compilation;
  return Object.freeze({ format: manifest.format, sha256: manifest.sha256, source: manifest.source,
    execution: manifest.execution, scene: manifest.scene,
    program: Object.freeze({ format: packageValue.program.format, bytes: packageValue.program.bytes,
      sha256: packageValue.program.sha256, structurallyAdmitted: packageValue.program.inspection.structurallyAdmitted,
      resources: packageValue.program.inspection.resources,
      handlers: packageValue.program.inspection.handlers.map(({ kind, matchId, instructions }) =>
        Object.freeze({ kind, matchId, instructions })) }),
    package: Object.freeze({ format: packageValue.format, bytes: packageValue.binary.length,
      sha256: packageValue.sha256, layout: Object.freeze(["F1WB", "F2EP"]) }),
    budget: packageValue.budget,
    compatibility: packageValue.compatibility });
}

function pushStatus(packageValue) {
  const compatibility = packageValue.compatibility.currentDevice;
  return Object.freeze({ supported: compatibility.deviceDeployable, deviceDeployable: compatibility.deviceDeployable,
    activeProfile: compatibility.profileId, requiredProfile: RENDER_V2_GENERIC_ADMISSION_PROFILE.id,
    packageFormat: packageValue.format,
    reason: compatibility.deviceDeployable ? null : RENDER_V2_CURRENT_DEVICE_PROFILE.reason,
    diagnostics: compatibility.diagnostics });
}

export async function compileInputLabRenderV2({ html, css, script, rootClass = "render-v2",
  name = "render-v2", generation = 1, renderMode = "auto" } = {},
{ atlasFactory = createInputLabGlyphAtlas, captureProvider } = {}) {
  invariant(["auto", "semantic", "raster"].includes(renderMode),
    "Render v2 renderMode must be auto, semantic, or raster.", "RENDER_V2_MODE_INVALID");
  let compilation;
  let resolvedRenderMode;
  if (renderMode !== "raster") {
    try {
      compilation = await compileRenderV2Widget({ html, css, script, rootClass, name, generation, atlasFactory });
      resolvedRenderMode = "semantic";
    } catch (semanticError) {
      if (renderMode === "semantic") throw semanticError;
      try {
        compilation = await compileInputLabRenderV2Raster({ html, css, script, rootClass, name, generation },
          { captureProvider });
        resolvedRenderMode = "raster";
      } catch (rasterError) {
        if (!rasterError.cause) Object.defineProperty(rasterError, "cause", { value: semanticError });
        throw rasterError;
      }
    }
  } else {
    compilation = await compileInputLabRenderV2Raster({ html, css, script, rootClass, name, generation },
      { captureProvider });
    resolvedRenderMode = "raster";
  }
  return Object.freeze({ format: INPUT_LAB_RENDER_V2_FORMAT, mode: "render-v2",
    renderMode: resolvedRenderMode, requestedRenderMode: renderMode, compilation,
    frame: Buffer.from(compilation.linked.baseFrame), state: stateOf(compilation.linked),
    changedPixels: 0, generation: 0, eventsApplied: 0 });
}

function normalizeEvent(value, index) {
  invariant(value && typeof value === "object" && !Array.isArray(value),
    `Render v2 event ${index} must be an object.`);
  const allowedKeys = new Set(["kind", "flags", "id", "value", "sequence"]);
  invariant(Object.keys(value).every((key) => allowedKeys.has(key)),
    `Render v2 event ${index} contains an unsupported field.`);
  if (value.kind === "input.key" || String(value.kind).startsWith("input.key:")) {
    invariant(false, "F2EP v1 has no on-device keyboard-key event; use a declared host.rpc event only for host-originated input.",
      "RENDER_V2_KEY_EVENTS_UNSUPPORTED");
  }
  invariant(INPUT_LAB_RENDER_V2_CAPABILITIES.eventKinds.includes(value.kind),
    `Render v2 event ${index} kind is unsupported.`);
  const event = { kind: value.kind, flags: value.flags ?? 0, id: value.id ?? 0,
    value: value.value ?? (value.kind.startsWith("tick.") ? 1 : 0), sequence: value.sequence ?? index + 1 };
  invariant(Number.isInteger(event.flags) && event.flags >= 0 && event.flags <= 1,
    `Render v2 event ${index} flags must reserve every bit except Fn bit zero.`);
  invariant(Number.isInteger(event.id) && event.id >= 0 && event.id <= 0xffff,
    `Render v2 event ${index} id must be a uint16.`);
  invariant(Number.isInteger(event.value) && event.value >= -0x80000000 && event.value <= 0x7fffffff,
    `Render v2 event ${index} value must be an int32.`);
  invariant(Number.isInteger(event.sequence) && event.sequence >= 0 && event.sequence <= 0xffffffff,
    `Render v2 event ${index} sequence must be a uint32.`);
  if (value.kind === "tick.100ms" || value.kind === "tick.1s") {
    invariant(event.flags === 0 && event.id === 0 && event.value === 1,
      "Tick simulation requires native-canonical flags=0, id=0, and value=1.");
  }
  if (value.kind === "input.fn-bottom-knob") {
    invariant(event.flags === 1 && event.id === 1 && event.value >= -128 && event.value <= 127 &&
      event.value !== 0,
    "Fn+bottom-knob simulation requires flags=1, encoder id=1, and a nonzero signed-int8 delta.");
  }
  if (value.kind === "host.rpc") invariant(event.flags === 0 && event.id >= 1,
    "Host RPC simulation requires flags=0 and an event id in 1..65535.");
  return Object.freeze(event);
}

export function replayInputLabRenderV2(compiled, events = []) {
  invariant(compiled?.format === INPUT_LAB_RENDER_V2_FORMAT && compiled.compilation?.linked,
    "Render v2 replay requires a compiled Input Lab result.", "RENDER_V2_REPLAY_INVALID");
  invariant(Array.isArray(events) && events.length <= INPUT_LAB_RENDER_V2_MAX_EVENTS,
    `Render v2 simulation accepts at most ${INPUT_LAB_RENDER_V2_MAX_EVENTS} replay events.`,
  "RENDER_V2_EVENT_HISTORY_OVERSIZE");
  const runtime = createRenderV2Runtime(compiled.compilation.linked);
  let result = null;
  events.forEach((event, index) => { result = runtime.dispatch(normalizeEvent(event, index)); });
  return Object.freeze({ ...compiled, frame: result ? result.frame : runtime.frame,
    state: result?.state ?? compiled.state, changedPixels: result?.changedPixels ?? 0,
    generation: result?.generation ?? 0, eventsApplied: events.length });
}

export async function simulateInputLabRenderV2({ events = [], ...source } = {}, options = {}) {
  const compiled = await compileInputLabRenderV2(source, options);
  return replayInputLabRenderV2(compiled, events);
}

export function serializeInputLabRenderV2(value) {
  invariant(value?.format === INPUT_LAB_RENDER_V2_FORMAT && value.compilation?.package,
    "Input Lab Render v2 result is invalid.");
  const packageValue = value.compilation.package;
  const frame = Buffer.from(value.frame);
  return Object.freeze({ format: INPUT_LAB_RENDER_V2_FORMAT, mode: "render-v2",
    renderMode: value.renderMode, requestedRenderMode: value.requestedRenderMode,
    renderSource: value.compilation.linked.renderSource,
    rasterProof: value.compilation.rasterProof ?? null,
    sha256: value.compilation.sha256, packageBytes: packageValue.binary.length,
    packageBase64: packageValue.binary.toString("base64"), programBytes: packageValue.program.bytes,
    programSha256: packageValue.program.sha256, baseFrameBase64: packageValue.baseFrame.toString("base64"),
    frameBase64: frame.toString("base64"), frameSha256: bytesSha256(frame), state: value.state,
    changedPixels: value.changedPixels, generation: value.generation, eventsApplied: value.eventsApplied,
    budget: packageValue.budget, manifest: compactManifest(value.compilation), push: pushStatus(packageValue) });
}
