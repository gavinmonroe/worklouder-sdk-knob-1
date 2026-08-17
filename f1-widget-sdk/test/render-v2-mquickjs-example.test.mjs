import assert from "node:assert/strict";
import { test } from "node:test";

import {
  RENDER_V2_MQUICKJS_PACKAGE_ABI_SHA256,
  RENDER_V2_MQUICKJS_PROFILE_ID,
} from "../src/render-v2/index.mjs";
import {
  buildCanaryExample,
  canaryExampleSummary,
} from "../examples/render-v2-mquickjs-canary/build.mjs";

test("MicroQuickJS canary example builds one deterministic bounded F2JS package", async () => {
  const first = await buildCanaryExample();
  const second = await buildCanaryExample();
  assert.deepEqual(first.binary, second.binary);
  assert.equal(first.sha256, second.sha256);
  assert.equal(first.events.filter(({ kind }) => kind === 5).length, 2);
  assert.deepEqual(first.events.find(({ kind }) => kind === 6),
    { kind: 6, id: 0, nativeToken: 0, heldMask: 3 });
  assert.equal(first.input.keyCount, 2);
  assert.equal(first.input.chordCount, 1);
  assert.ok(first.budget.sourceBytes <= 8_192);

  const summary = canaryExampleSummary(first);
  assert.equal(summary.profileId, RENDER_V2_MQUICKJS_PROFILE_ID);
  assert.equal(summary.packageAbiSha256, RENDER_V2_MQUICKJS_PACKAGE_ABI_SHA256);
  assert.equal(summary.syntheticNativeTokens, true);
  assert.equal(summary.hardwareRuntimeProven, false);
});
