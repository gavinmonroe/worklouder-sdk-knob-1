import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { firmwareCatalog } from "../src/data/firmware.js";
import {
  SCENE_RPC_LIMITS,
  SCENE_RPC_METHODS,
  SCENE_RPC_PROTOCOL,
  createScenePackageUpload,
  loadScenePackage,
  pushScenePackage,
} from "../src/lib/scene-push.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const packagePath =
  "f1-widget-sdk/build/combined-renderer-v2-clock-blue-timer/focus-clock-timer.generation-2.package.bin";
const descriptor = firmwareCatalog.find((firmware) => firmware.id === "clock-timer").scenePackage;

const readPackage = async () => new Uint8Array(await readFile(path.join(root, packagePath)));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Records every RPC and replies with the shapes the firmware returns. */
function fakeTransport({ beginStatus = "ok", writeStatus = () => "ok", commitStatus = "ok", commitThrows = false } = {}) {
  const calls = [];
  const rpc = async (method, params) => {
    calls.push({ method, params });
    if (method === SCENE_RPC_METHODS.begin) return { status: beginStatus };
    if (method === SCENE_RPC_METHODS.write) return { status: writeStatus(params.index) };
    if (method === SCENE_RPC_METHODS.commit) {
      if (commitThrows) throw new Error("no reply");
      return { status: commitStatus };
    }
    if (method === SCENE_RPC_METHODS.abort) return { status: "ok" };
    throw new Error(`unexpected method ${method}`);
  };
  return { rpc, calls };
}

describe("frozen clock + timer scene package", () => {
  it("matches the catalog-pinned bytes and hash", async () => {
    const bytes = await readPackage();
    expect(bytes.length).toBe(descriptor.bytes);
    expect(sha256(bytes)).toBe(descriptor.sha256);
  });

  it("chunks into 32 blocks of 3072 raw bytes", async () => {
    const upload = await createScenePackageUpload(await readPackage(), descriptor);
    expect(SCENE_RPC_LIMITS.chunkRawBytes).toBe(3072);
    expect(SCENE_RPC_LIMITS.maxChunks).toBe(32);
    expect(upload.chunks).toHaveLength(32);
    expect(upload.chunks.slice(0, 31).every((chunk) => chunk.bytes === 3072)).toBe(true);
    expect(upload.chunks.at(-1).bytes).toBe(95_535 - 31 * 3072);
    expect(upload.chunks.map(({ index }) => index)).toEqual([...Array(32).keys()]);
    expect(upload.chunks.map(({ offset }) => offset)).toEqual(
      [...Array(32).keys()].map((index) => index * 3072),
    );
    expect(upload.chunks.reduce((sum, chunk) => sum + chunk.bytes, 0)).toBe(descriptor.bytes);
  });

  it("uses the exact focus-timer begin, write, and commit payload shapes", async () => {
    const bytes = await readPackage();
    const upload = await createScenePackageUpload(bytes, descriptor);
    expect(upload.manifest).toEqual({
      protocol: SCENE_RPC_PROTOCOL,
      transactionId: `f2pt-00000002-${descriptor.sha256.slice(0, 16)}`,
      expectedGeneration: 1,
      generation: 2,
      totalBytes: 95_535,
      totalChunks: 32,
      chunkRawBytes: 3072,
      sha256: descriptor.sha256,
    });
    expect(upload.commit).toEqual({
      protocol: SCENE_RPC_PROTOCOL,
      transactionId: upload.manifest.transactionId,
      expectedGeneration: 1,
      generation: 2,
      totalBytes: 95_535,
      totalChunks: 32,
      sha256: descriptor.sha256,
    });
    expect(Object.keys(upload.chunks[0]).sort()).toEqual(
      ["bytes", "chunkSha256", "data", "generation", "index", "offset", "protocol", "transactionId"].sort(),
    );

    const first = upload.chunks[0];
    expect(first.chunkSha256).toBe(sha256(bytes.subarray(0, 3072)));
    expect(Buffer.from(first.data, "base64").equals(Buffer.from(bytes.subarray(0, 3072)))).toBe(true);
    // Rebuilding the package from the base64 chunk payloads returns the exact bytes.
    const rebuilt = Buffer.concat(upload.chunks.map((chunk) => Buffer.from(chunk.data, "base64")));
    expect(sha256(rebuilt)).toBe(descriptor.sha256);
  });

  it("refuses bytes that drifted from the pinned package", async () => {
    const bytes = await readPackage();
    bytes[512] ^= 0xff;
    await expect(createScenePackageUpload(bytes, descriptor)).rejects.toThrow(/SHA-256/u);
    await expect(createScenePackageUpload(bytes.slice(0, 1024), descriptor)).rejects.toThrow(/size changed/u);
    await expect(
      createScenePackageUpload(await readPackage(), { ...descriptor, generation: 5 }),
    ).rejects.toThrow(/advance the committed generation by exactly one/u);
  });

  it("loads and verifies the package before returning it", async () => {
    const bytes = await readPackage();
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    });
    expect((await loadScenePackage(descriptor, fetchImpl)).length).toBe(descriptor.bytes);
    await expect(loadScenePackage(descriptor, async () => ({ ok: false, status: 404 }))).rejects.toThrow(
      /Could not load/u,
    );
  });
});

describe("scene push over a fake HID transport", () => {
  it("drives begin, 32 writes, then commit and reports success", async () => {
    const { rpc, calls } = fakeTransport();
    const stages = [];
    const result = await pushScenePackage({
      rpc,
      bytes: await readPackage(),
      package: descriptor,
      onProgress: (progress) => stages.push(progress),
    });

    expect(result.status).toBe("FOCUS_TIMER_PACKAGE_COMMIT_ACKNOWLEDGED");
    expect(result).toMatchObject({ generation: 2, bytes: 95_535, chunks: 32, sha256: descriptor.sha256 });
    expect(calls.map(({ method }) => method)).toEqual([
      SCENE_RPC_METHODS.begin,
      ...Array(32).fill(SCENE_RPC_METHODS.write),
      SCENE_RPC_METHODS.commit,
    ]);
    expect(calls.filter(({ method }) => method === SCENE_RPC_METHODS.abort)).toHaveLength(0);
    expect(calls[0].params.expectedGeneration).toBe(1);
    expect(calls.at(-1).params.generation).toBe(2);
    expect(stages.at(-1)).toMatchObject({ stage: "applying-on-keyboard" });
    expect(stages.filter(({ stage }) => stage === "uploading-chunks")).toHaveLength(33);
  });

  it("explains a rejected begin without writing any chunk", async () => {
    const { rpc, calls } = fakeTransport({ beginStatus: "error" });
    await expect(
      pushScenePackage({ rpc, bytes: await readPackage(), package: descriptor }),
    ).rejects.toMatchObject({
      code: "SCENE_BEGIN_REJECTED",
      message: expect.stringMatching(/already enabled this boot.*power-cycle/isu),
    });
    expect(calls.map(({ method }) => method)).toEqual([SCENE_RPC_METHODS.begin]);
  });

  it("aborts the transaction when a chunk is rejected", async () => {
    const { rpc, calls } = fakeTransport({ writeStatus: (index) => (index === 7 ? "error" : "ok") });
    await expect(
      pushScenePackage({ rpc, bytes: await readPackage(), package: descriptor }),
    ).rejects.toMatchObject({ code: "SCENE_RPC_REJECTED" });
    const abort = calls.at(-1);
    expect(abort.method).toBe(SCENE_RPC_METHODS.abort);
    expect(abort.params).toEqual({
      protocol: SCENE_RPC_PROTOCOL,
      transactionId: `f2pt-00000002-${descriptor.sha256.slice(0, 16)}`,
      generation: 2,
    });
    expect(calls.filter(({ method }) => method === SCENE_RPC_METHODS.write)).toHaveLength(8);
    expect(calls.filter(({ method }) => method === SCENE_RPC_METHODS.commit)).toHaveLength(0);
  });

  it("aborts when the commit is rejected", async () => {
    const { rpc, calls } = fakeTransport({ commitStatus: "error" });
    await expect(
      pushScenePackage({ rpc, bytes: await readPackage(), package: descriptor }),
    ).rejects.toMatchObject({ code: "SCENE_RPC_REJECTED" });
    expect(calls.at(-1).method).toBe(SCENE_RPC_METHODS.abort);
  });

  it("never aborts after an indeterminate commit", async () => {
    const { rpc, calls } = fakeTransport({ commitThrows: true });
    await expect(
      pushScenePackage({ rpc, bytes: await readPackage(), package: descriptor }),
    ).rejects.toMatchObject({ code: "SCENE_COMMIT_INDETERMINATE" });
    expect(calls.filter(({ method }) => method === SCENE_RPC_METHODS.abort)).toHaveLength(0);
  });

  it("treats a non-status-only reply as indeterminate", async () => {
    const rpc = async (method) => (method === SCENE_RPC_METHODS.begin ? { status: "ok", extra: 1 } : { status: "ok" });
    await expect(
      pushScenePackage({ rpc, bytes: await readPackage(), package: descriptor }),
    ).rejects.toMatchObject({ code: "SCENE_RPC_INDETERMINATE" });
  });
});
