import {
  PINNED,
  SOAK_RECEIPT_FORMAT,
  invariant,
} from "./contract.mjs";

const HEX8 = "([0-9a-f]{8})";
const HEX16 = "([0-9a-f]{16})";
const HEX64 = "([0-9a-f]{64})";
const CAPABILITY_PAGES = Object.freeze([
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
const TELEMETRY_PAGES = Object.freeze([
  new RegExp(`^v1;p=0;b=${HEX16};u=${HEX16};f=${HEX8};l=${HEX8};h=${HEX8};H=${HEX8};s=${HEX8}$`, "u"),
  new RegExp(`^v1;p=1;c=${HEX8};p=${HEX16};d=000007d0;t=${HEX8};o=${HEX8};x=${HEX8};m=${HEX8}$`, "u"),
  new RegExp(`^v1;p=2;l=${HEX8};s=${HEX8};p=${HEX8};w=${HEX8};r=${HEX8};R=${HEX8};x=${HEX8};n=${HEX8};f=${HEX8}$`, "u"),
  new RegExp(`^v1;p=3;q=${HEX8};Q=${HEX8};A=${HEX8};R=${HEX8};n=${HEX8};m=${HEX8};g=${HEX8};r=${HEX8}$`, "u"),
  new RegExp(`^v1;p=4;w=U;dt=00000001;dc=${HEX8};map=B;flash=0;nvs=0;f=${HEX8}$`, "u"),
  new RegExp(`^v1;p=5;s=${HEX8};v=([01]);y=${HEX8};k=${HEX8};t=${HEX8};l=([01]);G=([01]);c=([01]);r=${HEX8};U=${HEX8}$`, "u"),
]);
const RECEIPT = new RegExp(
  `^v1;s=([QARBHF]);q=${HEX8};seq=${HEX8};g=${HEX8};r=${HEX8};id=${HEX8};v=${HEX8};a=${HEX8};ag=${HEX8};ar=${HEX8}$`, "u");

const exactKeys = (value, keys, label) => {
  invariant(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object.`);
  invariant(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort()),
    `${label} keys changed.`);
};
const u32 = (hex) => Number.parseInt(hex, 16) >>> 0;
const u64 = (hex) => BigInt(`0x${hex}`);
const signed = (value) => value > 0x7fffffff ? value - 0x100000000 : value;
const toHex = (value) => (value >>> 0).toString(16).padStart(8, "0");
const integer = (value, minimum, maximum, label) => {
  invariant(Number.isInteger(value) && value >= minimum && value <= maximum,
    `${label} must be an integer in ${minimum}..${maximum}.`);
  return value;
};

function rawRpc(record, method, label) {
  exactKeys(record, ["kind", "hostTimeMs", "sample", "method", "request", "response"], label);
  invariant(record.kind === "rpc" && record.method === method, `${label} method changed.`);
  integer(record.hostTimeMs, 0, Number.MAX_SAFE_INTEGER, `${label}.hostTimeMs`);
  integer(record.sample, 0, 0xffffffff, `${label}.sample`);
  exactKeys(record.response, ["status"], `${label}.response`);
  invariant(typeof record.response.status === "string" && record.response.status.length <= 112,
    `${label} response is not one exact device-owned status string.`);
  return record;
}

function pageGroups(records, method, pageCount) {
  const groups = new Map();
  for (const record of records.filter((value) => value.kind === "rpc" && value.method === method)) {
    rawRpc(record, method, `${method} RPC`);
    exactKeys(record.request, ["page"], `${method} request`);
    integer(record.request.page, 0, pageCount - 1, `${method} page`);
    const group = groups.get(record.sample) ?? [];
    group.push(record);
    groups.set(record.sample, group);
  }
  return [...groups.entries()].map(([sample, group]) => {
    invariant(group.length === pageCount, `${method} sample ${sample} does not contain ${pageCount} pages.`);
    group.forEach((record, index) => {
      invariant(record.request.page === index,
        `${method} sample ${sample} is out of order or has duplicate/missing page ${index}.`);
      if (index > 0) invariant(record.hostTimeMs >= group[index - 1].hostTimeMs,
        `${method} sample ${sample} host timestamps moved backward.`);
    });
    invariant(group.at(-1).hostTimeMs - group[0].hostTimeMs <= 2_000,
      `${method} sample ${sample} pages took more than two seconds.`);
    return Object.freeze({ sample, hostTimeMs: group.at(-1).hostTimeMs,
      status: Object.freeze(group.map((record) => record.response.status)) });
  }).sort((left, right) => left.hostTimeMs - right.hostTimeMs);
}

export function parseCapabilityPages(status, approval) {
  invariant(Array.isArray(status) && status.length === 13, "Capability requires exactly 13 raw pages.");
  const matches = status.map((value, page) => {
    const match = CAPABILITY_PAGES[page].exec(value);
    invariant(match, `Device capability page ${page} changed or contains host-added fields.`);
    return match;
  });
  const baseAppSha256 = matches[1][1];
  const boot = matches[1][2];
  const moduleSha256 = matches[2][1];
  const packageSha256 = matches[3][1];
  const generation = u32(matches[3][2]);
  const key = Number(matches[4][1]);
  const chord = Number(matches[4][2]);
  invariant(baseAppSha256 === PINNED.healthyApp.sha256,
    "Device-emitted base-app ancestry differs from the accepted healthy app.");
  invariant(moduleSha256 === approval.module.deviceIdentity.sha256,
    "Device-emitted module identity differs from the complete 0x30000 slot-A readback.");
  invariant(packageSha256 === approval.runtime.embedded.canary.sha256 &&
    generation === approval.runtime.generation,
  "Device-emitted package identity or generation differs from the approved embedded canary.");
  invariant(key === 1 && chord === 1,
    "Final canary capability did not pass the live two-key/chord observation gate.");
  return Object.freeze({ renderV2Profile: "framer-f1-render-v2-mquickjs-v1",
    packageFormat: "framer-render-v2-mquickjs-package-v1",
    packageAbiSha256: PINNED.packageAbiSha256, engine: "MicroQuickJS",
    engineCommit: PINNED.engineCommit, javascriptProfile: "mquickjs-es5-strict-v1",
    deviceEvaluatesJavaScript: true, deviceRunsJsdom: false,
    maxPackageBytes: "98304", maxSourceBytes: "8192", heapBytes: "65536",
    callbackDeadlineUs: "2000", maxHandlers: "16", maxTargets: "16", maxKeys: "16",
    maxChords: "8", moduleAbiSha256: PINNED.moduleAbiSha256,
    physicalCanary: true, hardwareRuntimeProven: false,
    runtimeUploader: false, baseAppSha256, moduleSha256, packageSha256, generation,
    boot, keyEvents: true, chordEvents: true, timerSources: true,
    screens: PINNED.screens, wdt: "unsubscribed", map: "bootlife" });
}

function telemetryPage(status, page) {
  const match = TELEMETRY_PAGES[page].exec(status);
  invariant(match, `Device telemetry page ${page} changed or contains host-added fields.`);
  return match;
}

export function parseTelemetryPages(status) {
  invariant(Array.isArray(status) && status.length === 6, "Telemetry requires exactly six raw pages.");
  const page0 = telemetryPage(status[0], 0);
  const page1 = telemetryPage(status[1], 1);
  const page2 = telemetryPage(status[2], 2);
  const page3 = telemetryPage(status[3], 3);
  const page4 = telemetryPage(status[4], 4);
  const page5 = telemetryPage(status[5], 5);
  return Object.freeze({
    boot: u64(page0[1]), uptime: u64(page0[2]), free: u32(page0[3]), largest: u32(page0[4]),
    heap: u32(page0[5]), heapHigh: u32(page0[6]), stackMinimum: u32(page0[7]),
    callbacks: u32(page1[1]), polls: u64(page1[2]), timeout: u32(page1[3]), oom: u32(page1[4]),
    exceptions: u32(page1[5]), maxSlice: u32(page1[6]),
    loads: u32(page2[1]), sourceRejected: u32(page2[2]), publishFailed: u32(page2[3]),
    wrongThread: u32(page2[4]), recoveries: u32(page2[5]), recoveryFailures: u32(page2[6]),
    lastResult: signed(u32(page2[7])), lastSequence: u32(page2[8]), fatal: u32(page2[9]),
    queueDepth: u32(page3[1]), eventsQueued: u32(page3[2]), eventsApplied: u32(page3[3]),
    eventsRejected: u32(page3[4]), sequence: u32(page3[5]), mailboxSequence: u32(page3[6]),
    appliedGeneration: u32(page3[7]), appliedRevision: u32(page3[8]),
    wdt: "unsubscribed", delays: u32(page4[1]), map: "bootlife", flashWrites: 0, nvsWrites: 0,
    platformFatal: u32(page4[2]), screen: u32(page5[1]), visible: Number(page5[2]),
    replay: u32(page5[3]), keyObserved: u32(page5[4]), token: u32(page5[5]),
    level: Number(page5[6]), keyGate: Number(page5[7]), chord: Number(page5[8]),
    weatherAppliedRevision: u32(page5[9]), uiMaximum: u32(page5[10]),
  });
}

export function parseReceipt(status) {
  const match = RECEIPT.exec(status);
  invariant(match, "Device receipt changed or contains host-added fields.");
  return Object.freeze({ state: match[1], queueDepth: u32(match[2]), sequence: u32(match[3]),
    generation: u32(match[4]), revision: u32(match[5]), id: u32(match[6]),
    value: signed(u32(match[7])), auxiliary: signed(u32(match[8])),
    appliedGeneration: u32(match[9]), appliedRevision: u32(match[10]) });
}

function matchReceiptRequest(receipt, request, label) {
  invariant(receipt.generation === request.generation && receipt.revision === request.revision &&
    receipt.id === request.id && toHex(receipt.value) === toHex(request.value) &&
    toHex(receipt.auxiliary) === toHex(request.auxiliary),
  `${label} receipt does not echo the exact device-consumed request.`);
}

function eventTransactions(records, approval) {
  const output = [];
  let active = null;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.kind !== "rpc" ||
        ![approval.runtime.eventMethod, approval.runtime.receiptMethod].includes(record.method)) continue;
    if (record.method === approval.runtime.eventMethod) {
      invariant(active === null, "Host sent a second event while one device receipt was outstanding.");
      rawRpc(record, approval.runtime.eventMethod, "event RPC");
      exactKeys(record.request, ["id", "value", "auxiliary", "generation", "revision"], "event request");
      integer(record.request.id, 1, 0xffff, "event id");
      integer(record.request.value, -0x80000000, 0x7fffffff, "event value");
      integer(record.request.auxiliary, -0x80000000, 0x7fffffff, "event auxiliary");
      integer(record.request.generation, 1, 0xffffffff, "event generation");
      integer(record.request.revision, 0, 0xffffffff, "event revision");
      invariant(record.request.generation === approval.runtime.generation,
        "Event targeted another embedded generation.");
      const receipt = parseReceipt(record.response.status);
      matchReceiptRequest(receipt, record.request, "Initial event");
      active = { sample: record.sample, request: record.request, initial: receipt,
        startedAt: record.hostTimeMs, startedIndex: index, polls: [] };
      if (receipt.state !== "Q") {
        active.terminal = receipt;
        active.finishedAt = record.hostTimeMs;
        active.finishedIndex = index;
        output.push(Object.freeze(active));
        active = null;
      }
    } else {
      invariant(active !== null, "Receipt was polled without one outstanding event.");
      rawRpc(record, approval.runtime.receiptMethod, "receipt RPC");
      exactKeys(record.request, [], "receipt request");
      const receipt = parseReceipt(record.response.status);
      matchReceiptRequest(receipt, active.request, "Polled event");
      invariant(receipt.sequence === active.initial.sequence,
        "Receipt poll changed the device-assigned event sequence.");
      active.polls.push(receipt);
      if (receipt.state !== "Q") {
        active.terminal = receipt;
        active.finishedAt = record.hostTimeMs;
        active.finishedIndex = index;
        output.push(Object.freeze(active));
        active = null;
      }
    }
  }
  invariant(active === null, "Event receipt remained queued at end of soak log.");
  return Object.freeze(output);
}

const counterPaths = Object.freeze([
  "heapHigh", "callbacks", "polls", "timeout", "oom", "exceptions", "maxSlice",
  "loads", "sourceRejected", "publishFailed", "wrongThread", "recoveries", "recoveryFailures",
  "lastSequence", "fatal", "eventsQueued", "eventsApplied", "eventsRejected", "sequence",
  "mailboxSequence", "appliedGeneration", "appliedRevision", "delays", "platformFatal", "replay",
  "keyObserved", "weatherAppliedRevision", "uiMaximum",
]);

function monotonic(previous, current, key) {
  invariant(current[key] >= previous[key], `Device telemetry ${key} moved backwards.`);
}

function externalObservations(records, telemetry) {
  const observations = records.filter(({ kind }) => kind === "observation");
  const screens = new Set();
  let rightShiftRejection = null;
  for (const record of observations) {
    integer(record.hostTimeMs, 0, Number.MAX_SAFE_INTEGER, "observation host time");
    if (record.type === "screen") {
      exactKeys(record, ["kind", "hostTimeMs", "source", "type", "screenId", "status", "evidence"],
        "external screen observation");
      invariant(["operator", "camera"].includes(record.source) &&
        PINNED.screens.includes(record.screenId) && record.status === "rendered-nonblack" &&
        typeof record.evidence === "string" && record.evidence.length > 0,
      "Screen observation must remain explicitly external and evidence-backed.");
      screens.add(record.screenId);
      continue;
    }
    exactKeys(record, ["kind", "hostTimeMs", "source", "type", "normalizedLow24Token", "status", "evidence"],
      "external key-rejection observation");
    invariant(rightShiftRejection === null && record.source === "operator" &&
      record.type === "key-rejection" && record.normalizedLow24Token === 229 &&
      record.status === "stock-preserved-js-rejected" &&
      typeof record.evidence === "string" && record.evidence.length > 0,
    "Right Shift rejection must be one explicitly external, evidence-backed physical action.");
    const before = [...telemetry].reverse().find(({ hostTimeMs }) => hostTimeMs < record.hostTimeMs);
    const after = telemetry.find(({ hostTimeMs }) => hostTimeMs > record.hostTimeMs);
    invariant(before && after && after.value.keyObserved === before.value.keyObserved + 2 &&
      after.value.token === 229 && after.value.level === 0 && after.value.keyGate === 1 &&
      before.value.chord === 0 && after.value.chord === 0,
    "Right Shift physical press/release was not observed as rejected low24 229 outside the live chord map.");
    rightShiftRejection = Object.freeze({ token: 229, hostTimeMs: record.hostTimeMs,
      keyObservations: 2, mapperAdmission: false,
      proof: "live-observation-plus-link-audited-equality-map-and-negative-harness",
      evidence: record.evidence });
  }
  invariant(rightShiftRejection, "Soak lacks the explicit physical Right Shift rejection action.");
  return Object.freeze({ screens, count: observations.length, rightShiftRejection });
}

function validateKeyDiscovery(telemetry, capabilities) {
  const changes = [];
  for (let index = 1; index < telemetry.length; index += 1) {
    if (telemetry[index].value.keyObserved !== telemetry[index - 1].value.keyObserved) {
      changes.push(Object.freeze({ before: telemetry[index - 1], after: telemetry[index] }));
    }
  }
  const expected = [[44, 1], [44, 0], [225, 1], [225, 0]];
  let proof = null;
  for (let start = 0; start + expected.length < changes.length; start += 1) {
    const discovery = changes.slice(start, start + expected.length);
    const valid = discovery.every(({ before, after }, index) =>
      after.value.keyObserved === before.value.keyObserved + 1 &&
      after.value.token === expected[index][0] && after.value.level === expected[index][1] &&
      before.value.callbacks === after.value.callbacks && before.value.chord === 0 &&
      after.value.chord === 0 && before.value.appliedRevision === after.value.appliedRevision &&
      before.value.weatherAppliedRevision === after.value.weatherAppliedRevision &&
      before.value.keyGate === 0 && after.value.keyGate === (index === 3 ? 1 : 0));
    if (!valid) continue;
    const firstDispatch = changes[start + expected.length];
    if (firstDispatch && firstDispatch.after.value.keyObserved === firstDispatch.before.value.keyObserved + 1 &&
        firstDispatch.after.value.token === 44 && firstDispatch.after.value.level === 1 &&
        firstDispatch.before.value.keyGate === 1 && firstDispatch.after.value.keyGate === 1 &&
        firstDispatch.after.value.callbacks > firstDispatch.before.value.callbacks) {
      proof = Object.freeze({ discovery, firstDispatch });
      break;
    }
  }
  invariant(proof,
    "Four Space/Left Shift discovery edges were not observation-only before the next Space JS dispatch.");
  invariant(capabilities.some(({ hostTimeMs }) => hostTimeMs >= proof.discovery.at(-1).after.hostTimeMs),
    "No key=1/chord=1 capability sample followed the exact four-edge discovery commit.");
  return Object.freeze({ observations: 4, discoveryCallbacks: 0,
    firstDispatchedToken: proof.firstDispatch.after.value.token,
    firstDispatchCallbackDelta:
      proof.firstDispatch.after.value.callbacks - proof.firstDispatch.before.value.callbacks });
}

function telemetryAround(telemetry, hostTimeMs, sequence) {
  const before = [...telemetry].reverse().find((sample) => sample.hostTimeMs <= hostTimeMs &&
    sample.value.lastSequence !== sequence);
  const after = telemetry.find((sample) => sample.hostTimeMs >= hostTimeMs &&
    sample.value.lastSequence === sequence);
  invariant(before && after, `Fault sequence ${sequence} lacks immediate before/after raw telemetry.`);
  return { before: before.value, after: after.value };
}

function validateFault(transaction, kind, telemetry, transactions) {
  const timeout = kind === "timeout";
  const expectedValue = timeout ? -0x80000000 : -0x7fffffff;
  const expectedAuxiliary = timeout ? 0x54494d45 : 0x4f4f4d21;
  const expectedResult = timeout ? -6 : -7;
  invariant(transaction.request.id === 0xb24d && transaction.request.value === expectedValue &&
    transaction.request.auxiliary === expectedAuxiliary && transaction.terminal.state === "F",
  `${kind} did not use the exact B24D sentinel and terminal F receipt.`);
  const { before, after } = telemetryAround(telemetry, transaction.finishedAt,
    transaction.terminal.sequence);
  invariant(after.lastResult === expectedResult && after.lastSequence === transaction.terminal.sequence &&
    after.recoveries === before.recoveries + 1 && after.recoveryFailures === 0 && after.fatal === 0 &&
    after.platformFatal === 0 && after.mailboxSequence === before.mailboxSequence &&
    after.appliedGeneration === before.appliedGeneration && after.appliedRevision === before.appliedRevision &&
    transaction.terminal.appliedGeneration === before.appliedGeneration &&
    transaction.terminal.appliedRevision === before.appliedRevision,
  `${kind} recovery did not retain the exact last-good mailbox/generation/revision.`);
  invariant(timeout ? after.timeout === before.timeout + 1 : after.oom === before.oom + 1,
    `${kind} device counter did not increment exactly once.`);
  const at = transactions.indexOf(transaction);
  const benign = transactions[at + 1];
  invariant(benign && benign.request.id === 0xb24d && benign.request.value === 0 &&
    benign.request.auxiliary === 0 && benign.terminal.state === "A",
  `${kind} was not followed by an applied benign B24D(0,0) event.`);
  return Object.freeze({ kind, sequence: transaction.terminal.sequence, result: expectedResult });
}

export function validateSoakRecords(records, approval, {
  minimumDurationMs = 3_600_000,
  maximumSampleGapMs = 10_000,
  flashReceiptSha256,
} = {}) {
  invariant(Array.isArray(records) && records.length > 0, "Soak record stream is empty.");
  invariant(/^[0-9a-f]{64}$/u.test(flashReceiptSha256 ?? ""),
    "Soak must be bound to the exact app-last/module readback receipt SHA-256.");
  const capabilities = pageGroups(records, approval.runtime.capabilityMethod, 13)
    .map((group) => Object.freeze({ ...group, value: parseCapabilityPages(group.status, approval) }));
  invariant(capabilities.length >= 1, "Soak lacks one complete raw device capability sample.");
  const capability = capabilities.at(-1).value;
  const telemetry = pageGroups(records, approval.runtime.telemetryMethod, 6)
    .map((group) => Object.freeze({ ...group, value: parseTelemetryPages(group.status) }));
  invariant(telemetry.length >= 2, "Soak requires at least two complete raw telemetry samples.");
  invariant(capability.boot === telemetry[0].value.boot.toString(16).padStart(16, "0"),
    "Capability boot token differs from raw telemetry boot token.");

  for (let index = 0; index < telemetry.length; index += 1) {
    const current = telemetry[index];
    invariant(current.value.boot === telemetry[0].value.boot, "Device boot token changed during soak.");
    invariant(current.value.heap <= 65_536 && current.value.heapHigh <= 65_536 &&
      current.value.stackMinimum >= 2_048 && current.value.maxSlice <= 8_000 &&
      current.value.uiMaximum <= 100_000 &&
      current.value.queueDepth <= 64 && current.value.recoveryFailures === 0 &&
      current.value.fatal === 0 && current.value.platformFatal === 0,
    "Heap, stack, owner-slice, queue, recovery, or fatal physical bound failed.");
    invariant(PINNED.screens.includes(current.value.screen), "Telemetry reported an unexpected screen ID.");
    if (index === 0) continue;
    const previous = telemetry[index - 1];
    invariant(current.hostTimeMs > previous.hostTimeMs &&
      current.hostTimeMs - previous.hostTimeMs <= maximumSampleGapMs,
    `Telemetry sample gap exceeded ${maximumSampleGapMs} ms.`);
    invariant(current.value.uptime > previous.value.uptime, "Device uptime did not increase.");
    for (const key of counterPaths) monotonic(previous.value, current.value, key);
  }

  const first = telemetry[0];
  const last = telemetry.at(-1);
  const hostDurationMs = last.hostTimeMs - first.hostTimeMs;
  const deviceDurationMs = Number((last.value.uptime - first.value.uptime) / 1_000n);
  invariant(hostDurationMs >= minimumDurationMs && deviceDurationMs >= minimumDurationMs,
    `Soak duration is ${Math.min(hostDurationMs, deviceDurationMs)} ms; need ${minimumDurationMs} ms.`);
  invariant(last.value.heap <= first.value.heap + 2_048 && last.value.free + 4_096 >= first.value.free &&
    last.value.largest + 4_096 >= first.value.largest,
  "VM or internal heap retained beyond the canary soak allowance.");
  invariant(last.value.callbacks > first.value.callbacks && last.value.delays > first.value.delays &&
    last.value.mailboxSequence >= first.value.mailboxSequence && last.value.keyGate === 1 &&
    last.value.uiMaximum > 0,
  "Owner task, mailbox, or live key gate made no sustained physical progress.");

  const transactions = eventTransactions(records, approval);
  invariant(transactions.every(({ terminal }) => terminal && !["B", "H", "R"].includes(terminal.state)),
    "A canary event ended busy, hidden, or rejected.");
  for (const id of PINNED.rpcIds) {
    invariant(transactions.some(({ request, terminal }) => request.id === id && terminal.state === "A"),
      `Host RPC 0x${id.toString(16)} lacks an exact device-applied receipt.`);
  }
  const commit = transactions.find(({ request, terminal }) => request.id === 0xb24f &&
    request.value === 18 && request.auxiliary === 15 && terminal.state === "A");
  invariant(commit && commit.terminal.appliedRevision === 18,
    "Weather revision 18 lacks an exact device-applied commit receipt.");
  const renderedCommit = telemetry.find(({ hostTimeMs, value }) => hostTimeMs >= commit.finishedAt &&
    value.screen === 28 && value.visible === 1 && value.appliedRevision === 18 &&
    value.weatherAppliedRevision === 18 && value.uiMaximum > 0);
  invariant(renderedCommit,
    "Weather commit reached the VM/mailbox but not a visible ID28 F2TF proxy tick.");
  for (const transaction of transactions) {
    if (transaction === commit) break;
    if (PINNED.rpcIds.includes(transaction.request.id)) {
      invariant(transaction.terminal.appliedRevision !== 18,
        "Weather revision became visible before its commit event.");
    }
  }

  const timeoutTransaction = transactions.find(({ request }) => request.id === 0xb24d &&
    request.value === -0x80000000 && request.auxiliary === 0x54494d45);
  const oomTransaction = transactions.find(({ request }) => request.id === 0xb24d &&
    request.value === -0x7fffffff && request.auxiliary === 0x4f4f4d21);
  invariant(timeoutTransaction && oomTransaction,
    "Canary log lacks both exact B24D timeout and OOM sentinel transactions.");
  const faults = [validateFault(timeoutTransaction, "timeout", telemetry, transactions),
    validateFault(oomTransaction, "oom", telemetry, transactions)];

  const keySamples = telemetry.map(({ value }) => value);
  const keyDiscovery = validateKeyDiscovery(telemetry, capabilities);
  for (const [token, level] of [[44, 1], [44, 0], [225, 1], [225, 0]]) {
    invariant(keySamples.some((value) => value.token === token && value.level === level),
      `Raw device telemetry lacks key token ${token} level ${level}.`);
  }
  invariant(keySamples.some((value) => value.chord === 1) && last.value.chord === 0 &&
    keySamples.every((value) => value.token !== 0x10203040 && value.token !== 0x50607080),
  "Raw device telemetry lacks chord activation/release or exposed a synthetic key token.");

  const external = externalObservations(records, telemetry);
  for (const id of PINNED.screens) invariant(external.screens.has(id),
    `Screen ID ${id} lacks an explicitly external rendered/nonblack observation.`);

  return Object.freeze({
    format: SOAK_RECEIPT_FORMAT,
    status: "PASS_PHYSICAL_MQUICKJS_ONE_HOUR_CANARY_SOAK",
    evidencePromotion: "external-receipt-only",
    deviceCapability: Object.freeze({ physicalCanary: true, hardwareRuntimeProven: false,
      runtimeUploader: false, baseAppSha256: capability.baseAppSha256,
      finalAppIdentitySource: "external-app-last-readback-receipt", packageSha256: capability.packageSha256,
      moduleSha256: capability.moduleSha256 }),
    flashReceiptSha256,
    boot: telemetry[0].value.boot.toString(16).padStart(16, "0"),
    hostDurationMs,
    deviceDurationMs,
    telemetrySamples: telemetry.length,
    rawRpcTransactions: transactions.length,
    mailboxAppliedRevision: commit.terminal.appliedRevision,
    weatherAppliedRevision: renderedCommit.value.weatherAppliedRevision,
    uiMaximumUs: last.value.uiMaximum,
    faults,
    keyProof: Object.freeze({ mode: "fixed-token-map-v1",
      normalization: approval.keyEvents.tokenProof.keyTokenNormalization,
      tokens: Object.freeze([44, 225]), chordHeldMask: 3,
      discovery: keyDiscovery, rejectedLow24Tokens: Object.freeze([229]),
      negativeHarness: approval.runtime.keyNegativeHarness,
      rightShiftRejection: external.rightShiftRejection, observedOnDevice: true }),
    screens: Object.freeze([...external.screens].sort((left, right) => left - right)),
    limitations: Object.freeze({ wdtLifecycleProven: false, wdtDeviceStatus: "unsubscribed",
      runtimeUploaderProven: false, productionRelease: false }),
  });
}
