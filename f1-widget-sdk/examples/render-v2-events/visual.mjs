import { encodeRgbaPng } from "../../src/png.mjs";
import { rgb565FrameToRgba8888 } from "../../src/render/index.mjs";

export const VIEWPORT = Object.freeze({ width: 100, height: 310 });
export const HOST_COLOR_HEX = Object.freeze(["#59E2FF", "#42DCE1", "#5BE89E", "#8FE16C", "#D3D54E",
  "#FFB74D", "#FF875B", "#FF5F97", "#DE5BE2", "#BB6AFF"]);

export function diffPixelCount(left, right) {
  let changed = 0;
  for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) changed += 1;
  return changed;
}

export function framePng(frame) {
  const rgba = Buffer.from(rgb565FrameToRgba8888(frame, VIEWPORT));
  return encodeRgbaPng(VIEWPORT.width, VIEWPORT.height, rgba);
}

export function contactSheetPng(frames, { scale = 3, gap = 8 } = {}) {
  const width = frames.length * VIEWPORT.width * scale + (frames.length + 1) * gap;
  const height = VIEWPORT.height * scale + gap * 2;
  const rgba = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    rgba[index * 4] = 3; rgba[index * 4 + 1] = 4; rgba[index * 4 + 2] = 9; rgba[index * 4 + 3] = 255;
  }
  frames.forEach((frame, frameIndex) => {
    const source = rgb565FrameToRgba8888(frame, VIEWPORT);
    const x0 = gap + frameIndex * (VIEWPORT.width * scale + gap);
    for (let y = 0; y < VIEWPORT.height; y += 1) for (let x = 0; x < VIEWPORT.width; x += 1) {
      const sourceIndex = (y * VIEWPORT.width + x) * 4;
      for (let sy = 0; sy < scale; sy += 1) for (let sx = 0; sx < scale; sx += 1) {
        const targetIndex = ((gap + y * scale + sy) * width + x0 + x * scale + sx) * 4;
        rgba[targetIndex] = source[sourceIndex]; rgba[targetIndex + 1] = source[sourceIndex + 1];
        rgba[targetIndex + 2] = source[sourceIndex + 2]; rgba[targetIndex + 3] = 255;
      }
    }
  });
  return encodeRgbaPng(width, height, rgba);
}
