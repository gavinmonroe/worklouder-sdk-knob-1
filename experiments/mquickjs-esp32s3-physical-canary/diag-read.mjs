#!/usr/bin/env node
// Host reader for the DIAGNOSTIC resident loader (loader_entry_diag.c).
//
// Talks to the Framer F1 through the running Input.app (the app owns the USB
// transport), calls every diagnostic method the diag loader registers plus the
// module's own capability RPC, and decodes each packed field by name.
//
//   node experiments/mquickjs-esp32s3-physical-canary/diag-read.mjs
//
// Requires a DIAG app image to be flashed at 0x10000 and Input.app running
// with its inspector port open. Read-only: it issues RPC calls only, never
// flashes or writes.
//
//   build-diag/         loader-only diagnostic against the FROZEN release
//                       module already on flash; diag4 is always "empty".
//   build-diag-module/  diagnostic loader plus an INSTRUMENTED module slot
//                       (text @0x210000, rodata @0x230000); diag4 carries the
//                       JS exception text that made framer_mqjs_load fail.

import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(here, "../..");
const { evaluateInInput } = await import(
  path.join(repository, "framer-widgets/lib/input-inspector.mjs"));

const expr = String.raw`
(async () => {
  const { createRequire } = process.getBuiltinModule("node:module");
  const requireFromInput = createRequire("/Applications/input.app/Contents/Resources/app.asar/dist-electron/main/index.js");
  const sdk = requireFromInput("@worklouder/wl-device-kit");
  const devices = new sdk.WLDeviceDiscovery().findWLDevices([sdk.DeviceType.KnobF1]);
  if (devices.length !== 1 || !devices[0].isUsbConnection) throw new Error("Expected exactly one USB Framer F1");
  const comm = new sdk.WLDeviceCommImpl();
  await comm.connect(devices[0]);
  const out = {};
  try {
    const api = new sdk.WLRPCApi(comm);
    out.version = await api.getFirmwareVersion();
    const client = new sdk.WLRPCClient(comm);
    const call = async (label, req) => { try { out[label] = await client.sendRpcCall(req); } catch (e) { out[label] = { error: String(e && e.message || e) }; } };
    await call("diag", { method: "widget.mquickjs.diag" });
    await call("diag2", { method: "widget.mquickjs.diag2" });
    await call("diag3", { method: "widget.mquickjs.diag3" });
    await call("diag4", { method: "widget.mquickjs.diag4" });
    await call("scene", { method: "widget.scene.status", params: { protocol: "framer-widget-scene-rpc-v1" } });
    await call("cap0", { method: "widget.mquickjs.cap", params: { page: 0 } });
  } finally { try { await comm.disconnect(); } catch {} }
  return out;
})()`;

// --- decode tables -----------------------------------------------------------

const GATES = {
  0: "entered (loader running, no gate passed yet)",
  1: "backend identity reject",
  2: "pre-alloc admission reject (free/largest too small)",
  3: "alloc null / misaligned / out of internal range",
  4: "post-alloc reserve reject",
  5: "framer_mqjs_map_canary failed (see m)",
  6: "startup returned 0 (block freed, module unmapped)",
  7: "startup returned 1 (module owns the block)",
};

// physical_integration.c owner_task + framer_physical_module_startup.
const BOOT_STATES = {
  0: "never set (startup did not reach task creation, or block not initialised)",
  1: "owner task started (still in LZSS/F2TF/F2JS admission)",
  2: "owner admitted: VM + immutable assets ok, waiting for setup-task publish",
  3: "f2js/owner boot admit FAILED (framer_resident_owner_boot_on_task != OK)",
  4: "publish_proxy returned null",
  5: "LZSS base-raster decode FAILED",
  6: "F2TF target preflight FAILED (framer_tf_admit != FRAMER_TF_OK)",
  7: "published ok - rpc_ready set, navigation added",
  8: "register_rpc FAILED (stock RPC registry unavailable)",
  9: "startup TIMED OUT waiting for the owner (boot_state still 1 after 1000 ticks)",
  10: "registration mismatch (published->registry != block->registry)",
};

// resident_integration.h framer_resident_capability_state.
const CAP_STATES = {
  0: "COLD", 1: "ASSEMBLING", 2: "ADVERTISED", 3: "QUIESCING",
  4: "STOPPED", 5: "FAULTED",
};

// resident_integration.c source lifecycle enum.
const QUIESCE_STATES = {
  0: "UNARMED", 1: "LIVE", 2: "RETIRING", 3: "QUIESCED", 4: "FAILED",
};

// framer_mquickjs_canary.h framer_mqjs_result (owner.telemetry.last_result).
const MQJS_RESULTS = {
  0: "FRAMER_MQJS_OK", "-1": "ERR_ARGUMENT", "-2": "ERR_WRONG_THREAD",
  "-3": "ERR_NOT_ADMITTED", "-4": "ERR_SOURCE", "-5": "ERR_EXCEPTION",
  "-6": "ERR_TIMEOUT", "-7": "ERR_OOM", "-8": "ERR_PUBLISH",
  "-9": "ERR_DISABLED", "-10": "ERR_SEQUENCE",
};

const READY_BITS = [
  [1 << 0, "MODULE_MAP"], [1 << 1, "PARSER"],
  [1 << 2, "VM_TASK"], [1 << 3, "MAILBOX"],
];

const PHYSICAL_MAGIC = 0x514a5732;
const BLOCK_BYTES = 95568;
const RUNTIME_RESERVE = 32768;
const MAP_RESERVE = 4096;

// --- helpers -----------------------------------------------------------------

const UNKNOWN = 0xffffffff;
const u = (h) => Number.parseInt(h, 16) >>> 0;
const i32 = (h) => u(h) | 0;
const hex = (v) => `0x${(v >>> 0).toString(16)}`;
const known = (v) => v !== UNKNOWN;
const or = (v, text) => (known(v) ? text : "unknown (block pointer not published)");
const label = (table, v) => `${v} = ${table[v] ?? "?"}`;

function fields(status, prefix) {
  if (typeof status !== "string" || !status.startsWith(prefix)) return null;
  return Object.fromEntries(status.split(";").slice(1).map((kv) => {
    const eq = kv.indexOf("=");
    return [kv.slice(0, eq), kv.slice(eq + 1)];
  }));
}

function readyMask(v) {
  if (!known(v)) return "unknown";
  const names = READY_BITS.filter(([bit]) => (v & bit) !== 0).map(([, n]) => n);
  return `${hex(v)}${names.length ? ` [${names.join("|")}]` : " [none]"}` +
    (v === 0x0f ? " (ALL)" : "");
}

function statusOf(entry) {
  if (!entry) return undefined;
  if (entry.error) return undefined;
  return entry.result?.status ?? entry.status;
}

// --- run ---------------------------------------------------------------------

const r = await evaluateInInput(expr, { timeoutMs: 60000 });
console.log(JSON.stringify(r, null, 1));

const v1 = fields(statusOf(r?.diag), "v1");
const v2 = fields(statusOf(r?.diag2), "v2");
const v3 = fields(statusOf(r?.diag3), "v3");
// v4 is free text, not packed fields: "v4;" then runtime_state::last_error.
const v4raw = statusOf(r?.diag4);
const v4 = typeof v4raw === "string" && v4raw.startsWith("v4;")
  ? v4raw.slice(3) : null;

if (v1) {
  const gate = u(v1.g);
  console.log("\n=== widget.mquickjs.diag (v1) - loader admission gates ===");
  console.log({
    "g  gate": `${gate} = ${GATES[gate] ?? "?"}`,
    "f0 free internal before block alloc": u(v1.f0),
    "l0 largest internal before block alloc": u(v1.l0),
    "b  raw (unaligned) block pointer": hex(u(v1.b)),
    "f1 free internal after block alloc": u(v1.f1),
    "l1 largest internal after block alloc": u(v1.l1),
    "m  framer_mqjs_map_canary result": i32(v1.m),
    "s  framer_physical_module_startup return": u(v1.s),
    "r  ticks waited for the stock RPC registry":
      u(v1.r) === UNKNOWN ? "never appeared - nothing registered" : u(v1.r),
    "   gate-2 thresholds": {
      needFree: BLOCK_BYTES + 16 + RUNTIME_RESERVE + MAP_RESERVE,
      needLargest: BLOCK_BYTES + 16,
    },
  });
}

if (v2) {
  const boot = u(v2.b);
  const task = u(v2.k);
  const water = u(v2.w);
  const us = u(v2.u);
  console.log("\n=== widget.mquickjs.diag2 (v2) - LIVE owner-task boot state ===");
  console.log({
    "b  block->boot_state": or(boot, label(BOOT_STATES, boot)),
    "y  block->rpc_ready": or(u(v2.y), `${u(v2.y)} (1 = module RPCs advertised)`),
    "s  block->sources_enabled":
      or(u(v2.s), `${u(v2.s)} (1 = platform_activate_events succeeded)`),
    "t  block->boot_started_ms": or(u(v2.t), `${u(v2.t)} ms (0 = owner task never ran)`),
    "f  block->boot_finished_ms":
      or(u(v2.f), `${u(v2.f)} ms (0 = owner still inside admission, or it hung)`),
    "k  block->task_handle": or(task, task === 0 ? "0 (task never created)" : hex(task)),
    "w  uxTaskGetStackHighWaterMark(task)":
      known(water) ? `${water} bytes free at the owner-stack low-water mark`
                   : "not sampled (no task handle)",
    "u  us from loader entry to startup return":
      us === 0 ? "startup never returned / not reached"
               : `${us} us (~${(us / 1e6).toFixed(3)} s) - startup waits <=1000 ticks, ` +
                 "so ~1 s means 1 kHz ticks and ~10 s means 100 Hz ticks",
    "h  free internal heap NOW": u(v2.h),
    "g  largest internal free block NOW": u(v2.g),
  });
}

if (v3) {
  const magic = u(v3.m);
  const cap = u(v3.c);
  const gen = u(v3.a);
  const counts = u(v3.n);
  const event0 = u(v3.e);
  const heap = u(v3.p);
  const last = i32(v3.l);
  const booted = u(v3.d);
  const quiesce = u(v3.v);
  // last_result is signed, so 0xffffffff is a legal value (-1 = ERR_ARGUMENT);
  // fall back to the magic word to decide whether the block was readable.
  const blockKnown = known(magic);
  console.log("\n=== widget.mquickjs.diag3 (v3) - LIVE owner admission forensics ===");
  console.log({
    "m  block->magic": known(magic)
      ? `${hex(magic)} ${magic === PHYSICAL_MAGIC ? "OK (PHYSICAL_MAGIC)" : "MISMATCH - block never initialised by startup"}`
      : "unknown (block pointer not published)",
    "c  owner.capability.state": or(cap, label(CAP_STATES, cap)),
    "r  owner.capability.ready_mask": readyMask(u(v3.r)),
    "a  owner.admission.generation": or(gen, gen === 0
      ? "0 = framer_f2js_admit() itself FAILED (header/directory/hash/source/input/event/target/asset)"
      : `${gen} = F2JS package fully admitted`),
    "n  admission key/chord/source_bytes": known(counts) ? {
      key_count: counts & 0xff,
      chord_count: (counts >>> 8) & 0xff,
      source_bytes: (counts >>> 16) & 0xffff,
    } : "unknown",
    "e  admission.events[0] (kind|id<<16)": known(event0) ? {
      raw: hex(event0), kind: event0 & 0xff, id: (event0 >>> 16) & 0xffff,
      meaning: event0 === 0
        ? "validate_events() never wrote a record - admit stopped at or before the events section"
        : "validate_events() ran",
    } : "unknown",
    "p  owner.heap": or(heap, heap === 0
      ? "0 = engine heap not claimed (admit failed earlier, or engine init/load failed and freed it)"
      : `${hex(heap)} = platform_allocate claimed the 64 KiB VM heap`),
    "l  owner.telemetry.last_result": blockKnown
      ? `${last} = ${MQJS_RESULTS[String(last)] ?? "?"}` +
        (last !== 0 ? " (engine init/load failed -> boot returned ERR_SOURCE)" : "")
      : "unknown (block pointer not published)",
    "d  telemetry.booted|permanently_disabled<<8": known(booted) ? {
      booted: booted & 0xff,
      permanently_disabled: (booted >>> 8) & 0xff,
      meaning: (booted & 0xff)
        ? "engine init+load SUCCEEDED - any failure was in capability/source activation"
        : "engine never reported booted",
    } : "unknown",
    "v  owner.source_quiesce_state": or(quiesce, label(QUIESCE_STATES, quiesce)),
  });

  if (v2) {
    const boot = u(v2.b);
    let verdict;
    if (!known(boot)) verdict = "No live block: startup never got far enough to publish one.";
    else if (boot === 7) verdict = "Owner booted and published. Module RPCs should answer.";
    else if (boot === 5) verdict = "decode_lzss() of the base raster failed. No sub-code is stored (local to owner_task).";
    else if (boot === 6) verdict = "framer_tf_admit() preflight failed. framer_tf_result is a local in owner_task - not stored.";
    else if (boot === 9) verdict = "Owner never left state 1 within 1000 ticks: check t/f/w in diag2 to see whether it ran at all.";
    else if (boot === 3) {
      if (gen === 0) verdict = "framer_f2js_admit() rejected the package (exact framer_f2js_result is a local - use a/e/n to bracket it).";
      else if (heap === 0 && last !== 0) verdict = "F2JS admitted; MicroQuickJS init/load failed (see l).";
      else if ((booted & 0xff) === 0) verdict = "F2JS admitted; failed between asset staging and engine load.";
      else verdict = "Engine booted; failed in capability set_ready or activate_sources_and_advertise (see s in diag2 for events, v for input).";
    } else verdict = BOOT_STATES[boot] ?? "unknown boot_state";
    console.log("\nVERDICT:", verdict);
  }
}

if (v4 !== null) {
  console.log("\n=== widget.mquickjs.diag4 (v4) - captured JS exception text ===");
  if (v4 === "no-block") {
    console.log("no live resident block - startup never published one, so nothing was recorded");
  } else if (v4 === "empty") {
    console.log("empty - runtime_state::last_error was never written.");
    console.log("  Either no JavaScript exception was classified, or the flashed slot-A");
    console.log("  pages are the FROZEN release module (which has no last_error buffer).");
    console.log("  Flash build-diag-module/ text @0x210000 + rodata @0x230000 to record it.");
  } else {
    console.log(`  ${v4}`);
    console.log("\n  Format: \"<Error name>: <message> @<stack>\", truncated to 107 chars,");
    console.log("  written by classify_exception in the instrumented engine and preserved");
    console.log("  across framer_mqjs_destroy. Pair it with l in diag3 (-5 = ERR_EXCEPTION).");
  }
}

if (!v1) console.log("\nwidget.mquickjs.diag did not answer - the DIAG loader is not running.");
if (!v2) console.log("widget.mquickjs.diag2 did not answer.");
if (!v3) console.log("widget.mquickjs.diag3 did not answer.");
if (v4 === null) console.log("widget.mquickjs.diag4 did not answer - this loader predates diag4.");
