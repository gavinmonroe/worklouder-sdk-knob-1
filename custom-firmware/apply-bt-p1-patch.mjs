#!/usr/bin/env node
// BT reconnect fix "P1" (see experiments/BT-RECONNECT-INVESTIGATION.md §P1):
// in the stock 0.4.1 BLE driver's set_slot, replace
//   0x420387a3: movi.n a11,1 ; call8 set_is_advertising(this,true)   (0c 1b e5 ca fa)
// with
//   0x420387a3: mov.n a11,a3 ; call8 release_adv_hold(this,new_slot)  (same 5 bytes)
// so switching back to a slot always releases that slot's sticky advertising gate.
// Same-length, in-place; the image checksum + appended SHA-256 are repaired.
//
//   node custom-firmware/apply-bt-p1-patch.mjs --in APP.bin --out APP-btp1.bin [--revert]
// Offline only; never touches hardware.

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { inspectEsp32AppImage, repairEsp32AppIntegrity } from "./lib/esp-app-image.mjs";

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const xtensa = (n) => path.join(repo, ".toolchains/xtensa-esp-elf-13.2.0_20240530/bin", `xtensa-esp32s3-elf-${n}`);

const PATCH_VADDR = 0x420387a3;
const RELEASE_ADV_HOLD = 0x420388c0;
const ORIGINAL = Buffer.from("0c1be5cafa", "hex"); // movi.n a11,1 ; call8 0x42033454
const invariant = (ok, m) => { if (!ok) throw new Error(m); };

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const input = opt("--in"); const output = opt("--out"); const revert = args.includes("--revert");
invariant(input && output, "usage: --in APP.bin --out PATCHED.bin [--revert]");

async function assemblePatch() {
  const dir = await mkdtemp(path.join(tmpdir(), "bt-p1-"));
  try {
    const src = path.join(dir, "p1.S"), obj = path.join(dir, "p1.o"), ld = path.join(dir, "p1.ld"),
      elf = path.join(dir, "p1.elf"), raw = path.join(dir, "p1.bin");
    await writeFile(src, `.section .text.patch,"ax",@progbits\n.global patch\npatch:\n` +
      `mov.n a11, a3\ncall8 0x${RELEASE_ADV_HOLD.toString(16)}\n`);
    await writeFile(ld, `SECTIONS { .text.patch 0x${PATCH_VADDR.toString(16)} : { *(.text.patch) } }\n`);
    await run(xtensa("gcc"), ["-c", src, "-o", obj]);
    await run(xtensa("ld"), ["-T", ld, obj, "-o", elf]);
    await run(xtensa("objcopy"), ["-O", "binary", "-j", ".text.patch", elf, raw]);
    const bytes = await readFile(raw);
    invariant(bytes.length === 5, `patch assembled to ${bytes.length} bytes, expected 5`);
    invariant(bytes[0] === 0xbd && bytes[1] === 0x03, "mov.n a11,a3 must encode as bd 03");
    return bytes;
  } finally { await rm(dir, { recursive: true, force: true }); }
}

const app = Buffer.from(await readFile(input));
const image = inspectEsp32AppImage(app);
const irom = image.segments[3];
invariant(irom.loadAddress <= PATCH_VADDR && PATCH_VADDR + 5 <= irom.loadAddress + irom.length,
  "patch address is outside the IROM segment");
const off = irom.dataOffset + (PATCH_VADDR - irom.loadAddress);
const patch = await assemblePatch();
const [from, to] = revert ? [patch, ORIGINAL] : [ORIGINAL, patch];
const current = app.subarray(off, off + 5);
invariant(current.equals(from), `bytes at ${PATCH_VADDR.toString(16)} are ${current.toString("hex")}, expected ${from.toString("hex")}`);
to.copy(app, off);
const repaired = repairEsp32AppIntegrity(app);
const after = inspectEsp32AppImage(repaired);
invariant(after.segmentCount === image.segmentCount && repaired.length === app.length, "image layout changed");
await writeFile(output, repaired);
const sha = (b) => createHash("sha256").update(b).digest("hex");
console.log(JSON.stringify({ status: revert ? "PASS_BT_P1_REVERTED" : "PASS_BT_P1_APPLIED",
  vaddr: `0x${PATCH_VADDR.toString(16)}`, before: from.toString("hex"), after: to.toString("hex"),
  input, inputSha256: sha(await readFile(input)), output, outputSha256: sha(repaired), bytes: repaired.length }, null, 2));
