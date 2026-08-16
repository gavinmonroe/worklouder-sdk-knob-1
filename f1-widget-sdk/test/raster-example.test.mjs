import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { decodeRasterAnimation, RASTER_ANIMATION_LIMITS } from "../src/render/index.mjs";

const example = new URL("../examples/less-but-better/", import.meta.url);

test("Less-but-better preserves advanced local CSS and emits a bounded decodable F1RA", async () => {
  const [html, css, binary, manifestSource] = await Promise.all([
    readFile(new URL("widget.html", example), "utf8"),
    readFile(new URL("widget.css", example), "utf8"),
    readFile(new URL("build/less-but-better.f1ra", example)),
    readFile(new URL("build/manifest.json", example), "utf8"),
  ]);
  assert.match(html, /<feTurbulence\b/u);
  assert.match(css, /radial-gradient\(/u);
  assert.match(css, /mix-blend-mode:\s*soft-light/u);
  assert.match(css, /\.poster:hover/u);
  assert.match(css, /@keyframes\s+breathe/u);
  assert.doesNotMatch(`${html}\n${css}`, /https?:|<script\b|@import\b/iu);
  const manifest = JSON.parse(manifestSource);
  assert.equal(manifest.sourceSha256,
    createHash("sha256").update(html).update("\0").update(css).digest("hex"));
  const decoded = decodeRasterAnimation(binary);
  assert.equal(decoded.sha256, manifest.animationSha256);
  assert.equal(decoded.width, 100);
  assert.equal(decoded.height, 310);
  assert.equal(decoded.frames.length, 2);
  assert.ok(binary.length <= RASTER_ANIMATION_LIMITS.maxEncodedBytes);
  assert.deepEqual(decoded.modes, manifest.decoded.modes);
  const brightCopyPixels = decoded.frames.map((frame) => {
    let count = 0;
    for (let y = 220; y < 310; y += 1) for (let x = 0; x < 100; x += 1) {
      const color = frame[y * 100 + x];
      if (((color >>> 11) & 31) >= 25 && ((color >>> 5) & 63) >= 50 && (color & 31) >= 25) count += 1;
    }
    return count;
  });
  assert.ok(brightCopyPixels.every((count) => count >= 100),
    `Static LESS/BUT/BETTER copy must survive every captured frame; received ${brightCopyPixels}.`);
});
