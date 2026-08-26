// Transport contract tests against a scripted fake device. These pin the
// begin/write/commit sequence, the generation arithmetic the device's
// basic_f1wb gate enforces, and the abort-on-failure behaviour.
//
// Firmware 4e045ec2 fixed widget.scene.capabilities (its JSON strings were
// stack-backed and dangled by serialization time) and added a `code` field to
// failures, so the transport now surfaces named reasons instead of a bare
// "error". These pin that mapping and the generation arithmetic.

import { describe, expect, it, vi } from "vitest";

import { buildRenderV2RasterPackage, DEVICE_PIXELS } from "../src/compiler/renderV2Package";
import {
  createSceneUpload,
  probeSceneAlive,
  pushRenderV2Package,
  SCENE_RPC_METHODS,
} from "../src/device/scene-push";

async function samplePackage(generation = 1) {
  const frame = new Uint16Array(DEVICE_PIXELS);
  for (let i = 0; i < DEVICE_PIXELS; i += 1) frame[i] = (i * 7) & 0xffff;
  return buildRenderV2RasterPackage({ frames: [frame], name: "test", generation, fps: 1 });
}

/** A device that acknowledges everything. */
function happyDevice() {
  const calls: { method: string; params: any }[] = [];
  const rpc = vi.fn(async (method: string, params: any) => {
    calls.push({ method, params });
    return { status: "ok" };
  });
  return { rpc, calls };
}

describe("render-v2 scene push transport", () => {
  it("names a busy rejection instead of reporting a bare error", async () => {
    const rpc = vi.fn(async (method: string) => {
      if (method === SCENE_RPC_METHODS.begin) return { status: "error", code: "1" };
      return { status: "ok" };
    });
    await expect(
      pushRenderV2Package({ rpc, package: await samplePackage(1), expectedGeneration: 0 }),
    ).rejects.toThrow(/code 1.*one push per boot/s);
  });

  it("distinguishes a generation rejection from a busy one", async () => {
    const rpc = vi.fn(async (method: string) => {
      if (method === SCENE_RPC_METHODS.begin) return { status: "error", code: "3" };
      return { status: "ok" };
    });
    await expect(
      pushRenderV2Package({ rpc, package: await samplePackage(1), expectedGeneration: 0 }),
    ).rejects.toThrow(/code 3.*wrong generation/s);
  });

  it("says so when the firmware is too old to report a code", async () => {
    const rpc = vi.fn(async (method: string) => {
      if (method === SCENE_RPC_METHODS.begin) return { status: "error" };
      return { status: "ok" };
    });
    await expect(
      pushRenderV2Package({ rpc, package: await samplePackage(1), expectedGeneration: 0 }),
    ).rejects.toThrow(/older than 4e045ec2/);
  });

  it("surfaces the code on a rejected chunk and commit", async () => {
    const onChunk = vi.fn(async (method: string) => {
      if (method === SCENE_RPC_METHODS.write) return { status: "error", code: "6" };
      return { status: "ok" };
    });
    await expect(
      pushRenderV2Package({ rpc: onChunk, package: await samplePackage(1), expectedGeneration: 0 }),
    ).rejects.toThrow(/digest mismatch/);

    const onCommit = vi.fn(async (method: string) => {
      if (method === SCENE_RPC_METHODS.commit) return { status: "error", code: "8" };
      return { status: "ok" };
    });
    await expect(
      pushRenderV2Package({ rpc: onCommit, package: await samplePackage(1), expectedGeneration: 0 }),
    ).rejects.toThrow(/malformed F1WB/);
  });

  it("checks liveness with status only", async () => {
    const rpc = vi.fn(async () => ({ status: "ok" }));
    expect(await probeSceneAlive(rpc)).toBe(true);
    expect(rpc).toHaveBeenCalledWith(SCENE_RPC_METHODS.status, expect.anything());
  });

  it("reports not-alive when status errors or throws", async () => {
    expect(await probeSceneAlive(vi.fn(async () => ({ status: "error" })))).toBe(false);
    expect(await probeSceneAlive(vi.fn(async () => { throw new Error("nope"); }))).toBe(false);
  });

  it("pushes begin → writes → commit at the caller's generation", async () => {
    const { rpc, calls } = happyDevice();
    const pkg = await samplePackage(1);
    const result = await pushRenderV2Package({ rpc, package: pkg, expectedGeneration: 4 });

    expect(result.status).toBe("committed");
    expect(result.expectedGeneration).toBe(4);
    expect(result.generation).toBe(5);

    const sequence = calls.map((c) => c.method);
    expect(sequence[0]).toBe(SCENE_RPC_METHODS.status);
    expect(sequence[1]).toBe(SCENE_RPC_METHODS.capabilities);
    expect(sequence[2]).toBe(SCENE_RPC_METHODS.begin);
    expect(sequence.at(-1)).toBe(SCENE_RPC_METHODS.commit);
    expect(sequence.filter((m) => m === SCENE_RPC_METHODS.write)).toHaveLength(result.totalChunks);

    const begin = calls.find((c) => c.method === SCENE_RPC_METHODS.begin)!.params;
    expect(begin.generation).toBe(5);
    expect(begin.expectedGeneration).toBe(4);
    // The restamped digest, not the as-built one.
    expect(begin.sha256).toBe(result.sha256);
    expect(begin.sha256).not.toBe(pkg.sha256);
  });

  it("starts a fresh boot at generation 1", async () => {
    const { rpc, calls } = happyDevice();
    const result = await pushRenderV2Package({ rpc, package: await samplePackage(1), expectedGeneration: 0 });
    expect(result.generation).toBe(1);
    const begin = calls.find((c) => c.method === SCENE_RPC_METHODS.begin)!.params;
    expect(begin.expectedGeneration).toBe(0);
    expect(begin.generation).toBe(1);
  });

  it("sends contiguous chunks that reassemble to the package", async () => {
    const { rpc, calls } = happyDevice();
    const result = await pushRenderV2Package({ rpc, package: await samplePackage(1), expectedGeneration: 0 });

    const writes = calls.filter((c) => c.method === SCENE_RPC_METHODS.write).map((c) => c.params);
    let offset = 0;
    const reassembled = new Uint8Array(result.bytes);
    writes.forEach((write, index) => {
      expect(write.index).toBe(index);
      expect(write.offset).toBe(offset);
      const raw = Uint8Array.from(atob(write.data), (ch) => ch.charCodeAt(0));
      expect(raw.length).toBe(write.bytes);
      reassembled.set(raw, offset);
      offset += raw.length;
    });
    expect(offset).toBe(result.bytes);
    expect(new DataView(reassembled.buffer).getUint32(8, true)).toBe(1);
  });

  it("aborts the transaction when a chunk is rejected", async () => {
    const calls: string[] = [];
    const rpc = vi.fn(async (method: string) => {
      calls.push(method);
      if (method === SCENE_RPC_METHODS.write && calls.filter((m) => m === SCENE_RPC_METHODS.write).length === 3) {
        return { status: "error" };
      }
      return { status: "ok" };
    });
    await expect(
      pushRenderV2Package({ rpc, package: await samplePackage(1), expectedGeneration: 0 }),
    ).rejects.toThrow(/chunk 2 was rejected/);
    expect(calls).toContain(SCENE_RPC_METHODS.abort);
  });

  it("does not abort when the keyboard answer was indeterminate", async () => {
    const calls: string[] = [];
    const rpc = vi.fn(async (method: string) => {
      calls.push(method);
      if (method === SCENE_RPC_METHODS.write) return { status: "ok", wrote: 3072 };
      return { status: "ok" };
    });
    await expect(
      pushRenderV2Package({ rpc, package: await samplePackage(1), expectedGeneration: 0 }),
    ).rejects.toThrow(/indeterminate/);
    expect(calls).not.toContain(SCENE_RPC_METHODS.abort);
  });

  it("refuses an upload whose generation is not exactly one past the device", async () => {
    await expect(createSceneUpload(await samplePackage(9), 3)).rejects.toThrow(/exactly one past/);
  });

  it("reports the FIRST failure, not a later probe's, when the device is busy", async () => {
    // The bug this pins: at the device's real generation begin answered code 1
    // (busy), the probe then walked upward collecting code 3 (wrong
    // generation), and the last code was reported — blaming the wrong thing.
    const rpc = vi.fn(async (method: string, params: any) => {
      if (method === SCENE_RPC_METHODS.capabilities) return { status: "ok", committedGeneration: "1" };
      if (method === SCENE_RPC_METHODS.begin) {
        return params.expectedGeneration === 1
          ? { status: "error", code: "1" }   // busy at the true generation
          : { status: "error", code: "3" };  // any probe past it
      }
      return { status: "ok" };
    });
    await expect(
      pushRenderV2Package({ rpc, package: await samplePackage(1), expectedGeneration: 0 }),
    ).rejects.toThrow(/code 1.*one push per boot/s);
  });

  it("does not probe past a generation the device reported", async () => {
    const calls: any[] = [];
    const rpc = vi.fn(async (method: string, params: any) => {
      if (method === SCENE_RPC_METHODS.capabilities) return { status: "ok", committedGeneration: "2" };
      if (method === SCENE_RPC_METHODS.begin) { calls.push(params.expectedGeneration); return { status: "error", code: "1" }; }
      return { status: "ok" };
    });
    await expect(
      pushRenderV2Package({ rpc, package: await samplePackage(1), expectedGeneration: 0 }),
    ).rejects.toThrow();
    expect(calls).toEqual([2]);
  });

  it("uses the device's reported generation over a stale caller hint", async () => {
    // The bug this pins: the caller carried 5 from an earlier identify while the
    // device sat at 1. The probe only searches upward, so every attempt missed
    // and the push failed with "wrong generation" despite the device being fine.
    const calls: { method: string; params: any }[] = [];
    const rpc = vi.fn(async (method: string, params: any) => {
      calls.push({ method, params });
      if (method === SCENE_RPC_METHODS.capabilities) return { status: "ok", committedGeneration: "1" };
      if (method === SCENE_RPC_METHODS.begin) {
        return params.expectedGeneration === 1 ? { status: "ok" } : { status: "error", code: "3" };
      }
      return { status: "ok" };
    });
    const result = await pushRenderV2Package({ rpc, package: await samplePackage(1), expectedGeneration: 5 });
    expect(result.expectedGeneration).toBe(1);
    expect(result.generation).toBe(2);
    // It must not have wasted a begin on the stale hint.
    const begins = calls.filter((c) => c.method === SCENE_RPC_METHODS.begin);
    expect(begins).toHaveLength(1);
    expect(begins[0].params.expectedGeneration).toBe(1);
  });

  it("falls back to the caller hint when the device reports no generation", async () => {
    const rpc = vi.fn(async (method: string, params: any) => {
      if (method === SCENE_RPC_METHODS.capabilities) return { status: "ok" };
      if (method === SCENE_RPC_METHODS.begin) {
        return params.expectedGeneration === 3 ? { status: "ok" } : { status: "error", code: "3" };
      }
      return { status: "ok" };
    });
    const result = await pushRenderV2Package({ rpc, package: await samplePackage(1), expectedGeneration: 3 });
    expect(result.expectedGeneration).toBe(3);
  });

  it("probes upward when the device is further along than the caller thinks", async () => {
    // The device only resets its committed generation on a power cycle, so a
    // caller starting from 0 can be stale. Reject until expectedGeneration 2.
    const calls: { method: string; params: any }[] = [];
    const rpc = vi.fn(async (method: string, params: any) => {
      calls.push({ method, params });
      if (method === SCENE_RPC_METHODS.capabilities) return { status: "ok" };
      if (method === SCENE_RPC_METHODS.begin) {
        return params.expectedGeneration === 2 ? { status: "ok" } : { status: "error" };
      }
      return { status: "ok" };
    });
    const result = await pushRenderV2Package({ rpc, package: await samplePackage(1), expectedGeneration: 0 });
    expect(result.expectedGeneration).toBe(2);
    expect(result.generation).toBe(3);
    const begins = calls.filter((c) => c.method === SCENE_RPC_METHODS.begin);
    expect(begins.map((b) => b.params.expectedGeneration)).toEqual([0, 1, 2]);
    // Each probe restamps the package, so the digest must track the generation.
    expect(begins.at(-1)!.params.sha256).toBe(result.sha256);
  });

  it("gives up after probing without finding the generation", async () => {
    const rpc = vi.fn(async (method: string) => {
      if (method === SCENE_RPC_METHODS.begin) return { status: "error", code: "3" };
      return { status: "ok" };
    });
    await expect(
      pushRenderV2Package({ rpc, package: await samplePackage(1), expectedGeneration: 0 }),
    ).rejects.toThrow(/wrong generation/);
  });
});
