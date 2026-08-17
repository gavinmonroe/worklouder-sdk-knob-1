#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { inspectEsp32AppImage } from "../../custom-firmware/lib/esp-app-image.mjs";

const execute = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(here, "../..");
const output = path.resolve(process.env.FRAMER_PHYSICAL_OUTPUT ?? path.join(here, "build"));
const acceptedAppPath = path.join(repository,
  "f1-widget-sdk/build/combined-renderer-v2-clock-blue-timer/" +
  "framer-0.4.1-music-id1-wpm-id7-renderer-id26-clock-id27-blue-timer-app.bin");
const candidatePath = path.join(output,
  "framer-0.4.1-mqjs-id28-canary-NO-GO-app.bin");
const textPath = path.join(output, "mqjs-id28-text-page.bin");
const rodataPath = path.join(output, "mqjs-id28-rodata-page.bin");
const slotPath = path.join(output, "mqjs-id28-slot-a.bin");
const loaderPath = path.join(output, "mqjs-id28-resident-loader.bin");
const detailedManifestPath = path.join(output, "physical-link-manifest.json");
const verifierOutputPath = path.join(output, "verify-output.json");
const keyProofPath = path.join(output, "key-token-proof.json");
const linkReportPath = path.join(output, "physical-static-link-report.json");
const releaseClosurePath = path.join(output, "release-closure.json");
const toolchain = process.env.FRAMER_XTENSA_BIN ?? path.join(repository,
  ".toolchains/xtensa-esp-elf-13.2.0_20240530/bin");
const objdump = path.join(toolchain, "xtensa-esp32s3-elf-objdump");

const invariant = (value, message) => { if (!value) throw new Error(message); };
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const hex = (value) => `0x${value.toString(16)}`;
const relative = (value) => path.relative(repository, value);

const frozen = Object.freeze({
  acceptedAppSha256: "363170139a06f306be1e894b6f203a9bf03bf4d70d21194aaccdd1c42f760c32",
  candidateAppSha256: "674054a6e9d6536ad2414096cd89c1025e78904dff6b4a1aee0ef8cab434e808",
  moduleTextSha256: "bd46e3473b8493291aadebcf1d093e812a0788866e787663920637a3d76c8c43",
  moduleRodataSha256: "72a2a26cb9cb0c0c52ab0ee897ad5d59b0a3c9765d3f495bfe96565b305a8c43",
  moduleSlotSha256: "b1104134b37c9b6726e96f852b28e1eb971ba3aa4870d44543cfd1c5e8c6a6c1",
  loaderSha256: "cd0e352b46d23193d07c696355442ee2a68311c44ad3a901692627560fbde97c",
  detailedManifestSha256: "1e6db47df0b00b1ed6968f0664e9786feaffcc6d6c48442afff121a04eaeaad1",
  verifierOutputSha256: "51f25da8884add400b9e4ad0dca889c22eb26c022b092c4285fd00f8de79b4f6",
  canonicalWeatherSourceSha256: "68db9d61fa38b0a396e46e88076d75d262a486f2ec4b41b4d398454d7d713e9b",
  canonicalWeatherPackageSha256: "88537026c8b217b763c393b82d8787ca08256681265976f7bcff6077b2282d20",
  canaryEngineSourceSha256: "f634d62094e6c3d08f7d6cf1975edf9afa5b9f53799599014a9a2ac3d09e1c19",
  packageAbiSha256: "5091736403d809078cbbf12a1b593fbabaff53474a0935a7e00ce81dc8bd67f8",
  moduleAbiSha256: "ad484a3a8b438c51f6bbcda6ea871110735b3460e39e4c2853a4e636f5f728cb",
  callbackSpanSha256: "96316a9091816bf7290c75ebe6be76e4ed184ee13fdef6c50b77e791b5ecfa2b",
  callbackLiteralSha256: "3d5174006fa28e9caeef531cbcdec7bd1d552b0ab7ad1d4f4a8d30c44c0e1dda",
  shiftMaskLiteralSha256: "6633cfb1c776a95202ce8dd8b6860a41b35686e615252e728f381fe985bd88a9",
  low24ExtractionSha256: "c4af05e26202a7ce8c77c75feac39c027fa7a993961b22e02ae96c00606693e3",
  spaceInstructionSha256: "5c992029c86fe57f2685b6b68b6ef2595fe23ab0a8762dd991fbe7f42a256eb1",
  leftShiftInstructionSha256: "8f30bf1c859978bd464ef0b87aa50943697c88b4ecd31f11233116db2926356d",
  keyTokenHeaderSha256: "21a329163d9ba9bb023c2e3f708462840e4623447f18241f3a5e924d0358271f",
  keyGateHeaderSha256: "2cc044cbb2cd0f63bdbc73882033bc26a1e488c33c89f078af6456ddf411e22c",
  keyWrapperSourceSha256: "7ed1dde267c45a1ffa91e9ebd54d6becc5238d88b60fec6c66622e716ca8831c",
  hostHarnessSha256: "a4b742e783c26c5d84d1adabc477d65b123243cfdaf7141c9ce765eec4b078f8",
});

async function writeJsonAtomic(file, value) {
  const temporary = `${file}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, file);
}

const spans = Object.freeze({
  callback: { start: 0x4206eae0, end: 0x4206eb48,
    sha256: frozen.callbackSpanSha256 },
  callbackLiteral: { start: 0x42041568, end: 0x4204156c,
    sha256: frozen.callbackLiteralSha256 },
  shiftMaskLiteral: { start: 0x42041550, end: 0x42041554,
    sha256: frozen.shiftMaskLiteralSha256 },
  low24Extraction: { start: 0x4206eaeb, end: 0x4206eaf8,
    hex: "80a911808801c802a0a841fce8", sha256: frozen.low24ExtractionSha256 },
  spaceCompare: { start: 0x4206eafa, end: 0x4206eb02,
    hex: "2cc890d074879a1e", sha256: frozen.spaceInstructionSha256 },
  leftShiftCompare: { start: 0x4206eb24, end: 0x4206eb30,
    hex: "a18b4a82a0e1a09910879914", sha256: frozen.leftShiftInstructionSha256 },
});

function readVirtual(image, start, end) {
  const segment = image.segments.find((candidate) => start >= candidate.loadAddress &&
    end <= candidate.loadAddress + candidate.length);
  invariant(segment != null, `No accepted-app segment contains ${hex(start)}..${hex(end)}.`);
  return segment.data.subarray(start - segment.loadAddress, end - segment.loadAddress);
}

function proveSpan(image, name, span) {
  const bytes = readVirtual(image, span.start, span.end);
  invariant(bytes.length === span.end - span.start && sha256(bytes) === span.sha256,
    `Accepted-app ${name} span changed.`);
  if (span.hex != null) invariant(bytes.toString("hex") === span.hex,
    `Accepted-app ${name} instruction bytes changed.`);
  return Object.freeze({ start: hex(span.start), end: hex(span.end), bytes: bytes.length,
    hex: bytes.toString("hex"), sha256: span.sha256 });
}

async function verifyDisassembly(image) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "framer-key-proof-"));
  try {
    const callbackPath = path.join(temporary, "stock-key-callback.bin");
    await writeFile(callbackPath, readVirtual(image, spans.callback.start, spans.callback.end));
    const { stdout } = await execute(objdump, ["-D", "-b", "binary", "-m", "xtensa",
      "--adjust-vma=0x4206eae0", callbackPath], { maxBuffer: 1024 * 1024 });
    invariant(/4206eafa:\s+2cc8\s+movi\.n\s+a8, 44/u.test(stdout) &&
      /4206eaff:\s+879a1e\s+bne\s+a10, a8, 0x4206eb21/u.test(stdout),
    "Accepted-app Space comparison disassembly changed.");
    invariant(/4206eb24:\s+a18b4a\s+l32r\s+a10, 0x42041550/u.test(stdout) &&
      /4206eb27:\s+82a0e1\s+movi\s+a8, 225/u.test(stdout) &&
      /4206eb2a:\s+a09910\s+and\s+a9, a9, a10/u.test(stdout) &&
      /4206eb2d:\s+879914\s+bne\s+a9, a8, 0x4206eb45/u.test(stdout),
    "Accepted-app LeftShift comparison disassembly changed.");
    return Object.freeze({ tool: relative(objdump),
      assertions: ["movi.n a8,44 then bne a10,a8", "mask load then movi a8,225, and, bne"] });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function readPinned(file, expectedSha256, label) {
  const bytes = await readFile(file);
  invariant(sha256(bytes) === expectedSha256, `${label} frozen identity changed.`);
  return bytes;
}

const [acceptedApp, candidate, text, rodata, slot, loader, detailedManifestBytes,
  verifierOutputBytes, keyTokenHeader, keyGateHeader, keyWrapperSource, hostHarness] =
  await Promise.all([
    readPinned(acceptedAppPath, frozen.acceptedAppSha256, "Accepted app"),
    readPinned(candidatePath, frozen.candidateAppSha256, "Candidate app"),
    readPinned(textPath, frozen.moduleTextSha256, "Module text page"),
    readPinned(rodataPath, frozen.moduleRodataSha256, "Module rodata page"),
    readPinned(slotPath, frozen.moduleSlotSha256, "Module slot"),
    readPinned(loaderPath, frozen.loaderSha256, "Resident loader"),
    readPinned(detailedManifestPath, frozen.detailedManifestSha256, "Detailed link manifest"),
    readPinned(verifierOutputPath, frozen.verifierOutputSha256, "Verifier output"),
    readPinned(path.join(here, "key_token.h"), frozen.keyTokenHeaderSha256,
      "Key normalization header"),
    readPinned(path.join(here, "key_gate.h"), frozen.keyGateHeaderSha256,
      "Key discovery gate header"),
    readPinned(path.join(here, "key_wrapper.c"), frozen.keyWrapperSourceSha256,
      "Stock-first key wrapper"),
    readPinned(path.join(here, "physical_host_harness.c"), frozen.hostHarnessSha256,
      "Key negative harness"),
  ]);

invariant(Buffer.concat([text, rodata]).equals(slot),
  "Module slot is not the exact text+rodata concatenation.");
const detailedManifest = JSON.parse(detailedManifestBytes.toString("utf8"));
invariant(detailedManifest.status ===
  "PASS_DETERMINISTIC_LINK_PENDING_INDEPENDENT_AUDIT_NO_GO_PHYSICAL" &&
  detailedManifest.candidateApp?.sha256 === frozen.candidateAppSha256 &&
  detailedManifest.module?.slotA?.sha256 === frozen.moduleSlotSha256 &&
  detailedManifest.module?.abiVersion === 3 &&
  detailedManifest.module?.moduleAbiSha256 === frozen.moduleAbiSha256 &&
  detailedManifest.module?.packageAbiSha256 === frozen.packageAbiSha256 &&
  detailedManifest.module?.moduleAbiSha256 !== detailedManifest.module?.packageAbiSha256 &&
  detailedManifest.allocationMapOrdering ===
    "internal-block-before-first-mmu-map-adopt-or-rollback-v1" &&
  detailedManifest.telemetrySnapshotProtocol ===
    "p0-locks-snapshot-ordered-p1-p5-expiry-clear-v1" &&
  detailedManifest.uiLatencyMetric ===
    "id28-full-proxy-tick-oldtick-base-lzss-f2tf-publish-us-v1" &&
  detailedManifest.assets?.canonicalWeather?.sourceSha256 ===
    frozen.canonicalWeatherSourceSha256 &&
  detailedManifest.assets?.canonicalWeather?.packageSha256 ===
    frozen.canonicalWeatherPackageSha256 &&
  detailedManifest.verification?.engineSourceSha256 === frozen.canaryEngineSourceSha256 &&
  detailedManifest.verification?.focusReleaseReentry ===
    "PASS_LATE_KEY_AND_FN_WRAPPER_BARRIER_HOST_INTERLEAVE_NONTERMINAL_RELEASE_HIDDEN_NO_HOLD_REENTRY_DOWN_HOLD_UP_CHORD" &&
  detailedManifest.verification?.taggedCompletionTelemetry ===
    "PASS_COMPLETION_FIELDS_THEN_COHERENT_P2_REFRESH_THEN_TERMINAL_RECEIPT_RELEASE_LAST_WHILE_ADMISSION_CLOSED" &&
  detailedManifest.verification?.weatherFaultRecovery ===
    "PASS_REV7_TIMEOUT_BENIGN_AND_OOM_BENIGN_SLOTS0_11_UNCHANGED_THEN_MONOTONIC_REV8_NORMAL_AND_MOVING_GC_ASAN",
"Detailed frozen manifest no longer carries the scoped static-link result.");
invariant(keyTokenHeader.includes(Buffer.from("raw & 0x00ffffffu")) &&
  keyWrapperSource.includes(Buffer.from("STOCK_KEY_ORIGINAL(stock_owner")) &&
  keyWrapperSource.includes(Buffer.from("framer_physical_normalize_key_token(*opaque_token)")),
"Stock-first low24 normalization source invariant changed.");
invariant(keyGateHeader.includes(Buffer.from("if (was_committed == 0u)")) &&
  keyGateHeader.includes(Buffer.from("return 0;")),
"Discovery-edge non-dispatch gate invariant changed.");
for (const evidence of ["0xab00002cu", "0xcd0000e1u", "0xcd0000e5u",
  "key_probe.observation_count == observations + 1u", "key_probe.last_token == 0xe5u"]) {
  invariant(hostHarness.includes(Buffer.from(evidence)),
    `Key negative harness lost evidence: ${evidence}.`);
}

const image = inspectEsp32AppImage(acceptedApp);
const callback = proveSpan(image, "callback", spans.callback);
const callbackLiteral = proveSpan(image, "callback literal", spans.callbackLiteral);
const shiftMaskLiteral = proveSpan(image, "shift mask literal", spans.shiftMaskLiteral);
invariant(callbackLiteral.hex === "e0ea0642", "Callback pointer literal changed.");
invariant(shiftMaskLiteral.hex === "fbffff00", "Stock shift-mask literal changed.");
const low24Extraction = proveSpan(image, "low24 extraction", spans.low24Extraction);
const spaceCompare = proveSpan(image, "Space compare", spans.spaceCompare);
const leftShiftCompare = proveSpan(image, "LeftShift compare", spans.leftShiftCompare);
const disassembly = await verifyDisassembly(image);

const keyProof = {
  format: "framer-f1-mquickjs-key-token-proof-v1",
  status: "EXACT_TOKEN_MAP_PROVEN",
  scope: "ACCEPTED_APP_STATIC_DISASSEMBLY_PLUS_FROZEN_CANDIDATE_HOST_HARNESS",
  acceptedAppSha256: frozen.acceptedAppSha256,
  callbackSpanSha256: frozen.callbackSpanSha256,
  callbackLiteralSha256: frozen.callbackLiteralSha256,
  spaceInstructionSha256: frozen.spaceInstructionSha256,
  leftShiftInstructionSha256: frozen.leftShiftInstructionSha256,
  keyTokenNormalization: "raw-low24-after-stock-first-v1",
  keyNegativeHarness: "low24-e5-observed-never-mapped-pass-v1",
  mappings: [{ logical: 0, nativeToken: 44 }, { logical: 1, nativeToken: 225 }],
  chordHeldMask: 3,
  rejectedLow24Tokens: [229],
  postFlashObservationRequired: true,
  postFlashObservationStatus: "REQUIRED_NOT_PERFORMED",
  dispatchAdmission: "keyEvents remains false until exact 44 and 225 down+up observations while ID28 is foreground; all discovery edges are observation-only",
  acceptedAppEvidence: {
    callback, callbackLiteral, shiftMaskLiteral, low24Extraction, spaceCompare,
    leftShiftCompare, disassembly,
    interpretation: "Stock handles the original raw token first. Candidate ingress strips only high8 category. It does not apply stock's 0x00fffffb shift mask; exact low24 229 therefore remains unmapped and cannot alias logical LeftShift 225 in JavaScript.",
  },
  candidateHarnessEvidence: {
    keyTokenNormalization: { file: relative(path.join(here, "key_token.h")),
      sha256: frozen.keyTokenHeaderSha256,
      vectors: [{ raw: "0xab00002c", low24: 44 }, { raw: "0xcd0000e1", low24: 225 },
        { raw: "0xcd0000e5", low24: 229 }] },
    stockFirstWrapper: { file: relative(path.join(here, "key_wrapper.c")),
      sha256: frozen.keyWrapperSourceSha256 },
    discoveryGate: { file: relative(path.join(here, "key_gate.h")),
      sha256: frozen.keyGateHeaderSha256,
      result: "PASS_FOUR_DISCOVERY_EDGES_ZERO_DISPATCH_FIFTH_SPACE_DOWN_FIRST_DISPATCH" },
    negativeHarness: { file: relative(path.join(here, "physical_host_harness.c")),
      sha256: frozen.hostHarnessSha256,
      contract: "low24-e5-observed-never-mapped-pass-v1",
      result: "PASS_E5_OBSERVATION_INCREMENTED_WITH_ZERO_MAP_OR_JS_DISPATCH" },
  },
  limitations: [
    "Static proof does not assert that the physical key transport emits these tokens on this keyboard.",
    "A guarded post-flash foreground-ID28 observation receipt is mandatory before keyEvents may advertise true.",
  ],
};
await writeJsonAtomic(keyProofPath, keyProof);
const keyProofBytes = await readFile(keyProofPath);

const linkReport = {
  format: "framer-f1-mquickjs-physical-static-link-report-v1",
  status: "STATIC_LINK_GO_PENDING_INDEPENDENT_AUDIT",
  verdict: "GO",
  verdictScope: "DETERMINISTIC_STATIC_LINK_ONLY",
  overallPhysicalVerdict: "NO_GO_PENDING_INDEPENDENT_AUDIT_AND_GUARDED_HARDWARE",
  deployable: false,
  hardwareTouched: false,
  flashCommandGenerated: false,
  candidateAppSha256: frozen.candidateAppSha256,
  moduleTextSha256: frozen.moduleTextSha256,
  moduleRodataSha256: frozen.moduleRodataSha256,
  moduleSlotSha256: frozen.moduleSlotSha256,
  loaderSha256: frozen.loaderSha256,
  packageAbiSha256: frozen.packageAbiSha256,
  moduleAbiSha256: frozen.moduleAbiSha256,
  sourceClosureSha256: detailedManifest.verification.sourceClosure.sha256,
  telemetrySnapshotProtocol: "p0-locks-snapshot-ordered-p1-p5-expiry-clear-v1",
  uiLatencyMetric: "id28-full-proxy-tick-oldtick-base-lzss-f2tf-publish-us-v1",
  allocationMapOrdering: "internal-block-before-first-mmu-map-adopt-or-rollback-v1",
  keyNegativeHarness: "low24-e5-observed-never-mapped-pass-v1",
  keyTokenNormalization: "raw-low24-after-stock-first-v1",
  mappings: [{ logical: 0, nativeToken: 44 }, { logical: 1, nativeToken: 225 }],
  chordHeldMask: 3,
  rejectedLow24Tokens: [229],
  canonicalWeather: {
    sourceSha256: frozen.canonicalWeatherSourceSha256,
    packageSha256: frozen.canonicalWeatherPackageSha256,
    recovery: "rev7-timeout-benign-oom-benign-preserved-then-monotonic-rev8-pass-v1",
  },
  canaryEngineSourceSha256: frozen.canaryEngineSourceSha256,
  focusReleaseContract:
    "combined-key-and-fn-wrapper-barrier-nonterminal-owner-drain-reentry-v1",
  taggedCompletionContract:
    "completion-fields-coherent-telemetry-then-terminal-receipt-release-last-v1",
  lifecycleRootContract:
    "registration-owns-registry-plus20-base-slot0-owns-internal-root-plus12-v1",
  files: {
    candidateApp: { file: relative(candidatePath), bytes: candidate.length,
      sha256: frozen.candidateAppSha256 },
    moduleText: { file: relative(textPath), bytes: text.length,
      sha256: frozen.moduleTextSha256 },
    moduleRodata: { file: relative(rodataPath), bytes: rodata.length,
      sha256: frozen.moduleRodataSha256 },
    moduleSlot: { file: relative(slotPath), bytes: slot.length,
      sha256: frozen.moduleSlotSha256,
      semantics: "sha256(text[0x210000,0x230000)+rodata[0x230000,0x240000))" },
    loader: { file: relative(loaderPath), bytes: loader.length,
      sha256: frozen.loaderSha256 },
    detailedManifest: { file: relative(detailedManifestPath), bytes: detailedManifestBytes.length,
      sha256: frozen.detailedManifestSha256 },
    verifierOutput: { file: relative(verifierOutputPath), bytes: verifierOutputBytes.length,
      sha256: frozen.verifierOutputSha256 },
    keyTokenProof: { file: relative(keyProofPath), bytes: keyProofBytes.length,
      sha256: sha256(keyProofBytes) },
  },
  binaryFreeze: {
    candidateModuleLoaderChangedByThisReport: false,
    candidateAppSha256: frozen.candidateAppSha256,
    moduleSlotSha256: frozen.moduleSlotSha256,
    loaderSha256: frozen.loaderSha256,
  },
  gatesRemaining: [
    "independent audit must issue exact framer-f1-mquickjs-physical-link-audit-v1 GO over this report and key proof",
    "workflow approval must be generated and validated before any write",
    "guarded physical RAM/RPC/key/fault/UI-latency/rollback/soak receipts remain mandatory",
  ],
};
await writeJsonAtomic(linkReportPath, linkReport);
const linkReportBytes = await readFile(linkReportPath);

const releaseFiles = [];
for (const entry of (await readdir(output, { withFileTypes: true }))
  .filter((item) => item.isFile() && item.name !== path.basename(releaseClosurePath))
  .sort((left, right) => left.name.localeCompare(right.name))) {
  const bytes = await readFile(path.join(output, entry.name));
  releaseFiles.push({ file: entry.name, bytes: bytes.length, sha256: sha256(bytes) });
}
const releaseClosure = {
  format: "framer-f1-mquickjs-physical-release-closure-v1",
  status: "FROZEN_STATIC_LINK_PENDING_INDEPENDENT_AUDIT_NO_HARDWARE",
  directory: relative(output),
  files: releaseFiles,
};
await writeJsonAtomic(releaseClosurePath, releaseClosure);
const releaseClosureBytes = await readFile(releaseClosurePath);

process.stdout.write(`${JSON.stringify({
  status: "PASS_RELEASE_SCHEMA_EVIDENCE_EMITTED_NO_BINARY_CHANGE_NO_HARDWARE",
  linkReport: { file: relative(linkReportPath), bytes: linkReportBytes.length,
    sha256: sha256(linkReportBytes), verdict: linkReport.verdict,
    verdictScope: linkReport.verdictScope, overallPhysicalVerdict: linkReport.overallPhysicalVerdict },
  keyTokenProof: { file: relative(keyProofPath), bytes: keyProofBytes.length,
    sha256: sha256(keyProofBytes), status: keyProof.status,
    postFlashObservationRequired: keyProof.postFlashObservationRequired },
  releaseClosure: { file: relative(releaseClosurePath), bytes: releaseClosureBytes.length,
    sha256: sha256(releaseClosureBytes), files: releaseFiles.length },
  frozen: { candidateAppSha256: frozen.candidateAppSha256,
    moduleSlotSha256: frozen.moduleSlotSha256, loaderSha256: frozen.loaderSha256 },
}, null, 2)}\n`);
