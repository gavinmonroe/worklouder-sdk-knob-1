#!/usr/bin/env node
// BT reconnect fix "P3" (see experiments/BT-RECONNECT-INVESTIGATION.md §A/P3):
// clamp the stock BLE advertising ladder so a bonded slot keeps advertising at
// step 3 (~331 ms) instead of stepping to step 9 (~1.29 s) at the 180 s session
// cap. macOS's low-duty reconnect scan misses a 1.29 s advertiser for minutes;
// Windows does not. Two 2-byte in-place patches:
//   0x42038049: 0c 9a (movi.n a10,9) -> 0c 3a (movi.n a10,3)   ladder walk clamp
//   0x42038018: 0c 98 (movi.n a8,9)  -> 0c 38 (movi.n a8,3)    180 s cap pins step 3
//   node custom-firmware/apply-bt-p3-patch.mjs --in APP.bin --out APP-p3.bin [--revert]
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { inspectEsp32AppImage, repairEsp32AppIntegrity } from "./lib/esp-app-image.mjs";
const SITES = [
  { vaddr: 0x42038049, before: "0c9a", after: "0c3a", note: "adv_ladder_step_impl walk clamp step 9 -> 3" },
  { vaddr: 0x42038018, before: "0c98", after: "0c38", note: "180 s session cap step 9 -> 3" },
];
const invariant = (ok, m) => { if (!ok) throw new Error(m); };
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const input = opt("--in"), output = opt("--out"), revert = args.includes("--revert");
invariant(input && output, "usage: --in APP.bin --out PATCHED.bin [--revert]");
const app = Buffer.from(await readFile(input));
const image = inspectEsp32AppImage(app);
const irom = image.segments[3];
for (const s of SITES) {
  const [from, to] = revert ? [s.after, s.before] : [s.before, s.after];
  invariant(irom.loadAddress <= s.vaddr && s.vaddr + 2 <= irom.loadAddress + irom.length, "site outside IROM");
  const off = irom.dataOffset + (s.vaddr - irom.loadAddress);
  const cur = app.subarray(off, off + 2).toString("hex");
  invariant(cur === from, `bytes at 0x${s.vaddr.toString(16)} are ${cur}, expected ${from} (${s.note})`);
  Buffer.from(to, "hex").copy(app, off);
}
const repaired = repairEsp32AppIntegrity(app);
invariant(inspectEsp32AppImage(repaired).segmentCount === image.segmentCount && repaired.length === app.length, "layout changed");
await writeFile(output, repaired);
const sha = (b) => createHash("sha256").update(b).digest("hex");
console.log(JSON.stringify({ status: revert ? "PASS_BT_P3_REVERTED" : "PASS_BT_P3_APPLIED", sites: SITES.map((s) => ({ vaddr: `0x${s.vaddr.toString(16)}`, note: s.note })), inputSha256: sha(await readFile(input)), outputSha256: sha(repaired) }, null, 2));
