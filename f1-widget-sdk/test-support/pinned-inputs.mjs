// Availability probes for inputs the suite pins but cannot carry in the repository.
//
// A fresh clone cannot reproduce the maintainer's device flash backup, the Xtensa
// toolchain, the pinned Chrome build, or a specific macOS system font. Failing on those
// buries real regressions under environment noise, so the affected suites skip with an
// explicit reason instead. Each probe reports why an input is unavailable so a skip is
// never silent.
//
// This is test-harness triage only. It relaxes no build or deploy gate: production code
// still fails closed whenever a pinned input is missing or its bytes differ.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { INPUT_LAB_CHROME, PINNED_INPUT_LAB_CHROME_PRODUCT } from
  "../input-lab/lib/chromium-raster-capture.mjs";
import { PINNED, WORKSPACE_ROOT } from "../src/constants.mjs";
import { PINNED_HIRAGINO_ATLAS_SOURCE } from "../src/render/glyph-atlas.mjs";

const once = (probe) => { let cached; return () => (cached ??= probe()); };

// A byte-exact 16 MiB dump of the maintainer's own Framer F1 (MAC a4:cb:8f:af:32:10).
// recovery/backups/ is gitignored and the pinned SHA-256 belongs to that one device, so
// no other clone can reproduce it -- attaching your own F1 yields a different image.
export const RECOVERY_FULL_FLASH = path.join(WORKSPACE_ROOT,
  "recovery/backups/2026-08-15-framer-f1-a4cb8faf3210-before-custom/full-flash-16mb.bin");

export const missingRecoveryBackup = once(() => (existsSync(RECOVERY_FULL_FLASH) ? false
  : `Pinned 16 MiB recovery backup is absent (${path.relative(WORKSPACE_ROOT, RECOVERY_FULL_FLASH)}). `
    + "It is a dump of the maintainer's own device and cannot be regenerated elsewhere."));

export const missingToolchain = once(() => (existsSync(path.join(PINNED.toolchainDirectory,
  "xtensa-esp32s3-elf-as")) ? false
  : `Pinned Xtensa ESP32-S3 toolchain is absent (${path.relative(WORKSPACE_ROOT, PINNED.toolchainDirectory)}). `
    + "See docs/20-local-development-setup.md to install it."));

export const missingPinnedChrome = once(() => {
  let product;
  try {
    product = execFileSync(INPUT_LAB_CHROME, ["--version"], { encoding: "utf8" })
      .trim().replace(/^Google Chrome(?: for Testing)? /u, "Chrome/");
  } catch {
    return `Pinned Chrome build is not installed at ${INPUT_LAB_CHROME}. `
      + "See docs/20-local-development-setup.md.";
  }
  return product === PINNED_INPUT_LAB_CHROME_PRODUCT ? false
    : `Installed browser is ${product}, but raster goldens are pinned to `
      + `${PINNED_INPUT_LAB_CHROME_PRODUCT}. A different build shifts pixels, so this is not `
      + "a pin to relax. See docs/20-local-development-setup.md.";
});

export const missingPinnedFont = once(() => {
  const { fontPath, fontSha256 } = PINNED_HIRAGINO_ATLAS_SOURCE;
  if (!existsSync(fontPath)) return `Pinned atlas font is absent (${fontPath}).`;
  const actual = createHash("sha256").update(readFileSync(fontPath)).digest("hex");
  return actual === fontSha256 ? false
    : `Pinned atlas font ${fontPath} is SHA-256 ${actual}, not ${fontSha256}. `
      + "The bundled font ships with macOS and varies by OS version.";
});
