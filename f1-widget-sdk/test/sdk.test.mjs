import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildAssetBank } from "../src/assets.mjs";
import { buildWidget, inspectImage } from "../src/firmware.mjs";
import { initProject } from "../src/scaffold.mjs";
import { loadWidgetSpec } from "../src/spec.mjs";

test("project generator creates an offline-composable six-species roster project", async (context) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "f1-sdk-init-test-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const project = path.join(temporary, "starter-roster");
  await initProject(project);
  const { spec } = await loadWidgetSpec(project);
  const assets = await buildAssetBank(spec);
  assert.equal(spec.name, "starter-roster");
  assert.deepEqual(spec.target.logicalCanvas, { width: 100, height: 310 });
  assert.deepEqual(spec.layout.pet, { align: "center", x: 0, y: 0 });
  assert.equal(spec.assets.roster.length, 6);
  assert.equal(assets.assets.length, 50);
  assert.equal(new Set(assets.assets.slice(2).map(({ sourceSha256 }) => sourceSha256)).size, 48,
    "all six-by-eight starter roster frames must be visually distinct files");
  assert.equal(assets.bank.length, 297184);
  assert.equal(assets.padded.length, 0x50000);
  assert.equal(assets.dromGrowth.pages, 5);
  assert.equal(assets.runtimeImageEvidence.status, "UNRESOLVED_LIVE_REGRESSION_DO_NOT_PROMOTE");
  assert.equal(assets.runtimeImageEvidence.liveVisualApproved, false);
  assert.equal(assets.runtimeImageEvidence.causeEstablished, false);
  assert.equal(assets.runtimeImageEvidence.reference.result, "LIVE_VISUAL_SUCCESS");
  assert.equal(assets.runtimeImageEvidence.reference.backgroundShape, "100x100");
  assert.equal(assets.runtimeImageEvidence.reference.nativeBankSha256,
    "db51e51c3aff251f0536eadd3522c467e11ae5714f92ce361ac901a3b3f5fab4");
  assert.equal(assets.runtimeImageEvidence.reference.bankEndAddress, 0x3c1cffa0);
  assert.equal(assets.runtimeImageEvidence.nextVirtualPageBoundary, 0x3c1d0000);
  assert.deepEqual(assets.runtimeImageEvidence.payloadsCrossingBoundary, ["sky-1"]);
  assert.equal(assets.runtimeImageEvidence.payloadsStartingBeyondBoundary.length, 48);
  assert.deepEqual(assets.assets.slice(0, 3).map(({ descriptorIndex, id }) => ({ descriptorIndex, id })), [
    { descriptorIndex: 0, id: "sky-0" },
    { descriptorIndex: 1, id: "sky-1" },
    { descriptorIndex: 2, id: "belgian-tervuren-ready" },
  ]);
  assert.equal(assets.assets.at(-1).id, "lazy-cow-sleeping");
  assert.equal(assets.assets.at(-1).descriptorIndex, 49);
  await Promise.all(["README.md", "DECISIONS.md", "TESTING.md"].map((name) =>
    readFile(path.join(project, "docs", name), "utf8")));
  await assert.rejects(initProject(project), /Refusing to overwrite/u);
});

test("DROM growth is a deterministic ceiling, not a hardcoded page count", async (context) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "f1-sdk-pages-test-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const project = path.join(temporary, "one-species");
  await initProject(project);
  const widgetPath = path.join(project, "widget.json");
  const raw = JSON.parse(await readFile(widgetPath, "utf8"));
  raw.assets.roster = raw.assets.roster.slice(0, 1);
  raw.assets.defaultSpecies = raw.assets.roster[0].id;
  await writeFile(widgetPath, `${JSON.stringify(raw, null, 2)}\n`);
  const { spec } = await loadWidgetSpec(project);
  const assets = await buildAssetBank(spec);
  const expected = Math.ceil(assets.bank.length / 0x10000) * 0x10000;
  assert.equal(assets.assets.length, 10);
  assert.equal(assets.bank.length, 102944);
  assert.equal(expected, 0x20000);
  assert.equal(assets.padded.length, expected);
  assert.equal(assets.dromGrowth.pages, 2);
});

test("sample builds deterministically with reviewed shifts and stock callbacks preserved", async (context) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "f1-sdk-build-test-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const sample = new URL("../examples/night-cat/", import.meta.url).pathname;
  const { spec } = await loadWidgetSpec(sample);
  const first = await buildWidget(spec, path.join(temporary, "first"));
  const second = await buildWidget(spec, path.join(temporary, "second"));
  assert.equal(first.manifest.status, "OFFLINE_EXPERIMENTAL_KNOWN_LIVE_IMAGE_REGRESSION");
  assert.equal(first.manifest.sdkVersion, "0.2.0");
  assert.equal(first.manifest.safety.hardwareAccess, false);
  assert.equal(first.manifest.safety.flashCommandProvided, false);
  assert.equal(first.manifest.safety.allowedMutations.length, 3);
  assert.equal(first.manifest.safety.preservedNativeKeyCallback, true);
  assert.equal(first.manifest.safety.preservedNativeWpmTick, true);
  assert.equal(first.manifest.safety.preservedStockTimerGetter, true);
  assert.equal(first.manifest.safety.iromCongruence, true);
  assert.equal(first.manifest.assets.paddedDromBytes, 0x50000);
  assert.equal(first.manifest.assets.dromGrowth.pages, 5);
  assert.equal(first.manifest.assets.descriptorOrder, "sky0, sky1, then species*8+state");
  assert.equal(first.manifest.assets.runtimeImageEvidence.status,
    "UNRESOLVED_LIVE_REGRESSION_DO_NOT_PROMOTE");
  assert.deepEqual(first.manifest.assets.runtimeImageEvidence.payloadsCrossingBoundary, ["sky-1"]);
  assert.equal(first.manifest.widget.roster.length, 6);
  assert.equal(first.manifest.widget.defaultSpecies, "cat");
  assert.equal(first.manifest.widget.input.selectionStorage, "controller-ram-only");
  assert.equal(first.manifest.safety.liveVisualApproved, false);
  assert.equal(first.manifest.code.format, "elf32-xtensa-le");
  assert.equal(first.manifest.code.relocations, 0);
  assert.equal(first.manifest.code.deterministicRebuilds, 2);
  assert.equal(first.manifest.outputs.app.sha256, second.manifest.outputs.app.sha256);
  assert.equal(first.manifest.outputs.merged.sha256, second.manifest.outputs.merged.sha256);

  const appPath = path.join(first.outputRoot, first.outputNames.app);
  const mergedPath = path.join(first.outputRoot, first.outputNames.merged);
  const report = await inspectImage(appPath);
  assert.equal(report.segmentCount, 6);
  assert.equal(report.factoryPartitionFit, true);
  assert.equal(report.digest.valid, true);
  const mergedReport = await inspectImage(mergedPath);
  assert.equal(mergedReport.appOffset, "0x10000");
  assert.equal(mergedReport.appSha256, report.appSha256);

  const corrupted = Buffer.from(await readFile(appPath));
  corrupted[0x100] ^= 1;
  const corruptedPath = path.join(temporary, "corrupted.bin");
  await writeFile(corruptedPath, corrupted);
  await assert.rejects(inspectImage(corruptedPath), /checksum|digest/iu);
});

test("legacy project builder remains hardware-free; device transport stays isolated", async () => {
  const files = [
    "../src/firmware.mjs", "../src/toolchain.mjs",
    "../src/assets.mjs", "../src/spec.mjs", "../src/scaffold.mjs", "../src/roster.mjs",
  ];
  const source = (await Promise.all(files.map((file) => readFile(new URL(file, import.meta.url), "utf8")))).join("\n");
  for (const forbidden of ["serialport", "WebSerial", "esptool", "/dev/cu.", "usbmodem"]) {
    assert.equal(source.includes(forbidden), false, `hardware transport token ${forbidden} must remain absent`);
  }
});
