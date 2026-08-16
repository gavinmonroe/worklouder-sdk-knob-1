import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { auditFramerScreenRegistry } from "../../custom-firmware/lib/framer-registry-audit.mjs";
import { buildMusicId1Candidate } from "../examples/music-player/on-device/build-candidate.mjs";
import { PINNED, WORKSPACE_ROOT } from "./constants.mjs";
import { assert, sha256, stableJson } from "./util.mjs";

const MUSIC_ROOT = path.join(WORKSPACE_ROOT, "f1-widget-sdk/examples/music-player/on-device");
const WPM_SOURCE = path.join(WORKSPACE_ROOT, "custom-firmware/experimental/stage3e34-wpm-pet.S");
const MUSIC_FILES = [
  "build-candidate.mjs", "music-player-id1.S", "music-player-id1.ld",
  "combined-setup-wrapper.S.tmpl", "combined-integration.json",
].map((name) => path.join(MUSIC_ROOT, name));

function hashMany(entries) {
  const hash = createHash("sha256");
  for (const [name, bytes] of entries) hash.update(name).update("\0").update(bytes).update("\0");
  return hash.digest("hex");
}

async function readJson(file) {
  try { return JSON.parse(await readFile(file, "utf8")); } catch { return undefined; }
}

export const COMBINED_REGISTRATION_ADAPTER = Object.freeze({
  status: "BLOCKED_ON_WPM_REGISTRATION_ONLY_EXPORT",
  requiredSymbol: "stage3e34_register_wpm",
  arguments: Object.freeze(["a2=screenRegistry", "a3=navigationManager"]),
  return: "a2=allocated controller or zero",
  requirements: Object.freeze([
    "must not call stock setup",
    "must allocate and initialize only the WPM ID7 controller",
    "must register the controller before adding navigation ID7",
    "must add navigation ID7 only when allocation/registration succeeds",
    "must retain screen-local Fn+bottom encoder slot 9 and all WPM object ownership",
  ]),
  combinedOrder: Object.freeze([
    "stock setup exactly once", "resolve registry/navigation exactly once",
    "music_id1_register", "stage3e34_register_wpm", "return preserved stock value",
  ]),
});

export async function prepareCombinedIntegration({ outputDirectory } = {}) {
  const outputRoot = path.resolve(outputDirectory);
  const musicOutput = path.join(outputRoot, "music-id1");
  await mkdir(musicOutput, { recursive: true });
  const cachePath = path.join(musicOutput, ".music-id1-cache.json");
  const entries = await Promise.all(MUSIC_FILES.map(async (file) => [path.basename(file), await readFile(file)]));
  const toolEntries = await Promise.all(Object.entries(PINNED.toolchain).map(async ([name, expected]) => {
    const bytes = await readFile(path.join(PINNED.toolchainDirectory, `xtensa-esp32s3-elf-${name}`));
    assert(sha256(bytes) === expected, `Pinned ${name} toolchain hash failed for music ABI.`);
    return [name, bytes];
  }));
  const fingerprint = hashMany([...entries, ...toolEntries]);
  const cache = await readJson(cachePath) ?? {};
  const manifestPath = path.join(musicOutput, "manifest.json");
  const abiPath = path.join(musicOutput, "music-id1-abi.bin");
  let manifest = await readJson(manifestPath);
  let abi;
  let cacheHit = false;
  try {
    abi = await readFile(abiPath);
    cacheHit = cache.fingerprint === fingerprint && manifest?.code?.sha256 === sha256(abi) &&
      manifest.code.sha256 === cache.abiSha256;
  } catch { cacheHit = false; }
  if (!cacheHit) {
    const result = await buildMusicId1Candidate({ output: musicOutput });
    manifest = result.manifest;
    abi = result.bytes;
  }
  assert(manifest.screenId === 1 && manifest.code.sha256 === sha256(abi) &&
    manifest.memory.appendedDromBytes === 0 && manifest.safety.callsStockSetup === false &&
    manifest.safety.navigationIdAddedOnlyAfterRegistryAssociation === true,
  "Music ID1 registration ABI contract changed.");

  const officialApp = await readFile(path.join(WORKSPACE_ROOT, "artifacts/firmware/framer_app_0.4.1.bin"));
  const registry = auditFramerScreenRegistry(officialApp);
  assert(registry.controllerIds.includes(8), "Stock registry no longer proves ID8 occupied.");
  assert(JSON.stringify(registry.unusedIds) === JSON.stringify([1, 7]),
    "Stock unused screen-ID contract changed; expected only ID1 and ID7.");

  const wpmSource = await readFile(WPM_SOURCE, "utf8");
  const hasWpmRegistrationExport = /\.global\s+stage3e34_register_wpm\b/u.test(wpmSource) &&
    /^stage3e34_register_wpm:/mu.test(wpmSource);
  const report = {
    format: "framer-f1-combined-id1-id7-sdk-preflight-v1",
    status: hasWpmRegistrationExport ? "READY_FOR_FINAL_COMBINED_LINK_AUDIT" :
      COMBINED_REGISTRATION_ADAPTER.status,
    appImageProduced: false,
    stockRegistry: { occupiedId8: true, unusedIds: registry.unusedIds,
      musicScreenId: 1, wpmScreenId: 7 },
    music: { screenId: 1, abi: { file: abiPath, bytes: abi.length, sha256: sha256(abi) },
      appendedDromBytes: 0, callsStockSetup: false, cache: cacheHit ? "hit" : "miss",
      integrationHarness: manifest.code.integrationHarness },
    setup: { owner: "sole combined wrapper", stockSetupCalls: 1,
      order: COMBINED_REGISTRATION_ADAPTER.combinedOrder },
    wpmAdapter: hasWpmRegistrationExport ? { status: "export-found; final link/audit still required" } :
      COMBINED_REGISTRATION_ADAPTER,
    blocker: hasWpmRegistrationExport ?
      "Final combined linker/composer must replace the pet-only setup ABI and run exact image mutation audit." :
      "WPM source still owns setup and has no registration-only entry; the stub harness is not device code.",
    hardwareAccess: false,
  };
  await Promise.all([
    writeFile(path.join(outputRoot, "combined-id1-id7-preflight.json"), stableJson(report)),
    writeFile(cachePath, stableJson({ fingerprint, abiSha256: sha256(abi) })),
  ]);
  return Object.freeze({ report, manifest, abi, outputRoot });
}
