#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(here, "../..");
const release = path.resolve(process.argv[2] ?? "");
const invariant = (value, message) => { if (!value) throw new Error(message); };
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const PACKAGE_ABI = "5091736403d809078cbbf12a1b593fbabaff53474a0935a7e00ce81dc8bd67f8";
const MODULE_ABI = "ad484a3a8b438c51f6bbcda6ea871110735b3460e39e4c2853a4e636f5f728cb";

invariant(process.argv[2] && release !== repository && release !== here,
  "Pass the unique frozen release directory as the only argument.");

const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
const closurePath = path.join(release, "release-closure.json");
const closureBytes = await readFile(closurePath);
const closure = JSON.parse(closureBytes);
invariant(closure.format === "framer-f1-mquickjs-physical-release-closure-v1" &&
  closure.status === "FROZEN_STATIC_LINK_PENDING_INDEPENDENT_AUDIT_NO_HARDWARE" &&
  Array.isArray(closure.files) && closure.files.length >= 14,
"Frozen release closure is absent or malformed.");

const actualNames = (await readdir(release, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name !== "release-closure.json")
  .map((entry) => entry.name).sort();
const closedNames = closure.files.map((entry) => entry.file).sort();
invariant(JSON.stringify(actualNames) === JSON.stringify(closedNames),
  "Frozen release directory contains an unclosed, missing, or extra file.");
for (const entry of closure.files) {
  invariant(!entry.file.includes("/") && !entry.file.includes(".."),
    "Release closure contains a non-local file name.");
  const bytes = await readFile(path.join(release, entry.file));
  invariant(bytes.length === entry.bytes && sha256(bytes) === entry.sha256,
    `Frozen release file changed: ${entry.file}.`);
}

const [manifest, report, keyProof] = await Promise.all([
  readJson(path.join(release, "physical-link-manifest.json")),
  readJson(path.join(release, "physical-static-link-report.json")),
  readJson(path.join(release, "key-token-proof.json")),
]);
const bytes = async (name) => readFile(path.join(release, name));
const [app, text, rodata, slot, loader, manifestBytes, keyProofBytes] = await Promise.all([
  bytes("framer-0.4.1-mqjs-id28-canary-NO-GO-app.bin"),
  bytes("mqjs-id28-text-page.bin"), bytes("mqjs-id28-rodata-page.bin"),
  bytes("mqjs-id28-slot-a.bin"), bytes("mqjs-id28-resident-loader.bin"),
  bytes("physical-link-manifest.json"), bytes("key-token-proof.json"),
]);
invariant(Buffer.concat([text, rodata]).equals(slot),
  "Frozen module slot is not exact text+rodata concatenation.");
invariant(report.format === "framer-f1-mquickjs-physical-static-link-report-v1" &&
  report.verdict === "GO" && report.verdictScope === "DETERMINISTIC_STATIC_LINK_ONLY" &&
  report.overallPhysicalVerdict === "NO_GO_PENDING_INDEPENDENT_AUDIT_AND_GUARDED_HARDWARE" &&
  report.deployable === false && report.hardwareTouched === false &&
  report.candidateAppSha256 === sha256(app) &&
  report.moduleTextSha256 === sha256(text) &&
  report.moduleRodataSha256 === sha256(rodata) &&
  report.moduleSlotSha256 === sha256(slot) && report.loaderSha256 === sha256(loader) &&
  report.packageAbiSha256 === PACKAGE_ABI && report.moduleAbiSha256 === MODULE_ABI &&
  report.packageAbiSha256 !== report.moduleAbiSha256 &&
  report.files.detailedManifest.sha256 === sha256(manifestBytes) &&
  report.files.keyTokenProof.sha256 === sha256(keyProofBytes),
"Static-link report no longer closes the frozen ABI3 artifacts.");
invariant(manifest.status ===
    "PASS_DETERMINISTIC_LINK_PENDING_INDEPENDENT_AUDIT_NO_GO_PHYSICAL" &&
  manifest.candidateApp.sha256 === sha256(app) &&
  manifest.module.abiVersion === 3 && manifest.module.moduleAbiSha256 === MODULE_ABI &&
  manifest.module.packageAbiSha256 === PACKAGE_ABI &&
  manifest.module.slotA.sha256 === sha256(slot) &&
  manifest.module.loader.sha256 === sha256(loader) &&
  manifest.verification.capabilityIdentitySeparation ===
    "PASS_PACKAGE_509_MODULE_AD484_DISTINCT_DESCRIPTOR_LOADER_CAP_P11_NO_SWAP",
"Detailed manifest ABI3 identity or artifact closure changed.");
invariant(keyProof.format === "framer-f1-mquickjs-key-token-proof-v1" &&
  keyProof.status === "EXACT_TOKEN_MAP_PROVEN" &&
  keyProof.postFlashObservationRequired === true &&
  keyProof.keyTokenNormalization === "raw-low24-after-stock-first-v1" &&
  keyProof.keyNegativeHarness === "low24-e5-observed-never-mapped-pass-v1",
"Frozen key-token proof changed.");

const sourceClosure = manifest.verification.sourceClosure;
const sourceDigest = createHash("sha256");
for (const entry of sourceClosure.files) {
  const source = await readFile(path.join(repository, entry.file));
  invariant(source.length === entry.bytes && sha256(source) === entry.sha256,
    `Frozen source dependency changed: ${entry.file}.`);
  sourceDigest.update(entry.file, "utf8");
  sourceDigest.update("\0", "utf8");
  sourceDigest.update(String(source.length), "utf8");
  sourceDigest.update("\0", "utf8");
  sourceDigest.update(source);
}
invariant(sourceDigest.digest("hex") === sourceClosure.sha256 &&
  report.sourceClosureSha256 === sourceClosure.sha256,
"Frozen source dependency closure digest changed.");

process.stdout.write(`${JSON.stringify({
  status: "PASS_READ_ONLY_FROZEN_RELEASE_CLOSURE_NO_HARDWARE",
  directory: release,
  releaseClosureSha256: sha256(closureBytes),
  files: closure.files.length,
  candidateAppSha256: sha256(app),
  moduleTextSha256: sha256(text),
  moduleRodataSha256: sha256(rodata),
  moduleSlotSha256: sha256(slot),
  loaderSha256: sha256(loader),
  linkReportSha256: sha256(await bytes("physical-static-link-report.json")),
  keyTokenProofSha256: sha256(keyProofBytes),
  sourceClosureSha256: sourceClosure.sha256,
  packageAbiSha256: PACKAGE_ABI,
  moduleAbiSha256: MODULE_ABI,
}, null, 2)}\n`);
