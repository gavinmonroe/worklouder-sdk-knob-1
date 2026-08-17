#!/usr/bin/env node
// Guarded APP-ONLY write for follow-up mqjs canary images (diagnostic loader,
// loader tweaks) whose slot-A pages are already on flash. Mirrors deploy.mjs:
// identity gate, partition-table check, pre-write app read-back must match the
// expected currently-installed app, esptool write with hash verification, full
// read-back byte-exact, then watchdog reset. Chip must already be in ROM.
//
// Two read-back modes, chosen by which --expect-live-* flag is given:
//
//   full-readback (--expect-live-sha SHA): reads the entire 2 MB app region
//   before and after the write and requires each to byte-equal SHA / the new
//   app. Two ~3 min reads at 115200 baud.
//
//   fast-diff (--expect-live-app FILE): FILE is the exact app bytes already
//   believed live on device. Pre-write, only the byte ranges that differ
//   between FILE and the new app (plus fixed first/last/25%/50%/75% 4 KiB
//   sample windows) are read back and compared against FILE; post-write, the
//   same ranges are read back and compared against the new app. Skips reading
//   the untouched majority of the image, which is the point when iterating on
//   a loader that only touches a few KB. The full write is still verified by
//   esptool's on-device "Hash of data verified" hash of the whole write.
//
//   node deploy-app-only.mjs --app FILE --expect-live-sha SHA --port /dev/cu.usbmodemXXXX \
//        --out DIR --confirm APPONLY_<first16 of app sha, upper> --execute
//
//   node deploy-app-only.mjs --app FILE --expect-live-app PRIOR_APP_FILE --port /dev/cu.usbmodemXXXX \
//        --out DIR --confirm APPONLY_<first16 of app sha, upper> --execute

import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { PINNED, assertPort, hex, invariant, sha256 } from "./contract.mjs";
import { inspectEsp32AppImage } from "../../custom-firmware/lib/esp-app-image.mjs";

const executeFile = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const esptool = path.join(root, ".venv-esptool/bin/esptool");
const FORBIDDEN = new Set(["erase-flash", "erase-region", "erase-all", "--erase-all", "--force",
  "--encrypt", "--ignore-flash-enc-efuse", "merge-bin"]);
const recoveryFile = path.join(root,
  "recovery/backups/2026-08-15-framer-f1-a4cb8faf3210-before-custom/full-flash-16mb.bin");

const FIXED_WINDOW_BYTES = 4096;
const DIFF_COALESCE_GAP_BYTES = 32;
const SAMPLE_FRACTIONS = [0.25, 0.5, 0.75];

function parse(argv) {
  const o = { execute: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (["--app", "--expect-live-sha", "--expect-live-app", "--port", "--out", "--confirm"].includes(a)) {
      const v = argv[++i]; invariant(v && !v.startsWith("--"), `${a} requires a value.`);
      o[a.slice(2).replaceAll("-", "_")] = v;
    } else if (a === "--execute") o.execute = true;
    else throw new Error(`Unknown argument ${a}.`);
  }
  for (const k of ["app", "port", "out", "confirm"])
    invariant(o[k], `--${k.replaceAll("_", "-")} is required.`);
  invariant(o.execute, "app-only write requires --execute.");
  assertPort(o.port);
  invariant((o.expect_live_sha === undefined) !== (o.expect_live_app === undefined),
    "Exactly one of --expect-live-sha or --expect-live-app is required.");
  if (o.expect_live_sha !== undefined) {
    invariant(/^[0-9a-f]{64}$/u.test(o.expect_live_sha), "--expect-live-sha must be a sha256 hex.");
  }
  o.mode = o.expect_live_app !== undefined ? "fast-diff" : "full-readback";
  return o;
}

async function esp(args) {
  for (const a of args) invariant(!FORBIDDEN.has(a), `Forbidden esptool argument ${a}.`);
  invariant(args.filter((a) => a === "write-flash" || a === "read-flash").length <= 1,
    "One flash operation per invocation.");
  return executeFile(esptool, args, { cwd: root, maxBuffer: 16 * 1024 * 1024 });
}
const common = (port) => ["--chip", "esp32s3", "--port", port, "--baud", "115200", "--after", "no-reset"];

async function readRegion(port, offset, bytes, file) {
  await esp([...common(port), "read-flash", "--no-progress", hex(offset), hex(bytes), file]);
  const data = await readFile(file);
  invariant(data.length === bytes, `Readback ${file} length ${data.length} != ${bytes}.`);
  return { file, offset, bytes, sha256: sha256(data), data };
}

// Diff-range computation used by fast-diff mode. Pure function of the two app
// buffers: no I/O, no device access, safe to unit test directly.
function diffRuns(before, after) {
  const length = before.length;
  const runs = [];
  let offset = 0;
  while (offset < length) {
    while (offset < length && before[offset] === after[offset]) offset += 1;
    if (offset === length) break;
    const start = offset;
    while (offset < length && before[offset] !== after[offset]) offset += 1;
    runs.push({ start, end: offset });
  }
  // Coalesce close changed spans into auditable ranges, matching the approach
  // in prepare-approval.mjs's patchRanges.
  const merged = [];
  for (const run of runs) {
    const previous = merged.at(-1);
    if (previous && run.start - previous.end <= DIFF_COALESCE_GAP_BYTES) previous.end = run.end;
    else merged.push({ ...run });
  }
  return merged;
}

function fixedWindow(length, start) {
  const clampedStart = Math.min(Math.max(start, 0), Math.max(length - FIXED_WINDOW_BYTES, 0));
  return { start: clampedStart, end: Math.min(clampedStart + FIXED_WINDOW_BYTES, length) };
}

function mergeRanges(ranges) {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

/**
 * Compute the read ranges fast-diff mode must verify pre- and post-write:
 * every byte span that differs between `before` (expected-live app) and
 * `after` (new app), plus fixed 4 KiB sample windows at the start, end, and
 * 25/50/75% of the image. Overlapping/touching ranges are merged. `before`
 * and `after` must be the same length.
 */
export function computeFastDiffRanges(before, after) {
  invariant(Buffer.isBuffer(before) && Buffer.isBuffer(after), "Fast-diff requires Buffer inputs.");
  invariant(before.length === after.length,
    "Expected-live app and new app must be the same length for fast-diff mode.");
  const length = before.length;
  const runs = diffRuns(before, after);
  const windows = [
    fixedWindow(length, 0),
    ...SAMPLE_FRACTIONS.map((fraction) => fixedWindow(length, Math.floor(length * fraction))),
    fixedWindow(length, length - FIXED_WINDOW_BYTES),
  ];
  const merged = mergeRanges([...runs, ...windows]);
  return merged.map(({ start, end }) => Object.freeze({ offset: start, bytes: end - start, end }));
}

async function main(o) {
  const appFile = path.resolve(o.app);
  const app = await readFile(appFile);
  const appSha = sha256(app);
  const token = `APPONLY_${appSha.slice(0, 16).toUpperCase()}`;
  invariant(o.confirm === token, `Confirmation mismatch. Exact token: ${token}`);
  const image = inspectEsp32AppImage(app);
  invariant(image.segmentCount === 6 && app.length === PINNED.healthyApp.bytes,
    "App must be a six-segment image of the pinned candidate size.");
  invariant(PINNED.healthyApp.offset + app.length <= 0x208000, "App exceeds the accepted app range.");
  const recovery = await readFile(recoveryFile);
  invariant(recovery.length === PINNED.recovery.bytes && sha256(recovery) === PINNED.recovery.sha256,
    "Same-device full-flash recovery backup changed.");
  const partitionExpected = sha256(recovery.subarray(PINNED.partitionTable.offset,
    PINNED.partitionTable.offset + PINNED.partitionTable.bytes));

  let expectLiveApp = null;
  let expectLiveSha = o.expect_live_sha;
  let ranges = null;
  if (o.mode === "fast-diff") {
    expectLiveApp = await readFile(path.resolve(o.expect_live_app));
    invariant(expectLiveApp.length === app.length,
      "Expected-live app and new app must be the same length for fast-diff mode.");
    expectLiveSha = sha256(expectLiveApp);
    ranges = computeFastDiffRanges(expectLiveApp, app);
  }

  const out = path.resolve(o.out);
  await mkdir(out, { recursive: false });
  const journalFile = path.join(out, "operation-journal.json");
  const state = { format: "framer-f1-mquickjs-app-only-receipt-v1", status: "STARTED_NO_WRITE",
    mode: o.mode, startedAt: new Date().toISOString(), app: { file: appFile, bytes: app.length,
      sha256: appSha, offset: PINNED.healthyApp.offset }, expectLiveSha256: expectLiveSha, phases: [] };
  if (ranges) state.ranges = ranges.map(({ offset, bytes, end }) => ({ offset, bytes, end }));
  const journal = () => writeFile(journalFile, JSON.stringify(state, null, 2) + "\n");
  await journal();
  try {
    const chip = await esp([...common(o.port), "chip-id"]);
    invariant(/ESP32-S3/iu.test(chip.stdout), "Serial target is not ESP32-S3.");
    const mac = await esp([...common(o.port), "read-mac"]);
    invariant(mac.stdout.match(/(?:MAC|Address):\s*([0-9a-f:]{17})/iu)?.[1]?.toLowerCase() === PINNED.mac,
      "Serial target MAC differs from the same-device backup.");
    const sec = await esp([...common(o.port), "--no-stub", "get-security-info"]);
    invariant(/Secure Boot:\s*Disabled/iu.test(sec.stdout) && /Flash Encryption:\s*Disabled/iu.test(sec.stdout),
      "Secure Boot or Flash Encryption differs from the recovery proof.");
    const flash = await esp([...common(o.port), "flash-id"]);
    invariant(/Detected flash size:\s*16MB/iu.test(flash.stdout), "Detected flash is not exact 16 MB.");
    state.phases.push({ phase: "identity", status: "PASS_READ_ONLY", mac: PINNED.mac });

    const partition = await readRegion(o.port, PINNED.partitionTable.offset, PINNED.partitionTable.bytes,
      path.join(out, "partition-table-before.bin"));
    invariant(partition.sha256 === partitionExpected, "Live partition table differs from the recovery backup.");

    if (o.mode === "fast-diff") {
      const rangeResults = [];
      let totalReadBytes = 0;
      for (const [index, range] of ranges.entries()) {
        const file = path.join(out, `app-before-range-${index}.bin`);
        const read = await readRegion(o.port, PINNED.healthyApp.offset + range.offset, range.bytes, file);
        const expectedSha256 = sha256(expectLiveApp.subarray(range.offset, range.end));
        invariant(read.sha256 === expectedSha256,
          `Live app is not the expected image at range ${hex(range.offset)}..${hex(range.end)}; refusing to write.`);
        rangeResults.push({ offset: range.offset, bytes: range.bytes, end: range.end,
          expectedSha256, actualSha256: read.sha256 });
        totalReadBytes += range.bytes;
      }
      state.phases.push({ phase: "baseline", status: "PASS_READ_ONLY", mode: "fast-diff",
        ranges: rangeResults, totalReadBytes });
    } else {
      const before = await readRegion(o.port, PINNED.healthyApp.offset, app.length, path.join(out, "app-before.bin"));
      invariant(before.sha256 === expectLiveSha,
        `Live app is ${before.sha256}, expected ${expectLiveSha}; refusing to write.`);
      state.phases.push({ phase: "baseline", status: "PASS_READ_ONLY", mode: "full-readback",
        appSha256: before.sha256, totalReadBytes: app.length });
    }
    state.status = "WRITE_STARTED_APP"; await journal();

    const write = await esp(["--chip", "esp32s3", "--port", o.port, "--baud", "921600", "--after", "no-reset",
      "write-flash", "--flash-size", "keep", hex(PINNED.healthyApp.offset), appFile]);
    invariant(/Hash of data verified/iu.test(`${write.stdout}\n${write.stderr ?? ""}`),
      "esptool did not verify the write hash.");

    if (o.mode === "fast-diff") {
      const rangeResults = [];
      let totalReadBytes = 0;
      for (const [index, range] of ranges.entries()) {
        const file = path.join(out, `app-after-range-${index}.bin`);
        const read = await readRegion(o.port, PINNED.healthyApp.offset + range.offset, range.bytes, file);
        const expectedSha256 = sha256(app.subarray(range.offset, range.end));
        invariant(read.sha256 === expectedSha256,
          `App readback mismatch at range ${hex(range.offset)}..${hex(range.end)}; ` +
          "do not reset. Restore healthy app via ROM.");
        rangeResults.push({ offset: range.offset, bytes: range.bytes, end: range.end,
          expectedSha256, actualSha256: read.sha256 });
        totalReadBytes += range.bytes;
      }
      state.phases.push({ phase: "app", status: "PASS_BYTE_EXACT", mode: "fast-diff",
        write: { baud: 921600, hashVerifiedByEsptool: true }, ranges: rangeResults, totalReadBytes });
    } else {
      const readback = await readRegion(o.port, PINNED.healthyApp.offset, app.length,
        path.join(out, "app-readback.bin"));
      invariant(readback.sha256 === appSha, "App readback mismatch; do not reset. Restore healthy app via ROM.");
      state.phases.push({ phase: "app", status: "PASS_BYTE_EXACT", mode: "full-readback",
        write: { baud: 921600, hashVerifiedByEsptool: true },
        readback: { bytes: readback.bytes, sha256: readback.sha256 }, totalReadBytes: app.length });
    }
    state.status = "PASS_READBACK_REBOOTING"; await journal();
    await esp(["--chip", "esp32s3", "--port", o.port, "--baud", "115200", "--after", "watchdog-reset", "chip-id"]);
    state.status = "PASS_APP_ONLY_REBOOTED_HEALTH_PENDING";
    state.finishedAt = new Date().toISOString();
    await journal();
    await writeFile(path.join(out, "flash-receipt.json"), JSON.stringify(state, null, 2) + "\n", { flag: "wx" });
    process.stdout.write(JSON.stringify(state, null, 2) + "\n");
  } catch (error) {
    state.status = "FAILED_STOPPED"; state.error = error.message;
    await journal().catch(() => {});
    process.stderr.write(`BLOCKED: ${error.message}\n`);
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  await main(parse(process.argv.slice(2)));
}
