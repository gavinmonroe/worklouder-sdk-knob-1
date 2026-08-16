import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  backupConnectedDevice,
  safeRelativeDevicePath,
  sendTransientBubble,
} from "../src/device.mjs";
import { validateBubblePayload } from "../src/bubble.mjs";
import { ReadOnlyTransport, ReadOnlyViolationError } from "../src/read-only-transport.mjs";
import { runCli, runSelfTest } from "../src/cli.mjs";

test("transport forwards audited reads and blocks writes before the device", async () => {
  const seen = [];
  const underlying = {
    async sendJsonRpcRequest(raw) {
      seen.push(JSON.parse(raw).method);
      return JSON.stringify({ result: { version: "test" } });
    },
  };
  const guard = new ReadOnlyTransport(underlying);

  await guard.sendJsonRpcRequest(JSON.stringify({ method: "sys.version" }), "1");
  await assert.rejects(
    guard.sendJsonRpcRequest(JSON.stringify({ method: "fs.write" }), "2"),
    ReadOnlyViolationError,
  );
  assert.deepEqual(seen, ["sys.version"]);
});

test("bubble is blocked by default and narrowly allowed with exact valid params", async () => {
  const seen = [];
  const underlying = {
    async sendJsonRpcRequest(raw) {
      seen.push(JSON.parse(raw));
      return JSON.stringify({ result: { status: "ok" } });
    },
  };
  const raw = JSON.stringify({
    method: "v.framer.bubble",
    params: { l: "Input Lab", v: "Proof", d: 1, s: 1 },
  });

  await assert.rejects(
    new ReadOnlyTransport(underlying).sendJsonRpcRequest(raw, "1"),
    ReadOnlyViolationError,
  );
  await new ReadOnlyTransport(underlying, { allowTransientBubble: true })
    .sendJsonRpcRequest(raw, "2");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].method, "v.framer.bubble");

  await assert.rejects(
    new ReadOnlyTransport(underlying, { allowTransientBubble: true }).sendJsonRpcRequest(
      JSON.stringify({
        method: "v.framer.bubble",
        params: { l: "Input Lab", v: "Proof", d: 2, s: 1 },
      }),
      "invalid",
    ),
    /must be 0 or 1/u,
  );
  assert.equal(seen.length, 1);

  await assert.rejects(
    new ReadOnlyTransport(underlying, { allowTransientBubble: true }).sendJsonRpcRequest(
      JSON.stringify({ method: "fs.write", params: {} }),
      "3",
    ),
    ReadOnlyViolationError,
  );
  assert.equal(seen.length, 1);
});

test("bubble validator enforces exact keys, byte lengths, and u8 booleans", () => {
  assert.deepEqual(
    validateBubblePayload({ l: "Layer", v: "12 px", d: 1, s: 1 }),
    { l: "Layer", v: "12 px", d: 1, s: 1 },
  );
  assert.deepEqual(
    validateBubblePayload({ l: "Layer", v: "Hidden", d: 0, s: 0 }),
    { l: "Layer", v: "Hidden", d: 0, s: 0 },
  );
  assert.throws(
    () => validateBubblePayload({ l: "😀".repeat(9), v: "ok", d: 1, s: 1 }),
    /32 UTF-8 bytes/u,
  );
  assert.throws(
    () => validateBubblePayload({ l: "ok", v: "ok", d: -1, s: 1 }),
    /must be 0 or 1/u,
  );
  assert.throws(
    () => validateBubblePayload({ l: "ok", v: "ok", d: 1, s: 1, extra: true }),
    /exactly l, v, d, and s/u,
  );
});

test("bubble sender rejects non-F1 devices before constructing a transport", async () => {
  let constructed = false;
  const sdk = {
    WLDeviceCommImpl: class {
      constructor() {
        constructed = true;
      }
    },
  };
  await assert.rejects(
    sendTransientBubble(
      sdk,
      { deviceType: "knob" },
      { l: "Input Lab", v: "Proof", d: 1, s: 1 },
    ),
    /restricted to a Framer F1/u,
  );
  assert.equal(constructed, false);
});

test("bubble CLI dry-run defaults to visible bubble and status dot without hardware", async () => {
  const output = [];
  const originalLog = console.log;
  console.log = (value) => output.push(value);
  try {
    const code = await runCli([
      "bubble",
      "--label",
      "Input Lab",
      "--value",
      "Visible defaults",
      "--dry-run",
      "--json",
    ]);
    assert.equal(code, 0);
  } finally {
    console.log = originalLog;
  }

  const result = JSON.parse(output.join("\n"));
  assert.equal(result.hardwareAccessed, false);
  assert.deepEqual(result.request.params, {
    l: "Input Lab",
    v: "Visible defaults",
    d: 1,
    s: 1,
  });
});

test("device paths cannot escape the fresh local backup", () => {
  assert.equal(safeRelativeDevicePath("/apps/clock.bin"), path.join("apps", "clock.bin"));
  assert.throws(() => safeRelativeDevicePath("../../outside"), /Unsafe device filename/u);
  assert.throws(() => safeRelativeDevicePath("apps\\outside"), /Unsafe device filename/u);
});

test("backup copies mock device bytes and writes a hash manifest", async () => {
  const backupRoot = await mkdtemp(path.join(os.tmpdir(), "f1-readonly-test-"));
  const api = {
    async getFileList() {
      return [{ name: "/apps/demo.bin", size: 4, checksum: "device-sum" }];
    },
    async readFileChunked(name) {
      assert.equal(name, "/apps/demo.bin");
      return Buffer.from([1, 2, 3, 4]);
    },
  };

  const manifest = await backupConnectedDevice(api, backupRoot, { deviceType: "knob_f1" });
  assert.equal(manifest.files[0].saved, true);
  assert.deepEqual(
    await readFile(path.join(backupRoot, "apps", "demo.bin")),
    Buffer.from([1, 2, 3, 4]),
  );
  assert.match(manifest.files[0].sha256, /^[a-f0-9]{64}$/u);
  assert.deepEqual(
    JSON.parse(await readFile(path.join(backupRoot, "manifest.json"), "utf8")),
    manifest,
  );
});

test("offline SDK protocol self-test does not access hardware", async () => {
  const result = await runSelfTest();
  assert.equal(result.ok, true);
  assert.equal(result.hardwareAccessed, false);
  assert.equal(result.blockedRequest, "fs.write");
  assert.ok(!result.allowedRequestsObserved.includes("fs.write"));
});
