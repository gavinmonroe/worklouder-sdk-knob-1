import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { encodeRasterAnimation } from "../src/render/raster-animation.mjs";
import { encodeWidgetBundle } from "../src/render/widget-bundle.mjs";
import {
  assessRenderV2MQuickJsCapability,
  buildRenderV2MQuickJsPackage,
  decodeRenderV2MQuickJsPackage,
  RENDER_V2_MQUICKJS_LIMITS,
  RENDER_V2_MQUICKJS_PACKAGE_ABI_SHA256,
  RENDER_V2_MQUICKJS_PROFILE,
  RENDER_V2_MQUICKJS_SOURCE_PREFIX,
} from "../src/render-v2/index.mjs";
import * as publicRendererV2 from "framer-f1-research-widget-sdk/renderer-v2";

const SOURCE = `var presses = 0;
widget.on("input.key.down", function (event) {
  if (widget.isHeld(event, 0)) {
    presses = presses + 1;
    widget.setInt(0, presses);
    widget.commit();
  }
});
widget.on("input.chord.down", function (event) {
  widget.setInt(1, event.chord);
  widget.commit();
});`;

function options(overrides = {}) {
  return {
    source: SOURCE,
    generation: 7,
    events: {
      "tick.100ms": true,
      "input.fn-bottom-knob": true,
      hostRpcIds: [0x1234, 0xb201],
      keys: [{ id: 0, nativeToken: 0x10203040 }, { id: 1, nativeToken: 0xaabbccdd }],
      chords: [{ id: 0, heldMask: 0b11 }],
    },
    targets: [{ id: "counter", writes: ["textContent", "color", "hidden"] }],
    input: { debounceMs: 8, holdDelayMs: 450, holdCadenceMs: 75 },
    ...overrides,
  };
}

function rasterBase(generation = 7) {
  const frame = new Uint16Array(31_000);
  frame.fill(0x1234);
  const animation = encodeRasterAnimation({ frames: [frame], width: 100, height: 310,
    fps: 1, loopDurationMs: 1_000, maxBytes: 128 * 1024 });
  return encodeWidgetBundle({ generation, activeSlot: 0,
    slots: [{ name: "mqjs", kind: "raster", animationBinary: animation.binary }] }).binary;
}

function resealBody(bytes) {
  createHash("sha256").update(bytes.subarray(128)).digest().copy(bytes, 96);
  return bytes;
}

function readU24LE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

test("F2JS packages are deterministic, immutable, and preserve declared key/chord policy", () => {
  const first = buildRenderV2MQuickJsPackage(options());
  const second = buildRenderV2MQuickJsPackage(options());
  assert.deepEqual(first.binary, second.binary);
  assert.equal(first.sha256, second.sha256);
  assert.equal(first.execution.deviceEvaluatesJavaScript, true);
  assert.equal(first.execution.deviceRunsJsdom, false);
  assert.equal(RENDER_V2_MQUICKJS_PACKAGE_ABI_SHA256,
    "5091736403d809078cbbf12a1b593fbabaff53474a0935a7e00ce81dc8bd67f8");
  assert.equal(first.source, `${RENDER_V2_MQUICKJS_SOURCE_PREFIX}${SOURCE}`);
  const alreadyStrict = buildRenderV2MQuickJsPackage(options({
    source: `${RENDER_V2_MQUICKJS_SOURCE_PREFIX}${SOURCE}`,
  }));
  assert.deepEqual(alreadyStrict.binary, first.binary);
  assert.equal(first.execution.sourceTransport, "utf8-source-not-bytecode");
  assert.deepEqual(first.input, { keyCount: 2, chordCount: 1, debounceMs: 8,
    holdDelayMs: 450, holdCadenceMs: 75 });
  assert.deepEqual(first.events.filter(({ kind }) => kind === 5).map(({ id, nativeToken }) =>
    ({ id, nativeToken })), [{ id: 0, nativeToken: 0x10203040 },
    { id: 1, nativeToken: 0xaabbccdd }]);
  assert.deepEqual(first.events.find(({ kind }) => kind === 6),
    { kind: 6, id: 0, nativeToken: 0, heldMask: 3 });
  assert.deepEqual(first.targets[0].writes, ["textContent", "color", "hidden"]);

  const callerBytes = first.binary;
  const admitted = decodeRenderV2MQuickJsPackage(callerBytes);
  callerBytes.fill(0);
  assert.equal(admitted.sha256, first.sha256);
  assert.equal(decodeRenderV2MQuickJsPackage(admitted.binary).sha256, first.sha256);
});

test("F2JS package admits one canonical raster base without bytecode", () => {
  const value = buildRenderV2MQuickJsPackage(options({ rasterBase: rasterBase() }));
  assert.equal(value.budget.rasterBaseBytes, 62_404);
  assert.equal(value.rasterBase.length, 62_404);
  assert.ok(value.bytes < RENDER_V2_MQUICKJS_LIMITS.packageBytes);
  assert.equal(value.binary.subarray(0, 4).toString("ascii"), "F2JS");
  assert.ok(value.binary.includes(Buffer.from(`${SOURCE}\0`, "utf8")));
  assert.throws(() => buildRenderV2MQuickJsPackage(options({ rasterBase: rasterBase(8) })),
    /match the package generation/u);
});

test("F2JS admission rejects digest, directory, reserved-byte, input, and alias tampering", () => {
  const value = buildRenderV2MQuickJsPackage(options());
  for (const mutate of [
    (bytes) => { bytes[96] ^= 1; },
    (bytes) => { bytes[40] ^= 4; },
    (bytes) => { bytes[128 + 1] = 1; resealBody(bytes); },
    (bytes) => { bytes[32] = 0; bytes[33] = 0; },
    (bytes) => { bytes[8] -= 1; },
  ]) {
    const bytes = value.binary;
    mutate(bytes);
    assert.throws(() => decodeRenderV2MQuickJsPackage(bytes));
  }
  assert.throws(() => buildRenderV2MQuickJsPackage(options({ events: {
    keys: [{ nativeToken: 1 }, { nativeToken: 1 }], chords: [] } })), /tokens must be unique/u);
  assert.throws(() => buildRenderV2MQuickJsPackage(options({ events: {
    keys: [{ nativeToken: 1 }], chords: [{ heldMask: 1 }] } })), /two to four/u);
  assert.throws(() => buildRenderV2MQuickJsPackage(options({ events: {
    hostRpcIds: [0] } })), /nonzero/u);
  assert.throws(() => buildRenderV2MQuickJsPackage(options({ source: `x`.repeat(8_193) })),
    /1\.\.8192/u);
  const maximumBody = "x".repeat(8_192 - Buffer.byteLength(RENDER_V2_MQUICKJS_SOURCE_PREFIX));
  assert.equal(buildRenderV2MQuickJsPackage(options({ source: maximumBody })).budget.sourceBytes,
    8_192);
  assert.throws(() => buildRenderV2MQuickJsPackage(options({ source: `${maximumBody}x` })),
    /1\.\.8192/u);

  const rich = buildRenderV2MQuickJsPackage(options({ rasterBase: rasterBase() }));
  const targetAt = readU24LE(rich.binary, 46);
  const sourceAt = readU24LE(rich.binary, 52);
  const sourceBytes = readU24LE(rich.binary, 55) - 1;
  const assetAt = readU24LE(rich.binary, 58);
  for (const mutate of [
    (bytes) => { bytes[targetAt + 8] |= 0x80; },
    (bytes) => { bytes[assetAt] |= 0x80; },
    (bytes) => {
      bytes[assetAt + 332] |= 0x80;
      createHash("sha256").update(bytes.subarray(assetAt + 332, assetAt + 62_404))
        .digest().copy(bytes, assetAt + 40);
    },
    (bytes) => { bytes[assetAt + 104 + 4] = 1; },
  ]) {
    const bytes = rich.binary;
    mutate(bytes);
    resealBody(bytes);
    assert.throws(() => decodeRenderV2MQuickJsPackage(bytes));
  }
  const sloppy = rich.binary;
  sloppy[sourceAt] = 0x27;
  createHash("sha256").update(sloppy.subarray(sourceAt, sourceAt + sourceBytes))
    .digest().copy(sloppy, 64);
  resealBody(sloppy);
  assert.throws(() => decodeRenderV2MQuickJsPackage(sloppy), /canonical strict UTF-8/u);
});

test("F2JS rejects single-byte mutations except valid mutable header fields", () => {
  const value = buildRenderV2MQuickJsPackage(options());
  const original = value.binary;
  for (let offset = 0; offset < original.length; offset++) {
    const bytes = Buffer.from(original);
    bytes[offset] ^= 0x80;
    let decoded = null;
    try { decoded = decodeRenderV2MQuickJsPackage(bytes); } catch {}
    if (decoded == null) continue;
    assert.ok((offset >= 12 && offset < 16) || (offset >= 32 && offset < 38),
      `only generation or bounded input timing may admit a mutation; got ${offset}`);
    assert.notEqual(decoded.sha256, value.sha256);
    if (offset < 16) assert.notEqual(decoded.generation, value.generation);
  }
});

test("MicroQuickJS device capability is an exact, separate backend gate", () => {
  const capability = {
    renderV2Profile: RENDER_V2_MQUICKJS_PROFILE.id,
    packageFormat: RENDER_V2_MQUICKJS_PROFILE.packageFormat,
    packageAbiSha256: RENDER_V2_MQUICKJS_PROFILE.packageAbiSha256,
    engineCommit: RENDER_V2_MQUICKJS_PROFILE.engineCommit,
    javascriptProfile: RENDER_V2_MQUICKJS_PROFILE.javascriptProfile,
    deviceEvaluatesJavaScript: true,
    deviceRunsJsdom: false,
    maxPackageBytes: "98304",
    maxSourceBytes: "8192",
    heapBytes: "65536",
    callbackDeadlineUs: "2000",
    maxHandlers: "16",
    maxTargets: "16",
    maxKeys: "16",
    maxChords: "8",
  };
  assert.deepEqual(assessRenderV2MQuickJsCapability(capability), {
    compatible: true, profileId: RENDER_V2_MQUICKJS_PROFILE.id, errors: [] });
  assert.equal(assessRenderV2MQuickJsCapability({ ...capability,
    deviceEvaluatesJavaScript: "true" }).compatible, false);
  assert.equal(assessRenderV2MQuickJsCapability({ ...capability,
    renderV2Profile: "framer-f1-render-v2-structural-v1" }).compatible, false);
  assert.equal(publicRendererV2.buildRenderV2MQuickJsPackage,
    buildRenderV2MQuickJsPackage);
});
