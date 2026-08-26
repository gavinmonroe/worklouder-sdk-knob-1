#!/usr/bin/env node
// BLE debug-screen enable patch (see experiments/BT-RECONNECT-INVESTIGATION.md §A2):
// the stock 0.4.1 screen-group builder 0x420293c8 always registers diagnostic
// screen IDs 6, 4 and 5 in the *catalog* (0x420290fc) but only appends them to the
// Fn+dial *navigation ring* (0x420293a8) when its bool argument is set:
//   0x42029479: beqz.n a3, 0x42029490    (9c 33)   -> skip the three nav_add calls
// Replacing that branch with a 2-byte nop.n makes the three nav_add calls
// unconditional, so screen ID 5 -- the `ble dbg...` BLE diagnostics screen
// (controller vtable 0x3c1ab7d0, renderer 0x4201f46c, id stub 0x4210887c => 5) --
// is always reachable by turning the dial.
//
// Same-length, in-place; the image checksum + appended SHA-256 are repaired.
//
//   node custom-firmware/apply-ble-debug-screen-patch.mjs --in APP.bin --out APP-bledbg.bin [--revert]
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

const PATCH_VADDR = 0x42029479;
const ORIGINAL = Buffer.from("9c33", "hex"); // beqz.n a3, 0x42029490
const EXPECTED_PATCH = Buffer.from("3df0", "hex"); // nop.n
// Guard bytes: the three nav_add(id) call sites that the branch skips. If these
// move, the branch target is no longer "skip the nav registration" and the patch
// would silently change unrelated control flow.
const GUARDS = [
  { vaddr: 0x4202947b, bytes: "0c6bad02a5f2ff" }, // movi.n a11,6 ; mov.n a10,a2 ; call8 0x420293a8
  { vaddr: 0x42029482, bytes: "0c4bad0225f2ff" }, // movi.n a11,4 ; mov.n a10,a2 ; call8 0x420293a8
  { vaddr: 0x42029489, bytes: "0c5bad02a5f1ff" }, // movi.n a11,5 ; mov.n a10,a2 ; call8 0x420293a8
  { vaddr: 0x42029490, bytes: "1df0" }, //          retw.n  (the branch target)
  { vaddr: 0x4210887c, bytes: "3641000c521df0" }, // ble-dbg controller id stub: entry ; movi.n a2,5 ; retw.n
];
const invariant = (ok, m) => { if (!ok) throw new Error(m); };

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const input = opt("--in"); const output = opt("--out"); const revert = args.includes("--revert");
invariant(input && output, "usage: --in APP.bin --out PATCHED.bin [--revert]");

async function assemblePatch() {
  const dir = await mkdtemp(path.join(tmpdir(), "ble-dbg-"));
  try {
    const src = path.join(dir, "dbg.S"), obj = path.join(dir, "dbg.o"), ld = path.join(dir, "dbg.ld"),
      elf = path.join(dir, "dbg.elf"), raw = path.join(dir, "dbg.bin");
    await writeFile(src, `.section .text.patch,"ax",@progbits\n.global patch\npatch:\nnop.n\n`);
    await writeFile(ld, `SECTIONS { .text.patch 0x${PATCH_VADDR.toString(16)} : { *(.text.patch) } }\n`);
    await run(xtensa("gcc"), ["-c", src, "-o", obj]);
    await run(xtensa("ld"), ["-T", ld, obj, "-o", elf]);
    await run(xtensa("objcopy"), ["-O", "binary", "-j", ".text.patch", elf, raw]);
    const bytes = await readFile(raw);
    invariant(bytes.length === 2, `patch assembled to ${bytes.length} bytes, expected 2`);
    invariant(bytes.equals(EXPECTED_PATCH), `nop.n must encode as ${EXPECTED_PATCH.toString("hex")}, got ${bytes.toString("hex")}`);
    return bytes;
  } finally { await rm(dir, { recursive: true, force: true }); }
}

const app = Buffer.from(await readFile(input));
const image = inspectEsp32AppImage(app);
const irom = image.segments[3];
const at = (vaddr, len) => {
  invariant(irom.loadAddress <= vaddr && vaddr + len <= irom.loadAddress + irom.length,
    `0x${vaddr.toString(16)} is outside the IROM segment`);
  return irom.dataOffset + (vaddr - irom.loadAddress);
};
for (const g of GUARDS) {
  const want = Buffer.from(g.bytes, "hex");
  const got = app.subarray(at(g.vaddr, want.length), at(g.vaddr, want.length) + want.length);
  invariant(got.equals(want),
    `guard at 0x${g.vaddr.toString(16)} is ${got.toString("hex")}, expected ${want.toString("hex")} — image is not stock 0.4.1 here`);
}
const off = at(PATCH_VADDR, 2);
const patch = await assemblePatch();
const [from, to] = revert ? [patch, ORIGINAL] : [ORIGINAL, patch];
const current = app.subarray(off, off + 2);
invariant(current.equals(from), `bytes at ${PATCH_VADDR.toString(16)} are ${current.toString("hex")}, expected ${from.toString("hex")}`);
to.copy(app, off);
const repaired = repairEsp32AppIntegrity(app);
const after = inspectEsp32AppImage(repaired);
invariant(after.segmentCount === image.segmentCount && repaired.length === app.length, "image layout changed");
await writeFile(output, repaired);
const sha = (b) => createHash("sha256").update(b).digest("hex");
console.log(JSON.stringify({ status: revert ? "PASS_BLE_DEBUG_SCREEN_REVERTED" : "PASS_BLE_DEBUG_SCREEN_APPLIED",
  vaddr: `0x${PATCH_VADDR.toString(16)}`, before: from.toString("hex"), after: to.toString("hex"),
  navScreenIds: [6, 4, 5], bleDebugScreenId: 5, guardsChecked: GUARDS.length,
  input, inputSha256: sha(await readFile(input)), output, outputSha256: sha(repaired), bytes: repaired.length }, null, 2));
