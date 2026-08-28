// Multi-widget slot bank (docs/17) — additive v2 of widget.mquickjs.upload.
// Covers the op-5 inventory parser, the optional sl/sn on the op-0 status
// reply, the per-slot generation ratchet, the pure slot-bank model builder, the
// slot-threaded push (begin carries slot; the running-generation pre-check is
// skipped for a targeted slot), the op-5/op-6 transport helpers, and the local
// sha→name registry's pure helpers.

import { describe, expect, it, vi } from "vitest";

import { buildUploadContainer } from "../src/compiler/uploadContainer";
import {
  activateWidgetSlot,
  buildSlotBank,
  nextSlotGeneration,
  parseWidgetInventoryReply,
  parseWidgetUploadReply,
  probeWidgetInventory,
  pushWidgetUpload,
  WIDGET_PERSIST_STATE,
  WIDGET_UPLOAD_METHOD,
  type WidgetInventoryReply,
  type WidgetUploadReply,
} from "../src/device/widget-upload";
import { mergeEntry, normalizeSha16, parseRegistry } from "../src/device/slotRegistry";

// ── op-5 inventory parsing ───────────────────────────────────────────────────

describe("parseWidgetInventoryReply", () => {
  it("parses an occupied slot", () => {
    const reply = parseWidgetInventoryReply(
      "v1;op=5;rc=0;slot=1;present=1;g=3;sha=aabbccddeeff00112233445566778899",
    )!;
    expect(reply).not.toBeNull();
    expect(reply.op).toBe(5);
    expect(reply.rc).toBe(0);
    expect(reply.slot).toBe(1);
    expect(reply.present).toBe(true);
    expect(reply.g).toBe(3);
    expect(reply.sha16).toBe("aabbccddeeff00112233445566778899");
  });

  it("parses an empty slot (present=0, zeroed sha)", () => {
    const reply = parseWidgetInventoryReply(
      "v1;op=5;rc=0;slot=3;present=0;g=0;sha=00000000000000000000000000000000",
    )!;
    expect(reply.present).toBe(false);
    expect(reply.g).toBe(0);
    expect(reply.slot).toBe(3);
  });

  it("reads g as hex and lowercases the sha", () => {
    const reply = parseWidgetInventoryReply(
      "v1;op=5;rc=0;slot=0;present=1;g=1F;sha=AABBCCDDEEFF00112233445566778899",
    )!;
    expect(reply.g).toBe(0x1f);
    expect(reply.sha16).toBe("aabbccddeeff00112233445566778899");
  });

  it("reads a signed rc", () => {
    const reply = parseWidgetInventoryReply(
      "v1;op=5;rc=fffffff9;slot=2;present=0;g=0;sha=0",
    )!;
    expect(reply.rc).toBe(-7);
  });

  it("rejects a status reply and any non-op-5 shape", () => {
    // An op-0 status string must not be mistaken for an inventory reply.
    expect(parseWidgetInventoryReply("v1;op=0;rc=0;st=0;rx=0;g=4;pg=4;ps=0;ad=0")).toBeNull();
    expect(parseWidgetInventoryReply("v1;op=6;rc=0;slot=1;present=1;g=1;sha=aa")).toBeNull();
    expect(parseWidgetInventoryReply(null)).toBeNull();
    expect(parseWidgetInventoryReply("")).toBeNull();
    expect(parseWidgetInventoryReply("v1;op=5;rc=0;present=1;g=1;sha=aa")).toBeNull(); // no slot
    expect(parseWidgetInventoryReply("v1;op=5;rc=0;slot=1;present=2;g=1;sha=aa")).toBeNull(); // present∉{0,1}
    expect(parseWidgetInventoryReply("v1;op=5;rc=0;slot=x;present=1;g=1;sha=aa")).toBeNull(); // slot !digit
  });
});

// ── op-0 status: additive sl/sn are OPTIONAL ────────────────────────────────

describe("parseWidgetUploadReply — sl/sn additive fields", () => {
  it("reads sl and sn when the reply carries them", () => {
    const reply = parseWidgetUploadReply(
      "v1;op=0;rc=0;st=0;rx=0;g=4;pg=4;ps=0;ad=0;sl=2;sn=4",
    )!;
    expect(reply.sl).toBe(2);
    expect(reply.sn).toBe(4);
  });

  it("still parses a single-slot reply that omits sl/sn", () => {
    const reply = parseWidgetUploadReply("v1;op=0;rc=0;st=0;rx=0;g=4;pg=4;ps=0;ad=0")!;
    expect(reply).not.toBeNull();
    expect(reply.sl).toBeUndefined();
    expect(reply.sn).toBeUndefined();
    // The required fields are untouched by the additive parse.
    expect(reply.g).toBe(4);
    expect(reply.ad).toBe(0);
  });
});

// ── per-slot generation ratchet ─────────────────────────────────────────────

describe("nextSlotGeneration", () => {
  const inv = (over: Partial<WidgetInventoryReply>): WidgetInventoryReply => ({
    op: 5, rc: 0, slot: 0, present: false, g: 0, sha16: "", raw: "", ...over,
  });

  it("is 1 for an empty slot (first push)", () => {
    expect(nextSlotGeneration(inv({ present: false, g: 0 }))).toBe(1);
  });
  it("is the slot's persisted generation + 1 for an occupied slot", () => {
    expect(nextSlotGeneration(inv({ present: true, g: 3 }))).toBe(4);
  });
  it("is 1 when the inventory is unreadable (null) or errored (rc != 0)", () => {
    expect(nextSlotGeneration(null)).toBe(1);
    expect(nextSlotGeneration(inv({ present: true, g: 9, rc: -1 }))).toBe(1);
  });
});

// ── pure slot-bank model builder ─────────────────────────────────────────────

describe("buildSlotBank", () => {
  const status = (over: Partial<WidgetUploadReply>): WidgetUploadReply => ({
    op: 0, rc: 0, st: 0, rx: 0, g: 9, pg: 9, ps: 0,
    persist: { state: 0, step: 0 }, ad: 0, raw: "", ...over,
  });
  const inv = (over: Partial<WidgetInventoryReply>): WidgetInventoryReply => ({
    op: 5, rc: 0, slot: 0, present: false, g: 0, sha16: "", raw: "", ...over,
  });

  it("folds op-0 sl/sn/g and op-5 replies into slot views", () => {
    const model = buildSlotBank(status({ g: 9, sl: 1, sn: 3 }), [
      inv({ slot: 0, present: true, g: 5, sha16: "aa" }),
      inv({ slot: 1, present: true, g: 2, sha16: "bb" }),
      null,
    ]);
    expect(model.running).toBe(9);
    expect(model.activeSlot).toBe(1);
    expect(model.slotCount).toBe(3);

    expect(model.slots[0]).toMatchObject({
      slot: 0, present: true, active: false, generation: 5, sha16: "aa", nextGeneration: 6, unknown: false,
    });
    // Active slot is marked from sl, not from present.
    expect(model.slots[1]).toMatchObject({ slot: 1, active: true, present: true, nextGeneration: 3 });
    // Unreadable slot: unknown, empty identity, push would be generation 1.
    expect(model.slots[2]).toMatchObject({
      slot: 2, present: false, unknown: true, sha16: "", generation: 0, nextGeneration: 1,
    });
  });

  it("treats an rc != 0 inventory as unknown/empty", () => {
    const model = buildSlotBank(status({ sl: 0, sn: 1 }), [inv({ present: true, g: 4, rc: -2 })]);
    expect(model.slots[0].present).toBe(false);
    expect(model.slots[0].unknown).toBe(true);
  });

  it("defaults slotCount to the inventory length and activeSlot to 0 pre-v2", () => {
    // status without sl/sn (single-slot firmware shape).
    const model = buildSlotBank(status({}), [inv({ present: true, g: 1, sha16: "cc" }), null]);
    expect(model.slotCount).toBe(2);
    expect(model.activeSlot).toBe(0);
    expect(model.slots[0].active).toBe(true);
  });
});

// ── slot-threaded push ───────────────────────────────────────────────────────

/** Container ~3 chunks (two full + a partial tail), baked at `generation`. */
function sampleContainer(generation: number) {
  return buildUploadContainer({
    f2js: Uint8Array.from({ length: 3_000 }, (_, i) => (i * 7) & 0xff),
    f2tf: Uint8Array.from({ length: 2_000 }, (_, i) => (i * 13) & 0xff),
    lzss: Uint8Array.from({ length: 2_500 }, (_, i) => (i * 3) & 0xff),
    generation,
  });
}

/** A slot-aware scripted device: op 0 carries sl/sn, begin echoes/records the
 *  slot, op 5/6 answer per-slot, and the persist machine walks to DONE. */
function slotDevice(opts: {
  running?: number;
  activeSlot?: number;
  slotCount?: number;
  inventory?: Record<number, { present: boolean; g: number; sha?: string }>;
} = {}) {
  const running = opts.running ?? 4;
  let activeSlot = opts.activeSlot ?? 0;
  const slotCount = opts.slotCount ?? 4;
  const inventory = opts.inventory ?? {};
  const calls: { method: string; params: any }[] = [];
  const st = { received: 0, txState: 0, ps: 0, persisted: running, beginGen: 0 };
  const persistTrack = [WIDGET_PERSIST_STATE.done];
  const hex = (v: number) => (v >>> 0).toString(16);
  const status = (op: number, rc: number) =>
    `v1;op=${op};rc=${hex(rc)};st=${st.txState};rx=${hex(st.received)};g=${hex(running)};` +
    `pg=${hex(st.persisted)};ps=${hex(st.ps)};ad=0;sl=${hex(activeSlot)};sn=${hex(slotCount)}`;

  const rpc = vi.fn(async (method: string, params: any) => {
    calls.push({ method, params });
    const op = params.op as number;
    if (op === 0) {
      if (persistTrack.length && st.ps !== 0) {
        st.ps = persistTrack.shift()!;
        if ((st.ps & 0xff) === WIDGET_PERSIST_STATE.done) st.persisted = st.beginGen;
      }
      return { status: status(0, 0) };
    }
    if (op === 5) {
      const rec = inventory[params.slot];
      return {
        status:
          `v1;op=5;rc=0;slot=${params.slot};present=${rec?.present ? 1 : 0};` +
          `g=${hex(rec?.g ?? 0)};sha=${rec?.sha ?? "00000000000000000000000000000000"}`,
      };
    }
    if (op === 6) {
      const occupied = inventory[params.slot]?.present;
      if (occupied) activeSlot = params.slot;
      return { status: status(6, occupied ? 0 : -1) };
    }
    if (op === 1) {
      st.txState = 1; st.received = 0; st.beginGen = params.generation;
      return { status: status(1, 0) };
    }
    if (op === 2) {
      st.received += Uint8Array.from(atob(params.data), (c) => c.charCodeAt(0)).length;
      return { status: status(2, 0) };
    }
    if (op === 3) { st.txState = 2; st.ps = WIDGET_PERSIST_STATE.armed; return { status: status(3, 0) }; }
    if (op === 4) { st.txState = 0; st.received = 0; return { status: status(4, 0) }; }
    throw new Error(`unknown op ${op}`);
  });
  return { rpc, calls };
}

describe("pushWidgetUpload — slot targeting", () => {
  it("pushes generation 1 to an empty slot even while a different generation runs", async () => {
    // Device runs generation 4; slot 3 is empty. A first push there is
    // generation 1 — the running-generation pre-check must NOT fire for a
    // targeted slot.
    const container = await sampleContainer(1);
    const { rpc, calls } = slotDevice({ running: 4, activeSlot: 0, slotCount: 4 });
    const result = await pushWidgetUpload({
      rpc, container, generation: 1, slot: 3, pollIntervalMs: 1, pollLimit: 10,
    });
    expect(result.generation).toBe(1);
    expect(result.chunks).toBe(3);
    expect(result.persistStatus.state).toBe(WIDGET_PERSIST_STATE.done);

    // begin carried the slot and the per-slot generation.
    const begin = calls.find((c) => c.params.op === 1)!.params;
    expect(begin).toEqual({ op: 1, generation: 1, totalBytes: container.bytes, slot: 3 });
  });

  it("still enforces the running-generation pre-check on the DEFAULT (no-slot) path", async () => {
    // Same device (running 4), same container baked at 1, but no slot → the
    // active-slot ratchet rejects generation 1 before any begin.
    const container = await sampleContainer(1);
    const { rpc, calls } = slotDevice({ running: 4 });
    const failure = await pushWidgetUpload({
      rpc, container, generation: 1, pollIntervalMs: 1, pollLimit: 10,
    }).catch((e) => e as Error & { code?: string });
    expect((failure as any).code).toBe("WIDGET_UPLOAD_GENERATION");
    expect(calls.map((c) => c.params.op)).toEqual([0]); // probe only
  });
});

// ── transport helpers ────────────────────────────────────────────────────────

describe("op-5 / op-6 transport helpers", () => {
  it("probeWidgetInventory sends {op:5, slot} and parses the reply", async () => {
    const { rpc } = slotDevice({ inventory: { 2: { present: true, g: 6, sha: "abcabcabcabcabcabcabcabcabcabcab" } } });
    const inv = await probeWidgetInventory(rpc, 2);
    expect(rpc).toHaveBeenCalledWith(WIDGET_UPLOAD_METHOD, { op: 5, slot: 2 });
    expect(inv?.present).toBe(true);
    expect(inv?.g).toBe(6);
    expect(inv?.sha16).toBe("abcabcabcabcabcabcabcabcabcabcab");
  });

  it("probeWidgetInventory returns null on a throwing/garbage transport", async () => {
    expect(await probeWidgetInventory(vi.fn(async () => { throw new Error("x"); }), 0)).toBeNull();
    expect(await probeWidgetInventory(vi.fn(async () => ({ status: "nope" })), 0)).toBeNull();
  });

  it("activateWidgetSlot sends {op:6, slot}; rc 0 on an occupied slot, rc != 0 on empty", async () => {
    const { rpc } = slotDevice({ inventory: { 1: { present: true, g: 2 } } });
    const ok = await activateWidgetSlot(rpc, 1);
    expect(rpc).toHaveBeenCalledWith(WIDGET_UPLOAD_METHOD, { op: 6, slot: 1 });
    expect(ok?.rc).toBe(0);
    const empty = await activateWidgetSlot(rpc, 3);
    expect(empty?.rc).not.toBe(0);
  });
});

// ── local sha→name registry (pure helpers) ──────────────────────────────────

describe("slotRegistry pure helpers", () => {
  it("normalizes a sha to 32 lowercase hex chars", () => {
    expect(normalizeSha16("AABBCCDDEEFF00112233445566778899")).toBe("aabbccddeeff00112233445566778899");
    // Non-hex is stripped; over-length is clamped to the op-5 key width.
    expect(normalizeSha16("aa:bb:cc:dd:ee:ff:00:11:22:33:44:55:66:77:88:99:extra")).toBe(
      "aabbccddeeff00112233445566778899",
    );
    expect(normalizeSha16(42 as unknown as string)).toBe("");
  });

  it("parseRegistry keeps well-formed entries and drops junk", () => {
    const reg = parseRegistry(
      JSON.stringify({
        "aabbccddeeff00112233445566778899": { name: "Weather", pushedAt: 123, generation: 4 },
        "short": { name: "bad key" },
        "0f1e2d3c4b5a69788796a5b4c3d2e1f0": { notName: true },
      }),
    );
    expect(Object.keys(reg)).toEqual(["aabbccddeeff00112233445566778899"]);
    expect(reg["aabbccddeeff00112233445566778899"]).toEqual({ name: "Weather", pushedAt: 123, generation: 4 });
    // Bad JSON is inert.
    expect(parseRegistry("{not json")).toEqual({});
  });

  it("mergeEntry adds/overwrites by normalized key and ignores bad keys", () => {
    const base = {} as Record<string, { name: string; pushedAt: number }>;
    const one = mergeEntry(base, "AABBCCDDEEFF00112233445566778899", { name: "A", pushedAt: 1 });
    expect(one["aabbccddeeff00112233445566778899"].name).toBe("A");
    const two = mergeEntry(one, "aabbccddeeff00112233445566778899", { name: "B", pushedAt: 2 });
    expect(two["aabbccddeeff00112233445566778899"].name).toBe("B");
    // Too-short key is a no-op (returns the same registry).
    expect(mergeEntry(one, "abc", { name: "x", pushedAt: 0 })).toBe(one);
  });
});
