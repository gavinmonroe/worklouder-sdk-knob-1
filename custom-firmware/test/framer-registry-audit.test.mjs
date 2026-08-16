import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { APP_FLASH_OFFSET } from "../build-stage1.mjs";
import { auditFramerScreenRegistry, FRAMER_SCREEN_AUDIT } from "../lib/framer-registry-audit.mjs";
import { repairEsp32AppIntegrity } from "../lib/esp-app-image.mjs";

const firmwareUrl = new URL("../../artifacts/firmware/firmware_0.4.1_merged.bin", import.meta.url);

test("Framer 0.4.1 has a dynamic controller registry with IDs 1 and 7 unused", async () => {
  const merged = await readFile(firmwareUrl);
  const report = auditFramerScreenRegistry(merged.subarray(APP_FLASH_OFFSET));
  assert.deepEqual(report.controllerIds, [
    0, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
  ]);
  assert.deepEqual(report.unusedIds, [1, 7]);
  assert.equal(report.controllers.length, 24);
  assert.equal(report.recommendedWpmScreenId, 7);
});

test("physical dial navigation is a separate dynamic list", async () => {
  const merged = await readFile(firmwareUrl);
  const report = auditFramerScreenRegistry(merged.subarray(APP_FLASH_OFFSET));
  assert.deepEqual(report.navigationIds, [8, 22, 16, 17, 3, 15, 14, 19, 18]);
  assert.ok(!report.navigationIds.includes(21), "bootloader must remain outside dial navigation");
  assert.ok(!report.navigationIds.includes(7), "the stock image must not already register the proposed WPM ID");
});

test("WPM and setup hook evidence remains pinned before a native builder is allowed", async () => {
  const merged = Buffer.from(await readFile(firmwareUrl));
  const report = auditFramerScreenRegistry(merged.subarray(APP_FLASH_OFFSET));
  assert.equal(report.irom.index, 3);
  assert.equal(report.irom.dataOffset & 0xffff, report.irom.loadAddress & 0xffff);
  assert.equal(report.irom.endAddress, 0x42116d14);
  assert.equal(FRAMER_SCREEN_AUDIT.wpmCurrentAddress, 0x3fcaba20);
  assert.equal(FRAMER_SCREEN_AUDIT.wpmRecordAddress, 0x3fcae930);
  assert.equal(FRAMER_SCREEN_AUDIT.screenSetupVtablePointer.virtualAddress, 0x3c1ac194);
  assert.equal(FRAMER_SCREEN_AUDIT.screenSetupVtablePointer.expectedValue, 0x4202c108);
  assert.equal(report.controllerLifecycleWindows.length, 6);
  assert.deepEqual(report.controllerLifecycleWindows.map(({ start }) => start), [
    0x4210af04,
    0x4204d680,
    0x4204d694,
    0x4204d6d0,
    0x4204d6ec,
    0x4204d8d4,
  ]);
  assert.deepEqual(report.navigationMutationWindows.map(({ start }) => start), [
    0x420293a8,
    0x4202924c,
  ]);

  // Mutating one reviewed instruction must fail closed rather than producing a
  // best-effort patch for an unknown binary.
  const mutatedApp = Buffer.from(merged.subarray(APP_FLASH_OFFSET));
  mutatedApp[0xdc10b] ^= 1;
  const repairedMutation = repairEsp32AppIntegrity(mutatedApp);
  assert.throws(
    () => auditFramerScreenRegistry(repairedMutation),
    /hook window changed/u,
  );

  const mutatedLifecycle = Buffer.from(merged.subarray(APP_FLASH_OFFSET));
  const lifecycleOffset = report.irom.dataOffset +
    (FRAMER_SCREEN_AUDIT.controllerLifecycleWindows[1].start - report.irom.loadAddress);
  mutatedLifecycle[lifecycleOffset] ^= 1;
  const repairedLifecycleMutation = repairEsp32AppIntegrity(mutatedLifecycle);
  assert.throws(
    () => auditFramerScreenRegistry(repairedLifecycleMutation),
    /Controller lifecycle window changed/u,
  );

  const mutatedNavigation = Buffer.from(merged.subarray(APP_FLASH_OFFSET));
  const navigationOffset = report.irom.dataOffset +
    (FRAMER_SCREEN_AUDIT.navigationMutationWindows[1].start - report.irom.loadAddress);
  mutatedNavigation[navigationOffset] ^= 1;
  const repairedNavigationMutation = repairEsp32AppIntegrity(mutatedNavigation);
  assert.throws(
    () => auditFramerScreenRegistry(repairedNavigationMutation),
    /Navigation mutation window changed/u,
  );
});
