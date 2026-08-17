import assert from "node:assert/strict";
import test from "node:test";

import {
  INPUT_LAB_MQUICKJS_BASE_APP_SHA256,
  INPUT_LAB_MQUICKJS_HOST_RPC_IDS,
  INPUT_LAB_MQUICKJS_PHYSICAL_WEATHER_TARGET,
  INPUT_LAB_MQUICKJS_RPC_METHODS,
  InputLabMQuickJsRpcClient,
  confirmInputLabMQuickJsWeatherRender,
  deliverInputLabMQuickJsWeatherBatch,
  parseInputLabMQuickJsCapabilityPages,
  parseInputLabMQuickJsReceipt,
  parseInputLabMQuickJsTelemetryPages,
} from "../lib/mquickjs-device-rpc.mjs";

const hex8 = (value) => (value >>> 0).toString(16).padStart(8, "0");
const moduleSha256 = "a".repeat(64);
const packageSha256 = "b".repeat(64);
const boot = "0123456789abcdef";

function capabilityPages({ key = 1, chord = 1 } = {}) {
  return [
    "v1;p=0;profile=framer-f1-render-v2-mquickjs-v1;screen=28;physical=1;proven=0;uploader=0",
    `v1;p=1;baseApp=${INPUT_LAB_MQUICKJS_BASE_APP_SHA256};boot=${boot}`,
    `v1;p=2;module=${moduleSha256};slotBytes=00030000`,
    `v1;p=3;package=${packageSha256};g=00000013`,
    `v1;p=4;js=1;host=1;timer=1;key=${key};chord=${chord};keyGate=live-2x-du`,
    "v1;p=5;packageFormat=framer-render-v2-mquickjs-package-v1",
    "v1;p=6;packageAbiSha256=5091736403d809078cbbf12a1b593fbabaff53474a0935a7e00ce81dc8bd67f8",
    "v1;p=7;engine=MicroQuickJS;engineCommit=203d5bb79789bc47b74855d9207415dab71661a0",
    "v1;p=8;javascriptProfile=mquickjs-es5-strict-v1;deviceEvaluatesJavaScript=1;deviceRunsJsdom=0",
    "v1;p=9;maxPackageBytes=98304;maxSourceBytes=8192;heapBytes=65536;callbackDeadlineUs=2000",
    "v1;p=10;maxHandlers=16;maxTargets=16;maxKeys=16;maxChords=8",
    "v1;p=11;moduleAbiSha256=ad484a3a8b438c51f6bbcda6ea871110735b3460e39e4c2853a4e636f5f728cb",
    "v1;p=12;screenIds=1,7,26,27,28;methods=0f;wdt=unsubscribed;map=bootlife",
  ];
}

function receipt(state, request, sequence = 7, appliedRevision = 18) {
  return { status: `v1;s=${state};q=${state === "Q" ? "00000001" : "00000000"};seq=${hex8(sequence)};g=${hex8(request.generation)};r=${hex8(request.revision)};id=${hex8(request.id)};v=${hex8(request.value)};a=${hex8(request.auxiliary)};ag=${hex8(request.generation)};ar=${hex8(appliedRevision)}` };
}

function telemetryPages() {
  return [
    `v1;p=0;b=${boot};u=00000000000f4240;f=00008000;l=00004000;h=0000c350;H=0000f230;s=00000bb8`,
    "v1;p=1;c=00000010;p=0000000000000020;d=000007d0;t=00000000;o=00000000;x=00000000;m=000007d0",
    "v1;p=2;l=00000001;s=00000000;p=00000000;w=00000000;r=00000000;R=00000000;x=00000000;n=00000007;f=00000000",
    "v1;p=3;q=00000000;Q=00000007;A=00000007;R=00000000;n=00000007;m=00000001;g=00000013;r=00000012",
    "v1;p=4;w=U;dt=00000001;dc=00000020;map=B;flash=0;nvs=0;f=00000000",
    "v1;p=5;s=0000001c;v=1;y=00000000;k=00000004;t=000000e1;l=0;G=1;c=0;r=00000012;U=00015f90",
  ];
}

test("physical canary capability parser reconstructs exact public fields without inventing proof", () => {
  const pages = capabilityPages();
  assert.ok(pages.every((page) => page.length <= 112));
  const capability = parseInputLabMQuickJsCapabilityPages(pages, {
    baseAppSha256: INPUT_LAB_MQUICKJS_BASE_APP_SHA256, moduleSha256, packageSha256,
    generation: 19, boot,
  });
  assert.equal(capability.screenId, 28);
  assert.equal(capability.physicalCanary, true);
  assert.equal(capability.hardwareRuntimeProven, false);
  assert.equal(capability.runtimeUploader, false);
  assert.equal(capability.deviceEvaluatesJavaScript, true);
  assert.equal(capability.deviceRunsJsdom, false);
  assert.equal(capability.keyEvents, true);
  assert.equal(capability.chordEvents, true);
  assert.equal(capability.moduleSha256, moduleSha256);
});

test("capability parser rejects missing, duplicate, mislabeled, hostile, and mismatched identity pages", () => {
  const pages = capabilityPages();
  assert.throws(() => parseInputLabMQuickJsCapabilityPages(pages.slice(0, 12)), /exactly pages/iu);
  assert.throws(() => parseInputLabMQuickJsCapabilityPages([...pages.slice(0, 6), pages[5], ...pages.slice(7)]),
    /page 6/iu);
  assert.throws(() => parseInputLabMQuickJsCapabilityPages(pages.map((page, index) =>
    index === 4 ? `${page};hardwareRuntimeProven=1` : page)), /page 4/iu);
  assert.throws(() => parseInputLabMQuickJsCapabilityPages(pages.map((page, index) =>
    index === 1 ? page.replace("baseApp=", "app=") : page)), /page 1/iu);
  assert.throws(() => parseInputLabMQuickJsCapabilityPages(pages.map((page, index) =>
    index === 1 ? page.replace(INPUT_LAB_MQUICKJS_BASE_APP_SHA256, "c".repeat(64)) : page)),
  /baseApp/iu);
  assert.throws(() => parseInputLabMQuickJsCapabilityPages(pages, { moduleSha256: "d".repeat(64) }),
    /moduleSha256/iu);
});

test("browser client probes all bounded pages then serializes exact event and receipt polling", async () => {
  const pages = capabilityPages();
  const calls = [];
  const request = { id: 0xb24f, value: 18, auxiliary: 15, generation: 19, revision: 18 };
  let receiptPoll = 0;
  const client = new InputLabMQuickJsRpcClient({ receiptPollMs: 0, wait: async () => {},
    call: async (method, params) => {
      calls.push({ method, params: structuredClone(params) });
      if (method === INPUT_LAB_MQUICKJS_RPC_METHODS.capability) return { status: pages[params.page] };
      if (method === INPUT_LAB_MQUICKJS_RPC_METHODS.event) return receipt("Q", params);
      if (method === INPUT_LAB_MQUICKJS_RPC_METHODS.receipt) {
        receiptPoll += 1;
        return receipt(receiptPoll === 1 ? "Q" : "A", request);
      }
      throw new Error(`unexpected method ${method}`);
    } });
  const capability = await client.probeCapability({ expected: { moduleSha256, packageSha256,
    generation: 19 } });
  const result = await client.sendHostEvent(request);
  assert.equal(result.status, "applied");
  assert.equal(result.receipt.sequence, 7);
  assert.deepEqual(calls.slice(0, 13).map(({ method, params }) => [method, params.page]),
    Array.from({ length: 13 }, (_value, page) => [INPUT_LAB_MQUICKJS_RPC_METHODS.capability, page]));
  assert.deepEqual(calls.slice(13).map(({ method }) => method), [INPUT_LAB_MQUICKJS_RPC_METHODS.event,
    INPUT_LAB_MQUICKJS_RPC_METHODS.receipt, INPUT_LAB_MQUICKJS_RPC_METHODS.receipt]);
  assert.deepEqual(calls[13].params, request);
  assert.equal(capability.generation, request.generation);
  assert.ok(INPUT_LAB_MQUICKJS_HOST_RPC_IDS.includes(request.id));
});

test("exclusive event batch prevents another host event from interleaving staged records", async () => {
  const pages = capabilityPages();
  let current;
  let sequence = 0;
  const calls = [];
  const client = new InputLabMQuickJsRpcClient({ receiptPollMs: 0, wait: async () => {},
    call: async (method, params) => {
      if (method === INPUT_LAB_MQUICKJS_RPC_METHODS.capability) return { status: pages[params.page] };
      calls.push(method === INPUT_LAB_MQUICKJS_RPC_METHODS.event ? params.id : "receipt");
      if (method === INPUT_LAB_MQUICKJS_RPC_METHODS.event) {
        current = { request: params, sequence: ++sequence };
        return receipt("Q", params, current.sequence, 0);
      }
      return receipt("A", current.request, current.sequence, current.request.revision);
    } });
  await client.probeCapability();
  const request = (id, revision) => ({ id, value: revision, auxiliary: 0,
    generation: 19, revision });
  const batch = client.sendHostEvents([request(0xb240, 1), request(0xb241, 1)]);
  const trailing = client.sendHostEvent(request(0xb24e, 2));
  await Promise.all([batch, trailing]);
  assert.deepEqual(calls, [0xb240, "receipt", 0xb241, "receipt", 0xb24e, "receipt"]);
});

test("compact telemetry remains bounded, exact, and tied to the capability boot token", async () => {
  const pages = capabilityPages();
  const telemetry = telemetryPages();
  assert.ok(telemetry.every((page) => page.length <= 112));
  assert.equal(parseInputLabMQuickJsTelemetryPages(telemetry).weatherAppliedRevision, 18);
  assert.equal(parseInputLabMQuickJsTelemetryPages(telemetry).uiMaximumUs, 90_000);
  assert.throws(() => parseInputLabMQuickJsTelemetryPages(telemetry.map((page, index) =>
    index === 4 ? `${page};wdt=proven` : page)), /page 4/iu);
  const calls = [];
  const client = new InputLabMQuickJsRpcClient({ call: async (method, params) => {
    calls.push({ method, page: params.page });
    if (method === INPUT_LAB_MQUICKJS_RPC_METHODS.capability) return { status: pages[params.page] };
    return { status: telemetry[params.page] };
  } });
  await client.probeCapability();
  const value = await client.probeTelemetry();
  assert.equal(value.boot, boot);
  assert.equal(value.wdt, "unsubscribed");
  assert.equal(value.flashWrites, false);
  assert.deepEqual(calls.slice(-6), Array.from({ length: 6 }, (_value, page) =>
    ({ method: INPUT_LAB_MQUICKJS_RPC_METHODS.telemetry, page })));
});

test("telemetry retries a transient collision only by restarting the whole p0..p5 session", async () => {
  const pages = capabilityPages();
  const telemetry = telemetryPages();
  const telemetryCalls = [];
  let collided = false;
  const client = new InputLabMQuickJsRpcClient({ receiptPollMs: 0, wait: async () => {},
    call: async (method, params) => {
      if (method === INPUT_LAB_MQUICKJS_RPC_METHODS.capability) return { status: pages[params.page] };
      telemetryCalls.push(params.page);
      if (!collided && params.page === 2) { collided = true; throw new Error("snapshot lock collision"); }
      return { status: telemetry[params.page] };
    } });
  await client.probeCapability();
  assert.equal((await client.probeTelemetry()).boot, boot);
  assert.deepEqual(telemetryCalls, [0, 1, 2, 0, 1, 2, 3, 4, 5]);

  const hostileCalls = [];
  const hostile = new InputLabMQuickJsRpcClient({ receiptPollMs: 0, wait: async () => {},
    call: async (method, params) => {
      if (method === INPUT_LAB_MQUICKJS_RPC_METHODS.capability) return { status: pages[params.page] };
      hostileCalls.push(params.page);
      return params.page === 2 ? { status: telemetry[2], hostRetry: true } : { status: telemetry[params.page] };
    } });
  await hostile.probeCapability();
  await assert.rejects(hostile.probeTelemetry(), /changed shape/iu);
  assert.deepEqual(hostileCalls, [0, 1, 2]);
});

test("physical weather helper sends one serialized six-record revision and proves atomic commit", async () => {
  const revision = 23;
  const events = [
    { id: 0xb240, value: revision, auxiliary: 0 },
    { id: 0xb241, value: 101, auxiliary: revision },
    { id: 0xb242, value: 102, auxiliary: revision },
    { id: 0xb243, value: 103, auxiliary: revision },
    { id: 0xb244, value: 104, auxiliary: revision },
    { id: 0xb24f, value: revision, auxiliary: 15 },
  ];
  const requests = [];
  const target = INPUT_LAB_MQUICKJS_PHYSICAL_WEATHER_TARGET;
  const delivery = await deliverInputLabMQuickJsWeatherBatch({ events, generation: 19, revision,
    postalCode: target.postalCode, countryCode: target.countryCode,
    sendHostEvents: async (batch) => batch.map((request) => {
      requests.push(structuredClone(request));
      const sequence = requests.length;
      return { status: "applied", request, receipt: { state: "A", sequence, id: request.id,
        generation: request.generation, revision: request.revision, value: request.value,
        auxiliary: request.auxiliary,
        appliedRevision: request.id === 0xb24f ? revision : 22 } };
    }) });
  assert.equal(delivery.finalReceipt.appliedRevision, revision);
  assert.deepEqual(delivery.sequences, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(requests.map(({ id }) => id), events.map(({ id }) => id));
  assert.ok(requests.every((request) => request.generation === 19 && request.revision === revision));

  await assert.rejects(deliverInputLabMQuickJsWeatherBatch({ events, generation: 19, revision,
    postalCode: target.postalCode, countryCode: target.countryCode,
    sendHostEvents: async (batch) => batch.map((request) => ({ status: "applied", request,
      receipt: { state: "A", sequence: 1, id: request.id, generation: request.generation,
        revision: request.revision, value: request.value, auxiliary: request.auxiliary,
        appliedRevision: revision } })) }),
  /before commit/iu);
  await assert.rejects(deliverInputLabMQuickJsWeatherBatch({ events, generation: 19, revision,
    postalCode: "90210", countryCode: "US", sendHostEvents: async () => {
      throw new Error("must not send");
    } }), /only US ZIP 60601/iu);
});

test("weather render confirmation distinguishes visible pixels from a hidden committed runtime", async () => {
  const revision = 23;
  const visibleSamples = [
    { screenId: 28, visible: true, appliedRevision: revision, weatherAppliedRevision: revision - 1,
      uiMaximumUs: 70_000 },
    { screenId: 28, visible: true, appliedRevision: revision, weatherAppliedRevision: revision,
      uiMaximumUs: 70_000 },
  ];
  let probes = 0;
  const rendered = await confirmInputLabMQuickJsWeatherRender({ revision, pollMs: 0,
    wait: async () => {}, probeTelemetry: async () => visibleSamples[probes++] });
  assert.equal(rendered.status, "rendered");
  assert.equal(rendered.polls, 2);
  assert.equal(rendered.telemetry.weatherAppliedRevision, revision);

  const hidden = await confirmInputLabMQuickJsWeatherRender({ revision,
    probeTelemetry: async () => ({ screenId: 7, visible: false, appliedRevision: revision,
      weatherAppliedRevision: revision - 1, uiMaximumUs: 0 }) });
  assert.equal(hidden.status, "committed-hidden");
  assert.equal(hidden.polls, 1);

  await assert.rejects(confirmInputLabMQuickJsWeatherRender({ revision, maximumPolls: 2, pollMs: 0,
    wait: async () => {}, probeTelemetry: async () => ({ screenId: 28, visible: true,
      appliedRevision: revision, weatherAppliedRevision: revision - 1, uiMaximumUs: 70_000 }) }),
  /bounded deadline/iu);
  await assert.rejects(confirmInputLabMQuickJsWeatherRender({ revision,
    probeTelemetry: async () => ({ screenId: 28, visible: true, appliedRevision: revision,
      weatherAppliedRevision: revision, uiMaximumUs: 100_001 }) }), /above 100 ms/iu);
});

test("browser client rejects host-added response fields, undeclared IDs, fault sentinels, and receipt drift", async () => {
  const pages = capabilityPages();
  const extra = new InputLabMQuickJsRpcClient({ call: async (_method, { page }) =>
    ({ status: pages[page], hostClaim: true }) });
  await assert.rejects(extra.probeCapability(), /changed shape/iu);

  let eventRequest;
  const drift = new InputLabMQuickJsRpcClient({ receiptPollMs: 0, wait: async () => {},
    call: async (method, params) => {
      if (method === INPUT_LAB_MQUICKJS_RPC_METHODS.capability) return { status: pages[params.page] };
      if (method === INPUT_LAB_MQUICKJS_RPC_METHODS.event) {
        eventRequest = params;
        return receipt("Q", params);
      }
      return receipt("A", { ...eventRequest, value: eventRequest.value + 1 });
    } });
  await drift.probeCapability();
  await assert.rejects(drift.sendHostEvent({ id: 0x7001, value: 1, auxiliary: 0,
    generation: 19, revision: 1 }), /not declared/iu);
  await assert.rejects(drift.sendHostEvent({ id: 0xb24d, value: -0x80000000, auxiliary: 0x54494d45,
    generation: 19, revision: 2 }), /fault sentinels/iu);
  await assert.rejects(drift.sendHostEvent({ id: 0xb240, value: 18, auxiliary: 0,
    generation: 19, revision: 3 }), /did not echo/iu);
  assert.equal(parseInputLabMQuickJsReceipt(receipt("A", {
    id: 0xb240, value: 18, auxiliary: 0, generation: 19, revision: 3 })).state, "A");
});
