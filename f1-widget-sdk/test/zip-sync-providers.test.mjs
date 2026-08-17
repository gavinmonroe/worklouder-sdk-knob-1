import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createOpenMeteoZipProvider,
  createZipSyncProvider,
  ZIP_SYNC_PROVIDERS,
} from "../examples/render-v2-mquickjs-weather-canary/tools/zip-sync-providers.mjs";

const fixtureUrl = new URL("../examples/render-v2-weather/fixtures/open-meteo-60601.json", import.meta.url);
const config = Object.freeze({ postalCode: "60601", countryCode: "US", units: "fahrenheit", refreshMinutes: 30 });

async function fixture() {
  return JSON.parse(await readFile(fixtureUrl, "utf8"));
}

test("ZIP_SYNC_PROVIDERS exposes exactly the two selectable providers", () => {
  assert.deepEqual(ZIP_SYNC_PROVIDERS, ["open-meteo", "deterministic"]);
});

test("createZipSyncProvider('deterministic') returns the offline fixture provider (no network)", async () => {
  const provider = createZipSyncProvider("deterministic");
  const first = await provider.lookup(config);
  const second = await provider.lookup(config);
  assert.equal(first.format, "framer-render-v2-weather-snapshot-v1");
  assert.deepEqual(first, second, "deterministic provider is a pure function of the ZIP");
});

test("createZipSyncProvider('open-meteo') fetches geocoding then forecast and normalizes the snapshot", async () => {
  const data = await fixture();
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(new URL(url));
    const body = urls.length === 1 ? data.geocoding : data.forecast;
    return { ok: true, status: 200, async json() { return structuredClone(body); } };
  };
  const provider = createOpenMeteoZipProvider({ fetchImpl });
  const snapshot = await provider.lookup(config);
  assert.equal(snapshot.format, "framer-render-v2-weather-snapshot-v1");
  assert.equal(snapshot.location.name, "Chicago");
  assert.equal(snapshot.current.temperature, 45);
  assert.deepEqual(urls.map(({ hostname }) => hostname), ["geocoding-api.open-meteo.com", "api.open-meteo.com"]);
});

test("createZipSyncProvider('open-meteo') never touches the network directly; it delegates to fetchImpl", async () => {
  let called = 0;
  const failingFetch = async () => { called++; throw new Error("network calls are not allowed in tests"); };
  const provider = createOpenMeteoZipProvider({ fetchImpl: failingFetch });
  await assert.rejects(provider.lookup(config), /network calls are not allowed in tests/u);
  assert.equal(called, 1);
});

test("createZipSyncProvider rejects an unknown provider name", () => {
  assert.throws(() => createZipSyncProvider("bogus"), { code: "ZIP_SYNC_PROVIDER_UNKNOWN" });
});
