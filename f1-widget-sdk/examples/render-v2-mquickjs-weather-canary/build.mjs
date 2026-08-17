import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  buildRenderV2MQuickJsPackage,
  decodeRenderV2MQuickJsPackage,
  RENDER_V2_MQUICKJS_PACKAGE_ABI_SHA256,
  RENDER_V2_MQUICKJS_PROFILE_ID,
  RENDER_V2_MQUICKJS_SOURCE_PREFIX,
} from "../../src/render-v2/mquickjs.mjs";

import {
  createDeterministicWeatherProvider,
  createWeatherCanaryHost,
  createWeatherCanarySimulationTransport,
  requiredWeatherCanaryCapability,
} from "./host-adapter.mjs";
import {
  requiredWeatherCanaryHostRpcIds,
  WEATHER_MQUICKJS_CANARY_FORMAT,
  WEATHER_MQUICKJS_FRESHNESS,
  WEATHER_MQUICKJS_RPC,
  WEATHER_MQUICKJS_SLOTS,
  WEATHER_MQUICKJS_TARGETS,
} from "./protocol.mjs";
import {
  createWeatherCanaryRasterBase,
  renderWeatherCanaryGoldenSvg,
  weatherCanaryViewModel,
} from "./screen.mjs";
import { createWeatherCanarySimulator } from "./simulator.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const WEATHER_CANARY_GENERATION = 18;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export async function buildWeatherCanaryExample() {
  const source = await readFile(path.join(here, "weather-widget.js"), "utf8");
  if (!source.startsWith(RENDER_V2_MQUICKJS_SOURCE_PREFIX)) {
    throw new Error("Weather canary source lost its exact strict prefix.");
  }
  const rasterBase = createWeatherCanaryRasterBase({ generation: WEATHER_CANARY_GENERATION });
  const value = buildRenderV2MQuickJsPackage({
    source,
    generation: WEATHER_CANARY_GENERATION,
    events: { "tick.1s": true, hostRpcIds: requiredWeatherCanaryHostRpcIds() },
    targets: WEATHER_MQUICKJS_TARGETS,
    rasterBase,
  });
  const decoded = decodeRenderV2MQuickJsPackage(value.binary);
  if (decoded.sha256 !== value.sha256 || decoded.source !== source) {
    throw new Error("Weather F2JS build did not round-trip exactly.");
  }

  const simulator = createWeatherCanarySimulator(source);
  const host = createWeatherCanaryHost({ provider: createDeterministicWeatherProvider(),
    transport: createWeatherCanarySimulationTransport(simulator),
    capability: requiredWeatherCanaryCapability() });
  const delivery = await host.refresh({ postalCode: "60601", countryCode: "US",
    units: "fahrenheit", refreshMinutes: 30 });
  simulator.dispatch({ name: "tick.1s", type: "tick.1s", value: 0, auxiliary: 0 });
  const view = weatherCanaryViewModel(simulator.slots, { location: "Chicago", units: "fahrenheit" });
  const goldenSvg = renderWeatherCanaryGoldenSvg(view);

  const manifest = Object.freeze({
    format: WEATHER_MQUICKJS_CANARY_FORMAT,
    status: "STATIC_OFFLINE_NOT_FLASHABLE",
    hardwareRuntimeProven: false,
    package: Object.freeze({ profileId: RENDER_V2_MQUICKJS_PROFILE_ID,
      packageAbiSha256: RENDER_V2_MQUICKJS_PACKAGE_ABI_SHA256,
      generation: value.generation, bytes: value.bytes, sha256: value.sha256,
      sourceSha256: value.sourceSha256, bodySha256: value.bodySha256, budget: value.budget }),
    screen: Object.freeze({ id: "weather-mqjs", separateScreen: true,
      logicalSize: Object.freeze({ width: 100, height: 310 }),
      targetCount: WEATHER_MQUICKJS_TARGETS.length, targets: WEATHER_MQUICKJS_TARGETS,
      slotContract: WEATHER_MQUICKJS_SLOTS,
      capabilityGate: requiredWeatherCanaryCapability(), pushAllowed: false }),
    protocol: Object.freeze({ rpc: WEATHER_MQUICKJS_RPC,
      requiredHostRpcIds: requiredWeatherCanaryHostRpcIds(), handlers: simulator.handlerCount,
      revisionRecords: 6, requiredStageMask: 0b1111,
      flowControl: Object.freeze({ outcomes: Object.freeze(["busy", "rejected", "queued", "applied"]),
        scalarDispatchReceipt: "exact-event-applied-v1", revisionReceipt: "appliedRevision" }),
      freshness: WEATHER_MQUICKJS_FRESHNESS }),
    offlineGolden: Object.freeze({ delivery, slots: simulator.slots, view,
      svgSha256: sha256(Buffer.from(goldenSvg, "utf8")) }),
    hiddenScreenPolicy: "dispatch hide once, suspend JS/ticks, retain last-good, queue latest host snapshot, " +
      "resume with elapsed seconds, then replay latest complete revision without a tick backlog",
    providerBoundary: "host-only ZIP lookup; deterministic no-network provider used for this proof",
    blockers: Object.freeze([
      "resident F2JS parser/task/mailbox is not yet physical-device proven",
      "no physical integer-slot to declared-target text/color/hidden facade exists",
      "stock RPC has no exact per-event/control receipt plus busy/rejected/queued and appliedRevision ABI yet",
      "hidden-screen suspension/resume and latest-only replay are not wired into stock navigation",
    ]),
  });
  return Object.freeze({ value, manifest, goldenSvg });
}

async function main() {
  const { value, manifest, goldenSvg } = await buildWeatherCanaryExample();
  const output = path.join(here, "build");
  await mkdir(output, { recursive: true });
  await Promise.all([
    writeFile(path.join(output, "weather-60601.f2js"), value.binary),
    writeFile(path.join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`),
    writeFile(path.join(output, "golden-screen.svg"), goldenSvg),
    writeFile(path.join(output, "golden-slots.json"), `${JSON.stringify(manifest.offlineGolden, null, 2)}\n`),
  ]);
  process.stdout.write(`${JSON.stringify({ status: manifest.status, package: manifest.package,
    screen: { id: manifest.screen.id, targetCount: manifest.screen.targetCount },
    offlineGolden: manifest.offlineGolden }, null, 2)}\n`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
