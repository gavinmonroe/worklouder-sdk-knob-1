import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const archive = path.join(root, "web-flasher/public/downloads/framer-f1-music-host-macos.zip");

describe("downloadable Music host companion", () => {
  it("packages a repo-independent launcher and exact runtime modules", () => {
    expect(statSync(archive).size).toBeGreaterThan(10_000);
    const entries = execFileSync("/usr/bin/unzip", ["-Z1", archive], { encoding: "utf8" })
      .trim().split("\n");
    expect(entries).toContain("Framer F1 Music Host/Start Framer Music Sync.command");
    expect(entries).toContain("Framer F1 Music Host/README.txt");
    expect(entries).toContain("Framer F1 Music Host/runtime/f1-widget-sdk/examples/music-player/companion/run-music-host.mjs");
    expect(entries).toContain("Framer F1 Music Host/runtime/f1-widget-sdk/src/media-transport/session.mjs");
    expect(entries).toContain("Framer F1 Music Host/runtime/framer-widgets/lib/input-inspector.mjs");
    expect(entries.some((entry) => entry.includes("node_modules"))).toBe(false);
    const expectedSha256 = createHash("sha256").update(readFileSync(archive)).digest("hex");
    expect(readFileSync(`${archive}.sha256`, "utf8"))
      .toBe(`${expectedSha256}  framer-f1-music-host-macos.zip\n`);
  });
});
