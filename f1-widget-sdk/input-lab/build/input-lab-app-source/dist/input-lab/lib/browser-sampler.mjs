const Q = 65535;
const divideRound = (numerator, denominator) => Math.floor((numerator + Math.floor(denominator / 2)) / denominator);
const mix = (left, right, amount) => left + divideRound((right - left) * amount, Q);
const smoothstep = (value) => Math.max(0, Math.min(Q,
  3 * divideRound(value * value, Q) - 2 * divideRound(divideRound(value * value, Q) * value, Q)));

function rgb565({ r, g, b }) { return ((r >>> 3) << 11) | ((g >>> 2) << 5) | (b >>> 3); }
function expand565(value) { return { r: Math.round(((value >>> 11) & 31) * 255 / 31),
  g: Math.round(((value >>> 5) & 63) * 255 / 63), b: Math.round((value & 31) * 255 / 31), a: 255 }; }
function composite(color, background) { const alpha = color.a / 255; return { r: Math.round(color.r * alpha + background.r * (1 - alpha)),
  g: Math.round(color.g * alpha + background.g * (1 - alpha)), b: Math.round(color.b * alpha + background.b * (1 - alpha)) }; }

export function sampleBrowserCellAtTick(scene, cellIndex, tick) {
  const cell = scene.cells[cellIndex];
  if (cell.animationId === 255) return { color565: cell.color565, glowRadius: 0 };
  const animation = scene.animations[cell.animationId];
  if (tick < animation.delayTicks) return { color565: cell.color565, glowRadius: 0 };
  const phase = (tick - animation.delayTicks) % animation.durationTicks;
  const track = scene.tracks[animation.trackId];
  let rightIndex = track.stops.findIndex((stop) => stop.percent * animation.durationTicks >= phase * 100);
  if (rightIndex <= 0) rightIndex = 1;
  const left = track.stops[rightIndex - 1];
  const right = track.stops[rightIndex] ?? track.stops.at(-1);
  const denominator = Math.max(1, (right.percent - left.percent) * animation.durationTicks);
  const numerator = Math.max(0, phase * 100 - left.percent * animation.durationTicks);
  let amount = Math.min(Q, divideRound(numerator * Q, denominator));
  if (animation.easing === "ease-in-out") amount = smoothstep(amount);
  const rgba = { r: mix(left.rgba.r, right.rgba.r, amount), g: mix(left.rgba.g, right.rgba.g, amount),
    b: mix(left.rgba.b, right.rgba.b, amount), a: mix(left.rgba.a, right.rgba.a, amount) };
  return { color565: rgb565(composite(rgba, expand565(scene.background.color565))),
    glowRadius: mix(left.glowRadius, right.glowRadius, amount) };
}

function decodeMasks(atlas) {
  return atlas.masksBase64.map((value) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0)));
}

function paintMask(context, mask, atlas, x, y, color, radius) {
  context.fillStyle = color;
  if (radius > 0) {
    context.globalAlpha = 0.18;
    for (let dy = -radius; dy <= radius; dy += 1) for (let dx = -radius; dx <= radius; dx += 1) {
      if (dx * dx + dy * dy > radius * radius) continue;
      for (let row = 0; row < atlas.height; row += 1) for (let column = 0; column < atlas.width; column += 1) {
        if ((mask[row * atlas.rowStride + (column >>> 3)] >>> (7 - (column & 7))) & 1) context.fillRect(x + column + dx, y + row + dy, 1, 1);
      }
    }
  }
  context.globalAlpha = 1;
  for (let row = 0; row < atlas.height; row += 1) for (let column = 0; column < atlas.width; column += 1) {
    if ((mask[row * atlas.rowStride + (column >>> 3)] >>> (7 - (column & 7))) & 1) context.fillRect(x + column, y + row, 1, 1);
  }
}

export function drawAtlasScene(canvas, scene, atlas, tick = 0) {
  const context = canvas.getContext("2d");
  const background = expand565(scene.background.color565);
  context.fillStyle = `rgb(${background.r} ${background.g} ${background.b})`;
  context.fillRect(0, 0, 100, 310);
  const masks = atlas._decodedMasks ??= decodeMasks(atlas);
  scene.cells.forEach((cell, index) => {
    const sample = sampleBrowserCellAtTick(scene, index, tick);
    const color = expand565(sample.color565);
    paintMask(context, masks[cell.glyphId], atlas, cell.x + Math.floor((scene.layout.cellWidth - atlas.width) / 2),
      cell.y + Math.floor((scene.layout.cellHeight - atlas.height) / 2), `rgb(${color.r} ${color.g} ${color.b})`,
      Math.round(sample.glowRadius));
  });
}
