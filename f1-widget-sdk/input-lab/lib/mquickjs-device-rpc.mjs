import {
  INPUT_LAB_MQUICKJS_ENGINE_COMMIT,
  INPUT_LAB_MQUICKJS_LIMITS,
  INPUT_LAB_MQUICKJS_PACKAGE_ABI_SHA256,
  INPUT_LAB_MQUICKJS_PACKAGE_FORMAT,
  INPUT_LAB_MQUICKJS_PROFILE_ID,
} from "./mquickjs-canary.mjs";

export const INPUT_LAB_MQUICKJS_RPC_METHODS = Object.freeze({
  capability: "widget.mquickjs.cap",
  telemetry: "widget.mquickjs.telemetry",
  event: "widget.mquickjs.event",
  receipt: "widget.mquickjs.receipt",
});

export const INPUT_LAB_MQUICKJS_HOST_RPC_IDS = Object.freeze([
  0xb240, 0xb241, 0xb242, 0xb243, 0xb244, 0xb24d, 0xb24e, 0xb24f,
]);

export const INPUT_LAB_MQUICKJS_MODULE_ABI_SHA256 =
  "ad484a3a8b438c51f6bbcda6ea871110735b3460e39e4c2853a4e636f5f728cb";
export const INPUT_LAB_MQUICKJS_BASE_APP_SHA256 =
  "363170139a06f306be1e894b6f203a9bf03bf4d70d21194aaccdd1c42f760c32";
export const INPUT_LAB_MQUICKJS_CAPABILITY_PAGES = 13;
export const INPUT_LAB_MQUICKJS_TELEMETRY_PAGES = 6;
export const INPUT_LAB_MQUICKJS_STATUS_BYTES = 112;
export const INPUT_LAB_MQUICKJS_TELEMETRY_ATTEMPTS = 3;
export const INPUT_LAB_MQUICKJS_PHYSICAL_WEATHER_TARGET = Object.freeze({
  postalCode: "60601",
  countryCode: "US",
  locationLabel: "CHICAGO",
  provider: "deterministic-offline-fixture",
});

const HEX8 = "([0-9a-f]{8})";
const HEX16 = "([0-9a-f]{16})";
const HEX64 = "([0-9a-f]{64})";
const CAPABILITY = Object.freeze([
  /^v1;p=0;profile=framer-f1-render-v2-mquickjs-v1;screen=28;physical=1;proven=0;uploader=0$/u,
  new RegExp(`^v1;p=1;baseApp=${HEX64};boot=${HEX16}$`, "u"),
  new RegExp(`^v1;p=2;module=${HEX64};slotBytes=00030000$`, "u"),
  new RegExp(`^v1;p=3;package=${HEX64};g=${HEX8}$`, "u"),
  /^v1;p=4;js=1;host=1;timer=1;key=([01]);chord=([01]);keyGate=live-2x-du$/u,
  /^v1;p=5;packageFormat=framer-render-v2-mquickjs-package-v1$/u,
  /^v1;p=6;packageAbiSha256=5091736403d809078cbbf12a1b593fbabaff53474a0935a7e00ce81dc8bd67f8$/u,
  /^v1;p=7;engine=MicroQuickJS;engineCommit=203d5bb79789bc47b74855d9207415dab71661a0$/u,
  /^v1;p=8;javascriptProfile=mquickjs-es5-strict-v1;deviceEvaluatesJavaScript=1;deviceRunsJsdom=0$/u,
  /^v1;p=9;maxPackageBytes=98304;maxSourceBytes=8192;heapBytes=65536;callbackDeadlineUs=2000$/u,
  /^v1;p=10;maxHandlers=16;maxTargets=16;maxKeys=16;maxChords=8$/u,
  /^v1;p=11;moduleAbiSha256=ad484a3a8b438c51f6bbcda6ea871110735b3460e39e4c2853a4e636f5f728cb$/u,
  /^v1;p=12;screenIds=1,7,26,27,28;methods=0f;wdt=unsubscribed;map=bootlife$/u,
]);
const TELEMETRY = Object.freeze([
  new RegExp(`^v1;p=0;b=${HEX16};u=${HEX16};f=${HEX8};l=${HEX8};h=${HEX8};H=${HEX8};s=${HEX8}$`, "u"),
  new RegExp(`^v1;p=1;c=${HEX8};p=${HEX16};d=000007d0;t=${HEX8};o=${HEX8};x=${HEX8};m=${HEX8}$`, "u"),
  new RegExp(`^v1;p=2;l=${HEX8};s=${HEX8};p=${HEX8};w=${HEX8};r=${HEX8};R=${HEX8};x=${HEX8};n=${HEX8};f=${HEX8}$`, "u"),
  new RegExp(`^v1;p=3;q=${HEX8};Q=${HEX8};A=${HEX8};R=${HEX8};n=${HEX8};m=${HEX8};g=${HEX8};r=${HEX8}$`, "u"),
  new RegExp(`^v1;p=4;w=U;dt=00000001;dc=${HEX8};map=B;flash=0;nvs=0;f=${HEX8}$`, "u"),
  new RegExp(`^v1;p=5;s=${HEX8};v=([01]);y=${HEX8};k=${HEX8};t=${HEX8};l=([01]);G=([01]);c=([01]);r=${HEX8};U=${HEX8}$`, "u"),
]);
const RECEIPT = new RegExp(
  `^v1;s=([QARBHF]);q=${HEX8};seq=${HEX8};g=${HEX8};r=${HEX8};id=${HEX8};v=${HEX8};a=${HEX8};ag=${HEX8};ar=${HEX8}$`, "u");

function fail(message, code = "MQUICKJS_CANARY_RPC_REJECTED") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function invariant(value, message, code) {
  if (!value) fail(message, code);
}

function exactKeys(value, expected, label) {
  invariant(value && typeof value === "object" && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort()),
  `${label} changed shape.`);
}

function statusOnly(response, label) {
  exactKeys(response, ["status"], label);
  invariant(typeof response.status === "string" && response.status.length <= INPUT_LAB_MQUICKJS_STATUS_BYTES,
    `${label} must contain one device-owned status string of at most 112 bytes.`);
  return response.status;
}

function uint32(value, label, { minimum = 0 } = {}) {
  invariant(Number.isInteger(value) && value >= minimum && value <= 0xffffffff,
    `${label} must be a uint32.`);
  return value >>> 0;
}

function int32(value, label) {
  invariant(Number.isInteger(value) && value >= -0x80000000 && value <= 0x7fffffff,
    `${label} must be an int32.`);
  return value | 0;
}

const fromHex = (value) => Number.parseInt(value, 16) >>> 0;
const signed = (value) => value > 0x7fffffff ? value - 0x100000000 : value;
const sameBits = (left, right) => (left >>> 0) === (right >>> 0);

export const INPUT_LAB_MQUICKJS_REQUIRED_CAPABILITY = Object.freeze({
  renderV2Profile: INPUT_LAB_MQUICKJS_PROFILE_ID,
  screenId: 28,
  physicalCanary: true,
  hardwareRuntimeProven: false,
  runtimeUploader: false,
  baseAppSha256: INPUT_LAB_MQUICKJS_BASE_APP_SHA256,
  packageFormat: INPUT_LAB_MQUICKJS_PACKAGE_FORMAT,
  packageAbiSha256: INPUT_LAB_MQUICKJS_PACKAGE_ABI_SHA256,
  engine: "MicroQuickJS",
  engineCommit: INPUT_LAB_MQUICKJS_ENGINE_COMMIT,
  javascriptProfile: "mquickjs-es5-strict-v1",
  deviceEvaluatesJavaScript: true,
  deviceRunsJsdom: false,
  maxPackageBytes: String(INPUT_LAB_MQUICKJS_LIMITS.packageBytes),
  maxSourceBytes: String(INPUT_LAB_MQUICKJS_LIMITS.sourceBytes),
  heapBytes: String(INPUT_LAB_MQUICKJS_LIMITS.heapBytes),
  callbackDeadlineUs: String(INPUT_LAB_MQUICKJS_LIMITS.callbackDeadlineUs),
  maxHandlers: String(INPUT_LAB_MQUICKJS_LIMITS.handlers),
  maxTargets: String(INPUT_LAB_MQUICKJS_LIMITS.targets),
  maxKeys: String(INPUT_LAB_MQUICKJS_LIMITS.keys),
  maxChords: String(INPUT_LAB_MQUICKJS_LIMITS.chords),
  moduleAbiSha256: INPUT_LAB_MQUICKJS_MODULE_ABI_SHA256,
  screenIds: Object.freeze([1, 7, 26, 27, 28]),
  methods: 0x0f,
  wdt: "unsubscribed",
  map: "bootlife",
});

export function parseInputLabMQuickJsCapabilityPages(statuses, expected = {}) {
  invariant(Array.isArray(statuses) && statuses.length === INPUT_LAB_MQUICKJS_CAPABILITY_PAGES,
    "MicroQuickJS capability requires exactly pages p0..p12 once each.",
    "MQUICKJS_CANARY_CAPABILITY_INCOMPATIBLE");
  const matches = statuses.map((status, page) => {
    invariant(typeof status === "string" && status.length <= INPUT_LAB_MQUICKJS_STATUS_BYTES,
      `MicroQuickJS capability page ${page} exceeds 112 bytes.`,
      "MQUICKJS_CANARY_CAPABILITY_INCOMPATIBLE");
    const match = CAPABILITY[page].exec(status);
    invariant(match, `MicroQuickJS capability page ${page} is missing, duplicated, reordered, or hostile.`,
      "MQUICKJS_CANARY_CAPABILITY_INCOMPATIBLE");
    return match;
  });
  const dynamic = Object.freeze({ baseAppSha256: matches[1][1], boot: matches[1][2],
    moduleSha256: matches[2][1], slotBytes: 0x30000, packageSha256: matches[3][1],
    generation: fromHex(matches[3][2]), keyEvents: matches[4][1] === "1",
    chordEvents: matches[4][2] === "1", hostEvents: true, timerSources: true,
    keyGate: "live-2x-du" });
  invariant(dynamic.baseAppSha256 === INPUT_LAB_MQUICKJS_BASE_APP_SHA256,
    "MicroQuickJS baseApp is not the accepted healthy-app ancestry.",
    "MQUICKJS_CANARY_IDENTITY_MISMATCH");
  for (const [field, pattern] of [["baseAppSha256", /^[0-9a-f]{64}$/u],
    ["moduleSha256", /^[0-9a-f]{64}$/u], ["packageSha256", /^[0-9a-f]{64}$/u],
    ["boot", /^[0-9a-f]{16}$/u]]) {
    if (expected[field] !== undefined) invariant(pattern.test(expected[field]) &&
      dynamic[field] === expected[field], `MicroQuickJS ${field} differs from the pinned physical identity.`,
    "MQUICKJS_CANARY_IDENTITY_MISMATCH");
  }
  if (expected.generation !== undefined) invariant(uint32(expected.generation,
    "Expected MicroQuickJS generation", { minimum: 1 }) === dynamic.generation,
  "MicroQuickJS generation differs from the pinned embedded package.", "MQUICKJS_CANARY_IDENTITY_MISMATCH");
  return Object.freeze({ ...INPUT_LAB_MQUICKJS_REQUIRED_CAPABILITY, ...dynamic });
}

export function parseInputLabMQuickJsReceipt(response) {
  const status = typeof response === "string" ? response : statusOnly(response, "MicroQuickJS receipt response");
  invariant(status.length <= INPUT_LAB_MQUICKJS_STATUS_BYTES,
    "MicroQuickJS receipt exceeds 112 bytes.");
  const match = RECEIPT.exec(status);
  invariant(match, "MicroQuickJS receipt grammar changed.");
  return Object.freeze({ state: match[1], queueDepth: fromHex(match[2]), sequence: fromHex(match[3]),
    generation: fromHex(match[4]), revision: fromHex(match[5]), id: fromHex(match[6]),
    value: signed(fromHex(match[7])), auxiliary: signed(fromHex(match[8])),
    appliedGeneration: fromHex(match[9]), appliedRevision: fromHex(match[10]) });
}

export function parseInputLabMQuickJsTelemetryPages(statuses) {
  invariant(Array.isArray(statuses) && statuses.length === INPUT_LAB_MQUICKJS_TELEMETRY_PAGES,
    "MicroQuickJS telemetry requires exactly pages p0..p5 once each.");
  const matches = statuses.map((status, page) => {
    invariant(typeof status === "string" && status.length <= INPUT_LAB_MQUICKJS_STATUS_BYTES,
      `MicroQuickJS telemetry page ${page} exceeds 112 bytes.`);
    const match = TELEMETRY[page].exec(status);
    invariant(match, `MicroQuickJS telemetry page ${page} is missing, duplicated, reordered, or hostile.`);
    return match;
  });
  return Object.freeze({
    boot: matches[0][1], uptimeUs: BigInt(`0x${matches[0][2]}`), freeBytes: fromHex(matches[0][3]),
    largestBlockBytes: fromHex(matches[0][4]), heapBytes: fromHex(matches[0][5]),
    heapHighBytes: fromHex(matches[0][6]), stackMinimumBytes: fromHex(matches[0][7]),
    callbacks: fromHex(matches[1][1]), polls: BigInt(`0x${matches[1][2]}`), deadlineUs: 2_000,
    timeouts: fromHex(matches[1][3]), oom: fromHex(matches[1][4]), exceptions: fromHex(matches[1][5]),
    maxSliceUs: fromHex(matches[1][6]), loads: fromHex(matches[2][1]),
    sourceRejected: fromHex(matches[2][2]), publishFailed: fromHex(matches[2][3]),
    wrongThread: fromHex(matches[2][4]), recoveries: fromHex(matches[2][5]),
    recoveryFailures: fromHex(matches[2][6]), lastResult: signed(fromHex(matches[2][7])),
    lastEventSequence: fromHex(matches[2][8]), fatal: fromHex(matches[2][9]),
    queueDepth: fromHex(matches[3][1]), eventsQueued: fromHex(matches[3][2]),
    eventsApplied: fromHex(matches[3][3]), eventsRejected: fromHex(matches[3][4]),
    sequence: fromHex(matches[3][5]), mailboxSequence: fromHex(matches[3][6]),
    appliedGeneration: fromHex(matches[3][7]), appliedRevision: fromHex(matches[3][8]),
    wdt: "unsubscribed", delayCalls: fromHex(matches[4][1]), map: "bootlife",
    flashWrites: false, nvsWrites: false, platformFatal: fromHex(matches[4][2]),
    screenId: fromHex(matches[5][1]), visible: matches[5][2] === "1", replay: fromHex(matches[5][3]),
    keyObservations: fromHex(matches[5][4]), token: fromHex(matches[5][5]),
    level: matches[5][6] === "1", keyGate: matches[5][7] === "1",
    chord: matches[5][8] === "1", weatherAppliedRevision: fromHex(matches[5][9]),
    uiMaximumUs: fromHex(matches[5][10]),
  });
}

export async function deliverInputLabMQuickJsWeatherBatch({
  sendHostEvents,
  events,
  generation,
  revision,
  postalCode,
  countryCode,
} = {}) {
  invariant(typeof sendHostEvents === "function",
    "Physical weather delivery requires one exclusive sendHostEvents() transaction.");
  invariant(String(postalCode).trim() === INPUT_LAB_MQUICKJS_PHYSICAL_WEATHER_TARGET.postalCode &&
    String(countryCode).trim().toUpperCase() === INPUT_LAB_MQUICKJS_PHYSICAL_WEATHER_TARGET.countryCode,
  "This first physical weather canary renders the fixed CHICAGO label and accepts only US ZIP 60601; " +
  "other ZIPs remain offline-preview-only.", "MQUICKJS_CANARY_PHYSICAL_WEATHER_TARGET_MISMATCH");
  uint32(generation, "Physical weather generation", { minimum: 1 });
  uint32(revision, "Physical weather revision", { minimum: 1 });
  invariant(revision <= 0x7fffffff && Array.isArray(events) && events.length === 6,
    "Physical weather delivery requires one bounded six-record revision.");
  const ids = events.map(({ id }) => id);
  invariant(JSON.stringify(ids) === JSON.stringify([0xb240, 0xb241, 0xb242, 0xb243, 0xb244, 0xb24f]) &&
    events[0].value === revision && events[0].auxiliary === 0 &&
    events.slice(1, 5).every(({ auxiliary }) => auxiliary === revision) &&
    events[5].value === revision && events[5].auxiliary === 15,
  "Physical weather records do not form one exact begin/current/three-day/commit revision.");
  const requests = events.map((event) => Object.freeze({ id: event.id, value: event.value,
    auxiliary: event.auxiliary, generation, revision }));
  const results = await sendHostEvents(requests);
  invariant(Array.isArray(results) && results.length === requests.length,
    "Physical weather batch did not return one result per exclusive request.");
  const receipts = [];
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const request = requests[index];
    const result = results[index];
    invariant(result?.status === "applied" && result.receipt?.state === "A",
      `Physical weather RPC 0x${event.id.toString(16)} was not applied.`);
    invariant(result.request && result.request.id === request.id &&
      sameBits(result.request.value, request.value) &&
      sameBits(result.request.auxiliary, request.auxiliary) &&
      result.request.generation === request.generation && result.request.revision === request.revision &&
      result.receipt.id === request.id && result.receipt.generation === request.generation &&
      result.receipt.revision === request.revision && sameBits(result.receipt.value, request.value) &&
      sameBits(result.receipt.auxiliary, request.auxiliary),
    `Physical weather RPC 0x${event.id.toString(16)} returned a drifted request or receipt.`);
    if (event.id !== 0xb24f) invariant(result.receipt.appliedRevision !== revision,
      "Device exposed the staged weather revision before commit.");
    receipts.push(result.receipt);
  }
  const sequences = new Set(receipts.map(({ sequence }) => sequence));
  const finalReceipt = receipts.at(-1);
  invariant(sequences.size === 6 && finalReceipt.id === 0xb24f &&
    finalReceipt.appliedRevision === revision,
  "Physical weather commit did not atomically apply the exact fixture revision.");
  return Object.freeze({ status: "applied", revision, finalReceipt,
    sequences: Object.freeze(receipts.map(({ sequence }) => sequence)) });
}

export async function confirmInputLabMQuickJsWeatherRender({
  probeTelemetry,
  revision,
  wait = delay,
  pollMs = 100,
  maximumPolls = 20,
} = {}) {
  invariant(typeof probeTelemetry === "function", "Weather render confirmation requires probeTelemetry().");
  uint32(revision, "Weather render revision", { minimum: 1 });
  invariant(typeof wait === "function" && Number.isInteger(pollMs) && pollMs >= 0 && pollMs <= 1_000 &&
    Number.isInteger(maximumPolls) && maximumPolls >= 1 && maximumPolls <= 100,
  "Weather render polling bounds are invalid.");
  for (let poll = 0; poll < maximumPolls; poll += 1) {
    if (poll > 0) await wait(pollMs);
    const telemetry = await probeTelemetry();
    invariant(telemetry && typeof telemetry === "object",
      "Weather render confirmation did not receive coherent device telemetry.");
    if (telemetry.screenId !== 28 || telemetry.visible !== true) {
      return Object.freeze({ status: "committed-hidden", revision, polls: poll + 1, telemetry });
    }
    if (telemetry.appliedRevision === revision && telemetry.weatherAppliedRevision === revision) {
      invariant(Number.isInteger(telemetry.uiMaximumUs) && telemetry.uiMaximumUs > 0 &&
        telemetry.uiMaximumUs <= 100_000,
      "Physical ID28 rendered the revision but its full proxy-tick latency is missing or above 100 ms.");
      return Object.freeze({ status: "rendered", revision, polls: poll + 1, telemetry });
    }
  }
  fail("Physical ID28 stayed visible but did not render the committed weather revision before the bounded deadline.",
    "MQUICKJS_CANARY_WEATHER_RENDER_TIMEOUT");
}

function exactReceipt(receipt, request, sequence = receipt.sequence) {
  invariant(receipt.sequence === sequence && receipt.generation === request.generation &&
    receipt.revision === request.revision && receipt.id === request.id &&
    sameBits(receipt.value, request.value) && sameBits(receipt.auxiliary, request.auxiliary),
  "MicroQuickJS receipt did not echo the exact queued event.");
  return receipt;
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class InputLabMQuickJsRpcClient {
  constructor({ call, wait = delay, receiptPollMs = 10, maximumReceiptPolls = 200 } = {}) {
    invariant(typeof call === "function", "MicroQuickJS RPC client requires call(method, params).",
      "MQUICKJS_CANARY_RPC_UNAVAILABLE");
    invariant(typeof wait === "function" && Number.isInteger(receiptPollMs) && receiptPollMs >= 0 &&
      receiptPollMs <= 1_000 && Number.isInteger(maximumReceiptPolls) && maximumReceiptPolls >= 1 &&
      maximumReceiptPolls <= 1_000, "MicroQuickJS receipt polling bounds are invalid.");
    this.call = call;
    this.wait = wait;
    this.receiptPollMs = receiptPollMs;
    this.maximumReceiptPolls = maximumReceiptPolls;
    this.capability = null;
    this.operationQueue = Promise.resolve();
  }

  runExclusive(operation) {
    const result = this.operationQueue.then(operation, operation);
    this.operationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  probeCapability({ expected = {}, force = false } = {}) {
    return this.runExclusive(async () => {
      if (!force && this.capability) return this.capability;
      const statuses = [];
      for (let page = 0; page < INPUT_LAB_MQUICKJS_CAPABILITY_PAGES; page += 1) {
        const response = await this.call(INPUT_LAB_MQUICKJS_RPC_METHODS.capability, { page });
        statuses.push(statusOnly(response, `MicroQuickJS capability page ${page} response`));
      }
      this.capability = parseInputLabMQuickJsCapabilityPages(statuses, expected);
      return this.capability;
    });
  }

  probeTelemetry() {
    return this.runExclusive(async () => {
      invariant(this.capability, "Probe the exact MicroQuickJS capability before reading telemetry.",
        "MQUICKJS_CANARY_CAPABILITY_REQUIRED");
      let lastTransient;
      for (let attempt = 0; attempt < INPUT_LAB_MQUICKJS_TELEMETRY_ATTEMPTS; attempt += 1) {
        const statuses = [];
        lastTransient = null;
        for (let page = 0; page < INPUT_LAB_MQUICKJS_TELEMETRY_PAGES; page += 1) {
          let response;
          try { response = await this.call(INPUT_LAB_MQUICKJS_RPC_METHODS.telemetry, { page }); }
          catch (error) { lastTransient = error; break; }
          // Device/host grammar errors fail closed. Only a thrown transient RPC
          // rejection restarts at p0; a page session is never resumed midstream.
          statuses.push(statusOnly(response, `MicroQuickJS telemetry page ${page} response`));
        }
        if (lastTransient) {
          if (attempt + 1 < INPUT_LAB_MQUICKJS_TELEMETRY_ATTEMPTS) {
            await this.wait(this.receiptPollMs);
            continue;
          }
          const error = new Error("MicroQuickJS telemetry session was rejected on all three whole-session attempts.",
            { cause: lastTransient });
          error.code = "MQUICKJS_CANARY_TELEMETRY_SESSION_BUSY";
          throw error;
        }
        const telemetry = parseInputLabMQuickJsTelemetryPages(statuses);
        invariant(telemetry.boot === this.capability.boot,
          "MicroQuickJS telemetry boot token differs from capability.", "MQUICKJS_CANARY_IDENTITY_MISMATCH");
        return telemetry;
      }
      throw lastTransient;
    });
  }

  sendHostEvent(value, options = {}) {
    return this.runExclusive(() => this.sendHostEventUnqueued(value, options));
  }

  sendHostEvents(values, options = {}) {
    return this.runExclusive(async () => {
      invariant(Array.isArray(values) && values.length >= 1 && values.length <= 16,
        "MicroQuickJS event transaction requires 1..16 bounded requests.");
      const results = [];
      for (const value of values) results.push(await this.sendHostEventUnqueued(value, options));
      return Object.freeze(results);
    });
  }

  async sendHostEventUnqueued(value, options = {}) {
      invariant(this.capability, "Probe the exact MicroQuickJS capability before sending an event.",
        "MQUICKJS_CANARY_CAPABILITY_REQUIRED");
      exactKeys(value, ["id", "value", "auxiliary", "generation", "revision"],
        "MicroQuickJS event request");
      const request = Object.freeze({ id: uint32(value.id, "MicroQuickJS event ID", { minimum: 1 }),
        value: int32(value.value, "MicroQuickJS event value"),
        auxiliary: int32(value.auxiliary, "MicroQuickJS event auxiliary"),
        generation: uint32(value.generation, "MicroQuickJS event generation", { minimum: 1 }),
        revision: uint32(value.revision, "MicroQuickJS event revision") });
      invariant(INPUT_LAB_MQUICKJS_HOST_RPC_IDS.includes(request.id),
        `MicroQuickJS host RPC 0x${request.id.toString(16)} is not declared by the physical canary.`);
      invariant(request.generation === this.capability.generation,
        "MicroQuickJS event generation differs from the embedded package.");
      if (request.id === 0xb24d && options.allowFaultSentinel !== true) {
        invariant((request.value === 0 || request.value === 1) && request.auxiliary >= 0 &&
          request.auxiliary <= 86_400, "Input Lab blocks reserved B24D fault sentinels in normal host delivery.");
      }
      const initial = exactReceipt(parseInputLabMQuickJsReceipt(
        await this.call(INPUT_LAB_MQUICKJS_RPC_METHODS.event, request)), request);
      invariant(initial.state === "Q", `MicroQuickJS event was not queued (state ${initial.state}).`,
        initial.state === "B" ? "MQUICKJS_CANARY_BUSY" : "MQUICKJS_CANARY_EVENT_NOT_QUEUED");
      for (let poll = 0; poll < this.maximumReceiptPolls; poll += 1) {
        if (poll > 0 || this.receiptPollMs > 0) await this.wait(this.receiptPollMs);
        const receipt = exactReceipt(parseInputLabMQuickJsReceipt(
          await this.call(INPUT_LAB_MQUICKJS_RPC_METHODS.receipt, {})), request, initial.sequence);
        if (receipt.state === "Q") continue;
        invariant(receipt.state === (options.expectedTerminal ?? "A"),
          `MicroQuickJS event ended in state ${receipt.state}.`, "MQUICKJS_CANARY_EVENT_NOT_APPLIED");
        return Object.freeze({ status: receipt.state === "A" ? "applied" : "fault-recovered",
          request, receipt, polls: poll + 1 });
      }
      fail("MicroQuickJS receipt polling exceeded its bounded deadline.", "MQUICKJS_CANARY_RECEIPT_TIMEOUT");
  }
}
