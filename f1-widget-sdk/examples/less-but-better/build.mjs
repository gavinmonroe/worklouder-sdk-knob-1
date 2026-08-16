import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { decodeRasterAnimation } from "../../src/render/index.mjs";
import { ChromiumRasterCaptureProvider } from "../../input-lab/lib/chromium-raster-capture.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const [html, css] = await Promise.all([
  readFile(path.join(root, "widget.html"), "utf8"),
  readFile(path.join(root, "widget.css"), "utf8"),
]);
const settings = Object.freeze({ fps: 2, loopDurationMs: 1000, maxFrames: 2,
  maxBytes: 128 * 1024, interaction: "hover" });
const captured = await new ChromiumRasterCaptureProvider().capture({ html, css, settings });
const decoded = decodeRasterAnimation(captured.animation.binary);
const output = path.join(root, "build");
await mkdir(output, { recursive: true });
await Promise.all([
  writeFile(path.join(output, "less-but-better.f1ra"), captured.animation.binary),
  ...captured.pngFrames.map((frame, index) => writeFile(
    path.join(output, `frame-${String(index).padStart(2, "0")}.png`), Buffer.from(frame, "base64"))),
  writeFile(path.join(output, "manifest.json"), `${JSON.stringify({
    format: captured.animation.format,
    animationSha256: captured.animation.sha256,
    sourceSha256: createHash("sha256").update(html).update("\0").update(css).digest("hex"),
    settings: captured.settings,
    selectedFrameIndices: captured.animation.selectedFrameIndices,
    requestedFrameCount: captured.animation.requestedFrameCount,
    encoded: captured.animation.stats,
    decoded: { frameCount: decoded.frames.length, modes: decoded.modes },
    note: "Hardware-free browser capture. This artifact is not a firmware image or device authorization.",
  }, null, 2)}\n`),
]);
process.stdout.write(`${JSON.stringify({ status: "OFFLINE_BROWSER_RASTER",
  sha256: captured.animation.sha256, settings: captured.settings, stats: captured.animation.stats,
  selectedFrameIndices: captured.animation.selectedFrameIndices }, null, 2)}\n`);
