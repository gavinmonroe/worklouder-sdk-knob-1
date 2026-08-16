import {
  FRAMER_INDEXED_IMAGE,
  parseSerializedLvglIndexed,
  serializeLvglIndexed,
} from "./framer-lvgl-indexed.mjs";

export const STAGE3E34_RAM_IMAGE = Object.freeze({
  width: 96,
  height: 78,
  stride: 48,
  paletteBytes: 64,
  dataBytes: 3808,
  descriptorBytes: 24,
  descriptorWord0: 0x00000919,
});

/** Slot-1 cache sentinels force state 0 of the RAM-persisted species on every entry. */
export function stage3e34ReentryDescriptorIndex(selectedSpecies) {
  if (!Number.isInteger(selectedSpecies) || selectedSpecies < 0 || selectedSpecies >= 6) {
    throw new Error("Stage-3E.3.4 selected species must be in 0..5.");
  }
  return selectedSpecies * 8;
}

function unpackI4(serialized, info) {
  const pixels = serialized.subarray(FRAMER_INDEXED_IMAGE.headerBytes + info.paletteBytes);
  const indices = new Uint8Array(info.width * info.height);
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const packed = pixels[y * info.stride + (x >> 1)];
      indices[y * info.width + x] = (x & 1) === 0 ? packed >> 4 : packed & 0x0f;
    }
  }
  return indices;
}

/** Executable parity model for the Xtensa nearest-neighbor 52x42 -> 96x78 expander. */
export function expandStage3e34I4(serialized) {
  if (!Buffer.isBuffer(serialized)) throw new TypeError("Stage-3E.3.4 source must be a Buffer.");
  const info = parseSerializedLvglIndexed(serialized);
  if (info.colorFormat !== 0x09 || info.width !== 52 || info.height !== 42 || info.stride !== 26) {
    throw new Error("Stage-3E.3.4 RAM expansion requires exact 52x42 LVGL I4 input.");
  }
  const source = unpackI4(serialized, info);
  const indices = new Uint8Array(STAGE3E34_RAM_IMAGE.width * STAGE3E34_RAM_IMAGE.height);
  for (let y = 0; y < STAGE3E34_RAM_IMAGE.height; y += 1) {
    const sourceY = Math.floor((y * info.height) / STAGE3E34_RAM_IMAGE.height);
    for (let x = 0; x < STAGE3E34_RAM_IMAGE.width; x += 1) {
      const sourceX = Math.floor((x * info.width) / STAGE3E34_RAM_IMAGE.width);
      indices[y * STAGE3E34_RAM_IMAGE.width + x] = source[sourceY * info.width + sourceX];
    }
  }
  return serializeLvglIndexed({
    width: STAGE3E34_RAM_IMAGE.width,
    height: STAGE3E34_RAM_IMAGE.height,
    formatName: "I4",
    paletteBgra: serialized.subarray(FRAMER_INDEXED_IMAGE.headerBytes,
      FRAMER_INDEXED_IMAGE.headerBytes + info.paletteBytes),
    indices,
  });
}
