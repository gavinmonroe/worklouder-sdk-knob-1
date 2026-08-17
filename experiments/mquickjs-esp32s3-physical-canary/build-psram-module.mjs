#!/usr/bin/env node
/* Build the ID28 diagnostic module with the MicroQuickJS heap moved out of the
 * resident internal-RAM block and into PSRAM.
 *
 * build-diag-module.mjs is owned by another workstream and is not edited here.
 * It is also a top-level script (no exported build function) whose module
 * source path and frozen block size are literals, so this wrapper reuses it the
 * only non-invasive way available: it reads the script, applies a small, exact,
 * asserted set of substitutions, writes the result next to the original (so
 * every relative import and `here` still resolve identically), and runs it.
 *
 * Substituted, and nothing else:
 *   1. output directory      -> build-diag-module-psram/ (hard literal, so no
 *                               environment variable can redirect this build
 *                               on top of build-diag-module/)
 *   2. module TU             -> psram-module-src/physical_integration.c
 *   3. include search path   -> psram-module-src/ ahead of the canary dir, so
 *                               the offsetof probe's `#include
 *                               "physical_integration.c"` also picks up the
 *                               PSRAM copy and every BLK_* offset is
 *                               re-derived against the new struct
 *   4. block-size invariant  -> the block must SHRINK by the VM heap size
 *                               (plus at most one 16-byte alignment quantum)
 *                               instead of matching the frozen 95,568 B
 *   5. artifact names        -> *-psram.bin / PSRAM-module-app.bin so the two
 *                               builds can never be confused on the bench
 *
 * No hardware, serial, or flashing is performed.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execute = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(here, "../..");
const original = path.join(here, "build-diag-module.mjs");
const generated = path.join(here, "build-diag-module-psram.generated.mjs");
const outputName = "build-diag-module-psram";
const moduleSource = path.join(here, "psram-module-src/physical_integration.c");

const invariant = (ok, message) => { if (!ok) throw new Error(message); };
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

/* Every entry must match exactly once.  If build-diag-module.mjs is edited in a
 * way that moves any of these, this wrapper fails loudly instead of silently
 * building something else. */
const substitutions = [
  {
    what: "output directory",
    from: 'const output = process.env.FRAMER_DIAG_MODULE_OUTPUT ??\n' +
      '  path.join(here, "build-diag-module");',
    to: `const output = path.join(here, ${JSON.stringify(outputName)});`,
  },
  {
    what: "module translation unit",
    from: '  [path.join(here, "physical_integration.c"), "physical.o",',
    to: '  [path.join(here, "psram-module-src/physical_integration.c"), "physical.o",',
  },
  {
    what: "include search path",
    from: "const includes = [build, diagSource, canary, vendor, resident, target, " +
      "runtimeProof, here];",
    to: "const includes = [build, diagSource, canary, vendor, resident, target, " +
      'runtimeProof, path.join(here, "psram-module-src"), here];',
  },
  {
    what: "block-size invariant",
    from: "invariant(blockBytes === expected.releaseBlockBytes,\n" +
      "  `Diagnostic block size ${blockBytes} moved off the release size ` +\n" +
      "  `${expected.releaseBlockBytes}: the instrumentation escaped the fixed " +
      "runtime storage.`);",
    /* The two replacement pointers do not fit in the padding that preceded
     * static_task, so the block reclaims one 16-byte alignment quantum less
     * than the raw heap size.  Allow exactly one quantum of slack either way
     * and nothing more: anything outside that means the 64 KiB array is still
     * (or partly still) resident in the internal-RAM block. */
    to: "invariant(Math.abs((expected.releaseBlockBytes - blockBytes) - heapBytes) <= 16,\n" +
      "  `PSRAM block size ${blockBytes} did not shrink the frozen ` +\n" +
      "  `${expected.releaseBlockBytes} B block by the ${heapBytes} B VM heap ` +\n" +
      "  `(one 16-byte alignment quantum of slack): the heap did not leave " +
      "internal RAM.`);",
  },
  { what: "text page name", from: '"mqjs-id28-text-page-diag.bin"',
    to: '"mqjs-id28-text-page-psram.bin"' },
  { what: "rodata page name", from: '"mqjs-id28-rodata-page-diag.bin"',
    to: '"mqjs-id28-rodata-page-psram.bin"' },
  { what: "slot name", from: '"mqjs-id28-slot-a-diag.bin"',
    to: '"mqjs-id28-slot-a-psram.bin"' },
  { what: "loader name", from: '"mqjs-id28-resident-loader-diag.bin"',
    to: '"mqjs-id28-resident-loader-psram.bin"' },
  { what: "loader disassembly name", from: '"resident-loader-diag.dis.txt"',
    to: '"resident-loader-psram.dis.txt"' },
  { what: "app name", from: '"framer-0.4.1-mqjs-id28-DIAG-module-app.bin"',
    to: '"framer-0.4.1-mqjs-id28-PSRAM-module-app.bin"' },
  { what: "manifest name", from: '"diag-module-manifest.json"',
    to: '"psram-module-manifest.json"' },
  { what: "manifest format", from: '"framer-f1-mquickjs-diag-module-build-v1"',
    to: '"framer-f1-mquickjs-psram-heap-module-build-v1"' },
  {
    what: "manifest purpose",
    from: 'purpose: "Capture the JS exception text behind framer_mqjs_load = -5 ' +
      'and expose it over widget.mquickjs.diag4"',
    to: 'purpose: "Move the 64 KiB MicroQuickJS heap out of the resident ' +
      'internal-RAM block into PSRAM (MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT, ' +
      'validated inside 0x3c1d0000..0x3c3d0000), keeping the diag4 last_error ' +
      'instrumentation"',
  },
  { what: "status line", from: 'status: "PASS_DIAG_MODULE_BUILT_NO_HARDWARE"',
    to: 'status: "PASS_PSRAM_MODULE_BUILT_NO_HARDWARE"' },
];

const source = await readFile(original, "utf8");
let patched = source;
for (const { what, from, to } of substitutions) {
  const occurrences = patched.split(from).length - 1;
  invariant(occurrences === 1,
    `build-diag-module.mjs changed: expected exactly one "${what}" site, found ` +
    `${occurrences}. Re-derive this wrapper against the new script.`);
  patched = patched.replace(from, to);
}
/* The output directory must be unredirectable. Check live code only: the
 * upstream script documents FRAMER_DIAG_MODULE_OUTPUT in its header comment,
 * and a comment cannot redirect a build. */
const codeLines = patched.split("\n").filter((line) => {
  const trimmed = line.trim();
  return trimmed !== "" && !trimmed.startsWith("//") && !trimmed.startsWith("*") &&
    !trimmed.startsWith("/*");
});
invariant(codeLines.every((line) =>
  !line.includes("FRAMER_DIAG_MODULE_OUTPUT") &&
  !line.includes('path.join(here, "build-diag-module")')),
"Patched build script can still be redirected onto build-diag-module/.");
invariant(patched.includes(`const output = path.join(here, ${JSON.stringify(outputName)});`),
  "Patched build script lost its pinned PSRAM output directory.");
invariant(patched.includes("psram-module-src/physical_integration.c"),
  "Patched build script does not reference the PSRAM module source.");

await writeFile(generated, patched);
const { stdout } = await execute(process.execPath, [generated], {
  cwd: repository, maxBuffer: 64 * 1024 * 1024,
});
const inner = JSON.parse(stdout);
const manifestPath = path.join(here, outputName, "psram-module-manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

const wrapper = {
  status: "PASS_PSRAM_MODULE_WRAPPER_NO_HARDWARE",
  hardwareTouched: false,
  generatedFrom: {
    script: path.relative(repository, original),
    sha256: sha(source),
    generatedScript: path.relative(repository, generated),
    generatedSha256: sha(patched),
    substitutions: substitutions.map(({ what }) => what),
  },
  moduleSource: {
    file: path.relative(repository, moduleSource),
    sha256: sha(await readFile(moduleSource)),
    baseline: path.relative(repository, path.join(here, "physical_integration.c")),
    baselineSha256: sha(await readFile(path.join(here, "physical_integration.c"))),
  },
  /* Device->host value channel.  The on-device capability formatter
   * (framer_runtime_capability_format in
   * experiments/mquickjs-esp32s3-runtime-proof/runtime_proof.c) is a frozen
   * release translation unit this workstream does not edit, and it advertises
   * no telemetry page count at all: cap page 12's `methods=0f` is the
   * four-method RPC bitmask, not a page count.  Pages 6 and 7 are therefore an
   * extension advertised only here, in the build manifest.  Hosts that only
   * know the release protocol keep polling pages 0..5 and never see them. */
  telemetryExtension: {
    method: "widget.mquickjs.telemetry",
    pages: [6, 7],
    protocol: "slot-pages-session-free-v1",
    format: "v1;p=<6|7>;s<slot>=<8 lower-case hex digits> x8",
    slots: { 6: "0..7", 7: "8..15" },
    encoding: "raw 32-bit word; negative values arrive as two's complement",
    maxLength: 108,
    source: "framer_resident_mailbox at block->owner.mailbox",
    consistency:
      "mailbox seqlock, same discipline as framer_resident_mailbox_try_read / " +
      "framer_tf_snapshot_mailbox, bounded to FRAMER_TF_SNAPSHOT_ATTEMPTS (3); " +
      "a persistently torn read answers blocked",
    sessionFree:
      "pages 6/7 bypass the p0-locks-snapshot-ordered-p1-p5-expiry-clear-v1 " +
      "session: no runtime_telemetry_lock, no expected_page mutation, safe to " +
      "poll at ~1 Hz alongside an in-flight p0..p5 transaction",
    capabilityAdvertised: false,
    capabilityNote:
      "runtime_proof.c is a release TU; FRAMER_PHYSICAL_TELEMETRY_PAGES stays 6 " +
      "and framer_runtime_telemetry_format still rejects page > 5",
    reader: "experiments/mquickjs-esp32s3-physical-canary/diag-read.mjs",
  },
  build: inner,
  flashPlan: manifest.flashPlan,
  rollback: manifest.rollback,
};
await writeFile(path.join(here, outputName, "psram-wrapper-manifest.json"),
  `${JSON.stringify(wrapper, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(wrapper, null, 2)}\n`);
