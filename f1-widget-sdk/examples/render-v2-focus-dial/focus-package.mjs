import { createHash } from "node:crypto";

import { encodeRasterAnimation } from "../../src/render/raster-animation.mjs";
import { decodeWidgetBundle, encodeWidgetBundle } from "../../src/render/widget-bundle.mjs";
import { WIDGET_SCENE_RPC_METHODS, WIDGET_SCENE_RPC_PROTOCOL,
  WIDGET_SCENE_RPC_LIMITS } from "../../src/render/scene-rpc.mjs";

export const FOCUS_DIAL_PACKAGE = Object.freeze({
  format: "framer-render-v2-focus-package-v1",
  viewport: Object.freeze({ width: 100, height: 310, frameBytes: 62_000 }),
  slotName: "focus-dial",
  f1raBytes: 62_072,
  f1raSha256: "4de389c225407bc3d616b0f86cfbe2cb645bda0cb989c5785addff67d72028c7",
  f1wbBytes: 62_404,
  generationOneF1wbSha256: "fa5580257a2432301acfe87434f277493e3d1a8fd8470d793b8bd9ce66850b18",
  f2epBytes: 15_178,
  f2epSha256: "b2eadd5884c6ee3b1546ac50c3c077d16eb384adbf1a82631551e69f93705aed",
  packageBytes: 77_582,
  generationOnePackageSha256: "06751e0349538d4fc3ded27361f1b90260910513987e4f8f986f9e4e3915cf65",
});

function invariant(value, message, code) {
  if (!value) { const error = new Error(message); if (code) error.code = code; throw error; }
}

function bytes(value, label) {
  invariant(value instanceof Uint8Array, `${label} must be bytes.`);
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

function sha256(value) { return createHash("sha256").update(value).digest("hex"); }

function uint32(value, label) {
  invariant(Number.isInteger(value) && value >= 0 && value <= 0xffffffff,
    `${label} must be a uint32.`);
  return value;
}

export function buildFocusDialPackage({ baseFrame, f2ep, generation = 1 } = {}) {
  const frameBytes = bytes(baseFrame, "Focus-dial base frame");
  const program = bytes(f2ep, "Focus-dial F2EP");
  uint32(generation, "Focus-dial generation");
  invariant(frameBytes.length === FOCUS_DIAL_PACKAGE.viewport.frameBytes &&
    sha256(frameBytes) === "5d154baeb898d090d2b0382cd5209078f5a2b5d047127dbb9a22d109083cbac6",
  "Focus-dial base frame differs from the frozen RGB565 source.");
  invariant(program.length === FOCUS_DIAL_PACKAGE.f2epBytes &&
    sha256(program) === FOCUS_DIAL_PACKAGE.f2epSha256,
  "Focus-dial F2EP differs from the frozen event program.");
  const frame = new Uint16Array(31_000);
  for (let index = 0; index < frame.length; index += 1) frame[index] = frameBytes.readUInt16LE(index * 2);
  const animation = encodeRasterAnimation({ frames: [frame], width: 100, height: 310,
    fps: 1, loopDurationMs: 1_000, maxBytes: 128 * 1_024 });
  invariant(animation.binary.length === FOCUS_DIAL_PACKAGE.f1raBytes &&
    animation.sha256 === FOCUS_DIAL_PACKAGE.f1raSha256,
  "Focus-dial one-frame F1RA changed.");
  const bundle = encodeWidgetBundle({ generation, activeSlot: 0,
    slots: [{ name: FOCUS_DIAL_PACKAGE.slotName, kind: "raster", animationBinary: animation.binary }] });
  invariant(bundle.binary.length === FOCUS_DIAL_PACKAGE.f1wbBytes,
    "Focus-dial one-slot F1WB size changed.");
  const binary = Buffer.concat([bundle.binary, program]);
  invariant(binary.length === FOCUS_DIAL_PACKAGE.packageBytes,
    "Focus-dial composite exceeds its frozen scene-store layout.");
  if (generation === 1) invariant(bundle.sha256 === FOCUS_DIAL_PACKAGE.generationOneF1wbSha256 &&
    sha256(binary) === FOCUS_DIAL_PACKAGE.generationOnePackageSha256,
  "Focus-dial generation-one package hash changed.");
  return Object.freeze({ format: FOCUS_DIAL_PACKAGE.format, generation,
    bundle: Object.freeze({ ...bundle, binary: Buffer.from(bundle.binary) }),
    f2ep: Buffer.from(program), binary, sha256: sha256(binary) });
}

export function focusDialPackageAtGeneration(value, generation) {
  invariant(value?.format === FOCUS_DIAL_PACKAGE.format && value.bundle?.binary && value.f2ep,
    "Focus-dial package template is invalid.");
  const decoded = decodeWidgetBundle(bytes(value.bundle.binary, "Focus-dial F1WB"));
  invariant(decoded.slots.length === 1 && decoded.slots[0].kind === "raster" &&
    decoded.slots[0].name === FOCUS_DIAL_PACKAGE.slotName &&
    decoded.slots[0].animationBinary.length === FOCUS_DIAL_PACKAGE.f1raBytes &&
    sha256(decoded.slots[0].animationBinary) === FOCUS_DIAL_PACKAGE.f1raSha256,
  "Focus-dial package lost its exact raster slot.");
  const rebuilt = encodeWidgetBundle({ generation: uint32(generation, "Focus-dial generation"), activeSlot: 0,
    slots: [{ name: decoded.slots[0].name, kind: "raster",
      animationBinary: decoded.slots[0].animationBinary }] });
  const f2ep = bytes(value.f2ep, "Focus-dial F2EP");
  invariant(rebuilt.binary.length === FOCUS_DIAL_PACKAGE.f1wbBytes &&
    sha256(rebuilt.binary.subarray(332)) === sha256(decoded.binary.subarray(332)) &&
    f2ep.length === FOCUS_DIAL_PACKAGE.f2epBytes && sha256(f2ep) === FOCUS_DIAL_PACKAGE.f2epSha256,
  "Focus-dial generation rewrite changed immutable payload bytes.");
  const binary = Buffer.concat([rebuilt.binary, f2ep]);
  return Object.freeze({ format: FOCUS_DIAL_PACKAGE.format, generation,
    bundle: Object.freeze({ ...rebuilt, binary: Buffer.from(rebuilt.binary) }),
    f2ep: Buffer.from(f2ep), binary, sha256: sha256(binary) });
}

export function createFocusDialPackageUpload(value, { expectedGeneration } = {}) {
  uint32(expectedGeneration, "Focus-dial expected generation");
  invariant(expectedGeneration < 0xffffffff, "Focus-dial generation cannot advance past uint32.");
  const generation = expectedGeneration + 1;
  const packageValue = focusDialPackageAtGeneration(value, generation);
  const totalChunks = Math.ceil(packageValue.binary.length / WIDGET_SCENE_RPC_LIMITS.chunkRawBytes);
  invariant(packageValue.binary.length <= WIDGET_SCENE_RPC_LIMITS.maxBundleBytes &&
    totalChunks <= WIDGET_SCENE_RPC_LIMITS.maxChunks,
  "Focus-dial package exceeds the existing scene-store transport cap.");
  const transactionId = `f2pk-${generation.toString(16).padStart(8, "0")}-${packageValue.sha256.slice(0, 16)}`;
  const common = { protocol: WIDGET_SCENE_RPC_PROTOCOL, transactionId, expectedGeneration, generation,
    totalBytes: packageValue.binary.length, totalChunks,
    chunkRawBytes: WIDGET_SCENE_RPC_LIMITS.chunkRawBytes, sha256: packageValue.sha256 };
  const chunks = Object.freeze(Array.from({ length: totalChunks }, (_, index) => {
    const offset = index * WIDGET_SCENE_RPC_LIMITS.chunkRawBytes;
    const chunk = packageValue.binary.subarray(offset,
      Math.min(packageValue.binary.length, offset + WIDGET_SCENE_RPC_LIMITS.chunkRawBytes));
    return Object.freeze({ protocol: WIDGET_SCENE_RPC_PROTOCOL, transactionId, generation, index, offset,
      bytes: chunk.length, chunkSha256: sha256(chunk), data: chunk.toString("base64") });
  }));
  return Object.freeze({ package: packageValue, manifest: Object.freeze(common), chunks,
    commit: Object.freeze({ protocol: WIDGET_SCENE_RPC_PROTOCOL, transactionId, expectedGeneration,
      generation, totalBytes: packageValue.binary.length, totalChunks, sha256: packageValue.sha256 }) });
}

function statusOnly(response, operation) {
  if (!(response && typeof response === "object" && !Array.isArray(response) &&
      Object.keys(response).length === 1 && ["ok", "error"].includes(response.status))) {
    const error = new Error(`Focus-dial ${operation} returned a non-status-only response.`);
    error.code = "FOCUS_PACKAGE_RPC_INDETERMINATE"; error.rpcResponse = response; throw error;
  }
  if (response.status !== "ok") {
    const error = new Error(`Focus-dial ${operation} was rejected.`);
    error.code = "FOCUS_PACKAGE_RPC_REJECTED"; error.rpcResponse = response; throw error;
  }
  return response;
}

export async function publishFocusDialPackageSmoke({ package: packageValue, rpc,
  expectedGeneration, onProgress = null } = {}) {
  invariant(typeof rpc === "function", "Focus-dial publisher requires rpc().");
  invariant(onProgress === null || typeof onProgress === "function",
    "Focus-dial progress callback must be a function.");
  const upload = createFocusDialPackageUpload(packageValue, { expectedGeneration });
  let begun = false;
  try {
    statusOnly(await rpc(WIDGET_SCENE_RPC_METHODS.begin, upload.manifest), "begin"); begun = true;
    onProgress?.({ stage: "uploading-chunks", current: 0, total: upload.chunks.length });
    for (const chunk of upload.chunks) {
      statusOnly(await rpc(WIDGET_SCENE_RPC_METHODS.write, chunk), `chunk ${chunk.index}`);
      onProgress?.({ stage: "uploading-chunks", current: chunk.index + 1, total: upload.chunks.length });
    }
    onProgress?.({ stage: "applying-on-keyboard" });
    statusOnly(await rpc(WIDGET_SCENE_RPC_METHODS.commit, upload.commit), "commit");
    return Object.freeze({ status: "FOCUS_DIAL_PACKAGE_COMMIT_ACKNOWLEDGED",
      generation: upload.commit.generation, bytes: upload.commit.totalBytes,
      chunks: upload.commit.totalChunks, sha256: upload.commit.sha256 });
  } catch (error) {
    if (begun && error.code !== "FOCUS_PACKAGE_RPC_INDETERMINATE") {
      await rpc(WIDGET_SCENE_RPC_METHODS.abort, { protocol: WIDGET_SCENE_RPC_PROTOCOL,
        transactionId: upload.manifest.transactionId, generation: upload.manifest.generation }).catch(() => {});
    }
    throw error;
  }
}
