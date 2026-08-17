import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { decodeHostedGlyphCache, HOSTED_GLYPH_CACHE_SHA256 } from "../lib/compiler.mjs";
import { CdpClient, ChromiumRasterCaptureProvider, launchBoundedChrome } from
  "../lib/chromium-raster-capture.mjs";

const EXPECTED_APPARMOR_PROFILE = `abi <abi/4.0>,
include <tunables/global>

profile input-lab-chrome /opt/input-lab/runtime/chrome-151.0.7922.138/chrome-linux64/chrome flags=(unconfined) {
  userns,
  include if exists <local/input-lab-chrome>
}
`;

class FakeSocket extends EventTarget {
  constructor() { super(); this.closed = false; }
  send() {}
  close() {
    if (this.closed) return;
    this.closed = true;
    this.dispatchEvent(new Event("close"));
  }
}

function fakeChromeChild({ endpoint = false } = {}) {
  const child = new EventEmitter();
  child.stderr = new EventEmitter();
  child.signals = [];
  let exited = false;
  child.kill = (signal) => {
    child.signals.push(signal);
    if (!exited) {
      exited = true;
      queueMicrotask(() => child.emit("exit", 0));
    }
    return true;
  };
  if (endpoint) queueMicrotask(() => child.stderr.emit("data",
    Buffer.from("DevTools listening on ws://127.0.0.1:49152/devtools/browser/test\n")));
  return child;
}

test("hosted glyph cache is SHA-pinned before JSON or masks are trusted", async () => {
  const bytes = await readFile(new URL("../assets/hosted-glyph-cache.json", import.meta.url));
  const cache = decodeHostedGlyphCache(bytes);
  assert.equal(cache.sha256, HOSTED_GLYPH_CACHE_SHA256);
  const mutated = Buffer.from(bytes);
  mutated[mutated.length - 2] ^= 1;
  assert.throws(() => decodeHostedGlyphCache(mutated), /SHA-256 mismatch/u);
});

test("hosted release preserves Chrome's sandbox with an exact-path AppArmor exception", async () => {
  const [profile, service, deploy, releaseBuilder] = await Promise.all([
    readFile(new URL("../hosted/input-lab-chrome.apparmor", import.meta.url), "utf8"),
    readFile(new URL("../hosted/input-lab-api.service", import.meta.url), "utf8"),
    readFile(new URL("../hosted/deploy.md", import.meta.url), "utf8"),
    readFile(new URL("../tools/build-hosted-release.mjs", import.meta.url), "utf8"),
  ]);
  assert.equal(profile, EXPECTED_APPARMOR_PROFILE);
  assert.match(releaseBuilder,
    /copy\("input-lab\/hosted\/input-lab-chrome\.apparmor", "input-lab\/hosted\/input-lab-chrome\.apparmor"\)/u);
  assert.match(releaseBuilder, /apparmorProfileSha256/u);
  assert.match(deploy, /input-lab\/hosted\/input-lab-chrome\.apparmor/u);
  assert.match(deploy, /\/etc\/apparmor\.d\/input-lab-chrome/u);
  assert.match(deploy, /apparmor_parser -Q -d \/etc\/apparmor\.d\/input-lab-chrome/u);
  assert.match(deploy, /apparmor_parser -r \/etc\/apparmor\.d\/input-lab-chrome/u);
  const activeService = service.split("\n").filter((line) => !line.trimStart().startsWith("#")).join("\n");
  assert.match(activeService, /^NoNewPrivileges=true$/mu);
  assert.doesNotMatch(activeService, /--no-sandbox/u);
});

test("Chromium spawn errors reject instead of terminating or wedging the API", async () => {
  const child = fakeChromeChild();
  const promise = launchBoundedChrome(() => {
    queueMicrotask(() => child.emit("error", new Error("ENOENT")));
    return child;
  }, "/missing/chrome", [], { startupTimeoutMs: 50, shutdownGraceMs: 1 });
  await assert.rejects(promise, (error) => error.code === "CHROMIUM_SPAWN_FAILED");
});

test("every unresolved CDP command has a deadline and closes its socket", async () => {
  const socket = new FakeSocket();
  const client = new CdpClient(socket, { commandTimeoutMs: 5 });
  await assert.rejects(client.send("Page.neverReturns"),
    (error) => error.code === "CHROMIUM_CAPTURE_TIMEOUT");
  assert.equal(socket.closed, true);
});

test("capture connection timeout always terminates its bounded Chrome child", async () => {
  const child = fakeChromeChild();
  const socket = new FakeSocket();
  const provider = new ChromiumRasterCaptureProvider({
    chromePath: "/fake/chrome",
    expectedProduct: "Chrome/test",
    spawnProcess: () => {
      queueMicrotask(() => child.stderr.emit("data",
        Buffer.from("DevTools listening on ws://127.0.0.1:49152/devtools/browser/test\n")));
      return child;
    },
    createWebSocket: () => socket,
    limits: { startupTimeoutMs: 50, connectTimeoutMs: 5, commandTimeoutMs: 5,
      jobTimeoutMs: 100, shutdownGraceMs: 5 },
  });
  await assert.rejects(provider.capture({ html: "<div></div>", css: "div{color:white}" }),
    (error) => error.code === "CHROMIUM_CAPTURE_TIMEOUT");
  assert.deepEqual(child.signals, ["SIGTERM"]);
  assert.equal(socket.closed, true);
});
