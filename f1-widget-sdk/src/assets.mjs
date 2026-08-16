import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  buildNativeLvglI8SpriteBank,
  padSpriteBankForMappedDrom,
  parseSerializedLvglI8,
} from "../../custom-firmware/lib/framer-lvgl-sprite.mjs";
import { PINNED, WORKSPACE_ROOT } from "./constants.mjs";
import { assert, sha256 } from "./util.mjs";

const require = createRequire(import.meta.url);

const LIVE_STAGE3E_REFERENCE = Object.freeze({
  name: "live-visual-stage3e-100x100",
  nativeBankBytes: 60_944,
  nativeBankSha256: "db51e51c3aff251f0536eadd3522c467e11ae5714f92ce361ac901a3b3f5fab4",
  paddedBankBytes: 0x10000,
  paddedBankSha256: "e805083c99aaa0fbd05648b75fc56f29c39fa0c7aa27971572f72ae24f64582f",
  appSha256: "546ece0044e4a69ae8db9d9a781edc776f3d1d20d82105afd9ee6de47ff01aba",
  framePaths: Object.freeze([
    "framer-widgets/assets/device-lvgl-v1/sky-0.lvgl.bin",
    "framer-widgets/assets/device-lvgl-v1/sky-1.lvgl.bin",
    ...Array.from({ length: 8 }, (_, index) =>
      `framer-widgets/assets/device-lvgl-v1/cat-${index}.lvgl.bin`),
  ]),
  sourcePaths: Object.freeze([
    "framer-widgets/assets/night-sky-frames-v1/frame-00.png",
    "framer-widgets/assets/night-sky-frames-v1/frame-01.png",
    ...Array.from({ length: 8 }, (_, index) =>
      `framer-widgets/assets/wpm-cat-frames-v2-blue/frame-0${index}.png`),
  ]),
});

async function auditConverter() {
  const root = path.join(WORKSPACE_ROOT, "extracted/input-app/node_modules/@worklouder/wl-device-kit");
  const paths = {
    packageJson: path.join(root, "package.json"),
    index: path.join(root, "dist/index.js"),
    wasm: path.join(root, "wasm-node/wl_lvgl_wasm_bg.wasm"),
  };
  const [packageBytes, indexBytes, wasmBytes] = await Promise.all(
    Object.values(paths).map((file) => readFile(file)),
  );
  const packageJson = JSON.parse(packageBytes.toString("utf8"));
  assert(packageJson.version === PINNED.converter.version, "Input converter version drifted.");
  assert(sha256(packageBytes) === PINNED.converter.packageJsonSha256, "Input converter package metadata drifted.");
  assert(sha256(indexBytes) === PINNED.converter.indexSha256, "Input converter JavaScript drifted.");
  assert(sha256(wasmBytes) === PINNED.converter.wasmSha256, "Input converter WASM drifted.");
  const kit = require(root);
  assert(typeof kit.convertImageToLvgl === "function", "Pinned Input converter export is unavailable.");
  return { convertImageToLvgl: kit.convertImageToLvgl, paths };
}

async function auditLiveStage3eReference(converter) {
  const [frames, sources] = await Promise.all([
    Promise.all(LIVE_STAGE3E_REFERENCE.framePaths.map((file) =>
      readFile(path.join(WORKSPACE_ROOT, file)))),
    Promise.all(LIVE_STAGE3E_REFERENCE.sourcePaths.map((file) =>
      readFile(path.join(WORKSPACE_ROOT, file)))),
  ]);
  for (let index = 0; index < frames.length; index += 1) {
    assert(Buffer.from(converter.convertImageToLvgl(sources[index])).equals(frames[index]),
      `Pinned Input converter no longer reproduces live Stage-3E frame ${index}.`);
  }
  const native = buildNativeLvglI8SpriteBank(frames, { baseAddress: PINNED.stockDromEndAddress });
  const padded = padSpriteBankForMappedDrom(native.bank, PINNED.flashMappingPageBytes);
  assert(native.bank.length === LIVE_STAGE3E_REFERENCE.nativeBankBytes &&
    sha256(native.bank) === LIVE_STAGE3E_REFERENCE.nativeBankSha256,
  "Live-visual Stage-3E descriptor/data reference drifted.");
  assert(padded.length === LIVE_STAGE3E_REFERENCE.paddedBankBytes &&
    sha256(padded) === LIVE_STAGE3E_REFERENCE.paddedBankSha256,
  "Live-visual Stage-3E DROM padding reference drifted.");
  const nextVirtualPageBoundary =
    (PINNED.stockDromEndAddress & ~(PINNED.flashMappingPageBytes - 1)) + PINNED.flashMappingPageBytes;
  assert(PINNED.stockDromEndAddress + native.bank.length < nextVirtualPageBoundary,
    "Live-visual Stage-3E reference no longer fits before the next virtual DROM page.");
  return Object.freeze({
    name: LIVE_STAGE3E_REFERENCE.name,
    appSha256: LIVE_STAGE3E_REFERENCE.appSha256,
    backgroundShape: "100x100",
    frames: frames.length,
    nativeBankBytes: native.bank.length,
    nativeBankSha256: sha256(native.bank),
    paddedBankBytes: padded.length,
    paddedBankSha256: sha256(padded),
    bankEndAddress: PINNED.stockDromEndAddress + native.bank.length,
    nextVirtualPageBoundary,
    result: "LIVE_VISUAL_SUCCESS",
  });
}

function auditRuntimeImageEvidence(assets, bankBytes, liveReference) {
  const boundary = liveReference.nextVirtualPageBoundary;
  const payloads = assets.map(({ id, descriptorIndex, dataAddress, nativeDataBytes }) => {
    const dataEndAddress = dataAddress + nativeDataBytes;
    return Object.freeze({
      id,
      descriptorIndex,
      dataAddress,
      dataEndAddress,
      crossesNextVirtualPage: dataAddress < boundary && dataEndAddress > boundary,
      startsAtOrBeyondNextVirtualPage: dataAddress >= boundary,
    });
  });
  const crossing = payloads.filter(({ crossesNextVirtualPage }) => crossesNextVirtualPage).map(({ id }) => id);
  const beyond = payloads.filter(({ startsAtOrBeyondNextVirtualPage }) =>
    startsAtOrBeyondNextVirtualPage).map(({ id }) => id);
  const exceedsLiveProvenVirtualPage = PINNED.stockDromEndAddress + bankBytes > boundary;
  return Object.freeze({
    status: exceedsLiveProvenVirtualPage
      ? "UNRESOLVED_LIVE_REGRESSION_DO_NOT_PROMOTE"
      : "WITHIN_LIVE_PROVEN_SINGLE_VIRTUAL_PAGE_GEOMETRY",
    liveVisualApproved: false,
    causeEstablished: false,
    reference: liveReference,
    currentBankEndAddress: PINNED.stockDromEndAddress + bankBytes,
    nextVirtualPageBoundary: boundary,
    exceedsLiveProvenVirtualPage,
    payloadsCrossingBoundary: Object.freeze(crossing),
    payloadsStartingBeyondBoundary: Object.freeze(beyond),
    observation: "Live Stage-3E.2 showed white pet squares and lower-screen black/background corruption on twinkle.",
    inference: "The failure aligns with the first new virtual DROM page: sky-1 crosses it and pet payloads begin beyond it. This correlation is not a proven root cause.",
  });
}

async function loadFrame(asset, converter) {
  const source = path.resolve(asset.projectRoot ?? "", asset.source);
  const input = await readFile(source);
  const serialized = asset.format === "png" ? Buffer.from(converter.convertImageToLvgl(input)) : input;
  const info = parseSerializedLvglI8(serialized);
  assert(info.width === asset.width && info.height === asset.height,
    `${asset.id} is ${info.width}x${info.height}; expected ${asset.width}x${asset.height}.`);
  return {
    bytes: serialized,
    metadata: Object.freeze({
      id: asset.id,
      kind: asset.kind,
      backgroundIndex: asset.backgroundIndex,
      speciesId: asset.speciesId,
      speciesName: asset.speciesName,
      speciesIndex: asset.speciesIndex,
      state: asset.state,
      stateIndex: asset.stateIndex,
      format: asset.format,
      source: asset.source,
      sourceSha256: sha256(input),
      lvglSha256: sha256(serialized),
      width: info.width,
      height: info.height,
      stride: info.stride,
      serializedBytes: info.serializedBytes,
    }),
  };
}

export async function buildAssetBank(spec) {
  const converter = await auditConverter();
  const liveReference = await auditLiveStage3eReference(converter);
  const ordered = [
    ...spec.assets.backgrounds.map((asset, backgroundIndex) => ({
      ...asset,
      kind: "background",
      backgroundIndex,
    })),
    ...spec.assets.roster.flatMap((species, speciesIndex) => species.frames.map((asset, stateIndex) => ({
      ...asset,
      kind: "pet",
      speciesId: species.id,
      speciesName: species.name,
      speciesIndex,
      state: spec.stateMachine.states[stateIndex],
      stateIndex,
    }))),
  ].map((asset) => ({ ...asset, projectRoot: spec.projectRoot }));
  const loaded = [];
  for (const asset of ordered) loaded.push(await loadFrame(asset, converter));
  const native = buildNativeLvglI8SpriteBank(loaded.map(({ bytes }) => bytes), {
    baseAddress: PINNED.stockDromEndAddress,
  });
  const padded = padSpriteBankForMappedDrom(native.bank, PINNED.flashMappingPageBytes);
  const expectedPaddedBytes = Math.ceil(native.bank.length / PINNED.flashMappingPageBytes) *
    PINNED.flashMappingPageBytes;
  assert(padded.length === expectedPaddedBytes && padded.length >= native.bank.length &&
    padded.length % PINNED.flashMappingPageBytes === 0,
  "Asset bank did not pad to deterministic ceil(bank/64KiB) DROM growth.");
  const metadata = loaded.map(({ metadata }, index) => Object.freeze({
    ...metadata,
    descriptorAddress: native.descriptors[index].descriptorAddress,
    dataAddress: native.descriptors[index].dataAddress,
    nativeDataBytes: native.descriptors[index].dataBytes,
    descriptorIndex: index,
  }));
  return Object.freeze({
    bank: native.bank,
    padded,
    descriptors: native.descriptors,
    assets: Object.freeze(metadata),
    descriptorOrder: "sky0, sky1, then species*8+state",
    dromGrowth: Object.freeze({
      formula: "ceil(bankBytes / 0x10000) * 0x10000",
      pageBytes: PINNED.flashMappingPageBytes,
      pages: padded.length / PINNED.flashMappingPageBytes,
      bytes: padded.length,
    }),
    runtimeImageEvidence: auditRuntimeImageEvidence(metadata, native.bank.length, liveReference),
    converter: Object.freeze({
      package: PINNED.converter.package,
      version: PINNED.converter.version,
      packageJsonSha256: PINNED.converter.packageJsonSha256,
      indexSha256: PINNED.converter.indexSha256,
      wasmSha256: PINNED.converter.wasmSha256,
    }),
  });
}
