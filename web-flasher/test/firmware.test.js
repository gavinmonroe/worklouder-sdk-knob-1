import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { firmwareCatalog } from "../src/data/firmware.js";
import { inspectEsp32S3App, validateFirmwareBytes } from "../src/lib/firmware.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const byId = Object.fromEntries(firmwareCatalog.map((firmware) => [firmware.id, firmware]));
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
];

describe("web firmware catalog", () => {
  for (const fixture of fixtures) {
    it(`accepts exact ${fixture.id} bytes`, async () => {
      const bytes = new Uint8Array(await readFile(path.join(root, fixture.path)));
      const result = await validateFirmwareBytes(bytes, fixture);
      expect(result.digest).toBe(fixture.sha256);
      expect(result.image.segmentCount).toBe(6);
    });
  }

  it("rejects a changed image before device access", async () => {
    const fixture = fixtures[1];
    const bytes = new Uint8Array(await readFile(path.join(root, fixture.path)));
    bytes[100] ^= 0xff;
    await expect(validateFirmwareBytes(bytes, fixture)).rejects.toThrow(/SHA-256/u);
  });

  it("rejects a structurally invalid app", async () => {
    const bytes = new Uint8Array(64);
    await expect(inspectEsp32S3App(bytes)).rejects.toThrow(/magic/u);
  });
});
