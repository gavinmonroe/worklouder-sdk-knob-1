#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { packWeatherCurrent, packWeatherDay } from "../../f1-widget-sdk/src/render-v2/weather.mjs";
import { PINNED, validateApproval, verifyApprovalFiles } from "./contract.mjs";

const revision = 18;
const weather = Object.freeze([
  Object.freeze({ id: 0xb240, value: revision, auxiliary: 0 }),
  Object.freeze({ id: 0xb241,
    value: packWeatherCurrent({ temperature: 72, condition: { id: 0, isDay: true } }),
    auxiliary: revision }),
  ...[
    { low: 60, high: 75, condition: 1, weekdayId: 1 },
    { low: 58, high: 71, condition: 5, weekdayId: 2 },
    { low: -4, high: 12, condition: 6, weekdayId: 3 },
  ].map((day, index) => Object.freeze({ id: 0xb242 + index,
    value: packWeatherDay(day), auxiliary: revision })),
  Object.freeze({ id: 0xb24f, value: revision, auxiliary: 15 }),
  Object.freeze({ id: 0xb24d, value: 1, auxiliary: 30 }),
  Object.freeze({ id: 0xb24e, value: 0, auxiliary: 0 }),
  Object.freeze({ id: 0xb24e, value: 1, auxiliary: 5 }),
]);

export function createSmokePlan(approval, approvalSha256) {
  return Object.freeze({
    format: "framer-f1-mquickjs-physical-smoke-plan-v1",
    status: "PLAN_ONLY_REQUIRES_EXPLICIT_POST_FLASH_RUNNER",
    hardwareAccess: false,
    approvalSha256,
    safety: Object.freeze({
      bootLifetimeEmbeddedPackageOnly: true,
      runtimeModuleUpdates: false,
      runtimeUploader: false,
      startupFailure: "capability must be absent; do not retry mapping; reboot/rollback",
      unexpectedReset: "stop soak and physical-boot rollback; never write a running mapped module",
    }),
    methods: Object.freeze({ capability: approval.runtime.capabilityMethod,
      telemetry: approval.runtime.telemetryMethod, event: approval.runtime.eventMethod,
      receipt: approval.runtime.receiptMethod }),
    wire: Object.freeze({ responseShape: Object.freeze({ status: "device-owned-string-max-112" }),
      capabilityPages: 13, telemetryPages: 6, oneOutstandingEvent: true,
      telemetrySnapshotProtocol: approval.runtime.telemetrySnapshotProtocol,
      uiLatencyMetric: approval.runtime.uiLatencyMetric,
      allocationMapOrdering: approval.runtime.allocationMapOrdering,
      keyNegativeHarness: approval.runtime.keyNegativeHarness,
      eventKeys: Object.freeze(["id", "value", "auxiliary", "generation", "revision"]),
      receiptRequest: Object.freeze({}), terminalStates: Object.freeze(["A", "R", "B", "H", "F"]) }),
    phases: Object.freeze([
      Object.freeze({ name: "base-capability-and-byte-identity", mode: "read-only-rpc",
        requests: Object.freeze(Array.from({ length: 13 }, (_value, page) => Object.freeze({
          method: approval.runtime.capabilityMethod, args: Object.freeze({ page }) }))),
        require: Object.freeze({ exactPageSet: "p0..p12-once-each-within-2s",
          screen: 28, physicalCanary: true, hardwareRuntimeProven: false, runtimeUploader: false,
          baseAppSha256: approval.baseline.app.sha256,
          finalCandidateAppSha256: "external-flash-receipt-only",
          moduleSha256: approval.module.deviceIdentity.sha256,
          moduleHashSemantics: approval.module.deviceIdentity.semantics,
          packageSha256: approval.runtime.embedded.canary.sha256,
          generation: approval.runtime.generation, statusMaximumBytes: 112,
          startupFailure: "method absent; no map retry; physical ROM rollback" }) }),
      Object.freeze({ name: "initial-telemetry", mode: "read-only-rpc",
        requests: Object.freeze(Array.from({ length: 6 }, (_value, page) => Object.freeze({
          method: approval.runtime.telemetryMethod, args: Object.freeze({ page }) }))),
        require: Object.freeze({ exactPageSet: "p0..p5-once-each-within-2s",
          coherentSnapshot: approval.runtime.telemetrySnapshotProtocol,
          heapMaximumBytes: 65_536, stackMinimumBytes: 2_048, deadlineUs: 2_000,
          ownerSliceMaximumUs: 8_000, recoveryFailures: 0, fatal: 0,
          id28FullProxyTickMaximumUs: 100_000,
          id28FullProxyTickIncludes: "old_tick+base-restore+LZSS/F2TF-overlay+image-source-publish",
          wdtDeviceStatus: "unsubscribed", flashWrites: 0, nvsWrites: 0 }) }),
      Object.freeze({ name: "screen-smoke", mode: "manual-navigation",
        screens: PINNED.screens, requirePerScreen: Object.freeze({ status: "rendered-nonblack",
          evidenceSource: "operator-or-camera; never synthesized as device RPC" }) }),
      Object.freeze({ name: "key-binding-observation", mode: approval.keyEvents.mode,
        precondition: "screen 28 foreground; JavaScript key dispatch remains disabled",
        actions: Object.freeze([
          "press/release HID Space once; require k+1 per edge, token 44, and callbacks unchanged",
          "press/release Left Shift once; require k+1 per edge, token 225, and callbacks unchanged",
          "require the fourth discovery edge to commit the exact gate without JS dispatch",
          "press Space down once more; require token 44 and the first post-gate callback increment",
          "press/release Right Shift once; require k+2, token 229, level 0, gate 1, chord 0",
        ]),
        require: Object.freeze({ status: "observed-confirmed", maxUniqueTokens: 2,
          chordHeldMask: 3, bootLifetimeBinding: true, releaseAllOnLeave: true,
          keyTokenNormalization: approval.keyEvents.tokenProof.keyTokenNormalization,
          rejectedLow24Tokens: approval.keyEvents.tokenProof.rejectedLow24Tokens,
          discoveryEdgesObservationOnly: 4, firstJsEdge: "next-Space-down",
          rightShiftTelemetry: "k+2;t=000000e5;l=0;G=1;c=0",
          rightShiftAdmissionProof:
            approval.runtime.keyNegativeHarness,
          stockReceivesOriginalRawFirst: true, syntheticFixtureTokensRejected: true,
          externalJsonlObservation: Object.freeze({ kind: "observation", source: "operator",
            type: "key-rejection", normalizedLow24Token: 229,
            status: "stock-preserved-js-rejected", evidence: "required-nonempty" }) }) }),
      Object.freeze({ name: "full-key-capability", mode: "read-only-rpc",
        request: Object.freeze({ method: approval.runtime.capabilityMethod,
          args: Object.freeze({ page: 4 }) }),
        requireStatus: "v1;p=4;js=1;host=1;timer=1;key=1;chord=1;keyGate=live-2x-du" }),
      Object.freeze({ name: "native-input-smoke", mode: "manual-physical-input",
        actions: Object.freeze([
          "key 0 down, hold, up", "key 1 down/up", "exact key0+key1 chord down/up",
          "hold key0 while rotating bottom knob both directions",
          "observe tick.100ms-driven dial motion and tick.1s-driven time/weather updates",
        ]),
        require: Object.freeze({ telemetryP5TokensAndLevels: Object.freeze([[44, 1], [44, 0],
          [225, 1], [225, 0]]), chordActivationAndRelease: true,
          exactCanaryHandlers: Object.freeze(["input.key.down", "input.key.hold", "input.key.up",
            "input.chord.down", "input.chord.up", "input.fn-bottom-knob", "tick.100ms", "tick.1s"]),
          visualEvidenceExplicitlyExternal: true }) }),
      Object.freeze({ name: "weather-atomic-revision", mode: "serialized-host-rpc",
        requests: Object.freeze(weather.map((value) => Object.freeze({
          method: approval.runtime.eventMethod, args: Object.freeze({ ...value,
            generation: approval.runtime.generation, revision }) }))),
        delivery: "send one event; require Q; poll widget.mquickjs.receipt until same seq/fields reaches A; then send next",
        require: Object.freeze({ revision, terminal: "A", commitId: 0xb24f,
          mailboxAppliedRevision: revision, visibleId28WeatherAppliedRevision: revision,
          visibleId28TickAfterCommit: true, intermediateRevisionVisible: false,
          lastGoodPreserved: true }) }),
      Object.freeze({ name: "bounded-fault-recovery", mode: "serialized-host-rpc-sentinel",
        requests: Object.freeze([
          Object.freeze({ kind: "timeout", method: approval.runtime.eventMethod,
            args: Object.freeze({ id: 0xb24d, value: -0x80000000, auxiliary: 0x54494d45,
              generation: approval.runtime.generation, revision }) }),
          Object.freeze({ kind: "oom", method: approval.runtime.eventMethod,
            args: Object.freeze({ id: 0xb24d, value: -0x7fffffff, auxiliary: 0x4f4f4d21,
              generation: approval.runtime.generation, revision }) }),
        ]),
        requireEach: Object.freeze({ receiptTransition: "Q->F with exact same seq/id/value/aux/g/r/ag/ar",
          telemetryP2Correlation: "n=same-seq; x=-6 timeout or -7 OOM; recoveries +1; R=0; f=0",
          lastGoodPreserved: true, nextEvent: "B24D(0,0) Q->A", watchdogClaim: "unsubscribed" }) }),
      Object.freeze({ name: "one-hour-soak", mode: "telemetry-jsonl",
        durationMs: 3_600_000, telemetryIntervalMs: 5_000, maximumSampleGapMs: 10_000,
        rotateScreensEveryMs: 120_000, repeatWeatherEveryMs: 300_000,
        validator: "soak.mjs", requiresExactFlashReceipt: true, requireNoDisconnect: true }),
    ]),
    jsonlKinds: Object.freeze(["rpc", "observation"]),
    expectedScreens: PINNED.screens,
    expectedRpcIds: PINNED.rpcIds,
  });
}

async function main(argv) {
  if (argv.length !== 2 || argv[0] !== "--approval") {
    throw new Error("Usage: smoke-plan.mjs --approval FILE");
  }
  const approval = validateApproval(JSON.parse(await readFile(path.resolve(argv[1]), "utf8")));
  const files = await verifyApprovalFiles(approval);
  return createSmokePlan(approval, files.approvalSha256);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) main(process.argv.slice(2)).then((value) => {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}).catch((error) => {
  process.stderr.write(`BLOCKED: ${error.message}\n`);
  process.exitCode = 1;
});
