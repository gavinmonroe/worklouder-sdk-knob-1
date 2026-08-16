import { inspectEsp32AppImage } from "./esp-app-image.mjs";

export const FRAMER_INDEXED_IMAGE = Object.freeze({
  magic: 0x19,
  headerBytes: 12,
  descriptorBytes: 24,
  formats: Object.freeze({
    I1: Object.freeze({ colorFormat: 0x07, colors: 2, bitsPerPixel: 1, paletteBytes: 8 }),
    I2: Object.freeze({ colorFormat: 0x08, colors: 4, bitsPerPixel: 2, paletteBytes: 16 }),
    I4: Object.freeze({ colorFormat: 0x09, colors: 16, bitsPerPixel: 4, paletteBytes: 64 }),
    I8: Object.freeze({ colorFormat: 0x0a, colors: 256, bitsPerPixel: 8, paletteBytes: 1024 }),
  }),
});

export const FRAMER_RUNTIME_ASSET_BOUNDARY = Object.freeze({
  dromStart: 0x3c120020,
  stockDromEnd: 0x3c1c1190,
  originalMappedPageEnd: 0x3c1d0000,
  availableBytes: 0xee70,
});

export const FRAMER_LVGL_CACHE_ABI = Object.freeze({
  imageSetSrc: 0x420aeef0,
  imageCacheDrop: 0x420a87e0,
  genericCacheDrop: 0x420a84ec,
  imageCacheInit: 0x420a5164,
  imageCacheBudgetBytes: 0x40000,
  rootBackgroundColor: 0x4204ef10,
  objectTextColor: 0x4204ef44,
});

const asBuffer = (value, name) => {
  if (!Buffer.isBuffer(value)) throw new TypeError(`${name} must be a Buffer.`);
  return value;
};

const align4 = (value) => (value + 3) & ~3;

export function indexedStride(width, bitsPerPixel) {
  if (!Number.isInteger(width) || width <= 0) throw new Error("Indexed-image width must be positive.");
  if (![1, 2, 4, 8].includes(bitsPerPixel)) throw new Error("Indexed images require 1, 2, 4, or 8 bpp.");
  return Math.ceil((width * bitsPerPixel) / 8);
}

export function parseSerializedLvglIndexed(serialized) {
  const input = asBuffer(serialized, "Serialized LVGL indexed image");
  if (input.length < FRAMER_INDEXED_IMAGE.headerBytes + 1) throw new Error("Indexed image is truncated.");
  if (input[0] !== FRAMER_INDEXED_IMAGE.magic) throw new Error("Indexed image magic changed.");
  const format = Object.values(FRAMER_INDEXED_IMAGE.formats)
    .find((candidate) => candidate.colorFormat === input[1]);
  if (!format) throw new Error(`Unsupported indexed color format 0x${input[1].toString(16)}.`);
  const flags = input.readUInt16LE(2);
  const width = input.readUInt16LE(4);
  const height = input.readUInt16LE(6);
  const stride = input.readUInt16LE(8);
  const reserved = input.readUInt16LE(10);
  const expectedStride = indexedStride(width, format.bitsPerPixel);
  if (flags !== 0 || reserved !== 0) throw new Error("Only uncompressed indexed images are supported.");
  if (height === 0 || stride !== expectedStride) {
    throw new Error(`Indexed stride is ${stride}; expected ${expectedStride}.`);
  }
  const dataBytes = format.paletteBytes + stride * height;
  if (input.length !== FRAMER_INDEXED_IMAGE.headerBytes + dataBytes) {
    throw new Error(`Indexed byte count is ${input.length}; expected ${FRAMER_INDEXED_IMAGE.headerBytes + dataBytes}.`);
  }
  return Object.freeze({ flags, width, height, stride, dataBytes, ...format });
}

/** Pack palette indices in LVGL's high-bit-first I1/I2/I4 row layout. */
export function packIndexedPixels(indices, { width, height, bitsPerPixel }) {
  if (!(indices instanceof Uint8Array) || indices.length !== width * height) {
    throw new Error("Indexed pixels must contain exactly width*height entries.");
  }
  const stride = indexedStride(width, bitsPerPixel);
  const maxIndex = (1 << bitsPerPixel) - 1;
  const pixelsPerByte = 8 / bitsPerPixel;
  const packed = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = indices[y * width + x];
      if (index > maxIndex) throw new Error(`Palette index ${index} exceeds ${bitsPerPixel}-bpp range.`);
      const shift = 8 - bitsPerPixel * ((x % pixelsPerByte) + 1);
      packed[y * stride + Math.floor(x / pixelsPerByte)] |= index << shift;
    }
  }
  return packed;
}

export function serializeLvglIndexed({ width, height, formatName, paletteBgra, indices }) {
  const format = FRAMER_INDEXED_IMAGE.formats[formatName];
  if (!format) throw new Error(`Unknown indexed format ${formatName}.`);
  const palette = asBuffer(paletteBgra, "Indexed BGRA palette");
  if (palette.length !== format.paletteBytes) {
    throw new Error(`${formatName} palette is ${palette.length} bytes; expected ${format.paletteBytes}.`);
  }
  const stride = indexedStride(width, format.bitsPerPixel);
  const pixels = packIndexedPixels(indices, { width, height, bitsPerPixel: format.bitsPerPixel });
  const output = Buffer.alloc(FRAMER_INDEXED_IMAGE.headerBytes + palette.length + pixels.length);
  output[0] = FRAMER_INDEXED_IMAGE.magic;
  output[1] = format.colorFormat;
  output.writeUInt16LE(width, 4);
  output.writeUInt16LE(height, 6);
  output.writeUInt16LE(stride, 8);
  palette.copy(output, FRAMER_INDEXED_IMAGE.headerBytes);
  pixels.copy(output, FRAMER_INDEXED_IMAGE.headerBytes + palette.length);
  parseSerializedLvglIndexed(output);
  return output;
}

export function buildNativeLvglIndexedBank(frames, { baseAddress }) {
  if (!Array.isArray(frames) || frames.length === 0) throw new Error("At least one indexed frame is required.");
  if (!Number.isInteger(baseAddress) || (baseAddress & 3) !== 0) throw new Error("Asset-bank base must be 4-byte aligned.");
  const parsed = frames.map((bytes) => ({ bytes: asBuffer(bytes, "Indexed frame"), info: parseSerializedLvglIndexed(bytes) }));
  const descriptorTableBytes = parsed.length * FRAMER_INDEXED_IMAGE.descriptorBytes;
  let cursor = align4(descriptorTableBytes);
  const placements = parsed.map(({ info }) => {
    const placement = Object.freeze({ dataOffset: cursor, dataAddress: baseAddress + cursor, dataBytes: info.dataBytes });
    cursor = align4(cursor + info.dataBytes);
    return placement;
  });
  const bank = Buffer.alloc(cursor);
  const descriptors = [];
  for (let index = 0; index < parsed.length; index += 1) {
    const { bytes, info } = parsed[index];
    const placement = placements[index];
    const descriptorOffset = index * FRAMER_INDEXED_IMAGE.descriptorBytes;
    bytes.copy(bank, descriptorOffset, 0, FRAMER_INDEXED_IMAGE.headerBytes);
    bank.writeUInt32LE(info.dataBytes, descriptorOffset + 12);
    bank.writeUInt32LE(placement.dataAddress >>> 0, descriptorOffset + 16);
    bytes.copy(bank, placement.dataOffset, FRAMER_INDEXED_IMAGE.headerBytes);
    descriptors.push(Object.freeze({
      index,
      descriptorOffset,
      descriptorAddress: baseAddress + descriptorOffset,
      ...placement,
      width: info.width,
      height: info.height,
      stride: info.stride,
      colorFormat: info.colorFormat,
    }));
  }
  return Object.freeze({ bank, descriptors: Object.freeze(descriptors), descriptorTableBytes });
}

export function auditRuntimeAssetBoundary(bank, {
  baseAddress = FRAMER_RUNTIME_ASSET_BOUNDARY.stockDromEnd,
  boundary = FRAMER_RUNTIME_ASSET_BOUNDARY.originalMappedPageEnd,
} = {}) {
  const bytes = asBuffer(bank, "Runtime asset bank");
  const endAddress = baseAddress + bytes.length;
  if (baseAddress < FRAMER_RUNTIME_ASSET_BOUNDARY.stockDromEnd || endAddress > boundary) {
    throw new Error(
      `Runtime asset bank 0x${baseAddress.toString(16)}..0x${endAddress.toString(16)} crosses ` +
      `the live-proven DROM boundary 0x${boundary.toString(16)}.`,
    );
  }
  return Object.freeze({ baseAddress, endAddress, bytes: bytes.length, headroom: boundary - endAddress });
}

export function readVirtualAppBytes(appImage, virtualAddress, length) {
  const info = inspectEsp32AppImage(asBuffer(appImage, "Framer app image"));
  const segment = info.segments.find((candidate) =>
    virtualAddress >= candidate.loadAddress && virtualAddress + length <= candidate.loadAddress + candidate.length);
  if (!segment) throw new Error(`Virtual range at 0x${virtualAddress.toString(16)} is not present.`);
  return segment.data.subarray(virtualAddress - segment.loadAddress, virtualAddress - segment.loadAddress + length);
}
