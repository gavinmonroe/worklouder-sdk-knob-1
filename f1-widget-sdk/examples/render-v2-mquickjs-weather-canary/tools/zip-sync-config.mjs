import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Shared host-side persistence for the keyboard-editable ZIP. Both
 * tools/zip-sync.mjs (the CLI) and Input Lab's dev server (server.mjs) read
 * and write this exact JSON file so a ZIP saved from either side is visible
 * to the other. No network or device I/O happens here.
 */

export const ZIP_SYNC_CONFIG_FORMAT = "framer-render-v2-mquickjs-weather-zip-sync-config-v1";

// f1-widget-sdk/examples/render-v2-mquickjs-weather-canary/tools/ -> f1-widget-sdk/build/zip-sync-config.json
export const DEFAULT_ZIP_SYNC_CONFIG_PATH =
  fileURLToPath(new URL("../../../build/zip-sync-config.json", import.meta.url));

const DEFAULTS = Object.freeze({ postalCode: "60601", countryCode: "US", units: "fahrenheit",
  lastSaveSeq: 0, updatedAt: null });

function invariant(value, message) {
  if (!value) throw Object.assign(new Error(message), { code: "ZIP_SYNC_CONFIG_INVALID" });
}

/** Validates and fills in a ZIP-sync config record. Unknown/missing fields fall back to sane defaults. */
export function normalizeZipSyncConfig(value = {}) {
  invariant(value && typeof value === "object" && !Array.isArray(value), "ZIP sync config must be an object.");
  const countryCode = String(value.countryCode ?? DEFAULTS.countryCode).trim().toUpperCase();
  invariant(countryCode === "US", "ZIP sync config only supports countryCode \"US\" today.");
  const postalCode = String(value.postalCode ?? DEFAULTS.postalCode).trim();
  invariant(/^\d{5}$/u.test(postalCode), `ZIP sync config postalCode "${postalCode}" must be a 5-digit US ZIP.`);
  const units = value.units === "celsius" ? "celsius" : "fahrenheit";
  const lastSaveSeq = Number.isInteger(value.lastSaveSeq) && value.lastSaveSeq >= 0 && value.lastSaveSeq <= 0xff
    ? value.lastSaveSeq : 0;
  const updatedAt = value.updatedAt == null ? null : String(value.updatedAt);
  return Object.freeze({ format: ZIP_SYNC_CONFIG_FORMAT, postalCode, countryCode, units, lastSaveSeq, updatedAt });
}

/** Reads the config file, returning normalized defaults when it does not exist yet. */
export async function readZipSyncConfig(path = DEFAULT_ZIP_SYNC_CONFIG_PATH) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return normalizeZipSyncConfig(DEFAULTS);
    throw error;
  }
  return normalizeZipSyncConfig(JSON.parse(text));
}

/**
 * Merges `patch` over the current file (or defaults) and writes it back.
 * `undefined`-valued patch fields are ignored (not written as explicit
 * overrides) so a caller can send a partial patch without first reading the
 * current record. Returns the new normalized config.
 */
export async function writeZipSyncConfig(patch = {}, path = DEFAULT_ZIP_SYNC_CONFIG_PATH) {
  const current = await readZipSyncConfig(path);
  const definedPatch = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
  const next = normalizeZipSyncConfig({ ...current, ...definedPatch });
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}
