import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { firmwareCatalog } from "../src/data/firmware.js";
import {
  assertRegionPlan,
  inspectEsp32S3App,
  loadFirmwareRegions,
  loadFlashPlan,
  validateFirmwareBytes,
  validateRegionBytes,
} from "../src/lib/firmware.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const byId = Object.fromEntries(firmwareCatalog.map((firmware) => [firmware.id, firmware]));
const release = "experiments/mquickjs-esp32s3-physical-canary/releases/2026-08-18-id28-zip-settings-psram";
const fixtures = [
  {
    ...byId["wpm-pet"],
    path: "custom-firmware/build/framer-0.4.1-stage3e34-wpm-pet-full-app.bin",
  },
  {
    ...byId.music,
    path: "f1-widget-sdk/build/combined-music-fast-gradient/framer-0.4.1-combined-music-id1-wpm-id7-app.bin",
  },
  {
    ...byId["custom-html-css-preview"],
    path: "f1-widget-sdk/build/combined-renderer-id26/framer-0.4.1-combined-music-id1-wpm-id7-renderer-id26-app.bin",
  },
  {
    ...byId["clock-timer"],
    path: "f1-widget-sdk/build/combined-renderer-v2-clock-blue-timer/framer-0.4.1-music-id1-wpm-id7-renderer-id26-clock-id27-blue-timer-app.bin",
  },
  {
    ...byId["input-lab-generic"],
    path: "f1-widget-sdk/build/combined-renderer-v2-generic-input-lab/framer-0.4.1-input-lab-renderer-v2-generic-id26-app.bin",
  },
];

const weatherRegionPaths = {
  0x210000: `${release}/mqjs-id28-text-page.bin`,
  0x230000: `${release}/mqjs-id28-rodata-page.bin`,
  0x10000: `${release}/framer-0.4.1-mqjs-id28-weather-zip-psram-app.bin`,
};

function readRepoFile(relativePath) {
  return readFile(path.join(root, relativePath)).then((buffer) => new Uint8Array(buffer));
}

/** Serve catalog `?url` entries from disk so tests exercise the real loaders. */
function diskFetch(pathsByUrl) {
  return async (url) => {
    const relativePath = pathsByUrl[url];
    if (!relativePath) return { ok: false, status: 404 };
    const bytes = await readRepoFile(relativePath);
    return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
  };
}

function weatherFetchMap() {
  const weather = byId["weather-mquickjs"];
  const map = {};
  for (const region of weather.regions) map[region.url] = weatherRegionPaths[region.address];
  return { weather, map };
}

describe("web firmware catalog", () => {
  for (const fixture of fixtures) {
    it(`accepts exact ${fixture.id} bytes`, async () => {
      const bytes = await readRepoFile(fixture.path);
      const result = await validateFirmwareBytes(bytes, fixture);
      expect(result.digest).toBe(fixture.sha256);
      expect(result.image.segmentCount).toBe(6);
    });
  }

  it("rejects a changed image before device access", async () => {
    const fixture = fixtures[1];
    const bytes = await readRepoFile(fixture.path);
    bytes[100] ^= 0xff;
    await expect(validateFirmwareBytes(bytes, fixture)).rejects.toThrow(/SHA-256/u);
  });

  it("rejects a structurally invalid app", async () => {
    const bytes = new Uint8Array(64);
    await expect(inspectEsp32S3App(bytes)).rejects.toThrow(/magic/u);
  });

  it("prepares a single-app entry as a one-region 0x10000 plan", async () => {
    const fixture = byId.music;
    const plan = await loadFlashPlan(fixture, diskFetch({ [fixture.url]: fixtures[1].path }));
    expect(plan.multiRegion).toBe(false);
    expect(plan.regions).toHaveLength(1);
    expect(plan.regions[0]).toMatchObject({ address: 0x10000, kind: "app", sha256: fixture.sha256 });
    expect(plan.bytes.length).toBe(fixture.bytes);
  });
});

describe("multi-region write plans", () => {
  it("verifies every weather region and keeps pages before the app", async () => {
    const { weather, map } = weatherFetchMap();
    const regions = await loadFirmwareRegions(weather, diskFetch(map));
    expect(regions.map(({ address, kind }) => [address, kind])).toEqual([
      [0x210000, "page"],
      [0x230000, "page"],
      [0x10000, "app"],
    ]);
    expect(regions.map(({ sha256 }) => sha256)).toEqual(weather.regions.map((region) => region.sha256));
    expect(regions.map(({ bytes }) => bytes.length)).toEqual([131_072, 65_536, 2_062_912]);
    // Only the app region is checked for ESP image structure.
    expect(regions[0].validation.image).toBeNull();
    expect(regions[1].validation.image).toBeNull();
    expect(regions[2].validation.image.segmentCount).toBe(6);

    const plan = await loadFlashPlan(weather, diskFetch(map));
    expect(plan.multiRegion).toBe(true);
    expect(plan.regions.at(-1).kind).toBe("app");
    expect(plan.bytes.length).toBe(2_062_912);
  });

  it("rejects the whole plan when any region hash mismatches", async () => {
    const { weather, map } = weatherFetchMap();
    for (const region of weather.regions) {
      const corrupt = async (url) => {
        const response = await diskFetch(map)(url);
        if (url !== region.url) return response;
        const bytes = new Uint8Array(await response.arrayBuffer());
        bytes[64] ^= 0xff;
        return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer };
      };
      await expect(loadFirmwareRegions(weather, corrupt)).rejects.toThrow(/SHA-256/u);
    }
  });

  it("rejects a region whose size changed", async () => {
    await expect(
      validateRegionBytes(new Uint8Array(10), { address: 0x210000, kind: "page", bytes: 131_072, sha256: "0".repeat(64) }),
    ).rejects.toThrow(/size changed/u);
  });

  it("rejects a page that fails to load before any write", async () => {
    const { weather, map } = weatherFetchMap();
    const missing = { ...map };
    delete missing[weather.regions[1].url];
    await expect(loadFirmwareRegions(weather, diskFetch(missing))).rejects.toThrow(/Could not load/u);
  });

  const base = [
    { address: 0x210000, kind: "page", bytes: 131_072, sha256: "a".repeat(64), url: "text" },
    { address: 0x230000, kind: "page", bytes: 65_536, sha256: "b".repeat(64), url: "rodata" },
    { address: 0x10000, kind: "app", bytes: 2_062_912, sha256: "c".repeat(64), url: "app" },
  ];

  it("accepts the approved plan shape", () => {
    expect(() => assertRegionPlan(base)).not.toThrow();
  });

  it("refuses plans that break the safety contract", () => {
    expect(() => assertRegionPlan([])).toThrow(/at least one flash region/u);
    expect(() => assertRegionPlan([base[0], base[1]])).toThrow(/exactly one app region/u);
    expect(() => assertRegionPlan([base[2], base[0], base[1]])).toThrow(/app region last/u);
    expect(() => assertRegionPlan([base[0], base[2], base[2]])).toThrow(/exactly one app region/u);
    expect(() => assertRegionPlan([{ ...base[0], address: 0x8000 }, base[2]])).toThrow(
      /outside the approved write scope/u,
    );
    expect(() => assertRegionPlan([{ ...base[0], address: 0x0 }, base[2]])).toThrow(
      /outside the approved write scope/u,
    );
    expect(() => assertRegionPlan([{ ...base[0], kind: "nvs" }, base[2]])).toThrow(/not supported/u);
    expect(() => assertRegionPlan([base[0], base[0], base[2]])).toThrow(/declared twice/u);
    expect(() => assertRegionPlan([{ ...base[0], sha256: "nope" }, base[2]])).toThrow(/lowercase SHA-256/u);
    expect(() => assertRegionPlan([{ ...base[0], bytes: 0 }, base[2]])).toThrow(/positive byte count/u);
    expect(() => assertRegionPlan([{ ...base[0], url: "" }, base[2]])).toThrow(/imported binary/u);
    // A page long enough to reach the next page rejects as an overlap.
    expect(() => assertRegionPlan([{ ...base[0], bytes: 0x30000 }, base[1], base[2]])).toThrow(/overlaps/u);
    // The app image may never be written anywhere but 0x10000.
    expect(() => assertRegionPlan([{ ...base[2], address: 0x210000 }])).toThrow(/app region must be written at 0x10000/u);
    expect(() => assertRegionPlan([{ ...base[0], address: 0x10000 }, base[2]])).toThrow(
      /module page may not be written at the app address/u,
    );
  });
});
