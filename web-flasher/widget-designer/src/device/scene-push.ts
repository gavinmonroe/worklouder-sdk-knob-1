// ─────────────────────────────────────────────────────────────────────────────
// Render-v2 scene push for the designer.
//
// Drives the stock scene RPC — widget.scene.begin → write × N → commit — over
// the same WebHID channel the flasher uses. Payload shapes are identical to
// web-flasher/src/lib/scene-push.js, which is the proven browser transport.
//
// The one deliberate difference: the flasher pins every push to a frozen
// catalog SHA-256, because it only ever ships one audited package. That is a
// HOST policy, not a device rule — the generic firmware's admission gate
// (renderer-v2-generic-scene-rpc-core.c) validates structure, size, and the
// caller-declared digest, and accepts any package that passes. The designer
// builds packages on the fly, so it pins the digest it just computed instead.
//
// Nothing here writes flash. The scene store is RAM; a power cycle reverts to
// whatever the firmware boot-adopts.
// ─────────────────────────────────────────────────────────────────────────────

import {
  CHUNK_RAW_BYTES,
  MAX_CHUNKS,
  SCENE_RPC_PROTOCOL,
  sha256Hex,
  rewriteGeneration,
  type RenderV2Package,
} from "../compiler/renderV2Package";

export const SCENE_RPC_METHODS = {
  capabilities: "widget.scene.capabilities",
  begin: "widget.scene.begin",
  write: "widget.scene.write",
  commit: "widget.scene.commit",
  abort: "widget.scene.abort",
  status: "widget.scene.status",
} as const;

/**
 * How far to probe for the device's real committed generation before giving up.
 * Each miss is one rejected begin that costs nothing on the device.
 */
export const GENERATION_PROBE_LIMIT = 4;

/**
 * Core status codes, as returned by firmware 4e045ec2+ in the `code` field.
 * Emitted negated, so these are small positives. Older builds answer with a
 * bare {"status":"error"} and no code at all.
 */
export const SCENE_ERROR_CODES: Record<string, string> = {
  "0": "rejected — the keyboard refused the request outright",
  "1": "busy — this firmware accepts one push per boot, and returns busy while " +
       "screen 26 is hidden or inside the commit-ack window. Power-cycle and retry.",
  "2": "bad parameters — a field in the request was malformed",
  "3": "wrong generation — the package did not declare committedGeneration + 1",
  "4": "out of range — the package size or chunk count is outside device limits",
  "5": "out of order — a chunk arrived out of sequence",
  "6": "digest mismatch — a chunk or the package failed its SHA-256 check",
  "7": "torn transfer — the transfer was incomplete at commit",
  "8": "malformed F1WB — the bundle header failed admission",
  "9": "stage failed — the renderer would not take ownership",
  "10": "render-v2 rejection — the package failed structural admission",
};

export const SCENE_BEGIN_REJECTED_MESSAGE =
  "The keyboard refused to start the scene transfer.";

/** Turn a status-only reply into the clearest message the device allows. */
export function describeSceneFailure(response: { status: string; code?: string }, fallback: string): string {
  const code = response?.code;
  if (typeof code === "string" && SCENE_ERROR_CODES[code]) {
    return `${fallback} Device reported code ${code}: ${SCENE_ERROR_CODES[code]}`;
  }
  return `${fallback} The device gave no status code; it is running firmware older than 4e045ec2.`;
}

export type ScenePushStage =
  | "status-probe"
  | "starting"
  | "uploading-chunks"
  | "committing"
  | "committed"
  | "aborted";

export interface ScenePushProgress {
  stage: ScenePushStage;
  current?: number;
  total?: number;
  message?: string;
}

export interface ScenePushResult {
  status: "committed";
  generation: number;
  expectedGeneration: number;
  bytes: number;
  totalChunks: number;
  sha256: string;
}

/** An RPC callable: method + params → the device's `result` object. */
export type SceneRpc = (method: string, params: Record<string, unknown>) => Promise<any>;

function sceneError(message: string, code: string): Error & { code?: string } {
  const error: Error & { code?: string } = new Error(message);
  error.code = code;
  return error;
}

function invariant(value: unknown, message: string, code: string): asserts value {
  if (!value) throw sceneError(message, code);
}

function base64(bytes: Uint8Array): string {
  let output = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    output += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + 0x8000)));
  }
  return btoa(output);
}

/**
 * begin/write/commit are status-only by contract. Anything else means we
 * cannot tell what the keyboard did, so we must not guess or retry.
 */
function assertStatusOnly(response: unknown, operation: string): { status: string; code?: string } {
  // Firmware 4e045ec2+ appends a "code" field on failure; anything beyond
  // {status} and {status, code} still means we cannot tell what happened.
  const keys = response && typeof response === "object" ? Object.keys(response as object) : [];
  const ok =
    response !== null &&
    typeof response === "object" &&
    !Array.isArray(response) &&
    keys.every((key) => key === "status" || key === "code") &&
    ["ok", "error"].includes((response as any).status);
  if (!ok) {
    throw sceneError(
      `Scene ${operation} returned a non-status-only response; the keyboard state is indeterminate.`,
      "SCENE_RPC_INDETERMINATE",
    );
  }
  return response as { status: string; code?: string };
}

function parseCanonicalGeneration(value: unknown): number | null {
  const text = typeof value === "number" && Number.isInteger(value) ? String(value) : value;
  if (typeof text !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(text)) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed < 0xffffffff ? parsed : null;
}

/** Confirm the scene RPC is answering before spending a transfer on it. */
export async function probeSceneAlive(rpc: SceneRpc): Promise<boolean> {
  try {
    const response = await rpc(SCENE_RPC_METHODS.status, { protocol: SCENE_RPC_PROTOCOL });
    return !!response && typeof response === "object" && (response as any).status === "ok";
  } catch {
    return false;
  }
}

/**
 * Read the device's committed generation at push time.
 *
 * This is the authoritative value and it must be read HERE, not carried from an
 * earlier identify: a caller's copy goes stale the moment anything else pushes,
 * and a stale value is unrecoverable because the probe below only searches
 * upward — if the device sits below the hint, every attempt misses.
 * Firmware 4e045ec2+ reports it; older builds answer without the field.
 */
export async function probeCommittedGeneration(rpc: SceneRpc): Promise<number | null> {
  try {
    const response = await rpc(SCENE_RPC_METHODS.capabilities, { protocol: SCENE_RPC_PROTOCOL });
    const value = response && typeof response === "object" ? (response as any).committedGeneration : null;
    if (typeof value === "string" && /^\d+$/.test(value)) return parseInt(value, 10);
    if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
    return null;
  } catch {
    return null;
  }
}

interface SceneUpload {
  manifest: Record<string, unknown>;
  chunks: Record<string, unknown>[];
  commit: Record<string, unknown>;
  abort: Record<string, unknown>;
}

/** Build the exact begin / write / commit / abort payloads for one package. */
export async function createSceneUpload(pkg: RenderV2Package, expectedGeneration: number): Promise<SceneUpload> {
  invariant(
    Number.isInteger(expectedGeneration) && expectedGeneration >= 0 && expectedGeneration < 0xffffffff,
    "Scene push expected generation must be a uint32 below its maximum.",
    "SCENE_PACKAGE_INVALID",
  );
  invariant(
    pkg.generation === expectedGeneration + 1,
    `Package generation ${pkg.generation} must be exactly one past the device's ${expectedGeneration}.`,
    "SCENE_PACKAGE_INVALID",
  );

  const bytes = pkg.binary;
  const totalChunks = Math.ceil(bytes.length / CHUNK_RAW_BYTES);
  invariant(
    totalChunks >= 1 && totalChunks <= MAX_CHUNKS,
    `Scene package needs ${totalChunks} chunks, over the device's ${MAX_CHUNKS}-chunk cap.`,
    "SCENE_PACKAGE_INVALID",
  );

  const transactionId = `f2pd-${pkg.generation.toString(16).padStart(8, "0")}-${pkg.sha256.slice(0, 16)}`;
  const common = {
    protocol: SCENE_RPC_PROTOCOL,
    transactionId,
    expectedGeneration,
    generation: pkg.generation,
    totalBytes: bytes.length,
    totalChunks,
    sha256: pkg.sha256,
  };

  const chunks: Record<string, unknown>[] = [];
  for (let index = 0; index < totalChunks; index += 1) {
    const offset = index * CHUNK_RAW_BYTES;
    const chunk = bytes.slice(offset, Math.min(bytes.length, offset + CHUNK_RAW_BYTES));
    chunks.push({
      protocol: SCENE_RPC_PROTOCOL,
      transactionId,
      generation: pkg.generation,
      index,
      offset,
      bytes: chunk.length,
      chunkSha256: await sha256Hex(chunk),
      data: base64(chunk),
    });
  }

  return {
    manifest: { ...common, chunkRawBytes: CHUNK_RAW_BYTES },
    chunks,
    commit: common,
    abort: { protocol: SCENE_RPC_PROTOCOL, transactionId, generation: pkg.generation },
  };
}

/**
 * Push a designer-built package to the keyboard.
 *
 * Probes the committed generation, restamps the package to generation + 1,
 * then begin → write × N → commit. Any failure after a successful `begin`
 * aborts the transaction, unless the response was indeterminate — in that
 * case we leave it alone rather than risk compounding an unknown state.
 */
export async function pushRenderV2Package({
  rpc,
  package: pkg,
  expectedGeneration,
  onProgress,
}: {
  rpc: SceneRpc;
  package: RenderV2Package;
  /**
   * The device's current committed generation. Tracked by the caller across
   * pushes: a fresh boot of the generic build is 0 (noBootProgram=true), and
   * each successful commit advances it by one. It cannot be read back — the
   * RPC that reports it crashes this firmware.
   */
  expectedGeneration: number;
  onProgress?: (progress: ScenePushProgress) => void;
}): Promise<ScenePushResult> {
  invariant(typeof rpc === "function", "Scene push requires an rpc() transport.", "SCENE_PACKAGE_INVALID");

  const alive = await probeSceneAlive(rpc);
  onProgress?.({
    stage: "status-probe",
    message: alive ? "Scene RPC is answering." : "Scene RPC did not answer; attempting the push anyway.",
  });

  // Ask the device rather than trusting the caller's copy.
  const live = await probeCommittedGeneration(rpc);
  if (live !== null && live !== expectedGeneration) {
    onProgress?.({
      stage: "status-probe",
      message: `Device reports committed generation ${live}${
        expectedGeneration !== live ? ` (caller had ${expectedGeneration})` : ""
      }.`,
    });
  }
  const startGeneration = live ?? expectedGeneration;

  // The device's committed generation cannot be read back (the RPC that
  // reports it crashes this firmware), and it only resets on a power cycle —
  // not on replug or page reload. So a caller's starting value is a hint, not a
  // fact: anything that pushed earlier this boot has already advanced it.
  //
  // Probing upward is safe and free. In renderer-v2-generic-scene-rpc-core.c
  // the generation check returns SCENE_RPC_GENERATION *before*
  // generic_begin_upload(), so a mismatch never claims the producer slot. A
  // BUSY rejection is indistinguishable on the wire, so the probe is bounded
  // and gives up with the busy explanation rather than hammering the device.
  let staged = pkg;
  let upload: SceneUpload | null = null;
  let resolvedExpected = startGeneration;
  let begun = false;
  let indeterminate = false;
  let firstBegin: { status: string; code?: string } | null = null;

  try {
    onProgress?.({ stage: "starting", current: 0, total: 0 });

    // When the device told us its generation, that value is authoritative and a
    // single attempt is correct. Probing past it would be actively harmful: the
    // extra attempts fail with GENERATION by construction, and reporting the
    // LAST code would bury the first failure -- which is the real reason. A
    // busy device would be reported as "wrong generation", which is a lie.
    //
    // Probing is only for firmware too old to report a generation, where the
    // caller's hint is the only starting point available.
    const attempts = live !== null ? 1 : GENERATION_PROBE_LIMIT + 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      resolvedExpected = startGeneration + attempt;
      staged = await rewriteGeneration(pkg, resolvedExpected + 1);
      upload = await createSceneUpload(staged, resolvedExpected);
      const began = assertStatusOnly(await rpc(SCENE_RPC_METHODS.begin, upload.manifest), "begin");
      if (firstBegin === null) firstBegin = began;
      if (began.status === "ok") {
        begun = true;
        if (attempt > 0) {
          onProgress?.({
            stage: "status-probe",
            message: `Device was already at generation ${resolvedExpected}; pushing ${staged.generation}.`,
          });
        }
        break;
      }
    }
    if (!begun || !upload) {
      throw sceneError(
        describeSceneFailure(firstBegin ?? { status: "error" }, SCENE_BEGIN_REJECTED_MESSAGE),
        "SCENE_BEGIN_REJECTED",
      );
    }

    onProgress?.({ stage: "uploading-chunks", current: 0, total: upload.chunks.length });
    for (const chunk of upload.chunks) {
      const acknowledged = assertStatusOnly(
        await rpc(SCENE_RPC_METHODS.write, chunk),
        `chunk ${chunk.index}`,
      );
      if (acknowledged.status !== "ok") {
        throw sceneError(
          describeSceneFailure(acknowledged, `Scene chunk ${chunk.index} was rejected by the keyboard.`),
          "SCENE_RPC_REJECTED",
        );
      }
      onProgress?.({
        stage: "uploading-chunks",
        current: (chunk.index as number) + 1,
        total: upload.chunks.length,
      });
    }

    onProgress?.({ stage: "committing", current: upload.chunks.length, total: upload.chunks.length });
    const committedAck = assertStatusOnly(await rpc(SCENE_RPC_METHODS.commit, upload.commit), "commit");
    if (committedAck.status !== "ok") {
      throw sceneError(
        describeSceneFailure(committedAck, "The keyboard rejected the scene commit."),
        "SCENE_COMMIT_REJECTED",
      );
    }

    onProgress?.({ stage: "committed", message: `Generation ${staged.generation} is live.` });
    return {
      status: "committed",
      generation: staged.generation,
      expectedGeneration: resolvedExpected,
      bytes: staged.bytes,
      totalChunks: upload.chunks.length,
      sha256: staged.sha256,
    };
  } catch (cause) {
    if ((cause as any)?.code === "SCENE_RPC_INDETERMINATE") indeterminate = true;
    if (begun && !indeterminate) {
      try {
        await rpc(SCENE_RPC_METHODS.abort, upload.abort);
        onProgress?.({ stage: "aborted", message: "Transaction aborted; the prior scene is still live." });
      } catch {
        // The abort itself failing tells us nothing new — surface the original.
      }
    }
    throw cause;
  }
}
