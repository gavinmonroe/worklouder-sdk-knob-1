import { inspectEsp32AppImage } from "./esp-app-image.mjs";

export const FRAMER_SCREEN_AUDIT = Object.freeze({
  iromLoadAddress: 0x42000020,
  dromLoadAddress: 0x3c120020,
  controllerBaseVtableMethod: 0x4204d5dc,
  addController: 0x4204da84,
  addNavigationId: 0x420293a8,
  screenManagerGetter: 0x42006888,
  screenIdSetter: 0x4210af1c,
  currentControllerGetter: 0x4210af48,
  centralSetupEntry: 0x4202bcc0,
  screenSetupVtablePointer: Object.freeze({
    virtualAddress: 0x3c1ac194,
    expectedValue: 0x4202c108,
  }),
  setupHookWindow: Object.freeze({
    start: 0x4202c10b,
    endExclusive: 0x4202c120,
    expectedHex: "20a220259aff20a220a5baff20a220e581ffe53cdb",
  }),
  wpmCurrentAddress: 0x3fcaba20,
  wpmRecordAddress: 0x3fcae930,
  wpmKeyCallbackLiteral: Object.freeze({
    virtualAddress: 0x42041568,
    expectedValue: 0x4206eae0,
  }),
  wpmTickVtablePointer: Object.freeze({
    virtualAddress: 0x3c1b0634,
    expectedValue: 0x4206ed14,
  }),
  controllerLifecycleWindows: Object.freeze([
    Object.freeze({
      name: "lazy-root construction",
      start: 0x4210af04,
      expectedHex: "364100820204cc788802ad028808e0080028221df0",
    }),
    Object.freeze({
      name: "LVGL timer slot-6 dispatch",
      start: 0x4204d680,
      expectedHex: "364100a8329173cc880a8868971802e008001df0",
    }),
    Object.freeze({
      name: "activation and 100-ms timer setup",
      start: 0x4204d694,
      expectedHex: "364100a170ccb2a064cd02a5d45d9802b16ecc8839a942b7180720a220e00800980282021ab628040b8882421988699164cc971804ad02e008001df0",
    }),
    Object.freeze({
      name: "deactivation and timer teardown",
      start: 0x4204d6d0,
      expectedHex: "36410088029162cc8848971804ad02e00800a84225d65d1df0",
    }),
    Object.freeze({
      name: "LVGL screen-event lifecycle dispatch",
      start: 0x4204d6ec,
      expectedHex: "364100ad0225105c8d0aad022d08815bcce008002ca87d0a8712092cb8871213460e000000880a8828e008000c18824704060a00880a0c0b9858a14fccb24704a799148848914bcc971804ad07e00800a847a5d05d060100ad07e009001df0",
    }),
    Object.freeze({
      name: "screen transition and slot-1 dispatch",
      start: 0x4204d8d4,
      expectedHex: "36410030307430b32020a22025f9ffa07a20bc7a8802a8328033a03803371a2c8c8a880a8888e00800a24318880391e2cb88183932971804ad03e00800d2a000e2a001d0cd20bd0dad07e513551d",
    }),
  ]),
  navigationMutationWindows: Object.freeze([
    Object.freeze({
      name: "append navigation ID and enable it",
      start: 0x420293a8,
      expectedHex: "36610032610010b120a2c224e5beff10b120a2c230a5dfff0c18824a001df0",
    }),
    Object.freeze({
      name: "dial reads navigation vectors dynamically",
      start: 0x4202924c,
      expectedHex: "88a298929088c08082210b889180638909060600000098a2a892a099c09092210b9987b9078179630c09926800817763b808889280bba0a2c23025f3ff820a0016d8fa817263880898929088a0b20800ad0781585ce008000c1882427d46",
    }),
  ]),
  navigationRegistrationSites: Object.freeze([
    Object.freeze({ virtualAddress: 0x4202bfd6, id: 8 }),
    Object.freeze({ virtualAddress: 0x4202bfdd, id: 22 }),
    Object.freeze({ virtualAddress: 0x4202bfe4, id: 16 }),
    Object.freeze({ virtualAddress: 0x4202bfeb, id: 17 }),
    Object.freeze({ virtualAddress: 0x4202bff2, id: 3 }),
    Object.freeze({ virtualAddress: 0x4202bff9, id: 15 }),
    Object.freeze({ virtualAddress: 0x4202c000, id: 14 }),
    Object.freeze({ virtualAddress: 0x4202c007, id: 19 }),
    Object.freeze({ virtualAddress: 0x4202c00e, id: 18 }),
  ]),
});

function findSegment(info, virtualAddress, length) {
  const segment = info.segments.find(
    (candidate) => virtualAddress >= candidate.loadAddress &&
      virtualAddress + length <= candidate.loadAddress + candidate.length,
  );
  if (!segment) {
    throw new Error(`Virtual range 0x${virtualAddress.toString(16)}..0x${(virtualAddress + length).toString(16)} is unmapped.`);
  }
  return segment;
}

function readVirtual(info, virtualAddress, length) {
  const segment = findSegment(info, virtualAddress, length);
  const offset = virtualAddress - segment.loadAddress;
  return segment.data.subarray(offset, offset + length);
}

function readU32(info, virtualAddress) {
  return readVirtual(info, virtualAddress, 4).readUInt32LE(0);
}

function decodeConstantScreenId(info, functionAddress) {
  const bytes = readVirtual(info, functionAddress, 7);
  if (bytes.subarray(0, 3).toString("hex") !== "364100" ||
      bytes.subarray(5, 7).toString("hex") !== "1df0" ||
      ![0x0c, 0x1c].includes(bytes[3]) || (bytes[4] & 0x0f) !== 2) {
    throw new Error(`Screen-ID method 0x${functionAddress.toString(16)} is not the reviewed constant-return ABI.`);
  }
  return (bytes[4] >>> 4) + (bytes[3] === 0x1c ? 16 : 0);
}

function decodeMovenImmediate(bytes, registerNibble) {
  if (bytes.length < 2 || ![0x0c, 0x1c].includes(bytes[0]) || (bytes[1] & 0x0f) !== registerNibble) {
    throw new Error("Expected a reviewed Xtensa movi.n instruction.");
  }
  return (bytes[1] >>> 4) + (bytes[0] === 0x1c ? 16 : 0);
}

function decodeCall8Target(bytes, virtualAddress) {
  const raw = bytes[0] | (bytes[1] << 8) | (bytes[2] << 16);
  if ((raw & 0x3f) !== 0x25) throw new Error("Expected a reviewed Xtensa call8 instruction.");
  let immediate = raw >>> 6;
  if (immediate & 0x20000) immediate -= 0x40000;
  return (((virtualAddress & ~3) + 4 + immediate * 4) >>> 0);
}

function findControllerVtables(info) {
  const drom = findSegment(info, FRAMER_SCREEN_AUDIT.dromLoadAddress, 1);
  const signature = Buffer.alloc(4);
  signature.writeUInt32LE(FRAMER_SCREEN_AUDIT.controllerBaseVtableMethod);
  const controllers = [];
  for (let offset = 0; offset + 44 <= drom.data.length; offset += 4) {
    if (!drom.data.subarray(offset, offset + 4).equals(signature)) continue;
    const vtableAddress = drom.loadAddress + offset;
    const idMethod = drom.data.readUInt32LE(offset + 32);
    if (idMethod === 0) continue;
    controllers.push({
      vtableAddress,
      idMethod,
      id: decodeConstantScreenId(info, idMethod),
      methods: Array.from({ length: 11 }, (_, index) => drom.data.readUInt32LE(offset + index * 4)),
    });
  }
  return controllers;
}

function auditNavigationRegistrations(info) {
  return FRAMER_SCREEN_AUDIT.navigationRegistrationSites.map(({ virtualAddress, id }) => {
    const bytes = readVirtual(info, virtualAddress, 7);
    const decodedId = decodeMovenImmediate(bytes.subarray(0, 2), 0x0b);
    if (decodedId !== id || bytes.subarray(2, 4).toString("hex") !== "ad06") {
      throw new Error(`Navigation registration at 0x${virtualAddress.toString(16)} changed.`);
    }
    const callTarget = decodeCall8Target(bytes.subarray(4, 7), virtualAddress + 4);
    if (callTarget !== FRAMER_SCREEN_AUDIT.addNavigationId) {
      throw new Error(`Navigation registration at 0x${virtualAddress.toString(16)} calls 0x${callTarget.toString(16)}.`);
    }
    return id;
  });
}

export function auditFramerScreenRegistry(appImage) {
  const info = inspectEsp32AppImage(appImage);
  const irom = info.segments.find((segment) => segment.loadAddress === FRAMER_SCREEN_AUDIT.iromLoadAddress);
  const drom = info.segments.find((segment) => segment.loadAddress === FRAMER_SCREEN_AUDIT.dromLoadAddress);
  if (!irom || !drom) throw new Error("Framer 0.4.1 IROM/DROM segments were not found.");

  const setupEntry = readVirtual(info, FRAMER_SCREEN_AUDIT.centralSetupEntry, 3).toString("hex");
  if (setupEntry !== "36a100") throw new Error("Central screen setup entry changed.");
  const hookWindow = FRAMER_SCREEN_AUDIT.setupHookWindow;
  if (readVirtual(info, hookWindow.start, hookWindow.endExclusive - hookWindow.start).toString("hex") !== hookWindow.expectedHex) {
    throw new Error("Reviewed screen-setup hook window changed.");
  }
  if (readU32(info, FRAMER_SCREEN_AUDIT.wpmKeyCallbackLiteral.virtualAddress) !==
      FRAMER_SCREEN_AUDIT.wpmKeyCallbackLiteral.expectedValue) {
    throw new Error("Native WPM key callback literal changed.");
  }
  if (readU32(info, FRAMER_SCREEN_AUDIT.wpmTickVtablePointer.virtualAddress) !==
      FRAMER_SCREEN_AUDIT.wpmTickVtablePointer.expectedValue) {
    throw new Error("Native WPM tick vtable pointer changed.");
  }
  if (readU32(info, FRAMER_SCREEN_AUDIT.screenSetupVtablePointer.virtualAddress) !==
      FRAMER_SCREEN_AUDIT.screenSetupVtablePointer.expectedValue) {
    throw new Error("Central screen-setup vtable pointer changed.");
  }
  for (const window of FRAMER_SCREEN_AUDIT.controllerLifecycleWindows) {
    const length = window.expectedHex.length / 2;
    if (readVirtual(info, window.start, length).toString("hex") !== window.expectedHex) {
      throw new Error(`Controller lifecycle window changed: ${window.name}.`);
    }
  }
  for (const window of FRAMER_SCREEN_AUDIT.navigationMutationWindows) {
    const length = window.expectedHex.length / 2;
    if (readVirtual(info, window.start, length).toString("hex") !== window.expectedHex) {
      throw new Error(`Navigation mutation window changed: ${window.name}.`);
    }
  }

  const controllers = findControllerVtables(info);
  const controllerIds = controllers.map(({ id }) => id).sort((left, right) => left - right);
  const unusedIds = Array.from({ length: 26 }, (_, id) => id).filter((id) => !controllerIds.includes(id));
  const navigationIds = auditNavigationRegistrations(info);
  return {
    segmentCount: info.segmentCount,
    irom: {
      index: irom.index,
      loadAddress: irom.loadAddress,
      dataOffset: irom.dataOffset,
      length: irom.length,
      endAddress: irom.loadAddress + irom.length,
    },
    drom: {
      index: drom.index,
      loadAddress: drom.loadAddress,
      dataOffset: drom.dataOffset,
      length: drom.length,
    },
    controllers,
    controllerIds,
    unusedIds,
    navigationIds,
    recommendedWpmScreenId: 7,
    controllerLifecycleWindows: FRAMER_SCREEN_AUDIT.controllerLifecycleWindows.map(({ name, start, expectedHex }) => ({
      name,
      start,
      length: expectedHex.length / 2,
    })),
    navigationMutationWindows: FRAMER_SCREEN_AUDIT.navigationMutationWindows.map(({ name, start, expectedHex }) => ({
      name,
      start,
      length: expectedHex.length / 2,
    })),
    managerLayout: {
      currentControllerOffset: 12,
      selectedScreenIdOffset: 24,
      registryOffset: 32,
    },
  };
}
