import { createHash } from "node:crypto";

import { decodeWidgetBundle, encodeWidgetBundle } from "../../src/render/widget-bundle.mjs";
import { WIDGET_SCENE_RPC_LIMITS, WIDGET_SCENE_RPC_METHODS,
  WIDGET_SCENE_RPC_PROTOCOL } from "../../src/render/scene-rpc.mjs";

export const FOCUS_TIMER_PACKAGE = Object.freeze({
  format: "framer-render-v2-focus-timer-package-v2",
  expectedGeneration: 1,
  generation: 2,
  f1wbBytes: 62_404,
  generationOneF1wbSha256: "fa5580257a2432301acfe87434f277493e3d1a8fd8470d793b8bd9ce66850b18",
  generationTwoF1wbSha256: "e518d8c0a528f37961a88fcc2664e6abd90fce5a0f33138c75a2256a58683254",
  focusF2epBytes: 15_178,
  focusF2epSha256: "b2eadd5884c6ee3b1546ac50c3c077d16eb384adbf1a82631551e69f93705aed",
  timerF2epBytes: 14_618,
  timerF2epSha256: "80e7ca2e30a56ca12c29320256884c69cdaef7fea27a6468a0cb54122cad8979",
  timerBaseLzssBytes: 3_335,
  timerBaseLzssSha256: "cae1a0903e8b9ec09880dee05652a354b420cd5966d10b28c0382e40c0427307",
  packageBytes: 95_535,
  generationOnePackageSha256: "c7a49c9f7a4f709692299cff9239b9f5e0d9cc0c946efc948d3c54b54b1f5102",
  generationTwoPackageSha256: "5b1b9a068e33b8b09f0596b49df0b7f79e22f05ee1f21ce7939b6c6965753ac7",
  chunks: 32,
  sceneStoreBytes: 98_304,
});

function invariant(value, message, code) {
  if (!value) { const error = new Error(message); if (code) error.code = code; throw error; }
}

function bytes(value, label) {
  invariant(value instanceof Uint8Array, `${label} must be bytes.`);
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

function sha256(value) { return createHash("sha256").update(value).digest("hex"); }

export function buildFocusTimerPackage({ focusF1wb, focusF2ep, timerF2ep, timerBaseLzss,
  generation = FOCUS_TIMER_PACKAGE.generation } = {}) {
  invariant(generation === 1 || generation === 2,
    "Focus-timer package generation must be the boot template 1 or one-shot live generation 2.");
  const template = bytes(focusF1wb, "Focus F1WB");
  const focusProgram = bytes(focusF2ep, "Focus F2EP");
  const timerProgram = bytes(timerF2ep, "Timer F2EP");
  const timerBase = bytes(timerBaseLzss, "Timer blue-base LZSS");
  invariant(template.length === FOCUS_TIMER_PACKAGE.f1wbBytes &&
    sha256(template) === FOCUS_TIMER_PACKAGE.generationOneF1wbSha256,
  "Focus-timer F1WB differs from the frozen generation-one clock raster.");
  invariant(focusProgram.length === FOCUS_TIMER_PACKAGE.focusF2epBytes &&
    sha256(focusProgram) === FOCUS_TIMER_PACKAGE.focusF2epSha256,
  "Focus-timer clock F2EP differs from the frozen program.");
  invariant(timerProgram.length === FOCUS_TIMER_PACKAGE.timerF2epBytes &&
    sha256(timerProgram) === FOCUS_TIMER_PACKAGE.timerF2epSha256,
  "Focus-timer timer F2EP differs from the frozen program.");
  invariant(timerBase.length === FOCUS_TIMER_PACKAGE.timerBaseLzssBytes &&
    sha256(timerBase) === FOCUS_TIMER_PACKAGE.timerBaseLzssSha256,
  "Focus-timer blue switch-base differs from the frozen LZSS stream.");
  const decoded = decodeWidgetBundle(template);
  invariant(decoded.generation === 1 && decoded.activeSlot === 0 && decoded.slots.length === 1 &&
    decoded.slots[0].kind === "raster" && decoded.slots[0].name === "focus-dial",
  "Focus-timer F1WB lost its exact one-slot clock raster layout.");
  const bundle = generation === 1 ? { binary: Buffer.from(template), sha256: sha256(template) } :
    encodeWidgetBundle({ generation, activeSlot: decoded.activeSlot,
      slots: decoded.slots.map((slot) => ({ name: slot.name, kind: slot.kind,
        animationBinary: slot.animationBinary })) });
  const expectedBundleSha = generation === 1 ? FOCUS_TIMER_PACKAGE.generationOneF1wbSha256 :
    FOCUS_TIMER_PACKAGE.generationTwoF1wbSha256;
  invariant(bundle.binary.length === FOCUS_TIMER_PACKAGE.f1wbBytes &&
    bundle.sha256 === expectedBundleSha &&
    bundle.binary.subarray(332).equals(template.subarray(332)),
  "Focus-timer generation rewrite changed immutable F1WB payload bytes.");
  const binary = Buffer.concat([bundle.binary, focusProgram, timerProgram, timerBase]);
  const expectedPackageSha = generation === 1 ? FOCUS_TIMER_PACKAGE.generationOnePackageSha256 :
    FOCUS_TIMER_PACKAGE.generationTwoPackageSha256;
  invariant(binary.length === FOCUS_TIMER_PACKAGE.packageBytes && sha256(binary) === expectedPackageSha,
    "Focus-timer composite package bytes changed.");
  return Object.freeze({ format: FOCUS_TIMER_PACKAGE.format, generation,
    f1wb: Buffer.from(bundle.binary), focusF2ep: Buffer.from(focusProgram),
    timerF2ep: Buffer.from(timerProgram), timerBaseLzss: Buffer.from(timerBase),
    binary, sha256: expectedPackageSha });
}

export function createFocusTimerPackageUpload(packageValue) {
  invariant(packageValue?.format === FOCUS_TIMER_PACKAGE.format &&
    packageValue.generation === FOCUS_TIMER_PACKAGE.generation &&
    packageValue.binary instanceof Uint8Array &&
    packageValue.binary.length === FOCUS_TIMER_PACKAGE.packageBytes &&
    sha256(packageValue.binary) === FOCUS_TIMER_PACKAGE.generationTwoPackageSha256,
  "Focus-timer live upload requires the exact generation-two composite.");
  const totalChunks = Math.ceil(packageValue.binary.length / WIDGET_SCENE_RPC_LIMITS.chunkRawBytes);
  invariant(packageValue.binary.length <= WIDGET_SCENE_RPC_LIMITS.maxBundleBytes &&
    totalChunks === FOCUS_TIMER_PACKAGE.chunks && totalChunks <= WIDGET_SCENE_RPC_LIMITS.maxChunks,
  "Focus-timer composite exceeds the exact scene-store transport bounds.");
  const transactionId = `f2pt-00000002-${packageValue.sha256.slice(0, 16)}`;
  const common = Object.freeze({ protocol: WIDGET_SCENE_RPC_PROTOCOL, transactionId,
    expectedGeneration: FOCUS_TIMER_PACKAGE.expectedGeneration,
    generation: FOCUS_TIMER_PACKAGE.generation, totalBytes: packageValue.binary.length,
    totalChunks, chunkRawBytes: WIDGET_SCENE_RPC_LIMITS.chunkRawBytes,
    sha256: packageValue.sha256 });
  const chunks = Object.freeze(Array.from({ length: totalChunks }, (_, index) => {
    const offset = index * WIDGET_SCENE_RPC_LIMITS.chunkRawBytes;
    const chunk = Buffer.from(packageValue.binary.subarray(offset,
      Math.min(packageValue.binary.length, offset + WIDGET_SCENE_RPC_LIMITS.chunkRawBytes)));
    return Object.freeze({ protocol: WIDGET_SCENE_RPC_PROTOCOL, transactionId,
      generation: FOCUS_TIMER_PACKAGE.generation, index, offset, bytes: chunk.length,
      chunkSha256: sha256(chunk), data: chunk.toString("base64") });
  }));
  const commit = Object.freeze({ protocol: WIDGET_SCENE_RPC_PROTOCOL, transactionId,
    expectedGeneration: FOCUS_TIMER_PACKAGE.expectedGeneration,
    generation: FOCUS_TIMER_PACKAGE.generation, totalBytes: packageValue.binary.length,
    totalChunks, sha256: packageValue.sha256 });
  return Object.freeze({ manifest: common, chunks, commit });
}

function statusOnly(response, operation) {
  if (!(response && typeof response === "object" && !Array.isArray(response) &&
      Object.keys(response).length === 1 && ["ok", "error"].includes(response.status))) {
    const error = new Error(`Focus-timer ${operation} returned a non-status-only response.`);
    error.code = "FOCUS_TIMER_RPC_INDETERMINATE"; error.rpcResponse = response; throw error;
  }
  if (response.status !== "ok") {
    const error = new Error(`Focus-timer ${operation} was rejected.`);
    error.code = "FOCUS_TIMER_RPC_REJECTED"; error.rpcResponse = response; throw error;
  }
  return response;
}

export async function publishFocusTimerPackageSmoke({ package: packageValue, rpc,
  onProgress = null } = {}) {
  invariant(typeof rpc === "function", "Focus-timer publisher requires rpc().");
  invariant(onProgress === null || typeof onProgress === "function",
    "Focus-timer progress callback must be a function.");
  const upload = createFocusTimerPackageUpload(packageValue);
  let begun = false;
  try {
    statusOnly(await rpc(WIDGET_SCENE_RPC_METHODS.begin, upload.manifest), "begin");
    begun = true;
    onProgress?.({ stage: "uploading-chunks", current: 0, total: upload.chunks.length });
    for (const chunk of upload.chunks) {
      statusOnly(await rpc(WIDGET_SCENE_RPC_METHODS.write, chunk), `chunk ${chunk.index}`);
      onProgress?.({ stage: "uploading-chunks", current: chunk.index + 1,
        total: upload.chunks.length });
    }
    onProgress?.({ stage: "applying-on-keyboard" });
    statusOnly(await rpc(WIDGET_SCENE_RPC_METHODS.commit, upload.commit), "commit");
    return Object.freeze({ status: "FOCUS_TIMER_PACKAGE_COMMIT_ACKNOWLEDGED",
      generation: upload.commit.generation, bytes: upload.commit.totalBytes,
      chunks: upload.commit.totalChunks, sha256: upload.commit.sha256,
      hostClockSync: false });
  } catch (error) {
    if (begun && error.code !== "FOCUS_TIMER_RPC_INDETERMINATE") {
      await rpc(WIDGET_SCENE_RPC_METHODS.abort, { protocol: WIDGET_SCENE_RPC_PROTOCOL,
        transactionId: upload.manifest.transactionId,
        generation: upload.manifest.generation }).catch(() => {});
    }
    throw error;
  }
}
