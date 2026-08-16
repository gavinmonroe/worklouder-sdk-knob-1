import path from "node:path";
import { fileURLToPath } from "node:url";

export const SDK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const WORKSPACE_ROOT = path.resolve(SDK_ROOT, "..");

export const PINNED = Object.freeze({
  target: "framer-f1",
  firmware: "0.4.1",
  logicalCanvas: Object.freeze({ width: 100, height: 310 }),
  physicalDisplay: Object.freeze({ width: 310, height: 100, orientation: "marketed-landscape" }),
  screen: Object.freeze({ width: 100, height: 310, id: 7 }),
  officialMerged: Object.freeze({
    path: path.join(WORKSPACE_ROOT, "artifacts/firmware/firmware_0.4.1_merged.bin"),
    sha256: "c8926bd181bc06062d8c79221c6bb1c7f85463f0034444f263e1995cb383b976",
  }),
  stage3c1Abi: Object.freeze({
    path: path.join(WORKSPACE_ROOT, "custom-firmware/experimental/stage3c1-wpm-labels.hex"),
    fileSha256: "f5d4d5949c6457123ee4f2adb04169c4d784e11daf4b94d581a3a55c4284ce33",
    appSha256: "e2e7ba4ab4b9c247af8c0bdc3d7896ac52967bb7f90fb19beae73c0ae4a2b8fd",
  }),
  converter: Object.freeze({
    package: "@worklouder/wl-device-kit",
    version: "0.1.28",
    packageJsonSha256: "79dd3a9f4329dfa9d948ddd317916bb63dbe7374109c712f6a923ac19788a280",
    indexSha256: "b4b07e86c0dd1ca02dfd6aa51560266fac38710e37481f52c5256b904603cf83",
    wasmSha256: "efaa8e14650d267a481347f81aebcad15cf0fb54c57679ed0c83da8f416454f3",
  }),
  toolchainDirectory: path.join(WORKSPACE_ROOT, ".toolchains/xtensa-esp-elf-13.2.0_20240530/bin"),
  toolchain: Object.freeze({
    as: "9f39c9567d0dfcad06ba6494a4ff4908af5013582f46b62e50ff65cf48a5b2e7",
    ld: "aed61403fbf20cc3213bdacfa46581717264d95056c716f38beb70e06d6a0b15",
    objcopy: "c714dedbfd6d3cc9bb2faf8a1b934fb5ccd468f1130bd260ce460f06bd9a577c",
    objdump: "2dd50e8e742bcb321606606dc6173f59e5395a1bf0c0c5c05e88202af064b63b",
    readelf: "8a1546ccfa84d94783388acf903ccca5fc0fe2091ae18a56685bed5d3cc5b3a7",
    nm: "1f229e465d5718d694334fd420e7e7c25d5617ee2710a6329c71f922fb2d9627",
  }),
  appFlashOffset: 0x10000,
  factoryPartitionBytes: 0x800000,
  segmentCount: 6,
  dromSegmentIndex: 0,
  iromSegmentIndex: 3,
  dromLoadAddress: 0x3c120020,
  stockDromEndAddress: 0x3c1c1190,
  iromLoadAddress: 0x42000020,
  codeBaseAddress: 0x42116f10,
  flashMappingPageBytes: 0x10000,
  setupPointerAppOffset: 0x8c194,
  setupPointerExpected: 0x42116da4,
  keyCallbackAppOffset: 0xf1568,
  keyCallbackExpected: 0x4206eae0,
  wpmTickAppOffset: 0x90634,
  wpmTickExpected: 0x4206ed14,
  timerGetterAppOffset: 0xb1f18,
  timerGetterExpected: 0x421084f4,
  entrySymbol: "f1_widget_screen_setup_wrapper",
  nativeWpmAddress: 0x3fcaba20,
  forbiddenAddresses: Object.freeze([
    0x42003dc8,
    0x3fca4f00,
    0x42004f10,
    0x4201a930,
    0x3fcab378,
  ]),
});

export const ALLOWED_RUNTIME_ADDRESSES = Object.freeze(new Set([
  0x4202c108, 0x42004e1c, 0x4210ad9c, 0x42006888,
  0x420e7c04, 0x400011e8, 0x3c1acc34, 0x4204da84, 0x420293a8,
  0x4204d5dc, 0x4204d694, 0x4210882c, 0x4204d6d0,
  0x42108834, 0x4210883c, 0x42108844,
  0x420ae8a0, 0x420aeef0, 0x4204f0d0,
  0x4204f170, 0x4204f018, 0x4204ee30, 0x4204ef44,
  0x3c18e960, 0x3c18ceac, 0x420f896c, PINNED.nativeWpmAddress,
  0x4200c4c0, 0x4210bfac,
]));

export const SDK_FORMAT = "framer-f1-research-widget-sdk-v1";
