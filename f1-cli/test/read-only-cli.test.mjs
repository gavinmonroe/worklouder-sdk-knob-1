import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  backupConnectedDevice,
  explainWriteFailure,
  F1_DEVICE_TYPES,
  BUBBLE_DEVICE_TYPES,
  safeRelativeDevicePath,
  sendTransientBubble,
} from "../src/device.mjs";
import { validateBubblePayload } from "../src/bubble.mjs";
import { FIRMWARE_PROBE_METHODS, READ_ONLY_RPC_METHODS, ReadOnlyTransport,
  ReadOnlyViolationError } from "../src/read-only-transport.mjs";
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

test("default discovery accepts the Knob 1 while the bubble stays Framer F1 only", () => {
  // The Knob 1 reports deviceType "knob"; every audited read-only RPC works on it, so it
  // must not need --all-devices. The display bubble has never run on one, so it does not
  // widen with it.
  assert.ok(F1_DEVICE_TYPES.has("knob_f1"));
  assert.ok(F1_DEVICE_TYPES.has("knob"));
  assert.ok(BUBBLE_DEVICE_TYPES.has("knob_f1"));
  assert.ok(!BUBBLE_DEVICE_TYPES.has("knob"));
});

test("backup skips directory entries instead of recording a read failure", async () => {
  const backupRoot = await mkdtemp(path.join(os.tmpdir(), "f1-readonly-test-"));
  const reads = [];
  const api = {
    async getFileList() {
      // fs.list reports a directory without a checksum, as the Knob 1's "wallpapers" is.
      return [
        { name: "keymap.json", size: 2, checksum: "device-sum" },
        { name: "wallpapers", size: 0 },
      ];
    },
    async readFileChunked(name) {
      reads.push(name);
      return Buffer.from([7, 8]);
    },
  };

  const manifest = await backupConnectedDevice(api, backupRoot, { deviceType: "knob" });
  const byName = Object.fromEntries(manifest.files.map((file) => [file.name, file]));
  assert.equal(byName["keymap.json"].saved, true);
  assert.equal(byName.wallpapers.saved, false);
  assert.equal(byName.wallpapers.skipped, "directory");
  assert.equal(byName.wallpapers.error, undefined);
  // The directory is never read, so it cannot fail the backup.
  assert.deepEqual(reads, ["keymap.json"]);
});

test("a macOS HID write refusal explains the sudo requirement", () => {
  const raw = "firmware version: Cannot write to hid device";
  const explained = explainWriteFailure(raw);
  if (process.platform === "darwin") {
    assert.match(explained, /sudo/u);
    assert.match(explained, /docs\/21-knob1-macos-hid-access\.md/u);
  } else {
    assert.equal(explained, raw);
  }
  // Unrelated errors are passed through untouched on every platform.
  assert.equal(explainWriteFailure("device status: timeout"), "device status: timeout");
});

test("firmware probe methods are refused unless explicitly enabled", async () => {
  const seen = [];
  const underlying = {
    async sendJsonRpcRequest(raw) {
      seen.push(JSON.parse(raw).method);
      return JSON.stringify({ result: {} });
    },
  };
  const probe = JSON.stringify({ method: "sentry.get" });

  // Default transport: an unaudited method is refused exactly like a write.
  await assert.rejects(
    new ReadOnlyTransport(underlying).sendJsonRpcRequest(probe, "1"),
    ReadOnlyViolationError,
  );
  // The bubble opt-in must not smuggle probes in with it.
  await assert.rejects(
    new ReadOnlyTransport(underlying, { allowTransientBubble: true })
      .sendJsonRpcRequest(probe, "2"),
    ReadOnlyViolationError,
  );
  assert.deepEqual(seen, []);

  const enabled = new ReadOnlyTransport(underlying, { allowFirmwareProbes: true });
  await enabled.sendJsonRpcRequest(probe, "3");
  assert.deepEqual(seen, ["sentry.get"]);

  // Enabling probes must not widen anything else.
  await assert.rejects(
    enabled.sendJsonRpcRequest(JSON.stringify({ method: "fs.format" }), "4"),
    ReadOnlyViolationError,
  );
  await assert.rejects(
    enabled.sendJsonRpcRequest(JSON.stringify({ method: "ui.wallpaper_select" }), "5"),
    ReadOnlyViolationError,
  );
  assert.deepEqual(seen, ["sentry.get"]);
});

test("the probe set stays disjoint from the audited set and excludes actuating methods", () => {
  for (const method of FIRMWARE_PROBE_METHODS) {
    assert.ok(!READ_ONLY_RPC_METHODS.has(method),
      `${method} must not be folded into the SDK-audited set`);
  }
  for (const method of ["sys.selftest", "sys.charger_diagnostic", "sentry.crash",
    "sentry.coredump", "sentry.coredump_erase", "ui.wallpaper_select",
    "ui.wallpaper_background", "ui.home_accent_color", "fs.format", "fs.delete",
    "fs.write", "fs.writebin", "v.framer.hid"]) {
    assert.ok(!FIRMWARE_PROBE_METHODS.has(method),
      `${method} may actuate or destroy state and must stay out of the probe set`);
  }
});

test("probe rejects --file without a value instead of failing at call time", async () => {
  // The first version of this flag referenced an undefined variable and only blew up
  // once a device was attached. Parsing is exercised here so it cannot regress.
  const result = await runCli(["probe", "--file"]);
  assert.notEqual(result, 0);
});
