#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { decodeRasterAnimation } from "../../f1-widget-sdk/src/render/raster-animation.mjs";
import { decodeWidgetBundle } from "../../f1-widget-sdk/src/render/widget-bundle.mjs";
import { decodeRenderV2MQuickJsPackage } from "../../f1-widget-sdk/src/render-v2/mquickjs.mjs";
import {
  buildWeatherTargetFacadeAsset, crc32, decodeTargetFacadeAsset, packTemperatureAscii,
  renderTargetFacadeHost, TARGET_FACADE_CONTRACT_SHA256, TARGET_FACADE_CONTRACT_V2_SHA256,
  TARGET_FACADE_CONTRACT_V3_SHA256, TARGET_FACADE_CONTRACT_V4_SHA256,
  TARGET_FACADE_CONTRACT_V5_SHA256,
  TARGET_FACADE_HEADER_BYTES, TARGET_FACADE_MAX_ASSET_BYTES,
  TARGET_FACADE_RESULT, WEATHER_TARGET_FACADE_TARGETS,
} from "./contract.mjs";

const execute = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(here, "../..");
const output = path.join(here, "build");
const packagePath = path.join(repository,
  "f1-widget-sdk/examples/render-v2-mquickjs-weather-canary/build/weather-60601.f2js");
const toolchain = process.env.FRAMER_XTENSA_BIN ?? path.join(repository,
  ".toolchains/xtensa-esp-elf-13.2.0_20240530/bin");
const xtensa = (name) => path.join(toolchain, `xtensa-esp32s3-elf-${name}`);
const cc = process.env.CC ?? "cc";
const run = (command, args, options = {}) => execute(command, args,
  { maxBuffer: 32 * 1024 * 1024, ...options });
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const invariant = (value, message) => { if (!value) throw new Error(message); };

function rawFrame(frame) {
  const bytes = Buffer.alloc(frame.length * 2);
  frame.forEach((color, index) => bytes.writeUInt16LE(color, index * 2));
  return bytes;
}

function weatherSlots({ revision = 0, current = 0, currentMeta = 0,
  days = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], age = 0, freshness = 0,
  retry = 0, flags = 0 } = {}) {
  return [revision, packTemperatureAscii(current), currentMeta,
    days[0][0], packTemperatureAscii(days[0][1]), packTemperatureAscii(days[0][2]),
    days[1][0], packTemperatureAscii(days[1][1]), packTemperatureAscii(days[1][2]),
    days[2][0], packTemperatureAscii(days[2][1]), packTemperatureAscii(days[2][2]),
    age, freshness, retry, flags];
}

function encodeCases(cases) {
  const binary = Buffer.alloc(8 + cases.length * 72); binary.write("TFCS", 0, "ascii");
  binary.writeUInt32LE(cases.length, 4);
  cases.forEach((entry, index) => {
    const at = 8 + index * 72; binary.writeUInt32LE(entry.sequence, at);
    entry.slots.forEach((value, slot) => binary.writeInt32LE(value, at + 4 + slot * 4));
    binary.writeUInt32LE(entry.admittedGeneration, at + 68);
  });
  return binary;
}

function sectionBytes(text, prefix) {
  return [...text.matchAll(/^\s*\d+\s+(\.[^\s]+)\s+([0-9a-f]+)/gmu)]
    .filter((match) => match[1] === prefix || match[1].startsWith(`${prefix}.`))
    .reduce((sum, match) => sum + Number.parseInt(match[2], 16), 0);
}

await mkdir(output, { recursive: true });
const temporary = await mkdtemp(path.join(os.tmpdir(), "mquickjs-target-facade-"));
try {
  const f2js = await readFile(packagePath);
  const decodedPackage = decodeRenderV2MQuickJsPackage(f2js);
  invariant(decodedPackage.generation === 18, "Weather fixture is no longer generation 18.");
  invariant(decodedPackage.targets.map(({ id }) => id).join("\0") ===
    WEATHER_TARGET_FACADE_TARGETS.map(({ id }) => id).join("\0"),
  "Companion target IDs no longer exactly match F2JS declarations.");
  const bundle = decodeWidgetBundle(decodedPackage.rasterBase);
  const base = decodeRasterAnimation(bundle.slots[0].animationBinary).frames[0];
  const asset = buildWeatherTargetFacadeAsset({ generation: 18, baseFrame: base, f2jsBinary: f2js });
  const decoded = decodeTargetFacadeAsset(asset.binary, { expectedGeneration: 18,
    expectedF2jsSha256: asset.f2jsSha256, baseFrame: base });

  const negative = weatherSlots({ revision: 7, current: -12, currentMeta: 21,
    days: [[50, -18, 7], [59, -3, 0], [4, 100, 111]], freshness: 1, flags: 1 });
  const positive = weatherSlots({ revision: 8, current: 45, currentMeta: 21,
    days: [[50, 34, 43], [59, 36, 46], [4, 38, 49]], freshness: 1, flags: 1 });
  const cases = [
    { name: "offline-no-snapshot", sequence: 2, admittedGeneration: 18,
      slots: weatherSlots({ freshness: 4, retry: 30, flags: 4 }) },
    { name: "negative-temperatures", sequence: 4, admittedGeneration: 18, slots: negative },
    { name: "stale-tick-same-revision", sequence: 6, admittedGeneration: 18,
      slots: negative.map((value, index) => index === 12 ? 1801 : index === 13 ? 2 : value) },
    { name: "error-last-good", sequence: 8, admittedGeneration: 18,
      slots: negative.map((value, index) => index === 13 ? 3 : index === 14 ? 12 : index === 15 ? 5 : value) },
    { name: "hidden", sequence: 10, admittedGeneration: 18,
      slots: negative.map((value, index) => index === 15 ? 3 : value) },
    { name: "newer-revision", sequence: 12, admittedGeneration: 18, slots: positive },
    { name: "revision-rollback", sequence: 14, admittedGeneration: 18,
      slots: positive.map((value, index) => index === 0 ? 6 : value) },
    { name: "wrong-generation", sequence: 16, admittedGeneration: 17, slots: positive },
    { name: "malformed-packed-ascii", sequence: 18, admittedGeneration: 18,
      slots: positive.map((value, index) => index === 1 ? 0x41414141 : value) },
    { name: "malformed-condition", sequence: 20, admittedGeneration: 18,
      slots: positive.map((value, index) => index === 2 ? 24 : value) },
    { name: "odd-torn-mailbox", sequence: 21, admittedGeneration: 18, slots: positive },
  ];
  const state = { lastAppliedRevision: 0 };
  const host = cases.map((mailbox) => renderTargetFacadeHost({ decoded, baseFrame: base, mailbox, state }));
  const expectedResults = [0, 0, 0, 0, 1, 0, 9, 8, 10, 10, 7];
  invariant(host.map(({ result }) => result).join() === expectedResults.join(),
    `Host result sequence changed: ${host.map(({ result }) => result)}.`);
  const casesBinary = encodeCases(cases);
  const hostFrames = Buffer.concat(host.map(({ frame }) => rawFrame(frame)));

  await Promise.all([
    writeFile(path.join(output, "weather-gen18.f2tf"), asset.binary),
    writeFile(path.join(output, "weather-gen18-base.rgb565le"), asset.baseBytes),
    writeFile(path.join(output, "weather-cases.bin"), casesBinary),
  ]);
  const native = path.join(temporary, "host-harness");
  await run(cc, ["-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", "-pedantic",
    path.join(here, "target_facade.c"), path.join(here, "host_harness.c"), "-o", native]);
  const cFramesPath = path.join(temporary, "c-frames.bin");
  const nativeOutput = JSON.parse((await run(native, [path.join(output, "weather-gen18.f2tf"),
    path.join(output, "weather-gen18-base.rgb565le"), path.join(output, "weather-cases.bin"),
    cFramesPath, asset.f2jsSha256, TARGET_FACADE_CONTRACT_SHA256])).stdout);
  const cFrames = await readFile(cFramesPath);
  invariant(cFrames.equals(hostFrames), "Host and freestanding C RGB565 frames differ.");
  invariant(nativeOutput.results.map(({ result }) => result).join() === expectedResults.join(),
    "C result sequence differs from the host oracle.");

  /* ---- contract v2: formatter 11 (variantText) through the same C binary ----
   * The variant asset reuses the weather header, first twelve targets, palette,
   * glyph, and literal sections verbatim; the d3 row and retry become four
   * variantText targets whose tables append after the weather literals, and the
   * embedded contract identity moves to v2. Slots 9, 10, 11, and 14 are only
   * referenced by the replaced targets, so the surviving weather formatters
   * keep their exact live semantics in every mixed case. */
  const variantTable = (strings) => Buffer.concat([Buffer.from([strings.length]),
    ...strings.map((text) => Buffer.concat([Buffer.from([text.length]),
      Buffer.from(text, "ascii")]))]);
  const variantTables = [
    variantTable(["OFF", "ON", "AUTO"]),
    variantTable(Array.from({ length: 16 }, (_, index) => `V${index}`)),
    variantTable(["SOLO"]),
    variantTable(["ZERO", "ONE", "TWO", "THREE", "FOUR"]),
  ];
  const variantRecord = ({ id, x, y, width, height, properties, slots, palette0,
    palette1, align, maxChars, table }) => {
    const record = Buffer.alloc(40);
    record.write(id, 0, "ascii");
    record.writeUInt16LE(x, 16); record.writeUInt16LE(y, 18);
    record.writeUInt16LE(width, 20); record.writeUInt16LE(height, 22);
    record[24] = properties; record[25] = 11;
    [...slots, 0xff, 0xff, 0xff, 0xff].slice(0, 4)
      .forEach((slot, index) => { record[26 + index] = slot; });
    record[30] = palette0; record[31] = palette1; record[33] = align;
    record[34] = maxChars; record[35] = 1;
    record.writeUInt16LE(decoded.header.literalBytes +
      variantTables.slice(0, table).reduce((sum, value) => sum + value.length, 0), 36);
    record[38] = variantTables[table].length;
    return record;
  };
  const variantAsset = Buffer.concat([
    asset.binary.subarray(0, decoded.header.targetsAt + 12 * 40),
    variantRecord({ id: "variantA", x: 12, y: 248, width: 60, height: 9, properties: 1,
      slots: [9], palette0: 2, palette1: 0, align: 0, maxChars: 8, table: 0 }),
    variantRecord({ id: "variantB", x: 12, y: 260, width: 76, height: 9, properties: 3,
      slots: [10, 11], palette0: 0, palette1: 1, align: 1, maxChars: 10, table: 1 }),
    variantRecord({ id: "variantC", x: 43, y: 252, width: 45, height: 10, properties: 3,
      slots: [14], palette0: 4, palette1: 0, align: 2, maxChars: 6, table: 2 }),
    variantRecord({ id: "variantD", x: 8, y: 296, width: 84, height: 9, properties: 3,
      slots: [9, 14], palette0: 3, palette1: 2, align: 1, maxChars: 12, table: 3 }),
    asset.binary.subarray(decoded.header.paletteAt),
    ...variantTables,
  ]);
  variantAsset.writeUInt32LE(variantAsset.length, 8);
  variantAsset.writeUInt32LE(decoded.header.literalBytes +
    variantTables.reduce((sum, value) => sum + value.length, 0), 64);
  Buffer.from(TARGET_FACADE_CONTRACT_V2_SHA256, "hex").copy(variantAsset, 160);
  variantAsset.writeUInt32LE(crc32(variantAsset.subarray(TARGET_FACADE_HEADER_BYTES)), 72);
  variantAsset.writeUInt32LE(crc32(variantAsset.subarray(0, TARGET_FACADE_HEADER_BYTES),
    { zeroFrom: 76, zeroBytes: 4 }), 76);
  const decodedVariant = decodeTargetFacadeAsset(variantAsset, { expectedGeneration: 18,
    expectedF2jsSha256: asset.f2jsSha256,
    expectedContractSha256: TARGET_FACADE_CONTRACT_V2_SHA256, baseFrame: base });
  let hostRejectsV1 = false;
  try {
    decodeTargetFacadeAsset(variantAsset, { expectedGeneration: 18,
      expectedF2jsSha256: asset.f2jsSha256 });
  } catch { hostRejectsV1 = true; }
  invariant(hostRejectsV1, "variantText asset must not decode under the frozen v1 contract sha.");

  const variantSlots = ({ revision, flags = 1, v9 = 0, v10 = 0, v11 = 0, v14 = 0 }) => {
    const slots = weatherSlots({ revision, current: 45, currentMeta: 21,
      days: [[50, 34, 43], [59, 36, 46], [0, 0, 0]], age: 120, freshness: 1, flags });
    slots[9] = v9; slots[10] = v10; slots[11] = v11; slots[14] = v14;
    return slots;
  };
  const variantCases = [
    { name: "variant-first-entries", sequence: 2, admittedGeneration: 18,
      slots: variantSlots({ revision: 2 }) },
    { name: "variant-selection-and-colour", sequence: 4, admittedGeneration: 18,
      slots: variantSlots({ revision: 4, v9: 2, v10: 7, v11: 3, v14: 5 }) },
    { name: "variant-clamp-negative", sequence: 6, admittedGeneration: 18,
      slots: variantSlots({ revision: 6, v9: -5, v10: -2147483648, v11: -1, v14: -7 }) },
    { name: "variant-clamp-past-end", sequence: 8, admittedGeneration: 18,
      slots: variantSlots({ revision: 8, v9: 99, v10: 2147483647, v11: 200, v14: 1000 }) },
    { name: "variant-ignores-flags-word", sequence: 10, admittedGeneration: 18,
      slots: variantSlots({ revision: 10, flags: 0, v9: 2, v10: 7, v11: 3, v14: 5 }) },
    { name: "variant-hidden-root", sequence: 12, admittedGeneration: 18,
      slots: variantSlots({ revision: 12, flags: 3, v9: 1, v10: 1, v11: 1, v14: 1 }) },
    { name: "variant-exact-upper-bounds", sequence: 14, admittedGeneration: 18,
      slots: variantSlots({ revision: 14, v9: 1, v10: 15, v11: 7 }) },
  ];
  const variantState = { lastAppliedRevision: 0 };
  const variantHost = variantCases.map((mailbox) => renderTargetFacadeHost({
    decoded: decodedVariant, baseFrame: base, mailbox, state: variantState }));
  const variantExpected = [0, 0, 0, 0, 0, 1, 0];
  invariant(variantHost.map(({ result }) => result).join() === variantExpected.join(),
    `variantText host result sequence changed: ${variantHost.map(({ result }) => result)}.`);
  /* Nothing below raster row 240 belongs to a surviving weather target, so the
   * band must be identical whether the flags word reports live or waiting. */
  const variantBand = (frame) => rawFrame(frame).subarray(240 * 100 * 2);
  invariant(variantBand(variantHost[1].frame).equals(variantBand(variantHost[4].frame)),
    "variantText render must be independent of the weather flags word.");
  const variantHostFrames = Buffer.concat(variantHost.map(({ frame }) => rawFrame(frame)));
  await Promise.all([
    writeFile(path.join(output, "variant-gen18.f2tf"), variantAsset),
    writeFile(path.join(output, "variant-cases.bin"), encodeCases(variantCases)),
  ]);
  const variantFramesPath = path.join(temporary, "variant-c-frames.bin");
  const variantNative = JSON.parse((await run(native, [path.join(output, "variant-gen18.f2tf"),
    path.join(output, "weather-gen18-base.rgb565le"), path.join(output, "variant-cases.bin"),
    variantFramesPath, asset.f2jsSha256, TARGET_FACADE_CONTRACT_V2_SHA256])).stdout);
  invariant((await readFile(variantFramesPath)).equals(variantHostFrames),
    "Host and freestanding C variantText RGB565 frames differ.");
  invariant(variantNative.results.map(({ result }) => result).join() === variantExpected.join(),
    "C variantText result sequence differs from the host oracle.");
  invariant(variantNative.results.map(({ writes }) => writes).join() ===
    variantHost.map(({ metrics }) => metrics.overlayWrites).join(),
  "variantText overlay write counts differ between C and the host oracle.");
  let cRejectsV1 = false;
  try {
    await run(native, [path.join(output, "variant-gen18.f2tf"),
      path.join(output, "weather-gen18-base.rgb565le"), path.join(output, "variant-cases.bin"),
      path.join(temporary, "variant-v1-frames.bin"), asset.f2jsSha256,
      TARGET_FACADE_CONTRACT_SHA256]);
  } catch { cRejectsV1 = true; }
  invariant(cRejectsV1, "C admission must reject the v2 asset under the frozen v1 contract sha.");

  /* ---- contract v3: formatter 12 (variantRaster) through the same C binary ----
   * Mirrors the v2 layering: the raster asset reuses the weather header, first
   * twelve targets, palette, glyph, and literal sections verbatim; the d3 row
   * and retry (the sole users of slots 9, 10, 11, and 14) become three
   * variantRaster targets plus one surviving variantText target, their raster
   * and literal tables append after the weather literals, and the embedded
   * contract identity moves to v3. Every raster pixel is generated to DIFFER
   * from the base pixel beneath it, so the full-rect equality assertions below
   * also prove that no base pixel ghosts through a blit. */
  const rasterVariants = (x, y, width, height, count, seed) =>
    Array.from({ length: count }, (_, variant) => {
      const pixels = Buffer.alloc(width * height * 2);
      for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
        let value = (seed + variant * 0x1111 + row * 0x0107 + column * 0x0013 +
          (((row ^ column) & 1) ? 0x8000 : 0)) & 0xffff;
        if (value === base[(y + row) * 100 + x + column]) value ^= 1;
        pixels.writeUInt16LE(value, (row * width + column) * 2);
      }
      return pixels;
    });
  const rasterTargets = [
    /* digitTens/digitOnes share ONE slot (9) with divisors 10 and 1 - the
     * formatter-13 contract: variant = (max(slot,0)/divisor) % 10. */
    { id: "digitTens", x: 12, y: 248, width: 6, height: 8, slot: 9, count: 10, seed: 0x9b1d, format: 13, divisor: 10 },
    { id: "digitOnes", x: 20, y: 248, width: 6, height: 8, slot: 9, count: 10, seed: 0x24c7, format: 13, divisor: 1 },
    { id: "rasterEdge", x: 80, y: 290, width: 20, height: 20, slot: 11, count: 4, seed: 0x51f2, format: 12 },
  ];
  for (const entry of rasterTargets) {
    entry.variants = rasterVariants(entry.x, entry.y, entry.width, entry.height, entry.count, entry.seed);
    entry.table = Buffer.concat(entry.variants);
  }
  const mixTable = variantTable(["RASTER", "MIXED", "VTHREE"]);
  const rasterRecord = (entry, offset) => {
    const record = Buffer.alloc(40);
    record.write(entry.id, 0, "ascii");
    record.writeUInt16LE(entry.x, 16); record.writeUInt16LE(entry.y, 18);
    record.writeUInt16LE(entry.width, 20); record.writeUInt16LE(entry.height, 22);
    record[24] = 1; record[25] = entry.format;
    record[26] = entry.slot; record[27] = 0xff; record[28] = 0xff; record[29] = 0xff;
    if (entry.format === 13) record.writeUInt32LE(entry.divisor, 30);
    else { record[30] = 0xff; record[31] = 0xff; record[32] = 0xff; record[33] = 0; }
    record[34] = 0; record[35] = 0;
    record.writeUInt16LE(offset, 36); record.writeUInt16LE(entry.table.length, 38);
    return record;
  };
  const mixRecord = Buffer.alloc(40);
  mixRecord.write("variantMix", 0, "ascii");
  mixRecord.writeUInt16LE(12, 16); mixRecord.writeUInt16LE(260, 18);
  mixRecord.writeUInt16LE(76, 20); mixRecord.writeUInt16LE(9, 22);
  mixRecord[24] = 1; mixRecord[25] = 11;
  mixRecord[26] = 14; mixRecord[27] = 0xff; mixRecord[28] = 0xff; mixRecord[29] = 0xff;
  mixRecord[30] = 2; mixRecord[31] = 0; mixRecord[32] = 0; mixRecord[33] = 0;
  mixRecord[34] = 8; mixRecord[35] = 1;
  mixRecord.writeUInt16LE(decoded.header.literalBytes +
    rasterTargets.reduce((sum, entry) => sum + entry.table.length, 0), 36);
  mixRecord[38] = mixTable.length;
  let rasterCursor = decoded.header.literalBytes;
  const rasterRecords = rasterTargets.map((entry) => {
    const record = rasterRecord(entry, rasterCursor);
    rasterCursor += entry.table.length;
    return record;
  });
  const rasterAsset = Buffer.concat([
    asset.binary.subarray(0, decoded.header.targetsAt + 12 * 40),
    ...rasterRecords,
    mixRecord,
    asset.binary.subarray(decoded.header.paletteAt),
    ...rasterTargets.map((entry) => entry.table),
    mixTable,
  ]);
  rasterAsset.writeUInt32LE(rasterAsset.length, 8);
  rasterAsset.writeUInt32LE(decoded.header.literalBytes + mixTable.length +
    rasterTargets.reduce((sum, entry) => sum + entry.table.length, 0), 64);
  Buffer.from(TARGET_FACADE_CONTRACT_V3_SHA256, "hex").copy(rasterAsset, 160);
  rasterAsset.writeUInt32LE(crc32(rasterAsset.subarray(TARGET_FACADE_HEADER_BYTES)), 72);
  rasterAsset.writeUInt32LE(crc32(rasterAsset.subarray(0, TARGET_FACADE_HEADER_BYTES),
    { zeroFrom: 76, zeroBytes: 4 }), 76);
  invariant(rasterAsset.length > 4096 && rasterAsset.length <= TARGET_FACADE_MAX_ASSET_BYTES,
    "The raster asset must exceed the frozen 4096-byte cap yet stay within the v3 cap.");
  const decodedRaster = decodeTargetFacadeAsset(rasterAsset, { expectedGeneration: 18,
    expectedF2jsSha256: asset.f2jsSha256,
    expectedContractSha256: TARGET_FACADE_CONTRACT_V3_SHA256, baseFrame: base });
  invariant(decodedRaster.targets[12].format === 13 &&
    decodedRaster.targets[12].rasters.length === 10 &&
    decodedRaster.targets[12].divisor === 10 &&
    decodedRaster.targets[13].format === 13 &&
    decodedRaster.targets[13].rasters.length === 10 &&
    decodedRaster.targets[13].divisor === 1 &&
    decodedRaster.targets[14].rasters.length === 4 &&
    decodedRaster.targets[15].format === 11 && decodedRaster.targets[15].tables.length === 3,
  "Decoded raster asset shape is wrong.");
  const rejects = (options) => {
    try { decodeTargetFacadeAsset(rasterAsset, { expectedGeneration: 18,
      expectedF2jsSha256: asset.f2jsSha256, baseFrame: base, ...options }); return false; }
    catch { return true; }
  };
  invariant(rejects({}), "The raster asset must not decode under the frozen v1 contract sha.");
  invariant(rejects({ expectedContractSha256: TARGET_FACADE_CONTRACT_V2_SHA256 }),
    "The raster asset must not decode under the frozen v2 contract sha.");

  const rasterSlots = ({ revision, flags = 1, v9 = 0, v10 = 0, v11 = 0, v14 = 0 }) => {
    const slots = weatherSlots({ revision, current: 45, currentMeta: 21,
      days: [[50, 34, 43], [59, 36, 46], [0, 0, 0]], age: 120, freshness: 1, flags });
    slots[9] = v9; slots[10] = v10; slots[11] = v11; slots[14] = v14;
    return slots;
  };
  const rasterCases = [
    /* slot 9 drives BOTH digit subtargets: tens = (v/10)%10, ones = v%10. */
    { name: "raster-first-variants", sequence: 2, admittedGeneration: 18,
      slots: rasterSlots({ revision: 2 }) },
    { name: "raster-digit-42", sequence: 4, admittedGeneration: 18,
      slots: rasterSlots({ revision: 4, v9: 42, v11: 2, v14: 1 }) },
    { name: "raster-clamp-negative", sequence: 6, admittedGeneration: 18,
      slots: rasterSlots({ revision: 6, v9: -2147483648, v11: -1, v14: -9 }) },
    { name: "raster-digit-999-and-intmax", sequence: 8, admittedGeneration: 18,
      slots: rasterSlots({ revision: 8, v9: 999, v10: 2147483647, v11: 1000, v14: 64 }) },
    { name: "raster-ignores-flags-word", sequence: 10, admittedGeneration: 18,
      slots: rasterSlots({ revision: 10, flags: 0, v9: 42, v11: 2, v14: 1 }) },
    { name: "raster-hidden-root", sequence: 12, admittedGeneration: 18,
      slots: rasterSlots({ revision: 12, flags: 3, v9: 7, v11: 1, v14: 1 }) },
    { name: "raster-digit-intmax", sequence: 14, admittedGeneration: 18,
      slots: rasterSlots({ revision: 14, v9: 2147483647, v11: 3, v14: 2 }) },
  ];
  const rasterState = { lastAppliedRevision: 0 };
  const rasterHost = rasterCases.map((mailbox) => renderTargetFacadeHost({
    decoded: decodedRaster, baseFrame: base, mailbox, state: rasterState }));
  const rasterExpected = [0, 0, 0, 0, 0, 1, 0];
  invariant(rasterHost.map(({ result }) => result).join() === rasterExpected.join(),
    `variantRaster host result sequence changed: ${rasterHost.map(({ result }) => result)}.`);
  /* Full-rect coverage: every pixel of every raster rect must equal the
   * independently clamped variant's pixel — and because generation forced each
   * variant pixel to differ from the base beneath it, equality doubles as
   * proof that the blit overwrote the entire rect. */
  const clampPick = (value, count) => Math.min(Math.max(value, 0), count - 1);
  for (const [caseIndex, entry] of rasterCases.entries()) {
    if (rasterExpected[caseIndex] !== TARGET_FACADE_RESULT.ok) continue;
    for (const target of rasterTargets) {
      const variant = target.variants[target.format === 13
        ? Math.floor(Math.max(entry.slots[target.slot], 0) / target.divisor) % 10
        : clampPick(entry.slots[target.slot], target.count)];
      for (let row = 0; row < target.height; row++) for (let column = 0; column < target.width; column++) {
        invariant(rasterHost[caseIndex].frame[(target.y + row) * 100 + target.x + column] ===
          variant.readUInt16LE((row * target.width + column) * 2),
        `${target.id} pixel (${column},${row}) is wrong in ${entry.name}.`);
      }
    }
  }
  invariant(rawFrame(rasterHost[5].frame).equals(asset.baseBytes),
    "The hidden-root raster case must leave the exact base frame.");
  const rasterBand = (frame) => rawFrame(frame).subarray(240 * 100 * 2);
  invariant(rasterBand(rasterHost[1].frame).equals(rasterBand(rasterHost[4].frame)),
    "variantRaster render must be independent of the weather flags word.");
  const rasterHostFrames = Buffer.concat(rasterHost.map(({ frame }) => rawFrame(frame)));
  await Promise.all([
    writeFile(path.join(output, "raster-gen18.f2tf"), rasterAsset),
    writeFile(path.join(output, "raster-cases.bin"), encodeCases(rasterCases)),
  ]);
  const rasterFramesPath = path.join(temporary, "raster-c-frames.bin");
  const rasterNative = JSON.parse((await run(native, [path.join(output, "raster-gen18.f2tf"),
    path.join(output, "weather-gen18-base.rgb565le"), path.join(output, "raster-cases.bin"),
    rasterFramesPath, asset.f2jsSha256, TARGET_FACADE_CONTRACT_V3_SHA256])).stdout);
  invariant((await readFile(rasterFramesPath)).equals(rasterHostFrames),
    "Host and freestanding C variantRaster RGB565 frames differ.");
  invariant(rasterNative.results.map(({ result }) => result).join() === rasterExpected.join(),
    "C variantRaster result sequence differs from the host oracle.");
  invariant(rasterNative.results.map(({ writes }) => writes).join() ===
    rasterHost.map(({ metrics }) => metrics.overlayWrites).join(),
  "variantRaster overlay write counts differ between C and the host oracle.");
  const cRejectsRaster = async (contractSha) => {
    try {
      await run(native, [path.join(output, "raster-gen18.f2tf"),
        path.join(output, "weather-gen18-base.rgb565le"), path.join(output, "raster-cases.bin"),
        path.join(temporary, "raster-reject-frames.bin"), asset.f2jsSha256, contractSha]);
      return false;
    } catch { return true; }
  };
  invariant(await cRejectsRaster(TARGET_FACADE_CONTRACT_SHA256),
    "C admission must reject the v3 asset under the frozen v1 contract sha.");
  invariant(await cRejectsRaster(TARGET_FACADE_CONTRACT_V2_SHA256),
    "C admission must reject the v3 asset under the frozen v2 contract sha.");

  /* ---- contract v4: formatter 14 (spriteMotion) through JS and C ----------
   * Replace rasterEdge with one 10x6 alpha sprite and 32 positions. The old
   * raster bytes remain harmless unreferenced literals; only the compact
   * sprite table is appended. Cases cover fully clipped, edge-clipped and
   * fully visible positions plus 0/128/255 alpha. */
  const spriteWidth = 10; const spriteHeight = 6; const spriteCount = 32;
  const spriteTable = Buffer.alloc(8 + spriteCount * 4 + spriteWidth * spriteHeight * 3);
  spriteTable[0] = 1; spriteTable[1] = 0; spriteTable[2] = spriteCount; spriteTable[3] = 1;
  const spritePositions = Array.from({ length: spriteCount }, (_, index) => ({
    x: Math.round(-spriteWidth + (100 + spriteWidth) * index / (spriteCount - 1)),
    y: 286 + index % 3,
  }));
  spritePositions.forEach((position, index) => {
    spriteTable.writeInt16LE(position.x, 8 + index * 4);
    spriteTable.writeInt16LE(position.y, 10 + index * 4);
  });
  const spriteColorsAt = 8 + spriteCount * 4;
  for (let pixel = 0; pixel < spriteWidth * spriteHeight; pixel++) {
    spriteTable.writeUInt16LE((0x1823 + pixel * 0x0311) & 0xffff, spriteColorsAt + pixel * 2);
    spriteTable[spriteColorsAt + spriteWidth * spriteHeight * 2 + pixel] =
      pixel % 3 === 0 ? 0 : pixel % 3 === 1 ? 128 : 255;
  }
  const spriteAsset = Buffer.concat([rasterAsset, spriteTable]);
  const spriteRecord = spriteAsset.subarray(decoded.header.targetsAt + 14 * 40,
    decoded.header.targetsAt + 15 * 40);
  spriteRecord.fill(0); spriteRecord.write("spriteEdge", 0, "ascii");
  spriteRecord.writeUInt16LE(0, 16); spriteRecord.writeUInt16LE(0, 18);
  spriteRecord.writeUInt16LE(spriteWidth, 20); spriteRecord.writeUInt16LE(spriteHeight, 22);
  spriteRecord[24] = 1; spriteRecord[25] = 14; spriteRecord[26] = 11;
  spriteRecord[27] = 0xff; spriteRecord[28] = 0xff; spriteRecord[29] = 0xff;
  spriteRecord[30] = 0xff; spriteRecord[31] = 0xff; spriteRecord[32] = 0xff;
  spriteRecord.writeUInt16LE(rasterAsset.readUInt32LE(64), 36);
  spriteRecord.writeUInt16LE(spriteTable.length, 38);
  spriteAsset.writeUInt32LE(spriteAsset.length, 8);
  spriteAsset.writeUInt32LE(rasterAsset.readUInt32LE(64) + spriteTable.length, 64);
  Buffer.from(TARGET_FACADE_CONTRACT_V4_SHA256, "hex").copy(spriteAsset, 160);
  spriteAsset.writeUInt32LE(crc32(spriteAsset.subarray(TARGET_FACADE_HEADER_BYTES)), 72);
  spriteAsset.writeUInt32LE(crc32(spriteAsset.subarray(0, TARGET_FACADE_HEADER_BYTES),
    { zeroFrom: 76, zeroBytes: 4 }), 76);
  const decodedSprite = decodeTargetFacadeAsset(spriteAsset, { expectedGeneration: 18,
    expectedF2jsSha256: asset.f2jsSha256,
    expectedContractSha256: TARGET_FACADE_CONTRACT_V4_SHA256, baseFrame: base });
  invariant(decodedSprite.targets[14].format === 14 &&
    decodedSprite.targets[14].sprite.positions.length === 32,
  "Decoded spriteMotion asset shape is wrong.");
  const spriteCases = [0, 1, 15, 31].map((pick, index) => ({
    name: `sprite-position-${pick}`, sequence: 2 + index * 2, admittedGeneration: 18,
    slots: rasterSlots({ revision: 2 + index * 2, v9: 42, v11: pick, v14: 1 }),
  }));
  const spriteState = { lastAppliedRevision: 0 };
  const spriteHost = spriteCases.map((mailbox) => renderTargetFacadeHost({
    decoded: decodedSprite, baseFrame: base, mailbox, state: spriteState }));
  invariant(spriteHost.every(({ result }) => result === TARGET_FACADE_RESULT.ok),
    "spriteMotion host cases must all render.");
  const spriteHostFrames = Buffer.concat(spriteHost.map(({ frame }) => rawFrame(frame)));
  await Promise.all([
    writeFile(path.join(output, "sprite-gen18.f2tf"), spriteAsset),
    writeFile(path.join(output, "sprite-cases.bin"), encodeCases(spriteCases)),
  ]);
  const spriteFramesPath = path.join(temporary, "sprite-c-frames.bin");
  const spriteNative = JSON.parse((await run(native, [path.join(output, "sprite-gen18.f2tf"),
    path.join(output, "weather-gen18-base.rgb565le"), path.join(output, "sprite-cases.bin"),
    spriteFramesPath, asset.f2jsSha256, TARGET_FACADE_CONTRACT_V4_SHA256])).stdout);
  invariant((await readFile(spriteFramesPath)).equals(spriteHostFrames),
    "Host and freestanding C spriteMotion RGB565 frames differ.");
  invariant(spriteNative.results.map(({ writes }) => writes).join() ===
    spriteHost.map(({ metrics }) => metrics.overlayWrites).join(),
  "spriteMotion overlay write counts differ between C and the host oracle.");
  const compatFramesPath = path.join(temporary, "raster-v4-compat-frames.bin");
  const compatNative = JSON.parse((await run(native, [path.join(output, "raster-gen18.f2tf"),
    path.join(output, "weather-gen18-base.rgb565le"), path.join(output, "raster-cases.bin"),
    compatFramesPath, asset.f2jsSha256, TARGET_FACADE_CONTRACT_V4_SHA256])).stdout);
  invariant(compatNative.results.map(({ result }) => result).join() === rasterExpected.join() &&
    (await readFile(compatFramesPath)).equals(rasterHostFrames),
  "A v4 native facade must keep admitting and rendering v3 packages.");

  /* ---- contract v5: formatter 15 (spriteTween) through JS and C ----------
   * Reuse the exact v4 sprite bytes and positions; only the formatter, table
   * mode and 100 ms duration change. Repeated mailbox picks prove that render
   * time—not publication frequency—moves the sprite, and the final decreasing
   * pick proves the off-right -> off-left loop seam snaps instead of flying
   * backwards through the sky. */
  const tweenAsset = Buffer.from(spriteAsset);
  const tweenRecord = tweenAsset.subarray(decoded.header.targetsAt + 14 * 40,
    decoded.header.targetsAt + 15 * 40);
  tweenRecord[25] = 15;
  const tweenTableAt = decoded.header.literalsAt + tweenRecord.readUInt16LE(36);
  tweenAsset[tweenTableAt + 1] = 1;
  tweenAsset.writeUInt16LE(100, tweenTableAt + 4);
  tweenAsset[tweenTableAt + 6] = 0; tweenAsset[tweenTableAt + 7] = 0;
  Buffer.from(TARGET_FACADE_CONTRACT_V5_SHA256, "hex").copy(tweenAsset, 160);
  tweenAsset.writeUInt32LE(crc32(tweenAsset.subarray(TARGET_FACADE_HEADER_BYTES)), 72);
  tweenAsset.writeUInt32LE(crc32(tweenAsset.subarray(0, TARGET_FACADE_HEADER_BYTES),
    { zeroFrom: 76, zeroBytes: 4 }), 76);
  const decodedTween = decodeTargetFacadeAsset(tweenAsset, { expectedGeneration: 18,
    expectedF2jsSha256: asset.f2jsSha256,
    expectedContractSha256: TARGET_FACADE_CONTRACT_V5_SHA256, baseFrame: base });
  invariant(decodedTween.targets[14].format === 15 &&
    decodedTween.targets[14].sprite.durationMs === 100,
  "Decoded spriteTween asset shape is wrong.");
  const tweenPicks = [0, 15, 15, 31, 31, 0];
  const tweenCases = tweenPicks.map((pick, index) => ({
    name: `sprite-tween-${index}-${pick}`, sequence: 2 + index * 2,
    admittedGeneration: 18,
    slots: rasterSlots({ revision: 2 + index * 2, v9: 42, v11: pick, v14: 1 }),
  }));
  const tweenState = { lastAppliedRevision: 0 };
  const tweenHost = tweenCases.map((mailbox, index) => renderTargetFacadeHost({
    decoded: decodedTween, baseFrame: base, mailbox, state: tweenState,
    nowMs: index * 50,
  }));
  invariant(tweenHost.every(({ result }) => result === TARGET_FACADE_RESULT.ok),
    "spriteTween host cases must all render.");
  const tweenHostFrames = Buffer.concat(tweenHost.map(({ frame }) => rawFrame(frame)));
  await Promise.all([
    writeFile(path.join(output, "tween-gen18.f2tf"), tweenAsset),
    writeFile(path.join(output, "tween-cases.bin"), encodeCases(tweenCases)),
  ]);
  const tweenFramesPath = path.join(temporary, "tween-c-frames.bin");
  const tweenNative = JSON.parse((await run(native, [path.join(output, "tween-gen18.f2tf"),
    path.join(output, "weather-gen18-base.rgb565le"), path.join(output, "tween-cases.bin"),
    tweenFramesPath, asset.f2jsSha256, TARGET_FACADE_CONTRACT_V5_SHA256])).stdout);
  invariant((await readFile(tweenFramesPath)).equals(tweenHostFrames),
    "Host and freestanding C spriteTween RGB565 frames differ.");
  invariant(tweenNative.results.map(({ writes }) => writes).join() ===
    tweenHost.map(({ metrics }) => metrics.overlayWrites).join(),
  "spriteTween overlay write counts differ between C and the host oracle.");
  const v4UnderV5Frames = path.join(temporary, "sprite-v5-compat-frames.bin");
  const v4UnderV5 = JSON.parse((await run(native, [path.join(output, "sprite-gen18.f2tf"),
    path.join(output, "weather-gen18-base.rgb565le"), path.join(output, "sprite-cases.bin"),
    v4UnderV5Frames, asset.f2jsSha256, TARGET_FACADE_CONTRACT_V5_SHA256])).stdout);
  invariant(v4UnderV5.results.every(({ result }) => result === TARGET_FACADE_RESULT.ok) &&
    (await readFile(v4UnderV5Frames)).equals(spriteHostFrames),
  "A v5 native facade must keep admitting and rendering v4 packages.");

  /* The exact v3 asset-cap boundary through the compiled C: a copy padded with
   * unreferenced table bytes to exactly 65536 admits and renders the very same
   * frames; one byte more must fail admission. */
  const paddedAsset = (bytes) => {
    const padded = Buffer.concat([rasterAsset, Buffer.alloc(bytes - rasterAsset.length, 0xa5)]);
    padded.writeUInt32LE(padded.length, 8);
    padded.writeUInt32LE(padded.length - decoded.header.literalsAt, 64);
    padded.writeUInt32LE(crc32(padded.subarray(TARGET_FACADE_HEADER_BYTES)), 72);
    padded.writeUInt32LE(crc32(padded.subarray(0, TARGET_FACADE_HEADER_BYTES),
      { zeroFrom: 76, zeroBytes: 4 }), 76);
    return padded;
  };
  const capExactPath = path.join(temporary, "raster-cap-exact.f2tf");
  await writeFile(capExactPath, paddedAsset(TARGET_FACADE_MAX_ASSET_BYTES));
  const capExactFramesPath = path.join(temporary, "raster-cap-frames.bin");
  const capExact = JSON.parse((await run(native, [capExactPath,
    path.join(output, "weather-gen18-base.rgb565le"), path.join(output, "raster-cases.bin"),
    capExactFramesPath, asset.f2jsSha256, TARGET_FACADE_CONTRACT_V3_SHA256])).stdout);
  invariant(capExact.results.map(({ result }) => result).join() === rasterExpected.join() &&
    (await readFile(capExactFramesPath)).equals(rasterHostFrames),
  "A cap-exact 65536-byte asset must admit and render identically.");
  const overCapPath = path.join(temporary, "raster-over-cap.f2tf");
  await writeFile(overCapPath, paddedAsset(TARGET_FACADE_MAX_ASSET_BYTES + 1));
  let cRejectsOverCap = false;
  try {
    await run(native, [overCapPath, path.join(output, "weather-gen18-base.rgb565le"),
      path.join(output, "raster-cases.bin"), path.join(temporary, "raster-over-frames.bin"),
      asset.f2jsSha256, TARGET_FACADE_CONTRACT_V3_SHA256]);
  } catch { cRejectsOverCap = true; }
  invariant(cRejectsOverCap, "C admission must reject one byte past the v3 asset cap.");

  const cross = path.join(temporary, "target_facade.o");
  await run(xtensa("gcc"), ["-std=c11", "-Os", "-ffreestanding", "-fno-builtin",
    "-fno-stack-protector", "-fno-unwind-tables", "-fno-asynchronous-unwind-tables",
    "-ffunction-sections", "-fdata-sections", "-mlongcalls", "-mtext-section-literals",
    "-fstack-usage", "-c", path.join(here, "target_facade.c"), "-o", cross]);
  const linked = path.join(temporary, "target-facade-core.o");
  await run(xtensa("gcc"), ["-nostdlib", "-Wl,-r", cross, "-lgcc", "-o", linked]);
  const [object, undefineds, sections, compiler, stackUsage] = await Promise.all([
    readFile(linked), run(xtensa("nm"), ["-u", linked]), run(xtensa("objdump"), ["-h", linked]),
    run(xtensa("gcc"), ["--version"]), readFile(cross.replace(/\.o$/u, ".su"), "utf8")]);
  invariant(undefineds.stdout.trim() === "", "Target facade retains undefined Xtensa symbols.");
  const writableBytes = sectionBytes(sections.stdout, ".data") + sectionBytes(sections.stdout, ".bss");
  invariant(writableBytes === 0, "Target facade gained writable globals.");
  const stackFrames = [...stackUsage.matchAll(/\s(\d+)\s+(?:static|dynamic)/gu)].map((match) => Number(match[1]));
  const maxWrites = Math.max(...host.map(({ metrics }) => metrics.overlayWrites));
  const timingCycles = 31_000 * 4 + maxWrites * 12 + 16 * 250 + 512;
  const manifest = {
    format: "framer-mquickjs-target-facade-static-canary-v1",
    status: "STATIC_ONLY_NOT_INTEGRATED",
    hardwareTouched: false, flashable: false, generation: 18,
    asset: { format: "F2TF-v1-companion", bytes: asset.binary.length, sha256: asset.sha256,
      contractSha256: TARGET_FACADE_CONTRACT_SHA256, f2jsSha256: asset.f2jsSha256,
      baseSha256: asset.baseSha256, targetCount: 16, paletteEntries: decoded.palette.length,
      glyphRecords: decoded.glyphs.size, maxOverlayPixelWrites: decoded.header.maxOverlayWrites },
    proof: { hostVsCFrames: "PIXEL_EXACT", cases: cases.map((entry, index) => ({ name: entry.name,
      result: expectedResults[index], frameSha256: sha256(hostFrames.subarray(index * 62_000, (index + 1) * 62_000)),
      overlayWrites: host[index].metrics.overlayWrites })),
      tornMidCopy: nativeOutput.torn, malformedAssets: nativeOutput.malformed,
      overlayOverflowBeforeDraw: nativeOutput.overflow },
    variantProof: { contractV2Sha256: TARGET_FACADE_CONTRACT_V2_SHA256,
      assetSha256: sha256(variantAsset), assetBytes: variantAsset.length,
      hostVsCFrames: "PIXEL_EXACT", frozenV1ShaRejects: { host: true, c: true },
      flagsWordIndependent: true,
      cases: variantCases.map((entry, index) => ({ name: entry.name,
        result: variantExpected[index],
        frameSha256: sha256(variantHostFrames.subarray(index * 62_000, (index + 1) * 62_000)),
        overlayWrites: variantHost[index].metrics.overlayWrites })) },
    rasterProof: { contractV3Sha256: TARGET_FACADE_CONTRACT_V3_SHA256,
      assetSha256: sha256(rasterAsset), assetBytes: rasterAsset.length,
      exceedsFrozenV2AssetCap: rasterAsset.length > 4096,
      hostVsCFrames: "PIXEL_EXACT",
      frozenShaRejects: { v1: { host: true, c: true }, v2: { host: true, c: true } },
      oldAssetsStillAdmitUnderOwnShas: true, fullRectCoverage: true,
      hiddenRootLeavesExactBase: true, flagsWordIndependent: true,
      assetCapBoundary: { admits: TARGET_FACADE_MAX_ASSET_BYTES,
        rejects: TARGET_FACADE_MAX_ASSET_BYTES + 1 },
      targets: rasterTargets.map(({ id, x, y, width, height, slot, count }) =>
        ({ id, x, y, width, height, slot, count })),
      cases: rasterCases.map((entry, index) => ({ name: entry.name,
        result: rasterExpected[index],
        frameSha256: sha256(rasterHostFrames.subarray(index * 62_000, (index + 1) * 62_000)),
        overlayWrites: rasterHost[index].metrics.overlayWrites })) },
    spriteProof: { contractV4Sha256: TARGET_FACADE_CONTRACT_V4_SHA256,
      assetSha256: sha256(spriteAsset), assetBytes: spriteAsset.length,
      positions: spriteCount, sprite: { width: spriteWidth, height: spriteHeight },
      hostVsCFrames: "PIXEL_EXACT", v3NativeCompatibility: true,
      cases: spriteCases.map((entry, index) => ({ name: entry.name,
        result: spriteHost[index].result,
        frameSha256: sha256(spriteHostFrames.subarray(index * 62_000, (index + 1) * 62_000)),
        overlayWrites: spriteHost[index].metrics.overlayWrites })) },
    tweenProof: { contractV5Sha256: TARGET_FACADE_CONTRACT_V5_SHA256,
      assetSha256: sha256(tweenAsset), assetBytes: tweenAsset.length,
      durationMs: 100, hostVsCFrames: "PIXEL_EXACT",
      v4NativeCompatibility: true, loopSeam: "SNAP_ON_DECREASING_PICK",
      cases: tweenCases.map((entry, index) => ({ name: entry.name,
        result: tweenHost[index].result,
        frameSha256: sha256(tweenHostFrames.subarray(index * 62_000, (index + 1) * 62_000)),
        overlayWrites: tweenHost[index].metrics.overlayWrites })) },
    xtensa: { compiler: compiler.stdout.split("\n")[0], objectBytes: object.length,
      objectSha256: sha256(object), textBytes: sectionBytes(sections.stdout, ".text"),
      rodataBytes: sectionBytes(sections.stdout, ".rodata"), writableGlobalBytes: writableBytes,
      undefinedSymbols: 0, maxCompilerReportedFrameBytes: Math.max(...stackFrames),
      conservativeAllStaticFramesBytes: stackFrames.reduce((sum, value) => sum + value, 0) },
    timingEstimate: { kind: "analytic-not-device-measured", cpuMhz: 240, maxObservedOverlayWrites: maxWrites,
      conservativeCycles: timingCycles, microsecondsAt240Mhz: Number((timingCycles / 240).toFixed(1)) },
    requiredProfileExtension: { basePackageAbiUnchanged: true,
      companionAsset: "framer-mquickjs-target-facade-v1", capability: "targetFacade=weather-slot-target-facade-v1",
      packageAssociation: "generation + exact F2JS SHA-256 + exact raster-base SHA-256 + contract SHA-256",
      uiHook: "stock UI task restores admitted base, snapshots resident mailbox, invokes bounded facade" },
    gaps: ["not linked into the resident module or stock UI tick", "no physical capability advertisement",
      "no host-RPC device receipt/transport integration", "no hardware timing, stack high-water, SHA receipt, or soak proof"],
  };
  await writeFile(path.join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ status: manifest.status, asset: manifest.asset, proof: manifest.proof,
    variantProof: manifest.variantProof, rasterProof: manifest.rasterProof,
    spriteProof: manifest.spriteProof, tweenProof: manifest.tweenProof, xtensa: manifest.xtensa,
    timingEstimate: manifest.timingEstimate }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
