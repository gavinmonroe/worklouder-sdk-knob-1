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

// Rebuilding at generation 1 or 2 must still land on the exact frozen,
// catalog-pinned bytes: those two generations are the canonical identity
// every consumer (the web flasher's descriptor, the weather host companion
// zip, and this module's own upload pin) trusts without a live device
// round-trip. Any other generation is produced by the same deterministic
// rewrite -- same frozen F1WB/F2EP/LZSS inputs, only the F1WB generation
// word changes -- so status-derived callers can rebuild "whatever the
// device says it has, plus one" without a second frozen-hash table.
const CANONICAL_BUNDLE_SHA_BY_GENERATION = new Map([
  [1, "generationOneF1wbSha256"], [2, "generationTwoF1wbSha256"],
]);
const CANONICAL_PACKAGE_SHA_BY_GENERATION = new Map([
  [1, "generationOnePackageSha256"], [2, "generationTwoPackageSha256"],
]);

export function buildFocusTimerPackage({ focusF1wb, focusF2ep, timerF2ep, timerBaseLzss,
  generation = FOCUS_TIMER_PACKAGE.generation } = {}) {
  invariant(Number.isInteger(generation) && generation >= 1 && generation <= 0xffffffff,
    "Focus-timer package generation must be a nonzero uint32.");
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
  const canonicalBundleShaKey = CANONICAL_BUNDLE_SHA_BY_GENERATION.get(generation);
  if (canonicalBundleShaKey) {
    invariant(bundle.sha256 === FOCUS_TIMER_PACKAGE[canonicalBundleShaKey],
      "Focus-timer generation rewrite changed immutable F1WB payload bytes.");
  }
  invariant(bundle.binary.length === FOCUS_TIMER_PACKAGE.f1wbBytes &&
    bundle.binary.subarray(332).equals(template.subarray(332)),
  "Focus-timer generation rewrite changed immutable F1WB payload bytes.");
  const binary = Buffer.concat([bundle.binary, focusProgram, timerProgram, timerBase]);
  invariant(binary.length === FOCUS_TIMER_PACKAGE.packageBytes,
    "Focus-timer composite package bytes changed.");
  const packageSha = sha256(binary);
  const canonicalPackageShaKey = CANONICAL_PACKAGE_SHA_BY_GENERATION.get(generation);
  if (canonicalPackageShaKey) {
    invariant(packageSha === FOCUS_TIMER_PACKAGE[canonicalPackageShaKey],
      "Focus-timer composite package bytes changed.");
  }
  return Object.freeze({ format: FOCUS_TIMER_PACKAGE.format, generation,
    f1wb: Buffer.from(bundle.binary), focusF2ep: Buffer.from(focusProgram),
    timerF2ep: Buffer.from(timerProgram), timerBaseLzss: Buffer.from(timerBase),
    binary, sha256: packageSha });
}

export function createFocusTimerPackageUpload(packageValue,
  { expectedGeneration = FOCUS_TIMER_PACKAGE.expectedGeneration } = {}) {
  invariant(Number.isInteger(expectedGeneration) && expectedGeneration >= 0 &&
    expectedGeneration < 0xffffffff,
  "Focus-timer expected generation must be a uint32 below its maximum.");
  invariant(packageValue?.format === FOCUS_TIMER_PACKAGE.format &&
    packageValue.generation === expectedGeneration + 1 &&
    packageValue.binary instanceof Uint8Array &&
    packageValue.binary.length === FOCUS_TIMER_PACKAGE.packageBytes,
  "Focus-timer live upload requires one composite package that advances the given expected generation by exactly one.");
  if (expectedGeneration === FOCUS_TIMER_PACKAGE.expectedGeneration) {
    // Canonical case: the boot-template generation 1 advancing straight to
    // the frozen, catalog-pinned generation-2 composite. Pin the exact sha
    // here too so this well-trodden path can never silently drift.
    invariant(sha256(packageValue.binary) === FOCUS_TIMER_PACKAGE.generationTwoPackageSha256,
      "Focus-timer live upload requires the exact generation-two composite.");
  } else {
    invariant(sha256(packageValue.binary) === packageValue.sha256,
      "Focus-timer package sha256 does not match its own bytes.");
  }
  const totalChunks = Math.ceil(packageValue.binary.length / WIDGET_SCENE_RPC_LIMITS.chunkRawBytes);
  invariant(packageValue.binary.length <= WIDGET_SCENE_RPC_LIMITS.maxBundleBytes &&
    totalChunks === FOCUS_TIMER_PACKAGE.chunks && totalChunks <= WIDGET_SCENE_RPC_LIMITS.maxChunks,
  "Focus-timer composite exceeds the exact scene-store transport bounds.");
  const transactionId = `f2pt-${packageValue.generation.toString(16).padStart(8, "0")}-${packageValue.sha256.slice(0, 16)}`;
  const common = Object.freeze({ protocol: WIDGET_SCENE_RPC_PROTOCOL, transactionId,
    expectedGeneration, generation: packageValue.generation, totalBytes: packageValue.binary.length,
    totalChunks, chunkRawBytes: WIDGET_SCENE_RPC_LIMITS.chunkRawBytes,
    sha256: packageValue.sha256 });
  const chunks = Object.freeze(Array.from({ length: totalChunks }, (_, index) => {
    const offset = index * WIDGET_SCENE_RPC_LIMITS.chunkRawBytes;
    const chunk = Buffer.from(packageValue.binary.subarray(offset,
      Math.min(packageValue.binary.length, offset + WIDGET_SCENE_RPC_LIMITS.chunkRawBytes)));
    return Object.freeze({ protocol: WIDGET_SCENE_RPC_PROTOCOL, transactionId,
      generation: packageValue.generation, index, offset, bytes: chunk.length,
      chunkSha256: sha256(chunk), data: chunk.toString("base64") });
  }));
  const commit = Object.freeze({ protocol: WIDGET_SCENE_RPC_PROTOCOL, transactionId,
    expectedGeneration, generation: packageValue.generation, totalBytes: packageValue.binary.length,
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
  expectedGeneration = FOCUS_TIMER_PACKAGE.expectedGeneration, onProgress = null } = {}) {
  invariant(typeof rpc === "function", "Focus-timer publisher requires rpc().");
  invariant(onProgress === null || typeof onProgress === "function",
    "Focus-timer progress callback must be a function.");
  const upload = createFocusTimerPackageUpload(packageValue, { expectedGeneration });
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

// --- Status-derived, idempotent publish -----------------------------------
//
// The keyboard firmware is gaining (a) boot adoption of the frozen clock+
// timer package straight from flash (ID26/27 come up already running it)
// and (b) reporting of that adopted/committed package on
// widget.scene.capabilities / widget.scene.status as `committedGeneration`
// (a canonical u32, decimal string or number depending on which RPC
// answers) plus, where available, a package identity (`committedSha256` /
// `packageSha256`). Both are best-effort: today's flashed firmware answers
// widget.scene.status with a bare {status:"ok"} and neither field, and that
// is expected, not a failure.
//
// Idempotency rule implemented by probeFocusTimerCommittedPackage() and
// publishFocusTimerPackageIfNeeded():
//
//  1. Probe widget.scene.capabilities, then widget.scene.status, for a
//     canonical committedGeneration. The first response that parses one
//     wins; an unreachable/legacy/malformed response is skipped, not fatal.
//  2. If the probe also finds a package identity (committedSha256 or
//     packageSha256) AND rebuilding this package at that exact committed
//     generation reproduces that identity byte-for-byte, the device already
//     holds this exact package: report "already enabled by firmware
//     (generation N)" and perform no begin/write/commit at all.
//  3. Otherwise push with expectedGeneration = N (the probed
//     committedGeneration, or the legacy pinned default of 1 when the probe
//     found nothing) and generation = N+1, rebuilding the composite at that
//     generation from the same frozen focus/timer inputs
//     (buildFocusTimerPackage is this format's equivalent of
//     renderV2PackageAtGeneration: same frozen bytes, only the F1WB
//     generation word changes).
//  4. If that push is rejected (begin, a chunk write, or commit -- any
//     FOCUS_TIMER_RPC_REJECTED) AND the probe found a real committedGeneration
//     N that is >= FOCUS_TIMER_MINIMUM_BOOT_ADOPTED_GENERATION (2, the
//     generation baked into the flashed clock+timer image today), classify
//     the rejection as "already enabled by firmware (generation N)" instead
//     of an error. A push attempted at the device's own reported generation
//     that still gets refused is far more likely to mean the frozen package
//     is already committed than a genuine transport fault, and N >= 2 means
//     the probe read a real boot-adopted/committed generation rather than
//     the boot-template default.
//  5. If the probe found nothing at all (no capabilities/status support --
//     today's real firmware) AND the push's `begin` step specifically is
//     rejected, classify it the same way. This preserves, byte for byte,
//     the historical behavior every host pusher already relied on before
//     this generation-derivation work landed ("the device only accepts one
//     live push per boot; a rejected begin means it is already applied this
//     boot, which is expected, not an error") for firmware that has not yet
//     shipped the status/capabilities follow-up. A rejected write or commit
//     with no generation reading is NOT swallowed here -- some bytes were
//     already accepted, so a failure past `begin` is a genuine fault.
export const FOCUS_TIMER_MINIMUM_BOOT_ADOPTED_GENERATION = FOCUS_TIMER_PACKAGE.generation;

function parseCanonicalGeneration(value) {
  const text = typeof value === "number" && Number.isInteger(value) ? String(value) : value;
  if (typeof text !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(text)) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed < 0xffffffff ? parsed : null;
}

function parseCommittedSha256(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value) ? value : null;
}

/**
 * Best-effort read of the device's committed render-v2 generation (and,
 * where advertised, package identity) before a focus-timer push. See the
 * idempotency rule documented above.
 */
export async function probeFocusTimerCommittedPackage({ rpc }) {
  invariant(typeof rpc === "function", "Focus-timer status probe requires rpc().");
  for (const method of [WIDGET_SCENE_RPC_METHODS.capabilities, WIDGET_SCENE_RPC_METHODS.status]) {
    let response;
    try { response = await rpc(method, { protocol: WIDGET_SCENE_RPC_PROTOCOL }); }
    catch { continue; }
    if (!response || typeof response !== "object" || Array.isArray(response) || response.status === "error") continue;
    const generation = parseCanonicalGeneration(response.committedGeneration);
    if (generation === null) continue;
    return Object.freeze({ source: method, generation,
      sha256: parseCommittedSha256(response.committedSha256 ?? response.packageSha256) });
  }
  return Object.freeze({ source: "unavailable", generation: null, sha256: null });
}

function alreadyEnabledResult(generation, reason) {
  return Object.freeze({ status: "FOCUS_TIMER_PACKAGE_ALREADY_ENABLED", alreadyEnabled: true,
    generation, reason, hostClockSync: false });
}

/**
 * Status-derived, idempotent publish. Probes the device's committed
 * generation, skips the push entirely when the reported package identity
 * already matches, and otherwise pushes expectedGeneration -> +1,
 * classifying an expected rejection as "already enabled" rather than an
 * error per the rule documented above.
 */
export async function publishFocusTimerPackageIfNeeded({ rpc, sourceParts, onProgress = null,
  onStatus = null, buildPackage = buildFocusTimerPackage,
  probe = probeFocusTimerCommittedPackage } = {}) {
  invariant(typeof rpc === "function", "Focus-timer publisher requires rpc().");
  invariant(sourceParts && typeof sourceParts === "object",
    "Focus-timer publisher requires its frozen source parts.");
  invariant(onStatus === null || typeof onStatus === "function",
    "Focus-timer status callback must be a function.");
  const status = await probe({ rpc });
  onStatus?.({ stage: "status-probe", source: status.source, committedGeneration: status.generation });

  if (status.generation !== null && status.sha256) {
    const committedCandidate = buildPackage({ ...sourceParts, generation: status.generation });
    if (committedCandidate.sha256 === status.sha256) {
      const result = alreadyEnabledResult(status.generation, "committed-sha-match");
      onStatus?.({ stage: "already-enabled", ...result });
      return result;
    }
  }

  const expectedGeneration = status.generation ?? FOCUS_TIMER_PACKAGE.expectedGeneration;
  const targetGeneration = expectedGeneration + 1;
  const packageValue = buildPackage({ ...sourceParts, generation: targetGeneration });
  onStatus?.({ stage: "target-selected", expectedGeneration, generation: targetGeneration,
    bytes: packageValue.binary.length, sha256: packageValue.sha256 });

  try {
    const result = await publishFocusTimerPackageSmoke({ package: packageValue, rpc,
      expectedGeneration, onProgress });
    return Object.freeze({ ...result, alreadyEnabled: false });
  } catch (error) {
    if (error.code !== "FOCUS_TIMER_RPC_REJECTED") throw error;
    const knownBootAdopted = status.generation !== null &&
      status.generation >= FOCUS_TIMER_MINIMUM_BOOT_ADOPTED_GENERATION;
    const beginRejected = /\bbegin\b/i.test(error.message ?? "");
    if (knownBootAdopted) {
      const result = alreadyEnabledResult(status.generation, "rejected-at-known-boot-adopted-generation");
      onStatus?.({ stage: "already-enabled", ...result });
      return result;
    }
    if (status.generation === null && beginRejected) {
      const result = alreadyEnabledResult(expectedGeneration, "begin-rejected-generation-unknown-legacy");
      onStatus?.({ stage: "already-enabled", ...result });
      return result;
    }
    throw error;
  }
}
