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
    /* The heap-left-internal-RAM proof, restated for the widget-upload block
     * additions: the frozen release block minus the 64 KiB VM heap, plus the
     * pinned widget-upload state (assets table, upload transaction incl. its
     * admission record, persist bookkeeping, arena pointers - the 3 KiB chunk
     * scratch deliberately lives on the PSRAM staging arena's tail, NOT here).
     * 2026-08-26: +176 B for the multi-widget slot bank (docs/17): per-slot
     * generations (16) + sha16 inventory (64) + active/session/base/arena/
     * activate/switching words (24) + the owner_platform copy kept for
     * activation reinit (60) + padding.  +144 B for Phase B multi-screen:
     * the second screen proxy (proxy_storage_second, 148 B incl. the
     * appended screen_slot word both proxies gained) + the setup-owned
     * adoption arena pointer, net of padding.  The exact figure is pinned so
     * any future in-block growth must come back to this comment and justify
     * itself. */
    to: "const widgetUploadBlockBytes = 2864;\n" + /* +864: 2026-08-26 ONE WIDGET = ONE SCREEN — per-slot resident assets (slot_assets 176 + arena ptrs 16 + slot_sha 128 + per-screen facade contexts 240 + admit/resident/visible flags 12) and a proxy storage per slot (2 -> 4 screens, +296). +960: 2026-08-28 smooth sprite tween state — five facade contexts x sixteen targets x twelve bytes; raster assets remain in PSRAM. */
       /* +32: 2026-08-26 proxy lifecycle forensics counters extended to all 4 screen slots (op 7, paginated by slot) + visible_tick_ms for tick-derived visibility, padding-rounded */
       /* +80: 2026-08-27 ANY-KEY stream proof (proven/cycle fields, 12 B) + module-computed WPM (60 B second-bucket ring + ring cursor + value + keys_60s), padding-rounded */
      
      "invariant(blockBytes === expected.releaseBlockBytes - heapBytes + 16 + " +
      "widgetUploadBlockBytes,\n" +
      "  `PSRAM block size ${blockBytes} is not the frozen release block ` +\n" +
      "  `${expected.releaseBlockBytes} minus the ${heapBytes} B VM heap plus ` +\n" +
      "  `one alignment quantum plus the pinned ${widgetUploadBlockBytes} B of ` +\n" +
      "  `widget-upload state: unexplained internal-RAM drift.`);",
  },
  {
    /* Three more aligned in-block words for widget.mquickjs.diag6: the persist
     * state machine's status, the generation currently sealed into slot B, and
     * the last committed generation observed in the scene-RPC core.  They only
     * exist in psram-module-src/physical_integration.c, which is exactly the
     * translation unit this wrapper points the probe at. */
    what: "persist offset probes",
    from: '  ["BLK_ADOPT_FLAGS", "offsetof(physical_block, target_admitted)"],\n' +
      '  ["BLK_OWNER", "offsetof(physical_block, owner)"],',
    to: '  ["BLK_ADOPT_FLAGS", "offsetof(physical_block, target_admitted)"],\n' +
      '  ["BLK_PERSIST_STATUS", "offsetof(physical_block, scene_persist_status)"],\n' +
      '  ["BLK_PERSIST_GENERATION",\n' +
      '    "offsetof(physical_block, scene_persist_generation)"],\n' +
      '  ["BLK_PERSIST_OBSERVED",\n' +
      '    "offsetof(physical_block, scene_persist_observed)"],\n' +
      '  ["BLK_OWNER", "offsetof(physical_block, owner)"],',
  },
  {
    what: "persist offset invariant",
    from: "invariant((blockProbe.BLK_ADOPT_FLAGS & 3) === 0 &&\n" +
      "  blockProbe.BLK_ADOPT_FLAGS + 4 <= blockProbe.sizeofBlock,\n" +
      "`BLK_ADOPT_FLAGS=${blockProbe.BLK_ADOPT_FLAGS} is not an aligned in-block word.`);",
    to: "invariant((blockProbe.BLK_ADOPT_FLAGS & 3) === 0 &&\n" +
      "  blockProbe.BLK_ADOPT_FLAGS + 4 <= blockProbe.sizeofBlock,\n" +
      "`BLK_ADOPT_FLAGS=${blockProbe.BLK_ADOPT_FLAGS} is not an aligned in-block word.`);\n" +
      "for (const name of [\"BLK_PERSIST_STATUS\", \"BLK_PERSIST_GENERATION\",\n" +
      "  \"BLK_PERSIST_OBSERVED\"]) {\n" +
      "  invariant((blockProbe[name] & 3) === 0 &&\n" +
      "    blockProbe[name] + 4 <= blockProbe.sizeofBlock,\n" +
      "    `${name}=${blockProbe[name]} is not an aligned in-block word.`);\n" +
      "}",
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
const moduleText = await readFile(moduleSource, "utf8");
invariant(
  moduleText.includes("zero_bytes(&block->slot_target[desired],") &&
    moduleText.includes("block->slot_target_admitted[desired] = 0u;"),
  "Slot activation must reset its facade revision context before the fresh " +
    "VM mailbox starts again at revision zero.",
);

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
  /* Diagnostic methods this workstream adds on top of the four the upstream
   * diagnostic loader documents.  build-diag-module.mjs is not edited here, so
   * its own manifest still lists only diag..diag4. */
  diagnosticExtension: {
    methods: {
      "widget.mquickjs.diag5": {
        format: "v5;a=<packed adopt word>;m=<block magic>;b=<boot_state>",
        packedAdoptWord: "target_admitted | heap_claimed<<8 | " +
          "adopt outcome<<16 | first failing step<<24 (bit 0x80 of the step " +
          "additionally means esp_mmu_unmap reported an error)",
      },
      "widget.mquickjs.diag6": {
        format: "v6;p=<packed persist word>;g=<generation now in slot B>;" +
          "c=<committed generation in the scene-RPC core>",
        packedPersistWord: "persist state | step<<8 | renderer-v2 re-arm<<16 " +
          "| started<<24",
        states: "0 idle, 1 armed, 2 erasing, 3 writing payload, " +
          "4 verifying payload, 5 writing header, 6 done, 7 failed",
        rearm: "0 not attempted, 1 waiting for RV2_SWITCH_ACTIVE, " +
          "2 switch returned to EMPTY, 3 no sidecar",
      },
    },
    reader: "experiments/mquickjs-esp32s3-physical-canary/diag-read.mjs",
  },
  bootScenePersistence: {
    slot: "flash paddr 0x240000..0x270000 (slot B), 64-byte header + payload",
    record: "build-scene-slot-b.mjs layout; generation >= 2 with " +
      "expected_generation == generation - 1",
    onBoot: "boot_adopt_default_scene republishes the record and advances the " +
      "scene-RPC committed_generation to the adopted generation, then the " +
      "owner task returns the renderer-v2 switch word to EMPTY once the " +
      "package is ACTIVE so the host can push generation N+1",
    onCommit: "the owner task re-seals slot B payload-first, header LAST, one " +
      "4 KiB sector erase / 1 KiB write / 256 B verify read per tick",
    flashApi: {
      "esp_flash_erase_region": "0x4037f0f0",
      "esp_flash_write": "0x4037f460",
      "esp_flash_read": "0x4037f31c",
      chip: "NULL -> esp_flash_default_chip via chip_check 0x4037edf0",
      regionProtectionEscape:
        "app_func_arg_t::no_protect (os_func_data+4) raised for exactly one " +
        "stock call, because slot B is inside the factory APP partition and " +
        "esp_partition_main_flash_region_safe (0x420c2b44) refuses it",
    },
    proof: "experiments/mquickjs-esp32s3-physical-canary/scene-slot-b-host-proof.mjs",
  },
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
