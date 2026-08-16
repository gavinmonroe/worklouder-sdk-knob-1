import { glyphMaskPixel } from "./glyph-atlas.mjs";
import { sampleCssCellAtTick, validateCssScene } from "./css-scene.mjs";

function invariant(value, message) { if (!value) throw new Error(message); }

function channels565(value) {
  const r5 = (value >>> 11) & 31; const g6 = (value >>> 5) & 63; const b5 = value & 31;
  return [(r5 << 3) | (r5 >>> 2), (g6 << 2) | (g6 >>> 4), (b5 << 3) | (b5 >>> 2)];
}

function blend565(background, foreground, alpha) {
  const bg = channels565(background); const fg = channels565(foreground); const inverse = 255 - alpha;
  const r = Math.floor((fg[0] * alpha + bg[0] * inverse + 127) / 255);
  const g = Math.floor((fg[1] * alpha + bg[1] * inverse + 127) / 255);
  const b = Math.floor((fg[2] * alpha + bg[2] * inverse + 127) / 255);
  return ((r >>> 3) << 11) | ((g >>> 2) << 5) | (b >>> 3);
}

/** Software reference compositor shared by exact previews and firmware golden tests. */
export function renderCssSceneRgb565(scene, atlas, elapsedTick) {
  validateCssScene(scene);
  invariant(atlas?.format === "framer-glyph-atlas-v1" && atlas.masks?.length === scene.glyphs.length,
    "Scene and glyph atlas counts do not match.");
  invariant(atlas.width <= scene.layout.cellWidth && atlas.height <= scene.layout.cellHeight,
    "Glyph atlas does not fit the compiled cell dimensions.");
  const frame = new Uint16Array(scene.viewport.width * scene.viewport.height);
  frame.fill(scene.background.color565);
  for (let cellIndex = 0; cellIndex < scene.cells.length; cellIndex += 1) {
    const cell = scene.cells[cellIndex];
    const sampled = sampleCssCellAtTick(scene, cellIndex, elapsedTick);
    const x0 = cell.x + Math.floor((scene.layout.cellWidth - atlas.width) / 2);
    const y0 = cell.y + Math.floor((scene.layout.cellHeight - atlas.height) / 2);
    const radius = sampled.glowRadius;
    for (let gy = -radius; gy < atlas.height + radius; gy += 1) {
      const y = y0 + gy;
      if (y < cell.y || y >= cell.y + scene.layout.cellHeight || y < 0 || y >= scene.viewport.height) continue;
      for (let gx = -radius; gx < atlas.width + radius; gx += 1) {
        const x = x0 + gx;
        if (x < cell.x || x >= cell.x + scene.layout.cellWidth || x < 0 || x >= scene.viewport.width) continue;
        const solid = glyphMaskPixel(atlas, cell.glyphId, gx, gy);
        let distance = solid ? 0 : radius + 1;
        if (!solid && radius > 0) {
          for (let dy = -radius; dy <= radius; dy += 1) for (let dx = -radius; dx <= radius; dx += 1) {
            const candidate = Math.max(Math.abs(dx), Math.abs(dy));
            if (candidate < distance && glyphMaskPixel(atlas, cell.glyphId, gx + dx, gy + dy)) distance = candidate;
          }
        }
        if (distance > radius) continue;
        const pixel = y * scene.viewport.width + x;
        frame[pixel] = distance === 0 ? sampled.color565 : blend565(frame[pixel], sampled.color565,
          Math.min(192, Math.floor((radius - distance + 1) * 192 / (radius + 1))));
      }
    }
  }
  return frame;
}

export function rgb565FrameToRgba8888(frame, { width = 100, height = 310 } = {}) {
  invariant(frame instanceof Uint16Array && frame.length === width * height, "RGB565 frame dimensions do not match.");
  const output = new Uint8ClampedArray(frame.length * 4);
  frame.forEach((color, index) => {
    const [r, g, b] = channels565(color);
    output[index * 4] = r; output[index * 4 + 1] = g; output[index * 4 + 2] = b; output[index * 4 + 3] = 255;
  });
  return output;
}
