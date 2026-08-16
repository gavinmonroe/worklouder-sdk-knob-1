#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { APP_FLASH_OFFSET, OFFICIAL_MERGED_SHA256 } from "./build-stage1.mjs";
import { inspectEsp32AppImage, repairEsp32AppIntegrity } from "./lib/esp-app-image.mjs";

const EXPECTED_CHECKSUM = 0x8e;
const EXPECTED_APPENDED_DIGEST = "34cc73c5a3465420907b6b765ef9266a483330063b543ce27044212629de3d7e";
const EXPECTED_MERGED_SHA256 = "461e86542b80dbf34c830c768b764195ae8fe1b0d9bf6fbdf14154cc85828c77";

export const STAGE2_PATCHES = [
  {
    name: "visible-heading",
    purpose: "Change the visible Timer heading to Focus.",
    mergedOffset: 0x15ae0,
    before: "54696d657200",
    after: "466f63757300",
  },
  {
    name: "getter-and-adapter-cave",
    purpose: "Route to the dormant controller and install fixed 25/5 start plus Timer-state adapters in the unreachable old getter body.",
    mergedOffset: 0xe612c,
    before: "364100a1616f81ca67e00800160a05815f6f915f6f99080c099248040c1999280c099938a15c6fa948a15b6fa9589968a15b6fa908a15a6fa948a15a6fa958a15a6fa908a15a6f",
    after: "364100e5a7052d0a1df0000032a5dc3972399282a12c89a20c0882422082422289b2c1fb6cb1006da2c214a594f41df03641008202208c280c221df088b20c126628010c021df0",
  },
  {
    name: "pause-adapter",
    purpose: "Stop the timer subobject and set the dormant controller pause flag.",
    mergedOffset: 0xda9fc,
    before: "36410082a002826207a2c21425feff90",
    after: "364100a2c214a5feff0c188242201df0",
  },
  {
    name: "reset-adapter",
    purpose: "Delegate reset to the dormant controller's concrete reset routine.",
    mergedOffset: 0xdaa10,
    before: "364100a2c21465fdff82",
    after: "364100ad0225f5ff1df0",
  },
  {
    name: "start-adapter",
    purpose: "Jump from the Timer start entry to the fixed 25/5 start adapter.",
    mergedOffset: 0xdaac0,
    before: "3641003030f4",
    after: "364100469c2d",
  },
  {
    name: "resume-adapter",
    purpose: "Clear the pause flag and restart the dormant controller's one-second timer.",
    mergedOffset: 0xdaae0,
    before: "36410082a001826207c1949ab19a9aa2c214e5faff90",
    after: "3641000c08824220c1959ab19a9aa2c214e5faff1df0",
  },
  {
    name: "initial-duration-getter",
    purpose: "Read the dormant controller's u32 work duration at object offset +36.",
    mergedOffset: 0x1c84ec,
    before: "3641002212111d",
    after: "36410028921df0",
  },
  {
    name: "remaining-duration-getter",
    purpose: "Read the dormant controller's u32 remaining seconds at object offset +28.",
    mergedOffset: 0x1c84f4,
    before: "3641002212101d",
    after: "36410028721df0",
  },
  {
    name: "status-adapter-literal",
    purpose: "Point the Timer status query at the in-place state adapter.",
    mergedOffset: 0xc1ee0,
    before: "e4841042",
    after: "5c610242",
  },
].map((patch) => ({ ...patch, before: Buffer.from(patch.before, "hex"), after: Buffer.from(patch.after, "hex") }));

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

function validatePatchTable() {
  const sorted = [...STAGE2_PATCHES].sort((left, right) => left.mergedOffset - right.mergedOffset);
  for (let index = 0; index < sorted.length; index += 1) {
    const patch = sorted[index];
    if (patch.before.length !== patch.after.length || patch.before.length === 0) {
      throw new Error(`Patch ${patch.name} changes length or is empty.`);
    }
    if (patch.mergedOffset < APP_FLASH_OFFSET) throw new Error(`Patch ${patch.name} is outside the factory app.`);
    const previous = sorted[index - 1];
    if (previous && previous.mergedOffset + previous.after.length > patch.mergedOffset) {
      throw new Error(`Patches ${previous.name} and ${patch.name} overlap.`);
    }
  }
}

export function applyStage2Patches(officialMerged) {
  validatePatchTable();
  if (sha256(officialMerged) !== OFFICIAL_MERGED_SHA256) throw new Error("Official Framer 0.4.1 merged-image hash mismatch.");
  const patchedApp = Buffer.from(officialMerged.subarray(APP_FLASH_OFFSET));
  inspectEsp32AppImage(patchedApp);

  for (const patch of STAGE2_PATCHES) {
    const appOffset = patch.mergedOffset - APP_FLASH_OFFSET;
    const found = patchedApp.subarray(appOffset, appOffset + patch.before.length);
    if (!found.equals(patch.before)) {
      throw new Error(`Original bytes for ${patch.name} do not match at merged offset 0x${patch.mergedOffset.toString(16)}.`);
    }
    patch.after.copy(patchedApp, appOffset);
  }

  const repairedApp = repairEsp32AppIntegrity(patchedApp);
  const info = inspectEsp32AppImage(repairedApp);
  if (info.storedChecksum !== EXPECTED_CHECKSUM) {
    throw new Error(`Stage-2 checksum is 0x${info.storedChecksum.toString(16)}; expected 0x${EXPECTED_CHECKSUM.toString(16)}.`);
  }
  if (info.storedDigest?.toString("hex") !== EXPECTED_APPENDED_DIGEST) {
    throw new Error("Stage-2 appended ESP digest differs from the independently derived value.");
  }

  const patchedMerged = Buffer.from(officialMerged);
  repairedApp.copy(patchedMerged, APP_FLASH_OFFSET);
  if (sha256(patchedMerged) !== EXPECTED_MERGED_SHA256) {
    throw new Error("Stage-2 merged-image SHA-256 differs from the independently derived value.");
  }
  return { app: repairedApp, merged: patchedMerged, info };
}

export async function buildStage2({ root } = {}) {
  const projectRoot = root ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const sourcePath = path.join(projectRoot, "artifacts/firmware/firmware_0.4.1_merged.bin");
  const outputDirectory = path.join(projectRoot, "custom-firmware/build");
  const officialMerged = await readFile(sourcePath);
  const output = applyStage2Patches(officialMerged);
  const appName = "framer-0.4.1-stage2-pomodoro-app.bin";
  const mergedName = "framer-0.4.1-stage2-pomodoro-merged.bin";
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(path.join(outputDirectory, appName), output.app);
  await writeFile(path.join(outputDirectory, mergedName), output.merged);

  const manifest = {
    format: "framer-f1-stage2-native-pomodoro-candidate-v1",
    evidence: "Offline candidate; static confidence high, runtime/UI confidence medium until hardware verification.",
    target: "Framer F1 / knob_f1",
    baseFirmware: "0.4.1",
    behavior: {
      workSeconds: 1500,
      restSeconds: 300,
      targetCycles: 4,
      heading: "Focus",
      knownLimit: "Heading remains Focus during rest; state is RAM-backed and does not survive reboot.",
    },
    source: { file: path.relative(projectRoot, sourcePath), sha256: OFFICIAL_MERGED_SHA256 },
    patches: STAGE2_PATCHES.map((patch) => ({
      name: patch.name,
      purpose: patch.purpose,
      mergedOffset: patch.mergedOffset,
      appOffset: patch.mergedOffset - APP_FLASH_OFFSET,
      bytes: patch.after.length,
      beforeHex: patch.before.toString("hex"),
      afterHex: patch.after.toString("hex"),
    })),
    integrity: {
      checksum: output.info.storedChecksum,
      checksumAppOffset: output.info.checksumOffset,
      appendedDigest: output.info.storedDigest.toString("hex"),
      digestAppOffset: output.info.digestOffset,
    },
    outputs: {
      app: { file: appName, bytes: output.app.length, sha256: sha256(output.app) },
      merged: { file: mergedName, bytes: output.merged.length, sha256: sha256(output.merged) },
    },
  };
  await writeFile(path.join(outputDirectory, "stage2-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  buildStage2()
    .then((manifest) => console.log(JSON.stringify(manifest, null, 2)))
    .catch((error) => {
      console.error(`Error: ${error.message}`);
      process.exitCode = 1;
    });
}

