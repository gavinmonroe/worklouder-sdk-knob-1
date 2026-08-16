import { LOGICAL_CANVAS } from "./media-contract.mjs";

const EDGE = Object.freeze({ r: 0, g: 0, b: 0 });
const GLYPHS = Object.freeze({
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  J: ["00001", "00001", "00001", "00001", "10001", "10001", "01110"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "11001", "10101", "10011", "10011", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
});

function pixelOffset(x, y, width = LOGICAL_CANVAS.width) {
  return (y * width + x) * 4;
}

function writePixel(pixels, x, y, color, alpha = 255) {
  if (x < 0 || y < 0 || x >= LOGICAL_CANVAS.width || y >= LOGICAL_CANVAS.height) return;
  const offset = pixelOffset(x, y);
  if (alpha === 255) {
    pixels[offset] = color.r;
    pixels[offset + 1] = color.g;
    pixels[offset + 2] = color.b;
  } else {
    const fraction = alpha / 255;
    pixels[offset] = Math.round(color.r * fraction + pixels[offset] * (1 - fraction));
    pixels[offset + 1] = Math.round(color.g * fraction + pixels[offset + 1] * (1 - fraction));
    pixels[offset + 2] = Math.round(color.b * fraction + pixels[offset + 2] * (1 - fraction));
  }
  pixels[offset + 3] = 255;
}

function mix(from, to, amount) {
  return {
    r: Math.round(from.r + (to.r - from.r) * amount),
    g: Math.round(from.g + (to.g - from.g) * amount),
    b: Math.round(from.b + (to.b - from.b) * amount),
  };
}

export function renderEdgeNormalizedRadial(mainColor, {
  width = LOGICAL_CANVAS.width,
  height = LOGICAL_CANVAS.height,
  centerX = 50,
  centerY = 155,
  edgeColor = EDGE,
} = {}) {
  if (width !== LOGICAL_CANVAS.width || height !== LOGICAL_CANVAS.height) {
    throw new Error("Music-player proof is pinned to the 100x310 logical canvas.");
  }
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - centerX;
      const dy = y - centerY;
      const horizontalRadius = dx < 0 ? centerX : width - 1 - centerX;
      const verticalRadius = dy < 0 ? centerY : height - 1 - centerY;
      const normalizedX = horizontalRadius === 0 ? 1 : dx / horizontalRadius;
      const normalizedY = verticalRadius === 0 ? 1 : dy / verticalRadius;
      const normalizedRadiusSquared = normalizedX * normalizedX + normalizedY * normalizedY;
      const interior = Math.max(0, 1 - normalizedRadiusSquared);
      const weight = interior * interior;
      const color = mix(edgeColor, mainColor, weight);
      const offset = pixelOffset(x, y, width);
      pixels[offset] = color.r;
      pixels[offset + 1] = color.g;
      pixels[offset + 2] = color.b;
      pixels[offset + 3] = 255;
    }
  }
  return pixels;
}

function drawRect(pixels, x, y, width, height, color, alpha = 255) {
  for (let py = y; py < y + height; py += 1) {
    for (let px = x; px < x + width; px += 1) writePixel(pixels, px, py, color, alpha);
  }
}

function drawAlbumArt(pixels, albumArt, layout) {
  drawRect(pixels, layout.x - 2, layout.y - 2, layout.width + 4, layout.height + 4,
    { r: 255, g: 255, b: 255 }, 36);
  for (let y = 0; y < layout.height; y += 1) {
    const sourceY = Math.min(albumArt.height - 1, Math.floor(y * albumArt.height / layout.height));
    for (let x = 0; x < layout.width; x += 1) {
      const sourceX = Math.min(albumArt.width - 1, Math.floor(x * albumArt.width / layout.width));
      const source = (sourceY * albumArt.width + sourceX) * 4;
      writePixel(pixels, layout.x + x, layout.y + y, {
        r: albumArt.pixels[source], g: albumArt.pixels[source + 1], b: albumArt.pixels[source + 2],
      }, albumArt.pixels[source + 3]);
    }
  }
}

function textWidth(text) {
  return Math.max(0, text.length * 6 - 1);
}

function fitText(text, maxWidth) {
  const normalized = text.toUpperCase().replace(/[^ A-Z0-9.:-]/gu, " ");
  const maxCharacters = Math.max(1, Math.floor((maxWidth + 1) / 6));
  if (normalized.length <= maxCharacters) return normalized;
  return `${normalized.slice(0, Math.max(0, maxCharacters - 1))}.`;
}

function drawText(pixels, text, y, color, maxWidth = 92) {
  const fitted = fitText(text, maxWidth);
  const startX = Math.floor((LOGICAL_CANVAS.width - textWidth(fitted)) / 2);
  for (let characterIndex = 0; characterIndex < fitted.length; characterIndex += 1) {
    const glyph = GLYPHS[fitted[characterIndex]] ?? GLYPHS[" "];
    for (let row = 0; row < glyph.length; row += 1) {
      for (let column = 0; column < glyph[row].length; column += 1) {
        if (glyph[row][column] === "1") writePixel(pixels, startX + characterIndex * 6 + column, y + row, color);
      }
    }
  }
}

function clock(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

export function renderMusicFrame(snapshot, mainColor) {
  const layout = Object.freeze({
    albumArt: Object.freeze({ x: 10, y: 115, width: 80, height: 80 }),
    titleY: 82,
    artistY: 204,
    timeY: 236,
    progress: Object.freeze({ x: 10, y: 258, width: 80, height: 5 }),
  });
  const background = renderEdgeNormalizedRadial(mainColor);
  const pixels = Buffer.from(background);
  drawAlbumArt(pixels, snapshot.albumArt, layout.albumArt);
  drawText(pixels, snapshot.title, layout.titleY, { r: 248, g: 250, b: 255 });
  drawText(pixels, snapshot.artist, layout.artistY, { r: 174, g: 190, b: 220 });
  drawText(pixels, `${clock(snapshot.positionMs)}-${clock(snapshot.durationMs)}`, layout.timeY,
    { r: 174, g: 190, b: 220 }, 80);
  drawRect(pixels, layout.progress.x, layout.progress.y, layout.progress.width, layout.progress.height,
    { r: 255, g: 255, b: 255 }, 42);
  const progressPixels = Math.max(0, Math.min(layout.progress.width,
    Math.round(layout.progress.width * snapshot.progress)));
  drawRect(pixels, layout.progress.x, layout.progress.y, progressPixels, layout.progress.height,
    { r: 235, g: 247, b: 255 });
  return Object.freeze({
    width: LOGICAL_CANVAS.width,
    height: LOGICAL_CANVAS.height,
    pixels,
    background,
    layout,
    progressPixels,
  });
}
