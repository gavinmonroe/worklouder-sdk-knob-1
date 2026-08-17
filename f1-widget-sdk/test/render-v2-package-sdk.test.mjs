import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createDeterministicTestGlyphAtlas } from "../src/render/index.mjs";
import { assessRenderV2PackageCompatibility, buildRenderV2Package, compileRenderV2Program,
  compileRenderV2Widget, createRenderV2PackageUpload, decodeRenderV2Package, inspectRenderV2Program,
  RENDER_V2_CURRENT_DEVICE_PROFILE, RENDER_V2_GENERIC_ADMISSION_PROFILE } from "../src/render-v2/index.mjs";

const example = new URL("../examples/render-v2-events/", import.meta.url);

async function compileFixture() {
  const [html, css, script] = await Promise.all(["widget.html", "widget.css", "widget.js"]
    .map((name) => readFile(new URL(name, example), "utf8")));
  const compilation = await compileRenderV2Widget({ html, css, script, name: "SDK package",
    atlasFactory: (glyphs) => createDeterministicTestGlyphAtlas(glyphs, { width: 8, height: 12 }) });
  return { html, css, script, compilation };
}

test("public pipeline emits one structurally admitted F1WB||F2EP package with exact budgets", async () => {
  const { compilation } = await compileFixture();
  const value = compilation.package;
  assert.equal(value.binary.subarray(0, 4).toString("ascii"), "F1WB");
  assert.equal(value.binary.readUInt32LE(12), value.program.offset);
  assert.equal(value.binary.subarray(value.program.offset, value.program.offset + 4).toString("ascii"), "F2EP");
  assert.equal(value.binary.readUInt32LE(value.program.offset + 12), value.program.bytes);
  assert.ok(value.binary.length <= 98_304);
  assert.equal(value.budget.sceneStoreHeadroomBytes, 98_304 - value.binary.length);
  assert.equal(value.execution.deviceEvaluatesJavaScript, false);
  assert.equal(value.execution.deviceRunsJsdom, false);
  assert.equal(value.compatibility.currentDevice.deviceDeployable, false);
  assert.equal(value.compatibility.structuralV1.deviceDeployable, true);
  assert.deepEqual(inspectRenderV2Program(value.f2ep).resources, value.program.inspection.resources);
  const decoded = decodeRenderV2Package(value.binary);
  assert.equal(decoded.sha256, value.sha256);
  assert.deepEqual(decoded.baseFrame, value.baseFrame);
  assert.equal(decoded.program.inspection.structurallyAdmitted, true);
  const leaked = value.binary; leaked.fill(0);
  assert.equal(value.binary.subarray(0, 4).toString("ascii"), "F1WB", "package bytes must be defensively copied");
});

test("generic upload rewrites only F1WB generation and hashes/chunks the whole package", async () => {
  const { compilation } = await compileFixture();
  assert.throws(() => createRenderV2PackageUpload(compilation.package, { expectedGeneration: 1,
    profile: RENDER_V2_CURRENT_DEVICE_PROFILE }), /does not advertise generic/u);
  const upload = createRenderV2PackageUpload(compilation.package, { expectedGeneration: 7,
    profile: RENDER_V2_GENERIC_ADMISSION_PROFILE });
  const original = compilation.package.binary; const transmitted = upload.package.binary;
  assert.equal(transmitted.readUInt32LE(8), 8);
  assert.deepEqual(transmitted.subarray(0, 8), original.subarray(0, 8));
  assert.deepEqual(transmitted.subarray(12), original.subarray(12));
  assert.equal(upload.manifest.sha256, createHash("sha256").update(transmitted).digest("hex"));
  assert.deepEqual(Buffer.concat(upload.chunks.map(({ data }) => Buffer.from(data, "base64"))), transmitted);
  assert.equal(upload.commit.totalBytes, transmitted.length);
  assert.equal(upload.compatibility.deviceDeployable, true);
});

test("structural admission rejects zero RPC ids, canonical F2EP tamper, dimensions, trailing bytes, and oversize", async () => {
  const { compilation, html, css, script } = await compileFixture();
  const spec = structuredClone(compilation.linked.spec);
  spec.handlers.find(({ event }) => event === "hostRpc").rpcEventId = 0;
  assert.throws(() => compileRenderV2Program(spec), /1\.\.65535/u);

  const zeroRpc = compilation.package.f2ep;
  const handlerTable = zeroRpc.readUInt32LE(20);
  const host = compilation.package.program.inspection.handlers.findIndex(({ kind }) => kind === "host.rpc");
  zeroRpc.writeUInt16LE(0, handlerTable + host * 12 + 2);
  assert.throws(() => inspectRenderV2Program(zeroRpc), /event match/u);

  const offsetTamper = compilation.package.f2ep;
  offsetTamper.writeUInt32LE(offsetTamper.readUInt32LE(16) + 1, 16);
  assert.throws(() => inspectRenderV2Program(offsetTamper), /section 0/u);

  assert.throws(() => decodeRenderV2Package(Buffer.concat([compilation.package.binary, Buffer.from([0])])),
    /length|trailing|unclaimed/u);
  const badDimension = compilation.package.binary;
  badDimension.writeUInt16LE(99, 332 + 6);
  createHash("sha256").update(badDimension.subarray(332, 62_404)).digest().copy(badDimension, 20 + 20);
  assert.throws(() => decodeRenderV2Package(badDimension), /100x310|header/u);
  assert.throws(() => decodeRenderV2Package(Buffer.concat([compilation.package.binary,
    Buffer.alloc(98_305 - compilation.package.binary.length)])), /scene store/u);

  await assert.rejects(compileRenderV2Widget({ html: 3, css, script,
    atlasFactory: () => ({}) }), /HTML/u);
  await assert.rejects(compileRenderV2Widget({ html, css, script: "x".repeat(8193),
    atlasFactory: () => ({}) }), /8192/u);
  assert.equal(assessRenderV2PackageCompatibility(compilation.package,
    { profile: RENDER_V2_CURRENT_DEVICE_PROFILE }).deviceDeployable, false);
});
