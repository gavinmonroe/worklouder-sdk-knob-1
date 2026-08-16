import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { applyStage3c1OwnedLabels, decodeStage3c1AbiHex } from "../../custom-firmware/build-stage3c1.mjs";
import {
  extendEsp32AppSegment,
  inspectEsp32AppImage,
  repairEsp32AppIntegrity,
} from "../../custom-firmware/lib/esp-app-image.mjs";
import { auditFramerImagePipeline } from "../../custom-firmware/lib/framer-lvgl-sprite.mjs";
import { PINNED, SDK_FORMAT } from "./constants.mjs";
import { buildAssetBank } from "./assets.mjs";
import { compileWidget } from "./toolchain.mjs";
import { assert, hex, sha256, stableJson } from "./util.mjs";

function colorValue(input) {
  return `0x${input.slice(1).toLowerCase()}`;
}

function tokensFor(spec, assets) {
  const [background0, background1] = assets.descriptors;
  const pet0 = assets.descriptors[spec.assets.backgrounds.length];
  const colors = spec.style.wpmColors;
  return Object.freeze({
    CODE_BASE_ADDRESS: hex(PINNED.codeBaseAddress),
    SCREEN_ID: spec.target.screenId,
    BACKGROUND_DESCRIPTOR_0: hex(background0.descriptorAddress),
    BACKGROUND_DESCRIPTOR_1: hex(background1.descriptorAddress),
    PET_DESCRIPTOR_0: hex(pet0.descriptorAddress),
    SPECIES_COUNT: spec.assets.roster.length,
    LAST_SPECIES_INDEX: spec.assets.roster.length - 1,
    DEFAULT_SPECIES_INDEX: spec.assets.defaultSpeciesIndex,
    COLOR_IDLE: colorValue(colors.idle),
    COLOR_LOW: colorValue(colors.low),
    COLOR_MEDIUM: colorValue(colors.medium),
    COLOR_HIGH: colorValue(colors.high),
  });
}

function assertOnlyWordChanged(before, after, relativeOffset, description) {
  assert(before.subarray(0, relativeOffset).equals(after.subarray(0, relativeOffset)),
    `${description} changed bytes before its reviewed word.`);
  assert(before.subarray(relativeOffset + 4).equals(after.subarray(relativeOffset + 4)),
    `${description} changed bytes after its reviewed word.`);
}

function auditFinalMutation(baseApp, finalApp, assetPage, code, entryAddress) {
  const before = inspectEsp32AppImage(baseApp);
  const after = inspectEsp32AppImage(finalApp);
  assert(before.segmentCount === PINNED.segmentCount && after.segmentCount === PINNED.segmentCount,
    "The reviewed six-segment layout changed.");
  const setupRelative = PINNED.setupPointerAppOffset - before.segments[0].dataOffset;

  for (let index = 0; index < PINNED.segmentCount; index += 1) {
    const oldSegment = before.segments[index];
    const newSegment = after.segments[index];
    assert(oldSegment.loadAddress === newSegment.loadAddress, `Segment ${index} load address changed.`);
    if (index === PINNED.dromSegmentIndex) {
      assert(newSegment.headerOffset === oldSegment.headerOffset &&
        newSegment.dataOffset === oldSegment.dataOffset, "DROM header moved unexpectedly.");
      assert(newSegment.length === oldSegment.length + assetPage.length,
        "DROM growth differs from deterministic whole-page asset padding.");
      assertOnlyWordChanged(oldSegment.data,
        newSegment.data.subarray(0, oldSegment.length), setupRelative, "Setup hook");
      assert(newSegment.data.subarray(oldSegment.length).equals(assetPage), "DROM append differs from asset bank.");
    } else if (index === PINNED.iromSegmentIndex) {
      assert(newSegment.headerOffset === oldSegment.headerOffset + assetPage.length &&
        newSegment.dataOffset === oldSegment.dataOffset + assetPage.length,
      "IROM physical mapping did not move by exactly the padded DROM growth.");
      assert(newSegment.length === oldSegment.length + code.length, "IROM growth differs from compiled widget code.");
      assert(newSegment.data.subarray(0, oldSegment.length).equals(oldSegment.data),
        "Existing IROM bytes changed.");
      assert(newSegment.data.subarray(oldSegment.length).equals(code), "IROM append differs from compiled code.");
    } else {
      const physicalShift = index < PINNED.iromSegmentIndex ? assetPage.length : assetPage.length + code.length;
      assert(newSegment.headerOffset === oldSegment.headerOffset + physicalShift &&
        newSegment.dataOffset === oldSegment.dataOffset + physicalShift,
      `Untargeted segment ${index} moved by an unexpected amount.`);
      assert(newSegment.length === oldSegment.length && newSegment.data.equals(oldSegment.data),
        `Untargeted segment ${index} changed.`);
    }
  }
  assert(after.segments.filter(({ loadAddress }) => loadAddress === PINNED.dromLoadAddress).length === 1,
    "Final image must retain exactly one DROM mapping.");
  assert(after.segments.filter(({ loadAddress }) => loadAddress === PINNED.iromLoadAddress).length === 1,
    "Final image must retain exactly one IROM mapping.");
  const irom = after.segments[PINNED.iromSegmentIndex];
  assert((irom.dataOffset & 0xffff) === (irom.loadAddress & 0xffff),
    "DROM growth broke IROM 64-KiB flash/MMU congruence.");
  assert(finalApp.readUInt32LE(PINNED.setupPointerAppOffset) === entryAddress,
    "Final setup hook does not target the compiled entry symbol.");
  const oldIrom = before.segments[PINNED.iromSegmentIndex];
  const shiftedKeyCallbackAppOffset = irom.dataOffset + (PINNED.keyCallbackAppOffset - oldIrom.dataOffset);
  const shiftedTimerGetterAppOffset = irom.dataOffset + (PINNED.timerGetterAppOffset - oldIrom.dataOffset);
  assert(finalApp.readUInt32LE(shiftedKeyCallbackAppOffset) === PINNED.keyCallbackExpected,
    "Native key callback was not preserved.");
  assert(finalApp.readUInt32LE(PINNED.wpmTickAppOffset) === PINNED.wpmTickExpected,
    "Native WPM tick was not preserved.");
  assert(finalApp.readUInt32LE(shiftedTimerGetterAppOffset) === PINNED.timerGetterExpected,
    "Stock Timer remaining-time getter was not preserved.");
  assert(finalApp.length <= PINNED.factoryPartitionBytes, "Generated app exceeds the factory partition.");
  return Object.freeze({
    allowedMutations: Object.freeze([
      Object.freeze({ kind: "word", appOffset: PINNED.setupPointerAppOffset, to: entryAddress }),
      Object.freeze({ kind: "append", segment: PINNED.dromSegmentIndex, bytes: assetPage.length }),
      Object.freeze({ kind: "append", segment: PINNED.iromSegmentIndex, bytes: code.length }),
    ]),
    factoryPartitionHeadroom: PINNED.factoryPartitionBytes - finalApp.length,
    iromCongruence: true,
    preservedNativeKeyCallback: true,
    shiftedKeyCallbackAppOffset,
    preservedNativeWpmTick: true,
    preservedStockTimerGetter: true,
    shiftedTimerGetterAppOffset,
  });
}

export async function buildWidget(spec, outputDirectory) {
  const [officialMerged, stage3c1Hex, sourceTemplate, linkerTemplate] = await Promise.all([
    readFile(PINNED.officialMerged.path),
    readFile(PINNED.stage3c1Abi.path, "utf8"),
    readFile(spec.resolved.assembly, "utf8"),
    readFile(spec.resolved.linker, "utf8"),
  ]);
  assert(sha256(officialMerged) === PINNED.officialMerged.sha256, "Official merged firmware drifted.");
  assert(sha256(Buffer.from(stage3c1Hex)) === PINNED.stage3c1Abi.fileSha256, "Stage-3C.1 ABI file drifted.");
  const stage3c1 = applyStage3c1OwnedLabels(officialMerged, decodeStage3c1AbiHex(stage3c1Hex));
  assert(sha256(stage3c1.app) === PINNED.stage3c1Abi.appSha256, "Reconstructed Stage-3C.1 base drifted.");
  const baseInfo = inspectEsp32AppImage(stage3c1.app);
  assert(baseInfo.segments[PINNED.iromSegmentIndex].loadAddress +
    baseInfo.segments[PINNED.iromSegmentIndex].length === PINNED.codeBaseAddress,
  "Pinned Stage-3C.1 IROM append boundary drifted.");
  assert(stage3c1.app.readUInt32LE(PINNED.setupPointerAppOffset) === PINNED.setupPointerExpected,
    "Pinned Stage-3C.1 setup pointer drifted.");
  assert(stage3c1.app.readUInt32LE(PINNED.keyCallbackAppOffset) === PINNED.keyCallbackExpected,
    "Pinned Stage-3C.1 stock key callback drifted.");
  assert(stage3c1.app.readUInt32LE(PINNED.wpmTickAppOffset) === PINNED.wpmTickExpected,
    "Pinned Stage-3C.1 native WPM tick drifted.");
  assert(stage3c1.app.readUInt32LE(PINNED.timerGetterAppOffset) === PINNED.timerGetterExpected,
    "Pinned Stage-3C.1 Timer getter drifted.");
  auditFramerImagePipeline(stage3c1.app);

  const assets = await buildAssetBank(spec);
  const tokens = tokensFor(spec, assets);
  const compiled = await compileWidget({
    sourceTemplate,
    linkerTemplate,
    tokens,
    descriptorAddresses: assets.descriptors.map(({ descriptorAddress }) => descriptorAddress),
  });
  let app = extendEsp32AppSegment(stage3c1.app, {
    segmentIndex: PINNED.dromSegmentIndex,
    data: assets.padded,
  });
  app = extendEsp32AppSegment(app, {
    segmentIndex: PINNED.iromSegmentIndex,
    data: compiled.binary,
  });
  app.writeUInt32LE(compiled.entry.address, PINNED.setupPointerAppOffset);
  app = repairEsp32AppIntegrity(app);
  const integrity = inspectEsp32AppImage(app);
  const audit = auditFinalMutation(stage3c1.app, app, assets.padded, compiled.binary, compiled.entry.address);
  const merged = Buffer.concat([officialMerged.subarray(0, PINNED.appFlashOffset), app]);
  assert(merged.subarray(0, PINNED.appFlashOffset).equals(
    officialMerged.subarray(0, PINNED.appFlashOffset)), "Merged-image pre-app prefix changed.");
  assert(merged.subarray(PINNED.appFlashOffset).equals(app), "Merged-image app payload differs from audited app.");

  const outputRoot = path.resolve(outputDirectory);
  await mkdir(outputRoot, { recursive: true });
  const outputNames = {
    app: `${spec.name}-app.bin`,
    merged: `${spec.name}-merged.bin`,
    assets: `${spec.name}-assets-drom.bin`,
    code: `${spec.name}-code-irom.bin`,
    source: `${spec.name}-rendered.S`,
    linker: `${spec.name}-rendered.ld`,
    disassembly: `${spec.name}-disassembly.txt`,
    manifest: `${spec.name}-manifest.json`,
  };
  const manifest = {
    format: SDK_FORMAT,
    sdkVersion: "0.2.0",
    status: "OFFLINE_EXPERIMENTAL_KNOWN_LIVE_IMAGE_REGRESSION",
    officialCompatibility: false,
    target: spec.target,
    widget: {
      name: spec.name,
      profile: spec.profile,
      layout: spec.layout,
      stateMachine: spec.stateMachine,
      timing: spec.timing,
      roster: spec.assets.roster.map(({ id, name }, index) => ({ id, name, index })),
      defaultSpecies: spec.assets.defaultSpecies,
      input: spec.input,
    },
    pinnedBase: {
      name: "live-tested-stage3c1",
      officialMergedSha256: PINNED.officialMerged.sha256,
      baseAppSha256: PINNED.stage3c1Abi.appSha256,
      codeBaseAddress: hex(PINNED.codeBaseAddress),
    },
    converter: assets.converter,
    assets: {
      frames: assets.assets,
      bankBytes: assets.bank.length,
      paddedDromBytes: assets.padded.length,
      dromGrowth: assets.dromGrowth,
      descriptorOrder: assets.descriptorOrder,
      runtimeImageEvidence: assets.runtimeImageEvidence,
      sha256: sha256(assets.padded),
    },
    code: {
      format: "elf32-xtensa-le",
      relocations: 0,
      deterministicRebuilds: compiled.deterministicRebuilds,
      bytes: compiled.binary.length,
      sha256: compiled.sha256,
      entrySymbol: PINNED.entrySymbol,
      entryAddress: hex(compiled.entry.address),
      toolchainSha256: compiled.toolchainHashes,
    },
    safety: {
      hardwareAccess: false,
      flashCommandProvided: false,
      liveVisualApproved: false,
      segmentCount: integrity.segmentCount,
      checksumOffset: integrity.checksumOffset,
      checksum: hex(integrity.storedChecksum),
      digest: integrity.storedDigest?.toString("hex"),
      ...audit,
    },
    outputs: {},
    rollback: {
      reference: "Exact live-tested Stage-3C.1 app",
      appSha256: PINNED.stage3c1Abi.appSha256,
      recoveryDirectory: "recovery/backups/2026-08-15-framer-f1-a4cb8faf3210-before-custom",
      note: "This SDK never writes hardware. Any later deployment needs the independent recovery workflow.",
    },
  };
  const files = {
    app: app,
    merged,
    assets: assets.padded,
    code: compiled.binary,
    source: Buffer.from(compiled.source),
    linker: Buffer.from(compiled.linker),
    disassembly: Buffer.from(compiled.disassembly),
  };
  for (const [kind, bytes] of Object.entries(files)) {
    await writeFile(path.join(outputRoot, outputNames[kind]), bytes, { flag: "w" });
    manifest.outputs[kind] = { file: outputNames[kind], bytes: bytes.length, sha256: sha256(bytes) };
  }
  await writeFile(path.join(outputRoot, outputNames.manifest), stableJson(manifest), { flag: "w" });
  return Object.freeze({ manifest, outputRoot, outputNames });
}

export async function inspectImage(imagePath) {
  const bytes = await readFile(path.resolve(imagePath));
  let app = bytes;
  let appOffset = 0;
  let info;
  try {
    info = inspectEsp32AppImage(app);
  } catch (appError) {
    if (bytes.length <= PINNED.appFlashOffset || bytes[PINNED.appFlashOffset] !== 0xe9) throw appError;
    app = bytes.subarray(PINNED.appFlashOffset);
    appOffset = PINNED.appFlashOffset;
    info = inspectEsp32AppImage(app);
  }
  return {
    file: path.resolve(imagePath),
    fileBytes: bytes.length,
    fileSha256: sha256(bytes),
    appOffset: hex(appOffset),
    appBytes: app.length,
    appSha256: sha256(app),
    segmentCount: info.segmentCount,
    segments: info.segments.map(({ index, headerOffset, dataOffset, loadAddress, length }) => ({
      index,
      headerOffset: hex(headerOffset + appOffset),
      dataOffset: hex(dataOffset + appOffset),
      loadAddress: hex(loadAddress),
      length,
    })),
    checksum: { offset: hex(info.checksumOffset + appOffset), value: hex(info.storedChecksum), valid: true },
    digest: info.digestAppended ? {
      offset: hex(info.digestOffset + appOffset),
      sha256: info.storedDigest.toString("hex"),
      valid: true,
    } : { appended: false },
    factoryPartitionFit: app.length <= PINNED.factoryPartitionBytes,
    factoryPartitionHeadroom: PINNED.factoryPartitionBytes - app.length,
  };
}
