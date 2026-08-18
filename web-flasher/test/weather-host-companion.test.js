import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const archive = path.join(root, "web-flasher/public/downloads/framer-f1-weather-host-macos.zip");

describe("downloadable Weather host companion", () => {
  it("packages a repo-independent launcher and exact runtime modules", () => {
    expect(statSync(archive).size).toBeGreaterThan(10_000);
    const entries = execFileSync("/usr/bin/unzip", ["-Z1", archive], { encoding: "utf8" })
      .trim().split("\n");

    expect(entries).toContain("Framer F1 Weather Host/Framer F1 Weather Host.command");
    expect(entries).toContain("Framer F1 Weather Host/README.md");
    expect(entries).toContain(
      "Framer F1 Weather Host/runtime/f1-widget-sdk/examples/render-v2-mquickjs-weather-canary/companion/run-weather-host.mjs");

    // ZIP-sync host tool and its pure helpers.
    expect(entries).toContain(
      "Framer F1 Weather Host/runtime/f1-widget-sdk/examples/render-v2-mquickjs-weather-canary/tools/zip-sync.mjs");
    expect(entries).toContain(
      "Framer F1 Weather Host/runtime/f1-widget-sdk/examples/render-v2-mquickjs-weather-canary/tools/zip-sync-config.mjs");
    expect(entries).toContain(
      "Framer F1 Weather Host/runtime/f1-widget-sdk/examples/render-v2-mquickjs-weather-canary/tools/zip-sync-device-rpc.mjs");
    expect(entries).toContain(
      "Framer F1 Weather Host/runtime/f1-widget-sdk/examples/render-v2-mquickjs-weather-canary/tools/zip-sync-policy.mjs");
    expect(entries).toContain(
      "Framer F1 Weather Host/runtime/f1-widget-sdk/examples/render-v2-mquickjs-weather-canary/tools/zip-sync-providers.mjs");
    expect(entries).toContain(
      "Framer F1 Weather Host/runtime/f1-widget-sdk/examples/render-v2-mquickjs-weather-canary/tools/zip-sync-telemetry.mjs");
    expect(entries).toContain(
      "Framer F1 Weather Host/runtime/f1-widget-sdk/examples/render-v2-mquickjs-weather-canary/protocol.mjs");
    expect(entries).toContain(
      "Framer F1 Weather Host/runtime/f1-widget-sdk/examples/render-v2-mquickjs-weather-canary/host-adapter.mjs");

    // Shared renderer modules and the Input debugger bridge.
    expect(entries).toContain("Framer F1 Weather Host/runtime/f1-widget-sdk/src/render-v2/weather.mjs");
    expect(entries).toContain("Framer F1 Weather Host/runtime/f1-widget-sdk/src/render-v2/mquickjs.mjs");
    expect(entries).toContain("Framer F1 Weather Host/runtime/f1-widget-sdk/src/render/raster-animation.mjs");
    expect(entries).toContain("Framer F1 Weather Host/runtime/f1-widget-sdk/src/render/widget-bundle.mjs");
    expect(entries).toContain("Framer F1 Weather Host/runtime/f1-widget-sdk/src/render/scene-rpc.mjs");
    expect(entries).toContain("Framer F1 Weather Host/runtime/f1-widget-sdk/src/render/glyph-atlas.mjs");
    expect(entries).toContain("Framer F1 Weather Host/runtime/framer-widgets/lib/input-inspector.mjs");

    // Clock + timer generation-2 package: publisher, builder, transport, and
    // the exact frozen source parts the publisher reads.
    expect(entries).toContain(
      "Framer F1 Weather Host/runtime/f1-widget-sdk/input-lab/lib/input-wlrpc-scene-transport.mjs");
    expect(entries).toContain(
      "Framer F1 Weather Host/runtime/f1-widget-sdk/examples/render-v2-focus-timer/tools/push-focus-timer-package.mjs");
    expect(entries).toContain(
      "Framer F1 Weather Host/runtime/f1-widget-sdk/examples/render-v2-focus-timer/focus-timer-package.mjs");
    expect(entries).toContain(
      "Framer F1 Weather Host/runtime/f1-widget-sdk/examples/render-v2-focus-dial/build/render-v2-focus-dial.base.f1wb");
    expect(entries).toContain(
      "Framer F1 Weather Host/runtime/f1-widget-sdk/examples/render-v2-focus-dial/build/render-v2-focus-dial.f2ep");
    expect(entries).toContain(
      "Framer F1 Weather Host/runtime/f1-widget-sdk/examples/render-v2-focus-timer/build/render-v2-focus-timer.f2ep");
    expect(entries).toContain(
      "Framer F1 Weather Host/runtime/f1-widget-sdk/examples/render-v2-focus-timer/build/render-v2-focus-timer.base.lzss");

    expect(entries.some((entry) => entry.includes("node_modules"))).toBe(false);

    const expectedSha256 = createHash("sha256").update(readFileSync(archive)).digest("hex");
    expect(readFileSync(`${archive}.sha256`, "utf8"))
      .toBe(`${expectedSha256}  framer-f1-weather-host-macos.zip\n`);
  });
});
