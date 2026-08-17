import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  normalizeZipSyncConfig,
  readZipSyncConfig,
  writeZipSyncConfig,
  ZIP_SYNC_CONFIG_FORMAT,
} from "../examples/render-v2-mquickjs-weather-canary/tools/zip-sync-config.mjs";

async function withTempConfigPath(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "zip-sync-config-test-"));
  try {
    await run(path.join(directory, "nested", "zip-sync-config.json"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("normalizeZipSyncConfig fills in defaults and validates a 5-digit US ZIP", () => {
  assert.deepEqual(normalizeZipSyncConfig({}), { format: ZIP_SYNC_CONFIG_FORMAT, postalCode: "60601",
    countryCode: "US", units: "fahrenheit", lastSaveSeq: 0, updatedAt: null });
  assert.deepEqual(normalizeZipSyncConfig({ postalCode: "10001", units: "celsius", lastSaveSeq: 7,
    updatedAt: "2026-08-17T00:00:00.000Z" }),
  { format: ZIP_SYNC_CONFIG_FORMAT, postalCode: "10001", countryCode: "US", units: "celsius",
    lastSaveSeq: 7, updatedAt: "2026-08-17T00:00:00.000Z" });
  assert.throws(() => normalizeZipSyncConfig({ postalCode: "abcde" }), { code: "ZIP_SYNC_CONFIG_INVALID" });
  assert.throws(() => normalizeZipSyncConfig({ postalCode: "123" }), { code: "ZIP_SYNC_CONFIG_INVALID" });
  assert.throws(() => normalizeZipSyncConfig({ countryCode: "CA" }), { code: "ZIP_SYNC_CONFIG_INVALID" });
  assert.throws(() => normalizeZipSyncConfig(null), { code: "ZIP_SYNC_CONFIG_INVALID" });
});

test("readZipSyncConfig returns normalized defaults when the file does not exist yet", async () => {
  await withTempConfigPath(async (configPath) => {
    const config = await readZipSyncConfig(configPath);
    assert.deepEqual(config, normalizeZipSyncConfig({}));
  });
});

test("writeZipSyncConfig persists a merged, normalized record that readZipSyncConfig round-trips exactly", async () => {
  await withTempConfigPath(async (configPath) => {
    const first = await writeZipSyncConfig({ postalCode: "90210", units: "celsius" }, configPath);
    assert.deepEqual(first, normalizeZipSyncConfig({ postalCode: "90210", units: "celsius" }));
    assert.deepEqual(await readZipSyncConfig(configPath), first);

    const raw = JSON.parse(await readFile(configPath, "utf8"));
    assert.deepEqual(raw, first);

    // A second write merges over the first instead of resetting to defaults.
    const second = await writeZipSyncConfig({ lastSaveSeq: 3, updatedAt: "2026-08-17T12:00:00.000Z" }, configPath);
    assert.deepEqual(second, { ...first, lastSaveSeq: 3, updatedAt: "2026-08-17T12:00:00.000Z" });
    assert.deepEqual(await readZipSyncConfig(configPath), second);
  });
});

test("writeZipSyncConfig ignores undefined patch fields instead of resetting them to defaults", async () => {
  await withTempConfigPath(async (configPath) => {
    await writeZipSyncConfig({ postalCode: "10001", units: "celsius", lastSaveSeq: 4 }, configPath);
    // A partial patch (e.g. from an HTTP body that only sent postalCode) must not
    // clobber units/lastSaveSeq back to their defaults just because they're absent.
    const next = await writeZipSyncConfig({ postalCode: "90210", countryCode: undefined, units: undefined },
      configPath);
    assert.deepEqual(next, normalizeZipSyncConfig({ postalCode: "90210", units: "celsius", lastSaveSeq: 4 }));
  });
});

test("writeZipSyncConfig creates missing parent directories", async () => {
  await withTempConfigPath(async (configPath) => {
    assert.equal(path.dirname(configPath).endsWith("nested"), true);
    await writeZipSyncConfig({ postalCode: "00501" }, configPath);
    assert.equal((await readZipSyncConfig(configPath)).postalCode, "00501");
  });
});

test("writeZipSyncConfig rejects an invalid patch instead of silently truncating the record", async () => {
  await withTempConfigPath(async (configPath) => {
    await writeZipSyncConfig({ postalCode: "10001" }, configPath);
    await assert.rejects(writeZipSyncConfig({ postalCode: "bad-zip" }, configPath), { code: "ZIP_SYNC_CONFIG_INVALID" });
    // The previous good value survives a rejected write.
    assert.equal((await readZipSyncConfig(configPath)).postalCode, "10001");
  });
});
