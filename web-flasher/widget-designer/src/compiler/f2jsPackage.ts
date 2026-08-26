// ─────────────────────────────────────────────────────────────────────────────
// Browser-friendly port of buildRenderV2MQuickJsPackage + mquickjs package
// decoder. Produces the exact same F2JS binary shape with Web Crypto SHA-256.
// Mirrors `f1-widget-sdk/src/render-v2/mquickjs.mjs`. All multi-byte writes are
// little-endian.
// ─────────────────────────────────────────────────────────────────────────────

import {
  RENDER_V2_MQUICKJS_EVENT_KINDS,
  RENDER_V2_MQUICKJS_TARGET_WRITES,
  RENDER_V2_MQUICKJS_SOURCE_PREFIX,
} from "./constants";

const MAGIC = "F2JS";
const HEADER_BYTES = 128;
const VERSION = 1;
const SECTION_COUNT = 4;
const FLAG_RASTER_BASE = 1;
const F1WB_BYTES = 62_404;
const F1RA_BYTES = 62_072;
const F1WB_MAGIC = "F1WB";

export const MQUICKJS_LIMITS = {
  headerBytes: HEADER_BYTES,
  packageBytes: 98_304,
  sourceBytes: 8_192,
  heapBytes: 65_536,
  callbackDeadlineUs: 2_000,
  handlers: 16,
  targets: 16,
  keys: 16,
  chords: 8,
  chordKeys: 4,
  eventRecords: 32,
  eventRecordBytes: 16,
  targetRecordBytes: 32,
  rasterBaseBytes: F1WB_BYTES,
};

const EVENTS_OFFSET = 40;
const TARGETS_OFFSET = 46;
const SOURCE_OFFSET = 52;
const ASSET_OFFSET = 58;
const SOURCE_SHA_OFFSET = 64;
const BODY_SHA_OFFSET = 96;

interface BuildOptions {
  source: string;
  generation?: number;
  events?: {
    "tick.100ms"?: boolean;
    "tick.1s"?: boolean;
    "input.fn-bottom-knob"?: boolean;
    hostRpcIds?: number[];
    keys?: { id?: number; nativeToken: number }[];
    chords?: { id?: number; heldMask: number }[];
  };
  targets?: { id: string; writes: ("textContent" | "color" | "hidden" | "className" | "animation")[] }[];
  input?: { debounceMs?: number; holdDelayMs?: number; holdCadenceMs?: number };
  rasterBase?: Uint8Array | null;
}

const TARGET_ID = /^[A-Za-z][A-Za-z0-9_-]{0,15}$/;

function uint(value: number, maximum: number, label: string): number {
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new RangeError(`${label} must be an integer in 0..${maximum}. Got ${value}.`);
  }
  return value;
}

function uint32(value: number, label: string): number {
  return uint(value, 0xffffffff, label);
}

function bitCount16(value: number): number {
  let count = 0;
  for (let bits = value & 0xffff; bits !== 0; bits >>>= 1) count += bits & 1;
  return count;
}

interface NormalizedEvents {
  records: { kind: number; id: number; nativeToken: number; heldMask: number }[];
  keyCount: number;
  chordCount: number;
}

function normalizeEvents(events: BuildOptions["events"] = {}): NormalizedEvents {
  const records: { kind: number; id: number; nativeToken: number; heldMask: number }[] = [];
  const singleton = ["tick.100ms", "tick.1s", "input.fn-bottom-knob"] as const;
  for (const name of singleton) if (events[name] === true) {
    records.push({ kind: RENDER_V2_MQUICKJS_EVENT_KINDS[name], id: 0, nativeToken: 0, heldMask: 0 });
  }
  const hostIds = (events.hostRpcIds ?? []).map((v) => uint(v, 0xffff, "host RPC id"));
  if (new Set(hostIds).size !== hostIds.length || hostIds.includes(0)) {
    throw new RangeError("Host RPC ids must be unique nonzero uint16.");
  }
  hostIds.sort((a, b) => a - b);
  for (const id of hostIds) records.push({ kind: RENDER_V2_MQUICKJS_EVENT_KINDS["host.rpc"], id, nativeToken: 0, heldMask: 0 });
  const keys = events.keys ?? [];
  if (keys.length > MQUICKJS_LIMITS.keys) throw new RangeError("Too many keys.");
  const tokens = new Set<number>();
  keys.forEach((entry, index) => {
    const id = uint(entry.id ?? index, MQUICKJS_LIMITS.keys - 1, `key ${index} id`);
    if (id !== index) throw new RangeError("Key IDs must be contiguous from zero.");
    const token = uint32(entry.nativeToken, `key ${index} native token`);
    if (tokens.has(token)) throw new RangeError("Key native tokens must be unique.");
    tokens.add(token);
    records.push({ kind: RENDER_V2_MQUICKJS_EVENT_KINDS.key, id, nativeToken: token, heldMask: 0 });
  });
  const admittedMask = keys.length === 16 ? 0xffff : (1 << keys.length) - 1;
  const chords = events.chords ?? [];
  if (chords.length > MQUICKJS_LIMITS.chords) throw new RangeError("Too many chords.");
  const masks = new Set<number>();
  chords.forEach((entry, index) => {
    const id = uint(entry.id ?? index, MQUICKJS_LIMITS.chords - 1, `chord ${index} id`);
    if (id !== index) throw new RangeError("Chord IDs must be contiguous from zero.");
    const heldMask = uint(entry.heldMask, 0xffff, `chord ${index} mask`);
    const count = bitCount16(heldMask);
    if ((heldMask & ~admittedMask) !== 0 || count < 2 || count > 4) {
      throw new RangeError("Chord mask must reference 2..4 admitted keys.");
    }
    if (masks.has(heldMask)) throw new RangeError("Chord masks must be unique.");
    masks.add(heldMask);
    records.push({ kind: RENDER_V2_MQUICKJS_EVENT_KINDS.chord, id, nativeToken: 0, heldMask });
  });
  if (records.length > MQUICKJS_LIMITS.eventRecords) throw new RangeError("Too many event records.");
  return { records, keyCount: keys.length, chordCount: chords.length };
}

function normalizeTargets(targets: BuildOptions["targets"] = []) {
  if (!Array.isArray(targets)) throw new TypeError("targets must be an array.");
  if (targets.length > MQUICKJS_LIMITS.targets) throw new RangeError("Too many targets.");
  const ids = new Set<string>();
  return targets.map((entry, index) => {
    const id = String(entry.id ?? "");
    if (!TARGET_ID.test(id) || ids.has(id)) throw new RangeError(`Target ${id} is invalid or duplicated.`);
    ids.add(id);
    const writes = entry.writes ?? [];
    if (writes.length === 0) throw new RangeError(`Target ${id} declares no writable properties.`);
    let flags = 0;
    for (const w of writes) {
      if (!(w in RENDER_V2_MQUICKJS_TARGET_WRITES)) throw new RangeError(`Unsupported write ${w}.`);
      flags |= (RENDER_V2_MQUICKJS_TARGET_WRITES as any)[w];
    }
    return { index, id, flags };
  });
}

function validateRasterBase(value: Uint8Array | null, generation: number): Uint8Array {
  if (value == null) return new Uint8Array(0);
  if (!(value instanceof Uint8Array)) throw new TypeError("rasterBase must be Uint8Array.");
  const magic = String.fromCharCode(...value.subarray(0, 4));
  if (value.length !== F1WB_BYTES || magic !== F1WB_MAGIC) {
    throw new RangeError("rasterBase must be the canonical 62,404-byte F1WB bundle.");
  }
  const generationField = (value[12] | (value[13] << 8) | (value[14] << 16) | (value[15] << 24)) >>> 0;
  if (generationField !== F1WB_BYTES) throw new RangeError("rasterBase generation field invalid.");
  // (We trust the caller that the bundle matches the supplied generation and is one active slot.)
  return value;
}

function sourceBytes(value: string): Uint8Array {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError("source must be a NUL-free string.");
  }
  const canonical = value.startsWith(RENDER_V2_MQUICKJS_SOURCE_PREFIX)
    ? value
    : `${RENDER_V2_MQUICKJS_SOURCE_PREFIX}${value}`;
  const bytes = new TextEncoder().encode(canonical);
  if (bytes.length === 0 || bytes.length > MQUICKJS_LIMITS.sourceBytes) {
    throw new RangeError(`source must be 1..${MQUICKJS_LIMITS.sourceBytes} bytes.`);
  }
  // round-trip canonical check
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (decoded !== canonical) throw new TypeError("source must be canonical UTF-8.");
  return bytes;
}

function inputTiming(input: BuildOptions["input"] = {}, keyCount: number) {
  if (keyCount === 0) return { debounceMs: 0, holdDelayMs: 0, holdCadenceMs: 0 };
  const debounceMs = uint(input.debounceMs ?? 10, 50, "debounceMs");
  const holdDelayMs = uint(input.holdDelayMs ?? 500, 5_000, "holdDelayMs");
  const holdCadenceMs = uint(input.holdCadenceMs ?? 100, 1_000, "holdCadenceMs");
  if (debounceMs < 1 || holdDelayMs < 100 || holdCadenceMs < 20) {
    throw new RangeError("input timing is below its bounded minimum.");
  }
  return { debounceMs, holdDelayMs, holdCadenceMs };
}

function u24le(value: number): [number, number, number] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff];
}

function align4(v: number): number {
  return (v + 3) & ~3;
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  // Copy into a standalone buffer: a subarray view would hash its whole parent,
  // and it also satisfies BufferSource, which excludes SharedArrayBuffer-backed
  // views.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const buf = await crypto.subtle.digest("SHA-256", copy);
  return new Uint8Array(buf);
}

export interface BuiltPackage {
  /** raw F2JS bytes */
  binary: Uint8Array;
  sha256: string;
  generation: number;
  bytes: number;
  sourceSha256: string;
  bodySha256: string;
  events: NormalizedEvents;
  targets: { index: number; id: string; flags: number }[];
  budget: {
    packageBytes: number;
    sourceBytes: number;
    events: number;
    targets: number;
  };
}

export async function buildF2JSPackage(opts: BuildOptions): Promise<BuiltPackage> {
  const generation = opts.generation ?? 1;
  uint32(generation, "generation");
  if (generation === 0) throw new RangeError("generation 0 is reserved.");

  const sourceBinary = sourceBytes(opts.source);
  const events = normalizeEvents(opts.events);
  const targets = normalizeTargets(opts.targets);
  const timing = inputTiming(opts.input, events.keyCount);
  const rasterBinary = validateRasterBase(opts.rasterBase ?? null, generation);

  // Section directory (offsets relative to header end).
  const eventBytes = events.records.length * MQUICKJS_LIMITS.eventRecordBytes;
  const targetBytes = targets.length * MQUICKJS_LIMITS.targetRecordBytes;
  const sourceSection = concatBytes(sourceBinary, new Uint8Array([0]));

  const eventsAt = HEADER_BYTES;
  const targetsAt = eventsAt + eventBytes;
  const sourceAt = targetsAt + targetBytes;
  const assetAt = align4(sourceAt + sourceSection.length);
  const totalBytes = assetAt + rasterBinary.length;
  if (totalBytes > MQUICKJS_LIMITS.packageBytes) {
    throw new RangeError(`F2JS package oversize: ${totalBytes} > ${MQUICKJS_LIMITS.packageBytes}.`);
  }

  const binary = new Uint8Array(totalBytes);
  const view = new DataView(binary.buffer);

  // Header.
  for (let i = 0; i < 4; i++) binary[i] = MAGIC.charCodeAt(i);
  view.setUint16(4, VERSION, true);
  view.setUint16(6, HEADER_BYTES, true);
  view.setUint32(8, totalBytes, true);
  view.setUint32(12, generation, true);
  view.setUint32(16, rasterBinary.length === 0 ? 0 : FLAG_RASTER_BASE, true);
  view.setUint32(20, MQUICKJS_LIMITS.heapBytes, true);
  view.setUint32(24, MQUICKJS_LIMITS.callbackDeadlineUs, true);
  binary[28] = events.records.length;
  binary[29] = targets.length;
  binary[30] = events.keyCount;
  binary[31] = events.chordCount;
  view.setUint16(32, timing.debounceMs, true);
  view.setUint16(34, timing.holdDelayMs, true);
  view.setUint16(36, timing.holdCadenceMs, true);
  view.setUint16(38, SECTION_COUNT, true);

  // Section directory.
  for (const [offset, start, length] of [
    [EVENTS_OFFSET, eventsAt, eventBytes],
    [TARGETS_OFFSET, targetsAt, targetBytes],
    [SOURCE_OFFSET, sourceAt, sourceSection.length],
    [ASSET_OFFSET, assetAt, rasterBinary.length],
  ] as Array<[number, number, number]>) {
    const [a, b, c] = u24le(start);
    binary[offset] = a; binary[offset + 1] = b; binary[offset + 2] = c;
    const [d, e, f] = u24le(length);
    binary[offset + 3] = d; binary[offset + 4] = e; binary[offset + 5] = f;
  }

  // Source SHA (over the canonical source, no trailing NUL).
  const sourceSha = await sha256(sourceBinary);
  binary.set(sourceSha, SOURCE_SHA_OFFSET);

  // Event records.
  let off = eventsAt;
  for (const record of events.records) {
    binary[off] = record.kind;
    binary[off + 1] = 0;
    view.setUint16(off + 2, record.id, true);
    view.setUint32(off + 4, record.nativeToken, true);
    view.setUint16(off + 8, record.heldMask, true);
    off += MQUICKJS_LIMITS.eventRecordBytes;
  }

  // Target records.
  off = targetsAt;
  for (const t of targets) {
    view.setUint16(off, t.index, true);
    view.setUint16(off + 2, t.flags, true);
    binary[off + 4] = t.id.length;
    for (let i = 0; i < t.id.length; i++) binary[off + 8 + i] = t.id.charCodeAt(i);
    off += MQUICKJS_LIMITS.targetRecordBytes;
  }

  // Source section.
  binary.set(sourceSection, sourceAt);

  // Pad to align4.
  for (let i = sourceAt + sourceSection.length; i < assetAt; i++) binary[i] = 0;

  // Asset.
  if (rasterBinary.length > 0) binary.set(rasterBinary, assetAt);

  // Body SHA (everything past the header).
  const bodySha = await sha256(binary.subarray(HEADER_BYTES));
  binary.set(bodySha, BODY_SHA_OFFSET);

  const fullSha = await sha256(binary);

  return {
    binary,
    sha256: toHex(fullSha),
    generation,
    bytes: binary.length,
    sourceSha256: toHex(sourceSha),
    bodySha256: toHex(bodySha),
    events,
    targets,
    budget: {
      packageBytes: binary.length,
      sourceBytes: sourceBinary.length,
      events: events.records.length,
      targets: targets.length,
    },
  };
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

/** Best-effort download in the browser. */
export function downloadPackage(packageBytes: Uint8Array, filename: string) {
  // Copy into a fresh ArrayBuffer so Blob accepts it across the structured-clone boundary.
  const copy = new Uint8Array(packageBytes);
  const blob = new Blob([copy], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}
