import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  buildRenderV2MQuickJsPackage,
  decodeRenderV2MQuickJsPackage,
  RENDER_V2_MQUICKJS_PACKAGE_ABI_SHA256,
  RENDER_V2_MQUICKJS_PROFILE_ID,
  RENDER_V2_MQUICKJS_SOURCE_PREFIX,
} from "framer-f1-research-widget-sdk/renderer-v2";

const here = path.dirname(fileURLToPath(import.meta.url));

export const CANARY_EXAMPLE_GENERATION = 1;

export async function buildCanaryExample() {
  const source = await readFile(path.join(here, "canary-widget.js"), "utf8");
  const value = buildRenderV2MQuickJsPackage({
    source,
    generation: CANARY_EXAMPLE_GENERATION,
    events: {
      "tick.1s": true,
      "input.fn-bottom-knob": true,
      hostRpcIds: [0x7001],
      // Synthetic documentation tokens: these are not physical F1 key identities.
      keys: [
        { id: 0, nativeToken: 0x10203040 },
        { id: 1, nativeToken: 0x50607080 },
      ],
      chords: [{ id: 0, heldMask: 0b11 }],
    },
    input: { debounceMs: 10, holdDelayMs: 500, holdCadenceMs: 100 },
  });

  const decoded = decodeRenderV2MQuickJsPackage(value.binary);
  assert.equal(decoded.sha256, value.sha256);
  assert.equal(decoded.source, `${RENDER_V2_MQUICKJS_SOURCE_PREFIX}${source}`);
  assert.equal(decoded.execution.deviceEvaluatesJavaScript, true);
  assert.equal(decoded.execution.deviceRunsJsdom, false);
  return value;
}

export function canaryExampleSummary(value) {
  return Object.freeze({
    status: "OFFLINE_PACKAGE_ONLY_NOT_DEVICE_APPROVAL",
    profileId: RENDER_V2_MQUICKJS_PROFILE_ID,
    packageAbiSha256: RENDER_V2_MQUICKJS_PACKAGE_ABI_SHA256,
    generation: value.generation,
    bytes: value.bytes,
    sha256: value.sha256,
    sourceSha256: value.sourceSha256,
    budget: value.budget,
    syntheticNativeTokens: true,
    hardwareRuntimeProven: false,
  });
}

async function main() {
  const value = await buildCanaryExample();
  const output = path.join(here, "build");
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, "timer-multi-input.f2js"), value.binary);
  await writeFile(path.join(output, "manifest.json"),
    `${JSON.stringify(canaryExampleSummary(value), null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(canaryExampleSummary(value))}\n`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
