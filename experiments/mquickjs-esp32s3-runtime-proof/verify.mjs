#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { inspectEsp32AppImage } from "../../custom-firmware/lib/esp-app-image.mjs";

const execute = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(here, "../..");
const output = path.join(here, "build");
const toolchain = process.env.FRAMER_XTENSA_BIN ?? path.join(repository,
  ".toolchains/xtensa-esp-elf-13.2.0_20240530/bin");
const xtensa = (name) => path.join(toolchain, `xtensa-esp32s3-elf-${name}`);
const cc = process.env.CC ?? "cc";
const run = (command, args, options = {}) => execute(command, args,
  { maxBuffer: 64 * 1024 * 1024, ...options });
const invariant = (condition, message) => { if (!condition) throw new Error(message); };
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hex = (value) => `0x${value.toString(16)}`;

const acceptedAppPath = path.join(repository,
  "f1-widget-sdk/build/combined-renderer-v2-clock-blue-timer/" +
  "framer-0.4.1-music-id1-wpm-id7-renderer-id26-clock-id27-blue-timer-app.bin");
const acceptedReceiptPath = path.join(repository,
  "f1-widget-sdk/build/device-receipts/device-1786939039376-fast-smoke.json");
const expected = Object.freeze({
  appBytes: 2_062_912,
  appSha256: "363170139a06f306be1e894b6f203a9bf03bf4d70d21194aaccdd1c42f760c32",
  receiptSha256: "1363d31eabba2b61e068d760d966ab25f8b17d1c635a4c91ba7ecd2a0de238e9",
  packageAbiSha256: "5091736403d809078cbbf12a1b593fbabaff53474a0935a7e00ce81dc8bd67f8",
  moduleAbiSha256: "ad484a3a8b438c51f6bbcda6ea871110735b3460e39e4c2853a4e636f5f728cb",
});

const spans = Object.freeze([
  { name: "esp_timer_get_time", start: 0x4037e028, end: 0x4037e040,
    sha256: "75e03adc4a2e9d122f0accb175d4eabbabacf8b20982c9afda3f55f865b3a587",
    abi: "int64_t esp_timer_get_time(void); a2/a3 return" },
  { name: "heap_caps_free", start: 0x4037e250, end: 0x4037e2a0,
    sha256: "c830d66ccc4cd8d93e006c0ad0623cc880ecb9a96fa21e7e0e5b1583f49bee61",
    abi: "void heap_caps_free(void *)" },
  { name: "heap_caps_malloc", start: 0x4037e55c, end: 0x4037e588,
    sha256: "c7ed18e365bd48ebbc416104c4a3cdca5408b938a2ea181657c5bc7bc9405a19",
    abi: "void *heap_caps_malloc(size_t,uint32_t)" },
  { name: "uxTaskGetStackHighWaterMark", start: 0x4038daf4, end: 0x4038db10,
    sha256: "0ee8bfcb09f7ccfed3dc70fdcd3c266b54e7f548d910a036fbaeab9097466fe0",
    abi: "uint32_t uxTaskGetStackHighWaterMark(TaskHandle_t); result is bytes" },
  { name: "stack_a5_scanner", start: 0x4038ec1c, end: 0x4038ec38,
    sha256: "271d1ad4ca3f3ea4caed6c7aada5d27641d9730e97188e4e68025575a47bc049",
    abi: "exact A5 stack-fill scanner called by high-water helper" },
  { name: "vTaskDelay", start: 0x4038dc3c, end: 0x4038dc78,
    sha256: "57bffb5c39a067f9b3ef6ea0a780361636229b18ed9a54982faefe2bf0a59ee7",
    abi: "void vTaskDelay(uint32_t ticks)" },
  { name: "xTaskCreateStaticPinnedToCore", start: 0x4038e950, end: 0x4038ea40,
    sha256: "2db652699cc573d2efce67c8f311670395fb82660e45b289a050e164809f1ed1",
    abi: "8-argument windowed ABI; stack depth bytes; StaticTask_t 352" },
  { name: "xTaskGetCurrentTaskHandleForCore", start: 0x4038eb7c, end: 0x4038eba8,
    sha256: "5e770160138c6036ad010a0caf05503623a529b571f4081568054138039ee4eb",
    abi: "TaskHandle_t xTaskGetCurrentTaskHandleForCore(int32_t)" },
  { name: "screen_root_getter", start: 0x42004e1c, end: 0x42004e48,
    sha256: "8b72f275038854a0dc2888d7d21dc7e145d4e2b7a43610efc678dbc6d145ab16",
    abi: "void *root(void)" },
  { name: "rpc_registry_getter", start: 0x42004afc, end: 0x42004b28,
    sha256: "5f5af85220d6da8255e7f679343e6866b991a6baa521c20e2df97dd9355085db",
    abi: "boot-lifetime stock RPC registry" },
  { name: "stock_key_shift_mask", start: 0x42041550, end: 0x42041554,
    sha256: "6633cfb1c776a95202ce8dd8b6860a41b35686e615252e728f381fe985bd88a9",
    abi: "little-endian 0x00fffffb mask" },
  { name: "stock_key_callback", start: 0x4206eae0, end: 0x4206eb48,
    sha256: "96316a9091816bf7290c75ebe6be76e4ed184ee13fdef6c50b77e791b5ecfa2b",
    abi: "a3 -> opaque u32; a4 -> u8 level; stock called first" },
  { name: "heap_caps_get_free_size", start: 0x420c8200, end: 0x420c822c,
    sha256: "82ec92f10a1d4332fd9a64effc86e97612d429b057db9e6bc32d0de9eee3c972",
    abi: "size_t heap_caps_get_free_size(uint32_t)" },
  { name: "heap_caps_get_largest_free_block", start: 0x420c82c4, end: 0x420c82d8,
    sha256: "bac5ed463bc051c397be0412653efa3d42050a6b499c1f7a77bae8ec367709ea",
    abi: "size_t heap_caps_get_largest_free_block(uint32_t)" },
  { name: "registry_from_root", start: 0x4210ad9c, end: 0x4210ada3,
    sha256: "5c2697ef878eef8bf9c46c0cde1f3a28a22ff0973a8298a12b8d13c0a86d9076",
    abi: "void *registry_from_root(void *)" },
  { name: "current_controller", start: 0x4210af48, end: 0x4210af4f,
    sha256: "74a87e9ff6090b9e05988cca6fc9b5185de9ffb44f28712060257e2dea542b16",
    abi: "void *current_controller(void *)" },
  { name: "rpc_register_one", start: 0x4211b7c8, end: 0x4211b7f4,
    sha256: "ad44433930c1e66f7b42e74acdc08f15b5465bec8e7a61d05cf71c4fca344c4a",
    abi: "persistent method pointer/context required" },
  { name: "rpc_read_integer", start: 0x4211ba2c, end: 0x4211ba58,
    sha256: "e2d725c23ddb82ed50e81e9cf5c2cae8ab65abd0886f37642a46f741a291a2dd",
    abi: "read named integer from request root" },
  { name: "rpc_reply_status", start: 0x4211ba58, end: 0x4211bac8,
    sha256: "b32c2c68bfdac4bf3dc7e6e192b2276b2271655daf477eeb24a2f084762a14fc",
    abi: "context+313 key; context+192/+200 persistent values" },
  { name: "rpc_make_root", start: 0x4211bac8, end: 0x4211bae4,
    sha256: "24f9f56110864f03db34bbaafc7711adfc6529194cd021198f5d6143f294be04",
    abi: "construct response JSON root" },
]);

function readVirtual(image, start, end) {
  const segment = image.segments.find((candidate) => start >= candidate.loadAddress &&
    end <= candidate.loadAddress + candidate.length);
  invariant(segment != null, `No image segment contains ${hex(start)}..${hex(end)}.`);
  return segment.data.subarray(start - segment.loadAddress, end - segment.loadAddress);
}

async function verifyAcceptedImage(temporary) {
  const [app, receiptBytes] = await Promise.all([
    readFile(acceptedAppPath), readFile(acceptedReceiptPath),
  ]);
  invariant(app.length === expected.appBytes && sha256(app) === expected.appSha256,
    "Accepted application identity changed.");
  invariant(sha256(receiptBytes) === expected.receiptSha256,
    "Accepted physical smoke receipt changed.");
  const receipt = JSON.parse(receiptBytes);
  invariant(receipt.app?.sha256 === expected.appSha256 &&
    receipt.app?.flashOffset === "0x10000" &&
    receipt.write?.hashVerifiedByEsptool === true &&
    receipt.postBoot?.version === "0.4.1",
  "Accepted receipt no longer proves app/write/boot identity.");
  const image = inspectEsp32AppImage(app);
  invariant(image.segmentCount === 6 &&
    image.segments[2].loadAddress === 0x40374000 &&
    image.segments[3].loadAddress === 0x42000020,
  "Accepted executable segment layout changed.");
  const verifiedSpans = spans.map((span) => {
    const bytes = readVirtual(image, span.start, span.end);
    invariant(bytes.length === span.end - span.start && sha256(bytes) === span.sha256,
      `Stock ABI span changed: ${span.name}.`);
    return { name: span.name, start: hex(span.start), end: hex(span.end),
      bytes: bytes.length, sha256: span.sha256, abi: span.abi };
  });
  invariant(readVirtual(image, 0x42041550, 0x42041554).toString("hex") === "fbffff00",
    "Stock shift mask literal changed.");
  invariant(app.includes(Buffer.from("vTaskDelay\0", "ascii")),
    "Accepted application lost its vTaskDelay assertion-name evidence.");
  const keyBytes = readVirtual(image, 0x4206eae0, 0x4206eb48);
  const keyPath = path.join(temporary, "stock-key-callback.bin");
  await writeFile(keyPath, keyBytes);
  const disassembly = await run(xtensa("objdump"), ["-D", "-b", "binary", "-m", "xtensa",
    "--adjust-vma=0x4206eae0", keyPath]);
  invariant(/l32i\.n\s+a9, a3, 0/u.test(disassembly.stdout) &&
    /l8ui\s+a11, a4, 0/u.test(disassembly.stdout) &&
    /movi\.n\s+a8, 44/u.test(disassembly.stdout) &&
    /l32r\s+a10, .*0x42041550/u.test(disassembly.stdout) &&
    /movi\s+a8, 225/u.test(disassembly.stdout) &&
    /and\s+a9, a9, a10/u.test(disassembly.stdout),
  "Stock key token/level/Space/LeftShift instruction evidence changed.");
  return { receipt, verifiedSpans };
}

const crossFlags = ["-std=c11", "-Os", "-Wall", "-Wextra", "-Werror", "-Wpedantic",
  "-ffreestanding", "-fno-builtin", "-fno-stack-protector", "-fno-unwind-tables",
  "-fno-asynchronous-unwind-tables", "-fno-common", "-ffunction-sections",
  "-fdata-sections", "-mlongcalls", "-mtext-section-literals", `-I${here}`];

async function verifyFailClosed(temporary) {
  try {
    await run(xtensa("gcc"), [...crossFlags, "-c", path.join(here, "runtime_proof.c"),
      "-o", path.join(temporary, "ungated-must-not-exist.o")]);
  } catch (error) {
    const text = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    invariant(text.includes("RUNTIME_PROOF_FAIL_CLOSED"),
      "Ungated compile failed for an unexpected reason.");
    return "PASS_FAIL_CLOSED";
  }
  throw new Error("Runtime proof compiled without exact accepted-app acknowledgement.");
}

async function verifyHostAndConcurrency(temporary) {
  const host = path.join(temporary, "runtime-proof-host");
  const tsan = path.join(temporary, "runtime-proof-tsan");
  const acknowledge = "-DFRAMER_RUNTIME_PROOF_EXACT_ABI_ACK=0x36317013u";
  await run(cc, ["-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", "-Wpedantic",
    acknowledge, path.join(here, "runtime_proof.c"), path.join(here, "host_harness.c"),
    "-o", host]);
  const hostResult = await run(host, []);
  invariant(hostResult.stdout.includes("rpc=pass") &&
    hostResult.stdout.includes("keys=space+left-shift") &&
    hostResult.stdout.includes("flash_runtime=disabled"),
  "Host harness did not prove its frozen contract.");
  await run(cc, ["-std=c11", "-O1", "-g", "-Wall", "-Wextra", "-Werror",
    "-Wpedantic", "-fsanitize=thread", "-pthread", acknowledge,
    path.join(here, "runtime_proof.c"), path.join(here, "concurrency_harness.c"),
    "-o", tsan]);
  await run(tsan, [], { env: { ...process.env, TSAN_OPTIONS: "halt_on_error=1" } });
  return { host: hostResult.stdout.trim(), concurrency: "PASS_TSAN_100000" };
}

async function buildXtensa(temporary) {
  const acknowledge = "-DFRAMER_RUNTIME_PROOF_EXACT_ABI_ACK=0x36317013u";
  const first = path.join(temporary, "runtime-proof-a.o");
  const second = path.join(temporary, "runtime-proof-b.o");
  await Promise.all([first, second].map((destination) => run(xtensa("gcc"),
    [...crossFlags, acknowledge, "-c", path.join(here, "runtime_proof.c"),
      "-o", destination])));
  const [firstBytes, secondBytes, undefineds, size, sections, compiler] = await Promise.all([
    readFile(first), readFile(second), run(xtensa("nm"), ["-u", first]),
    run(xtensa("size"), [first]), run(xtensa("objdump"), ["-h", first]),
    run(xtensa("gcc"), ["--version"]),
  ]);
  invariant(firstBytes.equals(secondBytes), "Xtensa runtime proof is nondeterministic.");
  invariant(undefineds.stdout.trim() === "", "Xtensa runtime proof gained undefined symbols.");
  const match = size.stdout.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+/mu);
  invariant(match != null && Number(match[2]) === 0 && Number(match[3]) === 0,
    "Xtensa runtime proof gained writable static data.");
  const writableSections = [...sections.stdout.matchAll(
    /^\s*\d+\s+(\.(?:data|bss)(?:\.[^\s]+)?)\s+([0-9a-f]+)/gmu,
  )].filter((matchValue) => Number.parseInt(matchValue[2], 16) !== 0);
  invariant(writableSections.length === 0,
    `Xtensa object contains writable sections: ${writableSections.map((item) => item[1]).join(",")}.`);
  await mkdir(output, { recursive: true });
  const artifact = path.join(output, "runtime-proof-core.o");
  await copyFile(first, artifact);
  return { artifact, bytes: firstBytes.length, sha256: sha256(firstBytes),
    textBytes: Number(match[1]), dataBytes: Number(match[2]), bssBytes: Number(match[3]),
    deterministicBuilds: 2, undefinedSymbols: 0, writableStaticBytes: 0,
    compiler: compiler.stdout.split(/\r?\n/u)[0] };
}

function capabilityPages() {
  return [
    "v1;p=0;profile=framer-f1-render-v2-mquickjs-v1;screen=28;physical=1;proven=0;uploader=<0|1>",
    "v1;p=1;baseApp=<accepted-base-sha256>;boot=<u64hex>",
    "v1;p=2;module=<sha256>;slotBytes=00030000",
    "v1;p=3;package=<sha256>;g=<u32hex>",
    "v1;p=4;js=1;host=1;timer=1;key=<0|1>;chord=<0|1>;keyGate=live-2x-du",
    "v1;p=5;packageFormat=framer-render-v2-mquickjs-package-v1",
    `v1;p=6;packageAbiSha256=${expected.packageAbiSha256}`,
    "v1;p=7;engine=MicroQuickJS;engineCommit=203d5bb79789bc47b74855d9207415dab71661a0",
    "v1;p=8;javascriptProfile=mquickjs-es5-strict-v1;deviceEvaluatesJavaScript=1;deviceRunsJsdom=0",
    "v1;p=9;maxPackageBytes=98304;maxSourceBytes=8192;heapBytes=65536;callbackDeadlineUs=2000",
    "v1;p=10;maxHandlers=16;maxTargets=16;maxKeys=16;maxChords=8",
    `v1;p=11;moduleAbiSha256=${expected.moduleAbiSha256}`,
    "v1;p=12;screenIds=1,7,26,27,28;methods=0f;wdt=unsubscribed;map=bootlife",
  ];
}

function verifyAbiIdentitySeparation() {
  const pages = capabilityPages();
  invariant(expected.packageAbiSha256 !== expected.moduleAbiSha256,
    "Package ABI and module ABI identities must remain distinct.");
  invariant(pages[6] ===
      `v1;p=6;packageAbiSha256=${expected.packageAbiSha256}` &&
    pages[11] === `v1;p=11;moduleAbiSha256=${expected.moduleAbiSha256}` &&
    !pages[6].includes(expected.moduleAbiSha256) &&
    !pages[11].includes(expected.packageAbiSha256),
  "Capability ABI identities were swapped or aliased.");
  return "PASS_PACKAGE_509_MODULE_AD484_DISTINCT_NO_SWAP";
}

const temporary = await mkdtemp(path.join(os.tmpdir(), "framer-runtime-proof-"));
try {
  const abiIdentitySeparation = verifyAbiIdentitySeparation();
  const [accepted, failClosed, host, xtensaResult, sourceFiles] = await Promise.all([
    verifyAcceptedImage(temporary), verifyFailClosed(temporary),
    verifyHostAndConcurrency(temporary), buildXtensa(temporary),
    Promise.all(["runtime_proof.h", "runtime_proof.c", "host_harness.c",
      "concurrency_harness.c", "verify.mjs"].map(async (file) => {
      const bytes = await readFile(path.join(here, file));
      return { file, bytes: bytes.length, sha256: sha256(bytes) };
    })),
  ]);
  const manifest = {
    format: "framer-mquickjs-runtime-proof-v1",
    status: "PASS_HOST_XTENSA_RUNTIME_CONTRACT_READY_FOR_LINK_NOT_HARDWARE",
    hardwareRuntimeProven: false,
    hardwareTouched: false,
    flashed: false,
    flashable: false,
    acceptedBase: {
      file: path.relative(repository, acceptedAppPath), bytes: expected.appBytes,
      sha256: expected.appSha256, flashOffset: "0x10000",
      receipt: path.relative(repository, acceptedReceiptPath),
      receiptSha256: expected.receiptSha256,
    },
    stockAbi: {
      applicationSpecific: true,
      failClosedOnAnyMismatch: true,
      screenCarrier: "0x42004e1c root -> 0x4210ad9c registry -> 0x4210af48 current controller",
      explicitlyRejectedCarriers: ["0x42006888 screen-manager path", "0x3fcab378 fixed RAM"],
      spans: accepted.verifiedSpans,
    },
    xtensa: {
      file: path.relative(repository, xtensaResult.artifact), ...xtensaResult,
      artifact: undefined,
    },
    tests: { failClosed, host: host.host, concurrency: host.concurrency,
      abiIdentitySeparation,
      methodLifetimeTamper: "PASS_4_DISTINCT_BOOT_LIFETIME_COPIES" },
    memory: {
      caps: "MALLOC_CAP_INTERNAL|MALLOC_CAP_8BIT", capsValue: "0x804",
      allocationCount: 1, vmHeapBytes: 65536,
      exactBlockBytes: "sizeof(final physical_block), exported and link-manifest-pinned",
      auditedPreRpcMinimumBytes: 92896,
      preflight: "free(caps)>=exactBlockBytes+32768 && largest(caps)>=exactBlockBytes",
      reserveBytes: 32768, order: "sample -> one exact block allocate -> internal-range and 16-byte alignment",
      psramFallback: false, cacheDisabledHazardAvoided: true,
    },
    ownerTask: {
      priority: 1, core: 1, stackBytes: 12288,
      loop: "exactly one bounded owner_step then vTaskDelay(1), including disabled/fault paths",
      callbackDeadlineUs: 2000, ownerStepFailBoundUs: 8000,
      watchdog: "new task is not auto-subscribed; no WDT add/reset/delete; delay leaves idle schedulable",
      stackTelemetry: "uxTaskGetStackHighWaterMark result used as bytes without x4",
    },
    rpc: {
      methods: ["widget.mquickjs.cap", "widget.mquickjs.telemetry",
        "widget.mquickjs.event", "widget.mquickjs.receipt"],
      contexts: 4, contextBytes: 352, totalBytes: 1408,
      ownedOffsets: { blocked: 192, value: 200, valueBytes: 113,
        statusKey: 313, method: 320, methodBytes: 32 },
      registrationObservedOnlyAfterCallbackCalls: true,
      concurrency: "per-context CAS; contended callback returns persistent blocked",
      responseJson: "{status:<persistent context string>}",
      request: ["id", "value", "auxiliary", "generation", "revision"],
      flow: "one outstanding event; Q on enqueue; B while outstanding; A/R/F only after owner result",
      receipt: "v1;s=<C|Q|A|R|B|H|F>;q=<8>;seq=<8>;g=<8>;r=<8>;id=<8>;v=<8>;a=<8>;ag=<8>;ar=<8>",
      receiptCoherence: "seqlock snapshot; exact same seq and fields; ag/ar are last-good until applied",
    },
    capability: {
      method: "widget.mquickjs.cap", pages: capabilityPages(), maxOwnedValueBytes: 112,
      inputLabReconstruction: {
        renderV2Profile: "framer-f1-render-v2-mquickjs-v1",
        packageFormat: "framer-render-v2-mquickjs-package-v1",
        packageAbiSha256: expected.packageAbiSha256,
        moduleAbiSha256: expected.moduleAbiSha256,
        engine: "MicroQuickJS", engineCommit: "203d5bb79789bc47b74855d9207415dab71661a0",
        javascriptProfile: "mquickjs-es5-strict-v1", deviceEvaluatesJavaScript: true,
        deviceRunsJsdom: false, maxPackageBytes: "98304", maxSourceBytes: "8192",
        heapBytes: "65536", callbackDeadlineUs: "2000", maxHandlers: "16",
        maxTargets: "16", maxKeys: "16", maxChords: "8",
        hardwareRuntimeProven: false,
      },
      baseAppIdentity: "Accepted healthy ancestry SHA256 36317013...; never interpreted as final patched candidate SHA",
      finalCandidateAppIdentity: "External approval plus full esptool readback receipt only; not device self-reported",
      moduleIdentity: "SHA256 exact flash readback [0x210000,0x240000): padded text 0x20000 then rodata 0x10000",
      uploader: false,
    },
    telemetry: {
      maxOwnedValueBytes: 112,
      pages: {
        p0: "b boot,u uptime,f free,l largest,h heap,H heapHigh,s stackMin",
        p1: "c callbacks,p polls,d deadline,t timeouts,o OOM,x exceptions,m maxSlice",
        p2: "l loads,s sourceRejected,p publishFailed,w wrongThread,r recoveries,R recoveryFailures,x signedLastResult,n lastEventSequence,f fatal",
        p3: "q depth,Q queued,A applied,R rejected,n eventSequence,m mailboxSequence,g appliedGeneration,r appliedRevision",
        p4: "w=U WDT-unsubscribed,dt delayTicks,dc delays,map=B bootlife,flash=0,nvs=0,f fatal",
        p5: "s screen,v visible,y replay,k keyObservations,t token,l level,G keyGate,c chord,r weatherAppliedRevision",
      },
      exactP2Grammar: "v1;p=2;l=<8>;s=<8>;p=<8>;w=<8>;r=<8>;R=<8>;x=<8>;n=<8>;f=<8>",
    },
    faults: {
      rpcId: "0x0000b24d",
      timeout: { value: "0x80000000", auxiliary: "0x54494d45", result: -6 },
      oom: { value: "0x80000001", auxiliary: "0x4f4f4d21", result: -7 },
      contract: "Q -> F same seq/id/value/aux/g; ag/ar remain last-good; telemetry p2 x=-6/-7,n=same seq,r increments,R=0,f=0; next benign B24D(0,0) A",
      normalWeatherDomain: "value 0|1; auxiliary 0..86400; fault values are disjoint",
    },
    keys: {
      staticEvidence: [{ logical: 0, nativeToken: "0x2c", name: "Space" },
        { logical: 1, nativeToken: "0xe1", name: "LeftShift" }],
      chordHeldMask: "0x3", rightShiftAliasRejected: "0xe5",
      gate: "key/chord capability false until exact 0x2c and 0xe1 each observed down+up while screen28 foreground",
      wrapper: "stock callback first; then proven carrier; unknown token observed but never wildcard-dispatched",
      concurrency: "atomic fields plus validated seqlock snapshot; TSAN exercised",
    },
    lifecycle: {
      hidden: "foreground-only key ingress; hide atomically closes gate and synthesizes release-all",
      reentry: "last-good generation/revision retained and replayed once; weather mailbox stays revision-coherent",
      bootLifetime: true, liveUnmap: false, runtimeFlashWrites: false, runtimeNvsWrites: false,
      rollback: "ROM bootloader/reset; no live vTaskDelete/unmap/cache-off acceptance path",
      producerRetirement: "accepting closes before waiting for inflight==0; generation tagged",
    },
    sources: sourceFiles,
    remainingPhysicalGates: [
      "link this contract into final physical module and pin post-RPC exact block size",
      "emit all device capability/telemetry/receipt pages through the stock RPC bridge",
      "observe both physical key down+up pairs before key capability opens",
      "read back app and 0x210000..0x240000 module slot and match exact SHA256",
      "run guarded OOM/timeout/recovery and bounded soak; external receipt may then promote hardwareRuntimeProven",
    ],
  };
  delete manifest.xtensa.artifact;
  await mkdir(output, { recursive: true });
  const manifestPath = path.join(output, "runtime-proof-manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ status: manifest.status,
    xtensa: manifest.xtensa, memory: manifest.memory, tests: manifest.tests,
    remainingPhysicalGates: manifest.remainingPhysicalGates }, null, 2)}\n`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
