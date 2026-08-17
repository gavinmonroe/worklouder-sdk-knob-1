import { createHash } from "node:crypto";

import { decodeRasterAnimation, encodeRasterAnimation } from "../render/raster-animation.mjs";
import { decodeWidgetBundle, encodeWidgetBundle } from "../render/widget-bundle.mjs";
import { WIDGET_SCENE_RPC_LIMITS, WIDGET_SCENE_RPC_PROTOCOL } from "../render/scene-rpc.mjs";
import { inspectRenderV2Program } from "./program.mjs";

export const RENDER_V2_PACKAGE_FORMAT = "framer-render-v2-package-v1";
export const RENDER_V2_GENERIC_ADMISSION_PROFILE = Object.freeze({
  id: "framer-f1-render-v2-structural-v1",
  deviceFamily: "knob_f1",
  firmware: "0.4.1-render-v2-structural",
  packageFormat: RENDER_V2_PACKAGE_FORMAT,
  packageLayout: Object.freeze(["F1WB-v1-one-raster-base", "F2EP-v1"]),
  admission: "complete-canonical-structure-and-resource-validation",
  genericPackages: true,
  sceneStoreBytes: WIDGET_SCENE_RPC_LIMITS.sceneStoreBytes,
  framebufferBytes: WIDGET_SCENE_RPC_LIMITS.framebufferBytes,
  eventKinds: Object.freeze(["tick.100ms", "tick.1s", "input.fn-bottom-knob", "host.rpc"]),
  keyboardKeyEvents: false,
  immutableForRuntime: true,
  deviceEvaluatesJavaScript: false,
});

export const RENDER_V2_CURRENT_DEVICE_PROFILE = Object.freeze({
  id: "framer-f1-0.4.1-live-clock-timer-exact-v1",
  deviceFamily: "knob_f1",
  firmware: "0.4.1",
  packageFormat: "framer-render-v2-focus-timer-package-v2",
  packageBytes: 95_535,
  packageSha256: "5b1b9a068e33b8b09f0596b49df0b7f79e22f05ee1f21ce7939b6c6965753ac7",
  f2ep: Object.freeze([
    Object.freeze({ bytes: 15_178, sha256: "b2eadd5884c6ee3b1546ac50c3c077d16eb384adbf1a82631551e69f93705aed" }),
    Object.freeze({ bytes: 14_618, sha256: "80e7ca2e30a56ca12c29320256884c69cdaef7fea27a6468a0cb54122cad8979" }),
  ]),
  hostRpcEventIds: Object.freeze([0xb201]),
  genericPackages: false,
  oneShotStoreLatch: true,
  rtcOverwritesStateSlot: 0,
  keyboardKeyEvents: false,
  reason: "The currently flashed clock/timer firmware admits one exact four-component package, not arbitrary Input Lab programs.",
});

function invariant(value, message, code = null) {
  if (!value) { const error = new Error(message); if (code) error.code = code; throw error; }
}

function bytes(value, label) {
  invariant(value instanceof Uint8Array, `${label} must be bytes.`);
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

function sha256(value) { return createHash("sha256").update(value).digest("hex"); }

function fitName(value) {
  let output = "";
  for (const scalar of String(value ?? "render-v2").trim()) {
    if (Buffer.byteLength(output + scalar, "utf8") > 16) break;
    output += scalar;
  }
  invariant(output.length > 0, "Render v2 package name cannot be empty.");
  return output;
}

function uint32(value, label) {
  invariant(Number.isInteger(value) && value >= 0 && value <= 0xffffffff, `${label} must be a uint32.`);
  return value;
}

function baseFrameToRaster(value) {
  const binary = bytes(value, "Render v2 base frame");
  invariant(binary.length === WIDGET_SCENE_RPC_LIMITS.framebufferBytes,
    "Render v2 base frame must be exactly 62,000 RGB565-LE bytes.");
  const frame = new Uint16Array(31_000);
  for (let index = 0; index < frame.length; index += 1) frame[index] = binary.readUInt16LE(index * 2);
  return encodeRasterAnimation({ frames: [frame], width: 100, height: 310, fps: 1,
    loopDurationMs: 1_000, maxBytes: 128 * 1024 });
}

function compatibilityDiagnostic(code, message) {
  return Object.freeze({ severity: "error", code, message });
}

export function assessRenderV2PackageCompatibility(packageValue,
  { profile = RENDER_V2_CURRENT_DEVICE_PROFILE } = {}) {
  invariant(profile && typeof profile === "object", "Render v2 target profile must be an object.");
  const inspected = packageValue?.format === RENDER_V2_PACKAGE_FORMAT ? packageValue : decodeRenderV2Package(packageValue);
  const diagnostics = [];
  if (profile.genericPackages !== true) diagnostics.push(compatibilityDiagnostic("RENDER_V2_EXACT_FIRMWARE_PROFILE",
    profile.reason ?? "Target firmware does not advertise structural Render v2 package admission."));
  if (profile.packageFormat !== RENDER_V2_PACKAGE_FORMAT) diagnostics.push(compatibilityDiagnostic(
    "RENDER_V2_PACKAGE_FORMAT_UNSUPPORTED",
    `Target expects ${profile.packageFormat}; compiler emitted ${RENDER_V2_PACKAGE_FORMAT}.`));
  if (inspected.binary.length > (profile.sceneStoreBytes ?? WIDGET_SCENE_RPC_LIMITS.sceneStoreBytes)) {
    diagnostics.push(compatibilityDiagnostic("RENDER_V2_SCENE_STORE_EXCEEDED",
      `Package is ${inspected.binary.length} bytes and exceeds the target scene store.`));
  }
  const hostIds = inspected.program.inspection.handlers.filter(({ kind }) => kind === "host.rpc").map(({ matchId }) => matchId);
  if (Array.isArray(profile.hostRpcEventIds)) for (const id of hostIds) if (!profile.hostRpcEventIds.includes(id)) {
    diagnostics.push(compatibilityDiagnostic("RENDER_V2_HOST_RPC_ID_UNSUPPORTED",
      `Target firmware does not admit host RPC event 0x${id.toString(16).toUpperCase()}.`));
  }
  return Object.freeze({ profileId: profile.id, deviceDeployable: diagnostics.length === 0,
    diagnostics: Object.freeze(diagnostics), packageBytes: inspected.binary.length,
    packageSha256: inspected.sha256, requiredCapability: RENDER_V2_GENERIC_ADMISSION_PROFILE.id });
}

export function buildRenderV2Package(linked, { name = "render-v2", generation = 1 } = {}) {
  invariant(linked?.format === "framer-render-v2-linked-v1" && linked.program?.binary instanceof Uint8Array,
    "Render v2 packaging requires linked compiler output.");
  uint32(generation, "Render v2 package generation");
  const animation = baseFrameToRaster(linked.baseFrame);
  const bundle = encodeWidgetBundle({ generation, activeSlot: 0,
    slots: [{ name: fitName(name), kind: "raster", animationBinary: animation.binary }] });
  const programBinary = bytes(linked.program.binary, "Render v2 F2EP");
  const inspection = inspectRenderV2Program(programBinary);
  invariant(inspection.sha256 === linked.program.sha256,
    "Render v2 linked program digest differs from its structurally inspected bytes.");
  const binary = Buffer.concat([bundle.binary, programBinary]);
  invariant(binary.length <= WIDGET_SCENE_RPC_LIMITS.sceneStoreBytes,
    `Render v2 package is ${binary.length} bytes; scene-store cap is ${WIDGET_SCENE_RPC_LIMITS.sceneStoreBytes}.`,
  "RENDER_V2_PACKAGE_OVERSIZE");
  const digest = sha256(binary);
  const metadata = { format: RENDER_V2_PACKAGE_FORMAT, generation, name: fitName(name), sha256: digest,
    bundle: Object.freeze({ format: "F1WB", offset: 0, bytes: bundle.binary.length, sha256: bundle.sha256,
      generation, animationBytes: animation.binary.length, animationSha256: animation.sha256 }),
    program: Object.freeze({ format: "F2EP", offset: bundle.binary.length, bytes: programBinary.length,
      sha256: inspection.sha256, inspection }),
    budget: Object.freeze({ packageBytes: binary.length, sceneStoreBytes: WIDGET_SCENE_RPC_LIMITS.sceneStoreBytes,
      sceneStoreHeadroomBytes: WIDGET_SCENE_RPC_LIMITS.sceneStoreBytes - binary.length,
      framebufferBytes: WIDGET_SCENE_RPC_LIMITS.framebufferBytes, additionalFramebufferBytes: 0,
      ...linked.budget }),
    execution: Object.freeze({ authoredJavaScript: "statically-compiled-safe-subset",
      deviceRuntime: "bounded-F2EP-v1", deviceEvaluatesJavaScript: false, deviceRunsJsdom: false }) };
  const inspectable = Object.freeze({ ...metadata, binary, get baseFrame() { return Buffer.from(linked.baseFrame); } });
  const compatibility = Object.freeze({
    currentDevice: assessRenderV2PackageCompatibility(inspectable, { profile: RENDER_V2_CURRENT_DEVICE_PROFILE }),
    structuralV1: assessRenderV2PackageCompatibility(inspectable, { profile: RENDER_V2_GENERIC_ADMISSION_PROFILE }),
  });
  return Object.freeze({ ...metadata, compatibility,
    get binary() { return Buffer.from(binary); }, get f1wb() { return Buffer.from(bundle.binary); },
    get f2ep() { return Buffer.from(programBinary); }, get baseFrame() { return Buffer.from(linked.baseFrame); } });
}

export function decodeRenderV2Package(value) {
  const binary = bytes(value?.binary ?? value, "Render v2 package");
  invariant(binary.length >= 332 + 64 && binary.subarray(0, 4).toString("ascii") === "F1WB",
    "Render v2 package is truncated or lacks its F1WB prefix.");
  invariant(binary.length <= WIDGET_SCENE_RPC_LIMITS.sceneStoreBytes,
    `Render v2 package exceeds the ${WIDGET_SCENE_RPC_LIMITS.sceneStoreBytes}-byte scene store.`,
  "RENDER_V2_PACKAGE_OVERSIZE");
  const bundleBytes = binary.readUInt32LE(12);
  invariant(bundleBytes >= 332 && bundleBytes < binary.length,
    "Render v2 package F1WB prefix length is invalid.");
  const decodedBundle = decodeWidgetBundle(binary.subarray(0, bundleBytes));
  invariant(decodedBundle.slots.length === 1 && decodedBundle.activeSlot === 0 &&
    decodedBundle.slots[0].kind === "raster", "Render v2 package requires one active raster base slot.");
  const animation = decodeRasterAnimation(decodedBundle.slots[0].animationBinary);
  invariant(animation.width === 100 && animation.height === 310 && animation.frames.length === 1 &&
    animation.frames[0].length === 31_000,
  "Render v2 package base F1RA must contain exactly one full 100x310 frame.");
  const programBinary = binary.subarray(bundleBytes);
  const inspection = inspectRenderV2Program(programBinary);
  invariant(inspection.bytes === programBinary.length, "Render v2 package F2EP length is invalid.");
  const baseFrame = Buffer.alloc(WIDGET_SCENE_RPC_LIMITS.framebufferBytes);
  animation.frames[0].forEach((color, index) => baseFrame.writeUInt16LE(color, index * 2));
  const digest = sha256(binary);
  return Object.freeze({ format: RENDER_V2_PACKAGE_FORMAT, generation: decodedBundle.generation,
    name: decodedBundle.slots[0].name, sha256: digest,
    bundle: Object.freeze({ format: "F1WB", offset: 0, bytes: bundleBytes,
      sha256: decodedBundle.sha256, generation: decodedBundle.generation,
      animationBytes: animation.binary.length, animationSha256: animation.sha256 }),
    program: Object.freeze({ format: "F2EP", offset: bundleBytes, bytes: programBinary.length,
      sha256: inspection.sha256, inspection }),
    budget: Object.freeze({ packageBytes: binary.length, sceneStoreBytes: WIDGET_SCENE_RPC_LIMITS.sceneStoreBytes,
      sceneStoreHeadroomBytes: WIDGET_SCENE_RPC_LIMITS.sceneStoreBytes - binary.length,
      framebufferBytes: WIDGET_SCENE_RPC_LIMITS.framebufferBytes, additionalFramebufferBytes: 0,
      ...inspection.resources }),
    execution: Object.freeze({ authoredJavaScript: "statically-compiled-safe-subset",
      deviceRuntime: "bounded-F2EP-v1", deviceEvaluatesJavaScript: false, deviceRunsJsdom: false }),
    get binary() { return Buffer.from(binary); }, get f1wb() { return Buffer.from(binary.subarray(0, bundleBytes)); },
    get f2ep() { return Buffer.from(programBinary); }, get baseFrame() { return Buffer.from(baseFrame); } });
}

export function renderV2PackageAtGeneration(value, generation) {
  uint32(generation, "Render v2 package generation");
  const decoded = decodeRenderV2Package(value);
  const bundle = decodeWidgetBundle(decoded.f1wb);
  const rebuilt = encodeWidgetBundle({ generation, activeSlot: 0,
    slots: [{ name: bundle.slots[0].name, kind: "raster", animationBinary: bundle.slots[0].animationBinary }] });
  return decodeRenderV2Package(Buffer.concat([rebuilt.binary, decoded.f2ep]));
}

export function createRenderV2PackageUpload(value, { expectedGeneration,
  profile = RENDER_V2_GENERIC_ADMISSION_PROFILE } = {}) {
  uint32(expectedGeneration, "Render v2 expected generation");
  invariant(expectedGeneration < 0xffffffff, "Render v2 generation cannot advance past uint32.");
  invariant(profile?.genericPackages === true && profile.packageFormat === RENDER_V2_PACKAGE_FORMAT,
    "Target does not advertise generic structural Render v2 admission.", "RENDER_V2_DEVICE_ADMISSION_UNAVAILABLE");
  const packageValue = renderV2PackageAtGeneration(value, expectedGeneration + 1);
  const compatibility = assessRenderV2PackageCompatibility(packageValue, { profile });
  invariant(compatibility.deviceDeployable, compatibility.diagnostics.map(({ message }) => message).join(" "),
    "RENDER_V2_DEVICE_INCOMPATIBLE");
  const totalChunks = Math.ceil(packageValue.binary.length / WIDGET_SCENE_RPC_LIMITS.chunkRawBytes);
  invariant(totalChunks >= 1 && totalChunks <= WIDGET_SCENE_RPC_LIMITS.maxChunks,
    "Render v2 package exceeds the scene RPC chunk cap.");
  const transactionId = `f2pk-${packageValue.generation.toString(16).padStart(8, "0")}-${packageValue.sha256.slice(0, 16)}`;
  const common = Object.freeze({ protocol: WIDGET_SCENE_RPC_PROTOCOL, transactionId,
    expectedGeneration, generation: packageValue.generation, totalBytes: packageValue.binary.length,
    totalChunks, chunkRawBytes: WIDGET_SCENE_RPC_LIMITS.chunkRawBytes, sha256: packageValue.sha256,
    renderV2Profile: profile.id });
  const chunks = Object.freeze(Array.from({ length: totalChunks }, (_, index) => {
    const offset = index * WIDGET_SCENE_RPC_LIMITS.chunkRawBytes;
    const chunk = packageValue.binary.subarray(offset,
      Math.min(packageValue.binary.length, offset + WIDGET_SCENE_RPC_LIMITS.chunkRawBytes));
    return Object.freeze({ protocol: WIDGET_SCENE_RPC_PROTOCOL, transactionId, generation: packageValue.generation,
      index, offset, bytes: chunk.length, chunkSha256: sha256(chunk), data: chunk.toString("base64") });
  }));
  return Object.freeze({ package: packageValue, compatibility, manifest: common, chunks,
    commit: Object.freeze({ protocol: WIDGET_SCENE_RPC_PROTOCOL, transactionId, expectedGeneration,
      generation: packageValue.generation, totalBytes: packageValue.binary.length, totalChunks,
      sha256: packageValue.sha256, renderV2Profile: profile.id }) });
}
