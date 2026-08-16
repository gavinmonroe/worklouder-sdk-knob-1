import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertFramerIdentity,
  assertReadOnlyInvocation,
  buildDryRunPlan,
  parseDetectedFlashSize,
  parsePartitionTable,
  selectRecoveryPartitions,
} from "../recovery/lib.mjs";

test("parses the known F1 partition table without assuming its regions", async () => {
  const firmware = await readFile(new URL("../../artifacts/firmware/firmware_0.4.1_merged.bin", import.meta.url));
  const entries = parsePartitionTable(firmware.subarray(0x8000, 0x9000));
  const recovery = selectRecoveryPartitions(entries, 16 * 1024 * 1024);
  assert.deepEqual(
    recovery.selected.map(({ label, offset, size, subtype }) => ({ label, offset, size, subtype })),
    [
      { label: "nvs", offset: 0x810000, size: 0x20000, subtype: 0x02 },
      { label: "fs", offset: 0x830000, size: 0x200000, subtype: 0x82 },
    ],
  );
  assertFramerIdentity(firmware.subarray(0x10000, 0x20000));
});

test("flash-size parser rejects missing and implausible values", () => {
  assert.equal(parseDetectedFlashSize("Detected flash size: 16MB"), 16 * 1024 * 1024);
  assert.throws(() => parseDetectedFlashSize("Detected flash size: 2MB"), /implausible/u);
  assert.throws(() => parseDetectedFlashSize("unknown"), /Could not parse/u);
});

test("tool gate permits only audited reads and eFuse summary", () => {
  assert.equal(assertReadOnlyInvocation("esptool", ["--chip", "esp32s3", "chip-id"]), "chip-id");
  assert.equal(assertReadOnlyInvocation("esptool", ["read-flash", "0", "ALL", "out.bin"]), "read-flash");
  assert.equal(
    assertReadOnlyInvocation("esptool", ["read-flash", "0", "ALL", "/tmp/before-encryption/out.bin"]),
    "read-flash",
  );
  assert.equal(assertReadOnlyInvocation("espefuse", ["--chip", "esp32s3", "summary"]), "summary");
  assert.throws(() => assertReadOnlyInvocation("esptool", ["write-flash", "0", "image.bin"]), /mutating/u);
  assert.throws(() => assertReadOnlyInvocation("esptool", ["erase-flash"]), /mutating/u);
  assert.throws(() => assertReadOnlyInvocation("espefuse", ["burn-efuse", "X", "1"]), /mutating/u);
  assert.throws(() => assertReadOnlyInvocation("esptool", ["--force", "read-flash", "0", "ALL", "out.bin"]), /mutating/u);
});

test("dry-run plan contains no mutating tool invocation", () => {
  const plan = buildDryRunPlan({ port: "/dev/cu.usbmodem-FRAMER-F1" });
  for (const [tool, ...args] of plan) {
    if (tool === "esptool" || tool === "espefuse") assertReadOnlyInvocation(tool, args);
  }
  assert.ok(plan.some((command) => command.includes("ALL")));
  assert.ok(plan.some((command) => command.includes("get-security-info")));
});
