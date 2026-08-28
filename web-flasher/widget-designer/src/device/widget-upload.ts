// ─────────────────────────────────────────────────────────────────────────────
// Chunked F2UP upload client for the `widget.mquickjs.upload` RPC.
//
// Wire protocol frozen in docs/16-mquickjs-widget-pipeline.md: one RPC method,
// op-discriminated —
//
//   op=0 status · op=1 begin {generation, totalBytes} · op=2 chunk {offset,
//   data} · op=3 commit · op=4 abort
//
// Chunks are raw 3,072-byte slices (4,096 base64 chars, canonical alphabet, no
// whitespace) at strict in-order offsets, at most 32 of them — 32 × 3072 =
// 98,304, the F2UP maximum exactly. Every reply is one status string:
//
//   v1;op=<n>;rc=<hex32>;st=<0..3>;rx=<hex32>;g=<hex32>;pg=<hex32>;
//   ps=<hex32>;ad=<hex32>
//
// rc=0 is success. `ps` packs the persist machine's `state | step<<8`; after a
// committed upload the Designer polls op=0 until state reads DONE (6), then
// tells the user to power-cycle — adoption happens at boot, never hot.
//
// Unlike the scene push (scene-push.ts, whose probe/begin/chunks/commit shape
// and progress callbacks this mirrors), the generation can NOT be restamped
// after the fact: it is baked into all three artifacts and sha-pinned by the
// container, so a mismatch is a rebuild, not a retry.
// ─────────────────────────────────────────────────────────────────────────────

export const WIDGET_UPLOAD_METHOD = "widget.mquickjs.upload";
export const WIDGET_UPLOAD_CHUNK_RAW_BYTES = 3_072;
export const WIDGET_UPLOAD_MAX_CHUNKS = 32;
export const WIDGET_UPLOAD_MAX_BYTES = WIDGET_UPLOAD_CHUNK_RAW_BYTES * WIDGET_UPLOAD_MAX_CHUNKS;

export const WIDGET_UPLOAD_OP = {
  status: 0,
  begin: 1,
  chunk: 2,
  commit: 3,
  abort: 4,
  // v2 additive (docs/17 — multi-widget slots); present only on firmware that
  // advertises the slot bank. op 0/1 keep their exact behavior when no slot is
  // given, so these are never on the historical single-slot path.
  inventory: 5,
  activate: 6,
} as const;

/** framer_f2up_persist_state (experiments/mquickjs-widget-upload/f2up_persist.h). */
export const WIDGET_PERSIST_STATE = {
  idle: 0, armed: 1, erase: 2, write: 3, verify: 4, header: 5, done: 6, failed: 7,
} as const;

/** framer_f2up_upload_result codes, as `rc` reports them (signed). */
const UPLOAD_RESULT_NAMES: Record<number, string> = {
  [-1]: "bad argument",
  [-2]: "wrong transaction state",
  [-3]: "wrong generation (begin must be running generation + 1)",
  [-4]: "totalBytes out of range",
  [-5]: "chunk offset out of order",
  [-6]: "chunk overflows totalBytes",
  [-7]: "container admission failed (see admit detail)",
};

/** framer_f2up_result admission codes, as `ad` reports them (signed). */
const ADMIT_RESULT_NAMES: Record<number, string> = {
  [-1]: "bad argument", [-2]: "bad magic", [-3]: "bad version", [-4]: "bad size",
  [-5]: "bad generation", [-6]: "bad section table", [-7]: "reserved bytes set",
  [-8]: "header crc mismatch", [-9]: "payload sha mismatch", [-10]: "f2js sha mismatch",
};

export function describeUploadRc(rc: number): string {
  return UPLOAD_RESULT_NAMES[rc] ?? `unknown code ${rc}`;
}

export interface WidgetUploadReply {
  op: number;
  /** Signed int32 view of the hex32 result code; 0 is success. */
  rc: number;
  /** Upload transaction state 0..3 (idle/open/sealed/failed). */
  st: number;
  /** Bytes received so far. */
  rx: number;
  /** Running (booted) widget generation. */
  g: number;
  /** Last persisted generation. */
  pg: number;
  /** Packed persist status: state | step<<8. */
  ps: number;
  persist: { state: number; step: number };
  /** Signed admit detail (framer_f2up_result of the sealing admit). */
  ad: number;
  /**
   * Active slot index (docs/17: op 0 gained `sl=`). Undefined on single-slot
   * firmware that never advertises it — the older reply still parses.
   */
  sl?: number;
  /** Slot count (docs/17: op 0 gained `sn=`). Undefined on single-slot firmware. */
  sn?: number;
  raw: string;
}

const REPLY_FIELDS = ["op", "rc", "st", "rx", "g", "pg", "ps", "ad"] as const;
const HEX32 = /^[0-9a-fA-F]{1,8}$/;

/**
 * Parse one `v1;key=value;…` reply. Returns null for anything that is not a
 * complete well-formed reply — the caller treats that as indeterminate rather
 * than guessing.
 */
export function parseWidgetUploadReply(text: unknown): WidgetUploadReply | null {
  if (typeof text !== "string" || !text.startsWith("v1;")) return null;
  const fields = new Map<string, string>();
  for (const part of text.slice(3).split(";")) {
    if (part.length === 0) continue;
    const eq = part.indexOf("=");
    if (eq <= 0) return null;
    fields.set(part.slice(0, eq), part.slice(eq + 1));
  }
  const values: Record<string, number> = {};
  for (const key of REPLY_FIELDS) {
    const value = fields.get(key);
    if (value === undefined || !HEX32.test(value)) return null;
    values[key] = parseInt(value, 16) >>> 0;
  }
  const ps = values.ps;
  // `sl`/`sn` are additive (docs/17) and OPTIONAL: they ride the same hex32
  // grammar as the required fields, but a single-slot reply omits them and must
  // still parse. Read them only when present and well-formed — never fail the
  // whole reply for their absence.
  const optionalUint = (key: string): number | undefined => {
    const raw = fields.get(key);
    return raw !== undefined && HEX32.test(raw) ? parseInt(raw, 16) >>> 0 : undefined;
  };
  return {
    op: values.op,
    rc: values.rc | 0,
    st: values.st,
    rx: values.rx,
    g: values.g,
    pg: values.pg,
    ps,
    persist: { state: ps & 0xff, step: ps >>> 8 },
    ad: values.ad | 0,
    sl: optionalUint("sl"),
    sn: optionalUint("sn"),
    raw: text,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Multi-widget slot bank (docs/17 — FROZEN v2 additive protocol)
//
//   op 5 inventory {slot} → v1;op=5;rc=<hex>;slot=k;present=0|1;g=<hex gen>;
//                           sha=<f2js sha256 first 16 = 32 hex chars>
//   op 6 activate  {slot} → the op-0 status reply shape; rc 0 on success, and
//                           op 0 afterwards reports the new sl=. Activating an
//                           empty slot fails (rc != 0), leaving the live widget
//                           undisturbed.
//
// The inventory reply is a DIFFERENT shape from the status/activate reply, so it
// gets its own parser. `sha` maps to a friendly name through the Designer's
// local push history (slotRegistry.ts) — no container-format change needed.
// ─────────────────────────────────────────────────────────────────────────────

export interface WidgetInventoryReply {
  /** Always 5 for a well-formed inventory reply. */
  op: number;
  /** Signed int32 result code; 0 is success. */
  rc: number;
  /** The slot index this reply describes (echoes the requested slot). */
  slot: number;
  /** True when the slot holds an admissible widget. */
  present: boolean;
  /** The slot's persisted generation (0 when empty). */
  g: number;
  /**
   * The stored widget's F2JS sha256, first 16 bytes as 32 lowercase hex chars —
   * the exact bytes `AssembledWidgetUpload.sections.f2js.sha256.slice(0, 32)`
   * produces, so the two key the same registry entry. "" when empty/unreadable.
   */
  sha16: string;
  raw: string;
}

/**
 * Parse one op-5 inventory reply. Returns null for anything that is not a
 * well-formed inventory reply (wrong op, missing/!hex fields) so the caller can
 * mark that slot indeterminate rather than guessing.
 */
export function parseWidgetInventoryReply(text: unknown): WidgetInventoryReply | null {
  if (typeof text !== "string" || !text.startsWith("v1;")) return null;
  const fields = new Map<string, string>();
  for (const part of text.slice(3).split(";")) {
    if (part.length === 0) continue;
    const eq = part.indexOf("=");
    if (eq <= 0) return null;
    fields.set(part.slice(0, eq), part.slice(eq + 1));
  }
  const opText = fields.get("op");
  const rcText = fields.get("rc");
  const slotText = fields.get("slot");
  const presentText = fields.get("present");
  const gText = fields.get("g");
  if (opText === undefined || !HEX32.test(opText)) return null;
  if (rcText === undefined || !HEX32.test(rcText)) return null;
  if (slotText === undefined || !/^\d+$/.test(slotText)) return null;
  if (presentText === undefined || !/^[01]$/.test(presentText)) return null;
  if (gText === undefined || !HEX32.test(gText)) return null;
  const op = parseInt(opText, 16) >>> 0;
  if (op !== WIDGET_UPLOAD_OP.inventory) return null;
  const shaText = fields.get("sha");
  const sha16 = shaText && /^[0-9a-fA-F]{1,64}$/.test(shaText) ? shaText.toLowerCase() : "";
  return {
    op,
    rc: parseInt(rcText, 16) | 0,
    slot: parseInt(slotText, 10),
    present: presentText === "1",
    g: parseInt(gText, 16) >>> 0,
    sha16,
    raw: text,
  };
}

/**
 * The generation a push to a slot must carry: the slot's persisted generation
 * + 1 (op 1 ratchets against THAT slot). A first push to an empty (or
 * unreadable) slot is generation 1.
 */
export function nextSlotGeneration(inventory: WidgetInventoryReply | null): number {
  return (inventory && inventory.present && inventory.rc === 0 ? inventory.g : 0) + 1;
}

/** One slot's projected UI state — pure, derived from op 0 + its op 5 reply. */
export interface SlotView {
  slot: number;
  /** Holds an admissible widget (present=1 and rc=0). */
  present: boolean;
  /** This is the live slot (op-0 sl). */
  active: boolean;
  /** The slot's persisted generation (0 when empty). */
  generation: number;
  /** f2js sha256 first 16 (32 lowercase hex), "" when empty/unreadable. */
  sha16: string;
  /** The generation a push here would carry (present ? g+1 : 1). */
  nextGeneration: number;
  /** op 5 could not be read for this slot — its contents are indeterminate. */
  unknown: boolean;
}

export interface SlotBankModel {
  /** Running (booted) widget generation, op-0 g. */
  running: number;
  /** Active slot index, op-0 sl (defaults to 0 pre-v2). */
  activeSlot: number;
  /** Slot count, op-0 sn (defaults to the inventory length, else 1). */
  slotCount: number;
  slots: SlotView[];
}

/**
 * Fold an op-0 status reply and the per-slot op-5 inventory replies into the
 * slot-bank model the Screens panel renders. Pure: the async sweep lives in
 * useDevice, this is just the mapping (unit-tested).
 */
export function buildSlotBank(
  status: WidgetUploadReply,
  inventories: ReadonlyArray<WidgetInventoryReply | null>,
): SlotBankModel {
  const slotCount = Math.max(1, status.sn ?? inventories.length ?? 1);
  const activeSlot = status.sl ?? 0;
  const slots: SlotView[] = [];
  for (let k = 0; k < slotCount; k += 1) {
    const inv = inventories[k] ?? null;
    const readable = inv !== null && inv.rc === 0;
    const present = readable && inv!.present === true;
    slots.push({
      slot: k,
      present,
      active: k === activeSlot,
      generation: present ? inv!.g : 0,
      sha16: present ? inv!.sha16 : "",
      nextGeneration: nextSlotGeneration(inv),
      unknown: !readable,
    });
  }
  return { running: status.g, activeSlot, slotCount, slots };
}

/** An RPC callable: method + params → the device's `result` object. */
export type WidgetRpc = (method: string, params: Record<string, unknown>) => Promise<any>;

export type WidgetUploadStage =
  | "status-probe"
  | "starting"
  | "uploading-chunks"
  | "committing"
  | "persisting"
  | "persisted"
  | "aborted";

export interface WidgetUploadProgress {
  stage: WidgetUploadStage;
  current?: number;
  total?: number;
  message?: string;
}

export interface WidgetUploadResult {
  generation: number;
  bytes: number;
  chunks: number;
  persistStatus: { state: number; step: number; raw: number };
}

export class WidgetUploadError extends Error {
  /** Which op failed: "status" | "begin" | "chunk" | "commit" | "persist". */
  readonly op: string;
  /** The device's rc when one was parsed, else null. */
  readonly rc: number | null;
  readonly code: string;
  constructor(message: string, op: string, rc: number | null, code: string) {
    super(message);
    this.name = "WidgetUploadError";
    this.op = op;
    this.rc = rc;
    this.code = code;
  }
}

/** The upload RPC answers with `{ status: "v1;…" }` (the mquickjs cap shape);
 *  extract the string defensively. */
function statusString(result: unknown): string | null {
  if (typeof result === "string") return result;
  if (result && typeof result === "object" && typeof (result as any).status === "string") {
    return (result as any).status;
  }
  return null;
}

function base64(bytes: Uint8Array): string {
  let text = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + 0x8000)));
  }
  return btoa(text);
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Read the device's upload/persist status (op=0). Null when the device does
 *  not answer or the reply is malformed. */
export async function probeWidgetUploadStatus(rpc: WidgetRpc): Promise<WidgetUploadReply | null> {
  try {
    return parseWidgetUploadReply(statusString(await rpc(WIDGET_UPLOAD_METHOD, { op: WIDGET_UPLOAD_OP.status })));
  } catch {
    return null;
  }
}

/**
 * Read one slot's inventory (op=5). Null when the device does not answer or the
 * reply is not a well-formed op-5 reply — the caller marks that slot unknown.
 */
export async function probeWidgetInventory(
  rpc: WidgetRpc,
  slot: number,
): Promise<WidgetInventoryReply | null> {
  try {
    return parseWidgetInventoryReply(
      statusString(await rpc(WIDGET_UPLOAD_METHOD, { op: WIDGET_UPLOAD_OP.inventory, slot })),
    );
  } catch {
    return null;
  }
}

/**
 * Activate a slot (op=6): quiesce the running owner, adopt + boot the requested
 * slot. The reply is the op-0 status shape — rc 0 on success, and op 0
 * afterwards reports the new sl=. Activating an empty slot fails (rc != 0) and
 * leaves the live widget undisturbed. Null when the reply is unparseable.
 */
export async function activateWidgetSlot(
  rpc: WidgetRpc,
  slot: number,
  pollIntervalMs = 50,
  pollLimit = 80,
): Promise<WidgetUploadReply | null> {
  try {
    const acknowledged = parseWidgetUploadReply(
      statusString(await rpc(WIDGET_UPLOAD_METHOD, { op: WIDGET_UPLOAD_OP.activate, slot })),
    );
    if (!acknowledged || acknowledged.rc !== 0) return acknowledged;
    // Op 6 is level-triggered: its immediate reply only acknowledges the
    // request. Do not tell the UI the screen changed until the owner task has
    // quiesced/rebooted the VM and op 0 reports the requested live slot.
    for (let attempt = 0; attempt < pollLimit; attempt += 1) {
      const status = await probeWidgetUploadStatus(rpc);
      if (status?.rc === 0 && status.sl === slot) return status;
      if (attempt + 1 < pollLimit) await delay(pollIntervalMs);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Push an assembled F2UP container over `widget.mquickjs.upload`:
 * probe → begin → chunks (strict in-order) → commit → poll status until the
 * persist machine reads DONE. Resolves once the widget is persisted — it is
 * adopted at the NEXT boot, so the caller should tell the user to power-cycle.
 *
 * Any chunk/commit rejection aborts the transaction (op=4, best-effort) before
 * rejecting with a WidgetUploadError naming the failing op and rc. An
 * indeterminate reply (unparseable) neither retries nor aborts — mirroring the
 * scene push, we must not compound a state we cannot read.
 */
export async function pushWidgetUpload({
  rpc,
  container,
  generation,
  onProgress,
  pollIntervalMs = 250,
  pollLimit = 80,
  slot,
}: {
  rpc: WidgetRpc;
  container: { binary: Uint8Array };
  generation: number;
  onProgress?: (progress: WidgetUploadProgress) => void;
  /** Delay between op=0 persist polls. */
  pollIntervalMs?: number;
  /** How many op=0 polls to spend before giving up on DONE. */
  pollLimit?: number;
  /**
   * Target slot (docs/17). ABSENT keeps the frozen single-slot behavior exactly
   * — begin carries no `slot` key and the running-generation pre-check applies.
   * When given, the caller has already ratcheted `generation` against THAT
   * slot's persisted generation via op 5 (nextSlotGeneration), so the
   * running-generation pre-check is skipped and the device's begin gate speaks
   * for the slot. Everything else — chunking, base64, commit, persist poll — is
   * identical for both paths.
   */
  slot?: number;
}): Promise<WidgetUploadResult> {
  const invalid = (message: string): never => {
    throw new WidgetUploadError(message, "begin", null, "WIDGET_UPLOAD_INVALID");
  };
  if (typeof rpc !== "function") invalid("Widget upload requires an rpc() transport.");
  const binary = container?.binary;
  if (!(binary instanceof Uint8Array) || binary.length < 128) {
    invalid("Widget upload requires an assembled F2UP container.");
  }
  if (binary.length > WIDGET_UPLOAD_MAX_BYTES) {
    invalid(`Container is ${binary.length} bytes, over the ${WIDGET_UPLOAD_MAX_BYTES}-byte upload limit.`);
  }
  if (String.fromCharCode(...binary.subarray(0, 8)) !== "F2WIDGT1") {
    invalid("Widget upload payload is not an F2UP container (bad magic).");
  }
  if (!Number.isInteger(generation) || generation < 1 || generation > 0xffffffff) {
    invalid(`Upload generation must be an integer 1..4294967295; got ${generation}.`);
  }
  const bakedGeneration = new DataView(binary.buffer, binary.byteOffset, binary.byteLength).getUint32(16, true);
  if (bakedGeneration !== generation) {
    // Not restampable: the generation is inside the sha-pinned artifacts.
    invalid(
      `Container is baked for generation ${bakedGeneration} but the push asked for ` +
        `${generation}; reassemble the widget at the right generation.`,
    );
  }
  const totalChunks = Math.ceil(binary.length / WIDGET_UPLOAD_CHUNK_RAW_BYTES);

  /** One op round-trip. Throws indeterminate when the reply does not parse. */
  const call = async (op: string, params: Record<string, unknown>): Promise<WidgetUploadReply> => {
    const reply = parseWidgetUploadReply(statusString(await rpc(WIDGET_UPLOAD_METHOD, params)));
    if (!reply) {
      throw new WidgetUploadError(
        `Widget upload ${op} returned no parseable status reply; the keyboard state is indeterminate.`,
        op, null, "WIDGET_UPLOAD_INDETERMINATE",
      );
    }
    return reply;
  };
  const rejected = (op: string, reply: WidgetUploadReply, detail = ""): WidgetUploadError =>
    new WidgetUploadError(
      `Widget upload ${op} was rejected: rc=${reply.rc} (${describeUploadRc(reply.rc)})${
        reply.rc === -7 && reply.ad !== 0
          ? `; admit detail ${reply.ad} (${ADMIT_RESULT_NAMES[reply.ad] ?? "unknown"})`
          : ""
      }${detail}`,
      op, reply.rc, "WIDGET_UPLOAD_REJECTED",
    );

  // The generation cannot be fixed mid-flight, so check it against the device
  // BEFORE spending a transfer. A device that does not answer is reported and
  // then trusted to speak for itself at begin.
  const probed = await probeWidgetUploadStatus(rpc);
  onProgress?.({
    stage: "status-probe",
    message: probed
      ? `Device is running widget generation ${probed.g}` +
        (probed.pg !== probed.g ? ` (persisted ${probed.pg})` : "") + "."
      : "Upload RPC did not answer the status probe; attempting the push anyway.",
  });
  // The running-generation pre-check is the ACTIVE slot's ratchet; it is
  // correct only when the push targets the running widget. A slot-targeted push
  // ratchets against THAT slot's persisted generation (already folded into
  // `generation` by the caller via op 5), so skip it there and trust begin.
  if (slot === undefined && probed && probed.g + 1 !== generation) {
    throw new WidgetUploadError(
      `Container generation ${generation} does not fit the device: it is running ` +
        `generation ${probed.g} and accepts exactly ${probed.g + 1}. Reassemble at ` +
        `generation ${probed.g + 1}.`,
      "begin", null, "WIDGET_UPLOAD_GENERATION",
    );
  }

  let begun = false;
  let committed = false;
  let indeterminate = false;
  try {
    onProgress?.({ stage: "starting", current: 0, total: totalChunks });
    const began = await call("begin", {
      op: WIDGET_UPLOAD_OP.begin,
      generation,
      totalBytes: binary.length,
      // Additive: only sent when a slot is targeted, so the default path's
      // begin params stay exactly {op, generation, totalBytes}.
      ...(slot === undefined ? {} : { slot }),
    });
    if (began.rc !== 0) throw rejected("begin", began);
    begun = true;

    onProgress?.({ stage: "uploading-chunks", current: 0, total: totalChunks });
    for (let index = 0; index < totalChunks; index += 1) {
      const offset = index * WIDGET_UPLOAD_CHUNK_RAW_BYTES;
      const chunk = binary.subarray(offset, Math.min(binary.length, offset + WIDGET_UPLOAD_CHUNK_RAW_BYTES));
      const reply = await call(`chunk ${index}`, {
        op: WIDGET_UPLOAD_OP.chunk,
        offset,
        data: base64(chunk),
      });
      if (reply.rc !== 0) throw rejected(`chunk ${index}`, reply);
      if (reply.rx !== offset + chunk.length) {
        throw new WidgetUploadError(
          `Widget upload chunk ${index} desynchronized: device has ${reply.rx} bytes, ` +
            `expected ${offset + chunk.length}.`,
          `chunk ${index}`, reply.rc, "WIDGET_UPLOAD_DESYNC",
        );
      }
      onProgress?.({ stage: "uploading-chunks", current: index + 1, total: totalChunks });
    }

    onProgress?.({ stage: "committing", current: totalChunks, total: totalChunks });
    const sealed = await call("commit", { op: WIDGET_UPLOAD_OP.commit });
    if (sealed.rc !== 0) throw rejected("commit", sealed);
    committed = true;

    // The container is sealed and the persist machine armed; nothing to abort
    // from here on. Poll until DONE — for THIS generation, so a stale DONE
    // from an earlier push this boot can never be mistaken for ours.
    onProgress?.({ stage: "persisting", message: "Persisting to the widget flash slot…" });
    let last: WidgetUploadReply = sealed;
    for (let attempt = 0; attempt <= pollLimit; attempt += 1) {
      if (last.persist.state === WIDGET_PERSIST_STATE.failed) {
        throw new WidgetUploadError(
          `Widget persist failed at step ${last.persist.step} (ps=0x${last.ps.toString(16)}).`,
          "persist", last.rc, "WIDGET_UPLOAD_PERSIST_FAILED",
        );
      }
      if (last.persist.state === WIDGET_PERSIST_STATE.done && last.pg === generation) {
        onProgress?.({
          stage: "persisted",
          message: `Generation ${generation} persisted. Power-cycle the keyboard to adopt it — adoption happens at boot.`,
        });
        return {
          generation,
          bytes: binary.length,
          chunks: totalChunks,
          persistStatus: { state: last.persist.state, step: last.persist.step, raw: last.ps },
        };
      }
      if (attempt === pollLimit) break;
      await delay(pollIntervalMs);
      last = await call("status", { op: WIDGET_UPLOAD_OP.status });
      if (last.rc !== 0) throw rejected("status", last);
    }
    throw new WidgetUploadError(
      `Widget persist did not reach DONE after ${pollLimit} polls ` +
        `(last ps=0x${last.ps.toString(16)}, state ${last.persist.state}).`,
      "persist", last.rc, "WIDGET_UPLOAD_PERSIST_TIMEOUT",
    );
  } catch (cause) {
    if ((cause as WidgetUploadError)?.code === "WIDGET_UPLOAD_INDETERMINATE") indeterminate = true;
    if (begun && !committed && !indeterminate) {
      try {
        await rpc(WIDGET_UPLOAD_METHOD, { op: WIDGET_UPLOAD_OP.abort });
        onProgress?.({ stage: "aborted", message: "Transaction aborted; the running widget is undisturbed." });
      } catch {
        // The abort failing adds nothing — surface the original failure.
      }
    }
    throw cause;
  }
}
