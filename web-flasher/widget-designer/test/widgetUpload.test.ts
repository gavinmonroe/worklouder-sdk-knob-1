// Transport contract tests for the widget.mquickjs.upload client against a
// scripted fake device: exact op sequence and param names, canonical base64
// chunk payloads at strict in-order offsets, the 3,072-byte chunk split with a
// partial tail, status polling until the persist machine reads DONE, abort on
// chunk/commit failure, and reply parsing of every status field.

import { describe, expect, it, vi } from "vitest";

import { buildUploadContainer } from "../src/compiler/uploadContainer";
import {
  parseWidgetUploadReply,
  probeWidgetUploadStatus,
  pushWidgetUpload,
  WIDGET_PERSIST_STATE,
  WIDGET_UPLOAD_CHUNK_RAW_BYTES,
  WIDGET_UPLOAD_METHOD,
  WidgetUploadError,
} from "../src/device/widget-upload";

/** A container big enough for 3 chunks (two full + one partial). */
async function sampleContainer(generation = 5) {
  return buildUploadContainer({
    f2js: Uint8Array.from({ length: 3_000 }, (_, i) => (i * 7) & 0xff),
    f2tf: Uint8Array.from({ length: 2_000 }, (_, i) => (i * 13) & 0xff),
    lzss: Uint8Array.from({ length: 2_500 }, (_, i) => (i * 3) & 0xff),
    generation,
  });
}

interface DeviceState {
  running: number;      // g
  persisted: number;    // pg
  received: number;     // rx
  st: number;
  ps: number;
}

/** A scripted device that speaks the frozen v1 reply string. */
function fakeDevice(options: {
  running?: number;
  /** ps values the status op walks through AFTER commit, one per poll. */
  persistTrack?: number[];
  /** Override one op's rc, keyed by "begin" | "chunk:<n>" | "commit". */
  rejectWith?: Record<string, number>;
} = {}) {
  const state: DeviceState = {
    running: options.running ?? 4,
    persisted: options.running ?? 4,
    received: 0,
    st: 0,
    ps: 0,
  };
  const persistTrack = [...(options.persistTrack ?? [])];
  const calls: { method: string; params: any }[] = [];
  let chunkIndex = 0;

  const hex = (value: number) => (value >>> 0).toString(16);
  const reply = (op: number, rc: number) =>
    `v1;op=${op};rc=${hex(rc)};st=${state.st};rx=${hex(state.received)};` +
    `g=${hex(state.running)};pg=${hex(state.persisted)};ps=${hex(state.ps)};ad=0`;

  const rpc = vi.fn(async (method: string, params: any) => {
    calls.push({ method, params });
    const op = params.op as number;
    if (op === 0) {
      if (persistTrack.length > 0 && state.ps !== 0) {
        state.ps = persistTrack.shift()!;
        if ((state.ps & 0xff) === WIDGET_PERSIST_STATE.done) {
          state.persisted = calls.find((c) => c.params.op === 1)?.params.generation ?? state.persisted;
        }
      }
      return { status: reply(0, 0) };
    }
    if (op === 1) {
      const rc = options.rejectWith?.begin ?? 0;
      if (rc === 0) { state.st = 1; state.received = 0; chunkIndex = 0; }
      return { status: reply(1, rc) };
    }
    if (op === 2) {
      const rc = options.rejectWith?.[`chunk:${chunkIndex}`] ?? 0;
      chunkIndex += 1;
      if (rc === 0) {
        const raw = Uint8Array.from(atob(params.data), (ch) => ch.charCodeAt(0));
        state.received += raw.length;
      }
      return { status: reply(2, rc) };
    }
    if (op === 3) {
      const rc = options.rejectWith?.commit ?? 0;
      if (rc === 0) { state.st = 2; state.ps = WIDGET_PERSIST_STATE.armed; }
      return { status: reply(3, rc) };
    }
    if (op === 4) {
      state.st = 0; state.received = 0;
      return { status: reply(4, 0) };
    }
    throw new Error(`unknown op ${op}`);
  });
  return { rpc, calls, state };
}

const push = (rpc: any, container: any, generation = 5) =>
  pushWidgetUpload({ rpc, container, generation, pollIntervalMs: 1, pollLimit: 10 });

describe("widget.mquickjs.upload reply parsing", () => {
  it("parses every field of the frozen status string", () => {
    const reply = parseWidgetUploadReply("v1;op=2;rc=0;st=1;rx=c00;g=13;pg=12;ps=302;ad=0")!;
    expect(reply).not.toBeNull();
    expect(reply.op).toBe(2);
    expect(reply.rc).toBe(0);
    expect(reply.st).toBe(1);
    expect(reply.rx).toBe(0xc00); // hex, not decimal: 3072 bytes
    expect(reply.g).toBe(0x13);
    expect(reply.pg).toBe(0x12);
    expect(reply.ps).toBe(0x302);
    expect(reply.persist).toEqual({ state: 2, step: 3 });
    expect(reply.ad).toBe(0);
    expect(reply.raw).toBe("v1;op=2;rc=0;st=1;rx=c00;g=13;pg=12;ps=302;ad=0");
  });

  it("reads rc and ad as signed hex32", () => {
    const reply = parseWidgetUploadReply("v1;op=3;rc=fffffff9;st=3;rx=0;g=4;pg=4;ps=0;ad=fffffff7")!;
    expect(reply.rc).toBe(-7);
    expect(reply.ad).toBe(-9);
  });

  it("rejects malformed replies", () => {
    expect(parseWidgetUploadReply(null)).toBeNull();
    expect(parseWidgetUploadReply("")).toBeNull();
    expect(parseWidgetUploadReply("v2;op=0;rc=0;st=0;rx=0;g=0;pg=0;ps=0;ad=0")).toBeNull();
    expect(parseWidgetUploadReply("v1;op=0;rc=0;st=0;rx=0;g=0;pg=0;ps=0")).toBeNull(); // ad missing
    expect(parseWidgetUploadReply("v1;op=0;rc=zz;st=0;rx=0;g=0;pg=0;ps=0;ad=0")).toBeNull();
    expect(parseWidgetUploadReply("v1;op=0;rc;st=0;rx=0;g=0;pg=0;ps=0;ad=0")).toBeNull();
  });

  it("probes status through the {status} result shape", async () => {
    const { rpc } = fakeDevice({ running: 9 });
    const probed = await probeWidgetUploadStatus(rpc);
    expect(probed?.g).toBe(9);
    expect(rpc).toHaveBeenCalledWith(WIDGET_UPLOAD_METHOD, { op: 0 });
  });

  it("returns null when the probe throws or answers garbage", async () => {
    expect(await probeWidgetUploadStatus(vi.fn(async () => { throw new Error("nope"); }))).toBeNull();
    expect(await probeWidgetUploadStatus(vi.fn(async () => ({ status: "not-a-reply" })))).toBeNull();
  });
});

describe("pushWidgetUpload", () => {
  it("drives probe → begin → in-order chunks → commit → polls to DONE", async () => {
    const container = await sampleContainer(5);
    const { rpc, calls } = fakeDevice({
      running: 4,
      persistTrack: [
        WIDGET_PERSIST_STATE.erase,
        WIDGET_PERSIST_STATE.write | (3 << 8),
        WIDGET_PERSIST_STATE.done,
      ],
    });
    const progress: string[] = [];
    const result = await pushWidgetUpload({
      rpc, container, generation: 5,
      pollIntervalMs: 1, pollLimit: 10,
      onProgress: (p) => progress.push(p.stage),
    });

    expect(result.generation).toBe(5);
    expect(result.bytes).toBe(container.bytes);
    expect(result.chunks).toBe(3);
    expect(result.persistStatus.state).toBe(WIDGET_PERSIST_STATE.done);

    // Exactly one method, op-discriminated.
    expect(new Set(calls.map((c) => c.method))).toEqual(new Set([WIDGET_UPLOAD_METHOD]));

    // op sequence: status probe, begin, 3 chunks, commit, then status polls.
    const ops = calls.map((c) => c.params.op);
    expect(ops.slice(0, 6)).toEqual([0, 1, 2, 2, 2, 3]);
    expect(ops.slice(6).every((op: number) => op === 0)).toBe(true);
    expect(ops.slice(6).length).toBe(3); // erase, write, done

    // begin carries exactly {op, generation, totalBytes}.
    const begin = calls[1].params;
    expect(begin).toEqual({ op: 1, generation: 5, totalBytes: container.bytes });

    // chunks carry {op, offset, data} at strict in-order offsets, 3072-byte raw
    // slices with a partial tail, as canonical base64 with no whitespace.
    const chunks = calls.filter((c) => c.params.op === 2).map((c) => c.params);
    expect(chunks.map((c) => Object.keys(c).sort())).toEqual([
      ["data", "offset", "op"], ["data", "offset", "op"], ["data", "offset", "op"],
    ]);
    expect(chunks.map((c) => c.offset)).toEqual([0, 3072, 6144]);
    const reassembled = new Uint8Array(container.bytes);
    chunks.forEach((chunk, index) => {
      expect(chunk.data).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
      expect(chunk.data.length).toBeLessThanOrEqual(4096);
      const raw = Uint8Array.from(atob(chunk.data), (ch) => ch.charCodeAt(0));
      expect(raw.length).toBe(index < 2 ? WIDGET_UPLOAD_CHUNK_RAW_BYTES : container.bytes - 6144);
      if (index < 2) expect(chunk.data.length).toBe(4096);
      reassembled.set(raw, chunk.offset);
    });
    expect(Buffer.from(reassembled).equals(Buffer.from(container.binary))).toBe(true);

    // commit is bare; the polls are bare status ops.
    expect(calls[5].params).toEqual({ op: 3 });
    expect(calls[6].params).toEqual({ op: 0 });

    expect(progress[0]).toBe("status-probe");
    expect(progress).toContain("uploading-chunks");
    expect(progress).toContain("committing");
    expect(progress).toContain("persisting");
    expect(progress.at(-1)).toBe("persisted");
  });

  it("aborts and names the op and rc when a chunk is rejected", async () => {
    const container = await sampleContainer(5);
    const { rpc, calls } = fakeDevice({ running: 4, rejectWith: { "chunk:1": -5 } });
    const failure = await push(rpc, container).catch((cause) => cause as WidgetUploadError);
    expect(failure).toBeInstanceOf(WidgetUploadError);
    expect(failure.op).toBe("chunk 1");
    expect(failure.rc).toBe(-5);
    expect(failure.message).toMatch(/chunk 1.*rc=-5.*out of order/s);
    // Best-effort abort followed the failure; nothing was committed.
    expect(calls.at(-1)!.params).toEqual({ op: 4 });
    expect(calls.some((c) => c.params.op === 3)).toBe(false);
  });

  it("aborts when the commit is rejected, naming the admit detail", async () => {
    const container = await sampleContainer(5);
    const { rpc, calls, state } = fakeDevice({ running: 4, rejectWith: { commit: -7 } });
    // Ride the admit detail through the reply.
    const original = rpc.getMockImplementation()!;
    rpc.mockImplementation(async (method: string, params: any) => {
      const result = await original(method, params);
      if (params.op === 3) result.status = result.status.replace(/ad=0$/, "ad=fffffff8");
      return result;
    });
    const failure = await push(rpc, container).catch((cause) => cause as WidgetUploadError);
    expect(failure).toBeInstanceOf(WidgetUploadError);
    expect(failure.op).toBe("commit");
    expect(failure.rc).toBe(-7);
    expect(failure.message).toMatch(/commit.*admission failed.*header crc/s);
    expect(calls.at(-1)!.params).toEqual({ op: 4 });
    expect(state.st).toBe(0); // the fake device saw the abort
  });

  it("rejects begin failures without sending an abort", async () => {
    const container = await sampleContainer(5);
    const { rpc, calls } = fakeDevice({ running: 4, rejectWith: { begin: -3 } });
    const failure = await push(rpc, container).catch((cause) => cause as WidgetUploadError);
    expect(failure.op).toBe("begin");
    expect(failure.rc).toBe(-3);
    expect(calls.some((c) => c.params.op === 4)).toBe(false);
  });

  it("fails fast when the device's running generation does not fit the container", async () => {
    const container = await sampleContainer(5);
    const { rpc, calls } = fakeDevice({ running: 9 });
    const failure = await push(rpc, container, 5).catch((cause) => cause as WidgetUploadError);
    expect(failure.code).toBe("WIDGET_UPLOAD_GENERATION");
    expect(failure.message).toMatch(/running\s+generation 9 and accepts exactly 10/);
    // Only the probe went out — no begin, no chunks.
    expect(calls.map((c) => c.params.op)).toEqual([0]);
  });

  it("refuses a container baked for a different generation than the push", async () => {
    const container = await sampleContainer(6);
    const { rpc, calls } = fakeDevice({ running: 4 });
    const failure = await push(rpc, container, 5).catch((cause) => cause as WidgetUploadError);
    expect(failure.code).toBe("WIDGET_UPLOAD_INVALID");
    expect(failure.message).toMatch(/baked for generation 6.*asked for 5/s);
    expect(calls).toHaveLength(0);
  });

  it("treats an unparseable reply as indeterminate and does not abort", async () => {
    const container = await sampleContainer(5);
    const device = fakeDevice({ running: 4 });
    const rpc = vi.fn(async (method: string, params: any) => {
      if (params.op === 2) return { status: "ok" }; // not a v1 reply string
      return device.rpc(method, params);
    });
    const failure = await push(rpc, container).catch((cause) => cause as WidgetUploadError);
    expect(failure.code).toBe("WIDGET_UPLOAD_INDETERMINATE");
    expect(rpc.mock.calls.some(([, params]) => (params as any).op === 4)).toBe(false);
  });

  it("desync between rx and the sent bytes aborts with a typed error", async () => {
    const container = await sampleContainer(5);
    const device = fakeDevice({ running: 4 });
    const rpc = vi.fn(async (method: string, params: any) => {
      const result = await device.rpc(method, params);
      if (params.op === 2 && params.offset === 3072) {
        result.status = result.status.replace(/rx=[0-9a-f]+/, "rx=1");
      }
      return result;
    });
    const failure = await push(rpc, container).catch((cause) => cause as WidgetUploadError);
    expect(failure.code).toBe("WIDGET_UPLOAD_DESYNC");
    expect(rpc.mock.calls.at(-1)![1].op).toBe(4);
  });

  it("fails with a persist error when the machine reports FAILED", async () => {
    const container = await sampleContainer(5);
    const { rpc } = fakeDevice({
      running: 4,
      persistTrack: [WIDGET_PERSIST_STATE.erase, WIDGET_PERSIST_STATE.failed | (2 << 8)],
    });
    const failure = await push(rpc, container).catch((cause) => cause as WidgetUploadError);
    expect(failure.code).toBe("WIDGET_UPLOAD_PERSIST_FAILED");
    expect(failure.op).toBe("persist");
    expect(failure.message).toMatch(/step 2/);
  });

  it("times out when the persist machine never reaches DONE", async () => {
    const container = await sampleContainer(5);
    const { rpc } = fakeDevice({ running: 4, persistTrack: Array(50).fill(WIDGET_PERSIST_STATE.write) });
    const failure = await pushWidgetUpload({
      rpc, container, generation: 5, pollIntervalMs: 1, pollLimit: 4,
    }).catch((cause) => cause as WidgetUploadError);
    expect(failure.code).toBe("WIDGET_UPLOAD_PERSIST_TIMEOUT");
    expect(failure.message).toMatch(/4 polls/);
  });

  it("keeps polling past a stale DONE whose persisted generation is not ours", async () => {
    const container = await sampleContainer(5);
    // Persisted generation only flips to 5 when OUR done lands (the fake tracks
    // pg through the begin generation); a DONE with pg=4 must not resolve.
    const { rpc, calls } = fakeDevice({
      running: 4,
      persistTrack: [WIDGET_PERSIST_STATE.write, WIDGET_PERSIST_STATE.done],
    });
    // Sabotage: report pg=4 on the first DONE poll only.
    let doneSeen = 0;
    const original = rpc.getMockImplementation()!;
    rpc.mockImplementation(async (method: string, params: any) => {
      const result = await original(method, params);
      if (params.op === 0 && /ps=6/.test(result.status) && doneSeen++ === 0) {
        result.status = result.status.replace(/pg=[0-9a-f]+/, "pg=4");
      }
      return result;
    });
    const result = await pushWidgetUpload({
      rpc, container, generation: 5, pollIntervalMs: 1, pollLimit: 3,
    });
    // The stale DONE (pg=4) was skipped; only the DONE carrying OUR generation
    // resolved the push — one extra poll past the first DONE.
    expect(result.persistStatus.state).toBe(WIDGET_PERSIST_STATE.done);
    const polls = calls.filter((c) => c.params.op === 0);
    expect(polls.length).toBe(4); // probe + write + stale DONE + real DONE
  });

  it("rejects non-F2UP payloads and oversize containers before any RPC", async () => {
    const { rpc, calls } = fakeDevice({});
    const notF2up = new Uint8Array(256);
    await expect(
      pushWidgetUpload({ rpc, container: { binary: notF2up }, generation: 1 }),
    ).rejects.toThrow(/bad magic/);
    const oversize = new Uint8Array(98_305);
    oversize.set([0x46, 0x32, 0x57, 0x49, 0x44, 0x47, 0x54, 0x31]);
    await expect(
      pushWidgetUpload({ rpc, container: { binary: oversize }, generation: 1 }),
    ).rejects.toThrow(/98304-byte upload limit/);
    expect(calls).toHaveLength(0);
  });
});
