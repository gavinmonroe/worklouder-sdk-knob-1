import { inspectEsp32AppImage } from "./esp-app-image.mjs";

export const LVGL_IMAGE = Object.freeze({
  magic: 0x19,
  colorFormatI8: 0x0a,
  serializedHeaderBytes: 12,
  nativeDescriptorBytes: 24,
  i8PaletteBytes: 256 * 4,
});

export const FRAMER_SPRITE_LAYOUT = Object.freeze({
  dromLoadAddress: 0x3c120020,
  stockDromEndAddress: 0x3c1c1190,
  flashMappingPageBytes: 0x10000,
});

export const FRAMER_IMAGE_PIPELINE = Object.freeze({
  lvImageCreate: 0x420ae8a0,
  lvImageSetSrc: 0x420aeef0,
  imageVisibility: 0x4204eee4,
  objectAlign: 0x4204f0d0,
  backgroundSetImage: 0x4204b788,
  backgroundCreateImage: 0x4204ba82,
  imageLoaderFormatDispatch: 0x42052e10,
  rootSingletonGetter: 0x42004e1c,
  rootSingletonLiteral: 0x42000324,
  registryFromRoot: 0x4210ad9c,
  currentControllerFromRegistry: 0x4210af48,
  rootSingletonAddress: 0x3fcab210,
  wrongStage3dManagerLiteral: 0x4200057c,
  wrongStage3dManagerAddress: 0x3fcab378,
});

const PINNED_WINDOWS = Object.freeze([
  Object.freeze({
    name: "lv_image_create",
    address: FRAMER_IMAGE_PIPELINE.lvImageCreate,
    hex: "36410020b220a1454a2584eda02a20e58fed1df0",
  }),
  Object.freeze({
    name: "lv_image_set_src prologue",
    address: FRAMER_IMAGE_PIPELINE.lvImageSetSrc,
    hex: "36c10020a220259beead03e5cd5e7d0a663a39e1b648d1b6",
  }),
  Object.freeze({
    name: "background image setter",
    address: FRAMER_IMAGE_PIPELINE.backgroundSetImage,
    hex: "366100569301e5edb7f1f0d3e1f1d3c1f1d34901d2a17d0c2b65d8e646010000a2221fcc5a0c02c606000000b2a100e54d63a2221f30b320e57263a2221fb2a000a571030c121df0",
  }),
  Object.freeze({
    name: "background image creation",
    address: FRAMER_IMAGE_PIPELINE.backgroundCreateImage,
    hex: "a22212a5e162a2621f3d0a25c656a5c8567d0aa5c556e5ca56cd0abd07ad03256b510c0da2221fcd0d0c1be57451a2221f0c9be55c63a2221f0c1b654203",
  }),
  Object.freeze({
    name: "wallpaper loader color-format dispatch",
    address: FRAMER_IMAGE_PIPELINE.imageLoaderFormatDispatch,
    hex: "620901e070f40c9ae0b0f5cd07a71637673a0826761126861e86120026966d1c2aa71633c60f00009219047b7770734156994dc6180000009219043b7770724156494d06170000009219041b7770714156594a46150000009219047a7756394a79914d0946150092",
  }),
  Object.freeze({
    name: "root singleton getter",
    address: FRAMER_IMAGE_PIPELINE.rootSingletonGetter,
    hex: "364100a140ed818eece00800167a01a13eeda5f7ffa13ded818bece00800a139ed8189ece008002138ed1df0",
  }),
  Object.freeze({
    name: "root singleton literal",
    address: FRAMER_IMAGE_PIPELINE.rootSingletonLiteral,
    hex: "10b2ca3f",
  }),
  Object.freeze({
    name: "obsolete Stage-3D navigation-manager literal",
    address: FRAMER_IMAGE_PIPELINE.wrongStage3dManagerLiteral,
    hex: "78b3ca3f",
  }),
  Object.freeze({
    name: "root to screen registry",
    address: FRAMER_IMAGE_PIPELINE.registryFromRoot,
    hex: "3641002222141df0",
  }),
  Object.freeze({
    name: "screen registry to current controller",
    address: FRAMER_IMAGE_PIPELINE.currentControllerFromRegistry,
    hex: "36410028321df0",
  }),
]);

function asBuffer(value, description) {
  if (!Buffer.isBuffer(value)) throw new TypeError(`${description} must be a Buffer.`);
  return value;
}

function align4(value) {
  return (value + 3) & ~3;
}

function readVirtual(info, virtualAddress, length) {
  const segment = info.segments.find((candidate) =>
    virtualAddress >= candidate.loadAddress &&
    virtualAddress + length <= candidate.loadAddress + candidate.length);
  if (!segment) throw new Error(`Virtual address 0x${virtualAddress.toString(16)} is not mapped.`);
  const offset = virtualAddress - segment.loadAddress;
  return segment.data.subarray(offset, offset + length);
}

/** Parse the serialized LVGL-v9 I8 file emitted by Input's converter. */
export function parseSerializedLvglI8(serialized) {
  const input = asBuffer(serialized, "Serialized LVGL image");
  const minimumBytes = LVGL_IMAGE.serializedHeaderBytes + LVGL_IMAGE.i8PaletteBytes + 1;
  if (input.length < minimumBytes) throw new Error("Serialized LVGL I8 image is truncated.");
  if (input[0] !== LVGL_IMAGE.magic || input[1] !== LVGL_IMAGE.colorFormatI8) {
    throw new Error("Expected an LVGL-v9 I8 header (19 0a).");
  }

  const flags = input.readUInt16LE(2);
  const width = input.readUInt16LE(4);
  const height = input.readUInt16LE(6);
  const stride = input.readUInt16LE(8);
  const reserved = input.readUInt16LE(10);
  if (flags !== 0 || reserved !== 0) throw new Error("Only uncompressed Input I8 frames are supported.");
  if (width === 0 || height === 0 || stride < width) throw new Error("LVGL I8 dimensions or stride are invalid.");
  const dataBytes = LVGL_IMAGE.i8PaletteBytes + stride * height;
  const expectedBytes = LVGL_IMAGE.serializedHeaderBytes + dataBytes;
  if (input.length !== expectedBytes) {
    throw new Error(`LVGL I8 byte count is ${input.length}; expected ${expectedBytes}.`);
  }
  return Object.freeze({ flags, width, height, stride, dataBytes, serializedBytes: input.length });
}

/**
 * Convert one or more serialized Input I8 files into immutable native
 * lv_image_dsc_t records followed by their palette/index data.
 *
 * The returned buffer is an asset bank only. It does not modify an ESP image.
 */
export function buildNativeLvglI8SpriteBank(frames, { baseAddress }) {
  if (!Array.isArray(frames) || frames.length === 0) throw new Error("At least one I8 frame is required.");
  if (!Number.isInteger(baseAddress) || baseAddress <= 0 || (baseAddress & 3) !== 0) {
    throw new Error("Sprite-bank DROM base address must be a positive, 4-byte-aligned integer.");
  }

  const parsed = frames.map((frame) => ({
    bytes: asBuffer(frame, "Sprite frame"),
    info: parseSerializedLvglI8(frame),
  }));
  const descriptorTableBytes = frames.length * LVGL_IMAGE.nativeDescriptorBytes;
  let cursor = align4(descriptorTableBytes);
  const placements = parsed.map(({ info }) => {
    const placement = { dataOffset: cursor, dataAddress: baseAddress + cursor, dataBytes: info.dataBytes };
    cursor = align4(cursor + info.dataBytes);
    return placement;
  });

  const bank = Buffer.alloc(cursor);
  const descriptors = [];
  for (let index = 0; index < parsed.length; index += 1) {
    const { bytes, info } = parsed[index];
    const placement = placements[index];
    const descriptorOffset = index * LVGL_IMAGE.nativeDescriptorBytes;
    bytes.copy(bank, descriptorOffset, 0, LVGL_IMAGE.serializedHeaderBytes);
    bank.writeUInt32LE(info.dataBytes, descriptorOffset + 12);
    bank.writeUInt32LE(placement.dataAddress >>> 0, descriptorOffset + 16);
    bank.writeUInt32LE(0, descriptorOffset + 20);
    bytes.copy(bank, placement.dataOffset, LVGL_IMAGE.serializedHeaderBytes);
    descriptors.push(Object.freeze({
      index,
      descriptorOffset,
      descriptorAddress: baseAddress + descriptorOffset,
      ...placement,
      width: info.width,
      height: info.height,
      stride: info.stride,
    }));
  }
  return Object.freeze({ bank, descriptors: Object.freeze(descriptors), descriptorTableBytes });
}

/** Pad a DROM asset bank so later flash-mapped IROM keeps 64-KiB congruence. */
export function padSpriteBankForMappedDrom(bank, pageBytes = FRAMER_SPRITE_LAYOUT.flashMappingPageBytes) {
  const input = asBuffer(bank, "Sprite bank");
  if (!Number.isInteger(pageBytes) || pageBytes <= 0 || (pageBytes & (pageBytes - 1)) !== 0) {
    throw new Error("Flash mapping page size must be a positive power of two.");
  }
  const paddedBytes = Math.ceil(input.length / pageBytes) * pageBytes;
  const output = Buffer.alloc(paddedBytes);
  input.copy(output);
  return output;
}

/** Check that the stock 0.4.1 image still matches the reviewed helper windows. */
export function auditFramerImagePipeline(appImage) {
  const info = inspectEsp32AppImage(asBuffer(appImage, "Framer app image"));
  for (const window of PINNED_WINDOWS) {
    const expected = Buffer.from(window.hex, "hex");
    if (!readVirtual(info, window.address, expected.length).equals(expected)) {
      throw new Error(`Framer image pipeline changed at ${window.name}.`);
    }
  }
  const drom = info.segments.find((segment) => segment.loadAddress === FRAMER_SPRITE_LAYOUT.dromLoadAddress);
  if (!drom || drom.loadAddress + drom.length !== FRAMER_SPRITE_LAYOUT.stockDromEndAddress) {
    throw new Error("Framer 0.4.1 DROM boundary changed.");
  }
  return Object.freeze({
    dromEndAddress: drom.loadAddress + drom.length,
    pinnedWindows: PINNED_WINDOWS.length,
    currentControllerPath: Object.freeze({
      root: FRAMER_IMAGE_PIPELINE.rootSingletonAddress,
      registryOffset: 80,
      currentControllerOffset: 12,
    }),
  });
}
