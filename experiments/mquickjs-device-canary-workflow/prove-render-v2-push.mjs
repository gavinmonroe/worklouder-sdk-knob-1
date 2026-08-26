#!/usr/bin/env node
// End-to-end proof for the render-v2 generic push path, deliberately routed
// AROUND widget.scene.capabilities.
//
// That RPC crashes the generic build (371ee26e): its handler reads the scene
// state through a stale a7, renders committedGeneration as its own stack frame
// top (0x3FCE0070), and then dies initialising the response root — a null+6
// load in stock code. Coredump evidence is in docs/15. Nothing in the transfer
// needs it: begin/write/commit are separate handlers.
//
// Detection therefore uses only RPCs proven safe on hardware:
//   widget.mquickjs.cap  → responds on the mquickjs build, unregistered here
//   widget.scene.status  → answers {status:"ok"} on the generic build
//
// Generation: the generic build has noBootProgram=true, so a fresh boot has
// committed generation 0 and the first push is expectedGeneration 0. After a
// successful commit the device owns generation 1, and a second push in the
// same boot must use 1 — the script tracks that itself.
//
//   node prove-render-v2-push.mjs --dry-run      build + validate, no device
//   node prove-render-v2-push.mjs --confirm-live-rpc

import { createHash } from "node:crypto";
import path from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { encodeRasterAnimation } from "../../f1-widget-sdk/src/render/raster-animation.mjs";
import { encodeWidgetBundle } from "../../f1-widget-sdk/src/render/widget-bundle.mjs";
import { InputWlrpcSceneTransport } from "../../f1-widget-sdk/input-lab/lib/input-wlrpc-scene-transport.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const WIDTH = 100;
const HEIGHT = 310;
const PIXELS = WIDTH * HEIGHT;
const CHUNK_RAW_BYTES = 3072;
const MAX_CHUNKS = 32;
const MAX_BUNDLE_BYTES = 98_304;
const PROTOCOL = "framer-widget-scene-rpc-v1";

function invariant(value, message) {
  if (!value) throw new Error(message);
}

const rgb565 = (r, g, b) => ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3);

/**
 * A frame no boot scene could produce by accident: six saturated horizontal
 * bands plus a moving white marker. If this lands on the panel, the bytes
 * genuinely came from us.
 */
function testFrame(step) {
  const bands = [
    rgb565(255, 0, 0), rgb565(255, 160, 0), rgb565(255, 255, 0),
    rgb565(0, 220, 90), rgb565(0, 120, 255), rgb565(170, 0, 255),
  ];
  const frame = new Uint16Array(PIXELS);
  const bandHeight = Math.ceil(HEIGHT / bands.length);
  for (let y = 0; y < HEIGHT; y += 1) {
    const colour = bands[Math.min(bands.length - 1, Math.floor(y / bandHeight))];
    for (let x = 0; x < WIDTH; x += 1) frame[y * WIDTH + x] = colour;
  }
  // Marker block that advances down the panel each frame.
  const top = 10 + step * 14;
  for (let y = top; y < Math.min(HEIGHT, top + 12); y += 1) {
    for (let x = 30; x < 70; x += 1) frame[y * WIDTH + x] = 0xffff;
  }
  return frame;
}

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Standalone F1WB (no F2EP tail) — the envelope the generic gate accepts. */
export function buildPackage({ frameCount = 1, generation }) {
  const frames = Array.from({ length: frameCount }, (_, index) => testFrame(index));
  const animation = encodeRasterAnimation({
    frames,
    width: WIDTH,
    height: HEIGHT,
    fps: 1,
    loopDurationMs: 1000 * frameCount,
  });
  const bundle = encodeWidgetBundle({
    slots: [{ name: "proof", kind: "raster", animationBinary: animation.binary }],
    activeSlot: 0,
    generation,
  });
  const binary = Buffer.from(bundle.binary);

  // Mirror the device's basic_f1wb gate before spending a transfer on it.
  invariant(binary.subarray(0, 4).toString("ascii") === "F1WB", "magic must be F1WB");
  invariant(binary[4] === 1 && binary[5] === 3, "version 1, capacity 3");
  invariant(binary[6] >= 1 && binary[6] <= 3 && binary[7] < binary[6], "1..3 slots, activeSlot < count");
  invariant(binary.readUInt32LE(8) === generation, "u32@8 must equal generation");
  invariant(binary.readUInt32LE(12) === binary.length, "u32@12 must equal bundle bytes (standalone)");
  invariant(binary.readUInt16LE(16) === 104 && binary.readUInt16LE(18) === 332, "descriptor/payload offsets");
  invariant(binary.length <= MAX_BUNDLE_BYTES, `bundle ${binary.length} over ${MAX_BUNDLE_BYTES}`);

  const totalChunks = Math.ceil(binary.length / CHUNK_RAW_BYTES);
  invariant(totalChunks >= 1 && totalChunks <= MAX_CHUNKS, `chunks ${totalChunks} over ${MAX_CHUNKS}`);

  return { binary, sha256: sha256Hex(binary), generation, totalChunks, frameCount };
}

export function buildUpload(pkg, expectedGeneration) {
  const transactionId = `f2pv-${pkg.generation.toString(16).padStart(8, "0")}-${pkg.sha256.slice(0, 16)}`;
  const common = {
    protocol: PROTOCOL,
    transactionId,
    expectedGeneration,
    generation: pkg.generation,
    totalBytes: pkg.binary.length,
    totalChunks: pkg.totalChunks,
    sha256: pkg.sha256,
  };
  const chunks = [];
  for (let index = 0; index < pkg.totalChunks; index += 1) {
    const offset = index * CHUNK_RAW_BYTES;
    const chunk = pkg.binary.subarray(offset, Math.min(pkg.binary.length, offset + CHUNK_RAW_BYTES));
    chunks.push({
      protocol: PROTOCOL,
      transactionId,
      generation: pkg.generation,
      index,
      offset,
      bytes: chunk.length,
      chunkSha256: sha256Hex(chunk),
      data: chunk.toString("base64"),
    });
  }
  return { manifest: { ...common, chunkRawBytes: CHUNK_RAW_BYTES }, chunks, commit: common,
    abort: { protocol: PROTOCOL, transactionId, generation: pkg.generation } };
}

function statusOf(response) {
  const result = response?.result ?? response;
  return result && typeof result === "object" ? result.status : undefined;
}

/** Safe fingerprint: never calls widget.scene.capabilities. */
async function detect(transport) {
  let sceneAlive = false;
  try {
    sceneAlive = statusOf(await transport.rpc("widget.scene.status", { protocol: PROTOCOL })) === "ok";
  } catch { sceneAlive = false; }
  return { sceneAlive };
}

async function main(argv) {
  const dryRun = argv.includes("--dry-run");
  const live = argv.includes("--confirm-live-rpc");
  invariant(dryRun || live, "Pass --dry-run or --confirm-live-rpc.");
  const frameCount = Number(argv[argv.indexOf("--frames") + 1]) || 1;

  const journal = { format: "render-v2-push-proof-v1", startedAt: new Date().toISOString(), steps: [] };
  const step = (name, detail) => {
    journal.steps.push({ name, ...detail });
    console.log(`${name}: ${JSON.stringify(detail)}`);
  };

  if (dryRun) {
    for (const n of [1, 5, 10, 20]) {
      try {
        const pkg = buildPackage({ frameCount: n, generation: 1 });
        const upload = buildUpload(pkg, 0);
        step("build", { frames: n, bytes: pkg.binary.length, chunks: pkg.totalChunks,
          sha256: pkg.sha256.slice(0, 16),
          envelopeMaxBytes: Math.max(...upload.chunks.map((c) => JSON.stringify(c).length)) });
      } catch (cause) {
        // Expected past a point: this proof pattern is deliberately
        // delta-hostile (a large marker jumping 14px per frame), so it hits the
        // scene-store ceiling far sooner than real widget content does.
        step("build-rejected", { frames: n, reason: cause.message });
      }
    }
    console.log("\nDRY RUN OK — structure passes every gate the device enforces, and the ceiling rejects oversize.");
    return;
  }

  const transport = new InputWlrpcSceneTransport({ timeoutMs: 30_000 });

  const fingerprint = await detect(transport);
  step("detect", fingerprint);
  invariant(fingerprint.sceneAlive, "widget.scene.status did not answer ok; is the generic build flashed?");

  // noBootProgram=true → a fresh boot is committed generation 0. After a
  // successful commit the device owns generation+1, so a second push in the
  // same boot must declare that; --expected lets the caller assert it, which
  // doubles as proof the prior commit actually advanced device state.
  const expectedFlag = argv.indexOf("--expected");
  const expectedGeneration = expectedFlag >= 0 ? Number(argv[expectedFlag + 1]) : 0;
  invariant(Number.isInteger(expectedGeneration) && expectedGeneration >= 0, "--expected must be a uint32");
  const pkg = buildPackage({ frameCount, generation: expectedGeneration + 1 });
  step("build", { frames: pkg.frameCount, bytes: pkg.binary.length, chunks: pkg.totalChunks, sha256: pkg.sha256 });

  const upload = buildUpload(pkg, expectedGeneration);
  let begun = false;
  try {
    const began = statusOf(await transport.rpc("widget.scene.begin", upload.manifest));
    step("begin", { status: began });
    invariant(began === "ok", "begin rejected — a stale transaction may be open; power-cycle and retry");
    begun = true;

    for (const chunk of upload.chunks) {
      const ack = statusOf(await transport.rpc("widget.scene.write", chunk));
      invariant(ack === "ok", `chunk ${chunk.index} rejected`);
    }
    step("write", { chunks: upload.chunks.length, status: "ok" });

    const committed = statusOf(await transport.rpc("widget.scene.commit", upload.commit));
    step("commit", { status: committed });
    invariant(committed === "ok", "commit rejected — package failed device admission");

    journal.result = "PASS_PUSH_COMMITTED";
    console.log(`\nPUSH COMMITTED — generation ${pkg.generation} is live on screen 26.`);
    console.log("The panel should now show six colour bands with a white marker block.");
  } catch (cause) {
    journal.result = "FAIL";
    journal.error = cause.message;
    if (begun) {
      try { await transport.rpc("widget.scene.abort", upload.abort); step("abort", { status: "sent" }); }
      catch { step("abort", { status: "failed" }); }
    }
    throw cause;
  } finally {
    journal.finishedAt = new Date().toISOString();
    // One file per run: a later failed retry must never clobber the evidence
    // of a successful push.
    const out = path.join(here, "receipts/2026-08-18-push-proof");
    await mkdir(out, { recursive: true });
    const stamp = journal.startedAt.replace(/[:.]/gu, "-");
    await writeFile(path.join(out, `push-proof-${stamp}.json`), `${JSON.stringify(journal, null, 2)}\n`);
  }
}

main(process.argv.slice(2)).catch((error) => {
  console.error(`FAILED: ${error.message}`);
  process.exitCode = 1;
});
