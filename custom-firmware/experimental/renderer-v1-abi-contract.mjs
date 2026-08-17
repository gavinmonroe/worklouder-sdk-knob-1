import { inspectEsp32AppImage } from "../lib/esp-app-image.mjs";
import { RENDERER_V1, RENDERER_V1_RASTER } from "../lib/renderer-v1-runtime.mjs";

export const RENDERER_V1_SCREEN_ID = 26;

export const RENDERER_V1_PROVEN_ABI = Object.freeze({
  addController: 0x4204da84,
  addControllerWindowHex: "3641001693058803ad038888e00800981288027d0a80c9c0c0c221c73a3a1bbab7bc15c0bbc020a22065efff8802c81280ccc0c0c221060400c7bb1080aba0e0bb11a71907a912b0c221c7370ba174cb70b7208174cbe008008077a0390729531df0",
  addNavigationId: 0x420293a8,
  addNavigationWindowHex: "36610032610010b120a2c224e5beff10b120a2c230a5dfff0c18824a001df0",
  navigationU32Append: 0x42028fa4,
  navigationU32AppendWindowHex: "364100b8128822871b0d8803890b88124b8889124602000030c32020a220e5f5ff900000",
  navigationU32Lookup: 0x420291b8,
  navigationU32LookupWindowHex: "366100bd03ad026511ff4b82bd0aa718069803884a87a90f3911ed01d2c104c1bb5e20a22065f9ff22ca141df0",
  imageCreate: 0x420ae8a0,
  imageSetSource: 0x420aeef0,
  objectAlign: 0x4204f0d0,
  inputSingletonGetter: 0x4200c4c0,
  fnPressedGetter: 0x4210bfac,
  slot6TimerDispatch: 0x4204d680,
  slot9EncoderAbi: Object.freeze({ bottomEncoderId: 1, deltaBits: 8 }),
  nativeCandidate: Object.freeze({
    source: "custom-firmware/experimental/renderer-v1-id26.c",
    registrationSymbol: "renderer_v1_register_id26",
    stageBundleSymbol: "renderer_v1_stage_bundle",
    prepareStoreSymbol: "renderer_v1_prepare_store",
    allocationBytes: 62_164,
    f1wbCapBytes: 98_304,
    provisionalAddress: 0x42119000,
    provisionalBytes: 8_140,
    provisionalSha256: "942fe3aeb723c24a9d66b2d8b0dfe6fffa04c6ff13c75777daf226456dbbe806",
  }),
  descriptor: RENDERER_V1.descriptor,
});

function readVirtual(info, address, length) {
  const segment = info.segments.find(({ loadAddress, length: bytes }) =>
    address >= loadAddress && address + length <= loadAddress + bytes);
  if (!segment) throw new Error(`Renderer ABI address 0x${address.toString(16)} is unmapped.`);
  return segment.data.subarray(address - segment.loadAddress, address - segment.loadAddress + length);
}

export function auditRendererV1Abi(appImage) {
  const info = inspectEsp32AppImage(appImage);
  for (const [name, address, expectedHex] of [
    ["addController", RENDERER_V1_PROVEN_ABI.addController, RENDERER_V1_PROVEN_ABI.addControllerWindowHex],
    ["addNavigationId", RENDERER_V1_PROVEN_ABI.addNavigationId, RENDERER_V1_PROVEN_ABI.addNavigationWindowHex],
    ["navigationU32Append", RENDERER_V1_PROVEN_ABI.navigationU32Append,
      RENDERER_V1_PROVEN_ABI.navigationU32AppendWindowHex],
    ["navigationU32Lookup", RENDERER_V1_PROVEN_ABI.navigationU32Lookup,
      RENDERER_V1_PROVEN_ABI.navigationU32LookupWindowHex],
  ]) {
    const actual = readVirtual(info, address, expectedHex.length / 2).toString("hex");
    if (actual !== expectedHex) throw new Error(`Renderer ${name} ABI window changed.`);
  }
  return Object.freeze({
    screenId: RENDERER_V1_SCREEN_ID,
    id26Evidence: "addController grows its pointer vector to slot8-id+1; navigation appends and compares the supplied ID as an untruncated u32",
    framebufferBytes: RENDERER_V1.framebufferBytes,
    memoryBudget: Object.freeze({
      framebufferRam: RENDERER_V1_RASTER.runtimePixelBytes,
      descriptorRam: RENDERER_V1_RASTER.runtimeDescriptorBytes,
      decoderScratchRam: 0,
      nativeControllerAllocation: RENDERER_V1_PROVEN_ABI.nativeCandidate.allocationBytes,
      admittedBundleBytes: RENDERER_V1_PROVEN_ABI.nativeCandidate.f1wbCapBytes,
      maximumThreeSlotFlash: RENDERER_V1_RASTER.maxThreeSlotFlashBytes,
    }),
    staticReady: true,
    liveReady: false,
    blockers: Object.freeze([
      "The repeated one-store freeze/detach handshake is statically and host-native proven but still needs live active/off-screen acceptance.",
      "A contiguous 62164-byte renderer allocation plus Music/WPM/transport heap pressure has not been proven on live hardware or pinned to PSRAM.",
      "The candidate must be relinked after the exact live b9b8 Music/WPM slices; its provisional addresses are not raw-copy deployment addresses.",
      "ID26 and mutable RGB565 descriptor refresh are strongly supported statically but have not passed a live canary.",
    ]),
  });
}
