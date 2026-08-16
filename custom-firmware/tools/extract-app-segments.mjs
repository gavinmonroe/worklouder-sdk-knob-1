#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_FLASH_OFFSET = 0x10000;
const IMAGE_HEADER_BYTES = 24;

const OUTPUTS_BY_LOAD_ADDRESS = new Map([
  [0x3c120020, "framer_app_drom.bin"],
  [0x42000020, "framer_app_irom.bin"],
  [0x4037d418, "framer_app_iram_main.bin"],
]);

function hex(value) {
  return `0x${value.toString(16)}`;
}

export function parseSegments(appImage) {
  if (!Buffer.isBuffer(appImage) || appImage.length < IMAGE_HEADER_BYTES || appImage[0] !== 0xe9) {
    throw new Error("Expected an ESP app image beginning with magic 0xe9.");
  }

  const segmentCount = appImage[1];
  const segments = [];
  let cursor = IMAGE_HEADER_BYTES;
  for (let index = 0; index < segmentCount; index += 1) {
    if (cursor + 8 > appImage.length) throw new Error(`Segment ${index} header is truncated.`);
    const headerOffset = cursor;
    const loadAddress = appImage.readUInt32LE(cursor);
    const length = appImage.readUInt32LE(cursor + 4);
    const dataOffset = cursor + 8;
    const dataEnd = dataOffset + length;
    if (length === 0 || dataEnd > appImage.length) throw new Error(`Segment ${index} data is truncated.`);
    segments.push({ index, headerOffset, dataOffset, dataEnd, loadAddress, length });
    cursor = dataEnd;
  }
  return segments;
}

export async function extractAppSegments({ root } = {}) {
  const projectRoot = root ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const firmwareDirectory = path.join(projectRoot, "artifacts/firmware");
  const merged = await readFile(path.join(firmwareDirectory, "firmware_0.4.1_merged.bin"));
  const appImage = merged.subarray(APP_FLASH_OFFSET);
  const segments = parseSegments(appImage);

  const selected = [];
  for (const segment of segments) {
    const filename = OUTPUTS_BY_LOAD_ADDRESS.get(segment.loadAddress);
    if (!filename) continue;
    const data = appImage.subarray(segment.dataOffset, segment.dataEnd);
    await writeFile(path.join(firmwareDirectory, filename), data);
    selected.push({
      ...segment,
      appHeaderOffset: segment.headerOffset,
      appDataOffset: segment.dataOffset,
      mergedDataOffset: APP_FLASH_OFFSET + segment.dataOffset,
      mappedStart: segment.loadAddress,
      mappedEnd: segment.loadAddress + segment.length,
      filename,
    });
  }

  if (selected.length !== OUTPUTS_BY_LOAD_ADDRESS.size) {
    throw new Error(`Found ${selected.length} of ${OUTPUTS_BY_LOAD_ADDRESS.size} expected segments.`);
  }

  await mkdir(firmwareDirectory, { recursive: true });
  await writeFile(
    path.join(firmwareDirectory, "framer_app_segment_map.json"),
    `${JSON.stringify({
      format: "framer-f1-app-segment-map-v1",
      warning: "Map extracted data at mappedStart. Segment headers are intentionally excluded.",
      addressFormula: "virtual = mappedStart + (appFileOffset - appDataOffset)",
      segments: selected.map((segment) => ({
        ...segment,
        headerOffsetHex: hex(segment.appHeaderOffset),
        dataOffsetHex: hex(segment.appDataOffset),
        mergedDataOffsetHex: hex(segment.mergedDataOffset),
        mappedStartHex: hex(segment.mappedStart),
        mappedEndHex: hex(segment.mappedEnd),
        lengthHex: hex(segment.length),
      })),
    }, null, 2)}\n`,
  );
  return selected;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(await extractAppSegments(), null, 2));
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}
