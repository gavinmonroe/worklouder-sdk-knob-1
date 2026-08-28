#!/usr/bin/env node
/* Offline proof that the on-device F2UP admitter (f2up_admission.c) agrees with
 * the Widget Designer's TypeScript upload-container encoder, byte-for-byte.
 *
 * The fixtures under fixtures/ are produced by the Designer's own encoder
 * (test/f2upFixtures.test.ts): a valid container plus one file per corruption
 * class, and a manifest of the gate each file must trip. This script compiles
 * the C with the host `cc` and asserts the C returns exactly those gates. No
 * hardware, no keyboard — the same discipline the whole pipeline is held to.
 *
 *   node experiments/mquickjs-widget-upload/verify.mjs
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, "fixtures");
const residentDir = path.resolve(here, "../mquickjs-esp32s3-resident-integration");

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

if (!existsSync(path.join(fixtures, "manifest.json"))) {
  fail("fixtures/manifest.json missing — run the Designer test test/f2upFixtures.test.ts first.");
}

const cc = process.env.CC ?? "cc";
const build = mkdtempSync(path.join(tmpdir(), "f2up-verify-"));
const cli = path.join(build, "f2up_cli");

try {
  execFileSync(cc, [
    "-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", "-pedantic",
    path.join(here, "f2up_admission.c"),
    path.join(here, "f2up_cli.c"),
    path.join(residentDir, "f2js_admission.c"),
    "-o", cli,
  ], { stdio: "inherit" });
} catch (cause) {
  fail(`C admitter failed to compile: ${cause.message}`);
}

const manifest = JSON.parse(readFileSync(path.join(fixtures, "manifest.json"), "utf8"));
const results = [];
for (const entry of manifest) {
  const file = path.join(fixtures, entry.file);
  let parsed;
  try {
    parsed = JSON.parse(execFileSync(cli, [file], { encoding: "utf8" }));
  } catch (cause) {
    fail(`CLI crashed on ${entry.file}: ${cause.message}`);
  }
  const ok = parsed.result === entry.expect;
  results.push({ file: entry.file, expected: entry.expect, got: parsed.result, ok });
  if (!ok) fail(`${entry.file}: expected "${entry.expect}", C returned "${parsed.result}"`);
}

// The Designer's REAL assembled widget (DSL -> transpiler -> F2JS/F2TF/LZSS ->
// container, emitted by test/widgetAssembler tests) must admit too — this is
// the cross-stack proof that a widget a user builds in the app is exactly what
// the firmware accepts.
if (existsSync(path.join(fixtures, "assembled-widget.f2up"))) {
  const assembled = JSON.parse(execFileSync(
    cli, [path.join(fixtures, "assembled-widget.f2up")], { encoding: "utf8" }));
  if (assembled.result !== "ok" || assembled.generation < 20) {
    fail(`assembled Designer widget rejected: ${JSON.stringify(assembled)}`);
  }
  results.push({ file: "assembled-widget.f2up", expected: "ok", got: assembled.result, ok: true });

  // BOOT-level admission, the layer container gates cannot see: the facade
  // must admit under the CONTAINER's generation (the module once passed its
  // own constant and halted with boot_state=6 on hardware — this pins the fix)
  // and must refuse a wrong generation.
  const containerBytes = readFileSync(path.join(fixtures, "assembled-widget.f2up"));
  const lzssOff = containerBytes.readUInt32LE(36);
  const lzssLen = containerBytes.readUInt32LE(40);
  const decoded = Buffer.alloc(62000);
  {
    const src = containerBytes.subarray(lzssOff, lzssOff + lzssLen);
    let s = 0; let d = 0;
    while (d < decoded.length) {
      const flags = src[s++];
      for (let bit = 1; bit <= 0x80 && d < decoded.length; bit <<= 1) {
        if ((flags & bit) === 0) decoded[d++] = src[s++];
        else {
          const code = src.readUInt16LE(s); s += 2;
          const distance = (code & 1023) + 1; const length = (code >>> 10) + 3;
          for (let i = 0; i < length; i++) { decoded[d] = decoded[d - distance]; d++; }
        }
      }
    }
    if (s !== src.length) fail("assembled widget LZSS has trailing bytes");
  }
  const basePath = path.join(build, "assembled-base.bin");
  writeFileSync(basePath, decoded);
  const tfCheck = path.join(build, "tf_boot_check");
  // The boot check runs under the contract identity the F2TF itself embeds
  // (bytes 160..192 of the section) so this verifier keeps working across
  // additive contract versions; the identity must still be one the facade
  // exports, or the fixture predates/postdates the contract by mistake.
  const f2tfOff = containerBytes.readUInt32LE(28);
  const embeddedSha = containerBytes.subarray(f2tfOff + 160, f2tfOff + 192).toString("hex");
  const contract = await import("../mquickjs-target-facade/contract.mjs");
  const knownShas = [
    contract.TARGET_FACADE_CONTRACT_SHA256,
    contract.TARGET_FACADE_CONTRACT_V2_SHA256,
    contract.TARGET_FACADE_CONTRACT_V3_SHA256,
    contract.TARGET_FACADE_CONTRACT_V4_SHA256,
    contract.TARGET_FACADE_CONTRACT_V5_SHA256,
  ].filter(Boolean);
  if (!knownShas.includes(embeddedSha)) {
    fail(`assembled widget embeds unknown contract identity ${embeddedSha}`);
  }
  try {
    execFileSync(cc, [
      "-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", "-pedantic",
      path.join(here, "f2up_admission.c"),
      path.join(here, "tf_boot_check.c"),
      path.join(residentDir, "f2js_admission.c"),
      path.resolve(here, "../mquickjs-target-facade/target_facade.c"),
      "-o", tfCheck,
    ], { stdio: "inherit" });
  } catch (cause) {
    fail(`tf_boot_check failed to compile: ${cause.message}`);
  }
  const bootCheck = JSON.parse(execFileSync(
    tfCheck, [path.join(fixtures, "assembled-widget.f2up"), basePath, embeddedSha],
    { encoding: "utf8" }));
  if (bootCheck.result !== "ok") {
    fail(`assembled widget failed BOOT-level facade admission: ${JSON.stringify(bootCheck)}`);
  }
  results.push({ file: "assembled-widget.f2up (tf boot)", expected: "ok", got: "ok", ok: true });
}

// The valid container must also parse to the canonical section table.
const valid = JSON.parse(execFileSync(cli, [path.join(fixtures, "valid.f2up")], { encoding: "utf8" }));
if (valid.result !== "ok" || valid.generation !== 5 ||
    valid.f2jsOffset !== 128 || (valid.lzssOffset + valid.lzssBytes) !== valid.totalBytes) {
  fail(`valid container parsed wrong: ${JSON.stringify(valid)}`);
}

// Full device-side lifecycle: base64 chunk upload -> seal -> persist to a
// NOR-faithful mock flash -> boot-adopt, plus the torn-write matrix,
// replacement, upload error paths and strict-base64 negatives.
const harness = path.join(build, "harness");
try {
  execFileSync(cc, [
    "-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", "-pedantic",
    path.join(here, "f2up_admission.c"),
    path.join(here, "f2up_upload.c"),
    path.join(here, "f2up_persist.c"),
    path.join(here, "f2up_adopt.c"),
    path.join(here, "host_harness.c"),
    path.join(residentDir, "f2js_admission.c"),
    "-o", harness,
  ], { stdio: "inherit" });
} catch (cause) {
  fail(`lifecycle harness failed to compile: ${cause.message}`);
}
let lifecycle;
try {
  lifecycle = JSON.parse(execFileSync(harness, [
    path.join(fixtures, "valid.f2up"),
    path.join(fixtures, "valid-gen6.f2up"),
  ], { encoding: "utf8" }));
} catch (cause) {
  fail(`lifecycle harness failed: ${cause.stdout ?? cause.message}`);
}
if (lifecycle.status !== "PASS_F2UP_DEVICE_LIFECYCLE_NO_HARDWARE") {
  fail(`lifecycle harness reported: ${JSON.stringify(lifecycle)}`);
}

console.log(JSON.stringify({
  status: "PASS_F2UP_TS_C_PARITY_NO_HARDWARE",
  compiler: cc,
  cases: results.length,
  gatesProven: results.map((r) => r.expected),
  validSections: {
    generation: valid.generation, totalBytes: valid.totalBytes,
    f2js: [valid.f2jsOffset, valid.f2jsBytes],
    f2tf: [valid.f2tfOffset, valid.f2tfBytes],
    lzss: [valid.lzssOffset, valid.lzssBytes],
  },
  lifecycle,
}, null, 2));
