#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { inspectEsp32AppImage, repairEsp32AppIntegrity } from "./lib/esp-app-image.mjs";

export const APP_FLASH_OFFSET = 0x10000;
export const TIMER_LABEL_APP_OFFSET = 0x5ae0;
export const TIMER_LABEL_BYTES = 8;
export const OFFICIAL_MERGED_SHA256 = "c8926bd181bc06062d8c79221c6bb1c7f85463f0034444f263e1995cb383b976";

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

export function encodeStage1Label(label) {
  if (typeof label !== "string" || !/^[\x20-\x7e]{1,7}$/u.test(label)) {
    throw new Error("Stage-1 label must be 1-7 printable ASCII characters.");
  }
  const encoded = Buffer.from(label, "ascii");
  if (encoded.length > TIMER_LABEL_BYTES - 1) throw new Error("Stage-1 label is too long.");
  const field = Buffer.alloc(TIMER_LABEL_BYTES);
  encoded.copy(field);
  return field;
}

export function patchTimerLabel(appImage, label = "Pomo") {
  inspectEsp32AppImage(appImage);
  const expected = Buffer.from("Timer\0\0\0", "ascii");
  const found = appImage.subarray(TIMER_LABEL_APP_OFFSET, TIMER_LABEL_APP_OFFSET + TIMER_LABEL_BYTES);
  if (!found.equals(expected)) {
    throw new Error(`Expected the Framer 0.4.1 Timer label at app offset 0x${TIMER_LABEL_APP_OFFSET.toString(16)}.`);
  }
  const patched = Buffer.from(appImage);
  encodeStage1Label(label).copy(patched, TIMER_LABEL_APP_OFFSET);
  return repairEsp32AppIntegrity(patched);
}

function parseArgs(argv) {
  let label = "Pomo";
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--label") {
      label = argv[++index];
      if (label === undefined) throw new Error("--label requires a value.");
    } else {
      throw new Error(`Unknown option: ${argv[index]}`);
    }
  }
  return { label };
}

export async function buildStage1({ label = "Pomo", root } = {}) {
  const projectRoot = root ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const officialPath = path.join(projectRoot, "artifacts/firmware/firmware_0.4.1_merged.bin");
  const outputDirectory = path.join(projectRoot, "custom-firmware/build");
  const merged = await readFile(officialPath);
  const sourceHash = sha256(merged);
  if (sourceHash !== OFFICIAL_MERGED_SHA256) {
    throw new Error(`Official Framer input hash mismatch: ${sourceHash}`);
  }

  const appImage = merged.subarray(APP_FLASH_OFFSET);
  const originalInfo = inspectEsp32AppImage(appImage);
  const patchedApp = patchTimerLabel(appImage, label);
  const patchedInfo = inspectEsp32AppImage(patchedApp);
  if (patchedApp.length !== appImage.length) throw new Error("Patch changed the app image length.");

  const patchedMerged = Buffer.from(merged);
  patchedApp.copy(patchedMerged, APP_FLASH_OFFSET);

  await mkdir(outputDirectory, { recursive: true });
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "") || "custom";
  const appName = `framer-0.4.1-stage1-${slug}-app.bin`;
  const mergedName = `framer-0.4.1-stage1-${slug}-merged.bin`;
  await writeFile(path.join(outputDirectory, appName), patchedApp);
  await writeFile(path.join(outputDirectory, mergedName), patchedMerged);

  const manifest = {
    format: "framer-f1-stage1-native-widget-proof-v1",
    purpose: "Persistent on-device proof: replace the visible native Timer screen heading without changing code or partition layout.",
    target: "Framer F1 / knob_f1",
    baseFirmware: "0.4.1",
    label,
    source: { file: path.relative(projectRoot, officialPath), bytes: merged.length, sha256: sourceHash },
    patch: {
      appFlashOffset: APP_FLASH_OFFSET,
      appFileOffset: TIMER_LABEL_APP_OFFSET,
      mergedFileOffset: APP_FLASH_OFFSET + TIMER_LABEL_APP_OFFSET,
      beforeHex: Buffer.from("Timer\0\0\0", "ascii").toString("hex"),
      afterHex: encodeStage1Label(label).toString("hex"),
      originalChecksum: originalInfo.storedChecksum,
      patchedChecksum: patchedInfo.storedChecksum,
      checksumOffset: patchedInfo.checksumOffset,
      digestOffset: patchedInfo.digestOffset,
    },
    outputs: {
      app: { file: appName, bytes: patchedApp.length, sha256: sha256(patchedApp) },
      merged: { file: mergedName, bytes: patchedMerged.length, sha256: sha256(patchedMerged) },
    },
    limits: [
      "This stage proves a persistent custom firmware edit; it does not yet change countdown semantics.",
      "Only the factory app partition should be written during the stage-1 test.",
    ],
  };
  await writeFile(path.join(outputDirectory, "stage1-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(await buildStage1(parseArgs(process.argv.slice(2))), null, 2));
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}
